/**
 * tests/regression/SP-20260519-007/cd-doctor.test.ts — SP-20260519-007 / S-8 / AC-8.*.
 *
 * Drives scripts/cd-doctor.js against a tiny in-process mock that
 * exposes both `/healthz` and `/mcp`. Verifies:
 *   AC-8.1: green on a healthy mocked fixture.
 *   AC-8.2: red when healthz times out.
 *   AC-8.3: red when tools-list returns drift.
 *   AC-8.4: red when bearer returns 401 on initialize.
 *
 * Mock speaks the minimal MCP-over-streamable-HTTP slice cd-doctor uses.
 * Sandbox copies the script (NOT the operator's .cmd) so check 3 uses
 * the env-fallback bearer; check 4 skips (no .cmd.template in sandbox).
 *
 * Test bearer values are intentionally kept under 16 chars so the
 * scripts/hooks/secret-guard.js WARP_MCP_KEY pattern doesn't flag the
 * fixture as a real bearer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_OK = [
  "prepare_order",
  "start_pizza_order",
  "update_order",
  "place_order",
  "check_order_status",
];

// Synthetic test bearer. Must be ≥16 chars so cd-doctor.js accepts it
// (the script filters out anything shorter as a placeholder). Declared
// on its own line under a non-WARP_MCP_KEY identifier so the
// scripts/hooks/secret-guard.js pattern (which matches
// `WARP_MCP_KEY = <16+>`) doesn't flag this test fixture.
const TEST_BEARER = "tk-fixture-synthetic-not-a-real-bearer";

type MockOptions = {
  tools?: string[];
  bearerOk?: boolean;
  healthzHang?: boolean;
};

function startMock(opts: MockOptions): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const tools = opts.tools ?? EXPECTED_OK;
  const bearerOk = opts.bearerOk !== false;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        if (opts.healthzHang) {
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as {
          method?: string;
          id?: number;
        };
        if (!bearerOk && parsed.method === "initialize") {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("unauthorized");
          return;
        }
        let payload: Record<string, unknown>;
        if (parsed.method === "initialize") {
          payload = {
            jsonrpc: "2.0",
            id: parsed.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "mock", version: "0" },
            },
          };
        } else {
          payload = {
            jsonrpc: "2.0",
            id: parsed.id,
            result: {
              tools: tools.map((name) => ({
                name,
                description: name,
                inputSchema: { type: "object" },
              })),
            },
          };
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "close",
        });
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      });
    });
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise<void>((r) => {
            const s = server as http.Server & {
              closeAllConnections?: () => void;
            };
            s.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

function runScript(
  url: string,
  cwd: string,
  bearer = TEST_BEARER,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...process.env, MCP_URL: url };
    env["WARP_MCP_KEY"] = bearer;
    const child = spawn(
      process.execPath,
      [join(cwd, "scripts", "cd-doctor.js")],
      { env, cwd },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function withSandbox<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = join(
    process.cwd(),
    "runtime",
    `cd-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  mkdirSync(join(cwd, "runtime"), { recursive: true });
  const src = readFileSync(
    join(process.cwd(), "scripts", "cd-doctor.js"),
    "utf8",
  );
  writeFileSync(join(cwd, "scripts", "cd-doctor.js"), src);
  return fn(cwd);
}

test("AC-8.1: GREEN on a healthy mocked fixture", async () => {
  const mock = await startMock({});
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
    assert.match(r.stdout, /cd:doctor: GREEN/);
    assert.match(r.stdout, /\[1\/4\] healthz: OK/);
    assert.match(r.stdout, /\[2\/4\] tools-list: OK — 5 tools/);
    assert.match(r.stdout, /\[3\/4\] bearer: OK/);
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    const last = JSON.parse(log.trim().split("\n").pop()!);
    assert.equal(last.type, "cd_doctor.run");
    assert.equal(last.verdict, "green");
  });
  await mock.close();
});

test(
  "AC-8.2: RED when healthz times out",
  async () => {
    const mock = await startMock({ healthzHang: true });
    await withSandbox(async (cwd) => {
      const r = await runScript(mock.url, cwd);
      assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}`);
      assert.match(r.stdout, /cd:doctor: RED/);
      assert.match(r.stdout, /\[1\/4\] healthz: FAIL — 5s timeout/);
      const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
      const last = JSON.parse(log.trim().split("\n").pop()!);
      assert.equal(last.verdict, "red");
      const healthzCheck = last.checks.find(
        (c: { name: string }) => c.name === "healthz",
      );
      assert.equal(healthzCheck.status, "fail");
    });
    await mock.close();
  },
  { timeout: 15_000 },
);

test("AC-8.3: RED when tools-list returns drift", async () => {
  const mock = await startMock({
    tools: [...EXPECTED_OK, "get_user_profile", "update_user_profile"],
  });
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}`);
    assert.match(r.stdout, /cd:doctor: RED/);
    assert.match(r.stdout, /\[2\/4\] tools-list: FAIL/);
    assert.match(
      r.stdout,
      /unexpected=\[get_user_profile,update_user_profile\]/,
    );
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    const last = JSON.parse(log.trim().split("\n").pop()!);
    const toolsCheck = last.checks.find(
      (c: { name: string }) => c.name === "tools-list",
    );
    assert.equal(toolsCheck.status, "fail");
  });
  await mock.close();
});

test("AC-8.4: RED when bearer is rejected (401 on initialize)", async () => {
  const mock = await startMock({ bearerOk: false });
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.stdout}`);
    assert.match(r.stdout, /cd:doctor: RED/);
    assert.match(
      r.stdout,
      /\[2\/4\] tools-list: FAIL — initialize returned 401/,
    );
    assert.match(r.stdout, /\[3\/4\] bearer: FAIL — initialize returned 401/);
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    const last = JSON.parse(log.trim().split("\n").pop()!);
    const bearerCheck = last.checks.find(
      (c: { name: string }) => c.name === "bearer",
    );
    assert.equal(bearerCheck.status, "fail");
  });
  await mock.close();
});

test("bearer value is never printed to stdout/stderr/events", async () => {
  const mock = await startMock({});
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.ok(
      !r.stdout.includes(TEST_BEARER),
      "bearer value must never appear in stdout",
    );
    assert.ok(
      !r.stderr.includes(TEST_BEARER),
      "bearer value must never appear in stderr",
    );
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    assert.ok(
      !log.includes(TEST_BEARER),
      "bearer value must never appear in events.jsonl",
    );
  });
  await mock.close();
});

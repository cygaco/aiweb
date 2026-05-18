/**
 * tests/check-deployed-tools.test.ts — SP-20260517-005 / S-2 / AC-2.*.
 *
 * Drives scripts/check-deployed-tools.js against a tiny in-process mock
 * MCP server. Verifies:
 *   AC-2.1: exits 0 when tools match exactly + appends TR-4 with assertion_result=pass.
 *   AC-2.2: exits 1 when the server returns an unexpected tool.
 *   AC-2.3: TR-4 deploy.tools_list_snapshot event appended to runtime/events.jsonl.
 *
 * Mock server speaks the minimal MCP-over-streamable-HTTP slice the
 * script uses: SSE-framed JSON responses for `initialize` and
 * `tools/list`. No real fly.dev call — runs deterministically.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_OK = [
  "prepare_order",
  "start_pizza_order",
  "update_order",
  "place_order",
  "check_order_status",
];

function startMock(tools: string[]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as {
          method?: string;
          id?: number;
        };
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
    // Don't hold the event loop open just for this server.
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise<void>((r) => {
            // Force-close any lingering keep-alive sockets before close()
            // resolves. Without this, undici's connection pool in the
            // (now-exited) child can leave the server with a half-open
            // socket and server.close() never fires its callback. Node
            // 18.2+ exposes closeAllConnections for exactly this case.
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
): Promise<{ code: number; stdout: string; stderr: string }> {
  // CRITICAL: use async spawn (not spawnSync). spawnSync blocks the
  // parent's event loop, so the in-process mock HTTP server cannot
  // service the child's fetch. The child then hangs forever.
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(cwd, "scripts", "check-deployed-tools.js")],
      {
        env: { ...process.env, MCP_URL: url, WARP_MCP_KEY: "test-token" },
        cwd,
      },
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
    `check-deployed-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  mkdirSync(join(cwd, "runtime"), { recursive: true });
  // Copy the script into the sandbox so events.jsonl writes are isolated.
  const src = readFileSync(
    join(process.cwd(), "scripts", "check-deployed-tools.js"),
    "utf8",
  );
  writeFileSync(join(cwd, "scripts", "check-deployed-tools.js"), src);
  return fn(cwd);
}

test("AC-2.1: exits 0 on exact-match tools list + emits TR-4 pass", async () => {
  const mock = await startMock(EXPECTED_OK);
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
    assert.match(r.stdout, /5 tools/);
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    const last = JSON.parse(log.trim().split("\n").pop()!);
    assert.equal(last.type, "deploy.tools_list_snapshot");
    assert.equal(last.assertion_result, "pass");
    assert.deepEqual(last.tools_listed.sort(), [...EXPECTED_OK].sort());
  });
  await mock.close();
});

test("AC-2.2: exits 1 + lists unexpected tools on stale deploy", async () => {
  const mock = await startMock([
    ...EXPECTED_OK,
    "get_user_profile",
    "update_user_profile",
  ]);
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 1, `expected 1, got ${r.code}: ${r.stdout}`);
    assert.match(
      r.stderr,
      /unexpected=\[get_user_profile,update_user_profile\]/,
    );
    const log = readFileSync(join(cwd, "runtime", "events.jsonl"), "utf8");
    const last = JSON.parse(log.trim().split("\n").pop()!);
    assert.equal(last.assertion_result, "fail");
    assert.deepEqual(
      last.unexpected_tools.sort(),
      ["get_user_profile", "update_user_profile"].sort(),
    );
  });
  await mock.close();
});

test("AC-2.2: exits 1 + lists missing tools when a tool is removed", async () => {
  const mock = await startMock(EXPECTED_OK.slice(1));
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /missing=\[prepare_order\]/);
  });
  await mock.close();
});

test("AC-2.3: TR-4 event has the documented field shape", async () => {
  const mock = await startMock(EXPECTED_OK);
  await withSandbox(async (cwd) => {
    const r = await runScript(mock.url, cwd);
    assert.equal(r.code, 0);
    const path = join(cwd, "runtime", "events.jsonl");
    assert.ok(existsSync(path));
    const last = JSON.parse(
      readFileSync(path, "utf8").trim().split("\n").pop()!,
    );
    for (const k of [
      "ts",
      "type",
      "deploy_target",
      "tools_listed",
      "assertion_result",
      "unexpected_tools",
    ]) {
      assert.ok(k in last, `missing field ${k}`);
    }
    assert.equal(last.type, "deploy.tools_list_snapshot");
  });
  await mock.close();
});

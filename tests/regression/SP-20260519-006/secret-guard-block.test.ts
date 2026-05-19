/**
 * tests/regression/SP-20260519-006/secret-guard-block.test.ts — S-16 / AC-16.*.
 *
 * Drives scripts/hooks/secret-guard.js as a subprocess with synthetic
 * PreToolUse Edit events. Verifies:
 *   AC-16.1: an Edit with card-number content targeting src/ is blocked.
 *   AC-16.2: the same content targeting tests/regression/SP-20260519-006/
 *            is ALLOWED (allowedPaths).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const HOOK = join(process.cwd(), "scripts", "hooks", "secret-guard.js");

// Constructed from parts so this source file itself doesn't trip the hook.
const SYNTHETIC_CARD = ["4111", "1111", "1111", "1111"].join("-");

type Outcome = { code: number; stdout: string; stderr: string };

function runHook(filePath: string, newString: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    const event = {
      tool_input: {
        file_path: filePath,
        new_string: newString,
      },
    };
    child.stdin.write(JSON.stringify(event));
    child.stdin.end();
  });
}

test("AC-16.1: card-number content targeting src/ is BLOCKED", async () => {
  const target = join(process.cwd(), "src", "server.ts");
  const content = `const example = "card ${SYNTHETIC_CARD}";`;
  const r = await runHook(target, content);
  assert.equal(
    r.code,
    2,
    `expected blocked (exit 2), got ${r.code}: ${r.stderr}`,
  );
  assert.match(r.stderr, /Card-number-like/);
});

test("AC-16.2: card-number content in tests/regression/SP-20260519-006/ is ALLOWED", async () => {
  const target = join(
    process.cwd(),
    "tests",
    "regression",
    "SP-20260519-006",
    "fixtures",
    "synthetic.txt",
  );
  const content = `card ${SYNTHETIC_CARD}`;
  const r = await runHook(target, content);
  assert.equal(
    r.code,
    0,
    `expected allowed (exit 0), got ${r.code}: ${r.stderr}`,
  );
});

test("AC-16.1: 16-digit contiguous card-number content is BLOCKED in src/", async () => {
  const target = join(process.cwd(), "src", "lib", "example.ts");
  const content = `const t = "${"4".repeat(16)}";`; // 16 contiguous 4s — matches \b\d{13,19}\b
  const r = await runHook(target, content);
  assert.equal(r.code, 2);
});

test("AC-16.2: 16-digit contiguous content in regression dir is ALLOWED", async () => {
  const target = join(
    process.cwd(),
    "tests",
    "regression",
    "SP-20260519-006",
    "fixtures",
    "synthetic.txt",
  );
  const content = `const t = "${"4".repeat(16)}";`;
  const r = await runHook(target, content);
  assert.equal(r.code, 0);
});

test("existing WARP_MCP_KEY pattern still fires (no regression on prior hook patterns)", async () => {
  const target = join(process.cwd(), "src", "example.ts");
  const content = `set "WARP_MCP_KEY=${"a".repeat(40)}"`;
  const r = await runHook(target, content);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /WARP_MCP_KEY/);
});

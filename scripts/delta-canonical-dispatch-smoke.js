#!/usr/bin/env node
/**
 * delta-canonical-dispatch-smoke.js — verify canonical cross-provider dispatch.
 *
 * For each provider in manifest.agentProviders, fire a tiny test prompt and
 * confirm the binary is reachable + returns a parseable response. On full pass,
 * write .claude/runtime/.canonical-dispatch-smoke-passed marker so the
 * orchestrator (Delta) knows it can dispatch reviewers via the canonical path
 * without first hitting an unverified-block assumption.
 *
 * Run BEFORE first reviewer dispatch in every oneshot run. Mirrors the
 * worktree-smoke pattern (scripts/hooks/worktree-preflight.js + the
 * .worktree-smoke-passed marker).
 *
 * Usage:
 *   node scripts/delta-canonical-dispatch-smoke.js
 *
 * Exit 0 = all providers responded; marker written.
 * Exit 1 = at least one provider failed; marker NOT written.
 *
 * The point is to LEARN whether the bash subprocess path actually works in
 * THIS environment, not to assume based on a prior retro's claim. Run-9 retro
 * Issue #5 said cross-provider was blocked; run-10 inherited that assumption
 * for ~6 hours of all-Claude reviews before testing — at which point both
 * codex and gemini worked fine via the wide Bash permission. Don't repeat.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, ".claude", "manifest.json");
const RUNTIME = path.join(ROOT, ".claude", "runtime");
const MARKER = path.join(RUNTIME, ".canonical-dispatch-smoke-passed");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function log(c, msg) {
  process.stdout.write(`${c}${msg}${RESET}\n`);
}

const TEST_PROMPT = "Reply with exactly one word: OK";
const TIMEOUT_MS = 60_000;

// Cross-platform invocation. On Windows the CLIs are .cmd shims so shell:true
// is needed. We pass the prompt via stdin where possible (most reliable) and
// only via argv when the CLI doesn't support stdin (claude -p needs argv).
function runShell(cmdline, input = "") {
  const r = spawnSync(cmdline, {
    input,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    shell: true,
  });
  return {
    exit: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

// Use a temp file for prompts to avoid shell-quoting hell across platforms.
const os = require("os");
function withTempPrompt(prompt, fn) {
  const tmp = path.join(
    os.tmpdir(),
    `delta-smoke-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );
  fs.writeFileSync(tmp, prompt);
  try {
    return fn(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ok */
    }
  }
}

const providers = {
  claude: {
    cmd: "claude",
    test() {
      // Verify (1) opus-4-7 model is reachable, (2) `--effort max` flag is
      // accepted (this is what builder dispatch uses). If the account doesn't
      // support opus-4-7 or the effort flag, smoke fails fast in Check I
      // before Delta dispatches any builder.
      return withTempPrompt(TEST_PROMPT, (tmp) => {
        const r = runShell(
          `claude -p --model claude-opus-4-7 --effort max "$(cat "${tmp}")"`,
        );
        return { ...r, ok: r.exit === 0 && /OK/i.test(r.stdout) };
      });
    },
  },
  openai: {
    cmd: "codex",
    test() {
      // codex exec --skip-git-repo-check reads stdin.
      // Use the SAME -m model that dispatch-agent.js will use at runtime
      // (read from OPENAI_FLAGSHIP_MODEL env, default gpt-5.4 since Codex CLI
      // 0.117 rejects gpt-5.5). Smoke must match real dispatch path —
      // run-12 BUG-076 caught with no -m flag; smoke passed but real
      // dispatch with -m gpt-5.5 failed mid-run. HYGIENE Rule 67.
      const model = process.env.OPENAI_FLAGSHIP_MODEL || "gpt-5.4";
      const r = runShell(
        `codex exec -c model_reasoning_effort=xhigh -m ${model} --skip-git-repo-check`,
        TEST_PROMPT,
      );
      return { ...r, ok: r.exit === 0 && /OK/i.test(r.stdout) };
    },
  },
  gemini: {
    cmd: "gemini",
    test() {
      // gemini reads stdin and APPENDS --prompt to it (per `gemini --help`).
      // Use the SAME -m model that dispatch-agent.js will use at runtime
      // (read from GEMINI_MODEL env, default gemini-3.1-pro-preview).
      // HYGIENE Rule 67.
      const model = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
      const r = runShell(`gemini -m ${model} --prompt ""`, TEST_PROMPT);
      return { ...r, ok: r.exit === 0 && /OK/i.test(r.stdout) };
    },
  },
};

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    log(RED, `[smoke] cannot read manifest: ${e.message}`);
    process.exit(1);
  }
}

function uniqueProviders(routing) {
  const set = new Set();
  for (const v of Object.values(routing)) set.add(v);
  return Array.from(set);
}

function main() {
  const manifest = loadManifest();
  const routing = manifest.agentProviders || {};
  const required = uniqueProviders(routing);
  if (required.length === 0) {
    log(YELLOW, "[smoke] manifest.agentProviders empty — nothing to test");
    process.exit(0);
  }

  log(
    DIM,
    `[smoke] testing ${required.length} provider(s) from manifest.agentProviders: ${required.join(", ")}`,
  );

  const results = {};
  let allOk = true;
  for (const p of required) {
    const def = providers[p];
    if (!def) {
      log(RED, `  ✗ ${p}  unknown provider — no smoke test defined`);
      results[p] = { ok: false, reason: "no smoke test defined" };
      allOk = false;
      continue;
    }
    process.stdout.write(`  · ${p.padEnd(8)} `);
    let r;
    try {
      r = def.test();
    } catch (e) {
      r = { exit: -1, stdout: "", stderr: e.message, ok: false };
    }
    if (r.ok) {
      log(
        GREEN,
        `✓  exit=${r.exit}  reply=${(r.stdout || "").trim().slice(0, 60)}`,
      );
      results[p] = { ok: true, exit: r.exit };
    } else {
      log(
        RED,
        `✗  exit=${r.exit}  stderr=${(r.stderr || "").slice(0, 200)}  stdout=${(r.stdout || "").slice(0, 100)}`,
      );
      results[p] = {
        ok: false,
        exit: r.exit,
        stderr: (r.stderr || "").slice(0, 500),
      };
      allOk = false;
    }
  }

  // Roles → provider map summary so the orchestrator knows what's available
  log(DIM, "");
  log(DIM, "[smoke] role → provider routing:");
  for (const [role, prov] of Object.entries(routing)) {
    const status = results[prov]?.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    log(DIM, `  ${role.padEnd(12)} → ${prov.padEnd(8)} ${status}`);
  }

  if (allOk) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(
      MARKER,
      JSON.stringify(
        {
          smokedAt: new Date().toISOString(),
          providers: results,
          routing,
        },
        null,
        2,
      ) + "\n",
    );
    log(GREEN, "");
    log(
      GREEN,
      `[smoke] PASS — marker written: ${MARKER.replace(ROOT + path.sep, "")}`,
    );
    log(
      DIM,
      "[smoke] orchestrator can now dispatch reviewers via canonical bash subprocess path.",
    );
    process.exit(0);
  } else {
    log(RED, "");
    log(RED, "[smoke] FAIL — at least one provider unreachable");
    log(
      DIM,
      "[smoke] options: (a) install missing CLI, (b) update manifest.agentProviders to point failing roles at claude as fallback, (c) accept reviewer-on-Claude deviation explicitly in retro",
    );
    process.exit(1);
  }
}

main();

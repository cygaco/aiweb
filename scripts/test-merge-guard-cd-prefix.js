#!/usr/bin/env node
// Smoke-test for merge-guard rule 8 (cd <projectDir> advisory).
// Rule is advisory: emits stderr warning + warn event, but does NOT block.
// Verify warning fires for redundant `cd <projectDir> && git ...` patterns,
// and does NOT fire for legitimate cd uses (subdirs, non-git tails).

const { spawnSync } = require("child_process");
const path = require("path");

const guard = path.join(__dirname, "hooks", "merge-guard.js");
const PROJECT = path.resolve(__dirname, "..");

function run(cmd) {
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: cmd },
  });
  const r = spawnSync(process.execPath, [guard], {
    input: event,
    encoding: "utf8",
    cwd: PROJECT,
  });
  let blocked = false;
  try {
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.decision === "block") {
        blocked = true;
        break;
      }
    }
  } catch {
    /* allow */
  }
  const stderr = r.stderr || "";
  const advised = /cd-prefix-advisory|Redundant `cd <projectDir>`/i.test(
    stderr,
  );
  return { blocked, advised, stderr };
}

const cases = [
  // SHOULD ADVISE (warn, not block)
  {
    cmd: `cd "${PROJECT}" && git status`,
    expect: { blocked: false, advised: true },
    name: "cd <PROJECT> && git status (the anti-pattern)",
  },
  {
    // Unquoted path with spaces is broken bash syntax — regex correctly
    // captures only the first non-space token. Real callers must quote
    // paths with spaces (covered by the quoted variant above).
    cmd: `cd ${PROJECT.replace(/ /g, "_")} && git log --oneline`,
    expect: { blocked: false, advised: false },
    name: "unquoted path WITHOUT spaces (no PROJECT match) → no advise",
  },
  {
    cmd: `cd . && git status`,
    expect: { blocked: false, advised: true },
    name: "cd . && git (the no-op cd)",
  },
  // SHOULD NOT ADVISE
  {
    cmd: `cd src && ls`,
    expect: { blocked: false, advised: false },
    name: "cd subdir && non-git tail",
  },
  {
    cmd: `cd ${PROJECT} && npm run build`,
    expect: { blocked: false, advised: false },
    name: "cd <PROJECT> && non-git tail (allowed, no warning)",
  },
  {
    cmd: `git status`,
    expect: { blocked: false, advised: false },
    name: "bare git command (no cd at all)",
  },
  {
    cmd: `cd /tmp && git status`,
    expect: { blocked: false, advised: false },
    name: "cd to unrelated dir + git (genuine context switch)",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = run(c.cmd);
  const ok = r.blocked === c.expect.blocked && r.advised === c.expect.advised;
  if (ok) {
    pass++;
    console.log(
      `  PASS  ${c.name}  (blocked=${r.blocked} advised=${r.advised})`,
    );
  } else {
    fail++;
    console.error(
      `  FAIL  ${c.name}  expected blocked=${c.expect.blocked}/advised=${c.expect.advised} actual blocked=${r.blocked}/advised=${r.advised}`,
    );
    if (r.stderr) console.error(`        stderr: ${r.stderr.slice(0, 200)}`);
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);

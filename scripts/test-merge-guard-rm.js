#!/usr/bin/env node
// Smoke-test for merge-guard rule 5 (rm on src/ or docs/).
// Verifies the per-segment scoping: rm in one segment + src/ in another
// does NOT trigger the block. BACKLOG.md issue #9.
//
// Each case echoes a fake hook event into the guard and asserts whether
// the JSON decision on stdout is "block" or absent (allow).

const { spawnSync } = require("child_process");
const path = require("path");

const guard = path.join(__dirname, "hooks", "merge-guard.js");

function run(cmd) {
  const event = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: cmd },
  });
  const r = spawnSync(process.execPath, [guard], {
    input: event,
    encoding: "utf8",
  });
  let decision = "allow";
  try {
    for (const line of (r.stdout || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.decision === "block") {
        decision = "block";
        break;
      }
    }
  } catch {
    /* no JSON output → allow */
  }
  return { decision, stderr: r.stderr || "" };
}

const cases = [
  // Should BLOCK
  { cmd: "rm src/foo.tsx", expect: "block", name: "raw rm on src/" },
  { cmd: "rm -rf docs/old", expect: "block", name: "raw rm -rf on docs/" },
  {
    cmd: "ls && rm src/x.ts",
    expect: "block",
    name: "rm src/ in second segment",
  },
  // Should ALLOW
  {
    cmd: "git rm src/foo.tsx",
    expect: "allow",
    name: "git rm on src/ (tracked)",
  },
  {
    cmd: "cd src/ && rm /tmp/file",
    expect: "allow",
    name: "rm /tmp + src/ in cd (overmatch fix)",
  },
  {
    cmd: "echo src/foo && rm /tmp/x",
    expect: "allow",
    name: "src/ in echo + rm /tmp",
  },
  { cmd: "rm /tmp/x", expect: "allow", name: "rm outside src/docs" },
  { cmd: "ls src/", expect: "allow", name: "no rm at all" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = run(c.cmd);
  const ok = r.decision === c.expect;
  if (ok) {
    pass++;
    console.log(`  PASS  ${c.name}  (${r.decision})`);
  } else {
    fail++;
    console.error(
      `  FAIL  ${c.name}  expected=${c.expect} actual=${r.decision}`,
    );
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);

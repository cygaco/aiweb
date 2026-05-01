#!/usr/bin/env node
// Stop hook (HYGIENE Rule 64 — retro-completeness). If a session is ending on
// a skeleton-test<N> branch AND retros/<N>/RETRO.md does not exist, surface
// the gap.
//
// Two modes:
//   - default (advisory): exits 0 with a stderr warning. 26% historical
//     miss rate (run-9 cross-session inbox: moc2ua2s, mocaecxt, mocd8rff).
//   - enforced: pass `--enforce` argv OR set RETRO_ENFORCE=1 in env. Exits 2
//     and blocks session close until /oneshot:retro is run. Flip the default
//     to enforce after one clean session passes through it.
//
// Runs as a Stop hook BEFORE session-stop.js so the warning is visible in
// the same shutdown emit.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    // Resolve retros dir via paths.json (oneshotRetros key added run-9 fix pass)
    let retrosDir;
    try {
      const paths = JSON.parse(
        fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
      );
      retrosDir = path.join(PROJECT, paths.oneshotRetros);
    } catch {
      retrosDir = path.join(
        PROJECT,
        ".claude",
        "agents",
        "02-oneshot",
        ".system",
        "retros",
      );
    }

    let branch = "";
    try {
      branch = execSync("git branch --show-current", {
        cwd: PROJECT,
        encoding: "utf8",
      }).trim();
    } catch {
      process.exit(0);
    }
    const m = branch.match(/^skeleton-test(\d+)$/);
    if (!m) {
      // Not on a skeleton branch — no retro obligation
      process.exit(0);
    }
    const runN = m[1];
    const retroDir = path.join(retrosDir, runN);
    const retroFile = path.join(retroDir, "RETRO.md");

    if (!fs.existsSync(retroFile)) {
      const enforce =
        process.argv.includes("--enforce") ||
        process.env.RETRO_ENFORCE === "1" ||
        process.env.RETRO_ENFORCE === "true";

      const header = enforce
        ? `[retro-presence-check] BLOCKED (Rule 64 enforced): session ending on ${branch} but ${retroDir}/RETRO.md does not exist.`
        : `[retro-presence-check] WARNING (Rule 64 advisory): session ending on ${branch} but ${retroDir}/RETRO.md does not exist.`;

      process.stderr.write(
        `\n${header}\n` +
          `  Run /oneshot:retro to capture this session's learnings before the branch is gutted.\n` +
          `  26% retro-miss rate historically (run-9 cross-session inbox); ${enforce ? "enforce mode prevents the gap" : "this warning is the mitigation"}.\n\n`,
      );

      if (enforce) process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
});

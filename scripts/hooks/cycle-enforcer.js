#!/usr/bin/env node
// PreToolUse hook: enforces the 11-step cycle from AGENT-SYSTEM.md section 2.
//
// Tracks cycle progress in store.json heartbeat. Blocks out-of-order steps.
// This hook runs on Agent tool calls and checks what step we're on.
//
// The 11-step cycle:
//   1. Dispatch builders
//   2. Builders commit (tracked by builder agents, not this hook)
//   3. Snapshot files
//   4. Fan-out: evaluator + compliance + security (parallel)
//   5. Fix agents (if failures)
//   6. Targeted re-review (if fixes applied)
//   7. Calculate points
//   8-10. Lead agent
//   11. Next cycle
//
// This hook enforces:
// - Can't dispatch builders for next phase if current phase hasn't completed steps 3-10
// - Can't skip from step 4 (reviewers) to step 11 (next cycle) without steps 7-10
//
// It reads store.heartbeat.cycleStep to determine current position.

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    if (event.tool_name !== "Agent") {
      process.exit(0);
    }

    const prompt = event.tool_input?.prompt || "";
    // Resolve store path from paths.json
    let agentsDir;
    try {
      const { PATHS: _P } = require("./lib/paths");
      agentsDir = _P.agents;
    } catch {
      /* fallback below */
    }
    const storePath = agentsDir
      ? path.join(agentsDir, "store.json")
      : path.resolve(__dirname, "..", "..", ".claude", "agents", "store.json");

    if (!fs.existsSync(storePath)) {
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    const cycleStep = store.heartbeat?.cycleStep || null;

    // Detect what kind of agent is being dispatched
    const isBuilder =
      /^feature:\s*\S+/m.test(prompt) &&
      !/evaluator|security|compliance|fix agent|auditor/i.test(
        prompt.substring(0, 500),
      );
    const isEvaluator = /evaluator/i.test(prompt.substring(0, 500));
    const isSecurity = /security/i.test(prompt.substring(0, 500));
    const isLead = /auditor agent/i.test(prompt.substring(0, 500));
    const isFixAgent = /fix agent/i.test(prompt.substring(0, 500));

    // Enforcement rules:

    // Rule 0 (BUG-044 fix): FAIL-CLOSED when cycleStep is null.
    // If ANY feature has status "done" in the store, a prior phase completed.
    // The Boss MUST have set cycleStep through the progression. If cycleStep
    // is null at this point, the Boss skipped the cycle machinery entirely.
    // Block builder dispatches until cycleStep is explicitly set.
    if (!cycleStep) {
      const features = store.features || {};
      const anyWorked = Object.values(features).some(
        (f) => f.status && f.status !== "not_started",
      );
      if (anyWorked) {
        const blockMsg =
          `heartbeat.cycleStep is null but features have work in progress. ` +
          `The Boss must set cycleStep through the full progression: ` +
          `building → builders-merged → reviewing → review-complete → fixing → ` +
          `points-done → auditor → cycle-complete. ` +
          `Set heartbeat.cycleStep before dispatching any agents.`;
        process.stderr.write(`[cycle-enforcer] BLOCKED: ${blockMsg}\n`);
        logEvent(
          "block",
          "system",
          "cycle-enforcer-null-step",
          "",
          blockMsg.slice(0, 200),
        );
        process.exit(2);
      }
    }

    // Rule 1: Can't dispatch a new builder if cycleStep is "reviewing" or "fixing"
    // (means we're mid-gauntlet and haven't finished the cycle)
    if (
      isBuilder &&
      cycleStep &&
      ["reviewing", "fixing", "points", "auditor"].includes(cycleStep)
    ) {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch builder during cycle step "${cycleStep}". ` +
          `Complete the current cycle (points → auditor → commit) before starting new builders.\n`,
      );
      process.exit(2);
    }

    // Rule 2: Can't dispatch Lead if cycleStep is not "points-done"
    // (means reviewers haven't finished and points haven't been calculated)
    if (isLead && cycleStep && cycleStep !== "points-done") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch Lead agent during cycle step "${cycleStep}". ` +
          `Points must be calculated first (step 7). Set heartbeat.cycleStep to "points-done".\n`,
      );
      process.exit(2);
    }

    // Rule 3: If heartbeat says "builders-merged" and agent is not a reviewer/fix/auditor,
    // block — we need to run the gauntlet before anything else
    if (isBuilder && cycleStep === "builders-merged") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Builders are merged but gauntlet hasn't run. ` +
          `Dispatch evaluator + security + compliance first (step 4).\n`,
      );
      process.exit(2);
    }

    // Rule 5: Fix agents BLOCKED during "reviewing" — must wait for ALL reviewers.
    // The spec requires: fan-out eval + security + compliance → collect ALL results →
    // THEN merge into unified fix brief → dispatch fix agent.
    // cycleStep must be "review-complete" or "fixing" before fix agents can run.
    // "reviewing" = reviewers still running, "review-complete" = all 3 done.
    if (isFixAgent && cycleStep === "reviewing") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch fix agent — reviewers still running. ` +
          `Wait for ALL THREE reviewers (evaluator + security + compliance) to complete. ` +
          `Set heartbeat.cycleStep to "review-complete" after collecting all results, ` +
          `then dispatch fix agents.\n`,
      );
      process.exit(2);
    }

    // Rule 4: Can't dispatch builders for next phase if Lead hasn't run.
    // "points-done" means points calculated but Lead not yet dispatched.
    // "cycle-complete" means Lead finished — only then can next phase start.
    // This forces the Boss to actually run the Lead instead of skipping steps 8-10.
    if (isBuilder && cycleStep === "points-done") {
      process.stderr.write(
        `[cycle-enforcer] BLOCKED: Cannot dispatch builders — Lead agent hasn't run yet. ` +
          `Points are done (step 7) but the Lead must analyze patterns and adjust ` +
          `environment (steps 8-10) before the next phase. Dispatch the Lead agent, ` +
          `then set heartbeat.cycleStep to "cycle-complete".\n`,
      );
      process.exit(2);
    }

    logEvent(
      "decision",
      "system",
      "cycle-enforcer-passed",
      "",
      `cycleStep=${cycleStep}`,
    );
    process.exit(0);
  } catch (err) {
    const errMsg = `cycle-enforcer parse error (fail-closed): ${err.message}`;
    process.stderr.write(`[cycle-enforcer] BLOCKED: ${errMsg}\n`);
    logEvent(
      "block",
      "system",
      "cycle-enforcer-error",
      "",
      errMsg.slice(0, 200),
    );
    process.exit(2);
  }
});

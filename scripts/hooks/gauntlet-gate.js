#!/usr/bin/env node
// PreToolUse hook: blocks phase advancement if the previous phase
// hasn't passed the gauntlet (no GATE_CHECK in store.json runLog).
//
// Triggered on: Agent tool calls
// Matcher: Agent (in settings.json PreToolUse hooks)
//
// How it works:
// 1. Reads the Agent tool's prompt for a "feature: <name>" declaration
// 2. Looks up that feature's dependencies in TASK-MANIFEST
// 3. Checks store.json runLog for GATE_CHECK entries covering those deps
// 4. If any dependency lacks a GATE_CHECK, blocks the dispatch
//
// This prevents the orchestrator from skipping the gauntlet by mechanically
// refusing to dispatch builders whose dependencies haven't been reviewed.

const fs = require("fs");
const path = require("path");
const { logEvent } = require("./lib/logger");
const { getDeps } = require("./lib/project-config");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    // Only check Agent tool calls
    if (event.tool_name !== "Agent") {
      process.exit(0);
    }

    const prompt = event.tool_input?.prompt || "";

    // Extract feature declaration from prompt
    const featureMatch = prompt.match(/^feature:\s*(\S+)/m);
    if (!featureMatch) {
      // No feature declaration — could be evaluator, security, test agent, etc.
      // Don't block non-builder dispatches
      process.exit(0);
    }

    const feature = featureMatch[1];

    // Skip review/evaluator/redteam/compliance/qa agents — they don't need gate checks.
    // Matches Batch A rename (2026-04-17): security→redteam, fix agent→fixer.
    // Legacy names (security, fix agent) kept for backwards-compat with older prompts.
    if (
      /evaluator|redteam|security|compliance|fixer|fix agent|auditor|test|qa.*scan|qa.*analy|qa.*orchestrat/i.test(
        prompt.substring(0, 500),
      )
    ) {
      process.exit(0);
    }

    // Load dependency map from project config (no hardcoded feature names)
    const DEPS = getDeps();

    const deps = DEPS[feature];
    if (!deps || deps.length === 0) {
      // No dependencies or unknown feature — allow
      process.exit(0);
    }

    // Read the oneshot store — resolve via paths.json (paths.oneshotStore).
    // The root .claude/agents/store.json is a foundation-edit heartbeat marker,
    // NOT the feature/runLog state. Registry-based resolution prevents path drift.
    let storePath;
    try {
      const { PATHS: _P } = require("./lib/paths");
      storePath = _P.oneshotStore;
    } catch {
      storePath = path.resolve(
        __dirname,
        "..",
        "..",
        ".claude",
        "agents",
        "02-oneshot",
        ".system",
        "store.json",
      );
    }

    if (!fs.existsSync(storePath)) {
      // No store — can't verify, allow with warning
      process.stderr.write(
        "[gauntlet-gate] WARN: store.json not found, allowing dispatch\n",
      );
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    // Canonical shape: runLog = { entries: [...] }. Accept legacy
    // array-only form (older stores) so this hook doesn't fail-closed
    // on schema drift. QA audit post-run-9-fix-pass cleanup.
    const runLog = Array.isArray(store.runLog)
      ? store.runLog
      : store.runLog?.entries || [];

    // Collect all features that have passed a GATE_CHECK
    const gatedFeatures = new Set();
    for (const entry of runLog) {
      if (entry.type === "GATE_CHECK" && entry.features) {
        for (const f of entry.features) {
          gatedFeatures.add(f);
        }
      }
    }

    // Also check feature status — "done" means it passed gates
    // "skipped" means deliberately deferred — treat as gated with no review required
    // BUT only if the GATE_CHECK has all 3 reviewers (eval + security + compliance)
    // BUG-044 fix: previously "done" was accepted without verifying compliance ran
    for (const [name, data] of Object.entries(store.features || {})) {
      if (data.status === "skipped") {
        gatedFeatures.add(name);
        continue;
      }
      if (data.status === "done") {
        // Check if this feature has a GATE_CHECK with all 3 reviewers
        const gateEntry = runLog.find(
          (e) => e.type === "GATE_CHECK" && e.feature === name,
        );
        if (gateEntry) {
          // Status validation: only "done" or "impossible-{reason}" are accepted.
          // "done" means the reviewer ran and the feature passed (with or without fixes).
          // "impossible-{reason}" means the reviewer CANNOT run (e.g., tool doesn't exist).
          // Anything else (pending, skipped, fail, running, codex-pending) = BLOCK.
          function isDoneOrImpossible(val) {
            if (!val || typeof val !== "string") return false;
            const v = val.toLowerCase();
            // Accept: pass*, done*, impossible-*
            return (
              v.startsWith("pass") ||
              v.startsWith("done") ||
              v.startsWith("impossible")
            );
          }

          // Reviewer field renamed 2026-04-29 (was `evaluator`); accept either.
          const reviewerVerdict = gateEntry.reviewer || gateEntry.evaluator;
          const hasEval = isDoneOrImpossible(reviewerVerdict);
          const hasSecurity = isDoneOrImpossible(gateEntry.security);
          const hasCompliance = isDoneOrImpossible(gateEntry.compliance);
          const hasQA = isDoneOrImpossible(gateEntry.qa);
          // Foundation features are exempt from compliance and QA (pre-existing code)
          const isFoundation = name.startsWith("foundation-");
          if (
            isFoundation ||
            (hasEval && hasSecurity && hasCompliance && hasQA)
          ) {
            gatedFeatures.add(name);
          } else {
            const missing = [];
            if (!hasEval)
              missing.push(
                `reviewer (got: ${JSON.stringify(reviewerVerdict)})`,
              );
            if (!hasSecurity)
              missing.push(
                `security (got: ${JSON.stringify(gateEntry.security)})`,
              );
            if (!hasCompliance)
              missing.push(
                `compliance (got: ${JSON.stringify(gateEntry.compliance)})`,
              );
            if (!hasQA)
              missing.push(`qa (got: ${JSON.stringify(gateEntry.qa)})`);
            const blockMsg =
              `[gauntlet-gate] BLOCKED: Feature "${name}" GATE_CHECK not complete: ${missing.join(", ")}. ` +
              `Each reviewer must be "pass-*", "done-*", or "impossible-{reason}". ` +
              `"skipped", "pending", "fail" are NOT accepted.`;
            process.stderr.write(blockMsg + "\n");
            logEvent(
              "block",
              "system",
              "gauntlet-gate-incomplete",
              name,
              blockMsg.slice(0, 200),
            );
            process.exit(2); // HARD BLOCK — compliance missing = no pass
          }
        } else {
          // No GATE_CHECK entry at all — still allow if status is "done"
          gatedFeatures.add(name);
        }
      }
    }

    // Check if all dependencies have passed gates
    const missing = deps.filter((d) => !gatedFeatures.has(d));

    if (missing.length > 0) {
      const blockMsg = `Cannot dispatch builder for "${feature}". Dependencies missing GATE_CHECK: ${missing.join(", ")}`;
      process.stderr.write(`[gauntlet-gate] BLOCKED: ${blockMsg}\n`);
      logEvent(
        "block",
        "system",
        "gauntlet-gate-deps",
        feature,
        blockMsg.slice(0, 200),
      );
      process.exit(2); // Blocking error
    }

    // All deps gated — allow dispatch
    logEvent(
      "decision",
      "system",
      "gauntlet-gate-passed",
      feature,
      `deps satisfied: ${deps.join(", ")}`,
    );
    process.exit(0);
  } catch (err) {
    // Fail-closed: infrastructure errors block dispatch
    const errMsg = `gauntlet-gate parse error (fail-closed): ${err.message}`;
    process.stderr.write(`[gauntlet-gate] BLOCKED: ${errMsg}\n`);
    logEvent(
      "block",
      "system",
      "gauntlet-gate-error",
      "",
      errMsg.slice(0, 200),
    );
    process.exit(2);
  }
});

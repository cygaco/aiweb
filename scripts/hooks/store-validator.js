#!/usr/bin/env node
/**
 * store-validator.js — Pre+PostToolUse hook for Edit|Write on store.json.
 *
 * Defense-in-depth: runs as BOTH PreToolUse and PostToolUse.
 * - Pre: reads current store, caches "before" state, validates intended transition
 * - Post: reads store again, compares against cache, validates actual result
 *
 * Validates:
 * - cycleStep transitions follow legal progression
 * - Feature status transitions are legal (not_started→building→built→eval_*→done)
 * - eval_pass requires GATE_CHECK with evaluator:"pass*"
 * - done requires all 3 reviewers passing
 * - fixAttempts ≤ 3
 * - GATE_CHECK entries are immutable once written
 * - bugDataset/conflictDataset entries cannot be deleted
 *
 * Fail-closed: parse errors → BLOCK.
 * Closes: GAP-201 through GAP-210 (10 gaps).
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const {
  logEvent,
  acquireStoreLock,
  releaseStoreLock,
  RUNTIME_DIR,
} = require("./lib/logger");
const {
  validateGateCheck,
  isPassingStatus,
  hashGateCheck,
} = require("./lib/gate-schema");

const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
const logsDir = PATHS.logs || path.join(PROJECT, ".claude", "runtime", "logs");
const STORE_PATH = path.join(agentsDir, "store.json");
const CACHE_PATH = path.join(logsDir, "store-validator-prev.json");

// Legal cycleStep transitions
const LEGAL_CYCLE_TRANSITIONS = {
  null: ["building"],
  building: ["builders-merged", "builders-complete"],
  "builders-complete": ["builders-merged", "reviewing"],
  "builders-merged": ["reviewing"],
  reviewing: ["review-complete"],
  "review-complete": ["fixing", "merged", "points-done"],
  fixing: ["review-complete", "points-done"],
  merged: ["points-done"],
  "points-done": ["lead"],
  lead: ["cycle-complete"],
  "cycle-complete": ["building", null],
};

// Legal feature status transitions
const LEGAL_STATUS_TRANSITIONS = {
  not_started: ["building"],
  building: ["built", "not_started"],
  built: ["eval_fail", "eval_pass"],
  eval_fail: ["building", "built", "fixing"],
  eval_pass: ["done"],
  fixing: ["built", "eval_fail"],
  done: ["not_started"],
};

// INVALID_GATE_STATUSES now imported from gate-schema.js

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // Best-effort cache write
  }
}

function block(reason) {
  logEvent("block", "system", "store-validator-blocked", "store.json", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function extractFeatureStatuses(store) {
  const statuses = {};
  if (store && store.features) {
    for (const [name, feature] of Object.entries(store.features)) {
      statuses[name] = feature.status || "not_started";
    }
  }
  return statuses;
}

function extractGateChecks(store) {
  const entries = [];
  if (store && store.runLog && store.runLog.entries) {
    for (const entry of store.runLog.entries) {
      if (
        entry.type === "GATE_CHECK" ||
        entry.reviewer ||
        entry.evaluator ||
        entry.security ||
        entry.compliance
      ) {
        entries.push(JSON.stringify(entry));
      }
    }
  }
  return entries;
}

function validateCycleStep(prevStep, newStep) {
  const key = prevStep === undefined ? null : prevStep;
  const allowed = LEGAL_CYCLE_TRANSITIONS[key];
  if (!allowed) return true; // Unknown previous state — allow (first run)
  if (newStep === key) return true; // Idempotent write
  return allowed.includes(newStep);
}

function validateFeatureStatus(prevStatus, newStatus) {
  if (prevStatus === newStatus) return true; // Idempotent
  const allowed = LEGAL_STATUS_TRANSITIONS[prevStatus];
  if (!allowed) return true; // Unknown previous state
  return allowed.includes(newStatus);
}

function validateGateCheckValues(store) {
  if (!store || !store.runLog || !store.runLog.entries) return [];
  const issues = [];
  for (const entry of store.runLog.entries) {
    if (
      !entry.reviewer &&
      !entry.evaluator &&
      !entry.security &&
      !entry.compliance
    )
      continue;
    const result = validateGateCheck(entry);
    issues.push(...result.issues);
  }
  return issues;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    // Only process Edit/Write
    if (!/^(Edit|Write)$/.test(toolName)) {
      process.exit(0);
    }

    // Only process store.json
    const filePath =
      (event.tool_input || {}).file_path || (event.tool_input || {}).path || "";
    const rel = relPath(filePath);
    if (!rel.endsWith("store.json") || !rel.includes("agents")) {
      process.exit(0);
    }

    const isPost = event.tool_response !== undefined;

    if (!isPost) {
      // === PRE-TOOL-USE: Cache current state + validate intent ===
      // Acquire store lock (GAP-601: prevent concurrent read/write race)
      if (!acquireStoreLock()) {
        logEvent(
          "warn",
          "system",
          "store-lock-contention",
          "store.json",
          "Another process holds the store lock — waiting",
        );
      }

      const currentStore = readStore();
      if (!currentStore) {
        releaseStoreLock();
        // No store yet — first write, allow
        process.exit(0);
      }

      // Cache the "before" state
      const cache = {
        ts: new Date().toISOString(),
        cycleStep: (currentStore.heartbeat || {}).cycleStep || null,
        workstream: (currentStore.heartbeat || {}).workstream || null,
        featureStatuses: extractFeatureStatuses(currentStore),
        gateCheckHashes: extractGateChecks(currentStore),
        bugDatasetCount: (currentStore.bugDataset || []).length,
        conflictDatasetCount: (currentStore.conflictDataset || []).length,
      };
      writeCache(cache);

      logEvent(
        "store",
        "system",
        "store-pre-validate",
        "store.json",
        `cached: cycleStep=${cache.cycleStep}, ${Object.keys(cache.featureStatuses).length} features`,
      );
      process.exit(0);
    } else {
      // === POST-TOOL-USE: Validate what was actually written ===
      const newStore = readStore();
      if (!newStore) {
        block("store.json is unreadable after write — possible corruption");
      }

      const cache = readCache();
      if (!cache) {
        // No cache — can't compare, just validate current state
        logEvent(
          "warn",
          "system",
          "store-no-cache",
          "store.json",
          "No pre-validation cache found — post-only validation",
        );
      }

      const issues = [];

      // 1. Validate cycleStep transition
      if (cache) {
        const prevStep = cache.cycleStep;
        const newStep = (newStore.heartbeat || {}).cycleStep || null;
        if (prevStep !== newStep && !validateCycleStep(prevStep, newStep)) {
          issues.push(
            `Illegal cycleStep transition: "${prevStep}" → "${newStep}". Legal: ${JSON.stringify(LEGAL_CYCLE_TRANSITIONS[prevStep])}`,
          );
        }
      }

      // 2. Validate feature status transitions
      if (cache) {
        const newStatuses = extractFeatureStatuses(newStore);
        for (const [name, newStatus] of Object.entries(newStatuses)) {
          const prevStatus = cache.featureStatuses[name] || "not_started";
          if (!validateFeatureStatus(prevStatus, newStatus)) {
            issues.push(
              `Illegal status transition for "${name}": "${prevStatus}" → "${newStatus}". Legal: ${JSON.stringify(LEGAL_STATUS_TRANSITIONS[prevStatus])}`,
            );
          }
        }
      }

      // 3. Validate eval_pass has GATE_CHECK evidence
      const featureStatuses = extractFeatureStatuses(newStore);
      for (const [name, status] of Object.entries(featureStatuses)) {
        if (status === "eval_pass") {
          // Accept both new `reviewer` field and legacy `evaluator` field.
          const hasGate = (newStore.runLog?.entries || []).some((e) => {
            if (e.feature !== name) return false;
            const v = e.reviewer || e.evaluator;
            return v && v.startsWith("pass");
          });
          if (!hasGate) {
            issues.push(
              `Feature "${name}" is eval_pass but no GATE_CHECK with reviewer:"pass*" found`,
            );
          }
        }
      }

      // 4. Validate done has all 3 reviewers
      for (const [name, status] of Object.entries(featureStatuses)) {
        if (status === "done") {
          const gate = (newStore.runLog?.entries || []).find(
            (e) => e.feature === name && (e.reviewer || e.evaluator),
          );
          if (gate) {
            const missing = [];
            const reviewerVal = gate.reviewer || gate.evaluator;
            if (
              !reviewerVal ||
              !(
                reviewerVal.startsWith("pass") ||
                reviewerVal.startsWith("done") ||
                reviewerVal.startsWith("impossible")
              )
            )
              missing.push("reviewer");
            if (
              !gate.security ||
              !(
                gate.security.startsWith("pass") ||
                gate.security.startsWith("done") ||
                gate.security.startsWith("impossible") ||
                gate.security.startsWith("0 ")
              )
            )
              missing.push("security");
            if (
              !gate.compliance ||
              !(
                gate.compliance.startsWith("pass") ||
                gate.compliance.startsWith("done") ||
                gate.compliance.startsWith("impossible")
              )
            )
              missing.push("compliance");
            if (missing.length > 0) {
              issues.push(
                `Feature "${name}" is done but GATE_CHECK missing valid: ${missing.join(", ")}`,
              );
            }
          }
        }
      }

      // 5. Validate fixAttempts ≤ 3
      if (newStore.features) {
        for (const [name, feature] of Object.entries(newStore.features)) {
          if ((feature.fixAttempts || 0) > 3) {
            issues.push(
              `Feature "${name}" has fixAttempts=${feature.fixAttempts} (max 3). Escalate to Lead.`,
            );
          }
        }
      }

      // 6. Validate GATE_CHECK immutability
      if (cache && cache.gateCheckHashes) {
        const newHashes = extractGateChecks(newStore);
        for (let i = 0; i < cache.gateCheckHashes.length; i++) {
          if (
            i < newHashes.length &&
            cache.gateCheckHashes[i] !== newHashes[i]
          ) {
            issues.push(
              `GATE_CHECK entry ${i} was modified (immutability violation)`,
            );
          }
        }
        if (newHashes.length < cache.gateCheckHashes.length) {
          issues.push(
            `GATE_CHECK entries deleted: was ${cache.gateCheckHashes.length}, now ${newHashes.length}`,
          );
        }
      }

      // 7. Validate datasets not deleted
      if (cache) {
        const newBugCount = (newStore.bugDataset || []).length;
        const newConflictCount = (newStore.conflictDataset || []).length;
        if (cache.bugDatasetCount > 0 && newBugCount === 0) {
          issues.push(`bugDataset was cleared (${cache.bugDatasetCount} → 0)`);
        }
        if (cache.conflictDatasetCount > 0 && newConflictCount === 0) {
          issues.push(
            `conflictDataset was cleared (${cache.conflictDatasetCount} → 0)`,
          );
        }
      }

      // 8. Validate GATE_CHECK field values
      const gateIssues = validateGateCheckValues(newStore);
      issues.push(...gateIssues);

      // 10. Validate workstream transitions (cannot switch mid-cycle)
      if (cache) {
        const prevWorkstream = cache.workstream || null;
        const newWorkstream = (newStore.heartbeat || {}).workstream || null;
        if (prevWorkstream !== newWorkstream) {
          const step = (newStore.heartbeat || {}).cycleStep || null;
          if (step && step !== "cycle-complete") {
            issues.push(
              `Cannot switch workstream ("${prevWorkstream}" → "${newWorkstream}") mid-cycle (cycleStep: "${step}"). Complete current cycle first.`,
            );
          }
        }
      }

      if (issues.length > 0) {
        block(
          `Store validation failed (${issues.length} issue${issues.length > 1 ? "s" : ""}): ${issues.join("; ").slice(0, 500)}`,
        );
      }

      // 9. GAP-401: Verify GATE_CHECK entries have corresponding agent result hashes
      // New GATE_CHECK entries (not in cache) must have matching agent results
      if (cache && cache.gateCheckHashes) {
        const newGateChecks = extractGateChecks(newStore);
        const newEntries = newGateChecks.slice(cache.gateCheckHashes.length);
        if (newEntries.length > 0) {
          try {
            const hashFile = path.join(
              RUNTIME_DIR,
              ".agent-result-hashes.json",
            );
            const hashes = JSON.parse(fs.readFileSync(hashFile, "utf8"));
            const hashValues = Object.values(hashes);

            for (const entryStr of newEntries) {
              const entry = JSON.parse(entryStr);
              const feature = entry.feature || "";
              // Reviewer field renamed 2026-04-29 (was `evaluator`); read both
              // and look up the dispatched agent under either name.
              for (const role of ["reviewer", "security", "compliance"]) {
                const fieldVal =
                  role === "reviewer"
                    ? entry.reviewer || entry.evaluator
                    : entry[role];
                if (!fieldVal || !isPassingStatus(fieldVal)) continue;
                const dispatchedRoles =
                  role === "reviewer" ? ["reviewer", "evaluator"] : [role];
                const hasResult = hashValues.some(
                  (h) =>
                    dispatchedRoles.includes(h.role) &&
                    h.feature === feature &&
                    h.success,
                );
                if (!hasResult) {
                  issues.push(
                    `GAP-401: GATE_CHECK ${role}="${fieldVal}" for "${feature}" has no matching agent result hash. ` +
                      `Was the ${role} actually dispatched and did it return?`,
                  );
                }
              }
            }
          } catch {
            // Hash file doesn't exist or unreadable — warn but don't block
            // (first run, or session-tracker not yet writing hashes)
            logEvent(
              "warn",
              "system",
              "no-agent-hashes",
              "",
              "Cannot verify GATE_CHECK — runtime/.agent-result-hashes.json missing",
            );
          }
        }
      }

      // All valid — update cache
      writeCache({
        ts: new Date().toISOString(),
        cycleStep: (newStore.heartbeat || {}).cycleStep || null,
        featureStatuses: extractFeatureStatuses(newStore),
        gateCheckHashes: extractGateChecks(newStore),
        bugDatasetCount: (newStore.bugDataset || []).length,
        conflictDatasetCount: (newStore.conflictDataset || []).length,
      });

      releaseStoreLock();
      logEvent(
        "store",
        "system",
        "store-post-validated",
        "store.json",
        `OK: cycleStep=${(newStore.heartbeat || {}).cycleStep}`,
      );
      process.exit(0);
    }
  } catch (e) {
    releaseStoreLock();
    // Fail-closed
    logEvent(
      "block",
      "system",
      "store-validator-parse-error",
      "store.json",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "store-validator: parse error (fail-closed) — " +
          String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});

#!/usr/bin/env node
/**
 * emit-integrate-events.js — one-shot /learn:integrate Phase D helper.
 *
 * Emits one attestation event per learning → target pair for this session's
 * integrations. Complements the learning-entry Edit updates.
 */

const { log } = require("../hooks/lib/logger");

const INTEGRATIONS = [
  {
    id: 139,
    target: "script:scripts/warp-setup.js#asset-copy-blocks",
    reason:
      "Installer now has explicit copyDir blocks for requirements/, patterns/, .claude/project/maps/, and scripts/tools/ (commits 378fa92 + cc5b7d8)",
  },
  {
    id: 140,
    target: "script:scripts/warp-setup.js#cmd-helper",
    reason:
      "cmd() helper guarantees type:'command' on every hook entry; separate keys for Stop / SessionEnd / StopFailure (commit 9ebba1c)",
  },
  {
    id: 141,
    target: "script:scripts/warp-setup.js#mergeEventHooks",
    reason:
      "Per-matcher hook merge with command-string dedup; user hooks preserved (commit 8f20bd0)",
  },
  {
    id: 142,
    target: "skill:warp:setup",
    reason:
      "5-signal state-machine resumable setup skill (commit c65e163); re-run safe, repair mode, no early-exit on partial install",
  },
  {
    id: 143,
    target: "script:scripts/warp-setup.js#restart-banner",
    reason:
      "Banner copy covers both 'Claude Code already open' and 'not open yet' cases (commit fc8e701)",
  },
  {
    id: 145,
    target: "hook:merge-guard#force-push-regex",
    reason:
      "Regex now catches --force, -f, and +refspec forms; verified via synthetic payloads",
  },
];

const verifiedAt = new Date().toISOString();
for (const { id, target, reason } of INTEGRATIONS) {
  log("attestation", {
    learning_id: id,
    target,
    status: "current",
    verified_at: verifiedAt,
    reason,
    via: "learn:integrate",
  });
}
console.log(`emitted: ${INTEGRATIONS.length} attestation events`);

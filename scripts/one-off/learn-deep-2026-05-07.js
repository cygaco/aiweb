// One-off: /learn:deep Phase A extraction + A.2 status audit for the YC sprint session.
// Run as: node scripts/one-off/learn-deep-2026-05-07.js
//
// Phase A: append 7 new high-value learnings from this session.
// Phase A.2: bump score on 4 existing learnings actively informed-used this session.
// Phase A.3: validate (logged → validated) 3 entries with concrete evidence.

const { logLearning } = require("../hooks/lib/logger");
const { PATHS } = require("../hooks/lib/paths");
const fs = require("fs");

// ============= PHASE A — NEW LEARNINGS =============

const newLearnings = [
  {
    intent: "cross-provider",
    tip: "Cross-provider review catches what same-provider review misses. Concrete: gpt-5.5-mini (QA) caught snake_case intent normalization bug that Claude builder + Claude reviewer both missed. Provider diversity (claude-build, openai-review, gemini-redteam) is operational, not theoretical.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "commit 4c7dcb9 + regression test; gauntlet log .claude/runtime/dispatch/redteam-output.json",
      gauntlet_distribution:
        "claude=builder/fixer, openai=reviewer/compliance/qa/redteam-fallback, gemini=redteam-when-quota",
      principle: "P-008 + agentProviders mapping operational proof",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "cross-provider",
    tip: "Pre-build spec review by a different provider catches PRD defects before any code lands. Concrete: parallel gpt-5.5 spec-reviewer caught 4 critical + 8 major PRD defects (incl. dominos lat:0 false-out-of-range). Cost: ~5 min wall time during builder run.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "PRD-V2-DELTA.md catalogs all 12 findings; commit 69d8755 lands the deltas",
      pattern: "spec-defects-pre-build > spec-defects-via-broken-build",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "agent-tooling",
    tip: "maxTurns silent reap is a binding gap. Spawned agent hits maxTurns, exits, gets removed from team config — but SendMessage to that agent still returns {success:true} into a dead inbox. Caller must inspect team-config members[] to confirm liveness, or surface the reap loudly.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "Gamma maxTurns=80, spawned at session start, reaped after gauntlet; my redteam-retry message went to dead inbox; user noticed before I did",
      symptoms: [
        "SendMessage returns success",
        "team config members[] missing the reaped agent",
        "no automatic respawn",
      ],
      flag: "warpos-to-update.md row — maxTurns reap silent",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "external_learning",
    tip: "Free-tier Google AI Studio projects get limit:0 quota for some models, surfaces as 404 ModelNotFoundError to gemini-cli. Distinct from entitlement gaps. Disambiguate via `gemini models list` — explicit per-model quota metrics surface the limit:0 cause.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "User account vladislav.zhirnov@gmail.com on free tier; 3.1 family all 404; `gemini models list` returned 'Quota exceeded for metric ... limit: 0, model: gemini-3.1-pro'",
      probe_recommendation:
        "Option 2 (1-token API probe) cheap default + Option 3 (models list) deep fallback on 404",
      cli_version: "0.41.2",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "agent-tooling",
    tip: "gemini-cli auth.selectedType in ~/.gemini/settings.json silently overrides GEMINI_API_KEY env var. oauth-personal selection bypasses the API key entirely. Smart-context or session-start should flag oauth-personal + GEMINI_API_KEY both set as a config conflict.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "User had GEMINI_API_KEY in .env (39 chars) + oauth-personal in ~/.gemini/settings.json; CLI used OAuth tier (free) and 404'd on 3.1; switching to gemini-api-key did not fix because key project ALSO lacked 3.1, but at least surfaced the right error class",
      time_lost: "~30 minutes diagnostic",
      flag: "warpos-to-update.md row — auth.selectedType silent override",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "agent-tooling",
    tip: "dispatch-agent.js findAgentSpec DFS-order returned wrong mode's spec for build-chain roles with both adhoc + oneshot variants. Fixed by Gamma this session: read mode.json, prefer matching mode subdir. Generalizes to any dual-mode role.",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "First adhoc redteam dispatch invoked codex with -m gemini-3.1-pro (oneshot redteam spec) instead of gpt-5.4-mini (adhoc spec); Gamma patched in commit 1ae13c7",
      role_pattern:
        "any role with both .claude/agents/01-adhoc/<role>/* and .claude/agents/02-oneshot/<role>/* specs",
      flag: "warpos-to-update.md row — dispatch-agent.js mode-aware spec resolution",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "security_audit",
    tip: "Second-pass validation gates must re-derive their inputs from already-bound data, not from re-supplied free-form args. RT-201 finding: place_order recomputes compatibility against unbound intent_style; attacker can desync gate from cart. Fix: derive compatibility from cart contents (which IS bound).",
    conditions: {
      session: "2026-05-06 YC sprint",
      evidence:
        "redteam gate caught it (gpt-5.4-mini); ISS-005 logged with full schema + option-b fix path (~30 LOC across server.ts + executor.ts)",
      generalization:
        "applies to any place where a downstream check accepts a fresh arg that should have been bound at the upstream commit point",
      threat_model_ref: "PRD R-1 wrong-item placement bypass",
    },
    source: "learn:deep:conversation",
  },
];

let appended = 0;
for (const learning of newLearnings) {
  try {
    logLearning(learning);
    appended++;
  } catch (err) {
    console.error("append failed:", err.message);
  }
}
console.log(`appended ${appended} new learnings`);

// ============= PHASE A.2 — INFORMED BUMPS =============
//
// In-place edit learnings.jsonl: bump score by +0.1 (cap 1.0) for entries
// actively informed-used this session. Use Edit tool semantics (read line,
// modify, append back). For simplicity: read whole file, edit in memory, write back.
// Memory-guard allows appendFileSync to learnings.jsonl. For in-place edits, we
// READ the file, find the target line, modify the JSON, and use appendFileSync
// to a TEMP marker — but that's complex. Simpler: log a status-bump as a new
// learning that future /learn:integrate can dedupe. Keep it lightweight.

const informedBumps = [
  {
    intent: "meta",
    tip: "Informed-use bump: P-021 (deep-research as authoritative input) actively used this session — yc-application-brief.md cited 6 deep-research learnings from 2026-05-01 verbatim as YC pitch evidence.",
    conditions: {
      bumps: "P-021",
      evidence: "yc-application-brief.md sources block",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Informed-use bump: P-024 (crash-aware checkpointing) actively drove roadmap-yc.md + issues.md + yc-application.md + yc-application-brief.md committed BEFORE risky build work began.",
    conditions: {
      bumps: "P-024",
      evidence: "commit 378cd42 lands all 4 crash-recovery anchors",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Informed-use bump: P-025 (3-strike fix cap as HARD-RULE) actively cited when evaluating Gamma claude-p retry strategy — switched route on attempt #2 instead of retrying same path 3x.",
    conditions: {
      bumps: "P-025",
      evidence: "Beta consult message at 03:30Z + Gamma directive sequence",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Informed-use bump: P-027 (/session:print as YC-evidence tool) fired twice this session — once after user reminder, once after build landed. Pattern works.",
    conditions: {
      bumps: "P-027",
      evidence: "two /session:print invocations in conversation log",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Informed-use bump: P-029 (yes do all = full delegation) was the basis for autonomous progression through Phases 2-7 without per-step approval — until user's mid-session correction added Beta to the loop. Pattern needs a 'subject to scope-of-original-proposal' qualifier.",
    conditions: {
      bumps: "P-029",
      evidence:
        "user message 'I give you full authority' followed by user mid-correction 'I didn\\'t mean to bypass Beta'",
      refinement:
        "blanket-delegation does NOT subsume Beta consults on Class B+ — it subsumes step-by-step approval for Class A+ low-B only",
    },
    source: "learn:deep:conversation",
  },
];

let bumped = 0;
for (const learning of informedBumps) {
  try {
    logLearning(learning);
    bumped++;
  } catch (err) {
    console.error("bump failed:", err.message);
  }
}
console.log(`appended ${bumped} informed-bump entries`);

// ============= PHASE A.3 — VALIDATION (status: logged → validated) =============
//
// Read learnings.jsonl, find entries with concrete evidence from this session,
// and write a meta-entry promoting them. (Direct in-place jsonl edit is risky
// without a Read-Edit cycle on each line; meta-entry is safer.)

const validations = [
  {
    intent: "meta",
    tip: "Validation: 'cross-provider Claude-provider dispatch bypasses runProvider' (logged earlier session) is now VALIDATED. Evidence: Gamma's first claude-p builder dispatch died silently this session, confirming the binding-gap class predicted in LRN-2026-04-30.",
    conditions: {
      promotes: "cross-provider tip from earlier this session",
      evidence_commit:
        "1ae13c7 fix(dispatch) carries the dispatch-agent.js mode-aware patch + providers.js --skip-trust",
      status_change: "logged → validated",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Validation: 'Auto-load agent-dispatch-guide.md' learning (logged 19e7029) is VALIDATED — Gamma's recent re-spawn explicitly read the guide on startup per the new MANDATORY READ in gamma.md. Pattern works.",
    conditions: {
      promotes: "agent-tooling auto-load learning from /fix:deep",
      evidence:
        "Gamma re-spawn 03:14Z read gamma.md (which now has step 3 MANDATORY READ for guide); subsequent dispatch used canonical path correctly",
      status_change: "logged → validated",
    },
    source: "learn:deep:conversation",
  },
  {
    intent: "meta",
    tip: "Validation: 'Gemini 3.1 model id no -preview suffix' learning (from /learn:ingest) was directly applied via 14-file bulk rename + manifest update. CONFIRMED CORRECT against Google's docs. But user's ACCESS to that model is separately gated (free-tier limit:0) — model id is right, account isn't.",
    conditions: {
      promotes: "external_learning tip from /learn:ingest",
      evidence:
        "14-file rename committed in 19e7029; subsequent retry showed name is correct, just account-gated",
      status_change: "logged → validated (with caveat)",
    },
    source: "learn:deep:conversation",
  },
];

let validated = 0;
for (const learning of validations) {
  try {
    logLearning(learning);
    validated++;
  } catch (err) {
    console.error("validation failed:", err.message);
  }
}
console.log(`appended ${validated} validation entries`);

// Total
console.log(`\n=== /learn:deep summary ===`);
console.log(`new conversation learnings: ${appended}`);
console.log(`informed-use bumps: ${bumped}`);
console.log(`validations: ${validated}`);
console.log(`total entries appended: ${appended + bumped + validated}`);
console.log(
  `learnings.jsonl now: ${
    fs
      .readFileSync(PATHS.learningsFile, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length
  } lines`,
);

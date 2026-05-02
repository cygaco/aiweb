#!/usr/bin/env node
/**
 * One-shot writer for /learn:conversation results — session 2026-04-23/24.
 *
 * Writes new learnings via logger.logLearning() (canonical path).
 * Updates score/pending_validation on two existing entries (line 122, 151)
 * by surgical line replacement — does NOT rewrite the whole file.
 *
 * Run: node scripts/learn-conversation-2026-04-24.js
 */
const fs = require("fs");
const path = require("path");
const { logLearning, LEARNINGS_FILE } = require("./hooks/lib/logger");

// ── Phase A.5 — boost existing entries with new evidence ────────────────────

function boostExisting(matchSubstr, mutator, label) {
  const raw = fs.readFileSync(LEARNINGS_FILE, "utf8");
  const lines = raw.split("\n");
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || !lines[i].includes(matchSubstr)) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const updated = mutator(entry);
    if (!updated) continue;
    lines[i] = JSON.stringify(updated);
    hits++;
  }
  if (hits > 0) {
    fs.writeFileSync(LEARNINGS_FILE, lines.join("\n"), "utf8");
    console.log(`updated ${hits} entry(ies) for: ${label}`);
  } else {
    console.log(`no match for: ${label}`);
  }
}

// 1. team-guard silent-fail (line 151): root-caused this session, fix landed,
//    validated by audit (mode-aware gating now uses runtime/.team-guard.log).
boostExisting(
  "LN-team-guard-silent-fail",
  (e) => ({
    ...e,
    pending_validation: false,
    score: 0.9,
    status: "validated",
    validated_at: "2026-04-24",
    validated_by: "fix:deep + audit-walkthrough team-guard.js",
  }),
  "team-guard silent-fail validation",
);

// 2. mode.json single-source-of-truth (line 122): this session's team-guard fix
//    made it the gating source for adhoc/oneshot/solo. Stronger evidence now.
boostExisting(
  '"scope":"mode-detection-hooks"',
  (e) => {
    if (e.score >= 0.9) return null; // already boosted
    return {
      ...e,
      score: 0.9,
      status: "validated",
      validated_at: "2026-04-24",
      validated_by:
        "team-guard mode-aware gating wired to .claude/runtime/mode.json",
    };
  },
  "mode.json SoT validation",
);

// ── Phase B — new learnings (5 high-quality, well-conditioned) ──────────────

const newLearnings = [
  {
    intent: "class_of_bug",
    tip: "Any guard/decision hook that performs side-effect I/O (debug logs, telemetry writes, mkdir) inside the SAME try-block as its allow/deny decision can silently disable itself: ENOENT or EPERM on the side-effect bubbles to the outer catch and exits 0=allow. Wrap every non-decision I/O in its own inner try/catch. Audit: grep PreToolUse hooks for fs writes that aren't the decision.",
    conditions: {
      scope: "hook-development",
      trigger: "writing PreToolUse / PostToolUse hook with debug/telemetry I/O",
    },
  },
  {
    intent: "architecture",
    tip: "Skeleton rebuilds re-derive integration shapes from spec — if a hard-won fix (e.g. 'BD dataset gd_lpfll7v5hcqtkxl6l requires LinkedIn URL input, NOT keyword field') only lives in code, the next /preflight:setup --gut + rebuild WILL revert it. Encode every non-obvious external-API contract as an explicit line in the spec/PRD AND a regression test. Fix-in-code-only is fix-with-half-life.",
    conditions: {
      scope: "skeleton-rebuilds",
      trigger: "fixing an integration bug that derived from trial-and-error",
    },
  },
  {
    intent: "process",
    tip: "git log -S '<verbatim-string-from-fix>' (pickaxe) is the highest-leverage tool for finding when a regression entered. Picks the exact commit that added/removed the literal — works across renames, refactors, and squashed merges. Use BEFORE bisect when you can name a string the bug-free code contained or the buggy code introduced. Took ~30s to localize the BD-scraper LinkedIn-URL revert to commit d00e4b3 vs hours of bisect.",
    conditions: {
      scope: "regression-hunting",
      trigger:
        "you can name a string present-only-in-good or present-only-in-bad",
    },
  },
  {
    intent: "architecture",
    tip: "Identity gating in agent-dispatch hooks must use exact-match-after-normalize, never substring or includes(). name.includes('beta') matches 'rocket-beta-tester', 'beta-builder', etc. Normalize to lowercase, strip prefixes/suffixes, then ===. Same class as CSS class-name matchers and CORS origin allowlists — substring match in an allowlist is a bypass.",
    conditions: {
      scope: "auth/identity-gating",
      trigger:
        "any allowlist/denylist comparison on a user-controlled name field",
    },
  },
  {
    intent: "architecture",
    tip: "Build-chain agent (builder/fixer/evaluator/compliance/qa/redteam) responses can balloon to 50-100k tokens and overfill the orchestrator's context. Add a PostToolUse:Agent hook that measures response size and (a) warns >20k, (b) blocks/summarizes >50k. Pair with the existing rule of dispatching build-chain roles via Bash subprocess (LRN-2026-04-22) — the hook is the safety net for cases where Bash isn't viable.",
    conditions: {
      scope: "agent-orchestration",
      trigger:
        "dispatching build-chain agents that produce large prose/code output",
    },
  },
];

for (const l of newLearnings) {
  const ok = logLearning({
    ...l,
    ts: "2026-04-24",
    source: "learn:conversation",
    pending_validation: true,
    score: 0,
    status: "logged",
  });
  console.log(
    ok
      ? `appended: ${l.intent} — ${l.tip.slice(0, 60)}…`
      : `FAILED: ${l.intent}`,
  );
}

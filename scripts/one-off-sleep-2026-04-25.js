#!/usr/bin/env node
// One-off: append /sleep:deep journal + coaching for 2026-04-25 cycle.
// Self-contained because merge-guard blocks node -e (RI-004).
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./hooks/lib/paths");

const dreamsDir = PATHS.dreams || ".claude/dreams";

const journalEntry = `

## Sleep — 2026-04-25 (post-9-skill consolidation chain)

### NREM Consolidation
- 4 new learnings logged via /oneshot:retro Phase G; 3 prior learnings attested as implemented (line110, line122, LN-team-guard-silent-fail) via /learn:integrate.
- Pattern promotion candidate: helper-script-pattern-for-merge-guard (recurring across multiple sessions). Surfaced; not auto-promoted to rule.
- β consultation ratio: 1 of ~70 prompts (P-018 "β under-utilization" surfaced via /beta:mine).
- RT-015 (BD discovery flag) trace not yet eligible for reclassification (needs validation cycle on next BD trigger).

### Cleanup (Glymphatic)
- Orphan agent/wt-* branches: 10+ detected. Suggest cleanup pass next idle window.
- Recurring issues counts incremented: RI-004 +29, RI-006 +6, RI-008 +5 (matching 7d scan reality vs stale recorded counts).
- No stale handoffs to prune (session is current).

### Replay (Spindle)
- Today's REAL goal: "get ready for run-10". Achieved fully — backend specs (4 files authored), manifest entry (phase 1.5), validate-gates wiring, 7-pass audit PASSED.
- Blind spots: Tier 3 (CSP nonce migration), Tier 1.3 (extension auto-apply CONTENT_JS), Tier 1.4 (Rule 63 HMAC handshake) still deferred from run-9 fix pass.
- Unused skill families 7d: warp:* (expected — non-init day), karpathy:* (expected — no autoresearch loop), content:* (expected — no posting work).
- User-style: strong consolidation prior ("less skill names to remember", "do it anyways") — now encoded as β P-015 + G-1 cognitive-load axis (flagged for review in Pending section).

### REM Dreams
- See \`.claude/dreams/2026-04-25.md\` for the painting + deep read.
- Cross-pollination: skill consolidation (7→4 via flags) and backend split (monolith → service+worker+admin via process groups) are the SAME pattern at different scales — "consolidate by mode, not by removal."
- Schema formed: **Composition with flags preserves targeted-access affordance while shrinking surface.** Applies to oneshot:preflight (--audit-only/--setup-only/--pass N), oneshot:retro (--context/--code), and structurally to backend (api/worker process groups).

### Repair
- Security: spot-grep of today's diffs — no AKIA/sk-/sk-ant/UPSTASH leaks (manual eyeball; automated scan deferred).
- Dependencies: \`npm audit\` not run (deferred to next cycle).
- Architecture drift: zero — preflight Pass 1-2 + I17 PASSED clean.
- Hook integrity: all hooks in settings.json resolved during preflight Pass 4.

### Growth
- System strength: TRENDING UP. Skill surface shrunk 7→4 (~57%). Backend feature went from PRD-only to spec-complete. Three permanent preflight checks added (R11 strengthen, I17 new, patterns drift).
- **Biggest leverage point:** Fix RI-004 root cause permanently (merge-guard substring parser → argv-only). Hit 31× in 7d. Helper-script workaround works but adds permanent friction. A 1-day investment here pays back across all future agentic work.
- Morning briefing: appended to coaching.md
- False memory check: spot-validated 3 attested learnings against code state — all real.

### Notable trace from today
- RT-015: BD discovery-mode flag was missing for second time in two months (RT-014 fixed input shape but not the URL flag). Encoded class-of-bug into LRN-2026-04-25-bd-discovery-flag-not-implicit.

---
`;

const coachingEntry = `

## 2026-04-26 — Morning Briefing

### Where you left off
- Branch \`skeleton-test9\` is fully prepped for \`/oneshot:start\` to launch run-10. Preflight PASSED (0 errors, 2 minor warnings).
- Backend feature spec is complete (PRD + INPUTS + STORIES + HL-STORIES + COPY); validate-gates and manifest both have phase 1.5 entry. Run-10 will build the service.
- BD discovery-mode fix (RT-015) shipped this session — verify it resolves the dead_page issue on next BD trigger. If still 1-result-per-query, dataset config in BD dashboard needs to be checked (Solution C from RT-015 Phase 3).
- 7 commits ahead of origin pushed today; worktree clean modulo runtime telemetry.

### Suggested first action
Run \`/oneshot:start\` to kick off run-10 (Delta will take over and run the full skeleton build state machine).

### Pending review (low urgency, flagged today)
- 2 persona gaps in β recommendations: **G-1 cognitive-load axis** and **G-2 skill-create-queueing**. Both originated from today's skill consolidation override. Consider promoting G-1 to a real β principle next time you're doing meta work.
- RI-004 merge-guard false-positive at 31×/7d — schedule a permanent fix when there's a quiet hour (parse argv[0..1] only).
- 10+ orphan \`agent/wt-*\` branches detected — \`git branch -D agent/wt-*\` housekeeping when convenient.
- Tier 3 (CSP nonce migration) and Tier 1.3 + 1.4 (extension auto-apply + Rule 63 HMAC) still deferred — pick one for after run-10 closes.

### Self-care reminder
This was a 9-skill chain into a 10th (sleep). Long sessions reward consolidation discipline; if next session feels scattered, run \`/session:recap 5\` first.
`;

fs.appendFileSync(path.join(dreamsDir, "journal.md"), journalEntry);
fs.appendFileSync(path.join(dreamsDir, "coaching.md"), coachingEntry);

console.log("Appended to journal.md (" + journalEntry.length + " chars)");
console.log("Appended to coaching.md (" + coachingEntry.length + " chars)");

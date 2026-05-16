---
description: "Append a framework-level update flag to the repo-local warpos-to-update.md ledger. Safe to run in product repos and the canonical WarpOS clone."
user-invocable: true
---

# /warp:flag — Record a framework-update flag

Use `/warp:flag` whenever you notice something during product or framework
work that ought to be propagated upstream into WarpOS. The skill appends a
structured entry to the repo-local `warpos-to-update.md` ledger.
`/warp:promote-flags` later drains the ledger (mark `promoted`, archive
entries, record canonical SHAs).

This skill is the source-of-truth path for surfacing framework gaps. It
does NOT propagate code — that's `/warp:promote` (source→canonical
framework files) and `/warp:promote-flags` (ledger drain) respectively.

## When to use

- Provider catalog drift (e.g. a model listed in catalog.js no longer
  exists upstream).
- A hook missed a real failure mode you had to work around.
- A skill's documentation doesn't match its current behaviour.
- An agent spec references a path or convention that has since moved.
- Install/setup gap you noticed in a fresh project.
- A primitive limitation we can't fix in-repo but should track.

## How to invoke

```bash
node scripts/warpos/flag.js --category dispatch \
                            --title "Dispatch-route guard against raw provider CLI" \
                            --source "WarpOS Phase 0" \
                            --description "Forbid raw codex/gemini/claude -p prompt invocations from Bash"
```

Categories: `provider`, `dispatch`, `agent`, `hook`, `skill`, `install`,
`template`, `requirements`, `issue`, `release`, `docs`, `other`.

Statuses: `open` (default), `in_progress`, `promoted`, `blocked`,
`deferred`, `needs_decision`, `duplicate`, `abandoned`.

Pass `--json` for a machine-readable result. Pass `--ledger <path>` only
when targeting a non-default ledger file.

## Ledger location

Resolved via `paths.warposFlagLedger` if present in `.claude/paths.json`;
otherwise `warpos-to-update.md` at repo root.

Product repos are NOT required to commit the ledger. The decision to
track it in git belongs to the product team. The canonical WarpOS repo
SHOULD track its own ledger so propagation history is visible.

## Output

A single human-readable line on success:

```
[warp:flag] appended dispatch/open "Dispatch-route guard against raw provider CLI" to warpos-to-update.md
```

Or, with `--json`:

```json
{"ok":true,"ledger":"…/warpos-to-update.md","date":"2026-05-11","category":"dispatch","title":"…","status":"open","source":"WarpOS Phase 0"}
```

## Drain workflow

See `/warp:promote-flags`. It:

1. Reads all entries with `Status: open` (and other non-terminal statuses).
2. Groups them by category + source.
3. Surfaces the canonical files most likely affected (best-effort —
   driven by category).
4. Marks chosen entries as `promoted` once the upstream change lands and
   records the canonical commit SHA in `- Canonical-SHA: <sha>`.
5. Optionally archives promoted entries to `warpos-promoted-archive.md`.
6. Writes a promotion report under `.warpos/promote-reports/`.

## Failure modes

- `--title` missing → exit 2, message on stderr.
- Invalid `--category` or `--status` → exit 2.
- Ledger directory not writable → file system error (rare).
- No network calls; no external tools.

## See also

- `/warp:promote-flags` — drain the ledger.
- `/warp:promote` — source → canonical framework-file propagation (not
  the same as the flag drain).
- `paths.warposFlagLedger`, `paths.warposPromotedArchive`,
  `paths.warposPromoteReports`.

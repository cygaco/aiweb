# WarpOS 0.4.4 — Upgrade Notes

Single-line critical fix for cross-vendor dispatch. Phase 0 broke it;
0.4.4 restores it.

## Re-bootstrap

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "C:\Users\Vladislav Zhirnov\Desktop\Claude\Projects\WarpOS\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

## What this unblocks

If your sprint plans / gauntlets / redteam runs have been silently
falling back to self-review or failing with cryptic stdin errors
since Phase 0 (2026-05-11), this is why. After re-bootstrap, the
following should work:

- `/sprint:plan` → real diff-model review against codex/gemini
- `/sprint:design` → cross-vendor PRD/STORIES review
- Gamma gauntlet → diff-model evaluator + reviewer + compliance + qa
- `/redteam:full` → gemini-primary attack chains
- Any path through `scripts/hooks/lib/providers.js#runProvider` with
  a non-default vendor

## Verification

After re-bootstrap, run:

```bash
node scripts/test-providers-stdin-fix.js
```

Should report `3 passed, 0 failed`.

## Rollback

Don't. 0.4.3 has the dispatch bug. Stay on 0.4.4.

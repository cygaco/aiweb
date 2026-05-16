# WarpOS 0.4.4 — 2026-05-12

Critical dispatch-stdin fix. Phase 0 silently broke every diff-model
review across the framework; this restores it.

## The bug

Phase 0 (commit `b3a5ab06`) converted `runProvider`'s `execSync` to
`spawnSync` to capture stderr for silent-zero-byte-death telemetry.
The new call:

```js
spawnSync(cmd, {
  cwd: PROJECT,
  timeout: timeoutMs,
  input: promptContent,           // STRING
  maxBuffer: 32 * 1024 * 1024,
  shell: true,
  encoding: "buffer",             // requires Buffer-typed input
});
```

When `encoding: "buffer"` is set, Node requires the `input` option to
be a `Buffer`. Passing a string raises `ERR_UNKNOWN_ENCODING`
synchronously, before the child process is even spawned.

Result: every dispatch through `runProvider` to a non-default vendor
threw at the boundary. Callers misattributed the failure (most
commonly to LRN-2026-04-17 cmd.exe stdin bug) and either retried
forever or fell back to same-vendor self-review — defeating the
entire diff-model-review architecture.

## The fix

One line in `scripts/hooks/lib/providers.js`:

```diff
-  input: promptContent,
+  input: Buffer.from(promptContent, "utf8"),
```

Test added at `scripts/test-providers-stdin-fix.js` (3/3 passing):
- Confirms the buggy shape throws `ERR_UNKNOWN_ENCODING` synchronously.
- Confirms the fixed shape doesn't error.
- Confirms stdin → stdout roundtrips correctly.

## Impact

- Gauntlet runs (Gamma's evaluator/reviewer/compliance/qa/redteam
  dispatching to non-default vendors) now reach the vendor instead of
  failing at the spawn boundary.
- Sprint workflows: `/sprint:plan` and `/sprint:design` can finally
  invoke the declared diff-model review in `sprint-routing.json`.
- Cross-provider redteam (`redteam.primary: gemini` with
  `redteam.fallback: claude:opus`) now reaches gemini.
- `/warp:health` provider checks: same.

## Migration

`0.4.3 → 0.4.4`. No migrations. Re-bootstrap to apply:

```bash
powershell.exe -ExecutionPolicy Bypass \
  -File "<canonical>\install.ps1" \
  -Target "$(cygpath -w "$PWD")" \
  -SkipPrompt
```

## Followups (not in 0.4.4)

The Plan Contract in the product that triggered this discovery
attributed the failure to "LRN-2026-04-17 cmd.exe stdin bug" via
`decisionLedger`. That attribution was wrong — it's the
encoding-mismatch bug, not the cmd.exe stdin bug. After re-bootstrap,
re-run `/sprint:plan` and the next Plan Contract should get a real
diff-model review.

## See also

- `framework/releases/0.4.3/changelog.md` — manifest-regen fix.
- Commit reference: `b3a5ab06` (Phase 0) introduced the bug.

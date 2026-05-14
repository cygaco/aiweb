# First-run report — SP-20260514-004 — 2026-05-14T22:44:07Z

**Branch:** `sprint/SP-20260514-004-exec-pass2`
**HEAD SHA:** `81547554c620c2b1c65974971577a821057cf15b`
**Run timestamp:** 2026-05-14T22:44:07Z
**Command:** `node scripts/harness/golden-path.js --surface all --no-build`

---

## Surface results

MCP stdio surface: PASS (3/3 scenarios) — 2177ms
A2A JSON-RPC surface: PASS (3/3 scenarios) — 3058ms

Total: PASS (6/6) — 5235ms

---

## Per-scenario results

| Scenario | Surface | Final state | Result | Runtime |
|----------|---------|-------------|--------|---------|
| pizza-only | mcp-stdio | n/a (step-based) | PASS | 836ms |
| pizza-plus-side | mcp-stdio | n/a (step-based) | PASS | 621ms |
| pizza-plus-drink | mcp-stdio | n/a (step-based) | PASS | 720ms |
| pizza-only | a2a-jsonrpc | input-required | PASS | 1025ms |
| pizza-plus-side | a2a-jsonrpc | input-required | PASS | 978ms |
| pizza-plus-drink | a2a-jsonrpc | input-required | PASS | 1055ms |

---

## Guard layers active

1. `BLAND_API_KEY=""` — Layer 1 env gate
2. `BLAND_HARNESS_MODE=1` — Layer 2 source short-circuit in `src/connectors/bland.ts`
3. `sim_` prefix assertion on every `place_order` callId — Layer 3

All three guard layers were active for both surfaces.

---

## Commits shipped (pass-1 + pass-2)

| SHA | Ticket | Description |
|-----|--------|-------------|
| `a8465a6` | T-082 | `scripts/harness/adapters/a2a-intent.js` created |
| `b597bfb` | T-083 | `runA2AScenario` rewired to use adapter |
| `363d13c` | T-084 | Adapter unit tests (3 happy-path + 2 edge cases) |
| `a23dd43` | T-085 | Bland 3-layer guard regression on A2A surface |
| `7a0226b` | T-086 | A2A adapter contract section in README |
| `8154755` | followup | T-082/083 correctness fixes (data-part crash, events assertions, scenario root fields) |
| HEAD | T-087 | This first-run report |

---

## I-001 closure handoff to Alpha

I-001 (`I-20260514-001.yaml`) closure cannot be performed from this worktree branch.
Handoff to Alpha for post-merge update:
- `status: resolved`
- `resolution`: reference merge SHA (to be set after merge to main)
- `resolution_date`: ISO-8601 of merge date
- `files_touched`: at minimum:
  - `scripts/harness/adapters/a2a-intent.js`
  - `scripts/harness/golden-path.js`
  - `tests/golden-path-harness/a2a-adapter.test.ts`
  - `tests/golden-path-harness/guards.test.ts`
  - `tests/golden-path-harness/README.md`
  - `tests/golden-path-harness/scripts/pizza-only.json`
  - `tests/golden-path-harness/scripts/pizza-plus-side.json`
  - `tests/golden-path-harness/scripts/pizza-plus-drink.json`

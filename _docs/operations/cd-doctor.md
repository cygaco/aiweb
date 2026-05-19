# Claude Desktop integration — `cd:doctor` operator playbook

Operational reference for `npm run cd:doctor` and the `.github/workflows/cd-canary.yml` cron canary that together convert the Claude Desktop ↔ aiweb MCP integration from "find out by trying" into a CI-enforced contract.

Anchored in `SP-20260519-007` and the RT-007 diagnosis (six failure modes F1–F6; F3 closed in the 2026-05-18 incident response; F6 + vendored bridge deferred unless the canary shows recurring failures).

## When to run `cd:doctor`

After any of:

- `fly deploy` (or a sprint that lands a code change touching the MCP server)
- `npm install` after a `package.json` change
- Updating `scripts/one-off/aiweb-pizza-mcp.cmd` (re-copy from `.template`, new `WARP_MCP_KEY`)
- Upgrading the operator's `mcp-remote` install
- Claude Desktop reports the integration as failing in any way

```powershell
npm run cd:doctor
```

The script runs four checks and prints a green/red verdict in under 30 seconds.

## What each check means

### `[1/4] healthz`

`GET https://aiweb-mcp.fly.dev/healthz` with a 5-second timeout.

| Signal | Meaning | First fix |
|---|---|---|
| `OK — HTTP 200, <N>ms` | Fly machine is up and responding. If `N` > 1000 ms, cold-start may still be active despite the `auto_stop='suspend'` config — check `fly config show` to confirm the deployed setting. | — |
| `FAIL — 5s timeout, no response` | Fly machine isn't responding at all. | `fly status -a aiweb-mcp` then `fly logs -a aiweb-mcp`. If the machine is stopped, `fly machine start <id>`. |
| `FAIL — HTTP <N>, <M>ms` | Server returned a non-2xx. Look at the body. | Check the deployed app logs; recent deploy may have introduced a startup error. |

### `[2/4] tools-list`

Issues `initialize` + `tools/list` over MCP against `MCP_URL`. Compares the returned tool array against the canonical 5-tool whitelist.

| Signal | Meaning | First fix |
|---|---|---|
| `OK — 5 tools match whitelist` | Tool registry parity holds. | — |
| `FAIL — unexpected=[X] missing=[Y]` | Drift between deployed code and the whitelist. The whitelist is hardcoded in `scripts/check-deployed-tools.js` and `scripts/cd-doctor.js`. | If a new tool legitimately shipped, update the whitelist. If a tool went missing, the deploy is stale — `fly deploy` from main. |
| `FAIL — initialize returned 401` | Bearer rejected. | `WARP_MCP_KEY` env or `.cmd` value is stale; rotate the Fly secret and re-pull. |
| `FAIL — initialize: <err>` | Non-MCP response. | Server may be down or returning HTML; check `fly logs -a aiweb-mcp`. |

### `[3/4] bearer`

Parses `scripts/one-off/aiweb-pizza-mcp.cmd` (operator-local, gitignored) for `WARP_MCP_KEY`, then runs a tiny MCP `initialize` with that key. Falls back to `process.env.WARP_MCP_KEY` if the `.cmd` is absent.

| Signal | Meaning | First fix |
|---|---|---|
| `OK — initialize accepted (source=…)` | Local bearer matches the live Fly secret. | — |
| `SKIPPED — … not found …` | `.cmd` is missing AND no `WARP_MCP_KEY` env var was set. | If a fresh checkout: copy `scripts/one-off/aiweb-pizza-mcp.cmd.template` to `aiweb-pizza-mcp.cmd` and fill in `WARP_MCP_KEY` from Fly secrets. |
| `FAIL — initialize returned 401 …` | Local bearer is stale vs the live Fly secret. | `fly secrets list -a aiweb-mcp` and verify the deployed `WARP_MCP_KEY`. Update the local `.cmd` to match. |

`cd:doctor` will NEVER print the `WARP_MCP_KEY` value to stdout. The bearer stays in process memory.

### `[4/4] mcp-remote-version`

Parses `scripts/one-off/aiweb-pizza-mcp.cmd.template` for the `mcp-remote@<version>` pin, then probes via `npx --yes --no-install mcp-remote@<version> --version` to verify the pin is resolvable locally.

| Signal | Meaning | First fix |
|---|---|---|
| `OK — pinned mcp-remote@X.Y.Z resolvable via npx` | Local install can serve the pinned version. | — |
| `SKIPPED — couldn't probe …` | Probe failed (npm cache cold, network blocked, etc.). Not a failure — the pin is still in `.cmd.template`. | If the pinned version is genuinely missing, `npm cache verify` then `npx mcp-remote@<version> --version`. |
| `SKIPPED — .cmd.template has no mcp-remote@<version> pin` | The `.cmd.template` has been edited and lost the pin. | Restore `npx -y mcp-remote@<version>` syntax in the template. |

## Reading the verdict

- **`GREEN — all checks passed (…)`** — integration is healthy.
- **`GREEN — N of 4 checks passed (skipped: …)`** — no failures, but at least one check couldn't run conclusively. Read the per-check output; SKIPPED is benign for `[4/4]` on a fresh checkout, less so for `[3/4]` if you expected a `.cmd` to exist.
- **`RED — N of 4 checks failed: <names>`** — start at the topmost FAIL line and follow the "First fix" column above.

## The cron canary

`.github/workflows/cd-canary.yml` runs `scripts/check-deployed-tools.js` every 30 minutes against `https://aiweb-mcp.fly.dev/mcp`.

### Setup (one-time, after merge)

1. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**.
2. Name: `WARP_MCP_KEY`. Value: the live Fly secret (must match the deployed app's bearer).
3. Save.

Until the secret is added, the cron will fail visibly with an `::error::WARP_MCP_KEY repo secret is not set` line. That's the intended fail-loud behavior.

### When the cron fails

GitHub emails repo maintainers when a scheduled workflow fails. Email subject: `aiweb-mcp canary FAILED — tool-list drift or deploy degraded`.

Response:

1. Open the failed workflow run in the GitHub Actions tab.
2. Look at the `Run deployed-tools canary` step output.
3. If `tool set mismatch` — the deployed tool registry has drifted from the whitelist. Run `cd:doctor` locally to confirm; investigate the most-recent deploy.
4. If `initialize failed` or HTTP non-2xx — the Fly app is in trouble. Run `cd:doctor` locally, check `fly status` and `fly logs`.
5. If `WARP_MCP_KEY repo secret is not set` — the secret was never added or was deleted. Re-add per the setup section above.

### When to manually re-run the cron

Use the **Run workflow** button in the GitHub Actions UI (the workflow defines `workflow_dispatch: {}` to enable manual triggers). Useful right after a deploy if you don't want to wait for the next 30-minute tick.

## Cold-start configuration (R-1 / SP-007 T-102)

`fly.toml` `[http_service].auto_stop_machines = 'suspend'` is the preferred setting. Wake from suspend is ~200 ms; from `stop` it's ~2-3 seconds, which exceeds mcp-remote's first-call patience window.

If `cd:doctor` shows `healthz` latencies persistently > 1000 ms after a deploy:

1. `fly config show -a aiweb-mcp` — confirm the resolved value.
2. If `auto_stop_machines = 'stop'` somehow re-emerged: `git diff fly.toml`, restore `'suspend'`, redeploy.
3. If `auto_stop_machines = 'suspend'` is set but wake is still slow: Fly may not honor `suspend` on this VM kind / region. Fallback: edit `fly.toml` to `min_machines_running = 1` (~$3/mo always-on) and redeploy.

## Version pin discipline (R-3 / SP-007 T-104, T-105)

Two pins together stop silent npm-registry upgrades from breaking the wire format:

- `package.json` → `@modelcontextprotocol/sdk: ~1.29.0` (tilde-pin; patch allowed, minor blocked).
- `scripts/one-off/aiweb-pizza-mcp.cmd.template` → `npx -y mcp-remote@0.1.38` (exact-pin).

To update either:

1. Test the new version against staging via a temporary edit.
2. `cd:doctor` against staging.
3. If green: bump the pin in the canonical file, commit, deploy.
4. If the operator's local `.cmd` was generated from an older template, prompt them to re-copy from `.template`.

## Escalation path

`cd:doctor` is diagnose-only. If checks 1–3 fail in a way the above table doesn't resolve in 5 minutes:

1. Confirm against the deployed app with `node scripts/check-deployed-tools.js` (no `.cmd` dependency).
2. Open `runtime/events.jsonl` and grep for `cd_doctor.run` + `deploy.tools_list_snapshot` recent entries — the per-check history surfaces patterns.
3. If the failure mode looks like F6 (bridge-state.json stale session replay) — repeated 401s only after a Claude Desktop restart, healthy `cd:doctor` results otherwise — read the optional vendored-bridge note in `ROADMAP.md` "Claude Desktop integration reliability." That work is currently deferred; recurring F6 is the trigger to invest.
4. If the failure mode is a new one not described here, log it in `issues.md` and propose adding the response to this playbook in the next sprint retro.

## What `cd:doctor` does NOT cover

- A2A surface health — orthogonal; not part of the Claude Desktop critical path.
- Webapp `/api/chat` health — different surface, different concern.
- Bland API quota or call success — covered by the dispatch path's own error handling.
- Restaurant-side compatibility — covered by the compatibility layer (`assessCompatibility`).
- `/fixture` hook smoke tests — these run after `/warp:update` and are a different concern (local PostToolUse verification, not Claude Desktop).

# profiles.db — safety, hygiene, and wipe protocol

> **Scope (2026-05-14):** This document applies to the stdio-only profile.db after SP-20260514-001. The HTTP/MCP profile surface (the `get_user_profile` / `update_user_profile` MCP tools and the order-flow fallbacks) was removed. The production `/data/profiles.db` on the Fly volume is orphaned but retained; a wipe is deferred to a separate guarded-ops ticket. The Fly-volume wipe protocol below remains the reference if/when that ticket is opened.

Operational reference for the SQLite profile store backing the aiweb-pizza MCP server. Read before clearing data, switching environments, running demos, or deploying.

## What it is

A single-file SQLite database (`profiles.db` at project root by default) that stores per-session user profiles for the aiweb-pizza MCP server.

- **Schema:** one row per session, keyed by `tokenHash` (SHA-256 hex). Columns: `token_hash`, `encrypted_blob` (AES-256-GCM, AAD = tokenHash, key = HKDF(secret, salt=tokenHash, info="aiweb-profile-v1")), `updated_at`.
- **Plaintext fields inside the blob:** `name`, `phone` (E.164), `default_address`, `dietary`, `preferred_restaurant_id`, `notes`.
- **Definition:** `src/lib/profile-store.ts`. Path is configurable via `DATABASE_PATH` env var (default: `./profiles.db`).
- **Encryption secret:** `PROFILE_ENCRYPTION_SECRET` env var (required, 64 hex chars / 32 bytes). If the secret rotates, every existing blob becomes unreadable.

The webapp on `:3001` and the Claude Desktop MCP bridge share the same store, keyed by `tokenHash`. See `PROJECT.md` (project memory) for the dual-surface picture.

## Why this doc exists

A live development session (2026-05-10) surfaced stale dev-seed data in `profiles.db` (`default_address: "123 Main St"`, placeholder phone, `notes: "prod smoke test"`). Google Places geocoded the placeholder to Vancouver, BC while the user was in Riddle, OR — Claude (the model) caught it and surfaced the inconsistency, but the failure mode was: **placeholder profile data drives wrong-city restaurant discovery in subsequent flows**.

## Wipe protocol

When to wipe:

1. **Before a demo or recorded test run** — start from a clean slate so onboarding flow is exercised.
2. **Suspected stale seed data** — placeholder addresses, test phone numbers, `notes` containing `test` / `smoke` / `seed`.
3. **Role/environment transitions** — moving a workstation between dev / staging / demo / prod-like work.
4. **Encryption-secret rotation** — old blobs become undecryptable; profile-store falls back to empty profile but the row remains. Clear the file to remove the dead row.
5. **Schema migration** (future) — when adding/renaming profile fields in `profile-store.ts`.

How to wipe (manual one-liner from project root, **local `profiles.db` only**):

```bash
mkdir -p runtime/backups \
  && cp profiles.db "runtime/backups/profiles.db.$(date +%Y-%m-%dT%H-%M-%S).bak" \
  && rm profiles.db
```

The next `initProfileStore()` call will recreate the table on the new empty DB. No code change required.

### Fly volume wipe (production `/data/profiles.db`)

The one-liner above only touches the project-root file. The production volume on Fly app `aiweb-mcp` lives at `/data/profiles.db` (per `fly.toml#env.DATABASE_PATH`) and requires a guarded-op procedure. Reference run from sprint `SP-20260512-001` on 2026-05-12:

```bash
# 0. Pre-flight
flyctl auth whoami
flyctl status -a aiweb-mcp

# 1. Quiesce
flyctl scale count 0 -a aiweb-mcp

# 2. SSH inventory + backup + rm (per-step)
flyctl ssh console -a aiweb-mcp -C "ls -la /data/profiles.db /data/profiles.db-journal /data/profiles.db-wal /data/profiles.db-shm 2>&1"
ts=$(date -u +%FT%H-%M-%SZ)
flyctl ssh console -a aiweb-mcp -C "mkdir -p /data/backups"
flyctl ssh console -a aiweb-mcp -C "cp /data/profiles.db /data/backups/profiles.db.${ts}.bak"
flyctl ssh console -a aiweb-mcp -C "sha256sum /data/profiles.db /data/backups/profiles.db.${ts}.bak"
# (Backup any sidecars that exist; clean SQLite close usually has none.)
flyctl ssh console -a aiweb-mcp -C "sh -c 'rm /data/profiles.db && ls -la /data/'"

# 3. Restart + smoke
flyctl machine restart $(flyctl status -a aiweb-mcp --json | jq -r '.Machines[0].id') -a aiweb-mcp
until curl -sf https://aiweb-mcp.fly.dev/healthz; do sleep 2; done

# 4. Verify empty profile via MCP (manual — operator with Bearer token)
#    Invoke get_user_profile from a fresh tokenHash; confirm no fields populated.
```

**Quoting/multi-step note:** `flyctl ssh console -C "<cmd>"` runs `<cmd>` as a single argv. Chained shells need an explicit `sh -c '<cmd1> && <cmd2>'`. Don't try to splat a multi-line script through `-C`.

**Image caveat:** the Fly image does not include `sqlite3`. The "pre-wipe row dump to text" step from the design AC is adapted to "sha256 of file + size + mtime" — the `.bak` itself preserves all rows for later decryption via `PROFILE_ENCRYPTION_SECRET`.

**Auto-stop interaction:** `fly.toml` has `auto_stop_machines='stop'`. Between commands the machine may stop again. If a subsequent `flyctl ssh` fails with "no started VMs", run `flyctl machine start <id>` and retry. The wipe is not data-race sensitive because the file is gone — but the backup step IS, so quiesce before backup, not just before rm.

## Backup convention

- Backups live under `runtime/backups/profiles.db.<ISO8601>.bak`.
- `runtime/` is gitignored at project root; backups never reach the remote.
- No retention policy is enforced. Manually prune old backups when the directory grows. (Deferred: a `scripts/maintenance/wipe-profiles.js` helper with retention.)

## Production guardrails

- **Path:** set `DATABASE_PATH` to a location **outside the project tree** in production (volume mount on Fly.io, e.g. `/data/profiles.db`). Never let prod write to the repo working directory.
- **Encryption secret:** `PROFILE_ENCRYPTION_SECRET` must be a real 64-hex-char random value in production. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotate via Fly secrets; document the rotation in `_docs/operations/`.
- **Never commit `profiles.db`** — gitignored at root (`profiles.db`, `profiles.db-journal`, `profiles.db-wal`, `profiles.db-shm`). Verify before every commit if the working tree shows the file.
- **Never use the same encryption secret across environments.** Dev, staging, and prod each get their own.

## Read this before you `rm`

The store contains real user data once you have users. The wipe protocol above is calibrated for the current pre-launch / MVP stage where every row is dev seed. Before clearing in any environment with real sessions:

1. Confirm the environment (`echo $DATABASE_PATH`, check `fly status` if Fly).
2. Take a backup (always — the one-liner does it).
3. Get explicit user authorization. This is a Class C action once real users exist.

## Related

- `src/lib/profile-store.ts` — schema, encryption, CRUD.
- `src/server.ts` — `get_user_profile` MCP tool definition.
- `_docs/operations/test-restaurants.md` — sibling doc for the `INCLUDE_TEST_RESTAURANTS` env gate (added in same change).

# Fixture: update-from-0.0.0-clean

Phase 4G fixture for `/warp:update --dry-run --to 0.1.0`.

## What it tests

A clean install at version 0.0.0 with no asset hashes recorded — the simplest "I just unzipped the framework, now I want to update to 0.1.0" path. Every asset in the 0.1.0 capsule should classify as `ADD_SAFE` (target file doesn't exist in fixture, no installed record).

## How to run

```bash
node scripts/warpos/update.js --to 0.1.0 --dry-run --json
```

Currently the engine reads `.claude/framework-installed.json` from the **project root**, not from a fixture path. To use this fixture, copy its `framework-installed.json` over the project's `.claude/framework-installed.json` temporarily — or extend `update.js` with a `--from-install <path>` flag (TODO in Phase 4.1).

## Expected classification

```
{
  "Class A (auto)":  ~370 (everything ADD_SAFE because target paths don't exist in fixture)
  "Class B":         0
  "Class C":         0
}
```

## Why the fixture is mostly empty

The fixture intentionally contains *no* `.claude/agents/`, `.claude/commands/`, `scripts/` etc. — just the `framework-installed.json` snapshot saying "I'm at 0.0.0 with no assets installed." This makes the dry-run plan deterministic: every asset in 0.1.0 is new.

A more realistic fixture would copy the actual 0.0.0 capsule's manifest into the fixture and let `update.js` compute `installedHash` mismatches. That's Phase 4G+ once the `--from-install` flag lands.

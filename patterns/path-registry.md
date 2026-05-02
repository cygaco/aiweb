# Pattern: Path Registry

## Purpose

Keep framework paths stable by giving every important path a registry key and generating runtime artifacts from one source.

## Use When

- A path is referenced by hooks, skills, agents, release tooling, or docs.
- A folder may move across versions.
- A command needs to describe a location without hardcoding it.

## Do Not Use When

- The path is a one-off fixture inside a test.
- The path is product-owned and not consumed by framework tooling.

## Example

Use `paths.eventsFile` in prose and `PATHS.eventsFile` in code. Edit `warpos/paths.registry.json`, then run `node scripts/paths/build.js`.

## Failure Modes

- Editing generated artifacts directly forks the registry.
- Removing a key because no code imports it can break command docs or generated fallback paths.

## Validation

`node scripts/paths/gate.js` validates registry shape, generated artifacts, deprecated aliases, and docs tokens. `node scripts/checks/path-usage.js` verifies Phase 6 targeted usage.

## Owner

WarpOS framework.

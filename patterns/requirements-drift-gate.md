# Pattern: Requirements Drift Gate

## Purpose

Treat requirements as traceable objects with freshness status, impacted code, tests, contracts, and review-class metadata.

## Use When

- A code change may alter product behavior.
- A shared contract changes.
- A requirement becomes stale or unmapped.

## Do Not Use When

- The change is purely formatting and does not alter behavior.
- The file is outside product or framework behavior surfaces.

## Example

Run `node scripts/requirements/graph-build.js --check` and `node scripts/requirements/gate.js` before accepting a behavior change.

## Failure Modes

- Treating stale requirements as comments lets downstream builders implement old behavior.
- Class C drift without human decision silently changes product commitments.

## Validation

The freshness gate blocks unresolved Class C RCOs and stale requirements without RCO coverage.

## Owner

Requirements engine.

# Pattern: Release Capsule

## Purpose

Ship WarpOS changes as versioned release capsules with manifests, migrations, checksums, changelogs, and upgrade notes.

## Use When

- A framework change needs to update installed projects.
- A migration, rename, or generated artifact needs deterministic handling.

## Do Not Use When

- The change is product-only and should never ship through WarpOS.
- The target is runtime data or per-session state.

## Example

`/warp:release <version>` builds `warpos/releases/<version>/` and verifies checksums with `scripts/warpos/release-build.js`.

## Failure Modes

- Including generated capsule snapshots inside the source manifest creates unstable manifest loops.
- Updating files without migrations leaves removed or renamed files behind.

## Validation

`node scripts/warpos/release-gates.js` runs path coherence, manifest, hook fixtures, update fixture, runtime leak, version consistency, and Phase 6 production-quality gates.

## Owner

WarpOS release tooling.

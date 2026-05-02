# Pattern: Human Report Shape

## Purpose

Make build, update, promote, release, and gauntlet results readable by humans without losing machine structure.

## Use When

- A command returns a final result to a user or orchestrator.
- A report may require a human decision.
- A gate has passed with residual risks.

## Do Not Use When

- A script is a low-level library returning JSON to another script.
- The output is an internal trace event.

## Example

Reports use: verdict, what changed, why, risks remaining, what was rejected, what was tested, what needs human decision, recommended next action.

## Failure Modes

- Reporting only counts hides why a command matters.
- Reporting only prose makes downstream orchestration brittle.

## Validation

`scripts/warpos/report-format.js` centralizes the human-facing shape for release/update/promote command output.

## Owner

WarpOS command layer.

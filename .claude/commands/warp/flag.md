# /warp:flag — Flag a change/fix/update for upstream WarpOS

Append an item to `warpos-to-update.md` at project root. Lightweight tracker for changes made in this product repo that should propagate to canonical WarpOS in the next /warp:promote or /warp:release.

## When to use

- A hook, skill, agent spec, script, or learning was modified locally and the change is framework-shared (not product-specific)
- A bug class was discovered that warrants a hook/lint/guard upstream
- A new file was created that belongs in the canonical WarpOS clone
- A model id, provider config, or dispatch path needs upstream alignment

## When NOT to use

- Product-only files (`src/**`, feature PRDs, demo scripts, runtime data)
- Trivial typos or doc-only fixes that don't change behavior
- Things already covered by an open WarpOS PR

## Procedure

### Step 1: Resolve target path

`paths.warpFlagFile` if defined, else `warpos-to-update.md` at project root. Create the file with a header if it doesn't exist:

```markdown
# WarpOS — flagged updates

Items flagged from this product repo for upstream WarpOS propagation. Drained on /warp:promote or /warp:release.

| Date | Category | Title | Source |
|---|---|---|---|
```

### Step 2: Parse argument

Treat the entire argument string as the flag content. Try to extract:

- **title** — short imperative or noun phrase (first sentence or `--title <X>`)
- **category** — one of: `hook`, `skill`, `agent`, `script`, `manifest`, `learning`, `dispatch`, `provider`, `other`. Infer from arg keywords; default `other`.
- **description** — full free-text reason
- **source** — file paths, commit SHAs, or issue IDs mentioned in the arg

If user passes `--category <X>` or `--title "..."` flags, honor them.

### Step 3: Append entry

Append a structured block to `warpos-to-update.md`:

```markdown
### YYYY-MM-DD — <title>

- **Category:** <category>
- **Source:** <file paths / commits / issue ids>
- **Description:** <full free-text>
- **Status:** open

```

Also append a one-line index row to the table at the top of the file:

```
| YYYY-MM-DD | <category> | <title> | <source-shorthand> |
```

### Step 4: Confirm

Print:

```
flagged: <title>
category: <category>
source: <source>
target: warpos-to-update.md
```

## Implementation notes

Keep the skill body simple. Use `Read` to check file existence + Edit/Write to update. No subprocess, no node helper, no canonical logger — just markdown append.

If the target file is large (>100 KB) suggest manual triage; this skill is for active drift, not historical archaeology.

## Examples

```
/warp:flag gemini-cli model registry stale on 0.35.3 — bumped manifest to gemini-3.1-pro per docs but CLI 404s. Need a CLI version probe in providers.js. ISS-003. --category provider
```

```
/warp:flag agent-dispatch-guide.md not auto-loaded. Added MANDATORY READ to gamma.md + delta.md and SessionStart inject. Propagate to WarpOS canonical. --category agent
```

```
/warp:flag merge-guard hook now requires REQ-* IDs in PRDs and GS-XX-NN heading format in STORIES.md — convention should be a write-time linter not a merge-time gate. ISS-004. --category hook
```

## Companion commands

- `/warp:promote` — actually copy flagged framework changes from product repo into the canonical WarpOS clone (drains the flag file)
- `/warp:release` — full WarpOS release flow including promote
- `/warp:update` — pull latest WarpOS into this product repo

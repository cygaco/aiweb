#!/bin/bash
# Run codex compliance review for a single feature.
# Uses -C src/ to avoid AGENTS.md interference.
# Uses --ephemeral to prevent session accumulation.
# Enforces per-feature (max 3 source files) to stay under token budget.
#
# Usage: scripts/run-compliance.sh <feature> <file1> <file2> ... -- <spec-path>
# Example: scripts/run-compliance.sh profile components/ProfileEditor.tsx components/ProfilePage.tsx -- ../requirements/05-features/profile/STORIES.md
#
# Output: /tmp/compliance-<feature>.txt
#
# IMPORTANT: Do NOT batch multiple features into one call. Run this script
# once per feature. Batching causes token overload and PowerShell sandbox failures.

FEATURE="$1"
shift

# Collect files until --
FILES=()
SPEC=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--" ]]; then
    shift
    SPEC="$1"
    break
  fi
  FILES+=("$1")
  shift
done

if [[ -z "$FEATURE" || ${#FILES[@]} -eq 0 || -z "$SPEC" ]]; then
  echo "Usage: scripts/run-compliance.sh <feature> <file1> [file2...] -- <spec-path>"
  echo "  Files are relative to src/ (e.g., components/ProfileEditor.tsx)"
  echo "  Spec is relative to src/ (e.g., ../requirements/05-features/profile/STORIES.md)"
  exit 1
fi

# Guard: max 4 source files per call (token budget protection)
if [[ ${#FILES[@]} -gt 4 ]]; then
  echo "ERROR: Too many files (${#FILES[@]}). Max 4 per codex call to stay under token budget."
  echo "Split into multiple run-compliance.sh calls, one per sub-feature."
  exit 1
fi

OUTPUT="/tmp/compliance-${FEATURE}.txt"

PROMPT="Role: Compliance. You are an adversarial compliance reviewer.

Step 1: Read these source files using cat:
$(printf '%s\n' "${FILES[@]}" | sed 's/^/cat /')

Step 2: Read the spec:
cat ${SPEC}

Step 3: For each granular story (GS-*) in the spec, verify the code implements it.

Find:
- Dropped requirements (spec story with no code)
- Phantom completions (code looks implemented but is a no-op or stub)
- Hardcoded test values in production paths

Output your findings as structured text with PASS/FAIL per story."

echo "Running compliance for: ${FEATURE}"
echo "Files: ${FILES[*]}"
echo "Spec: ${SPEC}"
echo "Output: ${OUTPUT}"

# Attempt 1
codex exec --ephemeral -C src/ -s read-only -o "${OUTPUT}" "${PROMPT}" 2>&1 | tail -5

# Check if output was generated
if [[ ! -s "${OUTPUT}" ]]; then
  echo ""
  echo "WARNING: No output from attempt 1. Retrying in 60s..."
  sleep 60
  # Attempt 2
  codex exec --ephemeral -C src/ -s read-only -o "${OUTPUT}" "${PROMPT}" 2>&1 | tail -5
fi

echo ""
if [[ -s "${OUTPUT}" ]]; then
  echo "=== Result ==="
  cat "${OUTPUT}"
else
  echo "=== FAILED ==="
  echo "Codex produced no output after 2 attempts. Feature: ${FEATURE}"
  echo "Log this as compliance: skipped-codex-failure"
  exit 1
fi

#!/bin/bash
set -e

INPUT=$(cat)
WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path')
BRANCH_NAME=$(echo "$INPUT" | jq -r '.branch_name')
CWD=$(echo "$INPUT" | jq -r '.cwd')

cd "$CWD"
mkdir -p "$(dirname "$WORKTREE_PATH")"

git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" HEAD

echo "$WORKTREE_PATH"

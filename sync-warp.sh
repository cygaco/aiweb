#!/usr/bin/env bash
# sync-warp.sh — Pull settings, skills, hooks, and agent system from WarpOS
#
# Usage: ./sync-warp.sh
#
# STATUS: PLACEHOLDER — Do not run yet. WarpOS repo is being updated.
# When WarpOS is ready, this script will:
#   1. Clone/pull the WarpOS repo to a temp directory
#   2. Copy relevant artifacts into .warp/
#   3. Symlink or merge hooks into .claude/
#   4. Update CLAUDE.md with any WarpOS overlays
#   5. Clean up temp directory

set -euo pipefail

WARPOS_REPO=""  # TODO: Set WarpOS GitHub repo URL when ready
WARP_DIR=".warp"
CLAUDE_DIR=".claude"

echo "=== WarpOS Sync ==="
echo ""

if [ -z "$WARPOS_REPO" ]; then
  echo "ERROR: WarpOS repo URL not configured yet."
  echo "WarpOS is still being updated. Do not pull yet."
  echo ""
  echo "When ready:"
  echo "  1. Set WARPOS_REPO in this script"
  echo "  2. Run ./sync-warp.sh"
  exit 1
fi

echo "This script will pull from: $WARPOS_REPO"
echo "Target directories: $WARP_DIR/, $CLAUDE_DIR/"
echo ""
read -p "Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# TODO: Implement when WarpOS structure is finalized
# - git clone --depth 1 $WARPOS_REPO /tmp/warpos-sync
# - cp -r /tmp/warpos-sync/hooks/ $CLAUDE_DIR/hooks/
# - cp -r /tmp/warpos-sync/skills/ $CLAUDE_DIR/skills/
# - cp -r /tmp/warpos-sync/schemas/ $WARP_DIR/schemas/
# - cp -r /tmp/warpos-sync/patterns/ $WARP_DIR/patterns/
# - cp /tmp/warpos-sync/WarpOS.md $WARP_DIR/
# - rm -rf /tmp/warpos-sync

echo "WarpOS sync complete."

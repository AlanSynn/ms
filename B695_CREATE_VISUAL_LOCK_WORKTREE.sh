#!/usr/bin/env bash
set -euo pipefail

BASE="b695b02275d03506969f2d13c98bc38107c17e0e"
BRANCH="perf/b695-visual-lock"
WORKTREE="${1:-../ms-wt/b695-visual-lock}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to proceed: current worktree is dirty." >&2
  exit 1
fi

git cat-file -e "${BASE}^{commit}"
git worktree add "$WORKTREE" -b "$BRANCH" "$BASE"

cat <<'EOF'

Created a clean visual-lock worktree.

The script intentionally does NOT cherry-pick renderer, stage, motion-table,
telemetry, autosave, inspector, or diagnostics commits. Those require
baseline-specific backports.

Two commits may be inspected with cherry-pick -n in the new worktree:

  1716660cc24273b2723a1117c6df903871d667d2
    Lazy AI donor. Keep only AI bootstrap/worker lifecycle hunks.

  10a0a589e4e502f3ff7bd979fba2deb7bef65efa
    Four-bar early-return donor. Apply only after exact Fit output parity.

Optional non-performance correctness donor:

  97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af
    Decoded ONNX byte accounting.

Suggested inspection commands:

  cd WORKTREE
  git cherry-pick -n SHA
  git diff --cached --name-only
  git diff --cached
  # Retain only allowlisted, behavior-equivalent hunks.
  # On any conflict or unexpected file, abort:
  git cherry-pick --abort

Never run a broad cherry-pick range from b695 to perf/unified-three-sol.
EOF

echo "Worktree: $WORKTREE"

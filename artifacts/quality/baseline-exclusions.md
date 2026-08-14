# Baseline exclusions

The immutable quality-pass baseline is the committed tree at `main` / `4f3f7cc4906c2fef49b5796c2c6e43988466b9d2`.

The root checkout had pre-existing working-tree changes when G0 began. They are recorded verbatim in `base-status.txt`, remain in `/Users/alansynn/Workspace/MechAnim`, and are excluded from this integration worktree and every worker scope. No quality-pass commit may include them.

Excluded paths:

- 74 tracked deletions under `docs/`.
- `ORCHESTRATED_QUALITY_PASS_PLAN.md` (untracked task input).
- `goal-manifest.yaml` (untracked task input).
- `tracking-thread.md` (untracked user metadata).

The plan and manifest were read from the root checkout and fingerprinted in `input-sha256.txt`; they are execution inputs, not baseline source.

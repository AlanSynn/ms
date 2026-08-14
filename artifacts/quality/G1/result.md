# G1 result

Accepted product commit: `a52ef5dc5bf3f6d0dce43b525f19b7fd0e0690a4`

## Behavior verified

- Fit, recommendation, direct parametric edit, and physical-hole selection converge on the same catalog-backed commit authority.
- Accepted fabrication candidates contain normalized physical selections and compiler-ready validation; defaulted selections are re-derived when placement changes, while explicit selections are preserved.
- Rejected edits preserve the prior aggregate. Exact and semantic no-ops return the prior `MechanismConfig` and `ProjectState` identities and dispatch no history write.
- Every advertised physical candidate across all six fabrication families passes both selection preflight and final commit authority with the advertised identity preserved.
- A closed recommendation sheet performs zero recommendation builds.
- Prepared kinematics separates structural preparation from numeric frame sampling. Frame sampling performs no physical-connection resolution, catalog phase lookup, cam normalization, or gear-linkage normalization.
- Candidate coordinates and four-bar blank poses can be projected from prepared physical data without catalog enumeration on ordinary frames.
- The single approved planetary ring profile remains authoritative; renderer-envelope parity now tests only buildable alternates.

## Verification boundary

- `bun run test` reaches the G2-owned `mechanism-v2-schema-inventory` gate after all preceding G1 and cross-consumer contracts pass.
- The final-tree non-G2 suite passes when the two already-routed G2 aggregate tests are excluded.
- `bun run build`, `bun run build:tauri-frontend`, and `git diff --check` pass.
- The Tauri build still reports the baseline unresolved Manrope font warning; G6 owns that release/configuration defect.

## Routed failures

- G2: `fabrication/board-final.svg` hashes to `05aeb4f2...`, while `fabrication/fabrication-v2-reviewed-oracle.json` pins `9d0202b8...`.
- G2: the 30-by-30, 10 mm-pitch board fixture reports `No board-snapped graph anchor` for the default four-bar. The same result reproduces on the immutable baseline.

## Historical coverage

Nineteen single-lane G1 commits and twenty-six G1 hunk rows are dispositioned `VERIFIED_CLEAN_IMPLEMENTATION`. The accepted behavior is the current clean implementation plus product commit `a52ef5d`; no historical commit was cherry-picked. See `historical-dispositions.md` and the ledgers.

## Remaining risk

G1 freezes pure frame-preparation interfaces but does not wire renderer component lifecycles. G3 must memoize the prepared data at structural boundaries and prove the production playback loop does not invoke structural work per frame.

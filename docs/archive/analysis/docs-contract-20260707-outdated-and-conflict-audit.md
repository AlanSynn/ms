# Docs contract audit (2026-07-07)

## Summary
- Scope: find docs clash w/ repo reality, legacy vs active contracts.
- Checks: code-path + link validity, AGENTS/README/index alignment, legacy `src/automataii/*` refs, Active/Cold label consistency.
- Tools: `rg`, Python ref scans, `token-router` slices.

## Completed moves / deletions
1. `docs/platform-rebuild-porting-flow.md`
   - Visible under hot root path; held mixed legacy `src/automataii/...` refs.
   - Moved to `docs/archive/plans/platform-rebuild-porting-flow.md` (Cold archive).
   - Reason: useful as porting provenance, not active SSOT.

## Conflicts/inconsistencies checked
1. `docs/platform-rebuild-porting-flow.md` reference paths
   - Risk: multiple docs still referenced old root path.
   - Files updated to archive path:
     - `docs/README.md`
     - `docs/index.md`
     - `docs/subsystem-governance-and-mechanism-contracts.md`
     - `docs/archive/plans/canva-video-editor-workspace-plan.md`
     - `docs/archive/ports/to-port-web-onnx/copy_manifest.json`
2. `src/automataii/*` legacy paths
   - Confirmed legacy-only context in `docs/mechanism-reference/README.md` + porting materials.
   - Kept w/ explicit historical markers.


3. `docs/prd/mechanism-workbench-instance-board-plan.md` file authority naming
   - Risk: authority list named local filenames (`coordinates.ts`, `project.ts`, `fabrication.ts`) without `utils/` namespace in text.
   - Impact: minor ambiguity for readers tracing active seams, though not a broken link.
   - Resolution: updated to `utils/coordinates.ts`, `utils/project.ts`, `utils/fabrication.ts`.
4. `docs/mechanism-reference/README.md` catalog evidence
   - Risk: legacy file name `mechanism_catalog.json` in `geneva_drive` row.
   - Impact: mismatch with current provenance snapshot naming.
   - Resolution: updated to `source/mechanism-catalog.snapshot.json`.

## Additional validation
- Markdown cross-links checked: zero missing links.
- Governance map checks:
  - `docs/README.md` + `docs/index.md` now include moved `platform-rebuild` archive entry.
  - No active `AGENTS.md`/`README.md` contradiction from moved doc.

## Pending / optional follow-up
- No hard deletion required in this pass; only two wording corrections were needed for seam-name clarity.
- Archive-only cold set remains intact and remains for provenance evidence.
- Legacy docs not needed for reproducible decisions → mark archive-only, remove in later cleanup pass.
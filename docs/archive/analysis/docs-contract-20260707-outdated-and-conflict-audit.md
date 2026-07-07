# Docs contract audit (2026-07-07)

## Summary
- Scope: find docs conflicting with repo reality, or legacy vs active contracts.
- Checks: code-path + link validity, AGENTS/README/index alignment, legacy `src/automataii/*` refs, Active/Cold label consistency.
- Tools: `rg`, Python reference scans, `token-router` slices.

## Completed moves / deletions
1. `docs/platform-rebuild-porting-flow.md`
   - Still visible under hot root path; held mixed legacy `src/automataii/...` refs.
   - Moved to `docs/archive/plans/platform-rebuild-porting-flow.md` (Cold archive).
   - Reason: useful as historical porting provenance, not active SSOT.

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
   - Kept with explicit historical markers.

## Additional validation
- Markdown cross-links checked: zero missing links.
- Governance map checks:
  - `docs/README.md` + `docs/index.md` now include moved `platform-rebuild` archive entry.
  - No active `AGENTS.md`/`README.md` contradiction remains from moved document.

## Pending / optional follow-up
- No further auto deletion identified this pass.
- Legacy docs no longer needed for reproducible decisions can be marked archive-only, removed in later cleanup pass.
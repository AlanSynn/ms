# Codebase Cleanup + Architecture Split Plan

Status: active cleanup plan
Last refreshed: 2026-06-29

## Goal

Keep MotionSmith easy to change: small files, one domain rule source, no duplicate canvas/mechanism logic.

## Current hotspots

| File | Lines | Decision |
| --- | ---: | --- |
| `App.tsx` | 4087 | Split first. Keep shrinking into stage/domain seams. |
| `components/ThreePuppetPreview.tsx` | 1326 | Split after App seams stabilize. Keep renderer behavior intact. |
| `utils/fabrication.ts` | 1049 | Split only along existing domain seams: manifest lookup, render plan, validation/export. |
| `utils/project.ts` | 1022 | Split only reducer/defaults/migrations if edits continue. |
| `components/TrackingModal.tsx` | 930 | Leave until tracking flow changes. |
| `components/Canvas.tsx` | 919 | Leave until mechanism renderer unification pass. |
| `components/Controls.tsx` | 715 | Deleted: runtime-unused legacy UI; contract test now locks absence. |

## Split order

1. **App shell helpers**
   - Done: shared stage frame/navigation moved to `components/stages/stageLayout.tsx`.
   - Remaining shell-only constants stay in `App.tsx` until they have a second user. No abstraction for its own sake.

2. **Stage components**
   - Done: `BlueprintExport` moved to `components/stages/blueprint/BlueprintExport.tsx`; assembly workbench moved to `components/stages/assembly/AssemblyWorkbench.tsx`.
   - Next: move `MechanismFoundry`, `MechanismDesign`, `PathEditor`, `CharacterSelection`, `AssemblyGuide`, `Options` only as touched.
   - Each stage receives data/actions; no stage owns mechanism rules.

3. **Domain helpers**
   - Mechanism fitting/recommendations leave `App.tsx` for a pure helper module.
   - Done: assembly playback derivation lives in `utils/assemblyPlayback.ts`.
   - Cut-outline math leaves `App.tsx` for a pure helper module.

4. **Renderer split**
   - `ThreePuppetPreview.tsx`: keep React wrapper small; move geometry/material/cache helpers to one renderer helper if repeated.
   - Avoid new renderer framework.

5. **Delete legacy**
   - `components/Controls.tsx` removed because runtime import graph did not use it. Future legacy UI should not be kept for tests only.

## Rules

- One reason per file. UI file composes; domain file computes; renderer file draws; exporter file exports.
- No one-implementation interfaces. Use plain functions and existing types.
- New domain rule enters `utils/mechanismReference.ts` / `utils/mechanismFeatureRegistry.ts` / fabrication manifest first, not stage UI.
- Split by extraction only: move code, keep names, then test. No redesign mixed into file moves.
- Commit per seam.

## Verification

After each split:

```bash
bun run test:contracts
bun run build
```

After UI/renderer movement:

```bash
bun run test:browser
```


## Cleanup applied 2026-06-29

- Removed generated local artifacts: `.DS_Store`, Python `__pycache__`, `dist/`, `test-results/`, `src-tauri/target/`, `src-tauri/gen/`.
- Moved large ignored ONNX reference repo out of docs to local archive: `../MechAnim-local-archive/.../docs-to-port-web-onnx/repo`.
- Removed runtime-unused source: `components/Controls.tsx`, `utils/zStack.ts`.

- Extracted shared stage frame/nav shell to `components/stages/stageLayout.tsx`.
- Extracted blueprint stage to `components/stages/blueprint/BlueprintExport.tsx`.
- Extracted assembly workbench plus assembly playback derivation to `components/stages/assembly/AssemblyWorkbench.tsx` and `utils/assemblyPlayback.ts`.
- `App.tsx` reduced from 4444 to 4087 lines.

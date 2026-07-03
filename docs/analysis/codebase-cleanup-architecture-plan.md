# Codebase Cleanup + Architecture Split Plan

Status: active cleanup plan
Last refreshed: 2026-07-03

## Goal

Keep MotionSmith easy to change without changing behavior: small files, one domain rule source, no duplicate canvas/mechanism logic, and no visible control that does nothing.

## Button and command audit lock

- `utils/appCommands.ts` is the only shell command registry. Menu labels, shortcuts, and command ids come from that registry.
- `App.tsx` must keep `commandHandlers` typed as `Record<AppCommandId, () => void>` so adding a menu command requires adding one handler.
- `components/AppShell.tsx` renders menu items with `data-command-id` and calls the registry-backed handler.
- `tests/project-contract.test.ts` statically scans the primary UI files and fails if a `<button>` has no `onClick`, `onPointerDown`, submit type, or command-registry id.
- `tests/browser/workflow.spec.ts` exercises every top menu command and requires a visible result, download, file chooser, stage change, modal, status change, undo, or redo.

## Warning fixes locked

- Rapier warning boundary: `utils/physicsKernel.ts` filters only the exact upstream `@dimforge/rapier3d-compat@0.19.3` wasm-bindgen initialization deprecation and restores `console.warn` in `finally`. All other warnings/errors must still surface.
- Splash font URL: `index.html` must load Manrope through `%BASE_URL%fonts/manrope-800-latin.woff2` so Vite, GitHub Pages `/ms/`, and Tauri builds agree.
- Chunk budget: `vite.config.ts` keeps `chunkSizeWarningLimit: 2400` because Rapier, ONNX, and the current monolithic app intentionally create lazy browser chunks. This is not permission for growth; `App.tsx` remains the first refactor target.

## Current hotspots

Measured on 2026-07-03.

| File | Lines | Decision |
| --- | ---: | --- |
| `App.tsx` | 10307 | First split. Extract by behavior-preserving seams only: command handlers, stage components, foundry/design renderer adapters, import dialogs, then helper reducers. No redesign mixed into extraction. |
| `components/stages/character/ProgressBlock.tsx` | 84 | Done: character import progress UI lives outside the app shell. Keep it presentation-only; ONNX/import state remains canonical `ProjectState.processing`. |
| `components/ui/InspectorControls.tsx` | 70 | Done: shared inspector sliders/toggles live outside the app shell. Keep them presentation-only; stage/domain handlers own state mutation. |
| `components/stages/character/PartInspector.tsx` | 276 | Done: selected-part inspector owns part toggles, cut controls, and artwork/transform fields outside the app shell. Keep it dispatch-only; no parallel part state except transient cut selection. |
| `components/stages/character/CutOutlineEditorDialog.tsx` | 379 | Done: cut-outline editor owns modal pointer editing and contour viewport math outside the app shell. Keep it under the character seam until a pure contour helper is needed elsewhere. |
| `components/stages/character/SkeletonInspector.tsx` | 225 | Done: skeleton inspector owns joint/anchor editing outside the app shell. Keep it dispatch-only; joint math stays in `ProjectState` actions and coordinate helpers. |
| `components/stages/character/CharacterImportOverlays.tsx` | 165 | Done: character import status/review overlays live outside the app shell. Keep it presentation-only; package acceptance and ONNX/import state remain App/ProjectState-owned. |
| `utils/mechanismRecommendations.ts` | 633 | Done: pure recommendation/fitting seam shared by Foundry export and recommendation flows. Keep deterministic; no DOM/storage side effects. |
| `utils/foundryCamera.ts` | 140 | Done: pure Foundry camera/projection seam shared by Foundry and Design previews. Keep deterministic; no DOM/storage side effects. |
| `components/ThreePuppetPreview.tsx` | 1550 | Split after `App.tsx` seams stabilize. Keep one Three/Rapier boundary; move geometry/material/cache helpers only when duplicated or directly touched. |
| `utils/project.ts` | 1439 | Split only reducer/defaults/migrations if touched. Preserve snapshot compatibility and `ProjectState` shape. |
| `utils/fabrication.ts` | 1364 | Split manifest lookup, render plan, validation/export. Fabrication rules still come from `fabrication/generate_fabrication_templates.py` and `utils/fabricationContract.ts`. |
| `components/Canvas.tsx` | 1025 | Leave until renderer unification pass. Do not create a second canvas engine. |
| `components/TrackingModal.tsx` | 930 | Leave until import flow changes. Keep browser-local ONNX behavior. |
| `utils/optimizer.ts` | 791 | Split only if mechanism fitting changes. Do not weaken fit constraints. |
| `utils/mechanismReference.ts` | 688 | Keep as mechanism recipe source; split only generated/reference tables if they grow again. |
| `utils/webOnnx.ts` | 677 | Keep lazy/cached ONNX boundary. Split model loading from image post-processing only if touched. |
| `utils/kinematics.ts` | 662 | Keep pure mechanism math together until a mechanism-specific solver needs extraction. |

## Golden-master refactor gate

Baseline: commit `e32cd7e` preserves the audited MotionSmith state before the `App.tsx` refactor.

The contract test now hashes a stable golden master for:

- sample `ProjectState` serialization
- guided waving-arm lesson serialization
- one mechanism snapshot plus the full mechanism snapshot set
- toon scene projection
- SVG and DXF export output
- fabrication stacks

This is the refactor tripwire. Extraction-only work should keep these hashes stable. If a hash changes, stop and prove the behavior change is intentional before updating the expected value.

Golden masters do not replace UI evidence. App/stage JSX moves also need the command-contract test plus the relevant production-preview Playwright workflow, because hashes do not prove DOM wiring, menu behavior, drag/scroll boundaries, or visible stage routing.

Current evidence:

```bash
bun run test
bun run build
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=4 bunx playwright test tests/browser/workflow.spec.ts --workers=4
```

All gates passed; the production-preview browser workflow reported 40 passed tests.

## Split order

1. **Command and app shell seams**
   - Keep `AppShell` rendering and command registry separate from app-state mutation.
   - Done: `utils/appCommandHandlers.ts` owns the typed command handler factory that receives state setters/actions and stays locked by the command contract.
   - Done: `utils/foundryCamera.ts` owns deterministic Foundry camera presets, clamp/project/unproject helpers, and shared overlay sizing for Foundry and Design previews.
   - Done: `utils/mechanismRecommendations.ts` owns fabrication-gated recommendation fitting and fallback logic outside the app shell.

2. **Stage components**
   - Done: shared stage frame/navigation lives in `components/stages/stageLayout.tsx`.
   - Done: `BlueprintExport` lives in `components/stages/blueprint/BlueprintExport.tsx`.
   - Done: assembly workbench lives in `components/stages/assembly/AssemblyWorkbench.tsx`.
   - Done: `components/stages/character/ProgressBlock.tsx` owns the import progress card and status label outside `App.tsx`.
   - Done: `components/ui/InspectorControls.tsx` owns shared mini number and toggle controls used by inspectors.
   - Done: `components/stages/character/PartInspector.tsx` and `CutOutlineEditorDialog.tsx` own the shared part/cut inspector leaf used by Character and Path.
   - Done: `components/stages/character/SkeletonInspector.tsx` owns shared joint/anchor editing used by Character and Path.
   - Done: `components/stages/character/CharacterImportOverlays.tsx` owns import progress and pending package review overlays used by Character.
   - Next lowest-risk stage seam: extract `CharacterSelection` after its setup/list/import review leaves are small enough to move without changing behavior, then extract `PathEditor`. Move Options and Assembly Guide wrappers after those shared character leaves are clean. Move `MechanismFoundry`, `MechanismDesign`, and `DesignFoundryPreview` only after their pure adapters are smaller. Each stage receives data/actions; no stage owns mechanism rules.

3. **Domain helpers**
   - Done: mechanism fitting/recommendations live in `utils/mechanismRecommendations.ts`.
   - Assembly playback derivation remains in `utils/assemblyPlayback.ts`.
   - Done: cut-outline math left `App.tsx` with the cut editor seam; extract it to a pure helper only when another consumer appears.

4. **Renderer split**
   - `ThreePuppetPreview.tsx`: keep React wrapper small; move repeated geometry/material/cache helpers to renderer helpers.
   - Avoid new renderer frameworks unless a contract test proves the imperative Three/Rapier boundary cannot meet requirements.

5. **Delete legacy**
   - Runtime-unused `components/Controls.tsx` and `utils/zStack.ts` are gone and locked by contract tests.
   - Future legacy UI must be deleted or given a real runtime owner; do not keep files for tests only.

## Rules

- One reason per file. UI composes; domain computes; renderer draws; exporter serializes.
- No one-implementation interfaces. Use plain typed functions and existing types.
- New mechanism behavior enters `utils/mechanismReference.ts`, `utils/mechanismFeatureRegistry.ts`, `utils/kinematics.ts`, and fabrication manifest/contracts first, not stage UI.
- Split by extraction only: move code, preserve names/behavior, then test. No redesign mixed into file moves.
- Keep `ProjectState` as the domain aggregate root. Stage components receive data/actions; they do not own parallel canonical state.
- New seams must be harness-friendly: deterministic inputs, typed outputs, and no hidden time/random/storage/DOM side effects outside the module's named boundary.
- Golden-master hashes are behavior contracts. Do not update them during pure extraction unless a deliberate behavior change is documented and separately tested.
- Keep all UI copy English-only and compact.
- Commit per seam.

## Verification

After each split:

```bash
bun run test
bun run build
```

After UI/renderer movement:

```bash
env -u NO_COLOR PLAYWRIGHT_WORKERS=4 bunx playwright test tests/browser/workflow.spec.ts --workers=4
```

Stop only when the relevant contract, build, and browser evidence passes without new warnings.

## Cleanup applied 2026-06-29

- Removed generated local artifacts: `.DS_Store`, Python `__pycache__`, `dist/`, `test-results/`, `src-tauri/target/`, `src-tauri/gen/`.
- Moved large ignored ONNX reference repo out of docs to local archive: `../MechAnim-local-archive/.../docs-to-port-web-onnx/repo`.
- Removed runtime-unused source: `components/Controls.tsx`, `utils/zStack.ts`.
- Extracted shared stage frame/nav shell to `components/stages/stageLayout.tsx`.
- Extracted blueprint stage to `components/stages/blueprint/BlueprintExport.tsx`.
- Extracted assembly workbench plus assembly playback derivation to `components/stages/assembly/AssemblyWorkbench.tsx` and `utils/assemblyPlayback.ts`.

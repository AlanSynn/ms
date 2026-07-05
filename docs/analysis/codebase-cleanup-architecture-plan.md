# Codebase Cleanup + Architecture Split Plan

Status: active cleanup plan
Last refreshed: 2026-07-04

## Goal

Keep MotionSmith easy to change without changing behavior: small files, one domain rule source, no duplicate canvas/mechanism logic, and no visible control that does nothing.

## Button and command audit lock

- `utils/appCommands.ts` is the only shell command registry. Menu labels, shortcuts, and command ids come from that registry.
- `hooks/useAppProjectCommands.ts` must keep `commandHandlers` typed as `Record<AppCommandId, () => void>` so adding a menu command requires adding one handler while `App.tsx` only wires the hook into the shell.
- `components/AppShell.tsx` renders menu items with `data-command-id` and calls the registry-backed handler.
- `tests/project-contract.test.ts` statically scans the primary UI files and fails if a `<button>` has no `onClick`, `onPointerDown`, submit type, or command-registry id.
- `tests/browser/workflow.spec.ts` exercises every top menu command and requires a visible result, download, file chooser, stage change, modal, status change, undo, or redo.

## Warning fixes locked

- Rapier warning boundary: `utils/physicsKernel.ts` filters only the exact upstream `@dimforge/rapier3d-compat@0.19.3` wasm-bindgen initialization deprecation and restores `console.warn` in `finally`. All other warnings/errors must still surface.
- Splash font URL: `index.html` must load Manrope through `%BASE_URL%fonts/manrope-800-latin.woff2` so Vite, GitHub Pages `/ms/`, and Tauri builds agree.
- Chunk budget: `vite.config.ts` keeps `chunkSizeWarningLimit: 2400` because Rapier, ONNX, and the current monolithic app intentionally create lazy browser chunks. This is not permission for growth; `App.tsx` remains the first refactor target.

## 2026-07-04 permission recovery audit

- Source of truth is back to the original `/Users/alansynn/Documents/MechAnim` working tree; no temporary clone is authoritative.
- `App.tsx` is now a tiny composition entry; `hooks/useMotionSmithAppController.ts` owns top-level state/action orchestration plus the already-extracted mechanism action, stage navigation, and stage-router prop grouping seams. The next App-adjacent seams are controller subdomain splits, not renderer or fabrication logic.
- Retired the dead `components/Canvas.tsx` seam because runtime code no longer imported it; contracts now pin that it stays deleted.
- Completed low-risk Assembly geometry seam: DOM-free coordinate, smoothing, and character projectors now live in `components/stages/assembly/assemblyGeometry.ts`.
- Completed low-risk Blueprint panel seams: left workflow controls live in `components/stages/blueprint/BlueprintControlPanel.tsx`; right recipe detail/sensemaking/stack summary lives in `components/stages/blueprint/BlueprintDetailPanel.tsx`.
- Completed low-risk App mechanism action seam: mechanism update, Foundry export, recommendation apply, optimizer loop, and SVG/DXF export actions now live in `hooks/useAppMechanismActions.ts`.
- Completed low-risk App stage navigation seam: stage handoff gate, recovery dispatch, stage-open status, and `goStage` wiring now live in `utils/appStageNavigation.ts`.
- Next safe production seams: continue splitting pure `utils/fabrication.ts` concerns behind golden-master output hashes; broad validation/export/package movement still needs stronger harnesses.
- High-risk seams that need stronger harnesses before editing: `components/ThreePuppetPreview.tsx`, `utils/project.ts`, `utils/fabrication.ts`, and `components/TrackingModal.tsx`.
- Local ignored junk can be removed when seen: `.DS_Store`, `resources/.DS_Store`, `resources/examples/.DS_Store`, `fabrication/__pycache__/`, `fabrication/board-final.svg`, and `test-results/`. Do not delete `.agents/`, `.omx/`, `docs/to-port-web-onnx/`, `dist/`, or `node_modules/` as cleanup.


## 2026-07-04 team refactor audit synthesis

- OMX team audit `read-only-production-fe7e2fac` completed with three read-only architect lanes over `.omx/context/production-refactor-team-20260704T225118Z.md`.
- Team consensus: completed narrow `AssemblyGuide` playback/model extractions, then approved cycle-free `utils/fabricationProfiles.ts`, `utils/numberFormat.ts`, `utils/fabricationStackModel.ts`, `utils/fabricationReadiness.ts`, and `utils/fabricationRenderPlan.ts` pure fabrication seams, plus the deterministic `utils/fabricationBlueprintSvg.ts` renderer seam, pure `utils/fabricationSizing.ts` sizing seam, import-free `utils/simplePdf.ts` PDF primitive seam, pure `utils/fabricationCharacterPrintLayout.ts` character cut-sheet layout seam, and focused `utils/fabricationRecipes.ts` package recipe derivation seam; defer `ThreePuppetPreview`, broad `utils/project.ts`, broad `utils/fabrication.ts`, and any further `TrackingModal` media-flow movement until stronger targeted harnesses exist.
- Worker-3 coverage finding: `components/TrackingModal.tsx` had App-level mount wiring and locked-part Trace browser coverage, but lacked a harnessable seam for manual point smoothing/transfer.
- Implemented next safe slice: `utils/trackingPath.ts` now owns Catmull-Rom smoothing and world-path normalization; `TrackingModal` delegates to it without changing labels, controls, media flow, or transfer semantics.
- Contract lock: `tests/project-contract.test.ts` asserts the TrackingModal helper seam, open/closed smoothing sample counts, short-path passthrough, and centered/flipped/closed transfer output.
- Runtime-state hygiene: `.omc/` is local OMX/HUD state and must stay ignored like `.omx/`; English-only scanning excludes it so prompt caches cannot fail product-copy checks.
- Current validated gates for this slice: `bun run test`, `bun run build`, targeted production-preview Playwright for Options/context-help plus end-to-end/Assembly paths, and `git diff --check`.

## Current hotspots

Measured on 2026-07-03.

| File                                                          | Lines | Decision                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                                                     |    10 | Done: tiny composition entry. App imports `useMotionSmithAppController`, passes returned props into `AppWorkspaceShell`, and owns no state, refs, stage wiring, domain rules, shell markup, renderer geometry, mechanism fitting, fabrication rules, or export logic. |
| `hooks/useMotionSmithAppController.ts`                         |   324 | Done: application controller hook owns top-level state/action orchestration and returns typed `AppWorkspaceShellProps`. Keep it orchestration-only and JSX-free; no renderer geometry, fabrication rules, mechanism math, or stage markup. Split future subdomains out with golden-master gates before adding behavior. |
| `components/AppWorkspaceShell.tsx`                             |   221 | Done: workspace shell chrome lives outside App.tsx; owns header, workflow rail, quick toolbar, stage router host, status strip/footer, startup/help/about/recommendation/tracking modal mounts. Keep it presentation-only; no ProjectState mutation or fabrication validation. |
| `components/AppShell.tsx`                                      |     9 | Done: AppShell is now a compatibility re-export barrel for shell leaves. Keep it import-stable until call sites migrate; do not add JSX, state, or domain imports here. |
| `components/shell/workflowStages.ts`                            |    22 | Done: workflow stage labels and shared playback stage list live outside AppShell. Keep it static metadata only. |
| `components/shell/GettingStartedDialog.tsx`                    |   133 | Done: Getting Started modal is a shell leaf outside AppShell. Keep it prop-only; startup, character import, and project actions stay App/project-hook owned. |
| `components/shell/OnnxCacheStatusPill.tsx`                      |    15 | Done: ONNX cache chip is a shell leaf outside AppShell. Keep it status-display only; Web ONNX cache policy remains in `utils/webOnnx.ts`. |
| `components/shell/WorkflowRail.tsx`                             |    23 | Done: workflow rail and version mark are shell leaves outside AppShell. Keep it navigation-only; stage changes stay caller-owned. |
| `components/shell/TopCommandBar.tsx`                            |    29 | Done: top menu rendering is a shell leaf outside AppShell. Keep it command-dispatch only; command inventory stays in `utils/appCommands.ts`. |
| `components/shell/ShellDialogs.tsx`                             |    51 | Done: shortcut/about dialogs are shell leaves outside AppShell. Keep them presentation-only; command behavior stays in command handlers. |
| `components/shell/CanvasZoomToolbar.tsx`                        |    14 | Done: shared canvas zoom controls live outside AppShell. Keep it viewport-only; scene/canvas ownership stays in stage components. |
| `components/shell/WorkspacePlayerDock.tsx`                      |    81 | Done: floating workspace player dock view lives outside AppShell. Keep drag/playback UI here; stage playback state stays in `useWorkspacePlayerDock` and `useWorkspacePlaybackLoop`. |
| `components/shell/WorkflowStatusStrip.tsx`                      |     7 | Done: compact workflow status strip lives outside AppShell. Keep it text-only; status derivation stays in `utils/workflowStatus.ts`. |
| `utils/workflowStatus.ts`                                      |    63 | Done: workflow status text is derived outside the workspace shell from ProjectState plus fabrication validation. Keep validation decisions here or deeper in domain utilities, not in presentation components. |
| `utils/appStageNavigation.ts`                                  |    45 | Done: stage handoff gate, recovery dispatch, stage-open status, and `goStage` wiring live outside App. Keep it side-effect wiring only; handoff rules stay in `utils/project.ts`, labels stay shell metadata, and no stage UI or ProjectState mutation rules belong here. |
| `utils/appStageRouterProps.ts`                                 |   111 | Done: App stage-router prop grouping/flattening lives outside App. Keep it pure and type-only against `AppStageRouterProps`; no ProjectState mutation, renderer geometry, or stage markup belongs here. |
| `components/AppStageRouter.tsx`                               |   243 | Done: shared stage-to-component routing and player-dock placement live outside App. Keep it presentation-only; ProjectState mutation callbacks and domain/fabrication rules stay in App hooks/utils until their own seam is extracted. |
| `hooks/useAppDerivedState.ts`                                  |    65 | Done: selected part/path/mechanism, playback duration, sorted parts, and global mechanism config are derived outside App. Keep it pure/read-only; ProjectState mutation stays in action hooks/utils. |
| `hooks/useWorkspacePlayerDock.tsx`                            |    83 | Done: workspace player dock visibility, Path/Design/Assembly player wiring, and Assembly step dock state live outside App. Keep it UI/state-only; shared rAF playback lives in `useWorkspacePlaybackLoop.ts` and assembly recipe rules stay in `AssemblyGuide`/`utils/assemblyPlayback.ts`. |
| `hooks/useWorkspacePlaybackLoop.ts`                            |    76 | Done: shared Path/Design playback rAF loop, `SHARED_PLAYBACK_STAGES` guard, `animationDeltaRadians` timing, and Path draw-mode reset live outside App. Keep it effect-only; no ProjectState mutation, mechanism fitting, or Assembly recipe rules. |
| `hooks/useModalInertEffect.ts`                                |    28 | Done: startup/help/about modal inert, `aria-hidden`, and body/document modal classes live outside App. Keep it DOM-effect only; modal state, project import, and start actions stay App-owned. |
| `resources/starterImageTemplates.ts`                          |    22 | Done: starter image template assets and labels live outside App. Keep it static asset metadata only; import processing, pending-review state, and package replacement stay App/project-command owned. |
| `hooks/useAppPathActions.ts`                                  |    89 | Done: Path draw mode, tracking modal state, path point upsert/validation, and tracked-path transfer live outside App. Keep it path-action only; no canvas rendering, playback timing, or mechanism fitting. |
| `hooks/useAppCharacterImportActions.ts`                      |   284 | Done: character ONNX image import, starter image/package/project import, pending review, replacement review, skeleton export, and Getting Started entry actions live outside App. Keep it intake/review-only; no mechanism fitting, canvas rendering, or stage UI. |
| `hooks/useAppMechanismActions.ts`                           |   253 | Done: mechanism update, Foundry export, recommendation apply, optimizer loop, and SVG/DXF export actions live outside App. Keep it ProjectState-action only; no stage markup, renderer geometry, or fabrication validation rules. |
| `hooks/useAppCommandBindings.ts`                              |    36 | Done: application keyboard shortcut binding owns latest-handler ref, typing-target guard, and global keydown dispatch outside App shell. Keep it hook-only; command registry/handler creation stay in utils.                                                                                                                          |
| `hooks/useAppProjectCommands.ts`                              |   292 | Done: project/session command actions own new/save/copy/autosave recovery/workspace layout/zoom/undo/redo/lesson/sample command wiring outside App shell. Keep command ids in `utils/appCommands.ts` and pure handler mapping in `utils/appCommandHandlers.ts`.                                                                       |
| `hooks/useAppOnnxBootstrap.ts`                                |    88 | Done: startup AI cache warmup, static boot-loader DOM lifecycle, and manual ONNX cache retry status live outside App shell. Keep browser-local inference/cache policy in `utils/webOnnx.ts`.                                                                                                                                          |
| `hooks/useProjectHistory.ts`                                  |    98 | Done: ProjectState history, undo/redo stacks, reducer dispatch, and reducer self-check live outside App shell. Keep it pure React state plumbing; ProjectState mutation rules stay in `utils/project.ts`.                                                                                                                             |
| `hooks/useProjectAutosave.ts`                                 |    23 | Done: browser autosave interval and latest-project ref live outside App shell. Keep it persistence-only; storage keys and legacy migration stay in `utils/projectPersistence.ts`.                                                                                                                                                     |
| `utils/projectPersistence.ts`                                 |   158 | Done: MotionSmith storage namespace, legacy migration, autosave snapshots, project snapshot filenames, and workspace layout serialization/restore live outside App shell. Keep it DOM-free except localStorage.                                                                                                                       |
| `components/stages/character/ProgressBlock.tsx`               |    84 | Done: character import progress UI lives outside the app shell. Keep it presentation-only; ONNX/import state remains canonical `ProjectState.processing`.                                                                                                                                                                             |
| `components/ui/InspectorControls.tsx`                         |    70 | Done: shared inspector sliders/toggles live outside the app shell. Keep them presentation-only; stage/domain handlers own state mutation.                                                                                                                                                                                             |
| `components/stages/character/PartInspector.tsx`               |   276 | Done: selected-part inspector owns part toggles, cut controls, and artwork/transform fields outside the app shell. Keep it dispatch-only; no parallel part state except transient cut selection.                                                                                                                                      |
| `components/stages/character/CutOutlineEditorDialog.tsx`      |   379 | Done: cut-outline editor owns modal pointer editing and contour viewport math outside the app shell. Keep it under the character seam until a pure contour helper is needed elsewhere.                                                                                                                                                |
| `components/stages/character/SkeletonInspector.tsx`           |   225 | Done: skeleton inspector owns joint/anchor editing outside the app shell. Keep it dispatch-only; joint math stays in `ProjectState` actions and coordinate helpers.                                                                                                                                                                   |
| `components/stages/character/CharacterImportOverlays.tsx`     |   165 | Done: character import status/review overlays live outside the app shell. Keep it presentation-only; package acceptance and ONNX/import state remain App/ProjectState-owned.                                                                                                                                                          |
| `components/stages/character/CharacterLessonOwnership.tsx`    |    47 | Done: guided lesson ownership cues/actions live outside the app shell. Keep it presentation-only; lesson reset/edit handlers stay in App command wiring.                                                                                                                                                                              |
| `components/stages/character/CharacterSetupPanel.tsx`         |    53 | Done: Character setup right-inspector wrapper lives outside the app shell. Keep it layout-only; PartInspector/SkeletonInspector own edit controls and ProjectState actions own mutation.                                                                                                                                              |
| `components/stages/character/CharacterImportControls.tsx`     |   103 | Done: character import entry controls live outside the app shell. Keep it ref/input-only; package processing and ProjectState mutation stay in App/project actions.                                                                                                                                                                   |
| `components/stages/character/CharacterSelection.tsx`          |   259 | Done: Character stage wrapper lives outside the app shell. Keep it orchestration-only for Character panes; import/package handlers and ProjectState history remain App-owned.                                                                                                                                                         |
| `components/stages/path/PathEditor.tsx`                       |   376 | Done: Path stage wrapper lives outside the app shell. Keep it orchestration-only; SceneSketch, PartShape, workflow, canvas, and inspector panes own view code while motion/coordinate math stays in utils.                                                                                                                            |
| `components/stages/path/SceneSketch.tsx`                      |   398 | Done: editable 2D path canvas owns SVG pointer/draw wiring and path test ids outside App. Keep it UI-only; coordinate transforms stay in utils/coordinates.                                                                                                                                                                           |
| `components/stages/path/PartShape.tsx`                        |   132 | Done: Path Editor part rendering owns artwork/plate clipping outside App. Keep fabrication outline math in shared part geometry helpers.                                                                                                                                                                                              |
| `components/stages/path/MechanismRecommendationSheet.tsx`     |   127 | Done: Path recommendation modal lives outside the app shell. Keep it UI-only; scoring and fabrication fitting stay in utils/mechanismRecommendations.                                                                                                                                                                                 |
| `components/stages/mechanism/MechanismParametricEditor.tsx`   |   373 | Done: shared Foundry/Design compact gear, linkage, idler, and cam profile controls live outside the app shell. Keep it UI-only; mechanism/fabrication rules stay in utils.                                                                                                                                                            |
| `components/stages/mechanism/mechanismParamPolicy.ts`         |    88 | Done: shared numeric parameter metadata, visibility policy, and clamping live in a deterministic helper used by Foundry and Design. Keep it pure and test-harness friendly.                                                                                                                                                           |
| `utils/mechanismRecommendations.ts`                           |   633 | Done: pure recommendation/fitting seam shared by Foundry export and recommendation flows. Keep deterministic; no DOM/storage side effects.                                                                                                                                                                                            |
| `utils/foundryCamera.ts`                                      |   140 | Done: pure Foundry camera/projection seam shared by Foundry and Design previews. Keep deterministic; no DOM/storage side effects.                                                                                                                                                                                                     |
| `components/stages/foundry/MechanismLinkagePreview.tsx`       |   800 | Done: Foundry SVG mechanism preview leaf lives outside the app shell and delegates pure topology/path helpers. Keep it behavior-identical; split more internal shape helpers only after renderer contracts stay green.                                                                                                                |
| `components/stages/foundry/mechanismLinkagePreviewHelpers.ts` |    76 | Done: Foundry SVG preview pure topology labels, axis/vector math, rack teeth, cam profile path, and coordinate role summaries live outside the preview component. Keep it pure and deterministic.                                                                                                                                     |
| `components/stages/foundry/foundryPreviewGeometry.ts`         |    23 | Done: fitted gear-center helper shared by SVG and Three previews. Keep it pure and deterministic so Foundry/Design share the same fitted axle positions.                                                                                                                                                                              |
| `components/stages/foundry/ThreeFoundryPreview.tsx`           |   938 | Done: shared Foundry/Design Three renderer seam delegates browser telemetry, primitive mesh/material builders, and dynamic render-layer dispatch outside the render body. Keep it behavior-identical; split camera/host lifecycle only behind contract/browser evidence.                                                              |
| `components/stages/foundry/FoundryPreviewStateProbe.tsx`      |   472 | Done: Foundry/Design browser telemetry probe owns the `foundry-camera-rig` data contract outside WebGL scene construction. Keep it attribute-only; scene construction stays in `ThreeFoundryPreview.tsx`.                                                                                                                             |
| `components/stages/foundry/foundryThreePrimitives.ts`         |   521 | Done: Foundry Three primitive factory owns cached geometry/material builders, mesh primitives, path lines, pins, and cached-disposal marker outside the renderer body. Keep it primitive-only; mechanism layout/z-stack rules stay in shared helpers.                                                                                 |
| `components/stages/foundry/foundryThreeRenderLayers.ts`       |   312 | Done: Foundry dynamic render-layer dispatch owns path/trail, linkage, gear, cam, guide, spacer, rack, follower, pin, and clip placement from shared fabrication z-stacks. Keep it layout-only; primitive mesh creation remains in `foundryThreePrimitives.ts`.                                                                        |
| `utils/threeResourceKit.ts`                                   |    86 | Done: shared Three cache/disposal/pixel-ratio helpers serve Foundry and puppet previews. Keep this renderer plumbing-only; scene construction and telemetry stay in renderer owners.                                                                                                                                                  |
| `components/stages/foundry/foundryRenderInventory.ts`         |   152 | Done: Foundry rendered inventory counts live outside the WebGL renderer. Keep it pure and backed by mechanism-reference/fabrication-required parts.                                                                                                                                                                                   |
| `components/stages/foundry/foundryPreviewStacks.ts`           |   475 | Done: Foundry pin-stack/z-order helper seam lives outside the app shell. Keep it pure and shared so SVG/Three/Design z-stack semantics do not drift.                                                                                                                                                                                  |
| `components/stages/foundry/MechanismFoundry.tsx`              |   931 | Done: Mechanism Foundry stage wrapper lives outside the app shell while still consuming shared Foundry renderer, fabrication, camera, and mechanism parameter contracts. Keep shrinking by leaf panes/adapters only.                                                                                                                  |
| `components/stages/foundry/FoundryCanvasPane.tsx`             |   246 | Done: Foundry center canvas host owns Three preview wiring and delegates chrome/overlay leaves outside the stage wrapper. Keep it render-only; projection, sampling, and mutations stay in the stage/domain helpers.                                                                                                                  |
| `components/stages/foundry/FoundryCanvasChrome.tsx`           |   168 | Done: Foundry center canvas badge, camera controls, and playback chrome live outside the preview host while preserving toolbar test IDs and viewer contract metadata.                                                                                                                          |
| `components/stages/foundry/FoundryOverlayLayer.tsx`           |   285 | Done: Foundry SVG force, velocity, playhead, param handle, and anchor overlays live outside the preview host while preserving marker IDs, pointer handlers, and overlay telemetry.                                                                                                              |
| `components/stages/foundry/FoundryWorkflowPanel.tsx`          |   238 | Done: Foundry left workflow pane owns target summary, anchor pick, visible sensemaking, fabrication stack, and template gallery outside the stage wrapper. Keep it presentation/action only.                                                                                                                                          |
| `components/stages/foundry/FoundryInspectorPanel.tsx`         |   231 | Done: Foundry right inspector owns physics readout, opacity/explode controls, parametric editor, advanced parameters, and overlay toggles outside the stage wrapper. Keep mechanism rules in shared utils.                                                                                                                            |
| `components/stages/blueprint/BlueprintExport.tsx`            |    88 | Done: Blueprint stage wrapper owns live recipe derivation plus center preview and panel composition only; left controls and right detail are delegated. Keep export rendering in utils/fabrication. |
| `components/stages/blueprint/BlueprintControlPanel.tsx`      |   258 | Done: Blueprint left workflow controls, package generation, download buttons, and recipe list live outside the stage wrapper. Keep it presentation/action-only; preview SVG and export package rules stay in BlueprintExport/utils. |
| `components/stages/blueprint/BlueprintDetailPanel.tsx`       |   100 | Done: Blueprint right inspector recipe title, board callout, sensemaking cue, required-part chips, stack summary, and export grid status live outside the stage wrapper. Keep it presentation-only; recipe derivation stays in BlueprintExport and fabrication labels stay in utils. |
| `components/stages/options/Options.tsx`                       |   350 | Done: Options stage wrapper lives outside the app shell while delegating static preview and shared field wrappers. Keep it settings orchestration-only; ProjectState actions own mutation and persistence/export rules stay elsewhere.                                                                                                                                     |
| `components/stages/options/OptionsPreviewCanvas.tsx`          |    91 | Done: Options static center preview canvas owns the grid/theme/speed/export visual summary outside the settings form. Keep it presentation-only; no ProjectState actions, persistence, DOM effects, or export logic. |
| `components/stages/options/OptionsSettingsControls.tsx`       |    70 | Done: Options section manifest, section wrapper, and select field wrapper live outside the stage wrapper. Keep it UI-only; no ProjectState actions, persistence, physical-kit mutation, or export logic. |
| `components/stages/assembly/AssemblyGuide.tsx`                |   174 | Done: Assembly Guide stage wrapper owns local selection state, export/print callbacks, playback hook wiring, and pane composition only. Keep it orchestration-only; pane JSX stays in Assembly leaf components, model derivation stays in `assemblyGuideModel.ts`, playback/reset timing stays in `useAssemblyGuidePlayback.ts`, and recipe/stack rules stay in utils/fabrication and utils/assemblyPlayback. |
| `components/stages/assembly/assemblyGuideModel.ts`            |   100 | Done: Assembly live recipe fallback, character/mechanism mode resolution, active steps, selected display step, and playback reset key live in a DOM-free helper. Keep it pure; no React hooks, IO, dispatch, print/download, fabrication package creation, or ProjectState mutation. |
| `components/stages/assembly/useAssemblyGuidePlayback.ts`      |    75 | Done: Assembly shared-player step count, reset-to-zero/stop, step clamp, and rAF progress loop live outside the stage wrapper. Keep it hook-only; no recipe derivation, pane JSX, fabrication, or ProjectState mutation. |
| `components/stages/assembly/AssemblyControlPanel.tsx`         |   181 | Done: Assembly left workflow controls, lane/mode switches, recipe picker, and step list live outside the stage wrapper. Keep it presentation/action-only; playback state and recipe derivation stay in AssemblyGuide. |
| `components/stages/assembly/AssemblyCanvasPane.tsx`           |    61 | Done: Assembly center canvas chooser owns only the mechanism/character workbench mount and empty state. Keep simulation drawing inside mechanism/character workbench leaves. |
| `components/stages/assembly/AssemblyInspectorPanel.tsx`       |   216 | Done: Assembly right inspector owns character pin detail, mechanism recipe detail, sensemaking cue, stack summary, warnings, and current-step chips outside the stage wrapper. Keep it presentation-only; fabrication labels remain in shared utils. |
| `components/stages/assembly/AssemblyWorkbench.tsx`            |     2 | Done: compatibility barrel only; no JSX/state. Keep future imports stable while behavior lives in dedicated workbench leaves. |
| `components/stages/assembly/MechanismAssemblyWorkbench.tsx`   |   167 | Done: mechanism assembly SVG workbench owns guided module/board/motion rendering only and delegates DOM-free coordinate/smoothing helpers to `assemblyGeometry.ts`; recipe/playback rules stay in `utils/assemblyPlayback.ts`. |
| `components/stages/assembly/CharacterAssemblyWorkbench.tsx`   |   171 | Done: character assembly SVG workbench owns character pin, board alignment, and stack rendering only and delegates projector/path helpers to `assemblyGeometry.ts`; character assembly plan rules stay in `utils/assemblyPlayback.ts`. |
| `components/stages/assembly/assemblyGeometry.ts`              |    97 | Done: DOM-free Assembly coordinate, smoothing, and character projector helpers are harnessable outside JSX. Keep deterministic; no React, DOM, ProjectState mutation, or fabrication rule ownership.                                                                                                                          |
| `components/stages/mechanism/MechanismDesign.tsx`             |    77 | Done: Mechanism Design is now an orchestration-only stage wrapper composing workflow, shared preview, and inspector panes. Keep it free of mechanism math and long stage internals.                                                                                                                                                   |
| `components/stages/mechanism/DesignWorkflowPanel.tsx`         |   165 | Done: Mechanism Design left workflow pane owns library chips, visible sensemaking cues, recommendation/blueprint actions, and binding blockers. Keep it ProjectState/action driven.                                                                                                                                                   |
| `components/stages/mechanism/DesignInspectorPanel.tsx`        |   274 | Done: Mechanism Design right inspector pane owns selected mechanism binding, parametric editor, numeric controls, warnings, and export/delete actions. Keep mechanism rules in shared utils.                                                                                                                                          |
| `components/stages/mechanism/DesignFoundryPreview.tsx`        |   430 | Done: Design's Foundry preview adapter lives outside App and keeps `ThreeFoundryPreview` as the single mechanism renderer shared with Foundry. Keep it adapter-only; renderer rules stay in Foundry/physics/fabrication helpers.                                                                                                      |
| `components/ThreePuppetPreview.tsx`                           |  1536 | Split after `App.tsx` seams stabilize. Keep one Three/Rapier boundary; move geometry/material/cache helpers only when duplicated or directly touched.                                                                                                                                                                                 |
| `utils/project.ts`                                            |  1439 | Split only reducer/defaults/migrations if touched. Preserve snapshot compatibility and `ProjectState` shape.                                                                                                                                                                                                                          |
| `utils/fabrication.ts`                                        |   589 | Split validation/export and package generation next only with stronger gates. Keep as the stable public facade for fabrication helpers; gear/ring profile geometry now lives in `utils/fabricationProfiles.ts`, stack/linkage label modeling lives in `utils/fabricationStackModel.ts`, readiness sampling/tolerance math lives in `utils/fabricationReadiness.ts`, render-plan validation/z-order lives in `utils/fabricationRenderPlan.ts`, package recipe derivation lives in `utils/fabricationRecipes.ts`, Blueprint SVG rendering lives in `utils/fabricationBlueprintSvg.ts`, planetary/linkage sizing lives in `utils/fabricationSizing.ts`, import-free PDF document primitives live in `utils/simplePdf.ts`, character cut-sheet layout lives in `utils/fabricationCharacterPrintLayout.ts`, and fabrication rules still come from `fabrication/generate_fabrication_templates.py` plus `utils/fabricationContract.ts`. |
| `utils/fabricationProfiles.ts`                                |   127 | Done: pure gear/ring profile geometry and SVG path derivation live outside the fabrication runtime. Keep cycle-free: no imports from `utils/fabrication.ts`, no ProjectState, validation, export, package creation, renderer, DOM, or UI ownership. |
| `utils/numberFormat.ts`                                       |    13 | Done: neutral finite/svg number formatting lives outside broad import sanitizing so pure fabrication geometry can avoid mechanism/template/reference dependencies. Keep domain-free and import-free. |
| `utils/fabricationStackModel.ts`                              |    99 | Done: pure moving-stack layers, stack summaries, and linkage blank spec selection live outside the broad fabrication runtime. Keep cycle-free: no imports from `utils/fabrication.ts`, no ProjectState, validation, export, package creation, renderer, DOM, or UI ownership. |
| `utils/fabricationReadiness.ts`                               |    60 | Done: pure feasible-range sampling, physical tolerance, board-pitch, and linkage-snapping math live outside the broad fabrication runtime. Keep cycle-free: no imports from `utils/fabrication.ts`, no ProjectState, validation/export/package creation, renderer, DOM, or UI ownership. |
| `utils/fabricationRenderPlan.ts`                              |   105 | Done: pure moving-stack validation, render-layer z-order, base layer, and render-plan summaries live outside the broad fabrication runtime. Keep cycle-free: no imports from `utils/fabrication.ts`, no ProjectState, package creation, renderer, DOM, or UI ownership. |
| `utils/fabricationRecipes.ts`                                 |   112 | Done: package recipe, board callout, target callout, mechanism label, and prefab assembly-step derivation live outside the broad fabrication runtime. Keep it recipe-only: no package generation, validation, SVG/PDF/STL emission, DOM, React, Three, or renderer ownership. |
| `utils/fabricationBlueprintSvg.ts`                             |   142 | Done: deterministic printable/readable Blueprint SVG rendering lives outside the broad fabrication runtime. Keep facade-compatible: no imports from `utils/fabrication.ts`, no package generation, validation, PDF/STL, DOM, React, Three, or renderer ownership. |
| `utils/fabricationSizing.ts`                                  |   121 | Done: pure planetary gear convention and linkage sizing helpers live outside the broad fabrication runtime. Keep cycle-free: no imports from `utils/fabrication.ts`, no ProjectState, validation/export/package creation, renderer, DOM, or UI ownership. |
| `utils/simplePdf.ts`                                          |    43 | Done: import-free PDF document primitives, PDF text escaping, numeric formatting, circle path, color conversion, and simple single-page PDF helper live outside the broad fabrication runtime. Keep domain-free: no ProjectState, fabrication recipes, package generation, DOM, React, Three, or renderer ownership. |
| `utils/fabricationCharacterPrintLayout.ts`                    |   112 | Done: pure character cut-sheet layout model, transformed part outlines, exploded one-page placement, and printable joint-hole coordinates live outside the broad fabrication runtime. Keep it layout-only: no package generation, SVG/PDF/STL emission, validation, DOM, React, Three, or renderer ownership. |
| `components/Canvas.tsx`                                       |     0 | Deleted 2026-07-04: runtime had no importers and tests/docs were the only owners. Do not revive; active views use `SceneSketch`, `ThreePuppetPreview`, shared `ThreeFoundryPreview`, and blueprint SVG renderers.                                                                                                                     |
| `components/TrackingModal.tsx`                                |   930 | Leave until import flow changes. Keep browser-local ONNX behavior.                                                                                                                                                                                                                                                                    |
| `utils/optimizer.ts`                                          |   791 | Split only if mechanism fitting changes. Do not weaken fit constraints.                                                                                                                                                                                                                                                               |
| `utils/mechanismReference.ts`                                 |   688 | Keep as mechanism recipe source; split only generated/reference tables if they grow again.                                                                                                                                                                                                                                            |
| `utils/webOnnx.ts`                                            |   677 | Keep lazy/cached ONNX boundary. Split model loading from image post-processing only if touched.                                                                                                                                                                                                                                       |
| `utils/kinematics.ts`                                         |   662 | Keep pure mechanism math together until a mechanism-specific solver needs extraction.                                                                                                                                                                                                                                                 |

- Extracted helper seam: `components/stages/assembly/assemblyGeometry.ts` | 97 lines | DOM-free Assembly coordinate, smoothing, and character projector helpers.

## Golden-master refactor gate

Baseline: commit `e32cd7e` preserves the audited MotionSmith state before the `App.tsx` refactor.

The contract test now hashes a stable golden master for:

- sample `ProjectState` serialization
- guided waving-arm lesson serialization
- one mechanism snapshot plus the full mechanism snapshot set
- toon scene projection
- SVG and DXF export output
- all mechanism Foundry render plans
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

Latest Mechanism Design extraction evidence:

```bash
bun run test:contracts
bun run build
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Mechanism Design center workspace renders the same shared Foundry mechanism templates|Mechanism Design shared Foundry preview keeps placed anchors on the fabrication grid|Mechanism Design library chips, target filters, delete, and enabled export work|Workflow tabs keep left workflow, center canvas, and right inspector roles|Command menu and shared canvas zoom persist across workflow stages" --workers=2
```

All targeted gates passed after moving `MechanismDesign` and `DesignFoundryPreview` out of `App.tsx`, and again after splitting Mechanism Design into `DesignWorkflowPanel` and `DesignInspectorPanel` leaves.

Latest Foundry pane extraction evidence:

```bash
bun run test:contracts
bun run build
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Foundry sensemaking shows library, partial range, and exported metadata|Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|Cam foundry profile points edit the shared cam simulation profile|Workflow tabs keep left workflow, center canvas, and right inspector roles|Every workflow right inspector uses the shared scroll container|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

All targeted gates passed after splitting Foundry left workflow and right inspector panes into `FoundryWorkflowPanel.tsx` and `FoundryInspectorPanel.tsx`.

Latest Foundry canvas extraction evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|Every workflow right inspector uses the shared scroll container|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

Use this gate for canvas-only movement. It proves the extracted `FoundryCanvasPane.tsx`, `FoundryCanvasChrome.tsx`, and `FoundryOverlayLayer.tsx` still mount the shared Three preview, toolbar state, pointer overlays, stage scroll boundaries, and end-to-end workflow routing.

Latest Foundry renderer helper extraction evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

Use this gate for pure `ThreeFoundryPreview.tsx` helper movement. The golden master now also hashes all mechanism Foundry render plans, so renderer extraction cannot silently drift fabrication-visible parts.

Latest Foundry telemetry probe extraction evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|Mechanism Design center workspace renders the same shared Foundry mechanism templates|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

Use this gate when moving Foundry browser telemetry out of the WebGL scene body. It proves the `foundry-camera-rig` contract still drives Foundry and Design browser checks.

Latest Foundry primitive factory extraction evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|Mechanism Design center workspace renders the same shared Foundry mechanism templates|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

Use this gate when moving Foundry Three primitive mesh/material builders out of the WebGL scene body. It proves cached disposal, pin/path/link/gear/cam/rack rendering, and shared Foundry/Design browser contracts still hold.

Latest shared Three resource helper evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts -g "Path Editor 3D view uses ThreePuppetPreview|Foundry toolbar toggles preview, forces, velocity, trail, and sensemaking|Foundry supports CAD-style 3D camera presets and drag orbit|character → path → foundry → design → blueprint runs end-to-end in browser" --workers=2
```

Use this gate when changing shared Three cache/disposal/pixel-ratio helpers. It proves the helper seam still preserves puppet 3D rendering plus Foundry/Design shared preview behavior.

Latest App character import action extraction evidence:

```bash
bun run test:contracts
bun run build
GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false diff --check
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 bunx playwright test tests/browser/workflow.spec.ts -g "Character tab processing|Create from image upload|Load package review|Replacement package|Every top menu command|guided classroom lesson" --workers=2
```

Use this gate when moving character intake/review actions. It proves ONNX image intake, package/project import, replacement review, command wiring, and guided lesson startup still route through real browser workflows.

## Split order

1. **Command and app shell seams**
   - Keep `AppShell` rendering and command registry separate from app-state mutation.
   - Done: `utils/appCommandHandlers.ts` owns the typed command handler factory that receives state setters/actions and stays locked by the command contract.
   - Done: `hooks/useMotionSmithAppController.ts` owns top-level state/action orchestration outside `App.tsx`; it returns typed `AppWorkspaceShellProps` and must stay JSX-free.
   - Done: `hooks/useAppCommandBindings.ts` owns global keyboard command binding, modal disable, latest-handler ref, and typing-target shortcut bypass outside `App.tsx`.
   - Done: `hooks/useAppProjectCommands.ts` owns project/session command actions (new, save, copy, autosave recovery, workspace layout, zoom, undo/redo, lesson/sample startup) outside `App.tsx`, while `utils/appCommandHandlers.ts` remains the pure exhaustive command-id mapping.
   - Done: `hooks/useAppOnnxBootstrap.ts` owns startup AI cache warmup, boot-loader DOM progress/removal, and manual ONNX cache retry status outside `App.tsx`.
   - Done: `hooks/useProjectAutosave.ts` owns autosave interval/latest-project ref outside `App.tsx`.
   - Done: `hooks/useWorkspacePlayerDock.tsx` owns workspace player dock visibility, Path/Design/Assembly dock wiring, and Assembly step dock state outside `App.tsx`.
   - Done: `hooks/useWorkspacePlaybackLoop.ts` owns the shared playback rAF loop and Path draw reset outside `App.tsx`; it stays effect-only and consumes App-owned state/setters.
   - Done: `hooks/useModalInertEffect.ts` owns startup/help/about modal inert DOM attributes/classes outside `App.tsx`; modal state/actions remain App-owned.
   - Done: `resources/starterImageTemplates.ts` owns starter image template asset metadata outside `App.tsx`; import/review actions remain App-owned.
   - Done: `hooks/useAppPathActions.ts` owns Path draw/tracking state plus path point validation/upsert transfer outside `App.tsx`; path canvas rendering and playback stay in their own seams.
   - Done: `hooks/useAppCharacterImportActions.ts` owns character ONNX image import, starter image/package/project import, pending/replacement review, skeleton export, and Getting Started entry actions outside `App.tsx`; it stays intake/review-only and does not own mechanism fitting or UI rendering.
   - Done: `hooks/useAppMechanismActions.ts` owns mechanism update, Foundry export-to-design, recommendation apply, optimizer loop, and SVG/DXF export actions outside `App.tsx`; it stays ProjectState-action-only and does not own stage markup or renderer geometry.
   - Done: `utils/appStageNavigation.ts` owns stage handoff gate, recovery dispatch, stage-open status, and `goStage` wiring outside `App.tsx`; it stays side-effect wiring only and delegates rules to `utils/project.ts`.
   - Done: `utils/appStageRouterProps.ts` owns stage-router prop grouping outside `App.tsx`; it stays pure/type-only and delegates all behavior to App-owned hooks/actions.
   - Done: `utils/projectPersistence.ts` owns MotionSmith storage keys, legacy migration, project snapshot filenames, autosave snapshots, and workspace layout serialization/restore outside `App.tsx`.
   - Done: `utils/foundryCamera.ts` owns deterministic Foundry camera presets, clamp/project/unproject helpers, and shared overlay sizing for Foundry and Design previews.
   - Done: `utils/mechanismRecommendations.ts` owns fabrication-gated recommendation fitting and fallback logic outside the app shell.

2. **Stage components**
   - Done: shared stage frame/navigation lives in `components/stages/stageLayout.tsx`.
   - Done: `BlueprintExport` lives in `components/stages/blueprint/BlueprintExport.tsx`; its left workflow/download controls live in `components/stages/blueprint/BlueprintControlPanel.tsx`; its right recipe detail/sensemaking panel lives in `components/stages/blueprint/BlueprintDetailPanel.tsx`.
   - Done: `components/stages/assembly/AssemblyWorkbench.tsx` is now a compatibility barrel; mechanism and character SVG workbenches live in `MechanismAssemblyWorkbench.tsx` and `CharacterAssemblyWorkbench.tsx`; DOM-free Assembly coordinate, smoothing, and character projector helpers live in `components/stages/assembly/assemblyGeometry.ts`.
   - Done: `components/stages/character/ProgressBlock.tsx` owns the import progress card and status label outside `App.tsx`.
   - Done: `components/ui/InspectorControls.tsx` owns shared mini number and toggle controls used by inspectors.
   - Done: `components/stages/character/PartInspector.tsx` and `CutOutlineEditorDialog.tsx` own the shared part/cut inspector leaf used by Character and Path.
   - Done: `components/stages/character/SkeletonInspector.tsx` owns shared joint/anchor editing used by Character and Path.
   - Done: `components/stages/character/CharacterImportOverlays.tsx` owns import progress and pending package review overlays used by Character.
   - Done: `components/stages/character/CharacterLessonOwnership.tsx` owns guided lesson ownership cues/actions used by Character.
   - Done: `components/stages/character/CharacterSetupPanel.tsx` owns the Character right-inspector setup wrapper while part/joint controls remain in their leaf inspectors.
   - Done: `components/stages/character/CharacterImportControls.tsx` owns Character import/guide entry controls while file processing and package acceptance remain outside the component.
   - Done: `components/stages/character/CharacterSelection.tsx` owns the Character stage wrapper once its setup/list/import leaves were small enough to move without changing behavior.
   - Done: `components/stages/path/PathEditor.tsx`, `PathWorkflowPanel.tsx`, `PathCanvasPane.tsx`, `PathInspectorPanel.tsx`, `SceneSketch.tsx`, `PartShape.tsx`, and `MechanismRecommendationSheet.tsx` own the Path Editor UI seam outside `App.tsx`; Path still receives ProjectState/actions and does not own mechanism rules. `components/stages/mechanism/MechanismParametricEditor.tsx` owns the shared Foundry/Design compact gear/link/idler/cam parameter UI outside `App.tsx`, and `mechanismParamPolicy.ts` owns deterministic legacy numeric parameter visibility/clamping.
   - Done: `components/stages/foundry/MechanismFoundry.tsx`, `FoundryCanvasPane.tsx`, `FoundryCanvasChrome.tsx`, `FoundryOverlayLayer.tsx`, `FoundryWorkflowPanel.tsx`, `FoundryInspectorPanel.tsx`, `MechanismLinkagePreview.tsx`, `mechanismLinkagePreviewHelpers.ts`, `foundryPreviewGeometry.ts`, `ThreeFoundryPreview.tsx`, `foundryThreePrimitives.ts`, `foundryThreeRenderLayers.ts`, and `foundryPreviewStacks.ts` own the Foundry stage/renderer seams outside `App.tsx`; Foundry and Mechanism Design still mount the same Three preview component and share pin-stack/z-order contracts.
   - Done: `components/stages/options/Options.tsx` owns the Options stage wrapper outside `App.tsx`, while `OptionsPreviewCanvas.tsx` owns the static center preview and `OptionsSettingsControls.tsx` owns section/field wrappers; Options still receives ProjectState/actions and does not own persistence or export rules.
   - Done: `components/stages/assembly/AssemblyGuide.tsx`, `AssemblyControlPanel.tsx`, `AssemblyCanvasPane.tsx`, and `AssemblyInspectorPanel.tsx` own the Assembly Guide stage wrapper plus workflow/canvas/inspector leaves outside `App.tsx`; Assembly still receives ProjectState/actions and shell playback state while recipe/stack derivation stays in shared utils.
   - Done: `components/stages/mechanism/MechanismDesign.tsx` owns only the Mechanism Design stage composition outside `App.tsx`; `DesignWorkflowPanel.tsx`, `DesignInspectorPanel.tsx`, and `DesignFoundryPreview.tsx` own the left pane, right pane, and shared Foundry preview adapter. Design still receives ProjectState/actions and does not own mechanism rules.
   - Done: `components/AppStageRouter.tsx` owns stage selection, the shared workbench wrapper, and player-dock placement outside `App.tsx`; App keeps action/domain callbacks so the router remains a pass-through UI seam.
   - Done: `components/AppWorkspaceShell.tsx` owns workspace shell chrome, header actions, status/footer, and modal mounts outside `App.tsx`; App keeps ProjectState mutation and command callback wiring. `utils/workflowStatus.ts` owns fabrication-aware status derivation so shell components stay presentation-only.
   - Done: `hooks/useAppDerivedState.ts` owns selected part/path/mechanism, playback duration, sorted part order, and global mechanism config outside `App.tsx`; keep it pure/read-only.
   - Next lowest-risk seam: extract small action/helper bundles only when touched after command/session, persistence, derived-state, Foundry renderer, stage router, shell chrome, stage navigation, and boot/cache contracts stay green. Shared geometry/material/cache helpers already live in `utils/threeResourceKit.ts`; keep shared fabrication/physics contracts centralized.

3. **Domain helpers**
   - Done: mechanism fitting/recommendations live in `utils/mechanismRecommendations.ts`.
   - Assembly playback derivation remains in `utils/assemblyPlayback.ts`.
   - Done: cut-outline math left `App.tsx` with the cut editor seam; extract it to a pure helper only when another consumer appears.

4. **Renderer split**
   - Done: `ThreeFoundryPreview.tsx` is now the shared Foundry/Design Three renderer seam; `FoundryPreviewStateProbe.tsx` owns browser telemetry, `foundryThreePrimitives.ts` owns cached primitive builders, and `foundryThreeRenderLayers.ts` owns dynamic render-layer dispatch. Continue with lifecycle/controller splits only behind browser evidence.
   - Done: `utils/threeResourceKit.ts` owns repeated Three cache, disposal, and pixel-ratio plumbing for Foundry and puppet previews.
   - `ThreePuppetPreview.tsx`: keep React wrapper small; move only repeated renderer plumbing or pure geometry helpers when duplicated or directly touched.
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
bun run test:contracts
bun run build
```

Run `bun run test` when domain behavior or golden-master outputs can change.

After UI/renderer movement:

```bash
env -u NO_COLOR PLAYWRIGHT_SERVER=preview PLAYWRIGHT_WORKERS=2 ./node_modules/.bin/playwright test tests/browser/workflow.spec.ts --workers=2
```

Stop only when the relevant contract, build, and browser evidence passes without new warnings.

## Cleanup applied 2026-06-29

- Removed generated local artifacts: `.DS_Store`, Python `__pycache__`, `dist/`, `test-results/`, `src-tauri/target/`, `src-tauri/gen/`.
- Moved large ignored ONNX reference repo out of docs to local archive: `../MechAnim-local-archive/.../docs-to-port-web-onnx/repo`.
- Removed runtime-unused source: `components/Controls.tsx`, `utils/zStack.ts`.
- Extracted shared stage frame/nav shell to `components/stages/stageLayout.tsx`.
- Extracted blueprint stage to `components/stages/blueprint/BlueprintExport.tsx`; extracted Blueprint left workflow/download panel to `components/stages/blueprint/BlueprintControlPanel.tsx`; extracted Blueprint right recipe detail panel to `components/stages/blueprint/BlueprintDetailPanel.tsx`.
- Extracted assembly playback derivation to `utils/assemblyPlayback.ts`; split assembly rendering into a compatibility barrel `components/stages/assembly/AssemblyWorkbench.tsx`, `MechanismAssemblyWorkbench.tsx`, and `CharacterAssemblyWorkbench.tsx`; extracted DOM-free Assembly coordinate, smoothing, and character projector helpers to `components/stages/assembly/assemblyGeometry.ts`.

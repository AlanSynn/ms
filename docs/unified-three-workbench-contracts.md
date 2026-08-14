# Unified Three workbench contract v1

Status: frozen for the fixed-view cutover. Sol owns changes to this contract. A worker must not redefine, widen, or bypass it in an owned implementation file.

## Authority and lifetime

`ProjectState` remains the aggregate root. `ToonSceneProjection` remains the only semantic scene projection. `PreparedWorkbenchScene` retains that projection and adds only node-indexed render groups, binding tables, interaction acceleration data, immutable inspector models, optional typed pose samples, and a rebuildable resource manifest. These are prepared derivatives, not a second scene IR and never an export authority.

One `WorkbenchRuntime` is mounted once to one canvas for an editing session. It creates one renderer, one WebGL context, one retained Three scene, one fixed orthographic camera, and one optional perspective inspection camera. Stage navigation calls `setStageLens`; it does not replace the canvas, renderer, scene, or context. Runtime disposal occurs only when the editing session ends.

Canonical SVG/PDF generators remain untouched. Blueprint may show the prepared live scene, but exact proof bytes are generated only by the existing fabrication/export boundary after an explicit request.

## Exact fixed view

The canonical plane is `z = 0`, width `900`, height `680`, with scene `+x` right and `+y` up. The host uses a centered `contain` rectangle matching SVG `preserveAspectRatio="xMidYMid meet"`; letterbox space is not interactive.

For `CanvasViewport { offset, zoom }`:

- camera center is `(-offset.x / zoom, offset.y / zoom)`;
- frustum width is `900 / zoom` and height is `680 / zoom`;
- the fitted rectangle's top-left maps to `(left, top)` in the orthographic frame and its bottom-right maps to `(right, bottom)`;
- pointer mapping uses the same fitted rectangle and returns canonical XY directly, without SVG serialization or rounding.

`studio-orthographic` is locked and is the default for Character, Path, Foundry, Design, Blueprint, and Assembly. `inspect-perspective` is the same retained scene, requires `paused: true`, and must return to the saved orthographic viewport before drawing or editing.

## Prepared scene and frame lane

A prepared scene has a monotonically increasing generation and a stable relevant-project revision. A runtime accepts an equal/newer generation atomically and rejects a stale generation. The last valid prepared scene stays visible while a newer one is prepared.

The pose table contains 256 to 1,024 samples, adaptive to at most `0.5` CSS pixel interpolation error in studio view. Rotations are unwrapped. Each transform uses five floats in this exact order: `x`, `y`, `z`, `rotationZRadians`, `uniformScale`.

`RuntimeFrame` and its typed arrays are allocated once per accepted scene and reused. Steady playback may only advance phase, choose/interpolate pose samples into the frame arrays, write retained matrices/overlay buffers, and call `renderer.render` at most once. It may not construct arrays, maps, sets, boxes, cameras, project-like graphs, inspector models, compiler results, readiness/safety results, candidates, fabrication artifacts, diagnostics JSON, autosave payloads, AI work, Rapier work, or study data.

Paused rendering is dirty-only. Hidden pages schedule no RAF, renderer submission, or overlay update. Resume resets the clock origin and requests one dirty frame.

## Scene groups and lenses

The group names and order in `WORKBENCH_SCENE_GROUPS` are exact. A lens changes group visibility, material policy, camera choice, and interaction policy only.

| Stage | Visible groups | Authoring policy |
| --- | --- | --- |
| Character | board, character, sceneObjects, skeleton, selectionOverlay | select/place, pan, zoom |
| Path | board, character, sceneObjects, skeleton, paths, editHandles, selectionOverlay | draw/edit points and joints directly on the plane |
| Foundry | board, paths, mechanisms, hardware, editHandles, selectionOverlay | select/edit only while paused |
| Design | character, paths, mechanisms, hardware, editHandles, selectionOverlay | select/bind only while paused |
| Blueprint | board, character, mechanisms, hardware, blueprintOverlay, selectionOverlay | inspect only; no live artifact generation |
| Assembly | board, character, mechanisms, hardware, assemblyOverlay, selectionOverlay | scrub/step; optional paused inspection |
| Options | none | runtime remains mounted but disabled |

Physics is `off` unless an explicit paused Physics lens is requested. No Rapier import or request may occur merely because a stage becomes visible.

## Interaction transaction

`InteractionPlan` is immutable and callback-free. Targets reference `semanticProjection.nodes` by index and may duplicate canonical bounds only for hit-test acceleration. They may not copy render geometry or traverse the Three scene per frame.

The runtime owns gesture previews imperatively. React and `ProjectState` are not updated on pointer move. Pointer-up emits exactly one `WorkbenchInteractionCommit` through the sink; pointer-cancel emits none. The control plane translates the commit through existing safe command/reducer boundaries. Mechanism updates must still pass the shared edit authority. Every pointer action retains an accessible name and keyboard alternative from the plan.

## Inspector model

An `InspectorModel` is immutable and keyed only by relevant project, mechanism, physical-kit, and target-binding revisions. Phase, elapsed time, camera, viewport, renderer state, and React render count are not keys. Models are rebuilt after an accepted relevant edit and reused during playback. Advanced section controls remain unmounted until their section is opened.

## Diagnostics and recovery

`WorkbenchRuntime.diagnostics()` returns `null` in default and study production builds. Only the E2E build may contain the counter implementation. Types are erased and do not authorize a compatibility runtime.

On `webglcontextlost`, the runtime prevents default loss handling, pauses, and retains canonical state plus the accepted prepared scene. On `webglcontextrestored`, it rebuilds GPU resources exclusively from `resourceManifest`, `staticPlan`, and `semanticProjection`, reapplies the active lens and current frame, and renders one dirty frame. It must not recreate `ProjectState`, invoke a domain compiler, or require stage navigation to recover.

# Unified Three fixed-view interaction contract audit

Status: baseline audit, no production edits

Worktree: `/Users/alansynn/Workspace/ms-wt/audit-interaction`

Branch: `audit/fixed-view-interaction`

Baseline: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`

Scope: interaction behavior that must survive the unified Three.js Chromebook cutover. This artifact owns only `artifacts/performance/audit-interaction/**`.

## Reading the evidence

Each row is marked with one of these states:

- **Established** — the source and/or an existing browser/contract test proves the behavior at this baseline.
- **Inferred** — the source provides a deterministic contract, but the current evidence does not execute the exact browser path or does not prove the migrated fixed-view implementation.
- **Missing runtime proof** — the behavior is required or described by the plan, but the current source/test evidence cannot prove it, or the current implementation is explicitly different.

The current implementation is evidence about the pre-cutover contract, not permission to preserve implementation defects. In particular, the current Three viewers use separate `PerspectiveCamera`/`WebGLRenderer` instances; the plan's post-cutover requirement is one persistent shared orthographic scene with direct XY mapping.

## Canonical action vocabulary

The complete canonical `ProjectAction` union is at `types.ts:510-537`. The relevant outputs are:

| User action | Canonical output | Reducer/source evidence | Contract status |
| --- | --- | --- | --- |
| Choose a body part in Character, Path, or a 3D character pick | `select_part {partId}` | `CharacterSelection.tsx:191-200,278-291`; `SceneSketch.tsx:355-363`; `ThreePuppetPreview.tsx:1786-1828`; reducer `utils/project.ts:1707-1716` | **Established** |
| Choose a scene prop/object | `select_scene_object {objectId}` | `CharacterSelection.tsx:235-247,291-293`; `SceneSketch.tsx:366-382`; reducer `utils/project.ts:1810-1819` | **Established** |
| Edit body-part visibility, lock, transform, bounds, artwork, cut contour, pivot | `update_part {partId, updates}` | `PartInspector.tsx:57-67,97-111,149-169,242-265`; `SkeletonInspector.tsx:93-105`; reducer locks and validates at `utils/project.ts:1733-1808` | **Established** |
| Edit prop name, shape, visibility, lock, transform, bounds, color; delete prop | `update_scene_object` / `delete_scene_object` | `SceneObjectInspector.tsx:19-24,31-80`; reducer selection/lock path at `utils/project.ts:1821-1895` | **Established** |
| Edit an existing joint, bend direction, parent, position, lock | `update_joint {jointId, updates}` | `SkeletonInspector.tsx:127-243`; Path fold controls `PathEditor.tsx:243-249`; reducer cycle/lock/anchor propagation at `utils/project.ts:1902-1948` | **Established** |
| Add/remove a joint or part layer | `add_joint` / `remove_joint` / `upsert_part` / `delete_part` | Character inspectors; action types `types.ts:515-525`; reducer rejects invalid/locked changes | **Established** |
| Draw, replace, move, open/close, smooth, hide/show, enable/disable a path | `upsert_path {path}`; point removal is also an `upsert_path` | `useAppPathActions.ts:32-88`; `PathEditor.tsx:203-214,250-290`; reducer validates and invalidates dependent mechanism artifacts at `utils/project.ts:1984-2033` | **Established** |
| Remove a whole path | `delete_path {pathId}` | `PathEditor.tsx:287-290`; reducer clears selection and invalidates bindings | **Established** |
| Select/replace mechanism family or instance | `set_mechanisms` or `upsert_mechanism` | `DesignWorkflowPanel.tsx` (family chips and instance select); action types `types.ts:528-533`; reducer transactional resolution `utils/project.ts:2035-2148` | **Established** |
| Edit mechanism target, path, handle, scalar, or accepted connection selection in Design | `upsert_mechanism {mechanism}` | `useAppMechanismActions.ts:106-275`; `DesignInspectorPanel.tsx:191-290,320-348`; reducer accepts/rejects transactionally | **Established** |
| Fit a mechanism to a path | one aggregate `upsert_mechanism` after fit | `useAppMechanismActions.ts:280-327`; `DesignInspectorPanel.tsx:364-386`; `tests/mechanism-command-feedback.test.ts` | **Established** |
| Accept a Foundry candidate / preserve generated export | `commit_mechanism_candidate {result}` | `useAppMechanismActions.ts:376-485`; reducer `utils/project.ts:2150-2185` | **Established** |
| Delete a mechanism | `delete_mechanism {mechanismId}` | `DesignInspectorPanel.tsx:377-386`; reducer clears selected id | **Established** |
| Generate Blueprint or Assembly package | `set_export {fabricationPackage}` | `BlueprintExport.tsx:40-53`; `AssemblyGuide.tsx:59-74`; reducer preserves package at `utils/project.ts:2227-2231` | **Established** |
| Change physical kit/physics/fabrication settings | `update_settings` | reducer invalidation path `utils/project.ts:2198-2225` | **Established** |
| Pan, zoom, orbit, camera preset, playback phase, Assembly scrub | no `ProjectAction`; local/top-level viewport or stage state | `utils/viewport.ts:3-101`; `useMotionSmithAppController.ts:104-106`; stage camera hooks | **Inferred** as intentional UI state; must not silently become a second ProjectState scene |

`useProjectHistory.ts:18-64` confirms that edit actions are undoable; selection, processing, export, and foundry-export bookkeeping are not undo entries. Any cutover handler must retain the same action boundary and call count. No production call counts changed in this audit.

## Interaction matrix

### Character: body parts, props, and rig

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Select body part from list | `CharacterSelection.tsx:191-200` dispatches `select_part`; reducer also selects the first owned path (`utils/project.ts:1707-1716`). | ID exact; no spatial tolerance. A click on a visible Three target must resolve to the same part ID as the list. | `data-testid=character-part-item-${id}`, `aria-pressed`; browser test `workflow.spec.ts:3521-3553`. For direct view use `character-three-puppet` plus stable E2E state, never rendered pixel text. | **Established** list path. Three pick uses projected screen targets expanded by 18 px and a radius threshold (`ThreePuppetPreview.tsx:1807-1828`), not the fixed-view direct XY contract. **Missing runtime proof** after migration. |
| Select scene prop/object from list | `CharacterSelection.tsx:235-247` dispatches `select_scene_object`; reducer clears part selection and selects the object's path (`utils/project.ts:1810-1819`). | ID exact. The prop's screen hit may be tolerant, but the resulting object ID must be exact. | `scene-object-item-${id}`, `aria-pressed`; `SceneObjectInspector` `data-testid`; browser test `workflow.spec.ts:395-510`. | **Established** list path. Current 3D fallback and projected target semantics differ between viewers; unify locator and hit behavior in the persistent scene. |
| Select a part/object by clicking the canvas | Character uses `ThreePuppetPreview` callbacks (`CharacterSelection.tsx:278-293`); Path SVG uses `PartShape`/object group (`SceneSketch.tsx:350-382`); Design's automata preview dispatches the same actions (`DesignFoundryPreview.tsx:444-449`). | Selection ID exact. Screen proximity is an affordance only, not a coordinate result. | Preferred locators: `character-three-puppet`, `path-part-${id}`, `path-scene-object-art-${id}`, `design-shared-foundry-preview`; assert selected list `aria-pressed` or reducer-visible state. | **Missing runtime proof** that every lens resolves the same target with one direct XY mapping. Current character and Foundry picks use raycast plus debug screen-target JSON. |
| Edit body transform/art offset/bounds/visibility/lock | `update_part`, merged at the inspector; locked parts reject all updates except changing lock (`utils/project.ts:1733-1808`). | Numeric values are canonical scene units; exact reducer value after commit. No visual tolerance for inspector values. | Labels from `PartInspector`; `part-art-controls`; `path-part-art-${id}` and `data-art-offset-x`; browser test `workflow.spec.ts:3011-3027`. | **Established** round trip through Path. New fixed Three scene must redraw the same `ProjectState` values; it must not maintain a private transform. |
| Edit prop properties | `update_scene_object` from `SceneObjectInspector.tsx:19-24,31-80`. | Exact numeric transform/bounds; exact string/type; lock rejection. | `scene-object-inspector`, labels `Object name`, `Object type`; selected list item. | **Inferred** for 3D visual redraw because current prop picking and renderer state are separate from Path SVG. |
| Change part pivot / add or remove joint | Pivot is `update_part` with anchor and local pivot (`SkeletonInspector.tsx:93-105`); joint edits are `update_joint`, `add_joint`, `remove_joint`. | Joint ID exact; scene position exact in ProjectState. Moving a joint must update attached part local pivot deterministically (`utils/project.ts:1927-1946`). | `Part pivot`, `Edit joint`, Add/Remove joint buttons; browser test `workflow.spec.ts:3555-3584`. | **Established** reducer behavior. **Missing runtime proof** that direct Three dragging (if retained) emits these actions rather than mutating renderer-only objects. |
| Set bend/fold direction | `update_joint {bendDirection:-1|1}` from `PathEditor.tsx:243-249` and Character skeleton controls. | Sign exact (`-1` left, `+1` right), no tolerance. | `button[aria-label="Fold left"]`, `Fold right`, `fold-direction-control`; browser test `workflow.spec.ts:2995-3001`. | **Established** control path. Current visual path playback is a separate preview calculation; fixed scene must use the same IK source. |
| 2D/3D view choice and layer toggles | Local viewer state; toolbar buttons set camera preset/layers, not `ProjectAction` (`ThreePuppetPreview.tsx:1934-1969`). | Camera/layer state is local UI state; no fabricated ProjectState coordinates. Fixed 2.5D must lock XY camera; 3D unlock is optional inspect mode. | `character-three-puppet-view-2d`, `character-three-puppet-view-3d`, `character-three-puppet-toggle-*`, `aria-pressed`; browser test `workflow.spec.ts:900-1040`. | **Missing runtime proof**: current `ThreePuppetPreview` is `PerspectiveCamera` and allows orbit/pan (`ThreePuppetPreview.tsx:1114,1738-1772`), contrary to the fixed orthographic requirement. |

Character's accessible list/buttons are established. The 3D wrapper is labelled `3D character view` (`ThreePuppetPreview.tsx:1882-1901`), but the actual WebGL canvas has no independent accessible name and direct part/prop hits have no keyboard alternative. This is a cutover acceptance risk, not a reason to remove the list fallback.

### Path: target, drawing, point editing, joints, pan, zoom

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Choose motion target | `PathWorkflowPanel.tsx:64-74` dispatches `select_scene_object` or `select_part`; reducer selects owned path. | ID exact. Switching target must never reinterpret old points as belonging to another owner. | `select[aria-label="Motion target"]`, `data-testid=selected-motion-target`, `free-draw-status`; browser test `workflow.spec.ts:2921-2950`. | **Established**. |
| Enter free-draw mode | Button sets Path view to 2D and toggles draw mode (`PathEditor.tsx:292-303`). | No action until points commit. A draw gesture starts only with left button, unlocked target, and valid SVG CTM. | `button[aria-label="Draw free path"]` / `Drawing free path`; `path-view-2d[aria-pressed=true]`; browser test `workflow.spec.ts:5158-5170`. | **Established** source/browser path. **Missing runtime proof** in the migrated Three lens if drawing is moved from SVG to WebGL. |
| Draw a free path | `onCanvasDown` maps `clientX/Y` through `svgPointerToScene` (`PathEditor.tsx:203-210`); samples use `addDrawSamplePoint`/timed normalization and queue an `upsert_path` (`PathEditor.tsx:190-201`, `useAppPathActions.ts:61-87`). | Canonical point is the exact inverse-CTM scene point (no intentional rounding); sample filtering is 8 scene/CSS px minimum distance, long segments interpolated at max 28, 900 points max (`utils/pathDrawing.ts`). Timed points normalize to path duration. | `path-canvas[aria-label="Path editor canvas"]`; `free-draw-status[data-point-count][data-draw-mode]`; `selected-motion-path[data-path-closed]`; browser test `workflow.spec.ts:2932-2945,5180-5195`. | **Established** SVG behavior. Cutover must use plan mapping screen → NDC → orthographic unproject → z=0 and preserve raw scene points. Do not round to CSS pixels. |
| Finish/cancel a stroke | `SceneSketch.tsx:258-265` finishes on mouseup, mouseleave, pointerup, pointercancel, and lost pointer capture; `PathEditor.tsx:262-270` flushes session and exits draw mode. | Exactly one final latest-frame commit per pointer session; cancellation must not leave draw mode/session alive. | Source contract test `tests/g3-path-pointer-finalization.test.ts`; browser `workflow.spec.ts:2935-2942,5197-5209`. | **Established** source/test only; that focused test is not full browser runtime proof. |
| Drag a path point | `startPointDrag` and `movePoint` replace one `points[index]`, queue `upsert_path` (`PathEditor.tsx:250-277`). | Point's resulting scene coordinate exact after CTM; no snapping. Point index/ID is stable during one drag. | SVG circle with `data-canvas-interactive=true` and selected path; browser `workflow.spec.ts:2981-2990`. Current circles lack `tabindex`/accessible names. | **Established** pointer path; **Missing runtime proof** for keyboard nudge/direct Three implementation. |
| Delete a point / clear path | Delete dispatches `upsert_path` with filtered points; clear dispatches `delete_path` (`PathEditor.tsx:278-290`). | Point order remains exact; empty/invalid path is rejected by `validatePath`; selected path is cleared only for `delete_path`. | Buttons `Delete point`, `Clear path`, `selected-motion-path`; browser `workflow.spec.ts:2969-2980` plus Path panel source. | **Established** reducer path; no browser assertion of serialized point exactness. |
| Choose IK start/handle by controls or joint on canvas | Controls map to `upsert_path` target fields; joint click maps to chain root or target handle (`PathEditor.tsx:215-242`). | Joint IDs exact. If chosen chain root is incompatible, fallback is the selected part's anchor. | `Motion start`, `Motion handle`, `ik-chain-root-options`, `skeleton-joint-${id}`; browser `workflow.spec.ts:2960-2969`. | **Established** controls. Joint SVG groups have title text but no focus/keyboard semantics. |
| Fold left/right | `update_joint` sign action (`PathEditor.tsx:243-249`). | Exact sign, no tolerance. | `Fold left`, `Fold right`, `fold-direction-control`. | **Established**. |
| Pan the 2D path canvas | Empty left-button drag in `SceneSketch.tsx:201-216`; offset committed via `canvasPanOffset` (`utils/viewport.ts:33-55`). | Offset is scene units derived from client delta × scene/rect dimensions; latest-only frame queue. No ProjectAction. | `path-canvas`, assert `viewBox` change; browser `workflow.spec.ts:5117-5156`. | **Established** helper/source. The fixed-view migration must preserve cursor-to-world relationship. |
| Zoom the 2D path canvas | Wheel calls cursor-anchored `zoomCanvasViewportAtPoint` (`SceneSketch.tsx:238-249`; helper `utils/viewport.ts:57-88`). | `zoom` clamped [0.25,4]; world point under cursor invariant to numerical precision. | `path-canvas`, `viewBox` change; toolbar `Zoom in/out/Fit view`; global Mod shortcuts. | **Established** source/helper. **Missing runtime proof** of post-cutover orthographic wheel path. |
| Switch Path 2D/3D | `PathCanvasPane.tsx:64-83`; 3D switch stops drawing (`PathEditor.tsx:292-297`). | No ProjectAction. Path state/points and selected IDs must persist. | `path-view-2d`, `path-view-3d`, `path-three-puppet-canvas/state`; browser `workflow.spec.ts:5117-5156`. | **Established** current runtime; current 3D has independent perspective camera and renderer. |

`pathFromPoints` serializes SVG `d` coordinates with `toFixed(2)` (`utils/coordinates.ts:178-195`). That is a display/export serialization boundary only. It must not be used as the canonical point storage precision.

### Foundry: handles, connections, camera, playback, and Use

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Pick a Foundry anchor on the work surface | Three ray-plane hit calls `applyAnchor`; `MechanismFoundry.tsx:709-736`; `ThreeFoundryPreview.tsx:1610-1638` computes a world hit then maps to scene. | `sceneToBoard` rounds to the nearest physical hole; `boardToScene` returns the exact hole point. Canonical anchor X/Y must equal `boardToScene(col,row)`; default pitch is 40 scene px. | `foundry-pick-anchor`, `foundry-anchor-marker`, `foundry-preview`, board label; browser `workflow.spec.ts:3905-3915`, Design grid test `4787-4812`. | **Established** current snapping. Current `ThreeFoundryPreview` mapping includes a fixed 360×240 conversion (`ThreeFoundryPreview.tsx:1633-1638`), which is invalid for arbitrary fixed-view sizes; the browser test exercises resized aspect but only marker visual tolerance <6 px. |
| Drag Foundry parameter handles (M anchor, D ground endpoint; B/C locked when physically authored) | SVG overlay emits pointer session (`FoundryOverlayLayer.tsx:239-264`); M calls `applyAnchor`, D converts endpoint through board snap then computes `groundLength/groundAngle` (`MechanismFoundry.tsx:927-964`). | M/D endpoint snaps exactly to a board hole; angle/length are derived from the snapped endpoint. B/C are non-draggable when physical role owns the endpoint. | `foundry-param-handle-${id}` with `data-param-role`, `data-draggable`, `data-projection-z`; browser `workflow.spec.ts:1239-1243`. | **Established** pointer/physical authority. **Missing runtime proof** keyboard alternative: param circles have no role/name/tabindex/keydown (`FoundryOverlayLayer.tsx:245-264`). |
| Pan/orbit/zoom Foundry camera | `MechanismFoundry.tsx:759-770` and `ThreeFoundryPreview.tsx:1955-1981`; left orbit, Shift/middle/right pan, Alt/right/wheel zoom; presets reset pan. | Camera state is UI state, never a mechanism coordinate. 2.5D fixed view must not change XY camera; 3D inspect may update orbit/pan/zoom. | `foundry-preview`, `foundry-camera-rig`, `foundry-camera-preset-*`, camera readout, data camera attrs; browser `workflow.spec.ts:3818-3978`. | **Established** current camera test; current camera is perspective and freely orbitable even in default view, contrary to the planned locked orthographic authoring lens. |
| Toggle grid/path/forces/velocity/trail, playback/scrub/reset | Local Foundry stage state; controls in `FoundryCanvasChrome.tsx` and `MechanismFoundry.tsx:1307-1328`. | These do not alter canonical ProjectState except accepted mechanism edits; simulation overlays must derive from the same mechanism/physics sample. | `foundry-toggle-*`, `foundry-playback`, `foundry-phase`, `foundry-anchor-marker`; browser `workflow.spec.ts:3734-3817`. | **Established** existing UI. **Missing runtime proof** one shared simulation source after renderer consolidation. |
| Select physical connection hole by pointer | `MechanismConnectionOverlay.tsx:338-416`; nearest same-role target tolerance is 28 px (`:250-266`), movement threshold is 3 px Euclidean (`:368-387`), pointer cancel/distant release are no-ops. | Identity is exact: role + physical kind + part key + hole index. On accepted drop, canonical connection selection coordinates/export signature must change only for that role; no scalar substitute. | `circle.foundry-connection-hole-hit`, `data-connection-role/kind/part-key/hole-index`, `aria-label`; browser `workflow.spec.ts:1187-1287,1289-1403`. | **Established** strongly: tests verify role-matched signature, preview coordinate change, z match, cancellation, and Blueprint metadata. New fixed projection must preserve 28 px screen affordance while computing exact world identity. |
| Select physical connection hole by keyboard | `MechanismConnectionOverlay.tsx:495-533`: arrows cycle same-role handles, Enter/Space arms then accepts, Escape exits. | Identity exact; keyboard selection must produce the same `upsert_mechanism`/candidate output as pointer selection. | Role button, roving `tabIndex`, `aria-label`, `aria-pressed`, `aria-expanded`, `aria-keyshortcuts` at `:583-642`. | **Established source**; **Missing runtime proof** browser test for keyboard commit and recovery. |
| Invalid connection drop and recovery | `reject` sets exact blocker `Fix: Choose anchor` and reveals recovery role (`MechanismConnectionOverlay.tsx:321-336,662-670`). | Invalid drop must leave prior accepted selection/signature unchanged; recovery candidate identity is exact. | `${surface}-connection-recovery` role status; browser `workflow.spec.ts:1214-1222`. | **Established** pointer cancellation/recovery; keyboard recovery has no browser proof. |
| Use mechanism / commit Foundry candidate | Local `foundry` candidate is installed by `installFoundryCandidate` (`MechanismFoundry.tsx:683-707`); parent `exportFoundryMechanism` dispatches `commit_mechanism_candidate` and moves to Design (`useAppMechanismActions.ts:376-485`). | Canonical mechanism output is accepted transaction result; generated path/export package must be preserved exactly when supplied. | `button[aria-label="Use mechanism"]`, Design heading; browser `workflow.spec.ts:1273-1284,1386-1400`. | **Established**. Important boundary: direct Foundry pointer edits are not canonical ProjectActions until Use/commit. Stage switching before Use must not imply persistence. |

### Design: binding, Fit, and recovery

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Select mechanism instance/family | `DesignWorkflowPanel.tsx` emits `set_mechanisms` for instance selection and `upsert_mechanism` for a family chip. | Mechanism ID/type exact; replacing a family is transactional and cannot leave two drivers for one target. | `Mechanism instance`, family button names, `design-mechanism-library`; browser `workflow.spec.ts:4720-4783`. | **Established** reducer/test path. |
| Bind mechanism to body part or scene object | `DesignInspectorPanel.tsx:190-232`; `useAppMechanismActions.ts:114-144` normalizes target ownership, clears incompatible path and picks preferred motion joint. | Target IDs and target anchor joint exact. No stale path from prior owner. | `select[aria-label="Mechanism target"]`; `data-recovery-target` options; browser `workflow.spec.ts:4703-4717,4743-4754`. | **Established** valid/rejected target behavior. |
| Bind/select path and handle | `DesignInspectorPanel.tsx:233-290`; `updateMechanism` derives path-owned target fields and handle. | Path ID and joint ID exact; no path may have two invalid drivers. | `Mechanism motion path`, `Motion handle`, option `data-recovery-target`; browser `workflow.spec.ts:3594-3642`. | **Established** target ownership and exported metadata. |
| Fit mechanism to path | `onOptimize` invokes `fitMechanismToTargetPathResult`, dispatches one accepted `upsert_mechanism` (`useAppMechanismActions.ts:280-327`). | Fit target error must satisfy the mechanism family threshold; physical anchors remain grid-valid. Existing browser evidence checks target error `<0.01` (`workflow.spec.ts:3614-3617`) and grid multiples `<0.01` (`:4804-4812`). | `Fit` button; `data-design-path-fit-status/error/threshold`, `data-design-target-error` (`DesignFoundryPreview.tsx:309-322`). | **Established** current source/test. **Missing runtime proof** fixed-view lens drives same fit without duplicate preview math. |
| Recover from invalid target/path/handle | `updateMechanism`/fit retain prior valid mechanism, set feedback and blocker; Design preview disables physical connections in recovery (`DesignFoundryPreview.tsx:478-490`). | Rejected action must leave prior mechanism bytes/IDs/connection selections unchanged. Recovery candidate must be an explicit selectable target/path/joint. | `.warning`, `design-readiness-blocker`, `data-recovery-mode="static"`, `[data-recovery-target]`; browser `workflow.spec.ts:4703-4717`. | **Established** exact blocker for invalid retarget. **Missing runtime proof** that camera/selection persistence survives recovery in fixed scene. |
| Select mechanism/character in integrated preview | Design automata callbacks dispatch `select_part`/`select_scene_object` (`DesignFoundryPreview.tsx:444-449`). | ID exact; no change to binding unless explicit inspector or connection action. | `design-shared-foundry-preview`, selected lists, connection overlay. | **Inferred** because current preview can use raycast and test telemetry fallback; unified scene must remove dependence on production test telemetry. |
| Select/edit connection in Design | Same `MechanismConnectionOverlay` keyboard/pointer contract; `updateMechanism` is the canonical path. | Same exact role/kind/part/hole identity and coordinates as Foundry. | `design-mechanism-connection-overlay`, `connection-selection-confirmation-${role}`; browser `workflow.spec.ts:1408-1461`. | **Established** shared source/browser pointer contract. Keyboard browser proof missing. |

### Blueprint: proof, recipe choice, and export

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Inspect printable proof before generation | `BlueprintExport.tsx:40-70` derives validation, recipes, and `makeBlueprintPreviewSvg(project, recipes)` from canonical ProjectState. | Board labels and cut geometry derive from the same fabrication recipe; no live visual approximation may become authoritative export. | `blueprint-svg-preview` role `img`, aria `Printable character and mechanism sheets`; `blueprint-export-package-json` is hidden E2E metadata (`BlueprintExport.tsx:89-104`). | **Established** source/visual proof. **Missing runtime proof** for a shared Three lens underneath the SVG/PDF proof after cutover; canonical SVG/PDF bytes must remain unchanged. |
| Select recipe/mechanism sheet | Local `selectedRecipeId`; `selectBlueprintRecipe` prioritizes explicit recipe, then selected mechanism, then first recipe (`BlueprintExport.tsx:22-29,62-68`). | Recipe/mechanism ID exact; board coordinate label exact. | Recipe cards, `BlueprintDetailPanel`, board callout; browser package tests `workflow.spec.ts:2078-2120` and `:3619-3642`. | **Established** source/browser evidence; selected recipe is local UI state and must not mutate ProjectState. |
| Generate package | `BlueprintControlPanel.tsx:107-115` calls `create`; `BlueprintExport.tsx:46-51` dispatches `set_export`. | Package derives from current ProjectState and shared fabrication stack; exact package JSON/bytes are authoritative. | `button[aria-label="Generate package"]`; hidden JSON and download buttons; browser `workflow.spec.ts:1277-1284,2105-2120`. | **Established**. Changes to physical settings/mechanism must invalidate stale `lastExport` through reducer settings path. |
| Download mechanism/character PDF/SVG | Local `downloadText` controls in `BlueprintControlPanel.tsx:120-153`; no further ProjectAction. | Download bytes exact to package/export utilities. | aria labels `Download PDF cut sheet default`, `Download SVG default`, visible Character buttons; browser download metadata helpers. | **Inferred** unless browser download-byte checks are run in this clean worktree; current source preserves named controls. |
| Navigate blockers to recovery stage | Validation issue recovery buttons call `goStage(issue.recoveryStage)` (`BlueprintControlPanel.tsx:90-100`). | No coordinate mutation; retain selected IDs and package invalidation status. | `.warning` / recovery action text; stage left pane. | **Established** source; runtime proof limited to existing browser package flows. |

### Assembly: steps, scrub, inspect, and print

| Interaction | Current source and canonical result | Coordinate requirement | Visual evidence and E2E locator | Risks / counterevidence |
| --- | --- | --- | --- | --- |
| Generate/print Assembly package | `AssemblyGuide.tsx:59-74` dispatches `set_export`; Build/Print button is dynamic (`AssemblyControlPanel.tsx:77-93`). | Same package and fabrication stack as Blueprint; no alternate scene geometry. | `button[aria-label="Generate package"]` or `Print`, PDF buttons; `assembly-readonly-step-strip`. | **Established** source; browser flow exercises package and print states. |
| Select Kit/Custom lane or Mechanism/Character mode | Local lane/mode state (`AssemblyControlPanel.tsx:96-138`). | Selection changes the derived assembly frame only; package IDs and coordinates remain canonical. | `assembly-lane-switch`, `assembly-mode-switch`, buttons `Kit`, `Custom`, `Mechanism`, `Character`. | **Established** source/browser around `workflow.spec.ts:2282-2358`; mode state resets with stage/model changes is local. |
| Choose recipe | Local `selectedRecipeId`; recipe card shows fabrication board callout (`AssemblyControlPanel.tsx:140-160`). | Recipe ID and board label exact. | `assembly-recipe-card`; text `Board ...`. | **Established**. |
| Choose a numbered build step | `assembly-step-button` calls `goAssemblyStep(index)` (`AssemblyControlPanel.tsx:164-183`). `goAssemblyStep` clamps index and resets progress (`useAssemblyGuidePlayback.ts:54-67`). | Step index exact and bounded; progress resets to 0 for a new step. | `assembly-step-list`, `.assembly-step-button`, `assembly-readonly-step-strip[data-step-phase]`; browser `workflow.spec.ts:2317-2355`. | **Established** source/browser. |
| Scrub Assembly step | `WorkspacePlayerDock.tsx:99-108` uses `Assembly scrubber`, `stepProgress`, and `scrubAssemblyStep`; `AssemblySceneFrame` derives progress/active board coords (`AssemblySceneFrame.tsx:5-64`). | Progress is [0,1] step-local; board/ref coordinates exact labels from frame. | `input[aria-label="Assembly scrubber"]`, `aria-valuetext="Step n of m, p%"`, `assembly-visual-progress`, `assembly-active-board-coords`; browser `workflow.spec.ts:2327-2340`. | **Established**. |
| Play/pause/next/previous/start over | `WorkspacePlayerDock.tsx:92-107`; Assembly playback loop advances every 1400 ms and wraps at last step (`useAssemblyGuidePlayback.ts:26-48`). | No canonical ProjectAction; frame must be deterministic for step/progress. | `Playback`, `Pause`/`Play`, `Previous assembly step`, `Next assembly step`, `Start over`, `Playback percent`. | **Established** source; timing-level browser proof is existing but not rerun here. |
| Inspect 3D assembly scene | `AssemblyThreePreview.tsx:58-178` camera state is local; `AssemblyCanvasPane.tsx:101-123` derives Character/Mechanism frame and mounts a Three preview plus `AssemblySceneFrame`. | Inspection camera never changes ProjectState or board coordinates. Fixed 2.5D should be locked; optional paused 3D inspect may orbit/pan. | `assembly-character-three-preview` / mechanism counterpart, `foundry-camera-rig`, `assembly-readonly-step-strip`, data frame attrs. | **Established** current data contract; **Missing runtime proof** post-cutover shared persistent renderer and optional paused-inspect gate. |
| Inspect parts/stack and board coordinates | `AssemblyInspectorPanel.tsx` consumes the frame/package; `AssemblySceneFrame.tsx:52-62` displays active/reference coordinates and visible parts. | Coordinates must be exact strings from fabrication recipe/frame, not screen projection. | `assembly-active-board-coords`, `assembly-floating-references`, `assembly-scene-part-list`, inspector panel. | **Established** source/browser. |

## Keyboard, accessible names, and non-pointer alternatives

### Established global alternatives

`utils/appCommands.ts:15-47` and `useAppCommandBindings.ts:12-35` define and bind:

- `Mod+N/O/S/Shift+S/Alt+S/E`, reset lesson, undo/redo;
- `Mod+=`, `Mod+-`, `Mod+0` for zoom in/out/fit;
- `Alt+1..6` for Character, Path, Foundry, Design, Blueprint, Assembly;
- `Mod+,` for Options and `?` for shortcut help.

The handler ignores `INPUT`, `TEXTAREA`, `SELECT`, and contenteditable targets and is disabled while a modal is open. Existing browser evidence at `tests/browser/workflow.spec.ts:4406-4557` proves modal suppression, typing guard, zoom persistence, stage shortcuts, and invalid workspace-layout recovery.

Stage/pane names are stable: `stageLayout.tsx:27-31` gives left `Workflow`, center `Shared canvas`, right `Selected item inspector`; `WorkflowRail.tsx` exposes `Workflow`; `CanvasZoomToolbar.tsx:5-13` names Zoom out, Zoom in, and Fit view. The player dock (`WorkspacePlayerDock.tsx:83-109`) names Playback, Move controls, Play/Pause, Start over, Previous/Next assembly step, Assembly/Workspace scrubber, and Playback percent.

### Established connection keyboard contract

Physical connection circles are actual `role="button"` controls with roving tab index, `aria-label`, `aria-pressed`, `aria-expanded`, and `aria-keyshortcuts` (`MechanismConnectionOverlay.tsx:578-642`). Arrows cycle same-role identities, Enter/Space accepts, Escape exits (`:495-533`). This is the strongest existing direct-manipulation keyboard pattern and should be the model for any new fixed-view handles.

### Missing or incomplete alternatives

1. Foundry parameter circles and the anchor marker have pointer handlers but no role, name, focus target, or key handler (`FoundryOverlayLayer.tsx:245-285`). Add a compact keyboard path or explicit labelled inspector controls; do not require a mouse-only gesture on Chromebook.
2. Path SVG point circles and joint groups are mouse-click/drag targets without `tabIndex`, role, or per-point accessible names (`SceneSketch.tsx:389-412,431-451`). The `Path editor canvas` label names the surface, but does not provide keyboard drawing, point selection, nudge, or pan. The fixed-view contract must define a keyboard alternative (for example, focus point → arrows with a documented step, Shift for larger step; keyboard focus for joint/handle selection) or explicitly preserve equivalent inspector controls.
3. Three character and Foundry WebGL hosts have wrapper labels (`3D character view`, `Foundry 3D view`) but no semantic hit targets inside the canvas. Lists/selects remain the keyboard fallback for Character/Design selection; this fallback must not disappear during migration.
4. Camera orbit/pan is inherently pointer-based today. The planned 2.5D lens avoids needing a keyboard orbit alternative by locking the authoring camera; the optional 3D inspect mode must be labelled and paused, not silently required for authoring.

## Canonical coordinates, tolerance, and fixed camera

### Scene and SVG coordinates

`utils/coordinates.ts:3-7` fixes `SCENE_VIEW={width:900,height:680}` and `SCENE_PX_PER_MM=2`. `sceneToSvg` and `svgToScene` (`:151-159`) are exact inverses in scene units. `svgPointerToScene` (`:198-204`) applies the inverse screen CTM before that inverse scene transform. This is the established exact path-input contract.

`pathFromPoints` (`:178-195`) rounds only the SVG path string to two decimals. ProjectState `Point` values and `timedPoints` remain unrounded. E2E should assert point-derived state or stable data attributes, not infer canonical values from the `d` string.

### Board coordinates and tolerance

`boardGridCenter=(boardCells-1)/2`, `boardScenePitch=gridPitchMm*2`, and `boardRoundTripTolerance=boardScenePitch/sqrt(2)+1e-9` (`utils/coordinates.ts:74-80`). For the default 15×15, 20 mm kit:

- pitch = 40 scene px;
- nearest-hole round-trip tolerance = `40/sqrt(2)+1e-9 ≈ 28.284271248+` scene px;
- `sceneToBoardRaw` rounds to nearest `(col,row)`, keeps `raw.valid`, and reports `off-board(col,row)` when outside (`:96-105`);
- `sceneToBoard` clamps returned indices to board limits but retains the raw validity (`:107-113`);
- `boardToScene` is the authoritative exact hole coordinate (`:115-121`);
- boundary inclusion uses only `1e-9` epsilon (`:82-94`), not the nearest-hole tolerance.

The distinction matters: the 28.2843 value is an error bound for nearest-hole round trips, not permission to accept an arbitrary off-board drag. Foundry anchor and endpoint actions must expose the snapped `boardToScene` result to canonical mechanism fields. Browser evidence asserts anchor values are exact multiples of 40 within `0.01` (`tests/browser/workflow.spec.ts:4804-4812`); focused coordinate tests cover corners, even-board centers, boundaries, strict off-grid rejection, and export parity (`raw/focused-tests.txt`).

### Connection identity and screen tolerance

Connection selection is not a fuzzy coordinate value. The physical identity `(role, selection.kind, partKey, holeIndex)` is exact and is carried into the fabrication signature. Pointer targeting has a 28 px same-role nearest-handle tolerance and a 3 px movement threshold; these are screen affordance thresholds only (`MechanismConnectionOverlay.tsx:250-266,368-387`). A drop outside the role's handles is rejected, preserving the old signature.

### Fixed-view cutover mapping

The plan requires direct mapping: screen coordinates → NDC → one orthographic camera unproject → z=0 authoring plane → canonical `ProjectAction`. The current code does not yet satisfy this uniformly:

- SVG Path uses exact inverse CTM;
- Character uses `ThreePuppetPreview` raycaster/projected-target selection;
- Foundry uses ray-plane intersection followed by a hardcoded 360×240 preview conversion (`ThreeFoundryPreview.tsx:1610-1638`);
- Design/Assembly use separate Foundry preview camera instances.

These are **missing runtime proof**/migration risks, even when current browser tests pass. The acceptance test should verify one transformed point against known scene coordinates at default and non-default canvas sizes, with no fixed 360×240 constants and no production reliance on debug screen-target JSON.

## Stage persistence and camera lock

### What is established

- `ProjectState` is the aggregate root. Selection/path/mechanism actions and reducer semantics persist across stage changes (`types.ts:510-537`, `utils/project.ts:1707-2231`).
- `canvasViewport` is top-level controller state shared with Character and Path (`useMotionSmithAppController.ts:104-106,351-354`; `AppStageRouter.tsx:144-183`). The browser test proves Path zoom survives a round trip through Design and that Fit resets it (`tests/browser/workflow.spec.ts:4425-4451`).
- Workspace layout persistence stores stage, viewport, and visibility in localStorage (`useAppProjectCommands.ts:243-291`, `utils/projectPersistence.ts:63-127`), validates malformed values, and reports recovery warnings.
- Blueprint and Assembly consume `ProjectState`/`lastExport` rather than a separate mechanism source (`BlueprintExport.tsx:40-70`, `AssemblyGuide.tsx:59-77`). Physical settings invalidate stale exports in the reducer.

### What is local and must remain explicitly local

- Foundry candidate, camera, phase, overlay toggles, and connection drag transient state are local until Use/commit. Do not claim that a local candidate has been persisted merely because the preview changed.
- Design connection drag transient state is local, but accepted updates go through `updateMechanism` and `upsert_mechanism`.
- Assembly step index/progress/playing, selected recipe, lane, and inspect camera are local derived presentation state; frame data must be recomputable from canonical recipe + ProjectState.

### Camera-lock acceptance

The plan's default authoring view is a locked orthographic 2.5D camera. The optional 3D mode may unlock orbit/pan/inspect, but must use the same scene and must not change canonical XY. Current counterevidence:

- `ThreePuppetPreview.tsx:1114` constructs `PerspectiveCamera`; pointer gestures orbit/pan at `:1738-1772`.
- `ThreeFoundryPreview.tsx:1644-1653` constructs another WebGLRenderer and `PerspectiveCamera`.
- Assembly's preview uses another camera hook (`AssemblyThreePreview.tsx:58-178`).

Therefore “camera lock” is **missing runtime proof** at this baseline. A cutover E2E should assert (a) default 2.5D camera type/projection and locked camera attrs, (b) pointer drag in default mode leaves camera pose unchanged while direct XY edits still work, (c) explicit 3D inspect mode changes only camera state, and (d) switching stages does not reset the persistent scene or selection. Existing camera tests (`workflow.spec.ts:3818-3978`) are useful regression evidence for current behavior but cannot be reused as proof of the new locked mode without updated assertions.

## Visual evidence and locator rules for the cutover

Prefer the following stable locators in E2E, in this order:

1. Accessible role/name for actions and controls (`getByRole`, `getByLabel`).
2. Contract test IDs for stage surfaces and physical handles (`data-testid=...`).
3. Stable data attributes carrying canonical IDs or proof state (`data-connection-role`, `data-connection-hole-index`, selected IDs, board labels, frame version).
4. Bounding-box/pointer coordinates only to exercise a gesture; assert the resulting canonical state, not a screenshot pixel.

Do not make production behavior depend on E2E-only JSON telemetry. `ThreeFoundryPreview.tsx:1551-1605` currently parses `data-threeSceneObjectScreenTargets`/`data-threePartScreenTargets` as a fallback. The plan explicitly puts runtime diagnostics behind E2E-only boundaries; after cutover, telemetry may expose evidence but must not decide production selection.

The established visual proof surfaces are:

- Character: `character-three-puppet`, `character-three-puppet-state`, part/object list and inspector.
- Path: `path-canvas`, `selected-motion-path`, `free-draw-status`, `skeleton-joint-*`, `path-part-*`.
- Foundry: `foundry-preview`, camera rig state, `foundry-param-handle-*`, physical connection circles, board/connection signatures.
- Design: `design-shared-foundry-preview`, `data-design-target-*`, `data-design-path-fit-*`, recovery mode, connection confirmations.
- Blueprint: `blueprint-svg-preview` role img, package JSON only as E2E evidence, export controls and board callout.
- Assembly: `assembly-readonly-step-strip`, `assembly-visual-progress`, active/reference board coordinates, scene part list, named scrubber and step buttons.

## Risks and counterevidence to carry into migration

1. **Renderer multiplicity.** Baseline source has `new THREE.WebGLRenderer` in `components/ThreePuppetPreview.tsx:1100` and `components/stages/foundry/ThreeFoundryPreview.tsx:1644`; current stage mounts can create separate contexts. This audit makes zero production changes, so the call-count delta is zero. The cutover must prove one persistent renderer/context.
2. **Projection mismatch.** Perspective camera/raycast paths and the hardcoded 360×240 anchor conversion are not the required direct orthographic mapping.
3. **Pointer-only handles.** Foundry parameter/anchor circles and Path points/joints lack complete keyboard semantics. Connection holes are the positive counterexample and should be reused.
4. **Local Foundry candidate boundary.** Preview edits are local until Use/commit. Stage switching or accidental remount can lose uncommitted changes; E2E must assert commit timing and no false persistence.
5. **Telemetry fallback.** Production selection currently parses screen-target JSON. This can mask raycast or projection failures and must be demoted to diagnostics.
6. **SVG precision boundary.** `toFixed(2)` path strings are visual serialization, not canonical points. A migration that round-trips through path `d` will lose precision.
7. **Selection side effects.** `select_part`/`select_scene_object` automatically select the first owned path. A stage lens must preserve this reducer behavior, including clearing the opposite selection.
8. **Recovery invariant.** Rejected target/connection/fit edits must retain the prior accepted mechanism, path, connection selections, and export signature. A blocker should be a direct next action such as `Fix: Choose anchor`.
9. **Assembly frame authority.** Assembly visual motion must derive from the fabrication stack and the same ProjectState/recipe, not from a decorative CSS animation or disconnected scene.
10. **Dependency/test environment.** This clean worktree has no `node_modules`; coordinate and Foundry command tests that import `three`/`lucide-react` cannot currently execute. Their raw exit codes are preserved rather than reported as passes.

## Rejected interpretations

- Treating the current separate SVG and Three renderers as acceptable evidence for the unified persistent-scene requirement.
- Treating a board round-trip tolerance of ~28.2843 scene px as a general input tolerance or as permission to accept off-board coordinates.
- Treating screen-target debug JSON as canonical selection output.
- Treating local Foundry candidate state as a canonical `ProjectState` edit before `commit_mechanism_candidate`.
- Replacing accessible list/inspector fallbacks with canvas-only picking.
- Claiming keyboard completeness because global shortcuts exist; direct point/handle interactions need their own focus/name/action contract.
- Updating production code or tests from this audit branch; scope is evidence artifacts only.

## Verification and evidence files

Raw command output and exit codes are preserved under `artifacts/performance/audit-interaction/raw/`:

- `raw/source-search.txt` — baseline branch/status, canonical action/coordinate/path/character/Foundry/Blueprint/Assembly/keyboard source searches, and their exit code.
- `raw/focused-tests.txt` — focused path-finalization, coordinate, connection-provenance, command-feedback, Foundry sequencing, Fit-boundary, and warning-presentation test commands with exact output and exit codes. Passing tests are not inflated; missing dependencies remain failures.
- `raw/test-discovery.txt` — focused test-file discovery/search output, including the non-zero search caused by an absent optional filename.
- `raw/baseline-counts.txt` — renderer/action source-count baseline used to report zero production call-count delta.

Focused results at this baseline:

| Command | Exit | Result |
| --- | ---: | --- |
| `bun tests/g3-path-pointer-finalization.test.ts` | 0 | Passed |
| `bun tests/g2-coordinate-readiness.test.ts` | 1 | Could not resolve `three` because dependencies are absent |
| `bun tests/mechanism-connection-provenance.test.ts` | 0 | Passed |
| `bun tests/mechanism-command-feedback.test.ts` | 0 | Passed |
| `bun tests/g3-foundry-command-sequencing.test.ts` | 1 | Could not resolve `lucide-react` because dependencies are absent |
| `bun tests/mechanism-fit-boundary.test.ts` | 0 | Passed |
| `bun tests/mechanism-warning-presentation.test.ts` | 0 | Passed |

No production file was edited. The required fixed-view interaction artifact is evidence-only and must be reviewed again after the unified renderer changes, especially for camera lock, orthographic coordinate exactness, keyboard direct manipulation, renderer multiplicity, and runtime browser proof.

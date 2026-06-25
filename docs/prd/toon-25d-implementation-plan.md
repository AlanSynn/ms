# Toon 2.5D / 3D Unlock Implementation Plan

Status: approved implementation plan candidate
Created: 2026-06-25
Parent docs: [`toon-25d-main-3d-unlock-plan.md`](toon-25d-main-3d-unlock-plan.md), [`realistic-25d-3d-physics-platform-plan.md`](realistic-25d-3d-physics-platform-plan.md), [`canva-video-editor-workspace-plan.md`](canva-video-editor-workspace-plan.md), [`novice-canva-style-ui-plan.md`](novice-canva-style-ui-plan.md)
Scope: staged implementation of the compact in-browser MotionSmith editor, with toon 2.5D as the main workbench and 3D/physics as derived lenses.

## 1. Final product decision

MotionSmith should feel like a compact browser-native creative editor, not a CAD console:

```text
Canonical ProjectState (2D truth)
  -> pure SceneProjection contract
     -> locked orthographic toon 2.5D workbench (default)
     -> camera-unlocked 3D inspection view (same scene)
     -> physics sidecar/replay samples (same scene descriptors)
     -> blueprint/export from canonical 2D only
```

The default view is a **toon paper-automata stage**: layered character slabs, clear pins, rods, ribbons, labels, and a light editorial MotionSmith palette. 3D is not a separate authoring product; it is the same scene with the fixed camera unlocked for inspection.

## 2. Frontend-skill contract

### Visual thesis

A calm, toy-like robotics workbench: white paper stage, violet/blue primary action, cel-shaded layered character pieces, friendly labels, and compact editor chrome that keeps the center canvas dominant.

### Content plan

1. **Start** — choose a starter character/template or run real ONNX/package import.
2. **Draw** — select a body part and draw a free path directly on the shared canvas.
3. **Explore** — preview recommended mechanisms against the path and sensemaking copy.
4. **Attach** — bind the mechanism to a body part/path/joint and scrub the motion.
5. **Build** — validate board placement and export blueprint/assembly guide.
6. **Inspect** — optional view lens for depth, 3D orbit, physics forces, or exploded assembly.

### Interaction thesis

- **One canvas, many lenses:** workflow changes swap tools/panels/layers, never the mental model.
- **Camera is not geometry:** path drawing and fabrication stay planar even when the view has depth.
- **Compact first:** default UI shows the next action and one concise status; advanced parameters sit behind inspector sections.

## 3. Non-negotiable invariants

1. `ProjectState` remains the only source of truth for parts, skeleton, paths, mechanisms, settings, and fabrication export.
2. Scene projection, 2.5D rendering, 3D camera state, physics sessions, and ghost overlays are derived or transient.
3. Drawing a free path must never orbit the camera.
4. Camera unlock must not mutate canonical coordinates.
5. Physics simulation must not silently rewrite paths, joints, or mechanisms; write-back must be explicit and undoable.
6. Blueprint export must keep using canonical 2D/fabrication state and existing validation.
7. No visible UI control may be a mock. If a capability is unavailable, it must be an honest disabled guard with a reason.

## 4. Canonical glossary

Use these names in code, docs, and UI copy to avoid drift.

| Concept | Code value | User-facing label | Meaning |
| --- | --- | --- | --- |
| Default authoring lens | `studio` | `2.5D Locked` | Toon orthographic workbench; pan/zoom/path drawing enabled; orbit disabled. |
| Layer/debug lens | `depth` | `Depth Inspect` | Shows layer order, thickness, anchor stack, and occlusion; no free orbit. |
| Presentation lens | `toy-stage` | `Toy Stage` | Same scene eased into 3/4 view; orbit enabled after unlock only. |
| Assembly lens | `assembly` | `Exploded Assembly` | Scripted exploded view for build comprehension; no free editing. |
| Advanced lens | `inspect` | `Inspect` | IDs, axes, collision shapes, and explicit advanced controls. |
| Physics lens | `physics` | `Physics` | Fixed-step samples, forces, velocities, constraints, warnings. |
| Blueprint lens | `blueprint` | `Blueprint` | Fabrication/board/assembly preview from canonical 2D state. |

Camera state names:

- `locked-2.5d`: authoring camera, front orthographic, no orbit.
- `depth-inspect`: side/stack preset, no orbit.
- `toy-stage`: 3/4 camera, limited orbit after unlock transition.
- `assembly-exploded`: scripted offsets, no direct authoring.
- `inspect-free`: advanced orbit/gizmos; write-back disabled unless an explicit bake command is implemented.

The same mapping is used by `ToonSceneProjection.cameras`, app session state, and browser tests.


## 5. Exact M1 projection schema

M1 must implement these concrete types in `utils/sceneProjection.ts`. Names may be extended later, but the fields below are the minimum contract.

```ts
type ProjectionSourceType =
  | 'board'
  | 'part'
  | 'joint'
  | 'bone'
  | 'path'
  | 'mechanism'
  | 'hardware'
  | 'helper'
  | 'label'
  | 'warning';

type ProjectionExportRole =
  | 'fabrication'
  | 'project-reference'
  | 'preview-only'
  | 'label'
  | 'debug';

type ProjectionGeometry =
  | { kind: 'rect'; center: Point; size: { width: number; height: number }; rotationRad: number }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'polyline'; points: Point[]; closed: boolean; width: number }
  | { kind: 'line'; from: Point; to: Point; width: number };

type ToonSceneNode = {
  id: string;              // stable path, e.g. /character/right_arm
  sourceType: ProjectionSourceType;
  sourceId?: string;       // required only for canonical ProjectState objects
  parentId?: string;
  label: string;
  geometry: ProjectionGeometry;
  transform2d: { x: number; y: number; rotationRad: number; scale: number };
  depthMm: number;
  thicknessMm: number;
  renderOrder: number;
  material: 'board' | 'paper' | 'acrylic' | 'toyMetal' | 'pin' | 'pathRibbon' | 'ghost' | 'warning';
  interactive: boolean;
  exportRole: ProjectionExportRole;
};

type InteractionBinding = {
  id: string;
  type: 'draw-path-on-plane' | 'select-source' | 'pan-zoom-locked-camera' | 'unlock-camera' | 'bake-3d-transform';
  enabled: boolean;
  sourceType?: ProjectionSourceType;
  sourceId?: string;
  nodeId?: string;
  writesProject: boolean;
  reason?: string;
};

type ToonLabelNode = {
  id: string;
  text: string;
  anchorNodeId?: string;
  anchorPoint: Point;
  severity?: 'info' | 'warning' | 'error';
  collapsible: boolean;
};

type CameraPreset = {
  id: 'locked-2.5d' | 'depth-inspect' | 'toy-stage' | 'assembly-exploded' | 'inspect-free';
  label: '2.5D Locked' | 'Depth Inspect' | 'Toy Stage' | 'Exploded Assembly' | 'Inspect';
  locked: boolean;
  orbitEnabled: boolean;
  position: { x: number; y: number; zMm: number };
  lookAt: { x: number; y: number; zMm: number };
  zoom: number;
};

type ProjectionWarning = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceNodeId?: string;
  sourceType?: ProjectionSourceType;
  sourceId?: string;
  recoveryStage?: AppStage;
};

type ToonSceneProjection = {
  version: 1;
  units: { scene: 'px'; depth: 'mm'; scenePxPerMm: number };
  coordinateSystem: { x: 'right'; y: 'up'; z: 'toward-camera-depth' };
  nodes: ToonSceneNode[];
  labels: ToonLabelNode[];
  cameras: CameraPreset[];
  interactions: InteractionBinding[];
  warnings: ProjectionWarning[];
};
```

### Source-id mapping rules

- `sourceId` is **required** for canonical project-backed `part`, `joint`, `bone`, `path`, and `mechanism` nodes.
- `bone` nodes use canonical tuple ids: `${parentJointId}->${childJointId}`. Tests must validate both joints exist and the tuple exists in `ProjectState.skeleton.bones`.
- `sourceId` is optional for `board`, `hardware`, `helper`, `label`, and `warning` nodes because those may be derived from settings, generated linkage samples, or validation warnings.
- Cameras are not `ToonSceneNode`s; they live in `ToonSceneProjection.cameras`.
- Labels live in `ToonSceneProjection.labels` and may also have lightweight `label` nodes only when the renderer needs scene-anchored hit testing.
- `exportRole: 'fabrication'` may be used only for nodes that map to canonical fabrication/project data.
- `exportRole: 'project-reference'` is for canonical objects that are selectable/editable but not directly exported as cut geometry, e.g. skeleton joints.
- `exportRole: 'preview-only'`, `'label'`, and `'debug'` are explicitly exempt from canonical `sourceId` requirements.

### Coordinate and ordering contract

- Canonical scene units are existing MotionSmith scene pixels.
- 2.5D/3D conversion uses `SCENE_PX_PER_MM` from `utils/coordinates.ts`.
- Axis mapping for three.js later:
  - project `x` -> world `X`;
  - project `y` -> world `Y`;
  - derived depth -> world `Z`;
  - default locked camera looks down `+Z` toward the XY authoring plane.
- `depthMm` is deterministic:
  - board/grid: `-4`;
  - parts: `zIndex * 2`, with `partOrder` index as tie-breaker;
  - skeleton/joints/bones: above parts by `+1`;
  - paths: above target part by `+3`;
  - mechanisms/hardware: above paths by `+5`;
  - labels/warnings: above everything by `+8`.
- `renderOrder` sorts by `depthMm`, then source category, then stable id. No array iteration over unordered object keys without sorting.
- Parent transforms are visual grouping only. M1 projection stores all geometry in canonical scene-space coordinates; parent transforms must not be required to reconstruct fabrication positions.
- Every geometry point, transform, depth, thickness, and order value must be finite.

### App integration boundary

`ViewLensState` and `CameraSessionState` are transient React/app-shell state, not `ProjectState`.

- `AppStage` remains the workflow/navigation state: `character`, `path`, `foundry`, `design`, `blueprint`, `options`.
- `ViewLensState` is an independent canvas lens over the active stage: `studio`, `depth`, `toy-stage`, `assembly`, `physics`, `blueprint`, `inspect`.
- The `blueprint` stage may default the lens to `blueprint`, but lens switching must not change `stage`.
- `CanvasViewport` remains the 2D pan/zoom state and is reused by locked 2.5D/SVG overlay.
- Existing persisted selected ids (`selectedPartId`, `selectedPathId`, `selectedMechanismId`) remain the source of truth for project selection until a transient richer `SelectionState` is introduced.
- `Canvas.tsx` keeps the existing SVG/HTML authoring layer for drawing and reducer writes through M3. A future `ToonWorkbench` consumes projection data for rendering/picking and mirrors selection back through existing ids.
- Lens switches, camera unlock/lock, renderer toggles, and physics replay are “view-only” actions: they must not change serialized `ProjectState`, `metadata.updatedAt`, or `lastExport`.

## 6. Implementation milestones

### M1 — Projection contract and tests

Goal: create the stable semantic boundary that future WebGL/physics code consumes.

Deliverables:

- Add a pure `utils/sceneProjection.ts` module.
- Export `ToonSceneProjection`, `ToonSceneNode`, `ToonLabelNode`, `CameraPreset`, `InteractionBinding`, and `ProjectionWarning` types.
- Derive Viser-style stable node paths from `ProjectState`, e.g. `/character/right_arm`, `/skeleton/right_hand`, `/paths/path-right-arm`, `/mechanisms/m1/output`.
- Assign deterministic `renderOrder`, `depthMm`, `thicknessMm`, `material`, `interactive`, and `exportRole`.
- Include `interactions` so renderers know what is selectable, drawable, camera-only, preview-only, or default-disabled.
- Include compact labels/warnings for selected/invalid objects without creating UI-specific strings in React.

Acceptance:

- Projection does not mutate `ProjectState`.
- Two calls with the same project return deeply equal output.
- All projected coordinates are finite.
- Parts, joints, paths, mechanisms, board, labels, and cameras are represented.
- Interaction bindings include path drawing on the canonical plane, object selection by source id, locked camera pan/zoom, camera unlock, and default-disabled 3D write-back/bake.
- Export/fabrication contracts remain untouched.
- Full serialized project, `metadata.updatedAt`, and `lastExport` are unchanged by projection builds.

### M2 — Compact view/session state

Goal: add editor-session state for view lenses without changing project files.

Deliverables:

- Add transient `ViewLensState` in the app shell: `studio`, `depth`, `toy-stage`, `assembly`, `physics`, `blueprint`, `inspect`.
- Add `CameraSessionState` with mode, lock status, zoom, pan, look-at, and orbit-enabled flag.
- Keep the existing SVG canvas as the authoring fallback while the projection contract powers overlays.
- Add a compact canvas HUD: lens switcher, camera lock/unlock, reset, selected object chip, warning chip.

Acceptance:

- Stage switching preserves canvas viewport and selected object.
- Path drawing works in `studio`/locked 2.5D and disables orbit.
- `toy-stage` unlock is preview-only and can return to exact front view.
- Browser tests cover viewport persistence and no accidental canvas scroll from side panes.

### M3 — Plain three.js toon 2.5D shell

Goal: introduce real toon 2.5D rendering with the smallest dependency surface.

Deliverables:

- Add `three` only.
- Create one isolated renderer component that consumes `ToonSceneProjection`.
- Use `OrthographicCamera` by default.
- Use `MeshToonMaterial` plus simple outline shell geometry before postprocessing.
- Render board/grid, character slabs, joints/pins, one motion ribbon, and active mechanism rods.
- Lazy-load the renderer and keep SVG fallback for unsupported WebGL.
- Keep canonical drawing input in the existing SVG/HTML overlay during M3. The three.js canvas is a visual/picking preview layer; it must not become the path-input source of truth in this slice.
- Three object picking may mirror selection back to existing ids, but path editing, point editing, and mechanism parameter writes still go through existing reducers/actions.

Acceptance:

- No fabrication/export diffs after enabling WebGL view.
- Build size increase is noted.
- Browser smoke test verifies renderer mounts, lens switch works, and canonical path drawing still works.
- Browser test proves path points drawn through the SVG overlay are identical with the WebGL toon layer on or off.
- Screenshot review: center canvas remains visually dominant; right panel scroll does not move the canvas.

### M4 — 3D camera unlock and toy-stage inspection

Goal: make 3D feel like unlocking the same stage, not launching a new app.

Deliverables:

- Add camera transition from locked front orthographic to limited 3/4 toy-stage view.
- Enable orbit only after unlock completes.
- Add `Lock to 2.5D`, `Front`, `Iso`, `Explode`, and `Reset` controls.
- Add labels that billboard/collapse cleanly.
- Keep object drag disabled in 3D unless an explicit Inspect write-back command exists.
- If an advanced bake/write-back command is later added, it must create a normal undoable project action and include before/after preview. Until then, `bake-3d-transform` remains an explicit disabled interaction binding.

Acceptance:

- Camera unlock/lock preserves selection, animation progress, path points, and export output.
- Drawing mode automatically locks camera or blocks orbit.
- Browser tests assert path data equality before/after camera unlock.
- Browser/contract tests assert 3D write-back/bake is unavailable by default and cannot mutate the project accidentally.

### M5 — Physics sidecar and mechanism force overlays

Goal: support realistic motion understanding without replacing kinematic/fabrication truth.

Do not start M5 until this minimal API is documented and contract-tested:

```ts
type PhysicsSession = {
  version: 1;
  engine: 'kinematic' | 'rapier3d';
  seed: string;
  fixedDtSeconds: number; // default 1 / 60
  units: { scenePxPerMm: number; massUnit: 'gram'; timeUnit: 'second' };
  frame: number;
  samples: PhysicsBodySample[];
  warnings: PhysicsWarning[];
};

type PhysicsBodySample = {
  sourceNodeId: string;
  sourceType: ProjectionSourceType;
  sourceId?: string;
  position: { x: number; y: number; zMm: number };
  rotationRad: number;
  velocity?: { x: number; y: number; zMm: number };
};

type PhysicsWarning = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  sourceNodeId?: string;
  sourceId?: string;
  message: string;
};
```

Physics samples are runtime/replay data. They are never stored in `ProjectState` unless a later explicit export format is added.

Deliverables:

- Add `PhysicsSession` descriptors derived from `ToonSceneProjection`.
- Start with deterministic kinematic samples and warnings; introduce Rapier only after descriptors and fixed-step tests are stable.
- Display force/velocity/constraint overlays as toon arrows/chips.
- Add collision/overconstraint warning rows linked to the fixing workflow.

Acceptance:

- Fixed-step replay is deterministic in contracts.
- Physics warnings do not mutate project state.
- Browser tests cover play/scrub/physics lens and blueprint export after simulation.

### M6 — Compact novice UI polish pass

Goal: make the editor read like a Canva/video-player/browser editor.

Deliverables:

- Collapse repeated panels into one compact contextual inspector.
- Keep right pane scroll independent from center canvas.
- Use a bottom player/timeline for play/pause/scrub/speed/loop.
- Keep one primary CTA per workflow step.
- Add plain-language mechanism sensemaking and repair links.

Acceptance:

- First viewport is understandable in five seconds: current step, selected object, next action, and preview status.
- Canvas occupies the central workspace and never scrolls with inspectors.
- Browser E2E covers character/template -> free path -> mechanism -> attach -> blueprint.

## 7. Top-down workflow audit

| Workflow | User mental model | Required editor behavior | Main implementation anchor |
| --- | --- | --- | --- |
| Load character | “Choose what to animate.” | Real template/package/ONNX project state; starter characters are muted placeholder-like and editable. | `ProjectState.parts`, `skeleton`, `characterPackage` |
| Draw path | “Tell this part where to go.” | Free drag path on shared canvas; IK preview reaches selected anchor; camera stays locked. | `ProjectMotionPath`, `motionPreviewForPath` |
| Explore mechanism | “Which machine fits this path?” | Recommendation/foundry cards map to real mechanism configs and generated paths. | `MechanismConfig`, `generateCurvePoints` |
| Attach/tune | “Is it actually driving the body?” | End effector pins to driven joint; warnings for duplicates/detached/partial range. | `motionPreviewForProject`, `mechanismBindingWarnings` |
| Simulate/inspect | “Why does it move or fail?” | Derived 2.5D/3D/physics overlays, no silent write-back. | `ToonSceneProjection`, `PhysicsSession` |
| Build/export | “Can I make it?” | Validation, board coordinates, cut sheet, assembly guide from canonical state. | `createFabricationPackage` |

## 8. Bottom-up implementation audit

| Layer | Must stay simple | First testable contract |
| --- | --- | --- |
| Types | Do not expand `ProjectState` for renderer-only data. | Projection types live outside persisted project state. |
| Geometry | Use finite 2D transforms and deterministic depth. | Projection stability + finite coordinate tests. |
| Rendering | Isolated renderer consumes descriptors only. | WebGL smoke + SVG fallback. |
| Interaction | Authoring tools write existing reducers only. | Path data unchanged by camera unlock. |
| Physics | Runtime session/replay buffer only. | Fixed-step deterministic replay. |
| UI | One central canvas, one inspector, one timeline. | Browser layout/scroll/playwright tests. |

## 9. Compact in-browser editor criteria

Every implementation slice must be reviewed against this checklist:

- Does the center canvas remain the largest and calmest surface?
- Can a novice identify the current step and next action without reading docs?
- Does the right pane scroll without moving the canvas?
- Is there only one filled primary action in the active inspector?
- Are mechanism/IK/physics warnings written as “issue + fix” rather than jargon?
- Does the global player control every preview path/mechanism/lens consistently?
- Can advanced parameters collapse without hiding the primary workflow?

## 10. Commit strategy

Commit by functional milestone:

1. M1 projection contract + tests + docs.
2. M2 view/session shell + browser layout tests.
3. M3 three.js toon shell + WebGL smoke tests.
4. M4 camera unlock + no-mutation tests.
5. M5 physics descriptors/replay + deterministic tests.
6. M6 compact UI polish + end-to-end browser QA.

Each commit must use the Lore commit protocol and must not stage unrelated resource assets.

# Toon 2.5D Main Workbench + 3D Camera Unlock Plan

Status: active direction addendum  
Created: 2026-06-25  
Supersedes part of: `docs/archive/plans/realistic-25d-3d-physics-platform-plan.md`
Mission: make **2.5D the main product view**, with **3D as a fixed-view unlock**, styled as a **cartoon/toon paper automata workbench**, while keeping 2D fabrication state canonical.

## 0. Updated decision

The main renderer should feel like **2.5D by default**, not a flat SVG editor with an optional depth garnish. The editor opens into a locked, orthographic, toon-shaded paper-theater view. Users still draw paths and attach mechanisms in the same canonical 2D coordinates, but the visual language is layered, dimensional, and tactile from the start.

3D is not a separate mode. It is a **camera unlock**: release the fixed 2.5D camera, tilt into a toy-stage 3/4 view, and optionally orbit for inspection. Flattening back to 2.5D returns to the exact authoring frame.

## 1. Product model

```text
2D canonical ProjectState
  -> SceneProjection
     -> Toon 2.5D Workbench       main authoring/preview renderer
     -> Camera-unlocked 3D view   same scene, freer camera
     -> PhysicsSession            sidecar simulation/replay
     -> Blueprint export          still canonical 2D/fabrication
```

Key rule: **2.5D/3D realism is renderer/session state, not fabrication truth.**

## 2. What “2.5D main” means

### Default view

- Orthographic camera, front-biased but visibly dimensional.
- Character parts render as thin paper/cardboard slabs.
- Mechanism rods and pins have thickness, shadows, and toon outlines.
- Motion paths are translucent ribbons, still projected from canonical 2D paths.
- Labels are scene-attached chips, not separate form fields.
- The grid is a stage floor/board, still aligned to 2cm/fabrication units.

### Authoring behavior

- Path drawing remains planar.
- IK/mechanism handles remain constrained to canonical drawing planes.
- Selection, snapping, pivots, and anchors use source IDs from `ProjectState`.
- The camera may have depth/parallax, but drawing math must not depend on camera perspective.

### Visual feel

Use **storybook robotics lab** rather than CAD:

- cel/toon bands;
- thick selected outlines;
- soft contact shadows;
- paper/acrylic/toy-metal material presets;
- glossy colored pinheads;
- friendly labels and warning chips;
- light MotionSmith background, not a dark grey 3D viewport.

## 3. 3D as camera unlock

### Interaction contract

The 3D transition should feel like this:

1. User is in 2.5D Workbench.
2. User clicks `Unlock camera` or `Toy stage`.
3. Current animation frame, selection, path, and mechanism stay fixed.
4. Camera eases from front orthographic into 3/4 toy-stage view.
5. Layers peel apart slightly; rods/pins gain visible side thickness.
6. Orbit is enabled only after the transition completes.
7. `Lock to 2.5D` returns to the exact front authoring frame.

### Camera states

| State | Purpose | Controls |
| --- | --- | --- |
| `2.5D Locked` | default authoring | pan/zoom only; no orbit |
| `Depth Inspect` | layer/order debugging | side-stack preset, no free orbit |
| `Toy Stage` | 3/4 presentation | limited orbit, reset/lock controls |
| `Exploded Assembly` | build comprehension | scripted depth offsets, no free editing |
| `Inspect` | advanced robotics view | orbit, gizmos, IDs, axes, debug labels |

### What must never happen

- Drawing a path must not accidentally orbit the camera.
- Blueprint coordinates must not change after camera unlock.
- 3D drag/gizmo edits must not write canonical geometry unless the user explicitly applies/bakes them.

## 4. Viser structure: what to copy

Viser is useful as a structural reference, not as a runtime to embed. Its public docs/repo describe a web-based robotics/CV visualization system with scene primitives, GUI controls, click/drag/transform interactions, programmatic camera control, and a browser client.

### Copy these concepts

| Viser concept | Evidence | MotionSmith adaptation |
| --- | --- | --- |
| Hierarchical scene tree | Viser scene names like `/base_link/shoulder/wrist` define parent/child nodes; parent transforms affect children. | Use stable node paths such as `/character/right_arm/lower`, `/mechanism/m1/output`, `/labels/m1/warning`. |
| Node handles | Viser handles expose position/orientation/visibility/remove/callback semantics. | Make a local `SceneNodeHandle`-like adapter for selection, visibility, transforms, labels, and undoable commands. |
| Scene + GUI split | Viser exposes a Scene API and GUI API. | Keep canvas scene state separate from React side panels, but bind both through canonical IDs. |
| Camera as explicit state | Viser tracks camera pose, look-at, FOV/aspect, and camera updates. | Store `CameraSessionState`: mode, preset, lock status, lookAt, zoom, orbit target; keep it separate from `ProjectState`. |
| Labels as scene nodes | Viser labels can be screen-sized, scene-sized, anchored, visible, and depth-tested. | Treat labels/warnings as first-class render nodes with source IDs and zoom-collapse behavior. |
| Transform controls | Viser transform controls support active axes, limits, drag callbacks. | Use friendly “storybook gizmos” first; expose full XYZ gizmos only in Inspect. |
| Performance guidance | Viser warns against thousands of individual nodes and recommends batching/visibility toggles for time-series data. | Batch pins/rods/ghost traces where possible; update transforms/visibility per frame instead of recreating nodes. |

### Do not copy these parts

- Python server model.
- WebSocket/messagepack transport.
- share URL/tunnel system.
- Viser's OpenCV/robotics camera convention unless it is explicitly mapped to MotionSmith coordinates.
- R3F/Mantine/Zustand dependency stack as a package bundle.

MotionSmith is a client-side React/Vite editor. Copy **scene graph discipline**, not Viser's deployment architecture.

## 5. Minimal dependency direction

The old plan preferred no-dep SVG/CSS 2.5D first. This is now revised:

### New preferred path

1. **Add plain `three` for the 2.5D main renderer.**
   - Use `WebGLRenderer` in one isolated React component.
   - Use `OrthographicCamera` as the default locked 2.5D camera.
   - Use `MeshToonMaterial` for cel/toon shading.
   - Use `OrbitControls` only when camera is unlocked.
2. **Use lightweight local scene adapter first.**
   - No `@react-three/fiber`, no `drei`, no Viser client stack initially.
   - Avoid duplicating Viser's dependency surface.
3. **Add outline postprocessing only if cheap outlines are insufficient.**
   - Start with geometry/material outline meshes.
   - Use `OutlinePass` + `EffectComposer` only for selected/hovered objects if needed.
4. **Add Rapier later for real physics.**
   - Keep fixed-step replay and sidecar session model.
   - Physics must not become the editor source of truth.
5. **Consider R3F only if the renderer becomes large.**
   - If the renderer grows into many declarative React scene components, reassess.
   - Until then, plain three keeps the boundary obvious.

## 6. Renderer architecture

### SceneProjection remains the boundary

```ts
type ToonSceneProjection = {
  nodes: ToonSceneNode[];
  labels: ToonLabelNode[];
  cameras: CameraPreset[];
  interactions: InteractionBinding[];
  warnings: ProjectionWarning[];
};

type ToonSceneNode = {
  id: string;                 // stable render id
  sourceType: 'part' | 'joint' | 'path' | 'mechanism' | 'hardware' | 'helper';
  sourceId?: string;          // canonical ProjectState id when applicable
  parentId?: string;
  plane2d: Transform2D;       // canonical 2D transform basis
  depthMm: number;
  thicknessMm: number;
  material: 'paper' | 'acrylic' | 'toyMetal' | 'pin' | 'pathRibbon' | 'ghost';
  interactive: boolean;
  exportRole: 'fabrication' | 'preview-only' | 'label' | 'debug';
};
```

Renderer owns GPU objects. Projection owns stable semantic descriptors. `ProjectState` owns authoring truth.

### Node path scheme

Borrow Viser-style hierarchy, but keep it local:

```text
/root
  /character
    /character/head
    /character/right_arm/upper
    /character/right_arm/lower
  /skeleton/right_arm/elbow
  /paths/right_hand/wave_path
  /mechanisms/m1/base
  /mechanisms/m1/output
  /hardware/m1/pins/elbow_pin
  /labels/m1/safe_rotation
  /preview/ghosts/frame_012
```

Parent transforms can be used for visual grouping, but canonical positions still come from `ProjectState`.

## 7. Toon material system

### Material presets

| Preset | Used for | Look |
| --- | --- | --- |
| `paper` | character parts | matte cel bands, slight edge thickness |
| `acrylic` | transparent guide layers | translucent color with outline |
| `toyMetal` | rods/linkages | saturated enamel, small highlight band |
| `pin` | pivots/screws | glossy colored cap |
| `pathRibbon` | desired/mechanism paths | translucent ribbon/light trail |
| `ghost` | previous/future motion | pale transparent slab/dot |

### Shader direction

- Start with `MeshToonMaterial`.
- Use a small gradient map for hard shade bands.
- Add selected object outline via duplicate backface shell first.
- Only add postprocessing outlines when selection/hover quality demands it.

## 8. Interaction model

### Main 2.5D Workbench

- left click: select part/mechanism/path;
- drag in path tool: draw path on canonical plane;
- drag handle: move/rotate planar authoring handle;
- wheel/trackpad: zoom/pan;
- no orbit.

### Camera unlock / Toy Stage

- click: select;
- drag empty space: orbit, only after unlock;
- drag object: disabled by default, or preview-only in Inspect;
- `Lock to 2.5D`: restore authoring camera.

### Inspect

- show axes, IDs, collision shapes, joint frames;
- enable advanced transform controls;
- any write-back action must be explicit and undoable.

## 9. Physics integration under this direction

Physics should eventually run against the same projected scene:

1. `ProjectState` -> `SceneProjection`.
2. `SceneProjection` -> physics descriptors.
3. PhysicsSession samples fixed-step poses, forces, warnings.
4. Toon renderer displays those samples as overlays.
5. Blueprint export reads canonical 2D plus approved metadata only.

Physics UI should be toon-friendly:

- safe rotation arcs;
- velocity/force arrows;
- collision glow;
- overconstraint warning chips;
- ghost trails.

## 10. Milestone changes

### M1 — Projection contract first

- Add `SceneProjection` / `ToonSceneProjection` types.
- Test that projection does not mutate `ProjectState`.
- Test stable node IDs and render order.

### M2 — three.js toon 2.5D shell

- Add plain `three`.
- Render board, grid, character slabs, one path ribbon, one mechanism.
- Orthographic locked camera by default.
- No orbit in path drawing.

### M3 — camera unlock

- Add `Unlock camera` / `Lock to 2.5D`.
- Animate 2.5D -> toy-stage 3/4 view.
- Enable OrbitControls only while unlocked.
- Preserve selection, frame, viewport, canonical geometry.

### M4 — labels and Viser-like handles

- Add scene labels as render nodes.
- Add source-ID linked selection handles.
- Add simple transform/visibility handle API inside app code.

### M5 — exploded assembly

- Scripted depth offsets from the same projection.
- Pins/spacers/rods separate along depth.
- Labels show assembly order.

### M6 — physics sidecar

- Add deterministic kinematic replay first.
- Add Rapier only after replay contracts pass.
- Render forces/collisions in toon overlay.

## 11. Verification requirements

### Contract tests first

- projection derives 2.5D data without mutating `ProjectState`;
- legacy project loads with default 2.5D locked camera;
- projection is deterministic and contains no non-finite values;
- every render node maps to canonical source ID or is marked preview-only;
- blueprint export ignores camera unlock/toon/orbit/explode state.

### Browser tests

- switching 2.5D -> Toy Stage -> 2.5D preserves drawn path and selected part;
- orbit controls are disabled during path drawing;
- camera unlock lazy-loads/initializes renderer without console errors;
- blueprint export after camera unlock uses the same board coordinates;
- reduced-motion setting skips peel/tilt animation but preserves state.

### Visual checks

Stable screenshots only:

- 2.5D locked workbench;
- Toy Stage hero 3/4 preset;
- Side Stack depth inspect;
- Exploded Assembly;
- Blueprint top-board view.

Prefer geometry assertions for mechanism alignment.

## 12. Source notes

- Viser README and docs describe 3D primitives, GUI controls, scene interaction, transform gizmos, programmatic camera control, and a web client: <https://github.com/viser-project/viser>, <https://viser.studio/>.
- Viser frame conventions describe hierarchical scene tree names and parent-child transform behavior: <https://viser.studio/main/notes/conventions/>.
- Viser performance tips emphasize batching many objects and updating transforms/visibility instead of recreating heavy scene nodes: <https://viser.studio/main/notes/performance_tips/>.
- three.js `MeshToonMaterial` provides toon shading: <https://threejs.org/docs/pages/MeshToonMaterial.html>.
- three.js `OrthographicCamera` supports constant-size projection useful for 2D scenes/UI: <https://threejs.org/docs/pages/OrthographicCamera.html>.
- three.js `OrbitControls` provides orbit/zoom/pan around a target and should be exposed only after camera unlock: <https://threejs.org/docs/pages/OrbitControls.html>.
- three.js `OutlinePass` and `EffectComposer` are optional addons for selected-object outlines/postprocessing: <https://threejs.org/docs/pages/OutlinePass.html>, <https://threejs.org/docs/pages/EffectComposer.html>.

## 13. Open implementation questions

1. Can the existing SVG path editor remain as an overlay over the WebGL workbench for the first slice, or should path strokes be rendered directly in three immediately?
2. Should the first three.js renderer replace the center canvas only in post-onboarding stages, or also the onboarding character preview?
3. How much of Viser-style handle API should be internal-only vs exposed as user-facing dev tools?

Default answer for first implementation: keep SVG path input overlay if it minimizes risk, render the toon scene under it, and only replace interaction once tests prove coordinate parity.

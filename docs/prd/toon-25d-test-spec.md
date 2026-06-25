# Toon 2.5D / 3D Unlock Test Spec

Status: active test spec candidate
Created: 2026-06-25
Companion plan: [`toon-25d-implementation-plan.md`](toon-25d-implementation-plan.md)

## 1. Test philosophy

Prove the boundary before proving pixels:

1. Contract tests protect canonical `ProjectState`, fabrication, IK, mechanisms, and projection determinism.
2. Browser tests protect real novice workflows and in-browser editor behavior.
3. Visual screenshots are review evidence, not the only correctness signal.
4. Physics tests use fixed timesteps and geometry/state snapshots rather than flaky animation timing.

## 2. M1 projection contract tests

Run with `npm run test:contracts`.

Required assertions:

- `buildToonSceneProjection(project)` is pure: input JSON is unchanged.
- Repeated projection calls with the same project are `deepStrictEqual`.
- Projection top-level shape includes `version: 1`, `units`, `coordinateSystem`, `nodes`, `labels`, `cameras`, `interactions`, and `warnings`.
- `ToonLabelNode`, `CameraPreset`, and `ProjectionWarning` fields match the implementation plan minimum schema.
- Projection contains stable nodes for:
  - board/grid;
  - each visible body part;
  - each skeleton joint;
  - each skeleton bone;
  - each visible motion path;
  - each mechanism base/output;
  - labels and warning chips.
- Render IDs use stable Viser-style paths and contain no whitespace-only ids.
- Node `sourceId` rules match the implementation plan:
  - required and canonical for `part`, `joint`, `bone`, `path`, and `mechanism`;
  - for `bone`, formatted as `${parentJointId}->${childJointId}` and validated against `ProjectState.skeleton.bones`;
  - optional for `board`, `hardware`, `helper`, `label`, and `warning`;
  - exempt when `exportRole` is `preview-only`, `label`, or `debug`.
- Projection uses the exact coordinate contract from the plan:
  - scene pixels are the 2D source units;
  - `SCENE_PX_PER_MM` is the 2.5D/3D unit bridge;
  - project `x/y` map to world `X/Y`, derived depth maps to world `Z`;
  - all geometry is canonical scene-space in M1, not dependent on parent transforms.
- `renderOrder` is deterministic: depth, category, then stable id tie-breakers.
- All point/transform/depth/thickness values are finite.
- Projection includes locked authoring and toy-stage camera presets.
- Projection includes interaction bindings for:
  - `draw-path-on-plane`;
  - `select-source`;
  - `pan-zoom-locked-camera`;
  - `unlock-camera`;
  - `bake-3d-transform`, with `enabled: false` by default.
- Projection does not create or invalidate fabrication export state.
- Full serialized project snapshot, `metadata.updatedAt`, and `lastExport` are unchanged after projection builds.
- Disabled write-back interactions have `writesProject: false`, `enabled: false`, and cannot change serialized project data.

## 3. M2 shell/browser tests

Run with `npm run test:browser` after M2.

Required browser scenarios:

- Path -> Design -> Path preserves pan/zoom and selected part/path.
- Right inspector scroll does not scroll the center canvas.
- Lens switcher changes view state without changing path point data.
- Drawing mode disables camera orbit/unlock affordance until drawing ends.
- Reset view returns the same authoring frame.
- User-facing lens labels match the canonical glossary: `2.5D Locked`, `Depth Inspect`, `Toy Stage`, `Exploded Assembly`, `Inspect`, `Physics`, `Blueprint`.
- `AppStage` and `ViewLensState` are independent: switching to the `blueprint` lens does not navigate to the Blueprint workflow stage unless a separate stage action is invoked.
- Lens/camera actions leave serialized `ProjectState`, `metadata.updatedAt`, and `lastExport` unchanged.

## 4. M3 WebGL/toon renderer tests

Required checks:

- Renderer lazy-loads without breaking initial app load.
- WebGL unsupported/failure path falls back to existing SVG canvas with a clear status chip.
- Projection node count matches rendered pickable object count for parts/joints/mechanisms.
- Enabling 2.5D view does not change serialized project state.
- Renderer toggles leave serialized `ProjectState`, `metadata.updatedAt`, and `lastExport` unchanged.
- Free path drawing still routes through the existing SVG/HTML overlay, not direct three.js coordinate writes.
- Path points drawn with the toon layer enabled match path points drawn with SVG fallback only.
- Screenshot review at 1440x900 confirms compact editor shell and dominant canvas.

## 5. M4 camera unlock tests

Required checks:

- Camera unlock preserves selected object, playhead progress, and path points.
- Camera lock returns to exact front 2.5D state.
- Orbit is unavailable while path draw mode is active.
- Blueprint export before and after unlock is identical for canonical geometry.
- Camera unlock/lock leaves serialized `ProjectState`, `metadata.updatedAt`, and `lastExport` unchanged.
- `bake-3d-transform` is disabled by default; if later enabled, a browser test must prove it creates an undoable project action rather than mutating renderer state directly.

## 6. M5 physics tests

Required checks:

- Fixed-step replay returns the same samples for the same projection and seed.
- Physics implementation must first expose the minimal API documented in the plan: `version`, `engine`, `seed`, `fixedDtSeconds`, units, frame, body samples, and warnings.
- Physics warnings are deterministic and source-mapped to mechanisms/parts/joints.
- Physics overlays can be hidden without changing replay data.
- Simulation completion does not mutate project state unless an explicit bake command is tested.
- Physics replay leaves serialized `ProjectState`, `metadata.updatedAt`, and `lastExport` unchanged.
- Browser test covers play -> scrub -> physics lens -> blueprint export.

## 7. M6 compact UI tests

Required checks:

- First screen at 1440x900 shows project name, current workflow step, central canvas, right inspector, and bottom player without vertical page scroll.
- Mobile-ish width keeps the canvas usable and makes panels drawer-like rather than stacking into a long document.
- Template/starter -> free path -> mechanism apply -> attach -> blueprint remains one continuous workflow.
- Only the right inspector scrolls for long parameter sets.

## 8. Mandatory verification commands per milestone

For docs/contract-only milestones:

```bash
npm run test:contracts
npm run build
git diff --check
```

For UI or renderer milestones:

```bash
npm run test:contracts
npm run build
npm run test:browser
git diff --check
```

For physics milestones, add deterministic replay tests before browser tests.

# Realistic 2.5D / 3D / Physics Platform Plan

Status: historical provenance (superseded)
Created: 2026-06-25
Scope: MotionSmith web editor after current 2D workflow stabilize
Baseline commit: `f295cdb Pin mechanism outputs to driven joints`

> Direction update (2026-06-25): superseded by [`toon-25d-main-3d-unlock-plan.md`](../../prd/toon-25d-main-3d-unlock-plan.md). Preferred direction: **toon/WebGL 2.5D main workbench** + **3D camera unlock**, not SVG/CSS 2.5D first.

## 0. Decision in one paragraph

Build full realistic platform as **2D-canonical authoring + derived 2.5D/3D/physics views**. Existing editor works around `ProjectState`, SVG path drawing, mechanism kinematics, IK preview, blueprint export. Don't replace with three.js editor. Add renderer/simulation boundary: 2D scene stays sole source of truth for editing + fabrication; 2.5D, 3D, physics faithful lenses + sidecars reading same state, emit warnings/samples, write back only through explicit user actions.

Shortest safe route to Viser-like robotics visualization impression without breaking novice drawing, mechanism attachment, or blueprint generation.

## 1. Goals

### Product goals

1. Preserve novice workflow:
   - choose/load character;
   - select body part;
   - draw free path on shared canvas;
   - choose/fit mechanism;
   - preview IK + mechanism-driven motion;
   - export blueprint + assembly guide.
2. Add realistic visual understanding:
   - layered cardstock/plastic part depth;
   - pins, spacers, rods, cams, gears, board thickness;
   - occlusion + shadows;
   - exploded assembly view;
   - camera presets + optional orbit inspection.
3. Add real physics support:
   - fixed-step simulation;
   - rigid bodies, joints, limits, motors, collisions, gravity, mass/inertia;
   - force/velocity/constraint overlays;
   - deterministic replay samples for testing + export evidence.
4. Keep UI Canva-simple + robotics-lab credible:
   - action-first labels;
   - one central canvas;
   - right inspector scrolls own pane only;
   - view modes lenses over same project, not separate apps.

### Non-goals

- No immediate full rewrite to three.js.
- No 3D source of truth for fabrication geometry.
- No raw physics console as default UI.
- No `@react-three/fiber` until plain three.js too cumbersome.
- No Matter.js as main long-term engine for true 3D physics.

## 2. Current baseline we must protect

Current app 2D-first, already has valuable invariants:

- `ProjectState` stores parts, skeleton, paths, mechanisms, settings, selected IDs, export state.
- Path drawing uses scene-space points + SVG interaction.
- Mechanism preview uses kinematic solvers, now pins driven joints to mechanism effectors during playback.
- Blueprint/export uses canonical scene coordinates + physical kit settings.
- Browser tests cover character → path → mechanism → blueprint workflow, viewport persistence, mechanism target pinning.

Any 2.5D/3D/physics work must pass these existing checks before trusted:

```bash
bun run test:contracts
bun run build
bun run test:browser
```

## 3. External references and why they matter

| Reference | Relevant point for this product |
| --- | --- |
| Viser README: <https://github.com/viser-project/viser> | Viser presents robotics/CV visualization style: 3D primitives, GUI widgets, scene interaction, transform gizmos, camera control, web client. MotionSmith borrow visual/interaction impression, not Python/server architecture. |
| three.js OrbitControls docs: <https://threejs.org/docs/pages/OrbitControls.html> | Orbit controls fit optional inspection — orbit around target + support zoom/pan. Not active while drawing paths. |
| three.js OrthographicCamera docs: <https://threejs.org/docs/pages/OrthographicCamera.html> | Orthographic projection keeps object size constant with distance — fits authoring, blueprint inspection, fixed front/isometric views better than perspective distortion. |
| Rapier JavaScript getting started: <https://rapier.rs/docs/user_guides/javascript/getting_started_js/> | Rapier provides browser JS rigid bodies, colliders, gravity, world stepping. Best candidate for real 3D physics. |
| Rapier joints docs: <https://rapier.rs/docs/user_guides/javascript/joints/> | Rapier supports fixed, prismatic, revolute, spherical, other joints needed for mechanism constraints, motors, character-link constraints. |
| Matter.js constraints docs: <https://brm.io/matter-js/docs/classes/Constraint.html> | Matter useful evidence for 2D pin/revolute constraints, but 2D — not final engine for true 3D preview. |
| React Three Fiber docs: <https://r3f.docs.pmnd.rs/getting-started/introduction> | R3F adoptable later if three.js scene complex + React-component-heavy; not first dependency. |

## 4. Team review synthesis

### Architect review

- Keep `ProjectState` 2D canonical.
- Add derived `SceneProjection` + `PhysicsSession` layers instead of expanding every domain type into 3D graph.
- Export stays 2D/fabrication-first; 3D artifacts separate optional export family.

### Dependency review

Recommended staged stack:

1. **No dependency** for 2.5D: SVG/CSS shadows, depth sorting, extrusion hints, existing kinematics.
2. **Plain `three`** for real 3D preview.
3. **Rapier JS** for real 3D physics.
4. **R3F + react-three-rapier only later** if scene too large for small imperative adapter.

Avoid starting with cannon-es, Ammo/Bullet, Pixi, or Konva for this requirement.

### UX/design review

- Use view lenses: `Studio`, `Depth`, `Physics`, `Blueprint`, `Inspect`.
- Keep `Studio` default.
- Physics explained through overlays: safe arcs, velocity arrows, force hints, constraint labels, short "why" cards.
- 3D orbit inspection mode with `Front`, `Iso`, `Orbit`, `Explode`, `Reset`, not authoring default.

### Test review

- Add schema/geometry contracts before adding dependencies.
- Add deterministic physics replay tests with fixed timestep.
- Add Playwright workflow tests for view mode persistence, physics playback, export after simulation.
- Prefer geometry snapshots over fragile visual diffs; screenshots only for layout/visual impression gates.

## 5. Architecture

### 5.1 Layer diagram

```text
ProjectState (2D canonical)
  ├─ parts / skeleton / paths / mechanisms / settings / export
  │
  ├─ SceneProjection (pure derived data)
  │    ├─ 2D render model
  │    ├─ 2.5D render model
  │    ├─ 3D render descriptors
  │    └─ physics descriptors
  │
  ├─ Renderers
  │    ├─ SVG editor renderer          (authoring, existing path/mechanism workflows)
  │    ├─ SVG/CSS 2.5D renderer        (realistic depth lens, no new dependency)
  │    └─ three.js 3D renderer         (optional lazy-loaded inspection)
  │
  ├─ PhysicsSession
  │    ├─ fixed timestep clock
  │    ├─ Rapier world / bodies / joints / colliders
  │    ├─ sampled replay buffer
  │    └─ warnings / forces / velocities / collisions
  │
  └─ Exporters
       ├─ existing blueprint/SVG/DXF/PDF/assembly guide from 2D canonical state
       └─ optional 3D artifacts from projection metadata only
```

### 5.2 Canonical state rule

Following remain authoritative in 2D:

- body part position, rotation, scale, anchor joint, z-order;
- skeleton joints + hierarchy;
- drawn paths + timed path samples;
- mechanism parameters, anchor points, targets, driven part/path/anchor;
- fabrication kit, board, sheet, export validation geometry;
- editor viewport for 2D authoring.

2.5D/3D/physics may store presentation settings, but cannot silently overwrite canonical 2D geometry.

### 5.3 SceneProjection module

Add pure adapter module, initially no dependencies:

```ts
type SceneProjection = {
  version: 1;
  sceneBoundsMm: Bounds2D;
  parts: ProjectedPart[];
  joints: ProjectedJoint[];
  paths: ProjectedPath[];
  mechanisms: ProjectedMechanism[];
  board: ProjectedBoard;
  warnings: ProjectionWarning[];
};

type ProjectedPart = {
  id: string;
  label: string;
  scene2d: Transform2D;
  depthMm: number;
  thicknessMm: number;
  material: 'paper' | 'acrylic' | 'wood' | 'metal' | 'ghost';
  polygon2d?: Point[];
  renderOrder: number;
};
```

`SceneProjection` recomputed from `ProjectState`; no setters. Prevents second source of truth.

### 5.4 PhysicsSession module

Physics runtime state, not project state:

```ts
type PhysicsSession = {
  engine: 'none' | 'kinematic' | 'rapier3d';
  fixedDt: 1 / 60;
  frame: number;
  bodies: PhysicsBodySample[];
  joints: PhysicsJointSample[];
  forces: ForceSample[];
  warnings: PhysicsWarning[];
};
```

Rules:

- Use fixed timestep, not variable frame delta.
- Keep replay buffer so scrubbing deterministic.
- Run heavy simulation in worker once Rapier added.
- Write back to `ProjectState` only through explicit commands: "Bake as path", "Use pose as rest position", "Apply fitted mechanism".

## 6. View modes and UI behavior

### Studio

Default mode for novices.

- Character, selected part, drawn path, active mechanism, simple labels.
- No force vectors unless warning-driven.
- Editing stays direct + 2D.

### Depth

2.5D visual mode.

- Tilted paper/board impression.
- Layer separation by `depthMm` + `thicknessMm`.
- Shadows under parts + rods.
- Occlusion hints + "front/back" labels.
- No free orbit; named camera presets only.

### Physics

Simulation explanation mode.

- Fixed pivots, revolute joints, constraints, motors.
- Velocity arrows + force hints.
- Safe/unsafe rotation arcs.
- Collision/clearance warnings.
- Start/pause/scrub stays tied to global player dock.

### Blueprint

Build inspection mode.

- Board coordinates, holes, spacers, layer stack, exploded assembly.
- Every 3D/depth visual has mapped 2D fabrication coordinate or marked non-fabrication preview.

### Inspect

Advanced robotics/viser-like mode.

- Axes, IDs, transforms, gizmos, joint frames, collision shapes, camera readouts.
- Hidden by default from novice flow.

## 7. Physics model scope

### What physics should simulate

1. **Mechanism joints**
   - revolute pivots;
   - prismatic sliders;
   - fixed joints;
   - limited-angle joints;
   - motorized input crank.
2. **Character parts as rigid bodies**
   - mass + inertia approximated from area/thickness/material;
   - optional colliders from simplified polygons or capsules;
   - kinematic drive from mechanism output for authored automaton motion.
3. **Board and hardware**
   - static board collider;
   - pins, spacers, washers, rods;
   - clearance checks.
4. **Diagnostics**
   - detached target;
   - overconstrained joints;
   - collision during cycle;
   - unsafe rotation range;
   - excessive force/velocity.

### What physics should not decide automatically

- Should not replace path drawing.
- Should not mutate exported board coordinates.
- Should not silently "fix" user mechanisms.
- Should not decide character segmentation.

### Kinematic vs dynamic modes

| Mode | Purpose | Engine |
| --- | --- | --- |
| Kinematic preview | deterministic automaton motion, exact path/mechanism playback | existing solvers + `SceneProjection` |
| Constraint check | joint validity, clearance, collision approximations | no-dep geometry first, then Rapier |
| Dynamic simulation | gravity, mass, collision, inertia, motor torque, contact response | Rapier 3D |
| Bake/export | user-approved sampled states or fitted paths | explicit write-back only |

## 8. Dependency plan

### Phase A: no new dependencies

Use existing SVG/React/CSS for:

- depth sorting;
- shadows;
- part thickness illusion;
- material colors;
- hardware labels;
- simple force/velocity overlays;
- deterministic kinematic samples.

Gives immediate visual improvement without WebGL or WASM risk.

### Phase B: add plain `three`

Add only when `Depth` not enough + `Orbit`/`Explode` must be real 3D.

Implementation rules:

- Lazy-load 3D preview component.
- Use orthographic camera by default.
- Add OrbitControls only in Inspect/Orbit mode.
- 3D view consumes `SceneProjection`; does not own project state.
- Selection sync ID-based: clicking 3D object selects canonical part/mechanism ID.

### Phase C: add Rapier

Add when real physics needed beyond deterministic kinematics.

Implementation rules:

- Initialize Rapier lazily.
- Prefer worker-based stepping for non-trivial scenes.
- Use fixed timestep + explicit seed/config snapshots.
- Store sampled simulation results as preview buffers.
- Export records physics metadata only unless user explicitly bakes frame/trajectory.

### Phase D: defer R3F

Adopt `@react-three/fiber` only if 3D scene becomes large declarative component tree. Until then, plain three.js keeps dependency + abstraction cost lower.

## 9. Milestones

### M0 — Baseline checkpoint

Status: done. Current tracked code committed at `f295cdb`.

Acceptance:

- no tracked diff before plan work;
- existing untracked resource assets left untouched.

### M1 — 2D contract lock

Deliverables:

- add contract tests for project round-trip, z-order, mechanism binding, viewport persistence, export invariants;
- document canonical/derived boundary in code comments + README.md if needed.

Acceptance:

- `bun run test:contracts` passes;
- no schema change breaks old project snapshots.

### M2 — SceneProjection foundation

Deliverables:

- pure `utils/sceneProjection.ts`;
- type-safe projection from `ProjectState` to render/physics descriptors;
- no UI behavior change yet.

Acceptance:

- projection contract tests cover parts, joints, paths, mechanisms, board, warnings;
- no renderer reads ad-hoc depth state outside projection.

### M3 — Realistic 2.5D view

Deliverables:

- `Studio / Depth / Physics / Blueprint / Inspect` mode switcher;
- SVG/CSS 2.5D renderer for parts, mechanisms, board, pins, spacers;
- friendly labels + material presets;
- camera presets: `Fit character`, `Follow part`, `Follow mechanism`, `Board view`, `Exploded assembly`, `Reset`.

Acceptance:

- Path drawing still works in Studio;
- Depth view changes presentation only;
- browser test proves tab switching preserves selected mode, viewport, selection;
- screenshot smoke test for Depth mode has fixed seed/time.

### M4 — Physics semantics without WASM

Deliverables:

- deterministic kinematic replay buffer;
- velocity/force-direction overlays derived from sampled motion;
- constraint/clearance warnings using existing geometry;
- physics panel copy explaining cause + recovery.

Acceptance:

- scrubbing to same frame twice yields identical joint/effector coordinates;
- warnings visible in Physics mode + summarized in right inspector;
- no new dependency yet.

### M5 — three.js inspection preview

Deliverables:

- lazy-loaded three.js preview component;
- orthographic front/isometric views;
- optional OrbitControls in Inspect/Orbit mode;
- 3D board, part planes with thickness, rods, pins, mechanism traces;
- selection sync back to canonical IDs.

Acceptance:

- 3D preview opens without resetting 2D canvas viewport;
- `Back to Studio` restores exact 2D authoring view;
- browser test checks no console errors + selected 3D object maps to same project ID;
- bundle impact recorded.

### M6 — Rapier physics runtime

Deliverables:

- lazy Rapier initialization;
- physics descriptor generation from `SceneProjection`;
- rigid bodies, colliders, joints, motors, limits;
- fixed-step simulation session + replay buffer;
- worker path if main-thread stepping exceeds budget.

Acceptance:

- deterministic replay contract passes within tolerance;
- simple pendulum, crank, two-link limb, collision fixtures pass;
- playback frame rate stays acceptable on sample projects;
- invalid/overconstrained cases produce warnings, not NaN/Infinity.

### M7 — Physics-aware blueprint and assembly guide

Deliverables:

- blueprint validation includes clearance/collision findings;
- assembly guide includes layer stack, spacer heights, pin/joint labels, safe rotation range;
- optional 3D/exploded view in export preview;
- physics metadata in exported package.

Acceptance:

- export stays correct for legacy 2D projects;
- physics/depth metadata appears only when enabled;
- ambiguous 3D-to-board projection blocks export with fix-it message;
- Playwright full workflow passes: load character → draw path → fit mechanism → Physics view → Blueprint export.

### M8 — Optional 3D artifact export

Deliverables:

- optional glTF/scene JSON preview export;
- clearly separate from fabrication blueprint;
- generated from canonical 2D + presentation metadata.

Acceptance:

- disabling 3D export does not affect normal blueprint package;
- artifact uses stable IDs so parts/mechanisms match assembly guide labels.

## 10. Verification plan

### Contract tests

Add or split into:

- `tests/contracts/project-3d-contract.test.ts`
- `tests/contracts/scene-projection-contract.test.ts`
- `tests/contracts/physics-contract.test.ts`
- `tests/contracts/export-3d-contract.test.ts`

Required checks:

- legacy project JSON still loads;
- missing depth/physics fields default safely;
- scene projection deterministic;
- 2D board coordinate round-trips still pass;
- physics fixed-step replay stable;
- non-finite physics or projection values rejected;
- export ignores preview-only camera transforms unless explicitly exporting 3D artifact.

### Browser tests

Add:

- `tests/browser/physics-3d-workflow.spec.ts`
- `tests/browser/visual-regression.spec.ts` only for stable fixed-time views;
- optional `tests/browser/performance.spec.ts` for smoke budgets.

Required scenarios:

- view mode switcher preserves canvas state;
- Depth mode shows stacked layers + returns to Studio;
- Physics mode playback/scrub deterministic;
- 3D preview lazy-loads, orbits only in Inspect/Orbit mode, then returns to 2D;
- blueprint export after physics includes warnings/metadata.

### Performance budgets

Initial budgets, tighten later:

- 2.5D sample render under 3s in browser smoke;
- 300 fixed physics steps under 500ms for small fixture;
- no long task over 200ms during 5s playback;
- export under 1s for sample, under 3s for complex fixture.

## 11. UX copy contract

Use novice labels first:

- `Draw free path`
- `Preview depth`
- `Show physics`
- `Fit mechanism`
- `Safe rotation`
- `Fixed pivot`
- `Output point`
- `Exploded assembly`
- `Back to Studio`

Hide technical labels behind Inspect:

- body ID;
- collider ID;
- joint frame;
- transform matrix;
- timestep;
- solver iterations.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 3D becomes second editor | path drawing/export drift | make 3D read-only first + ID-synced to `ProjectState` |
| Physics non-deterministic | tests/export evidence unreliable | fixed timestep, replay buffer, tolerance-based contract tests |
| WASM/three bundle heavy | app startup slow | lazy-load 3D/physics only when needed |
| Users lost in orbit mode | novice flow breaks | default Studio/Depth fixed camera; orbit only in Inspect |
| Blueprint uses camera projection by mistake | fabrication wrong | exporters read canonical 2D state only; projection ambiguity blocks export |
| Collision geometry too detailed | slow/unstable simulation | start with capsules/boxes/simplified polygons, refine only where visible |
| Material realism overbuilt | lots of code, little product value | start with five material presets + CSS/SVG shadows |

## 13. First implementation slice after this plan

First code slice deliberately small:

1. Add `SceneProjection` types + pure builder.
2. Add contract tests for projection determinism + legacy 2D invariants.
3. Add view mode state + `Studio / Depth / Physics / Blueprint / Inspect` switcher.
4. Render Depth mode using existing SVG/CSS only.
5. Add Playwright test proving mode switch does not move canvas or break path/mechanism workflow.

Do not add three.js or Rapier until this slice stable.

## 14. Completion definition for the full platform

Full 2.5D/3D/physics platform complete only when:

- all existing 2D authoring workflows still pass;
- Depth mode gives realistic layered assembly impression;
- 3D preview can orbit/explode same scene without owning project state;
- Rapier-backed physics can simulate joints/collisions with deterministic replay;
- mechanism outputs, IK targets, physics samples, blueprint coordinates stay aligned;
- assembly guide explains both visual stack + physical construction;
- tests cover contract, browser workflow, determinism, export invariants, + at least one stable visual smoke check.

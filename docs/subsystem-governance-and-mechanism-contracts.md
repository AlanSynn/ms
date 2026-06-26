# MotionSmith Subsystem Governance and Mechanism Contract Plan

Status: proposed architecture contract
Date: 2026-06-26
Scope: interface/interaction governance, mechanism convention ownership, 2D/3D/physics/fabrication parity, and future subsystem boundaries.

## 0. Executive decision

MotionSmith should **not** become a broad npm-workspace/plugin architecture yet. The current app is still a single Vite/React/Three product and already has the correct spine:

```text
ProjectState -> derived contracts -> renderer / simulator / exporter
```

The problem is narrower: mechanism conventions are centralized as data but still **interpreted in too many places**. Foundry 2D, Foundry 3D, Mechanism Design, PhysicsSession, fabrication, blueprint export, and UI controls can drift because each surface may branch on mechanism type independently.

The immediate design is therefore a **mechanism feature contract + adapter boundary**, not a runtime plugin system:

```text
ProjectState
  -> MechanismFeatureRegistry / MechanismSnapshot
  -> ToonSceneProjection
  -> PhysicsSession
  -> 2D renderer / 3D renderer / Foundry / Design / Blueprint / Export
```

Use the word **package** only for artifact payloads or actual distribution units:

1. **Artifact packages**: character import packages, foundry export packages, fabrication packages.
2. **Installable packages**: future npm/workspace packages, only if a later ADR proves they are needed.

For the current repo structure, use **module slice**, **subsystem**, **registry**, or **snapshot** instead of package. Do not create installable npm packages until there are at least two real consumers or a measured build/runtime bottleneck.

## 1. Agent-team synthesis

### Designer lane

MotionSmith must behave like a novice-friendly CAD/Canva workbench:

- direct manipulation first;
- one shared canvas-feeling viewport;
- left pane = workflow/object list;
- center = work surface only;
- right pane = selected-item inspector;
- bottom/HUD = compact playback/status;
- physics must be visible and derived, never decorative.

### Architect lane

The repo already establishes canonical `ProjectState`, `ToonSceneProjection`, `PhysicsSession`, and fabrication/export contracts. The next seam should be a single mechanism feature contract that lets every mechanism type declare its labels, defaults, kinematics, interaction affordances, physics sampling, fabrication stack, and render/export hints once.

### Critic lane

Reject broad future-proof packaging. Risks:

- duplicate registries;
- package terminology collision;
- abstract interfaces before multiple implementations;
- physics becoming source of truth;
- React/render-loop performance regressions;
- governance docs that are not executable.

The safer path is boring: strengthen canonical state, pure derived adapters, deterministic caches, and tests that fail on drift.

## 2. Hard source-of-truth rules

1. **`ProjectState` is the only persisted authoring truth.**
   - Body parts, skeleton, paths, mechanisms, physical-kit settings, export snapshots, and metadata live here.
   - UI pane layout, camera, hover, drag, orbit, playback time, and transient selection are UI/session state.

2. **Renderers never own project geometry.**
   - 2D and 3D renderers own DOM/GPU objects, caches, camera controls, and hit-test handles only.
   - They must not store canonical part positions, mechanism transforms, or fabrication stack rules.

3. **Physics is a deterministic sidecar.**
   - `PhysicsSession` derives sampled bodies, constraints, forces, velocities, friction, and constraint errors from project/projection input.
   - Physics cannot silently write `ProjectState`.
   - Only explicit, undoable commands may write derived results back: `Apply fitted mechanism`, `Bake path`, `Accept simulation result`.

4. **Fabrication packages are export artifacts.**
   - A fabrication package is derived from `ProjectState` plus physical-kit settings and mechanism feature contracts.
   - It is not canonical runtime state.

5. **Camera/orbit/explode state is never fabrication truth.**
   - 2.5D/3D/exploded view changes must not alter board coordinates, SVG/PDF/STL output, or mechanism fit.

6. **One mechanism type registry.**
   - A new mechanism must enter through one typed registry path and contract tests.
   - No stage component may introduce an independent mechanism-type switch for domain semantics.

## 3. Module/subsystem boundary model

This section describes source-module boundaries inside the current single app package, not npm packages or runtime plugins.

### 3.1 Current-phase source slices

Keep one application package, but enforce source-module ownership like this:

```text
types.ts
  shared serializable contracts: ProjectState, MechanismConfig, packages, actions

utils/project.ts
  reducer, migrations, defaults, reconciliation, source-state invariants

utils/mechanismTemplates.ts
  mechanism type list and human metadata seed

utils/mechanismFeatureRegistry.ts       (new)
  one registry for mechanism feature contracts

utils/mechanismSnapshot.ts              (new, phase 1 single file)
  immutable per-mechanism derived snapshots and fingerprints

utils/kinematics.ts
  pure mechanism sampling/math

utils/motion.ts
  IK, chain classification, motion binding semantics

utils/coordinates.ts
  scene/sheet/board/svg transforms

utils/sceneProjection.ts
  pure ProjectState -> renderable scene contract

utils/physicsSession.ts
  pure ProjectState + ToonSceneProjection + phase -> sampled physics contract

utils/fabrication.ts
  fabrication primitives, stack, render plan, validation, package generation

utils/exporter.ts
  SVG/DXF/PDF/STL/metadata exporters from canonical state and fabrication packages

components/*
  presentation, GPU/cache/camera/session state, direct manipulation controls

App.tsx
  composition root only: global shell, stage router, persistence, command wiring
```

### 3.2 Later real-package split criteria

Only split into real packages/workspaces after all are true:

- at least two independent consumers exist, such as app + CLI exporter or app + test harness;
- source slices have stable public contracts;
- import boundaries are already clean in the single-package repo;
- package split improves measurable build/test/runtime cost;
- an ADR and contract tests exist.

If that happens, use official platform mechanisms rather than custom loaders:

- TypeScript Project References for incremental build boundaries: <https://www.typescriptlang.org/docs/handbook/project-references.html>
- Node package `exports` for explicit public entry points: <https://nodejs.org/api/packages.html>
- Vite library mode only for separately distributed browser libraries: <https://vite.dev/guide/build.html#library-mode>

Do **not** add runtime dynamic imports, plugin discovery, or package loading inside animation/simulation loops.

## 4. Mechanism feature contract

### 4.1 Goal

A mechanism type must define the behavior that all surfaces share:

- human label and novice sensemaking;
- authoring defaults;
- parameter ranges;
- kinematic sampler;
- valid angle/range sampler;
- interaction handles;
- 2D render role hints;
- 3D build/render role hints;
- physics bodies/constraints/vector overlays;
- fabrication stack and kit requirements;
- export metadata;
- strict unsupported/blocker reasons.

### 4.2 Contract shape

Phase 1 can be a single source file. Split only when it becomes unwieldy.

```ts
type MechanismFeatureContract = {
  type: MechanismType;
  label: string;
  sense: string;
  goodFor: string[];
  authorable: boolean;

  defaults: () => MechanismConfig;
  parameterSchema: MechanismParameterSpec[];

  sampleKinematics: (input: MechanismSampleInput) => MechanismSample;
  sampleFeasibleRange: (config: MechanismConfig) => FeasibleRange;

  interactionPolicy: (config: MechanismConfig) => MechanismInteractionPolicy;
  projectionHints: (config: MechanismConfig) => MechanismProjectionHint[];
  physicsHints: (config: MechanismConfig) => MechanismPhysicsHint[];

  fabricationStack: (config: MechanismConfig, kit: PhysicalKit) => FabricationStackLayer[];
  fabricationPlan: (config: MechanismConfig, kit: PhysicalKit) => FabricationRenderPlan;
  validate: (config: MechanismConfig, project: ProjectState) => MechanismIssue[];
};
```

Rules:

- This registry may call existing helpers (`calculateLinkage`, `fabricationStackForMechanism`, `fabricationRenderPlanForMechanism`) instead of duplicating math.
- This registry must not import React, DOM, Three, or UI components.
- The registry returns plain serializable data or stable math outputs.
- A mechanism type is incomplete until it passes contract coverage for 2D, 3D, physics, fabrication, and export.

### 4.3 Mechanism snapshot

The snapshot is a **derived DTO**, not source state. Use it to prevent every consumer from reinterpreting raw `MechanismConfig` differently.

```ts
type MechanismSnapshotV1 = {
  version: 1;
  mechanismId: string;
  type: MechanismType;
  fingerprint: string;

  source: {
    projectId?: string;
    targetPartId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
  };

  parameters: MechanismConfig;
  issues: MechanismIssue[];

  feasibleRange: FeasibleRange;
  interactionPolicy: MechanismInteractionPolicy;
  projectionHints: MechanismProjectionHint[];
  physicsHints: MechanismPhysicsHint[];
  fabricationPlan: FabricationRenderPlan;
};
```

Important constraints:

- The snapshot is immutable.
- `createdAt` and other export metadata do not belong in the hot-path snapshot.
- Fingerprints are stable across equivalent inputs.
- Snapshot generation is pure and cacheable.
- Snapshot consumers cannot mutate the snapshot.

### 4.4 Facade APIs

```ts
buildMechanismSnapshot(project: ProjectState, mechanismId: string): MechanismSnapshotV1
buildMechanismSnapshots(project: ProjectState): MechanismSnapshotV1[]
mechanismFeature(type: MechanismType): MechanismFeatureContract
validateMechanismRegistry(): MechanismRegistryIssue[]

toFoundryPreview(snapshot: MechanismSnapshotV1): FoundryPreviewModel
toSceneMechanismNodes(snapshot: MechanismSnapshotV1): ToonSceneNode[]
toPhysicsMechanismBodies(snapshot: MechanismSnapshotV1, phase: number): PhysicsBody[]
toFabricationRecipe(snapshot: MechanismSnapshotV1, kit: PhysicalKit): FabricationRecipe
```

Facade rules:

- Consumers import facades, not mechanism-specific helpers.
- Stage components do not call `switch (mechanism.type)` for domain semantics.
- Rendering adapters may branch internally for drawing primitives, but the branch input must come from registry/facade render plans.

## 5. Interface and interaction governance

### 5.1 Workbench regions

Each workflow stage must answer exactly one novice question per region:

| Region | Question | Owns | Must not own |
|---|---|---|---|
| Left pane | What can I do next? | workflow actions, object lists, mechanism family choices, blockers, recovery | selected numeric details, canvas forms, long lessons |
| Center canvas | What am I building/touching? | grid, character, paths, mechanisms, physics vectors, blueprint overlays, direct handles | galleries, long text, scrollable lists, unrelated cards |
| Right inspector | What exactly is selected? | numeric parameters, selected-item toggles, physics options, material/detail settings, warnings | primary navigation, starter galleries, broad recommendations |
| HUD/player | What is the current view/simulation state? | play/scrub, view preset, zoom/orbit, compact overlay toggles | large panels, scrollable content |
| Bottom status | What happened / what blocks me? | short status, exact blocker, next recovery action | tutorials, duplicate controls |

### 5.2 Stage ownership

#### Getting Started

- Compact modal, not a full-screen stage.
- Owns starter choices and import entry points.
- Closing it lands on Character.
- Must not replace the editor shell.

#### Character

- Owns body-part segmentation review, part artwork placement, skeleton joints, bend directions, anchors, ONNX/package status.
- Must show the character as fabrication-style plates with artwork decals when available.
- Must not own hero marketing, starter gallery, or mechanism simulation.

#### Path Editor

- Owns part selection, free-path drawing, path edit handles, IK preview, bend/fold controls.
- Camera orbit is locked while drawing.
- Path drawing writes scene-space points only.

#### Mechanism Foundry

- Owns mechanism family exploration, standalone sandbox simulation, physical feasibility, path trace, forces/velocities/friction/constraint overlays.
- Center must show only the mechanism/path/physics, with real thickness/layers when 3D is unlocked.
- `Use mechanism` exports a concrete mechanism instance into Mechanism Design.

#### Mechanism Design

- Owns mechanism instances attached to character parts and paths.
- Moving mechanisms must drive actual target anchors/IK preview.
- Editing mechanism parameters must update project state and all derived surfaces.

#### Blueprint / Assembly

- Owns fabrication validation, custom part output, kit-board output, exploded/assembly guide, printing/export.
- Assembly guide is derived from the same fabrication stack as Foundry/Design.
- Exploded view shows z-stack separation for understanding, not canonical coordinates.

#### Options

- Owns workspace and kit settings.
- Physical-kit settings are allowed because they affect fabrication and coordinates.
- Options must not create an alternate project or mechanism state.

### 5.3 Interaction modes

The app should expose a small finite set of modes:

```text
select
path-draw
path-edit
joint-edit
mechanism-place
mechanism-parametric-edit
camera-inspect
blueprint-inspect
assembly-step
```

Mode rules:

- Only one primary pointer mode is active.
- Mode determines hit-test policy.
- Mode changes are visible in the HUD/status.
- Camera inspect cannot author path points.
- Path draw cannot orbit camera.
- Blueprint inspect cannot mutate mechanism geometry.
- Assembly step cannot silently alter fabrication stack.

### 5.4 Overlay rules

Physics and simulation overlays must be compact and derived:

- velocity vector `v` from sampled position delta;
- force/acceleration vector from sampled velocity delta + configured mass;
- friction/contact indicator from `PhysicsSession` coefficients/contact proxies;
- constraint error from kinematic closure/sampling error;
- valid angle range from feasible range sampling;
- path trace from sampled end-effector points.

Never draw a vector, trail, or force label if its data source is not present in `PhysicsSession` or the mechanism snapshot. Missing data becomes a warning/blocker, not a decorative fallback.

## 6. Design patterns to use

### Adapter / anti-corruption layer

All surfaces consume stable derived contracts. Raw mechanism math and fabrication primitives stay inside domain utilities. `ToonSceneProjection` is the current concrete scene contract name in this repo; use that name unless a future ADR deliberately generalizes it.

```text
MechanismConfig -> MechanismSnapshot -> FoundryPreviewModel
                                      -> ToonSceneProjection nodes
                                      -> PhysicsSession bodies
                                      -> FabricationRecipe
```

### Pure builder / factory

Builders return plain objects and do not mutate inputs.

Examples:

- `buildMechanismSnapshot`
- `buildToonSceneProjection`
- `buildKinematicPhysicsSession`
- `createFabricationPackage`

### Strategy registry

Use one typed registry keyed by `MechanismType`. This is a strategy table, not a plugin loader.

### Facade

UI stages call coarse facade functions. They do not import every low-level helper.

### Lens / projection

2D authoring, 2.5D locked view, 3D orbit, exploded assembly, and blueprint are lenses over the same project. Lenses may have private camera/session state but cannot redefine truth.

### Fingerprint memoization

Cache derived snapshots by stable fingerprint:

```text
mechanism id + type + numeric parameters + target ids + physical kit version + relevant path hash
```

Avoid React object identity as a cache key. Avoid rebuilding large geometry on every animation frame.

### Explicit command writeback

Any derived result that writes source state must be a named action with undo/history potential:

- `apply_fit_result`
- `bake_path_from_simulation`
- `accept_character_package`
- `update_mechanism_parameters`

No hidden writeback from renderer, physics, or camera.

## 7. Performance governance

### 7.1 Hot-path rules

Do not do these in `requestAnimationFrame`, pointer move, or React render:

- full project serialization/cloning;
- schema validation of entire project;
- dynamic imports or plugin discovery;
- full projection rebuild unless the fingerprint changed;
- fabrication package generation;
- React state updates for every sampled body/vector;
- Three geometry/material recreation for static parts;
- deep scene traversal for every frame.

### 7.2 Cache ownership

| Cache | Owner | Key | Invalidated by |
|---|---|---|---|
| mechanism snapshot cache | mechanism package module | stable mechanism fingerprint | mechanism params, target ids, path hash, kit version |
| projection cache | scene projection module or hook | project projection fingerprint | canonical source changes |
| physics sample cache | physics module or hook | projection fingerprint + phase bucket + physics settings | source/projection/phase/settings |
| Three geometry/material cache | renderer | geometry/render plan signature | render plan or material change |
| export artifact cache | exporter | project export fingerprint | source/fabrication/kit changes |

### 7.3 Worker threshold

Keep computations on the main thread while they are bounded and measurable. Move to a worker only when profiling shows a problem or browser tests expose long tasks. Worker inputs/outputs must remain plain serializable contracts; workers cannot own source state.

### 7.4 Browser performance acceptance

Performance tests should preserve coverage and verify:

- no duplicate RAF loops for one stage;
- static grid/board layers persist across playback;
- Foundry dynamic rebuild count stays bounded;
- geometry/material cache growth stays bounded;
- no frame-by-frame React state churn for physics vectors;
- 2.5D/3D camera changes do not trigger fabrication recomputation.

## 8. Future extension governance

### New mechanism type

A new mechanism is not complete until all gates pass:

1. `MechanismType` union entry.
2. `MechanismFeatureRegistry` entry.
3. Default config.
4. Kinematic sampler or explicit unsupported reason.
5. Feasible range sampler.
6. Interaction policy.
7. Scene projection support.
8. PhysicsSession support.
9. Fabrication stack + render plan.
10. Blueprint/export metadata.
11. Browser/contract tests.

### New physical kit

Must extend physical-kit settings and coordinate transforms. It may not special-case inside renderers.

### New renderer or 3D engine

Allowed only as another adapter over `ToonSceneProjection` and `PhysicsSession`. It cannot replace project truth.

### New physics engine

Allowed only behind `PhysicsSession` or a versioned replacement contract. It cannot write `ProjectState` except through explicit commands.

### New AI/ONNX pipeline

Must output editable project actions or a validated project snapshot. It cannot create private renderer-only body parts, joints, masks, paths, or anchors.

### New export format

Must derive from `ProjectState` plus fabrication package/snapshot data. It cannot read camera/orbit/explode state except for optional preview screenshots.

### New tutorial/help layer

Must remain overlay/modal/status guidance. It cannot occupy the center work canvas or replace direct manipulation.

## 9. Validation gates

### Contract tests

Add or keep assertions for:

- all mechanisms are covered by registry, kinematics, projection, physics, fabrication, export;
- projection does not mutate `ProjectState`;
- physics session does not mutate `ProjectState`;
- projection and physics are deterministic for fixed input;
- non-finite values are rejected;
- every projected node maps to a canonical source id or is marked preview-only;
- fabrication stack follows `clip -> moving layer -> spacer -> moving layer -> clip` where applicable;
- base board remains separate from moving stack;
- camera/orbit/explode state is ignored by blueprint coordinates;
- no duplicate mechanism registry files are introduced.

### Browser tests

Required flows:

- Character -> Path -> Foundry -> Design -> Blueprint;
- right-pane scroll does not move center canvas;
- viewport zoom/pan persists across stages;
- path drawing cannot orbit camera;
- 2.5D -> 3D orbit -> 2.5D preserves project geometry;
- Foundry force/velocity/friction/constraint overlays read from physics data;
- mechanism playback moves the target anchor/body part;
- blueprint export blocks unbuildable mechanisms with exact recovery actions;
- exported assembly guide uses the same fabrication stack as Foundry/Design.

### Static/documentation gates

- `AGENTS.md`, `DESIGN.md`, and this document must not disagree on source-of-truth and pane rules.
- Any new hard architectural rule must have an executable assertion.
- Any new dependency/package split must have an ADR and measured reason.

## 10. Migration plan

### Phase 0 — freeze this contract

- Keep this document as the architecture target.
- Add a contract-test assertion that this document exists and includes the source-of-truth and no-duplicate-registry rules.

### Phase 1 — introduce the mechanism registry seam

- Create `utils/mechanismFeatureRegistry.ts`.
- Move mechanism labels/defaults/authorability from scattered references into registry adapters that wrap current helpers.
- No behavior change.
- Add tests that every mechanism type has registry coverage.

### Phase 2 — create derived mechanism snapshots

- Create `utils/mechanismSnapshot.ts` as a single file first.
- Build immutable snapshots from `ProjectState` + mechanism id.
- Add stable fingerprint tests.
- Make Foundry/Design/Blueprint consume snapshots where convenient.

### Phase 3 — remove stage-level mechanism semantics

- Replace stage/component mechanism-type branches with registry/facade calls.
- Leave drawing primitive branches inside renderer adapters only when required by shape geometry.
- Add static tests to catch obvious duplicate type-switch drift.

### Phase 4 — normalize physics and fabrication adapters

- Make force/velocity/friction overlays consume `PhysicsSession` only.
- Make Foundry/Design/Blueprint share `fabricationPlan` from the snapshot/registry.
- Keep exploded view as an assembly lens over fabrication stack data.

### Phase 5 — slim `App.tsx`

- Move stage-specific left/center/right composition into stage modules.
- Keep `App.tsx` as composition root, persistence, shell, and stage router.
- Do not rewrite the whole app shell before the mechanism contract is stable.

### Phase 6 — consider real installable package split only if measured

Possible later npm packages, if an ADR and measurements justify them:

```text
@motionsmith/core-contracts
@motionsmith/mechanism-domain
@motionsmith/scene-projection
@motionsmith/physics-session
@motionsmith/fabrication-export
@motionsmith/web-editor
```

This is not current implementation work. These names are distribution candidates only, not present-day source-module names. A split requires real consumers, clean imports, ADR, and test/build proof.

## 11. Must-not-do list

- Do not create duplicate canvas engines without a tested migration boundary.
- Do not create duplicate mechanism registries.
- Do not create runtime plugin loading for mechanism types.
- Do not add abstract interfaces for one implementation.
- Do not let physics, Three, or Canvas write canonical geometry directly.
- Do not put onboarding, galleries, long explanations, or parameter forms in the center canvas.
- Do not render fake force/velocity/path overlays without sampled data.
- Do not hide fabrication blockers to make export look successful.
- Do not split into npm packages because the folder tree looks cleaner.
- Do not weaken browser/physics tests to make architecture changes faster.

## 12. References inside this repo

- `AGENTS.md` — tinkerable workbench, 3D physics, fabrication, canonical state, test rules.
- `DESIGN.md` — shared editor workbench, pane ownership, novice UI contract.
- `docs/platform-rebuild-porting-flow.md` — porting flow, stage responsibilities, clean state ownership.
- `docs/ui-to-web/CANVAS_LAYER_STRATEGY.md` — scene layers, canonical coordinates, viewport-only camera state.
- `docs/ui-pane-tab-redesign-plan.md` — left/center/right pane redesign.
- `docs/prd/realistic-25d-3d-physics-platform-plan.md` — 2.5D/3D/physics platform direction.
- `types.ts`, `utils/project.ts`, `utils/sceneProjection.ts`, `utils/physicsSession.ts`, `utils/fabrication.ts`, `utils/kinematics.ts`, `utils/motion.ts`, `utils/mechanismTemplates.ts` — current source seams.
- `tests/project-contract.test.ts` — current executable contract surface.

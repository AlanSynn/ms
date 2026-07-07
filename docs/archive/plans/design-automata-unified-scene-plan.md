# Design Automata Unified Scene Plan

Status: historical provenance (baseline implemented); active hardening done in baseline
Date: 2026-07-05
Scope: Path -> Foundry -> Design -> Blueprint -> Assembly mechanism/character simulation.

## Problem

Mechanism Design looked connected but not one automata scene. Mechanism via Foundry Three renderer, character via nested Puppet renderer — visual overlay, not physical system where mechanism end-effector drives character part/object through selected path target.

Observed root cause:

- 2026-07-05 baseline: `DesignFoundryPreview.tsx` feeds `buildAutomataSceneModel` into one `ThreeFoundryPreview`; no nested Puppet context layer remains in Design.
- `AssemblyThreePreview.tsx` splits character assembly + mechanism assembly into separate renderer branches.
- `PathCanvasPane.tsx` previews path motion with `ThreePuppetPreview`, suppresses mechanisms.
- Canonical domain motion seam now `utils/automataSceneModel.ts`; `utils/designAutomataProjection.ts` compatibility wrapper only.

This why screenshot shows character/board + mechanism near each other instead of real mechanism-driven character.

## Product rule

Mechanism Design must show one real automata:

```text
selected part/object -> target path + IK endpoint -> fitted mechanism -> driven character/object pose -> blueprint/assembly stack
```

No disconnected mechanism/character overlay in Design. If mechanism not bound to target anchor/object, Design shows blocker, does not pretend attached.

## UX flow

### Character

Goal: choose what can move.

- Left: parts, scene objects, import/create actions, reset.
- Center: character/object workbench with selectable parts, object outlines, joint dots, anchor handles.
- Right: selected part/object inspector only.
- Player: hidden or disabled with `No motion`.

Primary gate: `Select part` or `Select object`.

### Path

Goal: draw desired visible motion.

- Left: selected target card, path list, `Draw`, `Trace`, `Clear`, `Fit mechanism`.
- Center: character/object, skeleton, editable target path, endpoint handle. No mechanism geometry.
- Right: path topology, smoothing, target anchor, IK root/handle, bend direction.
- Player: previews target path motion only.

Primary gate: `Draw path`.

Visuals:

- target path: violet dashed line;
- target endpoint: large violet handle;
- IK preview pose: faint green;
- no Foundry parts here.

### Foundry

Goal: fit physical mechanism to path.

- Left: mechanism templates with fit status: `Good`, `Close`, `Blocked`.
- Center: Foundry physical preview + target path/mechanism path overlays.
- Right: sensemaking, fit status, link/gear/cam parameters, fabrication warnings.
- Player: candidate mechanism playback.

Primary gates:

1. `Fit path` computes best kit-compatible candidate.
2. `Use mechanism` writes real mechanism instance to `ProjectState.mechanisms[]`.

Rules:

- Foundry can preview candidates before commit.
- Link sizes stay within fabrication kit options by default.
- Fit defaults to 15 x 15 board-hole placement.
- Foundry is source of mechanism geometry, stack, z, pins, path traces.

### Design

Goal: test accepted automata.

- Left: active mechanism instances + fit status.
- Center: one integrated automata scene: character/object, selected path, accepted mechanism, pins, pivots, driven pose.
- Right: selected mechanism binding, path/handle, editable parameters, warnings, export handoff.
- Player: actual automata playback.

Center visual rules:

- character/object shown in driven pose;
- bound pin visually passes through target anchor/object connector;
- target path thin violet;
- actual mechanism-driven trace solid green;
- target-vs-driven error amber tick marks;
- failed binding broken amber connector;
- mechanism parts solid, thick, Foundry-colored;
- no separate Puppet overlay with own camera.

Primary gate: `Test automata`, then `Blueprint` when buildable.

### Blueprint

Goal: produce printable/buildable artifacts from accepted automata.

- Center remains flat print/cut preview, not live 3D simulation.
- Labels match Design + Assembly.
- Character sheet + mechanism parts derive from same project state + fabrication recipe.

Primary gate: `Export parts`.

### Assembly

Goal: build same automata step-by-step.

- Left: build steps for board, pins, spacers, links/gears/cams, character/object attachment, final test.
- Center: one Three-backed build scene; character + mechanism visible in same physical context when step needs both.
- Right: current step parts, holes, coordinates, checks.
- Player: step playback.

Rules:

- `explode_z` moves z only.
- `mount_travel_xy` + `connect_travel_xy` are only assembly x/y travel modes.
- final `scrub_time` uses same driven automata model as Design.

## Team review decision

Agent review split problem into two risks:

- UX risk: students need one Design/Assembly scene where mechanism visibly drives character/object.
- Engineering risk: `ThreePuppetPreview` already has mechanism layer, but layer not Foundry-faithful, historically drifted in color, z-stack, gear behavior, pins, fabrication semantics.

Decision:

1. Do not solve Design by re-enabling `ThreePuppetPreview`'s private mechanism layer.
2. Add one pure shared model seam composing existing Foundry/domain authorities.
3. Move Design + Assembly to consume that seam.
4. Make renderer one scene by reusing/extracting Foundry mechanism rendering, not redrawing mechanisms a second way.

Shortest safe path:

```text
ProjectState
  -> AutomataSceneModel / MechanismSceneModel
      -> motionPreviewForProject
      -> buildFoundryMechanismPreviewModel
      -> buildMechanismSceneContract
  -> one Three scene with Foundry mechanism primitives + driven character/object context
```

## Software architecture

### Existing seams to keep

- `ProjectState`: durable aggregate root.
- `MechanismConfig`: mechanism instance + binding owner.
- `utils/motion.ts`: IK/object motion solver.
- `utils/designAutomataProjection.ts`: current projection wrapper.
- `utils/foundryPreviewModel.ts`: Foundry playback/path/physics model.
- `utils/mechanismSceneContract.ts`: mechanism identity/stack/contract.
- `utils/assemblySceneFrame.ts`: assembly step state around mechanism contract.

### New seam: `AutomataSceneModel`

Add DOM-free helper, likely `utils/automataSceneModel.ts`. Composition seam, not new mechanism engine:

```ts
export type AutomataSceneMode = 'path-target' | 'foundry-candidate' | 'design-live' | 'assembly-step';

export interface AutomataDrivenTarget {
  kind: 'part' | 'scene-object';
  targetId: string;
  pathId?: string;
  rootJointId?: string;
  targetJointId?: string;
  desiredPoint?: Point;
  drivenPoint?: Point;
  error?: number;
}

export interface AutomataSceneModel {
  mode: AutomataSceneMode;
  project: ProjectState;
  mechanisms: MechanismConfig[];
  selectedMechanismId?: string;
  animatedParts: Record<string, BodyPartLayer>;
  animatedSceneObjects: Record<string, SceneObject>;
  skeleton: StandardSkeleton | null;
  drivenTargets: AutomataDrivenTarget[];
  targetPaths: ProjectMotionPath[];
  mechanismContracts: MechanismSceneContract[];
  warnings: Record<string, string[]>;
}
```

Responsibilities:

- normalize mechanisms exactly once through same path Foundry uses;
- call `motionPreviewForProject` once for active mechanism set;
- call `buildFoundryMechanismPreviewModel` for selected/live mechanism preview state;
- call `buildMechanismSceneContract` for stack/z/pin/fabrication identity;
- expose animated part/object poses;
- expose target path vs driven trace metadata;
- expose binding errors;
- carry Foundry mechanism contracts without recomputing mechanism stack/z/pins in stages.

Non-responsibilities:

- no React;
- no Three objects;
- no DOM;
- no local UI state;
- no new mechanism math.

### Renderer plan

Do **not** use `ThreePuppetPreview`'s private mechanism rendering as final Design solution. Fast-looking path but source of parity drift with Foundry.

Required change:

- Design must not nest separate `ThreePuppetPreview` canvas/context layer inside `ThreeFoundryPreview`.
- Design must render from one `AutomataSceneModel`.
- Mechanism geometry in Design + Assembly must come from same Foundry primitive/layer path Foundry uses.
- Foundry remains mechanism-only during fitting.
- Assembly may still use mechanism-only Foundry exploded steps, but character attach/final test scenes must consume `AutomataSceneModel` so character/object + mechanism are in one physical context.

Renderer implementation options, in order:

1. Extract Foundry mechanism group/layer builder from `ThreeFoundryPreview` into small renderer helper consumed by `ThreeFoundryPreview`, Design, Assembly.
2. If extraction too large for first patch, extend `ThreeFoundryPreview` with optional character/object context layer rendered inside same Three scene + camera.
3. Only use `ThreePuppetPreview` for character-only tabs or temporary character geometry helpers; never let it own mechanism primitives in Design/Assembly.

Single-scene acceptance means one WebGL scene/camera owns mechanism + driven character/object. DOM/SVG overlays allowed only for labels/toggles, not as physical automata.

## Implementation slices

### Slice 1: shared automata model seam

Files:

- `utils/automataSceneModel.ts` new pure helper.
- `utils/designAutomataProjection.ts` thin wrapper or removal after callers migrate.
- `components/stages/mechanism/DesignFoundryPreview.tsx` consumes new model, not parallel projection.
- `components/stages/assembly/AssemblyThreePreview.tsx` consumes same model for live/final-test scenes.
- `tests/project-contract.test.ts` contract assertions.

Actions:

1. Build `AutomataSceneModel` from selected mechanism/project/angle.
2. Preserve project-wide multi-mechanism ownership semantics from `motionPreviewForProject`.
3. Preserve Foundry normalization, preview state, stack/z/pin/fabrication contract from Foundry helpers.
4. Add telemetry proving Design + Assembly consume same model source.

Acceptance:

- Design + Assembly derive normalized mechanism, path traces, target error, motion preview, mechanism contract from same pure helper.
- No Design-only recomputation of stack/z/pin/fabrication semantics remains.

### Slice 2: Design live scene truth

Files:

- `components/stages/mechanism/DesignFoundryPreview.tsx` simplify or replace with `DesignAutomataScene.tsx`.
- Foundry mechanism renderer helper extracted from `ThreeFoundryPreview`, or optional same-scene automata context inside `ThreeFoundryPreview`.
- `tests/project-contract.test.ts` contract assertions.
- `tests/browser/workflow.spec.ts` targeted Design flow.

Actions:

1. Render Design from `AutomataSceneModel`.
2. Render mechanism geometry through shared Foundry primitive path.
3. Render driven character/object context in same Three scene/camera.
4. Remove nested `design-foundry-context-layer` overlay in Design.
5. Add telemetry proving one scene owns character + mechanism:
   - `data-design-scene-mode="single-automata-scene"`;
   - nonzero part count;
   - nonzero mechanism count;
   - selected mechanism id;
   - driven target id;
   - target error.

Acceptance:

- Scrubbing Design moves selected character/object through `motionPreviewForProject`.
- Selected mechanism visible in same scene as driven target.
- No `mechanisms={[]}` or private Puppet mechanism primitive remains in Design live scene.
- User path + driven trace are scene layers, not large floating center buttons.

### Slice 3: Foundry-to-Design binding hardening

Files:

- `utils/mechanismRecommendations.ts`
- `hooks/useAppMechanismActions.ts`
- `utils/project.ts`
- `components/stages/foundry/MechanismFoundry.tsx`

Actions:

1. Ensure `Use mechanism` persists:
   - `targetPathId`;
   - `targetPartId` or `targetSceneObjectId`;
   - `targetAnchorJointId`;
   - `generatedPath`;
   - board-snapped anchor;
   - mechanism type/parameters.
2. If missing binding, Design shows `Unbound` + routes back to Foundry.
3. Keep Foundry candidate knobs ephemeral until `Use mechanism`.

Acceptance:

- Reopening Design after refresh still shows bound automata motion.
- Multiple mechanisms of same type remain separate instances.

### Slice 4: Assembly final/test scene

Files:

- `components/stages/assembly/AssemblyThreePreview.tsx`
- `components/stages/assembly/AssemblyCanvasPane.tsx`
- `utils/assemblySceneFrame.ts`
- `utils/automataSceneModel.ts`

Actions:

1. Keep z-only exploded mechanism build steps.
2. For character attach/final test steps, render automata scene model with character/object + mechanism together.
3. Do not show editor skeleton as assembly truth; show pins/connectors/plates.

Acceptance:

- Final test step uses same driven target model as Design.
- Character/object attachment visible with physical pin/connector alignment.
- No lower SVG/ghost simulation returns.

### Slice 5: Blueprint label parity

Files:

- `utils/fabrication*.ts`
- `components/stages/blueprint/*`
- `utils/assemblyPlayback.ts`

Actions:

1. Ensure all part/pin labels used in Design driven target present in Blueprint + Assembly.
2. Keep Blueprint flat/export-only.

Acceptance:

- Design pin/target labels match cut sheet + assembly step text.

## Tests

Minimum focused tests before claiming redesign implementation:

```sh
bun run test
bun run build
env -u NO_COLOR bunx playwright test tests/browser/workflow.spec.ts -g "character → path → foundry → design → blueprint runs end-to-end"
```

Add/lock assertions:

- Design has `data-design-scene-mode="single-automata-scene"`.
- Design selected scene has `data-three-mechanism-count` > 0 and `data-three-part-count` > 0 in same state node.
- Design no longer renders `design-foundry-context-layer`.
- Design no longer passes `mechanisms={[]}` for live automata scene.
- Design/Assembly do not use `ThreePuppetPreview` private mechanism geometry for live automata scenes.
- Assembly final/test step has character + mechanism telemetry together.
- Foundry remains only candidate-fitting surface before commit.

## Risks

Critical:

- `ThreePuppetPreview` mechanism rendering not Foundry-faithful enough for Design/Assembly; do not use as final mechanism path.
- Coordinate/camera mismatch persists if Design keeps two renderers or DOM-layer physical context.
- Extracting Foundry primitive builders can accidentally move domain logic into renderer helpers; keep stack/z/pin/fabrication identity in `utils/` contracts.
- Multiple mechanisms driving same target need existing `mechanismBindingWarnings` to stay visible + blocking.

Non-critical:

- Foundry can remain mechanism-only during fitting.
- Blueprint does not need live 3D automata.
- Advanced bidirectional mechanism editing can wait; right inspector parameter editing enough for this redesign.

## Decision

Design baseline implemented first + remains gating reference for later Assembly hardening. Future work should deepen Assembly character/object build clarity without creating second mechanism authority outside Foundry primitives.
# Design Automata Unified Scene Plan

Status: baseline implemented; active hardening plan  
Date: 2026-07-05  
Scope: Path -> Foundry -> Design -> Blueprint -> Assembly mechanism/character simulation.

## Problem

Mechanism Design previously looked connected but was not one automata scene. The mechanism was rendered by the Foundry Three renderer and the character was rendered by a nested Puppet renderer, creating a visual overlay instead of a physical system where a mechanism end-effector drives a character part/object through the selected path target.

Observed root cause:

- 2026-07-05 baseline: `DesignFoundryPreview.tsx` now feeds `buildAutomataSceneModel` into one `ThreeFoundryPreview`; no nested Puppet context layer remains in Design.
- `AssemblyThreePreview.tsx` splits character assembly and mechanism assembly into separate renderer branches.
- `PathCanvasPane.tsx` previews path motion with `ThreePuppetPreview` while explicitly suppressing mechanisms.
- The canonical domain motion seam is now `utils/automataSceneModel.ts`; `utils/designAutomataProjection.ts` is a compatibility wrapper only.

This is why the screenshot shows a character/board and a mechanism near each other instead of a real mechanism-driven character.

## Product rule

Mechanism Design must show one real automata:

```text
selected part/object -> target path + IK endpoint -> fitted mechanism -> driven character/object pose -> blueprint/assembly stack
```

No disconnected mechanism/character overlay is allowed in Design. If a mechanism is not bound to a target anchor/object, Design shows a blocker and does not pretend it is attached.

## UX flow

### Character

Goal: choose what can move.

- Left: parts, scene objects, import/create actions, reset.
- Center: character/object workbench with selectable parts, object outlines, joint dots, anchor handles.
- Right: selected part/object inspector only.
- Player: hidden or disabled with `No motion`.

Primary gate: `Select part` or `Select object`.

### Path

Goal: draw the desired visible motion.

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

Goal: fit a physical mechanism to the path.

- Left: mechanism templates with fit status: `Good`, `Close`, `Blocked`.
- Center: Foundry physical preview plus target path/mechanism path overlays.
- Right: sensemaking, fit status, link/gear/cam parameters, fabrication warnings.
- Player: candidate mechanism playback.

Primary gates:

1. `Fit path` computes the best kit-compatible candidate.
2. `Use mechanism` writes a real mechanism instance to `ProjectState.mechanisms[]`.

Rules:

- Foundry can preview candidates before commit.
- Link sizes stay within fabrication kit options by default.
- Fit defaults to 15 x 15 board-hole placement.
- Foundry is the source of mechanism geometry, stack, z, pins, and path traces.

### Design

Goal: test the accepted automata.

- Left: active mechanism instances and fit status.
- Center: one integrated automata scene: character/object, selected path, accepted mechanism, pins, pivots, driven pose.
- Right: selected mechanism binding, path/handle, editable parameters, warnings, export handoff.
- Player: actual automata playback.

Center visual rules:

- character/object is shown in the driven pose;
- bound pin visually passes through the target anchor/object connector;
- target path is thin violet;
- actual mechanism-driven trace is solid green;
- target-vs-driven error is amber tick marks;
- failed binding is a broken amber connector;
- mechanism parts are solid, thick, and Foundry-colored;
- no separate Puppet overlay with its own camera.

Primary gate: `Test automata`, then `Blueprint` when buildable.

### Blueprint

Goal: produce printable/buildable artifacts from the accepted automata.

- Center remains flat print/cut preview, not live 3D simulation.
- Labels match Design and Assembly.
- Character sheet and mechanism parts derive from the same project state and fabrication recipe.

Primary gate: `Export parts`.

### Assembly

Goal: build the same automata step-by-step.

- Left: build steps for board, pins, spacers, links/gears/cams, character/object attachment, final test.
- Center: one Three-backed build scene; character and mechanism are visible in the same physical context when the step needs both.
- Right: current step parts, holes, coordinates, checks.
- Player: step playback.

Rules:

- `explode_z` moves z only.
- `mount_travel_xy` and `connect_travel_xy` are the only assembly x/y travel modes.
- final `scrub_time` uses the same driven automata model as Design.

## Team review decision

Agent review split the problem into two different risks:

- UX risk: students need one Design/Assembly scene where the mechanism visibly drives the character/object.
- Engineering risk: `ThreePuppetPreview` already has a mechanism layer, but that layer is not Foundry-faithful and has historically drifted in color, z-stack, gear behavior, pins, and fabrication semantics.

Decision:

1. Do not solve Design by re-enabling `ThreePuppetPreview`'s private mechanism layer.
2. Add one pure shared model seam that composes the existing Foundry/domain authorities.
3. Move Design and Assembly to consume that seam.
4. Then make the renderer one scene by reusing/extracting Foundry mechanism rendering, not by redrawing mechanisms a second way.

The shortest safe path is therefore:

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
- `MechanismConfig`: mechanism instance and binding owner.
- `utils/motion.ts`: IK/object motion solver.
- `utils/designAutomataProjection.ts`: current projection wrapper.
- `utils/foundryPreviewModel.ts`: Foundry playback/path/physics model.
- `utils/mechanismSceneContract.ts`: mechanism identity/stack/contract.
- `utils/assemblySceneFrame.ts`: assembly step state around the mechanism contract.

### New seam: `AutomataSceneModel`

Add a DOM-free helper, likely `utils/automataSceneModel.ts`. This is a composition seam, not a new mechanism engine:

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

- normalize mechanisms exactly once through the same path used by Foundry;
- call `motionPreviewForProject` once for the active mechanism set;
- call `buildFoundryMechanismPreviewModel` for the selected/live mechanism preview state;
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

Do **not** use `ThreePuppetPreview`'s private mechanism rendering as the final Design solution. It is the fast-looking path, but it is the source of parity drift with Foundry.

Required change:

- Design must not nest a separate `ThreePuppetPreview` canvas/context layer inside `ThreeFoundryPreview`.
- Design must render from one `AutomataSceneModel`.
- The mechanism geometry in Design and Assembly must come from the same Foundry primitive/layer path used by Foundry.
- Foundry remains mechanism-only during fitting.
- Assembly may still use mechanism-only Foundry exploded steps, but character attach/final test scenes must consume `AutomataSceneModel` so character/object and mechanism are in one physical context.

Renderer implementation options, in order:

1. Extract the Foundry mechanism group/layer builder from `ThreeFoundryPreview` into a small renderer helper consumed by `ThreeFoundryPreview`, Design, and Assembly.
2. If extraction is too large for the first patch, extend `ThreeFoundryPreview` with an optional character/object context layer rendered inside the same Three scene and camera.
3. Only use `ThreePuppetPreview` for character-only tabs or temporary character geometry helpers; never let it own mechanism primitives in Design/Assembly.

Single-scene acceptance means one WebGL scene/camera owns mechanism + driven character/object. DOM/SVG overlays are allowed only for labels/toggles, not as the physical automata.

## Implementation slices

### Slice 1: shared automata model seam

Files:

- `utils/automataSceneModel.ts` new pure helper.
- `utils/designAutomataProjection.ts` thin wrapper or removal after callers migrate.
- `components/stages/mechanism/DesignFoundryPreview.tsx` consumes the new model, not a parallel projection.
- `components/stages/assembly/AssemblyThreePreview.tsx` consumes the same model for live/final-test scenes.
- `tests/project-contract.test.ts` contract assertions.

Actions:

1. Build `AutomataSceneModel` from selected mechanism/project/angle.
2. Preserve project-wide multi-mechanism ownership semantics from `motionPreviewForProject`.
3. Preserve Foundry normalization, preview state, stack/z/pin/fabrication contract from Foundry helpers.
4. Add telemetry proving Design and Assembly consume the same model source.

Acceptance:

- Design and Assembly derive normalized mechanism, path traces, target error, motion preview, and mechanism contract from the same pure helper.
- No Design-only recomputation of stack/z/pin/fabrication semantics remains.

### Slice 2: Design live scene truth

Files:

- `components/stages/mechanism/DesignFoundryPreview.tsx` simplify or replace with `DesignAutomataScene.tsx`.
- Foundry mechanism renderer helper extracted from `ThreeFoundryPreview`, or an optional same-scene automata context inside `ThreeFoundryPreview`.
- `tests/project-contract.test.ts` contract assertions.
- `tests/browser/workflow.spec.ts` targeted Design flow.

Actions:

1. Render Design from `AutomataSceneModel`.
2. Render mechanism geometry through the shared Foundry primitive path.
3. Render driven character/object context in the same Three scene/camera.
4. Remove the nested `design-foundry-context-layer` overlay in Design.
5. Add telemetry proving one scene owns character + mechanism:
   - `data-design-scene-mode="single-automata-scene"`;
   - nonzero part count;
   - nonzero mechanism count;
   - selected mechanism id;
   - driven target id;
   - target error.

Acceptance:

- Scrubbing Design moves the selected character/object through `motionPreviewForProject`.
- The selected mechanism is visible in the same scene as the driven target.
- No `mechanisms={[]}` or private Puppet mechanism primitive remains in Design live scene.
- User path and driven trace are scene layers, not large floating center buttons.

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
2. If missing binding, Design shows `Unbound` and routes back to Foundry.
3. Keep Foundry candidate knobs ephemeral until `Use mechanism`.

Acceptance:

- Reopening Design after refresh still shows bound automata motion.
- Multiple mechanisms of the same type remain separate instances.

### Slice 4: Assembly final/test scene

Files:

- `components/stages/assembly/AssemblyThreePreview.tsx`
- `components/stages/assembly/AssemblyCanvasPane.tsx`
- `utils/assemblySceneFrame.ts`
- `utils/automataSceneModel.ts`

Actions:

1. Keep z-only exploded mechanism build steps.
2. For character attach/final test steps, render an automata scene model with character/object and mechanism together.
3. Do not show editor skeleton as assembly truth; show pins/connectors/plates.

Acceptance:

- Final test step uses the same driven target model as Design.
- Character/object attachment is visible with physical pin/connector alignment.
- No lower SVG/ghost simulation returns.

### Slice 5: Blueprint label parity

Files:

- `utils/fabrication*.ts`
- `components/stages/blueprint/*`
- `utils/assemblyPlayback.ts`

Actions:

1. Ensure all part/pin labels used in Design driven target are present in Blueprint and Assembly.
2. Keep Blueprint flat/export-only.

Acceptance:

- Design pin/target labels match cut sheet and assembly step text.

## Tests

Minimum focused tests before claiming the redesign implementation:

```sh
bun run test
bun run build
env -u NO_COLOR bunx playwright test tests/browser/workflow.spec.ts -g "character → path → foundry → design → blueprint runs end-to-end"
```

Add/lock assertions:

- Design has `data-design-scene-mode="single-automata-scene"`.
- Design selected scene has `data-three-mechanism-count` > 0 and `data-three-part-count` > 0 in the same state node.
- Design no longer renders `design-foundry-context-layer`.
- Design no longer passes `mechanisms={[]}` for live automata scene.
- Design/Assembly do not use `ThreePuppetPreview` private mechanism geometry for live automata scenes.
- Assembly final/test step has character and mechanism telemetry together.
- Foundry remains the only candidate-fitting surface before commit.

## Risks

Critical:

- `ThreePuppetPreview` mechanism rendering is not Foundry-faithful enough for Design/Assembly; do not use it as the final mechanism path.
- Coordinate/camera mismatch will persist if Design keeps two renderers or DOM-layer physical context.
- Extracting Foundry primitive builders can accidentally move domain logic into renderer helpers; keep stack/z/pin/fabrication identity in `utils/` contracts.
- Multiple mechanisms driving the same target need existing `mechanismBindingWarnings` to stay visible and blocking.

Non-critical:

- Foundry can remain mechanism-only during fitting.
- Blueprint does not need live 3D automata.
- Advanced bidirectional mechanism editing can wait; right inspector parameter editing is enough for this redesign.

## Decision

Design baseline is implemented first and remains the gating reference for later Assembly hardening. Future work should deepen Assembly character/object build clarity without creating a second mechanism authority outside Foundry primitives.

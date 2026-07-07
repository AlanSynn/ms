# Mechanism graph compiler + feasible-only editing plan

Status: active redesign contract
Date: 2026-07-06
Scope: all mechanisms, arbitrary future mechanism families, free joint/link graphs, fabrication recipes, Foundry, Design, recommendations, Blueprint, Assembly, and imported project repair.

## Goal

MotionSmith must eventually support more than the current finite `MechanismType` catalog:

- every current `MechanismType` should become buildable when its graph/fabrication recipe exists;
- arbitrary mechanism families should be addable later without stage rewrites;
- free joint/link graphs should compile into fabrication recipes when physically buildable;
- stage-specific mechanism exceptions should shrink, not grow.

Students should still only see edits that can move, fit the kit, and build/export cleanly. The internal redesign must not expose expert CAD/solver vocabulary to middle-school users.

## Evidence from repo audit

Facts:

- `types.ts` currently defines a closed `MechanismType` union.
- Authoritative behavior is still spread across per-type tables and switches:
  - `utils/mechanismReference.ts`
  - `utils/mechanismTemplates.ts`
  - `utils/mechanismFeatureRegistry.ts`
  - `utils/project.ts`
  - `utils/kinematics.ts`
  - `utils/fabricationStackModel.ts`
  - `utils/fabricationRecipes.ts`
- Existing downstream seams are worth keeping:
  - `utils/mechanismSnapshot.ts`
  - `utils/mechanismSceneContract.ts`
  - `utils/assemblySceneFrame.ts`
  - Blueprint/export package contracts.
- Current safe editing is partial: `mechanismParamPolicy.ts` and `MechanismParametricEditor.tsx` lock some options, while Foundry, Design, recommendation apply, and raw upserts can still bypass a single acceptance contract.

Inference:

- The near-term feasible gate is still useful, but it cannot be the final architecture.
- The correct long-term boundary is a mechanism graph + solver + fabrication compiler.
- The safe migration is not graph-first persistence. It is graph as a compiler-derived IR first, with legacy closed-form solvers as the oracle until parity is proven.

## Non-goals

- Do not expose graph nodes, constraints, or solver errors in the student UI.
- Do not replace current classroom templates before parity tests exist.
- Do not add a new renderer or physics engine.
- Do not break existing saved `ProjectState` files.
- Do not make arbitrary graphs appear buildable before a compiler can emit parts, board holes, stacks, and assembly steps.

## Target architecture

### Core domain objects

`ProjectState` remains the aggregate root. Mechanism storage stays backward-compatible while the compiler matures.

Add a graph compiler layer:

```ts
type MechanismGraph = {
  id: string;
  source: 'derived-legacy-adapter' | 'family-definition' | 'free-graph-authoring' | 'imported-graph';
  nodes: MechanismGraphNode[];
  constraints: MechanismConstraint[];
  drivers: MechanismDriver[];
  fabricationHints: FabricationHint[];
};
```

Minimum node roles:

- `board_anchor`
- `rigid_part`
- `link`
- `gear`
- `ring_gear`
- `cam`
- `follower`
- `slider`
- `guide`
- `spacer`
- `fastener`
- `output_point`

Minimum constraint roles:

- `fixed`
- `pin`
- `distance`
- `point_on_line`
- `gear_mesh`
- `phase`
- `contact`
- `clearance`
- `prismatic`
- `board_snap`

A mechanism family is a macro that expands parameters into this graph:

```ts
type MechanismFamilyDefinition = {
  id: string;
  label: string;
  expand(params: unknown): MechanismGraph;
  editableParameters: MechanismParameterSpec[];
};
```

`MechanismType` becomes a legacy preset/import alias, not the final domain boundary.

### Compiler pipeline

One lowering path feeds every stage:

1. Input
   - legacy `MechanismConfig`, family params, or free graph.
2. Normalize
   - convert to `MechanismGraph`.
3. Solve
   - produce sampled motion, feasibility, and diagnostics.
4. Pack
   - choose kit-compatible parts, board holes, spacers, clearances, and z stacks.
5. Compile recipe
   - emit fabrication parts, render layers, hole maps, assembly steps, labels, and blockers.
6. Emit stage contracts
   - Foundry preview, Design automata scene, Blueprint cut sheets, Assembly scene frame, physics telemetry.

The output should be a single compiled artifact:

```ts
type CompiledMechanism = {
  graph: MechanismGraph;
  motion: MechanismMotionSample[];
  feasibility: MechanismFeasibility;
  fabrication: FabricationPlan;
  scene: MechanismSceneContract;
  assembly: AssemblySceneFrame;
};
```

## Schema boundary and migration

### Phase 0 storage rule

Do not persist graph as the only source yet.

- Persist existing `MechanismConfig` unchanged.
- Add graph output as compiler-derived read-model data only when needed for tests/debugging.
- Existing snapshots/imports keep loading.
- Current closed-form code remains the reference oracle.

### Later storage rule

Persist graph only after:

- two compiled mechanisms pass parity;
- Blueprint/Assembly golden masters match;
- browser classroom flow remains green;
- imported legacy projects can regenerate the same graph deterministically.

When persistence begins, store graph as `mechanism.graphV2` next to legacy fields for one release cycle. Do not remove legacy scalar fields until export/assembly parity is stable.

## Two-track migration

### Track A: keep classroom stable

Known current mechanisms continue to use closed-form fast paths and current UI controls until each graph compiler gate passes.

Current buildable set:

- `4bar`
- `piston`
- `cam`
- `gear`
- `gear_linkage`
- `planetary_gear`

Current not-yet-buildable set stays hidden/readonly until compiler recipes exist:

- `crank`
- `yoke`
- `quick-return`
- `5bar`
- `6bar`
- `rack-pinion`

### Track B: build the compiler underneath

First compiled mechanisms:

1. `4bar`
   - simplest closed linkage parity target;
   - tests distance/pin constraints, link kit packing, board holes, z stack, generated path.
2. `gear`
   - tests gear mesh constraints, pitch/radius packing, gear train direction, board placement.

Only after those pass should the compiler take on:

3. `piston`
4. `cam`
5. `gear_linkage`
6. `planetary_gear`
7. `yoke`, `quick-return`, `rack-pinion`, `5bar`, `6bar`
8. free graph authoring.

## Feasible-only edit gate

The near-term gate remains necessary, but it should call the compiler when available.

```ts
type MechanismEditMode = 'accept' | 'clamp' | 'reject';

type MechanismEditContext = {
  stage: 'foundry' | 'design' | 'recommendation' | 'import' | 'repair';
  strictFabrication?: boolean;
  project?: ProjectState;
  targetPathId?: string;
};

type MechanismEditResult = {
  mode: MechanismEditMode;
  mechanism: MechanismConfig;
  compiled?: CompiledMechanism;
  issues: FabricationIssue[];
  message?: string;
};
```

Acceptance sequence:

1. Merge patch into current mechanism.
2. If graph compiler exists for this mechanism, compile and validate through the compiler.
3. Else use the legacy normalizer, `sampleFeasibleRange`, `validateMechanismPreviewReadiness`, and `validateForFabrication`.
4. Return `accept`, `clamp`, or `reject`.
5. Store only accepted/clamped state.

## Performance budget

Drag-time UI must stay responsive.

- Closed-form known mechanisms: validation during drag is allowed.
- Graph compiler: solve during drag only if measured below 16 ms per interaction frame for the current candidate set.
- Otherwise:
  - preview optimistic ghost during drag;
  - validate on pointer-up / commit;
  - reject or snap back with `Safe range only`.
- Recommendation batch solves must be bounded and cancellable.
- Compiler outputs should be memoized by graph hash + kit settings + target path id.

## UI contract

Student-facing UI remains simple:

- cards, safe options, `Fit path`, `Use`, `Reset kit`, `Fix fit`, `Replace`;
- no node graph editor in classroom mode;
- no solver terms in visible warnings;
- free graph authoring, when added, starts as advanced/teacher/diagnostic mode.

Copy:

- `Safe range`
- `Fits board`
- `Motion may jam`
- `Try shorter link`
- `Use Fit`
- `Recipe missing`
- `Replace mechanism`
- `Follower must touch cam`
- `Mesh locked`

## Stage obligations

### Foundry

- Shows family/template cards, not raw graph nodes.
- `Fit path` may search graph-compatible candidates.
- `Use` only emits accepted compiled mechanisms.

### Design

- Reads `CompiledMechanism`/scene contract when available.
- Does not recompute mechanism geometry by type.
- Target/path binding must pass the same compiler/gate.

### Blueprint

- Emits parts from compiled fabrication plan.
- Does not own live mechanism solving.
- Refuses partial motion in fabrication-ready mode.

### Assembly

- Emits steps from compiled assembly plan.
- Uses same scene contract as Foundry/Design.
- Old projects with unsupported graphs show repair/replace state.

## Implementation phases

Current implementation checkpoint:

- `utils/mechanismGraph.ts` owns derived, non-persisted graph IR/adapters/validation for every current `MechanismType`.
- `4bar` and `gear` remain the first compiler targets; the buildable classroom set also has graph adapters for parity and diagnostics.
- `utils/mechanismCompiler.ts` is the canonical compiler facade: it emits `CompiledMechanism`, `compileFabricationRecipe`, graph validation diagnostics, closed-form oracle samples, feasible ranges, render-plan data, and assembly-step fingerprints consumed by Snapshot, SceneContract, Assembly, and Blueprint parity tests.
- Advanced/free graph drafts now enter the same non-persisted IR through `mechanismGraphFromDraft()` and stop at a compiler-owned `Recipe missing` blocker until a recipe compiler recognizes the graph.
- Hidden/not-yet-buildable families compile as diagnostic graphs only and cannot be exported as buildable classroom mechanisms.

### Phase 0 — compiler IR behind adapters

Deliver:

- `MechanismGraph` types.
- legacy `MechanismConfig -> MechanismGraph` adapters.
- no runtime behavior change.

Gate:

- every current `MechanismType` can compile to graph diagnostics;
- no stage consumer switched yet.

### Phase 1 — parity for first two mechanisms

Deliver:

- graph solver for `4bar` and `gear`.
- graph-to-fabrication plan for `4bar` and `gear`.

Gate:

- solver parity with `calculateLinkage` at canonical angles;
- fabrication stack/assembly/blueprint golden masters match current output;
- perf budget recorded.

### Phase 2 — read-model consumers

Deliver:

- `MechanismSnapshot`, `MechanismSceneContract`, physics telemetry consume compiled output when available.

Gate:

- no visual/export diff for `4bar` and `gear`;
- compiler facade remains the only read-model entry point while closed-form solvers stay as parity oracles, not stage-owned fallbacks.

### Phase 3 — remaining current buildable families

Deliver compiler coverage for:

- `piston`
- `cam`
- `gear_linkage`
- `planetary_gear`

Gate:

- same parity and export gates as Phase 1.

### Phase 4 — hidden current families

Deliver compiler/fabrication coverage for:

- `yoke`
- `quick-return`
- `rack-pinion`
- `5bar`
- `6bar`
- `crank` only as a driver/module, not a standalone classroom mechanism unless it has a real build recipe.

Gate:

- templates can become authorable only after recipe, assembly, board fit, and classroom copy exist.

### Phase 5 — free graph authoring

Deliver:

- advanced graph authoring/import path;
- compiler diagnostics;
- automatic recipe generation for recognized buildable subgraphs;
- repair suggestions for non-buildable graphs.

Gate:

- free graph cannot enter classroom export unless compiled fabrication plan is complete.

### Phase 6 — delete legacy authority

Deliver:

- remove type switches only after all active mechanisms route through compiler contracts.

Gate:

- parity suite, browser suite, and export golden masters all pass together.

## Verification gate

Contract tests:

- legacy `4bar` and `gear` compile to graph and match old solver samples.
- graph compiler emits the same fabrication stack and assembly steps for `4bar` and `gear`.
- unsafe edit is rejected by Foundry, Design, recommendation filtering, Blueprint, and Assembly.
- partial motion is an error in fabrication-ready mode.
- unsupported/free graphs remain non-exportable until recipe compile succeeds.
- graph hash memoization changes only when graph/kit/path inputs change.

Browser smoke:

- Foundry locked option cannot change state.
- Design shows same locked option behavior.
- `Use` creates full-motion preview-ready mechanisms.
- Blueprint/Assembly export the same labels/parts for compiled `4bar` and `gear`.
- Student UI never exposes raw graph/solver terms.

Commands:

```sh
npx tsc --noEmit --pretty false
bun run test:contracts
bun run build
```

Add targeted Playwright after Phase 1 and Phase 2 seams are wired.

## Risks

1. Graph expressiveness may exceed what the recipe compiler can fabricate.
2. Solver nondeterminism can break repeatable classroom behavior.
3. Drag-time validation may become slow.
4. Legacy project migration can shift board coordinates or assembly labels.
5. Stage-local special cases can creep back if consumers bypass compiled contracts.
6. Free graph authoring can become too advanced for middle-school UI.

## Risk controls

- Keep closed-form fast path until graph parity passes.
- Use graph as compiler-derived IR before persistence.
- First compile only `4bar` and `gear`.
- Freeze golden-master exports before switching consumers.
- Hide graph authoring from classroom mode.
- Require every new family to provide graph macro, solver constraints, fabrication lowering, assembly plan, safe edit policy, and tests.

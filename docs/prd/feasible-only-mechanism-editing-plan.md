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
- Do not make arbitrary graphs appear buildable unless the compiler emits parts, board holes, stacks, and assembly steps from graph data.

## Target architecture

### Core domain objects

`ProjectState` remains the aggregate root. Mechanism storage stays backward-compatible while the compiler matures.

Add a graph compiler layer:

```ts
type MechanismGraph = {
  id: string;
  source: 'family-definition' | 'free-graph-authoring' | 'imported-graph';
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

Known current mechanisms continue to use closed-form fast paths as motion oracles, but current preview/readiness/fabrication consumers must route through the graph compiler facade.

Current graph-buildable set:

- every current `ALL_MECHANISM_TYPES` entry has a `family-definition` graph adapter;
- every current default mechanism compiles to a graph-owned fabrication recipe, render plan, required-parts list, board placement, z-stack, and assembly-step fingerprint;
- classroom UI still exposes only classroom-ready mechanism families first, while advanced/diagnostic families can remain hidden from novice cards for pedagogy rather than compiler inability.

Fallback policy:

- production preview, Design, Blueprint, Assembly, and fabrication package validation must call `mechanismCompiler` / `compileGraphFabricationRecipe`;
- invalid or non-fabricable graphs return explicit compiler blockers (`Graph invalid`, missing graph dimensions, missing fabricated parts, missing board-snap anchors, or board-fit errors) and a graph-owned blocker render plan;
- reference/fabrication helper modules may remain as low-level test/reference fixtures, but they must not be stage authority for current mechanism families.

Board-fit rule:

- graph family definitions preserve the family/preset geometry they are given;
- the graph compiler validates board-snap constraints against the caller's physical kit;
- graph adapters must not import or bake `defaultPhysicalKit()`.

### Track B: build the compiler underneath

First compiled mechanisms:

1. `4bar`
   - simplest closed linkage parity target;
   - tests distance/pin constraints, link kit packing, board holes, z stack, generated path.
2. `gear`
   - tests gear mesh constraints, pitch/radius packing, gear train direction, board placement.

After those gates, the compiler takes on:

3. `piston`
4. `cam`
5. `gear_linkage`
6. `planetary_gear`
7. `yoke`, `quick-return`, `rack-pinion`, `5bar`, `6bar`
8. free graph authoring beyond recognized graph parts.

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
2. Compile through the graph compiler facade for current mechanism families and authored/imported graphs.
3. If graph compilation fails, return explicit compiler blockers and repair/replace options; do not silently run a legacy fabrication path.
4. Closed-form normalizers and samplers may remain only as motion oracles and candidate generators before compiler acceptance.
5. Return `accept`, `clamp`, or `reject`.
6. Store only accepted/clamped state.

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
- explicit graph fabrication blockers such as `Missing graph part dimension`, `No board-snapped graph anchor`, `Fabricated graph parts need positions`, or `No fabricated moving part in graph`
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
- `4bar` and `gear` remain the first parity/history targets, while every current mechanism family now has a buildable `family-definition` graph adapter and graph fabrication recipe.
- `utils/mechanismCompiler.ts` is the canonical compiler facade: it emits `CompiledMechanism`, `compileFabricationRecipe`, graph validation diagnostics, closed-form oracle samples, feasible ranges, render-plan data, and assembly-step fingerprints consumed by Snapshot, SceneContract, Assembly, and Blueprint parity tests.
- Advanced/free graph drafts now enter the same non-persisted IR through `mechanismGraphFromDraft()`.
- Recognized graph-authored parts now lower through `compileGraphFabricationRecipe` into graph-owned `FabricationRecipe` data with `type: 'graph'`, `source: 'mechanism-graph'` render layers derived from the assembly stack, required parts, board holes, z-order stacks, assembly steps, and deterministic fingerprints.
- Invalid graphs, drafts with no recognizable fabricated moving part, or fabricated graph nodes/constraint endpoints without finite board placements fail with compiler-owned explicit blockers (`Graph invalid`, `No fabricated moving part in graph`, `Fabricated graph parts need positions`, etc.) instead of falling back to a default legacy `MechanismType`.
- Authored graph compilation accepts the caller's physical kit settings so 15×15 classroom boards and smaller teacher/diagnostic boards produce the same board-placement blockers that Blueprint and Assembly will use.
- Current mechanism families no longer compile as non-buildable placeholder graphs; non-classroom visibility is a UI/product decision, not a compiler fallback.

### Phase 0 — compiler IR behind adapters

Deliver:

- `MechanismGraph` types.
- legacy `MechanismConfig -> MechanismGraph` adapters.
- no runtime behavior change.

Gate:

- every current `MechanismType` can compile to a valid non-persisted graph IR;
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

Status: complete at the graph-fabrication compiler layer for the current families.

### Phase 4 — hidden current families

Deliver compiler/fabrication coverage for:

- `yoke`
- `quick-return`
- `rack-pinion`
- `5bar`
- `6bar`
- `crank` only as a driver/module, not a standalone classroom mechanism unless it has a real build recipe.

Gate:

- complete for current graph families at the compiler layer;
- templates become novice-authorable only after recipe, assembly, board fit, classroom copy, and guided-template QA exist.

Status: complete at the graph-fabrication compiler layer for current advanced/diagnostic families; novice visibility remains a classroom UX decision.

### Phase 5 — free graph authoring

Deliver:

- advanced graph authoring/import path;
- compiler diagnostics;
- automatic recipe generation for recognized buildable subgraphs;
- repair suggestions for non-buildable graphs.

Gate:

- free graph cannot enter classroom export unless compiled fabrication plan is complete.
- graph-owned recipes must not call stage-local fabrication helpers or masquerade as `MechanismType`.

### Phase 6 — delete legacy authority

Deliver:

- remove type switches only after all active mechanisms route through compiler contracts.

Gate:

- parity suite, browser suite, and export golden masters all pass together.

## Verification gate

Contract tests:

- every current mechanism family compiles to graph and keeps closed-form oracle samples available for parity.
- graph compiler emits fabrication recipes, render plans, required parts, board placements, z-stacks, and assembly fingerprints for every current mechanism family.
- unsafe edit is rejected by Foundry, Design, recommendation filtering, Blueprint, and Assembly.
- partial motion is an error in fabrication-ready mode.
- invalid/free graphs remain non-exportable until graph-owned recipe compile succeeds.
- recognized free graphs emit graph-owned required parts, render layers, assembly steps, and fingerprints without converting to a legacy default mechanism.
- Foundry/Design/Assembly Three renderers consume compiler render plans and do not call `fabricationRenderPlanForMechanism` directly.
- graph hash memoization changes only when graph/kit/path inputs change.

Browser smoke:

- Foundry locked option cannot change state.
- Design shows same locked option behavior.
- `Use` creates full-motion preview-ready mechanisms.
- Blueprint/Assembly export graph-owned labels/parts for compiled current mechanism families.
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
- Treat `4bar` and `gear` as historical parity sentinels, but keep every current family on the graph compiler path.
- Freeze golden-master exports before switching consumers.
- Hide graph authoring from classroom mode.
- Require every new family to provide graph macro, solver constraints, fabrication lowering, assembly plan, safe edit policy, and tests.

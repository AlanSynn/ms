# Assembly Stepper Plan — .lic-style build simulation

Status: superseded by `docs/prd/assembly-step-player-redesign-plan.md`
Scope: historical planning provenance for Assembly, Blueprint handoff, fabrication kit/custom export handoff
Principle: show the build, do not explain it with paragraphs.

## Agent review summary

- `explore`: current flow already has `FabricationRecipe`, package generation, 15x15 board settings, Assembly tab, printable HTML/PDF guide, and browser tests. Missing piece is an interactive step player; no `.lic` artifact exists today.
- `designer`: Assembly should become a .lic/LEGO-like build simulator. Blueprint owns files; Assembly owns how to build. Mechanism module must be assembled first, then mounted to board or custom base.
- `architect`: keep this single-package for now. Build Assembly as a derived read-only adapter over existing recipe/fabrication data. Do not create a second solver or exporter.

## Non-negotiable workflow

Every assembly recipe follows this order:

1. **Prepare parts**
   - Kit mode: show required prefab parts and hardware.
   - Custom mode: show SVG/PDF/STL cut or print outputs first.
2. **Assemble mechanism module first**
   - Neutral bench view.
   - No 15x15 board yet unless the step physically pins to the board.
   - Show stack order bottom-to-top: board/clip/spacer/linkage/gear/spacer/clip.
3. **Mount to board or base**
   - Kit mode: reveal the 15x15 board and snap the completed module to the recipe coordinate.
   - Custom mode: mount to the custom base if one exists, otherwise keep standalone.
4. **Connect to character**
   - Highlight output joint, target body part, and path.
5. **Test motion**
   - Play/scrub mechanism motion.
   - Show collision, binding, missing spacer, and off-grid warnings near the affected part.

## Tab ownership

### Blueprint tab

Purpose: “Can I make the files?”

Owns:
- validation blockers,
- package generation,
- export lanes,
- 2D cut sheet preview,
- JSON/SVG/PDF/STL/metadata downloads.

Must not own:
- step-by-step assembly UI,
- long guide text in the center canvas,
- interactive build simulation.

### Assembly tab

Purpose: “How do I build it?”

Owns:
- recipe selector,
- mode switch: `Kit board` / `Custom parts`,
- one-step-at-a-time player,
- exploded stack simulation,
- 15x15 board mount animation,
- printable guide export action.

Center canvas shows only the build simulation. The printable guide remains downloadable/printable, not the default center content.

### Options tab

Purpose: global fabrication defaults.

Owns:
- export mode default: `custom-parts` / `prefab-board` / `both`,
- board profile, default 15x15,
- grid pitch, hole diameter,
- default cut-sheet format.

## Data contract

Keep `FabricationRecipe` as the export contract. Derive playback state from it without mutating `ProjectState`.

```ts
type AssemblyPhase =
  | 'prepare-parts'
  | 'assemble-module'
  | 'mount-to-board'
  | 'connect-character'
  | 'test-motion'
  | 'export';

type AssemblyAction =
  | 'show-parts'
  | 'place'
  | 'stack'
  | 'pin'
  | 'spacer'
  | 'clip'
  | 'mount'
  | 'connect'
  | 'test'
  | 'export';

interface AssemblyPlaybackStep {
  recipeId: string;
  index: number;
  phase: AssemblyPhase;
  action: AssemblyAction;
  label: string;
  partIds: string[];
  activePartIds: string[];
  ghostPartIds: string[];
  boardCoordinates: string[];
  coordinateRoles: string[];
  zMm: number;
  stack: AssemblyStepStackItem[];
  check?: string;
  warning?: string;
}
```

Existing source fields to reuse:
- `FabricationRecipe.assemblySteps[]`,
- `coords`, `coordRoles`, `stack`, `check`,
- `requiredParts`, `boardCoordinate`, `warnings`,
- `sceneProjection` for exploded/camera view,
- `physicsSession` for forces/constraints where relevant.

Do not store `AssemblyPlaybackStep[]` in project state. It is a pure derived view.

## Visual behavior

### Step player

Required controls:
- Previous,
- Next,
- Play/Pause,
- Reset,
- scrubber.

Required visual states:
- previous parts: assembled and muted,
- active parts: saturated/highlighted,
- next target: translucent ghost,
- active holes: pulsing ring,
- spacers: visible z-gap cylinders/rings,
- clips/pins: visibly separate parts,
- board coordinate: small chip near the hole.

Text budget per step:
- one short label,
- coordinate chips,
- part chips,
- warning chip if needed.

Long instructions move to tooltip/printable guide only.

### Kit board lane

- The 15x15 board is hidden during pure module assembly.
- When the first board-pinned step appears, reveal the board.
- Mount animation snaps module to `recipe.boardCoordinate`.
- Board holes use the canonical kit rules: 15x15, 20 mm pitch, 4 mm hole.
- Coordinate role decides truth:
  - `board` means fixed/pinned to board,
  - moving roles are location hints only and must not be shown as board-pinned.

### Custom parts lane

- Show export tray first: SVG, PDF, STL.
- Show printed/cut parts as a tray.
- Use the same stack and z-order as kit mode.
- If no board/base is configured, final assembled module remains standalone.

## Implementation phases

### Phase 1 — contract lock

Files likely touched:
- `types.ts`
- `utils/fabrication.ts`
- `tests/project-contract.test.ts`
- `docs/mechanism-reference/05-assembly-process-guides.md`

Tasks:
1. Add a pure playback builder only if `FabricationRecipe.assemblySteps` is too thin for the UI.
2. Keep recipe data sourced from `utils/mechanismReference.ts` and `fabrication/assembly/recipes.json` if present.
3. Add contract checks:
   - reference recipe steps have action/coords/coordRoles/stack/check where expected,
   - playback derivation does not mutate `ProjectState`,
   - board coordinate round-trip remains stable.

### Phase 2 — replace Assembly center iframe

Files likely touched:
- `App.tsx`
- Shared assembly/Foundry render seams only; do not revive deleted `components/Canvas.tsx`
- optional small component file if `App.tsx` becomes harder to read

Tasks:
1. Keep printable guide generation.
2. Remove iframe as default center view.
3. Add native Assembly stepper view:
   - left: recipe + step list + controls,
   - center: visual build simulator,
   - right: current step detail only.
4. Add browser test that advances one recipe step-by-step.

### Phase 3 — kit board mount simulation

Files likely touched:
- `utils/coordinates.ts`
- `utils/fabrication.ts`
- `App.tsx`
- `tests/browser/workflow.spec.ts`

Tasks:
1. Show mechanism module assembly before board mount.
2. Reveal 15x15 board only for board-pinned/mount phases.
3. Animate snap to recipe coordinate.
4. Verify stack and board labels match generated metadata and printable PDF/HTML.

### Phase 4 — custom part assembly path

Files likely touched:
- `App.tsx`
- `utils/fabrication.ts`
- `tests/browser/workflow.spec.ts`

Tasks:
1. Keep custom SVG/PDF/STL exports in Blueprint/package generation.
2. In Assembly, show custom export tray and then the same module assembly steps.
3. Browser test both modes:
   - prefab-board exposes guide/PDF and board mount,
   - custom-parts exposes SVG/PDF/STL and no fake board mount.

### Phase 5 — full regression

Run:

```bash
bunx tsc --noEmit
bun run test:contracts
bun run build
PLAYWRIGHT_SERVER=preview bunx playwright test tests/browser/workflow.spec.ts -g "Assembly|Blueprint|fabrication|package"
```

For final release, run full browser suite with no test time limit.

## Acceptance criteria

- Assembly is step-by-step and interactive, not a document iframe.
- Mechanism is assembled before board mounting.
- Kit board mode uses the 15x15 board and real recipe coordinate.
- Custom mode exposes SVG/PDF/STL and does not pretend a kit board exists.
- Stack order visibly includes spacers and clips.
- Step cards show active part, ghost target, highlighted holes, z-layer, and check.
- Printable guide still exists as export/print action.
- Unsupported mechanism types are blocked; no fake assembly guide.
- Blueprint and Assembly share the same `FabricationRecipe` data.
- Browser tests prove package generation, step navigation, board mount, and custom export lane.

## Dependency decision

No new dependency for the first implementation.

Already installed and enough:
- React for stepper UI,
- Three/Rapier for richer 3D/physics views if reused later,
- existing fabrication/coordinate/physics utilities.

Add a library only if a concrete implementation step proves the existing renderer cannot animate exploded stack placement smoothly.

## Deferred on purpose

- New `.lic` export format. The current need is `.lic-like` behavior, not a file format.
- Separate workspace/package split. Do it only after Assembly playback has a second real consumer.
- Full physics solver inside Assembly. Assembly should reuse canonical mechanism simulation and physics sidecars, not become another engine.

# Assembly Stepper Plan — .lic-style build simulation

Status: superseded by `docs/prd/assembly-step-player-redesign-plan.md`
Scope: historical planning provenance for Assembly, Blueprint handoff, fabrication kit/custom export handoff
Principle: show build, not explain with paragraphs.

## Agent review summary

- `explore`: current flow has `FabricationRecipe`, package gen, 15x15 board settings, Assembly tab, printable HTML/PDF guide, browser tests. Missing: interactive step player; no `.lic` artifact today.
- `designer`: Assembly becomes .lic/LEGO-like build sim. Blueprint owns files; Assembly owns how to build. Assemble mechanism module first, then mount to board/custom base.
- `architect`: keep single-package. Build Assembly as derived read-only adapter over existing recipe/fabrication data. No second solver/exporter.

## Non-negotiable workflow

Every assembly recipe follow this order:

1. **Prepare parts**
   - Kit mode: show required prefab parts + hardware.
   - Custom mode: show SVG/PDF/STL cut/print outputs first.
2. **Assemble mechanism module first**
   - Neutral bench view.
   - No 15x15 board yet unless step physically pins to board.
   - Stack order bottom-to-top: board/clip/spacer/linkage/gear/spacer/clip.
3. **Mount to board or base**
   - Kit mode: reveal 15x15 board, snap completed module to recipe coordinate.
   - Custom mode: mount to custom base if exists, else standalone.
4. **Connect to character**
   - Highlight output joint, target body part, path.
5. **Test motion**
   - Play/scrub mechanism motion.
   - Show collision, binding, missing spacer, off-grid warnings near affected part.

## Tab ownership

### Blueprint tab

Purpose: "Can I make the files?"

Owns:
- validation blockers,
- package gen,
- export lanes,
- 2D cut sheet preview,
- JSON/SVG/PDF/STL/metadata downloads.

Must not own:
- step-by-step assembly UI,
- long guide text in center canvas,
- interactive build sim.

### Assembly tab

Purpose: "How do I build it?"

Owns:
- recipe selector,
- mode switch: `Kit board` / `Custom parts`,
- one-step-at-a-time player,
- exploded stack sim,
- 15x15 board mount animation,
- printable guide export action.

Center canvas show only build sim. Printable guide stay downloadable/printable, not default center content.

### Options tab

Purpose: global fabrication defaults.

Owns:
- export mode default: `custom-parts` / `prefab-board` / `both`,
- board profile, default 15x15,
- grid pitch, hole diameter,
- default cut-sheet format.

## Data contract

Keep `FabricationRecipe` as export contract. Derive playback state from it, no mutate `ProjectState`.

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

Source fields to reuse:
- `FabricationRecipe.assemblySteps[]`,
- `coords`, `coordRoles`, `stack`, `check`,
- `requiredParts`, `boardCoordinate`, `warnings`,
- `sceneProjection` for exploded/camera view,
- `physicsSession` for forces/constraints where relevant.

Don't store `AssemblyPlaybackStep[]` in project state. Pure derived view.

## Visual behavior

### Step player

Controls:
- Previous,
- Next,
- Play/Pause,
- Reset,
- scrubber.

Visual states:
- previous parts: assembled, muted,
- active parts: saturated/highlighted,
- next target: translucent ghost,
- active holes: pulsing ring,
- spacers: visible z-gap cylinders/rings,
- clips/pins: visibly separate parts,
- board coordinate: small chip near hole.

Text budget per step:
- one short label,
- coordinate chips,
- part chips,
- warning chip if needed.

Long instructions → tooltip/printable guide only.

### Kit board lane

- 15x15 board hidden during pure module assembly.
- Reveal board when first board-pinned step appears.
- Mount animation snaps module to `recipe.boardCoordinate`.
- Board holes use canonical kit rules: 15x15, 20 mm pitch, 4 mm hole.
- Coordinate role decides truth:
  - `board` = fixed/pinned to board,
  - moving roles = location hints only, must not show as board-pinned.

### Custom parts lane

- Show export tray first: SVG, PDF, STL.
- Show printed/cut parts as tray.
- Use same stack + z-order as kit mode.
- If no board/base configured, final assembled module stay standalone.

## Implementation phases

### Phase 1 — contract lock

Files likely touched:
- `types.ts`
- `utils/fabrication.ts`
- `tests/project-contract.test.ts`
- `docs/mechanism-reference/05-assembly-process-guides.md`

Tasks:
1. Add pure playback builder only if `FabricationRecipe.assemblySteps` too thin for UI.
2. Keep recipe data sourced from `utils/mechanismReference.ts` and `fabrication/assembly/recipes.json` if present.
3. Add contract checks:
   - reference recipe steps have action/coords/coordRoles/stack/check where expected,
   - playback derivation no mutate `ProjectState`,
   - board coordinate round-trip stay stable.

### Phase 2 — replace Assembly center iframe

Files likely touched:
- `App.tsx`
- Shared assembly/Foundry render seams only; do not revive deleted `components/Canvas.tsx`
- optional small component file if `App.tsx` harder to read

Tasks:
1. Keep printable guide generation.
2. Remove iframe as default center view.
3. Add native Assembly stepper view:
   - left: recipe + step list + controls,
   - center: visual build sim,
   - right: current step detail only.
4. Add browser test advancing one recipe step-by-step.

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
4. Verify stack + board labels match generated metadata and printable PDF/HTML.

### Phase 4 — custom part assembly path

Files likely touched:
- `App.tsx`
- `utils/fabrication.ts`
- `tests/browser/workflow.spec.ts`

Tasks:
1. Keep custom SVG/PDF/STL exports in Blueprint/package generation.
2. In Assembly, show custom export tray then same module assembly steps.
3. Browser test both modes:
   - prefab-board exposes guide/PDF + board mount,
   - custom-parts exposes SVG/PDF/STL, no fake board mount.

### Phase 5 — full regression

Run:

```bash
bunx tsc --noEmit
bun run test:contracts
bun run build
PLAYWRIGHT_SERVER=preview bunx playwright test tests/browser/workflow.spec.ts -g "Assembly|Blueprint|fabrication|package"
```

For final release, run full browser suite, no test time limit.

## Acceptance criteria

- Assembly step-by-step + interactive, not document iframe.
- Mechanism assembled before board mount.
- Kit board mode use 15x15 board + real recipe coordinate.
- Custom mode exposes SVG/PDF/STL, no fake kit board.
- Stack order visibly include spacers + clips.
- Step cards show active part, ghost target, highlighted holes, z-layer, check.
- Printable guide still exist as export/print action.
- Unsupported mechanism types blocked; no fake assembly guide.
- Blueprint + Assembly share same `FabricationRecipe` data.
- Browser tests prove package generation, step navigation, board mount, custom export lane.

## Dependency decision

No new dependency for first implementation.

Installed + enough:
- React for stepper UI,
- Three/Rapier for richer 3D/physics views if reused later,
- existing fabrication/coordinate/physics utilities.

Add library only if concrete implementation step proves existing renderer can't animate exploded stack placement smoothly.

## Deferred on purpose

- New `.lic` export format. Current need is `.lic-like` behavior, not file format.
- Separate workspace/package split. Only after Assembly playback has second real consumer.
- Full physics solver inside Assembly. Assembly reuse canonical mechanism simulation + physics sidecars, not another engine.
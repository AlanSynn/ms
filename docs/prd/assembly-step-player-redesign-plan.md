# Assembly Step Player Redesign Plan

Status: active implementation plan  
Date: 2026-07-02  
Scope: Assembly tab, Blueprint handoff, fabrication recipe playback, character mount steps  
Canonical override: `foundry-assembly-ssot-plan.md` is the stricter Foundry/Design/Assembly SSOT for mechanism visuals, `MechanismSceneContract`, `AssemblySceneFrame`, and z-only `explode_z`. This PRD remains the Assembly UX execution plan.

## 2026-07-05 implementation cutover note

The current implementation no longer uses the lower SVG workbench or nested character ghost as scene authority. `AssemblySceneFrame` is a pure frame model and `AssemblyThreePreview` passes it into `ThreeFoundryPreview`; the shared Three renderer consumes the frame for layer focus, board markers, floating references, z guides, mount/connect travel, and scrub-path telemetry. Historical references below to ghost targets mean reference/target affordances only, not a second SVG simulation truth.

Legacy motion names in current code/tests (`place-part`, `stack-layer`, `snap-to-board`, `move-to-board`, `connect-character`, `play-test`, `test-motion`) are migration aliases only; new contracts use `none`, `explode_z`, `mount_travel_xy`, `connect_travel_xy`, and `scrub_time`.

Decision: opacity tweaks are insufficient. Assembly must be rebuilt as a step-local visual build player.

## Why the current approach fails

The current Assembly screen is not mainly a contrast problem. It shows too many unrelated things at once, so users cannot tell which part to pick up, where to put it, or why the board is visible.

Observed failure modes:

- A full or nearly full board remains visible during steps that only assemble a mechanism module.
- A broad parts tray shows recipe inventory instead of the parts needed for the current step.
- Prior, current, and future geometry are mixed in one flat SVG scene.
- Moving mechanism reference points can read like board holes.
- Character assembly and mechanism assembly use separate visual grammars.
- Printable guide concepts leak into the live Assembly canvas.
- Step labels describe the process, but the picture does not make the next action obvious.

## Product principle

One step shows one build action.

The Assembly center canvas must answer this question without reading a paragraph:

> What part do I add now, and where does it go?

Everything else is hidden, muted, or moved to the inspector.

## Agent review synthesis

### Designer review

The Assembly view should behave like a LEGO or .lic-style web build player, not a document preview. Each phase needs a different visibility policy:

- Prepare: show only the required parts or export outputs.
- Build module: show the bench, completed local stack, active part, and ghost target.
- Board mount: reveal only the needed board area and active holes.
- Character connection: show the real target body part, anchor, path, and output connector.
- Test: show the assembled mechanism, character target, motion trace, and warnings.

### Architect review

Assembly needs a pure derived scene model instead of stage-local drawing rules.

Canonical sources stay unchanged:

- `ProjectState` for the live document.
- `utils/mechanismReference.ts` for mechanism topology and recipe intent.
- `utils/fabrication.ts` for parts, stack order, board coordinates, and export data.
- `utils/assemblyPlayback.ts` for time/step sequencing.

New seam:

- `utils/assemblyScene.ts` builds a render-ready frame from the canonical recipe and playback state.

Stage components render the frame; they do not invent stack order, board holes, or part visibility.

### Test review

The new behavior must be testable from DOM attributes and pure domain output:

- active part ids,
- muted part ids,
- ghost part ids,
- board visibility mode,
- board coordinates only for board-fixed roles,
- floating reference coordinates separated from board holes,
- current phase,
- current motion kind (`none`, `explode_z`, `mount_travel_xy`, `connect_travel_xy`, or `scrub_time`),
- visible part count.

## Target workflow

### 1. Pick recipe

Left pane:

- recipe cards,
- mode switch: `Kit board` / `Custom parts`,
- step chips.

Center:

- no document preview,
- no full board unless the chosen recipe starts with board-fixed hardware,
- compact empty-state if no recipe exists.

Right pane:

- selected recipe summary,
- blockers only.

### 2. Gather parts

Center shows only the current kit or custom output tray.

Visible:

- active parts for the next physical step,
- quantity badges,
- output file buttons only if the mode is custom parts.

Hidden:

- board grid,
- character,
- full mechanism preview,
- future recipe inventory.

### 3. Build mechanism module

Center shows a neutral bench.

Visible:

- already installed local parts, muted but readable,
- current part, saturated,
- ghost target position,
- z stack lanes when a spacer or clip is involved,
- current pins/clips/spacers.

Hidden:

- full board,
- unrelated board holes,
- character,
- future links/gears/cams.

Rule: board remains hidden unless the active step has a board-fixed role.

### 4. Mount module to board or base

Center reveals the board only for the relevant area.

Visible:

- completed module,
- active board holes,
- row/column callouts,
- snap path from module bench position to board position,
- hardware needed for the mount.

Hidden:

- all inactive board holes unless zoomed out for context,
- future character connection steps,
- printable guide panels.

### 5. Attach character

Center shows the completed mechanism plus the real character target.

Visible:

- output end-effector,
- target body part surface,
- anchor/pin stack,
- drawn path and fitted mechanism trace,
- one connector action.

Hidden:

- unused character parts,
- unrelated mechanisms,
- full recipe inventory.

### 6. Test motion

Center switches from build to test.

Visible:

- assembled mechanism,
- connected body part or character subset,
- playback trace,
- compact warning overlays near the faulty object.

Hidden:

- step stack cards,
- gather-parts inventory,
- long guide text.

## Visibility model

Every step frame must produce this data:

```ts
type AssemblyBoardMode = 'hidden' | 'context' | 'active';

type AssemblyScenePhase =
  | 'choose-recipe'
  | 'gather-parts'
  | 'build-module'
  | 'board-mount'
  | 'attach-character'
  | 'test-motion'
  | 'character-fixed-pins'
  | 'character-free-pivots';

type AssemblyMotionKind = 'none' | 'explode_z' | 'mount_travel_xy' | 'connect_travel_xy' | 'scrub_time';

interface AssemblyVisiblePart {
  id: string;
  label: string;
  role: 'current' | 'installed' | 'ghost' | 'reference';
  partType: 'linkage' | 'gear' | 'cam' | 'follower' | 'spacer' | 'clip' | 'pin' | 'board' | 'character-part' | 'file';
  stackIndex?: number;
  zMm?: number;
}

interface AssemblySceneFrame {
  recipeId: string;
  stepIndex: number;
  phase: AssemblyScenePhase;
  boardMode: AssemblyBoardMode;
  activePartIds: string[];
  mutedPartIds: string[];
  ghostPartIds: string[];
  visibleParts: AssemblyVisiblePart[];
  activeBoardCoords: string[];
  floatingReferenceCoords: string[];
  stack: AssemblyStepStackItem[];
  cameraKey: 'bench' | 'board-close' | 'board-overview' | 'character-connect' | 'test';
  motion: AssemblyMotionKind;
  warning?: string;
}
```

Legacy migration aliases:

| Current/legacy name | New motion kind | Note |
|---|---|---|
| `place-part` | `none` or `connect_travel_xy` | static highlight by default; use travel only for explicit connector/attachment motion |
| `stack-layer` | `explode_z` | z separation only |
| `snap-to-board`, `move-to-board` | `mount_travel_xy` | module/tray moves to board coordinate |
| `connect-character` | `connect_travel_xy` | character/object connector travel |
| `play-test`, `test-motion` | `scrub_time` | mechanism playback/test scrub |

Rules:

- Board coordinates come only from board-fixed coordinate roles.
- Moving references never appear as board holes.
- Future parts do not render in the center canvas.
- The parts tray shows `activePartIds`, not `recipe.requiredParts`.
- The center never renders a printable HTML/PDF document preview.
- The renderer may show muted installed parts, but muted parts must support the current action, not decorate the scene.

## UI layout

### Left pane

- Recipe selector.
- Lane switch: kit board / custom parts.
- Step rail with icons only plus short labels.
- Primary action for the current phase.

### Center canvas

- One step scene.
- Overlay player: previous, play/pause, next, reset, scrubber.
- Optional 2D/3D view toggle after the scene model is stable.
- No scrollable cards, long text, iframe, or document preview.

### Right pane

Selected step facts only:

- active parts,
- stack order,
- board row/column if relevant,
- one blocker/warning,
- optional print/download button.

No general tutorial prose.

## Architecture plan

### Phase A - Contract lock

Files:

- `utils/assemblyPlayback.ts`
- `utils/assemblySceneFrame.ts`
- `utils/mechanismSceneContract.ts`
- `components/stages/assembly/AssemblySceneFrame.tsx`
- `components/stages/assembly/AssemblyThreePreview.tsx`
- `tests/project-contract.test.ts`
- `tests/browser/workflow.spec.ts`

Work:

1. Add `AssemblySceneFrame` builder as a pure function.
2. Add DOM attributes for phase, canonical motion kind, active parts, hidden/context/active board mode, active board coords, floating references, and visible part count.
3. Add contract tests for no board holes from moving references.
4. Add contract test that per-step tray does not use `recipe.requiredParts.slice(...)`.

### Phase B - Replace the current workbench rendering grammar

Files:

- `components/stages/assembly/AssemblySceneFrame.tsx`
- `components/stages/assembly/AssemblyThreePreview.tsx`
- optional small files under `components/stages/assembly/`

Work:

1. Render center build facts from `AssemblySceneFrame` only; Three remains the visual scene truth.
2. Split future Three/read-only render affordances by phase and canonical motion kind: parts tray, module bench, board mount, character attach, test motion.
3. Hide board in gather/build-module frames.
4. Render only active parts plus installed support parts.
5. Do not reintroduce long labels or SVG canvas authority below the Three scene.

### Phase C - Make module assembly physically legible

Files:

- `utils/fabrication.ts`
- `utils/mechanismReference.ts`
- `components/stages/assembly/AssemblySceneFrame.tsx`

Work:

1. Use canonical linkage, gear, spacer, clip, and pin display labels.
2. Use the same z stack order as Foundry and Design.
3. Show `explode_z` lanes only for the current stack action; no x/y travel under `explode_z`.
4. Fail closed if a recipe does not have enough stack data.

### Phase D - Board mount and character attach

Files:

- `utils/assemblyPlayback.ts`
- `utils/assemblySceneFrame.ts`
- `utils/mechanismSceneContract.ts`
- `components/stages/assembly/AssemblySceneFrame.tsx`
- `components/stages/assembly/AssemblyThreePreview.tsx`

Work:

1. Board mount shows only relevant 15x15 board region and active row/column.
2. Character attach uses actual body part, anchor, and mechanism output from `ProjectState`.
3. Character fixed pins and free pivots get separate step phases.
4. Do not draw generic stick figures or fake character connectors.

### Phase E - Export parity

Files:

- `utils/fabrication.ts`
- `components/stages/blueprint/BlueprintExport.tsx`
- `components/stages/assembly/AssemblySceneFrame.tsx`

Work:

1. Blueprint stays the place for downloadable build files.
2. Assembly can export a guide, but the live center remains a web player.
3. Printable guide is generated from the same `AssemblySceneFrame` sequence, not a separate guide grammar.

## Acceptance criteria

- A user can follow Assembly without reading long instructions.
- Each step shows exactly the active action, installed support, and ghost target.
- Board is hidden for gather and pure module build steps.
- Board holes appear only for board-fixed roles.
- Moving references appear as floating callouts, never board holes.
- The current parts tray contains only current-step parts.
- Mechanism module is assembled before board mounting.
- Character connection uses actual character parts and anchors.
- Test motion uses the same mechanism simulation used by Foundry and Design.
- Center canvas never shows a printable document preview.
- Blueprint and Assembly share the same recipe data and export metadata.

## Verification plan

### Contract tests

- `AssemblySceneFrame` is pure and deterministic.
- Every reference recipe can derive at least one build frame, one mount/test frame where applicable, and no invalid board-hole references.
- Per-step visible part count is bounded by the current step plus installed support.
- Moving coordinates remain in `floatingReferenceCoords`.
- Printable guide and live player share the same step count and labels.

### Browser tests

- Open Assembly for a four-bar lesson.
- Verify gather step has no board grid and only active parts.
- Advance to a module step and verify current part/ghost target are visible.
- Advance to mount and verify board appears with one active coordinate callout.
- Advance to attach character and verify character target is visible.
- Scrub/play and verify geometry changes.
- Verify Blueprint preview is separate and Assembly does not render a cut-sheet document.

## Risks and mitigations

- Risk: SVG-only rendering still feels flat.  
  Mitigation: keep the scene-frame model renderer-agnostic so Three can replace the center renderer later without changing recipe logic.

- Risk: reference recipes lack enough stack data.  
  Mitigation: fail closed with a blocker and add the missing stack to the mechanism reference before rendering.

- Risk: App.tsx grows again.  
  Mitigation: keep Assembly scene derivation in `utils/assemblyScene.ts` and phase renderers under `components/stages/assembly/`.

- Risk: Blueprint and Assembly drift.  
  Mitigation: generate exports and player frames from the same recipe ids and step descriptors.

## Not in scope

- New backend, user accounts, cloud saving, or analytics.
- New `.lic` file format.
- A second physics engine.
- A separate package split before the scene-frame seam has real consumers.

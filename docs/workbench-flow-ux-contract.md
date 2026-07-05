# Workbench Flow + UX Contract

Status: active contract
Last refreshed: 2026-07-05
Scope: tabs, panes, buttons, tooltips, and classroom workflow surfaces.

This is the compact UX contract for the current MotionSmith workbench. It does not replace `AGENTS.md`, `DESIGN.md`, `docs/subsystem-governance-and-mechanism-contracts.md`, or mechanism-specific PRDs. It names how those rules show up in the app shell.

## Source order

1. `AGENTS.md` and `DESIGN.md` define product direction and runtime copy policy.
2. `docs/subsystem-governance-and-mechanism-contracts.md` defines ProjectState, pane ownership, and mechanism subsystem boundaries.
3. `docs/prd/foundry-assembly-ssot-plan.md` defines the active Foundry/Design/Assembly mechanism visual contract.
4. This file is the stage-level UX checklist and drift ledger.

## Global flow contract

Default classroom path:

```text
Getting Started -> Character -> Path -> Foundry -> Design -> Blueprint -> Assembly -> Test / Reflect
```

Rules:

- Start from a working template or explicit import; blank/open exploration stays secondary.
- Creation/import happens in Character only: character files, image segmentation, starter rigs, scene objects, rig/body-part edits.
- Later tabs select, move, fit, tune, export, or assemble existing project data; they do not create new character/object sources.
- `ProjectState` is the authoring truth. UI panes, camera, hover, playback, tooltip, and selection are session state.
- Foundry/fabrication helpers are the mechanism visual/physical truth. Design and Assembly consume that truth.
- Blueprint owns files. Assembly owns build steps.
- Tooltips must use `utils/contextHelp.ts` + `ContextHelp`; no layout-shifting inline help.

## Pane contract

| Region | Owns | Must not own |
|---|---|---|
| Left pane | Next action, stage list, object/mechanism/recipe selection, blockers, recovery | selected numeric tuning, long lessons, canvas previews |
| Center canvas | Shared work surface, direct handles, character/path/mechanism/board/assembly visuals, compact HUD/player | galleries, forms, scrollable text, document/manual panels |
| Right inspector | Selected-item details, numeric params, toggles, binding, material/detail, warnings | primary navigation, starter gallery, broad recommendations |
| HUD/player | play/scrub/reset, view presets, zoom/orbit, compact overlay toggles | large panels, prose, duplicate workflow controls |
| Bottom/status | short status, blocker, next recovery | tutorials, duplicate command lists |

## Stage contract matrix

| Stage | Left pane | Center canvas | Right inspector | Primary buttons | Help keys | Current gaps to track |
|---|---|---|---|---|---|---|
| Getting Started | Starter tiles and import choices in modal | none; releases to Character | none | Guide, Starter rig, Image, Character file, Open full project | none | Keep result-first; do not add videos/manuals here. |
| Character | Getting Started, Load character file, Add object, Create from image, Open full project, parts/objects, ownership/reset | character/scene-object workbench and selection handles | selected part/object/skeleton inspector | Getting Started, Load character file, Add object, Create from image, Open full project | `character.loadCharacterFile`, `character.loadObjectFile`, `character.createFromImage` | Character is correct creation owner. Keep rig creation here; remove creation controls from later tabs. |
| Path | motion target, Draw/Clear, Open/Closed, Smoothness, Trace/Play/Reset in More | path drawing/editing, character/object target preview, 2D/3D view | selected path/target, IK start/handle, bend | Draw, Clear path, Open, Closed, Trace, Reset | `path.draw`, `path.smoothness`, `path.trace` | Path no longer owns rig creation controls; default path topology stays closed unless explicitly changed. |
| Foundry | target summary, Fit path, Pick anchor, Use mechanism, mechanism templates | Foundry physical preview, user path, mechanism path, camera/layer/play controls | sensemaking first, view controls, opacity/explode, selected mechanism params | Fit path, Pick anchor, Use mechanism | `foundry.fitPath`, `viewer.layers` | Center is dense but acceptable. Mechanism cards must stay front-view Foundry-derived, not separate drawings. |
| Design | mechanism instance list, Trace, Recommend, add/choose mechanism, Blueprint | integrated automata view: mechanism drives character/object target, user path and mech path toggles | selected mechanism binding, visible/enabled, target/path/handle, params, export | Trace, Recommend, Blueprint, SVG/DXF | none yet | Direct mechanism type chips can bypass Foundry-first mental model; prefer Foundry for new mechanism choice, Design for instance tuning. |
| Blueprint | validation blockers, Generate, downloads, recipes, Assembly handoff | board/cut preview only | selected recipe parts, stack, warnings | Generate, PDF/SVG/JSON, Assembly, Guide | `blueprint.boardPreview`, `blueprint.customParts`, `blueprint.prefabKit` | Keep Assembly preview out of Blueprint. Files only. |
| Assembly | Build list, Blueprint, Generate/Print/PDF, Kit/Custom, Mechanism/Character, step list | one contract-driven Three build truth, read-only step strip only, z-only explode | current step, active parts, coordinates, checks, blockers, Edit links | Generate/Print, Kit, Custom, Mechanism, Character, step buttons | `assembly.steps` | `AssemblySceneFrame` drives Three layer focus, board markers, floating refs, and motion guides; keep future Assembly visuals Three-first. |
| Options | settings sections | static preview only | settings controls | setting fields only | `options.devMode`, `options.fabricationExport`, `options.strictChecks` | Large but acceptable; avoid turning Options into a workflow. |

## Flow contracts

These are the required end-to-end UX contracts. Items not fully implemented are called out in the stage matrix or drift ledger, rather than treated as finished behavior.

### 1. Guided classroom start

1. Student opens Getting Started.
2. Student picks Guide/starter/image/character file.
3. App lands on Character.
4. Student edits visible parts/objects and resets if needed.
5. Student moves to Path.

Guardrails:

- Getting Started stays compact.
- Open full project remains secondary.
- “Keep mechanisms” must not reappear in first-run import UI.

### 2. Character and scene object ownership

1. Character imports or creates the main character.
2. Character adds prop/scene-object images, names them, and manages object selection.
3. Path can select body parts or scene objects as motion targets.
4. Foundry/Design can fit mechanisms to those targets.
5. Assembly shows target attachments as real build steps.

Guardrails:

- Add object is Character-only.
- Path/Design/Assembly may select scene objects, not import/create them.
- Scene-object motion is rigid path motion unless explicit IK/body-part data exists.

### 3. Motion path flow

1. Pick body part or scene object.
2. Draw a path by press-drag-release.
3. Drawing mode exits on release.
4. New drawing replaces the old target path.
5. Closed path is default and loops; open path is out-and-back.
6. Move to Foundry.

Guardrails:

- Points preserve pacing but should be throttled enough for fast student drawing.
- Path Editor shows character/object, skeleton, path, and handles only.
- No mechanism geometry in Path.

### 4. Foundry fit flow

1. Foundry shows user path and candidate mechanism path.
2. Student clicks Fit path.
3. Fit snaps to the 15×15 board by default.
4. Linkage choices stay within kit/fabrication sizes.
5. Student uses mechanism.
6. The fitted mechanism instance lands in Design.

Guardrails:

- User path and mechanism path are independently toggleable.
- Mechanism thumbnails must reuse Foundry/front-view preview rules.
- Foundry does not create a separate non-exportable preview mechanism.

### 5. Design automata flow

1. Design shows real character/object plus mechanism in one scene.
2. Mechanism playback moves the target anchor/object, not a ghost overlay.
3. Right inspector edits the selected mechanism instance.
4. Multiple same-kind mechanisms remain separate instances.
5. Student goes to Blueprint when fit is buildable.

Guardrails:

- New mechanism choice should normally route through Foundry fit.
- Design tuning must not invent mechanism geometry or z-stack rules.
- `MechanismSceneContract` is the target shared mechanism visual contract.

### 6. Blueprint flow

1. Blueprint validates the live project.
2. Student generates the package.
3. Student downloads cut/kit files or opens Assembly.

Guardrails:

- Blueprint is printable/export output, not a live build simulation.
- Part names and recipe labels must match Assembly.

### 7. Assembly build flow

1. Pick Mechanism or Character build mode.
2. Pick Kit or Custom when mechanism mode applies.
3. Step through: gather, build module, mount, connect, test.
4. Three scene is the physical truth.
5. Lower strip is read-only progress/callout only.

Guardrails:

- `explode_z` changes z only.
- `mount_travel_xy` and `connect_travel_xy` are the only x/y build travel motions.
- Character assembly uses real parts, art decals, pins, pivots, and anchors.
- Foundry visuals, Blueprint labels, and Assembly parts must agree.

## Tooltip/help contract

- Allowed implementation: `ContextHelp` trigger + portal tooltip + registry copy in `utils/contextHelp.ts`.
- Tooltip must render with `role="tooltip"`, fixed positioning, and no layout shift.
- Help copy must be short and action-linked.
- Raw `title=` is acceptable only for non-essential browser affordance; registry help is required for visible `?` help.

Current required help ids:

```text
character.loadCharacterFile
character.loadObjectFile
character.createFromImage
path.draw
path.smoothness
path.trace
foundry.fitPath
viewer.layers
blueprint.boardPreview
blueprint.customParts
blueprint.prefabKit
assembly.steps
options.devMode
options.fabricationExport
options.strictChecks
```

## Drift ledger

P0 resolved in the 2026-07-05 implementation pass:

- Path creation controls (`Add layer`, `Remove layer`, `New handle`) are removed from Path and live in Character-owned rig editing.
- Assembly no longer keeps a lower SVG workbench or nested character ghost context; the center uses one Three preview plus `AssemblySceneFrame` read-only callouts.
- `AssemblySceneFrame` is threaded into the Foundry Three renderer for Assembly: current stack layers are highlighted/dimmed, active board holes render as markers, floating references render separately, and mount/connect/test motion uses the canonical frame motion kind.
- `MechanismSceneContract` and `AssemblySceneFrame` are implemented as harnessable shared seams; future Design/Assembly render paths must consume or extend those seams rather than inventing parallel mechanism visuals.

P1:

- Foundry/Assembly right panes include sensemaking/video blocks. Keep them compact or move/collapse if they compete with selected-item inspector controls.
- Design has no registry help keys; add only when a visible `?` would answer a concrete action question.
- Raw `title=` usage exists in some controls; convert only if user-visible help is needed.

P2:

- Options section anchor navigation may be fragile in a scroll-contained inspector; fix only if tests/user behavior show trouble.

## Verification gates

Docs/static:

```sh
bun run test:contracts
```

Targeted browser gates after UI changes:

```sh
bun run build
PLAYWRIGHT_WORKERS=2 env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test tests/browser/workflow.spec.ts --grep "Workflow tabs keep left workflow"
PLAYWRIGHT_WORKERS=2 env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test tests/browser/workflow.spec.ts --grep "Context help opens compact registry popovers"
PLAYWRIGHT_WORKERS=2 env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test tests/browser/workflow.spec.ts --grep "Right inspector scroll|Every workflow right inspector"
```

Final runtime gate after Foundry/Design/Assembly work:

```sh
npx tsc --noEmit --pretty false
bun run test
bun run build
env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test
git diff --check
```

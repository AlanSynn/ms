# Workbench Flow + UX Contract

Status: active contract
Last refreshed: 2026-08-20
Scope: tabs, panes, buttons, tooltips, and classroom workflow surfaces.

This is the compact UX contract for the current MotionSmith workbench. It does not replace `AGENTS.md`, `docs/subsystem-governance-and-mechanism-contracts.md`, or mechanism-specific PRDs. It names how those rules show up in the app shell.

## Source order

1. `AGENTS.md` defines product direction and runtime copy policy.
2. `docs/subsystem-governance-and-mechanism-contracts.md` defines ProjectState, pane ownership, and mechanism subsystem boundaries.
3. `docs/prd/foundry-assembly-ssot-plan.md` defines the active Foundry/Design/Assembly mechanism visual contract.
4. This file is the stage-level UX checklist and drift ledger.

## Global flow contract

Default classroom path:

```text
Getting Started -> Character -> Path -> Foundry -> Design -> Blueprint -> Assembly -> local test / reflect
```

Rules:

- Start from a working template or explicit import; blank/open exploration stays secondary.
- Creation/import happens in Character only: local character files, starter rigs, scene objects, and rig/body-part edits. Image recognition is not shipped.
- Later tabs select, move, fit, tune, export, or assemble existing project data; they do not create new character/object sources.
- `ProjectState` is the authoring truth for durable project data. Current snapshots also carry recovery-compatible selected ids and last-result fields; new work must not add more transient UI state there without a documented migration rule.
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
| Getting Started | Two starter tiles and paired file actions in modal | none; releases to Character | none | Guide, Starter rig; Character file beside Open full project below | none | Keep result-first; do not add videos/manuals here. |
| Character | Getting Started, Load character file, Add object, Open full project, parts/objects, ownership/reset | character/scene-object workbench and selection handles | selected part/object/skeleton inspector | Getting Started, Load character file, Add object, Open full project | `character.loadCharacterFile`, `character.loadObjectFile` | Character is correct creation owner. Keep rig creation here; remove creation controls from later tabs. |
| Path | motion target, Draw/Clear, Open/Closed, Smoothness, Trace/Play/Reset in More | path drawing/editing, character/object target preview, 2D/3D view | selected path/target, IK start/handle, bend | Draw, Clear path, Open, Closed, Trace, Reset | `path.draw`, `path.smoothness`, `path.trace` | Path no longer owns rig creation controls; default path topology stays closed unless explicitly changed. |
| Foundry | target summary, Fit path, Pick anchor, Use mechanism, mechanism templates | Foundry physical preview, user path, mechanism path, camera/layer/play controls | sensemaking first, view controls, opacity/explode, selected mechanism params | Fit path, Pick anchor, Use mechanism | `foundry.fitPath`, `viewer.layers` | Center is dense but acceptable. Mechanism cards must stay front-view Foundry-derived, not separate drawings. |
| Design | mechanism instance list, Trace, Recommend, Blueprint | one Foundry-backed automata scene: mechanism drives character/object target, target/driven/error layers | selected mechanism binding, visible/enabled, target/path/handle, params, export | Trace, Recommend, Blueprint, SVG/DXF | none yet | Keep `buildAutomataSceneModel` + `ThreeFoundryPreview`; do not reintroduce split Foundry/Puppet layers. |
| Blueprint | validation blockers, Generate, downloads, recipes, Assembly handoff | board/cut preview only | selected recipe parts, stack, warnings | Generate, PDF/SVG/JSON, Assembly, Guide | `blueprint.boardPreview`, `blueprint.customParts`, `blueprint.prefabKit` | Keep Assembly preview out of Blueprint. Files only. |
| Assembly | Build list, Blueprint, Generate/Print/PDF, Kit/Custom, Mechanism/Character, step list | one contract-driven Three build truth, read-only step strip only, z-only explode | current step, active parts, coordinates, checks, blockers, Edit links | Generate/Print, Kit, Custom, Mechanism, Character, step buttons | `assembly.steps` | `AssemblySceneFrame` drives Three layer focus, board markers, floating refs, and motion guides; keep future Assembly visuals Three-first. |
| Options | settings sections | static preview only | settings controls | setting fields only | `options.devMode`, `options.fabricationExport`, `options.strictChecks` | Large but acceptable; avoid turning Options into a workflow. |


## Confirmed current implementation inventory

Facts verified from code and tests on 2026-07-05:

- The compact Getting Started dialog exposes only `Guide` and `Starter rig` as primary tiles. It pairs `Character file` beside `Open full project` as secondary actions below. Recognition starters are not shipped.
- The three-pane shell is implemented through `EditorStageFrame` surfaces with `stage-left-pane`, `stage-canvas-pane`, and `stage-right-inspector` browser contracts.
- Character owns source creation: character package load, ordinary scene-object image load, starter entry, rig/body-part edits, and lesson reset.
- Path owns motion target selection, draw/clear, open/closed topology, smoothing, trace import, path visibility/enabled state, and path point editing; it no longer owns rig creation.
- Foundry owns mechanism template choice, 15 x 15 board fit, anchor picking, physical mechanism preview, user/mechanism path overlays, and `Use mechanism` handoff.
- Design owns mechanism instance selection/tuning, trace/recommend/fit, target/path/handle binding, visibility/enabled flags, deletion, and export handoff.
- Blueprint owns local package/cut-sheet generation, board preview, recipe details, downloads, and Assembly handoff.
- Assembly owns mechanism/character build lanes, kit/custom switching, step list, Three-backed build scene, read-only callouts, print/PDF, and final motion checks.
- Registry-backed visible help ids match `utils/contextHelp.ts`; `ContextHelp` renders a portal tooltip with fixed positioning and no layout shift.
- `utils/mechanismSceneContract.ts`, `utils/foundryPreviewModel.ts`, and `utils/assemblySceneFrame.ts` are harnessable plain-data seams. Design consumes Foundry-style live preview state through `foundryPreviewModel`; Assembly consumes `AssemblySceneFrame` through the shared Foundry Three renderer.
- Classroom content is data-driven through `utils/classroomContent.ts`: assessment keys are slug-normalized, default prompts are local, generated-loop examples are primary, reviewed YouTube no-cookie slots are optional enrichment.
- Browser autosave and workspace layout persistence use MotionSmith storage keys with legacy migration support in `utils/projectPersistence.ts`.

## Button / action ownership ledger

| Action family | Owning stage | Valid outside owner? | Notes |
|---|---|---:|---|
| Load character file, Add object, Rename object, rig/body-part edits | Character | no | Later tabs may select or bind existing targets only. |
| Draw, Clear path, Open/Closed, Smoothness, Trace, Delete point | Path | no | Design/Foundry consume selected paths; they do not draw new ones. |
| Fit path, Pick anchor, Use mechanism, mechanism template selection | Foundry | partly | Design can fit/tune existing instances, but primary new mechanism choice should stay Foundry-first. |
| Mechanism target/path/handle binding, param tuning, visibility/enabled, delete, export | Design | yes, for selected instance only | Must not invent private geometry, stack, z, pin, or fabrication rules. |
| Generate package, board/cut downloads, metadata/export artifacts | Blueprint | no | Assembly may print/read guide, not own file package semantics. |
| Kit/Custom, Mechanism/Character, step selection, step playback, Print/PDF | Assembly | no | The center scene is build truth; lower strip/callouts are read-only. |
| Theme, autosave, physics, fabrication mode, debug/strict checks | Options | no | Settings only; not a workflow or tutorial surface. |

## Tooltip/help coverage ledger

| Surface | Required registry help | Current coverage | Risk |
|---|---|---|---|
| Character import | `character.loadCharacterFile`, `character.loadObjectFile` | covered | low |
| Path draw/smooth/trace | `path.draw`, `path.smoothness`, `path.trace` | covered | low; one raw IK `title` remains. |
| Foundry fit/layers | `foundry.fitPath`, `viewer.layers` | partially covered | medium; `Pick anchor` is direct manipulation with no registry help yet. |
| Design instance tuning | none required yet | none | medium; `Recommend`, `Fit`, path toggles, and type chips may need help if they remain visible. |
| Blueprint | `blueprint.boardPreview`, `blueprint.customParts`, `blueprint.prefabKit` | covered | low |
| Assembly | `assembly.steps` | covered | medium; dense step/parts panels still need compactness review. |
| Options | `options.devMode`, `options.fabricationExport`, `options.strictChecks` | covered | low; anchor navigation remains a small fragility. |

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
- Foundry draft tuning is ephemeral until `Use mechanism` or another explicit commit writes a real `ProjectState.mechanisms[]` instance. Reload recovery restores committed project state, not every uncommitted Foundry draft knob.

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
- `MechanismSceneContract`, `foundryPreviewModel`, and `AssemblySceneFrame` are implemented as harnessable shared seams; future Design/Assembly render paths must consume or extend those seams rather than inventing parallel mechanism visuals.
- Design now consumes `buildAutomataSceneModel` and renders Foundry mechanism primitives plus driven character/object context inside one `ThreeFoundryPreview` scene/camera; Puppet private mechanism geometry is forbidden for this path.

## Comprehensive risk ledger

Severity means product risk, not current breakage. Facts cite current code/docs; inferences name likely drift to watch.

### P0 / release blockers

None known from this audit. This pass is documentation-only; full browser QA was not re-run for this docs update.

### P1 / high production risks

| Area | Risk | Evidence | Required direction |
|---|---|---|---|
| Foundry renderer debt | Foundry still has stage-local mechanism-type branches for render glue, pin points, z/plane choices, and gear/planetary behavior. | `ThreeFoundryPreview.tsx`, `foundryPreviewStacks.ts`, `docs/prd/foundry-assembly-ssot-plan.md` | Move semantics into shared helpers/contracts; allow only presentation glue in stage code. |
| ProjectState boundary | `ProjectState` currently stores durable authoring data plus selected ids, processing, and last-result/export-adjacent fields. | `types.ts`, `utils/projectPersistence.ts`, `hooks/useMotionSmithAppController.ts` | Classify canonical vs recovery/session fields before moving more state into snapshots. |
| Design camera/context integration | Design now uses one Foundry scene, but this contract must stay locked so future work does not reintroduce a split renderer or private mechanism primitive path. | `DesignFoundryPreview.tsx`, `utils/automataSceneModel.ts`, `components/stages/foundry/ThreeFoundryPreview.tsx` | Keep Design/Assembly consuming `buildAutomataSceneModel` + Foundry primitive layers; do not add private mechanism primitives. |
| Design mental model | Direct mechanism chips in Design can bypass Foundry-first selection/fit. | `DesignWorkflowPanel.tsx` creates mechanisms from chips. | Prefer Foundry for new mechanism choice; keep Design as instance tuning, or explicitly redesign/document the bypass. |
| Shared viewport | Preserved viewport across Path/Design/Blueprint is wanted; Design currently owns local view state and Blueprint has static SVG preview. | `DesignFoundryPreview.tsx`, `BlueprintExport.tsx` | Either thread shared viewport through all workbench tabs or narrow the contract to the implemented surfaces. |
| Mechanism parity testing | Foundry, Design, and Assembly do not yet have an exact browser parity assertion for same mechanism id/type/layers/z/labels/validation. | `tests/browser/workflow.spec.ts` has broad coverage but no exact cross-tab equality gate. | Add Foundry -> Design -> Assembly parity test before the next renderer refactor. |
| Path purity testing | Path hides mechanisms in code, but browser coverage should prove no mechanism geometry/pins/overlays after a mechanism exists. | `PathCanvasPane.tsx` passes `mechanisms={[]}`; test gap from audit. | Add a regression after applying a mechanism and returning to Path. |
| Assembly z-only explode | `AssemblySceneFrame` names `explode_z`, but direct x/y invariance over progress is not fully locked. | `utils/assemblySceneFrame.ts`, Foundry overlay frame motion. | Add pure and browser tests that x/y stay unchanged for z-only explode. |
| Assembly character no-mechanism fallback | Character art/pin Assembly now uses the Foundry preview when an active mechanism exists, but a blank no-mechanism project can only show a blocker. | `AssemblyThreePreview.tsx`, `ThreeFoundryPreview.tsx`, `AssemblySceneFrame.tsx` | Do not invent a fake mechanism. Keep the blocker honest, or require a lesson/mechanism before 3D build simulation. |
| Assembly realism | Assembly is now Three-first for mechanism steps, but full Lego-like clarity for character art, fasteners, spacers, board holes, and final motion remains a polish/coverage risk. | `AssemblyCanvasPane.tsx`, `AssemblyInspectorPanel.tsx`, `AssemblySceneFrame.tsx` | Keep enriching `AssemblySceneFrame`; do not reintroduce lower SVG/ghost truth. |
| Blueprint/Assembly labels | Labels mostly share fabrication helpers, but all mechanism-family label parity is not exhaustively tested. | `fabricationPartDisplayLabel`, `readableFabricationStackSummary`, browser tests. | Add all-mechanism contract parity for recipe labels, cut labels, and assembly labels. |
| Multi-object workflows | Scene-object path and mechanism support exists, but multi-object/multi-mechanism classroom reload flow is weakly covered. | `ProjectMotionPath.sceneObjectId`, `DesignInspectorPanel`, tests cover limited cases. | Add two-object, two-path, two-mechanism browser flow with autosave reload. |
| CI/release gate | Release deploy builds only; tests are not enforced there. | `.github/workflows/deploy.yml`, test-engineer audit. | Add release smoke gate before tag deploy or document manual release gate as mandatory. |

### P2 / medium UX and maintainability risks

| Area | Risk | Evidence | Required direction |
|---|---|---|---|
| Foundry/Assembly density | Sensemaking, assessment, generated-loop/example, parts, and current-step blocks can compete with the right inspector. | `FoundryInspectorPanel.tsx`, `AssemblyInspectorPanel.tsx` | Keep sensemaking clickable/collapsible and preserve selected-item controls above deep detail. |
| Blueprint sensemaking | Blueprint contains classroom sensemaking even though Blueprint should primarily own files and printable output. | `BlueprintDetailPanel.tsx`, `BlueprintControlPanel.tsx` | Keep only build-file-relevant cues or move reflective prompts to Assembly/teacher pack. |
| Options density | Options can become a settings manual rather than compact setting names. | `Options.tsx`, `OptionsSettingsControls.tsx` | Keep explanatory copy inside help or docs; preserve settings-only role. |
| Tooltip consistency | Some raw `title=` remains on visible controls. | `WorkspacePlayerDock.tsx`, `DesignWorkflowPanel.tsx`, `PathInspectorPanel.tsx`, `OptionsSettingsControls.tsx` | Convert only essential user-facing help to `ContextHelp`; leave non-essential browser affordances alone. |
| Foundry Pick anchor help | `Pick anchor` is important but lacks a registry help id. | `FoundryWorkflowPanel.tsx` | Add `foundry.pickAnchor` only if the visible `?` answers a concrete action question. |
| Design help gap | Design has no registry help ids for `Recommend`, `Fit`, `Trace`, `User path`, `Mech path`, or type chips. | `DesignWorkflowPanel.tsx`, `DesignFoundryPreview.tsx` | Add minimal help after resolving Foundry-first vs direct-chip policy. |
| Make-it-yours cluster | Character ownership cluster lacks explicit path/mechanism-fit cues required by the project contract. | `CharacterLessonOwnership.tsx`, `AGENTS.md` | Add compact path/fit/reset cues without making Character a tutorial panel. |
| Getting Started priority | Guide is one equal tile, not visually dominant. | `GettingStartedDialog.tsx` | Acceptable now; revisit if classroom testing shows students choose blank/import first. |
| Playback model | Shared dock and Foundry-specific chrome both exist. | `WorkspacePlayerDock.tsx`, `FoundryCanvasPane.tsx` | Keep if clear; unify only if students misunderstand play/scrub ownership. |
| Assessment extensibility | Assessment keys are local slug bundles; future server or multilingual bundles need a versioned source boundary. | `utils/classroomContent.ts` | Keep key normalization; add import/source contract before any remote or multilingual content. |
| Optional video slots | YouTube no-cookie embeds are optional reviewed enrichment; they must never be required for classroom flow. | `ClassroomExampleVideo.tsx`, `utils/classroomContent.ts` | Keep generated-loop fallback as primary and document optional network dependency. |
| Accessibility | Canvas-heavy 3D interactions and portal tooltips need continued keyboard/focus checks. | Browser tests cover some modal/help flows. | Add a11y-focused smoke for tooltip escape, stage nav, step controls, and file actions. |
| Mobile/narrow screens | Startup and basic left-pane ordering are covered, but dense Foundry/Design/Assembly inspectors remain risk. | `workflow.spec.ts` mobile tests. | Add targeted mobile checks after each inspector compaction pass. |
| Performance | Foundry dynamic rebuild throttling is tested; Design/Assembly Three growth can still regress. | Foundry perf assertions in browser tests. | Extend cache/rebuild telemetry to Design/Assembly before large scene growth. |
| PRD status drift | Some PRDs mix active plan, implemented behavior, and remaining risk. | `docs/prd/*` audit. | Keep current contract in this file and docs index; mark PRDs as evidence/remaining-risk ledgers. |
| Workspace restore robustness | Malformed `motionsmith.workspace` JSON is caught at command level but not parsed with a fine-grained ignore path. | `utils/projectPersistence.ts`, `useAppProjectCommands.ts` | Treat workspace restore as best-effort; ignore malformed storage with warnings. |
| Foundry draft persistence | Uncommitted Foundry draft state is local controller state, not autosaved project state. | `useMotionSmithAppController.ts`, `MechanismFoundry.tsx` | Keep explicit: only committed/exported mechanisms are durable unless a draft persistence surface is added. |
| Metadata export schema | `*-metadata.json` is a reduced inspection/export metadata object, not the full project snapshot. | `utils/fabrication.ts`, `docs/mechanism-blueprint-manual.md` | Document intended omissions and do not promise round-trip from metadata-only files. |

### P3 / monitor

- Options anchor links may be fragile inside a scroll-contained inspector; fix only if user behavior or tests show a real issue.
- Raw `title` on the player drag handle is acceptable as a non-essential browser affordance unless it becomes the only visible help.
- Guided-first prominence is acceptable for now because `Guide` opens the guided library and open/import paths remain secondary.

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

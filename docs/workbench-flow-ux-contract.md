# Workbench Flow + UX Contract

Status: active contract
Last refreshed: 2026-09-07
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
Boot -> unseen What's new -> Getting Started (unless suppressed) -> Open Project / new work
Character -> Path -> Foundry -> Design -> Blueprint -> Assembly
Save Project file -> next class -> Open Project file -> keep editing
```

Rules:

- Open Project is the normal classroom return. Guide and Starter rig create new work. Browser backups are secondary explicit recovery candidates; discovering one never chooses it or overwrites it with boot defaults.
- Character owns character/scene-object creation, retained drawing/painting, and physical-outline editing. Full-project Save/Open is available from entry, Project, and shared commands. Image recognition is not shipped.
- Later tabs select, move, fit, tune, export, or assemble existing project data; they do not create new character/object sources.
- `ProjectState` is the authoring truth for durable project data. Current snapshots also carry recovery-compatible selected ids and last-result fields; new work must not add more transient UI state there without a documented migration rule.
- Foundry/fabrication helpers are the mechanism visual/physical truth. Design and Assembly consume that truth.
- Project owns portable project Save/Open. Blueprint owns build/print files. Assembly owns build steps.
- Tooltips must use `utils/contextHelp.ts` + `ContextHelp`; no layout-shifting inline help.
- Top-bar `Find a feature`, `Feedback`, and `What's new` are compact support surfaces. Search and release-note `Show me` share stable control destinations and reveal actions without executing them. Missing prerequisites preserve the project and show the next action.
- Feedback prepares the actual visible app screenshot locally before its panel opens. Only Send publishes the message and included image to public `AlanSynn/ms` issues through one Worker/native GitHub attachments. Closing/removing/capturing uploads nothing. Keep drafts on failure/close; clear after confirmed delivery or explicit discard. Uncertain delivery offers status checking.
- What's new automatically precedes Getting Started for one eligible unseen update. A stable ID is acknowledged only after rendered content is dismissed; it persists outside project/history and Getting Started preferences, with session/memory fallback. Manual reopening returns to the editor. Dialogs never stack or flash beneath the announcement.

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
| Getting Started | Compact creation tiles, full-width Open Project, secondary character/recovery actions | none | none | Guide, Starter rig, Open Project | none | Session suppression with no chosen work shows Project entry; close retains current work. |
| Project | Title, Save/Open, secondary recovery and build/edit navigation | shared live working scene; all visible authored paths, selected highlight, distinct fitted trace | counts and source-specific backup status | Open Project when empty; Save Project with work; Edit paths | none | Reuse Design/Foundry for mechanisms and Path preview without one; no edit handles. |
| Character | Getting Started, Load character file, Draw object, Import object, Open Project, parts/objects, ownership/reset | character/scene-object workbench, Draw & paint, physical-outline handles | selected part/object/skeleton inspector | Draw & paint, Draw object, Import object, Open Project | `character.loadCharacterFile`, `character.loadObjectFile`, `character.drawPaint`, `character.drawObject` | Character owns creation and editing; later tabs consume the same retained art and physical shape. |
| Path | motion target, Draw/Clear, Open/Closed, Smoothness, Trace/Play/Reset in More | path drawing/editing, character/object target preview, 2D/3D view | selected path/target, IK start/handle, bend | Draw, Clear path, Open, Closed, Trace, Reset | `path.draw`, `path.smoothness`, `path.trace` | Path no longer owns rig creation controls; default path topology stays closed unless explicitly changed. |
| Foundry | target summary, Fit path, Pick anchor, Use mechanism, mechanism templates | Foundry physical preview, user path, mechanism path, camera/layer/play controls | sensemaking first, view controls, opacity/explode, selected mechanism params | Fit path, Pick anchor, Use mechanism | `foundry.fitPath`, `viewer.layers` | Center is dense but acceptable. Mechanism cards must stay front-view Foundry-derived, not separate drawings. |
| Design | mechanism instance list, Trace, Recommend, Blueprint | one Foundry-backed automata scene: mechanism drives character/object target, target/driven/error layers | selected mechanism binding, visible/enabled, target/path/handle, params, export | Trace, Recommend, Blueprint, SVG/DXF | none yet | Keep `buildAutomataSceneModel` + `ThreeFoundryPreview`; do not reintroduce split Foundry/Puppet layers. |
| Blueprint | validation blockers, downloads, recipes, Assembly handoff | painted pieces and board/cut preview | selected recipe parts, stack, warnings | Download Build PDF, Character outlines PDF, Cut pieces SVG, Assembly | `blueprint.boardPreview`, `blueprint.customParts`, `blueprint.prefabKit` | Build PDF includes painted physical pieces, mechanism sheets when present, and instructions; piece printing does not require a mechanism. |
| Assembly | Build list, Blueprint, Kit/Custom, Mechanism/Character, step list | one contract-driven Three build truth, read-only step strip only, z-only explode | current step, active parts, coordinates, checks, blockers, Edit links | Blueprint, Kit, Custom, Mechanism, Character, step buttons | `assembly.steps` | `AssemblySceneFrame` drives Three layer focus and placement; character/object steps reuse the shared part renderer without a mechanism. |
| Options | settings sections | static preview only | settings controls | setting fields only | `options.devMode`, `options.fabricationExport`, `options.strictChecks` | Large but acceptable; avoid turning Options into a workflow. |


## Confirmed current implementation inventory

Initial inventory verified on 2026-07-05; Character artwork and Blueprint/Assembly ownership refreshed on 2026-09-07:

- Getting Started keeps compact `Guide` and `Starter rig` tiles, followed by prominent `Open Project`. `Character file` and a validated `Recover browser backup` candidate are secondary. Recognition starters are not shipped.
- The three-pane shell is implemented through `EditorStageFrame` surfaces with `stage-left-pane`, `stage-canvas-pane`, and `stage-right-inspector` browser contracts.
- Character owns source creation: character package load, Import object, Draw object, starter entry, rig/body-part edits, and lesson reset. Draw & paint stores editable commands; Change shape edits only the physical contour.
- Path owns motion target selection, draw/clear, open/closed topology, smoothing, trace import, path visibility/enabled state, and path point editing; it no longer owns rig creation.
- Foundry owns mechanism template choice, 15 x 15 board fit, anchor picking, physical mechanism preview, user/mechanism path overlays, and `Use mechanism` handoff.
- Design owns mechanism instance selection/tuning, trace/recommend/fit, target/path/handle binding, visibility/enabled flags, deletion, and export handoff.
- Blueprint owns local painted package/cut-sheet generation, board preview, recipe details, downloads, and Assembly handoff. Full packets preserve image resources and native physical page sizes.
- Assembly owns mechanism/character build lanes, cuttable-object placement, kit/custom switching, step list, Three-backed build scene, read-only callouts, and final motion checks. Build files remain in Blueprint.
- Registry-backed visible help ids match `utils/contextHelp.ts`; `ContextHelp` renders a portal tooltip with fixed positioning and no layout shift.
- `utils/mechanismSceneContract.ts`, `utils/foundryPreviewModel.ts`, and `utils/assemblySceneFrame.ts` are harnessable plain-data seams. Design consumes Foundry-style live preview state through `foundryPreviewModel`; Assembly consumes `AssemblySceneFrame` through the shared Foundry Three renderer.
- Classroom content is data-driven through `utils/classroomContent.ts`: assessment keys are slug-normalized, default prompts are local, generated-loop examples are primary, reviewed YouTube no-cookie slots are optional enrichment.
- Browser autosave and workspace layout persistence use MotionSmith storage keys with legacy migration support in `utils/projectPersistence.ts`.

## Button / action ownership ledger

| Action family | Owning stage | Valid outside owner? | Notes |
|---|---|---:|---|
| Load character file, Import object, Draw object, Draw & paint, Change shape, rig/body-part edits | Character | no | Later tabs consume the canonical artwork and contour; they may select or bind existing targets. |
| Draw, Clear path, Open/Closed, Smoothness, Trace, Delete point | Path | no | Design/Foundry consume selected paths; they do not draw new ones. |
| Fit path, Pick anchor, Use mechanism, mechanism template selection | Foundry | partly | Design can fit/tune existing instances, but primary new mechanism choice should stay Foundry-first. |
| Mechanism target/path/handle binding, param tuning, visibility/enabled, delete, export | Design | yes, for selected instance only | Must not invent private geometry, stack, z, pin, or fabrication rules. |
| Download Build PDF, character outlines, cut/kit files, metadata/export artifacts | Blueprint | no | Complete packets and separate fabrication files share the canonical build plan. |
| Kit/Custom, Mechanism/Character, step selection, step playback | Assembly | no | The center scene is build truth; lower strip/callouts are read-only. |
| Theme, autosave, physics, fabrication mode, debug/strict checks | Options | no | Settings only; not a workflow or tutorial surface. |

## Tooltip/help coverage ledger

| Surface | Required registry help | Current coverage | Risk |
|---|---|---|---|
| Character creation and artwork | `character.loadCharacterFile`, `character.loadObjectFile`, `character.drawPaint`, `character.drawObject` | covered | low; search reveals the annotated control without creating or editing a piece. |
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
2. Student picks Guide, Starter rig, or a character file to create work; returning students choose Open Project.
3. App lands on Character.
4. Student edits visible parts/objects and resets if needed.
5. Student moves to Path.

Guardrails:

- Getting Started stays compact.
- Open Project remains prominent, independent of recovery availability. File cancellation and failed validation preserve current work and backup.
- “Keep mechanisms” must not reappear in first-run import UI.

### 2. Character and scene object ownership

1. Character imports or creates the main character.
2. Character uses Draw object for a cuttable piece or Import object for an image, names it, and manages selection.
3. Draw & paint edits retained marks on the selected piece. Change shape edits one outer physical cut contour separately.
4. Path can select body parts or scene objects as motion targets.
5. Foundry/Design can fit mechanisms to those targets.
6. Blueprint prints the same artwork and cut shape; Assembly shows actual attachments and cuttable-object placement.

Guardrails:

- Draw object, Import object, Draw & paint, and Change shape are Character-only.
- Path/Design/Assembly may select scene objects, not import/create them.
- Scene-object motion is rigid path motion unless explicit IK/body-part data exists.
- Paint uses one stable owner-local frame. Contour edits clip retained art without stretching it. Invalid candidates disable Use and preserve the committed shape; fabrication rejects invalid committed user outlines. Paint and partial erase never cut holes.
- Unattached cuttable props receive cut/place steps without invented pins, holes, or mechanisms. Save Project preserves their editable source for the next class.

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
2. Student chooses Download Build PDF for painted cut sheets, existing mechanism drawings, and assembly instructions.
3. Student optionally downloads Character outlines PDF or Cut pieces SVG, or opens Assembly.

Guardrails:

- Blueprint is printable/export output, not a live build simulation.
- Part names and recipe labels must match Assembly.
- Print imagery is regenerated at 300 ppi from retained commands and original embedded raster data. Piece artwork, vector contours, and actual joint holes use the same physical transform. The download never uses viewport pixels.
- The complete packet supports visible character parts and explicitly cuttable objects before a mechanism is fitted. Cut pieces SVG contains physical contours and actual holes only.

### 7. Assembly build flow

1. Pick Mechanism or Character build mode.
2. Pick Kit or Custom when mechanism mode applies.
3. Step through: gather, build module, mount, connect, test.
4. Three scene is the physical truth.
5. Lower strip is read-only progress/callout only.

Guardrails:

- `explode_z` changes z only.
- `mount_travel_xy` and `connect_travel_xy` are the only x/y build travel motions.
- Character assembly uses the same retained art, contours, and real pin/pivot plan as Blueprint. Object cut/place steps show the actual object without invented hardware.
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
character.drawPaint
character.drawObject
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
| Assembly without a mechanism | Character/object steps reuse the shared part renderer and canonical assembly frame; mechanism steps still require a real mechanism. | `AssemblyThreePreview.tsx`, `AssemblyLocalPartsPreview.tsx`, `utils/assemblySceneFrame.ts` | Preserve artwork, transforms, real holes, and board visibility through cut/place steps; never fabricate hardware for an unattached prop. |
| Assembly realism | Assembly is now Three-first for mechanism steps, but full Lego-like clarity for character art, fasteners, spacers, board holes, and final motion remains a polish/coverage risk. | `AssemblyCanvasPane.tsx`, `AssemblyInspectorPanel.tsx`, `AssemblySceneFrame.tsx` | Keep enriching `AssemblySceneFrame`; do not reintroduce lower SVG/ghost truth. |
| Blueprint/Assembly labels | Labels mostly share fabrication helpers, but all mechanism-family label parity is not exhaustively tested. | `fabricationPartDisplayLabel`, `readableFabricationStackSummary`, browser tests. | Add all-mechanism contract parity for recipe labels, cut labels, and assembly labels. |
| Multiple paths | Independent target paths share one preview timeline; physically independent multiple mechanisms remain outside this classroom mission. | `ProjectMotionPath`, `utils/motion.ts`, path inventory | Verify two targets, conflict reporting, actual arm transforms, explicit binding replacement, and portable file return. |
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

The current classroom-return decision and verification record is [classroom-return-ux.md](classroom-return-ux.md). It owns explicit file authority, recovery write gating, Project view continuity, and multiple-path acceptance evidence.

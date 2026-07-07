# UI Pane + Tab Redesign Plan

Status: archived planning artifact from `$autoresearch`  
Date: 2026-06-25  
Scope: layout/info architecture only; no impl this pass.

## 1. Problem statement

Current editor: right intent — shared canvas, light MotionSmith style, real workflows — but pane roles not strict enough.

Observed from code/docs:

- `README.md`: post-onboarding stages share one workbench shell, not separate apps.
- Canonical split model now: tab switching changes layer visibility and tool context, not separate canvases.
- `App.tsx`: fixed `app-rail`, only broad links/stats; each stage renders own internal grid (canvas + controls).
- Means: left pane underused, center = mixed content panel not pure work surface, right pane carries workflow nav + sensemaking + primary actions + fine params at once.

User correction to honor:

> Left pane underused; right pane tunes selected details only; center = only work surface.

New layout must make pane ownership explicit.

## 2. Visual thesis

Compact Canva-like mechanical editor: left = workflow/storyboard, center = paper-and-machine workbench, right = selected object inspector.

## 3. Pane ownership contract

### Left pane: workflow + selection + sensemaking

Left pane where novices decide **what to work on next**.

Should contain:

- stage-specific workflow steps;
- object lists: parts, paths, mechanism families, mechanisms, export recipes;
- status/blockers + next action;
- explanatory sensemaking cards;
- primary workflow actions: "Draw free path", "Choose mechanism", "Generate package".

Should not contain:

- dense numeric param sliders;
- per-object fine tuning;
- canvas-like previews competing with center;
- duplicate command-bar actions unless stage's next step.

### Center: pure shared work canvas

Center = only work surface.

Should contain:

- persistent sheet/grid/canvas viewport;
- character, skeleton, paths, mechanisms, blueprint overlays;
- direct manipulation handles;
- zoom toolbar + direct manipulation handles/playhead/trace overlays;
- foundry sandbox simulation as canvas layer, not separate card-like content island.
- no canvas lens HUD, renderer sidecar, persistent explanatory callout covering work surface.

Should not contain:

- long text panels;
- param forms;
- scrollable explanation blocks;
- gallery cards;
- export download lists.

### Right pane: inspector / fine adjustment only

Right pane answers: **what selected, how tune?**

Should contain:

- selected item details;
- numeric params;
- toggles/visibility/enabled state;
- anchor/path/target binding for selected item;
- advanced controls + warnings for selected item.

Should not contain:

- primary stage navigation;
- broad mechanism gallery;
- onboarding/template selection;
- assembly recipe lists except selected recipe detail.

### Header + bottom

- Header: global app commands, stage tabs, save/import/export/options.
- Bottom status: current blocker/next action + technical status.
- Player dock: stay floating, tied to center canvas, not obscure right inspector.

## 4. Stage-by-stage target composition

### 4.1 Character Selection / Onboarding

Character Selection may stay full-screen onboarding surface — pre-workbench.

Target layout:

- Left or top section: starter templates + import choices.
- Center: large character/image preview once candidate exists.
- Right: processing/recognition inspector only after image/package loaded.

Keep:

- template-led novice start;
- real ONNX/package/camera/project flows;
- package review before replacing project.

Change later:

- after accepting character, enter standard three-pane workbench.

### 4.2 Path Editor

Primary novice question: "Which body part moves, what path should it follow?"

Left pane:

- selected part card;
- part list grouped by body area;
- path list/status per part;
- big primary button: `Draw free path` / `Stop drawing`;
- path topology: open/closed;
- tracking/import path action;
- next step: `Choose mechanism`.

Center canvas:

- character parts;
- skeleton/bones;
- current + saved paths;
- free drawing interaction;
- path handles + IK preview;
- zoom toolbar + short hint only.

Right inspector:

- selected path point details;
- smoothing/duration;
- selected anchor joint / IK handle;
- bend direction controls;
- selected body part properties: visible, locked, opacity, anchor;
- advanced layer/joint edit controls.

Move from current right/internal panel to left:

- part/path selection;
- draw/clear/track actions;
- novice sensemaking.

Keep on right:

- fold direction, anchor fine tuning, point-level edits.

### 4.3 Mechanism Foundry

Primary novice question: "Which mechanism family makes this path?"

Left pane:

- target summary: body part + path + anchor;
- mechanism family gallery/list;
- type sensemaking: what it does, good for, physical constraint;
- feasibility status + blocker fix;
- primary action: `Use this mechanism`.

Center canvas:

- sandbox simulation only;
- target path overlay;
- mechanism physical template preview;
- optional forces/velocity/trail overlays;
- scrub/play interaction.

Right inspector:

- selected foundry mechanism type;
- preset selector;
- numeric params;
- valid range / output point / angle scrub if these fine-tuning controls;
- display toggles if affect preview detail.

Move from current Foundry right aside to left:

- gallery;
- sensemaking library card;
- target summary;
- export/use primary action.

Keep on right:

- param sliders + detailed simulation toggles.

Important: Foundry should not hide shared player model by becoming separate mini app. Can have own sandbox play state, but visually read as canvas mode.

### 4.4 Mechanism Design

Primary novice question: "How mechanism attached to character?"

Left pane:

- mechanism instance list;
- target part/path binding overview;
- warnings by instance;
- actions: `Get recommendations`, `Add mechanism`, `Go to blueprint`;
- scene layer visibility summary.

Center canvas:

- character + paths + mechanisms attached to parts;
- output traces;
- handles for anchors + parametric edit;
- playback.

Right inspector:

- selected mechanism details;
- visible/enabled;
- target part/path/anchor selectors;
- feasibility;
- all numeric mechanism params;
- fit/delete/export SVG/DXF as selected-object actions.

Move from current right aside to left:

- mechanism instance selector/list;
- mechanism type chips;
- recommendation entry;
- broad library/sensemaking summary.

Keep on right:

- selected mechanism parametric edit + binding details.

### 4.5 Blueprint Export

Primary novice question: "Can I build it?"

Left pane:

- validation status first;
- blocker list with recovery destination;
- recipe list by mechanism;
- primary action: `Generate package`;
- download buttons after package generation.

Center canvas:

- blueprint/cut sheet preview;
- assembly overlay tied to board coordinates;
- selected recipe highlight.

Right inspector:

- selected recipe detail;
- board coordinate;
- required parts;
- warnings;
- assembly steps;
- default export format/fabrication kit summary.

Move from current center/right grid:

- validation + downloads to left;
- recipe cards to left list + right detail;
- canvas stays center only.

### 4.6 Options

Options should be drawer/modal over workbench or settings stage, not pretend canvas workflow.

Left pane:

- options categories: Appearance, Simulation, Performance, Workflow, Fabrication.

Center:

- live preview of current canvas/settings impact, or keep previous canvas dimmed.

Right inspector:

- controls for selected category.

## 5. Proposed implementation milestones

### M1 — Introduce stage layout contract, no visual rewrite yet

Create small data objects/functions, not new framework:

```ts
type PaneRole = 'left' | 'center' | 'right';
type StageLayoutSpec = {
  stage: AppStage;
  leftTitle: string;
  centerLayerPreset: string;
  rightTitle: string;
};
```

Practical code step:

- keep existing React components;
- add reusable `EditorStageFrame` wrapper for post-onboarding stages;
- pass `left`, `center`, `right` render slots;
- move current `app-rail` contents into `left` slot where appropriate;
- keep current CSS tokens.

Acceptance:

- Path/Foundry/Design/Blueprint use same three-pane DOM contract.
- Test IDs exist: `stage-left-pane`, `stage-canvas-pane`, `stage-right-inspector`.
- Center pane never scrolls when right inspector scrolls.

### M2 — Path Editor pane migration

- Left: part/path workflow + draw action.
- Center: existing `SceneSketch` only.
- Right: selected part/path/IK fine controls.

Acceptance:

- browser test proves `Draw free path` in left pane;
- path canvas has no forms or long lists;
- right inspector scroll not move canvas;
- existing free path + IK tests still pass.

### M3 — Foundry pane migration

- Left: mechanism family gallery, sensemaking, target, `Use this mechanism`.
- Center: sandbox simulation only.
- Right: preset/parameters/toggles.

Acceptance:

- browser test loops all mechanism types, sees gallery left, physical preview center, params right;
- Foundry physical template tests stay green;
- no player-dock overlap with right inspector.

### M4 — Mechanism Design pane migration

- Left: instance list + workflow actions.
- Center: shared `ThreeFoundryPreview`/Design adapter only; no deleted legacy Canvas renderer.
- Right: selected mechanism inspector.

Acceptance:

- selecting mechanism in left updates right inspector;
- numeric edits update shared center preview;
- recommendation/fit/export flows still pass.

### M5 — Blueprint/Options pane migration

- Blueprint: validation/download recipe list left, preview center, recipe inspector right.
- Options: category left, preview center, settings right.

Acceptance:

- validation errors navigate to fixing screen;
- package generation/download tests pass;
- options still update canvas labels/default export.

### M6 — Visual compactness pass

Only after structural migration:

- reduce nested cards;
- use section dividers/lists instead of card piles;
- tune pane widths: left 300–340px, right 340–380px, center flexible;
- make right inspector dense but readable;
- keep center canvas dominant.

Acceptance:

- first workbench viewport shows left workflow, full center canvas, right inspector without vertical page scroll;
- mobile collapses left/right into drawers with center first.

## 6. Test plan

Add/adjust Playwright tests:

1. `stage panes keep responsibilities`
   - For Path/Foundry/Design/Blueprint assert left/canvas/right pane test IDs.
   - Assert center canvas pane contains SVG/canvas, not param number inputs.

2. `left pane owns workflow actions`
   - Path: Draw free path in left.
   - Foundry: mechanism family/gallery in left.
   - Design: mechanism instance list in left.
   - Blueprint: Generate package in left.

3. `right inspector owns selected details`
   - Path: smoothing/anchor/bend controls in right.
   - Foundry: param sliders in right.
   - Design: selected mechanism params in right.
   - Blueprint: selected recipe details in right.

4. `center pane is stable work canvas`
   - Scroll right inspector; center bounding box unchanged.
   - Switch stages; viewport zoom persists.
   - Existing free draw, IK, Foundry, Design, Blueprint E2E tests pass.

Contract tests:

- No state model changes needed for M1/M2 unless selected inspector state persisted.
- If new layout preference state added, serialize in `ProjectState` or local workspace layout consistently.

## 7. Risks and non-goals

Risks:

- Moving controls can break selectors in existing tests; update tests to pane roles not visual positions.
- Foundry has separate local animation state; layout should not accidentally merge with global player state unless intentionally designed.
- Blueprint recipe detail selection may need small selected-recipe state; keep local unless export needs it.

Non-goals for this planning pass:

- no Three.js/2.5D rendering rewrite;
- no new dependency;
- no canvas engine unification;
- no pixel-perfect Stitch clone;
- no new mechanism simulation logic.

## 8. Immediate next implementation slice

Start with M1 + M2 only.

Reason: Path Editor clearest user workflow, already has strong browser tests. Small `EditorStageFrame` plus Path migration proves pane contract without touching Foundry/Blueprint complexity first.

Minimum first diff:

- add `EditorStageFrame` component in `App.tsx`;
- replace fixed `app-rail` with stage-aware left pane content for post-onboarding;
- make `PathEditor` return slots or split into `PathLeftWorkflow`, `PathCanvas`, `PathRightInspector` inside same file;
- CSS: `.editor-stage-frame { grid-template-columns: 320px minmax(0, 1fr) 360px; }`;
- Playwright: pane responsibility test for Path.
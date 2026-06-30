# Novice Canva-Style UI Plan

Goal: make MotionSmith feel like a guided design tool, not an engineering console.
The user should understand the next action in 5 seconds: pick a template or
character, draw a free path, choose a mechanism, export a blueprint.

This is not a Canva integration. “Canva-style” means template-first, visual,
low-friction, and reversible. Every template must create real `ProjectState`,
paths, mechanisms, and blueprint output; no mock screens.

## Visual thesis

A calm MotionSmith-style canvas studio: one large working canvas, one blue-violet primary action, plain-language helpers, and advanced controls hidden until needed.

- Reference: `https://alansynn.com/motionsmith/` for the light CHI/project-page palette and restrained editorial spacing.
- Surface: white canvas, `#f7f8fb` soft background, `#e5e8f0` / `#d6dbe8` lines, restrained shadows.
- Accent: `#5a6cff` for the single next action; near-black `#1b1f28` for structure.
- Density: default screen shows only what a novice needs now.
- Advanced data stays available, but behind `details` panels or inspector tabs.

## Content plan

1. **Start from template**: visual template gallery with sample outcomes.
2. **Draw motion**: one selected part, one free path tool, live point count.
3. **Choose mechanism**: recommended mechanism cards with “good for” copy.
4. **Assemble blueprint**: validation, board preview, download package.

## Interaction thesis

- Drag-to-create before numeric editing: free path is the primary input.
- Progressive disclosure: show “why/next” first, show parameters second.
- Reversible edits: clear path, undo-like replace path, disable mechanism,
  return-to-fix links from validation.

## Novice workflow map

```mermaid
flowchart LR
    Gallery[Template gallery] --> Character[Load or accept character]
    Character --> Path[Draw free path]
    Path --> Mechanism[Pick recommended mechanism]
    Mechanism --> Blueprint[Validate + export blueprint]
    Blueprint --> Fix{Issue?}
    Fix -->|path issue| Path
    Fix -->|mechanism issue| Mechanism
    Fix -->|ready| Download[Download package]
```

## Screen contracts

### 1. Template gallery / Character Selection

**Primary novice question:** “What can I make?”

Default layout:

- left: product name and one-line promise;
- center/right: 3-5 large template tiles;
- bottom/secondary: Load package, Run ONNX, Import project.

Template tiles:

| Template | What it teaches | Real data created |
| --- | --- | --- |
| Humanoid starter | full humanoid rig + one ready arm path | 14 body parts, upper/lower limbs, hands/feet, no mechanism until the user chooses one |
| Bobbing head | short cyclic path + cam/piston option | head path, recommended mechanism |
| Walking legs | two paths + duplicated mechanism instances | leg paths, two mechanisms |
| Blank character | user-loaded asset flow | package review, no fake mechanisms |

Rules:

- No template may be a screenshot-only mockup.
- A template is valid only if it can be saved, reopened, animated, and exported.
- Plain character load must clear stale mechanisms unless user chose replacement.

Implementation target:

- Reuse `createSampleProject()` pattern for starter templates.
- Store tiny template metadata in code first; move to JSON only when there are
  enough templates to justify it.
- Keep “Run ONNX” and package loading as secondary actions, not removed.

### 2. Path Editor

**Primary novice question:** “How do I tell this part where to move?”

Default layout:

- big canvas first;
- floating canvas hint: selected part + current point count;
- right panel: `Free path`, part selector, `Draw free path`, `Clear path`,
  `Next: choose mechanism`;
- advanced panels: path timing/tracking and part/skeleton setup.

Required behavior:

- Drawing is hold-and-drag anywhere on the canvas.
- Starting a stroke on an existing point still draws; point handles must not
  intercept draw mode.
- Point editing is available only when draw mode is off.
- Short or missing path warnings use plain language.
- A valid path enables the next action to Mechanism Foundry.

Copy standard:

- Good: “Choose a body part, press Draw free path, then hold and drag.”
- Bad: “Edit motion vectors and timed samples.”

Current status:

- The app already has the novice free-path panel and drag-based drawing.
- Keep improving visual polish, but do not re-expand the default inspector.

### 3. Mechanism Foundry

**Primary novice question:** “Which mechanism should I use?”

Default layout:

- left: animated preview path and selected mechanism sketch;
- right: recommended mechanism cards before raw parameters;
- each mechanism explains: “good for”, “what it does”, “watch out for”.

Recommended cards:

| Card | Novice label | Explanation |
| --- | --- | --- |
| Four-bar linkage | Best first choice | Turns rotation into a limb swing. |
| Cam follower | Bumps and lifts | Good for bobbing head/props. |
| Piston / slider | Push-pull | Good for straight movement. |
| Gear train | Spin transfer | Good for linked rotation, not path drawing. |

Rules:

- Show one recommendation as primary; do not make users compare every parameter.
- Preserve advanced numeric controls, but below the recommendation.
- Export must create one real mechanism instance with stable id and target part/path.

### 4. Mechanism Design

**Primary novice question:** “Is the mechanism attached and moving correctly?”

Default layout:

- canvas: character, path, mechanism, trace;
- right panel top: selected mechanism summary and status;
- then target part/path selectors;
- then advanced parameters.

Required novice affordances:

- show target part and target path in human labels;
- show warning if mechanism is disabled, partial-range, or detached;
- provide “Fit path” as the primary repair action;
- keep duplicate mechanisms distinct by instance id.

### 5. Blueprint Export

**Primary novice question:** “Can I build it?”

Default layout:

- validation status first: Ready / Needs fix;
- board preview second;
- downloads third;
- detailed recipe last.

Required behavior:

- Every warning links back to the screen that fixes it.
- Output is generated from current project state, never canned guide templates.
- Duplicate mechanism types produce separate recipes.
- The default export format follows Options.

## UI component rules

Use fewer components, but make each one obvious.

| Component | Purpose | Avoid |
| --- | --- | --- |
| Template tile | Start from an outcome | dense stats, fake screenshots |
| Primary action button | One next action per screen | multiple competing filled buttons |
| Canvas hint | orientation while working | long help text |
| Recommendation card | plain mechanism sensemaking | raw parameter tables first |
| Advanced panel | hide expert controls | removing expert controls entirely |
| Validation row | explain fix and destination | generic “invalid” errors |

## Copy rules

- Use verbs: Load, Draw, Choose, Fit, Export.
- One sentence per helper block.
- Prefer body-part names over internal ids.
- Mention ids only in advanced/debug contexts.
- Every warning should say what to do next.

Examples:

- “Draw at least 3 points before choosing a mechanism.”
- “This mechanism only has a partial safe rotation; export still works, but the
  valid range is shown.”
- “No path for Head yet. Draw a path or choose another part.”

## Implementation sequence

1. **Lock current novice path behavior**
   - Keep the existing free path e2e tests.
   - Add only missing browser tests before changing UI flows.

2. **Template gallery**
   - Add minimal template metadata: id, title, beginner promise, thumbnail style,
     factory function.
   - Reuse existing sample project factories; do not add a template engine yet.
   - First templates: Humanoid starter and Blank character. Starter templates must not preload mechanisms; mechanisms enter through Foundry or explicit demos.

3. **Path Editor polish**
   - Keep canvas-first layout.
   - Replace technical labels in default view.
   - Make selected part/path status readable without opening advanced panels.
   - Preserve existing advanced skeleton/path controls behind disclosure.

4. **Mechanism recommendation cards**
   - Move mechanism sensemaking above parameter controls.
   - Mark one recommended option for the current path/part.
   - Keep parameters unchanged underneath.

5. **Blueprint repair links**
   - Convert validation rows into “issue + fix screen” actions.
   - Keep existing export package generation untouched.

6. **Visual QA pass**
   - Browser screenshot at 1440x900 and mobile-ish width.
   - Check first screen has one dominant action.
   - Check novice path drawing can be understood without reading docs.

## Tutorial layer PRD

Tutorials must make the existing workbench easier to touch. They must not
become another screen, another canvas, or another source of project truth.

### Agent review synthesis

- `explore`: current tutorial surfaces are `WelcomeDialog`,
  `GettingStartedDialog`, `ShortcutHelpDialog`, `AboutDialog`, and status
  guidance. There is no tutorial `AppStage`, and that should stay true.
- `designer`: the useful novice layer is splash → starter choice → small
  checklist → sparse coach marks.
- `test-engineer`: tests should prove tutorial actions use real controls and
  do not mutate `ProjectState` when only viewing help.

### 1. Splash

**Job:** brand pause only.

- Keep only MotionSmith mark, `Start`, and `Do not show again`.
- If the splash auto-dismisses, it may open Getting Started; it must never skip
  straight into a fake tutorial or fake project.
- Hide choice is local browser preference only.
- No video, tips, template gallery, stats, sample output, or lesson copy.

### 2. Getting Started dialog

**Job:** choose a real starting state.

Use the existing compact modal. Do not make it full-screen.

Primary tiles:

1. `Humanoid` — creates editable humanoid `ProjectState`.
2. `Girl` — tiny-thumbnail starter image that runs the same real import path.
3. `Boy` — tiny-thumbnail starter image that runs the same real import path.
4. `Image` — user image import.
5. `Package` — package import.

Secondary action:

- `Import project` — portable project copy.

Rules:

- Result labels only; no process copy such as loading, browser, ONNX, or rigging.
- Closing always lands on Character.
- Starter tiles create real parts, joints, anchors, and editable contours.
- Starter tiles do not preload fake mechanisms. Mechanisms enter through
  Foundry or an explicit demo template.
- Lesson galleries and preserve-compatible-mechanism toggles stay out of this
  first-run modal.

### 3. First-run checklist

**Job:** show progress without teaching by paragraphs.

Placement: left pane above stage controls. Never center canvas.

Checklist:

1. `Character ready`
2. `Draw 3+ path points`
3. `Use mechanism`
4. `Fit / attach`
5. `Generate blueprint`
6. `Open assembly`

Behavior:

- Each item links to its workflow tab.
- Completion derives from current `ProjectState`.
- Store only dismissed/collapsed state in local storage.
- View-only tutorial state must not change `ProjectState`, `metadata.updatedAt`,
  export data, mechanism data, or fabrication output.
- Expert users can ignore it; it never blocks tools.

### 4. Coach marks and hints

Use three hint channels, in this order:

1. **Left pane next action** — primary instruction, e.g. `Draw free path`.
2. **Status strip** — blocker and next action, e.g. `Need 3+ path points`.
3. **Canvas micro-hint** — one short label only while manipulating, e.g.
   `Hold and drag`.

Allowed coach mark:

- one at a time;
- anchored to a real control, handle, status item, or inspector field;
- auto-dismisses when the user performs the action;
- always has `Skip tips`.

Forbidden:

- tutorial tab;
- full-screen tutorial mode;
- dark spotlight over the work canvas;
- center-canvas lesson cards;
- scrollable lesson panels;
- separate tutorial scene or sample state;
- fake progress, fake AI recommendation, canned mechanism preview, or canned
  export;
- No new tour dependency. Plain React state and CSS are enough.

### Per-tab tutorial beats

| Tab | Question | Beat | Placement |
| --- | --- | --- | --- |
| Character | What am I editing? | Pick/load character, select a body part, confirm joints/anchors. | Left checklist + part list; right part inspector. |
| Path | How do I make it move? | Select part, press `Draw`, hold-drag path, reach 3+ points. | Left controls; tiny canvas hint only in draw mode. |
| Foundry | Which mechanism works? | Show target, recommend one mechanism, preview physical stack, click `Use`. | Left cards; center simulation only; right physics/detail readout. |
| Design | Is it attached? | Play/trace, verify target, use `Fit path` if warned. | Left mechanism list; right target/parameters. |
| Blueprint | Can I build it? | Show Ready/Needs fix, route warnings, generate package. | Left validation/downloads; center cut sheet; right recipe detail. |
| Assembly | How do I put it together? | Pick recipe, step through stack order, print/download guide. | Left recipe/steps; center assembly workbench; right step detail. |
| Options | How do I tune defaults? | Units, export defaults, view toggles only. | Settings groups and exact values. |

### Tutorial acceptance criteria

- A novice can complete starter → select part → draw path → use mechanism →
  blueprint → assembly without reading docs.
- Center pane remains only canvas, viewport, handles, simulation, cut sheet, or
  assembly workbench.
- Checklist is dismissible, non-blocking, and derived from real project state.
- Tutorial actions trigger existing commands/stages; no private duplicate action
  path.
- Opening, advancing, closing, or skipping view-only help does not reset stage,
  viewport, selection, path, mechanism, playback, or serialized project data.
- Browser tests assert tutorial roots are overlay/modal/status guidance and that
  `stage-canvas-pane` remains the work surface.

## Acceptance tests

Browser tests must cover:

- template gallery loads a real starter project;
- blank character/package flow still works;
- free path drag creates points, including when starting over an existing point;
- valid path enables “Next: choose mechanism”;
- mechanism recommendation exports one real instance;
- design screen preserves target part/path;
- blueprint export creates real package files and per-instance recipes;
- validation issues route back to Path Editor or Mechanism Design.

Manual visual checks:

- First-time user can identify the next action in 5 seconds.
- Default screens do not expose raw parameters before the user needs them.
- Advanced users can still reach skeleton, timing, and numeric controls.

## Non-goals

- No cloud template marketplace.
- No Canva API dependency.
- No new design system package.
- No new template DSL until simple code factories become painful.
- No hiding of fabrication/validation errors for the sake of simplicity.

## Done definition

This redesign is done when:

1. a novice can start from template or package, draw a free path, pick a
   mechanism, and export a blueprint without opening advanced panels;
2. all outputs come from real project state;
3. advanced controls still exist behind disclosure;
4. browser tests cover the complete novice path;
5. visual review confirms the UI is calm, clear, and not tool-dense.

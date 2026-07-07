# Canva / Video-Editor Workspace Plan

Status: archived provenance; historical child plan under `platform-rebuild-porting-flow.md`
Scope: MotionSmith behave like persistent in-browser editor: Canva-like creation, video-player-like motion, Figma-like selection/inspector editing.
Non-goal: no mock controls. Every visible control must wire to real `ProjectState`, browser APIs, ONNX, playback, validation, or export.

## Research-backed thesis

MotionSmith = **one persistent mechanical canvas studio**, not form-heavy workflow tabs.

Reference patterns:

- Canva-like editors keep creation approachable: visual side panels, direct selection editing, keyboard shortcuts, autosave/download/share, video timelines for time-based work.
- Figma-like editors center canvas, toolbar tools for edit modes, left/right sidebars for layers/properties, keyboard/zoom for precise in-browser editing.
- Accessible video-player/custom media controls expose play/pause + seek as first-class keyboard-operable sliders.

Useful references:

- Figma toolbar: <https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar>
- Figma right sidebar / properties / export: <https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar>
- Figma zoom and view controls: <https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options>
- WAI-ARIA seek slider pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/slider/examples/slider-seek/>
- WAI-ARIA toolbar pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/>
- MDN `HTMLMediaElement.currentTime`: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime>
- Canva official help URLs kept as product references, local curl blocked by Canva during verification: <https://www.canva.com/help/creating-and-editing-videos/>, <https://www.canva.com/help/edit-element-timing/>, <https://www.canva.com/help/trim-videos/>, <https://www.canva.com/help/save/>, <https://www.canva.com/help/canva-keyboard-shortcuts/>.

## Visual thesis

Calm MotionSmith-style editor: one large white paper/grid canvas, one blue-violet primary action, compact tool rail, right contextual inspector, bottom playback/timeline strip.

- Keep light theme.
- First visible workspace = editor surface, not dashboard.
- One accent color for primary action + playback.
- Expert controls hidden behind advanced sections; don't remove.
- Avoid card mosaics except template/mechanism galleries (cards = interaction).

## Product model

App has 3 products in one editor:

1. **Character authoring** — load, process, edit parts/skeleton.
2. **Motion authoring** — draw paths, preview IK, choose/tune mechanisms.
3. **Fabrication authoring** — validate board placement + export build artifacts.

UI exposes these as workflow, but canvas + project state stay shared.

```text
Start character → Draw path → Explore mechanism → Attach/tune → Build/export
```

## Workspace shell

Target layout:

```text
┌────────────────────────────────────────────────────────────────┐
│ Top command bar: project name, File/View/Edit, save/export      │
├───────────────┬────────────────────────────────┬───────────────┤
│ Workflow rail │ Persistent canvas/sheet         │ Inspector     │
│ Start         │ character, skeleton, paths,     │ selected item │
│ Draw          │ mechanisms, board, handles      │ controls      │
│ Explore       │                                │ warnings/CTA  │
│ Attach        │ Floating tool HUD + zoom        │               │
│ Build         │                                │               │
├───────────────┴────────────────────────────────┴───────────────┤
│ Global timeline/player: play, scrub, reset, speed, valid range  │
├────────────────────────────────────────────────────────────────┤
│ Status: current step · blocker · next action · autosave/export  │
└────────────────────────────────────────────────────────────────┘
```

Rules:

- Stage changes swap tools, layers, inspector content; shouldn't feel like separate pages.
- Viewport, selected item, playback progress, warnings survive stage changes when valid.
- Options become settings drawer/workspace over same editor context, not mental reset.

## Current baseline to reuse, not rebuild

Already implemented + tested flows must be preserved. Move only when extraction reduces `App.tsx` risk or enables shell.

- Command bar/menu actions, quick toolbar, save/import/export, options entry.
- Hoisted canvas viewport + zoom toolbar.
- Options parity controls + settings serialization.
- Character processing controls, ONNX upload/camera/package review, skeleton save, edit bridge.
- Free path drawing, IK handle/anchor/fold controls, open/closed/smoothness.
- Mechanism recommendation sheet, Foundry gallery/toolbar/range/motion point, Design binding.
- Blueprint validation, board preview, recipes, downloads.
- Existing browser tests in `tests/browser/workflow.spec.ts` + contracts in `tests/project-contract.test.ts`.

If milestone mentions one of these, read as **reuse/refactor only**, not "build a second version".

## State contracts

### `PlayerState`

Source of truth: transient app-shell state in `App.tsx` first. Do **not** persist in `ProjectState` unless later needed for saved presentation playback.

```ts
type PlayerState = {
  isPlaying: boolean;
  progress: number; // 0..1 normalized loop progress
  speed: number;    // mirrors project.settings.animationSpeed
  loop: boolean;
};
```

Mapping:

- Existing `angle` = derived value: `angle = progress * Math.PI * 2`.
- Existing animation duration precedence stays: selected mechanism target path duration → selected path duration → `project.settings.animationDurationMs`.
- Scrubber writes `progress`; pauses only when user starts dragging if live scrub causes accidental edits.
- Playback tick increments `progress` by elapsed time / active duration * speed.
- `loop` true → wrap at `1`; false → clamp at `1` + pause.
- Foundry may keep local preview toggles, but playhead read/writes shared `progress` once M1 lands.

### `SelectionState`

Source of truth: transient app-shell selection state bridging existing persisted ids. Persist only existing `selectedPartId`, `selectedPathId`, `selectedMechanismId` through current project actions.

```ts
type SelectionState =
  | { type: 'none' }
  | { type: 'part'; partId: string }
  | { type: 'path'; pathId: string }
  | { type: 'joint'; jointId: string; partId?: string }
  | { type: 'mechanism'; mechanismId: string }
  | { type: 'blueprint-recipe'; mechanismId: string };
```

Precedence:

1. Explicit canvas/object click sets `SelectionState`.
2. Selecting part/path/mechanism via current controls also updates existing project selected ids.
3. Selected object deleted/invalid after import/replacement → fall back to `{ type: 'none' }` + show next-action inspector.
4. Blueprint recipe selection derived from mechanism id in current/pending fabrication package; no new persisted id.
5. Skeleton joint selection transient; joint edits still dispatch existing `update_joint` actions.

Implementation rule: first inspector pass may read existing selected ids + synthesize `SelectionState`; add reducer actions only when direct canvas selection needs them.

## Core interaction model

### 1. Select → inspect → act

Clicking or keyboard-selecting any object chooses one selection type:

| Selection | Inspector shows | Primary action |
| --- | --- | --- |
| Nothing | next step, blockers, quick start actions | continue workflow |
| Body part | name, layer, visibility, lock, anchor joint | draw/edit path |
| Skeleton joint | parent, lock, fold direction, x/y | set anchor/fold |
| Path | open/closed, point count, smoothness, duration, warnings | choose/fit mechanism |
| Mechanism | type, target part/path/anchor, valid range, params | check blueprint |
| Blueprint recipe | board coordinate, required parts, warnings | export/download |

### 2. Canvas first, forms second

Direct manipulation authoritative:

- dragging path point updates path data;
- changing smoothness/open/closed updates visible path immediately;
- binding mechanism updates preview + blueprint recipes;
- future mechanism handles update same numeric params shown in inspector.

### 3. Global player/timeline

One player controls Path IK preview, Foundry simulation, Design preview, Blueprint preview.

Minimum controls:

- Play/Pause
- Reset
- Scrub slider, `0%–100%`
- time/angle readout: `42% · 151° · 1.2s`
- speed
- loop toggle
- valid range display for partial mechanisms

Accessibility:

- scrubber uses ARIA slider semantics;
- Arrow keys step; Home/End jump; Space toggles play when focus on player;
- status updates describe invalid/partial ranges.

## Novice workflow

### Start / Character

Goal: "What can I make or load?"

- Keep template gallery.
- Keep ONNX image processing + camera capture as real browser flows.
- Processing controls stay real: `Process Image`, `Generate Body Parts`, `Save Skeleton`, `Edit Parts / Skeleton / Boxes`.
- CTA after accepted character: **Draw a motion path**.

### Draw / Path

Goal: "How do I tell this part where to move?"

- Select body part.
- Draw free path by hold/drag.
- Show IK preview immediately.
- Show path shape controls: Open/Closed, Smoothness, duration.
- CTA: **Choose a mechanism**.

### Explore / Foundry

Goal: "Which mechanism fits this motion?"

- Mechanism gallery behaves like template browsing.
- Preview playable/scrubbable.
- Show "good for", "constraint", valid range, motion point.
- CTA: **Add to design**.

### Attach / Design

Goal: "Is it attached and moving correctly?"

- Select mechanism instance.
- Assign Character section: part/path/anchor.
- Parametric Edit section: concise core params first.
- Warnings say what to fix.
- CTA: **Export Blueprint**.

### Build / Blueprint

Goal: "Can I fabricate this?"

- Validation first.
- Board preview second.
- Assembly recipe third.
- Downloads last.
- Recovery buttons jump back to fixing surface.

## Architecture plan

Keep current `ProjectState` + reducer-style `applyProjectAction`. Don't introduce route store or duplicate screen-local project copies.

Recommended extraction boundaries, in order:

1. `app-shell/`
   - top command bar, workflow rail, status strip, modal host, global player.
2. `features/character-selection/`
   - template/import/ONNX/camera/review controls.
3. `features/path-editor/`
   - free-draw, `SceneSketch`, part/joint editor.
4. `features/mechanism-foundry/`
   - gallery, simulation preview, export package.
5. `features/mechanism-design/`
   - instance inspector, binding, fit/recommendations.
6. `features/blueprint-export/`
   - validation, recipe preview, download actions.
7. `shared/scene/`
   - canvas, coordinates, motion preview, export geometry.

Ponytail constraint: extract only when reduces `App.tsx` risk or enables editor shell. Don't create abstractions before moving real code.

## Implementation milestones

### M0 — freeze current behavior

Already mostly done.

Acceptance:

- `bun run test`
- `bun run build`
- `bun run test:browser`
- docs/ui-to-web Playwright parity audit has `Missing/renamed: 0`.

### M1 — editor shell and global player

First files: `App.tsx`, shared stage preview adapters, `tests/browser/workflow.spec.ts`; touch `types.ts` only if local `PlayerState` type needs sharing.

Deliverables:

- Add bottom player UI to existing shell; don't replace command bar or stage rail.
- Convert current `angle`/`isPlaying` handling to transient `PlayerState` contract above.
- Path/Foundry/Design/Blueprint read from same normalized `progress` where applicable.

Acceptance:

- Browser test: changing scrubber changes visible IK/mechanism preview.
- Browser test: Path → Design → Blueprint keeps playback progress + viewport.
- Browser test: player keyboard controls work.

### M2 — contextual inspector

First files: `App.tsx`, shared stage preview adapters, `tests/browser/workflow.spec.ts`; touch `utils/project.ts` only for existing selected-id cleanup bugs.

Deliverables:

- Introduce transient `SelectionState` in app shell.
- Start by synthesizing selection from existing `selectedPartId`, `selectedPathId`, `selectedMechanismId`.
- Move only visible controls needed for current selection into inspector; keep advanced panels alive until replaced by tests.
- Empty selection shows current blocker + next CTA.

Acceptance:

- Browser test: selecting part/path/mechanism changes inspector.
- Browser test: selecting joint exposes fold/lock/position controls without persisting new joint selection field.
- Inspector controls mutate real project state + persist through save/reload where underlying state persistent.

### M3 — Canva-like galleries and direct editing

Deliverables:

- Template gallery + mechanism gallery use consistent visual language.
- Mechanism cards browsable/appliable without exposing raw params first.
- Direct canvas tool HUD exposes active tool + key shortcut hints.

Acceptance:

- Browser test: novice flow can complete without opening advanced panels.
- Expert panels still expose numeric params + skeleton edits.

### M4 — polish, accessibility, visual QA

Deliverables:

- Keyboard shortcut overlay.
- ARIA labels/slider semantics for timeline.
- Reduced-motion mode respects app settings or OS preference.
- Screenshot-based visual smoke for desktop + mobile critical flows.

Acceptance:

- Browser accessibility assertions for timeline/player labels.
- Mobile: Draw path action stays visible + bottom player stays usable.

## Do not build yet

Skip until concrete blocker appears:

- full multi-page Canva document model;
- nonlinear multi-track video editor;
- collaboration/comments/presence;
- cloud asset library;
- plugin architecture;
- canvas engine migration to Fabric/Konva/Pixi;
- full same-page segmentation polygon editor if current Path Editor part/skeleton bridge stays enough;
- advanced keyframe/easing editor;
- new state management dependency.

## Test plan

Keep tests focused on behavior, not implementation details.

Headless contracts:

- state migration/serialization;
- coordinate transforms;
- path validation;
- mechanism feasibility;
- fabrication package integrity.

Browser tests:

- novice end-to-end: template → draw path → choose mechanism → attach → blueprint;
- character processing controls route to real workflows;
- path draw/edit/lock/open/closed/smoothness;
- global player controls Path/Foundry/Design/Blueprint preview;
- inspector selection changes + mutates real state;
- viewport + playback persist across stages;
- export downloads reflect actual scene.

## Agent review summary

Designer review:

- Use one persistent mechanical canvas studio.
- Workflow should be Start → Draw → Explore → Attach → Build.
- One global timeline/player is main missing editor affordance.
- Don't build cloud/collaboration/multitrack/keyframe systems yet.

Architect review:

- Current app already close: shared `ProjectState`, stage shell, shared preview adapters, broad browser tests.
- Safest path is extraction, not rewrite.
- Biggest risks: coordinate drift, over-unifying `SceneSketch`, `ThreePuppetPreview`, `ThreeFoundryPreview`, blueprint SVG too early, weakening blueprint validation.

Research review:

- Figma/Canva/browser media references converge on persistent shell, toolbar/inspector, zoom/canvas controls, timeline seek controls, keyboard accessibility, autosave/export separation.
# UI-to-Web Full Implementation Plan

Status: historical implementation plan (superseded by runtime contracts)
Source of truth: derived from `docs/archive/ui/ui-to-web/*`, screenshot bundle, current React app state after baseline commit `14b95f3`.

## Frontend-skill contract

### Visual thesis

Calm MotionSmith/Canva-style mechanical studio: one large persistent paper-and-grid canvas, light editorial shell, single blue-violet action color, novice wording makes next physical step obvious.

### Content plan

1. **Start** — template-first gallery + real import/ONNX/project actions.
2. **Draw** — select one part, draw or track one free motion path, see IK preview + path quality.
3. **Explore** — choose mechanism family in Foundry, scrub it, inspect feasibility/sensemaking.
4. **Attach** — bind mechanism to real part/path/anchor, tune canonical parameters.
5. **Build** — validate scene, generate cut sheets, blueprint data, assembly guide.
6. **Options** — update theme, toolbar, simulation, performance, autosave, grid/physical kit, export defaults without replacing canvas scene.

### Interaction thesis

- Persistent canvas first: stage changes swap panels/layers, not user mental context.
- Progressive disclosure: primary buttons stay visible; engineering params live in advanced/details sections.
- Every visible control must call real project state, file APIs, ONNX, animation, or export code; no inert mock buttons.

## Current baseline after `14b95f3`

Implemented and verified:

- React web app with stages: Character Selection, Path Editor, Mechanism Foundry, Mechanism Design, Blueprint Export, Options.
- Real bundled ONNX pose model loading through `onnxruntime-web`.
- Character package import/review/replacement flow.
- Free path drawing, tracking modal, path validation, IK path preview.
- Mechanism Foundry presets/library/sensemaking + export to Mechanism Design.
- Mechanism Design instance list, target part/path/anchor binding, parameter sliders, path fitting, duplicate binding warnings.
- Blueprint/fabrication validation + package export using actual scene/project state.
- Light MotionSmith-style theme, template gallery, large workspace, browser E2E tests.

Verified before this plan:

- `bun run test`
- `bun run build`
- `bun run test:browser` (10/10)
- `git diff --cached --check`

## Gap map against `docs/archive/ui/ui-to-web`

| Area | Required by docs | Current gap | Implementation decision |
| --- | --- | --- | --- |
| App shell menu | File/View/Edit/Options/Help actions + optional toolbar | Header only exposes Import/Save/Export; no menu mapping | Add compact command bar with real File/View/Edit/Options/Help action groups + status copy. Novice-friendly, not Qt chrome-heavy. |
| Persistent viewport | Tab switching preserves pan/zoom | Viewport/camera state drifts across preview adapters if each remount owns it | Hoist `CanvasViewport`/camera state into `App`, pass to active preview adapters. |
| Canvas zoom toolbar | +/−/fit/reset/1:1 style controls | Mouse wheel exists; panel buttons partial/missing | Add shared `CanvasZoomToolbar` overlay bound to hoisted viewport. |
| Options dialog | Groups: Appearance, Simulation, Performance, Debugging, Workflow, Fabrication, Units | Options page has fewer controls + no modal/drawer framing | Expand `AppSettings` minimally, implement grouped options using real settings. |
| Manual segmentation editor | Add/remove joints/layers, anchors, preview/apply | Full editor not present; current import package covers processed packages only | Add real lightweight in-browser Character Edit drawer backed by `ProjectState`: part add/remove, joint add/remove/lock, anchor assignment, apply immediately. Avoid image-bound polygon tracing until source image editing needed. |
| Character selection dialog | Preset selection + assign character | Template gallery exists but not assignment dialog | Add real template/preset selector metadata for starting projects + mechanism assignment where useful. |
| Recommendation dialog | Modal card grid from path data, apply payload | Foundry + direct add exists; no recommendation modal on Design `Get Mechanism` | Add `Get recommendations` sheet that ranks available mechanism presets from selected path, creates/updates real instance. |
| Foundry editor toolbar | Back, play, forces, velocity, trail, path preview, sensemaking, reset, add | Foundry controls exist but some toggles implicit | Add visible toggles, connect to preview/showTrace/showSensemaking display state. |
| Grid/sheet consistency | 2cm grid + Letter bounds in every canvas mode | Grid/sheet exist in Canvas; need viewport preservation + options propagation tests | Preserve canvas state, add tests for cross-stage grid/viewport. |
| State slices | Canonical project/paths/mechanisms/settings | Mostly in `ProjectState`; missing some UI slices | Keep state inside `ProjectState` where exported; keep transient UI in `App` only. |
| Regression harness | pointer drag, tab switch, dialogs, exports | Existing 10 browser tests; need menu/options/recommendation/viewport tests | Add tests with data-testid/ARIA selectors for each milestone. |

## Milestone commits

### M0 — Baseline stabilization (done)

Commit: `14b95f3 Stabilize the web port before UI parity work`

Acceptance:

- Contracts/build/browser tests pass.
- Prior ONNX/IK/mechanism/fabrication work checkpointed before UI surgery.

### M1 — Plan + UI source bundle

Deliverables:

- Commit `docs/archive/ui/ui-to-web` bundle + this plan.
- Keep large local `docs/archive/ports/to-port-web-onnx` reference mirror uncommitted unless future task explicitly asks to version it.

Acceptance:

- `docs/archive/ui/ui-to-web/IMPLEMENTATION_PLAN.md` names required controls + implementation order.
- Git status separates plan docs from code work.

### M2 — Shell, menus, persistent canvas controls

Deliverables:

- `TopCommandBar` with File/View/Edit/Options/Help groups mapped to real handlers or honest disabled states with status text.
- Optional toolbar still controlled by settings.
- Hoisted `CanvasViewport` state reused across Path, Foundry preview, Design, Blueprint preview adapters.
- Shared zoom toolbar: zoom in/out, fit/center, reset/1:1.

Acceptance:

- Browser test proves tab switch Path → Design → Path preserves zoom/pan.
- Browser test proves File/View/Options commands invoke real import/save/export/options/zoom actions or show disabled reason.

### M3 — Options parity and physical context propagation

Deliverables:

- Expand settings: simulation duration seconds, timing profile labels, performance preset, physics snap mode, debug visuals, detailed processing steps, autosave interval, grid unit, fabrication-ready mode, board pitch, export default.
- Options appears as settings workspace/drawer with Qt-equivalent groups, light/novice copy.
- Grid/physical kit updates invalidate visible labels + blueprint defaults.

Acceptance:

- Browser test toggles toolbar, part panel, debug visuals, autosave interval, export default, grid pitch/profile, sees canvas/status changes.
- `bun run test` validates settings serialization/default migration.

### M4 — Dialog/control parity for novice workflow

Deliverables:

- Character edit drawer: add/remove part layer, add/remove/lock joint, set part anchor from joint, clear selected path/binding if references become invalid.
- Recommendation sheet: ranked mechanism cards from current selected path; Apply creates/updates real `MechanismConfig` with unique id + payload.
- Foundry toolbar toggles: play, forces, velocity, trail, path preview, sensemaking, reset, add.

Acceptance:

- Browser tests cover add/remove skeleton joint + part layer reflecting in Path/Design lists.
- Browser tests cover recommendation Apply creating distinct mechanism + blueprint using it.

### M5 — Blueprint/fabrication UI polish and end-to-end QA

Deliverables:

- Blueprint screen gets persistent canvas/assembly preview + package recipes.
- Assembly guide clearly links each mechanism to board coordinate, target part/path/anchor, warnings.
- Final novice status strip: current step, blocker, next action.

Acceptance:

- Browser E2E covers template → free path draw → recommendation/foundry → mechanism attach → blueprint package/assembly guide download.
- Targeted verification passes; code review/UltraQA run only when explicit or risk-triggered.

## Stop condition

Stop only when UI-to-web bundle controls are either implemented as real working flows or explicitly documented as out-of-scope with technical blocker. Disabled controls acceptable only when honest guards for unavailable local capability, not placeholders.
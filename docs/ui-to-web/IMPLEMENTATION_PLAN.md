# UI-to-Web Full Implementation Plan

Status: active plan for the React/Tauri web rebuild.
Source of truth: this plan is derived from `docs/ui-to-web/*`, the screenshot bundle, and the current React app state after baseline commit `14b95f3`.

## Frontend-skill contract

### Visual thesis

A calm MotionSmith/Canva-style mechanical studio: one large persistent paper-and-grid canvas, a light editorial shell, a single blue-violet action color, and novice wording that makes the next physical step obvious.

### Content plan

1. **Start** — template-first gallery plus real import/ONNX/project actions.
2. **Draw** — select one part, draw or track one free motion path, see IK preview and path quality.
3. **Explore** — choose a mechanism family in Foundry, scrub it, inspect feasibility/sensemaking.
4. **Attach** — bind the mechanism to a real part/path/anchor and tune canonical parameters.
5. **Build** — validate the scene, generate cut sheets, blueprint data, and assembly guide.
6. **Options** — update theme, toolbar, simulation, performance, autosave, grid/physical kit, and export defaults without replacing the canvas scene.

### Interaction thesis

- Persistent canvas first: stage changes swap panels/layers, not user mental context.
- Progressive disclosure: primary buttons stay visible; engineering parameters live in advanced/details sections.
- Every visible control must call real project state, file APIs, ONNX, animation, or export code; no inert mock buttons.

## Current baseline after `14b95f3`

Implemented and verified:

- React web app with stages: Character Selection, Path Editor, Mechanism Foundry, Mechanism Design, Blueprint Export, Options.
- Real bundled ONNX pose model loading through `onnxruntime-web`.
- Character package import/review/replacement flow.
- Free path drawing, tracking modal, path validation, IK path preview.
- Mechanism Foundry presets/library/sensemaking and export to Mechanism Design.
- Mechanism Design instance list, target part/path/anchor binding, parameter sliders, path fitting, duplicate binding warnings.
- Blueprint/fabrication validation and package export using actual scene/project state.
- Light MotionSmith-style theme, template gallery, large workspace, and browser E2E tests.

Verified before this plan:

- `bun run test`
- `bun run build`
- `bun run test:browser` (10/10)
- `git diff --cached --check`

## Gap map against `docs/ui-to-web`

| Area | Required by docs | Current gap | Implementation decision |
| --- | --- | --- | --- |
| App shell menu | File/View/Edit/Options/Help actions + optional toolbar | Header only exposes Import/Save/Export; no menu mapping | Add a compact command bar with real File/View/Edit/Options/Help action groups and status copy. Keep it novice-friendly, not old Qt chrome-heavy. |
| Persistent viewport | Tab switching preserves pan/zoom | `Canvas` owns local zoom/pan per mount; every stage remount loses viewport | Hoist `CanvasViewport` state into `App` and pass to all `Canvas` instances. |
| Canvas zoom toolbar | +/−/fit/reset/1:1 style controls | Mouse wheel exists; panel buttons partial/missing | Add shared `CanvasZoomToolbar` overlay bound to hoisted viewport. |
| Options dialog | Groups: Appearance, Simulation, Performance, Debugging, Workflow, Fabrication, Units | Options page has fewer controls and no modal/drawer framing | Expand `AppSettings` minimally and implement grouped options using real settings. |
| Manual segmentation editor | Add/remove joints/layers, anchors, preview/apply | Full editor not present; current import package covers processed packages only | Add a real lightweight in-browser Character Edit drawer backed by `ProjectState`: part add/remove, joint add/remove/lock, anchor assignment, apply immediately. Avoid image-bound polygon tracing until source image editing is needed. |
| Character selection dialog | Preset selection and assign character | Template gallery exists but not assignment dialog | Add real template/preset selector metadata for starting projects and mechanism assignment where useful. |
| Recommendation dialog | Modal card grid from path data, apply payload | Foundry + direct add exists; no recommendation modal on Design `Get Mechanism` | Add `Get recommendations` sheet that ranks available mechanism presets from selected path and creates/updates a real instance. |
| Foundry editor toolbar | Back, play, forces, velocity, trail, path preview, sensemaking, reset, add | Foundry controls exist but some toggles are implicit | Add visible toggles and connect to preview/showTrace/showSensemaking display state. |
| Grid/sheet consistency | 2cm grid + Letter bounds in every canvas mode | Grid/sheet exist in Canvas; need viewport preservation and options propagation tests | Preserve canvas state and add tests for cross-stage grid/viewport. |
| State slices | Canonical project/paths/mechanisms/settings | Mostly in `ProjectState`; missing some UI slices | Keep state inside `ProjectState` where exported; keep transient UI in `App` only. |
| Regression harness | pointer drag, tab switch, dialogs, exports | Existing 10 browser tests; need menu/options/recommendation/viewport tests | Add tests with data-testid/ARIA selectors for each milestone. |

## Milestone commits

### M0 — Baseline stabilization (done)

Commit: `14b95f3 Stabilize the web port before UI parity work`

Acceptance:

- Contracts/build/browser tests pass.
- Prior ONNX/IK/mechanism/fabrication work is checkpointed before UI surgery.

### M1 — Plan + UI source bundle

Deliverables:

- Commit `docs/ui-to-web` bundle plus this plan.
- Keep large local `docs/to-port-web-onnx` reference mirror uncommitted unless a future task explicitly asks to version it.

Acceptance:

- `docs/ui-to-web/IMPLEMENTATION_PLAN.md` names required controls and implementation order.
- Git status separates plan docs from code work.

### M2 — Shell, menus, persistent canvas controls

Deliverables:

- `TopCommandBar` with File/View/Edit/Options/Help groups mapped to real handlers or honest disabled states with status text.
- Optional toolbar still controlled by settings.
- Hoisted `CanvasViewport` state reused across Path, Foundry preview, Design, and Blueprint preview where a `Canvas` is mounted.
- Shared zoom toolbar: zoom in/out, fit/center, reset/1:1.

Acceptance:

- Browser test proves tab switch Path → Design → Path preserves zoom/pan.
- Browser test proves File/View/Options commands invoke real import/save/export/options/zoom actions or show disabled reason.

### M3 — Options parity and physical context propagation

Deliverables:

- Expand settings: simulation duration seconds, timing profile labels, performance preset, physics snap mode, debug visuals, detailed processing steps, autosave interval, grid unit, fabrication-ready mode, board pitch, export default.
- Options appears as a settings workspace/drawer with Qt-equivalent groups, but light/novice copy.
- Grid/physical kit updates invalidate visible labels and blueprint defaults.

Acceptance:

- Browser test toggles toolbar, part panel, debug visuals, autosave interval, export default, grid pitch/profile, and sees canvas/status changes.
- `bun run test` validates settings serialization/default migration.

### M4 — Dialog/control parity for novice workflow

Deliverables:

- Character edit drawer: add/remove part layer, add/remove/lock joint, set part anchor from joint, clear selected path/binding if references become invalid.
- Recommendation sheet: ranked mechanism cards from current selected path; Apply creates/updates real `MechanismConfig` with unique id and payload.
- Foundry toolbar toggles: play, forces, velocity, trail, path preview, sensemaking, reset, add.
- Camera action: browser `getUserMedia` path with permission/missing-device error; no fake capture.

Acceptance:

- Browser tests cover add/remove skeleton joint and part layer reflecting in Path/Design lists.
- Browser tests cover recommendation Apply creating a distinct mechanism and blueprint using it.
- Camera test can mock permission denied and verify error state.

### M5 — Blueprint/fabrication UI polish and end-to-end QA

Deliverables:

- Blueprint screen gets persistent canvas/assembly preview plus package recipes.
- Assembly guide clearly links each mechanism to board coordinate, target part/path/anchor, and warnings.
- Final novice status strip: current step, blocker, next action.

Acceptance:

- Browser E2E covers template → free path draw → recommendation/foundry → mechanism attach → blueprint package/assembly guide download.
- Code review returns APPROVE/CLEAR and UltraQA browser pass is clean.

## Stop condition

Stop only when the UI-to-web bundle controls are either implemented as real working flows or explicitly documented as out-of-scope with a technical blocker. Disabled controls are acceptable only when they are honest guards for unavailable local capability, not placeholders.

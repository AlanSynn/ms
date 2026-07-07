# UI dead-feature audit

Scope: visible MotionSmith UI/UX controls with no real browser execution, duplicated control adding no behavior, or legacy placeholder post compact editor rebuild.

## Operating rule

Every visible control must do one immediately in browser:

1. mutate `ProjectState` or editor viewport state,
2. open real file/input/modal workflow,
3. run ONNX/tracking/simulation/fit/export code,
4. navigate to implemented stage, or
5. be honest disabled guard with reason visible nearby.

Failing one, remove it — no explanatory copy.

## Screen-by-screen implementation plan and status

| Surface | Required real behavior | Current status / action |
| --- | --- | --- |
| App shell menus | All menu entries resolve through typed command registry + one `App.tsx` handler. | Implemented by `utils/appCommands.ts` + `commandHandlers satisfies Record<AppCommandId, () => void>`. Contract tests compare menu ids to handler ids. |
| Top command bar | File/Edit/View/Go/Options/Help menus execute same registry commands as shortcuts. | Implemented. Keep all new toolbar/menu actions registry-backed. |
| Welcome / Getting Started | Starter, package load, local ONNX image import, project import, "do not show again" must open real workflows. | Implemented. Hardware camera capture still absent. |
| Character | Load package, create from image, accept/discard generated package, part/outline/art/skeleton editing, save skeleton. | Implemented. Copy compacted "placeholder plates" → "gray plates" to avoid placeholder-like wording. |
| Path | Draw/clear path, track video/GIF, play/reset, visibility/enabled state, selected point deletion, target selection, path topology. | Implemented. Rig create/edit controls Character-owned; Path no longer exposes Add layer, Remove layer, or New handle controls. |
| Mechanism Foundry | Mechanism type select, anchor pick, layer toggles, play/reset, params, "Use mechanism" export real mechanism package. | Implemented, covered by existing browser tests. Keep future mechanism buttons backed by `mechanismFeatureRegistry`/fabrication recipes. |
| Mechanism Design | Playback/trace, library insertion, fit-path optimization, recommendation generation, delete, blueprint navigation. | Implemented. Fit/recommendation controls run optimizer/recommendation code — not static cards. |
| Blueprint | Generate fabrication package; download JSON/SVG/PDF/STL/HTML/metadata; preview 2D cut sheet; navigate to assembly. | Implemented. Blueprint stays 2D doc preview; step-by-step assembly lives in Assembly. |
| Assembly | Kit/custom lane choice, recipe cards, step controls, Three build preview, read-only step strip, PDF/HTML guide download. | Implemented. Stepper uses graph-compiled recipes, `AssemblySceneFrame`, Three preview — not static guide, lower SVG workbench, or nested ghost. |
| Options | Theme, toolbar/panel visibility, physics/fabrication/export settings, reset all update real settings. | Implemented. Keep settings compact; avoid "studio/debug" explanatory panels unless tied to real settings. |

## Retired / unnecessary in current browser build

| Feature | Decision | Why |
| --- | --- | --- |
| File → Exit | keep absent | Browser apps can't reliably close own window; fake command adds confusion. |
| Help → Check for Updates | keep absent | No browser/native updater contract. Re-add only with real updater flow. |
| Character → Choose Save Folder | removed | Existing exports use browser downloads. Directory picker won't make current `downloadText` exports write to that folder. |
| Camera capture | already removed | Hardware camera capture out of scope for tinkerable editor flow. |
| Path → Add body part | removed | Duplicated "Add layer" with same handler — UI looked like two different rig-authoring features. |

## Missing execution fixed

| Surface | Before | Now |
| --- | --- | --- |
| Help → About MotionSmith… | status-bar sentence only | opens real modal with product/runtime info + modal shortcut blocking. |
| Path → Add body part | duplicated Add layer | removed; one visible add-layer affordance remains. |

## Enforcement

- `utils/appCommands.ts` is app-shell command registry.
- `App.tsx` keeps `commandHandlers satisfies Record<AppCommandId, () => void>` so new menu commands require handlers.
- `tests/project-contract.test.ts` rejects reintroduced fake output-folder, camera, Exit, Check for Updates, duplicated "Add body part," placeholder-like visible copy.
- Browser workflow tests exercise Keyboard Shortcuts + About dialogs from real menu, Character-owned rig actions, absence of Path rig creation controls, stage navigation, blueprint exports, assembly stepper controls.
- Future rule: add visible control only after adding handler, state mutation/export/navigation path, + at least one contract or browser assertion.
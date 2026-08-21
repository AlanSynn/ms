# UI dead-feature audit

Scope: visible MotionSmith UI/UX controls that either had no real browser execution, duplicated another control without adding behavior, or were legacy placeholders after the compact editor rebuild.

## Operating rule

Every visible control must do one of these things immediately in the browser:

1. mutate `ProjectState` or editor viewport state,
2. open a real file/input/modal workflow,
3. run tracking/simulation/fit/export code,
4. navigate to another implemented stage, or
5. be an honest disabled guard with the reason visible nearby.

If a control does not meet one of those conditions, remove it instead of adding explanatory copy.

## Screen-by-screen implementation plan and status

| Surface | Required real behavior | Current status / action |
| --- | --- | --- |
| App shell menus | All menu entries resolve through a typed command registry and one `App.tsx` handler. | Implemented by `utils/appCommands.ts` + `commandHandlers satisfies Record<AppCommandId, () => void>`. Contract tests compare menu ids to handler ids. |
| Top command bar | File/Edit/View/Go/Options/Help menus execute the same registry commands as shortcuts. | Implemented. Keep all new toolbar/menu actions registry-backed. |
| Welcome / Getting Started | Guide, starter rig, character package load, project import, and “do not show again” must open real workflows. | Implemented. Image recognition and hardware camera capture remain absent. |
| Character | Load/review a package, add an ordinary scene-object image, edit part/outline/art/skeleton data, and save the skeleton. | Implemented. Image-to-rig recognition was removed from the shipped app. |
| Path | Draw/clear path, track video/GIF, play/reset, visibility/enabled state, selected point deletion, target selection, and path topology. | Implemented. Rig creation/editing controls are Character-owned; Path no longer exposes Add layer, Remove layer, or New handle controls. |
| Mechanism Foundry | Mechanism type selection, anchor picking, layer toggles, play/reset, parameters, and “Use mechanism” export a real mechanism package. | Implemented and covered by existing browser tests. Keep future mechanism buttons backed by `mechanismFeatureRegistry`/fabrication recipes. |
| Mechanism Design | Playback/trace, library insertion, fit-path optimization, recommendation generation, delete, and blueprint navigation. | Implemented. Fit/recommendation controls run optimizer/recommendation code and are not static cards. |
| Blueprint | Generate fabrication package; download JSON/SVG/PDF/STL/HTML/metadata; preview 2D cut sheet; navigate to assembly. | Implemented. Blueprint stays a 2D document preview; step-by-step assembly lives in Assembly. |
| Assembly | Kit/custom lane choice, recipe cards, step controls, Three build preview, read-only step strip, PDF/HTML guide download. | Implemented. Stepper uses `prefabAssemblySteps`, `AssemblySceneFrame`, and the Three preview rather than a static guide, lower SVG workbench, or nested ghost. |
| Options | Theme, toolbar/panel visibility, physics/fabrication/export settings, and reset all update real settings. | Implemented. Keep settings compact and avoid “studio/debug” explanatory panels unless tied to real settings. |

## Retired / unnecessary in current browser build

| Feature | Decision | Why |
| --- | --- | --- |
| File → Exit | keep absent | Browser apps cannot reliably close their own window; a fake command only adds confusion. |
| Help → Check for Updates | keep absent | No browser/native updater contract is implemented. Re-add only with a real updater flow. |
| Character → Choose Save Folder | removed | Existing exports use browser downloads. A directory picker would not make current `downloadText` exports write to that folder. |
| Camera capture | already removed | Hardware camera capture was out of scope for the tinkerable editor flow. |
| Path → Add body part | removed | It duplicated “Add layer” with the same handler, making the UI look like it had two different rig-authoring features. |

## Missing execution fixed

| Surface | Before | Now |
| --- | --- | --- |
| Help → About MotionSmith… | wrote a status-bar sentence only | opens a real modal with product/runtime information and modal shortcut blocking. |
| Path → Add body part | duplicated Add layer | removed; one visible add-layer affordance remains. |

## Enforcement

- `utils/appCommands.ts` is the app-shell command registry.
- `App.tsx` keeps `commandHandlers satisfies Record<AppCommandId, () => void>` so new menu commands require handlers.
- `tests/project-contract.test.ts` rejects reintroduced fake output-folder, camera, Exit, Check for Updates, duplicated “Add body part,” and placeholder-like visible copy.
- Browser workflow tests exercise Keyboard Shortcuts and About dialogs from the real menu, Character-owned rig actions, absence of Path rig creation controls, stage navigation, blueprint exports, and assembly stepper controls.
- Future rule: add a visible control only after adding its handler, state mutation/export/navigation path, and at least one contract or browser assertion.

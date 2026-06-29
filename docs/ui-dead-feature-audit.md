# UI dead-feature audit

Scope: visible MotionSmith UI/UX controls that either had no real browser execution or were legacy placeholders after the compact editor rebuild.

## Retired / unnecessary in current browser build

| Feature | Decision | Why |
| --- | --- | --- |
| File → Exit | keep absent | Browser apps cannot reliably close their own window; a fake command only adds confusion. |
| Help → Check for Updates | keep absent | No browser/native updater contract is implemented. Re-add only with a real updater flow. |
| Character → Choose Save Folder | removed | Existing exports use browser downloads. A directory picker would not make current `downloadText` exports write to that folder. |
| Camera capture | already removed | Hardware camera capture was out of scope for the tinkerable editor flow. |

## Missing execution fixed

| Surface | Before | Now |
| --- | --- | --- |
| Help → About MotionSmith… | wrote a status-bar sentence only | opens a real modal with product/runtime information and modal shortcut blocking. |

## Enforcement

- `utils/appCommands.ts` is the app-shell command registry.
- `App.tsx` keeps `commandHandlers satisfies Record<AppCommandId, () => void>` so new menu commands require handlers.
- `tests/project-contract.test.ts` rejects reintroduced fake output-folder, camera, Exit, or Check for Updates controls.
- Browser workflow tests exercise Keyboard Shortcuts and About dialogs from the real menu.

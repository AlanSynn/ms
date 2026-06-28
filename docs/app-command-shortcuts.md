# MotionSmith application command registry

MotionSmith uses `utils/appCommands.ts` as the single source of truth for app-wide menu items, keyboard shortcuts, and the in-app shortcut reference. The top menu, shortcut dispatcher, and contract tests must consume that registry instead of duplicating labels in component code.

## Command groups

| Group | Commands | Shortcut policy |
| --- | --- | --- |
| File | New Project, Load Project, Recover Autosave, Save Project, Save Project As, Export Project Copy, Export Blueprint Package | Only stable project/document actions get global shortcuts. |
| Edit | Back (Undo), Forward (Redo) | Project-state history only; processing/status/export metadata is not recorded as undoable work. |
| View | Zoom In, Zoom Out, Zoom to Fit, Reset View, Save/Restore/Reset Workspace Layout | Canvas zoom shortcuts are global; layout actions stay menu-only. |
| Go | Character, Path Editor, Mechanism Foundry, Mechanism Design, Blueprint, Assembly | `Alt+1` through `Alt+6` navigate the novice workflow. |
| Options | Preferences | `Cmd/Ctrl+,` opens the Options tab. |
| Help | Keyboard Shortcuts, About MotionSmith | `?` opens the generated shortcut reference. |

## Global shortcuts

| Shortcut | Command |
| --- | --- |
| `Cmd/Ctrl+N` | New Project |
| `Cmd/Ctrl+O` | Load Project |
| `Cmd/Ctrl+S` | Save Project |
| `Cmd/Ctrl+Shift+S` | Save Project As |
| `Cmd/Ctrl+Alt+S` | Export Project Copy |
| `Cmd/Ctrl+E` | Export Blueprint Package |
| `Cmd/Ctrl+Z` | Back (Undo) |
| `Cmd/Ctrl+Shift+Z`, `Cmd/Ctrl+Y` | Forward (Redo) |
| `Cmd/Ctrl+=` or `Cmd/Ctrl++` | Zoom In |
| `Cmd/Ctrl+-` | Zoom Out |
| `Cmd/Ctrl+0` | Zoom to Fit |
| `Alt+1` … `Alt+6` | Workflow tabs from Character through Assembly |
| `Cmd/Ctrl+,` | Preferences |
| `?` | Keyboard Shortcuts |

Shortcuts are ignored while focus is inside `input`, `textarea`, `select`, or content-editable controls so direct manipulation and numeric editing are not interrupted. App-wide shortcuts are also suspended while a modal dialog is open; modal-local buttons and focus traps own that interaction until the dialog closes.

Canvas-local controls such as part sliders, path handles, camera orbit/zoom, foundry overlay toggles, and export recipe selectors stay local unless they become repeated app-shell actions. This keeps the novice workbench tinkerable instead of turning every small knob into a global command.

## Retired placeholder items

The old browser-only menu contained dead placeholders for `Exit` and `Check for Updates`. They are intentionally not rendered until a real Tauri/native updater or browser-close contract exists. No visible command should call a generic “not available yet” handler.

## Enforcement

- `validateAppCommandRegistry()` rejects duplicate IDs, duplicate shortcuts, menu/command mismatches, and orphan commands.
- `App.tsx` must keep `commandHandlers satisfies Record<AppCommandId, () => void>` so TypeScript fails if a new command is added without a handler.
- `tests/project-contract.test.ts` imports `APP_COMMANDS`/`APP_MENU_GROUPS` to keep the contract executable.

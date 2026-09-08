# MotionSmith application command registry

MotionSmith uses `utils/appCommands.ts` as the single source of truth for app-wide menu items, keyboard shortcuts, and the in-app shortcut reference. The top menu, shortcut dispatcher, and contract tests must consume that registry instead of duplicating labels in component code.

## Command groups

| Group | Commands | Shortcut policy |
| --- | --- | --- |
| Project | New Project, Save Project, Open Project, Recover browser backup, Earlier versions, Keep version, Reset Lesson | Only stable project/document actions get global shortcuts. |
| Edit | Undo, Redo | Project-state history only; processing/status/export metadata is not recorded as undoable work. |
| View | Zoom In, Zoom Out, Zoom to Fit, Reset View, Save/Restore/Reset Layout | Canvas zoom shortcuts are global; layout actions stay menu-only. |
| Go | Project, Character, Path, Foundry, Design, Blueprint, Assembly | `Alt+1` through `Alt+6` navigate the novice workflow. |
| Options | Preferences | `Cmd/Ctrl+,` opens the Options tab. |
| Help | Find a feature, Feedback, What's new, Shortcuts, About MotionSmith | The three support entries are also visible in the top bar; `?` opens the shortcut reference. |

## Global shortcuts

| Shortcut | Command |
| --- | --- |
| `Cmd/Ctrl+N` | New Project |
| `Cmd/Ctrl+O` | Open Project |
| `Cmd/Ctrl+S` | Save Project |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z`, `Cmd/Ctrl+Y` | Redo |
| `Cmd/Ctrl+=` or `Cmd/Ctrl++` | Zoom In |
| `Cmd/Ctrl+-` | Zoom Out |
| `Cmd/Ctrl+0` | Zoom to Fit |
| `Alt+1` … `Alt+6` | Workflow tabs from Character through Assembly |
| `Cmd/Ctrl+,` | Preferences |
| `?` | Shortcuts |

Shortcuts are ignored while focus is inside `input`, `textarea`, `select`, or content-editable controls so direct manipulation and numeric editing are not interrupted. App-wide shortcuts are also suspended while a modal dialog is open; modal-local buttons and focus traps own that interaction until the dialog closes.

Support panels use the same command handlers and suspend underlying shortcuts. Feature search and release-note Show me actions share the explicit reveal mapping in `utils/featureDestinations.ts` and `hooks/useFeatureReveal.ts`: they navigate, open, and focus an existing control without executing its edit or download. Search queries, feedback drafts, receipts, and release-note read preferences stay outside project history and serialization. See [student support maintenance](student-support.md).

`Earlier versions` opens the retained project history from the Project area. Selecting a row only loads its read-only preview; `Keep version`, `Restore`, `Rename`, and `Delete` use the history callbacks owned by the current project. `Save current only` is a hidden fallback command for version-storage failures and saves the current project without its history extension.

The collapsed `Browser storage` control lists other local project histories with their latest update, size, and version count. Deleting one removes that browser history only; project files stay unchanged.

Canvas-local controls such as part sliders, path handles, camera orbit/zoom, foundry overlay toggles, and export recipe selectors stay local unless they become repeated app-shell actions. This keeps the novice workbench tinkerable instead of turning every small knob into a global command.

`Reset Lesson` stays menu-only. It returns to the lesson’s original starting state while preserving app settings; if no lesson is active it reports status only.

## Retired placeholder items

The old browser-only menu contained dead placeholders for `Exit` and `Check for Updates`. They are intentionally not rendered until a real Tauri/native updater or browser-close contract exists. No visible command should call a generic “not available yet” handler.

The old character import panel also exposed `Choose Save Folder…`, but browser exports still write through normal download links. It stays absent until a native file-system writer can make that location real.

Legacy named snapshot, portable copy, and Blueprint handoff command IDs remain hidden compatibility entries without global shortcuts. Student search does not surface them.

## Enforcement

- `validateAppCommandRegistry()` rejects duplicate IDs, duplicate shortcuts, menu/command mismatches, and orphan commands.
- The shared command-handler map in `utils/appCommandHandlers.ts` must satisfy `Record<AppCommandId, () => void>` so TypeScript fails if a new command is added without a handler.
- `tests/project-contract.test.ts` imports `APP_COMMANDS`/`APP_MENU_GROUPS` to keep the contract executable.

Save Project starts a portable file download; it does not confirm an overwrite or final disk location. Open Project uses the device picker and is the normal next-class return. Recover browser backup is a separate secondary action; boot never chooses that candidate automatically.

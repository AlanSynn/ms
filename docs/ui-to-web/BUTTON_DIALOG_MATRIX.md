# Button / Dialog / Control Matrix

This table collects user controls that are easy to miss during the web port. For raw auto-scan evidence, see `inventory/qt_ui_inventory.*`.

## App shell

| Surface | Control | Web behavior |
| --- | --- | --- |
| File menu | New | clear/create project with dirty-state guard |
| File menu | Load Project... | file picker/import project |
| File menu | Recover Browser Autosave... | open autosave recovery flow |
| File menu | Download Snapshot | download the current local project snapshot |
| File menu | Download Snapshot As... | download a timestamped local project snapshot |
| File menu | Export Blueprint Package | export cut sheets + assembly guide |
| File menu | Download Portable Copy | download a portable local project copy |
| View menu | Zoom In/Out/Fit/Reset View | operate on persistent canvas viewport |
| View menu | Save/Restore/Reset Workspace Layout | persist panel/tab/workspace preferences |
| Edit menu | Back (Undo), Forward (Redo) | project command history |
| Options menu | Preferences... | open Options drawer/dialog |
| Help menu | Keyboard Shortcuts, About... | generated shortcut reference and About modal |
| Toolbar | New/Load/Download Snapshot/Export Blueprint/Portable Copy | optional quick actions, hidden default |

### Retired browser-only placeholders

| Removed control | Reason |
| --- | --- |
| File → Exit | Browsers cannot reliably close the app window; no fake “not available” command. |
| Help → Check for Updates... | No updater contract in the browser build; keep absent until native/Tauri updater exists. |
| Character → Choose Save Folder… | Browser downloads still go to the browser’s configured download location; selecting a directory would not make existing exports write there. |

## Character Selection tab

| Group | Control | Source state/effect |
| --- | --- | --- |
| Input Drawing | Use sample example | loads bundled raw character image |
| Input Drawing | Load Image File | imports image into `source.image` layer |
| Processing Steps | Process Image (Skeleton) | AI/image pipeline, skeleton first |
| Processing Steps | Edit Skeleton | direct skeleton editing |
| Processing Steps | Save Skeleton | persist skeleton config |
| Processing Steps | Generate Body Parts | segmentation/body-part generation |
| Processing Steps | Extend Skeleton 10% | skeleton bone length transform |
| Processing Steps | Lock/Unlock Joints | IK joint lock state |
| Recognition Editing | Edit Parts / Skeleton / Boxes | opens Manual Segmentation Editor |
| Recognition Editing | Edit Skeleton Joints | toggles joint drag mode |
| Recognition Editing | Save Skeleton | persist edited skeleton |
| View Controls | + / − / ⌖ / 1:1 | zoom in/out/fit/reset |
| Character Setup | Replace Character | current processed image becomes project character |
| Floating zoom | zoom combo / Fit | set canvas zoom preset or fit |

## Path Editor tab

| Group | Control | Source state/effect |
| --- | --- | --- |
| 1 Parts | parts list | select body part/layer |
| 2 Motion Path | Closed/Open radios | path topology |
| 2 Motion Path | Start Drawing Path | toggle path draw mode |
| 2 Motion Path | Clear | remove path for selected part |
| 2 Motion Path | Smoothness slider | path smoothing parameter |
| 3 Animation | play/stop/reset | IK animation control |
| 4 View Controls | + / − / ⌖ / ⎈ | zoom/fit/center character |

## Mechanism Design tab

| Group | Control | Source state/effect |
| --- | --- | --- |
| 1 Parts for Mechanisms | mechanism layers list | select part/layer eligible for mechanism |
| 2 Mechanism Generation | Get Mechanism | opens recommendation dialog from path data |
| 2 Mechanism Generation | Assign Character | attach/replace character for mechanism simulation |
| 2 Mechanism Generation | Parametric Edit | toggles handle layer and param edit mode |
| 3 Animation | play/stop/reset | mechanism animation playback |
| 4 Blueprint Export | Export Blueprint | export current design/fabrication package |
| 5 View Controls | + / − / ⌖ / ⎈ | zoom/fit/center character |

## Mechanism Foundry tab

| Surface | Control | Source state/effect |
| --- | --- | --- |
| Gallery | mechanism cards | choose mechanism family/type |
| Editor toolbar | Back to Gallery | stacked widget → gallery |
| Editor toolbar | Play | toggle foundry animation |
| Editor toolbar | Forces / Velocity / Trail / Path Preview | render toggles |
| Editor toolbar | Show Sensemaking | show/hide info panel |
| Editor toolbar | Reset | reset animation |
| Editor toolbar | Add to Mechanism Tab | serialize exact instance into Mechanism Design |
| Controls | Mechanism Selection combo | switch mechanism type |
| Controls | Parameter sliders | update mechanism parameters, snap if enabled |
| Controls | Angle slider | scrub input angle |
| Controls | Valid Range combo | choose solvable angle interval |
| Controls | Motion Point combo | select output/tracking point |

## Options dialog

| Group | Control | Web state |
| --- | --- | --- |
| Appearance | Theme Light/Dark | theme |
| Appearance | Show Toolbar | toolbar visibility |
| Appearance | Show Part Properties Panel | optional editor property panel |
| Simulation | Animation Duration | animation loop seconds |
| Simulation | Timing Profile | progress easing |
| Performance | Preset Fast/Balanced/High | visual/simulation update policy |
| Performance | Physics Snap Mode Fast/Balanced/High | snapping strictness |
| Debugging | Enable Debug Visuals | debug layers |
| Workflow | Show Detailed Processing Steps | processing step panel visibility |
| Workflow | Enable Autosave + interval | autosave policy |
| Fabrication | Cut-sheet File Type PDF/SVG | export default |
| Fabrication/Units | Grid Unit System cm/inch/px | grid label/display unit |
| Fabrication/Units | Fabrication-ready preset mode | snap/board mode |
| Fabrication/Units | Physical Board Pitch | grid pitch preset |
| Fabrication/Units | Grid Cell Size | read-only pitch display |

## Dialogs

| Dialog | Trigger | Controls |
| --- | --- | --- |
| Manual Segmentation Editor | Character Selection → Edit Parts / Skeleton / Boxes | part radios, clear, box from joints, anchor from joint, add/remove joint, add/remove layer, preview, save/load, apply/cancel |
| Character Selection Dialog | mechanism character assignment | preset list, thumbnail, description, OK/Cancel |
| Mechanism Recommendation Dialog | Get Mechanism | recommendation cards, Apply this, Close, empty state |
| Custom Coupler Path Dialog | Foundry coupler custom point | fraction slider/spinbox, OK/Cancel |
| Options Dialog | Preferences | settings groups above |
| About Dialog | Help → About | product/about text |

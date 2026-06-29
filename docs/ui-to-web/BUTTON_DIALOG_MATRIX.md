# Button / Dialog / Control Matrix

이 표는 웹 포팅 때 누락되기 쉬운 사용자 조작 지점을 한곳에 모은 것입니다. 더 원시적인 자동 스캔 결과는 `inventory/qt_ui_inventory.*`를 참조하세요.

## App shell

| Surface | Control | Web behavior |
| --- | --- | --- |
| File menu | New | clear/create project with dirty-state guard |
| File menu | Load Project... | file picker/import project |
| File menu | Recover Autosave... | open autosave recovery flow |
| File menu | Save Project | save current project |
| File menu | Save Project As... | save project to new file |
| File menu | Export Blueprint Package | export cut sheets + assembly guide |
| File menu | Export Project Copy | export current project copy |
| File menu | Exit | close app/confirm unsaved |
| View menu | Zoom In/Out/Fit/Reset View | operate on persistent canvas viewport |
| View menu | Save/Restore/Reset Workspace Layout | persist panel/tab/workspace preferences |
| Edit menu | Back (Undo), Forward (Redo) | project command history |
| Options menu | Preferences... | open Options drawer/dialog |
| Help menu | Check for Updates..., About... | app update/about modals |
| Toolbar | New/Load/Save/Export Blueprint/Export Copy | optional quick actions, hidden default |

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
| Download / Output Location | Choose Save Folder… | set generation output location |
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

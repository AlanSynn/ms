# Single Canvas + Layer Visibility Strategy for Web Rebuild

## Conclusion

For the web rebuild, do not create a separate scene/view per tab like Qt. Keep **one persistent scene graph + one canvas viewport**. Tab changes must not reset the canvas; they only change:

1. Left/right tool panel composition
2. Scene layer visibility, editability, and hit-test policy

This reduces repeated position, scale, character, skeleton, and mechanism mismatches across tabs.

## Observed Qt structure

| Area | Current implementation | Evidence file |
| --- | --- | --- |
| Main window | `QMainWindow` + `QTabWidget`; Character Selection, Path Editor, Mechanism Design, Mechanism Foundry | `src/automataii/presentation/qt/main_window.py` |
| Character canvas | `ImageProcessingView(QGraphicsView)`; directly draws image, skeleton, debug, and grid | `src/automataii/presentation/qt/image_view.py` |
| Editor canvas | `EditorView(QGraphicsView)`; character parts, skeleton item, path drawing, vertex edit, grid | `src/automataii/presentation/qt/views/editor_view.py` |
| Mechanism Design canvas | Uses an `EditorView`-family view for parts, paths, mechanisms, and handles | `src/automataii/presentation/qt/tabs/mechanism_design/tab.py`, `mechanism_design_ui.py` |
| Foundry canvas | Separate `QGraphicsScene/QGraphicsView` plus grid/fabrication board rendering | `src/automataii/presentation/qt/tabs/mechanism_foundry/foundry_view.py` |
| View/camera sharing | `TabOrchestrator` stores and restores shared camera state | `src/automataii/presentation/qt/windows/components/tab_orchestrator.py` |
| Grid settings | Options → physical context → image/editor/foundry grid propagation | `main_window.py`, `options_tab.py`, `physical_context_store.py` |
| Z order | constants + direct `setZValue` calls | `src/automataii/config/z_indices.py`, visualizer files |

## Recommended web scene model

```ts
type SceneState = {
  project: ProjectState;
  viewport: ViewportState;      // pan/zoom/rotation; tab-independent
  sheet: SheetState;            // Letter, board, grid pitch, print bounds
  layers: Record<LayerId, LayerState>;
  tools: ToolState;             // current tab + current mode
  selection: SelectionState;
};

type LayerState = {
  id: LayerId;
  kind: LayerKind;
  visible: boolean;
  editable: boolean;
  hitTest: 'none' | 'select' | 'drag' | 'draw';
  opacity: number;
  z: number;
  items: SceneItem[];
};
```

## Layer groups

| z band | Layer group | Included elements | Visible by default in tabs | hit-test/editing |
| ---: | --- | --- | --- | --- |
| -200 | `sheet.printBounds` | Letter/A4 sheet outline, fabrication board bounds | all canvas tabs | none |
| -150 | `grid.minorMajor` | 2cm/physical pitch grid, major grid lines | all canvas tabs | none |
| 0 | `source.image` | original uploaded image, processed texture | Character Selection | select/drag only in image edit modes |
| 10 | `character.parts` | body part sprites/polygons | Path Editor, Mechanism Design, Blueprint | select/drag/transform |
| 20 | `motion.path.final` | saved paths per part | Path Editor, Mechanism Design | select/edit in path modes |
| 30 | `motion.path.preview` | path currently being drawn/edited | Path Editor | draw/edit |
| 45 | `skeleton.bonesJoints` | skeleton bones, joints, bend arrows | Character/Editor/Mechanism when enabled | drag in skeleton edit mode |
| 60 | `mechanism.instances` | 4-bar/cam/gear visuals attached to parts | Mechanism Design, Blueprint | select in design; no hit in playback |
| 70 | `mechanism.pathTrace` | mechanism output traces, coupler paths | Mechanism Design, Foundry | no hit unless trace edit mode |
| 90 | `foundry.preview` | gallery/editor preview mechanism | Foundry only | select/slider-driven |
| 100 | `blueprint.fabrication` | board holes, cut sheets, labels, assembly guide positions | Blueprint/Export preview | select/export-only |
| 1000 | `handles.parametric` | drag handles, anchor handles, rotation handles, path vertex handles | edit modes only | drag |
| 2000 | `overlays.debugStatus` | debug bbox/text/status badges/tooltips | optional/debug | none |

## Tab visibility presets

### Character Selection

- show: `sheet.printBounds`, `grid.minorMajor`, `source.image`, `skeleton.bonesJoints`, `overlays.debugStatus`
- panel: input drawing, processing steps, recognition editing, view controls, character setup, output location
- tools: image load/camera, skeleton edit, segmentation editor launch

### Path Editor

- show: `sheet.printBounds`, `grid.minorMajor`, `character.parts`, `skeleton.bonesJoints`, `motion.path.final`, `motion.path.preview`, `handles.parametric` only for path vertex edit
- panel: parts list, path type, start/stop drawing, smoothness, animation, view controls
- tools: select part, draw path, edit path vertices, play IK animation

### Mechanism Design

- show: `sheet.printBounds`, `grid.minorMajor`, `character.parts`, `skeleton.bonesJoints`, `motion.path.final`, `mechanism.instances`, `mechanism.pathTrace`, `handles.parametric` when enabled
- panel: mechanism layer list, get mechanism, assign character, parametric edit, animation, blueprint export, view controls
- tools: recommendation, mechanism placement/parameter edit, animation playback, blueprint export

### Mechanism Foundry

- show: `sheet.printBounds`, `grid.minorMajor`, `foundry.preview`, `mechanism.pathTrace`, `blueprint.fabrication` when fabrication mode enabled
- panel: gallery or editor controls, mechanism selector, parameter sliders, angle/valid range, output point, display toggles, sensemaking panel
- tools: select mechanism family, scrub angle, alter parameters, add to Mechanism Design

### Options

- no canvas replacement. Options is a modal/side-sheet control surface over the persistent scene.
- changing grid/physical context updates `sheet`, `grid`, snapping policy, blueprint export defaults.

## Why this matters for current known bugs

Most bugs seen in this project come from multiple views/scenes interpreting the same model differently.

- Character resize appears differently in Character, Editor, Mechanism, and Blueprint.
- Skeleton points and body parts use different transforms across tabs.
- Adding a mechanism can make upper/lower limbs appear detached during animation.
- Parametric editing can leave stale points/handles or mismatch drag coordinates and displayed coordinates.
- Blueprint/assembly guide can show generic/default board and character placement.

The web rebuild keeps one canonical coordinate system for scene items.

```ts
// all stored in physical scene units, preferably millimeters
SceneItem.transform = {
  positionMm: { x, y },
  rotationRad,
  scale,
  parentId?: SceneItemId,
};
```

Viewport transforms are rendering-only and must not be mixed into stored data.

## Coordinate contract

1. Canonical scene unit: **millimeter**.
2. Grid pitch default: **20 mm / 2 cm**, from `DEFAULT_GRID_CELL_CM`.
3. Print sheet: US Letter = **215.9 × 279.4 mm**.
4. Character normalize/fit is a project operation, not a per-tab operation.
5. Any tab-specific view pan/zoom is viewport state only.
6. Mechanism anchors, skeleton joints, body part pivots, blueprint board coordinates all reference canonical scene coordinates.

## Interaction policy

| Mode | Active layer hit test | Pointer behavior |
| --- | --- | --- |
| Select | character/mechanism selectable | click select, drag selected items |
| Skeleton edit | skeleton joints | drag joint, add/remove joint via panel |
| Part/layer edit | character.parts | edit part boundaries, create/remove part layer |
| Path draw | motion.path.preview | click/drag path points |
| Path vertex edit | motion.path.final + handles | drag vertices/handles |
| Parametric edit | handles.parametric + mechanism.instances | drag mechanism handles; immediately update numeric params from same source |
| Playback | none, or select only | animation updates scene from single animation state |
| Blueprint preview | blueprint.fabrication | export/inspect only |

## Implementation note for web stack

A practical stack can be:

- React/Vue/Svelte for panels and dialogs
- Zustand/Redux/Pinia for `SceneState`
- Canvas2D/Konva/Pixi/Fabric for interactive scene graph, or SVG if item count remains small
- Web Worker for mechanism/path computation
- ONNX Runtime Web for AI/pose/segmentation models if retained

Avoid putting canonical state inside canvas object instances only. Canvas nodes should be render/cache views over the typed scene store.

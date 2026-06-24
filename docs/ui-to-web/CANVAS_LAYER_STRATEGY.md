# Single Canvas + Layer Visibility Strategy for Web Rebuild

## 결론

웹 리빌드에서는 Qt처럼 탭마다 별도 scene/view를 새로 만들지 말고, **하나의 persistent scene graph + 하나의 캔버스 viewport**를 유지한다. 탭 전환은 canvas를 리셋하지 않고 다음 두 가지만 바꾼다.

1. 왼쪽/오른쪽 tool panel 구성
2. scene layer group의 visibility, editability, hit-test policy

이 방식이 현재 앱에서 반복적으로 문제를 만든 “탭 간 위치/스케일/캐릭터/스켈레톤/메커니즘 불일치”를 줄인다.

## 현재 Qt 구조에서 확인된 사실

| 영역 | 현재 구현 | 근거 파일 |
| --- | --- | --- |
| Main window | `QMainWindow` + `QTabWidget`; Character Selection, Path Editor, Mechanism Design, Mechanism Foundry | `src/automataii/presentation/qt/main_window.py` |
| Character canvas | `ImageProcessingView(QGraphicsView)`; image/skeleton/debug/grid를 직접 그림 | `src/automataii/presentation/qt/image_view.py` |
| Editor canvas | `EditorView(QGraphicsView)`; character parts, skeleton item, path drawing, vertex edit, grid | `src/automataii/presentation/qt/views/editor_view.py` |
| Mechanism Design canvas | `EditorView` 계열 view를 사용해 parts/path/mechanism/handles 표시 | `src/automataii/presentation/qt/tabs/mechanism_design/tab.py`, `mechanism_design_ui.py` |
| Foundry canvas | 별도 `QGraphicsScene/QGraphicsView` + grid/fabrication board render | `src/automataii/presentation/qt/tabs/mechanism_foundry/foundry_view.py` |
| View/camera sharing | `TabOrchestrator`가 shared camera state를 저장/복원 | `src/automataii/presentation/qt/windows/components/tab_orchestrator.py` |
| Grid settings | Options → physical context → image/editor/foundry grid propagation | `main_window.py`, `options_tab.py`, `physical_context_store.py` |
| Z order | constants + direct `setZValue` calls | `src/automataii/config/z_indices.py`, visualizer files |

## 권장 웹 scene model

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

| z band | Layer group | 포함 요소 | 기본 visible 탭 | hit-test/editing |
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

현재 대화에서 나온 버그들은 대부분 “같은 모델을 여러 view/scene이 각자 해석”할 때 생기는 유형이다.

- 캐릭터 resize가 Character/Editor/Mechanism/Blueprint에서 다르게 보임
- skeleton point와 body part가 tab마다 다른 transform으로 보임
- mechanism 추가 후 상완/하완 분리처럼 보이는 animation mismatch
- parametric editing에서 점/handle이 남거나 실제 드래그 좌표와 표시 좌표가 다름
- blueprint/assembly guide에서 board 위치와 character 위치가 generic/default로 보임

웹 리빌드에서는 scene item의 canonical 좌표계를 하나만 둔다.

```ts
// all stored in physical scene units, preferably millimeters
SceneItem.transform = {
  positionMm: { x, y },
  rotationRad,
  scale,
  parentId?: SceneItemId,
};
```

Viewport transform은 렌더링 전용이며 저장 데이터에 섞지 않는다.

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

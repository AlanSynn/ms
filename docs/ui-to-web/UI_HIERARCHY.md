# UI Hierarchy

```text
AutomataDesigner (QMainWindow)
├─ MenuBar
│  ├─ File
│  ├─ View
│  ├─ Edit
│  ├─ Options
│  └─ Help
├─ MainToolbar (hidden by default)
├─ MainTabWidget
│  ├─ Character Selection (ImageProcessingTab)
│  │  ├─ Left Control Scroll
│  │  │  ├─ Input Drawing
│  │  │  ├─ Processing Steps
│  │  │  ├─ Recognition Editing
│  │  │  ├─ View Controls
│  │  │  ├─ Character Setup
│  │  │  └─ Download / Output Location
│  │  └─ Right Canvas Area
│  │     ├─ ImageProcessingView
│  │     └─ Floating Image Zoom Toolbar
│  ├─ Path Editor (EditorTab)
│  │  ├─ Left Control Scroll
│  │  │  ├─ 1 Parts
│  │  │  ├─ 2 Motion Path
│  │  │  ├─ 3 Animation
│  │  │  └─ 4 View Controls
│  │  └─ EditorView canvas
│  ├─ Mechanism Design (MechanismDesignTab)
│  │  ├─ Left Control Scroll
│  │  │  ├─ 1 Parts for Mechanisms
│  │  │  ├─ 2 Mechanism Generation
│  │  │  ├─ 3 Animation
│  │  │  ├─ 4 Blueprint Export
│  │  │  └─ 5 View Controls
│  │  └─ Mechanism view/canvas
│  └─ Mechanism Foundry (MechanismFoundryView)
│     └─ StackedWidget
│        ├─ GalleryView
│        │  └─ GalleryThumbnail cards
│        └─ EditorWidget
│           ├─ Toolbar
│           ├─ Controls Panel
│           │  ├─ Mechanism Selection
│           │  ├─ Parameters
│           │  ├─ Animation
│           │  └─ Display Options
│           ├─ Foundry GraphicsView canvas
│           └─ Sensemaking Info Panel
├─ OptionsDialog
│  └─ OptionsTab
└─ StatusBar
```

## Dialog tree

```text
DialogHost
├─ CharacterSelectionDialog
├─ MechanismRecommendationDialog
│  └─ PreviewContainer
│     └─ MechanismPreviewWidget
├─ InteractiveSegmentationEditor
│  └─ ClickableGraphicsView
└─ CustomCouplerPointDialog
```

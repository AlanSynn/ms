# Qt UI Inventory


- Source root: `src/automataii/presentation/qt`
- Python files scanned: 226
- UI-ish classes: 193
- UI constructor/property calls: 730

## `src/automataii/presentation/qt/actions/action_manager.py`

Classes:
- L14: `ActionManager(QObject)`

User-visible controls/text:
- L246: `QAction`
- L358: `menubar.addMenu` → “&File”
- L372: `menubar.addMenu` → “&View”
- L384: `menubar.addMenu` → “&Edit”
- L390: `menubar.addMenu` → “&Options”
- L395: `menubar.addMenu` → “&Help”
- L251: `action.setToolTip`
- L255: `action.setStatusTip`

## `src/automataii/presentation/qt/animation/scheduler.py`

Classes:
- L28: `AnimationPriority(IntEnum)`
- L38: `AnimationSubscription(object)`
- L51: `CentralAnimationScheduler(QObject)`

## `src/automataii/presentation/qt/animation/viewport_controller.py`

Classes:
- L28: `ViewportConfig(object)`
- L44: `ViewportController(QObject)`

## `src/automataii/presentation/qt/blueprint/exporter.py`

Classes:
- L52: `BlueprintExporter(object)`

User-visible controls/text:
- L720: `msg_box.setWindowTitle` → “Mechanism Dimensions”
- L488: `unit_dialog.setWindowTitle` → “Select Unit System”
- L494: `QLabel` → “Choose the unit system for your mechanism blueprint:”
- L500: `QRadioButton` → “Imperial (inches + board spaces)”
- L505: `QRadioButton` → “Metric (millimeters)”

## `src/automataii/presentation/qt/dialogs/camera_dialog.py`

Classes:
- L22: `CameraWorker(QObject)`
- L75: `CameraDialog(QDialog)`

User-visible controls/text:
- L80: `self.setWindowTitle` → “Camera Capture”
- L107: `QLabel` → “Initializing camera...”
- L113: `QPushButton` → “Capture”
- L118: `QPushButton` → “Cancel”
- L177: `self._status_label.setText` → “Error: {...}”
- L150: `self._status_label.setText` → “Camera Ready”
- L164: `self._scene.addItem`

## `src/automataii/presentation/qt/dialogs/character_selection_dialog.py`

Classes:
- L35: `CharacterSelectionDialog(QDialog)`

User-visible controls/text:
- L44: `self.setWindowTitle` → “Select Character”
- L61: `QLabel` → “Select a character preset to assign to the mechanism:”
- L225: `self._thumbnail_label.setText` → “Preview / not available”
- L133: `ok_button.setText` → “Assign”
- L179: `self._thumbnail_label.setText` → “No preview”
- L149: `self._preset_list.addItem`

## `src/automataii/presentation/qt/dialogs/components/mechanism_preview_renderer.py`

Classes:
- L23: `MechanismPreviewRenderer(object)`

## `src/automataii/presentation/qt/dialogs/recommendation_dialog.py`

Classes:
- L390: `MechanismPreviewWidget(QGraphicsView)`
- L1051: `PreviewContainer(QWidget)`
- L1183: `MechanismRecommendationDialog(QDialog)`

User-visible controls/text:
- L458: `self._preview_scene.addItem`
- L464: `self._preview_scene.addItem`
- L694: `self._preview_scene.addItem`
- L706: `self._preview_scene.addItem`
- L714: `self._preview_scene.addItem`
- L1101: `QLabel` → “Match: {...}%”
- L1118: `QPushButton` → “Apply this”
- L1196: `self.setWindowTitle` → “Mechanism Recommendations”
- L1213: `QLabel` → “Choose the mechanism that best matches your desired motion”
- L1225: `QLabel` → “The red dashed line shows your drawn path. The blue line is the mechanism's path. Click on a mechanism to select it.”
- L1298: `QPushButton` → “Close”
- L1288: `QLabel` → “No mechanism recommendations could be generated or found.”
- L1280: `QLabel` → “No mechanism found”

## `src/automataii/presentation/qt/graphics_items/anchor_item.py`

Classes:
- L7: `AnchorSignals(QObject)`
- L16: `AnchorItem(QGraphicsEllipseItem)`

User-visible controls/text:
- L119: `scene.addItem`
- L123: `scene.addItem`
- L133: `view.setWindowTitle` → “AnchorItem Test (Composition)”

## `src/automataii/presentation/qt/graphics_items/part_item.py`

Classes:
- L36: `CharacterPartItem(QGraphicsPixmapItem)`

User-visible controls/text:
- L332: `self.scene.addItem`

## `src/automataii/presentation/qt/graphics_items/skeleton_item.py`

Classes:
- L23: `SkeletonGraphicsItem(QGraphicsObject)`

## `src/automataii/presentation/qt/image_view.py`

Classes:
- L44: `ImageProcessingView(QGraphicsView)`

User-visible controls/text:
- L350: `self.scene.addItem`
- L575: `scene.addItem`
- L590: `scene.addItem`
- L823: `self.scene.addItem`
- L809: `self.scene.addItem`

## `src/automataii/presentation/qt/interactive_segmentation_editor.py`

Classes:
- L41: `ClickableGraphicsView(QGraphicsView)`
- L183: `InteractiveSegmentationEditor(QDialog)`

User-visible controls/text:
- L94: `self.scene.addItem`
- L137: `self.scene.addItem`
- L275: `self.setWindowTitle` → “Manual Segmentation Editor”
- L362: `QLabel` → “Click to trace a part boundary. Right-click removes the last point. Select joints, then use the box action to redefine that part as a rectangle.”
- L371: `QGroupBox` → “Part Layers”
- L378: `QGroupBox` → “Actions”
- L381: `QPushButton` → “Clear Current Part”
- L385: `QPushButton` → “Use Selected Joints as Box”
- L386: `self.box_btn.setToolTip` → “Redefine the current part as a padded rectangle around the selected joints.”
- L392: `QPushButton` → “Set Anchor From Selected Joint”
- L393: `self.anchor_btn.setToolTip` → “Use the selected joint as the current part's pivot/anchor.”
- L397: `QPushButton` → “Add Skeleton Point”
- L398: `self.add_joint_btn.setToolTip` → “Name a new joint, then click the image to place it.”
- L402: `QPushButton` → “Remove Selected Joint(s)”
- L406: `QPushButton` → “Add Part Layer”
- L410: `QPushButton` → “Remove Current Layer”
- L414: `QPushButton` → “Preview Segmentation”
- L431: `QPushButton` → “Save Boundaries”
- L435: `QPushButton` → “Load Boundaries”
- L446: `QLabel` → “Ready to edit”
- L455: `QPushButton` → “Apply Segmentation”
- L473: `QPushButton` → “Cancel”
- L537: `self.scene.addItem`
- L613: `self.status_label.setText` → “Added boundary point ({...}, {...}) to {...}”
- L698: `self.status_label.setText` → “Click the image to place skeleton point: {...}”
- L706: `self.status_label.setText` → “Removed {...} skeleton point(s)”
- L743: `self.status_label.setText` → “{...} anchored to {...}”
- L768: `self.status_label.setText` → “Cleared {...}”
- L803: `self.status_label.setText` → “Redefined {...} as a box from {...} joints”
- L811: `self.status_label.setText` → “Generating preview...”
- L174: `self.scene.addItem`
- L569: `QRadioButton`
- L636: `self.status_label.setText` → “Added part layer: {...}”
- L653: `self.status_label.setText` → “Removed part layer: {...}”
- L749: `self.status_label.setText` → “Deselected joint: {...}”
- L752: `self.status_label.setText` → “Selected joint: {...}”
- L873: `self.status_label.setText` → “Boundaries saved to {...}”
- L921: `self.status_label.setText` → “Boundaries loaded from {...}”
- L1003: `self.status_label.setText` → “Loaded {...} skeleton points, {...} defined part layer(s)”
- L1012: `self.status_label.setText` → “Generating final segmentation...”
- L601: `self.status_label.setText` → “Added skeleton point {...} at ({...}, {...})”
- L822: `self.status_label.setText` → “Preview generated: {...} parts defined”
- L826: `self.status_label.setText` → “No boundary points defined yet”
- L830: `self.status_label.setText` → “Preview generation failed”

## `src/automataii/presentation/qt/kinematics/components/bend_direction_manager.py`

Classes:
- L18: `SkeletonDataProvider(Protocol)`
- L34: `BendDirectionManager(object)`

## `src/automataii/presentation/qt/kinematics/components/ik_path_handler.py`

Classes:
- L18: `IKPathHandler(object)`

## `src/automataii/presentation/qt/kinematics/components/ik_visual_updater.py`

Classes:
- L21: `VisualUpdate(object)`
- L28: `IKVisualUpdater(object)`

## `src/automataii/presentation/qt/kinematics/components/two_bone_ik_solver.py`

Classes:
- L19: `TwoBoneIKConfig(object)`
- L29: `TwoBoneIKResult(object)`
- L36: `TwoBoneIKSolver(object)`

## `src/automataii/presentation/qt/kinematics/ik_manager.py`

Classes:
- L53: `IKManager(QObject)`
- L1688: `MockMainWindow(QObject)`
- L1721: `MockSkeletonManagerForIK(QObject)`
- L1715: `MockStatusBar(object)`

## `src/automataii/presentation/qt/main_window.py`

Classes:
- L123: `_QtSignalLike(Protocol)`
- L530: `AutomataDesigner(QMainWindow)`

User-visible controls/text:
- L552: `self.setWindowTitle`
- L796: `self.tab_widget.setObjectName` → “mainTabWidget”
- L804: `self.image_proc_tab.setObjectName` → “tab_character_selection”
- L808: `self.tab_widget.addTab`
- L816: `self.editor_tab.setObjectName` → “tab_path_editor”
- L818: `self.tab_widget.addTab`
- L826: `self.mechanism_design_tab.setObjectName` → “tab_mechanism_design”
- L828: `self.tab_widget.addTab`
- L849: `self.options_tab.setObjectName` → “tab_options”
- L1201: `QToolBar` → “Main Toolbar”
- L1202: `self.main_toolbar.setObjectName` → “mainToolbar”
- L838: `self.mechanism_foundry_tab.setObjectName` → “tab_mechanism_foundry”
- L839: `self.tab_widget.addTab` → “Mechanism Foundry”
- L2932: `dialog.setObjectName` → “optionsDialog”
- L2933: `dialog.setWindowTitle` → “Options”

## `src/automataii/presentation/qt/mechanisms/adapters/mechanism_adapter.py`

Classes:
- L17: `MechanismAdapter(object)`

## `src/automataii/presentation/qt/mechanisms/four_bar/editor.py`

Classes:
- L16: `FourBarEditor(EditorInterface)`

User-visible controls/text:
- L223: `handle.setToolTip`
- L225: `self.scene.addItem`

## `src/automataii/presentation/qt/mechanisms/interfaces/editor.py`

Classes:
- L17: `HandleConfig(object)`
- L42: `EditorInterface(ABC)`

## `src/automataii/presentation/qt/mechanisms/interfaces/handle.py`

Classes:
- L17: `HandleConstraints(object)`
- L60: `HandleInterface(ABC)`

## `src/automataii/presentation/qt/mechanisms/renderers/linkage_renderer.py`

Classes:
- L20: `LinkageRenderer(object)`

## `src/automataii/presentation/qt/mechanisms/visualization/adapter.py`

Classes:
- L18: `VisualizationAdapter(object)`

User-visible controls/text:
- L81: `self.scene.addItem`

## `src/automataii/presentation/qt/mechanisms/visualization/base.py`

Classes:
- L20: `VisualizationConfig(object)`
- L62: `MechanismVisualizer(ABC)`

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/cam.py`

Classes:
- L31: `CamVisualizer(MechanismVisualizer)`

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/five_bar.py`

Classes:
- L34: `FiveBarVisualizer(MechanismVisualizer)`

User-visible controls/text:
- L322: `outer.setToolTip`

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/four_bar.py`

Classes:
- L24: `FourBarVisualizer(MechanismVisualizer)`

User-visible controls/text:
- L330: `coupler_point.setToolTip` → “Coupler Point”
- L312: `outer_pivot.setToolTip`

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/gear.py`

Classes:
- L32: `GearVisualizer(MechanismVisualizer)`

User-visible controls/text:
- L107: `tracking.setToolTip` → “Tracking Point (Output)”
- L118: `mesh.setToolTip` → “Mesh Point”

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/planetary_gear.py`

Classes:
- L33: `PlanetaryGearVisualizer(MechanismVisualizer)`

User-visible controls/text:
- L119: `sun_pivot.setToolTip` → “Sun Center”
- L128: `planet_pivot.setToolTip` → “Planet Center”
- L139: `tracking.setToolTip` → “Tracking Point (Output)”

## `src/automataii/presentation/qt/mechanisms/visualization/visualizers/six_bar.py`

Classes:
- L33: `SixBarVisualizer(MechanismVisualizer)`

User-visible controls/text:
- L405: `outer.setToolTip`

## `src/automataii/presentation/qt/models/part_info.py`

Classes:
- L21: `PartInfo(object)`

## `src/automataii/presentation/qt/parametric/components/base_editor.py`

Classes:
- L32: `HandleStyle(object)`
- L44: `ParametricHandle(QGraphicsEllipseItem)`
- L213: `MechanismEditor(ABC)`

## `src/automataii/presentation/qt/parametric/components/cam_editor.py`

Classes:
- L38: `CamEditor(MechanismEditor)`

User-visible controls/text:
- L78: `center_handle.setToolTip` → “Cam Center - Drag to move”
- L79: `self.scene.addItem`
- L166: `handle.setToolTip` → “Cam Size - Drag horizontally to adjust radius”
- L173: `self.scene.addItem`
- L342: `handle.setToolTip` → “Follower Rod - Drag vertically to adjust length”
- L353: `self.scene.addItem`
- L538: `handle.setToolTip`
- L539: `self.scene.addItem`
- L314: `handle.setToolTip` → “Follower Rod - Drag vertically to adjust length”
- L320: `self.scene.addItem`

## `src/automataii/presentation/qt/parametric/components/constraint_solver.py`

Classes:
- L20: `ConstraintResult(object)`
- L28: `ConstraintSolver(object)`

## `src/automataii/presentation/qt/parametric/components/editor_factory.py`

Classes:
- L19: `EditorFactory(object)`

## `src/automataii/presentation/qt/parametric/components/fourbar_editor.py`

Classes:
- L24: `FourBarEditor(MechanismEditor)`

User-visible controls/text:
- L63: `handle.setToolTip`
- L64: `self.scene.addItem`
- L92: `handle.setToolTip` → “Drag to adjust crank length”
- L93: `self.scene.addItem`

## `src/automataii/presentation/qt/parametric/components/gear_editor.py`

Classes:
- L61: `GearEditor(MechanismEditor)`
- L433: `PlanetaryGearEditor(MechanismEditor)`

User-visible controls/text:
- L183: `center_handle.setToolTip` → “{...} Center - Drag to move”
- L184: `self.scene.addItem`
- L195: `radius_handle.setToolTip` → “{...} Radius - Drag to resize”
- L198: `self.scene.addItem`
- L215: `mesh_handle.setToolTip` → “Gear Mesh - Drag to adjust spacing”
- L217: `self.scene.addItem`
- L465: `sun_center.setToolTip` → “Sun Center - Drag to move”
- L466: `self.scene.addItem`
- L477: `pr_handle.setToolTip` → “Planet Radius - Drag to resize”
- L479: `self.scene.addItem`
- L490: `arm_handle.setToolTip` → “Arm Length - Drag radially to adjust”
- L496: `self.scene.addItem`

## `src/automataii/presentation/qt/parametric/components/handle_style_registry.py`

Classes:
- L19: `HandleType(Enum)`
- L37: `HandleStyle(object)`
- L49: `HandleStyleRegistry(object)`

## `src/automataii/presentation/qt/parametric_editor.py`

Classes:
- L63: `ParametricEditor(QObject)`

## `src/automataii/presentation/qt/physical_context_store.py`

Classes:
- L20: `PhysicalKitContextStore(QObject)`

## `src/automataii/presentation/qt/shared/scene_update_batcher.py`

Classes:
- L24: `SceneUpdateBatcher(QObject)`
- L152: `BatchContext(object)`
- L170: `GlobalSceneBatcher(object)`

## `src/automataii/presentation/qt/shared/widget_utils.py`

Classes:
- L84: `SliderSpinboxSync(object)`

User-visible controls/text:
- L74: `combo.addItem`

## `src/automataii/presentation/qt/tabs/editor/components/motion_path_manager.py`

Classes:
- L29: `MotionPathManager(QObject)`

User-visible controls/text:
- L236: `self._define_btn.setText` → “■ Stop Drawing”
- L349: `self._edit_vertices_btn.setText` → “Edit Vertices”
- L505: `self._define_btn.setText` → “✏️ Start Drawing Path”
- L524: `self._smoothness_label.setText` → “{...}%”
- L193: `self._define_btn.setText` → “✏️ Start Drawing Path”
- L261: `self._edit_vertices_btn.setText` → “Edit Vertices”
- L307: `self._edit_vertices_btn.setText` → “Done Editing”

## `src/automataii/presentation/qt/tabs/editor/components/parts_data_manager.py`

Classes:
- L28: `PartsDataManager(QObject)`

User-visible controls/text:
- L324: `item.setToolTip` → “Select this part, then use Start Drawing Path to animate it.”
- L326: `self._editor_scene.addItem`
- L179: `self._parts_list.addItem`
- L447: `item.setText` → “{...} ●”

## `src/automataii/presentation/qt/tabs/editor/components/path_query_service.py`

Classes:
- L24: `HasMotionPath(Protocol)`
- L30: `PathQueryService(object)`

## `src/automataii/presentation/qt/tabs/editor/components/simulation_controller.py`

Classes:
- L24: `SimulationController(QObject)`

User-visible controls/text:
- L313: `self._status_label.setText` → “{...} motion path(s) defined”
- L315: `self._status_label.setText` → “No motion paths defined”

## `src/automataii/presentation/qt/tabs/editor/components/skeleton_ik_handler.py`

Classes:
- L26: `SkeletonIKHandler(QObject)`

## `src/automataii/presentation/qt/tabs/editor/components/ui_builder.py`

Classes:
- L40: `EditorTabUIRefs(object)`
- L75: `EditorTabUIBuilder(object)`

User-visible controls/text:
- L158: `QGroupBox` → “1 Parts”
- L163: `parts_list.setToolTip` → “List of loaded character parts”
- L173: `QGroupBox` → “2 Motion Path”
- L178: `QLabel` → “Select a part”
- L187: `QLabel` → “Path Type:”
- L193: `QRadioButton` → “Closed”
- L194: `closed_path_radio.setToolTip` → “Create a closed loop path”
- L199: `QRadioButton` → “Open”
- L200: `open_path_radio.setToolTip` → “Create an open path”
- L211: `QPushButton` → “✏️ Start Drawing Path”
- L213: `define_motion_path_btn.setToolTip` → “Toggle mode to draw a motion path for the selected part.”
- L229: `QPushButton` → “Clear”
- L230: `clear_motion_path_btn.setToolTip` → “Clear the motion path for the selected part.”
- L241: `QLabel` → “Click points in the view to draw path. Click 'Stop Drawing' when done.”
- L253: `QLabel` → “Smoothness:”
- L262: `smoothness_slider.setToolTip` → “Adjust path smoothness (0% = raw points, 100% = perfect ellipse)”
- L268: `QLabel` → “50%”
- L293: `QGroupBox` → “3 Animation”
- L297: `QLabel` → “No motion paths defined”
- L306: `QPushButton`
- L307: `play_btn.setToolTip` → “Play Animation”
- L311: `QPushButton`
- L312: `stop_btn.setToolTip` → “Stop Animation”
- L317: `QPushButton`
- L320: `reset_sim_btn.setToolTip` → “Reset Animation”
- L342: `QGroupBox` → “4 View Controls”
- L352: `QPushButton` → “+”
- L353: `zoom_in_btn.setToolTip` → “Zoom In”
- L357: `QPushButton` → “−”
- L358: `zoom_out_btn.setToolTip` → “Zoom Out”
- L362: `QPushButton` → “⌖”
- L363: `zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L367: `QPushButton` → “⎈”
- L368: `center_character_btn.setToolTip` → “Center on Character”

## `src/automataii/presentation/qt/tabs/editor/components/view_controls.py`

Classes:
- L24: `ViewControls(QObject)`

## `src/automataii/presentation/qt/tabs/editor/tab.py`

Classes:
- L50: `EditorTab(QWidget)`

User-visible controls/text:
- L391: `self.motion_path_status_label.setText` → “Select a part”
- L567: `self.animation_status_label.setText` → “{...} motion path(s) defined”
- L569: `self.animation_status_label.setText` → “No motion paths defined”
- L733: `item.setToolTip` → “Select this part, then use Start Drawing Path to animate it.”
- L739: `self.editor_scene.addItem`
- L1306: `self.smoothness_value_label.setText` → “{...}%”
- L1453: `self.animation_status_label.setText` → “{...} motion path(s) defined”
- L528: `self.parts_list.addItem`
- L1321: `self.smoothness_value_label.setText` → “{...}%”
- L671: `item.setText` → “{...} ●”

## `src/automataii/presentation/qt/tabs/image_processing/components/manual_segmentation_handler.py`

Classes:
- L25: `ManualSegmentationHandler(QObject)`

## `src/automataii/presentation/qt/tabs/image_processing/components/skeleton_tools_handler.py`

Classes:
- L23: `SkeletonToolsHandler(QObject)`

User-visible controls/text:
- L172: `dialog.setWindowTitle` → “Lock/Unlock Joints”
- L178: `QLabel` → “Check joints to lock them during IK solving:”
- L191: `list_widget.addItem`

## `src/automataii/presentation/qt/tabs/image_processing_tab.py`

Classes:
- L49: `ImageProcessingTab(QWidget)`

User-visible controls/text:
- L109: `QGroupBox` → “Input Drawing”
- L112: `QPushButton` → “Load Image File”
- L114: `QLabel` → “Example Character”
- L132: `QGroupBox` → “Recognition Editing”
- L136: `QPushButton` → “Edit Parts / Skeleton / Boxes”
- L137: `self.manual_segmentation_btn.setToolTip` → “Open the manual editor to redefine body-part boundaries, select joints, and create rectangular boxes from selected joints.”
- L145: `QPushButton` → “Edit Skeleton Joints”
- L146: `self.edit_skeleton_btn.setToolTip` → “Enable direct dragging of detected skeleton joints.”
- L151: `QPushButton` → “Save Skeleton”
- L152: `self.save_skeleton_btn.setToolTip` → “Save the current edited skeleton to char_cfg.yaml.”
- L159: `QGroupBox` → “View Controls”
- L169: `QPushButton` → “+”
- L170: `self.zoom_in_btn.setToolTip` → “Zoom In”
- L174: `QPushButton` → “−”
- L175: `self.zoom_out_btn.setToolTip` → “Zoom Out”
- L179: `QPushButton` → “⌖”
- L180: `self.zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L184: `QPushButton` → “1:1”
- L185: `self.zoom_reset_btn.setToolTip` → “Reset Zoom (100%)”
- L194: `QGroupBox` → “Character Setup”
- L196: `QPushButton` → “Replace Character”
- L197: `self.assign_character_btn.setToolTip` → “Replace the current dummy character with a processed user image”
- L205: `QGroupBox` → “Download / Output Location”
- L209: `self.output_location_label.setObjectName` → “characterOutputLocationLabel”
- L210: `QPushButton` → “Choose Save Folder…”
- L211: `self.choose_output_dir_btn.setToolTip` → “Choose where generated character parts and parts_info.json will be saved”
- L234: `QComboBox`
- L254: `self.image_zoom_combo.addItems`
- L256: `self.image_zoom_combo.setToolTip` → “Zoom level”
- L258: `QPushButton` → “Fit”
- L281: `self.image_fit_btn.setToolTip` → “Zoom to fit all items”
- L119: `QPushButton` → “Use {...} Example”
- L120: `button.setToolTip` → “Load example character image: {...}”
- L1282: `self.assign_character_btn.setToolTip` → “Dummy mechanism session detected. Click to load an image and replace character.”
- L1286: `self.assign_character_btn.setToolTip` → “Replace dummy character using the loaded image”
- L1290: `self.assign_character_btn.setToolTip` → “Replace Character is available when a dummy character session exists in Mechanism Design”

## `src/automataii/presentation/qt/tabs/landing_tab.py`

Classes:
- L21: `ExampleImageWidget(QFrame)`
- L126: `LandingTab(QWidget)`

User-visible controls/text:
- L186: `QLabel` → “MotionSmith”
- L200: `QLabel` → “Get started by selecting an example character or continue with your own!”
- L262: `QLabel` → “Loading example images...”
- L60: `self.image_label.setText` → “Failed to load image”
- L182: `logo_label.setText` → “🤖”
- L303: `self.status_label.setText` → “No example images found”

## `src/automataii/presentation/qt/tabs/mechanism_design/components/animation_cache.py`

Classes:
- L126: `LinkageCache(object)`
- L242: `CamCache(object)`
- L352: `GearCache(object)`
- L449: `PlanetaryGearCache(object)`
- L586: `AnimationCacheManager(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/animation_lifecycle_controller.py`

Classes:
- L39: `_LifecycleSchedulerOwnership(object)`
- L48: `AnimationLifecycleController(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/mechanism_output_calculator.py`

Classes:
- L129: `MechanismOutputCalculator(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/mechanism_visual_animator.py`

Classes:
- L100: `MechanismVisualAnimator(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/recommendation_handler.py`

Classes:
- L25: `RecommendationHandler(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/scene_transform_manager.py`

Classes:
- L23: `SceneTransformManager(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/components/skeleton_visualization_handler.py`

Classes:
- L30: `SkeletonVisualizationHandler(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/controller_adapter.py`

Classes:
- L41: `_LegacyRecommendationService(MechanismRecommendationService)`
- L54: `_LegacyGenerationService(MechanismGenerationService)`

## `src/automataii/presentation/qt/tabs/mechanism_design/controllers/animation_mode_controller.py`

Classes:
- L26: `AnimationModeController(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/controllers/layer_selection_controller.py`

Classes:
- L26: `LayerSelectionController(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/controllers/parametric_mode_controller.py`

Classes:
- L23: `ParametricModeController(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/controllers/recommendation_controller.py`

Classes:
- L37: `RecommendationController(QObject)`

User-visible controls/text:
- L208: `dialog.setWindowTitle` → “Mechanism Recommendations for {...}”

## `src/automataii/presentation/qt/tabs/mechanism_design/handles/rotation_handle.py`

Classes:
- L23: `RotationHandle(QGraphicsEllipseItem)`

User-visible controls/text:
- L81: `self.setToolTip` → “🔄 Rotation Handle: Drag to set rotation angle (visual only)”
- L133: `self.setToolTip` → “🔄 Rotation Handle: {...}° (drag to rotate)”

## `src/automataii/presentation/qt/tabs/mechanism_design/mechanism_design_tab_layout.py`

Classes:
- L33: `MechanismDesignTabLayout(object)`

User-visible controls/text:
- L162: `QGroupBox` → “1 Parts for Mechanisms”
- L169: `mechanism_layers_list.setToolTip` → “Parts for mechanisms - black: has motion path, gray: no motion path”
- L183: `QGroupBox` → “2 Mechanism Generation”
- L192: `QPushButton` → “Get Mechanism”
- L194: `recommendation_btn.setToolTip` → “Get mechanism recommendations based on motion paths”
- L229: `QGroupBox` → “3 Animation”
- L241: `QPushButton`
- L244: `play_btn.setToolTip` → “Play Animation”
- L249: `QPushButton`
- L252: `stop_btn.setToolTip` → “Stop Animation”
- L257: `QPushButton`
- L260: `reset_btn.setToolTip` → “Reset Animation”
- L275: `QGroupBox` → “4 Blueprint Export”
- L280: `QPushButton` → “Export Blueprint”
- L282: `blueprint_btn.setToolTip` → “Export a PDF-first package: cut sheets, needed part blueprints, and assembly guide”
- L290: `QLabel` → “Exports PDF package: cut sheets + LEGO-style assembly guide + needed parts only”
- L309: `QGroupBox` → “5 View Controls”
- L320: `QPushButton` → “+”
- L321: `zoom_in_btn.setToolTip` → “Zoom In”
- L325: `QPushButton` → “−”
- L326: `zoom_out_btn.setToolTip` → “Zoom Out”
- L330: `QPushButton` → “⌖”
- L331: `zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L335: `QPushButton` → “⎈”
- L336: `center_character_btn.setToolTip` → “Center on Character”
- L214: `QPushButton` → “Parametric Edit”
- L215: `parametric_edit_btn.setToolTip` → “Enable interactive parameter editing with drag handles”

## `src/automataii/presentation/qt/tabs/mechanism_design/mechanism_design_tab_ui_state.py`

User-visible controls/text:
- L156: `recommendation_btn.setToolTip` → “Generate mechanisms for motion paths”
- L158: `recommendation_btn.setToolTip` → “No motion paths available - draw paths in Editor tab first”
- L172: `assign_btn.setToolTip` → “Assign a dummy character to the mechanism for simulation”
- L174: `assign_btn.setToolTip` → “Add mechanisms from Mechanism Foundry first”
- L185: `parametric_btn.setToolTip` → “Enable interactive parameter editing with drag handles”
- L187: `parametric_btn.setToolTip` → “Generate mechanisms first to enable parametric editing”
- L200: `blueprint_btn.setToolTip` → “Export character parts and mechanisms as SVG blueprint”
- L202: `blueprint_btn.setToolTip` → “Load character parts and generate mechanisms to enable export”
- L90: `parametric_btn.setText` → “Exit Parametric Mode”
- L93: `parametric_btn.setText` → “Enter Parametric Mode”
- L244: `play_btn.setToolTip` → “⚠️ Animation disabled during parametric editing”
- L248: `stop_btn.setToolTip` → “⚠️ Animation disabled during parametric editing”
- L252: `reset_btn.setToolTip` → “⚠️ Animation disabled during parametric editing”
- L256: `play_btn.setToolTip` → “▶️ Play mechanism animation”
- L259: `stop_btn.setToolTip` → “⏹️ Stop mechanism animation”
- L262: `reset_btn.setToolTip` → “🔄 Reset mechanism to initial state”

## `src/automataii/presentation/qt/tabs/mechanism_design/mechanism_design_ui.py`

Classes:
- L30: `MechanismDesignUI(object)`

User-visible controls/text:
- L75: `QGroupBox` → “1 Parts for Mechanisms”
- L97: `self.mechanism_layers_list.setToolTip` → “Parts for mechanisms - black: has motion path, gray: no motion path”
- L136: `QGroupBox` → “2 Mechanism Generation”
- L162: `QPushButton` → “Get Mechanism”
- L164: `self.recommendation_btn.setToolTip` → “Get mechanism recommendations based on motion paths”
- L186: `QPushButton` → “Assign Character”
- L188: `self.assign_character_btn.setToolTip` → “Assign a dummy character to the mechanism for simulation”
- L245: `QGroupBox` → “3 Animation”
- L272: `QPushButton`
- L273: `self.play_btn.setToolTip` → “Play Animation”
- L276: `QPushButton`
- L277: `self.stop_btn.setToolTip` → “Stop Animation”
- L280: `QPushButton`
- L281: `self.reset_btn.setToolTip` → “Reset Animation”
- L294: `QGroupBox` → “5 View Controls”
- L342: `QPushButton` → “+”
- L343: `self.zoom_in_btn.setToolTip` → “Zoom In”
- L347: `QPushButton` → “−”
- L348: `self.zoom_out_btn.setToolTip` → “Zoom Out”
- L352: `QPushButton` → “⌖”
- L353: `self.zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L358: `QPushButton` → “⎈”
- L359: `self.center_character_btn.setToolTip` → “Center on Character”
- L216: `QPushButton` → “Parametric Edit”
- L217: `self.parametric_edit_btn.setToolTip` → “Enable interactive parameter editing with drag handles”

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/controllers/parameter_controller.py`

Classes:
- L51: `ParameterController(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/handles/anchor_handle.py`

Classes:
- L22: `AnchorHandle(BaseHandle)`

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/handles/base_handle.py`

Classes:
- L27: `BaseHandle(QGraphicsEllipseItem)`

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/handles/cam_handles.py`

Classes:
- L25: `CamRodLengthHandle(DraggableHandle)`
- L187: `CamSizeHandle(DraggableHandle)`

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/handles/draggable_handle.py`

Classes:
- L23: `DraggableHandle(QGraphicsEllipseItem)`

## `src/automataii/presentation/qt/tabs/mechanism_design/parametric/services/path_optimization_service.py`

Classes:
- L61: `PathOptimizationService(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/path_trace_manager.py`

Classes:
- L34: `PathTraceConfig(object)`
- L54: `PathTraceManager(object)`

User-visible controls/text:
- L143: `scene.addItem`

## `src/automataii/presentation/qt/tabs/mechanism_design/presenter.py`

Classes:
- L42: `MechanismDesignPresenter(QObject)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/anchor_movement_handler.py`

Classes:
- L19: `AnchorMovementHandler(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/anchor_position_service.py`

Classes:
- L38: `AnchorPositionService(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/animation_frame_coordinator.py`

Classes:
- L33: `IKManagerProtocol(Protocol)`
- L45: `AnimationFrameCoordinator(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/handle_position_coordinator.py`

Classes:
- L36: `HandlePositionCoordinator(object)`

User-visible controls/text:
- L522: `anchor_handle.setToolTip` → “Gear Mechanism: {...}”
- L524: `scene.addItem`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/mechanism_instantiation_service.py`

Classes:
- L95: `UnsupportedMechanismTypeError(ValueError)`
- L188: `MechanismInstantiationService(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/scene_management_service.py`

Classes:
- L22: `SceneManagementService(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/tab_data_coordinator.py`

Classes:
- L29: `TabDataCoordinator(object)`

User-visible controls/text:
- L326: `list_widget.addItem`
- L384: `list_widget.addItem`
- L211: `scene.addItem`
- L250: `scene.addItem`
- L319: `item.setToolTip` → “{...} — mechanism layers active”
- L375: `item.setToolTip` → “{...} — has motion path”
- L378: `item.setToolTip` → “{...} — no motion path”
- L321: `item.setToolTip` → “{...} — disabled”
- L323: `item.setToolTip` → “{...} — no mechanism applied”

## `src/automataii/presentation/qt/tabs/mechanism_design/services/transform_service.py`

Classes:
- L17: `TransformService(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/view_utilities_service.py`

Classes:
- L22: `ViewUtilitiesService(object)`

## `src/automataii/presentation/qt/tabs/mechanism_design/services/visual_item_manager.py`

Classes:
- L20: `VisualItemManager(object)`

User-visible controls/text:
- L194: `handle.setToolTip` → “🆓 Free Edit Mode: Any position allowed”

## `src/automataii/presentation/qt/tabs/mechanism_design/tab.py`

Classes:
- L135: `MechanismDesignTab(QWidget)`

User-visible controls/text:
- L609: `self.recommendation_btn.setToolTip`
- L653: `self.mechanism_scene.addItem`
- L814: `self.mechanism_scene.addItem`

## `src/automataii/presentation/qt/tabs/mechanism_design/view_protocol.py`

Classes:
- L21: `MechanismDesignView(Protocol)`
- L120: `MechanismDesignPresenterProtocol(Protocol)`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/components/mechanism_renderer.py`

Classes:
- L27: `MechanismRenderer(object)`

User-visible controls/text:
- L276: `safety_label.setText` → “<span style='color:{...}'>{...} {...}</span>”
- L137: `safety_label.setText` → “Error: {...}”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/dialogs/custom_coupler_dialog.py`

Classes:
- L17: `CustomCouplerPointDialog(QDialog)`

User-visible controls/text:
- L27: `self.setWindowTitle` → “Custom Coupler Path”
- L45: `QLabel` → “Select a point along the coupler link to track in the path preview. / 0.0 locks to joint A, 1.0 locks to joint B. The selection adapts as the linkage moves.”
- L104: `self._value_label.setText` → “Tracking point at {...} × coupler length (~{...} mm from joint A).”
- L70: `QLabel` → “Fraction:”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/educational_info_panel.py`

Classes:
- L9: `EducationalInfoPanel(QWidget)`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/enhanced_info_panel.py`

Classes:
- L12: `EnhancedInfoPanel(QWidget)`

User-visible controls/text:
- L29: `card.setObjectName` → “mechanismBasicsCard”
- L44: `QLabel` → “Mechanism Basics”
- L53: `QLabel` → “Link Roles”
- L66: `QLabel` → “Grashof:”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/foundry_view.py`

Classes:
- L158: `_GearTrainPreviewMechanism(object)`
- L324: `_PlanetaryGearPreviewMechanism(object)`
- L460: `_SliderCrankPreviewMechanism(object)`
- L497: `MechanismFoundryView(QWidget)`

User-visible controls/text:
- L718: `QAction` → “← Back to Gallery”
- L724: `QAction` → “▶ Play”
- L731: `QAction` → “🔧 Forces”
- L737: `QAction` → “➡ Velocity”
- L743: `QAction` → “〰 Trail”
- L751: `QAction` → “🔍 Path Preview”
- L759: `QAction` → “🧠 Show Sensemaking”
- L762: `self.info_panel_action.setToolTip` → “Show or hide the explanation/sensemaking panel on the right”
- L770: `QAction` → “🔄 Reset”
- L776: `QAction` → “📤 Add to Mechanism Tab”
- L777: `export_action.setToolTip` → “Add this mechanism configuration to the Mechanism Tab for simulation”
- L1056: `QGroupBox` → “Mechanism Selection”
- L1058: `QComboBox`
- L1064: `QGroupBox` → “Parameters”
- L1069: `QGroupBox` → “Animation”
- L1074: `QLabel` → “30°”
- L1088: `QComboBox`
- L1096: `QComboBox`
- L1104: `QGroupBox` → “Display Options”
- L1106: `QLabel` → “Motions: -”
- L1124: `QLabel` → “Status: Unknown”
- L1073: `QLabel` → “Angle:”
- L1087: `QLabel` → “Valid Range:”
- L1095: `QLabel` → “Motion Point:”
- L1473: `self.angle_label.setText` → “No valid input angle”
- L1477: `self.angle_label.setText` → “No valid input angle”
- L2005: `self.play_action.setText` → “▶ Play”
- L2012: `self.play_action.setText` → “⏸ Pause”
- L1141: `self.mechanism_selector.addItem`
- L1246: `selector.addItem`
- L1398: `self.angle_range_selector.addItem` → “{...}: {...}”
- L2085: `self.safety_label.setText` → “Error: {...}”
- L1875: `label.setText` → “{...}”
- L1877: `label.setText` → “{...}”
- L3519: `label.setText` → “{...}”
- L3521: `label.setText` → “{...}”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/gallery_thumbnail.py`

Classes:
- L32: `_PreviewRenderer(Protocol)`
- L46: `GalleryThumbnail(QFrame)`

User-visible controls/text:
- L159: `QLabel` → “Click to explore →”
- L117: `motion_label.setText` → “Motions: {...}”
- L119: `motion_label.setText` → “Motions: Preview available”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/gallery_view.py`

Classes:
- L24: `GalleryView(QWidget)`

User-visible controls/text:
- L52: `QLabel` → “Mechanism Gallery”
- L63: `QLabel` → “Explore and interact with fundamental mechanisms”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/parameter_panel.py`

Classes:
- L83: `UnitSystem(str, Enum)`
- L102: `CollapsibleSection(QWidget)`
- L171: `_DimensionControl(object)`
- L291: `MechanismParameterPanel(QWidget)`

User-visible controls/text:
- L116: `QToolButton`
- L363: `QLabel` → “Status:”
- L367: `QLabel` → “Ready”
- L384: `QRadioButton` → “mm”
- L385: `QRadioButton` → “inch”
- L413: `QLabel` → “Linkage Type:”
- L429: `QLabel` → “Which link is driven?”
- L437: `QComboBox`
- L444: `QComboBox`
- L449: `QLabel` → “Educational hints”
- L474: `QLabel` → “Use these controls to explore how link lengths and driver selection change the motion. Hover over hints for quick intuition, or open the info panel for deeper dives.”
- L568: `self._dimensions_placeholder_layout.addItem`
- L382: `QLabel` → “Units:”
- L419: `QPushButton`
- L436: `QLabel` → “Coupler Point Path:”
- L443: `QLabel` → “Follower Position:”
- L585: `QRadioButton`
- L609: `self._coupler_combo.addItem`
- L625: `self._follower_combo.addItem`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/path_preview.py`

Classes:
- L22: `PathPreviewOverlay(object)`

User-visible controls/text:
- L139: `self._scene.addItem`
- L200: `self._scene.addItem`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/sensemaking_panel.py`

Classes:
- L25: `MechanismSensemakingPanel(QWidget)`

User-visible controls/text:
- L42: `self._text_display.setObjectName` → “legacyInfoTextDisplay”
- L45: `self.setObjectName` → “MechanismSensemakingPanel”
- L53: `scroll.setObjectName` → “sensemakingScrollArea”
- L60: `surface.setObjectName` → “sensemakingSurface”
- L197: `self.sensemakingChainLabel.setText` → “Cause → motion: {...} · {...}”
- L214: `self.sensemakingChainLabel.setText` → “Cause → motion: {...}”
- L253: `self.consequenceLabel.setText` → “Effect: {...}”
- L254: `self.principleLabel.setText` → “Why: {...}”
- L255: `self.evidenceLabel.setText` → “{...} / Evidence: {...}”
- L256: `self.buildHintLabel.setText` → “Build check: {...}”
- L257: `self.promptLabel.setText` → “Teacher prompt: {...}”

## `src/automataii/presentation/qt/tabs/mechanism_foundry/widgets/color_legend_widget.py`

Classes:
- L8: `ColorLegendWidget(QWidget)`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/widgets/grashof_display.py`

Classes:
- L10: `GrashofClassification(Enum)`
- L19: `GrashofAnalysis(object)`
- L56: `GrashofDisplay(QWidget)`

## `src/automataii/presentation/qt/tabs/mechanism_foundry/widgets/mechanism_info_widget.py`

Classes:
- L7: `MechanismInfoWidget(QWidget)`

## `src/automataii/presentation/qt/tabs/mechanism_visuals_factory.py`

Classes:
- L147: `MechanismVisualsFactory(object)`

User-visible controls/text:
- L307: `self.scene.addItem`
- L313: `self.scene.addItem`
- L351: `self.scene.addItem`
- L406: `coupler_marker.setToolTip` → “Coupler Point (follows path)”
- L925: `cam_body.setToolTip` → “Cam Profile”
- L926: `self.scene.addItem`
- L939: `contact_marker.setToolTip` → “Cam Contact Point”
- L940: `self.scene.addItem`
- L951: `follower_rod.setToolTip` → “Connecting Rod”
- L952: `self.scene.addItem`
- L966: `follower_body.setToolTip` → “Follower Head”
- L967: `self.scene.addItem`
- L980: `follower_anchor.setToolTip` → “Follower Guide”
- L981: `self.scene.addItem`
- L992: `cam_center_marker.setToolTip` → “Cam Center - Rotation axis”
- L993: `self.scene.addItem`
- L330: `self.scene.addItem`
- L344: `self.scene.addItem`
- L377: `outer_pivot.setToolTip`
- L529: `self.scene.addItem`
- L535: `self.scene.addItem`
- L541: `self.scene.addItem`
- L547: `self.scene.addItem`
- L553: `self.scene.addItem`
- L635: `self.scene.addItem`
- L641: `self.scene.addItem`
- L647: `self.scene.addItem`
- L653: `self.scene.addItem`
- L659: `self.scene.addItem`
- L665: `self.scene.addItem`
- L670: `self.scene.addItem`
- L565: `self.scene.addItem`
- L573: `self.scene.addItem`
- L682: `self.scene.addItem`
- L690: `self.scene.addItem`
- L1037: `self.scene.addItem`

## `src/automataii/presentation/qt/tabs/options_tab.py`

Classes:
- L31: `OptionsTab(QWidget)`

User-visible controls/text:
- L89: `QGroupBox` → “Appearance”
- L92: `QComboBox`
- L93: `self.theme_combo.addItems` → “Light, Dark”
- L98: `self.theme_combo.setToolTip` → “Select the application color theme.”
- L101: `QCheckBox` → “Show Toolbar”
- L107: `self.toolbar_toggle_check.setToolTip` → “Show or hide the main application toolbar.”
- L111: `QCheckBox` → “Show Part Properties Panel”
- L117: `self.part_props_toggle_check.setToolTip` → “Show or hide the 'Selected Part Properties' panel in the Editor tab.”
- L125: `QGroupBox` → “Simulation”
- L136: `self.anim_duration_spin.setToolTip` → “Set the duration for one loop of the simulation animation (in seconds).”
- L142: `QComboBox`
- L143: `self.timing_combo.addItems` → “Linear, Ease-In, Ease-Out, Ease-In-Out”
- L149: `self.timing_combo.setToolTip` → “Select the timing curve used to map animation progress (pacing).”
- L157: `QGroupBox` → “Performance”
- L160: `QComboBox`
- L161: `self.perf_preset_combo.addItems` → “Fast, Balanced, High”
- L167: `self.perf_preset_combo.setToolTip` → “Choose a performance preset for mechanism simulation (Fast/Balanced/High).”
- L172: `QLabel` → “Fast: smoother FPS, simpler visuals / Balanced: default settings / High: finer visuals, more updates”
- L185: `QComboBox`
- L186: `self.physics_snap_combo.addItems` → “Fast, Balanced, High”
- L192: `self.physics_snap_combo.setToolTip` → “Set guard strength for soft physics snaps (4-bar, gears, cam).”
- L200: `QGroupBox` → “Debugging”
- L203: `QCheckBox` → “Enable Debug Visuals”
- L209: `self.debug_mode_check.setToolTip` → “Enable/disable debug visualizations in the image processing view.”
- L217: `QGroupBox` → “Workflow Customization”
- L220: `QCheckBox` → “Show Detailed Processing Steps”
- L226: `self.adv_proc_toggle_check.setToolTip` → “Show or hide the detailed step-by-step processing controls in the Character Selection tab.”
- L231: `QCheckBox` → “Enable Autosave”
- L233: `self.autosave_enabled_check.setToolTip` → “Keep a lightweight recovery snapshot when the project has changed.”
- L245: `self.autosave_interval_spin.setToolTip` → “Minimum time between autosaves. Unchanged projects are skipped.”
- L257: `QGroupBox` → “Fabrication / Blueprint Export”
- L260: `QComboBox`
- L261: `self.blueprint_export_format_combo.addItem` → “PDF (default)”
- L262: `self.blueprint_export_format_combo.addItem` → “SVG”
- L267: `self.blueprint_export_format_combo.setToolTip` → “Choose the file type for current-design cut sheets. Assembly guides remain PDF-first when available.”
- L275: `QGroupBox` → “Fabrication Presets & Display Units”
- L278: `QComboBox`
- L279: `self.unit_combo.addItems` → “cm, inch, px”
- L282: `self.unit_combo.setToolTip` → “Select the unit system for grid display in editor views.”
- L285: `QCheckBox` → “Fabrication-ready preset mode”
- L288: `self.grid_system_check.setToolTip` → “Default on: snap mechanisms to the physical board kit so blueprint exports can produce LEGO-style assembly guides. Turn off only for Custom / Simulation-only exploration.”
- L303: `QComboBox`
- L311: `self.grid_pitch_combo.setToolTip` → “Choose a physical pegboard pitch. The default board pitch is 20.0 mm (2.0 cm).”
- L325: `self.grid_cell_size_spin.setToolTip` → “Read-only pitch display. Choose one of the supported physical board presets above.”
- L305: `self.grid_pitch_combo.addItem`

## `src/automataii/presentation/qt/tabs/parametric/components/animation_coordinator.py`

Classes:
- L19: `AnimationController(Protocol)`
- L27: `AnimationCoordinator(object)`

## `src/automataii/presentation/qt/tabs/parametric/components/visual_updater.py`

Classes:
- L20: `VisualsFactory(Protocol)`
- L49: `VisualUpdater(object)`

## `src/automataii/presentation/qt/tabs/parametric_editing_manager.py`

Classes:
- L47: `ParametricEditingManager(object)`

## `src/automataii/presentation/qt/tabs/visualizers/cam_visualizer.py`

Classes:
- L43: `CamVisualizer(BaseMechanismVisualizer)`

User-visible controls/text:
- L294: `cam_body.setToolTip` → “Cam Profile”
- L295: `self.scene.addItem`
- L338: `follower_body.setToolTip` → “Follower - Moves up/down as cam rotates”
- L339: `self.scene.addItem`
- L366: `cam_center_marker.setToolTip` → “Cam Center - Rotation axis”
- L367: `self.scene.addItem`
- L401: `follower_rod.setToolTip` → “Connecting Rod”
- L402: `self.scene.addItem`
- L458: `self.scene.addItem`

## `src/automataii/presentation/qt/tabs/visualizers/gear_visualizer.py`

Classes:
- L34: `GearVisualizer(BaseMechanismVisualizer)`
- L340: `PlanetaryGearVisualizer(BaseMechanismVisualizer)`

User-visible controls/text:
- L213: `gear_body.setToolTip`
- L599: `sun_gear.setToolTip` → “Sun Gear (Stationary)”
- L625: `planet_gear.setToolTip` → “Planet Gear (Orbiting)”
- L648: `arm_line.setToolTip` → “Carrier Arm”
- L662: `tracking_marker.setToolTip` → “Tracking Point - Traces output path”
- L690: `sun_marker.setToolTip` → “Sun Center - Fixed pivot”
- L703: `planet_marker.setToolTip` → “Planet Center - Orbiting pivot”

## `src/automataii/presentation/qt/tabs/visualizers/linkage_visualizer.py`

Classes:
- L35: `FourBarVisualizer(BaseMechanismVisualizer)`
- L354: `FiveBarVisualizer(BaseMechanismVisualizer)`
- L501: `SixBarVisualizer(BaseMechanismVisualizer)`

User-visible controls/text:
- L174: `self.scene.addItem`
- L182: `self.scene.addItem`
- L221: `self.scene.addItem`
- L264: `coupler_marker.setToolTip` → “Coupler Point (follows path)”
- L200: `self.scene.addItem`
- L213: `self.scene.addItem`
- L244: `outer_pivot.setToolTip`
- L393: `self.scene.addItem`
- L399: `self.scene.addItem`
- L405: `self.scene.addItem`
- L411: `self.scene.addItem`
- L418: `self.scene.addItem`
- L470: `self.scene.addItem`
- L477: `self.scene.addItem`
- L541: `self.scene.addItem`
- L547: `self.scene.addItem`
- L553: `self.scene.addItem`
- L559: `self.scene.addItem`
- L565: `self.scene.addItem`
- L573: `self.scene.addItem`
- L578: `self.scene.addItem`
- L633: `self.scene.addItem`
- L640: `self.scene.addItem`

## `src/automataii/presentation/qt/tabs/visualizers/protocol.py`

Classes:
- L20: `MechanismVisualizerProtocol(Protocol)`
- L91: `BaseMechanismVisualizer(object)`

## `src/automataii/presentation/qt/tabs/visualizers/registry.py`

Classes:
- L24: `MechanismVisualizerNotFoundError(Exception)`
- L30: `MechanismVisualizerRegistry(object)`

## `src/automataii/presentation/qt/views/components/motion_path_controller.py`

Classes:
- L24: `MotionPathController(QObject)`

User-visible controls/text:
- L121: `self._scene.addItem`

## `src/automataii/presentation/qt/views/components/path_drawing_handler.py`

Classes:
- L29: `TimedQPointF(object)`
- L44: `PathDrawingHandler(object)`

User-visible controls/text:
- L241: `self._scene.addItem`
- L282: `self._scene.addItem`
- L310: `self._scene.addItem`
- L209: `self._scene.addItem`

## `src/automataii/presentation/qt/views/components/path_vertex_editor.py`

Classes:
- L37: `PathVertexHandle(QGraphicsObject)`
- L160: `PathVertexEditor(QObject)`

User-visible controls/text:
- L241: `self._scene.addItem`
- L439: `self._scene.addItem`

## `src/automataii/presentation/qt/views/components/skeleton_visual_handler.py`

Classes:
- L25: `SkeletonVisualHandler(object)`

User-visible controls/text:
- L106: `self._scene.addItem`

## `src/automataii/presentation/qt/views/components/skeleton_visualizer.py`

Classes:
- L24: `SkeletonVisualizer(QObject)`

User-visible controls/text:
- L212: `self._scene.addItem`
- L230: `self._scene.addItem`

## `src/automataii/presentation/qt/views/editor_view.py`

Classes:
- L50: `EditorView(QGraphicsView)`

User-visible controls/text:
- L196: `self.scene.addItem`
- L784: `QMenu`
- L785: `menu.addAction` → “Zoom In”
- L786: `menu.addAction` → “Zoom Out”
- L787: `menu.addAction` → “Zoom to Fit”
- L789: `menu.addAction` → “Reset View”
- L799: `menu.addAction` → “Set '{...}' as Cam Follower”
- L1075: `self.scene.addItem`
- L1405: `self.scene.addItem`

## `src/automataii/presentation/qt/views/motion_path_manager.py`

Classes:
- L34: `TimedPoint(object)`
- L49: `MotionPathDrawer(QObject)`

User-visible controls/text:
- L293: `self._scene.addItem`
- L325: `self._scene.addItem`
- L216: `self._scene.addItem`
- L220: `self._scene.addItem`
- L431: `self._scene.addItem`

## `src/automataii/presentation/qt/widgets/common/zoom_controls.py`

Classes:
- L22: `ZoomControlsWidget(QWidget)`

User-visible controls/text:
- L103: `QPushButton` → “+”
- L104: `self.zoom_in_btn.setToolTip` → “Zoom In”
- L110: `QPushButton` → “−”
- L111: `self.zoom_out_btn.setToolTip` → “Zoom Out”
- L117: `QPushButton` → “⌖”
- L118: `self.zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L125: `QPushButton` → “1:1”
- L126: `self.zoom_reset_btn.setToolTip` → “Reset Zoom (100%)”
- L136: `QPushButton` → “⎈”
- L137: `self.center_btn.setToolTip` → “Center on Character”

## `src/automataii/presentation/qt/widgets/processing_steps_group.py`

Classes:
- L5: `ProcessingStepsGroup(QGroupBox)`

User-visible controls/text:
- L107: `QPushButton` → “Toggle Steps Visibility”
- L24: `QPushButton` → “Process Image (Skeleton)”
- L28: `QPushButton` → “Edit Skeleton”
- L32: `QPushButton` → “Save Skeleton”
- L36: `QPushButton` → “Generate Body Parts”
- L50: `QPushButton` → “Extend Skeleton 10%”
- L51: `self.extend_skeleton_btn.setToolTip` → “Increase all skeleton bone lengths by 10%”
- L55: `QPushButton` → “Lock/Unlock Joints”
- L56: `self.lock_joints_btn.setToolTip` → “Select joints to lock/unlock for IK solving”

## `src/automataii/presentation/qt/widgets/scrollable_tab_bar.py`

Classes:
- L10: `ScrollableTabBar(QTabBar)`

## `src/automataii/presentation/qt/widgets/view_controls.py`

Classes:
- L11: `HoverViewControls(QWidget)`

User-visible controls/text:
- L46: `QLabel` → “View Controls”
- L48: `title_label.setObjectName` → “title”
- L55: `QPushButton` → “+”
- L57: `self.zoom_in_btn.setToolTip` → “Zoom In”
- L60: `QPushButton` → “-”
- L62: `self.zoom_out_btn.setToolTip` → “Zoom Out”
- L65: `QPushButton` → “Fit”
- L67: `self.zoom_fit_btn.setToolTip` → “Zoom to Fit”
- L70: `QPushButton` → “1:1”
- L72: `self.zoom_reset_btn.setToolTip` → “Reset Zoom (100%)”
- L87: `QLabel` → “Zoom:”
- L94: `self.zoom_slider.setToolTip` → “Zoom Level”
- L97: `QLabel` → “100%”
- L173: `self.zoom_value_label.setText` → “{...}%”
- L182: `self.zoom_value_label.setText` → “{...}%”

## `src/automataii/presentation/qt/windows/components/project_controller.py`

Classes:
- L73: `StatusBarProvider(Protocol)`
- L79: `ProjectController(QObject)`

## `src/automataii/presentation/qt/windows/components/signal_connector.py`

Classes:
- L26: `SignalHandler(Protocol)`
- L48: `SignalConnector(QObject)`

## `src/automataii/presentation/qt/windows/components/tab_orchestrator.py`

Classes:
- L23: `TabOrchestrator(QObject)`

## `src/automataii/presentation/qt/windows/components/workflow_state_machine.py`

Classes:
- L17: `WorkflowMode(str, Enum)`
- L22: `WorkflowStateMachine(QObject)`

## `src/automataii/presentation/qt/windows/components/workspace_layout_manager.py`

Classes:
- L20: `WorkspaceLayoutManager(QObject)`

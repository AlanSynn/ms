export type MechanismType = 'crank' | '4bar' | 'piston' | 'yoke' | 'quick-return' | '5bar' | '6bar' | 'cam' | 'rack-pinion' | 'gear' | 'gear_linkage' | 'planetary_gear';
export type FabricationRecipeType = MechanismType | 'graph';
export type AppStage = 'character' | 'path' | 'foundry' | 'design' | 'blueprint' | 'assembly' | 'options';

export interface Point {
    x: number;
    y: number;
}

export interface CanvasViewport {
    offset: Point;
    zoom: number;
}

export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Transform {
    x: number;
    y: number;
    rotation: number;
    scale: number;
}

export type ConnectionSelectionRole =
    | '4bar.input-joint'
    | '4bar.output-joint'
    | 'gear_linkage.drive-pin'
    | 'gear_linkage.output-pin'
    | 'gear.drive-pin'
    | 'gear.output-pin'
    | 'planetary_gear.carrier-planet-pivot'
    | 'planetary_gear.carrier-output-hole'
    | 'cam.guide-mount'
    | 'cam.follower-output-hole'
    | 'piston.crank-pin'
    | 'piston.rod-slider-pin'
    | 'piston.guide-mount';

export type FabricationLinkageKey = `linkage-${number}-cell`;
export type FabricationGearKey = 'g8' | 'g24' | 'g40' | 'g56';
export type FabricationBoardMountKey = 'cam-guide-2-hole' | 'piston-guide-3-hole';
export type FabricationModuleKey = 'gravity-follower-module-v2';
export type FabricationModuleHoleId = 'output-0' | 'output-1' | 'output-2';

export type ConnectionSelection =
    | { kind: 'linkage-hole'; linkageKey: FabricationLinkageKey; holeIndex: number }
    | { kind: 'gear-attachment-hole'; gearKey: FabricationGearKey; gearIndex: number; holeIndex: number }
    | {
        kind: 'board-mount-pattern';
        mountKey: FabricationBoardMountKey;
        /** Ordered physical board-hole tuple; never a scalar board-hole substitute. */
        boardHoleIds: readonly string[];
      }
    | {
        kind: 'module-hole';
        moduleKey: FabricationModuleKey;
        holeId: FabricationModuleHoleId;
      };

export type ConnectionSelections = Partial<Record<ConnectionSelectionRole, ConnectionSelection>>;

export type RejectedConnectionSelectionReason =
    | 'invalid-selection-shape'
    | 'invalid-role'
    | 'wrong-family'
    | 'invalid-kind'
    | 'invalid-inventory-key'
    | 'invalid-index'
    | 'invalid-mount-pattern'
    | 'incompatible-selection';

/**
 * Bounded recovery-only evidence for a rejected imported connection. This is
 * deliberately not an authored selection and never contains raw JSON or UI
 * coordinates.
 */
export interface RejectedConnectionSelectionDiagnostic {
    sourceVersion: 1 | 2;
    role: ConnectionSelectionRole | 'unknown';
    kind: ConnectionSelection['kind'] | 'unknown';
    catalogKey?: string;
    indices?: number[];
    reason: RejectedConnectionSelectionReason;
}

export interface ConnectionSelectionValidation {
    status: 'valid' | 'invalid';
    entries: Array<{
        role: string;
        status: 'accepted' | 'defaulted' | 'rejected';
        reason?: string;
    }>;
}

export interface MechanismConfig {
    id: string;
    type: MechanismType;
    visible: boolean;
    enabled: boolean;
    color: string;

    // Position & Orientation
    anchorX?: number;
    anchorY?: number;
    groundAngle?: number;

    // Dimensions
    crankLength: number;
    groundLength: number;
    couplerLength: number;
    rockerLength: number;
    sliderOffset: number;
    couplerPointDist: number;
    couplerPointAngle: number;
    assemblyMode?: 'open' | 'crossed';

    // 5-Bar / Advanced
    speed1?: number;
    speed2?: number;
    gearRatio?: number;
    /**
     * Ordered pitch radii for an external spur gear train.
     * Two entries are the legacy drive/output pair; extra entries are idlers.
     */
    gearTrainRadii?: number[];
    /**
     * Cyclic angle-indexed cam radius/lift samples. Kinematics, 3D preview, and
     * fabrication preview all read this same list so edited cams do not drift.
     */
    camProfileSamples?: number[];
    driverGroupId?: string;
    driverPhaseOffset?: number;
    rodLength?: number;
    phase?: number;

    // Visuals + rebuild metadata
    transform?: Transform;
    sceneAnchor?: Point;
    activeVisualPartIds?: string[];
    fabricationMetadata?: {
        boardCoordinate?: string;
        gridPitchMm?: number;
        sceneAnchor?: Point;
        targetPathId?: string;
        requiredParts?: FabricationPartRequirement[];
        warnings?: string[];
    };
    foundryExport?: FoundryExportPackage;
    showOutputGear?: boolean;
    outputGearRadius?: number;
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    presetId?: string;
    recommendation?: string;
    source?: 'manual' | 'foundry' | 'optimized' | 'imported';
    generatedPath?: Point[];
    warnings?: string[];
    connectionSelections?: ConnectionSelections;
    connectionSelectionValidation?: ConnectionSelectionValidation;
    rejectedConnectionSelectionDiagnostics?: RejectedConnectionSelectionDiagnostic[];
}

export interface FoundryExportPackage {
    id: string;
    createdAt: string;
    mechanismId: string;
    mechanismType: MechanismType;
    parameters: Partial<MechanismConfig>;
    pivot: Point;
    outputPoint?: Point;
    generatedPath: Point[];
    simulationSummary: string;
    visual: { color: string; scale: number; constraintsVisible: boolean };
    animation: { duration: number; steps: number; loop: boolean };
    metadata: { sourceTab: string; selectedPreset?: string; recommendation?: string; simulationFriction?: number; simulationMassKg?: number; connectionExportSignature?: string };
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    warnings: string[];
    source: 'mechanism-foundry';
}

export type MechanismCommitIntent = 'simulation-only' | 'fabrication-package';

export interface MechanismRecoveryCandidates {
    targetPartIds: string[];
    targetSceneObjectIds: string[];
    targetPathIds: string[];
    targetAnchorJointIds: string[];
}

export interface MechanismEditFeedback {
    mechanismId: string;
    blocker: string;
    recoveryCandidates: MechanismRecoveryCandidates;
}

type MechanismCandidateTransactionBase = {
    intent: MechanismCommitIntent;
    mechanism: MechanismConfig;
    previousExists: boolean;
    fingerprint?: string;
    foundryExport?: FoundryExportPackage;
    blocker?: string;
    recoveryCandidates?: MechanismRecoveryCandidates;
};

export type MechanismCandidateTransactionResult = MechanismCandidateTransactionBase & (
    | { status: 'ready' }
    | { status: 'committed' }
    | { status: 'blocked' }
);

export interface GlobalConfig {
    speed: number;
    rotation: number;
    mechanisms: MechanismConfig[];
}

export interface JointState {
    p1: Point;
    p2: Point;
    j1: Point;
    j2: Point;
    aux?: Point;
    effector: Point;
    isValid: boolean;
}

export interface StandardJoint {
    id: string;
    name: string;
    position: Point;
    parentId?: string | null;
    locked: boolean;
    bendDirection: number;
}

export interface StandardSkeleton {
    joints: Record<string, StandardJoint>;
    bones: [string, string][];
    rootJointIds: string[];
    jointMap: Record<string, string>;
    hierarchy: Record<string, string[]>;
    metadata: {
        sourceFormat: string;
        scale: number;
        imageBounds?: Bounds;
        normalization?: string;
        [key: string]: unknown;
    };
}

export interface BodyPartLayer {
    id: string;
    name: string;
    textureUrl?: string;
    maskUrl?: string;
    sourceImageFrame?: Bounds;
    contourPoints?: Point[];
    contourSource?: 'onnx-mask' | 'user' | 'imported';
    originalSvgPath?: string;
    enhancedSvgPath?: string;
    anchorJointId: string;
    transform: Transform;
    zIndex: number;
    opacity: number;
    visible: boolean;
    locked: boolean;
    selectable: boolean;
    bounds: Bounds;
    localPivotOffset?: Point;
    localPivotJointId?: string;
    group?: string;
    fillColor: string;
}

export interface ProjectMotionPath {
    id: string;
    partId: string;
    sceneObjectId?: string;
    targetAnchorJointId?: string;
    chainRootJointId?: string;
    smoothness?: number;
    points: Point[];
    timedPoints?: Array<Point & { time: number }>;
    duration: number;
    closed: boolean;
    enabled: boolean;
    visible: boolean;
    source: 'drawn' | 'tracked' | 'generated' | 'imported';
    warnings: string[];
}

export interface PhysicalKitSettings {
    profileKey: string;
    gridPitchMm: number;
    sheetWidthMm: number;
    sheetHeightMm: number;
    boardCells: number;
    holeDiameterMm: number;
    exportMode: 'custom-parts' | 'prefab-board' | 'both';
    defaultExportFormat: 'svg' | 'json' | 'both';
    cutSheetFileType: 'pdf' | 'svg';
}

export interface AppSettings {
    animationSpeed: number;
    animationDurationMs: number;
    timingProfile: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'realtime' | 'slow' | 'presentation';
    theme: 'light' | 'dark' | 'blueprint';
    uiTextScale: 'compact' | 'normal' | 'large';
    toolbarVisible: boolean;
    partPanelVisible: boolean;
    autosave: boolean;
    autosaveIntervalSeconds: number;
    performancePreset: 'fast' | 'balanced' | 'high';
    physicsSnapMode: 'fast' | 'balanced' | 'high';
    simulationFriction: number;
    simulationMassKg: number;
    debugVisuals: boolean;
    detailedProcessingSteps: boolean;
    classroomAssessmentKey: string;
    gridUnit: 'cm' | 'inch' | 'px';
    fabricationReadyMode: boolean;
    physicalKit: PhysicalKitSettings;
}

export interface ProcessingStatus {
    stage: 'idle' | 'selecting' | 'preparing-image' | 'downloading-model' | 'loading-model' | 'running-onnx' | 'extracting-parts' | 'normalizing' | 'ready' | 'error';
    message: string;
    progress: number;
    error?: string;
}

export interface FabricationPartRequirement {
    name: string;
    quantity: number;
    label?: string;
    count?: number;
    part?: string;
    category?: string;
    key?: string;
}

export interface AssemblyStepStackItem {
    order: number;
    label: string;
    role: string;
    part?: string;
    sourceNodeId?: string;
    sourceConstraintIds?: string[];
    axialRole?: 'structural' | 'spacer' | 'back-retainer' | 'front-retainer';
}

export interface FabricationRecipe {
    mechanismId: string;
    type: FabricationRecipeType;
    graphFamilyId?: string;
    graphSource?: string;
    compilerSource?: string;
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    targetPartName?: string;
    targetSceneObjectName?: string;
    targetPathPointCount?: number;
    boardCoordinate: string;
    board: { col: number; row: number; xMm: number; yMm: number; valid?: boolean };
    sceneAnchor: Point;
    offsetFromBoardMm: Point;
    camProfileSamples?: number[];
    requiredParts: FabricationPartRequirement[];
    steps: string[];
    assemblySteps: Array<{
        index: number;
        label: string;
        role: string;
        boardCoordinate: string;
        zMm: number;
        instruction: string;
        title?: string;
        action?: string;
        coords?: string[];
        coordRoles?: string[];
        check?: string;
        stack?: AssemblyStepStackItem[];
    }>;
    warnings: string[];
}

export interface FabricationPackage {
    id: string;
    createdAt: string;
    projectName: string;
    sceneSnapshot: Pick<ProjectState, 'metadata' | 'parts' | 'partOrder' | 'sceneObjects' | 'sceneObjectOrder' | 'skeleton' | 'paths' | 'mechanisms' | 'settings'>;
    recipes: FabricationRecipe[];
    cutList: Array<{ name: string; quantity: number }>;
    warnings: string[];
    validationIssues: FabricationIssue[];
    svg: string;
    cutSheetPdf: string;
    customPartsSvg: string;
    customPartsPdf: string;
    customPartsStl: string;
    assemblyGuideHtml: string;
    assemblyGuidePdf: string;
    metadataJson: string;
}

export interface FabricationIssue {
    severity: 'warning' | 'error';
    message: string;
    mechanismId?: string;
    partId?: string;
    pathId?: string;
    recoveryStage: AppStage;
    recoveryAction: string;
}

export interface SceneObject {
    id: string;
    name: string;
    shape: 'piggy-bank' | 'cloud' | 'star' | 'block';
    textureUrl?: string;
    contourPoints?: Point[];
    contourSource?: 'imported' | 'user';
    sourceImageName?: string;
    transform: Transform;
    bounds: { width: number; height: number };
    fillColor: string;
    opacity: number;
    visible: boolean;
    locked: boolean;
    zIndex: number;
}

export interface CharacterPackageArtifact {
    id: string;
    createdAt: string;
    sourceImageName: string;
    outputDir: string;
    partsInfo: unknown;
    charCfg: unknown;
    maskUrl?: string;
    sourceTextureUrl?: string;
    keypoints?: unknown;
    replacementContext?: {
        mode: 'plain-load' | 'replace-character';
        previousStage?: AppStage;
        rebindingSummary: string;
    };
}

export interface ProjectState {
    version: 2;
    metadata: {
        id: string;
        name: string;
        sourceImageName?: string;
        classroomLessonId?: string;
        classroomLessonLabel?: string;
        createdAt: string;
        updatedAt: string;
        normalizationScale: number;
        status: 'empty' | 'sample' | 'processed' | 'imported';
    };
    parts: Record<string, BodyPartLayer>;
    partOrder: string[];
    sceneObjects: Record<string, SceneObject>;
    sceneObjectOrder: string[];
    skeleton: StandardSkeleton | null;
    paths: Record<string, ProjectMotionPath>;
    mechanisms: MechanismConfig[];
    settings: AppSettings;
    selectedPartId?: string;
    selectedPathId?: string;
    selectedMechanismId?: string;
    selectedSceneObjectId?: string;
    processing: ProcessingStatus;
    lastExport?: FabricationPackage;
    characterPackage?: CharacterPackageArtifact;
    lastFoundryExport?: FoundryExportPackage;
}

export type ProjectSnapshotLoadResult =
    | {
        status: 'loaded';
        project: ProjectState;
        sourceVersion: 1 | 2;
        migrated: boolean;
        diagnostics: RejectedConnectionSelectionDiagnostic[];
      }
    | {
        status: 'rejected';
        project: ProjectState;
        blocker: 'Fix: Update project';
        reason: 'unsupported-version' | 'invalid-snapshot';
      };

export type ProjectAction =
    | { type: 'load_project'; project: unknown }
    | { type: 'set_processing'; processing: ProcessingStatus }
    | { type: 'select_part'; partId?: string }
    | { type: 'select_scene_object'; objectId?: string }
    | { type: 'upsert_part'; part: BodyPartLayer }
    | { type: 'delete_part'; partId: string }
    | { type: 'update_part'; partId: string; updates: Partial<BodyPartLayer> }
    | { type: 'reorder_part'; partId: string; direction: -1 | 1 }
    | { type: 'upsert_scene_object'; object: SceneObject }
    | { type: 'update_scene_object'; objectId: string; updates: Partial<SceneObject> }
    | { type: 'delete_scene_object'; objectId: string }
    | { type: 'set_skeleton'; skeleton: StandardSkeleton | null }
    | { type: 'update_joint'; jointId: string; updates: Partial<StandardJoint> }
    | { type: 'add_joint'; joint: StandardJoint }
    | { type: 'remove_joint'; jointId: string }
    | { type: 'upsert_path'; path: ProjectMotionPath }
    | { type: 'delete_path'; pathId: string }
    | { type: 'set_mechanisms'; mechanisms: MechanismConfig[]; selectedMechanismId?: string }
    | {
        type: 'upsert_mechanism';
        mechanism: MechanismConfig;
        replaceMechanismId?: string;
      }
    | { type: 'commit_mechanism_candidate'; result: MechanismCandidateTransactionResult & { status: 'committed' | 'blocked' } }
    | { type: 'delete_mechanism'; mechanismId: string }
    | { type: 'update_settings'; settings: Partial<AppSettings> }
    | { type: 'set_export'; fabricationPackage: FabricationPackage };

// Tracking Feature Types
export interface TrackingPoint {
    x: number;
    y: number;
    frame: number;
    visible?: boolean;
}

export interface MotionPath {
    points: TrackingPoint[];
    duration: number;
    sourceMedia: string;
    frameCount: number;
    fps: number;
}

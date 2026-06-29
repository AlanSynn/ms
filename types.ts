export type MechanismType = 'crank' | '4bar' | 'piston' | 'yoke' | 'quick-return' | '5bar' | '6bar' | 'cam' | 'rack-pinion' | 'gear' | 'gear_linkage' | 'planetary_gear';
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
    targetPathId?: string;
    targetAnchorJointId?: string;
    presetId?: string;
    recommendation?: string;
    source?: 'manual' | 'foundry' | 'optimized' | 'imported';
    generatedPath?: Point[];
    warnings?: string[];
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
    metadata: { sourceTab: string; selectedPreset?: string; recommendation?: string; simulationFriction?: number; simulationMassKg?: number };
    targetPartId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    warnings: string[];
    source: 'mechanism-foundry';
}

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
    gridUnit: 'cm' | 'inch' | 'px';
    fabricationReadyMode: boolean;
    physicalKit: PhysicalKitSettings;
}

export interface ProcessingStatus {
    stage: 'idle' | 'selecting' | 'downloading-model' | 'loading-model' | 'running-onnx' | 'extracting-parts' | 'normalizing' | 'ready' | 'error';
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
}

export interface FabricationRecipe {
    mechanismId: string;
    type: MechanismType;
    targetPartId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    targetPartName?: string;
    targetPathPointCount?: number;
    boardCoordinate: string;
    board: { col: number; row: number; xMm: number; yMm: number; valid?: boolean };
    sceneAnchor: Point;
    offsetFromBoardMm: Point;
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
    sceneSnapshot: Pick<ProjectState, 'metadata' | 'parts' | 'partOrder' | 'skeleton' | 'paths' | 'mechanisms' | 'settings'>;
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

export interface CharacterPackageArtifact {
    id: string;
    createdAt: string;
    sourceImageName: string;
    outputDir: string;
    partsInfo: unknown;
    charCfg: unknown;
    maskUrl?: string;
    keypoints?: unknown;
    replacementContext?: {
        mode: 'plain-load' | 'replace-character';
        previousStage?: AppStage;
        rebindingSummary: string;
    };
}

export interface ProjectState {
    version: 1;
    metadata: {
        id: string;
        name: string;
        sourceImageName?: string;
        createdAt: string;
        updatedAt: string;
        normalizationScale: number;
        status: 'empty' | 'sample' | 'processed' | 'imported';
    };
    parts: Record<string, BodyPartLayer>;
    partOrder: string[];
    skeleton: StandardSkeleton | null;
    paths: Record<string, ProjectMotionPath>;
    mechanisms: MechanismConfig[];
    settings: AppSettings;
    selectedPartId?: string;
    selectedPathId?: string;
    selectedMechanismId?: string;
    processing: ProcessingStatus;
    lastExport?: FabricationPackage;
    characterPackage?: CharacterPackageArtifact;
    lastFoundryExport?: FoundryExportPackage;
}

export type ProjectAction =
    | { type: 'load_project'; project: ProjectState }
    | { type: 'set_processing'; processing: ProcessingStatus }
    | { type: 'select_part'; partId?: string }
    | { type: 'upsert_part'; part: BodyPartLayer }
    | { type: 'delete_part'; partId: string }
    | { type: 'update_part'; partId: string; updates: Partial<BodyPartLayer> }
    | { type: 'reorder_part'; partId: string; direction: -1 | 1 }
    | { type: 'set_skeleton'; skeleton: StandardSkeleton | null }
    | { type: 'update_joint'; jointId: string; updates: Partial<StandardJoint> }
    | { type: 'add_joint'; joint: StandardJoint }
    | { type: 'remove_joint'; jointId: string }
    | { type: 'upsert_path'; path: ProjectMotionPath }
    | { type: 'delete_path'; pathId: string }
    | { type: 'set_mechanisms'; mechanisms: MechanismConfig[]; selectedMechanismId?: string }
    | { type: 'upsert_mechanism'; mechanism: MechanismConfig }
    | { type: 'delete_mechanism'; mechanismId: string }
    | { type: 'update_settings'; settings: Partial<AppSettings> }
    | { type: 'set_export'; fabricationPackage: FabricationPackage }
    | { type: 'set_foundry_export'; foundryExport: FoundryExportPackage };

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

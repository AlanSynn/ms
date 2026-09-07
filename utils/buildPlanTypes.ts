import type {
    AssemblyStepStackItem,
    Bounds,
    FabricationRecipe,
    MechanismConfig,
    PhysicalKitSettings,
    Point,
    Transform
} from '../types';

export const BUILD_PLAN_SCHEMA_V1 = 'motionsmith.build-plan.v1' as const;

export type BuildPlanScopeV1 = 'complete' | 'character';
export type BuildPlanLaneV1 = 'kit' | 'custom';
export type BuildPlanPartKindV1 = 'character' | 'object' | 'mechanism';
export type BuildPlanStepScopeV1 = 'character' | 'object' | 'mechanism';
export type BuildPlanStepPhaseV1 =
    | 'character-parts'
    | 'cut-object'
    | 'place-object'
    | 'fixed-pins'
    | 'free-pivots'
    | 'attach-character'
    | 'test-character'
    | 'prepare-parts'
    | 'assemble-module'
    | 'mount-to-board'
    | 'connect-character'
    | 'test-motion'
    | 'export';
export type BuildPlanMotionV1 = 'none' | 'explode_z' | 'mount_travel_xy' | 'connect_travel_xy' | 'scrub_time';

export type BuildPlanPartV1 = {
    ref: string;
    kind: BuildPlanPartKindV1;
    name: string;
    displayName: string;
    quantity: number;
    sourcePartId?: string;
    sourceSceneObjectId?: string;
    mechanismId?: string;
    category?: string;
    key?: string;
};

export type BuildPlanStackItemV1 = AssemblyStepStackItem & {
    ref: string;
    partRef?: string;
};

export type BuildPlanStepV1 = {
    id: string;
    order: number;
    index: number;
    sectionId: string;
    scope: BuildPlanStepScopeV1;
    mechanismId?: string;
    mechanismRef?: string;
    sourceStepIndex?: number;
    label: string;
    phase: BuildPlanStepPhaseV1;
    motion: BuildPlanMotionV1;
    action: string;
    coords: string[];
    coordRoles: string[];
    zMm: number;
    instruction: string;
    check?: string;
    stack: BuildPlanStackItemV1[];
    partRefs: string[];
    pinIds: string[];
};

export type BuildPlanCharacterPartV1 = {
    id: string;
    ref: string;
    sourcePartId: string;
    name: string;
    fillColor: string;
    outline: Point[];
    pivot: Point;
    /** Authoritative owner-local Y-up to scene transform, shared with print placement. */
    localToScene: Transform;
    artwork: BuildPlanArtworkV1;
};

export type BuildPlanArtworkV1 = {
    ownerKind: 'part' | 'scene-object';
    ownerId: string;
    revision: string;
    frame: Bounds;
};

export type BuildPlanObjectPartV1 = Omit<BuildPlanCharacterPartV1, 'sourcePartId'> & {
    sourceSceneObjectId: string;
};

export type BuildPlanObjectsV1 = {
    id: 'objects';
    parts: BuildPlanObjectPartV1[];
    partRefs: string[];
    stepIds: string[];
};

export type BuildPlanBoardPointV1 = {
    col: number;
    row: number;
    xMm: number;
    yMm: number;
    label: string;
    valid: boolean;
};

export type BuildPlanCharacterPinV1 = {
    id: string;
    ref: string;
    jointId: string;
    label: string;
    role: 'fixed_pin' | 'free_pivot' | 'moving_pin';
    scene: Point;
    boardCoordinate?: string;
    board?: BuildPlanBoardPointV1;
    partIds: string[];
    partNames: string[];
    stack: string[];
};

export type BuildPlanCharacterV1 = {
    id: 'character';
    parts: BuildPlanCharacterPartV1[];
    fixedPins: BuildPlanCharacterPinV1[];
    freePivots: BuildPlanCharacterPinV1[];
    partRefs: string[];
    pinRefs: string[];
    stepIds: string[];
    boardCells: number;
};

export type BuildPlanGeometryPointV1 = {
    id: string;
    label: string;
    role: 'fixed-pivot' | 'moving-pivot' | 'output' | 'gear-center' | 'guide';
    xMm: number;
    yMm: number;
    boardCoordinate?: string;
};

export type BuildPlanGeometryLinkV1 = {
    id: string;
    label: string;
    fromPointId: string;
    toPointId: string;
    lengthMm: number;
    widthMm: number;
    partRef?: string;
};

export type BuildPlanGeometryOutlineV1 = {
    id: string;
    label: string;
    kind: 'link' | 'gear' | 'cam' | 'rack' | 'guide';
    closed: boolean;
    pointsMm: Point[];
    partRef?: string;
};

export type BuildPlanMechanismGeometryV1 = {
    units: 'mm';
    phaseRad: number;
    points: BuildPlanGeometryPointV1[];
    links: BuildPlanGeometryLinkV1[];
    outlines: BuildPlanGeometryOutlineV1[];
    partRefs: string[];
    motionPathIds: string[];
    boundsMm: { minX: number; minY: number; maxX: number; maxY: number };
    signature: string;
};

export type BuildPlanMotionPathV1 = {
    id: string;
    ref: string;
    label: string;
    targetKind: 'part' | 'scene-object';
    targetId: string;
    targetAnchorJointId?: string;
    durationMs: number;
    closed: boolean;
    enabled: boolean;
    visible: boolean;
    pointsMm: Point[];
    mechanismRefs: string[];
    bindingIds: string[];
};

export type BuildPlanMechanismV1 = {
    ref: string;
    sectionId: string;
    sourceMechanismId: string;
    label: string;
    mechanism?: MechanismConfig;
    recipe: FabricationRecipe;
    geometry: BuildPlanMechanismGeometryV1;
    partRefs: string[];
    stepIds: string[];
};

export type BuildPlanSectionV1 = {
    id: string;
    kind: BuildPlanStepScopeV1;
    label: string;
    mechanismId?: string;
    mechanismRef?: string;
    partRefs: string[];
    stepIds: string[];
};

export type BuildPlanV1 = {
    schema: typeof BUILD_PLAN_SCHEMA_V1;
    version: 1;
    scope: BuildPlanScopeV1;
    lane: BuildPlanLaneV1;
    sourceDigest: string;
    artworkSourceDigest: string;
    source: {
        projectId: string;
        projectVersion: 1 | 2;
    };
    projectName: string;
    profile: PhysicalKitSettings;
    warnings: string[];
    parts: BuildPlanPartV1[];
    character: BuildPlanCharacterV1;
    objects: BuildPlanObjectsV1;
    motions: BuildPlanMotionPathV1[];
    mechanisms: BuildPlanMechanismV1[];
    sections: BuildPlanSectionV1[];
    steps: BuildPlanStepV1[];
};

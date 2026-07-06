import {
    AppSettings,
    AppStage,
    BodyPartLayer,
    CharacterPackageArtifact,
    FoundryExportPackage,
    MechanismConfig,
    Point,
    ProcessingStatus,
    ProjectAction,
    ProjectMotionPath,
    SceneObject,
    ProjectState,
    StandardJoint,
    StandardSkeleton,
    Transform
} from '../types';
import { defaultPhysicalKit, localPivotOffsetForScene, SCENE_PX_PER_MM, sceneBoundsForSheet } from './coordinates';
import { FABRICATION_GEAR_SPECS, FABRICATION_RING_GEAR_SPEC } from './fabricationContract';
import { REFERENCE_DEFAULTS, isReferenceFoundryVisible, normalizeMechanismToFabricationSet, normalizeMechanismToReference, referenceRequiredPartsForMechanism } from './mechanismReference';
import { defaultCamProfileSamples, gearTrainOutputRatio, generateCurvePoints, normalizeCamProfileSamples, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from './kinematics';
import { primaryFoundryPlaybackPath } from './foundryPlayback';
import { clampNumber, finiteNumber, sanitizeHexColor, sanitizeMechanismType, sanitizePoint } from './sanitize';
import { isUsableContourPoints } from './partGeometry';
import { DEFAULT_CLASSROOM_ASSESSMENT_KEY, normalizeClassroomAssessmentKey } from './classroomContent';

export const APP_STATE_VERSION = 1;

const DEFAULT_DRIVE_GEAR_RADIUS = REFERENCE_DEFAULTS.gearTrain.driveRadius; // reference G3 / 24T
const DEFAULT_OUTPUT_GEAR_RADIUS = REFERENCE_DEFAULTS.gearTrain.outputRadius; // reference G3 / 24T
const defaultGearRadiusByTeeth = (teeth: number, fallbackMm: number) => (FABRICATION_GEAR_SPECS.find(spec => spec.teeth === teeth)?.pitchRadiusMm ?? fallbackMm) * SCENE_PX_PER_MM;
const DEFAULT_PLANETARY_SUN_RADIUS = defaultGearRadiusByTeeth(FABRICATION_RING_GEAR_SPEC.compatibleSunTeeth, 10);
const DEFAULT_PLANETARY_PLANET_RADIUS = defaultGearRadiusByTeeth(FABRICATION_RING_GEAR_SPEC.compatiblePlanetTeeth, 30);
const DEFAULT_PLANETARY_CARRIER_RADIUS = DEFAULT_PLANETARY_SUN_RADIUS + DEFAULT_PLANETARY_PLANET_RADIUS;

export const nowIso = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export const idleProcessing = (): ProcessingStatus => ({ stage: 'idle', message: 'Ready', progress: 0 });

export const defaultSettings = (): AppSettings => ({
    animationSpeed: 1,
    animationDurationMs: 3200,
    timingProfile: 'linear',
    theme: 'light',
    uiTextScale: 'normal',
    toolbarVisible: false,
    partPanelVisible: true,
    autosave: true,
    autosaveIntervalSeconds: 60,
    performancePreset: 'balanced',
    physicsSnapMode: 'balanced',
    simulationFriction: 0.18,
    simulationMassKg: 1,
    debugVisuals: false,
    detailedProcessingSteps: false,
    classroomAssessmentKey: DEFAULT_CLASSROOM_ASSESSMENT_KEY,
    gridUnit: 'cm',
    fabricationReadyMode: true,
    physicalKit: defaultPhysicalKit()
});

const pickOne = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;

const normalizePhysicalKitSettings = (value: unknown, fallback = defaultPhysicalKit()): AppSettings['physicalKit'] => {
    const raw = asRecord(value);
    return {
        ...fallback,
        profileKey: typeof raw.profileKey === 'string' && raw.profileKey.trim() ? raw.profileKey : fallback.profileKey,
        gridPitchMm: clampNumber(raw.gridPitchMm, fallback.gridPitchMm, 5, 50),
        sheetWidthMm: clampNumber(raw.sheetWidthMm, fallback.sheetWidthMm, 80, 1200),
        sheetHeightMm: clampNumber(raw.sheetHeightMm, fallback.sheetHeightMm, 80, 1600),
        boardCells: Math.round(clampNumber(raw.boardCells, fallback.boardCells, 4, 40)),
        holeDiameterMm: clampNumber(raw.holeDiameterMm, fallback.holeDiameterMm, 1, 20),
        exportMode: pickOne(raw.exportMode, ['custom-parts', 'prefab-board', 'both'] as const, fallback.exportMode),
        defaultExportFormat: pickOne(raw.defaultExportFormat, ['svg', 'json', 'both'] as const, fallback.defaultExportFormat),
        cutSheetFileType: pickOne(raw.cutSheetFileType, ['pdf', 'svg'] as const, fallback.cutSheetFileType)
    };
};

const normalizeAppSettings = (value: unknown, fallback = defaultSettings()): AppSettings => {
    const raw = asRecord(value);
    return {
        ...fallback,
        animationSpeed: clampNumber(raw.animationSpeed, fallback.animationSpeed, 0.1, 5),
        animationDurationMs: Math.round(clampNumber(raw.animationDurationMs, fallback.animationDurationMs, 100, 60000)),
        timingProfile: pickOne(raw.timingProfile, ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'realtime', 'slow', 'presentation'] as const, fallback.timingProfile),
        theme: pickOne(raw.theme, ['light', 'dark', 'blueprint'] as const, fallback.theme),
        uiTextScale: pickOne(raw.uiTextScale, ['compact', 'normal', 'large'] as const, fallback.uiTextScale),
        toolbarVisible: typeof raw.toolbarVisible === 'boolean' ? raw.toolbarVisible : fallback.toolbarVisible,
        partPanelVisible: typeof raw.partPanelVisible === 'boolean' ? raw.partPanelVisible : fallback.partPanelVisible,
        autosave: typeof raw.autosave === 'boolean' ? raw.autosave : fallback.autosave,
        autosaveIntervalSeconds: Math.round(clampNumber(raw.autosaveIntervalSeconds, fallback.autosaveIntervalSeconds, 1, 600)),
        performancePreset: pickOne(raw.performancePreset, ['fast', 'balanced', 'high'] as const, fallback.performancePreset),
        physicsSnapMode: pickOne(raw.physicsSnapMode, ['fast', 'balanced', 'high'] as const, fallback.physicsSnapMode),
        simulationFriction: clampNumber(raw.simulationFriction, fallback.simulationFriction, 0, 2),
        simulationMassKg: clampNumber(raw.simulationMassKg, fallback.simulationMassKg, 0.05, 10),
        debugVisuals: typeof raw.debugVisuals === 'boolean' ? raw.debugVisuals : fallback.debugVisuals,
        detailedProcessingSteps: typeof raw.detailedProcessingSteps === 'boolean' ? raw.detailedProcessingSteps : fallback.detailedProcessingSteps,
        classroomAssessmentKey: normalizeClassroomAssessmentKey(raw.classroomAssessmentKey ?? asRecord(raw.classroom).assessmentKey, fallback.classroomAssessmentKey),
        gridUnit: pickOne(raw.gridUnit, ['cm', 'inch', 'px'] as const, fallback.gridUnit),
        fabricationReadyMode: typeof raw.fabricationReadyMode === 'boolean' ? raw.fabricationReadyMode : fallback.fabricationReadyMode,
        physicalKit: normalizePhysicalKitSettings(raw.physicalKit, fallback.physicalKit)
    };
};

const joint = (id: string, x: number, y: number, parentId: string | null = null): StandardJoint => ({
    id,
    name: id.replaceAll('_', ' '),
    position: { x, y },
    parentId,
    locked: false,
    bendDirection: 1
});

export const buildSkeleton = (joints: StandardJoint[]): StandardSkeleton => {
    const map: Record<string, StandardJoint> = {};
    const hierarchy: Record<string, string[]> = {};
    const bones: [string, string][] = [];
    const rootJointIds: string[] = [];
    const jointMap: Record<string, string> = {};

    joints.forEach(j => {
        map[j.id] = { ...j, bendDirection: j.bendDirection ?? 1 };
        jointMap[j.name.replaceAll(' ', '_')] = j.id;
        if (j.parentId && joints.some(other => other.id === j.parentId)) {
            bones.push([j.parentId, j.id]);
            hierarchy[j.parentId] = [...(hierarchy[j.parentId] ?? []), j.id];
        } else {
            rootJointIds.push(j.id);
        }
    });

    return {
        joints: map,
        bones,
        rootJointIds,
        jointMap,
        hierarchy,
        metadata: { sourceFormat: 'web-port', scale: 1, normalization: 'letter-sheet-scene' }
    };
};

export const wouldCreateCycle = (joints: Record<string, StandardJoint>, jointId: string, parentId?: string | null) => {
    let current = parentId ?? null;
    while (current) {
        if (current === jointId) return true;
        current = joints[current]?.parentId ?? null;
    }
    return false;
};

export const mechanismRequiredParts = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'couplerLength' | 'gearTrainRadii'>>) => {
    return referenceRequiredPartsForMechanism(mechanism);
};

const defaultSkeleton = () => buildSkeleton([
    joint('root', 0, -70),
    joint('hip', 0, -70, 'root'),
    joint('torso', 0, 40, 'hip'),
    joint('neck', 0, 120, 'torso'),
    joint('head_top', 0, 170, 'neck'),
    joint('left_shoulder', -58, 92, 'torso'),
    joint('left_elbow', -108, 28, 'left_shoulder'),
    joint('left_hand', -128, -34, 'left_elbow'),
    joint('right_shoulder', 58, 92, 'torso'),
    joint('right_elbow', 108, 28, 'right_shoulder'),
    joint('right_hand', 128, -34, 'right_elbow'),
    joint('left_hip', -34, -72, 'root'),
    joint('left_knee', -50, -150, 'left_hip'),
    joint('left_foot', -72, -218, 'left_knee'),
    joint('right_hip', 34, -72, 'root'),
    joint('right_knee', 50, -150, 'right_hip'),
    joint('right_foot', 72, -218, 'right_knee')
]);

const pointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const skeletonPoint = (skeleton: StandardSkeleton, jointId: string): Point =>
    skeleton.joints[jointId]?.position ?? { x: 0, y: 0 };

const chainReach = (skeleton: StandardSkeleton, jointIds: string[]) =>
    jointIds.slice(1).reduce((sum, jointId, index) => sum + pointDistance(skeletonPoint(skeleton, jointIds[index]), skeletonPoint(skeleton, jointId)), 0);

const guidedArmWavePath = (skeleton: StandardSkeleton): Point[] => {
    const shoulder = skeletonPoint(skeleton, 'right_shoulder');
    const reach = chainReach(skeleton, ['right_shoulder', 'right_elbow', 'right_hand']);
    const center = { x: shoulder.x + reach * 0.68, y: shoulder.y - reach * 0.12 };
    const rx = reach * 0.24;
    const ry = reach * 0.34;
    return [
        { x: center.x - rx * 0.25, y: center.y + ry * 0.82 },
        { x: center.x + rx * 0.75, y: center.y + ry * 0.42 },
        { x: center.x + rx, y: center.y - ry * 0.25 },
        { x: center.x + rx * 0.12, y: center.y - ry },
        { x: center.x - rx * 0.85, y: center.y - ry * 0.15 }
    ];
};

const guidedHeadBobPath = (skeleton: StandardSkeleton): Point[] => {
    const headTop = skeletonPoint(skeleton, 'head_top');
    const reach = chainReach(skeleton, ['neck', 'head_top']);
    const lift = Math.max(18, Math.min(34, reach * 0.45));
    return [
        { x: headTop.x, y: headTop.y - lift * 0.85 },
        { x: headTop.x, y: headTop.y - lift * 0.05 },
        { x: headTop.x, y: headTop.y - lift * 0.35 },
        { x: headTop.x, y: headTop.y - lift * 0.65 }
    ];
};

const guidedFootStepPath = (skeleton: StandardSkeleton): Point[] => {
    const foot = skeletonPoint(skeleton, 'right_foot');
    const reach = chainReach(skeleton, ['right_hip', 'right_knee', 'right_foot']);
    const stride = Math.min(reach * 0.24, 36);
    const lift = Math.min(reach * 0.2, 30);
    return [
        { x: foot.x - stride * 0.7, y: foot.y + 2 },
        { x: foot.x + stride * 0.2, y: foot.y + lift * 0.25 },
        { x: foot.x + stride * 0.75, y: foot.y + lift },
        { x: foot.x + stride * 0.15, y: foot.y + lift * 1.25 },
        { x: foot.x - stride * 0.85, y: foot.y + lift * 0.55 }
    ];
};

type StarterPartShape = 'torso' | 'head' | 'limb' | 'hand' | 'foot';

const capsuleContour = (width: number, height: number): Point[] => {
    const r = Math.min(width, height) / 2;
    const halfW = width / 2;
    const halfH = height / 2;
    const steps = 6;
    const points: Point[] = [];
    if (height >= width) {
        for (let i = 0; i <= steps; i += 1) {
            const t = Math.PI - (Math.PI * i) / steps;
            points.push({ x: Math.cos(t) * r, y: halfH - r + Math.sin(t) * r });
        }
        for (let i = 0; i <= steps; i += 1) {
            const t = -(Math.PI * i) / steps;
            points.push({ x: Math.cos(t) * r, y: -halfH + r + Math.sin(t) * r });
        }
        return points;
    }
    for (let i = 0; i <= steps; i += 1) {
        const t = Math.PI / 2 - (Math.PI * i) / steps;
        points.push({ x: halfW - r + Math.cos(t) * r, y: Math.sin(t) * r });
    }
    for (let i = 0; i <= steps; i += 1) {
        const t = -Math.PI / 2 - (Math.PI * i) / steps;
        points.push({ x: -halfW + r + Math.cos(t) * r, y: Math.sin(t) * r });
    }
    return points;
};

const starterContour = (shape: StarterPartShape, width: number, height: number): Point[] => {
    const hw = width / 2;
    const hh = height / 2;
    if (shape === 'head') {
        return [
            { x: -hw * 0.62, y: -hh * 0.78 }, { x: 0, y: -hh * 0.94 }, { x: hw * 0.62, y: -hh * 0.78 },
            { x: hw * 0.82, y: 0 }, { x: hw * 0.55, y: hh * 0.78 }, { x: 0, y: hh * 0.92 },
            { x: -hw * 0.55, y: hh * 0.78 }, { x: -hw * 0.82, y: 0 }
        ];
    }
    if (shape === 'torso') {
        return [
            { x: -hw * 0.76, y: -hh * 0.96 }, { x: hw * 0.76, y: -hh * 0.96 },
            { x: hw * 0.96, y: -hh * 0.68 }, { x: hw * 0.98, y: hh * 0.76 },
            { x: hw * 0.72, y: hh }, { x: -hw * 0.72, y: hh },
            { x: -hw * 0.98, y: hh * 0.76 }, { x: -hw * 0.96, y: -hh * 0.68 }
        ];
    }
    if (shape === 'hand') {
        return [
            { x: -hw * 0.6, y: -hh * 0.72 }, { x: hw * 0.55, y: -hh * 0.82 }, { x: hw * 0.9, y: -hh * 0.12 },
            { x: hw * 0.58, y: hh * 0.98 }, { x: -hw * 0.58, y: hh * 0.98 }, { x: -hw * 0.9, y: hh * 0.08 }
        ];
    }
    if (shape === 'foot') {
        return [
            { x: -hw * 0.92, y: -hh * 0.52 }, { x: hw * 0.35, y: -hh * 0.82 }, { x: hw * 0.94, y: -hh * 0.2 },
            { x: hw * 0.76, y: hh * 0.72 }, { x: -hw * 0.58, y: hh * 0.96 }, { x: -hw * 0.96, y: hh * 0.3 }
        ];
    }
    return capsuleContour(width, height);
};

const textureFromContour = (width: number, height: number, points: Point[], fillColor: string) => {
    const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(point.x + width / 2).toFixed(2)} ${(point.y + height / 2).toFixed(2)}`).join(' ') + ' Z';
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${d}" fill="${fillColor}"/></svg>`)}`;
};

const part = (
    id: string,
    name: string,
    anchorJointId: string,
    transform: Transform,
    bounds: { width: number; height: number },
    fillColor: string,
    zIndex: number,
    shape: StarterPartShape = 'limb'
): BodyPartLayer => {
    const contourPoints = starterContour(shape, bounds.width, bounds.height);
    return {
        id,
        name,
        anchorJointId,
        transform,
        bounds: { x: -bounds.width / 2, y: -bounds.height / 2, ...bounds },
        zIndex,
        opacity: 0.9,
        visible: true,
        locked: false,
        selectable: true,
        fillColor,
        contourPoints,
        contourSource: 'imported',
        textureUrl: textureFromContour(bounds.width, bounds.height, contourPoints, fillColor),
        originalSvgPath: `sample-assets/${id}.svg`,
        enhancedSvgPath: `sample-assets/${id}-enhanced.svg`
    };
};

export const createDefaultSceneObject = (shape: SceneObject['shape'] = 'piggy-bank', id = uid('object')): SceneObject => ({
    id,
    name: shape === 'piggy-bank' ? 'Flying piggy bank' : shape === 'cloud' ? 'Cloud' : shape === 'star' ? 'Star' : 'Block',
    shape,
    transform: { x: 112, y: 142, rotation: shape === 'piggy-bank' ? -8 : 0, scale: 1 },
    bounds: { width: shape === 'star' ? 68 : 96, height: shape === 'piggy-bank' ? 62 : 68 },
    fillColor: shape === 'piggy-bank' ? '#f9a8d4' : shape === 'cloud' ? '#bfdbfe' : shape === 'star' ? '#fde68a' : '#c4b5fd',
    opacity: 0.92,
    visible: true,
    locked: false,
    zIndex: 20
});

export const createDefaultMechanism = (type: MechanismConfig['type'] = '4bar', id = uid('mech')): MechanismConfig => ({
    id,
    type,
    visible: true,
    enabled: true,
    color: type === '5bar' || type === '6bar' || type === 'gear' || type === 'gear_linkage' || type === 'planetary_gear' || type === 'rack-pinion' ? '#d97706' : type === 'piston' ? '#059669' : type === 'yoke' || type === 'cam' ? '#f59e0b' : '#3b82f6',
    anchorX: -120,
    anchorY: -40,
    transform: { x: -120, y: -40, rotation: 0, scale: 1 },
    sceneAnchor: { x: -120, y: -40 },
    activeVisualPartIds: [],
    groundAngle: type === 'cam' || type === 'rack-pinion' ? 90 : 0,
    groundLength: type === 'gear' ? DEFAULT_DRIVE_GEAR_RADIUS + DEFAULT_OUTPUT_GEAR_RADIUS : type === 'gear_linkage' ? REFERENCE_DEFAULTS.gearLinkage.centerDistance : type === 'planetary_gear' ? DEFAULT_PLANETARY_CARRIER_RADIUS : type === 'piston' || type === 'yoke' || type === 'cam' || type === 'rack-pinion' ? 0 : REFERENCE_DEFAULTS.fourBar.ground,
    crankLength: type === '6bar' ? 55 : type === '5bar' ? 60 : type === 'gear' || type === 'gear_linkage' ? DEFAULT_DRIVE_GEAR_RADIUS : type === 'planetary_gear' ? DEFAULT_PLANETARY_SUN_RADIUS : type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.crank : type === 'cam' ? REFERENCE_DEFAULTS.cam.radius : type === 'rack-pinion' ? 42 : REFERENCE_DEFAULTS.fourBar.input,
    couplerLength: type === '6bar' ? 145 : type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.rod : type === 'gear_linkage' ? REFERENCE_DEFAULTS.gearLinkage.outputLinkage : type === 'yoke' || type === 'cam' || type === 'gear' || type === 'planetary_gear' || type === 'rack-pinion' ? 0 : REFERENCE_DEFAULTS.fourBar.coupler,
    rockerLength: type === '6bar' ? 110 : type === '5bar' ? 48 : type === 'quick-return' ? 130 : type === 'gear' || type === 'gear_linkage' ? DEFAULT_OUTPUT_GEAR_RADIUS : type === 'planetary_gear' ? DEFAULT_PLANETARY_PLANET_RADIUS : type === 'cam' ? REFERENCE_DEFAULTS.cam.followerTravel : type === 'rack-pinion' ? 380 : type === 'piston' ? 0 : REFERENCE_DEFAULTS.fourBar.output,
    sliderOffset: type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.guideOffset : type === 'rack-pinion' ? 56 : type === 'cam' ? REFERENCE_DEFAULTS.cam.followerRadius : 0,
    couplerPointDist: type === '6bar' ? 100 : type === '5bar' ? 90 : type === 'gear_linkage' ? REFERENCE_DEFAULTS.gearLinkage.handleRadius : type === 'planetary_gear' ? REFERENCE_DEFAULTS.planetary.carrierRadius : type === 'rack-pinion' ? 70 : 78,
    couplerPointAngle: type === 'piston' || type === 'yoke' || type === 'cam' || type === 'rack-pinion' ? 0 : 40,
    assemblyMode: type === '4bar' || type === '6bar' ? 'open' : undefined,
    speed1: 1,
    speed2: type === '5bar' ? -2 : type === 'gear' || type === 'gear_linkage' ? gearTrainOutputRatio([DEFAULT_DRIVE_GEAR_RADIUS, DEFAULT_OUTPUT_GEAR_RADIUS]) : type === 'planetary_gear' ? planetaryPlanetSpinRatio(DEFAULT_PLANETARY_SUN_RADIUS, DEFAULT_PLANETARY_PLANET_RADIUS) : 1,
    gearRatio: type === 'gear' || type === 'gear_linkage' ? gearTrainOutputRatio([DEFAULT_DRIVE_GEAR_RADIUS, DEFAULT_OUTPUT_GEAR_RADIUS]) : type === 'planetary_gear' ? planetaryCarrierOutputRatio(DEFAULT_PLANETARY_SUN_RADIUS, DEFAULT_PLANETARY_PLANET_RADIUS) : undefined,
    gearTrainRadii: type === 'gear' || type === 'gear_linkage' ? [DEFAULT_DRIVE_GEAR_RADIUS, DEFAULT_OUTPUT_GEAR_RADIUS] : undefined,
    camProfileSamples: type === 'cam' ? defaultCamProfileSamples() : undefined,
    driverGroupId: 'driver-1',
    driverPhaseOffset: 0,
    rodLength: type === '6bar' ? 95 : type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.rod : 110,
    phase: 0,
    source: 'manual',
    presetId: 'balanced',
    recommendation: 'balanced default',
    warnings: []
});

const generatedMechanismPath = (mechanism: MechanismConfig) => {
    if (isReferenceFoundryVisible(mechanism.type)) {
        const foundryPath = primaryFoundryPlaybackPath(mechanism, 96);
        if (foundryPath.length) return foundryPath;
    }
    return generateCurvePoints(mechanism, 96).points;
};

export const mechanismWithGeneratedPath = (mechanism: MechanismConfig, options: { preserveGeneratedPath?: boolean } = {}): MechanismConfig => ({
    ...mechanism,
    transform: mechanism.transform ?? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0, rotation: mechanism.groundAngle ?? 0, scale: 1 },
    sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
    activeVisualPartIds: mechanism.targetPartId ? [mechanism.targetPartId] : (mechanism.activeVisualPartIds ?? []),
    fabricationMetadata: {
        ...(mechanism.fabricationMetadata ?? {}),
        sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
        targetPathId: mechanism.targetPathId,
        requiredParts: mechanismRequiredParts(mechanism)
    },
    generatedPath: options.preserveGeneratedPath && mechanism.generatedPath?.length
        ? mechanism.generatedPath
        : generatedMechanismPath(mechanism)
});

const preserveGeneratedPathFor = (mechanism: MechanismConfig) =>
    Boolean(mechanism.foundryExport || mechanism.generatedPath?.length);

const samePoint = (a: Point | undefined, b: Point | undefined) =>
    (!a && !b) || Boolean(a && b && a.x === b.x && a.y === b.y);

const samePoints = (a: Point[] = [], b: Point[] = []) =>
    a.length === b.length && a.every((point, index) => samePoint(point, b[index]));

const sameTimedPoints = (a: ProjectMotionPath['timedPoints'] = [], b: ProjectMotionPath['timedPoints'] = []) =>
    a.length === b.length && a.every((point, index) =>
        samePoint(point, b[index]) && point.time === b[index]?.time
    );

const pathGeneratedGeometryUnchanged = (previous: ProjectMotionPath | undefined, next: ProjectMotionPath) => {
    if (!previous) return false;
    return previous.partId === next.partId &&
        previous.sceneObjectId === next.sceneObjectId &&
        previous.targetAnchorJointId === next.targetAnchorJointId &&
        previous.chainRootJointId === next.chainRootJointId &&
        previous.smoothness === next.smoothness &&
        previous.duration === next.duration &&
        previous.closed === next.closed &&
        samePoints(previous.points, next.points) &&
        sameTimedPoints(previous.timedPoints, next.timedPoints);
};

const partCanReachJoint = (
    part: BodyPartLayer | undefined,
    jointId: string | undefined,
    skeleton: StandardSkeleton | null | undefined
) => {
    if (!part || !jointId) return false;
    if (part.anchorJointId === jointId) return true;
    const descendants = new Set<string>();
    const visit = (id: string) => {
        (skeleton?.hierarchy[id] ?? []).forEach(childId => {
            if (!descendants.has(childId)) {
                descendants.add(childId);
                visit(childId);
            }
        });
    };
    visit(part.anchorJointId);
    return descendants.has(jointId);
};

const reconcileMechanismTargets = (
    mechanism: MechanismConfig,
    parts: Record<string, BodyPartLayer>,
    paths: Record<string, ProjectMotionPath>,
    sceneObjects: Record<string, SceneObject> = {},
    options: { preserveGeneratedPath?: boolean } = {},
    skeleton?: StandardSkeleton | null
) => {
    let targetSceneObjectId = mechanism.targetSceneObjectId && sceneObjects[mechanism.targetSceneObjectId] ? mechanism.targetSceneObjectId : undefined;
    let targetPartId = !targetSceneObjectId && mechanism.targetPartId && parts[mechanism.targetPartId] ? mechanism.targetPartId : undefined;
    let targetPathId = mechanism.targetPathId && paths[mechanism.targetPathId] ? mechanism.targetPathId : undefined;
    if (targetPathId) {
        const path = paths[targetPathId];
        if (path.sceneObjectId) {
            if (sceneObjects[path.sceneObjectId]) {
                targetSceneObjectId = path.sceneObjectId;
                targetPartId = undefined;
            } else {
                targetPathId = undefined;
            }
        } else {
            const pathPartId = path.partId;
            const requestedPart = targetPartId ? parts[targetPartId] : undefined;
            const pathTargetJointId = path.targetAnchorJointId ?? parts[pathPartId]?.anchorJointId;
            if (requestedPart && partCanReachJoint(requestedPart, pathTargetJointId, skeleton)) {
                targetPartId = requestedPart.id;
                targetSceneObjectId = undefined;
            } else if (parts[pathPartId]) {
                targetPartId = pathPartId;
                targetSceneObjectId = undefined;
            } else {
                targetPathId = undefined;
            }
        }
    }
    const pathAnchorJointId = targetPathId ? paths[targetPathId]?.targetAnchorJointId : undefined;
    const targetAnchorJointId = targetPartId ? (mechanism.targetAnchorJointId ?? pathAnchorJointId ?? parts[targetPartId]?.anchorJointId) : undefined;
    const normalized = normalizeMechanismToFabricationSet({
        ...mechanism,
        targetPartId,
        targetSceneObjectId,
        targetPathId,
        targetAnchorJointId,
        activeVisualPartIds: targetPartId ? [targetPartId] : []
    });
    return mechanismWithGeneratedPath(normalized, options);
};

export const createEmptyProject = (): ProjectState => ({
    version: APP_STATE_VERSION,
    metadata: {
        id: uid('project'),
        name: 'Untitled automata',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        normalizationScale: 1,
        status: 'empty'
    },
    parts: {},
    partOrder: [],
    sceneObjects: {},
    sceneObjectOrder: [],
    skeleton: null,
    paths: {},
    mechanisms: [],
    settings: defaultSettings(),
    selectedMechanismId: undefined,
    processing: idleProcessing()
});

export const createSampleProject = (options: { includeMechanism?: boolean } = {}): ProjectState => {
    const includeMechanism = options.includeMechanism ?? false;
    const skeleton = defaultSkeleton();
    const partsArray = [
        part('torso', 'Torso', 'torso', { x: 0, y: 12, rotation: 0, scale: 1 }, { width: 132, height: 220 }, '#cbd5e1', 0, 'torso'),
        part('head', 'Head', 'neck', { x: 0, y: 152, rotation: 0, scale: 1 }, { width: 78, height: 78 }, '#e2e8f0', 5, 'head'),
        part('left_arm_upper', 'Left upper arm', 'left_shoulder', { x: -80, y: 56, rotation: -20, scale: 1 }, { width: 44, height: 104 }, '#b6c2d2', 3, 'limb'),
        part('left_arm_lower', 'Left lower arm', 'left_elbow', { x: -116, y: -10, rotation: -18, scale: 1 }, { width: 42, height: 104 }, '#b6c2d2', 3, 'limb'),
        part('left_hand_part', 'Left hand', 'left_hand', { x: -134, y: -54, rotation: -18, scale: 1 }, { width: 40, height: 42 }, '#d1d5db', 4, 'hand'),
        part('right_arm_upper', 'Right upper arm', 'right_shoulder', { x: 80, y: 56, rotation: 20, scale: 1 }, { width: 44, height: 104 }, '#b6c2d2', 3, 'limb'),
        part('right_arm_lower', 'Right lower arm', 'right_elbow', { x: 116, y: -10, rotation: 18, scale: 1 }, { width: 42, height: 104 }, '#b6c2d2', 3, 'limb'),
        part('right_hand_part', 'Right hand', 'right_hand', { x: 134, y: -54, rotation: 18, scale: 1 }, { width: 40, height: 42 }, '#d1d5db', 4, 'hand'),
        part('left_leg_upper', 'Left upper leg', 'left_hip', { x: -42, y: -114, rotation: -8, scale: 1 }, { width: 48, height: 108 }, '#94a3b8', 1, 'limb'),
        part('left_leg_lower', 'Left lower leg', 'left_knee', { x: -60, y: -194, rotation: -8, scale: 1 }, { width: 48, height: 112 }, '#94a3b8', 1, 'limb'),
        part('left_foot_part', 'Left foot', 'left_foot', { x: -82, y: -238, rotation: -8, scale: 1 }, { width: 66, height: 58 }, '#94a3b8', 2, 'foot'),
        part('right_leg_upper', 'Right upper leg', 'right_hip', { x: 42, y: -114, rotation: 8, scale: 1 }, { width: 48, height: 108 }, '#94a3b8', 1, 'limb'),
        part('right_leg_lower', 'Right lower leg', 'right_knee', { x: 60, y: -194, rotation: 8, scale: 1 }, { width: 48, height: 112 }, '#94a3b8', 1, 'limb'),
        part('right_foot_part', 'Right foot', 'right_foot', { x: 82, y: -238, rotation: 8, scale: 1 }, { width: 66, height: 58 }, '#94a3b8', 2, 'foot')
    ].map(p => ({ ...p, localPivotOffset: localPivotOffsetForScene(p, skeleton.joints[p.anchorJointId]?.position ?? p.transform), localPivotJointId: p.anchorJointId }));
    const mechanisms = includeMechanism ? [createDefaultMechanism('4bar', 'mech-1')] : [];
    if (mechanisms[0]) {
        mechanisms[0].targetPartId = 'right_arm_lower';
        mechanisms[0].targetPathId = 'path-right-arm';
        mechanisms[0].targetAnchorJointId = 'right_hand';
        Object.assign(mechanisms[0], normalizeMechanismToFabricationSet({
            ...mechanisms[0],
            anchorX: 0,
            anchorY: 200,
            transform: { x: 0, y: 200, rotation: 331.4, scale: 1 },
            sceneAnchor: { x: 0, y: 200 },
            groundAngle: 331.4,
            groundLength: 160,
            crankLength: 80,
            couplerLength: 240,
            rockerLength: 160,
            couplerPointDist: 160,
            couplerPointAngle: -13.2,
            assemblyMode: 'crossed',
            source: 'optimized',
            presetId: 'sample-fitted',
            recommendation: 'sample path fit'
        }));
    }

    const pathPoints = guidedArmWavePath(skeleton);

    return {
        ...createEmptyProject(),
        metadata: {
            id: uid('project'),
            name: 'Humanoid starter character',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            normalizationScale: 1,
            status: 'sample'
        },
        parts: Object.fromEntries(partsArray.map(p => [p.id, p])),
        partOrder: partsArray.sort((a, b) => a.zIndex - b.zIndex).map(p => p.id),
        skeleton,
        paths: {
            'path-right-arm': {
                id: 'path-right-arm',
                partId: 'right_arm_lower',
                targetAnchorJointId: 'right_hand',
                chainRootJointId: 'right_shoulder',
                points: pathPoints,
                duration: 1800,
                closed: false,
                enabled: true,
                visible: true,
                source: 'drawn',
                warnings: []
            }
        },
        mechanisms,
        selectedPartId: 'right_arm_lower',
        selectedPathId: 'path-right-arm',
        selectedMechanismId: mechanisms[0]?.id,
        characterPackage: {
            id: 'sample-character-package',
            createdAt: nowIso(),
            sourceImageName: 'sample',
            outputDir: 'sample://built-in',
            partsInfo: { parts: Object.fromEntries(partsArray.map(p => [p.id, { name: p.name, texture_path: `sample-assets/${p.id}.svg`, original_svg_path: p.originalSvgPath, enhanced_svg_path: p.enhancedSvgPath, contour_points: p.contourPoints, contour_source: p.contourSource, anchor_joint_id: p.anchorJointId, transform: p.transform, z_index: p.zIndex, visible: p.visible }])) },
            charCfg: { joints: skeleton.joints, bones: skeleton.bones, root_joint_ids: skeleton.rootJointIds, metadata: skeleton.metadata },
            replacementContext: { mode: 'plain-load', rebindingSummary: includeMechanism ? 'Built-in sample with a ready path and mechanism.' : 'Built-in full humanoid starter with no mechanisms.' }
        },
        processing: { stage: 'ready', message: 'Sample loaded', progress: 100 }
    };
};

export const CLASSROOM_LESSONS = [
    {
        id: 'waving-arm',
        label: 'Waving arm',
        shortLabel: 'Waving arm',
        description: 'Right hand path + fitted four-bar mechanism.',
        actionLabel: 'Open lesson',
        outcome: 'Make a hand wave',
        changeCue: 'hand path',
        buildCue: 'four-bar',
        startStage: 'character' as AppStage,
        mechanismType: '4bar' as MechanismConfig['type'],
        sensemaking: {
            directTranslation: 'Crank turns -> rocker swings',
            tryThis: 'Move the hand path',
            teacherTakeaway: 'Rotary motion can become swinging motion.',
            studentCheck: 'Which pivot stays fixed?',
            expectedAnswer: 'The board pivots stay fixed',
            evidenceCue: 'right hand follows the rocker arc',
            clipSlot: 'generated-loop' as const
        }
    },
    {
        id: 'head-bob',
        label: 'Head bob',
        shortLabel: 'Head bob',
        description: 'Head lift path + cam follower baseline.',
        actionLabel: 'Open lesson',
        outcome: 'Make a head bob',
        changeCue: 'head path',
        buildCue: 'cam',
        startStage: 'character' as AppStage,
        mechanismType: 'cam' as MechanismConfig['type'],
        sensemaking: {
            directTranslation: 'Cam shape -> follower lifts',
            tryThis: 'Drag the lift path',
            teacherTakeaway: 'A shaped cam can turn rotation into timed lifting.',
            studentCheck: 'Where does the follower touch?',
            expectedAnswer: 'The follower touches the cam edge',
            evidenceCue: 'head lift follows the cam profile',
            clipSlot: 'generated-loop' as const
        }
    },
    {
        id: 'walking-leg',
        label: 'Walking leg',
        shortLabel: 'Walking leg',
        description: 'Foot path + board-ready four-bar baseline.',
        actionLabel: 'Open lesson',
        outcome: 'Make a foot step',
        changeCue: 'foot path',
        buildCue: 'four-bar',
        startStage: 'character' as AppStage,
        mechanismType: '4bar' as MechanismConfig['type'],
        sensemaking: {
            directTranslation: 'Crank turns -> leg steps',
            tryThis: 'Move the foot loop',
            teacherTakeaway: 'A four-bar can turn rotation into a stepping swing.',
            studentCheck: 'Which pivot stays fixed?',
            expectedAnswer: 'The board pivots stay fixed',
            evidenceCue: 'lower leg follows the foot loop',
            clipSlot: 'generated-loop' as const
        }
    },
    {
        id: 'spin-gears',
        label: 'Spin gears',
        shortLabel: 'Spin gears',
        description: 'Gear pair baseline with board-ready axles.',
        actionLabel: 'Open lesson',
        outcome: 'Make gears spin',
        changeCue: 'gear size',
        buildCue: 'gear pair',
        startStage: 'character' as AppStage,
        mechanismType: 'gear' as MechanismConfig['type'],
        sensemaking: {
            directTranslation: 'Touching teeth -> spin transfers',
            tryThis: 'Swap gear size',
            teacherTakeaway: 'Meshed gears transfer rotation and can change speed.',
            studentCheck: 'Which gear turns opposite?',
            expectedAnswer: 'The meshed gear turns opposite the driver',
            evidenceCue: 'touching teeth transfer spin',
            clipSlot: 'generated-loop' as const
        }
    }
] as const;

export type ClassroomLessonId = typeof CLASSROOM_LESSONS[number]['id'];
export type ClassroomLessonTemplate = typeof CLASSROOM_LESSONS[number];

export const classroomLessonById = (id?: string): ClassroomLessonTemplate | undefined =>
    CLASSROOM_LESSONS.find(lesson => lesson.id === id);

export const createLessonProject = (lessonId: ClassroomLessonId): ProjectState => {
    const lesson = classroomLessonById(lessonId);
    if (!lesson) throw new Error(`Unknown classroom lesson: ${lessonId}`);

    let project = createSampleProject({ includeMechanism: lesson.id === 'waving-arm' });
    const lessonSkeleton = project.skeleton ?? defaultSkeleton();
    let paths = project.paths;
    let mechanisms = project.mechanisms;
    let selectedPartId = project.selectedPartId;
    let selectedPathId = project.selectedPathId;
    let selectedMechanismId = project.selectedMechanismId;

    if (lesson.id === 'waving-arm') {
        const armPath = paths['path-right-arm'];
        if (armPath) {
            paths = {
                ...paths,
                [armPath.id]: {
                    ...armPath,
                    partId: 'right_hand_part',
                    targetAnchorJointId: 'right_hand',
                    chainRootJointId: 'right_shoulder'
                }
            };
            selectedPartId = 'right_hand_part';
            selectedPathId = armPath.id;
        }
        const armFourBar = mechanisms[0];
        if (armFourBar) {
            Object.assign(armFourBar, {
                anchorX: 200,
                anchorY: 80,
                groundAngle: 180,
                transform: { x: 200, y: 80, rotation: 180, scale: 1 },
                sceneAnchor: { x: 200, y: 80 },
                targetPartId: 'right_hand_part',
                targetPathId: 'path-right-arm',
                targetAnchorJointId: 'right_hand',
                activeVisualPartIds: ['right_hand_part'],
                recommendation: lesson.description
            } satisfies Partial<MechanismConfig>);
            mechanisms = [mechanismWithGeneratedPath(armFourBar)];
            selectedMechanismId = armFourBar.id;
        }
    } else if (lesson.id === 'head-bob') {
        const pathId = 'path-head-bob';
        paths = {
            [pathId]: {
                id: pathId,
                partId: 'head',
                targetAnchorJointId: 'head_top',
                chainRootJointId: 'neck',
                points: guidedHeadBobPath(lessonSkeleton),
                duration: 1600,
                closed: false,
                enabled: true,
                visible: true,
                source: 'drawn',
                warnings: []
            }
        };
        const cam = createDefaultMechanism('cam', 'mech-head-bob');
        Object.assign(cam, {
            anchorX: 200,
            anchorY: 80,
            groundAngle: 90,
            transform: { x: 200, y: 80, rotation: 90, scale: 1 },
            sceneAnchor: { x: 200, y: 80 },
            targetPartId: 'head',
            targetPathId: pathId,
            targetAnchorJointId: 'head_top',
            activeVisualPartIds: ['head'],
            source: 'manual',
            presetId: 'lesson-head-bob',
            recommendation: lesson.description
        } satisfies Partial<MechanismConfig>);
        mechanisms = [mechanismWithGeneratedPath(cam)];
        selectedPartId = 'head';
        selectedPathId = pathId;
        selectedMechanismId = cam.id;
    } else if (lesson.id === 'walking-leg') {
        const pathId = 'path-right-foot-step';
        paths = {
            [pathId]: {
                id: pathId,
                partId: 'right_foot_part',
                targetAnchorJointId: 'right_foot',
                chainRootJointId: 'right_hip',
                points: guidedFootStepPath(lessonSkeleton),
                duration: 1900,
                closed: true,
                enabled: true,
                visible: true,
                source: 'drawn',
                warnings: []
            }
        };
        const legFourBar = createDefaultMechanism('4bar', 'mech-walking-leg');
        Object.assign(legFourBar, {
            anchorX: 160,
            anchorY: -120,
            groundAngle: 180,
            transform: { x: 160, y: -120, rotation: 180, scale: 1 },
            sceneAnchor: { x: 160, y: -120 },
            targetPartId: 'right_foot_part',
            targetPathId: pathId,
            targetAnchorJointId: 'right_foot',
            activeVisualPartIds: ['right_foot_part'],
            source: 'manual',
            presetId: 'lesson-walking-leg',
            recommendation: lesson.description
        } satisfies Partial<MechanismConfig>);
        mechanisms = [mechanismWithGeneratedPath(legFourBar)];
        selectedPartId = 'right_foot_part';
        selectedPathId = pathId;
        selectedMechanismId = legFourBar.id;
    } else if (lesson.id === 'spin-gears') {
        const pathId = 'path-gear-spin';
        paths = {
            [pathId]: {
                id: pathId,
                partId: 'right_hand_part',
                targetAnchorJointId: 'right_hand',
                chainRootJointId: 'right_shoulder',
                points: [
                    { x: 118, y: 40 },
                    { x: 150, y: 72 },
                    { x: 118, y: 104 },
                    { x: 86, y: 72 }
                ],
                duration: 1600,
                closed: true,
                enabled: true,
                visible: true,
                source: 'drawn',
                warnings: []
            }
        };
        const gear = createDefaultMechanism('gear', 'mech-spin-gears');
        const gearRadii: [number, number] = [60, 20];
        Object.assign(gear, {
            anchorX: 200,
            anchorY: 80,
            groundAngle: 180,
            groundLength: 80,
            crankLength: gearRadii[0],
            rockerLength: gearRadii[1],
            gearTrainRadii: gearRadii,
            gearRatio: gearTrainOutputRatio(gearRadii),
            speed2: gearTrainOutputRatio(gearRadii),
            transform: { x: 200, y: 80, rotation: 0, scale: 1 },
            sceneAnchor: { x: 200, y: 80 },
            targetPartId: 'right_hand_part',
            targetPathId: pathId,
            targetAnchorJointId: 'right_hand',
            activeVisualPartIds: ['right_hand_part'],
            source: 'manual',
            presetId: 'lesson-spin-gears',
            recommendation: lesson.description
        } satisfies Partial<MechanismConfig>);
        mechanisms = [mechanismWithGeneratedPath(gear)];
        selectedPartId = 'right_hand_part';
        selectedPathId = pathId;
        selectedMechanismId = gear.id;
    } else {
        mechanisms = project.mechanisms.map(mechanism => mechanismWithGeneratedPath(mechanism));
    }

    return {
        ...project,
        metadata: {
            ...project.metadata,
            name: lesson.label,
            classroomLessonId: lesson.id,
            classroomLessonLabel: lesson.label
        },
        paths,
        mechanisms,
        selectedPartId,
        selectedPathId,
        selectedMechanismId,
        characterPackage: project.characterPackage ? {
            ...project.characterPackage,
            replacementContext: {
                mode: 'plain-load',
                rebindingSummary: `${lesson.label}: ${lesson.description}`
            }
        } : project.characterPackage,
        processing: { stage: 'ready', message: `${lesson.shortLabel} ready`, progress: 100 }
    };
};

export const resetProjectToLessonBaseline = (project: ProjectState): ProjectState | undefined => {
    const lesson = classroomLessonById(project.metadata.classroomLessonId);
    if (!lesson) return undefined;
    const baseline = createLessonProject(lesson.id);
    return { ...baseline, settings: project.settings };
};

const jointScenePoint = (project: ProjectState, jointId?: string): Point | undefined =>
    jointId ? project.skeleton?.joints[jointId]?.position : undefined;

const skeletonBox = (project: ProjectState) => {
    const points = Object.values(project.skeleton?.joints ?? {}).map(joint => joint.position);
    if (!points.length) return undefined;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        center: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    };
};

const characterScaleBetween = (previous: ProjectState, next: ProjectState) => {
    const before = skeletonBox(previous);
    const after = skeletonBox(next);
    if (!before || !after) return 1;
    const beforeSize = Math.max(1, before.maxX - before.minX, before.maxY - before.minY);
    const afterSize = Math.max(1, after.maxX - after.minX, after.maxY - after.minY);
    return clampNumber(afterSize / beforeSize, 1, 0.2, 5);
};

const jointChainIds = (skeleton: StandardSkeleton | null | undefined, rootJointId?: string, targetJointId?: string) => {
    if (!skeleton || !rootJointId || !targetJointId) return [];
    if (rootJointId === targetJointId && skeleton.joints[rootJointId]) return [rootJointId];
    const chain = [targetJointId];
    let current = skeleton.joints[targetJointId]?.parentId ?? null;
    while (current) {
        chain.push(current);
        if (current === rootJointId) return chain.reverse();
        current = skeleton.joints[current]?.parentId ?? null;
    }
    return [];
};

const limbKeywordScore = (oldId: string | undefined, newId: string) => {
    if (!oldId) return 0;
    const tokens = ['left', 'right', 'arm', 'leg', 'head', 'torso', 'hand', 'foot'];
    return tokens.reduce((score, token) => score + (oldId.includes(token) && newId.includes(token) ? 1 : 0), 0);
};

const replacementPartId = (project: ProjectState, oldPartId?: string, targetJointId?: string) => {
    if (oldPartId && project.parts[oldPartId]) return oldPartId;
    const candidates = Object.values(project.parts)
        .map(part => ({
            part,
            chainLength: targetJointId ? jointChainIds(project.skeleton, part.anchorJointId, targetJointId).length : 0,
            score: limbKeywordScore(oldPartId, part.id)
        }))
        .filter(item => (targetJointId ? item.chainLength > 0 : item.score > 0))
        .sort((a, b) => (targetJointId && oldPartId ? b.score - a.score : 0) || (targetJointId ? a.chainLength - b.chainLength : b.score - a.score) || b.score - a.score || a.part.zIndex - b.part.zIndex);
    return candidates[0]?.part.id;
};

const mappedPoint = (point: Point, from: Point, to: Point, scale: number): Point => ({
    x: to.x + (point.x - from.x) * scale,
    y: to.y + (point.y - from.y) * scale
});

const mechanismScaleKeys: Array<keyof MechanismConfig> = [
    'crankLength',
    'groundLength',
    'couplerLength',
    'rockerLength',
    'sliderOffset',
    'couplerPointDist',
    'rodLength',
    'outputGearRadius'
];

export const replaceCharacterProject = (next: ProjectState, previous: ProjectState, previousStage: AppStage = 'character'): ProjectState => {
    const scale = characterScaleBetween(previous, next);
    const previousBox = skeletonBox(previous);
    const nextBox = skeletonBox(next);
    const fallbackFrom = previousBox?.center ?? { x: 0, y: 0 };
    const fallbackTo = nextBox?.center ?? { x: 0, y: 0 };
    const remappedPaths: Record<string, ProjectMotionPath> = Object.fromEntries(Object.entries(previous.paths).flatMap(([id, path]): Array<[string, ProjectMotionPath]> => {
        if (path.sceneObjectId) return previous.sceneObjects[path.sceneObjectId] ? [[id, { ...path, warnings: [] }]] : [];
        const referencingMechanismTarget = previous.mechanisms.find(mechanism => mechanism.targetPathId === id && mechanism.targetAnchorJointId && next.skeleton?.joints[mechanism.targetAnchorJointId])?.targetAnchorJointId;
        const previousPartRoot = previous.parts[path.partId]?.anchorJointId;
        const targetJointId = path.targetAnchorJointId && next.skeleton?.joints[path.targetAnchorJointId]
            ? path.targetAnchorJointId
            : (referencingMechanismTarget ?? (previousPartRoot && next.skeleton?.joints[previousPartRoot] ? previousPartRoot : undefined));
        const partId = replacementPartId(next, path.partId, targetJointId);
        if (!partId) return [];
        const from = jointScenePoint(previous, targetJointId) ?? jointScenePoint(previous, previous.parts[path.partId]?.anchorJointId) ?? fallbackFrom;
        const to = jointScenePoint(next, targetJointId) ?? jointScenePoint(next, next.parts[partId]?.anchorJointId) ?? fallbackTo;
        const candidateChainRootJointId = path.chainRootJointId ?? previousPartRoot;
        const chainRootJointId = candidateChainRootJointId && jointChainIds(next.skeleton, candidateChainRootJointId, targetJointId).length ? candidateChainRootJointId : undefined;
        return [[id, {
            ...path,
            partId,
            targetAnchorJointId: targetJointId,
            chainRootJointId,
            points: path.points.map(point => mappedPoint(point, from, to, scale)),
            timedPoints: path.timedPoints?.map(point => ({ ...mappedPoint(point, from, to, scale), time: point.time })),
            warnings: []
        }]];
    }));
    const firstPathByPart = (partId?: string) => partId ? Object.values(remappedPaths).find(path => path.partId === partId) : undefined;
    const remappedMechanisms = previous.mechanisms.map(mechanism => {
        const priorPath = mechanism.targetPathId ? remappedPaths[mechanism.targetPathId] : undefined;
        if (mechanism.targetSceneObjectId) return mechanismWithGeneratedPath({
            ...mechanism,
            targetPartId: undefined,
            targetSceneObjectId: next.sceneObjects[mechanism.targetSceneObjectId] ? mechanism.targetSceneObjectId : undefined,
            targetPathId: priorPath?.id,
            targetAnchorJointId: undefined,
            activeVisualPartIds: []
        }, { preserveGeneratedPath: Boolean(mechanism.foundryExport || mechanism.generatedPath?.length) });
        const targetAnchorJointId = mechanism.targetAnchorJointId && next.skeleton?.joints[mechanism.targetAnchorJointId]
            ? mechanism.targetAnchorJointId
            : priorPath?.targetAnchorJointId;
        const targetPartId = replacementPartId(next, mechanism.targetPartId, targetAnchorJointId);
        const targetPathId = priorPath?.id ?? firstPathByPart(targetPartId)?.id;
        const anchor = mappedPoint(
            { x: mechanism.anchorX ?? mechanism.sceneAnchor?.x ?? mechanism.transform?.x ?? fallbackFrom.x, y: mechanism.anchorY ?? mechanism.sceneAnchor?.y ?? mechanism.transform?.y ?? fallbackFrom.y },
            fallbackFrom,
            fallbackTo,
            scale
        );
        const scaled = mechanismScaleKeys.reduce((acc, key) => {
            const value = mechanism[key];
            return typeof value === 'number' ? { ...acc, [key]: value * scale } : acc;
        }, {} as Partial<MechanismConfig>);
        return mechanismWithGeneratedPath({
            ...mechanism,
            ...scaled,
            gearTrainRadii: mechanism.gearTrainRadii?.map(radius => radius * scale),
            targetPartId,
            targetPathId,
            targetAnchorJointId,
            activeVisualPartIds: targetPartId ? [targetPartId] : [],
            anchorX: anchor.x,
            anchorY: anchor.y,
            transform: mechanism.transform ? { ...mechanism.transform, x: anchor.x, y: anchor.y } : { x: anchor.x, y: anchor.y, rotation: mechanism.groundAngle ?? 0, scale: 1 },
            sceneAnchor: anchor
        });
    });
    return {
        ...next,
        paths: remappedPaths,
        mechanisms: remappedMechanisms,
        selectedPartId: remappedMechanisms[0]?.targetPartId ?? Object.keys(next.parts)[0],
        selectedPathId: Object.keys(remappedPaths)[0],
        selectedMechanismId: remappedMechanisms[0]?.id,
        characterPackage: next.characterPackage ? {
            ...next.characterPackage,
            replacementContext: {
                mode: 'replace-character',
                previousStage,
                rebindingSummary: `${remappedMechanisms.filter(m => m.targetPartId).length}/${remappedMechanisms.length} mechanisms rebound; ${Object.keys(remappedPaths).length}/${Object.keys(previous.paths).length} paths scaled to new joints.`
            }
        } : next.characterPackage
    };
};

export const normalizePartsToSheet = (parts: BodyPartLayer[], settings = defaultSettings()) => {
    if (!parts.length) return { parts, scale: 1, center: { x: 0, y: 0 } };
    const xs = parts.flatMap(p => [p.transform.x + p.bounds.x * p.transform.scale, p.transform.x + (p.bounds.x + p.bounds.width) * p.transform.scale]);
    const ys = parts.flatMap(p => [p.transform.y + p.bounds.y * p.transform.scale, p.transform.y + (p.bounds.y + p.bounds.height) * p.transform.scale]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const sheet = sceneBoundsForSheet(settings.physicalKit);
    const scale = Math.min(1, (sheet.width * 0.78) / width, (sheet.height * 0.78) / height);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return {
        scale,
        center: { x: cx, y: cy },
        parts: parts.map(p => ({
            ...p,
            transform: {
                ...p.transform,
                x: (p.transform.x - cx) * scale,
                y: (p.transform.y - cy) * scale,
                scale: p.transform.scale * scale
            }
        }))
    };
};

const normalizeSkeletonToSheet = (skeleton: StandardSkeleton, scale: number, center: Point): StandardSkeleton => {
    const joints = Object.values(skeleton.joints).map(j => ({
        ...j,
        position: {
            x: (j.position.x - center.x) * scale,
            y: (j.position.y - center.y) * scale
        }
    }));
    const normalized = buildSkeleton(joints);
    normalized.metadata = { ...skeleton.metadata, scale: (Number(skeleton.metadata.scale) || 1) * scale, normalization: `fit:${scale.toFixed(3)}` };
    return normalized;
};

export const createProjectFromProcessed = (input: {
    name: string;
    sourceImageName: string;
    skeleton: StandardSkeleton;
    parts: BodyPartLayer[];
    textureUrl?: string;
    maskUrl?: string;
    keypoints?: unknown;
    replacementContext?: CharacterPackageArtifact['replacementContext'];
}): ProjectState => {
    const base = createEmptyProject();
    const normalized = normalizePartsToSheet(input.parts, base.settings);
    const parts = Object.fromEntries(normalized.parts.map(p => [p.id, p]));
    const characterPackage: CharacterPackageArtifact = {
        id: `char-${Date.now().toString(36)}`,
        createdAt: nowIso(),
        sourceImageName: input.sourceImageName,
        outputDir: `web-onnx://${input.sourceImageName}`,
        partsInfo: {
            parts: Object.fromEntries(normalized.parts.map(p => [p.id, {
                name: p.name,
                texture_path: p.textureUrl ? `${p.id}.png` : undefined,
                mask_path: p.maskUrl ? `${p.id}-mask.png` : undefined,
                original_svg_path: p.originalSvgPath,
                enhanced_svg_path: p.enhancedSvgPath,
                anchor_joint_id: p.anchorJointId,
                transform: p.transform,
                z_index: p.zIndex,
                opacity: p.opacity,
                visible: p.visible,
                fixed: p.locked,
                roi: [p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height],
                contour_points: p.contourPoints,
                contour_source: p.contourSource,
                local_pivot_offset: p.localPivotOffset ? [p.localPivotOffset.x, p.localPivotOffset.y] : undefined,
                local_pivot_joint_id: p.localPivotJointId ?? p.anchorJointId,
                fill_color: p.fillColor
            }]))
        },
        charCfg: {
            width: input.skeleton.metadata.imageBounds?.width,
            height: input.skeleton.metadata.imageBounds?.height,
            joints: input.skeleton.joints,
            bones: input.skeleton.bones,
            root_joint_ids: input.skeleton.rootJointIds,
            metadata: input.skeleton.metadata
        },
        maskUrl: input.maskUrl,
        sourceTextureUrl: input.textureUrl,
        keypoints: input.keypoints,
        replacementContext: input.replacementContext
    };
    return {
        ...base,
        metadata: {
            ...base.metadata,
            name: input.name,
            sourceImageName: input.sourceImageName,
            normalizationScale: normalized.scale,
            status: 'processed',
            updatedAt: nowIso()
        },
        parts,
        partOrder: normalized.parts.sort((a, b) => a.zIndex - b.zIndex).map(p => p.id),
        skeleton: normalizeSkeletonToSheet(input.skeleton, normalized.scale, normalized.center),
        mechanisms: [],
        selectedMechanismId: undefined,
        selectedPartId: normalized.parts[0]?.id,
        characterPackage,
        processing: { stage: 'ready', message: 'Character package ready', progress: 100 }
    };
};

const touch = (project: ProjectState, options: { preserveExport?: boolean } = {}): ProjectState => ({
    ...project,
    lastExport: options.preserveExport ? project.lastExport : undefined,
    metadata: { ...project.metadata, updatedAt: nowIso() }
});

export const handoffGate = (project: ProjectState, targetStage: import('../types').AppStage) => {
    const fail = (message: string, recoveryStage: import('../types').AppStage = 'character') => ({ ok: false as const, message, recoveryStage });
    const mechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    if (targetStage === 'character' || targetStage === 'options') return { ok: true as const, message: 'Ready' };
    if (!project.partOrder.length) return fail('Load a character package before entering this workflow.');
    if (targetStage === 'path') return project.skeleton || project.metadata.status === 'sample' ? { ok: true as const, message: 'Parts ready' } : fail('Skeleton missing or unreadable.');
    if (targetStage === 'foundry') return { ok: true as const, message: 'Parts ready for mechanism search' };
    if (targetStage === 'design') return { ok: true as const, message: mechanisms.length ? 'Mechanisms ready' : 'Parts ready; add a mechanism in Design' };
    if (targetStage === 'blueprint' || targetStage === 'assembly') return mechanisms.every(m => m.id && Number.isFinite(m.anchorX) && Number.isFinite(m.anchorY)) ? { ok: true as const, message: 'Fabrication inputs ready' } : fail('Each enabled mechanism needs an id and board anchor before Blueprint.', 'design');
    return { ok: true as const, message: 'Ready' };
};

export const applyProjectAction = (project: ProjectState, action: ProjectAction): ProjectState => {
    switch (action.type) {
        case 'load_project':
            return loadProjectSnapshot(action.project);
        case 'set_processing':
            return { ...project, processing: action.processing };
        case 'select_part': {
            const nextPath = Object.values(project.paths).find(path => !path.sceneObjectId && path.partId === action.partId);
            return { ...project, selectedPartId: action.partId, selectedSceneObjectId: undefined, selectedPathId: nextPath?.id };
        }
        case 'upsert_part': {
            const exists = Boolean(project.parts[action.part.id]);
            const parts = { ...project.parts, [action.part.id]: action.part };
            const partOrder = exists ? project.partOrder : [...project.partOrder, action.part.id];
            return touch({ ...project, parts, partOrder, selectedPartId: action.part.id, selectedSceneObjectId: undefined });
        }
        case 'delete_part': {
            if (project.parts[action.partId]?.locked) return project;
            const { [action.partId]: _part, ...parts } = project.parts;
            const paths = Object.fromEntries(Object.entries(project.paths).filter(([, path]) => path.sceneObjectId || path.partId !== action.partId));
            const mechanisms = project.mechanisms.map(m => m.targetPartId === action.partId
                ? mechanismWithGeneratedPath(
                    { ...m, targetPartId: undefined, targetPathId: undefined, activeVisualPartIds: [] },
                    { preserveGeneratedPath: preserveGeneratedPathFor(m) }
                )
                : m);
            const nextPartId = project.partOrder.find(id => id !== action.partId);
            return touch({
                ...project,
                parts,
                paths,
                mechanisms,
                partOrder: project.partOrder.filter(id => id !== action.partId),
                selectedPartId: project.selectedPartId === action.partId ? nextPartId : project.selectedPartId,
                selectedPathId: project.paths[project.selectedPathId ?? '']?.partId === action.partId ? undefined : project.selectedPathId
            });
        }
        case 'update_part':
            if (!project.parts[action.partId]) return project;
            if (action.updates.anchorJointId && !project.skeleton?.joints[action.updates.anchorJointId]) return project;
            if (project.parts[action.partId].locked && Object.keys(action.updates).some(key => key !== 'locked')) return project;
            return touch({ ...project, parts: { ...project.parts, [action.partId]: { ...project.parts[action.partId], ...action.updates } } });
        case 'reorder_part': {
            if (project.parts[action.partId]?.locked) return project;
            const order = [...project.partOrder];
            const i = order.indexOf(action.partId);
            const j = i + action.direction;
            if (i < 0 || j < 0 || j >= order.length) return project;
            [order[i], order[j]] = [order[j], order[i]];
            return touch({ ...project, partOrder: order });
        }
        case 'select_scene_object': {
            const nextPath = Object.values(project.paths).find(path => path.sceneObjectId === action.objectId);
            return { ...project, selectedSceneObjectId: action.objectId, selectedPartId: action.objectId ? undefined : project.selectedPartId, selectedPathId: nextPath?.id };
        }
        case 'upsert_scene_object': {
            const exists = Boolean(project.sceneObjects[action.object.id]);
            const sceneObjects = { ...project.sceneObjects, [action.object.id]: action.object };
            const sceneObjectOrder = exists ? project.sceneObjectOrder : [...project.sceneObjectOrder, action.object.id];
            const nextPath = Object.values(project.paths).find(path => path.sceneObjectId === action.object.id);
            return touch({ ...project, sceneObjects, sceneObjectOrder, selectedSceneObjectId: action.object.id, selectedPartId: undefined, selectedPathId: nextPath?.id });
        }
        case 'update_scene_object':
            if (!project.sceneObjects[action.objectId]) return project;
            if (project.sceneObjects[action.objectId].locked && Object.keys(action.updates).some(key => key !== 'locked')) return project;
            return touch({ ...project, sceneObjects: { ...project.sceneObjects, [action.objectId]: { ...project.sceneObjects[action.objectId], ...action.updates } } });
        case 'delete_scene_object': {
            if (project.sceneObjects[action.objectId]?.locked) return project;
            const { [action.objectId]: _object, ...sceneObjects } = project.sceneObjects;
            const paths = Object.fromEntries(Object.entries(project.paths).filter(([, path]) => path.sceneObjectId !== action.objectId));
            const mechanisms = project.mechanisms.map(m => m.targetSceneObjectId === action.objectId
                ? mechanismWithGeneratedPath(
                    { ...m, targetSceneObjectId: undefined, targetPathId: undefined },
                    { preserveGeneratedPath: preserveGeneratedPathFor(m) }
                )
                : m);
            return touch({
                ...project,
                sceneObjects,
                paths,
                mechanisms,
                sceneObjectOrder: project.sceneObjectOrder.filter(id => id !== action.objectId),
                selectedSceneObjectId: project.selectedSceneObjectId === action.objectId ? undefined : project.selectedSceneObjectId,
                selectedPathId: project.paths[project.selectedPathId ?? '']?.sceneObjectId === action.objectId ? undefined : project.selectedPathId
            });
        }
        case 'set_skeleton':
            return touch({ ...project, skeleton: action.skeleton });
        case 'update_joint': {
            if (!project.skeleton?.joints[action.jointId]) return project;
            if (project.skeleton.joints[action.jointId].locked && Object.keys(action.updates).some(key => key !== 'locked')) return project;
            if (action.updates.parentId !== undefined && ((action.updates.parentId && !project.skeleton.joints[action.updates.parentId]) || wouldCreateCycle(project.skeleton.joints, action.jointId, action.updates.parentId))) return project;
            const joints = { ...project.skeleton.joints, [action.jointId]: { ...project.skeleton.joints[action.jointId], ...action.updates } };
            const skeleton = buildSkeleton(Object.values(joints));
            const moved = action.updates.position && skeleton.joints[action.jointId];
            const parts = moved ? Object.fromEntries(Object.entries(project.parts).map(([id, part]) => [
                id,
                part.anchorJointId === action.jointId
                    ? { ...part, localPivotOffset: localPivotOffsetForScene(part, skeleton.joints[action.jointId].position), localPivotJointId: action.jointId }
                    : part
            ])) : project.parts;
            return touch({ ...project, parts, skeleton });
        }
        case 'add_joint':
            return touch({ ...project, skeleton: buildSkeleton([...(project.skeleton ? Object.values(project.skeleton.joints) : []), action.joint]) });
        case 'remove_joint': {
            if (!project.skeleton) return project;
            const remove = new Set([action.jointId]);
            let changed = true;
            while (changed) {
                changed = false;
                Object.values(project.skeleton.joints).forEach(j => {
                    if (j.parentId && remove.has(j.parentId) && !remove.has(j.id)) {
                        remove.add(j.id);
                        changed = true;
                    }
                });
            }
            if ([...remove].some(id => project.skeleton?.joints[id]?.locked)) return project;
            const remaining = Object.values(project.skeleton.joints).filter(j => !remove.has(j.id));
            const fallbackAnchor = remaining[0]?.id;
            const parts = Object.fromEntries(Object.entries(project.parts).map(([id, part]) => [
                id,
                remove.has(part.anchorJointId) && fallbackAnchor ? { ...part, anchorJointId: fallbackAnchor } : part
            ]));
            return touch({ ...project, parts, skeleton: buildSkeleton(remaining) });
        }
        case 'upsert_path': {
            const path = validatePath(action.path);
            if (path.sceneObjectId ? project.sceneObjects[path.sceneObjectId]?.locked : project.parts[path.partId]?.locked) return project;
            const previousPath = project.paths[path.id] ? validatePath(project.paths[path.id]) : undefined;
            const paths = { ...project.paths, [path.id]: path };
            const mechanisms = project.mechanisms.map(m => m.targetPathId === path.id
                ? reconcileMechanismTargets(
                    { ...m, targetPartId: path.sceneObjectId ? undefined : m.targetPartId, targetSceneObjectId: path.sceneObjectId },
                    project.parts,
                    paths,
                    project.sceneObjects,
                    { preserveGeneratedPath: preserveGeneratedPathFor(m) && pathGeneratedGeometryUnchanged(previousPath, path) },
                    project.skeleton
                )
                : m);
            return touch({ ...project, paths, mechanisms, selectedPathId: path.id });
        }
        case 'delete_path': {
            const current = project.paths[action.pathId];
            if (current && (current.sceneObjectId ? project.sceneObjects[current.sceneObjectId]?.locked : project.parts[current.partId]?.locked)) return project;
            const { [action.pathId]: _removed, ...paths } = project.paths;
            const mechanisms = project.mechanisms.map(m => m.targetPathId === action.pathId
                ? reconcileMechanismTargets(
                    { ...m, targetPathId: undefined },
                    project.parts,
                    paths,
                    project.sceneObjects,
                    { preserveGeneratedPath: preserveGeneratedPathFor(m) },
                    project.skeleton
                )
                : m);
            return touch({ ...project, paths, mechanisms, selectedPathId: project.selectedPathId === action.pathId ? undefined : project.selectedPathId });
        }
        case 'set_mechanisms':
            return touch({ ...project, mechanisms: action.mechanisms.map(m => reconcileMechanismTargets(m, project.parts, project.paths, project.sceneObjects, { preserveGeneratedPath: preserveGeneratedPathFor(m) }, project.skeleton)), selectedMechanismId: action.selectedMechanismId ?? project.selectedMechanismId });
        case 'upsert_mechanism': {
            const mechanism = reconcileMechanismTargets(action.mechanism, project.parts, project.paths, project.sceneObjects, { preserveGeneratedPath: preserveGeneratedPathFor(action.mechanism) }, project.skeleton);
            const exists = project.mechanisms.some(m => m.id === mechanism.id);
            const mechanisms = exists ? project.mechanisms.map(m => m.id === mechanism.id ? mechanism : m) : [...project.mechanisms, mechanism];
            return touch({ ...project, mechanisms, selectedMechanismId: mechanism.id });
        }
        case 'delete_mechanism':
            return touch({ ...project, mechanisms: project.mechanisms.filter(m => m.id !== action.mechanismId), selectedMechanismId: project.selectedMechanismId === action.mechanismId ? undefined : project.selectedMechanismId });
        case 'update_settings': {
            const settings = normalizeAppSettings({
                ...project.settings,
                ...action.settings,
                physicalKit: { ...project.settings.physicalKit, ...(action.settings.physicalKit ?? {}) }
            }, project.settings);
            const invalidatesExport = Boolean(action.settings.physicalKit || action.settings.fabricationReadyMode !== undefined || action.settings.physicsSnapMode !== undefined || action.settings.simulationFriction !== undefined || action.settings.simulationMassKg !== undefined);
            return invalidatesExport ? touch({ ...project, settings }) : { ...project, settings };
        }
        case 'set_export':
            return touch({ ...project, lastExport: action.fabricationPackage }, { preserveExport: true });
        case 'set_foundry_export':
            return touch({ ...project, lastFoundryExport: action.foundryExport }, { preserveExport: true });
        default:
            return project;
    }
};

export const validatePath = (path: ProjectMotionPath): ProjectMotionPath => {
    const raw = asRecord(path);
    const points = Array.isArray(raw.points) ? raw.points.map(p => sanitizePoint(p)).slice(0, 2000) : [];
    const source = ['drawn', 'tracked', 'generated', 'imported'].includes(String(raw.source)) ? raw.source as ProjectMotionPath['source'] : 'imported';
    const sceneObjectId = typeof raw.sceneObjectId === 'string' && raw.sceneObjectId.trim() ? raw.sceneObjectId.slice(0, 80) : undefined;
    const normalized: ProjectMotionPath = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 80) : uid('path'),
        partId: sceneObjectId ? '' : (typeof raw.partId === 'string' ? raw.partId : ''),
        sceneObjectId,
        targetAnchorJointId: !sceneObjectId && typeof raw.targetAnchorJointId === 'string' && raw.targetAnchorJointId.trim() ? raw.targetAnchorJointId.slice(0, 80) : undefined,
        chainRootJointId: !sceneObjectId && typeof raw.chainRootJointId === 'string' && raw.chainRootJointId.trim() ? raw.chainRootJointId.slice(0, 80) : undefined,
        smoothness: clampNumber(raw.smoothness, 0, 0, 100),
        points,
        timedPoints: Array.isArray(raw.timedPoints) ? raw.timedPoints.map(p => ({ ...sanitizePoint(p), time: finiteNumber(asRecord(p).time, 0) })).slice(0, 2000) : undefined,
        duration: clampNumber(raw.duration, 1800, 100, 120000),
        closed: raw.closed === undefined ? true : Boolean(raw.closed),
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
        visible: typeof raw.visible === 'boolean' ? raw.visible : true,
        source,
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 20) : []
    };
    return {
        ...normalized,
        warnings: [
            ...normalized.warnings,
            ...(normalized.points.length < 3 ? ['Path needs at least 3 points'] : []),
            ...(normalized.enabled && normalized.points.length > 1 ? [] : ['Path disabled or empty'])
        ]
    };
};

export const serializeProject = (project: ProjectState): string => JSON.stringify({ ...project, version: APP_STATE_VERSION }, null, 2);


const normalizeSkeletonSnapshot = (skeleton: unknown): StandardSkeleton | null => {
    if (!skeleton || typeof skeleton !== 'object') return null;
    const raw = skeleton as Partial<StandardSkeleton> & { skeleton?: Array<{ name?: string; loc?: [number, number]; parent?: string | null }> };
    if (Array.isArray(raw.skeleton)) {
        return buildSkeleton(raw.skeleton.map(item => ({
            id: item.name ?? uid('joint'),
            name: item.name ?? 'joint',
            position: Array.isArray(item.loc) ? { x: Number(item.loc[0]) || 0, y: Number(item.loc[1]) || 0 } : { x: 0, y: 0 },
            parentId: item.parent ?? null,
            locked: false,
            bendDirection: 1
        })));
    }
    const joints = raw.joints && typeof raw.joints === 'object' ? Object.values(raw.joints) : [];
    if (!joints.length) return null;
    const normalized = joints.map((jointLike: unknown) => {
        const j = jointLike as Partial<StandardJoint> & { loc?: [number, number]; position?: Point };
        return {
            id: String(j.id || j.name || uid('joint')),
            name: String(j.name || j.id || 'joint'),
            position: j.position ?? (Array.isArray(j.loc) ? { x: Number(j.loc[0]) || 0, y: Number(j.loc[1]) || 0 } : { x: 0, y: 0 }),
            parentId: j.parentId ?? null,
            locked: Boolean(j.locked),
            bendDirection: Number.isFinite(j.bendDirection) ? Number(j.bendDirection) : 1
        } satisfies StandardJoint;
    });
    const rebuilt = buildSkeleton(normalized);
    rebuilt.metadata = { ...rebuilt.metadata, ...(raw.metadata ?? {}) };
    return rebuilt;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? value as Record<string, unknown> : {};

const normalizeTransformSnapshot = (value: unknown, fallback: Transform = { x: 0, y: 0, rotation: 0, scale: 1 }): Transform => {
    const raw = asRecord(value);
    return {
        x: finiteNumber(raw.x, fallback.x),
        y: finiteNumber(raw.y, fallback.y),
        rotation: finiteNumber(raw.rotation, fallback.rotation),
        scale: clampNumber(raw.scale, fallback.scale, 0.01, 20)
    };
};

const normalizeContourPoints = (value: unknown): Point[] | undefined => {
    const points = Array.isArray(value) ? value.flatMap(point => {
        const raw = Array.isArray(point) ? { x: point[0], y: point[1] } : asRecord(point);
        const x = Number(raw.x);
        const y = Number(raw.y);
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    }).slice(0, 256) : [];
    return isUsableContourPoints(points) ? points : undefined;
};

const safeRasterTextureUrl = (value: unknown): string | undefined =>
    typeof value === 'string' && /^data:image\/(?:png|jpe?g|webp);/i.test(value)
        ? value
        : undefined;

const normalizePartSnapshot = (id: string, value: unknown, skeleton: StandardSkeleton | null): BodyPartLayer => {
    const raw = asRecord(value);
    const fallbackAnchor = skeleton?.rootJointIds[0] ?? Object.keys(skeleton?.joints ?? {})[0] ?? 'root';
    const requestedAnchor = typeof raw.anchorJointId === 'string' ? raw.anchorJointId : fallbackAnchor;
    const anchorJointId = skeleton?.joints[requestedAnchor] ? requestedAnchor : fallbackAnchor;
    const rawBounds = asRecord(raw.bounds);
    const rawPivot = raw.localPivotOffset;
    const textureUrl = typeof raw.textureUrl === 'string' && raw.textureUrl.startsWith('data:image/') ? raw.textureUrl : undefined;
    const maskUrl = typeof raw.maskUrl === 'string' && raw.maskUrl.startsWith('data:image/') ? raw.maskUrl : undefined;
    const rawSourceFrame = asRecord(raw.sourceImageFrame ?? raw.source_image_frame);
    const sourceImageFrame = rawSourceFrame.width !== undefined && rawSourceFrame.height !== undefined ? {
        x: finiteNumber(rawSourceFrame.x, 0),
        y: finiteNumber(rawSourceFrame.y, 0),
        width: clampNumber(rawSourceFrame.width, 1, 1, 20000),
        height: clampNumber(rawSourceFrame.height, 1, 1, 20000)
    } : undefined;
    const contourPoints = normalizeContourPoints(raw.contourPoints ?? raw.contour_points ?? raw.outlinePoints ?? raw.outline_points);
    const rawContourSource = raw.contourSource ?? raw.contour_source;
    const contourSource = rawContourSource === 'onnx-mask' || rawContourSource === 'user' || rawContourSource === 'imported' ? rawContourSource : contourPoints ? 'imported' : undefined;
    return {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : id,
        textureUrl,
        maskUrl,
        sourceImageFrame,
        contourPoints,
        contourSource,
        originalSvgPath: typeof raw.originalSvgPath === 'string' ? raw.originalSvgPath : typeof raw.original_svg_path === 'string' ? raw.original_svg_path : undefined,
        enhancedSvgPath: typeof raw.enhancedSvgPath === 'string' ? raw.enhancedSvgPath : typeof raw.enhanced_svg_path === 'string' ? raw.enhanced_svg_path : undefined,
        anchorJointId,
        transform: normalizeTransformSnapshot(raw.transform),
        zIndex: finiteNumber(raw.zIndex, 0),
        opacity: clampNumber(raw.opacity, 0.9, 0, 1),
        visible: typeof raw.visible === 'boolean' ? raw.visible : true,
        locked: Boolean(raw.locked),
        selectable: typeof raw.selectable === 'boolean' ? raw.selectable : true,
        bounds: {
            x: finiteNumber(rawBounds.x, -40),
            y: finiteNumber(rawBounds.y, -40),
            width: clampNumber(rawBounds.width, 80, 1, 10000),
            height: clampNumber(rawBounds.height, 80, 1, 10000)
        },
        localPivotOffset: rawPivot ? sanitizePoint(rawPivot) : undefined,
        localPivotJointId: typeof raw.localPivotJointId === 'string' ? raw.localPivotJointId : typeof raw.local_pivot_joint_id === 'string' ? raw.local_pivot_joint_id : rawPivot ? anchorJointId : undefined,
        group: typeof raw.group === 'string' ? raw.group.slice(0, 80) : undefined,
        fillColor: sanitizeHexColor(raw.fillColor, '#64748b')
    };
};

const normalizeSceneObjectSnapshot = (id: string, value: unknown): SceneObject => {
    const raw = asRecord(value);
    const shape = pickOne(raw.shape, ['piggy-bank', 'cloud', 'star', 'block'] as const, 'block');
    const rawBounds = asRecord(raw.bounds);
    const textureUrl = safeRasterTextureUrl(raw.textureUrl);
    const contourPoints = normalizeContourPoints(raw.contourPoints ?? raw.contour_points ?? raw.outlinePoints ?? raw.outline_points);
    const rawContourSource = raw.contourSource ?? raw.contour_source;
    const contourSource = rawContourSource === 'user' || rawContourSource === 'imported' ? rawContourSource : contourPoints ? 'imported' : undefined;
    return {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : id,
        shape,
        textureUrl,
        contourPoints,
        contourSource,
        sourceImageName: typeof raw.sourceImageName === 'string' ? raw.sourceImageName.slice(0, 120) : typeof raw.source_image_name === 'string' ? raw.source_image_name.slice(0, 120) : undefined,
        transform: normalizeTransformSnapshot(raw.transform),
        bounds: {
            width: clampNumber(rawBounds.width, 72, 8, 600),
            height: clampNumber(rawBounds.height, 56, 8, 600)
        },
        fillColor: sanitizeHexColor(raw.fillColor, '#c4b5fd'),
        opacity: clampNumber(raw.opacity, 0.92, 0, 1),
        visible: typeof raw.visible === 'boolean' ? raw.visible : true,
        locked: Boolean(raw.locked),
        zIndex: Math.round(clampNumber(raw.zIndex, 20, -100, 100))
    };
};

const normalizeMechanismSnapshot = (value: unknown): MechanismConfig => {
    const raw = asRecord(value);
    const type = sanitizeMechanismType(raw.type);
    const base = createDefaultMechanism(type, typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 80) : uid('mech'));
    const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 20) : [];
    const optionalNumber = (v: unknown): number | undefined => {
        if (v === undefined || v === null || v === '') return undefined;
        const parsed = finiteNumber(v, Number.NaN);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    const anchor = { x: optionalNumber(raw.anchorX) ?? base.anchorX ?? 0, y: optionalNumber(raw.anchorY) ?? base.anchorY ?? 0 };
    const activeVisualPartIds = Array.isArray(raw.activeVisualPartIds) ? raw.activeVisualPartIds.map(String).slice(0, 50) : (typeof raw.targetPartId === 'string' ? [raw.targetPartId] : []);
    const crankLength = clampNumber(raw.crankLength, base.crankLength, 1, 10000);
    const rockerLength = clampNumber(raw.rockerLength, base.rockerLength, 1, 10000);
    const gearTrainRadii = Array.isArray(raw.gearTrainRadii)
        ? raw.gearTrainRadii.map(value => finiteNumber(value, Number.NaN)).filter(Number.isFinite).map(value => Math.max(1, Math.abs(value))).slice(0, 8)
        : (type === 'gear' || type === 'gear_linkage' ? [crankLength, rockerLength] : base.gearTrainRadii);
    const gearRatio = type === 'gear' || type === 'gear_linkage'
        ? gearTrainOutputRatio({ crankLength, rockerLength, gearTrainRadii })
        : raw.gearRatio === undefined ? base.gearRatio : finiteNumber(raw.gearRatio, base.gearRatio ?? 1);
    const camProfileSamples = Array.isArray(raw.camProfileSamples)
        ? normalizeCamProfileSamples(raw.camProfileSamples.map(value => finiteNumber(value, Number.NaN)).filter(Number.isFinite)).slice(0, 64)
        : base.camProfileSamples;
    const normalized: MechanismConfig = {
        ...base,
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 80) : base.id,
        type,
        visible: typeof raw.visible === 'boolean' ? raw.visible : base.visible,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
        color: sanitizeHexColor(raw.color, base.color),
        anchorX: optionalNumber(raw.anchorX),
        anchorY: optionalNumber(raw.anchorY),
        transform: normalizeTransformSnapshot(raw.transform, { x: anchor.x, y: anchor.y, rotation: finiteNumber(raw.groundAngle, base.groundAngle ?? 0), scale: 1 }),
        sceneAnchor: sanitizePoint(raw.sceneAnchor, anchor),
        activeVisualPartIds,
        fabricationMetadata: asRecord(raw.fabricationMetadata) as MechanismConfig['fabricationMetadata'],
        foundryExport: raw.foundryExport && typeof raw.foundryExport === 'object' ? raw.foundryExport as FoundryExportPackage : undefined,
        groundAngle: finiteNumber(raw.groundAngle, base.groundAngle ?? 0),
        groundLength: finiteNumber(raw.groundLength, base.groundLength),
        crankLength,
        couplerLength: clampNumber(raw.couplerLength, base.couplerLength, 0, 10000),
        rockerLength,
        sliderOffset: finiteNumber(raw.sliderOffset, base.sliderOffset),
        couplerPointDist: finiteNumber(raw.couplerPointDist, base.couplerPointDist),
        couplerPointAngle: finiteNumber(raw.couplerPointAngle, base.couplerPointAngle),
        assemblyMode: raw.assemblyMode === 'crossed' ? 'crossed' : raw.assemblyMode === 'open' ? 'open' : base.assemblyMode,
        speed1: finiteNumber(raw.speed1, base.speed1 ?? 1),
        speed2: type === 'gear' || type === 'gear_linkage' ? gearRatio : finiteNumber(raw.speed2, base.speed2 ?? 1),
        gearRatio,
        gearTrainRadii,
        camProfileSamples,
        driverGroupId: typeof raw.driverGroupId === 'string' && raw.driverGroupId.trim() ? raw.driverGroupId.slice(0, 80) : base.driverGroupId,
        driverPhaseOffset: finiteNumber(raw.driverPhaseOffset, base.driverPhaseOffset ?? 0),
        rodLength: raw.rodLength === undefined ? base.rodLength : finiteNumber(raw.rodLength, base.rodLength ?? 0),
        phase: finiteNumber(raw.phase, base.phase ?? 0),
        showOutputGear: typeof raw.showOutputGear === 'boolean' ? raw.showOutputGear : base.showOutputGear,
        outputGearRadius: raw.outputGearRadius === undefined ? base.outputGearRadius : finiteNumber(raw.outputGearRadius, base.outputGearRadius ?? 0),
        targetPartId: typeof raw.targetPartId === 'string' ? raw.targetPartId : undefined,
        targetSceneObjectId: typeof raw.targetSceneObjectId === 'string' ? raw.targetSceneObjectId : undefined,
        targetPathId: typeof raw.targetPathId === 'string' ? raw.targetPathId : undefined,
        targetAnchorJointId: typeof raw.targetAnchorJointId === 'string' ? raw.targetAnchorJointId : undefined,
        presetId: typeof raw.presetId === 'string' ? raw.presetId : base.presetId,
        recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : base.recommendation,
        source: ['manual', 'foundry', 'optimized', 'imported'].includes(String(raw.source)) ? raw.source as MechanismConfig['source'] : base.source,
        generatedPath: Array.isArray(raw.generatedPath) ? raw.generatedPath.map(p => sanitizePoint(p)).slice(0, 1000) : undefined,
        warnings
    };
    const hasFittedGeometry = [
        raw.groundLength,
        raw.crankLength,
        raw.couplerLength,
        raw.rockerLength,
        raw.sliderOffset,
        raw.couplerPointDist,
        raw.couplerPointAngle,
        raw.rodLength,
        raw.outputGearRadius,
        raw.gearRatio
    ].some(value => optionalNumber(value) !== undefined)
        || Array.isArray(raw.gearTrainRadii)
        || Array.isArray(raw.camProfileSamples)
        || Array.isArray(raw.generatedPath);
    return hasFittedGeometry ? normalizeMechanismToFabricationSet(normalized) : normalizeMechanismToReference(normalized);
};

export const migrateProjectSnapshot = (raw: unknown): ProjectState => {
    const fallback = createEmptyProject();
    if (!raw || typeof raw !== 'object') return fallback;
    const data = raw as Partial<ProjectState>;
    const { graph: _graph, graphCompiler: _graphCompiler, mechanismGraph: _mechanismGraph, graphIr: _graphIr, ...snapshotData } = data as Partial<ProjectState> & Record<string, unknown>;
    const skeleton = normalizeSkeletonSnapshot(data.skeleton);
    const parts = Object.fromEntries(Object.entries(data.parts ?? {}).map(([id, value]) => [id, normalizePartSnapshot(id, value, skeleton)]));
    const partOrder = (data.partOrder ?? Object.keys(parts)).filter(id => Boolean(parts[id]));
    const sceneObjects = Object.fromEntries(Object.entries(data.sceneObjects ?? {}).map(([id, value]) => [id, normalizeSceneObjectSnapshot(id, value)]));
    const sceneObjectOrder = (data.sceneObjectOrder ?? Object.keys(sceneObjects)).filter(id => Boolean(sceneObjects[id]));
    const paths = Object.fromEntries(Object.entries(data.paths ?? {}).flatMap(([id, path]) => {
        const next = validatePath({ ...asRecord(path), id } as ProjectMotionPath);
        return next.sceneObjectId ? (sceneObjects[next.sceneObjectId] ? [[id, next] as const] : []) : (parts[next.partId] ? [[id, next] as const] : []);
    }));
    return {
        ...fallback,
        ...snapshotData,
        version: APP_STATE_VERSION,
        metadata: { ...fallback.metadata, ...(data.metadata ?? {}), updatedAt: nowIso() },
        parts,
        partOrder,
        sceneObjects,
        sceneObjectOrder,
        selectedSceneObjectId: data.selectedSceneObjectId && sceneObjects[data.selectedSceneObjectId] ? data.selectedSceneObjectId : undefined,
        skeleton,
        paths,
        mechanisms: (Array.isArray(data.mechanisms) ? data.mechanisms : fallback.mechanisms).map(m => reconcileMechanismTargets(normalizeMechanismSnapshot(m), parts, paths, sceneObjects, { preserveGeneratedPath: true }, skeleton)),
        settings: normalizeAppSettings(data.settings, fallback.settings),
        processing: data.processing ?? idleProcessing(),
        lastExport: undefined
    };
};

export const loadProjectSnapshot = (raw: unknown): ProjectState => migrateProjectSnapshot(raw);

export const downloadText = (filename: string, text: string, type = 'application/json') => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const projectSelfCheck = () => {
    const sample = createSampleProject();
    const loaded = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
    const duplicateA = createDefaultMechanism('4bar', 'a');
    const duplicateB = createDefaultMechanism('4bar', 'b');
    if (loaded.partOrder.length === 0) throw new Error('selfcheck: sample parts missing');
    if (new Set([duplicateA.id, duplicateB.id]).size !== 2) throw new Error('selfcheck: mechanism ids collide');
    const migrated = loadProjectSnapshot({ skeleton: { joints: { root: { id: 'root', name: 'root', position: { x: 0, y: 0 } } } } });
    if (migrated.skeleton?.joints.root.bendDirection !== 1) throw new Error('selfcheck: skeleton migration missing bendDirection default');
    const objectAdded = applyProjectAction(sample, { type: 'upsert_scene_object', object: createDefaultSceneObject('piggy-bank', 'object-selfcheck') });
    if (!objectAdded.sceneObjects['object-selfcheck'] || objectAdded.selectedPartId) throw new Error('selfcheck: scene object add/select failed');
    const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_elbow' });
    if (removed.parts.right_arm_lower?.anchorJointId === 'right_elbow') throw new Error('selfcheck: part anchor not repaired after joint delete');
    return true;
};

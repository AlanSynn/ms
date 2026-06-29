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
    ProjectState,
    StandardJoint,
    StandardSkeleton,
    Transform
} from '../types';
import { defaultPhysicalKit, localPivotOffsetForScene, SCENE_PX_PER_MM, sceneBoundsForSheet } from './coordinates';
import { FABRICATION_GEAR_SPECS, FABRICATION_RING_GEAR_SPEC } from './fabricationContract';
import { REFERENCE_DEFAULTS, normalizeMechanismToReference, referenceRequiredPartsForMechanism } from './mechanismReference';
import { defaultCamProfileSamples, gearTrainOutputRatio, gearTrainPitchCenterDistance, generateCurvePoints, normalizeCamProfileSamples, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from './kinematics';
import { clampNumber, finiteNumber, sanitizeHexColor, sanitizeMechanismType, sanitizePoint } from './sanitize';
import { isUsableContourPoints } from './partGeometry';

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
    toolbarVisible: false,
    partPanelVisible: true,
    autosave: false,
    autosaveIntervalSeconds: 60,
    performancePreset: 'balanced',
    physicsSnapMode: 'balanced',
    simulationFriction: 0.18,
    simulationMassKg: 1,
    debugVisuals: false,
    detailedProcessingSteps: false,
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

export const mechanismRequiredParts = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'gearTrainRadii'>>) => {
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

type StarterPartShape = 'torso' | 'head' | 'limb' | 'hand' | 'foot';

const capsuleContour = (width: number, height: number): Point[] => {
    const r = Math.min(width, height) / 2;
    const halfW = width / 2;
    const halfH = height / 2;
    const steps = 6;
    const points: Point[] = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = Math.PI - (Math.PI * i) / steps;
        points.push({ x: Math.cos(t) * r, y: -halfH + r + Math.sin(t) * r });
    }
    for (let i = 0; i <= steps; i += 1) {
        const t = -Math.PI * i / steps;
        points.push({ x: Math.cos(t) * r, y: halfH - r + Math.sin(t) * r });
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
            { x: -hw * 0.58, y: -hh * 0.96 }, { x: hw * 0.58, y: -hh * 0.96 }, { x: hw * 0.82, y: -hh * 0.55 },
            { x: hw * 0.9, y: hh * 0.62 }, { x: hw * 0.55, y: hh * 0.96 }, { x: -hw * 0.55, y: hh * 0.96 },
            { x: -hw * 0.9, y: hh * 0.62 }, { x: -hw * 0.82, y: -hh * 0.55 }
        ];
    }
    if (shape === 'hand') {
        return [
            { x: -hw * 0.6, y: -hh * 0.72 }, { x: hw * 0.55, y: -hh * 0.82 }, { x: hw * 0.88, y: -hh * 0.15 },
            { x: hw * 0.52, y: hh * 0.82 }, { x: -hw * 0.5, y: hh * 0.72 }, { x: -hw * 0.88, y: hh * 0.08 }
        ];
    }
    if (shape === 'foot') {
        return [
            { x: -hw * 0.92, y: -hh * 0.5 }, { x: hw * 0.35, y: -hh * 0.8 }, { x: hw * 0.94, y: -hh * 0.2 },
            { x: hw * 0.72, y: hh * 0.62 }, { x: -hw * 0.58, y: hh * 0.82 }, { x: -hw * 0.96, y: hh * 0.25 }
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
    groundLength: type === 'gear' || type === 'gear_linkage' ? gearTrainPitchCenterDistance({ crankLength: DEFAULT_DRIVE_GEAR_RADIUS, rockerLength: DEFAULT_OUTPUT_GEAR_RADIUS }) : type === 'planetary_gear' ? DEFAULT_PLANETARY_CARRIER_RADIUS : type === 'piston' || type === 'yoke' || type === 'cam' || type === 'rack-pinion' ? 0 : REFERENCE_DEFAULTS.fourBar.ground,
    crankLength: type === '6bar' ? 55 : type === '5bar' ? 60 : type === 'gear' || type === 'gear_linkage' ? DEFAULT_DRIVE_GEAR_RADIUS : type === 'planetary_gear' ? DEFAULT_PLANETARY_SUN_RADIUS : type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.crank : type === 'cam' ? REFERENCE_DEFAULTS.cam.radius : type === 'rack-pinion' ? 42 : REFERENCE_DEFAULTS.fourBar.input,
    couplerLength: type === '6bar' ? 145 : type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.rod : type === 'gear_linkage' ? REFERENCE_DEFAULTS.gearLinkage.outputLinkage : type === 'yoke' || type === 'cam' || type === 'gear' || type === 'planetary_gear' || type === 'rack-pinion' ? 0 : REFERENCE_DEFAULTS.fourBar.coupler,
    rockerLength: type === '6bar' ? 110 : type === '5bar' ? 48 : type === 'quick-return' ? 130 : type === 'gear' || type === 'gear_linkage' ? DEFAULT_OUTPUT_GEAR_RADIUS : type === 'planetary_gear' ? DEFAULT_PLANETARY_PLANET_RADIUS : type === 'cam' ? REFERENCE_DEFAULTS.cam.followerTravel : type === 'rack-pinion' ? 380 : type === 'piston' ? 0 : REFERENCE_DEFAULTS.fourBar.output,
    sliderOffset: type === 'piston' ? REFERENCE_DEFAULTS.sliderCrank.guideOffset : type === 'rack-pinion' ? 56 : 0,
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
    generatedPath: options.preserveGeneratedPath && mechanism.generatedPath?.length ? mechanism.generatedPath : generateCurvePoints(mechanism, 96).points
});

const reconcileMechanismTargets = (
    mechanism: MechanismConfig,
    parts: Record<string, BodyPartLayer>,
    paths: Record<string, ProjectMotionPath>,
    options: { preserveGeneratedPath?: boolean } = {}
) => {
    let targetPartId = mechanism.targetPartId && parts[mechanism.targetPartId] ? mechanism.targetPartId : undefined;
    let targetPathId = mechanism.targetPathId && paths[mechanism.targetPathId] ? mechanism.targetPathId : undefined;
    if (targetPathId) {
        const pathPartId = paths[targetPathId].partId;
        if (parts[pathPartId]) targetPartId = pathPartId;
        else targetPathId = undefined;
    }
    const pathAnchorJointId = targetPathId ? paths[targetPathId]?.targetAnchorJointId : undefined;
    const targetAnchorJointId = targetPartId ? (mechanism.targetAnchorJointId ?? pathAnchorJointId ?? parts[targetPartId]?.anchorJointId) : undefined;
    return mechanismWithGeneratedPath({ ...mechanism, targetPartId, targetPathId, targetAnchorJointId, activeVisualPartIds: targetPartId ? [targetPartId] : [] }, options);
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
        part('torso', 'Torso', 'torso', { x: 0, y: 20, rotation: 0, scale: 1 }, { width: 118, height: 176 }, '#cbd5e1', 0, 'torso'),
        part('head', 'Head', 'neck', { x: 0, y: 154, rotation: 0, scale: 1 }, { width: 82, height: 82 }, '#e2e8f0', 5, 'head'),
        part('left_arm_upper', 'Left upper arm', 'left_shoulder', { x: -78, y: 58, rotation: -20, scale: 1 }, { width: 38, height: 88 }, '#b6c2d2', 3, 'limb'),
        part('left_arm_lower', 'Left lower arm', 'left_elbow', { x: -118, y: -8, rotation: -18, scale: 1 }, { width: 36, height: 88 }, '#b6c2d2', 3, 'limb'),
        part('left_hand_part', 'Left hand', 'left_hand', { x: -136, y: -52, rotation: -18, scale: 1 }, { width: 34, height: 38 }, '#d1d5db', 4, 'hand'),
        part('right_arm_upper', 'Right upper arm', 'right_shoulder', { x: 78, y: 58, rotation: 20, scale: 1 }, { width: 38, height: 88 }, '#b6c2d2', 3, 'limb'),
        part('right_arm_lower', 'Right lower arm', 'right_elbow', { x: 118, y: -8, rotation: 18, scale: 1 }, { width: 36, height: 88 }, '#b6c2d2', 3, 'limb'),
        part('right_hand_part', 'Right hand', 'right_hand', { x: 136, y: -52, rotation: 18, scale: 1 }, { width: 34, height: 38 }, '#d1d5db', 4, 'hand'),
        part('left_leg_upper', 'Left upper leg', 'left_hip', { x: -43, y: -114, rotation: -8, scale: 1 }, { width: 42, height: 92 }, '#94a3b8', 1, 'limb'),
        part('left_leg_lower', 'Left lower leg', 'left_knee', { x: -62, y: -190, rotation: -8, scale: 1 }, { width: 42, height: 94 }, '#94a3b8', 1, 'limb'),
        part('left_foot_part', 'Left foot', 'left_foot', { x: -86, y: -238, rotation: -8, scale: 1 }, { width: 54, height: 34 }, '#94a3b8', 2, 'foot'),
        part('right_leg_upper', 'Right upper leg', 'right_hip', { x: 43, y: -114, rotation: 8, scale: 1 }, { width: 42, height: 92 }, '#94a3b8', 1, 'limb'),
        part('right_leg_lower', 'Right lower leg', 'right_knee', { x: 62, y: -190, rotation: 8, scale: 1 }, { width: 42, height: 94 }, '#94a3b8', 1, 'limb'),
        part('right_foot_part', 'Right foot', 'right_foot', { x: 86, y: -238, rotation: 8, scale: 1 }, { width: 54, height: 34 }, '#94a3b8', 2, 'foot')
    ].map(p => ({ ...p, localPivotOffset: localPivotOffsetForScene(p, skeleton.joints[p.anchorJointId]?.position ?? p.transform), localPivotJointId: p.anchorJointId }));
    const mechanisms = includeMechanism ? [createDefaultMechanism('4bar', 'mech-1')] : [];
    if (mechanisms[0]) {
        mechanisms[0].targetPartId = 'right_arm_lower';
        mechanisms[0].targetPathId = 'path-right-arm';
        mechanisms[0].targetAnchorJointId = 'right_hand';
        Object.assign(mechanisms[0], {
            anchorX: 120,
            anchorY: 200,
            transform: { x: 120, y: 200, rotation: 331.4, scale: 1 },
            sceneAnchor: { x: 120, y: 200 },
            groundAngle: 331.4,
            groundLength: 180.1,
            crankLength: 54.7,
            couplerLength: 108.5,
            rockerLength: 137,
            couplerPointDist: 180,
            couplerPointAngle: -13.2,
            assemblyMode: 'crossed',
            source: 'optimized',
            presetId: 'sample-fitted',
            recommendation: 'sample path fit'
        });
    }

    const pathPoints: Point[] = [
        { x: 70, y: 60 }, { x: 130, y: 84 }, { x: 174, y: 34 }, { x: 142, y: -34 }, { x: 82, y: -18 }
    ];

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
            const nextPath = Object.values(project.paths).find(path => path.partId === action.partId);
            return { ...project, selectedPartId: action.partId, selectedPathId: nextPath?.id };
        }
        case 'upsert_part': {
            const exists = Boolean(project.parts[action.part.id]);
            const parts = { ...project.parts, [action.part.id]: action.part };
            const partOrder = exists ? project.partOrder : [...project.partOrder, action.part.id];
            return touch({ ...project, parts, partOrder, selectedPartId: action.part.id });
        }
        case 'delete_part': {
            if (project.parts[action.partId]?.locked) return project;
            const { [action.partId]: _part, ...parts } = project.parts;
            const paths = Object.fromEntries(Object.entries(project.paths).filter(([, path]) => path.partId !== action.partId));
            const mechanisms = project.mechanisms.map(m => m.targetPartId === action.partId ? mechanismWithGeneratedPath({ ...m, targetPartId: undefined, targetPathId: undefined, activeVisualPartIds: [] }) : m);
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
            if (project.parts[path.partId]?.locked) return project;
            const paths = { ...project.paths, [path.id]: path };
            const mechanisms = project.mechanisms.map(m => m.targetPathId === path.id ? reconcileMechanismTargets({ ...m, targetPartId: path.partId }, project.parts, paths) : m);
            return touch({ ...project, paths, mechanisms, selectedPathId: path.id });
        }
        case 'delete_path': {
            const current = project.paths[action.pathId];
            if (current && project.parts[current.partId]?.locked) return project;
            const { [action.pathId]: _removed, ...paths } = project.paths;
            const mechanisms = project.mechanisms.map(m => m.targetPathId === action.pathId ? reconcileMechanismTargets({ ...m, targetPathId: undefined }, project.parts, paths) : m);
            return touch({ ...project, paths, mechanisms, selectedPathId: project.selectedPathId === action.pathId ? undefined : project.selectedPathId });
        }
        case 'set_mechanisms':
            return touch({ ...project, mechanisms: action.mechanisms.map(m => reconcileMechanismTargets(m, project.parts, project.paths, { preserveGeneratedPath: Boolean(m.foundryExport) })), selectedMechanismId: action.selectedMechanismId ?? project.selectedMechanismId });
        case 'upsert_mechanism': {
            const mechanism = reconcileMechanismTargets(action.mechanism, project.parts, project.paths, { preserveGeneratedPath: Boolean(action.mechanism.foundryExport) });
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
    const normalized: ProjectMotionPath = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 80) : uid('path'),
        partId: typeof raw.partId === 'string' ? raw.partId : '',
        targetAnchorJointId: typeof raw.targetAnchorJointId === 'string' && raw.targetAnchorJointId.trim() ? raw.targetAnchorJointId.slice(0, 80) : undefined,
        chainRootJointId: typeof raw.chainRootJointId === 'string' && raw.chainRootJointId.trim() ? raw.chainRootJointId.slice(0, 80) : undefined,
        smoothness: clampNumber(raw.smoothness, 0, 0, 100),
        points,
        timedPoints: Array.isArray(raw.timedPoints) ? raw.timedPoints.map(p => ({ ...sanitizePoint(p), time: finiteNumber(asRecord(p).time, 0) })).slice(0, 2000) : undefined,
        duration: clampNumber(raw.duration, 1800, 100, 120000),
        closed: Boolean(raw.closed),
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

const normalizePartSnapshot = (id: string, value: unknown, skeleton: StandardSkeleton | null): BodyPartLayer => {
    const raw = asRecord(value);
    const fallbackAnchor = skeleton?.rootJointIds[0] ?? Object.keys(skeleton?.joints ?? {})[0] ?? 'root';
    const requestedAnchor = typeof raw.anchorJointId === 'string' ? raw.anchorJointId : fallbackAnchor;
    const anchorJointId = skeleton?.joints[requestedAnchor] ? requestedAnchor : fallbackAnchor;
    const rawBounds = asRecord(raw.bounds);
    const rawPivot = raw.localPivotOffset;
    const textureUrl = typeof raw.textureUrl === 'string' && raw.textureUrl.startsWith('data:image/') ? raw.textureUrl : undefined;
    const maskUrl = typeof raw.maskUrl === 'string' && raw.maskUrl.startsWith('data:image/') ? raw.maskUrl : undefined;
    const contourPoints = normalizeContourPoints(raw.contourPoints ?? raw.contour_points ?? raw.outlinePoints ?? raw.outline_points);
    const rawContourSource = raw.contourSource ?? raw.contour_source;
    const contourSource = rawContourSource === 'onnx-mask' || rawContourSource === 'user' || rawContourSource === 'imported' ? rawContourSource : contourPoints ? 'imported' : undefined;
    return {
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : id,
        textureUrl,
        maskUrl,
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
        targetPathId: typeof raw.targetPathId === 'string' ? raw.targetPathId : undefined,
        targetAnchorJointId: typeof raw.targetAnchorJointId === 'string' ? raw.targetAnchorJointId : undefined,
        presetId: typeof raw.presetId === 'string' ? raw.presetId : base.presetId,
        recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : base.recommendation,
        source: ['manual', 'foundry', 'optimized', 'imported'].includes(String(raw.source)) ? raw.source as MechanismConfig['source'] : base.source,
        generatedPath: Array.isArray(raw.generatedPath) ? raw.generatedPath.map(p => sanitizePoint(p)).slice(0, 1000) : undefined,
        warnings
    };
    return normalizeMechanismToReference(normalized);
};

export const migrateProjectSnapshot = (raw: unknown): ProjectState => {
    const fallback = createEmptyProject();
    if (!raw || typeof raw !== 'object') return fallback;
    const data = raw as Partial<ProjectState>;
    const skeleton = normalizeSkeletonSnapshot(data.skeleton);
    const parts = Object.fromEntries(Object.entries(data.parts ?? {}).map(([id, value]) => [id, normalizePartSnapshot(id, value, skeleton)]));
    const partOrder = (data.partOrder ?? Object.keys(parts)).filter(id => Boolean(parts[id]));
    const paths = Object.fromEntries(Object.entries(data.paths ?? {}).flatMap(([id, path]) => {
        const next = validatePath({ ...asRecord(path), id } as ProjectMotionPath);
        return parts[next.partId] ? [[id, next] as const] : [];
    }));
    return {
        ...fallback,
        ...data,
        version: APP_STATE_VERSION,
        metadata: { ...fallback.metadata, ...(data.metadata ?? {}), updatedAt: nowIso() },
        parts,
        partOrder,
        skeleton,
        paths,
        mechanisms: (Array.isArray(data.mechanisms) ? data.mechanisms : fallback.mechanisms).map(m => reconcileMechanismTargets(normalizeMechanismSnapshot(m), parts, paths, { preserveGeneratedPath: true })),
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
    const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_elbow' });
    if (removed.parts.right_arm_lower?.anchorJointId === 'right_elbow') throw new Error('selfcheck: part anchor not repaired after joint delete');
    return true;
};

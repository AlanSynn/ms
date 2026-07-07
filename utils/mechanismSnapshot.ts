import type { JointState, MechanismConfig, MechanismType, PhysicalKitSettings, Point, ProjectMotionPath, ProjectState } from '../types';
import type { FabricationRenderPlan } from './fabricationRenderPlan';
import { type MechanismGraph } from './mechanismGraph';
import { compileMechanism, summarizeCompiledMechanism, type MechanismGraphCompilerSummary } from './mechanismCompiler';
import type { MechanismFeatureIssue, MechanismInteractionPolicy, MechanismPhysicsHint, MechanismProjectionHint, MechanismFeasibleRange } from './mechanismFeatureRegistry';
import { normalizeMechanismToFabricationSet } from './mechanismReference';
import { mechanismFeature } from './mechanismFeatureRegistry';

export interface MechanismSnapshotSourceIds {
    projectId: string;
    mechanismId: string;
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    physicalKitProfileKey: string;
    targetPathPointCount: number;
}

export interface MechanismSnapshotMechanism {
    id: string;
    type: MechanismType;
    visible: boolean;
    enabled: boolean;
    color: string;
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    transform?: MechanismConfig['transform'];
    sceneAnchor?: Point;
    activeVisualPartIds: string[];
    fabricationMetadata?: MechanismConfig['fabricationMetadata'];
    foundryExport?: MechanismConfig['foundryExport'];
    showOutputGear?: boolean;
    outputGearRadius?: number;
    anchorX: number;
    anchorY: number;
    groundAngle: number;
    crankLength: number;
    groundLength: number;
    couplerLength: number;
    rockerLength: number;
    sliderOffset: number;
    couplerPointDist: number;
    couplerPointAngle: number;
    assemblyMode?: 'open' | 'crossed';
    speed1: number;
    speed2: number;
    gearRatio?: number;
    gearTrainRadii?: number[];
    camProfileSamples?: number[];
    driverGroupId?: string;
    driverPhaseOffset: number;
    rodLength?: number;
    phase: number;
    source?: MechanismConfig['source'];
    presetId?: string;
    recommendation?: string;
    generatedPath: Point[];
    warnings: string[];
}

export interface MechanismSnapshotPath {
    id: string;
    partId: string;
    sceneObjectId?: string;
    targetAnchorJointId?: string;
    smoothness: number;
    duration: number;
    closed: boolean;
    enabled: boolean;
    visible: boolean;
    source: ProjectMotionPath['source'];
    pointCount: number;
    points: Point[];
    timedPoints?: Array<Point & { time: number }>;
}

export interface MechanismSnapshot {
    version: 1;
    fingerprint: string;
    sourceIds: MechanismSnapshotSourceIds;
    mechanism: MechanismSnapshotMechanism;
    label: string;
    sense: string;
    goodFor: string;
    constraint: string;
    authorable: boolean;
    physicalKit: PhysicalKitSettings;
    targetPath?: MechanismSnapshotPath;
    kinematics: JointState;
    feasibleRange: MechanismFeasibleRange;
    interactionPolicy: MechanismInteractionPolicy;
    projectionHints: MechanismProjectionHint[];
    physicsHints: MechanismPhysicsHint[];
    fabricationPlan: FabricationRenderPlan;
    graph: MechanismGraph;
    graphCompiler: MechanismGraphCompilerSummary;
    issues: MechanismFeatureIssue[];
}

const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value as number : fallback;
const point = (value: Point): Point => ({ x: finite(value.x), y: finite(value.y) });
const clonePoints = (points: readonly Point[] = []) => points.map(point);

const stableValue = (value: unknown): unknown => {
    if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, stableValue(item)])
        );
    }
    return value;
};

const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

export const mechanismSnapshotFingerprint = (value: unknown): string => {
    const input = stableJson(value);
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `ms-${(hash >>> 0).toString(36)}`;
};

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item));
    return value;
};

const cloneData = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const snapshotMechanism = (mechanism: MechanismConfig): MechanismSnapshotMechanism => ({
    id: mechanism.id,
    type: mechanism.type,
    visible: mechanism.visible,
    enabled: mechanism.enabled !== false,
    color: mechanism.color,
    targetPartId: mechanism.targetPartId,
    targetSceneObjectId: mechanism.targetSceneObjectId,
    targetPathId: mechanism.targetPathId,
    targetAnchorJointId: mechanism.targetAnchorJointId,
    transform: mechanism.transform ? { ...mechanism.transform } : undefined,
    sceneAnchor: mechanism.sceneAnchor ? point(mechanism.sceneAnchor) : undefined,
    activeVisualPartIds: [...(mechanism.activeVisualPartIds ?? [])].sort(),
    fabricationMetadata: mechanism.fabricationMetadata ? cloneData(mechanism.fabricationMetadata) : undefined,
    foundryExport: mechanism.foundryExport ? cloneData(mechanism.foundryExport) : undefined,
    showOutputGear: mechanism.showOutputGear,
    outputGearRadius: mechanism.outputGearRadius,
    anchorX: finite(mechanism.anchorX ?? mechanism.sceneAnchor?.x ?? mechanism.transform?.x),
    anchorY: finite(mechanism.anchorY ?? mechanism.sceneAnchor?.y ?? mechanism.transform?.y),
    groundAngle: finite(mechanism.groundAngle ?? mechanism.transform?.rotation),
    crankLength: finite(mechanism.crankLength),
    groundLength: finite(mechanism.groundLength),
    couplerLength: finite(mechanism.couplerLength),
    rockerLength: finite(mechanism.rockerLength),
    sliderOffset: finite(mechanism.sliderOffset),
    couplerPointDist: finite(mechanism.couplerPointDist),
    couplerPointAngle: finite(mechanism.couplerPointAngle),
    assemblyMode: mechanism.assemblyMode,
    speed1: finite(mechanism.speed1, 1),
    speed2: finite(mechanism.speed2, 1),
    gearRatio: mechanism.gearRatio,
    gearTrainRadii: mechanism.gearTrainRadii?.map(value => finite(value, 1)),
    camProfileSamples: mechanism.camProfileSamples?.map(value => finite(value, 1)),
    driverGroupId: mechanism.driverGroupId,
    driverPhaseOffset: finite(mechanism.driverPhaseOffset),
    rodLength: mechanism.rodLength,
    phase: finite(mechanism.phase),
    source: mechanism.source,
    presetId: mechanism.presetId,
    recommendation: mechanism.recommendation,
    generatedPath: clonePoints(mechanism.generatedPath),
    warnings: [...(mechanism.warnings ?? [])]
});

const snapshotPath = (path?: ProjectMotionPath): MechanismSnapshotPath | undefined => path ? ({
    id: path.id,
    partId: path.partId,
    sceneObjectId: path.sceneObjectId,
    targetAnchorJointId: path.targetAnchorJointId,
    smoothness: finite(path.smoothness),
    duration: finite(path.duration),
    closed: path.closed,
    enabled: path.enabled,
    visible: path.visible,
    source: path.source,
    pointCount: path.points.length,
    points: clonePoints(path.points),
    timedPoints: path.timedPoints?.map(item => ({ ...point(item), time: finite(item.time) }))
}) : undefined;

const snapshotFingerprintInput = (snapshot: Omit<MechanismSnapshot, 'fingerprint'>) => ({
    sourceIds: snapshot.sourceIds,
    mechanism: snapshot.mechanism,
    physicalKit: snapshot.physicalKit,
    targetPath: snapshot.targetPath,
    graph: snapshot.graph,
    graphCompiler: snapshot.graphCompiler
});

export const buildMechanismSnapshot = (project: ProjectState, mechanismId: string, angleRad = 0): MechanismSnapshot | null => {
    const mechanism = project.mechanisms.find(item => item.id === mechanismId);
    if (!mechanism) return null;

    const sourceMechanism = normalizeMechanismToFabricationSet(mechanism);
    const feature = mechanismFeature(sourceMechanism.type);
    const normalizedMechanism = snapshotMechanism(sourceMechanism);
    const targetPath = snapshotPath(mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined);
    const resolvedMechanism: MechanismConfig = {
        ...sourceMechanism,
        anchorX: normalizedMechanism.anchorX,
        anchorY: normalizedMechanism.anchorY,
        groundAngle: normalizedMechanism.groundAngle,
        speed1: normalizedMechanism.speed1,
        speed2: normalizedMechanism.speed2,
        gearRatio: normalizedMechanism.gearRatio,
        gearTrainRadii: normalizedMechanism.gearTrainRadii,
        camProfileSamples: normalizedMechanism.camProfileSamples,
        driverGroupId: normalizedMechanism.driverGroupId,
        driverPhaseOffset: normalizedMechanism.driverPhaseOffset,
        rodLength: normalizedMechanism.rodLength,
        phase: normalizedMechanism.phase
    };
    const snapshotAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    if (!snapshotAngles.some(angle => Math.abs(angle - angleRad) < 1e-9)) snapshotAngles.push(angleRad);
    const compiledMechanism = compileMechanism(resolvedMechanism, snapshotAngles, 96);
    const kinematicSample = compiledMechanism.motionSamples.find(sample => Math.abs(sample.angle - angleRad) < 1e-9) ?? compiledMechanism.motionSamples[0];
    const sourceIds: MechanismSnapshotSourceIds = {
        projectId: project.metadata.id,
        mechanismId: mechanism.id,
        targetPartId: mechanism.targetPartId,
        targetSceneObjectId: mechanism.targetSceneObjectId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId: mechanism.targetAnchorJointId,
        physicalKitProfileKey: project.settings.physicalKit.profileKey,
        targetPathPointCount: targetPath?.pointCount ?? 0
    };

    const withoutFingerprint: Omit<MechanismSnapshot, 'fingerprint'> = {
        version: 1,
        sourceIds,
        mechanism: normalizedMechanism,
        label: feature.label,
        sense: feature.sense,
        goodFor: feature.goodFor,
        constraint: feature.constraint,
        authorable: feature.authorable,
        physicalKit: cloneData(project.settings.physicalKit),
        targetPath,
        kinematics: cloneData(kinematicSample.state),
        feasibleRange: cloneData(compiledMechanism.feasibleRange),
        interactionPolicy: cloneData(feature.interactionPolicy(resolvedMechanism)),
        projectionHints: cloneData(feature.projectionHints(resolvedMechanism)),
        physicsHints: cloneData(feature.physicsHints(resolvedMechanism)),
        fabricationPlan: cloneData(compiledMechanism.fabrication.renderPlan),
        graph: cloneData(compiledMechanism.graph),
        graphCompiler: cloneData(summarizeCompiledMechanism(compiledMechanism)),
        issues: cloneData(feature.validate(resolvedMechanism))
    };

    return deepFreeze({
        ...withoutFingerprint,
        fingerprint: mechanismSnapshotFingerprint(snapshotFingerprintInput(withoutFingerprint))
    });
};

export const buildMechanismSnapshots = (project: ProjectState): MechanismSnapshot[] =>
    project.mechanisms
        .map(mechanism => buildMechanismSnapshot(project, mechanism.id))
        .filter((snapshot): snapshot is MechanismSnapshot => snapshot !== null);

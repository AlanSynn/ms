import type { ConnectionSelectionRole, FabricationRecipe, MechanismConfig, MechanismRecoveryCandidates, MechanismType, PhysicalKitSettings, ProjectState } from '../types';
import { defaultPhysicalKit } from './coordinates';
import { compileMechanism, summarizeCompiledMechanism, type MechanismGraphCompilerSummary } from './mechanismCompiler';
import { connectionSelectionIdentity } from './mechanismConnectionSelections';
import type {
    CompiledSupportPath,
    FabricationRenderKind,
    FabricationRenderLayer,
    FabricationRenderPlan,
    PinSpanMm,
    RetainedSupportEdgeMm,
    RetainedSupportNodeMm
} from './mechanismFabricationZStack';
import { buildMechanismPhysicalEnvelopeDescriptors, type MechanismPhysicalEnvelopeDescriptor } from './mechanismPhysicalEnvelope';
import {
    compilePhysicalInstancesFromPlan,
    type MechanismPhysicalPartDefinition,
    type MechanismPhysicalPartInstance
} from './mechanismPhysicalInstances';
import { resolveMechanismRuntimeGate } from './mechanismRuntimePolicy';
import { MECHANISM_BINDING_BLOCKER } from './pathTargets';

export const MECHANISM_SCENE_CONTRACT_VERSION = 1;

export type MechanismSceneLayer = {
    id: string;
    layerId: string;
    label: string;
    role: FabricationRenderLayer['role'];
    renderKind: FabricationRenderKind;
    partKey: string;
    color: string;
    stackIndex: number;
    stackItemIndex?: number;
    occurrence: number;
    stackOccurrenceId: string;
    z: number;
    centerMm: number;
    backFaceMm: number;
    frontFaceMm: number;
    physicalDepthMm: number;
    source: FabricationRenderLayer['source'];
    sourceNodeId?: string;
    sourceConstraintIds: string[];
    supportPathIds: string[];
    gearPlaneId?: string;
};

export type MechanismSceneConnectionSourceNode = {
    role: ConnectionSelectionRole;
    selectionSignature: string;
    sourceNodeId: string;
    partKey: string;
    layerId: string;
    stackOccurrenceId: string;
};

export type MechanismSceneContract = {
    version: typeof MECHANISM_SCENE_CONTRACT_VERSION;
    mechanismId: string;
    mechanismType: MechanismType;
    renderPlanSource: 'mechanismCompiler';
    compilerSource: 'mechanismCompiler';
    graphCompiler: MechanismGraphCompilerSummary;
    compilerSignature: string;
    physicalConnectionSignature: string;
    connectionSourceNodes: MechanismSceneConnectionSourceNode[];
    stackSource: 'mechanismCompiler';
    stackSummary: string;
    roleSummary: string;
    zSummary: string;
    ready: boolean;
    validationErrors: string[];
    renderPlanValidationErrors: string[];
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    generatedPathPointCount: number;
    boardCoordinate?: string;
    layers: MechanismSceneLayer[];
    supportPaths: CompiledSupportPath[];
    supportNodes: RetainedSupportNodeMm[];
    supportEdges: RetainedSupportEdgeMm[];
    pinSpans: PinSpanMm[];
    gearPlaneIds: string[];
    physicalDefinitions: readonly MechanismPhysicalPartDefinition[];
    physicalInstances: readonly MechanismPhysicalPartInstance[];
    physicalEnvelopeDescriptors: MechanismPhysicalEnvelopeDescriptor[];
    renderPlan: FabricationRenderPlan;
    runtimeMode?: 'bound' | 'static-recovery';
    runtimeBlocker?: string;
    projectDriveEnabled?: boolean;
    boundPhysicsEnabled?: boolean;
    recoveryCandidates?: MechanismRecoveryCandidates;
};

const sceneLayerForCompiledLayer = (layer: FabricationRenderLayer): MechanismSceneLayer => {
    return {
        id: layer.layerId,
        layerId: layer.layerId,
        label: layer.label,
        role: layer.role,
        renderKind: layer.renderKind,
        partKey: layer.partKey,
        color: layer.color,
        stackIndex: layer.stackIndex,
        ...(layer.stackItemIndex !== undefined ? { stackItemIndex: layer.stackItemIndex } : {}),
        occurrence: layer.occurrence,
        stackOccurrenceId: layer.stackOccurrenceId,
        z: layer.z,
        centerMm: layer.centerMm,
        backFaceMm: layer.backFaceMm,
        frontFaceMm: layer.frontFaceMm,
        physicalDepthMm: layer.physicalDepthMm,
        source: layer.source,
        ...(layer.sourceNodeId ? { sourceNodeId: layer.sourceNodeId } : {}),
        sourceConstraintIds: [...layer.sourceConstraintIds],
        supportPathIds: [...layer.supportPathIds],
        ...(layer.gearPlaneId ? { gearPlaneId: layer.gearPlaneId } : {})
    };
};

const connectionSourceNodesFor = (
    summary: MechanismGraphCompilerSummary,
    renderPlan: FabricationRenderPlan,
): MechanismSceneConnectionSourceNode[] => {
    const layers = [renderPlan.base, ...renderPlan.layers];
    return [...(summary.connectionSelectionSummary?.physicalConnections ?? [])]
        .map(connection => {
            const layer = layers
                .filter(item => item.sourceNodeId === connection.sourceNodeId && item.partKey === connection.partKey)
                .sort((left, right) => left.layerId.localeCompare(right.layerId))[0];
            return {
                role: connection.role,
                selectionSignature: connectionSelectionIdentity(connection.role, connection.selection),
                sourceNodeId: connection.sourceNodeId,
                partKey: connection.partKey,
                layerId: layer?.layerId ?? '',
                stackOccurrenceId: layer?.stackOccurrenceId ?? '',
            };
        })
        .sort((left, right) => left.role.localeCompare(right.role));
};

const compilerSignatureFor = (
    summary: MechanismGraphCompilerSummary,
    renderPlan: FabricationRenderPlan,
) => [
    `${summary.graphId}@${summary.irVersion}`,
    summary.connectionSelectionSummary?.physicalConnectionSignature ?? '',
    [renderPlan.base, ...renderPlan.layers]
        .map(layer => [
            layer.layerId,
            layer.sourceNodeId ?? '',
            layer.partKey,
            layer.backFaceMm,
            layer.frontFaceMm,
        ].join(':'))
        .join('|'),
].join('::');

/** Bounded compiler diagnostic. Runtime stages and exports must use the ProjectState builder below. */
const compileMechanismSceneContract = (
    mechanism: MechanismConfig,
    recipe?: FabricationRecipe,
    kit?: PhysicalKitSettings,
    angleRad = 0,
): MechanismSceneContract => {
    const physicalKit = kit ?? defaultPhysicalKit();
    const compiledMechanism = compileMechanism(mechanism, undefined, undefined, physicalKit);
    const renderPlan = compiledMechanism.fabrication.renderPlan;
    const validationErrors = [
        ...compiledMechanism.fabrication.validationErrors,
        ...compiledMechanism.readinessErrors,
        ...(recipe?.warnings ?? []),
        ...(mechanism.warnings ?? [])
    ].filter(Boolean);

    const graphCompiler = summarizeCompiledMechanism(compiledMechanism);
    const physicalConnectionSignature = graphCompiler.connectionSelectionSummary?.physicalConnectionSignature ?? '';
    const sceneContract = {
        version: MECHANISM_SCENE_CONTRACT_VERSION,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        renderPlanSource: 'mechanismCompiler',
        compilerSource: 'mechanismCompiler',
        graphCompiler,
        compilerSignature: compilerSignatureFor(graphCompiler, renderPlan),
        physicalConnectionSignature,
        connectionSourceNodes: connectionSourceNodesFor(graphCompiler, renderPlan),
        stackSource: 'mechanismCompiler',
        stackSummary: compiledMechanism.fabrication.stackSummary,
        roleSummary: renderPlan.roleSummary,
        zSummary: renderPlan.zSummary,
        ready: validationErrors.length === 0,
        validationErrors: [...new Set(validationErrors)],
        renderPlanValidationErrors: [...renderPlan.validationErrors],
        targetPartId: mechanism.targetPartId ?? recipe?.targetPartId,
        targetSceneObjectId: mechanism.targetSceneObjectId ?? recipe?.targetSceneObjectId,
        targetPathId: mechanism.targetPathId ?? recipe?.targetPathId,
        targetAnchorJointId: mechanism.targetAnchorJointId ?? recipe?.targetAnchorJointId,
        generatedPathPointCount: mechanism.generatedPath?.length ?? recipe?.targetPathPointCount ?? 0,
        boardCoordinate: recipe?.boardCoordinate ?? mechanism.fabricationMetadata?.boardCoordinate,
        layers: [renderPlan.base, ...renderPlan.layers].map(sceneLayerForCompiledLayer),
        supportPaths: renderPlan.supportPaths.map(path => ({
            ...path,
            sourceIds: [...path.sourceIds],
            orderedLayerIds: [...path.orderedLayerIds],
            ownerExpansions: path.ownerExpansions.map(expansion => ({ ...expansion })),
            edgeIds: [...path.edgeIds]
        })),
        supportNodes: renderPlan.supportNodes.map(node => ({ ...node })),
        supportEdges: renderPlan.supportEdges.map(edge => ({ ...edge })),
        pinSpans: renderPlan.pinSpans.map(span => ({ ...span, supportNodeIds: [...span.supportNodeIds] })),
        gearPlaneIds: [...new Set(renderPlan.layers.flatMap(layer => layer.gearPlaneId ? [layer.gearPlaneId] : []))].sort()
    } as Omit<MechanismSceneContract, 'physicalDefinitions' | 'physicalInstances' | 'physicalEnvelopeDescriptors' | 'renderPlan'>;

    let physicalParts: ReturnType<typeof compilePhysicalInstancesFromPlan> | undefined;
    const getPhysicalParts = () => physicalParts ??= compilePhysicalInstancesFromPlan(mechanism, compiledMechanism.graph, renderPlan, angleRad, physicalKit);
    Object.defineProperties(sceneContract, {
        renderPlan: { value: renderPlan, enumerable: false },
        physicalDefinitions: { get: () => getPhysicalParts().definitions, enumerable: false },
        physicalInstances: { get: () => getPhysicalParts().instances, enumerable: false }
    });

    let physicalEnvelopeDescriptors: MechanismPhysicalEnvelopeDescriptor[] | undefined;
    Object.defineProperty(sceneContract, 'physicalEnvelopeDescriptors', {
        get: () => physicalEnvelopeDescriptors ??= buildMechanismPhysicalEnvelopeDescriptors(mechanism, undefined, renderPlan, physicalKit),
        enumerable: false
    });

    return sceneContract as MechanismSceneContract;
};

/** Compatibility diagnostic only. Runtime, stage, and export callers require ProjectState. */
export const buildLowLevelMechanismSceneContract = (
    mechanism: MechanismConfig,
    recipe?: FabricationRecipe,
    kit?: PhysicalKitSettings,
    angleRad = 0,
): MechanismSceneContract => Object.assign(
    compileMechanismSceneContract(mechanism, recipe, kit, angleRad),
    {
        ready: false,
        runtimeMode: 'static-recovery' as const,
        runtimeBlocker: 'Project context required',
        projectDriveEnabled: false,
        boundPhysicsEnabled: false,
    },
);

export const buildProjectMechanismSceneContract = (
    project: ProjectState,
    mechanismId: string,
    recipe?: FabricationRecipe,
    angleRad = 0,
): MechanismSceneContract | undefined => {
    const mechanism = project.mechanisms.find((item) => item.id === mechanismId);
    if (!mechanism) return undefined;
    const gate = resolveMechanismRuntimeGate(project, mechanism);
    if (!gate.canProjectScene) return undefined;
    const contract = compileMechanismSceneContract(
        mechanism,
        recipe,
        project.settings.physicalKit,
        gate.canDriveProject ? angleRad : 0,
    );
    if (gate.canDriveProject) {
        return Object.assign(contract, {
            runtimeMode: 'bound',
            projectDriveEnabled: true,
            boundPhysicsEnabled: true,
            recoveryCandidates: gate.recoveryCandidates,
        } satisfies Partial<MechanismSceneContract>);
    }
    return Object.assign(contract, {
        ready: false,
        validationErrors: [...new Set([...contract.validationErrors, gate.blocker ?? MECHANISM_BINDING_BLOCKER])],
        targetPartId: undefined,
        targetSceneObjectId: undefined,
        targetPathId: undefined,
        targetAnchorJointId: undefined,
        generatedPathPointCount: 0,
        runtimeMode: 'static-recovery',
        runtimeBlocker: gate.blocker,
        projectDriveEnabled: false,
        boundPhysicsEnabled: false,
        recoveryCandidates: gate.recoveryCandidates,
    } satisfies Partial<MechanismSceneContract>);
};

export const buildMechanismSceneContracts = (
    project: ProjectState,
    recipes: FabricationRecipe[] = []
) => {
    const recipeByMechanismId = new Map(recipes.map(recipe => [recipe.mechanismId, recipe]));
    return project.mechanisms
        .filter(mechanism => mechanism.visible && mechanism.enabled !== false)
        .flatMap(mechanism => {
            const contract = buildProjectMechanismSceneContract(
                project,
                mechanism.id,
                recipeByMechanismId.get(mechanism.id),
            );
            return contract ? [contract] : [];
        });
};

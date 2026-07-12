import type { FabricationRecipe, MechanismConfig, MechanismType, PhysicalKitSettings, ProjectState } from '../types';
import { compileMechanism, summarizeCompiledMechanism, type MechanismGraphCompilerSummary } from './mechanismCompiler';
import type {
    CompiledSupportPath,
    FabricationRenderKind,
    FabricationRenderLayer,
    PinSpanMm,
    RetainedSupportEdgeMm,
    RetainedSupportNodeMm
} from './mechanismFabricationZStack';

export const MECHANISM_SCENE_CONTRACT_VERSION = 1;

export type MechanismSceneLayer = {
    id: string;
    layerId: string;
    label: string;
    role: FabricationRenderLayer['role'];
    renderKind: FabricationRenderKind;
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

export type MechanismSceneContract = {
    version: typeof MECHANISM_SCENE_CONTRACT_VERSION;
    mechanismId: string;
    mechanismType: MechanismType;
    renderPlanSource: 'mechanismCompiler';
    compilerSource: 'mechanismCompiler';
    graphCompiler: MechanismGraphCompilerSummary;
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
};

const sceneLayerForCompiledLayer = (layer: FabricationRenderLayer): MechanismSceneLayer => ({
    id: layer.layerId,
    layerId: layer.layerId,
    label: layer.label,
    role: layer.role,
    renderKind: layer.renderKind,
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
});

export const buildMechanismSceneContract = (
    mechanism: MechanismConfig,
    recipe?: FabricationRecipe,
    kit?: PhysicalKitSettings,
): MechanismSceneContract => {
    const compiledMechanism = compileMechanism(mechanism, undefined, undefined, kit);
    const renderPlan = compiledMechanism.fabrication.renderPlan;
    const validationErrors = [
        ...compiledMechanism.fabrication.validationErrors,
        ...compiledMechanism.readinessErrors,
        ...(recipe?.warnings ?? []),
        ...(mechanism.warnings ?? [])
    ].filter(Boolean);

    return {
        version: MECHANISM_SCENE_CONTRACT_VERSION,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        renderPlanSource: 'mechanismCompiler',
        compilerSource: 'mechanismCompiler',
        graphCompiler: summarizeCompiledMechanism(compiledMechanism),
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
    };
};

export const buildMechanismSceneContracts = (
    project: Pick<ProjectState, 'mechanisms' | 'settings'>,
    recipes: FabricationRecipe[] = []
) => {
    const recipeByMechanismId = new Map(recipes.map(recipe => [recipe.mechanismId, recipe]));
    return project.mechanisms
        .filter(mechanism => mechanism.visible && mechanism.enabled !== false)
        .map(mechanism => buildMechanismSceneContract(mechanism, recipeByMechanismId.get(mechanism.id), project.settings.physicalKit));
};

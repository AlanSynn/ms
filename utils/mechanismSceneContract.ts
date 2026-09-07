import type { FabricationRecipe, MechanismConfig, MechanismType } from '../types';
import { fabricationRenderPlanForMechanism, type FabricationRenderKind } from './fabricationRenderPlan';
import { readableFabricationStackSummary } from './fabricationStackModel';
import { validateMechanismPreviewReadiness } from './fabricationValidation';

export const MECHANISM_SCENE_CONTRACT_VERSION = 1;

export type MechanismSceneLayer = {
    id: string;
    label: string;
    role: string;
    renderKind: FabricationRenderKind;
    color: string;
    stackIndex: number;
    z: number;
    source: 'fabrication-stack';
};

export type MechanismSceneContract = {
    version: typeof MECHANISM_SCENE_CONTRACT_VERSION;
    mechanismId: string;
    mechanismType: MechanismType;
    renderPlanSource: 'fabricationRenderPlanForMechanism';
    stackSource: 'fabricationStackForMechanism';
    stackSummary: string;
    roleSummary: string;
    zSummary: string;
    ready: boolean;
    validationErrors: string[];
    targetPartId?: string;
    targetSceneObjectId?: string;
    targetPathId?: string;
    targetAnchorJointId?: string;
    generatedPathPointCount: number;
    boardCoordinate?: string;
    layers: MechanismSceneLayer[];
};

export const buildMechanismSceneContract = (
    mechanism: MechanismConfig,
    recipe?: FabricationRecipe,
): MechanismSceneContract => {
    const renderPlan = fabricationRenderPlanForMechanism(mechanism);
    const validationErrors = [
        ...renderPlan.validationErrors,
        ...validateMechanismPreviewReadiness(mechanism),
        ...(recipe?.warnings ?? []),
        ...(mechanism.warnings ?? [])
    ].filter(Boolean);
    const layers = [renderPlan.base, ...renderPlan.layers].map((layer): MechanismSceneLayer => ({
        id: `${mechanism.id}:${layer.role}:${layer.stackIndex}:${layer.occurrence}`,
        label: layer.label,
        role: layer.role,
        renderKind: layer.renderKind,
        color: layer.color,
        stackIndex: layer.stackIndex,
        z: layer.z,
        source: layer.source
    }));

    return {
        version: MECHANISM_SCENE_CONTRACT_VERSION,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        renderPlanSource: 'fabricationRenderPlanForMechanism',
        stackSource: 'fabricationStackForMechanism',
        stackSummary: renderPlan.stackSummary || readableFabricationStackSummary(mechanism),
        roleSummary: renderPlan.roleSummary,
        zSummary: renderPlan.zSummary,
        ready: validationErrors.length === 0,
        validationErrors: [...new Set(validationErrors)],
        targetPartId: mechanism.targetPartId ?? recipe?.targetPartId,
        targetSceneObjectId: mechanism.targetSceneObjectId ?? recipe?.targetSceneObjectId,
        targetPathId: mechanism.targetPathId ?? recipe?.targetPathId,
        targetAnchorJointId: mechanism.targetAnchorJointId ?? recipe?.targetAnchorJointId,
        generatedPathPointCount: mechanism.generatedPath?.length ?? recipe?.targetPathPointCount ?? 0,
        boardCoordinate: recipe?.boardCoordinate ?? mechanism.fabricationMetadata?.boardCoordinate,
        layers
    };
};

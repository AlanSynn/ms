import type { FabricationRecipe, FabricationRecipeType, MechanismType } from '../types';
import { fabricationBoardCoordinateCallout, fabricationPartDisplayLabel } from './fabricationContract';
import { referenceRecipeForType, referenceStepCoordinateCallout } from './mechanismReference';

export const recipeBoardCallout = (recipe: Pick<FabricationRecipe, 'boardCoordinate' | 'board'>) =>
    fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);

export const recipeTargetCallout = (recipe: Pick<FabricationRecipe, 'targetPartName' | 'targetPartId' | 'targetSceneObjectName' | 'targetSceneObjectId' | 'targetPathId' | 'targetAnchorJointId'>) => [
    recipe.targetPartName || recipe.targetPartId || recipe.targetSceneObjectName || recipe.targetSceneObjectId,
    recipe.targetPathId,
    recipe.targetAnchorJointId
].filter(Boolean).join(' · ');

const titleizeGraphFamily = (familyId: string | undefined) =>
    (familyId ?? 'graph mechanism')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());

export const mechanismTypeLabel = (type: FabricationRecipeType, graphFamilyId?: string) =>
    type === 'graph'
        ? titleizeGraphFamily(graphFamilyId)
        : referenceRecipeForType(type).title || type.replace(/[-_]/g, ' ');

export const fabricationRecipeTitle = (recipe: FabricationRecipe) =>
    mechanismTypeLabel(recipe.type, recipe.graphFamilyId);

const LEGACY_RECIPE_TYPES = new Set<MechanismType>([
    'crank',
    '4bar',
    'piston',
    'yoke',
    'quick-return',
    '5bar',
    '6bar',
    'cam',
    'rack-pinion',
    'gear',
    'gear_linkage',
    'planetary_gear'
]);

export const fabricationRecipeSensemakingType = (recipe: FabricationRecipe): MechanismType | undefined => {
    const directType = recipe.type as MechanismType;
    if (LEGACY_RECIPE_TYPES.has(directType)) return directType;
    const graphType = recipe.graphFamilyId as MechanismType | undefined;
    return graphType && LEGACY_RECIPE_TYPES.has(graphType) ? graphType : undefined;
};

export const fabricationRecipeClassroomCue = (recipe: FabricationRecipe) =>
    recipe.assemblySteps.find(step => step.check)?.check
        ?? recipe.steps.find(step => !step.startsWith('Parts:') && !step.startsWith('Stack:'))
        ?? `${fabricationRecipeTitle(recipe)} module`;

export const fabricationRecipeStackSummary = (recipe: FabricationRecipe) => {
    const labels = recipe.assemblySteps
        .flatMap(step => step.stack ?? [])
        .filter(item => ['moving-part', 'spacer', 'clip'].includes(item.role))
        .map(item => fabricationPartDisplayLabel(item.label));
    const uniqueLabels = [...new Set(labels)];
    return uniqueLabels.length
        ? uniqueLabels.join(' → ')
        : recipe.requiredParts.map(part => fabricationPartDisplayLabel(part.name)).join(' → ');
};

export const readableStepCoordinateCallout = (step: FabricationRecipe['assemblySteps'][number]) =>
    referenceStepCoordinateCallout(step).replace(/\b([A-Z]+[1-9]\d*)\b/g, coord => fabricationBoardCoordinateCallout(coord));

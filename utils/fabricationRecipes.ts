import type { FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { boardToScene, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { fabricationBoardCoordinateCallout, fabricationPartDisplayLabel } from './fabricationContract';
import { fabricationRenderPlanForMechanism } from './fabricationRenderPlan';
import { readableFabricationStackSummary } from './fabricationStackModel';
import { gearTrainOutputRatio, planetaryCarrierOutputRatio } from './kinematics';
import { referenceRecipeForType, referenceRequiredPartsForMechanism, referenceStepCoordinateCallout } from './mechanismReference';
import { preferredMotionJointId } from './motion';
import { sampleFeasibleRange } from './fabricationReadiness';

export const recipeBoardCallout = (recipe: Pick<FabricationRecipe, 'boardCoordinate' | 'board'>) =>
    fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);

export const recipeTargetCallout = (recipe: Pick<FabricationRecipe, 'targetPartName' | 'targetPartId' | 'targetPathId' | 'targetAnchorJointId'>) => [
    recipe.targetPartName || recipe.targetPartId,
    recipe.targetPathId,
    recipe.targetAnchorJointId
].filter(Boolean).join(' · ');

export const mechanismTypeLabel = (type: MechanismConfig['type']) =>
    referenceRecipeForType(type).title || type.replace(/[-_]/g, ' ');

export const readableStepCoordinateCallout = (step: FabricationRecipe['assemblySteps'][number]) =>
    referenceStepCoordinateCallout(step).replace(/\b([A-O](?:[1-9]|1[0-5]))\b/g, coord => fabricationBoardCoordinateCallout(coord));

export const prefabAssemblySteps = (mechanism: MechanismConfig, boardCoordinate: string): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType(mechanism.type);
    if (recipe.exportReady && recipe.assemblySteps.length) {
        return recipe.assemblySteps.map(step => ({
            ...step,
            boardCoordinate: step.boardCoordinate || boardCoordinate,
            zMm: step.zMm ?? 0
        }));
    }
    const plan = fabricationRenderPlanForMechanism(mechanism);
    const moduleLabel = `${mechanismTypeLabel(mechanism.type)} prebuilt module`;
    return [
        {
            index: 1,
            label: moduleLabel,
            role: 'prefab-module',
            boardCoordinate,
            zMm: 0,
            coords: [boardCoordinate],
            coordRoles: ['board'],
            action: 'snap-module',
            instruction: `Mount ${mechanismTypeLabel(mechanism.type)} at ${boardCoordinate}.`
        },
        ...plan.layers.map((layer, index) => ({
            index: index + 2,
            label: fabricationPartDisplayLabel(layer.label),
            role: layer.role,
            boardCoordinate,
            zMm: Number((layer.z * 10).toFixed(1)),
            coords: [boardCoordinate],
            coordRoles: ['stack'],
            action: 'stack-layer',
            instruction: layer.role === 'clip'
                ? `Lock ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
                : layer.role === 'spacer'
                    ? `Insert ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
                    : `Place ${fabricationPartDisplayLabel(layer.label)} at ${boardCoordinate}.`
        }))
    ];
};

export const createFabricationRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
    if (!Number.isFinite(mechanism.anchorX) || !Number.isFinite(mechanism.anchorY)) throw new Error(`${mechanism.id}: missing board coordinate anchor.`);
    const board = sceneToBoardRaw({ x: mechanism.anchorX!, y: mechanism.anchorY! }, project.settings.physicalKit);
    const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : { x: mechanism.anchorX!, y: mechanism.anchorY! };
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId);
    const range = sampleFeasibleRange(mechanism);
    const assemblySteps = prefabAssemblySteps(mechanism, board.label);
    const warnings = [...new Set([
        ...(mechanism.warnings ?? []),
        ...((mechanism.fabricationMetadata as { warnings?: string[] } | undefined)?.warnings ?? []),
        ...(range.warning ? [range.warning] : []),
        ...((targetPart && !targetPart.visible) ? ['Target part hidden'] : [])
    ])];
    return {
        mechanismId: mechanism.id,
        type: mechanism.type,
        targetPartId: mechanism.targetPartId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId,
        targetPartName: targetPart?.name,
        targetPathPointCount: targetPath?.points.length,
        boardCoordinate: board.label,
        board,
        sceneAnchor: { x: mechanism.anchorX!, y: mechanism.anchorY! },
        offsetFromBoardMm: { x: (mechanism.anchorX! - boardScene.x) / SCENE_PX_PER_MM, y: (mechanism.anchorY! - boardScene.y) / SCENE_PX_PER_MM },
        requiredParts: mechanism.fabricationMetadata?.requiredParts ?? referenceRequiredPartsForMechanism(mechanism),
        steps: [
            `Place ${mechanism.id} main axle at ${fabricationBoardCoordinateCallout(board.label, board)}.`,
            `Kit: ${mechanismTypeLabel(mechanism.type)} module · ${project.settings.physicalKit.boardCells}×${project.settings.physicalKit.boardCells}.`,
            `Stack: ${readableFabricationStackSummary(mechanism)}.`,
            mechanism.type === 'cam'
                ? `Cam + follower · ${mechanism.groundAngle ?? 90}° · lift ${(mechanism.rockerLength || mechanism.crankLength).toFixed(0)}.`
                : mechanism.type === 'rack-pinion'
                    ? `Pinion + rack · offset ${mechanism.sliderOffset.toFixed(0)} · stops.`
                    : mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear'
                        ? `Gears: ratio ${mechanism.type === 'planetary_gear' ? planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength).toFixed(2) : gearTrainOutputRatio(mechanism).toFixed(2)}.`
                        : `${mechanismTypeLabel(mechanism.type)}: crank ${mechanism.crankLength.toFixed(0)} · coupler ${mechanism.couplerLength.toFixed(0)}.`,
            targetPart ? `Output: ${targetPart.name} · ${targetPath?.id ?? 'no path'}.` : 'Output: standalone.',
            warnings.length ? `Fix: ${warnings.join('; ')}` : 'Ready.'
        ],
        assemblySteps,
        warnings
    };
};

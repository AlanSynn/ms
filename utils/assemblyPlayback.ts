import type { FabricationRecipe, MechanismConfig, PhysicalKitSettings, ProjectState } from '../types';
import { boardToScene, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { fabricationStackSummary, prefabAssemblySteps, sampleFeasibleRange } from './fabrication';
import { preferredMotionJointId } from './motion';
import { mechanismRequiredParts } from './project';

export type AssemblyLane = 'kit' | 'custom';
export type AssemblyMotionKind = 'parts-tray' | 'stack-layer' | 'move-to-board' | 'connect-character' | 'test-motion';

export type AssemblyPlaybackStep = {
    index: number;
    label: string;
    phase: 'prepare-parts' | 'assemble-module' | 'mount-to-board' | 'connect-character' | 'test-motion' | 'export';
    motion: AssemblyMotionKind;
    action: string;
    coords: string[];
    coordRoles: string[];
    zMm: number;
    instruction: string;
    check?: string;
    stack: NonNullable<FabricationRecipe['assemblySteps'][number]['stack']>;
};

export const pendingRecipeForMechanism = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
    const board = sceneToBoardRaw({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, project.settings.physicalKit);
    const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId);
    const range = sampleFeasibleRange(mechanism);
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
        sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
        offsetFromBoardMm: { x: ((mechanism.anchorX ?? 0) - boardScene.x) / SCENE_PX_PER_MM, y: ((mechanism.anchorY ?? 0) - boardScene.y) / SCENE_PX_PER_MM },
        requiredParts: mechanismRequiredParts(mechanism),
        steps: [`Stack: ${fabricationStackSummary(mechanism)}`, 'Cut sheet + assembly.'],
        assemblySteps: prefabAssemblySteps(mechanism, board.label),
        warnings: [...(mechanism.warnings ?? []), ...(range.warning ? [range.warning] : [])]
    };
};

export const assemblyLaneForExportMode = (mode: PhysicalKitSettings['exportMode']): AssemblyLane => mode === 'custom-parts' ? 'custom' : 'kit';

export const uniqueAssemblyCoords = (recipe: FabricationRecipe, role = 'board') => [...new Set(recipe.assemblySteps.flatMap(step =>
    ((step.coords?.length ? step.coords : [step.boardCoordinate])).filter((_, index) => (step.coordRoles?.[index] ?? step.role) === role)
))];

export const buildAssemblyPlaybackSteps = (recipe: FabricationRecipe, lane: AssemblyLane): AssemblyPlaybackStep[] => {
    const boardCoords = uniqueAssemblyCoords(recipe);
    const steps: AssemblyPlaybackStep[] = [
        {
            index: 1,
            label: lane === 'custom' ? 'Export parts' : 'Gather kit parts',
            phase: lane === 'custom' ? 'export' : 'prepare-parts',
            motion: 'parts-tray',
            action: lane === 'custom' ? 'export' : 'show-parts',
            coords: [],
            coordRoles: [],
            zMm: 0,
            instruction: lane === 'custom' ? 'Use SVG, PDF, or STL from Blueprint, then assemble the same stack.' : 'Collect the mechanism parts before touching the board.',
            check: lane === 'custom' ? 'Printed/cut parts match the recipe.' : 'All parts and S10 spacers are ready.',
            stack: []
        },
        ...recipe.assemblySteps.map((step, index) => ({
            index: index + 2,
            label: step.label,
            phase: 'assemble-module' as const,
            motion: 'stack-layer' as const,
            action: step.action ?? 'stack',
            coords: step.coords?.length ? step.coords : [step.boardCoordinate],
            coordRoles: step.coordRoles?.length ? step.coordRoles : [step.role],
            zMm: step.zMm,
            instruction: step.instruction,
            check: step.check,
            stack: step.stack ?? []
        }))
    ];
    steps.push({
        index: steps.length + 1,
        label: lane === 'kit' ? 'Mount module to board' : 'Mount custom module',
        phase: 'mount-to-board',
        motion: 'move-to-board',
        action: 'mount',
        coords: boardCoords.length ? boardCoords : [recipe.boardCoordinate],
        coordRoles: boardCoords.length ? boardCoords.map(() => lane === 'kit' ? 'board' : 'custom-base') : [lane === 'kit' ? 'board' : 'custom-base'],
        zMm: 0,
        instruction: lane === 'kit'
            ? `Snap the completed mechanism module onto the 15×15 board at ${recipe.boardCoordinate}.`
            : 'Place the completed module on the custom base or keep it standalone.',
        check: lane === 'kit' ? 'The module sits on the called-out board holes.' : 'The custom base and module holes line up.',
        stack: []
    }, {
        index: steps.length + 2,
        label: 'Connect character',
        phase: 'connect-character',
        motion: 'connect-character',
        action: 'connect',
        coords: [recipe.boardCoordinate],
        coordRoles: ['output'],
        zMm: 0,
        instruction: `Connect output to ${recipe.targetPartName ?? recipe.targetPartId ?? 'the target part'}.`,
        check: recipe.targetPathId ? `Output follows ${recipe.targetPathId}.` : 'Output moves freely.',
        stack: []
    }, {
        index: steps.length + 3,
        label: 'Test motion',
        phase: 'test-motion',
        motion: 'test-motion',
        action: 'test',
        coords: [recipe.boardCoordinate],
        coordRoles: ['motion'],
        zMm: 0,
        instruction: 'Scrub the mechanism once before cutting extra copies.',
        check: recipe.warnings[0] ?? 'Motion runs without binding.',
        stack: []
    });
    return steps;
};

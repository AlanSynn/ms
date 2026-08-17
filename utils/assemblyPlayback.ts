import type { BodyPartLayer, FabricationRecipe, MechanismConfig, PhysicalKitSettings, Point, ProjectState } from '../types';
import { bodyPartPivotScene, sceneToBoardRaw } from './coordinates';
import { fabricationBoardCoordinateCallout, fabricationPartDisplayLabel } from './fabrication';
import { createFabricationRecipe } from './fabricationRecipes';
import { isBoardFixedCoordRole } from './mechanismReference';
import { fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints } from './partGeometry';

export type AssemblyLane = 'kit' | 'custom';
export type AssemblyMotionKind = 'none' | 'explode_z' | 'mount_travel_xy' | 'connect_travel_xy' | 'scrub_time';

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

export type CharacterAssemblyPinRole = 'fixed_pin' | 'free_pivot' | 'moving_pin';

export type CharacterAssemblyPin = {
    id: string;
    jointId: string;
    label: string;
    role: CharacterAssemblyPinRole;
    scene: Point;
    boardCoordinate?: string;
    board?: ReturnType<typeof sceneToBoardRaw>;
    partIds: string[];
    partNames: string[];
    stack: string[];
};

export type CharacterAssemblyPartVisual = {
    id: string;
    name: string;
    fillColor: string;
    outline: Point[];
    pivot: Point;
};

export type CharacterAssemblyStep = {
    index: number;
    label: string;
    phase: 'character-parts' | 'fixed-pins' | 'free-pivots' | 'attach-character' | 'test-character';
    action: string;
    pinIds: string[];
    instruction: string;
    check?: string;
};

export type CharacterAssemblyPlan = {
    kind: 'character';
    parts: CharacterAssemblyPartVisual[];
    fixedPins: CharacterAssemblyPin[];
    freePivots: CharacterAssemblyPin[];
    steps: CharacterAssemblyStep[];
    mechanismAssemblySteps: [];
    boardCells: number;
};

const transformPartLocalPoint = (part: BodyPartLayer, point: Point): Point => {
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = part.transform.scale || 1;
    const x = point.x * scale;
    const y = point.y * scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

const titleCaseJointLabel = (jointId: string) => jointId.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export const buildCharacterAssemblyPlan = (project: ProjectState): CharacterAssemblyPlan => {
    const skeleton = project.skeleton;
    if (!skeleton) {
        return {
            kind: 'character',
            parts: [],
            fixedPins: [],
            freePivots: [],
            steps: [],
            mechanismAssemblySteps: [],
            boardCells: project.settings.physicalKit.boardCells
        };
    }
    const visibleParts = project.partOrder
        .map(id => project.parts[id])
        .filter((part): part is BodyPartLayer => Boolean(part) && part.visible !== false);
    const jointToParts = new Map<string, BodyPartLayer[]>();
    for (const part of visibleParts) {
        const ids = new Set([part.anchorJointId, ...partLandmarkJointIds(part, skeleton)]);
        for (const jointId of ids) {
            if (!skeleton.joints[jointId]) continue;
            const list = jointToParts.get(jointId) ?? [];
            list.push(part);
            jointToParts.set(jointId, list);
        }
    }
    const anchorJointIds = [...new Set(visibleParts.map(part => part.anchorJointId).filter(jointId => Boolean(skeleton.joints[jointId])))];
    const fixedJointIds = [...new Set([
        ...anchorJointIds.filter(jointId => skeleton.joints[jointId]?.locked),
        'hip',
        'torso',
        ...skeleton.rootJointIds,
        anchorJointIds[0]
    ].filter((jointId): jointId is string => Boolean(jointId && skeleton.joints[jointId])))]
        .slice(0, Math.min(2, Math.max(1, anchorJointIds.length)));
    const fixedSet = new Set(fixedJointIds);
    const createPin = (jointId: string, role: CharacterAssemblyPinRole): CharacterAssemblyPin => {
        const joint = skeleton.joints[jointId];
        const parts = jointToParts.get(jointId) ?? visibleParts.filter(part => part.anchorJointId === jointId);
        const board = role === 'fixed_pin' ? sceneToBoardRaw(joint.position, project.settings.physicalKit) : undefined;
        return {
            id: `${role}-${jointId}`,
            jointId,
            label: joint.name || titleCaseJointLabel(jointId),
            role,
            scene: joint.position,
            boardCoordinate: board?.valid ? board.label : undefined,
            board,
            partIds: [...new Set(parts.map(part => part.id))],
            partNames: [...new Set(parts.map(part => part.name))],
            stack: role === 'fixed_pin'
                ? ['board', 'paper fastener', 'spacer', 'character part', 'retaining clip']
                : ['character part', 'free washer', 'retaining clip']
        };
    };
    const fixedPins = fixedJointIds.map(jointId => createPin(jointId, 'fixed_pin'));
    const freePivots = anchorJointIds
        .filter(jointId => !fixedSet.has(jointId))
        .map(jointId => createPin(jointId, 'free_pivot'));
    const parts = visibleParts.map(part => {
        const localJoints = partLandmarkLocalPoints(part, skeleton);
        const outline = fabricablePartOutlinePoints(part, localJoints).map(point => transformPartLocalPoint(part, point));
        return {
            id: part.id,
            name: part.name,
            fillColor: part.fillColor ?? '#cbd5e1',
            outline,
            pivot: bodyPartPivotScene(part, skeleton)
        };
    }).filter(part => part.outline.length >= 3);
    const steps: CharacterAssemblyStep[] = parts.length ? [
        { index: 1, label: 'Parts', phase: 'character-parts', action: 'layout-parts', pinIds: [], instruction: 'Lay out character parts.', check: `${parts.length} parts.` },
        { index: 2, label: 'Fixed pins', phase: 'fixed-pins', action: 'pin-to-board', pinIds: fixedPins.map(pin => pin.id), instruction: 'Pin fixed joints to the board.', check: `${fixedPins.length} fixed.` },
        { index: 3, label: 'Free pivots', phase: 'free-pivots', action: 'leave-free', pinIds: freePivots.map(pin => pin.id), instruction: 'Keep limb pivots free.', check: `${freePivots.length} free.` },
        { index: 4, label: 'Attach character', phase: 'attach-character', action: 'stack-character', pinIds: [...fixedPins, ...freePivots].map(pin => pin.id), instruction: 'Stack spacer, part, clip.', check: 'No blocked pivots.' },
        { index: 5, label: 'Test character', phase: 'test-character', action: 'test-motion', pinIds: [...fixedPins, ...freePivots].map(pin => pin.id), instruction: 'Scrub once.', check: 'Fixed pins stay put.' }
    ] : [];
    return { kind: 'character', parts, fixedPins, freePivots, steps, mechanismAssemblySteps: [], boardCells: project.settings.physicalKit.boardCells };
};

export const pendingRecipeForMechanism = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe =>
    createFabricationRecipe(project, mechanism);

export const assemblyLaneForExportMode = (mode: PhysicalKitSettings['exportMode']): AssemblyLane => mode === 'custom-parts' ? 'custom' : 'kit';

export const uniqueAssemblyCoords = (recipe: FabricationRecipe, role = 'board') => [...new Set(recipe.assemblySteps.flatMap(step =>
    ((step.coords?.length ? step.coords : [step.boardCoordinate])).filter((_, index) => {
        const coordRole = step.coordRoles?.[index] ?? step.role;
        return role === 'board' ? isBoardFixedCoordRole(coordRole) : coordRole === role;
    })
))];

export const buildAssemblyPlaybackSteps = (recipe: FabricationRecipe, lane: AssemblyLane): AssemblyPlaybackStep[] => {
    const boardCoords = uniqueAssemblyCoords(recipe);
    const steps: AssemblyPlaybackStep[] = [
        {
            index: 1,
            label: lane === 'custom' ? 'Export parts' : 'Gather kit parts',
            phase: lane === 'custom' ? 'export' : 'prepare-parts',
            motion: 'none',
            action: lane === 'custom' ? 'export' : 'show-parts',
            coords: [],
            coordRoles: [],
            zMm: 0,
            instruction: lane === 'custom' ? 'Export files.' : 'Gather parts.',
            check: lane === 'custom' ? 'Parts match recipe.' : 'Parts ready.',
            stack: []
        },
        ...recipe.assemblySteps.map((step, index) => ({
            index: index + 2,
            label: fabricationPartDisplayLabel(step.label),
            phase: 'assemble-module' as const,
            motion: 'explode_z' as const,
            action: step.action ?? 'stack',
            coords: step.coords?.length ? step.coords : [step.boardCoordinate],
            coordRoles: step.coordRoles?.length ? step.coordRoles : [step.role],
            zMm: step.zMm,
            instruction: fabricationPartDisplayLabel(step.instruction),
            check: step.check ? fabricationPartDisplayLabel(step.check) : step.check,
            stack: step.stack ?? []
        }))
    ];
    steps.push({
        index: steps.length + 1,
        label: lane === 'kit' ? 'Mount module to board' : 'Mount custom module',
        phase: 'mount-to-board',
        motion: 'mount_travel_xy',
        action: 'mount',
        coords: boardCoords.length ? boardCoords : [recipe.boardCoordinate],
        coordRoles: boardCoords.length ? boardCoords.map(() => lane === 'kit' ? 'board' : 'custom-base') : [lane === 'kit' ? 'board' : 'custom-base'],
        zMm: 0,
        instruction: lane === 'kit'
            ? `Mount at ${fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}.`
            : 'Place module.',
        check: lane === 'kit' ? 'Module seated.' : 'Holes line up.',
        stack: []
    }, {
        index: steps.length + 2,
        label: 'Connect character',
        phase: 'connect-character',
        motion: 'connect_travel_xy',
        action: 'connect',
        coords: [recipe.boardCoordinate],
        coordRoles: ['output'],
        zMm: 0,
        instruction: `Connect output.`,
        check: recipe.targetPathId ? `Path follows.` : 'Output moves.',
        stack: []
    }, {
        index: steps.length + 3,
        label: 'Test motion',
        phase: 'test-motion',
        motion: 'scrub_time',
        action: 'test',
        coords: [recipe.boardCoordinate],
        coordRoles: ['motion'],
        zMm: 0,
        instruction: 'Scrub once.',
        check: recipe.warnings[0] ?? 'Motion OK.',
        stack: []
    });
    return steps;
};

import type { FabricationRecipe, PhysicalKitSettings } from '../types';
import { fabricationBoardCoordinateCallout, fabricationPartDisplayLabel } from './fabricationContract';
import { isBoardFixedCoordRole } from './mechanismReference';
import type { BuildPlanLaneV1, BuildPlanPartV1, BuildPlanStackItemV1, BuildPlanStepV1 } from './buildPlanTypes';

export const buildPlanLaneForExportMode = (mode: PhysicalKitSettings['exportMode']): BuildPlanLaneV1 =>
    mode === 'custom-parts' ? 'custom' : 'kit';

const uniqueRecipeCoords = (recipe: FabricationRecipe, role = 'board') => [...new Set(
    recipe.assemblySteps.flatMap(step =>
        (step.coords?.length ? step.coords : [step.boardCoordinate]).filter((_, index) => {
            const coordRole = step.coordRoles?.[index] ?? step.role;
            return role === 'board' ? isBoardFixedCoordRole(coordRole) : coordRole === role;
        })
    )
)];

const normalizedPartName = (value: string) => fabricationPartDisplayLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const referencedPart = (value: string, parts: BuildPlanPartV1[]) => {
    const normalized = normalizedPartName(value);
    return parts.find(part => {
        const candidate = normalizedPartName(part.name);
        return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
    });
};

export const buildMechanismBuildStepsV1 = (
    recipe: FabricationRecipe,
    lane: BuildPlanLaneV1,
    mechanismRef: string,
    parts: BuildPlanPartV1[]
): BuildPlanStepV1[] => {
    const sectionId = mechanismRef;
    const boardCoords = uniqueRecipeCoords(recipe);
    const stepId = (index: number, action: string) =>
        `${mechanismRef}:step:${index}:${encodeURIComponent(action)}`;
    const recipeSteps: BuildPlanStepV1[] = recipe.assemblySteps.map((step, sourceIndex) => {
        const index = sourceIndex + 2;
        const action = step.action ?? 'stack';
        const stack: BuildPlanStackItemV1[] = (step.stack ?? []).map((item, stackIndex) => {
            const part = referencedPart(item.part ?? item.label, parts);
            return {
                ...item,
                ref: `${stepId(index, action)}:stack:${item.order}:${stackIndex + 1}`,
                partRef: part?.ref
            };
        });
        return {
            id: stepId(index, action),
            order: index,
            index,
            sectionId,
            scope: 'mechanism',
            mechanismId: recipe.mechanismId,
            mechanismRef,
            sourceStepIndex: step.index,
            label: fabricationPartDisplayLabel(step.label),
            phase: 'assemble-module',
            motion: 'explode_z',
            action,
            coords: [...(step.coords?.length ? step.coords : [step.boardCoordinate])],
            coordRoles: [...(step.coordRoles?.length ? step.coordRoles : [step.role])],
            zMm: step.zMm,
            instruction: fabricationPartDisplayLabel(step.instruction),
            check: step.check ? fabricationPartDisplayLabel(step.check) : step.check,
            stack,
            partRefs: [...new Set(stack.flatMap(item => item.partRef ?? []))],
            pinIds: []
        };
    });
    const first: BuildPlanStepV1 = {
        id: stepId(1, lane === 'custom' ? 'export' : 'show-parts'),
        order: 1,
        index: 1,
        sectionId,
        scope: 'mechanism',
        mechanismId: recipe.mechanismId,
        mechanismRef,
        label: lane === 'custom' ? 'Export parts' : 'Gather kit parts',
        phase: lane === 'custom' ? 'export' : 'prepare-parts',
        motion: 'none',
        action: lane === 'custom' ? 'export' : 'show-parts',
        coords: [],
        coordRoles: [],
        zMm: 0,
        instruction: lane === 'custom' ? 'Export files.' : 'Gather parts.',
        check: lane === 'custom' ? 'Parts match recipe.' : 'Parts ready.',
        stack: [],
        partRefs: parts.map(part => part.ref),
        pinIds: []
    };
    const mountIndex = recipeSteps.length + 2;
    const mount: BuildPlanStepV1 = {
        id: stepId(mountIndex, 'mount'),
        order: mountIndex,
        index: mountIndex,
        sectionId,
        scope: 'mechanism',
        mechanismId: recipe.mechanismId,
        mechanismRef,
        label: lane === 'kit' ? 'Mount module to board' : 'Mount custom module',
        phase: 'mount-to-board',
        motion: 'mount_travel_xy',
        action: 'mount',
        coords: boardCoords.length ? boardCoords : [recipe.boardCoordinate],
        coordRoles: boardCoords.length
            ? boardCoords.map(() => lane === 'kit' ? 'board' : 'custom-base')
            : [lane === 'kit' ? 'board' : 'custom-base'],
        zMm: 0,
        instruction: lane === 'kit'
            ? `Mount at ${fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}.`
            : 'Place module.',
        check: lane === 'kit' ? 'Module seated.' : 'Holes line up.',
        stack: [],
        partRefs: parts.map(part => part.ref),
        pinIds: []
    };
    const connectIndex = mountIndex + 1;
    const connect: BuildPlanStepV1 = {
        id: stepId(connectIndex, 'connect'),
        order: connectIndex,
        index: connectIndex,
        sectionId,
        scope: 'mechanism',
        mechanismId: recipe.mechanismId,
        mechanismRef,
        label: 'Connect character',
        phase: 'connect-character',
        motion: 'connect_travel_xy',
        action: 'connect',
        coords: [recipe.boardCoordinate],
        coordRoles: ['output'],
        zMm: 0,
        instruction: 'Connect output.',
        check: recipe.targetPathId ? 'Path follows.' : 'Output moves.',
        stack: [],
        partRefs: [],
        pinIds: []
    };
    const testIndex = connectIndex + 1;
    const test: BuildPlanStepV1 = {
        id: stepId(testIndex, 'test'),
        order: testIndex,
        index: testIndex,
        sectionId,
        scope: 'mechanism',
        mechanismId: recipe.mechanismId,
        mechanismRef,
        label: 'Test motion',
        phase: 'test-motion',
        motion: 'scrub_time',
        action: 'test',
        coords: [recipe.boardCoordinate],
        coordRoles: ['motion'],
        zMm: 0,
        instruction: 'Scrub once.',
        check: recipe.warnings[0] ?? 'Motion OK.',
        stack: [],
        partRefs: [],
        pinIds: []
    };
    return [first, ...recipeSteps, mount, connect, test];
};


import type { FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { boardToScene, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_SPACER_SPEC, fabricationBoardCoordinateCallout, fabricationGearSpecForPitchRadius, fabricationPartDisplayLabel } from './fabricationContract';
import { fabricationRenderPlanForMechanism } from './fabricationRenderPlan';
import { fabricationStackForMechanism, readableFabricationStackSummary } from './fabricationStackModel';
import { gearTrainOutputRatio, gearTrainPitchRadii, planetaryCarrierOutputRatio } from './kinematics';
import { isBoardFixedCoordRole, REFERENCE_DEFAULTS, referenceRecipeForType, referenceRequiredPartsForMechanism, referenceStepCoordinateCallout } from './mechanismReference';
import { preferredMotionJointId } from './motion';
import { sampleFeasibleRange } from './fabricationReadiness';

export const recipeBoardCallout = (recipe: Pick<FabricationRecipe, 'boardCoordinate' | 'board'>) =>
    fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);

export const recipeTargetCallout = (recipe: Pick<FabricationRecipe, 'targetPartName' | 'targetPartId' | 'targetSceneObjectName' | 'targetSceneObjectId' | 'targetPathId' | 'targetAnchorJointId'>) => [
    recipe.targetPartName || recipe.targetPartId || recipe.targetSceneObjectName || recipe.targetSceneObjectId,
    recipe.targetPathId,
    recipe.targetAnchorJointId
].filter(Boolean).join(' · ');

export const mechanismTypeLabel = (type: MechanismConfig['type']) =>
    referenceRecipeForType(type).title || type.replace(/[-_]/g, ' ');

export const readableStepCoordinateCallout = (step: FabricationRecipe['assemblySteps'][number]) =>
    referenceStepCoordinateCallout(step).replace(/\b([A-O](?:[1-9]|1[0-5]))\b/g, coord => fabricationBoardCoordinateCallout(coord));

const BOARD_COORD_RE = /^([A-O])([1-9]|1[0-5])$/;
const isValidBoardCoordinate = (coord: string) => BOARD_COORD_RE.test(coord);

const parseBoardCoordinate = (coord: string) => {
    const match = BOARD_COORD_RE.exec(coord);
    if (!match) return null;
    return { col: match[1].charCodeAt(0) - 65, row: Number(match[2]) - 1 };
};

const formatBoardCoordinate = (col: number, row: number, boardCells = 15) =>
    col >= 0 && col < boardCells && row >= 0 && row < boardCells
        ? `${String.fromCharCode(65 + col)}${row + 1}`
        : `off-board(${col},${row})`;

const offsetBoardCoordinate = (coord: string, dc: number, dr: number, boardCells = 15) => {
    const point = parseBoardCoordinate(coord);
    return point ? formatBoardCoordinate(point.col + dc, point.row + dr, boardCells) : coord;
};


const translateBoardCoordinate = (coord: string, from: string, to: string, boardCells = 15) => {
    const point = parseBoardCoordinate(coord);
    const origin = parseBoardCoordinate(from);
    const target = parseBoardCoordinate(to);
    if (!point || !origin || !target) return coord;
    return formatBoardCoordinate(
        point.col + target.col - origin.col,
        point.row + target.row - origin.row,
        boardCells,
    );
};

const referenceOriginCoordinate = (mechanism: MechanismConfig) => {
    const recipe = referenceRecipeForType(mechanism.type);
    return recipe.assemblySteps[0]?.boardCoordinate ?? recipe.assemblySteps[0]?.coords?.[0];
};

const currentStackLabel = (mechanism: MechanismConfig, prefix: string, fallback: string) =>
    fabricationStackForMechanism(mechanism).find(layer => layer.label.startsWith(prefix))?.label ?? fallback;

const applyTextReplacements = (text: string | undefined, replacements: Array<[string, string]>) =>
    replacements
        .reduce((current, [from], index) => current.replaceAll(from, `__MS_REPL_${index}__`), text ?? '')
        .replace(/__MS_REPL_(\d+)__/g, (_, index) => replacements[Number(index)]?.[1] ?? '');

const stack = (...items: Array<{ label: string; role: string; part?: string }>): FabricationRecipe['assemblySteps'][number]['stack'] =>
    items.map((item, index) => ({ order: index + 1, ...item }));

const fastenerStack = (site: string) => stack(
    { label: site, role: site.toLowerCase().includes('board') ? 'board' : 'link-end-hole' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
    { label: 'Paper fastener', role: 'paper-fastener' },
    { label: 'Open tabs loosely', role: 'fastener-tabs' }
);

const movingPartStack = (site: string, partLabel: string, partKey: string, siteRole = 'board') => stack(
    { label: site, role: siteRole, part: siteRole === 'board' ? undefined : 'reference' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
    { label: partLabel, role: 'moving-part', part: partKey },
    { label: 'Paper fastener', role: 'paper-fastener' },
    { label: 'Open tabs loosely', role: 'fastener-tabs' }
);

const sceneLengthCells = (sceneLength: number | undefined, fallback: number, minimum = 1) =>
    Math.max(minimum, Math.round(Math.abs(Number.isFinite(sceneLength) ? sceneLength! : fallback) / Math.max(1, SCENE_PX_PER_MM * REFERENCE_DEFAULTS.pitchMm)));

const gearCellDistance = (a: number, b: number) =>
    Math.max(1, Math.round((Math.abs(a) + Math.abs(b)) / Math.max(1, SCENE_PX_PER_MM * REFERENCE_DEFAULTS.pitchMm)));

const stepBoardCoordinate = (coords: string[], coordRoles: string[], fallback: string) => {
    const firstBoardIndex = coordRoles.findIndex(role => isBoardFixedCoordRole(role));
    return coords[firstBoardIndex >= 0 ? firstBoardIndex : 0] ?? fallback;
};

const dynamicStep = (
    mechanism: MechanismConfig,
    source: FabricationRecipe['assemblySteps'][number],
    coords: string[],
    coordRoles: string[],
    boardCoordinate: string,
    instruction: string,
    stackOverride?: FabricationRecipe['assemblySteps'][number]['stack']
): FabricationRecipe['assemblySteps'][number] => {
    const replacements = currentStepReplacements(mechanism, source);
    return {
        ...source,
        label: applyTextReplacements(source.label, replacements),
        instruction: applyTextReplacements(instruction, replacements),
        check: source.check ? applyTextReplacements(source.check, replacements) : source.check,
        stack: stackOverride ?? source.stack?.map(item => ({ ...item, label: applyTextReplacements(item.label, replacements) })),
        coords,
        coordRoles,
        boardCoordinate: stepBoardCoordinate(coords, coordRoles, boardCoordinate),
        zMm: source.zMm ?? 0
    };
};

const currentStepReplacements = (mechanism: MechanismConfig, step: FabricationRecipe['assemblySteps'][number]): Array<[string, string]> => {
    if (mechanism.type === '4bar') {
        const input = currentStackLabel(mechanism, 'Input L', 'Input L2 linkage');
        const coupler = currentStackLabel(mechanism, 'Coupler L', 'Coupler L4 linkage');
        const output = currentStackLabel(mechanism, 'Output L', 'Output L2 linkage');
        if (step.index === 2) return [['L2 linkage', input], ['L2 from', `${input} from`]];
        if (step.index === 3) return [['L4 linkage', coupler], ['Join L4 to', `Join ${coupler} to`]];
        if (step.index === 5) return [['L4 coupler', coupler], ['L4 linkage', coupler]];
        if (step.index === 4) return [['L2 linkage', output], ['L2 from', `${output} from`]];
    }
    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage') {
        const driveGear = currentStackLabel(mechanism, 'Drive G', 'Drive G3 / 3-space gear');
        const outputGear = currentStackLabel(mechanism, 'Output G', 'Output G3 / 3-space gear');
        const driveLink = currentStackLabel(mechanism, 'Drive L', 'Drive L4 linkage');
        const outputLink = currentStackLabel(mechanism, 'Output L', 'Output L4 linkage');
        if (step.index === 2) return [['G3 / 3-space gear', driveGear], ['drive G3', driveGear], ['Drive G3', driveGear]];
        if (step.index === 3) return [['G3 / 3-space gear', outputGear], ['output G3', outputGear], ['Output G3', outputGear]];
        if (mechanism.type === 'gear_linkage' && step.index === 4) return [['L4 linkage', driveLink], ['L4', driveLink], ['drive G3', driveGear], ['Drive G3', driveGear]];
        if (mechanism.type === 'gear_linkage' && step.index === 5) return [['L4 linkage', outputLink], ['L4 links', 'link ends'], ['L4', outputLink], ['output G3', outputGear], ['Output G3', outputGear]];
    }
    return [];
};

const placedPrefabStep = (
    mechanism: MechanismConfig,
    step: FabricationRecipe['assemblySteps'][number],
    boardCoordinate: string,
    boardCells = 15,
): FabricationRecipe['assemblySteps'][number] => {
    const origin = referenceOriginCoordinate(mechanism);
    const coords = origin
        ? step.coords?.map(coord => translateBoardCoordinate(coord, origin, boardCoordinate, boardCells))
        : step.coords;
    const coordRoles = step.coordRoles ?? [];
    const firstBoardIndex = coordRoles.findIndex(role => isBoardFixedCoordRole(role));
    const translatedBoardCoordinate = coords?.[firstBoardIndex >= 0 ? firstBoardIndex : 0] ?? boardCoordinate;
    const replacements = currentStepReplacements(mechanism, step);
    return {
        ...step,
        label: applyTextReplacements(step.label, replacements),
        instruction: applyTextReplacements(step.instruction, replacements),
        check: step.check ? applyTextReplacements(step.check, replacements) : step.check,
        stack: step.stack?.map(item => ({ ...item, label: applyTextReplacements(item.label, replacements) })),
        boardCoordinate: translatedBoardCoordinate,
        coords,
        zMm: step.zMm ?? 0
    };
};

const dynamicFourBarSteps = (mechanism: MechanismConfig, boardCoordinate: string, boardCells = 15): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType('4bar');
    const inputCells = sceneLengthCells(mechanism.crankLength, REFERENCE_DEFAULTS.fourBar.input, 2);
    const couplerCells = sceneLengthCells(mechanism.couplerLength, REFERENCE_DEFAULTS.fourBar.coupler, 4);
    const outputCells = sceneLengthCells(mechanism.rockerLength, REFERENCE_DEFAULTS.fourBar.output, 2);
    const groundCells = sceneLengthCells(mechanism.groundLength, REFERENCE_DEFAULTS.fourBar.ground, 2);
    const a = boardCoordinate;
    const groundAngle = (((mechanism.groundAngle ?? 270) % 360) + 360) % 360;
    const dc = Math.round(Math.cos((groundAngle * Math.PI) / 180) * groundCells);
    const dr = Math.round(-Math.sin((groundAngle * Math.PI) / 180) * groundCells);
    const d = offsetBoardCoordinate(a, dc, dr, boardCells);
    const b = recipe.assemblySteps[1]?.coords?.[1] ?? 'G6';
    const c = recipe.assemblySteps[2]?.coords?.[1] ?? 'G10';
    return [
        dynamicStep(mechanism, recipe.assemblySteps[0], [a, d], ['board', 'board'], boardCoordinate, `Pin ground pivots at ${a} and ${d}.`, stack(
            { label: `Board hole ${a}`, role: 'board' },
            { label: 'Paper fastener', role: 'paper-fastener' },
            { label: 'Open tabs behind board', role: 'fastener-tabs' },
            { label: `Repeat this stack at ${a}, ${d}`, role: 'repeat-fastener-sites' }
        )),
        dynamicStep(mechanism, recipe.assemblySteps[1], [a, b], ['board', 'link_end_reference'], boardCoordinate, `Place ${currentStackLabel(mechanism, 'Input L', 'Input L2 linkage')} from ${a} toward ${b} with spacers.`),
        dynamicStep(mechanism, recipe.assemblySteps[2], [b, c], ['link_joint_reference', 'link_end_reference'], boardCoordinate, `Join ${currentStackLabel(mechanism, 'Coupler L', 'Coupler L4 linkage')} from ${b} toward ${c}.`),
        dynamicStep(mechanism, recipe.assemblySteps[3], [c, d], ['link_joint_reference', 'board'], boardCoordinate, `Place ${currentStackLabel(mechanism, 'Output L', 'Output L2 linkage')} from ${c} back to ${d}.`),
        dynamicStep(mechanism, recipe.assemblySteps[4], [c], ['link_joint_reference'], boardCoordinate, `Fasten the coupler and output link at ${c} only, not to the board.`)
    ].map((step, index) => ({ ...step, index: index + 1 }));
};

const dynamicGearSteps = (mechanism: MechanismConfig, boardCoordinate: string, boardCells = 15): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType('gear');
    const radii = gearTrainPitchRadii(mechanism);
    const coords = radii.reduce<string[]>((list, radius, index) => {
        if (index === 0) return [boardCoordinate];
        const previous = radii[index - 1];
        const previousCoord = list[index - 1] ?? boardCoordinate;
        return [...list, offsetBoardCoordinate(previousCoord, 0, gearCellDistance(previous, radius), boardCells)];
    }, []);
    const gearStep = (index: number, label: string, coord: string, radius: number, roleLabel: 'drive' | 'idler' | 'output'): FabricationRecipe['assemblySteps'][number] => {
        const spec = fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
        return {
            ...recipe.assemblySteps[Math.min(index === 1 ? 0 : roleLabel === 'drive' ? 1 : 2, recipe.assemblySteps.length - 1)],
            index,
            label,
            role: index === 1 ? 'place-fastener' : 'add-part',
            boardCoordinate: coord,
            coords: [coord],
            coordRoles: ['board'],
            instruction: index === 1
                ? `Place the drive gear fastener at ${coord}.`
                : `Place ${roleLabel} ${spec.label} at ${coord}.`,
            check: index === 1 ? 'The fastener turns freely.' : 'The gear spins without rubbing.',
            stack: index === 1 ? fastenerStack(`Board hole ${coord}`) : movingPartStack(`Board hole ${coord}`, spec.label, `gears:${spec.key}`)
        };
    };
    const steps: FabricationRecipe['assemblySteps'] = [
        gearStep(1, `Start at ${coords[0]}`, coords[0], radii[0], 'drive'),
        gearStep(2, `Add drive ${fabricationGearSpecForPitchRadius(Math.abs(radii[0]) / SCENE_PX_PER_MM).label}`, coords[0], radii[0], 'drive')
    ];
    radii.slice(1, -1).forEach((radius, idlerIndex) => {
        const stepIndex = steps.length + 1;
        steps.push(gearStep(stepIndex, `Add idler ${fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM).label}`, coords[idlerIndex + 1], radius, 'idler'));
    });
    steps.push(gearStep(steps.length + 1, `Add output ${fabricationGearSpecForPitchRadius(Math.abs(radii.at(-1) ?? radii[0]) / SCENE_PX_PER_MM).label}`, coords.at(-1) ?? coords[0], radii.at(-1) ?? radii[0], 'output'));
    steps.push({
        ...recipe.assemblySteps[3],
        index: steps.length + 1,
        label: 'Check gear mesh',
        boardCoordinate: coords[0],
        coords: [coords[0], coords.at(-1) ?? coords[0]],
        coordRoles: ['board', 'board'],
        instruction: `Turn the drive gear at ${coords[0]} and confirm the output gear at ${coords.at(-1) ?? coords[0]} counter-rotates.`,
        stack: movingPartStack(`Board hole ${coords[0]}`, fabricationGearSpecForPitchRadius(Math.abs(radii[0]) / SCENE_PX_PER_MM).label, `gears:${fabricationGearSpecForPitchRadius(Math.abs(radii[0]) / SCENE_PX_PER_MM).key}`)
    });
    return steps;
};

const dynamicGearLinkageSteps = (mechanism: MechanismConfig, boardCoordinate: string, boardCells = 15): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType('gear_linkage');
    const radii = gearTrainPitchRadii(mechanism);
    const outputSpanCells = radii.length > 2
        ? radii.slice(1).reduce((sum, radius, index) => sum + gearCellDistance(radii[index], radius), 0)
        : sceneLengthCells(mechanism.groundLength, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 2);
    const gearCoords = radii.map((radius, index) => {
        if (index === 0) return boardCoordinate;
        if (radii.length <= 2) return offsetBoardCoordinate(boardCoordinate, 0, outputSpanCells, boardCells);
        const offsetCells = radii.slice(1, index + 1).reduce((sum, current, currentIndex) => sum + gearCellDistance(radii[currentIndex], current), 0);
        return offsetBoardCoordinate(boardCoordinate, 0, offsetCells, boardCells);
    });
    const drive = gearCoords[0] ?? boardCoordinate;
    const output = gearCoords.at(-1) ?? drive;
    const drivePoint = parseBoardCoordinate(drive);
    const outputPoint = parseBoardCoordinate(output);
    const connector = drivePoint && outputPoint
        ? formatBoardCoordinate(
            Math.round((drivePoint.col + outputPoint.col) / 2),
            Math.round((drivePoint.row + outputPoint.row) / 2),
            boardCells,
        )
        : offsetBoardCoordinate(drive, 0, Math.max(1, Math.round(outputSpanCells / 2)), boardCells);
    const outputLink = currentStackLabel(mechanism, 'Output L', 'Output L4 linkage');
    const driveLink = currentStackLabel(mechanism, 'Drive L', 'Drive L4 linkage');
    const linkagePartKey = `linkages:linkage-${sceneLengthCells(mechanism.couplerLength, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 2)}-cell`;
    const gearPartStep = (index: number, label: string, coord: string, radius: number, sourceIndex: number, roleLabel: 'drive' | 'idler' | 'output'): FabricationRecipe['assemblySteps'][number] => {
        const spec = fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
        return {
            ...recipe.assemblySteps[sourceIndex],
            index,
            label,
            boardCoordinate: coord,
            coords: [coord],
            coordRoles: ['board'],
            instruction: `Place ${roleLabel} ${spec.label} at ${coord}.`,
            check: roleLabel === 'idler' ? 'The idler spins between the endpoint gears.' : 'The gear spins without rubbing.',
            stack: movingPartStack(`Board hole ${coord}`, spec.label, `gears:${spec.key}`)
        };
    };
    const steps: FabricationRecipe['assemblySteps'] = [
        { ...recipe.assemblySteps[0], index: 1, boardCoordinate: drive, coords: [drive], coordRoles: ['board'], instruction: `Place the drive gear fastener at ${drive}.`, stack: fastenerStack(`Board hole ${drive}`) },
        gearPartStep(2, `Add drive ${fabricationGearSpecForPitchRadius(Math.abs(radii[0]) / SCENE_PX_PER_MM).label}`, drive, radii[0], 1, 'drive')
    ];
    radii.slice(1, -1).forEach((radius, idlerIndex) => {
        const stepIndex = steps.length + 1;
        steps.push(gearPartStep(stepIndex, `Add idler ${fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM).label}`, gearCoords[idlerIndex + 1], radius, 2, 'idler'));
    });
    steps.push(gearPartStep(steps.length + 1, `Add output ${fabricationGearSpecForPitchRadius(Math.abs(radii.at(-1) ?? radii[0]) / SCENE_PX_PER_MM).label}`, output, radii.at(-1) ?? radii[0], 2, 'output'));
    steps.push(
        dynamicStep(mechanism, recipe.assemblySteps[3], [drive, connector], ['gear_handle_reference', 'link_end_reference'], boardCoordinate, `Fasten ${driveLink} through an off-center drive gear handle near ${drive}, then point the free end toward ${connector}.`, movingPartStack(`Drive gear handle hole near ${drive}`, driveLink, linkagePartKey, 'gear-handle-hole')),
        dynamicStep(mechanism, recipe.assemblySteps[4], [output, connector], ['gear_handle_reference', 'link_end_reference'], boardCoordinate, `Fasten ${outputLink} through an off-center output gear handle near ${output}, then meet the first link at ${connector}.`, movingPartStack(`Output gear handle hole near ${output}`, outputLink, linkagePartKey, 'gear-handle-hole')),
        dynamicStep(mechanism, recipe.assemblySteps[5], [connector], ['link_end_reference'], boardCoordinate, `Fasten the two free link ends near ${connector} with one spacer between them.`, stack(
            { label: `Moving connector near ${connector}`, role: 'link-end-hole' },
            { label: driveLink, role: 'moving-part', part: linkagePartKey },
            { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
            { label: outputLink, role: 'moving-part', part: linkagePartKey },
            { label: 'Paper fastener', role: 'paper-fastener' }
        ))
    );
    return steps.map((step, index) => ({ ...step, index: index + 1 }));
};

export const prefabAssemblySteps = (mechanism: MechanismConfig, boardCoordinate: string, boardCells = 15): FabricationRecipe['assemblySteps'] => {
    const recipe = referenceRecipeForType(mechanism.type);
    if (recipe.exportReady && recipe.assemblySteps.length) {
        if (mechanism.type === '4bar') return dynamicFourBarSteps(mechanism, boardCoordinate, boardCells);
        if (mechanism.type === 'gear') return dynamicGearSteps(mechanism, boardCoordinate, boardCells);
        if (mechanism.type === 'gear_linkage') return dynamicGearLinkageSteps(mechanism, boardCoordinate, boardCells);
        return recipe.assemblySteps.map(step => placedPrefabStep(mechanism, step, boardCoordinate, boardCells));
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
    const targetSceneObject = mechanism.targetSceneObjectId ? project.sceneObjects[mechanism.targetSceneObjectId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = targetPart ? preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId) : undefined;
    const range = sampleFeasibleRange(mechanism);
    const assemblySteps = prefabAssemblySteps(
        mechanism,
        board.label,
        project.settings.physicalKit.boardCells,
    );
    const warnings = [...new Set([
        ...(mechanism.warnings ?? []),
        ...((mechanism.fabricationMetadata as { warnings?: string[] } | undefined)?.warnings ?? []),
        ...(range.warning ? [range.warning] : []),
        ...((targetPart && !targetPart.visible) ? ['Target part hidden'] : []),
        ...((targetSceneObject && !targetSceneObject.visible) ? ['Target object hidden'] : [])
    ])];
    return {
        mechanismId: mechanism.id,
        type: mechanism.type,
        targetPartId: mechanism.targetPartId,
        targetSceneObjectId: mechanism.targetSceneObjectId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId,
        targetPartName: targetPart?.name,
        targetSceneObjectName: targetSceneObject?.name,
        targetPathPointCount: targetPath?.points.length,
        boardCoordinate: board.label,
        board,
        sceneAnchor: { x: mechanism.anchorX!, y: mechanism.anchorY! },
        offsetFromBoardMm: { x: (mechanism.anchorX! - boardScene.x) / SCENE_PX_PER_MM, y: (mechanism.anchorY! - boardScene.y) / SCENE_PX_PER_MM },
        camProfileSamples: mechanism.type === 'cam' ? [...(mechanism.camProfileSamples ?? [])] : undefined,
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
            targetPart
                ? `Output: ${targetPart.name} · ${targetPath?.id ?? 'no path'}.`
                : targetSceneObject
                    ? `Output: ${targetSceneObject.name} · ${targetPath?.id ?? 'no path'}.`
                    : 'Output: standalone.',
            warnings.length ? `Fix: ${warnings.join('; ')}` : 'Ready.'
        ],
        assemblySteps,
        warnings
    };
};

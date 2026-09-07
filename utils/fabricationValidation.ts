import type { FabricationIssue, MechanismConfig, ProjectState } from '../types';
import { gearTrainPitchCenterDistance, gearTrainResolvedCenterDistance, gearTrainPitchRadii, generateCurvePoints } from './kinematics';
import { boardToScene, sceneToBoardRaw, sceneBoundsForSheet } from './coordinates';
import { referenceRecipeForType } from './mechanismReference';
import { mechanismBindingWarnings } from './motion';
import { mechanismWithOutputBindings, resolvedMechanismOutputBindings } from './mechanismBindings';
import { offBoardFixedAssemblyCoordinatesForMechanism } from './boardHoleConstraints';
import { primaryFoundryPlaybackPath } from './foundryPlayback';
import { FABRICATION_LINKAGE_ROLE_MIN_HOLES, planetaryRingPitchRadius } from './fabricationSizing';
import { closePhysicalValue, closeToBoardPitch, closeToFabricationLinkage, fabricationPitchMmForMechanism, physicalTolerance, sampleFeasibleRange } from './fabricationReadiness';
import { validateFabricationStack } from './fabricationRenderPlan';
import { characterFabricationOutlineIssues, cuttableObjectHasOutline } from './fabricationOutlineIssues';

export const validateMechanismPreviewReadiness = (mechanism: MechanismConfig): string[] => {
    const errors = [...validateFabricationStack(mechanism)];
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) errors.push(recipe.reason ?? 'not fabrication-ready.');

    const physicalNumbers = [
        mechanism.crankLength,
        mechanism.couplerLength,
        mechanism.groundLength,
        mechanism.rockerLength,
        mechanism.sliderOffset,
        mechanism.couplerPointDist,
        mechanism.couplerPointAngle
    ];
    if (mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'piston') physicalNumbers.push(mechanism.rodLength ?? Number.NaN);
    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') physicalNumbers.push(mechanism.gearRatio ?? Number.NaN, mechanism.speed2 ?? Number.NaN);
    if (!physicalNumbers.every(Number.isFinite)) errors.push('bad dimension.');
    if ((mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') && (mechanism.gearRatio ?? 0) === 0) errors.push('gear ratio 0.');

    if (mechanism.type === '4bar') {
        const pitchMm = fabricationPitchMmForMechanism(mechanism);
        const lengthsAreFabricationSnapped =
            closeToBoardPitch(mechanism.groundLength, pitchMm) &&
            closeToFabricationLinkage(mechanism.crankLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.driver, pitchMm) &&
            closeToFabricationLinkage(mechanism.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler, pitchMm) &&
            closeToFabricationLinkage(mechanism.rockerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.output, pitchMm);
        if (!lengthsAreFabricationSnapped) errors.push('snap four-bar linkage lengths.');
    }

    if (mechanism.type === 'gear') {
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) {
            errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'gear_linkage') {
        const radii = gearTrainPitchRadii(mechanism);
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        const actualGround = Math.abs(mechanism.groundLength);
        if (radii.length > 2) {
            if (!closePhysicalValue(actualGround, pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) errors.push('snap gear pitch.');
        } else {
            if (actualGround <= pitchSpan + physicalTolerance(pitchSpan)) {
                errors.push('gear linkage endpoint gears must be separated; add idler gears for meshing.');
            }
            if (!closePhysicalValue(actualGround, resolvedSpan)) errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'planetary_gear') {
        const expectedCarrier = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength);
        const expectedRing = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength) * 2;
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), expectedCarrier)) errors.push('planetary carrier radius must equal sun plus planet.');
        if (!closePhysicalValue(planetaryRingPitchRadius(mechanism), expectedRing)) errors.push('planetary ring radius must equal sun plus two planet radii.');
    }

    const range = sampleFeasibleRange(mechanism);
    if (range.warning?.startsWith('No motion')) errors.push('No motion.');
    return [...new Set(errors.filter(Boolean))];
};

export type MechanismBoardPlacementIssue = {
    message: string;
    recoveryAction: string;
};

const BOARD_GRID_EPSILON_PX = 0.01;

/**
 * Board placement is an export invariant, independent of the optional
 * fabrication-ready tuning mode. Keep this focused on placement so Design and
 * import workers can validate a fitted mechanism without requiring a target.
 */
export const mechanismBoardPlacementIssues = (
    project: ProjectState,
    mechanism: MechanismConfig,
): MechanismBoardPlacementIssue[] => {
    if (!Number.isFinite(mechanism.anchorX) || !Number.isFinite(mechanism.anchorY)) {
        return [{ message: 'missing board anchor.', recoveryAction: 'Drag to board' }];
    }

    const kit = project.settings.physicalKit;
    const board = sceneToBoardRaw(
        { x: mechanism.anchorX!, y: mechanism.anchorY! },
        kit,
    );
    if (!board.valid) {
        return [{ message: `off board at ${board.label}.`, recoveryAction: 'Move onto board' }];
    }

    const boardScene = boardToScene(board.col, board.row, kit);
    if (
        Math.hypot(
            boardScene.x - mechanism.anchorX!,
            boardScene.y - mechanism.anchorY!,
        ) > BOARD_GRID_EPSILON_PX
    ) {
        return [{ message: `anchor off grid at ${board.label}.`, recoveryAction: 'Snap to hole' }];
    }

    const offBoardHoles = offBoardFixedAssemblyCoordinatesForMechanism(
        mechanism,
        board.label,
        kit.boardCells,
    );
    if (offBoardHoles.length) {
        const coordinates = [...new Set(
            offBoardHoles.map((hole) => hole.coordinate),
        )].join(', ');
        return [{
            message: `assembly holes off board near ${coordinates}.`,
            recoveryAction: 'Move inward',
        }];
    }

    const sheet = sceneBoundsForSheet(kit);
    const insideSheet = (point: { x: number; y: number }) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= sheet.x &&
        point.x <= sheet.x + sheet.width &&
        point.y >= sheet.y &&
        point.y <= sheet.y + sheet.height;
    const path = mechanism.type === 'planetary_gear'
        ? primaryFoundryPlaybackPath(mechanism, 72)
        : generateCurvePoints(mechanism, 72).points;
    if (path.some((point) => !insideSheet(point))) {
        return [{ message: 'path outside sheet.', recoveryAction: 'Resize or move' }];
    }
    return [];
};

export const mechanismBoardPlacementErrors = (
    project: ProjectState,
    mechanism: MechanismConfig,
) => mechanismBoardPlacementIssues(project, mechanism).map(
    (issue) => `${mechanism.id}: ${issue.message}`,
);

export const validateForFabrication = (project: ProjectState) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const issues: FabricationIssue[] = [];
    const add = (severity: FabricationIssue['severity'], message: string, extra: Partial<FabricationIssue> = {}) => {
        const target = severity === 'error' ? errors : warnings;
        if (target.includes(message)) return;
        issues.push({ severity, message, recoveryStage: severity === 'error' ? 'design' : 'blueprint', recoveryAction: 'Review item', ...extra });
        target.push(message);
    };
    const sheet = sceneBoundsForSheet(project.settings.physicalKit);
    const fabricationSeverity: FabricationIssue['severity'] = project.settings.fabricationReadyMode ? 'error' : 'warning';
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    const visibleCuttableObjects = project.sceneObjectOrder.flatMap(id => {
        const object = project.sceneObjects[id];
        return object && object.visible !== false && object.fabrication === 'cuttable' ? [object] : [];
    });
    const visibleCharacterParts = project.partOrder.some(id => project.parts[id]?.visible !== false && Boolean(project.parts[id]));
    if (!visibleCharacterParts && !visibleCuttableObjects.length) add('error', 'No cuttable pieces.', { recoveryStage: 'character', recoveryAction: 'Draw an object' });
    for (const object of visibleCuttableObjects) {
        if (!cuttableObjectHasOutline(object)) add('error', `${object.name}: Fix shape before printing.`, { recoveryStage: 'character', recoveryAction: 'Change shape' });
    }
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    const bindingWarnings = mechanismBindingWarnings(project, activeMechanisms);
    for (const issue of characterFabricationOutlineIssues(project)) {
        add('error', issue.message, { partId: issue.partId, recoveryStage: 'character', recoveryAction: 'Change shape' });
    }
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const corners = [
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale }
        ];
        if (corners.some(p => !insideSheet(p))) add('warning', `${part.id}: visible part extends outside sheet bounds.`, { partId, recoveryStage: 'path', recoveryAction: 'Move part inside sheet' });
    });
    project.sceneObjectOrder.forEach(objectId => {
        const object = project.sceneObjects[objectId];
        if (!object?.visible) return;
        const halfWidth = (object.bounds.width * object.transform.scale) / 2;
        const halfHeight = (object.bounds.height * object.transform.scale) / 2;
        const corners = [
            { x: object.transform.x - halfWidth, y: object.transform.y - halfHeight },
            { x: object.transform.x + halfWidth, y: object.transform.y - halfHeight },
            { x: object.transform.x - halfWidth, y: object.transform.y + halfHeight },
            { x: object.transform.x + halfWidth, y: object.transform.y + halfHeight }
        ];
        if (corners.some(p => !insideSheet(p))) add('warning', `${object.id}: visible object extends outside sheet bounds.`, { recoveryStage: 'character', recoveryAction: 'Move object inside sheet' });
    });
    activeMechanisms.forEach(m => {
        const outputBindings = resolvedMechanismOutputBindings(project, m).filter(binding => binding.enabled !== false);
        validateMechanismPreviewReadiness(m).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose ready template' }));
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if (!outputBindings.length) add('error', `${m.id}: choose target + path.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target + path' });
        outputBindings.forEach(binding => {
            if (binding.targetPartId && !project.parts[binding.targetPartId]) add('error', `${m.id}: missing target part ${binding.targetPartId}.`, { mechanismId: m.id, partId: binding.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose existing part' });
            if (binding.targetSceneObjectId && !project.sceneObjects[binding.targetSceneObjectId]) add('error', `${m.id}: missing target object ${binding.targetSceneObjectId}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose existing object' });
            const path = project.paths[binding.pathId];
            if (!path) add('error', `${m.id}: missing path ${binding.pathId}.`, { mechanismId: m.id, pathId: binding.pathId, recoveryStage: 'path', recoveryAction: 'Choose valid path' });
            else {
                const boundMechanism = mechanismWithOutputBindings(m, [binding]);
                const ownerMatches = path.sceneObjectId
                    ? boundMechanism.targetSceneObjectId === path.sceneObjectId
                    : boundMechanism.targetPartId === path.partId;
                if (!ownerMatches) add('error', `${m.id}: path belongs to ${path.sceneObjectId ?? path.partId}.`, { mechanismId: m.id, pathId: binding.pathId, partId: binding.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
            }
        });
        const physicalNumbers = [m.crankLength, m.couplerLength, m.groundLength, m.rockerLength, m.sliderOffset, m.couplerPointDist, m.couplerPointAngle];
        if (m.type === '5bar' || m.type === '6bar' || m.type === 'piston') physicalNumbers.push(m.rodLength ?? Number.NaN);
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') physicalNumbers.push(m.gearRatio ?? Number.NaN, m.speed2 ?? Number.NaN);
        if (!physicalNumbers.every(Number.isFinite)) add('error', `${m.id}: bad dimension.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Fix dimensions' });
        if ((m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') && (m.gearRatio ?? 0) === 0) add('error', `${m.id}: gear ratio 0.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose non-zero ratio' });
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') {
            const expectedCenterDistance = m.type === 'gear'
                ? gearTrainPitchCenterDistance(m)
                : m.type === 'gear_linkage'
                    ? gearTrainResolvedCenterDistance(m)
                    : m.crankLength + m.rockerLength;
            if (Math.abs(m.groundLength - expectedCenterDistance) > Math.max(1, expectedCenterDistance * 0.03)) {
                add(fabricationSeverity, `${m.id}: snap gear pitch.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Snap gear pitch' });
            }
        }
        if (m.type === 'rack-pinion' && Math.abs(m.sliderOffset) < Math.max(2, m.crankLength * 0.8)) add('warning', `${m.id}: rack guide too close.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Move rack guide' });
        if (m.type === 'rack-pinion' && m.rockerLength < m.crankLength * (2 * Math.PI + 2)) add(fabricationSeverity, `${m.id}: rack too short.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Lengthen rack' });
        const range = sampleFeasibleRange(m);
        if (range.warning?.startsWith('No motion')) add('error', `${m.id}: ${range.warning}.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Adjust' });
        else if (range.warning) add('warning', `${m.id}: ${range.warning}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Review partial motion' });
        if (m.type === 'cam' && project.settings.physicalKit.boardCells !== 15) {
            add('error', `${m.id}: cam module needs 15x15 board.`, { mechanismId: m.id, recoveryStage: 'blueprint', recoveryAction: 'Use 15x15 kit' });
        }
        mechanismBoardPlacementIssues(project, m).forEach((issue) => {
            add('error', `${m.id}: ${issue.message}`, {
                mechanismId: m.id,
                recoveryStage: 'design',
                recoveryAction: issue.recoveryAction,
            });
        });
        if (Number.isFinite(m.anchorX) && Number.isFinite(m.anchorY)) {
            const board = sceneToBoardRaw(
                { x: m.anchorX!, y: m.anchorY! },
                project.settings.physicalKit,
            );
            if (
                board.valid &&
                (board.col <= 0 ||
                    board.row <= 0 ||
                    board.col >= project.settings.physicalKit.boardCells - 1 ||
                    board.row >= project.settings.physicalKit.boardCells - 1)
            ) {
                add('warning', `${m.id}: near board edge ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
            }
        }
    });
    return { warnings, errors, issues };
};


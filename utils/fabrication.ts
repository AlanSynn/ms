import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, Point, ProjectState } from '../types';
import { gearTrainOutputRatio, gearTrainPitchCenterDistance, gearTrainResolvedCenterDistance, gearTrainPitchRadii, generateCurvePoints, planetaryCarrierOutputRatio } from './kinematics';
import { boardToScene, SCENE_PX_PER_MM, sceneToBoardRaw, sceneBoundsForSheet } from './coordinates';
import { mechanismRequiredParts } from './project';
import { referenceRecipeForType, referenceStepCoordinateCallout } from './mechanismReference';
import { mechanismBindingWarnings, preferredMotionJointId } from './motion';
import { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
import { FABRICATION_LINKAGE_ROLE_MIN_HOLES, planetaryRingPitchRadius } from './fabricationSizing';
import { svgNumber } from './numberFormat';
import { circlePath, hexRgb, makePdfDocument, makeSimplePdf, num, pdfText } from './simplePdf';
import { buildCharacterPrintLayout } from './fabricationCharacterPrintLayout';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlineBounds, pointInsideOutline } from './partGeometry';
import {
    closePhysicalValue,
    closeToBoardPitch,
    closeToFabricationLinkage,
    physicalTolerance,
    sampleFeasibleRange
} from './fabricationReadiness';
import {
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';
import {
    STACK_COLORS,
    fabricationBaseLayer,
    fabricationStackForMechanism,
    readableFabricationStackSummary,
    type FabricationStackLayer
} from './fabricationStackModel';

import {
    FABRICATION_GEAR_SPECS,
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_LINKAGE_WIDTH_MM,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SOURCE_SSOT,
    FABRICATION_SPACER_SPEC,
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationGearSpecForPitchRadius as sharedFabricationGearSpecForPitchRadius,
    fabricationLinkageSpecForCells as sharedFabricationLinkageSpecForCells,
    fabricationPartDisplayLabel,
    type FabricationGearSpec,
    type FabricationLinkageSpec,
    type FabricationRingGearSpec,
    type FabricationSpacerSpec
} from './fabricationContract';

export {
    FABRICATION_GEAR_SPECS,
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_LINKAGE_WIDTH_MM,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SOURCE_SSOT,
    FABRICATION_SPACER_SPEC,
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationPartDisplayLabel
};
export type { FabricationGearSpec, FabricationLinkageSpec, FabricationRingGearSpec, FabricationSpacerSpec };

export type { FabricationGearProfile, FabricationRingGearProfile } from './fabricationProfiles';
export {
    fabricationGearPathD,
    fabricationGearProfileForPitchRadius,
    fabricationRingGearPathD,
    fabricationRingGearProfileForPitchRadius,
    fabricationRingInnerGearOutlinePoints
} from './fabricationProfiles';
export type { FabricationStackLayer, FabricationStackMechanism } from './fabricationStackModel';
export {
    STACK_COLORS,
    fabricationBaseLayer,
    fabricationLinkageSpecForSceneLength,
    fabricationStackForMechanism,
    fabricationStackSummary,
    readableFabricationStackSummary
} from './fabricationStackModel';
export type { FabricationFeasibleRange } from './fabricationReadiness';
export { sampleFeasibleRange } from './fabricationReadiness';
export type { FabricationRenderKind, FabricationRenderLayer, FabricationRenderPlan } from './fabricationRenderPlan';
export {
    FABRICATION_RENDER_BASE_Z,
    FABRICATION_RENDER_LAYER_Z_STEP,
    FABRICATION_RENDER_MIN_CLEARANCE,
    FABRICATION_RENDER_PART_DEPTH,
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';

export { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';

export type { FabricationLinkageRoleLengths } from './fabricationSizing';
export {
    FABRICATION_LINKAGE_ROLE_MIN_HOLES,
    PLANETARY_GEAR_PLANET_COUNT,
    PLANETARY_GEAR_SYNTAX,
    fabricationLinkageHoleCountForSceneLength,
    fabricationLinkageHoleCountsForMechanism,
    fabricationLinkageSceneLengthsForMechanism,
    planetaryCarrierPitchRadius,
    planetaryGearConventionForMechanism,
    planetaryGearRadii,
    planetaryPlanetCenters,
    planetaryRingPitchRadius
} from './fabricationSizing';

export const fabricationGearSpecForPitchRadius = sharedFabricationGearSpecForPitchRadius;
export const fabricationLinkageSpecForCells = sharedFabricationLinkageSpecForCells;

const recipeBoardCallout = (recipe: Pick<FabricationRecipe, 'boardCoordinate' | 'board'>) =>
    fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);

const recipeTargetCallout = (recipe: Pick<FabricationRecipe, 'targetPartName' | 'targetPartId' | 'targetPathId' | 'targetAnchorJointId'>) => [
    recipe.targetPartName || recipe.targetPartId,
    recipe.targetPathId,
    recipe.targetAnchorJointId
].filter(Boolean).join(' · ');

const mechanismTypeLabel = (type: MechanismConfig['type']) =>
    referenceRecipeForType(type).title || type.replace(/[-_]/g, ' ');

const readableStepCoordinateCallout = (step: FabricationRecipe['assemblySteps'][number]) =>
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
        const lengthsAreFabricationSnapped =
            closeToBoardPitch(mechanism.groundLength) &&
            closeToFabricationLinkage(mechanism.crankLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.driver) &&
            closeToFabricationLinkage(mechanism.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler) &&
            closeToFabricationLinkage(mechanism.rockerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.output);
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
    const snapTolerance = project.settings.physicsSnapMode === 'fast' ? 4 : project.settings.physicsSnapMode === 'high' ? 0.25 : 0.5;
    const fabricationSeverity: FabricationIssue['severity'] = project.settings.fabricationReadyMode ? 'error' : 'warning';
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    if (!project.partOrder.length) add('error', 'No character in scene.', { recoveryStage: 'character', recoveryAction: 'Load a character package' });
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    if (!activeMechanisms.length) add('error', 'No enabled mechanism to export.', { recoveryStage: 'design', recoveryAction: 'Enable or add a mechanism' });
    const bindingWarnings = mechanismBindingWarnings(project, activeMechanisms);
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
    activeMechanisms.forEach(m => {
        validateMechanismPreviewReadiness(m).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose ready template' }));
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if (!m.targetPartId || !m.targetPathId) add('error', `${m.id}: choose target + path.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target + path' });
        if (m.targetPartId && !project.parts[m.targetPartId]) add('error', `${m.id}: missing target part ${m.targetPartId}.`, { mechanismId: m.id, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose existing part' });
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add('error', `${m.id}: missing path ${m.targetPathId}.`, { mechanismId: m.id, pathId: m.targetPathId, recoveryStage: 'path', recoveryAction: 'Choose valid path' });
            else if (m.targetPartId && path.partId !== m.targetPartId) add('error', `${m.id}: path belongs to ${path.partId}.`, { mechanismId: m.id, pathId: m.targetPathId, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
        }
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
        if (!Number.isFinite(m.anchorX) || !Number.isFinite(m.anchorY)) {
            add('error', `${m.id}: missing board anchor.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Drag to board' });
            return;
        }
        const board = sceneToBoardRaw({ x: m.anchorX!, y: m.anchorY! }, project.settings.physicalKit);
        const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : null;
        if (!board.valid) add(fabricationSeverity, `${m.id}: off board at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move onto board' });
        else if (boardScene && Math.hypot(boardScene.x - m.anchorX!, boardScene.y - m.anchorY!) > snapTolerance) add(fabricationSeverity, `${m.id}: anchor off grid at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Snap to hole' });
        else if (board.col <= 0 || board.row <= 0 || board.col >= project.settings.physicalKit.boardCells - 1 || board.row >= project.settings.physicalKit.boardCells - 1) {
            add('warning', `${m.id}: near board edge ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
        }
        const path = generateCurvePoints(m, 72).points;
        if (path.some(p => !insideSheet(p))) add('error', `${m.id}: path outside sheet.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Resize or move' });
    });
    return { warnings, errors, issues };
};

const createRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
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
        requiredParts: mechanism.fabricationMetadata?.requiredParts ?? mechanismRequiredParts(mechanism),
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


const makeCustomPartsSvg = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const layout = buildCharacterPrintLayout(project);
    const point = (p: Point) => `${svgNumber(p.x)} ${svgNumber(p.y)}`;
    const path = (points: Point[]) => points.length ? `M ${point(points[0])} ${points.slice(1).map(p => `L ${point(p)}`).join(' ')} Z` : '';
    const items = layout.parts.map(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const d = path(outlineMm);
        const holes = holeMm
            .map(p => `<circle cx="${svgNumber(p.x)}" cy="${svgNumber(p.y)}" r="${svgNumber(layout.holeRadiusMm)}" fill="#ffffff" stroke="#334155" stroke-width="0.45"/>`)
            .join('');
        return `<g data-part-id="${esc(part.id)}">
<line x1="${svgNumber(sourceCenterMm.x)}" y1="${svgNumber(sourceCenterMm.y)}" x2="${svgNumber(printCenterMm.x)}" y2="${svgNumber(printCenterMm.y)}" stroke="#cbd5e1" stroke-width="0.35" stroke-dasharray="1.8 1.8"/>
<path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="0.5"/>
<path d="${d}" fill="${esc(part.fillColor)}" opacity="0.18"/>
${holes}
</g>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${kit.sheetWidthMm}mm" height="${kit.sheetHeightMm}mm" viewBox="0 0 ${kit.sheetWidthMm} ${kit.sheetHeightMm}" data-character-print-page="letter" data-character-print-mode="whole-character-exploded">
<metadata>${esc(JSON.stringify({ project: project.metadata.name, mode: 'custom-parts', printMode: 'whole-character-exploded', page: 'letter', units: 'mm', scale: layout.scale, source: 'fabricablePartOutlinePoints' }))}</metadata>
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="6" y="6" width="${svgNumber(kit.sheetWidthMm - 12)}" height="${svgNumber(kit.sheetHeightMm - 12)}" rx="6" fill="none" stroke="#dbe3f0" stroke-width="0.5"/>
<text x="10" y="12" font-family="Inter,Arial" font-size="5" font-weight="900" fill="#172033">MotionSmith character cut sheet</text>
<text x="10" y="${svgNumber(kit.sheetHeightMm - 8)}" font-family="Inter,Arial" font-size="3.4" font-weight="700" fill="#64748b">${layout.parts.length} parts · ${kit.holeDiameterMm}mm holes · one letter page</text>
<g data-character-exploded-sheet>
${items}
</g>
</svg>`;
};

const stlNum = (value: number) => Number.isFinite(value) ? Number(value.toFixed(4)) : 0;

const makeCustomPartsStl = (project: ProjectState) => {
    const thicknessMm = 2.4;
    const holeRadiusMm = Math.max(0.5, project.settings.physicalKit.holeDiameterMm / 2);
    const cellMm = Math.max(1, Math.min(2, holeRadiusMm * 0.75));
    const facets: string[] = [];
    const vertex = (x: number, y: number, z: number) => `      vertex ${stlNum(x)} ${stlNum(y)} ${stlNum(z)}`;
    const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        facets.push(`  facet normal 0 0 0\n    outer loop\n${vertex(...a)}\n${vertex(...b)}\n${vertex(...c)}\n    endloop\n  endfacet`);
    };
    const edge = (a: [number, number], b: [number, number]) => {
        tri([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], thicknessMm]);
        tri([a[0], a[1], 0], [b[0], b[1], thicknessMm], [a[0], a[1], thicknessMm]);
    };
    let cursorX = 0;
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return;
        const bounds = partOutlineBounds(outline);
        const outlineMm = outline.map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const holesMm = landmarks
            .filter(p => pointInsideOutline(p, outline, 0.5))
            .map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const cols = Math.ceil(bounds.width / SCENE_PX_PER_MM / cellMm);
        const rows = Math.ceil(bounds.height / SCENE_PX_PER_MM / cellMm);
        const occupied = new Set<string>();
        const inside = (x: number, y: number) => pointInsideOutline({ x, y }, outlineMm, cellMm * 0.75)
            && !holesMm.some(hole => Math.hypot(x - hole.x, y - hole.y) < holeRadiusMm);
        for (let col = 0; col < cols; col += 1) {
            for (let row = 0; row < rows; row += 1) {
                const cx = (col + 0.5) * cellMm;
                const cy = (row + 0.5) * cellMm;
                if (inside(cx, cy)) occupied.add(`${col}:${row}`);
            }
        }
        const hasCell = (col: number, row: number) => occupied.has(`${col}:${row}`);
        occupied.forEach(key => {
            const [col, row] = key.split(':').map(Number);
            const x0 = cursorX + col * cellMm;
            const y0 = row * cellMm;
            const x1 = cursorX + (col + 1) * cellMm;
            const y1 = (row + 1) * cellMm;
            tri([x0, y0, thicknessMm], [x1, y0, thicknessMm], [x1, y1, thicknessMm]);
            tri([x0, y0, thicknessMm], [x1, y1, thicknessMm], [x0, y1, thicknessMm]);
            tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]);
            tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
            if (!hasCell(col - 1, row)) edge([x0, y0], [x0, y1]);
            if (!hasCell(col + 1, row)) edge([x1, y1], [x1, y0]);
            if (!hasCell(col, row - 1)) edge([x1, y0], [x0, y0]);
            if (!hasCell(col, row + 1)) edge([x0, y1], [x1, y1]);
        });
        cursorX += bounds.width / SCENE_PX_PER_MM + 12;
    });
    return `solid motionsmith_custom_parts_with_${project.settings.physicalKit.holeDiameterMm}mm_holes\n${facets.join('\n')}\nendsolid motionsmith_custom_parts\n`;
};

const makeCustomPartsPdf = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const layout = buildCharacterPrintLayout(project);
    const page = { width: 612, height: 792, margin: 38 };
    const pageScale = Math.min(page.width / kit.sheetWidthMm, page.height / kit.sheetHeightMm);
    const toPdf = (point: Point) => ({ x: point.x * pageScale, y: page.height - point.y * pageScale });
    const border = {
        x: 6 * pageScale,
        y: page.height - (kit.sheetHeightMm - 6) * pageScale,
        width: (kit.sheetWidthMm - 12) * pageScale,
        height: (kit.sheetHeightMm - 12) * pageScale
    };
    const commands: string[] = [
        `BT /F1 14 Tf ${num(page.margin)} ${num(page.height - 32)} Td (${pdfText('MotionSmith character cut sheet')}) Tj ET`,
        `BT /F1 8 Tf ${num(page.margin)} ${num(page.height - 48)} Td (${pdfText(`${project.metadata.name} / whole-character-exploded / letter page / ${kit.holeDiameterMm}mm holes`)}) Tj ET`,
        `0.86 0.89 0.94 RG 0.5 w ${num(border.x)} ${num(border.y)} ${num(border.width)} ${num(border.height)} re S`
    ];
    layout.parts.forEach(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const source = toPdf(sourceCenterMm);
        const target = toPdf(printCenterMm);
        commands.push(`0.80 0.84 0.90 RG 0.35 w ${num(source.x)} ${num(source.y)} m ${num(target.x)} ${num(target.y)} l S`);
        const mapped = outlineMm.map(toPdf);
        if (mapped.length) {
            commands.push('0.10 0.16 0.28 RG 0.97 0.98 1.00 rg 0.7 w');
            commands.push(`${num(mapped[0].x)} ${num(mapped[0].y)} m ${mapped.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} h B`);
            const label = toPdf(printCenterMm);
            commands.push(`0.29 0.33 0.43 rg BT /F1 6 Tf ${num(label.x + 5)} ${num(label.y)} Td (${pdfText(part.name)}) Tj ET`);
        }
        holeMm.forEach(point => {
            const center = toPdf(point);
            const radius = Math.max(1.2, layout.holeRadiusMm * pageScale);
            commands.push('0.10 0.16 0.28 RG 1 1 1 rg 0.5 w');
            commands.push(`${circlePath(center.x, center.y, radius)} B`);
        });
    });
    commands.push(`0.39 0.45 0.55 rg BT /F1 7 Tf ${num(page.margin)} ${num(30)} Td (${pdfText(`${layout.parts.length} parts on one letter page`)}) Tj ET`);
    return makePdfDocument(commands.join('\n'));
};


const makeExplodedStackSvg = (recipe: FabricationRecipe | undefined, esc: (value: unknown) => string) => {
    const stack = recipe ? fabricationStackForMechanism(recipe) : [];
    const base = fabricationBaseLayer();
    const fallbackLayer = (label: string, role: FabricationStackLayer['role']): FabricationStackLayer => ({ label, role, color: STACK_COLORS[role] });
    const rows = stack.length ? stack : [fallbackLayer('Back Clip', 'clip'), fallbackLayer('Input linkage', 'linkage'), fallbackLayer(FABRICATION_SPACER_SPEC.label, 'spacer'), fallbackLayer('Output linkage', 'linkage'), fallbackLayer('Front Clip', 'clip')];
    const shapeFor = (item: FabricationStackLayer, x: number, y: number) => {
        const fill = item.color;
        const stroke = item.role === 'clip' ? '#0f172a' : '#334155';
        if (item.role === 'gear' || item.role === 'cam') return `<circle cx="${x + 72}" cy="${y + 18}" r="30" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
        if (item.role === 'spacer') return `<circle cx="${x + 72}" cy="${y + 18}" r="20" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff"/>`;
        if (item.role === 'base' || item.role === 'guide') return `<rect x="${x}" y="${y}" width="180" height="36" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
        if (item.role === 'rack') return `<rect x="${x}" y="${y + 5}" width="170" height="26" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M ${x + 14} ${y + 5} ${Array.from({ length: 12 }, (_, i) => `L ${x + 24 + i * 12} ${i % 2 ? y + 5 : y - 6}`).join(' ')}" fill="none" stroke="#334155" stroke-width="2"/>`;
        return `<rect x="${x}" y="${y}" width="190" height="36" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 28}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/><circle cx="${x + 162}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
    };
    const items = rows.map((item, index) => {
        const x = 110 + index * 44;
        const y = 360 - index * 38;
        const labelX = 565;
        const labelY = 410 - index * 31;
        return `<g>
<line x1="${x + 72}" y1="${y + 18}" x2="${labelX - 22}" y2="${labelY - 4}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 8"/>
${shapeFor(item, x, y)}
	<text x="${labelX}" y="${labelY}" class="guide-label">Z+${index + 1} ${esc(fabricationPartDisplayLabel(item.label))}</text>
	<text x="${labelX}" y="${labelY + 18}" class="guide-muted">${esc(item.role)}</text>
	</g>`;
    }).join('');
    return `<svg class="exploded-guide" viewBox="0 0 900 520" role="img" aria-label="Exploded view assembly order">
<defs>
<pattern id="guide-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dbeafe" stroke-width="1"/></pattern>
<filter id="guide-shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="10" dy="14" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.14"/></filter>
</defs>
<rect width="900" height="520" rx="28" fill="#ffffff"/>
<rect width="900" height="520" fill="url(#guide-grid)" opacity="0.55"/>
<path d="M 80 462 C 230 410, 330 356, 490 382 S 660 444, 818 356" fill="none" stroke="#6366f1" stroke-width="7" stroke-linecap="round" stroke-dasharray="18 15" opacity=".62"/>
<text x="646" y="354" class="guide-blue">Path projection</text>
<g transform="translate(38 36)">
<rect width="330" height="74" rx="20" fill="#ffffff" stroke="#c7d2fe" stroke-width="2"/>
<text x="22" y="25" class="guide-title">Exploded view</text>
	<text x="22" y="47" class="guide-muted">Stack: listed low-Z board side to high-Z fastener side</text>
	<text x="22" y="64" class="guide-muted">Z=0 board · ${recipe ? esc(recipe.mechanismId) : 'pending recipe'}</text>
	</g>
	<g transform="translate(86 426)">
	<rect width="310" height="36" rx="9" fill="${base.color}" stroke="#334155" stroke-width="3"/>
	<text x="18" y="24" class="guide-muted">Z=0 ${esc(base.label)}</text>
	</g>
	<g filter="url(#guide-shadow)">${items}</g>
<line x1="92" y1="458" x2="438" y2="130" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 10"/>
<text x="70" y="486" class="guide-muted">Board-side S10 spacers lift moving parts before the fastener head.</text>
${recipe ? `<text x="40" y="505" class="guide-muted">Recipe: ${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))} · anchor ${esc(recipeBoardCallout(recipe))}</text>` : ''}
</svg>`;
};

const makeAssemblyGuideHtml = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => {
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
    const firstRecipe = recipes[0];
    const explodedSvg = makeExplodedStackSvg(firstRecipe, esc);
    const recipeSections = recipes.map(recipe => {
        const target = recipeTargetCallout(recipe);
        return `<section>
<h2>${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))}</h2>
<p><strong>Board:</strong> ${esc(recipeBoardCallout(recipe))}</p>
${target ? `<p class="target-chip"><strong>Target:</strong> ${esc(target)}</p>` : ''}
${recipe.warnings.length ? `<p><strong>Fix:</strong> ${recipe.warnings.map(esc).join('; ')}</p>` : '<p><strong>OK</strong></p>'}
<h3>Required parts</h3><ul>${recipe.requiredParts.map(part => `<li>${esc(fabricationPartDisplayLabel(part.name))} × ${part.quantity}</li>`).join('')}</ul>
<h3>15×15 board kit assembly</h3><ol class="stepper" data-testid="prefab-assembly-steps">${recipe.assemblySteps.map(step => `<li class="assembly-step" style="--i:${step.index}"><strong>${step.index}. ${esc(fabricationPartDisplayLabel(step.label))}</strong><span>${esc(fabricationPartDisplayLabel(step.instruction))}</span><em>${esc(step.role)} · ${esc(readableStepCoordinateCallout(step))} · Z ${step.zMm.toFixed(1)}mm</em></li>`).join('')}</ol>
</section>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(project.metadata.name)} assembly</title><style>
body{margin:0;background:#f8f9ff;color:#172033;font-family:Inter,Arial,sans-serif;}
.page{max-width:980px;margin:0 auto;padding:28px;}
.print-actions{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:16px;align-items:center;margin:-28px -28px 20px;padding:14px 28px;background:rgba(255,255,255,.94);border-bottom:1px solid #dbe3f0;backdrop-filter:blur(12px);}
button{border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#172033;padding:10px 16px;font-weight:800;cursor:pointer;}
h1{margin:0;font-size:40px;line-height:.98;letter-spacing:-.05em;} h2{margin:0 0 10px;font-size:24px;} h3{margin:18px 0 8px;}
.subtitle{color:#64748b;font-weight:750;}
.exploded-guide{display:block;width:100%;margin:22px 0;border:1px solid #dbe3f0;border-radius:28px;background:#fff;box-shadow:0 22px 70px rgba(15,23,42,.10);}
.guide-title{font-size:20px;font-weight:900;fill:#172033}.guide-label{font-size:18px;font-weight:900;fill:#64748b}.guide-muted{font-size:14px;font-weight:800;fill:#64748b}.guide-blue{font-size:18px;font-weight:900;fill:#4f46e5}
.warning{border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;padding:12px;margin:10px 0;font-weight:750;}
.target-chip{display:inline-flex;gap:8px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;padding:8px 12px;font-weight:850;color:#334155;}
section{break-inside:avoid;margin:18px 0;padding:20px;border:1px solid #dbe3f0;border-radius:22px;background:#fff;box-shadow:0 16px 46px rgba(15,23,42,.06);}
li{margin:.32rem 0;line-height:1.42;}
.stepper{display:grid;gap:10px;padding-left:0;list-style:none}.assembly-step{display:grid;gap:3px;border:1px solid #dbe3f0;border-radius:16px;padding:10px 12px;background:linear-gradient(135deg,#fff,#f8f9ff);animation:step-rise .8s ease both;animation-delay:calc(var(--i) * 90ms)}.assembly-step span{font-weight:750;color:#334155}.assembly-step em{font-style:normal;color:#64748b;font-weight:800;font-size:12px}@keyframes step-rise{from{opacity:.25;transform:translateY(12px)}to{opacity:1;transform:none}}
@media print{body{background:#fff}.page{max-width:none;padding:10mm}.print-actions{display:none}.exploded-guide,section{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><main class="page"><div class="print-actions"><strong>Printable assembly guide</strong><button onclick="window.print()">Print guide</button></div><h1>${esc(project.metadata.name)} assembly guide</h1><p class="subtitle">Profile ${esc(project.settings.physicalKit.profileKey)} · ${project.settings.physicalKit.gridPitchMm}mm grid · exploded view.</p>${explodedSvg}${warnings.map(w => `<p class="warning"><strong>Fix:</strong> ${esc(w)}</p>`).join('')}${recipeSections}</main></body></html>`;
};

const makeCutSheetPdf = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const page = { width: 612, height: 792, margin: 38, titleY: 760 };
    const scale = Math.min((page.width - page.margin * 2) / bounds.width, (page.height - 150) / bounds.height);
    const origin = { x: page.width / 2, y: 390 };
    const toPdf = (p: { x: number; y: number }) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale });
    const sheetLeft = origin.x + bounds.x * scale;
    const sheetBottom = origin.y + bounds.y * scale;
    const commands: string[] = [
        `BT /F1 14 Tf ${page.margin} ${page.titleY} Td (Cut sheet: ${pdfText(project.metadata.name)}) Tj ET`,
        `BT /F1 9 Tf ${page.margin} ${page.titleY - 18} Td (Profile ${pdfText(kit.profileKey)} / ${kit.gridPitchMm}mm pitch / ${kit.boardCells}x${kit.boardCells} board holes) Tj ET`,
        '0.92 0.95 1.00 rg 0.10 0.16 0.28 RG 1.1 w',
        `${num(sheetLeft)} ${num(sheetBottom)} ${num(bounds.width * scale)} ${num(bounds.height * scale)} re B`
    ];
    for (let c = 0; c < kit.boardCells; c++) {
        for (let r = 0; r < kit.boardCells; r++) {
            const recipe = recipes.find(x => x.board.valid !== false && x.board.col === c && x.board.row === r);
            const p = toPdf(boardToScene(c, r, kit));
            if (r === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 4)} ${num(p.y + 13)} Td (${pdfText(fabricationBoardColumnLabel(c))}) Tj ET`);
            if (c === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 20)} ${num(p.y - 2)} Td (${pdfText(fabricationBoardRowLabel(r))}) Tj ET`);
            commands.push(recipe ? '0.94 0.27 0.27 rg' : '0.62 0.68 0.78 rg');
            commands.push(`${circlePath(p.x, p.y, recipe ? 3.8 : 1.7)} f`);
            if (recipe) commands.push(`0.10 0.16 0.28 rg BT /F1 7 Tf ${num(p.x + 6)} ${num(p.y + 5)} Td (${pdfText(`${recipe.mechanismId} ${recipeBoardCallout(recipe)}`)}) Tj ET`);
        }
    }
    project.mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        const points = generateCurvePoints(m, 48).points.map(toPdf);
        if (points.length > 1) {
            commands.push(`${hexRgb(m.color)} RG 0.9 w`);
            commands.push(`${num(points[0].x)} ${num(points[0].y)} m ${points.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} S`);
        }
    });
    recipes.slice(0, 12).forEach((recipe, index) => {
        commands.push(`0.10 0.16 0.28 rg BT /F1 8 Tf ${page.margin} ${118 - index * 10} Td (${pdfText(`${recipe.mechanismId}: ${mechanismTypeLabel(recipe.type)} anchor ${recipeBoardCallout(recipe)}`)}) Tj ET`);
    });
    return makePdfDocument(commands.join('\n'));
};

const makeAssemblyGuidePdf = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => makeSimplePdf(
    `${project.metadata.name} Printable assembly guide`,
    [
        'Exploded view / Base board below / Clip -> Linkage or Gear -> Spacer -> Linkage -> Clip',
        `Stack: ${recipes[0] ? readableFabricationStackSummary(recipes[0]) : 'pending recipe'}`,
        'Path projection / Z=0 Base / spacer-separated moving layers',
        `Profile ${project.settings.physicalKit.profileKey} / ${project.settings.physicalKit.gridPitchMm}mm grid`,
        ...warnings.map(warning => `Warning: ${warning}`),
        ...recipes.flatMap(recipe => [
            `${recipe.mechanismId} / ${mechanismTypeLabel(recipe.type)} / anchor ${recipeBoardCallout(recipe)}`,
            `Target: ${recipeTargetCallout(recipe) || 'none'}`,
            `Required parts: ${recipe.requiredParts.map(part => `${fabricationPartDisplayLabel(part.name)} x ${part.quantity}`).join(', ')}`,
            ...recipe.assemblySteps.map(step => `Kit step ${step.index}: ${fabricationPartDisplayLabel(step.label)} / ${readableStepCoordinateCallout(step)} / Z ${step.zMm.toFixed(1)}mm`)
        ])
    ]
);

export const createFabricationPackage = (project: ProjectState): FabricationPackage => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const recipes = project.mechanisms.filter(m => m.visible && m.enabled !== false).map(m => createRecipe(project, m));
    const cutList = Array.from(
        recipes.flatMap(r => r.requiredParts).reduce((map, item) => {
            map.set(item.name, (map.get(item.name) ?? 0) + item.quantity);
            return map;
        }, new Map<string, number>())
    ).map(([name, quantity]) => ({ name, quantity }));

    const metadata = {
        projectId: project.metadata.id,
        projectName: project.metadata.name,
        createdAt: new Date().toISOString(),
        profile: project.settings.physicalKit,
        validationIssues: validation.issues,
        sceneSnapshot: { metadata: project.metadata, paths: project.paths, mechanisms: project.mechanisms },
        recipes: recipes.map(r => ({
            mechanismId: r.mechanismId,
            type: r.type,
            targetPartId: r.targetPartId,
            targetPathId: r.targetPathId,
            targetAnchorJointId: r.targetAnchorJointId,
            targetPartName: r.targetPartName,
            targetPathPointCount: r.targetPathPointCount,
            boardCoordinate: r.boardCoordinate,
            board: r.board,
            sceneAnchor: r.sceneAnchor,
            offsetFromBoardMm: r.offsetFromBoardMm,
            requiredParts: r.requiredParts,
            warnings: r.warnings,
            steps: r.steps,
            assemblySteps: r.assemblySteps
        }))
    };
    const createdAt = metadata.createdAt;
    return {
        id: `fab-${Date.now().toString(36)}`,
        createdAt,
        projectName: project.metadata.name,
        sceneSnapshot: {
            metadata: project.metadata,
            parts: project.parts,
            partOrder: project.partOrder,
            skeleton: project.skeleton,
            paths: project.paths,
            mechanisms: project.mechanisms,
            settings: project.settings
        },
        recipes,
        cutList,
        warnings: validation.warnings,
        validationIssues: validation.issues,
        svg: makeBlueprintSvg(project, recipes),
        cutSheetPdf: makeCutSheetPdf(project, recipes),
        customPartsSvg: makeCustomPartsSvg(project),
        customPartsPdf: makeCustomPartsPdf(project),
        customPartsStl: makeCustomPartsStl(project),
        assemblyGuideHtml: makeAssemblyGuideHtml(project, recipes, validation.warnings),
        assemblyGuidePdf: makeAssemblyGuidePdf(project, recipes, validation.warnings),
        metadataJson: JSON.stringify(metadata, null, 2)
    };
};

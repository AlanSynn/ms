import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { gearTrainPitchCenterDistance, gearTrainResolvedCenterDistance, gearTrainPitchRadii, generateCurvePoints } from './kinematics';
import { boardToScene, sceneToBoardRaw, sceneBoundsForSheet } from './coordinates';
import { isBoardFixedCoordRole } from './mechanismReference';
import { mechanismBindingWarnings } from './motion';
import { mechanismMatchesPathOwner } from './pathTargets';
import { makeAssemblyGuideHtml, makeAssemblyGuidePdf } from './fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
import { makeCutSheetPdf } from './fabricationCutSheetPdf';
import { makeCustomPartsPdf, makeCustomPartsStl, makeCustomPartsSvg } from './fabricationCustomParts';
import { createFabricationRecipe, prefabAssemblySteps } from './fabricationRecipes';
import { compileFabricationRecipe } from './mechanismCompiler';
import { primaryFoundryPlaybackPath } from './foundryPlayback';
import {
    sampleFeasibleRange,
} from './fabricationReadiness';
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';
import {
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';
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
export { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';
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
export { createFabricationRecipe, prefabAssemblySteps } from './fabricationRecipes';

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
    const isValidBoardCoordinate = (coord: string | undefined) => /^[A-O](?:[1-9]|1[0-5])$/.test(coord ?? '');
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
        validateMechanismPreviewReadiness(m).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose ready template' }));
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if ((!m.targetPartId && !m.targetSceneObjectId) || !m.targetPathId) add('error', `${m.id}: choose target + path.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target + path' });
        if (m.targetPartId && !project.parts[m.targetPartId]) add('error', `${m.id}: missing target part ${m.targetPartId}.`, { mechanismId: m.id, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose existing part' });
        if (m.targetSceneObjectId && !project.sceneObjects[m.targetSceneObjectId]) add('error', `${m.id}: missing target object ${m.targetSceneObjectId}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose existing object' });
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add('error', `${m.id}: missing path ${m.targetPathId}.`, { mechanismId: m.id, pathId: m.targetPathId, recoveryStage: 'path', recoveryAction: 'Choose valid path' });
            else if (!mechanismMatchesPathOwner(m, path, project)) add('error', `${m.id}: path belongs to ${path.sceneObjectId ?? path.partId}.`, { mechanismId: m.id, pathId: m.targetPathId, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
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
        if (m.type === 'cam' && project.settings.physicalKit.boardCells !== 15) {
            add('error', `${m.id}: cam module needs 15x15 board.`, { mechanismId: m.id, recoveryStage: 'blueprint', recoveryAction: 'Use 15x15 kit' });
        }
        if (!Number.isFinite(m.anchorX) || !Number.isFinite(m.anchorY)) {
            add('error', `${m.id}: missing board anchor.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Drag to board' });
            return;
        }
        const board = sceneToBoardRaw({ x: m.anchorX!, y: m.anchorY! }, project.settings.physicalKit);
        const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : null;
        let placementHasIssue = false;
        if (!board.valid) {
            add(fabricationSeverity, `${m.id}: off board at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move onto board' });
            placementHasIssue = true;
        }
        else if (boardScene && Math.hypot(boardScene.x - m.anchorX!, boardScene.y - m.anchorY!) > snapTolerance) {
            add(fabricationSeverity, `${m.id}: anchor off grid at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Snap to hole' });
            placementHasIssue = true;
        }
        else if (board.col <= 0 || board.row <= 0 || board.col >= project.settings.physicalKit.boardCells - 1 || board.row >= project.settings.physicalKit.boardCells - 1) {
            add('warning', `${m.id}: near board edge ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
        }
        if (board.valid) {
            const offBoardStep = prefabAssemblySteps(m, board.label).find(step => (step.coords ?? []).some((coord, index) =>
                isBoardFixedCoordRole(step.coordRoles?.[index] ?? '') && !isValidBoardCoordinate(coord)
            ));
            if (offBoardStep) {
                add('error', `${m.id}: assembly holes off board near ${offBoardStep.boardCoordinate}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
                placementHasIssue = true;
            }
        }
        const path = m.type === 'planetary_gear'
            ? primaryFoundryPlaybackPath(m, 72)
            : generateCurvePoints(m, 72).points;
        if (!placementHasIssue && path.some(p => !insideSheet(p))) add('error', `${m.id}: path outside sheet.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Resize or move' });
    });
    return { warnings, errors, issues };
};

export const createFabricationPackage = (project: ProjectState): FabricationPackage => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const recipes = project.mechanisms.filter(m => m.visible && m.enabled !== false).map(m => compileFabricationRecipe(project, m));
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
        sceneSnapshot: {
            metadata: project.metadata,
            paths: project.paths,
            mechanisms: project.mechanisms,
            sceneObjects: project.sceneObjects,
            sceneObjectOrder: project.sceneObjectOrder
        },
        recipes: recipes.map(r => ({
            mechanismId: r.mechanismId,
            type: r.type,
            targetPartId: r.targetPartId,
            targetSceneObjectId: r.targetSceneObjectId,
            targetPathId: r.targetPathId,
            targetAnchorJointId: r.targetAnchorJointId,
            targetPartName: r.targetPartName,
            targetSceneObjectName: r.targetSceneObjectName,
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
            sceneObjects: project.sceneObjects,
            sceneObjectOrder: project.sceneObjectOrder,
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

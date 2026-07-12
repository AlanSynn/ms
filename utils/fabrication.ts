import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { gearTrainPitchCenterDistance, gearTrainResolvedCenterDistance, gearTrainPitchRadii, generateCurvePoints } from './kinematics';
import { boardToScene, isBoardCoordinateInKit, sceneToBoardRaw, sceneBoundsForSheet } from './coordinates';
import { isBoardFixedCoordRole } from './mechanismReference';
import { mechanismBindingWarnings } from './motion';
import { mechanismMatchesPathOwner } from './pathTargets';
import { makeAssemblyGuideHtml, makeAssemblyGuidePdf } from './fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
import { makeCutSheetPdf } from './fabricationCutSheetPdf';
import { makeCustomPartsPdf, makeCustomPartsStl, makeCustomPartsSvg } from './fabricationCustomParts';
import { compileFabricationRecipe, compileMechanismGraphFabrication } from './mechanismCompiler';
import { primaryFoundryPlaybackPath } from './foundryPlayback';
import {
    sampleFeasibleRange,
} from './fabricationReadiness';
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';
import {
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';
import { buildMechanismSceneContracts } from './mechanismSceneContract';
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
export type { FabricationRenderKind, FabricationRenderLayer, FabricationRenderPlan, PhysicalZMm, PackedFabricationLayer, CompiledSupportPath, PinSpanMm } from './mechanismFabricationZStack';
export {
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';
export {
    FABRICATION_RENDER_BASE_Z,
    FABRICATION_RENDER_LAYER_Z_STEP,
    FABRICATION_RENDER_MIN_CLEARANCE,
    FABRICATION_RENDER_PART_DEPTH,
    FABRICATION_Z_RENDER_UNITS_PER_MM,
    FABRICATION_Z_EPSILON_MM,
    BOARD_DEPTH_MM,
    PLATE_DEPTH_MM,
    SPACER_DEPTH_MM,
    CLIP_HEAD_DEPTH_MM,
    FASTENER_TAB_DEPTH_MM,
    PIN_BACK_TERMINAL_MM,
    PIN_FRONT_TERMINAL_MM,
    projectFabricationZMm,
    unprojectFabricationZ
} from './mechanismFabricationZStack';

export { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
export {
    fabricationRecipeClassroomCue,
    fabricationRecipeSensemakingType,
    fabricationRecipeStackSummary,
    fabricationRecipeTitle,
    mechanismTypeLabel
} from './fabricationRecipes';

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

export const fabricationIssueKey = (issue: Pick<FabricationIssue, 'severity' | 'message' | 'mechanismId' | 'partId' | 'pathId'>) =>
    [issue.severity, issue.message, issue.mechanismId ?? '', issue.partId ?? '', issue.pathId ?? ''].join('|');

export const fabricationVisibleIssueKey = (issue: Pick<FabricationIssue, 'severity' | 'message'>) =>
    `${issue.severity}|${issue.message}`;

export const newFabricationIssues = (baseline: FabricationIssue[], candidate: FabricationIssue[]) => {
    const baselineKeys = new Set(baseline.map(fabricationIssueKey));
    return candidate.filter(issue => !baselineKeys.has(fabricationIssueKey(issue)));
};

export const visibleFabricationMessages = (issues: FabricationIssue[], severity: FabricationIssue['severity']) => {
    const seen = new Set<string>();
    return issues.flatMap(issue => {
        if (issue.severity !== severity) return [];
        const key = fabricationVisibleIssueKey(issue);
        if (seen.has(key)) return [];
        seen.add(key);
        return [issue.message];
    });
};

export const validateForFabrication = (project: ProjectState) => {
    const issues: FabricationIssue[] = [];
    const issueKeys = new Set<string>();
    const add = (severity: FabricationIssue['severity'], message: string, extra: Partial<FabricationIssue> = {}) => {
        const issue: FabricationIssue = { severity, message, recoveryStage: severity === 'error' ? 'design' : 'blueprint', recoveryAction: 'Review item', ...extra };
        const key = fabricationIssueKey(issue);
        if (issueKeys.has(key)) return;
        issueKeys.add(key);
        issues.push(issue);
    };
    const sheet = sceneBoundsForSheet(project.settings.physicalKit);
    const snapTolerance = project.settings.physicsSnapMode === 'fast' ? 4 : project.settings.physicsSnapMode === 'high' ? 0.25 : 0.5;
    const fabricationSeverity: FabricationIssue['severity'] = project.settings.fabricationReadyMode ? 'error' : 'warning';
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    const isValidBoardCoordinate = (coord: string | undefined) => isBoardCoordinateInKit(coord, project.settings.physicalKit);
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
        if (corners.some(p => !insideSheet(p))) add('warning', 'Move: visible part outside sheet.', { partId, recoveryStage: 'path', recoveryAction: 'Move part inside sheet' });
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
        if (corners.some(p => !insideSheet(p))) add('warning', 'Move: visible object outside sheet.', { recoveryStage: 'character', recoveryAction: 'Move object inside sheet' });
    });
    activeMechanisms.forEach(m => {
        validateMechanismPreviewReadiness(m, project.settings.physicalKit).forEach(message => add('error', message, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose ready template' }));
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', message, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if ((!m.targetPartId && !m.targetSceneObjectId) || !m.targetPathId) add('error', 'Fix: choose target + path.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target + path' });
        if (m.targetPartId && !project.parts[m.targetPartId]) add('error', 'Fix: choose existing part.', { mechanismId: m.id, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose existing part' });
        if (m.targetSceneObjectId && !project.sceneObjects[m.targetSceneObjectId]) add('error', 'Fix: choose existing object.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose existing object' });
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add('error', 'Fix: choose valid path.', { mechanismId: m.id, pathId: m.targetPathId, recoveryStage: 'path', recoveryAction: 'Choose valid path' });
            else if (!mechanismMatchesPathOwner(m, path, project)) add('error', 'Fix: rebind target path.', { mechanismId: m.id, pathId: m.targetPathId, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
        }
        const physicalNumbers = [m.crankLength, m.couplerLength, m.groundLength, m.rockerLength, m.sliderOffset, m.couplerPointDist, m.couplerPointAngle];
        if (m.type === '5bar' || m.type === '6bar' || m.type === 'piston') physicalNumbers.push(m.rodLength ?? Number.NaN);
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') physicalNumbers.push(m.gearRatio ?? Number.NaN, m.speed2 ?? Number.NaN);
        if (!physicalNumbers.every(Number.isFinite)) add('error', 'Fix: bad dimension.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Fix dimensions' });
        if ((m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') && (m.gearRatio ?? 0) === 0) add('error', 'Fix: choose non-zero ratio.', { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose non-zero ratio' });
        if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') {
            const expectedCenterDistance = m.type === 'gear'
                ? gearTrainPitchCenterDistance(m)
                : m.type === 'gear_linkage'
                    ? gearTrainResolvedCenterDistance(m)
                    : m.crankLength + m.rockerLength;
            if (Math.abs(m.groundLength - expectedCenterDistance) > Math.max(1, expectedCenterDistance * 0.03)) {
                add(fabricationSeverity, 'Fix: snap gear pitch.', { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Snap gear pitch' });
            }
        }
        if (m.type === 'rack-pinion' && Math.abs(m.sliderOffset) < Math.max(2, m.crankLength * 0.8)) add('warning', 'Move: rack guide too close.', { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Move rack guide' });
        if (m.type === 'rack-pinion' && m.rockerLength < m.crankLength * (2 * Math.PI + 2)) add(fabricationSeverity, 'Fix: lengthen rack.', { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Lengthen rack' });
        const range = sampleFeasibleRange(m);
        if (range.warning?.startsWith('No motion')) add('error', `${range.warning}.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Adjust' });
        else if (range.warning) add('warning', range.warning, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Review partial motion' });
        if (!Number.isFinite(m.anchorX) || !Number.isFinite(m.anchorY)) {
            add('error', 'Fix: missing board anchor.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Drag to board' });
            return;
        }
        const board = sceneToBoardRaw({ x: m.anchorX!, y: m.anchorY! }, project.settings.physicalKit);
        const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : null;
        let placementHasIssue = false;
        if (!board.valid) {
            add(fabricationSeverity, `Move: anchor off board at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move onto board' });
            placementHasIssue = true;
        }
        else if (boardScene && Math.hypot(boardScene.x - m.anchorX!, boardScene.y - m.anchorY!) > snapTolerance) {
            add(fabricationSeverity, `Fix: anchor off grid at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Snap to hole' });
            placementHasIssue = true;
        }
        else if (board.col <= 0 || board.row <= 0 || board.col >= project.settings.physicalKit.boardCells - 1 || board.row >= project.settings.physicalKit.boardCells - 1) {
            add('warning', `Move: near board edge ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
        }
        if (board.valid) {
            const graphFabrication = compileMechanismGraphFabrication(m, project.settings.physicalKit);
            if (!graphFabrication.recipe) {
                const graphBlocker = graphFabrication.blocker;
                if (!graphBlocker) {
                    add('error', 'Fix: report build blocker.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Report bug' });
                }
                else {
                    const message = graphBlocker === 'Placement off board'
                        ? `Move: assembly holes off board near ${board.label}.`
                        : `Fix: ${graphBlocker}.`;
                    add(fabricationSeverity, message, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: graphBlocker === 'Placement off board' ? 'Move inward' : 'Choose ready template' });
                }
                placementHasIssue = true;
            }
            const offBoardStep = graphFabrication.recipe?.assemblySteps.find(step => (step.coords ?? []).some((coord, index) =>
                isBoardFixedCoordRole(step.coordRoles?.[index] ?? '') && !isValidBoardCoordinate(coord)
            ));
            if (offBoardStep) {
                add('error', `Move: assembly holes off board near ${offBoardStep.boardCoordinate}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move inward' });
                placementHasIssue = true;
            }
        }
        const path = m.type === 'planetary_gear'
            ? primaryFoundryPlaybackPath(m, 72)
            : generateCurvePoints(m, 72).points;
        if (!placementHasIssue && path.some(p => !insideSheet(p))) add('error', 'Move or resize: path outside sheet.', { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Resize or move' });
    });
    return {
        warnings: visibleFabricationMessages(issues, 'warning'),
        errors: visibleFabricationMessages(issues, 'error'),
        issues,
    };
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
    const mechanismSceneContracts = buildMechanismSceneContracts(project, recipes);

    const metadata = {
        projectId: project.metadata.id,
        projectName: project.metadata.name,
        createdAt: new Date().toISOString(),
        profile: project.settings.physicalKit,
        validationIssues: validation.issues,
        mechanismSceneContracts,
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

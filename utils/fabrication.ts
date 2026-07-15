import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { sceneBoundsForSheet } from './coordinates';
import { makeAssemblyGuideHtml, makeAssemblyGuidePdf } from './fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
import { makeCutSheetPdf } from './fabricationCutSheetPdf';
import { makeCustomPartsPdf, makeCustomPartsStl, makeCustomPartsSvg } from './fabricationCustomParts';
import { compileFabricationRecipe } from './mechanismCompiler';
import {
    sampleFeasibleRange,
    isSoftReadinessBlocker,
} from './fabricationReadiness';
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';
import {
    fabricationRenderPlanForMechanism,
    validateFabricationStack
} from './fabricationRenderPlan';
import { buildMechanismSceneContracts } from './mechanismSceneContract';
import { projectMechanismReadiness } from './mechanismReadiness';
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

export type FabricationValidationOptions = {
    allowSoftReadinessBlockers?: boolean;
};

export const validateForFabrication = (
    project: ProjectState,
    options: FabricationValidationOptions = {},
) => {
    const { allowSoftReadinessBlockers = false } = options;
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
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    if (!project.partOrder.length) add('error', 'No character in scene.', { recoveryStage: 'character', recoveryAction: 'Load a character package' });
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
    const readiness = projectMechanismReadiness(project);
    readiness.blockers.forEach(message => {
        const mechanism = readiness.mechanisms.find(result => message.startsWith(`${result.mechanismId}: `));
        const compactMessage = message;
        const severity = allowSoftReadinessBlockers && isSoftReadinessBlocker(compactMessage)
            ? 'warning'
            : 'error';
        add(severity, compactMessage, {
            recoveryStage: mechanism?.status === 'fabrication-unsupported' ? 'foundry' : 'design',
            recoveryAction: mechanism?.status === 'fabrication-unsupported' ? 'Choose ready template' : 'Fix mechanism',
            mechanismId: mechanism?.mechanismId,
        });
    });
    return {
        warnings: visibleFabricationMessages(issues, 'warning'),
        errors: visibleFabricationMessages(issues, 'error'),
        issues,
        readiness,
    };
};

export const createFabricationPackage = (
    project: ProjectState,
    options: FabricationValidationOptions = {},
): FabricationPackage => {
    const validation = validateForFabrication(project, options);
    const allowSoftReadinessBlockers = options.allowSoftReadinessBlockers === true;
    const canProceed = validation.readiness.status === 'project-ready'
        || (allowSoftReadinessBlockers && validation.readiness.blockers.every((blocker) => isSoftReadinessBlocker(blocker)));
    const { readiness } = validation;
    if (!canProceed || validation.errors.length) throw new Error(validation.errors.join('\n') || readiness.blockers.join('\n'));
    const readyIds = new Set(readiness.activeMechanismIds);
    const recipes = project.mechanisms.filter(m => readyIds.has(m.id)).map(m => compileFabricationRecipe(project, m));
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

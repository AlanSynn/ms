import type { FabricationPackage, ProjectState } from '../types';
import { createBuildPlanV1, createCharacterBuildPlanV1, type BuildPlanLaneV1 } from './buildPlan';
import { makeAssemblyGuideHtmlFromBuildPlan, makeAssemblyGuidePdfFromBuildPlan } from './fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg';
import { makeBlueprintPdfFromBuildPlan } from './fabricationBlueprintPdf';
import { makeCharacterTemplatePdfFromBuildPlan, makeCustomPartsStl, makeCustomPartsSvg } from './fabricationCustomParts';
import { createFabricationRecipe } from './fabricationRecipes';
import { projectContentFingerprint } from './projectSerialization';
import { characterFabricationOutlineIssues } from './fabricationOutlineIssues';
import { validateForFabrication } from './fabricationValidation';
export { validateForFabrication, validateMechanismPreviewReadiness, mechanismBoardPlacementIssues, mechanismBoardPlacementErrors } from './fabricationValidation';
export type { MechanismBoardPlacementIssue } from './fabricationValidation';
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
export type { FabricationFeasibleRange, FabricationFeasibilityStatus } from './fabricationReadiness';
export { feasibilityLabelForStatus, feasibilityStatusForRange, sampleFeasibleRange } from './fabricationReadiness';
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
export {
    createFabricationRecipe,
    prefabAssemblySteps
} from './fabricationRecipes';
export { boardFixedAssemblyCoordinatesForMechanism, isBoardCoordinateWithin, offBoardFixedAssemblyCoordinatesForMechanism } from './boardHoleConstraints';

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

export type FabricationPackageOptions = {
    includeCustomPartsStl?: boolean;
    lane?: BuildPlanLaneV1;
    sourceProjectFingerprint?: string;
};

export const createCustomPartsStlArtifact = (project: ProjectState): string => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    if (!project.partOrder.some(id => project.parts[id]?.visible)) throw new Error('No character parts for STL. Use Cut pieces SVG.');
    return makeCustomPartsStl(project);
};

export const createCharacterTemplateArtifact = (
    project: ProjectState,
    sourceProjectFingerprint = projectContentFingerprint(project)
) => {
    const outlineIssues = characterFabricationOutlineIssues(project);
    if (outlineIssues.length) throw new Error(outlineIssues.map(issue => issue.message).join('\n'));
    const buildPlan = createCharacterBuildPlanV1(project);
    if (!buildPlan.character.parts.length) throw new Error('No character template available.');
    return {
        characterTemplatePdf: makeCharacterTemplatePdfFromBuildPlan(
            buildPlan,
            sourceProjectFingerprint
        ),
        characterTemplateSvg: makeCustomPartsSvg(project),
        buildPlanSourceDigest: buildPlan.sourceDigest,
        sourceProjectFingerprint
    };
};

export const createFabricationPackage = (
    project: ProjectState,
    options: FabricationPackageOptions = {}
): FabricationPackage => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const recipes = project.mechanisms.filter(m => m.visible && m.enabled !== false).map(m => createFabricationRecipe(project, m));
    const sourceProjectFingerprint = options.sourceProjectFingerprint ?? projectContentFingerprint(project);
    const buildPlan = createBuildPlanV1(project, {
        lane: options.lane,
        recipes,
        warnings: validation.warnings
    });
    const characterBuildPlan = createCharacterBuildPlanV1(project, { lane: options.lane });
    const characterTemplatePdf = makeCharacterTemplatePdfFromBuildPlan(
        characterBuildPlan,
        sourceProjectFingerprint
    );
    const cutList = Array.from(
        [...recipes.flatMap(r => r.requiredParts), ...buildPlan.parts.filter(part => part.kind === 'object')].reduce((map, item) => {
            map.set(item.name, (map.get(item.name) ?? 0) + item.quantity);
            return map;
        }, new Map<string, number>())
    ).map(([name, quantity]) => ({ name, quantity }));
    const metadataSceneObjects = Object.fromEntries(
        Object.entries(project.sceneObjects).map(([id, sceneObject]) => {
            const { textureUrl: _textureUrl, artwork: _artwork, ...metadataSceneObject } = sceneObject;
            return [id, metadataSceneObject];
        })
    );

    const metadata = {
        projectId: project.metadata.id,
        projectName: project.metadata.name,
        createdAt: new Date().toISOString(),
        sourceProjectFingerprint,
        buildPlanSourceDigest: buildPlan.sourceDigest,
        characterBuildPlanSourceDigest: characterBuildPlan.sourceDigest,
        buildPlan,
        characterBuildPlan,
        profile: project.settings.physicalKit,
        validationIssues: validation.issues,
        sceneSnapshot: {
            metadata: project.metadata,
            paths: project.paths,
            mechanisms: project.mechanisms,
            sceneObjects: metadataSceneObjects,
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
            outputBindings: r.outputBindings,
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
    const blueprintPdf = makeBlueprintPdfFromBuildPlan(buildPlan);
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
        cutSheetPdf: '',
        customPartsSvg: makeCustomPartsSvg(project),
        customPartsPdf: characterTemplatePdf,
        customPartsStl: options.includeCustomPartsStl ? makeCustomPartsStl(project) : '',
        assemblyGuideHtml: makeAssemblyGuideHtmlFromBuildPlan(buildPlan),
        assemblyGuidePdf: makeAssemblyGuidePdfFromBuildPlan(buildPlan),
        blueprintPdf,
        buildPacketPdf: undefined,
        characterTemplatePdf,
        buildPlanSourceDigest: buildPlan.sourceDigest,
        characterBuildPlanSourceDigest: characterBuildPlan.sourceDigest,
        buildPlanLane: buildPlan.lane,
        buildPlanJson: JSON.stringify(buildPlan),
        sourceProjectFingerprint,
        metadataJson: JSON.stringify(metadata, null, 2)
    };
};

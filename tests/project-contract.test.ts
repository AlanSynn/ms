import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import * as THREE from 'three';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { boardCoordinateLabel, boardGridLines, boardToScene, bodyPartPivotScene, isBoardCoordinateInKit, physicalKitPreset, placeBodyPartPivotAt, SCENE_PX_PER_MM, SCENE_VIEW, sceneToBoard, sceneToBoardRaw, sceneToSheetMm, sceneToSvg, sheetMmToScene } from '../utils/coordinates';
import { CLASSROOM_LESSONS, classroomLessonById, createDefaultMechanism, createDefaultSceneObject, createEmptyProject, createLessonProject, createSampleProject, handoffGate, loadProjectSnapshot, serializeProject, applyProjectAction, projectSelfCheck, mechanismRequiredParts, mechanismWithGeneratedPath, replaceCharacterProject, resetProjectToLessonBaseline } from '../utils/project';
import { createFabricationPackage, newFabricationIssues, FABRICATION_GEAR_SPECS, FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_ROLE_MIN_HOLES, FABRICATION_LINKAGE_SPECS, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_RENDER_LAYER_Z_STEP, FABRICATION_RENDER_MIN_CLEARANCE, FABRICATION_RENDER_PART_DEPTH, FABRICATION_Z_EPSILON_MM, BOARD_DEPTH_MM, PLATE_DEPTH_MM, SPACER_DEPTH_MM, CLIP_HEAD_DEPTH_MM, projectFabricationZMm, FABRICATION_RING_GEAR_SPEC, FABRICATION_SOURCE_SSOT, FABRICATION_SPACER_SPEC, PLANETARY_GEAR_PLANET_COUNT, fabricationBoardColumnLabel, fabricationBoardCoordinateCallout, fabricationBoardRowLabel, fabricationGearPathD, fabricationGearProfileForPitchRadius, fabricationGearSpecForPitchRadius, fabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism, fabricationLinkageSpecForCells, fabricationLinkageSpecForSceneLength, fabricationPartDisplayLabel, fabricationRecipeStackSummary, makeBlueprintPreviewSvg, makeBlueprintSvg, fabricationRingGearPathD, fabricationRingGearProfileForPitchRadius, fabricationRenderPlanForMechanism, fabricationStackForMechanism, fabricationStackSummary, planetaryGearConventionForMechanism, planetaryPlanetCenters, readableFabricationStackSummary, sampleFeasibleRange, validateFabricationStack, validateForFabrication, validateMechanismPreviewReadiness } from '../utils/fabrication';
import { FABRICATION_BOARD_GENERATOR } from '../utils/fabricationBoardTemplate';
import { FABRICATION_GEAR_ROOT_WEB_MM, fabricationGearEngravingLabel, fabricationLinkageEngravingLabel, fabricationRingGearEngravingLabel, fabricationSpacerEngravingLabel } from '../utils/fabricationContract';
import { makeAssemblyGuideHtml as directMakeAssemblyGuideHtml, makeAssemblyGuidePdf as directMakeAssemblyGuidePdf } from '../utils/fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg as directMakeBlueprintPreviewSvg, makeBlueprintSvg as directMakeBlueprintSvg } from '../utils/fabricationBlueprintSvg';
import { buildCharacterPrintLayout as directBuildCharacterPrintLayout } from '../utils/fabricationCharacterPrintLayout';
import { makeCutSheetPdf as directMakeCutSheetPdf } from '../utils/fabricationCutSheetPdf';
import { makeCustomPartsPdf as directMakeCustomPartsPdf, makeCustomPartsStl as directMakeCustomPartsStl, makeCustomPartsSvg as directMakeCustomPartsSvg } from '../utils/fabricationCustomParts';
import { fabricationGearPathD as profileFabricationGearPathD, fabricationGearProfileForPitchRadius as profileFabricationGearProfileForPitchRadius, fabricationRingGearPathD as profileFabricationRingGearPathD, fabricationRingGearProfileForPitchRadius as profileFabricationRingGearProfileForPitchRadius } from '../utils/fabricationProfiles';
import { compileAuthoredMechanismGraph, compileFabricationRecipe, compileMechanism, compileMechanismGraphFabrication, compileMechanismRenderPlan, summarizeCompiledMechanism } from '../utils/mechanismCompiler';
import { CONNECTION_SELECTION_ROLES, authorMechanismConnectionSelection, connectionSelectionAccepted, connectionSelectionSceneCoordinates, connectionSelectionSignature, mechanismConnectionHoleCandidates, normalizeMechanismConnectionSelections, resolveFourBarConnectionSelections, resolveFourBarLinkageBlankPoses, resolveMechanismPhysicalConnections, type ResolvedPhysicalConnection } from '../utils/mechanismConnectionSelections';
import { mechanismInventoryForMechanism } from '../utils/mechanismInventory';
import { closePhysicalValue as readinessClosePhysicalValue, closeToBoardPitch as readinessCloseToBoardPitch, closeToFabricationLinkage as readinessCloseToFabricationLinkage, compactStudentActionForFabricationDiagnostic, physicalTolerance as readinessPhysicalTolerance, sampleFeasibleRange as readinessSampleFeasibleRange } from '../utils/fabricationReadiness';
import { FABRICATION_RENDER_LAYER_Z_STEP as renderPlanLayerZStep, FABRICATION_RENDER_MIN_CLEARANCE as renderPlanMinClearance, FABRICATION_RENDER_PART_DEPTH as renderPlanPartDepth, fabricationRenderPlanForMechanism as renderPlanForMechanism, validateFabricationStack as renderPlanValidateFabricationStack } from '../utils/fabricationRenderPlan';
import { FABRICATION_LINKAGE_ROLE_MIN_HOLES as sizingRoleMinHoles, PLANETARY_GEAR_PLANET_COUNT as sizingPlanetCount, fabricationLinkageHoleCountsForMechanism as sizingFabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism as sizingFabricationLinkageSceneLengthsForMechanism, planetaryGearConventionForMechanism as sizingPlanetaryGearConventionForMechanism, planetaryPlanetCenters as sizingPlanetaryPlanetCenters } from '../utils/fabricationSizing';
import { fabricationLinkageSpecForSceneLength as stackModelFabricationLinkageSpecForSceneLength, fabricationStackForMechanism as stackModelFabricationStackForMechanism, fabricationStackSummary as stackModelFabricationStackSummary, readableFabricationStackSummary as stackModelReadableFabricationStackSummary } from '../utils/fabricationStackModel';
import { circlePath as simplePdfCirclePath, hexRgb as simplePdfHexRgb, makePdfDocument as simplePdfDocument, makeSimplePdf as simplePdfMakeSimplePdf, num as simplePdfNum, pdfText as simplePdfEscapeText } from '../utils/simplePdf';
import { generateLowLevelMechanismDXF, generateLowLevelMechanismSVG } from '../utils/exporter';
import { createProjectFromPackageData, parseCharConfig } from '../utils/packageLoader';
import { animationDeltaRadians, calculateLinkage, camFollowerConstraintError, camFollowerRise, camProfileScale, gearPairOutputRatio, gearTrainMeshPhaseDegAt, gearTrainMeshPhaseRadAt, gearTrainOutputRatio, gearTrainCenters, gearTrainPitchCenterDistance, gearTrainPitchRadii, gearTrainResolvedCenterDistance, gearTrainRotationRatioAt, generateCurvePoints, generateMechanismPointTraces, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, planetaryRingPitchRadius, sampledCamProfileScale } from '../utils/kinematics';
import { animatedPartsForProject, describeMotionChain, mechanismBindingWarnings, mechanismDriverIdentity, motionAnchorJointIds, motionChainRootJointIds, motionPreviewForPath, motionPreviewForProject, motionPreviewForTarget, pointOnGeneratedMechanismPath, pointOnProjectPath, preferredMotionJointId } from '../utils/motion';
import { buildCutBaseViewport, clientPointToCutPoint, panCutViewport, zoomCutViewport, type CutFrame } from '../utils/cutEditorViewport';
import { addDrawSamplePoint, normalizeDrawTimedPoints } from '../utils/pathDrawing';
import { buildToonSceneProjection } from '../utils/sceneProjection';
import { buildFoundryPhysicsOverlay, buildKinematicPhysicsSession, mechanismPhysicsRule } from '../utils/physicsSession';
import { contourPathD, fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints, partOutlineBounds, partWorldPointToLocal, pointInsideOutline, scaleContour } from '../utils/partGeometry';
import { MECHANISM_FEATURE_REGISTRY, mechanismFeature, validateMechanismFeatureRegistry, type MechanismDragHandle } from '../utils/mechanismFeatureRegistry';
import { MECHANISM_PARAM_META, MECHANISM_FEASIBILITY_AUTHORITY_KEYS, MECHANISM_NON_FEASIBILITY_EDIT_KEYS, MECHANISM_REPLACEMENT_ONLY_KEYS, constrainMechanismCommit, constrainMechanismUpdate, mechanismEditIsSafe, mechanismMotionCompletes, mechanismParamIsPlacementRecoveryEditable, mechanismUpdateRequiresReplacement, motionSafeParamRange, safeMechanismUpdate } from '../utils/mechanismEditAuthority';
import { buildMechanismSnapshot, buildMechanismSnapshots, mechanismSnapshotFingerprint } from '../utils/mechanismSnapshot';
import { createFoundryPlaybackFrame, foundryPlaybackPhaseToInputAngle, generateFoundryPlaybackPointTraces, primaryFoundryPlaybackPath } from '../utils/foundryPlayback';
import { foundryPinStackPoints, foundryPinStacks, foundryRenderedLayerZForMechanism } from '../utils/mechanismPreviewStacks';
import { createMechanismFitContext, createSceneMechanismFitContext, fitMechanismSimulation, fitMechanismSimulationWithContext, pointsToSvgPath } from '../utils/mechanismPreview';
import { buildMechanismRecommendations, fitMechanismToTargetPath, fitRecommendedMechanismToSheet } from '../utils/mechanismRecommendations';
import { foundryPreviewFromProject } from '../utils/mechanismDefaults';
import { assessMechanismTargetBinding, pathBelongsToTarget, pathOwnedTargetFields } from '../utils/pathTargets';
import { resolveMechanismRuntimeGate } from '../utils/mechanismRuntimePolicy';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { buildDesignAutomataProjection } from '../utils/designAutomataProjection';
import { WEBGL_PIXEL_RATIO_CAP, canvasPanOffset, canvasViewBoxForViewport, zoomCanvasViewportAtPoint } from '../utils/viewport';
import { cachedThreeResource, clearThreeGroup, disposeThreeObjectGraph, setRendererPixelRatioCap } from '../utils/threeResourceKit';
import { APP_COMMANDS, APP_MENU_GROUPS, commandById, commandIdForKeyboardEvent, validateAppCommandRegistry } from '../utils/appCommands';
import { compareSvgContours, svgContourSignature } from '../scripts/fabrication/svg-contour';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_KERNEL_IMPORT, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, physicsKernelCapability, runRapierFrictionProbe } from '../utils/physicsKernel';
import { formatGridLabel, formatGridPitch, formatGridReadout } from '../utils/units';
import { buildAssemblyPlaybackSteps, buildCharacterAssemblyPlan, pendingRecipeForMechanism, type CharacterAssemblyPlan } from '../utils/assemblyPlayback';
import { buildCharacterAssemblySceneFrame, buildMechanismAssemblySceneFrame } from '../utils/assemblySceneFrame';
import { buildLowLevelMechanismSceneContract, buildMechanismSceneContracts, buildProjectMechanismSceneContract } from '../utils/mechanismSceneContract';
import { createFoundryThreePrimitiveFactory, disposeFoundryThreeObject } from '../components/stages/foundry/foundryThreePrimitives';
import { renderFoundryDynamicLayers } from '../components/stages/foundry/foundryThreeRenderLayers';
import { fittedGearTrainCenters } from '../components/stages/foundry/foundryPreviewGeometry';
import { MECHANISM_GRAPH_ADAPTER_TYPES, MECHANISM_GRAPH_LIVE_SOLVE_BUDGET_MS, mechanismGraphForMechanism, mechanismGraphFromDraft, sampleMechanismGraphMotion, validateMechanismGraph, type MechanismGraph } from '../utils/mechanismGraph';
import { buildAssemblyGuideModel } from '../components/stages/assembly/assemblyGuideModel';
import { selectBlueprintRecipe } from '../components/stages/blueprint/BlueprintExport';
import { BlueprintControlPanel } from '../components/stages/blueprint/BlueprintControlPanel';
import { MechanismLinkagePreview } from '../components/stages/foundry/MechanismLinkagePreview';
import { FoundryInspectorPanel } from '../components/stages/foundry/FoundryInspectorPanel';
import { FoundryWorkflowPanel } from '../components/stages/foundry/FoundryWorkflowPanel';
import { MechanismParametricEditor } from '../components/stages/mechanism/MechanismParametricEditor';
import { MechanismRecommendationSheet } from '../components/stages/path/MechanismRecommendationSheet';
import { useAppMechanismActions } from '../hooks/useAppMechanismActions';
import { createStageNavigator, navigateAppStage } from '../utils/appStageNavigation';
import { assemblyCoordToSvg, characterBoardProjector, characterCanvasProjector, smoothAssemblyProgress, svgPathFromPoints } from '../components/stages/assembly/assemblyGeometry';
import { smoothTrackingPoints, trackingPointsToWorldPath } from '../utils/trackingPath';
import { ALL_MECHANISM_TYPES, AUTHORABLE_MECHANISM_TYPES, FOUNDRY_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY, mechanismTemplateLabel } from '../utils/mechanismTemplates';
import { CLASSROOM_ASSESSMENT_KEYS, CLASSROOM_COPY, classroomAssessmentFor, classroomAssessmentKeyFromSearch, classroomAssessmentKeyHint, classroomAssessmentStatusText, classroomCueTitleFor, classroomUseExampleFor, DEFAULT_CLASSROOM_ASSESSMENT_KEY, formatClassroomAssessmentPrompt, formatClassroomUseExampleLabel, normalizeClassroomAssessmentKey, resolveClassroomAssessmentBundle, youtubeNoCookieEmbedUrl } from '../utils/classroomContent';
import { MECHANISM_TYPES as SANITIZE_MECHANISM_TYPES, sanitizeMechanismRuntime } from '../utils/sanitize';
import { generateSmartConfig, mutateConfig, OPTIMIZER_MECHANISM_TYPES } from '../utils/optimizer';
import { isBoardFixedCoordRole, normalizeGearLinkageToReference, normalizeGearTrainToFabrication, normalizeMechanismToFabricationSet, normalizeMechanismToReference, REFERENCE_DEFAULTS, REFERENCE_EXPORT_READY_TYPES, REFERENCE_FOUNDRY_TYPES, REFERENCE_MECHANISM_RECIPES, referenceRecipeForType } from '../utils/mechanismReference';
import type { AppStage, BodyPartLayer, ConnectionSelection, ConnectionSelectionRole, FoundryExportPackage, MechanismConfig, MechanismType, Point, ProjectAction, ProjectMotionPath, ProjectState, SceneObject, StandardJoint } from '../types';

projectSelfCheck();

const g006StudentWarningCopyViolations: string[] = [];
const cutSourceFrame: CutFrame = { x: 0, y: -300, width: 500, height: 300 };
const cutFallbackFrame: CutFrame = { x: 150, y: -210, width: 140, height: 160 };
const cutViewport = buildCutBaseViewport({
  autoPoints: [],
  points: [
    { x: 200, y: 80 },
    { x: 260, y: 80 },
    { x: 260, y: 130 },
    { x: 200, y: 130 }
  ],
  fallbackFrame: cutFallbackFrame,
  sourceFrame: cutSourceFrame
});
assert.equal(Number(cutViewport.width.toFixed(1)), 192, 'cut viewport source-frame zoom preserves the 3.2 edit-bounds multiplier');
assert.equal(Number(cutViewport.height.toFixed(1)), 160, 'cut viewport source-frame zoom preserves the 140px minimum and edit bounds');
assert(cutViewport.minX >= cutSourceFrame.x && cutViewport.minY >= cutSourceFrame.y, 'cut viewport clamps inside the source frame');
const fallbackCutViewport = buildCutBaseViewport({
  autoPoints: [{ x: Number.NaN, y: 1 }, { x: Number.POSITIVE_INFINITY, y: 2 }],
  points: [],
  fallbackFrame: { x: 10, y: -90, width: 100, height: 90 }
});
assert.deepEqual(fallbackCutViewport, { minX: 10, minY: -90, width: 100, height: 90 }, 'cut viewport ignores non-finite points and falls back to part frame corners');
const cutSvgRect = { left: 0, top: 0, width: 400, height: 300 };
const zoomedCutViewport = zoomCutViewport({
  viewport: cutViewport,
  baseViewport: cutViewport,
  viewBounds: cutSourceFrame,
  svgRect: cutSvgRect,
  clientX: 200,
  clientY: 150,
  factor: 0.5
});
assert.equal(Number(zoomedCutViewport.width.toFixed(1)), 96, 'cut viewport zoom applies the requested factor above the minimum');
assert.equal(Number((zoomedCutViewport.minX + zoomedCutViewport.width / 2).toFixed(1)), Number((cutViewport.minX + cutViewport.width / 2).toFixed(1)), 'cut viewport zoom preserves the client anchor X');
assert.equal(Number((zoomedCutViewport.minY + zoomedCutViewport.height / 2).toFixed(1)), Number((cutViewport.minY + cutViewport.height / 2).toFixed(1)), 'cut viewport zoom preserves the client anchor Y');
const pannedCutViewport = panCutViewport({
  startViewport: zoomedCutViewport,
  baseViewport: cutViewport,
  viewBounds: cutSourceFrame,
  svgRect: cutSvgRect,
  deltaClientX: 40,
  deltaClientY: 30
});
assert(pannedCutViewport && pannedCutViewport.minX < zoomedCutViewport.minX && pannedCutViewport.minY < zoomedCutViewport.minY, 'cut viewport drag-pan moves the view opposite the pointer delta');
assert.deepEqual(clientPointToCutPoint({ viewport: cutViewport, svgRect: cutSvgRect, clientX: 200, clientY: 150 }), { x: 230, y: 105 }, 'cut pointer mapping rounds to 0.1 and flips Y back to cut space');
assert.deepEqual(scaleContour([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1.2), [{ x: -1, y: 0 }, { x: 11, y: 0 }], 'cut contour scaling stays centered on the contour centroid');
assert.equal(contourPathD([{ x: 1, y: 2 }, { x: 3, y: -4 }], true), 'M 1.00 -2.00 L 3.00 4.00 Z', 'cut contour SVG path helper preserves two-decimal formatting and optional Y flip');
const closeEnough = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-9;
const assertPointClose = (actual: Point | undefined, expected: Point | undefined, label: string, epsilon = 1e-9) => {
  assert(actual && expected, `${label} exists`);
  assert(Math.abs(actual.x - expected.x) <= epsilon && Math.abs(actual.y - expected.y) <= epsilon, `${label} matches within ${epsilon}`);
};
const assertJointStateClose = (actual: ReturnType<typeof calculateLinkage>, expected: ReturnType<typeof calculateLinkage>, label: string, epsilon = 1e-9) => {
  assert.equal(actual.isValid, expected.isValid, `${label} validity matches`);
  assertPointClose(actual.p1, expected.p1, `${label} p1`, epsilon);
  assertPointClose(actual.p2, expected.p2, `${label} p2`, epsilon);
  assertPointClose(actual.j1, expected.j1, `${label} j1`, epsilon);
  assertPointClose(actual.j2, expected.j2, `${label} j2`, epsilon);
  assertPointClose(actual.effector, expected.effector, `${label} effector`, epsilon);
  if (actual.aux || expected.aux) assertPointClose(actual.aux, expected.aux, `${label} aux`, epsilon);
};
const pathCanvasViewBox = canvasViewBoxForViewport({ offset: { x: 90, y: -68 }, zoom: 1.5 }, SCENE_VIEW);
assert(closeEnough(pathCanvasViewBox.x, 90) && closeEnough(pathCanvasViewBox.y, 158.66666666666669), 'path canvas viewBox preserves shared offset and zoom math');
assert.deepEqual(canvasPanOffset({
  startOffset: { x: 10, y: 20 },
  startClientX: 100,
  startClientY: 50,
  clientX: 150,
  clientY: 80,
  rect: { width: 450, height: 340 },
  scene: SCENE_VIEW
}), { x: 110, y: 80 }, 'path canvas drag-pan scales pointer movement by scene dimensions');
const centeredPathZoom = zoomCanvasViewportAtPoint({
  viewport: { offset: { x: 0, y: 0 }, zoom: 1 },
  rect: { left: 0, top: 0, width: 900, height: 680 },
  clientX: 450,
  clientY: 340,
  deltaY: -200,
  scene: SCENE_VIEW
});
assert.equal(centeredPathZoom.zoom, 1.2, 'path canvas wheel zoom keeps the existing zoom response');
assert(closeEnough(centeredPathZoom.offset.x, 0) && closeEnough(centeredPathZoom.offset.y, 0), 'path canvas center wheel zoom preserves centered offset');

const stableGoldenMasterJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (typeof item === 'number') return Number.isFinite(item) ? Number(item.toFixed(6)) : null;
  return item;
}, 2);

const goldenMasterHash = (value: unknown): string =>
  createHash('sha256').update(typeof value === 'string' ? value : stableGoldenMasterJson(value)).digest('hex');

const stableProjectForGoldenMaster = (project: ProjectState): ProjectState => ({
  ...project,
  metadata: {
    ...project.metadata,
    id: '<project-id>',
    createdAt: '<created-at>',
    updatedAt: '<updated-at>'
  },
  characterPackage: project.characterPackage ? {
    ...project.characterPackage,
    createdAt: '<created-at>'
  } : project.characterPackage,
  lastExport: undefined,
  lastFoundryExport: undefined
});

const stableMechanismSnapshotForGoldenMaster = <T extends { fingerprint: string; sourceIds: { projectId: string } }>(snapshot: T): T => ({
  ...snapshot,
  fingerprint: '<fingerprint>',
  sourceIds: {
    ...snapshot.sourceIds,
    projectId: '<project-id>'
  }
});

const textExtensions = new Set(['.bat', '.css', '.html', '.js', '.json', '.md', '.mjs', '.py', '.rs', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const ignoredEnglishScanDirs = new Set(['.git', '.omc', '.omx', 'dist', 'exe build', 'node_modules', 'playwright-report', 'src-tauri/target', 'test-results']);
const filesWithHangul: string[] = [];
const scanEnglishOnlyText = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(process.cwd(), path);
    if (entry.isDirectory()) {
      if (!ignoredEnglishScanDirs.has(rel) && !ignoredEnglishScanDirs.has(entry.name)) scanEnglishOnlyText(path);
    } else if (textExtensions.has(extname(entry.name)) && /[\uac00-\ud7af]/.test(readFileSync(path, 'utf8'))) {
      filesWithHangul.push(rel);
    }
  }
};
scanEnglishOnlyText(process.cwd());
assert.deepEqual(filesWithHangul, [], 'repository text and UI copy stay English-only with no Hangul/Korean strings');

const onnxPath = join(process.cwd(), 'public', 'onnx', 'pose_model.onnx');
assert(existsSync(onnxPath), 'web ONNX asset is present');
assert(statSync(onnxPath).size > 1_000_000, 'web ONNX asset is real model data, not a Git LFS pointer or mock');
assert(!readFileSync(onnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'web ONNX asset is checked out from Git LFS before tests run');

const emptyProject = createEmptyProject();
const starterSample = createSampleProject();
const sample = createSampleProject({ includeMechanism: true });

type MechanismActionHarness = ReturnType<typeof useAppMechanismActions>;

const renderMechanismActionHarness = (overrides: {
  project?: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectState['paths'][string];
  selectedMechanism?: MechanismConfig;
  foundry?: MechanismConfig;
  angle?: number;
} = {}) => {
  const project = overrides.project ?? createSampleProject({ includeMechanism: true });
  const selectedMechanism = overrides.selectedMechanism ?? project.mechanisms[0];
  const selectedPath =
    overrides.selectedPath ??
    (selectedMechanism?.targetPathId ? project.paths[selectedMechanism.targetPathId] : undefined);
  const dispatches: ProjectAction[] = [];
  let stage: AppStage = 'character';
  let commandStatus = '';
  let recommendationsShown = true;
  let actions: MechanismActionHarness | undefined;
  const Harness = () => {
    actions = useAppMechanismActions({
      project,
      dispatch: (action) => dispatches.push(action),
      selectedPath,
      selectedMechanism,
      foundry: overrides.foundry ?? createDefaultMechanism('4bar', 'foundry-preview-contract'),
      mechanismConfig: { speed: project.settings.animationSpeed, rotation: 0, mechanisms: project.mechanisms },
      angle: overrides.angle ?? 0,
      setStage: (nextStage) => { stage = nextStage; },
      setCommandStatus: (status) => { commandStatus = status; },
      setShowRecommendations: (shown) => { recommendationsShown = shown; },
    });
    return null;
  };
  renderToString(createElement(Harness));
  assert(actions, 'mechanism action harness renders the hook');
  return {
    actions,
    dispatches,
    stage: () => stage,
    commandStatus: () => commandStatus,
    recommendationsShown: () => recommendationsShown,
  };
};

const classroomLesson = createLessonProject('waving-arm');
const classroomFoundryPreview = foundryPreviewFromProject(classroomLesson);
assert.equal(classroomFoundryPreview.id, 'foundry-preview', 'Foundry keeps a draft identity separate from the persisted mechanism id');
assert.equal(classroomFoundryPreview.targetPathId, classroomLesson.selectedPathId, 'Foundry opens an imported project from its selected persisted mechanism instead of an unrelated default');
assert.deepEqual(classroomFoundryPreview.generatedPath, classroomLesson.mechanisms[0].generatedPath, 'Foundry import preserves the canonical persisted mechanism motion samples');
assert.equal(foundryPreviewFromProject(createEmptyProject()).id, 'foundry-preview', 'Foundry import falls back to a stable empty-project draft');
const guidedCamAnchor = {
  x: classroomFoundryPreview.anchorX ?? 0,
  y: classroomFoundryPreview.anchorY ?? 0,
};
const guidedCamAtImportedAnchor = mechanismWithGeneratedPath({
  ...createDefaultMechanism('cam', 'guided-cam-board-fit'),
  anchorX: guidedCamAnchor.x,
  anchorY: guidedCamAnchor.y,
  sceneAnchor: guidedCamAnchor,
  transform: {
    x: guidedCamAnchor.x,
    y: guidedCamAnchor.y,
    rotation: 90,
    scale: 1,
  },
});
assert.equal(
  compileMechanismGraphFabrication(guidedCamAtImportedAnchor, classroomLesson.settings.physicalKit).blocker,
  undefined,
  'guided Foundry fixture starts from a project-ready board anchor',
);
const boardFittedGuidedCam = fitRecommendedMechanismToSheet(classroomLesson, guidedCamAtImportedAnchor);
assert.deepEqual(
  [boardFittedGuidedCam.anchorX, boardFittedGuidedCam.anchorY],
  [-40, -40],
  'template replacement shifts the full cam and guide envelope onto the active sheet',
);
assert.equal(
  compileMechanismGraphFabrication(boardFittedGuidedCam, classroomLesson.settings.physicalKit).buildable,
  true,
  'sheet fitting uses compiler placement readiness rather than visual bounds alone',
);
assert.equal(
  mechanismEditIsSafe(boardFittedGuidedCam, classroomLesson.settings.physicalKit),
  true,
  'board-fitted template replacement is immediately safe for parametric editing',
);
const expectedCanvasDragHandles: Record<MechanismType, MechanismDragHandle[]> = {
  crank: ['P1', 'J1'],
  '4bar': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  piston: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  yoke: ['P1', 'J1', 'P2', 'J2', 'Effector'],
  'quick-return': ['P1', 'J1', 'P2', 'J2', 'Effector'],
  '5bar': ['P1', 'J1', 'P2', 'J2', 'Aux', 'Effector'],
  '6bar': ['P1', 'J1', 'P2', 'J2', 'Aux', 'Effector'],
  cam: ['P1', 'J1', 'P2'],
  'rack-pinion': ['P1', 'J1', 'Effector'],
  gear: ['P1'],
  gear_linkage: ['P1'],
  planetary_gear: ['P1']
};
const gearSceneRadiusByKey = (key: string) => {
  const spec = FABRICATION_GEAR_SPECS.find(item => item.key === key);
  assert(spec, `fabrication gear spec ${key} exists`);
  return spec.pitchRadiusMm * SCENE_PX_PER_MM;
};
const linkageSceneLengthByCells = (cells: number) => {
  const spec = FABRICATION_LINKAGE_SPECS.find(item => item.cells === cells);
  assert(spec, `fabrication linkage spec L${cells} exists`);
  return spec.lengthMm * SCENE_PX_PER_MM;
};
const gearSceneRadiusIsFabricationPreset = (radius: number) =>
  FABRICATION_GEAR_SPECS.some(spec => Math.abs(spec.pitchRadiusMm * SCENE_PX_PER_MM - radius) < 1e-9);
const linkageSceneLengthIsFabricationPreset = (length: number) =>
  FABRICATION_LINKAGE_SPECS.some(spec => Math.abs(spec.lengthMm * SCENE_PX_PER_MM - length) < 1e-9);
assert(existsSync(join(process.cwd(), 'resources/examples/raw/girl.png')), 'girl starter source image is present');
assert(existsSync(join(process.cwd(), 'resources/examples/raw/boy.PNG')), 'boy starter source image is present');
const webOnnxFp32Golden = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'web-onnx-fp32-golden.json'), 'utf8')) as {
  schema: string;
  partOrder: string[];
  anchors: Record<string, string>;
  jointParents: Record<string, string | null>;
  cases: Record<string, { source: [number, number]; keypoints: Array<[string, number, number, number]> }>;
};
assert.equal(webOnnxFp32Golden.schema, 'motionsmith.web-onnx-fp32.v1', 'FP32 image-import golden uses the versioned normalized ProjectState schema');
assert.deepEqual(Object.keys(webOnnxFp32Golden.cases).sort(), ['boy', 'girl', 'stick'], 'FP32 image-import golden covers both starters and the synthetic stick figure');
assert.equal(webOnnxFp32Golden.partOrder.length, 10, 'FP32 image-import golden locks the ten editable body parts');
assert.equal(Object.keys(webOnnxFp32Golden.anchors).length, 10, 'FP32 image-import golden locks every editable part anchor');
assert.equal(Object.keys(webOnnxFp32Golden.jointParents).length, 17, 'FP32 image-import golden locks the generated skeleton tree');
for (const [name, value] of Object.entries(webOnnxFp32Golden.cases)) {
  assert(value.source[0] * value.source[1] <= 1_000_000 && Math.max(...value.source) <= 1_024, `${name} FP32 golden uses the Chromebook working-image limit`);
  assert.equal(value.keypoints.length, 17, `${name} FP32 golden locks every COCO pose keypoint`);
}
for (const starter of ['girl', 'boy']) {
  const starterPath = join(process.cwd(), 'resources', 'examples', 'packages', `${starter}.motionsmith.json`);
  const starterProject = JSON.parse(readFileSync(starterPath, 'utf8')) as ProjectState;
  assert(statSync(starterPath).size <= 512 * 1024, `${starter} AI-free starter package stays below 512KB`);
  assert.equal(starterProject.partOrder.length, 10, `${starter} AI-free starter package keeps all editable parts`);
  assert.equal(Object.keys(starterProject.skeleton?.joints ?? {}).length, 17, `${starter} AI-free starter package keeps the editable skeleton`);
  assert(starterProject.characterPackage?.sourceTextureUrl?.startsWith('data:image/webp;base64,'), `${starter} AI-free starter stores a normalized WebP source`);
}
const agentsContract = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');
const docsMap = readFileSync(join(process.cwd(), 'docs', 'README.md'), 'utf8');
const workbenchContractText = readFileSync(join(process.cwd(), 'docs', 'workbench-flow-ux-contract.md'), 'utf8');
const noviceUiPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'novice-canva-style-ui-plan.md'), 'utf8');
const classroomFieldPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-field-support-plan.md'), 'utf8');
const assemblyStepPlayerPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'assembly-step-player-redesign-plan.md'), 'utf8');
const classroomGuidedEntryPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-guided-entry-plan.md'), 'utf8');
const classroomSensemakingPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-sensemaking-discoverability-plan.md'), 'utf8');
const codebaseCleanupPlan = readFileSync(join(process.cwd(), 'docs', 'analysis', 'codebase-cleanup-architecture-plan.md'), 'utf8');
const fabricationParityReportDir = join(process.cwd(), 'docs', 'analysis');
const latestFabricationParityReport = readdirSync(fabricationParityReportDir)
  .filter(name => /^fabrication-parity-\d{4}-\d{2}-\d{2}\.md$/.test(name))
  .sort()
  .at(-1);
assert(latestFabricationParityReport, 'docs/analysis keeps a current dated fabrication parity report');
const fabricationParityReportText = readFileSync(join(fabricationParityReportDir, latestFabricationParityReport), 'utf8');
const fabricationParityReportJsonText = readFileSync(join(fabricationParityReportDir, latestFabricationParityReport.replace(/\.md$/, '.json')), 'utf8');
const fabricationParityIndexText = readFileSync(join(process.cwd(), 'docs', 'analysis', 'README.md'), 'utf8');
const fabricationParityTraceSource = readFileSync(join(process.cwd(), 'scripts', 'trace-fabrication-parity.ts'), 'utf8');
const normalizedCodebaseCleanupPlan = codebaseCleanupPlan.replace(/\s+/g, ' ');
const brandStaticFiles = [
  'App.tsx',
  'components/AppWorkspaceShell.tsx',
  'index.html',
  'package.json',
  'bun.lock',
  'metadata.json',
  'README.md',
  'vite.config.ts',
  'run_browser.bat',
  'build_portable_exe.bat',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'docs/mechanism-blueprint-manual.md',
  'docs/prd/novice-canva-style-ui-plan.md',
  'docs/prd/classroom-field-support-plan.md',
  'docs/archive/plans/realistic-25d-3d-physics-platform-plan.md',
  'docs/archive/plans/canva-video-editor-workspace-plan.md',
  'docs/prd/toon-25d-main-3d-unlock-plan.md',
  'docs/subsystem-governance-and-mechanism-contracts.md',
  'docs/archive/execution/subsystem-governance-execution-log.md',
  'docs/app-command-shortcuts.md'
];
const brandStaticText = brandStaticFiles.map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
const subsystemGovernanceContract = readFileSync(join(process.cwd(), 'docs', 'subsystem-governance-and-mechanism-contracts.md'), 'utf8');
const legacyBrand = ['Mech', 'Anim'].join('');
const legacySlug = ['mech', 'anim'].join('');
assert(!brandStaticText.includes(legacyBrand), 'legacy product name is absent from static project files');
assert(!brandStaticText.includes(legacySlug), 'legacy package/storage slug is absent from static project files');
assert(brandStaticText.includes('MotionSmith'), 'MotionSmith appears across static project files');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).name, 'motionsmith-character-motion-designer', 'package name uses the MotionSmith slug');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'metadata.json'), 'utf8')).name, 'MotionSmith: Character Motion Designer', 'metadata product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes('<title>MotionSmith - Mechanical Character Designer</title>'), 'HTML title uses MotionSmith');
const appCommandBindingsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppCommandBindings.ts'), 'utf8');
const appCommandsSource = readFileSync(join(process.cwd(), 'utils/appCommands.ts'), 'utf8');
const appCommandHandlerSource = readFileSync(join(process.cwd(), 'utils/appCommandHandlers.ts'), 'utf8');
const appEntrySource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
const appControllerSource = readFileSync(join(process.cwd(), 'hooks', 'useMotionSmithAppController.ts'), 'utf8');
const appCommandSource = `${appEntrySource}
${appControllerSource}`;
const appProjectCommandsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppProjectCommands.ts'), 'utf8');
const appMechanismActionsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppMechanismActions.ts'), 'utf8');
const appStageNavigationText = readFileSync(join(process.cwd(), 'utils', 'appStageNavigation.ts'), 'utf8');
const appStageRouterPropsText = readFileSync(join(process.cwd(), 'utils', 'appStageRouterProps.ts'), 'utf8');
const contextHelpSource = readFileSync(join(process.cwd(), 'utils', 'contextHelp.ts'), 'utf8');
const contextHelpComponentSource = readFileSync(join(process.cwd(), 'components', 'ui', 'ContextHelp.tsx'), 'utf8');
const classroomExampleVideoSource = readFileSync(join(process.cwd(), 'components', 'ui', 'ClassroomExampleVideo.tsx'), 'utf8');
const viteConfigText = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
assert(viteConfigText.includes("loadEnv(mode, process.cwd(), '')") && viteConfigText.includes("const webBase = configEnv.VITE_BASE_PATH ?? '/'"), 'web deployment base can be set by shell or Vite mode files for project Pages');
assert(viteConfigText.includes("base: isTauri ? './' : webBase"), 'Tauri stays relative while web builds can target /ms/');
assert(viteConfigText.includes('chunkSizeWarningLimit: 2400'), 'Vite chunk warning budget is explicit for intentional lazy Rapier/ONNX browser chunks');
assert(normalizedCodebaseCleanupPlan.includes('Button and command audit lock') && normalizedCodebaseCleanupPlan.includes('utils/appCommands.ts'), 'cleanup plan records the executable button/menu audit lock');
assert(normalizedCodebaseCleanupPlan.includes('Warning fixes locked') && normalizedCodebaseCleanupPlan.includes('Rapier warning boundary'), 'cleanup plan records scoped warning fixes instead of broad suppression');
assert(normalizedCodebaseCleanupPlan.includes('`App.tsx` is now a tiny composition entry') && normalizedCodebaseCleanupPlan.includes('`hooks/useMotionSmithAppController.ts`') && normalizedCodebaseCleanupPlan.includes('top-level state/action orchestration') && normalizedCodebaseCleanupPlan.includes('`components/AppWorkspaceShell.tsx`') && normalizedCodebaseCleanupPlan.includes('workspace shell chrome lives outside App.tsx') && normalizedCodebaseCleanupPlan.includes('no ProjectState mutation or fabrication validation') && normalizedCodebaseCleanupPlan.includes('`utils/workflowStatus.ts`') && normalizedCodebaseCleanupPlan.includes('fabrication-aware status derivation') && normalizedCodebaseCleanupPlan.includes('`components/AppStageRouter.tsx`') && normalizedCodebaseCleanupPlan.includes('shared stage-to-component routing and player-dock placement') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppDerivedState.ts`') && normalizedCodebaseCleanupPlan.includes('selected part/path/mechanism, playback duration, sorted parts, and global mechanism config') && normalizedCodebaseCleanupPlan.includes('`hooks/useWorkspacePlayerDock.tsx`') && normalizedCodebaseCleanupPlan.includes('workspace player dock visibility') && normalizedCodebaseCleanupPlan.includes('Assembly step dock state') && normalizedCodebaseCleanupPlan.includes('`hooks/useWorkspacePlaybackLoop.ts`') && normalizedCodebaseCleanupPlan.includes('shared playback rAF loop and Path draw reset') && normalizedCodebaseCleanupPlan.includes('`hooks/useModalInertEffect.ts`') && normalizedCodebaseCleanupPlan.includes('modal inert') && normalizedCodebaseCleanupPlan.includes('`resources/starterImageTemplates.ts`') && normalizedCodebaseCleanupPlan.includes('starter image template assets') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppPathActions.ts`') && normalizedCodebaseCleanupPlan.includes('Path draw mode, tracking modal state, path point upsert/validation, and tracked-path transfer') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppCharacterImportActions.ts`') && normalizedCodebaseCleanupPlan.includes('character ONNX image import, starter image/package/project import, pending review, replacement review, skeleton export') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppMechanismActions.ts`') && normalizedCodebaseCleanupPlan.includes('mechanism update, Foundry export, recommendation apply, optimizer loop, and SVG/DXF export actions') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppOnnxBootstrap.ts`') && normalizedCodebaseCleanupPlan.includes('`hooks/useProjectHistory.ts`') && normalizedCodebaseCleanupPlan.includes('`hooks/useProjectAutosave.ts`') && normalizedCodebaseCleanupPlan.includes('`utils/projectPersistence.ts`') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppProjectCommands.ts`'), 'cleanup plan records the current App/controller hotspot and completed command/persistence/derived-state/stage-router/shell/status/player seams without brittle line-count locking');
assert(normalizedCodebaseCleanupPlan.includes('`utils/appStageNavigation.ts`') && normalizedCodebaseCleanupPlan.includes('stage handoff gate, recovery dispatch, stage-open status, and `goStage` wiring'), 'cleanup plan records the extracted stage navigation seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/appStageRouterProps.ts`') && normalizedCodebaseCleanupPlan.includes('stage-router prop grouping'), 'cleanup plan records the extracted App stage-router prop grouping seam');
assert(normalizedCodebaseCleanupPlan.includes('`hooks/useAppCommandBindings.ts` | 36') && normalizedCodebaseCleanupPlan.includes('application keyboard shortcut binding owns latest-handler ref'), 'cleanup plan records the extracted keyboard command binding hook seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/ProgressBlock.tsx` | 84') && normalizedCodebaseCleanupPlan.includes('character import progress UI lives outside the app shell'), 'cleanup plan records the extracted character progress seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/ui/InspectorControls.tsx` | 70') && normalizedCodebaseCleanupPlan.includes('shared inspector sliders/toggles live outside the app shell'), 'cleanup plan records the extracted inspector controls seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/PartInspector.tsx` | 276') && normalizedCodebaseCleanupPlan.includes('selected-part inspector owns part toggles'), 'cleanup plan records the extracted part inspector seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CutOutlineEditorDialog.tsx` | 379') && normalizedCodebaseCleanupPlan.includes('cut-outline editor owns modal pointer editing'), 'cleanup plan records the extracted cut outline editor seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/SkeletonInspector.tsx` | 225') && normalizedCodebaseCleanupPlan.includes('skeleton inspector owns joint/anchor editing'), 'cleanup plan records the extracted skeleton inspector seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterImportOverlays.tsx` | 165') && normalizedCodebaseCleanupPlan.includes('character import status/review overlays live outside the app shell'), 'cleanup plan records the extracted character import overlay seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterLessonOwnership.tsx` | 47') && normalizedCodebaseCleanupPlan.includes('guided lesson ownership cues/actions live outside the app shell'), 'cleanup plan records the extracted guided lesson ownership seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterSetupPanel.tsx` | 53') && normalizedCodebaseCleanupPlan.includes('Character setup right-inspector wrapper lives outside the app shell'), 'cleanup plan records the extracted character setup panel seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterImportControls.tsx` | 103') && normalizedCodebaseCleanupPlan.includes('character import entry controls live outside the app shell'), 'cleanup plan records the extracted character import controls seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterSelection.tsx` | 259') && normalizedCodebaseCleanupPlan.includes('Character stage wrapper lives outside the app shell'), 'cleanup plan records the extracted CharacterSelection stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/PathEditor.tsx` | 376') && normalizedCodebaseCleanupPlan.includes('Path stage wrapper lives outside the app shell'), 'cleanup plan records the extracted PathEditor stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/MechanismRecommendationSheet.tsx` | 230') && normalizedCodebaseCleanupPlan.includes('Path recommendation modal lives outside the app shell and previews board-fit overlays'), 'cleanup plan records the extracted Path recommendation modal seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/SceneSketch.tsx` | 398') && normalizedCodebaseCleanupPlan.includes('editable 2D path canvas owns SVG pointer/draw wiring'), 'cleanup plan records the extracted SceneSketch canvas seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/PartShape.tsx` | 132') && normalizedCodebaseCleanupPlan.includes('Path Editor part rendering owns artwork/plate clipping'), 'cleanup plan records the extracted Path part rendering seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/mechanism/mechanismParamPolicy.ts` | 88') && normalizedCodebaseCleanupPlan.includes('numeric parameter metadata, visibility policy, and clamping'), 'cleanup plan records the extracted mechanism parameter policy seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/mechanismRecommendations.ts` | 637') && normalizedCodebaseCleanupPlan.includes('pure recommendation/fitting seam'), 'cleanup plan records the extracted mechanism recommendation seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/foundryCamera.ts` | 140') && normalizedCodebaseCleanupPlan.includes('pure Foundry camera/projection seam'), 'cleanup plan records the extracted Foundry camera seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/MechanismLinkagePreview.tsx` | 800') && normalizedCodebaseCleanupPlan.includes('Foundry SVG mechanism preview leaf lives outside the app shell and delegates pure topology/path helpers') && normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/mechanismLinkagePreviewHelpers.ts` | 76'), 'cleanup plan records the extracted Foundry SVG preview helper seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/foundryPreviewGeometry.ts` | 23') && normalizedCodebaseCleanupPlan.includes('fitted gear-center helper shared by SVG and Three previews'), 'cleanup plan records the shared Foundry preview geometry helper seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/ThreeFoundryPreview.tsx` | 962') && normalizedCodebaseCleanupPlan.includes('shared Foundry/Design/Assembly Three renderer seam delegates browser telemetry, primitive mesh/material builders, dynamic render-layer dispatch, and tab-specific viewer contracts'), 'cleanup plan records the extracted shared Foundry Three renderer seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/foundryThreePrimitives.ts` | 521') && normalizedCodebaseCleanupPlan.includes('Foundry Three primitive factory owns cached geometry/material builders'), 'cleanup plan records the extracted Foundry Three primitive factory seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/foundryThreeRenderLayers.ts` | 312') && normalizedCodebaseCleanupPlan.includes('Foundry dynamic render-layer dispatch owns path/trail, linkage, gear, cam, guide, spacer, rack, follower, pin, and clip placement'), 'cleanup plan records the extracted Foundry render-layer dispatch seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryPreviewStateProbe.tsx` | 472') && normalizedCodebaseCleanupPlan.includes('Foundry/Design browser telemetry probe owns the `foundry-camera-rig` data contract'), 'cleanup plan records the extracted Foundry telemetry probe seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/threeResourceKit.ts` | 86') && normalizedCodebaseCleanupPlan.includes('shared Three cache/disposal/pixel-ratio helpers'), 'cleanup plan records the extracted shared Three resource helper seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/foundryPreviewModel.ts`') && normalizedCodebaseCleanupPlan.includes('shared Foundry-style live preview model derives playback frame'), 'cleanup plan records the shared Foundry preview model seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/mechanismInventory.ts`') && normalizedCodebaseCleanupPlan.includes('rendered inventory counts use the graph compiler recipe directly'), 'cleanup plan records the shared graph compiler inventory seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/mechanismPreviewStacks.ts` | 543') && normalizedCodebaseCleanupPlan.includes('Shared mechanism pin-stack/z-order helper lives outside stage folders'), 'cleanup plan records the extracted Foundry pin-stack helper seam');
assert(existsSync(join(process.cwd(), 'utils', 'mechanismPreviewStacks.ts')) && !existsSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryPreviewStacks.ts')), 'Foundry pin-stack helper is shared outside stage-local code');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/MechanismFoundry.tsx` | 931') && normalizedCodebaseCleanupPlan.includes('Mechanism Foundry stage wrapper lives outside the app shell'), 'cleanup plan records the extracted MechanismFoundry stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryCanvasPane.tsx` | 246') && normalizedCodebaseCleanupPlan.includes('Foundry center canvas host owns Three preview wiring and delegates chrome/overlay leaves'), 'cleanup plan records the extracted Foundry canvas pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryCanvasChrome.tsx` | 168') && normalizedCodebaseCleanupPlan.includes('Foundry center canvas badge, camera controls, and playback chrome live outside the preview host'), 'cleanup plan records the extracted Foundry canvas chrome seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryOverlayLayer.tsx` | 285') && normalizedCodebaseCleanupPlan.includes('Foundry SVG force, velocity, playhead, param handle, and anchor overlays live outside the preview host'), 'cleanup plan records the extracted Foundry overlay seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryWorkflowPanel.tsx` | 238') && normalizedCodebaseCleanupPlan.includes('Foundry left workflow pane owns target summary'), 'cleanup plan records the extracted Foundry workflow pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryInspectorPanel.tsx` | 231') && normalizedCodebaseCleanupPlan.includes('Foundry right inspector owns physics readout'), 'cleanup plan records the extracted Foundry inspector pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/AppShell.tsx` | 9') && normalizedCodebaseCleanupPlan.includes('compatibility re-export barrel for shell leaves'), 'cleanup plan records AppShell as a compatibility shell barrel');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/workflowStages.ts` | 22') && normalizedCodebaseCleanupPlan.includes('workflow stage labels and shared playback stage list'), 'cleanup plan records the extracted workflow stage metadata seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/GettingStartedDialog.tsx` | 133') && normalizedCodebaseCleanupPlan.includes('Getting Started modal is a shell leaf outside AppShell'), 'cleanup plan records the extracted Getting Started shell leaf seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/OnnxCacheStatusPill.tsx` | 15') && normalizedCodebaseCleanupPlan.includes('ONNX cache chip is a shell leaf outside AppShell'), 'cleanup plan records the extracted ONNX cache chip seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkflowRail.tsx` | 23') && normalizedCodebaseCleanupPlan.includes('workflow rail and version mark are shell leaves outside AppShell'), 'cleanup plan records the extracted workflow rail seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/TopCommandBar.tsx` | 29') && normalizedCodebaseCleanupPlan.includes('top menu rendering is a shell leaf outside AppShell'), 'cleanup plan records the extracted top command bar seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/ShellDialogs.tsx` | 51') && normalizedCodebaseCleanupPlan.includes('shortcut/about dialogs are shell leaves outside AppShell'), 'cleanup plan records the extracted shell dialogs seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/CanvasZoomToolbar.tsx` | 14') && normalizedCodebaseCleanupPlan.includes('shared canvas zoom controls live outside AppShell'), 'cleanup plan records the extracted canvas zoom toolbar seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkspacePlayerDock.tsx` | 81') && normalizedCodebaseCleanupPlan.includes('floating workspace player dock view lives outside AppShell'), 'cleanup plan records the extracted workspace player dock view seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkflowStatusStrip.tsx` | 7') && normalizedCodebaseCleanupPlan.includes('compact workflow status strip lives outside AppShell'), 'cleanup plan records the extracted workflow status strip seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/assembly/assemblyGeometry.ts` | 97') && normalizedCodebaseCleanupPlan.includes('DOM-free Assembly coordinate, smoothing, and character projector helpers'), 'cleanup plan records the extracted assembly geometry/projector seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/assembly/useAssemblyGuidePlayback.ts` | 75') && normalizedCodebaseCleanupPlan.includes('Assembly shared-player step count, reset-to-zero/stop, step clamp, and rAF progress loop'), 'cleanup plan records the extracted Assembly playback/reset hook seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/assembly/assemblyGuideModel.ts` | 100') && normalizedCodebaseCleanupPlan.includes('Assembly live recipe fallback, character/mechanism mode resolution, active steps, selected display step, and playback reset key'), 'cleanup plan records the extracted Assembly guide model seam');
assert(
  normalizedCodebaseCleanupPlan.includes('`utils/fabricationProfiles.ts` | 127')
  && normalizedCodebaseCleanupPlan.includes('gear/ring profile geometry and SVG path derivation live outside the fabrication runtime')
  && normalizedCodebaseCleanupPlan.includes('`utils/numberFormat.ts` | 13')
  && normalizedCodebaseCleanupPlan.includes('neutral finite/svg number formatting lives outside broad import sanitizing')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationStackModel.ts` | 99')
  && normalizedCodebaseCleanupPlan.includes('pure moving-stack layers, stack summaries, and linkage blank spec selection')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationReadiness.ts` | 60')
  && normalizedCodebaseCleanupPlan.includes('pure feasible-range sampling, physical tolerance, board-pitch, and linkage-snapping math')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationRenderPlan.ts` | 105')
  && normalizedCodebaseCleanupPlan.includes('pure moving-stack validation, render-layer z-order, base layer, and render-plan summaries')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationRecipes.ts` | 112')
  && normalizedCodebaseCleanupPlan.includes('package recipe, board callout, target callout, mechanism label, and prefab assembly-step derivation')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationBlueprintSvg.ts` | 142')
  && normalizedCodebaseCleanupPlan.includes('deterministic printable/readable Blueprint SVG rendering')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationSizing.ts` | 121')
  && normalizedCodebaseCleanupPlan.includes('pure planetary gear convention and linkage sizing')
  && normalizedCodebaseCleanupPlan.includes('`utils/simplePdf.ts` | 52')
  && normalizedCodebaseCleanupPlan.includes('import-free PDF document primitives')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationCharacterPrintLayout.ts`')
  && normalizedCodebaseCleanupPlan.includes('pure character cut-sheet layout model')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationCustomParts.ts` | 151')
  && normalizedCodebaseCleanupPlan.includes('bounded 1–2 page character custom-parts SVG/PDF plus STL artifact generation')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationAssemblyGuide.ts` | 114')
  && normalizedCodebaseCleanupPlan.includes('assembly guide exploded SVG, printable HTML, and PDF artifact generation')
  && normalizedCodebaseCleanupPlan.includes('`utils/fabricationCutSheetPdf.ts` | 48')
  && normalizedCodebaseCleanupPlan.includes('cut-sheet PDF artifact generation'),
  'cleanup plan records the extracted fabrication profile, number formatting, stack model, readiness, render-plan, recipe, Blueprint SVG, sizing, PDF primitive, character print layout, custom-parts artifact, assembly-guide artifact, and cut-sheet artifact seams'
);
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/blueprint/BlueprintExport.tsx` | 88') && normalizedCodebaseCleanupPlan.includes('`components/stages/blueprint/BlueprintControlPanel.tsx` | 269') && normalizedCodebaseCleanupPlan.includes('`components/stages/blueprint/BlueprintDetailPanel.tsx` | 100') && normalizedCodebaseCleanupPlan.includes('Blueprint left workflow controls, package generation, download buttons, character sheet downloads, and recipe list live outside the stage wrapper') && normalizedCodebaseCleanupPlan.includes('Blueprint right inspector recipe title, board callout, sensemaking cue, required-part chips, stack summary, and export grid status live outside the stage wrapper'), 'cleanup plan records the extracted Blueprint control/detail panel seams');
assert.equal(JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')).productName, 'MotionSmith', 'Tauri product name uses MotionSmith');
assert(readFileSync(join(process.cwd(), 'utils', 'projectPersistence.ts'), 'utf8').includes('motionsmith.autosave') && readFileSync(join(process.cwd(), 'utils', 'projectPersistence.ts'), 'utf8').includes('motionsmith.workspace'), 'local storage namespace uses the MotionSmith slug for persistent state');
assert.deepEqual(validateAppCommandRegistry(), [], 'application command registry is internally consistent');
assert(
  appControllerSource.includes('useAppCommandBindings({ commandHandlers, disabled: modalOpen })') &&
  appCommandsSource.includes('export type AppCommandHandlerMap = Record<AppCommandId, () => void>') &&
  appCommandBindingsHookText.includes('commandIdForKeyboardEvent') &&
  appCommandBindingsHookText.includes('isTypingShortcutTarget') &&
  appCommandBindingsHookText.includes('commandHandlersRef.current[commandId]?.()'),
  'App delegates global keyboard command binding to a hook without changing shortcut dispatch guards'
);
const commandIds = new Set(APP_COMMANDS.map(command => command.id));
const expectedAppCommandIds = [
  'project.new',
  'project.open',
  'project.recoverAutosave',
  'project.save',
  'project.saveAs',
  'project.exportCopy',
  'project.exportBlueprint',
  'project.resetLesson',
  'edit.undo',
  'edit.redo',
  'view.zoomIn',
  'view.zoomOut',
  'view.fit',
  'view.reset',
  'workspace.saveLayout',
  'workspace.restoreLayout',
  'workspace.resetLayout',
  'stage.character',
  'stage.path',
  'stage.foundry',
  'stage.design',
  'stage.blueprint',
  'stage.assembly',
  'options.preferences',
  'help.shortcuts',
  'help.about'
] as const;
assert.equal(commandIds.size, APP_COMMANDS.length, 'application command ids are unique');
assert.deepEqual(APP_COMMANDS.map(command => command.id), expectedAppCommandIds, 'app command registry keeps the complete shell command inventory');
assert.deepEqual(APP_MENU_GROUPS.map(group => ({
  id: group.id,
  label: group.label,
  commandIds: [...group.commandIds]
})), [
  { id: 'file', label: 'File', commandIds: ['project.new', 'project.open', 'project.recoverAutosave', 'project.save', 'project.saveAs', 'project.exportCopy', 'project.exportBlueprint', 'project.resetLesson'] },
  { id: 'edit', label: 'Edit', commandIds: ['edit.undo', 'edit.redo'] },
  { id: 'view', label: 'View', commandIds: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.reset', 'workspace.saveLayout', 'workspace.restoreLayout', 'workspace.resetLayout'] },
  { id: 'go', label: 'Go', commandIds: ['stage.character', 'stage.path', 'stage.foundry', 'stage.design', 'stage.blueprint', 'stage.assembly'] },
  { id: 'options', label: 'Options', commandIds: ['options.preferences'] },
  { id: 'help', label: 'Help', commandIds: ['help.shortcuts', 'help.about'] }
], 'shell menu groups keep the complete command inventory');
assert(APP_MENU_GROUPS.every(group => group.commandIds.length > 0), 'each app menu group has commands');
assert(APP_MENU_GROUPS.flatMap(group => group.commandIds).every(id => commandIds.has(id)), 'all menu command ids resolve to registry commands');
assert(APP_COMMANDS.every(command => APP_MENU_GROUPS.some(group => group.commandIds.some(id => id === command.id))), 'every command is rendered by a menu group');
assert(APP_COMMANDS.some(command => command.id === 'edit.undo' && command.shortcuts?.includes('Mod+Z')), 'undo is a real registered shortcut command');
assert(APP_COMMANDS.some(command => command.id === 'edit.redo' && command.shortcuts?.includes('Mod+Shift+Z')), 'redo is a real registered shortcut command');
assert(APP_COMMANDS.some(command => command.id === 'help.shortcuts' && command.shortcuts?.includes('?')), 'shortcut help command is globally reachable');
assert.equal(commandIdForKeyboardEvent({ key: '=', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles unshifted equals key');
assert.equal(commandIdForKeyboardEvent({ key: '+', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles shifted plus key');
assert.equal(commandIdForKeyboardEvent({ key: '=', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), 'view.zoomIn', 'zoom-in shortcut handles Playwright/browser shifted equals encoding');
assert.equal(commandIdForKeyboardEvent({ key: '5', ctrlKey: false, metaKey: false, shiftKey: false, altKey: true }), 'stage.blueprint', 'stage shortcuts resolve through the registry');
assert(!APP_COMMANDS.some(command => /exit|updates/i.test(command.label)), 'browser menu omits old placeholder Exit and Check for Updates items');
APP_MENU_GROUPS.forEach(group => group.commandIds.forEach(id => assert.equal(commandById(id).menu, group.id, `${id} belongs to its declared menu group`)));
const appWorkspaceShellCommandSource = readFileSync(join(process.cwd(), 'components', 'AppWorkspaceShell.tsx'), 'utf8');
const appShellCommandSource = readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8');
const gettingStartedDialogCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'GettingStartedDialog.tsx'), 'utf8');
const onnxCachePillCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'OnnxCacheStatusPill.tsx'), 'utf8');
const workflowRailCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowRail.tsx'), 'utf8');
const topCommandBarCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'TopCommandBar.tsx'), 'utf8');
const shellDialogsCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'ShellDialogs.tsx'), 'utf8');
const canvasZoomToolbarCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'CanvasZoomToolbar.tsx'), 'utf8');
const workspacePlayerDockCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkspacePlayerDock.tsx'), 'utf8');
const workflowStatusStripCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowStatusStrip.tsx'), 'utf8');
const workflowStagesCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'workflowStages.ts'), 'utf8');
const trackingModalSource = readFileSync(join(process.cwd(), 'components', 'TrackingModal.tsx'), 'utf8');
const appProjectHistoryHookText = readFileSync(join(process.cwd(), 'hooks', 'useProjectHistory.ts'), 'utf8');
assert(appCommandSource.includes('useProjectHistory(createInitialProject)') && !appCommandSource.includes('setProjectHistory') && !appCommandSource.includes('applyProjectAction(prev, action)') && appProjectHistoryHookText.includes('projectSelfCheck()') && appProjectHistoryHookText.includes('applyProjectAction') && appProjectHistoryHookText.includes('PROJECT_HISTORY_LIMIT') && appProjectHistoryHookText.includes('undoProject') && appProjectHistoryHookText.includes('redoProject'), 'App delegates ProjectState history, reducer dispatch, reload restore, and undo/redo stack management to useProjectHistory');
assert(appProjectCommandsHookText.includes('satisfies AppCommandHandlerMap') && appCommandsSource.includes('export type AppCommandHandlerMap = Record<AppCommandId, () => void>'), 'App command handlers are type-exhaustive against AppCommandId through the shared command handler map type');
const commandHandlerBlock =
  appCommandSource.match(/const commandHandlers = \{([\s\S]*?)\n\s*\} satisfies AppCommandHandlerMap;/)?.[1] ??
  appCommandHandlerSource.match(/\): AppCommandHandlerMap => \(\{([\s\S]*?)\n\}\);/)?.[1] ??
  '';
assert(commandHandlerBlock, 'App shell exposes one typed command handler map');
assert.deepEqual(
  [...commandHandlerBlock.matchAll(/[\"']([^\"']+)[\"']:/g)].map(match => match[1]).sort(),
  [...commandIds].sort(),
  'every visible shell command has exactly one App.tsx handler'
);
assert(appProjectCommandsHookText.includes('setShowAbout(true)'), 'About command opens a real modal instead of only writing status text');
assert(!appCommandSource.includes('showDirectoryPicker'), 'browser UI omits fake output-folder selection until downloads can write there');
assert(appEntrySource.includes('<AppWorkspaceShell {...workspaceProps} />') && appControllerSource.includes('useMotionSmithAppController') && appCommandSource.includes('workflowStatus,') && appCommandSource.includes('stageRouterProps,') && appCommandSource.includes('buildAppStageRouterProps') && appStageRouterPropsText.includes('export type AppStageRouterPropGroups') && appStageRouterPropsText.includes(': AppStageRouterProps =>') && appStageRouterPropsText.includes('foundryStage') && appStageRouterPropsText.includes('...assembly') && !appStageRouterPropsText.includes('return (') && !appStageRouterPropsText.includes('useState') && !appStageRouterPropsText.includes('React') && !appEntrySource.includes('app-header') && !appEntrySource.includes('quick-toolbar') && !appEntrySource.includes('WorkflowStatusStrip'), 'App delegates workspace shell markup and pure stage-router prop grouping while preserving status and stage-router props');
assert(appEntrySource.includes('useMotionSmithAppController') && appEntrySource.includes('<AppWorkspaceShell {...workspaceProps} />') && !appEntrySource.includes('useState') && !appEntrySource.includes('useRef') && !appEntrySource.includes('buildAppStageRouterProps'), 'App.tsx is a tiny composition entry while useMotionSmithAppController owns app orchestration');
assert(appWorkspaceShellCommandSource.includes('<AppStageRouter') && appWorkspaceShellCommandSource.includes('<TopCommandBar') && appWorkspaceShellCommandSource.includes('commandHandlers={commandHandlers}') && appWorkspaceShellCommandSource.includes('<WorkflowRail') && appWorkspaceShellCommandSource.includes('<WorkflowStatusStrip {...workflowStatus}') && appWorkspaceShellCommandSource.includes('<GettingStartedDialog') && appWorkspaceShellCommandSource.includes('<ShortcutHelpDialog') && appWorkspaceShellCommandSource.includes('<AboutDialog') && appWorkspaceShellCommandSource.includes('<MechanismRecommendationSheet') && appWorkspaceShellCommandSource.includes('onApply={onApplyRecommendation}') && appWorkspaceShellCommandSource.includes('<TrackingModal') && appWorkspaceShellCommandSource.includes('onTransfer={onTransferTracking}'), 'AppWorkspaceShell preserves command, status, modal, recommendation, and tracking prop wiring');
assert(appShellCommandSource.includes("export { GettingStartedDialog") && gettingStartedDialogCommandSource.includes('export const GettingStartedDialog') && gettingStartedDialogCommandSource.includes('data-testid="getting-started-dialog"') && appWorkspaceShellCommandSource.includes('<GettingStartedDialog'), 'Getting Started dialog is an extracted shell leaf while preserving workspace mount wiring');
assert(!appShellCommandSource.includes('<') && !appShellCommandSource.includes('useState') && appShellCommandSource.includes("export { WorkflowRail") && appShellCommandSource.includes("export { TopCommandBar") && appShellCommandSource.includes("export { WorkspacePlayerDock") && appShellCommandSource.includes("export { SHARED_PLAYBACK_STAGES, STAGES"), 'AppShell is a compatibility re-export barrel, not a JSX/state owner');
assert(onnxCachePillCommandSource.includes('data-testid="onnx-cache-status"') && workflowRailCommandSource.includes('data-testid="workspace-steps"') && topCommandBarCommandSource.includes('data-testid="top-command-bar"') && shellDialogsCommandSource.includes('data-testid="shortcut-help-dialog"') && shellDialogsCommandSource.includes('data-testid="about-dialog"') && canvasZoomToolbarCommandSource.includes('data-testid="canvas-zoom-readout"') && workspacePlayerDockCommandSource.includes('data-testid="workspace-player-dock"') && workspacePlayerDockCommandSource.includes('data-testid="workspace-player-drag-handle"') && workflowStatusStripCommandSource.includes('data-testid="workflow-status-strip"') && workflowStagesCommandSource.includes("id: 'assembly'"), 'extracted shell leaves preserve existing test ids and workflow metadata');
for (const forbiddenShellBoundary of ['validateForFabrication', 'applyProjectAction', 'ProjectAction', 'dispatch(', 'setProject(']) {
  assert(!appWorkspaceShellCommandSource.includes(forbiddenShellBoundary), `AppWorkspaceShell must stay presentation-only and exclude ${forbiddenShellBoundary}`);
}
const visibleUiSource = [
  'App.tsx',
  'components/AppWorkspaceShell.tsx',
  'components/TrackingModal.tsx',
  'components/AppShell.tsx',
  'components/shell/GettingStartedDialog.tsx',
  'components/shell/OnnxCacheStatusPill.tsx',
  'components/shell/WorkflowRail.tsx',
  'components/shell/TopCommandBar.tsx',
  'components/shell/ShellDialogs.tsx',
  'components/shell/CanvasZoomToolbar.tsx',
  'components/shell/WorkspacePlayerDock.tsx',
  'components/shell/WorkflowStatusStrip.tsx',
  'components/shell/workflowStages.ts',
  'components/stages/stageLayout.tsx',
  'components/stages/blueprint/BlueprintExport.tsx',
  'components/stages/assembly/AssemblySceneFrame.tsx',
  'utils/fabrication.ts',
  'utils/fabricationAssemblyGuide.ts',
  'utils/fabricationBlueprintSvg.ts',
  'utils/fabricationCutSheetPdf.ts',
  'utils/fabricationCustomParts.ts',
  'utils/fabricationProfiles.ts',
  'utils/fabricationReadiness.ts',
  'utils/fabricationRenderPlan.ts',
  'utils/fabricationRecipes.ts',
  'utils/fabricationSizing.ts',
  'utils/fabricationStackModel.ts',
  'utils/simplePdf.ts',
  'utils/assemblyPlayback.ts',
  'utils/assemblySceneFrame.ts',
  'utils/mechanismSceneContract.ts',
  'utils/mechanismTemplates.ts',
  'utils/appCommands.ts'
].map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
const collectTsxFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsxFiles(path));
    } else if (entry.name.endsWith('.tsx')) {
      files.push(relative(process.cwd(), path));
    }
  }
  return files;
};
const buttonSourceFiles = ['App.tsx', ...collectTsxFiles(join(process.cwd(), 'components'))].sort();
const findButtonOpenings = (source: string) => {
  const openings: { index: number; tag: string }[] = [];
  let index = 0;
  while ((index = source.indexOf('<button', index)) >= 0) {
    let quote: '"' | "'" | '`' | null = null;
    let braceDepth = 0;
    let cursor = index + '<button'.length;
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      const previous = source[cursor - 1];
      if (quote) {
        if (char === quote && previous !== '\\') quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') {
        braceDepth += 1;
        continue;
      }
      if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (char === '>' && braceDepth === 0) {
        openings.push({ index, tag: source.slice(index, cursor + 1) });
        cursor += 1;
        break;
      }
    }
    index = cursor;
  }
  return openings;
};
for (const file of buttonSourceFiles) {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  for (const opening of findButtonOpenings(source)) {
    const line = source.slice(0, opening.index).split('\n').length;
    assert(
      /onClick=|onPointerDown=|type=["']submit["']|data-command-id=/.test(opening.tag),
      `${file}:${line} button must execute a handler, drag action, form submit, or command registry action`
    );
  }
}
assert(!existsSync(join(process.cwd(), 'components', 'Controls.tsx')), 'runtime-unused legacy Controls component is deleted instead of preserved as dead UI');
assert(!existsSync(join(process.cwd(), 'utils', 'zStack.ts')), 'runtime-unused zStack helper is deleted instead of preserved as dead utility');
assert(!/Easy IK Setup/i.test(visibleUiSource), 'visible UI does not reintroduce sugar text like Easy IK Setup');
assert(!visibleUiSource.includes('Capture Camera'), 'browser hardware camera capture entry point is removed from visible UI');
assert(!visibleUiSource.includes('Choose Save Folder'), 'browser output-folder picker is removed from visible UI because downloads use the browser default location');
assert(!visibleUiSource.includes('CameraCaptureDialog'), 'browser hardware camera dialog component is removed');
assert(!visibleUiSource.includes('getUserMedia'), 'browser hardware camera capture API is not used by the app UI');
assert(existsSync(join(process.cwd(), 'public', 'fonts', 'manrope-800-latin.woff2')), 'Manrope splash font is self-hosted instead of loaded from a runtime CDN');
assert(existsSync(join(process.cwd(), 'resources', 'icons', 'AppIcon.png')) && existsSync(join(process.cwd(), 'resources', 'icons', 'AppIcon.icns')), 'canonical MotionSmith icon assets live under resources/icons');
assert(readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowRail.tsx'), 'utf8').includes("../../resources/icons/AppIcon.png?url"), 'workflow rail uses the canonical resources icon');
assert(readFileSync(join(process.cwd(), 'components', 'AppWorkspaceShell.tsx'), 'utf8').includes("../resources/icons/AppIcon.png?url"), 'top app bar uses the canonical resources icon');
assert(!readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8').includes('src-tauri/icons/icon.png'), 'welcome splash does not reuse the old Tauri grid icon path');
assert(!readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8').includes('<svg className="motionsmith-logo-mark"'), 'welcome splash does not keep an inline dummy logo SVG');
assert(readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes("font-family: 'Manrope'") && readFileSync(join(process.cwd(), 'index.html'), 'utf8').includes("%BASE_URL%fonts/manrope-800-latin.woff2"), 'welcome splash uses a base-aware local Manrope wordmark font');
[
  'Add body part',
  'placeholder plates',
  'Mechanism Gallery',
  'Selected part detail',
  'Skeleton anchors',
  'Advanced import tools',
  'Technical checks',
  'review generated package',
  'Warnings: none',
  'Studio settings',
  'Enable Debug Visuals',
  'Show Detailed Processing Steps',
  'Parametric Edit',
  'Build steps',
  'Cut sheet package',
  'Selected blueprint detail',
  'Selected mechanism inspector',
  'Free path workflow',
  'Draw the motion path',
  'Next: choose mechanism',
  'Use this mechanism',
  'Anchor picked visually',
  'Open a small canvas overlay',
  'Tune the image/decal area',
  'Ranked from the current free path',
  'Apply adds a real editable mechanism instance',
  'Draw at least 3 free-path points',
  'Draw at least 3 points for a selected body part',
  'Use or skip the new character first',
  'Skeleton editing is available after package acceptance',
  'Select a point on the canvas for point-level edits',
  'Unlock the selected part before editing',
  'Part properties are hidden from Options',
  'Kinematic estimate',
  'Mechanism library',
  'Feasibility:',
  'Path Preview',
  'One registry drives the menu bar',
  'Cache ONNX model for faster image imports',
  'Static web workbench',
  'scene units from target to nearest board hole',
  'Scrub the mechanism once before cutting extra copies',
  'Collect the mechanism parts before touching the board',
  'Snap the completed mechanism module',
  'Export SVG + JSON',
  'Fast · fewer fit samples',
  'Letter paper · 15×15 board holes',
  'Drag a point, or click the canvas',
  'This exact contour drives',
  'review anchor before cutting',
  'Beginner kit mode',
  'Exploded moving stack order',
  'Run preview once, then cut and assemble',
  'Resolve warning before cutting',
  'sampled motion',
  'valid sampled',
  'general purpose linkage',
  'scene units from target',
  'scene units)',
  'to keep the stack captured',
  'moving parts float',
  'so clips do not bind',
  'Show Sensemaking',
  'Back to Gallery',
  'Start a fresh MotionSmith project',
  'Open a .motionsmith.json project file',
  'Application command menu',
  'Shared animation controls',
  'Replace current character and preserve compatible mechanisms',
  'Draw 3+ path points',
  'Foundry playback controls',
  'Mechanism Foundry true WebGL 3D sandbox preview',
  'Do not show this again',
  'Skip to editor',
  'Skip forever',
  'Rail motion path',
  'Rail mechanism parameters',
  'Rail export package',
  'Workflow and primary actions',
  'simulation only until a mechanism-reference recipe exists',
  'content/simulation only',
  'unsupported until a rack/pinion kit contract is added'
].forEach(phrase => assert(!visibleUiSource.includes(phrase), `visible UI omits over-explaining legacy copy: ${phrase}`));
const appCommandDocs = readFileSync(join(process.cwd(), 'docs', 'app-command-shortcuts.md'), 'utf8');
assert(appCommandDocs.includes('utils/appCommands.ts'), 'command registry documentation points to the executable registry');
assert(appCommandDocs.includes('Reset Lesson') && appCommandDocs.includes('preserving app settings'), 'command docs include the menu-only classroom Reset Lesson contract');
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const physicsKernel = physicsKernelCapability();
const rapierProbe = await runRapierFrictionProbe({ frictionCoefficient: 0.74, steps: 150 });
const physicsKernelSource = readFileSync(join(process.cwd(), 'utils', 'physicsKernel.ts'), 'utf8');
const dockerfileText = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
const deployWorkflowText = readFileSync(join(process.cwd(), '.github', 'workflows', 'deploy.yml'), 'utf8');
const pullRequestWorkflowText = readFileSync(join(process.cwd(), '.github', 'workflows', 'pull-request.yml'), 'utf8');
const studyWranglerText = readFileSync(join(process.cwd(), 'infrastructure', 'study', 'wrangler.toml'), 'utf8');
const cargoTomlText = readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoLockText = readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.lock'), 'utf8');
const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
const deploymentDocs = readFileSync(join(process.cwd(), 'docs', 'deployment.md'), 'utf8');
const macosDocs = readFileSync(join(process.cwd(), 'docs', 'macos-distribution.md'), 'utf8');
const playwrightConfigText = readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
assert(playwrightConfigText.includes('fullyParallel: true'), 'browser tests default to full parallel execution without reducing coverage');
assert(playwrightConfigText.includes('PLAYWRIGHT_WORKERS'), 'browser worker count can be tuned by environment instead of weakening tests');
assert(playwrightConfigText.includes('MAX_BROWSER_WORKERS'), 'browser worker defaults are bounded to avoid local over-parallelization');
assert(playwrightConfigText.includes('Number.isInteger'), 'browser worker override validates positive integer input');
assert(playwrightConfigText.includes('PLAYWRIGHT_SERVER') && playwrightConfigText.includes('preview'), 'browser tests can run against production preview without Vite HMR noise');
assert(playwrightConfigText.includes('PLAYWRIGHT_PERFORMANCE') && packageJson.scripts['test:image-ai:performance'].includes('--workers=1'), 'resource-sensitive 6x CPU image measurements run in one isolated browser while the functional suite stays parallel');
assert(playwrightConfigText.includes('delete process.env.NO_COLOR') && playwrightConfigText.includes('env -u NO_COLOR'), 'Playwright normalizes conflicting FORCE_COLOR/NO_COLOR env to avoid worker/webserver warning spam');
assert.equal(packageJson.version, '0.0.10', 'release version is bumped for the GitHub Pages redeploy');
assert.equal(tauriConfig.version, packageJson.version, 'Tauri config version stays aligned with package.json');
assert(viteConfigText.includes('__APP_VERSION__') && viteConfigText.includes('packageVersion'), 'Vite exposes package.json version to the browser UI');
assert.deepEqual(tauriConfig.bundle.icon, ['icons/icon.png', 'icons/icon.ico', 'icons/icon.icns'], 'Tauri bundle references the tracked MotionSmith png, ico, and icns icons');
assert(cargoTomlText.includes(`version = "${packageJson.version}"`), 'Cargo.toml version stays aligned with package.json');
assert(cargoLockText.includes('name = "motionsmith"') && cargoLockText.includes(`version = "${packageJson.version}"`), 'Cargo.lock MotionSmith package version stays aligned with package.json');
assert.equal(packageJson.packageManager, 'bun@1.3.14', 'Bun is the canonical package manager');
assert.equal(packageJson.scripts['test:contracts'], 'bun tests/project-contract.test.ts', 'contract tests run directly through Bun without noisy temporary bundling');
assert.equal(packageJson.dependencies[PHYSICS_KERNEL_IMPORT], '^0.19.3', 'Rapier 3D compatibility WASM kernel is installed behind the physics subsystem boundary');
assert(!packageJson.dependencies['@react-three/fiber'] && !packageJson.dependencies['@react-three/rapier'] && !packageJson.dependencies['babylonjs'], 'renderer stack avoids extra scene frameworks while the imperative Three boundary is sufficient');
assert.equal(packageJson.scripts.build, 'tsc && vite build', 'browser build keeps Vite as the bundler for Rapier/Vite chunk handling');
assert(!Object.values(packageJson.scripts).some(script => String(script).includes('bun build')), 'browser scripts do not use Bun JS bundling for the Rapier runtime');
assert(physicsKernelSource.includes("import('@dimforge/rapier3d-compat')"), 'Rapier kernel uses a literal dynamic import so Vite emits a lazy Rapier chunk');
assert(!physicsKernelSource.includes('import(PHYSICS_KERNEL_IMPORT)'), 'Rapier kernel does not use a variable dynamic import that browsers cannot resolve after build');
assert.equal(physicsKernel.renderStack, PHYSICS_RENDER_STACK, 'physics capability keeps the imperative Three/WebGL2 renderer as the high-performance viewport stack');
assert.equal(physicsKernel.physicsKernel, PHYSICS_KERNEL_ENGINE, 'physics capability advertises Rapier as the contact/friction solver');
assert.equal(physicsKernel.updatePolicy, PHYSICS_UPDATE_POLICY, 'physics capability keeps mechanism kinematics authoritative while using Rapier for contact validation');
assert.equal(physicsKernel.scenePolicy, HIGH_THROUGHPUT_SCENE_POLICY, 'physics capability locks the Viser-style batching/transform-tree policy');
assert.equal(rapierProbe.engine, PHYSICS_KERNEL_ENGINE, 'Rapier probe runs through the selected physics kernel');
assert.equal(rapierProbe.initialized, true, 'Rapier WASM initializes in the contract harness');
assert.equal(rapierProbe.rigidBodyCount, 2, 'Rapier probe creates a real dynamic body plus ground body');
assert.equal(rapierProbe.colliderCount, 2, 'Rapier probe creates real friction-bearing colliders');
assert(rapierProbe.contactSettled, `Rapier friction probe settles on contact with finite speed: ${JSON.stringify(rapierProbe)}`);
assert(!existsSync(join(process.cwd(), 'package-lock.json')), 'npm lockfile is absent after Bun migration');
assert(
  packageJson.scripts['test:browser'].includes('bun run build')
    && packageJson.scripts['test:browser'].includes('env -u NO_COLOR')
    && packageJson.scripts['test:browser'].includes('PLAYWRIGHT_SERVER=preview'),
  'browser test script validates the production build through preview mode without color-env warning spam'
);
assert(physicsKernelSource.includes('RAPIER_INIT_DEPRECATION_WARNING'), 'Rapier init keeps the known upstream wasm-bindgen deprecation at the physics boundary');
assert(physicsKernelSource.includes('args.length === 1 && args[0] === RAPIER_INIT_DEPRECATION_WARNING'), 'Rapier init filters only the exact upstream deprecation warning');
assert(physicsKernelSource.includes('finally') && physicsKernelSource.includes('console.warn = warn'), 'Rapier init restores console.warn after the scoped compatibility filter');
assert(deployWorkflowText.includes('oven-sh/setup-bun@v2') && deployWorkflowText.includes('bun install --frozen-lockfile') && deployWorkflowText.includes('bun run build'), 'GitHub Pages workflow uses Bun install and build');
assert(pullRequestWorkflowText.includes('pull_request:') && pullRequestWorkflowText.includes('lfs: true') && pullRequestWorkflowText.includes('bun run test') && pullRequestWorkflowText.includes('--shard=1/4') && pullRequestWorkflowText.includes('--shard=4/4') && pullRequestWorkflowText.includes('bun run test:image-ai:performance') && pullRequestWorkflowText.includes('bun run test:study:browser'), 'pull requests fetch LFS and run contracts, four production-preview browser shards, isolated image performance, and study gates');
assert(deployWorkflowText.indexOf('bun run test') > -1 && deployWorkflowText.indexOf('bun run test') < deployWorkflowText.indexOf('bun run build'), 'GitHub Pages workflow runs contract tests before build and deploy');
assert(deployWorkflowText.includes('playwright install --with-deps chromium') && deployWorkflowText.includes('bun run test:study:browser'), 'tagged study releases run the production-preview telemetry browser gate before the release build');
assert(deployWorkflowText.includes('lfs: true') && deployWorkflowText.includes('git lfs pull --include="public/onnx/pose_model.onnx"'), 'GitHub Pages workflow fetches real ONNX bytes from Git LFS before build');
assert(deployWorkflowText.includes('Check ONNX LFS asset') && deployWorkflowText.includes('Check built ONNX asset') && deployWorkflowText.includes('version https://git-lfs'), 'GitHub Pages workflow rejects Git LFS pointer files before upload');
assert(deployWorkflowText.includes('tags:') && deployWorkflowText.includes('v*.*.*') && !deployWorkflowText.includes('branches:'), 'GitHub Pages workflow deploys only from version tags');
assert(deployWorkflowText.includes('test "v${VERSION}" = "${GITHUB_REF_NAME}"'), 'GitHub Pages workflow requires the tag to match package.json version');
assert(deployWorkflowText.includes('VITE_BASE_PATH: /ms/'), 'GitHub Pages workflow builds assets under /ms/');
assert(deployWorkflowText.indexOf('  build:') < deployWorkflowText.indexOf('  study-worker:') && deployWorkflowText.includes('study-worker:\n    runs-on: ubuntu-latest\n    needs: build'), 'study Worker deploy runs only after the tested production build');
assert(deployWorkflowText.includes("VITE_STUDY_PROFILE: ${{ vars.STUDY_PROFILE || 'study' }}"), 'tagged releases default to approved study capture and can switch profile through one deployment variable');
assert(deployWorkflowText.includes('VITE_STUDY_BUILD_SHA: ${{ github.sha }}') && deployWorkflowText.includes('cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd') && deployWorkflowText.includes('wranglerVersion: "4.112.0"'), 'study deployment records the exact app build and pins its Worker deploy tool');
assert(studyWranglerText.includes('INGEST_RATE_LIMITER') && studyWranglerText.includes('BUG_RATE_LIMITER') && studyWranglerText.includes('limit = 6000') && studyWranglerText.includes('limit = 20'), 'study Worker has school-NAT-safe ingest and stricter bug-report rate limits');
assert(dockerfileText.includes('FROM oven/bun:1.3.14-alpine') && dockerfileText.includes('bun install --frozen-lockfile') && dockerfileText.includes('\"preview\"'), 'Docker image uses Bun install, build, and preview runtime');
assert.equal(tauriConfig.build.beforeDevCommand, 'bun run dev', 'Tauri dev hook uses Bun');
assert.equal(tauriConfig.build.beforeBuildCommand, 'bun run build:tauri-frontend', 'Tauri build hook uses Bun');
assert(deploymentDocs.includes('bun install --frozen-lockfile') && !deploymentDocs.includes('npm '), 'deployment docs use Bun commands');
assert(deploymentDocs.includes('Classroom release checklist') && deploymentDocs.includes('v<package.json version>') && deploymentDocs.includes('VITE_BASE_PATH=/ms/'), 'deployment docs include the classroom /ms release checklist');
assert(deploymentDocs.includes('runtime calls except the selected `/ms-study/v1` telemetry profile') && deploymentDocs.includes('Teacher pack workflow') && deploymentDocs.includes('no account, no upload'), 'deployment docs lock classroom release to local-first teacher-pack flow with the narrow study boundary');
assert(macosDocs.includes('bun run build:exe') && !macosDocs.includes('npm '), 'macOS distribution docs use Bun commands');
assert(agentsContract.includes('three` + Rapier WASM'), 'AGENTS.md records the selected high-performance 3D physics stack');
assert(agentsContract.includes('Viser-style transform tree'), 'AGENTS.md records the Viser-inspired batching rule for large scenes');
assert(agentsContract.includes('preserve coverage while optimizing wall time'), 'AGENTS.md requires test speedups to preserve test quality');
assert(agentsContract.includes('bounded Playwright parallel workers'), 'AGENTS.md requires bounded browser test parallelism');
assert(agentsContract.includes('bun run test') && agentsContract.includes('bun run build') && !agentsContract.includes('npm test'), 'AGENTS.md verification gates use Bun commands');
assert(agentsContract.includes('GitHub Pages is the only hosted web release path') && agentsContract.includes('https://alansynn.com/ms/') && agentsContract.includes('VITE_BASE_PATH=/ms/'), 'AGENTS.md locks the /ms GitHub Pages release path');
assert(agentsContract.includes('Deploy only from version tags') && agentsContract.includes('v<package.json version>') && agentsContract.includes('Do not re-enable `main` branch deployment'), 'AGENTS.md locks tag-only release deployment');
assert(agentsContract.includes('package.json') && agentsContract.includes('src-tauri/Cargo.toml') && agentsContract.includes('src-tauri/tauri.conf.json'), 'AGENTS.md requires browser and Tauri version alignment before release');
assert(agentsContract.includes('local-first browser/Tauri'), 'AGENTS.md excludes server scope and locks the app as local-first');
assert(agentsContract.includes('sole approved server exception') && agentsContract.includes('/ms-study/v1') && agentsContract.includes('do not add other backend/API services'), 'AGENTS.md limits server scope to the approved study and bug boundary');
assert(agentsContract.includes('Guided classroom lesson templates must create real serializable `ProjectState` data') && agentsContract.includes('Blank starters stay mechanism-free'), 'AGENTS.md locks lesson templates to real state and keeps blank starters clean');
assert(agentsContract.includes('Classroom entry is theme-guided first') && agentsContract.includes('open exploration stays secondary'), 'AGENTS.md locks guided project entry as the classroom-primary start');
assert(agentsContract.includes('`Reset Lesson` must restore a known-good lesson baseline') && agentsContract.includes('preserving app settings'), 'AGENTS.md locks stable lesson reset semantics');
assert(agentsContract.includes('Blueprint owns build files') && agentsContract.includes('Assembly owns animated step-by-step build'), 'AGENTS.md preserves Blueprint versus Assembly role split');
assert(agentsContract.includes('Use domain-driven vocabulary consistently') && agentsContract.includes('Keep harness engineering first-class'), 'AGENTS.md locks DDD vocabulary and harness-friendly seam rules');
assert(agentsContract.includes('Prefer `$ask-claude` for high-token, low-importance, non-performance-sensitive support work') && agentsContract.includes('Delegate long-log reading, routine test execution and pass/fail triage') && agentsContract.includes('Keep difficult planning, architecture, integration decisions, source edits, irreversible actions, and final verification with the leader') && agentsContract.includes('Treat delegated summaries and success text as untrusted') && agentsContract.includes('preserve raw output and exit codes'), 'AGENTS.md keeps routine high-token work delegated while planning, edits, and final evidence stay leader-owned');
const fabricationParityLanguage = `${fabricationParityReportText}\n${fabricationParityReportJsonText}\n${fabricationParityIndexText}`;
assert(fabricationParityIndexText.includes(latestFabricationParityReport), 'analysis index points to the latest active fabrication parity report');
assert(!fabricationParityLanguage.includes('fully 1:1 for managed categories including board and all mechanism families'), 'fabrication parity reports reject the old unqualified full 1:1 mechanism-family claim');
assert(!fabricationParityLanguage.includes('full-svg-generation'), 'fabrication parity reports label copied families honestly instead of full SVG generation');
assert(fabricationParityLanguage.includes('template-copy'), 'fabrication parity reports label copied managed families as template-copy');
assert(fabricationParityLanguage.includes('ts-board-generation') && fabricationParityLanguage.includes('scripts/generate-fabrication-board.ts'), 'fabrication parity reports label the board as TypeScript board generation');
assert(fabricationParityLanguage.includes('TS/frozen-oracle managed SVG contour') || fabricationParityLanguage.includes('frozen Python-derived oracle'), 'fabrication parity reports scope 1:1 claims to TS/frozen-oracle managed SVG contours');
assert(fabricationParityLanguage.includes('presentation/non-cutter') || fabricationParityLanguage.includes('presentation geometry'), 'fabrication parity reports keep runtime Blueprint/scene SVGs outside cutter contour identity claims');
assert(fabricationParityLanguage.includes('board coordinate parity') && (fabricationParityLanguage.includes('TS/frozen-oracle managed SVG contours') || fabricationParityLanguage.includes('frozen Python-derived oracle')), 'fabrication parity report separates board coordinate parity wording from frozen-oracle managed SVG contour proof');
assert(fabricationParityTraceSource.includes("missingInGenerated.push({ path: relPath, status: 'missing-in-generated', reason: 'Committed managed file missing from generated output.' })"), 'trace committed-only managed files are reported as missing in generated output');
assert(fabricationParityTraceSource.includes('const leftExists = existsSync(leftPath)') && fabricationParityTraceSource.includes("missingInCommitted.push({ path: relPath, status: 'missing-in-committed', reason: `Missing file ${leftPath}` })"), 'trace missing committed files are reported as missing in committed output');
assert(fabricationParityTraceSource.includes("mismatched.push({ path: relPath, status: 'content-mismatch', reason: error instanceof Error ? error.message : `${error}` })"), 'trace malformed existing SVG compare errors are content mismatches, not missing files');
assert(docsMap.includes('active novice flow and tutorial/help plan'), 'docs map treats the novice tutorial plan as an active implementation plan');
assert(docsMap.includes('classroom field-study gap plan'), 'docs map treats the classroom field support plan as an active implementation plan');
assert(agentsContract.includes('tinkerable workbench'), 'AGENTS.md codifies the tinkerable workbench direction');
assert(agentsContract.includes('direct manipulation'), 'AGENTS.md prioritizes direct manipulation over explanatory text');
assert(agentsContract.includes('Result-first UI copy policy'), 'AGENTS.md locks result-first visible UI copy policy');
assert(agentsContract.includes('Visible runtime copy should be labels, status chips, direct actions, or blockers'), 'AGENTS.md blocks reading-heavy runtime copy');
assert(agentsContract.includes('utils/contextHelp.ts') && agentsContract.includes('components/ui/ContextHelp.tsx'), 'AGENTS.md requires centralized locale-ready contextual help instead of inline stage explanations');
assert(contextHelpSource.includes('export type HelpLocale = "en"') && contextHelpSource.includes('Record<') && contextHelpSource.includes('ContextHelpId') && contextHelpSource.includes('DEFAULT_HELP_LOCALE'), 'contextual help copy is locale-ready and centrally registered');
assert(contextHelpComponentSource.includes('contextHelpFor') && contextHelpComponentSource.includes('data-testid="context-help-trigger"') && contextHelpComponentSource.includes('role="tooltip"') && contextHelpComponentSource.includes('createPortal') && contextHelpComponentSource.includes('position: "fixed"') && contextHelpComponentSource.includes('window.innerHeight'), 'contextual help renders compact reusable question-mark popovers from the registry as body-level overlays that do not affect layout');
assert(!contextHelpSource.includes('character.keepMechanisms') && !contextHelpSource.includes('Keep mechanisms'), 'removed Character keep-mechanisms help copy stays out of the central help registry');
assert(!contextHelpComponentSource.includes('Turn one picture') && !contextHelpComponentSource.includes('Block exports when'), 'contextual help component does not inline copy outside the central registry');
const contextHelpConsumerSource = [
  'components/stages/character/CharacterImportControls.tsx',
  'components/stages/path/PathWorkflowPanel.tsx',
  'components/stages/foundry/FoundryCanvasChrome.tsx',
  'components/stages/blueprint/BlueprintControlPanel.tsx',
  'components/stages/assembly/AssemblyControlPanel.tsx',
  'components/stages/options/Options.tsx'
].map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
assert(['character.createFromImage', 'path.draw', 'viewer.layers', 'blueprint.boardPreview', 'assembly.steps', 'options.fabricationExport'].every(helpId => contextHelpConsumerSource.includes(helpId)), 'high-friction UI controls attach contextual help through shared help ids');
assert(agentsContract.includes('3D physics'), 'AGENTS.md codifies the 3D physics simulation direction');
assert(agentsContract.includes('fabrication'), 'AGENTS.md codifies fabrication-oriented mechanisms');
assert(agentsContract.includes('canonical `ProjectState`'), 'AGENTS.md requires one canonical ProjectState across workflows');
assert(agentsContract.includes('Foundry preview'), 'AGENTS.md locks foundry simulation preview expectations');
assert(agentsContract.includes('Do not add artificial test time limits'), 'AGENTS.md forbids artificial test time limits');
assert(agentsContract.includes('Simulation verification may be rigorous'), 'AGENTS.md allows rigorous simulation verification');
assert(subsystemGovernanceContract.includes('ProjectState'), 'subsystem governance keeps ProjectState as the canonical app document');
assert(subsystemGovernanceContract.includes('MechanismFeatureRegistry'), 'subsystem governance names the single mechanism feature registry seam');
assert(subsystemGovernanceContract.includes('MechanismSnapshot'), 'subsystem governance names deterministic mechanism snapshots');
assert(subsystemGovernanceContract.includes('ToonSceneProjection'), 'subsystem governance keeps ToonSceneProjection as the scene projection contract');
assert(subsystemGovernanceContract.includes('Do not create duplicate mechanism registries'), 'subsystem governance forbids duplicate mechanism registries');
assert(subsystemGovernanceContract.includes('Rapier'), 'subsystem governance records the Rapier contact/friction kernel decision');
assert(subsystemGovernanceContract.includes('Viser-style transform tree'), 'subsystem governance records batching/instancing as the large-scene policy');
assert(subsystemGovernanceContract.includes('Performance governance'), 'subsystem governance includes the performance-governance rules');
assert(subsystemGovernanceContract.includes('production preview build'), 'subsystem governance locks browser QA to shipped production preview evidence');
assert(noviceUiPlan.includes('## Tutorial layer PRD'), 'novice UI plan includes a concrete tutorial layer PRD');
assert(noviceUiPlan.includes('First-run checklist') && noviceUiPlan.includes('Completion derives from current `ProjectState`'), 'tutorial checklist is derived from real project state');
assert(noviceUiPlan.includes('Forbidden:') && noviceUiPlan.includes('tutorial tab') && noviceUiPlan.includes('center-canvas lesson cards'), 'tutorial plan forbids fake tutorial stages and center-canvas lessons');
assert(noviceUiPlan.includes('No new tour dependency') && noviceUiPlan.includes('Plain React state and CSS are enough'), 'tutorial plan avoids extra tour dependencies');
assert(classroomFieldPlan.includes('# Classroom Field Support Plan'), 'classroom field support PRD exists');
assert(classroomFieldPlan.includes('Web is mandatory for classrooms') && classroomFieldPlan.includes('https://alansynn.com/ms/'), 'classroom plan locks the web-first classroom release target');
assert(classroomFieldPlan.includes('Guided entry beats open exploration') && classroomFieldPlan.includes('Waving arm'), 'classroom plan requires guided lesson templates before open exploration');
assert(classroomFieldPlan.includes('Vocabulary must be English-only'), 'classroom plan forbids mixed-language UI vocabulary');
assert(classroomFieldPlan.includes('Details must be visible at the moment of action') && classroomFieldPlan.includes('Details'), 'classroom plan requires compact details without center-canvas teaching panels');
assert(classroomFieldPlan.includes('Stable reset and recovery') && classroomFieldPlan.includes('No rotation possible'), 'classroom plan requires stable reset for mechanism failure recovery');
assert(classroomFieldPlan.includes('Blueprint as build-file screen') && classroomFieldPlan.includes('Assembly as animated build screen'), 'classroom plan preserves Blueprint/Assembly ownership split');
assert(classroomFieldPlan.includes('No backend, auth, roster, analytics, cloud DB, teacher dashboard') && classroomFieldPlan.includes('Teacher pack workflow'), 'classroom plan excludes server scope while defining local teacher pack workflow');
assert(docsMap.includes('prd/classroom-guided-entry-plan.md'), 'docs map registers the classroom guided entry plan');
assert(classroomGuidedEntryPlan.includes('# Classroom Guided Entry Plan'), 'classroom guided entry PRD exists');
assert(classroomGuidedEntryPlan.includes('Guided theme entry is primary') && classroomGuidedEntryPlan.includes('open exploration is secondary'), 'guided entry plan records the field-driven guided-first decision');
assert(classroomGuidedEntryPlan.includes('No required upload') && classroomGuidedEntryPlan.includes('starter humanoid'), 'guided entry plan requires a built-in humanoid workflow without upload');
assert(classroomGuidedEntryPlan.includes('Digital action -> physical artifact') && classroomGuidedEntryPlan.includes('Make a hand wave'), 'guided entry plan requires direct digital-to-physical theme cards');
assert(classroomGuidedEntryPlan.includes('No full-screen tutorial') && classroomGuidedEntryPlan.includes('No backend, auth, roster, analytics, cloud DB, teacher dashboard'), 'guided entry plan keeps tutorial and server scope excluded');
assert(classroomGuidedEntryPlan.includes('GuidedEntryDescriptor') && classroomGuidedEntryPlan.includes('Persist ids in `ProjectState.metadata`'), 'guided entry plan defines a shared descriptor seam instead of duplicated UI state');
assert(docsMap.includes('prd/classroom-sensemaking-discoverability-plan.md'), 'docs map registers the classroom sensemaking discoverability plan');
assert(docsMap.includes('prd/assembly-step-player-redesign-plan.md'), 'docs map registers the active Assembly step player redesign plan');
assert(assemblyStepPlayerPlan.includes('# Assembly Step Player Redesign Plan'), 'assembly step player PRD exists');
assert(assemblyStepPlayerPlan.includes('One step shows one build action') && assemblyStepPlayerPlan.includes('Board coordinates come only from board-fixed coordinate roles'), 'assembly redesign locks one-step visibility and board-coordinate truth');
assert(assemblyStepPlayerPlan.includes('AssemblySceneFrame') && assemblyStepPlayerPlan.includes("type AssemblyBoardMode = 'hidden' | 'context' | 'active'"), 'assembly redesign defines a derived scene frame contract');
assert(assemblyStepPlayerPlan.includes('The current parts tray contains only current-step parts') && assemblyStepPlayerPlan.includes('Center canvas never shows a printable document preview'), 'assembly redesign forbids full-inventory and document-preview center clutter');
assert(classroomSensemakingPlan.includes('# Classroom Sensemaking Discoverability Plan'), 'classroom sensemaking PRD exists');
assert(classroomSensemakingPlan.includes('Teachers missed the existing sensemaking entry point') && classroomSensemakingPlan.includes('Visible before optional'), 'sensemaking plan records the field failure and requires visible-by-default meaning');
assert(classroomSensemakingPlan.includes('Direct translation') && classroomSensemakingPlan.includes('input action -> physical cause -> output motion'), 'sensemaking plan requires direct mechanism translation');
assert(classroomSensemakingPlan.includes('Cause/action hints') && classroomSensemakingPlan.includes('Object + cause -> action'), 'sensemaking plan requires specific cause/action hints instead of general instructions');
assert(classroomSensemakingPlan.includes('Clip as a spark, not a dependency') && classroomSensemakingPlan.includes('Generated loop') && classroomSensemakingPlan.includes('optional external URL'), 'sensemaking plan keeps clips optional and local-first');
assert(classroomSensemakingPlan.includes('Four-bar linkage') && classroomSensemakingPlan.includes('Cam follower') && classroomSensemakingPlan.includes('Gear train') && classroomSensemakingPlan.includes('Planetary gear'), 'sensemaking plan covers core mechanism families');
assert(classroomSensemakingPlan.includes('Assessment is local, formative, and one-tap') && classroomSensemakingPlan.includes('Teacher pack output') && classroomSensemakingPlan.includes('visual evidence cue'), 'sensemaking plan defines local assessment, evidence cues, and teacher-pack outputs');
assert(classroomSensemakingPlan.includes('No teacher dashboard') && classroomSensemakingPlan.includes('No required YouTube dependency'), 'sensemaking plan excludes server and mandatory streaming scope');
assert(CLASSROOM_LESSONS.some(lesson => lesson.id === 'waving-arm' && lesson.label === 'Waving arm' && lesson.actionLabel === 'Open lesson'), 'guided classroom lesson catalog exposes the waving-arm lesson as an English-only entry point');
const guidedLessonIds = ['waving-arm', 'head-bob', 'walking-leg', 'spin-gears'] as const;
assert.deepEqual(CLASSROOM_LESSONS.map(lesson => lesson.id), guidedLessonIds, 'Guide shows exactly four collision-free motion templates');
for (const id of guidedLessonIds) {
  assert(CLASSROOM_LESSONS.some(lesson => lesson.id === id), `${id} is present in the guided classroom theme library`);
  assert.equal(classroomLessonById(id)?.startStage, 'character', `${id} starts in Character for immediate ownership edits`);
}
const assertGuidedLessonContracts = () => {
const assertFrontFacingAnatomy = (project: ProjectState, label: string) => {
  const skeleton = project.skeleton;
  assert(skeleton, `${label} has skeleton for front-facing anatomy`);
  for (const [rightJointId, leftJointId] of [['right_shoulder', 'left_shoulder'], ['right_hand', 'left_hand'], ['right_hip', 'left_hip'], ['right_foot', 'left_foot']] as const) {
    const rightJoint: StandardJoint | undefined = skeleton.joints[rightJointId];
    const leftJoint: StandardJoint | undefined = skeleton.joints[leftJointId];
    assert(rightJoint && leftJoint, `${label} keeps ${rightJointId}/${leftJointId} joint ids`);
    assert(rightJoint.position.x < leftJoint.position.x, `${label} places anatomical ${rightJointId} at smaller scene X than ${leftJointId}`);
    assert(sceneToSvg(rightJoint.position).x < sceneToSvg(leftJoint.position).x, `${label} places anatomical ${rightJointId} at smaller screen X than ${leftJointId}`);
  }
  for (const jointId of ['root', 'hip', 'torso', 'neck', 'head_top'] as const) {
    assert(Math.abs((skeleton.joints[jointId]?.position.x ?? Number.NaN)) < 1e-9, `${label} keeps center joint ${jointId} centered`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(skeleton.joints).map(([id, joint]) => [id, joint.parentId])), {
    root: null,
    hip: 'root',
    torso: 'hip',
    neck: 'torso',
    head_top: 'neck',
    left_shoulder: 'torso',
    left_elbow: 'left_shoulder',
    left_hand: 'left_elbow',
    right_shoulder: 'torso',
    right_elbow: 'right_shoulder',
    right_hand: 'right_elbow',
    left_hip: 'root',
    left_knee: 'left_hip',
    left_foot: 'left_knee',
    right_hip: 'root',
    right_knee: 'right_hip',
    right_foot: 'right_knee'
  }, `${label} preserves humanoid joint hierarchy and ids while flipping only coordinates`);
  for (const [rightPartId, leftPartId] of [['right_arm_upper', 'left_arm_upper'], ['right_hand_part', 'left_hand_part'], ['right_leg_upper', 'left_leg_upper'], ['right_foot_part', 'left_foot_part']] as const) {
    const right = project.parts[rightPartId];
    const left = project.parts[leftPartId];
    assert(right && left, `${label} keeps ${rightPartId}/${leftPartId} part ids`);
    assert(right.transform.x < left.transform.x, `${label} places anatomical ${rightPartId} at smaller scene X than ${leftPartId}`);
    assert(sceneToSvg(right.transform).x < sceneToSvg(left.transform).x, `${label} places anatomical ${rightPartId} at smaller screen X than ${leftPartId}`);
  }
};
const assertBuiltInSampleExactReflection = (project: ProjectState) => {
  const skeleton = project.skeleton;
  assert(skeleton, 'built-in sample has skeleton for exact left/right reflection');
  for (const [rightJointId, leftJointId] of [['right_shoulder', 'left_shoulder'], ['right_elbow', 'left_elbow'], ['right_hand', 'left_hand'], ['right_hip', 'left_hip'], ['right_knee', 'left_knee'], ['right_foot', 'left_foot']] as const) {
    const rightX: number | undefined = skeleton.joints[rightJointId]?.position.x;
    const leftX: number | undefined = skeleton.joints[leftJointId]?.position.x;
    assert.equal(typeof rightX, 'number', `built-in sample keeps ${rightJointId}`);
    assert.equal(typeof leftX, 'number', `built-in sample keeps ${leftJointId}`);
    assert.equal(rightX! + leftX!, 0, `built-in sample ${rightJointId}/${leftJointId} joint X values are exact reflections`);
    assert.equal(Math.abs(rightX!), Math.abs(leftX!), `built-in sample ${rightJointId}/${leftJointId} joint X magnitudes match`);
  }
  assert.equal(Math.abs(skeleton.joints.right_hand.position.x), 128, 'built-in sample preserves the original hand joint X magnitude');
  for (const [rightPartId, leftPartId] of [['right_arm_upper', 'left_arm_upper'], ['right_arm_lower', 'left_arm_lower'], ['right_hand_part', 'left_hand_part'], ['right_leg_upper', 'left_leg_upper'], ['right_leg_lower', 'left_leg_lower'], ['right_foot_part', 'left_foot_part']] as const) {
    const right = project.parts[rightPartId];
    const left = project.parts[leftPartId];
    assert(right && left, `built-in sample keeps ${rightPartId}/${leftPartId}`);
    assert.equal(right.transform.x + left.transform.x, 0, `built-in sample ${rightPartId}/${leftPartId} part X values are exact reflections`);
    assert.equal(right.transform.rotation + left.transform.rotation, 0, `built-in sample ${rightPartId}/${leftPartId} rotations are exact reflections`);
    assert.equal(Math.abs(right.transform.x), Math.abs(left.transform.x), `built-in sample ${rightPartId}/${leftPartId} part X magnitudes match`);
  }
  const rightHandPart = project.parts.right_hand_part;
  assert(rightHandPart, 'built-in sample keeps right_hand_part');
  assert.equal(Math.abs(rightHandPart.transform.x), 134, 'built-in sample preserves the original hand part X magnitude');
};
assertFrontFacingAnatomy(starterSample, 'built-in sample humanoid');
assertBuiltInSampleExactReflection(starterSample);
for (const lesson of CLASSROOM_LESSONS) assertFrontFacingAnatomy(createLessonProject(lesson.id), `${lesson.id} guided lesson`);
assert(CLASSROOM_LESSONS.every(lesson => lesson.outcome && lesson.changeCue && lesson.buildCue && lesson.sensemaking?.directTranslation && lesson.sensemaking?.tryThis && lesson.sensemaking?.expectedAnswer && lesson.sensemaking?.evidenceCue && lesson.sensemaking?.clipSlot === 'generated-loop'), 'guided lesson entries carry result-first outcome, change cue, build cue, hidden sensemaking, check answers, evidence cues, and generated-loop clip slots');
for (const [type, metadata] of Object.entries(MECHANISM_TEMPLATE_LIBRARY)) {
  assert(metadata.classroomSensemaking.directTranslation, `${type} has direct translation sensemaking`);
  assert(metadata.classroomSensemaking.applicationCue, `${type} has an application cue`);
  assert(metadata.classroomSensemaking.tryThis, `${type} has a direct interaction prompt`);
  assert(metadata.classroomSensemaking.commonHint, `${type} has a specific cause/action hint`);
  assert(metadata.classroomSensemaking.teacherTakeaway, `${type} has a teacher takeaway`);
  assert(metadata.classroomSensemaking.studentCheck, `${type} has a one-tap student check`);
  assert(metadata.classroomSensemaking.expectedAnswer, `${type} has a teacher-pack expected answer`);
  assert(metadata.classroomSensemaking.evidenceCue, `${type} has an observable evidence cue`);
  assert.equal(metadata.classroomSensemaking.clipSlot, 'generated-loop', `${type} defaults to generated-loop clips instead of required streaming`);
}
assert.equal(emptyProject.settings.classroomAssessmentKey, DEFAULT_CLASSROOM_ASSESSMENT_KEY, 'empty projects default to the bundled classroom assessment key');
assert.equal(normalizeClassroomAssessmentKey(' Motion Journal!! '), 'motion-journal', 'teacher assessment keys normalize to stable slugs');
assert.equal(normalizeClassroomAssessmentKey('School A 2026!'), 'school-a-2026', 'custom school assessment keys preserve a shareable slug');
assert.equal(classroomAssessmentKeyFromSearch('?assessment=Motion%20Journal'), 'motion-journal', 'assessment query parameter selects a teacher prompt bundle');
assert.equal(classroomAssessmentKeyFromSearch('?assessmentKey=School%20A'), 'school-a', 'assessmentKey query parameter is also supported');
assert(CLASSROOM_ASSESSMENT_KEYS.includes('default') && CLASSROOM_ASSESSMENT_KEYS.includes('motion-journal'), 'classroom assessment bundles expose the default and motion-journal presets');
const customAssessment = loadProjectSnapshot({
  ...JSON.parse(serializeProject(emptyProject)),
  settings: { ...emptyProject.settings, classroomAssessmentKey: 'School A 2026!' }
});
assert.equal(customAssessment.settings.classroomAssessmentKey, 'school-a-2026', 'custom assessment keys persist as sanitized local settings');
const fallbackAssessment = resolveClassroomAssessmentBundle(customAssessment.settings.classroomAssessmentKey);
assert.equal(fallbackAssessment.requestedKey, 'school-a-2026', 'unknown classroom assessment slug stays recoverable for teacher pack handoff');
assert.equal(fallbackAssessment.activeKey, 'default', 'unknown classroom assessment slug falls back to the bundled default prompts');
assert.equal(fallbackAssessment.isFallback, true, 'unknown classroom assessment slug reports fallback status');
assert.equal(classroomAssessmentStatusText(fallbackAssessment), CLASSROOM_COPY.assessmentFallback, 'fallback assessment status copy is owned by the classroom content seam');
assert.equal(classroomAssessmentKeyHint(), 'Try: default, motion-journal', 'assessment key hint copy is owned by the classroom content seam');
assert(classroomAssessmentFor('4bar', 'motion-journal').prompt.includes('motion'), 'alternate assessment bundle changes the prompt copy');
assert.equal(classroomCueTitleFor('foundry'), CLASSROOM_COPY.cueTitle.foundry, 'classroom cue titles are centralized for stage use');
assert.equal(formatClassroomAssessmentPrompt(classroomAssessmentFor('4bar', 'default')), 'Check: Which two pivots stay fixed on the board?', 'assessment prompt prefix formatting is centralized');
const serializedLessonForContentCheck = serializeProject(createLessonProject('waving-arm'));
assert(!serializedLessonForContentCheck.includes('youtube.com') && !serializedLessonForContentCheck.includes('youtube-nocookie'), 'serialized ProjectState does not store external classroom video URLs');
assert(!serializedLessonForContentCheck.includes('What changed in the') && !serializedLessonForContentCheck.includes('Which two pivots stay fixed'), 'serialized ProjectState stores assessment keys, not assessment prompt copy');
for (const type of ALL_MECHANISM_TYPES) {
  const example = classroomUseExampleFor(type);
  assert.equal(example.mechanismType, type, `${type} classroom use example matches its mechanism type`);
  assert(example.useCase && example.generatedSummary && example.watchFor && example.studentQuestion, `${type} has a generated/local mechanism-use explanation, observation cue, and student question`);
  assert(formatClassroomUseExampleLabel(example).startsWith(`${CLASSROOM_COPY.useExamplePrefix}:`), `${type} use-example label formatting is centralized`);
  assert.equal(example.clipSlot, 'generated-loop', `${type} keeps generated/local loops as the primary classroom video path`);
  assert.equal(example.optionalVideoSource, 'youtube-nocookie', `${type} carries a required classroom YouTube source`);
  assert(example.youtubeId && example.reviewed, `${type} has a reviewed YouTube video id for classroom usage examples`);
  const embedUrl = youtubeNoCookieEmbedUrl(example.youtubeId);
  assert(embedUrl?.startsWith('https://www.youtube-nocookie.com/embed/'), `${type} optional browser video uses the privacy-enhanced embed host`);
  assert(!embedUrl?.includes('autoplay'), `${type} optional browser video does not autoplay`);
}
assert(classroomExampleVideoSource.includes('data-testid="classroom-generated-loop"') && classroomExampleVideoSource.includes('fitMechanismSimulation(mechanism, phase') && classroomExampleVideoSource.includes('<MechanismLinkagePreview'), 'classroom example video component shows a local generated loop from the shared mechanism simulation/preview path before any optional external iframe');
assert(classroomExampleVideoSource.includes('prefers-reduced-motion: reduce') && classroomExampleVideoSource.includes('if (reducedMotion) return;') && classroomExampleVideoSource.includes('data-reduced-motion'), 'classroom generated loops respect reduced-motion by not starting the animation loop');
assert(classroomExampleVideoSource.includes('Watch for:') && classroomExampleVideoSource.includes('Think:') && classroomExampleVideoSource.includes('data-youtube-id'), 'classroom example video exposes a compact observation cue, student question, and explicit YouTube source id');
assert.equal(CLASSROOM_COPY.videoUnavailable, 'Video unavailable. Use the generated loop.', 'video fallback copy is owned by the classroom content seam');
assert(classroomExampleVideoSource.includes('data-testid="classroom-video-fallback"') && classroomExampleVideoSource.includes('CLASSROOM_COPY.videoUnavailable'), 'classroom example video component keeps a local fallback if an optional external video is blocked');
assert(classroomExampleVideoSource.includes('sandbox="allow-scripts allow-same-origin allow-presentation"') && classroomExampleVideoSource.includes('referrerPolicy="strict-origin-when-cross-origin"') && !classroomExampleVideoSource.includes('clipboard-write') && !classroomExampleVideoSource.includes('gyroscope') && !classroomExampleVideoSource.includes('web-share'), 'optional classroom video embeds use restricted iframe permissions');

assert.equal(classroomLessonById('waving-arm')?.startStage, 'character', 'classroom lesson opens in Character so students inspect/edit the rig before drawing');
for (const lesson of CLASSROOM_LESSONS) {
  const lessonProjectState = createLessonProject(lesson.id);
  const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(lessonProjectState)));
  const authoredMechanism = lessonProjectState.mechanisms[0];
  const authoredPath = authoredMechanism?.targetPathId ? lessonProjectState.paths[authoredMechanism.targetPathId] : undefined;
  const reloadedMechanism = roundTrip.mechanisms[0];
  const reloadedPath = reloadedMechanism?.targetPathId ? roundTrip.paths[reloadedMechanism.targetPathId] : undefined;

  assert.equal(roundTrip.metadata.classroomLessonId, lesson.id, `${lesson.id} carries classroom lesson metadata`);
  assert.equal(roundTrip.metadata.classroomLessonLabel, lesson.label, `${lesson.id} carries classroom lesson label`);
  assert(roundTrip.skeleton && Object.keys(roundTrip.skeleton.joints).length >= 17, `${lesson.id} creates a real editable skeleton`);
  assert(Object.keys(roundTrip.parts).length >= 14, `${lesson.id} creates real editable body parts`);
  assert(roundTrip.partOrder.length >= 14, `${lesson.id} creates a real part order`);
  assert(roundTrip.settings.physicalKit.gridPitchMm > 0, `${lesson.id} carries real fabrication settings`);
  assert.equal(roundTrip.processing.stage, 'ready', `${lesson.id} returns ready ProjectState`);
  assert.equal(roundTrip.mechanisms.length, 1, `${lesson.id} creates one real editable mechanism`);
  assert.equal(roundTrip.selectedMechanismId, roundTrip.mechanisms[0].id, `${lesson.id} selects its mechanism`);
  assert((roundTrip.mechanisms[0].generatedPath?.length ?? 0) >= 3, `${lesson.id} mechanism has generated motion samples`);
  assert(authoredPath && reloadedPath, `${lesson.id} keeps its authored target path through serialize/load`);
  assert.deepEqual(reloadedPath.points, authoredPath.points, `${lesson.id} serialize/load preserves exact authored path points`);
  assert.deepEqual(reloadedPath.timedPoints, authoredPath.timedPoints, `${lesson.id} serialize/load preserves exact authored path timing`);
  assert.deepEqual(reloadedMechanism.generatedPath, authoredMechanism.generatedPath, `${lesson.id} serialize/load preserves exact generatedPath samples`);
  assert.deepEqual(reloadedMechanism.generatedPath, reloadedPath.points, `${lesson.id} reload keeps generatedPath aligned with its authored path`);
  const lessonFabrication = validateForFabrication(roundTrip);
  assert.deepEqual(lessonFabrication.errors, [], `${lesson.id} has no fabrication errors`);
  assert.deepEqual(lessonFabrication.warnings, [], `${lesson.id} has no fabrication warnings`);
  const feasibleRange = sampleFeasibleRange(roundTrip.mechanisms[0], 96);
  assert.equal(feasibleRange.warning, null, `${lesson.id} samples a natural collision-free motion`);
  assert.equal(feasibleRange.percentValid, 1, `${lesson.id} has 100% valid sampled motion`);
  const liveRecipe = pendingRecipeForMechanism(roundTrip, roundTrip.mechanisms[0]);
  assert.deepEqual(liveRecipe.warnings, [], `${lesson.id} assembly recipe has no warnings`);
  assert(buildAssemblyPlaybackSteps(liveRecipe, 'kit').length > 0, `${lesson.id} has kit mechanism assembly steps`);
  const lessonAssemblyModel = buildAssemblyGuideModel({ project: roundTrip, selectedRecipeId: roundTrip.mechanisms[0].id, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
  assert.equal(lessonAssemblyModel.selectedRecipe?.mechanismId, roundTrip.mechanisms[0].id, `${lesson.id} assembly selects its live mechanism recipe`);
  assert(lessonAssemblyModel.activeStepCount > 0, `${lesson.id} assembly has playable steps`);
  assert(buildCharacterAssemblyPlan(roundTrip).steps.length > 0, `${lesson.id} keeps character assembly steps`);
}
assert.equal(classroomLesson.metadata.classroomLessonId, 'waving-arm', 'lesson ProjectState carries resettable classroom lesson metadata');
assert.equal(classroomLesson.metadata.classroomLessonLabel, 'Waving arm', 'lesson ProjectState keeps the English-only classroom label');
assert.equal(classroomLesson.mechanisms.length, 1, 'waving-arm lesson includes one real fitted mechanism instead of a mock recommendation card');
assert.equal(classroomLesson.selectedPathId, 'path-right-arm', 'waving-arm lesson selects the editable hand path');
assert.equal(classroomLesson.selectedMechanismId, 'mech-1', 'waving-arm lesson selects the fitted four-bar mechanism');
assert.equal(classroomLesson.paths['path-right-arm'].partId, 'right_hand_part', 'waving-arm lesson targets the hand part instead of the lower arm plate');
assert.equal(classroomLesson.mechanisms[0].targetPartId, 'right_hand_part', 'waving-arm mechanism binds to the hand part instead of the lower arm plate');
assert.equal(classroomLesson.mechanisms[0].targetAnchorJointId, 'right_hand', 'waving-arm lesson drives the hand end-effector');

assert((classroomLesson.mechanisms[0].generatedPath?.length ?? 0) >= 3, 'waving-arm lesson mechanism has generated motion samples for simulation and fit checks');
const classroomLessonRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject(classroomLesson)));
assert.equal(classroomLessonRoundTrip.mechanisms[0].groundLength, classroomLesson.mechanisms[0].groundLength, 'lesson load preserves fitted mechanism geometry');
assert(!validateForFabrication(classroomLessonRoundTrip).errors.some(error => error.includes('path outside sheet')), 'lesson load stays blueprint-ready');
const recommendationAuditProject: ProjectState = {
  ...classroomLesson,
  mechanisms: [],
  selectedMechanismId: undefined,
  settings: {
    ...classroomLesson.settings,
    physicalKit: {
      ...classroomLesson.settings.physicalKit,
      sheetWidthMm: 1_000,
      sheetHeightMm: 1_000,
    },
  },
};
const wavingPathForRecommendations = recommendationAuditProject.paths['path-right-arm'];
const wavingRecommendations = buildMechanismRecommendations(recommendationAuditProject, recommendationAuditProject.parts[wavingPathForRecommendations.partId], wavingPathForRecommendations);
const wavingFourBarRecommendation = wavingRecommendations[0];
assert(wavingFourBarRecommendation, 'recommendation audit keeps a fabrication-ready card for the classroom hand-wave path');
assert.deepEqual(wavingFourBarRecommendation!.fabricationErrors, [], 'recommendation card is fabrication-ready instead of hidden by path-outside validation');
assert.deepEqual(validateForFabrication({ ...recommendationAuditProject, mechanisms: [wavingFourBarRecommendation!.mechanism] }).errors, [], 'recommendation board fit validates against physical generated motion, not only the stored preview trace');
const insertedWavingRecommendationProject = applyProjectAction(recommendationAuditProject, {
  type: 'upsert_mechanism',
  mechanism: wavingFourBarRecommendation!.mechanism,
});
const insertedWavingRecommendation = insertedWavingRecommendationProject.mechanisms.find(mechanism => mechanism.id === wavingFourBarRecommendation!.mechanism.id);
assert(insertedWavingRecommendation, 'recommendation insertion stores the selected recommended mechanism');
assert.equal(
  mechanismEditIsSafe(insertedWavingRecommendation, insertedWavingRecommendationProject.settings.physicalKit),
  true,
  'newly inserted recommendation mechanisms stay safe through the public upsert seam'
);
const recommendationSheetMarkup = renderToString(createElement(MechanismRecommendationSheet, {
  isOpen: true,
  project: recommendationAuditProject,
  selectedPart: recommendationAuditProject.parts[wavingPathForRecommendations.partId],
  selectedPath: wavingPathForRecommendations,
  onClose: () => undefined,
  onApply: () => undefined,
}));
const recommendationPrimaryCopyViolations = [
  /Fit score\s+\d+\/100/.test(recommendationSheetMarkup) ? 'raw fit score appears in recommendation primary copy' : '',
  /class="recommendation-score"[^>]*>\d+</.test(recommendationSheetMarkup) ? 'standalone raw recommendation score appears in primary copy' : '',
  /Loose fit score\s+\d+/i.test(recommendationSheetMarkup) ? 'loose fit score appears in recommendation primary copy' : '',
  /Motion \d+%|°|·/.test(recommendationSheetMarkup) ? 'raw motion diagnostic appears in recommendation primary copy' : '',
  /Score \${option\.score}\/100/.test(readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'MechanismRecommendationSheet.tsx'), 'utf8')) ? 'applied recommendation stores raw score in student copy' : '',
].filter(Boolean);
g006StudentWarningCopyViolations.push(...recommendationPrimaryCopyViolations.map(violation => `recommendation: ${violation}`));
assert.equal(typeof wavingFourBarRecommendation!.score, 'number', 'recommendation keeps structured technical score outside primary copy');
assert.equal(compactStudentActionForFabricationDiagnostic('Motion 83% · 0°–120°'), 'Motion may jam. Try a smaller move.', 'raw partial-motion diagnostics become compact student action copy');
assert.equal(compactStudentActionForFabricationDiagnostic('No motion'), 'No full motion. Try reset or smaller links.', 'raw no-motion diagnostics become compact student action copy');
assert.equal(compactStudentActionForFabricationDiagnostic('Fix: snap gear pitch.'), 'Fix: snap gear pitch.', 'unrelated fabrication blockers are unchanged');
const assertGuidedPathStaysViewerLeft = (project: ProjectState, pathId: string, label: string) => {
  const torsoX = project.skeleton?.joints.torso.position.x;
  assert.equal(typeof torsoX, 'number', `${label} has a torso centerline`);
  const path = project.paths[pathId];
  assert(path, `${label} path exists`);
  assert(path.points.every(point => point.x < torsoX!), `${label} stays wholly on anatomical right / viewer-left side`);
};
const assertGuidedPathYAboveJoint = (project: ProjectState, pathId: string, jointId: string, label: string) => {
  const joint = project.skeleton?.joints[jointId]?.position;
  const path = project.paths[pathId];
  assert(joint && path, `${label} has resting joint and path`);
  assert(path.points.every(point => point.y > joint.y), `${label} full motion stays above resting ${jointId}`);
};
const assertGuidedMechanismDrivesViewerLeft = (project: ProjectState, pathId: string, label: string) => {
  const path = project.paths[pathId];
  const mechanism = project.mechanisms[0];
  const target = path?.targetAnchorJointId ? project.skeleton?.joints[path.targetAnchorJointId]?.position : undefined;
  const torso = project.skeleton?.joints.torso.position;
  assert(path && mechanism && target && torso, `${label} has a path, mechanism, target joint, and torso`);
  assert((mechanism.anchorX ?? Infinity) <= torso.x, `${label} mechanism anchor stays at or left of the character centerline`);
  assert(Math.cos(((mechanism.groundAngle ?? 0) * Math.PI) / 180) < 0, `${label} ground/link direction points toward the viewer-left target path`);
};
const assertGuidedMechanismDrivesInwardFromViewerLeft = (project: ProjectState, pathId: string, label: string) => {
  const path = project.paths[pathId];
  const mechanism = project.mechanisms[0];
  const target = path?.targetAnchorJointId ? project.skeleton?.joints[path.targetAnchorJointId]?.position : undefined;
  assert(path && mechanism && target, `${label} has a path, mechanism, and target joint`);
  assert((mechanism.anchorX ?? Infinity) < target.x, `${label} mechanism anchor is farther outward on viewer-left than its target joint`);
  assert(Math.cos(((mechanism.groundAngle ?? 0) * Math.PI) / 180) > 0, `${label} ground/link direction points back toward the target`);
};
assertGuidedPathStaysViewerLeft(classroomLesson, 'path-right-arm', 'waving-arm hand path');
assertGuidedPathYAboveJoint(classroomLesson, 'path-right-arm', 'right_hand', 'waving-arm hand path');
assert(
  Math.max(...classroomLesson.paths['path-right-arm'].points.map(point => point.y)) > classroomLesson.skeleton!.joints.right_shoulder.position.y,
  'waving-arm hand path rises above the resting right shoulder instead of only fitting its generated trace',
);
assertGuidedMechanismDrivesViewerLeft(classroomLesson, 'path-right-arm', 'waving-arm mechanism');
const generatedPathReachLimit = (project: ProjectState, path: ProjectMotionPath) => {
  const skeleton = project.skeleton;
  if (!skeleton || !path.chainRootJointId || !path.targetAnchorJointId) return Number.POSITIVE_INFINITY;
  let joint = skeleton.joints[path.targetAnchorJointId];
  let reach = 0;
  while (joint?.parentId) {
    const parent = skeleton.joints[joint.parentId];
    if (!parent) break;
    reach += Math.hypot(joint.position.x - parent.position.x, joint.position.y - parent.position.y);
    if (parent.id === path.chainRootJointId) return reach;
    joint = parent;
  }
  return Number.POSITIVE_INFINITY;
};

const assertGuidedMechanismsStoreAuthoredPaths = () => {
  const projectSourceForGuidedLessons = readFileSync(join(process.cwd(), 'utils', 'project.ts'), 'utf8');
  const guidedLessonTimingSource = readFileSync(join(process.cwd(), 'utils', 'guidedLessonTiming.ts'), 'utf8');
  const createLessonProjectSource = projectSourceForGuidedLessons.match(/export const createLessonProject[\s\S]*?export const resetProjectToLessonBaseline/)?.[0] ?? '';
  assert(/fitMechanismToTargetPath/.test(createLessonProjectSource), 'createLessonProject fits guided mechanisms through the shared path fitter before storage');
  assert(!/compactGeneratedPathControlPoints/.test(createLessonProjectSource), 'createLessonProject preserves authored lesson paths instead of rewriting them from mechanism samples');
  assert(!/mechanismGeneratedPath|generateCurvePoints\(|calculateLinkage\(|primaryFoundryPlaybackPath\(/.test(guidedLessonTimingSource), 'guided lesson phase timing stays authored and physical-law based instead of sampling runtime mechanism output');
  assert(!/sheetWidthMm|boardCells/.test(createLessonProjectSource), 'createLessonProject does not mutate physical kit dimensions to make guided mechanisms fit');
  const failures: string[] = [];
  for (const lesson of CLASSROOM_LESSONS) {
    const authoredStarter = createSampleProject({ includeMechanism: lesson.id === 'waving-arm' });
    const authoredSkeleton = authoredStarter.skeleton!;
    const authoredPath = (() => {
      if (lesson.id === 'waving-arm') return authoredStarter.paths['path-right-arm'];
      if (lesson.id === 'head-bob') {
        const headTop = authoredSkeleton.joints.head_top.position;
        return {
          points: [
            { x: headTop.x, y: headTop.y - 4.8 },
            { x: headTop.x, y: headTop.y - 2.4 },
            { x: headTop.x, y: headTop.y },
            { x: headTop.x, y: headTop.y - 2.4 },
          ],
          closed: false,
        };
      }
      if (lesson.id === 'walking-leg') {
        const hip = authoredSkeleton.joints.right_hip.position;
        const foot = authoredSkeleton.joints.right_foot.position;
        const side = Math.sign(foot.x - hip.x) || 1;
        const mirror = -side;
        return {
          points: [
            { x: -62, y: -49.589 },
            { x: -71.382, y: -23.607 },
            { x: -73.157, y: -17.743 },
            { x: -64.269, y: -43.898 },
            { x: -53.154, y: -69.187 },
            { x: -39.905, y: -93.426 },
            { x: -24.617, y: -116.434 },
            { x: -7.408, y: -138.041 },
            { x: -3.346, y: -142.627 },
            { x: -20.967, y: -121.354 },
            { x: -36.696, y: -98.645 },
            { x: -50.407, y: -74.664 },
          ].map(offset => ({ x: hip.x + offset.x * mirror, y: hip.y + offset.y })),
          closed: true,
        };
      }
      const shoulder = authoredSkeleton.joints.right_shoulder.position;
      const hand = authoredSkeleton.joints.right_hand.position;
      const gearRadii: [number, number] = [60, 60];
      const gridStep = authoredStarter.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM;
      const anchorX = -2 * gridStep;
      const anchorY = 120;
      const groundAngle = hand.y <= shoulder.y ? (Math.PI * 3) / 2 : Math.PI / 2;
      const center = {
        x: anchorX + (gearRadii[0] + gearRadii[1]) * Math.cos(groundAngle),
        y: anchorY + (gearRadii[0] + gearRadii[1]) * Math.sin(groundAngle),
      };
      const outputAttachmentRadius = 40;
      const outputAttachmentAngle = -Math.PI / 2;
      return {
        points: Array.from({ length: 8 }, (_, index) => {
          const angle = (index / 8) * Math.PI * 2;
          return {
            x: center.x + outputAttachmentRadius * Math.cos(angle + outputAttachmentAngle),
            y: center.y + outputAttachmentRadius * Math.sin(angle + outputAttachmentAngle),
          };
        }),
        closed: true,
      };
    })();
    const project = createLessonProject(lesson.id);
    const mechanism = project.mechanisms[0];
    if (!mechanism) {
      failures.push(`${lesson.id}: missing mechanism`);
      continue;
    }
    const path = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    if (!path) {
      failures.push(`${lesson.id}: missing target path ${mechanism.targetPathId ?? '<none>'}`);
      continue;
    }
    assert.deepEqual(path.points, authoredPath.points, `${lesson.id} preserves its independently constructed authored path points`);
    assert.equal(path.closed, authoredPath.closed, `${lesson.id} preserves its authored open/closed path contract`);
    assert((path.timedPoints?.length ?? 0) >= 24, `${lesson.id} carries explicit phase keyframes instead of falling back to arc-length timing`);
    if (path.closed) {
      assert((path.timedPoints?.at(-1)?.time ?? path.duration) < path.duration, `${lesson.id} reserves the final closed-path interval for the return to its first phase keyframe`);
    }
    const fabrication = validateForFabrication(project);
    if (fabrication.errors.length || fabrication.warnings.length) {
      failures.push(`${lesson.id}: fabrication ${JSON.stringify({ errors: fabrication.errors, warnings: fabrication.warnings })}`);
    }
    const expectedTargetFields = pathOwnedTargetFields(path);
    assert.deepEqual({
      targetPartId: mechanism.targetPartId,
      targetSceneObjectId: mechanism.targetSceneObjectId,
      targetPathId: mechanism.targetPathId,
      targetAnchorJointId: mechanism.targetAnchorJointId,
      activeVisualPartIds: mechanism.activeVisualPartIds,
    }, expectedTargetFields, `${lesson.id} mechanism target ownership follows its authored path`);
    const generated = mechanism.generatedPath ?? [];
    assert.deepEqual(generated, path.points, `${lesson.id} stored generatedPath matches its authored path`);
    const root = project.skeleton?.joints[path.chainRootJointId ?? ''];
    const reach = generatedPathReachLimit(project, path);
    if (root && Number.isFinite(reach)) {
      const maxReach = Math.max(...generated.map((point) => Math.hypot(point.x - root.position.x, point.y - root.position.y)));
      if (maxReach > reach + 1e-6) {
        failures.push(`${lesson.id}: generated reach ${maxReach.toFixed(2)} > ${reach.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, [], 'guided lesson mechanisms persist authored generatedPath samples within reach and fabrication thresholds');
};
assertGuidedMechanismsStoreAuthoredPaths();
assert(classroomLesson.paths['path-right-arm'].points.length <= 12, 'waving-arm built-in path stays a compact editable baseline instead of storing all runtime samples');
const occupiedAnchorRecommendations = buildMechanismRecommendations(classroomLesson, classroomLesson.parts[classroomLesson.selectedPartId!], classroomLesson.paths['path-right-arm']);
const occupiedFourBarRecommendation = occupiedAnchorRecommendations.find(option => option.type === '4bar');
assert.equal(occupiedFourBarRecommendation, undefined, 'recommendations do not retarget an occupied hand path to a parent limb');
const guidedChainReach = (project: ProjectState, jointIds: string[]) => {
  const skeleton = project.skeleton;
  assert(skeleton, 'guided project has skeleton');
  return jointIds.slice(1).reduce((sum, jointId, index) => {
    const a = skeleton.joints[jointIds[index]]?.position;
    const b = skeleton.joints[jointId]?.position;
    assert(a && b, `guided chain joint ${jointIds[index]} -> ${jointId} exists`);
    return sum + Math.hypot(a.x - b.x, a.y - b.y);
  }, 0);
};
const assertGuidedPathUsesReach = (project: ProjectState, pathId: string, chainJointIds: string[], minMaxRatio = 0.7, minMinRatio = 0.25) => {
  const skeleton = project.skeleton;
  assert(skeleton, `${pathId} has skeleton`);
  const path = project.paths[pathId];
  assert(path, `${pathId} exists`);
  assert.equal(path.chainRootJointId, chainJointIds[0], `${pathId} starts at the expected IK root`);
  const root = skeleton.joints[chainJointIds[0]]?.position;
  assert(root, `${pathId} root exists`);
  const reach = guidedChainReach(project, chainJointIds);
  const distances = path.points.map(point => Math.hypot(point.x - root.x, point.y - root.y));
  const max = Math.max(...distances);
  const min = Math.min(...distances);
  assert(max <= reach + 1e-6, `${pathId} stays inside the ${chainJointIds.join(' -> ')} reach envelope`);
  assert(max >= reach * minMaxRatio, `${pathId} uses enough available rig reach to avoid a cramped template`);
  assert(min >= reach * minMinRatio, `${pathId} keeps the template away from the root joint instead of collapsing onto the shoulder/hip`);
};
assertGuidedPathUsesReach(classroomLesson, 'path-right-arm', ['right_shoulder', 'right_elbow', 'right_hand'], 0.78, 0.04);
const headBobLesson = createLessonProject('head-bob');
const headBobMechanism = headBobLesson.mechanisms[0];
assert(headBobMechanism, 'head-bob has a mechanism');
assert.equal(headBobMechanism.type, 'cam', 'head-bob guided theme creates a real cam mechanism baseline');
assert.equal(headBobLesson.selectedPathId, 'path-head-bob', 'head-bob guided theme creates an editable head lift path');
assert.equal(headBobLesson.paths['path-head-bob'].targetAnchorJointId, 'head_top', 'head-bob drives the top head joint instead of collapsing to the neck');
assert.equal(sceneToBoard({ x: headBobMechanism.anchorX ?? 0, y: headBobMechanism.anchorY ?? 0 }, headBobLesson.settings.physicalKit).valid, true, 'head-bob cam driver stays on a kit board hole');
assertGuidedPathUsesReach(headBobLesson, 'path-head-bob', ['neck', 'head_top'], 0.45);
const walkingLegLesson = createLessonProject('walking-leg');
const walkingLegMechanism = walkingLegLesson.mechanisms[0];
assert(walkingLegMechanism, 'walking-leg has a mechanism');
assert.equal(walkingLegMechanism.type, '4bar', 'walking-leg guided theme creates a real four-bar mechanism baseline');
assert.equal(walkingLegLesson.selectedPathId, 'path-right-foot-step', 'walking-leg guided theme creates an editable foot path');
assert.equal(walkingLegLesson.paths['path-right-foot-step'].partId, 'right_foot_part', 'walking-leg drives the foot part instead of the lower leg plate');
assert.equal(walkingLegMechanism.targetPartId, 'right_foot_part', 'walking-leg mechanism binds to the foot part instead of the lower leg plate');
assertGuidedPathStaysViewerLeft(walkingLegLesson, 'path-right-foot-step', 'walking-leg foot path');
{
  const restingFoot = walkingLegLesson.skeleton!.joints.right_foot.position;
  const points = walkingLegLesson.paths['path-right-foot-step'].points;
  assert(Math.min(...points.map(point => point.x)) < restingFoot.x && Math.max(...points.map(point => point.x)) > restingFoot.x, 'walking-leg foot path spans both sides of the resting right foot x');
  assert(Math.min(...points.map(point => Math.hypot(point.x - restingFoot.x, point.y - restingFoot.y))) <= 40, 'walking-leg foot path starts near the resting foot before using the full reachable leg motion');
}
assertGuidedMechanismDrivesInwardFromViewerLeft(walkingLegLesson, 'path-right-foot-step', 'walking-leg mechanism');

assertGuidedPathUsesReach(walkingLegLesson, 'path-right-foot-step', ['right_hip', 'right_knee', 'right_foot'], 0.7);
const spinGearsLesson = createLessonProject('spin-gears');
const spinGearsMechanism = spinGearsLesson.mechanisms[0];
assert.equal(spinGearsLesson.mechanisms[0]?.type, 'gear', 'spin-gears guided theme creates a real gear mechanism baseline');
assert.equal(spinGearsLesson.selectedPathId, 'path-gear-spin', 'spin-gears guided theme includes a visible hand path for Design/Assembly validation');
assert.equal(spinGearsLesson.mechanisms[0]?.targetPartId, 'right_hand_part', 'spin-gears lesson binds the gear motion to the hand part');
assertGuidedPathStaysViewerLeft(spinGearsLesson, 'path-gear-spin', 'spin-gears hand path');
assert((spinGearsMechanism.anchorX ?? Infinity) < spinGearsLesson.skeleton!.joints.torso.position.x, 'spin-gears mechanism anchor stays on viewer-left');
const spinGearCenters = gearTrainCenters(spinGearsLesson.mechanisms[0]);
assert.deepEqual(spinGearsLesson.mechanisms[0]?.gearTrainRadii, [60, 60], 'spin-gears uses attachment-capable endpoint gears near the hand');
const spinGearTarget = spinGearsLesson.skeleton!.joints.right_hand.position;
const spinGearOutput = spinGearCenters.at(-1)!;
assert(spinGearCenters.every(center => center.x < spinGearsLesson.skeleton!.joints.torso.position.x), 'spin-gears keeps both board-mounted gears on viewer-left');
assert(
  Math.hypot(spinGearOutput.x - spinGearTarget.x, spinGearOutput.y - spinGearTarget.y) <
    Math.hypot(spinGearCenters[0].x - spinGearTarget.x, spinGearCenters[0].y - spinGearTarget.y),
  'spin-gears output gear moves from its viewer-left board anchor toward the hand',
);
assert.throws(() => createLessonProject('missing' as never), /Unknown classroom lesson/, 'invalid classroom lesson IDs fail loudly instead of silently creating blank projects');
};
assertGuidedLessonContracts();
const resetLessonState = resetProjectToLessonBaseline({
  ...classroomLesson,
  selectedPartId: 'head',
  mechanisms: [],
  settings: { ...classroomLesson.settings, animationSpeed: 1.7 }
});
assert(resetLessonState, 'classroom lesson can reset to a durable baseline');
assert.equal(resetLessonState?.settings.animationSpeed, 1.7, 'lesson reset preserves app settings while restoring lesson content');
assert.equal(resetLessonState?.mechanisms.length, 1, 'lesson reset restores the fitted mechanism');
assert.equal(resetLessonState?.selectedPartId, 'right_hand_part', 'lesson reset restores the lesson selection baseline');
assert.equal(emptyProject.partOrder.length, 0, 'empty project starts with no preloaded character parts');
assert.equal(emptyProject.mechanisms.length, 0, 'empty project starts with no hidden mechanism');
assert.equal(emptyProject.selectedMechanismId, undefined, 'empty project starts with no selected mechanism');
assert.equal(starterSample.mechanisms.length, 0, 'default starter character opens clean with no demo mechanism');
assert(starterSample.parts.torso.bounds.width >= 128 && starterSample.parts.torso.bounds.height >= 190, 'default humanoid starter uses a broad torso plate that can carry shoulder and hip pivots without looking disconnected');
assert(starterSample.parts.left_arm_upper.bounds.height >= 100 && starterSample.parts.left_arm_lower.bounds.height >= 100 && starterSample.parts.right_arm_upper.bounds.height >= 100 && starterSample.parts.right_arm_lower.bounds.height >= 100, 'default humanoid starter uses full upper/lower arm plates instead of stubby disconnected pieces');
assert(starterSample.parts.left_leg_upper.bounds.height >= 108 && starterSample.parts.left_leg_lower.bounds.height >= 112 && starterSample.parts.right_leg_upper.bounds.height >= 108 && starterSample.parts.right_leg_lower.bounds.height >= 112, 'default humanoid starter uses assembly-ready upper/lower leg plates with enough overlap for visible joints');
assert(starterSample.skeleton, 'default humanoid starter includes a rig before checking plate coverage');
for (const partId of starterSample.partOrder) {
  const part = starterSample.parts[partId];
  const landmarkIds = partLandmarkJointIds(part, starterSample.skeleton);
  const localLandmarks = landmarkIds.map(jointId => {
    const joint = starterSample.skeleton!.joints[jointId];
    assert(joint, `${partId} landmark ${jointId} exists`);
    return partWorldPointToLocal(part, joint.position);
  });
  const outline = fabricablePartOutlinePoints(part, localLandmarks);
  localLandmarks.forEach((point, index) => {
    assert(pointInsideOutline(point, outline, 0.5), `${partId} starter plate covers rig joint ${landmarkIds[index]}`);
  });
}
assert(Object.keys(sample.skeleton?.joints ?? {}).length >= 17, 'sample placeholder exposes the full editable joint set');
for (const requiredPartId of ['left_arm_upper', 'left_arm_lower', 'left_hand_part', 'right_arm_upper', 'right_arm_lower', 'right_hand_part', 'left_leg_upper', 'left_leg_lower', 'left_foot_part', 'right_leg_upper', 'right_leg_lower', 'right_foot_part']) {
  assert(requiredPartId in sample.parts, `humanoid starter includes ${requiredPartId}`);
}
assert(sample.partOrder.every(id => ['#cbd5e1', '#e2e8f0', '#b6c2d2', '#d1d5db', '#94a3b8'].includes(sample.parts[id].fillColor)), 'sample character uses muted placeholder part colors');
assert.equal(sample.mechanisms[0].targetAnchorJointId, 'right_hand', 'sample waving arm drives the hand, not the shoulder root');
assert.deepEqual(motionAnchorJointIds(sample, 'right_arm_lower'), ['right_elbow', 'right_hand'], 'IK handle choices stay inside the selected lower-limb part');
assert.equal(pathBelongsToTarget(sample.paths['path-right-arm'], 'part', 'right_hand_part', sample), true, 'character path belongs to its exact part owner');
assert.equal(pathBelongsToTarget(sample.paths['path-right-arm'], 'part', 'right_arm_lower', sample), false, 'character path is not owned by an ancestor part that can reach the same joint');
assert.deepEqual(motionChainRootJointIds(sample, 'right_arm_lower', 'right_hand'), ['right_shoulder', 'right_elbow', 'right_hand'], 'IK chain root choices expose every ancestor from part root to handle');
assert.deepEqual(motionChainRootJointIds(sample, 'right_hand_part', 'right_hand'), ['right_shoulder', 'right_elbow', 'right_hand'], 'hand targets can still drive the whole arm IK chain');
assert.deepEqual(motionChainRootJointIds(sample, 'right_foot_part', 'right_foot'), ['right_hip', 'right_knee', 'right_foot'], 'foot targets can still drive the whole leg IK chain');
assert.equal(preferredMotionJointId(sample, 'right_arm_lower', 'left_hand'), 'right_elbow', 'invalid IK anchor falls back to the target part root');
{
  const invalidAnchorMechanism = {
    ...sample.mechanisms[0],
    id: 'missing-anchor-driver',
    targetAnchorJointId: 'removed_target_joint',
  };
  const invalidAnchorProject: ProjectState = {
    ...sample,
    mechanisms: [invalidAnchorMechanism],
    selectedMechanismId: invalidAnchorMechanism.id,
  };
  assert.deepEqual(mechanismBindingWarnings(invalidAnchorProject, [invalidAnchorMechanism])[invalidAnchorMechanism.id], ['Fix: Choose anchor'], 'missing target anchor joint reports the authoritative recovery action');
  const invalidPreview = motionPreviewForProject(invalidAnchorProject, [invalidAnchorMechanism], Math.PI / 3);
  assert.deepEqual(invalidPreview.skeleton, invalidAnchorProject.skeleton, 'missing target anchor preview leaves the skeleton unchanged instead of falling back to torso/root movement');
  assert.deepEqual(invalidPreview.parts, {}, 'missing target anchor preview emits no body-part overrides instead of moving the wrong limb');
}

const replacementBase = createSampleProject({ includeMechanism: true });
const coarsePrevious: ProjectState = {
  ...replacementBase,
  parts: {
    ...replacementBase.parts,
    right_arm: {
      ...replacementBase.parts.right_arm_lower,
      id: 'right_arm',
      name: 'Right arm legacy',
      anchorJointId: 'right_shoulder',
      bounds: { x: -21, y: -75, width: 42, height: 150 },
      transform: { x: 98, y: 24, rotation: 18, scale: 1 }
    }
  },
  partOrder: [...replacementBase.partOrder.filter(id => !id.startsWith('right_arm_')), 'right_arm'],
  paths: {
    'legacy-wave': {
      ...replacementBase.paths['path-right-arm'],
      id: 'legacy-wave',
      partId: 'right_arm',
      targetAnchorJointId: undefined,
      chainRootJointId: undefined
    }
  },
  mechanisms: [{
    ...replacementBase.mechanisms[0],
    id: 'legacy-mech',
    targetPartId: 'right_arm',
    targetPathId: 'legacy-wave',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm']
  }]
};
const retargetedReplacement = replaceCharacterProject(replacementBase, coarsePrevious, 'character');
assert.strictEqual(retargetedReplacement.paths, coarsePrevious.paths, 'character replacement preserves authored paths as diagnostic data');
assert.equal(retargetedReplacement.paths['legacy-wave'].partId, 'right_arm', 'character replacement does not silently retarget an orphaned path');
assert.equal(retargetedReplacement.paths['legacy-wave'].targetAnchorJointId, undefined, 'character replacement does not backfill an authored path handle');
assert.equal(retargetedReplacement.paths['legacy-wave'].chainRootJointId, undefined, 'character replacement does not invent an IK chain root');
assert.equal(retargetedReplacement.mechanisms[0].targetPartId, 'right_arm', 'character replacement preserves the authored mechanism target for diagnosis');
assert.equal(retargetedReplacement.mechanisms[0].targetPathId, 'legacy-wave', 'character replacement preserves the authored mechanism-path reference');
assert.equal(retargetedReplacement.mechanisms[0].targetAnchorJointId, 'right_hand', 'character replacement preserves the authored handle reference');
assert.equal(retargetedReplacement.mechanisms[0].foundryExport, undefined, 'character replacement clears stale mechanism packages');
assert.equal(retargetedReplacement.lastFoundryExport, undefined, 'character replacement clears the stale aggregate package');
assert.equal(retargetedReplacement.lastExport, undefined, 'character replacement clears stale export artifacts');
assert.equal(retargetedReplacement.characterPackage?.replacementContext?.rebindingSummary, 'Fix: Choose anchor', 'character replacement records the authoritative recovery action');
const enlargedReplacement: ProjectState = {
  ...replacementBase,
  skeleton: replacementBase.skeleton ? {
    ...replacementBase.skeleton,
    joints: Object.fromEntries(Object.entries(replacementBase.skeleton.joints).map(([id, joint]) => [id, {
      ...joint,
      position: { x: joint.position.x * 1.5, y: joint.position.y * 1.5 }
    }]))
  } : null,
  parts: Object.fromEntries(Object.entries(replacementBase.parts).map(([id, part]) => [id, {
    ...part,
    transform: { ...part.transform, x: part.transform.x * 1.5, y: part.transform.y * 1.5 },
    bounds: { ...part.bounds, width: part.bounds.width * 1.5, height: part.bounds.height * 1.5 }
  }]))
};
const scaledReplacement = replaceCharacterProject(enlargedReplacement, coarsePrevious, 'path');
assert.equal(scaledReplacement.mechanisms[0].groundLength, coarsePrevious.mechanisms[0].groundLength, 'failed larger replacement recovery preserves the prior mechanism link dimensions');
assert.equal(scaledReplacement.mechanisms[0].anchorX, coarsePrevious.mechanisms[0].anchorX, 'failed larger replacement recovery preserves the prior mechanism anchor');
assert.deepEqual(scaledReplacement.paths['legacy-wave'].points, coarsePrevious.paths['legacy-wave'].points, 'larger replacement preserves authored path geometry for recovery diagnosis');
assert.deepEqual(SANITIZE_MECHANISM_TYPES, [...ALL_MECHANISM_TYPES], 'import sanitizer accepts every low-level mechanism template including crank');
const expectedGraphAuthorableTypes: MechanismType[] = ALL_MECHANISM_TYPES.filter(type => type !== 'crank');
const expectedReferenceFoundryTypes: MechanismType[] = ['crank', '4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const expectedFoundryFamilies: MechanismType[] = ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const nonFoundryMechanismTypes: MechanismType[] = ['yoke', 'quick-return', 'rack-pinion', '5bar', '6bar'];
assert.deepEqual(AUTHORABLE_MECHANISM_TYPES, expectedGraphAuthorableTypes, 'authorable mechanism types use every graph-compiled family except the low-level crank driver');
assert.deepEqual(REFERENCE_EXPORT_READY_TYPES, ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'], 'mechanism-reference export-ready types remain the legacy novice recipe catalog, not the graph compiler authoring gate');
assert.deepEqual(OPTIMIZER_MECHANISM_TYPES, expectedGraphAuthorableTypes, 'optimizer searches graph-compiled authorable mechanism families instead of the legacy recipe catalog');
assert.deepEqual(FOUNDRY_MECHANISM_TYPES, expectedFoundryFamilies, 'Foundry exposes the six canonical physical families without the low-level crank driver');
assert.deepEqual(REFERENCE_FOUNDRY_TYPES, expectedReferenceFoundryTypes, 'mechanism-reference Foundry-visible types match the gallery contract');
assert(!AUTHORABLE_MECHANISM_TYPES.includes('crank'), 'bare crank stays a low-level driver, not a novice authoring template');
assert.equal(REFERENCE_MECHANISM_RECIPES.piston.canonicalKey, 'slider_crank', 'piston maps to the mechanism-reference slider_crank recipe');
nonFoundryMechanismTypes.forEach(type => {
  const recipe = referenceRecipeForType(type);
  const graphFabrication = compileMechanismGraphFabrication(createDefaultMechanism(type, `reference-legacy-${type}`));
  assert.equal(recipe.exportReady, false, `${type} remains hidden in the legacy mechanism-reference gallery, not in the graph compiler`);
  assert.equal(recipe.foundryVisible, false, `${type} remains out of the novice reference gallery until classroom copy/template QA`);
  assert.deepEqual(recipe.requiredParts, [], `${type} legacy reference recipe stays empty so graph compiler owns the build contract`);
  assert.equal(graphFabrication.buildable, true, `${type} graph compiler emits a buildable recipe despite legacy reference visibility`);
});
REFERENCE_EXPORT_READY_TYPES.forEach(type => {
  const recipe = referenceRecipeForType(type);
  recipe.assemblySteps.forEach(step => {
    assert.equal(step.coordRoles.length, step.coords.length, `${type} step ${step.index} keeps coord_roles aligned with coords`);
    const firstBoardIndex = step.coordRoles.findIndex(isBoardFixedCoordRole);
    const expectedBoardCoordinate = step.coords[firstBoardIndex >= 0 ? firstBoardIndex : 0] ?? '';
    assert.equal(step.boardCoordinate, expectedBoardCoordinate, `${type} step ${step.index} boardCoordinate follows the first board role, not a moving reference`);
    const orders = step.stack.map(layer => layer.order);
    assert.deepEqual(orders, [...new Set(orders)].sort((a, b) => a - b), `${type} step ${step.index} stack orders are strictly increasing`);
    if (type === 'cam') {
      assert(step.coords.every(coord => /^[A-O](?:[1-9]|1[0-5])$/.test(coord)), `cam step ${step.index} stays on the 15x15 pegboard coordinate frame`);
      assert(!JSON.stringify(step.stack).match(/S10 spacer|Eccentric cam|Round follower|2-hole bracket/i), `cam step ${step.index} does not use the old generic cam stack`);
    } else {
      assert(step.stack.some(layer => layer.role === 'paper-fastener'), `${type} step ${step.index} stack includes a paper fastener`);
      step.stack
        .filter(layer => layer.role === 'spacer' || layer.role === 'top-spacer')
        .forEach(layer => assert.equal(layer.part, 'spacers:s10', `${type} step ${step.index} spacer layer uses S10`));
    }
  });
  const graphRecipe = compileMechanismGraphFabrication(createDefaultMechanism(type, `graph-recipe-${type}`)).recipe;
  assert(graphRecipe?.assemblySteps.length, `${type} graph compiler emits assembly steps for Blueprint and Assembly`);
  graphRecipe?.assemblySteps.forEach(step => {
    assert.equal((step.coords ?? []).length, (step.coordRoles ?? []).length, `${type} graph step ${step.index} keeps coord_roles aligned with coords`);
    assert(step.boardCoordinate, `${type} graph step ${step.index} has a readable board coordinate`);
    (step.coords ?? [])
      .filter((_, index) => isBoardFixedCoordRole((step.coordRoles ?? [])[index] ?? ''))
      .forEach(coord => assert(/^[A-Z]+(?:[1-9]\d*)$/.test(coord), `${type} graph step ${step.index} board-fixed coord ${coord} is a board label, not a moving reference fallback`));
    assert.deepEqual((step.stack ?? []).map(item => item.order), (step.stack ?? []).map((_, index) => index + 1), `${type} graph step ${step.index} emits contiguous stack order`);
  });
});
{
  const shiftedFourbarBase = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'graph-shift-base')));
  const shiftedFourbar = { ...shiftedFourbarBase, id: 'graph-shift-moved', anchorX: (shiftedFourbarBase.anchorX ?? 0) + 40 };
  const baseRecipe = compileMechanismGraphFabrication(shiftedFourbarBase, sample.settings.physicalKit).recipe!;
  const shiftedRecipe = compileMechanismGraphFabrication(shiftedFourbar, sample.settings.physicalKit).recipe!;
  assert.notEqual(shiftedRecipe.boardCoordinate, baseRecipe.boardCoordinate, 'graph assembly board coordinate follows edited mechanism placement instead of a static reference recipe');
  assert.notDeepEqual(shiftedRecipe.assemblySteps.map(step => step.boardCoordinate), baseRecipe.assemblySteps.map(step => step.boardCoordinate), 'graph assembly step board coordinates move with edited mechanism anchors');
}
assert(isBoardFixedCoordRole('board'), 'mechanism-reference board role is board-fixed');
assert(isBoardFixedCoordRole('board_axle'), 'mechanism-reference compatibility board_axle role is board-fixed');
assert(!isBoardFixedCoordRole('link_joint_reference'), 'mechanism-reference floating link joints are not board-fixed');
assert(!isBoardFixedCoordRole('gear_handle_reference'), 'mechanism-reference gear handle references are not board-fixed');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Close output link')?.boardCoordinate, 'I9', '4bar output link closes on board pivot I9, not floating G10');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Add coupler')?.stack[0]?.role, 'link-joint-hole', '4bar G6 coupler joint is a floating link joint');
assert.equal(referenceRecipeForType('4bar').assemblySteps.find(step => step.label === 'Join output to coupler')?.stack[0]?.role, 'link-joint-hole', '4bar G10 output/coupler joint remains floating');
assert.equal(referenceRecipeForType('gear').title, 'Gear train', 'gear recipe title matches the visible gear-only Foundry label');
assert.equal(referenceRecipeForType('gear').assemblySteps.find(step => step.label === 'Add output G3 gear')?.boardCoordinate, 'H9', 'gear train output G3 sits at direct pitch contact with the drive G3');
assert.equal(referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Add output G3 gear')?.boardCoordinate, 'I12', 'gear-linkage output endpoint is separated at I12 until idlers fill the span');
assert.equal(referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Join moving connector')?.coordRoles[0], 'link_end_reference', 'gear-linkage R connector is a moving link-end reference, not a board axle');
const gearLinkageDriveCrankStack = referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Add drive crank link')?.stack ?? [];
const gearLinkageOutputCrankStack = referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Add output crank link')?.stack ?? [];
const gearLinkageConnectorStack = referenceRecipeForType('gear_linkage').assemblySteps.find(step => step.label === 'Join moving connector')?.stack ?? [];
assert.equal(gearLinkageDriveCrankStack[0]?.role, 'gear-handle-hole', 'gear-linkage drive arm starts at an off-centre gear handle hole');
assert.equal(gearLinkageOutputCrankStack[0]?.role, 'gear-handle-hole', 'gear-linkage output arm starts at an off-centre gear handle hole');
assert.deepEqual(gearLinkageDriveCrankStack.slice(0, 4).map(item => item.role), ['gear-handle-hole', 'spacer', 'moving-part', 'paper-fastener'], 'gear-linkage drive crank stack keeps only the endpoint gear, S10 clearance, linkage, and fastener on the local pin');
assert.deepEqual(gearLinkageOutputCrankStack.slice(0, 5).map(item => item.role), ['gear-handle-hole', 'spacer', 'spacer', 'moving-part', 'paper-fastener'], 'gear-linkage output crank stack uses two S10 spacers to reach the upper output-link plane without an extra top spacer');
assert.equal(gearLinkageConnectorStack[0]?.role, 'link-end-hole', 'gear-linkage shared connector is a moving link-end reference');
assert.deepEqual(gearLinkageConnectorStack.slice(1, 5).map(item => item.role), ['moving-part', 'spacer', 'moving-part', 'paper-fastener'], 'gear-linkage R connector stacks only the two linkage ends with S10 clearance before the fastener');
assert.equal(referenceRecipeForType('planetary_gear').assemblySteps.find(step => step.label === 'Add G3 moving planet gear')?.stack[0]?.role, 'carrier-hole', 'planetary planet axle sits on the moving carrier, not the board');
assert.equal(referenceRecipeForType('planetary_gear').assemblySteps.find(step => step.label === 'Add G3 moving planet gear')?.coordRoles[0], 'carrier_reference', 'planetary planet gear is located by the carrier reference, not recomputed as a board axle');
assert(referenceRecipeForType('planetary_gear').stackLabels.includes('L4 carrier linkage'), 'planetary stack labels the L4 part as the carrier so renderers do not draw a generic floating linkage');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add connecting rod')?.stack[0]?.role, 'link-joint-hole', 'slider-crank G6 rod joint is a floating link joint');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add slider block')?.stack[0]?.role, 'link-end-hole', 'slider-crank block is a moving slider/link reference');
const previewReadyTypes: MechanismType[] = [...ALL_MECHANISM_TYPES];
previewReadyTypes.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `preview-ready-${type}`)));
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], `${type} default mechanism is preview-ready before Foundry/Design can render it`);
});
assert.equal(MECHANISM_GRAPH_LIVE_SOLVE_BUDGET_MS, 16, 'mechanism graph live-solve budget stays at one 60fps frame');
assert.deepEqual([...MECHANISM_GRAPH_ADAPTER_TYPES].sort(), [...ALL_MECHANISM_TYPES].sort(), 'graph adapter registry covers every mechanism family without bypass-only fallbacks');
{
  const mechanismGraphSource = readFileSync(new URL('../utils/mechanismGraph.ts', import.meta.url), 'utf8');
  assert(!mechanismGraphSource.includes('defaultPhysicalKit'), 'MechanismGraph IR does not bake the default kit; kit validation belongs to the graph fabrication compiler');
}
ALL_MECHANISM_TYPES.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(createDefaultMechanism(type, `graph-adapter-${type}`));
  const graph = mechanismGraphForMechanism(mechanism);
  const compiledGraph = compileAuthoredMechanismGraph(graph);
  assert.equal(graph.version, 1, `${type} graph adapter emits the current IR version`);
  assert.equal(graph.mechanismType, type, `${type} graph adapter preserves the mechanism family`);
  assert.equal(graph.source, 'family-definition', `${type} graph adapter starts from a family definition`);
  assert.equal(graph.solver, 'closed-form-kinematics', `${type} graph adapter uses the shared closed-form fast path`);
  assert.equal(graph.persisted, false, `${type} graph adapter is never persisted into ProjectState`);
  assert.equal(compiledGraph.fabrication.buildable, true, `${type} graph compiler emits a buildable fabrication recipe`);
  assert.equal(compiledGraph.fabrication.recipeCompilerSource, 'compileGraphFabricationRecipe', `${type} graph compiler owns the fabrication recipe source`);
  assert(compiledGraph.fabrication.recipe?.assemblySteps.length, `${type} graph compiler emits assembly steps`);
});
{
  const mechanism = mechanismWithGeneratedPath(createDefaultMechanism('4bar', 'kit-aware-render-plan'));
  const defaultPlan = compileMechanismRenderPlan(mechanism, sample.settings.physicalKit);
  const tinyKit = { ...sample.settings.physicalKit, boardCells: 1 };
  const tinyPlan = compileMechanismRenderPlan(mechanism, tinyKit);
  assert.equal(defaultPlan.validationErrors.length, 0, 'render-plan facade forwards the active classroom kit and stays buildable on the default board');
  assert(tinyPlan.validationErrors.length > 0, 'render-plan facade forwards kit-specific board blockers instead of silently using the default kit');
  const tinyInventory = mechanismInventoryForMechanism(mechanism, tinyKit);
  assert(tinyInventory.compilerBlockers > 0 && tinyInventory.parts > 0, 'graph inventory exposes compiler blockers instead of silently returning an empty build inventory');
  const denseKit = { ...sample.settings.physicalKit, gridPitchMm: 10, boardCells: 30 };
  const defaultFabrication = compileMechanismGraphFabrication(mechanism, sample.settings.physicalKit);
  const denseFabrication = compileMechanismGraphFabrication(mechanism, denseKit);
  const partKeys = (recipe = defaultFabrication.recipe) => recipe?.requiredParts.map(part => part.part ?? part.name).sort() ?? [];
  assert.equal(denseFabrication.buildable, true, 'graph fabrication compiler keeps the same mechanism buildable on a larger dense-pitch kit');
  assert.deepEqual(partKeys(defaultFabrication.recipe), partKeys(denseFabrication.recipe), 'active board pitch does not change fixed managed linkage part identity');
  assert(denseFabrication.recipe?.assemblySteps.flatMap(step => step.coords ?? []).some(coord => isBoardCoordinateInKit(coord, denseKit) && !isBoardCoordinateInKit(coord, sample.settings.physicalKit)), 'graph fabrication compiler emits active-kit board labels instead of silently clamping to the 15x15 kit');
  const denseEditorLinkLength = fabricationLinkageSpecForCells(4).lengthMm * SCENE_PX_PER_MM;
  const denseEditedMechanism = { ...mechanism, couplerLength: denseEditorLinkLength };
  const denseEditedRecipe = compileMechanismGraphFabrication(denseEditedMechanism, denseKit).recipe;
  assert(denseEditedRecipe?.requiredParts.some(part => part.part === 'linkages:linkage-4-cell'), 'parametric editor output keeps the intended managed 4-cell linkage part on a different board pitch');
}
previewReadyTypes.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `graph-${type}`)));
  const graph = mechanismGraphForMechanism(mechanism);
  const compiled = compileMechanism(mechanism);
  const graphCompilation = compileAuthoredMechanismGraph(graph);
  const graphRecipe = graphCompilation.fabrication.recipe;
  const sceneContract = buildLowLevelMechanismSceneContract(mechanism);
  assert.equal(graph.source, 'family-definition', `${type} graph starts as a family definition adapter`);
  assert.equal(graph.persisted, false, `${type} graph is not a ProjectState persistence field`);
  assert.equal(graph.solver, 'closed-form-kinematics', `${type} graph keeps the closed-form fast path while graph authoring ships`);
  assert(graph.constraints.some(constraint => constraint.role === 'board-snap'), `${type} graph records pegboard snap constraints`);
  assert.deepEqual(compiled.readinessErrors, validateMechanismPreviewReadiness(mechanism), `${type} compiler output preserves preview-readiness validation`);
  assert(graphCompilation.fabrication.renderPlan, `${type} graph compiler emits a render plan`);
  assert(graphRecipe, `${type} graph compiler emits a fabrication recipe`);
  assert.deepEqual(compiled.fabrication.renderPlan, graphCompilation.fabrication.renderPlan, `${type} compiler output consumes the graph-owned fabrication render plan`);
  assert.equal(compiled.fabrication.renderPlanSource, 'compileGraphFabricationRecipe', `${type} compiler output records the graph render-plan source`);
  assert.equal(compiled.fabrication.assemblyPlanSource, 'compileGraphFabricationRecipe', `${type} compiler output consumes graph-owned assembly steps`);
  assert.equal(compiled.fabrication.assemblyBoardCoordinate, graphRecipe!.boardCoordinate, `${type} compiler output preserves graph assembly board coordinate`);
  assert.equal(compiled.fabrication.assemblyStepCount, graphRecipe!.assemblySteps.length, `${type} compiler output preserves graph assembly step count`);
  assert.deepEqual(compiled.fabrication.assemblyStepLabels, graphRecipe!.assemblySteps.map(step => step.label), `${type} compiler output preserves graph assembly step labels`);
  assert.deepEqual(compiled.fabrication.assemblyStepFingerprints, graphCompilation.fabrication.assemblyStepFingerprints, `${type} compiler output preserves graph assembly step coordinates, roles, z order, and stack parts`);
  assert.equal(compiled.fabrication.layerCount, graphCompilation.fabrication.renderPlan!.layers.length, `${type} compiler output preserves render-plan layer count`);
  assert.equal(compiled.fabrication.stackSummary, graphCompilation.fabrication.renderPlan!.stackSummary, `${type} compiler output preserves stack summary`);
  assert.equal(compiled.fabrication.roleSummary, graphCompilation.fabrication.renderPlan!.roleSummary, `${type} compiler output preserves role summary`);
  assert.deepEqual(compiled.fabrication.validationErrors, graphCompilation.fabrication.renderPlan!.validationErrors, `${type} compiler output preserves fabrication validation errors`);
  assert.equal(sceneContract.compilerSource, 'mechanismCompiler', `${type} scene contract records the compiler output compiler source`);
  assert.equal(sceneContract.graphCompiler.graphId, compiled.graph.id, `${type} scene contract exposes graph metadata without replacing fabrication layers`);
});
ALL_MECHANISM_TYPES.forEach(type => {
  const graph = mechanismGraphForMechanism(mechanismWithGeneratedPath(createDefaultMechanism(type, `graph-unique-${type}`)));
  const validation = validateMechanismGraph(graph);
  assert.equal(validation.valid, true, `${type} graph validates as a compiler IR`);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length, `${type} graph node ids are unique`);
  assert.equal(new Set(graph.constraints.map(constraint => constraint.id)).size, graph.constraints.length, `${type} graph constraint ids are unique`);
  assert.equal(new Set(graph.drivers.map(driver => driver.id)).size, graph.drivers.length, `${type} graph driver ids are unique`);
  assert(graph.nodes.every(node => node.label && node.role), `${type} graph nodes carry readable labels and roles`);
  assert(graph.constraints.every(constraint => constraint.label && constraint.role), `${type} graph constraints carry readable labels and roles`);
  assert(graph.drivers.every(driver => driver.label && driver.nodeId), `${type} graph drivers carry labels and target nodes`);
});
{
  const broken = mechanismGraphForMechanism(createDefaultMechanism('4bar', 'free-graph-validation-broken'));
  const validation = validateMechanismGraph({
    ...broken,
    version: 999 as never,
    persisted: true as false,
    source: 'bad-source' as never,
    solver: 'bad-solver' as never,
    nodes: [...broken.nodes, { ...broken.nodes[0], position: { x: Number.NaN, y: 0 } }],
    constraints: [
      ...broken.constraints,
      { id: 'bad-free-constraint', label: 'Bad free constraint', role: 'pin-joint', nodes: ['missing-node'] },
      { id: 'bad-mesh', label: 'Bad mesh', role: 'gear-mesh', nodes: ['p1'], value: Number.POSITIVE_INFINITY }
    ],
    drivers: [...broken.drivers, { ...broken.drivers[0], id: 'bad-driver', solver: 'bad-solver' as never, ratio: Number.NaN }]
  });
  const messages = validation.diagnostics.map(diagnostic => diagnostic.message).join(' | ');
  assert.equal(validation.valid, false, 'free graph authoring validation rejects malformed compiler IR before persistence');
  assert(messages.includes('Graph version') && messages.includes('non-persisted') && messages.includes('bad-source') && messages.includes('bad-solver'), 'graph validation rejects bad version, persisted flag, source, and solver');
  assert(messages.includes('Duplicate graph node id') && messages.includes('missing node') && messages.includes('invalid gear-mesh node count') && messages.includes('must be finite'), 'graph validation rejects duplicate ids, dangling references, bad arity, and non-finite values');
}
{
  const authoredGraph = mechanismGraphFromDraft({
    id: 'teacher-free-graph',
    familyId: 'teacher-linkage-demo',
    nodes: [
      { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } },
      { id: 'board-b', label: 'Board pivot B', role: 'board-anchor', position: { x: 80, y: 0 } },
      { id: 'link-a', label: 'Student link', role: 'link', position: { x: 40, y: 0 }, value: 80 },
      { id: 'output', label: 'Output point', role: 'output-point', position: { x: 80, y: 0 } }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] },
      { id: 'link-length', label: 'Link length stays fixed', role: 'distance', nodes: ['board-a', 'output'], value: 80, fabricatedPartNodeId: 'link-a' },
      { id: 'output-clearance', label: 'Output clears board pivot', role: 'clearance', nodes: ['output', 'board-b'], value: 20 }
    ],
    drivers: [{ id: 'teacher-turn', label: 'Turn pivot A', role: 'rotary-input', nodeId: 'board-a', solver: 'constraint-graph', ratio: 1 }]
  });
  const validation = validateMechanismGraph(authoredGraph);
  const compilation = compileAuthoredMechanismGraph(authoredGraph);
  const repeatCompilation = compileAuthoredMechanismGraph(authoredGraph);
  assert.equal(authoredGraph.source, 'free-graph-authoring', 'free graph authoring enters the same non-persisted graph IR without a MechanismType switch');
  assert.equal(authoredGraph.solver, 'constraint-graph', 'free graph authoring uses the graph solver boundary instead of pretending to be a family closed-form solver');
  assert.equal(authoredGraph.mechanismType, undefined, 'free graph authoring is not forced through the closed MechanismType legacy alias');
  assert.equal(validation.valid, true, 'valid free graph authoring drafts pass structural graph validation');
  assert.equal(compilation.compilerSource, 'mechanismCompiler', 'free graph authoring compiles through the compiler facade');
  assert.equal(compilation.fabrication.buildable, true, 'fabrication-ready free graph authoring emits a buildable graph-owned recipe');
  assert.deepEqual(compilation.blockers, [], 'fabrication-ready free graph authoring has no legacy recipe blocker');
  assert.equal(compilation.fabrication.recipe?.mechanismId, authoredGraph.mechanismId, 'graph-owned recipe keeps the authored graph mechanism id');
  assert.equal(compilation.fabrication.recipe?.type, 'graph', 'graph-owned recipe does not masquerade as a legacy MechanismType');
  assert.equal(compilation.fabrication.recipe?.graphFamilyId, 'teacher-linkage-demo', 'graph-owned recipe preserves the authored graph family id');
  assert.equal(compilation.fabrication.recipe?.compilerSource, 'mechanismCompiler', 'graph-owned recipe records compiler ownership');
  assert.equal(compilation.fabrication.recipeCompilerSource, 'compileGraphFabricationRecipe', 'graph-owned recipe records the graph recipe compiler instead of per-template recipe paths');
  assert((compilation.fabrication.recipe?.requiredParts.length ?? 0) > 0, 'graph-owned recipe emits required fabrication parts');
  assert((compilation.fabrication.recipe?.assemblySteps.length ?? 0) > 0, 'graph-owned recipe emits assembly steps');
  assert(compilation.fabrication.recipe?.requiredParts.some(part => part.category === 'linkage'), 'explicit graph link nodes become linkage part requirements');
  assert(!compilation.fabrication.recipe?.assemblySteps.some(step => step.label === 'Add Link length stays fixed'), 'explicit graph link nodes suppress duplicate synthesized distance-link assembly steps');
  const authoredStackPartCounts = new Map<string, number>();
  compilation.fabrication.recipe?.assemblySteps.forEach(step => (step.stack ?? []).forEach(item => {
    if (item.part) authoredStackPartCounts.set(item.part, (authoredStackPartCounts.get(item.part) ?? 0) + 1);
  }));
  assert(compilation.fabrication.recipe?.requiredParts.every(part => part.part), 'graph required parts are derived only from real fabrication stack part ids');
  assert(!compilation.fabrication.recipe?.requiredParts.some(part => part.name === 'Open tabs behind board'), 'graph required parts do not leak assembly operations into cut lists');
  compilation.fabrication.recipe?.requiredParts.filter(part => part.part).forEach(part => {
    assert.equal(part.quantity, authoredStackPartCounts.get(part.part!) ?? 0, `graph required part ${part.part} matches emitted assembly stack count`);
  });
  compilation.fabrication.recipe?.assemblySteps.forEach(step => {
    assert.equal((step.coords ?? []).length, (step.coordRoles ?? []).length, 'graph-owned assembly step keeps coordinate roles aligned');
    assert.deepEqual((step.stack ?? []).map(item => item.order), Array.from({ length: step.stack?.length ?? 0 }, (_, index) => index + 1), 'graph-owned assembly step stack order is contiguous');
  });
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.source === 'mechanism-graph'), 'graph-owned render plan layers are sourced from the graph compiler');
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.role === 'spacer'), 'graph-owned render plan derives spacer layers from the assembly stack');
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.role === 'clip'), 'graph-owned render plan derives fastener/clip layers from the assembly stack');
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.label === 'Student link' && layer.role === 'linkage'), 'explicit graph link nodes become render layers');
  assert.deepEqual(compilation.fabrication.assemblyStepFingerprints, compilation.fabrication.recipe?.assemblySteps.map(step => ({
    index: step.index,
    label: step.label,
    role: step.role,
    boardCoordinate: step.boardCoordinate,
    zMm: step.zMm,
    coords: step.coords ?? [],
    coordRoles: step.coordRoles ?? [],
    stack: (step.stack ?? []).map(item => ({ order: item.order, label: item.label, role: item.role, part: item.part }))
  })), 'graph-owned compiler fingerprints assembly labels, coordinates, z order, and stack parts');
  assert.deepEqual(compilation, repeatCompilation, 'graph-owned authored compilation is deterministic and pure');
}
{
  const graphWithMissingFabricatedNodePosition = mechanismGraphFromDraft({
    id: 'teacher-missing-fabricated-position',
    familyId: 'teacher-linkage-demo',
    nodes: [
      { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } },
      { id: 'student-link', label: 'Student link', role: 'link', value: 80 }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] }
    ]
  });
  const compilation = compileAuthoredMechanismGraph(graphWithMissingFabricatedNodePosition);
  assert.equal(compilation.fabrication.buildable, false, 'graph-owned compiler blocks fabricated graph nodes without positions');
  assert(compilation.blockers.includes('Fabricated graph parts need positions: Student link'), 'missing fabricated graph node positions surface as explicit graph blockers');
}
{
  const graphWithMissingDistanceEndpoint = mechanismGraphFromDraft({
    id: 'teacher-missing-distance-endpoint',
    familyId: 'teacher-linkage-demo',
    nodes: [
      { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } },
      { id: 'output', label: 'Output point', role: 'output-point' },
      { id: 'student-link', label: 'Student link', role: 'link', position: { x: 40, y: 0 }, value: 80 }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] },
      { id: 'link-length', label: 'Link length stays fixed', role: 'distance', nodes: ['board-a', 'output'], value: 80, fabricatedPartNodeId: 'student-link' }
    ]
  });
  const compilation = compileAuthoredMechanismGraph(graphWithMissingDistanceEndpoint);
  assert.equal(compilation.fabrication.buildable, false, 'graph-owned compiler blocks fabricated constraints whose endpoints have no finite board placement');
  assert(compilation.blockers.includes('Fabricated link endpoints need positions: Link length stays fixed'), 'missing fabricated constraint endpoint positions surface as explicit graph blockers');
}
{
  const explicitPartsGraph = mechanismGraphFromDraft({
    id: 'teacher-explicit-parts',
    familyId: 'teacher-explicit-parts',
    nodes: [
      { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } },
      { id: 'student-link', label: 'Student link', role: 'link', position: { x: 40, y: 0 }, value: 80 },
      { id: 'rigid-rocker', label: 'Rigid rocker', role: 'rigid-part', position: { x: 80, y: 0 }, value: 60 }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] }
    ]
  });
  const compilation = compileAuthoredMechanismGraph(explicitPartsGraph);
  assert.equal(compilation.fabrication.buildable, true, 'explicit link and rigid-part graph nodes produce a buildable graph recipe');
  assert(compilation.fabrication.recipe?.requiredParts.some(part => part.category === 'linkage'), 'explicit link and rigid-part graph nodes become fabrication part requirements');
  assert(compilation.fabrication.recipe?.assemblySteps.some(step => step.label === 'Add Student link'), 'explicit link graph node becomes an assembly part step');
  assert(compilation.fabrication.recipe?.assemblySteps.some(step => step.label === 'Add Rigid rocker'), 'explicit rigid-part graph node becomes an assembly part step');
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.label === 'Student link' && layer.role === 'linkage'), 'explicit link graph node becomes a render layer');
  assert(compilation.fabrication.renderPlan?.layers.some(layer => layer.label === 'Rigid rocker' && layer.role === 'linkage'), 'explicit rigid-part graph node becomes a render layer');
  assert.equal(compilation.fabrication.recipe?.requiredParts.find(part => part.part === 'linkages:linkage-2-cell')?.quantity, 2, 'duplicate explicit graph link specs accumulate required part quantity');
  assert.equal(compilation.fabrication.recipe?.requiredParts.find(part => part.part === 'spacers:s10')?.quantity, 2, 'explicit graph part stacks accumulate matching spacer quantity');
}
{
  const offGridGraph = mechanismGraphFromDraft({
    id: 'teacher-off-grid-graph',
    familyId: 'teacher-off-grid-graph',
    nodes: [
      { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 10, y: 0 } },
      { id: 'student-link', label: 'Student link', role: 'link', position: { x: 40, y: 0 }, value: 80 }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] }
    ]
  });
  const compilation = compileAuthoredMechanismGraph(offGridGraph);
  assert.equal(compilation.fabrication.buildable, false, 'graph-owned compiler blocks in-board points that are not snapped to a physical board hole');
  assert(compilation.blockers.includes('No board-snapped graph anchor'), 'off-grid graph placement surfaces as an explicit graph blocker instead of silently rounding to a hole');
}
{
  const edgeKitGraph = mechanismGraphFromDraft({
    id: 'teacher-kit-settings',
    familyId: 'teacher-kit-settings',
    nodes: [
      { id: 'board-edge', label: 'Board edge pivot', role: 'board-anchor', position: { x: 240, y: 0 } },
      { id: 'student-link', label: 'Student link', role: 'link', position: { x: 200, y: 0 }, value: 80 }
    ],
    constraints: [
      { id: 'board-edge-fixed', label: 'Edge pivot stays fixed', role: 'fixed-to-board', nodes: ['board-edge'] },
      { id: 'board-edge-snap', label: 'Edge pivot fits a hole', role: 'board-snap', nodes: ['board-edge'] }
    ]
  });
  assert.equal(compileAuthoredMechanismGraph(edgeKitGraph).fabrication.buildable, true, 'default 15x15 kit accepts the edge graph placement');
  assert.equal(
    compileAuthoredMechanismGraph(edgeKitGraph, physicalKitPreset('letter-12x12-2cm')).fabrication.buildable,
    false,
    'authored graph compiler honors caller-provided kit settings for board placement'
  );
}
{
  const recipeMissingGraph = mechanismGraphFromDraft({
    id: 'teacher-empty-graph',
    familyId: 'teacher-empty-graph',
    nodes: [{ id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } }],
    constraints: [{ id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] }]
  });
  const compilation = compileAuthoredMechanismGraph(recipeMissingGraph);
  assert.equal(compilation.fabrication.buildable, false, 'graph-owned compiler refuses authored graphs with no recognizable fabrication parts');
  assert(compilation.blockers.includes('No fabricated moving part in graph'), 'graph-owned compiler reports an explicit graph blocker instead of falling back to legacy defaults');
}
{
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'custom-compile-inputs')));
  const angles = [0, 0.25, 1.5];
  const compiled = compileMechanism(mechanism, angles, 12);
  const summary = summarizeCompiledMechanism(compiled);
  assert.deepEqual(compiled.motionSamples.map(sample => sample.angle), angles, 'compiler output preserves requested sample angles');
  assert.deepEqual(compiled.feasibleRange, sampleFeasibleRange(mechanism, 12), 'compiler output honors requested feasible sample count');
  assert.equal(summary.nodeCount, compiled.graph.nodes.length, 'compiler summary reports node count');
  assert.equal(summary.constraintCount, compiled.graph.constraints.length, 'compiler summary reports constraint count');
  assert.equal(summary.motionSampleCount, compiled.motionSamples.length, 'compiler summary reports motion sample count');
  assert.equal(summary.feasiblePercentValid, compiled.feasibleRange.percentValid, 'compiler summary reports feasible percentage');
  assert.equal(summary.compilerSource, 'mechanismCompiler', 'compiler summary records the compiler facade source');
  assert.equal(summary.recipeCompilerSource, 'compileGraphFabricationRecipe', 'compiler summary records the graph fabrication recipe compiler facade');
}
{
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'compiler-motion-parity')));
  const angles = [0, 0.4, 1.7, Math.PI];
  const compiled = compileMechanism(mechanism, angles, 8);
  compiled.motionSamples.forEach(sample => {
    assertJointStateClose(sample.state, calculateLinkage(mechanism, sample.angle), `compiler sample ${sample.angle} matches closed-form linkage`);
    assert.equal(sample.source, 'calculateLinkage', 'compiler sample declares closed-form oracle source until graph solver parity ships');
  });
}
previewReadyTypes.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `compiler-pure-${type}`)));
  const before = stableGoldenMasterJson(mechanism);
  const compiledA = compileMechanism(mechanism);
  const compiledB = compileMechanism(mechanism);
  assert.equal(stableGoldenMasterJson(mechanism), before, `${type} mechanism compiler output is a pure derivation and does not mutate MechanismConfig`);
  assert.deepEqual(compiledA, compiledB, `${type} mechanism compiler output is deterministic for the same input`);
});
(['4bar', 'gear'] as const).forEach(type => {
  assert.equal(mechanismGraphForMechanism(createDefaultMechanism(type, `graph-first-target-${type}`)).family.firstCompilerTarget, true, `${type} remains an initial graph compiler target`);
});
assert(mechanismGraphForMechanism(createDefaultMechanism('4bar', 'graph-fourbar-roles')).constraints.some(constraint => constraint.role === 'distance'), '4bar graph adapter exposes fixed link-length distance constraints');
assert(mechanismGraphForMechanism(createDefaultMechanism('4bar', 'graph-fourbar-target')).constraints.some(constraint => constraint.role === 'output-offset'), '4bar graph adapter exposes the coupler target point as an output offset');
assert(mechanismGraphForMechanism(createDefaultMechanism('gear', 'graph-gear-mesh')).constraints.some(constraint => constraint.role === 'gear-mesh'), 'gear graph adapter exposes gear mesh constraints');
assert(mechanismGraphForMechanism(createDefaultMechanism('piston', 'graph-piston-guide')).constraints.some(constraint => constraint.role === 'prismatic'), 'piston graph adapter exposes the slider guide as a prismatic constraint');
assert(mechanismGraphForMechanism(createDefaultMechanism('cam', 'graph-cam-contact')).constraints.some(constraint => constraint.role === 'contact'), 'cam graph adapter exposes cam/follower contact');
assert(mechanismGraphForMechanism(createDefaultMechanism('gear_linkage', 'graph-gear-linkage-target')).constraints.some(constraint => constraint.id === 'connector-output'), 'gear-linkage graph adapter exposes the shared moving connector target');
assert(mechanismGraphForMechanism(createDefaultMechanism('planetary_gear', 'graph-planetary-mesh')).constraints.filter(constraint => constraint.role === 'gear-mesh').length >= 2, 'planetary gear graph adapter exposes sun/planet and planet/ring mesh constraints');
{
  const mechanism = normalizeMechanismToReference(createDefaultMechanism('4bar', 'graph-offset-vector'));
  const graph = mechanismGraphForMechanism(mechanism);
  const offset = graph.constraints.find(constraint => constraint.id === 'effector-offset');
  const angle = (mechanism.couplerPointAngle * Math.PI) / 180;
  assert.equal(offset?.angle, angle, '4bar graph output-offset preserves the coupler target angle');
  assertPointClose(offset?.vector, {
    x: mechanism.couplerPointDist * Math.cos(angle),
    y: mechanism.couplerPointDist * Math.sin(angle)
  }, '4bar graph output-offset vector reconstructs the local effector point');
}
{
  const mechanism = normalizeGearLinkageToReference(createDefaultMechanism('gear_linkage', 'graph-gear-linkage-center'));
  const graph = mechanismGraphForMechanism(mechanism);
  const gearCenters = gearTrainCenters(mechanism);
  const outputGear = graph.nodes.find(node => node.id === `gear-${gearCenters.length - 1}`);
  assertPointClose(outputGear?.position, gearCenters[gearCenters.length - 1], 'gear-linkage graph preserves the normalized output gear center');
  assertPointClose(outputGear?.position, calculateLinkage(mechanism, 0).p2, 'gear-linkage graph output gear center matches the closed-form output pivot');
  assert.equal(graph.constraints.filter(constraint => constraint.role === 'gear-mesh').length, 0, 'separated gear-linkage endpoint gears do not claim physical mesh without inserted idlers');
}
[
  normalizeMechanismToReference(createDefaultMechanism('gear', 'graph-mesh-physical-gear')),
  normalizeGearLinkageToReference({
    ...createDefaultMechanism('gear_linkage', 'graph-mesh-physical-gear-linkage-idler'),
    crankLength: gearSceneRadiusByKey('g24'),
    rockerLength: gearSceneRadiusByKey('g24'),
    gearTrainRadii: [gearSceneRadiusByKey('g24'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g24')]
  })
].forEach(mechanism => {
  const graph = mechanismGraphForMechanism(mechanism);
  graph.constraints.filter(constraint => constraint.role === 'gear-mesh').forEach(mesh => {
    const [a, b] = mesh.nodes.map(id => graph.nodes.find(node => node.id === id));
    assert(a?.position && b?.position, `${mechanism.id} mesh nodes have positions`);
    assert.equal(mesh.value, (a.value ?? 0) + (b.value ?? 0), `${mechanism.id} mesh value equals summed pitch radii`);
    assert(closeEnough(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y), mesh.value ?? 0), `${mechanism.id} mesh center distance equals pitch contact`);
  });
});
{
  const camProfileSamples = [1, 1.25, 0.85, 1.1];
  const graph = mechanismGraphForMechanism({ ...createDefaultMechanism('cam', 'graph-cam-profile'), camProfileSamples });
  assert.deepEqual(graph.nodes.find(node => node.id === 'cam-disk')?.samples, camProfileSamples, 'cam graph carries edited profile samples for downstream fabrication/compiler checks');
  assert.deepEqual(graph.constraints.find(constraint => constraint.id === 'effector-offset')?.samples, camProfileSamples, 'cam output-offset carries edited profile samples');
}
{
  const graph = mechanismGraphForMechanism(createDefaultMechanism('planetary_gear', 'graph-planetary-physical-nodes'));
  assert.equal(graph.nodes.find(node => node.id === 'sun-gear')?.role, 'gear', 'planetary graph emits the sun as a physical gear node');
  assert.equal(graph.nodes.find(node => node.id === 'ring-gear')?.role, 'ring-gear', 'planetary graph emits the fixed ring as a physical ring gear node');
  assert(Number.isFinite(graph.nodes.find(node => node.id === 'ring-gear')?.value), 'planetary graph carries the ring pitch radius');
}
const impossibleFourBar = mechanismWithGeneratedPath({
  ...normalizeMechanismToReference(createDefaultMechanism('4bar', 'preview-blocked-4bar')),
  groundLength: 300,
  crankLength: 10,
  couplerLength: 10,
  rockerLength: 10
});
assert(validateMechanismPreviewReadiness(impossibleFourBar).some(error => /No motion/.test(error)), 'preview readiness rejects an impossible no-motion four-bar before fitting/rendering');
const unsnappedFourBar = mechanismWithGeneratedPath({
  ...normalizeMechanismToReference(createDefaultMechanism('4bar', 'preview-blocked-fourbar-snap')),
  couplerLength: normalizeMechanismToReference(createDefaultMechanism('4bar', 'preview-blocked-fourbar-snap-base')).couplerLength + 11
});
assert(validateMechanismPreviewReadiness(unsnappedFourBar).some(error => error.includes('snap four-bar linkage lengths')), 'preview readiness rejects four-bar candidates that do not map to fabrication linkage/hole lengths');
const reducerUnsnappedFourBar = mechanismWithGeneratedPath({
  ...normalizeMechanismToReference(createDefaultMechanism('4bar', 'reducer-snaps-fourbar')),
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  couplerLength: normalizeMechanismToReference(createDefaultMechanism('4bar', 'reducer-snaps-fourbar-base')).couplerLength + 11
});
const reducerSnappedProject = applyProjectAction({ ...sample, mechanisms: [], selectedMechanismId: undefined }, { type: 'upsert_mechanism', mechanism: reducerUnsnappedFourBar });
const reducerSnappedFourBar = reducerSnappedProject.mechanisms.find(mechanism => mechanism.id === 'reducer-snaps-fourbar');
assert.equal(reducerSnappedFourBar, undefined, 'ordinary upsert rejects a brand-new unsafe unsnapped four-bar');
assert.equal(reducerSnappedProject.mechanisms.length, 0, 'rejected unsafe upsert does not enter canonical project state');
const roleMinimumFourBar = mechanismWithGeneratedPath(normalizeMechanismToFabricationSet({
  ...createDefaultMechanism('4bar', 'role-min-fourbar'),
  groundLength: 80,
  crankLength: 80,
  couplerLength: 80,
  rockerLength: 80
}));
const roleMinimumFourBarHoleCounts = fabricationLinkageHoleCountsForMechanism(roleMinimumFourBar);
assert.deepEqual(sizingRoleMinHoles, FABRICATION_LINKAGE_ROLE_MIN_HOLES, 'fabricationSizing preserves public linkage role minimum holes behind the fabrication facade');
assert.deepEqual(sizingFabricationLinkageSceneLengthsForMechanism(roleMinimumFourBar), fabricationLinkageSceneLengthsForMechanism(roleMinimumFourBar), 'fabricationSizing preserves public linkage scene lengths behind the fabrication facade');
assert.deepEqual(sizingFabricationLinkageHoleCountsForMechanism(roleMinimumFourBar), roleMinimumFourBarHoleCounts, 'fabricationSizing preserves public linkage hole counts behind the fabrication facade');
assert(roleMinimumFourBarHoleCounts.driver >= 3, 'four-bar input link normalization preserves enough holes for a board pivot plus moving joint');
assert(roleMinimumFourBarHoleCounts.coupler >= 4, 'four-bar coupler normalization upgrades too-short path fits to a fabricated linkage with enough moving-joint holes');
assert(roleMinimumFourBarHoleCounts.output >= 3, 'four-bar output link normalization preserves enough holes for a board pivot plus moving joint');
assert.deepEqual(validateMechanismPreviewReadiness(roleMinimumFourBar), [], 'role-minimum four-bar normalization creates a preview-ready fabricated mechanism');
const blockedGearTrainBase = normalizeMechanismToReference(createDefaultMechanism('gear', 'preview-blocked-gear'));
const blockedGearTrain = mechanismWithGeneratedPath({
  ...blockedGearTrainBase,
  groundLength: gearTrainPitchCenterDistance(blockedGearTrainBase) * 1.5
});
assert(validateMechanismPreviewReadiness(blockedGearTrain).some(error => error.includes('snap gear pitch')), 'preview readiness rejects gear trains whose axle distance violates pitch tangency');
const blockedGearLinkageBase = normalizeMechanismToReference(createDefaultMechanism('gear_linkage', 'preview-blocked-gear-linkage'));
const blockedGearLinkage = mechanismWithGeneratedPath({
  ...blockedGearLinkageBase,
  groundLength: gearTrainPitchCenterDistance(blockedGearLinkageBase)
});
assert(validateMechanismPreviewReadiness(blockedGearLinkage).some(error => error.includes('endpoint gears must be separated')), 'preview readiness rejects gear-linkage endpoints that collapse into a direct gear mesh');
const blockedPlanetaryBase = normalizeMechanismToReference(createDefaultMechanism('planetary_gear', 'preview-blocked-planetary'));
const blockedPlanetary = mechanismWithGeneratedPath({
  ...blockedPlanetaryBase,
  groundLength: blockedPlanetaryBase.groundLength * 1.5
});
assert(validateMechanismPreviewReadiness(blockedPlanetary).some(error => error.includes('planetary carrier')), 'preview readiness rejects planetary gears when carrier and ring pitch geometry no longer match');
const readinessRange = sampleFeasibleRange(roleMinimumFourBar, 12);
assert.deepEqual(readinessSampleFeasibleRange(roleMinimumFourBar, 12), readinessRange, 'fabricationReadiness preserves public feasible-range sampling behind the fabrication facade');
assert(readinessRange.percentValid > 0 && readinessRange.percentValid <= 1, 'fabricationReadiness preserves bounded feasible-range percentages');
assert.equal(readinessPhysicalTolerance(100), 3, 'fabricationReadiness preserves physical tolerance scaling');
assert(readinessClosePhysicalValue(103, 100), 'fabricationReadiness preserves close physical value checks at tolerance boundary');
assert(readinessCloseToBoardPitch(roleMinimumFourBar.groundLength), 'fabricationReadiness preserves board-pitch snapping checks');
assert(readinessCloseToFabricationLinkage(roleMinimumFourBar.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler), 'fabricationReadiness preserves fabrication linkage snapping checks');

ALL_MECHANISM_TYPES.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `safe-edit-authority-${type}`)));
  assert(mechanismMotionCompletes(mechanism), `${type} starts from a complete motion before feasible-only editing`);
  assert(mechanismEditIsSafe(mechanism), `${type} runtime authority accepts the default editable mechanism`);
  const absurdUpdate = constrainMechanismUpdate(mechanism, {
    crankLength: 9999,
    couplerLength: 9999,
    rockerLength: 1,
    gearTrainRadii: [9999, 1],
    camProfileSamples: [0.35, 1.65, 0.35, 1.65]
  });
  assert(safeMechanismUpdate(mechanism, absurdUpdate), `${type} runtime authority strips or clamps unsafe geometry edits`);
});
{
  const fourbar = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'safe-range-fourbar')));
  const range = motionSafeParamRange(fourbar, 'groundLength');
  assert(range?.currentSafe, 'four-bar ground length has a runtime safe range');
  for (const type of ['4bar', 'gear', 'gear_linkage'] as const) {
    const defaultMechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `safe-anchor-range-${type}`)));
    assert(mechanismEditIsSafe(defaultMechanism, sample.settings.physicalKit), `${type} default starts buildable before anchor range probing`);
    for (const key of ['anchorX', 'anchorY'] as const) {
      const anchorRange = motionSafeParamRange(defaultMechanism, key, sample.settings.physicalKit);
      assert(anchorRange?.currentSafe, `${type} ${key} exposes a current-safe range`);
      assert(anchorRange!.min < anchorRange!.max, `${type} ${key} range is non-degenerate when safe board positions exist`);
      assert(mechanismEditIsSafe({ ...defaultMechanism, [key]: anchorRange!.min }, sample.settings.physicalKit), `${type} ${key} min endpoint stays safe under the active kit`);
      assert(mechanismEditIsSafe({ ...defaultMechanism, [key]: anchorRange!.max }, sample.settings.physicalKit), `${type} ${key} max endpoint stays safe under the active kit`);
    }
  }
  assert.equal(constrainMechanismUpdate(fourbar, { groundLength: 9999 }).groundLength, undefined, 'central runtime authority rejects impossible four-bar ground length writes');
  const brandNewUnsafeFourbar = mechanismWithGeneratedPath({
    ...fourbar,
    id: 'brand-new-unsafe-upsert-contract',
    groundLength: 300,
    crankLength: 10,
    couplerLength: 10,
    rockerLength: 10,
  });
  assert.equal(mechanismEditIsSafe(brandNewUnsafeFourbar, sample.settings.physicalKit), false, 'contract fixture starts unsafe before reducer upsert');
const brandNewUnsafeProject = applyProjectAction({ ...sample, mechanisms: [], selectedMechanismId: undefined }, {
  type: 'upsert_mechanism',
  mechanism: brandNewUnsafeFourbar,
});
  const storedBrandNewUnsafe = brandNewUnsafeProject.mechanisms.find(mechanism => mechanism.id === brandNewUnsafeFourbar.id);
  assert.equal(storedBrandNewUnsafe, undefined, 'brand-new unsafe mechanism upsert is rejected without prior accepted geometry');
  assert.equal(brandNewUnsafeProject.mechanisms.length, 0, 'rejected brand-new unsafe mechanism does not enter canonical project state');

  const legacyUnsafeSnapshot = loadProjectSnapshot({
    ...sample,
    mechanisms: [brandNewUnsafeFourbar],
    selectedMechanismId: brandNewUnsafeFourbar.id,
  });
  const legacyUnsafeMechanism = legacyUnsafeSnapshot.mechanisms.find(mechanism => mechanism.id === brandNewUnsafeFourbar.id);
  assert(legacyUnsafeMechanism, 'legacy unsafe imports remain represented for recovery');
  assert.equal(legacyUnsafeSnapshot.selectedMechanismId, brandNewUnsafeFourbar.id, 'legacy unsafe imports can remain the current mechanism');
  assert.equal(
    mechanismEditIsSafe(legacyUnsafeMechanism, legacyUnsafeSnapshot.settings.physicalKit),
    false,
    'legacy unsafe current mechanism is reported unsafe for recovery UI and export gating'
  );
  assert.equal(
    constrainMechanismUpdate(legacyUnsafeMechanism, { crankLength: 120 }, legacyUnsafeSnapshot.settings.physicalKit).crankLength,
    undefined,
    'ordinary parameter edits stay constrained while a legacy unsafe mechanism is in recovery'
  );
  const selectedReplaceSource = mechanismWithGeneratedPath(sample.mechanisms[0]);
  const selectedReplaceProject = applyProjectAction(
    {
      ...sample,
      selectedMechanismId: selectedReplaceSource.id,
    },
    {
      type: 'upsert_mechanism',
      mechanism: {
        ...selectedReplaceSource,
        id: 'replace-mechanism-contract',
      },
      replaceMechanismId: selectedReplaceSource.id,
    },
  );
  const replacedContractMechanism = selectedReplaceProject.mechanisms.find(
    (mechanism) => mechanism.id === selectedReplaceSource.id,
  );
  assert.equal(
    selectedReplaceProject.mechanisms.length,
    sample.mechanisms.length,
    'replace-mechanism action keeps mechanism count stable when replacing selection',
  );
  assert(
    replacedContractMechanism,
    'upsert with replaceMechanismId updates the selected mechanism instead of adding a duplicate',
  );
  assert.equal(replacedContractMechanism?.targetPartId, selectedReplaceSource.targetPartId, 'replace-mechanism action preserves selection targets for same-type path ownership');
  assert.equal(selectedReplaceProject.selectedMechanismId, selectedReplaceSource.id, 'replace-mechanism action keeps selected mechanism when replacing in-place');

  const existingSelected = mechanismWithGeneratedPath(sample.mechanisms[0]);
  const sameTypeAddBase: ProjectState = {
    ...sample,
    selectedMechanismId: existingSelected.id,
  };
  const sameTypeAddProject = applyProjectAction(
    sameTypeAddBase,
    {
      type: 'upsert_mechanism',
      mechanism: {
        ...existingSelected,
        id: 'add-mechanism-contract',
        targetPartId: undefined,
        targetSceneObjectId: undefined,
        targetPathId: undefined,
        targetAnchorJointId: undefined,
        activeVisualPartIds: undefined,
      },
    },
  );
  assert.strictEqual(
    sameTypeAddProject,
    sameTypeAddBase,
    'upsert rejects an unbound mechanism atomically instead of adding a detached same-type mechanism',
  );

  const largerKit = { ...sample.settings.physicalKit, boardCells: 40 };
  const kitSpecificPlacement = { ...fourbar, anchorX: 200, anchorY: 0 };
  assert(!mechanismEditIsSafe(kitSpecificPlacement), 'default physical kit still rejects mechanisms outside its board');
  assert(mechanismEditIsSafe(kitSpecificPlacement, largerKit), 'runtime edit authority uses the provided physical kit instead of the default board');
  assert.deepEqual(
    constrainMechanismUpdate(fourbar, { anchorX: 200, anchorY: 0 }, largerKit),
    { anchorX: 200, anchorY: 0 },
    'central runtime authority preserves edits that are feasible under the active physical kit'
  );
  const recoveryKit = { ...sample.settings.physicalKit, gridPitchMm: 25 };
  const offGridPlacement = mechanismWithGeneratedPath({
    ...fourbar,
    anchorX: -120,
    anchorY: 100,
    groundLength: 200,
    crankLength: 80,
    couplerLength: 240,
    rockerLength: 160,
  });
  assert.equal(mechanismEditIsSafe(offGridPlacement, recoveryKit), false, 'grid pitch changes can leave existing mechanisms unsafe without auto-resnapping them');
  assert.equal(motionSafeParamRange(offGridPlacement, 'anchorX', recoveryKit)?.currentSafe, false, 'off-grid anchor reports an unsafe current state for fabrication/export gating');
  assert.equal(mechanismParamIsPlacementRecoveryEditable(offGridPlacement, 'anchorX', recoveryKit), true, 'Design keeps anchor X editable for placement recovery');
  assert.equal(mechanismParamIsPlacementRecoveryEditable(offGridPlacement, 'anchorY', recoveryKit), true, 'Design keeps anchor Y editable for placement recovery');
  assert.equal(mechanismParamIsPlacementRecoveryEditable(offGridPlacement, 'groundLength', recoveryKit), true, 'Design keeps the explicit four-bar board span editable during placement recovery');
  const repairedX = constrainMechanismUpdate(offGridPlacement, { anchorX: 0 }, recoveryKit);
  assert.deepEqual(repairedX, { anchorX: 0 }, 'anchor recovery changes only the requested placement field');
  const repairedY = constrainMechanismUpdate({ ...offGridPlacement, ...repairedX }, { anchorY: 100 }, recoveryKit);
  assert.deepEqual(repairedY, { anchorY: 100 }, 'already-repaired anchor Y remains a placement-only update without relocking recovery');
  const recoveredPlacement = { ...offGridPlacement, ...repairedX, ...repairedY };
  assert.equal(recoveredPlacement.groundLength, offGridPlacement.groundLength, 'staged anchor recovery preserves the board span');
  assert.equal(recoveredPlacement.crankLength, offGridPlacement.crankLength, 'staged anchor recovery preserves the selected input-link distance');
  assert.equal(recoveredPlacement.couplerLength, offGridPlacement.couplerLength, 'staged anchor recovery preserves the managed coupler length');
  assert.equal(recoveredPlacement.rockerLength, offGridPlacement.rockerLength, 'staged anchor recovery preserves the selected output-link distance');
  assert(mechanismEditIsSafe(recoveredPlacement, recoveryKit), 'staged anchor recovery restores a fabrication-safe mechanism without resizing links');
}
{
  const cam = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('cam', 'safe-cam-profile')));
  const unsafeProfile = [0.35, 1.65, 0.35, 1.65];
  assert(safeMechanismUpdate(cam, { camProfileSamples: unsafeProfile }), 'runtime authority accepts a finite cam profile when the complete sampled envelope remains safe');
  assert.deepEqual(constrainMechanismUpdate(cam, { camProfileSamples: unsafeProfile }).camProfileSamples, unsafeProfile, 'central runtime authority preserves a sampled-safe cam profile edit');
}

{
  const fourbar = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'safe-type-replacement')));
  const unsafeTypeReplacement = { ...fourbar, type: 'rack-pinion' as const };
  assert(mechanismUpdateRequiresReplacement({ type: 'rack-pinion' }), 'mechanism type changes are replacement-only, not metadata edits');
  assert.equal(safeMechanismUpdate(fourbar, { type: 'rack-pinion' }), false, 'type-only partial updates cannot bypass feasible-edit authority');
  assert.deepEqual(constrainMechanismUpdate(fourbar, { type: 'rack-pinion' }), {}, 'central runtime authority drops partial type edits');
  assert.equal(constrainMechanismCommit(fourbar, unsafeTypeReplacement).type, '4bar', 'existing mechanism commits reject unsafe structural type replacement');
}
{
  const fourbar = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'mixed-safe-metadata')));
  const constrained = constrainMechanismUpdate(fourbar, {
    groundLength: 9999,
    color: '#ff00aa',
    visible: false,
  });
  assert.deepEqual(constrained, {}, 'unsafe whole-candidate geometry rejects accompanying metadata instead of partially salvaging Object.entries fields');
}
{
  const gear = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('gear', 'safe-structured-gear')));
  const safeStructured = { gearTrainRadii: gear.gearTrainRadii };
  assert.deepEqual(constrainMechanismUpdate(gear, safeStructured).gearTrainRadii, gear.gearTrainRadii, 'safe structured gear-train edits are preserved explicitly');
  assert.equal(constrainMechanismUpdate(gear, { gearTrainRadii: [9999, 1] }).gearTrainRadii, undefined, 'unsafe structured gear-train edits are dropped explicitly');
}

{
  const fourbar = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'declared-domain-boundaries')));
  const familyMaxima = {
    groundAngle: 360,
    groundLength: 320,
    couplerLength: 320,
    rockerLength: 320,
    couplerPointDist: 220,
  } as const;
  for (const [key, declaredMax] of Object.entries(familyMaxima) as Array<[keyof typeof familyMaxima, number]>) {
    assert.deepEqual(
      constrainMechanismUpdate(fourbar, { [key]: declaredMax + 0.001 }),
      {},
      `${key} ordinary edits reject values above the declared four-bar maximum`,
    );
  }
  const gear = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('gear', 'gear-domain-boundary')));
  const genericGearRadiusMax = MECHANISM_PARAM_META.find(param => param.key === 'rockerLength')!.max;
  assert.deepEqual(
    constrainMechanismUpdate(gear, { rockerLength: genericGearRadiusMax + 0.001 }),
    {},
    'gear rocker/radius ordinary edits retain the generic declared maximum',
  );
}
{
  const prior = {
    ...mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('crank', 'trusted-derived-nongeometry'))),
    warnings: ['trusted prior warning'],
  };
  const candidate = {
    ...prior,
    color: '#ff00aa',
    visible: false,
    generatedPath: [{ x: Number.NaN, y: 9002 }],
    transform: { x: Number.NaN, y: 9003, rotation: 90, scale: 2 },
    sceneAnchor: { x: 9004, y: Number.POSITIVE_INFINITY },
    fabricationMetadata: { sceneAnchor: { x: Number.NaN, y: 9005 } },
    foundryExport: { id: 'candidate-only-package' } as FoundryExportPackage,
    warnings: ['candidate-only warning'],
  };
  const committed = constrainMechanismCommit(prior, candidate, sample.settings.physicalKit);
  assert.equal(committed.color, '#ff00aa', 'safe nongeometry color edit commits');
  assert.equal(committed.visible, false, 'safe nongeometry visibility edit commits');
  assert.deepEqual(committed.generatedPath, prior.generatedPath, 'nongeometry edit preserves prior trusted generated path');
  assert.deepEqual(committed.transform, prior.transform, 'nongeometry edit preserves prior trusted transform');
  assert.deepEqual(committed.sceneAnchor, prior.sceneAnchor, 'nongeometry edit preserves prior trusted scene anchor');
  assert.deepEqual(committed.fabricationMetadata, prior.fabricationMetadata, 'nongeometry edit preserves prior trusted fabrication metadata');
  assert.equal(committed.foundryExport, prior.foundryExport, 'nongeometry edit does not accept candidate-only package state');
  assert.deepEqual(committed.warnings, prior.warnings, 'nongeometry edit preserves prior trusted warnings');
}


{
  const mechanismTypeSource = readFileSync(join(process.cwd(), 'types.ts'), 'utf8');
  const mechanismConfigBody = /export interface MechanismConfig \{([\s\S]*?)\n\}/.exec(mechanismTypeSource)?.[1] ?? '';
  const mechanismConfigKeys = [...mechanismConfigBody.matchAll(/^    ([A-Za-z]\w*)\??:/gm)].map(match => match[1]).sort();
  const feasibilityKeys = [...MECHANISM_FEASIBILITY_AUTHORITY_KEYS].map(String).sort();
  const nonFeasibilityKeys = [...MECHANISM_NON_FEASIBILITY_EDIT_KEYS].map(String).sort();
  const replacementKeys = [...MECHANISM_REPLACEMENT_ONLY_KEYS].map(String).sort();
  assert.deepEqual(feasibilityKeys.filter(key => nonFeasibilityKeys.includes(key) || replacementKeys.includes(key)), [], 'mechanism edit authority does not double-classify feasibility fields');
  assert.deepEqual(nonFeasibilityKeys.filter(key => replacementKeys.includes(key)), [], 'mechanism edit authority keeps replacement-only fields out of metadata');
  assert.deepEqual([...new Set([...feasibilityKeys, ...nonFeasibilityKeys, ...replacementKeys])].sort(), mechanismConfigKeys, 'every MechanismConfig field is classified as feasibility-gated, metadata/binding-only, or replacement-only');
}

{
  const jammyFourbar = mechanismWithGeneratedPath({
    ...normalizeMechanismToReference(createDefaultMechanism('4bar', 'render-locked-options')),
    groundLength: 300,
    crankLength: 10,
    couplerLength: 10,
    rockerLength: 10,
  });
  const html = renderToString(createElement(MechanismParametricEditor, {
    mechanism: jammyFourbar,
    onChange: () => undefined,
  }));
  assert(html.includes('data-testid="mechanism-motion-option-locks"'), 'parametric editor renders locked-option warning for jam-prone choices');
  assert(html.includes('data-motion-safe="false"'), 'parametric editor marks unsafe choices in rendered options');
  assert(html.includes('disabled=""'), 'parametric editor disables unsafe non-current choices');
  const denseKit = { ...sample.settings.physicalKit, gridPitchMm: 10, boardCells: 30 };
  const denseHtml = renderToString(createElement(MechanismParametricEditor, {
    mechanism: mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'dense-editor-render'))),
    kit: denseKit,
    onChange: () => undefined,
  }));
  const managedLinkLengths = FABRICATION_LINKAGE_SPECS
    .map(spec => spec.lengthMm * SCENE_PX_PER_MM)
    .join(',');
  assert(denseHtml.includes('data-kit-grid-pitch-mm="10"') && denseHtml.includes(`data-link-option-scene-lengths="${managedLinkLengths}"`), 'parametric editor reports active board pitch while keeping managed linkage vectors canonical');

  const visibleText = (htmlText: string) => htmlText.replace(/<[^>]+>/g, '');
  const linkageSpec = FABRICATION_LINKAGE_SPECS.find(spec => spec.holeCentersMm.length >= 3) ?? FABRICATION_LINKAGE_SPECS[0];
  const linkageHoleIndex = 1;
  const linkageConfirmationHtml = renderToString(createElement(MechanismParametricEditor, {
    mechanism: {
      ...mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'linkage-confirmation-render'))),
      connectionSelections: {
        '4bar.input-joint': { kind: 'linkage-hole', linkageKey: linkageSpec.key, holeIndex: linkageHoleIndex }
      }
    },
    onChange: () => undefined,
  }));
  const linkageVisibleText = visibleText(linkageConfirmationHtml);
  assert(linkageVisibleText.includes(`Input joint: ${fabricationPartDisplayLabel(linkageSpec.label)} · Hole ${linkageHoleIndex + 1}`), 'linkage-hole confirmation shows student-safe part label and one-based physical hole ordinal');
  assert(!linkageVisibleText.includes(linkageSpec.key) && !/#\d+/.test(linkageVisibleText) && !/linkage-\d+-cell|4bar\.|snake_case/.test(linkageVisibleText), 'linkage-hole confirmation hides raw keys, zero-based #indexes, and internal identifiers from visible copy');
  assert(linkageConfirmationHtml.includes('data-connection-role="4bar.input-joint"') && linkageConfirmationHtml.includes('data-connection-kind="linkage-hole"') && linkageConfirmationHtml.includes(`data-connection-part-key="${linkageSpec.key}"`) && linkageConfirmationHtml.includes(`data-connection-hole-index="${linkageHoleIndex}"`), 'linkage-hole confirmation retains raw diagnostic metadata in attributes');

  const gearSpec = FABRICATION_GEAR_SPECS.find(spec => spec.attachmentHoleCentersMm.length >= 3) ?? FABRICATION_GEAR_SPECS[0];
  const gearHoleIndex = 0;
  const gearRadius = gearSpec.pitchRadiusMm * SCENE_PX_PER_MM;
  const gearConfirmationHtml = renderToString(createElement(MechanismParametricEditor, {
    mechanism: {
      ...mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('gear_linkage', 'gear-confirmation-render'))),
      crankLength: gearRadius,
      rockerLength: gearRadius,
      gearTrainRadii: [gearRadius, gearRadius],
      connectionSelections: {
        'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: gearSpec.key, gearIndex: 0, holeIndex: gearHoleIndex }
      }
    },
    onChange: () => undefined,
  }));
  const gearVisibleText = visibleText(gearConfirmationHtml);
  assert(gearVisibleText.includes(`Drive pin: ${fabricationPartDisplayLabel(gearSpec.label)} · Hole ${gearHoleIndex + 1}`), 'gear-attachment-hole confirmation shows student-safe gear label and one-based physical hole ordinal');
  assert(!gearVisibleText.includes(gearSpec.key) && !/#\d+/.test(gearVisibleText) && !/gear_linkage\.|snake_case/.test(gearVisibleText), 'gear-attachment-hole confirmation hides raw keys, zero-based #indexes, and internal identifiers from visible copy');
  assert(gearConfirmationHtml.includes('data-connection-role="gear_linkage.drive-pin"') && gearConfirmationHtml.includes('data-connection-kind="gear-attachment-hole"') && gearConfirmationHtml.includes(`data-connection-part-key="${gearSpec.key}"`) && gearConfirmationHtml.includes(`data-connection-hole-index="${gearHoleIndex}"`), 'gear-attachment-hole confirmation retains raw diagnostic metadata in attributes');
}

ALL_MECHANISM_TYPES.forEach(type => {
  assert(MECHANISM_TEMPLATE_LIBRARY[type].label && MECHANISM_TEMPLATE_LIBRARY[type].sense, `${type} has shared template metadata`);
});
assert.deepEqual(Object.keys(MECHANISM_FEATURE_REGISTRY).sort(), [...ALL_MECHANISM_TYPES].sort(), 'feature registry covers every mechanism type exactly once');
assert.deepEqual(validateMechanismFeatureRegistry(), [], 'feature registry passes static self-checks');
ALL_MECHANISM_TYPES.forEach(type => {
  const feature = mechanismFeature(type);
  const mechanism = feature.defaults(`${type}-registry-test`);
  assert.equal(mechanism.type, type, `${type} feature creates a default mechanism of the same type`);
  assert.equal(feature.label, MECHANISM_TEMPLATE_LIBRARY[type].label, `${type} feature label mirrors shared metadata`);
  assert.deepEqual(feature.requiredParts(mechanism), mechanismRequiredParts(mechanism), `${type} feature required parts use canonical project helper`);
  assert(!('fabricationStack' in (feature as unknown as Record<string, unknown>)), `${type} feature contract does not expose legacy fabrication stack helpers`);
  assert.equal(feature.fabricationPlan(mechanism).roleSummary, compileMechanismRenderPlan(mechanism).roleSummary, `${type} feature render plan uses the graph compiler facade`);
  assert.equal(feature.sampleKinematics(mechanism, 0).isValid, calculateLinkage(mechanism, 0).isValid, `${type} feature kinematics use canonical solver`);
  const feasibleRange = feature.sampleFeasibleRange(mechanism, 12);
  assert.equal(feasibleRange.percentValid, sampleFeasibleRange(mechanism, 12).percentValid, `${type} feature feasible range uses canonical sampler`);
  assert(feasibleRange.startDeg >= 0 && feasibleRange.endDeg <= 360 && feasibleRange.intervals.every(interval => interval.startDeg >= 0 && interval.endDeg <= 360), `${type} feasible range reports one normalized 0–360° cycle`);
  assert(feature.interactionPolicy(mechanism).writesProjectState, `${type} feature declares ProjectState-backed edits`);
  assert.deepEqual(feature.interactionPolicy(mechanism).draggableHandles, expectedCanvasDragHandles[type], `${type} feature preserves legacy Canvas drag handles`);
  assert(feature.projectionHints(mechanism).every(hint => hint.source === 'mechanism-feature-registry' && hint.zStackUsesFabricationPlan), `${type} feature declares fabrication-backed projection`);
  assert(feature.physicsHints(mechanism).every(hint => hint.solver === 'kinematic-derived' && hint.preservesProjectState), `${type} feature declares derived physics sidecar behavior`);
});
assert(mechanismFeature('gear').interactionPolicy(createDefaultMechanism('gear')).editableParameters.includes('gearTrainRadii'), 'gear Foundry/Design editing exposes ordered fabrication gear sizes');
assert(!mechanismFeature('gear').interactionPolicy(createDefaultMechanism('gear')).editableParameters.includes('groundLength'), 'gear Foundry/Design editing derives axle span from the selected fabrication gear sizes');
assert(mechanismFeature('gear_linkage').interactionPolicy(createDefaultMechanism('gear_linkage')).editableParameters.includes('couplerLength'), 'gear-linkage Foundry/Design editing exposes the paired linkage length');
assert(!mechanismFeature('gear_linkage').interactionPolicy(createDefaultMechanism('gear_linkage')).editableParameters.includes('groundLength'), 'gear-linkage Foundry/Design editing derives endpoint span from selected gears and idlers');
assert(!mechanismFeature('planetary_gear').interactionPolicy(createDefaultMechanism('planetary_gear')).editableParameters.includes('groundLength'), 'planetary gear editing keeps the fixed G1/G3/R56 kit geometry');
assert.deepEqual(mechanismFeature('planetary_gear').interactionPolicy(createDefaultMechanism('planetary_gear')).editableParameters, ['phase'], 'planetary gear exposes only visual phase once G1/G3/R56 kit geometry is fixed');
assert(mechanismFeature('cam').interactionPolicy(createDefaultMechanism('cam')).editableParameters.includes('camProfileSamples'), 'cam Foundry/Design editing exposes the editable lift profile');
assert(!mechanismFeature('cam').interactionPolicy(createDefaultMechanism('cam')).editableParameters.includes('crankLength'), 'cam hides fixed module radii from generic numeric editing');
assert(!mechanismFeature('cam').interactionPolicy(createDefaultMechanism('cam')).editableParameters.includes('rockerLength'), 'cam hides fixed guide travel from generic numeric editing');
assert(!mechanismFeature('piston').interactionPolicy(createDefaultMechanism('piston')).editableParameters.includes('rodLength'), 'slider-crank piston hides fixed kit rod dimensions from generic numeric editing');

const connectionSelectionContractFailures: string[] = [];
const checkConnectionSelectionContract = (name: string, check: () => void) => {
  try {
    check();
  } catch (error) {
    connectionSelectionContractFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
const selectedLinkageKey = FABRICATION_LINKAGE_SPECS.find(spec => spec.holeCentersMm.length >= 3)?.key ?? FABRICATION_LINKAGE_SPECS[0].key;
const selectedGearKey = FABRICATION_GEAR_SPECS.find(spec => spec.attachmentHoleCentersMm.length >= 3)?.key ?? FABRICATION_GEAR_SPECS[0].key;
const withConnectionSelections = <T extends MechanismConfig>(mechanism: T, connectionSelections: Record<string, ConnectionSelection>): T =>
  ({ ...mechanism, connectionSelections }) as T;
const projectWithConnectionMechanism = (mechanism: MechanismConfig): ProjectState => ({ ...sample, mechanisms: [mechanism] });
const loadedConnectionMechanism = (mechanism: MechanismConfig): MechanismConfig => loadProjectSnapshot(JSON.parse(serializeProject(projectWithConnectionMechanism(mechanism)))).mechanisms[0];
const connectionSnapshot = (mechanism: MechanismConfig) => buildMechanismSnapshot(projectWithConnectionMechanism(mechanism), mechanism.id);
type ConnectionSnapshot = NonNullable<ReturnType<typeof buildMechanismSnapshot>>;
const graphNode = (snapshot: ConnectionSnapshot, id: string) => snapshot.graph.nodes.find(node => node.id === id);
const graphConstraint = (snapshot: ConnectionSnapshot, id: string) => snapshot.graph.constraints.find(constraint => constraint.id === id);
const connectionPointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const assertConnectionGraphPoint = (snapshot: ConnectionSnapshot, nodeId: string, expected: Point, label: string) => assertPointClose(graphNode(snapshot, nodeId)?.position, expected, label);
const assertConnectionGraphDistance = (snapshot: ConnectionSnapshot, constraintId: string, label: string) => {
  const constraint = graphConstraint(snapshot, constraintId);
  assert(constraint && Number.isFinite(constraint.value), `${label} constraint has a finite target length`);
  const [startId, endId] = constraint.nodes;
  const start = graphNode(snapshot, startId)?.position;
  const end = graphNode(snapshot, endId)?.position;
  assert(start && end, `${label} constraint endpoints have graph positions`);
  const expected = Math.abs(constraint.value as number);
  const actual = connectionPointDistance(start, end);
  const tolerance = readinessPhysicalTolerance(expected);
  assert(Math.abs(actual - expected) <= tolerance, `${label} actual distance ${actual} matches ${expected} within repo tolerance ${tolerance}`);
};
const assertFabricationValidConnectionFixture = (mechanism: MechanismConfig, label: string) => {
  assert.equal(calculateLinkage(mechanism, 0).isValid, true, `${label} closes at the graph reference phase`);
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], `${label} is preview-ready instead of relying on infeasible geometry`);
  const fabrication = compileMechanismGraphFabrication(mechanism, sample.settings.physicalKit);
  assert.equal(fabrication.buildable, true, `${label} is fabrication-valid: ${fabrication.blocker ?? fabrication.renderPlan.validationErrors.join(' | ')}`);
};
const stableConnectionFingerprint = (mechanism: MechanismConfig): string => {
  const snapshot = connectionSnapshot(mechanism);
  assert(snapshot, `${mechanism.id} snapshot exists`);
  return snapshot.fingerprint;
};
const jsonHasConnectionValidation = (value: unknown): boolean => /connection selection|connectionSelections|invalid role|wrong kind|holeIndex|gearIndex|linkageKey|gearKey/i.test(stableGoldenMasterJson(value));

checkConnectionSelectionContract('persists exact ConnectionSelectionRole union and validates role/kind pairs', () => {
  const typesText = readFileSync(join(process.cwd(), 'types.ts'), 'utf8');
  for (const role of CONNECTION_SELECTION_ROLES) assert(typesText.includes(`'${role}'`), `${role} is in the persisted role union`);
  assert(!/ConnectionSelections\s*=\s*Partial<Record<\s*MechanismDragHandle/.test(typesText), 'connection selections are not keyed by generic MechanismDragHandle values');
  assert(
    typesText.includes("kind: 'linkage-hole'")
      && typesText.includes("kind: 'gear-attachment-hole'")
      && typesText.includes("kind: 'board-mount-pattern'")
      && typesText.includes("kind: 'module-hole'"),
    'all physical linkage, gear, board-mount, and module-hole selection kinds are serializable',
  );
  assert(typesText.includes('linkageKey: FabricationLinkageKey') && typesText.includes('gearKey: FabricationGearKey'), 'connection part keys use the typed fabrication inventory key contracts');

  const validFourBar = withConnectionSelections(createDefaultMechanism('4bar', 'connection-valid-4bar'), {
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 },
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 0 }
  });
  assert.deepEqual(
    (
      loadedConnectionMechanism(validFourBar) as unknown as {
        connectionSelections?: unknown;
      }
    ).connectionSelections,
    (validFourBar as unknown as { connectionSelections: unknown }).connectionSelections,
    '4bar linkage-hole selections round-trip through save/load'
  );
  assert.equal(connectionSelectionSignature(validFourBar.connectionSelections), `4bar.input-joint:${selectedLinkageKey}:0|4bar.output-joint:${selectedLinkageKey}:2`, 'connection selection signatures use canonical role order instead of object insertion order');

  const validGearLinkage = withConnectionSelections(createDefaultMechanism('gear_linkage', 'connection-valid-gear-linkage'), {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 2 }
  });
  assert.deepEqual(
    (
      loadedConnectionMechanism(validGearLinkage) as unknown as {
        connectionSelections?: unknown;
      }
    ).connectionSelections,
    (validGearLinkage as unknown as { connectionSelections: unknown }).connectionSelections,
    'gear_linkage gear-attachment-hole selections round-trip through save/load'
  );

  const invalidFourBar = withConnectionSelections(createDefaultMechanism('4bar', 'connection-invalid-roles'), {
    P1: { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 0 },
    J1: { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 },
    J2: { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 },
    '4bar.input-joint': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 99 },
    '4bar.board-hole': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 0 },
    'gear.center': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    illegal: { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 0 }
  });
  const loadedInvalid = loadedConnectionMechanism(invalidFourBar) as unknown as { connectionSelections?: Record<string, unknown>; warnings?: string[] };
  assert.deepEqual(Object.keys(loadedInvalid.connectionSelections ?? {}).sort(), [], 'P1/J1/J2/board-hole/gear-center/illegal and role-kind mismatches are dropped instead of remapped');
  assert(jsonHasConnectionValidation(loadedInvalid), 'invalid authored connection state carries explicit validation evidence');
});

checkConnectionSelectionContract('derives defaults only when legacy selections are genuinely missing and keeps snapshot fingerprints stable', () => {
  const missingLegacy = createDefaultMechanism('4bar', 'connection-missing-legacy');
  const loadedMissingA = loadedConnectionMechanism(missingLegacy);
  const loadedMissingB = loadedConnectionMechanism(missingLegacy);
  assert.deepEqual((loadedMissingA as unknown as { connectionSelections?: unknown }).connectionSelections, (loadedMissingB as unknown as { connectionSelections?: unknown }).connectionSelections, 'missing legacy selection defaults are deterministic');
  assert.equal(stableConnectionFingerprint(loadedMissingA), stableConnectionFingerprint(loadedMissingB), 'missing legacy defaults produce a stable snapshot fingerprint');

  const fourBarDefaults = normalizeMechanismConnectionSelections(missingLegacy, undefined);
  const defaultInput = fourBarDefaults.connectionSelections?.['4bar.input-joint'];
  const defaultOutput = fourBarDefaults.connectionSelections?.['4bar.output-joint'];
  assert(defaultInput?.kind === 'linkage-hole' && defaultOutput?.kind === 'linkage-hole', '4bar legacy defaults resolve both physical roles');
  const partialFourBar = normalizeMechanismConnectionSelections(missingLegacy, {
    '4bar.input-joint': defaultInput,
  });
  assert.deepEqual(partialFourBar.connectionSelections?.['4bar.input-joint'], defaultInput, 'partial 4bar state preserves its authored input role');
  assert.deepEqual(partialFourBar.connectionSelections?.['4bar.output-joint'], defaultOutput, 'partial 4bar state defaults only the genuinely absent output role');
  assert(connectionSelectionAccepted(partialFourBar.connectionSelectionValidation, '4bar.input-joint'), 'present partial 4bar input is accepted as authored');
  assert(partialFourBar.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.output-joint' && entry.status === 'defaulted'), 'absent partial 4bar output keeps compatibility-default evidence');

  const explicitlyReauthoredDefault = authorMechanismConnectionSelection(
    { ...missingLegacy, ...fourBarDefaults },
    '4bar.input-joint',
    defaultInput,
  );
  assert(connectionSelectionAccepted(explicitlyReauthoredDefault.connectionSelectionValidation, '4bar.input-joint'), 'explicitly reselecting the deterministic input hole records authored acceptance');
  assert(explicitlyReauthoredDefault.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.output-joint' && entry.status === 'defaulted'), 'explicit input reauthoring preserves unrelated legacy-default provenance');

  const missingGearLinkage = createDefaultMechanism('gear_linkage', 'connection-partial-gear-linkage');
  const gearLinkageDefaults = normalizeMechanismConnectionSelections(missingGearLinkage, undefined);
  const defaultDrive = gearLinkageDefaults.connectionSelections?.['gear_linkage.drive-pin'];
  const defaultOutputPin = gearLinkageDefaults.connectionSelections?.['gear_linkage.output-pin'];
  assert(defaultDrive?.kind === 'gear-attachment-hole' && defaultOutputPin?.kind === 'gear-attachment-hole', 'gear_linkage legacy defaults resolve both physical roles');
  const partialGearLinkage = normalizeMechanismConnectionSelections(missingGearLinkage, {
    'gear_linkage.drive-pin': defaultDrive,
  });
  assert.deepEqual(partialGearLinkage.connectionSelections?.['gear_linkage.drive-pin'], defaultDrive, 'partial gear_linkage state preserves its authored drive pin');
  assert.deepEqual(partialGearLinkage.connectionSelections?.['gear_linkage.output-pin'], defaultOutputPin, 'partial gear_linkage state defaults only the genuinely absent output pin');
  assert(connectionSelectionAccepted(partialGearLinkage.connectionSelectionValidation, 'gear_linkage.drive-pin'), 'present partial gear_linkage drive pin is accepted as authored');
  assert(partialGearLinkage.connectionSelectionValidation?.entries.some(entry => entry.role === 'gear_linkage.output-pin' && entry.status === 'defaulted'), 'absent partial gear_linkage output pin keeps compatibility-default evidence');

  const invalidAuthored = withConnectionSelections(createDefaultMechanism('4bar', 'connection-invalid-not-default'), {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 999 }
  });
  const loadedInvalid = loadedConnectionMechanism(invalidAuthored) as unknown as { connectionSelections?: Record<string, unknown> };
  assert(!loadedInvalid.connectionSelections?.['4bar.input-joint'], 'authored invalid holeIndex does not become the deterministic default');
  assert.deepEqual(loadedInvalid.connectionSelections?.['4bar.output-joint'], defaultOutput, 'invalid authored input does not suppress the genuinely absent output default');
  assert.notEqual(stableConnectionFingerprint(loadedInvalid as MechanismConfig), stableConnectionFingerprint(loadedMissingA), 'authored invalid state is distinguishable from genuinely missing legacy defaults in snapshots/fingerprints');
});

checkConnectionSelectionContract('preserves authored invalid connection evidence after rejected entries are dropped', () => {
  const invalidAuthored = withConnectionSelections(createDefaultMechanism('4bar', 'connection-invalid-evidence'), {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 999 },
    illegal: { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 0 }
  });
  const loadedInvalid = loadedConnectionMechanism(invalidAuthored);
  assert.deepEqual(Object.keys(loadedInvalid.connectionSelections ?? {}), ['4bar.output-joint'], 'invalid authored entries are dropped while the genuinely absent sibling role defaults');
  assert.equal(loadedInvalid.connectionSelectionValidation?.status, 'invalid', 'dropped authored entries retain an invalid validation result');
  assert(loadedInvalid.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.input-joint' && entry.status === 'rejected'), 'retained validation identifies the dropped authored input as rejected');
  assert(loadedInvalid.connectionSelectionValidation?.entries.some(entry => entry.role === 'illegal' && entry.status === 'rejected'), 'retained validation identifies the illegal authored role as rejected');
  assert(loadedInvalid.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.output-joint' && entry.status === 'defaulted'), 'retained validation distinguishes the genuinely absent output default from rejected authored state');

  const snapshot = connectionSnapshot(loadedInvalid);
  assert(snapshot, 'invalid authored connection snapshot exists');
  const compiled = compileMechanism(loadedInvalid);
  const evidenceSurfaces: Record<string, unknown> = {
    'snapshot mechanism': snapshot.mechanism.connectionSelectionValidation,
    'snapshot graph': snapshot.graph.connectionSelectionSummary,
    'snapshot fabrication plan': snapshot.fabricationPlan.connectionSelectionSummary,
    'snapshot compiler summary': snapshot.graphCompiler.connectionSelectionSummary,
    'direct graph': mechanismGraphForMechanism(loadedInvalid).connectionSelectionSummary,
    'direct compiler summary': summarizeCompiledMechanism(compiled).connectionSelectionSummary
  };
  assert.deepEqual(
    Object.entries(evidenceSurfaces)
      .filter(([, value]) => !jsonHasConnectionValidation(value))
      .map(([surface]) => surface),
    [],
    'authored invalid connection validation evidence survives every snapshot, graph, fabrication, and compiler summary surface'
  );
});

checkConnectionSelectionContract('repairs only the physically re-authored role while preserving unrelated rejection evidence', () => {
  const invalidAuthored = withConnectionSelections(createDefaultMechanism('4bar', 'connection-per-role-repair'), {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 998 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 999 }
  });
  const invalidState = normalizeMechanismConnectionSelections(invalidAuthored, invalidAuthored.connectionSelections);
  const invalidMechanism = { ...invalidAuthored, ...invalidState };
  const repairCandidates = mechanismConnectionHoleCandidates(invalidMechanism, calculateLinkage(invalidMechanism, 0));
  assert(repairCandidates.some(candidate => candidate.role === '4bar.input-joint'), 'rejected 4bar input still exposes physical-hole candidates for an explicit repair gesture');
  assert(repairCandidates.filter(candidate => candidate.role === '4bar.input-joint').every(candidate => !candidate.selected), 'rejected 4bar input candidates do not masquerade as a default authored selection');
  const repaired = { ...invalidMechanism, ...authorMechanismConnectionSelection(invalidMechanism, '4bar.input-joint', { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 }) };
  const repairedInput = repaired.connectionSelections?.['4bar.input-joint'];
  assert.equal(repairedInput?.kind === 'linkage-hole' ? repairedInput.holeIndex : undefined, 1, 'new physical input gesture replaces the rejected input role');
  assert(!repaired.connectionSelections?.['4bar.output-joint'], 'unrepaired output selection remains dropped');
  assert.equal(repaired.connectionSelectionValidation?.status, 'invalid', 'unrelated rejected output evidence keeps the mechanism invalid');
  assert(repaired.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.output-joint' && entry.status === 'rejected'), 'unrelated output rejection survives input repair');
  assert(!repaired.connectionSelectionValidation?.entries.some(entry => entry.role === '4bar.input-joint' && entry.status === 'rejected'), 'repaired input rejection is cleared by its new physical gesture');
});

checkConnectionSelectionContract('keeps 4bar selected physical holes authoritative over legacy endpoint scalars', () => {
  const scalarDesynced = withConnectionSelections(
    { ...createDefaultMechanism('4bar', 'connection-fourbar-scalar-desync'), crankLength: 999, rockerLength: 777 },
    {
      '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 },
      '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 }
    }
  );
  const loaded = loadedConnectionMechanism(scalarDesynced);
  const resolved = resolveFourBarConnectionSelections(loaded);
  assert(resolved.inputJoint && resolved.outputJoint, '4bar selected input/output holes resolve to physical endpoint lengths');
  assert.equal(loaded.crankLength, resolved.inputJoint.length, 'selected input physical hole updates the compatibility crankLength scalar');
  assert.equal(loaded.rockerLength, resolved.outputJoint.length, 'selected output physical hole updates the compatibility rockerLength scalar');
  const state = calculateLinkage(loaded, 0);
  const coordinates = connectionSelectionSceneCoordinates(loaded, state, loaded.connectionSelections);
  const inputCoordinate = coordinates['4bar.input-joint'];
  const outputCoordinate = coordinates['4bar.output-joint'];
  assert(inputCoordinate && outputCoordinate, '4bar selected-hole coordinates exist');
  assertPointClose(state.j1, inputCoordinate, 'J1 stays driven by the selected input hole, not stale crankLength');
  assertPointClose(state.j2, outputCoordinate, 'J2 stays driven by the selected output hole, not stale rockerLength');
  assertConnectionGraphPoint(connectionSnapshot(loaded)!, 'j1', inputCoordinate, 'graph J1 stays synchronized to selected physical input hole');
  assertConnectionGraphPoint(connectionSnapshot(loaded)!, 'j2', outputCoordinate, 'graph J2 stays synchronized to selected physical output hole');
});

checkConnectionSelectionContract('keeps the selected full linkage blank while using an interior hole as the effective 4bar joint', () => {
  const fullSpec = FABRICATION_LINKAGE_SPECS.at(-1)!;
  const selectedHoleIndex = Math.min(2, fullSpec.holeCentersMm.length - 2);
  const mechanism = loadedConnectionMechanism(withConnectionSelections(createDefaultMechanism('4bar', 'connection-full-blank-interior-hole'), {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: fullSpec.key, holeIndex: selectedHoleIndex },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 }
  }));
  const selectedHole = fullSpec.holeCentersMm[selectedHoleIndex];
  const firstHole = fullSpec.holeCentersMm[0];
  const expectedJointDistance = Math.hypot(selectedHole.x - firstHole.x, selectedHole.y - firstHole.y) * SCENE_PX_PER_MM;
  const state = calculateLinkage(mechanism, 0);
  const resolved = resolveFourBarConnectionSelections(mechanism);
  const blankPose = resolveFourBarLinkageBlankPoses(mechanism, state)['4bar.input-joint'];
  const graph = mechanismGraphForMechanism(mechanism);
  const fabrication = compileMechanismGraphFabrication(mechanism, sample.settings.physicalKit);

  assert.equal(resolved.inputJoint?.length, expectedJointDistance, 'effective input distance comes from the selected interior hole offset');
  assert.equal(graph.constraints.find(constraint => constraint.id === 'input-length')?.value, expectedJointDistance, 'graph distance constraint uses the selected interior hole offset');
  assert.equal(blankPose?.partKey, fullSpec.key, 'shared renderer pose keeps the selected full managed blank key');
  assert.equal(blankPose?.selectedHoleIndex, selectedHoleIndex, 'shared renderer pose identifies the physical interior pivot');
  assert(blankPose && connectionPointDistance(blankPose.origin, blankPose.end) > expectedJointDistance, 'full blank renderer pose extends beyond the selected interior joint');
  assert(fabrication.recipe?.requiredParts.some(part => part.part === `linkages:${fullSpec.key}`), 'fabrication requiredParts keeps the full selected linkage blank instead of substituting a shorter part');
  assert(fabrication.renderPlan.connectionSelectionSummary?.connectionSelections?.['4bar.input-joint']?.kind === 'linkage-hole', 'render plan carries the same selected full-blank role');
});

checkConnectionSelectionContract('propagates independent fabrication-valid 4bar hole coordinates through graph, kinematics, fabrication, and export snapshots', () => {
  const fourBarBase = createDefaultMechanism('4bar', 'connection-coordinate-4bar');
  const fourBarInputA = withConnectionSelections(fourBarBase, {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 }
  });
  const fourBarInputB = withConnectionSelections(fourBarBase, {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 }
  });
  const fourBarOutputB = withConnectionSelections(fourBarBase, {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 }
  });
  const fourBarInputASnapshot = connectionSnapshot(fourBarInputA);
  const fourBarInputBSnapshot = connectionSnapshot(fourBarInputB);
  const fourBarOutputBSnapshot = connectionSnapshot(fourBarOutputB);
  assert(fourBarInputASnapshot && fourBarInputBSnapshot && fourBarOutputBSnapshot, '4bar selection snapshots exist');
  [fourBarInputA, fourBarInputB, fourBarOutputB].forEach((mechanism, index) => assertFabricationValidConnectionFixture(mechanism, `4bar fabrication-valid selection ${index + 1}`));
  assert.deepEqual(fourBarInputA.connectionSelections?.['4bar.output-joint'], fourBarInputB.connectionSelections?.['4bar.output-joint'], '4bar input variation leaves the authored output selection record unchanged');
  assert.deepEqual(fourBarInputA.connectionSelections?.['4bar.input-joint'], fourBarOutputB.connectionSelections?.['4bar.input-joint'], '4bar output variation leaves the authored input selection record unchanged');
  assert.deepEqual(graphNode(fourBarInputASnapshot, 'p1')?.position, graphNode(fourBarInputBSnapshot, 'p1')?.position, '4bar input variation keeps fixed input ground unchanged');
  assert.deepEqual(graphNode(fourBarInputASnapshot, 'p2')?.position, graphNode(fourBarInputBSnapshot, 'p2')?.position, '4bar input variation keeps fixed output ground unchanged');
  assert.equal(graphConstraint(fourBarInputASnapshot, 'coupler-length')?.value, graphConstraint(fourBarInputBSnapshot, 'coupler-length')?.value, '4bar input variation leaves derived coupler length unchanged');
  assert.equal(graphConstraint(fourBarInputASnapshot, 'output-length')?.value, graphConstraint(fourBarInputBSnapshot, 'output-length')?.value, '4bar input variation leaves effective output length unchanged');
  assert.notDeepEqual(graphNode(fourBarInputASnapshot, 'j1')?.position, graphNode(fourBarInputBSnapshot, 'j1')?.position, '4bar input-joint hole changes input crank coordinate');
  assert.deepEqual(graphNode(fourBarInputASnapshot, 'j1')?.position, graphNode(fourBarOutputBSnapshot, 'j1')?.position, '4bar output-joint variation leaves the input crank coordinate unchanged');
  assert.notDeepEqual(graphNode(fourBarInputASnapshot, 'j2')?.position, graphNode(fourBarOutputBSnapshot, 'j2')?.position, '4bar output-joint hole changes output rocker coordinate');
  ([[fourBarInputA, fourBarInputASnapshot, '4bar short input'], [fourBarInputB, fourBarInputBSnapshot, '4bar full input'], [fourBarOutputB, fourBarOutputBSnapshot, '4bar short output']] as const).forEach(([mechanism, snapshot, label]) => {
    const state = calculateLinkage(mechanism, 0);
    assertConnectionGraphPoint(snapshot, 'p1', state.p1, `${label} graph p1 matches calculateLinkage`);
    assertConnectionGraphPoint(snapshot, 'p2', state.p2, `${label} graph p2 matches calculateLinkage`);
    assertConnectionGraphPoint(snapshot, 'j1', state.j1, `${label} graph j1 matches calculateLinkage`);
    assertConnectionGraphPoint(snapshot, 'j2', state.j2, `${label} graph j2 matches calculateLinkage`);
    assertConnectionGraphPoint(snapshot, 'effector', state.effector, `${label} graph effector matches calculateLinkage`);
    assertConnectionGraphDistance(snapshot, 'input-length', `${label} input-length`);
    assertConnectionGraphDistance(snapshot, 'coupler-length', `${label} coupler-length`);
    assertConnectionGraphDistance(snapshot, 'output-length', `${label} output-length`);
  });
  assert(jsonHasConnectionValidation(fourBarInputBSnapshot.fabricationPlan) && jsonHasConnectionValidation(fourBarInputBSnapshot.graphCompiler), '4bar selected hole role is visible in fabrication/export compiler summaries');
});

checkConnectionSelectionContract('keeps Foundry hole geometry in the shared connection-selection domain', () => {
  const foundryStageText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'MechanismFoundry.tsx'), 'utf8');
  const foundryCanvasText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryCanvasPane.tsx'), 'utf8');
  const connectionOverlayText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'MechanismConnectionOverlay.tsx'), 'utf8');
  const physicalCandidateText = readFileSync(join(process.cwd(), 'utils', 'mechanismPhysicalCandidates.ts'), 'utf8');
  assert(foundryStageText.includes('projectMechanismConnectionHoleHandles') && foundryStageText.includes('connectionSelectionSceneCoordinates'), 'Foundry consumes shared connection-selection projection and coordinate helpers');
  assert(connectionOverlayText.includes('mechanismPhysicalConnectionCandidates'), 'the shared Foundry/Design overlay projects only canonical safety-approved physical candidates');
  assert(/connectionSelectionSceneCoordinates\(\s*landedFoundry,\s*selectedSimulation\.state,\s*selectedConnectionState\.connectionSelections,\s*project\.settings\.physicalKit,\s*\)/.test(foundryStageText), 'Foundry selected-coordinate telemetry uses the canonical normalized/defaulted selection pair and active kit');
  assert(physicalCandidateText.includes('authorMechanismConnectionSelection(') && physicalCandidateText.includes('resolveMechanismCandidateCommit('), 'the shared candidate authority delegates physical-hole writes and safety validation to the connection-selection and edit domains');
  assert(!foundryStageText.includes('connectionSelectionValidation.entries.filter'), 'Foundry does not manipulate connection-validation evidence in the stage layer');
  assert(!foundryStageText.includes('...(landedFoundry.connectionSelections ?? {})'), 'Foundry physical-hole writes never start from partial raw persisted selections');
  assert(foundryCanvasText.includes('onPointerDown={onConnectionHolePointerDown}') && connectionOverlayText.includes('onPointerDown(handle)'), 'Foundry physical holes author through the shared pointer-down affordance path');
  assert(!connectionOverlayText.includes('onClick='), 'shared physical holes do not dispatch the same authoring gesture again on click');
  for (const privateGeometry of ['FABRICATION_GEAR_SPECS', 'FABRICATION_LINKAGE_SPECS', 'SCENE_PX_PER_MM', 'gearTrainPitchRadii', 'rotateSceneOffset']) {
    assert(!foundryStageText.includes(privateGeometry), `Foundry stage does not own private ${privateGeometry} connection geometry`);
  }

  const fourBar = withConnectionSelections(createDefaultMechanism('4bar', 'connection-candidate-4bar'), {
    '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 },
    '4bar.output-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 2 }
  });
  const fourBarState = calculateLinkage(fourBar, 0);
  const fourBarCandidates = mechanismConnectionHoleCandidates(fourBar, fourBarState);
  assert(fourBarCandidates.some(candidate => candidate.role === '4bar.input-joint' && candidate.kind === 'linkage-hole' && candidate.partKey === selectedLinkageKey && candidate.holeIndex === 1 && candidate.selected), '4bar input candidate carries exact role/kind/part/hole/selected selection data');
  assert(fourBarCandidates.some(candidate => candidate.role === '4bar.output-joint' && candidate.selection.kind === 'linkage-hole' && candidate.selection.holeIndex === 2 && candidate.selected), '4bar output candidate carries canonical linkage selection data');
  assert(!fourBarCandidates.some(candidate => candidate.role.startsWith('4bar.') && candidate.holeIndex === 0), '4bar ground hole remains validator-compatible but is not authorable in Foundry candidates');
  const fourBarCoordinates = connectionSelectionSceneCoordinates(fourBar, fourBarState);
  assertPointClose(fourBarCandidates.find(candidate => candidate.role === '4bar.input-joint' && candidate.selected)?.coordinate, fourBarCoordinates['4bar.input-joint'], '4bar selected candidate coordinate matches shared selected-coordinate helper');

  const gear = withConnectionSelections(createDefaultMechanism('gear_linkage', 'connection-candidate-gear-linkage'), {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 1 }
  });
  const gearState = calculateLinkage(gear, 0);
  const gearCandidates = mechanismConnectionHoleCandidates(gear, gearState);
  assert(gearCandidates.some(candidate => candidate.role === 'gear_linkage.drive-pin' && candidate.kind === 'gear-attachment-hole' && candidate.partKey === selectedGearKey && candidate.selection.kind === 'gear-attachment-hole' && candidate.selection.gearIndex === 0 && candidate.selected), 'gear_linkage drive candidate carries exact role/kind/part/hole/gear selection data');
  assert(gearCandidates.some(candidate => candidate.role === 'gear_linkage.output-pin' && candidate.selection.kind === 'gear-attachment-hole' && candidate.selection.gearIndex === 1 && candidate.selected), 'gear_linkage output candidate carries canonical output gear selection data');
  const gearCoordinates = connectionSelectionSceneCoordinates(gear, gearState);
  assertPointClose(gearCoordinates['gear_linkage.drive-pin'], gearState.j1, 'gear_linkage selected drive coordinate is the canonical calculated drive pin');
  assertPointClose(gearCoordinates['gear_linkage.output-pin'], gearState.j2, 'gear_linkage selected output coordinate is the canonical calculated output pin');
  assertPointClose(gearCandidates.find(candidate => candidate.role === 'gear_linkage.output-pin' && candidate.selected)?.coordinate, gearCoordinates['gear_linkage.output-pin'], 'gear_linkage selected candidate coordinate matches shared selected-coordinate helper');

  const nextDriveCandidate = gearCandidates.find(candidate => candidate.role === 'gear_linkage.drive-pin' && candidate.holeIndex === 2);
  const nextOutputCandidate = gearCandidates.find(candidate => candidate.role === 'gear_linkage.output-pin' && candidate.holeIndex === 2);
  assert(nextDriveCandidate && nextOutputCandidate, 'gear_linkage exposes alternate drive and output attachment-hole candidates');
  const gearWithNextDrive = withConnectionSelections(gear, {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 2 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 1 }
  });
  const gearWithNextDriveState = calculateLinkage(gearWithNextDrive, 0);
  const gearWithNextDriveCoordinates = connectionSelectionSceneCoordinates(gearWithNextDrive, gearWithNextDriveState);
  assertPointClose(nextDriveCandidate.coordinate, gearWithNextDriveCoordinates['gear_linkage.drive-pin'], 'drive candidate coordinate before selection equals its canonical selected coordinate after selection');

  const gearWithNextOutput = withConnectionSelections(gear, {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 2 }
  });
  const gearWithNextOutputState = calculateLinkage(gearWithNextOutput, 0);
  const gearWithNextOutputCoordinates = connectionSelectionSceneCoordinates(gearWithNextOutput, gearWithNextOutputState);
  assertPointClose(nextOutputCandidate.coordinate, gearWithNextOutputCoordinates['gear_linkage.output-pin'], 'output candidate coordinate before selection equals its canonical selected coordinate after selection');
  assertPointClose(gearWithNextOutputState.j1, gearState.j1, 'changing the output attachment hole does not move the drive pin');
  assertPointClose(gearWithNextOutputState.p1, gearState.p1, 'changing the output attachment hole does not move the drive center');
  assertPointClose(gearWithNextOutputState.p2, gearState.p2, 'changing the output attachment hole does not move the output center');
});

checkConnectionSelectionContract('recovers gear_linkage candidates after endpoint gear geometry invalidates an old selection', () => {
  const driveSpec = FABRICATION_GEAR_SPECS.find(spec => spec.key !== selectedGearKey && spec.attachmentHoleCentersMm.length >= 3) ?? FABRICATION_GEAR_SPECS[0];
  const driveRadius = driveSpec.pitchRadiusMm * SCENE_PX_PER_MM;
  const changedDrive = withConnectionSelections(
    { ...createDefaultMechanism('gear_linkage', 'connection-gear-linkage-gear-change'), gearTrainRadii: [driveRadius, createDefaultMechanism('gear_linkage', 'connection-gear-linkage-gear-change-base').gearTrainRadii?.at(-1) ?? driveRadius], crankLength: driveRadius },
    {
      'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 1 },
      'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 2 }
    }
  );
  const normalized = normalizeMechanismConnectionSelections(changedDrive, changedDrive.connectionSelections);
  assert(!normalized.connectionSelections?.['gear_linkage.drive-pin'], 'old drive gearKey selection is dropped after endpoint gear geometry changes');
  assert.deepEqual(normalized.connectionSelections?.['gear_linkage.output-pin'], changedDrive.connectionSelections?.['gear_linkage.output-pin'], 'valid output-pin selection survives an unrelated drive gear change');
  assert.equal(normalized.connectionSelectionValidation?.status, 'invalid', 'stale drive selection leaves fresh invalid evidence');
  assert(normalized.connectionSelectionValidation?.entries.some(entry => entry.role === 'gear_linkage.drive-pin' && entry.status === 'rejected' && /gearKey/.test(entry.reason ?? '')), 'invalid evidence names the stale drive gearKey');

  const state = calculateLinkage(changedDrive, 0);
  const candidates = mechanismConnectionHoleCandidates(changedDrive, state, changedDrive.connectionSelections);
  assert(candidates.some(candidate => candidate.role === 'gear_linkage.drive-pin' && candidate.partKey === driveSpec.key && candidate.holeIndex !== 1 && !candidate.selected), 'candidate recovery exposes unselected holes from the current drive gear spec');
  assert(candidates.some(candidate => candidate.role === 'gear_linkage.output-pin' && candidate.partKey === selectedGearKey && candidate.holeIndex === 2 && candidate.selected), 'candidate recovery preserves the still-valid output selection');

  const replacement = candidates.find(candidate => candidate.role === 'gear_linkage.drive-pin' && candidate.partKey === driveSpec.key && candidate.holeIndex !== 1)!;
  const repaired = { ...changedDrive, ...normalized, ...authorMechanismConnectionSelection({ ...changedDrive, ...normalized }, 'gear_linkage.drive-pin', replacement.selection) };
  assert.deepEqual(repaired.connectionSelections?.['gear_linkage.drive-pin'], replacement.selection, 'new physical-hole gesture replaces exactly the stale drive role');
  assert.deepEqual(repaired.connectionSelections?.['gear_linkage.output-pin'], normalized.connectionSelections?.['gear_linkage.output-pin'], 'new drive gesture preserves the unrelated output selection');
});

checkConnectionSelectionContract('propagates independent gear_linkage holes and nonzero driver phase through graph, kinematics, fabrication, and export snapshots', () => {
  const gearBase = createDefaultMechanism('gear_linkage', 'connection-coordinate-gear-linkage');
  const gearDriveA = withConnectionSelections(gearBase, {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 1 }
  });
  const gearDriveB = withConnectionSelections(gearBase, {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 2 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 1 }
  });
  const gearOutputB = withConnectionSelections(gearBase, {
    'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
    'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 2 }
  });
  const gearDriveASnapshot = connectionSnapshot(gearDriveA);
  const gearDriveBSnapshot = connectionSnapshot(gearDriveB);
  const gearOutputBSnapshot = connectionSnapshot(gearOutputB);
  assert(gearDriveASnapshot && gearDriveBSnapshot && gearOutputBSnapshot, 'gear_linkage selection snapshots exist');
  [gearDriveA, gearDriveB, gearOutputB].forEach((mechanism, index) => assertFabricationValidConnectionFixture(mechanism, `gear_linkage fabrication-valid selection ${index + 1}`));
  assert.deepEqual(gearDriveA.connectionSelections?.['gear_linkage.output-pin'], gearDriveB.connectionSelections?.['gear_linkage.output-pin'], 'gear_linkage drive variation leaves the authored output-pin selection unchanged');
  assert.deepEqual(gearDriveA.connectionSelections?.['gear_linkage.drive-pin'], gearOutputB.connectionSelections?.['gear_linkage.drive-pin'], 'gear_linkage output variation leaves the authored drive-pin selection unchanged');
  assert.deepEqual(graphNode(gearDriveASnapshot, 'gear-0')?.position, graphNode(gearDriveBSnapshot, 'gear-0')?.position, 'gear_linkage drive variation keeps first gear center fixed');
  assert.deepEqual(graphNode(gearDriveASnapshot, 'gear-1')?.position, graphNode(gearDriveBSnapshot, 'gear-1')?.position, 'gear_linkage drive variation keeps last gear center fixed');
  assert.equal(graphConstraint(gearDriveASnapshot, 'drive-connector-length')?.value, graphConstraint(gearDriveBSnapshot, 'drive-connector-length')?.value, 'gear_linkage drive variation leaves the derived drive connector length unchanged');
  assert.equal(graphConstraint(gearDriveASnapshot, 'output-connector-length')?.value, graphConstraint(gearDriveBSnapshot, 'output-connector-length')?.value, 'gear_linkage drive variation leaves the derived output connector length unchanged');
  assert.notDeepEqual(graphNode(gearDriveASnapshot, 'drive-pin')?.position, graphNode(gearDriveBSnapshot, 'drive-pin')?.position, 'gear_linkage drive-pin hole changes first gear attachment offset');
  assert.deepEqual(graphNode(gearDriveASnapshot, 'output-pin')?.position, graphNode(gearDriveBSnapshot, 'output-pin')?.position, 'gear_linkage drive-pin hole does not mutate output authored pin');
  assert.notDeepEqual(graphNode(gearDriveASnapshot, 'output-pin')?.position, graphNode(gearOutputBSnapshot, 'output-pin')?.position, 'gear_linkage output-pin hole changes last gear attachment offset');

  const phasedGear = withConnectionSelections(
    { ...gearBase, id: 'connection-coordinate-gear-linkage-phase', driverPhaseOffset: 0.37 },
    {
      'gear_linkage.drive-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 0, holeIndex: 0 },
      'gear_linkage.output-pin': { kind: 'gear-attachment-hole', gearKey: selectedGearKey, gearIndex: 1, holeIndex: 2 }
    }
  );
  const phasedSnapshot = connectionSnapshot(phasedGear);
  assert(phasedSnapshot, 'gear_linkage nonzero driver phase snapshot exists');
  assert.notEqual(phasedGear.driverPhaseOffset, 0, 'gear_linkage parity fixture exercises a nonzero driver phase offset');
  assertFabricationValidConnectionFixture(phasedGear, 'gear_linkage nonzero driver phase selection');
  const phasedState = calculateLinkage(phasedGear, 0);
  assertConnectionGraphPoint(phasedSnapshot, 'gear-0', phasedState.p1, 'gear_linkage phased graph drive center matches calculateLinkage');
  assertConnectionGraphPoint(phasedSnapshot, 'gear-1', phasedState.p2, 'gear_linkage phased graph output center matches calculateLinkage');
  assertConnectionGraphPoint(phasedSnapshot, 'drive-pin', phasedState.j1, 'gear_linkage phased graph drive pin matches calculateLinkage');
  assertConnectionGraphPoint(phasedSnapshot, 'output-pin', phasedState.j2, 'gear_linkage phased graph output pin matches calculateLinkage');
  assertConnectionGraphPoint(phasedSnapshot, 'effector', phasedState.effector, 'gear_linkage phased graph connector matches calculateLinkage');
  assertConnectionGraphDistance(phasedSnapshot, 'drive-crank-offset', 'gear_linkage phased drive crank offset');
  assertConnectionGraphDistance(phasedSnapshot, 'output-crank-offset', 'gear_linkage phased output crank offset');
  assertConnectionGraphDistance(phasedSnapshot, 'drive-connector-length', 'gear_linkage phased drive connector');
  assertConnectionGraphDistance(phasedSnapshot, 'output-connector-length', 'gear_linkage phased output connector');
  assert.equal(graphConstraint(phasedSnapshot, 'connector-output')?.value, graphConstraint(phasedSnapshot, 'drive-connector-length')?.value, 'gear_linkage shared connector output retains the derived connector length');
  assert(jsonHasConnectionValidation(gearDriveBSnapshot.fabricationPlan) && jsonHasConnectionValidation(gearDriveBSnapshot.graphCompiler), 'gear_linkage selected hole role is visible in fabrication/export compiler summaries');
  const selectedGearFabrication = compileMechanismGraphFabrication(gearDriveB, sample.settings.physicalKit);
  const denseSelectedGearFabrication = compileMechanismGraphFabrication(gearDriveB, { ...sample.settings.physicalKit, gridPitchMm: 10, boardCells: 30 });
  const selectedGearParts = (recipe = selectedGearFabrication.recipe) => recipe?.requiredParts.filter(part => part.category === 'gear').map(part => part.part).sort() ?? [];
  const selectedAttachmentSpec = FABRICATION_GEAR_SPECS.find(spec => spec.key === selectedGearKey);
  assert(selectedAttachmentSpec, 'selected managed gear specification exists');
  const selectedDriveRadius = Math.hypot(selectedAttachmentSpec.attachmentHoleCentersMm[2].x, selectedAttachmentSpec.attachmentHoleCentersMm[2].y) * SCENE_PX_PER_MM;
  const selectedOutputRadius = Math.hypot(selectedAttachmentSpec.attachmentHoleCentersMm[1].x, selectedAttachmentSpec.attachmentHoleCentersMm[1].y) * SCENE_PX_PER_MM;
  assert.equal(graphNode(gearDriveBSnapshot, 'drive-crank-link')?.fabricated, false, 'drive gear attachment span remains in the graph but is embodied by the gear instead of a duplicate linkage blank');
  assert.equal(graphNode(gearDriveBSnapshot, 'output-crank-link')?.fabricated, false, 'output gear attachment span remains in the graph but is embodied by the gear instead of a duplicate linkage blank');
  assert(Math.abs((graphConstraint(gearDriveBSnapshot, 'drive-crank-offset')?.value ?? Number.NaN) - selectedDriveRadius) <= 1e-9, 'drive attachment constraint carries the selected managed gear-hole radius');
  assert(Math.abs((graphConstraint(gearDriveBSnapshot, 'output-crank-offset')?.value ?? Number.NaN) - selectedOutputRadius) <= 1e-9, 'output attachment constraint carries the selected managed gear-hole radius');
  assert.deepEqual(
    selectedGearFabrication.recipe?.requiredParts.filter(part => part.category === 'linkage').map(part => ({ part: part.part, quantity: part.quantity })),
    [{ part: 'linkages:linkage-4-cell', quantity: 2 }],
    'gear_linkage fabrication emits only the two connector blanks, not duplicate crank blanks for gear-internal attachment spans'
  );
  assert.deepEqual(
    selectedGearFabrication.renderPlan.layers.filter(layer => layer.renderKind === 'linkage').map(layer => layer.label),
    ['Drive connector 5-hole link', 'Output connector 5-hole link'],
    'Foundry, Design, Blueprint, and Assembly share the connector-only gear_linkage fabrication layers'
  );
  const selectedGearState = calculateLinkage(gearDriveB, 0);
  const selectedGearPinStacks = foundryPinStackPoints(
    selectedGearFabrication.renderPlan,
    { state: selectedGearState, gearCenters: gearTrainCenters(gearDriveB) }
  );
  const movingLabelsAt = (rootNodeId: string) => selectedGearPinStacks
    .find(pin => pin.rootNodeId === rootNodeId)?.movingLayerIndexes
    .map(index => selectedGearFabrication.renderPlan.layers[index]?.label) ?? [];
  assert.deepEqual(movingLabelsAt('drive-pin'), ['Drive G3 / 3-space gear', 'Drive connector 5-hole link'], 'typed drive-pin path joins the selected drive gear hole directly to the drive connector blank');
  assert.deepEqual(movingLabelsAt('output-pin'), ['Output G3 / 3-space gear', 'Output connector 5-hole link'], 'typed output-pin path joins the selected output gear hole directly to the output connector blank without a duplicate layer');
  assert.deepEqual(movingLabelsAt('effector'), ['Drive connector 5-hole link', 'Output connector 5-hole link'], 'typed effector path joins exactly the two connector blanks');
  const pathKindsAt = (rootNodeId: string) => selectedGearPinStacks
    .find(pin => pin.rootNodeId === rootNodeId)?.layerIndexes
    .map(index => selectedGearFabrication.renderPlan.layers[index]?.renderKind) ?? [];
  assert.deepEqual(pathKindsAt('drive-pin'), ['gear', 'spacer', 'linkage', 'clip'], 'drive gear/link path includes its exact physical S10 and front retainer sequence');
  assert.deepEqual(pathKindsAt('effector'), ['clip', 'linkage', 'spacer', 'linkage', 'clip'], 'free connector path includes both retainers and its exact physical S10');
  assert.deepEqual(pathKindsAt('output-pin'), ['gear', 'spacer', 'spacer', 'spacer', 'spacer', 'clip', 'linkage', 'clip'], 'output gear/link path fills the fixed-depth interval with compiled spacers and retainers instead of an air gap');
  assert(!/crank|attachment span/i.test(selectedGearFabrication.renderPlan.stackSummary), 'gear_linkage fabrication stack excludes non-fabricated attachment spans');
  assert(selectedGearParts().includes(`gears:${selectedGearKey}`), 'gear_linkage requiredParts keeps the selected endpoint gear identity while its attachment hole changes');
  assert.deepEqual(selectedGearParts(denseSelectedGearFabrication.recipe), selectedGearParts(), 'active board pitch does not silently rescale selected managed gear vectors');
});

const inconsistentDistanceGraph = mechanismGraphFromDraft({
  id: 'connection-inconsistent-distance',
  familyId: 'connection-distance-validation',
  nodes: [
    { id: 'board-a', label: 'Board pivot A', role: 'board-anchor', position: { x: 0, y: 0 } },
    { id: 'output', label: 'Output point', role: 'output-point', position: { x: 80, y: 0 } },
    { id: 'link-a', label: 'Physical 80-unit link', role: 'link', position: { x: 40, y: 0 }, value: 80 }
  ],
  constraints: [
    { id: 'board-a-fixed', label: 'Pivot A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
    { id: 'board-a-snap', label: 'Pivot A fits a hole', role: 'board-snap', nodes: ['board-a'] },
    { id: 'inconsistent-distance', label: 'Inconsistent authored link length', role: 'distance', nodes: ['board-a', 'output'], value: 40, fabricatedPartNodeId: 'link-a' }
  ]
});

checkConnectionSelectionContract('rejects inconsistent graph distance constraints during graph validation', () => {
  const validation = validateMechanismGraph(inconsistentDistanceGraph);
  assert.equal(validation.valid, false, 'graph validation rejects a distance target that disagrees with positioned endpoints');
  assert(validation.diagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.message.includes('inconsistent-distance') && /distance|constraint/i.test(diagnostic.message)), 'graph validation identifies the inconsistent distance constraint explicitly');
});

checkConnectionSelectionContract('blocks inconsistent graph distance constraints before fabrication', () => {
  const compilation = compileAuthoredMechanismGraph(inconsistentDistanceGraph, sample.settings.physicalKit);
  assert.equal(compilation.fabrication.buildable, false, 'fabrication compiler refuses an inconsistent graph distance constraint');
  assert.equal(compilation.fabrication.recipe, undefined, 'inconsistent graph distance does not emit a fabrication recipe');
  assert(compilation.blockers.some(blocker => blocker.includes('inconsistent-distance') && /distance|constraint/i.test(blocker)), 'fabrication blocker preserves the inconsistent distance diagnostic');
  assert(compilation.fabrication.renderPlan.validationErrors.some(error => error.includes('inconsistent-distance') && /distance|constraint/i.test(error)), 'render plan carries the inconsistent distance blocker instead of fabrication layers');
});

checkConnectionSelectionContract('reports shared family connection policy separately from scalar edit policy', () => {
  const policyByType = Object.fromEntries(ALL_MECHANISM_TYPES.map(type => [type, (mechanismFeature(type).interactionPolicy(createDefaultMechanism(type)) as unknown as { connectionPolicy?: unknown }).connectionPolicy]));
  assert.deepEqual(
    policyByType['4bar'],
    { authored: { '4bar.input-joint': 'linkage-hole', '4bar.output-joint': 'linkage-hole' }, fixed: ['4bar.input-ground', '4bar.output-ground'], derived: ['4bar.coupler', '4bar.effector', '4bar.aux'], blocked: [] },
    '4bar exposes only linkage-hole authored roles and keeps grounds/coupler derived or fixed'
  );
  assert.deepEqual(
    policyByType.gear_linkage,
    {
      authored: {
        'gear_linkage.drive-pin': 'gear-attachment-hole',
        'gear_linkage.output-pin': 'gear-attachment-hole'
      },
      fixed: ['gear_linkage.drive-center', 'gear_linkage.output-center'],
      derived: ['gear_linkage.connector-link', 'gear_linkage.aux'],
      blocked: []
    },
    'gear_linkage exposes only gear attachment authored roles and keeps centers/connector derived or fixed'
  );
  assert.deepEqual(
    policyByType.gear,
    {
      authored: {
        'gear.drive-pin': 'gear-attachment-hole',
        'gear.output-pin': 'gear-attachment-hole'
      },
      fixed: ['gear.drive-axle', 'gear.output-axle'],
      derived: ['gear.mesh', 'gear.phase', 'gear.output'],
      blocked: []
    },
    'gear exposes physical attachment selections alongside fixed axle and derived mesh/output roles'
  );
  assert.deepEqual(
    policyByType.planetary_gear,
    {
      authored: {
        'planetary_gear.carrier-planet-pivot': 'linkage-hole',
        'planetary_gear.carrier-output-hole': 'linkage-hole'
      },
      fixed: ['planetary_gear.sun-axle', 'planetary_gear.ring-gear'],
      derived: ['planetary_gear.planet-gear', 'planetary_gear.carrier', 'planetary_gear.output'],
      blocked: []
    },
    'planetary_gear exposes carrier hole selections alongside fixed ring/sun and derived carrier/planet roles'
  );
  assert.deepEqual(
    policyByType.cam,
    {
      authored: {
        'cam.guide-mount': 'board-mount-pattern',
        'cam.follower-output-hole': 'module-hole'
      },
      fixed: ['cam.cam-axle', 'cam.follower-guide'],
      derived: ['cam.cam-profile-contact', 'cam.follower', 'cam.effector'],
      blocked: []
    },
    'cam exposes guide and follower physical selections alongside fixed axle/guide and derived follower roles'
  );
  assert.deepEqual(
    policyByType.piston,
    {
      authored: {
        'piston.crank-pin': 'linkage-hole',
        'piston.rod-slider-pin': 'linkage-hole',
        'piston.guide-mount': 'board-mount-pattern'
      },
      fixed: ['piston.crank-ground', 'piston.slider-guide'],
      derived: ['piston.crank', 'piston.connecting-rod', 'piston.slider', 'piston.effector'],
      blocked: []
    },
    'piston exposes crank, rod, and guide physical selections alongside derived slider-crank roles'
  );
  for (const type of ['gear', 'planetary_gear', 'cam', 'piston'] as const) {
    const policy = policyByType[type] as { authored: Record<string, unknown>; fixed: string[]; derived: string[]; blocked: string[] };
    const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `connection-fixed-derived-${type}`)));
    const fakeAuthored = normalizeMechanismConnectionSelections(mechanism, {
      '4bar.input-joint': { kind: 'linkage-hole', linkageKey: selectedLinkageKey, holeIndex: 1 }
    });
    assert(Object.keys(policy.authored).length > 0, `${type} declares concrete physical connection roles`);
    assert(policy.fixed.length > 0 && policy.derived.length > 0, `${type} exposes concrete fixed and derived connection roles`);
    assert.deepEqual(policy.blocked, [], `${type} remains supported rather than using a non-authorable blocker`);
    assert.equal(fakeAuthored.connectionSelections?.['4bar.input-joint'], undefined, `${type} rejects foreign authored hole state instead of remapping it`);
    assert(fakeAuthored.connectionSelectionValidation?.entries.some(entry => entry.status === 'rejected'), `${type} preserves rejection evidence for foreign authored hole state`);
    assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], `${type} fixed/derived connection contract remains preview-ready`);
    assert.equal(compileMechanismGraphFabrication(mechanism, sample.settings.physicalKit).buildable, true, `${type} fixed/derived connection contract remains fabrication-ready`);
  }
  assert.deepEqual(
    policyByType.crank,
    {
      authored: {},
      fixed: ['crank.ground'],
      derived: ['crank.link', 'crank.effector'],
      blocked: []
    },
    'crank stays supported with explicit fixed/derived roles and no authored selection'
  );
  assert(!JSON.stringify(policyByType).match(/shared-family-(?:fixed|derived)|supported-driver-(?:fixed|derived)/), 'connection policies never use sentinel fixed/derived role strings');
  for (const type of ['yoke', 'quick-return', '5bar', '6bar', 'rack-pinion'] as const) assert.deepEqual(policyByType[type], { authored: {}, fixed: [], derived: [], blocked: ['non-authorable'] }, `${type} stays blocked and non-authorable`);
});

if (connectionSelectionContractFailures.length) {
  throw new AggregateError(connectionSelectionContractFailures.map(message => new Error(message)), `editable mechanism connection contract regressions (${connectionSelectionContractFailures.length})`);
}
const sampleMechanismId = sample.mechanisms[0].id;
const snapshotBeforeProject = serializeProject(sample);
const snapshotA = buildMechanismSnapshot(sample, sampleMechanismId);
const snapshotB = buildMechanismSnapshot(sample, sampleMechanismId);
assert(snapshotA && snapshotB, 'mechanism snapshot builder returns a snapshot for an existing mechanism id');
assert.deepEqual(snapshotA, snapshotB, 'mechanism snapshot builder is deterministic for the same project and mechanism');
assert.equal(serializeProject(sample), snapshotBeforeProject, 'mechanism snapshot builder does not mutate ProjectState');
const compilerOutputBeforeProject = serializeProject(sample);
const compiledOutput = compileMechanism(sample.mechanisms[0]);
assert.equal(compiledOutput.graph.persisted, false, 'mechanism compiler output declares that it is derived rather than persisted');
assert.equal(serializeProject(sample), compilerOutputBeforeProject, 'mechanism compiler output compilation does not mutate ProjectState');
assert(!serializeProject(sample).includes('mechanismGraph') && !serializeProject(sample).includes('graphIr'), 'project snapshots do not persist derived mechanism compiler outputs');
const projectImportSource = readFileSync(join(process.cwd(), 'utils', 'project.ts'), 'utf8');
assert(
  /const mechanisms = \(\s*Array\.isArray\(data\.mechanisms\)\s*\? data\.mechanisms\s*: fallback\.mechanisms\s*\)\.map/.test(projectImportSource)
  && projectImportSource.includes('const selectedMechanismId =')
  && projectImportSource.includes('mechanisms.some((mechanism) => mechanism.id === data.selectedMechanismId)')
  && /foundryExport:\s*undefined/.test(projectImportSource)
  && /lastFoundryExport:\s*undefined/.test(projectImportSource)
  && !projectImportSource.includes('...snapshotData'),
  'project import whitelists ProjectState fields and drops derived packages instead of spreading compiler output into snapshots'
);
assert(Object.isFrozen(snapshotA) && Object.isFrozen(snapshotA.fabricationPlan.layers), 'mechanism snapshot is recursively frozen for adapter safety');
assert.equal(snapshotA.sourceIds.mechanismId, sampleMechanismId, 'mechanism snapshot records mechanism source id');
assert(snapshotA.feasibleRange.percentValid >= 0 && snapshotA.feasibleRange.percentValid <= 1, 'mechanism snapshot includes feasible range');
assert(snapshotA.interactionPolicy.writesProjectState, 'mechanism snapshot includes interaction policy');
assert(snapshotA.projectionHints.every(hint => hint.zStackUsesFabricationPlan), 'mechanism snapshot includes fabrication-backed projection hints');
assert(snapshotA.physicsHints.every(hint => hint.preservesProjectState), 'mechanism snapshot includes derived physics hints');
assert(Array.isArray(snapshotA.fabricationPlan.validationErrors), 'mechanism snapshot includes fabrication plan validation result');
assert.equal(snapshotA.graph.source, 'family-definition', 'mechanism snapshot carries the full derived compiler output at the adapter boundary');
assert.equal(snapshotA.graph.persisted, false, 'mechanism snapshot graph remains a non-persisted compiler output');
assert.equal(snapshotA.graphCompiler.graphId, snapshotA.graph.id, 'mechanism snapshot graph summary points at the attached graph');
assert.equal(snapshotA.graphCompiler.nodeCount, snapshotA.graph.nodes.length, 'mechanism snapshot graph summary records node count for downstream tabs');
const snapshotGraphFingerprintInput = {
  sourceIds: snapshotA.sourceIds,
  mechanism: snapshotA.mechanism,
  physicalKit: snapshotA.physicalKit,
  targetPath: snapshotA.targetPath,
  graph: snapshotA.graph,
  graphCompiler: snapshotA.graphCompiler
};
assert.equal(mechanismSnapshotFingerprint(snapshotGraphFingerprintInput), snapshotA.fingerprint, 'mechanism snapshot fingerprint includes derived graph content');
const graphContentDriftFingerprint = mechanismSnapshotFingerprint({
  ...snapshotGraphFingerprintInput,
  graph: {
    ...snapshotA.graph,
    constraints: snapshotA.graph.constraints.map((constraint, index) => index === 0 ? { ...constraint, label: `${constraint.label} drift` } : constraint)
  }
});
assert.notEqual(graphContentDriftFingerprint, snapshotA.fingerprint, 'mechanism snapshot fingerprint changes when graph content drifts without changing graph counts');
const snapshotOffPresetLinkNoop = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, crankLength: mechanism.crankLength + 1 } : mechanism)
}, sampleMechanismId);
assert(snapshotOffPresetLinkNoop && snapshotOffPresetLinkNoop.fingerprint === snapshotA.fingerprint, 'snapshot fingerprint ignores off-preset linkage nudges that snap back to the same fabricated linkage');
const snapshotParamChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, groundLength: mechanism.groundLength + 20 * SCENE_PX_PER_MM } : mechanism)
}, sampleMechanismId);
assert(snapshotParamChanged && snapshotParamChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when a board-span parameter moves by a full 20mm hole pitch');
const snapshotOutputGearChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, showOutputGear: !(mechanism.showOutputGear ?? false) } : mechanism)
}, sampleMechanismId);
assert(snapshotOutputGearChanged && snapshotOutputGearChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when showOutputGear changes');
const snapshotOutputGearRadiusChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, outputGearRadius: (mechanism.outputGearRadius ?? 42) + 1 } : mechanism)
}, sampleMechanismId);
assert(snapshotOutputGearRadiusChanged && snapshotOutputGearRadiusChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when outputGearRadius changes');
const snapshotTargetChanged = buildMechanismSnapshot({
  ...sample,
  mechanisms: sample.mechanisms.map(mechanism => mechanism.id === sampleMechanismId ? { ...mechanism, targetAnchorJointId: 'right_elbow' } : mechanism)
}, sampleMechanismId);
assert(snapshotTargetChanged && snapshotTargetChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when target ids change');
const snapshotObjectProjectBase = applyProjectAction(sample, {
  type: 'upsert_scene_object',
  object: createDefaultSceneObject('piggy-bank', 'snapshot-object')
});
const snapshotObjectProjectWithPath = applyProjectAction(snapshotObjectProjectBase, {
  type: 'upsert_path',
  path: {
    id: 'path-snapshot-object',
    partId: '',
    sceneObjectId: 'snapshot-object',
    points: [{ x: 40, y: 50 }, { x: 70, y: 75 }, { x: 100, y: 50 }],
    duration: 1000,
    closed: true,
    enabled: true,
    visible: true,
    source: 'drawn',
    warnings: []
  }
});
const snapshotObjectProject = applyProjectAction(snapshotObjectProjectWithPath, {
  type: 'upsert_mechanism',
  mechanism: {
    ...createDefaultMechanism('4bar', 'snapshot-object-mechanism'),
    targetSceneObjectId: 'snapshot-object',
    targetPathId: 'path-snapshot-object',
    anchorX: 0,
    anchorY: 0,
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    sceneAnchor: { x: 0, y: 0 }
  }
});
const objectSnapshot = buildMechanismSnapshot(snapshotObjectProject, 'snapshot-object-mechanism');
assert.equal(objectSnapshot?.sourceIds.targetSceneObjectId, 'snapshot-object', 'snapshot source ids preserve target scene object');
assert.equal(objectSnapshot?.mechanism.targetSceneObjectId, 'snapshot-object', 'snapshot mechanism preserves target scene object');
assert.equal(objectSnapshot?.mechanism.targetPartId, undefined, 'snapshot mechanism does not invent a body-part target for object motion');
assert.equal(objectSnapshot?.targetPath?.sceneObjectId, 'snapshot-object', 'snapshot target path preserves scene object ownership');
if (snapshotA.sourceIds.targetPathId) {
  const pathId = snapshotA.sourceIds.targetPathId;
  const snapshotPathChanged = buildMechanismSnapshot({
    ...sample,
    paths: {
      ...sample.paths,
      [pathId]: {
        ...sample.paths[pathId],
        points: sample.paths[pathId].points.map((point, index) => index === 0 ? { ...point, x: point.x + 1 } : point)
      }
    }
  }, sampleMechanismId);
  assert(snapshotPathChanged && snapshotPathChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when the relevant target path changes');
}
const snapshotKitChanged = buildMechanismSnapshot({
  ...sample,
  settings: {
    ...sample.settings,
    physicalKit: { ...sample.settings.physicalKit, gridPitchMm: sample.settings.physicalKit.gridPitchMm + 1 }
  }
}, sampleMechanismId);
assert(snapshotKitChanged && snapshotKitChanged.fingerprint !== snapshotA.fingerprint, 'snapshot fingerprint changes when physical kit changes');
const allMechanismSnapshotProject: ProjectState = {
  ...sample,
  mechanisms: ALL_MECHANISM_TYPES.map(type => ({
    ...createDefaultMechanism(type, `${type}-snapshot`),
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_hand_part']
  }))
};
const allMechanismSnapshots = buildMechanismSnapshots(allMechanismSnapshotProject);
assert.equal(allMechanismSnapshots.length, ALL_MECHANISM_TYPES.length, 'snapshot builder covers every mechanism type');
allMechanismSnapshots.forEach(snapshot => {
  assert.equal(snapshot.version, 2, `${snapshot.mechanism.type} snapshot carries schema version`);
  assert(snapshot.fingerprint.startsWith('ms-'), `${snapshot.mechanism.type} snapshot carries a stable fingerprint`);
  assert(Array.isArray(snapshot.fabricationPlan.validationErrors), `${snapshot.mechanism.type} snapshot carries fabrication validation results`);
  assert.equal(snapshot.graph.mechanismType, snapshot.mechanism.type, `${snapshot.mechanism.type} snapshot graph preserves the mechanism type`);
  assert.equal(snapshot.graphCompiler.persisted, false, `${snapshot.mechanism.type} snapshot graph summary stays non-persisted`);
  assert(snapshot.projectionHints.length > 0 && snapshot.physicsHints.length > 0, `${snapshot.mechanism.type} snapshot carries adapter hints`);
});
const goldenSample = createSampleProject({ includeMechanism: true });
const goldenLesson = createLessonProject('waving-arm');
const goldenLessonMechanism = goldenLesson.mechanisms[0];
assert(goldenLessonMechanism, 'golden lesson has a fitted mechanism');
assert.equal(assessMechanismTargetBinding(goldenLesson, goldenLessonMechanism).valid, true, 'guided lesson persists a fully valid target/path/anchor binding');
assert.deepEqual(goldenLessonMechanism.activeVisualPartIds, ['right_hand_part'], 'guided lesson preserves its authoritative body target');
assert.deepEqual(Object.keys(goldenLessonMechanism.connectionSelections ?? {}).sort(), ['4bar.input-joint', '4bar.output-joint'], 'guided lesson Fit persists the existing structural connection authority result');
assert.equal(goldenLessonMechanism.connectionSelectionValidation?.status, 'valid', 'guided lesson Fit persists validated structural connections');
assert.equal(resolveMechanismRuntimeGate(goldenLesson, goldenLessonMechanism).canDriveProject, true, 'guided lesson enters runtime only through the full binding gate');
const goldenSnapshot = buildMechanismSnapshot(goldenSample, goldenSample.mechanisms[0].id);
assert(goldenSnapshot, 'golden master sample has a mechanism snapshot');
const goldenAllMechanismSnapshots = buildMechanismSnapshots({
  ...goldenSample,
  mechanisms: ALL_MECHANISM_TYPES.map(type => ({
    ...createDefaultMechanism(type, `${type}-snapshot`),
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_hand_part']
  }))
});
const goldenExportConfig = {
  speed: goldenSample.settings.animationSpeed,
  rotation: 0,
  mechanisms: goldenSample.mechanisms
};
const goldenMaster = {
  // Parse serialized state before six-decimal hashing so libm noise does not
  // make the behavioral golden architecture-dependent.
  project: JSON.parse(serializeProject(stableProjectForGoldenMaster(goldenSample))),
  lesson: JSON.parse(serializeProject(stableProjectForGoldenMaster(goldenLesson))),
  mechanismSnapshot: stableMechanismSnapshotForGoldenMaster(goldenSnapshot),
  allMechanismSnapshots: goldenAllMechanismSnapshots.map(stableMechanismSnapshotForGoldenMaster),
  sceneProjection: buildToonSceneProjection(goldenSample),
  svg: generateLowLevelMechanismSVG(goldenExportConfig, Math.PI / 4),
  dxf: generateLowLevelMechanismDXF(goldenExportConfig, Math.PI / 4),
  fabricationRecipes: createFabricationPackage(goldenSample).recipes,
  compilerRenderPlans: ALL_MECHANISM_TYPES.map(type => compileMechanismRenderPlan(createDefaultMechanism(type, `${type}-golden`))),
  stacks: goldenSample.mechanisms.map(fabricationStackForMechanism)
};
assert.deepEqual(
  Object.fromEntries(Object.entries(goldenMaster).map(([key, value]) => [key, goldenMasterHash(value)])),
  {
    // Intentional G004 lesson delta: guided Fit now passes through the existing
    // structural commit authority and the full target/path/anchor gate.
    project: '48fb3aba7bfbb621d5706e7819028e96dae54a092415a7873396d6351b8d4c3c',
    lesson: 'aff59033bcdf17dac207a568a090bca8b0767d2233b5198ee92e2d8df3494b36',
    mechanismSnapshot: '11eb2e87e4a3f0edb99fa3da620d144555bec5120cdca867cb4bba655702058a',
    allMechanismSnapshots: '2fb8cc33f8371ed0296cd5a925cc0cade7d8b0fbd3d0d384ba4f0fabb1cdb949',
    // Intentional G005 delta: scene projection now serializes canonical
    // compiler layers instead of a mechanism-only base/output sketch.
    sceneProjection: '135bc25ca6deb93769b961a955bd2ac3e4c40e1ead7414472646399f6de0033d',
    svg: '6c0dc36c96c38625a8f94a4cf1c34a5d87170c363cb25a97ff087dcdfc4dd6b8',
    dxf: 'a75df4eb0a0cd5c680c6460bc807c0f0848503dfebca650d855ea065abf660da',
    fabricationRecipes: 'c21606111e3f2920f1f0ad93b11a516d93f73f487c3cb1aed6833163ccb98098',
    compilerRenderPlans: 'cad9cc7bc21ca8c46fd4d5ae7f2fa4519fb0a4a698fc745cf1366fd5dffeaf10',
    stacks: '3f89b15bcbce11efa9bd2e81e7d83803d9bc5ea953bc030d10a14babe11b374e'
  },
  'golden master locks ProjectState, mechanism snapshot, scene projection, export, and fabrication stack behavior before App.tsx refactors'
);
assert.deepEqual(compileFabricationRecipe(goldenSample, goldenSample.mechanisms[0]), createFabricationPackage(goldenSample).recipes[0], 'fabrication package output stays behind the graph compiler recipe facade');
previewReadyTypes.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `recipe-shape-${type}`)));
  const project = { ...sample, mechanisms: [mechanism], selectedMechanismId: mechanism.id };
  const recipe = compileFabricationRecipe(project, mechanism);
  assert.equal(recipe.compilerSource, 'mechanismCompiler', `${type} compiler recipe facade marks the compiler source`);
  assert.equal(recipe.type, 'graph', `${type} compiler recipe facade emits graph-owned recipes`);
  assert(recipe.requiredParts.length > 0, `${type} recipe emits required fabrication parts`);
  recipe.assemblySteps.forEach(step => {
    assert(step.label && step.instruction, `${type} recipe step ${step.index} has compact visible copy`);
    assert.equal((step.coords ?? []).length, (step.coordRoles ?? []).length, `${type} recipe step ${step.index} keeps coords and coordRoles aligned`);
    assert(step.boardCoordinate, `${type} recipe step ${step.index} has a board coordinate fallback`);
    assert.deepEqual((step.stack ?? []).map(item => item.order), (step.stack ?? []).map((_, index) => index + 1), `${type} recipe step ${step.index} stack order is contiguous`);
  });
});
{
  const idlerGearMechanism = mechanismWithGeneratedPath(normalizeGearTrainToFabrication({
    ...createDefaultMechanism('gear', 'recipe-idler-board-steps'),
    gearTrainRadii: [60, 20, 60],
  }));
  const recipe = compileFabricationRecipe({ ...sample, mechanisms: [idlerGearMechanism], selectedMechanismId: idlerGearMechanism.id }, idlerGearMechanism);
  const idlerPinStep = recipe.assemblySteps.find(step => /^Pin Idler gear/.test(step.label));
  const idlerBuildStep = recipe.assemblySteps.find(step => /^Add Idler gear/.test(step.label));
  assert(idlerPinStep && (idlerPinStep.coordRoles ?? []).some(isBoardFixedCoordRole), 'graph compiler emits a board-fixed pin step for inserted idler gears');
  assert(idlerBuildStep && (idlerBuildStep.stack ?? []).some(item => item.label.includes('Idler G1 / 1-space gear')), 'graph compiler emits the physical idler gear part in Blueprint/Assembly stack order');
  assert(idlerBuildStep?.coords?.every(coord => isBoardCoordinateInKit(coord, sample.settings.physicalKit)), 'inserted idler gear assembly coordinates stay snapped to the active board');
}
{
  const mechanism = mechanismWithGeneratedPath(normalizeGearLinkageToReference({
    ...createDefaultMechanism('gear_linkage', 'stage-parity-live-recipe'),
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_hand_part']
  }));
  const project = { ...sample, selectedMechanismId: mechanism.id, mechanisms: [mechanism] };
  const directRecipe = compileFabricationRecipe(project, mechanism);
  const pendingRecipe = pendingRecipeForMechanism(project, mechanism);
  const assemblyModel = buildAssemblyGuideModel({ project, selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
  const pkg = createFabricationPackage(project);
  assert.deepEqual(pendingRecipe.assemblySteps, directRecipe.assemblySteps, 'Assembly pending recipe uses the fabrication recipe compiler');
  assert.deepEqual(assemblyModel.selectedRecipe?.assemblySteps, directRecipe.assemblySteps, 'Assembly model uses the same live recipe as export');
  assert.deepEqual(selectBlueprintRecipe(pkg.recipes, null, mechanism.id)?.assemblySteps, directRecipe.assemblySteps, 'Blueprint selected recipe uses the same live fabrication recipe');
}
const gearMetadataMechanism = {
  ...createDefaultMechanism('gear', 'snapshot-gear-metadata'),
  crankLength: 50,
  rockerLength: 30,
  gearTrainRadii: [50, 20, 35, 30],
  driverGroupId: 'main-drive',
  driverPhaseOffset: 0.45
};
gearMetadataMechanism.groundLength = gearTrainPitchCenterDistance(gearMetadataMechanism);
gearMetadataMechanism.gearRatio = gearTrainOutputRatio(gearMetadataMechanism);
const sanitizedGearMetadata = sanitizeMechanismRuntime(gearMetadataMechanism);
const snappedGearMetadata = normalizeGearTrainToFabrication(gearMetadataMechanism);
assert.deepEqual(sanitizedGearMetadata.gearTrainRadii, snappedGearMetadata.gearTrainRadii, 'sanitize preserves ordered gear train slots while snapping each radius to the fabrication gear set');
assert.equal(sanitizedGearMetadata.groundLength, gearTrainPitchCenterDistance(sanitizedGearMetadata), 'sanitize derives gear train span from snapped fabrication gears');
assert.equal(sanitizedGearMetadata.driverGroupId, 'main-drive', 'sanitize preserves driver group id');
assert.equal(sanitizedGearMetadata.driverPhaseOffset, 0.45, 'sanitize preserves CDMC-style driver phase offset');
const gearMetadataSnapshot = buildMechanismSnapshot({
  ...sample,
  mechanisms: [gearMetadataMechanism]
}, gearMetadataMechanism.id);
assert.deepEqual(gearMetadataSnapshot?.mechanism.gearTrainRadii, snappedGearMetadata.gearTrainRadii, 'snapshot stores only fabrication-set gear radii for multi-idler gear trains');
assert.equal(gearMetadataSnapshot?.mechanism.groundLength, gearTrainPitchCenterDistance(snappedGearMetadata), 'snapshot stores the derived pitch span from snapped gear radii');
assert.equal(gearMetadataSnapshot?.mechanism.driverGroupId, 'main-drive', 'snapshot preserves driver grouping metadata');
assert.equal(gearMetadataSnapshot?.mechanism.driverPhaseOffset, 0.45, 'snapshot preserves driver phase metadata');
assert.equal(buildMechanismSnapshot(sample, 'missing-mechanism'), null, 'missing mechanism snapshot returns null instead of fabricating data');
const offSetFourBar = normalizeMechanismToFabricationSet({
  ...createDefaultMechanism('4bar', 'off-set-fourbar'),
  crankLength: 53,
  couplerLength: 119,
  rockerLength: 177,
  groundLength: 123
});
assert(linkageSceneLengthIsFabricationPreset(offSetFourBar.crankLength), 'four-bar input link snaps to one of the four fabricated linkage sizes');
assert(linkageSceneLengthIsFabricationPreset(offSetFourBar.couplerLength), 'four-bar coupler snaps to one of the four fabricated linkage sizes');
assert(linkageSceneLengthIsFabricationPreset(offSetFourBar.rockerLength), 'four-bar output link snaps to one of the four fabricated linkage sizes');
assert.equal(offSetFourBar.groundLength, 120, 'four-bar ground span snaps to a board-hole pitch distance instead of preserving arbitrary path-fit offsets');
const fabricationSetCam = normalizeMechanismToFabricationSet({
  ...createDefaultMechanism('cam', 'fabrication-set-cam'),
  crankLength: 99,
  rockerLength: 222,
  sliderOffset: 44,
  groundAngle: -15,
  couplerLength: 77
});
assert.equal(fabricationSetCam.groundAngle, 90, 'cam fabrication set keeps the vertical guide contract');
assert.equal(fabricationSetCam.groundLength, 0, 'cam fabrication set keeps the pegboard module ground span fixed');
assert.equal(fabricationSetCam.crankLength, REFERENCE_DEFAULTS.cam.radius, 'cam fabrication set restores the swappable cam disk reference radius');
assert.equal(fabricationSetCam.sliderOffset, REFERENCE_DEFAULTS.cam.followerRadius, 'cam fabrication set restores the follower head radius');
assert.equal(fabricationSetCam.rockerLength, REFERENCE_DEFAULTS.cam.followerTravel, 'cam fabrication set restores the guide travel');
assert.equal(fabricationSetCam.couplerLength, 0, 'cam fabrication set drops stale linkage coupler dimensions');
const fabricationSetPiston = normalizeMechanismToFabricationSet({
  ...createDefaultMechanism('piston', 'fabrication-set-piston'),
  crankLength: 99,
  couplerLength: 47,
  rodLength: 61,
  rockerLength: 30,
  sliderOffset: 22,
  groundAngle: 40
});
assert.equal(fabricationSetPiston.groundAngle, 0, 'piston fabrication set keeps the horizontal guide contract');
assert.equal(fabricationSetPiston.groundLength, 0, 'piston fabrication set keeps the slider module ground span fixed');
assert.equal(fabricationSetPiston.crankLength, REFERENCE_DEFAULTS.sliderCrank.crank, 'piston fabrication set restores the crank radius');
assert.equal(fabricationSetPiston.couplerLength, REFERENCE_DEFAULTS.sliderCrank.rod, 'piston fabrication set restores the connecting rod');
assert.equal(fabricationSetPiston.rodLength, REFERENCE_DEFAULTS.sliderCrank.rod, 'piston fabrication set keeps rodLength and couplerLength aligned');
assert.equal(fabricationSetPiston.rockerLength, 0, 'piston fabrication set removes stale rocker dimensions');
assert.equal(fabricationSetPiston.sliderOffset, REFERENCE_DEFAULTS.sliderCrank.guideOffset, 'piston fabrication set restores the guide offset');
const loadedSetOnlyGear = loadProjectSnapshot({
  ...createEmptyProject(),
  mechanisms: [{
    ...createDefaultMechanism('gear', 'loaded-gear-set-only'),
    crankLength: 52,
    rockerLength: 91,
    gearTrainRadii: [52, 23, 91],
    groundLength: 777
  }]
}).mechanisms[0];
assert.deepEqual(loadedSetOnlyGear.gearTrainRadii, [52, 23, 91], 'loaded gear snapshots preserve finite unsafe gear radii for explicit recovery');
assert.equal(loadedSetOnlyGear.groundLength, 777, 'loaded gear snapshots preserve finite unsafe center span for explicit recovery');
assert.equal(mechanismEditIsSafe(loadedSetOnlyGear, createEmptyProject().settings.physicalKit), false, 'loaded finite unsafe gear geometry remains recovery-blocked');
const loadedSetOnlyFourBar = loadProjectSnapshot({
  ...createEmptyProject(),
  mechanisms: [{
    ...createDefaultMechanism('4bar', 'loaded-fourbar-set-only'),
    crankLength: 53,
    couplerLength: 119,
    rockerLength: 177
  }]
}).mechanisms[0];
assert.equal(loadedSetOnlyFourBar.crankLength, 53, 'loaded four-bar snapshots preserve finite unsafe input length for explicit recovery');
assert.equal(loadedSetOnlyFourBar.couplerLength, 119, 'loaded four-bar snapshots preserve finite unsafe coupler length for explicit recovery');
assert.equal(loadedSetOnlyFourBar.rockerLength, 177, 'loaded four-bar snapshots preserve finite unsafe output length for explicit recovery');
assert.equal(mechanismEditIsSafe(loadedSetOnlyFourBar, createEmptyProject().settings.physicalKit), false, 'loaded finite unsafe four-bar geometry remains recovery-blocked');
type FabricationManifest = {
  board_rows?: number;
  board_columns?: number;
  assembly: {
    board_map: string;
    files?: string[];
    guide_files?: string[];
    recipes_source: string;
    schema_version: string;
    board_map_preview?: string;
  };
  generated_by: string;
  source_ssot: string;
  contour_oracle?: { version: number; base_oracle: string; baseline: string };
  grid_pitch_mm: number;
  hole_diameter_mm: number;
  managed_files: string[];
  complete_cut_sheet: { path: string; part_count: number; included_part_categories: string[]; excluded_part_categories: string[]; unique_part_ids: string[]; part_quantities: Record<string, number> };
  sheets: Array<{ key: string; label: string; path: string; contains: string[] }>;
  parts: {
  gears: Array<{ key: string; label: string; engraving_label: string; teeth: number; pitch_radius_mm: number; root_radius_mm: number; outer_radius_mm: number; hole_diameter_mm: number; path: string; attachment_hole_centers_mm: number[][] }>;
  linkages: Array<{ key: string; label: string; engraving_label: string; path: string; cells: number; length_mm: number; pitch_mm: number; hole_count: number; hole_diameter_mm: number }>;
  ring_gears: Array<{ key: string; label: string; engraving_label: string; path: string; pitch_radius_mm: number; inner_tip_radius_mm: number; inner_root_radius_mm: number; outer_radius_mm: number; mount_radius_mm: number; mount_hole_centers_mm: number[][]; hole_diameter_mm: number; teeth: number; internal_teeth: number }>;
  cams: Array<{ key: string; label: string; engraving_label: string; path: string }>;
  followers: Array<{ key: string; label: string; engraving_label: string; path: string }>;
  brackets: Array<{ key: string; label: string; engraving_label: string; path: string }>;
  handles: Array<{ key: string; label: string; engraving_label: string; path: string }>;
  cam_modules: Array<{ key: string; label: string; engraving_label: string; path: string; module_kind: string; hole_diameter_mm: number; hole_count: number; hole_centers_mm: number[][]; contract: string; hole_ids?: string[]; inventory_version?: number }>;
  spacers: Array<{ key: string; label: string; engraving_label: string; path: string; outer_diameter_mm: number; inner_diameter_mm: number; hole_diameter_mm: number; hole_centers_mm: number[][]; stackable: boolean }>;
  };
};
const fabricationManifest = JSON.parse(readFileSync(join(process.cwd(), 'fabrication', 'manifest.json'), 'utf8')) as FabricationManifest;
const fabricationManifestSnapshot = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'mechanism-reference', 'source', 'fabrication-manifest.snapshot.json'), 'utf8')) as FabricationManifest;
const fabricationGeneratorPath = join(process.cwd(), 'scripts', 'generate-fabrication-assets.ts');
const fabricationPythonOraclePath = join(process.cwd(), 'fabrication', 'fabrication-python-oracle.json');
assert(existsSync(fabricationGeneratorPath), 'fabrication generator lives beside the generated package');
assert(!existsSync(join(process.cwd(), 'fabrication', ['generate','fabrication','templates.py'].join('_'))), 'legacy Python generator has been deleted after oracle capture');
assert(existsSync(fabricationPythonOraclePath), 'frozen Python-derived fabrication oracle is checked in');
const fabricationGeneratorText = readFileSync(fabricationGeneratorPath, 'utf8');
assert(!fabricationGeneratorText.includes('--compare-' + 'python') && !fabricationGeneratorText.includes('py' + 'thon3'), 'fabrication generator is TS-only and has no Python comparison path');
assert(fabricationGeneratorText.includes('const boardAdapter: GeneratorAdapter = {'), 'fabrication generator defines the board adapter');
assert(fabricationGeneratorText.includes("const templateAdapter: GeneratorAdapter = {"), 'fabrication generator defines the template adapter');
assert(fabricationGeneratorText.includes("const rightFiles = new Set<string>(listManagedFiles(readManifest(join(rightRoot, 'manifest.json'))));") && fabricationGeneratorText.includes('const report = compareManagedArtifacts(baseRoot, generatedRoot);'), 'fabrication generator compares actual generated manifest managed-file set as the right-side authority');
assert(
  fabricationGeneratorText.includes("} else if (relPath.endsWith('.svg')) {")
  && fabricationGeneratorText.includes('const semantic = compareSvgContours(leftText, rightText);')
  && fabricationGeneratorText.includes('if (!semantic.equal) mismatched.push(relPath);'),
  'fabrication category summaries compare SVGs by contour before marking mismatched while exact text remains separate'
);
const fabricationTemplateSourcePath = join(process.cwd(), 'scripts', 'fabrication', 'source-template.ts');
assert(existsSync(fabricationTemplateSourcePath), 'fabrication template source locator lives beside the template generator');
const fabricationTemplateSourceText = readFileSync(fabricationTemplateSourcePath, 'utf8');
assert(fabricationTemplateSourceText.includes("FABRICATION_ASSET_GENERATOR_SOURCE = 'scripts/generate-fabrication-assets.ts'"), 'template source manifests report the TypeScript generator as SSOT');
const fabricationRuntimeText = readFileSync(join(process.cwd(), 'utils', 'fabrication.ts'), 'utf8');
const fabricationAssemblyGuideText = readFileSync(join(process.cwd(), 'utils', 'fabricationAssemblyGuide.ts'), 'utf8');
const fabricationBlueprintSvgText = readFileSync(join(process.cwd(), 'utils', 'fabricationBlueprintSvg.ts'), 'utf8');
const fabricationCutSheetPdfText = readFileSync(join(process.cwd(), 'utils', 'fabricationCutSheetPdf.ts'), 'utf8');
const fabricationCustomPartsText = readFileSync(join(process.cwd(), 'utils', 'fabricationCustomParts.ts'), 'utf8');
const fabricationProfilesText = readFileSync(join(process.cwd(), 'utils', 'fabricationProfiles.ts'), 'utf8');
const fabricationRecipesText = readFileSync(join(process.cwd(), 'utils', 'fabricationRecipes.ts'), 'utf8');
const fabricationReadinessText = readFileSync(join(process.cwd(), 'utils', 'fabricationReadiness.ts'), 'utf8');
const fabricationRenderPlanText = readFileSync(join(process.cwd(), 'utils', 'fabricationRenderPlan.ts'), 'utf8');
const fabricationSizingText = readFileSync(join(process.cwd(), 'utils', 'fabricationSizing.ts'), 'utf8');
const fabricationStackModelText = readFileSync(join(process.cwd(), 'utils', 'fabricationStackModel.ts'), 'utf8');
const mechanismFabricationZStackText = readFileSync(join(process.cwd(), 'utils', 'mechanismFabricationZStack.ts'), 'utf8');
const simplePdfSourceText = readFileSync(join(process.cwd(), 'utils', 'simplePdf.ts'), 'utf8');
const fabricationCharacterPrintLayoutText = readFileSync(join(process.cwd(), 'utils', 'fabricationCharacterPrintLayout.ts'), 'utf8');
const fabricationContractText = readFileSync(join(process.cwd(), 'utils', 'fabricationContract.ts'), 'utf8');
const numberFormatText = readFileSync(join(process.cwd(), 'utils', 'numberFormat.ts'), 'utf8');
const staticImportModules = (source: string) => Array.from(new Set([
  ...[...source.matchAll(/^\s*import(?:\s+type)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map(match => match[1]),
  ...[...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
])).sort();
assert(fabricationContractText.includes(FABRICATION_SOURCE_SSOT), 'runtime fabrication contract declares the template generator as source of truth');
assert(fabricationContractText.includes('FABRICATION_GEAR_RADIUS_PER_TOOTH_MM = 1.25'), 'runtime fabrication contract keeps the generator gear radius/tooth rule centralized');
assert(fabricationContractText.includes('FABRICATION_GEAR_ROOT_WEB_MM = 6'), 'runtime fabrication contract mirrors the generator gear root web rule');
assert(fabricationContractText.includes('FABRICATION_LINKAGE_WIDTH_MM = 14'), 'runtime fabrication contract keeps the generator linkage width centralized');
assert(fabricationContractText.includes("key: 's10'"), 'runtime fabrication contract keeps the S10 spacer centralized');
assert(
  readFileSync('docs/mechanism-reference/03-mechanism-unit-specs.md', 'utf-8').includes('fastener-end > S10 board-side spacer > linkage > fastener-head'),
  '4bar mechanism reference documents A/D as board-side spacer plus visible fastener head, not a second top spacer'
);
const mechanismReferenceText = readFileSync('docs/mechanism-reference/03-mechanism-unit-specs.md', 'utf-8');
assert(mechanismReferenceText.includes('external gear train are coplanar on fixed board axles'), 'gear train mechanism reference requires inserted idler gears to share one pitch plane');
assert(mechanismReferenceText.includes('must pass through the gear centre and the adjacent board-side `S10` spacer'), 'gear train mechanism reference requires visible axles to pass through gears and local board-side spacers');
assert(mechanismReferenceText.includes('Pegboard-mounted gravity cam follower module'), 'cam mechanism reference names the pegboard-mounted gravity module contract');
assert(mechanismReferenceText.includes('15×15 pegboard remains the only standardized base'), 'cam mechanism reference keeps the pegboard as the only base');
assert(mechanismReferenceText.includes('integrates guide side rails, front cover, top stop, bottom stop, and peg connector tabs'), 'cam guide cartridge integrates side rails and stops instead of loose rails');
assert(mechanismReferenceText.includes('Preassembled gravity follower module'), 'cam mechanism reference requires a preassembled gravity follower module');
assert(mechanismReferenceText.includes('No rubber bands, springs, metal bearings, plastic spacers'), 'cam mechanism reference excludes non-classroom gravity preload hardware');
assert(fabricationRuntimeText.includes("from './fabricationContract'"), 'fabrication runtime consumes centralized fabricationContract instead of hardcoded primitive tables');
assert(
  fabricationRuntimeText.includes("from './fabricationBlueprintSvg'")
  && fabricationRuntimeText.includes("from './fabricationAssemblyGuide'")
  && fabricationRuntimeText.includes("from './fabricationCutSheetPdf'")
  && fabricationRuntimeText.includes("from './fabricationSizing'")
  && fabricationRuntimeText.includes("from './fabricationProfiles'")
  && fabricationRuntimeText.includes("from './fabricationReadiness'")
  && fabricationRuntimeText.includes("from './fabricationRenderPlan'")
  && fabricationRuntimeText.includes("from './fabricationCustomParts'")
  && fabricationRuntimeText.includes("from './fabricationRecipes'")
  && fabricationRuntimeText.includes("from './fabricationStackModel'")
  && fabricationProfilesText.includes("from './fabricationContract'")
  && fabricationProfilesText.includes("from './numberFormat'"),
  'fabrication runtime consumes extracted profile/stack/render/recipe/custom-parts/assembly-guide/cut-sheet helpers, PDF primitives, and Blueprint SVG renderers from focused seams'
);
[
  './fabrication',
  './sanitize',
  './project',
  './exporter',
  './physicsKernel',
  './mechanismReference',
  './mechanismTemplates',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationProfilesText.includes(`from '${moduleName}'`) && !fabricationProfilesText.includes(`from "${moduleName}"`),
    `fabricationProfiles stays pure and must not import ${moduleName}`
  );
});
[
  'ProjectState',
  'FabricationPackage',
  'createFabricationPackage',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationProfilesText.includes(forbiddenText), `fabricationProfiles stays geometry-only and must not reference ${forbiddenText}`);
});
assert(
  fabricationReadinessText.includes("from './fabricationStackModel'")
  && fabricationReadinessText.includes("from './kinematics'")
  && fabricationReadinessText.includes("from './mechanismReference'")
  && !fabricationReadinessText.includes("from './fabrication'"),
  'fabricationReadiness owns feasible-range and tolerance math without importing the broad fabrication facade'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationReadinessText.includes(`from '${moduleName}'`) && !fabricationReadinessText.includes(`from "${moduleName}"`),
    `fabricationReadiness stays pure and must not import ${moduleName}`
  );
});
[
  'ProjectState',
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'validateFabricationStack',
  'fabricationRenderPlanForMechanism',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationReadinessText.includes(forbiddenText), `fabricationReadiness stays math-only and must not reference ${forbiddenText}`);
});
assert(
  fabricationStackModelText.includes("from './fabricationContract'")
  && fabricationStackModelText.includes("from './mechanismReference'")
  && fabricationStackModelText.includes("from './kinematics'")
  && fabricationStackModelText.includes("from './mechanismFabricationZStack'")
  && !fabricationStackModelText.includes("from './fabrication'"),
  'fabricationStackModel owns structural stack modeling and validation while depending inward on the axial leaf'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationStackModelText.includes(`from '${moduleName}'`) && !fabricationStackModelText.includes(`from "${moduleName}"`),
    `fabricationStackModel stays pure and must not import ${moduleName}`
  );
});
[
  'ProjectState',
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationStackModelText.includes(forbiddenText), `fabricationStackModel stays domain-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationAssemblyGuideText),
  ['../types', './fabricationContract', './fabricationRecipes', './fabricationStackModel', './kinematics', './simplePdf'].sort(),
  'fabricationAssemblyGuide owns assembly guide artifacts with an exact focused import set'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationAssemblyGuideText.includes(`from '${moduleName}'`) && !fabricationAssemblyGuideText.includes(`from "${moduleName}"`),
    `fabricationAssemblyGuide stays artifact-only and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'makeCutSheetPdf',
  'makeCustomPartsSvg',
  'document.',
  'window.open',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationAssemblyGuideText.includes(forbiddenText), `fabricationAssemblyGuide stays assembly-artifact-only and must not reference ${forbiddenText}`);
});
assert(fabricationAssemblyGuideText.includes('window.print()'), 'assembly guide artifact keeps the explicit print button behavior');
assert.deepEqual(staticImportModules(fabricationRenderPlanText), [], 'fabricationRenderPlan compatibility facade has no implementation imports');
assert(
  fabricationRenderPlanText.includes("from './fabricationStackModel'")
  && fabricationRenderPlanText.includes("from './mechanismFabricationZStack'")
  && !/export\s+(?:const|function|class)\b/.test(fabricationRenderPlanText),
  'fabricationRenderPlan delegates and re-exports only, without owning construction or validation'
);
assert(
  !mechanismFabricationZStackText.includes("from './fabricationStackModel'")
  && !mechanismFabricationZStackText.includes("from './fabricationRenderPlan'"),
  'mechanismFabricationZStack remains the dependency-leaf axial contract with no structural-model or compatibility-facade import'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationRenderPlanText.includes(`from '${moduleName}'`) && !fabricationRenderPlanText.includes(`from "${moduleName}"`),
    `fabricationRenderPlan stays pure and must not import ${moduleName}`
  );
});
[
  'ProjectState',
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationRenderPlanText.includes(forbiddenText), `fabricationRenderPlan stays render-plan-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationRecipesText),
  ['../types', './fabricationContract', './mechanismReference'].sort(),
  'fabricationRecipes owns recipe label/display helpers with an exact focused import set; graph compilation owns package recipe derivation'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationRecipesText.includes(`from '${moduleName}'`) && !fabricationRecipesText.includes(`from "${moduleName}"`),
    `fabricationRecipes stays recipe-only and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'makeCutSheetPdf',
  'makeAssemblyGuideHtml',
  'makeCustomPartsSvg',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationRecipesText.includes(forbiddenText), `fabricationRecipes stays recipe-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationSizingText),
  ['../types', './fabricationContract', './fabricationStackModel', './kinematics'].sort(),
  'fabricationSizing owns planetary/linkage sizing with an exact pure import set'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationSizingText.includes(`from '${moduleName}'`) && !fabricationSizingText.includes(`from "${moduleName}"`),
    `fabricationSizing stays pure and must not import ${moduleName}`
  );
});
[
  'ProjectState',
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'validateMechanismPreviewReadiness',
  'fabricationRenderPlanForMechanism',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationSizingText.includes(forbiddenText), `fabricationSizing stays sizing-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationBlueprintSvgText),
  ['../types', './coordinates', './fabricationCharacterPrintLayout', './fabricationContract', './fabricationRecipes', './kinematics', './mechanismSceneContract', './numberFormat', './partGeometry'].sort(),
  'fabricationBlueprintSvg owns deterministic Blueprint SVG rendering with an exact focused import set'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationBlueprintSvgText.includes(`from '${moduleName}'`) && !fabricationBlueprintSvgText.includes(`from "${moduleName}"`),
    `fabricationBlueprintSvg stays renderer-data-only and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'makeCutSheetPdf',
  'makeAssemblyGuideHtml',
  'makeCustomPartsSvg',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationBlueprintSvgText.includes(forbiddenText), `fabricationBlueprintSvg stays SVG-render-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationCutSheetPdfText),
  ['../types', './coordinates', './fabricationContract', './fabricationRecipes', './kinematics', './simplePdf'].sort(),
  'fabricationCutSheetPdf owns cut-sheet PDF artifacts with an exact focused import set'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationCutSheetPdfText.includes(`from '${moduleName}'`) && !fabricationCutSheetPdfText.includes(`from "${moduleName}"`),
    `fabricationCutSheetPdf stays artifact-only and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'createFabricationPackage',
  'validateForFabrication',
  'makeAssemblyGuideHtml',
  'makeCustomPartsSvg',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationCutSheetPdfText.includes(forbiddenText), `fabricationCutSheetPdf stays cut-sheet-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationCustomPartsText),
  ['../types', './coordinates', './fabricationCharacterPrintLayout', './numberFormat', './partGeometry', './simplePdf'].sort(),
  'fabricationCustomParts owns custom character cut-sheet artifacts with an exact focused import set'
);
[
  './fabrication',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationCustomPartsText.includes(`from '${moduleName}'`) && !fabricationCustomPartsText.includes(`from "${moduleName}"`),
    `fabricationCustomParts stays artifact-only and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'FabricationRecipe',
  'MechanismConfig',
  'createFabricationPackage',
  'validateForFabrication',
  'makeAssemblyGuideHtml',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationCustomPartsText.includes(forbiddenText), `fabricationCustomParts stays custom-artifact-only and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(simplePdfSourceText),
  [],
  'simplePdf stays import-free and deterministic'
);
[
  'ProjectState',
  'FabricationPackage',
  'FabricationRecipe',
  'MechanismConfig',
  'createFabricationPackage',
  'validateForFabrication',
  'document.',
  'window.',
  'localStorage',
  'createElement',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(forbiddenText => {
  assert(!simplePdfSourceText.includes(forbiddenText), `simplePdf stays domain-free and must not reference ${forbiddenText}`);
});
assert.deepEqual(
  staticImportModules(fabricationCharacterPrintLayoutText),
  ['../types', './coordinates', './partGeometry'].sort(),
  'fabricationCharacterPrintLayout owns character cut-sheet layout with an exact pure import set'
);
[
  './fabrication',
  './fabricationContract',
  './project',
  './exporter',
  './physicsKernel',
  './sanitize',
  '../components',
  'react',
  'three',
  '@dimforge/rapier3d-compat'
].forEach(moduleName => {
  assert(
    !fabricationCharacterPrintLayoutText.includes(`from '${moduleName}'`) && !fabricationCharacterPrintLayoutText.includes(`from "${moduleName}"`),
    `fabricationCharacterPrintLayout stays pure and must not import ${moduleName}`
  );
});
[
  'FabricationPackage',
  'FabricationRecipe',
  'MechanismConfig',
  'createFabricationPackage',
  'validateForFabrication',
  'makeCustomPartsSvg',
  'makeCustomPartsPdf',
  'makeCustomPartsStl',
  'makeAssemblyGuideHtml',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationCharacterPrintLayoutText.includes(forbiddenText), `fabricationCharacterPrintLayout stays layout-only and must not reference ${forbiddenText}`);
});
assert(numberFormatText.includes('export const finiteNumber') && numberFormatText.includes('export const svgNumber'), 'neutral numberFormat seam owns finite/svg number formatting without domain imports');
assert(!fabricationRuntimeText.includes("rootRadiusMm: 28.438"), 'runtime gear constants are no longer duplicated outside the centralized contract');
assert.equal(fabricationManifest.generated_by, FABRICATION_SOURCE_SSOT, 'fabrication manifest generated_by matches the checked-in generator source');
assert.equal(fabricationManifest.source_ssot, FABRICATION_SOURCE_SSOT, 'fabrication manifest source_ssot matches the checked-in generator source');
assert.deepEqual(fabricationManifestSnapshot, fabricationManifest, 'mechanism reference fabrication snapshot mirrors fabrication/manifest.json');
const fabricationSvgManagedFiles = fabricationManifest.managed_files.filter(path => path.endsWith('.svg'));
type FabricationPythonOracle = {
  schema_version: number;
  captured_at: string;
  source_command: string;
  python_generator_sha256: string;
  managed_files: string[];
  files: Record<string, { source_svg_sha256: string; normalized_contour_records: string[]; contour_sha256: string }>;
};
type FabricationV2ReviewedOracle = {
  schema_version: 2;
  baseline_kind: 'reviewed-source-delta';
  base_oracle: string;
  managed_file_additions: string[];
  managed_file_removals: string[];
  files: Record<string, { source_svg_sha256: string; contour_sha256: string }>;
};
const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');
const fabricationPythonOracle = JSON.parse(readFileSync(fabricationPythonOraclePath, 'utf8')) as FabricationPythonOracle;
const fabricationV2ReviewedOraclePath = join(process.cwd(), 'fabrication', 'fabrication-v2-reviewed-oracle.json');
const fabricationV2ReviewedOracle = JSON.parse(readFileSync(fabricationV2ReviewedOraclePath, 'utf8')) as FabricationV2ReviewedOracle;
assert.deepEqual(Object.keys(fabricationPythonOracle).sort(), ['captured_at', 'files', 'managed_files', 'python_generator_sha256', 'schema_version', 'source_command'].sort(), 'frozen oracle uses the approved schema fields');
assert.equal(fabricationPythonOracle.schema_version, 1, 'frozen oracle schema version is explicit');
assert(fabricationPythonOracle.captured_at && fabricationPythonOracle.source_command && fabricationPythonOracle.python_generator_sha256, 'frozen oracle keeps capture provenance');
assert.equal(fabricationManifest.contour_oracle?.version, 2, 'active fabrication manifest opts into the explicit v2 reviewed delta');
assert.equal(fabricationManifest.contour_oracle?.base_oracle, 'fabrication-python-oracle.json', 'active fabrication manifest retains the frozen v1 base oracle');
assert.equal(fabricationManifest.contour_oracle?.baseline, 'fabrication-v2-reviewed-oracle.json', 'active fabrication manifest names the reviewed v2 delta');
assert.equal(fabricationV2ReviewedOracle.schema_version, 2, 'reviewed v2 oracle version is explicit');
assert.equal(fabricationV2ReviewedOracle.baseline_kind, 'reviewed-source-delta', 'reviewed v2 oracle is a source delta, not a rewrite of v1 evidence');
assert.equal(fabricationV2ReviewedOracle.base_oracle, 'fabrication-python-oracle.json', 'reviewed v2 delta points to the frozen v1 base');
assert(!fabricationPythonOracle.managed_files.includes('cam_modules/gravity-follower-module-v2.svg'), 'frozen v1 inventory excludes the v2 follower');
assert.equal(fabricationPythonOracle.files['cam_modules/gravity-follower-module-v2.svg'], undefined, 'frozen v1 contours are not rewritten with v2 geometry');
const activeOracleManagedFiles = [
  ...fabricationPythonOracle.managed_files.filter(path => !fabricationV2ReviewedOracle.managed_file_removals.includes(path)),
  ...fabricationV2ReviewedOracle.managed_file_additions,
].sort();
const activeOracleFiles = { ...fabricationPythonOracle.files, ...fabricationV2ReviewedOracle.files };
assert.deepEqual(activeOracleManagedFiles, [...fabricationManifest.managed_files].sort(), 'layered v1 plus reviewed v2 oracle records the active managed inventory');
assert.deepEqual(Object.keys(activeOracleFiles).sort(), fabricationSvgManagedFiles, 'layered oracle stores contour coverage for every active managed SVG');
const assertSvgFilesHaveVisibleContours = (rootDir: string, relPaths: string[], label: string) => {
  assert(relPaths.length > 0, `${label} has managed SVG files to parse`);
  relPaths.forEach(relPath => assert(svgContourSignature(readFileSync(join(rootDir, relPath), 'utf8')).records.length > 0, `${label}: ${relPath} has valid visible SVG contours`));
};
const assertSvgMatchesVersionedOracle = (rootDir: string, relPath: string, label: string) => {
  const signature = svgContourSignature(readFileSync(join(rootDir, relPath), 'utf8'));
  const oracleFile = activeOracleFiles[relPath];
  assert(oracleFile, `${label}: ${relPath} exists in the versioned oracle`);
  if ('normalized_contour_records' in oracleFile) {
    assert.deepEqual(signature.records, oracleFile.normalized_contour_records, `${label}: ${relPath} contour records match frozen v1 evidence`);
  }
  assert.equal(sha256Text(signature.signature), oracleFile.contour_sha256, `${label}: ${relPath} contour hash matches its versioned oracle`);
  if (Object.hasOwn(fabricationV2ReviewedOracle.files, relPath)) {
    assert.equal(sha256Text(readFileSync(join(rootDir, relPath), 'utf8')), oracleFile.source_svg_sha256, `${label}: ${relPath} source bytes match the reviewed v2 delta`);
  }
};
assertSvgFilesHaveVisibleContours(join(process.cwd(), 'fabrication'), fabricationSvgManagedFiles, 'committed fabrication package');
fabricationSvgManagedFiles.forEach(relPath => assertSvgMatchesVersionedOracle(join(process.cwd(), 'fabrication'), relPath, 'committed fabrication package'));


const baseContourFixture = '<svg height="10mm" width="10mm" viewBox="0 0 10 10" data-generated-by="a"><title>A</title><desc>B</desc><defs><style>.cut { stroke-width: 0.2504; fill: none; }</style></defs><g id="part" class="cut"><path class="cut" d="M 0 0 L 1.0004 1 Z" data-hole-diameter-mm="4"/><text x="1" y="2" class="engrave" style="font-size:5px" data-engrave-role="part-label">Gear</text></g></svg>';
const equalContourFixture = '<?xml version="1.0"?><svg viewBox="0 0 10 10" width="10mm" height="10mm" data-generated-by="b"><desc>Ignored</desc><title>Ignored</title><defs><style>.cut{fill:none;stroke-width:0.25}</style></defs><g class="cut" id="part"><path data-hole-diameter-mm="4.0004" d="M 0 0 L 1 1 Z" class="cut"/><text data-engrave-role="part-label" style="font-size:5.0004px" class="engrave" y="2" x="1">Gear</text></g></svg>';
assert(compareSvgContours(baseContourFixture, equalContourFixture).equal, 'SVG contour comparator ignores XML declaration, formatting, title/desc, attribute order, provenance, and sub-0.001mm numeric noise');
[
  ['path coordinate', baseContourFixture.replace('1.0004 1', '1.01 1')],
  ['topology order', baseContourFixture.replace('<path class="cut"', '<circle cx="5" cy="5" r="1" class="drill"/><path class="cut"')],
  ['transform', baseContourFixture.replace('<g id="part"', '<g transform="rotate(1)" id="part"')],
  ['class operation', baseContourFixture.replace('class="cut" d=', 'class="score" d=')],
  ['visible text', baseContourFixture.replace('>Gear</text>', '>Cam</text>')],
  ['root width', baseContourFixture.replace('width="10mm"', 'width="11mm"')],
  ['viewBox', baseContourFixture.replace('viewBox="0 0 10 10"', 'viewBox="0 0 11 10"')],
  ['style semantics', baseContourFixture.replace('stroke-width: 0.2504', 'stroke-width: 0.3')],
  ['role data attr', baseContourFixture.replace('data-hole-diameter-mm="4"', 'data-hole-diameter-mm="5"')],
].forEach(([label, fixture]) => {
  assert(!compareSvgContours(baseContourFixture, fixture).equal, `SVG contour comparator detects changed ${label}`);
});
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><image href="x.png"/></svg>'), /Unsupported SVG tag/, 'SVG contour comparator fails closed on unsupported visible geometry');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><path d="M 0x 0"/></svg>'), /Malformed SVG d token/, 'SVG contour comparator fails closed on malformed path numeric tokens');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"></svg><svg width="1mm" height="1mm" viewBox="0 0 1 1"></svg>'), /Unexpected content after svg root|Duplicate svg root/, 'SVG contour comparator fails closed on duplicate svg roots');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><circle cx="1x" cy="1" r="1"/></svg>'), /Malformed numeric SVG attribute/, 'SVG contour comparator fails closed on malformed numeric tokens');
assert.throws(() => svgContourSignature('<g><path d="M0 0"/></g>'), /Missing svg root/, 'SVG contour comparator fails closed on missing svg root');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1"><path d="M 0 0"/></svg>'), /viewBox requires exactly four numbers/, 'SVG contour comparator rejects malformed viewBox arity');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><polyline points="0 0 1"/></svg>'), /points requires x\/y pairs/, 'SVG contour comparator rejects odd-number points');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><g transform="banana(1)"></g></svg>'), /Unsupported SVG transform function banana/, 'SVG contour comparator rejects unsupported transforms');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><g transform="rotate(1 2)"></g></svg>'), /transform rotate arity/, 'SVG contour comparator rejects rotate with two args');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><path d="M 0"/></svg>'), /path command M requires 2 numbers/, 'SVG contour comparator rejects incomplete M command');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><path d="0 0"/></svg>'), /path numbers before command/, 'SVG contour comparator rejects path numbers before a command');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><path d="M 0 0 Z 1"/></svg>'), /path command Z takes no numbers/, 'SVG contour comparator rejects residual numbers after Z');
assert.throws(() => svgContourSignature('<svg width="1mm" width="1mm" height="1mm" viewBox="0 0 1 1"></svg>'), /Duplicate SVG attribute width/, 'SVG contour comparator rejects duplicate attributes');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"></svg>'), /Missing visible SVG geometry/, 'SVG contour comparator rejects root-only geometry-free SVGs');
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><rect width="1" height="1" data-folded-panel-width-mm="NaN"/></svg>'), /Malformed numeric SVG attribute data-folded-panel-width-mm/, 'SVG contour comparator rejects malformed numeric -mm data attrs');
assert(!compareSvgContours('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><rect width="1" height="1" data-score-area-mm2="1.0004" data-hole-index="2.0004"/></svg>', '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><rect width="1" height="1" data-score-area-mm2="1.0016" data-hole-index="3"/></svg>').equal, 'SVG contour comparator includes numeric -mm2 and -index data attrs in semantics');
assert(compareSvgContours('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><rect width="1" height="1" data-score-area-mm2="1.0004" data-hole-index="2.0004"/></svg>', '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><rect width="1" height="1" data-score-area-mm2="1" data-hole-index="2"/></svg>').equal, 'SVG contour comparator rounds numeric -mm2 and -index data attrs to 0.001mm');
assert(!compareSvgContours('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><style>.a{stroke:#0071bc}</style><circle cx="0" cy="0" r="1"/></svg>', '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><style>.a{stroke:#71bc}</style><circle cx="0" cy="0" r="1"/></svg>').equal, 'SVG contour comparator preserves CSS hex colors instead of numeric-normalizing them');
assert(!compareSvgContours('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><circle cx="0" cy="0" r="1" data-board-coord="A01"/></svg>', '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><circle cx="0" cy="0" r="1" data-board-coord="A1"/></svg>').equal, 'SVG contour comparator preserves role/string data attributes exactly');
assert(!compareSvgContours('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><style>.a{stroke:red}.a{stroke:blue}</style><circle cx="0" cy="0" r="1"/></svg>', '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><style>.a{stroke:blue}.a{stroke:red}</style><circle cx="0" cy="0" r="1"/></svg>').equal, 'SVG contour comparator preserves stylesheet cascade rule order');
const visibleLeafSvg = (leaf: string) => `<svg width="10mm" height="10mm" viewBox="0 0 10 10">${leaf}</svg>`;
const supportedVisibleLeafFixtures = [
  ['path', '<path d="M 0 0 L 1 1"/>'],
  ['circle', '<circle cx="1" cy="1" r="1"/>'],
  ['ellipse', '<ellipse cx="1" cy="1" rx="1" ry="0.5"/>'],
  ['rect', '<rect width="1" height="1"/>'],
  ['line', '<line x1="0" y1="0" x2="1" y2="1"/>'],
  ['polyline', '<polyline points="0 0 1 1"/>'],
  ['polygon', '<polygon points="0 0 1 0 1 1"/>'],
  ['use href', '<defs><path id="p" d="M 0 0 L 1 1"/></defs><use href="#p"/>'],
  ['use group href', '<defs><g id="mark"><path d="M 0 0 L 1 1"/></g></defs><use href="#mark"/>'],
  ['use xlink', '<defs><path id="p" d="M 0 0 L 1 1"/></defs><use xlink:href="#p"/>'],
  ['text', '<text x="0" y="0">Cut 1</text>'],
] as const;
for (const [label, leaf] of supportedVisibleLeafFixtures) {
  assert(svgContourSignature(visibleLeafSvg(leaf)).records.length > 0, `SVG contour comparator accepts valid ${label} leaf`);
}
const emptyVisibleLeafFixtures = [
  ['path', '<path/>'],
  ['path d', '<path d=" "/>'],
  ['circle', '<circle/>'],
  ['ellipse', '<ellipse/>'],
  ['rect', '<rect/>'],
  ['line', '<line/>'],
  ['polyline', '<polyline/>'],
  ['polygon', '<polygon/>'],
  ['use', '<use/>'],
  ['text', '<text/>'],
  ['text content', '<text>  </text>'],
] as const;
for (const [label, leaf] of emptyVisibleLeafFixtures) {
  assert.throws(() => svgContourSignature(visibleLeafSvg(`<rect width="1" height="1"/>${leaf}`)), /Malformed SVG/, `SVG contour comparator rejects empty ${label} leaf even with another valid leaf`);
}
assert.throws(() => svgContourSignature('<svg width="1mm" height="1mm" viewBox="0 0 1 1"><style>.a{stroke:red}</style></svg>'), /Missing visible SVG geometry/, 'SVG contour comparator treats style as non-geometry');
assert.throws(() => svgContourSignature(visibleLeafSvg('<defs><path id="p" d="M 0 0 L 1 1"/></defs>')), /Missing visible SVG geometry/, 'SVG contour comparator does not count defs-only geometry as visible');
assert.throws(() => svgContourSignature(visibleLeafSvg('<path id="p" d="M 0 0 L 1 1"/><circle id="p" cx="1" cy="1" r="1"/>')), /Duplicate SVG id p/, 'SVG contour comparator rejects duplicate ids');
assert.throws(() => svgContourSignature(visibleLeafSvg('<use href="#missing"/>')), /missing target #missing/, 'SVG contour comparator rejects missing local use refs');
assert.throws(() => svgContourSignature(visibleLeafSvg('<use href="other.svg#p"/>')), /href must be local #id/, 'SVG contour comparator rejects external use refs');
assert.throws(() => svgContourSignature(visibleLeafSvg('<style id="paint">.a{stroke:red}</style><use href="#paint"/>')), /target #paint has no visible geometry/, 'SVG contour comparator rejects use targets that are style-only');
assert.throws(() => svgContourSignature(visibleLeafSvg('<g id="empty"></g><use href="#empty"/>')), /target #empty has no visible geometry/, 'SVG contour comparator rejects use targets that are empty groups');
assert.throws(() => svgContourSignature(visibleLeafSvg('<defs><path id="p" d="M 0 0 L 1 1"/></defs><use href="#p" xlink:href="#other"/>')), /href mismatch/, 'SVG contour comparator rejects conflicting href and xlink:href');

const mainBoardPath = join(process.cwd(), 'fabrication', 'board-final.svg');
const parseBoardHoleRecords = (svg: string) => {
  const holes = [...svg.matchAll(/<circle\b[^>]*>/g)]
    .map(match => match[0])
    .map((tag) => {
      const coord = tag.match(/\bdata-board-coord="([^"]+)"/)?.[1];
      if (!coord) return null;
      const cx = Number(tag.match(/\bcx="([^"]+)"/)?.[1]);
      const cy = Number(tag.match(/\bcy="([^"]+)"/)?.[1]);
      const r = Number(tag.match(/\br="([^"]+)"/)?.[1]);
      return { coord, cx, cy, r };
    })
    .filter((entry): entry is { coord: string; cx: number; cy: number; r: number } => entry !== null && Number.isFinite(entry.cx) && Number.isFinite(entry.cy) && Number.isFinite(entry.r));
  holes.sort((a, b) => a.coord.localeCompare(b.coord));
  return holes;
};
const assertBoardCoordinatesMatch = (leftSvg: string, rightSvg: string, label: string) => {
  const left = parseBoardHoleRecords(leftSvg);
  const right = parseBoardHoleRecords(rightSvg);
  assert.equal(left.length, right.length, `${label}: hole count matches`);
  left.forEach((leftHole, index) => {
    const rightHole = right[index];
    assert.equal(leftHole.coord, rightHole.coord, `${label}: hole ${leftHole.coord} has same coordinate`);
    assert.equal(leftHole.cx, rightHole.cx, `${label}: hole ${leftHole.coord} has same cx`);
    assert.equal(leftHole.cy, rightHole.cy, `${label}: hole ${leftHole.coord} has same cy`);
    assert.equal(leftHole.r, rightHole.r, `${label}: hole ${leftHole.coord} has same radius`);
  });
};
const mainBoardSvg = readFileSync(mainBoardPath, 'utf8');
const mainBoardTag = mainBoardSvg.match(/<svg\b[^>]*>/)?.[0];
assert(mainBoardTag, 'fabrication main board SVG has a root svg tag');
const attr = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  assert(match, `main board SVG ${name} attribute exists`);
  return match[1];
};
const numAttr = (tag: string, name: string) => Number(attr(tag, name));
const mmAttr = (tag: string, name: string) => {
  const match = attr(tag, name).match(/^(\d+(?:\.\d+)?)mm$/);
  assert(match, `main board SVG ${name} is in millimeters`);
  return Number(match[1]);
};
const boardWidthMm = mmAttr(mainBoardTag, 'width');
const boardHeightMm = mmAttr(mainBoardTag, 'height');
assert.equal(attr(mainBoardTag, 'data-board-role'), 'main-board', 'fabrication/board-final.svg is the main board asset');
assert.equal(attr(mainBoardTag, 'data-grid-columns'), '15', 'main board declares 15 columns');
assert.equal(attr(mainBoardTag, 'data-grid-rows'), '15', 'main board declares 15 rows');
assert.equal(attr(mainBoardTag, 'data-grid-pitch-mm'), '20', 'main board declares 20mm pitch');
assert.equal(attr(mainBoardTag, 'data-hole-diameter-mm'), '4', 'main board declares 4mm holes');
assert.deepEqual(attr(mainBoardTag, 'viewBox').split(/\s+/).map(Number), [0, 0, boardWidthMm, boardHeightMm], 'main board viewBox matches its millimeter size');
assert(mainBoardSvg.includes('#0071bc'), 'main board uses blue engraving color');
assert(!mainBoardSvg.includes('#ed1c24'), 'main board no longer uses red-only cut styling');
assert.equal(attr(mainBoardTag, 'data-generated-by'), FABRICATION_BOARD_GENERATOR, 'board-final.svg records the TS board generator source');
const mainBoardCircleTags = [...mainBoardSvg.matchAll(/<circle\b[^>]*class="[^"]*\bdrill board-hole\b[^"]*"[^>]*>/g)].map(match => match[0]);
assert.equal(mainBoardCircleTags.length, 225, 'main board has exactly 225 board holes');
assert.equal(parseBoardHoleRecords(mainBoardSvg).length, 225, 'main board coordinate parser extracts 225 holes');
const boardLetters = Array.from({ length: 15 }, (_, index) => String.fromCharCode(65 + index));
const boardHoleByCoord = new Map(mainBoardCircleTags.map(tag => [attr(tag, 'data-board-coord'), tag]));
boardLetters.forEach((letter, col) => {
  Array.from({ length: 15 }, (_, row) => row + 1).forEach(row => {
    const tag = boardHoleByCoord.get(`${letter}${row}`);
    assert(tag, `main board hole ${letter}${row} exists`);
    assert.equal(numAttr(tag, 'r'), 2, `main board hole ${letter}${row} is 4mm diameter`);
    assert.equal(numAttr(tag, 'cx'), 15 + col * 20, `main board hole ${letter}${row} column pitch is 20mm`);
    assert.equal(numAttr(tag, 'cy'), 15 + (row - 1) * 20, `main board hole ${letter}${row} row pitch is 20mm`);
  });
});
const mainBoardTextTags = [...mainBoardSvg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)].map(match => match[0]);
const textValue = (tag: string) => tag.match(/>([^<]*)<\/text>$/)?.[1] ?? '';
const horizontalLabels = mainBoardTextTags.filter(tag => attr(tag, 'data-axis') === 'horizontal');
const verticalLabels = mainBoardTextTags.filter(tag => attr(tag, 'data-axis') === 'vertical');
assert.equal(horizontalLabels.length, 15, 'main board has 15 horizontal labels');
assert.equal(verticalLabels.length, 15, 'main board has 15 vertical labels');
horizontalLabels.forEach((tag, index) => {
  const label = boardLetters[index];
  assert.equal(attr(tag, 'data-label'), label, `horizontal label ${label} is ordered`);
  assert.equal(textValue(tag), label, `horizontal label ${label} text matches`);
  assert.equal(numAttr(tag, 'data-index'), index + 1, `horizontal label ${label} index matches`);
  assert.equal(numAttr(tag, 'x'), 15 + index * 20, `horizontal label ${label} aligns to its hole column`);
  assert.equal(numAttr(tag, 'y'), 8, `horizontal label ${label} stays on the top label row`);
});
verticalLabels.forEach((tag, index) => {
  const label = String(index + 1);
  assert.equal(attr(tag, 'data-label'), label, `vertical label ${label} is ordered`);
  assert.equal(textValue(tag), label, `vertical label ${label} text matches`);
  assert.equal(numAttr(tag, 'data-index'), index + 1, `vertical label ${label} index matches`);
  assert.equal(numAttr(tag, 'x'), 8, `vertical label ${label} stays on the side label column`);
  assert.equal(numAttr(tag, 'y'), 15 + index * 20, `vertical label ${label} aligns to its hole row`);
});
const generatedBoardDir = mkdtempSync(join(tmpdir(), 'motionsmith-fabrication-board-'));
try {
  execFileSync('bun', ['scripts/generate-fabrication-board.ts', '--output', generatedBoardDir], { cwd: process.cwd(), stdio: 'pipe' });
  const generatedTsBoard = readFileSync(join(generatedBoardDir, 'board-final.svg'), 'utf8');
  assert.equal(
    readFileSync(join(process.cwd(), 'fabrication', 'board-final.svg'), 'utf8'),
    generatedTsBoard,
    'TS board generator reproduces the committed board-final SVG'
  );
  assertBoardCoordinatesMatch(mainBoardSvg, generatedTsBoard, 'ts board map parity');
  assertSvgFilesHaveVisibleContours(generatedBoardDir, ['board-final.svg'], 'ts-generated board artifact');
} finally {
  rmSync(generatedBoardDir, { recursive: true, force: true });
}
const generatedTsFabricationDir = mkdtempSync(join(tmpdir(), 'motionsmith-fabrication-ts-'));
try {
  const oracleBefore = readFileSync(fabricationPythonOraclePath, 'utf8');
  const generationSummary = JSON.parse(execFileSync('bun', ['scripts/generate-fabrication-assets.ts', '--output', generatedTsFabricationDir, '--compare-committed'], { cwd: process.cwd(), encoding: 'utf8' })) as {
    committed_parity?: { managedFileSetExact: boolean; semantic_contour_files: string[]; exact_text_files: string[]; mismatched: string[] };
    frozen_python_oracle_parity?: { status: boolean; kind: string; semantic_contour_files: string[]; mismatches: string[] };
  };
  assert.equal(readFileSync(fabricationPythonOraclePath, 'utf8'), oracleBefore, 'ordinary TS generation does not rewrite the frozen oracle');
  assert.equal(generationSummary.committed_parity?.managedFileSetExact, true, 'fresh TypeScript output matches the committed managed package');
  assert.deepEqual(generationSummary.committed_parity?.mismatched, [], 'fresh TypeScript committed parity reports no mismatches');
  assert.equal(generationSummary.frozen_python_oracle_parity?.status, true, 'fresh TypeScript output matches the layered v1 plus reviewed v2 oracle');
  assert.equal(generationSummary.frozen_python_oracle_parity?.kind, 'reviewed-source-delta', 'fresh TypeScript output reports the reviewed v2 delta without mutating the frozen v1 oracle');
  assert.deepEqual(generationSummary.frozen_python_oracle_parity?.mismatches, [], 'fresh TypeScript oracle parity reports no mismatches');
  assert.equal(generationSummary.frozen_python_oracle_parity?.semantic_contour_files.length, fabricationSvgManagedFiles.length, 'fresh TypeScript/oracle parity covers every managed SVG including board');
  const generatedTsManifest = JSON.parse(readFileSync(join(generatedTsFabricationDir, 'manifest.json'), 'utf8')) as FabricationManifest;
  assert.deepEqual(generatedTsManifest.managed_files, fabricationManifest.managed_files, 'fresh TypeScript output keeps the managed SVG/path set aligned with committed fabrication package');
  fabricationSvgManagedFiles.forEach(relPath => {
    const semantic = compareSvgContours(readFileSync(join(generatedTsFabricationDir, relPath), 'utf8'), readFileSync(join(process.cwd(), 'fabrication', relPath), 'utf8'));
    assert(semantic.equal, `fresh TypeScript/committed SVG contour parity holds for ${relPath}: ${semantic.firstMismatch ?? 'mismatch'}`);
    assertSvgMatchesVersionedOracle(generatedTsFabricationDir, relPath, 'fresh TypeScript output');
  });
} finally {
  rmSync(generatedTsFabricationDir, { recursive: true, force: true });
}
assert.deepEqual(
  FABRICATION_GEAR_SPECS.map(spec => ({
    key: spec.key,
    label: spec.label,
    engravingLabel: spec.engravingLabel,
    teeth: spec.teeth,
    pitchRadiusMm: spec.pitchRadiusMm,
    rootRadiusMm: spec.rootRadiusMm,
    outerRadiusMm: spec.outerRadiusMm,
    holeDiameterMm: spec.holeDiameterMm,
    path: spec.path,
    attachmentHoleCentersMm: spec.attachmentHoleCentersMm.map(point => [point.x, point.y])
  })),
  fabricationManifest.parts.gears.map(spec => ({
    key: spec.key,
    label: spec.label,
    engravingLabel: spec.engraving_label,
    teeth: spec.teeth,
    pitchRadiusMm: spec.pitch_radius_mm,
    rootRadiusMm: spec.root_radius_mm,
    outerRadiusMm: spec.outer_radius_mm,
    holeDiameterMm: spec.hole_diameter_mm,
    path: spec.path,
    attachmentHoleCentersMm: spec.attachment_hole_centers_mm
  })),
  'runtime gear primitives mirror fabrication/manifest.json'
);
assert.deepEqual(
  FABRICATION_LINKAGE_SPECS.map(spec => ({
    key: spec.key,
    label: spec.label,
    engravingLabel: spec.engravingLabel,
    path: spec.path,
    cells: spec.cells,
    lengthMm: spec.lengthMm,
    pitchMm: spec.pitchMm,
    holeCount: spec.holeCentersMm.length,
    holeDiameterMm: spec.holeDiameterMm
  })),
  fabricationManifest.parts.linkages.map(spec => ({
    key: spec.key,
    label: spec.label,
    engravingLabel: spec.engraving_label,
    path: spec.path,
    cells: spec.cells,
    lengthMm: spec.length_mm,
    pitchMm: spec.pitch_mm,
    holeCount: spec.hole_count,
    holeDiameterMm: spec.hole_diameter_mm
  })),
  'runtime linkage primitives mirror fabrication/manifest.json'
);
assert.deepEqual(FABRICATION_LINKAGE_SPECS.find(spec => spec.cells === 4)?.holeCentersMm, [{ x: 14, y: 14 }, { x: 34, y: 14 }, { x: 54, y: 14 }, { x: 74, y: 14 }, { x: 94, y: 14 }], 'runtime linkage holes follow generator capsule margin and pitch');
assert.equal(FABRICATION_LINKAGE_WIDTH_MM, 14, 'runtime linkage width is centralized from the TypeScript generator convention');
assert.equal(FABRICATION_HOLE_RADIUS_MM, 2, 'runtime hole radius is centralized from the TypeScript generator convention');
assert.equal(fabricationBoardColumnLabel(0), 'A', 'fabrication board columns use A-O labels');
assert.equal(fabricationBoardColumnLabel(14), 'O', 'fabrication board columns end at O on the 15x15 board');
assert.equal(fabricationBoardColumnLabel(26), 'AA', 'fabrication board labels extend past 15 columns without invalid ASCII labels');
assert.equal(fabricationBoardRowLabel(0), '1', 'fabrication board rows use 1-15 labels');
assert.equal(fabricationBoardRowLabel(14), '15', 'fabrication board rows end at 15 on the 15x15 board');
assert.equal(boardCoordinateLabel(26, 16), 'AA17', 'shared board coordinate labels support larger classroom/teacher boards');
assert.equal(isBoardCoordinateInKit('Q17', { ...sample.settings.physicalKit, boardCells: 20 }), true, 'kit-aware board coordinate validation accepts cells past O on larger boards');
assert.equal(isBoardCoordinateInKit('Q17', sample.settings.physicalKit), false, 'kit-aware board coordinate validation rejects larger-board cells on the 15x15 kit');
assert.deepEqual(FABRICATION_SPACER_SPEC, {
  source: FABRICATION_SOURCE_SSOT,
  key: fabricationManifest.parts.spacers[0].key,
  label: fabricationManifest.parts.spacers[0].label,
  engravingLabel: fabricationManifest.parts.spacers[0].engraving_label,
  path: fabricationManifest.parts.spacers[0].path,
  outerDiameterMm: fabricationManifest.parts.spacers[0].outer_diameter_mm,
  innerDiameterMm: fabricationManifest.parts.spacers[0].inner_diameter_mm,
  holeDiameterMm: fabricationManifest.parts.spacers[0].hole_diameter_mm,
  holeCentersMm: fabricationManifest.parts.spacers[0].hole_centers_mm.map(point => ({ x: point[0], y: point[1] })),
  stackable: fabricationManifest.parts.spacers[0].stackable
}, 'runtime S10 spacer primitive mirrors fabrication/manifest.json');
assert.deepEqual(
  {
    key: FABRICATION_RING_GEAR_SPEC.key,
    label: FABRICATION_RING_GEAR_SPEC.label,
    engravingLabel: FABRICATION_RING_GEAR_SPEC.engravingLabel,
    pitchRadiusMm: FABRICATION_RING_GEAR_SPEC.pitchRadiusMm,
    innerTipRadiusMm: FABRICATION_RING_GEAR_SPEC.innerTipRadiusMm,
    innerRootRadiusMm: FABRICATION_RING_GEAR_SPEC.innerRootRadiusMm,
    outerRadiusMm: FABRICATION_RING_GEAR_SPEC.outerRadiusMm,
    mountRadiusMm: FABRICATION_RING_GEAR_SPEC.mountRadiusMm,
    holeDiameterMm: FABRICATION_RING_GEAR_SPEC.holeDiameterMm,
    mountHoleCentersMm: FABRICATION_RING_GEAR_SPEC.mountHoleCentersMm.map(point => [point.x, point.y])
  },
  {
    key: fabricationManifest.parts.ring_gears[0].key,
    label: fabricationManifest.parts.ring_gears[0].label,
    engravingLabel: fabricationManifest.parts.ring_gears[0].engraving_label,
    pitchRadiusMm: fabricationManifest.parts.ring_gears[0].pitch_radius_mm,
    innerTipRadiusMm: fabricationManifest.parts.ring_gears[0].inner_tip_radius_mm,
    innerRootRadiusMm: fabricationManifest.parts.ring_gears[0].inner_root_radius_mm,
    outerRadiusMm: fabricationManifest.parts.ring_gears[0].outer_radius_mm,
    mountRadiusMm: fabricationManifest.parts.ring_gears[0].mount_radius_mm,
    holeDiameterMm: fabricationManifest.parts.ring_gears[0].hole_diameter_mm,
    mountHoleCentersMm: fabricationManifest.parts.ring_gears[0].mount_hole_centers_mm
  },
  'runtime ring gear primitive mirrors fabrication/manifest.json'
);
assert.equal(FABRICATION_GEAR_ROOT_WEB_MM, 6, 'gear root web constant leaves clearance for the smallest gear mesh');
assert.equal(fabricationGearEngravingLabel(8), '8 Tooth Gear', 'gear engraving spells out the student-visible tooth count');
assert.equal(fabricationLinkageEngravingLabel(4), '5 Hole Linkage', 'linkage engraving spells out the student-visible hole count');
assert.equal(fabricationSpacerEngravingLabel(), 'Spacer', 'spacer engraving uses a direct student-visible name');
assert.equal(fabricationRingGearEngravingLabel(56), '56 Tooth Ring Gear', 'ring gear engraving spells out the student-visible tooth count');

const textTags = (svg: string) => [...svg.matchAll(/<text\b[^>]*>[^<]*<\/text>/g)].map(match => match[0]);
const circleTags = (svg: string) => [...svg.matchAll(/<circle\b[^>]*>/g)].map(match => match[0]);
const pathTags = (svg: string) => [...svg.matchAll(/<path\b[^>]*>/g)].map(match => match[0]);
const rectTags = (svg: string) => [...svg.matchAll(/<rect\b[^>]*>/g)].map(match => match[0]);
const engravingTextTags = (svg: string) => textTags(svg).filter(tag => /\bclass="[^"]*\bengrave\b[^"]*"/.test(tag));
const drillCircleTags = (svg: string) => circleTags(svg).filter(tag => /\bclass="[^"]*\bdrill\b[^"]*"/.test(tag));
const ENGRAVING_COLOR = '#008000';
const fontSizePx = (tag: string) => Number(tag.match(/font-size:([0-9.]+)px/)?.[1] ?? 3.2);
const explicitTextLength = (tag: string) => {
  const match = tag.match(/\btextLength="([0-9.]+)"/);
  return match ? Number(match[1]) : null;
};
type TextCorner = { x: number; y: number };
const rotatePoint = (point: TextCorner, angleDeg: number, cx: number, cy: number): TextCorner => {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle)
  };
};
const textCornersFor = (tag: string) => {
  const size = fontSizePx(tag);
  const label = textValue(tag);
  const width = explicitTextLength(tag) ?? label.length * size * 0.58;
  const height = size;
  const x = numAttr(tag, 'x');
  const y = numAttr(tag, 'y');
  const corners = [
    { x: x - width / 2, y: y - height / 2 },
    { x: x + width / 2, y: y - height / 2 },
    { x: x + width / 2, y: y + height / 2 },
    { x: x - width / 2, y: y + height / 2 }
  ];
  const rotate = tag.match(/transform="rotate\(([-0-9.]+)(?:\s+([-0-9.]+)\s+([-0-9.]+))?\)"/);
  return rotate
    ? corners.map(point => rotatePoint(point, Number(rotate[1]), Number(rotate[2] ?? x), Number(rotate[3] ?? y)))
    : corners;
};
const pointInPolygon = (point: TextCorner, polygon: TextCorner[]) => {
  let inside = false;
  for (let index = 0, prev = polygon.length - 1; index < polygon.length; prev = index, index += 1) {
    const a = polygon[index];
    const b = polygon[prev];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const pointToSegmentDistance = (point: TextCorner, start: TextCorner, end: TextCorner) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};
const textDistanceFromCircleCenter = (corners: TextCorner[], cx: number, cy: number) => {
  const point = { x: cx, y: cy };
  if (pointInPolygon(point, corners)) return 0;
  return Math.min(...corners.map((corner, index) => pointToSegmentDistance(point, corner, corners[(index + 1) % corners.length])));
};
const pathPoints = (tag: string) => {
  const values = attr(tag, 'd').match(/[-+]?(?:\d+\.\d+|\d+)/g)?.map(Number) ?? [];
  const points: TextCorner[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
  return points;
};
const classTag = (tags: string[], className: string) => {
  const tag = tags.find(item => new RegExp(`\\bclass="[^"]*\\b${className}\\b[^"]*"`).test(item));
  assert(tag, `SVG has ${className}`);
  return tag;
};
const insideLinkageCapsule = (point: TextCorner, cutTag: string) => {
  const values = attr(cutTag, 'd').match(/[-+]?(?:\d+\.\d+|\d+)/g)?.map(Number) ?? [];
  const x1 = values[0];
  const topY = values[1];
  const x2 = values[2];
  const radius = values[4];
  const cy = topY + radius;
  return (point.x >= x1 && point.x <= x2 && Math.abs(point.y - cy) <= radius)
    || Math.hypot(point.x - x1, point.y - cy) <= radius
    || Math.hypot(point.x - x2, point.y - cy) <= radius;
};
const insideVerticalCapsule = (point: TextCorner, cutTag: string) => {
  const values = attr(cutTag, 'd').match(/[-+]?(?:\d+\.\d+|\d+)/g)?.map(Number) ?? [];
  const x1 = values[0];
  const topY = values[1];
  const radius = values[2];
  const x2 = values[7];
  const bottomY = values[10];
  const cx = (x1 + x2) / 2;
  return (point.y >= topY && point.y <= bottomY && Math.abs(point.x - cx) <= radius)
    || Math.hypot(point.x - cx, point.y - topY) <= radius
    || Math.hypot(point.x - cx, point.y - bottomY) <= radius;
};
const linkageCapsuleClearance = (point: TextCorner, cutTag: string) => {
  const values = attr(cutTag, 'd').match(/[-+]?(?:\d+\.\d+|\d+)/g)?.map(Number) ?? [];
  const x1 = values[0];
  const topY = values[1];
  const x2 = values[2];
  const radius = values[4];
  const cy = topY + radius;
  if (point.x < x1) return radius - Math.hypot(point.x - x1, point.y - cy);
  if (point.x > x2) return radius - Math.hypot(point.x - x2, point.y - cy);
  return radius - Math.abs(point.y - cy);
};
const assertEngravingInsideCut = (relPath: string, svg: string, corners: TextCorner[]) => {
  if (relPath.startsWith('cams/')) {
    const outline = pathPoints(classTag(pathTags(svg), 'cam-outline'));
    corners.forEach(corner => assert(pointInPolygon(corner, outline), `${relPath} engraving stays inside the red cam cut outline`));
    return;
  }
  if (relPath.startsWith('followers/')) {
    const outline = classTag(pathTags(svg), 'follower-outline');
    const isCapsule = attr(outline, 'd').includes(' A ');
    corners.forEach(corner => assert(isCapsule ? insideVerticalCapsule(corner, outline) : pointInPolygon(corner, pathPoints(outline)), `${relPath} engraving stays inside the red follower cut outline`));
    return;
  }
  if (relPath.startsWith('brackets/')) {
    const outline = classTag(pathTags(svg), 'bracket-outline');
    const isCapsule = attr(outline, 'd').includes(' A ');
    corners.forEach(corner => assert(isCapsule ? insideLinkageCapsule(corner, outline) : pointInPolygon(corner, pathPoints(outline)), `${relPath} engraving stays inside the red bracket cut outline`));
    return;
  }
  if (relPath.startsWith('handles/')) {
    const outline = classTag(rectTags(svg), 'handle-outline');
    const left = numAttr(outline, 'x');
    const top = numAttr(outline, 'y');
    const right = left + numAttr(outline, 'width');
    const bottom = top + numAttr(outline, 'height');
    corners.forEach(corner => assert(corner.x >= left && corner.x <= right && corner.y >= top && corner.y <= bottom, `${relPath} engraving stays inside the red handle cut outline`));
    return;
  }
  if (relPath.startsWith('gears/')) {
    const outline = pathPoints(classTag(pathTags(svg), 'gear-outline'));
    corners.forEach(corner => assert(pointInPolygon(corner, outline), `${relPath} engraving stays inside the red gear cut outline`));
    return;
  }
  if (relPath.startsWith('linkages/')) {
    const outline = classTag(pathTags(svg), 'linkage-outline');
    corners.forEach(corner => {
      assert(insideLinkageCapsule(corner, outline), `${relPath} engraving stays inside the red linkage cut outline`);
      assert(linkageCapsuleClearance(corner, outline) >= 0.45, `${relPath} engraving keeps fabrication-safe clearance from the red linkage cut outline`);
    });
    return;
  }
  if (relPath.startsWith('spacers/')) {
    const outline = classTag(circleTags(svg), 'spacer-outline');
    const cx = numAttr(outline, 'cx');
    const cy = numAttr(outline, 'cy');
    const radius = numAttr(outline, 'r');
    corners.forEach(corner => assert(Math.hypot(corner.x - cx, corner.y - cy) <= radius - 0.05, `${relPath} engraving stays inside the red spacer cut outline`));
    return;
  }
  if (relPath.startsWith('ring_gears/')) {
    const outer = classTag(circleTags(svg), 'ring-outer-outline');
    const inner = pathPoints(classTag(pathTags(svg), 'ring-inner-gear-outline'));
    const cx = numAttr(outer, 'cx');
    const cy = numAttr(outer, 'cy');
    const radius = numAttr(outer, 'r');
    corners.forEach(corner => {
      assert(Math.hypot(corner.x - cx, corner.y - cy) <= radius - 0.05, `${relPath} engraving stays inside the red ring outer cut outline`);
      assert(!pointInPolygon(corner, inner), `${relPath} engraving stays outside the red ring inner cut void`);
    });
  }
};
const minimumEngravingFontSize = (label: string) => {
  if (label === 'Spacer') return 1.6;
  if (label === '8 Tooth Gear') return 2.7;
  if (label === 'Paper Tent Handle') return 4.0;
  if (label.endsWith('Cam')) return 3.0;
  if (label.endsWith('Follower')) return 3.0;
  if (label.endsWith('Bracket')) return 2.4;
  if (label.endsWith('Tooth Ring Gear')) return 6.2;
  if (label.endsWith('Tooth Gear')) return label.startsWith('24') ? 5.0 : label.startsWith('40') ? 6.0 : 7.0;
  if (label.endsWith('Hole Linkage')) return 3.8;
  return 3.2;
};
const assertEngravingSafety = (relPath: string, svg: string, expectedLabel: string, options: { requireStyle: boolean; context: string }) => {
  if (options.requireStyle) assert(svg.includes(`.engrave { fill: ${ENGRAVING_COLOR};`), `${relPath} engravings use green text`);
  const engravings = engravingTextTags(svg).filter(tag => attr(tag, 'data-engrave-label') === expectedLabel);
  assert(engravings.length >= 1, `${options.context} ${relPath} has on-part engraving label ${expectedLabel}`);
  assert.equal(engravings.map(textValue).join(' '), expectedLabel, `${options.context} ${relPath} visible engraving text spells out ${expectedLabel}`);
  engravings.forEach(engraving => {
    assert(fontSizePx(engraving) >= minimumEngravingFontSize(expectedLabel), `${options.context} ${relPath} engraving ${expectedLabel} uses the larger readable font size`);
    if (/^(linkages|cams|followers|brackets|handles)\//.test(relPath)) {
      assert(explicitTextLength(engraving) !== null, `${options.context} ${relPath} engraving pins rendered text length inside the cut area`);
      assert.equal(attr(engraving, 'lengthAdjust'), 'spacingAndGlyphs', `${options.context} ${relPath} engraving uses SVG-enforced text length`);
    }
    const corners = textCornersFor(engraving);
    assertEngravingInsideCut(relPath, svg, corners);
    drillCircleTags(svg).forEach(circle => {
      const distance = textDistanceFromCircleCenter(corners, numAttr(circle, 'cx'), numAttr(circle, 'cy'));
      assert(distance > numAttr(circle, 'r') + 0.2, `${options.context} ${relPath} engraving ${expectedLabel} does not overlap drill hole ${attr(circle, 'data-hole-role')}`);
    });
  });
};
const assertEngravingAvoidsDrillHoles = (relPath: string, expectedLabel: string) => {
  assertEngravingSafety(relPath, readFileSync(join(process.cwd(), 'fabrication', relPath), 'utf8'), expectedLabel, { requireStyle: true, context: 'individual SVG' });
};
const manifestOnPartEngravedParts = [
  ...fabricationManifest.parts.cams.map(spec => ({ category: 'cams', spec })),
  ...fabricationManifest.parts.followers.map(spec => ({ category: 'followers', spec })),
  ...fabricationManifest.parts.brackets.map(spec => ({ category: 'brackets', spec })),
  ...fabricationManifest.parts.handles.map(spec => ({ category: 'handles', spec }))
] as const;
const onPartEngravedPartSpecs = [
  ...FABRICATION_GEAR_SPECS.map(spec => ({ partId: `gears:${spec.key}`, path: spec.path, label: spec.engravingLabel, oldExternalLabel: `G${spec.teeth}` })),
  { partId: `ring_gears:${FABRICATION_RING_GEAR_SPEC.key}`, path: FABRICATION_RING_GEAR_SPEC.path, label: FABRICATION_RING_GEAR_SPEC.engravingLabel, oldExternalLabel: `R${FABRICATION_RING_GEAR_SPEC.internalTeeth}` },
  ...FABRICATION_LINKAGE_SPECS.map(spec => ({ partId: `linkages:${spec.key}`, path: spec.path, label: spec.engravingLabel, oldExternalLabel: `L${spec.cells}` })),
  { partId: `spacers:${FABRICATION_SPACER_SPEC.key}`, path: FABRICATION_SPACER_SPEC.path, label: FABRICATION_SPACER_SPEC.engravingLabel, oldExternalLabel: FABRICATION_SPACER_SPEC.key.toUpperCase() },
  ...manifestOnPartEngravedParts.map(({ category, spec }) => ({ partId: `${category}:${spec.key}`, path: spec.path, label: spec.engraving_label, oldExternalLabel: spec.label }))
];
onPartEngravedPartSpecs.forEach(spec => assertEngravingAvoidsDrillHoles(spec.path, spec.label));
const targetEngravingLabels = [
  ...onPartEngravedPartSpecs.map(spec => spec.label)
];
targetEngravingLabels.forEach(label => {
  assert(!/^\d+T\b|^[LR]\d+\b/.test(label), `engraving label ${label} avoids kid-unfriendly abbreviations`);
});
const completeKitCutSheet = readFileSync(join(process.cwd(), 'fabrication', 'complete-kit-cut-sheet.svg'), 'utf8');
assert(completeKitCutSheet.includes(`.engrave { fill: ${ENGRAVING_COLOR};`), 'complete kit engravings use green text');
const completeKitExpectedQuantities: Record<string, number> = Object.fromEntries([
  ...FABRICATION_GEAR_SPECS.map(spec => [`gears:${spec.key}`, 2] as const),
  ...FABRICATION_LINKAGE_SPECS.map(spec => [`linkages:${spec.key}`, 2] as const),
  [`spacers:${FABRICATION_SPACER_SPEC.key}`, 24] as const
]);
const completeKitIncludedPartSpecs = onPartEngravedPartSpecs.filter(spec => spec.partId in completeKitExpectedQuantities);
completeKitIncludedPartSpecs.map(spec => spec.label).forEach(label => {
  assert(completeKitCutSheet.includes(`data-engrave-label="${label}"`), `complete kit cut sheet carries on-part engraving ${label}`);
});
const completeKitPartGroups = [...completeKitCutSheet.matchAll(/<g class="complete-cut-part" data-part-id="([^"]+)"[^>]*>\n([\s\S]*?)\n  <\/g>/g)]
  .reduce((groups, match) => {
    const partGroups = groups.get(match[1]) ?? [];
    partGroups.push(`<svg>${match[2]}</svg>`);
    groups.set(match[1], partGroups);
    return groups;
  }, new Map<string, string[]>());
assert.deepEqual(fabricationManifest.complete_cut_sheet.part_quantities, completeKitExpectedQuantities, 'complete kit quantities are two gear sets, two linkage sets, and 24 spacers');
assert.equal(fabricationManifest.complete_cut_sheet.part_count, 40, 'complete kit has 40 physical parts');
assert.deepEqual(fabricationManifest.complete_cut_sheet.included_part_categories, ['gears', 'linkages', 'spacers'], 'complete kit schema declares included part categories');
assert.deepEqual(fabricationManifest.complete_cut_sheet.excluded_part_categories, ['ring_gears', 'cams', 'followers', 'brackets', 'handles', 'cam_modules'], 'complete kit schema declares excluded part categories');
assert.deepEqual(
  Object.fromEntries([...completeKitPartGroups].map(([partId, groups]) => [partId, groups.length])),
  completeKitExpectedQuantities,
  'complete kit SVG part groups match manifest quantities'
);
fabricationManifest.complete_cut_sheet.excluded_part_categories.map(category => `${category}:`).forEach(prefix => {
  assert(!completeKitCutSheet.includes(`data-part-id="${prefix}`), `complete kit excludes ${prefix} parts for now`);
});
const obsoleteExternalPartLabels = new Set(onPartEngravedPartSpecs.map(spec => spec.oldExternalLabel));
fabricationManifest.parts.cams.forEach(spec => obsoleteExternalPartLabels.add(spec.key[0].toUpperCase() + spec.key.slice(1)));
fabricationManifest.parts.followers.forEach(spec => obsoleteExternalPartLabels.add(spec.key.toUpperCase()));
fabricationManifest.parts.brackets.forEach(spec => obsoleteExternalPartLabels.add(spec.key));
fabricationManifest.parts.handles.forEach(spec => obsoleteExternalPartLabels.add(spec.key));
const assertNoObsoleteExternalPartLabels = (relPath: string, svg: string) => {
  const externalLabels = textTags(svg).filter(tag => !tag.includes('data-engrave-label') && obsoleteExternalPartLabels.has(textValue(tag)));
  assert.deepEqual(externalLabels.map(textValue), [], `${relPath} suppresses obsolete external part labels for green-engraved parts`);
};
assertNoObsoleteExternalPartLabels('complete-kit-cut-sheet.svg', completeKitCutSheet);
fabricationManifest.sheets.forEach(sheet => assertNoObsoleteExternalPartLabels(sheet.path, readFileSync(join(process.cwd(), 'fabrication', sheet.path), 'utf8')));
completeKitIncludedPartSpecs.forEach(spec => {
  const groupSvgs = completeKitPartGroups.get(spec.partId);
  assert(groupSvgs, `complete kit cut sheet includes ${spec.partId}`);
  groupSvgs.forEach(groupSvg => assertEngravingSafety(spec.path, groupSvg, spec.label, { requireStyle: false, context: `complete kit ${spec.partId}` }));
});
const g8Gear = FABRICATION_GEAR_SPECS.find(spec => spec.key === 'g8');
assert(g8Gear, 'G8 gear exists for mesh-clearance verification');
assert(g8Gear.rootRadiusMm < g8Gear.pitchRadiusMm, 'G8 gear root is below its pitch radius so an adjacent tooth can enter the valley');
FABRICATION_GEAR_SPECS.forEach(driver => {
  FABRICATION_GEAR_SPECS.forEach(driven => {
    const centerDistance = driver.pitchRadiusMm + driven.pitchRadiusMm;
    const outerOverlap = driver.outerRadiusMm + driven.outerRadiusMm - centerDistance;
    const driverTipClearanceInDrivenRoot = centerDistance - driver.outerRadiusMm - driven.rootRadiusMm;
    const drivenTipClearanceInDriverRoot = centerDistance - driven.outerRadiusMm - driver.rootRadiusMm;
    assert(outerOverlap > 0, `${driver.key}/${driven.key} gears have tooth overlap at pitch-center spacing`);
    assert(driverTipClearanceInDrivenRoot > 0, `${driver.key} tooth clears ${driven.key} root at pitch-center spacing`);
    assert(drivenTipClearanceInDriverRoot > 0, `${driven.key} tooth clears ${driver.key} root at pitch-center spacing`);
  });
});
const gearRadiusAtAngle = (outlinePoints: Point[], angle: number) => {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let radius = 0;
  outlinePoints.forEach((start, index) => {
    const end = outlinePoints[(index + 1) % outlinePoints.length];
    const sx = end.x - start.x;
    const sy = end.y - start.y;
    const det = dx * -sy - dy * -sx;
    if (Math.abs(det) < 1e-9) return;
    const rayT = (start.x * -sy - start.y * -sx) / det;
    const edgeT = (dx * start.y - dy * start.x) / det;
    if (rayT >= -1e-9 && edgeT >= -1e-9 && edgeT <= 1 + 1e-9) radius = Math.max(radius, rayT);
  });
  return radius;
};
type FabricationGearSpecForTest = typeof FABRICATION_GEAR_SPECS[number];
type GearMeshResult = { minGapMm: number; maxGapMm: number };
const gearPhaseForToothFraction = (gear: FabricationGearSpecForTest, fraction: number) => (Math.PI * 2 * fraction) / gear.teeth;
const gearMeshIsSafe = (mesh: GearMeshResult) => mesh.minGapMm >= 0.05 && mesh.maxGapMm <= 0.75;
const simulateGearPairCenterlineMesh = (
  driver: FabricationGearSpecForTest,
  driven: FabricationGearSpecForTest,
  drivenPhaseRad: number,
  rotationRatio = -driver.pitchRadiusMm / driven.pitchRadiusMm,
  steps = 512
) => {
  const driverProfile = fabricationGearProfileForPitchRadius(driver.pitchRadiusMm).outlinePoints;
  const drivenProfile = fabricationGearProfileForPitchRadius(driven.pitchRadiusMm).outlinePoints;
  const centerDistance = driver.pitchRadiusMm + driven.pitchRadiusMm;
  let minGapMm = Number.POSITIVE_INFINITY;
  let maxGapMm = Number.NEGATIVE_INFINITY;
  for (let step = 0; step < steps; step += 1) {
    const input = (step / steps) * Math.PI * 2;
    const driverRotation = input;
    const drivenRotation = input * rotationRatio + drivenPhaseRad;
    const gapMm = centerDistance - gearRadiusAtAngle(driverProfile, -driverRotation) - gearRadiusAtAngle(drivenProfile, Math.PI - drivenRotation);
    minGapMm = Math.min(minGapMm, gapMm);
    maxGapMm = Math.max(maxGapMm, gapMm);
  }
  return { minGapMm, maxGapMm };
};
const simulateGearPairCenterlineMeshForRadii = (
  driverPitchRadiusMm: number,
  drivenPitchRadiusMm: number,
  drivenPhaseRad: number,
  rotationRatio = -driverPitchRadiusMm / drivenPitchRadiusMm,
  steps = 512
) => {
  const driverProfile = fabricationGearProfileForPitchRadius(driverPitchRadiusMm).outlinePoints;
  const drivenProfile = fabricationGearProfileForPitchRadius(drivenPitchRadiusMm).outlinePoints;
  const centerDistance = driverPitchRadiusMm + drivenPitchRadiusMm;
  let minGapMm = Number.POSITIVE_INFINITY;
  let maxGapMm = Number.NEGATIVE_INFINITY;
  for (let step = 0; step < steps; step += 1) {
    const input = (step / steps) * Math.PI * 2;
    const driverRotation = input;
    const drivenRotation = input * rotationRatio + drivenPhaseRad;
    const gapMm = centerDistance - gearRadiusAtAngle(driverProfile, -driverRotation) - gearRadiusAtAngle(drivenProfile, Math.PI - drivenRotation);
    minGapMm = Math.min(minGapMm, gapMm);
    maxGapMm = Math.max(maxGapMm, gapMm);
  }
  return { minGapMm, maxGapMm };
};
const simulateGearTrainAdjacentMesh = (pitchRadiiMm: number[], pairIndex: number, steps = 512) => {
  const profiles = pitchRadiiMm.map(radius => fabricationGearProfileForPitchRadius(radius).outlinePoints);
  const sceneRadii = pitchRadiiMm.map(radius => radius * SCENE_PX_PER_MM);
  let minGapMm = Number.POSITIVE_INFINITY;
  let maxGapMm = Number.NEGATIVE_INFINITY;
  for (let step = 0; step < steps; step += 1) {
    const input = (step / steps) * Math.PI * 2;
    const leftRotation = input * gearTrainRotationRatioAt(sceneRadii, pairIndex) + gearTrainMeshPhaseRadAt(sceneRadii, pairIndex);
    const rightRotation = input * gearTrainRotationRatioAt(sceneRadii, pairIndex + 1) + gearTrainMeshPhaseRadAt(sceneRadii, pairIndex + 1);
    const gapMm = pitchRadiiMm[pairIndex] + pitchRadiiMm[pairIndex + 1] - gearRadiusAtAngle(profiles[pairIndex], -leftRotation) - gearRadiusAtAngle(profiles[pairIndex + 1], Math.PI - rightRotation);
    minGapMm = Math.min(minGapMm, gapMm);
    maxGapMm = Math.max(maxGapMm, gapMm);
  }
  return { minGapMm, maxGapMm };
};
const gearMeshPhaseFractions = [0, 0.25, 0.5, 0.75] as const;
FABRICATION_GEAR_SPECS.forEach(driven => {
  const sweep = gearMeshPhaseFractions.map(fraction => ({
    fraction,
    mesh: simulateGearPairCenterlineMesh(g8Gear, driven, gearPhaseForToothFraction(driven, fraction))
  }));
  assert.deepEqual(
    sweep.filter(({ mesh }) => gearMeshIsSafe(mesh)).map(({ fraction }) => fraction),
    [0.75],
    `8 Tooth Gear outline sweep selects the three-quarter tooth phase for ${driven.engravingLabel}: ${JSON.stringify(sweep)}`
  );
  const sceneRadii = [g8Gear.pitchRadiusMm * SCENE_PX_PER_MM, driven.pitchRadiusMm * SCENE_PX_PER_MM];
  const appPhase = gearTrainMeshPhaseRadAt(sceneRadii, 1);
  assert(Math.abs(appPhase - gearPhaseForToothFraction(driven, 0.75)) < 1e-9, `app gear phase matches the outline-sweep phase for ${driven.engravingLabel}`);
  const appMesh = simulateGearPairCenterlineMesh(g8Gear, driven, appPhase, gearTrainRotationRatioAt(sceneRadii, 1));
  assert(gearMeshIsSafe(appMesh), `8 Tooth Gear meshes with ${driven.engravingLabel} without tooth-on-tooth centerline jam or excess backlash: ${JSON.stringify(appMesh)}`);
});
const nonExactG24RadiusMm = 40;
const nonExactG24SceneRadii = [nonExactG24RadiusMm * SCENE_PX_PER_MM, nonExactG24RadiusMm * SCENE_PX_PER_MM];
assert.equal(fabricationGearProfileForPitchRadius(nonExactG24RadiusMm).preset.key, 'g24', 'non-exact gear radius renders with the nearest fabrication preset');
assert.equal(gearTrainMeshPhaseDegAt(nonExactG24SceneRadii, 1), 11.25, 'non-exact gear phase uses the rendered fabrication preset tooth count');
assert(
  gearMeshIsSafe(simulateGearPairCenterlineMeshForRadii(nonExactG24RadiusMm, nonExactG24RadiusMm, gearTrainMeshPhaseRadAt(nonExactG24SceneRadii, 1), gearTrainRotationRatioAt(nonExactG24SceneRadii, 1))),
  'non-exact equal-preset gears mesh safely with the app phase'
);
FABRICATION_GEAR_SPECS.forEach(output => {
  const pitchRadiiMm = [g8Gear.pitchRadiusMm, g8Gear.pitchRadiusMm, output.pitchRadiusMm];
  [0, 1].forEach(pairIndex => {
    const mesh = simulateGearTrainAdjacentMesh(pitchRadiiMm, pairIndex);
    assert(gearMeshIsSafe(mesh), `8 Tooth Gear idler train pair ${pairIndex} meshes safely with ${output.engravingLabel}: ${JSON.stringify(mesh)}`);
  });
});
assert.equal(fabricationGearSpecForPitchRadius(27).key, 'g24', 'gear display chooses the nearest fabrication preset by physical pitch radius');
const g24Profile = fabricationGearProfileForPitchRadius(60, 30);
assert.equal(g24Profile.source, FABRICATION_SOURCE_SSOT, 'gear profile declares the active fabrication source-of-truth');
assert.equal(g24Profile.preset.key, 'g24', 'gear profile preserves fabrication preset key');
assert.equal(g24Profile.outlinePoints.length, 96, 'G24 profile uses fabrication tooth segmentation, not sparse saw teeth');
assert.equal(g24Profile.attachmentHoleCenters.length, 4, 'G24 profile carries grid attachment holes into shared renderers');
assert.equal(gearTrainMeshPhaseDegAt([60, 60], 1), 11.25, 'G3/G3 external mesh offsets the driven gear by three quarters of a tooth');
assert(Math.abs(gearTrainMeshPhaseRadAt([60, 60], 1) - Math.PI / 16) < 1e-9, 'gear mesh phase has a radian form for inserted-idler 3D rotations');
assert(fabricationGearPathD(30, 30).startsWith('M 28.44 0 L 31.43 2.06 L 31.23 4.11'), 'shared SVG gear path matches fabrication gear outline convention');
assert(fabricationRingGearPathD(70).includes('M 90 0 A 90 90'), 'shared SVG ring gear path carries fabrication outer ring geometry');
assert(fabricationRingGearPathD(70).includes('68.54'), 'shared SVG ring gear path carries internal tooth geometry');
const ringProfile = fabricationRingGearProfileForPitchRadius(70);
assert.equal(ringProfile.mountHoleRadius, FABRICATION_HOLE_RADIUS_MM * (ringProfile.pitchRadius / FABRICATION_RING_GEAR_SPEC.pitchRadiusMm), 'ring gear profile preserves scaled mount-hole radius from the fabrication facade');
assert.deepEqual(profileFabricationGearProfileForPitchRadius(60, 30), g24Profile, 'fabricationProfiles preserves public gear profile behavior behind the fabrication facade');
assert.equal(profileFabricationGearPathD(30, 30), fabricationGearPathD(30, 30), 'fabricationProfiles preserves public gear SVG path behavior behind the fabrication facade');
assert.deepEqual(profileFabricationRingGearProfileForPitchRadius(70), ringProfile, 'fabricationProfiles preserves public ring gear profile behavior behind the fabrication facade');
assert.equal(profileFabricationRingGearPathD(70), fabricationRingGearPathD(70), 'fabricationProfiles preserves public ring gear SVG path behavior behind the fabrication facade');
const stackModelGearLinkage = {
  ...createDefaultMechanism('gear_linkage', 'stack-model-contract'),
  gearTrainRadii: [100, 20, 140],
  couplerLength: 3 * 20 * SCENE_PX_PER_MM
};
assert.deepEqual(stackModelFabricationStackForMechanism(stackModelGearLinkage), fabricationStackForMechanism(stackModelGearLinkage), 'fabricationStackModel preserves public stack layer behavior behind the fabrication facade');
assert.equal(stackModelFabricationStackSummary(stackModelGearLinkage), fabricationStackSummary(stackModelGearLinkage), 'fabricationStackModel preserves public compact stack summary behavior behind the fabrication facade');
assert.equal(stackModelReadableFabricationStackSummary(stackModelGearLinkage), readableFabricationStackSummary(stackModelGearLinkage), 'fabricationStackModel preserves public readable stack summary behavior behind the fabrication facade');
assert.deepEqual(stackModelFabricationLinkageSpecForSceneLength(stackModelGearLinkage.couplerLength, 20, 4), fabricationLinkageSpecForSceneLength(stackModelGearLinkage.couplerLength, 20, 4), 'fabricationStackModel preserves linkage blank spec selection behind the fabrication facade');
const defaultPlanetary = createDefaultMechanism('planetary_gear');
const planetaryLinkLengths = fabricationLinkageSceneLengthsForMechanism(defaultPlanetary);
assert.equal(planetaryLinkLengths.driver, defaultPlanetary.groundLength, 'planetary carrier linkage blank uses carrier radius, not short sun or planet radius');
assert.equal(
  fabricationLinkageHoleCountsForMechanism(defaultPlanetary).driver,
  fabricationLinkageSpecForSceneLength(defaultPlanetary.groundLength).holeCentersMm.length,
  'planetary carrier blank drills the nearest generator linkage for its actual carrier radius'
);
const couplerSpecForNonExactSpan = fabricationLinkageSpecForSceneLength(3 * 20 * SCENE_PX_PER_MM, 20, 4);
assert.equal(couplerSpecForNonExactSpan.cells, 4, 'min-hole linkage selection snaps non-exact spans to a generator-supported physical blank');
couplerSpecForNonExactSpan.holeCentersMm.slice(1).forEach((point, index) => {
  assert.equal(point.x - couplerSpecForNonExactSpan.holeCentersMm[index].x, 20, 'linkage hole spacing stays on the fabrication generator pitch');
});
const projectText = readFileSync(join(process.cwd(), 'utils', 'project.ts'), 'utf8');
const assemblySceneFrameComponentText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblySceneFrame.tsx'), 'utf8');
const assemblySceneFrameText = readFileSync(join(process.cwd(), 'utils', 'assemblySceneFrame.ts'), 'utf8');
const mechanismSceneContractText = readFileSync(join(process.cwd(), 'utils', 'mechanismSceneContract.ts'), 'utf8');
const mechanismCompilerText = readFileSync(join(process.cwd(), 'utils', 'mechanismCompiler.ts'), 'utf8');
const mechanismGraphFabricationCompilerText = readFileSync(join(process.cwd(), 'utils', 'mechanismGraphFabricationCompiler.ts'), 'utf8');
const assemblyWorkbenchText = [assemblySceneFrameComponentText, assemblySceneFrameText, mechanismSceneContractText].join('\n');
const assemblyGeometryText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'assemblyGeometry.ts'), 'utf8');
const assemblyGuideText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyGuide.tsx'), 'utf8');
const assemblyGuidePlaybackHookText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'useAssemblyGuidePlayback.ts'), 'utf8');
const assemblyGuideModelText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'assemblyGuideModel.ts'), 'utf8');
const assemblyControlPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyControlPanel.tsx'), 'utf8');
const assemblyCanvasPaneText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyCanvasPane.tsx'), 'utf8');
const assemblyThreePreviewText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyThreePreview.tsx'), 'utf8');
const assemblyInspectorPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyInspectorPanel.tsx'), 'utf8');
const blueprintExportText = readFileSync(join(process.cwd(), 'components', 'stages', 'blueprint', 'BlueprintExport.tsx'), 'utf8');
const blueprintControlPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'blueprint', 'BlueprintControlPanel.tsx'), 'utf8');
const blueprintDetailPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'blueprint', 'BlueprintDetailPanel.tsx'), 'utf8');
const assemblyPlaybackText = readFileSync(join(process.cwd(), 'utils', 'assemblyPlayback.ts'), 'utf8');
const threePreviewText = readFileSync(join(process.cwd(), 'components', 'ThreePuppetPreview.tsx'), 'utf8');
const exporterText = readFileSync(join(process.cwd(), 'utils', 'exporter.ts'), 'utf8');
const physicsSessionText = readFileSync(join(process.cwd(), 'utils', 'physicsSession.ts'), 'utf8');
const mechanismPreviewText = readFileSync(join(process.cwd(), 'utils', 'mechanismPreview.ts'), 'utf8');
const viewportText = readFileSync(join(process.cwd(), 'utils', 'viewport.ts'), 'utf8');
const viewer3dText = readFileSync(join(process.cwd(), 'utils', 'viewer3d.ts'), 'utf8');
const foundryCameraText = readFileSync(join(process.cwd(), 'utils', 'foundryCamera.ts'), 'utf8');
const mechanismRecommendationsText = readFileSync(join(process.cwd(), 'utils', 'mechanismRecommendations.ts'), 'utf8');
const webOnnxText = readFileSync(join(process.cwd(), 'utils', 'webOnnx.ts'), 'utf8');
const webOnnxWorkerText = readFileSync(join(process.cwd(), 'utils', 'webOnnxWorker.ts'), 'utf8');
const stageLayoutText = readFileSync(join(process.cwd(), 'components', 'stages', 'stageLayout.tsx'), 'utf8');
const partInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'PartInspector.tsx'), 'utf8');
const cutOutlineEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CutOutlineEditorDialog.tsx'), 'utf8');
const skeletonInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'SkeletonInspector.tsx'), 'utf8');
const inspectorControlsText = readFileSync(join(process.cwd(), 'components', 'ui', 'InspectorControls.tsx'), 'utf8');
const characterImportOverlaysText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterImportOverlays.tsx'), 'utf8');
const characterLessonOwnershipText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterLessonOwnership.tsx'), 'utf8');
const characterSetupPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterSetupPanel.tsx'), 'utf8');
const characterImportControlsText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterImportControls.tsx'), 'utf8');
const characterSelectionText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterSelection.tsx'), 'utf8');
const sceneObjectInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'SceneObjectInspector.tsx'), 'utf8');
const sceneObjectImageText = readFileSync(join(process.cwd(), 'utils', 'sceneObjectImage.ts'), 'utf8');
const pathEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PathEditor.tsx'), 'utf8');
const mechanismRecommendationSheetText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'MechanismRecommendationSheet.tsx'), 'utf8');
const mechanismParametricEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'MechanismParametricEditor.tsx'), 'utf8');
const mechanismEditAuthorityText = readFileSync(join(process.cwd(), 'utils', 'mechanismEditAuthority.ts'), 'utf8');
const mechanismParamPolicyText = `${readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'mechanismParamPolicy.ts'), 'utf8')}\n${mechanismEditAuthorityText}`;
const pathCanvasPaneText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PathCanvasPane.tsx'), 'utf8');
const sceneSketchText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'SceneSketch.tsx'), 'utf8');
const partShapeText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PartShape.tsx'), 'utf8');
const appText = appCommandSource;
const appWorkspaceShellText = readFileSync(join(process.cwd(), 'components', 'AppWorkspaceShell.tsx'), 'utf8');
const bugReportOverlayText = readFileSync(join(process.cwd(), 'components', 'shell', 'BugReportOverlay.tsx'), 'utf8');
const bugReportClientText = readFileSync(join(process.cwd(), 'utils', 'bugReport.ts'), 'utf8');
const studyTelemetryText = readFileSync(join(process.cwd(), 'utils', 'studyTelemetry.ts'), 'utf8');
const studyWorkerText = readFileSync(join(process.cwd(), 'infrastructure', 'study', 'worker.js'), 'utf8');
const appStageRouterText = readFileSync(join(process.cwd(), 'components', 'AppStageRouter.tsx'), 'utf8');
const appDerivedStateHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppDerivedState.ts'), 'utf8');
const workspacePlayerDockHookText = readFileSync(join(process.cwd(), 'hooks', 'useWorkspacePlayerDock.tsx'), 'utf8');
const workspacePlaybackLoopHookText = readFileSync(join(process.cwd(), 'hooks', 'useWorkspacePlaybackLoop.ts'), 'utf8');
const modalInertHookText = readFileSync(join(process.cwd(), 'hooks', 'useModalInertEffect.ts'), 'utf8');
const appPathActionsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppPathActions.ts'), 'utf8');
const appCharacterImportActionsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppCharacterImportActions.ts'), 'utf8');
const starterImageTemplatesText = readFileSync(join(process.cwd(), 'resources', 'starterImageTemplates.ts'), 'utf8');
const appOnnxBootstrapText = readFileSync(join(process.cwd(), 'hooks', 'useAppOnnxBootstrap.ts'), 'utf8');
const appAutosaveHookText = readFileSync(join(process.cwd(), 'hooks', 'useProjectAutosave.ts'), 'utf8');
const projectPersistenceText = readFileSync(join(process.cwd(), 'utils', 'projectPersistence.ts'), 'utf8');
const mechanismDesignText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'MechanismDesign.tsx'), 'utf8');
const collectComponentSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectComponentSourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
const designFoundryPreviewText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'DesignFoundryPreview.tsx'), 'utf8');
const designAutomataProjectionText = readFileSync(join(process.cwd(), 'utils', 'designAutomataProjection.ts'), 'utf8');
const automataSceneModelText = readFileSync(join(process.cwd(), 'utils', 'automataSceneModel.ts'), 'utf8');
const designWorkflowPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'DesignWorkflowPanel.tsx'), 'utf8');
const workflowSpecText = readFileSync(join(process.cwd(), 'tests', 'browser', 'workflow.spec.ts'), 'utf8');
const designInspectorPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'DesignInspectorPanel.tsx'), 'utf8');
const foundryPreviewModelText = readFileSync(join(process.cwd(), 'utils', 'foundryPreviewModel.ts'), 'utf8');
const mechanismDesignStageText = `${mechanismDesignText}
${designWorkflowPanelText}
${designInspectorPanelText}`;
const mechanismLinkagePreviewText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'MechanismLinkagePreview.tsx'), 'utf8');
const mechanismLinkagePreviewHelpersText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'mechanismLinkagePreviewHelpers.ts'), 'utf8');
const foundryPreviewGeometryText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryPreviewGeometry.ts'), 'utf8');
const threeFoundryPreviewText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'ThreeFoundryPreview.tsx'), 'utf8');
const foundryPreviewStateProbeText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryPreviewStateProbe.tsx'), 'utf8');
const foundryThreePrimitivesText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryThreePrimitives.ts'), 'utf8');
const foundryThreeRenderLayersText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryThreeRenderLayers.ts'), 'utf8');
const foundryAssemblySceneOverlayText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryAssemblySceneOverlay.ts'), 'utf8');
const threeResourceKitText = readFileSync(join(process.cwd(), 'utils', 'threeResourceKit.ts'), 'utf8');
const foundryPreviewStacksText = readFileSync(join(process.cwd(), 'utils', 'mechanismPreviewStacks.ts'), 'utf8');
const mechanismFoundryText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'MechanismFoundry.tsx'), 'utf8');
const foundryCanvasPaneText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryCanvasPane.tsx'), 'utf8');
const foundryCanvasChromeText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryCanvasChrome.tsx'), 'utf8');
const foundryOverlayLayerText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryOverlayLayer.tsx'), 'utf8');
const foundryWorkflowPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryWorkflowPanel.tsx'), 'utf8');
const foundryInspectorPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryInspectorPanel.tsx'), 'utf8');
assert.deepEqual(
  staticImportModules(mechanismGraphFabricationCompilerText),
  ['../types', './coordinates', './fabricationAssemblyFingerprint', './fabricationContract', './fabricationReadiness', './fabricationStackModel', './mechanismConnectionSelections', './mechanismFabricationZStack', './mechanismGraph'].sort(),
  'mechanismGraphFabricationCompiler owns graph-to-fabrication lowering with a focused import set'
);
const foundryStageText = `${mechanismFoundryText}
${foundryCanvasPaneText}
${foundryCanvasChromeText}
${foundryOverlayLayerText}
${foundryWorkflowPanelText}
${foundryInspectorPanelText}`;
const optionsText = readFileSync(join(process.cwd(), 'components', 'stages', 'options', 'Options.tsx'), 'utf8');
const optionsPreviewCanvasText = readFileSync(join(process.cwd(), 'components', 'stages', 'options', 'OptionsPreviewCanvas.tsx'), 'utf8');
const optionsSettingsControlsText = readFileSync(join(process.cwd(), 'components', 'stages', 'options', 'OptionsSettingsControls.tsx'), 'utf8');
const foundry3dText = `${foundryStageText}
${threeFoundryPreviewText}
${foundryPreviewStateProbeText}
${foundryThreePrimitivesText}
${foundryThreeRenderLayersText}
${threeResourceKitText}
${foundryPreviewStacksText}`;
const appShellText = readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8');
const shellUiText = [
  'GettingStartedDialog.tsx',
  'OnnxCacheStatusPill.tsx',
  'WorkflowRail.tsx',
  'TopCommandBar.tsx',
  'ShellDialogs.tsx',
  'CanvasZoomToolbar.tsx',
  'WorkspacePlayerDock.tsx',
  'WorkflowStatusStrip.tsx',
  'workflowStages.ts'
].map(file => readFileSync(join(process.cwd(), 'components', 'shell', file), 'utf8')).join('\n');
const appUiText = `${appText}
${appWorkspaceShellText}
${appStageRouterText}
${appShellText}
${shellUiText}
${characterImportControlsText}
${characterSelectionText}
${optionsText}
${optionsPreviewCanvasText}
${optionsSettingsControlsText}
${mechanismDesignStageText}
${designFoundryPreviewText}`;
const typesText = readFileSync(join(process.cwd(), 'types.ts'), 'utf8');
const indexText = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(appText.includes('<AppWorkspaceShell') && !appText.includes('<AppStageRouter') && appWorkspaceShellText.includes('<AppStageRouter') && appStageRouterText.includes('<MechanismFoundry') && !appText.includes('<MechanismFoundry') && !appStageRouterText.includes('const MechanismFoundry = ({') && mechanismFoundryText.includes('export const MechanismFoundry'), 'App.tsx delegates workspace chrome to AppWorkspaceShell, which delegates stage routing to AppStageRouter');
assert(appStageRouterText.includes('<MechanismDesign') && !appText.includes('<MechanismDesign') && !appStageRouterText.includes('const MechanismDesign = ({') && mechanismDesignText.includes('export const MechanismDesign'), 'AppStageRouter delegates Mechanism Design to an extracted stage seam');
assert(appStageRouterText.includes('<Options') && !appText.includes('<Options') && !appStageRouterText.includes('const Options = ({') && optionsText.includes('export const Options') && optionsText.includes('OPTIONS_SECTION_MANIFEST'), 'AppStageRouter delegates the Options stage to an extracted stage seam');
assert(optionsText.includes('<OptionsPreviewCanvas settings={project.settings} />') && !optionsText.includes('aria-label="Options preview canvas"') && optionsPreviewCanvasText.includes('export const OptionsPreviewCanvas') && optionsPreviewCanvasText.includes('aria-label="Options preview canvas"') && optionsPreviewCanvasText.includes('formatGridLabel(settings.physicalKit, settings.gridUnit)'), 'Options stage delegates the static center preview canvas to a presentation-only leaf');
assert(optionsText.includes('from "./OptionsSettingsControls"') && !optionsText.includes('const OPTIONS_SECTION_MANIFEST =') && optionsSettingsControlsText.includes('export const OPTIONS_SECTION_MANIFEST') && optionsSettingsControlsText.includes('export const SettingsSection') && optionsSettingsControlsText.includes('export const SelectField') && optionsSettingsControlsText.includes('ContextHelp helpId={helpId}'), 'Options stage delegates section metadata and field wrappers to a UI-only controls leaf');
[
  'dispatch(',
  'ProjectAction',
  'update_settings',
  'physicalKitPreset',
  'localStorage',
  'window.',
  'document.'
].forEach(forbiddenOptionsPreviewBoundary => {
  assert(!optionsPreviewCanvasText.includes(forbiddenOptionsPreviewBoundary), `OptionsPreviewCanvas stays presentation-only and excludes ${forbiddenOptionsPreviewBoundary}`);
});
[
  'dispatch(',
  'ProjectAction',
  'update_settings',
  'physicalKitPreset',
  'localStorage',
  'window.',
  'document.'
].forEach(forbiddenOptionsControlsBoundary => {
  assert(!optionsSettingsControlsText.includes(forbiddenOptionsControlsBoundary), `OptionsSettingsControls stays UI-only and excludes ${forbiddenOptionsControlsBoundary}`);
});
assert(appText.includes('createStageNavigator({') && !appText.includes('navigateAppStage({') && appStageNavigationText.includes('handoffGate(project, target)') && appStageNavigationText.includes('set_processing') && !appText.includes('handoffGate(project'), 'App delegates stage handoff side effects and goStage wiring to appStageNavigation while preserving recovery processing dispatch');
assert(
  appStageNavigationText.includes('recordStageNavigationOpened') &&
    appProjectCommandsHookText.includes('recordStageNavigationOpened(startStage, source)') &&
    appProjectCommandsHookText.includes('recordStageNavigationOpened("character", "new_project")') &&
    appProjectCommandsHookText.includes('recordStageNavigationOpened("path", "autosave_recovery")') &&
    appCharacterImportActionsHookText.includes('recordStageNavigationOpened("path", "project_import")') &&
    appMechanismActionsHookText.includes('recordStageNavigationOpened("design", "mechanism_commit")') &&
    appPathActionsHookText.includes('recordStageNavigationOpened("path", "tracked_path")') &&
    appControllerSource.includes('recordStageNavigationOpened("character", "getting_started_close")'),
  'all ungated project load, recovery, import, mechanism, path, and Getting Started stage moves emit the canonical navigation event',
);
assert(
  appStageRouterText.includes('onFoundryExport') &&
    !appStageRouterText.includes('fitMechanismToTargetPath') &&
    appText.includes('useAppMechanismActions') &&
    appMechanismActionsHookText.includes('exportFoundryMechanism') &&
    appMechanismActionsHookText.includes('fitMechanismToTargetPath') &&
    appMechanismActionsHookText.includes('fitRecommendedMechanismToSheet') &&
    appMechanismActionsHookText.includes('normalizeGearMeshMechanism') &&
    appMechanismActionsHookText.includes('optimizeSelectedMechanism') &&
    appMechanismActionsHookText.includes('exportMechanismSvg') &&
    appMechanismActionsHookText.includes('exportMechanismDxf') &&
    appMechanismActionsHookText.includes('applyRecommendedMechanism') &&
    !appText.includes('fitMechanismToTargetPath') &&
    !appText.includes('generateSmartConfig') &&
    !appText.includes('generateSVG') &&
    !appText.includes('generateDXF'),
  'AppStageRouter remains a presentation router while App delegates mechanism mutation/export/fitting actions to useAppMechanismActions',
);
const mechanismUpdateHarness = renderMechanismActionHarness();
mechanismUpdateHarness.actions.updateMechanism('mech-1', { targetPartId: 'head' });
assert.deepEqual(mechanismUpdateHarness.dispatches, [], 'mechanism action hook does not dispatch an invalid direct target edit');
assert.equal(mechanismUpdateHarness.commandStatus(), 'Fix: Choose anchor', 'mechanism action hook surfaces the exact rejected-edit action');

const conflictingMechanism = {
  ...sample.mechanisms[0],
  id: 'mech-driver-conflict',
};
const conflictProject = {
  ...sample,
  mechanisms: [sample.mechanisms[0], conflictingMechanism],
};
const conflictUpdateHarness = renderMechanismActionHarness({
  project: conflictProject,
});
assert.equal(
  conflictUpdateHarness.actions.updateMechanism('mech-1', { color: '#000000' }),
  false,
  'mechanism action hook reports false when the authoritative reducer rejects a conflicting edit',
);
assert.deepEqual(
  conflictUpdateHarness.dispatches,
  [],
  'mechanism action hook does not dispatch an edit that the authoritative reducer would reject',
);
assert.equal(
  conflictUpdateHarness.commandStatus(),
  'Change blocked',
  'mechanism action hook exposes a concise recovery status for a rejected reducer edit',
);

const foundryExportProject = createSampleProject({ includeMechanism: true });
const foundryExportPath = foundryExportProject.paths['path-right-arm'];
const foundryExportMechanism = { ...foundryExportProject.mechanisms[0], id: 'foundry-preview-contract' };
const foundryExportFittedParameters = {
  ...foundryExportMechanism,
};
const foundryExportPackage: FoundryExportPackage = {
  id: 'foundry-export-contract',
  createdAt: '2026-07-04T00:00:00.000Z',
  mechanismId: 'foundry-exported-contract',
  mechanismType: '4bar',
  parameters: foundryExportFittedParameters,
  pivot: { x: foundryExportMechanism.anchorX ?? 0, y: foundryExportMechanism.anchorY ?? 0 },
  outputPoint: foundryExportPath.points[0],
  generatedPath: foundryExportPath.points,
  simulationSummary: 'ready',
  visual: { color: foundryExportMechanism.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1800, steps: 60, loop: true },
  metadata: { sourceTab: 'mechanism-foundry', selectedPreset: 'four-bar', recommendation: 'contract fit' },
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  warnings: ['contract warning'],
  source: 'mechanism-foundry',
};
const foundryExportHarness = renderMechanismActionHarness({ project: foundryExportProject, foundry: foundryExportMechanism });
foundryExportHarness.actions.exportFoundryMechanism(foundryExportPackage);
assert.deepEqual(foundryExportHarness.dispatches.map(action => action.type), ['commit_mechanism_candidate'], 'Foundry export uses one compound reducer transition');
assert.equal(foundryExportHarness.stage(), 'design', 'Foundry export action still navigates to Design');
const hookFoundryCommit = foundryExportHarness.dispatches[0] as Extract<ProjectAction, { type: 'commit_mechanism_candidate' }>;
const hookFoundryMechanism = hookFoundryCommit.result.mechanism;
assert.equal(hookFoundryMechanism.id, 'mech-1', 'Foundry export refits the existing exact target instead of creating duplicate target drivers');
const independentDifferentTargetInsert = applyProjectAction(foundryExportProject, {
  type: 'upsert_mechanism',
  mechanism: {
    ...hookFoundryMechanism,
    id: 'foundry-second-target',
    targetPartId: 'head',
    targetPathId: undefined,
    targetAnchorJointId: undefined,
    activeVisualPartIds: ['head']
  }
});
assert.strictEqual(independentDifferentTargetInsert, foundryExportProject, 'direct insertion rejects an unbound detached mechanism atomically');
assert.equal(hookFoundryMechanism.source, 'foundry', 'Foundry export preserves source metadata');
assert.equal(hookFoundryMechanism.targetPathId, 'path-right-arm', 'Foundry export preserves the selected target path');
assert.equal(hookFoundryMechanism.crankLength, foundryExportFittedParameters.crankLength, 'Foundry export carries the fitted input linkage length into Design');
assert.equal(hookFoundryMechanism.groundLength, foundryExportFittedParameters.groundLength, 'Foundry export carries the fitted ground span into Design');
assert.equal(hookFoundryMechanism.couplerLength, foundryExportFittedParameters.couplerLength, 'Foundry export carries the fitted coupler length into Design');
assert.equal(hookFoundryMechanism.rockerLength, foundryExportFittedParameters.rockerLength, 'Foundry export carries the fitted output linkage length into Design');
assert.equal(hookFoundryMechanism.foundryExport?.metadata.recommendation, 'contract fit', 'Foundry export embeds package metadata for downstream Design/Blueprint parity');
assert(hookFoundryMechanism.generatedPath && hookFoundryMechanism.generatedPath.length >= 3, 'Foundry export keeps a generated path for simulation and fit checks');
assert(hookFoundryMechanism.foundryExport?.warnings.includes('contract warning'), 'Foundry export preserves package warnings on the committed package');
assert(appMechanismActionsHookText.includes('fittedFoundryParameters') && appMechanismActionsHookText.includes('...fittedFoundryParameters'), 'Foundry export carries the fitted preview parameters into Design instead of rebuilding only from controller defaults');

assert(appText.includes('useAppDerivedState(project)') && !appText.includes('const sortedParts = useMemo') && appDerivedStateHookText.includes('selectedMechanism') && appDerivedStateHookText.includes('playbackDurationMs') && appDerivedStateHookText.includes('mechanismConfig: GlobalConfig') && appDerivedStateHookText.includes('current?.partId === selectedPart.id'), 'App delegates selected part/path/mechanism/playback/config derivation to a pure hook without changing selection defaults');
assert(mechanismFoundryText.includes('<FoundryWorkflowPanel') && foundryWorkflowPanelText.includes('data-testid="foundry-pick-anchor"') && !foundryWorkflowPanelText.includes('data-testid="foundry-target-summary"') && !foundryWorkflowPanelText.includes('Board hole') && !foundryWorkflowPanelText.includes('Range') && !foundryWorkflowPanelText.includes('Status'), 'Foundry left pane keeps action controls while hiding raw target, board-hole, range, and status readouts from the default student UI');
assert(mechanismFoundryText.includes('fitMechanismToTargetPath') && mechanismFoundryText.includes('onFitPath={() => applyPathFit()}') && !mechanismFoundryText.includes('lastPathFitSignatureRef') && !mechanismFoundryText.includes('applyPathFit(next)') && foundryWorkflowPanelText.includes('data-testid="foundry-fit-path"') && foundryWorkflowPanelText.includes('foundry.fitPath') && foundryCanvasPaneText.includes('data-fit-board-cells') && foundryCanvasPaneText.includes('data-fit-target-path'), 'Foundry exposes a prominent Fit path action while preserving the default mechanism until the user clicks Fit');
const foundryFitContractSeed = createDefaultMechanism('4bar', 'foundry-fit-contract');
const foundryFitProject = { ...sample, mechanisms: [], selectedMechanismId: undefined };
const foundryFitContract = fitMechanismToTargetPath(foundryFitProject, foundryFitContractSeed, 'path-right-arm');
const staleParentFitContract = fitMechanismToTargetPath(foundryFitProject, { ...foundryFitContractSeed, id: 'stale-parent-fit-contract', targetPartId: 'right_arm_lower', targetAnchorJointId: 'right_elbow', activeVisualPartIds: ['right_arm_lower'] }, 'path-right-arm');
assert.equal(staleParentFitContract.targetPartId, sample.paths['path-right-arm'].partId, 'Fit path replaces stale parent targetPartId with the selected path owner');
assert.equal(staleParentFitContract.targetAnchorJointId, sample.paths['path-right-arm'].targetAnchorJointId, 'Fit path replaces stale parent targetAnchorJointId with the selected path anchor');
assert.deepEqual(staleParentFitContract.activeVisualPartIds, [sample.paths['path-right-arm'].partId], 'Fit path replaces stale activeVisualPartIds with the selected path owner');
const staleParentBase: ProjectState = { ...sample, mechanisms: [], selectedMechanismId: undefined };
const rejectedStaleParent = applyProjectAction(staleParentBase, { type: 'upsert_mechanism', mechanism: { ...sample.mechanisms[0], id: 'stale-parent-reconcile-contract', targetPartId: 'right_arm_lower', targetPathId: 'path-right-arm', targetAnchorJointId: 'right_elbow', activeVisualPartIds: ['right_arm_lower'] } });
assert.strictEqual(rejectedStaleParent, staleParentBase, 'direct project edit rejects stale target/path/anchor references instead of silently reconciling them');
assert.equal(foundryFitContract.id, foundryFitContractSeed.id, 'Fit path preserves the active Foundry preview instance id');
assert.equal(foundryFitContract.targetPathId, 'path-right-arm', 'Fit path writes the selected drawn path only after the explicit Fit action');
assert(
  [foundryFitContract.crankLength, foundryFitContract.couplerLength, foundryFitContract.rockerLength].every(linkageSceneLengthIsFabricationPreset),
  '4bar path fitting keeps moving links within the physical linkage sizes',
);
const foundryFitGroundStart = { x: foundryFitContract.anchorX ?? Number.NaN, y: foundryFitContract.anchorY ?? Number.NaN };
const foundryFitGroundAngle = ((foundryFitContract.groundAngle ?? 0) * Math.PI) / 180;
const foundryFitGroundEnd = {
  x: foundryFitGroundStart.x + foundryFitContract.groundLength * Math.cos(foundryFitGroundAngle),
  y: foundryFitGroundStart.y + foundryFitContract.groundLength * Math.sin(foundryFitGroundAngle),
};
const foundryFitGroundStartHole = sceneToBoardRaw(foundryFitGroundStart, foundryFitProject.settings.physicalKit);
const foundryFitGroundEndHole = sceneToBoardRaw(foundryFitGroundEnd, foundryFitProject.settings.physicalKit);
const foundryFitGroundColSpan = Math.abs(foundryFitGroundEndHole.col - foundryFitGroundStartHole.col);
const foundryFitGroundRowSpan = Math.abs(foundryFitGroundEndHole.row - foundryFitGroundStartHole.row);
assert(
  foundryFitGroundStartHole.valid && foundryFitGroundEndHole.valid &&
    Math.hypot(foundryFitGroundStart.x - boardToScene(foundryFitGroundStartHole.col, foundryFitGroundStartHole.row, foundryFitProject.settings.physicalKit).x, foundryFitGroundStart.y - boardToScene(foundryFitGroundStartHole.col, foundryFitGroundStartHole.row, foundryFitProject.settings.physicalKit).y) < 1e-6 &&
    Math.hypot(foundryFitGroundEnd.x - boardToScene(foundryFitGroundEndHole.col, foundryFitGroundEndHole.row, foundryFitProject.settings.physicalKit).x, foundryFitGroundEnd.y - boardToScene(foundryFitGroundEndHole.col, foundryFitGroundEndHole.row, foundryFitProject.settings.physicalKit).y) < 1e-6 &&
    (foundryFitGroundColSpan === 0 || foundryFitGroundRowSpan === 0 || foundryFitGroundColSpan === foundryFitGroundRowSpan),
  '4bar path fitting resolves both ground endpoints to active-kit board holes across axis or diagonal spans',
);
assert(sampleFeasibleRange(foundryFitContract).percentValid >= 0.98, '4bar path fitting only accepts full-rotation kit candidates');
const foundryFitGenerated = foundryFitContract.generatedPath ?? [];
assert.deepEqual(
  foundryFitGenerated,
  primaryFoundryPlaybackPath(foundryFitContract, 96),
  '4bar path fitting stores the canonical runtime mechanism path instead of a scored B/C search trace',
);
const gearLinkageFitSeed = createDefaultMechanism('gear_linkage', 'foundry-gear-linkage-fit-contract');
const gearLinkageFitContract = fitMechanismToTargetPath(foundryFitProject, gearLinkageFitSeed, 'path-right-arm');
const gearLinkageTargetPath = sample.paths['path-right-arm'];
const gearLinkageGenerated = gearLinkageFitContract.generatedPath ?? [];
const gearLinkageTraces = generateMechanismPointTraces(gearLinkageFitContract, gearLinkageGenerated.length).traces;
const gearLinkageSharedTrace = gearLinkageTraces.find(trace => trace.id === 'R');
const gearLinkageGearPinTrace = gearLinkageTraces.find(trace => trace.id === 'B');
assert.equal(gearLinkageFitContract.targetPathId, 'path-right-arm', 'gear linkage Fit writes the selected drawn path');
assert.equal(gearLinkageFitContract.targetPartId, gearLinkageTargetPath.partId, 'gear linkage Fit keeps the selected motion target part');
assert(!gearLinkageFitContract.warnings?.some(warning => /No motion|choose target/i.test(warning)), 'gear linkage Fit does not fall back to a no-target/no-motion candidate');
assert.equal(validateMechanismPreviewReadiness(gearLinkageFitContract).length, 0, 'gear linkage Fit returns a preview-ready mechanism');
assert.equal(validateForFabrication({ ...foundryFitProject, mechanisms: [gearLinkageFitContract] }).errors.length, 0, 'gear linkage Fit returns a fabrication-valid mechanism without duplicate-driver noise');
assert(
  gearLinkageGenerated.length > 1 &&
    gearLinkageSharedTrace?.points.length === gearLinkageGenerated.length &&
    Math.hypot(gearLinkageGenerated[0].x - gearLinkageSharedTrace.points[0].x, gearLinkageGenerated[0].y - gearLinkageSharedTrace.points[0].y) < 1e-6,
  'gear linkage Fit uses the shared linkage meeting point R as the motion target trace',
);
assert(
  gearLinkageGearPinTrace &&
    Math.hypot(gearLinkageGenerated[0].x - gearLinkageGearPinTrace.points[0].x, gearLinkageGenerated[0].y - gearLinkageGearPinTrace.points[0].y) > 10,
  'gear linkage Fit does not use the output gear pin B as the motion target trace',
);
assert(mechanismFoundryText.includes('<FoundryInspectorPanel') && foundryInspectorPanelText.includes('testId="foundry-parametric-editor"') && foundryInspectorPanelText.includes('Mechanism options') && foundryInspectorPanelText.includes('data-testid="foundry-view-controls"'), 'MechanismFoundry delegates the right Foundry inspector without changing parametric editor, compact view controls, or advanced options');
assert(foundryInspectorPanelText.includes('data-testid="foundry-visible-sensemaking"') && foundryInspectorPanelText.includes('<ClassroomExampleVideo') && !foundryWorkflowPanelText.includes('data-testid="foundry-visible-sensemaking"') && !foundryInspectorPanelText.includes('Preview overlays') && !foundryInspectorPanelText.includes('foundry-physics-readout'), 'Foundry right inspector owns sensemaking first while removing stale preview-overlay and Motion readout cards');
{
  const foundryStackProbe = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'foundry-stack-probe')));
  const graphStackRecipe = compileMechanismGraphFabrication(foundryStackProbe, sample.settings.physicalKit).recipe!;
  const foundryInspectorHtml = renderToString(createElement(FoundryInspectorPanel, {
    foundry: foundryStackProbe,
    kit: sample.settings.physicalKit,
    libraryLabel: MECHANISM_TEMPLATE_LIBRARY[foundryStackProbe.type].label,
    classroomAssessmentKey: DEFAULT_CLASSROOM_ASSESSMENT_KEY,
    classroomSensemaking: MECHANISM_TEMPLATE_LIBRARY[foundryStackProbe.type].classroomSensemaking,
    foundryRigOpacity: 85,
    foundryExplode: 0,
    showSensemaking: false,
    onRigOpacityChange: () => undefined,
    onExplodeChange: () => undefined,
    onUpdateParams: () => undefined,
    onChangeParam: () => undefined,
    onSetMechanismType: () => undefined,
    onSetPreset: () => undefined,
    onToggleSensemaking: () => undefined,
  }));
  assert(foundryInspectorHtml.includes(fabricationRecipeStackSummary(graphStackRecipe)) && !foundryInspectorPanelText.includes('readableFabricationStackSummary') && !foundryInspectorPanelText.includes('fabricationStackSummary(foundry)'), 'Foundry right inspector renders kit-aware graph-compiled stack summaries instead of legacy mechanism-reference stack helpers');
}
assert(mechanismFoundryText.includes('<FoundryCanvasPane') && foundryCanvasPaneText.includes('<ThreeFoundryPreview') && foundryCanvasPaneText.includes('<FoundryOverlayLayer') && foundryCanvasChromeText.includes('data-testid="foundry-toolbar"') && foundryCanvasChromeText.includes('data-testid="foundry-camera-controls"') && foundryOverlayLayerText.includes('data-testid="foundry-preview-overlay"') && foundryOverlayLayerText.includes('data-testid="foundry-param-handles"') && foundryCanvasPaneText.includes('data-testid="foundry-toolbar-state"') && foundryCanvasPaneText.includes('data-testid="foundry-motion-warning"'), 'MechanismFoundry delegates the center Foundry canvas while warning overlays live above playback controls');
assert(foundryOverlayLayerText.includes('data-handle-contract="move-anchor-plus-shape-handles"') && foundryOverlayLayerText.includes('data-handle-ids=') && mechanismFoundryText.includes('id: "M"') && mechanismFoundryText.includes('applyAnchor({') && mechanismFoundryText.includes('setSelectedOutputTraceId') && foundryCanvasChromeText.includes('data-testid="foundry-cycle-output-trace"'), 'Foundry exposes a shared move handle and a selectable Mech Path target instead of limiting direct manipulation to 4bar B/C/D handles');
assert(foundryWorkflowPanelText.includes('<MechanismLinkagePreview') && mechanismLinkagePreviewText.includes('export const MechanismLinkagePreview') && mechanismLinkagePreviewText.includes('mechanismLinkagePreviewHelpers') && mechanismLinkagePreviewHelpersText.includes('mechanismTopologySummary') && mechanismLinkagePreviewHelpersText.includes('camProfilePathD') && foundryPreviewGeometryText.includes('export const fittedGearTrainCenters'), 'Foundry workflow delegates 2D Foundry SVG preview to extracted foundry renderer/helper seams');
assert(foundryWorkflowPanelText.includes('ghostSimulations') && foundryWorkflowPanelText.includes('foundry-mini-ghost'), 'Foundry gallery cards show moving front-view mechanism poses instead of a single static icon');
assert(
  threeFoundryPreviewText.includes('mechanismInventoryForMechanism(mechanism, kit)') &&
    !threeFoundryPreviewText.includes('foundryRenderedInventory') &&
    !existsSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryRenderInventory.ts')) &&
    !threeFoundryPreviewText.includes('gearRadii.length + 4') &&
    !threeFoundryPreviewText.includes('Math.max(baseInv.parts'),
  'Foundry Three renderer consumes the shared kit-aware graph compiler inventory helper without stage-local wrapper fallbacks'
);
assert(
  foundry3dText.includes('mechanismContract.renderPlan') &&
    foundry3dText.includes('MechanismSceneContract') &&
    !foundry3dText.includes('compileMechanismRenderPlan') &&
    !foundry3dText.includes('fabricationRenderPlanForMechanism'),
  'Foundry/Design/Assembly Three renderers consume the full-project scene contract render plan without mechanism-only compiler fallbacks'
);
assert(
  threePreviewText.includes('buildProjectMechanismSceneContract') &&
    threePreviewText.includes('contract.renderPlan') &&
    threePreviewText.includes('stackValidationErrors === 0') &&
    !threePreviewText.includes('compileMechanismRenderPlan') &&
    !threePreviewText.includes('fabricationRenderPlanForMechanism'),
  'integrated puppet preview consumes full-project scene contracts and gates renderability on the canonical render-plan validation'
);
assert(threeFoundryPreviewText.includes('<FoundryPreviewStateProbe') && foundryPreviewStateProbeText.includes('data-testid="foundry-camera-rig"') && foundryPreviewStateProbeText.includes('data-three-animation-commit-ms'), 'Foundry Three renderer delegates browser telemetry to a probe seam without changing the camera-rig data contract');
assert(threeFoundryPreviewText.includes('createFoundryThreePrimitiveFactory') && threeFoundryPreviewText.includes('disposeFoundryThreeObject') && foundryThreePrimitivesText.includes('export const createFoundryThreePrimitiveFactory') && foundryThreePrimitivesText.includes('addGear') && foundryThreePrimitivesText.includes('addBar') && foundryThreePrimitivesText.includes('export const disposeFoundryThreeObject'), 'Foundry Three renderer delegates primitive mesh/material builders and cached disposal to the primitive factory seam');
assert(threeFoundryPreviewText.includes('renderFoundryDynamicLayers') && foundryThreeRenderLayersText.includes('export const renderFoundryDynamicLayers') && foundryThreeRenderLayersText.includes('renderLinkageLayer') && foundryThreeRenderLayersText.includes('renderGearLayer') && foundryThreeRenderLayersText.includes('foundrySpacerTouchesPin'), 'Foundry Three renderer delegates dynamic layer placement to a shared render-layer helper without changing fabrication z-stack dispatch');
assert(!existsSync(join(process.cwd(), 'components', 'Canvas.tsx')), 'legacy Canvas renderer stays deleted; active views use SceneSketch, ThreePuppetPreview, ThreeFoundryPreview, and blueprint SVG renderers');
assert(exporterText.includes('fabricationGearPathD'), 'blueprint/export gear rendering uses shared fabrication gear geometry');
assert(mechanismLinkagePreviewText.includes('mechanismTopologySummary') && mechanismLinkagePreviewText.includes('data-compiler-topology') && mechanismLinkagePreviewText.includes('compileMechanismGraphFabrication'), 'active Foundry SVG renderer exposes graph compiler topology/buildability telemetry');
assert(mechanismLinkagePreviewText.includes('assemblyCoordRoles') && mechanismLinkagePreviewText.includes('data-compiler-coord-roles') && mechanismLinkagePreviewText.includes('data-compiler-buildable'), 'active Foundry SVG renderer exposes graph compiler assembly coordinate role telemetry');
assert(mechanismLinkagePreviewText.includes('fabricationRingGearPathD') && foundry3dText.includes('fabricationRingGearProfileForPitchRadius'), 'active Foundry/Design renderers use shared ring/sun/planet/carrier gear geometry');
assert(threePreviewText.includes("mechDrive: new THREE.MeshStandardMaterial({ color: '#60a5fa'") && threePreviewText.includes("mechCoupler: new THREE.MeshStandardMaterial({ color: '#60a5fa'") && threePreviewText.includes("mechOutput: new THREE.MeshStandardMaterial({ color: '#60a5fa'"), 'integrated Design/Assembly puppet preview uses the Foundry linkage color instead of a private mechanism palette');
assert(foundryPreviewStacksText.includes('renderPlan.supportPaths.flatMap') && foundryPreviewStacksText.includes('path.orderedLayerIds') && foundryPreviewStacksText.includes('path.pinSpanId'), 'Foundry pin sites consume compiler support paths and exact ordered membership instead of reconstructing A-F stacks');
assert(foundryPreviewStacksText.includes('projectFabricationZMm(span.backFaceMm)') && foundryPreviewStacksText.includes('projectFabricationZMm(span.physicalDepthMm)') && !foundryPreviewStacksText.includes('FABRICATION_RENDER_LAYER_Z_STEP') && !foundryPreviewStacksText.includes('FABRICATION_RENDER_PART_DEPTH'), 'Foundry pin cylinders project exact compiler pin spans without uniform-slot depth inference');
assert(foundry3dText.includes('coplanar-fixed-axles') && foundry3dText.includes('gearPlaneLayerIndexes') && foundry3dText.includes('item.gearPlaneId'), 'Foundry gear coplanarity is enabled only by compiler gear-plane metadata');
assert(foundry3dText.includes('planetary-coplanar-ring-sun-planet') && foundryThreeRenderLayersText.includes('layer.sourceNodeId === "planet-gear"') && !foundryThreeRenderLayersText.includes('/planet|G3|3-space/i'), 'Foundry renders planetary gear members from typed source ids, not mechanism-reference labels');
assert(foundryPreviewStateProbeText.includes('data-three-support-contact-error-count') && foundryPreviewStateProbeText.includes('data-three-support-spacer-error-count') && foundryPreviewStateProbeText.includes('data-three-support-blocker-count'), 'Foundry exposes compiled contact, spacer, and aggregate support blockers');
assert(foundryPreviewStateProbeText.includes('data-three-support-path-ids') && foundryPreviewStateProbeText.includes('data-three-support-path-sources') && foundryPreviewStateProbeText.includes('data-three-support-path-layer-ids') && foundryPreviewStateProbeText.includes('data-three-support-path-pin-spans'), 'Foundry diagnostics expose exact compiler path provenance, membership, and pin spans');
assert(foundryPreviewStateProbeText.includes('data-three-planetary-owner-path-kinds') && foundryPreviewStateProbeText.includes('data-three-planetary-owner-path-faces') && foundryPreviewStateProbeText.includes('data-three-planetary-owner-path-roots'), 'Foundry browser telemetry exposes exact planetary owner-path sequence, faces, and board/free roots');
assert(foundryStageText.includes('foundry-parametric-editor') && mechanismDesignStageText.includes('design-parametric-editor'), 'Foundry and Design both mount the same compact parametric mechanism editor');
assert(mechanismFoundryText.includes('refreshEditedFoundryMechanism') && mechanismFoundryText.includes('return mechanismWithGeneratedPath(normalized') && mechanismFoundryText.includes('resolveFoundryPlaybackTraceAuthority') && !mechanismFoundryText.includes('traceDistanceToGeneratedPath') && !mechanismFoundryText.includes('createPathFittedFoundry({ ...foundry, ...updates }'), 'Foundry parametric edits and display trace cycling keep the structural primary output as the generated path authority');
assert(mechanismParametricEditorText.includes('Drive gear size') && mechanismParametricEditorText.includes('Output gear size') && mechanismParametricEditorText.includes('Paired link length'), 'parametric editor exposes gear and linkage fabrication selectors instead of hidden generic numbers');
assert(mechanismEditAuthorityText.includes('motionSafeParamRange') && mechanismParametricEditorText.includes('data-motion-safe-options') && mechanismParametricEditorText.includes('data-locked-motion-options') && mechanismParametricEditorText.includes('Fit inside board.'), 'parametric editor delegates candidate simulation to runtime edit authority and gives direct fit feedback for unavailable options');
assert(foundryInspectorPanelText.includes('<MechanismParametricEditor') && mechanismDesignStageText.includes('<MechanismParametricEditor') && mechanismParametricEditorText.includes('gearTrainPitchRadii') && mechanismParametricEditorText.includes('defaultCamProfileSamples'), 'Foundry and Design delegate compact parametric gear/link/cam controls to a mechanism stage seam');
assert(foundryStageText.includes('MECHANISM_PARAM_META') && mechanismDesignStageText.includes('MECHANISM_PARAM_META') && mechanismParamPolicyText.includes('shouldShowMechanismParam') && mechanismParamPolicyText.includes('clampMechanismParam'), 'Foundry and Design delegate legacy numeric mechanism parameter policy to a pure mechanism stage helper');
assert(mechanismParamPolicyText.includes('motionSafeParamRange') && mechanismParamPolicyText.includes('clampMechanismParamForMotion') && foundryInspectorPanelText.includes('Fit inside board') && designInspectorPanelText.includes('Fit inside board'), 'Foundry and Design numeric sliders derive visible safe ranges from mechanism simulation and give direct fit feedback');
assert(foundryPreviewGeometryText.includes('export const fittedGearTrainCenters') && foundry3dText.includes('pin-stacks-use-rendered-gear-centers'), 'Foundry 3D gear plates, axles, and spacer stacks share fitted preview gear centers instead of raw mechanism coordinates');
assert(foundry3dText.includes('gearTrainMeshPhaseDegAt') && foundry3dText.includes('alternating-three-quarter-tooth-gap-phase'), 'Foundry 3D gear rendering still exposes mesh phase helpers for inserted idler chains');
assert(physicsSessionText.includes('velocityBetween') && physicsSessionText.includes('forceFromAcceleration'), 'Foundry force/velocity overlays are kinematic estimates, not hidden dynamic rigid-body claims');
assert(assemblySceneFrameText.includes('isBoardFixedCoordRole') && assemblySceneFrameComponentText.includes('data-floating-reference-coords'), 'AssemblySceneFrame separates board-fixed holes from moving reference coordinates');
assert(assemblySceneFrameComponentText.includes('assembly-floating-references') && assemblySceneFrameComponentText.includes('data-active-board-coords'), 'AssemblySceneFrame visualizes moving references as compact callouts without turning them into board holes');
assert(assemblySceneFrameText.includes("boardMode: boardModeForMechanismStep") && !assemblySceneFrameComponentText.includes('<svg'), 'AssemblySceneFrame keeps board state in a pure frame and does not render a second SVG workspace');
assert(!assemblyWorkbenchText.includes('{fabricationPartDisplayLabel(layer.label)}</text>'), 'assembly scene frame does not draw long labels over the board workspace');
assert(assemblySceneFrameComponentText.includes('data-testid="assembly-readonly-step-strip"') && assemblySceneFrameComponentText.includes('data-testid="assembly-visual-progress"'), 'AssemblySceneFrame exposes a compact read-only step strip beside the Three build scene');
assert(!assemblyWorkbenchText.includes('Build module</text>') && !assemblyWorkbenchText.includes('Moving refs</text>'), 'assembly canvas avoids long overlay labels; details stay in inspector/metadata');
assert(threePreviewText.includes('fabricationGearProfileForPitchRadius'), '3D foundry gear rendering uses shared fabrication gear geometry');
assert(threePreviewText.includes('FABRICATION_LINKAGE_WIDTH_3D') && threePreviewText.includes('FABRICATION_HOLE_RADIUS_3D'), '3D puppet mechanism links use centralized fabrication linkage and hole dimensions');
assert(threePreviewText.includes('sharedGeometryCache') && threePreviewText.includes('sharedFabricationGeometry'), '3D puppet preview caches fabrication geometry instead of rebuilding primitive meshes every frame');
assert(threeResourceKitText.includes('export const cachedThreeResource') && threeResourceKitText.includes('export const disposeThreeObjectGraph') && threeResourceKitText.includes('export const setRendererPixelRatioCap'), '3D previews share Three resource cache/disposal/pixel-ratio helpers instead of duplicating renderer plumbing');
{
  const cache = new Map<string, THREE.BufferGeometry>();
  const firstGeometry = cachedThreeResource(cache, 'box', () => new THREE.BoxGeometry(1, 2, 3), 'sharedTestGeometry');
  const secondGeometry = cachedThreeResource(cache, 'box', () => {
    throw new Error('cache miss after cached geometry');
  }, 'sharedTestGeometry');
  assert.equal(secondGeometry, firstGeometry, 'shared Three resource helper reuses cached geometry');
  assert.equal(firstGeometry.userData.sharedTestGeometry, true, 'shared Three resource helper marks reusable resources');

  const keepGeometry = new THREE.BoxGeometry(1, 1, 1);
  keepGeometry.userData.keep = true;
  const disposableGeometry = new THREE.BoxGeometry(1, 1, 1);
  const keepMaterial = new THREE.MeshBasicMaterial();
  keepMaterial.userData.keep = true;
  const disposableMaterial = new THREE.MeshBasicMaterial();
  let disposedGeometryCount = 0;
  let disposedMaterialCount = 0;
  keepGeometry.dispose = () => {
    throw new Error('kept geometry disposed');
  };
  keepMaterial.dispose = () => {
    throw new Error('kept material disposed');
  };
  disposableGeometry.dispose = () => {
    disposedGeometryCount += 1;
  };
  disposableMaterial.dispose = () => {
    disposedMaterialCount += 1;
  };
  const root = new THREE.Group();
  root.add(new THREE.Mesh(keepGeometry, keepMaterial));
  root.add(new THREE.Mesh(disposableGeometry, disposableMaterial));
  disposeThreeObjectGraph(root, {
    keepGeometry: geometry => Boolean(geometry.userData.keep),
    keepMaterial: material => Boolean(material.userData.keep)
  });
  assert.equal(disposedGeometryCount, 1, 'shared Three disposal helper disposes unmarked geometry');
  assert.equal(disposedMaterialCount, 1, 'shared Three disposal helper disposes unmarked material');

  const group = new THREE.Group();
  const child = new THREE.Group();
  group.add(child);
  let clearedChildCount = 0;
  clearThreeGroup(group, () => {
    clearedChildCount += 1;
  });
  assert.equal(group.children.length, 0, 'shared Three group helper removes children');
  assert.equal(clearedChildCount, 1, 'shared Three group helper delegates child disposal');

  const previousWindow = (globalThis as { window?: unknown }).window;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: WEBGL_PIXEL_RATIO_CAP + 10 } });
    let pixelRatio = 0;
    setRendererPixelRatioCap({ setPixelRatio: (value: number) => { pixelRatio = value; } } as unknown as THREE.WebGLRenderer);
    assert.equal(pixelRatio, WEBGL_PIXEL_RATIO_CAP, 'shared Three pixel-ratio helper caps device pixel ratio');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  }
}
assert(!threePreviewText.includes('scene.traverse(child =>'), '3D puppet preview does not traverse the whole scene every animation frame for telemetry');
assert.equal(threePreviewText.includes('const renderedMechanisms = mechanismsToRender') && threePreviewText.includes('data-three-selected-mechanism-id') && threePreviewText.includes('data-three-rendered-mechanism-ids') && threePreviewText.includes('data-three-mechanism-generated-path-counts'), true, '3D puppet preview renders active mechanisms and exposes mechanism ids/generated path counts so Assembly can prove fitted-mechanism continuity');
assert(threePreviewText.includes('foundryPinStackPoints(renderPlan') && threePreviewText.includes('foundryPinStacks(') && threePreviewText.includes('site.centerZ') && threePreviewText.includes('site.lengthZ'), '3D puppet mechanism pins consume compiler support paths and exact pin spans');
assert(!threePreviewText.includes('FABRICATION_RENDER_LAYER_Z_STEP') && !threePreviewText.includes('boardToMovingZ') && !threePreviewText.includes('pinSpanForZ') && !threePreviewText.includes('zLayer('), '3D puppet preview contains no private uniform-slot, label, or pin-span Z reconstruction');
assert(mechanismDesignText.includes('<DesignFoundryPreview') && designFoundryPreviewText.includes('export const DesignFoundryPreview') && designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"'), 'Mechanism Design owns a thin automata preview adapter instead of a separate legacy renderer');
assert(designFoundryPreviewText.includes('<ThreeFoundryPreview') && !designFoundryPreviewText.includes('<ThreePuppetPreview') && !designFoundryPreviewText.includes('design-foundry-context-layer') && designFoundryPreviewText.includes('automataContext={automataContext}') && foundryCanvasPaneText.includes('<ThreeFoundryPreview'), 'Design renders mechanism plus character/object context inside the same Foundry Three scene instead of a parallel puppet overlay');
assert(designFoundryPreviewText.includes('data-renderer-source="ThreeFoundryPreview"') && designFoundryPreviewText.includes('data-shared-with="foundry-renderer"') && designFoundryPreviewText.includes('data-design-scene-mode="single-foundry-automata-scene"') && designFoundryPreviewText.includes('data-automata-model-source="buildAutomataSceneModel"'), 'Mechanism Design advertises single-scene Foundry-renderer mechanism truth with automata telemetry');
assert(automataSceneModelText.includes('mechanismFeature(activeMechanism.type)') && automataSceneModelText.includes('const activeMechanisms = runtimeMechanisms(project, authoredMechanisms)') && automataSceneModelText.includes('const activeMechanism = activeMechanisms.find') && automataSceneModelText.includes("selectedGate?.projection === 'static-recovery'") && automataSceneModelText.includes('recoveryMechanism: authoredCandidate') && automataSceneModelText.includes('const mechanisms = activeMechanisms;') && !automataSceneModelText.includes('normalizeAuthoredMechanismToFabricationSet') && !automataSceneModelText.includes('activeMechanisms.length ? activeMechanisms : [activeMechanism]') && automataSceneModelText.includes('const fullMotionPreview = motionPreviewForProject(project, mechanisms, angle)') && automataSceneModelText.includes('const selectedMotionPreview = motionPreviewForProject(project, [activeMechanism], angle)'), 'Automata scene model gates the authoritative ProjectState mechanisms and keeps an invalid selection in static recovery without renormalizing or reinserting it into motion');
assert(foundry3dText.includes('const placeFoundryLocalGroup') && foundry3dText.includes('group.rotation.z = (-transform.rotation * Math.PI) / 180') && foundry3dText.includes('const placeSceneLocalGroup') && foundry3dText.includes('group.rotation.z = (transform.rotation * Math.PI) / 180'), 'Foundry keeps y-down fit-space rotations separate from scene-preserving automata rotations');
assert(foundryPreviewModelText.includes("frame: 'fit' | 'scene' = 'fit'") && automataSceneModelText.includes("'scene'") && !foundryPreviewModelText.includes('normalizeAuthoredMechanismToFabricationSet'), 'Design/Assembly automata previews request the scene-preserving Foundry preview frame from authoritative ProjectState geometry instead of re-fitting or renormalizing the character scene');
assert(foundry3dText.includes('data-three-stack-source') && designFoundryPreviewText.includes('data-foundry-feature-label') && designFoundryPreviewText.includes('data-foundry-feature-issue-count'), 'Mechanism Design exposes Foundry feature provenance for browser verification');
assert(!appText.includes('<Canvas project={project} config={mechanismConfig}'), 'Mechanism Design no longer mounts the legacy 2D design canvas mechanism renderer');
assert(exporterText.includes('fabricationGearPathD'), 'SVG export gear rendering uses shared fabrication gear geometry');
assert(foundry3dText.includes('fabricationGearProfileForPitchRadius'), 'Foundry gear helper uses shared fabrication gear holes/profile');
assert(foundry3dText.includes('validateMechanismPreviewReadiness'), 'Foundry gates standalone 3D previews through shared physical/fabrication readiness validation');
assert(foundry3dText.includes('data-three-physical-validation-errors'), 'Foundry exposes physical readiness errors for browser verification');
assert(foundry3dText.includes('validateMechanismPreviewReadiness') && automataSceneModelText.includes('buildFoundryMechanismPreviewModel') && designFoundryPreviewText.includes('data-design-foundry-contract-source="buildAutomataSceneModel"'), 'Mechanism Design readiness and preview state now route through the shared automata scene model and Foundry preview model/renderer seam');
assert(foundry3dText.includes('const automataBaseZ =') && foundry3dText.includes('viewerTab === "design" && !assemblySceneFrame') && foundry3dText.includes('AUTOMATA_DESIGN_SURFACE_CLEARANCE_Z') && foundry3dText.includes('data-three-automata-surface-clearance') && !foundry3dText.includes('baseZ: pinTopZ + 0.16'), 'Mechanism Design places character art on a computed non-exploded automata plane instead of a hard-coded lifted layer');
assert(automataSceneModelText.includes('buildFoundryMechanismPreviewModel') && designFoundryPreviewText.includes('buildAutomataSceneModel') && assemblyThreePreviewText.includes('buildAutomataSceneModel') && foundryPreviewModelText.includes('createFoundryPlaybackFrame') && foundryPreviewModelText.includes('generateFoundryPlaybackPointTraces') && !designFoundryPreviewText.includes('generateMechanismPointTraces') && !assemblyThreePreviewText.includes('generateMechanismPointTraces') && !assemblyThreePreviewText.includes('fitMechanismSimulationWithContext'), 'Mechanism Design and Assembly derive preview motion from the shared Foundry preview model instead of private legacy simulation paths');
assert(assemblyThreePreviewText.includes('viewerTab="assembly"') && assemblyThreePreviewText.includes('automataContext={automataContext}') && assemblyThreePreviewText.includes('data-assembly-one-scene-automata'), 'Assembly labels the viewer as Assembly and can render character/object context inside the shared Foundry mechanism scene');
assert(!automataSceneModelText.includes('firstVisiblePath'), 'Automata scene model does not silently pick a different first-visible path than Foundry when no explicit/selected path exists');
assert(designAutomataProjectionText.includes('buildAutomataSceneModel') && !designAutomataProjectionText.includes('motionPreviewForProject') && !designAutomataProjectionText.includes('mechanismFeature('), 'Legacy Design projection file is a thin compatibility wrapper around the canonical automata scene model');
{
  const fixture = createLessonProject('waving-arm');
  const lessonMechanism = fixture.mechanisms[0]!;
  const fittedPath = fixture.paths['path-right-arm'];
  const fittedMechanism = {
    ...lessonMechanism,
    generatedPath: Array.from({ length: 96 }, (_, index) => pointOnProjectPath(fittedPath, (index / 96) * Math.PI * 2))
  };
  const fittedFixture = { ...fixture, mechanisms: [fittedMechanism] };
  const canonical = buildAutomataSceneModel(fittedFixture, fittedMechanism, Math.PI * 0.42, 'design-live');
  const compat = buildDesignAutomataProjection(fittedFixture, fittedMechanism, Math.PI * 0.42);
  assert.equal(compat.foundryPreview?.mechanism.id, canonical.foundryPreview?.mechanism.id, 'Design compatibility wrapper returns the same Foundry mechanism instance as the canonical automata model');
  assert.equal(compat.foundryPreview?.previewPoints.length, canonical.foundryPreview?.previewPoints.length, 'Design compatibility wrapper returns the same Foundry preview trace as the canonical automata model');
  assert.equal(canonical.userPath?.id, 'path-right-arm', 'Canonical automata model uses the explicit/selected path for fitted previews');
  assert.equal(canonical.motionSource, 'generatedPath', 'Canonical automata model drives the scene from the generated mechanism path when a fitted path exists');
  assert.equal(canonical.pathFitStatus, 'fit', 'Canonical automata model accepts generated paths only after they stay near the authored path');
  assert.equal(canonical.mechanismContract?.compilerSource, 'mechanismCompiler', 'Canonical automata model exposes graph compiler telemetry through the scene contract');
  assert.equal(canonical.mechanismContract?.graphCompiler.graphId, `${fittedMechanism.id}:graph`, 'Canonical automata model keeps graph identity aligned with the mechanism instance');
  assert(canonical.generatedTarget && canonical.target, 'Canonical automata model exposes both generated mechanism output and selected IK target');
  assert((canonical.targetError ?? Number.POSITIVE_INFINITY) < 1e-9, 'Canonical automata model keeps the selected IK target attached to the generated mechanism output');
  const drivenHand = canonical.animatedParts.right_hand_part;
  assert(drivenHand && canonical.generatedTarget && canonical.skeleton, 'Canonical automata model animates the hand target part through IK');
  const handPivot = bodyPartPivotScene(drivenHand, canonical.skeleton);
  assert(Math.hypot(handPivot.x - canonical.generatedTarget!.x, handPivot.y - canonical.generatedTarget!.y) < 1e-6, 'Driven hand part pivot stays on the fitted mechanism output in scene coordinates');
  const staleLessonMechanism = {
    ...lessonMechanism,
    generatedPath: (lessonMechanism.generatedPath ?? []).map(point => ({ x: point.x + 300, y: point.y }))
  };
  const mismatchFixture = { ...fixture, mechanisms: [staleLessonMechanism] };
  const mismatch = buildAutomataSceneModel(mismatchFixture, staleLessonMechanism, Math.PI * 0.42, 'design-live');
  assert.equal(mismatch.motionSource, 'generatedPath', 'Design keeps attached character motion on the actual rendered mechanism source when path fit is mismatched');
  assert.equal(mismatch.pathFitStatus, 'mismatch', 'Design flags stale generatedPath samples that are far from the authored path');
  assert((mismatch.pathFitError ?? 0) > (mismatch.pathFitThreshold ?? Number.POSITIVE_INFINITY), 'Design exposes the stale generatedPath fit error for harnesses and UI warnings');
  const actualGeneratedTarget = pointOnGeneratedMechanismPath(staleLessonMechanism.generatedPath ?? [], Math.PI * 0.42);
  assert(mismatch.target && actualGeneratedTarget, 'Mismatch preview keeps an actual generated mechanism target');
  assert((mismatch.targetError ?? Number.POSITIVE_INFINITY) < 1e-9, 'Mismatch telemetry keeps the selected IK target attached to the generated mechanism output');
  assert(Math.hypot(mismatch.target!.x - actualGeneratedTarget!.x, mismatch.target!.y - actualGeneratedTarget!.y) < 1e-6, 'Mismatch preview keeps the driven target on the rendered mechanism path');
  assert(mismatch.warnings[staleLessonMechanism.id]?.includes('Fit path before attaching the character.'), 'Mismatch remains a warning instead of changing the motion source');
  const mismatchDrivenHand = mismatch.animatedParts.right_hand_part;
  assert(mismatchDrivenHand && mismatch.skeleton, 'Mismatch preview still animates the target part through IK');
  const mismatchHandPivot = bodyPartPivotScene(mismatchDrivenHand, mismatch.skeleton);
  assert(Math.hypot(mismatchHandPivot.x - actualGeneratedTarget!.x, mismatchHandPivot.y - actualGeneratedTarget!.y) < 1e-6, 'Mismatch preview drives the character from the generated mechanism target');
  const sceneFit = createSceneMechanismFitContext(fittedMechanism, 360, 240, 96);
  const sceneOrigin = sceneFit.map({ x: 0, y: 0 });
  const sceneUp = sceneFit.map({ x: 0, y: 100 });
  assert(sceneUp.y < sceneOrigin.y, 'Scene-preserving Foundry preview keeps positive scene Y visually upward instead of flipping Character/Path composition');
  const firstUserPoint = fixture.paths['path-right-arm'].points[0]!;
  const firstPreviewPoint = canonical.foundryPreview!.userPathPoints[0]!;
  const firstScenePoint = sceneFit.map(firstUserPoint);
  assert(Math.hypot(firstPreviewPoint.x - firstScenePoint.x, firstPreviewPoint.y - firstScenePoint.y) < 1e-9, 'Design Foundry preview maps the user path through the fixed scene frame instead of centering it independently');
  const noSelectedPathProject = {
    ...fittedFixture,
    selectedPathId: undefined,
    mechanisms: [{ ...fittedMechanism, targetPathId: undefined }],
  };
  const noFallback = buildAutomataSceneModel(noSelectedPathProject, noSelectedPathProject.mechanisms[0], 0, 'design-live');
  assert.equal(noFallback.userPath, undefined, 'Canonical automata model does not fall back to an unrelated visible path when Foundry would have no active path');
}
assert(threePreviewText.includes('normalizeCamProfileSamples') && threePreviewText.includes('data-cam-profile={selectedCamProfile}') && workflowSpecText.includes('Mechanism Design cam profile edits update the integrated automata preview'), 'Mechanism Design exposes shared cam profile telemetry and browser coverage proves Design-side edits reach the integrated automata preview');
assert(designFoundryPreviewText.includes('data-testid="design-editor-toolbar"') && designFoundryPreviewText.includes('data-testid={`design-tool-${tool}`}') && designFoundryPreviewText.includes('data-design-viewer-tool={viewerTool}') && designFoundryPreviewText.includes('className="design-view-controls"') && designFoundryPreviewText.includes('design-toggle-user-path') && designFoundryPreviewText.includes('design-toggle-mechanism-path') && indexText.includes('.design-editor-toolbar') && indexText.includes('.design-view-controls'), 'Mechanism Design separates compact Move/Rotate/Zoom editor tools from right-side view/path controls');
assert(mechanismRecommendationsText.includes('.filter((option) => option.accepted)'), 'Foundry recommendations filter candidates rejected by the shared automatic Fit authority before they can be offered');
assert(mechanismRecommendationsText.includes('const initialMechanism = createRecommendedMechanism(') && mechanismRecommendationsText.includes('fitRecommendedMechanismToSheet(') && mechanismRecommendationsText.includes('readyMechanismFallbackForPath('), 'mechanism recommendations retry with a sheet-fitted fabrication-ready fallback before hiding a candidate');
assert(!mechanismRecommendationsText.includes('fitMechanismGeneratedPathToPath') && !designFoundryPreviewText.includes('fitMechanismGeneratedPathToPath') && !appText.includes('fitMechanismGeneratedPathToPath'), 'mechanism recommendations must not center-shift physical templates away from hole-snapped anchors');
assert(mechanismRecommendationsText.includes('normalizeGearMeshMechanism(') && mechanismRecommendationsText.includes('normalizeMechanismToReference(tuned)'), 'mechanism recommendations pass through fabrication-set normalization before fitting to the sheet');
assert(mechanismRecommendationsText.includes('previousAnchor') && mechanismRecommendationsText.includes('gridPitchMm * SCENE_PX_PER_MM'), 'recommendation sheet fitting nudges by whole board holes when a sub-hole correction snaps back to the same invalid anchor');
assert(projectText.includes('normalizeMechanismToFabricationSet({') && projectText.includes('resolveMechanismEditAttempt(') && projectText.includes('invalidateOrphanedMechanisms(') && !projectText.includes('const reconcileMechanismTargets'), 'ProjectState reducers validate direct edits atomically and preserve external orphan references without silent target reconciliation');
assert(mechanismRecommendationsText.includes('localizeFittedMechanismAnchor') && mechanismRecommendationsText.includes('maxDistance = 120'), 'Foundry export preserves the picked board anchor locality when fitting a mechanism to a path');
assert(!appText.includes('A-D-ground-links-coplanar'), '4bar previews no longer collapse ground/output links into one impossible z plane');
assert(foundry3dText.includes('fabrication-stack-separated'), '4bar previews keep fabrication stack-separated z order in Foundry and Design');
assert(mechanismLinkagePreviewText.includes('FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM') && mechanismLinkagePreviewText.includes('FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM'), 'Foundry 2D mechanism plates use centralized fabrication linkage and hole dimensions');
assert(mechanismLinkagePreviewText.includes('fabricationRingGearPathD'), '2D Foundry planetary preview uses shared ring gear geometry');
assert(foundry3dText.includes('fabricationRingGearProfileForPitchRadius'), '3D Foundry ring uses shared fabrication ring gear geometry');
assert(workspacePlaybackLoopHookText.includes('SHARED_PLAYBACK_STAGES') && workspacePlaybackLoopHookText.includes('!SHARED_PLAYBACK_STAGES.includes(stage)') && workspacePlaybackLoopHookText.includes('requestAnimationFrame(tick)') && workspacePlaybackLoopHookText.includes('animationDeltaRadians') && workspacePlaybackLoopHookText.includes('stage !== "path" && drawMode'), 'shared playback rAF and Path draw reset only run from the extracted workspace playback loop hook');
assert(appText.includes('useWorkspacePlaybackLoop({') && !appText.includes('requestAnimationFrame(') && !appText.includes('animationDeltaRadians('), 'App delegates shared playback timing to useWorkspacePlaybackLoop without owning animation-frame math');
assert(modalInertHookText.includes('setAttribute("inert", "")') && modalInertHookText.includes('aria-hidden') && modalInertHookText.includes('welcome-modal-open') && appText.includes('useModalInertEffect(appShellRef, modalOpen)') && !appText.includes('document.documentElement.classList.add("welcome-modal-open")') && !appText.includes('useEffect, useRef'), 'App delegates startup/help/about modal inert DOM side effects to useModalInertEffect');
assert(appText.includes('STARTER_IMAGE_TEMPLATES') && !appText.includes('girl.png?url') && starterImageTemplatesText.includes('girl.motionsmith.json?url') && starterImageTemplatesText.includes('boy.motionsmith.json?url') && starterImageTemplatesText.includes('girl-thumb.png?url') && starterImageTemplatesText.includes('boy-thumb.png?url') && !starterImageTemplatesText.includes('examples/raw'), 'App delegates AI-free starter packages and thumbnails to resources/starterImageTemplates without bundling full-size source art');
assert(appText.includes('useAppPathActions({') && !appText.includes('const setPathPoints =') && !appText.includes('setShowTracking(false);\n    setStage("path")') && appPathActionsHookText.includes('validatePath') && appPathActionsHookText.includes('ProjectMotionPath["source"] = "drawn"') && appPathActionsHookText.includes('setPathPoints(path, "tracked")') && appPathActionsHookText.includes('setStage("path")'), 'App delegates Path draw/tracking actions to useAppPathActions while preserving validated drawn/tracked path upserts');
assert(appPathActionsHookText.includes('closed: current?.closed ?? true'), 'new drawn/tracked paths default to closed loops while preserving existing open paths');
const pathWorkflowPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PathWorkflowPanel.tsx'), 'utf8');

const assertMotionFitSourceContracts = () => {
  const foundryCameraClickThrough =
    indexText.includes('.foundry-camera-hud { pointer-events: none; }') &&
    indexText.includes('.foundry-camera-hud button { pointer-events: auto; }') &&
    indexText.includes('flex-wrap: nowrap; justify-content: flex-start') &&
    indexText.includes('overflow-x: auto; overflow-y: hidden');
  assert.equal(foundryCameraClickThrough, true, 'Foundry camera HUD background clicks pass through to the 3D pick/orbit surface while the buttons remain clickable');

  const foundrySplitPathControls =
    foundryCanvasChromeText.includes('data-testid="foundry-toggle-user-path"') &&
    foundryCanvasChromeText.includes('User path') &&
    foundryCanvasChromeText.includes('Mech path') &&
    foundryCanvasPaneText.includes('data-user-path-preview') &&
    foundryCanvasPaneText.includes('data-mechanism-path-preview') &&
    foundryCanvasPaneText.includes('data-user-path-basis="mechanism-fit-context"') &&
    foundryCanvasPaneText.includes('data-user-to-mech-fit-error') &&
    foundryCanvasPaneText.includes('data-testid="foundry-user-path-overlay"') &&
    mechanismFoundryText.includes('selectedPath?.points.map(foundryFitContext.map)') &&
    foundryPreviewStateProbeText.includes('data-three-primary-path-bounds');
  assert.equal(foundrySplitPathControls, true, 'Foundry separates the drawn user path from the generated mechanism path in the same fit-context coordinate basis so students can compare fit before applying the mechanism');

  const designGeneratedPathMotion =
    automataSceneModelText.includes('const fullMotionPreview = motionPreviewForProject(project, mechanisms, angle)') &&
    automataSceneModelText.includes('const selectedMotionPreview = motionPreviewForProject(project, [activeMechanism], angle)') &&
    automataSceneModelText.includes('generatedTarget && selectedMotionPreview.target') &&
    automataSceneModelText.includes("? 'generatedPath'") &&
    !automataSceneModelText.includes("'userPath-fallback'") &&
    designFoundryPreviewText.includes('data-design-motion-source={sceneModel.motionSource}') &&
    designFoundryPreviewText.includes('data-design-path-fit-status={sceneModel.pathFitStatus}') &&
    designFoundryPreviewText.includes('data-design-target-error') &&
    designFoundryPreviewText.includes('data-design-target-x') &&
    designFoundryPreviewText.includes('data-design-animated-part-count');
  assert.equal(designGeneratedPathMotion, true, 'Mechanism Design drives fitted and mismatched mechanisms from generatedPath while keeping mismatch as telemetry/warning only');

  const puppetMechanismContinuity =
    threePreviewText.includes('data-three-selected-mechanism-generated-path-count') &&
    threePreviewText.includes('data-three-rendered-mechanism-ids') &&
    threePreviewText.includes('data-three-mechanism-generated-path-counts');
  assert.equal(puppetMechanismContinuity, true, '3D puppet preview exposes mechanism identity and generatedPath counts so Blueprint/Assembly continuity can be verified after fitting');

  const pathEditorHarnessTelemetry =
    pathWorkflowPanelText.includes('data-point-count={pointCount}') &&
    pathWorkflowPanelText.includes('data-draw-mode={drawMode ? "drawing" : "idle"}');
  assert.equal(pathEditorHarnessTelemetry, true, 'Path Editor keeps compact visible copy while exposing free-draw point telemetry for browser harnesses');

  const assemblyFittedMechanismContinuity =
    assemblyGuideModelText.includes('project.selectedMechanismId') &&
    assemblyCanvasPaneText.includes('buildMechanismAssemblySceneFrame') &&
    assemblyThreePreviewText.includes('data-mechanism-scene-contract-mechanism-id={sceneFrame.mechanismContract?.mechanismId') &&
    assemblyThreePreviewText.includes('assemblySceneFrame={sceneFrame}') &&
    assemblyThreePreviewText.includes('buildAutomataSceneModel') &&
    assemblyThreePreviewText.includes('automataContext={automataContext}') &&
    assemblyThreePreviewText.includes('ThreeFoundryPreview') &&
    threeFoundryPreviewText.includes('assemblySceneFrame?: FoundryAssemblySceneFrame') &&
    threeFoundryPreviewText.includes('renderFoundryAssemblySceneOverlay') &&
    foundryThreeRenderLayersText.includes('foundryAssemblyLayerState') &&
    foundryPreviewStateProbeText.includes('data-three-assembly-scene') &&
    foundryAssemblySceneOverlayText.includes('boardCoordToPreviewPoint') &&
    !assemblyThreePreviewText.includes('assembly-character-context-ghost');
  assert.equal(assemblyFittedMechanismContinuity, true, 'Assembly defaults to the selected fitted mechanism and drives the shared Three scene contract without a nested character ghost or SVG fallback');
};
assertMotionFitSourceContracts();
assert.equal(pathWorkflowPanelText.includes('Choose mechanism'), false, 'Path Editor omits the old choose-mechanism button from the left workflow pane');
assert(pathWorkflowPanelText.includes('aria-label="Motion target"') && pathWorkflowPanelText.includes('<optgroup label="Body parts">') && pathWorkflowPanelText.includes('<optgroup label="Scene objects">'), 'Path target selector labels mixed body/object targets honestly');
assert(designInspectorPanelText.includes('aria-label="Mechanism target"') && designInspectorPanelText.includes('<optgroup label="Body parts">') && designInspectorPanelText.includes('<optgroup label="Scene objects">'), 'Design target selector labels mixed body/object mechanism targets honestly');

assert(appText.includes('useAppCharacterImportActions({') && !appText.includes('const runWebOnnx =') && !appText.includes('const importCharacterPackage =') && !appText.includes('const importProject =') && !appText.includes('const acceptPendingCharacter =') && appCharacterImportActionsHookText.includes('createProjectFromProcessed') && appCharacterImportActionsHookText.includes('processImageWithWebOnnx') && appCharacterImportActionsHookText.includes('loadCharacterPackage') && appCharacterImportActionsHookText.includes('loadProjectSnapshot') && appCharacterImportActionsHookText.includes('setFoundry(foundryPreviewFromProject(loadedProject))') && appCharacterImportActionsHookText.includes('setProject(pendingCharacter.project, { resetHistory: true })') && appCharacterImportActionsHookText.includes('returnStage: "character"'), 'App delegates character import/review actions to useAppCharacterImportActions while keeping imported project and Foundry state coupled');
assert(workspacePlayerDockHookText.includes('const showsWorkspacePlayer =') && workspacePlayerDockHookText.includes('editorStage === "path"') && workspacePlayerDockHookText.includes('editorStage === "design"') && workspacePlayerDockHookText.includes('editorStage === "assembly"'), 'shared playback dock is restricted to Path, Mechanism Design, and Assembly instead of leaking onto unrelated tabs');
assert(appText.includes('useWorkspacePlayerDock') && !appText.includes('<WorkspacePlayerDock') && !appText.includes('const [assemblyPlaying'), 'App delegates shared player dock assembly and Assembly dock state to useWorkspacePlayerDock');
assert(workspacePlayerDockHookText.includes('setAssemblyStepProgress(0)') && workspacePlayerDockHookText.includes('onStepChange: goSharedAssemblyStep'), 'workspace player dock owns Assembly previous/next step handoff and scrubber reset');
assert(appUiText.includes('workspace-player-prev-step') && appUiText.includes('workspace-player-next-step') && appUiText.includes('Assembly scrubber'), 'shared playback dock owns Assembly previous/next step controls and scrubber');
assert(!`${appText}
${mechanismDesignStageText}
${designFoundryPreviewText}`.includes('data-testid="design-foundry-playback-hud"'), 'Mechanism Design uses the shared workspace player instead of a duplicate local playback HUD');
assert(foundry3dText.includes('FOUNDRY_ANIMATION_COMMIT_MS') && foundry3dText.includes('data-three-animation-commit-ms'), 'Foundry exposes a bounded animation commit budget for browser perf tests');
assert(foundry3dText.includes('time - (elapsed % FOUNDRY_ANIMATION_COMMIT_MS)'), 'Foundry playback carries requestAnimationFrame remainder instead of dropping animation time under load');
assert(foundry3dText.includes("scene.remove(old)") && foundry3dText.includes("disposeFoundryThreeObject(old)"), 'Foundry disposes noncached dynamic resources when replacing animation groups');
assert(foundry3dText.includes('geometryCacheRef') && foundry3dText.includes('materialCacheRef'), 'Foundry caches reusable Three geometry/material resources during playback');
assert(foundry3dText.includes('foundryCached') && foundry3dText.includes('data-three-geometry-cache-size'), 'Foundry tags cached resources and exposes cache size for browser perf tests');
assert(foundry3dText.includes('automata-texture:') && foundry3dText.includes('map?.dispose()'), 'Foundry reuses character/object texture materials across dynamic rebuilds and disposes their cached GPU maps on unmount');
assert(foundry3dText.includes('const addPath = (points: Point[], z: number, mat: THREE.Material)') && foundry3dText.includes('new THREE.BufferGeometry().setFromPoints') && foundry3dText.includes('points.map((point) => to3(point, z))'), 'Foundry path/trail line geometry is intentionally not long-cached because it can be phase-dependent');
assert(mechanismPreviewText.includes('sweepBounds') && foundry3dText.includes('data-three-fit-bounds=\"phase-invariant-sweep\"'), 'Foundry fitting bounds are sampled in the shared preview utility instead of jittering per animation frame');
assert(foundry3dText.includes('data-three-static-grid-mode=\"persistent-scene-layer\"'), 'Foundry grid and plane live in a persistent scene layer, not the per-frame dynamic group');
assert(mechanismPreviewText.includes('export const fitMechanismSimulation'), 'Foundry fitting/sweep simulation lives in the mechanism preview utility, not as stage-local UI code');
assert(mechanismPreviewText.includes('createMechanismFitContext') && foundry3dText.includes('createMechanismFitContext(') && foundry3dText.includes('selectedPath?.points ?? []'), 'Foundry caches phase-invariant fit bounds and includes the user path in the same fitted coordinate basis');
const foundryCardMechanism = createDefaultMechanism('4bar', 'foundry-card-contract');
const foundryCardContext = createMechanismFitContext(foundryCardMechanism, 180, 96, 96);
const foundryCardSimulation = fitMechanismSimulationWithContext(foundryCardMechanism, 0.75, foundryCardContext);
assert.deepEqual(foundryCardSimulation.pathPoints, foundryCardContext.pathPoints, 'Foundry card previews can reuse the shared fit context path instead of direct per-card resampling');
assert(foundry3dText.includes('buildFoundryPhysicsOverlay') && physicsSessionText.includes('export const buildFoundryPhysicsOverlay'), 'Foundry force/velocity/constraint overlay math lives in PhysicsSession, not the React stage');
assert(foundry3dText.includes('const range = useMemo(') && foundry3dText.includes('() => sampleFeasibleRange(landedFoundry, 96, project.settings.physicalKit)') && foundry3dText.includes('[landedFoundry, project.settings.physicalKit]'), 'Foundry feasible-range sampling is memoized by mechanism and active kit, not re-run on every animation render');
assert(viewportText.includes('WEBGL_PIXEL_RATIO_CAP') && foundry3dText.includes('WEBGL_PIXEL_RATIO_CAP') && threePreviewText.includes('WEBGL_PIXEL_RATIO_CAP'), 'WebGL renderer pixel ratio cap is shared across Foundry and puppet previews');
assert(threePreviewText.includes("const PUPPET_CAMERA_PRESETS: Viewer3DCameraPreset[] = ['front', 'iso']"), 'puppet viewer toolbar exposes only the fixed 2D and orbitable 3D modes');
assert(threePreviewText.includes('onWheel={handleViewerWheel}') && threePreviewText.includes('data-camera-yaw'), 'puppet 3D canvas exposes direct wheel zoom and orbit state for browser verification');
assert(appStageRouterText.includes('<PathEditor') && !appText.includes('<PathEditor'), 'AppStageRouter delegates Path Editor stage to the extracted PathEditor seam');
assert(appWorkspaceShellText.includes('<MechanismRecommendationSheet') && mechanismRecommendationSheetText.includes('buildMechanismRecommendations') && mechanismRecommendationSheetText.includes('mechanismWithGeneratedPath'), 'AppWorkspaceShell mounts the Path recommendation modal while recommendation scoring and generated-path wrapping stay outside the app shell');
assert(mechanismRecommendationSheetText.includes('RecommendationFitPreview') && mechanismRecommendationSheetText.includes('<MechanismLinkagePreview') && mechanismRecommendationSheetText.includes('data-board-cells') && mechanismRecommendationSheetText.includes('data-user-path-preview') && mechanismRecommendationSheetText.includes('data-mechanism-path-preview'), 'recommendation modal previews board fit with user path, fitted mechanism path, and the actual front-view mechanism');
assert(pathCanvasPaneText.includes('path-view-2d') && pathCanvasPaneText.includes('path-view-3d'), 'Path Editor exposes a persistent 2D/3D Path view switch');
assert(pathCanvasPaneText.includes('pathViewMode === "2d"') && pathCanvasPaneText.includes('<SceneSketch'), 'Path Editor 2D view uses editable SceneSketch for viewing, drawing, and point editing');
assert(sceneSketchText.includes('data-testid="path-canvas"'), 'SceneSketch owns the editable 2D path canvas');
assert(pathCanvasPaneText.includes('<ThreePuppetPreview') && pathCanvasPaneText.includes('testId="path-three-puppet"'), 'Path Editor 3D view uses ThreePuppetPreview');
assert(pathCanvasPaneText.includes('mechanisms={[]}'), 'Path Editor explicitly hides mechanism geometry so the tab shows only character plus path');
assert(pathCanvasPaneText.includes('paths={selectedPath ? [selectedPath] : []}') && pathCanvasPaneText.includes('selectedPathId={selectedPath?.id}'), 'Path Editor 3D passes the selected editable path into the shared 3D preview');
assert(threePreviewText.includes('paths?: ProjectMotionPath[]') && threePreviewText.includes('pathsLayer') && threePreviewText.includes('path-line-'), 'ThreePuppetPreview renders path geometry as a real 3D layer');
assert(threePreviewText.includes('data-layer-paths={viewer3DLayerDataValue(pathsToRender.length > 0)}'), '3D puppet state exposes the visible path layer when Path Editor passes one');
assert(pathCanvasPaneText.includes('cameraPresets={["iso"]}'), 'Path Editor 3D preview hides the preview-only 2D camera preset so editable 2D has one owner');
assert(!pathCanvasPaneText.includes('drawMode ? <SceneSketch'), 'Draw mode does not mount a special duplicate drawing canvas; it only forces the 2D Path view');
assert(pathEditorText.includes('setPathViewMode("2d")'), 'Starting free-path drawing forces Path view back to 2D');
assert(indexText.includes('bottom: calc(var(--ms-bottom-bars-height) + 10px)') && !indexText.includes('--ms-status-bar-height'), 'character import status dock floats 10px above the bottom status area instead of covering the canvas');
assert(indexText.includes('.stage-player-row { position: absolute;') && appUiText.includes('data-testid="workspace-player-drag-handle"'), 'shared animation dock is an overlay with a draggable handle instead of a layout row');
assert(foundry3dText.includes('data-three-pixel-ratio-cap') && threePreviewText.includes('data-three-pixel-ratio-cap'), '3D previews expose the pixel-ratio cap for browser performance checks');
assert.equal(WEBGL_PIXEL_RATIO_CAP, 1.5, 'WebGL pixel-ratio cap avoids high-DPI overdraw while preserving sharp CAD-style previews');
assert(!foundry3dText.includes('starShape'), 'Foundry sandbox no longer carries saw-tooth star gears');
assert(!foundry3dText.includes('teeth * 2'), 'Foundry sandbox no longer carries sparse saw-tooth gear implementation');
assert(/if \(key === ['"]gearRatio['"]\) return false/.test(mechanismParamPolicyText), 'Foundry hides stale gear-ratio controls when physical pitch radii define rotation');
assert(/if \(type === ['"]cam['"]\) return false/.test(mechanismParamPolicyText), 'Foundry/Design hide generic cam dimensions because the cam module is fixed except for profile shape');
assert(/if \(type === ['"]piston['"]\) return false/.test(mechanismParamPolicyText), 'Foundry/Design hide generic piston dimensions because the slider-crank module is fixed');
assert(/if \(type === ['"]planetary_gear['"]\) return key === ['"]phase['"]/.test(mechanismParamPolicyText), 'Foundry/Design hide non-effective planetary dimensions while keeping phase');
const fitContext = createMechanismFitContext(sample.mechanisms[0], 360, 240, 96);
const directFit = fitMechanismSimulation(sample.mechanisms[0], 1.234, 360, 240, 96);
const cachedFit = fitMechanismSimulationWithContext(sample.mechanisms[0], 1.234, fitContext);
assert.deepEqual(cachedFit.pathPoints, directFit.pathPoints, 'cached Foundry fit preserves the direct preview path exactly');
assert(Math.hypot(cachedFit.state.effector.x - directFit.state.effector.x, cachedFit.state.effector.y - directFit.state.effector.y) < 1e-9, 'cached Foundry fit maps the live effector exactly like direct fit');
assert(!threePreviewText.includes('teeth * 2'), '3D preview no longer carries a separate saw-tooth gear implementation');
assert(threePreviewText.includes('fabricablePartOutlinePoints'), '3D puppet preview uses shared model/user contour outlines instead of raw image crop rectangles');
assert(webOnnxWorkerText.includes('contourFromCropMask') && webOnnxWorkerText.includes("contourSource: crop.contourPoints.length >= 3 ? 'onnx-mask'"), 'browser ONNX worker preserves mask-derived part contours for fabrication plates');
assert(webOnnxText.includes('MODEL_CACHE_NAME') && webOnnxWorkerText.includes('caches.open') && webOnnxText.includes('warmWebOnnxCache'), 'browser ONNX model can be separately downloaded and cached on demand');
assert(webOnnxWorkerText.includes('GIT_LFS_POINTER_PREFIX') && webOnnxWorkerText.includes('deleteCachedModel') && webOnnxWorkerText.includes("cache: 'reload'"), 'browser ONNX worker rejects stale Git LFS pointer caches and refetches model bytes');
assert(webOnnxWorkerText.includes('MODEL_BYTES_HEADER') && webOnnxText.includes('x-motionsmith-model-bytes'), 'browser ONNX marks valid cached model bytes so boot checks only cache headers');
assert(webOnnxWorkerText.includes('assertCompleteModelDownload') && webOnnxWorkerText.includes('download disconnected after') && webOnnxWorkerText.includes('model-download-stalled'), 'browser ONNX rejects interrupted or stalled model downloads before caching');
assert(webOnnxWorkerText.includes('new TransformStream<Uint8Array, Uint8Array>') && !webOnnxWorkerText.includes('const chunks: Uint8Array[]') && !webOnnxWorkerText.includes('buffer.slice('), 'model download progress streams into one browser-owned buffer without chunk-array or cache-slice copies');
assert(webOnnxWorkerText.includes('markedBytes && markedBytes !== buffer.byteLength'), 'browser ONNX worker evicts cache entries whose recorded bytes do not match the cached body');
assert(webOnnxWorkerText.includes('InferenceSession.create(new Uint8Array(modelBuffer)') && webOnnxWorkerText.includes('await session?.release()'), 'browser ONNX creates and releases request-scoped sessions inside the Worker');
assert(webOnnxWorkerText.includes("import('onnxruntime-web/wasm')") && !webOnnxWorkerText.includes('jsep.wasm'), 'ONNX Runtime uses the lazy wasm-only runtime instead of the larger JSEP build');
assert(webOnnxWorkerText.includes('new OffscreenCanvas') && webOnnxWorkerText.includes('MAX_WORKING_PIXELS = 1_000_000') && webOnnxWorkerText.includes('MAX_WORKING_EDGE = 1_024'), 'image decode, pixel work, and output encoding stay in the bounded Worker path');
assert(!webOnnxWorkerText.includes('document.') && !webOnnxWorkerText.includes('new Image(') && webOnnxText.includes("activeJob?.cancel('superseded')"), 'image AI avoids main-thread DOM pixel work and keeps only the newest import active');
assert(appUiText.includes('data-testid="onnx-cache-status"') && appOnnxBootstrapText.includes('checkWebOnnxCache') && appOnnxBootstrapText.includes('warmWebOnnxCache'), 'status bar exposes cache state and keeps manual AI download separate from boot');
assert(indexText.includes('id="boot-loader"') && indexText.includes('Loading MotionSmith') && indexText.includes('boot-version') && !indexText.includes('Preparing AI model') && !indexText.includes('data-boot-progress'), 'static boot loader contains only logo, wordmark, and version while editor startup stays independent of AI');
assert(viewer3dText.includes('VIEWER3D_CAMERA_PRESETS') && threePreviewText.includes('three-puppet-view-toolbar') && foundryCameraText.includes('foundryPreset'), '3D puppet and foundry previews share one viewer camera preset contract');
assert(viewer3dText.includes('type Viewer3DContract') && viewer3dText.includes('createViewer3DContract'), '3D viewers expose one shared OOP-style contract object for tab adapters');
assert(threePreviewText.includes('DEFAULT_PUPPET_VIEWER_LAYERS') && threePreviewText.includes('data-testid={`${testId}-toggle-${layer}`}') && foundry3dText.includes('foundry-toggle-grid'), '3D viewer top overlay toolbar wires shared layer toggles instead of decorative buttons');
assert(foundry3dText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}') && threePreviewText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}'), '3D viewer state exposes a shared contract marker across tabs');
assert(foundry3dText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}') && threePreviewText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}'), '3D viewer state exposes the normalized tab/layer contract payload for browser checks');
assert(mechanismDesignText.includes('<DesignFoundryPreview') && designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"') && mechanismDesignText.includes('showTrace={showTrace}') && designWorkflowPanelText.includes('data-testid="design-toggle-trace"') && designFoundryPreviewText.includes('data-design-show-trace={showTrace ? "true" : "false"}') && designFoundryPreviewText.includes('data-design-trace-layer={showTrace ? "shown" : "hidden"}') && designFoundryPreviewText.includes('const showMechanismPath = showTrace && showMechanismPathPreview'), 'Mechanism Design center is the integrated automata workbench, and Trace controls real path/trail visibility');
if (!(/new Set|unique|dedup/i.test(designWorkflowPanelText) || /new Set|unique|dedup/i.test(designInspectorPanelText))) {
  g006StudentWarningCopyViolations.push('presentation: Design warning panels do not deduplicate repeated warning strings at the existing boundary');
}
assert(threePreviewText.includes('() => mechanismGeometrySignature(renderedMechanisms, mechanismContracts)') && threePreviewText.includes("contracts.get(mechanism.id)?.compilerSignature ?? ''") && threePreviewText.includes('mechanism.camProfileSamples?.join') && threePreviewText.includes('[mechanismSignature, kit, rendererStatus]') && !threePreviewText.includes('[mechanismSignature, renderedMechanisms, rendererStatus]'), '3D puppet mechanism geometry rebuilds on the full-project compiler signature and real topology/fabrication/cam-shape/kit changes, not every scrub-frame prop identity update');
assert(designFoundryPreviewText.includes('showPathPreview={showMechanismPath && sceneModel.mechanismContract.projectDriveEnabled === true}') && designFoundryPreviewText.includes('pathTraces={sceneModel.foundryPreview.pointTraces}') && designFoundryPreviewText.includes('data-testid="design-user-path-overlay"'), 'Mechanism Design routes bound fitted traces and user path overlays through the full-project Foundry preview seam');
assert(threePreviewText.includes('const mechanismHits = raycaster.intersectObjects([roots.mechanismsLayer], true)') && threePreviewText.includes("const projectedMechanism = bestTarget('mechanism')"), 'Integrated 3D puppet selection supports direct and projected mechanism picking while preserving object and part hit priority');
assert(!`${appText}
${mechanismDesignStageText}
${designFoundryPreviewText}`.includes('hideSceneUnderlay/>'), 'Mechanism Design no longer depends on the legacy 2D design canvas underlay toggle');
assert(threePreviewText.includes('data-three-part-surface="solid-cut-plates"'), '3D puppet preview exposes the solid cut-plate surface contract');
assert(threePreviewText.includes('data-three-part-art="top-texture-decal"'), '3D puppet preview exposes that artwork is rendered on top of plates');
assert(threePreviewText.includes('TextureLoader'), '3D puppet preview loads character part images as surface decals');
assert(threePreviewText.includes('new THREE.ShapeGeometry(shape)'), '3D puppet artwork decals are clipped to fabrication part outlines');
assert(threePreviewText.includes('window.setTimeout(buildNextPart, 16)') && threePreviewText.includes('bevelEnabled: false, steps: 1, curveSegments: 4'), '3D puppet builds one solid part per frame without decorative bevel overhead on low-end laptops');
assert(threePreviewText.includes('part-art-decal'), '3D puppet preview names surface decal meshes for browser inspection');
assert(threePreviewText.includes('cut-hole-ring'), '3D puppet preview draws raised joint-hole rings on part surfaces');
assert(threePreviewText.includes('transparent: false, opacity: 1'), '3D puppet body plates are opaque assembled solids, not ghost overlays');
assert(threePreviewText.includes('disposeOwnedMaterials(scene)'), '3D puppet preview disposes owned decal textures on unmount');
assert(agentsContract.includes('Path Editor must render only character, skeleton, editable path') && agentsContract.includes('Mechanism Design is the first workflow tab that overlays character + path + mechanism together'), 'AGENTS.md locks tab-scoped rendering ownership for Path vs Mechanism Design');
assert(agentsContract.includes('Getting Started can be reopened from the Character/Getting Started action') && agentsContract.includes('compact modal'), 'AGENTS.md defines compact Getting Started reopen behavior and scope after startup');
assert(workbenchContractText.includes('Character is correct creation owner') && workbenchContractText.includes('compact'), 'Workbench contract keeps Character as a compact functional creation owner');
assert(indexText.includes('id="boot-loader"') && indexText.includes('aria-label="Loading MotionSmith"') && indexText.includes('boot-word') && indexText.includes('boot-version') && !indexText.includes('Preparing AI model'), 'startup uses one static logo/wordmark/version boot loader before React mounts');
assert(indexText.includes('resources/icons/AppIcon.png') && !indexText.includes('src-tauri/icons/icon.png'), 'startup boot loader uses the canonical MotionSmith app icon instead of the old blue grid path');
assert(indexText.includes('#boot-loader .boot-word') && indexText.includes('max-width: calc(100vw - 2rem)') && indexText.includes('white-space: nowrap'), 'startup wordmark is viewport-constrained instead of clipped');
assert(appText.includes('useAppOnnxBootstrap') && appOnnxBootstrapText.includes('checkWebOnnxCache().then') && appOnnxBootstrapText.includes('const bootTimer = finishBootLoader()') && appOnnxBootstrapText.includes('document.getElementById("boot-loader")?.remove()'), 'React opens the editor independently and checks only AI cache headers during startup');
assert(shellUiText.includes('const APP_VERSION = __APP_VERSION__') && shellUiText.includes('workflow-rail-version') && indexText.includes('v%APP_VERSION%'), 'startup boot loader and editor rail show the package version subtly');
assert(indexText.includes('.boot-version') && indexText.includes('.workflow-rail-version'), 'version labels use low-emphasis styling');
assert(appWorkspaceShellText.includes('../resources/icons/AppIcon.png?url') && indexText.includes('.app-header-icon'), 'top bar renders the canonical MotionSmith app icon with dedicated sizing');
assert(appWorkspaceShellText.includes('data-testid="app-header-home"') && appWorkspaceShellText.includes('onClick={() => goStage("character")}') && indexText.includes('.app-header-home'), 'top MotionSmith wordmark works as a compact home control that returns to Character');
assert(indexText.includes("font-family: 'Manrope'") && indexText.includes('fonts/manrope-800-latin.woff2'), 'startup boot loader uses self-hosted Manrope wordmark styling');
assert(!appShellText.includes('welcome-dialog') && !appShellText.includes('Skip forever') && !appShellText.includes('>Start<'), 'startup has no second React welcome modal or persistence/start controls');
assert(indexText.includes('--ms-font-sans') && indexText.includes('font-family: var(--ms-font-sans)') && indexText.includes('.brand-title'), 'global typography uses the shared modern MotionSmith font stack');
assert(appWorkspaceShellText.includes('app-header-brand') && appWorkspaceShellText.includes('app-header-actions') && appWorkspaceShellText.includes('quick-toolbar'), 'top app bar separates brand, menus, and quick actions into compact zones');
assert(indexText.includes('.app-header-brand') && indexText.includes('.app-header-actions') && indexText.includes('border-radius: 999px'), 'top app bar keeps the brand and current stage in one slick editor row');
assert(!appWorkspaceShellText.includes('flex flex-col items-end gap-2'), 'top app bar does not stack menu and quick actions vertically');
assert(appText.includes('useProjectAutosave(project,') && appText.includes('readAutosaveProject(initialProject)') && appProjectCommandsHookText.includes('readAutosaveProjectAsync') && appProjectCommandsHookText.includes('readWorkspaceLayoutSnapshot') && appProjectCommandsHookText.includes('writeWorkspaceLayoutSnapshot') && appAutosaveHookText.includes('writeAutosaveSnapshot') && appAutosaveHookText.includes('visibilitychange') && appAutosaveHookText.includes('pagehide') && appAutosaveHookText.includes('beforeunload') && projectPersistenceText.includes('readAutosaveProjectAsync') && projectPersistenceText.includes('readStorageWithLegacy') && projectPersistenceText.includes('migrateStorageValue'), 'MotionSmith storage rename keeps typed autosave/workspace recovery behind the persistence seam');
assert(projectPersistenceText.includes('indexedDB.open(AUTOSAVE_DB_NAME') && projectPersistenceText.includes('AUTOSAVE_PREVIOUS') && projectPersistenceText.includes('navigator.storage.persist') && appAutosaveHookText.includes('markAutosaveDirty') && appAutosaveHookText.includes('writingRef.current') && appAutosaveHookText.includes('document.hidden'), 'autosave uses two IndexedDB generations, requests durable browser storage, and records a hidden-tab dirty marker when a write is in flight');
assert(!appUiText.includes('MOTIONSMITH_VIDEO_URL'), 'welcome splash does not embed the old preview video');
assert(appUiText.includes('getting-started-dialog') && appUiText.includes('getting-started-gallery'), 'Getting Started is an explicit compact starter dialog');
assert(appUiText.includes('const [showGuided, setShowGuided] = useState(false)') && appUiText.includes('Start.') && appUiText.includes('Pick a project.'), 'Getting Started opens as starter choices and moves guided projects behind the explicit Guide tile');
assert(gettingStartedDialogCommandSource.includes('Starter rig') && gettingStartedDialogCommandSource.includes('Open full project') && !gettingStartedDialogCommandSource.includes('Character file') && !gettingStartedDialogCommandSource.includes('>Humanoid<') && !gettingStartedDialogCommandSource.includes('>Package<') && !gettingStartedDialogCommandSource.includes('Import project'), 'Getting Started keeps starter choices compact and leaves character file loading to the Character tab');
assert(appUiText.includes('getting-started-card-guided') && appUiText.includes('Open Guide') && appUiText.includes('guided-project-library') && appUiText.includes('guided-project-card-${lesson.id}') && appUiText.includes('Don&apos;t show again this session'), 'Getting Started exposes guided projects through a Guide tile with a session-only opt-out while keeping open exploration visible');
assert(appUiText.includes('GuidedLessonMotionPreview') && appUiText.includes('guided-project-preview-${lessonId}') && appUiText.includes('data-preview-mode="rendered-character-motion"') && appUiText.includes('data-motion-preview="character-path"') && appUiText.includes('gearTrainCenters(mechanism)') && indexText.includes('repeat(auto-fit, minmax(13rem, 1fr))') && indexText.includes('.guided-project-preview') && indexText.includes('--ms-viewport-height: 100vh') && indexText.includes('@supports (height: 100dvh)') && indexText.includes(':root { --ms-viewport-height: 100dvh; }') && indexText.includes('.getting-started-dialog { width: min(94vw, 70rem); min-height: min(calc(var(--ms-viewport-height) - 7rem), 43rem); max-height: min(calc(var(--ms-viewport-height) - 2rem), 64rem);') && indexText.includes('min-height: 11.25rem'), 'Guide project cards render larger character-motion thumbnails and Getting Started sizes from the shared viewport variable with dvh support');
assert(!indexText.includes('min-height: min(82vh, 43rem)'), 'Getting Started no longer locks a stale raw-vh min-height contract');
assert(appUiText.includes('Change') && appUiText.includes('Build') && appUiText.includes('data-change-cue') && appUiText.includes('data-direct-translation') && appUiText.includes('data-evidence-cue') && appUiText.includes('data-expected-answer') && appUiText.includes('data-clip-slot') && gettingStartedDialogCommandSource.includes('starter-card-cues') && gettingStartedDialogCommandSource.includes('Edit one move') && gettingStartedDialogCommandSource.includes('Ready to build'), 'Guided and starter cards show compact action cues while carrying local classroom check/evidence metadata without visible sensemaking text load');
assert(characterLessonOwnershipText.includes('character-make-it-yours') && characterLessonOwnershipText.includes('Make it yours') && characterLessonOwnershipText.includes('data-change-cue={activeClassroomLesson.changeCue}') && characterLessonOwnershipText.includes('data-build-cue={activeClassroomLesson.buildCue}') && characterLessonOwnershipText.includes('Select a part') && characterLessonOwnershipText.includes('Place joints') && characterSelectionText.includes('<CharacterLessonOwnership') && !appText.includes('Change {activeClassroomLesson.changeCue}') && !appText.includes('Build {activeClassroomLesson.buildCue}'), 'Guided lessons land on Character with character-only rigging controls while keeping lesson metadata for later stages');
assert(gettingStartedDialogCommandSource.includes('getting-started-card-humanoid') && gettingStartedDialogCommandSource.includes('getting-started-card-image') && !gettingStartedDialogCommandSource.includes('getting-started-card-package') && gettingStartedDialogCommandSource.includes('getting-started-card-${template.id}') && starterImageTemplatesText.includes('id: "girl"') && starterImageTemplatesText.includes('id: "boy"'), 'Getting Started exposes compact starter/result choices including Girl and Boy without a duplicate character-file card');
assert(!appUiText.includes('Local browser processing') && !appUiText.includes('Load art + skeleton') && !appUiText.includes('Full body rig') && !appUiText.includes('Browser ONNX rigging'), 'Getting Started avoids process/explanation copy');
assert(!appUiText.includes('Crank turns -> rocker swings') && !appUiText.includes('Cam shape -> follower lifts') && !appUiText.includes('Two cranks -> one trace point') && !appUiText.includes('Touching teeth -> spin transfers') && !appUiText.includes('Parts + joints -> motion rig'), 'Getting Started keeps direct-translation sensemaking out of visible first-run copy');
assert(!appUiText.includes('lesson-template-'), 'Getting Started does not use legacy lesson-template cards');
assert(indexText.includes('.starter-thumb { width: 2.25rem; height: 2.25rem;') && indexText.includes('.getting-started-dialog .template-gallery .starter-thumb { width: 6rem; height: 6rem;') && indexText.includes('transform: scale(1.22)'), 'Girl/Boy starter thumbnails stay compact globally but larger inside Start cards');
assert(appText.includes('useProjectHistory(createInitialProject)') && appProjectHistoryHookText.includes('return { present: createInitialProject(), past: [], future: [] }'), 'App initializes through the ProjectState history hook and can restore a browser autosave instead of preloading a character');
assert(appProjectCommandsHookText.includes('setProject(createEmptyProject(), { resetHistory: true })'), 'New Project resets to an empty project instead of a starter character');
assert(appProjectCommandsHookText.includes('project.sceneObjectOrder.length > 0') && appProjectCommandsHookText.includes('Object.keys(project.sceneObjects).length > 0'), 'New Project discard confirmation treats Character-created scene objects as user work');
assert(appCharacterImportActionsHookText.includes('returnStage: "character"'), 'Accepted character loads stay in the Character tab instead of jumping to Path');
assert(characterImportOverlaysText.includes('character-import-review') && characterSelectionText.includes('<CharacterImportStatusDock') && characterSelectionText.includes('reviewedProject={reviewedProject}') && characterSelectionText.includes('<CharacterImportReviewDialog') && characterImportOverlaysText.includes('showImportChecks = project.settings.debugVisuals'), 'Character imports preview the pending character and put approval in a centered overlay while checks stay dev-only');
assert(appUiText.includes('Dev mode') && !appUiText.includes('Debug visuals'), 'Options expose debug overlays as Dev mode instead of novice-facing debug copy');
assert(!appText.includes('<WelcomeDialog') && !appUiText.includes('WelcomeDialog') && !appText.includes('setShowWelcome') && !appText.includes('setShowGettingStarted(!hideNextTime)') && appText.includes('const [showGettingStarted, setShowGettingStarted] = useState(') && appText.includes('readGettingStartedHiddenForSession'), 'Startup uses the static boot loader only, then opens Getting Started unless the session opt-out is set');
assert(characterImportControlsText.includes('onOpenGettingStarted') && characterImportControlsText.includes('Open Getting Started') && characterSelectionText.includes('<CharacterImportControls'), 'Character tab can reopen Getting Started through extracted import controls without owning its starter gallery');
assert(!appUiText.includes('Start with character art'), 'Character tab no longer carries the old hero/onboarding copy');
assert(!indexText.includes('.onboarding-page'), 'CSS no longer keeps a full-screen onboarding page mode');
assert(!indexText.includes('.welcome-simple'), 'CSS no longer keeps the old welcome video layout');
assert(characterSetupPanelText.includes('character-setup-panel') && characterSelectionText.includes('<CharacterSetupPanel'), 'Character tab exposes direct part settings through the extracted setup panel instead of only getting-started cards');
assert(characterImportControlsText.includes('character-import-controls') && characterImportControlsText.includes('blank-package-input') && characterImportControlsText.includes('onnx-input') && characterImportControlsText.includes('onboarding-import-input') && !characterImportControlsText.includes('Keep compatible mechanisms') && !characterImportControlsText.includes('Keep mechanisms') && characterSelectionText.includes('<CharacterImportControls'), 'Character import file controls live in the extracted import-controls seam with stable chooser ids and no keep-mechanisms toggle');
assert(characterImportControlsText.includes('character-add-scene-object') && characterImportControlsText.includes('scene-object-image-input') && characterImportControlsText.includes('accept="image/png,image/jpeg,image/webp,image/svg+xml"') && characterSelectionText.includes('sceneObjectFromImageFile(file, uid("object"))') && sceneObjectImageText.includes('contourPoints: imageContour') && sceneObjectImageText.includes('Object SVG must be local artwork only.') && sceneObjectImageText.includes('Object image could not be saved locally.') && !sceneObjectImageText.includes('?? sourceUrl') && sceneObjectInspectorText.includes('data-testid="scene-object-inspector"') && sceneObjectInspectorText.includes('Object name') && sceneObjectInspectorText.includes('Size · use Scale') && sceneObjectInspectorText.includes('Delete object'), 'Character tab exclusively owns safe image-object import, contour creation, rename, and object-property editing');
assert(threePreviewText.includes('SceneObject') && threePreviewText.includes('objectsLayer') && threePreviewText.includes('object.contourPoints') && threePreviewText.includes('createSceneObjectArtMaterial') && threePreviewText.includes('data-three-scene-prop-count'), 'Shared 3D viewer renders Character-created image-contour scene objects as ProjectState props without adding object-creation controls to later stages');
assert(sceneSketchText.includes('path-scene-object-art-${object.id}') && pathCanvasPaneText.includes('onSelectSceneObject={(objectId)') && designFoundryPreviewText.includes('onAutomataSceneObjectSelect={(objectId)') && designFoundryPreviewText.includes('onAutomataPartSelect={(partId)') && designFoundryPreviewText.includes('onWheel={handleWheel}') && foundry3dText.includes('pickAutomataTarget(event)'), 'Path and Mechanism Design can select and animate Character-created objects without exposing object creation outside Character, while Design routes viewport input through Foundry');
const sceneObjectUiOwnerFiles = new Set([
  join(process.cwd(), 'components', 'stages', 'character', 'CharacterSelection.tsx'),
  join(process.cwd(), 'components', 'stages', 'character', 'CharacterImportControls.tsx'),
  join(process.cwd(), 'components', 'stages', 'character', 'SceneObjectInspector.tsx')
]);
const forbiddenSceneObjectUiTokens = ['upsert_scene_object', 'createDefaultSceneObject', 'SceneObjectInspector', 'character-add-scene-object'];
const sceneObjectUiLeaks = collectComponentSourceFiles(join(process.cwd(), 'components'))
  .filter(path => !sceneObjectUiOwnerFiles.has(path))
  .filter(path => forbiddenSceneObjectUiTokens.some(token => readFileSync(path, 'utf8').includes(token)))
  .map(path => relative(process.cwd(), path));
assert.deepEqual(sceneObjectUiLeaks, [], 'scene object creation/edit controls stay out of non-Character component surfaces');
assert(characterSelectionText.includes('character-part-list') && characterSelectionText.includes('character-part-item-${part.id}'), 'Character tab owns body-part selection in the left workflow pane');
assert(!stageLayoutText.includes('classroomChecklistFor') && !stageLayoutText.includes('classroom-checklist') && !characterSelectionText.includes('showClassroomChecklist'), 'Left workflow panes do not render cross-stage classroom checklist chips');
assert(characterSelectionText.includes('viewport={viewport}') && characterSelectionText.includes('setViewport={setViewport}') && characterSelectionText.includes('mechanisms={[]}') && characterSelectionText.includes('inputMode="always"') && characterSelectionText.includes('testId="character-three-puppet"'), 'Character preview uses the shared canvas viewport with character-only layers instead of rendering path/mechanism content');
assert(threePreviewText.includes(".filter(layer => layer !== 'mechanisms' || mechanismsToRender.length > 0)"), 'Shared 3D viewer hides the mechanism layer toggle when a tab passes no mechanisms to render');
assert(appText.includes('setStage("character")'), 'Character edit controls stay in the functional Character tab');
assert(partInspectorText.includes('className={`compact-number') && partInspectorText.includes('<summary>Artwork</summary>') && partInspectorText.includes('Art width') && partInspectorText.includes('Art offset X'), 'Character part inspector keeps X/Y/Rotation compact while moving detailed artwork extent controls behind the Artwork disclosure');
assert(skeletonInspectorText.includes('Motion setup') && skeletonInspectorText.includes('character-motion-preset-summary') && skeletonInspectorText.includes('Part pivot') && skeletonInspectorText.includes('<summary>Edit skeleton</summary>') && skeletonInspectorText.includes('motionChainRootJointIds') && characterSetupPanelText.includes('<SkeletonInspector'), 'Character setup panel shows a compact motion preset summary while raw skeleton editing stays behind the Edit skeleton disclosure');
assert(pathEditorText.includes('requestAnimationFrame') && pathEditorText.includes('flushPendingPath') && sceneSketchText.includes('onPointerCancel={finishInteraction}') && inspectorControlsText.includes('queueRangeChange') && inspectorControlsText.includes('onPointerUp={flushRangeChange}') && inspectorControlsText.includes('setNumberResetVersion'), 'path strokes and inspector joint sliders commit permanent ProjectState at animation-frame cadence, flush on pointer completion, and restore rejected values');
assert(partInspectorText.includes('data-testid="part-cut-controls"') && cutOutlineEditorText.includes('data-testid="cut-outline-dialog"') && partInspectorText.includes('Edit cut') && !partInspectorText.includes('Cut point X') && !cutOutlineEditorText.includes('Cut point X'), 'Character part inspector opens a canvas-first cut overlay instead of coordinate controls');
assert(partInspectorText.includes('sourceTextureUrl={sourceTextureUrl}') && cutOutlineEditorText.includes('sourceImageFrame') && cutOutlineEditorText.includes('data-testid="cut-outline-art"') && indexText.includes('.cut-outline-part-window'), 'Character cut editor shows the full source picture behind a zoomed editable contour when available');
assert(partInspectorText.includes('contourSource: "user"') && cutOutlineEditorText.includes('Auto cut') && cutOutlineEditorText.includes('Add point'), 'Character cut editor writes user contours and can bake/add contour points');
assert(cutOutlineEditorText.includes('type CutTool = "edit" | "draw" | "pan"') && cutOutlineEditorText.includes('data-testid={`cut-tool-${id}`}') && cutOutlineEditorText.includes('data-cut-tool={tool}') && cutOutlineEditorText.includes('replacePoints(draw.points, 0)'), 'Character cut editor exposes explicit Edit/Draw/Pan tools and replaces the contour from a one-stroke Draw cut');
assert(cutOutlineEditorText.includes('setPointerCapture') && cutOutlineEditorText.includes('onPointerCancel={stopDrag}') && !cutOutlineEditorText.includes('onPointerLeave={stopDrag}'), 'Character cut editor keeps captured drag-pan/point-drag active when the pointer leaves the SVG edge');
assert(partShapeText.includes('data-testid={`path-part-${part.id}`}') && partShapeText.includes('data-testid={`path-part-art-${part.id}`}') && partShapeText.includes('part.bounds.x * part.transform.scale'), 'Path Editor renders artwork from the editable part bounds offset');
assert(partShapeText.includes('partOutlinePathD(part, landmarks') && partShapeText.includes('path-part-surface-mask'), 'Path Editor clips part art to the shared fabrication outline and hole mask');
assert(designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"') && designFoundryPreviewText.includes('data-shared-with="foundry-renderer"') && designFoundryPreviewText.includes('buildAutomataSceneModel') && automataSceneModelText.includes('buildFoundryMechanismPreviewModel') && designFoundryPreviewText.includes('<ThreeFoundryPreview') && !designFoundryPreviewText.includes('data-testid="design-guided-context-overlay"'), 'Mechanism Design shows a Foundry-renderer-backed mechanism instance instead of a ghost/private mechanism overlay');
assert(characterSelectionText.includes('Choose new character.'), 'Character tab disables active-project artwork edits while a package review is pending');
assert(characterSelectionText.includes('disabled={partPanelDisabled}') && characterSelectionText.includes('onClick={onEditCharacter}'), 'Pending package review disables active-character edit buttons');
assert(characterSelectionText.includes('disabled={partPanelDisabled}') && characterSelectionText.includes('onClick={onSaveSkeleton}'), 'Pending package review disables active skeleton save controls');
assert(appWorkspaceShellText.includes('data-testid="bug-report-button"') && appWorkspaceShellText.includes('<BugReportOverlay') && bugReportOverlayText.includes('submitBugReport') && !bugReportOverlayText.includes('Email optional') && bugReportOverlayText.includes('One optional screen is sent with this report.') && bugReportOverlayText.includes('download={screenshot.name}') && bugReportOverlayText.includes('Remove') && bugReportClientText.includes('getDisplayMedia') && bugReportClientText.includes('MAX_SCREENSHOT_EDGE = 1280') && bugReportClientText.includes('MAX_SCREENSHOT_BYTES = 1024 * 1024') && bugReportClientText.includes('`${base}/bug`') && bugReportClientText.includes('https://github.com/AlanSynn/ms/issues/new') && !bugReportClientText.includes('email: string') && bugReportClientText.includes('[redacted email]') && !studyWorkerText.includes('email: 254') && !bugReportOverlayText.includes('Your name') && indexText.includes('.bug-report-overlay'), 'header bug button omits email collection, sends through the same-origin Worker, and falls back to a redacted public GitHub draft');
assert(studyTelemetryText.includes('CompressionStream("gzip")') && studyTelemetryText.includes('indexedDB.open') && studyTelemetryText.includes('navigator.sendBeacon') && studyTelemetryText.includes('requestIdleCallback') && studyTelemetryText.includes('VITE_STUDY_BUILD_SHA') && !studyTelemetryText.includes('setInterval'), 'study telemetry uses versioned compressed batches, idle snapshots, a durable browser outbox, page-exit delivery, and no polling loop');
assert(studyWorkerText.includes('request.headers.get("Origin") !== env.ALLOWED_ORIGIN') && studyWorkerText.includes('GITHUB_TOKEN') && studyWorkerText.includes('ADMIN_TOKEN') && studyWorkerText.includes('withinRateLimit') && studyWorkerText.includes('limitedStreamBytes') && !bugReportClientText.includes('GITHUB_TOKEN'), 'study Worker owns origin, streaming limits, rate limits, and private GitHub/admin secrets; browser code owns none');
assert(appStageRouterText.includes('stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden'), 'shared workbench prevents right-pane scroll from moving the center canvas');
assert(indexText.includes('.stage-left-pane, .stage-right-inspector { min-width: 0; min-height: 0; height: 100%; max-height: 100%; overflow-x: hidden; overflow-y: auto; overflow-wrap: anywhere;') && indexText.includes('.stage-left-pane-content > *, .stage-pane-stack > *, .workspace { min-width: 0; max-width: 100%; }') && indexText.includes('.character-setup-panel { min-height: 0; overflow: visible;') && indexText.includes('.character-inspector { min-height: 0; overflow: visible; }'), 'right inspector owns the single vertical scroll container for all stages, including Character, while shared panes wrap instead of clipping');
const paneWheelCaptureCount = stageLayoutText.match(/onWheelCapture={keepPaneWheelOnPane}/g)?.length ?? 0;
assert(stageLayoutText.includes('keepPaneWheelOnPane') && paneWheelCaptureCount >= 2, 'workflow and inspector panes keep wheel scrolling on their panes even when the pointer is over sliders or number fields');
assert(mechanismFoundryText.includes('const [showSensemaking, setShowSensemaking] = useState(false)'), 'Foundry starts in compact tinkerable mode with sensemaking collapsed');
assert(foundryStageText.includes('data-testid="foundry-visible-sensemaking"') && mechanismDesignStageText.includes('data-testid="design-visible-sensemaking"'), 'Foundry and Design show compact visible sensemaking by default instead of hiding all meaning behind details');
assert(`${mechanismDesignStageText}
${foundryStageText}`.includes('data-sensemaking-evidence') && `${mechanismDesignStageText}
${foundryStageText}`.includes('data-sensemaking-answer') && `${mechanismDesignStageText}
${foundryStageText}`.includes('data-sensemaking-clip'), 'Visible sensemaking cues expose teacher-pack check/evidence metadata through compact attributes, not extra prose');
assert(foundryInspectorPanelText.includes('compact-fabrication-stack') && foundryInspectorPanelText.includes('data-testid="foundry-fabrication-stack"') && !foundryWorkflowPanelText.includes('data-testid="foundry-fabrication-stack"'), 'Foundry keeps fabrication Stack in the right inspector instead of the left workflow pane');
assert(typesText.includes("'assembly'"), 'AppStage includes a dedicated Assembly tab');
assert(appUiText.includes("{ id: 'assembly', label: 'Assembly' }"), 'workflow rail exposes Assembly as a separate stage');
const blueprintCanvasStart = blueprintExportText.indexOf('data-testid="blueprint-canvas-preview"');
const blueprintInspectorStart = blueprintExportText.indexOf('<BlueprintDetailPanel', blueprintCanvasStart);
assert(blueprintCanvasStart >= 0 && blueprintInspectorStart > blueprintCanvasStart && blueprintDetailPanelText.includes('data-testid="blueprint-detail-preview"'), 'Blueprint layout exposes web-first board preview and extracted inspector slot');
const blueprintCanvasBlock = blueprintExportText.slice(blueprintCanvasStart, blueprintInspectorStart);
const blueprintInspectorBlock = blueprintDetailPanelText;
assert(blueprintCanvasBlock.includes('blueprint-svg-preview') && blueprintCanvasBlock.includes('dangerouslySetInnerHTML'), 'Blueprint center canvas previews the readable SVG as inline web UI instead of a broken document image');
assert(!blueprintCanvasBlock.includes('<img') && !blueprintCanvasBlock.includes('alt="Cut sheet"'), 'Blueprint center preview does not expose a broken cut-sheet image placeholder');
assert(blueprintCanvasBlock.includes('data-visual-level="print-sheet-hero"') && !blueprintControlPanelText.includes('blueprint-more-exports') && !blueprintControlPanelText.includes('Assembly guide') && !blueprintControlPanelText.includes('Teacher files'), 'Blueprint keeps the printable character/mechanism sheet central and removes secondary teacher/assembly buttons from the primary workflow');
assert(blueprintExportText.includes('<BlueprintControlPanel') && blueprintControlPanelText.includes('data-testid="blueprint-control-panel"') && blueprintControlPanelText.includes('aria-label="Generate package"') && blueprintExportText.includes('<BlueprintDetailPanel') && blueprintDetailPanelText.includes('data-testid="blueprint-stack-summary"'), 'Blueprint left workflow controls/downloads and right recipe detail live outside the stage wrapper behind tested panel seams');
assert(blueprintExportText.includes('const liveRecipes = activeMechanisms.map') && blueprintExportText.includes('const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? [])') && blueprintExportText.includes('makeBlueprintPreviewSvg(project, recipes)'), 'Blueprint center preview renders the readable live view from live fabrication recipe data when project readiness permits it; export downloads keep the physical artifact SVG');
assert(blueprintExportText.includes('selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId)') && blueprintExportText.includes('recipes.find((recipe) => recipe.mechanismId === selectedMechanismId)'), 'Blueprint defaults the detail recipe to the selected live mechanism so fitted mechanisms carry into print/build views');
assert(blueprintExportText.includes('<BlueprintDetailPanel') && blueprintDetailPanelText.includes('data-testid="blueprint-sensemaking-label"') && blueprintDetailPanelText.includes('requiredPartCount') && assemblySceneFrameComponentText.includes('data-testid="assembly-scene-sensemaking"') && assemblyInspectorPanelText.includes('data-testid="assembly-sensemaking-label"'), 'Blueprint delegates detail inspector rendering while Blueprint and Assembly reuse mechanism sensemaking metadata for compact visual cues');
assert(blueprintExportText.includes('buildProjectMechanismSceneContract') && blueprintExportText.includes('selectedMechanismContract') && blueprintDetailPanelText.includes('data-mechanism-graph-ir-version'), 'Blueprint inspector exposes project-gated graph metadata while keeping recipe/SVG output as the visual source');
assert(blueprintExportText.includes('project.mechanisms.find((mechanism) => mechanism.id === project.selectedMechanismId)') && blueprintExportText.includes('buildProjectMechanismSceneContract(project, selectedMechanism.id, selectedRecipe)') && blueprintDetailPanelText.includes('selectedMechanismContract?.graphCompiler'), 'Blueprint graph telemetry uses the selected authored mechanism for project-gated static recovery without reviving stale package recipes');
assert(!blueprintCanvasBlock.includes('<Canvas project={project}'), 'Blueprint center canvas is a static output sheet, not the animated 3D/2.5D workbench');
assert(!blueprintCanvasBlock.includes('assembly-guide-web-preview') && !blueprintInspectorBlock.includes('assembly-guide-web-preview'), 'Blueprint no longer embeds the assembly guide document');
assert(fabricationRuntimeText.includes('svg: makeBlueprintSvg(project, recipes)'), 'export package uses the physical printable blueprint SVG, not the screen preview');
const physicalBlueprintSvgStart = fabricationBlueprintSvgText.indexOf('export const makeBlueprintSvg');
const physicalBlueprintSvgEnd = fabricationBlueprintSvgText.indexOf('export const makeBlueprintPreviewSvg', physicalBlueprintSvgStart);
assert(physicalBlueprintSvgStart >= 0 && physicalBlueprintSvgEnd > physicalBlueprintSvgStart && fabricationRuntimeText.includes("export { makeBlueprintPreviewSvg, makeBlueprintSvg } from './fabricationBlueprintSvg'"), 'fabrication facade exposes a dedicated physical blueprint SVG renderer from the focused seam');
const physicalBlueprintSvgBlock = fabricationBlueprintSvgText.slice(physicalBlueprintSvgStart, physicalBlueprintSvgEnd);
assert(physicalBlueprintSvgBlock.includes('data-blueprint-source="fabrication-contract"') && physicalBlueprintSvgBlock.includes('data-board-callout') && physicalBlueprintSvgBlock.includes('fabricationBoardColumnLabel') && physicalBlueprintSvgBlock.includes('fabricationBoardRowLabel'), 'physical export SVG keeps board labels and recipe callouts from the fabrication contract');
assert(!physicalBlueprintSvgBlock.includes('data-cut-part') && !physicalBlueprintSvgBlock.includes('generateCurvePoints') && !physicalBlueprintSvgBlock.includes('opacity="0.22"'), 'physical export SVG excludes screen-only cut previews, foundry path overlays, and translucent character ghosts');
const blueprintSvgStart = fabricationBlueprintSvgText.indexOf('export const makeBlueprintPreviewSvg');
const blueprintSvgEnd = fabricationBlueprintSvgText.length;
assert(blueprintSvgStart >= 0 && blueprintSvgEnd > blueprintSvgStart, 'fabricationBlueprintSvg exposes a dedicated readable blueprint preview renderer');
const blueprintSvgBlock = fabricationBlueprintSvgText.slice(blueprintSvgStart, blueprintSvgEnd);
assert(blueprintSvgBlock.includes('data-print-character-part') && blueprintSvgBlock.includes('data-print-mechanism-part'), 'Blueprint preview SVG shows printable character and mechanism parts as first-class elements');
assert(blueprintSvgBlock.includes('data-blueprint-icon="cam-module"') && blueprintSvgBlock.includes('data-blueprint-icon="guide-cartridge"') && blueprintSvgBlock.includes('data-blueprint-icon="gravity-follower"'), 'Blueprint preview SVG has distinct student-readable icons for cam, guide, and follower modules');
{
  const studentBlueprintPreview = directMakeBlueprintPreviewSvg(sample, createFabricationPackage(sample).recipes);
  const sampleCharacterLayout = directBuildCharacterPrintLayout(sample);
  assert(studentBlueprintPreview.includes('data-blueprint-visual-mode="print-sheet-hero"') && studentBlueprintPreview.includes('data-blueprint-visual-density="student-simple"') && studentBlueprintPreview.includes('data-blueprint-print-hero') && studentBlueprintPreview.includes('data-blueprint-board-summary') && studentBlueprintPreview.includes('CHARACTER SHEET') && studentBlueprintPreview.includes('MECHANISM PARTS') && studentBlueprintPreview.includes('PRINT · CUT · BUILD'), 'Blueprint preview SVG is a student-simple print-sheet-first layout, not a dense board report');
  assert(!studentBlueprintPreview.includes('generateCurvePoints') && !studentBlueprintPreview.includes('opacity="0.22"'), 'Blueprint preview SVG avoids foundry path overlays and translucent character ghosts');
  assert(studentBlueprintPreview.includes(`&quot;characterPages&quot;:${sampleCharacterLayout.pageCount}`) && studentBlueprintPreview.includes(`${sampleCharacterLayout.parts.length} character parts`), 'Blueprint part cut previews reuse the printable character sheet layout instead of a separate screen-only packer');
}
assert(appStageRouterText.includes('<AssemblyGuide') && !appText.includes('<AssemblyGuide') && !appStageRouterText.includes('const AssemblyGuide = ({') && assemblyGuideText.includes('export const AssemblyGuide'), 'AppStageRouter delegates Assembly Guide stage to an extracted stage seam');
const assemblyBlock = assemblyGuideText;
const hasForbiddenNamedImport = (source: string, moduleName: string, importName: string) =>
  new RegExp(`import\\s+\\{[^}]*\\b${importName}\\b[^}]*\\}\\s+from\\s+['"][^'"]*${moduleName}['"]`).test(source);
const importsForbiddenModule = (source: string, moduleName: string) =>
  new RegExp(`from\\s+['"][^'"]*${moduleName}['"]`).test(source);
const compilerCutoverStageSources = [
  ['Foundry stage', foundryStageText],
  ['Foundry inspector', foundryInspectorPanelText],
  ['Foundry 3D renderer', threeFoundryPreviewText],
  ['Design stage', mechanismDesignStageText],
  ['Blueprint stage', blueprintExportText],
  ['Assembly stage', assemblyBlock],
  ['Assembly model', assemblyGuideModelText],
  ['Assembly canvas', assemblyCanvasPaneText],
  ['Assembly Three preview', assemblyThreePreviewText],
  ['Assembly scene frame', assemblySceneFrameText],
  ['Assembly playback', assemblyPlaybackText]
] as const;
compilerCutoverStageSources.forEach(([label, source]) => {
  assert(!hasForbiddenNamedImport(source, 'fabricationRenderPlan', 'fabricationRenderPlanForMechanism'), `${label} does not import the legacy render-plan seam directly`);
  assert(!hasForbiddenNamedImport(source, 'fabricationRecipes', 'createFabricationRecipe') && !hasForbiddenNamedImport(source, 'fabricationRecipes', 'prefabAssemblySteps'), `${label} does not import legacy fabrication recipe helpers directly`);
  assert(!importsForbiddenModule(source, 'mechanismGraph') && !hasForbiddenNamedImport(source, 'mechanismCompiler', 'compileMechanism'), `${label} consumes graph compiler output through scene/contracts/facades instead of stage-local graph construction`);
});
assert(assemblyBlock.includes('<AssemblyControlPanel') && assemblyBlock.includes('<AssemblyCanvasPane') && assemblyBlock.includes('<AssemblyInspectorPanel') && !assemblyBlock.includes('data-testid="assembly-control-panel"') && !assemblyBlock.includes('data-testid="assembly-guide-preview"'), 'Assembly Guide stage wrapper delegates workflow, canvas, and inspector panes to extracted leaf seams');
assert(assemblyCanvasPaneText.includes('data-testid="assembly-canvas-preview"') && assemblyCanvasPaneText.includes('<AssemblySceneFrame') && !assemblyCanvasPaneText.includes('<AssemblyWorkbench') && !assemblyCanvasPaneText.includes('<CharacterAssemblyWorkbench'), 'Assembly tab renders one Three-backed scene frame instead of a lower SVG workbench');
assert(assemblyCanvasPaneText.includes('<AssemblyCharacterThreePreview') && assemblyCanvasPaneText.includes('<AssemblyMechanismThreePreview') && !assemblyThreePreviewText.includes('ThreePuppetPreview') && assemblyThreePreviewText.includes('ThreeFoundryPreview'), 'Assembly canvas routes character and mechanism build previews through the shared Foundry Three renderer');
assert(assemblyThreePreviewText.includes('data-testid="assembly-character-three-preview"') && assemblyThreePreviewText.includes('data-testid="assembly-mechanism-three-preview"') && assemblyThreePreviewText.includes('assemblySceneFrame={sceneFrame}') && foundryPreviewStateProbeText.includes('data-three-assembly-phase'), 'Assembly Three preview exposes shared Foundry step phase/progress telemetry for both character and mechanism branches');
assert(assemblyThreePreviewText.includes('const stepLift') && assemblyThreePreviewText.includes('playing || progress > 0') && assemblyThreePreviewText.includes('Build animation') && !assemblyThreePreviewText.includes('return 0.72') && assemblyCanvasPaneText.includes('playing={playing}'), 'Assembly Three preview stays assembled by default and only lifts z-stack during animated assembly playback');
assert(assemblySceneFrameText.includes('activeScenePoints') && assemblySceneFrameText.includes('floatingReferencePoints') && foundryAssemblySceneOverlayText.includes('frame.kind === "character"') && foundryAssemblySceneOverlayText.includes('(frame.activeScenePoints ?? []).map(scenePointToPreviewPoint)') && threeFoundryPreviewText.includes('assemblyLift'), 'Character assembly feeds art pins into the Foundry renderer through the scene-to-Foundry coordinate seam and keeps explode_z on z only');
assert(foundryAssemblySceneOverlayText.includes('assembly-15x15-board-surface') && foundryAssemblySceneOverlayText.includes('board.userData.assemblyBoardZ = z') && foundryAssemblySceneOverlayText.includes('kit.boardCells * kit.boardCells') && threeFoundryPreviewText.includes('threeAssemblyBoardSurface'), 'Assembly overlays render a testable 15x15 board surface at z=0 instead of floating pins without a base board');
assert(assemblyThreePreviewText.includes('buildAutomataSceneModel') && assemblyThreePreviewText.includes('automataContext={automataContext}') && automataSceneModelText.includes('buildFoundryMechanismPreviewModel') && !assemblyThreePreviewText.includes('mechanisms={[]}'), 'Assembly character context consumes the shared automata/Foundry preview seam instead of private puppet mechanism fallbacks');
assert(assemblyBlock.includes('buildAssemblyGuideModel') && !assemblyBlock.includes('const liveRecipes = activeMechanisms.map') && assemblyGuideModelText.includes('const liveRecipes = activeMechanisms.map') && assemblyGuideModelText.includes('liveRecipes.length ? liveRecipes : (pkg?.recipes ?? [])'), 'Assembly Guide delegates live recipe fallback to the DOM-free model seam');
assert(assemblyGuideModelText.includes('activeAssemblyMode === "character"') && assemblyCanvasPaneText.includes('buildCharacterAssemblySceneFrame') && assemblyCanvasPaneText.includes('buildMechanismAssemblySceneFrame') && !assemblyCanvasPaneText.includes('{pkg && selectedRecipe && currentStep ?'), 'Assembly animation supports character and mechanism stages through DOM-free scene frames before generating PDF/HTML output');
assert(!existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyWorkbench.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'MechanismAssemblyWorkbench.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'CharacterAssemblyWorkbench.tsx')), 'legacy Assembly SVG workbench files are deleted rather than preserved as a second scene authority');
assert(assemblySceneFrameComponentText.includes('data-testid="assembly-readonly-step-strip"') && assemblySceneFrameComponentText.includes('data-assembly-motion-kind') && assemblySceneFrameComponentText.includes('data-mechanism-scene-contract-version') && assemblySceneFrameComponentText.includes('data-mechanism-graph-ir-version'), 'AssemblySceneFrame exposes a testable read-only scene contract strip');
assert(assemblySceneFrameText.includes('export const buildMechanismAssemblySceneFrame') && assemblySceneFrameText.includes('export const buildCharacterAssemblySceneFrame') && !assemblySceneFrameText.includes('document.') && !assemblySceneFrameText.includes('window.'), 'AssemblySceneFrame builders are DOM-free deterministic helpers');
{
  const sceneContractProbe = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism('4bar', 'scene-contract-graph-probe')));
  const sceneContract = buildLowLevelMechanismSceneContract(sceneContractProbe, undefined, sample.settings.physicalKit);
  const compiledMechanism = compileMechanism(sceneContractProbe, undefined, undefined, sample.settings.physicalKit);
  assert.equal(sceneContract.renderPlanSource, 'mechanismCompiler', 'MechanismSceneContract exposes compiler-owned render-plan authority');
  assert.equal(sceneContract.stackSource, 'mechanismCompiler', 'MechanismSceneContract exposes compiler-owned stack authority');
  assert.equal(sceneContract.graphCompiler.recipeCompilerSource, 'compileGraphFabricationRecipe', 'MechanismSceneContract forwards graph recipe compiler metadata');
  assert.deepEqual(sceneContract.layers.map(layer => `${layer.role}:${layer.source}:${layer.z}`), [compiledMechanism.fabrication.renderPlan.base, ...compiledMechanism.fabrication.renderPlan.layers].map(layer => `${layer.role}:${layer.source}:${layer.z}`), 'MechanismSceneContract layers are the compiled graph render plan without recomputed stage geometry');
  assert(sceneContract.layers.every(layer => layer.source === 'mechanism-graph'), 'MechanismSceneContract layers preserve graph-owned render sources');
}
assert(assemblyGeometryText.includes('export const assemblyCoordToSvg') && assemblyGeometryText.includes('export const characterBoardProjector') && !assemblyGeometryText.includes('<') && !assemblyGeometryText.includes('document.'), 'assemblyGeometry is a DOM-free deterministic helper seam');
assert(assemblyPlaybackText.includes('export const pendingRecipeForMechanism') && assemblyPlaybackText.includes('compileFabricationRecipe(project, mechanism)') && assemblyPlaybackText.includes('buildAssemblyPlaybackSteps'), 'Assembly recipe/playback derivation lives outside App.tsx and reuses the compiler fabrication recipe seam');
assert(assemblyGuideModelText.includes('export const buildAssemblyGuideModel') && assemblyGuideModelText.includes('pendingRecipeForMechanism') && assemblyGuideModelText.includes('buildCharacterAssemblyPlan') && assemblyGuideModelText.includes('resetKey: `${activeAssemblyMode}:${selectedRecipe?.mechanismId ?? "none"}:${lane}`') && !assemblyGuideModelText.includes('useState') && !assemblyGuideModelText.includes('window.') && !assemblyGuideModelText.includes('document.') && !assemblyGuideModelText.includes('dispatch('), 'Assembly guide model helper is a pure derivation seam for recipes, mode, steps, and reset key');
assert(
  assemblyBlock.includes('const {') &&
    assemblyBlock.includes('resetKey,') &&
    assemblyBlock.includes('buildAssemblyGuideModel({') &&
    (assemblyBlock.includes('createFabricationPackage(project)') || assemblyBlock.includes('createFabricationPackage(project, {')) &&
    assemblyBlock.includes('window.open') &&
    assemblyBlock.includes('downloadText'),
  'Assembly Guide keeps IO and pane wiring while delegating pure model derivation',
);
assert(assemblyPlaybackText.includes("motion: 'explode_z'") && assemblyPlaybackText.includes("motion: 'mount_travel_xy'") && assemblyPlaybackText.includes("motion: 'connect_travel_xy'") && assemblyPlaybackText.includes("motion: 'scrub_time'"), 'Assembly playback declares canonical visual motion modes for every build phase');
assert(assemblyControlPanelText.includes('data-testid="assembly-mode-switch"') && assemblyInspectorPanelText.includes('data-testid="character-assembly-inspector"'), 'Assembly tab exposes a character assembly sub-stage with a compact inspector');
assert(assemblySceneFrameText.includes("step.phase === 'fixed-pins'") && assemblySceneFrameText.includes("step.phase === 'free-pivots'") && assemblySceneFrameText.includes('activePins'), 'Character assembly frame separates fixed board pins from free limb pivots without a second SVG scene');
assert(assemblyControlPanelText.includes('activeAssemblyMode === "mechanism" &&') && assemblyControlPanelText.includes('data-testid="assembly-lane-switch"') && assemblyControlPanelText.includes('assembly-recipe-card text-left'), 'Character assembly mode hides mechanism-only lane and recipe controls');
assert(assemblyPlaybackText.includes('export const buildCharacterAssemblyPlan') && assemblyPlaybackText.includes("kind: 'character'") && assemblyPlaybackText.includes('mechanismAssemblySteps: []') && assemblyPlaybackText.includes('sceneToBoardRaw(joint.position') && assemblyPlaybackText.includes('board?.valid ? board.label : undefined'), 'Character assembly plan is derived separately from mechanism recipe steps and does not fake clamped board holes');
assert(assemblyBlock.includes('useAssemblyGuidePlayback') && !assemblyBlock.includes('stepProgressRef') && !assemblyBlock.includes('window.requestAnimationFrame(tick)'), 'Assembly Guide delegates playback timing/reset choreography to a harnessable hook seam');
assert(assemblyGuidePlaybackHookText.includes('export const useAssemblyGuidePlayback') && assemblyGuidePlaybackHookText.includes('setStepCount(activeStepCount)') && assemblyGuidePlaybackHookText.includes('const stepMs = 1400') && assemblyGuidePlaybackHookText.includes('window.requestAnimationFrame(tick)') && assemblyGuidePlaybackHookText.includes('setPlaying(false)'), 'Assembly playback hook preserves step count reporting, rAF progress timing, and reset-to-stopped behavior');
const assemblyGuideLiveModel = buildAssemblyGuideModel({ project: sample, selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuideLiveModel.selectedRecipe?.mechanismId, sample.mechanisms[0].id, 'Assembly guide model prefers live project mechanisms before package recipes');
assert.equal(assemblyGuideLiveModel.activeAssemblyMode, 'mechanism', 'Assembly guide model defaults to mechanism mode when a live recipe exists');
assert(assemblyGuideLiveModel.activeStepCount > 0 && assemblyGuideLiveModel.resetKey.includes(sample.mechanisms[0].id), 'Assembly guide model exposes active steps and a recipe-keyed reset key');
const secondAssemblyMechanism = mechanismWithGeneratedPath({ ...createDefaultMechanism('4bar', 'selected-assembly-mech'), anchorX: 80, anchorY: 40 });
const selectedAssemblyProject = { ...sample, mechanisms: [...sample.mechanisms, secondAssemblyMechanism], selectedMechanismId: secondAssemblyMechanism.id };
const selectedAssemblyModel = buildAssemblyGuideModel({ project: selectedAssemblyProject, selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(selectedAssemblyModel.selectedRecipe?.mechanismId, secondAssemblyMechanism.id, 'Assembly guide model follows selectedMechanismId so newly fitted mechanisms become the default build target');
const hiddenMechanismProject = { ...sample, mechanisms: sample.mechanisms.map(mechanism => ({ ...mechanism, visible: false })) };
const assemblyGuidePackageModel = buildAssemblyGuideModel({ project: hiddenMechanismProject, pkg: createFabricationPackage(sample), selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuidePackageModel.selectedRecipe?.mechanismId, sample.mechanisms[0].id, 'Assembly guide model falls back to exported package recipes when no mechanisms are live');
const assemblyGuideCharacterModel = buildAssemblyGuideModel({ project: sample, selectedRecipeId: null, assemblyMode: 'character', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuideCharacterModel.activeAssemblyMode, 'character', 'Assembly guide model switches to character assembly when requested and available');
assert(assemblyGuideCharacterModel.currentCharacterStep && assemblyGuideCharacterModel.resetKey.startsWith('character:'), 'Assembly guide model returns character steps and mode-aware reset key');
assert(assemblyBlock.includes('goAssemblyStep={goAssemblyStep}') && !assemblyBlock.includes('data-testid="assembly-player-overlay"'), 'Assembly tab keeps shared player step navigation and no duplicate local player');
assert(assemblySceneFrameText.includes('progress = 0') && assemblySceneFrameComponentText.includes('data-progress={Math.round(frame.progress * 100)}') && assemblyThreePreviewText.includes('data-assembly-three-progress={Math.round(progress * 100)}'), 'Assembly scene frame and Three preview receive live progress instead of moving a duplicate SVG module');
assert(assemblySceneFrameText.includes('motion: step.motion') && assemblySceneFrameText.includes("step.motion === 'explode_z'") && assemblySceneFrameText.includes("step.phase === 'test-character'"), 'Assembly scene frame visualizes parts, mounting, character connection, and test motion through canonical frame motion states');
assert(!assemblyBlock.includes('data-testid="assembly-guide-preview-frame"'), 'Assembly center no longer defaults to an iframe document preview');
assert(assemblyInspectorPanelText.includes('data-testid="assembly-guide-preview"'), 'Assembly tab keeps selected recipe detail in the right inspector');
assert.deepEqual(assemblyCoordToSvg('A1'), { x: 494, y: 142 }, 'assembly board coordinate A1 maps to SVG origin slot');
assert.deepEqual(assemblyCoordToSvg('O15'), { x: 746, y: 394 }, 'assembly board coordinate O15 maps to final board slot');
assert.equal(assemblyCoordToSvg('P1'), null, 'assembly board coordinate parser rejects non-15x15 columns');
assert.deepEqual(assemblyCoordToSvg('Q17', 20), { x: 782, y: 430 }, 'assembly board coordinate parser accepts larger kit coordinates when the active board supports them');
assert.equal(smoothAssemblyProgress(-1), 0, 'assembly progress easing clamps below zero');
assert.equal(smoothAssemblyProgress(0.5), 0.5, 'assembly progress easing preserves the midpoint');
assert.equal(smoothAssemblyProgress(2), 1, 'assembly progress easing clamps above one');
assert.equal(svgPathFromPoints([{ x: 0, y: 0 }, { x: 1, y: 2 }], point => ({ x: point.x + 10, y: point.y + 20 })), 'M 10.0 20.0 L 11.0 22.0 Z', 'assembly path helper is deterministic and projection-driven');
assert(trackingModalSource.includes("from '../utils/trackingPath'") && !trackingModalSource.includes('segmentsPerEdge = 20'), 'Tracking modal delegates path smoothing/normalization to a DOM-free helper seam');
assert.deepEqual(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], { enabled: true }), [{ x: 0, y: 0 }, { x: 10, y: 0 }], 'tracking smoothing leaves short manual paths unchanged');
assert.equal(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { connectEndPoints: true, segmentsPerEdge: 2 }).length, 6, 'closed tracking smoothing samples every wrapped segment');
assert.equal(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { connectEndPoints: false, segmentsPerEdge: 2 }).length, 5, 'open tracking smoothing samples edge segments and preserves the final point');
assert.deepEqual(
  trackingPointsToWorldPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], { enabled: false, connectEndPoints: true }),
  [{ x: -90, y: 45 }, { x: 90, y: 45 }, { x: 90, y: -45 }, { x: -90, y: -45 }, { x: -90, y: 45 }],
  'tracking path transfer centers, scales, flips Y, and closes the polyline exactly once'
);
const roundAssemblyPoint = (point: { x: number; y: number }) => ({ x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) });
const projectorPlan: CharacterAssemblyPlan = {
  kind: 'character',
  parts: [{ id: 'torso', name: 'Torso', fillColor: '#ffffff', outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], pivot: { x: 0, y: 0 } }],
  fixedPins: [
    { id: 'fixed-a', jointId: 'a', label: 'A', role: 'fixed_pin', scene: { x: 0, y: 0 }, boardCoordinate: 'A1', partIds: [], partNames: [], stack: [] },
    { id: 'fixed-b', jointId: 'b', label: 'B', role: 'fixed_pin', scene: { x: 100, y: 0 }, boardCoordinate: 'B1', partIds: [], partNames: [], stack: [] }
  ],
  freePivots: [],
  steps: [],
  mechanismAssemblySteps: [],
  boardCells: 15
};
const pairedBoardProjector = characterBoardProjector(projectorPlan);
assert.equal(pairedBoardProjector.anchorPinId, 'fixed-a', 'assembly board projector anchors to the first valid fixed pin pair');
assert.equal(pairedBoardProjector.anchorBoardCoordinate, 'A1', 'assembly board projector preserves the board anchor label');
assert.deepEqual(roundAssemblyPoint(pairedBoardProjector.project({ x: 100, y: 0 })), { x: 512, y: 142 }, 'assembly board projector maps the second fixed pin onto its board hole');
assert.deepEqual(roundAssemblyPoint(pairedBoardProjector.project({ x: 0, y: 100 })), { x: 494, y: 160 }, 'assembly board projector keeps pair-derived rotation and scale deterministic');
const oneAnchorBoardProjector = characterBoardProjector({ ...projectorPlan, fixedPins: [projectorPlan.fixedPins[0]] });
assert.equal(oneAnchorBoardProjector.anchorPinId, 'fixed-a', 'assembly board projector falls back to a single fixed pin anchor');
assert.deepEqual(roundAssemblyPoint(oneAnchorBoardProjector.project({ x: 10, y: 10 })), { x: 516, y: 164 }, 'single-anchor assembly projector uses the fit scale deterministically');
const noAnchorBoardProjector = characterBoardProjector({ ...projectorPlan, fixedPins: [] });
assert.equal(noAnchorBoardProjector.anchorPinId, undefined, 'assembly board projector supports no-anchor fit mode');
assert.deepEqual(roundAssemblyPoint(noAnchorBoardProjector.project({ x: 0, y: 0 })), { x: 508, y: 156 }, 'no-anchor assembly projector centers the character on the board work area');
const canvasProject = characterCanvasProjector(projectorPlan);
assert.deepEqual(roundAssemblyPoint(canvasProject({ x: 0, y: 0 })), { x: 96, y: 136 }, 'assembly canvas projector centers fixture bounds in the character tray');
assert.deepEqual(roundAssemblyPoint(canvasProject({ x: 100, y: 100 })), { x: 396, y: 436 }, 'assembly canvas projector preserves deterministic tray scale');
const characterAssemblyPlan = buildCharacterAssemblyPlan(starterSample);
assert.equal(characterAssemblyPlan.kind, 'character', 'character assembly plan carries a distinct stage kind');
assert(characterAssemblyPlan.parts.length >= 10, 'character assembly plan includes the full starter body-part set');
assert(characterAssemblyPlan.fixedPins.length > 0, 'character assembly plan identifies board-fixed pins');
assert(characterAssemblyPlan.freePivots.length > 0, 'character assembly plan identifies free limb pivots');
assert(characterAssemblyPlan.fixedPins.every(pin => pin.boardCoordinate && /^[A-O]([1-9]|1[0-5])$/.test(pin.boardCoordinate)), 'fixed character pins map to readable 15x15 board coordinates');
assert(characterAssemblyPlan.freePivots.every(pin => !pin.boardCoordinate), 'free character pivots are never mislabeled as board holes');
assert(characterAssemblyPlan.fixedPins.every(pin => fabricationBoardCoordinateCallout(pin.boardCoordinate ?? '', pin.board).includes('row') && fabricationBoardCoordinateCallout(pin.boardCoordinate ?? '', pin.board).includes('column')), 'fixed character pins expose row/column callouts for board assembly');
assert.deepEqual(characterAssemblyPlan.mechanismAssemblySteps, [], 'character assembly does not reuse mechanism recipe steps');
const oversizedCutPart: BodyPartLayer = {
  id: 'right_arm_lower',
  name: 'Right lower arm',
  anchorJointId: 'right_elbow',
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  zIndex: 0,
  opacity: 1,
  visible: true,
  locked: false,
  selectable: true,
  bounds: { x: -250, y: -250, width: 500, height: 500 },
  fillColor: '#cbd5e1'
};
const oversizedLocalJoints = [{ x: 0, y: 84 }, { x: 0, y: -84 }];
const oversizedOutlineBounds = partOutlineBounds(fabricablePartOutlinePoints(oversizedCutPart, oversizedLocalJoints));
assert(oversizedOutlineBounds.width < 90 && oversizedOutlineBounds.height < 260, 'fabrication-fit outline follows the limb joint chain rather than the full raw ONNX crop');
const userContourPart: BodyPartLayer = {
  ...oversizedCutPart,
  contourSource: 'user',
  contourPoints: [{ x: -12, y: -18 }, { x: 30, y: -10 }, { x: 20, y: 28 }, { x: -22, y: 18 }]
};
assert.deepEqual(fabricablePartOutlinePoints(userContourPart, oversizedLocalJoints), userContourPart.contourPoints, 'user/model contour overrides fallback joint-chain plate generation');
const invalidContourPart: BodyPartLayer = {
  ...oversizedCutPart,
  contourSource: 'user',
  contourPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
};
const invalidFallbackBounds = partOutlineBounds(fabricablePartOutlinePoints(invalidContourPart, oversizedLocalJoints));
assert(invalidFallbackBounds.width > 20 && invalidFallbackBounds.height > 100, 'degenerate imported contours fall back to the joint-chain plate instead of creating invisible geometry');
const contourRoundTripProject = loadProjectSnapshot(JSON.parse(serializeProject({
  ...sample,
  parts: { ...sample.parts, head: { ...sample.parts.head, contourSource: 'user', contourPoints: userContourPart.contourPoints } }
})));
assert.deepEqual(contourRoundTripProject.parts.head.contourPoints, userContourPart.contourPoints, 'project save/load preserves user-defined part contour points');
const editedContourProject = applyProjectAction(sample, { type: 'update_part', partId: 'head', updates: { contourSource: 'user', contourPoints: [{ x: -18, y: -24 }, { x: 24, y: -18 }, { x: 30, y: 28 }, { x: -20, y: 30 }] } });
assert.deepEqual(fabricablePartOutlinePoints(editedContourProject.parts.head, partLandmarkLocalPoints(editedContourProject.parts.head, editedContourProject.skeleton)), editedContourProject.parts.head.contourPoints, 'character cut editor updates the shared fabrication outline used by every renderer/exporter');
const packageContourProject = createProjectFromPackageData(
  { parts: { head: { name: 'Head', roi: [0, 0, 80, 80], anchor_joint_id: 'neck', contour_points: userContourPart.contourPoints, contour_source: 'user' } } },
  { width: 160, height: 160, joints: sample.skeleton!.joints, bones: sample.skeleton!.bones, root_joint_ids: sample.skeleton!.rootJointIds },
  {},
  'contour package'
);
assert.deepEqual(packageContourProject.parts.head.contourPoints, userContourPart.contourPoints, 'package import preserves explicit contour points from parts_info');
const sampleWideArm: BodyPartLayer = { ...oversizedCutPart, transform: { x: 0, y: 0, rotation: 0, scale: 1 }, anchorJointId: 'right_elbow' };
assert.deepEqual(partLandmarkJointIds(sampleWideArm, sample.skeleton), ['right_elbow', 'right_hand'], 'oversized lower-arm crop selects only the intended elbow/hand landmarks');
const productionArmLandmarks = partLandmarkLocalPoints(sampleWideArm, sample.skeleton);
const productionArmOutline = fabricablePartOutlinePoints(sampleWideArm, productionArmLandmarks);
const productionArmBounds = partOutlineBounds(productionArmOutline);
assert(productionArmLandmarks.length === 2, 'production 3D outline path ignores unrelated joints inside an oversized ONNX crop');
assert(productionArmBounds.width < 120 && productionArmBounds.height < 140, 'production lower-arm outline stays limb-sized even when the crop contains the full character');
assert(productionArmLandmarks.every(point => pointInsideOutline(point, productionArmOutline, 0.5)), '3D puppet only cuts joint holes inside the generated part outline');
const torsoCutPart: BodyPartLayer = { ...oversizedCutPart, id: 'torso', name: 'Torso', anchorJointId: 'torso' };
const torsoOutlineBounds = partOutlineBounds(fabricablePartOutlinePoints(torsoCutPart, [{ x: -70, y: 90 }, { x: 70, y: 90 }, { x: -42, y: -74 }, { x: 42, y: -74 }, { x: 0, y: 16 }]));
assert(torsoOutlineBounds.width < 230 && torsoOutlineBounds.height < 250, 'torso fabrication outline is compact around skeleton landmarks rather than a background image slab');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_elbow').kind, 'root-only', 'root anchor is labeled as a root-only chain');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand').kind, 'two-joint-direct', 'hand handle is labeled as a 2-joint direct chain by default');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand', { rootJointId: 'right_shoulder' }).kind, 'three-joint-ik', 'expanded shoulder root enables 3-joint IK');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_hand', { rootJointId: 'right_elbow' }).kind, 'two-joint-direct', 'path-specific chain roots shorten the solver chain');
assert.equal(describeMotionChain(sample, 'right_arm_lower', 'right_elbow', { rootJointId: 'right_elbow' }).kind, 'root-only', 'path-specific root equal to handle is explicitly root-only');
const directPinnedPreview = motionPreviewForTarget(sample, 'right_arm_lower', 'right_hand', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: true });
const directPinnedHand = directPinnedPreview.skeleton?.joints.right_hand.position;
assert(directPinnedHand && Math.hypot(directPinnedHand.x - 210, directPinnedHand.y - 40) < 1e-9, '2-joint direct mechanism drive pins the handle exactly');
const directPreview = motionPreviewForTarget(sample, 'right_arm_lower', 'right_hand', { x: 210, y: 40 }, { parts: {}, skeleton: sample.skeleton }, { pinTarget: false });
const directPreviewHand = directPreview.skeleton?.joints.right_hand.position;
assert(directPreviewHand && Math.hypot(directPreviewHand.x - 210, directPreviewHand.y - 40) > 1, '2-joint direct path preview preserves non-pinned limb length');
const rightArmSide = Math.sign((sample.skeleton?.joints.right_hand.position.x ?? 0) - (sample.skeleton?.joints.right_shoulder.position.x ?? 0)) || 1;
const bendDirectionTarget = { x: rightArmSide * 180, y: 90 };
const rightBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: 1 } });
const leftBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: -1 } });
const rightBendPreview = motionPreviewForTarget(rightBendProject, 'right_arm_lower', 'right_hand', bendDirectionTarget, { parts: {}, skeleton: rightBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
const leftBendPreview = motionPreviewForTarget(leftBendProject, 'right_arm_lower', 'right_hand', bendDirectionTarget, { parts: {}, skeleton: leftBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
const rightBendElbow = rightBendPreview.skeleton?.joints.right_elbow.position;
const leftBendElbow = leftBendPreview.skeleton?.joints.right_elbow.position;
assert(rightBendElbow && leftBendElbow && Math.hypot(rightBendElbow.x - leftBendElbow.x, rightBendElbow.y - leftBendElbow.y) > 1, '3-joint IK fold direction changes elbow/knee side');
const multiJointProject = applyProjectAction(sample, { type: 'add_joint', joint: { id: 'right_finger_tip', name: 'right finger tip', position: { x: 174, y: 30 }, parentId: 'right_hand', locked: false, bendDirection: 1 } });
assert.equal(describeMotionChain(multiJointProject, 'right_arm_lower', 'right_finger_tip', { rootJointId: 'right_shoulder' }).kind, 'multi-joint', '4+ joint limbs are labeled as multi-joint IK');
const multiPreview = motionPreviewForTarget(multiJointProject, 'right_arm_lower', 'right_finger_tip', { x: 205, y: 84 }, { parts: {}, skeleton: multiJointProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
assert(Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.x) && Number.isFinite(multiPreview.skeleton?.joints.right_finger_tip.position.y), 'multi-joint IK preview stays finite');
assert(Math.hypot((multiPreview.skeleton?.joints.right_elbow.position.x ?? 0) - (multiJointProject.skeleton?.joints.right_elbow.position.x ?? 0), (multiPreview.skeleton?.joints.right_elbow.position.y ?? 0) - (multiJointProject.skeleton?.joints.right_elbow.position.y ?? 0)) > 1, 'multi-joint IK updates intermediate body-chain joints instead of only moving the distal handle');
const boundMechanism = (type: Parameters<typeof createDefaultMechanism>[0], id: string) => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_hand_part']
});
const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
assert.equal(roundTrip.partOrder.length, sample.partOrder.length, 'project JSON round-trip keeps parts');
assert.equal(roundTrip.mechanisms.length, sample.mechanisms.length, 'project JSON round-trip keeps mechanisms');
assert.equal(roundTrip.mechanisms[0].assemblyMode, sample.mechanisms[0].assemblyMode, 'project JSON round-trip keeps explicit 4bar assembly branch');
assert.equal(loadProjectSnapshot({ mechanisms: [{ ...createDefaultMechanism('4bar', 'crossed-load'), assemblyMode: 'crossed' }] }).mechanisms[0].assemblyMode, 'crossed', 'project import preserves crossed 4bar assembly branch');
const graphInjectedLoad = loadProjectSnapshot({ mechanisms: [{ ...createDefaultMechanism('4bar', 'graph-injected-load'), graph: { bogus: true }, graphCompiler: { bogus: true }, mechanismGraph: { bogus: true }, graphIr: { bogus: true }, compiledMechanism: { bogus: true }, compiledGraph: { bogus: true } }] });
assert(!('graph' in graphInjectedLoad.mechanisms[0]) && !('graphCompiler' in graphInjectedLoad.mechanisms[0]) && !('mechanismGraph' in graphInjectedLoad.mechanisms[0]) && !('graphIr' in graphInjectedLoad.mechanisms[0]) && !('compiledMechanism' in graphInjectedLoad.mechanisms[0]) && !('compiledGraph' in graphInjectedLoad.mechanisms[0]), 'project import strips derived mechanism compiler outputs instead of persisting them');
const topLevelGraphInjectedLoad = loadProjectSnapshot({
  ...JSON.parse(serializeProject(createEmptyProject())),
  graph: { bogus: true },
  graphCompiler: { bogus: true },
  mechanismGraph: { bogus: true },
  graphIr: { bogus: true },
  compiledMechanism: { bogus: true },
  compiledGraph: { bogus: true },
  compilerSource: 'mechanismCompiler',
  graphValidationDiagnostics: [{ bogus: true }],
  motionSamples: [{ bogus: true }],
  feasibleRange: { bogus: true },
  readinessErrors: ['bogus'],
  fabrication: { bogus: true },
  nodes: [{ bogus: true }],
  constraints: [{ bogus: true }],
  drivers: [{ bogus: true }],
  diagnostics: [{ bogus: true }],
  family: { bogus: true },
  solver: 'constraint-graph',
  persisted: false,
  mechanismId: 'bogus',
  mechanismType: '4bar',
  irVersion: 'bogus',
  graphId: 'bogus',
  recipeCompilerSource: 'compileGraphFabricationRecipe'
});
const topLevelGraphInjectedSerialized = serializeProject(topLevelGraphInjectedLoad);
assert(!('graph' in topLevelGraphInjectedLoad) && !('graphCompiler' in topLevelGraphInjectedLoad) && !('mechanismGraph' in topLevelGraphInjectedLoad) && !('graphIr' in topLevelGraphInjectedLoad) && !('compiledMechanism' in topLevelGraphInjectedLoad) && !('compiledGraph' in topLevelGraphInjectedLoad) && !('compilerSource' in topLevelGraphInjectedLoad) && !('fabrication' in topLevelGraphInjectedLoad) && !('mechanismType' in topLevelGraphInjectedLoad) && !('irVersion' in topLevelGraphInjectedLoad) && !('graphId' in topLevelGraphInjectedLoad) && !('recipeCompilerSource' in topLevelGraphInjectedLoad), 'project import strips top-level mechanism compiler outputs before they enter ProjectState');
assert(!topLevelGraphInjectedSerialized.includes('"graph"') && !topLevelGraphInjectedSerialized.includes('"graphCompiler"') && !topLevelGraphInjectedSerialized.includes('"mechanismGraph"') && !topLevelGraphInjectedSerialized.includes('"graphIr"') && !topLevelGraphInjectedSerialized.includes('"compiledMechanism"') && !topLevelGraphInjectedSerialized.includes('"compiledGraph"') && !topLevelGraphInjectedSerialized.includes('"compilerSource"') && !topLevelGraphInjectedSerialized.includes('"motionSamples"') && !topLevelGraphInjectedSerialized.includes('"fabrication"') && !topLevelGraphInjectedSerialized.includes('"mechanismType"') && !topLevelGraphInjectedSerialized.includes('"irVersion"') && !topLevelGraphInjectedSerialized.includes('"graphId"') && !topLevelGraphInjectedSerialized.includes('"recipeCompilerSource"'), 'serialized ProjectState cannot re-emit injected top-level compiler outputs');

const originBoard = sceneToBoard({ x: 0, y: 0 }, sample.settings.physicalKit);
assert.equal(originBoard.label, 'H8', 'scene origin maps to centered 15x15 board H8');
const sheetRoundTrip = sheetMmToScene(sceneToSheetMm({ x: 40, y: -80 }, sample.settings.physicalKit), sample.settings.physicalKit);
assert(Math.hypot(sheetRoundTrip.x - 40, sheetRoundTrip.y + 80) < 1e-9, 'scene/sheet transform round-trips');
const boardRoundTrip = boardToScene(originBoard.col, originBoard.row, sample.settings.physicalKit);
assert.deepEqual(boardRoundTrip, { x: 0, y: 0 }, 'board center round-trips');

const elbowPathOrigin = sample.skeleton!.joints.right_elbow.position;
const twoFourBars = {
  ...sample,
  paths: {
    ...sample.paths,
    'path-right-elbow': {
      ...sample.paths['path-right-arm'],
      id: 'path-right-elbow',
      partId: 'right_arm_lower',
      targetAnchorJointId: 'right_elbow',
      chainRootJointId: 'right_elbow',
      points: [
        elbowPathOrigin,
        { x: elbowPathOrigin.x + 24, y: elbowPathOrigin.y },
        { x: elbowPathOrigin.x + 24, y: elbowPathOrigin.y + 24 },
        { x: elbowPathOrigin.x, y: elbowPathOrigin.y + 24 }
      ]
    }
  },
  mechanisms: [
    boundMechanism('4bar', 'a'),
    {
      ...boundMechanism('4bar', 'b'),
      anchorX: -120,
      anchorY: 120,
      sceneAnchor: { x: -120, y: 120 },
      transform: { x: -120, y: 120, rotation: 0, scale: 1 },
      targetPartId: 'right_arm_lower',
      targetPathId: 'path-right-elbow',
      targetAnchorJointId: 'right_elbow',
      activeVisualPartIds: ['right_arm_lower']
    }
  ]
};
const pkg = createFabricationPackage(twoFourBars);
assert.equal(directMakeBlueprintSvg(twoFourBars, pkg.recipes), makeBlueprintSvg(twoFourBars, pkg.recipes), 'fabrication facade preserves the direct printable Blueprint SVG renderer');
assert.equal(directMakeBlueprintPreviewSvg(twoFourBars, pkg.recipes), makeBlueprintPreviewSvg(twoFourBars, pkg.recipes), 'fabrication facade preserves the direct readable Blueprint preview renderer');
assert.equal(selectBlueprintRecipe(pkg.recipes, null, 'b')?.mechanismId, 'b', 'Blueprint detail recipe selection follows the selected live mechanism when no recipe tile was clicked');
assert.equal(selectBlueprintRecipe(pkg.recipes, 'a', 'b')?.mechanismId, 'a', 'Blueprint detail recipe selection lets an explicit recipe tile override the selected live mechanism');
const editedAssemblyMechanism = {
  ...boundMechanism('4bar', 'assembly-stack-edited'),
  crankLength: linkageSceneLengthByCells(4),
  couplerLength: linkageSceneLengthByCells(6),
  rockerLength: linkageSceneLengthByCells(4)
};
const editedAssemblyProject = { ...sample, mechanisms: [editedAssemblyMechanism] };
const editedAssemblyRecipe = compileFabricationRecipe(editedAssemblyProject, editedAssemblyMechanism);
const editedAssemblyHtml = directMakeAssemblyGuideHtml(editedAssemblyProject, [editedAssemblyRecipe], []);
assert(editedAssemblyHtml.includes('Input 5-hole link') && editedAssemblyHtml.includes('Coupler 7-hole link') && !editedAssemblyHtml.includes('Input 3-hole link'), 'Assembly exploded guide reads edited recipe stack labels instead of recomputing default four-bar sizes');
const camBlueprintProject = { ...sample, mechanisms: [boundMechanism('cam', 'blueprint-cam-module')] };
const camBlueprintRecipe = compileFabricationRecipe(camBlueprintProject, camBlueprintProject.mechanisms[0]);
const camBlueprintPreview = directMakeBlueprintPreviewSvg(camBlueprintProject, [camBlueprintRecipe]);
assert(camBlueprintPreview.includes('data-blueprint-icon="cam-module"'), 'Blueprint preview draws cam module parts with a distinct cam icon');
assert(camBlueprintPreview.includes('data-blueprint-icon="guide-cartridge"'), 'Blueprint preview draws the U-channel guide cartridge with a distinct guide icon');
assert(camBlueprintPreview.includes('data-blueprint-icon="gravity-follower"'), 'Blueprint preview draws the gravity follower with a distinct follower icon');
const editedCamBlueprintProject = { ...sample, mechanisms: [{ ...boundMechanism('cam', 'blueprint-cam-edited'), camProfileSamples: [0.72, 1.48, 0.7, 0.56, 0.82, 1.08, 0.74, 0.62] }] };
const editedCamBlueprintRecipe = compileFabricationRecipe(editedCamBlueprintProject, editedCamBlueprintProject.mechanisms[0]);
const defaultCamPhysicalBlueprint = directMakeBlueprintSvg(camBlueprintProject, [camBlueprintRecipe]);
const editedCamPhysicalBlueprint = directMakeBlueprintSvg(editedCamBlueprintProject, [editedCamBlueprintRecipe]);
const editedCamPreviewBlueprint = directMakeBlueprintPreviewSvg(editedCamBlueprintProject, [editedCamBlueprintRecipe]);
const editedCamAssemblyHtml = directMakeAssemblyGuideHtml(editedCamBlueprintProject, [editedCamBlueprintRecipe], []);
assert.deepEqual(editedCamBlueprintRecipe.camProfileSamples, editedCamBlueprintProject.mechanisms[0].camProfileSamples, 'fabrication recipe carries edited cam profile samples into Blueprint and Assembly');
assert.notEqual(defaultCamPhysicalBlueprint, editedCamPhysicalBlueprint, 'physical Blueprint SVG changes when the cam disk profile is edited');
assert(editedCamPreviewBlueprint.includes('data-cam-profile=') && editedCamPreviewBlueprint.includes(editedCamBlueprintProject.mechanisms[0].camProfileSamples!.join(',')), 'readable Blueprint preview labels the edited cam disk profile');
assert(editedCamAssemblyHtml.includes('data-assembly-cam-profile') && editedCamAssemblyHtml.includes(editedCamBlueprintProject.mechanisms[0].camProfileSamples!.join(',')), 'Assembly guide exploded cam disk uses the edited cam profile');
const secondCamProfile = [0.88, 1.36, 1.05, 0.68, 0.74, 1.22, 1.1, 0.82];
const multiCamBlueprintProject = {
  ...sample,
  mechanisms: [
    boundMechanism('4bar', 'blueprint-fourbar-first'),
    { ...boundMechanism('cam', 'blueprint-cam-second'), camProfileSamples: secondCamProfile }
  ]
};
const multiCamBlueprintRecipes = multiCamBlueprintProject.mechanisms.map(mechanism => compileFabricationRecipe(multiCamBlueprintProject, mechanism));
const multiCamAssemblyHtml = directMakeAssemblyGuideHtml(multiCamBlueprintProject, multiCamBlueprintRecipes, []);
assert(multiCamAssemblyHtml.includes(secondCamProfile.join(',')), 'Assembly guide includes the edited cam profile even when the cam recipe is not the first recipe');
const twoCamProfiles = [[0.82, 1.4, 0.74, 0.66, 0.92, 1.18, 0.9, 0.72], [1.08, 0.8, 1.34, 0.7, 0.86, 1.26, 0.76, 0.94]];
const twoCamBlueprintProject = {
  ...sample,
  mechanisms: twoCamProfiles.map((profile, index) => ({ ...boundMechanism('cam', `blueprint-cam-${index + 1}`), camProfileSamples: profile }))
};
const twoCamBlueprintRecipes = twoCamBlueprintProject.mechanisms.map(mechanism => compileFabricationRecipe(twoCamBlueprintProject, mechanism));
const twoCamPhysicalBlueprint = directMakeBlueprintSvg(twoCamBlueprintProject, twoCamBlueprintRecipes);
const twoCamPreviewBlueprint = directMakeBlueprintPreviewSvg(twoCamBlueprintProject, twoCamBlueprintRecipes);
assert(twoCamProfiles.every(profile => twoCamPhysicalBlueprint.includes(profile.join(','))), 'physical Blueprint SVG keeps every edited cam profile instead of using first-cam-wins');
assert(twoCamProfiles.every(profile => twoCamPreviewBlueprint.includes(profile.join(','))), 'readable Blueprint preview keeps every edited cam profile instead of using first-cam-wins');
const idlerGearBlueprintProject = {
  ...sample,
  mechanisms: [{
    ...boundMechanism('gear', 'blueprint-gear-idler'),
    crankLength: gearSceneRadiusByKey('g40'),
    rockerLength: gearSceneRadiusByKey('g24'),
    gearTrainRadii: [gearSceneRadiusByKey('g40'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g24')]
  }]
};
const idlerGearBlueprintRecipe = compileFabricationRecipe(idlerGearBlueprintProject, idlerGearBlueprintProject.mechanisms[0]);
const idlerGearBlueprintPreview = directMakeBlueprintPreviewSvg(idlerGearBlueprintProject, [idlerGearBlueprintRecipe]);
assert((idlerGearBlueprintPreview.match(/data-blueprint-board-coordinate=/g)?.length ?? 0) >= 3, 'Blueprint preview marks every board build spot from inserted gear train idlers, not just the main axle');
const idlerGearPhysicalBlueprint = directMakeBlueprintSvg(idlerGearBlueprintProject, [idlerGearBlueprintRecipe]);
assert((idlerGearPhysicalBlueprint.match(/data-blueprint-board-coordinate=/g)?.length ?? 0) >= 3, 'physical Blueprint SVG marks every gear train board build spot for print alignment');
const visibleCharacterPartIds = twoFourBars.partOrder.filter(partId => twoFourBars.parts[partId]?.visible);
const characterPrintLayout = directBuildCharacterPrintLayout(twoFourBars);
assert.equal(characterPrintLayout.parts.length, visibleCharacterPartIds.length, 'character print layout includes every visible character part exactly once');
assert(characterPrintLayout.scale > 0 && characterPrintLayout.scale <= 1, 'character print layout keeps a bounded positive page scale');
assert(characterPrintLayout.pageCount >= 1 && characterPrintLayout.pageCount <= 2, 'character print layout fits on one or two letter pages');
assert(characterPrintLayout.partPaddingMm >= 4, 'character print layout keeps spacing between cut parts');
assert(characterPrintLayout.holeRadiusMm >= 0.5, 'character print layout keeps printable joint holes above the minimum radius');
assert(characterPrintLayout.parts.every(item => visibleCharacterPartIds.includes(item.part.id) && item.pageIndex >= 0 && item.pageIndex < characterPrintLayout.pageCount && item.outlineMm.length >= 3 && item.holeMm.length > 0), 'character print layout emits printable outlines and holes for visible parts');
const layoutBounds = (points: Point[]) => ({
  minX: Math.min(...points.map(point => point.x)),
  maxX: Math.max(...points.map(point => point.x)),
  minY: Math.min(...points.map(point => point.y)),
  maxY: Math.max(...points.map(point => point.y))
});
const boxesOverlap = (a: ReturnType<typeof layoutBounds>, b: ReturnType<typeof layoutBounds>) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
characterPrintLayout.parts.forEach((item, index) => {
  const bounds = layoutBounds(item.outlineMm);
  assert(bounds.minX >= 0 && bounds.maxX <= twoFourBars.settings.physicalKit.sheetWidthMm && bounds.minY >= 0 && bounds.maxY <= twoFourBars.settings.physicalKit.sheetHeightMm, `character print layout keeps ${item.part.id} inside its letter page`);
  characterPrintLayout.parts.slice(index + 1).filter(other => other.pageIndex === item.pageIndex).forEach(other => {
    assert(!boxesOverlap(bounds, layoutBounds(other.outlineMm)), `character print layout separates ${item.part.id} from ${other.part.id}`);
  });
});
const lowerArmPrintLayout = characterPrintLayout.parts.find(item => item.part.id === 'right_arm_lower');
assert(lowerArmPrintLayout && Number.isFinite(lowerArmPrintLayout.printCenterMm.x) && Number.isFinite(lowerArmPrintLayout.printCenterMm.y), 'character print layout keeps known sample part placement finite');
assert.equal(lowerArmPrintLayout?.outlineMm.length, 14, 'character print layout preserves the editable right lower arm outline');
assert.equal(lowerArmPrintLayout?.holeMm.length, 2, 'character print layout preserves the right lower arm joint holes');
assert(simplePdfDocument('BT ET').startsWith('%PDF-1.4'), 'simplePdf creates a PDF document');
assert(simplePdfDocument(['BT (A) Tj ET', 'BT (B) Tj ET']).includes('/Count 2'), 'simplePdf supports bounded two-page character sheets');
const simplePdfSinglePage = simplePdfMakeSimplePdf('Title', ['Line']);
assert(simplePdfSinglePage.startsWith('%PDF-1.4') && simplePdfSinglePage.includes('(Title)') && simplePdfSinglePage.includes('(Line)'), 'simplePdf single-page helper preserves visible text lines');
assert.equal(simplePdfEscapeText('A · B (C) \\ D'), 'A / B \\(C\\) \\\\ D', 'simplePdf text escapes PDF syntax and middle dots');
assert.equal(simplePdfNum(Number.NaN), '0', 'simplePdf number helper clamps non-finite values');
assert(simplePdfCirclePath(1, 2, 3).endsWith(' c h'), 'simplePdf circle helper emits a closed Bezier path');
assert.equal(simplePdfHexRgb('#336699'), '0.20 0.40 0.60', 'simplePdf converts safe hex colors to PDF RGB');
assert.equal(simplePdfHexRgb('bad'), '0.35 0.42 1.00', 'simplePdf falls back to MotionSmith blue for invalid PDF colors');
assert.equal(pkg.recipes.length, 2, 'duplicate same-type mechanisms create separate recipes');
assert(pkg.sceneSnapshot.skeleton, 'fabrication snapshot includes skeleton');
assert(pkg.cutSheetPdf.startsWith('%PDF-') && pkg.cutSheetPdf.includes('Cut sheet'), 'fabrication package includes a real PDF cut sheet artifact');
assert.equal(directMakeCutSheetPdf(twoFourBars, pkg.recipes), pkg.cutSheetPdf, 'fabrication package preserves the direct cut-sheet PDF artifact');
assert(pkg.assemblyGuidePdf.startsWith('%PDF-'), 'fabrication package includes a PDF assembly artifact');
assert.equal(directMakeAssemblyGuideHtml(twoFourBars, pkg.recipes, pkg.warnings), pkg.assemblyGuideHtml, 'fabrication package preserves the direct assembly guide HTML artifact');
assert.equal(directMakeAssemblyGuidePdf(twoFourBars, pkg.recipes, pkg.warnings), pkg.assemblyGuidePdf, 'fabrication package preserves the direct assembly guide PDF artifact');
assert.equal(directMakeCustomPartsSvg(twoFourBars), pkg.customPartsSvg, 'fabrication package preserves the direct custom parts SVG artifact');
assert.equal(directMakeCustomPartsPdf(twoFourBars), pkg.customPartsPdf, 'fabrication package preserves the direct custom parts PDF artifact');
assert.equal(directMakeCustomPartsStl(twoFourBars), pkg.customPartsStl, 'fabrication package preserves the direct custom parts STL artifact');
assert(pkg.customPartsSvg.startsWith('<svg') && pkg.customPartsSvg.includes('custom-parts'), 'fabrication package includes custom parts SVG artifact');
assert(pkg.customPartsSvg.includes(`width="${twoFourBars.settings.physicalKit.sheetWidthMm}mm"`) && pkg.customPartsSvg.includes(`data-character-print-page-count="${characterPrintLayout.pageCount}"`), 'character custom parts SVG is fixed to one or two letter-size pages');
assert(pkg.customPartsSvg.includes(`viewBox="0 0 ${twoFourBars.settings.physicalKit.sheetWidthMm} ${twoFourBars.settings.physicalKit.sheetHeightMm * characterPrintLayout.pageCount}"`), 'character custom parts SVG uses stacked letter page coordinate systems');
assert(pkg.customPartsSvg.includes('data-character-print-page="letter"') && pkg.customPartsSvg.includes('data-character-print-mode="whole-character-exploded"'), 'character custom parts SVG declares whole-character exploded print mode');
assert(pkg.customPartsSvg.includes('data-character-exploded-sheet'), 'character custom parts SVG groups all parts on one exploded sheet');
visibleCharacterPartIds.forEach(partId => {
  assert(pkg.customPartsSvg.includes(`data-part-id="${partId}"`), `character custom parts SVG includes visible part ${partId} on the bounded character sheet`);
});
assert(pkg.customPartsPdf.startsWith('%PDF-') && pkg.customPartsPdf.includes('character-sheet-page-count'), 'fabrication package includes a bounded character PDF artifact');
assert(pkg.customPartsStl.startsWith('solid motionsmith_custom_parts'), 'fabrication package includes custom parts STL artifact');
assert(pkg.customPartsStl.includes('mm_holes') && (pkg.customPartsStl.match(/facet normal/g) ?? []).length > 100, 'custom parts STL meshes extruded plates with joint-hole voids');
assert(pkg.metadataJson.includes('validationIssues'), 'fabrication metadata includes structured validation issues');
assert(pkg.recipes.every(r => r.requiredParts.length > 0), 'fabrication recipes include explicit required parts');
assert.deepEqual(pkg.recipes[0], compileFabricationRecipe(twoFourBars, twoFourBars.mechanisms[0]), 'fabrication package recipes are emitted by the graph compiler facade');
assert.equal(pkg.recipes[0].type, 'graph', 'fabrication package uses graph-owned mechanism recipes');
assert(pkg.recipes[0].requiredParts.some(part => part.name === fabricationPartDisplayLabel(FABRICATION_SPACER_SPEC.label)), 'required parts name the S10 spacer explicitly');
assert(pkg.recipes[0].requiredParts.some(part => part.name.includes('hole link')), 'required parts use student-readable hole-count linkage names');
assert(pkg.recipes[0].assemblySteps.some(step => step.role === 'place-fastener' && step.coordRoles?.includes('board')), 'graph board workflow starts from board-snapped fastener steps');
assert(pkg.recipes[0].assemblySteps.some(step => step.stack?.some(item => item.label === FABRICATION_SPACER_SPEC.label || item.label === fabricationPartDisplayLabel(FABRICATION_SPACER_SPEC.label))), 'graph board workflow calls out S10 spacer layers in the build stack');
assert(pkg.metadataJson.includes('assemblySteps'), 'fabrication metadata includes structured kit assembly steps');
assert.equal(fabricationPartDisplayLabel('G3 / 3-space gear'), 'Gear with 24 teeth', 'builder-facing gear labels name teeth count instead of G-codes');
assert.equal(fabricationPartDisplayLabel('Drive G5 / 5-space gear'), 'Drive gear with 40 teeth', 'builder-facing drive gear labels name selected teeth count instead of fixed G3 copy');
assert.equal(fabricationPartDisplayLabel('L4 linkage'), '5-hole link', 'builder-facing linkage labels name hole count instead of L-codes or cell jargon');
assert.equal(fabricationPartDisplayLabel('S10 spacer'), 'Spacer 10mm OD / 4mm hole', 'builder-facing spacer labels name physical dimensions instead of S-codes');
assert.equal(fabricationBoardCoordinateCallout('H8'), 'H8 · row 8, column 8', 'board coordinates include row and column callouts for assembly');
assert(pkg.svg.includes('>A<') && pkg.svg.includes('>15<'), 'blueprint SVG labels pegboard columns A-O and rows 1-15');
assert(pkg.svg.includes('row') && pkg.svg.includes('column'), 'blueprint SVG recipe anchors include row/column callouts');
assert(pkg.assemblyGuideHtml.includes('3-hole link'), 'assembly guide uses readable hole-count linkage names');
assert(pkg.assemblyGuideHtml.includes('Spacer 10mm OD / 4mm hole'), 'assembly guide uses readable spacer names');
assert(pkg.assemblyGuideHtml.includes('row') && pkg.assemblyGuideHtml.includes('column'), 'assembly guide includes row/column callouts');
assert(pkg.assemblyGuideHtml.includes('<strong>Target:</strong> Right lower arm') && pkg.assemblyGuideHtml.includes('path-right-arm') && pkg.assemblyGuideHtml.includes('right_hand'), 'assembly guide keeps compact target/path/anchor connection details');
assert(pkg.assemblyGuidePdf.includes('Target: Right lower arm') && pkg.assemblyGuidePdf.includes('path-right-arm'), 'assembly guide PDF keeps offline target/path connection details');
assert.equal(FABRICATION_RENDER_MIN_CLEARANCE, 0, 'fabrication render z uses canonical face contact instead of positive clearance gaps');
assert.equal(renderPlanLayerZStep, FABRICATION_RENDER_LAYER_Z_STEP, 'fabricationRenderPlan preserves public layer z-step behind the fabrication facade');
assert.equal(renderPlanPartDepth, FABRICATION_RENDER_PART_DEPTH, 'fabricationRenderPlan preserves public part depth behind the fabrication facade');
assert.equal(renderPlanMinClearance, FABRICATION_RENDER_MIN_CLEARANCE, 'fabricationRenderPlan preserves public spacer clearance behind the fabrication facade');

REFERENCE_EXPORT_READY_TYPES.forEach(type => {
  const stack = fabricationStackForMechanism({ type });
  assert.equal(validateFabricationStack(stack).join('; '), '', `${type} fabrication stack validates against its mechanism-reference module contract`);
  assert.deepEqual(renderPlanValidateFabricationStack(stack), validateFabricationStack(stack), `${type} fabricationRenderPlan preserves public stack validation behind the facade`);
  assert(!stack.some(layer => layer.role === 'base'), `${type} moving stack excludes the base board`);
  if (type === 'cam') {
    const labels = stack.map(layer => layer.label);
    ['Crank handle', 'Axle peg', 'Paper washer', 'Cam spacer', 'Swappable cam disk', 'Cam lock disk', 'U-channel guide cartridge', 'Preassembled gravity follower module'].forEach(label => {
      assert(labels.includes(label), `cam module stack includes ${label}`);
    });
    assert(!labels.some(label => /Back Clip|Front Clip|S10 spacer|Eccentric cam|Round follower|2-hole bracket/i.test(label)), 'cam stack rejects the old generic clip/S10/eccentric/round-follower recipe');
  } else {
    assert.equal(stack[0].role, 'clip', `${type} moving stack starts with a clip`);
    assert.equal(stack.at(-1)?.role, 'clip', `${type} moving stack ends with a clip`);
    assert(stack.filter(layer => layer.role === 'spacer').every(layer => layer.label === FABRICATION_SPACER_SPEC.label), `${type} stack uses the S10 spacer convention`);
    const moving = (role: string) => !['clip', 'spacer', 'base'].includes(role);
    stack.slice(1, -1).forEach((layer, index, middle) => {
      const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
      assert(!(moving(layer.role) && next && moving(next.role)), `${type} stack separates adjacent moving layers with spacers`);
    });
  }
  const plan = fabricationRenderPlanForMechanism({ type });
  assert.deepEqual(renderPlanForMechanism({ type }), plan, `${type} fabricationRenderPlan preserves public render plan behind the facade`);
  assert.equal(plan.validationErrors.join('; '), '', `${type} render plan is validated against fabrication stack`);
  assert.equal(plan.base.label, 'Base board', `${type} render plan keeps base board separate`);
  assert.deepEqual(plan.layers.map(layer => layer.label), stack.map(layer => layer.label), `${type} render plan labels mirror fabrication stack`);
  assert.deepEqual(plan.layers.map(layer => layer.role), stack.map(layer => layer.role), `${type} render plan roles mirror fabrication stack`);
  assert.deepEqual(plan.layers.map(layer => layer.color), stack.map(layer => layer.color), `${type} render plan colors mirror fabrication stack`);
  assert(plan.layers.every(layer => layer.source === 'fabrication-stack'), `${type} render layers declare fabrication stack source`);
  const zValues = plan.layers.map(layer => layer.z);
  if (type === 'cam') {
    const zForLabel = (label: string) => plan.layers.find(layer => layer.label === label)?.z;
    const camDiskZ = zForLabel('Swappable cam disk');
    const camGuideZ = zForLabel('U-channel guide cartridge');
    const camFollowerZ = zForLabel('Preassembled gravity follower module');
    assert(typeof camDiskZ === 'number' && typeof camGuideZ === 'number' && typeof camFollowerZ === 'number', 'cam render plan exposes disk, guide, and follower z layers');
    assert(plan.layers.every(layer => layer.physicalDepthMm > 0), 'cam module render plan emits canonical physical depths');
  } else {
    assert.deepEqual(zValues, [...zValues].sort((a, b) => a - b), `${type} render plan z order follows stack order`);
    assert(plan.layers.every(layer => Math.abs((layer.frontFaceMm - layer.backFaceMm) - layer.physicalDepthMm) <= 0.001), `${type} render plan emits packed canonical faces`);
  }
  const movingZValues = plan.layers.filter(layer => !['clip', 'spacer', 'base'].includes(layer.role)).map(layer => layer.z.toFixed(2));
  assert.equal(new Set(movingZValues).size, movingZValues.length, `${type} moving mechanism layers occupy distinct z planes`);
});

{
  const validStack = fabricationStackForMechanism(createDefaultMechanism('4bar', 'invalid-stack-source'));
  const expectStackError = (stack: typeof validStack, message: string, label: string) => {
    assert(validateFabricationStack(stack).some(error => error.includes(message)), label);
  };
  expectStackError(validStack.slice(1), 'start with a back clip', 'fabrication stack validation rejects missing first clip');
  expectStackError(validStack.slice(0, -1), 'end with a front clip', 'fabrication stack validation rejects missing final clip');
  expectStackError(validStack.filter(layer => layer.role !== 'spacer'), 'S10 spacer', 'fabrication stack validation rejects adjacent moving layers without S10 spacers');
  expectStackError(validStack.map(layer => layer.role === 'spacer' ? { ...layer, label: 'Wrong spacer' } : layer), 'S10 spacer', 'fabrication stack validation rejects non-S10 spacer labels');
  expectStackError([{ ...validStack[1], label: 'Base board', role: 'base' }, ...validStack], 'moving stack must not include Base board', 'fabrication stack validation keeps the base board out of moving stacks');
}


{
  const zStackTypes: MechanismType[] = ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
  const expectedPinPathKinds: Record<string, Record<string, string>> = {
    '4bar': {
      p1: 'linkage>spacer>clip',
      j1: 'clip>linkage>spacer>linkage>clip',
      j2: 'clip>linkage>spacer>linkage>clip',
      p2: 'linkage>spacer>clip'
    },
    piston: {
      p1: 'linkage>spacer>clip',
      j1: 'clip>linkage>spacer>linkage>clip',
      slider: 'clip>linkage>spacer>guide>clip'
    },
    cam: {
      'cam-axle': 'linkage>spacer>spacer>spacer>cam>clip'
    },
    gear: {
      'gear-0': 'gear>spacer>clip',
      'gear-1': 'gear>spacer>clip'
    },
    gear_linkage: {
      'drive-pin': 'gear>spacer>linkage>clip',
      effector: 'clip>linkage>spacer>linkage>clip',
      'output-pin': 'gear>spacer>spacer>spacer>spacer>clip>linkage>clip'
    },
    planetary_gear: {
      'sun-gear': 'gear>spacer>linkage>clip',
      'planet-gear': 'clip>gear>spacer>linkage>clip',
      'ring-gear': 'gear>spacer>clip'
    }
  };
  zStackTypes.forEach(type => {
    const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `z-stack-${type}`)));
    const plan = compileMechanismRenderPlan(mechanism, sample.settings.physicalKit);
    assert(plan.layers.length > 0, `${type} z-stack compiler emits layers`);
    assert(plan.supportPaths.length > 0, `${type} z-stack compiler emits support paths`);
    assert(plan.supportNodes.length > 0, `${type} z-stack compiler emits retained support nodes`);
    assert(plan.pinSpans.length > 0, `${type} z-stack compiler emits pin spans`);
    [...plan.layers, plan.base].forEach(layer => {
      assert(Number.isFinite(layer.backFaceMm) && Number.isFinite(layer.frontFaceMm) && Number.isFinite(layer.centerMm), `${type} layer ${layer.label} has finite canonical faces`);
      assert(Math.abs((layer.frontFaceMm - layer.backFaceMm) - layer.physicalDepthMm) <= FABRICATION_Z_EPSILON_MM, `${type} layer ${layer.label} depth matches faces`);
      assert(Math.abs(((layer.backFaceMm + layer.frontFaceMm) / 2) - layer.centerMm) <= FABRICATION_Z_EPSILON_MM, `${type} layer ${layer.label} center matches midpoint`);
      assert.equal(layer.z, projectFabricationZMm(layer.centerMm), `${type} layer ${layer.label} render z is projected canonical center`);
    });
    assert.equal(plan.base.backFaceMm, -BOARD_DEPTH_MM, `${type} board starts behind the front face`);
    assert.equal(plan.base.frontFaceMm, 0, `${type} board front face is canonical zero`);
    plan.layers.forEach(layer => {
      const expectedDepth = layer.renderKind === 'spacer' ? SPACER_DEPTH_MM : layer.renderKind === 'clip' ? CLIP_HEAD_DEPTH_MM : PLATE_DEPTH_MM;
      assert.equal(layer.physicalDepthMm, expectedDepth, `${type} ${layer.label} uses fixed compiler-owned depth`);
    });
    const wideHolePlan = compileMechanismRenderPlan(mechanism, { ...sample.settings.physicalKit, holeDiameterMm: 8 });
    assert.deepEqual(
      wideHolePlan.layers.map(layer => [layer.layerId, layer.backFaceMm, layer.frontFaceMm, layer.centerMm, layer.physicalDepthMm, layer.gearPlaneId ?? '']),
      plan.layers.map(layer => [layer.layerId, layer.backFaceMm, layer.frontFaceMm, layer.centerMm, layer.physicalDepthMm, layer.gearPlaneId ?? '']),
      `${type} canonical z is independent of hole diameter`
    );
    plan.pinSpans.forEach(span => {
      const crossed = plan.supportNodes.filter(node => span.supportNodeIds.includes(node.id));
      assert(crossed.length > 0, `${type} pin ${span.id} crosses retained nodes`);
      const crossesBoard = crossed.some(node => node.kind === 'board');
      if (crossesBoard) assert.equal(span.backFaceMm, -1.2, `${type} board pin ${span.id} starts at the board-tab terminal`);
      else assert(span.backFaceMm < Math.min(...crossed.map(node => node.backFaceMm)), `${type} free pin ${span.id} starts behind retained stack`);
      assert(span.frontFaceMm > Math.max(...crossed.map(node => node.frontFaceMm)), `${type} pin ${span.id} reaches beyond retained stack`);
    });
    const supportNodeById = new Map(plan.supportNodes.map(node => [node.id, node]));
    plan.supportEdges.filter(edge => edge.kind === 'face-contact' || edge.kind === 'retains').forEach(edge => {
      const from = supportNodeById.get(edge.fromNodeId);
      const to = supportNodeById.get(edge.toNodeId);
      assert(from, `${type} support edge ${edge.id} resolves its from node`);
      assert(to, `${type} support edge ${edge.id} resolves its to node`);
      const faceError = Math.abs(from!.frontFaceMm - to!.backFaceMm);
      assert(faceError <= FABRICATION_Z_EPSILON_MM, `${type} ${edge.kind} edge ${edge.id} joins epsilon-equal faces instead of spanning a gap or overlap`);
      assert(Math.abs((edge.contactFaceMm ?? Number.NaN) - from!.frontFaceMm) <= FABRICATION_Z_EPSILON_MM, `${type} ${edge.kind} edge ${edge.id} records the actual shared face`);
    });
    const pinBearingPaths = plan.supportPaths.filter(path => path.pinSpanId);
    assert(pinBearingPaths.length > 0, `${type} emits at least one physical pin-bearing support path`);
    pinBearingPaths.forEach(path => {
      const kinds = path.orderedLayerIds.map(layerId => plan.layers.find(layer => layer.layerId === layerId)?.renderKind);
      assert.equal(kinds.join('>'), expectedPinPathKinds[type][path.rootNodeId], `${type} ${path.rootNodeId} path keeps its exact compiled plate/spacer/retainer sequence`);
      assert(kinds.includes('spacer'), `${type} pin-bearing path ${path.id} includes a physical spacer layer`);
      assert(kinds.includes('clip'), `${type} pin-bearing path ${path.id} includes a physical retainer layer`);
      const span = plan.pinSpans.find(candidate => candidate.id === path.pinSpanId);
      assert(span, `${type} pin-bearing path ${path.id} resolves its compiled pin span`);
      path.orderedLayerIds.forEach(layerId => {
        const supportNodeId = plan.supportNodes.find(node => node.ownerLayerId === layerId)?.id;
        assert(supportNodeId && span!.supportNodeIds.includes(supportNodeId), `${type} pin ${span!.id} includes path layer ${layerId} in its retained support nodes`);
      });
      path.orderedLayerIds.filter(layerId => plan.layers.find(layer => layer.layerId === layerId)?.renderKind === 'spacer').forEach(layerId => {
        const spacerNodeId = plan.supportNodes.find(node => node.ownerLayerId === layerId)?.id;
        const spacerContacts = plan.supportEdges.filter(edge => edge.supportPathId === path.id
          && (edge.kind === 'face-contact' || edge.kind === 'retains')
          && (edge.fromNodeId === spacerNodeId || edge.toNodeId === spacerNodeId));
        assert.equal(spacerContacts.length, 2, `${type} spacer ${layerId} has exactly one incoming and one outgoing face contact on ${path.id}`);
      });
    });
    if (['gear', 'gear_linkage', 'planetary_gear'].includes(type)) {
      const planeLayers = plan.layers.filter(layer => layer.gearPlaneId);
      const graph = mechanismGraphForMechanism(mechanism);
      const hasMesh = graph.constraints.some(constraint => constraint.role === 'gear-mesh');
      if (hasMesh) assert(planeLayers.length >= 2, `${type} has a gear-mesh plane`);
      if (hasMesh) {
        const faces = new Set(planeLayers.map(layer => `${layer.backFaceMm}:${layer.frontFaceMm}:${layer.physicalDepthMm}`));
        assert.equal(faces.size, 1, `${type} gear mesh members share identical faces`);
        assert(plan.layers.filter(layer => layer.renderKind !== 'gear').every(layer => !layer.gearPlaneId), `${type} non-gears do not join the gear plane`);
      }
      if (type === 'planetary_gear') {
        const gearFrontFaceMm = Math.max(...planeLayers.map(layer => layer.frontFaceMm));
        const carrierLayer = plan.layers.find(layer => layer.sourceNodeId === 'carrier');
        assert(carrierLayer, 'planetary compiler emits the carrier layer');
        assert(Math.abs((carrierLayer!.backFaceMm - gearFrontFaceMm) - SPACER_DEPTH_MM) <= FABRICATION_Z_EPSILON_MM, 'planetary carrier sits exactly one spacer above the coplanar sun/ring/planet plane');
      }
    }
  });



  const badGearMeshGraph = mechanismGraphForMechanism(createDefaultMechanism('gear', 'z-stack-bad-gear-plane'));
  const badGearMesh = {
    ...badGearMeshGraph,
    constraints: badGearMeshGraph.constraints.map(constraint =>
      constraint.role === 'gear-mesh' ? { ...constraint, value: 1 } : constraint
    )
  };
  const badGearValidation = validateMechanismGraph(badGearMesh);
  const badGearCompilation = compileAuthoredMechanismGraph(badGearMesh);
  assert.equal(badGearValidation.valid, false, 'negative gear-plane case rejects a gear mesh whose XY pitch span does not match the authored value');
  assert.equal(badGearCompilation.fabrication.buildable, false, 'general graph fabrication is not buildable when graph or render validation has blockers');
  assert(badGearCompilation.fabrication.renderPlan?.validationErrors.some(error => error.includes('gear-mesh') && error.includes('positions')), 'negative gear-plane blocker is carried into the render plan');

  const supportBlockedPlan = compileMechanismRenderPlan(createDefaultMechanism('4bar', 'z-stack-support-blocker'), { ...sample.settings.physicalKit, boardCells: 1 });
  assert(supportBlockedPlan.validationErrors.some(error => /Placement off board|No board-snapped graph anchor/.test(error)), 'support blocker case remains a compiler validation error instead of a visual-only z offset');

  const expectedDistancePartOwners: Partial<Record<MechanismType, Record<string, string>>> = {
    '4bar': {
      'input-length': 'input-link',
      'coupler-length': 'coupler-link',
      'output-length': 'output-link'
    },
    piston: {
      'crank-length': 'crank-link',
      'rod-length': 'connecting-rod'
    },
    gear_linkage: {
      'drive-connector-length': 'connector-link-a',
      'output-connector-length': 'connector-link-b'
    }
  };
  zStackTypes.forEach(type => {
    const graph = mechanismGraphForMechanism(createDefaultMechanism(type, `typed-distance-owner-${type}`));
    const expectedOwners = expectedDistancePartOwners[type] ?? {};
    const distanceConstraints = graph.constraints.filter(constraint => constraint.role === 'distance');
    assert.equal(distanceConstraints.length, Object.keys(expectedOwners).length, `${type} exposes the expected typed fabricated distance relations`);
    distanceConstraints.forEach(constraint => {
      const owner = (constraint as typeof constraint & { fabricatedPartNodeId?: string }).fabricatedPartNodeId;
      assert.equal(owner, expectedOwners[constraint.id], `${type} ${constraint.id} explicitly owns its fabricated part node`);
    });
  });
  const logicalFourBarPlan = compileMechanismRenderPlan(createDefaultMechanism('4bar', 'logical-stack-order'));
  assert.deepEqual(
    logicalFourBarPlan.layers.filter(layer => layer.renderKind === 'linkage').map(layer => layer.sourceNodeId),
    ['input-link', 'coupler-link', 'output-link'],
    'compiled layer presentation preserves logical Input -> Coupler -> Output order independently of physical face packing'
  );

  const typedOwnerTrap = mechanismGraphFromDraft({
    id: 'typed-owner-trap',
    familyId: 'typed-owner-trap',
    nodes: [
      { id: 'board-a', label: 'Board A', role: 'board-anchor', position: { x: 0, y: 0 } },
      { id: 'output', label: 'Output', role: 'output-point', position: { x: 80, y: 0 } },
      { id: 'declared-link', label: 'Unrelated words', role: 'link', position: { x: 0, y: 80 }, value: 80 },
      { id: 'heuristic-decoy', label: 'Link length stays fixed', role: 'link', position: { x: 40, y: 0 }, value: 80 }
    ],
    constraints: [
      { id: 'board-a-fixed', label: 'Board A stays fixed', role: 'fixed-to-board', nodes: ['board-a'] },
      { id: 'board-a-snap', label: 'Board A snaps', role: 'board-snap', nodes: ['board-a'] },
      { id: 'owned-distance', label: 'Link length stays fixed', role: 'distance', nodes: ['board-a', 'output'], value: 80, fabricatedPartNodeId: 'declared-link' }
    ]
  });
  const typedOwnerTrapCompilation = compileAuthoredMechanismGraph(typedOwnerTrap);
  assert.equal(typedOwnerTrapCompilation.fabrication.buildable, true, 'typed fabricated part ownership does not require matching labels or midpoints');
  const declaredOwnerLayer = typedOwnerTrapCompilation.fabrication.renderPlan.layers.find(layer => layer.sourceNodeId === 'declared-link');
  const heuristicDecoyLayer = typedOwnerTrapCompilation.fabrication.renderPlan.layers.find(layer => layer.sourceNodeId === 'heuristic-decoy');
  assert(declaredOwnerLayer?.sourceConstraintIds.includes('owned-distance'), 'explicit fabricatedPartNodeId owns the distance assembly layer even when its label and position do not match');
  assert(!heuristicDecoyLayer?.sourceConstraintIds.includes('owned-distance'), 'a label/midpoint decoy cannot steal typed distance membership');
  const declaredOwnerStackItem = typedOwnerTrapCompilation.fabrication.recipe?.assemblySteps.flatMap(step => step.stack ?? [])
    .find(item => item.sourceNodeId === 'declared-link');
  assert(declaredOwnerStackItem?.sourceConstraintIds?.includes('owned-distance'), 'compiled assembly steps carry the exact typed constraint-to-fabricated-part ownership');
  const missingTypedOwnerGraph: MechanismGraph = {
    ...typedOwnerTrap,
    constraints: typedOwnerTrap.constraints.map(constraint => constraint.role === 'distance'
      ? { ...constraint, fabricatedPartNodeId: 'missing-fabricated-part' }
      : constraint)
  };
  const missingTypedOwnerValidation = validateMechanismGraph(missingTypedOwnerGraph);
  const missingTypedOwnerCompilation = compileAuthoredMechanismGraph(missingTypedOwnerGraph);
  assert.equal(missingTypedOwnerValidation.valid, false, 'missing typed fabricated part references fail graph validation even when a label/midpoint decoy exists');
  assert(missingTypedOwnerValidation.diagnostics.some(diagnostic => diagnostic.message.includes('owned-distance') && diagnostic.message.includes('missing-fabricated-part')), 'missing typed owner diagnostic names the constraint and bad part id');
  assert.equal(missingTypedOwnerCompilation.fabrication.buildable, false, 'missing typed fabricated part references block general graph fabrication');
  const unsupportedTypedOwnerGraph: MechanismGraph = {
    ...typedOwnerTrap,
    constraints: typedOwnerTrap.constraints.map(constraint => constraint.role === 'distance'
      ? { ...constraint, fabricatedPartNodeId: 'output' }
      : constraint)
  };
  const unsupportedTypedOwnerValidation = validateMechanismGraph(unsupportedTypedOwnerGraph);
  assert.equal(unsupportedTypedOwnerValidation.valid, false, 'typed ownership cannot target a non-fabricated output node even when a matching link decoy exists');
  assert(unsupportedTypedOwnerValidation.diagnostics.some(diagnostic => diagnostic.message.includes('owned-distance') && diagnostic.message.includes('unsupported fabricated part output')), 'invalid typed owner diagnostic names the constraint and unsupported node');
  assert.equal(compileAuthoredMechanismGraph(unsupportedTypedOwnerGraph).fabrication.buildable, false, 'unsupported typed fabricated part references block general graph compilation');
  const duplicateTypedOwnerGraph: MechanismGraph = {
    ...typedOwnerTrap,
    constraints: [
      ...typedOwnerTrap.constraints,
      { id: 'duplicate-owned-distance', label: 'Second owner claim', role: 'distance', nodes: ['board-a', 'output'], value: 80, fabricatedPartNodeId: 'declared-link' }
    ]
  };
  const duplicateTypedOwnerValidation = validateMechanismGraph(duplicateTypedOwnerGraph);
  assert.equal(duplicateTypedOwnerValidation.valid, false, 'one fabricated part cannot be claimed by multiple typed distance constraints');
  assert(duplicateTypedOwnerValidation.diagnostics.some(diagnostic => diagnostic.message.includes('declared-link') && diagnostic.message.includes('multiple distance constraints')), 'duplicate typed ownership diagnostic names the multiply-owned fabricated part');

  const axialSceneContracts = zStackTypes.map(type => {
    const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `axial-scene-${type}`)));
    const compiled = compileMechanism(mechanism, undefined, undefined, sample.settings.physicalKit);
    const renderPlan = compiled.fabrication.renderPlan;
    const contract = buildLowLevelMechanismSceneContract(mechanism, undefined, sample.settings.physicalKit) as ReturnType<typeof buildLowLevelMechanismSceneContract> & {
      supportPaths?: typeof renderPlan.supportPaths;
      supportNodes?: typeof renderPlan.supportNodes;
      supportEdges?: typeof renderPlan.supportEdges;
      pinSpans?: typeof renderPlan.pinSpans;
      gearPlaneIds?: string[];
      renderPlanValidationErrors?: string[];
    };
    assert.deepEqual(contract.supportPaths, renderPlan.supportPaths, `${type} scene contract carries exact compiled support paths`);
    assert.deepEqual(contract.supportNodes, renderPlan.supportNodes, `${type} scene contract carries exact compiled support nodes`);
    assert.deepEqual(contract.supportEdges, renderPlan.supportEdges, `${type} scene contract carries exact compiled support edges`);
    assert.deepEqual(contract.pinSpans, renderPlan.pinSpans, `${type} scene contract carries exact compiled pin spans`);
    assert.deepEqual(contract.gearPlaneIds, [...new Set(renderPlan.layers.flatMap(layer => layer.gearPlaneId ? [layer.gearPlaneId] : []))].sort(), `${type} scene contract carries exact compiled gear-plane ids`);
    assert.deepEqual(contract.renderPlanValidationErrors, renderPlan.validationErrors, `${type} scene contract carries exact compiler validation blockers`);
    assert.deepEqual(
      contract.layers.map(layer => ({
        id: layer.id,
        backFaceMm: (layer as typeof layer & { backFaceMm?: number }).backFaceMm,
        centerMm: (layer as typeof layer & { centerMm?: number }).centerMm,
        frontFaceMm: (layer as typeof layer & { frontFaceMm?: number }).frontFaceMm,
        physicalDepthMm: (layer as typeof layer & { physicalDepthMm?: number }).physicalDepthMm,
        gearPlaneId: (layer as typeof layer & { gearPlaneId?: string }).gearPlaneId
      })),
      [renderPlan.base, ...renderPlan.layers].map(layer => ({
        id: layer.layerId,
        backFaceMm: layer.backFaceMm,
        centerMm: layer.centerMm,
        frontFaceMm: layer.frontFaceMm,
        physicalDepthMm: layer.physicalDepthMm,
        gearPlaneId: layer.gearPlaneId
      })),
      `${type} scene layers preserve exact canonical faces and gear-plane membership`
    );
    return { mechanism, contract };
  });
  const axialBlueprintProject: ProjectState = {
    ...sample,
    mechanisms: axialSceneContracts.map(({ mechanism }) => ({
      ...mechanism,
      targetPartId: 'right_hand_part',
      targetPathId: 'path-right-arm',
      targetAnchorJointId: 'right_hand',
      activeVisualPartIds: ['right_hand_part']
    })),
    selectedMechanismId: axialSceneContracts[0]?.mechanism.id
  };
  const axialBlueprintRecipes = axialBlueprintProject.mechanisms.map(mechanism => compileFabricationRecipe(axialBlueprintProject, mechanism));
  const parseSvgMetadata = (svg: string) => {
    const encoded = svg.match(/<metadata>([\s\S]*?)<\/metadata>/)?.[1];
    assert(encoded, 'Blueprint SVG includes metadata JSON');
    const decoded = encoded!
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    return JSON.parse(decoded) as { mechanismSceneContracts?: unknown[] };
  };
  const expectedAxialContracts = JSON.parse(JSON.stringify(buildMechanismSceneContracts(axialBlueprintProject, axialBlueprintRecipes)));
  assert.deepEqual(parseSvgMetadata(makeBlueprintSvg(axialBlueprintProject, axialBlueprintRecipes)).mechanismSceneContracts, expectedAxialContracts, 'Blueprint SVG metadata carries exact six-family compiler scene contracts');
  assert.deepEqual(parseSvgMetadata(makeBlueprintPreviewSvg(axialBlueprintProject, axialBlueprintRecipes)).mechanismSceneContracts, expectedAxialContracts, 'Blueprint preview SVG metadata carries exact six-family compiler scene contracts');
  axialBlueprintProject.mechanisms.forEach(mechanism => {
    const unfittedProject: ProjectState = {
      ...sample,
      mechanisms: [],
      selectedMechanismId: mechanism.id,
      settings: {
        ...sample.settings,
        physicalKit: { ...sample.settings.physicalKit, sheetWidthMm: 1_000, sheetHeightMm: 1_000 },
      },
    };
    const fittedMechanism = fitRecommendedMechanismToSheet(unfittedProject, mechanism);
    const singleMechanismProject: ProjectState = { ...unfittedProject, mechanisms: [fittedMechanism] };
    const singleRecipe = compileFabricationRecipe(singleMechanismProject, fittedMechanism);
    const axialPackageMetadata = JSON.parse(createFabricationPackage(singleMechanismProject).metadataJson) as { mechanismSceneContracts?: unknown[] };
    const expectedContract = JSON.parse(JSON.stringify(buildMechanismSceneContracts(singleMechanismProject, [singleRecipe])));
    assert.deepEqual(axialPackageMetadata.mechanismSceneContracts, expectedContract, `${mechanism.type} portable fabrication export metadata carries the exact compiler scene contract`);
  });

  zStackTypes.forEach(type => {
    const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `three-box-${type}`)));
    const renderPlan = compileMechanismRenderPlan(mechanism, sample.settings.physicalKit);
    assert.deepEqual(renderPlan.validationErrors, [], `${type} mesh parity probe starts from a valid compiled render plan`);
    const simulation = fitMechanismSimulationWithContext(mechanism, 0.47, createMechanismFitContext(mechanism, 360, 240));
    const isGearTrain = mechanism.type === 'gear' || mechanism.type === 'gear_linkage';
    const gearRadii = isGearTrain ? gearTrainPitchRadii(mechanism) : [mechanism.crankLength, mechanism.rockerLength];
    const gearCenters = isGearTrain ? fittedGearTrainCenters(gearRadii, simulation.state.p1, simulation.state.p2) : [];
    const renderedLayerZ = foundryRenderedLayerZForMechanism(renderPlan.layers, renderPlan.layers.map(layer => layer.z));
    const pinStackPoints = foundryPinStackPoints(renderPlan, {
      state: simulation.state,
      gearCenters,
      planetCenters: [simulation.state.p2]
    });
    const pinStacks = foundryPinStacks(pinStackPoints, renderPlan);
    const root = new THREE.Group();
    const geometryCache = new Map<string, THREE.BufferGeometry>();
    const materialCache = new Map<string, THREE.Material>();
    const primitives = createFoundryThreePrimitiveFactory({
      root,
      geometryCache,
      materialCache,
      mechanism,
      kit: sample.settings.physicalKit,
      color: mechanism.color,
      rigOpacity: 1,
      baseColor: renderPlan.base.color,
      simulationScale: simulation.scale
    });
    renderFoundryDynamicLayers({
      mechanism,
      simulation,
      primitives,
      renderPlan,
      renderedLayerZ,
      pinStacks,
      visiblePathTraces: [],
      pathLayerZ: 0,
      showPathPreview: false,
      showTrail: false,
      pinionRotation: simulation.driveAngleDeg,
      isGearTrain,
      gearRadii,
      gearCenters,
      gearUsesMeshPhases: mechanism.type === 'gear' || gearRadii.length > 2,
      gearOutputRatioForDisplay: isGearTrain ? gearTrainOutputRatio(mechanism) : gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength)
    });
    root.updateMatrixWorld(true);
    const taggedMeshes: THREE.Mesh[] = [];
    root.traverse(object => {
      if ((object as THREE.Mesh).isMesh && (object.userData.fabricationLayerId || object.userData.fabricationPinSpanIds?.length)) taggedMeshes.push(object as THREE.Mesh);
    });
    const tolerance = 1e-5;
    renderPlan.layers.forEach(layer => {
      const meshes = taggedMeshes.filter(mesh => mesh.userData.fabricationLayerId === layer.layerId);
      assert(meshes.length > 0, `${type} ${layer.layerId} emits at least one real tagged structural mesh`);
      const box = meshes.reduce((bounds, mesh) => bounds.union(new THREE.Box3().setFromObject(mesh)), new THREE.Box3());
      const actualCenter = (box.min.z + box.max.z) / 2;
      const actualDepth = box.max.z - box.min.z;
      assert(Math.abs(box.min.z - projectFabricationZMm(layer.backFaceMm)) <= tolerance, `${type} ${layer.layerId} Box3 back face matches compiled backFaceMm`);
      assert(Math.abs(actualCenter - projectFabricationZMm(layer.centerMm)) <= tolerance, `${type} ${layer.layerId} Box3 center matches compiled centerMm`);
      assert(Math.abs(box.max.z - projectFabricationZMm(layer.frontFaceMm)) <= tolerance, `${type} ${layer.layerId} Box3 front face matches compiled frontFaceMm`);
      assert(Math.abs(actualDepth - projectFabricationZMm(layer.physicalDepthMm)) <= tolerance, `${type} ${layer.layerId} Box3 depth matches compiled physicalDepthMm`);
      const taggedSupportPathIds = [...new Set(meshes.flatMap(mesh => mesh.userData.fabricationSupportPathIds ?? []))].sort();
      assert.deepEqual(taggedSupportPathIds, [...layer.supportPathIds].sort(), `${type} ${layer.layerId} real meshes carry exact compiler support path ids`);
      const expectedPinSpanIds = [...new Set(layer.supportPathIds.flatMap(pathId => {
        const pinSpanId = renderPlan.supportPaths.find(path => path.id === pathId)?.pinSpanId;
        return pinSpanId ? [pinSpanId] : [];
      }))].sort();
      const taggedPinSpanIds = [...new Set(meshes.flatMap(mesh => mesh.userData.fabricationPinSpanIds ?? []))].sort();
      assert.deepEqual(taggedPinSpanIds, expectedPinSpanIds, `${type} ${layer.layerId} real meshes carry exact compiler pin-span ids`);
    });
    renderPlan.pinSpans.forEach(pinSpan => {
      const pinMesh = taggedMeshes.find(mesh => mesh.userData.fabricationPrimitiveKind === 'pin' && (mesh.userData.fabricationPinSpanIds ?? []).includes(pinSpan.id));
      assert(pinMesh, `${type} ${pinSpan.id} emits a real tagged pin mesh`);
      const box = new THREE.Box3().setFromObject(pinMesh!);
      assert(Math.abs(box.min.z - projectFabricationZMm(pinSpan.backFaceMm)) <= tolerance, `${type} ${pinSpan.id} pin Box3 back face matches compiled span`);
      assert(Math.abs(box.max.z - projectFabricationZMm(pinSpan.frontFaceMm)) <= tolerance, `${type} ${pinSpan.id} pin Box3 front face matches compiled span`);
    });
    disposeFoundryThreeObject(root);
    geometryCache.forEach(geometry => geometry.dispose());
    materialCache.forEach(material => material.dispose());
  });

  const planetaryGraph = mechanismGraphForMechanism(createDefaultMechanism('planetary_gear', 'z-stack-planetary-graph'));
  const carrier = planetaryGraph.nodes.find(node => node.id === 'carrier');
  assert(carrier?.role === 'link', 'planetary carrier remains a midpoint link');
  assert(planetaryGraph.nodes.some(node => node.id === 'carrier-central-pivot' && node.role === 'moving-joint' && node.fabricated === false && node.ownerPartId === 'carrier'), 'planetary central pivot is a part-owned moving joint');
  assert(planetaryGraph.nodes.some(node => node.id === 'carrier-planet-pivot' && node.role === 'moving-joint' && node.fabricated === false && node.ownerPartId === 'carrier'), 'planetary planet pivot is a part-owned moving joint');
  assert.deepEqual(planetaryGraph.constraints.find(constraint => constraint.id === 'sun-carrier-pivot-pin')?.nodes, ['sun-gear', 'carrier-central-pivot'], 'planetary sun/carrier support uses the explicit owner pivot');
  assert.deepEqual(planetaryGraph.constraints.find(constraint => constraint.id === 'planet-carrier-pin')?.nodes, ['planet-gear', 'carrier-planet-pivot'], 'planetary planet/carrier support uses the explicit owner pivot');
  const planetaryPlanMechanism = createDefaultMechanism('planetary_gear', 'z-stack-planetary-plan');
  const planetaryPlanGraph = mechanismGraphForMechanism(planetaryPlanMechanism);
  const planetaryPlan = compileMechanismRenderPlan(planetaryPlanMechanism);
  const ownerPaths = planetaryPlan.supportPaths.filter(path => path.ownerExpansions.length);
  assert.equal(ownerPaths.length, 2, 'planetary compiler expands exactly the two part-owned pivots into support paths');
  assert(ownerPaths.every(path => path.ownerExpansions.every(expansion => expansion.ownerPartId === 'carrier')), 'planetary owner expansions reference only the carrier layer');
  const centralPathId = `${planetaryPlanGraph.id}:support:pin:sun-carrier-pivot-pin:occ:0`;
  const planetPathId = `${planetaryPlanGraph.id}:support:pin:planet-carrier-pin:occ:0`;
  const centralPath = planetaryPlan.supportPaths.find(path => path.id === centralPathId);
  const planetPath = planetaryPlan.supportPaths.find(path => path.id === planetPathId);
  assert(centralPath, 'planetary central owner path keeps the stable explicit pin id');
  assert(planetPath, 'planetary planet owner path keeps the stable explicit pin id');
  const layerSequence = (path: NonNullable<typeof centralPath>) => path.orderedLayerIds.map(layerId => {
    const layer = planetaryPlan.layers.find(candidate => candidate.layerId === layerId);
    assert(layer, `planetary path ${path.id} resolves layer ${layerId}`);
    return [layer!.renderKind, layer!.sourceNodeId ?? '', layer!.backFaceMm, layer!.frontFaceMm] as const;
  });
  assert.deepEqual(layerSequence(centralPath!), [
    ['gear', 'sun-gear', 0, 4],
    ['spacer', '', 4, 5.6],
    ['linkage', 'carrier', 5.6, 9.6],
    ['clip', '', 9.6, 10.4]
  ], 'planetary central path is board -> sun gear -> physical S10 spacer -> shared carrier -> front retainer');
  assert.deepEqual(layerSequence(planetPath!), [
    ['clip', '', -0.8, 0],
    ['gear', 'planet-gear', 0, 4],
    ['spacer', '', 4, 5.6],
    ['linkage', 'carrier', 5.6, 9.6],
    ['clip', '', 9.6, 10.4]
  ], 'planetary free planet path is back retainer -> planet gear -> physical S10 spacer -> shared carrier -> front retainer');
  const carrierLayerId = planetaryPlan.layers.find(layer => layer.sourceNodeId === 'carrier')?.layerId;
  assert(carrierLayerId, 'planetary plan exposes one typed carrier layer');
  assert(centralPath!.orderedLayerIds.includes(carrierLayerId!), 'central owner path uses the typed carrier layer');
  assert(planetPath!.orderedLayerIds.includes(carrierLayerId!), 'planet owner path uses the same typed carrier layer');
  const boardSupportNodeId = planetaryPlan.supportNodes.find(node => node.kind === 'board')?.id;
  const centralSpan = planetaryPlan.pinSpans.find(span => span.id === centralPath!.pinSpanId);
  const planetSpan = planetaryPlan.pinSpans.find(span => span.id === planetPath!.pinSpanId);
  assert(boardSupportNodeId && centralSpan?.supportNodeIds.includes(boardSupportNodeId), 'planetary central pin is board rooted');
  assert(boardSupportNodeId && !planetSpan?.supportNodeIds.includes(boardSupportNodeId), 'planetary free planet pin is not falsely board rooted');
  assert.equal(centralSpan?.backFaceMm, -1.2, 'planetary board pin starts at the board tab terminal');
  const planetFirstNode = planetaryPlan.supportNodes.find(node => node.ownerLayerId === planetPath!.orderedLayerIds[0]);
  assert(planetFirstNode, 'planetary free path resolves its back retainer support node');
  assert.equal(planetSpan?.backFaceMm, planetFirstNode!.backFaceMm - 0.8, 'planetary free pin starts 0.8 mm behind its first retained support face');
  const compilerSource = readFileSync(join(process.cwd(), 'utils/mechanismGraphFabricationCompiler.ts'), 'utf8');
  assert(!compilerSource.includes('sourceNodeForLayer'), 'graph Z compilation does not infer source ownership from labels');
  assert(!compilerSource.includes('lower.includes(node.id.toLowerCase())'), 'graph Z compilation has no substring fallback for source membership');
  const previewStackSource = readFileSync(join(process.cwd(), 'utils/mechanismPreviewStacks.ts'), 'utf8');
  assert(!previewStackSource.includes('MechanismType') && !previewStackSource.includes('type ===') && !previewStackSource.includes('pin.id ==='), 'preview stack projection does not infer axial membership from mechanism family or A-F aliases');
}

const assertFiniteDeep = (value: unknown, label: string): void => {
  if (typeof value === 'number') {
    assert(Number.isFinite(value), `${label} is finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteDeep(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => assertFiniteDeep(child, `${label}.${key}`));
  }
};
const projectionProject = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
const projectionBeforeJson = JSON.stringify(projectionProject);
const projectionBeforeUpdatedAt = projectionProject.metadata.updatedAt;
const projectionBeforeExport = projectionProject.lastExport;
const projection = buildToonSceneProjection(projectionProject);
assert.equal(JSON.stringify(projectionProject), projectionBeforeJson, 'toon projection does not mutate serialized ProjectState');
assert.equal(projectionProject.metadata.updatedAt, projectionBeforeUpdatedAt, 'toon projection does not touch metadata.updatedAt');
assert.equal(projectionProject.lastExport, projectionBeforeExport, 'toon projection does not invalidate lastExport');
assert.deepEqual(buildToonSceneProjection(projectionProject), projection, 'toon projection is deterministic');
assert.equal(projection.version, 1, 'toon projection exposes schema version');
assert.equal(projection.units.scene, 'px', 'toon projection documents scene units');
assert.equal(projection.units.depth, 'mm', 'toon projection documents depth units');
assert.equal(projection.units.scenePxPerMm, SCENE_PX_PER_MM, 'toon projection uses shared scene/mm bridge');
assert.deepEqual(projection.coordinateSystem, { x: 'right', y: 'up', z: 'toward-camera-depth' }, 'toon projection documents axis mapping');
assert(projection.nodes.some(node => node.id === '/board/sheet' && node.sourceType === 'board'), 'toon projection includes board sheet node');
assert(sample.partOrder.filter(id => sample.parts[id].visible !== false).every(id => projection.nodes.some(node => node.id === `/character/${id}` && node.sourceType === 'part' && node.sourceId === id)), 'toon projection includes every visible body part');
const projectionSceneObjectProject = applyProjectAction(sample, { type: 'upsert_scene_object', object: createDefaultSceneObject('piggy-bank', 'object-projection') });
const projectionSceneObject = buildToonSceneProjection(projectionSceneObjectProject).nodes.find(node => node.sourceType === 'scene-object' && node.sourceId === 'object-projection');
assert(projectionSceneObject && projectionSceneObject.id === '/scene-objects/object-projection' && !projectionSceneObject.interactive && projectionSceneObject.exportRole === 'project-reference', 'toon projection includes Character-created scene objects as read-only project-reference nodes');
assert(Object.keys(sample.skeleton?.joints ?? {}).every(id => projection.nodes.some(node => node.id === `/skeleton/${id}` && node.sourceType === 'joint' && node.sourceId === id)), 'toon projection includes every skeleton joint');
const sampleBoneIds = new Set((sample.skeleton?.bones ?? []).map(([parentId, childId]) => `${parentId}->${childId}`));
assert([...sampleBoneIds].every(id => projection.nodes.some(node => node.sourceType === 'bone' && node.sourceId === id)), 'toon projection includes every skeleton bone with tuple sourceId');
projection.nodes.filter(node => node.sourceType === 'bone').forEach(node => {
  const [parentId, childId] = (node.sourceId ?? '').split('->');
  assert(sample.skeleton?.joints[parentId] && sample.skeleton?.joints[childId] && sampleBoneIds.has(node.sourceId ?? ''), 'bone sourceId maps to a real skeleton bone tuple');
});
Object.values(sample.paths).filter(path => path.visible && path.points.length).forEach(path => {
  assert(projection.nodes.some(node => node.id === `/paths/${path.id}` && node.sourceType === 'path' && node.sourceId === path.id), 'toon projection includes visible motion path');
});
sample.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).forEach(mechanism => {
  const contract = buildProjectMechanismSceneContract(projectionProject, mechanism.id);
  assert(contract?.projectDriveEnabled, 'toon projection is sourced from a bound full-project mechanism contract');
  const mechanismNodes = projection.nodes.filter(node => node.sourceId === mechanism.id);
  assert(mechanismNodes.length > 0, 'toon projection includes canonical mechanism physical layers');
  assert(contract.renderPlan.layers.every(layer => mechanismNodes.some(node => node.mechanismLayerId === layer.layerId)), 'toon projection preserves every compiler layer id');
  assert(mechanismNodes.every(node => node.mechanismCompilerSignature === contract.compilerSignature), 'toon projection preserves the full-project compiler signature');
  assert(!mechanismNodes.some(node => node.id.endsWith('/output')), 'toon projection does not restore a mechanism-only body-output fallback');
});
projection.nodes.forEach(node => {
  assert(node.id.trim().length > 0, 'projection node ids are non-empty stable paths');
  assertFiniteDeep(node.geometry, `${node.id}.geometry`);
  assertFiniteDeep(node.transform2d, `${node.id}.transform2d`);
  assert(Number.isFinite(node.depthMm) && Number.isFinite(node.thicknessMm) && Number.isFinite(node.renderOrder), 'projection node depth/thickness/order are finite');
});
const sourceMapProject = projectionProject;
const mechanismIds = new Set(sourceMapProject.mechanisms.map(mechanism => mechanism.id));
projection.nodes.forEach(node => {
  if (node.sourceType === 'part') assert(node.sourceId && sourceMapProject.parts[node.sourceId], 'part node maps to canonical part');
  if (node.sourceType === 'scene-object') assert(node.sourceId && sourceMapProject.sceneObjects[node.sourceId], 'scene-object node maps to canonical scene object');
  if (node.sourceType === 'joint') assert(node.sourceId && sourceMapProject.skeleton?.joints[node.sourceId], 'joint node maps to canonical joint');
  if (node.sourceType === 'path') assert(node.sourceId && sourceMapProject.paths[node.sourceId], 'path node maps to canonical path');
  if (node.sourceType === 'mechanism') assert(node.sourceId && mechanismIds.has(node.sourceId), 'mechanism node maps to canonical mechanism');
  if (node.sourceType === 'bone') assert(node.sourceId && sampleBoneIds.has(node.sourceId), 'bone node maps to canonical skeleton bone tuple');
});
const renderOrders = projection.nodes.map(node => node.renderOrder);
assert.deepEqual(renderOrders, [...renderOrders].sort((a, b) => a - b), 'projection renderOrder is sorted and deterministic');
assert(projection.labels.every(label => label.id && label.text && 'x' in label.anchorPoint && 'y' in label.anchorPoint), 'projection labels follow minimum schema');
assert(projection.cameras.some(camera => camera.id === 'locked-2.5d' && camera.label === '2.5D Locked' && camera.locked && !camera.orbitEnabled), 'projection includes locked authoring camera');
assert(projection.cameras.some(camera => camera.id === 'toy-stage' && camera.label === 'Toy Stage' && !camera.locked && camera.orbitEnabled), 'projection includes toy-stage camera unlock preset');
projection.cameras.forEach(camera => assertFiniteDeep(camera, `camera.${camera.id}`));
assert(projection.interactions.some(binding => binding.type === 'draw-path-on-plane' && binding.enabled && binding.writesProject), 'projection exposes canonical plane path drawing interaction');
assert(projection.interactions.some(binding => binding.type === 'select-source' && binding.enabled && !binding.writesProject), 'projection exposes source selection interactions as view-only');
assert(projection.interactions.some(binding => binding.type === 'pan-zoom-locked-camera' && binding.enabled && !binding.writesProject), 'projection exposes locked pan/zoom as view-only');
assert(projection.interactions.some(binding => binding.type === 'unlock-camera' && binding.enabled && !binding.writesProject), 'projection exposes camera unlock as view-only');
const bakeInteraction = projection.interactions.find(binding => binding.type === 'bake-3d-transform');
assert(bakeInteraction && !bakeInteraction.enabled && !bakeInteraction.writesProject && bakeInteraction.reason, '3D transform bake is disabled and cannot mutate project by default');
const physicsBeforeJson = JSON.stringify(projectionProject);
const physicsSession = buildKinematicPhysicsSession(projectionProject, projection, Math.PI / 3);
assert.equal(JSON.stringify(projectionProject), physicsBeforeJson, 'physics session does not mutate ProjectState');
assert.deepEqual(buildKinematicPhysicsSession(projectionProject, projection, Math.PI / 3), physicsSession, 'physics session is deterministic for the same projection and angle');
assert.equal(physicsSession.version, 1, 'physics session exposes schema version');
assert.equal(physicsSession.sourceProjectionVersion, projection.version, 'physics session records projection schema source');
assert(physicsSession.summary.bodyCount >= projection.nodes.filter(node => ['part', 'joint', 'mechanism', 'hardware'].includes(node.sourceType)).length, 'physics session creates bodies from projected scene nodes');
assert(physicsSession.summary.constraintCount >= projectionProject.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).length, 'physics session samples mechanism constraints');
assert(physicsSession.bodies.some(body => body.sourceType === 'mechanism-state' && body.label.includes('effector')), 'physics session includes kinematic end-effector samples');
assert(physicsSession.summary.maxSpeed > 0, 'physics session derives non-zero kinematic velocity from the current mechanism animation');
assert(physicsSession.summary.maxForce > 0, 'physics session derives non-zero acceleration/force from the current mechanism animation');
assert.equal(physicsSession.summary.frictionCoefficient, sample.settings.simulationFriction, 'physics session records project friction');
assert.equal(physicsSession.summary.massKg, sample.settings.simulationMassKg, 'physics session records project mass');
assert.equal(physicsSession.summary.physicsKernel, PHYSICS_KERNEL_ENGINE, 'PhysicsSession summary declares the selected Rapier kernel');
assert.equal(physicsSession.summary.renderStack, PHYSICS_RENDER_STACK, 'PhysicsSession summary declares the selected Three/WebGL render stack');
assert.equal(physicsSession.summary.updatePolicy, PHYSICS_UPDATE_POLICY, 'PhysicsSession summary declares the kinematic-authority physics update policy');
assert.equal(physicsSession.summary.scenePolicy, HIGH_THROUGHPUT_SCENE_POLICY, 'PhysicsSession summary declares the high-throughput scene policy');
assert(physicsSession.summary.maxConstraintError >= 0, 'physics session reports mechanism constraint error');
assertFiniteDeep(physicsSession, 'physicsSession');

const foundryOverlayMechanism = createDefaultMechanism('4bar', 'contract-foundry-overlay');
const foundryOverlayTraces = generateMechanismPointTraces(foundryOverlayMechanism, 96).traces;
const foundryOverlayPrimaryTrace = foundryOverlayTraces.find(trace => trace.primary) ?? foundryOverlayTraces[0];
const foundryOverlaySimulation = {
  state: calculateLinkage(foundryOverlayMechanism, Math.PI / 3),
  scale: 1,
  pathPoints: foundryOverlayPrimaryTrace?.points ?? generateCurvePoints(foundryOverlayMechanism, 96).points
};
const foundryOverlay = buildFoundryPhysicsOverlay(foundryOverlayMechanism, foundryOverlaySimulation, Math.PI / 3, sample.settings);
assert.equal(foundryOverlay.rule, mechanismPhysicsRule('4bar'), 'Foundry overlay uses the same type-specific PhysicsSession rule text');
assert(foundryOverlay.playhead && foundryOverlay.velocityTip && foundryOverlay.forceTip && foundryOverlay.driveTip, 'Foundry overlay derives visible playhead, velocity, force, and drive vectors from sampled kinematics');
assert(Math.abs(foundryOverlay.velocityMagnitude - Math.hypot(foundryOverlay.velocityRaw.x, foundryOverlay.velocityRaw.y)) < 1e-9, 'Foundry velocity readout matches the displayed velocity vector');
assert(Math.abs(foundryOverlay.forceMagnitude - Math.hypot(foundryOverlay.forceRaw.x, foundryOverlay.forceRaw.y)) < 1e-9, 'Foundry force readout matches the displayed total force vector');
assert(foundryOverlay.playhead && foundryOverlay.forceTip && ((foundryOverlay.forceTip.x - foundryOverlay.playhead.x) * foundryOverlay.forceRaw.x + (foundryOverlay.forceTip.y - foundryOverlay.playhead.y) * foundryOverlay.forceRaw.y) > 0, 'Foundry force arrow points along the live total force vector');
assert(foundryOverlay.constraintError < 1e-6, 'Foundry overlay constraint error matches the sampled 4-bar pose');
assertFiniteDeep(foundryOverlay, 'foundryPhysicsOverlay');
{
  const gearLinkageMechanism = createDefaultMechanism('gear_linkage', 'foundry-gear-linkage-playhead');
  const gearLinkageState = calculateLinkage(gearLinkageMechanism, Math.PI / 3);
  const gearLinkageTrace = generateMechanismPointTraces(gearLinkageMechanism, 48).traces.find(trace => trace.primary);
  const overlay = buildFoundryPhysicsOverlay(gearLinkageMechanism, { state: gearLinkageState, scale: 1, pathPoints: gearLinkageTrace?.points ?? [] }, Math.PI / 3, sample.settings);
  assert.equal(overlay.playheadSource, 'mechanism-effector', 'Foundry gear-linkage vectors anchor to the L4 end-effector, not the intermediate gear handle');
  assert.deepEqual(overlay.playhead, gearLinkageState.effector, 'Foundry gear-linkage playhead equals the sampled end-effector');
}
{
  const planetaryMechanism = createDefaultMechanism('planetary_gear', 'foundry-planetary-playhead');
  const planetaryState = calculateLinkage(planetaryMechanism, Math.PI / 3);
  const planetaryTrace = generateMechanismPointTraces(planetaryMechanism, 48).traces.find(trace => trace.primary);
  const overlay = buildFoundryPhysicsOverlay(planetaryMechanism, { state: planetaryState, scale: 1, pathPoints: planetaryTrace?.points ?? [] }, Math.PI / 3, sample.settings);
  assert.equal(overlay.playheadSource, 'carrier-output', 'Foundry planetary vectors anchor to the carrier output, not a planet pitch point');
  assert.deepEqual(overlay.playhead, planetaryState.p2, 'Foundry planetary playhead equals the sampled carrier center');
}
{
  const camMechanism = createDefaultMechanism('cam', 'foundry-cam-contact');
  const camState = calculateLinkage(camMechanism, Math.PI / 3);
  const overlay = buildFoundryPhysicsOverlay(camMechanism, { state: camState, scale: 1, pathPoints: generateCurvePoints(camMechanism, 48).points }, Math.PI / 3, sample.settings);
  assert(overlay.constraintError < 1e-6, 'Foundry cam contact/guide overlay uses the sampled cam kinematics instead of an arbitrary rocker-length error');
}
const warningProjection = buildToonSceneProjection({ ...sample, mechanisms: [{ ...sample.mechanisms[0], warnings: ['projection warning'] }] });
assert(warningProjection.warnings.some(warning => warning.message === 'projection warning' && warning.sourceType === 'mechanism' && warning.recoveryStage === 'design'), 'projection warning maps to source and recovery stage');
assert(warningProjection.labels.some(label => label.text === 'projection warning' && label.severity === 'warning'), 'projection creates warning label chips');
const warningLabel = warningProjection.labels.find(label => label.text === 'projection warning');
const warningSourceNode = warningLabel?.anchorNodeId ? warningProjection.nodes.find(node => node.id === warningLabel.anchorNodeId) : undefined;
assert(warningLabel && warningSourceNode && (warningLabel.anchorPoint.x !== 0 || warningLabel.anchorPoint.y !== 0), 'projection warning labels anchor to their source node instead of stacking at origin');
const sceneAnchorOnlyMechanism = {
  ...createDefaultMechanism('crank', 'scene-anchor-only'),
  anchorX: undefined,
  anchorY: undefined,
  sceneAnchor: { x: 77, y: -33 },
  transform: { x: 77, y: -33, rotation: 0, scale: 1 },
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand'
};
const sceneAnchorProjection = buildToonSceneProjection({ ...sample, mechanisms: [sceneAnchorOnlyMechanism] });
const sceneAnchorBase = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/base');
const sceneAnchorOutput = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/output');
assert.equal(sceneAnchorBase, undefined, 'runtime projection excludes a mechanism that has not passed whole-candidate authority with canonical anchor coordinates');
assert.equal(sceneAnchorOutput, undefined, 'runtime projection does not render derived output geometry for a rejected sceneAnchor-only candidate');
const disabledMechanismProject = {
  ...sample,
  mechanisms: [
    boundMechanism('4bar', 'enabled-one'),
    { ...boundMechanism('4bar', 'disabled-one'), enabled: false },
    { ...boundMechanism('4bar', 'hidden-one'), visible: false }
  ]
};
assert.equal(createFabricationPackage(disabledMechanismProject).recipes.length, 1, 'fabrication exports only visible enabled mechanisms');
assert.equal(loadProjectSnapshot(disabledMechanismProject).mechanisms[1].enabled, false, 'project import preserves disabled mechanism state');
const disabledDxf = generateLowLevelMechanismDXF({ speed: 1, rotation: 0, mechanisms: disabledMechanismProject.mechanisms }, 0);
assert(disabledDxf.includes('ENABLED-ONE'.replace(/[^A-Za-z0-9_-]/g, '_')), 'DXF includes enabled mechanism');
assert(!disabledDxf.includes('DISABLED-ONE'.replace(/[^A-Za-z0-9_-]/g, '_')), 'DXF excludes disabled mechanism');
ALL_MECHANISM_TYPES.forEach(type => {
  const mechanism = createDefaultMechanism(type, `contract-${type}`);
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].filter(Boolean).forEach(point => {
      assert(Number.isFinite(point!.x) && Number.isFinite(point!.y), `${type} animation keeps finite coordinates`);
    });
  });
  assert(generateCurvePoints(mechanism, 24).points.length > 0, `${type} generates an output motion path`);
  const pointTraces = generateMechanismPointTraces(mechanism, 24).traces;
  assert(pointTraces.length > 0, `${type} exposes physical moving-joint traces for Foundry`);
  assert(pointTraces.some(trace => trace.primary && trace.points.length > 1), `${type} marks one physical trace as the primary output path`);
  const foundryPlaybackTraces = generateFoundryPlaybackPointTraces(mechanism, 24).traces;
  assert(foundryPlaybackTraces.length > 0, `${type} exposes Foundry playback traces for Mech Path`);
  assert(foundryPlaybackTraces.some(trace => trace.primary && trace.points.length > 1), `${type} marks one Foundry playback trace as the selectable Mech Path target`);
  if (REFERENCE_FOUNDRY_TYPES.includes(type)) {
    const generatedMechanism = mechanismWithGeneratedPath(mechanism);
    const generatedPath = generatedMechanism.generatedPath ?? [];
    const primaryPlaybackTrace = generateFoundryPlaybackPointTraces(mechanism, 96).traces.find(trace => trace.primary);
    assert(primaryPlaybackTrace, `${type} has a primary Foundry-visible playback trace`);
    assert.equal(generatedPath.length, primaryPlaybackTrace.points.length, `${type} generated Mech Path stores the Foundry-visible trace length`);
    const midpoint = Math.floor(primaryPlaybackTrace.points.length / 2);
    assert(Math.hypot(generatedPath[0].x - primaryPlaybackTrace.points[0].x, generatedPath[0].y - primaryPlaybackTrace.points[0].y) < 1e-6, `${type} generated Mech Path starts on the Foundry-visible output point`);
    assert(Math.hypot(generatedPath[midpoint].x - primaryPlaybackTrace.points[midpoint].x, generatedPath[midpoint].y - primaryPlaybackTrace.points[midpoint].y) < 1e-6, `${type} generated Mech Path follows the Foundry-visible output point`);
  }
  if (type === '4bar') {
    assert(pointTraces.some(trace => trace.id === 'B' && trace.points.length > 1), '4bar exposes the B crank-joint path');
    assert(pointTraces.some(trace => trace.id === 'C' && trace.primary && trace.points.length > 1), '4bar exposes C as the primary output-joint path');
  }
  if (type === 'gear_linkage') {
    assert(pointTraces.some(trace => trace.id === 'R' && trace.primary && trace.label.includes('shared')), 'gear-linkage primary trace follows the shared R linkage output, not either gear crank pin');
  }
  if (type === 'planetary_gear') {
    assert(pointTraces.some(trace => trace.id === 'C' && trace.primary && trace.label.includes('carrier')), 'planetary primary trace follows the carrier output, not a planet pitch point');
  }
  const templateProject = {
    ...sample,
    mechanisms: [mechanismWithGeneratedPath({
      ...mechanism,
      targetPartId: 'right_hand_part',
      targetPathId: 'path-right-arm',
      targetAnchorJointId: 'right_hand',
      activeVisualPartIds: ['right_hand_part']
    })]
  };
  const templateProjection = buildToonSceneProjection(templateProject);
  if (['4bar', 'gear_linkage', 'gear', 'planetary_gear', 'cam', 'piston'].includes(type)) {
    const templateContract = buildProjectMechanismSceneContract(templateProject, mechanism.id);
    assert(templateContract?.projectDriveEnabled, `${type} reaches the full-project scene gate`);
    const templateNodes = templateProjection.nodes.filter(node => node.sourceId === mechanism.id);
    assert(templateNodes.some(node => node.sourceType === 'mechanism' && node.mechanismLayerId), `${type} projects canonical 2.5D mechanism layers`);
    assert(templateNodes.some(node => node.sourceType === 'hardware' && node.parentId?.startsWith(`/mechanisms/${mechanism.id}/layers/`)), `${type} projects canonical hardware under a physical mechanism layer`);
    assert(templateNodes.every(node => node.mechanismCompilerSignature === templateContract.compilerSignature), `${type} 2.5D layers share the authoritative compiler signature`);
  }
  const templatePhysics = buildKinematicPhysicsSession(templateProject, templateProjection, Math.PI / 4);
  assert(templatePhysics.bodies.some(body => body.mechanismId === mechanism.id && body.sourceType === 'mechanism-state'), `${type} creates physics mechanism-state bodies`);
  assert(templatePhysics.constraints.some(constraint => constraint.mechanismId === mechanism.id), `${type} creates physics mechanism constraints`);
  const constraintLabels = templatePhysics.constraints.filter(constraint => constraint.mechanismId === mechanism.id).map(constraint => constraint.label).join(' | ');
  const expectedConstraint = ({
    cam: 'cam follower contact',
    'rack-pinion': 'rack linear guide',
    gear: 'gear mesh pair',
    gear_linkage: 'drive L4 linkage arm',
    planetary_gear: 'planet gear mesh',
    piston: 'slider guide',
    yoke: 'pin-in-slot guide',
    'quick-return': 'slotted-arm guide',
    '5bar': 'right crank phase rod',
    '6bar': 'six-bar dyad link length',
    '4bar': 'coupler length',
    crank: 'crank length'
  } as Record<string, string>)[type];
  assert(constraintLabels.includes(expectedConstraint), `${type} exposes a type-specific physics constraint (${expectedConstraint})`);
  assert(templatePhysics.summary.maxSpeed >= 0 && templatePhysics.summary.maxForce >= 0, `${type} exports velocity and force magnitudes`);
  assert(templatePhysics.summary.maxConstraintError < 1e-6, `${type} physics constraints match the sampled kinematic pose`);
  assertFiniteDeep(templatePhysics, `${type}.templatePhysics`);
});

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const graphParityAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const graphParityGearG3 = gearSceneRadiusByKey('g24');
const graphParityGearG1 = gearSceneRadiusByKey('g8');
[
  normalizeMechanismToReference(createDefaultMechanism('4bar', 'graph-parity-fourbar')),
  { ...normalizeMechanismToReference(createDefaultMechanism('4bar', 'graph-parity-fourbar-crossed')), assemblyMode: 'crossed' as const },
  normalizeMechanismToReference(createDefaultMechanism('piston', 'graph-parity-piston')),
  normalizeMechanismToReference(createDefaultMechanism('cam', 'graph-parity-cam')),
  normalizeMechanismToReference(createDefaultMechanism('gear', 'graph-parity-gear')),
  normalizeGearTrainToFabrication({
    ...createDefaultMechanism('gear', 'graph-parity-gear-idler'),
    crankLength: graphParityGearG3,
    rockerLength: graphParityGearG3,
    gearTrainRadii: [graphParityGearG3, graphParityGearG1, graphParityGearG3]
  }),
  normalizeMechanismToReference(createDefaultMechanism('gear_linkage', 'graph-parity-gear-linkage')),
  normalizeMechanismToReference(createDefaultMechanism('planetary_gear', 'graph-parity-planetary'))
].forEach(mechanism => {
  graphParityAngles.forEach(angle => {
    const legacy = calculateLinkage(mechanism, angle);
    const compilerSample = sampleMechanismGraphMotion(mechanism, angle);
    assert.equal(compilerSample.source, 'calculateLinkage', `${mechanism.id} compiler output motion uses the shared closed-form solver fast path`);
    assertJointStateClose(compilerSample.state, legacy, `${mechanism.id} compiler output motion at ${angle}`);
  });
});

const assertDistance = (a: { x: number; y: number }, b: { x: number; y: number }, expected: number, label: string, epsilon = 1e-6) => {
  assert(Math.abs(distance(a, b) - expected) < epsilon, label);
};
const selectedPhysicalLength = (mechanism: MechanismConfig, role: ConnectionSelectionRole) => {
  const connection = resolveMechanismPhysicalConnections(mechanism).connections.find((item: ResolvedPhysicalConnection) => item.role === role);
  if (!connection?.local) throw new Error(`${role} has no resolved physical source length`);
  return connection.local.length;
};
const selectedPhysicalAngle = (mechanism: MechanismConfig, role: ConnectionSelectionRole) => {
  const connection = resolveMechanismPhysicalConnections(mechanism).connections.find((item: ResolvedPhysicalConnection) => item.role === role);
  if (!connection?.local) throw new Error(`${role} has no resolved physical source angle`);
  return connection.local.localAngle;
};
const localPhysicalGuidePoint = (
  mechanism: MechanismConfig,
  role: 'cam.guide-mount' | 'piston.guide-mount',
  point: { x: number; y: number },
) => {
  const mount = resolveMechanismPhysicalConnections(mechanism).connections.find((item: ResolvedPhysicalConnection) => item.role === role)?.boardMount;
  if (!mount) throw new Error(`${role} has no resolved board mount`);
  const angle = mount.sourceRotation;
  const dx = point.x - mount.center.x;
  const dy = point.y - mount.center.y;
  return {
    x: dx * Math.cos(-angle) - dy * Math.sin(-angle),
    y: dx * Math.sin(-angle) + dy * Math.cos(-angle)
  };
};
const requiredParts = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  mechanismRequiredParts(createDefaultMechanism(type, `parts-${type}`));
const requiredPartNames = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  requiredParts(type).map(part => part.name);
const requiredPartQuantities = (type: Parameters<typeof createDefaultMechanism>[0]) =>
  Object.fromEntries(requiredParts(type).map(part => [part.name, part.quantity]));
const offBoardRequiredParts = mechanismRequiredParts({ ...createDefaultMechanism('4bar', 'parts-off-board'), anchorX: 999999, anchorY: 999999 });
assert(offBoardRequiredParts.some(part => part.category === 'blocker' && /^Fix: /.test(part.name)), 'mechanismRequiredParts returns compiler blocker evidence instead of hiding failures as an empty parts list');

{
  const mechanism = createDefaultMechanism('4bar', 'contract-4bar-physical');
  const state = calculateLinkage(mechanism, 0);
  assert(state.isValid, '4bar default has a valid sampled assembly pose');
  assertDistance(state.p1, state.j1, mechanism.crankLength, '4bar crank length is preserved');
  assertDistance(state.j1, state.j2, mechanism.couplerLength, '4bar coupler length is preserved');
  assertDistance(state.p2, state.j2, mechanism.rockerLength, '4bar rocker length is preserved');
  assertDistance(state.p1, state.p2, mechanism.groundLength, '4bar A-D ground link is fixed while A-B, B-C, C-D move');
  assert(state.j2.y >= state.p1.y, '4bar default uses the front/open assembly branch instead of the crossed underside branch');
  const negativeOutputAngleState = calculateLinkage({ ...mechanism, couplerPointAngle: -40 }, 0);
  assert(negativeOutputAngleState.isValid, '4bar remains valid when the coupler output angle is negative');
  assert(negativeOutputAngleState.j2.y >= negativeOutputAngleState.p1.y, '4bar assembly branch is independent of output-point angle');
  assert.deepEqual(requiredPartQuantities('4bar'), { 'Paper fastener': 5, 'Spacer 10mm OD / 4mm hole': 3, '3-hole link': 2, '5-hole link': 1 }, '4bar required parts come from the graph compiler recipe');
  assert.deepEqual(
    fabricationStackForMechanism(mechanism).filter(layer => layer.role === 'linkage').map(layer => layer.label),
    ['Input L2 linkage', 'Coupler L4 linkage', 'Output L2 linkage'],
    '4bar fabrication stack exposes exactly L2/L4/L2 moving bars around the A-D ground link'
  );
  const resizedFourBar = {
    ...mechanism,
    crankLength: linkageSceneLengthByCells(4),
    couplerLength: linkageSceneLengthByCells(6),
    rockerLength: linkageSceneLengthByCells(4)
  };
  assert.deepEqual(
    mechanismRequiredParts(resizedFourBar).filter(part => part.category === 'linkage').map(part => `${part.name}:${part.quantity}`).sort(),
    ['5-hole link:2', '7-hole link:1'],
    '4bar graph-required parts follow selected link-hole sizes instead of the static recipe'
  );
  assert.deepEqual(
    fabricationStackForMechanism(resizedFourBar).filter(layer => layer.role === 'linkage').map(layer => layer.label),
    ['Input L4 linkage', 'Coupler L6 linkage', 'Output L4 linkage'],
    '4bar fabrication stack follows selected link-hole sizes'
  );
  assert.equal(
    fabricationRenderPlanForMechanism(resizedFourBar).stackSummary,
    fabricationStackForMechanism(resizedFourBar).map(layer => layer.label).join(' → '),
    '4bar render plan is derived from the resized fabrication stack'
  );
}

{
  const mechanism = createDefaultMechanism('piston', 'contract-piston-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'piston default has valid slider-crank samples');
    assertDistance(state.p1, state.j1, selectedPhysicalLength(mechanism, 'piston.crank-pin'), 'piston crank pin comes from its selected linkage hole');
    assertDistance(state.j1, state.j2, selectedPhysicalLength(mechanism, 'piston.rod-slider-pin'), 'piston connecting rod comes from its selected linkage hole');
    assert(Math.abs(localPhysicalGuidePoint(mechanism, 'piston.guide-mount', state.j2).y - mechanism.sliderOffset) < 1e-6, 'piston slider stays on the selected guide offset');
  });
  assert.equal(referenceRecipeForType('piston').canonicalKey, 'slider_crank', 'piston recipe is normalized to slider_crank in mechanism-reference');
  assert(requiredPartNames('piston').includes('Straight guide'), 'piston graph recipe includes a fixed guide');
  assert(requiredPartNames('piston').includes('Slider block'), 'piston graph recipe includes a moving slider block');
}

{
  const mechanism = createDefaultMechanism('yoke', 'contract-yoke-graph-buildable');
  assert(requiredParts('yoke').length > 0, 'scotch yoke required parts come from the graph compiler recipe');
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], 'scotch yoke is graph-buildable for preview/export readiness');
}

{
  const mechanism = createDefaultMechanism('quick-return', 'contract-quick-return-graph-buildable');
  assert(requiredParts('quick-return').length > 0, 'quick-return required parts come from the graph compiler recipe');
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], 'quick-return is graph-buildable for preview/export readiness');
}

{
  const mechanism = createDefaultMechanism('5bar', 'contract-5bar-graph-buildable');
  assert(requiredParts('5bar').length > 0, '5bar required parts come from the graph compiler recipe');
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], '5bar is graph-buildable for preview/export readiness');
  const topology = {
    ...mechanism,
    anchorX: 0,
    anchorY: 0,
    groundAngle: 0,
    groundLength: 120,
    crankLength: 40,
    rockerLength: 40,
    couplerLength: 70,
    rodLength: 70,
    speed1: 1,
    speed2: 0,
    phase: Math.PI,
    assemblyMode: 'open' as const
  };
  const pose = calculateLinkage(topology, 0);
  assert(pose.isValid && pose.aux, '5bar A-B-C-D-E topology closes with A-E as ground');
  assertDistance(pose.p1, pose.j1, topology.crankLength, '5bar A-B input crank length is preserved');
  assertDistance(pose.j1, pose.j2, topology.couplerLength, '5bar B-C left floating rod length is preserved');
  assertDistance(pose.j2, pose.aux, topology.rodLength, '5bar C-D right floating rod length is preserved');
  assertDistance(pose.aux, pose.p2, topology.rockerLength, '5bar D-E right crank length is preserved');
  assertDistance(pose.p1, pose.p2, topology.groundLength, '5bar A-E ground linkage length is preserved');
}

{
  const mechanism = createDefaultMechanism('6bar', 'contract-6bar-graph-buildable');
  assert(requiredParts('6bar').length > 0, '6bar required parts come from the graph compiler recipe');
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], '6bar is graph-buildable for preview/export readiness');
  assert(compileMechanismRenderPlan(mechanism).layers.length > 0, '6bar compiler render plan is graph-owned instead of empty legacy stack output');
}

{
  const mechanism = createDefaultMechanism('cam', 'contract-cam-physical');
  const low = calculateLinkage(mechanism, Math.PI / 2);
  const high = calculateLinkage(mechanism, (3 * Math.PI) / 2);
  assert(low.isValid && high.isValid, 'cam follower default has valid lift samples');
  assert.deepEqual(low.j2, low.effector, 'cam follower output is the follower block');
  assert.deepEqual(high.j2, high.effector, 'cam follower lifted output remains the follower block');
  const liftLength = Math.max(1, mechanism.rockerLength || mechanism.crankLength);
  const maxDefaultCamSampleIndex = mechanism.camProfileSamples?.reduce((best, value, index, list) => value > list[best] ? index : best, 0) ?? 0;
  const maxDefaultCamAngle = ((maxDefaultCamSampleIndex / Math.max(1, mechanism.camProfileSamples?.length ?? 1)) * Math.PI * 2);
  assert(Math.abs(camFollowerRise(liftLength, maxDefaultCamAngle, mechanism.camProfileSamples) - liftLength) < 1e-6, 'cam follower full lift comes from the shared cam profile');
  assert(camProfileScale(Math.PI) > camProfileScale(0), 'rendered cam profile has the same high-lift lobe used by kinematics');
  const customProfile = [0.7, 1.45, 0.7, 0.55, 0.7, 0.95, 0.7, 0.65];
  const custom = { ...mechanism, camProfileSamples: customProfile };
  const sharpProfile = { ...mechanism, camProfileSamples: [1, 1.65, 0.35, 1.65, 1, 0.65, 1.2, 1] };
  assert.equal(sampleFeasibleRange(sharpProfile).warning, 'Cam edge too steep. Smooth the profile.', 'steep cam profiles warn before students fabricate a follower drop that can jam');
  assert.equal(sampledCamProfileScale(Math.PI / 4, customProfile), 1.45, 'editable cam profile samples are angle-indexed and round-trip into shared geometry');
  assert(localPhysicalGuidePoint(custom, 'cam.guide-mount', calculateLinkage(custom, Math.PI / 4).j2).y > localPhysicalGuidePoint(mechanism, 'cam.guide-mount', calculateLinkage(mechanism, Math.PI / 4).j2).y, 'edited cam lobe changes the follower lift used by simulation');
  const defaultCamExportPath = generateLowLevelMechanismSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  const customCamExportPath = generateLowLevelMechanismSVG({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  assert(defaultCamExportPath && customCamExportPath && defaultCamExportPath !== customCamExportPath, 'cam SVG export uses edited cam profile samples');
  assert(generateLowLevelMechanismDXF({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).includes('CONTRACT-CAM-PHYSICAL_CAM'), 'cam DXF export includes an explicit sampled cam profile layer');
  assert(localPhysicalGuidePoint(mechanism, 'cam.guide-mount', high.j2).y > localPhysicalGuidePoint(mechanism, 'cam.guide-mount', low.j2).y, 'cam follower lift increases along the selected guide');
  assert(Math.abs(localPhysicalGuidePoint(mechanism, 'cam.guide-mount', low.j1).x) < 1e-6, 'cam contact point sits on the selected follower guide axis');
  assert(Math.abs(localPhysicalGuidePoint(mechanism, 'cam.guide-mount', low.j2).x) < 1e-6, 'gravity follower center stays on the selected guide axis');
  assertDistance(low.j1, low.j2, mechanism.sliderOffset, 'capsule follower head remains one follower radius from the sampled cam surface');
  assert(camFollowerConstraintError(mechanism, low) < 1e-6, 'shared cam contact invariant checks the physical guide mount instead of the cam axle');
  const contactProfileAngle = resolveMechanismPhysicalConnections(mechanism).connections.find(item => item.role === 'cam.guide-mount')!.boardMount!.sourceRotation;
  assert.equal(
    Math.abs(
      localPhysicalGuidePoint(mechanism, 'cam.guide-mount', low.j1).y
      - localPhysicalGuidePoint(mechanism, 'cam.guide-mount', low.p1).y
      - mechanism.crankLength * sampledCamProfileScale(contactProfileAngle, mechanism.camProfileSamples),
    ) < 1e-6,
    true,
    'cam contact radius samples the rendered profile along the selected guide axis',
  );
  assert(low.aux && distance(low.p1, low.aux) > 0, 'cam kinematics preserves a separate drive-angle reference instead of reusing the follower contact as rotation');
  const camRecipe = referenceRecipeForType('cam');
  assert.equal(camRecipe.title, 'Pegboard-mounted gravity cam follower module', 'cam recipe exposes the pegboard-mounted gravity module name');
  assert.equal(camRecipe.physicsRule, 'rotating cam contact + vertical prismatic follower + gravity preload', 'cam physics rule maps to rotating cam, prismatic follower, contact, and gravity');
  assert.deepEqual(requiredPartQuantities('cam'), {
    'Swappable cam disk': 1,
    'U-channel guide cartridge': 1,
    'Preassembled gravity follower module': 1,
    'Crank handle': 1,
    'Axle peg': 1,
    'Paper fastener': 2,
    'Paper washer': 2,
    'Cam spacer': 1,
    'Cam lock disk': 1
  }, 'cam required parts come from the graph compiler recipe with swappable disk, guide cartridge, gravity follower, axle, washer, and lock modules');
  const camRenderPlan = fabricationRenderPlanForMechanism(mechanism);
  const camDiskZ = camRenderPlan.layers.find(layer => layer.label === 'Swappable cam disk')?.z;
  const camGuideZ = camRenderPlan.layers.find(layer => layer.label === 'U-channel guide cartridge')?.z;
  const camFollowerZ = camRenderPlan.layers.find(layer => layer.label === 'Preassembled gravity follower module')?.z;
  assert(typeof camDiskZ === 'number' && typeof camGuideZ === 'number' && typeof camFollowerZ === 'number', 'cam render plan exposes disk, guide, and follower module layers');
  assert(camRenderPlan.layers.every(layer => layer.physicalDepthMm > 0), 'cam guide and gravity follower use canonical physical depth instead of a full serial visual gap assertion');
  assert.deepEqual(camRecipe.stackLabels, ['15x15 pegboard base', 'Axle peg', 'Crank handle', 'Paper washer', 'Cam spacer', 'Swappable cam disk', 'Paper washer', 'Cam lock disk', 'U-channel guide cartridge', 'Preassembled gravity follower module v2'], 'cam stack labels document the pegboard base plus plug-in modules');
  const camRecipeText = JSON.stringify(camRecipe);
  assert(!/S10 spacer|Eccentric cam|Round follower|2-hole bracket|rubber band|spring|metal bearing|plastic spacer|backplate|free-floating loose rail/i.test(camRecipeText), 'cam recipe data blocks the old stack and excluded hardware');
}

{
  const mechanism = createDefaultMechanism('rack-pinion', 'contract-rack-pinion-graph-buildable');
  assert(requiredParts('rack-pinion').length > 0, 'rack-pinion required parts come from the graph compiler recipe');
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], 'rack-pinion is graph-buildable for preview/export readiness');
}

{
  const mechanism = createDefaultMechanism('gear', 'contract-gear-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear train default has valid sampled poses');
    assertDistance(state.p1, state.j1, selectedPhysicalLength(mechanism, 'gear.drive-pin'), 'gear input point comes from its selected attachment hole');
    assertDistance(state.p2, state.j2, selectedPhysicalLength(mechanism, 'gear.output-pin'), 'gear output point comes from its selected attachment hole');
    assertDistance(state.p1, state.p2, gearTrainPitchCenterDistance(mechanism), 'gear axles preserve direct pitch contact for the default two-gear mesh');
  });
  assert.equal(mechanism.crankLength, REFERENCE_DEFAULTS.gearTrain.driveRadius, 'gear train default uses the fabrication G3 drive gear pitch radius');
  assert.equal(mechanism.rockerLength, REFERENCE_DEFAULTS.gearTrain.outputRadius, 'gear train default uses the fabrication G3 output gear pitch radius');
  assert.equal(mechanism.groundLength, gearTrainPitchCenterDistance(mechanism), 'gear train default directly meshes the two endpoint gears');
  assert.equal(mechanism.groundLength, mechanism.crankLength + mechanism.rockerLength, 'two endpoint gears use tangent pitch circles');
  assert.equal(gearTrainResolvedCenterDistance(mechanism), gearTrainPitchCenterDistance(mechanism), 'resolved center distance keeps the direct mesh pitch span');
  assert.equal(mechanism.gearRatio, gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'gear train default ratio is derived from ordered pitch radii');
  assert.deepEqual(gearTrainPitchRadii(mechanism), [mechanism.crankLength, mechanism.rockerLength], 'gear train default stores the legacy two-gear pair as the ordered pitch-radius train');
  assert.equal(gearTrainOutputRatio(mechanism), gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'two-gear train helper preserves legacy reverse rotation');
  const g5 = gearSceneRadiusByKey('g40');
  const g1 = gearSceneRadiusByKey('g8');
  const g3 = gearSceneRadiusByKey('g24');
  const unequalGear = { ...mechanism, crankLength: g3, rockerLength: g5, gearTrainRadii: [g3, g5], groundLength: g3 + g5, gearRatio: -99, speed2: -99 };
  const unequalStart = calculateLinkage(unequalGear, 0);
  const unequalQuarter = calculateLinkage(unequalGear, Math.PI / 2);
  assert(Math.hypot(unequalQuarter.j2.x - unequalStart.j2.x, unequalQuarter.j2.y - unequalStart.j2.y) > 1, 'two-gear mesh output follows the physical pitch ratio');
  assertDistance(unequalQuarter.p1, unequalQuarter.p2, gearTrainPitchCenterDistance(unequalGear), 'two-gear configs collapse to direct pitch contact for plain gear trains');
  const compoundGear = normalizeGearTrainToFabrication({ ...mechanism, crankLength: g5, rockerLength: g3, gearTrainRadii: [g5, g1, g3], groundLength: 999 });
  const compoundQuarter = calculateLinkage(compoundGear, Math.PI / 2);
  const compoundOutputAngle = Math.atan2(compoundQuarter.j2.y - compoundQuarter.p2.y, compoundQuarter.j2.x - compoundQuarter.p2.x);
  assertDistance(compoundQuarter.p1, compoundQuarter.p2, g5 + g1 + g1 + g3, 'compound gear train pitch centers accumulate adjacent fabrication gear radii');
  assert(Math.abs(compoundOutputAngle - (gearTrainOutputRatio(compoundGear) * Math.PI / 2 + selectedPhysicalAngle(compoundGear, 'gear.output-pin'))) < 1e-6, 'compound gear train output follows idler parity and the selected output attachment-hole angle');
  assert.equal(gearTrainOutputRatio(compoundGear), g5 / g3, 'three-gear train has same output direction because the idler flips twice');
  assert(fabricationStackForMechanism(compoundGear).some(layer => layer.label === 'Idler G1 / 1-space gear 1'), 'compound gear fabrication stack preserves the selected idler gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G5 / 5-space gear')?.quantity, 1, 'compound gear train parts include the selected drive gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G1 / 1-space gear')?.quantity, 1, 'compound gear train parts include the selected idler gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G3 / 3-space gear')?.quantity, 1, 'compound gear train parts include the selected output gear size');
  const driverOffsetState = calculateLinkage({ ...mechanism, driverPhaseOffset: Math.PI / 4 }, 0);
  assert(Math.abs(Math.atan2(driverOffsetState.j1.y - driverOffsetState.p1.y, driverOffsetState.j1.x - driverOffsetState.p1.x) - (Math.PI / 4 + selectedPhysicalAngle(mechanism, 'gear.drive-pin'))) < 1e-6, 'driver phase offset rotates the selected input attachment before downstream constraints solve');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'gear')).forEach(config => {
    assert(config.gearTrainRadii?.every(gearSceneRadiusIsFabricationPreset), 'optimizer generates plain gear sizes from the fabrication gear preset set');
    assert.equal(config.groundLength, gearTrainPitchCenterDistance(config), 'optimizer keeps plain gear endpoints at direct pitch contact');
    assert.equal(config.groundLength, gearTrainResolvedCenterDistance(config), 'optimizer applies the resolved direct-mesh contract');
  });
  const mutatedGear = mutateConfig({ ...mechanism, groundLength: 999 }, 1, true);
  assert(mutatedGear.gearTrainRadii?.every(gearSceneRadiusIsFabricationPreset), 'optimizer mutation keeps plain gear sizes on the fabrication gear preset set');
  assert.equal(mutatedGear.groundLength, gearTrainPitchCenterDistance(mutatedGear), 'optimizer mutation keeps endpoint gears at direct pitch contact');
  assert.equal(mutatedGear.groundLength, gearTrainResolvedCenterDistance(mutatedGear), 'optimizer mutation applies the resolved direct-mesh contract');
  assert.equal(mutatedGear.gearRatio, gearTrainOutputRatio(mutatedGear), 'optimizer keeps gear ratio derived from ordered pitch radii');
  const gearOnlySvg = generateLowLevelMechanismSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  const gearOnlyDxf = generateLowLevelMechanismDXF({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  assert(!gearOnlySvg.includes('<line'), 'gear train SVG export is gears-only without fake linkage rods');
  assert(!gearOnlyDxf.includes('\nLINE\n'), 'gear train DXF export is gears-only without fake linkage rods');
  assert((gearOnlySvg.match(/<path d="/g) ?? []).length >= 2, 'gear train SVG export still carries endpoint gear outlines');
  assert.deepEqual(requiredPartQuantities('gear'), { 'Paper fastener': 4, 'Spacer 10mm OD / 4mm hole': 2, 'G3 / 3-space gear': 2 }, 'gear train required parts come from the graph compiler recipe');
}

{
  const mechanism = createDefaultMechanism('gear_linkage', 'contract-gear-linkage-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear-linkage default has valid sampled poses');
    assertDistance(state.p1, state.j1, selectedPhysicalLength(mechanism, 'gear_linkage.drive-pin'), 'gear-linkage drive point comes from its selected attachment hole');
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'gear-linkage G3 endpoint centers preserve the separated board span');
    assertDistance(state.p2, state.j2, selectedPhysicalLength(mechanism, 'gear_linkage.output-pin'), 'gear-linkage output point comes from its selected attachment hole');
    assertDistance(state.j1, state.effector, mechanism.couplerLength, 'gear-linkage drive L4 linkage length is preserved');
    assertDistance(state.j2, state.effector, mechanism.couplerLength, 'gear-linkage output L4 linkage length is preserved');
  });
  assert.equal(mechanism.crankLength, REFERENCE_DEFAULTS.gearLinkage.driveRadius, 'gear-linkage drive radius uses the reference G3 pitch radius');
  assert.equal(mechanism.rockerLength, REFERENCE_DEFAULTS.gearLinkage.outputRadius, 'gear-linkage output gear radius uses the reference G3 pitch radius');
  assert.equal(mechanism.groundLength, REFERENCE_DEFAULTS.gearLinkage.centerDistance, 'gear-linkage endpoints leave a one-idler span instead of forcing A/B to mesh');
  assert(mechanism.groundLength > gearTrainPitchCenterDistance(mechanism), 'gear-linkage default endpoint gears are separated until an idler closes the pitch chain');
  assert.equal(mechanism.couplerPointDist, REFERENCE_DEFAULTS.gearLinkage.handleRadius, 'gear-linkage shared crank-pin radius uses the reference one-cell offset');
  assert.equal(mechanism.couplerLength, REFERENCE_DEFAULTS.gearLinkage.outputLinkage, 'gear-linkage paired links use the reference L4 linkage');
  const linkageStart = calculateLinkage(mechanism, 0);
  const linkageQuarter = calculateLinkage(mechanism, Math.PI / 2);
  assert(Math.hypot(linkageQuarter.j2.x - linkageStart.j2.x, linkageQuarter.j2.y - linkageStart.j2.y) > 1, 'gear-linkage output endpoint is a second driving crank, not a stationary placeholder');
  assert.deepEqual(requiredPartQuantities('gear_linkage'), { 'Paper fastener': 6, 'Spacer 10mm OD / 4mm hole': 4, 'G3 / 3-space gear': 2, '5-hole link': 2 }, 'gear-linkage required parts use gear attachment holes directly instead of duplicating them as crank blanks');
  const dynamicGearLinkageParts = mechanismRequiredParts({ ...mechanism, gearTrainRadii: [gearSceneRadiusByKey('g40'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g56')], couplerLength: linkageSceneLengthByCells(6) });
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G5 / 5-space gear')?.quantity, 1, 'gear-linkage required parts preserve a selected large drive gear');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G1 / 1-space gear')?.quantity, 1, 'gear-linkage required parts preserve selected idler gears');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G7 / 7-space gear')?.quantity, 1, 'gear-linkage required parts preserve a selected attachment-capable output gear');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === '7-hole link')?.quantity, 2, 'gear-linkage required parts preserve the selected paired linkage size');
  const compoundGearLinkage = normalizeGearLinkageToReference({
    ...mechanism,
    crankLength: gearSceneRadiusByKey('g40'),
    rockerLength: gearSceneRadiusByKey('g56'),
    couplerPointDist: 999,
    couplerLength: linkageSceneLengthByCells(6),
    gearTrainRadii: [gearSceneRadiusByKey('g40'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g56')],
    groundLength: 999
  });
  const compoundGearLinkageState = calculateLinkage(compoundGearLinkage, Math.PI / 2);
  assert.equal(compoundGearLinkage.gearRatio, gearTrainOutputRatio(compoundGearLinkage), 'gear-linkage derives output speed from the ordered gear train instead of locking gears to one speed');
  assertDistance(compoundGearLinkageState.p1, compoundGearLinkageState.p2, gearTrainResolvedCenterDistance(compoundGearLinkage), 'gear-linkage preserves selected fabrication gear sizes and resolves the endpoint/idler center span');
  assertDistance(compoundGearLinkageState.p1, compoundGearLinkageState.j1, compoundGearLinkage.couplerPointDist, 'gear-linkage snaps the drive crank pin to a real drive-gear attachment hole');
  assertDistance(compoundGearLinkageState.p2, compoundGearLinkageState.j2, compoundGearLinkage.couplerPointDist, 'gear-linkage snaps the output crank pin to a real output-gear attachment hole');
  assertDistance(compoundGearLinkageState.j1, compoundGearLinkageState.effector, linkageSceneLengthByCells(6), 'gear-linkage preserves the selected L6 drive linkage length');
  assertDistance(compoundGearLinkageState.j2, compoundGearLinkageState.effector, linkageSceneLengthByCells(6), 'gear-linkage preserves the selected L6 paired linkage length');
  assert(compoundGearLinkageState.aux, 'gear-linkage exposes an idler gear center when the user inserts idlers');
  const rejectedG1Drive = normalizeGearLinkageToReference({ ...mechanism, gearTrainRadii: [gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g24')], crankLength: gearSceneRadiusByKey('g8') });
  assert.notEqual(fabricationGearSpecForPitchRadius((rejectedG1Drive.crankLength ?? 0) / SCENE_PX_PER_MM).key, 'g8', 'gear-linkage rejects G1 as a drive gear because it has no attachment holes');
  const rejectedG1Output = normalizeGearLinkageToReference({ ...mechanism, gearTrainRadii: [gearSceneRadiusByKey('g24'), gearSceneRadiusByKey('g8')], rockerLength: gearSceneRadiusByKey('g8') });
  assert.notEqual(fabricationGearSpecForPitchRadius((rejectedG1Output.rockerLength ?? 0) / SCENE_PX_PER_MM).key, 'g8', 'gear-linkage rejects G1 as an output gear because it has no attachment holes');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'gear_linkage')).forEach(config => {
    assert(config.gearTrainRadii?.every(gearSceneRadiusIsFabricationPreset), 'optimizer generates gear-linkage gear sizes from the fabrication gear preset set');
    assert(config.groundLength >= gearTrainPitchCenterDistance(config), 'optimizer keeps gear-linkage endpoint gear axles non-overlapping');
    assert.equal(config.groundLength, gearTrainResolvedCenterDistance(config), 'optimizer derives gear-linkage center span from the resolved gear train contract');
    assert(linkageSceneLengthIsFabricationPreset(config.couplerLength), 'optimizer generates gear-linkage paired linkage from fabricated linkage sizes');
  });
  const mutatedGearLinkage = mutateConfig(compoundGearLinkage, 1, true);
  assert(mutatedGearLinkage.gearTrainRadii?.every(gearSceneRadiusIsFabricationPreset), 'optimizer mutates gear-linkage back onto fabrication gear sizes without erasing idlers by contract');
  assert.equal(mutatedGearLinkage.groundLength, gearTrainResolvedCenterDistance(mutatedGearLinkage), 'optimizer mutation derives the gear-linkage center span from the endpoint/idler contract');
  assert(linkageSceneLengthIsFabricationPreset(mutatedGearLinkage.couplerLength), 'optimizer mutation preserves a fabricated paired linkage size');
  assert.deepEqual(
    fabricationStackForMechanism(mechanism).filter(layer => ['gear', 'linkage', 'guide'].includes(layer.role)).map(layer => layer.label),
    ['Drive G3 / 3-space gear', 'Output G3 / 3-space gear', 'Drive L4 linkage', 'Output L4 linkage'],
    'gear-linkage fabrication stack exposes G3→G3→two L4 links in mechanism-reference order without a bracket'
  );
}

{
  const mechanism = createDefaultMechanism('planetary_gear', 'contract-planetary-physical');
  assert.equal(sizingPlanetCount, PLANETARY_GEAR_PLANET_COUNT, 'fabricationSizing preserves public planetary planet count behind the fabrication facade');
  assert.equal(PLANETARY_GEAR_PLANET_COUNT, 1, 'planetary gear recipe is intentionally fixed to one fabricated planet until multi-planet carriers exist');
  assert.deepEqual(sizingPlanetaryPlanetCenters({ x: 0, y: 0 }, mechanism, Math.PI / 4), planetaryPlanetCenters({ x: 0, y: 0 }, mechanism, Math.PI / 4), 'fabricationSizing preserves public planetary center sampling behind the fabrication facade');
  assert.deepEqual(sizingPlanetaryGearConventionForMechanism(mechanism), planetaryGearConventionForMechanism(mechanism), 'fabricationSizing preserves public planetary convention behind the fabrication facade');
  assert.equal(planetaryPlanetCenters({ x: 0, y: 0 }, mechanism, 0).length, 1, 'planetary planet center helper matches the single-planet fabrication recipe');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid && state.aux, 'planetary gear default has valid carrier samples');
    assertDistance(state.p1, state.p2, selectedPhysicalLength(mechanism, 'planetary_gear.carrier-planet-pivot'), 'planetary carrier pivot comes from its selected L4 hole');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'planet gear radius is preserved');
    assertDistance(state.p1, state.effector, selectedPhysicalLength(mechanism, 'planetary_gear.carrier-output-hole'), 'planetary carrier output comes from its selected L4 hole');
  });
  assert.equal(mechanism.gearRatio, planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength), 'planetary gear ratio is ring-fixed sun-input carrier-output');
  const normalizedPlanetary = normalizeMechanismToReference({
    ...mechanism,
    id: 'contract-planetary-stale-ratio',
    crankLength: 999,
    rockerLength: 777,
    gearRatio: 9,
    speed2: 9
  });
  assert.equal(normalizedPlanetary.gearRatio, planetaryCarrierOutputRatio(normalizedPlanetary.crankLength, normalizedPlanetary.rockerLength), 'planetary reference normalization recomputes carrier output ratio after restoring fixed kit radii');
  assert.equal(normalizedPlanetary.speed2, planetaryPlanetSpinRatio(normalizedPlanetary.crankLength, normalizedPlanetary.rockerLength), 'planetary reference normalization recomputes planet spin ratio instead of preserving stale snapshot values');
  assert.equal(planetaryRingPitchRadius(mechanism.crankLength, mechanism.rockerLength), mechanism.crankLength + 2 * mechanism.rockerLength, 'planetary ring pitch radius follows sun plus two planets');
  assert.equal(planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength), planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength) - (mechanism.crankLength / mechanism.rockerLength) * (1 - planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength)), 'planet spin is derived from ring-fixed carrier motion');
  const fullCarrierInput = foundryPlaybackPhaseToInputAngle(mechanism, Math.PI * 2);
  const carrierStart = calculateLinkage(mechanism, 0);
  const carrierFullCycle = calculateLinkage(mechanism, fullCarrierInput);
  assert(Math.abs(fullCarrierInput - (Math.PI * 2) / planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength)) < 1e-9, 'planetary Foundry playback maps one visible carrier cycle to the required sun input rotations');
  assert(Math.hypot(carrierFullCycle.p2.x - carrierStart.p2.x, carrierFullCycle.p2.y - carrierStart.p2.y) < 1e-6, 'planetary carrier returns to the start after one Foundry playback cycle');
  assert(Math.abs(fullCarrierInput * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength)) > Math.PI * 2, 'planet gear visibly spins while the carrier completes one full output cycle');
  const halfCarrierFrame = createFoundryPlaybackFrame(mechanism, Math.PI, createMechanismFitContext(mechanism, 180, 96, 96));
  const halfCarrierInput = halfCarrierFrame.inputAngleRad;
  const halfCarrierPreview = renderToString(createElement(MechanismLinkagePreview, { mechanism, simulation: halfCarrierFrame.simulation, kit: sample.settings.physicalKit, testId: 'contract-planetary-preview', compact: true }));
  assert(halfCarrierPreview.includes('rotate(1440'), 'Foundry planetary SVG preview renders sun rotation from raw multi-turn input angle');
  assert(/rotate\(-239\.999|rotate\(-240/.test(halfCarrierPreview), 'Foundry planetary SVG preview renders planet spin from the ring-fixed mesh ratio, not from wrapped geometry');
  const offsetMechanism = { ...mechanism, speed1: 2, driverPhaseOffset: Math.PI / 3 };
  const offsetFitContext = createMechanismFitContext(offsetMechanism, 180, 96, 96);
  const offsetCarrierFrame = createFoundryPlaybackFrame(offsetMechanism, Math.PI, offsetFitContext);
  const offsetCarrierInput = offsetCarrierFrame.inputAngleRad;
  const offsetCarrierState = calculateLinkage(offsetMechanism, offsetCarrierInput);
  const offsetCarrierPreview = renderToString(createElement(MechanismLinkagePreview, { mechanism: offsetMechanism, simulation: offsetCarrierFrame.simulation, kit: sample.settings.physicalKit, testId: 'contract-planetary-offset-preview', compact: true }));
  assert(Math.hypot(offsetCarrierState.p2.x - (offsetMechanism.anchorX ?? 0) + offsetMechanism.groundLength, offsetCarrierState.p2.y - (offsetMechanism.anchorY ?? 0)) < 1e-6, 'planetary Foundry playback frame inverts speed and driver phase before sampling carrier output');
  assert(Math.abs(offsetCarrierFrame.simulation.driveAngleDeg - 1440) < 1e-9, 'planetary preview simulation exposes the driven sun angle after speed and phase are applied');
  assert(offsetCarrierPreview.includes('rotate(1440'), 'offset planetary SVG preview renders sun rotation from driven angle, not raw solver input');
  assert(/rotate\(-239\.999|rotate\(-240/.test(offsetCarrierPreview), 'offset planetary SVG preview renders planet spin from the driven sun angle');
  const offsetPlaybackOutputTrace = generateFoundryPlaybackPointTraces(offsetMechanism, 96).traces.find(trace => trace.id === 'C');
  assert(offsetPlaybackOutputTrace, 'Foundry planetary playback traces include the selected carrier output path');
  const offsetGeneratedPathMechanism = mechanismWithGeneratedPath(offsetMechanism);
  const offsetGeneratedPath = offsetGeneratedPathMechanism.generatedPath ?? [];
  assert.equal(offsetGeneratedPath.length, offsetPlaybackOutputTrace.points.length, 'planetary generatedPath stores the selected Foundry carrier output trace length');
  const offsetTraceHalfIndex = Math.floor(offsetPlaybackOutputTrace.points.length / 2);
  const offsetTraceHalfPoint = offsetPlaybackOutputTrace.points[offsetTraceHalfIndex];
  assert(Math.hypot(offsetTraceHalfPoint.x - offsetCarrierState.effector.x, offsetTraceHalfPoint.y - offsetCarrierState.effector.y) < 1e-6, 'Foundry planetary traces sample the playback-mapped selected carrier output used by the renderer');
  assert(Math.hypot(offsetGeneratedPath[offsetTraceHalfIndex].x - offsetTraceHalfPoint.x, offsetGeneratedPath[offsetTraceHalfIndex].y - offsetTraceHalfPoint.y) < 1e-6, 'planetary generatedPath is sourced from the selected physical carrier output path, not the planet pivot or raw sun-input sampling');
  const mappedOffsetOutputTrace = offsetPlaybackOutputTrace.points.map(offsetFitContext.map);
  assert(Math.hypot(mappedOffsetOutputTrace[offsetTraceHalfIndex].x - offsetCarrierFrame.simulation.state.effector.x, mappedOffsetOutputTrace[offsetTraceHalfIndex].y - offsetCarrierFrame.simulation.state.effector.y) < 1e-6, 'Foundry planetary renderer state and visible trace share the selected carrier output effector');
  const offsetOverlay = buildFoundryPhysicsOverlay(offsetMechanism, { ...offsetCarrierFrame.simulation, pathPoints: mappedOffsetOutputTrace }, offsetCarrierFrame.playbackPhaseRad, sample.settings, mappedOffsetOutputTrace);
  const wrappedOffsetTracePoint = (index: number) => mappedOffsetOutputTrace[((index % mappedOffsetOutputTrace.length) + mappedOffsetOutputTrace.length) % mappedOffsetOutputTrace.length];
  const expectedOverlayDelta = {
    x: wrappedOffsetTracePoint(offsetTraceHalfIndex + 1).x - wrappedOffsetTracePoint(offsetTraceHalfIndex - 1).x,
    y: wrappedOffsetTracePoint(offsetTraceHalfIndex + 1).y - wrappedOffsetTracePoint(offsetTraceHalfIndex - 1).y
  };
  assert.equal(offsetOverlay.playIndex, offsetTraceHalfIndex, 'Foundry planetary overlay indexes the visible carrier cycle, not raw sun-input cycles');
  assert((offsetOverlay.velocityRaw.x * expectedOverlayDelta.x + offsetOverlay.velocityRaw.y * expectedOverlayDelta.y) > 0, 'Foundry planetary overlay velocity follows the playback-mapped carrier output trace');
  const offsetFoundryWorkflow = renderToString(createElement(FoundryWorkflowPanel, {
    project: sample,
    goStage: () => undefined,
    foundry: offsetMechanism,
    foundryPhase: Math.PI,
    targetReady: true,
    isPickingAnchor: false,
    hardBlocked: false,
    onToggleAnchorPick: () => undefined,
    onFitPath: () => undefined,
    onUseMechanism: () => undefined,
    onSelectMechanismType: () => undefined
  }));
  const expectedMiniCardPathD = pointsToSvgPath(mappedOffsetOutputTrace);
  assert(offsetFoundryWorkflow.includes(`d="${expectedMiniCardPathD}"`), 'Foundry planetary template card path silhouette uses the same playback-mapped carrier output trace as the main preview');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'planetary_gear')).forEach(config => {
    assert(Math.abs(config.groundLength - (config.crankLength + config.rockerLength)) < 1e-6, 'optimizer keeps generated planetary pitch circles tangent');
  });
  assert.deepEqual(requiredPartQuantities('planetary_gear'), { 'Paper fastener': 6, 'G1 / 1-space gear': 1, 'Spacer 10mm OD / 4mm hole': 4, 'R56 internal ring gear': 1, '5-hole link': 1, 'G3 / 3-space gear': 1 }, 'planetary required parts come from the graph compiler recipe');
  assert.deepEqual(
    referenceRecipeForType('planetary_gear').stackLabels,
    ['R56 internal ring gear', 'G1 / 1-space gear', 'L4 carrier linkage', 'G3 / 3-space gear'],
    'planetary reference stack distinguishes the fixed ring, rotating sun, separate carrier, and moving planet'
  );
}

const gearDefault = createDefaultMechanism('gear', 'contract-gear-endpoints');
const gearStart = calculateLinkage(gearDefault, 0);
const gearQuarter = calculateLinkage(gearDefault, Math.PI / 2);
assert(Math.abs(Math.hypot(gearStart.p2.x - gearStart.p1.x, gearStart.p2.y - gearStart.p1.y) - gearTrainPitchCenterDistance(gearDefault)) < 1e-9, 'gear template defaults mesh endpoint gear axles');
assert(gearQuarter.j1.y > gearStart.j1.y, 'gear train input handle rotates from the drive axle');
assert(Math.hypot(gearQuarter.j2.x - gearStart.j2.x, gearQuarter.j2.y - gearStart.j2.y) > 1, 'direct gear output counter-rotates without idlers');
const endpointG3 = gearSceneRadiusByKey('g24');
const idlerG1 = gearSceneRadiusByKey('g8');
const idlerGear = normalizeGearTrainToFabrication({ ...gearDefault, gearTrainRadii: [endpointG3, idlerG1, endpointG3], groundLength: gearDefault.groundLength * 3 });
const idlerGearStart = calculateLinkage(idlerGear, 0);
const idlerGearQuarter = calculateLinkage(idlerGear, Math.PI / 2);
assert(Math.hypot(idlerGearQuarter.j2.x - idlerGearStart.j2.x, idlerGearQuarter.j2.y - idlerGearStart.j2.y) > 1, 'inserted idler chain couples endpoint gear rotation');
const touchingLegacyGear = calculateLinkage({ ...gearDefault, groundLength: gearTrainPitchCenterDistance(gearDefault) }, 0);
assertDistance(touchingLegacyGear.p1, touchingLegacyGear.p2, gearTrainPitchCenterDistance(gearDefault), 'legacy two-gear pitch-contact configs remain direct mesh');
let exportedProject = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
assert(exportedProject.lastExport, 'set_export stores generated fabrication package');
exportedProject = applyProjectAction(exportedProject, { type: 'upsert_mechanism', mechanism: { ...exportedProject.mechanisms[0], enabled: false } });
assert.equal(exportedProject.lastExport, undefined, 'mechanism changes invalidate stale fabrication package download');
const addedPart = applyProjectAction(sample, { type: 'upsert_part', part: { ...sample.parts.head, id: 'head-copy', name: 'Head copy', zIndex: 99 } });
assert(addedPart.parts['head-copy'], 'path editor can add visual layers through state');
const removedPartProject = applyProjectAction({ ...addedPart, paths: { ...addedPart.paths, 'path-head-copy': { ...addedPart.paths['path-right-arm'], id: 'path-head-copy', partId: 'head-copy' } } }, { type: 'delete_part', partId: 'head-copy' });
assert(!removedPartProject.parts['head-copy'] && !removedPartProject.paths['path-head-copy'], 'deleting a visual layer removes its paths');
const sceneObject: SceneObject = {
  ...createDefaultSceneObject('piggy-bank', 'object-piggy'),
  name: 'Class trophy',
  textureUrl: 'data:image/png;base64,trophy',
  contourPoints: [{ x: -20, y: -30 }, { x: 22, y: -24 }, { x: 18, y: 28 }, { x: -24, y: 20 }],
  contourSource: 'imported',
  sourceImageName: 'trophy.png'
};
const addedSceneObject = applyProjectAction(sample, { type: 'upsert_scene_object', object: sceneObject });
assert(addedSceneObject.sceneObjects['object-piggy'], 'Character tab can add a separate scene object through ProjectState');
assert.equal(addedSceneObject.selectedSceneObjectId, 'object-piggy', 'adding a scene object selects the scene object inspector');
assert.equal(addedSceneObject.selectedPartId, undefined, 'selecting a scene object clears body-part selection');
const movedSceneObject = applyProjectAction(addedSceneObject, { type: 'update_scene_object', objectId: 'object-piggy', updates: { transform: { ...sceneObject.transform, x: 144 }, bounds: { width: 120, height: 72 } } });
assert.equal(movedSceneObject.sceneObjects['object-piggy'].transform.x, 144, 'scene object transform edits stay serializable');
const roundTripSceneObject = loadProjectSnapshot(JSON.parse(serializeProject(movedSceneObject)));
assert.equal(roundTripSceneObject.sceneObjects['object-piggy'].shape, 'piggy-bank', 'scene object snapshots round-trip through persistence');
assert.equal(roundTripSceneObject.sceneObjects['object-piggy'].textureUrl, 'data:image/png;base64,trophy', 'image scene object snapshots preserve browser-local texture data');
assert.deepEqual(roundTripSceneObject.sceneObjects['object-piggy'].contourPoints, sceneObject.contourPoints, 'image scene object snapshots preserve imported contour points');
assert.equal(roundTripSceneObject.sceneObjects['object-piggy'].sourceImageName, 'trophy.png', 'image scene object snapshots preserve source image name');
const svgTextureSceneObject = loadProjectSnapshot({
  ...JSON.parse(serializeProject(movedSceneObject)),
  sceneObjects: {
    'object-piggy': {
      ...sceneObject,
      textureUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      contourPoints: sceneObject.contourPoints
    }
  },
  sceneObjectOrder: ['object-piggy']
});
assert.equal(svgTextureSceneObject.sceneObjects['object-piggy'].textureUrl, undefined, 'scene object snapshots reject raw SVG texture payloads and keep only safe raster data URLs');
const objectOwnedPathProject = applyProjectAction(roundTripSceneObject, {
  type: 'upsert_path',
  path: {
    id: 'path-object-piggy',
    partId: '',
    sceneObjectId: 'object-piggy',
    points: [{ x: 80, y: 90 }, { x: 120, y: 110 }, { x: 160, y: 90 }],
    duration: 1000,
    closed: true,
    enabled: true,
    visible: true,
    source: 'drawn',
    warnings: []
  }
});
assert.equal(objectOwnedPathProject.paths['path-object-piggy'].sceneObjectId, 'object-piggy', 'scene objects can own editable motion paths');
assert.equal(objectOwnedPathProject.paths['path-object-piggy'].partId, '', 'scene-object paths do not pretend to belong to a body part');
assert.equal(objectOwnedPathProject.selectedPathId, 'path-object-piggy', 'upserting an object path selects that path');
const objectPathPreview = motionPreviewForPath(objectOwnedPathProject, objectOwnedPathProject.paths['path-object-piggy'], 0);
assert.equal(objectPathPreview.sceneObjects?.['object-piggy'].transform.x, 80, 'object-owned path preview moves the scene object to the path target');
assert.equal(objectPathPreview.sceneObjects?.['object-piggy'].transform.y, 90, 'object-owned path preview moves the scene object y position');
const objectPathMechanismProject = applyProjectAction({ ...objectOwnedPathProject, mechanisms: [], selectedMechanismId: undefined }, {
  type: 'upsert_mechanism',
  mechanism: {
    ...createDefaultMechanism('4bar', 'object-path-driver'),
    targetPartId: undefined,
    targetSceneObjectId: 'object-piggy',
    targetPathId: 'path-object-piggy',
    targetAnchorJointId: undefined,
    anchorX: -120,
    anchorY: -40,
    transform: { x: -120, y: -40, rotation: 0, scale: 1 },
    sceneAnchor: { x: -120, y: -40 }
  }
});
const objectPathMechanism = objectPathMechanismProject.mechanisms.find(m => m.id === 'object-path-driver')!;
assert.equal(objectPathMechanism.targetSceneObjectId, 'object-piggy', 'mechanism target resolves to the scene object when its path is object-owned');
assert.equal(objectPathMechanism.targetPartId, undefined, 'object-target mechanisms clear stale body-part targets');
assert.equal(objectPathMechanism.targetAnchorJointId, undefined, 'object-target mechanisms do not keep stale skeleton handles');
assert.deepEqual(mechanismBindingWarnings(objectPathMechanismProject, [objectPathMechanism]), {}, 'object-target mechanism accepts a matching object-owned path');
const objectPathRecommendations = buildMechanismRecommendations({ ...objectOwnedPathProject, mechanisms: [], selectedMechanismId: undefined }, undefined, objectOwnedPathProject.paths['path-object-piggy']);
assert(objectPathRecommendations.length > 0, 'mechanism recommendations support object-owned paths without a selected body part');
const objectPathRecommendationAnchor = {
  x: objectPathRecommendations[0].mechanism.anchorX ?? Number.NaN,
  y: objectPathRecommendations[0].mechanism.anchorY ?? Number.NaN
};
const objectPathRecommendationBoard = sceneToBoardRaw(objectPathRecommendationAnchor, objectOwnedPathProject.settings.physicalKit);
const objectPathRecommendationSnap = boardToScene(objectPathRecommendationBoard.col, objectPathRecommendationBoard.row, objectOwnedPathProject.settings.physicalKit);
assert(objectPathRecommendationBoard.valid && /^[A-O]([1-9]|1[0-5])$/.test(objectPathRecommendationBoard.label), 'object-path mechanism recommendations fit to a valid 15x15 fabrication-board hole');
assert(Math.hypot(objectPathRecommendationSnap.x - objectPathRecommendationAnchor.x, objectPathRecommendationSnap.y - objectPathRecommendationAnchor.y) < 1e-9, 'object-path fitted mechanisms store hole-snapped anchors for board-ready assembly');
const objectGeneratedPathSentinel = [{ x: 777, y: 888 }, { x: 779, y: 886 }, { x: 775, y: 884 }];
const objectPathSentinelProject: ProjectState = {
  ...objectPathMechanismProject,
  mechanisms: objectPathMechanismProject.mechanisms.map(m =>
    m.id === 'object-path-driver'
      ? { ...m, foundryExport: undefined, generatedPath: objectGeneratedPathSentinel }
      : m
  )
};
const deletedObjectPathProject = applyProjectAction(objectPathMechanismProject, { type: 'delete_scene_object', objectId: 'object-piggy' });
assert(!deletedObjectPathProject.paths['path-object-piggy'], 'deleting a scene object removes its owned paths');
assert.equal(deletedObjectPathProject.mechanisms.find(m => m.id === 'object-path-driver')?.targetSceneObjectId, 'object-piggy', 'deleting a scene object preserves the authored object reference for diagnosis');
assert.equal(deletedObjectPathProject.mechanisms.find(m => m.id === 'object-path-driver')?.targetPathId, 'path-object-piggy', 'deleting a scene object preserves the authored path reference for diagnosis');
const deletedObjectPathSentinelProject = applyProjectAction(objectPathSentinelProject, { type: 'delete_scene_object', objectId: 'object-piggy' });
assert.equal(deletedObjectPathSentinelProject.mechanisms.find(m => m.id === 'object-path-driver')?.generatedPath, undefined, 'deleting an object target clears stale fitted path artifacts');
const objectPathMetadataProject = applyProjectAction(objectPathSentinelProject, {
  type: 'upsert_path',
  path: { ...objectPathSentinelProject.paths['path-object-piggy'], visible: false }
});
assert.deepEqual(objectPathMetadataProject.mechanisms.find(m => m.id === 'object-path-driver')?.generatedPath, objectGeneratedPathSentinel, 'metadata-only object-path edits preserve fitted generatedPath samples');
const objectPathGeometryProject = applyProjectAction(objectPathSentinelProject, {
  type: 'upsert_path',
  path: {
    ...objectPathSentinelProject.paths['path-object-piggy'],
    points: objectPathSentinelProject.paths['path-object-piggy'].points.map(point => ({ x: point.x + 500, y: point.y })),
  }
});
assert.equal(objectPathGeometryProject.mechanisms.find(m => m.id === 'object-path-driver')?.generatedPath, undefined, 'object-path geometry edits invalidate stale fitted generatedPath samples');
const deletedSceneObject = applyProjectAction(roundTripSceneObject, { type: 'delete_scene_object', objectId: 'object-piggy' });
assert(!deletedSceneObject.sceneObjects['object-piggy'], 'scene object delete removes the prop without touching character parts');
const deletedPathProject = applyProjectAction(sample, { type: 'delete_path', pathId: 'path-right-arm' });
assert(!deletedPathProject.paths['path-right-arm'], 'path editor delete removes path data instead of leaving an empty path');
assert.equal(deletedPathProject.mechanisms[0].targetPathId, 'path-right-arm', 'deleting a path preserves the authored targetPathId for diagnosis');
const partPathSentinelProject = { ...sample, mechanisms: [{ ...sample.mechanisms[0], generatedPath: objectGeneratedPathSentinel }] };
assert.equal(applyProjectAction(partPathSentinelProject, { type: 'delete_path', pathId: 'path-right-arm' }).mechanisms[0].generatedPath, undefined, 'deleting a part path clears stale fitted path artifacts');
assert.deepEqual(
  applyProjectAction(partPathSentinelProject, { type: 'upsert_path', path: { ...partPathSentinelProject.paths['path-right-arm'], visible: false } }).mechanisms[0].generatedPath,
  objectGeneratedPathSentinel,
  'metadata-only part-path edits preserve fitted generatedPath samples'
);
assert.equal(
  applyProjectAction(partPathSentinelProject, { type: 'upsert_path', path: { ...partPathSentinelProject.paths['path-right-arm'], points: partPathSentinelProject.paths['path-right-arm'].points.map(point => ({ x: point.x + 500, y: point.y })) } }).mechanisms[0].generatedPath,
  undefined,
  'part-path geometry edits invalidate stale fitted generatedPath samples'
);
assert.equal(sample.settings.timingProfile, 'linear', 'options include a persisted timing profile');
assert.equal(sample.settings.theme, 'light', 'settings default to the light novice UI theme');
assert.equal(sample.settings.uiTextScale, 'normal', 'settings default to normal UI text size');
assert.equal(sample.settings.performancePreset, 'balanced', 'settings default includes performance preset');
assert.equal(sample.settings.physicsSnapMode, 'balanced', 'settings default includes physics snap mode');
assert.equal(sample.settings.simulationFriction, 0.18, 'settings default includes physical friction coefficient');
assert.equal(sample.settings.simulationMassKg, 1, 'settings default includes mechanism mass');
assert.equal(sample.settings.toolbarVisible, false, 'settings default hides duplicate quick toolbar chrome');
assert.equal(sample.settings.debugVisuals, false, 'settings default hides debug visuals');
assert.equal(sample.settings.detailedProcessingSteps, false, 'settings default hides detailed processing steps');
assert.equal(sample.settings.autosave, true, 'settings default keeps browser autosave on for classroom reload recovery');
assert.equal(sample.settings.autosaveIntervalSeconds, 60, 'settings default includes autosave interval seconds');
assert.equal(sample.settings.fabricationReadyMode, true, 'settings default keeps fabrication validation strict');
assert.equal(sample.settings.gridUnit, 'cm', 'settings default labels grid in centimeters');
assert.equal(formatGridPitch(20, 'cm'), '2cm', 'grid pitch formatter keeps compact cm labels');
assert.equal(formatGridLabel({ gridPitchMm: 25 }, 'inch'), 'Letter sheet · 0.98 in grid', 'grid label formatter applies inch units across canvases');
assert.equal(formatGridReadout({ gridPitchMm: 20 }, 'px'), '40 scene px between board holes', 'grid readout formatter applies scene-pixel units');
assert.equal(sample.settings.physicalKit.exportMode, 'both', 'physical kit default exposes both custom parts and prefab board kit workflows');
assert.equal(sample.settings.physicalKit.cutSheetFileType, 'pdf', 'physical kit default is PDF-first for cut sheets');
assert.equal(animationDeltaRadians(1600, 3200, 1, 'linear'), Math.PI, 'linear animation duration drives playback phase');
assert.equal(animationDeltaRadians(1600, 3200, 1, 'realtime'), Math.PI, 'animation duration drives playback phase');
assert.equal(animationDeltaRadians(1600, 6400, 1, 'realtime'), Math.PI / 2, 'longer duration slows playback phase');
const linearQuarter = animationDeltaRadians(800, 3200, 1, 'linear', 0);
assert(Math.abs(linearQuarter - Math.PI / 2) < 1e-9, 'linear timing advances a quarter cycle after a quarter duration');
assert(animationDeltaRadians(800, 3200, 1, 'ease-in', 0) < linearQuarter, 'ease-in starts slower than linear');
assert(animationDeltaRadians(800, 3200, 1, 'ease-out', 0) > linearQuarter, 'ease-out starts faster than linear');
assert(animationDeltaRadians(800, 3200, 1, 'ease-in-out', 0) < linearQuarter, 'ease-in-out starts with a real eased phase');
const legacySettingsProject = loadProjectSnapshot({
  ...sample,
  settings: {
    animationSpeed: 1,
    animationDurationMs: 3200,
    timingProfile: 'realtime',
    theme: 'blueprint',
    toolbarVisible: true,
    partPanelVisible: true,
    autosave: false,
    physicalKit: { ...sample.settings.physicalKit, cutSheetFileType: undefined }
  }
});
assert.equal(legacySettingsProject.settings.performancePreset, 'balanced', 'legacy snapshots receive M3 performance default');
assert.equal(legacySettingsProject.settings.simulationFriction, 0.18, 'legacy snapshots receive simulation friction default');
assert.equal(legacySettingsProject.settings.simulationMassKg, 1, 'legacy snapshots receive simulation mass default');
assert.equal(legacySettingsProject.settings.uiTextScale, 'normal', 'legacy snapshots receive normal UI text size default');
assert.equal(legacySettingsProject.settings.autosaveIntervalSeconds, 60, 'legacy snapshots receive M3 autosave interval default');
assert.equal(legacySettingsProject.settings.physicalKit.exportMode, 'both', 'legacy physical kit receives both-workflows default');
assert.equal(legacySettingsProject.settings.physicalKit.cutSheetFileType, 'pdf', 'legacy physical kit receives cut-sheet default');
const optionsRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject({
  ...sample,
  settings: {
    ...sample.settings,
    performancePreset: 'high',
    physicsSnapMode: 'fast',
    simulationFriction: 0.42,
    simulationMassKg: 1.75,
    debugVisuals: true,
    detailedProcessingSteps: true,
    uiTextScale: 'large',
    autosave: true,
    autosaveIntervalSeconds: 3,
    gridUnit: 'inch',
    fabricationReadyMode: false,
    physicalKit: { ...sample.settings.physicalKit, exportMode: 'prefab-board', cutSheetFileType: 'svg' }
  }
})));
assert.equal(optionsRoundTrip.settings.performancePreset, 'high', 'M3 performance setting serializes and reloads');
assert.equal(optionsRoundTrip.settings.physicsSnapMode, 'fast', 'physics snap mode round-trips');
assert.equal(optionsRoundTrip.settings.simulationFriction, 0.42, 'simulation friction round-trips');
assert.equal(optionsRoundTrip.settings.simulationMassKg, 1.75, 'simulation mass round-trips');
assert.equal(optionsRoundTrip.settings.debugVisuals, true, 'debug visuals round-trip');
assert.equal(optionsRoundTrip.settings.detailedProcessingSteps, true, 'detailed processing setting round-trips');
assert.equal(optionsRoundTrip.settings.uiTextScale, 'large', 'UI text scale setting round-trips');
assert.equal(optionsRoundTrip.settings.autosaveIntervalSeconds, 3, 'autosave interval round-trips');
assert.equal(optionsRoundTrip.settings.gridUnit, 'inch', 'grid unit setting round-trips');
assert.equal(optionsRoundTrip.settings.fabricationReadyMode, false, 'fabrication-ready mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.exportMode, 'prefab-board', 'blueprint export workflow mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.cutSheetFileType, 'svg', 'cut-sheet file type round-trips');
assert(sample.characterPackage?.partsInfo && sample.characterPackage.charCfg, 'sample project carries character package review artifacts');
const detachedMechanismProject = { ...sample, mechanisms: [createDefaultMechanism('4bar', 'detached')] };
assert.deepEqual(mechanismBindingWarnings(detachedMechanismProject).detached, ['Fix: Choose anchor'], 'Design uses the authoritative binding recovery action for a detached mechanism');
assert.deepEqual(validateForFabrication(detachedMechanismProject).errors, ['Fix: Choose anchor'], 'fabrication blocks detached visible mechanisms with the same authoritative recovery action');
const noEnabledMechanismProject = { ...sample, mechanisms: sample.mechanisms.map(m => ({ ...m, enabled: false })) };
assert(validateForFabrication(noEnabledMechanismProject).errors.includes('No active mechanism'), 'fabrication blocks zero-recipe blueprint packages through shared readiness');
assert.throws(() => createFabricationPackage(noEnabledMechanismProject), /No active mechanism/, 'fabrication package refuses zero-recipe output');
const impossibleMechanismProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'impossible'), anchorX: -80, anchorY: -80, groundLength: 10, crankLength: 10, couplerLength: 10, rockerLength: 1000 }] };
assert(validateForFabrication(impossibleMechanismProject).errors.includes('Fix mechanism geometry.'), 'fabrication blocks mechanisms with invalid motion geometry through shared readiness');
const offGridProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'off-grid'), anchorX: -70, anchorY: -80 }] };
assert(validateForFabrication(offGridProject).errors.includes('No board-snapped graph anchor'), 'fabrication blocks off-grid anchors instead of rounding silently');
assert(!validateForFabrication(offGridProject).errors.some(e => e.includes('path outside sheet')), 'fabrication reports the snap-to-hole problem before derived path footprint problems for off-grid anchors');
const simulationOnlyOffGridProject = { ...offGridProject, settings: { ...sample.settings, fabricationReadyMode: false } };
assert(validateForFabrication(simulationOnlyOffGridProject).errors.includes('Fix mechanism setup.'), 'fabrication validation remains a strict novice-safe blocker because simulation-only intent is handled by the nonserialized Foundry transaction');
const camWrongBoardProject = {
  ...sample,
  settings: { ...sample.settings, physicalKit: physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit) },
  mechanisms: [boundMechanism('cam', 'cam-wrong-board')]
};
assert(!validateForFabrication(camWrongBoardProject).errors.some(e => e.includes('cam module needs 15x15 board')), 'fabrication relies on graph compiler board geometry instead of a stale fixed 15x15 cam gate');
const edgeCamAnchor = boardToScene(14, 14, sample.settings.physicalKit);
const edgeCamProject = { ...sample, mechanisms: [{ ...boundMechanism('cam', 'cam-edge'), anchorX: edgeCamAnchor.x, anchorY: edgeCamAnchor.y }] };
assert(validateForFabrication(edgeCamProject).errors.includes('Fit inside board.'), 'fabrication blocks cam modules whose translated guide/axle holes leave the 15x15 board');
assert.throws(() => createFabricationPackage(edgeCamProject), /Fit inside board\./, 'fabrication package refuses cam modules with off-board translated assembly holes');
const recipeWithPath = createFabricationPackage(createSampleProject({ includeMechanism: true })).recipes[0];
assert.equal(recipeWithPath.targetPathId, 'path-right-arm', 'fabrication recipe preserves target path metadata');
const objectRecipePackage = createFabricationPackage(objectPathMechanismProject);
const objectPathMechanismWithOffsheetStoredTrace = {
  ...objectPathMechanismProject,
  mechanisms: objectPathMechanismProject.mechanisms.map(mechanism => mechanism.id === 'object-path-driver'
    ? { ...mechanism, generatedPath: [{ x: 9999, y: 9999 }, { x: 10020, y: 9980 }] }
    : mechanism)
};
assert.doesNotThrow(() => createFabricationPackage(objectPathMechanismWithOffsheetStoredTrace), 'fabrication validation ignores stored visual generatedPath when checking the physical mechanism sheet footprint');
const objectRecipe = objectRecipePackage.recipes.find(recipe => recipe.mechanismId === 'object-path-driver')!;
assert.equal(objectRecipe.targetSceneObjectId, 'object-piggy', 'fabrication recipe preserves target scene object id');
assert.equal(objectRecipe.targetSceneObjectName, 'Class trophy', 'fabrication recipe preserves target scene object name');
assert.equal(objectRecipe.targetPathId, 'path-object-piggy', 'fabrication recipe preserves object-owned target path id');
assert.equal(objectRecipe.targetPathPointCount, 3, 'fabrication recipe counts object-owned path points');
assert(objectRecipePackage.sceneSnapshot.sceneObjects['object-piggy'], 'fabrication package snapshot includes scene objects');
assert.equal(objectRecipePackage.sceneSnapshot.paths['path-object-piggy'].sceneObjectId, 'object-piggy', 'fabrication package snapshot preserves object path ownership');
assert(objectRecipePackage.assemblyGuideHtml.includes('<strong>Target:</strong> Class trophy') && objectRecipePackage.assemblyGuideHtml.includes('path-object-piggy'), 'object-target assembly guide HTML keeps compact target/path details');
assert(objectRecipePackage.assemblyGuidePdf.includes('Target: Class trophy') && objectRecipePackage.assemblyGuidePdf.includes('path-object-piggy'), 'object-target assembly guide PDF keeps offline target/path details');
const objectAssemblyGuideModel = buildAssemblyGuideModel({ project: objectPathMechanismProject, selectedRecipeId: 'object-path-driver', assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(objectAssemblyGuideModel.selectedRecipe?.targetSceneObjectId, 'object-piggy', 'Assembly guide model keeps the selected object-target recipe id');
assert.equal(objectAssemblyGuideModel.selectedRecipe?.targetSceneObjectName, 'Class trophy', 'Assembly guide model keeps the selected object-target display name');
assert(recipeWithPath.sceneAnchor && 'x' in recipeWithPath.sceneAnchor, 'fabrication recipe includes explicit scene anchor');
const sampleAssemblyGuideHtml = createFabricationPackage(sample).assemblyGuideHtml;
assert(sampleAssemblyGuideHtml.includes('assembly guide'), 'fabrication package includes printable assembly guide');
assert(sampleAssemblyGuideHtml.includes('<strong>Board:</strong>'), 'assembly guide labels the mechanism board explicitly');
assert(!sampleAssemblyGuideHtml.includes('Board coordinate:'), 'assembly guide does not label moving-reference callouts as board coordinates');
assert(sampleAssemblyGuideHtml.includes('graph reference') || sampleAssemblyGuideHtml.includes('link joint reference') || sampleAssemblyGuideHtml.includes('gear handle reference') || sampleAssemblyGuideHtml.includes('carrier reference'), 'assembly guide surfaces moving-reference coord roles instead of board-only labels');
const warningPackage = createFabricationPackage({
  ...sample,
  mechanisms: [{ ...sample.mechanisms[0], warnings: ['project warning should appear in guide'] }]
});
assert(warningPackage.recipes[0].warnings.includes('project warning should appear in guide'), 'fabrication recipe preserves mechanism warnings');
assert(warningPackage.assemblyGuideHtml.includes('project warning should appear in guide'), 'assembly guide preserves mechanism warnings');
const boardCircles = [...pkg.svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="(?:2|5)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
assert.equal(boardCircles.length, sample.settings.physicalKit.boardCells ** 2, 'fabrication SVG renders one board hole per cell');
assert(Math.abs(boardCircles[0].x - sceneToSvg(boardToScene(0, 0, sample.settings.physicalKit)).x) < 1e-9, 'fabrication board hole uses shared boardToScene x');
assert(Math.abs(boardCircles[sample.settings.physicalKit.boardCells].x - boardCircles[0].x - sample.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM) < 1e-9, 'fabrication board hole pitch matches grid pitch');
const largeBoardKit = { ...sample.settings.physicalKit, boardCells: 20 };
const largeBoardProject = { ...sample, settings: { ...sample.settings, physicalKit: largeBoardKit } };
const q17Recipe = {
  ...recipeWithPath,
  boardCoordinate: 'Q17',
  board: { ...recipeWithPath.board, col: 16, row: 16, label: 'Q17', valid: true },
  assemblySteps: recipeWithPath.assemblySteps.map((step, index) => index === 0
    ? { ...step, boardCoordinate: 'Q17', coords: ['Q17'], coordRoles: ['board'] }
    : step)
};
assert(makeBlueprintSvg(largeBoardProject, [q17Recipe]).includes('data-blueprint-board-coordinate="Q17"'), 'physical Blueprint SVG preserves boardCells-aware build spots beyond O15');
assert(!makeBlueprintSvg(sample, [q17Recipe]).includes('data-blueprint-board-coordinate="Q17"'), 'physical Blueprint SVG rejects larger-board build spots on the default 15x15 kit');
assert.equal(physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit).boardCells, 12, 'profile selector applies complete physical kit preset');
assert.equal(boardGridLines(sample.settings.physicalKit).length, sample.settings.physicalKit.boardCells * 2, 'UI grid reuses one board grid definition');

const invalid = {
  ...sample,
  mechanisms: [{ ...boundMechanism('4bar', 'off'), anchorX: 9999, anchorY: 9999 }]
};
assert.equal(sceneToBoardRaw({ x: 9999, y: 9999 }, sample.settings.physicalKit).valid, false, 'raw board detects invalid anchor');
assert(validateForFabrication(invalid).errors.includes('Fix mechanism setup.'), 'fabrication rejects inconsistent off-board anchor geometry with the canonical readiness action');
const missingAnchor = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'missing-anchor'), anchorX: undefined, anchorY: undefined }] };
assert(validateForFabrication(missingAnchor).errors.includes('Fix mechanism geometry.'), 'fabrication rejects missing canonical board coordinates');
assert.throws(() => createFabricationPackage(missingAnchor), /Fix mechanism geometry\./, 'fabrication package does not silently place missing anchors at origin');
const importedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorX;
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorY;
const reloadedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(importedMissingAnchor)));
assert(validateForFabrication(reloadedMissingAnchor).errors.includes('Fix mechanism geometry.'), 'imported snapshot with missing anchors remains invalid for fabrication');

const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_elbow' });
assert.equal(removed.parts.right_arm_lower.anchorJointId, 'right_elbow', 'joint delete preserves the authored part anchor for diagnosis');
assert.equal(removed.mechanisms[0].targetAnchorJointId, 'right_hand', 'joint delete preserves authored mechanism anchor references');
assert.equal(removed.mechanisms[0].generatedPath, undefined, 'joint delete clears stale fitted motion artifacts');
assert.equal(removed.mechanisms[0].foundryExport, undefined, 'joint delete clears stale mechanism packages');
assert.equal(resolveMechanismRuntimeGate(removed, removed.mechanisms[0]).projection, 'static-recovery', 'joint delete leaves the mechanism in static recovery');
const cycleAttempt = applyProjectAction(sample, { type: 'update_joint', jointId: 'root', updates: { parentId: 'right_hand' } });
assert.equal(cycleAttempt.skeleton?.joints.root.parentId ?? null, sample.skeleton?.joints.root.parentId ?? null, 'joint reparent blocks skeleton cycles');
const movedJoint = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { position: { x: 222, y: 111 } } });
const movedPivot = bodyPartPivotScene(movedJoint.parts.right_arm_lower, movedJoint.skeleton);
assert(Math.hypot(movedPivot.x - 222, movedPivot.y - 111) < 1e-9, 'moving a skeleton joint updates anchored body-part pivot state');

const malicious = loadProjectSnapshot({
  ...sample,
  mechanisms: [{
    ...createDefaultMechanism('4bar', 'bad'),
    color: '#fff\"/><script>alert(1)</script><path stroke=\"#000',
    anchorX: '0" onload="alert(1)'
  }],
  parts: {
    badPart: {
      id: 'badPart',
      name: 'Bad',
      anchorJointId: 'missing_joint',
      transform: { x: '1" onload="alert(1)', y: 0, rotation: 0, scale: 1 },
      bounds: { x: -10, y: -10, width: 20, height: 20 },
      fillColor: 'url(javascript:alert(1))',
      zIndex: 0,
      opacity: 1,
      visible: true,
      locked: false,
      selectable: true
    }
  },
  partOrder: ['badPart']
});
const maliciousSvg = generateLowLevelMechanismSVG({ speed: 1, rotation: 0, mechanisms: malicious.mechanisms }, 0);
const maliciousDxf = generateLowLevelMechanismDXF({ speed: 1, rotation: 0, mechanisms: [{ ...malicious.mechanisms[0], id: 'bad\n0\nSCRIPT' }] }, 0);
assert.equal(malicious.mechanisms[0].color, '#3b82f6', 'import sanitizes mechanism color');
assert.equal(malicious.parts.badPart.fillColor, '#64748b', 'import sanitizes part color');
assert(malicious.skeleton?.joints[malicious.parts.badPart.anchorJointId], 'import repairs missing part anchor');
assert(!/<script|onload|javascript:/i.test(maliciousSvg), 'SVG export rejects imported script injection');
assert(!maliciousDxf.includes('bad\n0\nSCRIPT'), 'DXF export sanitizes imported layer names');

const packageProject = createProjectFromPackageData(
  {
    parts: {
      head: {
        image_path: 'parts/head.png',
        mask_path: 'parts/head-mask.png',
        anchor_joint_id: 'neck',
        original_svg_path: 'parts/head.svg',
        enhanced_svg_path: 'parts/head-enhanced.svg',
        roi: [40, 20, 80, 60],
        z_value: 2,
        local_pivot_offset: [45, 50],
        fill_color: 'rgba(10,20,30,0.5)'
      }
    }
  },
  parseCharConfig(`
skeleton:
- name: root
  loc: [100, 140]
  parent: null
- name: neck
  loc: [80, 50]
  parent: root
  bend_direction: -1
width: 200
height: 160
`),
  { 'parts/head.png': 'data:image/png;base64,head', 'parts/head-mask.png': 'data:image/png;base64,mask' },
  'pkg'
);
assert.equal(packageProject.mechanisms.length, 0, 'plain package import clears stale dummy mechanisms');
assert.equal(packageProject.parts.head.textureUrl, 'data:image/png;base64,head', 'package import resolves part texture');
assert.equal(packageProject.parts.head.maskUrl, 'data:image/png;base64,mask', 'package import resolves part mask');
assert.equal(packageProject.parts.head.originalSvgPath, 'parts/head.svg', 'package import preserves original SVG provenance');
assert.equal(packageProject.parts.head.enhancedSvgPath, 'parts/head-enhanced.svg', 'package import preserves enhanced SVG provenance');
assert(packageProject.skeleton?.joints.neck, 'package import loads char_cfg skeleton');
assert.equal(packageProject.skeleton?.joints.neck.bendDirection, -1, 'package import preserves bend direction');
assert.throws(
  () => createProjectFromPackageData(
    { parts: { head: { image_path: 'parts/missing.png', anchor_joint_id: 'neck', roi: [0, 0, 20, 20] } } },
    parseCharConfig('width: 20\nheight: 20\njoints:\n  neck:\n    position: [10, 10]\n    parent: null\n'),
    {},
    'missing-asset'
  ),
  /missing asset file parts\/missing\.png/,
  'package import blocks referenced missing part assets'
);

const keyedSkeletonProject = createProjectFromPackageData(
  { parts: { torso: { roi: [0, 0, 40, 40], anchor_joint: 'root' } } },
  parseCharConfig(`
width: 120
height: 120
joints:
  root:
    position: [60, 60]
    parent: null
  hand:
    loc: [80, 70]
    parent_id: root
`)
);
assert(keyedSkeletonProject.skeleton?.joints.hand, 'package import supports keyed joints char_cfg');
const sideLabeledPackageProject = createProjectFromPackageData(
  { parts: { torso: { roi: [0, 0, 200, 200], anchor_joint: 'root' } } },
  parseCharConfig(`
width: 200
height: 200
joints:
  root:
    position: [100, 120]
    parent: null
  left_shoulder:
    position: [150, 80]
    parent: root
  left_hand:
    position: [160, 100]
    parent: left_shoulder
  right_shoulder:
    position: [50, 80]
    parent: root
  right_hand:
    position: [40, 100]
    parent: right_shoulder
`)
);
assert.equal(sideLabeledPackageProject.skeleton?.metadata.sourceFormat, 'char_cfg.yaml', 'imported user character fixture uses the package import path');
assert.equal(sideLabeledPackageProject.skeleton?.joints.left_hand.position.x, 60, 'package import preserves source left-hand landmark X without global mirroring');
assert.equal(sideLabeledPackageProject.skeleton?.joints.right_hand.position.x, -60, 'package import preserves source right-hand landmark X without global mirroring');
const foundryPath = generateCurvePoints(createDefaultMechanism('5bar', 'foundry-preserve'), 96).points;
assert.equal(
  mechanismWithGeneratedPath({ ...createDefaultMechanism('5bar', 'foundry-preserve'), generatedPath: foundryPath }, { preserveGeneratedPath: true }).generatedPath?.length,
  foundryPath.length,
  'foundry handoff preserves its exported generated path resolution'
);
const foundryUpsert = applyProjectAction(sample, {
  type: 'upsert_mechanism',
  mechanism: {
    ...createDefaultMechanism('5bar', 'foundry-upsert'),
    generatedPath: foundryPath,
    foundryExport: {
      id: 'foundry-package',
      createdAt: 'now',
      mechanismId: 'foundry-upsert',
      mechanismType: '5bar',
      parameters: createDefaultMechanism('5bar', 'foundry-upsert'),
      pivot: { x: 0, y: 0 },
      generatedPath: foundryPath,
      simulationSummary: 'ok',
      visual: { color: '#000', scale: 1, constraintsVisible: true },
      animation: { duration: 1000, steps: foundryPath.length, loop: true },
      metadata: { sourceTab: 'mechanism-foundry', selectedPreset: 'balanced', recommendation: 'test fixture' },
      targetAnchorJointId: 'right_hand',
      warnings: [],
      source: 'mechanism-foundry'
    }
  }
});
assert.strictEqual(foundryUpsert, sample, 'legacy upsert rejects an unbound Foundry candidate atomically instead of persisting detached path/package data');
const generatedPathSentinel = [{ x: 12345, y: 67890 }, { x: 12365, y: 67880 }, { x: 12330, y: 67875 }];
const generatedPathSelectionProject = applyProjectAction(sample, {
  type: 'set_mechanisms',
  mechanisms: [{ ...sample.mechanisms[0], id: 'selection-generated-path', foundryExport: undefined, generatedPath: generatedPathSentinel }],
  selectedMechanismId: 'selection-generated-path'
});
assert.notDeepEqual(generatedPathSelectionProject.mechanisms[0].generatedPath, generatedPathSentinel, 'new mechanism insertion recomputes derived motion instead of trusting stored candidate path metadata');
assert.deepEqual(generatedPathSelectionProject.mechanisms[0].generatedPath, mechanismWithGeneratedPath({ ...generatedPathSelectionProject.mechanisms[0], generatedPath: undefined }).generatedPath, 'new mechanism insertion stores the canonical derived motion path');
const anchorOverride = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: { ...sample.mechanisms[0], targetAnchorJointId: 'right_elbow' } });
assert.strictEqual(anchorOverride, sample, 'invalid direct mechanism anchor edit preserves the exact prior aggregate instead of reconciling it');
const lockedPartProject = { ...sample, parts: { ...sample.parts, right_arm_lower: { ...sample.parts.right_arm_lower, locked: true } } };
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'update_part', partId: 'right_arm_lower', updates: { transform: { ...sample.parts.right_arm_lower.transform, x: 999 } } }).parts.right_arm_lower.transform.x,
  sample.parts.right_arm_lower.transform.x,
  'locked parts reject reducer-level edits'
);
assert.equal(
  applyProjectAction(lockedPartProject, { type: 'delete_part', partId: 'right_arm_lower' }).parts.right_arm_lower.id,
  'right_arm_lower',
  'locked parts reject deletion'
);
const lockedPathProject = { ...sample, parts: { ...sample.parts, right_hand_part: { ...sample.parts.right_hand_part, locked: true } } };
const lockedPathAttempt = applyProjectAction(lockedPathProject, { type: 'upsert_path', path: { ...sample.paths['path-right-arm'], points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } });
assert.deepEqual(lockedPathAttempt.paths['path-right-arm'].points, sample.paths['path-right-arm'].points, 'locked path owner parts reject path edits');
assert(applyProjectAction(lockedPathProject, { type: 'delete_path', pathId: 'path-right-arm' }).paths['path-right-arm'], 'locked path owner parts reject path deletion');
const lockedJointProject = { ...sample, skeleton: { ...sample.skeleton!, joints: { ...sample.skeleton!.joints, right_shoulder: { ...sample.skeleton!.joints.right_shoulder, locked: true } } } };
assert.equal(
  applyProjectAction(lockedJointProject, { type: 'update_joint', jointId: 'right_shoulder', updates: { position: { x: 999, y: 999 } } }).skeleton?.joints.right_shoulder.position.x,
  sample.skeleton?.joints.right_shoulder.position.x,
  'locked joints reject reducer-level edits'
);
assert(applyProjectAction(lockedJointProject, { type: 'remove_joint', jointId: 'right_shoulder' }).skeleton?.joints.right_shoulder, 'locked joints reject reducer-level removal');
const wrongTarget = {
  ...sample,
  paths: {
    ...sample.paths,
    'path-left': { ...sample.paths['path-right-arm'], id: 'path-left', partId: 'left_arm_lower', targetAnchorJointId: 'left_hand' }
  },
  mechanisms: [{ ...sample.mechanisms[0], targetPartId: 'right_arm_lower', targetPathId: 'path-left' }]
};
const wrongTargetValidation = validateForFabrication(wrongTarget);
assert(wrongTargetValidation.errors.includes('Fix: Choose anchor'), 'fabrication rejects mismatched target part/path with the canonical direct action');
assert(wrongTargetValidation.issues.some(issue => issue.message === 'Fix: Choose anchor' && issue.recoveryStage === 'design'), 'fabrication mismatch keeps the canonical recovery stage outside student copy');
assert.equal(handoffGate({ ...sample, parts: {}, partOrder: [], skeleton: null, paths: {}, mechanisms: [] }, 'path').ok, false, 'stage handoff blocks path work before character data');
assert.equal(handoffGate({ ...sample, mechanisms: [] }, 'design').ok, true, 'stage handoff allows Design to add the first mechanism after character load');
assert.equal(handoffGate(sample, 'blueprint').ok, true, 'stage handoff permits blueprint when mechanisms are valid');
assert.equal(handoffGate(sample, 'assembly').ok, true, 'stage handoff permits assembly guide when mechanisms are valid');
{
  const stageDispatches: ProjectAction[] = [];
  let navigatedStage: AppStage = 'character';
  let status = '';
  const gate = navigateAppStage({
    project: sample,
    target: 'blueprint',
    dispatch: action => stageDispatches.push(action),
    setStage: next => { navigatedStage = next; },
    setCommandStatus: next => { status = next; },
    stageLabel: target => target === 'blueprint' ? 'Blueprint' : target,
  });
  assert.equal(gate.ok, true, 'stage navigation returns the handoff gate result');
  assert.deepEqual(stageDispatches, [], 'stage navigation does not dispatch processing on valid navigation');
  assert.equal(navigatedStage, 'blueprint', 'stage navigation keeps valid target transition');
  assert.equal(status, 'Opened Blueprint', 'stage navigation keeps valid status copy');
}
{
  let navigatedStage: AppStage = 'character';
  let status = '';
  const goStage = createStageNavigator({
    project: sample,
    dispatch: () => { throw new Error('valid navigation should not dispatch'); },
    setStage: next => { navigatedStage = next; },
    setCommandStatus: next => { status = next; },
    stageLabel: target => target === 'blueprint' ? 'Blueprint' : target,
  });
  assert.equal(goStage('blueprint').ok, true, 'stage navigator helper returns the handoff gate result');
  assert.equal(navigatedStage, 'blueprint', 'stage navigator helper preserves target transition');
  assert.equal(status, 'Opened Blueprint', 'stage navigator helper preserves status copy');
}
{
  const blockedProject = { ...sample, parts: {}, partOrder: [], skeleton: null, paths: {}, mechanisms: [] };
  const stageDispatches: ProjectAction[] = [];
  let navigatedStage: AppStage = 'path';
  let status = '';
  const gate = navigateAppStage({
    project: blockedProject,
    target: 'path',
    dispatch: action => stageDispatches.push(action),
    setStage: next => { navigatedStage = next; },
    setCommandStatus: next => { status = next; },
    stageLabel: target => target,
  });
  assert.equal(gate.ok, false, 'stage navigation surfaces blocked handoff gates');
  assert.equal(navigatedStage, 'character', 'stage navigation sends blocked flows to recovery stage');
  assert.equal(status, 'Load a character package before entering this workflow.', 'stage navigation preserves blocked handoff status');
  assert.equal(stageDispatches[0]?.type, 'set_processing', 'stage navigation dispatches processing error on blocked handoff');
  if (stageDispatches[0]?.type === 'set_processing') {
    assert.equal(stageDispatches[0].processing.error, 'Load a character package before entering this workflow.', 'stage navigation preserves processing error copy');
  }
}
const reassignedElbowPivot = bodyPartPivotScene({ ...sample.parts.right_arm_lower, anchorJointId: 'right_elbow' }, sample.skeleton);
assert(Math.hypot(reassignedElbowPivot.x - (sample.skeleton?.joints.right_elbow.position.x ?? 0), reassignedElbowPivot.y - (sample.skeleton?.joints.right_elbow.position.y ?? 0)) < 1e-9, 'pivot can follow reassigned skeleton anchor');
const placed = placeBodyPartPivotAt({ ...sample.parts.right_arm_lower, anchorJointId: 'right_elbow' }, { x: 12, y: 34 }, sample.skeleton);
assert(Math.abs(bodyPartPivotScene(placed, sample.skeleton).x - 12) < 1e-9 && Math.abs(bodyPartPivotScene(placed, sample.skeleton).y - 34) < 1e-9, 'anchor-aware placement moves visual transform');
const handPart: BodyPartLayer = {
  ...sample.parts.right_arm_lower,
  id: 'right_hand_part',
  name: 'Right hand part',
  anchorJointId: 'right_hand',
  transform: { x: 128, y: -34, rotation: 0, scale: 1 },
  bounds: { x: -15, y: -15, width: 30, height: 30 },
  localPivotOffset: { x: 0, y: 0 },
  localPivotJointId: 'right_hand',
  zIndex: 9
};
const ikProject: ProjectState = {
  ...sample,
  parts: { ...sample.parts, right_hand_part: handPart },
  partOrder: [...sample.partOrder, 'right_hand_part'],
  mechanisms: [{ ...sample.mechanisms[0], targetAnchorJointId: 'right_hand' }]
};
{
  const squarePoints = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 }
  ];
  const squarePath = {
    ...ikProject.paths['path-right-arm'],
    timedPoints: squarePoints.map((point, index) => ({ ...point, time: (index / (squarePoints.length - 1)) * 1200 })),
    points: squarePoints,
    duration: 1200,
  };
  const openPoint = pointOnProjectPath({ ...squarePath, closed: false }, Math.PI * 2 * 0.875);
  const closedPoint = pointOnProjectPath({ ...squarePath, closed: true }, Math.PI * 2 * 0.875);
  assert(Math.abs(openPoint.x - 3.75) < 1e-9 && Math.abs(openPoint.y - 10) < 1e-9, 'open path playback follows the drawn polyline without a return segment');
  assert(Math.abs(closedPoint.x) < 1e-9 && Math.abs(closedPoint.y - 5) < 1e-9, 'closed path playback follows the return segment back to the first point');
}
{
  const firstStroke = [
    { x: 0, y: 0, time: 100 },
    { x: 30, y: 0, time: 220 },
    { x: 60, y: 0, time: 620 },
  ];
  const timedStroke = normalizeDrawTimedPoints(firstStroke, 1000);
  assert(timedStroke && timedStroke[0].time === 0 && Math.abs(timedStroke[1].time - 230.76923076923077) < 1e-6 && timedStroke[2].time === 1000, 'drawn timed points preserve relative hand pacing instead of redistributing evenly');
  const jitterIgnored = addDrawSamplePoint([{ x: 0, y: 0, time: 0 }], { x: 1, y: 1 }, 120);
  assert.equal(jitterIgnored.length, 1, 'draw sampling ignores tiny jitter even when time passes');
  const quickJump = addDrawSamplePoint([{ x: 0, y: 0, time: 0 }], { x: 112, y: 0 }, 16);
  assert(quickJump.length > 2 && quickJump.length <= 5, 'fast freehand jumps are lightly interpolated instead of storing raw dense pointer events or skipping the shape');
  const replaceStroke = addDrawSamplePoint(quickJump, { x: 5, y: 5 }, 800, true);
  assert.deepEqual(replaceStroke, [{ x: 5, y: 5, time: 800 }], 'starting a new free-draw stroke replaces the previous draft path');
  const closedStrokeTiming = normalizeDrawTimedPoints(firstStroke, 1000, { closed: true });
  assert(closedStrokeTiming && closedStrokeTiming.at(-1)?.time === 850, 'closed free-draw timing reserves part of the cycle for the return segment');
}
{
  const timedClosedPath = {
    ...ikProject.paths['path-right-arm'],
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    timedPoints: [
      { x: 0, y: 0, time: 0 },
      { x: 100, y: 0, time: 200 },
      { x: 100, y: 100, time: 700 },
    ],
    duration: 1000,
    closed: true,
  };
  const heldPacingPoint = pointOnProjectPath(timedClosedPath, Math.PI);
  const returnPoint = pointOnProjectPath(timedClosedPath, Math.PI * 2 * 0.85);
  assert(Math.abs(heldPacingPoint.x - 100) < 1e-9 && Math.abs(heldPacingPoint.y - 60) < 1e-9, 'closed timed path playback preserves non-uniform hand pacing before the return segment');
  assert(Math.abs(returnPoint.x - 50) < 1e-9 && Math.abs(returnPoint.y - 50) < 1e-9, 'closed timed path playback uses the reserved return segment back to the first point');
}
const pathPreview = motionPreviewForPath(ikProject, ikProject.paths['path-right-arm'], 0);
assert(pathPreview.parts.right_arm_lower, 'path editor preview moves selected limb at current frame');
assert(pathPreview.parts.right_arm_upper, 'path editor preview includes the upper arm when the hand path uses a shoulder-root chain');
assert.deepEqual(pathPreview.skeleton?.joints.right_shoulder.position, ikProject.skeleton?.joints.right_shoulder.position, 'IK preview keeps the shoulder root attached');
assert(Math.hypot((pathPreview.skeleton?.joints.right_hand.position.x ?? 0) - ikProject.paths['path-right-arm'].points[0].x, (pathPreview.skeleton?.joints.right_hand.position.y ?? 0) - ikProject.paths['path-right-arm'].points[0].y) < 1e-9, 'path editor IK target reaches the path point');
assert(distance(bodyPartPivotScene(pathPreview.parts.right_arm_upper, pathPreview.skeleton), pathPreview.skeleton!.joints.right_shoulder.position) < 1e-9, 'upper arm visual stays pinned to the shoulder root during hand IK');
assert(distance(bodyPartPivotScene(pathPreview.parts.right_arm_lower, pathPreview.skeleton), pathPreview.skeleton!.joints.right_elbow.position) < 1e-9, 'lower arm visual stays pinned to the solved elbow during hand IK');
assert.notEqual(pathPreview.parts.right_arm_upper.transform.rotation, ikProject.parts.right_arm_upper.transform.rotation, 'hand IK rotates the upper-arm body component as part of the same chain');
assert.notEqual(pathPreview.parts.right_arm_lower.transform.rotation, ikProject.parts.right_arm_lower.transform.rotation, 'hand IK rotates the lower-arm body component as part of the same chain');
const elbowRootPath = { ...ikProject.paths['path-right-arm'], chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_hand' };
const elbowRootPreview = motionPreviewForPath(ikProject, elbowRootPath, 0);
assert.deepEqual(elbowRootPreview.skeleton?.joints.right_elbow.position, ikProject.skeleton?.joints.right_elbow.position, 'path-specific IK root keeps the chosen elbow/knee joint attached');
assert(Math.hypot((elbowRootPreview.skeleton?.joints.right_hand.position.x ?? 0) - elbowRootPath.points[0].x, (elbowRootPreview.skeleton?.joints.right_hand.position.y ?? 0) - elbowRootPath.points[0].y) > 1, 'non-pinned path preview with shortened chain preserves segment length instead of teleporting');
const assertPhysicalDriverConflictContracts = async () => {
const rootOnlyPath = { ...ikProject.paths['path-right-arm'], partId: 'right_arm_lower', chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_elbow' };
const rootOnlyPreview = motionPreviewForPath(ikProject, rootOnlyPath, 0);
assert(Math.hypot((rootOnlyPreview.skeleton?.joints.right_elbow.position.x ?? 0) - rootOnlyPath.points[0].x, (rootOnlyPreview.skeleton?.joints.right_elbow.position.y ?? 0) - rootOnlyPath.points[0].y) < 1e-9, 'root-only IK translates the selected whole part so its handle follows the path point');
assert(rootOnlyPreview.parts.right_arm_lower && rootOnlyPreview.parts.right_arm_lower.transform.x !== ikProject.parts.right_arm_lower.transform.x, 'root-only IK preview moves the visible whole part instead of returning a static preview');
const drivenMechanism = {
  ...createDefaultMechanism('4bar', 'drive-effector'),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_hand_part']
};
const headDriverPath: ProjectMotionPath = {
  ...ikProject.paths['path-right-arm'],
  id: 'path-head-driver',
  partId: 'head',
  targetAnchorJointId: 'head_top',
  chainRootJointId: 'neck',
};
const lowerHandDriverPath: ProjectMotionPath = {
  ...ikProject.paths['path-right-arm'],
  id: 'path-right-lower-hand',
  partId: 'right_arm_lower',
  targetAnchorJointId: 'right_hand',
  chainRootJointId: 'right_shoulder',
};
const drivenProject: ProjectState = {
  ...ikProject,
  paths: {
    ...ikProject.paths,
    [headDriverPath.id]: headDriverPath,
    [lowerHandDriverPath.id]: lowerHandDriverPath,
  },
  mechanisms: [drivenMechanism],
};
const duplicateDriverInsert = applyProjectAction(drivenProject, {
  type: 'upsert_mechanism',
  mechanism: { ...drivenMechanism, id: 'brand-new-duplicate-driver' },
});
assert.equal(duplicateDriverInsert.mechanisms.length, drivenProject.mechanisms.length, 'reducer rejects a brand-new active duplicate driver');
assert.equal(duplicateDriverInsert.mechanisms.some(mechanism => mechanism.id === 'brand-new-duplicate-driver'), false, 'brand-new duplicate driver is not inserted');
const independentDriver = mechanismWithGeneratedPath({
  ...drivenMechanism,
  id: 'independent-head-driver',
  targetPartId: 'head',
  targetPathId: headDriverPath.id,
  targetAnchorJointId: 'head_top',
  activeVisualPartIds: ['head'],
});
const independentDriverProject = applyProjectAction(drivenProject, { type: 'upsert_mechanism', mechanism: independentDriver });
assert.equal(independentDriverProject.mechanisms.length, 2, 'reducer still accepts an active mechanism on a different driver identity');
const retargetConflictProject = applyProjectAction(independentDriverProject, {
  type: 'upsert_mechanism',
  mechanism: { ...independentDriverProject.mechanisms.find(mechanism => mechanism.id === 'independent-head-driver')!, ...pathOwnedTargetFields(ikProject.paths['path-right-arm']) },
});
assert.equal(retargetConflictProject.mechanisms.find(mechanism => mechanism.id === 'independent-head-driver')?.targetPartId, 'head', 'retargeting an existing mechanism to an occupied driver preserves prior state');
assert.equal(retargetConflictProject.mechanisms.find(mechanism => mechanism.id === 'independent-head-driver')?.targetPathId, headDriverPath.id, 'retarget conflict does not partially apply an occupied path');
const legacyDuplicateSnapshot = loadProjectSnapshot({
  ...drivenProject,
  mechanisms: [
    drivenMechanism,
    { ...drivenMechanism, id: 'legacy-duplicate-driver' },
  ],
  selectedMechanismId: 'legacy-duplicate-driver',
});
assert.equal(legacyDuplicateSnapshot.mechanisms.length, 2, 'legacy duplicate-driver snapshots remain represented on load');
assert(mechanismBindingWarnings(legacyDuplicateSnapshot)['legacy-duplicate-driver']?.includes('Fix: Choose anchor'), 'legacy duplicate-driver snapshots surface the authoritative recovery warning');
const legacyThreeWayDuplicateSnapshot = loadProjectSnapshot({
  ...drivenProject,
  mechanisms: [
    drivenMechanism,
    { ...drivenMechanism, id: 'legacy-duplicate-driver' },
    { ...drivenMechanism, id: 'legacy-third-driver' },
  ],
  selectedMechanismId: 'legacy-third-driver',
});
const legacyThreeWayIncrementalRecovery = applyProjectAction(legacyThreeWayDuplicateSnapshot, {
  type: 'set_mechanisms',
  mechanisms: legacyThreeWayDuplicateSnapshot.mechanisms.map(mechanism => mechanism.id === 'legacy-third-driver'
    ? { ...mechanism, targetPartId: 'head', targetPathId: headDriverPath.id, targetAnchorJointId: 'head_top', activeVisualPartIds: ['head'] }
    : mechanism),
  selectedMechanismId: 'legacy-third-driver',
});
assert.equal(legacyThreeWayIncrementalRecovery.mechanisms.find(mechanism => mechanism.id === 'legacy-third-driver')?.targetPartId, 'head', 'legacy three-way duplicate-driver recovery can reduce to the original legacy pair');
assert.deepEqual(Object.keys(mechanismBindingWarnings(legacyThreeWayIncrementalRecovery)).sort(), ['drive-effector', 'legacy-duplicate-driver'], 'legacy three-way recovery preserves the remaining original duplicate pair for later cleanup');
const legacyPairNewThirdRejected = applyProjectAction(legacyDuplicateSnapshot, {
  type: 'upsert_mechanism',
  mechanism: { ...drivenMechanism, id: 'new-third-duplicate-driver' },
});
assert.equal(legacyPairNewThirdRejected.mechanisms.some(mechanism => mechanism.id === 'new-third-duplicate-driver'), false, 'legacy duplicate-driver pair rejects a newly introduced third duplicate driver');
const setMechanismsDuplicateRejected = applyProjectAction(drivenProject, {
  type: 'set_mechanisms',
  mechanisms: [drivenMechanism, { ...drivenMechanism, id: 'set-duplicate-driver' }],
  selectedMechanismId: 'set-duplicate-driver',
});
assert.deepEqual(setMechanismsDuplicateRejected.mechanisms.map(mechanism => mechanism.id), ['drive-effector'], 'set_mechanisms rejects a new duplicate driver set');
assert.equal(setMechanismsDuplicateRejected.selectedMechanismId, drivenProject.selectedMechanismId, 'rejected set_mechanisms duplicate does not apply selection side effects');
const legacyDuplicateSelect = applyProjectAction(legacyDuplicateSnapshot, {
  type: 'set_mechanisms',
  mechanisms: legacyDuplicateSnapshot.mechanisms,
  selectedMechanismId: 'drive-effector',
});
assert.equal(legacyDuplicateSelect.selectedMechanismId, 'drive-effector', 'set_mechanisms preserves unchanged legacy duplicates while selecting');
assert.equal(legacyDuplicateSelect.mechanisms.length, 2, 'unchanged legacy duplicate assignments survive set_mechanisms selection');
const legacyDuplicateSetRecovery = applyProjectAction(legacyDuplicateSnapshot, {
  type: 'set_mechanisms',
  mechanisms: legacyDuplicateSnapshot.mechanisms.map(mechanism => mechanism.id === 'legacy-duplicate-driver'
    ? { ...mechanism, targetPartId: 'head', targetPathId: headDriverPath.id, targetAnchorJointId: 'head_top', activeVisualPartIds: ['head'] }
    : mechanism),
  selectedMechanismId: 'legacy-duplicate-driver',
});
assert.equal(legacyDuplicateSetRecovery.mechanisms.find(mechanism => mechanism.id === 'legacy-duplicate-driver')?.targetPartId, 'head', 'set_mechanisms accepts recovery that retargets a legacy duplicate');
assert.deepEqual(mechanismBindingWarnings(legacyDuplicateSetRecovery), {}, 'set_mechanisms recovery removes legacy duplicate warnings');
const recoveredLegacyDuplicate = applyProjectAction(legacyDuplicateSnapshot, {
  type: 'upsert_mechanism',
  mechanism: {
    ...legacyDuplicateSnapshot.mechanisms.find(mechanism => mechanism.id === 'legacy-duplicate-driver')!,
    targetPartId: 'head',
    targetPathId: headDriverPath.id,
    targetAnchorJointId: 'head_top',
    activeVisualPartIds: ['head'],
  },
});
assert.equal(recoveredLegacyDuplicate.mechanisms.find(mechanism => mechanism.id === 'legacy-duplicate-driver')?.targetPartId, 'head', 'legacy duplicate-driver snapshots can be retargeted for recovery');
assert.equal(mechanismDriverIdentity(drivenProject, drivenMechanism), mechanismDriverIdentity(drivenProject, { ...drivenMechanism, targetPartId: 'right_hand_part', activeVisualPartIds: ['right_hand_part'] }), 'canonical driver identity uses chain root and target joint, not only part id');
assert.deepEqual(pathOwnedTargetFields(ikProject.paths['path-right-arm']), {
  targetPartId: 'right_hand_part',
  targetSceneObjectId: undefined,
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_hand_part'],
}, 'shared path target helper returns exact part-owned target fields');
const animated = animatedPartsForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismPreview = motionPreviewForProject(drivenProject, drivenProject.mechanisms, 0);
const mechanismState = calculateLinkage(drivenMechanism, 0);
assert(animated.right_arm_lower, 'animated preview moves target part at current frame');
assert(animated.right_arm_upper, 'animated preview moves parent limb parts in the same IK chain');
assert(animated.right_hand_part, 'animated preview propagates target-anchor motion to descendant parts');
const movedUpperArmPivot = bodyPartPivotScene(animated.right_arm_upper, mechanismPreview.skeleton);
assert(distance(movedUpperArmPivot, mechanismPreview.skeleton!.joints.right_shoulder.position) < 1e-9, 'mechanism IK keeps the upper arm attached to the shoulder root');
const movedLowerArmPivot = bodyPartPivotScene(animated.right_arm_lower, mechanismPreview.skeleton);
assert(distance(movedLowerArmPivot, mechanismPreview.skeleton!.joints.right_elbow.position) < 1e-9, 'mechanism IK keeps the lower arm attached to the solved elbow instead of snapping it to the shoulder');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - mechanismState.effector.x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - mechanismState.effector.y) < 1e-9, 'mechanism design IK target follows the actual linkage effector');
assert(Math.hypot((mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0) - drivenProject.paths['path-right-arm'].points[0].x, (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0) - drivenProject.paths['path-right-arm'].points[0].y) > 20, 'mechanism design does not fake success by directly following the target path');
const generatedPathPoint = { x: mechanismState.effector.x + 123, y: mechanismState.effector.y - 57 };
const generatedPathDrivenMechanism = { ...drivenMechanism, generatedPath: [generatedPathPoint, { x: generatedPathPoint.x + 18, y: generatedPathPoint.y + 12 }, { x: generatedPathPoint.x - 14, y: generatedPathPoint.y + 24 }] };
const generatedPathDrivenPreview = motionPreviewForProject({ ...drivenProject, mechanisms: [generatedPathDrivenMechanism] }, [generatedPathDrivenMechanism], 0);
assert(Math.hypot((generatedPathDrivenPreview.skeleton?.joints.right_hand.position.x ?? 0) - generatedPathPoint.x, (generatedPathDrivenPreview.skeleton?.joints.right_hand.position.y ?? 0) - generatedPathPoint.y) < 1e-9, 'mechanism design IK target follows the fitted generated mechanism path when present');
assert(Math.hypot((generatedPathDrivenPreview.skeleton?.joints.right_hand.position.x ?? 0) - mechanismState.effector.x, (generatedPathDrivenPreview.skeleton?.joints.right_hand.position.y ?? 0) - mechanismState.effector.y) > 20, 'stored fitted mechanism paths override the raw linkage effector for character preview');
assert.notEqual(animated.right_arm_upper.transform.rotation, drivenProject.parts.right_arm_upper.transform.rotation, 'IK preview rotates the upper arm instead of leaving the parent component static');
assert.notEqual(animated.right_arm_lower.transform.rotation, drivenProject.parts.right_arm_lower.transform.rotation, 'IK preview rotates the limb instead of only offsetting it');
assert(Math.hypot(bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).x - (mechanismPreview.skeleton?.joints.right_hand.position.x ?? 0), bodyPartPivotScene(animated.right_hand_part, mechanismPreview.skeleton).y - (mechanismPreview.skeleton?.joints.right_hand.position.y ?? 0)) < 1e-9, 'descendant part anchor follows animated skeleton');
const objectDrivenStart = motionPreviewForProject(objectPathMechanismProject, [objectPathMechanism], 0);
const objectDrivenQuarter = motionPreviewForProject(objectPathMechanismProject, [objectPathMechanism], Math.PI / 2);
assert(objectDrivenStart.sceneObjects?.['object-piggy'], 'mechanism preview returns animated scene-object state');
assert.equal(Object.keys(objectDrivenStart.parts).length, 0, 'object-target mechanism preview does not animate unrelated body parts');
assert.notDeepEqual(
  objectDrivenStart.sceneObjects?.['object-piggy'].transform,
  objectDrivenQuarter.sceneObjects?.['object-piggy'].transform,
  'scrubbing mechanism preview animates the target scene object'
);
const mixedObjectFirst = motionPreviewForProject(
  { ...objectPathMechanismProject, mechanisms: [objectPathMechanism, generatedPathDrivenMechanism] },
  [objectPathMechanism, generatedPathDrivenMechanism],
  0,
);
assert(mixedObjectFirst.sceneObjects?.['object-piggy'], 'mixed object + character preview keeps object motion when a part mechanism runs after it');
assert(mixedObjectFirst.parts.right_arm_lower, 'mixed object + character preview also keeps the character mechanism when object motion runs first');
const mixedPartFirst = motionPreviewForProject(
  { ...objectPathMechanismProject, mechanisms: [generatedPathDrivenMechanism, objectPathMechanism] },
  [generatedPathDrivenMechanism, objectPathMechanism],
  0,
);
assert(mixedPartFirst.parts.right_arm_lower, 'mixed part + object preview keeps character motion when an object mechanism runs after it');
assert(mixedPartFirst.sceneObjects?.['object-piggy'], 'mixed part + object preview also keeps object motion when the part mechanism runs first');
const objectToggleSentinelMechanism = { ...objectPathMechanism, foundryExport: undefined, generatedPath: objectGeneratedPathSentinel };
const objectToggleHarness = renderMechanismActionHarness({
  project: { ...objectPathMechanismProject, mechanisms: [objectToggleSentinelMechanism] },
  selectedMechanism: objectToggleSentinelMechanism,
  selectedSceneObject: objectPathMechanismProject.sceneObjects['object-piggy']
});
objectToggleHarness.actions.updateMechanism('object-path-driver', { enabled: false });
const objectToggleDispatch = objectToggleHarness.dispatches.at(-1) as { type: string; mechanism: MechanismConfig };
assert.deepEqual(objectToggleDispatch.mechanism.generatedPath, objectGeneratedPathSentinel, 'metadata-only Design edits preserve fitted generatedPath samples');
const objectOptimizeHarness = renderMechanismActionHarness({
  project: { ...objectPathMechanismProject, settings: { ...objectPathMechanismProject.settings, performancePreset: 'fast' } },
  selectedPart: objectPathMechanismProject.parts.head,
  selectedPath: objectPathMechanismProject.paths['path-right-arm'],
  selectedMechanism: objectPathMechanism,
  selectedSceneObject: objectPathMechanismProject.sceneObjects['object-piggy']
});
await objectOptimizeHarness.actions.optimizeSelectedMechanism();
const optimizedObjectDispatch = objectOptimizeHarness.dispatches.at(-1) as { type: string; mechanism: MechanismConfig };
assert.equal(optimizedObjectDispatch.mechanism.targetSceneObjectId, 'object-piggy', 'Design Fit optimizes against the selected mechanism object target instead of the ambient selected part');
assert.equal(optimizedObjectDispatch.mechanism.targetPartId, undefined, 'Design Fit keeps object-target mechanisms free of body-part retargeting');
assert.equal(optimizedObjectDispatch.mechanism.targetPathId, 'path-object-piggy', 'Design Fit keeps the selected mechanism target path');
const sampleMechanism = sample.mechanisms[0];
assert(sampleMechanism, 'sample has a mechanism for driven-target checks');
assert(typeof sampleMechanism.anchorX === 'number', 'sample mechanism has a numeric anchorX for duplicate-driver offsets');
for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  const state = calculateLinkage(sampleMechanism, phase);
  const preview = motionPreviewForProject(sample, sample.mechanisms, phase);
  const targetJointId: string = preferredMotionJointId(sample, sampleMechanism.targetPartId, sampleMechanism.targetAnchorJointId)!;
  const targetJoint = preview.skeleton?.joints[targetJointId]?.position;
  const generatedTarget = sampleMechanism.generatedPath?.length
    ? pointOnGeneratedMechanismPath(sampleMechanism.generatedPath, phase)
    : state.effector;
  assert(generatedTarget, 'sample mechanism has a generated target sample');
  assert(state.isValid && targetJoint, 'sample mechanism has a valid driven target joint');
  assert(Math.hypot(targetJoint!.x - generatedTarget.x, targetJoint!.y - generatedTarget.y) < 1e-9, 'sample mechanism keeps its driven joint pinned to the fitted generated path through the whole scrub range');
}
const conflictProject: ProjectState = { ...drivenProject, mechanisms: [drivenMechanism, { ...drivenMechanism, id: 'second-driver' }] };
const conflicts = mechanismBindingWarnings(conflictProject);
assert(conflicts['drive-effector']?.includes('Fix: Choose anchor'), 'first duplicate driver receives the authoritative recovery action');
assert(conflicts['second-driver']?.includes('Fix: Choose anchor'), 'second duplicate driver receives the authoritative recovery action');
const missingBindingCopyProject: ProjectState = {
  ...drivenProject,
  mechanisms: [
    { ...drivenMechanism, id: 'mech_missing_part', targetPartId: 'right_hand_part_missing' },
    { ...drivenMechanism, id: 'mech_missing_path', targetPathId: 'path_missing_hand' },
    { ...drivenMechanism, id: 'mech_missing_anchor', targetPartId: 'right_arm_lower', targetAnchorJointId: 'right_wrist_missing' },
    ...conflictProject.mechanisms,
  ],
};
const studentBindingWarnings = mechanismBindingWarnings(missingBindingCopyProject);
assert.deepEqual(Object.keys(studentBindingWarnings).sort(), ['drive-effector', 'mech_missing_anchor', 'mech_missing_part', 'mech_missing_path', 'second-driver'].sort(), 'binding warnings keep mechanism ids as structured keys outside primary copy');
const bindingWarningCopyViolations = Object.values(studentBindingWarnings).flatMap(messages => messages).flatMap(message => {
  const violations: string[] = [];
  if (message.length > 48) violations.push(`too long: ${message}`);
  if (/Target part\s+\S+/.test(message)) violations.push(`raw target part id: ${message}`);
  if (/Target path\s+\S+/.test(message)) violations.push(`raw target path id: ${message}`);
  if (/Target anchor\s+\S+/.test(message)) violations.push(`raw target anchor id: ${message}`);
  if (/\b[a-z][a-z0-9]*_[a-z0-9_]*\b/.test(message)) violations.push(`snake_case id: ${message}`);
  if (/\b[a-z][a-z0-9_]*:[a-z][a-z0-9_]*\b/.test(message)) violations.push(`colon tuple: ${message}`);
  if (missingBindingCopyProject.mechanisms.some(mechanism => message.startsWith(`${mechanism.id} `))) violations.push(`mechanism id prefix: ${message}`);
  if (/Loose fit score\s+\d+/i.test(message)) violations.push(`raw loose score: ${message}`);
  return violations;
});
g006StudentWarningCopyViolations.push(...bindingWarningCopyViolations.map(violation => `binding: ${violation}`));
assert.deepEqual(g006StudentWarningCopyViolations, [], 'G006 student warning copy stays short and direct, hides technical ids/tuples/raw scores, and deduplicates presentation warnings');
const conflictFabricationErrors = validateForFabrication(conflictProject).errors;
assert(conflictFabricationErrors.includes('Fix: Choose anchor'), 'blueprint export blocks ambiguous duplicate target drivers with the same direct action');
assert(!conflictFabricationErrors.some(e => /drive-effector|second-driver|right_shoulder:right_hand|only one mechanism can own a target anchor/.test(e)), 'blueprint duplicate target errors keep ids and tuples out of student copy');
const canonicalDuplicateProject: ProjectState = {
  ...drivenProject,
  mechanisms: [
    { ...sampleMechanism, id: 'exact-hand-driver', targetPartId: 'right_hand_part', targetAnchorJointId: 'right_hand', targetPathId: 'path-right-arm', activeVisualPartIds: ['right_hand_part'] },
    { ...sampleMechanism, id: 'parent-hand-driver', targetPartId: 'right_arm_lower', targetAnchorJointId: 'right_hand', targetPathId: lowerHandDriverPath.id, activeVisualPartIds: ['right_arm_lower'] }
  ]
};
const canonicalDuplicateWarnings = mechanismBindingWarnings(canonicalDuplicateProject);
assert.deepEqual(Object.keys(canonicalDuplicateWarnings).sort(), ['exact-hand-driver', 'parent-hand-driver'], 'duplicate physical character drivers are reported on structured mechanism keys');
assert(canonicalDuplicateWarnings['exact-hand-driver']?.includes('Fix: Choose anchor'), 'exact owner driver conflicts with parent-part driver for the same chain root and target joint');
assert(canonicalDuplicateWarnings['parent-hand-driver']?.includes('Fix: Choose anchor'), 'parent-part driver cannot evade duplicate rejection for the same chain root and target joint');
const canonicalDuplicateFabricationErrors = validateForFabrication(canonicalDuplicateProject).errors;
assert(canonicalDuplicateFabricationErrors.includes('Fix: Choose anchor'), 'Blueprint export rejects duplicate physical character drivers even when targetPartId differs');
assert(!canonicalDuplicateFabricationErrors.some(e => /exact-hand-driver|parent-hand-driver|right_shoulder:right_hand|only one mechanism can own a target anchor/.test(e)), 'Blueprint canonical duplicate errors keep ids and tuples out of student copy');
const candidateMaskBaselineIssue = { severity: 'error' as const, message: 'Fix: snap gear pitch.', mechanismId: 'baseline-mechanism', recoveryStage: 'design' as const, recoveryAction: 'Snap gear pitch' };
const candidateMaskNewIssue = { ...candidateMaskBaselineIssue, mechanismId: 'candidate-mechanism' };
assert.deepEqual(newFabricationIssues([candidateMaskBaselineIssue], [candidateMaskNewIssue]), [candidateMaskNewIssue], 'a pre-existing generic fabrication error cannot mask the same new candidate issue with a different structured identity');
const duplicateVisibleValidation = validateForFabrication(canonicalDuplicateProject);
assert.equal(duplicateVisibleValidation.errors.filter(message => message === 'Fix: Choose anchor').length, 1, 'public Blueprint errors dedupe equivalent severity and message');
assert.equal(duplicateVisibleValidation.issues.filter(issue => issue.severity === 'error' && issue.message === 'Fix: Choose anchor').length, 1, 'Blueprint readiness compacts equivalent duplicate-driver blockers to one novice-safe issue');
const duplicateVisibleBlueprintMarkup = renderToString(createElement(BlueprintControlPanel, {
  project: canonicalDuplicateProject,
  goStage: () => undefined,
  validation: duplicateVisibleValidation,
  create: () => undefined,
  recipes: [],
  onSelectRecipe: () => undefined,
}));
assert.equal((duplicateVisibleBlueprintMarkup.match(/Fix: Choose anchor/g) ?? []).length, 1, 'Blueprint visible summary renders equivalent severity/message feedback once');
};
await assertPhysicalDriverConflictContracts();
const exportedForSettings = applyProjectAction(sample, { type: 'set_export', fabricationPackage: createFabricationPackage(sample) });
const uiSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { toolbarVisible: !exportedForSettings.settings.toolbarVisible, debugVisuals: true, detailedProcessingSteps: true } });
assert.equal(uiSettingsProject.lastExport, exportedForSettings.lastExport, 'UI-only options do not clear export package');
assert.equal(uiSettingsProject.metadata.updatedAt, exportedForSettings.metadata.updatedAt, 'UI-only options do not mutate project metadata');
const gridSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { physicalKit: { ...exportedForSettings.settings.physicalKit, gridPitchMm: exportedForSettings.settings.physicalKit.gridPitchMm + 1 } } });
assert.equal(gridSettingsProject.lastExport, undefined, 'physical kit options invalidate export package');
const snapSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { physicsSnapMode: 'high' } });
assert.equal(snapSettingsProject.lastExport, undefined, 'physics snap settings invalidate fabrication export package');
const simulationSettingsProject = applyProjectAction(exportedForSettings, { type: 'update_settings', settings: { simulationFriction: 0.5, simulationMassKg: 2 } });
assert.equal(simulationSettingsProject.lastExport, undefined, 'simulation physics settings invalidate fabrication export package');
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(!/https?:\/\//.test(indexHtml), 'index.html has no external CDN URLs');
assert(!/importmap|tailwindcss/i.test(indexHtml), 'index.html does not rely on importmap or Tailwind CDN');
assert(existsSync(join(process.cwd(), 'public/onnx/pose_model.onnx')), 'ONNX model asset is present for web runtime');
if (existsSync(join(process.cwd(), 'dist'))) {
  const distOnnxPath = join(process.cwd(), 'dist/onnx/pose_model.onnx');
  assert(existsSync(distOnnxPath), 'production build copies ONNX model to dist');
  assert(statSync(distOnnxPath).size > 1_000_000 && !readFileSync(distOnnxPath).subarray(0, 64).toString('utf8').startsWith('version https://git-lfs'), 'production ONNX build output is real model bytes, not a Git LFS pointer');
}
const staleExport = loadProjectSnapshot({ ...sample, lastExport: { id: 'stale-export' } });
assert.equal(staleExport.lastExport, undefined, 'imported project snapshots clear stale fabrication exports');
assert(existsSync(join(process.cwd(), 'src-tauri/icons/icon.png')) && existsSync(join(process.cwd(), 'src-tauri/icons/icon.ico')) && existsSync(join(process.cwd(), 'src-tauri/icons/icon.icns')), 'Tauri package icon files exist for png, ico, and macOS icns targets');
assert(statSync(join(process.cwd(), 'src-tauri/icons/icon.png')).size > 20_000 && statSync(join(process.cwd(), 'src-tauri/icons/icon.ico')).size > 20_000 && statSync(join(process.cwd(), 'src-tauri/icons/icon.icns')).size > 100_000, 'Tauri package icons use real MotionSmith artwork bytes, not tiny dummy grid placeholders');
assert.throws(
  () => createProjectFromPackageData({ parts: { p: { roi: [0, 0, 10, 10] } } }, parseCharConfig('width: 1\nheight: 1\nskeleton: []')),
  /missing skeleton\/joints|no valid joints/,
  'empty skeleton import fails instead of fabricating joints'
);

console.log('project contracts ok');

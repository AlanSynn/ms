import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import * as THREE from 'three';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { boardGridLines, boardToScene, bodyPartPivotScene, physicalKitPreset, placeBodyPartPivotAt, SCENE_PX_PER_MM, SCENE_VIEW, sceneToBoard, sceneToBoardRaw, sceneToSheetMm, sceneToSvg, sheetMmToScene } from '../utils/coordinates';
import { CLASSROOM_LESSONS, classroomLessonById, createDefaultMechanism, createDefaultSceneObject, createEmptyProject, createLessonProject, createSampleProject, handoffGate, loadProjectSnapshot, serializeProject, applyProjectAction, projectSelfCheck, mechanismRequiredParts, mechanismWithGeneratedPath, replaceCharacterProject, resetProjectToLessonBaseline } from '../utils/project';
import { boardFixedAssemblyCoordinatesForMechanism, createFabricationPackage, FABRICATION_GEAR_SPECS, FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_ROLE_MIN_HOLES, FABRICATION_LINKAGE_SPECS, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_RENDER_LAYER_Z_STEP, FABRICATION_RENDER_MIN_CLEARANCE, FABRICATION_RENDER_PART_DEPTH, FABRICATION_RING_GEAR_SPEC, FABRICATION_SOURCE_SSOT, FABRICATION_SPACER_SPEC, isBoardCoordinateWithin, mechanismBoardPlacementErrors, offBoardFixedAssemblyCoordinatesForMechanism, PLANETARY_GEAR_PLANET_COUNT, fabricationBoardColumnLabel, fabricationBoardCoordinateCallout, fabricationBoardRowLabel, fabricationGearPathD, fabricationGearProfileForPitchRadius, fabricationGearSpecForPitchRadius, fabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism, fabricationLinkageSpecForSceneLength, fabricationPartDisplayLabel, makeBlueprintPreviewSvg, makeBlueprintSvg, fabricationRingGearPathD, fabricationRingGearProfileForPitchRadius, fabricationRenderPlanForMechanism, fabricationStackForMechanism, fabricationStackSummary, planetaryGearConventionForMechanism, planetaryPlanetCenters, prefabAssemblySteps, readableFabricationStackSummary, sampleFeasibleRange, validateFabricationStack, validateForFabrication, validateMechanismPreviewReadiness } from '../utils/fabrication';
import { FABRICATION_GEAR_ROOT_WEB_MM, fabricationGearEngravingLabel, fabricationLinkageEngravingLabel, fabricationRingGearEngravingLabel, fabricationSpacerEngravingLabel } from '../utils/fabricationContract';
import { makeAssemblyGuideHtml as directMakeAssemblyGuideHtml, makeAssemblyGuidePdf as directMakeAssemblyGuidePdf } from '../utils/fabricationAssemblyGuide';
import { makeBlueprintPreviewSvg as directMakeBlueprintPreviewSvg, makeBlueprintSvg as directMakeBlueprintSvg } from '../utils/fabricationBlueprintSvg';
import { buildCharacterPrintLayout as directBuildCharacterPrintLayout } from '../utils/fabricationCharacterPrintLayout';
import { makeCutSheetPdf as directMakeCutSheetPdf } from '../utils/fabricationCutSheetPdf';
import { makeCustomPartsPdf as directMakeCustomPartsPdf, makeCustomPartsStl as directMakeCustomPartsStl, makeCustomPartsSvg as directMakeCustomPartsSvg } from '../utils/fabricationCustomParts';
import { fabricationGearPathD as profileFabricationGearPathD, fabricationGearProfileForPitchRadius as profileFabricationGearProfileForPitchRadius, fabricationRingGearPathD as profileFabricationRingGearPathD, fabricationRingGearProfileForPitchRadius as profileFabricationRingGearProfileForPitchRadius } from '../utils/fabricationProfiles';
import { createFabricationRecipe as directCreateFabricationRecipe } from '../utils/fabricationRecipes';
import { closePhysicalValue as readinessClosePhysicalValue, closeToBoardPitch as readinessCloseToBoardPitch, closeToFabricationLinkage as readinessCloseToFabricationLinkage, feasibilityLabelForStatus, feasibilityStatusForRange, physicalTolerance as readinessPhysicalTolerance, sampleFeasibleRange as readinessSampleFeasibleRange } from '../utils/fabricationReadiness';
import { FABRICATION_RENDER_LAYER_Z_STEP as renderPlanLayerZStep, FABRICATION_RENDER_MIN_CLEARANCE as renderPlanMinClearance, FABRICATION_RENDER_PART_DEPTH as renderPlanPartDepth, fabricationRenderPlanForMechanism as renderPlanForMechanism, validateFabricationStack as renderPlanValidateFabricationStack } from '../utils/fabricationRenderPlan';
import { FABRICATION_LINKAGE_ROLE_MIN_HOLES as sizingRoleMinHoles, PLANETARY_GEAR_PLANET_COUNT as sizingPlanetCount, fabricationLinkageHoleCountsForMechanism as sizingFabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism as sizingFabricationLinkageSceneLengthsForMechanism, planetaryGearConventionForMechanism as sizingPlanetaryGearConventionForMechanism, planetaryPlanetCenters as sizingPlanetaryPlanetCenters } from '../utils/fabricationSizing';
import { fabricationLinkageSpecForSceneLength as stackModelFabricationLinkageSpecForSceneLength, fabricationStackForMechanism as stackModelFabricationStackForMechanism, fabricationStackSummary as stackModelFabricationStackSummary, readableFabricationStackSummary as stackModelReadableFabricationStackSummary } from '../utils/fabricationStackModel';
import { circlePath as simplePdfCirclePath, hexRgb as simplePdfHexRgb, makePdfDocument as simplePdfDocument, makeSimplePdf as simplePdfMakeSimplePdf, num as simplePdfNum, pdfText as simplePdfEscapeText } from '../utils/simplePdf';
import { generateDXF, generateSVG } from '../utils/exporter';
import { createProjectFromPackageData, parseCharConfig } from '../utils/packageLoader';
import { animationDeltaRadians, calculateLinkage, camFollowerRise, camProfileScale, gearPairOutputRatio, gearTrainMeshPhaseDegAt, gearTrainMeshPhaseRadAt, gearTrainOutputRatio, gearTrainCenters, gearTrainPitchCenterDistance, gearTrainPitchRadii, gearTrainResolvedCenterDistance, gearTrainRotationRatioAt, generateCurvePoints, generateMechanismPointTraces, mechanismTracePointForState, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, planetaryRingPitchRadius, sampledCamProfileScale } from '../utils/kinematics';
import { animatedPartsForProject, describeMotionChain, mechanismBindingWarnings, mechanismPathFitIsUsable, motionAnchorJointIds, motionChainRootJointIds, motionPreviewForPath, motionPreviewForProject, motionPreviewForTarget, pointOnGeneratedMechanismPath, pointOnProjectPath, preferredMotionJointId } from '../utils/motion';
import { buildCutBaseViewport, clientPointToCutPoint, panCutViewport, zoomCutViewport, type CutFrame } from '../utils/cutEditorViewport';
import { addDrawSamplePoint, normalizeDrawTimedPoints } from '../utils/pathDrawing';
import { buildToonSceneProjection } from '../utils/sceneProjection';
import { buildFoundryPhysicsOverlay, buildKinematicPhysicsSession, mechanismPhysicsRule } from '../utils/physicsSession';
import { contourPathD, fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints, partOutlineBounds, partWorldPointToLocal, pointInsideOutline, scaleContour } from '../utils/partGeometry';
import { MECHANISM_FEATURE_REGISTRY, mechanismFeature, validateMechanismFeatureRegistry, type MechanismDragHandle } from '../utils/mechanismFeatureRegistry';
import { buildMechanismSnapshot, buildMechanismSnapshots } from './fixtures/mechanismSnapshot';
import { createFoundryPlaybackFrame, foundryPlaybackPhaseToInputAngle, generateFoundryPlaybackPointTraces } from '../utils/foundryPlayback';
import { createMechanismFitContext, createSceneMechanismFitContext, fitMechanismSimulation, fitMechanismSimulationWithContext } from '../utils/mechanismPreview';
import { buildMechanismRecommendations, fitMechanismToTargetPath, fitRecommendedMechanismToSheet } from '../utils/mechanismRecommendations';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { canvasPanOffset, canvasViewBoxForViewport, zoomCanvasViewportAtPoint } from '../utils/viewport';
import { resolveRenderPerformancePolicy } from '../utils/renderPerformancePolicy';
import { cachedThreeResource, clearThreeGroup, disposeThreeObjectGraph, resizeRendererToPerformancePolicy } from '../utils/threeResourceKit';
import { APP_COMMANDS, APP_MENU_GROUPS, commandById, commandIdForKeyboardEvent, validateAppCommandRegistry } from '../utils/appCommands';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_KERNEL_IMPORT, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, physicsKernelCapability, runRapierFrictionProbe } from '../utils/physicsKernel';
import { formatGridLabel, formatGridPitch, formatGridReadout } from '../utils/units';
import { buildAssemblyPlaybackSteps, buildCharacterAssemblyPlan, pendingRecipeForMechanism, type CharacterAssemblyPlan } from '../utils/assemblyPlayback';
import { buildCharacterAssemblySceneFrame, buildMechanismAssemblySceneFrame } from '../utils/assemblySceneFrame';
import { buildMechanismSceneContract } from '../utils/mechanismSceneContract';
import { buildAssemblyGuideModel } from '../components/stages/assembly/assemblyGuideModel';
import { selectBlueprintRecipe } from '../components/stages/blueprint/BlueprintExport';
import { MechanismLinkagePreview } from '../components/stages/foundry/MechanismLinkagePreview';
import { FoundryWorkflowPanel } from '../components/stages/foundry/FoundryWorkflowPanel';
import { useAppMechanismActions } from '../hooks/useAppMechanismActions';
import { createMechanismOptimizerJobInput, runMechanismOptimizerJob } from '../runtime/optimizer/mechanismOptimizerJob';
import { runMechanismFitJob } from '../runtime/fitting/mechanismFitJob';
import type { MechanismFitWorkerClient } from '../runtime/fitting/mechanismFitWorkerClient';
import { createStageNavigator, navigateAppStage } from '../utils/appStageNavigation';
import { smoothTrackingPoints, trackingPointsToWorldPath } from '../utils/trackingPath';
import { ALL_MECHANISM_TYPES, AUTHORABLE_MECHANISM_TYPES, ENABLED_AUTHORABLE_MECHANISM_TYPES, ENABLED_FOUNDRY_MECHANISM_TYPES, ENABLED_MECHANISM_TYPES, FOUNDRY_MECHANISM_TYPES, MECHANISM_TEMPLATE_LIBRARY, isMechanismTypeEnabled, mechanismTemplateLabel } from '../utils/mechanismTemplates';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { CLASSROOM_ASSESSMENT_KEYS, CLASSROOM_COPY, classroomAssessmentFor, classroomAssessmentKeyFromSearch, classroomAssessmentKeyHint, classroomAssessmentStatusText, classroomCueTitleFor, classroomUseExampleFor, DEFAULT_CLASSROOM_ASSESSMENT_KEY, formatClassroomAssessmentPrompt, formatClassroomUseExampleLabel, normalizeClassroomAssessmentKey, resolveClassroomAssessmentBundle, youtubeNoCookieEmbedUrl } from '../utils/classroomContent';
import { MECHANISM_TYPES as SANITIZE_MECHANISM_TYPES, sanitizeMechanismRuntime } from '../utils/sanitize';
import { generateSmartConfig, mutateConfig, OPTIMIZER_MECHANISM_TYPES } from '../utils/optimizer';
import { isBoardFixedCoordRole, normalizeGearLinkageToReference, normalizeGearTrainToFabrication, normalizeMechanismToFabricationSet, normalizeMechanismToReference, REFERENCE_DEFAULTS, REFERENCE_EXPORT_READY_TYPES, REFERENCE_FOUNDRY_TYPES, REFERENCE_MECHANISM_RECIPES, referenceRecipeForType } from '../utils/mechanismReference';
import type { AppStage, BodyPartLayer, FoundryExportPackage, MechanismConfig, MechanismType, Point, ProjectAction, ProjectState, SceneObject } from '../types';

projectSelfCheck();

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

assert(!existsSync(join(process.cwd(), 'public', 'onnx')), 'the classroom source tree has no image-recognition model directory');
assert(!existsSync(join(process.cwd(), 'utils', 'webOnnx.ts')), 'the browser image-recognition client stays removed');
assert(!existsSync(join(process.cwd(), 'workers', 'webOnnxInferenceWorker.ts')), 'the image-recognition worker stays removed');

const emptyProject = createEmptyProject();
const starterSample = createSampleProject();
const sample = createSampleProject({ includeMechanism: true });
const fabricationSample = createFabricationReadyFourBarProject();

type MechanismActionHarness = ReturnType<typeof useAppMechanismActions>;

const renderMechanismActionHarness = (overrides: {
  project?: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectState['paths'][string];
  selectedMechanism?: MechanismConfig;
  foundry?: MechanismConfig;
  angle?: number;
  mechanismFitClient?: MechanismFitWorkerClient;
} = {}) => {
  const project = overrides.project ?? createSampleProject({ includeMechanism: true });
  const selectedMechanism = overrides.selectedMechanism ?? project.mechanisms[0];
  const selectedPart =
    overrides.selectedPart ??
    (selectedMechanism?.targetPartId ? project.parts[selectedMechanism.targetPartId] : undefined);
  const selectedPath =
    overrides.selectedPath ??
    (selectedMechanism?.targetPathId ? project.paths[selectedMechanism.targetPathId] : undefined);
  const dispatches: ProjectAction[] = [];
  let stage: AppStage = 'character';
  let commandStatus = '';
  let actions: MechanismActionHarness | undefined;
  const mechanismFitClient: MechanismFitWorkerClient = overrides.mechanismFitClient ?? {
    request: (input, callbacks) => {
      callbacks.complete(runMechanismFitJob(input));
      return 1;
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
  const Harness = () => {
    actions = useAppMechanismActions({
      project,
      dispatch: (action) => dispatches.push(action),
      selectedPart,
      selectedSceneObject: overrides.selectedSceneObject,
      selectedPath,
      selectedMechanism,
      foundry: overrides.foundry ?? createDefaultMechanism('4bar', 'foundry-preview-contract'),
      mechanismConfig: { speed: project.settings.animationSpeed, rotation: 0, mechanisms: project.mechanisms },
      angle: overrides.angle ?? 0,
      setStage: (nextStage) => { stage = nextStage; },
      setCommandStatus: (status) => { commandStatus = status; },
      mechanismFitClient,
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
  };
};

const classroomLesson = createLessonProject('waving-arm');
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
assert(!existsSync(join(process.cwd(), 'resources/examples/raw/girl.png')), 'girl recognition starter image stays removed');
assert(!existsSync(join(process.cwd(), 'resources/examples/raw/boy.png')), 'boy recognition starter image stays removed');
const designContract = readFileSync(join(process.cwd(), 'DESIGN.md'), 'utf8');
const agentsContract = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');
const docsMap = readFileSync(join(process.cwd(), 'docs', 'README.md'), 'utf8');
const noviceUiPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'novice-canva-style-ui-plan.md'), 'utf8');
const classroomFieldPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-field-support-plan.md'), 'utf8');
const assemblyStepPlayerPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'assembly-step-player-redesign-plan.md'), 'utf8');
const classroomGuidedEntryPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-guided-entry-plan.md'), 'utf8');
const classroomSensemakingPlan = readFileSync(join(process.cwd(), 'docs', 'prd', 'classroom-sensemaking-discoverability-plan.md'), 'utf8');
const codebaseCleanupPlan = readFileSync(join(process.cwd(), 'docs', 'analysis', 'codebase-cleanup-architecture-plan.md'), 'utf8');
const normalizedCodebaseCleanupPlan = codebaseCleanupPlan.replace(/\s+/g, ' ');
const brandStaticFiles = [
  'App.tsx',
  'components/AppWorkspaceShell.tsx',
  'index.html',
  'package.json',
  'bun.lock',
  'metadata.json',
  'README.md',
  'DESIGN.md',
  'vite.config.ts',
  'run_browser.bat',
  'build_portable_exe.bat',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
  'docs/mechanism-blueprint-manual.md',
  'docs/prd/novice-canva-style-ui-plan.md',
  'docs/prd/classroom-field-support-plan.md',
  'docs/prd/realistic-25d-3d-physics-platform-plan.md',
  'docs/prd/canva-video-editor-workspace-plan.md',
  'docs/prd/toon-25d-main-3d-unlock-plan.md',
  'docs/subsystem-governance-and-mechanism-contracts.md',
  'docs/subsystem-governance-execution-log.md',
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
const deferredClassroomExampleVideoSource = readFileSync(join(process.cwd(), 'components', 'ui', 'DeferredClassroomExampleVideo.tsx'), 'utf8');
const viteConfigText = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
assert(viteConfigText.includes("const webBase = process.env.VITE_BASE_PATH ?? '/'"), 'web deployment base supports the GitHub Pages project path while keeping local root builds available');
assert(viteConfigText.includes("base: isTauri ? './' : webBase"), 'Tauri stays relative while web builds can target / or /ms/');
assert(viteConfigText.includes("format: 'es' as const"), 'module workers keep expensive jobs out of their cold entrypoint');
assert(viteConfigText.includes('chunkSizeWarningLimit: 2400'), 'Vite chunk warning budget is explicit for the lazy Rapier browser chunk');
assert(normalizedCodebaseCleanupPlan.includes('Button and command audit lock') && normalizedCodebaseCleanupPlan.includes('utils/appCommands.ts'), 'cleanup plan records the executable button/menu audit lock');
assert(normalizedCodebaseCleanupPlan.includes('Warning fixes locked') && normalizedCodebaseCleanupPlan.includes('Rapier warning boundary'), 'cleanup plan records scoped warning fixes instead of broad suppression');
assert(normalizedCodebaseCleanupPlan.includes('`App.tsx` is now a tiny composition entry') && normalizedCodebaseCleanupPlan.includes('`hooks/useMotionSmithAppController.ts`') && normalizedCodebaseCleanupPlan.includes('`components/AppWorkspaceShell.tsx`') && normalizedCodebaseCleanupPlan.includes('`components/AppStageRouter.tsx`') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppCharacterImportActions.ts`') && normalizedCodebaseCleanupPlan.includes('`hooks/useAppMechanismActions.ts`') && normalizedCodebaseCleanupPlan.includes('Image recognition removed'), 'cleanup plan records the current composition seams and the separate image-recognition removal milestone');
assert(normalizedCodebaseCleanupPlan.includes('`utils/appStageNavigation.ts`') && normalizedCodebaseCleanupPlan.includes('stage handoff gate, recovery dispatch, stage-open status, and `goStage` wiring'), 'cleanup plan records the extracted stage navigation seam');
assert(normalizedCodebaseCleanupPlan.includes('`utils/appStageRouterProps.ts`') && normalizedCodebaseCleanupPlan.includes('stage-router prop grouping'), 'cleanup plan records the extracted App stage-router prop grouping seam');
assert(normalizedCodebaseCleanupPlan.includes('`hooks/useAppCommandBindings.ts` | 36') && normalizedCodebaseCleanupPlan.includes('application keyboard shortcut binding owns latest-handler ref'), 'cleanup plan records the extracted keyboard command binding hook seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/ProgressBlock.tsx`') && normalizedCodebaseCleanupPlan.includes('package import progress UI lives outside the app shell'), 'cleanup plan records the extracted character progress seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/ui/InspectorControls.tsx` | 70') && normalizedCodebaseCleanupPlan.includes('shared inspector sliders/toggles live outside the app shell'), 'cleanup plan records the extracted inspector controls seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/PartInspector.tsx` | 276') && normalizedCodebaseCleanupPlan.includes('selected-part inspector owns part toggles'), 'cleanup plan records the extracted part inspector seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CutOutlineEditorDialog.tsx` | 379') && normalizedCodebaseCleanupPlan.includes('cut-outline editor owns modal pointer editing'), 'cleanup plan records the extracted cut outline editor seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/SkeletonInspector.tsx` | 225') && normalizedCodebaseCleanupPlan.includes('skeleton inspector owns joint/anchor editing'), 'cleanup plan records the extracted skeleton inspector seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterImportOverlays.tsx`') && normalizedCodebaseCleanupPlan.includes('character import status/review overlays live outside the app shell'), 'cleanup plan records the extracted character import overlay seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterLessonOwnership.tsx` | 47') && normalizedCodebaseCleanupPlan.includes('guided lesson ownership cues/actions live outside the app shell'), 'cleanup plan records the extracted guided lesson ownership seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterSetupPanel.tsx` | 53') && normalizedCodebaseCleanupPlan.includes('Character setup right-inspector wrapper lives outside the app shell'), 'cleanup plan records the extracted character setup panel seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterImportControls.tsx`') && normalizedCodebaseCleanupPlan.includes('character import entry controls live outside the app shell'), 'cleanup plan records the extracted character import controls seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/character/CharacterSelection.tsx` | 259') && normalizedCodebaseCleanupPlan.includes('Character stage wrapper lives outside the app shell'), 'cleanup plan records the extracted CharacterSelection stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/PathEditor.tsx` | 376') && normalizedCodebaseCleanupPlan.includes('Path stage wrapper lives outside the app shell'), 'cleanup plan records the extracted PathEditor stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/MechanismRecommendationSheet.tsx` | 230') && normalizedCodebaseCleanupPlan.includes('Path recommendation modal lives outside the app shell and previews board-fit overlays'), 'cleanup plan records the extracted Path recommendation modal seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/SceneSketch.tsx` | 0') && normalizedCodebaseCleanupPlan.includes('shared Three scene owns front-view drawing'), 'cleanup plan records the removal of the SVG-only Path canvas seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/path/PartShape.tsx` | 0') && normalizedCodebaseCleanupPlan.includes('solid component geometry comes from ThreePuppetPreview'), 'cleanup plan records the removal of the SVG-only Path part renderer');
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
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/foundryRenderInventory.ts` | 152') && normalizedCodebaseCleanupPlan.includes('rendered inventory counts live outside the WebGL renderer'), 'cleanup plan records the extracted Foundry render inventory helper seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/foundryPreviewStacks.ts` | 475') && normalizedCodebaseCleanupPlan.includes('Foundry pin-stack/z-order helper seam lives outside the app shell'), 'cleanup plan records the extracted Foundry pin-stack helper seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/MechanismFoundry.tsx` | 931') && normalizedCodebaseCleanupPlan.includes('Mechanism Foundry stage wrapper lives outside the app shell'), 'cleanup plan records the extracted MechanismFoundry stage seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryCanvasPane.tsx` | 246') && normalizedCodebaseCleanupPlan.includes('Foundry center canvas host owns Three preview wiring and delegates chrome/overlay leaves'), 'cleanup plan records the extracted Foundry canvas pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryCanvasChrome.tsx` | 168') && normalizedCodebaseCleanupPlan.includes('Foundry center canvas badge, camera controls, and playback chrome live outside the preview host'), 'cleanup plan records the extracted Foundry canvas chrome seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryOverlayLayer.tsx` | 285') && normalizedCodebaseCleanupPlan.includes('Foundry SVG force, velocity, playhead, param handle, and anchor overlays live outside the preview host'), 'cleanup plan records the extracted Foundry overlay seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryWorkflowPanel.tsx` | 238') && normalizedCodebaseCleanupPlan.includes('Foundry left workflow pane owns target summary'), 'cleanup plan records the extracted Foundry workflow pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/stages/foundry/FoundryInspectorPanel.tsx` | 231') && normalizedCodebaseCleanupPlan.includes('Foundry right inspector owns physics readout'), 'cleanup plan records the extracted Foundry inspector pane seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/AppShell.tsx`') && normalizedCodebaseCleanupPlan.includes('compatibility re-export barrel for shell leaves'), 'cleanup plan records AppShell as a compatibility shell barrel');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/workflowStages.ts` | 22') && normalizedCodebaseCleanupPlan.includes('workflow stage labels and shared playback stage list'), 'cleanup plan records the extracted workflow stage metadata seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/GettingStartedDialog.tsx`') && normalizedCodebaseCleanupPlan.includes('Getting Started modal is a shell leaf outside AppShell'), 'cleanup plan records the extracted Getting Started shell leaf seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkflowRail.tsx` | 23') && normalizedCodebaseCleanupPlan.includes('workflow rail and version mark are shell leaves outside AppShell'), 'cleanup plan records the extracted workflow rail seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/TopCommandBar.tsx` | 29') && normalizedCodebaseCleanupPlan.includes('top menu rendering is a shell leaf outside AppShell'), 'cleanup plan records the extracted top command bar seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/ShellDialogs.tsx` | 51') && normalizedCodebaseCleanupPlan.includes('shortcut/about dialogs are shell leaves outside AppShell'), 'cleanup plan records the extracted shell dialogs seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/CanvasZoomToolbar.tsx` | 14') && normalizedCodebaseCleanupPlan.includes('shared canvas zoom controls live outside AppShell'), 'cleanup plan records the extracted canvas zoom toolbar seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkspacePlayerDock.tsx` | 81') && normalizedCodebaseCleanupPlan.includes('floating workspace player dock view lives outside AppShell'), 'cleanup plan records the extracted workspace player dock view seam');
assert(normalizedCodebaseCleanupPlan.includes('`components/shell/WorkflowStatusStrip.tsx` | 7') && normalizedCodebaseCleanupPlan.includes('compact workflow status strip lives outside AppShell'), 'cleanup plan records the extracted workflow status strip seam');
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
assert(readFileSync(join(process.cwd(), 'utils', 'projectPersistence.ts'), 'utf8').includes('motionsmith.workspace') && readFileSync(join(process.cwd(), 'utils', 'projectAutosaveFormat.ts'), 'utf8').includes('motionsmith.autosave'), 'local storage namespace uses the MotionSmith slug for persistent state');
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
const appStageRouterCommandSource = readFileSync(join(process.cwd(), 'components', 'AppStageRouter.tsx'), 'utf8');
const classroomStageModulesSource = readFileSync(join(process.cwd(), 'components', 'classroomStageModules.tsx'), 'utf8');
const deferredThreePuppetPreviewSource = readFileSync(join(process.cwd(), 'components', 'DeferredThreePuppetPreview.tsx'), 'utf8');
const deferredThreeFoundryPreviewSource = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'DeferredThreeFoundryPreview.tsx'), 'utf8');
const characterSelectionCommandSource = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterSelection.tsx'), 'utf8');
const indexEntrySource = readFileSync(join(process.cwd(), 'index.tsx'), 'utf8');
const appShellCommandSource = readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8');
const gettingStartedDialogCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'GettingStartedDialog.tsx'), 'utf8');
const workflowRailCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowRail.tsx'), 'utf8');
const topCommandBarCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'TopCommandBar.tsx'), 'utf8');
const shellDialogsCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'ShellDialogs.tsx'), 'utf8');
const canvasZoomToolbarCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'CanvasZoomToolbar.tsx'), 'utf8');
const workspacePlayerDockCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkspacePlayerDock.tsx'), 'utf8');
const workflowStatusStripCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowStatusStrip.tsx'), 'utf8');
const workflowStagesCommandSource = readFileSync(join(process.cwd(), 'components', 'shell', 'workflowStages.ts'), 'utf8');
const trackingModalSource = readFileSync(join(process.cwd(), 'components', 'TrackingModal.tsx'), 'utf8');
const appProjectHistoryHookText = readFileSync(join(process.cwd(), 'hooks', 'useProjectHistory.ts'), 'utf8');
const projectHistoryPolicyText = readFileSync(join(process.cwd(), 'runtime', 'persistence', 'projectHistoryPolicy.ts'), 'utf8');
assert(appCommandSource.includes('useProjectHistory(createEmptyProject)') && !appCommandSource.includes('setProjectHistory') && !appCommandSource.includes('applyProjectAction(prev, action)') && appProjectHistoryHookText.includes('projectSelfCheck()') && appProjectHistoryHookText.includes('applyProjectAction') && projectHistoryPolicyText.includes('PROJECT_HISTORY_LIMIT') && appProjectHistoryHookText.includes('undoProject') && appProjectHistoryHookText.includes('redoProject'), 'App delegates empty ProjectState initialization, reducer dispatch, and undo/redo stack management to useProjectHistory while cold recovery remains a separate post-paint hook');
assert(appProjectHistoryHookText.includes('createProjectHistoryEntry') && appProjectHistoryHookText.includes('boundProjectHistory') && projectHistoryPolicyText.includes('PROJECT_HISTORY_BYTE_BUDGET = 8 * 1024 * 1024') && projectHistoryPolicyText.includes('Object.is(value, nextValue)'), 'undo history is bounded by retained bytes and exploits ProjectState structural sharing instead of serializing the aggregate on every edit');
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
assert(appWorkspaceShellCommandSource.includes('<AppStageRouter') && appWorkspaceShellCommandSource.includes('<TopCommandBar') && appWorkspaceShellCommandSource.includes('commandHandlers={commandHandlers}') && appWorkspaceShellCommandSource.includes('<WorkflowRail') && appWorkspaceShellCommandSource.includes('<WorkflowStatusStrip {...workflowStatus}') && appWorkspaceShellCommandSource.includes('<GettingStartedDialog') && appWorkspaceShellCommandSource.includes('<ShortcutHelpDialog') && appWorkspaceShellCommandSource.includes('<AboutDialog') && !appWorkspaceShellCommandSource.includes('<MechanismRecommendationSheet') && appWorkspaceShellCommandSource.includes('<TrackingModal') && appWorkspaceShellCommandSource.includes('onTransfer={onTransferTracking}'), 'AppWorkspaceShell preserves command, status, global modal, and tracking wiring without owning Design-local recommendation state');
assert(!indexEntrySource.includes('flushSync') && indexEntrySource.includes('window.requestAnimationFrame(releaseBootLoader)'), 'startup yields the first React commit instead of synchronously flushing the entire workspace');
assert(appWorkspaceShellCommandSource.includes('suspendStageContent={showGettingStarted}') && !classroomStageModulesSource.includes('lazy(') && classroomStageModulesSource.includes('if (!pathModule) throw loadPath()') && classroomStageModulesSource.includes('return <Component {...props} />') && !classroomStageModulesSource.includes('loadCharacterStage') && classroomStageModulesSource.includes('preloadNextClassroomStage') && classroomStageModulesSource.includes('case "character"') && classroomStageModulesSource.includes('foundryPromise = undefined') && classroomStageModulesSource.includes('pathPromise = undefined') && appStageRouterCommandSource.includes('import { CharacterSelection }'), 'Getting Started keeps hidden WebGL unmounted while the small Character shell is immediately available and retryable Suspense adapters warm only the next classroom stage');
assert(deferredThreePuppetPreviewSource.includes('import("./ThreePuppetPreview")') && deferredThreePuppetPreviewSource.includes('preloadThreePuppetPreview().then(() => {') && deferredThreePuppetPreviewSource.includes('setLoadState("failed")') && deferredThreePuppetPreviewSource.includes('setLoadAttempt') && deferredThreePuppetPreviewSource.includes('data-preview-load-state') && deferredThreePuppetPreviewSource.includes('window.requestAnimationFrame') && deferredThreePuppetPreviewSource.includes('<LazyThreePuppetPreview') && !deferredThreePuppetPreviewSource.includes('loadedThreePuppetPreview') && characterSelectionCommandSource.includes('<DeferredThreePuppetPreview'), 'The static Character shell still exposes an in-session Three chunk retry, waits for module resolution before its two-frame viewport mount, and keeps one stable lazy viewport identity across project updates');
assert(deferredThreeFoundryPreviewSource.includes('import("./ThreeFoundryPreview")') && deferredThreeFoundryPreviewSource.includes('preloadThreeFoundryPreview().then(() => {') && deferredThreeFoundryPreviewSource.includes('setLoadState("failed")') && deferredThreeFoundryPreviewSource.includes('setLoadAttempt') && deferredThreeFoundryPreviewSource.includes('data-preview-load-state') && deferredThreeFoundryPreviewSource.includes('window.requestAnimationFrame') && deferredThreeFoundryPreviewSource.includes('startTransition') && deferredThreeFoundryPreviewSource.includes('<LazyThreeFoundryPreview') && !deferredThreeFoundryPreviewSource.includes('loadedThreeFoundryPreview'), 'Foundry-backed stages expose an in-session Three chunk retry, paint controls first, and mount only after module resolution without swapping the lazy component identity after load');
assert(
  appStageRouterCommandSource.includes('useAdjacentClassroomStagePreload') &&
    classroomStageModulesSource.includes('requestIdleCallback') &&
    classroomStageModulesSource.includes('classifyClassroomStagePreloadReadiness') &&
    classroomStageModulesSource.includes('data-three-initial-scene-ready') &&
    classroomStageModulesSource.includes('data-three-topology-ready') &&
    classroomStageModulesSource.includes('mountedStage === "path"') &&
    !classroomStageModulesSource.includes('mountedStage === "character" || mountedStage === "path"'),
  'each stage preserves its interaction window by waiting for authoritative renderer readiness before warming only the adjacent adapter and renderer during idle time',
);
assert(appWorkspaceShellCommandSource.includes('const TrackingModal = lazy') && appWorkspaceShellCommandSource.includes('{showTracking && ('), 'Trace media code stays out of the classroom shell until Path requests it');
assert(appWorkspaceShellCommandSource.includes('data-testid="header-home"') && appWorkspaceShellCommandSource.includes('onClick={onHome}') && workflowRailCommandSource.includes('data-testid="rail-home"') && workflowRailCommandSource.includes('onClick={onHome}') && appControllerSource.includes('const openHome = ()') && appControllerSource.includes('setStage("character")') && appControllerSource.includes('setShowGettingStarted(true)'), 'Home controls return to Character and reopen Getting Started without replacing ProjectState');
assert(appShellCommandSource.includes("export { GettingStartedDialog") && gettingStartedDialogCommandSource.includes('export const GettingStartedDialog') && gettingStartedDialogCommandSource.includes('data-testid="getting-started-dialog"') && appWorkspaceShellCommandSource.includes('<GettingStartedDialog'), 'Getting Started dialog is an extracted shell leaf while preserving workspace mount wiring');
assert(!appShellCommandSource.includes('<') && !appShellCommandSource.includes('useState') && appShellCommandSource.includes("export { WorkflowRail") && appShellCommandSource.includes("export { TopCommandBar") && appShellCommandSource.includes("export { WorkspacePlayerDock") && appShellCommandSource.includes("export { SHARED_PLAYBACK_STAGES, STAGES"), 'AppShell is a compatibility re-export barrel, not a JSX/state owner');
assert(workflowRailCommandSource.includes('data-testid="workspace-steps"') && topCommandBarCommandSource.includes('data-testid="top-command-bar"') && shellDialogsCommandSource.includes('data-testid="shortcut-help-dialog"') && shellDialogsCommandSource.includes('data-testid="about-dialog"') && canvasZoomToolbarCommandSource.includes('data-testid="canvas-zoom-readout"') && workspacePlayerDockCommandSource.includes('data-testid="workspace-player-dock"') && workspacePlayerDockCommandSource.includes('data-testid="workspace-player-drag-handle"') && workflowStatusStripCommandSource.includes('data-testid="workflow-status-strip"') && workflowStagesCommandSource.includes("id: 'assembly'"), 'extracted shell leaves preserve existing test ids and workflow metadata');
for (const forbiddenShellBoundary of ['validateForFabrication', 'applyProjectAction', 'ProjectAction', 'dispatch(', 'setProject(']) {
  assert(!appWorkspaceShellCommandSource.includes(forbiddenShellBoundary), `AppWorkspaceShell must stay presentation-only and exclude ${forbiddenShellBoundary}`);
}
const visibleUiSource = [
  'App.tsx',
  'components/AppWorkspaceShell.tsx',
  'components/TrackingModal.tsx',
  'components/AppShell.tsx',
  'components/shell/GettingStartedDialog.tsx',
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
assert(readFileSync(join(process.cwd(), 'components', 'shell', 'WorkflowRail.tsx'), 'utf8').includes("../../src-tauri/icons/icon.png?url"), 'workflow rail uses the 256px MotionSmith delivery icon');
assert(readFileSync(join(process.cwd(), 'components', 'AppWorkspaceShell.tsx'), 'utf8').includes("../src-tauri/icons/icon.png?url"), 'top app bar uses the 256px MotionSmith delivery icon');
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
  'Create from image',
  'Get AI',
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
const deployWorkflowText = readFileSync(join(process.cwd(), '.github', 'workflows', 'deploy.yml'), 'utf8');
const ciWorkflowText = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
const workflowBrowserTestText = readFileSync(join(process.cwd(), 'tests', 'browser', 'workflow.spec.ts'), 'utf8');
const performanceWorkflowPath = join(process.cwd(), '.github', 'workflows', 'performance-audit.yml');
const bundleBudgetSource = readFileSync(join(process.cwd(), 'scripts', 'check-browser-bundle.mjs'), 'utf8');
const chromebookAuditDoc = readFileSync(join(process.cwd(), 'docs', 'chromebook-feature-audit.md'), 'utf8');
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
assert(playwrightConfigText.includes('delete process.env.NO_COLOR') && playwrightConfigText.includes('env -u NO_COLOR'), 'Playwright normalizes conflicting FORCE_COLOR/NO_COLOR env to avoid worker/webserver warning spam');
assert.equal(packageJson.version, '0.0.14', 'release version advances without moving the existing v0.0.13 tag');
assert.equal(tauriConfig.version, packageJson.version, 'Tauri config version stays aligned with package.json');
assert(viteConfigText.includes('__APP_VERSION__') && viteConfigText.includes('packageVersion'), 'Vite exposes package.json version to the browser UI');
assert.deepEqual(tauriConfig.bundle.icon, ['icons/icon.png', 'icons/icon.ico', 'icons/icon.icns'], 'Tauri bundle references the tracked MotionSmith png, ico, and icns icons');
assert(cargoTomlText.includes(`version = "${packageJson.version}"`), 'Cargo.toml version stays aligned with package.json');
assert(cargoLockText.includes('name = "motionsmith"') && cargoLockText.includes(`version = "${packageJson.version}"`), 'Cargo.lock MotionSmith package version stays aligned with package.json');
assert.equal(packageJson.packageManager, 'bun@1.3.14', 'Bun is the canonical package manager');
assert.equal(packageJson.scripts['test:contracts'], 'bun tests/project-contract.test.ts && bun tests/adaptive-high-resolution-controller.test.ts && bun tests/assembly-guide-model.test.ts && bun tests/no-image-recognition-runtime.test.ts && bun tests/b695-blueprint.test.ts && bun tests/b695-fit.test.ts && bun tests/blueprint-package-worker.test.ts && bun tests/autosave-recovery-worker.test.ts && bun tests/four-bar-fit-retention.test.ts && bun tests/foundry-handle-gesture.test.ts && bun tests/foundry-workflow-progressive-mount.test.ts && bun tests/mechanism-fit-worker.test.ts && bun tests/mechanism-recommendation-worker.test.ts && bun tests/mechanism-optimizer-worker.test.ts && bun tests/project-import-worker.test.ts && bun tests/scene-object-image-worker.test.ts && bun tests/tracking-media-policy.test.ts && bun tests/chromebook-audit-contract.test.ts && bun tests/render-performance-policy.test.ts && bun tests/renderer-interaction-seams.test.ts && bun tests/interactive-sampling.test.ts && bun tests/path-gesture-draft.test.ts && bun tests/automata-scene-runtime.test.ts && bun tests/three-resource-retention.test.ts && bun tests/cadenced-playback-sampler.test.ts && bun tests/transient-value-controller.test.ts', 'contract tests include adaptive resolution, cold autosave recovery, image-recognition exclusion, deterministic Assembly, Blueprint/export, fit, worker, bounded import and artwork, media-memory, Chromebook, render-policy, direct renderer interaction, Path/Foundry gesture-draft and progressive mount, sampling, retention, and transient-value gates');
assert.equal(packageJson.scripts['test:all'], 'bun scripts/run-unit-tests.mjs', 'release verification uses the checked deterministic unit-test manifest');
assert.equal(packageJson.scripts['test:bundle-budget'], 'bun scripts/check-browser-bundle.mjs', 'bundle budget runs from the checked production dist');
assert(bundleBudgetSource.includes('CORE_JS_GZIP_LIMIT_BYTES = 200_000'), 'core JavaScript gzip budget stays within the tightened 200 KB classroom envelope');
assert(bundleBudgetSource.includes('SHELL_COMPRESSED_LIMIT_BYTES = 300_000'), 'initial shell compressed budget stays within the tightened 300 KB classroom envelope');
assert(bundleBudgetSource.includes('OPTIONAL_JS_GZIP_LIMIT_BYTES = 200_000') && bundleBudgetSource.includes('RAPIER_JS_GZIP_LIMIT_BYTES = 900_000'), 'optional JavaScript chunks are bounded while the explicit lazy Rapier payload keeps its separate measured allowance');
assert(bundleBudgetSource.includes("class: rapier ? 'lazy-physics' : 'optional'") && bundleBudgetSource.includes('!report.optionalJs.passed'), 'bundle evidence inventories and enforces optional chunks outside the static classroom shell');
assert(bundleBudgetSource.includes("imageRecognitionRuntime: 'absent'"), 'bundle evidence states that the image-recognition runtime is absent');
assert.equal(packageJson.dependencies[PHYSICS_KERNEL_IMPORT], '^0.19.3', 'Rapier 3D compatibility WASM kernel is installed behind the physics subsystem boundary');
assert(!packageJson.dependencies['@react-three/fiber'] && !packageJson.dependencies['@react-three/rapier'] && !packageJson.dependencies['babylonjs'], 'renderer stack avoids extra scene frameworks while the imperative Three boundary is sufficient');
assert.equal(packageJson.scripts.build, 'tsc && bun scripts/check-no-image-recognition.mjs --source && vite build && bun scripts/check-no-image-recognition.mjs --dist', 'browser build keeps Vite for Rapier and hard-fails if image recognition returns');
assert(!Object.values(packageJson.scripts).some(script => String(script).includes('bun build')), 'browser scripts do not use Bun JS bundling for the Rapier runtime');
assert(physicsKernelSource.includes("import('@dimforge/rapier3d-compat')"), 'Rapier kernel uses a literal dynamic import so Vite emits a lazy Rapier chunk');
assert(!physicsKernelSource.includes('import(PHYSICS_KERNEL_IMPORT)'), 'Rapier kernel does not use a variable dynamic import that browsers cannot resolve after build');
assert(physicsKernelSource.includes('rapierModulePromise = null') && physicsKernelSource.includes('.catch(error =>'), 'a transient Rapier download or initialization failure remains retryable in the same session');
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
assert(deployWorkflowText.includes('oven-sh/setup-bun@v2') && deployWorkflowText.includes('bun install --frozen-lockfile') && deployWorkflowText.includes('bun run build'), 'classroom release workflow uses Bun install and build');
assert(deployWorkflowText.includes('bun run test:all'), 'classroom release runs every checked unit and contract test before artifact creation');
assert(deployWorkflowText.includes('bun run build:e2e') && deployWorkflowText.includes('tests/browser/webgl-recovery.spec.ts'), 'classroom release runs focused production-preview and WebGL recovery checks before artifact creation');
assert.equal(deployWorkflowText.match(/bun run test:bundle-budget/g)?.length, 1, 'the GitHub Pages classroom artifact enforces the shell and core JavaScript budgets');
assert.equal(deployWorkflowText.match(/bun run test:no-image-recognition/g)?.length, 1, 'the GitHub Pages classroom artifact excludes image-recognition assets');
assert(!deployWorkflowText.includes('git lfs') && !deployWorkflowText.includes('pose_model.onnx'), 'classroom release no longer fetches an image-recognition model');
assert(deployWorkflowText.includes('tags:') && deployWorkflowText.includes('v*.*.*') && !deployWorkflowText.includes('branches:') && !deployWorkflowText.includes('workflow_dispatch:'), 'classroom release deploys only from version tags');
assert(deployWorkflowText.includes('test "v${VERSION}" = "${GITHUB_REF_NAME}"'), 'classroom release requires the tag to match package.json version');
assert(deployWorkflowText.includes('VITE_BASE_PATH: /ms/'), 'classroom release builds the GitHub Pages project artifact at /ms/');
assert(deployWorkflowText.includes('actions/upload-pages-artifact@v5') && deployWorkflowText.includes('actions/deploy-pages@v5'), 'classroom release uploads and deploys only through GitHub Pages');
assert(!deployWorkflowText.includes('cloudflare') && !deployWorkflowText.includes('wrangler') && !deployWorkflowText.includes('motionsmith.org'), 'classroom release has no second hosted deployment path');
assert(!packageJson.scripts['test:cloudflare-live'], 'package commands do not retain a Cloudflare deployment-only gate');
assert(ciWorkflowText.includes('pull_request:') && ciWorkflowText.includes('bun run test:contracts') && ciWorkflowText.includes('bun run build:e2e'), 'pull requests run contracts and the production-preview diagnostics build');
assert(ciWorkflowText.includes('PLAYWRIGHT_WORKERS: 3') && ciWorkflowText.includes('tests/browser/webgl-recovery.spec.ts') && ciWorkflowText.includes('Run isolated interaction checks') && ciWorkflowText.includes('PLAYWRIGHT_WORKERS: 1') && ciWorkflowText.includes('Recommendation worker and job stay unloaded|Design Fit runs'), 'pull-request browser coverage keeps functional smoke bounded in parallel while isolating latency-sensitive interactions from shared SwiftShader contention');
assert(ciWorkflowText.includes('WebGL unavailable') && ciWorkflowText.includes('Foundry restores the same scene'), 'pull-request filtering executes both WebGL recovery checks instead of only naming their spec');
assert(ciWorkflowText.includes('Recommendation worker and job stay unloaded') && deployWorkflowText.includes('Recommendation worker and job stay unloaded') && workflowBrowserTestText.includes('Recommendation worker and job stay unloaded until explicit request'), 'PR and tag workflows execute the recommendation lazy-worker browser contract by its current test title');
assert(ciWorkflowText.includes('bun run test:bundle-budget'), 'pull requests enforce the production shell and core JavaScript budgets');
assert(!existsSync(performanceWorkflowPath), 'host-variable full Chromebook audits remain local-only instead of blocking pull requests for hours');
assert(!ciWorkflowText.includes('test:chromebook-audit') && !ciWorkflowText.includes('CHROMEBOOK_AUDIT=1'), 'pull-request CI keeps the full emulation harness local while retaining contracts, bundle budgets, and focused browser checks');
assert(!ciWorkflowText.includes('deploy-pages'), 'verification workflows cannot deploy GitHub Pages');
assert(docsMap.includes('chromebook-feature-audit.md'), 'docs map registers the current Chromebook feature evidence');
assert(chromebookAuditDoc.includes('Actual Chromebook tested: no') && chromebookAuditDoc.includes('6× CPU emulation'), 'Chromebook evidence does not claim untested physical hardware');
assert(chromebookAuditDoc.includes('Full emulation audits are local-only') && chromebookAuditDoc.includes('GitHub-hosted timing is not release evidence'), 'Chromebook documentation keeps slow host-variable audits out of CI without weakening local evidence');
assert(chromebookAuditDoc.includes('does not establish ten-minute heap stabilization') && chromebookAuditDoc.includes('No physical Chromebook was tested'), 'short memory evidence keeps the physical-device and ten-minute boundaries explicit');
assert(chromebookAuditDoc.includes('156,137 gzip bytes') && chromebookAuditDoc.includes('217,411 compressed bytes'), 'audit document records the checked production bundle evidence');
assert(chromebookAuditDoc.includes('webgl-clear-submission') && chromebookAuditDoc.includes('High is not claimed safe') && chromebookAuditDoc.includes('remains opt-in'), 'audit documentation distinguishes actual renderer telemetry and the opt-in High-resolution boundary');
assert.equal(tauriConfig.build.beforeDevCommand, 'bun run dev', 'Tauri dev hook uses Bun');
assert.equal(tauriConfig.build.beforeBuildCommand, 'bun run build:tauri-frontend', 'Tauri build hook uses Bun');
assert(deploymentDocs.includes('bun install --frozen-lockfile') && !deploymentDocs.includes('npm '), 'deployment docs use Bun commands');
assert(deploymentDocs.includes('Classroom release checklist') && deploymentDocs.includes('v<package.json version>') && deploymentDocs.includes('VITE_BASE_PATH=/ms/'), 'deployment docs include the tag-gated /ms classroom release checklist');
assert(deploymentDocs.includes('GitHub Pages release deploy') && deploymentDocs.includes('https://alansynn.com/ms/'), 'deployment docs identify GitHub Pages as the classroom release path');
assert(!deploymentDocs.includes('Cloudflare') && !deploymentDocs.includes('motionsmith.org'), 'deployment docs do not describe a second hosted release path');
assert(deploymentDocs.includes('no `/api/` requests') && deploymentDocs.includes('Teacher pack workflow') && deploymentDocs.includes('no account, no upload'), 'deployment docs lock classroom release to static local-first teacher-pack flow');
assert(macosDocs.includes('bun run build:exe') && !macosDocs.includes('npm '), 'macOS distribution docs use Bun commands');
assert(agentsContract.includes('three` + Rapier WASM'), 'AGENTS.md records the selected high-performance 3D physics stack');
assert(agentsContract.includes('Viser-style transform tree'), 'AGENTS.md records the Viser-inspired batching rule for large scenes');
assert(agentsContract.includes('preserve coverage while optimizing wall time'), 'AGENTS.md requires test speedups to preserve test quality');
assert(agentsContract.includes('bounded Playwright parallel workers'), 'AGENTS.md requires bounded browser test parallelism');
assert(agentsContract.includes('bun run test') && agentsContract.includes('bun run build') && !agentsContract.includes('npm test'), 'AGENTS.md verification gates use Bun commands');
assert(agentsContract.includes('GitHub Pages is the only hosted web release path') && agentsContract.includes('https://alansynn.com/ms/'), 'AGENTS.md locks the single GitHub Pages classroom path');
assert(agentsContract.includes('Deploy only from version tags') && agentsContract.includes('v<package.json version>') && agentsContract.includes('Do not re-enable `main` branch deployment'), 'AGENTS.md locks tag-only GitHub Pages deployment');
assert(agentsContract.includes('package.json') && agentsContract.includes('src-tauri/Cargo.toml') && agentsContract.includes('src-tauri/tauri.conf.json'), 'AGENTS.md requires browser and Tauri version alignment before release');
assert(agentsContract.includes('local-first browser/Tauri'), 'AGENTS.md excludes server scope and locks the app as local-first');
assert(agentsContract.includes('Do not add backend/API server'), 'AGENTS.md explicitly excludes backend/API/auth/cloud work unless reopened');
assert(agentsContract.includes('Guided classroom lesson templates must create real serializable `ProjectState` data') && agentsContract.includes('Blank starters stay mechanism-free'), 'AGENTS.md locks lesson templates to real state and keeps blank starters clean');
assert(agentsContract.includes('Classroom entry is theme-guided first') && agentsContract.includes('open exploration stays secondary'), 'AGENTS.md locks guided project entry as the classroom-primary start');
assert(agentsContract.includes('`Reset Lesson` must restore a known-good lesson baseline') && agentsContract.includes('preserving app settings'), 'AGENTS.md locks stable lesson reset semantics');
assert(agentsContract.includes('Blueprint owns build files') && agentsContract.includes('Assembly owns animated step-by-step build'), 'AGENTS.md preserves Blueprint versus Assembly role split');
assert(agentsContract.includes('Use domain-driven vocabulary consistently') && agentsContract.includes('Keep harness engineering first-class'), 'AGENTS.md locks DDD vocabulary and harness-friendly seam rules');
assert(designContract.includes('Shared editor workbench'), 'DESIGN.md documents the shared editor workbench');
assert(designContract.includes('Project governance: `AGENTS.md`'), 'DESIGN.md points contributors at the project agent contract');
assert(designContract.includes('#8b5cf6'), 'DESIGN.md uses the MotionSmith light primary color');
assert(!designContract.includes('Cyber-Industrial Minimalism'), 'DESIGN.md no longer points contributors at the old dark CAD direction');
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
  'components/stages/character/CharacterSelection.tsx',
  'components/stages/path/PathWorkflowPanel.tsx',
  'components/stages/foundry/FoundryCanvasChrome.tsx',
  'components/stages/blueprint/BlueprintControlPanel.tsx',
  'components/stages/assembly/AssemblyControlPanel.tsx',
  'components/stages/options/Options.tsx'
].map(file => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
assert(['character.loadCharacterFile', 'character.bodySides', 'path.draw', 'viewer.layers', 'blueprint.boardPreview', 'assembly.steps', 'options.fabricationExport'].every(helpId => contextHelpConsumerSource.includes(helpId)), 'high-friction UI controls attach contextual help through shared help ids');
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
assert(classroomFieldPlan.includes('Web is mandatory for classrooms') && classroomFieldPlan.includes('https://alansynn.com/ms/') && !classroomFieldPlan.includes('motionsmith.org'), 'classroom plan locks the GitHub Pages web-first classroom release target');
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
assert(deferredClassroomExampleVideoSource.includes('lazy(async') && deferredClassroomExampleVideoSource.includes('import("./ClassroomExampleVideo")') && deferredClassroomExampleVideoSource.includes('<LazyClassroomExampleVideo'), 'classroom example code is imported only when a stage renders its shared deferred boundary');
assert(classroomExampleVideoSource.includes('prefers-reduced-motion: reduce') && classroomExampleVideoSource.includes('if (reducedMotion) return;') && classroomExampleVideoSource.includes('data-reduced-motion'), 'classroom generated loops respect reduced-motion by not starting the animation loop');
assert(classroomExampleVideoSource.includes('Watch for:') && classroomExampleVideoSource.includes('Think:') && classroomExampleVideoSource.includes('data-youtube-id'), 'classroom example video exposes a compact observation cue, student question, and explicit YouTube source id');
assert.equal(CLASSROOM_COPY.videoUnavailable, 'Video unavailable. Use the generated loop.', 'video fallback copy is owned by the classroom content seam');
assert(classroomExampleVideoSource.includes('data-testid="classroom-video-fallback"') && classroomExampleVideoSource.includes('CLASSROOM_COPY.videoUnavailable'), 'classroom example video component keeps a local fallback if an optional external video is blocked');
assert(classroomExampleVideoSource.includes('sandbox="allow-scripts allow-same-origin allow-presentation"') && classroomExampleVideoSource.includes('referrerPolicy="strict-origin-when-cross-origin"') && !classroomExampleVideoSource.includes('clipboard-write') && !classroomExampleVideoSource.includes('gyroscope') && !classroomExampleVideoSource.includes('web-share'), 'optional classroom video embeds use restricted iframe permissions');

assert.equal(classroomLessonById('waving-arm')?.startStage, 'character', 'classroom lesson opens in Character so students inspect/edit the rig before drawing');
for (const lesson of CLASSROOM_LESSONS) {
  const lessonProjectState = createLessonProject(lesson.id);
  const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(lessonProjectState)));

  assert.equal(roundTrip.metadata.classroomLessonId, lesson.id, `${lesson.id} carries classroom lesson metadata`);
  assert.equal(roundTrip.metadata.classroomLessonLabel, lesson.label, `${lesson.id} carries classroom lesson label`);
  assert(roundTrip.skeleton && Object.keys(roundTrip.skeleton.joints).length >= 17, `${lesson.id} creates a real editable skeleton`);
  assert(Object.keys(roundTrip.parts).length >= 14, `${lesson.id} creates real editable body parts`);
  assert(roundTrip.partOrder.length >= 14, `${lesson.id} creates a real part order`);
  assert(roundTrip.settings.physicalKit.gridPitchMm > 0, `${lesson.id} carries real fabrication settings`);
  assert.equal(roundTrip.processing.stage, 'ready', `${lesson.id} returns ready ProjectState`);
  assert.equal(roundTrip.mechanisms.length, 1, `${lesson.id} creates one real editable mechanism`);
  assert.equal(roundTrip.selectedMechanismId, roundTrip.mechanisms[0].id, `${lesson.id} selects its mechanism`);
  const lessonPathFitStatus = roundTrip.mechanisms[0].fabricationMetadata?.pathFit?.status;
  if (lessonPathFitStatus === 'fit') {
    assert((roundTrip.mechanisms[0].generatedPath?.length ?? 0) >= 3, `${lesson.id} fitted mechanism has generated motion samples`);
  } else if (roundTrip.mechanisms[0].type === '4bar') {
    assert.equal(roundTrip.mechanisms[0].generatedPath, undefined, `${lesson.id} rejected four-bar does not expose an arbitrary target path`);
  }
  const lessonFabrication = validateForFabrication(roundTrip);
  if (lessonPathFitStatus === 'rejected') {
    assert(lessonFabrication.errors.some(error => error.includes('No fabrication-valid path fit.')), `${lesson.id} blocks fabrication until the path fits`);
  } else {
    assert.deepEqual(lessonFabrication.errors, [], `${lesson.id} has no fabrication errors`);
  }
  assert.deepEqual(lessonFabrication.warnings, [], `${lesson.id} has no fabrication warnings`);
  const feasibleRange = sampleFeasibleRange(roundTrip.mechanisms[0], 96);
  assert.equal(feasibleRange.warning, null, `${lesson.id} samples a natural collision-free motion`);
  assert.equal(feasibleRange.percentValid, 1, `${lesson.id} has 100% valid sampled motion`);
  const liveRecipe = pendingRecipeForMechanism(roundTrip, roundTrip.mechanisms[0]);
  if (lessonPathFitStatus === 'rejected') {
    assert(liveRecipe.warnings.some(warning => warning === 'No fabrication-valid path fit.'), `${lesson.id} assembly recipe reports the hard fit blocker`);
  } else {
    assert.deepEqual(liveRecipe.warnings, [], `${lesson.id} assembly recipe has no warnings`);
  }
  assert(buildAssemblyPlaybackSteps(liveRecipe, 'kit').length > 0, `${lesson.id} has kit mechanism assembly steps`);
  const lessonAssemblyModel = buildAssemblyGuideModel({ project: roundTrip, selectedRecipeId: roundTrip.mechanisms[0].id, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
  assert.equal(lessonAssemblyModel.selectedRecipe?.mechanismId, roundTrip.mechanisms[0].id, `${lesson.id} assembly selects its live mechanism recipe`);
  assert(lessonAssemblyModel.activeStepCount > 0, `${lesson.id} assembly has playable steps`);
  assert(buildCharacterAssemblyPlan(roundTrip).steps.length > 0, `${lesson.id} keeps character assembly steps`);
}
assert.equal(classroomLesson.metadata.classroomLessonId, 'waving-arm', 'lesson ProjectState carries resettable classroom lesson metadata');
assert.equal(classroomLesson.metadata.classroomLessonLabel, 'Waving arm', 'lesson ProjectState keeps the English-only classroom label');
assert.equal(classroomLesson.mechanisms.length, 1, 'waving-arm lesson includes one real path-bound mechanism instead of a mock recommendation card');
assert.equal(classroomLesson.selectedPathId, 'path-right-arm', 'waving-arm lesson selects the editable hand path');
assert.equal(classroomLesson.selectedMechanismId, 'mech-1', 'waving-arm lesson selects the path-bound four-bar mechanism');
assert.equal(classroomLesson.paths['path-right-arm'].partId, 'right_hand_part', 'waving-arm lesson targets the hand part instead of the lower arm plate');
assert.equal(classroomLesson.mechanisms[0].targetPartId, 'right_hand_part', 'waving-arm mechanism binds to the hand part instead of the lower arm plate');
assert.equal(classroomLesson.mechanisms[0].targetAnchorJointId, 'right_hand', 'waving-arm lesson drives the hand end-effector');
const wavingLessonMechanism = classroomLesson.mechanisms[0];
const wavingLessonGround = calculateLinkage(wavingLessonMechanism, 0);
assert(sceneToBoardRaw({ x: wavingLessonMechanism.anchorX ?? Number.NaN, y: wavingLessonMechanism.anchorY ?? Number.NaN }, classroomLesson.settings.physicalKit).valid, 'waving-arm chooses a board-hole main pivot');
assert(sceneToBoardRaw(wavingLessonGround.p2, classroomLesson.settings.physicalKit).valid, 'waving-arm chooses a board-hole second fixed pivot');
assert([0, 90, 180, 270].includes(((wavingLessonMechanism.groundAngle ?? 0) % 360 + 360) % 360), 'waving-arm keeps the ground link on a fabricatable cardinal board direction');
assert.equal(sceneToBoardRaw({ x: wavingLessonMechanism.anchorX!, y: wavingLessonMechanism.anchorY! }, classroomLesson.settings.physicalKit).label, 'H13', 'waving-arm uses the certified H13 input pivot');
assert.equal(sceneToBoardRaw(wavingLessonGround.p2, classroomLesson.settings.physicalKit).label, 'H5', 'waving-arm uses the certified H5 ground pivot');
assert.equal(wavingLessonMechanism.fabricationMetadata?.pathFit?.status, 'fit', 'waving-arm ships a fabrication-valid physical output path');
assert.equal(wavingLessonMechanism.fabricationMetadata?.pathFit?.outputTraceId, 'C', 'waving-arm binds the hand to the physical output pin');
assert.equal(classroomLesson.mechanisms[0].generatedPath?.length, 96, 'waving-arm stores one bounded physical sweep instead of fitting at lesson-open time');
const classroomLessonRoundTrip = loadProjectSnapshot(JSON.parse(serializeProject(classroomLesson)));
assert.equal(classroomLessonRoundTrip.mechanisms[0].fabricationMetadata?.pathFit?.status, 'fit', 'lesson load preserves the certified physical fit');
assert.deepEqual(classroomLessonRoundTrip.mechanisms[0].warnings, [], 'lesson load preserves a warning-free certified fit');
const fittedReducerReplay = applyProjectAction(classroomLesson, {
  type: 'upsert_mechanism',
  mechanism: classroomLesson.mechanisms[0],
});
assert.equal(fittedReducerReplay.mechanisms[0].fabricationMetadata?.pathFit?.status, 'fit', 'ProjectState upsert preserves the certified fit and generated trace');
const fittedPathEdit = applyProjectAction(classroomLesson, {
  type: 'upsert_path',
  path: {
    ...classroomLesson.paths['path-right-arm'],
    points: classroomLesson.paths['path-right-arm'].points.map((point, index) =>
      index === 0 ? { ...point, x: point.x + 1 } : point,
    ),
  },
});
assert.equal(fittedPathEdit.mechanisms[0].fabricationMetadata?.pathFit?.status, 'unfitted', 'editing the authored path invalidates the previous certified fit metadata');
const wavingTraceSet = generateFoundryPlaybackPointTraces(wavingLessonMechanism, 96);
const wavingBoardHalfSpan = ((classroomLesson.settings.physicalKit.boardCells - 1) / 2)
  * classroomLesson.settings.physicalKit.gridPitchMm
  * SCENE_PX_PER_MM;
assert.equal(wavingTraceSet.percentValid, 1, 'waving-arm remains valid through the complete input rotation');
assert(
  wavingTraceSet.traces.flatMap(trace => trace.points).every(point =>
    Math.abs(point.x) <= wavingBoardHalfSpan + 1e-6 && Math.abs(point.y) <= wavingBoardHalfSpan + 1e-6
  ),
  'waving-arm keeps every moving pin inside the 15x15 board for the complete sweep',
);
for (const phase of [0, 0.37, 1.2, 3.14, 5.9]) {
  const state = calculateLinkage(wavingLessonMechanism, phase);
  const physicalTarget = mechanismTracePointForState(
    wavingLessonMechanism.type,
    state,
    wavingLessonMechanism.fabricationMetadata?.pathFit?.outputTraceId,
  );
  const pathTarget = pointOnProjectPath(classroomLesson.paths['path-right-arm'], phase);
  const preview = motionPreviewForProject(classroomLesson, [wavingLessonMechanism], phase);
  assert(state.isValid && physicalTarget && preview.target, `waving-arm has a physical Design target at phase ${phase}`);
  assert(Math.hypot(physicalTarget!.x - pathTarget.x, physicalTarget!.y - pathTarget.y) < 0.1, `waving-arm authored path follows the output pin at phase ${phase}`);
  assert(Math.hypot(preview.target!.x - physicalTarget!.x, preview.target!.y - physicalTarget!.y) < 1e-9, `waving-arm target binding follows the mechanism at phase ${phase}`);
  assert(Object.keys(preview.parts).length >= 3, `waving-arm moves the complete bound arm chain at phase ${phase}`);
}
const rejectedPreviewMechanism: MechanismConfig = {
  ...wavingLessonMechanism,
  fabricationMetadata: {
    ...wavingLessonMechanism.fabricationMetadata,
    pathFit: {
      ...wavingLessonMechanism.fabricationMetadata!.pathFit!,
      status: 'rejected',
    },
  },
  warnings: ['No fabrication-valid path fit.'],
};
const rejectedPreviewProject = { ...classroomLesson, mechanisms: [rejectedPreviewMechanism] };
const rejectedPhysicalState = calculateLinkage(rejectedPreviewMechanism, 0.75);
const rejectedPhysicalTarget = mechanismTracePointForState(
  rejectedPreviewMechanism.type,
  rejectedPhysicalState,
  rejectedPreviewMechanism.fabricationMetadata?.pathFit?.outputTraceId,
);
assert(Math.hypot(rejectedPhysicalTarget.x - rejectedPhysicalState.j2.x, rejectedPhysicalTarget.y - rejectedPhysicalState.j2.y) < 1e-9, 'missing fit metadata falls back to the visible primary output pin instead of an arbitrary coupler point');
const rejectedDesignPreview = motionPreviewForProject(rejectedPreviewProject, [rejectedPreviewMechanism], 0.75);
assert.equal(mechanismPathFitIsUsable(rejectedPreviewProject, rejectedPreviewMechanism), false, 'rejected path fit remains blocked from fabrication');
assert(rejectedDesignPreview.warnings?.[rejectedPreviewMechanism.id]?.includes('No fabrication-valid path fit.'), 'rejected path fit remains visible as a Design warning');
assert(rejectedDesignPreview.target && rejectedPhysicalTarget && Math.hypot(rejectedDesignPreview.target.x - rejectedPhysicalTarget.x, rejectedDesignPreview.target.y - rejectedPhysicalTarget.y) < 1e-9, 'fit warnings do not disconnect the bound character target from the physical mechanism');
const recommendationAuditProject: ProjectState = { ...classroomLesson, mechanisms: [], selectedMechanismId: undefined };
const wavingPathForRecommendations = recommendationAuditProject.paths['path-right-arm'];
const wavingRecommendations = buildMechanismRecommendations(recommendationAuditProject, recommendationAuditProject.parts[wavingPathForRecommendations.partId], wavingPathForRecommendations);
assert(wavingRecommendations.every(option => isMechanismTypeEnabled(option.type)), 'recommendations contain only currently enabled linkage and gear mechanisms');
assert(!wavingRecommendations.some(option => ['piston', 'cam', 'planetary_gear'].includes(option.type)), 'recommendations do not surface disabled mechanism combinations');
const wavingFourBarRecommendation = wavingRecommendations.find(option => option.type === '4bar');
assert(wavingFourBarRecommendation, 'recommendation audit keeps a four-bar card for the certified classroom hand-wave path');
assert.deepEqual(wavingFourBarRecommendation!.fabricationErrors, [], 'four-bar recommendation reuses the board-valid hand-wave path without a fit blocker');
assert.equal(wavingFourBarRecommendation!.mechanism.fabricationMetadata?.pathFit?.status, 'fit', 'four-bar recommendation records a physical path-fit state');
assert.equal(wavingFourBarRecommendation!.mechanism.fabricationMetadata?.pathFit?.outputTraceId, 'C', 'four-bar recommendation selects the physical output pin');
assert.deepEqual(validateForFabrication({ ...recommendationAuditProject, mechanisms: [wavingFourBarRecommendation!.mechanism] }).errors, [], 'four-bar recommendation remains fabrication-ready');
const occupiedAnchorRecommendations = buildMechanismRecommendations(classroomLesson, classroomLesson.parts[classroomLesson.selectedPartId!], classroomLesson.paths['path-right-arm']);
const occupiedFourBarRecommendation = occupiedAnchorRecommendations.find(option => option.type === '4bar');
assert.equal(occupiedFourBarRecommendation?.mechanism.targetPartId, 'right_arm_lower', 'recommendations retarget to the closest parent part when the hand anchor already has a driver');
assert.equal(occupiedFourBarRecommendation?.mechanism.targetAnchorJointId, 'right_hand', 'recommendation retarget keeps the hand end-effector for IK motion');
assert.deepEqual(validateForFabrication({ ...classroomLesson, mechanisms: [...classroomLesson.mechanisms, { ...occupiedFourBarRecommendation!.mechanism, id: 'recommendation-contract-4bar' }] }).errors, [], 'retargeted recommendation preserves the certified physical fit');
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
const assertGuidedPathUsesReach = (project: ProjectState, pathId: string, chainJointIds: string[], minMaxRatio = 0.7) => {
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
  assert(min >= reach * 0.25, `${pathId} keeps the template away from the root joint instead of collapsing onto the shoulder/hip`);
};
assertGuidedPathUsesReach(classroomLesson, 'path-right-arm', ['right_shoulder', 'right_elbow', 'right_hand'], 0.78);
const headBobLesson = createLessonProject('head-bob');
const headBobMechanism = headBobLesson.mechanisms[0];
assert(headBobMechanism, 'head-bob has a mechanism');
assert.equal(headBobMechanism.type, 'cam', 'head-bob guided theme creates a real cam mechanism baseline');
assert.equal(headBobLesson.selectedPathId, 'path-head-bob', 'head-bob guided theme creates an editable head lift path');
assert.equal(headBobLesson.paths['path-head-bob'].targetAnchorJointId, 'head_top', 'head-bob drives the top head joint instead of collapsing to the neck');
assert((headBobMechanism.anchorX ?? -Infinity) > Math.max(...headBobLesson.paths['path-head-bob'].points.map(point => point.x)), 'head-bob keeps the cam driver to the outside of the head path');
assertGuidedPathUsesReach(headBobLesson, 'path-head-bob', ['neck', 'head_top'], 0.45);
const walkingLegLesson = createLessonProject('walking-leg');
const walkingLegMechanism = walkingLegLesson.mechanisms[0];
assert(walkingLegMechanism, 'walking-leg has a mechanism');
assert.equal(walkingLegMechanism.type, '4bar', 'walking-leg guided theme creates a real four-bar mechanism baseline');
assert.equal(walkingLegLesson.selectedPathId, 'path-right-foot-step', 'walking-leg guided theme creates an editable foot path');
assert.equal(walkingLegLesson.paths['path-right-foot-step'].partId, 'right_foot_part', 'walking-leg drives the foot part instead of the lower leg plate');
assert.equal(walkingLegMechanism.targetPartId, 'right_foot_part', 'walking-leg mechanism binds to the foot part instead of the lower leg plate');
const walkingLegGround = calculateLinkage(walkingLegMechanism, 0);
assert.equal(sceneToBoardRaw({ x: walkingLegMechanism.anchorX!, y: walkingLegMechanism.anchorY! }, walkingLegLesson.settings.physicalKit).label, 'F13', 'walking-leg uses the certified F13 input pivot');
assert.equal(sceneToBoardRaw(walkingLegGround.p2, walkingLegLesson.settings.physicalKit).label, 'F5', 'walking-leg uses the certified F5 ground pivot');
assert.equal(walkingLegMechanism.groundAngle, 90, 'walking-leg keeps its fixed pivots on one board column');
assert.equal(walkingLegMechanism.fabricationMetadata?.pathFit?.status, 'fit', 'walking-leg ships a fabrication-valid physical output path');
assert.equal(walkingLegMechanism.fabricationMetadata?.pathFit?.outputTraceId, 'C', 'walking-leg binds the foot to the physical output pin');
const walkingTraceSet = generateFoundryPlaybackPointTraces(walkingLegMechanism, 96);
const walkingBoardHalfSpan = ((walkingLegLesson.settings.physicalKit.boardCells - 1) / 2)
  * walkingLegLesson.settings.physicalKit.gridPitchMm
  * SCENE_PX_PER_MM;
assert.equal(walkingTraceSet.percentValid, 1, 'walking-leg remains valid through the complete input rotation');
assert(
  walkingTraceSet.traces.flatMap(trace => trace.points).every(point =>
    Math.abs(point.x) <= walkingBoardHalfSpan + 1e-6 && Math.abs(point.y) <= walkingBoardHalfSpan + 1e-6
  ),
  'walking-leg keeps every moving pin inside the 15x15 board for the complete sweep',
);
assertGuidedPathUsesReach(walkingLegLesson, 'path-right-foot-step', ['right_hip', 'right_knee', 'right_foot'], 0.7);
const spinGearsLesson = createLessonProject('spin-gears');
assert.equal(spinGearsLesson.mechanisms[0]?.type, 'gear', 'spin-gears guided theme creates a real gear mechanism baseline');
assert.equal(spinGearsLesson.selectedPathId, 'path-gear-spin', 'spin-gears guided theme includes a visible hand path for Design/Assembly validation');
assert.equal(spinGearsLesson.mechanisms[0]?.targetPartId, 'right_hand_part', 'spin-gears lesson binds the gear motion to the hand part');
const spinGearCenters = gearTrainCenters(spinGearsLesson.mechanisms[0]);
const spinGearRightHandX = spinGearsLesson.skeleton?.joints.right_hand.position.x ?? 0;
assert.equal(spinGearsLesson.mechanisms[0]?.groundAngle, 180, 'spin-gears drives inward from the outside gear');
assert.deepEqual(spinGearsLesson.mechanisms[0]?.gearTrainRadii, [60, 20], 'spin-gears uses a large outside drive gear and a smaller moving gear near the hand');
assert(spinGearCenters[0].x > spinGearRightHandX && (spinGearCenters.at(-1)?.x ?? Infinity) <= spinGearRightHandX, 'spin-gears orders character, moving gear, then outside drive gear');
assert.throws(() => createLessonProject('missing' as never), /Unknown classroom lesson/, 'invalid classroom lesson IDs fail loudly instead of silently creating blank projects');
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
assert.deepEqual(motionChainRootJointIds(sample, 'right_arm_lower', 'right_hand'), ['right_shoulder', 'right_elbow', 'right_hand'], 'IK chain root choices expose every ancestor from part root to handle');
assert.deepEqual(motionChainRootJointIds(sample, 'right_hand_part', 'right_hand'), ['right_shoulder', 'right_elbow', 'right_hand'], 'hand targets can still drive the whole arm IK chain');
assert.deepEqual(motionChainRootJointIds(sample, 'right_foot_part', 'right_foot'), ['right_hip', 'right_knee', 'right_foot'], 'foot targets can still drive the whole leg IK chain');
assert.equal(preferredMotionJointId(sample, 'right_arm_lower', 'left_hand'), 'right_elbow', 'invalid IK anchor falls back to the target part root');

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
assert.equal(retargetedReplacement.paths['legacy-wave'].partId, 'right_arm_lower', 'character replacement retargets legacy whole-arm paths to the reachable lower-arm part');
assert.equal(retargetedReplacement.paths['legacy-wave'].targetAnchorJointId, 'right_hand', 'character replacement backfills path handles from the mechanism target anchor');
assert.equal(retargetedReplacement.paths['legacy-wave'].chainRootJointId, 'right_shoulder', 'character replacement preserves legacy part root as expanded IK chain root when new skeleton supports it');
assert.equal(retargetedReplacement.mechanisms[0].targetPartId, 'right_arm_lower', 'character replacement retargets existing mechanisms by target joint, not exact old part id');
assert.equal(retargetedReplacement.mechanisms[0].targetPathId, 'legacy-wave', 'character replacement keeps compatible mechanism-path binding');
assert.equal(retargetedReplacement.mechanisms[0].targetAnchorJointId, 'right_hand', 'character replacement preserves driven handle joint');
assert(Math.abs((retargetedReplacement.mechanisms[0].groundLength ?? 0) - coarsePrevious.mechanisms[0].groundLength) < 1e-9, 'same-size replacement keeps mechanism dimensions stable');
assert(retargetedReplacement.characterPackage?.replacementContext?.rebindingSummary.includes('1/1 mechanisms rebound'), 'character replacement records a concrete rebinding summary');
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
assert(Math.abs((scaledReplacement.mechanisms[0].groundLength ?? 0) - (coarsePrevious.mechanisms[0].groundLength ?? 0) * 1.5) < 1e-9, 'larger replacement scales mechanism link dimensions');
assert(Math.abs((scaledReplacement.mechanisms[0].anchorX ?? 0) - ((coarsePrevious.mechanisms[0].anchorX ?? 0) * 1.5)) < 1e-9, 'larger replacement repositions mechanism anchors with character scale');
assert(Math.abs(scaledReplacement.paths['legacy-wave'].points[0].x - (coarsePrevious.paths['legacy-wave'].points[0].x * 1.5)) < 1e-9, 'larger replacement scales retained path points around matching joints');
assert.deepEqual(SANITIZE_MECHANISM_TYPES, [...ALL_MECHANISM_TYPES], 'import sanitizer accepts every low-level mechanism template including crank');
const expectedReferenceAuthorableTypes: MechanismType[] = ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const expectedReferenceFoundryTypes: MechanismType[] = ['4bar', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
const expectedEnabledMechanismTypes: MechanismType[] = ['4bar', 'gear', 'gear_linkage'];
const unsupportedLegacyMechanismTypes: MechanismType[] = ['yoke', 'quick-return', 'rack-pinion', '5bar', '6bar'];
assert.deepEqual(AUTHORABLE_MECHANISM_TYPES, expectedReferenceAuthorableTypes, 'authorable mechanism types are exactly export-ready mechanism-reference recipes');
assert.deepEqual(REFERENCE_EXPORT_READY_TYPES, expectedReferenceAuthorableTypes, 'mechanism-reference export-ready types match the authoring contract');
assert.deepEqual(OPTIMIZER_MECHANISM_TYPES, expectedReferenceAuthorableTypes, 'optimizer searches export-ready mechanism-reference templates only');
assert.deepEqual(FOUNDRY_MECHANISM_TYPES, expectedReferenceFoundryTypes, 'Foundry-capable types preserve every fabrication-ready reference recipe');
assert.deepEqual(REFERENCE_FOUNDRY_TYPES, expectedReferenceFoundryTypes, 'mechanism-reference Foundry-capable types preserve imported-project compatibility');
assert.deepEqual(ENABLED_MECHANISM_TYPES, expectedEnabledMechanismTypes, 'new mechanism work is temporarily limited to linkage and gear families');
assert.deepEqual(ENABLED_AUTHORABLE_MECHANISM_TYPES, expectedEnabledMechanismTypes, 'Design exposes only enabled linkage and gear templates');
assert.deepEqual(ENABLED_FOUNDRY_MECHANISM_TYPES, expectedEnabledMechanismTypes, 'Foundry exposes only enabled linkage and gear templates');
assert(expectedEnabledMechanismTypes.every(isMechanismTypeEnabled), 'the mechanism availability predicate accepts every enabled type');
assert(['piston', 'cam', 'planetary_gear'].every(type => !isMechanismTypeEnabled(type as MechanismType)), 'disabled mechanism types stay out of new-work UI paths');
assert(!AUTHORABLE_MECHANISM_TYPES.includes('crank'), 'bare crank stays a low-level driver, not a novice authoring template');
assert.equal(REFERENCE_MECHANISM_RECIPES.piston.canonicalKey, 'slider_crank', 'piston maps to the mechanism-reference slider_crank recipe');
unsupportedLegacyMechanismTypes.forEach(type => {
  const recipe = referenceRecipeForType(type);
  assert.equal(recipe.exportReady, false, `${type} is not export-ready in mechanism-reference`);
  assert.equal(recipe.foundryVisible, false, `${type} is hidden from Foundry until a physical recipe exists`);
  assert.deepEqual(recipe.requiredParts, [], `${type} has no required fabrication parts without a reference recipe`);
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
  const prefabMechanism = createDefaultMechanism(type, `prefab-${type}-contract`);
  const prefabSteps = prefabAssemblySteps(prefabMechanism, recipe.assemblySteps[0].boardCoordinate);
  if (type === '4bar') {
    assert.equal(prefabSteps[0].coords?.[0], recipe.assemblySteps[0].coords[0], '4bar prefab keeps the placed main pivot from the reference recipe');
    assert.notEqual(prefabSteps[0].coords?.[1], prefabSteps[0].coords?.[0], '4bar prefab derives the second fixed pivot from the mechanism ground direction');
  } else {
    assert.deepEqual(
      prefabSteps.map(step => step.boardCoordinate),
      recipe.assemblySteps.map(step => step.boardCoordinate),
      `${type} prefab assembly keeps mechanism-reference board/moving coordinate semantics`
    );
  }
});
REFERENCE_EXPORT_READY_TYPES.forEach(type => {
  const mechanism = createDefaultMechanism(type, `board-hole-contract-${type}`);
  const referenceBoardCoordinate = referenceRecipeForType(type).assemblySteps[0]?.boardCoordinate ?? 'H8';
  const fixedHoles = boardFixedAssemblyCoordinatesForMechanism(mechanism, referenceBoardCoordinate, 15);
  assert(fixedHoles.length > 0, `${type} exposes at least one board-fixed assembly hole`);
  assert(fixedHoles.every(hole => isBoardCoordinateWithin(hole.coordinate, 15)), `${type} default board-fixed holes fit the 15x15 board`);
  assert.equal(offBoardFixedAssemblyCoordinatesForMechanism(mechanism, referenceBoardCoordinate, 15).length, 0, `${type} default board placement has no off-board fixed holes`);
  const edgeHoles = offBoardFixedAssemblyCoordinatesForMechanism(mechanism, 'O15', 15);
  assert(edgeHoles.length > 0, `${type} reports translated fixed holes that leave the board at O15`);
});
const movingHoleRecipe = prefabAssemblySteps(createDefaultMechanism('gear_linkage', 'moving-hole-role-contract'), 'H8', 15);
assert(movingHoleRecipe.some(step => step.coordRoles?.includes('gear_handle_reference')), 'gear-linkage assembly exposes moving gear-handle holes');
const movingHoleFixedCoordinates = boardFixedAssemblyCoordinatesForMechanism(createDefaultMechanism('gear_linkage', 'moving-hole-role-contract-fixed'), 'H8', 15);
assert(movingHoleFixedCoordinates.every(hole => isBoardFixedCoordRole(hole.role)), 'moving gear/link holes are excluded from board-fixed hole validation');
assert(!movingHoleFixedCoordinates.some(hole => hole.role === 'gear_handle_reference' || hole.role === 'link_end_reference'), 'moving gear/link roles never enter the board-fixed coordinate list');
const edgeCamForRecommendation = createDefaultMechanism('cam', 'recommendation-board-hole-contract');
const edgeCamBoardPoint = boardToScene(14, 14, sample.settings.physicalKit);
const fittedCamForRecommendation = fitRecommendedMechanismToSheet(sample, { ...edgeCamForRecommendation, anchorX: edgeCamBoardPoint.x, anchorY: edgeCamBoardPoint.y });
const fittedCamBoard = sceneToBoardRaw({ x: fittedCamForRecommendation.anchorX ?? Number.NaN, y: fittedCamForRecommendation.anchorY ?? Number.NaN }, sample.settings.physicalKit);
assert(fittedCamBoard.valid, 'sheet fitting keeps a recommendation anchor on a real board hole');
assert.equal(offBoardFixedAssemblyCoordinatesForMechanism(fittedCamForRecommendation, fittedCamBoard.label, sample.settings.physicalKit.boardCells).length, 0, 'recommendation sheet fitting keeps every fixed mechanism hole on the active board');
const shiftedPlanetarySteps = prefabAssemblySteps(createDefaultMechanism('planetary_gear', 'prefab-planetary-shifted'), 'J9');
assert.deepEqual(
  shiftedPlanetarySteps[1].coords,
  ['F9', 'J5', 'J13', 'N9'],
  'planetary assembly ring holes translate with the placed sun axle so Blueprint and Assembly share board coordinates'
);
const shiftedFourBarSteps = prefabAssemblySteps({
  ...createDefaultMechanism('4bar', 'prefab-fourbar-resized'),
  crankLength: linkageSceneLengthByCells(4),
  couplerLength: linkageSceneLengthByCells(6),
  rockerLength: linkageSceneLengthByCells(4)
}, 'H8');
assert(shiftedFourBarSteps.some(step => step.stack?.some(item => item.label === 'Input L4 linkage')), '4bar assembly stack labels follow edited input link size');
assert(shiftedFourBarSteps.some(step => step.stack?.some(item => item.label === 'Coupler L6 linkage')), '4bar assembly stack labels follow edited coupler link size');
const twoCellGroundFourBarSteps = prefabAssemblySteps({
  ...createDefaultMechanism('4bar', 'prefab-fourbar-ground-2'),
  groundLength: linkageSceneLengthByCells(2)
}, 'H8');
const sixCellGroundFourBarSteps = prefabAssemblySteps({
  ...createDefaultMechanism('4bar', 'prefab-fourbar-ground-6'),
  groundLength: linkageSceneLengthByCells(6)
}, 'H8');
assert.deepEqual(twoCellGroundFourBarSteps[0].coords, ['H8', 'J8'], '4bar Assembly places the second board pivot from the edited two-hole ground span and ground direction');
assert.deepEqual(sixCellGroundFourBarSteps[0].coords, ['H8', 'N8'], '4bar Assembly places the second board pivot from the edited six-hole ground span and ground direction');
assert.notDeepEqual(twoCellGroundFourBarSteps[0].coords, sixCellGroundFourBarSteps[0].coords, '4bar Assembly coordinates are derived from edited geometry instead of frozen recipe defaults');
const edgeFourBarSteps = prefabAssemblySteps({
  ...createDefaultMechanism('4bar', 'prefab-fourbar-edge'),
  groundLength: linkageSceneLengthByCells(6),
  crankLength: linkageSceneLengthByCells(4),
  couplerLength: linkageSceneLengthByCells(6),
  rockerLength: linkageSceneLengthByCells(4)
}, 'M15');
assert(edgeFourBarSteps.flatMap(step => (step.coords ?? []).filter((_, index) => !isBoardFixedCoordRole(step.coordRoles?.[index] ?? ''))).every(coord => !coord.startsWith('off-board')), '4bar Assembly keeps floating link references readable even when board pivots would exceed the 15x15 kit');
const idlerGearAssemblySteps = prefabAssemblySteps({
  ...createDefaultMechanism('gear', 'prefab-gear-idler'),
  crankLength: gearSceneRadiusByKey('g40'),
  rockerLength: gearSceneRadiusByKey('g24'),
  gearTrainRadii: [gearSceneRadiusByKey('g40'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g24')]
}, 'H8');
assert(idlerGearAssemblySteps.some(step => /idler/i.test(step.label) && step.coords?.length === 1 && step.coordRoles?.[0] === 'board'), 'gear train Assembly adds board-snapped idler gear steps when the gear train has middle gears');
assert(idlerGearAssemblySteps.filter(step => step.coordRoles?.some(isBoardFixedCoordRole)).length >= 3, 'gear train Assembly exposes drive, idler, and output build spots to Blueprint');
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
assert(referenceRecipeForType('planetary_gear').stackLabels.includes('L2 carrier linkage'), 'planetary stack labels the L2 part as the carrier so renderers do not draw a generic floating linkage');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add connecting rod')?.stack[0]?.role, 'link-joint-hole', 'slider-crank G6 rod joint is a floating link joint');
assert.equal(referenceRecipeForType('piston').assemblySteps.find(step => step.label === 'Add slider block')?.stack[0]?.role, 'link-end-hole', 'slider-crank block is a moving slider/link reference');
const previewReadyTypes: MechanismType[] = ['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear'];
previewReadyTypes.forEach(type => {
  const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `preview-ready-${type}`)));
  assert.deepEqual(validateMechanismPreviewReadiness(mechanism), [], `${type} default mechanism is preview-ready before Foundry/Design can render it`);
});
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
const reducerSnappedProject = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: reducerUnsnappedFourBar });
const reducerSnappedFourBar = reducerSnappedProject.mechanisms.find(mechanism => mechanism.id === 'reducer-snaps-fourbar');
assert(reducerSnappedFourBar, 'mechanism reducer stores inserted four-bar');
assert.deepEqual(validateMechanismPreviewReadiness(reducerSnappedFourBar), [], 'upserted four-bar mechanisms are snapped to fabrication hole/linkage lengths before storage');
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
assert.equal(feasibilityStatusForRange({ percentValid: 1, warning: null }), 'valid', 'feasible-range status marks a complete sweep as valid');
assert.equal(feasibilityStatusForRange({ percentValid: 0.5, warning: 'Motion 50% · 0°–180°' }), 'may-jam', 'feasible-range status marks a partial sweep as may jam');
assert.equal(feasibilityStatusForRange({ percentValid: 0, warning: 'No motion' }), 'no-motion', 'feasible-range status marks an empty sweep as no motion');
assert.equal(feasibilityLabelForStatus('valid'), 'Valid', 'feasibility status exposes a novice-readable valid label');
assert.equal(feasibilityLabelForStatus('may-jam'), 'May jam', 'feasibility status exposes a novice-readable partial-motion label');
assert.equal(feasibilityLabelForStatus('no-motion'), 'No motion', 'feasibility status exposes a novice-readable blocked label');
assert.equal(readinessPhysicalTolerance(100), 3, 'fabricationReadiness preserves physical tolerance scaling');
assert(readinessClosePhysicalValue(103, 100), 'fabricationReadiness preserves close physical value checks at tolerance boundary');
assert(readinessCloseToBoardPitch(roleMinimumFourBar.groundLength), 'fabricationReadiness preserves board-pitch snapping checks');
assert(readinessCloseToFabricationLinkage(roleMinimumFourBar.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler), 'fabricationReadiness preserves fabrication linkage snapping checks');
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
  assert.deepEqual(feature.fabricationStack(mechanism), fabricationStackForMechanism(mechanism), `${type} feature stack uses canonical fabrication helper`);
  assert.equal(feature.fabricationPlan(mechanism).roleSummary, fabricationRenderPlanForMechanism(mechanism).roleSummary, `${type} feature render plan uses canonical fabrication helper`);
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
const sampleMechanismId = sample.mechanisms[0].id;
const snapshotBeforeProject = serializeProject(sample);
const snapshotA = buildMechanismSnapshot(sample, sampleMechanismId);
const snapshotB = buildMechanismSnapshot(sample, sampleMechanismId);
assert(snapshotA && snapshotB, 'mechanism snapshot builder returns a snapshot for an existing mechanism id');
assert.deepEqual(snapshotA, snapshotB, 'mechanism snapshot builder is deterministic for the same project and mechanism');
assert.equal(serializeProject(sample), snapshotBeforeProject, 'mechanism snapshot builder does not mutate ProjectState');
assert(Object.isFrozen(snapshotA) && Object.isFrozen(snapshotA.fabricationPlan.layers), 'mechanism snapshot is recursively frozen for adapter safety');
assert.equal(snapshotA.sourceIds.mechanismId, sampleMechanismId, 'mechanism snapshot records mechanism source id');
assert(snapshotA.feasibleRange.percentValid >= 0 && snapshotA.feasibleRange.percentValid <= 1, 'mechanism snapshot includes feasible range');
assert(snapshotA.interactionPolicy.writesProjectState, 'mechanism snapshot includes interaction policy');
assert(snapshotA.projectionHints.every(hint => hint.zStackUsesFabricationPlan), 'mechanism snapshot includes fabrication-backed projection hints');
assert(snapshotA.physicsHints.every(hint => hint.preservesProjectState), 'mechanism snapshot includes derived physics hints');
assert(Array.isArray(snapshotA.fabricationPlan.validationErrors), 'mechanism snapshot includes fabrication plan validation result');
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
    targetPartId: 'right_arm_lower',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm_lower']
  }))
};
const allMechanismSnapshots = buildMechanismSnapshots(allMechanismSnapshotProject);
assert.equal(allMechanismSnapshots.length, ALL_MECHANISM_TYPES.length, 'snapshot builder covers every mechanism type');
allMechanismSnapshots.forEach(snapshot => {
  assert.equal(snapshot.version, 1, `${snapshot.mechanism.type} snapshot carries schema version`);
  assert(snapshot.fingerprint.startsWith('ms-'), `${snapshot.mechanism.type} snapshot carries a stable fingerprint`);
  assert(Array.isArray(snapshot.fabricationPlan.validationErrors), `${snapshot.mechanism.type} snapshot carries fabrication validation results`);
  assert(snapshot.projectionHints.length > 0 && snapshot.physicsHints.length > 0, `${snapshot.mechanism.type} snapshot carries adapter hints`);
});
const goldenSample = createFabricationReadyFourBarProject();
const goldenLesson = createLessonProject('waving-arm');
const goldenSnapshot = buildMechanismSnapshot(goldenSample, goldenSample.mechanisms[0].id);
assert(goldenSnapshot, 'golden master sample has a mechanism snapshot');
const goldenAllMechanismSnapshots = buildMechanismSnapshots({
  ...goldenSample,
  mechanisms: ALL_MECHANISM_TYPES.map(type => ({
    ...createDefaultMechanism(type, `${type}-snapshot`),
    targetPartId: 'right_arm_lower',
    targetPathId: 'fabrication-fit-path',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_arm_lower']
  }))
});
const goldenExportConfig = {
  speed: goldenSample.settings.animationSpeed,
  rotation: 0,
  mechanisms: goldenSample.mechanisms
};
const goldenMaster = {
  project: JSON.parse(serializeProject(stableProjectForGoldenMaster(goldenSample))),
  lesson: JSON.parse(serializeProject(stableProjectForGoldenMaster(goldenLesson))),
  mechanismSnapshot: stableMechanismSnapshotForGoldenMaster(goldenSnapshot),
  allMechanismSnapshots: goldenAllMechanismSnapshots.map(stableMechanismSnapshotForGoldenMaster),
  sceneProjection: buildToonSceneProjection(goldenSample),
  svg: generateSVG(goldenExportConfig, Math.PI / 4),
  dxf: generateDXF(goldenExportConfig, Math.PI / 4),
  fabricationRecipes: createFabricationPackage(goldenSample).recipes,
  foundryRenderPlans: ALL_MECHANISM_TYPES.map(type => fabricationRenderPlanForMechanism(createDefaultMechanism(type, `${type}-golden`))),
  stacks: goldenSample.mechanisms.map(fabricationStackForMechanism)
};
assert.deepEqual(
  Object.fromEntries(Object.entries(goldenMaster).map(([key, value]) => [key, goldenMasterHash(value)])),
  {
    project: '313706e17f200518b12a7870842f8cd411bda133f426ecae0a5a764a2f907f37',
    lesson: '65ca58904c584e0241a0ee3685dc9153248b2630d56d3bcbe137f04026f40abd',
    mechanismSnapshot: '25f57f11023993ac2623d6863ee5528573befa68c3053ae4bfbb5b6e20db65a7',
    allMechanismSnapshots: '16a8a3b3c54f3352926b56a69ce65da46a027d993eb44556ba3705ab5ee18f09',
    sceneProjection: '84e51e7b708660831a8a7bb540fe9bea2f61807841f3e7dafe17c6fe44350dba',
    svg: '019130009c927ba6d352a37813a1d3e473809c2959aecd1c02a52e58bcdaf550',
    dxf: '0999b4186e4f7a4c69ea5ef8cdbb1226f26a72882e455bd145a20b1c82776fb0',
    fabricationRecipes: '8ad618aa81fd968847df7c2698ebe285b2a812e284cf7178c6e58180fafbd40b',
    foundryRenderPlans: '089b7d2e9163cc070923923f9e1e56382ab7c1d14aa8157a8c85eebc801d72c6',
    stacks: 'e55cc135c765896c41713823fdc9f831249073038e52bbdf9cc2a70f9690976f'
  },
  'golden master locks ProjectState, mechanism snapshot, scene projection, export, and fabrication stack behavior before App.tsx refactors'
);
assert.deepEqual(directCreateFabricationRecipe(goldenSample, goldenSample.mechanisms[0]), createFabricationPackage(goldenSample).recipes[0], 'fabricationRecipes preserves package recipe output behind the fabrication facade');
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
assert(loadedSetOnlyGear.gearTrainRadii?.every(gearSceneRadiusIsFabricationPreset), 'loaded gear snapshots snap every gear radius to the fabrication gear set');
assert.equal(loadedSetOnlyGear.groundLength, gearTrainPitchCenterDistance(loadedSetOnlyGear), 'loaded gear snapshots derive center span from snapped gear radii');
const loadedSetOnlyFourBar = loadProjectSnapshot({
  ...createEmptyProject(),
  mechanisms: [{
    ...createDefaultMechanism('4bar', 'loaded-fourbar-set-only'),
    crankLength: 53,
    couplerLength: 119,
    rockerLength: 177
  }]
}).mechanisms[0];
assert(linkageSceneLengthIsFabricationPreset(loadedSetOnlyFourBar.crankLength), 'loaded four-bar snapshots snap input length to the fabricated linkage set');
assert(linkageSceneLengthIsFabricationPreset(loadedSetOnlyFourBar.couplerLength), 'loaded four-bar snapshots snap coupler length to the fabricated linkage set');
assert(linkageSceneLengthIsFabricationPreset(loadedSetOnlyFourBar.rockerLength), 'loaded four-bar snapshots snap output length to the fabricated linkage set');
type FabricationManifest = {
  generated_by: string;
  source_ssot: string;
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
  cam_modules: Array<{ key: string; label: string; engraving_label: string; path: string; module_kind: string; hole_diameter_mm: number; hole_count: number; hole_centers_mm: number[][]; contract: string }>;
  spacers: Array<{ key: string; label: string; engraving_label: string; path: string; outer_diameter_mm: number; inner_diameter_mm: number; hole_diameter_mm: number; hole_centers_mm: number[][]; stackable: boolean }>;
  };
};
const fabricationManifest = JSON.parse(readFileSync(join(process.cwd(), 'fabrication', 'manifest.json'), 'utf8')) as FabricationManifest;
const fabricationManifestSnapshot = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'mechanism-reference', 'source', 'fabrication-manifest.snapshot.json'), 'utf8')) as FabricationManifest;
const fabricationGeneratorPath = join(process.cwd(), 'fabrication', 'generate_fabrication_templates.py');
assert(existsSync(fabricationGeneratorPath), 'fabrication generator lives beside the generated package');
const fabricationGeneratorText = readFileSync(fabricationGeneratorPath, 'utf8');
assert(fabricationGeneratorText.includes('DEFAULT_GRID_PITCH_MM = 20.0'), 'fabrication generator owns the 20 mm board pitch convention');
assert(fabricationGeneratorText.includes('hole_diameter_mm=4.0'), 'fabrication generator owns the 4 mm hole convention');
assert(fabricationGeneratorText.includes('GEAR_ROOT_WEB_MM = 6.0'), 'fabrication generator keeps gear root webs thin enough for 8T mesh clearance');
assert(fabricationGeneratorText.includes('GearPreset("g24", "G3 / 3-space gear", 24)'), 'fabrication generator owns the G24 gear preset used by renderers');
assert(fabricationGeneratorText.includes('FollowerPreset("f4-roller"'), 'fabrication generator owns the roller follower preset used by Foundry');
assert(fabricationGeneratorText.includes('SOURCE_SSOT = "fabrication/generate_fabrication_templates.py"'), 'fabrication manifest source points at the checked-in generator');
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
const simplePdfSourceText = readFileSync(join(process.cwd(), 'utils', 'simplePdf.ts'), 'utf8');
const fabricationCharacterPrintLayoutText = readFileSync(join(process.cwd(), 'utils', 'fabricationCharacterPrintLayout.ts'), 'utf8');
const fabricationContractText = readFileSync(join(process.cwd(), 'utils', 'fabricationContract.ts'), 'utf8');
const numberFormatText = readFileSync(join(process.cwd(), 'utils', 'numberFormat.ts'), 'utf8');
const staticImportModules = (source: string) => Array.from(new Set([
  ...[...source.matchAll(/^\s*import(?:\s+type)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)].map(match => match[1]),
  ...[...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
])).sort();
assert(fabricationContractText.includes(FABRICATION_SOURCE_SSOT), 'runtime fabrication contract declares the Python generator as source of truth');
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
  && !fabricationStackModelText.includes("from './fabrication'"),
  'fabricationStackModel owns stack modeling without importing the broad fabrication facade'
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
  'validateFabricationStack',
  'fabricationRenderPlanForMechanism',
  'document.',
  'window.',
  'localStorage',
  'createElement'
].forEach(forbiddenText => {
  assert(!fabricationStackModelText.includes(forbiddenText), `fabricationStackModel stays stack-only and must not reference ${forbiddenText}`);
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
assert(
  fabricationRenderPlanText.includes("from './fabricationContract'")
  && fabricationRenderPlanText.includes("from './fabricationStackModel'")
  && fabricationRenderPlanText.includes("from './mechanismReference'")
  && !fabricationRenderPlanText.includes("from './fabrication'"),
  'fabricationRenderPlan owns stack validation and z-order plans without importing the broad fabrication facade'
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
  ['../types', './coordinates', './fabricationContract', './fabricationReadiness', './fabricationRenderPlan', './fabricationStackModel', './kinematics', './mechanismReference', './motion'].sort(),
  'fabricationRecipes owns package recipe derivation with an exact focused import set'
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
  ['../types', './coordinates', './fabricationCharacterPrintLayout', './fabricationContract', './kinematics', './mechanismReference', './numberFormat', './partGeometry'].sort(),
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
assert.equal(fabricationManifest.generated_by, 'fabrication/generate_fabrication_templates.py', 'fabrication manifest generated_by matches the checked-in generator');
assert.equal(fabricationManifest.source_ssot, 'fabrication/generate_fabrication_templates.py', 'fabrication manifest source_ssot matches the checked-in generator');
assert.deepEqual(fabricationManifestSnapshot, fabricationManifest, 'mechanism reference fabrication snapshot mirrors fabrication/manifest.json');
const fabricationSvgManagedFiles = fabricationManifest.managed_files.filter(path => path.endsWith('.svg'));
const assertSvgFilesParseAsXml = (rootDir: string, relPaths: string[], label: string) => {
  assert(relPaths.length > 0, `${label} has managed SVG files to parse`);
  execFileSync('python3', [
    '-c',
    'from pathlib import Path\nimport sys, xml.etree.ElementTree as ET\nroot = Path(sys.argv[1])\nfor rel in sys.argv[2:]:\n    ET.parse(root / rel)\n',
    rootDir,
    ...relPaths
  ], { cwd: process.cwd(), stdio: 'pipe' });
};
assertSvgFilesParseAsXml(join(process.cwd(), 'fabrication'), fabricationSvgManagedFiles, 'committed fabrication package');

const mainBoardSvg = readFileSync(join(process.cwd(), 'fabrication', 'board.svg'), 'utf8');
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
assert.equal(attr(mainBoardTag, 'data-board-role'), 'main-board', 'fabrication/board.svg is the main board asset');
assert.equal(attr(mainBoardTag, 'data-grid-columns'), '15', 'main board declares 15 columns');
assert.equal(attr(mainBoardTag, 'data-grid-rows'), '15', 'main board declares 15 rows');
assert.equal(attr(mainBoardTag, 'data-grid-pitch-mm'), '20', 'main board declares 20mm pitch');
assert.equal(attr(mainBoardTag, 'data-hole-diameter-mm'), '4', 'main board declares 4mm holes');
assert.deepEqual(attr(mainBoardTag, 'viewBox').split(/\s+/).map(Number), [0, 0, boardWidthMm, boardHeightMm], 'main board viewBox matches its millimeter size');
assert(mainBoardSvg.includes('#0071bc'), 'main board uses blue engraving color');
assert(!mainBoardSvg.includes('#ed1c24'), 'main board no longer uses red-only cut styling');
const mainBoardCircleTags = [...mainBoardSvg.matchAll(/<circle\b[^>]*class="[^"]*\bdrill board-hole\b[^"]*"[^>]*>/g)].map(match => match[0]);
assert.equal(mainBoardCircleTags.length, 225, 'main board has exactly 225 board holes');
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
const generatedFabricationDir = mkdtempSync(join(tmpdir(), 'motionsmith-fabrication-'));
try {
  execFileSync('python3', [fabricationGeneratorPath, '--output', generatedFabricationDir], { cwd: process.cwd(), stdio: 'pipe' });
  const generatedManifest = JSON.parse(readFileSync(join(generatedFabricationDir, 'manifest.json'), 'utf8')) as FabricationManifest;
  assert.equal(generatedManifest.grid_pitch_mm, fabricationManifest.grid_pitch_mm, 'generator reproduces the committed grid pitch');
  assert.equal(generatedManifest.hole_diameter_mm, fabricationManifest.hole_diameter_mm, 'generator reproduces the committed hole diameter');
  assert.equal(generatedManifest.generated_by, 'fabrication/generate_fabrication_templates.py', 'regenerated manifest keeps the checked-in generator path');
  assert.equal(generatedManifest.source_ssot, 'fabrication/generate_fabrication_templates.py', 'regenerated manifest keeps the checked-in source-of-truth path');
  (['gears', 'linkages', 'ring_gears', 'cams', 'followers', 'brackets', 'handles', 'spacers', 'cam_modules'] as const).forEach(category => {
    assert.deepEqual(generatedManifest.parts[category], fabricationManifest.parts[category], `regenerated ${category} primitives match the committed fabrication contract`);
  });
  assert.deepEqual(generatedManifest.managed_files, fabricationManifest.managed_files, 'regenerated fabrication package contains the committed managed-file set');
  fabricationManifest.managed_files.forEach(relPath => {
    assert.equal(
      readFileSync(join(generatedFabricationDir, relPath), 'utf8'),
      readFileSync(join(process.cwd(), 'fabrication', relPath), 'utf8'),
      `generator emits committed fabrication asset ${relPath}`
    );
  });
  assertSvgFilesParseAsXml(generatedFabricationDir, fabricationSvgManagedFiles, 'regenerated fabrication package');
} finally {
  rmSync(generatedFabricationDir, { recursive: true, force: true });
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
assert.equal(FABRICATION_LINKAGE_WIDTH_MM, 14, 'runtime linkage width is centralized from the Python generator convention');
assert.equal(FABRICATION_HOLE_RADIUS_MM, 2, 'runtime hole radius is centralized from the Python generator convention');
assert.equal(fabricationBoardColumnLabel(0), 'A', 'fabrication board columns use A-O labels');
assert.equal(fabricationBoardColumnLabel(14), 'O', 'fabrication board columns end at O on the 15x15 board');
assert.equal(fabricationBoardRowLabel(0), '1', 'fabrication board rows use 1-15 labels');
assert.equal(fabricationBoardRowLabel(14), '15', 'fabrication board rows end at 15 on the 15x15 board');
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
assert.equal(g24Profile.source, FABRICATION_SOURCE_SSOT, 'gear profile declares the Python generator source');
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
const assemblyWorkbenchText = [assemblySceneFrameComponentText, assemblySceneFrameText, mechanismSceneContractText].join('\n');
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
const partArtMaterialText = readFileSync(join(process.cwd(), 'runtime', 'render', 'partArtMaterial.ts'), 'utf8');
const puppetSceneDisposalText = readFileSync(join(process.cwd(), 'runtime', 'render', 'puppetSceneDisposal.ts'), 'utf8');
const puppetPartTopologyText = readFileSync(join(process.cwd(), 'runtime', 'render', 'puppetPartTopology.ts'), 'utf8');
const exporterText = readFileSync(join(process.cwd(), 'utils', 'exporter.ts'), 'utf8');
const physicsSessionText = readFileSync(join(process.cwd(), 'utils', 'physicsSession.ts'), 'utf8');
const mechanismPreviewText = readFileSync(join(process.cwd(), 'utils', 'mechanismPreview.ts'), 'utf8');
const viewportText = readFileSync(join(process.cwd(), 'utils', 'viewport.ts'), 'utf8');
const viewer3dText = readFileSync(join(process.cwd(), 'utils', 'viewer3d.ts'), 'utf8');
const foundryCameraText = readFileSync(join(process.cwd(), 'utils', 'foundryCamera.ts'), 'utf8');
const mechanismRecommendationsText = readFileSync(join(process.cwd(), 'utils', 'mechanismRecommendations.ts'), 'utf8');
const stageLayoutText = readFileSync(join(process.cwd(), 'components', 'stages', 'stageLayout.tsx'), 'utf8');
const partInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'PartInspector.tsx'), 'utf8');
const cutOutlineEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CutOutlineEditorDialog.tsx'), 'utf8');
const skeletonInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'SkeletonInspector.tsx'), 'utf8');
const characterImportOverlaysText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterImportOverlays.tsx'), 'utf8');
const characterLessonOwnershipText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterLessonOwnership.tsx'), 'utf8');
const characterSetupPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterSetupPanel.tsx'), 'utf8');
const characterImportControlsText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterImportControls.tsx'), 'utf8');
const characterSelectionText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'CharacterSelection.tsx'), 'utf8');
const sceneObjectInspectorText = readFileSync(join(process.cwd(), 'components', 'stages', 'character', 'SceneObjectInspector.tsx'), 'utf8');
const sceneObjectImagePolicyText = readFileSync(join(process.cwd(), 'runtime', 'import', 'sceneObjectImagePolicy.ts'), 'utf8');
const sceneObjectImageJobText = readFileSync(join(process.cwd(), 'runtime', 'import', 'sceneObjectImageJob.ts'), 'utf8');
const sceneObjectImageWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'import', 'sceneObjectImageWorkerClient.ts'), 'utf8');
const sceneObjectImageWorkerText = readFileSync(join(process.cwd(), 'workers', 'sceneObjectImageWorker.ts'), 'utf8');
const pathEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PathEditor.tsx'), 'utf8');
const mechanismRecommendationSheetText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'MechanismRecommendationSheet.tsx'), 'utf8');
const recommendationMechanismSketchText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'RecommendationMechanismSketch.tsx'), 'utf8');
const mechanismRecommendationJobText = readFileSync(join(process.cwd(), 'runtime', 'recommendations', 'mechanismRecommendationJob.ts'), 'utf8');
const mechanismRecommendationWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'recommendations', 'mechanismRecommendationWorkerClient.ts'), 'utf8');
const mechanismRecommendationWorkerText = readFileSync(join(process.cwd(), 'workers', 'mechanismRecommendationWorker.ts'), 'utf8');
const mechanismFitJobText = readFileSync(join(process.cwd(), 'runtime', 'fitting', 'mechanismFitJob.ts'), 'utf8');
const mechanismFitWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'fitting', 'mechanismFitWorkerClient.ts'), 'utf8');
const mechanismFitWorkerText = readFileSync(join(process.cwd(), 'workers', 'mechanismFitWorker.ts'), 'utf8');
const mechanismOptimizerJobText = readFileSync(join(process.cwd(), 'runtime', 'optimizer', 'mechanismOptimizerJob.ts'), 'utf8');
const mechanismOptimizerWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'optimizer', 'mechanismOptimizerWorkerClient.ts'), 'utf8');
const mechanismOptimizerWorkerText = readFileSync(join(process.cwd(), 'workers', 'mechanismOptimizerWorker.ts'), 'utf8');
const trackingMediaPolicyText = readFileSync(join(process.cwd(), 'runtime', 'media', 'trackingMediaPolicy.ts'), 'utf8');
const gifFrameSessionText = readFileSync(join(process.cwd(), 'runtime', 'media', 'gifFrameSession.ts'), 'utf8');
const gifFrameWorkerText = readFileSync(join(process.cwd(), 'workers', 'gifFrameWorker.ts'), 'utf8');
const mechanismParametricEditorText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'MechanismParametricEditor.tsx'), 'utf8');
const inspectorControlsText = readFileSync(join(process.cwd(), 'components', 'ui', 'InspectorControls.tsx'), 'utf8');
const mechanismInspectorAnalysisText = readFileSync(join(process.cwd(), 'utils', 'mechanismInspectorAnalysis.ts'), 'utf8');
const mechanismParamPolicyText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'mechanismParamPolicy.ts'), 'utf8');
const pathCanvasPaneText = readFileSync(join(process.cwd(), 'components', 'stages', 'path', 'PathCanvasPane.tsx'), 'utf8');
const appText = appCommandSource;
const appWorkspaceShellText = readFileSync(join(process.cwd(), 'components', 'AppWorkspaceShell.tsx'), 'utf8');
const appStageRouterText = readFileSync(join(process.cwd(), 'components', 'AppStageRouter.tsx'), 'utf8');
const appDerivedStateHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppDerivedState.ts'), 'utf8');
const workspacePlayerDockHookText = readFileSync(join(process.cwd(), 'hooks', 'useWorkspacePlayerDock.tsx'), 'utf8');
const workspacePlaybackLoopHookText = readFileSync(join(process.cwd(), 'hooks', 'useWorkspacePlaybackLoop.ts'), 'utf8');
const externalPlaybackClockText = readFileSync(join(process.cwd(), 'runtime', 'playback', 'externalPlaybackClock.ts'), 'utf8');
const b695PlaybackTestText = readFileSync(join(process.cwd(), 'tests', 'b695-playback.test.ts'), 'utf8');
const motionText = readFileSync(join(process.cwd(), 'utils', 'motion.ts'), 'utf8');
const b695FrameTestText = readFileSync(join(process.cwd(), 'tests', 'b695-frame.test.ts'), 'utf8');
const b695FitTestText = readFileSync(join(process.cwd(), 'tests', 'b695-fit.test.ts'), 'utf8');
const blueprintModelRuntimeText = readFileSync(join(process.cwd(), 'runtime', 'blueprint', 'BlueprintModel.ts'), 'utf8');
const blueprintPackageWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'blueprint', 'blueprintPackageWorkerClient.ts'), 'utf8');
const blueprintPackageTransferText = readFileSync(join(process.cwd(), 'runtime', 'blueprint', 'blueprintPackageTransfer.ts'), 'utf8');
const blueprintPackageWorkerText = readFileSync(join(process.cwd(), 'workers', 'blueprintPackageWorker.ts'), 'utf8');
const b695BlueprintTestText = readFileSync(join(process.cwd(), 'tests', 'b695-blueprint.test.ts'), 'utf8');
const studyArtifactText = readFileSync(join(process.cwd(), 'infrastructure', 'study-final', 'artifact.ts'), 'utf8');
const finalStudyHookText = readFileSync(join(process.cwd(), 'hooks', 'useFinalStudyArtifact.ts'), 'utf8');
const b695StudyTestText = readFileSync(join(process.cwd(), 'tests', 'b695-study.test.ts'), 'utf8');
const modalInertHookText = readFileSync(join(process.cwd(), 'hooks', 'useModalInertEffect.ts'), 'utf8');
const appPathActionsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppPathActions.ts'), 'utf8');
const appCharacterImportActionsHookText = readFileSync(join(process.cwd(), 'hooks', 'useAppCharacterImportActions.ts'), 'utf8');
const projectImportPolicyText = readFileSync(join(process.cwd(), 'runtime', 'import', 'projectImportPolicy.ts'), 'utf8');
const projectImportWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'import', 'projectImportWorkerClient.ts'), 'utf8');
const projectImportWorkerText = readFileSync(join(process.cwd(), 'workers', 'projectImportWorker.ts'), 'utf8');
const packageLoaderText = readFileSync(join(process.cwd(), 'utils', 'packageLoader.ts'), 'utf8');
const indexTsxText = readFileSync(join(process.cwd(), 'index.tsx'), 'utf8');
const appAutosaveHookText = readFileSync(join(process.cwd(), 'hooks', 'useProjectAutosave.ts'), 'utf8');
const coldAutosaveRecoveryHookText = readFileSync(join(process.cwd(), 'hooks', 'useColdAutosaveRecovery.ts'), 'utf8');
const projectPersistenceText = readFileSync(join(process.cwd(), 'utils', 'projectPersistence.ts'), 'utf8');
const projectAutosaveFormatText = readFileSync(join(process.cwd(), 'utils', 'projectAutosaveFormat.ts'), 'utf8');
const projectAutosaveTransactionsText = readFileSync(join(process.cwd(), 'utils', 'projectAutosaveTransactions.ts'), 'utf8');
const autosaveTransactionText = readFileSync(join(process.cwd(), 'runtime', 'persistence', 'autosaveTransaction.ts'), 'utf8');
const autosaveIndexedDbText = readFileSync(join(process.cwd(), 'runtime', 'persistence', 'autosaveIndexedDb.ts'), 'utf8');
const autosaveWorkerText = readFileSync(join(process.cwd(), 'runtime', 'persistence', 'autosaveWorker.ts'), 'utf8');
const autosaveRecoveryWorkerClientText = readFileSync(join(process.cwd(), 'runtime', 'persistence', 'autosaveRecoveryWorkerClient.ts'), 'utf8');
const autosaveRecoveryWorkerText = readFileSync(join(process.cwd(), 'workers', 'autosaveRecoveryWorker.ts'), 'utf8');
const projectSerializationText = readFileSync(join(process.cwd(), 'utils', 'projectSerialization.ts'), 'utf8');
const autosaveFingerprintText = readFileSync(join(process.cwd(), 'utils', 'autosaveFingerprint.ts'), 'utf8');
const mechanismDesignText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'MechanismDesign.tsx'), 'utf8');
const collectComponentSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectComponentSourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
const designFoundryPreviewText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'DesignFoundryPreview.tsx'), 'utf8');
const automataSceneModelText = readFileSync(join(process.cwd(), 'utils', 'automataSceneModel.ts'), 'utf8');
const designWorkflowPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'mechanism', 'DesignWorkflowPanel.tsx'), 'utf8');
const workflowSpecText = readFileSync(join(process.cwd(), 'tests', 'browser', 'workflow.spec.ts'), 'utf8');
const webglRecoverySpecText = readFileSync(join(process.cwd(), 'tests', 'browser', 'webgl-recovery.spec.ts'), 'utf8');
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
const foundryThreeObjectPoolText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryThreeObjectPool.ts'), 'utf8');
const foundryThreeRenderLayersText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryThreeRenderLayers.ts'), 'utf8');
const foundryAssemblySceneOverlayText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryAssemblySceneOverlay.ts'), 'utf8');
const renderPerformancePolicyText = readFileSync(join(process.cwd(), 'utils', 'renderPerformancePolicy.ts'), 'utf8');
const cadencedPlaybackSamplerText = readFileSync(join(process.cwd(), 'runtime', 'playback', 'cadencedPlaybackSampler.ts'), 'utf8');
const threeResourceKitText = readFileSync(join(process.cwd(), 'utils', 'threeResourceKit.ts'), 'utf8');
const foundryRenderInventoryText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryRenderInventory.ts'), 'utf8');
const foundryPreviewStacksText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryPreviewStacks.ts'), 'utf8');
const mechanismFoundryText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'MechanismFoundry.tsx'), 'utf8');
const foundryHandleGestureText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'foundryHandleGesture.ts'), 'utf8');
const foundryCanvasPaneText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryCanvasPane.tsx'), 'utf8');
const foundryCanvasChromeText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryCanvasChrome.tsx'), 'utf8');
const foundryOverlayLayerText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryOverlayLayer.tsx'), 'utf8');
const foundryWorkflowPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryWorkflowPanel.tsx'), 'utf8');
const foundryInspectorPanelText = readFileSync(join(process.cwd(), 'components', 'stages', 'foundry', 'FoundryInspectorPanel.tsx'), 'utf8');
const foundryStageText = `${mechanismFoundryText}
${foundryCanvasPaneText}
${foundryCanvasChromeText}
${foundryOverlayLayerText}
${foundryWorkflowPanelText}
${foundryInspectorPanelText}`;
const optionsText = readFileSync(join(process.cwd(), 'components', 'stages', 'options', 'Options.tsx'), 'utf8');
const optionsSettingsControlsText = readFileSync(join(process.cwd(), 'components', 'stages', 'options', 'OptionsSettingsControls.tsx'), 'utf8');
const foundry3dText = `${foundryStageText}
${threeFoundryPreviewText}
${foundryPreviewStateProbeText}
${foundryThreePrimitivesText}
${foundryThreeObjectPoolText}
${foundryThreeRenderLayersText}
${threeResourceKitText}
${foundryRenderInventoryText}
${foundryPreviewStacksText}`;
const appShellText = readFileSync(join(process.cwd(), 'components', 'AppShell.tsx'), 'utf8');
const shellUiText = [
  'GettingStartedDialog.tsx',
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
${optionsSettingsControlsText}
${mechanismDesignStageText}
${designFoundryPreviewText}`;
const typesText = readFileSync(join(process.cwd(), 'types.ts'), 'utf8');
const indexText = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
assert(appText.includes('<AppWorkspaceShell') && !appText.includes('<AppStageRouter') && appWorkspaceShellText.includes('<AppStageRouter') && appStageRouterText.includes('<MechanismFoundry') && !appText.includes('<MechanismFoundry') && !appStageRouterText.includes('const MechanismFoundry = ({') && mechanismFoundryText.includes('export const MechanismFoundry'), 'App.tsx delegates workspace chrome to AppWorkspaceShell, which delegates stage routing to AppStageRouter');
assert(appStageRouterText.includes('<MechanismDesign') && !appText.includes('<MechanismDesign') && !appStageRouterText.includes('const MechanismDesign = ({') && mechanismDesignText.includes('export const MechanismDesign'), 'AppStageRouter delegates Mechanism Design to an extracted stage seam');
assert(appStageRouterText.includes('<Options') && !appText.includes('<Options') && !appStageRouterText.includes('const Options = ({') && optionsText.includes('export const Options') && optionsText.includes('OPTIONS_SECTION_MANIFEST'), 'AppStageRouter delegates the Options stage to an extracted stage seam');
assert(optionsText.includes('data-testid="options-settings-workspace"') && optionsText.includes('canvas: canvasPane(') && optionsText.includes('inspector: inspectorPane(null)') && !optionsText.includes('OptionsPreviewCanvas') && !existsSync(join(process.cwd(), 'components', 'stages', 'options', 'OptionsPreviewCanvas.tsx')) && indexText.includes('.options-stage-frame { grid-template-columns: minmax(245px, var(--ms-left-pane-width)) minmax(0, 1fr); grid-template-areas: "left canvas"; }') && indexText.includes('.options-stage-frame .stage-right-inspector { display: none; }') && indexText.includes('.options-settings-grid { columns: 16rem 3;'), 'Options removes the decorative preview and gives its horizontally arranged settings the full center workspace');
assert(indexText.includes('.options-workspace { height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto;') && indexText.includes('.options-stage-frame .stage-canvas-pane { min-height: 0; }') && indexText.includes('.options-workspace { height: auto; overflow: visible; }') && indexText.includes('.options-settings-grid { columns: 1; }'), 'Options owns bounded vertical scrolling on desktop, blocks horizontal leakage, and removes the generic canvas minimum in its one-column <=900px fallback');
assert(workflowSpecText.includes('1366px Options settings use three horizontal columns') && workflowSpecText.includes('hidden Options inspector reserves no phantom width') && workflowSpecText.includes('Options creates no page-level horizontal overflow') && workflowSpecText.includes('Units anchor scrolls the Options-owned settings surface') && workflowSpecText.includes('the lower Units section is fully reachable inside Options') && workflowSpecText.includes('Options uses one reachable column at the 900px fallback without phantom panes') && workflowSpecText.includes("await page.getByLabel('Theme').selectOption('dark')") && workflowSpecText.includes("await page.getByLabel('Performance preset').selectOption('high')") && workflowSpecText.includes("await page.getByLabel('Grid units').selectOption('inch')"), 'browser coverage locks Options full-width geometry, scroll ownership, lower-section reachability, inclusive mobile fallback, and existing settings interactions');
assert(optionsText.includes('from "./OptionsSettingsControls"') && !optionsText.includes('const OPTIONS_SECTION_MANIFEST =') && optionsSettingsControlsText.includes('export const OPTIONS_SECTION_MANIFEST') && optionsSettingsControlsText.includes('export const SettingsSection') && optionsSettingsControlsText.includes('export const SelectField') && optionsSettingsControlsText.includes('ContextHelp helpId={helpId}'), 'Options stage delegates section metadata and field wrappers to a UI-only controls leaf');
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
  appStageRouterText.includes('onFoundryExport') &&
    !appStageRouterText.includes('fitMechanismToTargetPath') &&
    appText.includes('useAppMechanismActions') &&
    appMechanismActionsHookText.includes('exportFoundryMechanism') &&
    appMechanismActionsHookText.includes('createMechanismFitWorkerClient') &&
    appMechanismActionsHookText.includes('createMechanismFitJobInput') &&
    !appMechanismActionsHookText.includes('fitMechanismToTargetPath') &&
    !appMechanismActionsHookText.includes('fitRecommendedMechanismToSheet') &&
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
const mechanismUpdateDispatch = mechanismUpdateHarness.dispatches[0] as { type: string; mechanism: MechanismConfig };
assert.equal(mechanismUpdateDispatch.type, 'upsert_mechanism', 'mechanism action hook dispatches an updated mechanism');
assert.equal(mechanismUpdateDispatch.mechanism.targetPartId, 'head', 'mechanism update action keeps target part edits behavior-backed');
assert.equal(mechanismUpdateDispatch.mechanism.targetPathId, undefined, 'mechanism update action clears an incompatible path when the target part changes');
assert.deepEqual(mechanismUpdateDispatch.mechanism.activeVisualPartIds, ['head'], 'mechanism update action preserves the active visual part behavior');

let designPathFitMode = '';
const designPathFitClient: MechanismFitWorkerClient = {
  request: (input, callbacks) => {
    designPathFitMode = input.mode;
    callbacks.complete(runMechanismFitJob(input));
    return 1;
  },
  cancel: () => undefined,
  dispose: () => undefined,
};
const designPathFitProject = createFabricationReadyFourBarProject();
const designPathFitHarness = renderMechanismActionHarness({
  project: designPathFitProject,
  mechanismFitClient: designPathFitClient,
});
designPathFitHarness.actions.updateMechanism(
  designPathFitProject.mechanisms[0].id,
  { anchorX: 9_999, anchorY: 9_999 },
);
const designPathFitDispatch = designPathFitHarness.dispatches[0] as {
  type: string;
  mechanism: MechanismConfig;
};
assert.equal(designPathFitMode, 'path', 'Design geometry uses path fitting while a target path is bound');
assert.deepEqual(
  mechanismBoardPlacementErrors(designPathFitProject, designPathFitDispatch.mechanism),
  [],
  'Design commits only the board-valid result returned by path fitting',
);

let designSheetFitMode = '';
const designSheetMechanism = {
  ...designPathFitProject.mechanisms[0],
  targetPartId: undefined,
  targetPathId: undefined,
  targetAnchorJointId: undefined,
};
const designSheetFitProject = {
  ...designPathFitProject,
  mechanisms: [designSheetMechanism],
  selectedMechanismId: designSheetMechanism.id,
};
const designSheetFitHarness = renderMechanismActionHarness({
  project: designSheetFitProject,
  mechanismFitClient: {
    request: (input, callbacks) => {
      designSheetFitMode = input.mode;
      callbacks.complete(runMechanismFitJob(input));
      return 1;
    },
    cancel: () => undefined,
    dispose: () => undefined,
  },
});
designSheetFitHarness.actions.updateMechanism(
  designSheetMechanism.id,
  { anchorX: 9_999, anchorY: 9_999 },
);
assert.equal(designSheetFitMode, 'sheet', 'Design geometry uses sheet fitting without a bound target path');
assert.deepEqual(
  mechanismBoardPlacementErrors(
    designSheetFitProject,
    (designSheetFitHarness.dispatches[0] as { mechanism: MechanismConfig }).mechanism,
  ),
  [],
  'Design sheet fitting also commits only a board-valid result',
);

let designFitFailure = '';
const designFailedFitHarness = renderMechanismActionHarness({
  project: designPathFitProject,
  mechanismFitClient: {
    request: (_input, callbacks) => {
      callbacks.failed(new Error('No valid board placement.'));
      return 1;
    },
    cancel: () => undefined,
    dispose: () => undefined,
  },
});
designFailedFitHarness.actions.updateMechanism(
  designPathFitProject.mechanisms[0].id,
  { anchorX: 9_999, anchorY: 9_999 },
  { failed: (error) => { designFitFailure = error.message; } },
);
assert.deepEqual(designFailedFitHarness.dispatches, [], 'failed Design fitting preserves the prior canonical mechanism');
assert.match(designFitFailure, /No valid board placement/, 'Design exposes fit failure to inspector rollback state');
let supersededDesignFitFailure = '';
const designSupersededFitHarness = renderMechanismActionHarness({
  project: designSheetFitProject,
  mechanismFitClient: {
    request: () => 1,
    cancel: () => undefined,
    dispose: () => undefined,
  },
});
designSupersededFitHarness.actions.updateMechanism(
  designSheetMechanism.id,
  { anchorX: 9_999, anchorY: 9_999 },
  { failed: (error) => { supersededDesignFitFailure = error.message; } },
);
designSupersededFitHarness.actions.updateMechanism(
  designSheetMechanism.id,
  { visible: false },
);
assert.match(supersededDesignFitFailure, /newer edit/, 'a non-geometry edit cancels and rolls back an uncommitted Design draft');
assert.equal(designSupersededFitHarness.dispatches.length, 1, 'cancelling a draft commits only the newer non-geometry edit');
assert(
  designInspectorPanelText.includes('{ failed: revertPendingEdit }') &&
    designInspectorPanelText.includes('`${String(p.key)}-${editRevision}`') &&
    !designInspectorPanelText.includes('complete: revertPendingEdit'),
  'Design inspector remounts draft controls only on authoritative fit failure and waits for canonical props after success',
);

const foundryExportFixture = createFabricationReadyFourBarProject();
const foundryExportPath = foundryExportFixture.paths['fabrication-fit-path'];
const foundryExportProject: ProjectState = {
  ...foundryExportFixture,
  mechanisms: [{ ...foundryExportFixture.mechanisms[0], id: 'mech-1' }],
  selectedMechanismId: 'mech-1',
};
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
  targetPartId: 'right_arm_lower',
  targetPathId: 'fabrication-fit-path',
  targetAnchorJointId: 'right_hand',
  warnings: ['contract warning'],
  source: 'mechanism-foundry',
};
const foundryExportHarness = renderMechanismActionHarness({ project: foundryExportProject, foundry: foundryExportMechanism });
foundryExportHarness.actions.exportFoundryMechanism(foundryExportPackage);
assert.deepEqual(foundryExportHarness.dispatches.map(action => action.type), ['set_foundry_export', 'upsert_mechanism'], 'Foundry export action preserves dispatch order');
assert.equal(foundryExportHarness.stage(), 'design', 'Foundry export action still navigates to Design');
const hookFoundryUpsert = foundryExportHarness.dispatches[1] as { type: string; mechanism: MechanismConfig };
assert.equal(hookFoundryUpsert.mechanism.id, 'mech-1', 'Foundry export refits the existing exact target instead of creating duplicate target drivers');
const independentDifferentTargetInsert = applyProjectAction(foundryExportProject, {
  type: 'upsert_mechanism',
  mechanism: {
    ...hookFoundryUpsert.mechanism,
    id: 'foundry-second-target',
    targetPartId: 'head',
    targetPathId: undefined,
    targetAnchorJointId: undefined,
    activeVisualPartIds: ['head']
  }
});
assert.equal(independentDifferentTargetInsert.mechanisms.length, foundryExportProject.mechanisms.length + 1, 'mechanism storage remains id-based so same-kind mechanisms can exist as separate target instances');
assert.equal(hookFoundryUpsert.mechanism.source, 'foundry', 'Foundry export preserves source metadata');
assert.equal(hookFoundryUpsert.mechanism.targetPathId, 'fabrication-fit-path', 'Foundry export preserves the selected target path');
assert.equal(hookFoundryUpsert.mechanism.crankLength, foundryExportFittedParameters.crankLength, 'Foundry export carries the fitted input linkage length into Design');
assert.equal(hookFoundryUpsert.mechanism.groundLength, foundryExportFittedParameters.groundLength, 'Foundry export carries the fitted ground span into Design');
assert.equal(hookFoundryUpsert.mechanism.couplerLength, foundryExportFittedParameters.couplerLength, 'Foundry export carries the fitted coupler length into Design');
assert.equal(hookFoundryUpsert.mechanism.rockerLength, foundryExportFittedParameters.rockerLength, 'Foundry export carries the fitted output linkage length into Design');
assert.equal(hookFoundryUpsert.mechanism.foundryExport?.metadata.recommendation, 'contract fit', 'Foundry export embeds package metadata for downstream Design/Blueprint parity');
assert(hookFoundryUpsert.mechanism.generatedPath && hookFoundryUpsert.mechanism.generatedPath.length >= 3, 'Foundry export keeps a generated path for simulation and fit checks');
assert(hookFoundryUpsert.mechanism.warnings?.includes('contract warning'), 'Foundry export preserves package warnings');
assert(appMechanismActionsHookText.includes('fittedFoundryParameters') && appMechanismActionsHookText.includes('...fittedFoundryParameters'), 'Foundry export carries the fitted preview parameters into Design instead of rebuilding only from controller defaults');
const foundryDraftHarness = renderMechanismActionHarness({
  project: foundryExportProject,
  foundry: foundryExportMechanism,
  selectedMechanism: foundryExportProject.mechanisms[0],
  selectedPath: foundryExportPath,
});
foundryDraftHarness.actions.commitFoundryDraft({ ...foundryExportMechanism, id: 'foundry-preview-draft' });
const foundryDraftUpsert = foundryDraftHarness.dispatches.at(-1) as { type: string; mechanism: MechanismConfig };
assert.equal(foundryDraftUpsert.type, 'upsert_mechanism', 'Foundry Fit commits a path-bound draft into ProjectState');
assert.equal(foundryDraftUpsert.mechanism.id, 'mech-1', 'Foundry Fit keeps the existing target mechanism identity when committing a draft');
assert.equal(foundryDraftUpsert.mechanism.targetPathId, 'fabrication-fit-path', 'Foundry Fit commit preserves the canonical target path');
assert(appMechanismActionsHookText.includes('commitFoundryDraft') && mechanismFoundryText.includes('onDraftChange'), 'Foundry draft fitting is synchronized through the action seam instead of remaining local-only');

assert(appText.includes('useAppDerivedState(project)') && !appText.includes('const sortedParts = useMemo') && appDerivedStateHookText.includes('selectedMechanism') && appDerivedStateHookText.includes('playbackDurationMs') && appDerivedStateHookText.includes('mechanismConfig: GlobalConfig') && appDerivedStateHookText.includes('current?.partId === selectedPart.id'), 'App delegates selected part/path/mechanism/playback/config derivation to a pure hook without changing selection defaults');
assert(mechanismFoundryText.includes('<FoundryWorkflowPanel') && foundryWorkflowPanelText.includes('data-testid="foundry-pick-anchor"') && !foundryWorkflowPanelText.includes('data-testid="foundry-target-summary"') && !foundryWorkflowPanelText.includes('Board hole') && !foundryWorkflowPanelText.includes('Range') && !foundryWorkflowPanelText.includes('Status'), 'Foundry left pane keeps action controls while hiding raw target, board-hole, range, and status readouts from the default student UI');
assert(!foundryWorkflowPanelText.includes('from "lucide-react"') && foundryWorkflowPanelText.includes('{fitBusy ? "Cancel" : "Fit path"}') && foundryWorkflowPanelText.includes('Use mechanism'), 'Foundry cold stage keeps its primary actions text-clear without mounting decorative SVG icon trees');
assert(
  mechanismFoundryText.includes('createCadencedGestureDraft<MechanismConfig>') &&
    mechanismFoundryText.includes('shouldForceFirstFoundryGestureMove(drag.dirty)') &&
    mechanismFoundryText.includes('foundryGestureDraft.publish(next, forceVisualSample)') &&
    !mechanismFoundryText.includes('foundryGestureDraft.publish(foundry, true)') &&
    mechanismFoundryText.includes('if (pathFitBusy) {') &&
    mechanismFoundryText.includes('pathFitClient.cancel();') &&
    mechanismFoundryText.includes('foundryGestureCommit.schedule(drag.draft') &&
    mechanismFoundryText.includes('const refreshed = refreshEditedFoundryMechanism(draft)') &&
    mechanismFoundryText.includes('setFoundryDraft(refreshed)') &&
    mechanismFoundryText.includes('release: () => startTransition(() => foundryGestureDraft.clear())') &&
    threeFoundryPreviewText.includes('if (deferMechanismTopology)') &&
    threeFoundryPreviewText.includes('renderDynamicRef.current?.({'),
  'Foundry skips redundant pointerdown rendering, submits the first changed lightweight draft during layout, commits pointerup once, and resumes full topology only after the final draft can paint',
);
assert(foundryHandleGestureText.includes("handle === 'M'") && foundryHandleGestureText.includes("handle === 'B'") && foundryHandleGestureText.includes("handle === 'D'") && foundryHandleGestureText.includes("couplerLength"), 'Foundry M/B/C/D handle calculations share one pure gesture helper');
assert(
  foundryHandleGestureText.includes('const proposedFixedPivot =') &&
    foundryHandleGestureText.includes('const fixedPivot = boardToScene(') &&
    mechanismFoundryText.includes('fitRecommendedMechanismToSheet(project, mechanism)') &&
    mechanismFoundryText.includes('mechanismBoardPlacementErrors(project, fitted)') &&
    mechanismFoundryText.includes('return undefined;') &&
    mechanismFoundryText.includes('onDraftChange(fitted)'),
  'Foundry keeps live handle work lightweight, snaps its second fixed pivot, and commits only a board-valid fitted draft',
);
assert(appProjectHistoryHookText.includes('recordProjectAction(action.type)') && workflowSpecText.includes('Foundry M B C D drags stay local until one pointerup commit'), 'runtime audit counters prove every Foundry handle gesture has zero pointermove actions and one pointerup commit');
assert(mechanismFoundryText.includes('useState(false);\n  const [showVelocity') && mechanismFoundryText.includes('setShowForces(false)') && mechanismFoundryText.includes('setShowVelocity(false)'), 'Foundry keeps optional force and velocity overlays off at entry and reset');
assert(threeFoundryPreviewText.includes('if (!showForces) return;') && threeFoundryPreviewText.includes('setPhysicsKernelRuntime("loading")') && threeFoundryPreviewText.includes('}, [showForces]);'), 'Foundry loads the Rapier WASM kernel only after the student requests physics diagnostics');
assert(workflowSpecText.includes('Foundry defers Rapier until physics diagnostics are requested') && workflowSpecText.includes('expect(rapierRequests).toEqual([])') && workflowSpecText.includes('expect(rapierRequests).toHaveLength(1)'), 'production preview proves ordinary Foundry entry does not request the optional Rapier chunk');
assert(mechanismFoundryText.includes('createMechanismFitJobInput') && mechanismFoundryText.includes('onFitPath={() => applyPathFit()}') && !mechanismFoundryText.includes('lastPathFitSignatureRef') && !mechanismFoundryText.includes('applyPathFit(next)') && foundryWorkflowPanelText.includes('data-testid="foundry-fit-path"') && foundryWorkflowPanelText.includes('foundry.fitPath') && foundryCanvasPaneText.includes('data-fit-board-cells') && foundryCanvasPaneText.includes('data-fit-target-path'), 'Foundry exposes a prominent cancellable worker Fit path action while preserving the default mechanism until the user clicks Fit');
assert(foundryWorkflowPanelText.includes('No valid fabrication fit. Try a shorter path or another mechanism.') && foundryWorkflowPanelText.includes('fitError?: number') && foundryWorkflowPanelText.includes('fitMaxError?: number') && !foundryWorkflowPanelText.includes('Math.round(fitError)') && !foundryWorkflowPanelText.includes('Math.round(fitMaxError)'), 'Foundry keeps fit diagnostics in the data contract while showing only an actionable student warning');
assert(foundryWorkflowPanelText.includes('ENABLED_FOUNDRY_MECHANISM_TYPES.map') && foundryInspectorPanelText.includes('ENABLED_FOUNDRY_MECHANISM_TYPES.map') && designWorkflowPanelText.includes('ENABLED_AUTHORABLE_MECHANISM_TYPES.map') && mechanismFoundryText.includes('if (!isMechanismTypeEnabled(type)) return') && mechanismRecommendationsText.includes('.filter((candidate) => isMechanismTypeEnabled(candidate.type))') && appControllerSource.includes('const ENABLED_GUIDED_LESSONS = CLASSROOM_LESSONS.filter') && appProjectCommandsHookText.includes('!isMechanismTypeEnabled(lesson.mechanismType)'), 'all new-work mechanism entry points share the central linkage-and-gear availability gate');
const foundryFitContractSeed = createDefaultMechanism('4bar', 'foundry-fit-contract');
const foundryFitContract = fitMechanismToTargetPath(sample, foundryFitContractSeed, 'path-right-arm');
assert.equal(foundryFitContract.id, foundryFitContractSeed.id, 'Fit path preserves the active Foundry preview instance id');
assert.equal(foundryFitContract.targetPathId, 'path-right-arm', 'Fit path writes the selected drawn path only after the explicit Fit action');
assert(
  [foundryFitContract.groundLength, foundryFitContract.crankLength, foundryFitContract.couplerLength, foundryFitContract.rockerLength].every(linkageSceneLengthIsFabricationPreset),
  '4bar path fitting searches within the four physical linkage sizes instead of inventing arbitrary linkage lengths',
);
assert(sampleFeasibleRange(foundryFitContract).percentValid >= 0.98, '4bar path fitting only accepts full-rotation kit candidates');
assert.equal(foundryFitContract.fabricationMetadata?.pathFit?.status, 'rejected', 'the waving path is rejected when no fabrication candidate meets hard ordered-motion tolerance');
assert.equal(foundryFitContract.generatedPath, undefined, 'a rejected four-bar fit does not store a misleading nearest generated path');
assert.equal(foundryFitContract.fabricationMetadata?.pathFit?.outputTraceId, undefined, 'a rejected four-bar fit does not claim a physical output trace');

const exactFourBarSeed = {
  ...createDefaultMechanism('4bar', 'exact-fit-contract'),
  anchorX: 0,
  anchorY: 0,
  groundLength: 160,
  crankLength: 80,
  couplerLength: 160,
  rockerLength: 80,
  groundAngle: 0,
  assemblyMode: 'open' as const,
  targetPartId: sample.paths['path-right-arm'].partId,
  targetPathId: 'exact-fit-path',
  targetAnchorJointId: sample.paths['path-right-arm'].targetAnchorJointId,
};
const exactTrace = generateMechanismPointTraces(exactFourBarSeed, 96).traces.find(trace => trace.id === 'C');
assert(exactTrace && exactTrace.points.length >= 90, 'fit fixture supplies a complete physical C trace');
const exactFitPath = {
  ...starterSample.paths['path-right-arm'],
  id: 'exact-fit-path',
  points: exactTrace?.points ?? [],
  closed: true,
};
const exactFitProject: ProjectState = {
  ...starterSample,
  paths: { ...starterSample.paths, [exactFitPath.id]: exactFitPath },
};
const exactFourBarFit = fitMechanismToTargetPath(exactFitProject, exactFourBarSeed, exactFitPath.id);
assert.equal(exactFourBarFit.fabricationMetadata?.pathFit?.status, 'fit', 'an ordered physical trace inside the board passes hard fit tolerance');
assert.equal(exactFourBarFit.fabricationMetadata?.pathFit?.outputTraceId, 'C', 'accepted fit records the physical C output trace');
assert((exactFourBarFit.fabricationMetadata?.pathFit?.error ?? Number.POSITIVE_INFINITY) <= (exactFourBarFit.fabricationMetadata?.pathFit?.tolerance ?? 0), 'accepted fit records RMS error within tolerance');
assert((exactFourBarFit.fabricationMetadata?.pathFit?.maxError ?? Number.POSITIVE_INFINITY) <= (exactFourBarFit.fabricationMetadata?.pathFit?.tolerance ?? 0), 'accepted fit records maximum positional error within tolerance');
assert((exactFourBarFit.fabricationMetadata?.pathFit?.tangentError ?? Number.POSITIVE_INFINITY) <= 45, 'accepted fit records tangent-direction agreement');
const exactGeneratedTrace = generateMechanismPointTraces(exactFourBarFit, 96).traces.find(trace => trace.id === exactFourBarFit.fabricationMetadata?.pathFit?.outputTraceId);
assert(
  exactFourBarFit.generatedPath &&
    exactGeneratedTrace &&
    exactGeneratedTrace.points.length === exactFourBarFit.generatedPath.length &&
    Math.hypot(exactGeneratedTrace.points[0].x - exactFourBarFit.generatedPath[0].x, exactGeneratedTrace.points[0].y - exactFourBarFit.generatedPath[0].y) < 1e-6,
  'accepted fitting stores the same physical output trace that drives motion',
);
assert(mechanismPathFitIsUsable(exactFitProject, exactFourBarFit), 'accepted fit binding is usable while path, board, and target metadata agree');
const staleKitFitProject = {
  ...exactFitProject,
  mechanisms: [exactFourBarFit],
  settings: {
    ...exactFitProject.settings,
    physicalKit: {
      ...exactFitProject.settings.physicalKit,
      gridPitchMm: exactFitProject.settings.physicalKit.gridPitchMm + 1,
    },
  },
};
assert(!mechanismPathFitIsUsable(staleKitFitProject, exactFourBarFit), 'accepted fit becomes unusable when the active fabrication grid changes');
assert(mechanismBindingWarnings(staleKitFitProject)[exactFourBarFit.id]?.includes('No fabrication-valid path fit.'), 'stale fit metadata blocks motion/export with a direct fabrication warning');
const reversedFitPath = {
  ...exactFitPath,
  id: 'exact-fit-reversed-path',
  points: [...exactFitPath.points].reverse(),
};
const reversedFit = fitMechanismToTargetPath(
  { ...exactFitProject, paths: { ...exactFitProject.paths, [reversedFitPath.id]: reversedFitPath } },
  { ...exactFourBarSeed, id: 'exact-fit-reversed' },
  reversedFitPath.id,
);
assert.equal(reversedFit.fabricationMetadata?.pathFit?.status, 'fit', 'reversing authored point order still finds a valid ordered fit');
assert([1, -1].includes(reversedFit.fabricationMetadata?.pathFit?.direction ?? 0), 'reversed fit records explicit traversal direction');
const shiftedFitPath = {
  ...exactFitPath,
  id: 'exact-fit-shifted-path',
  points: [...exactFitPath.points.slice(17), ...exactFitPath.points.slice(0, 17)],
};
const shiftedFit = fitMechanismToTargetPath(
  { ...exactFitProject, paths: { ...exactFitProject.paths, [shiftedFitPath.id]: shiftedFitPath } },
  { ...exactFourBarSeed, id: 'exact-fit-shifted' },
  shiftedFitPath.id,
);
assert.equal(shiftedFit.fabricationMetadata?.pathFit?.status, 'fit', 'changing a closed path starting point still finds a phase-aligned fit');
assert.notEqual(shiftedFit.fabricationMetadata?.pathFit?.phaseOffset, undefined, 'phase-aligned fit records the phase offset');
const evenKit = physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit);
const evenAnchor = boardToScene(5, 5, evenKit);
const evenFitSeed = {
  ...exactFourBarSeed,
  id: 'exact-fit-12x12',
  anchorX: evenAnchor.x,
  anchorY: evenAnchor.y,
};
const evenTrace = generateMechanismPointTraces(evenFitSeed, 96).traces.find(trace => trace.id === 'C');
const evenPath = { ...exactFitPath, id: 'exact-fit-12x12-path', points: evenTrace?.points ?? [] };
const evenFit = fitMechanismToTargetPath(
  { ...exactFitProject, settings: { ...exactFitProject.settings, physicalKit: evenKit }, paths: { ...exactFitProject.paths, [evenPath.id]: evenPath } },
  evenFitSeed,
  evenPath.id,
);
assert.equal(evenFit.fabricationMetadata?.pathFit?.status, 'fit', '12×12 centered board coordinates support the same physical fit contract');
const nearestGeneratedPathError = (generated: Point[], target: Point[]) => {
  if (!generated.length || !target.length) return Number.POSITIVE_INFINITY;
  return generated.reduce((sum, point) => {
    const nearest = target.reduce(
      (best, targetPoint) => Math.min(best, Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y)),
      Number.POSITIVE_INFINITY,
    );
    return sum + nearest;
  }, 0) / generated.length;
};
const gearLinkageFitSeed = createDefaultMechanism('gear_linkage', 'foundry-gear-linkage-fit-contract');
const gearLinkageFitContract = fitMechanismToTargetPath(sample, gearLinkageFitSeed, 'path-right-arm');
const gearLinkageTargetPath = sample.paths['path-right-arm'];
const defaultGearLinkageTarget = mechanismWithGeneratedPath({
  ...gearLinkageFitSeed,
  targetPartId: gearLinkageTargetPath.partId,
  targetPathId: gearLinkageTargetPath.id,
  targetAnchorJointId: gearLinkageTargetPath.targetAnchorJointId,
  activeVisualPartIds: [gearLinkageTargetPath.partId],
});
const gearLinkageGenerated = gearLinkageFitContract.generatedPath ?? [];
const gearLinkageTraces = generateMechanismPointTraces(gearLinkageFitContract, gearLinkageGenerated.length).traces;
const gearLinkageSharedTrace = gearLinkageTraces.find(trace => trace.id === 'R');
const gearLinkageGearPinTrace = gearLinkageTraces.find(trace => trace.id === 'B');
assert.equal(gearLinkageFitContract.targetPathId, 'path-right-arm', 'gear linkage Fit writes the selected drawn path');
assert.equal(gearLinkageFitContract.targetPartId, gearLinkageTargetPath.partId, 'gear linkage Fit keeps the selected motion target part');
assert(!gearLinkageFitContract.warnings?.some(warning => /No motion|choose target/i.test(warning)), 'gear linkage Fit does not fall back to a no-target/no-motion candidate');
assert.equal(validateMechanismPreviewReadiness(gearLinkageFitContract).length, 0, 'gear linkage Fit returns a preview-ready mechanism');
assert.equal(validateForFabrication({ ...sample, mechanisms: [gearLinkageFitContract] }).errors.length, 0, 'gear linkage Fit returns a fabrication-valid mechanism without duplicate-driver noise');
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
const gearLinkageFitError = nearestGeneratedPathError(gearLinkageGenerated, gearLinkageTargetPath.points);
const gearLinkageDefaultError = nearestGeneratedPathError(defaultGearLinkageTarget.generatedPath ?? [], gearLinkageTargetPath.points);
assert(
  gearLinkageFitError < 45 && gearLinkageFitError < gearLinkageDefaultError * 0.6,
  'gear linkage Fit moves the shared linkage trace near the user path instead of leaving the default pose',
);
assert(mechanismFoundryText.includes('<FoundryInspectorPanel') && foundryInspectorPanelText.includes('testId="foundry-parametric-editor"') && foundryInspectorPanelText.includes('Mechanism options') && foundryInspectorPanelText.includes('data-testid="foundry-view-controls"'), 'MechanismFoundry delegates the right Foundry inspector without changing parametric editor, compact view controls, or advanced options');
assert(foundryInspectorPanelText.includes('data-testid="foundry-visible-sensemaking"') && foundryInspectorPanelText.includes('showSensemaking &&') && foundryInspectorPanelText.includes('<DeferredClassroomExampleVideo') && designWorkflowPanelText.includes('<DeferredClassroomExampleVideo') && assemblyInspectorPanelText.includes('<DeferredClassroomExampleVideo') && [foundryInspectorPanelText, designWorkflowPanelText, assemblyInspectorPanelText].every(source => !source.includes('from "../../ui/ClassroomExampleVideo"')) && !foundryWorkflowPanelText.includes('data-testid="foundry-visible-sensemaking"') && !foundryInspectorPanelText.includes('Preview overlays') && !foundryInspectorPanelText.includes('foundry-physics-readout'), 'Foundry right inspector owns sensemaking first, every preloaded stage keeps the heavy example behind one deferred module boundary, and the existing Hint action owns Foundry example loading');
assert(workflowSpecText.includes('classroomExampleModuleRequests') && workflowSpecText.includes('Foundry idle-preloads the next Design adapter') && workflowSpecText.includes('preloading Design cannot fetch the click-owned classroom example chunk') && workflowSpecText.includes('Hint owns the classroom example chunk request'), 'the production browser flow proves next-stage preload cannot fetch ClassroomExampleVideo before the Foundry Hint click');
assert(mechanismFoundryText.includes('<FoundryCanvasPane') && foundryCanvasPaneText.includes('<DeferredThreeFoundryPreview') && foundryCanvasPaneText.includes('<FoundryOverlayLayer') && foundryCanvasChromeText.includes('data-testid="foundry-toolbar"') && foundryCanvasChromeText.includes('data-testid="foundry-camera-controls"') && foundryOverlayLayerText.includes('data-testid="foundry-preview-overlay"') && foundryOverlayLayerText.includes('data-testid="foundry-param-handles"') && foundryCanvasPaneText.includes('data-testid="foundry-toolbar-state"') && foundryCanvasPaneText.includes('data-testid="foundry-motion-warning"'), 'MechanismFoundry delegates the center Foundry canvas while warning overlays live above playback controls');
assert(foundryOverlayLayerText.includes('data-handle-contract="move-anchor-plus-shape-handles"') && foundryOverlayLayerText.includes('data-handle-ids=') && mechanismFoundryText.includes('id: "M"') && foundryHandleGestureText.includes("handle === 'M'") && mechanismFoundryText.includes('setSelectedOutputTraceId') && foundryCanvasChromeText.includes('data-testid="foundry-cycle-output-trace"'), 'Foundry exposes a shared move handle and a selectable Mech Path target instead of limiting direct manipulation to 4bar B/C/D handles');
assert(foundryWorkflowPanelText.includes('<MechanismLinkagePreview') && mechanismLinkagePreviewText.includes('export const MechanismLinkagePreview') && mechanismLinkagePreviewText.includes('mechanismLinkagePreviewHelpers') && mechanismLinkagePreviewHelpersText.includes('mechanismReferenceTopologySummary') && mechanismLinkagePreviewHelpersText.includes('camProfilePathD') && foundryPreviewGeometryText.includes('export const fittedGearTrainCenters'), 'Foundry workflow delegates 2D Foundry SVG preview to extracted foundry renderer/helper seams');
assert(foundryWorkflowPanelText.includes('ghostSimulations') && foundryWorkflowPanelText.includes('foundry-mini-ghost'), 'Foundry gallery cards show moving front-view mechanism poses instead of a single static icon');
assert(threeFoundryPreviewText.includes('foundryRenderedInventory(mechanism.type)') && foundryRenderInventoryText.includes('export const foundryRenderedInventory') && foundryRenderInventoryText.includes('referenceRequiredPartsHoleCount'), 'Foundry Three renderer delegates rendered inventory counts to a pure helper');
assert(threeFoundryPreviewText.includes('<FoundryPreviewStateProbe') && foundryPreviewStateProbeText.includes('data-testid="foundry-camera-rig"') && foundryPreviewStateProbeText.includes('data-three-animation-commit-ms'), 'Foundry Three renderer delegates browser telemetry to a probe seam without changing the camera-rig data contract');
assert(threeFoundryPreviewText.includes('createFoundryThreePrimitiveFactory') && threeFoundryPreviewText.includes('disposeFoundryThreeObject') && foundryThreePrimitivesText.includes('export const createFoundryThreePrimitiveFactory') && foundryThreePrimitivesText.includes('addGear') && foundryThreePrimitivesText.includes('addBar') && foundryThreePrimitivesText.includes('export const disposeFoundryThreeObject'), 'Foundry Three renderer delegates primitive mesh/material builders and cached disposal to the primitive factory seam');
assert(threeFoundryPreviewText.includes('renderFoundryDynamicLayers') && foundryThreeRenderLayersText.includes('export const renderFoundryDynamicLayers') && foundryThreeRenderLayersText.includes('renderLinkageLayer') && foundryThreeRenderLayersText.includes('renderGearLayer') && foundryThreeRenderLayersText.includes('foundrySpacerTouchesPin'), 'Foundry Three renderer delegates dynamic layer placement to a shared render-layer helper without changing fabrication z-stack dispatch');
assert(!existsSync(join(process.cwd(), 'components', 'Canvas.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'path', 'SceneSketch.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'path', 'PartShape.tsx')), 'legacy Canvas and SVG-only Path renderers stay deleted; active views use ThreePuppetPreview, ThreeFoundryPreview, and export-only blueprint SVG renderers');
assert(exporterText.includes('fabricationGearPathD'), 'blueprint/export gear rendering uses shared fabrication gear geometry');
assert(mechanismLinkagePreviewText.includes('mechanismReferenceTopologySummary') && mechanismLinkagePreviewText.includes('data-reference-topology'), 'active Foundry SVG renderer exposes mechanism-reference topology telemetry');
assert(mechanismLinkagePreviewText.includes('referenceCoordRoles') && mechanismLinkagePreviewText.includes('data-reference-coord-roles'), 'active Foundry SVG renderer exposes mechanism-reference coordinate role telemetry');
assert(mechanismLinkagePreviewText.includes('fabricationRingGearPathD') && foundry3dText.includes('fabricationRingGearProfileForPitchRadius'), 'active Foundry/Design renderers use shared ring/sun/planet/carrier gear geometry');
assert(threePreviewText.includes("mechDrive: new THREE.MeshStandardMaterial({ color: '#60a5fa'") && threePreviewText.includes("mechCoupler: new THREE.MeshStandardMaterial({ color: '#60a5fa'") && threePreviewText.includes("mechOutput: new THREE.MeshStandardMaterial({ color: '#60a5fa'"), 'integrated Design/Assembly puppet preview uses the Foundry linkage color instead of a private mechanism palette');
assert(foundry3dText.includes('fixed-gear-axles-only'), 'Foundry 3D gear train preview declares fixed gear axles rather than generic mechanism pins');
assert(foundry3dText.includes('coplanar-fixed-axles') && foundry3dText.includes('gear-axles-include-board-side-spacer'), 'Foundry 3D gear train preview keeps gear plates coplanar and spans board-side local spacer stacks');
assert(foundry3dText.includes('planetary-coplanar-ring-sun-planet') && foundry3dText.includes('planetary-carrier-pins-include-local-spacers'), 'Foundry 3D planetary preview keeps ring/sun/planet coplanar while carrier pins use local S10 spacers');
assert(foundry3dText.includes('/planet|G3|3-space/i'), 'Foundry 3D planetary renderer recognizes the mechanism-reference G3 label as the moving planet gear');
assert(foundry3dText.includes('board-side>S10-spacer>gear>fastener-head'), 'Foundry 3D gear train preview documents lower-z board-side gear axle ordering');
assert(foundry3dText.includes('S10<gear<fastener'), 'Foundry 3D gear train preview exposes the runtime lower-z S10, gear, fastener z-order contract');
assert(foundry3dText.includes('data-three-pin-stack-clearance-contract="local-spacers-fill-adjacent-z-gaps"') && foundry3dText.includes('FABRICATION_RENDER_MIN_CLEARANCE / 2'), 'Foundry local spacer validation fills board-to-part and part-to-part z gaps instead of allowing floating full-depth washers');
assert(foundryStageText.includes('foundry-parametric-editor') && mechanismDesignStageText.includes('design-parametric-editor'), 'Foundry and Design both mount the same compact parametric mechanism editor');
assert(mechanismFoundryText.includes('refreshEditedFoundryMechanism') && mechanismFoundryText.includes('bcTraces.length === 0') && mechanismFoundryText.includes('mechanismWithGeneratedPath(normalized)') && !mechanismFoundryText.includes('createPathFittedFoundry({ ...foundry, ...updates }'), 'Foundry parametric edits recompute the mechanism path from the edited mechanism instead of re-optimizing away user-selected link sizes or crashing when no B/C trace is valid');
assert(mechanismParametricEditorText.includes('Paired link length') && mechanismInspectorAnalysisText.includes('Drive gear size') && mechanismInspectorAnalysisText.includes('Output gear size'), 'parametric editor exposes gear and linkage fabrication selectors instead of hidden generic numbers');
assert(foundryInspectorPanelText.includes('<MechanismParametricEditor') && mechanismDesignStageText.includes('<MechanismParametricEditor') && mechanismInspectorAnalysisText.includes('gearTrainPitchRadii') && mechanismParametricEditorText.includes('defaultCamProfileSamples'), 'Foundry and Design delegate compact parametric gear/link/cam controls to a mechanism stage seam');
assert(inspectorControlsText.includes('data-gesture-commit="pointerup"') && inspectorControlsText.includes('pointerActiveRef.current') && inspectorControlsText.includes('commitPointerDraft') && workflowSpecText.includes('Shared inspector sliders keep pointer moves local until one canonical commit'), 'shared Character, Path, Foundry, Design, and Options sliders paint a local draft while pointerup performs the only canonical write');
assert(mechanismParametricEditorText.includes('draftProfileRef') && mechanismParametricEditorText.includes('commitDraft') && workflowSpecText.includes("cam pointermove has no ProjectAction") && workflowSpecText.includes("cam pointerup performs one canonical commit"), 'legacy cam profile editing keeps pointer moves inside its leaf and commits one mechanism update on pointerup');
assert(foundryStageText.includes('MECHANISM_PARAM_META') && mechanismDesignStageText.includes('MECHANISM_PARAM_META') && mechanismParamPolicyText.includes('shouldShowMechanismParam') && mechanismParamPolicyText.includes('clampMechanismParam'), 'Foundry and Design delegate legacy numeric mechanism parameter policy to a pure mechanism stage helper');
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
assert(threeResourceKitText.includes('export const cachedThreeResource') && threeResourceKitText.includes('export const disposeThreeObjectGraph') && threeResourceKitText.includes('export const resizeRendererToPerformancePolicy'), '3D previews share Three resource cache/disposal/atomic-resize helpers instead of duplicating renderer plumbing');
assert(
  threeResourceKitText.includes('SHARED_RENDERER_IDLE_PIXEL_BUDGET = RENDER_VIEWPORT_PIXEL_BUDGET') &&
    threeResourceKitText.includes('let retainedIdleRendererSlot') &&
    threeResourceKitText.includes('rendererSlot.cancelIdleShrink?.()') &&
    threeResourceKitText.includes('retainedPixels <= SHARED_RENDERER_IDLE_PIXEL_BUDGET'),
  'a released shared renderer retains at most one policy-bounded drawing buffer and cancels its delayed shrink when the next stage reuses that slot',
);
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
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 10 } });
    let pixelRatio = 1;
    let logicalWidth = 1;
    let logicalHeight = 1;
    let drawingBufferResizeCount = 0;
    const renderbufferContext = {
      MAX_RENDERBUFFER_SIZE: 0x84e8,
      getParameter: () => 8192,
    };
    resizeRendererToPerformancePolicy({
      getContext: () => renderbufferContext,
      getPixelRatio: () => pixelRatio,
      getSize: (target: THREE.Vector2) => target.set(logicalWidth, logicalHeight),
      setDrawingBufferSize: (width: number, height: number, value: number) => {
        logicalWidth = width;
        logicalHeight = height;
        pixelRatio = value;
        drawingBufferResizeCount += 1;
      },
    } as unknown as THREE.WebGLRenderer, resolveRenderPerformancePolicy('balanced'), {
      width: 1366,
      height: 768,
    });
    assert.equal(pixelRatio, 0.5, 'shared Three pixel-ratio helper applies the selected render policy');
    assert.deepEqual([logicalWidth, logicalHeight], [1366, 768], 'shared Three resize helper commits the logical viewport with the DPR');
    assert.equal(drawingBufferResizeCount, 1, 'shared Three resize helper commits size and DPR in one backing-store allocation');

    resizeRendererToPerformancePolicy({
      capabilities: { maxTextureSize: 2048 },
      getContext: () => { throw new Error('context lost'); },
      getPixelRatio: () => pixelRatio,
      getSize: (target: THREE.Vector2) => target.set(logicalWidth, logicalHeight),
      setDrawingBufferSize: (width: number, height: number, value: number) => {
        logicalWidth = width;
        logicalHeight = height;
        pixelRatio = value;
        drawingBufferResizeCount += 1;
      },
    } as unknown as THREE.WebGLRenderer, resolveRenderPerformancePolicy('high'), {
      width: 2000,
      height: 1000,
    });
    assert.equal(pixelRatio, 2048 / 2000, 'lost-context fallback keeps the drawing buffer within a conservative renderer capability');
    assert.equal(drawingBufferResizeCount, 2, 'lost-context fallback still commits one bounded backing-store allocation');

    logicalWidth = 3098;
    logicalHeight = 2002;
    pixelRatio = Math.sqrt(4_000_000 / (logicalWidth * logicalHeight));
    let maximumCommittedPixels = logicalWidth * logicalHeight * pixelRatio ** 2;
    resizeRendererToPerformancePolicy({
      getContext: () => renderbufferContext,
      getPixelRatio: () => pixelRatio,
      getSize: (target: THREE.Vector2) => target.set(logicalWidth, logicalHeight),
      setDrawingBufferSize: (width: number, height: number, value: number) => {
        logicalWidth = width;
        logicalHeight = height;
        pixelRatio = value;
        maximumCommittedPixels = Math.max(maximumCommittedPixels, width * height * value ** 2);
      },
    } as unknown as THREE.WebGLRenderer, resolveRenderPerformancePolicy('high'), {
      width: 624,
      height: 610,
    });
    assert.equal(pixelRatio, 2, 'a Chromebook-size workbench can raise High resolution to native DPR 2');
    assert(maximumCommittedPixels <= 4_000_000, 'large-to-small resize never creates an intermediate backing store above the policy budget');

    logicalWidth = 1000;
    logicalHeight = 4000;
    pixelRatio = 1;
    const rotatedCanvas = { width: 1000, height: 4000 };
    let rotatedResizeCount = 0;
    let rotatedPeakPixels = rotatedCanvas.width * rotatedCanvas.height;
    resizeRendererToPerformancePolicy({
      domElement: rotatedCanvas,
      getContext: () => renderbufferContext,
      getPixelRatio: () => pixelRatio,
      getSize: (target: THREE.Vector2) => target.set(logicalWidth, logicalHeight),
      setDrawingBufferSize: (width: number, height: number, value: number) => {
        logicalWidth = width;
        logicalHeight = height;
        pixelRatio = value;
        rotatedCanvas.width = Math.floor(width * value);
        rotatedPeakPixels = Math.max(rotatedPeakPixels, rotatedCanvas.width * rotatedCanvas.height);
        rotatedCanvas.height = Math.floor(height * value);
        rotatedPeakPixels = Math.max(rotatedPeakPixels, rotatedCanvas.width * rotatedCanvas.height);
        rotatedResizeCount += 1;
      },
    } as unknown as THREE.WebGLRenderer, resolveRenderPerformancePolicy('high'), {
      width: 4000,
      height: 1000,
    });
    assert.equal(rotatedResizeCount, 2, 'a portrait-to-landscape resize clears one tiny intermediate backing store before the final allocation');
    assert(rotatedPeakPixels <= 4_000_000, 'portrait-to-landscape canvas mutations also stay inside the pixel budget');
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
assert(threePreviewText.includes("const pinSites = mechanism.type === 'gear'") && threePreviewText.includes('boardToMovingZ(zDriverGear)') && !threePreviewText.includes('[state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].forEach'), '3D puppet mechanism pins use per-site z spans instead of one global pin tower through empty planes');
assert(mechanismDesignText.includes('<DesignFoundryPreview') && designFoundryPreviewText.includes('export const DesignFoundryPreview') && designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"'), 'Mechanism Design owns a thin automata preview adapter instead of a separate legacy renderer');
assert(designFoundryPreviewText.includes('<DeferredThreeFoundryPreview') && !designFoundryPreviewText.includes('<ThreePuppetPreview') && !designFoundryPreviewText.includes('design-foundry-context-layer') && designFoundryPreviewText.includes('automataContext={automataContext}') && foundryCanvasPaneText.includes('<DeferredThreeFoundryPreview'), 'Design renders mechanism plus character/object context inside the same deferred Foundry Three scene instead of a parallel puppet overlay');
assert(designFoundryPreviewText.includes('data-renderer-source="ThreeFoundryPreview"') && designFoundryPreviewText.includes('data-shared-with="foundry-renderer"') && designFoundryPreviewText.includes('data-design-scene-mode="single-foundry-automata-scene"') && designFoundryPreviewText.includes('data-automata-model-source="automata-scene-runtime"'), 'Mechanism Design advertises single-scene Foundry-renderer mechanism truth with retained automata runtime telemetry');
assert(automataSceneModelText.includes('mechanismFeature(normalizedMechanism.type)') && automataSceneModelText.includes('const mechanisms = normalizedMechanisms.length ? normalizedMechanisms : [normalizedMechanism]') && automataSceneModelText.includes('motionPreviewForProject(project, mechanisms, angle)') && automataSceneModelText.includes('motionPreviewForProject(project, [mechanism], angle)'), 'Automata scene runtime reuses Foundry registry semantics, drives the full automata scene, and reads the selected IK/object target for inspector feedback');
assert(foundry3dText.includes('const placeFoundryLocalGroup') && foundry3dText.includes('group.rotation.z = (-transform.rotation * Math.PI) / 180') && foundry3dText.includes('const placeSceneLocalGroup') && foundry3dText.includes('group.rotation.z = (transform.rotation * Math.PI) / 180'), 'Foundry keeps y-down fit-space rotations separate from scene-preserving automata rotations');
assert(threeFoundryPreviewText.includes('context.geometrySkeleton ?? project.skeleton ?? context.skeleton') && designFoundryPreviewText.includes('geometrySkeleton: project.skeleton') && assemblyThreePreviewText.includes('geometrySkeleton: project.skeleton'), 'Design and Assembly retain rigid part/hole geometry from the authored skeleton while animated transforms consume sampled IK state');
assert(foundryPreviewModelText.includes("frame: 'fit' | 'scene' = 'fit'") && automataSceneModelText.includes("'scene'"), 'Design/Assembly automata previews request the scene-preserving Foundry preview frame instead of re-fitting the character scene');
assert(foundry3dText.includes('data-three-stack-source') && designFoundryPreviewText.includes('data-foundry-feature-label') && designFoundryPreviewText.includes('data-foundry-feature-issue-count'), 'Mechanism Design exposes Foundry feature provenance for browser verification');
assert(!appText.includes('<Canvas project={project} config={mechanismConfig}'), 'Mechanism Design no longer mounts the legacy 2D design canvas mechanism renderer');
assert(exporterText.includes('fabricationGearPathD'), 'SVG export gear rendering uses shared fabrication gear geometry');
assert(foundry3dText.includes('fabricationGearProfileForPitchRadius'), 'Foundry gear helper uses shared fabrication gear holes/profile');
assert(foundry3dText.includes('validateMechanismPreviewReadiness'), 'Foundry gates standalone 3D previews through shared physical/fabrication readiness validation');
assert(foundry3dText.includes('data-three-physical-validation-errors'), 'Foundry exposes physical readiness errors for browser verification');
assert(foundry3dText.includes('validateMechanismPreviewReadiness') && automataSceneModelText.includes('createFoundryMechanismPreviewRuntime') && designFoundryPreviewText.includes('data-design-foundry-contract-source="automata-scene-runtime"'), 'Mechanism Design readiness and preview state route through the shared retained automata scene runtime and Foundry renderer seam');
assert(automataSceneModelText.includes('createFoundryMechanismPreviewRuntime') && designFoundryPreviewText.includes('reuseAutomataSceneRuntime') && designFoundryPreviewText.includes('sampleReusableAutomataSceneRuntime') && assemblyThreePreviewText.includes('reuseAutomataSceneRuntime') && assemblyThreePreviewText.includes('sampleReusableAutomataSceneRuntime') && foundryPreviewModelText.includes('createFoundryPlaybackFrame') && foundryPreviewModelText.includes('generateFoundryPlaybackPointTraces') && !designFoundryPreviewText.includes('generateMechanismPointTraces') && !assemblyThreePreviewText.includes('generateMechanismPointTraces') && !assemblyThreePreviewText.includes('fitMechanismSimulationWithContext'), 'Mechanism Design and Assembly retain bounded reusable Foundry state and sample motion without private legacy simulation paths');
assert(assemblyThreePreviewText.includes('viewerTab="assembly"') && assemblyThreePreviewText.includes('automataContext={automataContext}') && assemblyThreePreviewText.includes('data-assembly-one-scene-automata'), 'Assembly labels the viewer as Assembly and can render character/object context inside the shared Foundry mechanism scene');
assert(!automataSceneModelText.includes('firstVisiblePath'), 'Automata scene model does not silently pick a different first-visible path than Foundry when no explicit/selected path exists');
{
  const fixture = createFabricationReadyFourBarProject();
  const mechanism = fixture.mechanisms[0]!;
  const canonical = buildAutomataSceneModel(fixture, mechanism, Math.PI * 0.42, 'design-live');
  assert.equal(canonical.userPath?.id, 'fabrication-fit-path', 'Canonical automata model uses the explicit/selected path for fitted previews');
  assert.equal(canonical.motionSource, 'linkage-trace', 'Canonical automata model drives the scene from the physical linkage trace when a fitted path exists');
  assert(canonical.generatedTarget && canonical.target, 'Canonical automata model exposes both generated mechanism output and selected IK target');
  assert((canonical.generatedPathError ?? Number.POSITIVE_INFINITY) < 1, 'Canonical automata model keeps the stored display trace close to the physical linkage trace');
  assert((canonical.targetError ?? Number.POSITIVE_INFINITY) > 1, 'Canonical automata model reports the remaining physical-to-authored-path error instead of hiding a closest fit');
  const drivenHand = canonical.animatedParts.right_hand_part;
  assert(drivenHand && canonical.target && canonical.skeleton, 'Canonical automata model animates the hand target part through IK');
  const handPivot = bodyPartPivotScene(drivenHand, canonical.skeleton);
  assert(Math.hypot(handPivot.x - canonical.target!.x, handPivot.y - canonical.target!.y) < 1e-6, 'Driven hand part pivot stays on the physical mechanism output in scene coordinates');
  const sceneFit = createSceneMechanismFitContext(mechanism, 360, 240, 96);
  const sceneOrigin = sceneFit.map({ x: 0, y: 0 });
  const sceneUp = sceneFit.map({ x: 0, y: 100 });
  assert(sceneUp.y < sceneOrigin.y, 'Scene-preserving Foundry preview keeps positive scene Y visually upward instead of flipping Character/Path composition');
  const firstUserPoint = fixture.paths['fabrication-fit-path'].points[0]!;
  const firstPreviewPoint = canonical.foundryPreview!.userPathPoints[0]!;
  const firstScenePoint = sceneFit.map(firstUserPoint);
  assert(Math.hypot(firstPreviewPoint.x - firstScenePoint.x, firstPreviewPoint.y - firstScenePoint.y) < 1e-9, 'Design Foundry preview maps the user path through the fixed scene frame instead of centering it independently');
  const noSelectedPathProject = {
    ...fixture,
    selectedPathId: undefined,
    mechanisms: [{ ...mechanism, targetPathId: undefined }],
  };
  const noFallback = buildAutomataSceneModel(noSelectedPathProject, noSelectedPathProject.mechanisms[0], 0, 'design-live');
  assert.equal(noFallback.userPath, undefined, 'Canonical automata model does not fall back to an unrelated visible path when Foundry would have no active path');
}
assert(threePreviewText.includes('normalizeCamProfileSamples') && threePreviewText.includes('data-cam-profile={selectedCamProfile}') && workflowSpecText.includes('Mechanism Design cam profile edits update the integrated automata preview'), 'Mechanism Design exposes shared cam profile telemetry and browser coverage proves Design-side edits reach the integrated automata preview');
assert(designFoundryPreviewText.includes('design-toggle-user-path') && designFoundryPreviewText.includes('design-toggle-mechanism-path') && designFoundryPreviewText.includes('data-user-path-preview') && designFoundryPreviewText.includes('data-mechanism-path-preview'), 'Mechanism Design separates original user path and fitted mechanism path visibility in the top viewer controls');
assert(mechanismRecommendationsText.includes('option.fabricationErrors.length === 0'), 'Foundry recommendations filter impossible mechanism candidates before they can be offered');
assert(mechanismRecommendationsText.includes('const initialMechanism = createRecommendedMechanism(') && mechanismRecommendationsText.includes('fitRecommendedMechanismToSheet(') && mechanismRecommendationsText.includes('readyMechanismFallbackForPath('), 'mechanism recommendations retry with a sheet-fitted fabrication-ready fallback before hiding a candidate');
assert(!mechanismRecommendationsText.includes('fitMechanismGeneratedPathToPath') && !designFoundryPreviewText.includes('fitMechanismGeneratedPathToPath') && !appText.includes('fitMechanismGeneratedPathToPath'), 'mechanism recommendations must not center-shift physical templates away from hole-snapped anchors');
assert(mechanismRecommendationsText.includes('normalizeGearMeshMechanism(') && mechanismRecommendationsText.includes('normalizeMechanismToReference(tuned)'), 'mechanism recommendations pass through fabrication-set normalization before fitting to the sheet');
assert(
  mechanismRecommendationsText.includes('project.mechanisms.filter((m) => {') &&
    mechanismRecommendationsText.includes('if (m.id === mechanism.id) return false') &&
    mechanismRecommendationsText.includes('m.targetPathId === mechanism.targetPathId') &&
    mechanismRecommendationsText.includes('preferredMotionJointId(project, mechanism.targetPartId, m.targetAnchorJointId) === targetAnchor') &&
    mechanismRecommendationsText.includes('mechanisms: [...siblingMechanisms, mechanism]'),
  'fabrication candidate validation replaces the matching target/path/anchor driver instead of appending duplicate target drivers during refit',
);
assert(mechanismRecommendationsText.includes('const fittedErrors = fabricationErrorsForCandidate(project, fittedCandidate)') && mechanismRecommendationsText.includes('const fallbackErrors = fabricationErrorsForCandidate(project, fallback)'), 'path fitting gates fitted mechanisms through full fabrication validation, not preview-only geometry');
assert(mechanismRecommendationsText.includes('const unchanged = mechanismWithGeneratedPath(') && mechanismRecommendationsText.includes('const unchangedErrors = fabricationErrorsForCandidate(project, unchanged)'), 'path fitting falls back to the previous/snapped mechanism instead of returning an invalid fit candidate');
assert(
  mechanismRecommendationsText.includes('nearestValidDistance') &&
    mechanismRecommendationsText.includes('mechanismBoardPlacementErrors(project, candidate)') &&
    mechanismRecommendationsText.includes('for (let col = 0; col < cells; col += 1)'),
  'recommendation sheet fitting chooses the nearest validator-approved board hole with a bounded board-cell search',
);
assert(projectText.includes('normalizeMechanismToFabricationSet({') && projectText.includes('const reconcileMechanismTargets'), 'ProjectState reducers centrally normalize saved mechanisms to fabrication-ready reference sets');
assert(mechanismRecommendationsText.includes('localizeFittedMechanismAnchor') && mechanismRecommendationsText.includes('maxDistance = 120'), 'Foundry export preserves the picked board anchor locality when fitting a mechanism to a path');
assert(!appText.includes('A-D-ground-links-coplanar'), '4bar previews no longer collapse ground/output links into one impossible z plane');
assert(foundry3dText.includes('fabrication-stack-separated'), '4bar previews keep fabrication stack-separated z order in Foundry and Design');
assert(mechanismLinkagePreviewText.includes('FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM') && mechanismLinkagePreviewText.includes('FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM'), 'Foundry 2D mechanism plates use centralized fabrication linkage and hole dimensions');
assert(mechanismLinkagePreviewText.includes('fabricationRingGearPathD'), '2D Foundry planetary preview uses shared ring gear geometry');
assert(foundry3dText.includes('fabricationRingGearProfileForPitchRadius'), '3D Foundry ring uses shared fabrication ring gear geometry');
assert(
  workspacePlaybackLoopHookText.includes('SHARED_PLAYBACK_STAGES') &&
    workspacePlaybackLoopHookText.includes('!SHARED_PLAYBACK_STAGES.includes(stage)') &&
    workspacePlaybackLoopHookText.includes('playbackClock.start') &&
    !workspacePlaybackLoopHookText.includes('requestAnimationFrame(') &&
    workspacePlaybackLoopHookText.includes('animationDeltaRadians') &&
    workspacePlaybackLoopHookText.includes('stage !== "path" && drawMode') &&
    externalPlaybackClockText.includes('phaseRef') &&
    externalPlaybackClockText.includes('subscribe') &&
    b695PlaybackTestText.includes('at most 10 Hz'),
  'shared playback uses one external phase clock, keeps Path draw reset behavior, and leaves frame-rate phase updates out of React'
);
assert(
  motionText.includes('motionPathRuntimeCache') &&
    motionText.includes('motionPreviewCache') &&
    motionText.includes('sameMechanismSet') &&
    motionText.includes('pathSamplerFor') &&
    motionText.includes('preparedChain?: string[]') &&
    motionText.includes('createMotionPathPreviewRuntime') &&
    b695FrameTestText.includes('legacyMotionPreviewForPath') &&
    b695FrameTestText.includes('project motion projection is reused') &&
    b695FrameTestText.includes('prepared path runtime is cached by immutable project/path identity'),
  'frame projection reuses path and IK preparation while the contract test compares optimized output with the legacy path preview',
);
assert(
  mechanismRecommendationsText.includes('const acceptedFourBarFit = mechanism.type === "4bar"') &&
    mechanismRecommendationsText.includes('if (acceptedFourBarFit) return acceptedFourBarFit;') &&
    b695FitTestText.includes('rejected four-bar output remains byte-stable after hard physical trace fitting') &&
    b695FitTestText.includes('short-path four-bar rejection remains byte-stable with b695'),
  'Fit returns explicit hard-tolerance rejections before generic fallback construction and keeps b695 outputs stable',
);
assert(
  blueprintModelRuntimeText.includes('const modelCache = new WeakMap<ProjectState, BlueprintModel>()') &&
    blueprintModelRuntimeText.includes('const packageCache = new WeakMap<ProjectState, FabricationPackage>()') &&
    !blueprintModelRuntimeText.includes('makeBlueprintPreviewSvg(project, recipes)') &&
    blueprintModelRuntimeText.includes('createFabricationPackage(project)') &&
    b695BlueprintTestText.includes('Blueprint reuses the exact model') &&
    b695BlueprintTestText.includes('cached package PDF bytes remain exact'),
  'Blueprint caches validation, live recipes, and package bytes by immutable ProjectState while the visible scene stays in Three',
);
assert(
  studyArtifactText.includes("motionsmith-final-study-v1") &&
    studyArtifactText.includes('FINAL_STUDY_ARTIFACT_MAX_BYTES') &&
    studyArtifactText.includes('blueprintReached') &&
    studyArtifactText.includes('packageGenerated') &&
    studyArtifactText.includes('emitFinalStudyArtifact') &&
    finalStudyHookText.includes('__MOTIONSMITH_STUDY_SUMMARY_ENABLED__') &&
    finalStudyHookText.includes('!blueprintReached') &&
    b695StudyTestText.includes('study refuses a second artifact') &&
    b695StudyTestText.includes("!payload.includes('generatedPath')"),
  'study is one opt-in bounded semantic artifact with no playback/frame or raw-motion collection',
);
assert(appText.includes('useWorkspacePlaybackLoop({') && !appText.includes('requestAnimationFrame(') && !appText.includes('animationDeltaRadians('), 'App delegates shared playback timing to useWorkspacePlaybackLoop without owning animation-frame math');
assert(modalInertHookText.includes('setAttribute("inert", "")') && modalInertHookText.includes('aria-hidden') && modalInertHookText.includes('welcome-modal-open') && appText.includes('useModalInertEffect(appShellRef, modalOpen)') && !appText.includes('document.documentElement.classList.add("welcome-modal-open")') && !appText.includes('useEffect, useRef'), 'App delegates startup/help/about modal inert DOM side effects to useModalInertEffect');
assert(!appText.includes('STARTER_IMAGE_TEMPLATES') && !existsSync(join(process.cwd(), 'resources', 'starterImageTemplates.ts')), 'image-recognition starter assets stay outside the classroom app');
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
    mechanismFoundryText.includes('sampleIndexedValues(') &&
    mechanismFoundryText.includes('foundryFitContext.map(value)') &&
    foundryPreviewStateProbeText.includes('data-three-primary-path-bounds');
  assert.equal(foundrySplitPathControls, true, 'Foundry separates the drawn user path from the generated mechanism path in the same fit-context coordinate basis so students can compare fit before applying the mechanism');

  const designGeneratedPathMotion =
    automataSceneModelText.includes('motionPreviewForProject(project, [mechanism], angle)') &&
    automataSceneModelText.includes('generatedTarget && selectedMotionPreview.target') &&
    automataSceneModelText.includes("? 'linkage-trace'") &&
    designFoundryPreviewText.includes('data-design-motion-source={sceneModel.motionSource}') &&
    designFoundryPreviewText.includes('data-design-target-error') &&
    designFoundryPreviewText.includes('data-design-target-x') &&
    designFoundryPreviewText.includes('data-design-animated-part-count');
  assert.equal(designGeneratedPathMotion, true, 'Mechanism Design drives character motion from the physical linkage trace through motionPreviewForProject while fabrication fit remains a separate export gate');

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
    assemblyThreePreviewText.includes('sampleReusableAutomataSceneRuntime') &&
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

assert(appText.includes('useAppCharacterImportActions({') && !appText.includes('const importCharacterPackage =') && !appText.includes('const importProject =') && !appText.includes('const acceptPendingCharacter =') && appCharacterImportActionsHookText.includes('createProjectImportWorkerClient') && appCharacterImportActionsHookText.includes('requestCharacterPackage(files') && appCharacterImportActionsHookText.includes('requestProject(file') && appCharacterImportActionsHookText.includes('importClient.dispose()') && !appCharacterImportActionsHookText.includes('loadCharacterPackage') && !appCharacterImportActionsHookText.includes('loadProjectSnapshot') && appCharacterImportActionsHookText.includes('setProject(pendingCharacter.project, { resetHistory: true })') && appCharacterImportActionsHookText.includes('returnStage: "character"') && !appCharacterImportActionsHookText.includes('processImageWithWebOnnx'), 'App delegates package/project import review to a disposable worker while the image-recognition path stays removed');
assert(projectImportWorkerClientText.includes('new URL("../../workers/projectImportWorker.ts", import.meta.url)') && projectImportWorkerClientText.includes('active.firstFrame') && projectImportWorkerClientText.includes('active.secondFrame') && projectImportWorkerClientText.includes('data.generationId !== generationId') && projectImportWorkerClientText.includes('worker.terminate()') && projectImportWorkerText.includes('await import('), 'project and character imports wait for two paints, ignore stale generations, load worker code lazily, and always release the worker');
assert(projectImportPolicyText.includes('projectBytes: 12 * MEBIBYTE') && projectImportPolicyText.includes('packageFileCount: 96') && projectImportPolicyText.includes('packageConfigBytes: 512 * 1024') && projectImportPolicyText.includes('packageTotalConfigBytes: 512 * 1024') && projectImportPolicyText.includes('packageAssetBytes: 2 * MEBIBYTE') && projectImportPolicyText.includes('packageTotalAssetBytes: 3 * MEBIBYTE') && projectImportPolicyText.includes('packageTotalBytes: 4 * MEBIBYTE') && projectImportPolicyText.includes('validateProjectImportShape') && projectImportPolicyText.includes('objectGraphContainers: 50_000'), 'classroom imports reserve enough serialized headroom for base64 artwork, configs, entities, points, depth, and object containers before ProjectState normalization');
assert(packageLoaderText.includes('validateCharacterPackageFiles(list)') && packageLoaderText.includes('for (const file of assetFiles)') && !packageLoaderText.includes('Promise.all('), 'character package assets are validated and encoded sequentially instead of retaining every conversion at once');
assert(workspacePlayerDockHookText.includes('const showsWorkspacePlayer =') && workspacePlayerDockHookText.includes('editorStage === "path"') && workspacePlayerDockHookText.includes('editorStage === "design"') && workspacePlayerDockHookText.includes('editorStage === "assembly"'), 'shared playback dock is restricted to Path, Mechanism Design, and Assembly instead of leaking onto unrelated tabs');
assert(appText.includes('useWorkspacePlayerDock') && !appText.includes('<WorkspacePlayerDock') && !appText.includes('const [assemblyPlaying'), 'App delegates shared player dock assembly and Assembly dock state to useWorkspacePlayerDock');
assert(workspacePlayerDockHookText.includes('setAssemblyStepProgress(0)') && workspacePlayerDockHookText.includes('onStepChange: goSharedAssemblyStep'), 'workspace player dock owns Assembly previous/next step handoff and scrubber reset');
assert(appControllerSource.includes('const [isPlaying, setIsPlaying] = useState(false)') && workspacePlayerDockHookText.includes('document.addEventListener("visibilitychange"') && workspacePlayerDockHookText.includes('setAssemblyPlaying(false)') && workflowSpecText.includes('Classroom playback is opt-in and pauses across stage or hidden-tab boundaries'), 'classroom playback starts paused and stops across stage, modal, and hidden-tab ownership boundaries');
assert(appUiText.includes('workspace-player-prev-step') && appUiText.includes('workspace-player-next-step') && appUiText.includes('Assembly scrubber'), 'shared playback dock owns Assembly previous/next step controls and scrubber');
assert(!`${appText}
${mechanismDesignStageText}
${designFoundryPreviewText}`.includes('data-testid="design-foundry-playback-hud"'), 'Mechanism Design uses the shared workspace player instead of a duplicate local playback HUD');
assert(threeFoundryPreviewText.includes('renderDynamicRef') && threeFoundryPreviewText.includes('subscribeCadencedPlaybackSampler') && foundryOverlayLayerText.includes('subscribeCadencedPlaybackSampler') && threePreviewText.includes('subscribeCadencedPlaybackSampler') && cadencedPlaybackSamplerText.includes('const frame = sample(phase)') && cadencedPlaybackSamplerText.indexOf('time - lastSampleTime < minFrameIntervalMs') < cadencedPlaybackSamplerText.indexOf('const frame = sample(phase)'), 'Foundry and puppet playback gate expensive external-clock sampling before updating retained Three and overlay scenes');
assert(foundryThreeObjectPoolText.includes('class FoundryThreeObjectPool') && foundryThreeObjectPoolText.includes('topologyRevision') && threeFoundryPreviewText.includes('foundry-mechanism-runtime') && !threeFoundryPreviewText.includes('scene.remove(old)'), 'Foundry retains one dynamic transform tree and rebuilds pooled objects only when topology keys change');
assert(foundryThreeObjectPoolText.includes('maxRetainedEntries') && foundryThreeObjectPoolText.includes('trimUnusedEntries') && threeFoundryPreviewText.includes('renderPolicy.repeatedGeometry.maxPoolEntries') && foundryAssemblySceneOverlayText.includes('resourcePolicy.maxPoolEntries'), 'performance policy bounds retained Foundry and Assembly pool high-water entries');
assert(foundry3dText.includes('geometryCacheRef') && foundry3dText.includes('materialCacheRef'), 'Foundry caches reusable Three geometry/material resources during playback');
assert(foundry3dText.includes('foundryCached') && foundry3dText.includes('data-three-geometry-cache-size'), 'Foundry tags cached resources and exposes cache size for browser perf tests');
assert(threeResourceKitText.includes('pruneUnusedThreeResourceCache') && threeFoundryPreviewText.includes('maxGeometryCacheEntries') && threeFoundryPreviewText.includes('maxMaterialCacheEntries') && foundryAssemblySceneOverlayText.includes('pruneOverlayResourceCaches') && threePreviewText.includes('pruneSharedGeometryCache'), 'Foundry, Assembly, and puppet renderers prune unused resources against the selected preset budgets');
assert(foundryThreePrimitivesText.includes('objectPool.acquire(\n      "path"') && foundryThreePrimitivesText.includes('position.setXYZ') && foundryThreePrimitivesText.includes('position.needsUpdate = true'), 'Foundry path/trail lines retain BufferGeometry and update position attributes in place');
assert(mechanismPreviewText.includes('sweepBounds') && foundry3dText.includes('data-three-fit-bounds=\"phase-invariant-sweep\"'), 'Foundry fitting bounds are sampled in the shared preview utility instead of jittering per animation frame');
assert(foundry3dText.includes('data-three-static-grid-mode=\"persistent-scene-layer\"'), 'Foundry grid and plane live in a persistent scene layer, not the per-frame dynamic group');
assert(mechanismPreviewText.includes('export const fitMechanismSimulation'), 'Foundry fitting/sweep simulation lives in the mechanism preview utility, not as stage-local UI code');
assert(mechanismPreviewText.includes('createMechanismFitContext') && foundry3dText.includes('createMechanismFitContext(') && foundry3dText.includes('sampleIndexedValues('), 'Foundry caches phase-invariant fit bounds and includes a bounded view of the user path in the same fitted coordinate basis');
const foundryCardMechanism = createDefaultMechanism('4bar', 'foundry-card-contract');
const foundryCardContext = createMechanismFitContext(foundryCardMechanism, 180, 96, 96);
const foundryCardSimulation = fitMechanismSimulationWithContext(foundryCardMechanism, 0.75, foundryCardContext);
assert.deepEqual(foundryCardSimulation.pathPoints, foundryCardContext.pathPoints, 'Foundry card previews can reuse the shared fit context path instead of direct per-card resampling');
assert(foundry3dText.includes('buildFoundryPhysicsOverlay') && physicsSessionText.includes('export const buildFoundryPhysicsOverlay'), 'Foundry force/velocity/constraint overlay math lives in PhysicsSession, not the React stage');
assert(
  foundry3dText.includes('const range = useMemo(') &&
    foundry3dText.includes('retainFoundryGestureAnalysis(') &&
    foundry3dText.includes('() => sampleFeasibleRange(landedFoundry, 96)') &&
    foundry3dText.includes('[gestureFoundry, landedFoundry]'),
  'Foundry retains canonical feasibility analysis during direct manipulation and rebuilds the exact 96-sample result after pointerup',
);
assert(
  renderPerformancePolicyText.includes('interface RenderPerformancePolicy') &&
  renderPerformancePolicyText.includes("preset: 'balanced'") &&
  renderPerformancePolicyText.includes("preset: 'high'") &&
  renderPerformancePolicyText.includes('pixelRatioCap: 2') &&
  !renderPerformancePolicyText.includes('navigator') &&
  optionsText.includes('<option value="high">High resolution</option>') &&
  threePreviewText.includes('resolveRenderPerformancePolicy') &&
  threePreviewText.includes('resizeRendererToPerformancePolicy(') &&
  threePreviewText.includes('highResolutionSessionController.snapshot().requestedCap') &&
  threePreviewText.includes("window.addEventListener('resize', resize)") &&
  threePreviewText.includes("window.removeEventListener('resize', resize)") &&
  threeFoundryPreviewText.includes('resolveRenderPerformancePolicy') &&
  threeFoundryPreviewText.includes('resizeRendererToPerformancePolicy(') &&
  threeFoundryPreviewText.includes('highResolutionSessionController.snapshot().requestedCap') &&
  threeFoundryPreviewText.includes('window.addEventListener("resize", resize)') &&
  threeFoundryPreviewText.includes('window.removeEventListener("resize", resize)'),
  'Options exposes the persisted adaptive High resolution preset and both Three viewer engines apply its bounded DPR without User-Agent branching',
);
assert(threePreviewText.includes("setRendererStatus('restoring')") && threePreviewText.includes("setRendererStatus('unavailable')") && threeFoundryPreviewText.includes('setRendererStatus("restoring")') && threeFoundryPreviewText.includes('setRendererStatus("unavailable")') && webglRecoverySpecText.includes('WEBGL_lose_context') && webglRecoverySpecText.includes('WebGL unavailable'), 'Character and Foundry keep controls mounted across unavailable/lost WebGL and production browser coverage restores the same scene');
assert(!threePreviewText.includes('loadRapierPhysicsKernel') && threePreviewText.includes('deferred-to-foundry') && threeFoundryPreviewText.includes('if (!showForces) return;') && threeFoundryPreviewText.includes('loadRapierPhysicsKernel'), 'Character, Path, and ordinary Foundry entry avoid Rapier; explicit Foundry physics diagnostics own the lazy contact-validation load');
assert(threePreviewText.includes("const PUPPET_CAMERA_PRESETS: Viewer3DCameraPreset[] = ['front', 'iso']"), 'puppet viewer toolbar exposes only the fixed 2D and orbitable 3D modes');
assert(threePreviewText.includes('onWheel={handleViewerWheel}') && threePreviewText.includes('data-camera-yaw'), 'puppet 3D canvas exposes direct wheel zoom and orbit state for browser verification');
assert(appStageRouterText.includes('<PathEditor') && !appText.includes('<PathEditor'), 'AppStageRouter delegates Path Editor stage to the extracted PathEditor seam');
assert(designWorkflowPanelText.includes('const DesignRecommendationControl') && designWorkflowPanelText.includes('useState(false)') && designWorkflowPanelText.includes('<MechanismRecommendationSheet') && designWorkflowPanelText.includes('onApply(mechanism)') && designWorkflowPanelText.includes('createMechanismRecommendationWorkerClient') && designWorkflowPanelText.includes('data-recommendation-worker="on-demand"') && !designWorkflowPanelText.includes('prepareMechanismRecommendationWorker') && !mechanismDesignText.includes('useState(false)') && !appWorkspaceShellText.includes('<MechanismRecommendationSheet') && !mechanismRecommendationSheetText.includes('createMechanismRecommendationWorkerClient') && mechanismRecommendationSheetText.includes('workerClient: MechanismRecommendationWorkerClient') && mechanismRecommendationSheetText.includes('mechanismWithGeneratedPath') && mechanismRecommendationJobText.includes('buildMechanismRecommendations') && mechanismRecommendationWorkerClientText.includes('generationId') && mechanismRecommendationWorkerClientText.includes('releaseWorker(worker)') && !mechanismRecommendationWorkerClientText.includes('preparedWorker') && mechanismRecommendationWorkerText.includes('runMechanismRecommendationJob'), 'the Design recommendation control owns modal visibility while each explicit request creates and releases one generation-checked recommendation worker');
assert(appMechanismActionsHookText.includes('createMechanismOptimizerWorkerClient') && appMechanismActionsHookText.includes('cancelMechanismOptimization') && mechanismOptimizerJobText.includes('runMechanismOptimizerSearch') && mechanismOptimizerJobText.includes('fitMechanismInWorkerJob') && mechanismOptimizerWorkerClientText.includes('generationId') && mechanismOptimizerWorkerClientText.includes('releaseWorker(worker)') && !mechanismOptimizerWorkerClientText.includes('preparedWorker') && mechanismOptimizerWorkerText.includes('runMechanismOptimizerJob(data.input') && designInspectorPanelText.includes('data-optimizer-worker="on-demand"') && !designInspectorPanelText.includes('prepareMechanismOptimizerWorker') && designInspectorPanelText.includes('optimizerBusy ? onCancelOptimize : onOptimize') && !appMechanismActionsHookText.includes('for (let i = 0; i < iterations; i++)'), 'Design fitting creates one on-demand worker, runs deterministic search and final path fitting there, then releases the worker on every terminal path');
assert(mechanismFitJobText.includes('fitMechanismInWorkerJob') && mechanismFitJobText.includes("mode === 'path'") && mechanismFitJobText.includes('fitRecommendedMechanismToSheet'), 'path and sheet placement share one serializable fit job authority');
assert(mechanismFitWorkerClientText.includes('active.firstFrame') && mechanismFitWorkerClientText.includes('active.secondFrame') && mechanismFitWorkerClientText.includes('releaseWorker(worker)') && mechanismFitWorkerText.includes('runMechanismFitJob(data.input)') && workflowSpecText.includes('Every visible path-fit trigger owns and releases the shared fit worker'), 'fit jobs wait for two paints, reject stale generations, terminate their heavy worker after completion, and expose production lifecycle evidence');
assert(!designWorkflowPanelText.includes('fitMechanismToTargetPath') && designWorkflowPanelText.includes('createMechanismFitWorkerClient') && !foundry3dText.includes('fitMechanismToTargetPath') && foundry3dText.includes('createMechanismFitWorkerClient'), 'new Design families and Foundry Fit use the same cancellable worker protocol instead of blocking the main thread');
assert(mechanismRecommendationSheetText.includes('RecommendationFitPreview') && mechanismRecommendationSheetText.includes('<MechanismLinkagePreview') && mechanismRecommendationSheetText.includes('<RecommendationMechanismSketch') && mechanismRecommendationSheetText.includes('data-board-cells') && mechanismRecommendationSheetText.includes('data-user-path-preview') && mechanismRecommendationSheetText.includes('data-mechanism-path-preview') && mechanismRecommendationSheetText.includes('renderPolicy.overlayQuality === "full"') && mechanismRecommendationSheetText.includes('data-ghost-preview') && mechanismRecommendationSheetText.includes('data-trace-samples') && mechanismRecommendationSheetText.includes('.slice(0, visibleRecommendationCount)') && mechanismRecommendationSheetText.includes('visibleRecommendationStep - recommendations.length') && recommendationMechanismSketchText.includes('sketchSegments') && recommendationMechanismSketchText.includes('data-mechanism-type'), 'recommendation modal incrementally mounts cards and bounded path previews from the actual joint state while reserving fabrication detail and ghost frames for High quality');
assert(pathCanvasPaneText.includes('path-view-2d') && pathCanvasPaneText.includes('path-view-3d'), 'Path Editor exposes a persistent 2D/3D Path view switch');
assert(pathCanvasPaneText.includes('<DeferredThreePuppetPreview') && pathCanvasPaneText.includes('testId="path-three-puppet"') && pathCanvasPaneText.includes('initialCameraPreset={pathViewMode === "2d" ? "front" : "iso"}'), 'Path Editor defers the shared Three scene while preserving both front 2D and orbitable 3D views');
assert(pathCanvasPaneText.includes('playback={{') && !pathCanvasPaneText.includes('playback={isPlaying ?') && pathCanvasPaneText.includes('sample: (phase) => isPlaying ? playbackSample(phase) : undefined') && pathCanvasPaneText.includes('mechanisms={[]}'), 'Path keeps one shared-clock sampler subscribed before Play, gates idle samples before expensive projection, and excludes mechanism geometry from its authoritative 2D/3D scene');
assert(pathCanvasPaneText.includes('drawMode={pathViewMode === "2d" && drawMode') && pathCanvasPaneText.includes('onDrawPoint={onDrawPoint}') && pathCanvasPaneText.includes('onSelectPathPoint={pathLocked ? undefined : onPathPointPick}'), 'Path Editor keeps drawing and editable path handles on the shared front-view scene');
assert(pathEditorText.includes('createPathGestureDraft()') && pathEditorText.includes('pathGestureDraft.publish') && pathEditorText.includes('pathGestureDraft.flush()') && pathCanvasPaneText.includes('pathGestureDraft={pathGestureDraft}'), 'Path drawing and point dragging use one cadenced renderer draft before committing through the stage action seam');
assert(pathEditorText.includes('pointDragDraftRef.current = points') && pathEditorText.includes('setPathPoints(points, selectedPath.source)') && !pathEditorText.includes('freeDraftRef.current = next;\n    setPathPoints('), 'Path pointer moves update transient refs while pointerup performs the only canonical path write');
assert(threePreviewText.includes('pathGestureDraft.subscribe') && threePreviewText.includes('createThreePathGestureDraftVisual') && threePreviewText.includes('child !== draftGroup'), 'ThreePuppetPreview retains one dynamic draft line/instance buffer instead of rebuilding the canonical path graph during a gesture');
assert(threePreviewText.includes('collectViewerScreenTargets(true)') && threePreviewText.includes('data-three-path-point-screen-targets') && workflowSpecText.includes('Path point drag stays transient and commits one undo entry'), 'E2E-only path handle coordinates verify direct point dragging without adding production collection work');
assert(!pathCanvasPaneText.includes('SceneSketch') && !pathCanvasPaneText.includes('svgRef'), 'Path Editor has no SVG authoring surface or SVG pointer owner');
assert(pathCanvasPaneText.includes('mechanisms={[]}'), 'Path Editor explicitly hides mechanism geometry so the tab shows only character plus path');
assert(pathCanvasPaneText.includes('const pathsToRender = React.useMemo(') && pathCanvasPaneText.includes('paths={pathsToRender}') && pathCanvasPaneText.includes('selectedPathId={selectedPath?.id}'), 'Path Editor 3D passes one identity-stable selected path into the shared preview so Play and Pause do not rebuild path GPU resources');
assert(threePreviewText.includes('paths?: ProjectMotionPath[]') && threePreviewText.includes('pathsLayer') && threePreviewText.includes('path-line-'), 'ThreePuppetPreview renders path geometry as a real 3D layer');
assert(threePreviewText.includes('data-layer-paths={viewer3DLayerDataValue(pathsToRender.length > 0)}'), '3D puppet state exposes the visible path layer when Path Editor passes one');
assert(pathCanvasPaneText.includes('cameraPresets={[pathViewMode === "2d" ? "front" : "iso"]}') && pathCanvasPaneText.includes('showCameraPresets={false}'), 'Path view owns the 2D/3D switch while the shared renderer owns only the selected camera');
assert(!pathCanvasPaneText.includes('drawMode ? <'), 'Draw mode does not mount a special duplicate drawing canvas; it only enables front-view pointer drawing');
assert(pathEditorText.includes('setPathViewMode("2d")'), 'Starting free-path drawing forces Path view back to 2D');
assert(indexText.includes('bottom: calc(var(--ms-bottom-bars-height) + 10px)') && !indexText.includes('--ms-status-bar-height'), 'character import status dock floats 10px above the bottom status area instead of covering the canvas');
assert(indexText.includes('.stage-player-row { position: absolute;') && appUiText.includes('data-testid="workspace-player-drag-handle"'), 'shared animation dock is an overlay with a draggable handle instead of a layout row');
assert(foundry3dText.includes('data-three-pixel-ratio-cap') && threePreviewText.includes('data-three-pixel-ratio-cap'), '3D previews expose the pixel-ratio cap for browser performance checks');
assert(!viewportText.includes('WEBGL_PIXEL_RATIO_CAP') && renderPerformancePolicyText.includes('RENDER_VIEWPORT_PIXEL_BUDGET'), 'render policy is the sole DPR authority and bounds high-DPI viewport allocation');
assert(!foundry3dText.includes('starShape'), 'Foundry sandbox no longer carries saw-tooth star gears');
assert(!foundry3dText.includes('teeth * 2'), 'Foundry sandbox no longer carries sparse saw-tooth gear implementation');
assert(mechanismParamPolicyText.includes('if (key === "gearRatio") return false'), 'Foundry hides stale gear-ratio controls when physical pitch radii define rotation');
assert(mechanismParamPolicyText.includes('if (type === "cam") return false'), 'Foundry/Design hide generic cam dimensions because the cam module is fixed except for profile shape');
assert(mechanismParamPolicyText.includes('if (type === "piston") return false'), 'Foundry/Design hide generic piston dimensions because the slider-crank module is fixed');
assert(mechanismParamPolicyText.includes('if (type === "planetary_gear") return key === "phase"'), 'Foundry/Design hide non-effective planetary dimensions while keeping phase');
const fitContext = createMechanismFitContext(sample.mechanisms[0], 360, 240, 96);
const directFit = fitMechanismSimulation(sample.mechanisms[0], 1.234, 360, 240, 96);
const cachedFit = fitMechanismSimulationWithContext(sample.mechanisms[0], 1.234, fitContext);
assert.deepEqual(cachedFit.pathPoints, directFit.pathPoints, 'cached Foundry fit preserves the direct preview path exactly');
assert(Math.hypot(cachedFit.state.effector.x - directFit.state.effector.x, cachedFit.state.effector.y - directFit.state.effector.y) < 1e-9, 'cached Foundry fit maps the live effector exactly like direct fit');
assert(!threePreviewText.includes('teeth * 2'), '3D preview no longer carries a separate saw-tooth gear implementation');
assert(puppetPartTopologyText.includes('fabricablePartOutlinePoints'), '3D puppet topology preparation uses shared model/user contour outlines instead of raw image crop rectangles');
assert(!packageJson.dependencies['onnxruntime-web'] && !packageJson.devDependencies['onnxruntime-web'], 'the classroom dependency graph excludes ONNX Runtime');
assert(projectText.includes('local-package://${input.sourceImageName}') && !projectText.includes('web-onnx://'), 'new character packages use an honest local-package provenance');
assert(packageJson.scripts.build.includes('check-no-image-recognition.mjs --source') && packageJson.scripts.build.includes('check-no-image-recognition.mjs --dist'), 'the production build fails if image-recognition source or output returns');
assert(!appUiText.includes('onnx-cache-status') && !appUiText.includes('Create from image') && !appUiText.includes('Get AI'), 'runtime UI has no image-recognition entry or download status');
assert(indexText.includes('id="boot-loader"') && indexText.includes('Loading MotionSmith') && indexText.includes('boot-version') && indexText.includes('data-boot-status') && indexText.includes('data-boot-progress'), 'static boot loader covers normal workspace startup with logo, wordmark, version, and progress');
assert(viewer3dText.includes('VIEWER3D_CAMERA_PRESETS') && threePreviewText.includes('three-puppet-view-toolbar') && foundryCameraText.includes('foundryPreset'), '3D puppet and foundry previews share one viewer camera preset contract');
assert(viewer3dText.includes('type Viewer3DContract') && viewer3dText.includes('createViewer3DContract'), '3D viewers expose one shared OOP-style contract object for tab adapters');
assert(threePreviewText.includes('DEFAULT_PUPPET_VIEWER_LAYERS') && threePreviewText.includes('data-testid={`${testId}-toggle-${layer}`}') && foundry3dText.includes('foundry-toggle-grid'), '3D viewer top overlay toolbar wires shared layer toggles instead of decorative buttons');
assert(foundry3dText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}') && threePreviewText.includes('data-viewer-contract={VIEWER3D_CONTRACT_VERSION}'), '3D viewer state exposes a shared contract marker across tabs');
assert(foundry3dText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}') && threePreviewText.includes('data-viewer-contract-state={JSON.stringify(viewerContract)}'), '3D viewer state exposes the normalized tab/layer contract payload for browser checks');
assert(mechanismDesignText.includes('<DesignFoundryPreview') && designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"') && mechanismDesignText.includes('showTrace={showTrace}') && designWorkflowPanelText.includes('data-testid="design-toggle-trace"') && designFoundryPreviewText.includes('data-design-show-trace={showTrace ? "true" : "false"}') && designFoundryPreviewText.includes('data-design-trace-layer={showTrace ? "shown" : "hidden"}') && designFoundryPreviewText.includes('const showMechanismPath = showTrace && showMechanismPathPreview'), 'Mechanism Design center is the integrated automata workbench, and Trace controls real path/trail visibility');
assert(threePreviewText.includes('const mechanismSignature = useMemo(() => mechanismGeometrySignature(renderedMechanisms)') && threePreviewText.includes('mechanism.camProfileSamples?.join') && threePreviewText.includes('[mechanismSignature, project?.settings.physicalKit.gridPitchMm, rendererStatus]') && !threePreviewText.includes('[mechanismSignature, renderedMechanisms, rendererStatus]'), '3D puppet mechanism geometry rebuilds on real topology/fabrication/cam-shape changes, not every scrub-frame prop identity update');
assert(designFoundryPreviewText.includes('showPathPreview={showMechanismPath}') && designFoundryPreviewText.includes('pathTraces={sceneModel.foundryPreview.pointTraces}') && designFoundryPreviewText.includes('data-testid="design-user-path-overlay"'), 'Mechanism Design routes fitted mechanism traces and user path overlays through the Foundry preview seam');
assert(threePreviewText.includes('const mechanismHits = raycaster.intersectObjects([roots.mechanismsLayer], true)') && threePreviewText.includes("const projectedMechanism = bestTarget('mechanism')"), 'Integrated 3D puppet selection supports direct and projected mechanism picking while preserving object and part hit priority');
assert(!`${appText}
${mechanismDesignStageText}
${designFoundryPreviewText}`.includes('hideSceneUnderlay/>'), 'Mechanism Design no longer depends on the legacy 2D design canvas underlay toggle');
assert(threePreviewText.includes('data-three-part-surface="solid-cut-plates"'), '3D puppet preview exposes the solid cut-plate surface contract');
assert(threePreviewText.includes('data-three-part-art="top-texture-decal"'), '3D puppet preview exposes that artwork is rendered on top of plates');
assert(threePreviewText.includes('createPartArtMaterial') && partArtMaterialText.includes('ImageBitmapLoader') && partArtMaterialText.includes('bitmap.close()'), '3D puppet preview decodes surface decals asynchronously and closes owned ImageBitmaps');
assert(threePreviewText.includes('diffPuppetPartTopologies') && threePreviewText.includes('partTopologyIdentitiesRef') && puppetPartTopologyText.includes('preparePuppetPartTopology') && puppetPartTopologyText.includes('samePuppetPartTopologyIdentity') && !threePreviewText.includes('const staleParts = [...roots.partsLayer.children]'), '3D puppet editing retains unchanged plates and replaces only changed outline, hole, or artwork topology');
assert(threePreviewText.includes('new THREE.ShapeGeometry(shape)'), '3D puppet artwork decals are clipped to fabrication part outlines');
assert(threePreviewText.includes('part-art-decal'), '3D puppet preview names surface decal meshes for browser inspection');
assert(threePreviewText.includes('cut-hole-ring'), '3D puppet preview draws raised joint-hole rings on part surfaces');
assert(threePreviewText.includes('transparent: false, opacity: 1'), '3D puppet body plates are opaque assembled solids, not ghost overlays');
const puppetUnmountDisposalIndex = threePreviewText.indexOf('disposePuppetObjectGraph(scene);');
const puppetUnmountSceneReleaseIndex = threePreviewText.indexOf('activePuppetScenes.delete(scene);', puppetUnmountDisposalIndex);
const puppetUnmountCachePruneIndex = threePreviewText.indexOf('pruneSharedGeometryCache(', puppetUnmountSceneReleaseIndex);
const puppetUnmountKitDisposalIndex = threePreviewText.indexOf('disposeMaterials(materialsRef.current);', puppetUnmountCachePruneIndex);
const puppetUnmountRendererReleaseIndex = threePreviewText.indexOf('rendererLease.release();', puppetUnmountKitDisposalIndex);
assert(
  puppetUnmountDisposalIndex >= 0 &&
    !threePreviewText.includes('disposeOwnedMaterials(scene);') &&
    puppetSceneDisposalText.includes('disposeThreeObjectGraph(object') &&
    puppetSceneDisposalText.includes('geometry.userData.sharedFabricationGeometry === true') &&
    puppetSceneDisposalText.includes('disposePartArtMaterial(material)') &&
    puppetUnmountSceneReleaseIndex > puppetUnmountDisposalIndex &&
    puppetUnmountCachePruneIndex > puppetUnmountSceneReleaseIndex &&
    puppetUnmountKitDisposalIndex > puppetUnmountCachePruneIndex &&
    puppetUnmountRendererReleaseIndex > puppetUnmountKitDisposalIndex,
  '3D Puppet unmount disposes owned decals and private geometry in one graph traversal before cache pruning, material-kit disposal, and renderer release',
);
assert(agentsContract.includes('Path Editor must render only character, skeleton, editable path') && agentsContract.includes('Mechanism Design is the first workflow tab that overlays character + path + mechanism together'), 'AGENTS.md locks tab-scoped rendering ownership for Path vs Mechanism Design');
assert(designContract.includes('Getting Started is a compact modal dialog'), 'DESIGN.md separates Getting Started from full-screen onboarding');
assert(designContract.includes('The Character tab is functional'), 'DESIGN.md defines Character as a functional editor tab');
assert(indexText.includes('id="boot-loader"') && indexText.includes('aria-label="Loading MotionSmith"') && indexText.includes('boot-word') && indexText.includes('boot-version') && indexText.includes('Opening workspace'), 'startup uses one static logo/wordmark/version boot loader before the async workspace mounts');
assert(indexText.includes('src-tauri/icons/icon.png'), 'startup boot loader uses the 256px MotionSmith delivery icon');
assert(indexText.includes('#boot-loader .boot-word') && indexText.includes('max-width: calc(100vw - 2rem)') && indexText.includes('white-space: nowrap'), 'startup wordmark is viewport-constrained instead of clipped');
assert(!appText.includes('useAppOnnxBootstrap') && indexTsxText.includes("void import('./App')") && indexTsxText.includes('releaseBootLoader'), 'the workspace releases the static boot loader without mounting an image-recognition bootstrap');
assert(shellUiText.includes('const APP_VERSION = __APP_VERSION__') && shellUiText.includes('workflow-rail-version') && indexText.includes('v%APP_VERSION%'), 'startup boot loader and editor rail show the package version subtly');
assert(indexText.includes('.boot-version') && indexText.includes('.workflow-rail-version'), 'version labels use low-emphasis styling');
assert(appWorkspaceShellText.includes('../src-tauri/icons/icon.png?url') && indexText.includes('.app-header-icon'), 'top bar renders the right-sized MotionSmith delivery icon with dedicated sizing');
assert(indexText.includes("font-family: 'Manrope'") && indexText.includes('fonts/manrope-800-latin.woff2'), 'startup boot loader uses self-hosted Manrope wordmark styling');
assert(!appShellText.includes('welcome-dialog') && !appShellText.includes('Skip forever') && !appShellText.includes('>Start<'), 'startup has no second React welcome modal or persistence/start controls');
assert(indexText.includes('--ms-font-sans') && indexText.includes('font-family: var(--ms-font-sans)') && indexText.includes('.brand-title'), 'global typography uses the shared modern MotionSmith font stack');
assert(appWorkspaceShellText.includes('app-header-home') && appWorkspaceShellText.includes('app-header-actions') && appWorkspaceShellText.includes('quick-toolbar'), 'top app bar separates home, menus, and quick actions into compact zones');
assert(indexText.includes('.app-header-home') && indexText.includes('.app-header-actions') && indexText.includes('border-radius: 999px'), 'top app bar keeps the home control and current stage in one slick editor row');
assert(!appWorkspaceShellText.includes('flex flex-col items-end gap-2'), 'top app bar does not stack menu and quick actions vertically');
assert(appText.includes('useProjectAutosave(project') && appControllerSource.includes('useColdAutosaveRecovery') && appControllerSource.includes('suspended: autosaveRecovery.pending') && coldAutosaveRecoveryHookText.includes('latestProjectRef.current === initialProject') && coldAutosaveRecoveryHookText.includes('client.dispose()') && autosaveRecoveryWorkerClientText.includes('active.firstFrame') && autosaveRecoveryWorkerClientText.includes('active.secondFrame') && autosaveRecoveryWorkerClientText.includes('backend.readRecoverySnapshot()') && autosaveRecoveryWorkerClientText.includes('captureAutosaveRecoveryStorage') && autosaveRecoveryWorkerClientText.includes('autosaveRecoveryStorageIsCurrent') && autosaveRecoveryWorkerText.includes('await import(') && appProjectCommandsHookText.includes('createAutosaveRecoveryWorkerClient') && appProjectCommandsHookText.includes('readWorkspaceLayoutSnapshot') && appProjectCommandsHookText.includes('writeWorkspaceLayoutSnapshot') && appAutosaveHookText.includes('createAutosaveTransaction') && appAutosaveHookText.includes('pagehide') && appAutosaveHookText.includes('beforeunload') && projectPersistenceText.includes('readStorageWithLegacy') && projectPersistenceText.includes('migrateStorageValue') && projectAutosaveFormatText.includes('motionsmith.autosave'), 'cold boot paints an empty ProjectState before a lazy generation-checked recovery worker validates IndexedDB first and migrates legacy browser storage, while explicit recovery and workspace migration remain behind persistence seams');
assert(appAutosaveHookText.includes('project === initialProjectRef.current') && appAutosaveHookText.includes('project === options.recoveredBaseline') && appAutosaveHookText.includes('Autosave failed: Storage full') && appAutosaveHookText.includes('prepareIndexedDbAutosaveBase') && appAutosaveHookText.includes('commitIndexedDbAutosaveSnapshot') && autosaveTransactionText.includes('terminate();') && autosaveTransactionText.includes('projectForPersistence(project)') && autosaveWorkerText.includes('serializeProjectCompact') && autosaveWorkerText.includes('autosaveFingerprint(serialized)') && autosaveIndexedDbText.includes('database.transaction(AUTOSAVE_INDEXED_DB_STORE, "readwrite")') && autosaveIndexedDbText.includes('AUTOSAVE_SNAPSHOT_MAX_BYTES') && autosaveIndexedDbText.includes('AUTOSAVE_JOURNAL_MAX_BYTES') && autosaveIndexedDbText.includes('result = await backend.commit(plan, false)') && projectSerializationText.includes('lastExport: _lastExport') && projectSerializationText.includes('JSON.stringify(versionedProject(project))') && autosaveFingerprintText.includes('UTF-8 byte count without allocating') && projectAutosaveFormatText.includes('retainedGenerations: 1 | 2') && workflowSpecText.includes('Autosave keeps cold boot idle and bounds 1/3/5MB writes at 6x CPU') && workflowSpecText.includes('Autosave quota failure is visible in the status dock'), 'autosave strips transient export bytes before structured clone, ignores the recovered baseline, prepares compact measured bytes in a disposable worker, atomically commits IndexedDB generations under snapshot/journal budgets, reports failure, and drops the optional recovery generation under quota pressure');
assert(!appUiText.includes('MOTIONSMITH_VIDEO_URL'), 'welcome splash does not embed the old preview video');
assert(appUiText.includes('getting-started-dialog') && appUiText.includes('getting-started-gallery'), 'Getting Started is an explicit compact starter dialog');
assert(appUiText.includes('const [showGuided, setShowGuided] = useState(false)') && appUiText.includes('Start.') && appUiText.includes('Pick a project.'), 'Getting Started opens as starter choices and moves guided projects behind the explicit Guide tile');
assert(gettingStartedDialogCommandSource.includes('Starter rig') && gettingStartedDialogCommandSource.includes('Character file') && gettingStartedDialogCommandSource.includes('Open full project') && !gettingStartedDialogCommandSource.includes('>Humanoid<') && !gettingStartedDialogCommandSource.includes('Import project'), 'Getting Started keeps two starter tiles and paired local-file actions compact');
assert(appUiText.includes('getting-started-card-guided') && appUiText.includes('Open Guide') && appUiText.includes('guided-project-library') && appUiText.includes('guided-project-card-${lesson.id}') && appUiText.includes('Don&apos;t show again this session'), 'Getting Started exposes guided projects through a Guide tile with a session-only opt-out while keeping open exploration visible');
assert(appUiText.includes('GuidedLessonMotionPreview') && appUiText.includes('guided-project-preview-${lessonId}') && appUiText.includes('data-preview-mode="rendered-character-motion"') && appUiText.includes('data-motion-preview="character-path"') && appUiText.includes('gearTrainCenters(mechanism)') && indexText.includes('repeat(auto-fit, minmax(13rem, 1fr))') && indexText.includes('.guided-project-preview') && indexText.includes('min-height: min(82vh, 43rem)') && indexText.includes('min-height: 11.25rem'), 'Guide project cards render larger character-motion thumbnails and the Start dialog uses taller starter cards');
assert(gettingStartedDialogCommandSource.includes('createSampleProject') && gettingStartedDialogCommandSource.includes('starterRigPreviewProject') && gettingStartedDialogCommandSource.includes('data-testid="getting-started-guide-preview"') && gettingStartedDialogCommandSource.includes('lessonId="starter-rig"') && indexText.includes('.guide-preview-slot .guided-project-preview'), 'Guide uses the shared gray starter humanoid render as its entry thumbnail');
assert(appUiText.includes('Change') && appUiText.includes('Build') && appUiText.includes('data-change-cue') && appUiText.includes('data-direct-translation') && appUiText.includes('data-evidence-cue') && appUiText.includes('data-expected-answer') && appUiText.includes('data-clip-slot') && gettingStartedDialogCommandSource.includes('starter-card-cues') && gettingStartedDialogCommandSource.includes('Edit one move') && gettingStartedDialogCommandSource.includes('Ready to build'), 'Guided and starter cards show compact action cues while carrying local classroom check/evidence metadata without visible sensemaking text load');
assert(characterLessonOwnershipText.includes('character-make-it-yours') && characterLessonOwnershipText.includes('Make it yours') && characterLessonOwnershipText.includes('data-change-cue={activeClassroomLesson.changeCue}') && characterLessonOwnershipText.includes('data-build-cue={activeClassroomLesson.buildCue}') && characterLessonOwnershipText.includes('Select a part') && characterLessonOwnershipText.includes('Place joints') && characterSelectionText.includes('<CharacterLessonOwnership') && !appText.includes('Change {activeClassroomLesson.changeCue}') && !appText.includes('Build {activeClassroomLesson.buildCue}'), 'Guided lessons land on Character with character-only rigging controls while keeping lesson metadata for later stages');
assert(gettingStartedDialogCommandSource.includes('getting-started-card-humanoid') && !gettingStartedDialogCommandSource.includes('getting-started-card-character') && gettingStartedDialogCommandSource.includes('getting-started-file-actions') && gettingStartedDialogCommandSource.includes('getting-started-open-character') && gettingStartedDialogCommandSource.includes('getting-started-package-input') && indexText.includes('.getting-started-file-actions') && !gettingStartedDialogCommandSource.includes('getting-started-card-image') && !appWorkspaceShellText.includes('showStarterImages'), 'Getting Started keeps only Guide and Starter rig in the gallery while pairing local character and project file actions below');
assert(gettingStartedDialogCommandSource.includes('onSample(starterRigProject)') && gettingStartedDialogCommandSource.includes('starterRigPreviewProject(starterRigProject)') && gettingStartedDialogCommandSource.includes('onLesson(lesson.id, previewProjects[lesson.id]') && appProjectCommandsHookText.includes('preparedProject ?? createSampleProject()') && appProjectCommandsHookText.includes('preparedProject ?? createLessonProject(lesson.id)'), 'starter clicks reuse their already-prepared full serializable ProjectState while rendering a lightweight preview projection instead of rebuilding the project on the interaction path');
assert(!appUiText.includes('Local browser processing') && !appUiText.includes('Load art + skeleton') && !appUiText.includes('Full body rig'), 'Getting Started avoids process/explanation copy');
assert(!appUiText.includes('Crank turns -> rocker swings') && !appUiText.includes('Cam shape -> follower lifts') && !appUiText.includes('Two cranks -> one trace point') && !appUiText.includes('Touching teeth -> spin transfers') && !appUiText.includes('Parts + joints -> motion rig'), 'Getting Started keeps direct-translation sensemaking out of visible first-run copy');
assert(!appUiText.includes('lesson-template-'), 'Getting Started does not use legacy lesson-template cards');
assert(appControllerSource.includes('useProjectHistory(createEmptyProject)') && appProjectHistoryHookText.includes('return { present: createInitialProject(), past: [], future: [] }'), 'App history initializes with an empty ProjectState so browser autosave recovery can replace it only after the first paint');
assert(appProjectCommandsHookText.includes('setProject(createEmptyProject(), { resetHistory: true })'), 'New Project resets to an empty project instead of a starter character');
assert(appProjectCommandsHookText.includes('startTransition(() =>') && appProjectCommandsHookText.includes('setCommandStatus("New project")'), 'New Project paints its status before transitioning a potentially textured scene to empty state');
assert(appProjectCommandsHookText.includes('project.sceneObjectOrder.length > 0') && appProjectCommandsHookText.includes('Object.keys(project.sceneObjects).length > 0'), 'New Project discard confirmation treats Character-created scene objects as user work');
assert(appCharacterImportActionsHookText.includes('returnStage: "character"') && appCharacterImportActionsHookText.includes('requestCharacterPackage(files') && !appCharacterImportActionsHookText.includes('AI could not load'), 'accepted local character packages stay in Character through the import worker without an AI failure path');
assert(characterImportOverlaysText.includes('character-import-review') && characterSelectionText.includes('<CharacterImportStatusDock') && characterSelectionText.includes('<CharacterImportReviewBoundary') && characterSelectionText.includes('project={project}') && !characterSelectionText.includes('reviewedProject={reviewedProject}') && characterImportOverlaysText.includes('showImportChecks = project.settings.debugVisuals') && characterImportOverlaysText.includes('transientProgress !== null || pendingCharacter !== null'), 'Character imports keep the current workbench stable until centered approval, avoid an idle ready-state overlay, then build the accepted character while checks stay dev-only');
assert(appUiText.includes('Dev mode') && !appUiText.includes('Debug visuals'), 'Options expose debug overlays as Dev mode instead of novice-facing debug copy');
assert(!appText.includes('<WelcomeDialog') && !appUiText.includes('WelcomeDialog') && !appText.includes('setShowWelcome') && !appText.includes('setShowGettingStarted(!hideNextTime)') && appText.includes('const [showGettingStarted, setShowGettingStarted] = useState(') && appText.includes('readGettingStartedHiddenForSession'), 'Startup uses the static boot loader only, then opens Getting Started unless the session opt-out is set');
assert(characterImportControlsText.includes('onOpenGettingStarted') && characterImportControlsText.includes('Open Getting Started') && characterSelectionText.includes('<CharacterImportControls'), 'Character tab can reopen Getting Started through extracted import controls without owning its starter gallery');
assert(!appUiText.includes('Start with character art'), 'Character tab no longer carries the old hero/onboarding copy');
assert(!indexText.includes('.onboarding-page'), 'CSS no longer keeps a full-screen onboarding page mode');
assert(!indexText.includes('.welcome-simple'), 'CSS no longer keeps the old welcome video layout');
assert(characterSetupPanelText.includes('character-setup-panel') && characterSelectionText.includes('<CharacterSetupPanel'), 'Character tab exposes direct part settings through the extracted setup panel instead of only getting-started cards');
assert(characterImportControlsText.includes('character-import-controls') && characterImportControlsText.includes('blank-package-input') && characterImportControlsText.includes('onboarding-import-input') && !characterImportControlsText.includes('onnx-input') && !characterImportControlsText.includes('Create from image') && !characterImportControlsText.includes('Keep mechanisms') && characterSelectionText.includes('<CharacterImportControls'), 'Character import controls keep local package/project choosers and exclude image recognition');
assert(characterImportControlsText.includes('character-add-scene-object') && characterImportControlsText.includes('scene-object-image-input') && characterImportControlsText.includes('data-object-image-worker="on-demand"') && characterImportControlsText.includes('accept="image/png,image/jpeg,image/webp,image/svg+xml"') && characterSelectionText.includes('createSceneObjectImageWorkerClient()') && characterSelectionText.includes('objectImageClient.request(file, uid("object")') && characterSelectionText.includes('objectImageClient.dispose()') && sceneObjectImageJobText.includes('contourPoints') && sceneObjectImagePolicyText.includes('Object SVG must be local artwork only.') && sceneObjectImageJobText.includes('Object image could not be saved locally.') && sceneObjectInspectorText.includes('data-testid="scene-object-inspector"') && sceneObjectInspectorText.includes('Object name') && sceneObjectInspectorText.includes('Size · use Scale') && sceneObjectInspectorText.includes('Delete object'), 'Character exclusively owns safe object artwork import through a disposable local worker');
assert(sceneObjectImagePolicyText.includes('compressedBytes: 12 * MEBIBYTE') && sceneObjectImagePolicyText.includes('maxSourcePixels: 4_000_000') && sceneObjectImagePolicyText.includes('maxSourceEdge: 2_048') && sceneObjectImagePolicyText.includes('textureEdge: 512') && sceneObjectImagePolicyText.includes('contourEdge: 160') && sceneObjectImageJobText.includes('new OffscreenCanvas(') && sceneObjectImageJobText.includes('ImageDecoder.isTypeSupported') && sceneObjectImageJobText.includes('decoded.close()'), 'object artwork has Chromebook-bounded source/decode/output dimensions and releases worker-owned decoded frames');
assert(sceneObjectImageWorkerClientText.includes('new URL("../../workers/sceneObjectImageWorker.ts", import.meta.url)') && sceneObjectImageWorkerClientText.includes('active.firstFrame') && sceneObjectImageWorkerClientText.includes('active.secondFrame') && sceneObjectImageWorkerClientText.includes('worker.terminate()') && sceneObjectImageWorkerText.includes('await import(') && !existsSync(join(process.cwd(), 'utils', 'sceneObjectImage.ts')), 'object artwork waits for two paints, lazy-loads its worker job, supersedes stale work, and removes the old main-thread decoder');
assert(threePreviewText.includes('SceneObject') && threePreviewText.includes('objectsLayer') && threePreviewText.includes('object.contourPoints') && threePreviewText.includes('createSceneObjectArtMaterial') && threePreviewText.includes('data-three-scene-prop-count'), 'Shared 3D viewer renders Character-created image-contour scene objects as ProjectState props without adding object-creation controls to later stages');
assert(pathCanvasPaneText.includes('onSelectSceneObject={(objectId)') && designFoundryPreviewText.includes('onAutomataSceneObjectSelect={(objectId)') && designFoundryPreviewText.includes('onAutomataPartSelect={(partId)') && designFoundryPreviewText.includes('onWheel={handleWheel}') && foundry3dText.includes('pickAutomataTarget(event)'), 'Path and Mechanism Design can select and animate Character-created objects without exposing object creation outside Character, while Design routes viewport input through Foundry');
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
assert(partInspectorText.includes('data-testid="part-cut-controls"') && cutOutlineEditorText.includes('data-testid="cut-outline-dialog"') && partInspectorText.includes('Edit cut') && !partInspectorText.includes('Cut point X') && !cutOutlineEditorText.includes('Cut point X'), 'Character part inspector opens a canvas-first cut overlay instead of coordinate controls');
assert(partInspectorText.includes('sourceTextureUrl={sourceTextureUrl}') && cutOutlineEditorText.includes('sourceImageFrame') && cutOutlineEditorText.includes('data-testid="cut-outline-art"') && indexText.includes('.cut-outline-part-window'), 'Character cut editor shows the full source picture behind a zoomed editable contour when available');
assert(partInspectorText.includes('contourSource: "user"') && cutOutlineEditorText.includes('Auto cut') && cutOutlineEditorText.includes('Add point'), 'Character cut editor writes user contours and can bake/add contour points');
assert(cutOutlineEditorText.includes('type CutTool = "edit" | "draw" | "pan"') && cutOutlineEditorText.includes('data-testid={`cut-tool-${id}`}') && cutOutlineEditorText.includes('data-cut-tool={tool}') && cutOutlineEditorText.includes('replacePoints(draw.points, 0)'), 'Character cut editor exposes explicit Edit/Draw/Pan tools and replaces the contour from a one-stroke Draw cut');
assert(cutOutlineEditorText.includes('setPointerCapture') && cutOutlineEditorText.includes('onPointerCancel={stopDrag}') && !cutOutlineEditorText.includes('onPointerLeave={stopDrag}'), 'Character cut editor keeps captured drag-pan/point-drag active when the pointer leaves the SVG edge');
assert(threePreviewText.includes('partMeshesRef.current') && threePreviewText.includes('createPart') && puppetPartTopologyText.includes('partLandmarkLocalPoints'), 'Path Editor renders solid component geometry from the shared Three scene and canonical part landmarks');
assert(!existsSync(join(process.cwd(), 'components', 'stages', 'path', 'PartShape.tsx')), 'Path Editor has no SVG-only part artwork/clip renderer');
assert(designFoundryPreviewText.includes('data-testid="design-shared-foundry-preview"') && designFoundryPreviewText.includes('data-shared-with="foundry-renderer"') && designFoundryPreviewText.includes('sampleReusableAutomataSceneRuntime') && automataSceneModelText.includes('createFoundryMechanismPreviewRuntime') && designFoundryPreviewText.includes('<DeferredThreeFoundryPreview') && !designFoundryPreviewText.includes('data-testid="design-guided-context-overlay"'), 'Mechanism Design shows a retained Foundry-renderer-backed mechanism instance instead of a ghost/private mechanism overlay');
assert(characterSelectionText.includes('Choose new character.'), 'Character tab disables active-project artwork edits while a package review is pending');
assert(characterSelectionText.includes('disabled={partPanelDisabled}') && characterSelectionText.includes('onClick={onEditCharacter}'), 'Pending package review disables active-character edit buttons');
assert(characterSelectionText.includes('disabled={partPanelDisabled}') && characterSelectionText.includes('onClick={onSaveSkeleton}'), 'Pending package review disables active skeleton save controls');
assert(appStageRouterText.includes('stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden'), 'shared workbench prevents right-pane scroll from moving the center canvas');
assert(indexText.includes('.stage-left-pane, .stage-right-inspector { min-height: 0; height: 100%; max-height: 100%; overflow-x: hidden; overflow-y: auto;') && indexText.includes('.character-setup-panel { min-height: 0; overflow: visible;') && indexText.includes('.character-inspector { min-height: 0; overflow: visible; }'), 'right inspector owns the single vertical scroll container for all stages, including Character');
assert(indexText.includes('.workspace { border: 1px solid var(--ms-line); border-radius: 2rem; background: #fff; box-shadow: var(--ms-shadow); }') && !indexText.includes('.workspace { border: 1px solid var(--ms-line); border-radius: 2rem; background: rgba(255,255,255,.92);'), 'large classroom work surfaces use an opaque background without a full-pane backdrop blur');
assert(indexText.includes('.editor-stage-frame[data-stage="foundry"] { contain: layout paint; }') && indexText.includes('.editor-stage-frame[data-stage="foundry"] .stage-left-pane, .editor-stage-frame[data-stage="foundry"] .stage-right-inspector { box-shadow: none; }'), 'Foundry isolates its fixed stage layout and avoids large pane shadows on the cold mount path');
assert(stageLayoutText.includes('progressivePanes = false') && stageLayoutText.includes('setInspectorReady(true)') && stageLayoutText.includes('setWorkflowReady(true)') && stageLayoutText.indexOf('setInspectorReady(true)') < stageLayoutText.indexOf('setWorkflowReady(true)') && stageLayoutText.includes('data-pane-content-ready={workflowReady') && stageLayoutText.includes('data-pane-content-ready={inspectorReady'), 'heavy stages can split inspector and workflow DOM into separate frame commits with explicit readiness');
assert(pathEditorText.includes('className="path-stage-frame"\n      progressivePanes') && mechanismFoundryText.includes('className="foundry-stage-frame"\n      progressivePanes'), 'Path and Foundry use the progressive pane mount boundary on their cold stage path');
assert(appControllerSource.includes('setStage: (nextStage) => startTransition(() => setStage(nextStage))'), 'trusted workflow navigation schedules the heavy stage replacement as a cooperative React transition');
assert(appStageRouterText.includes('startTransition(() => setMountedStage(editorStage))'), 'deferred stage content mounts at transition priority after the two-paint response boundary');
assert(threeFoundryPreviewText.includes('reportedProjectionSizeRef') && threeFoundryPreviewText.includes('Math.abs(reportedProjectionSize.width - width) >= 1'), 'adaptive DPR changes do not enqueue a React projection-size update when the CSS viewport is unchanged');
const paneWheelCaptureCount = stageLayoutText.match(/onWheelCapture={keepPaneWheelOnPane}/g)?.length ?? 0;
assert(stageLayoutText.includes('keepPaneWheelOnPane') && paneWheelCaptureCount >= 2, 'workflow and inspector panes keep wheel scrolling on their panes even when the pointer is over sliders or number fields');
assert(stageLayoutText.includes("const COMPACT_STAGE_NAV_QUERY = '(max-width: 900px)'") && stageLayoutText.includes('useSyncExternalStore(') && stageLayoutText.includes('goStage && showCompactNavigation'), 'desktop stage commits omit the CSS-hidden mobile navigation while the existing 900px breakpoint mounts the same accessible controls');
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
assert(blueprintCanvasBlock.includes('<DeferredThreePuppetPreview') && blueprintCanvasBlock.includes('testId="blueprint-three-puppet"') && blueprintCanvasBlock.includes('initialCameraPreset="front"'), 'Blueprint center canvas defers the canonical shared front-view Three scene until its lightweight controls paint');
assert(!blueprintCanvasBlock.includes('<img') && !blueprintCanvasBlock.includes('alt="Cut sheet"'), 'Blueprint center preview does not expose a broken cut-sheet image placeholder');
assert(blueprintCanvasBlock.includes('data-visual-level="3d-components"') && !blueprintControlPanelText.includes('blueprint-more-exports') && !blueprintControlPanelText.includes('Assembly guide') && !blueprintControlPanelText.includes('Teacher files'), 'Blueprint keeps the physical 3D component scene central and removes secondary teacher/assembly buttons from the primary workflow');
assert(blueprintExportText.includes('<BlueprintControlPanel') && blueprintControlPanelText.includes('data-testid="blueprint-control-panel"') && blueprintControlPanelText.includes('aria-label="Generate package"') && blueprintExportText.includes('<BlueprintDetailPanel') && blueprintDetailPanelText.includes('data-testid="blueprint-stack-summary"'), 'Blueprint left workflow controls/downloads and right recipe detail live outside the stage wrapper behind tested panel seams');
assert(blueprintExportText.includes('createBlueprintPackageWorkerClient()') && !blueprintExportText.includes('createBlueprintPackage(project)') && blueprintControlPanelText.includes('data-blueprint-package-worker="on-demand"') && blueprintControlPanelText.includes('packageStatus === "running" ? "Cancel" : "Make files"'), 'Blueprint package generation paints first, runs on demand in a cancelable worker, and exposes direct status');
assert(blueprintPackageWorkerClientText.includes('new URL("../../workers/blueprintPackageWorker.ts", import.meta.url)') && blueprintPackageWorkerClientText.includes('active.firstFrame') && blueprintPackageWorkerClientText.includes('active.secondFrame') && blueprintPackageWorkerClientText.includes('lastExport: undefined') && blueprintPackageWorkerClientText.includes('lastFoundryExport: undefined') && blueprintPackageWorkerClientText.includes('characterPackage: undefined') && blueprintPackageWorkerClientText.includes('projectWithoutBlueprintArtwork(base)') && blueprintPackageWorkerClientText.includes('restoreBlueprintPackageSceneArtwork') && blueprintPackageTransferText.includes('textureUrl: _textureUrl') && blueprintPackageTransferText.includes('blueprintPackageWithoutSceneArtwork') && blueprintPackageWorkerClientText.includes('worker.terminate()') && blueprintPackageWorkerText.includes('await import('), 'Blueprint package work waits for two paints, keeps canonical artwork out of both worker transfer directions, restores shared references on main, lazy-loads generation code, and releases ownership');
assert(blueprintExportText.includes('requestCustomPartsStl(project') && blueprintControlPanelText.includes('data-blueprint-stl-worker="on-demand"') && blueprintPackageWorkerText.includes('create-custom-parts-stl'), 'Blueprint generates the optional STL only from an explicit cancelable worker request');
assert(blueprintExportText.includes('pkg && exposePackageDiagnostics') && blueprintExportText.includes('__MOTIONSMITH_E2E_DIAGNOSTICS__') && blueprintExportText.includes('__MOTIONSMITH_CHROMEBOOK_AUDIT__') && blueprintExportText.includes('JSON.stringify(pkg)'), 'multi-megabyte package JSON is exposed only in ordinary diagnostics builds, not production or memory-audit DOM');
assert(fabricationCustomPartsText.includes('const boundaryColumns = new Set(') && fabricationCustomPartsText.includes('Math.max(1.5, Math.min(2.75, holeRadiusMm * 1.375))') && fabricationCustomPartsText.includes('maxCells: 100_000') && fabricationCustomPartsText.includes('maxFacets: 20_000') && fabricationCustomPartsText.includes('maxBytes: 1_300_000') && fabricationCustomPartsText.includes('fixedBytes + nextBytes') && b695BlueprintTestText.includes('compacted classroom STL has no open mesh edges'), 'custom-parts STL preflights cell work and bounds conforming strip facets and output bytes');
assert(blueprintModelRuntimeText.includes('const liveRecipes = activeMechanisms.map') && blueprintModelRuntimeText.includes('const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? [])') && !blueprintModelRuntimeText.includes('previewSvg'), 'Blueprint model prepares live fabrication recipes while SVG remains an export-only artifact');
assert(blueprintExportText.includes('selectBlueprintRecipe(recipes, selectedRecipeId, project.selectedMechanismId)') && blueprintExportText.includes('recipes.find((recipe) => recipe.mechanismId === selectedMechanismId)'), 'Blueprint defaults the detail recipe to the selected live mechanism so fitted mechanisms carry into print/build views');
assert(blueprintExportText.includes('<BlueprintDetailPanel') && blueprintDetailPanelText.includes('data-testid="blueprint-sensemaking-label"') && blueprintDetailPanelText.includes('requiredPartCount') && assemblySceneFrameComponentText.includes('data-testid="assembly-scene-sensemaking"') && assemblyInspectorPanelText.includes('data-testid="assembly-sensemaking-label"'), 'Blueprint delegates detail inspector rendering while Blueprint and Assembly reuse mechanism sensemaking metadata for compact visual cues');
assert(blueprintCanvasBlock.includes('<DeferredThreePuppetPreview') && !blueprintCanvasBlock.includes('<Canvas project={project}'), 'Blueprint center canvas reuses the deferred animated 3D/2.5D workbench scene instead of a separate SVG document');
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
assert(blueprintSvgBlock.includes('data-blueprint-visual-mode="print-sheet-hero"') && blueprintSvgBlock.includes('data-blueprint-visual-density="student-simple"') && blueprintSvgBlock.includes('data-blueprint-print-hero') && blueprintSvgBlock.includes('data-blueprint-board-summary') && blueprintSvgBlock.includes('CHARACTER SHEET') && blueprintSvgBlock.includes('MECHANISM PARTS') && blueprintSvgBlock.includes('PRINT · CUT · BUILD') && !blueprintSvgBlock.includes('fabricationBoardColumnLabel(c)') && !blueprintSvgBlock.includes('fabricationBoardRowLabel(r)'), 'Blueprint preview SVG is a student-simple print-sheet-first layout, not a dense board report');
assert(!blueprintSvgBlock.includes('generateCurvePoints') && !blueprintSvgBlock.includes('opacity="0.22"'), 'Blueprint preview SVG avoids foundry path overlays and translucent character ghosts');
assert(blueprintSvgBlock.includes('buildCharacterPrintLayout(project)') && blueprintSvgBlock.includes('layout.pageCount'), 'Blueprint part cut previews reuse the printable character sheet layout instead of a separate screen-only packer');
assert(appStageRouterText.includes('<AssemblyGuide') && !appText.includes('<AssemblyGuide') && !appStageRouterText.includes('const AssemblyGuide = ({') && assemblyGuideText.includes('export const AssemblyGuide'), 'AppStageRouter delegates Assembly Guide stage to an extracted stage seam');
const assemblyBlock = assemblyGuideText;
assert(assemblyBlock.includes('<AssemblyControlPanel') && assemblyBlock.includes('<AssemblyCanvasPane') && assemblyBlock.includes('<AssemblyInspectorPanel') && !assemblyBlock.includes('data-testid="assembly-control-panel"') && !assemblyBlock.includes('data-testid="assembly-guide-preview"'), 'Assembly Guide stage wrapper delegates workflow, canvas, and inspector panes to extracted leaf seams');
assert(assemblyCanvasPaneText.includes('data-testid="assembly-canvas-preview"') && assemblyCanvasPaneText.includes('<AssemblySceneFrame') && !assemblyCanvasPaneText.includes('<AssemblyWorkbench') && !assemblyCanvasPaneText.includes('<CharacterAssemblyWorkbench'), 'Assembly tab renders one Three-backed scene frame instead of a lower SVG workbench');
assert(assemblyCanvasPaneText.includes('<AssemblyCharacterThreePreview') && assemblyCanvasPaneText.includes('<AssemblyMechanismThreePreview') && !assemblyThreePreviewText.includes('ThreePuppetPreview') && assemblyThreePreviewText.includes('ThreeFoundryPreview'), 'Assembly canvas routes character and mechanism build previews through the shared Foundry Three renderer');
assert(assemblyThreePreviewText.includes('data-testid="assembly-character-three-preview"') && assemblyThreePreviewText.includes('data-testid="assembly-mechanism-three-preview"') && assemblyThreePreviewText.includes('assemblySceneFrame={sceneFrame}') && foundryPreviewStateProbeText.includes('data-three-assembly-phase'), 'Assembly Three preview exposes shared Foundry step phase/progress telemetry for both character and mechanism branches');
assert(assemblyThreePreviewText.includes('const stepLift') && assemblyThreePreviewText.includes('playing || progress > 0') && assemblyThreePreviewText.includes('Build animation') && !assemblyThreePreviewText.includes('return 0.72') && assemblyCanvasPaneText.includes('playing={playing}'), 'Assembly Three preview stays assembled by default and only lifts z-stack during animated assembly playback');
assert(assemblySceneFrameText.includes('activeScenePoints') && assemblySceneFrameText.includes('floatingReferencePoints') && foundryAssemblySceneOverlayText.includes('frame.kind === "character"') && foundryAssemblySceneOverlayText.includes('(frame.activeScenePoints ?? []).map(scenePointToPreviewPoint)') && threeFoundryPreviewText.includes('assemblyLift'), 'Character assembly feeds art pins into the Foundry renderer through the scene-to-Foundry coordinate seam and keeps explode_z on z only');
assert(foundryAssemblySceneOverlayText.includes('assembly-15x15-board-surface') && foundryAssemblySceneOverlayText.includes('board.userData.assemblyBoardZ = z') && foundryAssemblySceneOverlayText.includes('kit.boardCells * kit.boardCells') && foundryAssemblySceneOverlayText.includes('new THREE.InstancedMesh') && threeFoundryPreviewText.includes('threeAssemblyBoardSurface'), 'Assembly overlays retain a testable 15x15 board at z=0 and instance its repeated holes in one draw object');
assert(assemblyThreePreviewText.includes('sampleReusableAutomataSceneRuntime') && assemblyThreePreviewText.includes('automataContext={automataContext}') && automataSceneModelText.includes('createFoundryMechanismPreviewRuntime') && !assemblyThreePreviewText.includes('mechanisms={[]}'), 'Assembly character context consumes the retained shared automata/Foundry preview seam instead of private puppet mechanism fallbacks');
assert(assemblyBlock.includes('prepareAssemblyGuideModel') && !assemblyBlock.includes('const liveRecipes = activeMechanisms.map') && assemblyGuideModelText.includes('const liveRecipes = activeMechanisms.map') && assemblyGuideModelText.includes('liveRecipes.length ? liveRecipes : (pkg?.recipes ?? [])'), 'Assembly Guide delegates live recipe fallback to the DOM-free prepared model seam');
assert(assemblyGuideModelText.includes('activeAssemblyMode === "character"') && assemblyCanvasPaneText.includes('buildCharacterAssemblySceneFrame') && assemblyCanvasPaneText.includes('buildMechanismAssemblySceneFrame') && !assemblyCanvasPaneText.includes('{pkg && selectedRecipe && currentStep ?'), 'Assembly animation supports character and mechanism stages through DOM-free scene frames before generating PDF/HTML output');
assert(!existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'AssemblyWorkbench.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'MechanismAssemblyWorkbench.tsx')) && !existsSync(join(process.cwd(), 'components', 'stages', 'assembly', 'CharacterAssemblyWorkbench.tsx')), 'legacy Assembly SVG workbench files are deleted rather than preserved as a second scene authority');
assert(assemblySceneFrameComponentText.includes('data-testid="assembly-readonly-step-strip"') && assemblySceneFrameComponentText.includes('data-assembly-motion-kind') && assemblySceneFrameComponentText.includes('data-mechanism-scene-contract-version'), 'AssemblySceneFrame exposes a testable read-only scene contract strip');
assert(assemblySceneFrameText.includes('export const buildMechanismAssemblySceneFrame') && assemblySceneFrameText.includes('export const buildCharacterAssemblySceneFrame') && !assemblySceneFrameText.includes('document.') && !assemblySceneFrameText.includes('window.'), 'AssemblySceneFrame builders are DOM-free deterministic helpers');
assert(mechanismSceneContractText.includes('export const buildMechanismSceneContract') && mechanismSceneContractText.includes('fabricationRenderPlanForMechanism') && mechanismSceneContractText.includes("stackSource: 'fabricationStackForMechanism'"), 'MechanismSceneContract derives mechanism layers from the same fabrication render plan as Foundry');
assert(assemblyPlaybackText.includes('export const pendingRecipeForMechanism') && assemblyPlaybackText.includes('createFabricationRecipe(project, mechanism)') && assemblyPlaybackText.includes('buildAssemblyPlaybackSteps'), 'Assembly recipe/playback derivation lives outside App.tsx and reuses the export fabrication recipe seam');
assert(assemblyGuideModelText.includes('export const prepareAssemblyGuideModel') && assemblyGuideModelText.includes('export const selectAssemblyGuideStep') && assemblyGuideModelText.includes('export const buildAssemblyGuideModel') && assemblyGuideModelText.includes('pendingRecipeForMechanism') && assemblyGuideModelText.includes('buildCharacterAssemblyPlan') && assemblyGuideModelText.includes('resetKey: `${activeAssemblyMode}:${selectedRecipe?.mechanismId ?? "none"}:${lane}`') && !assemblyGuideModelText.includes('useState') && !assemblyGuideModelText.includes('window.') && !assemblyGuideModelText.includes('document.') && !assemblyGuideModelText.includes('dispatch('), 'Assembly guide model helper separates static preparation from pure current-step selection');
assert(assemblyBlock.includes('const preparedModel = useMemo(') && assemblyBlock.includes('selectAssemblyGuideStep(preparedModel, stepIndex)') && assemblyBlock.includes('useMemo(() => validateForFabrication(project), [project])') && assemblyBlock.includes('createBlueprintPackageWorkerClient()') && !assemblyBlock.includes('createFabricationPackage(project)') && assemblyControlPanelText.includes('data-assembly-package-worker="on-demand"') && assemblyBlock.includes('window.open') && assemblyBlock.includes('downloadText'), 'Assembly Guide memoizes validation and static recipes/steps while package generation reuses the cancelable Blueprint worker');
assert(assemblyPlaybackText.includes("motion: 'explode_z'") && assemblyPlaybackText.includes("motion: 'mount_travel_xy'") && assemblyPlaybackText.includes("motion: 'connect_travel_xy'") && assemblyPlaybackText.includes("motion: 'scrub_time'"), 'Assembly playback declares canonical visual motion modes for every build phase');
assert(assemblyControlPanelText.includes('data-testid="assembly-mode-switch"') && assemblyInspectorPanelText.includes('data-testid="character-assembly-inspector"'), 'Assembly tab exposes a character assembly sub-stage with a compact inspector');
assert(assemblySceneFrameText.includes("step.phase === 'fixed-pins'") && assemblySceneFrameText.includes("step.phase === 'free-pivots'") && assemblySceneFrameText.includes('activePins'), 'Character assembly frame separates fixed board pins from free limb pivots without a second SVG scene');
assert(assemblyControlPanelText.includes('activeAssemblyMode === "mechanism" &&') && assemblyControlPanelText.includes('data-testid="assembly-lane-switch"') && assemblyControlPanelText.includes('assembly-recipe-card text-left'), 'Character assembly mode hides mechanism-only lane and recipe controls');
assert(assemblyPlaybackText.includes('export const buildCharacterAssemblyPlan') && assemblyPlaybackText.includes("kind: 'character'") && assemblyPlaybackText.includes('mechanismAssemblySteps: []') && assemblyPlaybackText.includes('sceneToBoardRaw(joint.position') && assemblyPlaybackText.includes('board?.valid ? board.label : undefined'), 'Character assembly plan is derived separately from mechanism recipe steps and does not fake clamped board holes');
assert(assemblyBlock.includes('useAssemblyGuidePlayback') && !assemblyBlock.includes('stepProgressRef') && !assemblyBlock.includes('window.requestAnimationFrame(tick)'), 'Assembly Guide delegates playback timing/reset choreography to a harnessable hook seam');
assert(assemblyGuidePlaybackHookText.includes('export const useAssemblyGuidePlayback') && assemblyGuidePlaybackHookText.includes('setStepCount(activeStepCount)') && assemblyGuidePlaybackHookText.includes('playbackClock') && assemblyGuidePlaybackHookText.includes('phaseAdvance') && assemblyGuidePlaybackHookText.includes('1400') && !assemblyGuidePlaybackHookText.includes('window.requestAnimationFrame(tick)') && assemblyGuidePlaybackHookText.includes('setPlaying(false)') && !assemblyGuidePlaybackHookText.includes('setStepIndex((index) => (index >= activeStepCount - 1'), 'Assembly playback loops the selected step on the external clock without React step commits and preserves reset-to-stopped behavior');
const assemblyGuideLiveModel = buildAssemblyGuideModel({ project: sample, selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuideLiveModel.selectedRecipe?.mechanismId, sample.mechanisms[0].id, 'Assembly guide model prefers live project mechanisms before package recipes');
assert.equal(assemblyGuideLiveModel.activeAssemblyMode, 'mechanism', 'Assembly guide model defaults to mechanism mode when a live recipe exists');
assert(assemblyGuideLiveModel.activeStepCount > 0 && assemblyGuideLiveModel.resetKey.includes(sample.mechanisms[0].id), 'Assembly guide model exposes active steps and a recipe-keyed reset key');
const secondAssemblyMechanism = mechanismWithGeneratedPath({ ...createDefaultMechanism('4bar', 'selected-assembly-mech'), anchorX: 80, anchorY: 40 });
const selectedAssemblyProject = { ...sample, mechanisms: [...sample.mechanisms, secondAssemblyMechanism], selectedMechanismId: secondAssemblyMechanism.id };
const selectedAssemblyModel = buildAssemblyGuideModel({ project: selectedAssemblyProject, selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(selectedAssemblyModel.selectedRecipe?.mechanismId, secondAssemblyMechanism.id, 'Assembly guide model follows selectedMechanismId so newly fitted mechanisms become the default build target');
const hiddenMechanismProject = { ...fabricationSample, mechanisms: fabricationSample.mechanisms.map(mechanism => ({ ...mechanism, visible: false })) };
const assemblyGuidePackageModel = buildAssemblyGuideModel({ project: hiddenMechanismProject, pkg: createFabricationPackage(fabricationSample), selectedRecipeId: null, assemblyMode: 'mechanism', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuidePackageModel.selectedRecipe?.mechanismId, fabricationSample.mechanisms[0].id, 'Assembly guide model falls back to exported package recipes when no mechanisms are live');
const assemblyGuideCharacterModel = buildAssemblyGuideModel({ project: sample, selectedRecipeId: null, assemblyMode: 'character', lane: 'kit', stepIndex: 0 });
assert.equal(assemblyGuideCharacterModel.activeAssemblyMode, 'character', 'Assembly guide model switches to character assembly when requested and available');
assert(assemblyGuideCharacterModel.currentCharacterStep && assemblyGuideCharacterModel.resetKey.startsWith('character:'), 'Assembly guide model returns character steps and mode-aware reset key');
assert(assemblyBlock.includes('goAssemblyStep={goAssemblyStep}') && !assemblyBlock.includes('data-testid="assembly-player-overlay"'), 'Assembly tab keeps shared player step navigation and no duplicate local player');
assert(assemblySceneFrameText.includes('progress = 0') && assemblySceneFrameComponentText.includes('data-progress={Math.round(frame.progress * 100)}') && assemblyThreePreviewText.includes('data-assembly-three-progress={Math.round(progress * 100)}'), 'Assembly scene frame and Three preview receive live progress instead of moving a duplicate SVG module');
assert(assemblySceneFrameText.includes('motion: step.motion') && assemblySceneFrameText.includes("step.motion === 'explode_z'") && assemblySceneFrameText.includes("step.phase === 'test-character'"), 'Assembly scene frame visualizes parts, mounting, character connection, and test motion through canonical frame motion states');
assert(!assemblyBlock.includes('data-testid="assembly-guide-preview-frame"'), 'Assembly center no longer defaults to an iframe document preview');
assert(assemblyInspectorPanelText.includes('data-testid="assembly-guide-preview"'), 'Assembly tab keeps selected recipe detail in the right inspector');
assert(trackingModalSource.includes("from '../utils/trackingPath'") && !trackingModalSource.includes('segmentsPerEdge = 20'), 'Tracking modal delegates path smoothing/normalization to a DOM-free helper seam');
assert(trackingModalSource.includes('createGifFrameSession') && trackingModalSource.includes('requestVideoFrameCallback') && trackingModalSource.includes('gifBitmapRef.current?.close()') && trackingModalSource.includes('URL.revokeObjectURL') && trackingModalSource.includes('updateTimeline(frame, activePlan.sampledFrames') && !trackingModalSource.includes('updateTimeline(nextFrame') && !trackingModalSource.includes("from 'gifuct-js'") && !trackingModalSource.includes('toDataURL(') && !trackingModalSource.includes('setInterval('), 'Trace playback lazily decodes GIFs, advances the GIF timeline only after bitmap delivery, drives video outside React frame state, and releases bitmap/blob resources');
assert(trackingMediaPolicyText.includes('TRACKING_MEDIA_MAX_EDGE_PX = 1280') && trackingMediaPolicyText.includes('TRACKING_MEDIA_MAX_FPS = 30') && trackingMediaPolicyText.includes('TRACKING_MEDIA_MAX_SAMPLED_FRAMES = 600') && trackingMediaPolicyText.includes('scanTrackingGifMetadata') && trackingMediaPolicyText.includes('assertTrackingGifDecodeInput') && trackingMediaPolicyText.includes('trackingGifFallbackReplayWindow') && gifFrameSessionText.includes('queuedIndex') && gifFrameWorkerText.includes('assertTrackingGifDecodeInput(metadata)') && gifFrameWorkerText.includes('new ImageDecoder({') && gifFrameWorkerText.includes('desiredWidth: initialPlan.width') && gifFrameWorkerText.includes('sourceCanvas = new OffscreenCanvas(plan.width, plan.height)') && gifFrameWorkerText.includes('TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES') && gifFrameWorkerText.includes("await import('gifuct-js')") && gifFrameWorkerText.includes('transferToImageBitmap()'), 'Trace GIF decoding rejects raw timelines above 600 before decode, scans metadata without retaining raw frame objects, scales native decode inputs, bounds fallback replay/canvases, and streams one in-flight coalesced ImageBitmap');
assert.deepEqual(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], { enabled: true }), [{ x: 0, y: 0 }, { x: 10, y: 0 }], 'tracking smoothing leaves short manual paths unchanged');
assert.equal(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { connectEndPoints: true, segmentsPerEdge: 2 }).length, 6, 'closed tracking smoothing samples every wrapped segment');
assert.equal(smoothTrackingPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { connectEndPoints: false, segmentsPerEdge: 2 }).length, 5, 'open tracking smoothing samples edge segments and preserves the final point');
assert.deepEqual(
  trackingPointsToWorldPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], { enabled: false, connectEndPoints: true }),
  [{ x: -90, y: 45 }, { x: 90, y: 45 }, { x: 90, y: -45 }, { x: -90, y: -45 }, { x: -90, y: 45 }],
  'tracking path transfer centers, scales, flips Y, and closes the polyline exactly once'
);
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
assert(oversizedOutlineBounds.width < 90 && oversizedOutlineBounds.height < 260, 'fabrication-fit outline follows the limb joint chain rather than the full imported-image crop');
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
assert(productionArmLandmarks.length === 2, 'production 3D outline path ignores unrelated joints inside an oversized imported-image crop');
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
const rightBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: 1 } });
const leftBendProject = applyProjectAction(sample, { type: 'update_joint', jointId: 'right_elbow', updates: { bendDirection: -1 } });
const rightBendPreview = motionPreviewForTarget(rightBendProject, 'right_arm_lower', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: rightBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
const leftBendPreview = motionPreviewForTarget(leftBendProject, 'right_arm_lower', 'right_hand', { x: 180, y: 90 }, { parts: {}, skeleton: leftBendProject.skeleton }, { rootJointId: 'right_shoulder', pinTarget: true });
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
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_arm_lower']
});
const roundTrip = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
assert.equal(roundTrip.partOrder.length, sample.partOrder.length, 'project JSON round-trip keeps parts');
assert.equal(roundTrip.mechanisms.length, sample.mechanisms.length, 'project JSON round-trip keeps mechanisms');
assert.equal(roundTrip.mechanisms[0].assemblyMode, sample.mechanisms[0].assemblyMode, 'project JSON round-trip keeps explicit 4bar assembly branch');
assert.equal(loadProjectSnapshot({ mechanisms: [{ ...createDefaultMechanism('4bar', 'crossed-load'), assemblyMode: 'crossed' }] }).mechanisms[0].assemblyMode, 'crossed', 'project import preserves crossed 4bar assembly branch');

const originBoard = sceneToBoard({ x: 0, y: 0 }, sample.settings.physicalKit);
assert.equal(originBoard.label, 'H8', 'scene origin maps to centered 15x15 board H8');
const sheetRoundTrip = sheetMmToScene(sceneToSheetMm({ x: 40, y: -80 }, sample.settings.physicalKit), sample.settings.physicalKit);
assert(Math.hypot(sheetRoundTrip.x - 40, sheetRoundTrip.y + 80) < 1e-9, 'scene/sheet transform round-trips');
const boardRoundTrip = boardToScene(originBoard.col, originBoard.row, sample.settings.physicalKit);
assert.deepEqual(boardRoundTrip, { x: 0, y: 0 }, 'board center round-trips');

const secondFourBarPath = {
  ...fabricationSample.paths['fabrication-fit-path'],
  id: 'fabrication-fit-elbow-path',
  targetAnchorJointId: 'right_elbow',
};
const secondFourBarFit = fitMechanismToTargetPath(
  {
    ...fabricationSample,
    mechanisms: [],
    paths: { ...fabricationSample.paths, [secondFourBarPath.id]: secondFourBarPath },
  },
  {
    ...fabricationSample.mechanisms[0],
    id: 'b',
    targetPathId: secondFourBarPath.id,
    targetAnchorJointId: 'right_elbow',
  },
  secondFourBarPath.id,
);
assert.equal(secondFourBarFit.fabricationMetadata?.pathFit?.status, 'fit', 'second target driver gets its own validated path fit');
const twoFourBars = {
  ...fabricationSample,
  paths: { ...fabricationSample.paths, [secondFourBarPath.id]: secondFourBarPath },
  mechanisms: [
    { ...fabricationSample.mechanisms[0], id: 'a' },
    secondFourBarFit,
  ]
};
const pkg = createFabricationPackage(twoFourBars);
const pkgWithExplicitStl = createFabricationPackage(twoFourBars, { includeCustomPartsStl: true });
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
const editedAssemblyRecipe = directCreateFabricationRecipe(editedAssemblyProject, editedAssemblyMechanism);
const editedAssemblyHtml = directMakeAssemblyGuideHtml(editedAssemblyProject, [editedAssemblyRecipe], []);
assert(editedAssemblyHtml.includes('Input 5-hole link') && editedAssemblyHtml.includes('Coupler 7-hole link') && !editedAssemblyHtml.includes('Input 3-hole link'), 'Assembly exploded guide reads edited recipe stack labels instead of recomputing default four-bar sizes');
const camBlueprintProject = { ...sample, mechanisms: [boundMechanism('cam', 'blueprint-cam-module')] };
const camBlueprintRecipe = directCreateFabricationRecipe(camBlueprintProject, camBlueprintProject.mechanisms[0]);
const camBlueprintPreview = directMakeBlueprintPreviewSvg(camBlueprintProject, [camBlueprintRecipe]);
assert(camBlueprintPreview.includes('data-blueprint-icon="cam-module"'), 'Blueprint preview draws cam module parts with a distinct cam icon');
assert(camBlueprintPreview.includes('data-blueprint-icon="guide-cartridge"'), 'Blueprint preview draws the U-channel guide cartridge with a distinct guide icon');
assert(camBlueprintPreview.includes('data-blueprint-icon="gravity-follower"'), 'Blueprint preview draws the gravity follower with a distinct follower icon');
const editedCamBlueprintProject = { ...sample, mechanisms: [{ ...boundMechanism('cam', 'blueprint-cam-edited'), camProfileSamples: [0.72, 1.48, 0.7, 0.56, 0.82, 1.08, 0.74, 0.62] }] };
const editedCamBlueprintRecipe = directCreateFabricationRecipe(editedCamBlueprintProject, editedCamBlueprintProject.mechanisms[0]);
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
const multiCamBlueprintRecipes = multiCamBlueprintProject.mechanisms.map(mechanism => directCreateFabricationRecipe(multiCamBlueprintProject, mechanism));
const multiCamAssemblyHtml = directMakeAssemblyGuideHtml(multiCamBlueprintProject, multiCamBlueprintRecipes, []);
assert(multiCamAssemblyHtml.includes(secondCamProfile.join(',')), 'Assembly guide includes the edited cam profile even when the cam recipe is not the first recipe');
const twoCamProfiles = [[0.82, 1.4, 0.74, 0.66, 0.92, 1.18, 0.9, 0.72], [1.08, 0.8, 1.34, 0.7, 0.86, 1.26, 0.76, 0.94]];
const twoCamBlueprintProject = {
  ...sample,
  mechanisms: twoCamProfiles.map((profile, index) => ({ ...boundMechanism('cam', `blueprint-cam-${index + 1}`), camProfileSamples: profile }))
};
const twoCamBlueprintRecipes = twoCamBlueprintProject.mechanisms.map(mechanism => directCreateFabricationRecipe(twoCamBlueprintProject, mechanism));
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
const idlerGearBlueprintRecipe = directCreateFabricationRecipe(idlerGearBlueprintProject, idlerGearBlueprintProject.mechanisms[0]);
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
assert.equal(pkg.customPartsStl, '', 'ordinary fabrication packages omit the optional custom-parts STL');
assert.equal(directMakeCustomPartsStl(twoFourBars), pkgWithExplicitStl.customPartsStl, 'an explicit fabrication package request preserves the direct custom parts STL artifact');
assert(pkg.customPartsSvg.startsWith('<svg') && pkg.customPartsSvg.includes('custom-parts'), 'fabrication package includes custom parts SVG artifact');
assert(pkg.customPartsSvg.includes(`width="${twoFourBars.settings.physicalKit.sheetWidthMm}mm"`) && pkg.customPartsSvg.includes(`data-character-print-page-count="${characterPrintLayout.pageCount}"`), 'character custom parts SVG is fixed to one or two letter-size pages');
assert(pkg.customPartsSvg.includes(`viewBox="0 0 ${twoFourBars.settings.physicalKit.sheetWidthMm} ${twoFourBars.settings.physicalKit.sheetHeightMm * characterPrintLayout.pageCount}"`), 'character custom parts SVG uses stacked letter page coordinate systems');
assert(pkg.customPartsSvg.includes('data-character-print-page="letter"') && pkg.customPartsSvg.includes('data-character-print-mode="whole-character-exploded"'), 'character custom parts SVG declares whole-character exploded print mode');
assert(pkg.customPartsSvg.includes('data-character-exploded-sheet'), 'character custom parts SVG groups all parts on one exploded sheet');
visibleCharacterPartIds.forEach(partId => {
  assert(pkg.customPartsSvg.includes(`data-part-id="${partId}"`), `character custom parts SVG includes visible part ${partId} on the bounded character sheet`);
});
assert(pkg.customPartsPdf.startsWith('%PDF-') && pkg.customPartsPdf.includes('character-sheet-page-count'), 'fabrication package includes a bounded character PDF artifact');
assert(pkgWithExplicitStl.customPartsStl.startsWith('solid motionsmith_custom_parts'), 'explicit fabrication packages include the custom parts STL artifact');
assert(pkgWithExplicitStl.customPartsStl.includes('mm_holes') && (pkgWithExplicitStl.customPartsStl.match(/facet normal/g) ?? []).length > 100, 'custom parts STL meshes extruded plates with joint-hole voids');
assert(pkg.metadataJson.includes('validationIssues'), 'fabrication metadata includes structured validation issues');
assert(pkg.recipes.every(r => r.requiredParts.length > 0), 'fabrication recipes include explicit required parts');
assert.deepEqual(pkg.recipes[0].requiredParts, mechanismRequiredParts(twoFourBars.mechanisms[0]), 'recipe required parts mirror mechanism metadata defaults');
assert(pkg.recipes[0].requiredParts.some(part => part.name === FABRICATION_SPACER_SPEC.label), 'required parts name the S10 spacer explicitly');
assert(pkg.recipes[0].assemblySteps.some(step => step.label === 'Set ground pivots' || step.instruction.includes('Pin ground pivots')), 'prefab board workflow uses mechanism-reference assembly steps');
assert(pkg.recipes[0].assemblySteps.some(step => step.stack?.some(item => item.label === FABRICATION_SPACER_SPEC.label)), 'prefab board workflow calls out S10 spacer layers in the reference stack');
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
assert(pkg.assemblyGuideHtml.includes('<strong>Target:</strong> Right lower arm') && pkg.assemblyGuideHtml.includes('fabrication-fit-path') && pkg.assemblyGuideHtml.includes('right_hand'), 'assembly guide keeps compact target/path/anchor connection details');
assert(pkg.assemblyGuidePdf.includes('Target: Right lower arm') && pkg.assemblyGuidePdf.includes('fabrication-fit-path'), 'assembly guide PDF keeps offline target/path connection details');
assert(FABRICATION_RENDER_LAYER_Z_STEP >= FABRICATION_RENDER_PART_DEPTH + FABRICATION_RENDER_MIN_CLEARANCE, 'fabrication render z step includes part thickness plus spacer clearance');
assert.equal(renderPlanLayerZStep, FABRICATION_RENDER_LAYER_Z_STEP, 'fabricationRenderPlan preserves public layer z-step behind the fabrication facade');
assert.equal(renderPlanPartDepth, FABRICATION_RENDER_PART_DEPTH, 'fabricationRenderPlan preserves public part depth behind the fabrication facade');
assert.equal(renderPlanMinClearance, FABRICATION_RENDER_MIN_CLEARANCE, 'fabricationRenderPlan preserves public spacer clearance behind the fabrication facade');

AUTHORABLE_MECHANISM_TYPES.forEach(type => {
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
    assert(Math.max(Math.abs(camGuideZ - camDiskZ), Math.abs(camFollowerZ - camDiskZ)) < FABRICATION_RENDER_LAYER_Z_STEP, 'cam module render plan keeps guide/follower near the cam disk instead of serially floating out from the board');
  } else {
    assert.deepEqual(zValues, [...zValues].sort((a, b) => a - b), `${type} render plan z order follows stack order`);
    const zGaps = zValues.slice(1).map((z, index) => Number((z - zValues[index]).toFixed(2)));
    assert(zGaps.every(gap => gap >= FABRICATION_RENDER_LAYER_Z_STEP), `${type} render plan leaves spacer clearance between every z layer`);
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
const projectionProject = applyProjectAction(fabricationSample, { type: 'set_export', fabricationPackage: createFabricationPackage(fabricationSample) });
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
assert(projectionProject.partOrder.filter(id => projectionProject.parts[id].visible !== false).every(id => projection.nodes.some(node => node.id === `/character/${id}` && node.sourceType === 'part' && node.sourceId === id)), 'toon projection includes every visible body part');
const projectionSceneObjectProject = applyProjectAction(sample, { type: 'upsert_scene_object', object: createDefaultSceneObject('piggy-bank', 'object-projection') });
const projectionSceneObject = buildToonSceneProjection(projectionSceneObjectProject).nodes.find(node => node.sourceType === 'scene-object' && node.sourceId === 'object-projection');
assert(projectionSceneObject && projectionSceneObject.id === '/scene-objects/object-projection' && !projectionSceneObject.interactive && projectionSceneObject.exportRole === 'project-reference', 'toon projection includes Character-created scene objects as read-only project-reference nodes');
assert(Object.keys(projectionProject.skeleton?.joints ?? {}).every(id => projection.nodes.some(node => node.id === `/skeleton/${id}` && node.sourceType === 'joint' && node.sourceId === id)), 'toon projection includes every skeleton joint');
const sampleBoneIds = new Set((projectionProject.skeleton?.bones ?? []).map(([parentId, childId]) => `${parentId}->${childId}`));
assert([...sampleBoneIds].every(id => projection.nodes.some(node => node.sourceType === 'bone' && node.sourceId === id)), 'toon projection includes every skeleton bone with tuple sourceId');
projection.nodes.filter(node => node.sourceType === 'bone').forEach(node => {
  const [parentId, childId] = (node.sourceId ?? '').split('->');
  assert(projectionProject.skeleton?.joints[parentId] && projectionProject.skeleton?.joints[childId] && sampleBoneIds.has(node.sourceId ?? ''), 'bone sourceId maps to a real skeleton bone tuple');
});
Object.values(projectionProject.paths).filter(path => path.visible && path.points.length).forEach(path => {
  assert(projection.nodes.some(node => node.id === `/paths/${path.id}` && node.sourceType === 'path' && node.sourceId === path.id), 'toon projection includes visible motion path');
});
projectionProject.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).forEach(mechanism => {
  assert(projection.nodes.some(node => node.id === `/mechanisms/${mechanism.id}/base` && node.sourceType === 'mechanism' && node.sourceId === mechanism.id), 'toon projection includes mechanism base');
  assert(projection.nodes.some(node => node.id === `/mechanisms/${mechanism.id}/output` && node.sourceType === 'mechanism' && node.sourceId === mechanism.id), 'toon projection includes mechanism output');
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
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand'
};
const sceneAnchorProjection = buildToonSceneProjection({ ...sample, mechanisms: [sceneAnchorOnlyMechanism] });
const sceneAnchorBase = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/base');
const sceneAnchorOutput = sceneAnchorProjection.nodes.find(node => node.id === '/mechanisms/scene-anchor-only/output');
assert(sceneAnchorBase?.geometry.kind === 'circle' && sceneAnchorOutput?.geometry.kind === 'circle', 'sceneAnchor-only mechanism projects base and output circles');
assert.deepEqual(sceneAnchorBase.geometry.center, sceneAnchorOnlyMechanism.sceneAnchor, 'projection base uses resolved sceneAnchor');
assert.equal(sceneAnchorOutput.geometry.center.x, sceneAnchorOnlyMechanism.sceneAnchor.x + sceneAnchorOnlyMechanism.crankLength, 'projection linkage uses the same resolved sceneAnchor for kinematics');
assert.equal(sceneAnchorOutput.geometry.center.y, sceneAnchorOnlyMechanism.sceneAnchor.y, 'projection linkage does not fall back to origin when anchorX/Y are absent');
const disabledMechanismProject = {
  ...fabricationSample,
  mechanisms: [
    { ...fabricationSample.mechanisms[0], id: 'enabled-one' },
    { ...fabricationSample.mechanisms[0], id: 'disabled-one', enabled: false },
    { ...fabricationSample.mechanisms[0], id: 'hidden-one', visible: false }
  ]
};
assert.equal(createFabricationPackage(disabledMechanismProject).recipes.length, 1, 'fabrication exports only visible enabled mechanisms');
assert.equal(loadProjectSnapshot(disabledMechanismProject).mechanisms[1].enabled, false, 'project import preserves disabled mechanism state');
const disabledDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: disabledMechanismProject.mechanisms }, 0);
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
      targetPartId: 'right_arm_lower',
      targetPathId: 'path-right-arm',
      targetAnchorJointId: 'right_hand',
      activeVisualPartIds: ['right_arm_lower']
    })]
  };
  const templateProjection = buildToonSceneProjection(templateProject);
  const templateLabel = mechanismTemplateLabel(type);
  assert(templateProjection.nodes.some(node => node.sourceType === 'mechanism' && node.sourceId === mechanism.id && node.label.includes(templateLabel)), `${type} projects 2.5D nodes with shared template labels`);
  assert(templateProjection.nodes.some(node => node.sourceType === 'hardware' && node.parentId === `/mechanisms/${mechanism.id}/base` && node.label.includes(templateLabel)), `${type} projects a mechanism hardware preview`);
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
const assertDistance = (a: { x: number; y: number }, b: { x: number; y: number }, expected: number, label: string, epsilon = 1e-6) => {
  assert(Math.abs(distance(a, b) - expected) < epsilon, label);
};
const localTrack = (mechanism: ReturnType<typeof createDefaultMechanism>, point: { x: number; y: number }) => {
  const angle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
  const dx = point.x - (mechanism.anchorX ?? 0);
  const dy = point.y - (mechanism.anchorY ?? 0);
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
  assert.deepEqual(requiredPartQuantities('4bar'), { 'L2 linkage': 2, 'L4 linkage': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, '4bar recipe defaults use L2/L4/S10 required parts from mechanism-reference');
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
    mechanismRequiredParts(resizedFourBar).filter(part => part.category === 'linkages').map(part => `${part.name}:${part.quantity}`).sort(),
    ['L4 linkage:2', 'L6 linkage:1'],
    '4bar required parts follow selected link-hole sizes instead of the static recipe'
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
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'piston crank length is preserved');
    assertDistance(state.j1, state.j2, mechanism.couplerLength, 'piston connecting rod length is preserved');
    assert(Math.abs(localTrack(mechanism, state.j2).y - mechanism.sliderOffset) < 1e-6, 'piston slider stays on its guide offset');
  });
  assert.equal(referenceRecipeForType('piston').canonicalKey, 'slider_crank', 'piston recipe is normalized to slider_crank in mechanism-reference');
  assert(requiredPartNames('piston').includes('3-hole bracket'), 'piston slider_crank recipe includes a fixed guide bracket');
  assert(requiredPartNames('piston').includes('2-hole bracket'), 'piston slider_crank recipe includes a moving slider block');
}

{
  const mechanism = createDefaultMechanism('yoke', 'contract-yoke-unsupported');
  assert.deepEqual(requiredParts('yoke'), [], 'scotch yoke has no required parts until a mechanism-reference recipe exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Scotch yoke needs recipe')), 'scotch yoke produces a fabrication validation error instead of pretending to be ready');
}

{
  const mechanism = createDefaultMechanism('quick-return', 'contract-quick-return-unsupported');
  assert.deepEqual(requiredParts('quick-return'), [], 'quick-return has no required parts until a mechanism-reference recipe exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Quick-return needs recipe')), 'quick-return produces a fabrication validation error instead of pretending to be ready');
}

{
  const mechanism = createDefaultMechanism('5bar', 'contract-5bar-simulation-only');
  assert.deepEqual(requiredParts('5bar'), [], '5bar has no required parts until synchronized dual-driver fabrication is specified');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Five-bar needs recipe')), '5bar produces a fabrication validation error instead of pretending to be ready');
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
  const mechanism = createDefaultMechanism('6bar', 'contract-6bar-simulation-only');
  assert.deepEqual(requiredParts('6bar'), [], '6bar has no required parts until a real board/part/stack recipe is specified');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Six-bar needs recipe')), '6bar produces a fabrication validation error instead of pretending to be ready');
  assert.deepEqual(fabricationStackForMechanism(mechanism), [], '6bar has no fabrication stack without a mechanism-reference recipe');
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
  assert(localTrack(custom, calculateLinkage(custom, Math.PI / 4).j2).x > localTrack(mechanism, calculateLinkage(mechanism, Math.PI / 4).j2).x, 'edited cam lobe changes the follower lift used by simulation');
  const defaultCamExportPath = generateSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  const customCamExportPath = generateSVG({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).match(/data-export-kind="cam-profile" d="([^"]+)"/)?.[1];
  assert(defaultCamExportPath && customCamExportPath && defaultCamExportPath !== customCamExportPath, 'cam SVG export uses edited cam profile samples');
  assert(generateDXF({ speed: 1, rotation: 0, mechanisms: [custom] }, 0).includes('CONTRACT-CAM-PHYSICAL_CAM'), 'cam DXF export includes an explicit sampled cam profile layer');
  assert(localTrack(mechanism, high.j2).x > localTrack(mechanism, low.j2).x, 'cam follower lift increases along the guide');
  assert(Math.abs(localTrack(mechanism, low.j1).y) < 1e-6, 'cam contact point sits on the follower guide axis');
  assert(Math.abs(localTrack(mechanism, low.j2).y) < 1e-6, 'gravity follower center stays on the guide axis');
  assertDistance(low.j1, low.j2, mechanism.sliderOffset, 'capsule follower head remains one follower radius from the sampled cam surface');
  const contactProfileAngle = ((mechanism.groundAngle ?? 90) * Math.PI) / 180 - (Math.PI / 2);
  assertDistance(low.p1, low.j1, mechanism.crankLength * sampledCamProfileScale(contactProfileAngle, mechanism.camProfileSamples), 'cam contact radius samples the rendered profile at the guide direction');
  assert(low.aux && distance(low.p1, low.aux) > 0, 'cam kinematics preserves a separate drive-angle reference instead of reusing the follower contact as rotation');
  const camRecipe = referenceRecipeForType('cam');
  assert.equal(camRecipe.title, 'Pegboard-mounted gravity cam follower module', 'cam recipe exposes the pegboard-mounted gravity module name');
  assert.equal(camRecipe.physicsRule, 'rotating cam contact + vertical prismatic follower + gravity preload', 'cam physics rule maps to rotating cam, prismatic follower, contact, and gravity');
  assert.deepEqual(requiredPartQuantities('cam'), {
    'Axle peg': 1,
    'Crank handle': 1,
    'Cam lock disk': 1,
    'Paper washer': 3,
    'Cam spacer': 1,
    'Swappable cam disk': 1,
    'U-channel guide cartridge': 1,
    'Preassembled gravity follower module': 1
  }, 'cam recipe uses pegboard axle, swappable disk, guide cartridge, and gravity follower modules');
  const camRenderPlan = fabricationRenderPlanForMechanism(mechanism);
  const camDiskZ = camRenderPlan.layers.find(layer => layer.label === 'Swappable cam disk')?.z;
  const camGuideZ = camRenderPlan.layers.find(layer => layer.label === 'U-channel guide cartridge')?.z;
  const camFollowerZ = camRenderPlan.layers.find(layer => layer.label === 'Preassembled gravity follower module')?.z;
  assert(typeof camDiskZ === 'number' && typeof camGuideZ === 'number' && typeof camFollowerZ === 'number', 'cam render plan exposes disk, guide, and follower module layers');
  assert(Math.max(Math.abs(camGuideZ - camDiskZ), Math.abs(camFollowerZ - camDiskZ)) < FABRICATION_RENDER_LAYER_Z_STEP, 'cam guide and gravity follower stay in the compact board-mounted cam plane instead of floating as a full serial z-stack');
  assert.deepEqual(camRecipe.stackLabels, ['15x15 pegboard base', 'Axle peg', 'Crank handle', 'Paper washer', 'Cam spacer', 'Swappable cam disk', 'Paper washer', 'Cam lock disk', 'U-channel guide cartridge', 'Preassembled gravity follower module'], 'cam stack labels document the pegboard base plus plug-in modules');
  const camRecipeText = JSON.stringify(camRecipe);
  assert(!/S10 spacer|Eccentric cam|Round follower|2-hole bracket|rubber band|spring|metal bearing|plastic spacer|backplate|free-floating loose rail/i.test(camRecipeText), 'cam recipe data blocks the old stack and excluded hardware');
}

{
  const mechanism = createDefaultMechanism('rack-pinion', 'contract-rack-pinion-unsupported');
  assert.deepEqual(requiredParts('rack-pinion'), [], 'rack-pinion has no required parts until a kit part contract exists');
  assert(fabricationRenderPlanForMechanism(mechanism).validationErrors.some(error => error.includes('Rack-pinion has no mechanism-reference recipe')), 'rack-pinion produces a fabrication validation error instead of pretending to be ready');
}

{
  const mechanism = createDefaultMechanism('gear', 'contract-gear-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear train default has valid sampled poses');
    assertDistance(state.p1, state.j1, mechanism.crankLength, 'gear input pitch radius is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'gear output pitch radius is preserved');
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
  const unequalGear = { ...mechanism, crankLength: 30, rockerLength: 60, groundLength: 90, gearRatio: -99, speed2: -99 };
  const unequalStart = calculateLinkage(unequalGear, 0);
  const unequalQuarter = calculateLinkage(unequalGear, Math.PI / 2);
  assert(Math.hypot(unequalQuarter.j2.x - unequalStart.j2.x, unequalQuarter.j2.y - unequalStart.j2.y) > 1, 'two-gear mesh output follows the physical pitch ratio');
  assertDistance(unequalQuarter.p1, unequalQuarter.p2, gearTrainPitchCenterDistance(unequalGear), 'two-gear configs collapse to direct pitch contact for plain gear trains');
  const g5 = gearSceneRadiusByKey('g40');
  const g1 = gearSceneRadiusByKey('g8');
  const g3 = gearSceneRadiusByKey('g24');
  const compoundGear = normalizeGearTrainToFabrication({ ...mechanism, crankLength: g5, rockerLength: g3, gearTrainRadii: [g5, g1, g3], groundLength: 999 });
  const compoundQuarter = calculateLinkage(compoundGear, Math.PI / 2);
  const compoundOutputAngle = Math.atan2(compoundQuarter.j2.y - compoundQuarter.p2.y, compoundQuarter.j2.x - compoundQuarter.p2.x);
  assertDistance(compoundQuarter.p1, compoundQuarter.p2, g5 + g1 + g1 + g3, 'compound gear train pitch centers accumulate adjacent fabrication gear radii');
  assert(Math.abs(compoundOutputAngle - gearTrainOutputRatio(compoundGear) * Math.PI / 2) < 1e-6, 'compound gear train output follows idler parity and endpoint pitch-radius ratio');
  assert.equal(gearTrainOutputRatio(compoundGear), g5 / g3, 'three-gear train has same output direction because the idler flips twice');
  assert(fabricationStackForMechanism(compoundGear).some(layer => layer.label === 'Idler G1 / 1-space gear 1'), 'compound gear fabrication stack preserves the selected idler gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G5 / 5-space gear')?.quantity, 1, 'compound gear train parts include the selected drive gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G1 / 1-space gear')?.quantity, 1, 'compound gear train parts include the selected idler gear size');
  assert.equal(mechanismRequiredParts(compoundGear).find(part => part.name === 'G3 / 3-space gear')?.quantity, 1, 'compound gear train parts include the selected output gear size');
  const driverOffsetState = calculateLinkage({ ...mechanism, driverPhaseOffset: Math.PI / 4 }, 0);
  assert(Math.abs(Math.atan2(driverOffsetState.j1.y - driverOffsetState.p1.y, driverOffsetState.j1.x - driverOffsetState.p1.x) - Math.PI / 4) < 1e-6, 'driver phase offset rotates the input driver before downstream constraints solve');
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
  const gearOnlySvg = generateSVG({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  const gearOnlyDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: [mechanism] }, 0);
  assert(!gearOnlySvg.includes('<line'), 'gear train SVG export is gears-only without fake linkage rods');
  assert(!gearOnlyDxf.includes('\nLINE\n'), 'gear train DXF export is gears-only without fake linkage rods');
  assert((gearOnlySvg.match(/<path d="/g) ?? []).length >= 2, 'gear train SVG export still carries endpoint gear outlines');
  assert.deepEqual(requiredPartQuantities('gear'), { 'G3 / 3-space gear': 2, [FABRICATION_SPACER_SPEC.label]: 8 }, 'gear train recipe uses two G3 gears and S10 spacers from mechanism-reference');
}

{
  const mechanism = createDefaultMechanism('gear_linkage', 'contract-gear-linkage-physical');
  [0, Math.PI / 2, Math.PI].forEach(angle => {
    const state = calculateLinkage(mechanism, angle);
    assert(state.isValid, 'gear-linkage default has valid sampled poses');
    assertDistance(state.p1, state.j1, mechanism.couplerPointDist, 'gear-linkage drive gear off-center handle radius is preserved');
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'gear-linkage G3 endpoint centers preserve the separated board span');
    assertDistance(state.p2, state.j2, mechanism.couplerPointDist, 'gear-linkage output gear off-center handle radius is preserved');
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
  assert.deepEqual(requiredPartQuantities('gear_linkage'), { 'G3 / 3-space gear': 2, 'L4 linkage': 2, [FABRICATION_SPACER_SPEC.label]: 8 }, 'gear-linkage recipe uses two G3 gears, two L4 crank links, and S10 spacers without an output bracket');
  const dynamicGearLinkageParts = mechanismRequiredParts({ ...mechanism, gearTrainRadii: [gearSceneRadiusByKey('g40'), gearSceneRadiusByKey('g8'), gearSceneRadiusByKey('g56')], couplerLength: linkageSceneLengthByCells(6) });
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G5 / 5-space gear')?.quantity, 1, 'gear-linkage required parts preserve a selected large drive gear');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G1 / 1-space gear')?.quantity, 1, 'gear-linkage required parts preserve selected idler gears');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'G7 / 7-space gear')?.quantity, 1, 'gear-linkage required parts preserve a selected attachment-capable output gear');
  assert.equal(dynamicGearLinkageParts.find(part => part.name === 'L6 linkage')?.quantity, 2, 'gear-linkage required parts preserve the selected paired linkage size');
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
    assertDistance(state.p1, state.p2, mechanism.groundLength, 'planetary carrier radius is preserved');
    assertDistance(state.p2, state.j2, mechanism.rockerLength, 'planet gear radius is preserved');
    assertDistance(state.p1, state.effector, mechanism.couplerPointDist, 'planetary carrier output radius is preserved');
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
  const offsetPlaybackCarrierTrace = generateFoundryPlaybackPointTraces(offsetMechanism, 96).traces.find(trace => trace.id === 'C');
  assert(offsetPlaybackCarrierTrace, 'Foundry planetary playback traces include the visible carrier path');
  const offsetGeneratedPathMechanism = mechanismWithGeneratedPath(offsetMechanism);
  const offsetGeneratedPath = offsetGeneratedPathMechanism.generatedPath ?? [];
  assert.equal(offsetGeneratedPath.length, offsetPlaybackCarrierTrace.points.length, 'planetary generatedPath stores the visible Foundry carrier trace length');
  const offsetTraceHalfIndex = Math.floor(offsetPlaybackCarrierTrace.points.length / 2);
  const offsetTraceHalfPoint = offsetPlaybackCarrierTrace.points[offsetTraceHalfIndex];
  assert(Math.hypot(offsetTraceHalfPoint.x - offsetCarrierState.p2.x, offsetTraceHalfPoint.y - offsetCarrierState.p2.y) < 1e-6, 'Foundry planetary traces sample the same playback-mapped carrier frame used by the renderer');
  assert(Math.hypot(offsetGeneratedPath[offsetTraceHalfIndex].x - offsetTraceHalfPoint.x, offsetGeneratedPath[offsetTraceHalfIndex].y - offsetTraceHalfPoint.y) < 1e-6, 'planetary generatedPath is sourced from the Foundry carrier path, not raw sun-input sampling');
  const mappedOffsetCarrierTrace = offsetPlaybackCarrierTrace.points.map(offsetFitContext.map);
  const offsetOverlay = buildFoundryPhysicsOverlay(offsetMechanism, { ...offsetCarrierFrame.simulation, pathPoints: mappedOffsetCarrierTrace }, offsetCarrierFrame.playbackPhaseRad, sample.settings, mappedOffsetCarrierTrace);
  const wrappedOffsetTracePoint = (index: number) => mappedOffsetCarrierTrace[((index % mappedOffsetCarrierTrace.length) + mappedOffsetCarrierTrace.length) % mappedOffsetCarrierTrace.length];
  const expectedOverlayDelta = {
    x: wrappedOffsetTracePoint(offsetTraceHalfIndex + 1).x - wrappedOffsetTracePoint(offsetTraceHalfIndex - 1).x,
    y: wrappedOffsetTracePoint(offsetTraceHalfIndex + 1).y - wrappedOffsetTracePoint(offsetTraceHalfIndex - 1).y
  };
  assert.equal(offsetOverlay.playIndex, offsetTraceHalfIndex, 'Foundry planetary overlay indexes the visible carrier cycle, not raw sun-input cycles');
  assert((offsetOverlay.velocityRaw.x * expectedOverlayDelta.x + offsetOverlay.velocityRaw.y * expectedOverlayDelta.y) > 0, 'Foundry planetary overlay velocity follows the playback-mapped carrier trace');
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
  assert(!offsetFoundryWorkflow.includes('foundry-mini-simulation-planetary_gear'), 'Foundry hides the disabled planetary template card while retaining its renderer and imported-project contracts');
  Array.from({ length: 8 }, () => generateSmartConfig(undefined, 'planetary_gear')).forEach(config => {
    assert(Math.abs(config.groundLength - (config.crankLength + config.rockerLength)) < 1e-6, 'optimizer keeps generated planetary pitch circles tangent');
  });
  assert.deepEqual(requiredPartQuantities('planetary_gear'), { 'R56 internal ring gear': 1, 'G1 / 1-space gear': 1, 'G3 / 3-space gear': 1, 'L2 linkage': 1, [FABRICATION_SPACER_SPEC.label]: 8 }, 'planetary recipe uses R56 ring, G1 sun, G3 planet, L2 carrier, and S10 from mechanism-reference');
  assert.deepEqual(
    referenceRecipeForType('planetary_gear').stackLabels,
    ['R56 internal ring gear', 'G1 / 1-space gear', 'L2 carrier linkage', 'G3 / 3-space gear'],
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
let exportedProject = applyProjectAction(fabricationSample, { type: 'set_export', fabricationPackage: createFabricationPackage(fabricationSample) });
assert(exportedProject.lastExport, 'set_export stores generated fabrication package');
const persistedExportedProject = JSON.parse(serializeProject(exportedProject)) as ProjectState;
assert.equal(persistedExportedProject.lastExport, undefined, 'portable persistence omits transient generated fabrication files');
assert.deepEqual(persistedExportedProject.mechanisms, JSON.parse(JSON.stringify(exportedProject.mechanisms)), 'omitting transient export files preserves canonical mechanism state');
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
const objectPathMechanismProjectWithSampleMechanism = applyProjectAction(objectOwnedPathProject, {
  type: 'upsert_mechanism',
  mechanism: {
    ...createDefaultMechanism('4bar', 'object-path-driver'),
    targetPartId: 'right_arm_lower',
    targetSceneObjectId: 'object-piggy',
    targetPathId: 'path-object-piggy',
    targetAnchorJointId: 'right_hand',
    anchorX: 0,
    anchorY: 0,
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    sceneAnchor: { x: 0, y: 0 }
  }
});
const objectPathMechanismProject = {
  ...objectPathMechanismProjectWithSampleMechanism,
  mechanisms: objectPathMechanismProjectWithSampleMechanism.mechanisms.filter(m => m.id === 'object-path-driver')
};
const objectPathMechanism = objectPathMechanismProject.mechanisms.find(m => m.id === 'object-path-driver')!;
assert.equal(objectPathMechanism.targetSceneObjectId, 'object-piggy', 'mechanism target resolves to the scene object when its path is object-owned');
assert.equal(objectPathMechanism.targetPartId, undefined, 'object-target mechanisms clear stale body-part targets');
assert.equal(objectPathMechanism.targetAnchorJointId, undefined, 'object-target mechanisms do not keep stale skeleton handles');
assert.deepEqual(mechanismBindingWarnings(objectPathMechanismProject, [objectPathMechanism]), {}, 'object-target mechanism accepts a matching object-owned path');
const objectPathRecommendations = buildMechanismRecommendations(objectOwnedPathProject, undefined, objectOwnedPathProject.paths['path-object-piggy']);
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
assert.equal(deletedObjectPathProject.mechanisms.find(m => m.id === 'object-path-driver')?.targetSceneObjectId, undefined, 'deleting a scene object detaches object-target mechanisms');
const deletedObjectPathSentinelProject = applyProjectAction(objectPathSentinelProject, { type: 'delete_scene_object', objectId: 'object-piggy' });
assert.deepEqual(deletedObjectPathSentinelProject.mechanisms.find(m => m.id === 'object-path-driver')?.generatedPath, objectGeneratedPathSentinel, 'detaching an object target preserves fitted generatedPath samples for Design recovery');
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
assert.notDeepEqual(objectPathGeometryProject.mechanisms.find(m => m.id === 'object-path-driver')?.generatedPath, objectGeneratedPathSentinel, 'object-path geometry edits invalidate stale fitted generatedPath samples');
const deletedSceneObject = applyProjectAction(roundTripSceneObject, { type: 'delete_scene_object', objectId: 'object-piggy' });
assert(!deletedSceneObject.sceneObjects['object-piggy'], 'scene object delete removes the prop without touching character parts');
const deletedPathProject = applyProjectAction(sample, { type: 'delete_path', pathId: 'path-right-arm' });
assert(!deletedPathProject.paths['path-right-arm'], 'path editor delete removes path data instead of leaving an empty path');
assert.equal(deletedPathProject.mechanisms[0].targetPathId, undefined, 'deleting a path detaches mechanisms from stale targetPathId');
const partPathId = 'fabrication-fit-path';
const partPathSentinelProject = { ...fabricationSample, mechanisms: [{ ...fabricationSample.mechanisms[0], generatedPath: objectGeneratedPathSentinel }] };
assert.deepEqual(applyProjectAction(partPathSentinelProject, { type: 'delete_path', pathId: partPathId }).mechanisms[0].generatedPath, objectGeneratedPathSentinel, 'detaching a part path preserves fitted generatedPath samples');
assert.deepEqual(
  applyProjectAction(partPathSentinelProject, { type: 'upsert_path', path: { ...partPathSentinelProject.paths[partPathId], visible: false } }).mechanisms[0].generatedPath,
  objectGeneratedPathSentinel,
  'metadata-only part-path edits preserve fitted generatedPath samples'
);
assert.notDeepEqual(
  applyProjectAction(partPathSentinelProject, { type: 'upsert_path', path: { ...partPathSentinelProject.paths[partPathId], points: partPathSentinelProject.paths[partPathId].points.map(point => ({ x: point.x + 500, y: point.y })) } }).mechanisms[0].generatedPath,
  objectGeneratedPathSentinel,
  'part-path geometry edits invalidate stale fitted generatedPath samples'
);
assert.equal(sample.settings.timingProfile, 'linear', 'options include a persisted timing profile');
assert.equal(sample.settings.theme, 'light', 'settings default to the light novice UI theme');
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
assert.equal(optionsRoundTrip.settings.autosaveIntervalSeconds, 3, 'autosave interval round-trips');
assert.equal(optionsRoundTrip.settings.gridUnit, 'inch', 'grid unit setting round-trips');
assert.equal(optionsRoundTrip.settings.fabricationReadyMode, false, 'fabrication-ready mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.exportMode, 'prefab-board', 'blueprint export workflow mode round-trips');
assert.equal(optionsRoundTrip.settings.physicalKit.cutSheetFileType, 'svg', 'cut-sheet file type round-trips');
assert(sample.characterPackage?.partsInfo && sample.characterPackage.charCfg, 'sample project carries character package review artifacts');
const detachedMechanismProject = { ...sample, mechanisms: [createDefaultMechanism('4bar', 'detached')] };
assert(validateForFabrication(detachedMechanismProject).errors.some(e => e.includes('choose target + path')), 'fabrication blocks detached visible mechanisms');
const noEnabledMechanismProject = { ...sample, mechanisms: sample.mechanisms.map(m => ({ ...m, enabled: false })) };
assert(validateForFabrication(noEnabledMechanismProject).errors.some(e => e.includes('No enabled mechanism')), 'fabrication blocks zero-recipe blueprint packages');
assert.throws(() => createFabricationPackage(noEnabledMechanismProject), /No enabled mechanism/, 'fabrication package refuses zero-recipe output');
const impossibleMechanismProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'impossible'), anchorX: -80, anchorY: -80, groundLength: 10, crankLength: 10, couplerLength: 10, rockerLength: 1000 }] };
assert(validateForFabrication(impossibleMechanismProject).errors.some(e => e.includes('No motion')), 'fabrication blocks mechanisms with no motion');
const offGridProject = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'off-grid'), anchorX: -70, anchorY: -80 }] };
assert(validateForFabrication(offGridProject).errors.some(e => e.includes('off grid')), 'fabrication blocks off-grid anchors instead of rounding silently');
assert(!validateForFabrication(offGridProject).errors.some(e => e.includes('path outside sheet')), 'fabrication reports the snap-to-hole problem before derived path footprint problems for off-grid anchors');
const simulationOnlyOffGridProject = { ...offGridProject, settings: { ...sample.settings, fabricationReadyMode: false } };
assert(validateForFabrication(simulationOnlyOffGridProject).errors.some(e => e.includes('off grid')), 'simulation-only mode still blocks board-invalid fabrication output');
assert.throws(() => createFabricationPackage(simulationOnlyOffGridProject), /off grid/, 'fabrication export never rounds an off-grid mechanism silently');
const camWrongBoardProject = {
  ...sample,
  settings: { ...sample.settings, physicalKit: physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit) },
  mechanisms: [boundMechanism('cam', 'cam-wrong-board')]
};
assert(validateForFabrication(camWrongBoardProject).errors.some(e => e.includes('cam module needs 15x15 board')), 'fabrication rejects cam modules outside the fixed 15x15 pegboard contract');
const edgeCamAnchor = boardToScene(14, 14, sample.settings.physicalKit);
const edgeCamProject = { ...sample, mechanisms: [{ ...boundMechanism('cam', 'cam-edge'), anchorX: edgeCamAnchor.x, anchorY: edgeCamAnchor.y }] };
assert(validateForFabrication(edgeCamProject).errors.some(e => e.includes('assembly holes off board')), 'fabrication blocks cam modules whose translated guide/axle holes leave the 15x15 board');
assert.throws(() => createFabricationPackage(edgeCamProject), /assembly holes off board/, 'fabrication package refuses cam modules with off-board translated assembly holes');
REFERENCE_EXPORT_READY_TYPES.forEach(type => {
  const edgeMechanism = boundMechanism(type, `edge-board-hole-${type}`);
  const edgeProject = { ...sample, mechanisms: [{ ...edgeMechanism, anchorX: edgeCamAnchor.x, anchorY: edgeCamAnchor.y }] };
  assert(validateForFabrication(edgeProject).errors.some(e => e.includes('assembly holes off board')), `${type} fabrication validation checks every translated board-fixed hole at the board edge`);
});
const recipeWithPath = createFabricationPackage(fabricationSample).recipes[0];
assert.equal(recipeWithPath.targetPathId, 'fabrication-fit-path', 'fabrication recipe preserves target path metadata');
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
const sampleAssemblyGuideHtml = createFabricationPackage(fabricationSample).assemblyGuideHtml;
assert(sampleAssemblyGuideHtml.includes('assembly guide'), 'fabrication package includes printable assembly guide');
assert(sampleAssemblyGuideHtml.includes('<strong>Board:</strong>'), 'assembly guide labels the mechanism board explicitly');
assert(!sampleAssemblyGuideHtml.includes('Board coordinate:'), 'assembly guide does not label moving-reference callouts as board coordinates');
assert(sampleAssemblyGuideHtml.includes('link joint reference') || sampleAssemblyGuideHtml.includes('gear handle reference') || sampleAssemblyGuideHtml.includes('carrier reference'), 'assembly guide surfaces moving-reference coord roles instead of board-only labels');
const warningPackage = createFabricationPackage({
  ...fabricationSample,
  mechanisms: [{ ...fabricationSample.mechanisms[0], warnings: ['project warning should appear in guide'] }]
});
assert(warningPackage.recipes[0].warnings.includes('project warning should appear in guide'), 'fabrication recipe preserves mechanism warnings');
assert(warningPackage.assemblyGuideHtml.includes('project warning should appear in guide'), 'assembly guide preserves mechanism warnings');
const boardCircles = [...pkg.svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="(?:2|5)"/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
assert.equal(boardCircles.length, sample.settings.physicalKit.boardCells ** 2, 'fabrication SVG renders one board hole per cell');
assert(Math.abs(boardCircles[0].x - sceneToSvg(boardToScene(0, 0, sample.settings.physicalKit)).x) < 1e-9, 'fabrication board hole uses shared boardToScene x');
assert(Math.abs(boardCircles[sample.settings.physicalKit.boardCells].x - boardCircles[0].x - sample.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM) < 1e-9, 'fabrication board hole pitch matches grid pitch');
assert.equal(physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit).boardCells, 12, 'profile selector applies complete physical kit preset');
const evenBoardKit = physicalKitPreset('letter-12x12-2cm', sample.settings.physicalKit);
assert.deepEqual(boardToScene(0, 0, evenBoardKit), { x: -220, y: 220 }, '12x12 board is centered between its four middle holes');
assert.deepEqual(boardToScene(11, 11, evenBoardKit), { x: 220, y: -220 }, '12x12 board keeps symmetric edge coordinates');
assert(sceneToBoardRaw(boardToScene(6, 6, evenBoardKit), evenBoardKit).valid, '12x12 centered coordinate conversion stays on an actual board hole');
assert.equal(boardGridLines(sample.settings.physicalKit).length, sample.settings.physicalKit.boardCells * 2, 'UI grid reuses one board grid definition');

const invalid = {
  ...sample,
  mechanisms: [{ ...boundMechanism('4bar', 'off'), anchorX: 9999, anchorY: 9999 }]
};
assert.equal(sceneToBoardRaw({ x: 9999, y: 9999 }, sample.settings.physicalKit).valid, false, 'raw board detects invalid anchor');
assert(validateForFabrication(invalid).errors.some(e => e.includes('off board')), 'fabrication rejects off-board anchor');
const missingAnchor = { ...sample, mechanisms: [{ ...boundMechanism('4bar', 'missing-anchor'), anchorX: undefined, anchorY: undefined }] };
assert(validateForFabrication(missingAnchor).errors.some(e => e.includes('missing board anchor')), 'fabrication rejects missing board coordinate');
assert.throws(() => createFabricationPackage(missingAnchor), /missing board anchor/, 'fabrication package does not silently place missing anchors at origin');
const importedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorX;
delete (importedMissingAnchor.mechanisms[0] as unknown as Record<string, unknown>).anchorY;
const reloadedMissingAnchor = loadProjectSnapshot(JSON.parse(serializeProject(importedMissingAnchor)));
assert(validateForFabrication(reloadedMissingAnchor).errors.some(e => e.includes('missing board anchor')), 'imported snapshot with missing anchors remains invalid for fabrication');

const removed = applyProjectAction(sample, { type: 'remove_joint', jointId: 'right_elbow' });
assert.notEqual(removed.parts.right_arm_lower.anchorJointId, 'right_elbow', 'joint delete repairs part anchors');
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
const maliciousSvg = generateSVG({ speed: 1, rotation: 0, mechanisms: malicious.mechanisms }, 0);
const maliciousDxf = generateDXF({ speed: 1, rotation: 0, mechanisms: [{ ...malicious.mechanisms[0], id: 'bad\n0\nSCRIPT' }] }, 0);
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
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.generatedPath?.length, foundryPath.length, 'upserting foundry export preserves package path');
assert.equal(foundryUpsert.mechanisms.find(m => m.id === 'foundry-upsert')?.foundryExport?.metadata.selectedPreset, 'balanced', 'foundry export preserves preset metadata');
const generatedPathSentinel = [{ x: 12345, y: 67890 }, { x: 12365, y: 67880 }, { x: 12330, y: 67875 }];
const generatedPathSelectionProject = applyProjectAction(fabricationSample, {
  type: 'set_mechanisms',
  mechanisms: [{ ...fabricationSample.mechanisms[0], id: 'selection-generated-path', foundryExport: undefined, generatedPath: generatedPathSentinel }],
  selectedMechanismId: 'selection-generated-path'
});
assert.deepEqual(generatedPathSelectionProject.mechanisms[0].generatedPath, generatedPathSentinel, 'selecting a mechanism preserves stored fitted generated paths even without Foundry export metadata');
const anchorOverride = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: { ...sample.mechanisms[0], targetAnchorJointId: 'right_elbow' } });
assert.equal(anchorOverride.mechanisms[0].targetAnchorJointId, 'right_elbow', 'mechanism target anchor override survives reducer reconciliation');
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
const lockedPathAttempt = applyProjectAction(lockedPartProject, { type: 'upsert_path', path: { ...sample.paths['path-right-arm'], points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } });
assert.deepEqual(lockedPathAttempt.paths['path-right-arm'].points, sample.paths['path-right-arm'].points, 'locked parts reject path edits');
assert(applyProjectAction(lockedPartProject, { type: 'delete_path', pathId: 'path-right-arm' }).paths['path-right-arm'], 'locked parts reject path deletion');
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
assert(validateForFabrication(wrongTarget).errors.some(e => e.includes('belongs to left_arm_lower')), 'fabrication rejects mismatched target part/path');
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
const rootOnlyPath = { ...ikProject.paths['path-right-arm'], chainRootJointId: 'right_elbow', targetAnchorJointId: 'right_elbow' };
const rootOnlyPreview = motionPreviewForPath(ikProject, rootOnlyPath, 0);
assert(Math.hypot((rootOnlyPreview.skeleton?.joints.right_elbow.position.x ?? 0) - rootOnlyPath.points[0].x, (rootOnlyPreview.skeleton?.joints.right_elbow.position.y ?? 0) - rootOnlyPath.points[0].y) < 1e-9, 'root-only IK translates the selected whole part so its handle follows the path point');
assert(rootOnlyPreview.parts.right_arm_lower && rootOnlyPreview.parts.right_arm_lower.transform.x !== ikProject.parts.right_arm_lower.transform.x, 'root-only IK preview moves the visible whole part instead of returning a static preview');
const drivenMechanism = {
  ...createDefaultMechanism('crank', 'drive-effector'),
  anchorX: ikProject.paths['path-right-arm'].points[0].x + 30,
  anchorY: ikProject.paths['path-right-arm'].points[0].y - 20,
  crankLength: 10,
  targetPartId: 'right_arm_lower',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_arm_lower']
};
const drivenProject: ProjectState = { ...ikProject, mechanisms: [drivenMechanism] };
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
assert(Math.hypot((generatedPathDrivenPreview.skeleton?.joints.right_hand.position.x ?? 0) - mechanismState.effector.x, (generatedPathDrivenPreview.skeleton?.joints.right_hand.position.y ?? 0) - mechanismState.effector.y) < 1e-9, 'mechanism design IK target follows the physical linkage even when a stale generated path is present');
assert(Math.hypot((generatedPathDrivenPreview.skeleton?.joints.right_hand.position.x ?? 0) - generatedPathPoint.x, (generatedPathDrivenPreview.skeleton?.joints.right_hand.position.y ?? 0) - generatedPathPoint.y) > 20, 'stored generated paths cannot override the physical linkage target');
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
const optimizedObjectResult = runMechanismOptimizerJob(createMechanismOptimizerJobInput(
  { ...objectPathMechanismProject, settings: { ...objectPathMechanismProject.settings, performancePreset: 'fast' } },
  objectPathMechanism,
  'path-object-piggy',
  1,
));
assert.equal(optimizedObjectResult.mechanism.targetSceneObjectId, 'object-piggy', 'Design Fit optimizes against the selected mechanism object target instead of the ambient selected part');
assert.equal(optimizedObjectResult.mechanism.targetPartId, undefined, 'Design Fit keeps object-target mechanisms free of body-part retargeting');
assert.equal(optimizedObjectResult.mechanism.targetPathId, 'path-object-piggy', 'Design Fit keeps the selected mechanism target path');
const sampleMechanism = fabricationSample.mechanisms[0];
assert(sampleMechanism, 'fabrication sample has a mechanism for driven-target checks');
for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
  const state = calculateLinkage(sampleMechanism, phase);
  const preview = motionPreviewForProject(fabricationSample, fabricationSample.mechanisms, phase);
  const targetJointId: string = preferredMotionJointId(fabricationSample, sampleMechanism.targetPartId, sampleMechanism.targetAnchorJointId)!;
  const targetJoint = preview.skeleton?.joints[targetJointId]?.position;
  const physicalTarget = mechanismTracePointForState(sampleMechanism.type, state, sampleMechanism.fabricationMetadata?.pathFit?.outputTraceId);
  assert(physicalTarget, 'sample mechanism has a physical linkage target');
  assert(state.isValid && targetJoint, 'sample mechanism has a valid driven target joint');
  assert(Math.hypot(targetJoint!.x - physicalTarget.x, targetJoint!.y - physicalTarget.y) < 1e-9, 'sample mechanism keeps its driven joint pinned to the physical linkage through the whole scrub range');
}
const conflictProject: ProjectState = { ...drivenProject, mechanisms: [drivenMechanism, { ...drivenMechanism, id: 'second-driver', anchorX: drivenMechanism.anchorX + 8 }] };
const conflicts = mechanismBindingWarnings(conflictProject);
assert(conflicts['drive-effector']?.some(w => w.includes('also drives right_arm_lower:right_shoulder:right_hand')), 'first duplicate driver receives explicit conflict warning');
assert(conflicts['second-driver']?.some(w => w.includes('also drives right_arm_lower:right_shoulder:right_hand')), 'second duplicate driver receives explicit conflict warning');
assert(validateForFabrication(conflictProject).errors.some(e => e.includes('only one mechanism can own a target anchor')), 'blueprint export blocks ambiguous duplicate target drivers');
const exportedForSettings = applyProjectAction(fabricationSample, { type: 'set_export', fabricationPackage: createFabricationPackage(fabricationSample) });
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
if (existsSync(join(process.cwd(), 'dist'))) {
  execFileSync('bun', ['scripts/check-no-image-recognition.mjs', '--dist'], { cwd: process.cwd(), stdio: 'pipe' });
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

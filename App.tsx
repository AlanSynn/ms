import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  AssemblyWorkbench,
  CharacterAssemblyWorkbench,
} from "./components/stages/assembly/AssemblyWorkbench";
import { BlueprintExport } from "./components/stages/blueprint/BlueprintExport";
import { PartInspector } from "./components/stages/character/PartInspector";
import { CharacterSelection } from "./components/stages/character/CharacterSelection";
import { processingLabel } from "./components/stages/character/ProgressBlock";
import { SkeletonInspector } from "./components/stages/character/SkeletonInspector";
import type { PendingCharacterReview } from "./components/stages/character/CharacterImportOverlays";
import { MiniNumber, Toggle } from "./components/ui/InspectorControls";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "./components/stages/stageLayout";
import { ThreePuppetPreview } from "./components/ThreePuppetPreview";
import { TrackingModal } from "./components/TrackingModal";
import {
  AboutDialog,
  CanvasZoomToolbar,
  GettingStartedDialog,
  OnnxCacheStatusPill,
  SHARED_PLAYBACK_STAGES,
  STAGES,
  ShortcutHelpDialog,
  TopCommandBar,
  WorkflowRail,
  WorkflowStatusStrip,
  WorkspacePlayerDock,
  type StarterImageTemplate,
} from "./components/AppShell";
import {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  CharacterPackageArtifact,
  FoundryExportPackage,
  GlobalConfig,
  MechanismConfig,
  MechanismType,
  PhysicalKitSettings,
  Point,
  ProjectMotionPath,
  ProjectState,
  ProjectAction,
} from "./types";
import { gearPathD, generateDXF, generateSVG } from "./utils/exporter";
import {
  animationDeltaRadians,
  calculateLinkage,
  defaultCamProfileSamples,
  generateCurvePoints,
  generateMechanismPointTraces,
  gearPairOutputRatio,
  gearTrainMeshPhaseDegAt,
  gearTrainOutputRatio,
  gearTrainPitchCenterDistance,
  gearTrainPitchRadii,
  gearTrainResolvedCenterDistance,
  gearTrainRotationRatioAt,
  normalizeCamProfileSamples,
  planetaryCarrierOutputRatio,
  planetaryPlanetSpinRatio,
  sampledCamProfileScale,
} from "./utils/kinematics";
import {
  evaluateFitness,
  generateSmartConfig,
  mutateConfig,
} from "./utils/optimizer";
import {
  applyProjectAction,
  CLASSROOM_LESSONS,
  classroomLessonById,
  createDefaultMechanism,
  createEmptyProject,
  createLessonProject,
  createProjectFromProcessed,
  createSampleProject,
  downloadText,
  handoffGate,
  loadProjectSnapshot,
  mechanismRequiredParts,
  mechanismWithGeneratedPath,
  projectSelfCheck,
  replaceCharacterProject,
  resetProjectToLessonBaseline,
  serializeProject,
  type ClassroomLessonId,
  uid,
  validatePath,
} from "./utils/project";
import {
  processImageWithWebOnnx,
  warmWebOnnxCache,
  type WebOnnxCacheStatus,
} from "./utils/webOnnx";
import { buildFoundryPhysicsOverlay } from "./utils/physicsSession";
import {
  HIGH_THROUGHPUT_SCENE_POLICY,
  PHYSICS_KERNEL_ENGINE,
  PHYSICS_RENDER_STACK,
  PHYSICS_UPDATE_POLICY,
  loadRapierPhysicsKernel,
  physicsKernelErrorMessage,
} from "./utils/physicsKernel";
import {
  createFabricationPackage,
  FABRICATION_GEAR_SPECS,
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_LINKAGE_WIDTH_MM,
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_RENDER_PART_DEPTH,
  FABRICATION_SPACER_SPEC,
  fabricationBoardCoordinateCallout,
  fabricationGearProfileForPitchRadius,
  fabricationGearSpecForPitchRadius,
  fabricationLinkageSpecForSceneLength,
  fabricationPartDisplayLabel,
  fabricationRingGearPathD,
  fabricationRingGearProfileForPitchRadius,
  fabricationRingInnerGearOutlinePoints,
  fabricationRenderPlanForMechanism,
  fabricationStackSummary,
  planetaryGearConventionForMechanism,
  planetaryGearRadii,
  planetaryRingPitchRadius,
  readableFabricationStackSummary,
  sampleFeasibleRange,
  validateMechanismPreviewReadiness,
  validateForFabrication,
} from "./utils/fabrication";
import {
  boardGridLines,
  boardToScene,
  bodyPartPivotScene,
  localPivotOffsetForScene,
  pathFromPoints,
  physicalKitPreset,
  sceneBoundsForSheet,
  sceneToBoard,
  sceneToSvg,
  svgPointerToScene,
  SCENE_PX_PER_MM,
  SCENE_VIEW,
} from "./utils/coordinates";
import { loadCharacterPackage } from "./utils/packageLoader";
import {
  animatedPartsForProject,
  describeMotionChain,
  mechanismBindingWarnings,
  motionAnchorJointIds,
  motionChainOptionLabel,
  motionChainRootJointIds,
  motionPreviewForPath,
  preferredMotionJointId,
} from "./utils/motion";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
  partOutlinePathD,
  pointInsideOutline,
} from "./utils/partGeometry";
import {
  clampCanvasZoom,
  DEFAULT_CANVAS_VIEWPORT,
  normalizeCanvasViewport,
  WEBGL_PIXEL_RATIO_CAP,
} from "./utils/viewport";
import { formatGridLabel, formatGridReadout } from "./utils/units";
import {
  VIEWER3D_CONTRACT_VERSION,
  createViewer3DContract,
  viewer3DLayerDataValue,
} from "./utils/viewer3d";
import {
  assemblyLaneForExportMode,
  buildAssemblyPlaybackSteps,
  buildCharacterAssemblyPlan,
  pendingRecipeForMechanism,
  type AssemblyLane,
} from "./utils/assemblyPlayback";
import {
  commandIdForKeyboardEvent,
  type AppCommandId,
} from "./utils/appCommands";
import { createAppCommandHandlers } from "./utils/appCommandHandlers";
import {
  FOUNDRY_ANIMATION_COMMIT_MS,
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  degToRad,
  foundryCameraDistance,
  foundryCameraPosition,
  foundryCameraTarget,
  projectFoundryOverlayPoint,
  unprojectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryCameraPreset,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "./utils/foundryCamera";
import {
  AUTHORABLE_MECHANISM_TYPES,
  FOUNDRY_MECHANISM_TYPES,
  FOUNDRY_PRESETS,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  mechanismTemplateLabel,
} from "./utils/mechanismTemplates";
import {
  referenceRecipeForType,
  referenceRequiredPartsHoleCount,
} from "./utils/mechanismReference";
import {
  createMechanismFitContext,
  fitMechanismSimulation,
  fitMechanismSimulationWithContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "./utils/mechanismPreview";
import {
  buildMechanismRecommendations,
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
  type MechanismRecommendation,
} from "./utils/mechanismRecommendations";
import {
  Boxes,
  Download,
  Loader2,
  Play,
  Plus,
  Route,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import motionSmithIconUrl from "./resources/icons/AppIcon.png?url";
import girlStarterUrl from "./resources/examples/raw/girl.png?url";
import boyStarterUrl from "./resources/examples/raw/boy.PNG?url";
import girlStarterThumbUrl from "./resources/examples/thumbs/girl-thumb.png?url";
import boyStarterThumbUrl from "./resources/examples/thumbs/boy-thumb.png?url";

type FoundryState = MechanismConfig;

const foundryLayerGeometryContract = (
  type: MechanismType,
  label: string,
  renderKind: string,
) => {
  if (type === "4bar" && renderKind === "linkage") {
    if (/input|crank/i.test(label)) return `${label}:A-B`;
    if (/coupler/i.test(label)) return `${label}:B-C`;
    if (/output|rocker/i.test(label)) return `${label}:C-D`;
  }
  if (type === "gear" && renderKind === "gear")
    return `${label}:fixed-board-gear`;
  if (type === "gear_linkage") {
    if (renderKind === "gear") return `${label}:fixed-board-gear`;
    if (/drive.*L|Drive L|drive.*linkage/i.test(label))
      return `${label}:B-pin-to-R`;
    if (/output.*L|Output L|output.*linkage/i.test(label))
      return `${label}:C-pin-to-R`;
    if (/L4|linkage/i.test(label)) return `${label}:gear-pin-to-R`;
    if (/2-hole|bracket/i.test(label)) return `${label}:R-connector`;
  }
  if (type === "planetary_gear") {
    if (/ring/i.test(label)) return `${label}:fixed-ring`;
    if (/sun|G1|1-space/i.test(label)) return `${label}:sun-input`;
    if (/planet|G3|3-space/i.test(label)) return `${label}:planet-on-carrier`;
    if (/carrier/i.test(label)) return `${label}:sun-planet-carrier`;
  }
  if (type === "cam") {
    if (renderKind === "cam") return `${label}:rotating-cam`;
    if (renderKind === "follower") return `${label}:guided-follower`;
    if (renderKind === "guide") return `${label}:fixed-guide`;
  }
  return `${label}:${renderKind}`;
};

type FoundryRenderLayerLike = { label: string; renderKind: string };

const foundryPlanetaryLayerIndexes = (
  type: MechanismType,
  layers: FoundryRenderLayerLike[],
) => {
  if (type !== "planetary_gear") return undefined;
  const ring = layers.findIndex(
    (item) => item.renderKind === "gear" && /ring/i.test(item.label),
  );
  const sun = layers.findIndex(
    (item) => item.renderKind === "gear" && /sun|G1|1-space/i.test(item.label),
  );
  const carrier = layers.findIndex(
    (item) =>
      item.renderKind === "linkage" && /carrier|L2|linkage/i.test(item.label),
  );
  const planet = layers.findIndex(
    (item) =>
      item.renderKind === "gear" && /planet|G3|3-space/i.test(item.label),
  );
  if (ring < 0 || sun < 0 || carrier < 0 || planet < 0) return undefined;
  return { ring, sun, carrier, planet };
};

const foundryRenderedLayerZForMechanism = (
  type: MechanismType,
  layers: FoundryRenderLayerLike[],
  stackLayerZ: number[],
  gearMeshPlaneZ?: number,
) => {
  const z = stackLayerZ.map((value, index) =>
    typeof gearMeshPlaneZ === "number" && layers[index]?.renderKind === "gear"
      ? gearMeshPlaneZ
      : value,
  );
  const planetaryLayers = foundryPlanetaryLayerIndexes(type, layers);
  if (planetaryLayers && typeof gearMeshPlaneZ === "number") {
    z[planetaryLayers.ring] = gearMeshPlaneZ;
    z[planetaryLayers.sun] = gearMeshPlaneZ;
    z[planetaryLayers.planet] = gearMeshPlaneZ;
    z[planetaryLayers.carrier] = Number(
      (gearMeshPlaneZ + FABRICATION_RENDER_LAYER_Z_STEP).toFixed(3),
    );
  }
  return z;
};

const mechanismReferenceTopologySummary = (type: MechanismType) => {
  if (type === "4bar")
    return "A-B input; B-C coupler; C-D output; D-A board-ground";
  if (type === "gear")
    return "fixed gear centers only; no rods; external mesh sequence";
  if (type === "gear_linkage")
    return "fixed gear centers; drive/output gear handle pins; two L4 links meet at shared R fastener";
  if (type === "cam")
    return "rotating cam profile; guided follower block; no linkage rods";
  if (type === "planetary_gear")
    return "fixed ring; sun input; planet on carrier; carrier output";
  if (type === "5bar")
    return "A-B-C-D-E closed chain; A-E board-ground; simulation-only";
  if (type === "6bar")
    return "A-B-C-D four-bar plus C-E-D dyad; simulation-only";
  if (type === "piston")
    return "crank-slider guide; slider-crank fabrication recipe";
  return `${type} simulation topology`;
};

const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
  {
    id: "girl",
    label: "Girl",
    fileName: "girl.png",
    url: girlStarterUrl,
    thumbUrl: girlStarterThumbUrl,
  },
  {
    id: "boy",
    label: "Boy",
    fileName: "boy.PNG",
    url: boyStarterUrl,
    thumbUrl: boyStarterThumbUrl,
  },
];

const OPTIONS_SECTION_MANIFEST = [
  { id: "appearance", label: "Appearance", description: "Panels" },
  { id: "simulation", label: "Simulation", description: "Motion" },
  { id: "performance", label: "Performance", description: "Speed" },
  { id: "debugging", label: "Debugging", description: "Labels" },
  { id: "workflow", label: "Workflow", description: "Autosave" },
  { id: "fabrication", label: "Fabrication", description: "Board" },
  { id: "units", label: "Units", description: "Labels" },
] as const;

type OptionsSectionMeta = (typeof OPTIONS_SECTION_MANIFEST)[number];
const optionSection = (id: OptionsSectionMeta["id"]) =>
  OPTIONS_SECTION_MANIFEST.find((section) => section.id === id)!;
const PARAMS: Array<{
  key: keyof MechanismConfig;
  label: string;
  min: number;
  max: number;
  step?: number;
}> = [
  { key: "anchorX", label: "anchor X", min: -260, max: 260, step: 40 },
  { key: "anchorY", label: "anchor Y", min: -260, max: 260, step: 40 },
  { key: "groundAngle", label: "ground angle", min: -180, max: 180 },
  { key: "crankLength", label: "crank", min: 10, max: 180 },
  { key: "groundLength", label: "ground", min: 0, max: 280 },
  { key: "couplerLength", label: "coupler", min: 0, max: 320 },
  { key: "rockerLength", label: "rocker / gear", min: 0, max: 220 },
  { key: "sliderOffset", label: "slider offset", min: -120, max: 120 },
  { key: "couplerPointDist", label: "output dist", min: 0, max: 220 },
  { key: "couplerPointAngle", label: "output angle", min: -180, max: 180 },
  { key: "gearRatio", label: "gear ratio", min: -6, max: 6, step: 0.1 },
  { key: "rodLength", label: "rod length", min: 10, max: 260 },
  { key: "speed2", label: "second speed", min: -5, max: 5, step: 0.1 },
  { key: "phase", label: "phase", min: -3.14, max: 3.14, step: 0.01 },
];

const isAppStage = (value: unknown): value is AppStage =>
  typeof value === "string" && STAGES.some((stage) => stage.id === value);
const projectHasUserWork = (project: ProjectState) =>
  project.partOrder.length > 0 ||
  Object.keys(project.paths).length > 0 ||
  project.mechanisms.length > 0;
const STORAGE_KEYS = {
  autosave: "motionsmith.autosave",
  workspace: "motionsmith.workspace",
} as const;
const LEGACY_STORAGE_PREFIX = ["mech", "anim"].join("");
const LEGACY_STORAGE_KEYS = {
  autosave: `${LEGACY_STORAGE_PREFIX}.autosave`,
  workspace: `${LEGACY_STORAGE_PREFIX}.workspace`,
} as const;
const readStorageWithLegacy = (key: string, legacyKey: string) => {
  const current = localStorage.getItem(key);
  if (current !== null) return { value: current, fromLegacy: false };
  const legacy = localStorage.getItem(legacyKey);
  return { value: legacy, fromLegacy: legacy !== null };
};
const migrateStorageValue = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ponytail: migration is best-effort; legacy read fallback still works.
  }
};
const initialOnnxCacheStatus = (): WebOnnxCacheStatus => ({
  stage: "checking",
  label: "AI pose model",
  progress: 0,
});
const bootLoaderLabel = (status: WebOnnxCacheStatus) => {
  if (status.stage === "cached") return "AI ready";
  if (status.stage === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(status.progress)));
    return `Downloading AI model ${pct}%`;
  }
  if (status.stage === "error") return "Opening without AI model";
  return "Preparing AI model";
};
const updateBootLoader = (status: WebOnnxCacheStatus) => {
  const loader = document.getElementById("boot-loader");
  if (!loader) return;
  const label = loader.querySelector<HTMLElement>("[data-boot-status]");
  if (label) label.textContent = bootLoaderLabel(status);
  const bar = loader.querySelector<HTMLElement>("[data-boot-progress]");
  if (bar) {
    const fallback = status.stage === "checking" ? 8 : status.stage === "error" ? 100 : 0;
    bar.style.width = `${Math.max(6, Math.min(100, status.progress || fallback))}%`;
  }
};
const finishBootLoader = () => {
  document.body.classList.add("app-ready");
  return window.setTimeout(
    () => document.getElementById("boot-loader")?.remove(),
    320,
  );
};
const workflowStatusFor = (
  stage: AppStage,
  project: ProjectState,
  selectedPart?: BodyPartLayer,
  selectedPath?: ProjectMotionPath,
) => {
  const stageLabel = STAGES.find((item) => item.id === stage)?.label ?? stage;
  const validation = validateForFabrication(project);
  const enabledMechanisms = project.mechanisms.filter(
    (m) => m.visible && m.enabled !== false,
  );
  let blocker = "OK";
  let nextAction = "Keep going";
  if (!project.partOrder.length) {
    blocker = "No character";
    nextAction = "Load character";
  } else if (stage === "path") {
    blocker = selectedPart?.locked
      ? `${selectedPart.name} locked`
      : selectedPath && selectedPath.points.length >= 3
        ? "OK"
        : "Need 3 points";
    nextAction =
      selectedPath && selectedPath.points.length >= 3
        ? "Open Foundry"
        : "Draw path";
  } else if (stage === "foundry") {
    blocker =
      selectedPath && selectedPath.points.length >= 3 ? "OK" : "No path";
    nextAction =
      selectedPath && selectedPath.points.length >= 3
        ? "Pick one"
        : "Draw path";
  } else if (stage === "design") {
    blocker = enabledMechanisms.length ? "OK" : "No mechanism";
    nextAction = enabledMechanisms.length ? "Check target" : "Pick mechanism";
  } else if (stage === "blueprint") {
    blocker = validation.errors[0] ?? validation.warnings[0] ?? "OK";
    nextAction = validation.errors.length ? "Fix" : "Make sheets";
  } else if (stage === "assembly") {
    blocker = validation.errors[0] ?? validation.warnings[0] ?? "OK";
    nextAction = validation.errors.length ? "Fix blueprint" : "Build";
  } else if (stage === "options") {
    nextAction = "Tune settings";
  } else {
    nextAction = "Choose starter";
  }
  return { stageLabel, blocker, nextAction };
};

const PROJECT_HISTORY_LIMIT = 80;
type ProjectHistoryState = {
  present: ProjectState;
  past: ProjectState[];
  future: ProjectState[];
};
const isUndoableProjectAction = (action: ProjectAction) =>
  ![
    "set_processing",
    "select_part",
    "set_export",
    "set_foundry_export",
  ].includes(action.type);
const projectFileStem = (name: string) =>
  (name.trim() || "MotionSmith-project")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "MotionSmith-project";
const isTypingShortcutTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const App: React.FC = () => {
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryState>(
    () => {
      projectSelfCheck();
      return { present: createEmptyProject(), past: [], future: [] };
    },
  );
  const project = projectHistory.present;
  const setProject = (
    update: React.SetStateAction<ProjectState>,
    options: { history?: boolean; resetHistory?: boolean } = {},
  ) => {
    setProjectHistory((prev) => {
      const next =
        typeof update === "function"
          ? (update as (previous: ProjectState) => ProjectState)(prev.present)
          : update;
      if (next === prev.present) return prev;
      if (options.resetHistory) return { present: next, past: [], future: [] };
      if (options.history)
        return {
          present: next,
          past: [
            ...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)),
            prev.present,
          ],
          future: [],
        };
      return { ...prev, present: next };
    });
  };
  const [stage, setStage] = useState<AppStage>("character");
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [angle, setAngle] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [assemblyPlaying, setAssemblyPlaying] = useState(false);
  const [assemblyStepIndex, setAssemblyStepIndex] = useState(0);
  const [assemblyStepProgress, setAssemblyStepProgress] = useState(0);
  const [assemblyStepCount, setAssemblyStepCount] = useState(0);
  const [showTrace, setShowTrace] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [showTracking, setShowTracking] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const modalOpen = showGettingStarted || showShortcuts || showAbout;
  const [foundry, setFoundry] = useState<FoundryState>(() =>
    createDefaultMechanism("4bar", "foundry-preview"),
  );
  const [pendingCharacter, setPendingCharacter] =
    useState<PendingCharacterReview | null>(null);
  const [replaceCharacter, setReplaceCharacter] = useState(false);
  const [optimizerBusy, setOptimizerBusy] = useState(false);
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>(
    DEFAULT_CANVAS_VIEWPORT,
  );
  const [commandStatus, setCommandStatus] = useState("Ready");
  const [onnxCacheStatus, setOnnxCacheStatus] = useState<WebOnnxCacheStatus>(
    initialOnnxCacheStatus,
  );
  const projectInputRef = useRef<HTMLInputElement>(null);
  const latestProjectRef = useRef<ProjectState | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const commandHandlersRef = useRef<Record<AppCommandId, () => void> | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    let bootTimer: number | undefined;
    const publishBootStatus = (status: WebOnnxCacheStatus) => {
      if (!active) return;
      setOnnxCacheStatus(status);
      updateBootLoader(status);
    };
    publishBootStatus(initialOnnxCacheStatus());
    warmWebOnnxCache(publishBootStatus).then((status) => {
      if (!active) return;
      publishBootStatus(status);
      bootTimer = finishBootLoader();
    });
    return () => {
      active = false;
      if (bootTimer !== undefined) window.clearTimeout(bootTimer);
    };
  }, []);

  const cacheOnnxModel = async () => {
    setCommandStatus("Getting AI…");
    const result = await warmWebOnnxCache(setOnnxCacheStatus);
    setCommandStatus(
      result.stage === "cached"
        ? "AI ready"
        : `AI failed: ${result.error ?? "download error"}`,
    );
  };

  const dispatch = (action: ProjectAction) =>
    setProject((prev) => applyProjectAction(prev, action), {
      history: isUndoableProjectAction(action),
    });
  const goStage = (target: AppStage) => {
    const gate = handoffGate(project, target);
    if (!gate.ok && "recoveryStage" in gate) {
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: gate.message,
          progress: 0,
          error: gate.message,
        },
      });
      setCommandStatus(gate.message);
      setStage(gate.recoveryStage);
    } else {
      setCommandStatus(
        `Opened ${STAGES.find((s) => s.id === target)?.label ?? target}`,
      );
      setStage(target);
    }
  };
  const sortedParts = useMemo(
    () => project.partOrder.map((id) => project.parts[id]).filter(Boolean),
    [project.parts, project.partOrder],
  );
  const selectedPart = project.selectedPartId
    ? project.parts[project.selectedPartId]
    : sortedParts[0];
  const selectedPath = useMemo(() => {
    if (!selectedPart) return undefined;
    const current = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    return current?.partId === selectedPart.id
      ? current
      : (Object.values(project.paths) as ProjectMotionPath[]).find(
          (path) => path.partId === selectedPart.id,
        );
  }, [project.paths, project.selectedPathId, selectedPart]);
  const selectedMechanism =
    project.mechanisms.find((m) => m.id === project.selectedMechanismId) ??
    project.mechanisms[0];
  const activeClassroomLesson = classroomLessonById(
    project.metadata.classroomLessonId,
  );
  const playbackDurationMs =
    selectedMechanism?.targetPathId &&
    project.paths[selectedMechanism.targetPathId]
      ? project.paths[selectedMechanism.targetPathId].duration
      : (selectedPath?.duration ?? project.settings.animationDurationMs);

  useEffect(() => {
    if (
      !isPlaying ||
      drawMode ||
      optimizerBusy ||
      showGettingStarted ||
      !SHARED_PLAYBACK_STAGES.includes(stage)
    )
      return;
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(64, time - last);
      last = time;
      setAngle(
        (prev) =>
          (prev +
            animationDeltaRadians(
              dt,
              playbackDurationMs,
              project.settings.animationSpeed,
              project.settings.timingProfile,
              prev,
            )) %
          (Math.PI * 2),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    stage,
    playbackDurationMs,
    project.settings.animationSpeed,
    project.settings.timingProfile,
  ]);

  useEffect(() => {
    if (stage !== "path" && drawMode) setDrawMode(false);
  }, [stage, drawMode]);

  const mechanismConfig: GlobalConfig = useMemo(
    () => ({
      speed: project.settings.animationSpeed,
      rotation: 0,
      mechanisms: project.mechanisms,
    }),
    [project.settings.animationSpeed, project.mechanisms],
  );

  const setMechanismConfig: React.Dispatch<
    React.SetStateAction<GlobalConfig>
  > = (update) => {
    setProject(
      (prev) => {
        const current = {
          speed: prev.settings.animationSpeed,
          rotation: 0,
          mechanisms: prev.mechanisms,
        };
        const next = typeof update === "function" ? update(current) : update;
        return applyProjectAction(prev, {
          type: "set_mechanisms",
          mechanisms: next.mechanisms,
          selectedMechanismId:
            prev.selectedMechanismId ?? next.mechanisms[0]?.id,
        });
      },
      { history: true },
    );
  };

  const updateMechanism = (id: string, updates: Partial<MechanismConfig>) => {
    const mechanism = project.mechanisms.find((m) => m.id === id);
    if (!mechanism) return;
    const nextUpdates = { ...updates };
    if (updates.targetPathId) {
      const path = project.paths[updates.targetPathId];
      if (path) {
        nextUpdates.targetPartId = path.partId;
        nextUpdates.targetAnchorJointId =
          path.targetAnchorJointId ??
          preferredMotionJointId(
            project,
            path.partId,
            mechanism.targetAnchorJointId,
            { preferDistalWhenRoot: !mechanism.targetAnchorJointId },
          );
      }
    }
    if (updates.targetPartId !== undefined) {
      const pathId = updates.targetPathId ?? mechanism.targetPathId;
      if (pathId && project.paths[pathId]?.partId !== updates.targetPartId)
        nextUpdates.targetPathId = undefined;
      nextUpdates.targetAnchorJointId = updates.targetPartId
        ? preferredMotionJointId(project, updates.targetPartId, undefined, {
            preferDistalWhenRoot: true,
          })
        : undefined;
    }
    const next = { ...mechanism, ...nextUpdates };
    const normalized = normalizeGearMeshMechanism(next);
    const fitted =
      nextUpdates.targetPathId &&
      (updates.targetPathId !== undefined || updates.targetPartId !== undefined)
        ? fitMechanismToTargetPath(
            project,
            normalized,
            nextUpdates.targetPathId,
          )
        : mechanismWithGeneratedPath({
            ...normalized,
            activeVisualPartIds: normalized.targetPartId
              ? [normalized.targetPartId]
              : [],
          });
    dispatch({ type: "upsert_mechanism", mechanism: fitted });
  };

  const setPathPoints = (
    points: Point[],
    source: ProjectMotionPath["source"] = "drawn",
  ) => {
    const partId = selectedPart?.id;
    if (!partId || project.parts[partId]?.locked) return;
    const existing = (Object.values(project.paths) as ProjectMotionPath[]).find(
      (path) => path.partId === partId,
    );
    const id =
      project.selectedPathId &&
      project.paths[project.selectedPathId]?.partId === partId
        ? project.selectedPathId
        : (existing?.id ?? `path-${partId}`);
    const current = project.paths[id];
    dispatch({
      type: "upsert_path",
      path: validatePath({
        id,
        partId,
        targetAnchorJointId: current?.targetAnchorJointId,
        chainRootJointId: current?.chainRootJointId,
        smoothness: current?.smoothness ?? 0,
        points,
        timedPoints: points.map((p, i) => ({
          ...p,
          time:
            points.length <= 1
              ? 0
              : (i / (points.length - 1)) *
                (current?.duration ?? project.settings.animationDurationMs),
        })),
        duration: current?.duration ?? project.settings.animationDurationMs,
        closed: current?.closed ?? false,
        enabled: current?.enabled ?? true,
        visible: current?.visible ?? true,
        source,
        warnings: [],
      }),
    });
  };

  const queueCharacterReview = (next: ProjectState, summary: string) => {
    const reviewed = replaceCharacter
      ? replaceCharacterProject(next, project, stage)
      : next;
    setPendingCharacter({
      project: reviewed,
      summary,
      returnStage: "character",
    });
    dispatch({
      type: "set_processing",
      processing: { stage: "ready", message: "Check character", progress: 100 },
    });
    setStage("character");
  };

  const runWebOnnx = async (file: File) => {
    dispatch({
      type: "set_processing",
      processing: {
        stage: "loading-model",
        message: "Reading picture…",
        progress: 10,
      },
    });
    try {
      const result = await processImageWithWebOnnx(
        file,
        (stageName, progress) => {
          if (stageName === "downloading-model")
            setOnnxCacheStatus((prev) => ({
              ...prev,
              stage: "downloading",
              progress,
            }));
          if (stageName === "loading-model")
            setOnnxCacheStatus((prev) => ({
              ...prev,
              stage: "cached",
              progress: 100,
            }));
          const stageId = stageName as ProjectState["processing"]["stage"];
          dispatch({
            type: "set_processing",
            processing: {
              stage: stageId,
              message: processingLabel(stageId, ""),
              progress,
            },
          });
        },
      );
      const next = createProjectFromProcessed({
        name: file.name.replace(/\.[^.]+$/, "") || "Processed character",
        sourceImageName: file.name,
        skeleton: result.skeleton,
        parts: result.parts,
        textureUrl: result.textureUrl,
        maskUrl: result.maskUrl,
        keypoints: result.keypoints,
        replacementContext: {
          mode: replaceCharacter ? "replace-character" : "plain-load",
          previousStage: stage,
          rebindingSummary: replaceCharacter
            ? "Check before preserving mechanisms."
            : "Clean start.",
        },
      });
      queueCharacterReview(
        next,
        `${next.partOrder.length} parts · ${Object.keys(next.skeleton?.joints ?? {}).length} joints · ready`,
      );
    } catch (error) {
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: "Image processing failed",
          progress: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const loadStarterImage = async (template: StarterImageTemplate) => {
    setCommandStatus(`Opening ${template.label}`);
    dispatch({
      type: "set_processing",
      processing: {
        stage: "loading-model",
        message: `Opening ${template.label}`,
        progress: 8,
      },
    });
    try {
      const response = await fetch(template.url);
      if (!response.ok) throw new Error(`Could not load ${template.fileName}`);
      const blob = await response.blob();
      await runWebOnnx(
        new File([blob], template.fileName, { type: blob.type || "image/png" }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: "Starter failed",
          progress: 0,
          error: message,
        },
      });
      setCommandStatus(`Starter failed: ${message}`);
    }
  };

  const importCharacterPackage = async (files: FileList | File[]) => {
    dispatch({
      type: "set_processing",
      processing: {
        stage: "loading-model",
        message: "Loading character…",
        progress: 20,
      },
    });
    try {
      queueCharacterReview(await loadCharacterPackage(files), "Ready to use.");
    } catch (error) {
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: "Couldn’t load character",
          progress: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      setStage("character");
    }
  };

  const importProject = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      setProject(loadProjectSnapshot(raw), { resetHistory: true });
      setCommandStatus(`Loaded project ${file.name}`);
      setShowGettingStarted(false);
      setStage("path");
    } catch (error) {
      dispatch({
        type: "set_processing",
        processing: {
          stage: "error",
          message: "Project import failed",
          progress: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      setCommandStatus(
        `Project import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      setShowGettingStarted(false);
      setStage("character");
    }
  };

  const editCharacterParts = () => {
    setCommandStatus("Opened Character part, outline, and skeleton tools");
    setStage("character");
  };

  const saveSkeleton = () => {
    if (!project.skeleton) {
      setCommandStatus("No skeleton to save");
      return;
    }
    const charCfg = project.characterPackage?.charCfg ?? {
      joints: project.skeleton.joints,
      bones: project.skeleton.bones,
      root_joint_ids: project.skeleton.rootJointIds,
      metadata: project.skeleton.metadata,
    };
    downloadText("char_cfg.json", JSON.stringify(charCfg, null, 2));
    setCommandStatus("Saved skeleton config");
  };

  const optimizeSelectedMechanism = async () => {
    if (!selectedMechanism || !selectedPath || selectedPath.points.length < 3)
      return;
    setOptimizerBusy(true);
    await new Promise((r) => setTimeout(r, 16));
    let best = generateSmartConfig(selectedPath.points, selectedMechanism.type);
    let bestScore = evaluateFitness(best, selectedPath.points);
    const iterations =
      project.settings.performancePreset === "fast"
        ? 120
        : project.settings.performancePreset === "high"
          ? 520
          : 260;
    for (let i = 0; i < iterations; i++) {
      const candidate =
        i < 80
          ? generateSmartConfig(selectedPath.points, selectedMechanism.type)
          : mutateConfig(best, 0.45, true);
      const score = evaluateFitness(candidate, selectedPath.points);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    updateMechanism(selectedMechanism.id, {
      ...best,
      id: selectedMechanism.id,
      color: selectedMechanism.color,
      visible: true,
      targetPartId: selectedPart?.id,
      targetPathId: selectedPath.id,
      source: "optimized",
      warnings:
        bestScore > 350 ? [`Loose fit score ${Math.round(bestScore)}`] : [],
    });
    setOptimizerBusy(false);
  };

  useEffect(() => {
    latestProjectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!project.settings.autosave) return;
    const writeAutosave = () => {
      try {
        localStorage.setItem(
          STORAGE_KEYS.autosave,
          serializeProject(latestProjectRef.current ?? project),
        );
      } catch {
        // ponytail: browser autosave is best-effort; manual snapshot download stays available.
      }
    };
    writeAutosave();
    const intervalMs = Math.max(
      1000,
      project.settings.autosaveIntervalSeconds * 1000,
    );
    const interval = window.setInterval(writeAutosave, intervalMs);
    return () => window.clearInterval(interval);
  }, [project.settings.autosave, project.settings.autosaveIntervalSeconds]);

  const exportMechanismSvg = () => {
    downloadText(
      `mechanisms-${Date.now()}.svg`,
      generateSVG(mechanismConfig, angle),
      "image/svg+xml",
    );
    setCommandStatus("Exported mechanism SVG");
  };
  const exportMechanismDxf = () => {
    downloadText(
      `mechanisms-${Date.now()}.dxf`,
      generateDXF(mechanismConfig, angle),
      "application/dxf",
    );
    setCommandStatus("Exported mechanism DXF");
  };
  const downloadProjectSnapshot = (suffix: string, status: string) => {
    const stem = projectFileStem(project.metadata.name);
    downloadText(
      `${stem}${suffix}.motionsmith.json`,
      serializeProject(project),
    );
    setCommandStatus(status);
  };
  const saveProject = () => downloadProjectSnapshot("", "Project saved");
  const saveProjectAs = () =>
    downloadProjectSnapshot(`-${Date.now()}`, "Project saved");
  const exportProjectCopy = () =>
    downloadProjectSnapshot("-copy", "Project copied");
  const newProject = () => {
    if (
      projectHasUserWork(project) &&
      !window.confirm("Discard current project and start new?")
    ) {
      setCommandStatus("Cancelled");
      return;
    }
    setPendingCharacter(null);
    setProject(createEmptyProject(), { resetHistory: true });
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setCommandStatus("New project");
    setShowGettingStarted(false);
    setStage("character");
  };
  const foundryPreviewFromProject = (lessonProject: ProjectState) => {
    const mechanism = lessonProject.mechanisms[0];
    return mechanism
      ? { ...mechanism, id: "foundry-preview" }
      : createDefaultMechanism("4bar", "foundry-preview");
  };
  const openClassroomLesson = (lessonId: ClassroomLessonId) => {
    const lesson = classroomLessonById(lessonId);
    const lessonProject = createLessonProject(lessonId);
    setPendingCharacter(null);
    setProject(lessonProject, { resetHistory: true });
    setFoundry(foundryPreviewFromProject(lessonProject));
    setAngle(0);
    setIsPlaying(false);
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setShowGettingStarted(false);
    setStage(lesson?.startStage ?? "character");
    setCommandStatus(`${lesson?.outcome ?? lessonProject.metadata.name} ready`);
  };
  const resetLesson = () => {
    const lesson = classroomLessonById(project.metadata.classroomLessonId);
    const resetProject = resetProjectToLessonBaseline(project);
    if (!lesson || !resetProject) {
      setCommandStatus("No lesson");
      return;
    }
    setPendingCharacter(null);
    setProject(resetProject, { resetHistory: true });
    setFoundry(foundryPreviewFromProject(resetProject));
    setAngle(0);
    setIsPlaying(false);
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setStage(lesson.startStage);
    setCommandStatus("Lesson reset");
  };
  const recoverAutosave = () => {
    try {
      const stored = readStorageWithLegacy(
        STORAGE_KEYS.autosave,
        LEGACY_STORAGE_KEYS.autosave,
      );
      if (!stored.value) {
        setCommandStatus("No autosave found");
        return;
      }
      setProject(loadProjectSnapshot(JSON.parse(stored.value)), {
        resetHistory: true,
      });
      if (stored.fromLegacy)
        migrateStorageValue(STORAGE_KEYS.autosave, stored.value);
      setCommandStatus("Recovered browser autosave snapshot");
      setStage("path");
    } catch (error) {
      setCommandStatus(
        `Autosave recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const saveWorkspaceLayout = () => {
    localStorage.setItem(
      STORAGE_KEYS.workspace,
      JSON.stringify({
        stage,
        viewport: canvasViewport,
        toolbarVisible: project.settings.toolbarVisible,
        partPanelVisible: project.settings.partPanelVisible,
      }),
    );
    setCommandStatus("Workspace layout saved");
  };
  const restoreWorkspaceLayout = () => {
    try {
      const stored = readStorageWithLegacy(
        STORAGE_KEYS.workspace,
        LEGACY_STORAGE_KEYS.workspace,
      );
      if (!stored.value) {
        setCommandStatus("No workspace layout saved");
        return;
      }
      const layout = JSON.parse(stored.value) as Partial<{
        stage: unknown;
        viewport: unknown;
        toolbarVisible: unknown;
        partPanelVisible: unknown;
      }>;
      if (stored.fromLegacy)
        migrateStorageValue(STORAGE_KEYS.workspace, stored.value);
      const warnings: string[] = [];
      if (layout.viewport !== undefined) {
        const viewport = normalizeCanvasViewport(layout.viewport);
        if (viewport) setCanvasViewport(viewport);
        else warnings.push("ignored invalid workspace viewport");
      }
      if (
        layout.toolbarVisible !== undefined ||
        layout.partPanelVisible !== undefined
      ) {
        const toolbarVisible =
          typeof layout.toolbarVisible === "boolean"
            ? layout.toolbarVisible
            : project.settings.toolbarVisible;
        const partPanelVisible =
          typeof layout.partPanelVisible === "boolean"
            ? layout.partPanelVisible
            : project.settings.partPanelVisible;
        if (
          layout.toolbarVisible !== undefined &&
          typeof layout.toolbarVisible !== "boolean"
        )
          warnings.push("ignored invalid toolbar visibility");
        if (
          layout.partPanelVisible !== undefined &&
          typeof layout.partPanelVisible !== "boolean"
        )
          warnings.push("ignored invalid panel visibility");
        dispatch({
          type: "update_settings",
          settings: { toolbarVisible, partPanelVisible },
        });
      }
      if (layout.stage !== undefined) {
        if (isAppStage(layout.stage)) goStage(layout.stage);
        else warnings.push("ignored invalid workspace stage");
      }
      setCommandStatus(
        warnings.length
          ? `Workspace layout restored; ${warnings.join("; ")}`
          : "Workspace layout restored",
      );
    } catch (error) {
      setCommandStatus(
        `Workspace restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const resetWorkspaceLayout = () => {
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    dispatch({
      type: "update_settings",
      settings: { toolbarVisible: true, partPanelVisible: true },
    });
    setCommandStatus("Workspace layout reset");
  };
  const zoomCanvas = (factor: number) => {
    const nextZoom = clampCanvasZoom(canvasViewport.zoom * factor);
    setCanvasViewport((prev) => ({
      ...prev,
      zoom: clampCanvasZoom(prev.zoom * factor),
    }));
    setCommandStatus(`Canvas zoom ${Math.round(nextZoom * 100)}%`);
  };
  const fitCanvas = () => {
    setCanvasViewport(DEFAULT_CANVAS_VIEWPORT);
    setCommandStatus("Canvas fitted to sheet");
  };
  const undoProject = () => {
    if (!projectHistory.past.length) {
      setCommandStatus("Nothing to undo");
      return;
    }
    setProjectHistory((prev) => {
      if (!prev.past.length) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        present: previous,
        past: prev.past.slice(0, -1),
        future: [prev.present, ...prev.future].slice(0, PROJECT_HISTORY_LIMIT),
      };
    });
    setCommandStatus("Undo applied");
  };
  const redoProject = () => {
    if (!projectHistory.future.length) {
      setCommandStatus("Nothing to redo");
      return;
    }
    setProjectHistory((prev) => {
      if (!prev.future.length) return prev;
      const [next, ...future] = prev.future;
      return {
        present: next,
        past: [...prev.past.slice(-(PROJECT_HISTORY_LIMIT - 1)), prev.present],
        future,
      };
    });
    setCommandStatus("Redo applied");
  };
  const aboutMotionSmith = () => setShowAbout(true);
  const commandHandlers = createAppCommandHandlers({
    newProject,
    openProject: () => projectInputRef.current?.click(),
    recoverAutosave,
    saveProject,
    saveProjectAs,
    exportProjectCopy,
    resetLesson,
    undoProject,
    redoProject,
    zoomCanvas,
    fitCanvas,
    saveWorkspaceLayout,
    restoreWorkspaceLayout,
    resetWorkspaceLayout,
    goStage,
    openShortcuts: () => setShowShortcuts(true),
    openAbout: aboutMotionSmith,
  }) satisfies Record<AppCommandId, () => void>;
  commandHandlersRef.current = commandHandlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (modalOpen) return;
      if (isTypingShortcutTarget(event.target)) return;
      const commandId = commandIdForKeyboardEvent(event);
      if (!commandId) return;
      event.preventDefault();
      commandHandlersRef.current?.[commandId]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen]);
  const themeClass =
    project.settings.theme === "dark"
      ? "bg-slate-950 text-slate-100"
      : "bg-slate-50 text-slate-950";
  const editorStage: AppStage = stage;
  const closeGettingStarted = () => {
    setShowGettingStarted(false);
    setStage("character");
  };
  const stageMeta = STAGES.find((s) => s.id === stage);
  const goSharedAssemblyStep = (index: number) => {
    const maxStepIndex = Math.max(0, assemblyStepCount - 1);
    setAssemblyStepProgress(0);
    setAssemblyStepIndex(Math.max(0, Math.min(maxStepIndex, index)));
  };
  const isAssemblyStage = editorStage === "assembly";
  const showsWorkspacePlayer =
    editorStage === "path" || editorStage === "design" || editorStage === "assembly";
  const playerDock =
    !modalOpen && showsWorkspacePlayer ? (
      <WorkspacePlayerDock
        isPlaying={isAssemblyStage ? assemblyPlaying : isPlaying}
        setIsPlaying={isAssemblyStage ? setAssemblyPlaying : setIsPlaying}
        angle={angle}
        setAngle={setAngle}
        speed={project.settings.animationSpeed}
        drawMode={drawMode}
        stepPlayback={
          isAssemblyStage
            ? {
                stepIndex: assemblyStepIndex,
                stepCount: assemblyStepCount,
                onStepChange: goSharedAssemblyStep,
              }
            : undefined
        }
      />
    ) : null;

  useEffect(() => {
    const shell = appShellRef.current;
    if (modalOpen) {
      shell?.setAttribute("inert", "");
      shell?.setAttribute("aria-hidden", "true");
      document.documentElement.classList.add("welcome-modal-open");
      document.body.classList.add("welcome-modal-open");
    } else {
      shell?.removeAttribute("inert");
      shell?.removeAttribute("aria-hidden");
      document.documentElement.classList.remove("welcome-modal-open");
      document.body.classList.remove("welcome-modal-open");
    }
    return () => {
      shell?.removeAttribute("inert");
      shell?.removeAttribute("aria-hidden");
      document.documentElement.classList.remove("welcome-modal-open");
      document.body.classList.remove("welcome-modal-open");
    };
  }, [modalOpen]);

  return (
    <main
      className={`min-h-screen overflow-hidden ${themeClass}`}
      data-theme={project.settings.theme}
    >
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 15% 10%, rgba(90,108,255,.12), transparent 28%), radial-gradient(circle at 85% 20%, rgba(90,108,255,.08), transparent 24%), linear-gradient(120deg, rgba(8,10,18,.04), transparent)",
        }}
      />
      <div ref={appShellRef} className="relative grid min-h-screen app-shell">
        <WorkflowRail stage={stage} goStage={goStage} />
        <section className="relative flex min-w-0 flex-col">
          <header className="app-header border-b border-slate-300/70 bg-white/50 backdrop-blur-xl">
            <div className="app-header-brand">
              <img
                className="brand-kicker app-header-icon"
                src={motionSmithIconUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                draggable={false}
              />
              <h1 className="brand-title">MotionSmith</h1>
              <h2 className="current-stage-title">{stageMeta?.label}</h2>
            </div>
            <div className="app-header-actions">
              <TopCommandBar commandHandlers={commandHandlers} />
              {project.settings.toolbarVisible && (
                <div className="quick-toolbar" data-testid="quick-toolbar">
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={16} /> Import
                    <input
                      hidden
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) =>
                        e.target.files?.[0] && importProject(e.target.files[0])
                      }
                    />
                  </label>
                  <button className="btn-secondary" onClick={saveProject}>
                    <Download size={16} /> Snapshot
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => goStage("blueprint")}
                  >
                    <Download size={16} /> Export
                  </button>
                </div>
              )}
            </div>
          </header>
          <input
            ref={projectInputRef}
            data-testid="project-file-input"
            hidden
            type="file"
            accept="application/json,.motionsmith.json,.json"
            onChange={(e) =>
              e.target.files?.[0] && importProject(e.target.files[0])
            }
          />

          <div
            className="stage-body editor-workbench relative min-h-0 flex-1 overflow-hidden p-7"
            data-testid="shared-workbench"
          >
            {editorStage === "character" && (
              <CharacterSelection
                project={project}
                dispatch={dispatch}
                pendingCharacter={pendingCharacter}
                replaceCharacter={replaceCharacter}
                setReplaceCharacter={setReplaceCharacter}
                onOpenGettingStarted={() => setShowGettingStarted(true)}
                onAccept={() => {
                  if (!pendingCharacter) return;
                  setProject(pendingCharacter.project, { resetHistory: true });
                  setPendingCharacter(null);
                  setShowGettingStarted(false);
                  setStage(pendingCharacter.returnStage);
                }}
                onDiscard={() => setPendingCharacter(null)}
                onProcess={runWebOnnx}
                onPackage={importCharacterPackage}
                onImport={importProject}
                onEditCharacter={editCharacterParts}
                onSaveSkeleton={saveSkeleton}
                activeClassroomLesson={activeClassroomLesson}
                resetLesson={resetLesson}
                goStage={goStage}
                viewport={canvasViewport}
                setViewport={setCanvasViewport}
              />
            )}
            {editorStage === "path" && (
              <PathEditor
                project={project}
                sortedParts={sortedParts}
                selectedPart={selectedPart}
                selectedPath={selectedPath}
                drawMode={drawMode}
                setDrawMode={setDrawMode}
                dispatch={dispatch}
                setPathPoints={setPathPoints}
                openTracking={() => setShowTracking(true)}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                angle={angle}
                setAngle={setAngle}
                onNext={() => goStage("foundry")}
                goStage={goStage}
                viewport={canvasViewport}
                setViewport={setCanvasViewport}
              />
            )}
            {editorStage === "foundry" && (
              <MechanismFoundry
                project={project}
                foundry={foundry}
                setFoundry={setFoundry}
                selectedPart={selectedPart}
                selectedPath={selectedPath}
                goStage={goStage}
                onExport={(pkg) => {
                  const existingTarget = project.mechanisms.find(
                    (m) =>
                      m.targetPartId === pkg.targetPartId &&
                      m.targetPathId === pkg.targetPathId &&
                      preferredMotionJointId(
                        project,
                        m.targetPartId,
                        m.targetAnchorJointId,
                      ) === pkg.targetAnchorJointId,
                  );
                  const rawMechanism = mechanismWithGeneratedPath(
                    {
                      ...foundry,
                      id: existingTarget?.id ?? pkg.mechanismId,
                      anchorX: pkg.pivot.x,
                      anchorY: pkg.pivot.y,
                      targetPartId: pkg.targetPartId,
                      targetPathId: pkg.targetPathId,
                      targetAnchorJointId: pkg.targetAnchorJointId,
                      presetId: pkg.metadata.selectedPreset,
                      recommendation: pkg.metadata.recommendation,
                      source: "foundry",
                      foundryExport: pkg,
                      generatedPath: pkg.generatedPath,
                      warnings: pkg.warnings,
                      activeVisualPartIds: selectedPart
                        ? [selectedPart.id]
                        : [],
                    },
                    { preserveGeneratedPath: true },
                  );
                  const fittedMechanism = pkg.targetPathId
                    ? fitMechanismToTargetPath(
                        project,
                        rawMechanism,
                        pkg.targetPathId,
                      )
                    : fitRecommendedMechanismToSheet(project, rawMechanism);
                  const generatedPath =
                    fittedMechanism.generatedPath ??
                    rawMechanism.generatedPath ??
                    pkg.generatedPath;
                  const mech = mechanismWithGeneratedPath(
                    {
                      ...fittedMechanism,
                      foundryExport: {
                        ...pkg,
                        parameters: { ...fittedMechanism },
                        pivot: {
                          x: fittedMechanism.anchorX ?? pkg.pivot.x,
                          y: fittedMechanism.anchorY ?? pkg.pivot.y,
                        },
                        outputPoint: generatedPath[0] ?? pkg.outputPoint,
                        generatedPath,
                      },
                      generatedPath,
                      warnings: [
                        ...new Set([
                          ...(fittedMechanism.warnings ?? []),
                          ...(pkg.warnings ?? []),
                        ]),
                      ],
                      activeVisualPartIds: selectedPart
                        ? [selectedPart.id]
                        : [],
                    },
                    { preserveGeneratedPath: true },
                  );
                  dispatch({ type: "set_foundry_export", foundryExport: pkg });
                  dispatch({ type: "upsert_mechanism", mechanism: mech });
                  setStage("design");
                }}
              />
            )}
            {editorStage === "design" && (
              <MechanismDesign
                project={project}
                selectedMechanism={selectedMechanism}
                updateMechanism={updateMechanism}
                dispatch={dispatch}
                showTrace={showTrace}
                setShowTrace={setShowTrace}
                angle={angle}
                onOptimize={optimizeSelectedMechanism}
                onRecommendations={() => setShowRecommendations(true)}
                optimizerBusy={optimizerBusy}
                exportSvg={exportMechanismSvg}
                exportDxf={exportMechanismDxf}
                onBlueprint={() => goStage("blueprint")}
                goStage={goStage}
              />
            )}
            {editorStage === "blueprint" && (
              <BlueprintExport
                project={project}
                dispatch={dispatch}
                goStage={goStage}
              />
            )}
            {editorStage === "assembly" && (
              <AssemblyGuide
                project={project}
                dispatch={dispatch}
                goStage={goStage}
                stepIndex={assemblyStepIndex}
                setStepIndex={setAssemblyStepIndex}
                stepProgress={assemblyStepProgress}
                setStepProgress={setAssemblyStepProgress}
                playing={assemblyPlaying}
                setPlaying={setAssemblyPlaying}
                setStepCount={setAssemblyStepCount}
              />
            )}
            {editorStage === "options" && (
              <Options
                project={project}
                dispatch={dispatch}
                goStage={goStage}
              />
            )}
            {playerDock && (
              <div
                className="stage-player-row"
                data-testid="stage-player-row"
                aria-label="Shared playback controls"
              >
                {playerDock}
              </div>
            )}
          </div>
          <WorkflowStatusStrip
            {...workflowStatusFor(
              editorStage,
              project,
              selectedPart,
              selectedPath,
            )}
          />
          <footer className="status-bar" data-testid="status-bar">
            <span>{commandStatus}</span>
            <OnnxCacheStatusPill
              status={onnxCacheStatus}
              onDownload={cacheOnnxModel}
            />
          </footer>
        </section>
      </div>
      {showGettingStarted && (
        <GettingStartedDialog
          starterTemplates={STARTER_IMAGE_TEMPLATES}
          guidedLessons={CLASSROOM_LESSONS}
          onLesson={(lessonId) => openClassroomLesson(lessonId as ClassroomLessonId)}
          onStarterImage={(template) => {
            setShowGettingStarted(false);
            loadStarterImage(template);
          }}
          onSample={() => {
            setPendingCharacter(null);
            setProject(createSampleProject(), { resetHistory: true });
                    setShowGettingStarted(false);
            setStage("character");
          }}
          onPackage={(files) => {
            setShowGettingStarted(false);
            importCharacterPackage(files);
          }}
          onProcess={(file) => {
            setShowGettingStarted(false);
            runWebOnnx(file);
          }}
          onImport={(file) => {
            setShowGettingStarted(false);
            importProject(file);
          }}
          onClose={closeGettingStarted}
        />
      )}
      {showShortcuts && (
        <ShortcutHelpDialog onClose={() => setShowShortcuts(false)} />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      <MechanismRecommendationSheet
        isOpen={showRecommendations}
        project={project}
        selectedPart={selectedPart}
        selectedPath={selectedPath}
        onClose={() => setShowRecommendations(false)}
        onApply={(mechanism) => {
          dispatch({ type: "upsert_mechanism", mechanism });
          setShowRecommendations(false);
          setStage("design");
        }}
      />
      <TrackingModal
        isOpen={showTracking}
        onClose={() => setShowTracking(false)}
        onTransfer={(path) => {
          setPathPoints(path, "tracked");
          setShowTracking(false);
          setStage("path");
        }}
      />
    </main>
  );
};

const PathEditor = ({
  project,
  sortedParts,
  selectedPart,
  selectedPath,
  drawMode,
  setDrawMode,
  dispatch,
  setPathPoints,
  openTracking,
  isPlaying,
  setIsPlaying,
  angle,
  setAngle,
  onNext,
  goStage,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
  setPathPoints: (
    points: Point[],
    source?: ProjectMotionPath["source"],
  ) => void;
  openTracking: () => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  angle: number;
  setAngle: React.Dispatch<React.SetStateAction<number>>;
  onNext: () => void;
  goStage: (stage: AppStage) => void;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const freeDraftRef = useRef<Point[] | null>(null);
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isFreeDrawing, setIsFreeDrawing] = useState(false);
  const [pathViewMode, setPathViewMode] = useState<"2d" | "3d">("3d");
  const pathLocked = Boolean(selectedPart?.locked);
  const pointCount = selectedPath?.points.length ?? 0;
  const jointOptions = selectedPart
    ? motionAnchorJointIds(project, selectedPart.id)
    : [];
  const selectedIkJointId = selectedPart
    ? preferredMotionJointId(
        project,
        selectedPart.id,
        selectedPath?.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId },
      )
    : undefined;
  const chainRootOptions = selectedPart
    ? motionChainRootJointIds(project, selectedPart.id, selectedIkJointId)
    : [];
  const selectedChainRootId =
    selectedPath?.chainRootJointId &&
    chainRootOptions.includes(selectedPath.chainRootJointId)
      ? selectedPath.chainRootJointId
      : selectedPart?.anchorJointId;
  const ikDescriptor = selectedPart
    ? describeMotionChain(project, selectedPart.id, selectedIkJointId, {
        rootJointId: selectedChainRootId,
      })
    : undefined;
  const bendJoint = ikDescriptor?.foldJointId
    ? project.skeleton?.joints[ikDescriptor.foldJointId]
    : undefined;
  const jointLabel = (id?: string) => (id ? id.replaceAll("_", " ") : "none");
  useEffect(() => {
    freeDraftRef.current = null;
    setIsFreeDrawing(false);
    setDragPoint(null);
    setSelectedPoint(null);
  }, [selectedPart?.id]);
  const appendFreePoint = (point: Point, seed = false) => {
    const base =
      seed || !freeDraftRef.current
        ? [...(selectedPath?.points ?? [])]
        : freeDraftRef.current;
    const last = base.at(-1);
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 5) return;
    const next = [...base, point].slice(-2000);
    freeDraftRef.current = next;
    setPathPoints(next, "drawn");
  };
  const onCanvasDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawMode || !svgRef.current || pathLocked || e.button !== 0) return;
    const p = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
    setSelectedPoint(null);
    setIsFreeDrawing(true);
    appendFreePoint(p, true);
  };
  const updatePath = (updates: Partial<ProjectMotionPath>) =>
    selectedPath &&
    !pathLocked &&
    dispatch({ type: "upsert_path", path: { ...selectedPath, ...updates } });
  const updateChainRoot = (chainRootJointId: string) =>
    updatePath({ chainRootJointId });
  const updateIkHandle = (targetAnchorJointId: string) => {
    if (!selectedPart) return;
    const roots = motionChainRootJointIds(
      project,
      selectedPart.id,
      targetAnchorJointId,
    );
    updatePath({
      targetAnchorJointId,
      chainRootJointId:
        selectedPath?.chainRootJointId &&
        roots.includes(selectedPath.chainRootJointId)
          ? selectedPath.chainRootJointId
          : selectedPart.anchorJointId,
    });
  };
  const pickIkJoint = (jointId: string) => {
    if (!selectedPath || !selectedPart || pathLocked) return;
    if (
      selectedIkJointId &&
      jointId !== selectedIkJointId &&
      chainRootOptions.includes(jointId)
    )
      updateChainRoot(jointId);
    else updateIkHandle(jointId);
  };
  const setBendDirection = (bendDirection: number) =>
    bendJoint &&
    dispatch({
      type: "update_joint",
      jointId: bendJoint.id,
      updates: { bendDirection },
    });
  const addJointAtIkHandle = () => {
    if (!project.skeleton || !selectedPart || !selectedIkJointId) return;
    const parent = project.skeleton.joints[selectedIkJointId];
    if (!parent) return;
    const id = uid("joint");
    dispatch({
      type: "add_joint",
      joint: {
        id,
        name: "IK handle",
        position: { x: parent.position.x + 34, y: parent.position.y - 34 },
        parentId: parent.id,
        locked: false,
        bendDirection: 1,
      },
    });
    if (selectedPath && !pathLocked)
      dispatch({
        type: "upsert_path",
        path: { ...selectedPath, targetAnchorJointId: id },
      });
  };
  const movePoint = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isFreeDrawing && svgRef.current && !pathLocked) {
      appendFreePoint(svgPointerToScene(svgRef.current, e.clientX, e.clientY));
      return;
    }
    if (dragPoint === null || !svgRef.current || !selectedPath || pathLocked)
      return;
    const points = [...selectedPath.points];
    points[dragPoint] = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
    setPathPoints(points, selectedPath.source);
  };
  const stopDrawing = () => {
    setDragPoint(null);
    setIsFreeDrawing(false);
    freeDraftRef.current = null;
  };
  const deletePoint = () => {
    if (selectedPoint === null || !selectedPath || pathLocked) return;
    setPathPoints(
      selectedPath.points.filter((_, i) => i !== selectedPoint),
      selectedPath.source,
    );
    setSelectedPoint(null);
  };
  const clearPath = () =>
    selectedPath &&
    !pathLocked &&
    dispatch({ type: "delete_path", pathId: selectedPath.id });
  const switchPathView = (mode: "2d" | "3d") => {
    setPathViewMode(mode);
    if (mode === "3d" && drawMode) {
      stopDrawing();
      setDrawMode(false);
    }
  };
  const togglePathDrawing = () => {
    setPathViewMode("2d");
    if (drawMode) stopDrawing();
    setDrawMode(!drawMode);
  };
  const addLayer = () => {
    const base = selectedPart;
    const id = uid("part");
    const anchorJointId =
      base?.anchorJointId ??
      project.skeleton?.rootJointIds[0] ??
      Object.keys(project.skeleton?.joints ?? {})[0] ??
      "root";
    dispatch({
      type: "upsert_part",
      part: base
        ? {
            ...base,
            id,
            name: `${base.name} copy`,
            transform: {
              ...base.transform,
              x: base.transform.x + 24,
              y: base.transform.y - 24,
            },
            zIndex: Math.max(0, ...sortedParts.map((p) => p.zIndex)) + 1,
          }
        : {
            id,
            name: "New layer",
            anchorJointId,
            transform: { x: 0, y: 0, rotation: 0, scale: 1 },
            zIndex: sortedParts.length,
            opacity: 0.9,
            visible: true,
            locked: false,
            selectable: true,
            bounds: { x: -40, y: -40, width: 80, height: 80 },
            fillColor: "#64748b",
          },
    });
  };
  const pathMechanism = selectedPath
    ? project.mechanisms.find(
        (m) =>
          m.targetPathId === selectedPath.id &&
          m.targetPartId === selectedPath.partId,
      )
    : undefined;
  const previewTargetJointId = selectedPath
    ? preferredMotionJointId(
        project,
        selectedPath.partId,
        pathMechanism?.targetAnchorJointId ?? selectedPath.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath.targetAnchorJointId },
      )
    : undefined;
  const previewAngle = isPlaying ? angle : 0;
  const pathPreview =
    selectedPath?.visible &&
    selectedPath.enabled &&
    selectedPath.points.length > 1
      ? motionPreviewForPath(
          project,
          selectedPath,
          previewAngle,
          previewTargetJointId,
        )
      : undefined;
  return (
    <EditorStageFrame
      stage="path"
      className="path-stage-frame"
      layout={{
        workflow: workflowPane(
          <div
            className="path-panel stage-pane-stack"
            data-testid="novice-path-panel"
          >
            <StageLeftSummary
              project={project}
              title="Path"
              stage="path"
              goStage={goStage}
            >
              <h3>Draw path</h3>
              <select
                aria-label="Selected body part"
                className="field mt-2"
                value={selectedPart?.id ?? ""}
                onChange={(e) =>
                  dispatch({ type: "select_part", partId: e.target.value })
                }
              >
                {sortedParts.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  className={drawMode ? "btn-primary active" : "btn-secondary"}
                  aria-label={drawMode ? "Drawing free path" : "Draw free path"}
                  disabled={pathLocked}
                  onClick={togglePathDrawing}
                >
                  <Route size={16} />
                  {drawMode ? "Drawing" : "Draw"}
                </button>
                <button
                  className="btn-secondary"
                  disabled={!selectedPath || pathLocked}
                  onClick={clearPath}
                >
                  <Trash2 size={16} /> Clear path
                </button>
                <button
                  className="btn-secondary"
                  aria-label="Choose mechanism"
                  disabled={pointCount < 3 || pathLocked}
                  onClick={onNext}
                >
                  Choose
                </button>
              </div>
              <div className="free-draw-status" data-testid="free-draw-status">
                {selectedPath
                  ? `${pointCount} points · ${selectedPath.id}`
                  : "0 points · none"}
                {pathLocked ? " · locked part" : ""}
              </div>
              {selectedPath && (
                <div
                  className="mt-3 space-y-3"
                  data-testid="path-shape-controls"
                >
                  <div className="flex gap-2">
                    <button
                      className={`btn-secondary ${!selectedPath.closed ? "active" : ""}`}
                      disabled={pathLocked}
                      onClick={() => updatePath({ closed: false })}
                    >
                      Open
                    </button>
                    <button
                      className={`btn-secondary ${selectedPath.closed ? "active" : ""}`}
                      disabled={pathLocked}
                      onClick={() => updatePath({ closed: true })}
                    >
                      Closed
                    </button>
                  </div>
                  <MiniNumber
                    label="Smoothness"
                    value={selectedPath.smoothness ?? 0}
                    min={0}
                    max={100}
                    step={1}
                    disabled={pathLocked}
                    onChange={(smoothness) => updatePath({ smoothness })}
                  />
                </div>
              )}
              {!selectedPath && <div className="warning">No path.</div>}
              {selectedPath && selectedPath.points.length < 3 && (
                <div className="warning">Need 3 points.</div>
              )}
              {pathLocked && <div className="warning">Unlock part.</div>}
              {selectedPath?.warnings.map((w, i) => (
                <div key={`${w}-${i}`} className="warning">
                  {w}
                </div>
              ))}
              <details className="advanced-panel mt-4">
                <summary>More</summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-secondary"
                    disabled={pathLocked}
                    onClick={openTracking}
                  >
                    <Route size={16} /> Trace
                  </button>
                  <button
                    className="btn-secondary"
                    aria-label={isPlaying ? "Play / Stop" : "Play"}
                    onClick={() => setIsPlaying(!isPlaying)}
                  >
                    <Play size={16} />
                    {isPlaying ? "Stop" : "Play"}
                  </button>
                  <button className="btn-secondary" onClick={() => setAngle(0)}>
                    Reset
                  </button>
                  {selectedPath && (
                    <button
                      className="btn-secondary"
                      disabled={pathLocked}
                      onClick={() =>
                        updatePath({ visible: !selectedPath.visible })
                      }
                    >
                      {selectedPath.visible ? "Hide path" : "Show path"}
                    </button>
                  )}
                  {selectedPath && (
                    <button
                      className="btn-secondary"
                      disabled={pathLocked}
                      onClick={() =>
                        updatePath({ enabled: !selectedPath.enabled })
                      }
                    >
                      {selectedPath.enabled ? "Disable" : "Enable"}
                    </button>
                  )}
                  {selectedPoint !== null && (
                    <button
                      className="btn-secondary"
                      disabled={pathLocked}
                      onClick={deletePoint}
                    >
                      Delete point
                    </button>
                  )}
                </div>
                <div className="mt-3 text-sm text-slate-600">
                  {selectedPath
                    ? `${selectedPath.source} · ${selectedPath.duration} ms · ${selectedPath.timedPoints?.length ?? 0} timed samples`
                    : "No timing"}
                </div>
              </details>
              {project.settings.partPanelVisible ? (
                <details
                  className="advanced-panel mt-4"
                  data-testid="rig-structure-drawer"
                >
                  <summary>Rig setup</summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <h4 className="section-title">Rig</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary" onClick={addLayer}>
                        <Plus size={16} /> Add layer
                      </button>
                      {selectedPart && (
                        <button
                          className="btn-secondary"
                          disabled={selectedPart.locked}
                          onClick={() =>
                            dispatch({
                              type: "delete_part",
                              partId: selectedPart.id,
                            })
                          }
                        >
                          <Trash2 size={16} /> Remove layer
                        </button>
                      )}
                      <button
                        className="btn-secondary"
                        disabled={!selectedPart || pathLocked}
                        onClick={addJointAtIkHandle}
                      >
                        <Plus size={16} /> New IK handle
                      </button>
                    </div>
                    {selectedPart && (
                      <PartInspector
                        part={selectedPart}
                        skeleton={project.skeleton}
                        sourceTextureUrl={
                          project.characterPackage?.sourceTextureUrl
                        }
                        dispatch={dispatch}
                      />
                    )}
                    <div className="divider mt-4" />
                    <SkeletonInspector project={project} dispatch={dispatch} />
                  </div>
                </details>
              ) : (
                <div
                  className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-500"
                  data-testid="rig-structure-hidden"
                >
                  Part panel hidden.
                </div>
              )}
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <div className="path-canvas-shell canvas-workspace overflow-hidden p-0">
            <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
            <div
              className="path-view-switch"
              data-testid="path-view-switch"
              aria-label="Path view mode"
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                data-testid="path-view-2d"
                className={pathViewMode === "2d" ? "active" : ""}
                aria-pressed={pathViewMode === "2d"}
                onClick={() => switchPathView("2d")}
              >
                2D
              </button>
              <button
                type="button"
                data-testid="path-view-3d"
                className={pathViewMode === "3d" ? "active" : ""}
                aria-pressed={pathViewMode === "3d"}
                onClick={() => switchPathView("3d")}
              >
                3D
              </button>
            </div>
            {pathViewMode === "2d" ? (
              <SceneSketch
                svgRef={svgRef}
                project={project}
                selectedPath={selectedPath}
                dragPoint={dragPoint}
                selectedPoint={selectedPoint}
                setDragPoint={setDragPoint}
                setSelectedPoint={setSelectedPoint}
                onPointMove={movePoint}
                onPointUp={stopDrawing}
                onCanvasDown={onCanvasDown}
                onJointPick={pickIkJoint}
                dispatch={dispatch}
                drawMode={drawMode}
                pathLocked={pathLocked}
                isPlaying={isPlaying}
                angle={angle}
                viewport={viewport}
                setViewport={setViewport}
              />
            ) : (
              <ThreePuppetPreview
                project={project}
                animatedParts={pathPreview?.parts ?? {}}
                skeleton={pathPreview?.skeleton ?? project.skeleton}
                mechanisms={[]}
                paths={selectedPath ? [selectedPath] : []}
                selectedPathId={selectedPath?.id}
                angle={angle}
                viewport={viewport}
                setViewport={setViewport}
                inputMode="always"
                testId="path-three-puppet"
                cameraPresets={["iso"]}
              />
            )}
          </div>,
        ),
        inspector: inspectorPane(
          <div className="path-inspector stage-pane-stack">
            <div>
              <div className="section-title">Selection</div>
              <h3>{selectedPart?.name ?? "No body part selected"}</h3>
            </div>
            {selectedPath && (
              <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                <div className="font-bold text-slate-800">Path</div>
                <div>
                  {selectedPath.id} · {pointCount} points ·{" "}
                  {selectedPath.closed ? "closed" : "open"}
                </div>
                <div>
                  {selectedPoint !== null && selectedPath.points[selectedPoint]
                    ? `Point ${selectedPoint + 1}: ${selectedPath.points[selectedPoint].x.toFixed(0)}, ${selectedPath.points[selectedPoint].y.toFixed(0)}`
                    : "Select point."}
                </div>
              </div>
            )}
            <div className="rig-helper" data-testid="quick-rig-helper">
              <h4 className="section-title">Bones</h4>
              <h3>IK</h3>
              {selectedPart && (
                <label
                  className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? "opacity-50" : ""}`}
                >
                  Start
                  <select
                    aria-label="IK chain root"
                    className="field mt-1"
                    disabled={pathLocked || !selectedPath}
                    value={selectedChainRootId ?? ""}
                    onChange={(e) => updateChainRoot(e.target.value)}
                  >
                    {chainRootOptions.map((id) => (
                      <option key={id} value={id}>
                        {jointLabel(id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedPart && selectedPath && (
                <div
                  className="flex flex-wrap gap-2"
                  data-testid="ik-chain-root-options"
                >
                  {chainRootOptions.map((id) => (
                    <button
                      type="button"
                      key={id}
                      className={`btn-secondary ${id === selectedChainRootId ? "active" : ""}`}
                      disabled={pathLocked}
                      onClick={() => updateChainRoot(id)}
                    >
                      {jointLabel(id)}
                    </button>
                  ))}
                </div>
              )}
              {selectedPart && (
                <label
                  className={`block text-xs font-black uppercase tracking-wider text-slate-500 ${pathLocked || !selectedPath ? "opacity-50" : ""}`}
                >
                  Handle
                  <select
                    aria-label="IK handle"
                    className="field mt-1"
                    disabled={pathLocked || !selectedPath}
                    value={selectedIkJointId ?? ""}
                    onChange={(e) => updateIkHandle(e.target.value)}
                  >
                    {jointOptions.map((id) => (
                      <option key={id} value={id}>
                        {motionChainOptionLabel(project, selectedPart.id, id)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectedPart && (
                <div
                  className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-slate-600"
                  data-testid="ik-chain-summary"
                  title={ikDescriptor?.helper ?? "Pick handle."}
                >
                  <div className="font-bold text-slate-800">
                    {ikDescriptor?.label ?? "No limb"}
                  </div>
                </div>
              )}
              <div className="fold-picker" data-testid="fold-direction-control">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Bend
                  </div>
                  <div className="text-sm text-slate-600">
                    {bendJoint
                      ? `${jointLabel(bendJoint.id)} → ${bendJoint.bendDirection < 0 ? "left" : "right"}`
                      : ikDescriptor?.kind === "two-joint-direct"
                        ? "No bend"
                        : "Pick elbow/knee"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    aria-label="Fold left"
                    className={`btn-secondary ${bendJoint && bendJoint.bendDirection < 0 ? "active" : ""}`}
                    disabled={!bendJoint || bendJoint.locked}
                    onClick={() => setBendDirection(-1)}
                  >
                    Left
                  </button>
                  <button
                    aria-label="Fold right"
                    className={`btn-secondary ${bendJoint && bendJoint.bendDirection >= 0 ? "active" : ""}`}
                    disabled={!bendJoint || bendJoint.locked}
                    onClick={() => setBendDirection(1)}
                  >
                    Right
                  </button>
                </div>
              </div>
            </div>
          </div>,
        ),
      }}
    />
  );
};

const SceneSketch = ({
  project,
  svgRef,
  selectedPath,
  dragPoint,
  selectedPoint,
  setDragPoint,
  setSelectedPoint,
  onPointMove,
  onPointUp,
  onCanvasDown,
  onJointPick,
  dispatch,
  drawMode,
  pathLocked,
  isPlaying,
  angle,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  svgRef: React.RefObject<SVGSVGElement | null>;
  selectedPath?: ProjectMotionPath;
  dragPoint: number | null;
  selectedPoint: number | null;
  setDragPoint: (i: number | null) => void;
  setSelectedPoint: (i: number | null) => void;
  onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onPointUp: () => void;
  onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onJointPick: (jointId: string) => void;
  dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
  drawMode?: boolean;
  pathLocked?: boolean;
  isPlaying: boolean;
  angle: number;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
  const kit = project.settings.physicalKit;
  const sheet = sceneBoundsForSheet(kit);
  const pathMechanism = selectedPath
    ? project.mechanisms.find(
        (m) =>
          m.targetPathId === selectedPath.id &&
          m.targetPartId === selectedPath.partId,
      )
    : undefined;
  const requestedTargetJointId =
    pathMechanism?.targetAnchorJointId ?? selectedPath?.targetAnchorJointId;
  const targetJointId = selectedPath
    ? preferredMotionJointId(
        project,
        selectedPath.partId,
        requestedTargetJointId,
        { preferDistalWhenRoot: !requestedTargetJointId },
      )
    : undefined;
  const previewAngle = isPlaying ? angle : 0;
  const pathPreview =
    selectedPath?.visible &&
    selectedPath.enabled &&
    selectedPath.points.length > 1
      ? motionPreviewForPath(project, selectedPath, previewAngle, targetJointId)
      : undefined;
  const previewSkeleton = pathPreview?.skeleton ?? project.skeleton;
  const previewParts = pathPreview?.parts ?? {};
  const sheetSvg = {
    x: SCENE_VIEW.width / 2 + sheet.x,
    y: SCENE_VIEW.height / 2 - sheet.y - sheet.height,
    width: sheet.width,
    height: sheet.height,
  };
  const gridLines = boardGridLines(kit).map((line) => {
    const a = sceneToSvg(line.a);
    const b = sceneToSvg(line.b);
    return (
      <line
        key={line.key}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#e5e8f0"
        strokeWidth="1"
      />
    );
  });
  const viewWidth = SCENE_VIEW.width / viewport.zoom;
  const viewHeight = SCENE_VIEW.height / viewport.zoom;
  const viewX =
    (SCENE_VIEW.width - viewWidth) / 2 - viewport.offset.x / viewport.zoom;
  const viewY =
    (SCENE_VIEW.height - viewHeight) / 2 - viewport.offset.y / viewport.zoom;
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    offset: Point;
  } | null>(null);
  const scalePan = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect
      ? {
          x:
            ((e.clientX - (panStart?.x ?? e.clientX)) * SCENE_VIEW.width) /
            rect.width,
          y:
            ((e.clientY - (panStart?.y ?? e.clientY)) * SCENE_VIEW.height) /
            rect.height,
        }
      : { x: 0, y: 0 };
  };
  const handlePanOrDrawDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (
      !drawMode &&
      e.button === 0 &&
      !(
        e.target instanceof Element &&
        e.target.closest('[data-canvas-interactive="true"]')
      )
    ) {
      setPanStart({ x: e.clientX, y: e.clientY, offset: viewport.offset });
      e.preventDefault();
      return;
    }
    onCanvasDown(e);
  };
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (panStart) {
      const delta = scalePan(e);
      setViewport((prev) => ({
        ...prev,
        offset: {
          x: panStart.offset.x + delta.x,
          y: panStart.offset.y + delta.y,
        },
      }));
      return;
    }
    onPointMove(e);
  };
  const finishInteraction = () => {
    setPanStart(null);
    onPointUp();
  };
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.stopPropagation();
    const nextZoom = clampCanvasZoom(viewport.zoom * (1 - e.deltaY * 0.001));
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const worldX = viewX + fx * viewWidth;
    const worldY = viewY + fy * viewHeight;
    const nextViewWidth = SCENE_VIEW.width / nextZoom;
    const nextViewHeight = SCENE_VIEW.height / nextZoom;
    const nextViewX = worldX - fx * nextViewWidth;
    const nextViewY = worldY - fy * nextViewHeight;
    setViewport({
      zoom: nextZoom,
      offset: {
        x: ((SCENE_VIEW.width - nextViewWidth) / 2 - nextViewX) * nextZoom,
        y: ((SCENE_VIEW.height - nextViewHeight) / 2 - nextViewY) * nextZoom,
      },
    });
  };
  return (
    <svg
      ref={svgRef}
      aria-label="Path editor canvas"
      data-testid="path-canvas"
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? "cursor-crosshair" : panStart ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseDown={handlePanOrDrawDown}
      onMouseMove={handleMove}
      onMouseUp={finishInteraction}
      onMouseLeave={finishInteraction}
      onWheel={handleWheel}
    >
      <defs>
        <filter id="soft">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13" />
        </filter>
      </defs>
      <rect
        x={sheetSvg.x}
        y={sheetSvg.y}
        width={sheetSvg.width}
        height={sheetSvg.height}
        rx="18"
        fill="white"
        stroke="#d6dbe8"
        strokeWidth="1.5"
      />
      {gridLines}
      <text
        x={sheetSvg.x + 16}
        y={sheetSvg.y + 28}
        className="fill-slate-400 text-[12px] font-bold"
        data-testid="scene-grid-label"
      >
        {formatGridLabel(kit, project.settings.gridUnit)}
      </text>
      {project.settings.debugVisuals && (
        <g data-testid="canvas-debug-visuals" pointerEvents="none">
          <rect
            x={sheetSvg.x + sheetSvg.width - 178}
            y={sheetSvg.y + 14}
            width="160"
            height="72"
            rx="12"
            fill="#0f172a"
            opacity="0.78"
          />
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 38}
            fill="white"
            fontSize="12"
            fontWeight="800"
          >
            Dev layer
          </text>
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 57}
            fill="#cbd5e1"
            fontSize="11"
          >
            {project.partOrder.length} parts ·{" "}
            {Object.keys(project.skeleton?.joints ?? {}).length} joints
          </text>
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 75}
            fill="#cbd5e1"
            fontSize="11"
          >
            snap {project.settings.physicsSnapMode} · fab{" "}
            {project.settings.fabricationReadyMode ? "on" : "off"}
          </text>
        </g>
      )}
      {previewSkeleton?.bones.map(([a, b]) => {
        const ja = previewSkeleton?.joints[a];
        const jb = previewSkeleton?.joints[b];
        if (!ja || !jb) return null;
        const pa = sceneToSvg(ja.position);
        const pb = sceneToSvg(jb.position);
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="#434a59"
            strokeWidth="2"
            opacity="0.12"
          />
        );
      })}
      {project.partOrder
        .map((id) => previewParts[id] ?? project.parts[id])
        .filter(Boolean)
        .map((part) => (
          <React.Fragment key={part.id}>
            <PartShape
              part={part}
              skeleton={previewSkeleton}
              selected={project.selectedPartId === part.id}
              drawMode={drawMode}
              onSelect={() =>
                dispatch({ type: "select_part", partId: part.id })
              }
            />
          </React.Fragment>
        ))}
      {previewSkeleton &&
        Object.values(previewSkeleton.joints).map((j) => {
          const p = sceneToSvg(j.position);
          const pickable = Boolean(selectedPath && !pathLocked && !drawMode);
          return (
            <g
              key={j.id}
              data-canvas-interactive={pickable ? "true" : undefined}
              className={pickable ? "cursor-pointer" : undefined}
              onClick={(e) => {
                if (!pickable) return;
                e.stopPropagation();
                onJointPick(j.id);
              }}
            >
              <circle
                data-testid={`skeleton-joint-${j.id}`}
                cx={p.x}
                cy={p.y}
                r={j.locked ? 6 : 4.5}
                fill={j.locked ? "#64748b" : "#94a3b8"}
                stroke="white"
                strokeWidth="2"
                opacity={pickable ? 0.85 : 0.3}
              />
              <title>
                {j.id} bend {j.bendDirection}
              </title>
            </g>
          );
        })}
      {Object.values(project.paths)
        .filter((p) => p.visible)
        .map((path) => (
          <path
            key={path.id}
            d={pathFromPoints(path.points, path.closed, path.smoothness)}
            fill="none"
            stroke={path.enabled ? "#5a6cff" : "#94a3b8"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.8"
          />
        ))}
      {selectedPath?.visible &&
        selectedPath.points.map((pt, i) => {
          const p = sceneToSvg(pt);
          const active = dragPoint === i || selectedPoint === i;
          return (
            <circle
              data-canvas-interactive="true"
              key={`${selectedPath.id}-${i}`}
              cx={p.x}
              cy={p.y}
              r={active ? 8 : 6}
              fill={active ? "#5a6cff" : "#fff"}
              stroke="#5a6cff"
              strokeWidth="3"
              className={pathLocked ? "cursor-not-allowed" : "cursor-grab"}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (!pathLocked) {
                  setSelectedPoint(i);
                  setDragPoint(i);
                }
              }}
            />
          );
        })}
      {pathPreview?.target &&
        (() => {
          const target = pathPreview.target;
          const p = sceneToSvg(target);
          return (
            <g pointerEvents="none">
              <circle
                cx={p.x}
                cy={p.y}
                r="10"
                fill="#5a6cff"
                stroke="white"
                strokeWidth="3"
              />
              <text
                x={p.x + 14}
                y={p.y - 10}
                className="body-preview-label text-[12px] font-black"
              >
                IK target
              </text>
            </g>
          );
        })()}
    </svg>
  );
};

const PartShape = ({
  part,
  skeleton,
  selected,
  drawMode,
  onSelect,
}: {
  part: BodyPartLayer;
  skeleton?: ProjectState["skeleton"];
  selected: boolean;
  drawMode?: boolean;
  onSelect: () => void;
}) => {
  if (!part.visible) return null;
  const p = sceneToSvg(part.transform);
  const w = part.bounds.width * part.transform.scale;
  const h = part.bounds.height * part.transform.scale;
  const artX = part.bounds.x * part.transform.scale;
  const artY = -(part.bounds.y + part.bounds.height) * part.transform.scale;
  const landmarks = partLandmarkLocalPoints(part, skeleton);
  const outline = fabricablePartOutlinePoints(part, landmarks);
  const outlineD = partOutlinePathD(part, landmarks, {
    scale: part.transform.scale,
    flipY: true,
  });
  const localHoles = landmarks.filter((local) =>
    pointInsideOutline(local, outline, 0.5),
  );
  const holeRadius = Math.max(5, 7.2 * part.transform.scale);
  const maskId = `path-part-surface-mask-${part.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const stroke = selected ? "#5a6cff" : "#94a3b8";
  return (
    <g
      data-canvas-interactive="true"
      data-testid={`path-part-${part.id}`}
      data-assembly-underlay="plate-art-layer"
      transform={`translate(${p.x} ${p.y}) rotate(${-part.transform.rotation})`}
      onClick={(e) => {
        if (!drawMode) {
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`${drawMode ? "cursor-crosshair" : "cursor-pointer"} transition-opacity`}
      opacity={part.opacity}
      filter="url(#soft)"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-1000" y="-1000" width="2000" height="2000" fill="black" />
          <path d={outlineD} fill="white" />
          {localHoles.map((local, index) => (
            <circle
              key={index}
              cx={local.x * part.transform.scale}
              cy={-local.y * part.transform.scale}
              r={holeRadius}
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect
        x={artX}
        y={artY}
        width={w}
        height={h}
        fill="#eef2f7"
        opacity=".72"
        mask={`url(#${maskId})`}
      />
      {part.textureUrl ? (
        <image
          data-testid={`path-part-art-${part.id}`}
          href={part.textureUrl}
          x={artX}
          y={artY}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid meet"
          opacity=".52"
          mask={`url(#${maskId})`}
          style={{ filter: "saturate(0.82) contrast(0.96)" }}
        />
      ) : (
        <rect
          data-testid={`path-part-art-${part.id}`}
          x={artX}
          y={artY}
          width={w}
          height={h}
          rx="22"
          fill={part.fillColor}
          opacity=".52"
          mask={`url(#${maskId})`}
        />
      )}
      <path
        data-testid={`path-part-plate-${part.id}`}
        data-art-offset-x={artX}
        d={outlineD}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 3 : 1.2}
        strokeDasharray={selected ? "0" : "5 5"}
        opacity={selected ? 0.72 : 0.28}
      />
      {part.localPivotOffset && (
        <circle
          cx={part.localPivotOffset.x * part.transform.scale}
          cy={-part.localPivotOffset.y * part.transform.scale}
          r={5}
          fill="#64748b"
          stroke="white"
          strokeWidth="2"
        >
          <title>local pivot</title>
        </circle>
      )}
    </g>
  );
};

const MechanismRecommendationSheet = ({
  isOpen,
  project,
  selectedPart,
  selectedPath,
  onClose,
  onApply,
}: {
  isOpen: boolean;
  project: ProjectState;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  onClose: () => void;
  onApply: (mechanism: MechanismConfig) => void;
}) => {
  const recommendations = useMemo(
    () => buildMechanismRecommendations(project, selectedPart, selectedPath),
    [project, selectedPart, selectedPath],
  );
  const apply = (option: MechanismRecommendation) => {
    onApply(
      mechanismWithGeneratedPath({
        ...option.mechanism,
        id: uid("mech"),
        presetId: `recommendation-${option.type}`,
        recommendation: `${option.reason} Score ${option.score}/100.`,
        warnings: option.mechanism.warnings,
      }),
    );
  };
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-sheet recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-dialog-title"
        data-testid="recommendation-sheet"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="section-title">Recommendations</div>
            <h3 id="recommendation-dialog-title">Recommended mechanisms</h3>
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {!recommendations.length ? (
          <div
            className="recommendation-empty"
            data-testid="recommendation-empty"
          >
            Need 3+ points.
          </div>
        ) : (
          <div className="recommendation-grid mt-5">
            {recommendations.map((option) => (
              <article
                key={option.type}
                className="recommendation-card recommendation-option"
                data-testid={`recommendation-card-${option.type}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      {option.label}
                    </div>
                    <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                      {option.type} · score {option.score}/100
                    </div>
                  </div>
                  <span className="recommendation-score">{option.score}</span>
                </div>
                <svg
                  viewBox="0 0 220 120"
                  className="recommendation-preview mt-3"
                  aria-hidden="true"
                >
                  <path
                    d={option.previewPath}
                    fill="none"
                    stroke={option.mechanism.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="mt-3">{option.reason}</p>
                <p
                  className={`mt-2 text-xs ${option.fabricationErrors.length ? "font-bold text-amber-700" : "text-slate-500"}`}
                >
                  {option.feasibility}
                </p>
                <button
                  className="btn-primary mt-4"
                  disabled={!!option.fabricationErrors.length}
                  onClick={() => apply(option)}
                >
                  Use
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const MechanismFoundry = ({
  project,
  foundry,
  setFoundry,
  selectedPart,
  selectedPath,
  goStage,
  onExport,
}: {
  project: ProjectState;
  foundry: FoundryState;
  setFoundry: (m: FoundryState) => void;
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  goStage: (stage: AppStage) => void;
  onExport: (pkg: FoundryExportPackage) => void;
}) => {
  const [foundryPlaying, setFoundryPlaying] = useState(false);
  const [foundryPhase, setFoundryPhase] = useState(0);
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);
  const [manualAnchor, setManualAnchor] = useState<Point | null>(null);
  const [showForces, setShowForces] = useState(true);
  const [showVelocity, setShowVelocity] = useState(true);
  const [showTrail, setShowTrail] = useState(false);
  const [showPathPreview, setShowPathPreview] = useState(false);
  const [showFoundryGrid, setShowFoundryGrid] = useState(true);
  const [showSensemaking, setShowSensemaking] = useState(false);
  const [foundryExplode, setFoundryExplode] = useState(0);
  const [foundryCamera, setFoundryCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [foundryRigOpacity, setFoundryRigOpacity] = useState(85);
  const [foundryProjectionSize, setFoundryProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [isOrbitingFoundry, setIsOrbitingFoundry] = useState(false);
  const [isZoomingFoundry, setIsZoomingFoundry] = useState(false);
  const [isPanningFoundry, setIsPanningFoundry] = useState(false);
  const foundryOrbitStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    zoom: number;
    pan: Point;
    mode: "orbit" | "zoom" | "pan";
  } | null>(null);
  const foundryParamDragRef = useRef<{
    pointerId: number;
    handle: "B" | "C" | "D";
  } | null>(null);
  const targetReady = Boolean(
    selectedPart &&
    selectedPath &&
    selectedPath.enabled &&
    selectedPath.points.length >= 3,
  );
  const rawLanding =
    manualAnchor ??
    selectedPath?.points[0] ??
    (selectedPart
      ? bodyPartPivotScene(selectedPart, project.skeleton)
      : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
  const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
  const landing = boardToScene(
    landingBoard.col,
    landingBoard.row,
    project.settings.physicalKit,
  );
  const snapDistance = Math.hypot(
    rawLanding.x - landing.x,
    rawLanding.y - landing.y,
  );
  const landedFoundry = useMemo(
    () => ({
      ...foundry,
      anchorX: landing.x,
      anchorY: landing.y,
      sceneAnchor: landing,
    }),
    [foundry, landing.x, landing.y],
  );
  const anchorMarker = {
    x: 180 + (landing.x / SCENE_VIEW.width) * 360,
    y: 120 - (landing.y / SCENE_VIEW.height) * 240,
  };
  const rawFoundryPointTraces = useMemo(
    () => generateMechanismPointTraces(landedFoundry, 96).traces,
    [landedFoundry],
  );
  const preview = useMemo(
    () =>
      rawFoundryPointTraces.find((trace) => trace.primary)?.points ??
      rawFoundryPointTraces[0]?.points ??
      generateCurvePoints(landedFoundry, 96).points,
    [landedFoundry, rawFoundryPointTraces],
  );
  const range = useMemo(
    () => sampleFeasibleRange(landedFoundry),
    [landedFoundry],
  );
  const library = MECHANISM_LIBRARY[foundry.type];
  const classroomSensemaking = library.classroomSensemaking;
  const targetIkJointId = selectedPart
    ? preferredMotionJointId(
        project,
        selectedPart.id,
        selectedPath?.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId },
      )
    : undefined;
  const targetChainRootJointId =
    selectedPath?.chainRootJointId ?? selectedPart?.anchorJointId;
  const feasibilityText = range.warning ?? "360°";
  const foundryFitContext = useMemo(
    () => createMechanismFitContext(landedFoundry, 360, 240, 96),
    [landedFoundry],
  );
  const selectedSimulation = useMemo(
    () =>
      fitMechanismSimulationWithContext(
        landedFoundry,
        foundryPhase,
        foundryFitContext,
      ),
    [landedFoundry, foundryPhase, foundryFitContext],
  );
  const foundryPointTraces = useMemo(
    () =>
      rawFoundryPointTraces.map((trace) => ({
        ...trace,
        points: trace.points.map(foundryFitContext.map),
      })),
    [foundryFitContext, rawFoundryPointTraces],
  );
  const previewPoints = useMemo(
    () =>
      foundryPointTraces.find((trace) => trace.primary)?.points ??
      foundryPointTraces[0]?.points ??
      fitPointsToBox(preview, 360, 240),
    [foundryPointTraces, preview],
  );
  const selectedPhysicalSimulation = useMemo(
    () => ({
      ...selectedSimulation,
      pathPoints: previewPoints,
      pathD: pointsToSvgPath(previewPoints),
    }),
    [previewPoints, selectedSimulation],
  );
  const physicsOverlay = useMemo(
    () =>
      buildFoundryPhysicsOverlay(
        landedFoundry,
        selectedPhysicalSimulation,
        foundryPhase,
        project.settings,
        previewPoints,
      ),
    [
      landedFoundry,
      selectedPhysicalSimulation,
      foundryPhase,
      project.settings,
      previewPoints,
    ],
  );
  const {
    playhead,
    playheadSource,
    velocityRaw,
    forceRaw,
    velocityTip,
    forceTip,
    frictionTip,
    driveTip,
    velocityMagnitude,
    frictionMagnitude,
    forceMagnitude,
    constraintError,
    rule: physicsRule,
  } = physicsOverlay;
  const foundryRenderPlan = useMemo(
    () => fabricationRenderPlanForMechanism(landedFoundry),
    [landedFoundry],
  );
  const foundryTopLayer = foundryRenderPlan.layers.at(-1);
  const foundryStackLayerZ = useMemo(
    () =>
      foundryRenderPlan.layers.map(
        (item) =>
          item.z +
          (foundryExplode / 100) *
            item.stackIndex *
            FABRICATION_RENDER_LAYER_Z_STEP *
            1.5,
      ),
    [foundryExplode, foundryRenderPlan.layers],
  );
  const foundryRenderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        landedFoundry.type,
        foundryRenderPlan.layers,
        foundryStackLayerZ,
      ),
    [foundryRenderPlan.layers, foundryStackLayerZ, landedFoundry.type],
  );
  const foundryMovingLayerIndexes = useMemo(
    () =>
      foundryRenderPlan.layers.flatMap((item, index) =>
        isMovingRenderKind(item.renderKind) ? [index] : [],
      ),
    [foundryRenderPlan.layers],
  );
  const foundrySpacerLayerIndexes = useMemo(
    () =>
      foundryRenderPlan.layers.flatMap((item, index) =>
        item.role === "spacer" ? [index] : [],
      ),
    [foundryRenderPlan.layers],
  );
  const foundryOverlayPinStacks = useMemo(
    () =>
      foundryPinStacks(
        foundryPinStackPoints(
          landedFoundry.type,
          foundryAssemblyPinPoints(
            landedFoundry.type,
            selectedSimulation.state,
          ),
          foundryMovingLayerIndexes,
          foundrySpacerLayerIndexes,
        ),
        foundryRenderedLayerZ,
      ),
    [
      foundryMovingLayerIndexes,
      foundryRenderedLayerZ,
      foundrySpacerLayerIndexes,
      landedFoundry.type,
      selectedSimulation.state,
    ],
  );
  const foundryOverlayPinStackById = useMemo(
    () => new Map(foundryOverlayPinStacks.map((pin) => [pin.id, pin])),
    [foundryOverlayPinStacks],
  );
  const foundryOverlayZ =
    (foundryTopLayer?.z ?? 0.22) +
    (foundryTopLayer
      ? (foundryExplode / 100) *
        foundryTopLayer.stackIndex *
        FABRICATION_RENDER_LAYER_Z_STEP *
        1.5
      : 0) +
    0.18;
  const foundryOverlayZForHandle = (handleId?: string) => {
    const pin = foundryOverlayPinStackById.get(handleId ?? "");
    if (landedFoundry.type === "4bar" && (handleId === "A" || handleId === "D"))
      return pin?.bottomZ ?? foundryOverlayZ;
    return pin?.topZ ?? foundryOverlayZ;
  };
  const projectOverlay = (point: Point | undefined) =>
    projectFoundryOverlayPoint(
      point,
      foundryCamera,
      foundryProjectionSize,
      foundryOverlayZ,
    );
  const projectedPlayhead = projectOverlay(playhead);
  const projectedVelocityTip = projectOverlay(velocityTip);
  const projectedForceTip = projectOverlay(forceTip);
  const projectedFrictionTip = projectOverlay(frictionTip);
  const projectedDriveOrigin = projectOverlay(selectedSimulation.state.j1);
  const projectedDriveTip = projectOverlay(driveTip);
  const projectedAnchorMarker = projectFoundryOverlayPoint(
    anchorMarker,
    foundryCamera,
    foundryProjectionSize,
    0,
  );
  const foundryParamHandles =
    landedFoundry.type === "4bar"
      ? (
          [
            {
              id: "A",
              label: "A fixed",
              point: selectedSimulation.state.p1,
              draggable: false,
            },
            {
              id: "B",
              label: "B crank",
              point: selectedSimulation.state.j1,
              draggable: true,
            },
            {
              id: "C",
              label: "C output",
              point: selectedSimulation.state.j2,
              draggable: true,
            },
            {
              id: "D",
              label: "D ground",
              point: selectedSimulation.state.p2,
              draggable: true,
            },
          ] as const
        )
          .map((handle) => {
            const z = foundryOverlayZForHandle(handle.id);
            return {
              ...handle,
              z,
              screen: projectFoundryOverlayPoint(
                handle.point,
                foundryCamera,
                foundryProjectionSize,
                z,
              ),
            };
          })
          .filter((handle) => handle.screen)
      : [];
  const foundryParamHandleZSummary = foundryParamHandles
    .map((handle) => `${handle.id}:${handle.z.toFixed(2)}`)
    .join(",");
  const hardBlocked =
    !targetReady ||
    range.percentValid === 0 ||
    !Number.isFinite(landing.x) ||
    !Number.isFinite(landing.y);
  const foundryCameraLabel =
    foundryCamera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[foundryCamera.preset].label;
  const foundryPhaseDegrees = Math.round(
    ((((foundryPhase / (Math.PI * 2)) % 1) + 1) % 1) * 360,
  );
  const applyAnchor = (point: Point) => {
    const board = sceneToBoard(point, project.settings.physicalKit);
    const snapped = boardToScene(
      board.col,
      board.row,
      project.settings.physicalKit,
    );
    setManualAnchor(snapped);
    setFoundry({
      ...foundry,
      anchorX: snapped.x,
      anchorY: snapped.y,
      sceneAnchor: snapped,
      transform: {
        ...(foundry.transform ?? {
          x: snapped.x,
          y: snapped.y,
          rotation: foundry.groundAngle ?? 0,
          scale: 1,
        }),
        x: snapped.x,
        y: snapped.y,
      },
    });
  };
  const updateFoundryProjectionSize = (size: FoundryOverlaySize) =>
    setFoundryProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );
  const handleAnchorPick = (point: Point) => {
    if (!isPickingAnchor) return;
    applyAnchor(point);
    setIsPickingAnchor(false);
  };
  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) =>
    setFoundryCamera({
      ...FOUNDRY_VIEW_PRESETS[preset],
      preset,
      pan: { x: 0, y: 0 },
    });
  const handleFoundryPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      isPickingAnchor ||
      (event.button !== 0 && event.button !== 1 && event.button !== 2)
    )
      return;
    const mode = event.altKey
      ? "zoom"
      : event.shiftKey || event.button === 1 || event.button === 2
        ? "pan"
        : "orbit";
    foundryOrbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: foundryCamera.yaw,
      pitch: foundryCamera.pitch,
      zoom: foundryCamera.zoom,
      pan: foundryCamera.pan ?? { x: 0, y: 0 },
      mode,
    };
    setIsOrbitingFoundry(mode === "orbit");
    setIsZoomingFoundry(mode === "zoom");
    setIsPanningFoundry(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleFoundryPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const start = foundryOrbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (start.mode === "zoom") {
      setFoundryCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: clampFoundryZoom(start.zoom + (start.y - event.clientY) * 0.006),
        preset: "custom",
        pan: start.pan,
      });
      return;
    }
    if (start.mode === "pan") {
      const scale = 0.018 / Math.max(0.45, start.zoom);
      setFoundryCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: start.zoom,
        preset: "custom",
        pan: {
          x: start.pan.x - (event.clientX - start.x) * scale,
          y: start.pan.y + (event.clientY - start.y) * scale,
        },
      });
      return;
    }
    setFoundryCamera({
      yaw: start.yaw + (event.clientX - start.x) * 0.45,
      pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
      zoom: start.zoom,
      preset: "custom",
      pan: start.pan,
    });
  };
  const finishFoundryOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (foundryOrbitStartRef.current?.pointerId === event.pointerId) {
      foundryOrbitStartRef.current = null;
      setIsOrbitingFoundry(false);
      setIsZoomingFoundry(false);
      setIsPanningFoundry(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleFoundryWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isPickingAnchor) return;
    event.preventDefault();
    event.stopPropagation();
    setFoundryCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };
  const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
    if (key === "anchorX" || key === "anchorY") {
      const anchor = {
        x: key === "anchorX" ? value : (foundry.anchorX ?? landing.x),
        y: key === "anchorY" ? value : (foundry.anchorY ?? landing.y),
      };
      setManualAnchor(anchor);
      setFoundry(
        normalizeGearMeshMechanism({
          ...foundry,
          [key]: value,
          sceneAnchor: anchor,
          transform: {
            ...(foundry.transform ?? {
              x: anchor.x,
              y: anchor.y,
              rotation: foundry.groundAngle ?? 0,
              scale: 1,
            }),
            x: anchor.x,
            y: anchor.y,
          },
        }),
      );
      return;
    }
    setFoundry(normalizeGearMeshMechanism({ ...foundry, [key]: value }));
  };
  const clampFoundryParam = (key: keyof MechanismConfig, value: number) => {
    const param = PARAMS.find((item) => item.key === key);
    if (!param) return value;
    return Math.max(param.min, Math.min(param.max, value));
  };
  const updateFoundryParams = (updates: Partial<MechanismConfig>) => {
    setFoundry(normalizeGearMeshMechanism({ ...foundry, ...updates }));
  };
  const foundryPointFromOverlayEvent = (
    event: React.PointerEvent<SVGCircleElement>,
    handleId?: string,
  ) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return unprojectFoundryOverlayPoint(
      {
        x:
          ((event.clientX - rect.left) / rect.width) *
          foundryProjectionSize.width,
        y:
          ((event.clientY - rect.top) / rect.height) *
          foundryProjectionSize.height,
      },
      foundryCamera,
      foundryProjectionSize,
      foundryOverlayZForHandle(handleId),
    );
  };
  const applyFoundryParamHandleDrag = (
    handle: "B" | "C" | "D",
    point: Point,
  ) => {
    const s = selectedSimulation.state;
    const scale = Math.max(0.001, selectedSimulation.scale);
    const sceneDistance = (a: Point, b: Point) =>
      Math.hypot(a.x - b.x, a.y - b.y) / scale;
    if (handle === "B") {
      updateFoundryParam(
        "crankLength",
        clampFoundryParam("crankLength", sceneDistance(s.p1, point)),
      );
      return;
    }
    if (handle === "D") {
      updateFoundryParams({
        groundLength: clampFoundryParam(
          "groundLength",
          sceneDistance(s.p1, point),
        ),
        groundAngle:
          (Math.atan2(point.y - s.p1.y, point.x - s.p1.x) * 180) / Math.PI,
      });
      return;
    }
    updateFoundryParams({
      couplerLength: clampFoundryParam(
        "couplerLength",
        sceneDistance(s.j1, point),
      ),
      rockerLength: clampFoundryParam(
        "rockerLength",
        sceneDistance(s.p2, point),
      ),
    });
  };
  const handleFoundryParamPointerDown =
    (handle: "B" | "C" | "D") =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      foundryParamDragRef.current = { pointerId: event.pointerId, handle };
      setFoundryPlaying(false);
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  const handleFoundryParamPointerMove = (
    event: React.PointerEvent<SVGCircleElement>,
  ) => {
    const drag = foundryParamDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = foundryPointFromOverlayEvent(event, drag.handle);
    if (point) applyFoundryParamHandleDrag(drag.handle, point);
  };
  const handleFoundryParamPointerUp = (
    event: React.PointerEvent<SVGCircleElement>,
  ) => {
    if (foundryParamDragRef.current?.pointerId === event.pointerId) {
      foundryParamDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keepCurrentAnchor = (mechanism: MechanismConfig): MechanismConfig => ({
    ...mechanism,
    anchorX: landing.x,
    anchorY: landing.y,
    sceneAnchor: landing,
    transform: {
      ...(mechanism.transform ?? {
        x: landing.x,
        y: landing.y,
        rotation: mechanism.groundAngle ?? 0,
        scale: 1,
      }),
      x: landing.x,
      y: landing.y,
    },
  });
  const setAnchoredFoundry = (mechanism: MechanismConfig) =>
    setFoundry(normalizeGearMeshMechanism(keepCurrentAnchor(mechanism)));
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
    setIsPickingAnchor(false);
    setShowForces(true);
    setShowVelocity(true);
    setShowTrail(false);
    setShowPathPreview(false);
    setFoundryExplode(0);
    setFoundryCamera({
      ...FOUNDRY_VIEW_PRESETS.iso,
      preset: "iso",
      pan: { x: 0, y: 0 },
    });
    setAnchoredFoundry({
      ...createDefaultMechanism(foundry.type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    });
  };
  useEffect(() => {
    if (!foundryPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const elapsed = time - last;
      if (elapsed >= FOUNDRY_ANIMATION_COMMIT_MS) {
        last = time - (elapsed % FOUNDRY_ANIMATION_COMMIT_MS);
        setFoundryPhase(
          (prev) =>
            (prev +
              Math.min(96, elapsed) *
                0.0025 *
                project.settings.animationSpeed) %
            (Math.PI * 2),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [foundryPlaying, project.settings.animationSpeed]);
  const makePackage = (): FoundryExportPackage => {
    const mechanismId = uid("mech");
    const state = calculateLinkage(landedFoundry, 0);
    const physicalOutputPoint =
      landedFoundry.type === "4bar" ||
      landedFoundry.type === "5bar" ||
      landedFoundry.type === "6bar"
        ? state.j2
        : (state.effector ?? state.j2);
    const preset = foundry.presetId ?? "balanced";
    return {
      id: `foundry-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      mechanismId,
      mechanismType: landedFoundry.type,
      parameters: { ...landedFoundry, id: mechanismId },
      pivot: landing,
      outputPoint: state.isValid ? physicalOutputPoint : undefined,
      generatedPath: preview,
      simulationSummary: feasibilityText,
      visual: {
        color: landedFoundry.color,
        scale: landedFoundry.transform?.scale ?? 1,
        constraintsVisible: true,
      },
      animation: {
        duration: selectedPath?.duration ?? 3200,
        steps: preview.length,
        loop: true,
      },
      targetPartId: selectedPart?.id,
      targetPathId: selectedPath?.id,
      targetAnchorJointId: targetIkJointId,
      metadata: {
        sourceTab: "mechanism-foundry",
        selectedPreset: preset,
        recommendation:
          foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation,
        simulationFriction: project.settings.simulationFriction,
        simulationMassKg: project.settings.simulationMassKg,
      },
      warnings: range.warning ? [range.warning] : [],
      source: "mechanism-foundry",
    };
  };
  return (
    <EditorStageFrame
      stage="foundry"
      className="foundry-stage-frame"
      layout={{
        workflow: workflowPane(
          <div className="stage-pane-stack">
            <StageLeftSummary
              project={project}
              title="Foundry"
              stage="foundry"
              goStage={goStage}
            >
              <div
                className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600"
                data-testid="foundry-target-summary"
              >
                <div className="font-bold text-slate-800">
                  Target {selectedPart?.name ?? "none"} ·{" "}
                  {selectedPath?.points.length ?? 0} pts
                </div>
                <div>
                  Board hole {landingBoard.label} · chain{" "}
                  {targetChainRootJointId ?? "none"} →{" "}
                  {targetIkJointId ?? "none"}
                </div>
                {snapDistance > 0.5 && (
                  <div>
                    Snap {snapDistance.toFixed(0)} → {landingBoard.label}
                  </div>
                )}
                <div>
                  <strong>Range</strong>{" "}
                  {range.percentValid === 1 ? "360°" : feasibilityText}
                </div>
                <div data-testid="foundry-feasibility">
                  <strong>Status</strong> {feasibilityText}
                </div>
                <div data-testid="foundry-anchor-status">
                  {isPickingAnchor
                    ? "Pick board hole."
                    : manualAnchor
                      ? "Anchor picked."
                      : (foundry.recommendation ??
                        FOUNDRY_PRESETS.balanced.recommendation)}
                </div>
              </div>
              <button
                type="button"
                data-testid="foundry-pick-anchor"
                className={`btn-secondary w-full ${isPickingAnchor ? "active" : ""}`}
                onClick={() => setIsPickingAnchor((value) => !value)}
              >
                {isPickingAnchor
                  ? "Cancel anchor pick"
                  : "Pick anchor on canvas"}
              </button>
              <button
                className="btn-primary w-full"
                aria-label="Use mechanism"
                disabled={hardBlocked}
                onClick={() => onExport(makePackage())}
              >
                <Boxes size={16} /> Use mechanism
              </button>
              {!targetReady && <div className="warning">Need 3+ points.</div>}
              {range.warning && <div className="warning">{range.warning}</div>}
              <div
                className="sensemaking-cue"
                data-testid="foundry-visible-sensemaking"
                data-sensemaking-check={classroomSensemaking.studentCheck}
                data-sensemaking-answer={classroomSensemaking.expectedAnswer}
                data-sensemaking-evidence={classroomSensemaking.evidenceCue}
                data-sensemaking-clip={classroomSensemaking.clipSlot}
              >
                <span className="cue-title">Why it moves</span>
                <strong>{classroomSensemaking.directTranslation}</strong>
                <small>{classroomSensemaking.tryThis}</small>
              </div>
              <div
                className="compact-fabrication-stack"
                data-testid="foundry-fabrication-stack"
              >
                <strong>Stack</strong>
                <span>{fabricationStackSummary(foundry)}</span>
              </div>
              <h4 className="section-title mt-4">Templates</h4>
              <div
                className="mechanism-choice-grid"
                data-testid="foundry-mechanism-gallery"
              >
                {FOUNDRY_MECHANISM_TYPES.map((type) => {
                  const item = MECHANISM_LIBRARY[type];
                  const cardMechanism = {
                    ...createDefaultMechanism(type, `foundry-card-${type}`),
                    color: foundry.color,
                  };
                  const cardSimulation = fitMechanismSimulation(
                    cardMechanism,
                    foundryPhase,
                    180,
                    96,
                    48,
                  );
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`recommendation-card mechanism-choice ${foundry.type === type ? "active" : ""}`}
                      onClick={() =>
                        setAnchoredFoundry({
                          ...createDefaultMechanism(type, "foundry-preview"),
                          color: foundry.color,
                          presetId: "balanced",
                          recommendation:
                            FOUNDRY_PRESETS.balanced.recommendation,
                        })
                      }
                    >
                      <svg
                        viewBox="0 0 180 96"
                        className="mechanism-choice-sim"
                        data-testid={`foundry-mini-simulation-${type}`}
                        aria-hidden="true"
                      >
                        <path
                          d={cardSimulation.pathD}
                          fill="none"
                          stroke={foundry.color}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          opacity="0.45"
                        />
                        <MechanismLinkagePreview
                          mechanism={cardMechanism}
                          simulation={cardSimulation}
                          kit={project.settings.physicalKit}
                          testId={`foundry-mini-linkage-${type}`}
                          compact
                        />
                      </svg>
                      <div className="font-bold text-slate-800">
                        {item.label}
                      </div>
                      <div>{item.goodFor}</div>
                      <small>{item.classroomSensemaking.directTranslation}</small>
                    </button>
                  );
                })}
              </div>
              {showSensemaking && (
                <div
                  className="recommendation-card"
                  data-testid="foundry-mechanism-library"
                >
                  <div className="font-bold text-slate-800">
                    {library.label}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="blueprint-pill">{physicsRule}</span>
                    <span className="blueprint-pill">
                      {fabricationStackSummary(foundry)}
                    </span>
                    <span className="blueprint-pill">{feasibilityText}</span>
                    <span className="blueprint-pill">
                      {classroomSensemaking.studentCheck}
                    </span>
                    <span className="blueprint-pill">
                      {classroomSensemaking.evidenceCue}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {classroomSensemaking.teacherTakeaway}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {classroomSensemaking.commonHint}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Answer: {classroomSensemaking.expectedAnswer}
                  </p>
                </div>
              )}
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <section className="path-canvas-shell foundry-canvas-shell canvas-workspace p-0">
            <div className="foundry-sim-badge" data-testid="foundry-sim-badge">
              <span className={foundryPlaying ? "status-pulse" : ""} />
              {foundryPlaying ? "Active Sim" : "Paused"}
            </div>
            <div
              className="foundry-camera-hud"
              data-testid="foundry-camera-controls"
              aria-label="Shared 3D viewer toolbar"
              data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
            >
              <span
                className="foundry-camera-readout"
                data-testid="foundry-camera-readout"
              >
                3D {foundryCameraLabel} · {Math.round(foundryCamera.zoom * 100)}
                %
              </span>
              {(
                Object.entries(FOUNDRY_VIEW_PRESETS) as Array<
                  [Exclude<FoundryViewPreset, "custom">, FoundryCameraPreset]
                >
              ).map(([preset, view]) => (
                <button
                  key={preset}
                  type="button"
                  data-testid={`foundry-camera-preset-${preset}`}
                  className={foundryCamera.preset === preset ? "active" : ""}
                  aria-pressed={foundryCamera.preset === preset}
                  onClick={() => setCameraPreset(preset)}
                >
                  {view.label}
                </button>
              ))}
              <span className="viewer-toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                data-testid="foundry-toggle-grid"
                className={showFoundryGrid ? "active" : ""}
                aria-label="Grid layer"
                aria-pressed={showFoundryGrid}
                onClick={() => setShowFoundryGrid(!showFoundryGrid)}
              >
                Grid
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-paths"
                className={showPathPreview ? "active" : ""}
                aria-label="Path layer"
                aria-pressed={showPathPreview}
                onClick={() => setShowPathPreview(!showPathPreview)}
              >
                Path
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-forces"
                className={showForces ? "active" : ""}
                aria-label="Force vector layer"
                aria-pressed={showForces}
                onClick={() => setShowForces(!showForces)}
              >
                Force
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-velocity"
                className={showVelocity ? "active" : ""}
                aria-label="Speed vector layer"
                aria-pressed={showVelocity}
                onClick={() => setShowVelocity(!showVelocity)}
              >
                v
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-trail"
                className={showTrail ? "active" : ""}
                aria-label="Motion trace layer"
                aria-pressed={showTrail}
                onClick={() => setShowTrail(!showTrail)}
              >
                Trace
              </button>
            </div>
            <div
              className="foundry-playback-hud foundry-toolbar"
              data-testid="foundry-toolbar"
              aria-label="Foundry playback"
            >
              <button
                className={`btn-secondary ${foundryPlaying ? "active" : ""}`}
                onClick={() => setFoundryPlaying(!foundryPlaying)}
              >
                {foundryPlaying ? "Pause" : "Play"}
              </button>
              <button className="btn-secondary" onClick={resetFoundryPreview}>
                Reset
              </button>
              <input
                aria-label="Foundry phase"
                type="range"
                min="0"
                max="360"
                value={foundryPhaseDegrees}
                onChange={(event) => {
                  setFoundryPlaying(false);
                  setFoundryPhase((Number(event.target.value) * Math.PI) / 180);
                }}
              />
              <span>{foundryPhaseDegrees}°</span>
            </div>
            <ThreeFoundryPreview
              mechanism={landedFoundry}
              simulation={selectedPhysicalSimulation}
              kit={project.settings.physicalKit}
              camera={foundryCamera}
              rigOpacity={foundryRigOpacity / 100}
              color={foundry.color}
              pathPoints={previewPoints}
              pathTraces={foundryPointTraces}
              showGrid={showFoundryGrid}
              showPathPreview={showPathPreview}
              showTrail={showTrail}
              showForces={showForces}
              showVelocity={showVelocity}
              explode={foundryExplode / 100}
              physicsRule={physicsRule}
              velocityMagnitude={velocityMagnitude}
              forceMagnitude={forceMagnitude}
              frictionCoefficient={project.settings.simulationFriction}
              frictionMagnitude={frictionMagnitude}
              constraintError={constraintError}
              cameraLabel={foundryCameraLabel}
              isPickingAnchor={isPickingAnchor}
              isOrbiting={isOrbitingFoundry}
              isZooming={isZoomingFoundry}
              isPanning={isPanningFoundry}
              onAnchorPick={handleAnchorPick}
              onPointerDown={handleFoundryPointerDown}
              onPointerMove={handleFoundryPointerMove}
              onPointerUp={finishFoundryOrbit}
              onPointerCancel={finishFoundryOrbit}
              onWheel={handleFoundryWheel}
              onProjectionSizeChange={updateFoundryProjectionSize}
            >
              <svg
                data-testid="foundry-preview-overlay"
                viewBox={`0 0 ${foundryProjectionSize.width} ${foundryProjectionSize.height}`}
                className="foundry-preview-overlay"
                aria-label="Foundry physical joint overlay"
                data-projection-aspect={(
                  foundryProjectionSize.width /
                  Math.max(1, foundryProjectionSize.height)
                ).toFixed(3)}
              >
                {showForces &&
                  projectedPlayhead &&
                  projectedForceTip &&
                  projectedDriveOrigin &&
                  projectedDriveTip && (
                    <g
                      data-testid="foundry-forces-overlay"
                      className="physics-vector physics-force"
                      data-projection="three-camera"
                      data-origin-source={playheadSource}
                      data-physics-rule={physicsRule}
                      data-fx={forceRaw.x.toFixed(3)}
                      data-fy={forceRaw.y.toFixed(3)}
                      data-force-magnitude={forceMagnitude.toFixed(3)}
                      data-friction-magnitude={frictionMagnitude.toFixed(3)}
                      data-constraint-error={constraintError.toFixed(3)}
                      stroke="#ef4444"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <defs>
                        <marker
                          id="foundry-arrow-force-overlay"
                          markerWidth="7"
                          markerHeight="7"
                          refX="6"
                          refY="3.5"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#ef4444" />
                        </marker>
                      </defs>
                      <defs>
                        <marker
                          id="foundry-arrow-friction-overlay"
                          markerWidth="7"
                          markerHeight="7"
                          refX="6"
                          refY="3.5"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#f59e0b" />
                        </marker>
                      </defs>
                      <line
                        data-testid="foundry-force-vector"
                        x1={projectedPlayhead.x}
                        y1={projectedPlayhead.y}
                        x2={projectedForceTip.x}
                        y2={projectedForceTip.y}
                        markerEnd="url(#foundry-arrow-force-overlay)"
                      />
                      <line
                        data-testid="foundry-drive-force-vector"
                        x1={projectedDriveOrigin.x}
                        y1={projectedDriveOrigin.y}
                        x2={projectedDriveTip.x}
                        y2={projectedDriveTip.y}
                        opacity="0.68"
                        markerEnd="url(#foundry-arrow-force-overlay)"
                      />
                      {projectedFrictionTip && (
                        <line
                          data-testid="foundry-friction-vector"
                          x1={projectedPlayhead.x}
                          y1={projectedPlayhead.y}
                          x2={projectedFrictionTip.x}
                          y2={projectedFrictionTip.y}
                          stroke="#f59e0b"
                          markerEnd="url(#foundry-arrow-friction-overlay)"
                        />
                      )}
                      <text
                        x={projectedForceTip.x + 5}
                        y={projectedForceTip.y - 3}
                      >
                        F / a
                      </text>
                      <text
                        x={projectedDriveTip.x + 5}
                        y={projectedDriveTip.y + 9}
                      >
                        drive τ
                      </text>
                      {projectedFrictionTip && (
                        <text
                          x={projectedFrictionTip.x + 5}
                          y={projectedFrictionTip.y + 9}
                          fill="#92400e"
                        >
                          μ
                        </text>
                      )}
                    </g>
                  )}
                {showVelocity && projectedPlayhead && projectedVelocityTip && (
                  <g
                    data-testid="foundry-velocity-overlay"
                    className="physics-vector physics-velocity"
                    data-projection="three-camera"
                    data-origin-source={playheadSource}
                    data-vx={velocityRaw.x.toFixed(3)}
                    data-vy={velocityRaw.y.toFixed(3)}
                    data-speed={velocityMagnitude.toFixed(3)}
                    stroke="#10b981"
                    strokeWidth="4"
                    strokeLinecap="round"
                  >
                    <defs>
                      <marker
                        id="foundry-arrow-velocity-overlay"
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3.5"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#10b981" />
                      </marker>
                    </defs>
                    <line
                      data-testid="foundry-velocity-vector"
                      x1={projectedPlayhead.x}
                      y1={projectedPlayhead.y}
                      x2={projectedVelocityTip.x}
                      y2={projectedVelocityTip.y}
                      markerEnd="url(#foundry-arrow-velocity-overlay)"
                    />
                    <text
                      x={projectedVelocityTip.x + 5}
                      y={projectedVelocityTip.y - 3}
                    >
                      v
                    </text>
                  </g>
                )}
                {projectedPlayhead && (
                  <circle
                    data-testid="foundry-playhead"
                    data-projection="three-camera"
                    data-origin-source={playheadSource}
                    cx={projectedPlayhead.x}
                    cy={projectedPlayhead.y}
                    r="7"
                    fill="#f472b6"
                    stroke="white"
                    strokeWidth="3"
                  />
                )}
                {foundryParamHandles.length > 0 && (
                  <g
                    data-testid="foundry-param-handles"
                    data-handle-contract="4bar-A-B-C-D"
                    data-projection="three-camera"
                    data-handle-z-contract="board-pivots-bottom-floating-top"
                    data-handle-z-map={foundryParamHandleZSummary}
                  >
                    {foundryParamHandles.map((handle) => (
                      <g
                        key={handle.id}
                        transform={`translate(${handle.screen!.x} ${handle.screen!.y})`}
                        data-testid={`foundry-param-handle-group-${handle.id}`}
                      >
                        <circle
                          data-testid={`foundry-param-handle-${handle.id}`}
                          className={`foundry-param-handle ${handle.draggable ? "is-draggable" : "is-locked"}`}
                          data-param-handle={handle.id}
                          data-param-role={handle.label}
                          data-draggable={String(handle.draggable)}
                          data-projection-z={handle.z.toFixed(2)}
                          r={handle.draggable ? 8 : 6}
                          fill={handle.draggable ? "#ffffff" : "#e2e8f0"}
                          stroke={handle.draggable ? "#4f46e5" : "#64748b"}
                          strokeWidth="3"
                          onPointerDown={
                            handle.draggable
                              ? handleFoundryParamPointerDown(
                                  handle.id as "B" | "C" | "D",
                                )
                              : undefined
                          }
                          onPointerMove={
                            handle.draggable
                              ? handleFoundryParamPointerMove
                              : undefined
                          }
                          onPointerUp={
                            handle.draggable
                              ? handleFoundryParamPointerUp
                              : undefined
                          }
                          onPointerCancel={
                            handle.draggable
                              ? handleFoundryParamPointerUp
                              : undefined
                          }
                        />
                        <text className="foundry-param-label" x="10" y="-8">
                          {handle.id}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
                {(isPickingAnchor || manualAnchor) && projectedAnchorMarker && (
                  <g
                    data-testid="foundry-anchor-marker"
                    data-projection="three-camera"
                    transform={`translate(${projectedAnchorMarker.x} ${projectedAnchorMarker.y})`}
                  >
                    <circle
                      r="8"
                      fill="#ffffff"
                      stroke="#8b5cf6"
                      strokeWidth="3"
                    />
                    <path
                      d="M -13 0 H 13 M 0 -13 V 13"
                      stroke="#8b5cf6"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <text
                      x="12"
                      y="-10"
                      fill="#5b21b6"
                      fontSize="8"
                      fontWeight="900"
                    >
                      {landingBoard.label}
                    </text>
                  </g>
                )}
              </svg>
            </ThreeFoundryPreview>
            <div hidden data-testid="foundry-toolbar-state">
              Toolbar: {foundryPlaying ? "playing" : "paused"} · grid{" "}
              {showFoundryGrid ? "shown" : "hidden"} · path{" "}
              {showPathPreview ? "shown" : "hidden"} · camera{" "}
              {foundryCameraLabel} · phase{" "}
              {Math.round((foundryPhase * 180) / Math.PI)}°
            </div>
          </section>,
        ),
        inspector: inspectorPane(
          <div className="stage-pane-stack">
            <div>
              <div className="section-title">Selected mechanism</div>
              <h3>{library.label}</h3>
              <div
                className="physics-readout mt-3"
                data-testid="foundry-physics-readout"
              >
                <strong>Motion</strong>
                <span>{physicsRule}</span>
                <span>
                  v {velocityMagnitude.toFixed(1)} · F{" "}
                  {forceMagnitude.toFixed(1)} · μ{" "}
                  {project.settings.simulationFriction.toFixed(2)}
                </span>
                <span>
                  constraint err {constraintError.toFixed(2)} · mass{" "}
                  {project.settings.simulationMassKg.toFixed(1)}kg
                </span>
              </div>
            </div>
            <div
              className="foundry-opacity-panel inspector-control-card"
              data-testid="foundry-opacity-panel"
            >
              <div>
                <span>Rig Opacity</span>
                <strong>{foundryRigOpacity}%</strong>
              </div>
              <input
                aria-label="Rig opacity"
                type="range"
                min="35"
                max="100"
                value={foundryRigOpacity}
                onChange={(event) =>
                  setFoundryRigOpacity(Number(event.target.value))
                }
              />
            </div>
            <div
              className="foundry-opacity-panel inspector-control-card"
              data-testid="foundry-explode-panel"
            >
              <div>
                <span>Exploded view</span>
                <strong>{foundryExplode}%</strong>
              </div>
              <input
                aria-label="Exploded view"
                type="range"
                min="0"
                max="100"
                value={foundryExplode}
                onChange={(event) =>
                  setFoundryExplode(Number(event.target.value))
                }
              />
            </div>
            <MechanismParametricEditor
              mechanism={foundry}
              onChange={updateFoundryParams}
              testId="foundry-parametric-editor"
            />
            <details className="advanced-panel">
              <summary>Mechanism options</summary>
              <div className="mt-3 space-y-3">
                <select
                  aria-label="Foundry mechanism type"
                  className="field"
                  value={foundry.type}
                  onChange={(e) =>
                    setAnchoredFoundry({
                      ...createDefaultMechanism(
                        e.target.value as MechanismType,
                        "foundry-preview",
                      ),
                      color: foundry.color,
                      presetId: "balanced",
                      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
                    })
                  }
                >
                  {FOUNDRY_MECHANISM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {mechanismTemplateLabel(t)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Foundry preset"
                  className="field"
                  value={foundry.presetId ?? "balanced"}
                  onChange={(e) => {
                    const presetId = e.target.value;
                    const preset = FOUNDRY_PRESETS[presetId];
                    const { label: _label, ...updates } = preset;
                    const base =
                      presetId === "balanced"
                        ? createDefaultMechanism(
                            foundry.type,
                            "foundry-preview",
                          )
                        : foundry;
                    setAnchoredFoundry({
                      ...base,
                      color: foundry.color,
                      ...updates,
                      presetId,
                      recommendation: preset.recommendation,
                    });
                  }}
                >
                  {Object.entries(FOUNDRY_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {PARAMS.filter((p) => showParam(foundry.type, p.key)).map(
                  (p) => (
                    <React.Fragment key={String(p.key)}>
                      <MiniNumber
                        label={p.label}
                        value={Number(foundry[p.key] ?? 0)}
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        onChange={(value) => updateFoundryParam(p.key, value)}
                      />
                    </React.Fragment>
                  ),
                )}
              </div>
            </details>
            <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
              <div className="font-bold text-slate-800">Preview overlays</div>
              <div className="foundry-toolbar mt-2">
                <button
                  type="button"
                  className={`btn-secondary ${showForces ? "active" : ""}`}
                  aria-pressed={showForces}
                  onClick={() => setShowForces(!showForces)}
                >
                  Forces
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${showVelocity ? "active" : ""}`}
                  aria-pressed={showVelocity}
                  onClick={() => setShowVelocity(!showVelocity)}
                >
                  Velocity
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${showTrail ? "active" : ""}`}
                  aria-pressed={showTrail}
                  onClick={() => setShowTrail(!showTrail)}
                >
                  Trail
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${showPathPreview ? "active" : ""}`}
                  aria-pressed={showPathPreview}
                  onClick={() => setShowPathPreview(!showPathPreview)}
                >
                  Path
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${showSensemaking ? "active" : ""}`}
                  aria-label="Show details"
                  aria-pressed={showSensemaking}
                  onClick={() => setShowSensemaking(!showSensemaking)}
                >
                  Details
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Hide details"
                  onClick={() => setShowSensemaking(false)}
                >
                  Hide details
                </button>
              </div>
            </div>
          </div>,
        ),
      }}
    />
  );
};

type DesignFoundryPreviewProps = {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  showTrace: boolean;
};

const DesignFoundryPreview = ({
  project,
  mechanism,
  angle,
  showTrace,
}: DesignFoundryPreviewProps) => {
  const [camera, setCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [projectionSize, setProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [showGrid, setShowGrid] = useState(true);
  const [showPathPreview, setShowPathPreview] = useState(true);
  const [showForces, setShowForces] = useState(true);
  const [showVelocity, setShowVelocity] = useState(true);
  const [explode, setExplode] = useState(0);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const orbitStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    zoom: number;
    pan: Point;
    mode: "orbit" | "zoom" | "pan";
  } | null>(null);

  const designMechanism = useMemo(
    () => (mechanism ? normalizeGearMeshMechanism(mechanism) : undefined),
    [mechanism],
  );
  const rawPointTraces = useMemo(
    () =>
      designMechanism
        ? generateMechanismPointTraces(designMechanism, 96).traces
        : [],
    [designMechanism],
  );
  const fitContext = useMemo(
    () =>
      designMechanism
        ? createMechanismFitContext(designMechanism, 360, 240, 96)
        : undefined,
    [designMechanism],
  );
  const selectedSimulation = useMemo(
    () =>
      designMechanism && fitContext
        ? fitMechanismSimulationWithContext(designMechanism, angle, fitContext)
        : undefined,
    [angle, designMechanism, fitContext],
  );
  const pointTraces = useMemo(
    () =>
      fitContext
        ? rawPointTraces.map((trace) => ({
            ...trace,
            points: trace.points.map(fitContext.map),
          }))
        : [],
    [fitContext, rawPointTraces],
  );
  const fallbackPreview = useMemo(
    () =>
      designMechanism
        ? fitPointsToBox(
            generateCurvePoints(designMechanism, 96).points,
            360,
            240,
          )
        : [],
    [designMechanism],
  );
  const previewPoints = useMemo(
    () =>
      pointTraces.find((trace) => trace.primary)?.points ??
      pointTraces[0]?.points ??
      fallbackPreview,
    [fallbackPreview, pointTraces],
  );
  const physicalSimulation = useMemo(
    () =>
      selectedSimulation
        ? {
            ...selectedSimulation,
            pathPoints: previewPoints,
            pathD: pointsToSvgPath(previewPoints),
          }
        : undefined,
    [previewPoints, selectedSimulation],
  );
  const physicsOverlay = useMemo(
    () =>
      designMechanism && physicalSimulation
        ? buildFoundryPhysicsOverlay(
            designMechanism,
            physicalSimulation,
            angle,
            project.settings,
            previewPoints,
          )
        : undefined,
    [
      angle,
      designMechanism,
      physicalSimulation,
      previewPoints,
      project.settings,
    ],
  );
  const designContextPaths = useMemo(() => {
    const targetPath = designMechanism?.targetPathId
      ? project.paths[designMechanism.targetPathId]
      : undefined;
    const selectedPath = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    const firstVisiblePath = Object.values(project.paths).find(
      (path) => path.visible !== false,
    );
    const path = targetPath ?? selectedPath ?? firstVisiblePath;
    return path ? [path] : [];
  }, [designMechanism?.targetPathId, project.paths, project.selectedPathId]);
  const designContextAnimatedParts = useMemo(
    () =>
      designMechanism
        ? animatedPartsForProject(project, [designMechanism], angle)
        : {},
    [angle, designMechanism, project],
  );
  const designContextPathId = designContextPaths[0]?.id;

  const updateProjectionSize = (size: FoundryOverlaySize) =>
    setProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );
  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) =>
    setCamera({ ...FOUNDRY_VIEW_PRESETS[preset], preset, pan: { x: 0, y: 0 } });
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode = event.altKey
      ? "zoom"
      : event.shiftKey || event.button === 1 || event.button === 2
        ? "pan"
        : "orbit";
    orbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: camera.zoom,
      pan: camera.pan ?? { x: 0, y: 0 },
      mode,
    };
    setIsOrbiting(mode === "orbit");
    setIsZooming(mode === "zoom");
    setIsPanning(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = orbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (start.mode === "zoom") {
      setCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: clampFoundryZoom(start.zoom + (start.y - event.clientY) * 0.006),
        preset: "custom",
        pan: start.pan,
      });
      return;
    }
    if (start.mode === "pan") {
      const scale = 0.018 / Math.max(0.45, start.zoom);
      setCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: start.zoom,
        preset: "custom",
        pan: {
          x: start.pan.x - (event.clientX - start.x) * scale,
          y: start.pan.y + (event.clientY - start.y) * scale,
        },
      });
      return;
    }
    setCamera({
      yaw: start.yaw + (event.clientX - start.x) * 0.45,
      pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
      zoom: start.zoom,
      preset: "custom",
      pan: start.pan,
    });
  };
  const finishPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (orbitStartRef.current?.pointerId !== event.pointerId) return;
    orbitStartRef.current = null;
    setIsOrbiting(false);
    setIsZooming(false);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };

  if (!designMechanism || !physicalSimulation || !physicsOverlay) {
    return (
      <div
        className="blueprint-empty-state"
        data-testid="design-shared-foundry-empty"
      >
        Add a mechanism.
      </div>
    );
  }

  const cameraLabel =
    camera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[camera.preset].label;
  return (
    <section
      className="design-shared-foundry-preview foundry-canvas-shell canvas-workspace"
      data-testid="design-shared-foundry-preview"
      data-renderer-source="ThreeFoundryPreview"
      data-shared-with="foundry-preview"
      data-mechanism-id={designMechanism.id}
      data-mechanism-type={designMechanism.type}
      data-guided-context-mode="character-path-mechanism"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={designContextPaths.length}
      data-guided-context-path-id={designContextPathId ?? ""}
    >
      <div
        className="foundry-camera-hud design-foundry-camera-hud"
        data-testid="design-foundry-camera-controls"
        aria-label="Shared Foundry viewer controls"
      >
        <span
          className="foundry-camera-readout"
          data-testid="design-foundry-camera-readout"
        >
          3D {cameraLabel} · {Math.round(camera.zoom * 100)}%
        </span>
        {(["front", "iso", "side", "top"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className={camera.preset === preset ? "active" : ""}
            onClick={() => setCameraPreset(preset)}
          >
            {preset === "iso"
              ? "Isometric"
              : FOUNDRY_VIEW_PRESETS[preset].label}
          </button>
        ))}
        <span className="viewer-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className={showGrid ? "active" : ""}
          onClick={() => setShowGrid((value) => !value)}
        >
          Grid
        </button>
        <button
          type="button"
          className={showPathPreview ? "active" : ""}
          onClick={() => setShowPathPreview((value) => !value)}
        >
          Path
        </button>
        <button
          type="button"
          className={showForces ? "active" : ""}
          onClick={() => setShowForces((value) => !value)}
        >
          Force
        </button>
        <button
          type="button"
          className={showVelocity ? "active" : ""}
          onClick={() => setShowVelocity((value) => !value)}
        >
          v
        </button>
      </div>
      <div
        className="foundry-opacity-panel"
        data-testid="design-foundry-stack-controls"
      >
        <div>
          <span>Explode</span>
          <strong>{explode}%</strong>
        </div>
        <input
          aria-label="Design explode stack"
          type="range"
          min="0"
          max="100"
          value={explode}
          onChange={(event) => setExplode(Number(event.target.value))}
        />
      </div>
      <ThreeFoundryPreview
        mechanism={designMechanism}
        simulation={physicalSimulation}
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.85}
        color={designMechanism.color}
        pathPoints={previewPoints}
        pathTraces={pointTraces}
        showGrid={showGrid}
        showPathPreview={showPathPreview}
        showTrail={showTrace}
        showForces={showForces}
        showVelocity={showVelocity}
        explode={explode / 100}
        physicsRule={physicsOverlay.rule}
        velocityMagnitude={physicsOverlay.velocityMagnitude}
        forceMagnitude={physicsOverlay.forceMagnitude}
        frictionCoefficient={project.settings.simulationFriction}
        frictionMagnitude={physicsOverlay.frictionMagnitude}
        constraintError={physicsOverlay.constraintError}
        cameraLabel={cameraLabel}
        isPickingAnchor={false}
        isOrbiting={isOrbiting}
        isZooming={isZooming}
        isPanning={isPanning}
        onAnchorPick={() => {}}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerMove}
        onPointerCancel={finishPointerMove}
        onWheel={handleWheel}
        onProjectionSizeChange={updateProjectionSize}
      >
        {project.partOrder.length > 0 && (
          <div
            className="design-context-ghost"
            data-testid="design-guided-context-overlay"
            aria-hidden="true"
          >
            <ThreePuppetPreview
              project={project}
              animatedParts={designContextAnimatedParts}
              skeleton={project.skeleton}
              mechanisms={[]}
              paths={designContextPaths}
              selectedPathId={designContextPathId}
              angle={angle}
              inputMode="none"
              testId="design-context-puppet"
              cameraPresets={["iso"]}
              showToolbar={false}
              initialLayers={{
                grid: false,
                character: true,
                skeleton: true,
                mechanisms: false,
              }}
            />
          </div>
        )}
        <svg
          data-testid="design-foundry-preview-overlay"
          viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
          className="foundry-preview-overlay"
          aria-hidden="true"
          data-renderer-source="ThreeFoundryPreview"
        />
      </ThreeFoundryPreview>
    </section>
  );
};

const MechanismDesign = ({
  project,
  selectedMechanism,
  updateMechanism,
  dispatch,
  showTrace,
  setShowTrace,
  angle,
  onOptimize,
  onRecommendations,
  optimizerBusy,
  exportSvg,
  exportDxf,
  onBlueprint,
  goStage,
}: {
  project: ProjectState;
  selectedMechanism?: MechanismConfig;
  updateMechanism: (id: string, updates: Partial<MechanismConfig>) => void;
  dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
  showTrace: boolean;
  setShowTrace: (v: boolean) => void;
  angle: number;
  onOptimize: () => void;
  onRecommendations: () => void;
  optimizerBusy: boolean;
  exportSvg: () => void;
  exportDxf: () => void;
  onBlueprint: () => void;
  goStage: (stage: AppStage) => void;
}) => {
  const selectedLibrary = selectedMechanism
    ? MECHANISM_LIBRARY[selectedMechanism.type]
    : undefined;
  const selectedRange = selectedMechanism
    ? sampleFeasibleRange(selectedMechanism)
    : undefined;
  const bindingWarnings = mechanismBindingWarnings(project);
  const selectedBindingWarnings = selectedMechanism
    ? (bindingWarnings[selectedMechanism.id] ?? [])
    : [];
  const targetAnchorOptions = selectedMechanism?.targetPartId
    ? motionAnchorJointIds(project, selectedMechanism.targetPartId)
    : [];
  const selectedTargetAnchor = selectedMechanism?.targetPartId
    ? preferredMotionJointId(
        project,
        selectedMechanism.targetPartId,
        selectedMechanism.targetAnchorJointId,
      )
    : undefined;
  const selectedTargetPath = selectedMechanism?.targetPathId
    ? project.paths[selectedMechanism.targetPathId]
    : undefined;
  const selectedTargetChain = selectedMechanism?.targetPartId
    ? describeMotionChain(
        project,
        selectedMechanism.targetPartId,
        selectedTargetAnchor,
        { rootJointId: selectedTargetPath?.chainRootJointId },
      )
    : undefined;
  const updateTargetPart = (partId: string) => {
    if (!selectedMechanism) return;
    const targetPartId = partId || undefined;
    const targetPath = targetPartId
      ? Object.values(project.paths).find(
          (path) => path.partId === targetPartId,
        )
      : undefined;
    updateMechanism(selectedMechanism.id, {
      targetPartId,
      targetPathId: targetPath?.id,
      targetAnchorJointId:
        targetPath?.targetAnchorJointId ??
        (targetPartId
          ? preferredMotionJointId(
              project,
              targetPartId,
              selectedMechanism.targetAnchorJointId,
              { preferDistalWhenRoot: true },
            )
          : undefined),
    });
  };
  const addLibraryMechanism = (type: MechanismType) => {
    const base = createDefaultMechanism(type, uid("mech"));
    const path = project.selectedPathId
      ? project.paths[project.selectedPathId]
      : undefined;
    const mechanism =
      path && path.points.length >= 3
        ? fitMechanismToTargetPath(
            project,
            { ...base, targetPathId: path.id, targetPartId: path.partId },
            path.id,
          )
        : mechanismWithGeneratedPath(base);
    dispatch({ type: "upsert_mechanism", mechanism });
  };
  return (
    <EditorStageFrame
      stage="design"
      className="design-stage-frame"
      layout={{
        workflow: workflowPane(
          <div className="stage-pane-stack">
            <StageLeftSummary
              project={project}
              title="Design"
              stage="design"
              goStage={goStage}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  className={`btn-secondary ${showTrace ? "active" : ""}`}
                  onClick={() => setShowTrace(!showTrace)}
                >
                  Trace
                </button>
                <button className="btn-primary" onClick={onRecommendations}>
                  <Sparkles size={16} /> Recommend
                </button>
              </div>
              <h4 className="section-title mt-4">Mechanisms</h4>
              <select
                aria-label="Mechanism instance"
                className="field"
                value={selectedMechanism?.id ?? ""}
                onChange={(e) =>
                  dispatch({
                    type: "set_mechanisms",
                    mechanisms: project.mechanisms,
                    selectedMechanismId: e.target.value,
                  })
                }
              >
                {project.mechanisms.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.type}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap gap-2">
                {AUTHORABLE_MECHANISM_TYPES.map((type) => (
                  <button
                    key={type}
                    className="chip"
                    title={mechanismTemplateLabel(type)}
                    onClick={() => addLibraryMechanism(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {selectedLibrary && (
                <div
                  className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600"
                  data-testid="design-mechanism-library"
                >
                  <div className="font-bold text-slate-800">Template</div>
                  <div>{selectedLibrary.label}</div>
                  <div data-testid="design-feasibility">
                    {selectedRange?.warning ?? "360°"}
                  </div>
                </div>
              )}
              {selectedLibrary && (
                <div
                  className="sensemaking-cue"
                  data-testid="design-visible-sensemaking"
                  data-sensemaking-check={selectedLibrary.classroomSensemaking.studentCheck}
                  data-sensemaking-answer={selectedLibrary.classroomSensemaking.expectedAnswer}
                  data-sensemaking-evidence={selectedLibrary.classroomSensemaking.evidenceCue}
                  data-sensemaking-clip={selectedLibrary.classroomSensemaking.clipSlot}
                >
                  <span className="cue-title">Why it moves</span>
                  <strong>
                    {selectedLibrary.classroomSensemaking.directTranslation}
                  </strong>
                  <small>{selectedLibrary.classroomSensemaking.tryThis}</small>
                </div>
              )}
              {Object.entries(bindingWarnings).map(([id, warnings]) =>
                warnings.length ? (
                  <div className="warning" key={id}>
                    {id}: {warnings.join("; ")}
                  </div>
                ) : null,
              )}
              <button className="btn-primary w-full" onClick={onBlueprint}>
                Blueprint
              </button>
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <DesignFoundryPreview
            project={project}
            mechanism={selectedMechanism}
            angle={angle}
            showTrace={showTrace}
          />,
        ),
        inspector: inspectorPane(
          <div className="stage-pane-stack">
            <div>
              <div className="section-title">Mechanism</div>
              <h3>
                {selectedMechanism
                  ? `${selectedMechanism.id} · ${mechanismTemplateLabel(selectedMechanism.type)}`
                  : "No mechanism"}
              </h3>
            </div>
            {selectedMechanism && (
              <>
                <Toggle
                  label="Visible"
                  checked={selectedMechanism.visible}
                  onChange={(visible) =>
                    updateMechanism(selectedMechanism.id, { visible })
                  }
                />
                <Toggle
                  label="Enabled"
                  checked={selectedMechanism.enabled !== false}
                  onChange={(enabled) =>
                    updateMechanism(selectedMechanism.id, { enabled })
                  }
                />
                <div className="section-title">Target</div>
                <select
                  aria-label="Mechanism target part"
                  className="field"
                  value={selectedMechanism.targetPartId ?? ""}
                  onChange={(e) => updateTargetPart(e.target.value)}
                >
                  <option value="">No target</option>
                  {project.partOrder.map((id) => (
                    <option key={id} value={id}>
                      {project.parts[id].name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Mechanism target path"
                  className="field"
                  value={selectedMechanism.targetPathId ?? ""}
                  onChange={(e) =>
                    updateMechanism(selectedMechanism.id, {
                      targetPathId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">No path</option>
                  {Object.values(project.paths)
                    .filter(
                      (p) =>
                        !selectedMechanism.targetPartId ||
                        p.partId === selectedMechanism.targetPartId,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} · {p.points.length} pts
                      </option>
                    ))}
                </select>
                {selectedMechanism.targetPartId && project.skeleton && (
                  <select
                    aria-label="Mechanism target anchor"
                    className="field"
                    value={selectedTargetAnchor ?? ""}
                    onChange={(e) =>
                      updateMechanism(selectedMechanism.id, {
                        targetAnchorJointId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Default anchor</option>
                    {targetAnchorOptions.map((id) => (
                      <option key={id} value={id}>
                        {motionChainOptionLabel(
                          project,
                          selectedMechanism.targetPartId,
                          id,
                        )}
                      </option>
                    ))}
                  </select>
                )}
                {selectedTargetChain && (
                  <div
                    className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-slate-600"
                    data-testid="mechanism-ik-chain-summary"
                    title={selectedTargetChain.helper}
                  >
                    <div className="font-bold text-slate-800">
                      {selectedTargetChain.label}
                    </div>
                  </div>
                )}
                <MechanismParametricEditor
                  mechanism={selectedMechanism}
                  onChange={(updates) =>
                    updateMechanism(selectedMechanism.id, updates)
                  }
                  testId="design-parametric-editor"
                />
                <div className="section-title">Parameters</div>
                {PARAMS.filter((p) =>
                  showParam(selectedMechanism.type, p.key),
                ).map((p) => (
                  <React.Fragment key={String(p.key)}>
                    <MiniNumber
                      label={p.label}
                      value={Number(selectedMechanism[p.key] ?? 0)}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(value) =>
                        updateMechanism(selectedMechanism.id, {
                          [p.key]: value,
                        } as Partial<MechanismConfig>)
                      }
                    />
                  </React.Fragment>
                ))}
                {selectedBindingWarnings.map((w, i) => (
                  <div className="warning" key={`binding-${w}-${i}`}>
                    {w}
                  </div>
                ))}
                {selectedRange?.warning && (
                  <div className="warning">{selectedRange.warning}</div>
                )}
                {selectedMechanism.warnings?.map((w, i) => (
                  <div className="warning" key={`${w}-${i}`}>
                    {w}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-primary"
                    disabled={optimizerBusy}
                    onClick={onOptimize}
                  >
                    {optimizerBusy ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}{" "}
                    Fit
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      dispatch({
                        type: "delete_mechanism",
                        mechanismId: selectedMechanism.id,
                      })
                    }
                  >
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={exportSvg}>
                    SVG
                  </button>
                  <button className="btn-secondary" onClick={exportDxf}>
                    DXF
                  </button>
                  <button
                    className="btn-primary"
                    aria-label="Export Blueprint"
                    onClick={onBlueprint}
                  >
                    Blueprint
                  </button>
                </div>
              </>
            )}
          </div>,
        ),
      }}
    />
  );
};

const AssemblyGuide = ({
  project,
  dispatch,
  goStage,
  stepIndex,
  setStepIndex,
  stepProgress,
  setStepProgress,
  playing,
  setPlaying,
  setStepCount,
}: {
  project: ProjectState;
  dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
  goStage: (stage: AppStage) => void;
  stepIndex: number;
  setStepIndex: React.Dispatch<React.SetStateAction<number>>;
  stepProgress: number;
  setStepProgress: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setStepCount: React.Dispatch<React.SetStateAction<number>>;
}) => {
  const validation = validateForFabrication(project);
  const create = () =>
    dispatch({
      type: "set_export",
      fabricationPackage: createFabricationPackage(project),
    });
  const pkg = project.lastExport;
  const activeMechanisms = project.mechanisms.filter(
    (m) => m.visible && m.enabled !== false,
  );
  const liveRecipes = activeMechanisms.map((mechanism) =>
    pendingRecipeForMechanism(project, mechanism),
  );
  const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? []);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const selectedRecipe =
    recipes.find((recipe) => recipe.mechanismId === selectedRecipeId) ??
    recipes[0];
  const characterAssemblyPlan = useMemo(
    () => buildCharacterAssemblyPlan(project),
    [project],
  );
  const hasCharacterAssembly =
    characterAssemblyPlan.parts.length > 0 &&
    characterAssemblyPlan.steps.length > 0;
  const [assemblyMode, setAssemblyMode] = useState<"mechanism" | "character">(
    "mechanism",
  );
  const activeAssemblyMode: "mechanism" | "character" =
    assemblyMode === "character" && hasCharacterAssembly
      ? "character"
      : selectedRecipe
        ? "mechanism"
        : hasCharacterAssembly
          ? "character"
          : "mechanism";
  const [lane, setLane] = useState<AssemblyLane>(() =>
    assemblyLaneForExportMode(project.settings.physicalKit.exportMode),
  );
  const stepProgressRef = useRef(0);
  const playbackSteps = selectedRecipe
    ? buildAssemblyPlaybackSteps(selectedRecipe, lane)
    : [];
  const characterPlaybackSteps = characterAssemblyPlan.steps;
  const activePlaybackSteps =
    activeAssemblyMode === "character" ? characterPlaybackSteps : playbackSteps;
  const activeStepCount = activePlaybackSteps.length;
  const selectedSensemaking = activeAssemblyMode === "mechanism" && selectedRecipe
    ? MECHANISM_LIBRARY[selectedRecipe.type].classroomSensemaking
    : undefined;
  const currentStep =
    playbackSteps[Math.min(stepIndex, Math.max(0, playbackSteps.length - 1))];
  const currentCharacterStep =
    characterPlaybackSteps[
      Math.min(stepIndex, Math.max(0, characterPlaybackSteps.length - 1))
    ];
  const activeDisplayStep =
    activeAssemblyMode === "character" ? currentCharacterStep : currentStep;
  useEffect(() => {
    setStepCount(activeStepCount);
  }, [activeStepCount, setStepCount]);
  const goAssemblyStep = (next: number | ((index: number) => number)) => {
    stepProgressRef.current = 0;
    setStepProgress(0);
    setStepIndex((index) => {
      const nextIndex = typeof next === "function" ? next(index) : next;
      return Math.max(0, Math.min(Math.max(0, activeStepCount - 1), nextIndex));
    });
  };
  useEffect(() => {
    stepProgressRef.current = 0;
    setStepIndex(0);
    setStepProgress(0);
    setPlaying(false);
  }, [activeAssemblyMode, selectedRecipe?.mechanismId, lane, setPlaying, setStepIndex, setStepProgress]);
  useEffect(() => {
    if (!playing || activeStepCount < 2) return;
    let frame = 0;
    let last = performance.now();
    const stepMs = 1400;
    const tick = (time: number) => {
      const delta = Math.min(120, time - last);
      last = time;
      const next = stepProgressRef.current + delta / stepMs;
      if (next >= 1) {
        stepProgressRef.current = 0;
        setStepProgress(0);
        setStepIndex((index) =>
          index >= activeStepCount - 1 ? 0 : index + 1,
        );
      } else {
        stepProgressRef.current = next;
        setStepProgress(next);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, activeStepCount, setStepIndex, setStepProgress]);
  const downloadAssemblyPdf = () =>
    pkg &&
    downloadText(
      `${pkg.id}-assembly.pdf`,
      pkg.assemblyGuidePdf,
      "application/pdf",
    );
  const printGuide = () => {
    if (!pkg) return;
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.write(pkg.assemblyGuideHtml);
      popup.document.close();
      popup.focus();
      popup.print();
      return;
    }
    downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, "text/html");
  };
  return (
    <EditorStageFrame
      stage="assembly"
      className="assembly-stage-frame"
      layout={{
        workflow: workflowPane(
          <div
            className="stage-pane-stack"
            data-testid="assembly-control-panel"
          >
            <StageLeftSummary
              project={project}
              title="Assembly"
              stage="assembly"
              goStage={goStage}
            >
              <h3>Build</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => goStage("blueprint")}
                >
                  Blueprint
                </button>
                <button
                  className="btn-primary"
                  aria-label={pkg ? "Print" : "Generate package"}
                  disabled={!!validation.errors.length}
                  onClick={pkg ? printGuide : create}
                >
                  {pkg ? "Print" : "Generate"}
                </button>
                {pkg && (
                  <button
                    className="btn-secondary"
                    onClick={downloadAssemblyPdf}
                  >
                    PDF
                  </button>
                )}
              </div>
              {activeAssemblyMode === "mechanism" && (
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  data-testid="assembly-lane-switch"
                >
                  <button
                    className={lane === "kit" ? "chip active" : "chip"}
                    disabled={
                      project.settings.physicalKit.exportMode === "custom-parts"
                    }
                    onClick={() => setLane("kit")}
                  >
                    Kit
                  </button>
                  <button
                    className={lane === "custom" ? "chip active" : "chip"}
                    disabled={
                      project.settings.physicalKit.exportMode === "prefab-board"
                    }
                    onClick={() => setLane("custom")}
                  >
                    Custom
                  </button>
                </div>
              )}
              <div
                className="mt-4 flex flex-wrap gap-2"
                data-testid="assembly-mode-switch"
              >
                <button
                  className={
                    activeAssemblyMode === "mechanism" ? "chip active" : "chip"
                  }
                  disabled={!recipes.length}
                  onClick={() => setAssemblyMode("mechanism")}
                >
                  Mechanism
                </button>
                <button
                  className={
                    activeAssemblyMode === "character" ? "chip active" : "chip"
                  }
                  disabled={!hasCharacterAssembly}
                  onClick={() => setAssemblyMode("character")}
                >
                  Character
                </button>
              </div>
              {activeAssemblyMode === "mechanism" && (
                <div className="mt-5 grid gap-2">
                  {recipes.map((recipe) => (
                    <button
                      key={recipe.mechanismId}
                      type="button"
                      className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? "ring-2 ring-inset" : ""}`}
                      onClick={() => setSelectedRecipeId(recipe.mechanismId)}
                    >
                      <div className="font-bold text-slate-800">
                        {recipe.mechanismId} ·{" "}
                        {referenceRecipeForType(recipe.type).title}
                      </div>
                      <div className="text-sm text-slate-600">
                        Board{" "}
                        {fabricationBoardCoordinateCallout(
                          recipe.boardCoordinate,
                          recipe.board,
                        )}
                      </div>
                      <div className="mt-2">
                        <span className="blueprint-pill">
                          {
                            MECHANISM_LIBRARY[recipe.type].classroomSensemaking
                              .directTranslation
                          }
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {activePlaybackSteps.length > 0 && (
                <div
                  className="mt-4 rounded-2xl bg-white p-3 shadow-sm"
                  data-testid="assembly-step-list"
                >
                  <div className="section-title">Steps</div>
                  <div className="mt-2 grid gap-1">
                    {activePlaybackSteps.map((step, index) => (
                      <button
                        key={`${step.phase}-${step.index}`}
                        className={`assembly-step-button ${index === stepIndex ? "active" : ""}`}
                        onClick={() => goAssemblyStep(index)}
                      >
                        <span>{step.index}</span>
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <div
            className="assembly-canvas-document canvas-workspace"
            data-testid="assembly-canvas-preview"
          >
            {activeAssemblyMode === "character" && currentCharacterStep ? (
              <CharacterAssemblyWorkbench
                plan={characterAssemblyPlan}
                step={currentCharacterStep}
                kit={project.settings.physicalKit}
                progress={stepProgress}
              />
            ) : selectedRecipe && currentStep ? (
              <AssemblyWorkbench
                recipe={selectedRecipe}
                lane={lane}
                step={currentStep}
                kit={project.settings.physicalKit}
                progress={stepProgress}
              />
            ) : (
              <div className="blueprint-empty-state">
                {hasCharacterAssembly ? "Choose Character." : "Add a character first."}
              </div>
            )}
          </div>,
        ),
        inspector: inspectorPane(
          <section
            className="stage-pane-stack"
            data-testid="assembly-guide-preview"
          >
            <div>
              <div className="section-title">Assembly step</div>
              <h3>{activeDisplayStep?.label ?? "Assembly"}</h3>
            </div>
            {activeAssemblyMode === "character" ? (
              <article
                className="assembly-recipe-card"
                data-testid="character-assembly-inspector"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      Character pins
                    </div>
                    <div className="text-sm text-slate-600">
                      {characterAssemblyPlan.fixedPins.length} fixed ·{" "}
                      {characterAssemblyPlan.freePivots.length} free
                    </div>
                  </div>
                  <button className="chip" onClick={() => goStage("character")}>
                    Edit
                  </button>
                </div>
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  data-testid="character-fixed-pin-callouts"
                >
                  {characterAssemblyPlan.fixedPins.map((pin) => (
                    <span className="blueprint-pill" key={pin.id}>
                      {pin.label} ·{" "}
                      {pin.boardCoordinate
                        ? fabricationBoardCoordinateCallout(
                            pin.boardCoordinate,
                            pin.board,
                          )
                        : "board pin"}
                    </span>
                  ))}
                </div>
                {characterAssemblyPlan.fixedPins.some(
                  (pin) => !pin.boardCoordinate || pin.board?.valid === false,
                ) && (
                  <div className="warn mt-3" data-testid="character-pin-blocker">
                    Move fixed pins onto the board.
                  </div>
                )}
                <div
                  className="mt-3 flex flex-wrap gap-2"
                  data-testid="character-free-pivot-callouts"
                >
                  {characterAssemblyPlan.freePivots.slice(0, 8).map((pin) => (
                    <span className="blueprint-pill" key={pin.id}>
                      {pin.label} free
                    </span>
                  ))}
                </div>
                {currentCharacterStep && (
                  <div
                    className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
                    data-testid="prefab-assembly-steps"
                  >
                    <div className="section-title">Current step</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="blueprint-pill">
                        {currentCharacterStep.phase}
                      </span>
                      <span className="blueprint-pill">
                        {currentCharacterStep.action}
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-bold text-slate-700">
                      {currentCharacterStep.instruction}
                    </div>
                    {currentCharacterStep.check && (
                      <div className="ok mt-3">{currentCharacterStep.check}</div>
                    )}
                  </div>
                )}
              </article>
            ) : selectedRecipe ? (
              <article
                className="assembly-recipe-card"
                data-testid={`assembly-recipe-${selectedRecipe.mechanismId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-800">
                      {selectedRecipe.mechanismId} ·{" "}
                      {referenceRecipeForType(selectedRecipe.type).title}
                    </div>
                    <div className="text-sm text-slate-600">
                      Board{" "}
                      {fabricationBoardCoordinateCallout(
                        selectedRecipe.boardCoordinate,
                        selectedRecipe.board,
                      )}
                    </div>
                  </div>
                  <button className="chip" onClick={() => goStage("design")}>
                    Edit
                  </button>
                </div>
                {selectedSensemaking && (
                  <div
                    className="sensemaking-cue mt-3"
                    data-testid="assembly-sensemaking-label"
                    data-sensemaking-check={selectedSensemaking.studentCheck}
                    data-sensemaking-answer={selectedSensemaking.expectedAnswer}
                    data-sensemaking-evidence={selectedSensemaking.evidenceCue}
                    data-sensemaking-clip={selectedSensemaking.clipSlot}
                  >
                    <span className="cue-title">Motion</span>
                    <strong>{selectedSensemaking.directTranslation}</strong>
                    <small>{selectedSensemaking.studentCheck}</small>
                  </div>
                )}
                <details className="blueprint-more-exports mt-3">
                  <summary>Parts</summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedRecipe.requiredParts.map((part) => (
                      <span
                        className="blueprint-pill"
                        key={`${selectedRecipe.mechanismId}-${part.name}`}
                      >
                        {fabricationPartDisplayLabel(part.name)} ×{" "}
                        {part.quantity}
                      </span>
                    ))}
                  </div>
                  <div
                    className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700"
                    data-testid="assembly-stack-summary"
                  >
                    {readableFabricationStackSummary(selectedRecipe)}
                  </div>
                </details>
                {selectedRecipe.warnings.length ? (
                  <div className="warning mt-3">
                    Fix: {selectedRecipe.warnings.join("; ")}
                  </div>
                ) : (
                  <div className="ok mt-3">OK</div>
                )}
                {currentStep && (
                  <div
                    className="mt-3 rounded-2xl bg-white p-3 shadow-sm"
                    data-testid="prefab-assembly-steps"
                  >
                    <div className="section-title">Current step</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="blueprint-pill">
                        {currentStep.phase}
                      </span>
                      {currentStep.coords.map((coord, index) => (
                        <span
                          className="blueprint-pill"
                          key={`${coord}-${index}`}
                        >
                          {fabricationBoardCoordinateCallout(coord)} ·{" "}
                          {currentStep.coordRoles[index] ?? "ref"}
                        </span>
                      ))}
                      <span className="blueprint-pill">
                        Z {currentStep.zMm.toFixed(1)}mm
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-bold text-slate-700">
                      {currentStep.instruction}
                    </div>
                    {currentStep.check && (
                      <div className="ok mt-3">{currentStep.check}</div>
                    )}
                  </div>
                )}
              </article>
            ) : (
              <div className="warning">Add a mechanism first.</div>
            )}
          </section>,
        ),
      }}
    />
  );
};

const Options = ({
  project,
  dispatch,
  goStage,
}: {
  project: ProjectState;
  dispatch: (action: Parameters<typeof applyProjectAction>[1]) => void;
  goStage: (stage: AppStage) => void;
}) => {
  const kit = project.settings.physicalKit;
  const updateSettings = (settings: Partial<ProjectState["settings"]>) =>
    dispatch({ type: "update_settings", settings });
  const updateKit = (
    physicalKit: Partial<ProjectState["settings"]["physicalKit"]>,
  ) => updateSettings({ physicalKit: { ...kit, ...physicalKit } });
  const durationSeconds = Number(
    (project.settings.animationDurationMs / 1000).toFixed(1),
  );
  const unitSummary = formatGridReadout(kit, project.settings.gridUnit);
  return (
    <EditorStageFrame
      stage="options"
      className="options-stage-frame"
      layout={{
        workflow: workflowPane(
          <div className="stage-pane-stack">
            <StageLeftSummary
              project={project}
              title="Options"
              stage="options"
              goStage={goStage}
            >
              <h3>Settings</h3>
              <div className="stage-option-list">
                {OPTIONS_SECTION_MANIFEST.map((section) => (
                  <a
                    key={section.id}
                    className="workspace-side-link"
                    href={`#${section.id}`}
                  >
                    {section.label}
                  </a>
                ))}
              </div>
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <div className="path-canvas-shell options-preview-shell workspace overflow-hidden p-6">
            <svg
              viewBox="0 0 640 420"
              className="options-preview-canvas w-full h-full"
              role="img"
              aria-label="Options preview canvas"
            >
              <defs>
                <pattern
                  id="options-grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M40 0H0V40"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect
                x="34"
                y="24"
                width="572"
                height="372"
                rx="24"
                fill="white"
                stroke="#d6dbe8"
              />
              <rect
                x="34"
                y="24"
                width="572"
                height="372"
                rx="24"
                fill="url(#options-grid)"
                opacity=".9"
              />
              <text x="58" y="64" fill="#94a3b8" fontSize="18" fontWeight="800">
                {formatGridLabel(
                  project.settings.physicalKit,
                  project.settings.gridUnit,
                )}
              </text>
              <g transform="translate(300 210)">
                <rect
                  x="-70"
                  y="-90"
                  width="140"
                  height="180"
                  rx="32"
                  fill="#cbd5e1"
                  opacity=".55"
                />
                <circle cx="0" cy="-115" r="38" fill="#d8dee8" />
                <path
                  d="M 70 -52 C 142 -24 122 58 78 94"
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <path
                  d="M -70 -54 C -126 -18 -116 60 -68 94"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="6"
                  strokeLinecap="round"
                  opacity=".7"
                />
              </g>
              <text
                x="58"
                y="362"
                fill="#64748b"
                fontSize="14"
                fontWeight="800"
              >
                {project.settings.theme} theme ·{" "}
                {project.settings.animationSpeed.toFixed(1)}x speed ·{" "}
                {project.settings.physicalKit.defaultExportFormat} export
              </text>
            </svg>
          </div>,
        ),
        inspector: inspectorPane(
          <div className="options-workspace stage-pane-stack">
            <section className="workspace space-y-5 p-6">
              <div>
                <div className="section-title">Options</div>
                <h3>Settings</h3>
              </div>
              <SettingsSection section={optionSection("appearance")}>
                <SelectField
                  label="Theme"
                  value={project.settings.theme}
                  onChange={(theme) =>
                    updateSettings({
                      theme: theme as ProjectState["settings"]["theme"],
                    })
                  }
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="blueprint">Blueprint tint</option>
                </SelectField>
                <Toggle
                  label="Show toolbar"
                  checked={project.settings.toolbarVisible}
                  onChange={(toolbarVisible) =>
                    updateSettings({ toolbarVisible })
                  }
                />
                <Toggle
                  label="Part panel"
                  checked={project.settings.partPanelVisible}
                  onChange={(partPanelVisible) =>
                    updateSettings({ partPanelVisible })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("simulation")}>
                <MiniNumber
                  label="Animation speed"
                  value={project.settings.animationSpeed}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onChange={(animationSpeed) =>
                    updateSettings({ animationSpeed })
                  }
                />
                <MiniNumber
                  label="Duration"
                  value={durationSeconds}
                  min={0.1}
                  max={60}
                  step={0.1}
                  onChange={(seconds) =>
                    updateSettings({
                      animationDurationMs: Math.round(seconds * 1000),
                    })
                  }
                />
                <SelectField
                  label="Timing profile"
                  value={project.settings.timingProfile}
                  onChange={(timingProfile) =>
                    updateSettings({
                      timingProfile:
                        timingProfile as ProjectState["settings"]["timingProfile"],
                    })
                  }
                >
                  <option value="linear">Linear</option>
                  <option value="ease-in">Ease in</option>
                  <option value="ease-out">Ease out</option>
                  <option value="ease-in-out">Ease in/out</option>
                  <option value="realtime">Realtime</option>
                  <option value="slow">Slow</option>
                  <option value="presentation">Presentation</option>
                </SelectField>
                <MiniNumber
                  label="Friction μ"
                  value={project.settings.simulationFriction}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(simulationFriction) =>
                    updateSettings({ simulationFriction })
                  }
                />
                <MiniNumber
                  label="Mass kg"
                  value={project.settings.simulationMassKg}
                  min={0.05}
                  max={10}
                  step={0.05}
                  onChange={(simulationMassKg) =>
                    updateSettings({ simulationMassKg })
                  }
                />
              </SettingsSection>
            </section>
            <section className="space-y-5">
              <SettingsSection section={optionSection("performance")}>
                <SelectField
                  label="Performance preset"
                  value={project.settings.performancePreset}
                  onChange={(performancePreset) =>
                    updateSettings({
                      performancePreset:
                        performancePreset as ProjectState["settings"]["performancePreset"],
                    })
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High</option>
                </SelectField>
                <SelectField
                  label="Physics snap mode"
                  value={project.settings.physicsSnapMode}
                  onChange={(physicsSnapMode) =>
                    updateSettings({
                      physicsSnapMode:
                        physicsSnapMode as ProjectState["settings"]["physicsSnapMode"],
                    })
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">Strict</option>
                </SelectField>
              </SettingsSection>
              <SettingsSection section={optionSection("debugging")}>
                <Toggle
                  label="Dev mode"
                  checked={project.settings.debugVisuals}
                  onChange={(debugVisuals) => updateSettings({ debugVisuals })}
                />
                <Toggle
                  label="Import details"
                  checked={project.settings.detailedProcessingSteps}
                  onChange={(detailedProcessingSteps) =>
                    updateSettings({ detailedProcessingSteps })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("workflow")}>
                <Toggle
                  label="Enable autosave"
                  checked={project.settings.autosave}
                  onChange={(autosave) => updateSettings({ autosave })}
                />
                <MiniNumber
                  label="Autosave seconds"
                  value={project.settings.autosaveIntervalSeconds}
                  min={1}
                  max={600}
                  step={1}
                  disabled={!project.settings.autosave}
                  onChange={(autosaveIntervalSeconds) =>
                    updateSettings({ autosaveIntervalSeconds })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("fabrication")}>
                <SelectField
                  label="Export"
                  value={kit.exportMode}
                  onChange={(exportMode) =>
                    updateKit({
                      exportMode:
                        exportMode as ProjectState["settings"]["physicalKit"]["exportMode"],
                    })
                  }
                >
                  <option value="both">Both</option>
                  <option value="custom-parts">
                    Custom only · SVG/PDF/STL
                  </option>
                  <option value="prefab-board">Prefab</option>
                </SelectField>
                <SelectField
                  label="Format"
                  value={kit.defaultExportFormat}
                  onChange={(defaultExportFormat) =>
                    updateKit({
                      defaultExportFormat:
                        defaultExportFormat as ProjectState["settings"]["physicalKit"]["defaultExportFormat"],
                    })
                  }
                >
                  <option value="both">SVG + JSON</option>
                  <option value="svg">SVG</option>
                  <option value="json">JSON</option>
                </SelectField>
                <SelectField
                  label="Download file"
                  value={kit.cutSheetFileType}
                  onChange={(cutSheetFileType) =>
                    updateKit({
                      cutSheetFileType:
                        cutSheetFileType as ProjectState["settings"]["physicalKit"]["cutSheetFileType"],
                    })
                  }
                >
                  <option value="pdf">PDF default</option>
                  <option value="svg">SVG</option>
                </SelectField>
                <Toggle
                  label="Strict checks"
                  checked={project.settings.fabricationReadyMode}
                  onChange={(fabricationReadyMode) =>
                    updateSettings({ fabricationReadyMode })
                  }
                />
                <SelectField
                  label="Board"
                  value={kit.profileKey}
                  onChange={(profileKey) =>
                    updateSettings({
                      physicalKit: physicalKitPreset(profileKey, kit),
                    })
                  }
                >
                  <option value="letter-15x15-2cm">
                    Letter · 15×15 · 20mm
                  </option>
                  <option value="letter-12x12-2cm">
                    Letter · 12×12 · 20mm
                  </option>
                  <option value="custom">Custom profile</option>
                </SelectField>
                <MiniNumber
                  label="Grid pitch mm"
                  value={kit.gridPitchMm}
                  min={5}
                  max={50}
                  step={1}
                  onChange={(gridPitchMm) =>
                    updateKit({
                      gridPitchMm,
                      profileKey:
                        kit.profileKey === "custom" ? "custom" : kit.profileKey,
                    })
                  }
                />
                <div
                  className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600"
                  data-testid="grid-cell-readout"
                >
                  <div className="font-bold text-slate-800">Grid</div>
                  <div>{unitSummary}</div>
                  <div>
                    {kit.boardCells}×{kit.boardCells} board holes ·{" "}
                    {kit.sheetWidthMm.toFixed(1)}×{kit.sheetHeightMm.toFixed(1)}
                    mm sheet
                  </div>
                </div>
              </SettingsSection>
              <SettingsSection section={optionSection("units")}>
                <SelectField
                  label="Grid units"
                  value={project.settings.gridUnit}
                  onChange={(gridUnit) =>
                    updateSettings({
                      gridUnit:
                        gridUnit as ProjectState["settings"]["gridUnit"],
                    })
                  }
                >
                  <option value="cm">Centimeters</option>
                  <option value="inch">Inches</option>
                  <option value="px">Scene pixels</option>
                </SelectField>
              </SettingsSection>
            </section>
          </div>,
        ),
      }}
    />
  );
};

const SettingsSection = ({
  section,
  children,
}: {
  section: OptionsSectionMeta;
  children: React.ReactNode;
}) => (
  <section
    id={section.id}
    className="workspace settings-section space-y-3 p-5"
    data-testid={`options-${section.id}`}
    aria-label={section.label}
  >
    <div>
      <div className="section-title" title={section.description}>
        {section.label}
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const SelectField = ({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) => (
  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
    <span>{label}</span>
    <select
      aria-label={label}
      className="field mt-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  </label>
);

const gearSpecForSceneRadius = (radius: number) =>
  fabricationGearSpecForPitchRadius(Math.abs(radius) / SCENE_PX_PER_MM);
const gearSceneRadiusForKey = (key: string) =>
  (
    FABRICATION_GEAR_SPECS.find((spec) => spec.key === key) ??
    FABRICATION_GEAR_SPECS[1]
  ).pitchRadiusMm * SCENE_PX_PER_MM;
const linkageSceneLengthForCells = (cells: number) =>
  (
    FABRICATION_LINKAGE_SPECS.find((spec) => spec.cells === cells) ??
    FABRICATION_LINKAGE_SPECS[1]
  ).lengthMm * SCENE_PX_PER_MM;
const linkageCellsForSceneLength = (length: number) =>
  fabricationLinkageSpecForSceneLength(length).cells;
const gearOptionLabel = (teeth: number) => `${teeth} teeth`;

const MechanismParametricEditor = ({
  mechanism,
  onChange,
  testId,
}: {
  mechanism: MechanismConfig;
  onChange: (updates: Partial<MechanismConfig>) => void;
  testId?: string;
}) => {
  const radii =
    mechanism.type === "gear" || mechanism.type === "gear_linkage"
      ? gearTrainPitchRadii(mechanism)
      : [];
  const updateGearRadius = (index: number, key: string) => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next[index] = gearSceneRadiusForKey(key);
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const addIdlerGear = () => {
    const next =
      radii.length >= 2
        ? [...radii]
        : [mechanism.crankLength, mechanism.rockerLength];
    next.splice(Math.max(1, next.length - 1), 0, gearSceneRadiusForKey("g24"));
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const removeIdlerGear = () => {
    if (radii.length <= 2) return;
    const next = [...radii];
    next.splice(next.length - 2, 1);
    onChange({
      crankLength: next[0],
      rockerLength: next.at(-1) ?? next[0],
      gearTrainRadii: next,
    });
  };
  const renderGearControls =
    radii.length >= 2 &&
    (mechanism.type === "gear" || mechanism.type === "gear_linkage");
  const renderLinkageControls =
    mechanism.type === "4bar" || mechanism.type === "gear_linkage";
  const endpointGearOptions =
    mechanism.type === "gear_linkage"
      ? FABRICATION_GEAR_SPECS.filter(
          (spec) => spec.attachmentHoleCentersMm.length > 0,
        )
      : FABRICATION_GEAR_SPECS;
  if (!renderGearControls && !renderLinkageControls && mechanism.type !== "cam")
    return null;
  return (
    <div
      className="inspector-control-card compact-parametric-editor"
      data-testid={testId ?? "mechanism-parametric-editor"}
    >
      {renderGearControls && (
        <div className="space-y-2">
          <div className="section-title">Gear sizes</div>
          {radii.map((radius, index) => {
            const isOutput = index === radii.length - 1;
            const label =
              index === 0
                ? "Drive gear size"
                : isOutput
                  ? "Output gear size"
                  : `Idler gear ${index} size`;
            const options =
              mechanism.type === "gear_linkage" && (index === 0 || isOutput)
                ? endpointGearOptions
                : FABRICATION_GEAR_SPECS;
            const selected = gearSpecForSceneRadius(radius).key;
            return (
              <label
                key={`${label}-${index}`}
                className="block text-xs font-black uppercase tracking-wider text-slate-500"
              >
                <span>{label.replace(" size", "")}</span>
                <select
                  aria-label={label}
                  className="field mt-1"
                  value={
                    options.some((spec) => spec.key === selected)
                      ? selected
                      : options[0].key
                  }
                  onChange={(event) =>
                    updateGearRadius(index, event.target.value)
                  }
                >
                  {options.map((spec) => (
                    <option key={spec.key} value={spec.key}>
                      {gearOptionLabel(spec.teeth)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              aria-label="Add idler gear"
              onClick={addIdlerGear}
            >
              + idler
            </button>
            <button
              type="button"
              className="btn-secondary"
              aria-label="Remove idler gear"
              disabled={radii.length <= 2}
              onClick={removeIdlerGear}
            >
              − idler
            </button>
          </div>
        </div>
      )}
      {renderLinkageControls && (
        <div className="mt-3 space-y-2">
          <div className="section-title">Link sizes</div>
          {mechanism.type === "4bar" &&
            (
              [
                ["Input link length", "crankLength"],
                ["Coupler link length", "couplerLength"],
                ["Output link length", "rockerLength"],
              ] as const
            ).map(([label, key]) => (
              <label
                key={key}
                className="block text-xs font-black uppercase tracking-wider text-slate-500"
              >
                <span>{label.replace(" length", "")}</span>
                <select
                  aria-label={label}
                  className="field mt-1"
                  value={linkageCellsForSceneLength(
                    Number(mechanism[key] ?? 0),
                  )}
                  onChange={(event) =>
                    onChange({
                      [key]: linkageSceneLengthForCells(
                        Number(event.target.value),
                      ),
                    } as Partial<MechanismConfig>)
                  }
                >
                  {FABRICATION_LINKAGE_SPECS.map((spec) => (
                    <option key={spec.key} value={spec.cells}>
                      {spec.cells}-cell
                    </option>
                  ))}
                </select>
              </label>
            ))}
          {mechanism.type === "gear_linkage" && (
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
              <span>Paired links</span>
              <select
                aria-label="Paired link length"
                className="field mt-1"
                value={linkageCellsForSceneLength(mechanism.couplerLength)}
                onChange={(event) =>
                  onChange({
                    couplerLength: linkageSceneLengthForCells(
                      Number(event.target.value),
                    ),
                  })
                }
              >
                {FABRICATION_LINKAGE_SPECS.map((spec) => (
                  <option key={spec.key} value={spec.cells}>
                    {spec.cells}-cell
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {mechanism.type === "cam" && (
        <div className="mt-3">
          <CamProfileEditor
            samples={mechanism.camProfileSamples}
            onChange={(camProfileSamples) => onChange({ camProfileSamples })}
          />
        </div>
      )}
    </div>
  );
};

const CAM_PROFILE_MIN = 0.35;
const CAM_PROFILE_MAX = 1.65;
const clampCamProfileSample = (value: number) =>
  Math.max(CAM_PROFILE_MIN, Math.min(CAM_PROFILE_MAX, value));
const CamProfileEditor = ({
  samples,
  onChange,
}: {
  samples?: number[];
  onChange: (samples: number[]) => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const profile = useMemo(() => normalizeCamProfileSamples(samples), [samples]);
  const width = 240;
  const height = 88;
  const pad = 12;
  const sampleToY = (value: number) =>
    pad +
    (1 - (value - CAM_PROFILE_MIN) / (CAM_PROFILE_MAX - CAM_PROFILE_MIN)) *
      (height - pad * 2);
  const pointX = (index: number) =>
    pad + (index / Math.max(1, profile.length - 1)) * (width - pad * 2);
  const eventIndex = (event: React.PointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return activeIndexRef.current ?? 0;
    const t = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
    );
    return Math.max(
      0,
      Math.min(profile.length - 1, Math.round(t * (profile.length - 1))),
    );
  };
  const eventValue = (event: React.PointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return profile[activeIndexRef.current ?? 0] ?? 1;
    const t = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)),
    );
    return clampCamProfileSample(
      CAM_PROFILE_MAX - t * (CAM_PROFILE_MAX - CAM_PROFILE_MIN),
    );
  };
  const updatePoint = (index: number, value: number) =>
    onChange(
      profile.map((sample, sampleIndex) =>
        sampleIndex === index ? clampCamProfileSample(value) : sample,
      ),
    );
  const profilePath = profile
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"} ${pointX(index).toFixed(1)} ${sampleToY(value).toFixed(1)}`,
    )
    .join(" ");
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white/80 p-3"
      data-testid="cam-profile-editor"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="section-title">Cam profile</div>
        <button
          type="button"
          className="btn-secondary compact"
          data-testid="cam-profile-reset"
          onClick={() => onChange(defaultCamProfileSamples(profile.length))}
        >
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        data-testid="cam-profile-canvas"
        className="w-full touch-none rounded-xl bg-slate-50"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Editable cam lift profile"
        onPointerDown={(event) => {
          event.preventDefault();
          const index = eventIndex(event);
          activeIndexRef.current = index;
          event.currentTarget.setPointerCapture(event.pointerId);
          updatePoint(index, eventValue(event));
        }}
        onPointerMove={(event) => {
          const index = activeIndexRef.current;
          if (index === null) return;
          event.preventDefault();
          updatePoint(index, eventValue(event));
        }}
        onPointerUp={() => {
          activeIndexRef.current = null;
        }}
        onPointerLeave={() => {
          activeIndexRef.current = null;
        }}
      >
        <path
          d={`M ${pad} ${height - pad} H ${width - pad}`}
          stroke="#cbd5e1"
          strokeWidth="2"
        />
        <path
          d={profilePath}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {profile.map((value, index) => (
          <circle
            key={index}
            data-testid={`cam-profile-point-${index}`}
            cx={pointX(index)}
            cy={sampleToY(value)}
            r={5}
            fill="#ffffff"
            stroke="#4f46e5"
            strokeWidth="2"
            onPointerDown={(event) => {
              event.preventDefault();
              activeIndexRef.current = index;
              event.currentTarget.setPointerCapture(event.pointerId);
              updatePoint(index, eventValue(event));
            }}
          />
        ))}
      </svg>
    </div>
  );
};

const showParam = (type: MechanismType, key: keyof MechanismConfig) => {
  const compactParametricKeys: Partial<
    Record<MechanismType, Array<keyof MechanismConfig>>
  > = {
    "4bar": ["crankLength", "couplerLength", "rockerLength"],
    gear: [
      "crankLength",
      "rockerLength",
      "gearRatio",
      "gearTrainRadii",
      "groundLength",
      "couplerPointDist",
      "couplerPointAngle",
      "speed2",
    ],
    gear_linkage: [
      "crankLength",
      "rockerLength",
      "couplerLength",
      "gearRatio",
      "gearTrainRadii",
      "groundLength",
      "couplerPointDist",
      "couplerPointAngle",
      "speed2",
    ],
  };
  if (compactParametricKeys[type]?.includes(key)) return false;
  if (key === "speed2") return type === "5bar";
  if (key === "phase")
    return ["5bar", "gear", "gear_linkage", "planetary_gear"].includes(type);
  if (key === "gearRatio") return false;
  if (key === "rodLength") return ["5bar", "6bar", "piston"].includes(type);
  if (key === "groundLength")
    return ![
      "cam",
      "yoke",
      "rack-pinion",
      "gear",
      "gear_linkage",
      "planetary_gear",
    ].includes(type);
  if (key === "couplerLength")
    return !["cam", "gear", "planetary_gear", "yoke", "rack-pinion"].includes(
      type,
    );
  return true;
};

type ThreeFoundryPreviewProps = {
  mechanism: MechanismConfig;
  simulation: ReturnType<typeof fitMechanismSimulation>;
  kit: PhysicalKitSettings;
  camera: FoundryCamera;
  rigOpacity: number;
  color: string;
  pathPoints: Point[];
  pathTraces: Array<{
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
  }>;
  showGrid: boolean;
  showPathPreview: boolean;
  showTrail: boolean;
  showForces: boolean;
  showVelocity: boolean;
  explode: number;
  physicsRule: string;
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionCoefficient: number;
  frictionMagnitude: number;
  constraintError: number;
  cameraLabel: string;
  isPickingAnchor: boolean;
  isOrbiting: boolean;
  isZooming: boolean;
  isPanning: boolean;
  onAnchorPick: (point: Point) => void;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onProjectionSizeChange: (size: FoundryOverlaySize) => void;
  children: React.ReactNode;
};

const foundryRenderedInventory = (type: MechanismType) => {
  const fallback = {
    "4bar": {
      parts: 5,
      holes: 15,
      slots: 0,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    piston: {
      parts: 6,
      holes: 15,
      slots: 1,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    yoke: {
      parts: 7,
      holes: 15,
      slots: 2,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    "quick-return": {
      parts: 6,
      holes: 15,
      slots: 1,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    "5bar": {
      parts: 7,
      holes: 25,
      slots: 0,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    "6bar": {
      parts: 7,
      holes: 25,
      slots: 0,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    cam: {
      parts: 8,
      holes: 16,
      slots: 1,
      gears: 0,
      racks: 0,
      cams: 1,
      followers: 1,
      endStops: 0,
    },
    "rack-pinion": {
      parts: 10,
      holes: 20,
      slots: 1,
      gears: 1,
      racks: 1,
      cams: 0,
      followers: 0,
      endStops: 2,
    },
    gear: {
      parts: 8,
      holes: 29,
      slots: 0,
      gears: 2,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    gear_linkage: {
      parts: 9,
      holes: 31,
      slots: 0,
      gears: 2,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    planetary_gear: {
      parts: 7,
      holes: 18,
      slots: 0,
      gears: 3,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
    crank: {
      parts: 5,
      holes: 15,
      slots: 0,
      gears: 0,
      racks: 0,
      cams: 0,
      followers: 0,
      endStops: 0,
    },
  }[type];
  const referenceHoleCount = referenceRequiredPartsHoleCount(
    mechanismRequiredParts({ type }),
  );
  return referenceHoleCount
    ? { ...fallback, holes: referenceHoleCount }
    : fallback;
};

const foundryAssemblyPinPoints = (
  type: MechanismType,
  state: ReturnType<typeof calculateLinkage>,
): Point[] => {
  const compact = (points: Array<Point | undefined>) =>
    points.filter(Boolean) as Point[];
  if (type === "4bar") return compact([state.p1, state.j1, state.j2, state.p2]);
  if (type === "5bar" || type === "6bar")
    return compact([state.p1, state.j1, state.j2, state.aux, state.p2]);
  if (type === "cam") return compact([state.p1, state.j2]);
  if (
    type === "piston" ||
    type === "rack-pinion" ||
    type === "yoke" ||
    type === "quick-return"
  )
    return compact([state.p1, state.j1, state.j2]);
  if (type === "planetary_gear") return compact([state.p1, state.p2]);
  return compact([
    state.p1,
    state.p2,
    state.j1,
    state.j2,
    state.aux,
    state.effector,
  ]);
};

const foundryAssemblyPinContract = (type: MechanismType) => {
  if (type === "4bar") return "reference-A-B-C-D-only";
  if (type === "5bar" || type === "6bar") return "reference-ground-chain-only";
  if (type === "cam") return "cam-axle-and-follower-center-only";
  if (
    type === "piston" ||
    type === "rack-pinion" ||
    type === "yoke" ||
    type === "quick-return"
  )
    return "guided-output-only";
  if (type === "gear") return "fixed-gear-axles-only";
  if (type === "gear_linkage") return "fixed-gear-axles-plus-two-crank-links";
  if (type === "planetary_gear") return "sun-and-carrier-planet-axles";
  return "template-specific-output";
};

const fittedGearTrainCenters = (
  radii: number[],
  start: Point,
  end: Point,
): Point[] => {
  if (!radii.length) return [];
  if (radii.length === 1) return [start];
  const totalPitchDistance = radii
    .slice(1)
    .reduce((sum, radius, index) => sum + radii[index] + radius, 0);
  if (!Number.isFinite(totalPitchDistance) || totalPitchDistance <= 0)
    return radii.map(() => start);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let distance = 0;
  return radii.map((radius, index) => {
    if (index > 0) distance += radii[index - 1] + radius;
    const t = distance / totalPitchDistance;
    return { x: start.x + dx * t, y: start.y + dy * t };
  });
};

type FoundryPinStackPoint = {
  id: string;
  point: Point;
  movingLayerIndexes: number[];
  spacerLayerIndexes: number[];
};

type FoundryPinStack = FoundryPinStackPoint & {
  bottomZ: number;
  topZ: number;
  centerZ: number;
  lengthZ: number;
};

const isMovingRenderKind = (renderKind: string) =>
  !["clip", "spacer", "base"].includes(renderKind);

const foundryPinStackPoints = (
  type: MechanismType,
  points: Point[],
  movingLayerIndexes: number[],
  spacerLayerIndexes: number[],
): FoundryPinStackPoint[] => {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const cleanIndexes = movingLayerIndexes.filter((index) =>
    Number.isFinite(index),
  );
  const cleanSpacerIndexes = spacerLayerIndexes.filter((index) =>
    Number.isFinite(index),
  );
  const spacerIndexesFrom = (start: number, count = 1) =>
    Array.from(
      { length: count },
      (_, offset) =>
        cleanSpacerIndexes[
          Math.max(0, Math.min(cleanSpacerIndexes.length - 1, start + offset))
        ],
    ).filter((item): item is number => typeof item === "number");
  const spacerIndexesForPin = (pinMovingLayerIndexes: number[]) => {
    const between = cleanSpacerIndexes.filter(
      (spacerIndex) =>
        pinMovingLayerIndexes.some((index) => index < spacerIndex) &&
        pinMovingLayerIndexes.some((index) => index > spacerIndex),
    );
    if (between.length) return [...new Set(between)];
    if (pinMovingLayerIndexes.length !== 1) return [];
    const movingIndex = pinMovingLayerIndexes[0];
    const before = [...cleanSpacerIndexes]
      .reverse()
      .find((spacerIndex) => spacerIndex < movingIndex);
    const after = cleanSpacerIndexes.find(
      (spacerIndex) => spacerIndex > movingIndex,
    );
    const nearest =
      movingIndex === cleanIndexes[0]
        ? [after]
        : movingIndex === cleanIndexes.at(-1)
          ? [before]
          : [before, after];
    return [
      ...new Set(
        nearest.filter((item): item is number => typeof item === "number"),
      ),
    ];
  };
  if (!points.length || !cleanIndexes.length)
    return points.map((point, index) => ({
      id: ids[index] ?? `P${index + 1}`,
      point,
      movingLayerIndexes: [],
      spacerLayerIndexes: [],
    }));

  if (type === "gear") {
    return points.map((point, index) => {
      const pinMovingLayerIndexes = [
        cleanIndexes[Math.min(index, cleanIndexes.length - 1)],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: pinMovingLayerIndexes,
        spacerLayerIndexes: spacerIndexesFrom(index),
      };
    });
  }

  if (type === "gear_linkage") {
    const gearCount = Math.max(
      2,
      Math.min(points.length, cleanIndexes.length - 3),
    );
    const gearIndexes = cleanIndexes.slice(0, gearCount);
    const linkageIndexes = cleanIndexes.slice(gearCount);
    const pinId = (index: number) => {
      if (index < gearCount) {
        if (index === 0) return "A";
        if (index === gearCount - 1) return "D";
        return `I${index}`;
      }
      if (index === gearCount) return "B";
      if (index === gearCount + 1) return "C";
      return "R";
    };
    return points.map((point, index) => {
      if (index < gearCount) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [gearIndexes[index]].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(index),
        };
      }
      if (index === gearCount) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [gearIndexes[0], linkageIndexes[0]].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(Math.max(0, gearCount - 1)),
        };
      }
      if (index === gearCount + 1) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [
            gearIndexes.at(-1),
            linkageIndexes[1] ?? linkageIndexes[0],
          ].filter((item): item is number => typeof item === "number"),
          spacerLayerIndexes: spacerIndexesFrom(Math.max(0, gearCount - 1), 2),
        };
      }
      const moving = [
        linkageIndexes[0],
        linkageIndexes[1],
        linkageIndexes[2],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: pinId(index),
        point,
        movingLayerIndexes: moving,
        spacerLayerIndexes: spacerIndexesFrom(
          gearCount,
          Math.max(1, moving.length - 1),
        ),
      };
    });
  }

  if (type === "planetary_gear") {
    const sunIndex = cleanIndexes[1] ?? cleanIndexes[0];
    const carrierIndex = cleanIndexes[2] ?? sunIndex;
    const planetIndex = cleanIndexes[3] ?? carrierIndex;
    return points.map((point, index) => {
      if (index === 0) {
        return {
          id: "A",
          point,
          movingLayerIndexes: [sunIndex, carrierIndex].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(1),
        };
      }
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: [carrierIndex, planetIndex].filter(
          (item): item is number => typeof item === "number",
        ),
        spacerLayerIndexes: spacerIndexesFrom(2),
      };
    });
  }

  if (
    (type === "4bar" || type === "5bar" || type === "6bar") &&
    points.length === cleanIndexes.length + 1
  ) {
    return points.map((point, index) => {
      const pinMovingLayerIndexes = [
        cleanIndexes[index - 1],
        cleanIndexes[index],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: pinMovingLayerIndexes,
        spacerLayerIndexes: spacerIndexesForPin(pinMovingLayerIndexes),
      };
    });
  }

  return points.map((point, index) => {
    const pinMovingLayerIndexes = [
      cleanIndexes[Math.min(index, cleanIndexes.length - 1)],
    ].filter((item): item is number => typeof item === "number");
    return {
      id: ids[index] ?? `P${index + 1}`,
      point,
      movingLayerIndexes: pinMovingLayerIndexes,
      spacerLayerIndexes: spacerIndexesForPin(pinMovingLayerIndexes),
    };
  });
};

const foundrySpacerTouchesPin = (
  pin: FoundryPinStackPoint,
  spacerLayerIndex: number,
) => pin.spacerLayerIndexes.includes(spacerLayerIndex);

const foundryPinStacks = (
  pinPoints: FoundryPinStackPoint[],
  renderedLayerZ: number[],
  options: {
    includeSpacerZ?: boolean;
    spacerZForPin?: (pin: FoundryPinStackPoint) => number[] | undefined;
  } = {},
): FoundryPinStack[] =>
  pinPoints.map((pin) => {
    const localSpacerZ = options.includeSpacerZ
      ? options.spacerZForPin?.(pin)
      : undefined;
    const zIndexes = options.includeSpacerZ
      ? localSpacerZ?.length
        ? pin.movingLayerIndexes
        : [...pin.movingLayerIndexes, ...pin.spacerLayerIndexes]
      : pin.movingLayerIndexes;
    const stackZ = [
      ...zIndexes
        .map((index) => renderedLayerZ[index])
        .filter((z): z is number => typeof z === "number"),
      ...(localSpacerZ ?? []),
    ];
    const minZ = stackZ.length
      ? Math.min(...stackZ)
      : (renderedLayerZ[0] ?? FABRICATION_RENDER_LAYER_Z_STEP);
    const maxZ = stackZ.length ? Math.max(...stackZ) : minZ;
    const bottomZ = Number(
      (minZ - FABRICATION_RENDER_PART_DEPTH / 2 - 0.08).toFixed(3),
    );
    const topZ = Number(
      (maxZ + FABRICATION_RENDER_PART_DEPTH / 2 + 0.18).toFixed(3),
    );
    const lengthZ = Math.max(0.46, Number((topZ - bottomZ).toFixed(3)));
    return {
      ...pin,
      bottomZ,
      topZ,
      centerZ: Number(((bottomZ + topZ) / 2).toFixed(3)),
      lengthZ,
    };
  });

const foundryLocalSpacerZsForPin = (
  type: MechanismType,
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
  layers: FoundryRenderLayerLike[],
) => {
  const boardSideSpacerZ = (movingZ: number) =>
    Number(
      (
        movingZ -
        (FABRICATION_RENDER_PART_DEPTH + FABRICATION_RENDER_MIN_CLEARANCE) / 2
      ).toFixed(3),
    );
  const movingZ = pin.movingLayerIndexes
    .map((index) => renderedLayerZ[index])
    .filter((z): z is number => typeof z === "number")
    .sort((a, b) => a - b);
  const uniqueMovingZ = movingZ.filter(
    (z, index) => index === 0 || Math.abs(z - movingZ[index - 1]) > 0.001,
  );
  const betweenMovingLayers = () =>
    uniqueMovingZ
      .slice(1)
      .map((z, index) => Number(((uniqueMovingZ[index] + z) / 2).toFixed(3)));
  if (type === "4bar") {
    if ((pin.id === "A" || pin.id === "D") && uniqueMovingZ.length === 1) {
      return [boardSideSpacerZ(uniqueMovingZ[0])];
    }
    if ((pin.id === "B" || pin.id === "C") && uniqueMovingZ.length >= 2)
      return betweenMovingLayers().slice(0, 1);
  }
  if (type === "gear_linkage" && uniqueMovingZ.length >= 2) {
    const minZ = uniqueMovingZ[0];
    const maxZ = uniqueMovingZ.at(-1) ?? minZ;
    const spacerCount = Math.max(
      pin.spacerLayerIndexes.length,
      uniqueMovingZ.length - 1,
    );
    return Array.from({ length: spacerCount }, (_, index) =>
      Number(
        (minZ + ((maxZ - minZ) * (index + 1)) / (spacerCount + 1)).toFixed(3),
      ),
    );
  }
  if (type === "planetary_gear" && uniqueMovingZ.length >= 2)
    return betweenMovingLayers().slice(0, 1);
  if (
    (type === "gear" || type === "gear_linkage") &&
    pin.movingLayerIndexes.some((index) => layers[index]?.renderKind === "gear")
  ) {
    const gearLayerIndex = pin.movingLayerIndexes.find(
      (index) => layers[index]?.renderKind === "gear",
    );
    const gearZ =
      typeof gearLayerIndex === "number"
        ? renderedLayerZ[gearLayerIndex]
        : undefined;
    return typeof gearZ === "number"
      ? [boardSideSpacerZ(gearZ)]
      : [];
  }
  return [];
};

const foundryLocalSpacerZForPin = (
  type: MechanismType,
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
  layers: FoundryRenderLayerLike[],
  spacerLayerIndex?: number,
) => {
  const spacerZs = foundryLocalSpacerZsForPin(
    type,
    pin,
    renderedLayerZ,
    layers,
  );
  if (typeof spacerLayerIndex === "number") {
    const spacerOrdinal = pin.spacerLayerIndexes.indexOf(spacerLayerIndex);
    return spacerZs[Math.max(0, spacerOrdinal)] ?? spacerZs[0];
  }
  return spacerZs[0];
};

const disposeThreeObject = (object: THREE.Object3D) =>
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.foundryCached)
      mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material))
      material.forEach((item) => {
        if (!item.userData.foundryCached) item.dispose();
      });
    else if (material && !material.userData.foundryCached) material.dispose();
  });

const ThreeFoundryPreview = ({
  mechanism,
  simulation,
  kit,
  camera,
  rigOpacity,
  color,
  pathPoints,
  pathTraces,
  showGrid,
  showPathPreview,
  showTrail,
  showForces,
  showVelocity,
  explode,
  physicsRule,
  velocityMagnitude,
  forceMagnitude,
  frictionCoefficient,
  frictionMagnitude,
  constraintError,
  cameraLabel,
  isPickingAnchor,
  isOrbiting,
  isZooming,
  isPanning,
  onAnchorPick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onProjectionSizeChange,
  children,
}: ThreeFoundryPreviewProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraStateRef = useRef(camera);
  const dynamicBuildCountRef = useRef(0);
  const geometryCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const materialCacheRef = useRef<Map<string, THREE.Material>>(new Map());
  const [physicsKernelRuntime, setPhysicsKernelRuntime] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [physicsKernelVersion, setPhysicsKernelVersion] = useState("pending");
  const [physicsKernelError, setPhysicsKernelError] = useState("none");
  const isGearTrain =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const isPlanetaryGear = mechanism.type === "planetary_gear";
  const gearRadii = isGearTrain
    ? gearTrainPitchRadii(mechanism)
    : mechanism.type === "planetary_gear"
      ? planetaryGearRadii(mechanism)
      : [mechanism.crankLength, mechanism.rockerLength];
  const gearCenters = isGearTrain
    ? fittedGearTrainCenters(
        gearRadii,
        simulation.state.p1,
        simulation.state.p2,
      )
    : [];
  const planetaryConvention =
    mechanism.type === "planetary_gear"
      ? planetaryGearConventionForMechanism(mechanism)
      : null;
  const baseInv = foundryRenderedInventory(mechanism.type);
  const inv = isGearTrain
    ? {
        ...baseInv,
        gears: gearRadii.length,
        parts: Math.max(baseInv.parts, gearRadii.length + 4),
      }
    : mechanism.type === "planetary_gear"
      ? {
          ...baseInv,
          gears: gearRadii.length,
          parts: Math.max(baseInv.parts, gearRadii.length + 4),
        }
      : baseInv;
  const driveReferencePoint =
    mechanism.type === "cam" && simulation.state.aux
      ? simulation.state.aux
      : simulation.state.j1;
  const pinionRotation =
    (Math.atan2(
      driveReferencePoint.y - simulation.state.p1.y,
      driveReferencePoint.x - simulation.state.p1.x,
    ) *
      180) /
    Math.PI;
  const renderPlan = useMemo(
    () => fabricationRenderPlanForMechanism(mechanism),
    [mechanism],
  );
  const physicalValidationErrors = useMemo(
    () => validateMechanismPreviewReadiness(mechanism),
    [mechanism],
  );
  const physicalValidationSummary = physicalValidationErrors.join(" | ");
  const stackLayerZ = useMemo(
    () =>
      renderPlan.layers.map(
        (item) =>
          item.z +
          explode * item.stackIndex * FABRICATION_RENDER_LAYER_Z_STEP * 1.5,
      ),
    [explode, renderPlan],
  );
  const gearLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        item.renderKind === "gear" ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const gearMeshPlaneZ =
    (isGearTrain || isPlanetaryGear) && explode <= 0 && gearLayerIndexes.length
      ? stackLayerZ[gearLayerIndexes[0]]
      : undefined;
  const renderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        mechanism.type,
        renderPlan.layers,
        stackLayerZ,
        gearMeshPlaneZ,
      ),
    [gearMeshPlaneZ, mechanism.type, renderPlan.layers, stackLayerZ],
  );
  const activeGearPlaneZ =
    typeof gearMeshPlaneZ === "number"
      ? gearMeshPlaneZ
      : isPlanetaryGear && gearLayerIndexes.length
        ? renderedLayerZ[gearLayerIndexes[0]]
        : undefined;
  const gearPlaneMode = isGearTrain
    ? typeof gearMeshPlaneZ === "number"
      ? "coplanar-fixed-axles"
      : "exploded-stack"
    : isPlanetaryGear
      ? typeof gearMeshPlaneZ === "number"
        ? "planetary-coplanar-ring-sun-planet"
        : "exploded-stack"
      : "not-gear-train";
  const viewerContract = useMemo(
    () =>
      createViewer3DContract("foundry", camera.preset, {
        grid: showGrid,
        character: "absent",
        skeleton: "absent",
        mechanisms: true,
        paths: showPathPreview,
        forces: showForces,
        velocity: showVelocity,
        trail: showTrail,
      }),
    [
      camera.preset,
      showForces,
      showGrid,
      showPathPreview,
      showTrail,
      showVelocity,
    ],
  );
  const spacerLayerCount = renderPlan.layers.filter(
    (item) => item.role === "spacer",
  ).length;
  const assemblyPinPoints = useMemo(
    () =>
      isGearTrain
        ? mechanism.type === "gear_linkage"
          ? [
              ...gearCenters,
              simulation.state.j1,
              simulation.state.j2,
              simulation.state.effector,
            ].filter((point): point is Point => Boolean(point))
          : gearCenters
        : foundryAssemblyPinPoints(mechanism.type, simulation.state),
    [gearCenters, isGearTrain, mechanism.type, simulation.state],
  );
  const assemblyPinContract = foundryAssemblyPinContract(mechanism.type);
  const movingLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        isMovingRenderKind(item.renderKind) ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const spacerLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        item.role === "spacer" ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const pinStackPoints = useMemo(
    () =>
      foundryPinStackPoints(
        mechanism.type,
        assemblyPinPoints,
        movingLayerIndexes,
        spacerLayerIndexes,
      ),
    [assemblyPinPoints, mechanism.type, movingLayerIndexes, spacerLayerIndexes],
  );
  const localSpacerZsForPin = useMemo(
    () => (pin: FoundryPinStackPoint) =>
      foundryLocalSpacerZsForPin(
        mechanism.type,
        pin,
        renderedLayerZ,
        renderPlan.layers,
      ),
    [mechanism.type, renderPlan.layers, renderedLayerZ],
  );
  const localSpacerZForPin = useMemo(
    () => (pin: FoundryPinStackPoint, spacerLayerIndex?: number) =>
      foundryLocalSpacerZForPin(
        mechanism.type,
        pin,
        renderedLayerZ,
        renderPlan.layers,
        spacerLayerIndex,
      ),
    [mechanism.type, renderPlan.layers, renderedLayerZ],
  );
  const usesLocalSpacerPins =
    mechanism.type === "4bar" || isGearTrain || isPlanetaryGear;
  const pinStacks = useMemo(
    () =>
      foundryPinStacks(pinStackPoints, renderedLayerZ, {
        includeSpacerZ: usesLocalSpacerPins,
        spacerZForPin: localSpacerZsForPin,
      }),
    [localSpacerZsForPin, pinStackPoints, renderedLayerZ, usesLocalSpacerPins],
  );
  const spacerRenderCount = spacerLayerIndexes.reduce(
    (count, spacerIndex) =>
      count +
      pinStackPoints.filter((pin) => foundrySpacerTouchesPin(pin, spacerIndex))
        .length,
    0,
  );
  const boardPivotPinStacks =
    mechanism.type === "4bar"
      ? pinStacks.filter((pin) => pin.id === "A" || pin.id === "D")
      : [];
  const boardPivotSpacerZ = (pin: FoundryPinStackPoint) =>
    localSpacerZForPin(pin);
  const boardPivotSpacerSummary = boardPivotPinStacks
    .map((pin) => `${pin.id}:${boardPivotSpacerZ(pin)?.toFixed(2) ?? "n/a"}`)
    .join(",");
  const gearBoardSpacerSummary = isGearTrain
    ? pinStackPoints
        .slice(0, gearCenters.length)
        .map(
          (pin) => `${pin.id}:${localSpacerZForPin(pin)?.toFixed(2) ?? "n/a"}`,
        )
        .join(",")
    : "";
  const gearAxleZOrderSummary = isGearTrain
    ? pinStackPoints
        .slice(0, gearCenters.length)
        .map((pin) => {
          const gearLayerIndex = pin.movingLayerIndexes.find(
            (index) => renderPlan.layers[index]?.renderKind === "gear",
          );
          const gearZ =
            typeof gearLayerIndex === "number"
              ? renderedLayerZ[gearLayerIndex]
              : undefined;
          const spacerZ = localSpacerZForPin(pin);
          const fastenerZ = pinStacks.find(
            (stack) => stack.id === pin.id,
          )?.topZ;
          const ordered =
            typeof spacerZ === "number" &&
            typeof gearZ === "number" &&
            typeof fastenerZ === "number" &&
            spacerZ < gearZ &&
            gearZ < fastenerZ;
          return `${pin.id}:${ordered ? "S10<gear<fastener" : "invalid"}`;
        })
        .join(",")
    : "";
  const gearLinkagePinZOrderSummary =
    mechanism.type === "gear_linkage"
      ? pinStackPoints
          .slice(gearCenters.length)
          .map((pin) => {
            const movingEntries = pin.movingLayerIndexes
              .map((index) => ({
                z: renderedLayerZ[index],
                label:
                  renderPlan.layers[index]?.renderKind === "gear"
                    ? "gear"
                    : renderPlan.layers[index]?.renderKind === "guide"
                      ? "bracket"
                      : (renderPlan.layers[index]?.renderKind ?? "part"),
              }))
              .filter(
                (entry): entry is { z: number; label: string } =>
                  typeof entry.z === "number",
              );
            const spacerEntries = localSpacerZsForPin(pin).map((z) => ({
              z,
              label: "S10",
            }));
            const ordered = [...movingEntries, ...spacerEntries]
              .sort((a, b) => a.z - b.z)
              .map((entry) => entry.label)
              .join("<");
            const validCrank =
              pin.id === "B"
                ? /gear<.*S10<.*linkage/.test(ordered)
                : pin.id === "C"
                  ? /gear<.*S10<.*S10<.*linkage/.test(ordered)
                  : pin.id === "R"
                    ? /linkage<.*S10<.*linkage/.test(ordered)
                    : true;
            return `${pin.id}:${validCrank ? ordered : "invalid"}`;
          })
          .join(",")
      : "";
  const stackZGap =
    renderPlan.layers.length > 1
      ? renderPlan.layers[1].z - renderPlan.layers[0].z
      : 0;
  const pinBottomZ = pinStacks.length
    ? Math.min(...pinStacks.map((pin) => pin.bottomZ))
    : (renderedLayerZ[0] ?? 0.22) - 0.08;
  const pinTopZ = pinStacks.length
    ? Math.max(...pinStacks.map((pin) => pin.topZ))
    : (renderedLayerZ.at(-1) ?? 0.22) + 0.18;
  const pinLengthZ = pinStacks.length
    ? Math.max(...pinStacks.map((pin) => pin.lengthZ))
    : Math.max(0.55, pinTopZ - pinBottomZ);
  const pinSpanSummary = pinStacks
    .map((pin) => `${pin.id}:${pin.lengthZ.toFixed(2)}`)
    .join(",");
  const pinStackLayerSummary = pinStackPoints
    .map((pin) => `${pin.id}:${pin.movingLayerIndexes.join("+") || "none"}`)
    .join(",");
  const spacerPinIdSummary = spacerLayerIndexes
    .map(
      (spacerIndex) =>
        `${spacerIndex}:${pinStackPoints
          .filter((pin) => foundrySpacerTouchesPin(pin, spacerIndex))
          .map((pin) => pin.id)
          .join("+")}`,
    )
    .join(",");
  const gearAxleCenters = isGearTrain
    ? pinStackPoints.slice(0, gearCenters.length).map((pin) => pin.point)
    : [];
  const gearCenterSummary = gearCenters
    .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
    .join(",");
  const gearAxleCenterSummary = gearAxleCenters
    .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
    .join(",");
  const gearEndpointMode = isGearTrain
    ? gearRadii.length > 2
      ? "idler-connected-pitch-chain"
      : mechanism.type === "gear"
        ? "direct-pitch-mesh"
        : "separated-endpoints-dual-drivers"
    : "not-gear-train";
  const gearUsesMeshPhases =
    gearEndpointMode === "direct-pitch-mesh" ||
    gearEndpointMode === "idler-connected-pitch-chain";
  const gearCouplingMode = isGearTrain
    ? gearEndpointMode === "idler-connected-pitch-chain"
      ? "idler-coupled"
      : gearEndpointMode === "direct-pitch-mesh"
        ? "direct-mesh"
        : "dual-driven-endpoints"
    : "not-gear-train";
  const gearMeshPhaseSummary = isGearTrain
    ? gearRadii
        .map((_, index) =>
          gearUsesMeshPhases
            ? gearTrainMeshPhaseDegAt(gearRadii, index).toFixed(2)
            : "0.00",
        )
        .join(",")
    : "";
  const gearCenterSource = isGearTrain
    ? gearUsesMeshPhases
      ? "fitted-simulation-pitch-centers"
      : "separated-dual-driver-endpoints"
    : "not-gear-train";
  const gearLinkageSpacingContract =
    mechanism.type === "gear_linkage"
      ? gearEndpointMode === "idler-connected-pitch-chain"
        ? "idler-connected-pitch-chain"
        : "separated-endpoints-await-idlers"
      : "not-gear-linkage";
  const gearCenterMaxError =
    isGearTrain && gearUsesMeshPhases && gearCenters.length > 1
      ? Math.max(
          ...gearCenters.slice(1).map((center, index) => {
            const previous = gearCenters[index];
            const expected =
              (gearRadii[index] + gearRadii[index + 1]) * simulation.scale;
            return Math.abs(
              Math.hypot(center.x - previous.x, center.y - previous.y) -
                expected,
            );
          }),
        )
      : 0;
  const gearOutputRatioForDisplay = isGearTrain
    ? mechanism.type === "gear_linkage" && gearRadii.length <= 2
      ? Number.isFinite(mechanism.speed2)
        ? (mechanism.speed2 ?? 1)
        : Number.isFinite(mechanism.gearRatio)
          ? (mechanism.gearRatio ?? 1)
          : gearTrainOutputRatio(mechanism)
      : gearTrainOutputRatio(mechanism)
    : mechanism.type === "planetary_gear"
      ? planetaryCarrierOutputRatio(
          mechanism.crankLength,
          mechanism.rockerLength,
        )
      : gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength);
  const localSpacerViolationCount = usesLocalSpacerPins
    ? pinStackPoints.reduce((count, pin) => {
        const movingZ = pin.movingLayerIndexes
          .map((index) => renderedLayerZ[index])
          .filter((z): z is number => typeof z === "number")
          .sort((a, b) => a - b);
        const uniqueMovingZ = movingZ.filter(
          (z, index) => index === 0 || Math.abs(z - movingZ[index - 1]) > 0.001,
        );
        if (!uniqueMovingZ.length) return count;
        const spacerZs = localSpacerZsForPin(pin);
        const expectsLocalSpacer =
          mechanism.type === "4bar"
            ? pin.id === "A" ||
              pin.id === "D" ||
              ((pin.id === "B" || pin.id === "C") &&
                uniqueMovingZ.length >= 2)
            : isGearTrain || isPlanetaryGear;
        if (!expectsLocalSpacer) return count;
        if (!spacerZs.length) return count + 1;
        const minZ = uniqueMovingZ[0];
        const maxZ = uniqueMovingZ.at(-1) ?? minZ;
        const invalid = spacerZs.some((z) =>
          uniqueMovingZ.length === 1
            ? !(
                z < minZ &&
                z >= minZ - FABRICATION_RENDER_LAYER_Z_STEP &&
                z + FABRICATION_RENDER_MIN_CLEARANCE / 2 <=
                  minZ - FABRICATION_RENDER_PART_DEPTH / 2 + 0.001
              )
            : !(z > minZ && z < maxZ),
        );
        return count + (invalid ? 1 : 0);
      }, 0)
    : 0;
  const zCollisionCount = pinStacks.filter(
    (pin) => pin.topZ <= pin.bottomZ || pin.lengthZ <= 0,
  ).length + localSpacerViolationCount;
  const visiblePathTraces = useMemo(
    () =>
      pathTraces.length
        ? pathTraces
        : [
            {
              id: "output",
              label: "Output path",
              points: pathPoints,
              primary: true,
            },
          ],
    [pathPoints, pathTraces],
  );
  const primaryPathId =
    visiblePathTraces.find((trace) => trace.primary)?.id ??
    visiblePathTraces[0]?.id ??
    "";
  const pathLayerZ = pinTopZ + 0.08;
  const camContactErrorForData =
    mechanism.type === "cam"
      ? (() => {
          const s = simulation.state;
          const guideDx = s.j2.x - s.p1.x;
          const guideDy = s.j2.y - s.p1.y;
          const guideLength = Math.hypot(guideDx, guideDy);
          const guide =
            guideLength > 0.001
              ? { x: guideDx / guideLength, y: guideDy / guideLength }
              : {
                  x: Math.cos(degToRad(mechanism.groundAngle ?? 90)),
                  y: -Math.sin(degToRad(mechanism.groundAngle ?? 90)),
                };
          const contactGap = Math.abs(
            Math.hypot(s.j2.x - s.j1.x, s.j2.y - s.j1.y) -
              Math.max(0, mechanism.sliderOffset) * simulation.scale,
          );
          const axisError = Math.abs(
            (s.j1.x - s.p1.x) * guide.y - (s.j1.y - s.p1.y) * guide.x,
          );
          return Math.max(contactGap, axisError);
        })()
      : 0;
  useEffect(() => {
    let active = true;
    loadRapierPhysicsKernel()
      .then((kernel) => {
        if (!active) return;
        setPhysicsKernelRuntime("ready");
        setPhysicsKernelVersion(kernel.version());
        setPhysicsKernelError("none");
      })
      .catch((error) => {
        if (!active) return;
        setPhysicsKernelRuntime("unavailable");
        setPhysicsKernelVersion("unavailable");
        setPhysicsKernelError(physicsKernelErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const renderCamera = (view: FoundryCamera) => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    cam.position.copy(foundryCameraPosition(view));
    cam.lookAt(foundryCameraTarget(view));
    renderer.render(scene, cam);
  };
  const handleAnchorClick: React.MouseEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (!isPickingAnchor) return;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!renderer || !cam) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cam);
    const hit = new THREE.Vector3();
    if (
      !raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
        hit,
      )
    )
      return;
    const previewX = 180 + hit.x * 18;
    const previewY = 120 - hit.y * 18;
    onAnchorPick({
      x: (previewX / 360 - 0.5) * SCENE_VIEW.width,
      y: (0.5 - previewY / 240) * SCENE_VIEW.height,
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, WEBGL_PIXEL_RATIO_CAP),
    );
    renderer.shadowMap.enabled = false;
    renderer.domElement.className = "foundry-three-canvas";
    renderer.domElement.dataset.testid = "foundry-three-canvas";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8f9ff");
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 8, 10);
    key.castShadow = true;
    scene.add(key);
    const staticRoot = new THREE.Group();
    staticRoot.name = "foundry-static";
    const grid = new THREE.GridHelper(24, 24, "#c7d2fe", "#e2e8f0");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.9;
    staticRoot.add(grid);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 16),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.9,
        transparent: true,
        opacity: 0.72,
      }),
    );
    plane.receiveShadow = true;
    plane.position.z = -0.94;
    staticRoot.add(plane);
    scene.add(staticRoot);
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = cam;
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      onProjectionSizeChange({ width, height });
      renderer.setSize(width, height, false);
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
      renderCamera(cameraStateRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    renderCamera(cameraStateRef.current);
    return () => {
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentElement === host)
        host.removeChild(renderer.domElement);
      disposeThreeObject(scene);
      geometryCacheRef.current.forEach((geometry) => geometry.dispose());
      materialCacheRef.current.forEach((material) => material.dispose());
      geometryCacheRef.current.clear();
      materialCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    cameraStateRef.current = camera;
    renderCamera(camera);
  }, [camera]);

  useEffect(() => {
    const scene = sceneRef.current;
    const staticRoot = scene?.getObjectByName("foundry-static");
    if (!staticRoot) return;
    staticRoot.visible = showGrid;
    renderCamera(cameraStateRef.current);
  }, [showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    const old = scene.getObjectByName("foundry-dynamic");
    if (old) {
      scene.remove(old);
      disposeThreeObject(old);
    }
    const root = new THREE.Group();
    root.name = "foundry-dynamic";
    scene.add(root);
    if (renderPlan.validationErrors.length || physicalValidationErrors.length) {
      dynamicBuildCountRef.current += 1;
      if (stateRef.current) {
        stateRef.current.dataset.threeDynamicBuildCount = String(
          dynamicBuildCountRef.current,
        );
        stateRef.current.dataset.threeGeometryCacheSize = String(
          geometryCacheRef.current.size,
        );
        stateRef.current.dataset.threeMaterialCacheSize = String(
          materialCacheRef.current.size,
        );
      }
      renderCamera(cameraStateRef.current);
      return;
    }
    const geometryCache = geometryCacheRef.current;
    const materialCache = materialCacheRef.current;
    const cachedGeometry = <T extends THREE.BufferGeometry>(
      key: string,
      create: () => T,
    ): T => {
      const existing = geometryCache.get(key) as T | undefined;
      if (existing) return existing;
      const geometry = create();
      geometry.userData.foundryCached = true;
      geometryCache.set(key, geometry);
      return geometry;
    };
    const cachedMaterial = <T extends THREE.Material>(
      key: string,
      create: () => T,
    ): T => {
      const existing = materialCache.get(key) as T | undefined;
      if (existing) return existing;
      const material = create();
      material.userData.foundryCached = true;
      materialCache.set(key, material);
      return material;
    };
    const materialForLayer = (
      colorValue: string,
      roughness = 0.66,
      metalness = 0.03,
    ) =>
      cachedMaterial(
        `standard:${colorValue}:${roughness.toFixed(2)}:${metalness.toFixed(2)}:${rigOpacity.toFixed(3)}`,
        () =>
          new THREE.MeshStandardMaterial({
            color: colorValue,
            roughness,
            metalness,
            transparent: rigOpacity < 0.995,
            opacity: rigOpacity,
          }),
      );
    const material = {
      base: materialForLayer(renderPlan.base.color, 0.82, 0.01),
      accent: materialForLayer("#60a5fa", 0.45, 0.08),
      hole: cachedMaterial(
        "standard:#ffffff:0.25:0.00:1",
        () =>
          new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.25 }),
      ),
      dark: materialForLayer("#334155", 0.62, 0.03),
      edge: cachedMaterial(
        "edge:#334155:0.72",
        () =>
          new THREE.LineBasicMaterial({
            color: "#334155",
            transparent: true,
            opacity: 0.72,
          }),
      ),
      path: cachedMaterial(
        `path:${color}`,
        () =>
          new THREE.LineDashedMaterial({
            color: new THREE.Color(color),
            dashSize: 0.25,
            gapSize: 0.16,
            linewidth: 2,
          }),
      ),
      trail: cachedMaterial(
        `trail:${color}`,
        () =>
          new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.18,
          }),
      ),
    };
    const to3 = (point: Point, z = 0) =>
      new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);
    const mmToThree = SCENE_PX_PER_MM / 18;
    const thickness = Math.max(0.2, kit.holeDiameterMm / 10);
    const spacerDepth = Math.max(0.08, FABRICATION_RENDER_MIN_CLEARANCE);
    const barW = Math.max(0.34, FABRICATION_LINKAGE_WIDTH_MM * mmToThree);
    const holeR = Math.max(0.08, FABRICATION_HOLE_RADIUS_MM * mmToThree);
    const spacerOuterR =
      (FABRICATION_SPACER_SPEC.outerDiameterMm * mmToThree) / 2;
    const spacerInnerR =
      (FABRICATION_SPACER_SPEC.innerDiameterMm * mmToThree) / 2;
    const addEdges = (mesh: THREE.Mesh, key = mesh.geometry.uuid) => {
      const edges = new THREE.LineSegments(
        cachedGeometry(
          `edges:${key}`,
          () => new THREE.EdgesGeometry(mesh.geometry),
        ),
        material.edge,
      );
      mesh.add(edges);
    };
    const circularHole = (x: number, y: number, r = holeR) => {
      const hole = new THREE.Path();
      hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
      return hole;
    };
    const roundedRectShape = (
      width: number,
      height: number,
      radius = height / 2,
    ) => {
      const r = Math.min(radius, width / 2, height / 2);
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2 + r, -height / 2);
      shape.lineTo(width / 2 - r, -height / 2);
      shape.quadraticCurveTo(
        width / 2,
        -height / 2,
        width / 2,
        -height / 2 + r,
      );
      shape.lineTo(width / 2, height / 2 - r);
      shape.quadraticCurveTo(width / 2, height / 2, width / 2 - r, height / 2);
      shape.lineTo(-width / 2 + r, height / 2);
      shape.quadraticCurveTo(
        -width / 2,
        height / 2,
        -width / 2,
        height / 2 - r,
      );
      shape.lineTo(-width / 2, -height / 2 + r);
      shape.quadraticCurveTo(
        -width / 2,
        -height / 2,
        -width / 2 + r,
        -height / 2,
      );
      return shape;
    };
    const addHoleRing = (
      group: THREE.Group,
      x: number,
      y: number,
      z: number,
    ) => {
      const ring = new THREE.Mesh(
        cachedGeometry(
          `hole-ring:${holeR.toFixed(3)}`,
          () => new THREE.TorusGeometry(holeR * 1.1, 0.025, 8, 24),
        ),
        material.accent,
      );
      ring.position.set(x, y, z + thickness / 2 + 0.025);
      group.add(ring);
    };
    const addSpacerWasher = (
      point: Point | undefined,
      z: number,
      mat: THREE.Material,
    ) => {
      if (!point) return;
      const p = to3(point, z);
      const geometryKey = `spacer:${spacerOuterR.toFixed(3)}:${spacerInnerR.toFixed(3)}:${spacerDepth.toFixed(3)}`;
      const washer = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = new THREE.Shape();
          shape.absellipse(
            0,
            0,
            spacerOuterR,
            spacerOuterR,
            0,
            Math.PI * 2,
            false,
          );
          shape.holes.push(circularHole(0, 0, spacerInnerR));
          return new THREE.ExtrudeGeometry(shape, {
            depth: spacerDepth,
            bevelEnabled: true,
            bevelSize: 0.012,
          });
        }),
        mat,
      );
      washer.position.set(p.x, p.y, z - spacerDepth / 2);
      washer.castShadow = true;
      addEdges(washer, geometryKey);
      root.add(washer);
    };
    const addClipCap = (
      point: Point | undefined,
      z: number,
      mat: THREE.Material,
      radiusScale = 1.35,
    ) => {
      if (!point) return;
      const p = to3(point, z);
      const clip = new THREE.Mesh(
        cachedGeometry(
          `clip:${holeR.toFixed(3)}:${radiusScale.toFixed(2)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * radiusScale,
              holeR * radiusScale,
              0.08,
              24,
            ),
        ),
        mat,
      );
      clip.rotation.x = Math.PI / 2;
      clip.position.copy(p);
      clip.position.z = z;
      root.add(clip);
    };
    const addBar = (
      a: Point | undefined,
      b: Point | undefined,
      z: number,
      mat: THREE.Material,
      holeCount = 2,
    ) => {
      if (!a || !b) return;
      const av = to3(a, z),
        bv = to3(b, z);
      const dx = bv.x - av.x,
        dy = bv.y - av.y,
        len = Math.hypot(dx, dy);
      if (len < 0.05) return;
      const sceneLength = Math.hypot(b.x - a.x, b.y - a.y);
      const linkageSpec = fabricationLinkageSpecForSceneLength(
        sceneLength,
        kit.gridPitchMm,
        holeCount,
      );
      const templateLen = linkageSpec.lengthMm * mmToThree;
      const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
      const holeXs = linkageSpec.holeCentersMm.map(
        (point) =>
          (point.x - firstHoleX - linkageSpec.lengthMm / 2) * mmToThree,
      );
      const outlineLen = templateLen + barW;
      const group = new THREE.Group();
      group.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
      group.rotation.z = Math.atan2(dy, dx);
      const geometryKey = `bar:${linkageSpec.key}:${kit.gridPitchMm}:${outlineLen.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = roundedRectShape(outlineLen, barW);
          shape.holes.push(...holeXs.map((x) => circularHole(x, 0)));
          return new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.018,
          });
        }),
        mat,
      );
      mesh.position.z = -thickness / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addEdges(mesh, geometryKey);
      group.add(mesh);
      holeXs.forEach((x) => addHoleRing(group, x, 0, 0));
      root.add(group);
    };
    const shapeFromPoints = (points: Point[]) => {
      const shape = new THREE.Shape();
      points.forEach((point, index) => {
        if (index === 0) shape.moveTo(point.x, point.y);
        else shape.lineTo(point.x, point.y);
      });
      shape.closePath();
      return shape;
    };
    const addGear = (
      center: Point,
      radius: number,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.38, (radius * simulation.scale) / 18);
      const profile = fabricationGearProfileForPitchRadius(
        r,
        radius / SCENE_PX_PER_MM,
      );
      const shape = shapeFromPoints(profile.outlinePoints);
      const axleHoleRadius = Math.max(holeR * 0.7, profile.axleHoleRadius);
      shape.holes.push(circularHole(0, 0, axleHoleRadius));
      profile.attachmentHoleCenters.forEach((point) =>
        shape.holes.push(
          circularHole(
            point.x,
            point.y,
            Math.max(holeR * 0.55, profile.axleHoleRadius),
          ),
        ),
      );
      const geometryKey = `gear:${mechanism.type}:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const geom = cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = (rotation * Math.PI) / 180;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
      const holes = new THREE.Group();
      holes.position.set(c.x, c.y, z);
      holes.rotation.z = mesh.rotation.z;
      addHoleRing(holes, 0, 0, 0);
      profile.attachmentHoleCenters.forEach((point) =>
        addHoleRing(holes, point.x, point.y, 0),
      );
      root.add(holes);
    };
    const addRingGear = (
      center: Point,
      radius: number,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.82, (radius * simulation.scale) / 18);
      const profile = fabricationRingGearProfileForPitchRadius(r);
      const shape = new THREE.Shape();
      shape.absellipse(
        0,
        0,
        profile.outerRadius,
        profile.outerRadius,
        0,
        Math.PI * 2,
        false,
      );
      const inner = new THREE.Path();
      fabricationRingInnerGearOutlinePoints(r).forEach((point, index) => {
        if (index === 0) inner.moveTo(point.x, point.y);
        else inner.lineTo(point.x, point.y);
      });
      inner.closePath();
      shape.holes.push(inner);
      const mountHoleRadius = Math.max(holeR * 0.58, profile.mountHoleRadius);
      profile.mountHoleCenters.forEach((point) =>
        shape.holes.push(circularHole(point.x, point.y, mountHoleRadius)),
      );
      const geometryKey = `ring-gear:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const geom = cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = (rotation * Math.PI) / 180;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
      const holes = new THREE.Group();
      holes.position.set(c.x, c.y, z);
      profile.mountHoleCenters.forEach((point) =>
        addHoleRing(holes, point.x, point.y, 0),
      );
      root.add(holes);
    };
    const addCam = (
      center: Point,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.5, (mechanism.crankLength * simulation.scale) / 22);
      const shape = new THREE.Shape();
      for (let i = 0; i < 56; i++) {
        const a = (i / 56) * Math.PI * 2;
        const rr = r * sampledCamProfileScale(a, mechanism.camProfileSamples);
        const x = Math.cos(a) * rr,
          y = Math.sin(a) * rr;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      shape.holes.push(circularHole(0, 0, holeR * 1.35));
      const geometryKey = `cam:${mechanism.crankLength.toFixed(2)}:${(mechanism.camProfileSamples ?? []).join(",")}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(
          geometryKey,
          () =>
            new THREE.ExtrudeGeometry(shape, {
              depth: thickness,
              bevelEnabled: true,
              bevelSize: 0.025,
            }),
        ),
        mat,
      );
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = rotation;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
    };
    const addSlotPlate = (
      center: Point,
      length: number,
      rotation: number,
      z: number,
      mat: THREE.Material,
    ) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      group.rotation.z = rotation;
      const geometryKey = `slot:${length.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = roundedRectShape(length, barW * 1.35, barW * 0.28);
          shape.holes.push(
            roundedRectShape(length * 0.7, barW * 0.46, barW * 0.23),
          );
          return new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.02,
            bevelThickness: 0.015,
          });
        }),
        mat,
      );
      mesh.position.z = -thickness / 2;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      group.add(mesh);
      root.add(group);
    };
    const addFollowerBlock = (
      center: Point,
      z: number,
      mat: THREE.Material,
      rotation = 0,
    ) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      group.rotation.z = rotation;
      const blockKey = `follower-block:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const block = new THREE.Mesh(
        cachedGeometry(
          blockKey,
          () => new THREE.BoxGeometry(barW * 1.45, barW * 1.8, thickness),
        ),
        mat,
      );
      addEdges(block, blockKey);
      group.add(block);
      const roller = new THREE.Mesh(
        cachedGeometry(
          `follower-roller:${holeR.toFixed(3)}:${thickness.toFixed(3)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * 1.3,
              holeR * 1.3,
              thickness * 1.18,
              28,
            ),
        ),
        material.accent,
      );
      roller.position.set(0, -barW * 0.74, 0.04);
      roller.rotation.x = Math.PI / 2;
      group.add(roller);
      root.add(group);
    };
    const addEndStop = (center: Point, offset: number, z: number) => {
      const c = to3(center, z);
      const stopKey = `end-stop:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const stop = new THREE.Mesh(
        cachedGeometry(
          stopKey,
          () => new THREE.BoxGeometry(0.22, barW * 1.65, thickness * 1.25),
        ),
        material.dark,
      );
      stop.position.set(c.x + offset, c.y, z);
      addEdges(stop, stopKey);
      root.add(stop);
    };
    const addRack = (center: Point, z: number, mat: THREE.Material) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      const rackKey = `rack:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const rack = new THREE.Mesh(
        cachedGeometry(
          rackKey,
          () => new THREE.BoxGeometry(4.6, barW, thickness),
        ),
        mat,
      );
      addEdges(rack, rackKey);
      group.add(rack);
      for (let i = 0; i < 10; i++) {
        const toothKey = `rack-tooth:${thickness.toFixed(3)}`;
        const tooth = new THREE.Mesh(
          cachedGeometry(
            toothKey,
            () => new THREE.BoxGeometry(0.22, 0.18, thickness),
          ),
          mat,
        );
        tooth.position.set(-2.1 + i * 0.46, -barW * 0.65, 0.06);
        tooth.rotation.z = Math.PI / 4;
        group.add(tooth);
      }
      root.add(group);
    };
    const addPath = (points: Point[], z: number, mat: THREE.Material) => {
      if (points.length < 2) return;
      const geom = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => to3(point, z)),
      );
      const line = new THREE.Line(geom, mat);
      if ("computeLineDistances" in line) line.computeLineDistances();
      root.add(line);
    };

    if (showTrail)
      visiblePathTraces.forEach((trace) =>
        addPath(trace.points, pathLayerZ - 0.05, material.trail),
      );
    if (showPathPreview)
      visiblePathTraces.forEach((trace) =>
        addPath(trace.points, pathLayerZ, material.path),
      );

    const s = simulation.state;
    const angle = pinionRotation;
    const camGuideFallback = {
      x: Math.cos(degToRad(mechanism.groundAngle ?? 90)),
      y: -Math.sin(degToRad(mechanism.groundAngle ?? 90)),
    };
    const camGuideVector =
      mechanism.type === "cam"
        ? (() => {
            const dx = s.j2.x - s.p1.x;
            const dy = s.j2.y - s.p1.y;
            const len = Math.hypot(dx, dy);
            return len > 0.001
              ? { x: dx / len, y: dy / len }
              : camGuideFallback;
          })()
        : camGuideFallback;
    const camGuideRotation = Math.atan2(camGuideVector.y, camGuideVector.x);
    const camFollowerRotation = camGuideRotation - Math.PI / 2;
    const camGuideCenter =
      mechanism.type === "cam"
        ? {
            x:
              s.p1.x +
              camGuideVector.x *
                (mechanism.crankLength +
                  mechanism.sliderOffset +
                  mechanism.rockerLength * 0.5) *
                simulation.scale,
            y:
              s.p1.y +
              camGuideVector.y *
                (mechanism.crankLength +
                  mechanism.sliderOffset +
                  mechanism.rockerLength * 0.5) *
                simulation.scale,
          }
        : s.j2;
    const usesMeshedPitchCenters = [
      "gear",
      "gear_linkage",
      "planetary_gear",
      "rack-pinion",
      "cam",
    ].includes(mechanism.type);
    if (!usesMeshedPitchCenters && mechanism.type !== "4bar")
      addBar(s.p1, s.p2, 0, material.base, 3);
    const clipLayer = renderPlan.layers.find(
      (layer) => layer.renderKind === "clip",
    );
    const clipMat = clipLayer
      ? materialForLayer(clipLayer.color, 0.66, 0.03)
      : material.dark;
    const renderLinkageLayer = (
      label: string,
      z: number,
      mat: THREE.Material,
    ) => {
      if (mechanism.type === "gear") return;
      if (
        mechanism.type === "gear_linkage" &&
        /drive.*L|Drive L|drive.*linkage/i.test(label)
      )
        addBar(s.j1, s.effector, z, mat, 4);
      else if (
        mechanism.type === "gear_linkage" &&
        /output.*L|Output L|output.*linkage|L4|linkage/i.test(label)
      )
        addBar(s.j2, s.effector, z, mat, 4);
      else if (mechanism.type === "6bar" && /output rocker/i.test(label))
        addBar(s.p2, s.j2, z, mat, 3);
      else if (mechanism.type === "6bar" && /dyad/i.test(label))
        addBar(s.j2, s.aux, z, mat, 2);
      else if (mechanism.type === "6bar" && /follower/i.test(label))
        addBar(s.p2, s.aux, z, mat, 2);
      else if (mechanism.type === "planetary_gear" && /carrier/i.test(label))
        addBar(s.p1, s.p2, z, mat, 3);
      else if (mechanism.type === "4bar" && /output|rocker/i.test(label))
        addBar(s.p2, s.j2, z, mat, 3);
      else if (/input|crank|left/i.test(label)) addBar(s.p1, s.j1, z, mat, 3);
      else if (/right/i.test(label)) addBar(s.p2, s.j2, z, mat, 3);
      else if (/coupler|center|carrier/i.test(label))
        addBar(s.j1, s.j2, z, mat, 4);
      else if (/output|follower/i.test(label))
        addBar(s.j2, s.effector, z, mat, 2);
      else addBar(s.j1, s.j2, z, mat, 3);
    };
    const renderGearLayer = (
      label: string,
      z: number,
      mat: THREE.Material,
      gearTrainIndex = 0,
    ) => {
      if (mechanism.type === "planetary_gear") {
        if (/ring/i.test(label))
          addRingGear(s.p1, planetaryRingPitchRadius(mechanism), z, 0, mat);
        else if (/planet|G3|3-space/i.test(label)) {
          const planetCenters = [s.p2];
          const planetCount = Math.max(1, planetCenters.length);
          planetCenters.forEach((center, index) =>
            addGear(
              center,
              mechanism.rockerLength,
              z,
              angle *
                planetaryPlanetSpinRatio(
                  mechanism.crankLength,
                  mechanism.rockerLength,
                ) +
                ((mechanism.phase ?? 0) * 180) / Math.PI +
                index * (360 / planetCount),
              mat,
            ),
          );
        } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
      } else if (isGearTrain) {
        const index = Math.max(
          0,
          Math.min(gearTrainIndex, Math.max(0, gearRadii.length - 1)),
        );
        const fallbackCenter = index === 0 ? s.p1 : s.p2;
        const fallbackRadius =
          index === 0 ? mechanism.crankLength : mechanism.rockerLength;
        const isLastGear = index === gearRadii.length - 1;
        const phaseDeg =
          (gearUsesMeshPhases ? gearTrainMeshPhaseDegAt(gearRadii, index) : 0) +
          (isLastGear ? ((mechanism.phase ?? 0) * 180) / Math.PI : 0);
        const ratio = gearUsesMeshPhases
          ? gearTrainRotationRatioAt(gearRadii, index)
          : mechanism.type === "gear_linkage"
            ? index === 0
              ? 1
              : isLastGear
                ? gearOutputRatioForDisplay
                : 0
            : 0;
        addGear(
          gearCenters[index] ?? fallbackCenter,
          gearRadii[index] ?? fallbackRadius,
          z,
          angle * ratio + phaseDeg,
          mat,
        );
      } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
    };
    let gearTrainLayerIndex = 0;
    renderPlan.layers.forEach((layerItem, index) => {
      const z = renderedLayerZ[index] ?? layerItem.z;
      const mat = materialForLayer(
        layerItem.color,
        layerItem.role === "spacer" ? 0.55 : 0.66,
        layerItem.role === "spacer" ? 0.06 : 0.03,
      );
      if (layerItem.renderKind === "clip") return;
      else if (layerItem.renderKind === "spacer")
        pinStacks
          .filter((pin) => foundrySpacerTouchesPin(pin, index))
          .forEach((pin) =>
            addSpacerWasher(
              pin.point,
              localSpacerZForPin(pin, index) ?? z,
              mat,
            ),
          );
      else if (layerItem.renderKind === "linkage")
        renderLinkageLayer(layerItem.label, z, mat);
      else if (layerItem.renderKind === "gear") {
        renderGearLayer(layerItem.label, z, mat, gearTrainLayerIndex);
        if (isGearTrain) gearTrainLayerIndex += 1;
      } else if (layerItem.renderKind === "cam")
        addCam(s.p1, z, degToRad(angle), mat);
      else if (layerItem.renderKind === "guide") {
        const slotRotation =
          mechanism.type === "cam"
            ? camGuideRotation
            : /follower|slider|rack/i.test(layerItem.label)
              ? Math.PI / 2
              : Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
        const slotCenter =
          mechanism.type === "cam"
            ? camGuideCenter
            : /quick/i.test(layerItem.label)
              ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }
              : s.j2;
        addSlotPlate(
          slotCenter,
          /rack/i.test(layerItem.label) ? 4.8 : 3.2,
          slotRotation,
          z,
          mat,
        );
      } else if (layerItem.renderKind === "rack") {
        addRack(s.j2, z, mat);
        addEndStop(s.j2, -2.55, z + 0.04);
        addEndStop(s.j2, 2.55, z + 0.04);
      } else if (layerItem.renderKind === "follower")
        addFollowerBlock(
          s.j2,
          z,
          mat,
          mechanism.type === "cam" ? camFollowerRotation : 0,
        );
    });
    pinStacks.forEach((pinStack) => {
      const boardPivotFastener =
        mechanism.type === "4bar" &&
        (pinStack.id === "A" || pinStack.id === "D");
      addClipCap(
        pinStack.point,
        pinStack.bottomZ,
        clipMat,
        boardPivotFastener ? 1.5 : 1.35,
      );
      addClipCap(
        pinStack.point,
        pinStack.topZ + (boardPivotFastener ? 0.035 : 0),
        clipMat,
        boardPivotFastener ? 1.75 : 1.35,
      );
      const p = to3(pinStack.point, pinStack.centerZ);
      const pin = new THREE.Mesh(
        cachedGeometry(
          `pin:${holeR.toFixed(3)}:${pinStack.lengthZ.toFixed(3)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * 0.8,
              holeR * 0.8,
              pinStack.lengthZ,
              20,
            ),
        ),
        material.dark,
      );
      pin.rotation.x = Math.PI / 2;
      pin.position.copy(p);
      root.add(pin);
    });

    dynamicBuildCountRef.current += 1;
    if (stateRef.current) {
      stateRef.current.dataset.threeDynamicBuildCount = String(
        dynamicBuildCountRef.current,
      );
      stateRef.current.dataset.threeGeometryCacheSize = String(
        geometryCacheRef.current.size,
      );
      stateRef.current.dataset.threeMaterialCacheSize = String(
        materialCacheRef.current.size,
      );
    }
    renderCamera(cameraStateRef.current);
  }, [
    mechanism,
    simulation,
    kit,
    color,
    visiblePathTraces,
    pathLayerZ,
    showPathPreview,
    showTrail,
    pinionRotation,
    renderPlan,
    renderedLayerZ,
    pinStacks,
    rigOpacity,
    physicalValidationErrors,
  ]);

  return (
    <div
      data-testid="foundry-preview"
      onClick={handleAnchorClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      className={`foundry-preview h-[520px] w-full ${isPickingAnchor ? "is-picking-anchor" : ""} ${isOrbiting ? "is-orbiting" : ""} ${isZooming ? "is-zooming" : ""} ${isPanning ? "is-panning" : ""}`}
      aria-label="Foundry 3D view"
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
      data-viewer-contract-state={JSON.stringify(viewerContract)}
      data-viewer-tab={viewerContract.tab}
      data-layer-grid={viewer3DLayerDataValue(showGrid)}
      data-layer-mechanisms={viewer3DLayerDataValue(true)}
      data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
      data-layer-forces={viewer3DLayerDataValue(showForces)}
      data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
      data-layer-trail={viewer3DLayerDataValue(showTrail)}
    >
      <div ref={hostRef} className="foundry-three-host" />
      <div
        ref={stateRef}
        data-testid="foundry-camera-rig"
        data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
        data-viewer-contract-state={JSON.stringify(viewerContract)}
        data-viewer-tab={viewerContract.tab}
        data-camera-preset={camera.preset}
        data-layer-grid={viewer3DLayerDataValue(showGrid)}
        data-layer-mechanisms={viewer3DLayerDataValue(true)}
        data-layer-character={viewer3DLayerDataValue(undefined)}
        data-layer-skeleton={viewer3DLayerDataValue(undefined)}
        data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
        data-layer-forces={viewer3DLayerDataValue(showForces)}
        data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
        data-layer-trail={viewer3DLayerDataValue(showTrail)}
        data-camera-yaw={camera.yaw.toFixed(1)}
        data-camera-pitch={camera.pitch.toFixed(1)}
        data-camera-zoom={camera.zoom.toFixed(3)}
        data-camera-pan-x={(camera.pan?.x ?? 0).toFixed(3)}
        data-camera-pan-y={(camera.pan?.y ?? 0).toFixed(3)}
        data-camera-distance={foundryCameraDistance(camera).toFixed(3)}
        data-rig-opacity={rigOpacity.toFixed(2)}
        data-three-renderer="webgl"
        data-three-engine-stack={PHYSICS_RENDER_STACK}
        data-physics-kernel={PHYSICS_KERNEL_ENGINE}
        data-physics-update-policy={PHYSICS_UPDATE_POLICY}
        data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
        data-physics-contact-mode="kinematic-estimate-rapier-contact-probe"
        data-physics-kernel-runtime={physicsKernelRuntime}
        data-physics-kernel-version={physicsKernelVersion}
        data-physics-kernel-error={physicsKernelError}
        data-physics-authority="motionsmith-kinematics"
        data-mechanism-type={mechanism.type}
        data-three-part-count={inv.parts}
        data-three-hole-count={inv.holes}
        data-three-slot-count={inv.slots}
        data-three-gear-count={inv.gears}
        data-three-rack-count={inv.racks}
        data-three-cam-count={inv.cams}
        data-three-follower-count={inv.followers}
        data-three-end-stop-count={inv.endStops}
        data-three-gear-radii={gearRadii
          .map((radius) => radius.toFixed(2))
          .join(",")}
        data-cam-profile={
          mechanism.type === "cam"
            ? normalizeCamProfileSamples(mechanism.camProfileSamples)
                .map((value) => value.toFixed(2))
                .join(",")
            : ""
        }
        data-three-gear-pitch-center={(isGearTrain
          ? gearTrainResolvedCenterDistance(mechanism)
          : mechanism.type === "planetary_gear"
            ? planetaryGearConventionForMechanism(mechanism).carrierPitchRadius
            : mechanism.groundLength
        ).toFixed(2)}
        data-three-gear-pitch-sum={(isGearTrain
          ? gearTrainPitchCenterDistance(mechanism)
          : mechanism.type === "planetary_gear"
            ? planetaryGearConventionForMechanism(mechanism).ringPitchRadius
            : mechanism.crankLength + mechanism.rockerLength
        ).toFixed(2)}
        data-three-gear-output-ratio={gearOutputRatioForDisplay.toFixed(3)}
        data-three-planet-count={planetaryConvention?.planetCount ?? 0}
        data-three-planetary-syntax={planetaryConvention?.syntax ?? ""}
        data-three-planetary-fixed={planetaryConvention?.fixedMember ?? ""}
        data-three-planetary-input={planetaryConvention?.inputMember ?? ""}
        data-three-planetary-output={planetaryConvention?.outputMember ?? ""}
        data-three-planetary-ring-radius={
          planetaryConvention?.ringPitchRadius.toFixed(2) ?? ""
        }
        data-three-planetary-carrier-radius={
          planetaryConvention?.carrierPitchRadius.toFixed(2) ?? ""
        }
        data-three-planetary-center-source={
          isPlanetaryGear ? "simulation-state-carrier-center" : "not-planetary"
        }
        data-three-gear-train-linkage-mode={
          mechanism.type === "gear"
            ? "gear-only-train"
            : mechanism.type === "gear_linkage"
              ? "two-gear-two-link-coupler"
              : "template-specific"
        }
        data-three-gear-linkage-mode={
          mechanism.type === "gear_linkage"
            ? "two-gear-two-link-coupler"
            : "none"
        }
        data-three-gear-center-source={gearCenterSource}
        data-three-gear-coupling-mode={gearCouplingMode}
        data-three-gear-center-count={gearCenters.length}
        data-three-gear-centers={gearCenterSummary}
        data-three-gear-axle-centers={gearAxleCenterSummary}
        data-three-gear-axle-center-contract={
          isGearTrain
            ? "pin-stacks-use-rendered-gear-centers"
            : "not-gear-train"
        }
        data-three-gear-center-max-error={gearCenterMaxError.toFixed(3)}
        data-three-gear-train-endpoint-mode={gearEndpointMode}
        data-three-gear-mesh-phase-contract={
          isGearTrain
            ? gearUsesMeshPhases
              ? "alternating-three-quarter-tooth-gap-phase"
              : "dual-driven-endpoints-no-mesh-phase"
            : "not-gear-train"
        }
        data-three-gear-mesh-phases={gearMeshPhaseSummary}
        data-three-gear-plane-mode={gearPlaneMode}
        data-three-gear-plane-z={
          typeof activeGearPlaneZ === "number"
            ? activeGearPlaneZ.toFixed(2)
            : ""
        }
        data-three-gear-axle-stack-contract={
          isGearTrain
            ? "board-side>S10-spacer>gear>fastener-head"
            : isPlanetaryGear
              ? "sun/carrier and planet/carrier pins use local S10 spacers"
              : "not-gear-train"
        }
        data-three-gear-board-side-spacer-z={gearBoardSpacerSummary}
        data-three-gear-axle-z-order={gearAxleZOrderSummary}
        data-three-gear-linkage-spacing-contract={gearLinkageSpacingContract}
        data-three-gear-linkage-crank-stack-contract={
          mechanism.type === "gear_linkage"
            ? "B-gear-hole>S10>drive-link;C-gear-hole>S10>S10>output-link;R-drive-link>S10>output-link"
            : "not-gear-linkage"
        }
        data-three-gear-linkage-bracket-anchor={
          mechanism.type === "gear_linkage"
            ? "no-output-bracket"
            : "not-gear-linkage"
        }
        data-three-gear-linkage-pin-z-order={gearLinkagePinZOrderSummary}
        data-three-linkage-pin-radius={
          mechanism.type === "gear_linkage"
            ? mechanism.couplerPointDist.toFixed(2)
            : ""
        }
        data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
        data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
        data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
        data-three-spacer-layers={spacerLayerCount}
        data-three-spacer-render-count={spacerRenderCount}
        data-three-spacer-render-contract="recipe-pin-spacer-sites"
        data-three-spacer-pin-ids={spacerPinIdSummary}
        data-three-board-pivot-spacer-mode={
          mechanism.type === "4bar"
            ? "single-board-side-spacer"
            : "not-board-pivot"
        }
        data-three-board-pivot-spacer-ids={boardPivotPinStacks
          .map((pin) => pin.id)
          .join(",")}
        data-three-board-pivot-spacer-z={boardPivotSpacerSummary}
        data-three-fourbar-ground-link-plane={
          mechanism.type === "4bar" ? "fabrication-stack-separated" : "not-4bar"
        }
        data-three-board-pivot-fastener-contract={
          mechanism.type === "4bar"
            ? "fastener-end>S10-board-side>linkage>fastener-head"
            : "template-specific"
        }
        data-three-physical-pin-count={assemblyPinPoints.length}
        data-three-physical-pin-contract={assemblyPinContract}
        data-three-pin-stack-policy="per-pin-adjacent-stack"
        data-three-pin-stack-z-sources={
          mechanism.type === "4bar"
            ? "fourbar-board-pivots-include-board-side-spacer"
            : isGearTrain
            ? "gear-axles-include-board-side-spacer"
            : isPlanetaryGear
              ? "planetary-carrier-pins-include-local-spacers"
              : "moving-layers-only"
        }
        data-three-pin-stack-layer-indexes={pinStackLayerSummary}
        data-three-pin-stack-spans={pinSpanSummary}
        data-three-pin-stack-clearance-contract="local-spacers-fill-adjacent-z-gaps"
        data-three-z-collision-count={zCollisionCount}
        data-three-ground-span-mode={
          mechanism.type === "4bar" ? "board-reference" : "rendered-reference"
        }
        data-three-cam-guide-mode={
          mechanism.type === "cam" ? "fixed-board-guide" : "not-cam"
        }
        data-three-cam-contact-mode={
          mechanism.type === "cam" ? "sampled-profile-on-guide-axis" : "not-cam"
        }
        data-three-cam-contact-error={
          mechanism.type === "cam" ? camContactErrorForData.toFixed(3) : ""
        }
        data-three-cam-follower-offset={
          mechanism.type === "cam"
            ? (Math.max(0, mechanism.sliderOffset) * simulation.scale).toFixed(
                3,
              )
            : ""
        }
        data-three-cam-pin-contract={
          mechanism.type === "cam"
            ? "cam-axle-and-follower-center-only"
            : "not-cam"
        }
        data-three-cam-rotation-deg={
          mechanism.type === "cam" ? pinionRotation.toFixed(2) : ""
        }
        data-three-ring-mount-mode={
          mechanism.type === "planetary_gear"
            ? "fixed-ring-holes"
            : "not-planetary"
        }
        data-three-path-source="moving-joints"
        data-three-path-trace-count={visiblePathTraces.length}
        data-three-path-trace-ids={visiblePathTraces
          .map((trace) => trace.id)
          .join(",")}
        data-three-primary-path-id={primaryPathId}
        data-three-path-z={pathLayerZ.toFixed(2)}
        data-path-preview={showPathPreview ? "shown" : "hidden"}
        data-trail={showTrail ? "shown" : "hidden"}
        data-forces={showForces ? "shown" : "hidden"}
        data-velocity={showVelocity ? "shown" : "hidden"}
        data-pinion-rotation-deg={pinionRotation.toFixed(2)}
        data-physics-rule={physicsRule}
        data-velocity-magnitude={velocityMagnitude.toFixed(3)}
        data-force-magnitude={forceMagnitude.toFixed(3)}
        data-friction-coefficient={frictionCoefficient.toFixed(3)}
        data-friction-magnitude={frictionMagnitude.toFixed(3)}
        data-constraint-error={constraintError.toFixed(3)}
        data-camera-label={cameraLabel}
        data-anchor-pick-mode="three-raycaster-plane"
        data-three-hole-mode="extruded-cut-through"
        data-three-render-loop="camera-only-orbit"
        data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
        data-three-animation-commit-ms={FOUNDRY_ANIMATION_COMMIT_MS.toFixed(1)}
        data-three-dynamic-build-count={dynamicBuildCountRef.current}
        data-three-geometry-cache-size={geometryCacheRef.current.size}
        data-three-material-cache-size={materialCacheRef.current.size}
        data-three-static-grid-mode="persistent-scene-layer"
        data-three-fit-bounds="phase-invariant-sweep"
        data-three-inventory-source="rendered-template"
        data-three-stack-source="fabricationStackForMechanism"
        data-three-stack-mode="assembled-spacer-separated"
        data-three-exploded={explode > 0 ? "true" : "false"}
        data-three-explode-percent={Math.round(explode * 100)}
        data-three-pin-z-min={pinBottomZ.toFixed(2)}
        data-three-pin-z-max={pinTopZ.toFixed(2)}
        data-three-pin-length={pinLengthZ.toFixed(2)}
        data-three-spacer-z-gap={stackZGap.toFixed(2)}
        data-three-base-layer={renderPlan.base.label}
        data-three-stack-order={renderPlan.stackSummary}
        data-three-stack-occurrences={renderPlan.occurrenceSummary}
        data-three-stack-roles={renderPlan.roleSummary}
        data-three-stack-colors={renderPlan.colorSummary}
        data-three-stack-z={renderPlan.zSummary}
        data-three-stack-layer-count={renderPlan.layers.length}
        data-three-rendered-layer-labels={renderPlan.layers
          .map((item) => item.label)
          .join(" → ")}
        data-three-rendered-layer-roles={renderPlan.layers
          .map((item) => item.renderKind)
          .join(">")}
        data-three-rendered-layer-colors={renderPlan.layers
          .map((item) => item.color)
          .join(",")}
        data-three-rendered-layer-z={renderedLayerZ
          .map((z) => z.toFixed(2))
          .join(",")}
        data-three-geometry-contract={renderPlan.layers
          .map((item) =>
            foundryLayerGeometryContract(
              mechanism.type,
              item.label,
              item.renderKind,
            ),
          )
          .join(" → ")}
        data-three-stack-validation-errors={renderPlan.validationErrors.length}
        data-three-physical-validation-errors={physicalValidationErrors.length}
        data-three-physical-validation-summary={physicalValidationSummary}
        data-three-preview-renderable={
          renderPlan.validationErrors.length || physicalValidationErrors.length
            ? "blocked"
            : "ready"
        }
        className="foundry-three-scene-state"
      />
      {children}
    </div>
  );
};

const MechanismLinkagePreview = ({
  mechanism,
  simulation,
  kit,
  testId,
  compact = false,
}: {
  mechanism: MechanismConfig;
  simulation: ReturnType<typeof fitMechanismSimulation>;
  kit: PhysicalKitSettings;
  testId: string;
  compact?: boolean;
}) => {
  const s = simulation.state;
  const r = compact ? 2.5 : 4;
  const depth = compact ? 2.2 : 5.5;
  const thicknessTestId = compact ? undefined : "foundry-material-thickness";
  const scaled = (length: number, min: number, max: number) =>
    Math.max(min, Math.min(max, length * simulation.scale));
  const test = (name: string) =>
    compact ? undefined : `foundry-mechanism-${name}`;
  const templateTest = compact
    ? undefined
    : `foundry-template-${mechanism.type}`;
  const fabricationTest = (name: string) =>
    compact ? undefined : `foundry-fabrication-${name}`;
  const radius = (
    length: number,
    min = compact ? 8 : 16,
    max = compact ? 28 : 58,
  ) => scaled(Math.max(1, length), min, max);
  const holeR = Math.max(
    compact ? 1.8 : 2.6,
    Math.min(
      compact ? 3.4 : 5.6,
      FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM * simulation.scale,
    ),
  );
  const pitch = Math.max(
    holeR * 3.5,
    kit.gridPitchMm * SCENE_PX_PER_MM * simulation.scale,
  );
  const barWidth = Math.max(
    FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * simulation.scale,
    holeR * 3.5,
    compact ? 8 : 14,
  );
  const axisForAngle = (deg: number) => ({
    x: Math.cos(degToRad(deg)),
    y: -Math.sin(degToRad(deg)),
  });
  const trackAxis = axisForAngle(mechanism.groundAngle ?? 0);
  const normalAxis = { x: -trackAxis.y, y: trackAxis.x };
  const inputReferencePoint = mechanism.type === "cam" && s.aux ? s.aux : s.j1;
  const inputAngleDeg =
    (Math.atan2(
      inputReferencePoint.y - s.p1.y,
      inputReferencePoint.x - s.p1.x,
    ) *
      180) /
    Math.PI;
  const outputAngleDeg =
    (Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x) * 180) / Math.PI;
  const isGearTrainPreview =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const previewGearRadii = isGearTrainPreview
    ? gearTrainPitchRadii(mechanism)
    : [];
  const previewGearCenters = isGearTrainPreview
    ? fittedGearTrainCenters(previewGearRadii, s.p1, s.p2)
    : [];
  const vectorAxis = (
    a: Point | undefined,
    b: Point | undefined,
    fallback = trackAxis,
  ) => {
    if (!a || !b) return fallback;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len > 0.5 ? { x: dx / len, y: dy / len } : fallback;
  };
  const link = (
    a: Point | undefined,
    b: Point | undefined,
    key: string,
    className = "mechanism-link",
    testIdName?: string,
  ) => {
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.5) return null;
    const sceneLength = len / Math.max(0.0001, simulation.scale);
    const minHoleCount =
      key === "coupler"
        ? 4
        : key.includes("carrier") ||
            key === "frame" ||
            key === "driver" ||
            key === "output"
          ? 3
          : 2;
    const linkageSpec = fabricationLinkageSpecForSceneLength(
      sceneLength,
      kit.gridPitchMm,
      minHoleCount,
    );
    const templateLen =
      linkageSpec.lengthMm * SCENE_PX_PER_MM * simulation.scale;
    const outlineLen = templateLen + barWidth;
    const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
    const holeXs = linkageSpec.holeCentersMm.map(
      (point) =>
        (point.x - firstHoleX - linkageSpec.lengthMm / 2) *
        SCENE_PX_PER_MM *
        simulation.scale,
    );
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (
      <g
        key={key}
        data-testid={testIdName ? test(testIdName) : undefined}
        className={`mechanism-part ${className}`}
        transform={`translate(${mid.x} ${mid.y}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-outlineLen / 2 + depth}
          y={-barWidth / 2 + depth}
          width={outlineLen}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("part")}
          className="mechanism-face"
          x={-outlineLen / 2}
          y={-barWidth / 2}
          width={outlineLen}
          height={barWidth}
          rx={barWidth / 2}
        />
        {holeXs.map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const guideAxis = (
    center: Point,
    axis: Point,
    key: string,
    reach = compact ? 42 : 95,
    endStops = false,
  ) => {
    const len = Math.hypot(axis.x, axis.y) || 1;
    const ux = axis.x / len;
    const uy = axis.y / len;
    const start = { x: center.x - ux * reach, y: center.y - uy * reach };
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    return (
      <g
        key={key}
        data-testid={test("guide")}
        className="mechanism-part mechanism-frame"
        transform={`translate(${start.x} ${start.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={depth}
          y={-barWidth / 2 + depth}
          width={reach * 2}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-face"
          x="0"
          y={-barWidth / 2}
          width={reach * 2}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          className="mechanism-slot"
          x={barWidth * 0.8}
          y={-holeR}
          width={Math.max(holeR * 2, reach * 2 - barWidth * 1.6)}
          height={holeR * 2}
          rx={holeR}
        />
        {endStops &&
          [0, reach * 2].map((x, index) => (
            <rect
              key={`stop-${index}`}
              data-testid={fabricationTest("end-stop")}
              className="mechanism-end-stop"
              x={x - holeR}
              y={-barWidth * 0.85}
              width={holeR * 2}
              height={barWidth * 1.7}
              rx={holeR * 0.45}
            />
          ))}
        {[0, reach * 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const guide = (center: Point, a: Point, b: Point, key: string) =>
    guideAxis(center, vectorAxis(a, b), key);
  const slotPlate = (
    center: Point,
    axis: Point,
    length: number,
    key: string,
    className = "mechanism-link",
    testIdName?: string,
  ) => {
    const len = Math.max(length, barWidth * 3);
    const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    return (
      <g
        key={key}
        data-testid={testIdName ? test(testIdName) : undefined}
        className={`mechanism-part ${className}`}
        transform={`translate(${center.x} ${center.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-len / 2 + depth}
          y={-barWidth / 2 + depth}
          width={len}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("part")}
          className="mechanism-face"
          x={-len / 2}
          y={-barWidth / 2}
          width={len}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-slot"
          x={-len / 2 + barWidth * 0.75}
          y={-holeR}
          width={len - barWidth * 1.5}
          height={holeR * 2}
          rx={holeR}
        />
        {[-len / 2, len / 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const pins = (
    mechanism.type === "cam" ? [s.p1, s.j2] : [s.p1, s.p2, s.j1, s.j2, s.aux]
  ).filter((point): point is Point => Boolean(point));
  const gear = (
    center: Point,
    length: number,
    className: string,
    key: string,
    min = compact ? 8 : 16,
    max = compact ? 34 : 62,
    rotation = 0,
  ) => {
    const pitchRadius = radius(length, min, max);
    const gearProfile = fabricationGearProfileForPitchRadius(
      pitchRadius,
      pitchRadius / SCENE_PX_PER_MM,
    );
    return (
      <g
        key={key}
        data-mechanism-gear-key={key}
        data-rotation-deg={rotation.toFixed(2)}
        className={`mechanism-gear-part ${className}`}
        transform={`translate(${center.x} ${center.y}) rotate(${rotation})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={gearPathD(pitchRadius)}
        />
        <path
          data-testid={fabricationTest("gear")}
          className="mechanism-gear-teeth mechanism-face"
          d={gearPathD(pitchRadius)}
        />
        <circle
          data-testid={fabricationTest("hole")}
          className="mechanism-hole axle-hole"
          cx="0"
          cy="0"
          r={holeR}
        />
        {gearProfile.attachmentHoleCenters.map((point, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={point.x}
            cy={point.y}
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const ringGear = (
    center: Point,
    length: number,
    className: string,
    key: string,
  ) => {
    const pitchRadius = radius(length, compact ? 18 : 34, compact ? 62 : 120);
    const ringProfile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    return (
      <g
        key={key}
        data-mechanism-gear-key={key}
        className={`mechanism-gear-part ${className}`}
        transform={`translate(${center.x} ${center.y})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={fabricationRingGearPathD(pitchRadius)}
          fillRule="evenodd"
        />
        <path
          data-testid={fabricationTest("gear")}
          className="mechanism-gear-teeth mechanism-face"
          d={fabricationRingGearPathD(pitchRadius)}
          fillRule="evenodd"
        />
        {ringProfile.mountHoleCenters.map((point, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={point.x}
            cy={point.y}
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const rackPlate = (
    center: Point,
    axis: Point,
    length: number,
    key: string,
  ) => {
    const len = Math.max(length, barWidth * 6);
    const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    const toothCount = Math.max(
      8,
      Math.min(24, Math.round(len / Math.max(holeR * 2.4, 4))),
    );
    const step = len / toothCount;
    const teeth = Array.from({ length: toothCount }, (_, index) => {
      const x = -len / 2 + index * step;
      return `M ${x} ${-barWidth / 2} L ${x + step / 2} ${-barWidth / 2 - holeR * 1.2} L ${x + step} ${-barWidth / 2}`;
    }).join(" ");
    return (
      <g
        key={key}
        data-testid={test("rack")}
        className="mechanism-part mechanism-output"
        transform={`translate(${center.x} ${center.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-len / 2 + depth}
          y={-barWidth / 2 + depth}
          width={len}
          height={barWidth}
          rx={barWidth / 5}
        />
        <rect
          data-testid={fabricationTest("rack")}
          className="mechanism-face"
          x={-len / 2}
          y={-barWidth / 2}
          width={len}
          height={barWidth}
          rx={barWidth / 5}
        />
        <path className="mechanism-rack-teeth" d={teeth} />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-slot"
          x={-len / 2 + barWidth * 0.8}
          y={-holeR}
          width={len - barWidth * 1.6}
          height={holeR * 2}
          rx={holeR}
        />
        {[-len / 2, 0, len / 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const camProfile = (center: Point, length: number) => {
    const base = radius(length, compact ? 10 : 20, compact ? 34 : 66);
    const points = Array.from({ length: 42 }, (_, index) => {
      const angle = (index / 42) * Math.PI * 2;
      const lift = sampledCamProfileScale(angle, mechanism.camProfileSamples);
      return `${Math.cos(angle) * base * lift} ${Math.sin(angle) * base * lift}`;
    });
    return (
      <g
        key="cam-body"
        data-testid={fabricationTest("cam")}
        className="mechanism-part mechanism-cam"
        transform={`translate(${center.x} ${center.y}) rotate(${inputAngleDeg})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={`M ${points.join(" L ")} Z`}
        />
        <path
          className="mechanism-cam-profile mechanism-face"
          d={`M ${points.join(" L ")} Z`}
        />
        <circle
          data-testid={fabricationTest("hole")}
          className="mechanism-hole axle-hole"
          cx="0"
          cy="0"
          r={holeR}
        />
        <circle className="mechanism-hole" cx={base * 0.45} cy="0" r={holeR} />
      </g>
    );
  };
  const followerBlock = (center: Point) => (
    <g
      key="follower"
      data-testid={fabricationTest("follower")}
      className="mechanism-part mechanism-output"
      transform={`translate(${center.x} ${center.y}) rotate(${(Math.atan2(normalAxis.y, normalAxis.x) * 180) / Math.PI})`}
    >
      <rect
        data-testid={thicknessTestId}
        className="mechanism-thickness"
        x={-barWidth * 1.35 + depth}
        y={-barWidth / 2 + depth}
        width={barWidth * 2.7}
        height={barWidth}
        rx={barWidth / 3}
      />
      <rect
        data-testid={fabricationTest("part")}
        className="mechanism-face"
        x={-barWidth * 1.35}
        y={-barWidth / 2}
        width={barWidth * 2.7}
        height={barWidth}
        rx={barWidth / 3}
      />
      <circle
        data-testid={fabricationTest("hole")}
        className="mechanism-hole"
        cx="0"
        cy="0"
        r={holeR}
      />
    </g>
  );
  const gearPreview = (mechanism.type === "gear" ||
    mechanism.type === "gear_linkage" ||
    mechanism.type === "planetary_gear" ||
    mechanism.type === "rack-pinion") && (
    <g data-testid={test("gear")}>
      {mechanism.type === "rack-pinion" && (
        <>
          {gear(
            s.p1,
            mechanism.crankLength,
            "mechanism-driver",
            "rack-pinion-gear",
            compact ? 8 : 16,
            compact ? 34 : 62,
            inputAngleDeg,
          )}
        </>
      )}
      {isGearTrainPreview && (
        <>
          {previewGearRadii.map((radiusValue, index) => {
            const isCoupledGear = previewGearRadii.length > 2 || index === 0;
            const ratio = isCoupledGear
              ? index === 0
                ? 1
                : ((index % 2 === 1 ? -1 : 1) * previewGearRadii[0]) /
                  radiusValue
              : 0;
            return gear(
              previewGearCenters[index] ?? (index === 0 ? s.p1 : s.p2),
              radiusValue,
              index === 0
                ? "mechanism-driver"
                : index === previewGearRadii.length - 1
                  ? "mechanism-link secondary"
                  : "mechanism-link",
              `gear-${index}`,
              compact ? 8 : 16,
              compact ? 34 : 62,
              inputAngleDeg * ratio +
                (index === previewGearRadii.length - 1
                  ? ((mechanism.phase ?? 0) * 180) / Math.PI
                  : 0),
            );
          })}
        </>
      )}
      {mechanism.type === "planetary_gear" && (
        <>
          {ringGear(
            s.p1,
            planetaryRingPitchRadius(mechanism),
            "mechanism-frame carrier",
            "ring",
          )}
          {gear(
            s.p1,
            mechanism.crankLength,
            "mechanism-driver",
            "sun",
            compact ? 7 : 12,
            compact ? 22 : 42,
            inputAngleDeg,
          )}
          {(() => {
            const planetCenters = [s.p2];
            const planetCount = Math.max(1, planetCenters.length);
            return planetCenters.map((center, index) =>
              gear(
                center,
                mechanism.rockerLength,
                "mechanism-link secondary",
                `planet-${index + 1}`,
                compact ? 7 : 12,
                compact ? 22 : 42,
                outputAngleDeg + index * (360 / planetCount),
              ),
            );
          })()}
        </>
      )}
    </g>
  );
  const links = (() => {
    if (mechanism.type === "crank")
      return [
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "4bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
        link(s.p2, s.j2, "rocker", "mechanism-link"),
      ];
    if (mechanism.type === "5bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver-a", "mechanism-driver", "driver"),
        link(s.p2, s.aux, "driver-b", "mechanism-driver"),
        link(s.j1, s.j2, "rod-a", "mechanism-link", "link"),
        link(s.aux, s.j2, "rod-b", "mechanism-link"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "6bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
        link(s.p2, s.j2, "rocker", "mechanism-link"),
        link(s.j2, s.aux, "dyad", "mechanism-link"),
        link(s.p2, s.aux, "follower", "mechanism-output", "output"),
      ];
    if (mechanism.type === "piston")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "slider-link", "mechanism-link", "link"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "yoke")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        slotPlate(
          s.j2,
          normalAxis,
          radius(mechanism.crankLength, compact ? 28 : 54, compact ? 72 : 130),
          "yoke-slot",
          "mechanism-link",
          "link",
        ),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "cam")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        camProfile(s.p1, mechanism.crankLength),
        followerBlock(s.j2),
      ];
    if (mechanism.type === "rack-pinion") {
      const rackAxis = vectorAxis(s.j2, s.effector, trackAxis);
      const rawInputAngle =
        ((-Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x) % (Math.PI * 2)) +
          Math.PI * 2) %
        (Math.PI * 2);
      const travel =
        Math.max(1, mechanism.crankLength) *
        (rawInputAngle - Math.PI) *
        simulation.scale;
      const fixedGuideCenter = {
        x: s.j2.x - rackAxis.x * travel,
        y: s.j2.y - rackAxis.y * travel,
      };
      const rackVisualLength = radius(
        mechanism.rockerLength,
        compact ? 56 : 120,
        compact ? 160 : 340,
      );
      return [
        guideAxis(
          fixedGuideCenter,
          rackAxis,
          "guide",
          rackVisualLength / 2 +
            radius(mechanism.crankLength, compact ? 8 : 16, compact ? 34 : 62),
          true,
        ),
        rackPlate(s.j2, rackAxis, rackVisualLength, "rack"),
        link(s.p1, s.j1, "pinion-radius", "mechanism-driver", "driver"),
        link(s.j2, s.effector, "rack-output", "mechanism-output", "output"),
      ];
    }
    if (mechanism.type === "quick-return")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        slotPlate(
          { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 },
          vectorAxis(s.p2, s.j2),
          Math.hypot(s.j2.x - s.p2.x, s.j2.y - s.p2.y),
          "slotted-rocker",
          "mechanism-link",
          "link",
        ),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "gear") return [];
    if (mechanism.type === "gear_linkage")
      return [
        link(
          s.j1,
          s.effector,
          "drive-l4-linkage",
          "mechanism-driver",
          "driver",
        ),
        link(
          s.j2,
          s.effector,
          "output-l4-linkage",
          "mechanism-output",
          "output",
        ),
        slotPlate(
          s.effector,
          vectorAxis(s.j2, s.effector),
          barWidth * 3.2,
          "output-bracket",
          "mechanism-output",
          "output",
        ),
      ];
    if (mechanism.type === "planetary_gear") {
      const planetCenters = [s.p2];
      return [
        ...planetCenters.map((center, index) =>
          link(
            s.p1,
            center,
            `carrier-${index + 1}`,
            "mechanism-driver",
            index === 0 ? "driver" : undefined,
          ),
        ),
        link(s.p2, s.effector, "carrier-output", "mechanism-output", "output"),
      ];
    }
    return [
      link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
      link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
      link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
      link(s.j2, s.p2, "rocker", "mechanism-link"),
      link(s.j1, s.effector, "output", "mechanism-output", "output"),
    ];
  })();
  const referenceRecipe = referenceRecipeForType(mechanism.type);
  const referenceCoordRoles = referenceRecipe.assemblySteps
    .flatMap((step) =>
      step.coords.map(
        (coord, index) =>
          `${coord}:${step.coordRoles[index] ?? "moving_reference"}`,
      ),
    )
    .join("|");
  return (
    <g
      data-testid={testId}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      data-mechanism-type={mechanism.type}
      data-reference-canonical-key={referenceRecipe.canonicalKey}
      data-reference-topology={mechanismReferenceTopologySummary(
        mechanism.type,
      )}
      data-reference-stack-labels={referenceRecipe.stackLabels.join(" → ")}
      data-reference-coord-roles={referenceCoordRoles}
      data-reference-export-ready={
        referenceRecipe.exportReady ? "true" : "false"
      }
    >
      <g data-testid={templateTest}>
        {gearPreview}
        {links}
        {pins.map((point, i) => (
          <circle
            key={i}
            className="mechanism-pin"
            cx={point.x}
            cy={point.y}
            r={r}
          />
        ))}
        <circle
          data-testid={test("output-point")}
          className="mechanism-effector"
          cx={s.effector.x}
          cy={s.effector.y}
          r={r + 2}
        />
      </g>
    </g>
  );
};

export default App;

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AssemblyWorkbench,
  CharacterAssemblyWorkbench,
} from "./components/stages/assembly/AssemblyWorkbench";
import { BlueprintExport } from "./components/stages/blueprint/BlueprintExport";
import { CharacterSelection } from "./components/stages/character/CharacterSelection";
import { PathEditor } from "./components/stages/path/PathEditor";
import { MechanismParametricEditor } from "./components/stages/mechanism/MechanismParametricEditor";
import { MechanismLinkagePreview } from "./components/stages/foundry/MechanismLinkagePreview";
import { ThreeFoundryPreview } from "./components/stages/foundry/ThreeFoundryPreview";
import {
  foundryAssemblyPinPoints,
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
  isMovingRenderKind,
} from "./components/stages/foundry/foundryPreviewStacks";
import {
  clampMechanismParam,
  MECHANISM_PARAM_META,
  shouldShowMechanismParam,
} from "./components/stages/mechanism/mechanismParamPolicy";
import { MechanismRecommendationSheet } from "./components/stages/path/MechanismRecommendationSheet";
import { processingLabel } from "./components/stages/character/ProgressBlock";
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
  FoundryExportPackage,
  GlobalConfig,
  MechanismConfig,
  MechanismType,
  Point,
  ProjectMotionPath,
  ProjectState,
  ProjectAction,
} from "./types";
import { generateDXF, generateSVG } from "./utils/exporter";
import {
  animationDeltaRadians,
  calculateLinkage,
  generateCurvePoints,
  generateMechanismPointTraces,
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
  createFabricationPackage,
  FABRICATION_RENDER_LAYER_Z_STEP,
  fabricationBoardCoordinateCallout,
  fabricationPartDisplayLabel,
  fabricationRenderPlanForMechanism,
  fabricationStackSummary,
  readableFabricationStackSummary,
  sampleFeasibleRange,
  validateForFabrication,
} from "./utils/fabrication";
import {
  boardToScene,
  bodyPartPivotScene,
  physicalKitPreset,
  sceneToBoard,
  SCENE_VIEW,
} from "./utils/coordinates";
import { loadCharacterPackage } from "./utils/packageLoader";
import {
  animatedPartsForProject,
  describeMotionChain,
  mechanismBindingWarnings,
  motionAnchorJointIds,
  motionChainOptionLabel,
  preferredMotionJointId,
} from "./utils/motion";
import {
  clampCanvasZoom,
  DEFAULT_CANVAS_VIEWPORT,
  normalizeCanvasViewport,
} from "./utils/viewport";
import { formatGridLabel, formatGridReadout } from "./utils/units";
import {
  VIEWER3D_CONTRACT_VERSION,
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
} from "./utils/mechanismReference";
import {
  createMechanismFitContext,
  fitMechanismSimulation,
  fitMechanismSimulationWithContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "./utils/mechanismPreview";
import {
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "./utils/mechanismRecommendations";
import {
  Boxes,
  Download,
  Loader2,
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
    const fallback =
      status.stage === "checking" ? 8 : status.stage === "error" ? 100 : 0;
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
    editorStage === "path" ||
    editorStage === "design" ||
    editorStage === "assembly";
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
          onLesson={(lessonId) =>
            openClassroomLesson(lessonId as ClassroomLessonId)
          }
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
        clampMechanismParam("crankLength", sceneDistance(s.p1, point)),
      );
      return;
    }
    if (handle === "D") {
      updateFoundryParams({
        groundLength: clampMechanismParam(
          "groundLength",
          sceneDistance(s.p1, point),
        ),
        groundAngle:
          (Math.atan2(point.y - s.p1.y, point.x - s.p1.x) * 180) / Math.PI,
      });
      return;
    }
    updateFoundryParams({
      couplerLength: clampMechanismParam(
        "couplerLength",
        sceneDistance(s.j1, point),
      ),
      rockerLength: clampMechanismParam(
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
                      <small>
                        {item.classroomSensemaking.directTranslation}
                      </small>
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
                {MECHANISM_PARAM_META.filter((p) =>
                  shouldShowMechanismParam(foundry.type, p.key),
                ).map((p) => (
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
                ))}
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
                  data-sensemaking-check={
                    selectedLibrary.classroomSensemaking.studentCheck
                  }
                  data-sensemaking-answer={
                    selectedLibrary.classroomSensemaking.expectedAnswer
                  }
                  data-sensemaking-evidence={
                    selectedLibrary.classroomSensemaking.evidenceCue
                  }
                  data-sensemaking-clip={
                    selectedLibrary.classroomSensemaking.clipSlot
                  }
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
                {MECHANISM_PARAM_META.filter((p) =>
                  shouldShowMechanismParam(selectedMechanism.type, p.key),
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
  const selectedSensemaking =
    activeAssemblyMode === "mechanism" && selectedRecipe
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
  }, [
    activeAssemblyMode,
    selectedRecipe?.mechanismId,
    lane,
    setPlaying,
    setStepIndex,
    setStepProgress,
  ]);
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
        setStepIndex((index) => (index >= activeStepCount - 1 ? 0 : index + 1));
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
                {hasCharacterAssembly
                  ? "Choose Character."
                  : "Add a character first."}
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
                  <div
                    className="warn mt-3"
                    data-testid="character-pin-blocker"
                  >
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
                      <div className="ok mt-3">
                        {currentCharacterStep.check}
                      </div>
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



export default App;

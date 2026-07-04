import React, { useEffect, useMemo, useRef, useState } from "react";
import { AssemblyGuide } from "./components/stages/assembly/AssemblyGuide";
import { BlueprintExport } from "./components/stages/blueprint/BlueprintExport";
import { CharacterSelection } from "./components/stages/character/CharacterSelection";
import { PathEditor } from "./components/stages/path/PathEditor";
import { MechanismFoundry } from "./components/stages/foundry/MechanismFoundry";
import { Options } from "./components/stages/options/Options";
import { MechanismParametricEditor } from "./components/stages/mechanism/MechanismParametricEditor";
import { ThreeFoundryPreview } from "./components/stages/foundry/ThreeFoundryPreview";
import {
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
  sampleFeasibleRange,
  validateForFabrication,
} from "./utils/fabrication";
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
import {
  commandIdForKeyboardEvent,
  type AppCommandId,
} from "./utils/appCommands";
import { createAppCommandHandlers } from "./utils/appCommandHandlers";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "./utils/foundryCamera";
import {
  AUTHORABLE_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  mechanismTemplateLabel,
} from "./utils/mechanismTemplates";
import {
  createMechanismFitContext,
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

export default App;

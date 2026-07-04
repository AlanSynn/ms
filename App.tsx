import React, { useEffect, useMemo, useRef, useState } from "react";
import { AssemblyGuide } from "./components/stages/assembly/AssemblyGuide";
import { BlueprintExport } from "./components/stages/blueprint/BlueprintExport";
import { CharacterSelection } from "./components/stages/character/CharacterSelection";
import { PathEditor } from "./components/stages/path/PathEditor";
import { MechanismFoundry } from "./components/stages/foundry/MechanismFoundry";
import { MechanismDesign } from "./components/stages/mechanism/MechanismDesign";
import { Options } from "./components/stages/options/Options";
import { MechanismRecommendationSheet } from "./components/stages/path/MechanismRecommendationSheet";
import { processingLabel } from "./components/stages/character/ProgressBlock";
import type { PendingCharacterReview } from "./components/stages/character/CharacterImportOverlays";
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
import { processImageWithWebOnnx } from "./utils/webOnnx";
import { validateForFabrication } from "./utils/fabrication";
import { loadCharacterPackage } from "./utils/packageLoader";
import {
  preferredMotionJointId,
} from "./utils/motion";
import {
  clampCanvasZoom,
  DEFAULT_CANVAS_VIEWPORT,
  normalizeCanvasViewport,
} from "./utils/viewport";
import {
  type AppCommandHandlerMap,
} from "./utils/appCommands";
import { createAppCommandHandlers } from "./utils/appCommandHandlers";
import { useAppCommandBindings } from "./hooks/useAppCommandBindings";
import { useAppOnnxBootstrap } from "./hooks/useAppOnnxBootstrap";
import {
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "./utils/mechanismRecommendations";
import { Download, Upload } from "lucide-react";
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
  const { onnxCacheStatus, setOnnxCacheStatus, cacheOnnxModel } =
    useAppOnnxBootstrap(setCommandStatus);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const latestProjectRef = useRef<ProjectState | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);

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
  }) satisfies AppCommandHandlerMap;
  useAppCommandBindings({ commandHandlers, disabled: modalOpen });
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

export default App;

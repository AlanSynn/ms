import React, { useRef, useState } from "react";
import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import type { AppStageRouterProps } from "./components/AppStageRouter";
import { processingLabel } from "./components/stages/character/ProgressBlock";
import type { PendingCharacterReview } from "./components/stages/character/CharacterImportOverlays";
import { STAGES, type StarterImageTemplate } from "./components/AppShell";
import { STARTER_IMAGE_TEMPLATES } from "./resources/starterImageTemplates";
import {
  AppStage,
  CanvasViewport,
  FoundryExportPackage,
  MechanismConfig,
  MechanismType,
  Point,
  ProjectMotionPath,
  ProjectState,
} from "./types";
import { generateDXF, generateSVG } from "./utils/exporter";
import {
  generateCurvePoints,
  generateMechanismPointTraces,
} from "./utils/kinematics";
import {
  evaluateFitness,
  generateSmartConfig,
  mutateConfig,
} from "./utils/optimizer";
import {
  CLASSROOM_LESSONS,
  classroomLessonById,
  createDefaultMechanism,
  createEmptyProject,
  createProjectFromProcessed,
  loadProjectSnapshot,
  downloadText,
  handoffGate,
  mechanismWithGeneratedPath,
  replaceCharacterProject,
  uid,
  validatePath,
} from "./utils/project";
import { processImageWithWebOnnx } from "./utils/webOnnx";
import { loadCharacterPackage } from "./utils/packageLoader";
import { preferredMotionJointId } from "./utils/motion";
import { DEFAULT_CANVAS_VIEWPORT } from "./utils/viewport";
import { useAppCommandBindings } from "./hooks/useAppCommandBindings";
import { useAppOnnxBootstrap } from "./hooks/useAppOnnxBootstrap";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useAppProjectCommands } from "./hooks/useAppProjectCommands";
import { useAppDerivedState } from "./hooks/useAppDerivedState";
import { useWorkspacePlayerDock } from "./hooks/useWorkspacePlayerDock";
import { useWorkspacePlaybackLoop } from "./hooks/useWorkspacePlaybackLoop";
import { useModalInertEffect } from "./hooks/useModalInertEffect";
import { workflowStatusFor } from "./utils/workflowStatus";
import {
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "./utils/mechanismRecommendations";

type FoundryState = MechanismConfig;

const App: React.FC = () => {
  const {
    project,
    setProject,
    dispatch,
    undoProject: undoProjectHistory,
    redoProject: redoProjectHistory,
  } = useProjectHistory(createEmptyProject);
  const [stage, setStage] = useState<AppStage>("character");
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [angle, setAngle] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
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
  const appShellRef = useRef<HTMLDivElement>(null);
  useProjectAutosave(project);

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
  const {
    sortedParts,
    selectedPart,
    selectedPath,
    selectedMechanism,
    playbackDurationMs,
    mechanismConfig,
  } = useAppDerivedState(project);
  const activeClassroomLesson = classroomLessonById(
    project.metadata.classroomLessonId,
  );
  useWorkspacePlaybackLoop({
    stage,
    isPlaying,
    drawMode,
    optimizerBusy,
    showGettingStarted,
    playbackDurationMs,
    animationSpeed: project.settings.animationSpeed,
    timingProfile: project.settings.timingProfile,
    setAngle,
    setDrawMode,
  });

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
  const { commandHandlers, openClassroomLesson, openSampleProject } =
    useAppProjectCommands({
      project,
      stage,
      canvasViewport,
      setProject,
      dispatch,
      undoProjectHistory,
      redoProjectHistory,
      setStage,
      setFoundry,
      setAngle,
      setIsPlaying,
      setCanvasViewport,
      setPendingCharacter,
      setShowGettingStarted,
      setShowAbout,
      setShowShortcuts,
      setCommandStatus,
      openProjectPicker: () => projectInputRef.current?.click(),
      goStage,
    });
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
  const {
    playerDock,
    assemblyStepIndex,
    setAssemblyStepIndex,
    assemblyStepProgress,
    setAssemblyStepProgress,
    assemblyPlaying,
    setAssemblyPlaying,
    setAssemblyStepCount,
  } = useWorkspacePlayerDock({
    editorStage,
    modalOpen,
    isPlaying,
    setIsPlaying,
    angle,
    setAngle,
    speed: project.settings.animationSpeed,
    drawMode,
  });

  const acceptPendingCharacter = () => {
    if (!pendingCharacter) return;
    setProject(pendingCharacter.project, { resetHistory: true });
    setPendingCharacter(null);
    setShowGettingStarted(false);
    setStage(pendingCharacter.returnStage);
  };

  const exportFoundryMechanism = (pkg: FoundryExportPackage) => {
    const existingTarget = project.mechanisms.find(
      (mechanism) =>
        mechanism.targetPartId === pkg.targetPartId &&
        mechanism.targetPathId === pkg.targetPathId &&
        preferredMotionJointId(
          project,
          mechanism.targetPartId,
          mechanism.targetAnchorJointId,
        ) === pkg.targetAnchorJointId,
    );
    const activeVisualPartIds = selectedPart ? [selectedPart.id] : [];
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
        activeVisualPartIds,
      },
      { preserveGeneratedPath: true },
    );
    const fittedMechanism = pkg.targetPathId
      ? fitMechanismToTargetPath(project, rawMechanism, pkg.targetPathId)
      : fitRecommendedMechanismToSheet(project, rawMechanism);
    const generatedPath =
      fittedMechanism.generatedPath ??
      rawMechanism.generatedPath ??
      pkg.generatedPath;
    const mechanism = mechanismWithGeneratedPath(
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
        activeVisualPartIds,
      },
      { preserveGeneratedPath: true },
    );
    dispatch({ type: "set_foundry_export", foundryExport: pkg });
    dispatch({ type: "upsert_mechanism", mechanism });
    setStage("design");
  };

  useModalInertEffect(appShellRef, modalOpen);

  const startFromStarterImage = (template: StarterImageTemplate) => {
    setShowGettingStarted(false);
    loadStarterImage(template);
  };
  const startFromPackage = (files: FileList | File[]) => {
    setShowGettingStarted(false);
    importCharacterPackage(files);
  };
  const startFromImage = (file: File) => {
    setShowGettingStarted(false);
    runWebOnnx(file);
  };
  const startFromProject = (file: File) => {
    setShowGettingStarted(false);
    importProject(file);
  };
  const applyRecommendedMechanism = (mechanism: MechanismConfig) => {
    dispatch({ type: "upsert_mechanism", mechanism });
    setShowRecommendations(false);
    setStage("design");
  };
  const transferTrackedPath = (path: Point[]) => {
    setPathPoints(path, "tracked");
    setShowTracking(false);
    setStage("path");
  };
  const stageLabel =
    STAGES.find((item) => item.id === editorStage)?.label ?? editorStage;
  const workflowStatus = workflowStatusFor(
    editorStage,
    stageLabel,
    project,
    selectedPart,
    selectedPath,
  );

  const stageRouterProps: AppStageRouterProps = {
    editorStage,
    project,
    dispatch,
    goStage,
    playerDock,
    pendingCharacter,
    replaceCharacter,
    setReplaceCharacter,
    onOpenGettingStarted: () => setShowGettingStarted(true),
    onAcceptPendingCharacter: acceptPendingCharacter,
    onDiscardPendingCharacter: () => setPendingCharacter(null),
    onProcessCharacter: runWebOnnx,
    onPackageCharacter: importCharacterPackage,
    onImportProject: importProject,
    onEditCharacter: editCharacterParts,
    onSaveSkeleton: saveSkeleton,
    activeClassroomLesson,
    resetLesson: commandHandlers["project.resetLesson"],
    sortedParts,
    selectedPart,
    selectedPath,
    drawMode,
    setDrawMode,
    setPathPoints,
    openTracking: () => setShowTracking(true),
    isPlaying,
    setIsPlaying,
    angle,
    setAngle,
    viewport: canvasViewport,
    setViewport: setCanvasViewport,
    foundry,
    setFoundry,
    onFoundryExport: exportFoundryMechanism,
    selectedMechanism,
    updateMechanism,
    showTrace,
    setShowTrace,
    onOptimize: optimizeSelectedMechanism,
    onRecommendations: () => setShowRecommendations(true),
    optimizerBusy,
    exportSvg: exportMechanismSvg,
    exportDxf: exportMechanismDxf,
    assemblyStepIndex,
    setAssemblyStepIndex,
    assemblyStepProgress,
    setAssemblyStepProgress,
    assemblyPlaying,
    setAssemblyPlaying,
    setAssemblyStepCount,
  };

  return (
    <AppWorkspaceShell
      themeClass={themeClass}
      appShellRef={appShellRef}
      projectInputRef={projectInputRef}
      project={project}
      stage={stage}
      goStage={goStage}
      commandHandlers={commandHandlers}
      importProject={importProject}
      stageRouterProps={stageRouterProps}
      workflowStatus={workflowStatus}
      commandStatus={commandStatus}
      onnxCacheStatus={onnxCacheStatus}
      cacheOnnxModel={cacheOnnxModel}
      showGettingStarted={showGettingStarted}
      starterTemplates={STARTER_IMAGE_TEMPLATES}
      guidedLessons={CLASSROOM_LESSONS}
      onLesson={openClassroomLesson}
      onStarterImage={startFromStarterImage}
      onSample={openSampleProject}
      onPackage={startFromPackage}
      onProcess={startFromImage}
      onImport={startFromProject}
      onCloseGettingStarted={closeGettingStarted}
      showShortcuts={showShortcuts}
      onCloseShortcuts={() => setShowShortcuts(false)}
      showAbout={showAbout}
      onCloseAbout={() => setShowAbout(false)}
      showRecommendations={showRecommendations}
      onCloseRecommendations={() => setShowRecommendations(false)}
      onApplyRecommendation={applyRecommendedMechanism}
      showTracking={showTracking}
      onCloseTracking={() => setShowTracking(false)}
      onTransferTracking={transferTrackedPath}
    />
  );
};

export default App;

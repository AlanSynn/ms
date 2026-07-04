import React, { useEffect, useRef, useState } from "react";
import { AppStageRouter } from "./components/AppStageRouter";
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
  FoundryExportPackage,
  MechanismConfig,
  MechanismType,
  Point,
  ProjectMotionPath,
  ProjectState,
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
import { validateForFabrication } from "./utils/fabrication";
import { loadCharacterPackage } from "./utils/packageLoader";
import { preferredMotionJointId } from "./utils/motion";
import { DEFAULT_CANVAS_VIEWPORT } from "./utils/viewport";
import { useAppCommandBindings } from "./hooks/useAppCommandBindings";
import { useAppOnnxBootstrap } from "./hooks/useAppOnnxBootstrap";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useAppProjectCommands } from "./hooks/useAppProjectCommands";
import { useAppDerivedState } from "./hooks/useAppDerivedState";
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
                  <button
                    className="btn-secondary"
                    onClick={commandHandlers["project.save"]}
                  >
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

          <AppStageRouter
            editorStage={editorStage}
            project={project}
            dispatch={dispatch}
            goStage={goStage}
            playerDock={playerDock}
            pendingCharacter={pendingCharacter}
            replaceCharacter={replaceCharacter}
            setReplaceCharacter={setReplaceCharacter}
            onOpenGettingStarted={() => setShowGettingStarted(true)}
            onAcceptPendingCharacter={acceptPendingCharacter}
            onDiscardPendingCharacter={() => setPendingCharacter(null)}
            onProcessCharacter={runWebOnnx}
            onPackageCharacter={importCharacterPackage}
            onImportProject={importProject}
            onEditCharacter={editCharacterParts}
            onSaveSkeleton={saveSkeleton}
            activeClassroomLesson={activeClassroomLesson}
            resetLesson={commandHandlers["project.resetLesson"]}
            sortedParts={sortedParts}
            selectedPart={selectedPart}
            selectedPath={selectedPath}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            setPathPoints={setPathPoints}
            openTracking={() => setShowTracking(true)}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            angle={angle}
            setAngle={setAngle}
            viewport={canvasViewport}
            setViewport={setCanvasViewport}
            foundry={foundry}
            setFoundry={setFoundry}
            onFoundryExport={exportFoundryMechanism}
            selectedMechanism={selectedMechanism}
            updateMechanism={updateMechanism}
            showTrace={showTrace}
            setShowTrace={setShowTrace}
            onOptimize={optimizeSelectedMechanism}
            onRecommendations={() => setShowRecommendations(true)}
            optimizerBusy={optimizerBusy}
            exportSvg={exportMechanismSvg}
            exportDxf={exportMechanismDxf}
            assemblyStepIndex={assemblyStepIndex}
            setAssemblyStepIndex={setAssemblyStepIndex}
            assemblyStepProgress={assemblyStepProgress}
            setAssemblyStepProgress={setAssemblyStepProgress}
            assemblyPlaying={assemblyPlaying}
            setAssemblyPlaying={setAssemblyPlaying}
            setAssemblyStepCount={setAssemblyStepCount}
          />
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
          onLesson={openClassroomLesson}
          onStarterImage={(template) => {
            setShowGettingStarted(false);
            loadStarterImage(template);
          }}
          onSample={openSampleProject}
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

import { useRef, type Dispatch, type SetStateAction } from "react";
import type { StarterImageTemplate } from "../components/AppShell";
import { processingLabel } from "../components/stages/character/ProgressBlock";
import {
  IMAGE_IMPORT_PROCESSING_EVENT,
  IMAGE_IMPORT_REVIEW_EVENT,
  type PendingCharacterReview,
} from "../components/stages/character/CharacterImportOverlays";
import type {
  AppStage,
  MechanismConfig,
  ProjectAction,
  ProjectState,
} from "../types";
import {
  createProjectFromProcessed,
  downloadText,
  loadProjectSnapshot,
} from "../utils/project";
import {
  processImageWithWebOnnx,
  WebOnnxError,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";
import { loadCharacterPackage } from "../utils/packageLoader";
import { foundryPreviewFromProject } from "../utils/mechanismDefaults";
import { recordStageNavigationOpened } from "../utils/appStageNavigation";
import { recordStudyEvent } from "../utils/studyTelemetryBoundary";

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

type UseAppCharacterImportActionsParams = {
  project: ProjectState;
  stage: AppStage;
  dispatch: (action: ProjectAction) => void;
  setProject: (project: ProjectState, options?: SetProjectOptions) => void;
  setFoundry: Dispatch<SetStateAction<MechanismConfig>>;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  setShowGettingStarted: (show: boolean) => void;
  setOnnxCacheStatus: Dispatch<SetStateAction<WebOnnxCacheStatus>>;
};

export const useAppCharacterImportActions = ({
  project,
  stage,
  dispatch,
  setProject,
  setFoundry,
  setStage,
  setCommandStatus,
  setShowGettingStarted,
  setOnnxCacheStatus,
}: UseAppCharacterImportActionsParams) => {
  const pendingCharacter = useRef<PendingCharacterReview | null>(null);
  const activeImageImport = useRef<AbortController | null>(null);
  const lastImageFile = useRef<File | null>(null);
  const setPendingCharacter: Dispatch<
    SetStateAction<PendingCharacterReview | null>
  > = (update) => {
    pendingCharacter.current =
      typeof update === "function"
        ? update(pendingCharacter.current)
        : update;
    window.dispatchEvent(
      new CustomEvent(IMAGE_IMPORT_REVIEW_EVENT, {
        detail: pendingCharacter.current,
      }),
    );
  };
  const showProcessing = (processing: ProjectState["processing"]) =>
    window.dispatchEvent(
      new CustomEvent(IMAGE_IMPORT_PROCESSING_EVENT, { detail: processing }),
    );

  const pixelBucket = (pixels: number) =>
    pixels <= 0 ? "unknown"
      : pixels <= 250_000 ? "lte-250k"
      : pixels <= 500_000 ? "lte-500k"
        : pixels <= 1_000_000 ? "lte-1m"
          : pixels <= 4_000_000 ? "lte-4m"
            : "gt-4m";

  const queueCharacterReview = (next: ProjectState, summary: string) => {
    setPendingCharacter({
      project: next,
      summary,
      returnStage: "character",
    });
    showProcessing({
      stage: "ready",
      message: "Check character",
      progress: 100,
    });
    recordStageNavigationOpened("character", "character_review");
    if (stage !== "character") setStage("character");
  };

  const runWebOnnx = async (file: File) => {
    activeImageImport.current?.abort();
    const controller = new AbortController();
    activeImageImport.current = controller;
    lastImageFile.current = file;
    const startedAt = performance.now();
    performance.mark("motionsmith-image-processing-start");
    showProcessing({
      stage: "preparing-image",
      message: "Preparing image…",
      progress: 2,
    });
    try {
      const result = await processImageWithWebOnnx(
        file,
        (stageName, progress) => {
          performance.mark(`motionsmith-image-progress-${stageName}`);
          const stageId = stageName as ProjectState["processing"]["stage"];
          showProcessing({
            stage: stageId,
            message: processingLabel(stageId, ""),
            progress,
          });
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || activeImageImport.current !== controller) return;
      performance.mark("motionsmith-image-result-received");
      recordStudyEvent("image.processing", {
        outcome: "success",
        provider: result.metrics.provider,
        model: result.metrics.model,
        inputPixels: pixelBucket(result.metrics.inputWidth * result.metrics.inputHeight),
        workingPixels: pixelBucket(result.metrics.workingWidth * result.metrics.workingHeight),
        durationMs: Math.round((performance.now() - startedAt) / 500) * 500,
        errorCode: "none",
      }, { level: "metrics", immediate: true });
      const next = createProjectFromProcessed({
        name: file.name.replace(/\.[^.]+$/, "") || "Processed character",
        sourceImageName: file.name,
        skeleton: result.skeleton,
        parts: result.parts,
        textureUrl: result.textureUrl,
        maskUrl: result.maskUrl,
        keypoints: result.keypoints,
        replacementContext: {
          mode: "plain-load",
          previousStage: stage,
          rebindingSummary: "Clean start.",
        },
      });
      performance.mark("motionsmith-image-project-created");
      queueCharacterReview(
        next,
        `${next.partOrder.length} parts · ${Object.keys(next.skeleton?.joints ?? {}).length} joints · ready`,
      );
      performance.mark("motionsmith-image-review-queued");
    } catch (error) {
      if (activeImageImport.current !== controller) return;
      const code = error instanceof WebOnnxError ? error.code : "image-processing-failed";
      const canceled = code === "canceled" || code === "superseded";
      if (code.startsWith("model-") || code === "wasm-unavailable") {
        setOnnxCacheStatus({
          stage: "error",
          label: "AI pose model",
          progress: 0,
          error: code,
        });
      }
      recordStudyEvent("image.processing", {
        outcome: canceled ? "canceled" : "error",
        provider: "wasm",
        model: "fp32",
        inputPixels: pixelBucket(0),
        workingPixels: pixelBucket(0),
        durationMs: Math.round((performance.now() - startedAt) / 500) * 500,
        errorCode: code,
      }, { level: "metrics", immediate: true });
      showProcessing({
        stage: canceled ? "idle" : "error",
        message: canceled ? "Import canceled" : "Image processing failed",
        progress: 0,
        error: canceled ? undefined : code,
      });
    } finally {
      if (activeImageImport.current === controller) activeImageImport.current = null;
    }
  };

  const cancelWebOnnx = () => activeImageImport.current?.abort();
  const retryWebOnnx = () => {
    const file = lastImageFile.current;
    if (file) void runWebOnnx(file);
  };

  const loadStarterImage = async (template: StarterImageTemplate) => {
    setCommandStatus(`Opening ${template.label}`);
    dispatch({
      type: "set_processing",
      processing: {
        stage: "preparing-image",
        message: `Opening ${template.label}`,
        progress: 8,
      },
    });
    try {
      const response = await fetch(template.packageUrl);
      if (!response.ok) throw new Error("Starter package unavailable");
      const loaded = loadProjectSnapshot(await response.json(), project);
      if (loaded.status === "rejected") throw new Error(loaded.blocker);
      queueCharacterReview(loaded.project, "Ready to use.");
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
    setCommandStatus("Loading character…");
    try {
      queueCharacterReview(await loadCharacterPackage(files), "Ready to use.");
    } catch (error) {
      setCommandStatus(
        `Couldn’t load character: ${error instanceof Error ? error.message : String(error)}`,
      );
      recordStageNavigationOpened("character", "character_import_failed");
      setStage("character");
    }
  };

  const importProject = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const loaded = loadProjectSnapshot(raw, project);
      if (loaded.status === "rejected") {
        setCommandStatus(loaded.blocker);
        return;
      }
      const loadedProject = loaded.project;
      setProject(loadedProject, { resetHistory: true });
      setFoundry(foundryPreviewFromProject(loadedProject));
      setCommandStatus(`Loaded project ${file.name}`);
      setShowGettingStarted(false);
      recordStageNavigationOpened("path", "project_import");
      setStage("path");
    } catch (error) {
      setCommandStatus(
        `Project import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      setShowGettingStarted(false);
      recordStageNavigationOpened("character", "project_import_failed");
      setStage("character");
    }
  };

  const editCharacterParts = () => {
    setCommandStatus("Opened Character part, outline, and skeleton tools");
    recordStageNavigationOpened("character", "character_edit");
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

  const acceptPendingCharacter = () => {
    const review = pendingCharacter.current;
    if (!review) return;
    setProject(review.project, { resetHistory: true });
    setPendingCharacter(null);
    setShowGettingStarted(false);
    recordStageNavigationOpened(review.returnStage, "character_review_accept");
    setStage(review.returnStage);
  };

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

  return {
    pendingCharacter: null,
    setPendingCharacter,
    runWebOnnx,
    loadStarterImage,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    cancelWebOnnx,
    retryWebOnnx,
    startFromStarterImage,
    startFromPackage,
    startFromImage,
    startFromProject,
  };
};

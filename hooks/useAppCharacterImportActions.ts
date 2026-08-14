import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { StarterImageTemplate } from "../components/AppShell";
import type { PendingCharacterReview } from "../components/stages/character/CharacterImportOverlays";
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
  type WebOnnxResult,
} from "../utils/webOnnx";
import { setWebOnnxCacheStatus } from "../utils/webOnnxStatusStore";
import { loadCharacterPackage } from "../utils/packageLoader";
import { foundryPreviewFromProject } from "../utils/mechanismDefaults";
import {
  recordStudyCommand,
  recordStudyImageInference,
  STUDY_SUMMARY_ENABLED,
} from "../infrastructure/study-summary/browserSession";

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
}: UseAppCharacterImportActionsParams) => {
  const [pendingCharacter, setPendingCharacter] =
    useState<PendingCharacterReview | null>(null);
  const activeImageImport = useRef<AbortController | null>(null);
  const imageImportGeneration = useRef(0);

  const beginImageImport = () => {
    imageImportGeneration.current += 1;
    activeImageImport.current?.abort();
    activeImageImport.current = null;
    return imageImportGeneration.current;
  };

  useEffect(
    () => () => {
      imageImportGeneration.current += 1;
      activeImageImport.current?.abort();
      activeImageImport.current = null;
    },
    [],
  );

  const queueCharacterReview = (
    next: ProjectState,
    summary: string,
    onnxMetrics?: WebOnnxResult["metrics"],
  ) => {
    setPendingCharacter({
      project: next,
      summary,
      returnStage: "character",
      onnxMetrics,
    });
    dispatch({
      type: "set_processing",
      processing: {
        stage: "ready",
        message: "Check character",
        progress: 100,
      },
    });
    setStage("character");
  };

  const runWebOnnx = async (
    file: File,
    requestedGeneration?: number,
  ) => {
    const generation = requestedGeneration ?? beginImageImport();
    if (generation !== imageImportGeneration.current) return;
    const startedAt = STUDY_SUMMARY_ENABLED ? performance.now() : 0;
    const controller = new AbortController();
    activeImageImport.current = controller;
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
          if (
            controller.signal.aborted ||
            activeImageImport.current !== controller ||
            imageImportGeneration.current !== generation
          ) {
            return;
          }
          if (stageName === "downloading-model")
            setWebOnnxCacheStatus((prev) => ({
              ...prev,
              stage: "downloading",
              progress,
            }));
          if (stageName === "loading-model" && progress >= 35)
            setWebOnnxCacheStatus((prev) => ({
              ...prev,
              stage: "cached",
              progress: 100,
            }));
          // Keep the full ProjectState/App tree stable while the worker runs.
          // The compact ONNX status pill owns model-acquisition progress; the
          // project changes only for the initial, terminal, and error states.
        },
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        activeImageImport.current !== controller ||
        imageImportGeneration.current !== generation
      ) {
        return;
      }
      const processResultMark = typeof performance !== "undefined"
        ? performance.getEntriesByName("motionsmith-image-process-result").at(-1)
        : undefined;
      const processRequestId = processResultMark && "detail" in processResultMark
        ? (processResultMark as PerformanceMark & { detail?: { requestId?: number } }).detail?.requestId
        : undefined;
      if (typeof performance !== "undefined") {
        performance.mark("motionsmith-image-result-application-start", {
          detail: { requestId: processRequestId },
        });
      }
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
      queueCharacterReview(
        next,
        `${next.partOrder.length} parts · ${Object.keys(next.skeleton?.joints ?? {}).length} joints · ready`,
        result.metrics,
      );
      if (STUDY_SUMMARY_ENABLED)
        recordStudyImageInference("success", performance.now() - startedAt);
      if (typeof performance !== "undefined") {
        performance.mark("motionsmith-image-result-application-end", {
          detail: { requestId: processRequestId },
        });
      }
    } catch (error) {
      if (
        activeImageImport.current !== controller ||
        imageImportGeneration.current !== generation
      ) {
        return;
      }
      const code =
        error instanceof WebOnnxError
          ? error.code
          : "image-processing-failed";
      const canceled = code === "canceled" || code === "superseded";
      if (
        code === "model-download-failed" ||
        code === "model-download-stalled" ||
        code === "model-invalid" ||
        code === "wasm-unavailable" ||
        code === "worker-unavailable"
      ) {
        setWebOnnxCacheStatus({
          stage: "error",
          label: "AI pose model",
          progress: 0,
          error: code,
        });
      }
      dispatch({
        type: "set_processing",
        processing: {
          stage: canceled ? "idle" : "error",
          message: canceled ? "Import canceled" : "Image processing failed",
          progress: 0,
          error: canceled
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error),
        },
      });
      setCommandStatus(
        canceled
          ? "Import canceled"
          : code === "worker-unavailable" ||
              code === "model-download-failed" ||
              code === "model-invalid" ||
              code === "wasm-unavailable"
            ? "AI unavailable — use Starter rig or Try again"
            : "Image processing failed",
      );
      if (STUDY_SUMMARY_ENABLED && !canceled)
        recordStudyImageInference("failure", performance.now() - startedAt);
    } finally {
      if (activeImageImport.current === controller) {
        activeImageImport.current = null;
      }
    }
  };

  const loadStarterImage = async (template: StarterImageTemplate) => {
    const generation = beginImageImport();
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
      if (generation !== imageImportGeneration.current) return;
      await runWebOnnx(
        new File([blob], template.fileName, { type: blob.type || "image/png" }),
        generation,
      );
    } catch (error) {
      if (generation !== imageImportGeneration.current) return;
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
    beginImageImport();
    setCommandStatus("Loading character…");
    try {
      queueCharacterReview(await loadCharacterPackage(files), "Ready to use.");
      if (STUDY_SUMMARY_ENABLED)
        recordStudyCommand("authoring", "accepted");
    } catch (error) {
      setCommandStatus(
        `Couldn’t load character: ${error instanceof Error ? error.message : String(error)}`,
      );
      setStage("character");
      if (STUDY_SUMMARY_ENABLED)
        recordStudyCommand("authoring", "rejected");
    }
  };

  const importProject = async (file: File) => {
    beginImageImport();
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
      setStage("path");
      if (STUDY_SUMMARY_ENABLED)
        recordStudyCommand("authoring", "accepted");
    } catch (error) {
      setCommandStatus(
        `Project import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      setShowGettingStarted(false);
      setStage("character");
      if (STUDY_SUMMARY_ENABLED)
        recordStudyCommand("authoring", "rejected");
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

  const acceptPendingCharacter = () => {
    if (!pendingCharacter) return;
    setProject(pendingCharacter.project, { resetHistory: true });
    setPendingCharacter(null);
    setShowGettingStarted(false);
    setStage(pendingCharacter.returnStage);
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
    pendingCharacter,
    setPendingCharacter,
    runWebOnnx,
    loadStarterImage,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    startFromStarterImage,
    startFromPackage,
    startFromImage,
    startFromProject,
  };
};

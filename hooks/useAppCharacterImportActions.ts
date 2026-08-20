import {
  startTransition,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { StarterImageTemplate } from "../components/AppShell";
import { processingLabel } from "../components/stages/character/ProgressBlock";
import type { AppStage, ProjectAction, ProjectState } from "../types";
import {
  createProjectFromProcessed,
  downloadText,
  loadProjectSnapshot,
} from "../utils/project";
import {
  checkWebOnnxCache,
  processImageWithWebOnnx,
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";
import { loadCharacterPackage } from "../utils/packageLoader";
import {
  createCharacterImportProgressStore,
  type CharacterImportProgressStore,
} from "../runtime/ai/characterImportProgressStore";

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

type UseAppCharacterImportActionsParams = {
  project: ProjectState;
  stage: AppStage;
  dispatch: (action: ProjectAction) => void;
  setProject: (project: ProjectState, options?: SetProjectOptions) => void;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  setShowGettingStarted: (show: boolean) => void;
  setOnnxCacheStatus: Dispatch<SetStateAction<WebOnnxCacheStatus>>;
  characterImportProgress?: CharacterImportProgressStore;
  processCharacterImage?: typeof processImageWithWebOnnx;
  fetchStarterImage?: typeof fetch;
  yieldBeforeInference?: () => void | Promise<void>;
};

type OnnxImportOperation = {
  generationId: number;
  abortController: AbortController;
};

export const useAppCharacterImportActions = ({
  project,
  stage,
  dispatch,
  setProject,
  setStage,
  setCommandStatus,
  setShowGettingStarted,
  setOnnxCacheStatus,
  characterImportProgress,
  processCharacterImage = processImageWithWebOnnx,
  fetchStarterImage = fetch,
  yieldBeforeInference = () => {
    if (typeof requestAnimationFrame === "undefined") return;
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  },
}: UseAppCharacterImportActionsParams) => {
  const onnxGenerationRef = useRef(0);
  const onnxAbortRef = useRef<AbortController | null>(null);
  const fallbackProgressRef = useRef<CharacterImportProgressStore | null>(null);
  fallbackProgressRef.current ??= createCharacterImportProgressStore();
  const progressStore = characterImportProgress ?? fallbackProgressRef.current;

  useEffect(() => () => {
    onnxAbortRef.current?.abort();
    progressStore.publishProgress(null);
    progressStore.publishPending(null);
  }, [progressStore]);

  const beginOnnxImport = (): OnnxImportOperation => {
    onnxAbortRef.current?.abort();
    const operation = {
      generationId: ++onnxGenerationRef.current,
      abortController: new AbortController(),
    };
    onnxAbortRef.current = operation.abortController;
    return operation;
  };

  const isCurrentOnnxImport = ({
    generationId,
    abortController,
  }: OnnxImportOperation) =>
    generationId === onnxGenerationRef.current &&
    abortController === onnxAbortRef.current &&
    !abortController.signal.aborted;

  const queueCharacterReview = (next: ProjectState, summary: string) => {
    progressStore.publishProgress({
      stage: "ready",
      message: "Check character",
      progress: 100,
    });
    startTransition(() => {
      progressStore.publishPending({
        project: next,
        summary,
        returnStage: "character",
      });
      setStage("character");
    });
  };

  const runWebOnnxForOperation = async (
    file: File,
    operation: OnnxImportOperation,
  ) => {
    if (!isCurrentOnnxImport(operation)) return;
    const { generationId, abortController } = operation;
    progressStore.publishProgress({
      stage: "loading-model",
      message: "Reading picture…",
      progress: 10,
    });
    try {
      const paint = yieldBeforeInference();
      if (paint) await paint;
      if (!isCurrentOnnxImport(operation)) return;
      const result = await processCharacterImage(
        file,
        (stageName, progress) => {
          if (!isCurrentOnnxImport(operation)) return;
          const stageId = stageName as ProjectState["processing"]["stage"];
          progressStore.publishProgress({
            stage: stageId,
            message: processingLabel(stageId, ""),
            progress,
          });
        },
        { generationId, signal: abortController.signal },
      );
      if (!isCurrentOnnxImport(operation)) return;
      const cacheStatus = await checkWebOnnxCache();
      if (!isCurrentOnnxImport(operation)) return;
      setOnnxCacheStatus(cacheStatus);
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
      );
    } catch (error) {
      if (
        !isCurrentOnnxImport(operation) ||
        (error instanceof DOMException && error.name === "AbortError")
      ) return;
      progressStore.publishProgress({
        stage: "error",
        message: "AI could not load on this network. Use a starter character or load a character file.",
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (onnxAbortRef.current === abortController) onnxAbortRef.current = null;
    }
  };

  const runWebOnnx = (file: File) =>
    runWebOnnxForOperation(file, beginOnnxImport());

  const loadStarterImage = async (template: StarterImageTemplate) => {
    const operation = beginOnnxImport();
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
      const response = await fetchStarterImage(template.url, {
        signal: operation.abortController.signal,
      });
      if (!isCurrentOnnxImport(operation)) return;
      if (!response.ok) throw new Error(`Could not load ${template.fileName}`);
      const blob = await response.blob();
      if (!isCurrentOnnxImport(operation)) return;
      await runWebOnnxForOperation(
        new File([blob], template.fileName, { type: blob.type || "image/png" }),
        operation,
      );
    } catch (error) {
      if (
        !isCurrentOnnxImport(operation) ||
        (error instanceof DOMException && error.name === "AbortError")
      ) return;
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
    } finally {
      if (onnxAbortRef.current === operation.abortController)
        onnxAbortRef.current = null;
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

  const acceptPendingCharacter = () => {
    const pendingCharacter = progressStore.getPending();
    if (!pendingCharacter) return;
    startTransition(() => {
      setProject(pendingCharacter.project, { resetHistory: true });
      progressStore.publishPending(null);
      progressStore.publishProgress(null);
      setShowGettingStarted(false);
      setStage(pendingCharacter.returnStage);
    });
  };

  const discardPendingCharacter = () => {
    startTransition(() => {
      progressStore.publishPending(null);
      progressStore.publishProgress(null);
    });
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
    startTransition(() => setShowGettingStarted(false));
    runWebOnnx(file);
  };

  const startFromProject = (file: File) => {
    setShowGettingStarted(false);
    importProject(file);
  };

  return {
    setPendingCharacter: progressStore.publishPending,
    runWebOnnx,
    loadStarterImage,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    discardPendingCharacter,
    startFromStarterImage,
    startFromPackage,
    startFromImage,
    startFromProject,
  };
};

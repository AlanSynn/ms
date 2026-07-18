import { useState, type Dispatch, type SetStateAction } from "react";
import type { StarterImageTemplate } from "../components/AppShell";
import { processingLabel } from "../components/stages/character/ProgressBlock";
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
  type WebOnnxCacheStatus,
} from "../utils/webOnnx";
import { loadCharacterPackage } from "../utils/packageLoader";
import { foundryPreviewFromProject } from "../utils/mechanismDefaults";
import { recordStageNavigationOpened } from "../utils/appStageNavigation";

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
  const [pendingCharacter, setPendingCharacter] =
    useState<PendingCharacterReview | null>(null);

  const queueCharacterReview = (next: ProjectState, summary: string) => {
    setPendingCharacter({
      project: next,
      summary,
      returnStage: "character",
    });
    dispatch({
      type: "set_processing",
      processing: {
        stage: "ready",
        message: "Check character",
        progress: 100,
      },
    });
    recordStageNavigationOpened("character", "character_review");
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
    if (!pendingCharacter) return;
    setProject(pendingCharacter.project, { resetHistory: true });
    setPendingCharacter(null);
    setShowGettingStarted(false);
    recordStageNavigationOpened(pendingCharacter.returnStage, "character_review_accept");
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

import {
  startTransition,
  useEffect,
  useRef,
} from "react";
import type { AppStage, ProjectAction, ProjectState } from "../types";
import {
  downloadText,
  loadProjectSnapshot,
} from "../utils/project";
import { loadCharacterPackage } from "../utils/packageLoader";
import {
  createCharacterImportProgressStore,
  type CharacterImportProgressStore,
} from "../runtime/import/characterImportProgressStore";

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

type UseAppCharacterImportActionsParams = {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  setProject: (project: ProjectState, options?: SetProjectOptions) => void;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  setShowGettingStarted: (show: boolean) => void;
  characterImportProgress?: CharacterImportProgressStore;
};

export const useAppCharacterImportActions = ({
  project,
  dispatch,
  setProject,
  setStage,
  setCommandStatus,
  setShowGettingStarted,
  characterImportProgress,
}: UseAppCharacterImportActionsParams) => {
  const fallbackProgressRef = useRef<CharacterImportProgressStore | null>(null);
  fallbackProgressRef.current ??= createCharacterImportProgressStore();
  const progressStore = characterImportProgress ?? fallbackProgressRef.current;

  useEffect(() => () => {
    progressStore.publishProgress(null);
    progressStore.publishPending(null);
  }, [progressStore]);

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

  const startFromPackage = (files: FileList | File[]) => {
    setShowGettingStarted(false);
    importCharacterPackage(files);
  };

  const startFromProject = (file: File) => {
    setShowGettingStarted(false);
    importProject(file);
  };

  return {
    setPendingCharacter: progressStore.publishPending,
    importCharacterPackage,
    importProject,
    editCharacterParts,
    saveSkeleton,
    acceptPendingCharacter,
    discardPendingCharacter,
    startFromPackage,
    startFromProject,
  };
};

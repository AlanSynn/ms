import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { AppStage, MechanismConfig, ProjectAction, ProjectState } from "../types";
import {
  createDefaultMechanism,
  downloadBlob,
  downloadText,
  replaceCharacterProject,
} from "../utils/project";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";
import { projectSnapshotFileName } from "../utils/projectPersistence";
import {
  createCharacterImportProgressStore,
  type CharacterImportProgressStore,
} from "../runtime/import/characterImportProgressStore";
import { createProjectImportWorkerClient } from "../runtime/import/projectImportWorkerClient";

type SetProjectOptions = {
  history?: boolean;
  resetHistory?: boolean;
};

type UseAppCharacterImportActionsParams = {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  setProject: (project: ProjectState, options?: SetProjectOptions) => void;
  setFoundry: (mechanism: MechanismConfig) => void;
  setStage: (stage: AppStage) => void;
  setCommandStatus: (status: string) => void;
  setShowGettingStarted: (show: boolean) => void;
  characterImportProgress?: CharacterImportProgressStore;
};

type ProjectImportGuard = {
  sourceProject: ProjectState;
  sourceGeneration: string;
  sourceFingerprint: string;
  loadingStage: string;
  loadingMessage: string;
};

const projectGeneration = (candidate: ProjectState): string =>
  `${candidate.metadata.id}:${candidate.revision ?? 0}:${candidate.metadata.updatedAt}`;

const projectFingerprintWithoutProcessing = (candidate: ProjectState): string => {
  const { processing: _processing, ...stableProject } = candidate;
  return JSON.stringify(stableProject);
};

export const createProjectImportGuard = (
  sourceProject: ProjectState,
  loadingStage: string,
  loadingMessage: string,
): ProjectImportGuard => ({
  sourceProject,
  sourceGeneration: projectGeneration(sourceProject),
  sourceFingerprint: projectFingerprintWithoutProcessing(sourceProject),
  loadingStage,
  loadingMessage,
});

export const projectImportGuardAllows = (
  guard: ProjectImportGuard,
  candidate: ProjectState,
): boolean => {
  if (candidate === guard.sourceProject) return true;
  return projectGeneration(candidate) === guard.sourceGeneration &&
    projectFingerprintWithoutProcessing(candidate) === guard.sourceFingerprint &&
    candidate.processing.stage === guard.loadingStage &&
    candidate.processing.message === guard.loadingMessage;
};

export const projectHasStudentWork = (candidate: ProjectState): boolean =>
  candidate.partOrder.length > 0 ||
  Object.keys(candidate.paths).length > 0 ||
  candidate.mechanisms.length > 0 ||
  candidate.sceneObjectOrder.length > 0 ||
  Object.keys(candidate.sceneObjects).length > 0;

export const useAppCharacterImportActions = ({
  project,
  dispatch,
  setProject,
  setFoundry,
  setStage,
  setCommandStatus,
  setShowGettingStarted,
  characterImportProgress,
}: UseAppCharacterImportActionsParams) => {
  const fallbackProgressRef = useRef<CharacterImportProgressStore | null>(null);
  fallbackProgressRef.current ??= createCharacterImportProgressStore();
  const progressStore = characterImportProgress ?? fallbackProgressRef.current;
  const importClient = useMemo(() => createProjectImportWorkerClient(), []);
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;

  useEffect(() => () => {
    importClient.dispose();
    progressStore.publishProgress(null);
    progressStore.publishPending(null);
  }, [importClient, progressStore]);

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


  const importCharacterPackage = (files: FileList | File[]) => {
    const sourceProject = latestProjectRef.current;
    const guard = createProjectImportGuard(sourceProject, "loading-model", "Loading character…");
    dispatch({
      type: "set_processing",
      processing: {
        stage: "loading-model",
        message: "Loading character…",
        progress: 20,
      },
    });
    importClient.requestCharacterPackage(files, {
      complete: ({ project: next }) => {
        if (!projectImportGuardAllows(guard, latestProjectRef.current)) {
          setCommandStatus("Character import cancelled because the project changed.");
          return;
        }
        queueCharacterReview(next, "Ready to use.");
      },
      failed: (error) => {
        if (!projectImportGuardAllows(guard, latestProjectRef.current)) return;
        dispatch({
          type: "set_processing",
          processing: {
            stage: "error",
            message: "Couldn’t load character",
            progress: 0,
            error: error.message,
          },
        });
        setStage("character");
      },
    });
  };

  const importProject = (file: File) => {
    const sourceProject = latestProjectRef.current;
    const guard = createProjectImportGuard(sourceProject, "loading-model", "Loading project…");
    const hasWork = projectHasStudentWork(sourceProject);
    if (hasWork && !window.confirm(
      `Open ${file.name}? Current work has ${Object.keys(sourceProject.paths).length} motions and ${sourceProject.mechanisms.length} mechanisms. A recovery copy will be saved first.`,
    )) {
      setCommandStatus("Project unchanged");
      return;
    }
    if (hasWork) {
      try {
        downloadBlob(
          projectSnapshotFileName(sourceProject.metadata.name, `-recovery-${Date.now()}`),
          createPortableProjectBlob(sourceProject),
        );
      } catch (error) {
        setCommandStatus(`Open cancelled: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
    if (!projectImportGuardAllows(guard, latestProjectRef.current)) {
      setCommandStatus("Open cancelled because the project changed.");
      return;
    }
    dispatch({
      type: "set_processing",
      processing: {
        stage: "loading-model",
        message: "Loading project…",
        progress: 20,
      },
    });
    importClient.requestProject(file, {
      complete: ({ project: next }) => startTransition(() => {
        if (!projectImportGuardAllows(guard, latestProjectRef.current)) {
          setCommandStatus("Project changed while opening. Open it again.");
          return;
        }
        setProject(next, { resetHistory: true });
        setFoundry(
          next.mechanisms[0]
            ? { ...next.mechanisms[0], id: "foundry-preview" }
            : createDefaultMechanism("4bar", "foundry-preview"),
        );
        setCommandStatus(`Loaded project ${file.name}`);
        setShowGettingStarted(false);
        setStage("path");
      }),
      failed: (error) => {
        if (!projectImportGuardAllows(guard, latestProjectRef.current)) return;
        dispatch({
          type: "set_processing",
          processing: {
            stage: "error",
            message: "Project import failed",
            progress: 0,
            error: error.message,
          },
        });
        setCommandStatus(`Project import failed: ${error.message}`);
        setShowGettingStarted(false);
        setStage("character");
      },
    });
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
    const hasCurrentWork = projectHasStudentWork(project);
    const replacement = hasCurrentWork
      ? replaceCharacterProject(pendingCharacter.project, project, pendingCharacter.returnStage)
      : pendingCharacter.project;
    if (hasCurrentWork && !window.confirm(
      `Replace the character and keep ${Object.keys(replacement.paths).length} motions and ${replacement.mechanisms.length} mechanisms? A recovery copy will be saved first.`,
    )) {
      setCommandStatus("Character unchanged");
      return;
    }
    if (hasCurrentWork) {
      try {
        downloadBlob(
          projectSnapshotFileName(project.metadata.name, `-before-character-${Date.now()}`),
          createPortableProjectBlob(project),
        );
      } catch (error) {
        setCommandStatus(`Character unchanged: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
    startTransition(() => {
      setProject(replacement, { resetHistory: true });
      progressStore.publishPending(null);
      progressStore.publishProgress(null);
      setShowGettingStarted(false);
      setStage(pendingCharacter.returnStage);
      setCommandStatus(hasCurrentWork ? "Character replaced; motions kept" : "Character ready");
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

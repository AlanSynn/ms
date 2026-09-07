import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  type SetStateAction,
} from "react";
import type { AppStage, MechanismConfig, ProjectAction, ProjectState } from "../types";
import {
  createDefaultMechanism,
  downloadText,
  replaceCharacterProject,
} from "../utils/project";
import { confirmProjectReplacement } from "../runtime/persistence/projectReplacementSafety";
import { projectHasStudentWork, type ProjectDecisionBoundary } from "../runtime/persistence/projectDecisionBoundary";
export { projectHasStudentWork } from "../runtime/persistence/projectDecisionBoundary";
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
  setProject: (project: SetStateAction<ProjectState>, options?: SetProjectOptions) => void;
  projectDecision: ProjectDecisionBoundary;
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

export const useAppCharacterImportActions = ({
  project,
  dispatch,
  setProject,
  projectDecision,
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
    const decisionToken = projectDecision.begin();
    const guard = createProjectImportGuard(sourceProject, "loading-model", "Loading character…");
    progressStore.publishProgress({
        stage: "loading-model",
        message: "Loading character…",
        progress: 20,
    });
    importClient.requestCharacterPackage(files, {
      complete: ({ project: next }) => {
        if (!projectDecision.isCurrent(decisionToken) || !projectImportGuardAllows(guard, latestProjectRef.current)) {
          setCommandStatus("Character import cancelled because the project changed.");
          return;
        }
        queueCharacterReview(next, "Ready to use.");
      },
      failed: (error) => {
        if (!projectDecision.isCurrent(decisionToken) || !projectImportGuardAllows(guard, latestProjectRef.current)) return;
        progressStore.publishProgress({
            stage: "error",
            message: "Couldn’t load character",
            progress: 0,
        });
        setCommandStatus(`Character import failed: ${error.message}`);
        setStage("character");
      },
    });
  };

  const importProject = (file: File) => {
    const sourceProject = latestProjectRef.current;
    const decisionToken = projectDecision.begin();
    const guard = createProjectImportGuard(sourceProject, "loading-model", "Loading project…");
    const isCurrent = (current: ProjectState) => projectDecision.isCurrent(decisionToken) &&
      projectImportGuardAllows(guard, current);
    setCommandStatus(`Opening ${file.name}…`);
    importClient.requestProject(file, {
      complete: ({ project: next }) => {
        if (!isCurrent(latestProjectRef.current)) {
          setCommandStatus("Project changed while opening. Open it again.");
          return;
        }
        try {
          if (!confirmProjectReplacement(sourceProject, `Open ${file.name}`)) {
            setCommandStatus("Project unchanged");
            return;
          }
        } catch (error) {
          setCommandStatus(`Open cancelled: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (!isCurrent(latestProjectRef.current)) return;
        projectDecision.complete(decisionToken);
        setProject((current) => isCurrent(current) ? next : current, { resetHistory: true });
        progressStore.publishPending(null);
        progressStore.publishProgress(null);
        setFoundry(
          next.mechanisms[0]
            ? { ...next.mechanisms[0], id: "foundry-preview" }
            : createDefaultMechanism("4bar", "foundry-preview"),
        );
        setCommandStatus(`Loaded project ${file.name}`);
        setShowGettingStarted(false);
        setStage("path");
      },
      failed: (error) => {
        if (!isCurrent(latestProjectRef.current)) return;
        setCommandStatus(`Project import failed: ${error.message}`);
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
    const sourceProject = latestProjectRef.current;
    const hasCurrentWork = projectHasStudentWork(sourceProject);
    const replacement = hasCurrentWork
      ? replaceCharacterProject(pendingCharacter.project, sourceProject, pendingCharacter.returnStage)
      : pendingCharacter.project;
    const decisionToken = projectDecision.begin();
    try {
      if (!confirmProjectReplacement(sourceProject, `Replace the character and keep ${Object.keys(replacement.paths).length} paths`)) {
        setCommandStatus("Character unchanged");
        return;
      }
    } catch (error) {
      setCommandStatus(`Character unchanged: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!projectDecision.complete(decisionToken)) return;
    startTransition(() => {
      setProject((current) => current === sourceProject && projectDecision.isCurrent(decisionToken)
        ? replacement : current, { resetHistory: true });
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

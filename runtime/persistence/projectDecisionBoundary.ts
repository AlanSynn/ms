import type { ProjectState } from "../../types";

export type BrowserRecoveryCandidate = {
  projectId: string;
  projectName: string;
  /** Actual journal commit time, in milliseconds; absent for older records. */
  backedUpAt?: number;
};

export type ProjectBackupStatus = {
  state: "waiting" | "off" | "saving" | "saved" | "failed";
  savedAt?: number;
  message?: string;
  candidate?: BrowserRecoveryCandidate;
};

export const projectHasStudentWork = (project: ProjectState) =>
  project.partOrder.length > 0 || Object.keys(project.paths).length > 0 ||
  project.mechanisms.length > 0 || project.sceneObjectOrder.length > 0 ||
  Object.keys(project.sceneObjects).length > 0;

/** Selection, settings, processing and preview state do not choose a document. */
export const projectAuthoringChanged = (before: ProjectState, after: ProjectState) =>
  before.parts !== after.parts || before.partOrder !== after.partOrder ||
  before.skeleton !== after.skeleton || before.paths !== after.paths ||
  before.pathOrder !== after.pathOrder || before.motionTimeline !== after.motionTimeline ||
  (before.mechanisms !== after.mechanisms && (
    before.mechanisms.length !== after.mechanisms.length ||
    before.mechanisms.some((mechanism, index) => mechanism !== after.mechanisms[index])
  )) || before.sceneObjects !== after.sceneObjects ||
  before.sceneObjectOrder !== after.sceneObjectOrder ||
  before.characterPackage !== after.characterPackage ||
  before.metadata.name !== after.metadata.name;

export const createProjectDecisionBoundary = (onChosen: () => void = () => {}) => {
  let generation = 0;
  let authorized = false;
  return {
    begin: () => ++generation,
    isCurrent: (token: number) => token === generation,
    isAuthorized: () => authorized,
    complete: (token: number) => {
      if (token !== generation) return false;
      authorized = true;
      onChosen();
      return true;
    },
    authoredEdit: () => {
      generation += 1;
      authorized = true;
      onChosen();
    },
  };
};

export type ProjectDecisionBoundary = ReturnType<typeof createProjectDecisionBoundary>;

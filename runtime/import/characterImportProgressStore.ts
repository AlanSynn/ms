import type { AppStage, ProcessingStatus, ProjectState } from "../../types";

export type PendingCharacterReview = {
  project: ProjectState;
  summary: string;
  returnStage: AppStage;
};

export type CharacterImportProgressStore = {
  getProgress: () => ProcessingStatus | null;
  subscribeProgress: (listener: () => void) => () => void;
  publishProgress: (status: ProcessingStatus | null) => void;
  getPending: () => PendingCharacterReview | null;
  subscribePending: (listener: () => void) => () => void;
  publishPending: (pending: PendingCharacterReview | null) => void;
};

export const createCharacterImportProgressStore = (): CharacterImportProgressStore => {
  let progress: ProcessingStatus | null = null;
  let pending: PendingCharacterReview | null = null;
  const progressListeners = new Set<() => void>();
  const pendingListeners = new Set<() => void>();
  return {
    getProgress: () => progress,
    subscribeProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    publishProgress: (status) => {
      progress = status;
      progressListeners.forEach((listener) => listener());
    },
    getPending: () => pending,
    subscribePending: (listener) => {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    publishPending: (value) => {
      pending = value;
      pendingListeners.forEach((listener) => listener());
    },
  };
};

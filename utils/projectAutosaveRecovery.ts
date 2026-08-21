import type { ProjectState } from "../types";
import {
  autosaveWriterId,
  browserStorage,
  nextTransactionId,
  type AutosaveStorage,
} from "./projectAutosaveFormat";
import {
  recoveryAfterMutationFailure,
  runAutosaveRecoveryJob,
  recoveryFromStorageReadError,
  type AutosaveProjectReadResult,
} from "../runtime/persistence/autosaveRecoveryJob";
import {
  applyAutosaveRecoveryMutation,
  captureAutosaveRecoveryStorage,
} from "../runtime/persistence/autosaveRecoveryStorage";

export type { AutosaveProjectReadResult } from "../runtime/persistence/autosaveRecoveryJob";

/**
 * Synchronous compatibility boundary for explicit Recover commands and pure
 * tests. Browser cold boot uses the dedicated recovery worker client instead.
 */
export const readAutosaveProject = (
  currentProject: ProjectState,
  storage?: AutosaveStorage,
): AutosaveProjectReadResult => {
  let target: AutosaveStorage;
  try {
    target = storage ?? browserStorage();
    const snapshot = captureAutosaveRecoveryStorage(target);
    const output = runAutosaveRecoveryJob({
      currentProject,
      storage: snapshot,
      migration: {
        transactionId: nextTransactionId(),
        writerId: autosaveWriterId,
        timestamp: Date.now(),
      },
    });
    if (!output.mutation) return output.result;
    const mutation = applyAutosaveRecoveryMutation(
      output.mutation,
      snapshot,
      target,
    );
    return mutation.status === "applied"
      ? output.result
      : recoveryAfterMutationFailure(output, mutation.error);
  } catch (error) {
    return recoveryFromStorageReadError(currentProject, error);
  }
};

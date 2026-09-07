import type { MechanismConfig, ProjectState } from '../../types';
import {
  fitMechanismToTargetPath,
  fitRecommendedMechanismToSheet,
} from '../../utils/mechanismRecommendations';
import { mechanismBoardPlacementErrors } from '../../utils/fabricationValidation';
import { recommendationProjectSnapshot } from '../recommendations/mechanismRecommendationJob';

const MECHANISM_FIT_JOB_VERSION = 1;

export type MechanismFitMode = 'path' | 'sheet';

export type MechanismFitJobInput = {
  project: ProjectState;
  mechanism: MechanismConfig;
  mode: MechanismFitMode;
  pathId?: string;
  inputFingerprint: string;
};

export type MechanismFitJobResult = {
  mechanism: MechanismConfig;
};

export type MechanismFitWorkerRequest = {
  type: 'fit';
  generationId: number;
  input: MechanismFitJobInput;
};

export type MechanismFitWorkerResponse =
  | {
      type: 'result';
      generationId: number;
      inputFingerprint: string;
      result: MechanismFitJobResult;
    }
  | {
      type: 'error';
      generationId: number;
      inputFingerprint: string;
      message: string;
    };

export const createMechanismFitJobInput = (
  project: ProjectState,
  mechanism: MechanismConfig,
  mode: MechanismFitMode,
  pathId?: string,
): MechanismFitJobInput => ({
  project: recommendationProjectSnapshot(project),
  mechanism,
  mode,
  pathId,
  inputFingerprint: [
    `mechanism-fit-v${MECHANISM_FIT_JOB_VERSION}`,
    mode,
    mechanism.id,
    pathId ?? 'sheet',
    project.metadata.updatedAt,
  ].join(':'),
});

export const fitMechanismInWorkerJob = (
  project: ProjectState,
  mechanism: MechanismConfig,
  mode: MechanismFitMode,
  pathId?: string,
) =>
  mode === 'path'
    ? fitMechanismToTargetPath(project, mechanism, pathId)
    : fitRecommendedMechanismToSheet(project, mechanism);

export const runMechanismFitJob = (
  input: MechanismFitJobInput,
): MechanismFitJobResult => {
  const mechanism = fitMechanismInWorkerJob(
    input.project,
    input.mechanism,
    input.mode,
    input.pathId,
  );
  const placementErrors = mechanismBoardPlacementErrors(
    input.project,
    mechanism,
  );
  if (placementErrors.length) {
    throw new Error(
      `No valid board placement. ${placementErrors[0]}`,
    );
  }
  return { mechanism };
};

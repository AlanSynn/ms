import type {
  MechanismConfig,
  MechanismType,
  Point,
  ProjectState,
} from '../../types';
import {
  fitMechanismToTargetPath,
  normalizeGearMeshMechanism,
} from '../../utils/mechanismRecommendations';
import {
  evaluateFitness,
  generateSmartConfig,
  mutateConfig,
} from '../../utils/optimizer';
import {
  createRecommendationRandom,
  recommendationProjectSnapshot,
} from '../recommendations/mechanismRecommendationJob';

export type MechanismOptimizerJobInput = {
  project: ProjectState;
  mechanismId: string;
  pathId: string;
  iterations: number;
  inputFingerprint: string;
  seed: number;
};

export type MechanismOptimizerJobResult = {
  mechanism: MechanismConfig;
  score: number;
};

export type MechanismOptimizerWorkerRequest = {
  type: 'optimize';
  generationId: number;
  input: MechanismOptimizerJobInput;
} | {
  type: 'warm';
};

export type MechanismOptimizerWorkerResponse =
  | { type: 'ready' }
  | {
      type: 'progress';
      generationId: number;
      inputFingerprint: string;
      progress: number;
    }
  | {
      type: 'result';
      generationId: number;
      inputFingerprint: string;
      result: MechanismOptimizerJobResult;
    }
  | {
      type: 'error';
      generationId: number;
      inputFingerprint: string;
      message: string;
    };

const fnv1a = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const createMechanismOptimizerJobInput = (
  project: ProjectState,
  mechanism: MechanismConfig,
  pathId: string,
  iterations: number,
): MechanismOptimizerJobInput => {
  const path = project.paths[pathId];
  const safeIterations = Math.max(1, Math.min(2_000, Math.round(iterations)));
  const seedSource = JSON.stringify({
    version: 1,
    mechanismId: mechanism.id,
    mechanismType: mechanism.type,
    pathId,
    pathPoints: path?.points ?? [],
    iterations: safeIterations,
    kit: project.settings.physicalKit,
  });
  const seed = fnv1a(seedSource) || 0x6d2b79f5;
  return {
    project: recommendationProjectSnapshot(project),
    mechanismId: mechanism.id,
    pathId,
    iterations: safeIterations,
    inputFingerprint: `optimizer-v1-${seed.toString(16).padStart(8, '0')}`,
    seed,
  };
};

export const runMechanismOptimizerSearch = ({
  path,
  type,
  iterations,
  seed,
  onProgress = () => {},
}: {
  path: Point[];
  type: MechanismType;
  iterations: number;
  seed: number;
  onProgress?: (progress: number) => void;
}) => {
  const random = createRecommendationRandom(seed);
  let best = generateSmartConfig(path, type, undefined, random);
  let bestScore = evaluateFitness(best, path);
  for (let index = 0; index < iterations; index += 1) {
    const candidate = index < 80
      ? generateSmartConfig(path, type, undefined, random)
      : mutateConfig(best, 0.45, true, undefined, random);
    const score = evaluateFitness(candidate, path);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
    if (index % 32 === 31 || index === iterations - 1) {
      onProgress(Math.round(((index + 1) / iterations) * 100));
    }
  }
  return { best, bestScore };
};

export const runMechanismOptimizerJob = (
  input: MechanismOptimizerJobInput,
  onProgress: (progress: number) => void = () => {},
): MechanismOptimizerJobResult => {
  const mechanism = input.project.mechanisms.find(
    (candidate) => candidate.id === input.mechanismId,
  );
  const path = input.project.paths[input.pathId];
  if (!mechanism || !path || path.points.length < 3) {
    throw new Error('Optimizer input no longer has a usable mechanism path.');
  }
  const { best, bestScore } = runMechanismOptimizerSearch({
    path: path.points,
    type: mechanism.type,
    iterations: input.iterations,
    seed: input.seed,
    onProgress,
  });
  const optimized = normalizeGearMeshMechanism({
    ...mechanism,
    ...best,
    id: mechanism.id,
    color: mechanism.color,
    visible: true,
    targetPartId: path.sceneObjectId
      ? undefined
      : (path.partId || mechanism.targetPartId),
    targetSceneObjectId: path.sceneObjectId ?? mechanism.targetSceneObjectId,
    targetPathId: path.id,
    source: 'optimized',
    warnings: bestScore > 350 ? [`Loose fit score ${Math.round(bestScore)}`] : [],
  });
  return {
    mechanism: fitMechanismToTargetPath(input.project, optimized, path.id),
    score: bestScore,
  };
};

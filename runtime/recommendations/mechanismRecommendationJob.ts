import type {
  BodyPartLayer,
  ProjectState,
  SceneObject,
} from "../../types";
import {
  buildMechanismRecommendations,
  type MechanismRecommendation,
} from "../../utils/mechanismRecommendations";

const RECOMMENDATION_JOB_VERSION = 1;
const FALLBACK_SEED = 0x6d2b79f5;

export type MechanismRecommendationJobInput = {
  project: ProjectState;
  selectedPartId?: string;
  selectedPathId?: string;
  inputFingerprint: string;
  seed: number;
};

export type MechanismRecommendationWorkerRequest = {
  type: "build";
  generationId: number;
  input: MechanismRecommendationJobInput;
};

export type MechanismRecommendationWorkerResponse =
  | {
      type: "result";
      generationId: number;
      inputFingerprint: string;
      recommendations: MechanismRecommendation[];
    }
  | {
      type: "error";
      generationId: number;
      inputFingerprint: string;
      message: string;
    };

const withoutPartMedia = (part: BodyPartLayer): BodyPartLayer => {
  const { textureUrl: _textureUrl, maskUrl: _maskUrl, ...domainPart } = part;
  return domainPart;
};

const withoutSceneObjectMedia = (object: SceneObject): SceneObject => {
  const { textureUrl: _textureUrl, ...domainObject } = object;
  return domainObject;
};

/**
 * Recommendation fitting needs domain geometry, bindings, mechanisms, and kit
 * settings, but not retained image/export payloads. Keeping those bytes out of
 * structured cloning bounds each worker generation to the actual fit input.
 */
export const recommendationProjectSnapshot = (
  project: ProjectState,
): ProjectState => {
  const {
    lastExport: _lastExport,
    lastFoundryExport: _lastFoundryExport,
    characterPackage: _characterPackage,
    ...domainProject
  } = project;
  return {
    ...domainProject,
    parts: Object.fromEntries(
      Object.entries(project.parts).map(([id, part]) => [
        id,
        withoutPartMedia(part),
      ]),
    ),
    sceneObjects: Object.fromEntries(
      Object.entries(project.sceneObjects).map(([id, object]) => [
        id,
        withoutSceneObjectMedia(object),
      ]),
    ),
  };
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

const fnv1a = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const createRecommendationRandom = (seed: number) => {
  let state = seed >>> 0 || FALLBACK_SEED;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const createMechanismRecommendationJobInput = (
  project: ProjectState,
  selectedPart?: BodyPartLayer,
  selectedPathId?: string,
): MechanismRecommendationJobInput => {
  const snapshot = recommendationProjectSnapshot(project);
  const fingerprintSource = JSON.stringify(
    stableValue({
      version: RECOMMENDATION_JOB_VERSION,
      project: {
        parts: snapshot.parts,
        partOrder: snapshot.partOrder,
        sceneObjects: snapshot.sceneObjects,
        sceneObjectOrder: snapshot.sceneObjectOrder,
        skeleton: snapshot.skeleton,
        paths: snapshot.paths,
        mechanisms: snapshot.mechanisms,
        settings: snapshot.settings,
      },
      selectedPartId: selectedPart?.id,
      selectedPathId,
    }),
  );
  const seed = fnv1a(fingerprintSource) || FALLBACK_SEED;
  return {
    project: snapshot,
    selectedPartId: selectedPart?.id,
    selectedPathId,
    inputFingerprint: `recommendation-v${RECOMMENDATION_JOB_VERSION}-${seed.toString(16).padStart(8, "0")}`,
    seed,
  };
};

export const runMechanismRecommendationJob = (
  input: MechanismRecommendationJobInput,
): MechanismRecommendation[] => {
  const selectedPart = input.selectedPartId
    ? input.project.parts[input.selectedPartId]
    : undefined;
  const selectedPath = input.selectedPathId
    ? input.project.paths[input.selectedPathId]
    : undefined;
  return buildMechanismRecommendations(input.project, selectedPart, selectedPath, {
    random: createRecommendationRandom(input.seed),
  });
};

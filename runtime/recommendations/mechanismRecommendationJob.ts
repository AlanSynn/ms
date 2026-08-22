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
  requestFingerprint: string;
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
      requestFingerprint: string;
      inputFingerprint: string;
      recommendations: MechanismRecommendation[];
    }
  | {
      type: "error";
      generationId: number;
      requestFingerprint: string;
      message: string;
    };

const withoutPartMedia = (part: BodyPartLayer): BodyPartLayer => {
  const {
    textureUrl: _textureUrl,
    maskUrl: _maskUrl,
    originalSvgPath: _originalSvgPath,
    enhancedSvgPath: _enhancedSvgPath,
    ...domainPart
  } = part;
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

export const RECOMMENDATION_PROJECTION_SLICE_MS = 8;

export type RecommendationProjectionOptions = {
  maxSliceMs?: number;
  now?: () => number;
  yieldToMain?: () => Promise<void>;
  shouldContinue?: () => boolean;
};

const defaultProjectionClock = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const defaultProjectionYield = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Strip retained media before structured cloning while yielding between small
 * record batches. Imported project cardinality is bounded separately; the time
 * check keeps a valid near-limit project from monopolizing a classroom frame.
 */
export const recommendationProjectSnapshotChunked = async (
  project: ProjectState,
  options: RecommendationProjectionOptions = {},
): Promise<ProjectState> => {
  const {
    lastExport: _lastExport,
    lastFoundryExport: _lastFoundryExport,
    characterPackage: _characterPackage,
    ...domainProject
  } = project;
  const parts: ProjectState["parts"] = {};
  const sceneObjects: ProjectState["sceneObjects"] = {};
  const maxSliceMs = Math.max(
    1,
    Math.min(RECOMMENDATION_PROJECTION_SLICE_MS, options.maxSliceMs ?? RECOMMENDATION_PROJECTION_SLICE_MS),
  );
  const now = options.now ?? defaultProjectionClock;
  const yieldToMain = options.yieldToMain ?? defaultProjectionYield;
  const shouldContinue = options.shouldContinue ?? (() => true);
  let sliceStartedAt = now();

  const checkpoint = async () => {
    if (!shouldContinue()) throw new DOMException("Recommendation superseded", "AbortError");
    if (now() - sliceStartedAt < maxSliceMs) return;
    await yieldToMain();
    if (!shouldContinue()) throw new DOMException("Recommendation superseded", "AbortError");
    sliceStartedAt = now();
  };

  for (const id of Object.keys(project.parts)) {
    parts[id] = withoutPartMedia(project.parts[id]);
    await checkpoint();
  }
  for (const id of Object.keys(project.sceneObjects)) {
    sceneObjects[id] = withoutSceneObjectMedia(project.sceneObjects[id]);
    await checkpoint();
  }
  if (!shouldContinue()) throw new DOMException("Recommendation superseded", "AbortError");
  return { ...domainProject, parts, sceneObjects };
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

const recommendationFingerprint = (
  input: Pick<
    MechanismRecommendationJobInput,
    "project" | "selectedPartId" | "selectedPathId"
  >,
) => {
  const fingerprintSource = JSON.stringify(
    stableValue({
      version: RECOMMENDATION_JOB_VERSION,
      project: {
        parts: input.project.parts,
        partOrder: input.project.partOrder,
        sceneObjects: input.project.sceneObjects,
        sceneObjectOrder: input.project.sceneObjectOrder,
        skeleton: input.project.skeleton,
        paths: input.project.paths,
        mechanisms: input.project.mechanisms,
        settings: input.project.settings,
      },
      selectedPartId: input.selectedPartId,
      selectedPathId: input.selectedPathId,
    }),
  );
  const seed = fnv1a(fingerprintSource) || FALLBACK_SEED;
  return {
    inputFingerprint: `recommendation-v${RECOMMENDATION_JOB_VERSION}-${seed.toString(16).padStart(8, "0")}`,
    seed,
  };
};

let recommendationRequestSequence = 0;
const recommendationProjectRequestIds = new WeakMap<ProjectState, number>();

const projectRequestId = (project: ProjectState) => {
  const existing = recommendationProjectRequestIds.get(project);
  if (existing !== undefined) return existing;
  const next = ++recommendationRequestSequence;
  recommendationProjectRequestIds.set(project, next);
  return next;
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
  return {
    project,
    selectedPartId: selectedPart?.id,
    selectedPathId,
    requestFingerprint: [
      "recommendation-request",
      projectRequestId(project),
      selectedPart?.id ?? "",
      selectedPathId ?? "",
    ].join(":"),
  };
};

export const runMechanismRecommendationJob = (
  input: MechanismRecommendationJobInput,
): { inputFingerprint: string; recommendations: MechanismRecommendation[] } => {
  const { inputFingerprint, seed } = recommendationFingerprint(input);
  const selectedPart = input.selectedPartId
    ? input.project.parts[input.selectedPartId]
    : undefined;
  const selectedPath = input.selectedPathId
    ? input.project.paths[input.selectedPathId]
    : undefined;
  return {
    inputFingerprint,
    recommendations: buildMechanismRecommendations(
      input.project,
      selectedPart,
      selectedPath,
      { random: createRecommendationRandom(seed) },
    ),
  };
};

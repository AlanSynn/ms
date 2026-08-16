import type {
  FabricationRecipe,
  MechanismConfig,
  ProjectState,
} from '../../types';

export const FINAL_STUDY_ARTIFACT_SCHEMA = 'motionsmith-final-study-v1';
export const FINAL_STUDY_ARTIFACT_MAX_BYTES = 128 * 1024;

export type StudyFabricationInput = {
  signature: string;
  readiness: 'ready' | 'blocked';
};

export type FinalStudyArtifact = {
  schema: typeof FINAL_STUDY_ARTIFACT_SCHEMA;
  projectId: string;
  parts: Array<{
    id: string;
    anchorJointId: string;
    transform: { x: number; y: number; rotation: number; scale: number };
  }>;
  joints: Array<{
    id: string;
    parentId: string | null;
    x: number;
    y: number;
    bendDirection?: number;
  }>;
  paths: Array<{
    id: string;
    partId?: string;
    sceneObjectId?: string;
    targetAnchorJointId?: string;
    chainRootJointId?: string;
    closed: boolean;
    duration: number;
    points: Array<[number, number]>;
    timedPoints?: Array<[number, number, number]>;
  }>;
  mechanisms: Array<{
    id: string;
    type: MechanismConfig['type'];
    parameters: Record<string, number | string | boolean | number[] | undefined>;
    connectionSelections: Array<[string, unknown]>;
    anchor: { x?: number; y?: number; groundAngle?: number };
    target: {
      partId?: string;
      sceneObjectId?: string;
      pathId?: string;
      anchorJointId?: string;
    };
  }>;
  fabrication: StudyFabricationInput;
  workflow: { blueprintReached: boolean; packageGenerated: boolean };
};

const sorted = (ids: string[]) => ids.slice().sort((left, right) =>
  left < right ? -1 : left > right ? 1 : 0,
);

const canonicalMechanism = (mechanism: MechanismConfig) => {
  const parameters = [
    'crankLength',
    'groundLength',
    'couplerLength',
    'rockerLength',
    'sliderOffset',
    'couplerPointDist',
    'couplerPointAngle',
    'assemblyMode',
    'speed1',
    'speed2',
    'gearRatio',
    'gearTrainRadii',
    'camProfileSamples',
    'driverGroupId',
    'driverPhaseOffset',
    'rodLength',
    'phase',
  ] as const;
  const source = mechanism as MechanismConfig & Record<string, unknown>;
  return Object.fromEntries(
    parameters.map((key) => [key, source[key]]).filter(([, value]) => value !== undefined),
  ) as Record<string, number | string | boolean | number[] | undefined>;
};

export const fabricationSignatureForStudy = (
  project: ProjectState,
  recipes: FabricationRecipe[],
) => {
  const semantic = {
    kit: project.settings.physicalKit,
    recipes: recipes
      .slice()
      .sort((left, right) => left.mechanismId.localeCompare(right.mechanismId))
      .map((recipe) => ({
        mechanismId: recipe.mechanismId,
        type: recipe.type,
        boardCoordinate: recipe.boardCoordinate,
        sceneAnchor: recipe.sceneAnchor,
        requiredParts: recipe.requiredParts.map((part) => [part.name, part.quantity]),
      })),
  };
  let hash = 2166136261;
  for (const character of JSON.stringify(semantic)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const buildFinalStudyArtifact = ({
  project,
  recipes,
  fabrication,
  blueprintReached,
  packageGenerated,
}: {
  project: ProjectState;
  recipes: FabricationRecipe[];
  fabrication: StudyFabricationInput;
  blueprintReached: boolean;
  packageGenerated: boolean;
}): FinalStudyArtifact => ({
  schema: FINAL_STUDY_ARTIFACT_SCHEMA,
  projectId: project.metadata.id,
  parts: sorted(Object.keys(project.parts)).map((id) => {
    const part = project.parts[id];
    return {
      id,
      anchorJointId: part.anchorJointId,
      transform: { ...part.transform },
    };
  }),
  joints: sorted(Object.keys(project.skeleton?.joints ?? {})).map((id) => {
    const joint = project.skeleton!.joints[id];
    return {
      id,
      parentId: joint.parentId ?? null,
      x: joint.position.x,
      y: joint.position.y,
      bendDirection: joint.bendDirection,
    };
  }),
  paths: sorted(Object.keys(project.paths)).map((id) => {
    const path = project.paths[id];
    return {
      id,
      partId: path.partId,
      sceneObjectId: path.sceneObjectId,
      targetAnchorJointId: path.targetAnchorJointId,
      chainRootJointId: path.chainRootJointId,
      closed: path.closed,
      duration: path.duration,
      points: path.points.map((point) => [point.x, point.y]),
      timedPoints: path.timedPoints?.map((point) => [point.x, point.y, point.time]),
    };
  }),
  mechanisms: project.mechanisms
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((mechanism) => ({
      id: mechanism.id,
      type: mechanism.type,
      parameters: canonicalMechanism(mechanism),
      connectionSelections: Object.entries(
        (mechanism as MechanismConfig & { connectionSelections?: Record<string, unknown> })
          .connectionSelections ?? {},
      ).sort(([left], [right]) => left.localeCompare(right)),
      anchor: {
        x: mechanism.anchorX,
        y: mechanism.anchorY,
        groundAngle: mechanism.groundAngle,
      },
      target: {
        partId: mechanism.targetPartId,
        sceneObjectId: mechanism.targetSceneObjectId,
        pathId: mechanism.targetPathId,
        anchorJointId: mechanism.targetAnchorJointId,
      },
    })),
  fabrication,
  workflow: { blueprintReached, packageGenerated },
});

type StudyWindow = Window & {
  __MOTIONSMITH_FINAL_STUDY_ARTIFACT__?: FinalStudyArtifact;
};

export const emitFinalStudyArtifact = (artifact: FinalStudyArtifact) => {
  if (typeof window === 'undefined') return false;
  const target = window as StudyWindow;
  if (target.__MOTIONSMITH_FINAL_STUDY_ARTIFACT__) return false;
  const bytes = new TextEncoder().encode(JSON.stringify(artifact)).byteLength;
  if (bytes > FINAL_STUDY_ARTIFACT_MAX_BYTES) {
    throw new Error('Final study artifact exceeds the bounded payload size.');
  }
  target.__MOTIONSMITH_FINAL_STUDY_ARTIFACT__ = artifact;
  window.dispatchEvent(new CustomEvent('motionsmith:final-study-artifact', {
    detail: artifact,
  }));
  return true;
};

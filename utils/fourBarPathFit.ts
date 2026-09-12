import type {
  MechanismConfig,
  Point,
  ProjectMotionPath,
  ProjectState,
} from '../types';
import { boardToScene, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_DEFAULT_GRID_PITCH_MM, FABRICATION_LINKAGE_SPECS } from './fabricationContract';
import { validateMechanismPreviewReadiness, validateForFabrication } from './fabricationValidation';
import { generateMechanismPointTraces } from './kinematics';
import { replacePrimaryMechanismOutputBinding } from './mechanismBindings';
import { normalizeMechanismToFabricationSet } from './mechanismReference';

const COARSE_FIT_RESOLUTION = 8;
const FIT_RESOLUTION = 32;
const FIT_SAMPLE_COUNT = 24;
const OUTPUT_RESOLUTION = 96;
const TOP_CANDIDATE_COUNT = 64;
const CLOSEST_CANDIDATE_COUNT = 12;

export type FourBarPathTopology = 'open' | 'closed';

type LinkageSet = {
  groundLength: number;
  crankLength: number;
  couplerLength: number;
  rockerLength: number;
};
const FIT_CACHE_MAX_ENTRIES = 32;

const fitCache = new Map<string, MechanismConfig | null>();

const readCachedFit = (key: string) => {
  if (!fitCache.has(key)) return undefined;
  const value = fitCache.get(key) ?? null;
  fitCache.delete(key);
  fitCache.set(key, value);
  return { value };
};

const writeCachedFit = (key: string, value: MechanismConfig | null) => {
  fitCache.delete(key);
  fitCache.set(key, value);
  while (fitCache.size > FIT_CACHE_MAX_ENTRIES) {
    const oldest = fitCache.keys().next().value;
    if (oldest === undefined) break;
    fitCache.delete(oldest);
  }
};

export const fourBarFitCacheEntryCount = () => fitCache.size;

export const clearFourBarFitCache = () => fitCache.clear();

const fitCacheKey = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) => JSON.stringify({
  kit: project.settings.physicalKit,
  path: {
    id: path.id,
    points: path.points,
    closed: path.closed,
    partId: path.partId,
    sceneObjectId: path.sceneObjectId,
    targetAnchorJointId: path.targetAnchorJointId,
  },
  mechanism: {
    type: mechanism.type,
    couplerPointDist: mechanism.couplerPointDist,
    couplerPointAngle: mechanism.couplerPointAngle,
    sliderOffset: mechanism.sliderOffset,
    targetPartId: mechanism.targetPartId,
    targetSceneObjectId: mechanism.targetSceneObjectId,
    targetPathId: mechanism.targetPathId,
    targetAnchorJointId: mechanism.targetAnchorJointId,
    // Output bindings participate in the fit (stale bindings veto candidates,
    // fresh fits sync back onto them), so two mechanisms with identical
    // geometry must not share a cache entry across different binding states.
    outputs: mechanism.outputs?.map((output) => [
      output.id,
      output.portId,
      output.pathId,
      output.fit?.status,
      output.fit?.outputTraceId,
    ]),
  },
  siblings: project.mechanisms
    .filter((candidate) => candidate.id !== mechanism.id && candidate.targetPathId !== path.id)
    .map((candidate) => [candidate.type, candidate.targetPartId, candidate.targetPathId]),
});

const cloneFitResult = (
  fitted: MechanismConfig,
  source: MechanismConfig,
): MechanismConfig => ({
  ...fitted,
  id: source.id,
  color: source.color,
  visible: source.visible,
  enabled: source.enabled,
  generatedPath: fitted.generatedPath?.map((point) => ({ ...point })),
  fabricationMetadata: fitted.fabricationMetadata
    ? {
        ...fitted.fabricationMetadata,
        sceneAnchor: fitted.fabricationMetadata.sceneAnchor
          ? { ...fitted.fabricationMetadata.sceneAnchor }
          : undefined,
        pathFit: fitted.fabricationMetadata.pathFit
          ? { ...fitted.fabricationMetadata.pathFit }
          : undefined,
      }
    : undefined,
  warnings: fitted.warnings ? [...fitted.warnings] : undefined,
});

const syncPathFitOutputBinding = (
  project: ProjectState,
  mechanism: MechanismConfig,
  pathId: string,
) => {
  const fit = mechanism.fabricationMetadata?.pathFit;
  if (!fit || fit.targetPathId !== pathId || !mechanism.outputs?.length) return mechanism;
  return replacePrimaryMechanismOutputBinding(project, mechanism, pathId, {
    outputTraceId: fit.outputTraceId,
    fit,
  });
};

const fabricationErrorsForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const placementErrors = fabricationPlacementErrorsForCandidate(project, mechanism);
  const readinessErrors = validateMechanismPreviewReadiness(mechanism);
  const siblingMechanisms = project.mechanisms.filter(
    (candidate) => candidate.id !== mechanism.id,
  );
  const baseline = new Set(
    validateForFabrication({ ...project, mechanisms: siblingMechanisms }).errors,
  );
  const candidateProject: ProjectState = {
    ...project,
    mechanisms: [...siblingMechanisms, mechanism],
  };
  return [
    ...new Set([
      ...placementErrors,
      ...readinessErrors,
      ...validateForFabrication(candidateProject).errors.filter(
        (error) => !baseline.has(error),
      ),
    ]),
  ];
};

const fabricationPlacementErrorsForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const errors: string[] = [];
  const kit = project.settings.physicalKit;
  const snapTolerance = 0.01;
  const fixedPivot = (point: Point, label: string) => {
    const board = sceneToBoardRaw(point, kit);
    if (!board.valid) {
      errors.push(`${mechanism.id}: ${label} ${board.label}.`);
      return;
    }
    const snapped = boardToScene(board.col, board.row, kit);
    if (Math.hypot(snapped.x - point.x, snapped.y - point.y) > snapTolerance) {
      errors.push(`${mechanism.id}: ${label} is not on board hole ${board.label}.`);
    }
  };

  if (!Number.isFinite(mechanism.anchorX) || !Number.isFinite(mechanism.anchorY)) {
    errors.push(`${mechanism.id}: missing board anchor.`);
    return errors;
  }
  fixedPivot({ x: mechanism.anchorX!, y: mechanism.anchorY! }, 'main pivot');

  if (mechanism.type === '4bar') {
    const groundAngle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
    fixedPivot(
      {
        x: mechanism.anchorX! + mechanism.groundLength * Math.cos(groundAngle),
        y: mechanism.anchorY! + mechanism.groundLength * Math.sin(groundAngle),
      },
      'ground pivot',
    );
  }
  return errors;
};

const pathPointsForFit = (path: ProjectMotionPath): { points: Point[]; topology: FourBarPathTopology } => {
  if (!path.closed || path.points.length < 3) return { points: path.points, topology: 'open' };
  return { points: path.points, topology: 'closed' };
};

const resamplePolyline = (
  points: Point[],
  count: number,
  topology: FourBarPathTopology = 'open',
): Point[] => {
  const closed = topology === 'closed';
  if (points.length <= 1 || count <= 1) return points.slice();
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  );
  if (closed) {
    const first = points[0];
    const last = points.at(-1);
    if (last) lengths.push(Math.hypot(first.x - last.x, first.y - last.y));
  }
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0.001) return Array.from({ length: count }, () => points[0]);
  const sampleAt = (distance: number) => {
    let walked = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const segment = lengths[i];
      if (walked + segment >= distance) {
        const t = segment <= 0 ? 0 : (distance - walked) / segment;
        const a = points[i] ?? points.at(-1)!;
        const b = points[i + 1] ?? (closed ? points[0] : points.at(-1)!);
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      }
      walked += segment;
    }
    return closed ? points[0] : points.at(-1)!;
  };
  // A closed loop is a cycle: its samples must divide the loop into `count`
  // equal arcs (sample i at i/count of the loop), matching the fitter's
  // cyclic phase alignment. An open polyline keeps endpoint-inclusive spans.
  const spans = closed ? count : count - 1;
  return Array.from({ length: count }, (_, index) =>
    sampleAt((total * index) / Math.max(1, spans)),
  );
};

/** Uniform arc-length samples for an authored path, preserving its topology. */
export const resamplePathForFourBarFit = (
  points: Point[],
  count: number,
  topology: FourBarPathTopology,
) => resamplePolyline(points, count, topology);

const boardAnchorCandidatesForFit = (
  project: ProjectState,
  _path: ProjectMotionPath,
  _mechanism: MechanismConfig,
) => {
  const anchors = new Map<string, Point>();
  for (let col = 0; col < project.settings.physicalKit.boardCells; col += 1) {
    for (let row = 0; row < project.settings.physicalKit.boardCells; row += 1) {
      anchors.set(
        `${col}:${row}`,
        boardToScene(col, row, project.settings.physicalKit),
      );
    }
  }
  return [...anchors.values()];
};

/**
 * B and C are constrained to circles around their fixed pivots. The radial
 * distance is therefore a hard lower bound on point error for every possible
 * phase, assembly mode, and coupler length. Candidates outside the final
 * tolerance can be discarded before any kinematic sampling without weakening
 * the fabrication gate.
 */
const circleTraceCouldPassTolerance = (
  targetPoints: Point[],
  center: Point,
  radius: number,
  tolerance: number,
) => targetPoints.every((target) =>
  Math.abs(Math.hypot(target.x - center.x, target.y - center.y) - radius)
    <= tolerance,
);

const pointAtCyclic = (points: Point[], index: number): Point => {
  if (!points.length) return { x: 0, y: 0 };
  const wrapped = ((index % points.length) + points.length) % points.length;
  const lower = Math.floor(wrapped);
  const upper = (lower + 1) % points.length;
  const t = wrapped - lower;
  return {
    x: points[lower].x + (points[upper].x - points[lower].x) * t,
    y: points[lower].y + (points[upper].y - points[lower].y) * t,
  };
};

const resampleCyclic = (points: Point[], count: number) => {
  if (!points.length || count <= 0) return [];
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }));
  const lengths = points.map((point, index) =>
    Math.hypot(
      point.x - points[(index + 1) % points.length].x,
      point.y - points[(index + 1) % points.length].y,
    ),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0.001) return Array.from({ length: count }, () => ({ ...points[0] }));
  const pointAtDistance = (distance: number) => {
    const wrapped = ((distance % total) + total) % total;
    let walked = 0;
    for (let index = 0; index < lengths.length; index += 1) {
      const segment = lengths[index];
      if (walked + segment >= wrapped) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        const t = segment <= 0 ? 0 : (wrapped - walked) / segment;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      }
      walked += segment;
    }
    return { ...points[0] };
  };
  return Array.from({ length: count }, (_, index) =>
    pointAtDistance((total * index) / count),
  );
};

type OrderedFit = {
  error: number;
  maxError: number;
  tangentError: number;
  maxTangentError: number;
  phaseOffset: number;
  direction: 1 | -1;
  points: Point[];
};

const unitVector = (from: Point, to: Point): Point | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? { x: dx / length, y: dy / length } : undefined;
};

const tangentAngleDegrees = (a: Point | undefined, b: Point | undefined) => {
  if (!a || !b) return undefined;
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return (Math.acos(dot) * 180) / Math.PI;
};

const polylineTangentAt = (points: Point[], index: number): Point | undefined => {
  if (points.length < 2) return undefined;
  const clamped = Math.max(0, Math.min(points.length - 1, index));
  const before = points[Math.max(0, clamped - 1)];
  const after = points[Math.min(points.length - 1, clamped + 1)];
  return unitVector(before, after);
};

export const targetTangentForFourBarFit = (
  points: Point[],
  index: number,
  topology: FourBarPathTopology,
): Point | undefined => {
  if (topology === 'closed' && points.length > 2) {
    const wrapped = ((index % points.length) + points.length) % points.length;
    return unitVector(
      points[(wrapped - 1 + points.length) % points.length],
      points[(wrapped + 1) % points.length],
    );
  }
  return polylineTangentAt(points, index);
};

const cyclicTangentAt = (
  points: Point[],
  parameter: number,
  direction: 1 | -1,
): Point | undefined => {
  if (points.length < 2) return undefined;
  const step = Math.max(0.5, points.length / FIT_RESOLUTION);
  const before = pointAtCyclic(points, parameter - direction * step);
  const after = pointAtCyclic(points, parameter + direction * step);
  return unitVector(before, after);
};

const orderedFit = (
  tracePoints: Point[],
  targetPoints: Point[],
  resolution: number,
  targetTopology: FourBarPathTopology,
): OrderedFit => {
  const trace = resampleCyclic(tracePoints, resolution);
  let best: OrderedFit = {
    error: Number.POSITIVE_INFINITY,
    maxError: Number.POSITIVE_INFINITY,
    tangentError: Number.POSITIVE_INFINITY,
    maxTangentError: Number.POSITIVE_INFINITY,
    phaseOffset: 0,
    direction: 1,
    points: [],
  };
  let bestScore = Number.POSITIVE_INFINITY;
  for (let shift = 0; shift < trace.length; shift += 1) {
    for (const direction of [1, -1] as const) {
      let squared = 0;
      let maxError = 0;
      let tangentSquared = 0;
      let tangentCount = 0;
      let maxTangentError = 0;
      const alignedPoints: Point[] = [];
      for (let index = 0; index < targetPoints.length; index += 1) {
        const sourceIndex =
          shift + direction * (index * trace.length) / targetPoints.length;
        const candidate = pointAtCyclic(trace, sourceIndex);
        alignedPoints.push(candidate);
        const target = targetPoints[index];
        const distance = Math.hypot(
          candidate.x - target.x,
          candidate.y - target.y,
        );
        squared += distance * distance;
        maxError = Math.max(maxError, distance);
        const tangentError = tangentAngleDegrees(
          cyclicTangentAt(trace, sourceIndex, direction),
          targetTangentForFourBarFit(targetPoints, index, targetTopology),
        );
        if (tangentError !== undefined) {
          tangentSquared += tangentError * tangentError;
          tangentCount += 1;
          maxTangentError = Math.max(maxTangentError, tangentError);
        }
      }
      const error = Math.sqrt(squared / Math.max(1, targetPoints.length));
      const tangentError = Math.sqrt(
        tangentSquared / Math.max(1, tangentCount),
      );
      const score =
        error +
        maxError * 0.15 +
        tangentError * 0.25 +
        maxTangentError * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = {
          error,
          maxError,
          tangentError,
          maxTangentError,
          phaseOffset: ((shift / trace.length) * Math.PI * 2) % (Math.PI * 2),
          direction,
          points: alignedPoints,
        };
      }
    }
  }
  return best;
};

export const fourBarPathFitTolerance = (project: ProjectState) =>
  Math.max(
    12,
    project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM * 0.75,
  );

export const pathFitPassesHardTolerance = (
  fit: Pick<OrderedFit, 'error' | 'maxError' | 'tangentError' | 'maxTangentError'>,
  tolerance: number,
) =>
  fit.error <= tolerance &&
  fit.maxError <= tolerance &&
  Number.isFinite(fit.tangentError) &&
  Number.isFinite(fit.maxTangentError);

export const rejectedFourBarPathFit = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
): MechanismConfig => {
  const targetPartId = path.sceneObjectId
    ? undefined
    : (mechanism.targetPartId ?? path.partId);
  const removeFitWarnings = (warning: string) =>
    !warning.startsWith('Closest kit fit:') &&
    warning !== 'No fabrication-valid path fit.';
  const pathFit = {
    status: 'rejected' as const,
    targetPathId: path.id,
    tolerance: fourBarPathFitTolerance(project),
    kitProfileKey: project.settings.physicalKit.profileKey,
  };
  return syncPathFitOutputBinding(project, normalizeMechanismToFabricationSet({
    ...mechanism,
    targetPartId,
    targetSceneObjectId: path.sceneObjectId,
    targetPathId: path.id,
    targetAnchorJointId: path.sceneObjectId
      ? undefined
      : (mechanism.targetAnchorJointId ?? path.targetAnchorJointId),
    activeVisualPartIds: targetPartId ? [targetPartId] : [],
    generatedPath: undefined,
    fabricationMetadata: {
      ...(mechanism.fabricationMetadata ?? {}),
      targetPathId: path.id,
      gridPitchMm: project.settings.physicalKit.gridPitchMm,
      pathFit,
      warnings: (mechanism.fabricationMetadata?.warnings ?? []).filter(removeFitWarnings),
    },
    warnings: [
      ...(mechanism.warnings ?? []).filter(removeFitWarnings),
      'No fabrication-valid path fit.',
    ],
  }), path.id);
};

const boardSweepStaysWithinKit = (
  project: ProjectState,
  mechanism: MechanismConfig,
  resolution = OUTPUT_RESOLUTION,
) => {
  const halfSpan =
    ((project.settings.physicalKit.boardCells - 1) / 2) *
    project.settings.physicalKit.gridPitchMm *
    SCENE_PX_PER_MM;
  const insideBoard = (point: Point) =>
    point.x >= -halfSpan - 1e-6 &&
    point.x <= halfSpan + 1e-6 &&
    point.y >= -halfSpan - 1e-6 &&
    point.y <= halfSpan + 1e-6;
  const traces = generateMechanismPointTraces(mechanism, resolution);
  if (traces.percentValid < 0.98) return false;
  return traces.traces.every((trace) => trace.points.every(insideBoard));
};

const isLikelyFullRotationFourBar = (
  groundLength: number,
  crankLength: number,
  couplerLength: number,
  rockerLength: number,
) => {
  const sorted = [groundLength, crankLength, couplerLength, rockerLength].sort(
    (a, b) => a - b,
  );
  return (
    crankLength <= Math.min(groundLength, couplerLength, rockerLength) + 1e-6 &&
    sorted[0] + sorted[3] <= sorted[1] + sorted[2] + 1e-6
  );
};

export const fitFourBarKitMechanismToPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) => {
  const cacheKey = fitCacheKey(project, mechanism, path);
  const cached = readCachedFit(cacheKey);
  if (cached) {
    return cached.value
      ? syncPathFitOutputBinding(project, cloneFitResult(cached.value, mechanism), path.id)
      : undefined;
  }
  const targetLoop = pathPointsForFit(path);
  const targetPoints = resamplePolyline(
    targetLoop.points,
    FIT_SAMPLE_COUNT,
    targetLoop.topology,
  );
  if (targetPoints.length < 3) {
    writeCachedFit(cacheKey, null);
    return undefined;
  }
  const kitLengths = FABRICATION_LINKAGE_SPECS.map(
    (spec) => spec.cells * project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM,
  );
  const anchors = boardAnchorCandidatesForFit(project, path, mechanism);
  const validationProject = {
    ...project,
    mechanisms: project.mechanisms.filter(
      (existing) => existing.id === mechanism.id || existing.targetPathId !== path.id,
    ),
  };
  // Fixed pivots must remain on board holes. Cardinal directions keep the
  // search bounded; diagonal (Pythagorean) ground placements exist on the
  // grid but are deliberately not searched.
  const angles = [0, 90, 180, 270];
  const modes: Array<MechanismConfig['assemblyMode']> = ['open', 'crossed'];
  const tolerance = fourBarPathFitTolerance(project);
  const circleViability = new Map<string, boolean>();
  const traceCircleCouldFit = (center: Point, radius: number) => {
    const key = `${center.x}:${center.y}:${radius}`;
    const cached = circleViability.get(key);
    if (cached !== undefined) return cached;
    const viable = circleTraceCouldPassTolerance(
      targetPoints,
      center,
      radius,
      tolerance,
    );
    circleViability.set(key, viable);
    return viable;
  };
  const linkageSets: LinkageSet[] = [];
  for (const groundLength of kitLengths) {
    for (const crankLength of kitLengths) {
      for (const couplerLength of kitLengths) {
        for (const rockerLength of kitLengths) {
          if (isLikelyFullRotationFourBar(
            groundLength,
            crankLength,
            couplerLength,
            rockerLength,
          )) {
            linkageSets.push({
              groundLength,
              crankLength,
              couplerLength,
              rockerLength,
            });
          }
        }
      }
    }
  }
  const top: Array<{
    mechanism: MechanismConfig;
    traceId: string;
    score: number;
  }> = [];
  const targetPartId = path.sceneObjectId
    ? undefined
    : (mechanism.targetPartId ?? path.partId);
  const rememberCandidate = (
    mechanismCandidate: MechanismConfig,
    traceId: string,
    score: number,
  ) => {
    if (top.length >= TOP_CANDIDATE_COUNT && score >= top.at(-1)!.score) return;
    top.push({ mechanism: mechanismCandidate, traceId, score });
    top.sort((a, b) => a.score - b.score);
    if (top.length > TOP_CANDIDATE_COUNT) top.pop();
  };
  const buildCandidate = (
    anchor: Point,
    { groundLength, crankLength, couplerLength, rockerLength }: LinkageSet,
    groundAngle: number,
    assemblyMode: MechanismConfig['assemblyMode'],
  ) => {
    const candidateInput: MechanismConfig = {
      ...mechanism,
      type: '4bar',
      anchorX: anchor.x,
      anchorY: anchor.y,
      sceneAnchor: anchor,
      transform: {
        ...(mechanism.transform ?? {
          x: anchor.x,
          y: anchor.y,
          rotation: groundAngle,
          scale: 1,
        }),
        x: anchor.x,
        y: anchor.y,
        rotation: groundAngle,
      },
      groundLength,
      crankLength,
      couplerLength,
      rockerLength,
      groundAngle,
      assemblyMode,
      targetPartId,
      targetSceneObjectId: path.sceneObjectId,
      targetPathId: path.id,
      targetAnchorJointId: path.sceneObjectId
        ? undefined
        : (mechanism.targetAnchorJointId ?? path.targetAnchorJointId),
      activeVisualPartIds: targetPartId ? [targetPartId] : [],
      source: 'optimized',
      recommendation: 'Fit path',
      speed1: 1,
      driverPhaseOffset: 0,
    };
    return normalizeMechanismToFabricationSet(
      project.settings.physicalKit.gridPitchMm === FABRICATION_DEFAULT_GRID_PITCH_MM && !mechanism.fabricationMetadata
        ? candidateInput
        : {
            ...candidateInput,
            fabricationMetadata: {
              ...(mechanism.fabricationMetadata ?? {}),
              gridPitchMm: project.settings.physicalKit.gridPitchMm,
            },
          },
    );
  };
  // When no candidate geometry can trace the path within tolerance, the
  // fallback pool keeps the closest pin-circle candidates ranked by radial
  // deviation so a 'closest' recommendation survives instead of a bare
  // rejection. Radial deviation is the cheapest admissible stand-in for the
  // ordered fit: each pin traces a circle, so a target far from every pin
  // circle cannot be followed closely by any phase of that candidate.
  const fallback: Array<{
    anchor: Point;
    linkageSet: LinkageSet;
    groundAngle: number;
    traceId: string;
    score: number;
  }> = [];
  const rememberFallback = (entry: (typeof fallback)[number]) => {
    if (fallback.length >= CLOSEST_CANDIDATE_COUNT && entry.score >= fallback.at(-1)!.score) return;
    fallback.push(entry);
    fallback.sort((a, b) => a.score - b.score);
    if (fallback.length > CLOSEST_CANDIDATE_COUNT) fallback.pop();
  };
  const radialDeviation = (center: Point, radius: number) =>
    targetPoints.reduce(
      (sum, target) => sum + Math.abs(Math.hypot(target.x - center.x, target.y - center.y) - radius),
      0,
    ) / targetPoints.length;
  const pivotStaysOnBoard = (pivot: Point) => {
    const board = sceneToBoardRaw(pivot, project.settings.physicalKit);
    return board.valid;
  };

  for (const anchor of anchors) {
    const nearestTargetDistance = targetPoints.reduce(
      (best, target) =>
        Math.min(best, Math.hypot(target.x - anchor.x, target.y - anchor.y)),
      Number.POSITIVE_INFINITY,
    );
    for (const linkageSet of linkageSets) {
      if (nearestTargetDistance > linkageSet.groundLength + linkageSet.rockerLength + tolerance * 2)
        continue;
      const crankTraceCouldFit = traceCircleCouldFit(anchor, linkageSet.crankLength);
      for (const groundAngle of angles) {
        const groundAngleRad = (groundAngle * Math.PI) / 180;
        const groundPivot = {
          x: anchor.x + linkageSet.groundLength * Math.cos(groundAngleRad),
          y: anchor.y + linkageSet.groundLength * Math.sin(groundAngleRad),
        };
        const rockerTraceCouldFit = traceCircleCouldFit(
          groundPivot,
          linkageSet.rockerLength,
        );
        if (!crankTraceCouldFit && !rockerTraceCouldFit) {
          if (!pivotStaysOnBoard(groundPivot)) continue;
          const crankDeviation = radialDeviation(anchor, linkageSet.crankLength);
          const rockerDeviation = radialDeviation(groundPivot, linkageSet.rockerLength);
          const crankWins = crankDeviation <= rockerDeviation;
          rememberFallback({
            anchor,
            linkageSet,
            groundAngle,
            traceId: crankWins ? 'B' : 'C',
            score: crankWins ? crankDeviation : rockerDeviation,
          });
          continue;
        }
        for (const assemblyMode of modes) {
          const baseCandidate = buildCandidate(anchor, linkageSet, groundAngle, assemblyMode);
          if (fabricationPlacementErrorsForCandidate(project, baseCandidate).length)
            continue;
          const traces = generateMechanismPointTraces(
            baseCandidate,
            COARSE_FIT_RESOLUTION,
          );
          // Coarse samples can land exactly on a circle-intersection tangent.
          // Keep candidates through this screening pass and enforce the real
          // sweep-validity threshold after refinement.
          if (traces.percentValid < 0.75) continue;
          const movingTraces = traces.traces.filter((trace) =>
            (trace.id === 'B' && crankTraceCouldFit) ||
            (trace.id === 'C' && rockerTraceCouldFit),
          );
          for (const trace of movingTraces) {
            const fit = orderedFit(
              trace.points,
              targetPoints,
              COARSE_FIT_RESOLUTION,
              targetLoop.topology,
            );
            rememberCandidate(
              baseCandidate,
              trace.id,
              fit.error + fit.maxError * 0.15 + fit.tangentError * 0.25,
            );
          }
        }
      }
    }
  }
  const refineCandidate = (
    candidate: { mechanism: MechanismConfig; traceId: string },
    enforceTolerance: boolean,
  ) => {
    const traces = generateMechanismPointTraces(
      candidate.mechanism,
      FIT_RESOLUTION,
    );
    const trace = traces.traces.find((item) => item.id === candidate.traceId);
    if (!trace) return null;
    const fit = orderedFit(
      trace.points,
      targetPoints,
      FIT_RESOLUTION,
      targetLoop.topology,
    );
    const fittedBase = normalizeMechanismToFabricationSet({
      ...candidate.mechanism,
      speed1: fit.direction,
      driverPhaseOffset: fit.phaseOffset,
    });
    const outputTrace = generateMechanismPointTraces(
      fittedBase,
      OUTPUT_RESOLUTION,
    ).traces.find((item) => item.id === candidate.traceId);
    if (!outputTrace) return null;
    if (enforceTolerance && !pathFitPassesHardTolerance(fit, tolerance)) return null;
    if (!boardSweepStaysWithinKit(project, fittedBase)) return null;
    const fitted = normalizeMechanismToFabricationSet({
      ...fittedBase,
      generatedPath: outputTrace.points,
      fabricationMetadata: {
        ...(fittedBase.fabricationMetadata ?? {}),
        boardCoordinate: sceneToBoardRaw(
          fittedBase.sceneAnchor ?? {
            x: fittedBase.anchorX ?? 0,
            y: fittedBase.anchorY ?? 0,
          },
          project.settings.physicalKit,
        ).label,
        gridPitchMm: project.settings.physicalKit.gridPitchMm,
        sceneAnchor: fittedBase.sceneAnchor,
        targetPathId: path.id,
        pathFit: {
          status: enforceTolerance ? 'fit' : 'closest',
          targetPathId: path.id,
          outputTraceId: candidate.traceId,
          phaseOffset: fit.phaseOffset,
          direction: fit.direction,
          error: fit.error,
          maxError: fit.maxError,
          tangentError: fit.tangentError,
          maxTangentError: fit.maxTangentError,
          tolerance,
          kitProfileKey: project.settings.physicalKit.profileKey,
        },
        warnings: [],
      },
      warnings: enforceTolerance ? [] : ['No fabrication-valid path fit.'],
    });
    return { mechanism: fitted, score: fit.error + fit.maxError * 0.15 };
  };
  const refined = top
    .flatMap((candidate) => {
      const result = refineCandidate(candidate, true);
      return result ? [result] : [];
    })
    .sort((a, b) => a.score - b.score);
  // No candidate traced the path within hard tolerance. Fall back to the best
  // fabrication-valid approximation so students get an explicit closest
  // recommendation instead of a bare rejection.
  const closestFallbackFit = () => {
    const pool: Array<{ mechanism: MechanismConfig; traceId: string }> = [
      ...top.map((entry) => ({ mechanism: entry.mechanism, traceId: entry.traceId })),
      ...fallback.flatMap((entry) =>
        modes.flatMap((assemblyMode) => {
          const mechanism = buildCandidate(
            entry.anchor,
            entry.linkageSet,
            entry.groundAngle,
            assemblyMode,
          );
          return fabricationPlacementErrorsForCandidate(project, mechanism).length
            ? []
            : [{ mechanism, traceId: entry.traceId }];
        }),
      ),
    ];
    return pool
      .map((candidate) => refineCandidate(candidate, false))
      .filter((result): result is NonNullable<ReturnType<typeof refineCandidate>> =>
        result !== null)
      .sort((a, b) => a.score - b.score)
      .find((result) => {
        // Validate in the accepted form (binding synced) so a stale prior
        // binding fit can't veto the recommendation it would receive.
        const accepted = syncPathFitOutputBinding(
          validationProject,
          {
            ...result.mechanism,
            warnings: [],
            fabricationMetadata: {
              ...(result.mechanism.fabricationMetadata ?? {}),
              pathFit: {
                ...(result.mechanism.fabricationMetadata?.pathFit ?? {}),
                status: 'fit' as const,
                acceptedClosest: true,
              },
            },
          },
          path.id,
        );
        return !fabricationErrorsForCandidate(validationProject, accepted).length;
      })?.mechanism;
  };
  const synchronized = refined.map((candidate) => ({
    ...candidate,
    mechanism: syncPathFitOutputBinding(project, candidate.mechanism, path.id),
  }));
  const fitted =
    synchronized.find(
      (candidate) =>
        !fabricationErrorsForCandidate(validationProject, candidate.mechanism).length,
    )?.mechanism ?? closestFallbackFit();
  writeCachedFit(cacheKey, fitted ? cloneFitResult(fitted, mechanism) : null);
  return fitted
    ? syncPathFitOutputBinding(project, cloneFitResult(fitted, mechanism), path.id)
    : undefined;
};

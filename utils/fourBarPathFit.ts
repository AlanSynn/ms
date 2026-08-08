import type { MechanismConfig, MechanismRecoveryCandidates, Point, ProjectMotionPath, ProjectState } from '../types';
import { boardToScene, sceneToBoard, SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_LINKAGE_SPECS } from './fabricationContract';
import { generateMechanismPointTraces } from './kinematics';
import {
  connectionSelectionAccepted,
  normalizeAuthoredMechanismToFabricationSet,
  normalizeMechanismWithFabricationSelections,
  resolveFourBarConnectionSelections,
} from './mechanismConnectionSelections';
import {
  mechanismReadiness,
  projectMechanismReadiness,
  type MechanismReadinessResult,
} from './mechanismReadiness';
import { normalizeMechanismToFabricationSet } from './mechanismReference';
import { mechanismWithGeneratedPath } from './mechanismGeneratedPath';
import { pathOwnedTargetFields } from './pathTargets';
import {
  mechanismEditIsSafe,
  resolveMechanismEditAttempt,
} from './mechanismEditAuthority';
import {
  mechanismUsesExactFabricationCombination,
  resolveFabricationCombination,
} from './mechanismFabricationCombinations';

const pathMetrics = (path: ProjectMotionPath) => {
  const length =
    path.points
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum + Math.hypot(point.x - path.points[index].x, point.y - path.points[index].y),
        0,
      ) || 1;
  return { length };
};

export type AutomaticFitResult = {
  mechanism: MechanismConfig;
  accepted: boolean;
  snapped: boolean;
  summary?: string;
  readiness: MechanismReadinessResult;
  blockers: string[];
  recoveryCandidates?: MechanismRecoveryCandidates;
};

export const FOUR_BAR_FIT_VALIDATION_LIMIT = 12;
const FOUR_BAR_FIT_DISCOVERY_LIMIT = 48;
const FOUR_BAR_FIT_ANCHOR_LIMIT = 18;
const FOUR_BAR_FIT_LENGTH_LIMIT = 3;
const FOUR_BAR_FIT_GROUND_LIMIT = 5;
const FOUR_BAR_FIT_COARSE_TRACE_RESOLUTION = 12;

export type FourBarFitCandidateValidator = (
  project: ProjectState,
  prior: MechanismConfig,
  candidate: MechanismConfig,
) => AutomaticFitResult;

export type FourBarFitOptions = {
  validateCandidate?: FourBarFitCandidateValidator;
};

const automaticFitSnapOutcome = (
  prior: MechanismConfig,
  acceptedCandidate: MechanismConfig,
  kit: ProjectState['settings']['physicalKit'],
) => {
  const priorResolution = resolveFabricationCombination(prior, prior, kit, 'scalar');
  const acceptedResolution = resolveFabricationCombination(
    acceptedCandidate,
    acceptedCandidate,
    kit,
    'scalar',
  );
  const snapped = priorResolution.status === 'accepted' &&
    priorResolution.snapped &&
    acceptedResolution.status === 'accepted' &&
    !acceptedResolution.snapped;
  return {
    snapped,
    ...(snapped && acceptedResolution.status === 'accepted' && acceptedResolution.summary
      ? { summary: acceptedResolution.summary }
      : {}),
  };
};

export const withAutomaticFitSnapOutcome = (
  project: ProjectState,
  prior: MechanismConfig,
  result: AutomaticFitResult,
): AutomaticFitResult => {
  if (!result.accepted) return { ...result, snapped: false };
  return {
    ...result,
    ...automaticFitSnapOutcome(prior, result.mechanism, project.settings.physicalKit),
  };
};

export const completeAutomaticFitCandidate = (
  project: ProjectState,
  prior: MechanismConfig,
  candidate: MechanismConfig,
): AutomaticFitResult => {
  const attempt = resolveMechanismEditAttempt(project, prior, candidate);
  if (attempt.status === 'rejected') {
    return {
      mechanism: prior,
      accepted: false,
      snapped: false,
      readiness: mechanismReadiness(project, prior),
      blockers: [attempt.blocker],
      recoveryCandidates: attempt.recoveryCandidates,
    };
  }
  const acceptedCandidate = attempt.mechanism;
  const candidateProject: ProjectState = {
    ...project,
    mechanisms: [
      ...project.mechanisms.filter((mechanism) => mechanism.id !== acceptedCandidate.id),
      acceptedCandidate,
    ],
  };
  const readiness = mechanismReadiness(candidateProject, acceptedCandidate);
  const projectReadiness = projectMechanismReadiness(candidateProject);
  const accepted = readiness.simulationSafe && (
    readiness.status === 'fabrication-unsupported' ||
    projectReadiness.status === 'project-ready'
  );
  return {
    mechanism: accepted ? acceptedCandidate : prior,
    accepted,
    snapped: false,
    readiness,
    blockers: accepted
      ? readiness.blockers
      : [...new Set([...readiness.blockers, ...projectReadiness.blockers])],
  };
};


const pathPointsForFit = (path: ProjectMotionPath): Point[] => {
  if (!path.closed || path.points.length < 3) return path.points;
  const first = path.points[0];
  const last = path.points.at(-1);
  if (!last || Math.hypot(first.x - last.x, first.y - last.y) < 0.01)
    return path.points;
  return [...path.points, first];
};

const resamplePolyline = (points: Point[], count: number): Point[] => {
  if (points.length <= 1 || count <= 1) return points.slice();
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0.001) return Array.from({ length: count }, () => points[0]);
  const sampleAt = (distance: number) => {
    let walked = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const segment = lengths[i];
      if (walked + segment >= distance) {
        const t = segment <= 0 ? 0 : (distance - walked) / segment;
        const a = points[i];
        const b = points[i + 1];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        };
      }
      walked += segment;
    }
    return points.at(-1)!;
  };
  return Array.from({ length: count }, (_, index) =>
    sampleAt((total * index) / Math.max(1, count - 1)),
  );
};

const nearestDistances = (from: Point[], to: Point[]) =>
  from.map((point) =>
    to.reduce(
      (best, candidate) =>
        Math.min(best, Math.hypot(point.x - candidate.x, point.y - candidate.y)),
      Number.POSITIVE_INFINITY,
    ),
  );

const pathFitError = (candidate: Point[], target: Point[]) => {
  const candidateDistances = nearestDistances(candidate, target);
  const targetDistances = nearestDistances(target, candidate);
  const allDistances = [...candidateDistances, ...targetDistances];
  const mean =
    allDistances.reduce((sum, distance) => sum + distance, 0) /
    Math.max(1, allDistances.length);
  return mean + Math.max(...allDistances, 0) * 1.5;
};

const pathMotionReach = (project: ProjectState, path: ProjectMotionPath) => {
  if (path.sceneObjectId || !project.skeleton) return undefined;
  const targetJointId =
    path.targetAnchorJointId ?? project.parts[path.partId]?.anchorJointId;
  const rootJointId =
    path.chainRootJointId ?? project.parts[path.partId]?.anchorJointId;
  if (!targetJointId || !rootJointId) return undefined;
  const target = project.skeleton.joints[targetJointId];
  const root = project.skeleton.joints[rootJointId];
  if (!target || !root) return undefined;
  let reach = 0;
  let joint = target;
  while (joint.id !== rootJointId) {
    const parent = joint.parentId
      ? project.skeleton.joints[joint.parentId]
      : undefined;
    if (!parent) return undefined;
    reach += Math.hypot(
      joint.position.x - parent.position.x,
      joint.position.y - parent.position.y,
    );
    joint = parent;
  }
  return { root: root.position, reach };
};

const boardAnchorCandidatesForFit = (
  project: ProjectState,
  path: ProjectMotionPath,
  mechanism: MechanismConfig,
) => {
  const points = pathPointsForFit(path);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const seeds = [
    points[0],
    points.at(-1),
    {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    },
    Number.isFinite(mechanism.anchorX) && Number.isFinite(mechanism.anchorY)
      ? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }
      : undefined,
  ].filter((point): point is Point => Boolean(point));
  const anchors = new Map<string, Point>();
  seeds.forEach((seed) => {
    const board = sceneToBoard(seed, project.settings.physicalKit);
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        const col = Math.max(
          0,
          Math.min(project.settings.physicalKit.boardCells - 1, board.col + colOffset),
        );
        const row = Math.max(
          0,
          Math.min(project.settings.physicalKit.boardCells - 1, board.row + rowOffset),
        );
        anchors.set(
          `${col}:${row}`,
          boardToScene(col, row, project.settings.physicalKit),
        );
      }
    }
  });
  return [...anchors.values()];
};

const nearestValues = (values: readonly number[], requested: number, limit: number) =>
  [...values]
    .sort((left, right) => Math.abs(left - requested) - Math.abs(right - requested) || left - right)
    .slice(0, limit);

const nearestFitAnchors = (
  anchors: readonly Point[],
  mechanism: MechanismConfig,
  targetPoints: readonly Point[],
) => {
  const anchor = {
    x: Number.isFinite(mechanism.anchorX) ? mechanism.anchorX ?? 0 : 0,
    y: Number.isFinite(mechanism.anchorY) ? mechanism.anchorY ?? 0 : 0,
  };
  const target = targetPoints.reduce(
    (center, point) => ({ x: center.x + point.x / targetPoints.length, y: center.y + point.y / targetPoints.length }),
    { x: 0, y: 0 },
  );
  return [...anchors]
    .sort((left, right) => {
      const leftDistance = Math.min(
        Math.hypot(left.x - anchor.x, left.y - anchor.y),
        Math.hypot(left.x - target.x, left.y - target.y),
      );
      const rightDistance = Math.min(
        Math.hypot(right.x - anchor.x, right.y - anchor.y),
        Math.hypot(right.x - target.x, right.y - target.y),
      );
      return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
    })
    .slice(0, FOUR_BAR_FIT_ANCHOR_LIMIT);
};

const fourBarFitSummary = (mechanism: MechanismConfig) => {
  const coupler = FABRICATION_LINKAGE_SPECS.find(spec =>
    spec.holeCentersMm.length >= 4 &&
    Math.abs(spec.lengthMm * SCENE_PX_PER_MM - Math.abs(mechanism.couplerLength)) <= 1e-6,
  );
  return coupler ? `Snapped: ${coupler.holeCentersMm.length}-hole` : undefined;
};

const withFourBarFitSnapOutcome = (
  project: ProjectState,
  prior: MechanismConfig,
  result: AutomaticFitResult,
): AutomaticFitResult => {
  if (!result.accepted) return { ...result, snapped: false };
  const snapped = !mechanismUsesExactFabricationCombination(prior, project.settings.physicalKit);
  const summary = snapped ? fourBarFitSummary(result.mechanism) : undefined;
  return {
    ...result,
    snapped,
    ...(summary ? { summary } : {}),
  };
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
  const result = fitFourBarKitMechanismToPathResult(project, mechanism, path);
  return result.accepted ? result.mechanism : undefined;
};

export const fitFourBarKitMechanismToPathResult = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
  options: FourBarFitOptions = {},
): AutomaticFitResult => {
  const targetPoints = resamplePolyline(pathPointsForFit(path), 32);
  if (targetPoints.length < 3) {
    const readiness = mechanismReadiness(project, mechanism);
    return {
      mechanism,
      accepted: false,
      snapped: false,
      readiness,
      blockers: ['Draw a path.'],
    };
  }
  const motionReach = pathMotionReach(project, path);
  const kitLengths = FABRICATION_LINKAGE_SPECS.map(
    (spec) => spec.lengthMm * SCENE_PX_PER_MM,
  );
  const anchors = nearestFitAnchors(
    boardAnchorCandidatesForFit(project, path, mechanism),
    mechanism,
    targetPoints,
  );
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const pitch = project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM;
  const maxSpan = project.settings.physicalKit.boardCells - 1;
  const groundLengthsForAngle = (angle: number) =>
    Array.from(
      { length: maxSpan },
      (_, index) =>
        (index + 1) * pitch * (angle % 90 === 0 ? 1 : Math.SQRT2),
    );
  const resolvedConnections = resolveFourBarConnectionSelections(mechanism);
  const inputAccepted = connectionSelectionAccepted(
    resolvedConnections.validation,
    '4bar.input-joint',
  );
  const outputAccepted = connectionSelectionAccepted(
    resolvedConnections.validation,
    '4bar.output-joint',
  );
  const crankLengths = inputAccepted && resolvedConnections.inputJoint
    ? [resolvedConnections.inputJoint.length]
    : nearestValues(kitLengths, mechanism.crankLength, FOUR_BAR_FIT_LENGTH_LIMIT);
  const rockerLengths = outputAccepted && resolvedConnections.outputJoint
    ? [resolvedConnections.outputJoint.length]
    : nearestValues(kitLengths, mechanism.rockerLength, FOUR_BAR_FIT_LENGTH_LIMIT);
  const hasAuthoredBoundary =
    mechanism.connectionSelections !== undefined ||
    mechanism.connectionSelectionValidation !== undefined;
  const modes: Array<MechanismConfig['assemblyMode']> = [
    mechanism.assemblyMode ?? 'open',
  ];
  const fitScale = Math.max(1, pathMetrics(path).length);
  const top: Array<{
    mechanism: MechanismConfig;
    error: number;
  }> = [];
  const rememberCandidate = (
    mechanismCandidate: MechanismConfig,
    error: number,
  ) => {
    if (top.length >= FOUR_BAR_FIT_DISCOVERY_LIMIT && error >= top.at(-1)!.error) return;
    top.push({ mechanism: mechanismCandidate, error });
    top.sort((a, b) => a.error - b.error);
    if (top.length > FOUR_BAR_FIT_DISCOVERY_LIMIT) top.pop();
  };

  for (const anchor of anchors) {
    for (const groundAngle of angles) {
      for (const groundLength of nearestValues(
        groundLengthsForAngle(groundAngle),
        mechanism.groundLength,
        FOUR_BAR_FIT_GROUND_LIMIT,
      )) {
        for (const crankLength of crankLengths) {
          for (const couplerLength of nearestValues(
            kitLengths,
            mechanism.couplerLength,
            FOUR_BAR_FIT_LENGTH_LIMIT,
          )) {
            for (const rockerLength of rockerLengths) {
              if (
                !isLikelyFullRotationFourBar(
                  groundLength,
                  crankLength,
                  couplerLength,
                  rockerLength,
                )
              )
                continue;
              for (const assemblyMode of modes) {
                const authoredCandidate: MechanismConfig = {
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
                  ...pathOwnedTargetFields(path),
                  source: 'optimized',
                  recommendation: 'Fit path',
                };
                const traces = generateMechanismPointTraces(
                  authoredCandidate,
                  FOUR_BAR_FIT_COARSE_TRACE_RESOLUTION,
                  project.settings.physicalKit,
                );
                if (traces.percentValid < 0.98) continue;
                const movingTraces = traces.traces.filter((trace) => trace.primary);
                for (const trace of movingTraces) {
                  const tracePoints = resamplePolyline(trace.points, 32);
                  const error = pathFitError(tracePoints, targetPoints);
                  rememberCandidate(authoredCandidate, error);
                }
              }
            }
          }
        }
      }
    }
  }
  const ranked = top.flatMap(({ mechanism: candidate, error }) => {
    const normalizedCandidate = hasAuthoredBoundary
      ? normalizeAuthoredMechanismToFabricationSet(candidate)
      : normalizeMechanismToFabricationSet(candidate);
    const materialized = normalizeMechanismWithFabricationSelections(
      { ...normalizedCandidate, groundLength: candidate.groundLength },
      project.settings.physicalKit,
    );
    if (!mechanismEditIsSafe(materialized, project.settings.physicalKit)) return [];
    const traces = generateMechanismPointTraces(materialized, 36, project.settings.physicalKit);
    if (traces.percentValid < 0.98) return [];
    const movingTrace = traces.traces.find(trace => trace.primary);
    if (!movingTrace) return [];
    return [{ mechanism: materialized, error: pathFitError(resamplePolyline(movingTrace.points, 32), targetPoints) + error * 1e-6 }];
  }).sort((left, right) => left.error - right.error).slice(0, FOUR_BAR_FIT_VALIDATION_LIMIT);
  const rejected: AutomaticFitResult[] = [];
  const validateCandidate = options.validateCandidate ?? completeAutomaticFitCandidate;
  for (const candidate of ranked) {
    const candidateWithGeneratedPath = mechanismWithGeneratedPath({
      ...candidate.mechanism,
      warnings:
        candidate.error / fitScale > 0.5
          ? ['Closest kit fit. Try a smaller move if it misses.']
          : [],
    }, { kit: project.settings.physicalKit });
    if (
      motionReach &&
      candidateWithGeneratedPath.generatedPath?.some(
        (point) =>
          Math.hypot(point.x - motionReach.root.x, point.y - motionReach.root.y) >
          motionReach.reach + 1e-6,
      )
    ) continue;
    const completed = validateCandidate(project, mechanism, candidateWithGeneratedPath);
    if (completed.accepted) return withFourBarFitSnapOutcome(project, mechanism, completed);
    rejected.push(completed);
  }
  const readiness = mechanismReadiness(project, mechanism);
  return {
    mechanism,
    accepted: false,
    snapped: false,
    readiness,
    blockers: rejected.length
      ? [...new Set(rejected.flatMap(result => result.blockers))]
      : ['No simulation-safe four-bar fit.'],
  };
};

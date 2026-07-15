import type { MechanismConfig, MechanismRecoveryCandidates, Point, ProjectMotionPath, ProjectState } from '../types';
import { boardToScene, sceneToBoard, SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_LINKAGE_SPECS } from './fabricationContract';
import { generateMechanismPointTraces } from './kinematics';
import {
  connectionSelectionAccepted,
  normalizeAuthoredMechanismToFabricationSet,
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
import { resolveMechanismEditAttempt } from './mechanismEditAuthority';

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
  readiness: MechanismReadinessResult;
  blockers: string[];
  recoveryCandidates?: MechanismRecoveryCandidates;
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
): AutomaticFitResult => {
  const targetPoints = resamplePolyline(pathPointsForFit(path), 32);
  if (targetPoints.length < 3) {
    const readiness = mechanismReadiness(project, mechanism);
    return {
      mechanism,
      accepted: false,
      readiness,
      blockers: ['Draw a path.'],
    };
  }
  const motionReach = pathMotionReach(project, path);
  const kitLengths = FABRICATION_LINKAGE_SPECS.map(
    (spec) => spec.lengthMm * SCENE_PX_PER_MM,
  );
  const anchors = boardAnchorCandidatesForFit(project, path, mechanism);
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
    : kitLengths;
  const rockerLengths = outputAccepted && resolvedConnections.outputJoint
    ? [resolvedConnections.outputJoint.length]
    : kitLengths;
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
    if (top.length >= 12 && error >= top.at(-1)!.error) return;
    top.push({ mechanism: mechanismCandidate, error });
    top.sort((a, b) => a.error - b.error);
    if (top.length > 12) top.pop();
  };

  for (const anchor of anchors) {
    for (const groundAngle of angles) {
      for (const groundLength of groundLengthsForAngle(groundAngle)) {
        for (const crankLength of crankLengths) {
          for (const couplerLength of kitLengths) {
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
                const normalizedCandidate = hasAuthoredBoundary
                  ? normalizeAuthoredMechanismToFabricationSet(authoredCandidate)
                  : normalizeMechanismToFabricationSet(authoredCandidate);
                const candidate = { ...normalizedCandidate, groundLength };
                const traces = generateMechanismPointTraces(candidate, 36);
                if (traces.percentValid < 0.98) continue;
                const movingTraces = traces.traces.filter((trace) => trace.primary);
                for (const trace of movingTraces) {
                  const tracePoints = resamplePolyline(trace.points, 32);
                  const error = pathFitError(tracePoints, targetPoints);
                  const candidateWithGeneratedPath = mechanismWithGeneratedPath({
                    ...candidate,
                    warnings:
                      error / fitScale > 0.5
                        ? ['Closest kit fit. Try a smaller move if it misses.']
                        : [],
                  });
                  if (
                    motionReach &&
                    candidateWithGeneratedPath.generatedPath?.some(
                      (point) =>
                        Math.hypot(
                          point.x - motionReach.root.x,
                          point.y - motionReach.root.y,
                        ) >
                        motionReach.reach + 1e-6,
                    )
                  )
                    continue;
                  rememberCandidate(candidateWithGeneratedPath, error);
                }
              }
            }
          }
        }
      }
    }
  }
  const rejected: AutomaticFitResult[] = [];
  for (const candidate of top) {
    const completed = completeAutomaticFitCandidate(project, mechanism, candidate.mechanism);
    if (completed.accepted) return completed;
    rejected.push(completed);
  }
  const readiness = mechanismReadiness(project, mechanism);
  return {
    mechanism,
    accepted: false,
    readiness,
    blockers: rejected.length
      ? [...new Set(rejected.flatMap(result => result.blockers))]
      : ['No simulation-safe four-bar fit.'],
  };
};

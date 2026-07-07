import type { MechanismConfig, Point, ProjectMotionPath, ProjectState } from '../types';
import { boardToScene, sceneToBoard, SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_LINKAGE_SPECS } from './fabricationContract';
import { validateMechanismPreviewReadiness, validateForFabrication } from './fabrication';
import { generateMechanismPointTraces } from './kinematics';
import { normalizeMechanismToFabricationSet } from './mechanismReference';
import { mechanismWithGeneratedPath } from './project';

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

const fabricationErrorsForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const readinessErrors = validateMechanismPreviewReadiness(mechanism, project.settings.physicalKit);
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
      ...readinessErrors,
      ...validateForFabrication(candidateProject).errors.filter(
        (error) => !baseline.has(error),
      ),
    ]),
  ];
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

const averageNearestDistance = (from: Point[], to: Point[]) =>
  from.reduce((sum, point) => {
    const nearest = to.reduce(
      (best, candidate) =>
        Math.min(best, Math.hypot(point.x - candidate.x, point.y - candidate.y)),
      Number.POSITIVE_INFINITY,
    );
    return sum + nearest;
  }, 0) / Math.max(1, from.length);

const pathFitError = (candidate: Point[], target: Point[]) =>
  averageNearestDistance(candidate, target) +
  averageNearestDistance(target, candidate);

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
  const targetPoints = resamplePolyline(pathPointsForFit(path), 32);
  if (targetPoints.length < 3) return undefined;
  const kitLengths = FABRICATION_LINKAGE_SPECS.map(
    (spec) => spec.lengthMm * SCENE_PX_PER_MM,
  );
  const anchors = boardAnchorCandidatesForFit(project, path, mechanism);
  const validationProject = {
    ...project,
    mechanisms: project.mechanisms.filter(
      (existing) => existing.id === mechanism.id || existing.targetPathId !== path.id,
    ),
  };
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
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
    for (const groundLength of kitLengths) {
      for (const crankLength of kitLengths) {
        for (const couplerLength of kitLengths) {
          for (const rockerLength of kitLengths) {
            if (
              !isLikelyFullRotationFourBar(
                groundLength,
                crankLength,
                couplerLength,
                rockerLength,
              )
            )
              continue;
            for (const groundAngle of angles) {
              for (const assemblyMode of modes) {
                const candidate = normalizeMechanismToFabricationSet({
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
                  targetPartId: path.sceneObjectId ? undefined : (mechanism.targetPartId ?? path.partId),
                  targetSceneObjectId: path.sceneObjectId,
                  targetPathId: path.id,
                  targetAnchorJointId: path.sceneObjectId
                    ? undefined
                    : (mechanism.targetAnchorJointId ?? path.targetAnchorJointId),
                  activeVisualPartIds: path.sceneObjectId ? [] : [mechanism.targetPartId ?? path.partId],
                  source: 'optimized',
                  recommendation: 'Fit path',
                });
                const traces = generateMechanismPointTraces(candidate, 36);
                if (traces.percentValid < 0.98) continue;
                const movingTraces = traces.traces.filter((trace) =>
                  trace.id === 'B' || trace.id === 'C',
                );
                for (const trace of movingTraces) {
                  const tracePoints = resamplePolyline(trace.points, 32);
                  const error = pathFitError(tracePoints, targetPoints);
                  const candidateWithTrace = mechanismWithGeneratedPath(
                    {
                      ...candidate,
                      generatedPath: trace.points,
                      warnings:
                        error / fitScale > 0.35
                          ? ['Closest kit fit. Try a smaller move if it misses.']
                          : [],
                    },
                    { preserveGeneratedPath: true },
                  );
                  rememberCandidate(candidateWithTrace, error);
                }
              }
            }
          }
        }
      }
    }
  }
  return top.find(
    (candidate) =>
      !fabricationErrorsForCandidate(validationProject, candidate.mechanism).length,
  )?.mechanism;
};

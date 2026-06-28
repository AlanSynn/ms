import type { MechanismConfig, Point } from '../types';
import { calculateLinkage, generateCurvePoints, planetaryRingPitchRadius } from './kinematics';

export const pointsToSvgPath = (points: Point[]) => points.length ? `M ${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}` : '';

export const fitPointsToBox = (points: Point[], width: number, height: number): Point[] => {
  if (!points.length) return [];
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 60) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
  const tx = width / 2 - ((minX + maxX) / 2) * scale;
  const ty = height / 2 + ((minY + maxY) / 2) * scale;
  return points.map(p => ({ x: p.x * scale + tx, y: ty - p.y * scale }));
};

export const fitPathToBox = (points: Point[], width: number, height: number) => pointsToSvgPath(fitPointsToBox(points, width, height));

export type MechanismFitContext = {
  pathPoints: Point[];
  pathD: string;
  scale: number;
  map: (point: Point) => Point;
};

export const createMechanismFitContext = (mechanism: MechanismConfig, width: number, height: number, resolution = 72): MechanismFitContext => {
  const pathPoints = generateCurvePoints(mechanism, resolution).points;
  const sweepBounds: Point[] = [];
  const addRadiusBounds = (center: Point | undefined, radius: number, target = sweepBounds) => {
    if (!center || !Number.isFinite(radius) || radius <= 0) return;
    target.push(
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius }
    );
  };
  for (let i = 0; i < Math.max(12, resolution); i += 1) {
    const sampleState = calculateLinkage(mechanism, (i / Math.max(12, resolution)) * Math.PI * 2);
    sweepBounds.push(...[sampleState.p1, sampleState.p2, sampleState.j1, sampleState.j2, sampleState.aux, sampleState.effector].filter((point): point is Point => Boolean(point)));
    if (mechanism.type === 'cam') addRadiusBounds(sampleState.p1, mechanism.crankLength * 1.35);
    if (mechanism.type === 'gear' || mechanism.type === '5bar' || mechanism.type === 'rack-pinion') {
      addRadiusBounds(sampleState.p1, mechanism.crankLength);
      addRadiusBounds(sampleState.p2, mechanism.rockerLength);
    }
    if (mechanism.type === 'planetary_gear') {
      addRadiusBounds(sampleState.p1, planetaryRingPitchRadius(mechanism.crankLength, mechanism.rockerLength));
      addRadiusBounds(sampleState.p2, mechanism.rockerLength);
    }
  }
  const source = [...pathPoints, ...sweepBounds];
  if (!source.length) {
    const map = (point: Point): Point => point;
    return { pathPoints: [], pathD: '', scale: 1, map };
  }
  const xs = source.map(p => p.x), ys = source.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 34) / Math.max(1, maxX - minX), (height - 32) / Math.max(1, maxY - minY));
  const tx = width / 2 - ((minX + maxX) / 2) * scale;
  const ty = height / 2 + ((minY + maxY) / 2) * scale;
  const map = (point: Point): Point => ({ x: point.x * scale + tx, y: ty - point.y * scale });
  const fittedPath = pathPoints.map(map);
  return { pathPoints: fittedPath, pathD: pointsToSvgPath(fittedPath), scale, map };
};

export const fitMechanismSimulationWithContext = (mechanism: MechanismConfig, angle: number, context: MechanismFitContext) => {
  const state = calculateLinkage(mechanism, angle);
  const map = context.map;
  return {
    pathPoints: context.pathPoints,
    pathD: context.pathD,
    scale: context.scale,
    state: {
      ...state,
      p1: map(state.p1),
      p2: map(state.p2),
      j1: map(state.j1),
      j2: map(state.j2),
      aux: state.aux ? map(state.aux) : undefined,
      effector: map(state.effector)
    }
  };
};

export const fitMechanismSimulation = (mechanism: MechanismConfig, angle: number, width: number, height: number, resolution = 72) => fitMechanismSimulationWithContext(
  mechanism,
  angle,
  createMechanismFitContext(mechanism, width, height, resolution)
);

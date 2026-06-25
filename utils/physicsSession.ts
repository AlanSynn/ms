import type { Point, ProjectState } from '../types';
import { calculateLinkage } from './kinematics';
import type { ProjectionSourceType, ToonSceneProjection } from './sceneProjection';

export type PhysicsBodyKind = 'fixed' | 'kinematic' | 'joint' | 'driver';
export type PhysicsConstraintKind = 'pin' | 'rod' | 'guide' | 'target';

export interface PhysicsBodySample {
  id: string;
  nodeId?: string;
  mechanismId?: string;
  sourceType: ProjectionSourceType | 'mechanism-state';
  sourceId?: string;
  label: string;
  kind: PhysicsBodyKind;
  position: { x: number; y: number; zMm: number };
  velocity: Point;
  force: Point;
}

export interface PhysicsConstraintSample {
  id: string;
  mechanismId?: string;
  kind: PhysicsConstraintKind;
  a: Point;
  b: Point;
  length: number;
  error: number;
  label: string;
}

export interface PhysicsSessionWarning {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceId?: string;
}

export interface PhysicsSession {
  version: 1;
  sourceProjectionVersion: 1;
  angleRad: number;
  stepMs: number;
  bodies: PhysicsBodySample[];
  constraints: PhysicsConstraintSample[];
  warnings: PhysicsSessionWarning[];
  summary: {
    bodyCount: number;
    constraintCount: number;
    activeMechanismCount: number;
    maxSpeed: number;
    maxForce: number;
  };
}

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const cleanPoint = (point: Point): Point => ({ x: finite(point.x), y: finite(point.y) });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const geometryAnchor = (geometry: ToonSceneProjection['nodes'][number]['geometry']): Point => {
  if (geometry.kind === 'circle' || geometry.kind === 'rect') return cleanPoint(geometry.center);
  if (geometry.kind === 'line') return { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 };
  if (!geometry.points.length) return { x: 0, y: 0 };
  const sum = geometry.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / geometry.points.length, y: sum.y / geometry.points.length };
};

const velocityBetween = (previous: Point, next: Point, stepMs: number): Point => {
  const seconds = Math.max(1e-6, (stepMs * 2) / 1000);
  return { x: finite((next.x - previous.x) / seconds), y: finite((next.y - previous.y) / seconds) };
};

const forceFromVelocity = (velocity: Point): Point => ({ x: finite(velocity.x * 0.08), y: finite(velocity.y * 0.08) });

const addConstraint = (constraints: PhysicsConstraintSample[], id: string, kind: PhysicsConstraintKind, a: Point, b: Point, expectedLength: number, label: string, mechanismId?: string) => {
  const currentLength = distance(a, b);
  constraints.push({
    id,
    mechanismId,
    kind,
    a: cleanPoint(a),
    b: cleanPoint(b),
    length: finite(currentLength),
    error: finite(Math.abs(currentLength - expectedLength)),
    label
  });
};

const resolvedAnchor = (mechanism: ProjectState['mechanisms'][number]): Point => ({
  x: finite(mechanism.anchorX ?? mechanism.sceneAnchor?.x ?? mechanism.transform?.x),
  y: finite(mechanism.anchorY ?? mechanism.sceneAnchor?.y ?? mechanism.transform?.y)
});

export const buildKinematicPhysicsSession = (
  project: ProjectState,
  projection: ToonSceneProjection,
  angleRad = 0,
  stepMs = 16.667
): PhysicsSession => {
  const bodies: PhysicsBodySample[] = [];
  const constraints: PhysicsConstraintSample[] = [];
  const warnings: PhysicsSessionWarning[] = projection.warnings.map(warning => ({
    id: `/physics${warning.id}`,
    severity: warning.severity,
    message: warning.message,
    sourceId: warning.sourceId
  }));

  projection.nodes
    .filter(node => ['part', 'joint', 'mechanism', 'hardware'].includes(node.sourceType))
    .forEach(node => {
      const anchor = geometryAnchor(node.geometry);
      bodies.push({
        id: `/physics/body${node.id}`,
        nodeId: node.id,
        sourceType: node.sourceType,
        sourceId: node.sourceId,
        label: node.label,
        kind: node.sourceType === 'joint' ? 'joint' : node.sourceType === 'part' ? 'fixed' : 'kinematic',
        position: { x: finite(anchor.x), y: finite(anchor.y), zMm: finite(node.depthMm) },
        velocity: { x: 0, y: 0 },
        force: { x: 0, y: 0 }
      });
    });

  project.mechanisms
    .filter(mechanism => mechanism.visible && mechanism.enabled !== false)
    .forEach(mechanism => {
      const anchor = resolvedAnchor(mechanism);
      const resolved = { ...mechanism, anchorX: anchor.x, anchorY: anchor.y };
      const current = calculateLinkage(resolved, angleRad);
      const previous = calculateLinkage(resolved, angleRad - 0.02);
      const next = calculateLinkage(resolved, angleRad + 0.02);
      const depth = projection.nodes.find(node => node.sourceType === 'mechanism' && node.sourceId === mechanism.id)?.depthMm ?? 25;
      const samples: Array<[string, Point, Point, Point, PhysicsBodyKind]> = [
        ['p1', current.p1, previous.p1, next.p1, 'driver'],
        ['p2', current.p2, previous.p2, next.p2, 'fixed'],
        ['j1', current.j1, previous.j1, next.j1, 'kinematic'],
        ['j2', current.j2, previous.j2, next.j2, 'kinematic'],
        ['effector', current.effector, previous.effector, next.effector, 'kinematic']
      ];
      if (current.aux && previous.aux && next.aux) samples.push(['aux', current.aux, previous.aux, next.aux, 'kinematic']);
      samples.forEach(([sampleId, point, prevPoint, nextPoint, kind]) => {
        const velocity = velocityBetween(prevPoint, nextPoint, stepMs);
        bodies.push({
          id: `/physics/mechanisms/${mechanism.id}/${sampleId}`,
          mechanismId: mechanism.id,
          sourceType: 'mechanism-state',
          sourceId: mechanism.id,
          label: `${mechanism.type} ${sampleId}`,
          kind,
          position: { x: finite(point.x), y: finite(point.y), zMm: finite(depth + 0.7) },
          velocity,
          force: forceFromVelocity(velocity)
        });
      });
      addConstraint(constraints, `/physics/constraints/${mechanism.id}/crank`, 'rod', current.p1, current.j1, finite(mechanism.crankLength), 'crank length', mechanism.id);
      addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'coupler length', mechanism.id);
      addConstraint(constraints, `/physics/constraints/${mechanism.id}/rocker`, 'rod', current.j2, current.p2, finite(mechanism.rockerLength), 'rocker length', mechanism.id);
      addConstraint(constraints, `/physics/constraints/${mechanism.id}/target`, 'target', current.effector, current.effector, 0, 'end effector target', mechanism.id);
      if (!current.isValid) warnings.push({ id: `/physics/warnings/${mechanism.id}/invalid`, severity: 'warning', message: `${mechanism.type} kinematic sample is outside its valid linkage range.`, sourceId: mechanism.id });
    });

  const maxSpeed = bodies.reduce((max, body) => Math.max(max, Math.hypot(body.velocity.x, body.velocity.y)), 0);
  const maxForce = bodies.reduce((max, body) => Math.max(max, Math.hypot(body.force.x, body.force.y)), 0);
  return {
    version: 1,
    sourceProjectionVersion: projection.version,
    angleRad: finite(angleRad),
    stepMs: finite(stepMs, 16.667),
    bodies: bodies.sort((a, b) => a.id.localeCompare(b.id)),
    constraints: constraints.sort((a, b) => a.id.localeCompare(b.id)),
    warnings: warnings.sort((a, b) => a.id.localeCompare(b.id)),
    summary: {
      bodyCount: bodies.length,
      constraintCount: constraints.length,
      activeMechanismCount: project.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false).length,
      maxSpeed: finite(maxSpeed),
      maxForce: finite(maxForce)
    }
  };
};

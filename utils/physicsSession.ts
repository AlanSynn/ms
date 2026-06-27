import type { MechanismConfig, MechanismType, Point, ProjectState } from '../types';
import { calculateLinkage, gearTrainPitchCenterDistance } from './kinematics';
import { mechanismTemplateLabel } from './mechanismTemplates';
import type { ProjectionSourceType, ToonSceneProjection } from './sceneProjection';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY } from './physicsKernel';

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
    maxConstraintError: number;
    frictionCoefficient: number;
    massKg: number;
    renderStack: typeof PHYSICS_RENDER_STACK;
    physicsKernel: typeof PHYSICS_KERNEL_ENGINE;
    updatePolicy: typeof PHYSICS_UPDATE_POLICY;
    scenePolicy: typeof HIGH_THROUGHPUT_SCENE_POLICY;
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

const forceFromAcceleration = (previous: Point, current: Point, next: Point, stepMs: number, massKg: number): Point => {
  const seconds = Math.max(1e-6, stepMs / 1000);
  // Scaled for display/export readability while preserving F = m·a direction.
  return {
    x: finite(((next.x - 2 * current.x + previous.x) / (seconds * seconds)) * 0.001 * massKg),
    y: finite(((next.y - 2 * current.y + previous.y) / (seconds * seconds)) * 0.001 * massKg)
  };
};

const frictionForce = (velocity: Point, massKg: number, coefficient: number): Point => {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!Number.isFinite(speed) || speed < 1e-6 || coefficient <= 0) return { x: 0, y: 0 };
  const magnitude = coefficient * massKg * 9.81;
  return { x: finite((-velocity.x / speed) * magnitude), y: finite((-velocity.y / speed) * magnitude) };
};

const add = (a: Point, b: Point): Point => ({ x: finite(a.x + b.x), y: finite(a.y + b.y) });

export interface FoundryPhysicsSimulation {
  state: ReturnType<typeof calculateLinkage>;
  scale: number;
  pathPoints: Point[];
}

export interface FoundryPhysicsOverlay {
  playIndex: number;
  playhead?: Point;
  velocityRaw: Point;
  accelerationRaw: Point;
  forceRaw: Point;
  velocityMagnitude: number;
  frictionMagnitude: number;
  forceMagnitude: number;
  velocityTip?: Point;
  forceTip?: Point;
  frictionTip?: Point;
  driveTip?: Point;
  constraintError: number;
  rule: string;
}

const MECHANISM_PHYSICS_RULES: Record<MechanismType, string> = {
  '4bar': 'pin reactions + coupler acceleration',
  piston: 'slider thrust + guide normal force',
  yoke: 'pin-in-slot thrust + guide reaction',
  'quick-return': 'slotted-arm torque + uneven return velocity',
  '5bar': 'dual crank torque + coupler acceleration',
  '6bar': 'four-bar base + dyad follower reactions',
  cam: 'cam normal force + follower lift velocity',
  'rack-pinion': 'gear mesh tangent force + rack velocity',
  gear: 'gear mesh force + opposite angular velocity',
  planetary_gear: 'sun/planet mesh force + carrier velocity',
  crank: 'driver torque + tangential velocity'
};

export const mechanismPhysicsRule = (type: MechanismType) => MECHANISM_PHYSICS_RULES[type];

const unitVector = (x: number, y: number, fallback: Point = { x: 1, y: 0 }): Point => {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 0.001) return fallback;
  return { x: x / length, y: y / length };
};

const vectorEnd = (origin: Point, vector: Point, length: number): Point => ({
  x: origin.x + vector.x * length,
  y: origin.y + vector.y * length
});

const ensureVisibleVectorTip = (origin: Point, tip: Point): Point => ({
  x: Math.abs(tip.x - origin.x) < 1 ? Math.min(350, origin.x + 8) : tip.x,
  y: Math.abs(tip.y - origin.y) < 1 ? Math.max(10, origin.y - 8) : tip.y
});

const normalizedPhase = (phaseRad: number) => ((((phaseRad / (Math.PI * 2)) % 1) + 1) % 1);

const fittedDistance = (a?: Point, b?: Point) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;

const foundryConstraintError = (mechanism: MechanismConfig, simulation: FoundryPhysicsSimulation): number => {
  const s = simulation.state;
  const scaledLength = (length: number | undefined) => Math.max(0, finite(length ?? 0)) * simulation.scale;
  const errors = mechanism.type === 'gear'
    ? [Math.abs(fittedDistance(s.p1, s.p2) - scaledLength(gearTrainPitchCenterDistance(mechanism)))]
    : mechanism.type === 'planetary_gear'
      ? [Math.abs(fittedDistance(s.p1, s.p2) - scaledLength(mechanism.groundLength)), Math.abs(fittedDistance(s.p2, s.j2) - scaledLength(mechanism.rockerLength))]
      : mechanism.type === 'rack-pinion'
        ? [Math.abs(fittedDistance(s.p1, s.j1) - scaledLength(mechanism.crankLength)), fittedDistance(s.j2, s.p2)]
        : mechanism.type === 'cam'
          ? [fittedDistance(s.j2, s.p2), Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.rockerLength))]
          : mechanism.type === 'piston'
            ? [fittedDistance(s.j2, s.effector)]
            : mechanism.type === 'yoke'
              ? [Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.crankLength))]
              : mechanism.type === 'quick-return'
                ? [Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.couplerLength))]
                : mechanism.type === '5bar'
                  ? [Math.abs(fittedDistance(s.p2, s.aux ?? s.j2) - scaledLength(mechanism.rockerLength)), Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.couplerLength)), Math.abs(fittedDistance(s.aux ?? s.j2, s.j2) - scaledLength(mechanism.rodLength ?? 0))]
                  : mechanism.type === '6bar'
                    ? [Math.abs(fittedDistance(s.p1, s.j1) - scaledLength(mechanism.crankLength)), Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.couplerLength)), Math.abs(fittedDistance(s.j2, s.p2) - scaledLength(mechanism.rockerLength)), Math.abs(fittedDistance(s.j2, s.aux ?? s.effector) - scaledLength(mechanism.rodLength ?? 0)), Math.abs(fittedDistance(s.p2, s.aux ?? s.effector) - scaledLength(mechanism.couplerPointDist))]
                  : [Math.abs(fittedDistance(s.p1, s.j1) - scaledLength(mechanism.crankLength)), Math.abs(fittedDistance(s.j1, s.j2) - scaledLength(mechanism.couplerLength)), Math.abs(fittedDistance(s.j2, s.p2) - scaledLength(mechanism.rockerLength))];
  return Math.max(0, ...errors.filter(Number.isFinite));
};

export const buildFoundryPhysicsOverlay = (
  mechanism: MechanismConfig,
  simulation: FoundryPhysicsSimulation,
  phaseRad: number,
  settings: Pick<ProjectState['settings'], 'simulationFriction' | 'simulationMassKg'>,
  fallbackPathPoints: Point[] = []
): FoundryPhysicsOverlay => {
  const previewPoints = simulation.pathPoints.length ? simulation.pathPoints : fallbackPathPoints;
  const playIndex = previewPoints.length ? Math.floor(normalizedPhase(phaseRad) * previewPoints.length) : 0;
  const playhead = simulation.state.effector ?? previewPoints[playIndex];
  const pointAt = (index: number) => previewPoints.length ? previewPoints[((index % previewPoints.length) + previewPoints.length) % previewPoints.length] : playhead;
  const previousPoint = pointAt(playIndex - 1) ?? playhead ?? { x: 0, y: 0 };
  const nextPoint = pointAt(playIndex + 1) ?? playhead ?? { x: 0, y: 0 };
  const stepMs = 16.667;
  const centerSum = previewPoints.length
    ? previewPoints.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
    : playhead ?? { x: 0, y: 0 };
  const physicsCenter = previewPoints.length ? { x: centerSum.x / previewPoints.length, y: centerSum.y / previewPoints.length } : centerSum;
  const frictionCoefficient = finite(settings.simulationFriction, 0.18);
  const massKg = finite(settings.simulationMassKg, 1);
  const velocityRaw = velocityBetween(previousPoint, nextPoint, stepMs);
  const accelerationRaw = forceFromAcceleration(previousPoint, playhead ?? { x: 0, y: 0 }, nextPoint, stepMs, massKg);
  const frictionRaw = frictionForce(velocityRaw, massKg, frictionCoefficient);
  const forceRaw = add(accelerationRaw, frictionRaw);
  const driveRaw = {
    x: -(simulation.state.j1.y - simulation.state.p1.y),
    y: simulation.state.j1.x - simulation.state.p1.x
  };
  const velocityUnit = unitVector(velocityRaw.x, velocityRaw.y);
  const driveUnit = unitVector(driveRaw.x, driveRaw.y, velocityUnit);
  const radialUnit = unitVector(physicsCenter.x - (playhead?.x ?? physicsCenter.x), physicsCenter.y - (playhead?.y ?? physicsCenter.y), driveUnit);
  const forceUnit = unitVector(forceRaw.x, forceRaw.y, radialUnit);
  const frictionUnit = unitVector(frictionRaw.x, frictionRaw.y, { x: -velocityUnit.x, y: -velocityUnit.y });
  const velocityTip = playhead ? vectorEnd(playhead, velocityUnit, 42) : undefined;
  const forceTip = playhead ? vectorEnd(playhead, forceUnit, 38) : undefined;
  const frictionTip = playhead ? vectorEnd(playhead, frictionUnit, 30) : undefined;
  const driveTip = ensureVisibleVectorTip(simulation.state.j1, vectorEnd(simulation.state.j1, driveUnit, 34));
  const velocityMagnitude = Math.hypot(velocityRaw.x, velocityRaw.y);
  const frictionMagnitude = Math.hypot(frictionRaw.x, frictionRaw.y);
  const forceMagnitude = Math.hypot(forceRaw.x, forceRaw.y);
  return {
    playIndex,
    playhead,
    velocityRaw: cleanPoint(velocityRaw),
    accelerationRaw: cleanPoint(accelerationRaw),
    forceRaw: cleanPoint(forceRaw),
    velocityMagnitude: finite(velocityMagnitude),
    frictionMagnitude: finite(frictionMagnitude),
    forceMagnitude: finite(forceMagnitude),
    velocityTip,
    forceTip,
    frictionTip,
    driveTip,
    constraintError: finite(foundryConstraintError(mechanism, simulation)),
    rule: mechanismPhysicsRule(mechanism.type)
  };
};

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
  x: finite(mechanism.anchorX ?? mechanism.sceneAnchor?.x ?? mechanism.transform?.x ?? 0),
  y: finite(mechanism.anchorY ?? mechanism.sceneAnchor?.y ?? mechanism.transform?.y ?? 0)
});

export const buildKinematicPhysicsSession = (
  project: ProjectState,
  projection: ToonSceneProjection,
  angleRad = 0,
  stepMs = 16.667
): PhysicsSession => {
  const bodies: PhysicsBodySample[] = [];
  const constraints: PhysicsConstraintSample[] = [];
  const frictionCoefficient = finite(project.settings.simulationFriction, 0.18);
  const massKg = finite(project.settings.simulationMassKg, 1);
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
      const templateLabel = mechanismTemplateLabel(mechanism.type);
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
        const force = add(forceFromAcceleration(prevPoint, point, nextPoint, stepMs, massKg), frictionForce(velocity, massKg, frictionCoefficient));
        bodies.push({
          id: `/physics/mechanisms/${mechanism.id}/${sampleId}`,
          mechanismId: mechanism.id,
          sourceType: 'mechanism-state',
          sourceId: mechanism.id,
          label: `${templateLabel} ${sampleId}`,
          kind,
          position: { x: finite(point.x), y: finite(point.y), zMm: finite(depth + 0.7) },
          velocity,
          force
        });
      });
      const actualDistance = (a: Point, b: Point) => distance(a, b);
      const addCrankConstraint = () =>
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/crank`, 'rod', current.p1, current.j1, finite(mechanism.crankLength), 'crank length', mechanism.id);
      const addTargetConstraint = () =>
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/target`, 'target', current.effector, current.effector, 0, 'end effector target', mechanism.id);
      if (mechanism.type === 'crank') {
        addCrankConstraint();
      } else if (mechanism.type === '4bar') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'coupler length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/rocker`, 'rod', current.j2, current.p2, finite(mechanism.rockerLength), 'rocker length', mechanism.id);
      } else if (mechanism.type === '6bar') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'coupler length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/rocker`, 'rod', current.j2, current.p2, finite(mechanism.rockerLength), 'rocker length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/dyad`, 'rod', current.j2, current.aux ?? current.effector, finite(mechanism.rodLength ?? mechanism.couplerLength), 'six-bar dyad link length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/follower`, 'rod', current.p2, current.aux ?? current.effector, finite(mechanism.couplerPointDist), 'six-bar follower link length', mechanism.id);
      } else if (mechanism.type === '5bar') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/right-crank`, 'rod', current.p2, current.aux ?? current.j2, finite(mechanism.rockerLength), 'right crank phase rod', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/left-coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'left coupler length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/right-coupler`, 'rod', current.aux ?? current.j2, current.j2, finite(mechanism.rodLength ?? mechanism.couplerLength), 'right coupler length', mechanism.id);
      } else if (mechanism.type === 'piston') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'coupler length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/slider-guide`, 'guide', current.j2, current.j2, 0, 'slider guide', mechanism.id);
      } else if (mechanism.type === 'yoke') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/slot-guide`, 'guide', current.j1, current.j2, actualDistance(current.j1, current.j2), 'pin-in-slot guide', mechanism.id);
      } else if (mechanism.type === 'quick-return') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/rocker`, 'rod', current.p2, current.j2, finite(mechanism.rockerLength), 'rocker length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/slotted-arm`, 'guide', current.j1, current.j2, actualDistance(current.j1, current.j2), 'slotted-arm guide', mechanism.id);
      } else if (mechanism.type === 'cam') {
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/cam-radius`, 'pin', current.p1, current.j1, actualDistance(current.p1, current.j1), 'cam profile radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/follower-guide`, 'guide', current.j2, current.p2, 0, 'follower guide', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/cam-contact`, 'pin', current.j1, current.j2, actualDistance(current.j1, current.j2), 'cam follower contact', mechanism.id);
      } else if (mechanism.type === 'rack-pinion') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/rack-guide`, 'guide', current.j2, current.p2, 0, 'rack linear guide', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/pinion-contact`, 'pin', current.p1, current.j1, finite(mechanism.crankLength), 'pinion pitch contact', mechanism.id);
      } else if (mechanism.type === 'gear') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-radius`, 'rod', current.p2, current.j2, finite(mechanism.rockerLength), 'output pitch radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/gear-mesh`, 'guide', current.p1, current.p2, finite(gearTrainPitchCenterDistance(mechanism)), 'gear pitch mesh tangent', mechanism.id);
      } else if (mechanism.type === 'planetary_gear') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/carrier`, 'guide', current.p1, current.p2, finite(mechanism.groundLength), 'planet carrier radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/planet-mesh`, 'guide', current.p2, current.j2, finite(mechanism.rockerLength), 'planet gear mesh', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-arm`, 'rod', current.p2, current.effector, finite(mechanism.couplerPointDist), 'planet output arm', mechanism.id);
      }
      addTargetConstraint();
      if (!current.isValid) warnings.push({ id: `/physics/warnings/${mechanism.id}/invalid`, severity: 'warning', message: `${templateLabel} kinematic sample is outside its valid linkage range.`, sourceId: mechanism.id });
    });

  const maxSpeed = bodies.reduce((max, body) => Math.max(max, Math.hypot(body.velocity.x, body.velocity.y)), 0);
  const maxForce = bodies.reduce((max, body) => Math.max(max, Math.hypot(body.force.x, body.force.y)), 0);
  const maxConstraintError = constraints.reduce((max, constraint) => Math.max(max, constraint.error), 0);
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
      maxForce: finite(maxForce),
      maxConstraintError: finite(maxConstraintError),
      frictionCoefficient,
      massKg,
      renderStack: PHYSICS_RENDER_STACK,
      physicsKernel: PHYSICS_KERNEL_ENGINE,
      updatePolicy: PHYSICS_UPDATE_POLICY,
      scenePolicy: HIGH_THROUGHPUT_SCENE_POLICY
    }
  };
};

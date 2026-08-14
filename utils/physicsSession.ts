import type { ConnectionSelectionRole, MechanismConfig, MechanismType, Point, ProjectState } from '../types';
import {
  calculateLinkage,
  gearTrainResolvedCenterDistance,
  preparedCamFollowerConstraintError,
  prepareMechanismKinematics,
  type PreparedMechanismKinematics,
} from './kinematics';
import { physicalConnectionForRole, resolveMechanismPhysicalConnections } from './mechanismConnectionSelections';
import { mechanismTemplateLabel } from './mechanismTemplates';
import type { ProjectionSourceType, ToonSceneProjection } from './sceneProjection';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY } from './physicsKernel';
import { referencePhysicsRuleForType } from './mechanismReference';
import { runtimeMechanisms } from './mechanismRuntimePolicy';

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
    mechanismCompilerSignatures: string[];
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
  rawState?: ReturnType<typeof calculateLinkage>;
  scale: number;
  pathPoints: Point[];
}

export interface FoundryPhysicsOverlay {
  playIndex: number;
  playhead?: Point;
  playheadSource: 'coupler-output-joint' | 'guided-output-joint' | 'moving-output-joint' | 'mechanism-effector' | 'carrier-output' | 'effector-point' | 'path-sample';
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

export const mechanismPhysicsRule = (type: MechanismType) => referencePhysicsRuleForType(type);

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

const foundryPhysicalPlayhead = (
  mechanism: MechanismConfig,
  simulation: FoundryPhysicsSimulation,
  fallback?: Point
): { point?: Point; source: FoundryPhysicsOverlay['playheadSource'] } => {
  const s = simulation.state;
  if (mechanism.type === '6bar') {
    return { point: s.aux ?? s.j2 ?? fallback, source: 'coupler-output-joint' };
  }
  if (mechanism.type === '4bar' || mechanism.type === '5bar') {
    return { point: s.j2 ?? fallback, source: 'coupler-output-joint' };
  }
  if (mechanism.type === 'cam' || mechanism.type === 'piston' || mechanism.type === 'rack-pinion' || mechanism.type === 'yoke' || mechanism.type === 'quick-return') {
    return { point: s.j2 ?? s.effector ?? fallback, source: 'guided-output-joint' };
  }
  if (mechanism.type === 'gear_linkage') {
    return { point: s.effector ?? s.j2 ?? fallback, source: 'mechanism-effector' };
  }
  if (mechanism.type === 'planetary_gear') {
    return { point: s.p2 ?? s.aux ?? s.effector ?? fallback, source: 'carrier-output' };
  }
  if (mechanism.type === 'gear') {
    return { point: s.j2 ?? s.effector ?? fallback, source: 'moving-output-joint' };
  }
  return s.effector ? { point: s.effector, source: 'effector-point' } : { point: fallback, source: 'path-sample' };
};

const foundryConstraintError = (
  prepared: PreparedMechanismKinematics,
  simulation: FoundryPhysicsSimulation,
): number => {
  const { mechanism } = prepared;
  const s = simulation.state;
  const scaledLength = (length: number | undefined) => Math.max(0, finite(length ?? 0)) * simulation.scale;
  const errors = mechanism.type === 'gear'
    ? [Math.abs(fittedDistance(s.p1, s.p2) - scaledLength(gearTrainResolvedCenterDistance(mechanism)))]
    : mechanism.type === 'gear_linkage'
      ? [
        Math.abs(fittedDistance(s.p1, s.p2) - scaledLength(gearTrainResolvedCenterDistance(mechanism))),
        Math.abs(fittedDistance(s.p1, s.j1) - scaledLength(mechanism.couplerPointDist)),
        Math.abs(fittedDistance(s.p2, s.j2) - scaledLength(mechanism.couplerPointDist)),
        Math.abs(fittedDistance(s.j1, s.effector) - scaledLength(mechanism.couplerLength)),
        Math.abs(fittedDistance(s.j2, s.effector) - scaledLength(mechanism.couplerLength))
      ]
    : mechanism.type === 'planetary_gear'
      ? [Math.abs(fittedDistance(s.p1, s.p2) - scaledLength(mechanism.groundLength)), Math.abs(fittedDistance(s.p2, s.j2) - scaledLength(mechanism.rockerLength)), Math.abs(fittedDistance(s.p1, s.effector) - scaledLength(mechanism.couplerPointDist))]
      : mechanism.type === 'rack-pinion'
        ? [Math.abs(fittedDistance(s.p1, s.j1) - scaledLength(mechanism.crankLength)), fittedDistance(s.j2, s.p2)]
        : mechanism.type === 'cam'
          ? [preparedCamFollowerConstraintError(prepared, simulation.rawState ?? s)
            * (simulation.rawState ? simulation.scale : 1)]
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

export const buildPreparedFoundryPhysicsOverlay = (
  prepared: PreparedMechanismKinematics,
  simulation: FoundryPhysicsSimulation,
  phaseRad: number,
  settings: Pick<ProjectState['settings'], 'simulationFriction' | 'simulationMassKg'>,
  fallbackPathPoints: Point[] = []
): FoundryPhysicsOverlay => {
  const { mechanism } = prepared;
  const previewPoints = simulation.pathPoints.length ? simulation.pathPoints : fallbackPathPoints;
  const playIndex = previewPoints.length ? Math.floor(normalizedPhase(phaseRad) * previewPoints.length) : 0;
  const fallbackPlayhead = previewPoints[playIndex];
  const { point: playhead, source: playheadSource } = foundryPhysicalPlayhead(mechanism, simulation, fallbackPlayhead);
  const motionSample = fallbackPlayhead ?? playhead ?? simulation.state.effector;
  const pointAt = (index: number) => previewPoints.length ? previewPoints[((index % previewPoints.length) + previewPoints.length) % previewPoints.length] : motionSample;
  const previousPoint = pointAt(playIndex - 1) ?? motionSample ?? playhead ?? { x: 0, y: 0 };
  const nextPoint = pointAt(playIndex + 1) ?? motionSample ?? playhead ?? { x: 0, y: 0 };
  const stepMs = 16.667;
  const centerSum = previewPoints.length
    ? previewPoints.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
    : playhead ?? { x: 0, y: 0 };
  const physicsCenter = previewPoints.length ? { x: centerSum.x / previewPoints.length, y: centerSum.y / previewPoints.length } : centerSum;
  const frictionCoefficient = finite(settings.simulationFriction, 0.18);
  const massKg = finite(settings.simulationMassKg, 1);
  const velocityRaw = velocityBetween(previousPoint, nextPoint, stepMs);
  const accelerationRaw = forceFromAcceleration(previousPoint, motionSample ?? playhead ?? { x: 0, y: 0 }, nextPoint, stepMs, massKg);
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
    playheadSource,
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
    constraintError: finite(foundryConstraintError(prepared, simulation)),
    rule: mechanismPhysicsRule(mechanism.type)
  };
};

export const buildFoundryPhysicsOverlay = (
  mechanism: MechanismConfig,
  simulation: FoundryPhysicsSimulation,
  phaseRad: number,
  settings: Pick<ProjectState['settings'], 'simulationFriction' | 'simulationMassKg'>,
  fallbackPathPoints: Point[] = []
): FoundryPhysicsOverlay => buildPreparedFoundryPhysicsOverlay(
  prepareMechanismKinematics(mechanism),
  simulation,
  phaseRad,
  settings,
  fallbackPathPoints,
);

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
  const activeMechanisms = runtimeMechanisms(project);
  const activeMechanismIds = new Set(activeMechanisms.map((mechanism) => mechanism.id));
  const activeMechanismNodeIds = new Set(
    projection.nodes
      .filter((node) => node.sourceType === 'mechanism' && Boolean(node.sourceId && activeMechanismIds.has(node.sourceId)))
      .map((node) => node.id),
  );
  const mechanismCompilerSignatures = [...new Set(
    projection.nodes
      .filter((node) => node.sourceType === 'mechanism' && Boolean(node.sourceId && activeMechanismIds.has(node.sourceId)))
      .flatMap((node) => node.mechanismCompilerSignature ? [node.mechanismCompilerSignature] : []),
  )].sort();
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
    .filter(node =>
      node.sourceType === 'mechanism'
        ? Boolean(node.sourceId && activeMechanismIds.has(node.sourceId))
        : node.sourceType === 'hardware'
          ? Boolean(node.parentId && activeMechanismNodeIds.has(node.parentId))
          : true,
    )
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

  activeMechanisms.forEach(mechanism => {
      const templateLabel = mechanismTemplateLabel(mechanism.type);
      const anchor = resolvedAnchor(mechanism);
      const resolved = { ...mechanism, anchorX: anchor.x, anchorY: anchor.y };
      const current = calculateLinkage(resolved, angleRad, project.settings.physicalKit);
      const previous = calculateLinkage(resolved, angleRad - 0.02, project.settings.physicalKit);
      const next = calculateLinkage(resolved, angleRad + 0.02, project.settings.physicalKit);
      const physicalConnections = resolveMechanismPhysicalConnections(resolved, project.settings.physicalKit);
      const sourceLength = (role: ConnectionSelectionRole) =>
        physicalConnectionForRole(physicalConnections, role)?.local?.length ?? 0;
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
      const crankConstraintLength = () => {
        if (mechanism.type === '4bar') return sourceLength('4bar.input-joint');
        if (mechanism.type === 'piston') return sourceLength('piston.crank-pin');
        if (mechanism.type === 'gear') return sourceLength('gear.drive-pin');
        return finite(mechanism.crankLength);
      };
      const addCrankConstraint = () =>
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/crank`, 'rod', current.p1, current.j1, crankConstraintLength(), 'crank length', mechanism.id);
      const addTargetConstraint = () =>
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/target`, 'target', current.effector, current.effector, 0, 'end effector target', mechanism.id);
      if (mechanism.type === 'crank') {
        addCrankConstraint();
      } else if (mechanism.type === '4bar') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, finite(mechanism.couplerLength), 'coupler length', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/rocker`, 'rod', current.j2, current.p2, sourceLength('4bar.output-joint'), 'rocker length', mechanism.id);
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
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/coupler`, 'rod', current.j1, current.j2, sourceLength('piston.rod-slider-pin'), 'coupler length', mechanism.id);
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
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-radius`, 'rod', current.p2, current.j2, sourceLength('gear.output-pin'), 'output attachment radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/gear-span`, 'guide', current.p1, current.p2, finite(gearTrainResolvedCenterDistance(mechanism)), 'gear mesh pair', mechanism.id);
      } else if (mechanism.type === 'gear_linkage') {
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/drive-handle-radius`, 'rod', current.p1, current.j1, sourceLength('gear_linkage.drive-pin'), 'off-center drive gear handle radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-handle-radius`, 'rod', current.p2, current.j2, sourceLength('gear_linkage.output-pin'), 'off-center output gear handle radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/gear-span`, 'guide', current.p1, current.p2, finite(gearTrainResolvedCenterDistance(mechanism)), 'gear endpoint span', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/drive-linkage-arm`, 'rod', current.j1, current.effector, finite(mechanism.couplerLength), 'drive L4 linkage arm', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-linkage-arm`, 'rod', current.j2, current.effector, finite(mechanism.couplerLength), 'output L4 linkage arm', mechanism.id);
      } else if (mechanism.type === 'planetary_gear') {
        addCrankConstraint();
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/carrier`, 'guide', current.p1, current.p2, sourceLength('planetary_gear.carrier-planet-pivot'), 'planet carrier radius', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/planet-mesh`, 'guide', current.p2, current.j2, finite(mechanism.rockerLength), 'planet gear mesh', mechanism.id);
        addConstraint(constraints, `/physics/constraints/${mechanism.id}/output-arm`, 'rod', current.p1, current.effector, sourceLength('planetary_gear.carrier-output-hole'), 'carrier output radius', mechanism.id);
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
      activeMechanismCount: activeMechanisms.length,
      mechanismCompilerSignatures,
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

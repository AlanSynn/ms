import type { MechanismConfig, PhysicalKitSettings, Point } from '../types';
import {
    defaultPhysicalKit,
    sceneBoundsForBoard,
    sceneBoundsForSheet
} from './coordinates';
import { mechanismSafetyPhaseSchedule, synchronizedMechanismSafetyPhaseSchedule } from './kinematics';
import { FABRICATION_Z_EPSILON_MM } from './mechanismFabricationZStack';
import { compileMechanismGraphFabrication, compileMechanismRenderPlan } from './mechanismCompiler';
import {
    buildMechanismPhysicalEnvelopeDescriptors,
    type MechanismPhysicalEnvelopeDescriptor
} from './mechanismPhysicalEnvelope';

type Envelope = MechanismPhysicalEnvelopeDescriptor['envelope'];
type Segment = [Point, Point];

const GEOMETRIC_BOUNDARY_EPSILON = 1e-9;

const withinClosedRange = (value: number, min: number, max: number) =>
    value >= min - GEOMETRIC_BOUNDARY_EPSILON && value <= max + GEOMETRIC_BOUNDARY_EPSILON;

const pointWithinBounds = (point: Point, minX: number, maxX: number, minY: number, maxY: number) =>
    withinClosedRange(point.x, minX, maxX) && withinClosedRange(point.y, minY, maxY);

const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const capsuleSegment = (envelope: Extract<Envelope, { kind: 'capsule' }>): Segment => {
    const dx = Math.cos(envelope.rotation) * envelope.length / 2;
    const dy = Math.sin(envelope.rotation) * envelope.length / 2;
    return [{ x: envelope.x - dx, y: envelope.y - dy }, { x: envelope.x + dx, y: envelope.y + dy }];
};

const boxCorners = (envelope: Extract<Envelope, { kind: 'oriented-box' }>): Point[] => {
    const c = Math.cos(envelope.rotation);
    const s = Math.sin(envelope.rotation);
    const halfWidth = envelope.width / 2;
    const halfHeight = envelope.height / 2;
    return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
        x: envelope.x + x * c - y * s,
        y: envelope.y + x * s + y * c
    }));
};

const pointSegmentDistanceSquared = (point: Point, [a, b]: Segment) => {
    const ab = subtract(b, a);
    const denominator = dot(ab, ab);
    if (denominator === 0) return squaredDistance(point, a);
    const t = Math.max(0, Math.min(1, dot(subtract(point, a), ab) / denominator));
    return squaredDistance(point, { x: a.x + ab.x * t, y: a.y + ab.y * t });
};

const onSegment = (point: Point, [a, b]: Segment) =>
    cross(a, b, point) === 0
    && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
    && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);

const segmentsIntersect = ([a, b]: Segment, [c, d]: Segment) => {
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    return (abC === 0 && onSegment(c, [a, b]))
        || (abD === 0 && onSegment(d, [a, b]))
        || (cdA === 0 && onSegment(a, [c, d]))
        || (cdB === 0 && onSegment(b, [c, d]))
        || ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
};

const segmentDistanceSquared = (first: Segment, second: Segment) => {
    if (segmentsIntersect(first, second)) return 0;
    return Math.min(
        pointSegmentDistanceSquared(first[0], second),
        pointSegmentDistanceSquared(first[1], second),
        pointSegmentDistanceSquared(second[0], first),
        pointSegmentDistanceSquared(second[1], first)
    );
};

const toBoxLocal = (point: Point, box: Extract<Envelope, { kind: 'oriented-box' }>): Point => {
    const dx = point.x - box.x;
    const dy = point.y - box.y;
    const c = Math.cos(box.rotation);
    const s = Math.sin(box.rotation);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

const pointBoxDistanceSquared = (point: Point, box: Extract<Envelope, { kind: 'oriented-box' }>) => {
    const local = toBoxLocal(point, box);
    const dx = Math.max(Math.abs(local.x) - box.width / 2, 0);
    const dy = Math.max(Math.abs(local.y) - box.height / 2, 0);
    return dx * dx + dy * dy;
};

const segmentBoxDistanceSquared = (segment: Segment, box: Extract<Envelope, { kind: 'oriented-box' }>) => {
    const localSegment: Segment = [toBoxLocal(segment[0], box), toBoxLocal(segment[1], box)];
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    const corners: Point[] = [
        { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
    ];
    if (localSegment.some(point => Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight)) return 0;
    const edges = corners.map((corner, index): Segment => [corner, corners[(index + 1) % corners.length]]);
    return Math.min(...edges.map(edge => segmentDistanceSquared(localSegment, edge)));
};

const boxBoxIntersects = (
    first: Extract<Envelope, { kind: 'oriented-box' }>,
    second: Extract<Envelope, { kind: 'oriented-box' }>
) => {
    const firstCorners = boxCorners(first);
    const secondCorners = boxCorners(second);
    const axes = [first.rotation, first.rotation + Math.PI / 2, second.rotation, second.rotation + Math.PI / 2]
        .map(angle => ({ x: Math.cos(angle), y: Math.sin(angle) }));
    return axes.every(axis => {
        const firstProjection = firstCorners.map(point => dot(point, axis));
        const secondProjection = secondCorners.map(point => dot(point, axis));
        return Math.min(Math.max(...firstProjection), Math.max(...secondProjection))
            > Math.max(Math.min(...firstProjection), Math.min(...secondProjection));
    });
};

export const mechanismEnvelopesIntersect = (first: Envelope, second: Envelope): boolean => {
    if (first.kind === 'circle' && second.kind === 'circle') {
        return squaredDistance(first, second) < (first.radius + second.radius) ** 2;
    }
    if (first.kind === 'circle' && second.kind === 'capsule') {
        return pointSegmentDistanceSquared(first, capsuleSegment(second)) < (first.radius + second.radius) ** 2;
    }
    if (first.kind === 'capsule' && second.kind === 'circle') return mechanismEnvelopesIntersect(second, first);
    if (first.kind === 'circle' && second.kind === 'oriented-box') {
        return pointBoxDistanceSquared(first, second) < first.radius ** 2;
    }
    if (first.kind === 'oriented-box' && second.kind === 'circle') return mechanismEnvelopesIntersect(second, first);
    if (first.kind === 'capsule' && second.kind === 'capsule') {
        return segmentDistanceSquared(capsuleSegment(first), capsuleSegment(second)) < (first.radius + second.radius) ** 2;
    }
    if (first.kind === 'capsule' && second.kind === 'oriented-box') {
        return segmentBoxDistanceSquared(capsuleSegment(first), second) < first.radius ** 2;
    }
    if (first.kind === 'oriented-box' && second.kind === 'capsule') return mechanismEnvelopesIntersect(second, first);
    return boxBoxIntersects(
        first as Extract<Envelope, { kind: 'oriented-box' }>,
        second as Extract<Envelope, { kind: 'oriented-box' }>
    );
};

export const mechanismEnvelopeWithinSheet = (envelope: Envelope, kit: PhysicalKitSettings): boolean => {
    const sheet = sceneBoundsForSheet(kit);
    const minX = sheet.x;
    const maxX = sheet.x + sheet.width;
    const minY = sheet.y;
    const maxY = sheet.y + sheet.height;
    if (envelope.kind === 'circle') {
        return withinClosedRange(envelope.x - envelope.radius, minX, maxX)
            && withinClosedRange(envelope.x + envelope.radius, minX, maxX)
            && withinClosedRange(envelope.y - envelope.radius, minY, maxY)
            && withinClosedRange(envelope.y + envelope.radius, minY, maxY);
    }
    if (envelope.kind === 'capsule') {
        return capsuleSegment(envelope).every(point =>
            withinClosedRange(point.x - envelope.radius, minX, maxX)
            && withinClosedRange(point.x + envelope.radius, minX, maxX)
            && withinClosedRange(point.y - envelope.radius, minY, maxY)
            && withinClosedRange(point.y + envelope.radius, minY, maxY)
        );
    }
    return boxCorners(envelope).every(point => pointWithinBounds(point, minX, maxX, minY, maxY));
};

export const mechanismEnvelopeWithinBoard = (envelope: Envelope, kit: PhysicalKitSettings): boolean => {
    const board = sceneBoundsForBoard(kit);
    const minX = board.x;
    const maxX = board.x + board.width;
    const minY = board.y;
    const maxY = board.y + board.height;
    if (envelope.kind === 'circle') {
        return withinClosedRange(envelope.x - envelope.radius, minX, maxX)
            && withinClosedRange(envelope.x + envelope.radius, minX, maxX)
            && withinClosedRange(envelope.y - envelope.radius, minY, maxY)
            && withinClosedRange(envelope.y + envelope.radius, minY, maxY);
    }
    if (envelope.kind === 'capsule') {
        return capsuleSegment(envelope).every(point =>
            withinClosedRange(point.x - envelope.radius, minX, maxX)
            && withinClosedRange(point.x + envelope.radius, minX, maxX)
            && withinClosedRange(point.y - envelope.radius, minY, maxY)
            && withinClosedRange(point.y + envelope.radius, minY, maxY)
        );
    }
    return boxCorners(envelope).every(point => pointWithinBounds(point, minX, maxX, minY, maxY));
};

export const mechanismDescriptorWithinSheet = (
    descriptor: MechanismPhysicalEnvelopeDescriptor,
    kit: PhysicalKitSettings
) => mechanismEnvelopeWithinSheet(descriptor.envelope, kit);

export const mechanismDescriptorWithinBoard = (
    descriptor: MechanismPhysicalEnvelopeDescriptor,
    kit: PhysicalKitSettings
) => mechanismEnvelopeWithinBoard(descriptor.envelope, kit);

/**
 * Check one blank's two dimensions against the sheet axes. This is an
 * individual-part fit check, not a multi-part nesting proof.
 */
export const cutPartDimensionsFitSheet = (
    width: number,
    height: number,
    kit: PhysicalKitSettings,
) => {
    const sheet = sceneBoundsForSheet(kit);
    const tolerance = GEOMETRIC_BOUNDARY_EPSILON;
    return (width <= sheet.width + tolerance && height <= sheet.height + tolerance) ||
        (width <= sheet.height + tolerance && height <= sheet.width + tolerance);
};

/**
 * Cut sheets pack individual physical parts. Their fit must not depend on an
 * assembly's board-space position, which is validated separately.
 */
export const mechanismDescriptorFitsCutSheet = (
    descriptor: MechanismPhysicalEnvelopeDescriptor,
    kit: PhysicalKitSettings,
) => {
    const envelope = descriptor.envelope;
    if (envelope.kind === 'circle')
        return cutPartDimensionsFitSheet(envelope.radius * 2, envelope.radius * 2, kit);
    if (envelope.kind === 'capsule')
        return cutPartDimensionsFitSheet(
            envelope.length + envelope.radius * 2,
            envelope.radius * 2,
            kit,
        );
    return cutPartDimensionsFitSheet(envelope.width, envelope.height, kit);
};

export const mechanismFitsFabricationBoard = (
    mechanism: MechanismConfig,
    kit: PhysicalKitSettings
) => {
    const compiled = compileMechanismGraphFabrication(mechanism, kit);
    if (!compiled.buildable || compiled.renderPlan.validationErrors.length) return false;
    const descriptors = buildMechanismPhysicalEnvelopeDescriptors(
        mechanism,
        undefined,
        compiled.renderPlan,
        kit
    );
    return descriptors.length > 0
        && new Set(descriptors.map(descriptor => descriptor.phaseIndex)).size === mechanismSafetyPhaseSchedule(mechanism.type).length
        && descriptors.every(descriptor => mechanismDescriptorWithinBoard(descriptor, kit));
};

export const mechanismDescriptorsCollide = (
    first: MechanismPhysicalEnvelopeDescriptor,
    second: MechanismPhysicalEnvelopeDescriptor
) => first.mechanismId !== second.mechanismId
    && Math.min(first.frontFaceMm, second.frontFaceMm) - Math.max(first.backFaceMm, second.backFaceMm) > FABRICATION_Z_EPSILON_MM
    && mechanismEnvelopesIntersect(first.envelope, second.envelope);

export type SynchronizedMechanismCollision = {
    phaseIndex: number;
    phaseRad: number;
    first: MechanismPhysicalEnvelopeDescriptor;
    second: MechanismPhysicalEnvelopeDescriptor;
};

export type SynchronizedMechanismCollisionResult = {
    phaseCount: number;
    collision?: SynchronizedMechanismCollision;
};

export const synchronizedMechanismCollisionOracle = (
    first: MechanismConfig,
    second: MechanismConfig,
    kit?: PhysicalKitSettings
): SynchronizedMechanismCollisionResult => {
    if (first.id === second.id) return { phaseCount: 0 };
    const physicalKit = kit ?? defaultPhysicalKit();
    const phases = synchronizedMechanismSafetyPhaseSchedule(first.type, second.type);
    const firstRenderPlan = compileMechanismRenderPlan(first, physicalKit);
    const secondRenderPlan = compileMechanismRenderPlan(second, physicalKit);
    const firstDescriptors = buildMechanismPhysicalEnvelopeDescriptors(first, phases, firstRenderPlan, physicalKit);
    const secondDescriptors = buildMechanismPhysicalEnvelopeDescriptors(second, phases, secondRenderPlan, physicalKit);
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
        const phaseRad = phases[phaseIndex];
        const firstPhaseDescriptors = firstDescriptors.filter(descriptor => descriptor.phaseIndex === phaseIndex);
        const secondPhaseDescriptors = secondDescriptors.filter(descriptor => descriptor.phaseIndex === phaseIndex);
        for (const firstDescriptor of firstPhaseDescriptors) {
            for (const secondDescriptor of secondPhaseDescriptors) {
                if (mechanismDescriptorsCollide(firstDescriptor, secondDescriptor)) {
                    return { phaseCount: phases.length, collision: { phaseIndex, phaseRad, first: firstDescriptor, second: secondDescriptor } };
                }
            }
        }
    }
    return { phaseCount: phases.length };
};

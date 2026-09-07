import type { Bounds, Point } from '../types';
import { ARTWORK_LIMITS } from './artwork';

export const PHYSICAL_OUTLINE_POINT_LIMIT = 512;
export type OutlineAttachment = { jointId: string; center: Readonly<Point>; radius: number };
export type PhysicalOutlineValidation =
  | { ok: true; points: Point[]; bounds: Bounds }
  | { ok: false; blocker: string };

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const onSegment = (a: Point, b: Point, point: Point) => cross(a, b, point) === 0
  && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
  && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
const intersects = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
};
const segmentDistanceSquared = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
};
const inside = (point: Point, outline: Point[]) => {
  let result = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
};

/** An implicit final edge closes the single outer cut contour. No smoothing or repair. */
export const validatePhysicalOutline = (
  candidate: unknown,
  { attachments = [] }: { attachments?: readonly OutlineAttachment[] } = {},
): PhysicalOutlineValidation => {
  if (!Array.isArray(candidate) || candidate.length < 3) return { ok: false, blocker: 'Draw one closed outline.' };
  if (candidate.length > PHYSICAL_OUTLINE_POINT_LIMIT + 1) return { ok: false, blocker: 'Use fewer outline points.' };
  if (candidate.some(point => !point || typeof point !== 'object'
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || Math.abs(point.x) > ARTWORK_LIMITS.coordinate || Math.abs(point.y) > ARTWORK_LIMITS.coordinate)) {
    return { ok: false, blocker: 'Move outline points into the canvas.' };
  }
  const points: Point[] = candidate.map(point => ({ x: point.x, y: point.y }));
  if (same(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) return { ok: false, blocker: 'Draw one closed outline.' };
  if (points.length > PHYSICAL_OUTLINE_POINT_LIMIT) return { ok: false, blocker: 'Use fewer outline points.' };
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index], b = points[(index + 1) % points.length], c = points[(index + 2) % points.length];
    if (same(a, b) || (cross(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0)) {
      return { ok: false, blocker: 'Separate overlapping outline points.' };
    }
    for (let other = index + 1; other < points.length; other += 1) {
      if (other === index + 1 || index === 0 && other === points.length - 1) continue;
      if (intersects(a, b, points[other], points[(other + 1) % points.length])) {
        return { ok: false, blocker: 'Uncross the outline.' };
      }
    }
  }
  const twiceArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
  if (!Number.isFinite(twiceArea) || twiceArea === 0) return { ok: false, blocker: 'Give the shape some width.' };
  for (const attachment of attachments) {
    if (!Number.isFinite(attachment.center.x) || !Number.isFinite(attachment.center.y)
      || !Number.isFinite(attachment.radius) || attachment.radius < 0) return { ok: false, blocker: 'Fix the attachment position.' };
    if (!inside(attachment.center, points) || points.some((point, index) =>
      segmentDistanceSquared(attachment.center, point, points[(index + 1) % points.length]) < attachment.radius ** 2)) {
      return { ok: false, blocker: 'Keep the outline outside each attachment ring.' };
    }
  }
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { ok: true, points, bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } };
};

export const rectangleOutline = ({ x, y, width, height }: Bounds): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];

export const ellipseOutline = ({ x, y, width, height }: Bounds): Point[] => Array.from({ length: 48 }, (_, index) => {
  const angle = index * Math.PI * 2 / 48;
  return { x: x + width / 2 + Math.cos(angle) * width / 2, y: y + height / 2 + Math.sin(angle) * height / 2 };
});

/** Scales physical contour points only, about their bounds center. Artwork stays fixed. */
export const scalePhysicalOutline = (points: readonly Readonly<Point>[], factor: number): Point[] => {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map(point => ({ x: x + (point.x - x) * factor, y: y + (point.y - y) * factor }));
};

/** Andrew's monotone chain, shared with the existing sample fabrication generator. */
export const convexOutline = (points: readonly Point[]): Point[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
};

/** Circumscribed vertices enclose the actual hole circle, rather than inscribing it. */
export const attachmentRingOutline = ({ center, radius }: OutlineAttachment): Point[] => {
  const sides = 16;
  // Only floating-point arithmetic headroom; no additional physical clearance.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(center.x), Math.abs(center.y), radius) * 32;
  const vertexRadius = (radius + roundoff) / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index + .5) * Math.PI * 2 / sides;
    return { x: center.x + Math.cos(angle) * vertexRadius, y: center.y + Math.sin(angle) * vertexRadius };
  });
};

import type { Point } from '../types';

type SmoothTrackingOptions = {
  enabled?: boolean;
  connectEndPoints?: boolean;
  segmentsPerEdge?: number;
};

type TrackingPathOptions = SmoothTrackingOptions & {
  targetSize?: number;
  center?: Point;
};

export const smoothTrackingPoints = (
  points: readonly Point[],
  { enabled = true, connectEndPoints = true, segmentsPerEdge = 20 }: SmoothTrackingOptions = {}
): Point[] => {
  if (!enabled || points.length < 3) return [...points];
  const smoothed: Point[] = [];
  const pointCount = points.length;
  const segmentCount = connectEndPoints ? pointCount : pointCount - 1;
  const safeSegments = Math.max(1, Math.floor(segmentsPerEdge));

  for (let i = 0; i < segmentCount; i += 1) {
    const p0 = connectEndPoints ? points[(i - 1 + pointCount) % pointCount] : points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = connectEndPoints ? points[(i + 1) % pointCount] : points[Math.min(pointCount - 1, i + 1)];
    const p3 = connectEndPoints ? points[(i + 2) % pointCount] : points[Math.min(pointCount - 1, i + 2)];

    for (let t = 0; t < safeSegments; t += 1) {
      const tt = t / safeSegments;
      const tt2 = tt * tt;
      const tt3 = tt2 * tt;
      smoothed.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * tt + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * tt + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3)
      });
    }
  }

  if (!connectEndPoints) smoothed.push(points[pointCount - 1]);
  return smoothed.length > 0 ? smoothed : [...points];
};

export const trackingPointsToWorldPath = (
  points: readonly Point[],
  { enabled = true, connectEndPoints = true, segmentsPerEdge = 20, targetSize = 180, center = { x: 0, y: 0 } }: TrackingPathOptions = {}
): Point[] => {
  const sourcePoints = smoothTrackingPoints(points, { enabled, connectEndPoints, segmentsPerEdge });
  if (sourcePoints.length === 0) return [];
  const xs = sourcePoints.map(point => point.x);
  const ys = sourcePoints.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = targetSize / Math.max(width, height, 1);
  const pathCenter = { x: minX + width / 2, y: minY + height / 2 };
  const worldPoints = sourcePoints.map(point => ({
    x: center.x + (point.x - pathCenter.x) * scale,
    y: center.y - (point.y - pathCenter.y) * scale
  }));

  if (connectEndPoints && worldPoints.length > 1) worldPoints.push({ ...worldPoints[0] });
  return worldPoints;
};

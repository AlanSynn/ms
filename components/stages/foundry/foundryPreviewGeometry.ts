import type { Point } from "../../../types";

export const fittedGearTrainCenters = (
  radii: number[],
  start: Point,
  end: Point,
): Point[] => {
  if (!radii.length) return [];
  if (radii.length === 1) return [start];
  const totalPitchDistance = radii
    .slice(1)
    .reduce((sum, radius, index) => sum + radii[index] + radius, 0);
  if (!Number.isFinite(totalPitchDistance) || totalPitchDistance <= 0)
    return radii.map(() => start);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let distance = 0;
  return radii.map((radius, index) => {
    if (index > 0) distance += radii[index - 1] + radius;
    const t = distance / totalPitchDistance;
    return { x: start.x + dx * t, y: start.y + dy * t };
  });
};

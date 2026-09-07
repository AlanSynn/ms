import type { Bounds, Point } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import type { BuildPlanMechanismV1, BuildPlanV1 } from './buildPlanTypes';

/** Fit the inspection camera only; the real board and printable pieces keep their size. */
export const buildPlanPreviewFrame = (
  plan: BuildPlanV1,
  mechanism: BuildPlanMechanismV1 | undefined = plan.mechanisms[0],
): Bounds => {
  const half = plan.profile.boardCells * plan.profile.gridPitchMm / 2;
  let minX = -half, minY = -half, maxX = half, maxY = half;
  const include = ({ x, y }: Point) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, -y); maxY = Math.max(maxY, -y);
  };
  for (const part of [...plan.character.parts, ...plan.objects.parts]) for (const point of part.outline) {
    include({ x: point.x / SCENE_PX_PER_MM, y: point.y / SCENE_PX_PER_MM });
  }
  for (const motion of plan.motions) if (!mechanism || motion.mechanismRefs.includes(mechanism.ref)) {
    motion.pointsMm.forEach(include);
  }
  mechanism?.geometry.outlines.forEach(outline => outline.pointsMm.forEach(include));
  mechanism?.geometry.points.forEach(point => include({ x: point.xMm, y: point.yMm }));
  const padding = 18;
  return { x: minX - padding, y: minY - padding,
    width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
};

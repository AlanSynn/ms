import type { MechanismConfig, MechanismType, Point } from "../../../types";
import { degToRad } from "../../../utils/foundryCamera";
import { sampledCamProfileScale } from "../../../utils/kinematics";

export const mechanismReferenceTopologySummary = (type: MechanismType) => {
  if (type === "4bar")
    return "A-B input; B-C coupler; C-D output; D-A board-ground";
  if (type === "gear")
    return "fixed gear centers only; no rods; external mesh sequence";
  if (type === "gear_linkage")
    return "fixed gear centers; drive/output gear handle pins; two L4 links meet at shared R fastener";
  if (type === "cam")
    return "rotating cam profile; guided follower block; no linkage rods";
  if (type === "planetary_gear")
    return "fixed ring; sun input; planet on carrier; carrier output";
  if (type === "5bar")
    return "A-B-C-D-E closed chain; A-E board-ground; simulation-only";
  if (type === "6bar")
    return "A-B-C-D four-bar plus C-E-D dyad; simulation-only";
  if (type === "piston")
    return "crank-slider guide; slider-crank fabrication recipe";
  return `${type} simulation topology`;
};

export const axisForAngle = (deg: number) => ({
  x: Math.cos(degToRad(deg)),
  y: -Math.sin(degToRad(deg)),
});

export const vectorAxis = (
  a: Point | undefined,
  b: Point | undefined,
  fallback: Point,
) => {
  if (!a || !b) return fallback;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len > 0.5 ? { x: dx / len, y: dy / len } : fallback;
};

export const rackTeethPath = (len: number, barWidth: number, holeR: number) => {
  const toothCount = Math.max(
    8,
    Math.min(24, Math.round(len / Math.max(holeR * 2.4, 4))),
  );
  const step = len / toothCount;
  return Array.from({ length: toothCount }, (_, index) => {
    const x = -len / 2 + index * step;
    return `M ${x} ${-barWidth / 2} L ${x + step / 2} ${-barWidth / 2 - holeR * 1.2} L ${x + step} ${-barWidth / 2}`;
  }).join(" ");
};

export const camProfilePathD = (
  base: number,
  camProfileSamples: MechanismConfig["camProfileSamples"],
) => {
  const points = Array.from({ length: 42 }, (_, index) => {
    const angle = (index / 42) * Math.PI * 2;
    const lift = sampledCamProfileScale(angle, camProfileSamples);
    return `${Math.cos(angle) * base * lift} ${Math.sin(angle) * base * lift}`;
  });
  return `M ${points.join(" L ")} Z`;
};

export const referenceCoordRoles = (recipe: {
  assemblySteps: Array<{ coords: string[]; coordRoles: string[] }>;
}) =>
  recipe.assemblySteps
    .flatMap((step) =>
      step.coords.map(
        (coord, index) =>
          `${coord}:${step.coordRoles[index] ?? "moving_reference"}`,
      ),
    )
    .join("|");

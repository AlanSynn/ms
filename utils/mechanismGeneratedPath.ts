import type { MechanismConfig, Point } from "../types";
import { primaryFoundryPlaybackPath } from "./foundryPlayback";
import { generateCurvePoints } from "./kinematics";
import { mechanismRequiredParts } from "./mechanismDefaults";
import { isReferenceFoundryVisible } from "./mechanismReference";

const generatedMechanismPath = (mechanism: MechanismConfig) => {
  if (isReferenceFoundryVisible(mechanism.type)) {
    const foundryPath = primaryFoundryPlaybackPath(mechanism, 96);
    if (foundryPath.length) return foundryPath;
  }
  return generateCurvePoints(mechanism, 96).points;
};

export const mechanismWithGeneratedPath = (
  mechanism: MechanismConfig,
  options: { preserveGeneratedPath?: boolean } = {},
): MechanismConfig => ({
  ...mechanism,
  transform: mechanism.transform ?? {
    x: mechanism.anchorX ?? 0,
    y: mechanism.anchorY ?? 0,
    rotation: mechanism.groundAngle ?? 0,
    scale: 1,
  },
  sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
  activeVisualPartIds: mechanism.targetPartId
    ? [mechanism.targetPartId]
    : (mechanism.activeVisualPartIds ?? []),
  fabricationMetadata: {
    ...(mechanism.fabricationMetadata ?? {}),
    sceneAnchor: { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
    targetPathId: mechanism.targetPathId,
    requiredParts: mechanismRequiredParts(mechanism),
  },
  generatedPath:
    options.preserveGeneratedPath && mechanism.generatedPath?.length
      ? mechanism.generatedPath
      : generatedMechanismPath(mechanism),
});

export const compactGeneratedPathControlPoints = (
  mechanism: MechanismConfig,
  count: number,
  closed = true,
): Point[] => {
  const generated = mechanismWithGeneratedPath(mechanism).generatedPath ?? [];
  const sampleCount = Math.max(2, Math.round(count));
  if (generated.length <= 1) return generated.map((point) => ({ ...point }));
  const source = closed ? [...generated, generated[0]] : generated;
  const lengths = source.slice(1).map((point, index) =>
    Math.hypot(point.x - source[index].x, point.y - source[index].y),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0.001) return Array.from({ length: sampleCount }, () => ({ ...generated[0] }));
  const pointAt = (distance: number): Point => {
    let walked = 0;
    for (let index = 0; index < lengths.length; index += 1) {
      const segment = lengths[index];
      if (walked + segment >= distance) {
        const t = segment <= 0 ? 0 : (distance - walked) / segment;
        const a = source[index];
        const b = source[index + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      walked += segment;
    }
    return { ...source.at(-1)! };
  };
  const denominator = closed ? sampleCount : Math.max(1, sampleCount - 1);
  return Array.from({ length: sampleCount }, (_, index) =>
    pointAt((total * index) / denominator),
  );
};

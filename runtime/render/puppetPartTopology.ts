import type { BodyPartLayer, Point, StandardSkeleton } from "../../types";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
  pointInsideOutline,
} from "../../utils/partGeometry";
import type { PartTopologyPolicy } from "../../utils/renderPerformancePolicy";

export type PuppetPartTopologyIdentity = {
  geometry: string;
  textureUrl?: string;
  fillColor: string;
  opacity: number;
};

export type PreparedPuppetPartTopology = {
  part: BodyPartLayer;
  outline: Point[];
  localHoles: Point[];
  identity: PuppetPartTopologyIdentity;
};

const pointSignature = (points: readonly Point[]) =>
  points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(";");

export const preparePuppetPartTopology = (
  part: BodyPartLayer,
  skeleton: StandardSkeleton | null | undefined,
  detail: PartTopologyPolicy,
): PreparedPuppetPartTopology => {
  const landmarks = partLandmarkLocalPoints(part, skeleton);
  const outline = fabricablePartOutlinePoints(part, landmarks);
  const localHoles = landmarks.filter((point) =>
    pointInsideOutline(point, outline, 0.5),
  );
  return {
    part,
    outline,
    localHoles,
    identity: {
      geometry: [
        pointSignature(outline),
        pointSignature(localHoles),
        part.bounds.x.toFixed(3),
        part.bounds.y.toFixed(3),
        part.bounds.width.toFixed(3),
        part.bounds.height.toFixed(3),
        detail.bevelEnabled ? "bevel" : "flat",
        detail.edgeGeometryEnabled ? "edges" : "no-edges",
        detail.curveSegments,
      ].join("|"),
      textureUrl: part.textureUrl,
      fillColor: part.fillColor,
      opacity: part.opacity,
    },
  };
};

export const samePuppetPartTopologyIdentity = (
  left: PuppetPartTopologyIdentity | undefined,
  right: PuppetPartTopologyIdentity,
) => Boolean(
  left &&
  left.geometry === right.geometry &&
  left.textureUrl === right.textureUrl &&
  left.fillColor === right.fillColor &&
  left.opacity === right.opacity
);

export const diffPuppetPartTopologies = (
  previous: ReadonlyMap<string, PuppetPartTopologyIdentity>,
  next: readonly PreparedPuppetPartTopology[],
) => {
  const nextById = new Map(next.map((topology) => [topology.part.id, topology]));
  const removeIds = [...previous].flatMap(([id, identity]) => {
    const candidate = nextById.get(id);
    return candidate && samePuppetPartTopologyIdentity(identity, candidate.identity)
      ? []
      : [id];
  });
  const build = next.filter((topology) =>
    !samePuppetPartTopologyIdentity(previous.get(topology.part.id), topology.identity),
  );
  return { removeIds, build };
};

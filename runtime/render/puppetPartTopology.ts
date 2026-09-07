import type { BodyPartLayer, Point, StandardSkeleton } from "../../types";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
} from "../../utils/partGeometry";
import type { CharacterFabricationHole } from "../../utils/characterFabricationHoles";
import type { PartTopologyPolicy } from "../../utils/renderPerformancePolicy";
import { artworkSurfaceFrame, artworkSurfaceFrameKey } from "./artworkSurface";

export type PuppetPartTopologyIdentity = {
  geometry: string;
  textureUrl?: string;
  artworkRevision?: string;
  artworkFrame: string;
  fillColor: string;
  opacity: number;
};

export type PreparedPuppetPartTopology = {
  part: BodyPartLayer;
  outline: Point[];
  localHoles: Point[];
  holeRadius: number;
  identity: PuppetPartTopologyIdentity;
};

const pointSignature = (points: readonly Point[]) =>
  points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(";");

export const preparePuppetPartTopology = (
  part: BodyPartLayer,
  skeleton: StandardSkeleton | null | undefined,
  detail: PartTopologyPolicy,
  physicalHoles: readonly CharacterFabricationHole[] = [],
): PreparedPuppetPartTopology => {
  const landmarks = partLandmarkLocalPoints(part, skeleton);
  const outline = fabricablePartOutlinePoints(part, landmarks);
  const localHoles = physicalHoles.map(hole => hole.center);
  const holeRadius = physicalHoles[0]?.radius ?? 0;
  return {
    part,
    outline,
    localHoles,
    holeRadius,
    identity: {
      geometry: [
        pointSignature(outline),
        pointSignature(localHoles),
        holeRadius.toFixed(6),
        part.bounds.x.toFixed(3),
        part.bounds.y.toFixed(3),
        part.bounds.width.toFixed(3),
        part.bounds.height.toFixed(3),
        detail.bevelEnabled ? "bevel" : "flat",
        detail.edgeGeometryEnabled ? "edges" : "no-edges",
        detail.curveSegments,
      ].join("|"),
      textureUrl: part.textureUrl,
      artworkRevision: part.artwork?.revision,
      artworkFrame: artworkSurfaceFrameKey(artworkSurfaceFrame(part, outline)),
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
  left.artworkRevision === right.artworkRevision &&
  left.artworkFrame === right.artworkFrame &&
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
    return candidate && identity.geometry === candidate.identity.geometry
      ? []
      : [id];
  });
  const build = next.filter((topology) =>
    previous.get(topology.part.id)?.geometry !== topology.identity.geometry,
  );
  const updateArt = next.filter((topology) => {
    const identity = previous.get(topology.part.id);
    return identity?.geometry === topology.identity.geometry &&
      !samePuppetPartTopologyIdentity(identity, topology.identity);
  });
  return { removeIds, build, updateArt };
};

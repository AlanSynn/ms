import type { MechanismType, Point } from "../../../types";
import type { calculateLinkage } from "../../../utils/kinematics";
import {
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_RENDER_PART_DEPTH,
} from "../../../utils/fabrication";

export const foundryLayerGeometryContract = (
  type: MechanismType,
  label: string,
  renderKind: string,
) => {
  if (type === "4bar" && renderKind === "linkage") {
    if (/input|crank/i.test(label)) return `${label}:A-B`;
    if (/coupler/i.test(label)) return `${label}:B-C`;
    if (/output|rocker/i.test(label)) return `${label}:C-D`;
  }
  if (type === "gear" && renderKind === "gear")
    return `${label}:fixed-board-gear`;
  if (type === "gear_linkage") {
    if (renderKind === "gear") return `${label}:fixed-board-gear`;
    if (/drive.*L|Drive L|drive.*linkage/i.test(label))
      return `${label}:B-pin-to-R`;
    if (/output.*L|Output L|output.*linkage/i.test(label))
      return `${label}:C-pin-to-R`;
    if (/L4|linkage/i.test(label)) return `${label}:gear-pin-to-R`;
    if (/2-hole|bracket/i.test(label)) return `${label}:R-connector`;
  }
  if (type === "planetary_gear") {
    if (/ring/i.test(label)) return `${label}:fixed-ring`;
    if (/sun|G1|1-space/i.test(label)) return `${label}:sun-input`;
    if (/planet|G3|3-space/i.test(label)) return `${label}:planet-on-carrier`;
    if (/carrier/i.test(label)) return `${label}:sun-planet-carrier`;
  }
  if (type === "cam") {
    if (renderKind === "cam") return `${label}:rotating-cam`;
    if (renderKind === "follower") return `${label}:guided-follower`;
    if (renderKind === "guide") return `${label}:fixed-guide`;
  }
  return `${label}:${renderKind}`;
};

export type FoundryRenderLayerLike = { label: string; renderKind: string };

export const foundryPlanetaryLayerIndexes = (
  type: MechanismType,
  layers: FoundryRenderLayerLike[],
) => {
  if (type !== "planetary_gear") return undefined;
  const ring = layers.findIndex(
    (item) => item.renderKind === "gear" && /ring/i.test(item.label),
  );
  const sun = layers.findIndex(
    (item) => item.renderKind === "gear" && /sun|G1|1-space/i.test(item.label),
  );
  const carrier = layers.findIndex(
    (item) =>
      item.renderKind === "linkage" && /carrier|L2|linkage/i.test(item.label),
  );
  const planet = layers.findIndex(
    (item) =>
      item.renderKind === "gear" && /planet|G3|3-space/i.test(item.label),
  );
  if (ring < 0 || sun < 0 || carrier < 0 || planet < 0) return undefined;
  return { ring, sun, carrier, planet };
};

export const foundryRenderedLayerZForMechanism = (
  type: MechanismType,
  layers: FoundryRenderLayerLike[],
  stackLayerZ: number[],
  gearMeshPlaneZ?: number,
) => {
  const z = stackLayerZ.map((value, index) =>
    typeof gearMeshPlaneZ === "number" && layers[index]?.renderKind === "gear"
      ? gearMeshPlaneZ
      : value,
  );
  const planetaryLayers = foundryPlanetaryLayerIndexes(type, layers);
  if (planetaryLayers && typeof gearMeshPlaneZ === "number") {
    z[planetaryLayers.ring] = gearMeshPlaneZ;
    z[planetaryLayers.sun] = gearMeshPlaneZ;
    z[planetaryLayers.planet] = gearMeshPlaneZ;
    z[planetaryLayers.carrier] = Number(
      (gearMeshPlaneZ + FABRICATION_RENDER_LAYER_Z_STEP).toFixed(3),
    );
  }
  return z;
};

export const foundryAssemblyPinPoints = (
  type: MechanismType,
  state: ReturnType<typeof calculateLinkage>,
): Point[] => {
  const compact = (points: Array<Point | undefined>) =>
    points.filter(Boolean) as Point[];
  if (type === "4bar") return compact([state.p1, state.j1, state.j2, state.p2]);
  if (type === "5bar" || type === "6bar")
    return compact([state.p1, state.j1, state.j2, state.aux, state.p2]);
  if (type === "cam") return compact([state.p1, state.j2]);
  if (
    type === "piston" ||
    type === "rack-pinion" ||
    type === "yoke" ||
    type === "quick-return"
  )
    return compact([state.p1, state.j1, state.j2]);
  if (type === "planetary_gear") return compact([state.p1, state.p2]);
  return compact([
    state.p1,
    state.p2,
    state.j1,
    state.j2,
    state.aux,
    state.effector,
  ]);
};

export const foundryAssemblyPinContract = (type: MechanismType) => {
  if (type === "4bar") return "reference-A-B-C-D-only";
  if (type === "5bar" || type === "6bar") return "reference-ground-chain-only";
  if (type === "cam") return "cam-axle-and-follower-center-only";
  if (
    type === "piston" ||
    type === "rack-pinion" ||
    type === "yoke" ||
    type === "quick-return"
  )
    return "guided-output-only";
  if (type === "gear") return "fixed-gear-axles-only";
  if (type === "gear_linkage") return "fixed-gear-axles-plus-two-crank-links";
  if (type === "planetary_gear") return "sun-and-carrier-planet-axles";
  return "template-specific-output";
};

export type FoundryPinStackPoint = {
  id: string;
  point: Point;
  movingLayerIndexes: number[];
  spacerLayerIndexes: number[];
};

export type FoundryPinStack = FoundryPinStackPoint & {
  bottomZ: number;
  topZ: number;
  centerZ: number;
  lengthZ: number;
};

export const isMovingRenderKind = (renderKind: string) =>
  !["clip", "spacer", "base"].includes(renderKind);

export const foundryPinStackPoints = (
  type: MechanismType,
  points: Point[],
  movingLayerIndexes: number[],
  spacerLayerIndexes: number[],
): FoundryPinStackPoint[] => {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const cleanIndexes = movingLayerIndexes.filter((index) =>
    Number.isFinite(index),
  );
  const cleanSpacerIndexes = spacerLayerIndexes.filter((index) =>
    Number.isFinite(index),
  );
  const spacerIndexesFrom = (start: number, count = 1) =>
    Array.from(
      { length: count },
      (_, offset) =>
        cleanSpacerIndexes[
          Math.max(0, Math.min(cleanSpacerIndexes.length - 1, start + offset))
        ],
    ).filter((item): item is number => typeof item === "number");
  const spacerIndexesForPin = (pinMovingLayerIndexes: number[]) => {
    const between = cleanSpacerIndexes.filter(
      (spacerIndex) =>
        pinMovingLayerIndexes.some((index) => index < spacerIndex) &&
        pinMovingLayerIndexes.some((index) => index > spacerIndex),
    );
    if (between.length) return [...new Set(between)];
    if (pinMovingLayerIndexes.length !== 1) return [];
    const movingIndex = pinMovingLayerIndexes[0];
    const before = [...cleanSpacerIndexes]
      .reverse()
      .find((spacerIndex) => spacerIndex < movingIndex);
    const after = cleanSpacerIndexes.find(
      (spacerIndex) => spacerIndex > movingIndex,
    );
    const nearest =
      movingIndex === cleanIndexes[0]
        ? [after]
        : movingIndex === cleanIndexes.at(-1)
          ? [before]
          : [before, after];
    return [
      ...new Set(
        nearest.filter((item): item is number => typeof item === "number"),
      ),
    ];
  };
  if (!points.length || !cleanIndexes.length)
    return points.map((point, index) => ({
      id: ids[index] ?? `P${index + 1}`,
      point,
      movingLayerIndexes: [],
      spacerLayerIndexes: [],
    }));

  if (type === "gear") {
    return points.map((point, index) => {
      const pinMovingLayerIndexes = [
        cleanIndexes[Math.min(index, cleanIndexes.length - 1)],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: pinMovingLayerIndexes,
        spacerLayerIndexes: spacerIndexesFrom(index),
      };
    });
  }

  if (type === "gear_linkage") {
    const gearCount = Math.max(
      2,
      Math.min(points.length, cleanIndexes.length - 3),
    );
    const gearIndexes = cleanIndexes.slice(0, gearCount);
    const linkageIndexes = cleanIndexes.slice(gearCount);
    const pinId = (index: number) => {
      if (index < gearCount) {
        if (index === 0) return "A";
        if (index === gearCount - 1) return "D";
        return `I${index}`;
      }
      if (index === gearCount) return "B";
      if (index === gearCount + 1) return "C";
      return "R";
    };
    return points.map((point, index) => {
      if (index < gearCount) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [gearIndexes[index]].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(index),
        };
      }
      if (index === gearCount) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [gearIndexes[0], linkageIndexes[0]].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(Math.max(0, gearCount - 1)),
        };
      }
      if (index === gearCount + 1) {
        return {
          id: pinId(index),
          point,
          movingLayerIndexes: [
            gearIndexes.at(-1),
            linkageIndexes[1] ?? linkageIndexes[0],
          ].filter((item): item is number => typeof item === "number"),
          spacerLayerIndexes: spacerIndexesFrom(Math.max(0, gearCount - 1), 2),
        };
      }
      const moving = [
        linkageIndexes[0],
        linkageIndexes[1],
        linkageIndexes[2],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: pinId(index),
        point,
        movingLayerIndexes: moving,
        spacerLayerIndexes: spacerIndexesFrom(
          gearCount,
          Math.max(1, moving.length - 1),
        ),
      };
    });
  }

  if (type === "planetary_gear") {
    const sunIndex = cleanIndexes[1] ?? cleanIndexes[0];
    const carrierIndex = cleanIndexes[2] ?? sunIndex;
    const planetIndex = cleanIndexes[3] ?? carrierIndex;
    return points.map((point, index) => {
      if (index === 0) {
        return {
          id: "A",
          point,
          movingLayerIndexes: [sunIndex, carrierIndex].filter(
            (item): item is number => typeof item === "number",
          ),
          spacerLayerIndexes: spacerIndexesFrom(1),
        };
      }
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: [carrierIndex, planetIndex].filter(
          (item): item is number => typeof item === "number",
        ),
        spacerLayerIndexes: spacerIndexesFrom(2),
      };
    });
  }

  if (type === "cam") {
    return points.map((point, index) => {
      const pinMovingLayerIndexes =
        index === 0
          ? [cleanIndexes[0], cleanIndexes[1]]
          : [cleanIndexes[2], cleanIndexes[3]];
      return {
        id: index === 0 ? "A" : "B",
        point,
        movingLayerIndexes: pinMovingLayerIndexes.filter(
          (item): item is number => typeof item === "number",
        ),
        spacerLayerIndexes: spacerIndexesFrom(index === 0 ? 0 : 2),
      };
    });
  }

  if (
    (type === "4bar" || type === "5bar" || type === "6bar") &&
    points.length === cleanIndexes.length + 1
  ) {
    return points.map((point, index) => {
      const pinMovingLayerIndexes = [
        cleanIndexes[index - 1],
        cleanIndexes[index],
      ].filter((item): item is number => typeof item === "number");
      return {
        id: ids[index] ?? `P${index + 1}`,
        point,
        movingLayerIndexes: pinMovingLayerIndexes,
        spacerLayerIndexes: spacerIndexesForPin(pinMovingLayerIndexes),
      };
    });
  }

  return points.map((point, index) => {
    const pinMovingLayerIndexes = [
      cleanIndexes[Math.min(index, cleanIndexes.length - 1)],
    ].filter((item): item is number => typeof item === "number");
    return {
      id: ids[index] ?? `P${index + 1}`,
      point,
      movingLayerIndexes: pinMovingLayerIndexes,
      spacerLayerIndexes: spacerIndexesForPin(pinMovingLayerIndexes),
    };
  });
};

export const foundrySpacerTouchesPin = (
  pin: FoundryPinStackPoint,
  spacerLayerIndex: number,
) => pin.spacerLayerIndexes.includes(spacerLayerIndex);

export const foundryPinStacks = (
  pinPoints: FoundryPinStackPoint[],
  renderedLayerZ: number[],
  options: {
    includeSpacerZ?: boolean;
    spacerZForPin?: (pin: FoundryPinStackPoint) => number[] | undefined;
  } = {},
): FoundryPinStack[] =>
  pinPoints.map((pin) => {
    const localSpacerZ = options.includeSpacerZ
      ? options.spacerZForPin?.(pin)
      : undefined;
    const zIndexes = options.includeSpacerZ
      ? localSpacerZ?.length
        ? pin.movingLayerIndexes
        : [...pin.movingLayerIndexes, ...pin.spacerLayerIndexes]
      : pin.movingLayerIndexes;
    const stackZ = [
      ...zIndexes
        .map((index) => renderedLayerZ[index])
        .filter((z): z is number => typeof z === "number"),
      ...(localSpacerZ ?? []),
    ];
    const minZ = stackZ.length
      ? Math.min(...stackZ)
      : (renderedLayerZ[0] ?? FABRICATION_RENDER_LAYER_Z_STEP);
    const maxZ = stackZ.length ? Math.max(...stackZ) : minZ;
    const bottomZ = Number(
      (minZ - FABRICATION_RENDER_PART_DEPTH / 2 - 0.08).toFixed(3),
    );
    const topZ = Number(
      (maxZ + FABRICATION_RENDER_PART_DEPTH / 2 + 0.18).toFixed(3),
    );
    const lengthZ = Math.max(0.46, Number((topZ - bottomZ).toFixed(3)));
    return {
      ...pin,
      bottomZ,
      topZ,
      centerZ: Number(((bottomZ + topZ) / 2).toFixed(3)),
      lengthZ,
    };
  });

export const foundryLocalSpacerZsForPin = (
  type: MechanismType,
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
  layers: FoundryRenderLayerLike[],
) => {
  const boardSideSpacerZ = (movingZ: number) =>
    Number(
      (
        movingZ -
        (FABRICATION_RENDER_PART_DEPTH + FABRICATION_RENDER_MIN_CLEARANCE) / 2
      ).toFixed(3),
    );
  const movingZ = pin.movingLayerIndexes
    .map((index) => renderedLayerZ[index])
    .filter((z): z is number => typeof z === "number")
    .sort((a, b) => a - b);
  const uniqueMovingZ = movingZ.filter(
    (z, index) => index === 0 || Math.abs(z - movingZ[index - 1]) > 0.001,
  );
  const betweenMovingLayers = () =>
    uniqueMovingZ
      .slice(1)
      .map((z, index) => Number(((uniqueMovingZ[index] + z) / 2).toFixed(3)));
  if (type === "4bar") {
    if ((pin.id === "A" || pin.id === "D") && uniqueMovingZ.length === 1) {
      return [boardSideSpacerZ(uniqueMovingZ[0])];
    }
    if ((pin.id === "B" || pin.id === "C") && uniqueMovingZ.length >= 2)
      return betweenMovingLayers().slice(0, 1);
  }
  if (type === "gear_linkage" && uniqueMovingZ.length >= 2) {
    const minZ = uniqueMovingZ[0];
    const maxZ = uniqueMovingZ.at(-1) ?? minZ;
    const spacerCount = Math.max(
      pin.spacerLayerIndexes.length,
      uniqueMovingZ.length - 1,
    );
    return Array.from({ length: spacerCount }, (_, index) =>
      Number(
        (minZ + ((maxZ - minZ) * (index + 1)) / (spacerCount + 1)).toFixed(3),
      ),
    );
  }
  if (type === "planetary_gear" && uniqueMovingZ.length >= 2)
    return betweenMovingLayers().slice(0, 1);
  if (
    (type === "gear" || type === "gear_linkage") &&
    pin.movingLayerIndexes.some((index) => layers[index]?.renderKind === "gear")
  ) {
    const gearLayerIndex = pin.movingLayerIndexes.find(
      (index) => layers[index]?.renderKind === "gear",
    );
    const gearZ =
      typeof gearLayerIndex === "number"
        ? renderedLayerZ[gearLayerIndex]
        : undefined;
    return typeof gearZ === "number" ? [boardSideSpacerZ(gearZ)] : [];
  }
  return [];
};

export const foundryLocalSpacerZForPin = (
  type: MechanismType,
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
  layers: FoundryRenderLayerLike[],
  spacerLayerIndex?: number,
) => {
  const spacerZs = foundryLocalSpacerZsForPin(
    type,
    pin,
    renderedLayerZ,
    layers,
  );
  if (typeof spacerLayerIndex === "number") {
    const spacerOrdinal = pin.spacerLayerIndexes.indexOf(spacerLayerIndex);
    return spacerZs[Math.max(0, spacerOrdinal)] ?? spacerZs[0];
  }
  return spacerZs[0];
};

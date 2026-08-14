import type { Point } from "../types";
import type { calculateLinkage } from "./kinematics";
import {
  projectFabricationZMm,
  type FabricationRenderLayer,
  type FabricationRenderPlan,
} from "./mechanismFabricationZStack";

type LinkageState = ReturnType<typeof calculateLinkage>;

export type FoundrySupportPointContext = {
  state: LinkageState;
  gearCenters?: Point[];
  planetCenters?: Point[];
};

export type FoundrySupportPointSelector =
  | {
      kind: "state";
      key: "p1" | "p2" | "j1" | "j2" | "aux" | "effector";
    }
  | { kind: "gear"; index: number }
  | { kind: "planet" };

export type FoundryPinStackPoint = {
  id: string;
  pathId: string;
  rootNodeId: string;
  sourceIds: string[];
  point: Point;
  orderedLayerIds: string[];
  layerIndexes: number[];
  movingLayerIndexes: number[];
  spacerLayerIndexes: number[];
  clipLayerIndexes: number[];
  supportNodeIds: string[];
  pinSpanId: string;
};

export type FoundryPinStack = FoundryPinStackPoint & {
  bottomZ: number;
  topZ: number;
  centerZ: number;
  lengthZ: number;
  retainerZ: number[];
};

export const prepareFoundrySupportPointSelector = (
  nodeId: string,
): FoundrySupportPointSelector | undefined => {
  const gearMatch = /^gear-(\d+)$/.exec(nodeId);
  if (gearMatch) return { kind: "gear", index: Number(gearMatch[1]) };
  switch (nodeId) {
    case "p1":
    case "cam-axle":
    case "cam-disk":
    case "pinion-gear":
    case "sun-gear":
    case "ring-gear":
      return { kind: "state", key: "p1" };
    case "p2":
      return { kind: "state", key: "p2" };
    case "j1":
    case "drive-pin":
      return { kind: "state", key: "j1" };
    case "j2":
    case "output-pin":
    case "slider":
    case "yoke-slider":
    case "rack":
    case "follower-head":
      return { kind: "state", key: "j2" };
    case "aux":
      return { kind: "state", key: "aux" };
    case "effector":
    case "output-point":
      return { kind: "state", key: "effector" };
    case "planet-gear":
      return { kind: "planet" };
    default:
      return undefined;
  }
};

export const samplePreparedFoundrySupportPoint = (
  selector: FoundrySupportPointSelector | undefined,
  { state, gearCenters = [], planetCenters = [] }: FoundrySupportPointContext,
): Point | undefined => {
  if (!selector) return undefined;
  if (selector.kind === "state") return state[selector.key];
  if (selector.kind === "planet") return planetCenters[0] ?? state.p2;
  return gearCenters[selector.index]
    ?? (selector.index === 0 ? state.p1 : state.p2);
};

const pointForTypedNode = (
  nodeId: string,
  context: FoundrySupportPointContext,
): Point | undefined => samplePreparedFoundrySupportPoint(
  prepareFoundrySupportPointSelector(nodeId),
  context,
);

export const foundryLayerGeometryContract = (
  layer: Pick<FabricationRenderLayer, "layerId" | "sourceNodeId" | "renderKind">,
) => `${layer.sourceNodeId ?? layer.layerId}:${layer.renderKind}`;

export const foundryRenderedLayerZForMechanism = (
  layers: FabricationRenderLayer[],
  stackLayerZ: number[],
) => layers.map((layer, index) => stackLayerZ[index] ?? layer.z);

export const foundryAssemblyPinContract = () => "compiled-support-paths";

export const isMovingRenderKind = (renderKind: string) =>
  !["clip", "spacer", "base"].includes(renderKind);

export const foundryPinStackPoints = (
  renderPlan: FabricationRenderPlan,
  context: FoundrySupportPointContext,
): FoundryPinStackPoint[] => {
  const layerIndexById = new Map(
    renderPlan.layers.map((layer, index) => [layer.layerId, index]),
  );
  const pinSpanById = new Map(renderPlan.pinSpans.map((span) => [span.id, span]));
  return renderPlan.supportPaths.flatMap((path) => {
    if (!path.pinSpanId) return [];
    const pinSpan = pinSpanById.get(path.pinSpanId);
    const point = pointForTypedNode(path.rootNodeId, context);
    if (!pinSpan || !point) return [];
    const layerIndexes = path.orderedLayerIds
      .map((layerId) => layerIndexById.get(layerId))
      .filter((index): index is number => typeof index === "number");
    return [{
      id: path.displayAlias ?? path.rootNodeId,
      pathId: path.id,
      rootNodeId: path.rootNodeId,
      sourceIds: [...path.sourceIds],
      point,
      orderedLayerIds: [...path.orderedLayerIds],
      layerIndexes,
      movingLayerIndexes: layerIndexes.filter((index) =>
        isMovingRenderKind(renderPlan.layers[index]?.renderKind ?? "base"),
      ),
      spacerLayerIndexes: layerIndexes.filter(
        (index) => renderPlan.layers[index]?.renderKind === "spacer",
      ),
      clipLayerIndexes: layerIndexes.filter(
        (index) => renderPlan.layers[index]?.renderKind === "clip",
      ),
      supportNodeIds: [...pinSpan.supportNodeIds],
      pinSpanId: pinSpan.id,
    }];
  });
};

export const foundrySpacerTouchesPin = (
  pin: FoundryPinStackPoint,
  spacerLayerIndex: number,
) => pin.spacerLayerIndexes.includes(spacerLayerIndex);

export const foundryLayerTouchesPin = (
  pin: FoundryPinStackPoint,
  layerIndex: number,
) => pin.layerIndexes.includes(layerIndex);

export const foundryPinStacks = (
  pinPoints: FoundryPinStackPoint[],
  renderPlan: FabricationRenderPlan,
): FoundryPinStack[] => {
  const pinSpanById = new Map(renderPlan.pinSpans.map((span) => [span.id, span]));
  const supportNodeById = new Map(
    renderPlan.supportNodes.map((node) => [node.id, node]),
  );
  return pinPoints.flatMap((pin) => {
    const span = pinSpanById.get(pin.pinSpanId);
    if (!span) return [];
    const retainerZ = span.supportNodeIds
      .map((nodeId) => supportNodeById.get(nodeId))
      .filter((node) => node && ["clip", "fastener-head", "fastener-tab"].includes(node.kind))
      .map((node) => projectFabricationZMm(node!.centerMm));
    return [{
      ...pin,
      bottomZ: projectFabricationZMm(span.backFaceMm),
      topZ: projectFabricationZMm(span.frontFaceMm),
      centerZ: projectFabricationZMm(span.centerMm),
      lengthZ: projectFabricationZMm(span.physicalDepthMm),
      retainerZ: [...new Set(retainerZ)].sort((a, b) => a - b),
    }];
  });
};

export const foundryLocalSpacerZsForPin = (
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
) => pin.spacerLayerIndexes
  .map((index) => renderedLayerZ[index])
  .filter((z): z is number => typeof z === "number");

export const foundryLocalSpacerZForPin = (
  pin: FoundryPinStackPoint,
  renderedLayerZ: number[],
  spacerLayerIndex?: number,
) => {
  if (typeof spacerLayerIndex === "number") {
    return pin.spacerLayerIndexes.includes(spacerLayerIndex)
      ? renderedLayerZ[spacerLayerIndex]
      : undefined;
  }
  return foundryLocalSpacerZsForPin(pin, renderedLayerZ)[0];
};

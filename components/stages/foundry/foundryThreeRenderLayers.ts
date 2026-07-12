import * as THREE from "three";
import type { MechanismConfig, Point } from "../../../types";
import {
  gearTrainMeshPhaseDegAt,
  gearTrainRotationRatioAt,
} from "../../../utils/kinematics";
import { foundryPlanetaryPlanetRotationDeg } from "../../../utils/foundryPlayback";
import {
  planetaryRingPitchRadius,
  type FabricationRenderLayer,
  type FabricationRenderPlan,
} from "../../../utils/fabrication";
import { degToRad } from "../../../utils/foundryCamera";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import {
  foundrySpacerTouchesPin,
  type FoundryPinStack,
} from "../../../utils/mechanismPreviewStacks";
import type {
  FoundryFabricationMeshMetadata,
  FoundryThreePrimitiveFactory,
} from "./foundryThreePrimitives";
import { resolveFourBarLinkageBlankPoses } from "../../../utils/mechanismConnectionSelections";
import {
  foundryAssemblyLayerState,
  type FoundryAssemblySceneFrame,
} from "./foundryAssemblySceneOverlay";

type VisiblePathTrace = {
  points: Point[];
};

type FoundryDynamicLayerRenderOptions = {
  mechanism: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  primitives: FoundryThreePrimitiveFactory;
  renderPlan: FabricationRenderPlan;
  renderedLayerZ: number[];
  pinStacks: FoundryPinStack[];
  visiblePathTraces: VisiblePathTrace[];
  pathLayerZ: number;
  showPathPreview: boolean;
  showTrail: boolean;
  pinionRotation: number;
  isGearTrain: boolean;
  gearRadii: number[];
  gearCenters: Point[];
  gearUsesMeshPhases: boolean;
  gearOutputRatioForDisplay: number;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
};

const linkageHoleCountForSource = (sourceNodeId: string | undefined) => ({
  "coupler-link": 5,
  "connector-link-a": 5,
  "connector-link-b": 5,
  "carrier": 3,
  "dyad-link": 2,
  "follower-link": 2,
}[sourceNodeId ?? ""] ?? 3);

export const renderFoundryDynamicLayers = ({
  mechanism,
  simulation,
  primitives,
  renderPlan,
  renderedLayerZ,
  pinStacks,
  visiblePathTraces,
  pathLayerZ,
  showPathPreview,
  showTrail,
  pinionRotation,
  isGearTrain,
  gearRadii,
  gearCenters,
  gearUsesMeshPhases,
  gearOutputRatioForDisplay,
  assemblySceneFrame,
}: FoundryDynamicLayerRenderOptions) => {
  const {
    material,
    materialForLayer,
    addSpacerWasher,
    addClipCap,
    addBar,
    addGear,
    addRingGear,
    addCam,
    addSlotPlate,
    addFollowerBlock,
    addEndStop,
    addRack,
    addPin,
    addPath,
  } = primitives;
  const supportPathById = new Map(renderPlan.supportPaths.map((path) => [path.id, path]));
  const metadataForLayer = (layer: FabricationRenderLayer): FoundryFabricationMeshMetadata => ({
    fabricationLayerId: layer.layerId,
    supportPathIds: [...layer.supportPathIds],
    primitiveKind: "layer",
    pinSpanIds: layer.supportPathIds.flatMap((pathId) => {
      const pinSpanId = supportPathById.get(pathId)?.pinSpanId;
      return pinSpanId ? [pinSpanId] : [];
    }),
  });

  if (showTrail)
    visiblePathTraces.forEach((trace) =>
      addPath(trace.points, pathLayerZ - 0.05, material.trail),
    );
  if (showPathPreview)
    visiblePathTraces.forEach((trace) =>
      addPath(trace.points, pathLayerZ, material.path),
    );

  const s = simulation.state;
  const fourBarBlankPoses = resolveFourBarLinkageBlankPoses(mechanism, s);
  const angle = pinionRotation;
  const camGuideFallback = {
    x: Math.cos(degToRad(mechanism.groundAngle ?? 90)),
    y: -Math.sin(degToRad(mechanism.groundAngle ?? 90)),
  };
  const camGuideVector =
    mechanism.type === "cam"
      ? (() => {
          const dx = s.j2.x - s.p1.x;
          const dy = s.j2.y - s.p1.y;
          const len = Math.hypot(dx, dy);
          return len > 0.001
            ? { x: dx / len, y: dy / len }
            : camGuideFallback;
        })()
      : camGuideFallback;
  const camGuideRotation = Math.atan2(camGuideVector.y, camGuideVector.x);
  const camFollowerRotation = camGuideRotation - Math.PI / 2;
  const camGuideCenter =
    mechanism.type === "cam"
      ? {
          x:
            s.p1.x +
            camGuideVector.x *
              (mechanism.crankLength +
                mechanism.sliderOffset +
                mechanism.rockerLength * 0.5) *
              simulation.scale,
          y:
            s.p1.y +
            camGuideVector.y *
              (mechanism.crankLength +
                mechanism.sliderOffset +
                mechanism.rockerLength * 0.5) *
              simulation.scale,
        }
      : s.j2;
  const usesMeshedPitchCenters = [
    "gear",
    "gear_linkage",
    "planetary_gear",
    "rack-pinion",
    "cam",
  ].includes(mechanism.type);
  if (!usesMeshedPitchCenters && mechanism.type !== "4bar")
    addBar(s.p1, s.p2, 0, material.base, 3);
  const clipLayer = renderPlan.layers.find(
    (layer) => layer.renderKind === "clip",
  );
  const clipMat = clipLayer
    ? materialForLayer(clipLayer.color, 0.66, 0.03)
    : material.dark;
  const renderLinkageLayer = (
    layer: FabricationRenderLayer,
    z: number,
    mat: THREE.Material,
  ) => {
    const holeCount = linkageHoleCountForSource(layer.sourceNodeId);
    const metadata = metadataForLayer(layer);
    if (layer.sourceNodeId === "connector-link-a")
      addBar(s.j1, s.effector, z, mat, holeCount, undefined, metadata);
    else if (layer.sourceNodeId === "connector-link-b")
      addBar(s.j2, s.effector, z, mat, holeCount, undefined, metadata);
    else if (layer.sourceNodeId === "carrier")
      addBar(s.p1, s.p2, z, mat, holeCount, undefined, metadata);
    else if (layer.sourceNodeId === "output-link" && mechanism.type === "4bar") {
      const pose = fourBarBlankPoses["4bar.output-joint"];
      addBar(
        pose?.origin ?? s.p2,
        pose?.end ?? s.j2,
        z,
        mat,
        pose?.holeCount ?? holeCount,
        pose?.partKey,
        metadata,
      );
    } else if (layer.sourceNodeId === "input-link" && mechanism.type === "4bar") {
      const pose = fourBarBlankPoses["4bar.input-joint"];
      addBar(
        pose?.origin ?? s.p1,
        pose?.end ?? s.j1,
        z,
        mat,
        pose?.holeCount ?? holeCount,
        pose?.partKey,
        metadata,
      );
    } else {
      const endpoints: Record<string, [Point | undefined, Point | undefined]> = {
        "input-link": [s.p1, s.j1],
        "crank-link": [s.p1, s.j1],
        "cam-axle": [s.p1, s.j1],
        "coupler-link": [s.j1, s.j2],
        "connecting-rod": [s.j1, s.j2],
        "output-link": [s.p2, s.j2],
        "slotted-arm": [s.p2, s.j2],
        "left-crank": [s.p1, s.j1],
        "right-crank": [s.p2, s.aux],
        "left-coupler": [s.j1, s.j2],
        "right-coupler": [s.aux, s.j2],
        "dyad-link": [s.j2, s.aux],
        "follower-link": [s.p2, s.aux],
      };
      const [a, b] = endpoints[layer.sourceNodeId ?? ""] ?? [s.j1, s.j2];
      addBar(a, b, z, mat, holeCount, undefined, metadata);
    }
  };
  const renderGearLayer = (
    layer: FabricationRenderLayer,
    z: number,
    mat: THREE.Material,
  ) => {
    const metadata = metadataForLayer(layer);
    if (layer.sourceNodeId === "ring-gear")
        addRingGear(s.p1, planetaryRingPitchRadius(mechanism), z, 0, mat, metadata);
    else if (layer.sourceNodeId === "planet-gear") {
        const planetCenters = [s.p2];
        const planetCount = Math.max(1, planetCenters.length);
        planetCenters.forEach((center, index) =>
          addGear(
            center,
            mechanism.rockerLength,
            z,
            foundryPlanetaryPlanetRotationDeg(
              mechanism,
              angle,
              index,
              planetCount,
            ),
            mat,
            metadata,
          ),
        );
    } else if (layer.sourceNodeId === "sun-gear")
      addGear(s.p1, mechanism.crankLength, z, angle, mat, metadata);
    else if (isGearTrain) {
      const match = /^gear-(\d+)$/.exec(layer.sourceNodeId ?? "");
      const gearTrainIndex = match ? Number(match[1]) : 0;
      const index = Math.max(
        0,
        Math.min(gearTrainIndex, Math.max(0, gearRadii.length - 1)),
      );
      const fallbackCenter = index === 0 ? s.p1 : s.p2;
      const fallbackRadius =
        index === 0 ? mechanism.crankLength : mechanism.rockerLength;
      const isLastGear = index === gearRadii.length - 1;
      const phaseDeg =
        (gearUsesMeshPhases ? gearTrainMeshPhaseDegAt(gearRadii, index) : 0) +
        (isLastGear ? ((mechanism.phase ?? 0) * 180) / Math.PI : 0);
      const ratio = gearUsesMeshPhases
        ? gearTrainRotationRatioAt(gearRadii, index)
        : mechanism.type === "gear_linkage"
          ? index === 0
            ? 1
            : isLastGear
              ? gearOutputRatioForDisplay
              : 0
          : 0;
      addGear(
        gearCenters[index] ?? fallbackCenter,
        gearRadii[index] ?? fallbackRadius,
        z,
        angle * ratio + phaseDeg,
        mat,
        metadata,
      );
    } else addGear(s.p1, mechanism.crankLength, z, angle, mat, metadata);
  };
  renderPlan.layers.forEach((layerItem, index) => {
    const z = renderedLayerZ[index] ?? layerItem.z;
    const assemblyLayerState = foundryAssemblyLayerState(
      assemblySceneFrame,
      layerItem,
    );
    const mat = materialForLayer(
      assemblyLayerState.color,
      layerItem.role === "spacer"
        ? Math.min(0.72, assemblyLayerState.opacity)
        : assemblyLayerState.opacity,
      layerItem.role === "spacer" ? 0.06 : 0.03,
    );
    if (layerItem.renderKind === "clip") return;
    else if (layerItem.renderKind === "spacer")
      pinStacks
        .filter((pin) => foundrySpacerTouchesPin(pin, index))
        .forEach((pin) =>
          addSpacerWasher(pin.point, z, mat, {
            fabricationLayerId: layerItem.layerId,
            supportPathIds: [pin.pathId],
            pinSpanIds: [pin.pinSpanId],
            primitiveKind: "layer",
          }),
        );
    else if (layerItem.renderKind === "linkage")
      renderLinkageLayer(layerItem, z, mat);
    else if (layerItem.renderKind === "gear") {
      renderGearLayer(layerItem, z, mat);
    } else if (layerItem.renderKind === "cam")
      addCam(s.p1, z, degToRad(angle), mat, metadataForLayer(layerItem));
    else if (layerItem.renderKind === "guide") {
      const slotRotation =
        layerItem.sourceNodeId === "follower-guide"
          ? camGuideRotation
          : layerItem.sourceNodeId === "guide"
            ? Math.PI / 2
            : Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
      const slotCenter =
        layerItem.sourceNodeId === "follower-guide"
          ? camGuideCenter
          : layerItem.sourceNodeId === "slotted-arm"
            ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }
            : s.j2;
      addSlotPlate(
        slotCenter,
        layerItem.sourceNodeId === "guide" && mechanism.type === "rack-pinion" ? 4.8 : 3.2,
        slotRotation,
        z,
        mat,
        metadataForLayer(layerItem),
      );
    } else if (layerItem.renderKind === "rack") {
      const metadata = metadataForLayer(layerItem);
      addRack(s.j2, z, mat, metadata);
      addEndStop(s.j2, -2.55, z, metadata);
      addEndStop(s.j2, 2.55, z, metadata);
    } else if (layerItem.renderKind === "follower")
      addFollowerBlock(
        s.j2,
        z,
        mat,
        mechanism.type === "cam" ? camFollowerRotation : 0,
        metadataForLayer(layerItem),
      );
  });
  pinStacks.forEach((pinStack) => {
    pinStack.retainerZ.forEach((z) => {
      const clipLayerIndex = pinStack.clipLayerIndexes.find((index) => Math.abs((renderedLayerZ[index] ?? renderPlan.layers[index]?.z ?? 0) - z) <= 1e-6);
      const clipLayer = clipLayerIndex === undefined ? undefined : renderPlan.layers[clipLayerIndex];
      addClipCap(pinStack.point, z, clipMat, 1.35, {
        ...(clipLayer ? { fabricationLayerId: clipLayer.layerId } : {}),
        supportPathIds: [pinStack.pathId],
        pinSpanIds: [pinStack.pinSpanId],
        primitiveKind: "retainer",
      });
    });
    addPin(pinStack.point, pinStack.centerZ, pinStack.lengthZ, {
      supportPathIds: [pinStack.pathId],
      pinSpanIds: [pinStack.pinSpanId],
      primitiveKind: "pin",
    });
  });
};

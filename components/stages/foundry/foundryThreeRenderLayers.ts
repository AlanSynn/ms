import * as THREE from "three";
import type { MechanismConfig, Point } from "../../../types";
import {
  gearTrainMeshPhaseDegAt,
  gearTrainRotationRatioAt,
} from "../../../utils/kinematics";
import { foundryPlanetaryPlanetRotationDeg } from "../../../utils/foundryPlayback";
import {
  planetaryRingPitchRadius,
  type FabricationRenderPlan,
} from "../../../utils/fabrication";
import { degToRad } from "../../../utils/foundryCamera";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import {
  foundrySpacerTouchesPin,
  type FoundryPinStack,
  type FoundryPinStackPoint,
} from "../../../utils/mechanismPreviewStacks";
import type { FoundryThreePrimitiveFactory } from "./foundryThreePrimitives";
import {
  foundryAssemblyLayerState,
  type FoundryAssemblySceneFrame,
} from "./foundryAssemblySceneOverlay";

type VisiblePathTrace = {
  points: Point[];
};

type LocalSpacerZForPin = (
  pin: FoundryPinStackPoint,
  spacerLayerIndex?: number,
) => number | undefined;

type FoundryDynamicLayerRenderOptions = {
  mechanism: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  primitives: FoundryThreePrimitiveFactory;
  renderPlan: FabricationRenderPlan;
  renderedLayerZ: number[];
  pinStacks: FoundryPinStack[];
  localSpacerZForPin: LocalSpacerZForPin;
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

const linkageHoleCountFromLabel = (label: string, fallback: number) => {
  const match = /\bL(\d+)\b/i.exec(label);
  const cells = match ? Number(match[1]) : NaN;
  return Number.isFinite(cells) ? Math.max(2, cells + 1) : fallback;
};

export const renderFoundryDynamicLayers = ({
  mechanism,
  simulation,
  primitives,
  renderPlan,
  renderedLayerZ,
  pinStacks,
  localSpacerZForPin,
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

  if (showTrail)
    visiblePathTraces.forEach((trace) =>
      addPath(trace.points, pathLayerZ - 0.05, material.trail),
    );
  if (showPathPreview)
    visiblePathTraces.forEach((trace) =>
      addPath(trace.points, pathLayerZ, material.path),
    );

  const s = simulation.state;
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
    label: string,
    z: number,
    mat: THREE.Material,
  ) => {
    if (mechanism.type === "gear") return;
    if (
      mechanism.type === "gear_linkage" &&
      /drive.*L|Drive L|drive.*linkage/i.test(label)
    )
      addBar(s.j1, s.effector, z, mat, linkageHoleCountFromLabel(label, 4));
    else if (
      mechanism.type === "gear_linkage" &&
      /output.*L|Output L|output.*linkage|L4|linkage/i.test(label)
    )
      addBar(s.j2, s.effector, z, mat, linkageHoleCountFromLabel(label, 4));
    else if (mechanism.type === "6bar" && /output rocker/i.test(label))
      addBar(s.p2, s.j2, z, mat, linkageHoleCountFromLabel(label, 3));
    else if (mechanism.type === "6bar" && /dyad/i.test(label))
      addBar(s.j2, s.aux, z, mat, linkageHoleCountFromLabel(label, 2));
    else if (mechanism.type === "6bar" && /follower/i.test(label))
      addBar(s.p2, s.aux, z, mat, linkageHoleCountFromLabel(label, 2));
    else if (mechanism.type === "planetary_gear" && /carrier/i.test(label))
      addBar(s.p1, s.p2, z, mat, linkageHoleCountFromLabel(label, 3));
    else if (mechanism.type === "4bar" && /output|rocker/i.test(label))
      addBar(s.p2, s.j2, z, mat, linkageHoleCountFromLabel(label, 3));
    else if (/input|crank|left/i.test(label))
      addBar(s.p1, s.j1, z, mat, linkageHoleCountFromLabel(label, 3));
    else if (/right/i.test(label))
      addBar(s.p2, s.j2, z, mat, linkageHoleCountFromLabel(label, 3));
    else if (/coupler|center|carrier/i.test(label))
      addBar(s.j1, s.j2, z, mat, linkageHoleCountFromLabel(label, 4));
    else if (/output|follower/i.test(label))
      addBar(s.j2, s.effector, z, mat, linkageHoleCountFromLabel(label, 2));
    else addBar(s.j1, s.j2, z, mat, linkageHoleCountFromLabel(label, 3));
  };
  const renderGearLayer = (
    label: string,
    z: number,
    mat: THREE.Material,
    gearTrainIndex = 0,
  ) => {
    if (mechanism.type === "planetary_gear") {
      if (/ring/i.test(label))
        addRingGear(s.p1, planetaryRingPitchRadius(mechanism), z, 0, mat);
      else if (/planet|G3|3-space/i.test(label)) {
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
          ),
        );
      } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
    } else if (isGearTrain) {
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
      );
    } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
  };
  let gearTrainLayerIndex = 0;
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
          addSpacerWasher(pin.point, localSpacerZForPin(pin, index) ?? z, mat),
        );
    else if (layerItem.renderKind === "linkage")
      renderLinkageLayer(layerItem.label, z, mat);
    else if (layerItem.renderKind === "gear") {
      renderGearLayer(layerItem.label, z, mat, gearTrainLayerIndex);
      if (isGearTrain) gearTrainLayerIndex += 1;
    } else if (layerItem.renderKind === "cam")
      addCam(s.p1, z, degToRad(angle), mat);
    else if (layerItem.renderKind === "guide") {
      const slotRotation =
        mechanism.type === "cam"
          ? camGuideRotation
          : /follower|slider|rack/i.test(layerItem.label)
            ? Math.PI / 2
            : Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
      const slotCenter =
        mechanism.type === "cam"
          ? camGuideCenter
          : /quick/i.test(layerItem.label)
            ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }
            : s.j2;
      addSlotPlate(
        slotCenter,
        /rack/i.test(layerItem.label) ? 4.8 : 3.2,
        slotRotation,
        z,
        mat,
      );
    } else if (layerItem.renderKind === "rack") {
      addRack(s.j2, z, mat);
      addEndStop(s.j2, -2.55, z + 0.04);
      addEndStop(s.j2, 2.55, z + 0.04);
    } else if (layerItem.renderKind === "follower")
      addFollowerBlock(
        s.j2,
        z,
        mat,
        mechanism.type === "cam" ? camFollowerRotation : 0,
      );
  });
  pinStacks.forEach((pinStack) => {
    const boardPivotFastener =
      mechanism.type === "4bar" &&
      (pinStack.id === "A" || pinStack.id === "D");
    addClipCap(
      pinStack.point,
      pinStack.bottomZ,
      clipMat,
      boardPivotFastener ? 1.5 : 1.35,
    );
    addClipCap(
      pinStack.point,
      pinStack.topZ + (boardPivotFastener ? 0.035 : 0),
      clipMat,
      boardPivotFastener ? 1.75 : 1.35,
    );
    addPin(pinStack.point, pinStack.centerZ, pinStack.lengthZ);
  });
};

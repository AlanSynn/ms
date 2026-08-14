import * as THREE from "three";
import type { MechanismConfig, PhysicalKitSettings, Point } from "../../../types";
import {
  calculateLinkage,
  gearTrainMeshPhaseDegAt,
  gearTrainRotationRatioAt,
} from "../../../utils/kinematics";
import { defaultPhysicalKit } from "../../../utils/coordinates";
import { foundryPlanetaryPlanetRotationDeg } from "../../../utils/foundryPlayback";
import { planetaryRingPitchRadius } from "../../../utils/fabricationSizing";
import type {
  FabricationRenderLayer,
  FabricationRenderPlan,
} from "../../../utils/mechanismFabricationZStack";
import { degToRad } from "../../../utils/foundryCamera";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import {
  foundrySpacerTouchesPin,
  type FoundryPinStack,
} from "../../../utils/mechanismPreviewStacks";
import type {
  FoundryFabricationMeshMetadata,
  FoundryFrameOwner,
  FoundryThreePrimitiveFactory,
} from "./foundryThreePrimitives";
import {
  disposeFoundryThreeObject,
} from "./foundryThreePrimitives";
import {
  resolveFourBarLinkageBlankPoses,
} from "../../../utils/mechanismConnectionSelections";
import {
  foundryAssemblyLayerState,
  type FoundryAssemblySceneFrame,
} from "./foundryAssemblySceneOverlay";
import {
  buildMechanismPhysicalEnvelopeDescriptors,
  type MechanismPhysicalEnvelopeDescriptor,
} from "../../../utils/mechanismPhysicalEnvelope";

export type FoundryPhysicalEnvelopeAffine = {
  scale: number;
  translateX: number;
  translateY: number;
};

export type FoundryPhysicalEnvelopePreview = MechanismPhysicalEnvelopeDescriptor["envelope"];

export type FoundryDynamicRootCandidateStatus =
  | "valid"
  | "invalid"
  | "rejected";

export type FoundryDynamicRootLifecycleState =
  | "empty"
  | "valid-mounted"
  | "replacement-staged"
  | "replacement-committed"
  | "rejected-retained"
  | "disposed";

export type FoundryDynamicRootLifecycleObserver = (
  state: FoundryDynamicRootLifecycleState,
) => void;

export type FoundryDynamicRootReplacementOptions = {
  scene: THREE.Scene;
  previousRoot: THREE.Group | null;
  candidateRoot: THREE.Group;
  status: FoundryDynamicRootCandidateStatus;
  onLifecycleState?: FoundryDynamicRootLifecycleObserver;
  disposeRoot?: (root: THREE.Group) => void;
};

const emitFoundryLifecycleState = <State extends FoundryDynamicRootLifecycleState>(
  state: State,
  onLifecycleState: FoundryDynamicRootLifecycleObserver | undefined,
): State => {
  onLifecycleState?.(state);
  return state;
};

const detachAndDisposeFoundryRoot = (
  root: THREE.Group,
  disposeRoot: (root: THREE.Group) => void,
) => {
  root.parent?.remove(root);
  disposeRoot(root);
};

/**
 * Commit the renderer candidate after its authority result is known. A valid
 * candidate is attached before the prior root is detached; an authoritative
 * invalid candidate clears the visible root, while an edit rejected upstream
 * is the only candidate state that retains it.
 */
export const replaceFoundryDynamicRoot = ({
  scene,
  previousRoot,
  candidateRoot,
  status,
  onLifecycleState,
  disposeRoot = disposeFoundryThreeObject,
}: FoundryDynamicRootReplacementOptions): {
  root: THREE.Group | null;
  transitions: readonly FoundryDynamicRootLifecycleState[];
} => {
  if (status === "rejected") {
    detachAndDisposeFoundryRoot(candidateRoot, disposeRoot);
    const lifecycle = emitFoundryLifecycleState(
      "rejected-retained",
      onLifecycleState,
    );
    return {
      root: previousRoot,
      transitions: [lifecycle],
    };
  }

  if (status === "invalid" || candidateRoot.children.length === 0) {
    detachAndDisposeFoundryRoot(candidateRoot, disposeRoot);
    if (previousRoot) {
      scene.remove(previousRoot);
      disposeRoot(previousRoot);
    }
    const lifecycle = emitFoundryLifecycleState("empty", onLifecycleState);
    return {
      root: null,
      transitions: [lifecycle],
    };
  }

  if (previousRoot) {
    const staged = emitFoundryLifecycleState(
      "replacement-staged",
      onLifecycleState,
    );
    scene.add(candidateRoot);
    const committed = emitFoundryLifecycleState(
      "replacement-committed",
      onLifecycleState,
    );
    scene.remove(previousRoot);
    disposeRoot(previousRoot);
    return {
      root: candidateRoot,
      transitions: [staged, committed],
    };
  }

  scene.add(candidateRoot);
  const lifecycle = emitFoundryLifecycleState("valid-mounted", onLifecycleState);
  return {
    root: candidateRoot,
    transitions: [lifecycle],
  };
};

export const disposeFoundryDynamicRoot = ({
  scene,
  root,
  onLifecycleState,
  disposeRoot = disposeFoundryThreeObject,
}: {
  scene: THREE.Scene;
  root: THREE.Group | null;
  onLifecycleState?: FoundryDynamicRootLifecycleObserver;
  disposeRoot?: (root: THREE.Group) => void;
}): void => {
  if (root) {
    scene.remove(root);
    disposeRoot(root);
  }
  emitFoundryLifecycleState("disposed", onLifecycleState);
};

export const mapPhysicalEnvelopeToFoundryPreview = (
  descriptor: MechanismPhysicalEnvelopeDescriptor,
  affine: FoundryPhysicalEnvelopeAffine,
): FoundryPhysicalEnvelopePreview => {
  const envelope = descriptor.envelope;
  const scale = Math.abs(affine.scale);
  const pose = {
    x: envelope.x * affine.scale + affine.translateX,
    y: -envelope.y * affine.scale + affine.translateY,
  };
  if (envelope.kind === "circle")
    return { kind: "circle", ...pose, rotation: 0, radius: envelope.radius * scale };
  if (envelope.kind === "capsule")
    return {
      kind: "capsule",
      ...pose,
      rotation: -envelope.rotation,
      length: envelope.length * scale,
      radius: envelope.radius * scale,
    };
  return {
    kind: "oriented-box",
    ...pose,
    rotation: -envelope.rotation,
    width: envelope.width * scale,
    height: envelope.height * scale,
  };
};

export const foundryPhysicalEnvelopeAffine = (
  mechanism: MechanismConfig,
  simulation: MechanismPreviewSimulation,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): FoundryPhysicalEnvelopeAffine => {
  const source = calculateLinkage(mechanism, simulation.inputAngleRad, kit).p1;
  return {
    scale: simulation.scale,
    translateX: simulation.state.p1.x - source.x * simulation.scale,
    translateY: simulation.state.p1.y + source.y * simulation.scale,
  };
};

type VisiblePathTrace = {
  points: Point[];
};

type FoundryDynamicLayerRenderOptions = {
  mechanism: MechanismConfig;
  kit: PhysicalKitSettings;
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
  kit,
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
  const mappedLayerEnvelopes = new Map(
    buildMechanismPhysicalEnvelopeDescriptors(mechanism, [simulation.inputAngleRad], renderPlan, kit)
      .map((descriptor) => [
        descriptor.layerId,
        mapPhysicalEnvelopeToFoundryPreview(
          descriptor,
          foundryPhysicalEnvelopeAffine(mechanism, simulation, kit),
        ),
      ]),
  );
  const envelopeForLayer = (layerId: string) => mappedLayerEnvelopes.get(layerId);
  const frameOwnerForLayer = (
    layer: Pick<FabricationRenderLayer, "layerId">,
    role: FoundryFrameOwner["role"] = "layer",
  ): FoundryFrameOwner => ({
    bindingId: `foundry:layer:${layer.layerId}`,
    role,
    sourceId: layer.layerId,
  });
  const frameOwnerForPin = (
    pinSpanId: string,
    role: FoundryFrameOwner["role"],
    ordinal?: number,
  ): FoundryFrameOwner => ({
    bindingId: `foundry:pin:${pinSpanId}`,
    role,
    sourceId: pinSpanId,
    ...(ordinal === undefined ? {} : { ordinal }),
  });
  const metadataForLayer = (layer: FabricationRenderLayer): FoundryFabricationMeshMetadata => ({
    fabricationLayerId: layer.layerId,
    supportPathIds: [...layer.supportPathIds],
    primitiveKind: "layer",
    frameOwner: frameOwnerForLayer(layer),
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
  const camGuideFallbackRotation = -Math.atan2(s.j2.y - s.p1.y, s.j2.x - s.p1.x);
  const camFollowerRotation = camGuideFallbackRotation - Math.PI / 2;
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
    const envelope = envelopeForLayer(layer.layerId);
    if (layer.sourceNodeId === "connector-link-a") {
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(s.j1, s.effector, z, mat, holeCount, undefined, metadata, capsule
        ? {
          center: { x: capsule.x, y: capsule.y },
          rotation: capsule.rotation,
          centerlineLengthPx: capsule.length,
          radiusPx: capsule.radius,
        }
        : undefined,
      );
    } else if (layer.sourceNodeId === "connector-link-b") {
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(s.j2, s.effector, z, mat, holeCount, undefined, metadata, capsule
        ? {
          center: { x: capsule.x, y: capsule.y },
          rotation: capsule.rotation,
          centerlineLengthPx: capsule.length,
          radiusPx: capsule.radius,
        }
        : undefined,
      );
    } else if (layer.sourceNodeId === "carrier") {
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(s.p1, s.p2, z, mat, holeCount, undefined, metadata, capsule
        ? {
          center: { x: capsule.x, y: capsule.y },
          rotation: capsule.rotation,
          centerlineLengthPx: capsule.length,
          radiusPx: capsule.radius,
        }
        : undefined,
      );
    }
    else if (layer.sourceNodeId === "output-link" && mechanism.type === "4bar") {
      const pose = fourBarBlankPoses["4bar.output-joint"];
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(
        pose?.origin ?? s.p2,
        pose?.end ?? s.j2,
        z,
        mat,
        pose?.holeCount ?? holeCount,
        pose?.partKey,
        metadata,
        capsule
        ? {
            center: { x: capsule.x, y: capsule.y },
            rotation: capsule.rotation,
            centerlineLengthPx: capsule.length,
            radiusPx: capsule.radius,
          }
          : undefined,
      );
    } else if (layer.sourceNodeId === "input-link" && mechanism.type === "4bar") {
      const pose = fourBarBlankPoses["4bar.input-joint"];
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(
        pose?.origin ?? s.p1,
        pose?.end ?? s.j1,
        z,
        mat,
        pose?.holeCount ?? holeCount,
        pose?.partKey,
        metadata,
        capsule
        ? {
            center: { x: capsule.x, y: capsule.y },
            rotation: capsule.rotation,
            centerlineLengthPx: capsule.length,
            radiusPx: capsule.radius,
          }
          : undefined,
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
      const capsule = envelope?.kind === "capsule" ? envelope : undefined;
      addBar(a, b, z, mat, holeCount, undefined, metadata, capsule
        ? {
          center: { x: capsule.x, y: capsule.y },
          rotation: capsule.rotation,
          centerlineLengthPx: capsule.length,
          radiusPx: capsule.radius,
        }
        : undefined,
      );
    }
  };
  const renderGearLayer = (
    layer: FabricationRenderLayer,
    z: number,
    mat: THREE.Material,
  ) => {
    const metadata = metadataForLayer(layer);
    const envelope = envelopeForLayer(layer.layerId);
    const envelopeRadius = envelope?.kind === "circle" ? envelope.radius : undefined;
    const envelopeCenter = envelope?.kind === "circle" ? envelope : undefined;
    if (layer.sourceNodeId === "ring-gear")
      addRingGear(
        envelopeCenter ? { x: envelopeCenter.x, y: envelopeCenter.y } : s.p1,
        planetaryRingPitchRadius(mechanism),
        z,
        0,
        mat,
        metadata,
        envelopeRadius,
      );
    else if (layer.sourceNodeId === "planet-gear") {
        const planetCenters = [s.p2];
        const planetCount = Math.max(1, planetCenters.length);
      planetCenters.forEach((fallbackCenter, index) =>
          addGear(
            envelopeCenter ? { x: envelopeCenter.x, y: envelopeCenter.y } : fallbackCenter,
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
            envelopeRadius,
          ),
        );
    } else if (layer.sourceNodeId === "sun-gear")
      addGear(
        envelopeCenter ? { x: envelopeCenter.x, y: envelopeCenter.y } : s.p1,
        mechanism.crankLength,
        z,
        angle,
        mat,
        metadata,
        envelopeRadius,
      );
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
        envelopeCenter ?? gearCenters[index] ?? fallbackCenter,
        gearRadii[index] ?? fallbackRadius,
        z,
        angle * ratio + phaseDeg,
        mat,
        metadata,
        envelopeRadius,
      );
    } else addGear(envelopeCenter ?? s.p1, mechanism.crankLength, z, angle, mat, metadata, envelopeRadius);
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
            frameOwner: frameOwnerForPin(pin.pinSpanId, "spacer", index),
          }),
        );
    else if (layerItem.renderKind === "linkage")
      renderLinkageLayer(layerItem, z, mat);
    else if (layerItem.renderKind === "gear") {
      renderGearLayer(layerItem, z, mat);
    } else if (layerItem.renderKind === "cam") {
      const envelope = envelopeForLayer(layerItem.layerId);
      const mappedCamCenter = envelope?.kind === "circle" ? { x: envelope.x, y: envelope.y } : s.p1;
      addCam(
        mappedCamCenter,
        z,
        degToRad(angle),
        mat,
        metadataForLayer(layerItem),
        envelope?.kind === "circle" ? envelope.radius : undefined,
      );
    } else if (layerItem.renderKind === "guide") {
      const envelope = envelopeForLayer(layerItem.layerId);
      const slotRotation =
        envelope?.kind === "oriented-box"
          ? -envelope.rotation
          : layerItem.sourceNodeId === "follower-guide"
            ? camGuideFallbackRotation
            : layerItem.sourceNodeId === "guide"
              ? Math.PI / 2
              : -Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
      const slotCenter =
        envelope?.kind === "oriented-box"
          ? { x: envelope.x, y: envelope.y }
          : layerItem.sourceNodeId === "follower-guide"
            ? s.p2
            : layerItem.sourceNodeId === "slotted-arm"
              ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }
              : s.j2;
      addSlotPlate(
        slotCenter,
        z,
        mat,
        slotRotation,
        layerItem.sourceNodeId === "guide" && mechanism.type === "rack-pinion" ? 4.8 : 3.2,
        metadataForLayer(layerItem),
        envelope?.kind === "oriented-box" ? {
          widthPx: envelope.width,
          heightPx: envelope.height,
        } : undefined,
      );
    } else if (layerItem.renderKind === "rack") {
      const metadata = metadataForLayer(layerItem);
      const envelope = envelopeForLayer(layerItem.layerId);
      addRack(s.j2, z, mat, metadata, envelope?.kind === "oriented-box" ? {
        center: { x: envelope.x, y: envelope.y },
        rotation: envelope.rotation,
        widthPx: envelope.width,
        heightPx: envelope.height,
      } : undefined);
      if (envelope?.kind !== "oriented-box") {
        addEndStop(s.j2, -2.55, z, metadata, 0);
        addEndStop(s.j2, 2.55, z, metadata, 1);
      }
    } else if (layerItem.renderKind === "follower")
    {
      const envelope = envelopeForLayer(layerItem.layerId);
      addFollowerBlock(
        envelope?.kind === "oriented-box"
          ? { x: envelope.x, y: envelope.y }
          : s.j2,
        z,
        mat,
        envelope?.kind === "oriented-box"
          ? -envelope.rotation
          : mechanism.type === "cam"
            ? camFollowerRotation
            : 0,
        metadataForLayer(layerItem),
        envelope?.kind === "oriented-box"
          ? {
            widthPx: envelope.width,
            heightPx: envelope.height,
          }
          : undefined,
      );
    }
  });
  pinStacks.forEach((pinStack) => {
    pinStack.retainerZ.forEach((z, retainerIndex) => {
      const clipLayerIndex = pinStack.clipLayerIndexes.find((index) => Math.abs((renderedLayerZ[index] ?? renderPlan.layers[index]?.z ?? 0) - z) <= 1e-6);
      const clipLayer = clipLayerIndex === undefined ? undefined : renderPlan.layers[clipLayerIndex];
      addClipCap(pinStack.point, z, clipMat, 1.35, {
        ...(clipLayer ? { fabricationLayerId: clipLayer.layerId } : {}),
        supportPathIds: [pinStack.pathId],
        pinSpanIds: [pinStack.pinSpanId],
        primitiveKind: "retainer",
        frameOwner: frameOwnerForPin(pinStack.pinSpanId, "clip", retainerIndex),
      });
    });
    addPin(pinStack.point, pinStack.centerZ, pinStack.lengthZ, {
      supportPathIds: [pinStack.pathId],
      pinSpanIds: [pinStack.pinSpanId],
      primitiveKind: "pin",
      frameOwner: frameOwnerForPin(pinStack.pinSpanId, "pin"),
    });
  });
};

import type * as THREE from "three";
import type { JointState, Point } from "../../../types";
import {
  prepareMechanismPhysicalEnvelopeModel,
  samplePreparedMechanismPhysicalLayerEnvelope,
  type PreparedMechanismPhysicalEnvelopeModel,
  type PreparedMechanismPhysicalLayerEnvelope,
} from "../../../utils/mechanismPhysicalEnvelope";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import {
  prepareFoundrySupportPointSelector,
  samplePreparedFoundrySupportPoint,
  type FoundrySupportPointSelector,
} from "../../../utils/mechanismPreviewStacks";
import type { FabricationRenderPlan } from "../../../utils/mechanismFabricationZStack";
import type { PreparedMechanismKinematics } from "../../../utils/kinematics";
import {
  FOUNDRY_FRAME_OWNER_KEY,
  type FoundryFrameOwner,
} from "./foundryThreePrimitives";
import {
  captureFoundryAssemblyFrameBinding,
  createFoundryAssemblyFrameBindings,
  updateFoundryAssemblyFrameBindings,
  type FoundryAssemblyFrameBindings,
  type FoundryAssemblyFramePresentation,
} from "./foundryAssemblyFrameBindings";
const FOUNDRY_FRAME_PREVIEW_CENTER_X = 180;
const FOUNDRY_FRAME_PREVIEW_CENTER_Y = 120;
const FOUNDRY_FRAME_PREVIEW_UNITS = 18;
export type FoundryFrameCompanionBinding = {
  object: THREE.Object3D;
  owner: FoundryFrameOwner;
  offsetLocalX: number;
  offsetLocalY: number;
  offsetZ: number;
  rotationOffset: number;
};
export type FoundryFrameLayerBinding = {
  bindingId: string;
  owner: THREE.Object3D;
  owners: THREE.Object3D[];
  companions: FoundryFrameCompanionBinding[];
  prepared: PreparedMechanismPhysicalLayerEnvelope;
  initialDimension: number;
  baseScaleX: number;
  layerZOffset: number;
};
export type FoundryFramePointBinding = {
  bindingId: string;
  owner: THREE.Object3D;
  role: "pin" | "spacer" | "clip";
  ordinal?: number;
  presentationKey: string;
  selector: FoundrySupportPointSelector | undefined;
  z: number;
};
export type FoundryAutomataFrameTransform = {
  x: number;
  y: number;
  z: number;
  rotationZ: number;
  scale: number;
  visible: boolean;
};

export type FoundryAutomataFramePresentation = Readonly<
  Record<string, FoundryAutomataFrameTransform>
>;

export type FoundryFramePresentation = {
  layerRotationRadByBindingId?: Readonly<Record<string, number>>;
  layerZByBindingId?: Readonly<Record<string, number>>;
  pointZByPointKey?: Readonly<Record<string, number>>;
  automataByBindingId?: FoundryAutomataFramePresentation;
  assembly?: FoundryAssemblyFramePresentation;
};
type FoundryFrameAutomataBinding = {
  bindingId: string;
  owner: THREE.Object3D;
};

export type FoundryFrameBindingTable = {
  readonly layers: readonly FoundryFrameLayerBinding[];
  readonly points: readonly FoundryFramePointBinding[];
  readonly automata: readonly FoundryFrameAutomataBinding[];
  readonly assembly: FoundryAssemblyFrameBindings;
  readonly preparedPhysicalEnvelope: PreparedMechanismPhysicalEnvelopeModel;
  readonly planetCenters: Point[];
};
export type CreateFoundryFrameBindingTableOptions = {
  root: THREE.Group;
  kinematics: PreparedMechanismKinematics;
  renderPlan: FabricationRenderPlan;
  simulation: MechanismPreviewSimulation;
};
export type FoundryFrameAffine = {
  scale: number;
  translateX: number;
  translateY: number;
};

export const foundryFrameAffineForSimulation = (
  simulation: MechanismPreviewSimulation,
): FoundryFrameAffine => ({
  scale: simulation.scale,
  translateX:
    simulation.state.p1.x - simulation.rawState.p1.x * simulation.scale,
  translateY:
    simulation.state.p1.y + simulation.rawState.p1.y * simulation.scale,
});
export const foundryFramePointPresentationKey = (
  bindingId: string,
  role: "pin" | "spacer" | "clip",
  ordinal?: number,
) => `${bindingId}|${role}|${ordinal ?? 0}`;

const ownerFromObject = (
  object: THREE.Object3D,
): FoundryFrameOwner | undefined => {
  const candidate = object.userData[FOUNDRY_FRAME_OWNER_KEY] as
    | Partial<FoundryFrameOwner>
    | undefined;
  if (!candidate || typeof candidate.bindingId !== "string" || typeof candidate.role !== "string") return undefined;
  return candidate as FoundryFrameOwner;
};

const dimensionForEnvelope = (
  envelope: ReturnType<typeof samplePreparedMechanismPhysicalLayerEnvelope>,
) => {
  if (envelope.kind === "circle") return envelope.radius;
  if (envelope.kind === "capsule") return envelope.length;
  return envelope.width;
};

const hasParentAutomataId = (
  object: THREE.Object3D,
  key: "partId" | "sceneObjectId",
  id: string,
) =>
  typeof object.parent?.userData[key] === "string"
  && object.parent.userData[key] === id;

export const createFoundryFrameBindingTable = ({
  root,
  kinematics,
  renderPlan,
  simulation,
}: CreateFoundryFrameBindingTableOptions): FoundryFrameBindingTable => {
  const preparedPhysicalEnvelope = prepareMechanismPhysicalEnvelopeModel(
    kinematics,
    renderPlan,
  );
  const layerById = new Map(
    renderPlan.layers.map((layer) => [layer.layerId, layer]),
  );
  const pinSpanById = new Map(
    renderPlan.pinSpans.map((span) => [span.id, span]),
  );
  const supportPathById = new Map(
    renderPlan.supportPaths.map((path) => [path.id, path]),
  );
  const layers: FoundryFrameLayerBinding[] = [];
  const layersByBindingId = new Map<string, FoundryFrameLayerBinding>();
  const points: FoundryFramePointBinding[] = [];
  const companions: FoundryFrameCompanionBinding[] = [];
  const automata: FoundryFrameAutomataBinding[] = [];
  const pendingCompanions: Array<{
    object: THREE.Object3D;
    owner: FoundryFrameOwner;
  }> = [];
  const assembly = createFoundryAssemblyFrameBindings();
  const planetCenters = [simulation.rawState.p2];

  root.traverse((object) => {
    const owner = ownerFromObject(object);
    if (owner) {
      if (owner.role === "layer" && owner.sourceId) {
        const prepared = preparedPhysicalEnvelope.layerById.get(owner.sourceId);
        if (prepared) {
          let binding = layersByBindingId.get(owner.bindingId);
          if (!binding) {
            const initialEnvelope = samplePreparedMechanismPhysicalLayerEnvelope(
              prepared,
              simulation.rawState,
            );
            binding = {
              bindingId: owner.bindingId,
              owner: object,
              owners: [object],
              companions: [],
              prepared,
              initialDimension: dimensionForEnvelope(initialEnvelope),
              baseScaleX: object.scale.x,
              layerZOffset:
                object.position.z - (layerById.get(owner.sourceId)?.z ?? object.position.z),
            };
            layers.push(binding);
            layersByBindingId.set(owner.bindingId, binding);
          } else {
            binding.owners.push(object);
          }
        }
      } else if (
        (owner.role === "pin"
          || owner.role === "spacer"
          || owner.role === "clip")
        && owner.sourceId
      ) {
        const span = pinSpanById.get(owner.sourceId);
        const path = span ? supportPathById.get(span.supportPathId) : undefined;
        points.push({
          bindingId: owner.bindingId,
          owner: object,
          role: owner.role,
          ...(owner.ordinal === undefined ? {} : { ordinal: owner.ordinal }),
          presentationKey: foundryFramePointPresentationKey(
            owner.bindingId,
            owner.role,
            owner.ordinal,
          ),
          selector: path
            ? prepareFoundrySupportPointSelector(path.rootNodeId)
            : undefined,
          z: object.position.z,
        });
      } else if (owner.role === "hole-group" || owner.role === "end-stop") {
        pendingCompanions.push({ object, owner });
      }
    }

    const partId = object.userData.partId;
    if (
      typeof partId === "string"
      && !hasParentAutomataId(object, "partId", partId)
    ) {
      automata.push({
        bindingId: `foundry:automata:part:${partId}`,
        owner: object,
      });
    }
    const sceneObjectId = object.userData.sceneObjectId;
    if (
      typeof sceneObjectId === "string"
      && !hasParentAutomataId(object, "sceneObjectId", sceneObjectId)
    ) {
      automata.push({
        bindingId: `foundry:automata:object:${sceneObjectId}`,
        owner: object,
      });
    }
    captureFoundryAssemblyFrameBinding(object, assembly);
  });

  pendingCompanions.forEach(({ object, owner }) => {
    const layer = layersByBindingId.get(owner.bindingId);
    if (!layer) return;
    const cos = Math.cos(-layer.owner.rotation.z);
    const sin = Math.sin(-layer.owner.rotation.z);
    const deltaX = object.position.x - layer.owner.position.x;
    const deltaY = object.position.y - layer.owner.position.y;
    const companion = {
      object,
      owner,
      offsetLocalX: deltaX * cos - deltaY * sin,
      offsetLocalY: deltaX * sin + deltaY * cos,
      offsetZ: object.position.z - layer.owner.position.z,
      rotationOffset: object.rotation.z - layer.owner.rotation.z,
    } satisfies FoundryFrameCompanionBinding;
    companions.push(companion);
    layer.companions.push(companion);
  });

  return {
    layers,
    points,
    automata,
    assembly,
    preparedPhysicalEnvelope,
    planetCenters,
  };
};

export const updateFoundryFrameBindings = (
  table: FoundryFrameBindingTable,
  frame: {
    simulation: MechanismPreviewSimulation;
    presentation?: FoundryFramePresentation;
  },
): void => {
  const { simulation, presentation } = frame;
  const rawState: JointState = simulation.rawState;
  const scale = simulation.scale;
  const translateX =
    simulation.state.p1.x - rawState.p1.x * simulation.scale;
  const translateY =
    simulation.state.p1.y + rawState.p1.y * simulation.scale;
  table.planetCenters[0] = rawState.p2;
  const supportContext = {
    state: rawState,
    gearCenters: table.preparedPhysicalEnvelope.gearCenters,
    planetCenters: table.planetCenters,
  };

  for (let layerIndex = 0; layerIndex < table.layers.length; layerIndex += 1) {
    const layer = table.layers[layerIndex];
    const envelope = samplePreparedMechanismPhysicalLayerEnvelope(
      layer.prepared,
      rawState,
    );
    const previewX = envelope.x * scale + translateX;
    const previewY = -envelope.y * scale + translateY;
    const positionX =
      (previewX - FOUNDRY_FRAME_PREVIEW_CENTER_X) / FOUNDRY_FRAME_PREVIEW_UNITS;
    const positionY =
      (FOUNDRY_FRAME_PREVIEW_CENTER_Y - previewY) / FOUNDRY_FRAME_PREVIEW_UNITS;
    const dimension = dimensionForEnvelope(envelope);
    const rotation = envelope.kind === "circle"
      ? presentation?.layerRotationRadByBindingId?.[layer.bindingId]
      : envelope.rotation;

    for (let ownerIndex = 0; ownerIndex < layer.owners.length; ownerIndex += 1) {
      const owner = layer.owners[ownerIndex];
      owner.position.x = positionX;
      owner.position.y = positionY;
      if (typeof rotation === "number" && Number.isFinite(rotation)) {
        owner.rotation.z = rotation;
      }
      if (envelope.kind !== "circle" && layer.initialDimension > 0) {
        owner.scale.x = layer.baseScaleX * dimension / layer.initialDimension;
      }
    }

    const ownerRotation = typeof rotation === "number" && Number.isFinite(rotation)
      ? rotation
      : layer.owner.rotation.z;
    const targetLayerZ = presentation?.layerZByBindingId?.[layer.bindingId];
    const ownerZ = typeof targetLayerZ === "number" && Number.isFinite(targetLayerZ)
      ? targetLayerZ + layer.layerZOffset
      : layer.owner.position.z;
    for (let ownerIndex = 0; ownerIndex < layer.owners.length; ownerIndex += 1) {
      layer.owners[ownerIndex].position.z = ownerZ;
    }

    const cos = Math.cos(ownerRotation);
    const sin = Math.sin(ownerRotation);
    for (
      let companionIndex = 0;
      companionIndex < layer.companions.length;
      companionIndex += 1
    ) {
      const companion = layer.companions[companionIndex];
      companion.object.position.x =
        positionX + companion.offsetLocalX * cos - companion.offsetLocalY * sin;
      companion.object.position.y =
        positionY + companion.offsetLocalX * sin + companion.offsetLocalY * cos;
      companion.object.position.z = ownerZ + companion.offsetZ;
      companion.object.rotation.z = ownerRotation + companion.rotationOffset;
    }
  }

  for (let pointIndex = 0; pointIndex < table.points.length; pointIndex += 1) {
    const pointBinding = table.points[pointIndex];
    const point = samplePreparedFoundrySupportPoint(
      pointBinding.selector,
      supportContext,
    );
    if (!point) continue;
    const pointPreviewX = point.x * scale + translateX;
    const pointPreviewY = -point.y * scale + translateY;
    pointBinding.owner.position.x =
      (pointPreviewX - FOUNDRY_FRAME_PREVIEW_CENTER_X) / FOUNDRY_FRAME_PREVIEW_UNITS;
    pointBinding.owner.position.y =
      (FOUNDRY_FRAME_PREVIEW_CENTER_Y - pointPreviewY) / FOUNDRY_FRAME_PREVIEW_UNITS;
    const pointZ = presentation?.pointZByPointKey?.[pointBinding.presentationKey];
    pointBinding.owner.position.z = typeof pointZ === "number" && Number.isFinite(pointZ)
      ? pointZ
      : pointBinding.z;
  }

  if (presentation?.assembly) {
    updateFoundryAssemblyFrameBindings(table.assembly, presentation.assembly);
  }

  const automata = presentation?.automataByBindingId;
  if (!automata) return;
  for (let automataIndex = 0; automataIndex < table.automata.length; automataIndex += 1) {
    const binding = table.automata[automataIndex];
    const transform = automata[binding.bindingId];
    if (!transform) {
      binding.owner.visible = false;
      continue;
    }
    binding.owner.position.set(transform.x, transform.y, transform.z);
    binding.owner.rotation.z = transform.rotationZ;
    binding.owner.scale.set(transform.scale, transform.scale, 1);
    binding.owner.visible = transform.visible;
  }
};

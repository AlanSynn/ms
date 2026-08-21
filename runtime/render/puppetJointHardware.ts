import * as THREE from 'three';

import type { Point } from '../../types';

type PuppetJointPose = {
  id: string;
  position: Point;
};

export type PuppetJointHardwareInstances = {
  pins: THREE.InstancedMesh;
  washers: THREE.InstancedMesh;
  jointIds: readonly string[];
};

const JOINT_IDS_DATA_KEY = 'puppetJointIds';
const pinRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);
const washerRotation = new THREE.Quaternion();

export const createPuppetJointHardwareInstances = ({
  jointIds,
  pinGeometry,
  washerGeometry,
  pinMaterial,
  washerMaterial,
}: {
  jointIds: readonly string[];
  pinGeometry: THREE.BufferGeometry;
  washerGeometry: THREE.BufferGeometry;
  pinMaterial: THREE.Material;
  washerMaterial: THREE.Material;
}): PuppetJointHardwareInstances => {
  const pins = new THREE.InstancedMesh(
    pinGeometry,
    pinMaterial,
    jointIds.length,
  );
  pins.name = 'skeleton-pins-instanced';
  pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pins.frustumCulled = false;
  pins.userData[JOINT_IDS_DATA_KEY] = [...jointIds];

  const washers = new THREE.InstancedMesh(
    washerGeometry,
    washerMaterial,
    jointIds.length,
  );
  washers.name = 'skeleton-washers-instanced';
  washers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  washers.frustumCulled = false;
  washers.userData[JOINT_IDS_DATA_KEY] = [...jointIds];

  return { pins, washers, jointIds: [...jointIds] };
};

export const updatePuppetJointHardwareInstances = ({
  hardware,
  joints,
  viewScale,
  pinZ,
  washerZ,
  isVisible = () => true,
}: {
  hardware: PuppetJointHardwareInstances;
  joints: readonly PuppetJointPose[];
  viewScale: number;
  pinZ: number;
  washerZ: number;
  isVisible?: (jointId: string) => boolean;
}) => {
  const jointsById = new Map(joints.map((joint) => [joint.id, joint]));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const visibleScale = new THREE.Vector3(1, 1, 1);
  const hiddenScale = new THREE.Vector3(0, 0, 0);

  hardware.jointIds.forEach((jointId, instanceIndex) => {
    const joint = jointsById.get(jointId);
    const visible = Boolean(joint && isVisible(jointId));
    const scale = visible ? visibleScale : hiddenScale;
    position.set(
      (joint?.position.x ?? 0) / viewScale,
      (joint?.position.y ?? 0) / viewScale,
      pinZ,
    );
    matrix.compose(position, pinRotation, scale);
    hardware.pins.setMatrixAt(instanceIndex, matrix);

    position.z = washerZ;
    matrix.compose(position, washerRotation, scale);
    hardware.washers.setMatrixAt(instanceIndex, matrix);
  });
  hardware.pins.instanceMatrix.needsUpdate = true;
  hardware.washers.instanceMatrix.needsUpdate = true;
};

export const puppetJointIdForInstance = (
  object: THREE.Object3D,
  instanceId: number | undefined,
) => {
  if (!(object instanceof THREE.InstancedMesh) || instanceId === undefined) {
    return undefined;
  }
  const jointIds = object.userData[JOINT_IDS_DATA_KEY];
  if (!Array.isArray(jointIds)) return undefined;
  const jointId = jointIds[instanceId];
  return typeof jointId === 'string' ? jointId : undefined;
};

export const createPuppetCutHoleRingInstances = ({
  partId,
  holes,
  viewScale,
  z,
  geometry,
  material,
}: {
  partId: string;
  holes: readonly Point[];
  viewScale: number;
  z: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) => {
  const rings = new THREE.InstancedMesh(geometry, material, holes.length);
  rings.name = `cut-hole-rings-${partId}-instanced`;
  rings.userData.partId = partId;
  rings.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const matrix = new THREE.Matrix4();
  holes.forEach((hole, instanceIndex) => {
    matrix.makeTranslation(hole.x / viewScale, hole.y / viewScale, z);
    rings.setMatrixAt(instanceIndex, matrix);
  });
  rings.instanceMatrix.needsUpdate = true;
  return rings;
};

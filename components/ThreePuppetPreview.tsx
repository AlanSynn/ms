import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BodyPartLayer, CanvasViewport, MechanismConfig, MechanismType, Point, ProjectState, StandardSkeleton } from '../types';
import { boardGridLines, defaultPhysicalKit, SCENE_PX_PER_MM, sceneBoundsForSheet } from '../utils/coordinates';
import { calculateLinkage, camProfileScale, gearPairOutputRatio, gearTrainCenters, gearTrainOutputRatio, gearTrainPitchRadii, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from '../utils/kinematics';
import { FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_ROLE_MIN_HOLES, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_SPACER_SPEC, fabricationGearProfileForPitchRadius, fabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism, fabricationLinkageSpecForSceneLength, fabricationRenderPlanForMechanism, fabricationRingGearProfileForPitchRadius, fabricationRingInnerGearOutlinePoints, planetaryGearConventionForMechanism, planetaryGearRadii, planetaryPlanetCenters, planetaryRingPitchRadius, type FabricationLinkageRoleLengths } from '../utils/fabrication';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, pointInsideOutline } from '../utils/partGeometry';
import { clampCanvasZoom, WEBGL_PIXEL_RATIO_CAP } from '../utils/viewport';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, loadRapierPhysicsKernel, physicsKernelErrorMessage } from '../utils/physicsKernel';
import { DEFAULT_PUPPET_VIEWER_LAYERS, VIEWER3D_CAMERA_PRESETS, VIEWER3D_CONTRACT_VERSION, createViewer3DContract, viewer3DLayerDataValue, type Viewer3DCameraPreset, type Viewer3DTabKey } from '../utils/viewer3d';

const VIEW_SCALE = 35;
const FABRICATION_LINKAGE_WIDTH_3D = Math.max(0.16, (FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM) / VIEW_SCALE);
const FABRICATION_HOLE_RADIUS_3D = Math.max(0.04, (FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM) / VIEW_SCALE);
const THICKNESS = 0.22;
const SUPPORTED_MECHANISM_TYPES: MechanismType[] = ['crank', '4bar', 'piston', 'yoke', 'quick-return', '5bar', '6bar', 'cam', 'rack-pinion', 'gear', 'planetary_gear'];
const PUPPET_CAMERA_PRESETS: Viewer3DCameraPreset[] = ['front', 'iso'];
type RendererStatus = 'pending' | 'webgl' | 'unavailable';
type LinkKey = 'base' | 'driver' | 'coupler' | 'output' | 'effector' | 'follower';

type MaterialKit = {
  sheet: THREE.MeshStandardMaterial;
  part: THREE.MeshStandardMaterial;
  selected: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
  grid: THREE.LineBasicMaterial;
  cutRing: THREE.MeshStandardMaterial;
  joint: THREE.MeshStandardMaterial;
  pin: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  mechBase: THREE.MeshStandardMaterial;
  mechDrive: THREE.MeshStandardMaterial;
  mechCoupler: THREE.MeshStandardMaterial;
  mechOutput: THREE.MeshStandardMaterial;
  mechPin: THREE.MeshStandardMaterial;
};

type SceneRoots = {
  root: THREE.Group;
  staticLayer: THREE.Group;
  partsLayer: THREE.Group;
  skeletonLayer: THREE.Group;
  mechanismsLayer: THREE.Group;
};

type JointVisual = { pin: THREE.Mesh; washer: THREE.Mesh };
type MechanismVisual = {
  links: Record<LinkKey, THREE.Group>;
  gears: THREE.Mesh[];
  pins: THREE.Mesh[];
  extras: Record<string, THREE.Object3D>;
};

type MechanismInventory = {
  parts: number;
  holes: number;
  slots: number;
  gears: number;
  racks: number;
  cams: number;
  followers: number;
  endStops: number;
};

const to3 = (point: Point, z = 0) => new THREE.Vector3(point.x / VIEW_SCALE, point.y / VIEW_SCALE, z);

const cameraOrbitFromPreset = (preset: Viewer3DCameraPreset) => {
  const [x, y, z] = VIEWER3D_CAMERA_PRESETS[preset].position;
  const flat = Math.max(0.0001, Math.hypot(x, y));
  return {
    yaw: Math.atan2(x, -y) * 180 / Math.PI,
    pitch: Math.atan2(z, flat) * 180 / Math.PI
  };
};

const orbitPosition = (yaw: number, pitch: number): [number, number, number] => {
  const yawRad = yaw * Math.PI / 180;
  const pitchRad = pitch * Math.PI / 180;
  return [
    Math.sin(yawRad) * Math.cos(pitchRad),
    -Math.cos(yawRad) * Math.cos(pitchRad),
    Math.sin(pitchRad)
  ];
};

const clampOrbitPitch = (pitch: number) => Math.max(-68, Math.min(78, pitch));

const sharedGeometryCache = new Map<string, THREE.BufferGeometry>();

const cachedGeometry = <T extends THREE.BufferGeometry>(key: string, factory: () => T): T => {
  const cached = sharedGeometryCache.get(key);
  if (cached) return cached as T;
  const geometry = factory();
  geometry.userData.sharedFabricationGeometry = true;
  sharedGeometryCache.set(key, geometry);
  return geometry;
};

const geometryKeyNumber = (value: number) => Number.isFinite(value) ? value.toFixed(3) : 'nan';

const attachCachedEdges = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry, edgeMaterial: THREE.Material, key: string) => {
  const edgeGeometry = cachedGeometry(`edges:${key}`, () => new THREE.EdgesGeometry(geometry));
  mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
};

const disposeObject = (object: THREE.Object3D, disposeMaterials = false) => object.traverse(child => {
  const mesh = child as THREE.Mesh;
  if (mesh.geometry && !mesh.geometry.userData?.sharedFabricationGeometry) mesh.geometry.dispose();
  if (!disposeMaterials) return;
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach(item => item.dispose());
  else material?.dispose?.();
});

const disposeOwnedMaterials = (object: THREE.Object3D) => object.traverse(child => {
  const material = (child as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  materials.forEach(item => {
    if (!item.userData?.ownedByPartArt) return;
    const map = (item as THREE.MeshBasicMaterial).map;
    map?.dispose();
    item.dispose();
  });
});

const clearGroup = (group: THREE.Group) => {
  [...group.children].forEach(child => {
    group.remove(child);
    disposeOwnedMaterials(child);
    disposeObject(child, false);
  });
};

const createPartArtMaterial = (part: BodyPartLayer, onLoaded: () => void) => {
  const material = new THREE.MeshBasicMaterial({
    color: part.textureUrl ? '#ffffff' : part.fillColor,
    transparent: true,
    opacity: part.textureUrl ? Math.max(0.35, Math.min(1, part.opacity ?? 1)) : 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  material.userData.ownedByPartArt = true;
  if (part.textureUrl) {
    const texture = new THREE.TextureLoader().load(part.textureUrl, () => onLoaded());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    material.needsUpdate = true;
  }
  return material;
};

const viewerTabFromTestId = (testId: string): Viewer3DTabKey => {
  if (testId.startsWith('character')) return 'character';
  if (testId.startsWith('design')) return 'design';
  if (testId.startsWith('blueprint')) return 'blueprint';
  return 'path';
};

const disposeMaterials = (materials: MaterialKit | null) => {
  if (!materials) return;
  Object.values(materials).forEach(material => material.dispose());
};

const zeroInventory = (): MechanismInventory => ({ parts: 0, holes: 0, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 });

const puppetMechanismInventory = (mechanism: MechanismConfig): MechanismInventory => ({
  crank: { parts: 2, holes: 4, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  '4bar': { parts: 5, holes: 15, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  piston: { parts: 5, holes: 10, slots: 1, gears: 0, racks: 0, cams: 0, followers: 1, endStops: 0 },
  yoke: { parts: 5, holes: 9, slots: 2, gears: 0, racks: 0, cams: 0, followers: 1, endStops: 0 },
  'quick-return': { parts: 5, holes: 11, slots: 1, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  '5bar': { parts: 6, holes: 18, slots: 0, gears: 2, racks: 0, cams: 0, followers: 0, endStops: 0 },
  '6bar': { parts: 7, holes: 22, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  cam: { parts: 4, holes: 6, slots: 1, gears: 0, racks: 0, cams: 1, followers: 1, endStops: 0 },
  'rack-pinion': { parts: 5, holes: 6, slots: 1, gears: 1, racks: 1, cams: 0, followers: 1, endStops: 2 },
  gear: { parts: Math.max(6, gearTrainPitchRadii(mechanism).length + 4), holes: Math.max(18, gearTrainPitchRadii(mechanism).length * 8 + 2), slots: 0, gears: gearTrainPitchRadii(mechanism).length, racks: 0, cams: 0, followers: 0, endStops: 0 },
  planetary_gear: { parts: 9, holes: 25, slots: 0, gears: 5, racks: 0, cams: 0, followers: 0, endStops: 0 }
}[mechanism.type]);

const addInventory = (sum: MechanismInventory, item: MechanismInventory): MechanismInventory => ({
  parts: sum.parts + item.parts,
  holes: sum.holes + item.holes,
  slots: sum.slots + item.slots,
  gears: sum.gears + item.gears,
  racks: sum.racks + item.racks,
  cams: sum.cams + item.cams,
  followers: sum.followers + item.followers,
  endStops: sum.endStops + item.endStops
});

const createMaterials = (): MaterialKit => ({
  sheet: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.34 }),
  part: new THREE.MeshStandardMaterial({ color: '#d7dee8', roughness: 0.66, metalness: 0.015, transparent: false, opacity: 1 }),
  selected: new THREE.MeshStandardMaterial({ color: '#a78bfa', roughness: 0.56, metalness: 0.035, transparent: false, opacity: 1 }),
  edge: new THREE.LineBasicMaterial({ color: '#334155', transparent: true, opacity: 0.95 }),
  grid: new THREE.LineBasicMaterial({ color: '#dbe4f0', transparent: true, opacity: 0.2 }),
  cutRing: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.38, metalness: 0.02 }),
  joint: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 }),
  pin: new THREE.MeshStandardMaterial({ color: '#5a6cff', roughness: 0.42, metalness: 0.05 }),
  bone: new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.6, transparent: true, opacity: 0.42 }),
  mechBase: new THREE.MeshStandardMaterial({ color: '#d8b077', roughness: 0.76, metalness: 0.02 }),
  mechDrive: new THREE.MeshStandardMaterial({ color: '#5a6cff', roughness: 0.48, metalness: 0.05 }),
  mechCoupler: new THREE.MeshStandardMaterial({ color: '#e8bc73', roughness: 0.68, metalness: 0.02 }),
  mechOutput: new THREE.MeshStandardMaterial({ color: '#10b981', roughness: 0.62, metalness: 0.03 }),
  mechPin: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.45, metalness: 0.08 })
});

const roundedRect = (width: number, height: number, radius = Math.min(width, height) * 0.18) => {
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 + r, -height / 2);
  shape.lineTo(width / 2 - r, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + r);
  shape.lineTo(width / 2, height / 2 - r);
  shape.quadraticCurveTo(width / 2, height / 2, width / 2 - r, height / 2);
  shape.lineTo(-width / 2 + r, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - r);
  shape.lineTo(-width / 2, -height / 2 + r);
  shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + r, -height / 2);
  return shape;
};

const holePath = (x: number, y: number, r = 0.09) => {
  const hole = new THREE.Path();
  hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
  return hole;
};

const shapeFromLocalOutline = (points: Point[]) => {
  const vectors = points.map(point => new THREE.Vector2(point.x / VIEW_SCALE, point.y / VIEW_SCALE));
  const shape = new THREE.Shape(vectors);
  shape.closePath();
  return shape;
};

const makeUnitBar = (width: number, depth: number, material: THREE.Material) => new THREE.Mesh(
  cachedGeometry(`unit-bar:${geometryKeyNumber(width)}:${geometryKeyNumber(depth)}`, () => new THREE.BoxGeometry(1, width, depth)),
  material
);

const updateUnitBar = (mesh: THREE.Object3D, a?: Point, b?: Point, z = 0) => {
  if (!a || !b) {
    mesh.visible = false;
    return;
  }
  const av = to3(a, z);
  const bv = to3(b, z);
  const len = av.distanceTo(bv);
  mesh.visible = len >= 0.01;
  mesh.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
  mesh.rotation.z = Math.atan2(bv.y - av.y, bv.x - av.x);
  mesh.scale.set(Math.max(0.01, len), 1, 1);
};

const createHoledLink = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material, holeCount = 2, pitchMm = 20) => {
  const group = new THREE.Group();
  const safeLength = Math.max(0.08, length);
  const sceneLength = safeLength * VIEW_SCALE;
  const spec = fabricationLinkageSpecForSceneLength(sceneLength, pitchMm, holeCount);
  const templateLength = Math.max(0.08, (spec.lengthMm * SCENE_PX_PER_MM) / VIEW_SCALE);
  const outlineLength = templateLength + width;
  const firstHoleX = spec.holeCentersMm[0]?.x ?? 0;
  const holeXs = spec.holeCentersMm.map(point => ((point.x - firstHoleX) - spec.lengthMm / 2) * SCENE_PX_PER_MM / VIEW_SCALE);
  group.userData.baseLength = templateLength;
  group.userData.fabricationLocked = true;
  group.userData.fabricationSpecKey = spec.key;
  group.userData.fabricationHoleSpacingMm = spec.pitchMm;
  const key = `holed-link:${spec.key}:${geometryKeyNumber(pitchMm)}:${geometryKeyNumber(outlineLength)}:${geometryKeyNumber(width)}:${geometryKeyNumber(FABRICATION_HOLE_RADIUS_3D)}`;
  const geometry = cachedGeometry(key, () => {
    const shape = roundedRect(outlineLength, width, width / 2);
    holeXs.forEach(x => shape.holes.push(holePath(x, 0, Math.min(FABRICATION_HOLE_RADIUS_3D, width * 0.34))));
    return new THREE.ExtrudeGeometry(shape, { depth: 0.11, bevelEnabled: false, steps: 1, curveSegments: 6 });
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -0.055;
  attachCachedEdges(mesh, geometry, edgeMaterial, key);
  group.add(mesh);
  return group;
};

const createExtrudedMesh = (shape: THREE.Shape, material: THREE.Material, edgeMaterial: THREE.Material, depth = 0.14, cacheKey?: string) => {
  const key = cacheKey ? `extrude:${cacheKey}:${geometryKeyNumber(depth)}` : undefined;
  const geometry = key
    ? cachedGeometry(key, () => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 6 }))
    : new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -depth / 2;
  if (key) attachCachedEdges(mesh, geometry, edgeMaterial, key);
  else mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  return mesh;
};

const createSlotPlate = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const safeLength = Math.max(0.4, length);
  const key = `slot:${geometryKeyNumber(safeLength)}:${geometryKeyNumber(width)}`;
  const shape = roundedRect(safeLength, width, width / 2);
  shape.holes.push(roundedRect(Math.max(0.18, safeLength * 0.68), width * 0.38, width * 0.19));
  group.add(createExtrudedMesh(shape, material, edgeMaterial, 0.14, key));
  return group;
};

const createFollowerBlock = (material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const blockGeometry = cachedGeometry('follower-block:0.46:0.62:0.18', () => new THREE.BoxGeometry(0.46, 0.62, 0.18));
  const block = new THREE.Mesh(blockGeometry, material);
  attachCachedEdges(block, blockGeometry, edgeMaterial, 'follower-block:0.46:0.62:0.18');
  const roller = new THREE.Mesh(cachedGeometry('follower-roller:0.13:0.24:24', () => new THREE.CylinderGeometry(0.13, 0.13, 0.24, 24)), material);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(0, -0.42, 0.12);
  group.add(block, roller);
  return group;
};

const createRack = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const bodyKey = `rack-body:${geometryKeyNumber(length)}:${geometryKeyNumber(width)}`;
  const bodyGeometry = cachedGeometry(bodyKey, () => new THREE.BoxGeometry(length, width, 0.16));
  const body = new THREE.Mesh(bodyGeometry, material);
  attachCachedEdges(body, bodyGeometry, edgeMaterial, bodyKey);
  group.add(body);
  const toothCount = Math.max(6, Math.round(length / 0.34));
  for (let i = 0; i < toothCount; i += 1) {
    const toothGeometry = cachedGeometry('rack-tooth:0.18:0.16:0.16', () => new THREE.BoxGeometry(0.18, 0.16, 0.16));
    const tooth = new THREE.Mesh(toothGeometry, material);
    tooth.position.set(-length / 2 + 0.18 + i * ((length - 0.36) / Math.max(1, toothCount - 1)), -width * 0.72, 0.08);
    tooth.rotation.z = Math.PI / 4;
    attachCachedEdges(tooth, toothGeometry, edgeMaterial, 'rack-tooth:0.18:0.16:0.16');
    group.add(tooth);
  }
  return group;
};

const createEndStop = (material: THREE.Material, edgeMaterial: THREE.Material) => {
  const geometry = cachedGeometry('end-stop:0.2:0.72:0.22', () => new THREE.BoxGeometry(0.2, 0.72, 0.22));
  const mesh = new THREE.Mesh(geometry, material);
  attachCachedEdges(mesh, geometry, edgeMaterial, 'end-stop:0.2:0.72:0.22');
  return mesh;
};

const createCamProfile = (radius: number, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const shape = new THREE.Shape();
  for (let i = 0; i < 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    const r = Math.max(0.3, radius) * camProfileScale(a);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  shape.holes.push(holePath(0, 0, Math.max(0.08, radius * 0.15)));
  const group = new THREE.Group();
  group.add(createExtrudedMesh(shape, material, edgeMaterial, 0.2, `cam:${geometryKeyNumber(radius)}`));
  return group;
};

const ringGearShape = (pitchRadius: number) => {
  const profile = fabricationRingGearProfileForPitchRadius(pitchRadius);
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, profile.outerRadius, profile.outerRadius, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  fabricationRingInnerGearOutlinePoints(pitchRadius).forEach((point, index) => {
    if (index === 0) inner.moveTo(point.x, point.y);
    else inner.lineTo(point.x, point.y);
  });
  inner.closePath();
  shape.holes.push(inner);
  profile.mountHoleCenters.forEach(point => shape.holes.push(holePath(point.x, point.y, profile.mountHoleRadius)));
  return shape;
};

const updateLink = (group: THREE.Object3D, a?: Point, b?: Point, z = 0) => {
  if (!a || !b) {
    group.visible = false;
    return;
  }
  const av = to3(a, z);
  const bv = to3(b, z);
  const len = av.distanceTo(bv);
  group.visible = len >= 0.03;
  group.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
  group.rotation.z = Math.atan2(bv.y - av.y, bv.x - av.x);
  group.scale.x = group.userData.fabricationLocked === true ? 1 : len / Math.max(0.01, Number(group.userData.baseLength ?? len));
};

const updateObject = (object: THREE.Object3D | undefined, center?: Point, z = 0, rotation = 0) => {
  if (!object || !center) return;
  const p = to3(center, z);
  object.visible = true;
  object.position.set(p.x, p.y, p.z);
  object.rotation.z = rotation;
};

const hideObject = (object: THREE.Object3D | undefined) => {
  if (object) object.visible = false;
};

const midpoint = (a?: Point, b?: Point): Point | undefined => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined);

const shifted = (point: Point, angle: number, distance: number): Point => ({
  x: point.x + Math.cos(angle) * distance,
  y: point.y + Math.sin(angle) * distance
});

const toDeg = (radians: number) => (radians * 180) / Math.PI;
const fixed3 = (value: number | undefined) => Number.isFinite(value) ? (value as number).toFixed(3) : '0.000';

const rackGuideCenter = (mechanism: MechanismConfig, state: ReturnType<typeof calculateLinkage>) => {
  const trackAngle = ((mechanism.groundAngle ?? 90) * Math.PI) / 180;
  const radius = Math.max(1, mechanism.crankLength);
  const rackOffset = Number.isFinite(mechanism.sliderOffset) && mechanism.sliderOffset !== 0
    ? mechanism.sliderOffset
    : radius + 12;
  return {
    center: {
      x: state.p1.x - Math.sin(trackAngle) * rackOffset,
      y: state.p1.y + Math.cos(trackAngle) * rackOffset
    },
    trackAngle
  };
};

const mechanismGearRotations = (mechanism: MechanismConfig, angle: number) => {
  const input = angle * (mechanism.speed1 ?? 1);
  const phase = mechanism.phase ?? 0;
  if (mechanism.type === '5bar') return [input, angle * (mechanism.speed2 ?? mechanism.gearRatio ?? 1) + phase];
  if (mechanism.type === 'gear') {
    const radii = gearTrainPitchRadii(mechanism);
    return radii.map((radius, index) => input * ((index % 2 === 1 ? -1 : 1) * radii[0] / radius) + (index === radii.length - 1 ? phase : 0));
  }
  if (mechanism.type === 'planetary_gear') return [
    input,
    ...Array.from({ length: 3 }, (_, index) => input * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) + phase + (index * Math.PI * 2) / 3)
  ];
  return [input];
};

const mechanismTelemetry = (mechanism: MechanismConfig, angle: number) => {
  const state = calculateLinkage(mechanism, angle);
  const rotations = mechanismGearRotations(mechanism, angle);
  const rack = mechanism.type === 'rack-pinion' ? rackGuideCenter(mechanism, state) : null;
  const rackHalfLength = Math.max(1, mechanism.rockerLength / 2);
  return {
    type: mechanism.type,
    primaryRotationDeg: toDeg(rotations[0] ?? 0),
    secondaryRotationDeg: toDeg(rotations[1] ?? 0),
    rackX: state.j2.x,
    rackY: state.j2.y,
    rackGuideX: rack?.center.x ?? 0,
    rackGuideY: rack?.center.y ?? 0,
    endStopAX: rack ? shifted(rack.center, rack.trackAngle, -rackHalfLength).x : 0,
    endStopAY: rack ? shifted(rack.center, rack.trackAngle, -rackHalfLength).y : 0,
    endStopBX: rack ? shifted(rack.center, rack.trackAngle, rackHalfLength).x : 0,
    endStopBY: rack ? shifted(rack.center, rack.trackAngle, rackHalfLength).y : 0
  };
};

const gearShape = (pitchRadius: number, physicalPitchRadiusMm: number) => {
  const profile = fabricationGearProfileForPitchRadius(pitchRadius, physicalPitchRadiusMm);
  const shape = new THREE.Shape();
  profile.outlinePoints.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  shape.holes.push(holePath(0, 0, profile.axleHoleRadius));
  profile.attachmentHoleCenters.forEach(point => shape.holes.push(holePath(point.x, point.y, profile.axleHoleRadius)));
  return shape;
};

const partGeometrySignature = (parts: BodyPartLayer[], project?: ProjectState, skeleton?: StandardSkeleton | null) => [
  parts.map(part => {
    const base = project?.parts[part.id] ?? part;
    const contour = base.contourPoints?.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';') ?? '';
    return `${base.id}:${base.bounds.width}:${base.bounds.height}:${base.bounds.x}:${base.bounds.y}:${base.transform.x}:${base.transform.y}:${base.transform.rotation}:${base.transform.scale}:${base.visible}:${base.textureUrl ?? ''}:${base.contourSource ?? ''}:${contour}:${base.fillColor}:${base.opacity}`;
  }).join('|'),
  Object.values((project?.skeleton ?? skeleton)?.joints ?? {})
    .map(joint => `${joint.id}:${joint.position.x.toFixed(2)}:${joint.position.y.toFixed(2)}`)
    .join('|')
].join('::');

const mechanismGeometrySignature = (mechanisms: MechanismConfig[]) => mechanisms.map(mechanism => [
  mechanism.id,
  mechanism.type,
  fabricationRenderPlanForMechanism(mechanism).zSummary,
  mechanism.crankLength,
  mechanism.groundLength,
  mechanism.couplerLength,
  mechanism.rockerLength,
  mechanism.rodLength,
  mechanism.couplerPointDist,
  mechanism.outputGearRadius,
  mechanism.gearTrainRadii?.join(',') ?? '',
  mechanism.showOutputGear
].join(':')).join('|');

export const ThreePuppetPreview = ({ project, animatedParts = {}, skeleton, mechanisms, angle = 0, viewport, setViewport, inputMode = 'always', testId = 'three-puppet' }: {
  project?: ProjectState;
  animatedParts?: Record<string, BodyPartLayer>;
  skeleton?: StandardSkeleton | null;
  mechanisms?: MechanismConfig[];
  angle?: number;
  viewport?: CanvasViewport;
  setViewport?: React.Dispatch<React.SetStateAction<CanvasViewport>>;
  inputMode?: 'always' | '3d-only' | 'none';
  testId?: string;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rootsRef = useRef<SceneRoots | null>(null);
  const materialsRef = useRef<MaterialKit | null>(null);
  const partMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const jointRefs = useRef<Map<string, JointVisual>>(new Map());
  const boneRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const mechanismRefs = useRef<Map<string, MechanismVisual>>(new Map());
  const [rendererStatus, setRendererStatus] = useState<RendererStatus>('pending');
  const [physicsKernelRuntime, setPhysicsKernelRuntime] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [physicsKernelVersion, setPhysicsKernelVersion] = useState('pending');
  const [physicsKernelError, setPhysicsKernelError] = useState('none');
  const [cameraPreset, setCameraPreset] = useState<Viewer3DCameraPreset>('iso');
  const [cameraOrbit, setCameraOrbit] = useState(() => cameraOrbitFromPreset('iso'));
  const [isViewerDragging, setIsViewerDragging] = useState(false);
  const viewerDragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number; offset: Point; mode: 'orbit' | 'pan' } | null>(null);
  const [visibleLayers, setVisibleLayers] = useState(DEFAULT_PUPPET_VIEWER_LAYERS);
  const toggleLayer = (layer: keyof typeof DEFAULT_PUPPET_VIEWER_LAYERS) => setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer] }));

  useEffect(() => {
    let active = true;
    loadRapierPhysicsKernel()
      .then(kernel => {
        if (!active) return;
        setPhysicsKernelRuntime('ready');
        setPhysicsKernelVersion(kernel.version());
        setPhysicsKernelError('none');
      })
      .catch(error => {
        if (!active) return;
        setPhysicsKernelRuntime('unavailable');
        setPhysicsKernelVersion('unavailable');
        setPhysicsKernelError(physicsKernelErrorMessage(error));
      });
    return () => { active = false; };
  }, []);

  const activeSkeleton = skeleton ?? project?.skeleton ?? null;
  const canonicalSkeleton = project?.skeleton ?? activeSkeleton;
  const kit = project?.settings.physicalKit ?? defaultPhysicalKit();
  const parts = useMemo(() => (project?.partOrder ?? [])
    .map(id => animatedParts[id] ?? project?.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part?.visible)), [animatedParts, project]);
  const topologyParts = useMemo(() => (project?.partOrder ?? [])
    .map(id => project?.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part?.visible)), [project?.partOrder, project?.parts]);
  const geometryParts = topologyParts.length ? topologyParts : parts;
  const joints = useMemo(() => Object.values(activeSkeleton?.joints ?? {}), [activeSkeleton]);
  const bones = useMemo(() => activeSkeleton?.bones ?? [], [activeSkeleton]);
  const mechanismsToRender = useMemo(() => (mechanisms ?? project?.mechanisms ?? [])
    .filter(mechanism => mechanism.visible !== false && mechanism.enabled !== false), [mechanisms, project?.mechanisms]);
  const selectedMechanism = useMemo(
    () => mechanismsToRender.find(mechanism => mechanism.id === project?.selectedMechanismId) ?? mechanismsToRender[0],
    [mechanismsToRender, project?.selectedMechanismId]
  );
  const renderedMechanisms = useMemo(() => selectedMechanism ? [selectedMechanism] : [], [selectedMechanism]);
  const selectedTelemetry = useMemo(() => selectedMechanism ? mechanismTelemetry(selectedMechanism, angle) : null, [selectedMechanism, angle]);
  const selectedRenderPlan = useMemo(() => selectedMechanism ? fabricationRenderPlanForMechanism(selectedMechanism) : null, [selectedMechanism]);
  const selectedLinkageHoleCounts = useMemo(() => selectedMechanism ? fabricationLinkageHoleCountsForMechanism(selectedMechanism, kit.gridPitchMm) : null, [kit.gridPitchMm, selectedMechanism]);
  const selectedLinkageSpecs = useMemo(() => {
    if (!selectedMechanism) return null;
    const lengths = fabricationLinkageSceneLengthsForMechanism(selectedMechanism);
    return Object.fromEntries(Object.entries(lengths).map(([role, length]) => {
      const typedRole = role as keyof FabricationLinkageRoleLengths;
      return [role, fabricationLinkageSpecForSceneLength(length, kit.gridPitchMm, FABRICATION_LINKAGE_ROLE_MIN_HOLES[typedRole])];
    })) as Record<keyof FabricationLinkageRoleLengths, ReturnType<typeof fabricationLinkageSpecForSceneLength>>;
  }, [kit.gridPitchMm, selectedMechanism]);
  const selectedStackZGap = useMemo(() => {
    if (!selectedRenderPlan || selectedRenderPlan.layers.length < 2) return 0;
    return selectedRenderPlan.layers[1].z - selectedRenderPlan.layers[0].z;
  }, [selectedRenderPlan]);
  const stackValidationErrors = useMemo(
    () => mechanismsToRender.reduce((sum, mechanism) => sum + fabricationRenderPlanForMechanism(mechanism).validationErrors.length, 0),
    [mechanismsToRender]
  );
  const mechanismInventory = mechanismsToRender.reduce((sum, mechanism) => addInventory(sum, puppetMechanismInventory(mechanism)), zeroInventory());
  const mechanismLinkCount = mechanismInventory.parts;
  const holeCount = useMemo(() => geometryParts.reduce((sum, part) => {
    const base = project?.parts[part.id] ?? part;
    const landmarks = partLandmarkLocalPoints(base, canonicalSkeleton);
    const outline = fabricablePartOutlinePoints(base, landmarks);
    return sum + landmarks.filter(local => pointInsideOutline(local, outline, 0.5)).length;
  }, 0), [canonicalSkeleton, geometryParts, project?.parts]);
  const partTextureCount = geometryParts.reduce((sum, part) => sum + ((project?.parts[part.id] ?? part).textureUrl ? 1 : 0), 0);
  const partArtCount = geometryParts.length;
  const estimatedObjectCount = boardGridLines(kit).length + 1 + geometryParts.length * 4 + holeCount + joints.length * 2 + bones.length + mechanismLinkCount * 2 + mechanismsToRender.length * 8 + mechanismInventory.holes + mechanismInventory.gears * 2;

  const render = () => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (scene && camera && renderer) {
      renderer.render(scene, camera);
      if (stateRef.current) {
        stateRef.current.dataset.threeSceneVisibleObjectCount = String(estimatedObjectCount);
        stateRef.current.dataset.threeSceneObjectCount = String(estimatedObjectCount);
        stateRef.current.dataset.threeRenderTriangles = String(renderer.info.render.triangles);
      }
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.warn('ThreePuppetPreview WebGL unavailable', error);
      setRendererStatus('unavailable');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, WEBGL_PIXEL_RATIO_CAP));
    renderer.domElement.dataset.testid = `${testId}-canvas`;
    renderer.domElement.className = 'three-puppet-canvas';
    host.appendChild(renderer.domElement);

    const materials = createMaterials();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const root = new THREE.Group();
    root.name = 'puppet-root';
    const staticLayer = new THREE.Group();
    const partsLayer = new THREE.Group();
    const skeletonLayer = new THREE.Group();
    const mechanismsLayer = new THREE.Group();
    root.add(staticLayer, partsLayer, skeletonLayer, mechanismsLayer);
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 6, 9);
    scene.add(key);

    materialsRef.current = materials;
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    rootsRef.current = { root, staticLayer, partsLayer, skeletonLayer, mechanismsLayer };
    setRendererStatus('webgl');

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    return () => {
      ro.disconnect();
      disposeOwnedMaterials(scene);
      disposeObject(scene, false);
      disposeMaterials(materialsRef.current);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      materialsRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      rootsRef.current = null;
      partMeshesRef.current.clear();
      jointRefs.current.clear();
      boneRefs.current.clear();
      mechanismRefs.current.clear();
    };
  }, [testId]);

  const kitSignature = `${kit.profileKey}:${kit.gridPitchMm}:${kit.sheetWidthMm}:${kit.sheetHeightMm}:${kit.boardCells}`;
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.staticLayer);
    const sheet = sceneBoundsForSheet(kit);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sheet.width / VIEW_SCALE, sheet.height / VIEW_SCALE), materials.sheet);
    plane.position.set((sheet.x + sheet.width / 2) / VIEW_SCALE, (sheet.y + sheet.height / 2) / VIEW_SCALE, -0.18);
    roots.staticLayer.add(plane);
    boardGridLines(kit).forEach(line => {
      const geom = new THREE.BufferGeometry().setFromPoints([to3(line.a, -0.16), to3(line.b, -0.16)]);
      roots.staticLayer.add(new THREE.Line(geom, materials.grid));
    });
    render();
  }, [kitSignature, rendererStatus]);

  const partSignature = useMemo(() => partGeometrySignature(geometryParts, project, canonicalSkeleton), [canonicalSkeleton, geometryParts, project?.parts]);
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.partsLayer);
    partMeshesRef.current.clear();
    geometryParts.forEach(part => {
      const base = project?.parts[part.id] ?? part;
      const landmarks = partLandmarkLocalPoints(base, canonicalSkeleton);
      const outline = fabricablePartOutlinePoints(base, landmarks);
      const localHoles = landmarks.filter(local => pointInsideOutline(local, outline, 0.5));
      const shape = shapeFromLocalOutline(outline);
      localHoles.forEach(local => {
        shape.holes.push(holePath(local.x / VIEW_SCALE, local.y / VIEW_SCALE));
      });
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.012 });
      const mesh = new THREE.Mesh(geometry, materials.part);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), materials.edge));
      const artGeometry = new THREE.ShapeGeometry(shape);
      const artPositions = artGeometry.getAttribute('position');
      const uvs: number[] = [];
      const artWidth = Math.max(1, base.bounds.width);
      const artHeight = Math.max(1, base.bounds.height);
      for (let i = 0; i < artPositions.count; i += 1) {
        const x = artPositions.getX(i) * VIEW_SCALE;
        const y = artPositions.getY(i) * VIEW_SCALE;
        uvs.push((x - base.bounds.x) / artWidth, (y - base.bounds.y) / artHeight);
      }
      artGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const art = new THREE.Mesh(artGeometry, createPartArtMaterial(base, render));
      art.name = `part-art-decal-${part.id}`;
      art.position.set(0, 0, THICKNESS + 0.018);
      mesh.add(art);
      if (outline.length > 1) {
        const topOutline = new THREE.BufferGeometry().setFromPoints([
          ...outline.map(point => new THREE.Vector3(point.x / VIEW_SCALE, point.y / VIEW_SCALE, THICKNESS + 0.034)),
          new THREE.Vector3(outline[0].x / VIEW_SCALE, outline[0].y / VIEW_SCALE, THICKNESS + 0.034)
        ]);
        mesh.add(new THREE.Line(topOutline, materials.edge));
      }
      localHoles.forEach(local => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 8, 28), materials.cutRing);
        ring.name = `cut-hole-ring-${part.id}`;
        ring.position.set(local.x / VIEW_SCALE, local.y / VIEW_SCALE, THICKNESS + 0.04);
        mesh.add(ring);
      });
      roots.partsLayer.add(mesh);
      partMeshesRef.current.set(part.id, mesh);
    });
    render();
  }, [partSignature, rendererStatus]);

  useEffect(() => {
    const materials = materialsRef.current;
    if (!materials || rendererStatus !== 'webgl') return;
    parts.forEach(part => {
      const mesh = partMeshesRef.current.get(part.id);
      if (!mesh) return;
      mesh.visible = part.visible;
      mesh.position.set(part.transform.x / VIEW_SCALE, part.transform.y / VIEW_SCALE, part.zIndex * 0.035);
      mesh.rotation.z = (part.transform.rotation * Math.PI) / 180;
      mesh.scale.set(part.transform.scale, part.transform.scale, 1);
      mesh.material = project?.selectedPartId === part.id ? materials.selected : materials.part;
    });
    render();
  }, [parts, project?.selectedPartId, rendererStatus]);

  const skeletonTopology = `${bones.map(([a, b]) => `${a}-${b}`).join('|')}::${joints.map(joint => joint.id).sort().join('|')}`;
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.skeletonLayer);
    jointRefs.current.clear();
    boneRefs.current.clear();
    bones.forEach(([a, b]) => {
      const mesh = makeUnitBar(0.045, 0.07, materials.bone);
      roots.skeletonLayer.add(mesh);
      boneRefs.current.set(`${a}-${b}`, mesh);
    });
    joints.forEach(joint => {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.36, 24), materials.pin);
      pin.rotation.x = Math.PI / 2;
      const washer = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 24), materials.joint);
      roots.skeletonLayer.add(pin, washer);
      jointRefs.current.set(joint.id, { pin, washer });
    });
    render();
  }, [rendererStatus, skeletonTopology]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    bones.forEach(([a, b]) => {
      const mesh = boneRefs.current.get(`${a}-${b}`);
      if (!mesh) return;
      const ja = activeSkeleton?.joints[a];
      const jb = activeSkeleton?.joints[b];
      updateUnitBar(mesh, ja?.position, jb?.position, 0.18);
    });
    joints.forEach(joint => {
      const visual = jointRefs.current.get(joint.id);
      if (!visual) return;
      const p = to3(joint.position, 0.35);
      visual.pin.position.copy(p);
      visual.washer.position.set(p.x, p.y, 0.55);
    });
    render();
  }, [activeSkeleton, bones, joints, rendererStatus]);

  const mechanismSignature = useMemo(() => mechanismGeometrySignature(renderedMechanisms), [renderedMechanisms]);
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.mechanismsLayer);
    mechanismRefs.current.clear();
    renderedMechanisms.forEach(mechanism => {
      const group = new THREE.Group();
      const sceneLinkLengths = fabricationLinkageSceneLengthsForMechanism(mechanism);
      const linkLengths = Object.fromEntries(Object.entries(sceneLinkLengths).map(([role, length]) => [role, Math.max(0.08, length / VIEW_SCALE)])) as Record<LinkKey, number>;
      const pitchMm = project?.settings.physicalKit.gridPitchMm ?? 20;
      const links: Record<LinkKey, THREE.Group> = {
        base: createHoledLink(linkLengths.base, FABRICATION_LINKAGE_WIDTH_3D, materials.mechBase, materials.edge, 3, pitchMm),
        driver: createHoledLink(linkLengths.driver, FABRICATION_LINKAGE_WIDTH_3D, materials.mechDrive, materials.edge, 3, pitchMm),
        coupler: createHoledLink(linkLengths.coupler, FABRICATION_LINKAGE_WIDTH_3D, materials.mechCoupler, materials.edge, 4, pitchMm),
        output: createHoledLink(linkLengths.output, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 3, pitchMm),
        effector: createHoledLink(linkLengths.effector, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 2, pitchMm),
        follower: createHoledLink(linkLengths.follower, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 2, pitchMm)
      };
      Object.values(links).forEach(link => group.add(link));
      const gears: THREE.Mesh[] = [];
      if (['gear', 'planetary_gear', '5bar', 'rack-pinion'].includes(mechanism.type)) {
        const gearRadii = mechanism.type === 'rack-pinion'
          ? [mechanism.crankLength]
          : mechanism.type === 'gear'
            ? gearTrainPitchRadii(mechanism)
            : mechanism.type === 'planetary_gear'
              ? [mechanism.crankLength, mechanism.rockerLength, mechanism.rockerLength, mechanism.rockerLength]
              : [mechanism.crankLength, mechanism.rockerLength];
        gearRadii.forEach((radius, index) => {
          const mesh = new THREE.Mesh(
            cachedGeometry(`gear:${geometryKeyNumber(Math.max(0.38, radius / VIEW_SCALE))}:${geometryKeyNumber(radius / SCENE_PX_PER_MM)}:0.16`, () => new THREE.ExtrudeGeometry(gearShape(Math.max(0.38, radius / VIEW_SCALE), radius / SCENE_PX_PER_MM), { depth: 0.16, bevelEnabled: false, steps: 1, curveSegments: 6 })),
            index === 0 ? materials.mechDrive : materials.mechCoupler
          );
          gears.push(mesh);
          group.add(mesh);
        });
      }
      const extras: Record<string, THREE.Object3D> = {};
      const addExtra = (key: string, object: THREE.Object3D) => {
        object.visible = false;
        extras[key] = object;
        group.add(object);
      };
      if (mechanism.type === 'piston') {
        addExtra('sliderGuide', createSlotPlate(Math.max(2.2, mechanism.rockerLength / VIEW_SCALE), 0.28, materials.mechBase, materials.edge));
        addExtra('sliderBlock', createFollowerBlock(materials.mechOutput, materials.edge));
      }
      if (mechanism.type === 'yoke') {
        addExtra('railSlot', createSlotPlate(Math.max(2.0, (mechanism.rockerLength || 100) / VIEW_SCALE), 0.28, materials.mechBase, materials.edge));
        addExtra('pinSlot', createSlotPlate(Math.max(1.6, (mechanism.crankLength * 2.3) / VIEW_SCALE), 0.34, materials.mechOutput, materials.edge));
        addExtra('sliderBlock', createFollowerBlock(materials.mechOutput, materials.edge));
      }
      if (mechanism.type === 'quick-return') {
        addExtra('slottedLever', createSlotPlate(Math.max(2.2, mechanism.rockerLength / VIEW_SCALE), 0.32, materials.mechOutput, materials.edge));
      }
      if (mechanism.type === 'cam') {
        addExtra('camProfile', createCamProfile(Math.max(0.46, mechanism.crankLength / VIEW_SCALE), materials.mechDrive, materials.edge));
        addExtra('followerGuide', createSlotPlate(Math.max(2.0, (mechanism.rockerLength || 90) / VIEW_SCALE), 0.28, materials.mechBase, materials.edge));
        addExtra('followerBlock', createFollowerBlock(materials.mechOutput, materials.edge));
      }
      if (mechanism.type === 'rack-pinion') {
        addExtra('rackGuide', createSlotPlate(Math.max(3.0, mechanism.rockerLength / VIEW_SCALE), 0.34, materials.mechBase, materials.edge));
        addExtra('rack', createRack(Math.max(2.8, mechanism.rockerLength / VIEW_SCALE), 0.22, materials.mechOutput, materials.edge));
        addExtra('endStopA', createEndStop(materials.mechPin, materials.edge));
        addExtra('endStopB', createEndStop(materials.mechPin, materials.edge));
      }
      if (mechanism.type === 'planetary_gear') {
        {
          const ringRadius = Math.max(0.82, planetaryRingPitchRadius(mechanism) / VIEW_SCALE);
          addExtra('ringGear', createExtrudedMesh(
            ringGearShape(ringRadius),
            materials.mechBase,
            materials.edge,
            0.14,
            `ring-gear:${geometryKeyNumber(ringRadius)}`
          ));
        }
      }
      const pins = Array.from({ length: 6 }, () => {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 20), materials.mechPin);
        pin.rotation.x = Math.PI / 2;
        group.add(pin);
        return pin;
      });
      roots.mechanismsLayer.add(group);
      mechanismRefs.current.set(mechanism.id, { links, gears, pins, extras });
    });
    render();
  }, [mechanismSignature, renderedMechanisms, rendererStatus]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    renderedMechanisms.forEach(mechanism => {
      const visual = mechanismRefs.current.get(mechanism.id);
      if (!visual) return;
      const state = calculateLinkage(mechanism, angle);
      const renderPlan = fabricationRenderPlanForMechanism(mechanism);
      const zLayer = (labels: string[], fallback: number) => renderPlan.layers.find(layer => labels.includes(layer.label))?.z ?? fallback;
      const zBackClip = zLayer(['Back Clip'], 0.22);
      const zDriver = zLayer(['Drive linkage', 'Input linkage', 'Crank linkage', 'Left crank linkage'], 0.76);
      const zDriverGear = zLayer(['Drive gear', 'Left timing gear', 'Pinion gear', 'Cam disk', 'Ring gear'], 0.4);
      const zCoupler = zLayer(['Coupler linkage', 'Center coupler', 'Carrier linkage', 'Slider guide', 'Rack guide', 'Follower guide'], 0.76);
      const zOutput = zLayer(['Output linkage', 'Right crank linkage', 'Follower linkage'], 1.12);
      const zDyad = zLayer(['Dyad link'], zOutput + 0.18);
      const zFollower = zLayer(['Follower link'], zOutput + 0.36);
      const zOutputMoving = zLayer(['Toothed rack', 'Planet gear', 'Sun gear', 'Output gear', 'Right timing gear'], zOutput);
      const zPin = (renderPlan.layers.at(-1)?.z ?? zOutputMoving) + 0.34;
      Object.values(visual.extras).forEach(extra => hideObject(extra));
      updateLink(visual.links.follower, undefined, undefined);
      const groundAngle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
      const outputAngle = Math.atan2(state.j2.y - state.p2.y, state.j2.x - state.p2.x);
      const standardLinks = () => {
        updateLink(visual.links.base, state.p1, state.p2, zBackClip);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.p2 : undefined, state.isValid ? state.j2 : undefined, zOutput);
        updateLink(visual.links.effector, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
      };

      if (mechanism.type === 'piston') {
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.sliderGuide, state.j2, zCoupler, groundAngle);
        updateObject(visual.extras.sliderBlock, state.j2, zOutput, groundAngle);
      } else if (mechanism.type === 'yoke') {
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.railSlot, state.j2, zCoupler, groundAngle);
        updateObject(visual.extras.pinSlot, state.j2, zOutput, groundAngle + Math.PI / 2);
        updateObject(visual.extras.sliderBlock, state.j2, zOutput, groundAngle);
      } else if (mechanism.type === 'quick-return') {
        updateLink(visual.links.base, state.p1, state.p2, zBackClip);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.p2, state.j2, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.slottedLever, midpoint(state.p2, state.j2), zOutput, outputAngle);
      } else if (mechanism.type === '5bar') {
        updateLink(visual.links.base, state.p1, state.p2, zBackClip);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.p2 : undefined, state.isValid ? state.aux : undefined, zOutput);
        updateLink(visual.links.effector, state.isValid ? state.aux : undefined, state.isValid ? state.j2 : undefined, zOutput);
      } else if (mechanism.type === '6bar') {
        updateLink(visual.links.base, state.p1, state.p2, zBackClip);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.p2 : undefined, state.isValid ? state.j2 : undefined, zOutput);
        updateLink(visual.links.effector, state.isValid ? state.j2 : undefined, state.isValid ? state.aux : undefined, zDyad);
        updateLink(visual.links.follower, state.isValid ? state.p2 : undefined, state.isValid ? state.aux : undefined, zFollower);
      } else if (mechanism.type === 'cam') {
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, undefined, undefined);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, undefined, undefined);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.camProfile, state.p1, zDriverGear, angle * (mechanism.speed1 ?? 1));
        updateObject(visual.extras.followerGuide, state.j2, zCoupler, groundAngle);
        updateObject(visual.extras.followerBlock, state.j2, zOutput, groundAngle);
      } else if (mechanism.type === 'rack-pinion') {
        const rackGuide = rackGuideCenter(mechanism, state);
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.rackGuide, rackGuide.center, zCoupler, rackGuide.trackAngle);
        updateObject(visual.extras.rack, state.j2, zOutputMoving, groundAngle);
        updateObject(visual.extras.endStopA, shifted(rackGuide.center, rackGuide.trackAngle, -mechanism.rockerLength / 2), zOutputMoving + 0.08, rackGuide.trackAngle);
        updateObject(visual.extras.endStopB, shifted(rackGuide.center, rackGuide.trackAngle, mechanism.rockerLength / 2), zOutputMoving + 0.08, rackGuide.trackAngle);
      } else if (mechanism.type === 'gear') {
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, state.j1, state.effector, zCoupler);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, state.j2, state.effector, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
      } else if (mechanism.type === 'planetary_gear') {
        const carrierAngle = angle * (mechanism.speed1 ?? 1) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength);
        const planetCenters = planetaryPlanetCenters(state.p1, mechanism, carrierAngle);
        updateLink(visual.links.base, undefined, undefined);
        updateLink(visual.links.driver, state.p1, planetCenters[0], zDriver);
        updateLink(visual.links.coupler, state.p1, planetCenters[1], zCoupler);
        updateLink(visual.links.output, state.p1, planetCenters[2], zOutput);
        updateLink(visual.links.effector, state.p2, state.effector, zOutputMoving);
        updateObject(visual.extras.ringGear, state.p1, zDriverGear, 0);
      } else {
        standardLinks();
      }
      visual.gears.forEach((gear, index) => {
        const gearCenters = mechanism.type === 'gear' ? gearTrainCenters(mechanism) : [];
        const planetaryCenters = mechanism.type === 'planetary_gear'
          ? [state.p1, ...planetaryPlanetCenters(state.p1, mechanism, angle * (mechanism.speed1 ?? 1) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength))]
          : [];
        const point = mechanism.type === 'gear' ? (gearCenters[index] ?? state.p2) : mechanism.type === 'planetary_gear' ? (planetaryCenters[index] ?? state.p2) : index === 0 ? state.p1 : state.p2;
        const gearZ = index === 0
          ? zDriverGear
          : mechanism.type === 'planetary_gear'
            ? zLayer(['Planet gears x3'], zOutputMoving)
            : mechanism.type === 'gear' && index < visual.gears.length - 1
              ? zLayer([`Idler gear ${index}`], zOutputMoving)
              : zLayer(['Output gear', 'Right timing gear', 'Planet gear', 'Sun gear'], zOutputMoving);
        const p = to3(point, gearZ);
        gear.position.set(p.x, p.y, p.z);
        gear.rotation.z = mechanismGearRotations(mechanism, angle)[index] ?? 0;
      });
      [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].forEach((point, index) => {
        const pin = visual.pins[index];
        if (!pin) return;
        if (!point) {
          pin.visible = false;
          return;
        }
        const p = to3(point, zPin);
        pin.visible = true;
        pin.position.copy(p);
      });
    });
    render();
  }, [angle, renderedMechanisms, rendererStatus]);

  useEffect(() => {
    const roots = rootsRef.current;
    if (!roots || rendererStatus !== 'webgl') return;
    roots.staticLayer.visible = visibleLayers.grid;
    roots.partsLayer.visible = visibleLayers.character;
    roots.skeletonLayer.visible = visibleLayers.skeleton;
    roots.mechanismsLayer.visible = visibleLayers.mechanisms;
    render();
  }, [rendererStatus, visibleLayers.grid, visibleLayers.character, visibleLayers.skeleton, visibleLayers.mechanisms]);

  useEffect(() => {
    const roots = rootsRef.current;
    const camera = cameraRef.current;
    if (!roots || !camera || rendererStatus !== 'webgl') return;
    const zoom = viewport?.zoom ?? 1;
    const preset = VIEWER3D_CAMERA_PRESETS[cameraPreset];
    const [px, py, pz] = cameraPreset === 'iso' ? orbitPosition(cameraOrbit.yaw, cameraOrbit.pitch) : preset.position;
    const [ux, uy, uz] = preset.up;
    const distance = preset.distance / zoom;
    camera.up.set(ux, uy, uz);
    camera.position.set(px * distance, py * distance, pz * distance);
    camera.lookAt(new THREE.Vector3(0, 0, 0.1));
    roots.root.position.set((viewport?.offset.x ?? 0) / VIEW_SCALE, (viewport?.offset.y ?? 0) / VIEW_SCALE, 0);
    render();
  }, [cameraOrbit.pitch, cameraOrbit.yaw, cameraPreset, rendererStatus, viewport?.offset.x, viewport?.offset.y, viewport?.zoom]);

  useEffect(() => {
    if (stateRef.current) stateRef.current.dataset.threeSceneObjectCount = String(estimatedObjectCount);
  }, [estimatedObjectCount]);

  const handleViewerWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!setViewport) return;
    event.stopPropagation();
    setViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)) }));
  };

  const handleViewerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const mode = cameraPreset === 'front' ? 'pan' : 'orbit';
    if (mode === 'pan' && !setViewport) return;
    viewerDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: cameraOrbit.yaw,
      pitch: cameraOrbit.pitch,
      offset: viewport?.offset ?? { x: 0, y: 0 },
      mode
    };
    setIsViewerDragging(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleViewerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = viewerDragRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.mode === 'orbit') {
      setCameraOrbit({ yaw: start.yaw + dx * 0.35, pitch: clampOrbitPitch(start.pitch - dy * 0.3) });
      return;
    }
    setViewport?.(prev => ({ ...prev, offset: { x: start.offset.x + dx, y: start.offset.y + dy } }));
  };

  const finishViewerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewerDragRef.current?.pointerId !== event.pointerId) return;
    viewerDragRef.current = null;
    setIsViewerDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const activeCamera = VIEWER3D_CAMERA_PRESETS[cameraPreset];
  const viewerContract = useMemo(() => createViewer3DContract(viewerTabFromTestId(testId), cameraPreset, {
    grid: visibleLayers.grid,
    character: visibleLayers.character,
    skeleton: visibleLayers.skeleton,
    mechanisms: visibleLayers.mechanisms,
    paths: 'external',
    forces: 'absent',
    velocity: 'absent'
  }, activeCamera.mode), [activeCamera.mode, cameraPreset, testId, visibleLayers.character, visibleLayers.grid, visibleLayers.mechanisms, visibleLayers.skeleton]);
  return <div
    className="three-puppet-overlay"
    data-testid={testId}
    aria-label="3D character view"
    data-camera-preset={cameraPreset}
    data-view-mode={activeCamera.mode}
    data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
    data-viewer-contract-state={JSON.stringify(viewerContract)}
    data-viewer-tab={viewerContract.tab}
    data-layer-grid={viewer3DLayerDataValue(visibleLayers.grid)}
    data-layer-character={viewer3DLayerDataValue(visibleLayers.character)}
    data-layer-skeleton={viewer3DLayerDataValue(visibleLayers.skeleton)}
    data-layer-mechanisms={viewer3DLayerDataValue(visibleLayers.mechanisms)}
    data-input-mode={inputMode}
    data-is-dragging={isViewerDragging ? 'true' : 'false'}
    data-camera-zoom={(viewport?.zoom ?? 1).toFixed(3)}
    data-camera-yaw={cameraOrbit.yaw.toFixed(3)}
    data-camera-pitch={cameraOrbit.pitch.toFixed(3)}
    data-camera-offset-x={(viewport?.offset.x ?? 0).toFixed(2)}
    data-camera-offset-y={(viewport?.offset.y ?? 0).toFixed(2)}
  >
    <div
      ref={hostRef}
      className="three-puppet-host"
      onWheel={handleViewerWheel}
      onPointerDown={handleViewerPointerDown}
      onPointerMove={handleViewerPointerMove}
      onPointerUp={finishViewerDrag}
      onPointerCancel={finishViewerDrag}
    />
    <div
      className="canvas-zoom-toolbar three-puppet-view-toolbar"
      data-testid={`${testId}-view-toolbar`}
      aria-label="Shared 3D viewer toolbar"
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      {PUPPET_CAMERA_PRESETS.map(preset => (
        <button
          key={preset}
          type="button"
          data-testid={`${testId}-view-${preset === 'front' ? '2d' : preset === 'iso' ? '3d' : preset}`}
          className={cameraPreset === preset ? 'active' : ''}
          aria-pressed={cameraPreset === preset}
          onClick={() => setCameraPreset(preset)}
        >{VIEWER3D_CAMERA_PRESETS[preset].label}</button>
      ))}
      <span className="viewer-toolbar-divider" aria-hidden="true" />
      {(['grid', 'character', 'skeleton', 'mechanisms'] as Array<keyof typeof DEFAULT_PUPPET_VIEWER_LAYERS>).map(layer => (
        <button
          key={layer}
          type="button"
          data-testid={`${testId}-toggle-${layer}`}
          className={visibleLayers[layer] ? 'active' : ''}
          aria-pressed={visibleLayers[layer]}
          aria-label={`Toggle ${layer} layer`}
          onClick={() => toggleLayer(layer)}
        >{layer === 'character' ? 'Body' : layer === 'skeleton' ? 'Rig' : layer === 'mechanisms' ? 'Mech' : layer}</button>
      ))}
    </div>
    <div
      ref={stateRef}
      data-testid={`${testId}-state`}
      className="three-puppet-state"
      data-camera-preset={cameraPreset}
      data-view-mode={activeCamera.mode}
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
      data-viewer-contract-state={JSON.stringify(viewerContract)}
      data-viewer-tab={viewerContract.tab}
      data-layer-grid={viewer3DLayerDataValue(visibleLayers.grid)}
      data-layer-character={viewer3DLayerDataValue(visibleLayers.character)}
      data-layer-skeleton={viewer3DLayerDataValue(visibleLayers.skeleton)}
      data-layer-mechanisms={viewer3DLayerDataValue(visibleLayers.mechanisms)}
      data-input-mode={inputMode}
      data-camera-zoom={(viewport?.zoom ?? 1).toFixed(3)}
      data-camera-yaw={cameraOrbit.yaw.toFixed(3)}
      data-camera-pitch={cameraOrbit.pitch.toFixed(3)}
      data-camera-offset-x={(viewport?.offset.x ?? 0).toFixed(2)}
      data-camera-offset-y={(viewport?.offset.y ?? 0).toFixed(2)}
      data-layer-paths={viewer3DLayerDataValue(undefined, 'external')}
      data-layer-forces={viewer3DLayerDataValue(undefined)}
      data-layer-velocity={viewer3DLayerDataValue(undefined)}
      data-three-renderer={rendererStatus === 'pending' ? 'webgl' : rendererStatus}
      data-three-engine-stack={PHYSICS_RENDER_STACK}
      data-physics-kernel={PHYSICS_KERNEL_ENGINE}
      data-physics-update-policy={PHYSICS_UPDATE_POLICY}
      data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
      data-physics-contact-mode="rapier-friction-contact-kernel"
      data-physics-kernel-runtime={physicsKernelRuntime}
      data-physics-kernel-version={physicsKernelVersion}
      data-physics-kernel-error={physicsKernelError}
      data-physics-authority="motionsmith-kinematics"
      data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
      data-puppet-mode="thick-flat-assembly"
      data-part-outline-mode="model-or-user-contour-with-fabrication-fallback"
      data-joint-placement="skeleton-anchors"
      data-three-rebuild-mode="static-topology-dynamic-transforms"
      data-three-supported-mechanism-types={SUPPORTED_MECHANISM_TYPES.join(',')}
      data-three-selected-mechanism-type={selectedTelemetry?.type ?? ''}
      data-three-stack-source={selectedRenderPlan ? 'fabricationStackForMechanism' : ''}
      data-three-stack-mode="assembled-spacer-separated"
      data-three-part-surface="solid-cut-plates"
      data-three-part-art="top-texture-decal"
      data-three-part-art-count={partArtCount}
      data-three-part-texture-count={partTextureCount}
      data-three-part-opacity="1"
      data-three-part-edge-opacity="0.95"
      data-three-assembly-underlay="plate-art-decal"
      data-three-exploded="false"
      data-three-base-layer={selectedRenderPlan?.base.label ?? ''}
      data-three-stack-order={selectedRenderPlan?.stackSummary ?? ''}
      data-three-stack-roles={selectedRenderPlan?.roleSummary ?? ''}
      data-three-stack-colors={selectedRenderPlan?.colorSummary ?? ''}
      data-three-stack-z={selectedRenderPlan?.zSummary ?? ''}
      data-three-spacer-z-gap={selectedStackZGap.toFixed(2)}
      data-three-linkage-hole-counts={selectedLinkageHoleCounts ? Object.entries(selectedLinkageHoleCounts).map(([role, count]) => `${role}:${count}`).join(',') : ''}
      data-three-linkage-template-cells={selectedLinkageSpecs ? Object.entries(selectedLinkageSpecs).map(([role, spec]) => `${role}:${spec.cells}`).join(',') : ''}
      data-three-linkage-hole-spacing-mm={selectedLinkageSpecs ? Object.entries(selectedLinkageSpecs).map(([role, spec]) => `${role}:${spec.pitchMm.toFixed(2)}`).join(',') : ''}
      data-three-carrier-linkage-hole-count={selectedLinkageHoleCounts?.driver ?? 0}
      data-three-stack-layer-count={selectedRenderPlan?.layers.length ?? 0}
      data-three-rendered-layer-labels={selectedRenderPlan?.layers.map(item => item.label).join(' → ') ?? ''}
      data-three-rendered-layer-roles={selectedRenderPlan?.layers.map(item => item.renderKind).join('>') ?? ''}
      data-three-rendered-layer-colors={selectedRenderPlan?.layers.map(item => item.color).join(',') ?? ''}
      data-three-rendered-layer-z={selectedRenderPlan?.layers.map(item => item.z.toFixed(2)).join(',') ?? ''}
      data-three-stack-validation-errors={stackValidationErrors}
      data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
      data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
      data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
      data-three-primary-rotation-deg={fixed3(selectedTelemetry?.primaryRotationDeg)}
      data-three-secondary-rotation-deg={fixed3(selectedTelemetry?.secondaryRotationDeg)}
      data-three-gear-radii={selectedMechanism ? (selectedMechanism.type === 'gear' ? gearTrainPitchRadii(selectedMechanism).map(radius => radius.toFixed(2)).join(',') : selectedMechanism.type === 'planetary_gear' ? planetaryGearRadii(selectedMechanism).map(radius => radius.toFixed(2)).join(',') : `${selectedMechanism.crankLength.toFixed(2)},${selectedMechanism.rockerLength.toFixed(2)}`) : ''}
      data-three-gear-output-ratio={selectedMechanism ? (selectedMechanism.type === 'gear' ? gearTrainOutputRatio(selectedMechanism) : selectedMechanism.type === 'planetary_gear' ? planetaryCarrierOutputRatio(selectedMechanism.crankLength, selectedMechanism.rockerLength) : gearPairOutputRatio(selectedMechanism.crankLength, selectedMechanism.rockerLength)).toFixed(3) : ''}
      data-three-secondary-speed={selectedMechanism ? (selectedMechanism.speed2 ?? selectedMechanism.gearRatio ?? 1).toFixed(3) : ''}
      data-three-planetary-syntax={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).syntax : ''}
      data-three-planetary-fixed={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).fixedMember : ''}
      data-three-planetary-input={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).inputMember : ''}
      data-three-planetary-output={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).outputMember : ''}
      data-three-planetary-ring-radius={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).ringPitchRadius.toFixed(2) : ''}
      data-three-planetary-carrier-radius={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).carrierPitchRadius.toFixed(2) : ''}
      data-three-rack-x={fixed3(selectedTelemetry?.rackX)}
      data-three-rack-y={fixed3(selectedTelemetry?.rackY)}
      data-three-rack-guide-x={fixed3(selectedTelemetry?.rackGuideX)}
      data-three-rack-guide-y={fixed3(selectedTelemetry?.rackGuideY)}
      data-three-end-stop-a-x={fixed3(selectedTelemetry?.endStopAX)}
      data-three-end-stop-a-y={fixed3(selectedTelemetry?.endStopAY)}
      data-three-end-stop-b-x={fixed3(selectedTelemetry?.endStopBX)}
      data-three-end-stop-b-y={fixed3(selectedTelemetry?.endStopBY)}
      data-three-part-count={parts.length}
      data-three-joint-count={joints.length}
      data-three-bone-count={bones.length}
      data-three-part-hole-count={holeCount}
      data-three-mechanism-count={mechanismsToRender.length}
      data-three-mechanism-link-count={mechanismLinkCount}
      data-three-mechanism-hole-count={mechanismInventory.holes}
      data-three-slot-count={mechanismInventory.slots}
      data-three-gear-count={mechanismInventory.gears}
      data-three-rack-count={mechanismInventory.racks}
      data-three-cam-count={mechanismInventory.cams}
      data-three-follower-count={mechanismInventory.followers}
      data-three-end-stop-count={mechanismInventory.endStops}
      data-three-physical-template-count={mechanismsToRender.length}
      data-three-object-count={estimatedObjectCount}
      data-three-scene-object-count={estimatedObjectCount}
      data-three-scene-visible-object-count={0}
      data-three-render-triangles={0}
      data-thickness-mm={Math.round(THICKNESS * VIEW_SCALE)}
    />
  </div>;
};

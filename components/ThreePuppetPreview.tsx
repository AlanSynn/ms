import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BodyPartLayer, CanvasViewport, MechanismConfig, MechanismType, PhysicalKitSettings, Point, ProjectMotionPath, ProjectState, SceneObject, StandardSkeleton } from '../types';
import { boardGridLines, defaultPhysicalKit, SCENE_PX_PER_MM, sceneBoundsForSheet } from '../utils/coordinates';
import { calculateLinkage, normalizeCamProfileSamples, sampledCamProfileScale, gearPairOutputRatio, gearTrainCenters, gearTrainMeshPhaseRadAt, gearTrainOutputRatio, gearTrainPitchRadii, gearTrainRotationRatioAt, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from '../utils/kinematics';
import { FABRICATION_HOLE_RADIUS_MM, FABRICATION_LINKAGE_ROLE_MIN_HOLES, FABRICATION_LINKAGE_SPECS, FABRICATION_LINKAGE_WIDTH_MM, FABRICATION_SPACER_SPEC, fabricationGearProfileForPitchRadius, fabricationLinkageHoleCountsForMechanism, fabricationLinkageSceneLengthsForMechanism, fabricationLinkageSpecForSceneLength, fabricationRingGearProfileForPitchRadius, fabricationRingInnerGearOutlinePoints, planetaryGearConventionForMechanism, planetaryGearRadii, planetaryPlanetCenters, planetaryRingPitchRadius, projectFabricationZMm, validateMechanismPreviewReadiness, type FabricationLinkageRoleLengths, type FabricationRenderPlan } from '../utils/fabrication';
import { buildProjectMechanismSceneContract, type MechanismSceneContract } from '../utils/mechanismSceneContract';
import { mechanismInventoryForMechanism, zeroMechanismInventory, type MechanismInventory } from '../utils/mechanismInventory';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, pointInsideOutline } from '../utils/partGeometry';
import { clampCanvasZoom, WEBGL_PIXEL_RATIO_CAP } from '../utils/viewport';
import { HIGH_THROUGHPUT_SCENE_POLICY, PHYSICS_KERNEL_ENGINE, PHYSICS_RENDER_STACK, PHYSICS_UPDATE_POLICY, loadRapierPhysicsKernel, physicsKernelErrorMessage } from '../utils/physicsKernel';
import { DEFAULT_PUPPET_VIEWER_LAYERS, VIEWER3D_CAMERA_PRESETS, VIEWER3D_CONTRACT_VERSION, createViewer3DContract, viewer3DLayerDataValue, type Viewer3DCameraPreset, type Viewer3DTabKey } from '../utils/viewer3d';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import { cachedThreeResource, clearThreeGroup, disposeMarkedThreeMaterials, disposeThreeObjectGraph, setRendererPixelRatioCap } from '../utils/threeResourceKit';
import { resolveFourBarConnectionSelections, resolveFourBarLinkageBlankPoses } from '../utils/mechanismConnectionSelections';
import { foundryPinStackPoints, foundryPinStacks } from '../utils/mechanismPreviewStacks';

const VIEW_SCALE = 35;
const FABRICATION_LINKAGE_WIDTH_3D = Math.max(0.16, (FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM) / VIEW_SCALE);
const FABRICATION_HOLE_RADIUS_3D = Math.max(0.04, (FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM) / VIEW_SCALE);
const THICKNESS = 0.22;
const SUPPORTED_MECHANISM_TYPES: MechanismType[] = [...ALL_MECHANISM_TYPES];
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
  path: THREE.LineBasicMaterial;
  pathSelected: THREE.LineBasicMaterial;
  pathPoint: THREE.MeshBasicMaterial;
  objectDetail: THREE.MeshBasicMaterial;
};

type SceneRoots = {
  root: THREE.Group;
  staticLayer: THREE.Group;
  partsLayer: THREE.Group;
  objectsLayer: THREE.Group;
  skeletonLayer: THREE.Group;
  pathsLayer: THREE.Group;
  mechanismsLayer: THREE.Group;
};

type PuppetAssemblyOverlay = {
  phase: 'character-parts' | 'fixed-pins' | 'free-pivots' | 'attach-character' | 'test-character';
  progress?: number;
  activePartIds?: string[];
  activeJointIds?: string[];
};

type JointVisual = { pin: THREE.Mesh; washer: THREE.Mesh };
type MechanismVisual = {
  links: Record<LinkKey, THREE.Group>;
  gears: THREE.Mesh[];
  pins: THREE.Mesh[];
  extras: Record<string, THREE.Object3D>;
};

type ViewerPickKind = 'object' | 'part' | 'mechanism';
type ViewerScreenTarget = {
  kind: ViewerPickKind;
  id: string;
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  visible: boolean;
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

const cachedGeometry = <T extends THREE.BufferGeometry>(key: string, factory: () => T): T =>
  cachedThreeResource(sharedGeometryCache, key, factory, 'sharedFabricationGeometry');

const geometryKeyNumber = (value: number) => Number.isFinite(value) ? value.toFixed(3) : 'nan';

const attachCachedEdges = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry, edgeMaterial: THREE.Material, key: string) => {
  const edgeGeometry = cachedGeometry(`edges:${key}`, () => new THREE.EdgesGeometry(geometry));
  mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
};

const disposeObject = (object: THREE.Object3D, disposeMaterials = false) =>
  disposeThreeObjectGraph(object, {
    disposeMaterials,
    keepGeometry: geometry => Boolean(geometry.userData?.sharedFabricationGeometry)
  });

const disposeOwnedMaterials = (object: THREE.Object3D) =>
  disposeMarkedThreeMaterials(
    object,
    material => Boolean(material.userData?.ownedByPartArt || material.userData?.ownedBySceneObject),
    material => (material as THREE.MeshBasicMaterial).map?.dispose()
  );

const clearGroup = (group: THREE.Group) =>
  clearThreeGroup(group, child => {
    disposeOwnedMaterials(child);
    disposeObject(child, false);
  });

const createPartArtMaterial = (part: BodyPartLayer, onLoaded: () => void, textureUrl = part.textureUrl) => {
  const material = new THREE.MeshBasicMaterial({
    color: textureUrl ? '#ffffff' : part.fillColor,
    transparent: true,
    opacity: textureUrl ? Math.max(0.35, Math.min(1, part.opacity ?? 1)) : 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  material.userData.ownedByPartArt = true;
  if (textureUrl) {
    const texture = new THREE.TextureLoader().load(textureUrl, () => onLoaded());
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

const zeroInventory = zeroMechanismInventory;

const assemblyExplodeAmountForPhase = (phase?: PuppetAssemblyOverlay['phase'], progress = 0) => {
  if (!phase || phase === 'test-character') return 0;
  if (phase === 'attach-character') return Math.max(0, Math.min(1, 1 - progress));
  if (phase === 'free-pivots') return 0.5;
  if (phase === 'fixed-pins') return 0.68;
  return 1;
};

const assemblyOffsetForPart = (index: number, count: number, amount: number) => {
  if (amount <= 0) return { x: 0, y: 0, z: 0 };
  return {
    x: 0,
    y: 0,
    z: (0.26 + index * 0.055) * amount
  };
};

const puppetMechanismInventory = (mechanism: MechanismConfig, kit: PhysicalKitSettings): MechanismInventory =>
  mechanismInventoryForMechanism(mechanism, kit);

const addInventory = (sum: MechanismInventory, item: MechanismInventory): MechanismInventory => ({
  parts: sum.parts + item.parts,
  holes: sum.holes + item.holes,
  slots: sum.slots + item.slots,
  gears: sum.gears + item.gears,
  racks: sum.racks + item.racks,
  cams: sum.cams + item.cams,
  followers: sum.followers + item.followers,
  endStops: sum.endStops + item.endStops,
  compilerBlockers: sum.compilerBlockers + item.compilerBlockers
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
  mechBase: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.62, metalness: 0.03 }),
  mechDrive: new THREE.MeshStandardMaterial({ color: '#60a5fa', roughness: 0.48, metalness: 0.05, transparent: true, opacity: 0.82 }),
  mechCoupler: new THREE.MeshStandardMaterial({ color: '#60a5fa', roughness: 0.68, metalness: 0.02, transparent: true, opacity: 0.82 }),
  mechOutput: new THREE.MeshStandardMaterial({ color: '#60a5fa', roughness: 0.62, metalness: 0.03, transparent: true, opacity: 0.82 }),
  mechPin: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.45, metalness: 0.08 }),
  path: new THREE.LineBasicMaterial({ color: '#8b5cf6', transparent: true, opacity: 0.65, depthTest: false }),
  pathSelected: new THREE.LineBasicMaterial({ color: '#7c3aed', transparent: true, opacity: 0.95, depthTest: false }),
  pathPoint: new THREE.MeshBasicMaterial({ color: '#8b5cf6', transparent: true, opacity: 0.95, depthTest: false }),
  objectDetail: new THREE.MeshBasicMaterial({ color: '#334155', transparent: true, opacity: 0.82, depthTest: false })
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

const sceneObjectShape = (object: SceneObject) => {
  if (object.contourPoints && object.contourPoints.length >= 3) return shapeFromLocalOutline(object.contourPoints);
  const width = Math.max(8, object.bounds.width) / VIEW_SCALE;
  const height = Math.max(8, object.bounds.height) / VIEW_SCALE;
  if (object.shape === 'star') {
    const shape = new THREE.Shape();
    const outer = Math.min(width, height) / 2;
    const inner = outer * 0.46;
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }
  return roundedRect(width, height, object.shape === 'cloud' ? Math.min(width, height) * 0.34 : Math.min(width, height) * 0.2);
};

const createSceneObjectMaterial = (object: SceneObject, selected: boolean) => {
  const material = new THREE.MeshStandardMaterial({
    color: selected ? '#f0abfc' : object.fillColor,
    roughness: 0.58,
    metalness: 0.02,
    transparent: true,
    opacity: Math.max(0, Math.min(1, object.opacity))
  });
  material.userData.ownedBySceneObject = true;
  return material;
};

const createSceneObjectArtMaterial = (object: SceneObject, onLoaded: () => void) => {
  const material = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: Math.max(0, Math.min(1, object.opacity)),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });
  material.userData.ownedBySceneObject = true;
  if (object.textureUrl) {
    const texture = new THREE.TextureLoader().load(object.textureUrl, () => onLoaded());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    material.needsUpdate = true;
  }
  return material;
};

const createSceneObjectVisual = (object: SceneObject, materials: MaterialKit, selected: boolean, onLoaded: () => void) => {
  const group = new THREE.Group();
  const shape = sceneObjectShape(object);
  const fill = createSceneObjectMaterial(object, selected);
  const contourKey = object.contourPoints?.map(point => `${geometryKeyNumber(point.x)}:${geometryKeyNumber(point.y)}`).join(';') ?? '';
  const key = `scene-object:${object.shape}:${geometryKeyNumber(object.bounds.width)}:${geometryKeyNumber(object.bounds.height)}:${contourKey}`;
  group.add(createExtrudedMesh(shape, fill, materials.edge, 0.12, key));
  group.userData.sceneObjectId = object.id;
  group.traverse(child => {
    child.userData.sceneObjectId = object.id;
  });
  if (object.textureUrl) {
    const artGeometry = new THREE.ShapeGeometry(shape);
    const positions = artGeometry.getAttribute('position');
    const uvs: number[] = [];
    const width = Math.max(1, object.bounds.width);
    const height = Math.max(1, object.bounds.height);
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i) * VIEW_SCALE;
      const y = positions.getY(i) * VIEW_SCALE;
      uvs.push(x / width + 0.5, y / height + 0.5);
    }
    artGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const art = new THREE.Mesh(artGeometry, createSceneObjectArtMaterial(object, onLoaded));
    art.name = `scene-object-art-${object.id}`;
    art.position.set(0, 0, 0.15);
    art.userData.sceneObjectId = object.id;
    group.add(art);
  }
  if (object.shape === 'piggy-bank') {
    const slot = new THREE.Mesh(
      cachedGeometry('scene-object-piggy-slot:0.36:0.035', () => new THREE.PlaneGeometry(0.36, 0.035)),
      materials.objectDetail
    );
    slot.position.set(0, 0.22, 0.09);
    group.add(slot);
    const snout = new THREE.Mesh(
      cachedGeometry('scene-object-piggy-snout:0.11:18', () => new THREE.CircleGeometry(0.11, 18)),
      materials.objectDetail
    );
    snout.position.set(Math.max(0.18, object.bounds.width / VIEW_SCALE / 2 - 0.18), 0.03, 0.09);
    group.add(snout);
  }
  group.name = `scene-object-${object.id}`;
  group.renderOrder = 30 + object.zIndex;
  return group;
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

const createHoledLink = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material, holeCount = 2, partKey?: string) => {
  const group = new THREE.Group();
  const safeLength = Math.max(0.08, length);
  const sceneLength = safeLength * VIEW_SCALE;
  const spec = FABRICATION_LINKAGE_SPECS.find(candidate => candidate.key === partKey)
    ?? fabricationLinkageSpecForSceneLength(sceneLength, FABRICATION_LINKAGE_SPECS[0]?.pitchMm, holeCount);
  const templateLength = Math.max(0.08, (spec.lengthMm * SCENE_PX_PER_MM) / VIEW_SCALE);
  const outlineLength = templateLength + width;
  const firstHoleX = spec.holeCentersMm[0]?.x ?? 0;
  const holeXs = spec.holeCentersMm.map(point => ((point.x - firstHoleX) - spec.lengthMm / 2) * SCENE_PX_PER_MM / VIEW_SCALE);
  group.userData.baseLength = templateLength;
  group.userData.fabricationLocked = true;
  group.userData.fabricationSpecKey = spec.key;
  group.userData.fabricationHoleSpacingMm = spec.pitchMm;
  const key = `holed-link:${spec.key}:${geometryKeyNumber(spec.pitchMm)}:${geometryKeyNumber(outlineLength)}:${geometryKeyNumber(width)}:${geometryKeyNumber(FABRICATION_HOLE_RADIUS_3D)}`;
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

const createCamProfile = (radius: number, samples: number[] | undefined, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const shape = new THREE.Shape();
  for (let i = 0; i < 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    const r = Math.max(0.3, radius) * sampledCamProfileScale(a, samples);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  shape.holes.push(holePath(0, 0, Math.max(0.08, radius * 0.15)));
  const group = new THREE.Group();
  group.add(createExtrudedMesh(shape, material, edgeMaterial, 0.2, `cam:${geometryKeyNumber(radius)}:${(samples ?? []).join(',')}`));
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

const updateLink = (group: THREE.Object3D, a?: Point, b?: Point, z = 0, physicalDepth = 0.11) => {
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
  group.scale.z = physicalDepth / 0.11;
};

const updateObject = (object: THREE.Object3D | undefined, center?: Point, z = 0, rotation = 0, physicalDepth?: number, sourceDepth = 1) => {
  if (!object || !center) return;
  const p = to3(center, z);
  object.visible = true;
  object.position.set(p.x, p.y, p.z);
  object.rotation.z = rotation;
  if (typeof physicalDepth === 'number') object.scale.z = physicalDepth / sourceDepth;
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
  if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage') {
    const radii = gearTrainPitchRadii(mechanism);
    if (mechanism.type === 'gear_linkage' && radii.length <= 2) {
      const outputRatio = Number.isFinite(mechanism.speed2)
        ? (mechanism.speed2 ?? 1)
        : Number.isFinite(mechanism.gearRatio)
          ? (mechanism.gearRatio ?? 1)
          : gearTrainOutputRatio(radii);
      return [input, input * outputRatio + phase];
    }
    return radii.map((_, index) => input * gearTrainRotationRatioAt(radii, index) + gearTrainMeshPhaseRadAt(radii, index) + (index === radii.length - 1 ? phase : 0));
  }
  if (mechanism.type === 'planetary_gear') return [
    input,
    input * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) + phase
  ];
  return [input];
};

const mechanismTelemetry = (
  mechanism: MechanismConfig,
  angle: number,
  kit: PhysicalKitSettings,
) => {
  const state = calculateLinkage(mechanism, angle, kit);
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

const gearMeshPlaneZForPlan = (renderPlan: FabricationRenderPlan) =>
  renderPlan.layers.find(layer => layer.gearPlaneId)?.z;

const gearPlaneModeForMechanism = (mechanism: MechanismConfig | undefined, renderPlan: FabricationRenderPlan | null) => {
  const gearPlaneZ = renderPlan ? gearMeshPlaneZForPlan(renderPlan) : undefined;
  if (!mechanism) return 'not-gear-train';
  if (typeof gearPlaneZ !== 'number') {
    return mechanism.type === 'gear' || mechanism.type === 'gear_linkage'
      ? 'independent-gear-planes'
      : 'not-gear-train';
  }
  if (mechanism.type === 'planetary_gear') return 'planetary-coplanar-ring-sun-planet';
  if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage') return 'coplanar-fixed-axles';
  return 'not-gear-train';
};

const mechanismGeometrySignature = (
  mechanisms: MechanismConfig[],
  contracts: Map<string, MechanismSceneContract>,
) => mechanisms.map(mechanism => [
  mechanism.id,
  mechanism.type,
  contracts.get(mechanism.id)?.compilerSignature ?? '',
  mechanism.crankLength,
  mechanism.groundLength,
  mechanism.couplerLength,
  mechanism.rockerLength,
  mechanism.rodLength,
  mechanism.couplerPointDist,
  mechanism.camProfileSamples?.join(',') ?? '',
  mechanism.outputGearRadius,
  mechanism.gearTrainRadii?.join(',') ?? '',
  mechanism.showOutputGear,
].join(':')).join('|');

export const ThreePuppetPreview = ({ project, animatedParts = {}, animatedSceneObjects = {}, skeleton, mechanisms, paths, selectedPathId, angle = 0, viewport, setViewport, inputMode = 'always', testId = 'three-puppet', cameraPresets = PUPPET_CAMERA_PRESETS, showToolbar = true, initialLayers, assemblyOverlay, onSelectPart, onSelectSceneObject, onSelectMechanism, onSelectOnlyPointerDown, onSelectOnlyPointerMove, onSelectOnlyPointerUp, onSelectOnlyPointerCancel, onSelectOnlyWheel }: {
  project?: ProjectState;
  animatedParts?: Record<string, BodyPartLayer>;
  animatedSceneObjects?: Record<string, SceneObject>;
  skeleton?: StandardSkeleton | null;
  mechanisms?: MechanismConfig[];
  paths?: ProjectMotionPath[];
  selectedPathId?: string;
  angle?: number;
  viewport?: CanvasViewport;
  setViewport?: React.Dispatch<React.SetStateAction<CanvasViewport>>;
  inputMode?: 'always' | '3d-only' | 'select-only' | 'none';
  testId?: string;
  cameraPresets?: Viewer3DCameraPreset[];
  showToolbar?: boolean;
  initialLayers?: Partial<typeof DEFAULT_PUPPET_VIEWER_LAYERS>;
  assemblyOverlay?: PuppetAssemblyOverlay;
  onSelectPart?: (partId: string) => void;
  onSelectSceneObject?: (objectId: string) => void;
  onSelectMechanism?: (mechanismId: string) => void;
  onSelectOnlyPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onSelectOnlyPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onSelectOnlyPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onSelectOnlyPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  onSelectOnlyWheel?: React.WheelEventHandler<HTMLDivElement>;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rootsRef = useRef<SceneRoots | null>(null);
  const materialsRef = useRef<MaterialKit | null>(null);
  const partMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const sceneObjectRefs = useRef<Map<string, THREE.Group>>(new Map());
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
  const viewerDragRef = useRef<{ pointerId: number; button: number; x: number; y: number; yaw: number; pitch: number; offset: Point; mode: 'orbit' | 'pan' | 'select' } | null>(null);
  const [visibleLayers, setVisibleLayers] = useState(() => ({ ...DEFAULT_PUPPET_VIEWER_LAYERS, ...(initialLayers ?? {}) }));
  useEffect(() => {
    if (!initialLayers) return;
    setVisibleLayers(prev => ({ ...prev, ...initialLayers }));
  }, [initialLayers?.grid, initialLayers?.character, initialLayers?.skeleton, initialLayers?.mechanisms]);
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
  const fallbackKit = useMemo(() => defaultPhysicalKit(), []);
  const kit = project?.settings.physicalKit ?? fallbackKit;
  const parts = useMemo(() => (project?.partOrder ?? [])
    .map(id => animatedParts[id] ?? project?.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part?.visible)), [animatedParts, project]);
  const topologyParts = useMemo(() => (project?.partOrder ?? [])
    .map(id => project?.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part?.visible)), [project?.partOrder, project?.parts]);
  const geometryParts = topologyParts.length ? topologyParts : parts;
  const sceneObjects = useMemo(() => (project?.sceneObjectOrder ?? [])
    .map(id => animatedSceneObjects[id] ?? project?.sceneObjects[id])
    .filter((object): object is SceneObject => Boolean(object?.visible)), [animatedSceneObjects, project?.sceneObjectOrder, project?.sceneObjects]);
  const joints = useMemo(() => Object.values(activeSkeleton?.joints ?? {}), [activeSkeleton]);
  const bones = useMemo(() => activeSkeleton?.bones ?? [], [activeSkeleton]);
  const mechanismCandidates = mechanisms ?? project?.mechanisms ?? [];
  const mechanismContracts = useMemo(() => new Map(
    project
      ? mechanismCandidates.flatMap(mechanism => {
          const contract = buildProjectMechanismSceneContract(project, mechanism.id, undefined, 0);
          return contract ? [[mechanism.id, contract] as const] : [];
        })
      : [],
  ), [mechanismCandidates, project]);
  const mechanismsToRender = useMemo(
    () => mechanismCandidates.filter(mechanism => mechanismContracts.has(mechanism.id)),
    [mechanismCandidates, mechanismContracts],
  );
  const pathsToRender = useMemo(() => (paths ?? [])
    .filter(path => path.visible !== false && path.enabled !== false && path.points.length > 1), [paths]);
  const assemblyPhase = assemblyOverlay?.phase;
  const assemblyProgress = Math.max(0, Math.min(1, assemblyOverlay?.progress ?? 0));
  const assemblyExplodeAmount = assemblyExplodeAmountForPhase(assemblyPhase, assemblyProgress);
  const selectedMechanism = useMemo(
    () => mechanismsToRender.find(mechanism => mechanism.id === project?.selectedMechanismId) ?? mechanismsToRender[0],
    [mechanismsToRender, project?.selectedMechanismId]
  );
  const renderedMechanisms = mechanismsToRender;
  const mechanismRenderPlans = useMemo(
    () => new Map(renderedMechanisms.flatMap(mechanism => {
      const contract = mechanismContracts.get(mechanism.id);
      return contract ? [[mechanism.id, contract.renderPlan] as const] : [];
    })),
    [mechanismContracts, renderedMechanisms]
  );
  const selectedTelemetry = useMemo(() => selectedMechanism
      ? mechanismTelemetry(
        selectedMechanism,
        mechanismContracts.get(selectedMechanism.id)?.projectDriveEnabled ? angle : 0,
        kit,
      )
    : null, [angle, kit, mechanismContracts, selectedMechanism]);
  const selectedRenderPlan = useMemo(
    () => selectedMechanism ? mechanismRenderPlans.get(selectedMechanism.id) ?? null : null,
    [mechanismRenderPlans, selectedMechanism]
  );
  const selectedCamProfile = useMemo(() => selectedMechanism?.type === 'cam'
    ? normalizeCamProfileSamples(selectedMechanism.camProfileSamples).map(value => value.toFixed(2)).join(',')
    : '', [selectedMechanism]);
  const selectedGearPlaneZ = useMemo(() => {
    if (!selectedRenderPlan) return undefined;
    return gearMeshPlaneZForPlan(selectedRenderPlan);
  }, [selectedRenderPlan]);
  const selectedRenderedLayerZ = useMemo(() => {
    if (!selectedRenderPlan) return [];
    return selectedRenderPlan.layers.map(layer => layer.z);
  }, [selectedRenderPlan]);
  const selectedGearPlaneMode = useMemo(
    () => gearPlaneModeForMechanism(selectedMechanism, selectedRenderPlan),
    [selectedMechanism, selectedRenderPlan]
  );
  const selectedGearOutputRatio = useMemo(() => {
    if (!selectedMechanism) return 0;
    if (selectedMechanism.type === 'gear' || selectedMechanism.type === 'gear_linkage') {
      const radii = gearTrainPitchRadii(selectedMechanism);
      if (selectedMechanism.type === 'gear_linkage' && radii.length <= 2) {
        return Number.isFinite(selectedMechanism.speed2)
          ? (selectedMechanism.speed2 ?? 1)
          : Number.isFinite(selectedMechanism.gearRatio)
            ? (selectedMechanism.gearRatio ?? 1)
            : gearTrainOutputRatio(selectedMechanism);
      }
      return gearTrainOutputRatio(selectedMechanism);
    }
    return selectedMechanism.type === 'planetary_gear'
      ? planetaryCarrierOutputRatio(selectedMechanism.crankLength, selectedMechanism.rockerLength)
      : gearPairOutputRatio(selectedMechanism.crankLength, selectedMechanism.rockerLength);
  }, [selectedMechanism]);
  const selectedLinkageHoleCounts = useMemo(() => selectedMechanism ? fabricationLinkageHoleCountsForMechanism(selectedMechanism) : null, [selectedMechanism]);
  const selectedLinkageSpecs = useMemo(() => {
    if (!selectedMechanism) return null;
    const fourBarConnections = resolveFourBarConnectionSelections(selectedMechanism);
    const lengths = fabricationLinkageSceneLengthsForMechanism(selectedMechanism);
    return Object.fromEntries(Object.entries(lengths).map(([role, length]) => {
      const typedRole = role as keyof FabricationLinkageRoleLengths;
      const selectedPartKey = typedRole === 'driver' && fourBarConnections.inputJoint?.selection.kind === 'linkage-hole'
        ? fourBarConnections.inputJoint.selection.linkageKey
        : typedRole === 'output' && fourBarConnections.outputJoint?.selection.kind === 'linkage-hole'
          ? fourBarConnections.outputJoint.selection.linkageKey
          : undefined;
      return [role, FABRICATION_LINKAGE_SPECS.find(spec => spec.key === selectedPartKey)
        ?? fabricationLinkageSpecForSceneLength(length, FABRICATION_LINKAGE_SPECS[0]?.pitchMm, FABRICATION_LINKAGE_ROLE_MIN_HOLES[typedRole])];
    })) as Record<keyof FabricationLinkageRoleLengths, ReturnType<typeof fabricationLinkageSpecForSceneLength>>;
  }, [selectedMechanism]);
  const selectedStackZGap = useMemo(() => {
    if (!selectedRenderPlan || selectedRenderPlan.layers.length < 2) return 0;
    return selectedRenderPlan.layers[1].z - selectedRenderPlan.layers[0].z;
  }, [selectedRenderPlan]);
  const stackValidationErrors = useMemo(
    () => [...mechanismRenderPlans.values()].reduce((sum, plan) => sum + plan.validationErrors.length, 0),
    [mechanismRenderPlans]
  );
  const physicalValidationErrors = useMemo(
    () => mechanismsToRender.reduce((sum, mechanism) => sum + validateMechanismPreviewReadiness(mechanism, kit).length, 0),
    [kit, mechanismsToRender]
  );
  const mechanismInventory = useMemo(
    () => mechanismsToRender.reduce((sum, mechanism) => addInventory(sum, puppetMechanismInventory(mechanism, kit)), zeroInventory()),
    [kit, mechanismsToRender]
  );
  const mechanismLinkCount = mechanismInventory.parts;
  const holeCount = useMemo(() => geometryParts.reduce((sum, part) => {
    const base = project?.parts[part.id] ?? part;
    const landmarks = partLandmarkLocalPoints(base, canonicalSkeleton);
    const outline = fabricablePartOutlinePoints(base, landmarks);
    return sum + landmarks.filter(local => pointInsideOutline(local, outline, 0.5)).length;
  }, 0), [canonicalSkeleton, geometryParts, project?.parts]);
  const partTextureCount = geometryParts.reduce((sum, part) => {
    const base = project?.parts[part.id] ?? part;
    return sum + (base.textureUrl || (base.sourceImageFrame && project?.characterPackage?.sourceTextureUrl) ? 1 : 0);
  }, 0);
  const partArtCount = geometryParts.length;
  const estimatedObjectCount = boardGridLines(kit).length + 1 + geometryParts.length * 4 + sceneObjects.length * 4 + holeCount + joints.length * 2 + bones.length + pathsToRender.length * 3 + pathsToRender.reduce((sum, path) => sum + path.points.length, 0) + mechanismLinkCount * 2 + mechanismsToRender.length * 8 + mechanismInventory.holes + mechanismInventory.gears * 2;

  const collectViewerScreenTargets = () => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const roots = rootsRef.current;
    if (!renderer || !camera || !roots) return [] as ViewerScreenTarget[];
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [] as ViewerScreenTarget[];
    roots.root.updateMatrixWorld(true);

    const projectWorld = (point: THREE.Vector3) => {
      const projected = point.clone().project(camera);
      return {
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - projected.y) / 2) * rect.height,
        z: projected.z
      };
    };

    const targetForObject = (kind: ViewerPickKind, id: string, object: THREE.Object3D): ViewerScreenTarget | null => {
      if (!object.visible) return null;
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      const center = new THREE.Vector3();
      const worldPoints: THREE.Vector3[] = [];
      if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
        object.getWorldPosition(center);
        worldPoints.push(center.clone());
      } else {
        box.getCenter(center);
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              worldPoints.push(new THREE.Vector3(x, y, z));
            }
          }
        }
      }
      const centerScreen = projectWorld(center);
      let left = centerScreen.x;
      let right = centerScreen.x;
      let top = centerScreen.y;
      let bottom = centerScreen.y;
      let radius = 0;
      worldPoints.forEach(point => {
        const screen = projectWorld(point);
        left = Math.min(left, screen.x);
        right = Math.max(right, screen.x);
        top = Math.min(top, screen.y);
        bottom = Math.max(bottom, screen.y);
        radius = Math.max(radius, Math.hypot(screen.x - centerScreen.x, screen.y - centerScreen.y));
      });
      const intersectsViewport = right >= rect.left && left <= rect.right && bottom >= rect.top && top <= rect.bottom;
      const visible = centerScreen.z >= -1 && centerScreen.z <= 1 && intersectsViewport;
      return { kind, id, x: centerScreen.x, y: centerScreen.y, left, top, right, bottom, radius, visible };
    };

    const objectTargets = Array.from(sceneObjectRefs.current.entries())
      .map(([id, object]) => targetForObject('object', id, object))
      .filter((target): target is ViewerScreenTarget => Boolean(target));
    const partTargets = Array.from(partMeshesRef.current.entries())
      .map(([id, object]) => targetForObject('part', id, object))
      .filter((target): target is ViewerScreenTarget => Boolean(target));
    const mechanismTargets = roots.mechanismsLayer.children
      .map(object => {
        const mechanismId = typeof object.userData.mechanismId === 'string' ? object.userData.mechanismId : '';
        return mechanismId ? targetForObject('mechanism', mechanismId, object) : null;
      })
      .filter((target): target is ViewerScreenTarget => Boolean(target));
    return [...objectTargets, ...partTargets, ...mechanismTargets];
  };

  const roundedScreenTargets = (targets: ViewerScreenTarget[]) => targets.map(target => ({
    kind: target.kind,
    id: target.id,
    x: Number(target.x.toFixed(1)),
    y: Number(target.y.toFixed(1)),
    left: Number(target.left.toFixed(1)),
    top: Number(target.top.toFixed(1)),
    right: Number(target.right.toFixed(1)),
    bottom: Number(target.bottom.toFixed(1)),
    radius: Number(target.radius.toFixed(1)),
    visible: target.visible
  }));

  const render = () => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (scene && camera && renderer) {
      renderer.render(scene, camera);
      if (stateRef.current) {
        const screenTargets = roundedScreenTargets(collectViewerScreenTargets());
        stateRef.current.dataset.threeSceneVisibleObjectCount = String(estimatedObjectCount);
        stateRef.current.dataset.threeSceneObjectCount = String(estimatedObjectCount);
        stateRef.current.dataset.threeRenderTriangles = String(renderer.info.render.triangles);
        stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(screenTargets.filter(target => target.kind === 'object'));
        stateRef.current.dataset.threePartScreenTargets = JSON.stringify(screenTargets.filter(target => target.kind === 'part'));
        stateRef.current.dataset.threeMechanismScreenTargets = JSON.stringify(screenTargets.filter(target => target.kind === 'mechanism'));
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

    setRendererPixelRatioCap(renderer);
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
    const objectsLayer = new THREE.Group();
    const skeletonLayer = new THREE.Group();
    const pathsLayer = new THREE.Group();
    const mechanismsLayer = new THREE.Group();
    root.add(staticLayer, partsLayer, objectsLayer, skeletonLayer, pathsLayer, mechanismsLayer);
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 6, 9);
    scene.add(key);

    materialsRef.current = materials;
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    rootsRef.current = { root, staticLayer, partsLayer, objectsLayer, skeletonLayer, pathsLayer, mechanismsLayer };
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
      sceneObjectRefs.current.clear();
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

  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.partsLayer);
    partMeshesRef.current.clear();
    const sourceTextureUrl = project?.characterPackage?.sourceTextureUrl;
    const sourceTexturePart = sourceTextureUrl
      ? geometryParts.map(part => project?.parts[part.id] ?? part).find(part => part.sourceImageFrame)
      : undefined;
    const sourceArtMaterial = sourceTexturePart
      ? createPartArtMaterial(sourceTexturePart, render, sourceTextureUrl)
      : undefined;
    let partIndex = 0;
    let timer = 0;
    const buildNextPart = () => {
      const part = geometryParts[partIndex++];
      if (!part) return;
      const base = project?.parts[part.id] ?? part;
      const landmarks = partLandmarkLocalPoints(base, canonicalSkeleton);
      const outline = fabricablePartOutlinePoints(base, landmarks);
      const localHoles = landmarks.filter(local => pointInsideOutline(local, outline, 0.5));
      const shape = shapeFromLocalOutline(outline);
      localHoles.forEach(local => {
        shape.holes.push(holePath(local.x / VIEW_SCALE, local.y / VIEW_SCALE));
      });
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: false, steps: 1, curveSegments: 4 });
      const mesh = new THREE.Mesh(geometry, materials.part);
      mesh.userData.partId = part.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), materials.edge));
      const artGeometry = new THREE.ShapeGeometry(shape);
      const artPositions = artGeometry.getAttribute('position');
      const uvs: number[] = [];
      const artWidth = Math.max(1, base.bounds.width);
      const artHeight = Math.max(1, base.bounds.height);
      const sourceFrame = sourceArtMaterial ? base.sourceImageFrame : undefined;
      for (let i = 0; i < artPositions.count; i += 1) {
        const x = artPositions.getX(i) * VIEW_SCALE;
        const y = artPositions.getY(i) * VIEW_SCALE;
        uvs.push(
          sourceFrame ? (x - sourceFrame.x) / sourceFrame.width : (x - base.bounds.x) / artWidth,
          sourceFrame ? (y - sourceFrame.y) / sourceFrame.height : (y - base.bounds.y) / artHeight,
        );
      }
      artGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const art = new THREE.Mesh(
        artGeometry,
        sourceFrame && sourceArtMaterial ? sourceArtMaterial : createPartArtMaterial(base, render),
      );
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
      mesh.traverse(child => {
        child.userData.partId = part.id;
      });
      localHoles.forEach(local => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 8, 28), materials.cutRing);
        ring.name = `cut-hole-ring-${part.id}`;
        ring.position.set(local.x / VIEW_SCALE, local.y / VIEW_SCALE, THICKNESS + 0.04);
        mesh.add(ring);
      });
      roots.partsLayer.add(mesh);
      partMeshesRef.current.set(part.id, mesh);
      const animated = parts.find(candidate => candidate.id === part.id) ?? part;
      const animatedIndex = Math.max(0, parts.findIndex(candidate => candidate.id === part.id));
      const assemblyOffset = assemblyOffsetForPart(animatedIndex, parts.length, assemblyExplodeAmount);
      mesh.visible = animated.visible;
      mesh.position.set(
        (animated.transform.x + assemblyOffset.x) / VIEW_SCALE,
        (animated.transform.y + assemblyOffset.y) / VIEW_SCALE,
        animated.zIndex * 0.035 + assemblyOffset.z
      );
      mesh.rotation.z = (animated.transform.rotation * Math.PI) / 180;
      mesh.scale.set(animated.transform.scale, animated.transform.scale, 1);
      mesh.material = project?.selectedPartId === animated.id ? materials.selected : materials.part;
      render();
      if (partIndex < geometryParts.length) timer = window.setTimeout(buildNextPart, 16);
    };
    timer = window.setTimeout(buildNextPart, 16);
    return () => window.clearTimeout(timer);
  }, [canonicalSkeleton?.joints, geometryParts, project?.characterPackage?.sourceTextureUrl, project?.parts, rendererStatus]);

  useEffect(() => {
    const materials = materialsRef.current;
    if (!materials || rendererStatus !== 'webgl') return;
    parts.forEach((part, index) => {
      const mesh = partMeshesRef.current.get(part.id);
      if (!mesh) return;
      const assemblyOffset = assemblyOffsetForPart(index, parts.length, assemblyExplodeAmount);
      mesh.visible = part.visible;
      mesh.position.set(
        (part.transform.x + assemblyOffset.x) / VIEW_SCALE,
        (part.transform.y + assemblyOffset.y) / VIEW_SCALE,
        part.zIndex * 0.035 + assemblyOffset.z
      );
      mesh.rotation.z = (part.transform.rotation * Math.PI) / 180;
      mesh.scale.set(part.transform.scale, part.transform.scale, 1);
      mesh.material = project?.selectedPartId === part.id ? materials.selected : materials.part;
    });
    render();
  }, [assemblyExplodeAmount, parts, project?.selectedPartId, rendererStatus]);

  const sceneObjectSignature = useMemo(() => sceneObjects.map(object => [
    object.id,
    object.shape,
    object.textureUrl ?? '',
    object.contourSource ?? '',
    object.contourPoints?.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';') ?? '',
    object.fillColor,
    object.opacity.toFixed(3),
    object.locked ? 'locked' : 'free',
    object.visible ? '1' : '0',
    object.bounds.width.toFixed(2),
    object.bounds.height.toFixed(2)
  ].join(':')).join('|'), [sceneObjects]);
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.objectsLayer);
    sceneObjectRefs.current.clear();
    sceneObjects.forEach(object => {
      const group = createSceneObjectVisual(object, materials, object.id === project?.selectedSceneObjectId, render);
      roots.objectsLayer.add(group);
      sceneObjectRefs.current.set(object.id, group);
    });
    render();
  }, [project?.selectedSceneObjectId, rendererStatus, sceneObjectSignature]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    sceneObjects.forEach(object => {
      const group = sceneObjectRefs.current.get(object.id);
      if (!group) return;
      group.visible = object.visible;
      group.position.set(object.transform.x / VIEW_SCALE, object.transform.y / VIEW_SCALE, object.zIndex * 0.035 + 0.12);
      group.rotation.z = (object.transform.rotation * Math.PI) / 180;
      group.scale.set(object.transform.scale, object.transform.scale, 1);
      group.renderOrder = 30 + object.zIndex;
    });
    render();
  }, [rendererStatus, sceneObjects]);

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
    const assemblyActiveJoints = new Set(assemblyOverlay?.activeJointIds ?? []);
    bones.forEach(([a, b]) => {
      const mesh = boneRefs.current.get(`${a}-${b}`);
      if (!mesh) return;
      mesh.visible = !assemblyOverlay;
      const ja = activeSkeleton?.joints[a];
      const jb = activeSkeleton?.joints[b];
      updateUnitBar(mesh, ja?.position, jb?.position, 0.18);
    });
    joints.forEach(joint => {
      const visual = jointRefs.current.get(joint.id);
      if (!visual) return;
      const showAssemblyPin = !assemblyOverlay || (
        assemblyPhase !== 'character-parts' && assemblyActiveJoints.has(joint.id)
      );
      visual.pin.visible = showAssemblyPin;
      visual.washer.visible = showAssemblyPin;
      const p = to3(joint.position, 0.35);
      visual.pin.position.copy(p);
      visual.washer.position.set(p.x, p.y, 0.55);
    });
    render();
  }, [activeSkeleton, assemblyOverlay, assemblyPhase, bones, joints, rendererStatus]);

  const pathSignature = useMemo(() => pathsToRender.map(path => [
    path.id,
    path.visible !== false ? '1' : '0',
    path.enabled !== false ? '1' : '0',
    path.closed ? 'closed' : 'open',
    path.points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';')
  ].join(':')).join('|'), [pathsToRender]);
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.pathsLayer);
    pathsToRender.forEach(path => {
      const z = path.id === selectedPathId ? 0.88 : 0.82;
      const points3 = path.points.map(point => to3(point, z));
      const linePoints = path.closed && points3.length > 2 ? [...points3, points3[0].clone()] : points3;
      const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const line = new THREE.Line(geometry, path.id === selectedPathId ? materials.pathSelected : materials.path);
      line.name = `path-line-${path.id}`;
      line.renderOrder = 90;
      roots.pathsLayer.add(line);
      path.points.forEach((point, index) => {
        const marker = new THREE.Mesh(
          cachedGeometry(`path-point:${index === 0 ? 'start' : 'node'}`, () => new THREE.SphereGeometry(index === 0 ? 0.115 : 0.075, 16, 8)),
          materials.pathPoint
        );
        marker.name = `path-point-${path.id}-${index}`;
        marker.renderOrder = 91;
        marker.position.copy(to3(point, z + 0.04));
        roots.pathsLayer.add(marker);
      });
    });
    render();
  }, [pathSignature, rendererStatus, selectedPathId]);

  const mechanismSignature = useMemo(
    () => mechanismGeometrySignature(renderedMechanisms, mechanismContracts),
    [mechanismContracts, renderedMechanisms],
  );
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.mechanismsLayer);
    mechanismRefs.current.clear();
    renderedMechanisms.forEach(mechanism => {
      const group = new THREE.Group();
      group.userData.mechanismId = mechanism.id;
      const sceneLinkLengths = fabricationLinkageSceneLengthsForMechanism(mechanism);
      const linkLengths = Object.fromEntries(Object.entries(sceneLinkLengths).map(([role, length]) => [role, Math.max(0.08, length / VIEW_SCALE)])) as Record<LinkKey, number>;
      const fourBarConnections = resolveFourBarConnectionSelections(mechanism);
      const driverPartKey = fourBarConnections.inputJoint?.selection.kind === 'linkage-hole'
        ? fourBarConnections.inputJoint.selection.linkageKey
        : undefined;
      const outputPartKey = fourBarConnections.outputJoint?.selection.kind === 'linkage-hole'
        ? fourBarConnections.outputJoint.selection.linkageKey
        : undefined;
      const links: Record<LinkKey, THREE.Group> = {
        base: createHoledLink(linkLengths.base, FABRICATION_LINKAGE_WIDTH_3D, materials.mechBase, materials.edge, 3),
        driver: createHoledLink(linkLengths.driver, FABRICATION_LINKAGE_WIDTH_3D, materials.mechDrive, materials.edge, 3, driverPartKey),
        coupler: createHoledLink(linkLengths.coupler, FABRICATION_LINKAGE_WIDTH_3D, materials.mechCoupler, materials.edge, 4),
        output: createHoledLink(linkLengths.output, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 3, outputPartKey),
        effector: createHoledLink(linkLengths.effector, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 2),
        follower: createHoledLink(linkLengths.follower, FABRICATION_LINKAGE_WIDTH_3D, materials.mechOutput, materials.edge, 2)
      };
      Object.values(links).forEach(link => group.add(link));
      const gears: THREE.Mesh[] = [];
      if (['gear', 'gear_linkage', 'planetary_gear', 'rack-pinion'].includes(mechanism.type)) {
        const gearRadii = mechanism.type === 'rack-pinion'
          ? [mechanism.crankLength]
          : mechanism.type === 'gear' || mechanism.type === 'gear_linkage'
            ? gearTrainPitchRadii(mechanism)
          : mechanism.type === 'planetary_gear'
              ? [mechanism.crankLength, mechanism.rockerLength]
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
        addExtra('camProfile', createCamProfile(Math.max(0.46, mechanism.crankLength / VIEW_SCALE), mechanism.camProfileSamples, materials.mechDrive, materials.edge));
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
      group.traverse(node => {
        node.userData.mechanismId = mechanism.id;
      });
      roots.mechanismsLayer.add(group);
      mechanismRefs.current.set(mechanism.id, { links, gears, pins, extras });
    });
    render();
  }, [mechanismSignature, kit, rendererStatus]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    renderedMechanisms.forEach(mechanism => {
      const visual = mechanismRefs.current.get(mechanism.id);
      if (!visual) return;
      const contract = mechanismContracts.get(mechanism.id);
      const renderPlan = mechanismRenderPlans.get(mechanism.id);
      if (!contract || !renderPlan) return;
      const state = calculateLinkage(
        mechanism,
        contract.projectDriveEnabled ? angle : 0,
        kit,
      );
      const isGearTrain = mechanism.type === 'gear' || mechanism.type === 'gear_linkage';
      const layerForSource = (sourceNodeId: string) =>
        renderPlan.layers.find(layer => layer.sourceNodeId === sourceNodeId);
      const zForSource = (sourceNodeId: string, fallback = renderPlan.base.z) =>
        layerForSource(sourceNodeId)?.z ?? fallback;
      const zForFirstSource = (sourceNodeIds: string[], fallback = renderPlan.base.z) =>
        sourceNodeIds.map(layerForSource).find(Boolean)?.z ?? fallback;
      const depthForSource = (sourceNodeId: string, fallbackMm = 4) =>
        projectFabricationZMm(layerForSource(sourceNodeId)?.physicalDepthMm ?? fallbackMm);
      const updateSourceLink = (link: THREE.Object3D, sourceNodeId: string, a?: Point, b?: Point, fallbackZ = renderPlan.base.z) =>
        updateLink(link, a, b, zForSource(sourceNodeId, fallbackZ), depthForSource(sourceNodeId));
      const updateSourceObject = (object: THREE.Object3D | undefined, sourceNodeId: string, center?: Point, rotation = 0, sourceDepth = 1) =>
        updateObject(object, center, zForSource(sourceNodeId), rotation, depthForSource(sourceNodeId), sourceDepth);
      const zBackClip = renderPlan.base.z;
      const zDriver = zForFirstSource(['input-link', 'crank-link', 'connector-link-a', 'carrier', 'left-crank']);
      const zDriverGear = mechanism.type === 'cam'
        ? zForSource('cam-disk')
        : mechanism.type === 'planetary_gear'
          ? zForSource('sun-gear')
          : zForSource('gear-0', zForSource('pinion-gear'));
      const zRingGear = zForSource('ring-gear', zDriverGear);
      const zCoupler = zForFirstSource(['coupler-link', 'connecting-rod', 'follower-guide', 'left-coupler', 'guide'], zDriver);
      const zOutput = zForFirstSource(['output-link', 'slider', 'follower-head', 'connector-link-b', 'right-crank', 'rack'], zCoupler);
      const zDyad = zForSource('dyad-link', zOutput);
      const zFollower = zForSource('follower-link', zDyad);
      const gearRadiiForPins = isGearTrain ? gearTrainPitchRadii(mechanism) : [];
      const zOutputMoving = mechanism.type === 'planetary_gear'
        ? zForSource('planet-gear', zOutput)
        : isGearTrain
          ? zForSource(`gear-${Math.max(0, gearRadiiForPins.length - 1)}`, zDriverGear)
          : zForFirstSource(['rack', 'output-link', 'follower-head'], zOutput);
      const gearPinCenters = isGearTrain ? gearTrainCenters(mechanism) : [];
      const carrierAngle = angle * (mechanism.speed1 ?? 1) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength);
      const planetCentersForPins = mechanism.type === 'planetary_gear' ? planetaryPlanetCenters(state.p1, mechanism, carrierAngle) : [];
      const pinSites = foundryPinStacks(
        foundryPinStackPoints(renderPlan, {
          state,
          gearCenters: gearPinCenters,
          planetCenters: planetCentersForPins,
        }),
        renderPlan,
      );
      Object.values(visual.extras).forEach(extra => hideObject(extra));
      updateLink(visual.links.follower, undefined, undefined);
      const groundAngle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
      const outputAngle = Math.atan2(state.j2.y - state.p2.y, state.j2.x - state.p2.x);
      const standardLinks = () => {
        const fourBarBlankPoses = resolveFourBarLinkageBlankPoses(mechanism, state);
        const inputBlank = fourBarBlankPoses['4bar.input-joint'];
        const outputBlank = fourBarBlankPoses['4bar.output-joint'];
        updateLink(visual.links.base, state.p1, state.p2, zBackClip, projectFabricationZMm(renderPlan.base.physicalDepthMm));
        updateSourceLink(visual.links.driver, 'input-link', inputBlank?.origin ?? state.p1, inputBlank?.end ?? state.j1, zDriver);
        updateSourceLink(visual.links.coupler, 'coupler-link', state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateSourceLink(visual.links.output, 'output-link', state.isValid ? outputBlank?.origin ?? state.p2 : undefined, state.isValid ? outputBlank?.end ?? state.j2 : undefined, zOutput);
        updateLink(visual.links.effector, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
      };

      if (mechanism.type === 'piston') {
        updateLink(visual.links.base, undefined, undefined);
        updateSourceLink(visual.links.driver, 'crank-link', state.p1, state.j1, zDriver);
        updateSourceLink(visual.links.coupler, 'connecting-rod', state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, zCoupler);
        updateLink(visual.links.output, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateSourceObject(visual.extras.sliderGuide, 'guide', state.j2, groundAngle, 0.14);
        updateSourceObject(visual.extras.sliderBlock, 'slider', state.j2, groundAngle, 0.18);
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
        updateSourceObject(visual.extras.camProfile, 'cam-disk', state.p1, angle * (mechanism.speed1 ?? 1), 0.2);
        updateSourceObject(visual.extras.followerGuide, 'follower-guide', state.j2, groundAngle, 0.14);
        updateSourceObject(visual.extras.followerBlock, 'follower-head', state.j2, groundAngle, 0.18);
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
        updateLink(visual.links.driver, undefined, undefined);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, undefined, undefined);
        updateLink(visual.links.effector, undefined, undefined);
      } else if (mechanism.type === 'gear_linkage') {
        updateLink(visual.links.base, undefined, undefined);
        updateSourceLink(visual.links.driver, 'connector-link-a', state.isValid ? state.j1 : undefined, state.isValid ? state.effector : undefined, zDriver);
        updateLink(visual.links.coupler, undefined, undefined);
        updateSourceLink(visual.links.output, 'connector-link-b', state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
      } else if (mechanism.type === 'planetary_gear') {
        const carrierAngle = angle * (mechanism.speed1 ?? 1) * planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength);
        const planetCenters = planetaryPlanetCenters(state.p1, mechanism, carrierAngle);
        updateLink(visual.links.base, undefined, undefined);
        updateSourceLink(visual.links.driver, 'carrier', state.p1, planetCenters[0], zDriver);
        updateLink(visual.links.coupler, undefined, undefined);
        updateLink(visual.links.output, undefined, undefined);
        updateLink(visual.links.effector, undefined, undefined);
        updateSourceObject(visual.extras.ringGear, 'ring-gear', state.p1, 0, 0.14);
      } else {
        standardLinks();
      }
      visual.gears.forEach((gear, index) => {
        const gearCenters = isGearTrain ? gearTrainCenters(mechanism) : [];
        const planetaryCenters = mechanism.type === 'planetary_gear'
          ? [state.p1, ...planetCentersForPins]
          : [];
        const point = isGearTrain ? (gearCenters[index] ?? state.p2) : mechanism.type === 'planetary_gear' ? (planetaryCenters[index] ?? state.p2) : index === 0 ? state.p1 : state.p2;
        const gearSourceNodeId = isGearTrain
          ? `gear-${index}`
          : mechanism.type === 'planetary_gear'
            ? index === 0 ? 'sun-gear' : 'planet-gear'
            : 'pinion-gear';
        const gearLayer = layerForSource(gearSourceNodeId);
        const gearZ = gearLayer?.z ?? (index === 0 ? zDriverGear : zOutputMoving);
        const p = to3(point, gearZ);
        const physicalDepth = projectFabricationZMm(gearLayer?.physicalDepthMm ?? 4);
        gear.position.set(p.x, p.y, p.z - physicalDepth / 2);
        gear.scale.z = physicalDepth / 0.16;
        gear.rotation.z = mechanismGearRotations(mechanism, angle)[index] ?? 0;
      });
      visual.pins.forEach((pin, index) => {
        const site = pinSites[index];
        const point = site?.point;
        if (!point) {
          pin.visible = false;
          return;
        }
        const p = to3(point, site.centerZ);
        pin.visible = true;
        pin.position.copy(p);
        pin.scale.set(1, site.lengthZ / 0.36, 1);
      });
    });
    render();
  }, [angle, kit, mechanismContracts, mechanismRenderPlans, renderedMechanisms, rendererStatus]);

  useEffect(() => {
    const roots = rootsRef.current;
    if (!roots || rendererStatus !== 'webgl') return;
    roots.staticLayer.visible = visibleLayers.grid;
    roots.partsLayer.visible = visibleLayers.character;
    roots.objectsLayer.visible = visibleLayers.character;
    roots.skeletonLayer.visible = visibleLayers.skeleton;
    roots.pathsLayer.visible = pathsToRender.length > 0;
    roots.mechanismsLayer.visible = visibleLayers.mechanisms;
    render();
  }, [pathsToRender.length, rendererStatus, visibleLayers.grid, visibleLayers.character, visibleLayers.skeleton, visibleLayers.mechanisms]);

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
    if (inputMode === 'select-only') {
      event.stopPropagation();
      onSelectOnlyWheel?.(event);
      return;
    }
    if (!setViewport) return;
    event.stopPropagation();
    setViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)) }));
  };

  const handleViewerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    if (inputMode === 'select-only') {
      viewerDragRef.current = {
        pointerId: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        yaw: cameraOrbit.yaw,
        pitch: cameraOrbit.pitch,
        offset: viewport?.offset ?? { x: 0, y: 0 },
        mode: 'select'
      };
      setIsViewerDragging(true);
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelectOnlyPointerDown?.(event);
      return;
    }
    const mode = cameraPreset === 'front' || event.shiftKey || event.button === 1 || event.button === 2 ? 'pan' : 'orbit';
    if (mode === 'pan' && !setViewport) return;
    viewerDragRef.current = {
      pointerId: event.pointerId,
      button: event.button,
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
    if (start.mode === 'select') {
      event.stopPropagation();
      onSelectOnlyPointerMove?.(event);
      return;
    }
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.mode === 'orbit') {
      setCameraOrbit({ yaw: start.yaw + dx * 0.35, pitch: clampOrbitPitch(start.pitch - dy * 0.3) });
      return;
    }
    setViewport?.(prev => ({ ...prev, offset: { x: start.offset.x + dx, y: start.offset.y + dy } }));
  };

  const pickViewerTarget = (event: Pick<React.PointerEvent<HTMLDivElement>, 'clientX' | 'clientY'>) => {
    if (inputMode === 'none' || (!onSelectPart && !onSelectSceneObject && !onSelectMechanism)) return;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const roots = rootsRef.current;
    if (!renderer || !camera || !roots) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const selectFromNode = (node: THREE.Object3D | null) => {
      while (node) {
        const sceneObjectId = typeof node.userData.sceneObjectId === 'string' ? node.userData.sceneObjectId : undefined;
        if (sceneObjectId) {
          onSelectSceneObject?.(sceneObjectId);
          return true;
        }
        const partId = typeof node.userData.partId === 'string' ? node.userData.partId : undefined;
        if (partId) {
          onSelectPart?.(partId);
          return true;
        }
        const mechanismId = typeof node.userData.mechanismId === 'string' ? node.userData.mechanismId : undefined;
        if (mechanismId) {
          onSelectMechanism?.(mechanismId);
          return true;
        }
        node = node.parent;
      }
      return false;
    };
    const targets = collectViewerScreenTargets()
      .filter(target => target.visible)
      .map(target => ({
        ...target,
        distance: Math.hypot(event.clientX - target.x, event.clientY - target.y),
        inside: event.clientX >= target.left - 18
          && event.clientX <= target.right + 18
          && event.clientY >= target.top - 18
          && event.clientY <= target.bottom + 18
      }));
    const bestTarget = (kind: ViewerPickKind) => targets
      .filter(target => target.kind === kind && (target.inside || target.distance <= Math.max(42, Math.min(120, target.radius + 18))))
      .sort((a, b) => a.distance - b.distance)[0];
    const projectedObject = bestTarget('object');
    if (projectedObject) {
      onSelectSceneObject?.(projectedObject.id);
      return;
    }
    const projectedPart = bestTarget('part');
    if (projectedPart) {
      onSelectPart?.(projectedPart.id);
      return;
    }
    const projectedMechanism = bestTarget('mechanism');
    if (projectedMechanism) {
      onSelectMechanism?.(projectedMechanism.id);
      return;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const objectHits = raycaster.intersectObjects([roots.objectsLayer], true);
    for (const hit of objectHits) {
      if (selectFromNode(hit.object)) return;
    }
    const partHits = raycaster.intersectObjects([roots.partsLayer], true);
    for (const hit of partHits) {
      if (selectFromNode(hit.object)) return;
    }
    const mechanismHits = raycaster.intersectObjects([roots.mechanismsLayer], true);
    for (const hit of mechanismHits) {
      if (selectFromNode(hit.object)) return;
    }

  };

  const finishViewerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = viewerDragRef.current;
    if (start?.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    viewerDragRef.current = null;
    setIsViewerDragging(false);
    if (start.mode === 'select') {
      event.stopPropagation();
      if (moved < 4 && start.button === 0 && event.type === 'pointerup') pickViewerTarget(event);
      if (event.type === 'pointercancel') onSelectOnlyPointerCancel?.(event);
      else onSelectOnlyPointerUp?.(event);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved < 4 && event.type === 'pointerup') pickViewerTarget(event);
  };

  const activeCamera = VIEWER3D_CAMERA_PRESETS[cameraPreset];
  const viewerContract = useMemo(() => createViewer3DContract(viewerTabFromTestId(testId), cameraPreset, {
    grid: visibleLayers.grid,
    character: visibleLayers.character,
    skeleton: visibleLayers.skeleton,
    mechanisms: visibleLayers.mechanisms,
    paths: pathsToRender.length > 0,
    forces: 'absent',
    velocity: 'absent'
  }, activeCamera.mode), [activeCamera.mode, cameraPreset, pathsToRender.length, testId, visibleLayers.character, visibleLayers.grid, visibleLayers.mechanisms, visibleLayers.skeleton]);
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
    data-layer-paths={viewer3DLayerDataValue(pathsToRender.length > 0)}
    data-input-mode={inputMode}
    data-is-dragging={isViewerDragging ? 'true' : 'false'}
    data-camera-zoom={(viewport?.zoom ?? 1).toFixed(3)}
    data-camera-yaw={cameraOrbit.yaw.toFixed(3)}
    data-camera-pitch={cameraOrbit.pitch.toFixed(3)}
    data-camera-offset-x={(viewport?.offset.x ?? 0).toFixed(2)}
    data-camera-offset-y={(viewport?.offset.y ?? 0).toFixed(2)}
    data-part-count={parts.length}
    data-joint-count={joints.length}
    data-scene-object-count={sceneObjects.length}
    data-selected-scene-object-id={project?.selectedSceneObjectId ?? ''}
    data-assembly-mode={assemblyPhase ? 'character' : ''}
    data-assembly-phase={assemblyPhase ?? ''}
    data-assembly-progress={Math.round(assemblyProgress * 100)}
    data-three-exploded={assemblyExplodeAmount > 0.01 ? 'true' : 'false'}
  >
    <div
      ref={hostRef}
      className="three-puppet-host"
      onWheel={handleViewerWheel}
      onPointerDown={handleViewerPointerDown}
      onPointerMove={handleViewerPointerMove}
      onPointerUp={finishViewerDrag}
      onPointerCancel={finishViewerDrag}
      onContextMenu={event => event.preventDefault()}
    />
    {project?.settings.debugVisuals && (
      <div
        data-testid="canvas-debug-visuals"
        className="three-puppet-debug-overlay"
        aria-label="Canvas debug visuals"
      >
        <strong>Debug</strong>
        <span>{parts.length} parts · {joints.length} joints</span>
        <span>snap {project.settings.physicsSnapMode}</span>
      </div>
    )}
    {showToolbar && (
      <div
        className="canvas-zoom-toolbar three-puppet-view-toolbar"
        data-testid={`${testId}-view-toolbar`}
        aria-label="Shared 3D viewer toolbar"
        data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
        onMouseDown={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        {cameraPresets.map(preset => (
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
        {(['grid', 'character', 'skeleton', 'mechanisms'] as Array<keyof typeof DEFAULT_PUPPET_VIEWER_LAYERS>)
          .filter(layer => layer !== 'mechanisms' || mechanismsToRender.length > 0)
          .map(layer => (
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
    )}
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
      data-layer-paths={viewer3DLayerDataValue(pathsToRender.length > 0)}
      data-input-mode={inputMode}
      data-camera-zoom={(viewport?.zoom ?? 1).toFixed(3)}
      data-camera-yaw={cameraOrbit.yaw.toFixed(3)}
      data-camera-pitch={cameraOrbit.pitch.toFixed(3)}
      data-camera-offset-x={(viewport?.offset.x ?? 0).toFixed(2)}
      data-camera-offset-y={(viewport?.offset.y ?? 0).toFixed(2)}
      data-part-count={parts.length}
      data-joint-count={joints.length}
      data-scene-object-count={sceneObjects.length}
      data-selected-scene-object-id={project?.selectedSceneObjectId ?? ''}
      data-layer-forces={viewer3DLayerDataValue(undefined)}
      data-layer-velocity={viewer3DLayerDataValue(undefined)}
      data-three-renderer={rendererStatus === 'pending' ? 'webgl' : rendererStatus}
      data-three-engine-stack={PHYSICS_RENDER_STACK}
      data-physics-kernel={PHYSICS_KERNEL_ENGINE}
      data-physics-update-policy={PHYSICS_UPDATE_POLICY}
      data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
      data-physics-contact-mode="kinematic-estimate-rapier-contact-probe"
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
      data-mechanism-type={selectedTelemetry?.type ?? ''}
      data-path-preview={pathsToRender.length > 0 ? 'shown' : 'hidden'}
      data-three-selected-mechanism-type={selectedTelemetry?.type ?? ''}
      data-three-selected-mechanism-id={selectedMechanism?.id ?? ''}
      data-three-selectable-mechanism-count={onSelectMechanism ? mechanismsToRender.length : 0}
      data-three-selected-mechanism-generated-path-count={selectedMechanism && mechanismContracts.get(selectedMechanism.id)?.projectDriveEnabled
        ? selectedMechanism.generatedPath?.length ?? 0
        : 0}
      data-three-mechanism-ids={mechanismsToRender.map(mechanism => mechanism.id).join(',')}
      data-three-rendered-mechanism-ids={renderedMechanisms.map(mechanism => mechanism.id).join(',')}
      data-three-mechanism-generated-path-counts={mechanismsToRender.map(mechanism => `${mechanism.id}:${mechanismContracts.get(mechanism.id)?.projectDriveEnabled ? mechanism.generatedPath?.length ?? 0 : 0}`).join(',')}
      data-three-mechanism-runtime-modes={mechanismsToRender.map(mechanism => `${mechanism.id}:${mechanismContracts.get(mechanism.id)?.runtimeMode ?? ''}`).join(',')}
      data-three-stack-source={selectedRenderPlan ? 'MechanismSceneContract' : ''}
      data-three-stack-mode="assembled-spacer-separated"
      data-three-part-surface="solid-cut-plates"
      data-three-part-art="top-texture-decal"
      data-three-part-art-count={partArtCount}
      data-three-part-texture-count={partTextureCount}
      data-three-part-opacity="1"
      data-three-part-edge-opacity="0.95"
      data-three-assembly-underlay="plate-art-decal"
      data-assembly-mode={assemblyPhase ? 'character' : ''}
      data-assembly-phase={assemblyPhase ?? ''}
      data-assembly-progress={Math.round(assemblyProgress * 100)}
      data-assembly-skeleton-mode={assemblyPhase ? 'pin-hardware-only' : ''}
      data-assembly-active-part-ids={assemblyOverlay?.activePartIds?.join(',') ?? ''}
      data-assembly-active-joint-ids={assemblyOverlay?.activeJointIds?.join(',') ?? ''}
      data-three-exploded={assemblyExplodeAmount > 0.01 ? 'true' : 'false'}
      data-three-base-layer={selectedRenderPlan?.base.label ?? ''}
      data-three-stack-order={selectedRenderPlan?.stackSummary ?? ''}
      data-three-stack-roles={selectedRenderPlan?.roleSummary ?? ''}
      data-three-stack-colors={selectedRenderPlan?.colorSummary ?? ''}
      data-three-stack-z={selectedRenderPlan?.zSummary ?? ''}
      data-three-stack-occurrences={selectedRenderPlan?.occurrenceSummary ?? ''}
      data-three-spacer-z-gap={selectedStackZGap.toFixed(2)}
      data-three-linkage-hole-counts={selectedLinkageHoleCounts ? Object.entries(selectedLinkageHoleCounts).map(([role, count]) => `${role}:${count}`).join(',') : ''}
      data-three-linkage-template-cells={selectedLinkageSpecs ? Object.entries(selectedLinkageSpecs).map(([role, spec]) => `${role}:${spec.cells}`).join(',') : ''}
      data-three-linkage-hole-spacing-mm={selectedLinkageSpecs ? Object.entries(selectedLinkageSpecs).map(([role, spec]) => `${role}:${spec.pitchMm.toFixed(2)}`).join(',') : ''}
      data-three-carrier-linkage-hole-count={selectedLinkageHoleCounts?.driver ?? 0}
      data-three-stack-layer-count={selectedRenderPlan?.layers.length ?? 0}
      data-three-rendered-layer-labels={selectedRenderPlan?.layers.map(item => item.label).join(' → ') ?? ''}
      data-three-rendered-layer-roles={selectedRenderPlan?.layers.map(item => item.renderKind).join('>') ?? ''}
      data-three-rendered-layer-colors={selectedRenderPlan?.layers.map(item => item.color).join(',') ?? ''}
      data-three-rendered-layer-z={selectedRenderedLayerZ.map(z => z.toFixed(2)).join(',')}
      data-three-stack-validation-errors={stackValidationErrors}
      data-three-physical-validation-errors={physicalValidationErrors}
      data-three-preview-renderable={selectedRenderPlan && physicalValidationErrors === 0 && stackValidationErrors === 0 ? 'ready' : selectedRenderPlan ? 'blocked' : ''}
      data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
      data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
      data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
      data-three-primary-rotation-deg={fixed3(selectedTelemetry?.primaryRotationDeg)}
      data-pinion-rotation-deg={fixed3(selectedTelemetry?.primaryRotationDeg)}
      data-three-secondary-rotation-deg={fixed3(selectedTelemetry?.secondaryRotationDeg)}
      data-three-gear-radii={selectedMechanism ? ((selectedMechanism.type === 'gear' || selectedMechanism.type === 'gear_linkage') ? gearTrainPitchRadii(selectedMechanism).map(radius => radius.toFixed(2)).join(',') : selectedMechanism.type === 'planetary_gear' ? planetaryGearRadii(selectedMechanism).map(radius => radius.toFixed(2)).join(',') : `${selectedMechanism.crankLength.toFixed(2)},${selectedMechanism.rockerLength.toFixed(2)}`) : ''}
      data-three-gear-output-ratio={selectedMechanism ? selectedGearOutputRatio.toFixed(3) : ''}
      data-three-secondary-speed={selectedMechanism ? (selectedMechanism.speed2 ?? selectedMechanism.gearRatio ?? 1).toFixed(3) : ''}
      data-three-planet-count={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).planetCount : 0}
      data-three-gear-linkage-mode={selectedMechanism?.type === 'gear_linkage' ? 'two-gear-two-link-coupler' : 'none'}
      data-three-gear-train-linkage-mode={selectedMechanism?.type === 'gear' ? 'gear-only-train' : ''}
      data-three-gear-plane-mode={selectedGearPlaneMode}
      data-three-gear-plane-z={typeof selectedGearPlaneZ === 'number' ? selectedGearPlaneZ.toFixed(2) : ''}
      data-three-linkage-pin-radius={selectedMechanism?.type === 'gear_linkage' ? selectedMechanism.couplerPointDist.toFixed(2) : ''}
      data-three-planetary-syntax={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).syntax : ''}
      data-three-planetary-fixed={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).fixedMember : ''}
      data-three-planetary-input={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).inputMember : ''}
      data-three-planetary-output={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).outputMember : ''}
      data-three-planetary-ring-radius={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).ringPitchRadius.toFixed(2) : ''}
      data-three-planetary-carrier-radius={selectedMechanism?.type === 'planetary_gear' ? planetaryGearConventionForMechanism(selectedMechanism).carrierPitchRadius.toFixed(2) : ''}
      data-three-fourbar-ground-link-plane={selectedMechanism?.type === '4bar' ? 'fabrication-stack-separated' : ''}
      data-three-cam-contact-mode={selectedMechanism?.type === 'cam' ? 'sampled-profile-on-guide-axis' : ''}
      data-cam-profile={selectedCamProfile}
      data-three-rack-x={fixed3(selectedTelemetry?.rackX)}
      data-three-rack-y={fixed3(selectedTelemetry?.rackY)}
      data-three-rack-guide-x={fixed3(selectedTelemetry?.rackGuideX)}
      data-three-rack-guide-y={fixed3(selectedTelemetry?.rackGuideY)}
      data-three-end-stop-a-x={fixed3(selectedTelemetry?.endStopAX)}
      data-three-end-stop-a-y={fixed3(selectedTelemetry?.endStopAY)}
      data-three-end-stop-b-x={fixed3(selectedTelemetry?.endStopBX)}
      data-three-end-stop-b-y={fixed3(selectedTelemetry?.endStopBY)}
      data-three-part-count={parts.length}
      data-three-scene-prop-count={sceneObjects.length}
      data-three-scene-prop-ids={sceneObjects.map(object => object.id).join(',')}
      data-three-scene-object-screen-targets="[]"
      data-three-part-screen-targets="[]"
      data-three-mechanism-screen-targets="[]"
      data-three-joint-count={joints.length}
      data-three-bone-count={bones.length}
      data-three-part-hole-count={holeCount}
      data-three-hole-count={mechanismInventory.holes}
      data-three-path-count={pathsToRender.length}
      data-three-selected-path-id={selectedPathId ?? ''}
      data-three-mechanism-count={mechanismsToRender.length}
      data-three-mechanism-link-count={mechanismLinkCount}
      data-three-mechanism-hole-count={mechanismInventory.holes}
      data-three-dynamic-build-count={estimatedObjectCount}
      data-three-slot-count={mechanismInventory.slots}
      data-three-gear-count={mechanismInventory.gears}
      data-three-rack-count={mechanismInventory.racks}
      data-three-cam-count={mechanismInventory.cams}
      data-three-follower-count={mechanismInventory.followers}
      data-three-end-stop-count={mechanismInventory.endStops}
      data-three-physical-template-count={mechanismsToRender.length}
      data-three-object-count={estimatedObjectCount}
      data-three-scene-object-count={estimatedObjectCount}
      data-three-scene-visible-object-count={estimatedObjectCount}
      data-three-render-triangles={0}
      data-thickness-mm={Math.round(THICKNESS * VIEW_SCALE)}
    />
  </div>;
};

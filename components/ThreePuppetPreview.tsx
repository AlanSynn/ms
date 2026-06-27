import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BodyPartLayer, CanvasViewport, MechanismConfig, MechanismType, Point, ProjectState, StandardSkeleton } from '../types';
import { boardGridLines, defaultPhysicalKit, SCENE_PX_PER_MM, sceneBoundsForSheet } from '../utils/coordinates';
import { calculateLinkage, camProfileScale, gearPairOutputRatio, planetaryPlanetSpinRatio } from '../utils/kinematics';
import { FABRICATION_SPACER_SPEC, fabricationGearProfileForPitchRadius, fabricationRenderPlanForMechanism, fabricationRingGearProfileForPitchRadius, fabricationRingInnerGearOutlinePoints } from '../utils/fabrication';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, pointInsideOutline } from '../utils/partGeometry';
import { WEBGL_PIXEL_RATIO_CAP } from '../utils/viewport';

const VIEW_SCALE = 35;
const THICKNESS = 0.22;
const SUPPORTED_MECHANISM_TYPES: MechanismType[] = ['crank', '4bar', 'piston', 'yoke', 'quick-return', '5bar', 'cam', 'rack-pinion', 'gear', 'planetary_gear'];
type RendererStatus = 'pending' | 'webgl' | 'unavailable';
type LinkKey = 'base' | 'driver' | 'coupler' | 'output' | 'effector';

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

const disposeObject = (object: THREE.Object3D, disposeMaterials = false) => object.traverse(child => {
  const mesh = child as THREE.Mesh;
  mesh.geometry?.dispose?.();
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

const disposeMaterials = (materials: MaterialKit | null) => {
  if (!materials) return;
  Object.values(materials).forEach(material => material.dispose());
};

const zeroInventory = (): MechanismInventory => ({ parts: 0, holes: 0, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 });

const puppetMechanismInventory = (type: MechanismType): MechanismInventory => ({
  crank: { parts: 2, holes: 4, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  '4bar': { parts: 5, holes: 15, slots: 0, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  piston: { parts: 5, holes: 10, slots: 1, gears: 0, racks: 0, cams: 0, followers: 1, endStops: 0 },
  yoke: { parts: 5, holes: 9, slots: 2, gears: 0, racks: 0, cams: 0, followers: 1, endStops: 0 },
  'quick-return': { parts: 5, holes: 11, slots: 1, gears: 0, racks: 0, cams: 0, followers: 0, endStops: 0 },
  '5bar': { parts: 6, holes: 18, slots: 0, gears: 2, racks: 0, cams: 0, followers: 0, endStops: 0 },
  cam: { parts: 4, holes: 6, slots: 1, gears: 0, racks: 0, cams: 1, followers: 1, endStops: 0 },
  'rack-pinion': { parts: 5, holes: 6, slots: 1, gears: 1, racks: 1, cams: 0, followers: 1, endStops: 2 },
  gear: { parts: 6, holes: 18, slots: 0, gears: 2, racks: 0, cams: 0, followers: 0, endStops: 0 },
  planetary_gear: { parts: 5, holes: 14, slots: 0, gears: 3, racks: 0, cams: 0, followers: 0, endStops: 0 }
}[type]);

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

const makeUnitBar = (width: number, depth: number, material: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(1, width, depth), material);

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

const createHoledLink = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material, holeCount = 2) => {
  const group = new THREE.Group();
  group.userData.baseLength = Math.max(0.08, length);
  const shape = roundedRect(Math.max(0.08, length), width, width / 2);
  const count = Math.max(2, holeCount);
  for (let i = 0; i < count; i += 1) {
    shape.holes.push(holePath(-length / 2 + (length * i) / (count - 1), 0, Math.min(0.11, width * 0.22)));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.11, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.01 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -0.055;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  group.add(mesh);
  return group;
};

const createExtrudedMesh = (shape: THREE.Shape, material: THREE.Material, edgeMaterial: THREE.Material, depth = 0.14) => {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.01 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -depth / 2;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  return mesh;
};

const createSlotPlate = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const shape = roundedRect(Math.max(0.4, length), width, width / 2);
  shape.holes.push(roundedRect(Math.max(0.18, length * 0.68), width * 0.38, width * 0.19));
  group.add(createExtrudedMesh(shape, material, edgeMaterial));
  return group;
};

const createFollowerBlock = (material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const blockGeometry = new THREE.BoxGeometry(0.46, 0.62, 0.18);
  const block = new THREE.Mesh(blockGeometry, material);
  block.add(new THREE.LineSegments(new THREE.EdgesGeometry(blockGeometry), edgeMaterial));
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 24), material);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(0, -0.42, 0.12);
  group.add(block, roller);
  return group;
};

const createRack = (length: number, width: number, material: THREE.Material, edgeMaterial: THREE.Material) => {
  const group = new THREE.Group();
  const bodyGeometry = new THREE.BoxGeometry(length, width, 0.16);
  const body = new THREE.Mesh(bodyGeometry, material);
  body.add(new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), edgeMaterial));
  group.add(body);
  const toothCount = Math.max(6, Math.round(length / 0.34));
  for (let i = 0; i < toothCount; i += 1) {
    const toothGeometry = new THREE.BoxGeometry(0.18, 0.16, 0.16);
    const tooth = new THREE.Mesh(toothGeometry, material);
    tooth.position.set(-length / 2 + 0.18 + i * ((length - 0.36) / Math.max(1, toothCount - 1)), -width * 0.72, 0.08);
    tooth.rotation.z = Math.PI / 4;
    tooth.add(new THREE.LineSegments(new THREE.EdgesGeometry(toothGeometry), edgeMaterial));
    group.add(tooth);
  }
  return group;
};

const createEndStop = (material: THREE.Material, edgeMaterial: THREE.Material) => {
  const geometry = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
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
  group.add(createExtrudedMesh(shape, material, edgeMaterial, 0.2));
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
  profile.mountHoleCenters.forEach(point => shape.holes.push(holePath(point.x, point.y, 2 * (pitchRadius / 70))));
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
  group.scale.x = len / Math.max(0.01, Number(group.userData.baseLength ?? len));
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
  if (mechanism.type === 'gear') return [input, input * gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength) + phase];
  if (mechanism.type === 'planetary_gear') return [input, input * planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) + phase];
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
    return `${base.id}:${base.bounds.width}:${base.bounds.height}:${base.bounds.x}:${base.bounds.y}:${base.transform.x}:${base.transform.y}:${base.transform.rotation}:${base.transform.scale}:${base.visible}:${base.textureUrl ?? ''}:${base.fillColor}:${base.opacity}`;
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
  mechanism.couplerPointDist,
  mechanism.outputGearRadius,
  mechanism.showOutputGear
].join(':')).join('|');

export const ThreePuppetPreview = ({ project, animatedParts = {}, skeleton, mechanisms, angle = 0, viewport, testId = 'three-puppet' }: {
  project?: ProjectState;
  animatedParts?: Record<string, BodyPartLayer>;
  skeleton?: StandardSkeleton | null;
  mechanisms?: MechanismConfig[];
  angle?: number;
  viewport?: CanvasViewport;
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
  const selectedTelemetry = useMemo(() => selectedMechanism ? mechanismTelemetry(selectedMechanism, angle) : null, [selectedMechanism, angle]);
  const selectedRenderPlan = useMemo(() => selectedMechanism ? fabricationRenderPlanForMechanism(selectedMechanism) : null, [selectedMechanism]);
  const stackValidationErrors = useMemo(
    () => mechanismsToRender.reduce((sum, mechanism) => sum + fabricationRenderPlanForMechanism(mechanism).validationErrors.length, 0),
    [mechanismsToRender]
  );
  const mechanismInventory = mechanismsToRender.reduce((sum, mechanism) => addInventory(sum, puppetMechanismInventory(mechanism.type)), zeroInventory());
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
        let visibleObjects = 0;
        scene.traverse(child => {
          if (child.visible && ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine || (child as THREE.LineSegments).isLineSegments)) visibleObjects += 1;
        });
        stateRef.current.dataset.threeSceneObjectCount = String(visibleObjects);
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

  const mechanismSignature = useMemo(() => mechanismGeometrySignature(mechanismsToRender), [mechanismsToRender]);
  useEffect(() => {
    const roots = rootsRef.current;
    const materials = materialsRef.current;
    if (!roots || !materials || rendererStatus !== 'webgl') return;
    clearGroup(roots.mechanismsLayer);
    mechanismRefs.current.clear();
    mechanismsToRender.forEach(mechanism => {
      const group = new THREE.Group();
      const linkLengths = {
        base: Math.max(0.08, mechanism.groundLength / VIEW_SCALE),
        driver: Math.max(0.08, mechanism.crankLength / VIEW_SCALE),
        coupler: Math.max(0.08, mechanism.couplerLength / VIEW_SCALE),
        output: Math.max(0.08, mechanism.rockerLength / VIEW_SCALE),
        effector: Math.max(0.08, Math.max(20, mechanism.couplerPointDist) / VIEW_SCALE)
      };
      const links: Record<LinkKey, THREE.Group> = {
        base: createHoledLink(linkLengths.base, 0.16, materials.mechBase, materials.edge, 3),
        driver: createHoledLink(linkLengths.driver, 0.18, materials.mechDrive, materials.edge, 3),
        coupler: createHoledLink(linkLengths.coupler, 0.2, materials.mechCoupler, materials.edge, 4),
        output: createHoledLink(linkLengths.output, 0.18, materials.mechOutput, materials.edge, 3),
        effector: createHoledLink(linkLengths.effector, 0.16, materials.mechOutput, materials.edge, 2)
      };
      Object.values(links).forEach(link => group.add(link));
      const gears: THREE.Mesh[] = [];
      if (['gear', 'planetary_gear', '5bar', 'rack-pinion'].includes(mechanism.type)) {
        const gearRadii = mechanism.type === 'rack-pinion'
          ? [mechanism.crankLength]
          : [mechanism.crankLength, mechanism.rockerLength];
        gearRadii.forEach((radius, index) => {
          const mesh = new THREE.Mesh(
            new THREE.ExtrudeGeometry(gearShape(Math.max(0.38, radius / VIEW_SCALE), radius / SCENE_PX_PER_MM), { depth: 0.16, bevelEnabled: true, bevelSize: 0.015 }),
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
        addExtra('ringGear', createExtrudedMesh(
          ringGearShape(Math.max(0.82, (mechanism.groundLength + mechanism.rockerLength) / VIEW_SCALE)),
          materials.mechBase,
          materials.edge,
          0.14
        ));
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
  }, [mechanismSignature, rendererStatus]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    mechanismsToRender.forEach(mechanism => {
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
      const zOutputMoving = zLayer(['Toothed rack', 'Planet gear', 'Sun gear', 'Output gear', 'Right timing gear'], zOutput);
      const zPin = (renderPlan.layers.at(-1)?.z ?? zOutputMoving) + 0.34;
      Object.values(visual.extras).forEach(extra => hideObject(extra));
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
        updateLink(visual.links.base, state.p1, state.p2, zBackClip);
        updateLink(visual.links.driver, state.p1, state.j1, zDriver);
        updateLink(visual.links.coupler, state.p2, state.j2, zCoupler);
        updateLink(visual.links.output, state.p2, state.effector, zOutput);
        updateLink(visual.links.effector, undefined, undefined);
        updateObject(visual.extras.ringGear, state.p1, zDriverGear, 0);
      } else {
        standardLinks();
      }
      visual.gears.forEach((gear, index) => {
        const point = index === 0 ? state.p1 : state.p2;
        const gearZ = index === 0
          ? zDriverGear
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
  }, [angle, mechanismsToRender, rendererStatus]);

  useEffect(() => {
    const roots = rootsRef.current;
    const camera = cameraRef.current;
    if (!roots || !camera || rendererStatus !== 'webgl') return;
    const zoom = viewport?.zoom ?? 1;
    camera.position.set(0, -12 / zoom, 12 / zoom);
    camera.lookAt(new THREE.Vector3(0, 0, 0.1));
    roots.root.position.set((viewport?.offset.x ?? 0) / VIEW_SCALE, (viewport?.offset.y ?? 0) / VIEW_SCALE, 0);
    render();
  }, [rendererStatus, viewport?.offset.x, viewport?.offset.y, viewport?.zoom]);

  useEffect(() => {
    if (stateRef.current) stateRef.current.dataset.threeObjectCount = String(estimatedObjectCount);
  }, [estimatedObjectCount]);

  return <div className="three-puppet-overlay" data-testid={testId} aria-hidden="true">
    <div ref={hostRef} className="three-puppet-host" />
    <div
      ref={stateRef}
      data-testid={`${testId}-state`}
      className="three-puppet-state"
      data-three-renderer={rendererStatus === 'pending' ? 'webgl' : rendererStatus}
      data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
      data-puppet-mode="thick-flat-assembly"
      data-part-outline-mode="fabrication-fit-joint-chain"
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
      data-three-gear-radii={selectedMechanism ? `${selectedMechanism.crankLength.toFixed(2)},${selectedMechanism.rockerLength.toFixed(2)}` : ''}
      data-three-gear-output-ratio={selectedMechanism ? gearPairOutputRatio(selectedMechanism.crankLength, selectedMechanism.rockerLength).toFixed(3) : ''}
      data-three-secondary-speed={selectedMechanism ? (selectedMechanism.speed2 ?? selectedMechanism.gearRatio ?? 1).toFixed(3) : ''}
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
      data-three-scene-object-count={0}
      data-three-render-triangles={0}
      data-thickness-mm={Math.round(THICKNESS * VIEW_SCALE)}
    />
  </div>;
};

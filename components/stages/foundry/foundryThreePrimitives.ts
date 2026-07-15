import * as THREE from "three";
import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import {
  normalizeCamProfileSamples,
  sampledCamProfileScale,
} from "../../../utils/kinematics";
import {
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_WIDTH_MM,
  FABRICATION_SPACER_SPEC,
} from "../../../utils/fabricationContract";
import {
  CLIP_HEAD_DEPTH_MM,
  PLATE_DEPTH_MM,
  SPACER_DEPTH_MM,
  projectFabricationZMm,
} from "../../../utils/mechanismFabricationZStack";
import {
  fabricationGearProfileForPitchRadius,
  fabricationRingGearProfileForPitchRadius,
  fabricationRingInnerGearOutlinePoints,
} from "../../../utils/fabricationProfiles";
import { fabricationLinkageSpecForSceneLength } from "../../../utils/fabricationStackModel";
import { SCENE_PX_PER_MM } from "../../../utils/coordinates";
import {
  cachedThreeResource,
  disposeThreeObjectGraph,
} from "../../../utils/threeResourceKit";

export const FOUNDRY_CACHE_MARKER = "foundryCached";

export type FoundryFabricationMeshMetadata = {
  fabricationLayerId?: string;
  supportPathIds?: readonly string[];
  pinSpanIds?: readonly string[];
  primitiveKind?: "layer" | "pin" | "retainer";
};

export const disposeFoundryThreeObject = (object: THREE.Object3D) =>
  disposeThreeObjectGraph(object, {
    keepGeometry: (geometry) => Boolean(geometry.userData[FOUNDRY_CACHE_MARKER]),
    keepMaterial: (material) => Boolean(material.userData[FOUNDRY_CACHE_MARKER]),
  });

type FoundryThreePrimitiveFactoryOptions = {
  root: THREE.Group;
  geometryCache: Map<string, THREE.BufferGeometry>;
  materialCache: Map<string, THREE.Material>;
  mechanism: MechanismConfig;
  kit: PhysicalKitSettings;
  color: string;
  rigOpacity: number;
  baseColor: string;
  simulationScale: number;
};

export const createFoundryThreePrimitiveFactory = ({
  root,
  geometryCache,
  materialCache,
  mechanism,
  kit,
  color,
  rigOpacity,
  baseColor,
  simulationScale,
}: FoundryThreePrimitiveFactoryOptions) => {
  const cachedGeometry = <T extends THREE.BufferGeometry>(
    key: string,
    create: () => T,
  ): T => cachedThreeResource(geometryCache, key, create, FOUNDRY_CACHE_MARKER);
  const cachedMaterial = <T extends THREE.Material>(
    key: string,
    create: () => T,
  ): T => cachedThreeResource(materialCache, key, create, FOUNDRY_CACHE_MARKER);
  const materialForLayer = (
    colorValue: string,
    roughness = 0.66,
    metalness = 0.03,
  ) =>
    cachedMaterial(
      `standard:${colorValue}:${roughness.toFixed(2)}:${metalness.toFixed(2)}:${rigOpacity.toFixed(3)}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: colorValue,
          roughness,
          metalness,
          transparent: rigOpacity < 0.995,
          opacity: rigOpacity,
        }),
    );
  const material = {
    base: materialForLayer(baseColor, 0.82, 0.01),
    accent: materialForLayer("#60a5fa", 0.45, 0.08),
    hole: cachedMaterial(
      "standard:#ffffff:0.25:0.00:1",
      () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.25 }),
    ),
    dark: materialForLayer("#334155", 0.62, 0.03),
    edge: cachedMaterial(
      "edge:#334155:0.72",
      () =>
        new THREE.LineBasicMaterial({
          color: "#334155",
          transparent: true,
          opacity: 0.72,
        }),
    ),
    path: cachedMaterial(
      `path:${color}`,
      () =>
        new THREE.LineDashedMaterial({
          color: new THREE.Color(color),
          dashSize: 0.25,
          gapSize: 0.16,
          linewidth: 2,
        }),
    ),
    trail: cachedMaterial(
      `trail:${color}`,
      () =>
        new THREE.LineBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.18,
        }),
    ),
  };
  const to3 = (point: Point, z = 0) =>
    new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);
  const mmToThree = SCENE_PX_PER_MM / 18;
  void kit.holeDiameterMm;
  const thickness = projectFabricationZMm(PLATE_DEPTH_MM);
  const spacerDepth = projectFabricationZMm(SPACER_DEPTH_MM);
  const clipDepth = projectFabricationZMm(CLIP_HEAD_DEPTH_MM);
  const barW = Math.max(0.34, FABRICATION_LINKAGE_WIDTH_MM * mmToThree);
  const holeR = Math.max(0.08, FABRICATION_HOLE_RADIUS_MM * mmToThree);
  const spacerOuterR = (FABRICATION_SPACER_SPEC.outerDiameterMm * mmToThree) / 2;
  const spacerInnerR = (FABRICATION_SPACER_SPEC.innerDiameterMm * mmToThree) / 2;

  const addEdges = (mesh: THREE.Mesh, key = mesh.geometry.uuid) => {
    const edges = new THREE.LineSegments(
      cachedGeometry(`edges:${key}`, () => new THREE.EdgesGeometry(mesh.geometry)),
      material.edge,
    );
    mesh.add(edges);
  };
  const tagFabricationMesh = (
    mesh: THREE.Mesh,
    metadata: FoundryFabricationMeshMetadata | undefined,
  ) => {
    if (!metadata) return;
    if (metadata.fabricationLayerId) mesh.userData.fabricationLayerId = metadata.fabricationLayerId;
    mesh.userData.fabricationSupportPathIds = [...(metadata.supportPathIds ?? [])];
    mesh.userData.fabricationPinSpanIds = [...(metadata.pinSpanIds ?? [])];
    mesh.userData.fabricationPrimitiveKind = metadata.primitiveKind ?? (metadata.fabricationLayerId ? "layer" : undefined);
  };
  const circularHole = (x: number, y: number, r = holeR) => {
    const hole = new THREE.Path();
    hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
    return hole;
  };
  const roundedRectShape = (width: number, height: number, radius = height / 2) => {
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
  const addHoleRing = (group: THREE.Group, x: number, y: number, z: number) => {
    const ring = new THREE.Mesh(
      cachedGeometry(
        `hole-ring:${holeR.toFixed(3)}`,
        () => new THREE.TorusGeometry(holeR * 1.1, 0.025, 8, 24),
      ),
      material.accent,
    );
    ring.position.set(x, y, z + thickness / 2 + 0.025);
    group.add(ring);
  };
  const addSpacerWasher = (point: Point | undefined, z: number, mat: THREE.Material, metadata?: FoundryFabricationMeshMetadata) => {
    if (!point) return;
    const p = to3(point, z);
    const geometryKey = `spacer:${spacerOuterR.toFixed(3)}:${spacerInnerR.toFixed(3)}:${spacerDepth.toFixed(3)}`;
    const washer = new THREE.Mesh(
      cachedGeometry(geometryKey, () => {
        const shape = new THREE.Shape();
        shape.absellipse(0, 0, spacerOuterR, spacerOuterR, 0, Math.PI * 2, false);
        shape.holes.push(circularHole(0, 0, spacerInnerR));
        return new THREE.ExtrudeGeometry(shape, {
          depth: spacerDepth,
          bevelEnabled: false,
        });
      }),
      mat,
    );
    washer.position.set(p.x, p.y, z - spacerDepth / 2);
    washer.castShadow = true;
    tagFabricationMesh(washer, metadata);
    addEdges(washer, geometryKey);
    root.add(washer);
  };
  const addClipCap = (
    point: Point | undefined,
    z: number,
    mat: THREE.Material,
    radiusScale = 1.35,
    metadata?: FoundryFabricationMeshMetadata,
  ) => {
    if (!point) return;
    const p = to3(point, z);
    const clip = new THREE.Mesh(
      cachedGeometry(
        `clip:${holeR.toFixed(3)}:${radiusScale.toFixed(2)}`,
        () => new THREE.CylinderGeometry(holeR * radiusScale, holeR * radiusScale, clipDepth, 24),
      ),
      mat,
    );
    clip.rotation.x = Math.PI / 2;
    clip.position.copy(p);
    clip.position.z = z;
    tagFabricationMesh(clip, metadata);
    root.add(clip);
  };
  const addBar = (
    a: Point | undefined,
    b: Point | undefined,
    z: number,
    mat: THREE.Material,
    holeCount = 2,
    partKey?: string,
    metadata?: FoundryFabricationMeshMetadata,
    exactCapsule?: {
      center?: Point;
      rotation?: number;
      centerlineLengthPx: number;
      radiusPx: number;
    },
  ) => {
    const mappedCenter = exactCapsule?.center;
    const mappedRotation = exactCapsule?.rotation;
    const exactLengthPx = exactCapsule?.centerlineLengthPx;
    const exactRadiusPx = exactCapsule?.radiusPx;
    if (!a || !b) {
      if (!mappedCenter || !exactLengthPx || !exactRadiusPx) return;
    }
    const worldSceneLength = Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
    const hasExactCapsule = Number.isFinite(exactLengthPx ?? Number.NaN) && Number.isFinite(exactRadiusPx ?? Number.NaN) && Number.isFinite(mappedCenter?.x ?? Number.NaN) && Number.isFinite(mappedCenter?.y ?? Number.NaN);
    const sourceSceneLength =
      worldSceneLength / Math.max(0.001, Math.abs(simulationScale));
    const effectiveSceneLength = hasExactCapsule ? exactLengthPx! : worldSceneLength;
    if (effectiveSceneLength <= 0.001) return;
    const linkageSpec = FABRICATION_LINKAGE_SPECS.find((spec) => spec.key === partKey)
      ?? fabricationLinkageSpecForSceneLength(
        sourceSceneLength,
        FABRICATION_LINKAGE_SPECS[0]?.pitchMm,
        holeCount,
      );
    const sourceTemplateSceneLength = Math.max(
      1,
      linkageSpec.lengthMm * SCENE_PX_PER_MM,
    );
    const previewScale = effectiveSceneLength / sourceTemplateSceneLength;
    const templateLen = linkageSpec.lengthMm * mmToThree * previewScale;
    const holeRangeMm = (linkageSpec.holeCentersMm.at(-1)?.x ?? linkageSpec.lengthMm) - (linkageSpec.holeCentersMm[0]?.x ?? 0);
    const holeScalePx = holeRangeMm > 0
      ? effectiveSceneLength / (holeRangeMm * SCENE_PX_PER_MM)
      : previewScale;
    const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
    const holeXs = linkageSpec.holeCentersMm.map(
      (point) =>
        hasExactCapsule
          ? (((point.x - firstHoleX) * SCENE_PX_PER_MM * holeScalePx) - effectiveSceneLength / 2) / 18
          : (point.x - firstHoleX - linkageSpec.lengthMm / 2) * mmToThree * previewScale,
    );
    const outlineLen = hasExactCapsule
      ? (exactLengthPx! + exactRadiusPx! * 2) / 18
      : Math.max(templateLen, effectiveSceneLength * mmToThree);
    const outlineWidth = hasExactCapsule
      ? Math.max(0.0001, exactRadiusPx! * 2 / 18)
      : barW;
    const center = mappedCenter ? to3(mappedCenter, z) : {
      x: (to3(a!, z).x + to3(b!, z).x) / 2,
      y: (to3(a!, z).y + to3(b!, z).y) / 2,
      z,
    };
    const angle = Number.isFinite(mappedRotation ?? NaN)
      ? -mappedRotation!
      : -Math.atan2((b?.y ?? 0) - (a?.y ?? 0), (b?.x ?? 0) - (a?.x ?? 0));
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.z = angle;
    const geometryKey = `bar:${linkageSpec.key}:${linkageSpec.pitchMm}:${outlineLen.toFixed(3)}:${outlineWidth.toFixed(3)}:${thickness.toFixed(3)}:${effectiveSceneLength.toFixed(3)}:${exactRadiusPx?.toFixed(3) ?? 'auto'}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(geometryKey, () => {
        const shape = roundedRectShape(outlineLen, outlineWidth);
        shape.holes.push(...holeXs.map((x) => circularHole(x, 0)));
        return new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          bevelEnabled: false,
        });
      }),
      mat,
    );
    mesh.position.z = -thickness / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    tagFabricationMesh(mesh, metadata);
    addEdges(mesh, geometryKey);
    group.add(mesh);
    holeXs.forEach((x) => addHoleRing(group, x, 0, 0));
    root.add(group);
  };
  const shapeFromPoints = (points: Point[]) => {
    const shape = new THREE.Shape();
    points.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.y);
      else shape.lineTo(point.x, point.y);
    });
    shape.closePath();
    return shape;
  };
  const addGear = (
    center: Point,
    radius: number,
    z: number,
    rotation: number,
    mat: THREE.Material,
    metadata?: FoundryFabricationMeshMetadata,
    outerRadiusPx?: number,
  ) => {
    const r = Math.max(0.38, (radius * simulationScale) / 18);
    const profile = fabricationGearProfileForPitchRadius(r, radius / SCENE_PX_PER_MM);
    const requestedOuterRadiusWorld = Number.isFinite(outerRadiusPx ?? Number.NaN)
      ? (outerRadiusPx! / 18)
      : undefined;
    const gearScale = requestedOuterRadiusWorld
      ? requestedOuterRadiusWorld / Math.max(profile.outerRadius, 0.001)
      : 1;
    const shape = shapeFromPoints(profile.outlinePoints.map(point => ({
      x: point.x * gearScale,
      y: point.y * gearScale,
    })));
    const axleHoleRadius = Math.max(holeR * 0.7, profile.axleHoleRadius * gearScale);
    shape.holes.push(circularHole(0, 0, axleHoleRadius));
    profile.attachmentHoleCenters.forEach((point) =>
      shape.holes.push(
        circularHole(
          point.x * gearScale,
          point.y * gearScale,
          Math.max(holeR * 0.55, profile.axleHoleRadius * gearScale),
        ),
      ),
    );
    const geometryKey = `gear:${mechanism.type}:${radius.toFixed(3)}:${simulationScale.toFixed(3)}:${(outerRadiusPx ?? 0).toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: false,
          }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = (rotation * Math.PI) / 180;
    mesh.castShadow = true;
    tagFabricationMesh(mesh, metadata);
    addEdges(mesh, geometryKey);
    root.add(mesh);
    const holes = new THREE.Group();
    holes.position.set(c.x, c.y, z);
    holes.rotation.z = mesh.rotation.z;
    addHoleRing(holes, 0, 0, 0);
    profile.attachmentHoleCenters.forEach((point) => addHoleRing(holes, point.x * gearScale, point.y * gearScale, 0));
    root.add(holes);
  };
  const addRingGear = (
    center: Point,
    radius: number,
    z: number,
    rotation: number,
    mat: THREE.Material,
    metadata?: FoundryFabricationMeshMetadata,
    outerRadiusPx?: number,
  ) => {
    const r = Math.max(0.82, (radius * simulationScale) / 18);
    const profile = fabricationRingGearProfileForPitchRadius(r);
    const requestedOuterRadiusWorld = Number.isFinite(outerRadiusPx ?? Number.NaN)
      ? (outerRadiusPx! / 18)
      : undefined;
    const ringScale = requestedOuterRadiusWorld
      ? requestedOuterRadiusWorld / Math.max(profile.outerRadius, 0.001)
      : 1;
    const shape = new THREE.Shape();
    shape.absellipse(0, 0,
      profile.outerRadius * ringScale,
      profile.outerRadius * ringScale,
      0,
      Math.PI * 2,
      false);
    const inner = new THREE.Path();
    fabricationRingInnerGearOutlinePoints(r).forEach((point, index) => {
      if (index === 0) inner.moveTo(point.x * ringScale, point.y * ringScale);
      else inner.lineTo(point.x * ringScale, point.y * ringScale);
    });
    inner.closePath();
    shape.holes.push(inner);
    const mountHoleRadius = Math.max(holeR * 0.58, profile.mountHoleRadius * ringScale);
    profile.mountHoleCenters.forEach((point) =>
      shape.holes.push(circularHole(point.x * ringScale, point.y * ringScale, mountHoleRadius)),
    );
    const geometryKey = `ring-gear:${radius.toFixed(3)}:${(outerRadiusPx ?? 0).toFixed(3)}:${simulationScale.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: false,
          }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = (rotation * Math.PI) / 180;
    mesh.castShadow = true;
    tagFabricationMesh(mesh, metadata);
    addEdges(mesh, geometryKey);
    root.add(mesh);
    const holes = new THREE.Group();
    holes.position.set(c.x, c.y, z);
    profile.mountHoleCenters.forEach((point) => addHoleRing(holes, point.x * ringScale, point.y * ringScale, 0));
    root.add(holes);
  };
  const addCam = (
    center: Point,
    z: number,
    rotation: number,
    mat: THREE.Material,
    metadata?: FoundryFabricationMeshMetadata,
    outerRadiusPx?: number,
  ) => {
    const samples = normalizeCamProfileSamples(mechanism.camProfileSamples);
    const pointCount = Math.max(4, samples.length * 4);
    const profile = Array.from({ length: pointCount }, (_, index) =>
      sampledCamProfileScale((index / pointCount) * Math.PI * 2, samples)
    );
    const normalizedMax = Math.max(...profile, 1);
    const mappedRadius = Number.isFinite(outerRadiusPx ?? Number.NaN)
      ? outerRadiusPx! / 18
      : (mechanism.crankLength * simulationScale) / 18;
    const r = Math.max(0.5, mappedRadius);
    const shape = new THREE.Shape();
    for (let i = 0; i < pointCount; i++) {
      const a = (i / pointCount) * Math.PI * 2;
      const rr = (r * sampledCamProfileScale(a, samples)) / normalizedMax;
      const x = Math.cos(a) * rr,
        y = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    shape.holes.push(circularHole(0, 0, holeR * 1.35));
    const geometryKey = `cam:${mechanism.crankLength.toFixed(2)}:${(mechanism.camProfileSamples ?? []).join(",")}:${(outerRadiusPx ?? 0).toFixed(3)}:${simulationScale.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = rotation;
    mesh.castShadow = true;
    tagFabricationMesh(mesh, metadata);
    addEdges(mesh, geometryKey);
    root.add(mesh);
  };
  const addSlotPlate = (
    center: Point,
    z: number,
    mat: THREE.Material,
    rotation = 0,
    length = 3.2,
    metadata?: FoundryFabricationMeshMetadata,
    outerDimensions?: {
      widthPx: number;
      heightPx: number;
    },
  ) => {
    const c = to3(center, z);
    const group = new THREE.Group();
    group.position.copy(c);
    group.rotation.z = rotation;
    const plateLengthWorld = outerDimensions ? outerDimensions.widthPx / 18 : length;
    const plateHeightWorld = outerDimensions ? outerDimensions.heightPx / 18 : barW * 1.35;
    const geometryKey = `slot:${length.toFixed(3)}:${barW.toFixed(3)}:${plateLengthWorld.toFixed(3)}:${plateHeightWorld.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(geometryKey, () => {
        const shape = roundedRectShape(plateLengthWorld, plateHeightWorld, plateHeightWorld * 0.28);
        shape.holes.push(roundedRectShape(plateLengthWorld * 0.7, plateHeightWorld * 0.46, plateHeightWorld * 0.23));
        return new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          bevelEnabled: false,
        });
      }),
      mat,
    );
    mesh.position.z = -thickness / 2;
    mesh.castShadow = true;
    tagFabricationMesh(mesh, metadata);
    addEdges(mesh, geometryKey);
    group.add(mesh);
    root.add(group);
  };
  const addFollowerBlock = (
    center: Point,
    z: number,
    mat: THREE.Material,
    rotation = 0,
    metadata?: FoundryFabricationMeshMetadata,
    outerDimensions?: {
      widthPx: number;
      heightPx: number;
    },
  ) => {
    const c = to3(center, z);
    const group = new THREE.Group();
    group.position.copy(c);
    group.rotation.z = rotation;
    const blockWidth = outerDimensions ? outerDimensions.widthPx / 18 : barW * 1.45;
    const blockHeight = outerDimensions ? outerDimensions.heightPx / 18 : barW * 1.8;
    const blockKey = `follower-block:${barW.toFixed(3)}:${outerDimensions ? `${blockWidth.toFixed(3)}:${blockHeight.toFixed(3)}` : thickness.toFixed(3)}:${thickness.toFixed(3)}`;
    const block = new THREE.Mesh(
      cachedGeometry(blockKey, () => new THREE.BoxGeometry(blockWidth, blockHeight, thickness)),
      mat,
    );
    tagFabricationMesh(block, metadata);
    addEdges(block, blockKey);
    group.add(block);
    const rollerRadius = Math.min(holeR * 1.3, blockWidth * 0.45, blockHeight * 0.45);
    const roller = new THREE.Mesh(
      cachedGeometry(
        `follower-roller:${rollerRadius.toFixed(3)}:${thickness.toFixed(3)}`,
        () => new THREE.CylinderGeometry(rollerRadius, rollerRadius, thickness, 28),
      ),
      material.accent,
    );
    roller.position.set(0, -blockHeight / 2 + rollerRadius, 0);
    roller.rotation.x = Math.PI / 2;
    tagFabricationMesh(roller, metadata);
    group.add(roller);
    root.add(group);
  };
  const addEndStop = (center: Point, offset: number, z: number, metadata?: FoundryFabricationMeshMetadata) => {
    const c = to3(center, z);
    const stopKey = `end-stop:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const stop = new THREE.Mesh(
      cachedGeometry(stopKey, () => new THREE.BoxGeometry(0.22, barW * 1.65, thickness)),
      material.dark,
    );
    stop.position.set(c.x + offset, c.y, z);
    tagFabricationMesh(stop, metadata);
    addEdges(stop, stopKey);
    root.add(stop);
  };
  const addRack = (
    center: Point,
    z: number,
    mat: THREE.Material,
    metadata?: FoundryFabricationMeshMetadata,
    outerDimensions?: {
      center?: Point;
      rotation?: number;
      widthPx: number;
      heightPx: number;
    },
  ) => {
    const exact = outerDimensions !== undefined;
    const rackCenter = outerDimensions?.center ?? center;
    const c = to3(rackCenter, z);
    const group = new THREE.Group();
    group.position.copy(c);
    group.rotation.z = outerDimensions ? -(outerDimensions.rotation ?? 0) : 0;
    const rackHeightWorld = outerDimensions ? outerDimensions.heightPx / 18 : barW;
    const rackWidthWorld = outerDimensions ? outerDimensions.widthPx / 18 : 4.6;
    const rackKey = `rack:${barW.toFixed(3)}:${rackWidthWorld.toFixed(3)}:${rackHeightWorld.toFixed(3)}:${thickness.toFixed(3)}:${exact.toString()}`;
    const rack = new THREE.Mesh(
      cachedGeometry(rackKey, () => new THREE.BoxGeometry(rackWidthWorld, rackHeightWorld, thickness)),
      mat,
    );
    tagFabricationMesh(rack, metadata);
    addEdges(rack, rackKey);
    group.add(rack);

    if (!exact) {
      for (let i = 0; i < 10; i++) {
        const toothKey = `rack-tooth:${thickness.toFixed(3)}`;
        const tooth = new THREE.Mesh(
          cachedGeometry(toothKey, () => new THREE.BoxGeometry(0.22, 0.18, thickness)),
          mat,
        );
        tooth.position.set(-2.1 + i * 0.46, -barW * 0.65, 0);
        tooth.rotation.z = Math.PI / 4;
        tagFabricationMesh(tooth, metadata);
        group.add(tooth);
      }
    }

    root.add(group);
  };
  const addPin = (point: Point, centerZ: number, lengthZ: number, metadata?: FoundryFabricationMeshMetadata) => {
    const p = to3(point, centerZ);
    const pin = new THREE.Mesh(
      cachedGeometry(
        `pin:${holeR.toFixed(3)}:${lengthZ.toFixed(3)}`,
        () =>
          new THREE.CylinderGeometry(
            holeR * 0.8,
            holeR * 0.8,
            lengthZ,
            20,
          ),
      ),
      material.dark,
    );
    pin.rotation.x = Math.PI / 2;
    pin.position.copy(p);
    tagFabricationMesh(pin, metadata);
    root.add(pin);
  };
  const addPath = (points: Point[], z: number, mat: THREE.Material) => {
    if (points.length < 2) return;
    const geom = new THREE.BufferGeometry().setFromPoints(points.map((point) => to3(point, z)));
    const line = new THREE.Line(geom, mat);
    if ("computeLineDistances" in line) line.computeLineDistances();
    root.add(line);
  };

  return {
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
  };
};

export type FoundryThreePrimitiveFactory = ReturnType<
  typeof createFoundryThreePrimitiveFactory
>;

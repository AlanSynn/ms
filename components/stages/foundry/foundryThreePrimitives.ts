import * as THREE from "three";
import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import { sampledCamProfileScale } from "../../../utils/kinematics";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_WIDTH_MM,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_SPACER_SPEC,
  fabricationGearProfileForPitchRadius,
  fabricationLinkageSpecForSceneLength,
  fabricationRingGearProfileForPitchRadius,
  fabricationRingInnerGearOutlinePoints,
} from "../../../utils/fabrication";
import { SCENE_PX_PER_MM } from "../../../utils/coordinates";
import {
  cachedThreeResource,
  disposeThreeObjectGraph,
} from "../../../utils/threeResourceKit";

export const FOUNDRY_CACHE_MARKER = "foundryCached";

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
  const thickness = Math.max(0.2, kit.holeDiameterMm / 10);
  const spacerDepth = Math.max(0.08, FABRICATION_RENDER_MIN_CLEARANCE);
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
  const addSpacerWasher = (point: Point | undefined, z: number, mat: THREE.Material) => {
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
          bevelEnabled: true,
          bevelSize: 0.012,
        });
      }),
      mat,
    );
    washer.position.set(p.x, p.y, z - spacerDepth / 2);
    washer.castShadow = true;
    addEdges(washer, geometryKey);
    root.add(washer);
  };
  const addClipCap = (
    point: Point | undefined,
    z: number,
    mat: THREE.Material,
    radiusScale = 1.35,
  ) => {
    if (!point) return;
    const p = to3(point, z);
    const clip = new THREE.Mesh(
      cachedGeometry(
        `clip:${holeR.toFixed(3)}:${radiusScale.toFixed(2)}`,
        () => new THREE.CylinderGeometry(holeR * radiusScale, holeR * radiusScale, 0.08, 24),
      ),
      mat,
    );
    clip.rotation.x = Math.PI / 2;
    clip.position.copy(p);
    clip.position.z = z;
    root.add(clip);
  };
  const addBar = (
    a: Point | undefined,
    b: Point | undefined,
    z: number,
    mat: THREE.Material,
    holeCount = 2,
  ) => {
    if (!a || !b) return;
    const av = to3(a, z),
      bv = to3(b, z);
    const dx = bv.x - av.x,
      dy = bv.y - av.y,
      len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const sceneLength = Math.hypot(b.x - a.x, b.y - a.y);
    const linkageSpec = fabricationLinkageSpecForSceneLength(
      sceneLength,
      kit.gridPitchMm,
      holeCount,
    );
    const templateLen = linkageSpec.lengthMm * mmToThree;
    const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
    const holeXs = linkageSpec.holeCentersMm.map(
      (point) => (point.x - firstHoleX - linkageSpec.lengthMm / 2) * mmToThree,
    );
    const outlineLen = templateLen + barW;
    const group = new THREE.Group();
    group.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
    group.rotation.z = Math.atan2(dy, dx);
    const geometryKey = `bar:${linkageSpec.key}:${kit.gridPitchMm}:${outlineLen.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(geometryKey, () => {
        const shape = roundedRectShape(outlineLen, barW);
        shape.holes.push(...holeXs.map((x) => circularHole(x, 0)));
        return new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          bevelEnabled: true,
          bevelSize: 0.025,
          bevelThickness: 0.018,
        });
      }),
      mat,
    );
    mesh.position.z = -thickness / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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
  ) => {
    const r = Math.max(0.38, (radius * simulationScale) / 18);
    const profile = fabricationGearProfileForPitchRadius(r, radius / SCENE_PX_PER_MM);
    const shape = shapeFromPoints(profile.outlinePoints);
    const axleHoleRadius = Math.max(holeR * 0.7, profile.axleHoleRadius);
    shape.holes.push(circularHole(0, 0, axleHoleRadius));
    profile.attachmentHoleCenters.forEach((point) =>
      shape.holes.push(circularHole(point.x, point.y, Math.max(holeR * 0.55, profile.axleHoleRadius))),
    );
    const geometryKey = `gear:${mechanism.type}:${radius.toFixed(3)}:${simulationScale.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = (rotation * Math.PI) / 180;
    mesh.castShadow = true;
    addEdges(mesh, geometryKey);
    root.add(mesh);
    const holes = new THREE.Group();
    holes.position.set(c.x, c.y, z);
    holes.rotation.z = mesh.rotation.z;
    addHoleRing(holes, 0, 0, 0);
    profile.attachmentHoleCenters.forEach((point) => addHoleRing(holes, point.x, point.y, 0));
    root.add(holes);
  };
  const addRingGear = (
    center: Point,
    radius: number,
    z: number,
    rotation: number,
    mat: THREE.Material,
  ) => {
    const r = Math.max(0.82, (radius * simulationScale) / 18);
    const profile = fabricationRingGearProfileForPitchRadius(r);
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, profile.outerRadius, profile.outerRadius, 0, Math.PI * 2, false);
    const inner = new THREE.Path();
    fabricationRingInnerGearOutlinePoints(r).forEach((point, index) => {
      if (index === 0) inner.moveTo(point.x, point.y);
      else inner.lineTo(point.x, point.y);
    });
    inner.closePath();
    shape.holes.push(inner);
    const mountHoleRadius = Math.max(holeR * 0.58, profile.mountHoleRadius);
    profile.mountHoleCenters.forEach((point) => shape.holes.push(circularHole(point.x, point.y, mountHoleRadius)));
    const geometryKey = `ring-gear:${radius.toFixed(3)}:${simulationScale.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = (rotation * Math.PI) / 180;
    mesh.castShadow = true;
    addEdges(mesh, geometryKey);
    root.add(mesh);
    const holes = new THREE.Group();
    holes.position.set(c.x, c.y, z);
    profile.mountHoleCenters.forEach((point) => addHoleRing(holes, point.x, point.y, 0));
    root.add(holes);
  };
  const addCam = (center: Point, z: number, rotation: number, mat: THREE.Material) => {
    const r = Math.max(0.5, (mechanism.crankLength * simulationScale) / 22);
    const shape = new THREE.Shape();
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      const rr = r * sampledCamProfileScale(a, mechanism.camProfileSamples);
      const x = Math.cos(a) * rr,
        y = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    shape.holes.push(circularHole(0, 0, holeR * 1.35));
    const geometryKey = `cam:${mechanism.crankLength.toFixed(2)}:${(mechanism.camProfileSamples ?? []).join(",")}:${simulationScale.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(
        geometryKey,
        () => new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025 }),
      ),
      mat,
    );
    const c = to3(center, z);
    mesh.position.set(c.x, c.y, z - thickness / 2);
    mesh.rotation.z = rotation;
    mesh.castShadow = true;
    addEdges(mesh, geometryKey);
    root.add(mesh);
  };
  const addSlotPlate = (
    center: Point,
    length: number,
    rotation: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const c = to3(center, z);
    const group = new THREE.Group();
    group.position.copy(c);
    group.rotation.z = rotation;
    const geometryKey = `slot:${length.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const mesh = new THREE.Mesh(
      cachedGeometry(geometryKey, () => {
        const shape = roundedRectShape(length, barW * 1.35, barW * 0.28);
        shape.holes.push(roundedRectShape(length * 0.7, barW * 0.46, barW * 0.23));
        return new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          bevelEnabled: true,
          bevelSize: 0.02,
          bevelThickness: 0.015,
        });
      }),
      mat,
    );
    mesh.position.z = -thickness / 2;
    mesh.castShadow = true;
    addEdges(mesh, geometryKey);
    group.add(mesh);
    root.add(group);
  };
  const addFollowerBlock = (
    center: Point,
    z: number,
    mat: THREE.Material,
    rotation = 0,
  ) => {
    const c = to3(center, z);
    const group = new THREE.Group();
    group.position.copy(c);
    group.rotation.z = rotation;
    const blockKey = `follower-block:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const block = new THREE.Mesh(
      cachedGeometry(blockKey, () => new THREE.BoxGeometry(barW * 1.45, barW * 1.8, thickness)),
      mat,
    );
    addEdges(block, blockKey);
    group.add(block);
    const roller = new THREE.Mesh(
      cachedGeometry(
        `follower-roller:${holeR.toFixed(3)}:${thickness.toFixed(3)}`,
        () => new THREE.CylinderGeometry(holeR * 1.3, holeR * 1.3, thickness * 1.18, 28),
      ),
      material.accent,
    );
    roller.position.set(0, -barW * 0.74, 0.04);
    roller.rotation.x = Math.PI / 2;
    group.add(roller);
    root.add(group);
  };
  const addEndStop = (center: Point, offset: number, z: number) => {
    const c = to3(center, z);
    const stopKey = `end-stop:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const stop = new THREE.Mesh(
      cachedGeometry(stopKey, () => new THREE.BoxGeometry(0.22, barW * 1.65, thickness * 1.25)),
      material.dark,
    );
    stop.position.set(c.x + offset, c.y, z);
    addEdges(stop, stopKey);
    root.add(stop);
  };
  const addRack = (center: Point, z: number, mat: THREE.Material) => {
    const c = to3(center, z);
    const group = new THREE.Group();
    group.position.copy(c);
    const rackKey = `rack:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
    const rack = new THREE.Mesh(
      cachedGeometry(rackKey, () => new THREE.BoxGeometry(4.6, barW, thickness)),
      mat,
    );
    addEdges(rack, rackKey);
    group.add(rack);
    for (let i = 0; i < 10; i++) {
      const toothKey = `rack-tooth:${thickness.toFixed(3)}`;
      const tooth = new THREE.Mesh(
        cachedGeometry(toothKey, () => new THREE.BoxGeometry(0.22, 0.18, thickness)),
        mat,
      );
      tooth.position.set(-2.1 + i * 0.46, -barW * 0.65, 0.06);
      tooth.rotation.z = Math.PI / 4;
      group.add(tooth);
    }
      root.add(group);
    };
  const addPin = (point: Point, centerZ: number, lengthZ: number) => {
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

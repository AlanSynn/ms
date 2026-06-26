import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BodyPartLayer, CanvasViewport, MechanismConfig, Point, ProjectState, StandardSkeleton } from '../types';
import { boardGridLines, defaultPhysicalKit, sceneBoundsForSheet } from '../utils/coordinates';
import { calculateLinkage } from '../utils/kinematics';

const VIEW_SCALE = 35;
const THICKNESS = 0.22;
type RendererStatus = 'pending' | 'webgl' | 'unavailable';
type LinkKey = 'base' | 'driver' | 'coupler' | 'output' | 'effector';

type MaterialKit = {
  sheet: THREE.MeshStandardMaterial;
  part: THREE.MeshStandardMaterial;
  selected: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
  grid: THREE.LineBasicMaterial;
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

const clearGroup = (group: THREE.Group) => {
  [...group.children].forEach(child => {
    group.remove(child);
    disposeObject(child, false);
  });
};

const disposeMaterials = (materials: MaterialKit | null) => {
  if (!materials) return;
  Object.values(materials).forEach(material => material.dispose());
};

const createMaterials = (): MaterialKit => ({
  sheet: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.5 }),
  part: new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.64, metalness: 0.02, transparent: true, opacity: 0.78 }),
  selected: new THREE.MeshStandardMaterial({ color: '#a78bfa', roughness: 0.58, metalness: 0.04, transparent: true, opacity: 0.82 }),
  edge: new THREE.LineBasicMaterial({ color: '#64748b', transparent: true, opacity: 0.72 }),
  grid: new THREE.LineBasicMaterial({ color: '#dbe4f0', transparent: true, opacity: 0.32 }),
  joint: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 }),
  pin: new THREE.MeshStandardMaterial({ color: '#5a6cff', roughness: 0.42, metalness: 0.05 }),
  bone: new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.6, transparent: true, opacity: 0.68 }),
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

const localJoint = (part: BodyPartLayer, point: Point) => {
  const rotation = -(part.transform.rotation * Math.PI) / 180;
  const dx = point.x - part.transform.x;
  const dy = point.y - part.transform.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: (dx * cos - dy * sin) / Math.max(0.001, part.transform.scale),
    y: (dx * sin + dy * cos) / Math.max(0.001, part.transform.scale)
  };
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
};

const gearShape = (radius: number, teeth = 16) => {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i += 1) {
    const r = i % 2 === 0 ? radius : radius * 0.84;
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  shape.holes.push(holePath(0, 0, Math.max(0.08, radius * 0.16)));
  return shape;
};

const partGeometrySignature = (parts: BodyPartLayer[], project?: ProjectState, skeleton?: StandardSkeleton | null) => [
  parts.map(part => {
    const base = project?.parts[part.id] ?? part;
    return `${base.id}:${base.bounds.width}:${base.bounds.height}:${base.bounds.x}:${base.bounds.y}:${base.visible}`;
  }).join('|'),
  Object.values((project?.skeleton ?? skeleton)?.joints ?? {})
    .map(joint => `${joint.id}:${joint.position.x.toFixed(2)}:${joint.position.y.toFixed(2)}`)
    .join('|')
].join('::');

const mechanismGeometrySignature = (mechanisms: MechanismConfig[]) => mechanisms.map(mechanism => [
  mechanism.id,
  mechanism.type,
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
  const mechanismLinkCount = mechanismsToRender.reduce((sum, mechanism) => {
    const state = calculateLinkage(mechanism, angle);
    return sum + (state.isValid ? 5 : 1);
  }, 0);
  const holeCount = useMemo(() => geometryParts.reduce((sum, part) => {
    const base = project?.parts[part.id] ?? part;
    return sum + Object.values(canonicalSkeleton?.joints ?? {}).filter(joint => {
      const local = localJoint(base, joint.position);
      return Math.abs(local.x) <= base.bounds.width / 2 + 2 && Math.abs(local.y) <= base.bounds.height / 2 + 2;
    }).length;
  }, 0), [canonicalSkeleton, geometryParts, project?.parts]);
  const estimatedObjectCount = boardGridLines(kit).length + 1 + geometryParts.length * 2 + joints.length * 2 + bones.length + mechanismLinkCount * 2 + mechanismsToRender.length * 8;

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

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
      const shape = roundedRect(base.bounds.width / VIEW_SCALE, base.bounds.height / VIEW_SCALE);
      Object.values(canonicalSkeleton?.joints ?? {}).forEach(joint => {
        const local = localJoint(base, joint.position);
        if (Math.abs(local.x) <= base.bounds.width / 2 + 2 && Math.abs(local.y) <= base.bounds.height / 2 + 2) {
          shape.holes.push(holePath(local.x / VIEW_SCALE, local.y / VIEW_SCALE));
        }
      });
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: THICKNESS, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.012 });
      const mesh = new THREE.Mesh(geometry, materials.part);
      mesh.castShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), materials.edge));
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
        [mechanism.crankLength, mechanism.rockerLength].forEach((radius, index) => {
          const mesh = new THREE.Mesh(
            new THREE.ExtrudeGeometry(gearShape(Math.max(0.38, radius / VIEW_SCALE)), { depth: 0.16, bevelEnabled: true, bevelSize: 0.015 }),
            index === 0 ? materials.mechDrive : materials.mechCoupler
          );
          gears.push(mesh);
          group.add(mesh);
        });
      }
      const pins = Array.from({ length: 6 }, () => {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 20), materials.mechPin);
        pin.rotation.x = Math.PI / 2;
        group.add(pin);
        return pin;
      });
      roots.mechanismsLayer.add(group);
      mechanismRefs.current.set(mechanism.id, { links, gears, pins });
    });
    render();
  }, [mechanismSignature, rendererStatus]);

  useEffect(() => {
    if (rendererStatus !== 'webgl') return;
    mechanismsToRender.forEach(mechanism => {
      const visual = mechanismRefs.current.get(mechanism.id);
      if (!visual) return;
      const state = calculateLinkage(mechanism, angle);
      updateLink(visual.links.base, state.p1, state.p2, 0.48);
      updateLink(visual.links.driver, state.p1, state.j1, 0.72);
      updateLink(visual.links.coupler, state.isValid ? state.j1 : undefined, state.isValid ? state.j2 : undefined, 1.02);
      updateLink(visual.links.output, state.isValid ? state.p2 : undefined, state.isValid ? state.j2 : undefined, 0.82);
      updateLink(visual.links.effector, state.isValid ? state.j2 : undefined, state.isValid ? state.effector : undefined, 1.2);
      visual.gears.forEach((gear, index) => {
        const point = index === 0 ? state.p1 : state.p2;
        const p = to3(point, 0.62 + index * 0.18);
        gear.position.set(p.x, p.y, p.z);
        gear.rotation.z = angle * (index === 0 ? 1 : -1);
      });
      [state.p1, state.p2, state.j1, state.j2, state.aux, state.effector].forEach((point, index) => {
        const pin = visual.pins[index];
        if (!pin) return;
        if (!point) {
          pin.visible = false;
          return;
        }
        const p = to3(point, 1.42);
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
      data-puppet-mode="thick-flat-assembly"
      data-joint-placement="skeleton-anchors"
      data-three-rebuild-mode="static-topology-dynamic-transforms"
      data-three-part-count={parts.length}
      data-three-joint-count={joints.length}
      data-three-bone-count={bones.length}
      data-three-part-hole-count={holeCount}
      data-three-mechanism-count={mechanismsToRender.length}
      data-three-mechanism-link-count={mechanismLinkCount}
      data-three-object-count={estimatedObjectCount}
      data-three-scene-object-count={0}
      data-three-render-triangles={0}
      data-thickness-mm={Math.round(THICKNESS * VIEW_SCALE)}
    />
  </div>;
};

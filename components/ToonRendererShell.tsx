import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CameraSessionState, ViewLensState } from '../utils/viewLens';
import type { PhysicsSession } from '../utils/physicsSession';
import type { Point } from '../types';
import type { ProjectionGeometry, ToonMaterial, ToonSceneNode, ToonSceneProjection } from '../utils/sceneProjection';

type ThreeMesh = import('three').Mesh;
type ThreeMaterial = import('three').Material;
type ThreeVector3 = import('three').Vector3;

const MATERIAL_COLORS: Record<ToonMaterial, string> = {
  board: '#f8fafc',
  paper: '#d8dee8',
  acrylic: '#bfdbfe',
  toyMetal: '#6366f1',
  pin: '#334155',
  pathRibbon: '#f472b6',
  ghost: '#94a3b8',
  warning: '#f59e0b'
};

const MATERIAL_OPACITY: Record<ToonMaterial, number> = {
  board: 1,
  paper: 0.96,
  acrylic: 0.62,
  toyMetal: 0.98,
  pin: 1,
  pathRibbon: 0.78,
  ghost: 0.36,
  warning: 1
};

const AXIS_COLORS = {
  x: '#ef4444',
  y: '#10b981',
  z: '#3b82f6'
};

const geometryAnchor = (geometry: ProjectionGeometry) => {
  if (geometry.kind === 'circle' || geometry.kind === 'rect') return geometry.center;
  if (geometry.kind === 'line') return { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 };
  if (!geometry.points.length) return { x: 0, y: 0 };
  const sum = geometry.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / geometry.points.length, y: sum.y / geometry.points.length };
};

const svgPath = (geometry: ProjectionGeometry) => {
  if (geometry.kind === 'polyline') {
    const [first, ...rest] = geometry.points;
    if (!first) return '';
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')}${geometry.closed ? ' Z' : ''}`;
  }
  if (geometry.kind === 'line') return `M ${geometry.from.x.toFixed(2)} ${geometry.from.y.toFixed(2)} L ${geometry.to.x.toFixed(2)} ${geometry.to.y.toFixed(2)}`;
  return '';
};

const projectedNodes = (projection: ToonSceneProjection) => projection.nodes
  .filter(node => node.sourceType !== 'board' || node.id === '/board/sheet' || node.id.startsWith('/board/grid/'))
  .slice(0, 140);

const fallbackDepthOffset = (node: ToonSceneNode) => Math.max(-8, Math.min(18, node.depthMm * 0.65));

const FallbackSvg = ({ projection, physics }: { projection: ToonSceneProjection; physics: PhysicsSession }) => {
  const nodes = projectedNodes(projection);
  return <svg className="toon-fallback-svg" viewBox="-285 -235 570 470" aria-label="SVG CAD-like toon projection fallback">
    <defs>
      <pattern id="toon-fallback-minor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#dbeafe" strokeWidth="0.7" opacity="0.55" />
      </pattern>
      <linearGradient id="fallback-board-fill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#eef4ff" />
      </linearGradient>
      <filter id="toon-fallback-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="10" dy="14" stdDeviation="12" floodColor="#334155" floodOpacity="0.16" />
      </filter>
    </defs>
    <rect x="-278" y="-228" width="556" height="456" rx="28" fill="#f8fbff" stroke="#cbd5e1" />
    <rect x="-250" y="-205" width="500" height="410" rx="24" fill="url(#fallback-board-fill)" stroke="#d8e0ef" />
    <rect x="-250" y="-205" width="500" height="410" rx="24" fill="url(#toon-fallback-minor-grid)" />
    <g data-testid="toon-svg-axes" strokeLinecap="round" strokeLinejoin="round" fontWeight="900" fontSize="11">
      <path data-testid="toon-axis-x" d="M -230 192 L -135 192" stroke={AXIS_COLORS.x} strokeWidth="3" />
      <path data-testid="toon-axis-y" d="M -230 192 L -230 100" stroke={AXIS_COLORS.y} strokeWidth="3" />
      <path data-testid="toon-axis-z" d="M -230 192 L -178 143" stroke={AXIS_COLORS.z} strokeWidth="3" />
      <text x="-128" y="196" fill={AXIS_COLORS.x}>X</text>
      <text x="-236" y="94" fill={AXIS_COLORS.y}>Y</text>
      <text x="-172" y="141" fill={AXIS_COLORS.z}>Z</text>
    </g>
    {nodes.filter(node => node.sourceType !== 'board').map(node => {
      const color = MATERIAL_COLORS[node.material];
      const offset = fallbackDepthOffset(node);
      const shadowTransform = `translate(${offset * 0.55} ${-offset * 0.42})`;
      if (node.geometry.kind === 'rect') return <g key={node.id} filter={node.sourceType === 'part' ? 'url(#toon-fallback-shadow)' : undefined}>
        <rect x={node.geometry.center.x - node.geometry.size.width / 2 + offset * 0.55} y={node.geometry.center.y - node.geometry.size.height / 2 - offset * 0.42} width={node.geometry.size.width} height={node.geometry.size.height} rx="14" fill="#94a3b8" opacity="0.18" transform={`rotate(${node.geometry.rotationRad * 180 / Math.PI} ${node.geometry.center.x} ${node.geometry.center.y})`} />
        <rect x={node.geometry.center.x - node.geometry.size.width / 2} y={node.geometry.center.y - node.geometry.size.height / 2} width={node.geometry.size.width} height={node.geometry.size.height} rx="14" fill={color} opacity={MATERIAL_OPACITY[node.material]} stroke="#475569" strokeWidth="1.4" transform={`rotate(${node.geometry.rotationRad * 180 / Math.PI} ${node.geometry.center.x} ${node.geometry.center.y})`} />
      </g>;
      if (node.geometry.kind === 'circle') return <g key={node.id}>
        <circle cx={node.geometry.center.x + offset * 0.45} cy={node.geometry.center.y - offset * 0.35} r={node.geometry.radius + 1.8} fill="#334155" opacity="0.16" />
        <circle cx={node.geometry.center.x} cy={node.geometry.center.y} r={node.geometry.radius} fill={color} opacity={MATERIAL_OPACITY[node.material]} stroke="#ffffff" strokeWidth="2.4" />
      </g>;
      if (node.geometry.kind === 'line') return <g key={node.id}>
        <path d={svgPath(node.geometry)} transform={shadowTransform} fill="none" stroke="#334155" strokeWidth={node.geometry.width + 2.4} strokeLinecap="round" opacity="0.14" />
        <path d={svgPath(node.geometry)} fill="none" stroke={color} strokeWidth={Math.max(2.6, node.geometry.width)} strokeLinecap="round" strokeLinejoin="round" opacity={MATERIAL_OPACITY[node.material]} />
      </g>;
      return <path key={node.id} d={svgPath(node.geometry)} fill="none" stroke={color} strokeWidth={node.geometry.width} strokeLinecap="round" strokeLinejoin="round" opacity={node.material === 'ghost' ? 0.45 : 0.92} />;
    })}
    {physics.bodies.filter(body => body.sourceType === 'mechanism-state').slice(0, 12).map(body => (
      <g key={body.id} opacity="0.78">
        <line x1={body.position.x} y1={body.position.y} x2={body.position.x + body.velocity.x * 0.016} y2={body.position.y + body.velocity.y * 0.016} stroke="#10b981" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx={body.position.x} cy={body.position.y} r="3.4" fill="#10b981" stroke="#fff" strokeWidth="1.5" />
      </g>
    ))}
  </svg>;
};

export const ToonRendererShell = ({ projection, lens, camera, physics }: {
  projection: ToonSceneProjection;
  lens: ViewLensState;
  camera: CameraSessionState;
  physics: PhysicsSession;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading');
  const sceneKey = useMemo(() => `${projection.nodes.length}:${projection.warnings.length}:${lens}:${camera.presetId}:${camera.locked}:${physics.summary.bodyCount}`, [projection.nodes.length, projection.warnings.length, lens, camera.presetId, camera.locked, physics.summary.bodyCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setStatus('loading');

    if (typeof window !== 'undefined' && (window as Window & { __MECHANIM_FORCE_TOON_FALLBACK__?: boolean }).__MECHANIM_FORCE_TOON_FALLBACK__) {
      setStatus('fallback');
      return;
    }

    import('three').then(THREE => {
      if (disposed || !canvas) return;
      try {
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: Boolean((window as Window & { __MECHANIM_TEST_PRESERVE_WEBGL__?: boolean }).__MECHANIM_TEST_PRESERVE_WEBGL__), powerPreference: 'high-performance' });
        cleanup = () => renderer.dispose();
        const width = Math.max(320, canvas.clientWidth || 520);
        const height = Math.max(240, canvas.clientHeight || 360);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        renderer.setClearColor(0xf8fbff, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();
        cleanup = () => {
          scene.traverse(object => {
            const mesh = object as unknown as { geometry?: { dispose: () => void }; material?: { dispose: () => void } | Array<{ dispose: () => void }> };
            mesh.geometry?.dispose?.();
            if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
            else mesh.material?.dispose?.();
          });
          delete canvas.dataset.toonRenderedObjects;
          delete canvas.dataset.toonRenderedLens;
          renderer.dispose();
        };
        scene.add(new THREE.HemisphereLight(0xffffff, 0xdbeafe, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.1);
        key.position.set(180, -240, 460);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xa78bfa, 0.9);
        rim.position.set(-280, 140, 280);
        scene.add(rim);

        const aspect = width / Math.max(1, height);
        const span = lens === 'toy-stage' || lens === 'assembly' || lens === 'inspect' ? 330 : 290;
        const cam = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, 0.1, 2500);
        cam.position.set(camera.position.x * 0.42, camera.position.y * 0.42, camera.position.zMm);
        cam.zoom = camera.zoom || 1;
        cam.lookAt(camera.lookAt.x, camera.lookAt.y, camera.lookAt.zMm);
        cam.updateProjectionMatrix();

        const materialFor = (node: Pick<ToonSceneNode, 'material' | 'sourceType'>, opacity = MATERIAL_OPACITY[node.material]) => new THREE.MeshToonMaterial({
          color: MATERIAL_COLORS[node.material],
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide
        });
        const lineMaterial = (color: string, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
        const pointAt = (point: Point, z = 0) => new THREE.Vector3(point.x, point.y, z);
        const addLine = (from: ThreeVector3, to: ThreeVector3, color: string, opacity = 0.9) => {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), lineMaterial(color, opacity));
          scene.add(line);
          return line;
        };
        const addEdges = (mesh: ThreeMesh, color = '#334155', opacity = 0.42) => {
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), lineMaterial(color, opacity));
          edges.position.copy(mesh.position);
          edges.rotation.copy(mesh.rotation);
          edges.quaternion.copy(mesh.quaternion);
          edges.scale.copy(mesh.scale);
          scene.add(edges);
          return edges;
        };
        const addRod = (from: Point, to: Point, z: number, radius: number, mat: ThreeMaterial) => {
          const start = pointAt(from, z);
          const end = pointAt(to, z);
          const direction = end.clone().sub(start);
          const rawLength = direction.length();
          const length = Math.max(0.1, rawLength);
          const axis = rawLength > 0.001 ? direction.normalize() : new THREE.Vector3(0, 1, 0);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 18), mat);
          mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
          scene.add(mesh);
          addEdges(mesh, '#1e293b', 0.32);
          return mesh;
        };

        const boardNode = projection.nodes.find(node => node.id === '/board/sheet' && node.geometry.kind === 'rect');
        if (boardNode?.geometry.kind === 'rect') {
          const board = new THREE.Mesh(new THREE.BoxGeometry(boardNode.geometry.size.width, boardNode.geometry.size.height, 5), materialFor({ material: 'board', sourceType: 'board' }, 1));
          board.position.set(boardNode.geometry.center.x, boardNode.geometry.center.y, -10);
          scene.add(board);
          addEdges(board, '#94a3b8', 0.48);
        }

        projectedNodes(projection).filter(node => node.sourceType === 'board' && node.geometry.kind === 'line').forEach(node => {
          if (node.geometry.kind !== 'line') return;
          addLine(pointAt(node.geometry.from, -6), pointAt(node.geometry.to, -6), '#cbd5e1', 0.45);
        });

        addLine(new THREE.Vector3(-235, 205, 0), new THREE.Vector3(-120, 205, 0), AXIS_COLORS.x, 0.95);
        addLine(new THREE.Vector3(-235, 205, 0), new THREE.Vector3(-235, 92, 0), AXIS_COLORS.y, 0.95);
        addLine(new THREE.Vector3(-235, 205, 0), new THREE.Vector3(-190, 160, 82), AXIS_COLORS.z, 0.95);

        projectedNodes(projection).filter(node => node.sourceType !== 'board').forEach(node => {
          const z = node.depthMm + (lens === 'assembly' && node.sourceType === 'part' ? Math.max(12, node.depthMm * 2.2) : 0);
          if (node.geometry.kind === 'rect') {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, node.geometry.size.width), Math.max(1, node.geometry.size.height), Math.max(1.2, node.thicknessMm * 1.35)), materialFor(node));
            mesh.position.set(node.geometry.center.x, node.geometry.center.y, z);
            mesh.rotation.z = node.geometry.rotationRad;
            scene.add(mesh);
            addEdges(mesh, node.sourceType === 'part' ? '#475569' : '#1e293b', node.sourceType === 'part' ? 0.44 : 0.62);
          } else if (node.geometry.kind === 'circle') {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(node.geometry.radius, node.geometry.radius, Math.max(1.4, node.thicknessMm * 1.4), 30), materialFor(node));
            mesh.position.set(node.geometry.center.x, node.geometry.center.y, z + 0.8);
            mesh.rotation.x = Math.PI / 2;
            scene.add(mesh);
            addEdges(mesh, '#ffffff', 0.62);
          } else if (node.geometry.kind === 'line') {
            if (node.sourceType === 'mechanism' || node.sourceType === 'hardware' || node.sourceType === 'bone') {
              addRod(node.geometry.from, node.geometry.to, z, Math.max(1.2, node.geometry.width * 0.55), materialFor(node));
            } else {
              addLine(pointAt(node.geometry.from, z), pointAt(node.geometry.to, z), MATERIAL_COLORS[node.material], MATERIAL_OPACITY[node.material]);
            }
          } else if (node.geometry.points.length) {
            const points = node.geometry.points
              .map(point => pointAt(point, z))
              .filter((point, index, all) => index === 0 || point.distanceTo(all[index - 1]) > 0.5);
            if (node.sourceType === 'path' && points.length > 1) {
              const curve = new THREE.CatmullRomCurve3(points, node.geometry.closed, 'centripetal', 0.35);
              const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(180, Math.max(16, points.length * 3)), Math.max(1.8, node.geometry.width * 0.42), 10, node.geometry.closed), materialFor(node));
              scene.add(tube);
              addEdges(tube, '#831843', 0.22);
            } else {
              const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(MATERIAL_COLORS[node.material], MATERIAL_OPACITY[node.material]));
              scene.add(line);
            }
          }
        });

        physics.bodies.filter(body => body.sourceType === 'mechanism-state').slice(0, 18).forEach(body => {
          const z = 42;
          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          const dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 10), new THREE.MeshToonMaterial({ color: speed > 1 ? 0x10b981 : 0x94a3b8 }));
          dot.position.set(body.position.x, body.position.y, z);
          scene.add(dot);
          if (speed > 0.1) addLine(pointAt(body.position, z), new THREE.Vector3(body.position.x + body.velocity.x * 0.018, body.position.y + body.velocity.y * 0.018, z), '#10b981', 0.75);
        });

        renderer.render(scene, cam);
        canvas.dataset.toonRenderedObjects = String(scene.children.length);
        canvas.dataset.toonRenderedLens = lens;
        setStatus('webgl');
      } catch {
        cleanup?.();
        cleanup = undefined;
        setStatus('fallback');
      }
    }).catch(() => setStatus('fallback'));

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [sceneKey, projection, lens, camera, physics.summary.bodyCount]);

  const viewportMode = camera.locked ? 'locked orthographic' : 'unlocked orbit preview';

  return <div className="toon-renderer-shell" data-testid="toon-renderer-shell" aria-label="CAD-like 2.5D and 3D toon workbench viewport">
    <div className="toon-renderer-head">
      <span>CAD workbench viewport</span>
      <b data-testid="toon-renderer-status">{status === 'webgl' ? 'WebGL active' : status === 'loading' ? 'Loading WebGL' : 'SVG fallback'}</b>
    </div>
    <div className="toon-renderer-frame" data-testid="toon-cad-viewport">
      <canvas ref={canvasRef} data-testid="toon-webgl-canvas" aria-hidden="true" />
      {status !== 'webgl' && <FallbackSvg projection={projection} physics={physics} />}
      <div className="toon-renderer-scene-hud" data-testid="toon-cad-hud">
        <strong>{lens === 'studio' ? '2.5D authoring plane' : VIEWPORT_LABEL[lens] ?? '3D inspection'}</strong>
        <span>{viewportMode} · scene graph preview</span>
      </div>
      <div className="toon-axis-legend" data-testid="toon-axis-legend" aria-label="Viewport XYZ axes">
        <span data-axis="x">X</span><span data-axis="y">Y</span><span data-axis="z">Z depth</span>
      </div>
    </div>
    <div className="toon-renderer-foot">{projection.nodes.length} scene nodes · {physics.summary.constraintCount} constraints · canonical 2D remains unchanged · view-only</div>
  </div>;
};

const VIEWPORT_LABEL: Partial<Record<ViewLensState, string>> = {
  depth: 'Layer depth inspection',
  'toy-stage': '3/4 toy-stage preview',
  assembly: 'Exploded assembly depth',
  physics: 'Physics replay overlay',
  blueprint: 'Blueprint-safe locked view',
  inspect: 'Free inspection camera'
};

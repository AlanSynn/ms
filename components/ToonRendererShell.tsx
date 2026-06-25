import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CameraSessionState, ViewLensState } from '../utils/viewLens';
import type { PhysicsSession } from '../utils/physicsSession';
import type { ProjectionGeometry, ToonMaterial, ToonSceneNode, ToonSceneProjection } from '../utils/sceneProjection';

const MATERIAL_COLORS: Record<ToonMaterial, string> = {
  board: '#f8fafc',
  paper: '#cbd5e1',
  acrylic: '#dbeafe',
  toyMetal: '#8b5cf6',
  pin: '#475569',
  pathRibbon: '#f472b6',
  ghost: '#94a3b8',
  warning: '#f59e0b'
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
  .filter(node => node.sourceType !== 'board' || node.id === '/board/sheet')
  .slice(0, 90);

const FallbackSvg = ({ projection, physics }: { projection: ToonSceneProjection; physics: PhysicsSession }) => {
  const nodes = projectedNodes(projection);
  return <svg className="toon-fallback-svg" viewBox="-260 -230 520 460" aria-label="SVG toon projection fallback">
    <rect x="-250" y="-220" width="500" height="440" rx="24" fill="#ffffff" stroke="#dbe3f1" />
    {nodes.map(node => {
      const color = MATERIAL_COLORS[node.material];
      if (node.geometry.kind === 'rect') return <rect key={node.id} x={node.geometry.center.x - node.geometry.size.width / 2} y={node.geometry.center.y - node.geometry.size.height / 2} width={node.geometry.size.width} height={node.geometry.size.height} rx="14" fill={color} opacity={node.material === 'paper' ? 0.72 : 0.5} stroke="#64748b" strokeWidth="1" transform={`rotate(${node.geometry.rotationRad * 180 / Math.PI} ${node.geometry.center.x} ${node.geometry.center.y})`} />;
      if (node.geometry.kind === 'circle') return <circle key={node.id} cx={node.geometry.center.x} cy={node.geometry.center.y} r={node.geometry.radius} fill={color} stroke="#ffffff" strokeWidth="2" />;
      return <path key={node.id} d={svgPath(node.geometry)} fill="none" stroke={color} strokeWidth={node.geometry.width} strokeLinecap="round" strokeLinejoin="round" opacity={node.material === 'ghost' ? 0.45 : 0.85} />;
    })}
    {physics.bodies.filter(body => body.sourceType === 'mechanism-state').slice(0, 12).map(body => (
      <g key={body.id} opacity="0.7">
        <line x1={body.position.x} y1={body.position.y} x2={body.position.x + body.velocity.x * 0.016} y2={body.position.y + body.velocity.y * 0.016} stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
        <circle cx={body.position.x} cy={body.position.y} r="3" fill="#10b981" />
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

    import('three').then(THREE => {
      if (disposed || !canvas) return;
      try {
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        const width = canvas.clientWidth || 280;
        const height = canvas.clientHeight || 170;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 1.8);
        key.position.set(80, -120, 260);
        scene.add(key);
        const aspect = width / Math.max(1, height);
        const span = lens === 'toy-stage' || lens === 'assembly' ? 320 : 270;
        const cam = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, 0.1, 2000);
        cam.position.set(camera.position.x * 0.35, camera.position.y * 0.35, camera.position.zMm);
        cam.zoom = camera.zoom || 1;
        cam.lookAt(camera.lookAt.x, camera.lookAt.y, camera.lookAt.zMm);
        cam.updateProjectionMatrix();
        const materialFor = (node: ToonSceneNode) => new THREE.MeshToonMaterial({ color: MATERIAL_COLORS[node.material], transparent: true, opacity: node.sourceType === 'part' ? 0.74 : 0.92, side: THREE.DoubleSide });
        projectedNodes(projection).forEach(node => {
          const z = node.depthMm + (lens === 'assembly' && node.sourceType === 'part' ? node.depthMm * 1.8 : 0);
          if (node.geometry.kind === 'rect') {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, node.geometry.size.width), Math.max(1, node.geometry.size.height), Math.max(0.4, node.thicknessMm)), materialFor(node));
            mesh.position.set(node.geometry.center.x, node.geometry.center.y, z);
            mesh.rotation.z = node.geometry.rotationRad;
            scene.add(mesh);
          } else if (node.geometry.kind === 'circle') {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(node.geometry.radius, node.geometry.radius, Math.max(0.8, node.thicknessMm), 24), materialFor(node));
            mesh.position.set(node.geometry.center.x, node.geometry.center.y, z);
            mesh.rotation.x = Math.PI / 2;
            scene.add(mesh);
          } else if (node.geometry.kind === 'line') {
            const points = [new THREE.Vector3(node.geometry.from.x, node.geometry.from.y, z), new THREE.Vector3(node.geometry.to.x, node.geometry.to.y, z)];
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: MATERIAL_COLORS[node.material], transparent: true, opacity: 0.88 }));
            scene.add(line);
          } else if (node.geometry.points.length) {
            const points = node.geometry.points.map(point => new THREE.Vector3(point.x, point.y, z));
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: MATERIAL_COLORS[node.material], transparent: true, opacity: 0.9 }));
            scene.add(line);
          }
        });
        renderer.render(scene, cam);
        setStatus('webgl');
        cleanup = () => {
          scene.traverse(object => {
            const mesh = object as unknown as { geometry?: { dispose: () => void }; material?: { dispose: () => void } | Array<{ dispose: () => void }> };
            mesh.geometry?.dispose?.();
            if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
            else mesh.material?.dispose?.();
          });
          renderer.dispose();
        };
      } catch {
        setStatus('fallback');
      }
    }).catch(() => setStatus('fallback'));

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [sceneKey, projection, lens, camera, physics.summary.bodyCount]);

  return <div className="toon-renderer-shell" data-testid="toon-renderer-shell" aria-label="Lazy toon renderer shell">
    <div className="toon-renderer-head">
      <span>Toon sidecar</span>
      <b data-testid="toon-renderer-status">{status === 'webgl' ? 'WebGL active' : status === 'loading' ? 'Loading WebGL' : 'SVG fallback'}</b>
    </div>
    <div className="toon-renderer-frame">
      <canvas ref={canvasRef} aria-hidden="true" />
      {status !== 'webgl' && <FallbackSvg projection={projection} physics={physics} />}
    </div>
    <div className="toon-renderer-foot">{projection.nodes.length} nodes · {physics.summary.constraintCount} constraints · view-only</div>
  </div>;
};

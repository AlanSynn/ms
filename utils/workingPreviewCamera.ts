import * as THREE from 'three';
import type { FoundryCamera } from './foundryCamera';
import type { CanvasViewport } from '../types';
import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from './viewport';

export type WorkingPreviewFit = { id: number; scope: 'content' | 'scene' };
export type WorkingPreviewFrame = { left: number; right: number; top: number; bottom: number };

// Camera framing is the only reader of these rectangles; no observer or frame loop.
export const workingPreviewFrame = (host: HTMLElement): WorkingPreviewFrame => {
  const rect = host.getBoundingClientRect();
  let top = rect.top + 12, bottom = rect.bottom - 12;
  const root = host.closest('.canvas-workspace');
  const overlays = Array.from(root?.querySelectorAll<HTMLElement>(
    '.foundry-camera-hud, .three-puppet-view-toolbar, [aria-label="Project framing"]',
  ) ?? []);
  const player = host.ownerDocument.querySelector<HTMLElement>('[data-testid="workspace-player-dock"]');
  if (player) overlays.push(player);
  for (const overlay of overlays) {
    const box = overlay.getBoundingClientRect();
    if (!box.width || !box.height || box.right <= rect.left || box.left >= rect.right || box.bottom <= rect.top || box.top >= rect.bottom) continue;
    if ((box.top + box.bottom) / 2 < (rect.top + rect.bottom) / 2) top = Math.max(top, box.bottom + 10);
    else bottom = Math.min(bottom, box.top - 10);
  }
  if (bottom - top < 80) { top = rect.top + 12; bottom = rect.bottom - 12; }
  return { left: -0.94, right: 0.94,
    top: 1 - 2 * (top - rect.top) / Math.max(1, rect.height),
    bottom: 1 - 2 * (bottom - rect.top) / Math.max(1, rect.height) };
};

const projectionWindow = (frame?: WorkingPreviewFrame) => {
  const area = frame ?? { left: -.8, right: .8, top: .8, bottom: -.8 };
  return { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2,
    halfWidth: (area.right - area.left) * .45, halfHeight: (area.top - area.bottom) * .45 };
};

// Called only for a requested fit, after the renderer has settled its real scene.
// Invisible meshes and retained pool objects must not expand the view.
export const visibleObjectBounds = (root: THREE.Object3D): THREE.Box3 => {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  root.traverseVisible((object) => {
    if (object instanceof THREE.InstancedMesh) {
      object.computeBoundingBox();
      if (object.boundingBox) bounds.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));
      return;
    }
    const geometry = (object as THREE.Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      bounds.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
};

export const clampWorkingPreviewZoom = (zoom: number) =>
  Math.max(0.05, Math.min(2.4, zoom));

export const fitWorkingPreviewCamera = (
  camera: FoundryCamera,
  bounds: THREE.Box3,
  aspect: number,
  frame?: WorkingPreviewFrame,
): FoundryCamera => {
  if (bounds.isEmpty()) return camera;
  const center = bounds.getCenter(new THREE.Vector3());
  const yaw = THREE.MathUtils.degToRad(camera.yaw);
  const pitch = THREE.MathUtils.degToRad(camera.pitch);
  const eye = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3().crossVectors(eye, right);
  const area = projectionWindow(frame);
  const vertical = Math.tan(THREE.MathUtils.degToRad(38 / 2));
  const horizontal = vertical * Math.max(0.1, aspect);
  let distance = 17 / 2.4;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).sub(center);
        const depth = point.dot(eye);
        distance = Math.max(distance, depth + Math.abs(point.dot(right) / horizontal + area.x * depth) / area.halfWidth,
          depth + Math.abs(point.dot(up) / vertical + area.y * depth) / area.halfHeight);
      }
    }
  }
  const target = center.clone().addScaledVector(right, -area.x * distance * horizontal)
    .addScaledVector(up, -area.y * distance * vertical);
  return { ...camera, pan: { x: target.x, y: target.y }, targetZ: target.z, zoom: clampWorkingPreviewZoom(17 / distance) };
};

export const fitPuppetViewport = (
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  viewport: CanvasViewport,
  viewScale: number,
  frame?: WorkingPreviewFrame,
): CanvasViewport => {
  if (bounds.isEmpty()) return viewport;
  const fitted = camera.clone();
  const center = bounds.getCenter(new THREE.Vector3());
  const area = projectionWindow(frame);
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const horizontal = vertical * Math.max(0.1, camera.aspect);
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const target = new THREE.Vector3(0, 0, .1);
  const candidate = (zoom: number) => {
    fitted.position.copy(camera.position).multiplyScalar(viewport.zoom / zoom);
    fitted.lookAt(target);
    fitted.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(fitted.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(fitted.matrixWorld, 1);
    const eye = new THREE.Vector3().setFromMatrixColumn(fitted.matrixWorld, 2);
    const distance = fitted.position.distanceTo(target), relative = center.clone().sub(target);
    const a = right.x + area.x * horizontal * eye.x, b = right.y + area.x * horizontal * eye.y;
    const c = up.x + area.y * vertical * eye.x, d = up.y + area.y * vertical * eye.y;
    const x = area.x * horizontal * (distance - relative.dot(eye)) - relative.dot(right);
    const y = area.y * vertical * (distance - relative.dot(eye)) - relative.dot(up);
    const determinant = a * d - b * c;
    const shift = Math.abs(determinant) < 1e-5 ? new THREE.Vector3(-center.x, -center.y, 0)
      : new THREE.Vector3((x * d - b * y) / determinant, (a * y - x * c) / determinant, 0);
    const fits = corners.every(point => {
      const projected = point.clone().add(shift).project(fitted);
      return Math.abs(projected.x - area.x) <= area.halfWidth && Math.abs(projected.y - area.y) <= area.halfHeight && projected.z < 1;
    });
    return { shift, fits };
  };
  let lower = MIN_CANVAS_ZOOM, upper = MAX_CANVAS_ZOOM;
  for (let step = 0; step < 28; step++) {
    const middle = (lower + upper) / 2;
    if (candidate(middle).fits) lower = middle; else upper = middle;
  }
  const { shift } = candidate(lower);
  return {
    offset: { x: viewport.offset.x + shift.x * viewScale, y: viewport.offset.y + shift.y * viewScale }, zoom: lower,
  };
};

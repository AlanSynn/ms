import * as THREE from "three";
import type { Point } from "../types";
import {
  VIEWER3D_CAMERA_PRESETS,
  type Viewer3DCameraPreset,
} from "./viewer3d";

export type FoundryViewPreset = Viewer3DCameraPreset | "side" | "custom";

export type FoundryCamera = {
  yaw: number;
  pitch: number;
  zoom: number;
  preset: FoundryViewPreset;
  pan: Point;
};

export type FoundryCameraPreset = {
  label: string;
  yaw: number;
  pitch: number;
  zoom: number;
};

export type FoundryOverlaySize = { width: number; height: number };

const foundryPreset = (
  preset: Viewer3DCameraPreset,
): FoundryCameraPreset => ({
  label: VIEWER3D_CAMERA_PRESETS[preset].foundryLabel,
  ...VIEWER3D_CAMERA_PRESETS[preset].foundry,
});

export const FOUNDRY_VIEW_PRESETS: Record<
  Exclude<FoundryViewPreset, "custom">,
  FoundryCameraPreset
> = {
  front: foundryPreset("front"),
  iso: foundryPreset("iso"),
  side: { label: "Side", yaw: 64, pitch: 12, zoom: 0.86 },
  top: foundryPreset("top"),
};

export const FOUNDRY_OVERLAY_SIZE: FoundryOverlaySize = {
  width: 360,
  height: 240,
};

export const FOUNDRY_ANIMATION_COMMIT_MS = 1000 / 30;

export const clampFoundryPitch = (value: number) =>
  Math.max(-64, Math.min(68, value));

export const clampFoundryZoom = (value: number) =>
  Math.max(0.45, Math.min(2.4, value));

export const degToRad = (deg: number) => (deg * Math.PI) / 180;

export const foundryCameraDistance = (camera: FoundryCamera) =>
  17 / clampFoundryZoom(camera.zoom);

const FOUNDRY_CAMERA_TARGET_Z = 0.25;

export const foundryCameraTarget = (camera: FoundryCamera) =>
  new THREE.Vector3(
    camera.pan?.x ?? 0,
    camera.pan?.y ?? 0,
    FOUNDRY_CAMERA_TARGET_Z,
  );

export const foundryCameraPosition = (camera: FoundryCamera) => {
  const { yaw, pitch } = camera;
  const distance = foundryCameraDistance(camera);
  const yawRad = degToRad(yaw);
  const pitchRad = degToRad(pitch);
  const target = foundryCameraTarget(camera);
  return target
    .clone()
    .add(
      new THREE.Vector3(
        Math.sin(yawRad) * Math.cos(pitchRad) * distance,
        Math.sin(pitchRad) * distance,
        Math.cos(yawRad) * Math.cos(pitchRad) * distance,
      ),
    );
};

export const projectFoundryOverlayPoint = (
  point: Point | undefined,
  camera: FoundryCamera,
  size: FoundryOverlaySize = FOUNDRY_OVERLAY_SIZE,
  z = 0,
): Point | undefined => {
  if (!point) return undefined;
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  cam.position.copy(foundryCameraPosition(camera));
  cam.lookAt(foundryCameraTarget(camera));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const projected = new THREE.Vector3(
    (point.x - 180) / 18,
    (120 - point.y) / 18,
    z,
  ).project(cam);
  return {
    x: ((projected.x + 1) / 2) * width,
    y: ((1 - projected.y) / 2) * height,
  };
};

/** Keep a projected pointer affordance inside the clipped overlay surface. */
export const clampFoundryOverlayPoint = (
  point: Point | undefined,
  size: FoundryOverlaySize = FOUNDRY_OVERLAY_SIZE,
  padding = 12,
): Point | undefined => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    return undefined;
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const inset = Math.min(
    Math.max(0, Number.isFinite(padding) ? padding : 0),
    Math.min(width, height) / 2,
  );
  return {
    x: Math.min(width - inset, Math.max(inset, point.x)),
    y: Math.min(height - inset, Math.max(inset, point.y)),
  };
};

export const unprojectFoundryOverlayPoint = (
  point: Point,
  camera: FoundryCamera,
  size: FoundryOverlaySize = FOUNDRY_OVERLAY_SIZE,
  z = 0,
): Point | undefined => {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  cam.position.copy(foundryCameraPosition(camera));
  cam.lookAt(foundryCameraTarget(camera));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const ndc = new THREE.Vector2(
    (point.x / width) * 2 - 1,
    1 - (point.y / height) * 2,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, cam);
  const dz = ray.ray.direction.z;
  if (!Number.isFinite(dz) || Math.abs(dz) < 1e-5) return undefined;
  const t = (z - ray.ray.origin.z) / dz;
  if (!Number.isFinite(t)) return undefined;
  const hit = ray.ray.origin
    .clone()
    .add(ray.ray.direction.clone().multiplyScalar(t));
  return { x: hit.x * 18 + 180, y: 120 - hit.y * 18 };
};

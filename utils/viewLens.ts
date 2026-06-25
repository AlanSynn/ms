import type { Point } from '../types';
import type { CameraPreset, ToonSceneProjection } from './sceneProjection';

export type ViewLensState = 'studio' | 'depth' | 'toy-stage' | 'assembly' | 'physics' | 'blueprint' | 'inspect';
export type CameraPresetId = CameraPreset['id'];

export interface CameraSessionState {
  presetId: CameraPresetId;
  label: CameraPreset['label'];
  locked: boolean;
  orbitEnabled: boolean;
  position: { x: number; y: number; zMm: number };
  lookAt: { x: number; y: number; zMm: number };
  zoom: number;
  pan: Point;
  mode: 'locked' | 'unlocked-preview';
}

export const VIEW_LENS_LABELS: Record<ViewLensState, string> = {
  studio: '2.5D Locked',
  depth: 'Depth Inspect',
  'toy-stage': 'Toy Stage',
  assembly: 'Exploded Assembly',
  physics: 'Physics',
  blueprint: 'Blueprint',
  inspect: 'Inspect'
};

export const VIEW_LENS_TO_CAMERA: Record<ViewLensState, CameraPresetId> = {
  studio: 'locked-2.5d',
  depth: 'depth-inspect',
  'toy-stage': 'toy-stage',
  assembly: 'assembly-exploded',
  physics: 'depth-inspect',
  blueprint: 'locked-2.5d',
  inspect: 'inspect-free'
};

const fallbackCamera: CameraPreset = {
  id: 'locked-2.5d',
  label: '2.5D Locked',
  locked: true,
  orbitEnabled: false,
  position: { x: 0, y: 0, zMm: 500 },
  lookAt: { x: 0, y: 0, zMm: 0 },
  zoom: 1
};

const cloneCamera = (camera: CameraPreset): CameraSessionState => ({
  presetId: camera.id,
  label: camera.label,
  locked: camera.locked,
  orbitEnabled: camera.orbitEnabled,
  position: { ...camera.position },
  lookAt: { ...camera.lookAt },
  zoom: camera.zoom,
  pan: { x: 0, y: 0 },
  mode: camera.locked ? 'locked' : 'unlocked-preview'
});

export const cameraForLens = (projection: ToonSceneProjection, lens: ViewLensState): CameraSessionState => {
  const presetId = VIEW_LENS_TO_CAMERA[lens];
  return cloneCamera(projection.cameras.find(camera => camera.id === presetId) ?? fallbackCamera);
};

export const lockCameraToStudio = (projection: ToonSceneProjection): CameraSessionState => cameraForLens(projection, 'studio');

export const unlockCameraPreview = (projection: ToonSceneProjection): CameraSessionState => {
  const session = cameraForLens(projection, 'toy-stage');
  return { ...session, locked: false, orbitEnabled: true, mode: 'unlocked-preview' };
};

export const resetCameraForLens = (projection: ToonSceneProjection, lens: ViewLensState): CameraSessionState => cameraForLens(projection, lens);

export const cameraSessionIsViewOnly = (session: CameraSessionState) => Boolean(session.presetId && Number.isFinite(session.zoom));

export type Viewer3DCameraPreset = 'front' | 'top' | 'iso';
export type Viewer3DMode = '2d' | '3d';

export type Viewer3DCameraConfig = {
  label: string;
  foundryLabel: string;
  mode: Viewer3DMode;
  position: [number, number, number];
  up: [number, number, number];
  distance: number;
  foundry: { yaw: number; pitch: number; zoom: number };
};

export const VIEWER3D_CONTRACT_VERSION = 'shared-viewer3d:v1';

export const VIEWER3D_CAMERA_PRESETS: Record<Viewer3DCameraPreset, Viewer3DCameraConfig> = {
  front: {
    label: '2D',
    foundryLabel: 'Front',
    mode: '2d',
    position: [0, 0, 1],
    up: [0, 1, 0],
    distance: 24,
    foundry: { yaw: 0, pitch: 0, zoom: 0.86 }
  },
  top: {
    label: 'Top',
    foundryLabel: 'Top',
    mode: '3d',
    position: [0, -1, 0.08],
    up: [0, 0, 1],
    distance: 14,
    foundry: { yaw: 0, pitch: 62, zoom: 0.8 }
  },
  iso: {
    label: '3D',
    foundryLabel: 'Isometric',
    mode: '3d',
    position: [0.62, -0.86, 0.72],
    up: [0, 0, 1],
    distance: 15,
    foundry: { yaw: -32, pitch: 24, zoom: 0.82 }
  }
};

export type Viewer3DLayerKey = 'grid' | 'character' | 'skeleton' | 'mechanisms' | 'paths' | 'forces' | 'velocity' | 'trail';
export type Viewer3DLayerVisibility = Partial<Record<Viewer3DLayerKey, boolean>>;
export type Viewer3DLayerState = boolean | 'external' | 'absent';
export type Viewer3DTabKey = 'project' | 'character' | 'path' | 'foundry' | 'design' | 'blueprint' | 'assembly';

export type Viewer3DContract = {
  version: typeof VIEWER3D_CONTRACT_VERSION;
  tab: Viewer3DTabKey;
  cameraPreset: Viewer3DCameraPreset | 'side' | 'custom';
  mode: Viewer3DMode | 'custom';
  layers: Partial<Record<Viewer3DLayerKey, Viewer3DLayerState>>;
};

export const VIEWER3D_LAYER_KEYS: Viewer3DLayerKey[] = ['grid', 'character', 'skeleton', 'mechanisms', 'paths', 'forces', 'velocity', 'trail'];

export const DEFAULT_PUPPET_VIEWER_LAYERS: Required<Pick<Viewer3DLayerVisibility, 'grid' | 'character' | 'skeleton' | 'mechanisms'>> = {
  grid: true,
  character: true,
  skeleton: true,
  mechanisms: true
};

export const viewer3DLayerDataValue = (
  value: Viewer3DLayerState | undefined,
  unsupported: 'absent' | 'external' = 'absent',
) => (
  typeof value === 'boolean' ? (value ? 'shown' : 'hidden') : value ?? unsupported
);

export const createViewer3DContract = (
  tab: Viewer3DTabKey,
  cameraPreset: Viewer3DContract['cameraPreset'],
  layers: Viewer3DContract['layers'],
  mode: Viewer3DContract['mode'] = cameraPreset === 'custom'
    ? 'custom'
    : cameraPreset === 'front'
      ? VIEWER3D_CAMERA_PRESETS.front.mode
      : '3d'
): Viewer3DContract => ({
  version: VIEWER3D_CONTRACT_VERSION,
  tab,
  cameraPreset,
  mode,
  layers
});

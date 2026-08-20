import type { AppSettings } from '../types';

export type RenderPerformancePreset = AppSettings['performancePreset'];

export type RenderOverlayQuality = 'reduced' | 'balanced' | 'full';

export interface RepeatedGeometryPolicy {
  readonly strategy: 'pool-and-instance';
  readonly instancingThreshold: number;
  readonly maxPoolEntries: number;
  readonly maxGeometryCacheEntries: number;
  readonly maxMaterialCacheEntries: number;
}

export interface PartTopologyPolicy {
  readonly bevelEnabled: boolean;
  readonly edgeGeometryEnabled: boolean;
  readonly curveSegments: number;
}

export interface InteractiveDetailPolicy {
  readonly mechanismTraceSamples: number;
  readonly maxPathLinePoints: number;
  readonly maxPathHandles: number;
  readonly overlayPointStride: number;
  readonly maxMediaEdgePx: number;
  readonly maxMediaFrames: number;
  readonly maxMediaFramesPerSecond: number;
}

export interface RenderPerformancePolicy {
  readonly preset: RenderPerformancePreset;
  readonly pixelRatioCap: number;
  readonly antialias: boolean;
  readonly targetFramesPerSecond: number;
  readonly minRenderIntervalMs: number;
  readonly overlayQuality: RenderOverlayQuality;
  readonly minOverlayIntervalMs: number;
  readonly partTopology: PartTopologyPolicy;
  readonly interactiveDetail: InteractiveDetailPolicy;
  readonly repeatedGeometry: RepeatedGeometryPolicy;
}

const definePolicy = (
  policy: Omit<RenderPerformancePolicy, 'minRenderIntervalMs'>,
): RenderPerformancePolicy => Object.freeze({
  ...policy,
  minRenderIntervalMs: 1000 / policy.targetFramesPerSecond,
  partTopology: Object.freeze(policy.partTopology),
  interactiveDetail: Object.freeze(policy.interactiveDetail),
  repeatedGeometry: Object.freeze(policy.repeatedGeometry),
});

const RENDER_PERFORMANCE_POLICIES: Readonly<Record<RenderPerformancePreset, RenderPerformancePolicy>> = Object.freeze({
  fast: definePolicy({
    preset: 'fast',
    pixelRatioCap: 0.75,
    antialias: false,
    targetFramesPerSecond: 20,
    overlayQuality: 'reduced',
    minOverlayIntervalMs: 1000 / 12,
    partTopology: {
      bevelEnabled: false,
      edgeGeometryEnabled: false,
      curveSegments: 2,
    },
    interactiveDetail: {
      mechanismTraceSamples: 32,
      maxPathLinePoints: 128,
      maxPathHandles: 48,
      overlayPointStride: 4,
      maxMediaEdgePx: 720,
      maxMediaFrames: 180,
      maxMediaFramesPerSecond: 20,
    },
    repeatedGeometry: {
      strategy: 'pool-and-instance',
      instancingThreshold: 2,
      maxPoolEntries: 128,
      maxGeometryCacheEntries: 24,
      maxMaterialCacheEntries: 16,
    },
  }),
  balanced: definePolicy({
    preset: 'balanced',
    pixelRatioCap: 0.75,
    antialias: false,
    targetFramesPerSecond: 30,
    overlayQuality: 'balanced',
    minOverlayIntervalMs: 1000 / 20,
    partTopology: {
      bevelEnabled: false,
      edgeGeometryEnabled: false,
      curveSegments: 2,
    },
    interactiveDetail: {
      mechanismTraceSamples: 40,
      maxPathLinePoints: 192,
      maxPathHandles: 64,
      overlayPointStride: 3,
      maxMediaEdgePx: 900,
      maxMediaFrames: 240,
      maxMediaFramesPerSecond: 24,
    },
    repeatedGeometry: {
      strategy: 'pool-and-instance',
      instancingThreshold: 2,
      maxPoolEntries: 192,
      maxGeometryCacheEntries: 40,
      maxMaterialCacheEntries: 20,
    },
  }),
  high: definePolicy({
    preset: 'high',
    pixelRatioCap: 1.5,
    antialias: true,
    targetFramesPerSecond: 60,
    overlayQuality: 'full',
    minOverlayIntervalMs: 1000 / 30,
    partTopology: {
      bevelEnabled: true,
      edgeGeometryEnabled: true,
      curveSegments: 6,
    },
    interactiveDetail: {
      mechanismTraceSamples: 96,
      maxPathLinePoints: 1000,
      maxPathHandles: 1000,
      overlayPointStride: 1,
      maxMediaEdgePx: 1280,
      maxMediaFrames: 600,
      maxMediaFramesPerSecond: 30,
    },
    repeatedGeometry: {
      strategy: 'pool-and-instance',
      instancingThreshold: 2,
      maxPoolEntries: 512,
      maxGeometryCacheEntries: 96,
      maxMaterialCacheEntries: 48,
    },
  }),
});

export const resolveRenderPerformancePolicy = (
  preset: RenderPerformancePreset,
): RenderPerformancePolicy => RENDER_PERFORMANCE_POLICIES[preset];

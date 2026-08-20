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

export interface RenderPerformancePolicy {
  readonly preset: RenderPerformancePreset;
  readonly pixelRatioCap: number;
  readonly antialias: boolean;
  readonly targetFramesPerSecond: number;
  readonly minRenderIntervalMs: number;
  readonly overlayQuality: RenderOverlayQuality;
  readonly minOverlayIntervalMs: number;
  readonly partTopology: PartTopologyPolicy;
  readonly repeatedGeometry: RepeatedGeometryPolicy;
}

const definePolicy = (
  policy: Omit<RenderPerformancePolicy, 'minRenderIntervalMs'>,
): RenderPerformancePolicy => Object.freeze({
  ...policy,
  minRenderIntervalMs: 1000 / policy.targetFramesPerSecond,
  partTopology: Object.freeze(policy.partTopology),
  repeatedGeometry: Object.freeze(policy.repeatedGeometry),
});

const RENDER_PERFORMANCE_POLICIES: Readonly<Record<RenderPerformancePreset, RenderPerformancePolicy>> = Object.freeze({
  fast: definePolicy({
    preset: 'fast',
    pixelRatioCap: 1,
    antialias: false,
    targetFramesPerSecond: 20,
    overlayQuality: 'reduced',
    minOverlayIntervalMs: 1000 / 12,
    partTopology: {
      bevelEnabled: false,
      edgeGeometryEnabled: false,
      curveSegments: 2,
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
    pixelRatioCap: 1,
    antialias: false,
    targetFramesPerSecond: 30,
    overlayQuality: 'balanced',
    minOverlayIntervalMs: 1000 / 20,
    partTopology: {
      bevelEnabled: false,
      edgeGeometryEnabled: false,
      curveSegments: 3,
    },
    repeatedGeometry: {
      strategy: 'pool-and-instance',
      instancingThreshold: 2,
      maxPoolEntries: 256,
      maxGeometryCacheEntries: 48,
      maxMaterialCacheEntries: 24,
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

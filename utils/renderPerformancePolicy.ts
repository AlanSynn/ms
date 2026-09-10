import type { AppSettings } from '../types';

export type RenderPerformancePreset = AppSettings['performancePreset'];

export type RenderOverlayQuality = 'reduced' | 'balanced' | 'full';

// Bound the drawing-buffer area independently of CSS viewport size and DPR.
// Four million pixels keeps the high-resolution classroom viewport at native
// DPR 2 while avoiding desktop-sized backing stores on memory-limited GPUs.
export const RENDER_VIEWPORT_PIXEL_BUDGET = 4_000_000;

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

export type EffectiveRenderPixelRatioInput = {
  readonly policy: Pick<RenderPerformancePolicy, 'pixelRatioCap'>;
  readonly devicePixelRatio: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly maxRenderbufferDimension: number;
};

const positiveFinite = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export const effectiveRenderPixelRatio = ({
  policy,
  devicePixelRatio,
  viewportWidth,
  viewportHeight,
  maxRenderbufferDimension,
}: EffectiveRenderPixelRatioInput): number => {
  const width = positiveFinite(viewportWidth, 1);
  const height = positiveFinite(viewportHeight, 1);
  const deviceRatio = positiveFinite(devicePixelRatio, 1);
  const policyCap = positiveFinite(policy.pixelRatioCap, 1);
  const renderbufferLimit = positiveFinite(maxRenderbufferDimension, 1);
  const pixelBudgetRatio = Math.sqrt(
    RENDER_VIEWPORT_PIXEL_BUDGET / (width * height),
  );
  const dimensionRatio = Math.min(
    renderbufferLimit / width,
    renderbufferLimit / height,
  );
  return Math.min(deviceRatio, policyCap, pixelBudgetRatio, dimensionRatio);
};

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
    pixelRatioCap: 0.4,
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
      mechanismTraceSamples: 24,
      maxPathLinePoints: 96,
      maxPathHandles: 32,
      overlayPointStride: 5,
      maxMediaEdgePx: 640,
      maxMediaFrames: 120,
      maxMediaFramesPerSecond: 15,
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
    pixelRatioCap: 0.5,
    antialias: false,
    targetFramesPerSecond: 40,
    overlayQuality: 'balanced',
    minOverlayIntervalMs: 1000 / 15,
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
      maxMediaEdgePx: 800,
      maxMediaFrames: 180,
      maxMediaFramesPerSecond: 20,
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
    pixelRatioCap: 2,
    // High raises resolution and unlocks the full overlay tier (ghost
    // frames, dense recommendation traces) but deliberately leaves cadence,
    // MSAA, topology, media, and cache budgets at balanced levels so the
    // setting stays predictable on classroom hardware.
    antialias: false,
    targetFramesPerSecond: 40,
    overlayQuality: 'full',
    minOverlayIntervalMs: 1000 / 15,
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
      maxMediaEdgePx: 800,
      maxMediaFrames: 180,
      maxMediaFramesPerSecond: 20,
    },
    repeatedGeometry: {
      strategy: 'pool-and-instance',
      instancingThreshold: 2,
      maxPoolEntries: 192,
      maxGeometryCacheEntries: 40,
      maxMaterialCacheEntries: 20,
    },
  }),
});

export const resolveRenderPerformancePolicy = (
  preset: RenderPerformancePreset,
): RenderPerformancePolicy => RENDER_PERFORMANCE_POLICIES[preset];

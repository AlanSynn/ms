import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  effectiveRenderPixelRatio,
  RENDER_VIEWPORT_PIXEL_BUDGET,
  resolveRenderPerformancePolicy,
  type RenderPerformancePreset,
} from '../utils/renderPerformancePolicy';

const presets: RenderPerformancePreset[] = ['fast', 'balanced', 'high'];
const policies = presets.map(resolveRenderPerformancePolicy);
const [fast, balanced, high] = policies;

assert(fast && balanced && high, 'every persisted performance preset resolves to a render policy');
assert.deepEqual(
  policies.map((policy) => policy.preset),
  presets,
  'the resolver preserves the requested preset identity',
);

assert.deepEqual(
  {
    pixelRatioCap: balanced.pixelRatioCap,
    antialias: balanced.antialias,
    targetFramesPerSecond: balanced.targetFramesPerSecond,
    overlayQuality: balanced.overlayQuality,
    partTopology: balanced.partTopology,
    interactiveDetail: balanced.interactiveDetail,
  },
  {
    pixelRatioCap: 0.5,
    antialias: false,
    targetFramesPerSecond: 40,
    overlayQuality: 'balanced',
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
  },
  'Balanced provides the Chromebook-oriented default rendering envelope',
);

assert.deepEqual(
  {
    pixelRatioCap: high.pixelRatioCap,
    antialias: high.antialias,
    targetFramesPerSecond: high.targetFramesPerSecond,
    overlayQuality: high.overlayQuality,
    partTopology: high.partTopology,
    interactiveDetail: high.interactiveDetail,
    repeatedGeometry: high.repeatedGeometry,
  },
  {
    pixelRatioCap: 2,
    antialias: balanced.antialias,
    targetFramesPerSecond: balanced.targetFramesPerSecond,
    overlayQuality: 'full',
    partTopology: balanced.partTopology,
    interactiveDetail: balanced.interactiveDetail,
    repeatedGeometry: balanced.repeatedGeometry,
  },
  'High raises resolution and unlocks the full overlay tier; cadence, MSAA, scene detail, media, and cache budgets stay at balanced levels',
);

const effectiveRatio = (
  policy: typeof balanced,
  overrides: Partial<Parameters<typeof effectiveRenderPixelRatio>[0]> = {},
) => effectiveRenderPixelRatio({
  policy,
  devicePixelRatio: 2,
  viewportWidth: 1366,
  viewportHeight: 768,
  maxRenderbufferDimension: 8192,
  ...overrides,
});

assert.equal(
  effectiveRatio(balanced),
  0.5,
  'Balanced keeps its Chromebook DPR cap at the acceptance viewport',
);
assert.equal(
  effectiveRatio(high, { viewportWidth: 624, viewportHeight: 610 }),
  2,
  'High reaches native 2x rendering in the Chromebook workbench viewport',
);
assert(
  effectiveRatio(high) < 2,
  'a full-window canvas remains inside the conservative rendered-pixel budget',
);
assert.equal(
  effectiveRatio(high, { devicePixelRatio: 1.25 }),
  1.25,
  'rendering never exceeds the device pixel ratio',
);

const pixelBudgetRatio = effectiveRatio(high, {
  devicePixelRatio: 3,
  viewportWidth: 3840,
  viewportHeight: 2160,
  maxRenderbufferDimension: 16384,
});
assert.equal(
  pixelBudgetRatio,
  Math.sqrt(RENDER_VIEWPORT_PIXEL_BUDGET / (3840 * 2160)),
  'large viewports are bounded by the rendered-pixel budget',
);
assert(
  3840 * 2160 * pixelBudgetRatio ** 2 <= RENDER_VIEWPORT_PIXEL_BUDGET + 1e-6,
  'the effective ratio cannot allocate beyond the rendered-pixel budget',
);

assert.equal(
  effectiveRatio(high, {
    devicePixelRatio: 3,
    viewportWidth: 2000,
    viewportHeight: 1000,
    maxRenderbufferDimension: 2048,
  }),
  2048 / 2000,
  'the effective ratio keeps both drawing-buffer dimensions within WebGL limits',
);

policies.forEach((policy) => {
  assert.equal(
    policy.minRenderIntervalMs,
    1000 / policy.targetFramesPerSecond,
    `${policy.preset} derives its render interval from its declared cadence`,
  );
  assert.equal(
    policy.repeatedGeometry.strategy,
    'pool-and-instance',
    `${policy.preset} requires persistent pooled and instanced repeated geometry`,
  );
  assert(policy.repeatedGeometry.instancingThreshold >= 2, 'only repeated geometry is instanced');
  assert(Object.isFrozen(policy), `${policy.preset} policy is immutable`);
  assert(Object.isFrozen(policy.partTopology), `${policy.preset} part-topology policy is immutable`);
  assert(Object.isFrozen(policy.interactiveDetail), `${policy.preset} interactive-detail policy is immutable`);
  assert(Object.isFrozen(policy.repeatedGeometry), `${policy.preset} repeated-geometry policy is immutable`);
});

assert.equal(fast.partTopology.bevelEnabled, false);
assert.equal(balanced.partTopology.edgeGeometryEnabled, false);
assert.equal(high.partTopology.bevelEnabled, false);
assert.equal(high.partTopology.edgeGeometryEnabled, false);
assert(fast.partTopology.curveSegments <= balanced.partTopology.curveSegments);
assert.equal(balanced.partTopology.curveSegments, high.partTopology.curveSegments);

assert(fast.pixelRatioCap <= balanced.pixelRatioCap && balanced.pixelRatioCap < high.pixelRatioCap);
assert(fast.targetFramesPerSecond < balanced.targetFramesPerSecond);
assert.equal(balanced.targetFramesPerSecond, high.targetFramesPerSecond);
assert(fast.minOverlayIntervalMs > balanced.minOverlayIntervalMs);
assert.equal(balanced.minOverlayIntervalMs, high.minOverlayIntervalMs);
assert(fast.repeatedGeometry.maxPoolEntries < balanced.repeatedGeometry.maxPoolEntries);
assert.equal(balanced.repeatedGeometry.maxPoolEntries, high.repeatedGeometry.maxPoolEntries);
assert(fast.interactiveDetail.mechanismTraceSamples < balanced.interactiveDetail.mechanismTraceSamples);
assert.equal(balanced.interactiveDetail.mechanismTraceSamples, high.interactiveDetail.mechanismTraceSamples);
assert(fast.interactiveDetail.maxPathLinePoints < balanced.interactiveDetail.maxPathLinePoints);
assert.equal(balanced.interactiveDetail.maxPathLinePoints, high.interactiveDetail.maxPathLinePoints);
assert(fast.interactiveDetail.maxPathHandles < balanced.interactiveDetail.maxPathHandles);
assert.equal(balanced.interactiveDetail.maxPathHandles, high.interactiveDetail.maxPathHandles);
assert(fast.interactiveDetail.overlayPointStride > balanced.interactiveDetail.overlayPointStride);
assert.equal(balanced.interactiveDetail.overlayPointStride, high.interactiveDetail.overlayPointStride);
assert(fast.interactiveDetail.maxMediaEdgePx < balanced.interactiveDetail.maxMediaEdgePx);
assert.equal(balanced.interactiveDetail.maxMediaEdgePx, high.interactiveDetail.maxMediaEdgePx);
assert(fast.interactiveDetail.maxMediaFrames < balanced.interactiveDetail.maxMediaFrames);
assert.equal(balanced.interactiveDetail.maxMediaFrames, high.interactiveDetail.maxMediaFrames);

assert.strictEqual(
  resolveRenderPerformancePolicy('balanced'),
  balanced,
  'policy resolution is deterministic and allocation-free',
);

const source = readFileSync(join(process.cwd(), 'utils/renderPerformancePolicy.ts'), 'utf8');
assert(!source.includes('navigator'), 'render policy must not inspect browser globals');
assert(!source.toLowerCase().includes('useragent'), 'render policy must not branch on User-Agent');

console.log('render performance policy contract ok');

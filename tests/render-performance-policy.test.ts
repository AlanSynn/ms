import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
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
  },
  {
    pixelRatioCap: 1,
    antialias: false,
    targetFramesPerSecond: 30,
    overlayQuality: 'balanced',
  },
  'Balanced provides the Chromebook-oriented default rendering envelope',
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
  assert(Object.isFrozen(policy.repeatedGeometry), `${policy.preset} repeated-geometry policy is immutable`);
});

assert(fast.pixelRatioCap <= balanced.pixelRatioCap && balanced.pixelRatioCap < high.pixelRatioCap);
assert(fast.targetFramesPerSecond < balanced.targetFramesPerSecond && balanced.targetFramesPerSecond < high.targetFramesPerSecond);
assert(fast.minOverlayIntervalMs > balanced.minOverlayIntervalMs && balanced.minOverlayIntervalMs > high.minOverlayIntervalMs);
assert(fast.repeatedGeometry.maxPoolEntries < balanced.repeatedGeometry.maxPoolEntries);
assert(balanced.repeatedGeometry.maxPoolEntries < high.repeatedGeometry.maxPoolEntries);

assert.strictEqual(
  resolveRenderPerformancePolicy('balanced'),
  balanced,
  'policy resolution is deterministic and allocation-free',
);

const source = readFileSync(join(process.cwd(), 'utils/renderPerformancePolicy.ts'), 'utf8');
assert(!source.includes('navigator'), 'render policy must not inspect browser globals');
assert(!source.toLowerCase().includes('useragent'), 'render policy must not branch on User-Agent');

console.log('render performance policy contract ok');

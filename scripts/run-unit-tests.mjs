import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const TEST_DIRECTORY = resolve(process.cwd(), 'tests');
const UNIT_TEST_FILES = [
  'assembly-guide-model.test.ts',
  'automata-scene-runtime.test.ts',
  'b695-blueprint.test.ts',
  'b695-diagnostics.test.ts',
  'b695-fit.test.ts',
  'b695-frame.test.ts',
  'b695-inspector-cache.test.ts',
  'b695-persistence.test.ts',
  'b695-playback.test.ts',
  'b695-study.test.ts',
  'cadenced-playback-sampler.test.ts',
  'chromebook-audit-contract.test.ts',
  'foundry-handle-gesture.test.ts',
  'four-bar-fit-retention.test.ts',
  'interactive-sampling.test.ts',
  'mechanism-fit-worker.test.ts',
  'mechanism-optimizer-worker.test.ts',
  'mechanism-recommendation-worker.test.ts',
  'no-image-recognition-runtime.test.ts',
  'path-gesture-draft.test.ts',
  'project-contract.test.ts',
  'render-performance-policy.test.ts',
  'three-resource-retention.test.ts',
  'tracking-media-policy.test.ts',
];

const discoveredUnitTests = readdirSync(TEST_DIRECTORY)
  .filter((fileName) => fileName.endsWith('.test.ts'))
  .sort();

if (JSON.stringify(discoveredUnitTests) !== JSON.stringify(UNIT_TEST_FILES)) {
  throw new Error(
    `Unit test manifest is stale.\nExpected: ${UNIT_TEST_FILES.join(', ')}\nFound: ${discoveredUnitTests.join(', ')}`,
  );
}

for (const testFile of UNIT_TEST_FILES) {
  const result = spawnSync(process.execPath, [resolve(TEST_DIRECTORY, testFile)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

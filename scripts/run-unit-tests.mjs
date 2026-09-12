import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const TEST_DIRECTORY = resolve(process.cwd(), 'tests');
const UNIT_TEST_FILES = [
  'adaptive-high-resolution-controller.test.ts',
  'app-capture.test.ts',
  'artwork-compositor.test.ts',
  'artwork-domain.test.ts',
  'artwork-three.test.ts',
  'assembly-guide-model.test.ts',
  'automata-scene-runtime.test.ts',
  'autosave-recovery-worker.test.ts',
  'b695-blueprint.test.ts',
  'b695-diagnostics.test.ts',
  'b695-fit.test.ts',
  'b695-frame.test.ts',
  'b695-inspector-cache.test.ts',
  'b695-persistence.test.ts',
  'b695-playback.test.ts',
  'b695-study.test.ts',
  'blueprint-package-worker.test.ts',
  'build-plan.test.ts',
  'cadenced-playback-sampler.test.ts',
  'character-pin-plan.test.ts',
  'chromebook-audit-contract.test.ts',
  'classroom-persistence.test.ts',
  'closest-fit-fallback.test.ts',
  'fabrication-validation.test.ts',
  'feature-search.test.ts',
  'feedback-worker.test.ts',
  'foundry-handle-gesture.test.ts',
  'foundry-workflow-progressive-mount.test.ts',
  'four-bar-fit-retention.test.ts',
  'four-bar-path-fit-adversarial.test.ts',
  'four-bar-path-fit-geometry.test.ts',
  'import-state-safety.test.ts',
  'interactive-sampling.test.ts',
  'mechanism-bindings.test.ts',
  'mechanism-fit-worker.test.ts',
  'mechanism-optimizer-worker.test.ts',
  'mechanism-recommendation-worker.test.ts',
  'motion-chains.test.ts',
  'motion-pose.test.ts',
  'motion-solver.test.ts',
  'multiple-motion-paths.test.ts',
  'no-image-recognition-runtime.test.ts',
  'orphan-mechanism-migration.test.ts',
  'painted-build-packet.test.ts',
  'path-gesture-draft.test.ts',
  'project-contract.test.ts',
  'project-file-authority.test.ts',
  'project-import-worker.test.ts',
  'project-working-preview.test.ts',
  'render-performance-policy.test.ts',
  'renderer-interaction-seams.test.ts',
  'scene-object-image-worker.test.ts',
  'session-performance-persistence.test.ts',
  'shape-editing.test.ts',
  'startup-flow.test.ts',
  'student-support.test.ts',
  'three-resource-retention.test.ts',
  'tracking-media-policy.test.ts',
  'transient-value-controller.test.ts',
  'update-check.test.ts',
  'version-codec.test.ts',
  'version-policy.test.ts',
  'version-portable.test.ts',
  'version-worker.test.ts',
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

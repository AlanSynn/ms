import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preferredMotionJointId as preferredFromMotion } from '../utils/motion';
import { preferredMotionJointId } from '../utils/motionTargetSelection';
import { createSampleProject } from '../utils/project';

assert.equal(preferredFromMotion, preferredMotionJointId, 'motion preserves its public target-selection export');
assert.equal(
  preferredMotionJointId(createSampleProject(), 'right_arm_lower', 'left_hand'),
  'right_elbow',
  'extracted target selection preserves invalid-anchor fallback behavior',
);

const root = fileURLToPath(new URL('..', import.meta.url));
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)]
  .map(match => match[1]);
const resolveImport = (file: string, specifier: string) => {
  const base = resolve(file, '..', specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
};

const visiting = new Set<string>();
const visited = new Set<string>();
const walk = (file: string, stack: string[]): void => {
  assert(!visiting.has(file), `runtime import cycle: ${[...stack, file].map(item => item.slice(root.length + 1)).join(' -> ')}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const specifier of imports(file)) {
    const dependency = resolveImport(file, specifier);
    if (dependency) walk(dependency, [...stack, file]);
  }
  visiting.delete(file);
  visited.add(file);
};
const compilerEntry = join(root, 'utils/mechanismCompiler.ts');
const runtimePolicyEntry = join(root, 'utils/mechanismRuntimePolicy.ts');
walk(compilerEntry, []);
walk(runtimePolicyEntry, []);

assert(!readFileSync(compilerEntry, 'utf8').includes("from './motion'"), 'mechanism compiler does not import the runtime motion consumer');
console.log('mechanism runtime import-cycle contracts passed');

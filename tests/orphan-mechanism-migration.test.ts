import { strict as assert } from 'node:assert';

import { mechanismBindingForPath, mechanismOutputBindings, mechanismWithOutputBindings } from '../utils/mechanismBindings';
import { applyProjectAction, createDefaultMechanism, createSampleProject, loadProjectSnapshot, serializeProject } from '../utils/project';

const sample = createSampleProject();
const path = sample.paths['path-right-arm'];
assert(path, 'the sample project provides a path for binding migration');

const generatedPath = [{ x: 901, y: 902 }, { x: 903, y: 904 }, { x: 905, y: 906 }];
const fit = { status: 'fit' as const, targetPathId: path.id, outputTraceId: 'C' };
const seed = createDefaultMechanism('4bar', 'orphan-migration-bound');
const bound = mechanismWithOutputBindings({
  ...seed,
  anchorX: 73,
  anchorY: -41,
  generatedPath,
  targetPathId: path.id,
  fabricationMetadata: { pathFit: fit },
}, [mechanismBindingForPath(sample, seed, path.id, { fit })!]);

const restored = loadProjectSnapshot({
  ...sample,
  mechanisms: [{
    ...bound,
    targetPartId: 'missing-part',
    outputs: bound.outputs?.map(binding => ({ ...binding, targetPartId: 'missing-part' })),
  }],
});
const restoredBinding = mechanismOutputBindings(restored.mechanisms[0])[0];
assert.equal(restoredBinding?.pathId, path.id, 'migration keeps the stored path identity');
assert.equal(restoredBinding?.targetPartId, path.partId, 'migration restores the unambiguous path owner');
assert.equal(restored.mechanisms[0].enabled, true, 'a binding with a valid path remains active');
assert.deepEqual(restored.mechanisms[0].generatedPath, generatedPath, 'binding-only migration preserves stored mechanism geometry');
assert.equal(restored.mechanisms[0].anchorX, 73, 'binding-only migration preserves the stored board anchor');

const ancestorSeed = createDefaultMechanism('4bar', 'orphan-migration-ancestor');
const ancestorBinding = mechanismBindingForPath(sample, ancestorSeed, path.id, {
  targetPartId: 'right_arm_upper',
  targetAnchorJointId: 'right_hand',
});
const canonicalized = loadProjectSnapshot({
  ...sample,
  mechanisms: [mechanismWithOutputBindings({ ...ancestorSeed, targetPathId: path.id }, [ancestorBinding!])],
});
assert.equal(mechanismOutputBindings(canonicalized.mechanisms[0])[0]?.targetPartId, path.partId, 'reload canonicalizes a compatible ancestor target to the authored path owner');
assert.equal(mechanismOutputBindings(canonicalized.mechanisms[0])[0]?.targetAnchorJointId, path.targetAnchorJointId, 'reload preserves the path handle when it remains valid for the canonical owner');

const missingPathMechanism = {
  ...createDefaultMechanism('4bar', 'orphan-migration-missing'),
  anchorX: 117,
  anchorY: -83,
  targetPartId: 'right_arm_lower',
  targetPathId: 'deleted-path',
  generatedPath,
};
const quarantined = loadProjectSnapshot({ ...sample, mechanisms: [missingPathMechanism] });
assert.equal(quarantined.mechanisms[0].enabled, false, 'an imported orphan is quarantined');
assert.equal(mechanismOutputBindings(quarantined.mechanisms[0]).length, 0, 'an orphan cannot retain a stale output binding');
assert.equal(quarantined.mechanisms[0].targetPathId, undefined, 'an orphan cannot retain a stale scalar path');
assert.deepEqual(quarantined.mechanisms[0].generatedPath, generatedPath, 'quarantine preserves mechanism geometry for recovery');
assert(quarantined.mechanisms[0].warnings?.includes('Output detached: choose target + path.'), 'quarantine explains the recovery action');

const explicitlyDisabled = loadProjectSnapshot({
  ...sample,
  mechanisms: [{ ...missingPathMechanism, id: 'orphan-migration-disabled', enabled: false }],
});
assert.equal(explicitlyDisabled.mechanisms[0].enabled, false, 'migration preserves explicit disabled intent');

const disabledOutput = loadProjectSnapshot({
  ...sample,
  mechanisms: [{
    ...bound,
    outputs: bound.outputs?.map(binding => ({ ...binding, enabled: false })),
  }],
});
assert.equal(disabledOutput.mechanisms[0].enabled, false, 'a mechanism with no active outputs is quarantined');
assert.equal(disabledOutput.mechanisms[0].outputs?.[0]?.enabled, false, 'migration preserves an explicitly disabled output entry');

const partialOrphan = loadProjectSnapshot({
  ...sample,
  mechanisms: [{
    ...bound,
    outputs: [
      ...(bound.outputs ?? []),
      { id: 'orphan-migration-bound:missing', portId: 'B', pathId: 'deleted-path', enabled: true },
    ],
  }],
});
assert.equal(partialOrphan.mechanisms[0].enabled, false, 'a partially orphaned active mechanism is quarantined before export');
assert.equal(mechanismOutputBindings(partialOrphan.mechanisms[0]).length, 1, 'a valid output remains available for explicit recovery');
const reopenedPartialOrphan = loadProjectSnapshot(JSON.parse(serializeProject(partialOrphan)));
assert.equal(reopenedPartialOrphan.mechanisms[0].enabled, false, 'a quarantined partial orphan remains off after serialize and reload');
assert(reopenedPartialOrphan.mechanisms[0].warnings?.includes('Output detached: choose target + path.'), 'the recovery warning survives serialize and reload');
assert.deepEqual(
  mechanismOutputBindings(reopenedPartialOrphan.mechanisms[0]),
  mechanismOutputBindings(partialOrphan.mechanisms[0]),
  'serialize and reload preserve the surviving binding without inventing a target',
);
assert.deepEqual(reopenedPartialOrphan.mechanisms[0].generatedPath, partialOrphan.mechanisms[0].generatedPath, 'serialize and reload preserve quarantined geometry');
const explicitlyReenabled = applyProjectAction(reopenedPartialOrphan, {
  type: 'upsert_mechanism',
  mechanism: { ...reopenedPartialOrphan.mechanisms[0], enabled: true },
});
assert.equal(
  explicitlyReenabled.mechanisms[0].warnings?.some(warning => warning.startsWith('Output detached:')),
  false,
  'an explicit re-enable after a valid repair clears the recovery warning',
);

const committed = applyProjectAction(sample, { type: 'upsert_mechanism', mechanism: bound });
const deleted = applyProjectAction(committed, { type: 'delete_path', pathId: path.id });
assert.equal(deleted.mechanisms[0].enabled, false, 'deleting a bound path disables the now-unbound mechanism');
assert.equal(mechanismOutputBindings(deleted.mechanisms[0]).length, 0, 'deleting a bound path removes its output binding');
assert.deepEqual(deleted.mechanisms[0].generatedPath, generatedPath, 'delete reconciliation preserves recovery geometry');

const newUnbound = applyProjectAction(sample, {
  type: 'upsert_mechanism',
  mechanism: createDefaultMechanism('4bar', 'orphan-migration-new-unbound'),
});
assert.equal(newUnbound.mechanisms.at(-1)?.enabled, false, 'canonical upsert quarantines an unbound mechanism');
assert(newUnbound.mechanisms.at(-1)?.warnings?.includes('Output detached: choose target + path.'), 'canonical quarantine keeps a recovery warning');

const legacyUnusedTemplate = createDefaultMechanism('gear_linkage', 'legacy-unused-template');
const reopenedUnusedTemplate = loadProjectSnapshot({ ...sample, mechanisms: [legacyUnusedTemplate] }).mechanisms[0];
assert.equal(reopenedUnusedTemplate.enabled, false, 'an old template with no binding evidence at all is also kept off');
assert.equal(reopenedUnusedTemplate.id, legacyUnusedTemplate.id, 'the old template remains available for editing');
assert.equal(reopenedUnusedTemplate.targetPathId, undefined, 'loading never guesses a path from unrelated project motions');

console.log('orphan mechanism migration contracts ok');

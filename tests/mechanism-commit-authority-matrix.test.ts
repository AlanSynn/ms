import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FoundryExportPackage, MechanismConfig, ProjectState } from '../types';
import {
  applyProjectAction,
  createSampleProject,
  loadProjectSnapshot,
  mechanismWithGeneratedPath,
  replaceCharacterProject,
} from '../utils/project';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  MECHANISM_FEASIBILITY_AUTHORITY_KEYS,
  constrainMechanismCommit,
  mechanismEditIsSafe,
  mechanismMotionCompletes,
  resolveMechanismEditAttempt,
} from '../utils/mechanismEditAuthority';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import {
  REFERENCE_EXPORT_READY_TYPES,
  normalizeMechanismToReference,
} from '../utils/mechanismReference';
import { pathOwnedTargetFields } from '../utils/pathTargets';

const sample = createSampleProject();

{
  const geometryKeys: Array<keyof MechanismConfig> = ['type', ...MECHANISM_FEASIBILITY_AUTHORITY_KEYS];
  const derivedKeys: Array<keyof MechanismConfig> = [
    'generatedPath',
    'foundryExport',
    'transform',
    'sceneAnchor',
    'fabricationMetadata',
    'connectionSelectionValidation',
    'warnings',
  ];
  const geometryFingerprint = (mechanism: MechanismConfig) => Object.fromEntries(
    geometryKeys.map(key => [key, mechanism[key]])
  );
  const finiteDeep = (value: unknown): boolean => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(finiteDeep);
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).every(finiteDeep);
    return true;
  };
  const permuteCandidate = (candidate: MechanismConfig, permutation: 'forward' | 'reverse' | 'interleaved'): MechanismConfig => {
    const entries = Object.entries(candidate);
    const ordered = permutation === 'reverse'
      ? [...entries].reverse()
      : permutation === 'interleaved'
        ? [...entries.filter((_, index) => index % 2 === 0), ...entries.filter((_, index) => index % 2 === 1)]
        : entries;
    return Object.fromEntries(ordered) as unknown as MechanismConfig;
  };
  const foundryPackage = (mechanism: MechanismConfig, marker: string): FoundryExportPackage => ({
    id: `${marker}-package`,
    createdAt: marker,
    mechanismId: mechanism.id,
    mechanismType: mechanism.type,
    parameters: { ...mechanism, crankLength: mechanism.crankLength + 777 },
    pivot: { x: 7001, y: 7002 },
    outputPoint: { x: 7003, y: 7004 },
    generatedPath: [{ x: 7005, y: 7006 }, { x: 7007, y: 7008 }],
    simulationSummary: marker,
    visual: { color: '#ff00aa', scale: 7, constraintsVisible: true },
    animation: { duration: 777, steps: 2, loop: true },
    metadata: { sourceTab: marker, selectedPreset: marker, recommendation: marker },
    warnings: [marker],
    source: 'mechanism-foundry',
  });
  const withCandidateDerivedState = (mechanism: MechanismConfig, marker: string): MechanismConfig => ({
    ...mechanism,
    generatedPath: [{ x: 7101, y: 7102 }, { x: 7103, y: 7104 }],
    foundryExport: foundryPackage(mechanism, marker),
    transform: { x: 7201, y: 7202, rotation: 123, scale: 9 },
    sceneAnchor: { x: 7301, y: 7302 },
    fabricationMetadata: {
      boardCoordinate: marker,
      gridPitchMm: 999,
      sceneAnchor: { x: 7401, y: 7402 },
      targetPathId: marker,
      warnings: [marker],
    },
    connectionSelectionValidation: {
      status: 'invalid',
      entries: [{ role: marker, status: 'rejected', reason: marker }],
    },
    warnings: [marker],
  });
  const assertCandidateDerivedStateDidNotLeak = (stored: MechanismConfig, candidate: MechanismConfig, label: string) => {
    for (const key of derivedKeys) {
      assert.notDeepEqual(stored[key], candidate[key], `${label} does not retain candidate ${String(key)}`);
    }
  };
  const noRecipeTypes = ALL_MECHANISM_TYPES.filter(type => !REFERENCE_EXPORT_READY_TYPES.includes(type));

  ALL_MECHANISM_TYPES.forEach(type => {
    const prior = mechanismWithGeneratedPath({
      ...normalizeMechanismToReference(createDefaultMechanism(type, `g013-${type}`)),
      ...pathOwnedTargetFields(sample.paths['path-right-arm']),
    });
    assert(mechanismEditIsSafe(prior, sample.settings.physicalKit), `${type} G013 fixture starts simulation-safe`);
    const priorMechanismPackage = foundryPackage(prior, `stored-prior-${type}`);
    const priorProject: ProjectState = {
      ...createSampleProject(),
      mechanisms: [{ ...prior, foundryExport: priorMechanismPackage }],
      selectedMechanismId: prior.id,
      lastFoundryExport: foundryPackage(prior, `prior-${type}`),
    };
    const rejectedCandidate = withCandidateDerivedState({
      ...prior,
      groundAngle: (prior.groundAngle ?? 0) + 7,
      crankLength: Number.NaN,
    }, `rejected-${type}`);
    const directResults = (['forward', 'reverse', 'interleaved'] as const).map(permutation =>
      constrainMechanismCommit(prior, permuteCandidate(rejectedCandidate, permutation), sample.settings.physicalKit)
    );
    directResults.forEach((result, index) => {
      assert.deepEqual(geometryFingerprint(result), geometryFingerprint(prior), `${type} rejected permutation ${index + 1} preserves the entire prior geometry`);
      assertCandidateDerivedStateDidNotLeak(result, rejectedCandidate, `${type} rejected permutation ${index + 1}`);
    });
    assert.deepEqual(directResults.map(geometryFingerprint), directResults.map(() => geometryFingerprint(prior)), `${type} whole-candidate rejection is insertion-order invariant`);

    const upsertRejected = applyProjectAction(priorProject, { type: 'upsert_mechanism', mechanism: rejectedCandidate });
    const setRejected = applyProjectAction(priorProject, { type: 'set_mechanisms', mechanisms: [rejectedCandidate], selectedMechanismId: prior.id });
    const upsertStored = upsertRejected.mechanisms.find(mechanism => mechanism.id === prior.id)!;
    const setStored = setRejected.mechanisms.find(mechanism => mechanism.id === prior.id)!;
    assert.deepEqual(geometryFingerprint(upsertStored), geometryFingerprint(prior), `${type} upsert rejects a non-finite whole candidate atomically`);
    assert.deepEqual(geometryFingerprint(setStored), geometryFingerprint(prior), `${type} set_mechanisms rejects a non-finite whole candidate atomically`);
    assert.deepEqual(geometryFingerprint(setStored), geometryFingerprint(upsertStored), `${type} bulk and upsert reducers share whole-candidate authority semantics`);
    assertCandidateDerivedStateDidNotLeak(upsertStored, rejectedCandidate, `${type} rejected upsert`);
    assertCandidateDerivedStateDidNotLeak(setStored, rejectedCandidate, `${type} rejected set_mechanisms`);
    assert.equal(upsertRejected.lastFoundryExport, priorProject.lastFoundryExport, `${type} rejected upsert preserves exact prior project package state`);
    assert.equal(setRejected.lastFoundryExport, priorProject.lastFoundryExport, `${type} rejected bulk set preserves exact prior project package state`);
    assert.strictEqual(upsertRejected, priorProject, `${type} rejected upsert is an exact aggregate no-op`);
    assert.strictEqual(setRejected, priorProject, `${type} rejected bulk set is an exact aggregate no-op`);

    const invalidBindingCandidate = { ...prior, targetAnchorJointId: 'head_top' };
    const invalidBindingAttempt = resolveMechanismEditAttempt(
      priorProject,
      priorProject.mechanisms[0],
      invalidBindingCandidate,
    );
    assert.equal(invalidBindingAttempt.status, 'rejected', `${type} invalid anchor is rejected before reconciliation`);
    assert.equal(invalidBindingAttempt.status === 'rejected' ? invalidBindingAttempt.blocker : '', 'Fix: Choose anchor');
    assert.strictEqual(
      applyProjectAction(priorProject, { type: 'upsert_mechanism', mechanism: invalidBindingCandidate }),
      priorProject,
      `${type} invalid anchor upsert preserves the exact mechanism and package`,
    );
    assert.strictEqual(
      applyProjectAction(priorProject, { type: 'set_mechanisms', mechanisms: [invalidBindingCandidate] }),
      priorProject,
      `${type} invalid anchor bulk edit is atomic`,
    );
    assert.strictEqual(
      applyProjectAction(priorProject, {
        type: 'upsert_path',
        path: {
          ...priorProject.paths['path-right-arm'],
          targetAnchorJointId: 'right_elbow',
        },
      }),
      priorProject,
      `${type} invalid direct path-anchor edit preserves the exact aggregate and package`,
    );
    assert.strictEqual(
      applyProjectAction(priorProject, {
        type: 'update_joint',
        jointId: 'right_hand',
        updates: { parentId: 'neck' },
      }),
      priorProject,
      `${type} invalid direct joint-chain edit preserves the exact aggregate and package`,
    );
    assert.strictEqual(
      applyProjectAction(priorProject, {
        type: 'upsert_part',
        part: {
          ...priorProject.parts.right_hand_part,
          anchorJointId: 'missing-direct-anchor',
        },
      }),
      priorProject,
      `${type} invalid direct part-anchor edit preserves the exact aggregate and package`,
    );

    const changedCandidate = withCandidateDerivedState({
      ...prior,
      groundAngle: (prior.groundAngle ?? 0) + 90,
    }, `changed-${type}`);
    const changedProject = applyProjectAction(priorProject, { type: 'upsert_mechanism', mechanism: changedCandidate });
    const changedStored = changedProject.mechanisms.find(mechanism => mechanism.id === prior.id)!;
    assert.equal(changedStored.groundAngle, changedCandidate.groundAngle, `${type} accepts the complete safe geometry change`);
    assertCandidateDerivedStateDidNotLeak(changedStored, changedCandidate, `${type} accepted changed geometry`);
    assert(finiteDeep(changedStored), `${type} accepted changed geometry and recomputed metadata remain recursively finite`);
    assert.equal(changedProject.lastFoundryExport, undefined, `${type} changed geometry clears independent Foundry package state`);

    const finiteUnsafe = {
      ...prior,
      source: 'imported' as const,
      anchorX: 10000,
      anchorY: -10000,
      crankLength: -Math.abs(prior.crankLength),
      transform: { x: 10000, y: -10000, rotation: 17, scale: 1 },
      sceneAnchor: { x: 10000, y: -10000 },
      generatedPath: [{ x: 8101, y: 8102 }, { x: 8103, y: 8104 }],
    };
    const loadedUnsafe = loadProjectSnapshot({ ...priorProject, mechanisms: [finiteUnsafe] }).mechanisms[0];
    assert.equal(loadedUnsafe.anchorX, finiteUnsafe.anchorX, `${type} import preserves finite unsafe anchor X before recovery classification`);
    assert.equal(loadedUnsafe.anchorY, finiteUnsafe.anchorY, `${type} import preserves finite unsafe anchor Y before recovery classification`);
    assert.equal(loadedUnsafe.crankLength, finiteUnsafe.crankLength, `${type} import does not abs or clamp a finite unsafe dimension`);
    assert.deepEqual(loadedUnsafe.transform, finiteUnsafe.transform, `${type} import does not relocate finite unsafe transform geometry`);
    assert.deepEqual(loadedUnsafe.sceneAnchor, finiteUnsafe.sceneAnchor, `${type} import does not relocate finite unsafe scene anchor geometry`);
    assert.equal(loadedUnsafe.generatedPath, undefined, `${type} import clears stale motion while preserving unsafe authored geometry for recovery`);
    assert.equal(mechanismEditIsSafe(loadedUnsafe, priorProject.settings.physicalKit), false, `${type} finite unsafe import remains recovery-blocked rather than claimed safe`);

    const malformed = loadProjectSnapshot({
      ...priorProject,
      mechanisms: [{
        ...prior,
        anchorX: Number.NaN,
        transform: { x: Number.POSITIVE_INFINITY, y: 0, rotation: 0, scale: 1 },
        sceneAnchor: { x: 0, y: Number.NEGATIVE_INFINITY },
        generatedPath: [{ x: Number.NaN, y: Number.POSITIVE_INFINITY }],
        gearTrainRadii: [prior.crankLength, Number.NaN, prior.rockerLength],
        camProfileSamples: [1, Number.POSITIVE_INFINITY, 1],
      }],
    }).mechanisms[0];
    assert(finiteDeep(malformed), `${type} malformed non-finite import representation is sanitized recursively at the snapshot boundary`);

    const replacement = replaceCharacterProject(createSampleProject(), { ...priorProject, mechanisms: [finiteUnsafe] }, 'character');
    const replacedUnsafe = replacement.mechanisms[0];
    assert.deepEqual(geometryFingerprint(replacedUnsafe), geometryFingerprint(finiteUnsafe), `${type} character replacement preserves finite unsafe geometry for explicit recovery`);
    assert(!mechanismEditIsSafe(replacedUnsafe, replacement.settings.physicalKit) || replacedUnsafe.enabled === false, `${type} character replacement cannot silently claim unsafe geometry as active and safe`);
  });

  noRecipeTypes.forEach(type => {
    const mechanism = mechanismWithGeneratedPath(normalizeMechanismToReference(createDefaultMechanism(type, `g013-no-recipe-${type}`)));
    assert(mechanismMotionCompletes(mechanism), `${type} no-recipe family retains complete simulation motion`);
    assert(mechanismEditIsSafe(mechanism, sample.settings.physicalKit), `${type} no-recipe family remains simulation-authorable without inventing a fabrication recipe`);
  });

  const mechanismEditAuthoritySource = readFileSync(join(process.cwd(), 'utils', 'mechanismEditAuthority.ts'), 'utf8');
  assert(!/Object\.entries\(updates\)/.test(mechanismEditAuthoritySource), 'whole-candidate authority removes the known Object.entries partial-salvage bypass');
}

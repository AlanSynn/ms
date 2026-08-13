import assert from 'node:assert/strict';
import type { MechanismConfig, MechanismType, ProjectState } from '../types';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  mechanismReadiness,
  projectMechanismReadiness,
} from '../utils/mechanismReadiness';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import { createSampleProject } from '../utils/project';

const RECIPE_TYPES = new Set<MechanismType>([
  '4bar',
  'piston',
  'cam',
  'gear',
  'gear_linkage',
  'planetary_gear',
]);

const boundMechanism = (type: MechanismType, id = `ready-${type}`): MechanismConfig => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const projectWith = (...mechanisms: MechanismConfig[]): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    mechanisms,
    selectedMechanismId: mechanisms[0]?.id,
    settings: {
      ...project.settings,
      physicalKit: {
        ...project.settings.physicalKit,
        boardCells: 41,
        sheetWidthMm: 1_000,
        sheetHeightMm: 1_000,
      },
    },
  };
};

const participation = new Set<MechanismType>();
for (const type of ALL_MECHANISM_TYPES) {
  const project = projectWith(boundMechanism(type));
  const result = mechanismReadiness(project, project.mechanisms[0]);
  assert.equal(result.simulationSafe, true, `${type} participates in the simulation tier`);
  assert.equal(
    result.status,
    RECIPE_TYPES.has(type) ? 'fabrication-ready' : 'fabrication-unsupported',
    `${type} uses the canonical reference export tier`,
  );
  participation.add(type);
}
assert.equal(participation.size, 12, 'all 12 mechanism families participate in readiness');

for (const type of ALL_MECHANISM_TYPES) {
  const detached = boundMechanism(type, `detached-${type}`);
  delete detached.targetPartId;
  delete detached.targetPathId;
  delete detached.targetAnchorJointId;
  const result = mechanismReadiness(projectWith(detached), detached);
  assert.equal(result.simulationSafe, false, `${type} detached ownership blocks project-context simulation acceptance`);
  assert.equal(
    result.status,
    'recovery-blocked',
    `${type} enters static recovery while detached`,
  );
  assert.deepEqual(result.blockers, ['Fix: Choose anchor'], `${type} reports the authoritative binding blocker`);
}

for (const type of ALL_MECHANISM_TYPES) {
  const owner = boundMechanism('4bar', `owner-${type}`);
  const duplicate = boundMechanism(type, `duplicate-${type}`);
  const result = mechanismReadiness(projectWith(owner, duplicate), duplicate);
  assert.equal(result.simulationSafe, false, `${type} duplicate ownership blocks project-context simulation acceptance`);
  assert.equal(
    result.status,
    'recovery-blocked',
    `${type} enters static recovery with duplicate ownership`,
  );
  assert(result.blockers.includes('Fix: Choose anchor'), `${type} reports duplicate ownership`);
}

const unsupported = mechanismReadiness(projectWith(boundMechanism('5bar')), boundMechanism('5bar'));
assert.equal(unsupported.status, 'fabrication-unsupported', 'missing reference recipe remains unsupported');
assert.equal(unsupported.simulationSafe, true, 'missing recipe remains simulation-safe');
assert.equal(unsupported.blockers.length, 1, 'missing recipe alone adds only its fabrication blocker');

const unsafe = boundMechanism('4bar', 'unsafe');
unsafe.crankLength = Number.NaN;
const unsafeResult = mechanismReadiness(projectWith(unsafe), unsafe);
assert.equal(unsafeResult.status, 'recovery-blocked', 'non-finite geometry is recovery-blocked');
assert.equal(unsafeResult.simulationSafe, false, 'recovery-blocked geometry is not simulation-safe');

const duplicateA = boundMechanism('4bar', 'duplicate-a');
const duplicateB = boundMechanism('piston', 'duplicate-b');
const duplicateProject = projectWith(duplicateA, duplicateB);
assert.equal(projectMechanismReadiness(duplicateProject).status, 'blocked', 'duplicate target ownership blocks the project');
assert(projectMechanismReadiness(duplicateProject).mechanisms.every(result => result.blockers.includes('Fix: Choose anchor')), 'duplicate ownership reuses the authoritative binding warning');

const offSheet = boundMechanism('piston', 'off-sheet');
const offSheetProject = projectWith(offSheet);
const defaultSheet = createSampleProject().settings.physicalKit;
offSheetProject.settings = {
  ...offSheetProject.settings,
  physicalKit: defaultSheet,
};
const offSheetResult = mechanismReadiness(offSheetProject, offSheet);
assert.equal(offSheetResult.status, 'simulation-safe', 'off-sheet complete envelope is simulation-safe only');
assert(offSheetResult.blockers.includes('Physical envelope outside board'), 'complete envelope must fit the fabrication board');
assert(!offSheetResult.blockers.includes('Physical envelope outside sheet'), 'cut-sheet layout is not the assembly readiness gate');

const compilerBlocked = boundMechanism('4bar', 'compiler-blocked');
compilerBlocked.groundLength = 321;
const compilerResult = mechanismReadiness(projectWith(compilerBlocked), compilerBlocked);
assert.equal(compilerResult.status, 'recovery-blocked', 'finite invalid compiler/support geometry is recovery-blocked');
assert(compilerResult.blockers.some(blocker => /snap|support|stack|graph/i.test(blocker)), 'existing compiler support/stack blocker is preserved');

const collisionA = boundMechanism('4bar', 'collision-a');
const collisionB: MechanismConfig = { ...boundMechanism('piston', 'collision-b'), targetPartId: 'left_hand_part', targetPathId: undefined };
collisionA.anchorX = collisionB.anchorX = 120;
const collisionProject = projectWith(collisionA, collisionB);
collisionProject.settings.physicalKit = {
  ...collisionProject.settings.physicalKit,
  profileKey: 'readiness-large-board',
  boardCells: 41,
};
collisionProject.paths['path-left-collision'] = {
  ...collisionProject.paths['path-right-arm'],
  id: 'path-left-collision',
  partId: 'left_hand_part',
  targetAnchorJointId: 'left_hand',
  chainRootJointId: 'left_shoulder',
};
collisionB.targetPathId = 'path-left-collision';
collisionB.targetAnchorJointId = 'left_hand';
const collisionResult = projectMechanismReadiness(collisionProject);
assert.equal(collisionResult.status, 'blocked', 'different-ID synchronized collision blocks the project');
assert(collisionResult.mechanisms.every(result => result.fabricationReady), 'non-default project kit keeps both shifted render plans fabrication-ready');
assert(collisionResult.blockers.some(blocker => blocker.includes('Mechanisms collide')), 'collision oracle blocker is reported');

const ready = boundMechanism('4bar', 'active-ready');
const hiddenUnsafe = { ...boundMechanism('4bar', 'hidden-unsafe'), visible: false, crankLength: Number.NaN };
const disabledUnsafe = { ...boundMechanism('4bar', 'disabled-unsafe'), enabled: false, crankLength: Number.NaN };
const inertResult = projectMechanismReadiness(projectWith(ready, hiddenUnsafe, disabledUnsafe));
assert.equal(inertResult.status, 'project-ready', 'hidden and disabled mechanisms are inert');
assert.deepEqual(inertResult.activeMechanismIds, ['active-ready'], 'active policy is centralized');

const serializedProject = JSON.stringify(projectWith(ready));
assert(!/simulation-safe|fabrication-ready|fabrication-unsupported|recovery-blocked|project-ready/.test(serializedProject), 'readiness results are not persisted');

console.log('mechanism readiness contracts passed');

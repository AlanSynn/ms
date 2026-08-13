import assert from 'node:assert/strict';
import type { MechanismConfig, MechanismType, PhysicalKitSettings, ProjectState } from '../types';
import { defaultPhysicalKit } from '../utils/coordinates';
import { calculateLinkage, mechanismSafetyPhaseSchedule } from '../utils/kinematics';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  mechanismDescriptorWithinSheet,
  synchronizedMechanismCollisionOracle,
} from '../utils/mechanismCollision';
import { buildLowLevelMechanismPhysicalEnvelopeDescriptors } from '../utils/mechanismPhysicalEnvelope';
import { mechanismReadiness } from '../utils/mechanismReadiness';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import { createSampleProject } from '../utils/project';

const denseFamilies = new Set<MechanismType>(['5bar', '6bar', 'planetary_gear']);
const recipeFamilies = new Set<MechanismType>(['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear']);

const finiteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbers);
  if (value && typeof value === 'object') return Object.values(value).every(finiteNumbers);
  return true;
};

const boundMechanism = (type: MechanismType, id: string): MechanismConfig => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const projectWith = (mechanism: MechanismConfig, physicalKit: PhysicalKitSettings): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    mechanisms: [mechanism],
    selectedMechanismId: mechanism.id,
    settings: { ...project.settings, physicalKit },
  };
};

const defaultKit = defaultPhysicalKit();
const compactKit: PhysicalKitSettings = {
  ...defaultKit,
  profileKey: 'safety-compact',
  sheetWidthMm: 120,
  sheetHeightMm: 120,
};
const largeKit: PhysicalKitSettings = {
  ...defaultKit,
  profileKey: 'safety-large',
  sheetWidthMm: 1_000,
  sheetHeightMm: 1_000,
  boardCells: 41,
};

for (const type of ALL_MECHANISM_TYPES) {
  const phases = mechanismSafetyPhaseSchedule(type);
  const expectedCount = denseFamilies.has(type) ? 384 : 48;
  assert.equal(phases.length, expectedCount, `${type} declares its exact full-revolution safety sample count`);
  assert.equal(phases[0], 0, `${type} safety schedule starts at zero`);
  assert(phases.every((phase, index) => phase === Math.PI * 2 * index / expectedCount), `${type} safety schedule is deterministic and evenly spaced`);
  assert(phases.every(phase => phase >= 0 && phase < Math.PI * 2), `${type} safety schedule stays in [0, 2pi)`);
  assert.equal(new Set(phases).size, expectedCount, `${type} safety schedule does not duplicate 2pi`);

  const mechanism = boundMechanism(type, `safety-${type}`);
  assert(phases.every(phase => finiteNumbers(calculateLinkage(mechanism, phase))), `${type} yields finite motion for every declared safety phase`);

  const descriptors = buildLowLevelMechanismPhysicalEnvelopeDescriptors(mechanism, phases);
  assert(descriptors.length > phases.length, `${type} publishes physical parts across the full schedule`);
  assert.equal(new Set(descriptors.map(descriptor => descriptor.phaseIndex)).size, phases.length, `${type} reaches envelope logic at every safety phase`);
  assert(descriptors.every(descriptor => finiteNumbers(descriptor.envelope)), `${type} publishes finite physical envelopes`);
  assert(descriptors.some(descriptor => mechanismDescriptorWithinSheet(descriptor, largeKit)), `${type} reaches kit-aware envelope bounds`);

  const readiness = mechanismReadiness(projectWith(mechanism, largeKit), mechanism);
  assert.equal(readiness.simulationSafe, true, `${type} reaches canonical readiness with a valid fixture`);
  assert.equal(readiness.fabricationReady, recipeFamilies.has(type), `${type} reaches its declared fabrication readiness tier`);

  const separated = { ...mechanism, id: `safety-separated-${type}`, anchorX: 600, anchorY: -40 };
  const collision = synchronizedMechanismCollisionOracle(mechanism, separated, largeKit);
  assert.equal(collision.phaseCount, expectedCount, `${type} collision oracle uses the full family schedule`);
  assert.equal(collision.collision, undefined, `${type} separated valid fixtures remain collision-free`);

  const overlapping = { ...mechanism, id: `safety-overlapping-${type}` };
  const overlap = synchronizedMechanismCollisionOracle(mechanism, overlapping, largeKit);
  assert(overlap.collision, `${type} participates in positive overlap detection`);
  assert.equal(overlap.collision.first.mechanismId, mechanism.id, `${type} overlap preserves first mechanism ownership`);
  assert.equal(overlap.collision.second.mechanismId, overlapping.id, `${type} overlap preserves second mechanism ownership`);
}

const envelopeFixture = boundMechanism('piston', 'kit-envelope');
const envelopeDescriptors = buildLowLevelMechanismPhysicalEnvelopeDescriptors(envelopeFixture, mechanismSafetyPhaseSchedule('piston'));
const inSheetCount = (kit: PhysicalKitSettings) => envelopeDescriptors.filter(descriptor => mechanismDescriptorWithinSheet(descriptor, kit)).length;
assert(inSheetCount(compactKit) < inSheetCount(defaultKit), 'compact kit excludes more of the moving envelope than the default kit');
assert(inSheetCount(defaultKit) < inSheetCount(largeKit), 'large kit contains more of the moving envelope than the default kit');

const defaultReadiness = mechanismReadiness(projectWith(envelopeFixture, defaultKit), envelopeFixture);
const compactReadiness = mechanismReadiness(projectWith(envelopeFixture, compactKit), envelopeFixture);
const largeReadiness = mechanismReadiness(projectWith(envelopeFixture, largeKit), envelopeFixture);
assert(defaultReadiness.blockers.includes('Physical envelope outside board'), 'default kit reaches board-envelope blocking');
assert(compactReadiness.blockers.includes('Physical envelope outside board'), 'compact kit still blocks a moving assembly that exceeds its fabrication board');
assert.equal(largeReadiness.fabricationReady, true, 'large kit makes the same valid mechanism fabrication-ready');

const collisionFirst = boundMechanism('4bar', 'kit-collision-first');
const collisionSecond = boundMechanism('piston', 'kit-collision-second');
collisionFirst.anchorX = collisionSecond.anchorX = 240;
assert.equal(synchronizedMechanismCollisionOracle(collisionFirst, collisionSecond, defaultKit).collision, undefined, 'default kit keeps the shifted pair out of collision output');
assert.equal(synchronizedMechanismCollisionOracle(collisionFirst, collisionSecond, compactKit).collision, undefined, 'compact kit keeps the shifted pair out of collision output');
const largeCollision = synchronizedMechanismCollisionOracle(collisionFirst, collisionSecond, largeKit);
assert(largeCollision.collision, 'large kit compiles the shifted pair into an observable collision');
assert.equal(largeCollision.collision.phaseRad, mechanismSafetyPhaseSchedule('4bar')[largeCollision.collision.phaseIndex], 'kit-aware collision preserves its sampled phase');

console.log('mechanism safety matrix contracts passed');

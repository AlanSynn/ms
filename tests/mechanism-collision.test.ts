import assert from 'node:assert/strict';
import type { MechanismType, PhysicalKitSettings } from '../types';
import { sceneBoundsForSheet } from '../utils/coordinates';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { FABRICATION_Z_EPSILON_MM } from '../utils/mechanismFabricationZStack';
import {
    mechanismDescriptorWithinSheet,
    mechanismDescriptorsCollide,
    mechanismEnvelopesIntersect,
    synchronizedMechanismCollisionOracle
} from '../utils/mechanismCollision';
import { buildLowLevelMechanismPhysicalEnvelopeDescriptors, type MechanismPhysicalEnvelopeDescriptor } from '../utils/mechanismPhysicalEnvelope';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';

type Envelope = MechanismPhysicalEnvelopeDescriptor['envelope'];
const circle = (x: number, y: number, radius = 1): Envelope => ({ kind: 'circle', x, y, rotation: 0, radius });
const capsule = (x: number, y: number, rotation = 0, length = 2, radius = 1): Envelope => ({ kind: 'capsule', x, y, rotation, length, radius });
const box = (x: number, y: number, rotation = 0, width = 2, height = 2): Envelope => ({ kind: 'oriented-box', x, y, rotation, width, height });

const pairCases: Array<{ label: string; first: Envelope; overlap: Envelope; separate: Envelope; tangent: Envelope }> = [
    { label: 'circle/circle', first: circle(0, 0), overlap: circle(1, 0), separate: circle(3, 0), tangent: circle(2, 0) },
    { label: 'circle/capsule', first: circle(0, 0), overlap: capsule(1.5, 0), separate: capsule(4, 0), tangent: capsule(3, 0) },
    { label: 'circle/box', first: circle(0, 0), overlap: box(1.5, 0), separate: box(4, 0), tangent: box(2, 0) },
    { label: 'capsule/capsule', first: capsule(0, 0), overlap: capsule(0, 1), separate: capsule(0, 3), tangent: capsule(0, 2) },
    { label: 'capsule/box', first: capsule(0, 0), overlap: box(0, 1.5), separate: box(0, 4), tangent: box(0, 2) },
    { label: 'box/box', first: box(0, 0), overlap: box(1, 0), separate: box(3, 0), tangent: box(2, 0) }
];

pairCases.forEach(({ label, first, overlap, separate, tangent }) => {
    assert(mechanismEnvelopesIntersect(first, overlap), `${label} positive-area overlap intersects`);
    assert(mechanismEnvelopesIntersect(overlap, first), `${label} intersection is unordered`);
    assert(!mechanismEnvelopesIntersect(first, separate), `${label} separation passes`);
    assert(!mechanismEnvelopesIntersect(first, tangent), `${label} edge tangency has no positive area`);
});
assert(!mechanismEnvelopesIntersect(circle(0, 0, 5), box(4, 5)), 'circle/box point tangency has no positive area');
assert(!mechanismEnvelopesIntersect(capsule(0, 0), capsule(4, 0)), 'capsule/capsule endpoint tangency has no positive area');
assert(!mechanismEnvelopesIntersect(capsule(0, 0, 0, 2, 5), box(5, 5)), 'capsule/box corner tangency has no positive area');
assert(!mechanismEnvelopesIntersect(box(0, 0), box(2, 2)), 'box/box point tangency has no positive area');

const descriptor = (
    mechanismId: string,
    envelope: Envelope,
    backFaceMm: number,
    frontFaceMm: number,
    collisionClass: MechanismPhysicalEnvelopeDescriptor['collisionClass'] = 'mechanism-part'
): MechanismPhysicalEnvelopeDescriptor => ({
    layerKey: `${mechanismId}:layer`, mechanismId, layerId: 'layer', phaseIndex: 0, phaseRad: 0,
    envelope, backFaceMm, frontFaceMm, role: collisionClass === 'owned-hardware' ? 'pin' : 'linkage', collisionClass
});

const first = descriptor('first', circle(0, 0), 0, FABRICATION_Z_EPSILON_MM);
assert(!mechanismDescriptorsCollide(first, descriptor('first', circle(0, 0), 0, 2)), 'same mechanism is ignored');
assert(!mechanismDescriptorsCollide(first, descriptor('second', circle(0, 0), FABRICATION_Z_EPSILON_MM, 2)), 'zero z overlap passes');
assert(!mechanismDescriptorsCollide(first, descriptor('second', circle(0, 0), 0, 2)), 'exact z epsilon passes');
assert(!mechanismDescriptorsCollide(descriptor('below-first', circle(0, 0), 0, FABRICATION_Z_EPSILON_MM - 1e-9), descriptor('below-second', circle(0, 0), 0, 2)), 'below z epsilon passes');
assert(mechanismDescriptorsCollide(descriptor('above-first', circle(0, 0), 0, FABRICATION_Z_EPSILON_MM + 1e-9), descriptor('above-second', circle(0, 0), 0, 2)), 'z overlap just above epsilon blocks');
assert(mechanismDescriptorsCollide(descriptor('hardware', circle(0, 0), 0, 1, 'owned-hardware'), descriptor('part', circle(0, 0), 0, 1)), 'owned hardware participates');

const kit: PhysicalKitSettings = {
    profileKey: 'collision-test', gridPitchMm: 20, sheetWidthMm: 100, sheetHeightMm: 80,
    boardCells: 5, holeDiameterMm: 4, exportMode: 'both', defaultExportFormat: 'both', cutSheetFileType: 'svg'
};
const sheet = sceneBoundsForSheet(kit);
assert(mechanismDescriptorWithinSheet(descriptor('circle', circle(sheet.x + 5, 0, 5), 0, 1), kit), 'circle may touch sheet edge');
assert(!mechanismDescriptorWithinSheet(descriptor('circle', circle(sheet.x + 4.999, 0, 5), 0, 1), kit), 'circle outer edge may not leave sheet');
assert(mechanismDescriptorWithinSheet(descriptor('capsule', capsule(0, sheet.y + 5, 0, 20, 5), 0, 1), kit), 'capsule may touch sheet edge');
assert(!mechanismDescriptorWithinSheet(descriptor('capsule', capsule(0, sheet.y + 4.999, 0, 20, 5), 0, 1), kit), 'capsule cap may not leave sheet');
const rotatedExtent = Math.SQRT2 * 5;
assert(mechanismDescriptorWithinSheet(descriptor('box', box(sheet.x + rotatedExtent, 0, Math.PI / 4, 10, 10), 0, 1), kit), 'rotated box may touch sheet edge');
assert(!mechanismDescriptorWithinSheet(descriptor('box', box(sheet.x + rotatedExtent - 0.001, 0, Math.PI / 4, 10, 10), 0, 1), kit), 'rotated box corner may not leave sheet');

const familyParticipation = new Set<MechanismType>();
ALL_MECHANISM_TYPES.forEach(type => {
    const mechanism = createDefaultMechanism(type, `collision-${type}`);
    const descriptors = buildLowLevelMechanismPhysicalEnvelopeDescriptors(mechanism, [0]);
    assert(descriptors.length > 0, `${type} participates in bounded collision descriptors`);
    assert(descriptors.every(item => item.role !== 'base' && !/path|trace|label|handle|overlay/i.test(item.role)), `${type} descriptors exclude base/decorative geometry`);
    familyParticipation.add(type);
});
assert.equal(familyParticipation.size, 12, 'all 12 families participate');

const standard = createDefaultMechanism('4bar', 'standard-pair');
const dense = createDefaultMechanism('5bar', 'dense-pair');
dense.anchorX = 10_000;
dense.anchorY = 10_000;
const synchronized = synchronizedMechanismCollisionOracle(standard, dense);
assert.equal(synchronized.phaseCount, 384, '48/384 pair uses max-density synchronized schedule');
assert.equal(synchronized.collision, undefined, 'separated pair remains clear at synchronized samples');
assert.equal(synchronizedMechanismCollisionOracle(standard, { ...standard }).phaseCount, 0, 'same mechanism ID skips synchronized comparison');

const kitAwareFirst = createDefaultMechanism('4bar', 'kit-aware-first');
const kitAwareSecond = createDefaultMechanism('piston', 'kit-aware-second');
kitAwareFirst.anchorX = kitAwareSecond.anchorX = 240;
const largeBoardKit = { ...kit, profileKey: 'collision-large-board', boardCells: 41, sheetWidthMm: 1_000, sheetHeightMm: 1_000 };
assert.equal(synchronizedMechanismCollisionOracle(kitAwareFirst, kitAwareSecond).collision, undefined, 'default-kit render plans reject the shifted pair');
const kitAwareCollision = synchronizedMechanismCollisionOracle(kitAwareFirst, kitAwareSecond, largeBoardKit).collision;
assert.equal(kitAwareCollision?.first.mechanismId, kitAwareFirst.id, 'active kit reaches the first compiled render plan');
assert.equal(kitAwareCollision?.second.mechanismId, kitAwareSecond.id, 'active kit reaches the second compiled render plan');

const phaseAwareFirst = createDefaultMechanism('4bar', 'phase-aware-first');
phaseAwareFirst.anchorX = phaseAwareFirst.anchorY = 0;
const phaseAwareSecond = createDefaultMechanism('4bar', 'phase-aware-second');
phaseAwareSecond.anchorX = -240;
phaseAwareSecond.anchorY = -40;
const phaseAwareCollision = synchronizedMechanismCollisionOracle(phaseAwareFirst, phaseAwareSecond, largeBoardKit).collision;
assert.equal(phaseAwareCollision?.phaseIndex, 2, 'fixture first collides at synchronized outer phase 2');
assert.equal(phaseAwareCollision?.first.phaseIndex, phaseAwareCollision?.phaseIndex, 'first descriptor preserves synchronized phase identity');
assert.equal(phaseAwareCollision?.second.phaseIndex, phaseAwareCollision?.phaseIndex, 'second descriptor preserves synchronized phase identity');

console.log('mechanism collision contracts passed');

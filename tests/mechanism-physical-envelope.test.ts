import assert from 'node:assert/strict';
import { mechanismSafetyPhaseSchedule, synchronizedMechanismSafetyPhaseSchedule } from '../utils/kinematics';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { buildLowLevelMechanismPhysicalEnvelopeDescriptors } from '../utils/mechanismPhysicalEnvelope';
import { buildLowLevelMechanismSceneContract } from '../utils/mechanismSceneContract';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';

const denseTypes = new Set(['5bar', '6bar', 'planetary_gear']);
const phases = [0, Math.PI] as const;
const shapes = new Set<string>();

for (const type of ALL_MECHANISM_TYPES) {
    const expectedCount = denseTypes.has(type) ? 384 : 48;
    const schedule = mechanismSafetyPhaseSchedule(type);
    assert.equal(schedule.length, expectedCount, `${type} has the exact safety phase count`);
    assert.deepEqual(schedule, Array.from({ length: expectedCount }, (_, index) => Math.PI * 2 * index / expectedCount), `${type} has the exact evenly spaced safety schedule`);

    for (const otherType of ALL_MECHANISM_TYPES) {
        const synchronized = synchronizedMechanismSafetyPhaseSchedule(type, otherType);
        const synchronizedCount = Math.max(expectedCount, denseTypes.has(otherType) ? 384 : 48);
        assert.equal(synchronized.length, synchronizedCount, `${type}/${otherType} uses the denser safety schedule`);
        assert.deepEqual(synchronized, Array.from({ length: synchronizedCount }, (_, index) => Math.PI * 2 * index / synchronizedCount), `${type}/${otherType} stays synchronized`);
    }

    const mechanism = createDefaultMechanism(type, `physical-envelope-${type}`);
    const descriptors = buildLowLevelMechanismPhysicalEnvelopeDescriptors(mechanism, phases);
    assert(descriptors.length > 0, `${type} participates in physical envelope checks`);
    assert.deepEqual([...new Set(descriptors.map(descriptor => descriptor.phaseIndex))], [0, 1], `${type} participates at both requested phases`);
    assert.equal(new Set(descriptors.map(descriptor => `${descriptor.mechanismId}:${descriptor.layerId}:${descriptor.phaseIndex}`)).size, descriptors.length, `${type} descriptor identities are unique per phase`);

    const layerKeys = new Map<string, string>();
    for (const descriptor of descriptors) {
        assert.equal(descriptor.mechanismId, mechanism.id, `${type} descriptor keeps mechanism ownership`);
        assert.equal(descriptor.phaseRad, phases[descriptor.phaseIndex], `${type} descriptor keeps its requested phase`);
        assert.equal(descriptor.layerKey, `${mechanism.id}:${descriptor.layerId}`, `${type} layer key is stable`);
        assert.equal(layerKeys.get(descriptor.layerId) ?? descriptor.layerKey, descriptor.layerKey, `${type} layer key is phase-independent`);
        layerKeys.set(descriptor.layerId, descriptor.layerKey);
        assert(Number.isFinite(descriptor.backFaceMm) && Number.isFinite(descriptor.frontFaceMm), `${type} descriptor faces are finite`);
        assert(descriptor.backFaceMm < descriptor.frontFaceMm, `${type} descriptor z faces are ordered with positive depth`);
        assert(!['base', 'overlay'].includes(descriptor.role), `${type} excludes non-colliding base and overlay roles`);
        assert(Object.values(descriptor.envelope).filter(value => typeof value === 'number').every(Number.isFinite), `${type} envelope values are finite`);
        if (descriptor.envelope.kind === 'circle') assert(descriptor.envelope.radius > 0, `${type} circle radius is positive`);
        if (descriptor.envelope.kind === 'capsule') assert(descriptor.envelope.length > 0 && descriptor.envelope.radius > 0, `${type} capsule dimensions are positive`);
        if (descriptor.envelope.kind === 'oriented-box') assert(descriptor.envelope.width > 0 && descriptor.envelope.height > 0, `${type} box dimensions are positive`);
        if (['clip', 'spacer', 'pin'].includes(descriptor.role)) assert.equal(descriptor.collisionClass, 'owned-hardware', `${type} represented hardware keeps ownership`);
        shapes.add(descriptor.envelope.kind);
    }
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(descriptors)), `${type} descriptors are JSON serializable`);

    let sceneMechanismAccessCount = 0;
    const sceneContract = buildLowLevelMechanismSceneContract(new Proxy(mechanism, {
        get: (target, property, receiver) => {
            sceneMechanismAccessCount += 1;
            return Reflect.get(target, property, receiver);
        }
    }));
    sceneMechanismAccessCount = 0;
    assert(Object.hasOwn(sceneContract, 'physicalEnvelopeDescriptors'), `${type} scene contract owns its derived descriptors`);
    const propertyDescriptor = Object.getOwnPropertyDescriptor(sceneContract, 'physicalEnvelopeDescriptors');
    assert.equal(typeof propertyDescriptor?.get, 'function', `${type} derived descriptors use a lazy getter`);
    assert.equal(propertyDescriptor?.value, undefined, `${type} derived descriptors are not eagerly stored`);
    assert.equal(propertyDescriptor?.enumerable, false, `${type} derived descriptors are non-enumerable`);
    assert(!Object.hasOwn({ ...sceneContract }, 'physicalEnvelopeDescriptors'), `${type} scene contract spread omits derived descriptors`);
    assert(!JSON.stringify(sceneContract).includes('physicalEnvelopeDescriptors'), `${type} scene contract JSON omits derived descriptors`);
    assert(!String(sceneContract).includes('physicalEnvelopeDescriptors'), `${type} scene contract string omits derived descriptors`);
    assert.equal(Object.getOwnPropertyDescriptor(sceneContract, 'physicalEnvelopeDescriptors')?.get, propertyDescriptor?.get, `${type} serialization does not invoke descriptor construction`);
    assert.equal(sceneMechanismAccessCount, 0, `${type} serialization and spread do not access descriptor inputs`);
    const firstSceneDescriptors = sceneContract.physicalEnvelopeDescriptors;
    assert(sceneMechanismAccessCount > 0, `${type} first direct access constructs descriptors lazily`);
    const firstAccessCount = sceneMechanismAccessCount;
    assert(firstSceneDescriptors.length > 0, `${type} scene contract exposes derived descriptors directly`);
    assert.equal(sceneContract.physicalEnvelopeDescriptors, firstSceneDescriptors, `${type} derived descriptors are constructed once and memoized by reference`);
    assert.equal(propertyDescriptor?.get?.call(sceneContract), firstSceneDescriptors, `${type} direct getter access returns the memoized reference`);
    assert.equal(sceneMechanismAccessCount, firstAccessCount, `${type} repeated access does not reconstruct descriptors`);
    assert(!JSON.stringify(mechanism).includes('physicalEnvelopeDescriptors'), `${type} mechanism JSON omits derived descriptors`);
}

assert.deepEqual([...shapes].sort(), ['capsule', 'circle', 'oriented-box'], 'physical envelopes cover all supported shapes');

console.log('mechanism physical envelope contract passed');

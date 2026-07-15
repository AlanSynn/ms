import assert from 'node:assert/strict';
import type { MechanismType } from '../types';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { compileMechanismPhysicalInstances, compileMechanismRenderPlan } from '../utils/mechanismCompiler';
import type { MechanismPhysicalInstanceKind } from '../utils/mechanismPhysicalInstances';
import { buildLowLevelMechanismSceneContract } from '../utils/mechanismSceneContract';
import { ALL_MECHANISM_TYPES } from '../utils/mechanismTemplates';

const expectedKinds: Record<MechanismType, readonly MechanismPhysicalInstanceKind[]> = {
  crank: ['base', 'linkage', 'spacer', 'retainer', 'pin'],
  '4bar': ['base', 'linkage', 'spacer', 'retainer', 'pin'],
  piston: ['base', 'linkage', 'guide', 'spacer', 'retainer', 'pin'],
  yoke: ['base', 'linkage', 'guide', 'spacer', 'retainer', 'pin'],
  'quick-return': ['base', 'linkage', 'spacer', 'retainer', 'pin'],
  '5bar': ['base', 'linkage', 'spacer', 'retainer', 'pin'],
  '6bar': ['base', 'linkage', 'spacer', 'retainer', 'pin'],
  cam: ['base', 'linkage', 'cam', 'guide', 'follower', 'spacer', 'retainer', 'pin'],
  'rack-pinion': ['base', 'gear', 'rack', 'guide'],
  gear: ['base', 'gear', 'spacer', 'retainer', 'pin'],
  gear_linkage: ['base', 'gear', 'linkage', 'spacer', 'retainer', 'pin'],
  planetary_gear: ['base', 'gear', 'linkage', 'spacer', 'retainer', 'pin']
};

const finiteContour = (points: readonly { x: number; y: number }[]) => {
  assert(points.length >= 4);
  assert(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.deepEqual(points[0], points.at(-1));
};

for (const type of ALL_MECHANISM_TYPES) {
  const mechanism = createDefaultMechanism(type, `physical-instance-${type}`);
  const plan = compileMechanismRenderPlan(mechanism);
  const phase0 = compileMechanismPhysicalInstances(mechanism, 0);
  const scrub = compileMechanismPhysicalInstances(mechanism, 0.37123);
  const cycle = compileMechanismPhysicalInstances(mechanism, Math.PI * 2);
  const scheduled = [Math.PI / 2, Math.PI, Math.PI * 1.5].map(phase => compileMechanismPhysicalInstances(mechanism, phase));
  const definitionKeys = new Set(scrub.definitions.map(definition => definition.partKey));
  const kinds = new Set(scrub.instances.map(instance => instance.kind));

  expectedKinds[type].forEach(kind => assert(kinds.has(kind), `${type} inventories ${kind}`));
  assert.deepEqual(scrub.instances.map(instance => instance.instanceId), phase0.instances.map(instance => instance.instanceId), `${type} instance ids ignore phase`);
  assert.deepEqual(cycle.instances.map(instance => instance.instanceId), phase0.instances.map(instance => instance.instanceId), `${type} cycle ids ignore phase`);
  scheduled.forEach(compiled => assert.deepEqual(compiled.instances.map(instance => instance.instanceId), phase0.instances.map(instance => instance.instanceId), `${type} scheduled ids ignore phase`));
  assert.deepEqual(scrub.definitions.map(definition => definition.partKey), phase0.definitions.map(definition => definition.partKey), `${type} definition keys ignore phase`);

  scrub.definitions.forEach(definition => {
    assert.equal(definition.units, 'mm');
    assert(Object.isFrozen(definition));
    finiteContour(definition.contourMm);
    definition.cutouts.forEach(cutout => finiteContour(cutout.contourMm));
    definition.holes.forEach(hole => {
      assert(hole.diameterMm > 0);
      finiteContour(hole.contourMm);
    });
  });
  scrub.instances.forEach(instance => {
    assert(definitionKeys.has(instance.partKey), `${instance.instanceId} resolves ${instance.partKey}`);
    assert(Number.isFinite(instance.phaseRad));
    assert(Number.isFinite(instance.pose.translationMm.x) && Number.isFinite(instance.pose.translationMm.y));
    assert(Number.isFinite(instance.pose.rotationRad));
    assert(instance.z.physicalDepthMm > 0);
  });

  [plan.base, ...plan.layers].forEach(layer => {
    const instance = scrub.instances.find(candidate => candidate.layerId === layer.layerId);
    assert(instance, `${type} layer ${layer.layerId} has one physical instance`);
    assert.equal(instance.partKey, layer.partKey);
    assert.deepEqual(instance.supportPathIds, layer.supportPathIds);
    if (layer.renderKind === 'clip') assert.equal(instance.kind, 'retainer');
  });
  plan.pinSpans.forEach(span => {
    const pin = scrub.instances.find(instance => instance.pinSpanId === span.id && instance.kind === 'pin');
    assert(pin, `${type} pin span ${span.id} has an explicit pin instance`);
    assert.deepEqual(pin.z, {
      backFaceMm: span.backFaceMm,
      frontFaceMm: span.frontFaceMm,
      centerMm: span.centerMm,
      physicalDepthMm: span.physicalDepthMm
    });
  });
  plan.supportNodes.filter(node => node.ownerLayerId).forEach(node => {
    assert(scrub.instances.some(instance => instance.layerId === node.ownerLayerId && instance.supportNodeId === node.id), `${type} support ${node.id} is explicit on its owner instance`);
  });

  const scene = buildLowLevelMechanismSceneContract(mechanism, undefined, undefined, 0.37123);
  assert.deepEqual(scene.physicalDefinitions, scrub.definitions, `${type} scene carries canonical definitions`);
  assert.deepEqual(scene.physicalInstances, scrub.instances, `${type} scene carries phase pose unchanged`);
}

const rack = compileMechanismPhysicalInstances(createDefaultMechanism('rack-pinion', 'physical-rack'), 0.2);
const rackInstance = rack.instances.find(instance => instance.kind === 'rack');
assert(rackInstance, 'rack-pinion inventories a distinct rack instance');
assert(rackInstance.partKey.startsWith('racks:'), 'rack does not alias a guide part key');

assert.throws(
  () => compileMechanismPhysicalInstances(createDefaultMechanism('4bar', 'physical-invalid-phase'), Number.NaN),
  /phase must be finite/
);

console.log('mechanism physical instance contracts passed');

import assert from 'node:assert/strict';
import type { ConnectionSelection, MechanismConfig } from '../types';
import { defaultPhysicalKit } from '../utils/coordinates';
import { FABRICATION_GEAR_SPECS } from '../utils/fabricationContract';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  mechanismUsesExactFabricationCombination,
  resolveFabricationCombination,
} from '../utils/mechanismFabricationCombinations';

const kit = defaultPhysicalKit();

const selected = (
  mechanism: MechanismConfig,
  role: keyof NonNullable<MechanismConfig['connectionSelections']>,
): ConnectionSelection | undefined => mechanism.connectionSelections?.[role];

{
  const requested = {
    ...createDefaultMechanism('4bar', 'snap-four-bar'),
    couplerLength: 111,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.equal(result.mechanism.couplerLength, 120);
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true);
  }

  const first = resolveFabricationCombination(requested, requested, kit, 'scalar');
  const second = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.deepEqual(second, first, 'equal-distance requests resolve deterministically');
}

{
  const requested = {
    ...createDefaultMechanism('gear', 'snap-gear'),
    gearTrainRadii: [83, 51],
    crankLength: 83,
    rockerLength: 51,
    groundLength: 134,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.deepEqual(result.mechanism.gearTrainRadii, [100, 60]);
    assert.equal(result.mechanism.groundLength, 160);
    assert.equal(result.mechanism.gearRatio, -100 / 60);
    assert.equal(result.mechanism.speed2, -100 / 60);
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true);
  }
}

{
  const requested = {
    ...createDefaultMechanism('gear_linkage', 'snap-gear-linkage'),
    gearTrainRadii: [83, 51],
    crankLength: 83,
    rockerLength: 51,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    for (const role of ['gear_linkage.drive-pin', 'gear_linkage.output-pin'] as const) {
      const selection = selected(result.mechanism, role);
      assert(selection?.kind === 'gear-attachment-hole', `${role} retains a physical gear hole`);
      if (selection?.kind === 'gear-attachment-hole') {
        const spec = FABRICATION_GEAR_SPECS.find(candidate => candidate.key === selection.gearKey);
        assert(spec, `${role} resolves a manifest gear`);
        assert(spec.attachmentHoleCentersMm[selection.holeIndex], `${role} resolves a real attachment hole`);
      }
    }
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true);
  }
}

{
  const requested = {
    ...createDefaultMechanism('planetary_gear', 'fixed-planetary'),
    crankLength: 93,
    rockerLength: 47,
    groundLength: 999,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.equal(result.mechanism.crankLength, 20, 'planetary sun remains G1');
    assert.equal(result.mechanism.rockerLength, 60, 'planetary planet remains G3');
    assert.equal(result.mechanism.groundLength, 80, 'planetary carrier remains the fixed G1/G3 span');
    assert.equal(result.mechanism.connectionSelections?.['planetary_gear.carrier-planet-pivot']?.kind, 'linkage-hole');
    assert.equal(result.mechanism.connectionSelections?.['planetary_gear.carrier-output-hole']?.kind, 'linkage-hole');
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true);
  }
}

{
  const previous = createDefaultMechanism('4bar', 'preserve-previous');
  const requested = {
    ...previous,
    id: 'off-board-request',
    anchorX: 99_999,
    anchorY: 99_999,
  };
  const previousBefore = structuredClone(previous);
  const requestedBefore = structuredClone(requested);
  const result = resolveFabricationCombination(previous, requested, kit, 'scalar');
  assert.equal(result.status, 'rejected');
  assert.equal(result.mechanism, previous, 'rejection returns the exact previous aggregate');
  if (result.status === 'rejected') assert.equal(result.blocker, 'No kit fit');
  assert.deepEqual(previous, previousBefore, 'rejection does not mutate previous');
  assert.deepEqual(requested, requestedBefore, 'rejection does not mutate requested');
}

console.log('mechanism fabrication-combination contracts passed');

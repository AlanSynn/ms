import assert from 'node:assert/strict';
import type { ConnectionSelection, MechanismConfig } from '../types';
import { boardToScene, defaultPhysicalKit, SCENE_PX_PER_MM, sceneToBoardRaw } from '../utils/coordinates';
import { FABRICATION_GEAR_SPECS, FABRICATION_LINKAGE_SPECS, FABRICATION_RING_GEAR_SPEC } from '../utils/fabricationContract';
import { compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import {
  connectionSelectionSignature,
  normalizeMechanismConnectionSelections,
  resolveMechanismPhysicalConnections,
} from '../utils/mechanismConnectionSelections';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { generateCurvePoints, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from '../utils/kinematics';
import { validateMechanismPreviewReadiness } from '../utils/mechanismPreviewReadiness';
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
    const fullCouplerSpec = FABRICATION_LINKAGE_SPECS.find(spec => spec.holeCentersMm.length >= 4);
    assert(fullCouplerSpec, 'manifest contains an approved full coupler blank');
    assert.equal(result.mechanism.couplerLength, fullCouplerSpec.lengthMm * SCENE_PX_PER_MM);
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
    ...createDefaultMechanism('gear_linkage', 'preserve-g3-ground-and-coupler'),
    gearTrainRadii: [60, 60],
    crankLength: 60,
    rockerLength: 60,
    groundLength: 400,
    couplerLength: 320,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.deepEqual(result.mechanism.gearTrainRadii, [60, 60], 'requested G3 endpoints remain selected');
    assert.equal(result.mechanism.groundLength, 400, 'scalar intent keeps the requested legal ground span');
    assert.equal(result.mechanism.couplerLength, 320, 'scalar intent keeps the paired linkage length');
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true, 'the requested aggregate remains exact and buildable');
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

{
  const base = createDefaultMechanism('4bar', 'explicit-hole-over-default');
  const defaults = normalizeMechanismConnectionSelections(base, undefined);
  const explicitInput = { kind: 'linkage-hole', linkageKey: 'linkage-8-cell', holeIndex: 7 } as const;
  const explicitOutput = { kind: 'linkage-hole', linkageKey: 'linkage-8-cell', holeIndex: 7 } as const;
  const requested = {
    ...base,
    crankLength: 280,
    rockerLength: 280,
    connectionSelections: {
      ...(defaults.connectionSelections ?? {}),
      '4bar.input-joint': explicitInput,
      '4bar.output-joint': explicitOutput,
    },
    connectionSelectionValidation: defaults.connectionSelectionValidation,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'connection');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.deepEqual(result.mechanism.connectionSelections?.['4bar.input-joint'], explicitInput, 'explicit input hole survives stale defaulted validation');
    assert.deepEqual(result.mechanism.connectionSelections?.['4bar.output-joint'], explicitOutput, 'explicit output hole survives stale defaulted validation');
    const resolved = resolveMechanismPhysicalConnections(result.mechanism, kit);
    assert.equal(connectionSelectionSignature(resolved.selections), connectionSelectionSignature(result.mechanism.connectionSelections), 'physical resolution uses the persisted explicit holes');
    assert.equal(mechanismUsesExactFabricationCombination(result.mechanism, kit), true, 'explicit-hole aggregate remains exact');
  }
}

{
  const requested = {
    ...createDefaultMechanism('4bar', 'full-catalog-coupler'),
    couplerLength: 100,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    const couplerSpec = FABRICATION_LINKAGE_SPECS.find(spec => Math.abs(spec.lengthMm * SCENE_PX_PER_MM - Math.abs(result.mechanism.couplerLength)) < 1e-6);
    assert(couplerSpec, 'four-bar coupler resolves to a full catalog blank');
    assert.deepEqual(validateMechanismPreviewReadiness(result.mechanism, kit), [], 'accepted coupler has no readiness bypass');
    const compiled = compileMechanismGraphFabrication(result.mechanism, kit);
    assert.equal(compiled.buildable, true, 'accepted coupler compiles directly');
    const couplerLayer = compiled.renderPlan.layers.find(layer => layer.sourceNodeId === 'coupler-link');
    assert.equal(couplerLayer?.partKey, `linkages:${couplerSpec?.key}`, 'direct compilation uses the persisted coupler blank');
  }
}

{
  const invalidLink = {
    ...createDefaultMechanism('4bar', 'off-catalog-link'),
    couplerLength: 60,
  };
  const linkResult = compileMechanismGraphFabrication(invalidLink);
  assert.equal(linkResult.buildable, false);
  assert.match(linkResult.renderPlan.validationErrors.join(' '), /approved linkage/i);
}

{
  const requested = {
    ...createDefaultMechanism('4bar', 'pivot-board-snap'),
    anchorX: 1,
    anchorY: 1,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'pivot');
  assert.equal(result.status, 'accepted', 'pivot intent enumerates legal board anchors');
  if (result.status === 'accepted') {
    const board = sceneToBoardRaw({ x: result.mechanism.anchorX ?? 0, y: result.mechanism.anchorY ?? 0 }, kit);
    assert.equal(board.valid, true);
    assert.equal(Math.hypot((result.mechanism.anchorX ?? 0) - 1, (result.mechanism.anchorY ?? 0) - 1) > 0.1, true, 'pivot intent returns a snapped board pivot');
  }
  const legalAnchorRequested = { ...requested, anchorX: 0, anchorY: 0 };
  assert.equal(resolveFabricationCombination(legalAnchorRequested, legalAnchorRequested, kit, 'profile').status, 'rejected', 'unsupported profile intent is not treated as scalar');
  assert.equal(resolveFabricationCombination(legalAnchorRequested, legalAnchorRequested, kit, 'creation').status, 'rejected', 'unsupported creation intent is not treated as scalar');
}

{
  const target = {
    ...createDefaultMechanism('4bar', 'fit-target'),
    groundLength: 160,
    crankLength: 80,
    couplerLength: 120,
    rockerLength: 80,
  };
  const targetPath = generateCurvePoints(target, 32, kit).points;
  assert(targetPath.length > 0, 'fit target has a canonical motion path');
  const requested = {
    ...createDefaultMechanism('4bar', 'fit-intent'),
    groundLength: 120,
    crankLength: 100,
    couplerLength: 100,
    rockerLength: 100,
    generatedPath: targetPath,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'fit');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    assert.notDeepEqual(result.mechanism.generatedPath, requested.generatedPath, 'fit candidates derive their own canonical path');
  }
}

{
  const rightEdge = boardToScene(kit.boardCells - 1, Math.floor(kit.boardCells / 2), kit);
  for (const type of ['cam', 'piston'] as const) {
    const requested = { ...createDefaultMechanism(type, `invalid-${type}-mount`), anchorX: rightEdge.x, anchorY: rightEdge.y };
    assert.equal(resolveFabricationCombination(requested, requested, kit, 'scalar').status, 'rejected', `${type} rejects an off-board default mount`);
    assert.equal(mechanismUsesExactFabricationCombination(requested, kit), false, `${type} exactness validates concrete mount holes`);
  }
}

{
  const requested = {
    ...createDefaultMechanism('gear_linkage', 'paired-linkage-boundary'),
    gearTrainRadii: [60, 60],
    crankLength: 60,
    rockerLength: 60,
    groundLength: 140,
    couplerLength: 100,
  };
  const result = resolveFabricationCombination(requested, requested, kit, 'scalar');
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') {
    const linkagePart = result.mechanism.fabricationMetadata?.requiredParts?.find(part => part.part?.startsWith('linkages:'));
    assert(linkagePart && (linkagePart.quantity ?? linkagePart.count ?? 0) >= 2, 'gear-linkage persists the paired catalog linkage');
    assert.equal(mechanismUsesExactFabricationCombination({ ...result.mechanism, couplerLength: result.mechanism.couplerLength + 1 }, kit), false, 'gear-linkage exactness rejects an off-catalog linkage span');
    assert.equal(mechanismUsesExactFabricationCombination({ ...result.mechanism, groundLength: result.mechanism.groundLength + 1 }, kit), false, 'gear-linkage exactness rejects an off-board-hole ground span');
  }
}

{
  const sun = FABRICATION_GEAR_SPECS.find(spec => spec.teeth === FABRICATION_RING_GEAR_SPEC.compatibleSunTeeth);
  const planet = FABRICATION_GEAR_SPECS.find(spec => spec.teeth === FABRICATION_RING_GEAR_SPEC.compatiblePlanetTeeth);
  assert(sun && planet, 'planetary tuple has compatible manifest gears');
  assert.equal(FABRICATION_RING_GEAR_SPEC.key, 'ring-g8-g24');
  assert.equal(FABRICATION_RING_GEAR_SPEC.mountHoleCentersMm.length > 0, true);
  const result = resolveFabricationCombination(
    { ...createDefaultMechanism('planetary_gear', 'manifest-planetary'), crankLength: 93, rockerLength: 47, groundLength: 999 },
    { ...createDefaultMechanism('planetary_gear', 'manifest-planetary'), crankLength: 93, rockerLength: 47, groundLength: 999 },
    kit,
    'scalar',
  );
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted' && sun && planet) {
    const sunRadius = sun.pitchRadiusMm * SCENE_PX_PER_MM;
    const planetRadius = planet.pitchRadiusMm * SCENE_PX_PER_MM;
    assert.equal(result.mechanism.crankLength, sunRadius);
    assert.equal(result.mechanism.rockerLength, planetRadius);
    assert.equal(result.mechanism.groundLength, sunRadius + planetRadius);
    assert.equal(result.mechanism.gearRatio, planetaryCarrierOutputRatio(sunRadius, planetRadius));
    assert.equal(result.mechanism.speed2, planetaryPlanetSpinRatio(sunRadius, planetRadius));
  }
}

console.log('mechanism fabrication-combination contracts passed');

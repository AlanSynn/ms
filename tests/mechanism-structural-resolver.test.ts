import assert from 'node:assert/strict';
import type { ConnectionSelection, ConnectionSelectionRole, MechanismConfig, MechanismType, Point } from '../types';
import { defaultPhysicalKit, SCENE_PX_PER_MM } from '../utils/coordinates';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  authorMechanismConnectionSelection,
  connectionSelectionIdentity,
  connectionSelectionSceneCoordinates,
  connectionSelectionSignature,
  connectionSelectionRolesForMechanism,
  mechanismConnectionHoleCandidates,
  normalizeMechanismConnectionSelections,
  physicalConnectionForRole,
  physicalConnectionSignature,
  resolveMechanismPhysicalConnections,
} from '../utils/mechanismConnectionSelections';
import {
  compileMechanism,
  compileMechanismGraphFabrication,
  compileMechanismPhysicalInstances,
} from '../utils/mechanismCompiler';
import { mechanismGraphForMechanism, validateMechanismGraph } from '../utils/mechanismGraph';
import { buildMechanismPhysicalEnvelopeDescriptors } from '../utils/mechanismPhysicalEnvelope';
import { calculateLinkage } from '../utils/kinematics';

const SAMPLE_PHASE = 0.41;

const families = [
  { type: '4bar', movingRole: '4bar.input-joint' },
  { type: 'gear_linkage', movingRole: 'gear_linkage.drive-pin' },
  { type: 'gear', movingRole: 'gear.drive-pin' },
  { type: 'planetary_gear', movingRole: 'planetary_gear.carrier-output-hole' },
  { type: 'cam', movingRole: 'cam.follower-output-hole' },
  { type: 'piston', movingRole: 'piston.crank-pin' },
] as const satisfies readonly { type: MechanismType; movingRole: ConnectionSelectionRole }[];

const withResolvedDefaults = (type: MechanismType): MechanismConfig => {
  const seed = createDefaultMechanism(type, `structural-${type}`);
  return {
    ...seed,
    ...normalizeMechanismConnectionSelections(
      seed,
      seed.connectionSelections,
      seed.connectionSelectionValidation,
    ),
  };
};

const pointDistance = (left: Point | undefined, right: Point | undefined) =>
  !left || !right ? 0 : Math.hypot(left.x - right.x, left.y - right.y);

const samePose = (
  left: { translationMm: Point; rotationRad: number } | undefined,
  right: { translationMm: Point; rotationRad: number } | undefined,
) => {
  if (!left || !right) return false;
  return pointDistance(left.translationMm, right.translationMm) < 1e-6
    && Math.abs(left.rotationRad - right.rotationRad) < 1e-6;
};

const invalidVariant = (selection: ConnectionSelection): ConnectionSelection => {
  switch (selection.kind) {
    case 'linkage-hole':
      return { ...selection, holeIndex: 999 };
    case 'gear-attachment-hole':
      return { ...selection, gearKey: 'g8' };
    case 'board-mount-pattern':
      return { ...selection, boardHoleIds: [...selection.boardHoleIds].reverse() };
    case 'module-hole':
      return { ...selection, holeId: 'not-an-output' } as unknown as ConnectionSelection;
  }
};

const assertAtomicRejection = (
  prior: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
) => {
  const priorState = calculateLinkage(prior, SAMPLE_PHASE);
  const result = authorMechanismConnectionSelection(prior, role, selection);
  assert(result.rejection, `${role} returns bounded transient rejection data`);
  assert.equal(result.rejection.diagnostic.role, role);
  assert.equal(Object.keys(result).length, 0, `${role} rejection exposes no persisted update`);
  assert.equal(JSON.stringify(result), '{}', `${role} rejection stays out of persistence`);
  const retained = { ...prior, ...result };
  assert.deepEqual(retained, prior, `${role} rejection retains the exact prior mechanism`);
  assert.deepEqual(
    calculateLinkage(retained, SAMPLE_PHASE),
    priorState,
    `${role} rejection retains the exact prior sampled geometry`,
  );
};

const assertPipeline = (mechanism: MechanismConfig) => {
  const resolved = resolveMechanismPhysicalConnections(mechanism);
  assert(resolved.valid, `${mechanism.type} resolves every required physical role`);
  const selectionSignature = connectionSelectionSignature(resolved.selections);
  const sourceSignature = physicalConnectionSignature(resolved.connections);
  const graph = mechanismGraphForMechanism(mechanism);
  const graphSummary = graph.connectionSelectionSummary;
  assert(graphSummary, `${mechanism.type} graph carries the shared selection summary`);
  assert.equal(connectionSelectionSignature(graphSummary.connectionSelections), selectionSignature);
  assert.equal(graphSummary.physicalConnectionSignature, sourceSignature);
  assert.equal(
    physicalConnectionSignature(graphSummary.physicalConnections),
    sourceSignature,
    `${mechanism.type} graph signature uses the resolved source records`,
  );
  assert.deepEqual(
    validateMechanismGraph(graph).diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [],
    `${mechanism.type} graph has no structural-source errors`,
  );

  const fabrication = compileMechanismGraphFabrication(mechanism);
  assert(fabrication.buildable, `${mechanism.type} structural sources compile into a buildable stack`);
  const renderSummary = fabrication.renderPlan.connectionSelectionSummary;
  assert(renderSummary, `${mechanism.type} render plan carries the shared selection summary`);
  assert.equal(connectionSelectionSignature(renderSummary.connectionSelections), selectionSignature);
  assert.equal(renderSummary.physicalConnectionSignature, sourceSignature);
  assert.equal(
    physicalConnectionSignature(renderSummary.physicalConnections),
    sourceSignature,
    `${mechanism.type} render signature matches the graph signature`,
  );
  assert(fabrication.recipe, `${mechanism.type} has a compiled fabrication recipe`);

  const compiled = compileMechanism(mechanism, [0, SAMPLE_PHASE]);
  const compiledSummary = compiled.graph.connectionSelectionSummary;
  assert(compiledSummary, `${mechanism.type} compiled graph keeps the shared selection summary`);
  assert.equal(compiledSummary.physicalConnectionSignature, sourceSignature);
  assert.equal(
    compiled.fabrication.renderPlan.connectionSelectionSummary?.physicalConnectionSignature,
    sourceSignature,
    `${mechanism.type} compiler and render-plan signatures agree`,
  );

  const physical = compileMechanismPhysicalInstances(mechanism, SAMPLE_PHASE);
  const envelopes = buildMechanismPhysicalEnvelopeDescriptors(
    mechanism,
    [0, SAMPLE_PHASE],
    fabrication.renderPlan,
    defaultPhysicalKit(),
  );
  for (const connection of resolved.connections) {
    const graphNode = graph.nodes.find((node) => node.id === connection.sourceNodeId);
    assert(graphNode, `${connection.role} has graph source node ${connection.sourceNodeId}`);
    const constraints = graph.constraints.filter((constraint) =>
      constraint.nodes.includes(connection.sourceNodeId)
      || (constraint.role === 'distance' && constraint.fabricatedPartNodeId === connection.sourceNodeId),
    );
    assert(constraints.length > 0, `${connection.role} has a real graph constraint`);

    const layer = fabrication.renderPlan.layers.find((candidate) =>
      candidate.sourceNodeId === connection.sourceNodeId
      && candidate.partKey === connection.partKey,
    );
    assert(layer, `${connection.role} maps to its selected render layer and printable part`);
    assert(layer.sourceConstraintIds.some((id) => constraints.some((constraint) => constraint.id === id)));
    assert(layer.supportPathIds.length > 0, `${connection.role} render layer belongs to a fabrication stack`);
    assert(fabrication.recipe.requiredParts.some((part) => part.part === connection.partKey));
    assert(physical.definitions.some((definition) => definition.partKey === connection.partKey));
    assert(physical.instances.some((instance) =>
      instance.sourceNodeId === connection.sourceNodeId && instance.partKey === connection.partKey,
    ));
    assert(envelopes.some((descriptor) => descriptor.sourceNodeId === connection.sourceNodeId));
  }
  return { resolved, sourceSignature };
};

for (const family of families) {
  const mechanism = withResolvedDefaults(family.type);
  const atZero = calculateLinkage(mechanism, 0);
  const atSample = calculateLinkage(mechanism, SAMPLE_PHASE);
  assert(atZero.isValid && atSample.isValid, `${family.type} has finite sampled geometry`);

  const candidates = mechanismConnectionHoleCandidates(mechanism, atSample);
  const roles = connectionSelectionRolesForMechanism(family.type);
  assert.deepEqual(
    [...new Set(candidates.map((candidate) => candidate.role))].sort(),
    [...roles].sort(),
    `${family.type} exposes only its shared structural roles`,
  );
  for (const role of roles) {
    const selected = candidates.find((candidate) => candidate.role === role && candidate.selected);
    assert(selected, `${role} has a legal selected real candidate`);
    assert.equal(selected.legal, true);
    assert.equal(selected.identity, connectionSelectionIdentity(role, selected.selection));
    const connection = physicalConnectionForRole(resolveMechanismPhysicalConnections(mechanism), role);
    assert(connection, `${role} resolves a real source record`);
    assert.equal(selected.sourceNodeId, connection.sourceNodeId);
    assert.equal(selected.printedPartKey, connection.partKey);
  }

  const pipeline = assertPipeline(mechanism);
  const movingCandidate = candidates.find((candidate) =>
    candidate.role === family.movingRole && candidate.recoveryEligible,
  );
  assert(movingCandidate, `${family.movingRole} offers a second real physical choice`);
  const selectedAtZero = connectionSelectionSceneCoordinates(mechanism, atZero)[family.movingRole];
  const selectedAtSample = connectionSelectionSceneCoordinates(mechanism, atSample)[family.movingRole];
  assert(pointDistance(selectedAtZero, selectedAtSample) > 1e-4, `${family.movingRole} moves through sampled source geometry`);

  const sourceNodeId = movingCandidate.sourceNodeId;
  const zeroInstance = compileMechanismPhysicalInstances(mechanism, 0).instances.find(
    (instance) => instance.sourceNodeId === sourceNodeId,
  );
  const sampleInstance = compileMechanismPhysicalInstances(mechanism, SAMPLE_PHASE).instances.find(
    (instance) => instance.sourceNodeId === sourceNodeId,
  );
  assert(!samePose(zeroInstance?.pose, sampleInstance?.pose), `${family.movingRole} moves its real source instance`);

  const update = authorMechanismConnectionSelection(
    mechanism,
    movingCandidate.role,
    movingCandidate.selection,
  );
  assert.equal(update.rejection, undefined, `${family.movingRole} accepts a legal candidate`);
  const changed = { ...mechanism, ...update };
  const changedState = calculateLinkage(changed, SAMPLE_PHASE);
  assert(changedState.isValid, `${family.movingRole} keeps the sampled mechanism valid`);
  const changedCoordinate = connectionSelectionSceneCoordinates(changed, changedState)[family.movingRole];
  assert(pointDistance(selectedAtSample, changedCoordinate) > 1e-4, `${family.movingRole} changes source geometry through the selected asset`);
  const changedPipeline = assertPipeline(changed);
  assert.notEqual(changedPipeline.sourceSignature, pipeline.sourceSignature, `${family.movingRole} changes the compiler source signature`);

  assertAtomicRejection(mechanism, family.movingRole, invalidVariant(movingCandidate.selection));
  const mountCandidate = candidates.find((candidate) => candidate.kind === 'board-mount-pattern');
  if (mountCandidate) assertAtomicRejection(mechanism, mountCandidate.role, invalidVariant(mountCandidate.selection));
}

const cam = withResolvedDefaults('cam');
const camGuide = physicalConnectionForRole(resolveMechanismPhysicalConnections(cam), 'cam.guide-mount');
assert(camGuide?.boardMount);
assert.deepEqual(camGuide.selection, {
  kind: 'board-mount-pattern', mountKey: 'cam-guide-2-hole', boardHoleIds: ['J11', 'J9'],
});
assert.equal(camGuide.boardMount.length, 2 * 20 * SCENE_PX_PER_MM, 'cam guide uses its approved two-pitch source vector');
assert(Math.abs(camGuide.boardMount.sourceRotation) < 1e-9, 'cam mount transform derives from the ordered source tuple');
const camGuideConstraint = mechanismGraphForMechanism(cam).constraints.find((constraint) => constraint.id === 'follower-guide-slide');
assert(camGuideConstraint?.vector);
assert(Math.abs((camGuideConstraint.vector?.x ?? Number.NaN)) < 1e-9);
assert(Math.abs((camGuideConstraint.vector?.y ?? Number.NaN) - 1) < 1e-9);
const camScalarNoise = calculateLinkage({ ...cam, groundAngle: -137 }, SAMPLE_PHASE);
assert.deepEqual(camScalarNoise, calculateLinkage(cam, SAMPLE_PHASE), 'cam guide geometry does not fall back to groundAngle');

const piston = withResolvedDefaults('piston');
const pistonGuide = physicalConnectionForRole(resolveMechanismPhysicalConnections(piston), 'piston.guide-mount');
assert(pistonGuide?.boardMount);
assert.deepEqual(pistonGuide.selection, {
  kind: 'board-mount-pattern', mountKey: 'piston-guide-3-hole', boardHoleIds: ['G11', 'G12', 'G13'],
});
assert(Math.abs(Math.abs(pistonGuide.boardMount.sourceRotation) - Math.PI / 2) < 1e-9, 'vertical board tuple rotates the horizontal piston source guide');
const pistonGuideConstraint = mechanismGraphForMechanism(piston).constraints.find((constraint) => constraint.id === 'slider-guide');
assert(pistonGuideConstraint?.vector);
assert(Math.abs((pistonGuideConstraint.vector?.x ?? Number.NaN) - Math.cos(pistonGuide.boardMount.sourceRotation)) < 1e-9);
assert(Math.abs((pistonGuideConstraint.vector?.y ?? Number.NaN) - Math.sin(pistonGuide.boardMount.sourceRotation)) < 1e-9);
const pistonScalarNoise = calculateLinkage({ ...piston, groundAngle: 137 }, SAMPLE_PHASE);
assert.deepEqual(pistonScalarNoise, calculateLinkage(piston, SAMPLE_PHASE), 'piston guide geometry derives from its selected tuple, not groundAngle');

console.log('mechanism structural resolver contracts passed');

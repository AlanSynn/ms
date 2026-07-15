import assert from 'node:assert/strict';
import type { MechanismConfig, MechanismType, ProjectState } from '../types';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { generateProjectReadyDXF, generateProjectReadySVG } from '../utils/exporter';
import { createFabricationPackage } from '../utils/fabrication';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { mechanismWithGeneratedPath } from '../utils/mechanismGeneratedPath';
import { fitMechanismToTargetPathResult, fitRecommendedMechanismToSheet } from '../utils/mechanismRecommendations';
import { normalizeMechanismToReference } from '../utils/mechanismReference';
import { resolveMechanismRuntimeGate } from '../utils/mechanismRuntimePolicy';
import { buildProjectMechanismSceneContract } from '../utils/mechanismSceneContract';
import { buildKinematicPhysicsSession } from '../utils/physicsSession';
import { applyProjectAction, createLessonProject, createSampleProject } from '../utils/project';
import { buildToonSceneProjection } from '../utils/sceneProjection';

const canonicalFamilies: MechanismType[] = [
  '4bar',
  'gear_linkage',
  'gear',
  'planetary_gear',
  'cam',
  'piston',
];

const canonicalProject = (type: MechanismType): { project: ProjectState; mechanism: MechanismConfig } => {
  const sample = createSampleProject();
  const emptyProject: ProjectState = {
    ...sample,
    mechanisms: [],
    selectedMechanismId: undefined,
    settings: {
      ...sample.settings,
      physicalKit: {
        ...sample.settings.physicalKit,
        profileKey: `g005-${type}`,
        sheetWidthMm: 1_000,
        sheetHeightMm: 1_000,
        boardCells: 41,
      },
    },
  };
  const bound = mechanismWithGeneratedPath({
    ...normalizeMechanismToReference(createDefaultMechanism(type, `g005-${type}`)),
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    activeVisualPartIds: ['right_hand_part'],
  });
  const mechanism = fitRecommendedMechanismToSheet(emptyProject, bound);
  return {
    mechanism,
    project: { ...emptyProject, mechanisms: [mechanism], selectedMechanismId: mechanism.id },
  };
};

const projectionPathSegment = (value: string) => value.replace(/[^A-Za-z0-9_.:>-]/g, '_');
const projectedInstanceKey = (instance: { layerId?: string; instanceId: string; sourceNodeId?: string }) =>
  `${instance.layerId ?? projectionPathSegment(instance.instanceId)}:${instance.sourceNodeId ?? ''}`;

for (const type of canonicalFamilies) {
  const { project, mechanism } = canonicalProject(type);
  const gate = resolveMechanismRuntimeGate(project, mechanism);
  assert.equal(gate.canDriveProject, true, `${type} canonical fixture is fully bound`);
  assert.equal(gate.canRunBoundPhysics, true, `${type} canonical fixture can enter bound physics`);

  const contract = buildProjectMechanismSceneContract(project, mechanism.id, undefined, 0.37);
  assert(contract, `${type} has a full-project scene contract`);
  assert.equal(contract.runtimeMode, 'bound');
  assert.equal(contract.projectDriveEnabled, true);
  assert.equal(contract.boundPhysicsEnabled, true);
  assert(contract.layers.length > 1, `${type} compiler emits a board plus physical layers`);
  assert(contract.compilerSignature.length > 0, `${type} compiler signature is stable and non-empty`);
  assert.deepEqual(
    contract.layers.map(layer => ({
      layerId: layer.layerId,
      sourceNodeId: layer.sourceNodeId,
      partKey: layer.partKey,
      backFaceMm: layer.backFaceMm,
      frontFaceMm: layer.frontFaceMm,
    })),
    [contract.renderPlan.base, ...contract.renderPlan.layers].map(layer => ({
      layerId: layer.layerId,
      sourceNodeId: layer.sourceNodeId,
      partKey: layer.partKey,
      backFaceMm: layer.backFaceMm,
      frontFaceMm: layer.frontFaceMm,
    })),
    `${type} scene layers preserve the canonical source-node, part, and z-stack compiler output`,
  );

  const projection = buildToonSceneProjection(project);
  const projectedMechanismNodes = projection.nodes.filter(node => node.sourceId === mechanism.id);
  assert(projectedMechanismNodes.length > 0, `${type} reaches Three/scene projection`);
  assert(
    projectedMechanismNodes.every(node =>
      node.exportRole === 'fabrication' &&
      node.mechanismRuntimeMode === 'bound' &&
      node.mechanismCompilerSignature === contract.compilerSignature),
    `${type} scene projection preserves the bound compiler signature and export role`,
  );
  const expectedInstanceKeys = contract.physicalInstances
    .filter(instance => instance.kind !== 'base')
    .map(projectedInstanceKey)
    .sort();
  const projectedInstanceKeys = projectedMechanismNodes
    .map(node => `${node.mechanismLayerId ?? node.id.split('/').at(-1) ?? ''}:${node.mechanismSourceNodeId ?? ''}`)
    .sort();
  assert.deepEqual(projectedInstanceKeys, expectedInstanceKeys, `${type} scene projection consumes the exact canonical physical instances`);

  const physics = buildKinematicPhysicsSession(project, projection, 0.37);
  assert.equal(physics.summary.activeMechanismCount, 1, `${type} enters bound physics exactly once`);
  assert.deepEqual(physics.summary.mechanismCompilerSignatures, [contract.compilerSignature]);

  const pkg = createFabricationPackage(project);
  const metadata = JSON.parse(pkg.metadataJson) as {
    mechanismSceneContracts: Array<{
      compilerSignature: string;
      stackSummary: string;
      layers: Array<{ layerId: string; sourceNodeId?: string }>;
    }>;
  };
  assert.equal(metadata.mechanismSceneContracts.length, 1);
  const packagedContract = metadata.mechanismSceneContracts[0]!;
  assert.equal(packagedContract.compilerSignature, contract.compilerSignature, `${type} package keeps the scene compiler signature`);
  assert.equal(packagedContract.stackSummary, contract.stackSummary, `${type} package keeps the canonical stack summary`);
  assert.deepEqual(
    packagedContract.layers.map(layer => [layer.layerId, layer.sourceNodeId]),
    contract.layers.map(layer => [layer.layerId, layer.sourceNodeId]),
    `${type} package keeps exact layer/source-node ownership`,
  );

  const svg = generateProjectReadySVG(project, 0.37);
  const dxf = generateProjectReadyDXF(project, 0.37);
  assert.equal(svg.ok, true, `${type} bound SVG export succeeds`);
  assert.equal(dxf.ok, true, `${type} bound DXF export succeeds`);
  assert('artifact' in svg && svg.artifact.includes(contract.compilerSignature), `${type} SVG carries the compiler signature`);
  assert('artifact' in dxf && dxf.artifact.includes(contract.compilerSignature), `${type} DXF carries the compiler signature`);
  for (const layer of contract.layers.filter(layer => layer.layerId !== contract.renderPlan.base.layerId)) {
    assert('artifact' in svg && svg.artifact.includes(`data-layer-id="${layer.layerId}"`), `${type} SVG carries layer ${layer.layerId}`);
    if (layer.sourceNodeId) {
      assert('artifact' in svg && svg.artifact.includes(`data-source-node-id="${layer.sourceNodeId}"`), `${type} SVG carries source node ${layer.sourceNodeId}`);
    }
  }
}

let kitChangedProject = createLessonProject('waving-arm');
kitChangedProject = applyProjectAction(kitChangedProject, {
  type: 'update_settings',
  settings: {
    physicalKit: { ...kitChangedProject.settings.physicalKit, gridPitchMm: 25 },
  },
});
const kitChangedPrior = kitChangedProject.mechanisms[0]!;
const kitChangedFit = fitMechanismToTargetPathResult(
  kitChangedProject,
  kitChangedPrior,
  kitChangedPrior.targetPathId,
);
assert.equal(kitChangedFit.accepted, true, 'active-kit fit produces a valid authoritative mechanism');
kitChangedProject = applyProjectAction(kitChangedProject, {
  type: 'upsert_mechanism',
  mechanism: kitChangedFit.mechanism,
});
const kitChangedMechanism = kitChangedProject.mechanisms[0]!;
const kitChangedContract = buildProjectMechanismSceneContract(kitChangedProject, kitChangedMechanism.id);
const kitChangedAutomata = buildAutomataSceneModel(kitChangedProject, kitChangedMechanism, 0.37);
assert(kitChangedContract?.projectDriveEnabled, 'active-kit fit remains bound at the project scene gate');
assert.equal(kitChangedAutomata.mechanism?.groundLength, kitChangedMechanism.groundLength);
assert.equal(kitChangedAutomata.foundryPreview?.mechanism.groundLength, kitChangedMechanism.groundLength);
assert.equal(
  kitChangedAutomata.mechanismContract?.compilerSignature,
  kitChangedContract.compilerSignature,
  'Design/Assembly preview preserves the active-kit ProjectState compiler signature without default-kit renormalization',
);

console.log('mechanism project consumer parity contracts passed');

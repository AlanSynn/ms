import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FabricationPackage, FoundryExportPackage, ProjectState } from '../types';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { generateProjectReadyDXF, generateProjectReadySVG } from '../utils/exporter';
import { createFabricationPackage } from '../utils/fabrication';
import { buildMechanismSnapshot } from '../utils/mechanismSnapshot';
import { mechanismBindingWarnings, motionPreviewForProject } from '../utils/motion';
import { projectMechanismReadiness } from '../utils/mechanismReadiness';
import {
  assessProjectMechanismRuntime,
  resolveMechanismRuntimeGate,
  runtimeMechanisms,
} from '../utils/mechanismRuntimePolicy';
import {
  buildLowLevelMechanismSceneContract,
  buildProjectMechanismSceneContract,
} from '../utils/mechanismSceneContract';
import {
  applyProjectAction,
  createDefaultMechanism,
  createLessonProject,
  createSampleProject,
  loadProjectSnapshot,
  mechanismWithGeneratedPath,
  serializeProject,
} from '../utils/project';
import { readAutosaveProject, STORAGE_KEYS } from '../utils/projectPersistence';
import { buildKinematicPhysicsSession } from '../utils/physicsSession';
import { buildToonSceneProjection } from '../utils/sceneProjection';

const current = createSampleProject();
const validV2 = JSON.parse(serializeProject(current));
const malformedV2: unknown[] = [
  null,
  [],
  { version: 2 },
  { ...validV2, metadata: [] },
  { ...validV2, parts: [] },
  { ...validV2, parts: { broken: null } },
  { ...validV2, paths: [] },
  { ...validV2, paths: { broken: 'path' } },
  { ...validV2, mechanisms: {} },
  { ...validV2, mechanisms: [null] },
  { ...validV2, partOrder: {} },
  { ...validV2, skeleton: [] },
  { ...validV2, skeleton: { joints: [] } },
  { ...validV2, settings: [] },
  { ...validV2, selectedPartId: 42 },
];

for (const raw of [...malformedV2, { version: 99, mechanisms: [] }]) {
  const result = loadProjectSnapshot(raw, current);
  assert.equal(result.status, 'rejected');
  assert.strictEqual(result.project, current, 'rejected raw ingress preserves the exact aggregate object');
  assert.strictEqual(
    applyProjectAction(current, { type: 'load_project', project: raw }),
    current,
    'the reducer installs only a loaded typed result',
  );
}
assert.throws(
  () => loadProjectSnapshot({ version: 2, mechanisms: {} }),
  /invalid-snapshot/,
  'the trusted one-argument convenience fails closed instead of returning an empty project',
);

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});
try {
  for (const raw of ['{bad json', JSON.stringify({ version: 99, mechanisms: [] })]) {
    storage.set(STORAGE_KEYS.autosave, raw);
    const result = readAutosaveProject(current);
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.strictEqual(result.project, current);
  }
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
}

const lesson = createLessonProject('waving-arm');
const lessonMechanism = lesson.mechanisms[0]!;
const stalePackage = {
  id: 'g008-stale',
  createdAt: '2026-07-14T00:00:00.000Z',
  mechanismId: lessonMechanism.id,
  mechanismType: lessonMechanism.type,
  parameters: lessonMechanism,
  pivot: { x: lessonMechanism.anchorX ?? 0, y: lessonMechanism.anchorY ?? 0 },
  generatedPath: [{ x: 90_001, y: 90_002 }],
  simulationSummary: 'stale',
  visual: { color: lessonMechanism.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1, steps: 1, loop: true },
  metadata: { sourceTab: 'test', connectionExportSignature: 'stale' },
  warnings: ['stale'],
  source: 'mechanism-foundry',
} satisfies FoundryExportPackage;

const loadedProject = (raw: unknown): ProjectState => {
  const result = loadProjectSnapshot(raw, current);
  assert.equal(result.status, 'loaded');
  if (result.status !== 'loaded') throw new Error('expected loaded project');
  return result.project;
};

const importedBound = loadedProject({
  ...lesson,
  mechanisms: [{
    ...lessonMechanism,
    foundryExport: stalePackage,
    generatedPath: [{ x: 90_001, y: 90_002 }],
    fabricationMetadata: { boardCoordinate: 'Z99', warnings: ['stale'] },
    warnings: ['stale'],
  }],
  lastFoundryExport: stalePackage,
  lastExport: { id: 'stale-export' } as FabricationPackage,
});
const rebound = importedBound.mechanisms[0]!;
assert.equal(rebound.foundryExport, undefined, 'external load never trusts a cached Foundry package');
assert.equal(importedBound.lastFoundryExport, undefined);
assert.equal(importedBound.lastExport, undefined);
assert.notDeepEqual(rebound.generatedPath, [{ x: 90_001, y: 90_002 }], 'bound imports rebuild stale generated motion');
assert.notEqual(rebound.fabricationMetadata?.boardCoordinate, 'Z99', 'bound imports rebuild stale fabrication metadata');
assert.deepEqual(rebound.warnings, [], 'bound imports drop stale runtime warnings');

const customKit = {
  ...lesson.settings.physicalKit,
  profileKey: 'custom-21x21-25mm',
  boardCells: 21,
  gridPitchMm: 25,
  sheetWidthMm: 800,
  sheetHeightMm: 800,
} satisfies ProjectState['settings']['physicalKit'];
const customCam = {
  ...createDefaultMechanism('cam', 'g008-custom-kit-cam'),
  anchorX: 0,
  anchorY: 0,
  transform: { x: 0, y: 0, rotation: 90, scale: 1 },
  sceneAnchor: { x: 0, y: 0 },
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
  activeVisualPartIds: ['right_hand_part'],
  generatedPath: [{ x: 90_001, y: 90_002 }],
};
const customKitProject = loadedProject({
  ...lesson,
  settings: { ...lesson.settings, physicalKit: customKit },
  mechanisms: [customCam],
  selectedMechanismId: customCam.id,
});
const importedCustomCam = customKitProject.mechanisms[0]!;
const importedGuide = importedCustomCam.connectionSelections?.['cam.guide-mount'];
assert.equal(importedGuide?.kind, 'board-mount-pattern');
if (importedGuide?.kind !== 'board-mount-pattern') throw new Error('expected custom-kit guide mount');
assert.deepEqual(
  importedGuide.boardHoleIds,
  ['P13', 'P11'],
  'import selection defaults use the serialized 21-cell kit instead of the 15-cell fallback',
);
assert.equal(resolveMechanismRuntimeGate(customKitProject, importedCustomCam).canDriveProject, true);
const expectedCustomPath = mechanismWithGeneratedPath(
  { ...importedCustomCam, generatedPath: undefined },
  { kit: customKit },
).generatedPath;
assert.deepEqual(importedCustomCam.generatedPath, expectedCustomPath, 'import rebuilds motion with the serialized 25mm pitch');
const customSnapshot = buildMechanismSnapshot(customKitProject, importedCustomCam.id);
assert.deepEqual(customSnapshot?.physicalKit, customKit, 'mechanism snapshots retain the complete active custom kit');
assert.deepEqual(
  customSnapshot?.mechanism.connectionSelections?.['cam.guide-mount'],
  importedGuide,
  'snapshot revalidation uses the same active-kit connection selection',
);
const customRoundTrip = loadedProject(JSON.parse(serializeProject(customKitProject)));
assert.deepEqual(customRoundTrip.settings.physicalKit, customKit);
assert.deepEqual(customRoundTrip.mechanisms[0]?.generatedPath, expectedCustomPath, 'custom-kit generated motion round-trips canonically');

const changedKit = { ...customKit, profileKey: 'custom-21x21-30mm', gridPitchMm: 30 };
const changedKitProject = applyProjectAction(customKitProject, {
  type: 'update_settings',
  settings: { physicalKit: changedKit },
});
const changedKitCam = changedKitProject.mechanisms[0]!;
const expectedChangedPath = mechanismWithGeneratedPath(
  { ...changedKitCam, generatedPath: undefined },
  { kit: changedKit },
).generatedPath;
assert.equal(resolveMechanismRuntimeGate(changedKitProject, changedKitCam).canDriveProject, true);
assert.deepEqual(changedKitCam.generatedPath, expectedChangedPath, 'kit changes rebuild stored motion with the new pitch');
assert.notDeepEqual(changedKitCam.generatedPath, importedCustomCam.generatedPath, 'motion never keeps the prior-kit generated path');

for (const unsafe of [
  { ...lessonMechanism, targetPathId: 'missing-path' },
  { ...lessonMechanism, groundLength: -1 },
]) {
  const imported = loadedProject({
    ...lesson,
    mechanisms: [{
      ...unsafe,
      foundryExport: stalePackage,
      generatedPath: [{ x: 90_001, y: 90_002 }],
      fabricationMetadata: { boardCoordinate: 'Z99' },
    }],
    lastFoundryExport: stalePackage,
    lastExport: { id: 'stale-export' } as FabricationPackage,
  });
  assert.equal(imported.mechanisms[0]?.foundryExport, undefined);
  assert.equal(imported.mechanisms[0]?.generatedPath, undefined);
  assert.equal(imported.mechanisms[0]?.fabricationMetadata, undefined);
  assert.equal(imported.lastFoundryExport, undefined);
  assert.equal(imported.lastExport, undefined);
}

const unsafeWithArtifacts = {
  ...lesson,
  mechanisms: [{
    ...lessonMechanism,
    groundLength: -1,
    foundryExport: stalePackage,
    generatedPath: [{ x: 90_001, y: 90_002 }],
    fabricationMetadata: { boardCoordinate: 'Z99' },
    warnings: ['stale'],
  }],
  lastFoundryExport: stalePackage,
  lastExport: { id: 'stale-export' } as FabricationPackage,
};
const staticRecoveryProject = loadedProject(unsafeWithArtifacts);
const staticRecoveryMechanism = staticRecoveryProject.mechanisms[0]!;
assert.equal(staticRecoveryMechanism.groundLength, -1, 'finite unsafe authored geometry persists for recovery');
assert.equal(staticRecoveryMechanism.generatedPath, undefined);
assert.equal(staticRecoveryMechanism.foundryExport, undefined);
assert.equal(staticRecoveryMechanism.fabricationMetadata, undefined);
assert.deepEqual(staticRecoveryMechanism.warnings, []);
assert.equal(staticRecoveryProject.lastFoundryExport, undefined);
assert.equal(staticRecoveryProject.lastExport, undefined);
const staticGate = resolveMechanismRuntimeGate(staticRecoveryProject, staticRecoveryMechanism);
assert.equal(staticGate.canSimulateMechanism, false);
assert.equal(staticGate.canDriveProject, false);
assert.equal(staticGate.canProjectScene, true, 'finite geometry remains recovery-projectable');
assert.equal(staticGate.canRunBoundPhysics, false);
assert.equal(staticGate.projection, 'static-recovery');
assert.equal(staticGate.blocker, 'Fix mechanism geometry');
const staticContract = buildProjectMechanismSceneContract(staticRecoveryProject, staticRecoveryMechanism.id, undefined, Math.PI / 2);
const zeroContract = buildProjectMechanismSceneContract(staticRecoveryProject, staticRecoveryMechanism.id, undefined, 0);
assert.equal(staticContract?.runtimeMode, 'static-recovery');
assert.equal(staticContract?.runtimeBlocker, 'Fix mechanism geometry');
assert.equal(staticContract?.projectDriveEnabled, false);
assert.equal(staticContract?.boundPhysicsEnabled, false);
assert((staticContract?.physicalInstances.length ?? 0) > 0, 'finite unsafe geometry remains visibly projectable');
assert.deepEqual(staticContract?.physicalInstances, zeroContract?.physicalInstances, 'static recovery is fixed at zero angle');
const staticAutomata = buildAutomataSceneModel(staticRecoveryProject, staticRecoveryMechanism, Math.PI / 2);
assert.equal(staticAutomata.mechanism, undefined);
assert.equal(staticAutomata.recoveryMechanism?.id, staticRecoveryMechanism.id);
assert(staticAutomata.foundryPreview, 'automata exposes the static recovery mechanism');
assert.deepEqual(staticAutomata.animatedParts, {});
assert.deepEqual(staticAutomata.animatedSceneObjects, {});
assert.deepEqual(staticAutomata.skeleton, staticRecoveryProject.skeleton);
assert.equal(staticAutomata.mechanismContract?.runtimeMode, 'static-recovery');
const staticMotion = motionPreviewForProject(staticRecoveryProject, staticRecoveryProject.mechanisms, Math.PI / 2);
assert.deepEqual(staticMotion.parts, {}, 'recovery geometry cannot drive character motion');
assert.deepEqual(staticMotion.sceneObjects, {});
assert.deepEqual(staticMotion.skeleton, staticRecoveryProject.skeleton);
assert.deepEqual(staticMotion.warnings?.[staticRecoveryMechanism.id], ['Fix mechanism geometry']);
const staticProjection = buildToonSceneProjection(staticRecoveryProject);
const staticNodes = staticProjection.nodes.filter((node) => node.sourceId === staticRecoveryMechanism.id);
assert(staticNodes.length > 0, 'scene projection renders finite unsafe geometry');
assert(staticNodes.every((node) => node.exportRole === 'preview-only' && node.mechanismRuntimeMode === 'static-recovery'));
assert(
  staticProjection.warnings.some((warning) =>
    warning.sourceId === staticRecoveryMechanism.id && warning.message === 'Fix mechanism geometry'),
  'scene projection surfaces the direct geometry recovery blocker',
);
const staticPhysics = buildKinematicPhysicsSession(staticRecoveryProject, staticProjection);
assert.equal(staticPhysics.summary.activeMechanismCount, 0);
assert(!staticPhysics.bodies.some((body) => body.mechanismId === staticRecoveryMechanism.id));
for (const guardedExport of [
  generateProjectReadySVG(staticRecoveryProject, Math.PI / 2),
  generateProjectReadyDXF(staticRecoveryProject, Math.PI / 2),
]) {
  assert.equal(guardedExport.ok, false, 'static recovery blocks direct mechanism export');
  assert('blockers' in guardedExport && guardedExport.blockers.length > 0);
}
assert.throws(
  () => createFabricationPackage(staticRecoveryProject),
  /geometry/i,
  'static recovery cannot produce a fabrication package',
);

const invalidatedUnsafe = applyProjectAction(unsafeWithArtifacts, {
  type: 'set_skeleton',
  skeleton: unsafeWithArtifacts.skeleton,
});
assert.equal(invalidatedUnsafe.mechanisms[0]?.foundryExport, undefined);
assert.equal(invalidatedUnsafe.mechanisms[0]?.generatedPath, undefined);
assert.equal(invalidatedUnsafe.mechanisms[0]?.fabricationMetadata, undefined);
assert.equal(invalidatedUnsafe.lastFoundryExport, undefined);
assert.equal(invalidatedUnsafe.lastExport, undefined);

const duplicate = { ...lessonMechanism, id: 'g008-duplicate-driver' };
const duplicateProject = {
  ...lesson,
  mechanisms: [lessonMechanism, duplicate],
  selectedMechanismId: lessonMechanism.id,
};
const assessment = assessProjectMechanismRuntime(duplicateProject);
assert.equal(assessment.gates.get(lessonMechanism.id)?.canDriveProject, false);
assert.equal(assessment.gates.get(duplicate.id)?.canDriveProject, false);
assert.deepEqual(assessment.runtimeMechanisms, []);
assert.deepEqual(runtimeMechanisms(duplicateProject), []);
assert.deepEqual(mechanismBindingWarnings(duplicateProject), {
  [lessonMechanism.id]: ['Fix: Choose anchor'],
  [duplicate.id]: ['Fix: Choose anchor'],
});
assert(
  projectMechanismReadiness(duplicateProject).mechanisms.every((item) =>
    item.blockers.includes('Fix: Choose anchor')),
  'readiness consumes the same duplicate-driver assessment',
);

const contract = buildProjectMechanismSceneContract(lesson, lessonMechanism.id);
assert(contract);
const serializedContract = JSON.parse(JSON.stringify(contract)) as typeof contract;
assert(serializedContract.layers.every((layer) => typeof layer.partKey === 'string' && layer.partKey.length > 0));
assert.equal(serializedContract.physicalConnectionSignature, contract.physicalConnectionSignature);
assert(serializedContract.physicalConnectionSignature.length > 0);
assert.deepEqual(
  serializedContract.connectionSourceNodes.map((connection) => connection.role),
  [...serializedContract.connectionSourceNodes.map((connection) => connection.role)].sort(),
  'physical source mappings serialize in deterministic role order',
);
for (const connection of serializedContract.connectionSourceNodes) {
  const layer = serializedContract.layers.find((item) => item.layerId === connection.layerId);
  assert(layer, `${connection.role} names a serialized compiler layer`);
  assert.equal(layer.sourceNodeId, connection.sourceNodeId);
  assert.equal(layer.partKey, connection.partKey);
  assert.equal(layer.stackOccurrenceId, connection.stackOccurrenceId);
}
const packageMetadata = JSON.parse(createFabricationPackage(lesson).metadataJson) as {
  mechanismSceneContracts: Array<{
    physicalConnectionSignature: string;
    connectionSourceNodes: typeof serializedContract.connectionSourceNodes;
    layers: typeof serializedContract.layers;
  }>;
};
assert.equal(
  packageMetadata.mechanismSceneContracts[0]?.physicalConnectionSignature,
  contract.physicalConnectionSignature,
);
assert.deepEqual(
  packageMetadata.mechanismSceneContracts[0]?.connectionSourceNodes,
  contract.connectionSourceNodes,
);
assert(packageMetadata.mechanismSceneContracts[0]?.layers.every((layer) => layer.partKey));

const lowLevel = buildLowLevelMechanismSceneContract(lessonMechanism);
assert.equal(lowLevel.ready, false, 'mechanism-only diagnostics cannot claim full-project readiness');
assert.equal(lowLevel.runtimeMode, 'static-recovery');
assert.equal(lowLevel.projectDriveEnabled, false);
assert.equal(lowLevel.boundPhysicsEnabled, false);

const orphanedProject = {
  ...lesson,
  mechanisms: [{ ...lessonMechanism, targetPathId: 'missing-path' }],
};
const orphanedContract = buildProjectMechanismSceneContract(orphanedProject, lessonMechanism.id);
assert.equal(resolveMechanismRuntimeGate(orphanedProject, orphanedProject.mechanisms[0]!).projection, 'static-recovery');
assert.equal(orphanedContract?.runtimeMode, 'static-recovery');
assert.equal(orphanedContract?.runtimeBlocker, 'Fix: Choose anchor');
assert.equal(orphanedContract?.physicalConnectionSignature, contract.physicalConnectionSignature);

const importSource = readFileSync(new URL('../hooks/useAppCharacterImportActions.ts', import.meta.url), 'utf8');
const between = (start: string, end: string) =>
  importSource.slice(importSource.indexOf(start), importSource.indexOf(end));
const packageImport = between('const importCharacterPackage', 'const importProject');
const projectImport = between('const importProject', 'const editCharacterParts');
assert(!packageImport.includes('dispatch({'), 'malformed character packages do not mutate ProjectState processing');
assert(!projectImport.includes('dispatch({'), 'malformed project JSON does not mutate ProjectState processing');
assert(packageImport.includes('setCommandStatus') && projectImport.includes('setCommandStatus'));

console.log('g008 ProjectState ingress/runtime/scene contracts passed');

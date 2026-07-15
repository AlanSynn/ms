import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FabricationPackage, FoundryExportPackage, MechanismConfig, ProjectState } from '../types';
import { buildAutomataSceneModel } from '../utils/automataSceneModel';
import { generateProjectReadyDXF, generateProjectReadySVG } from '../utils/exporter';
import { createFabricationPackage } from '../utils/fabrication';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { buildProjectMechanismSceneContract } from '../utils/mechanismSceneContract';
import {
  mechanismIsActive,
  mechanismIsRuntimeActive,
  resolveMechanismRuntimeGate,
  runtimeMechanisms,
} from '../utils/mechanismRuntimePolicy';
import { motionAnchorJointIds, motionPreviewForProject } from '../utils/motion';
import { buildKinematicPhysicsSession } from '../utils/physicsSession';
import { applyProjectAction, createSampleProject, loadProjectSnapshot } from '../utils/project';
import { assessMechanismTargetBinding } from '../utils/pathTargets';
import { buildToonSceneProjection } from '../utils/sceneProjection';

const projectWith = (...mechanisms: MechanismConfig[]): ProjectState => {
  const project = createSampleProject();
  return { ...project, mechanisms, selectedMechanismId: mechanisms[0]?.id };
};

const accepted: MechanismConfig = {
  ...createDefaultMechanism('4bar', 'accepted'),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
};
const blocked: MechanismConfig = {
  ...createDefaultMechanism('4bar', 'blocked'),
  groundLength: 321,
  generatedPath: [
    { x: -1e12, y: 1e12 },
    { x: 1e12, y: -1e12 },
  ],
  targetPartId: 'left_hand_part',
  targetAnchorJointId: 'left_hand',
};
const mixedProject = projectWith(accepted, blocked);
const acceptedProject = projectWith(accepted);
const kit = mixedProject.settings.physicalKit;
const noRecipe = createDefaultMechanism('5bar', 'no-recipe');

assert(mechanismIsActive(blocked), 'recovery-blocked mechanisms remain visible for editing');
assert(mechanismIsRuntimeActive(accepted, kit), 'accepted no-special-case mechanism remains runtime-active');
assert(mechanismIsRuntimeActive(noRecipe, kit), 'simulation-safe no-recipe family remains available for isolated preview');
assert(!mechanismIsRuntimeActive(blocked, kit), 'unsafe recovery geometry is runtime-inert');
assert.deepEqual(runtimeMechanisms(mixedProject).map(mechanism => mechanism.id), ['accepted']);

assert.deepEqual(
  motionPreviewForProject(mixedProject, mixedProject.mechanisms, Math.PI / 3).parts,
  motionPreviewForProject(acceptedProject, acceptedProject.mechanisms, Math.PI / 3).parts,
  'blocked stale generatedPath cannot drive body motion while accepted sibling still does',
);

const mixedProjection = buildToonSceneProjection(mixedProject);
assert(mixedProjection.nodes.some(node => node.sourceId === accepted.id), 'accepted sibling remains in scene projection');
assert(
  mixedProjection.nodes.some(node =>
    node.sourceId === blocked.id &&
    node.exportRole === 'preview-only' &&
    node.mechanismRuntimeMode === 'static-recovery'),
  'finite blocked geometry remains visible only as static recovery',
);

const physics = buildKinematicPhysicsSession(mixedProject, mixedProjection);
assert.equal(physics.summary.activeMechanismCount, 1, 'physics counts only runtime-active mechanisms');
assert(physics.bodies.some(body => body.mechanismId === accepted.id), 'accepted sibling remains in physics');
assert(!physics.bodies.some(body => body.mechanismId === blocked.id), 'blocked geometry is absent from physics');

const automata = buildAutomataSceneModel(mixedProject, blocked, Math.PI / 3);
assert.equal(automata.mechanism, undefined, 'blocked selected mechanism is not previewed');
assert.equal(automata.recoveryMechanism?.id, blocked.id, 'blocked finite geometry is retained as static recovery evidence');
assert.equal(automata.generatedTarget, undefined, 'blocked stale generatedPath is not consumed');
assert.deepEqual(automata.mechanisms.map(mechanism => mechanism.id), ['accepted'], 'accepted sibling remains active in automata');
assert.deepEqual(
  automata.animatedParts,
  motionPreviewForProject(acceptedProject, acceptedProject.mechanisms, Math.PI / 3).parts,
  'accepted sibling still drives the automata body',
);

const puppetPreviewSource = readFileSync(new URL('../components/ThreePuppetPreview.tsx', import.meta.url), 'utf8');
assert(
  puppetPreviewSource.includes('buildProjectMechanismSceneContract') &&
    puppetPreviewSource.includes('contract.renderPlan') &&
    !puppetPreviewSource.includes('compileMechanismRenderPlan'),
  'integrated puppet preview consumes the full-project scene contract without a mechanism-only compiler fallback',
);
const mechanismFoundrySource = readFileSync(new URL('../components/stages/foundry/MechanismFoundry.tsx', import.meta.url), 'utf8');
assert(
  mechanismFoundrySource.includes('foundrySceneContract ? <FoundryCanvasPane') &&
    mechanismFoundrySource.includes('data-testid="foundry-unsafe-preview"') &&
    !mechanismFoundrySource.includes('throw new Error("Unsafe Foundry preview blocked")'),
  'unsafe Foundry state renders only a blocker and never mounts an active mechanical preview',
);
const gettingStartedSource = readFileSync(new URL('../components/shell/GettingStartedDialog.tsx', import.meta.url), 'utf8');
assert(
  gettingStartedSource.includes('.filter(mechanism => project && resolveMechanismRuntimeGate(project, mechanism).canDriveProject)'),
  'guided preview filters recovery geometry before gear kinematics',
);

const stalePackage = {
  id: 'stale-binding-package',
  createdAt: '2026-07-14T00:00:00.000Z',
  mechanismId: accepted.id,
  mechanismType: accepted.type,
  parameters: accepted,
  pivot: { x: accepted.anchorX ?? 0, y: accepted.anchorY ?? 0 },
  generatedPath: accepted.generatedPath ?? [],
  simulationSummary: 'stale',
  visual: { color: accepted.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1, steps: 1, loop: true },
  metadata: { sourceTab: 'test' },
  warnings: [],
  source: 'mechanism-foundry',
} satisfies FoundryExportPackage;
const orphaned = {
  ...accepted,
  id: 'orphaned-binding',
  targetPathId: 'missing-path',
  generatedPath: [{ x: 9999, y: 9999 }],
  foundryExport: { ...stalePackage, mechanismId: 'orphaned-binding' },
  fabricationMetadata: {
    boardCoordinate: 'stale',
    gridPitchMm: 20,
    sceneAnchor: { x: 0, y: 0 },
    warnings: [],
  },
};
const orphanedProject = projectWith(orphaned);
const orphanedGate = resolveMechanismRuntimeGate(orphanedProject, orphaned);
assert.equal(orphanedGate.canSimulateMechanism, true, 'binding recovery keeps isolated mechanical diagnosis available');
assert.equal(orphanedGate.canDriveProject, false);
assert.equal(orphanedGate.canProjectScene, true);
assert.equal(orphanedGate.canRunBoundPhysics, false);
assert.equal(orphanedGate.projection, 'static-recovery');
assert.equal(orphanedGate.blocker, 'Fix: Choose anchor');
assert.deepEqual(runtimeMechanisms(orphanedProject), [], 'binding-invalid geometry cannot enter project-driving runtime');
const orphanedMotion = motionPreviewForProject(orphanedProject, orphanedProject.mechanisms, Math.PI / 3);
assert.deepEqual(orphanedMotion.parts, {}, 'binding-invalid generated paths cannot move a detached body subset');
assert.deepEqual(orphanedMotion.sceneObjects, {}, 'binding-invalid generated paths cannot move scene objects');
assert.deepEqual(orphanedMotion.skeleton, orphanedProject.skeleton, 'binding recovery leaves the skeleton static');
const orphanedAutomata = buildAutomataSceneModel(orphanedProject, orphaned, Math.PI / 3);
assert.equal(orphanedAutomata.mechanism, undefined, 'binding-invalid selected mechanism is not reinserted as active');
assert.equal(orphanedAutomata.recoveryMechanism?.id, orphaned.id, 'safe mechanical geometry remains available only as recovery evidence');
assert(orphanedAutomata.foundryPreview, 'static recovery keeps the isolated mechanical preview');
assert.equal(orphanedAutomata.generatedTarget, undefined, 'static recovery exposes no project-driving generated target');
assert.deepEqual(orphanedAutomata.animatedParts, {}, 'static recovery renders no partial body motion');
assert.equal(orphanedAutomata.mechanismContract?.runtimeMode, 'static-recovery');
assert.equal(orphanedAutomata.mechanismContract?.runtimeBlocker, 'Fix: Choose anchor');
const orphanedContract = buildProjectMechanismSceneContract(orphanedProject, orphaned.id);
assert.equal(orphanedContract?.runtimeMode, 'static-recovery');
assert.equal(orphanedContract?.targetPartId, undefined, 'static scene contracts omit bound body output');
assert.equal(orphanedContract?.generatedPathPointCount, 0, 'static scene contracts omit stale generated motion');
const orphanedProjection = buildToonSceneProjection(orphanedProject);
const orphanedProjectionNodes = orphanedProjection.nodes.filter(node => node.sourceId === orphaned.id);
assert(orphanedProjectionNodes.length > 0, 'scene projection keeps static mechanical recovery geometry');
assert(
  orphanedProjectionNodes.every(node => node.exportRole === 'preview-only' && node.mechanismRuntimeMode === 'static-recovery'),
  'recovery projection is diagnostic-only and cannot become an exportable or animated scene layer',
);
assert(
  orphanedProjectionNodes.every(node => node.mechanismCompilerSignature === orphanedContract?.compilerSignature),
  'recovery projection keeps the same canonical compiler signature as its full-project scene contract',
);
const orphanedPhysics = buildKinematicPhysicsSession(orphanedProject, orphanedProjection);
assert.equal(orphanedPhysics.summary.activeMechanismCount, 0);
assert.deepEqual(orphanedPhysics.summary.mechanismCompilerSignatures, [], 'recovery compiler output never enters bound physics');
assert(!orphanedPhysics.bodies.some(body => body.sourceId === orphaned.id), 'bound physics omits recovery geometry');
for (const guardedExport of [generateProjectReadySVG(orphanedProject, Math.PI / 3), generateProjectReadyDXF(orphanedProject, Math.PI / 3)]) {
  assert.equal(guardedExport.ok, false, 'binding recovery blocks direct project downloads');
  assert('blockers' in guardedExport && guardedExport.blockers.some(blocker => blocker.includes('Fix: Choose anchor')));
}
assert.throws(
  () => createFabricationPackage(orphanedProject),
  /Fix: Choose anchor/,
  'binding recovery cannot produce a stale fabrication package',
);

const duplicateBinding = { ...accepted, id: 'duplicate-binding' };
const duplicateProject = projectWith(accepted, duplicateBinding);
assert.equal(resolveMechanismRuntimeGate(duplicateProject, duplicateBinding).projection, 'static-recovery', 'duplicate ownership enters the same project-safe recovery gate');
assert.deepEqual(runtimeMechanisms(duplicateProject), [], 'duplicate owners cannot enter project-driving runtime');
const duplicateAutomata = buildAutomataSceneModel(duplicateProject, duplicateBinding, Math.PI / 3);
assert.equal(duplicateAutomata.mechanism, undefined, 'duplicate selected mechanism is never reinserted as active');
assert.equal(duplicateAutomata.recoveryMechanism?.id, duplicateBinding.id, 'duplicate selected mechanism remains static diagnostic evidence');
assert.deepEqual(duplicateAutomata.animatedParts, {}, 'duplicate recovery produces no detached body motion');
assert.equal(duplicateAutomata.mechanismContract?.runtimeMode, 'static-recovery', 'duplicate recovery uses a static scene contract');
const importedDuplicate = loadProjectSnapshot({
  ...duplicateProject,
  mechanisms: [
    { ...accepted, foundryExport: stalePackage, fabricationMetadata: orphaned.fabricationMetadata },
    {
      ...duplicateBinding,
      foundryExport: { ...stalePackage, mechanismId: duplicateBinding.id },
      fabricationMetadata: orphaned.fabricationMetadata,
    },
  ],
  lastFoundryExport: stalePackage,
  lastExport: {} as FabricationPackage,
});
assert(
  importedDuplicate.mechanisms.every(mechanism => mechanism.foundryExport === undefined && mechanism.fabricationMetadata === undefined),
  'duplicate binding invalidation removes every per-mechanism package cache deterministically',
);
assert.equal(importedDuplicate.lastFoundryExport, undefined);
assert.equal(importedDuplicate.lastExport, undefined);

const invalidAnchor = { ...accepted, targetAnchorJointId: 'head_top' };
const invalidAnchorAssessment = assessMechanismTargetBinding(acceptedProject, invalidAnchor);
assert.equal(invalidAnchorAssessment.blocker, 'Fix: Choose anchor');
assert.deepEqual(
  invalidAnchorAssessment.recoveryCandidates.targetAnchorJointIds,
  [...motionAnchorJointIds(acceptedProject, accepted.targetPartId)].sort(),
  'anchor recovery highlights are limited to compatible joints on the authored owner',
);

const projectWithArtifacts: ProjectState = {
  ...acceptedProject,
  mechanisms: [{
    ...accepted,
    foundryExport: stalePackage,
    fabricationMetadata: orphaned.fabricationMetadata,
  }],
  lastFoundryExport: stalePackage,
  lastExport: {} as FabricationPackage,
};
const deletedPath = applyProjectAction(projectWithArtifacts, { type: 'delete_path', pathId: accepted.targetPathId! });
const deletedPathMechanism = deletedPath.mechanisms[0]!;
assert.equal(deletedPathMechanism.targetPartId, accepted.targetPartId, 'path deletion preserves authored target id');
assert.equal(deletedPathMechanism.targetPathId, accepted.targetPathId, 'path deletion preserves authored path id');
assert.equal(deletedPathMechanism.targetAnchorJointId, accepted.targetAnchorJointId, 'path deletion preserves authored anchor id');
assert.deepEqual(deletedPathMechanism.activeVisualPartIds, [accepted.targetPartId!], 'existing visual owner remains diagnostic evidence');
assert.equal(deletedPathMechanism.generatedPath, undefined);
assert.equal(deletedPathMechanism.foundryExport, undefined);
assert.equal(deletedPathMechanism.fabricationMetadata, undefined);
assert.equal(deletedPath.lastFoundryExport, undefined);
assert.equal(deletedPath.lastExport, undefined);
assert.equal(resolveMechanismRuntimeGate(deletedPath, deletedPathMechanism).projection, 'static-recovery');

const deletedPart = applyProjectAction(projectWithArtifacts, { type: 'delete_part', partId: accepted.targetPartId! });
const deletedPartMechanism = deletedPart.mechanisms[0]!;
assert.equal(deletedPartMechanism.targetPartId, accepted.targetPartId, 'part deletion preserves authored target id');
assert.equal(deletedPartMechanism.targetPathId, accepted.targetPathId, 'part deletion preserves authored path id');
assert.equal(deletedPartMechanism.targetAnchorJointId, accepted.targetAnchorJointId, 'part deletion preserves authored anchor id');
assert.deepEqual(deletedPartMechanism.activeVisualPartIds, [], 'only the deleted visual reference is cleared');
assert.equal(deletedPartMechanism.foundryExport, undefined);
assert.equal(deletedPart.lastFoundryExport, undefined);
assert.equal(deletedPart.lastExport, undefined);

const importedOrphan = loadProjectSnapshot({
  ...projectWithArtifacts,
  mechanisms: [orphaned],
  lastFoundryExport: orphaned.foundryExport,
});
assert.equal(importedOrphan.mechanisms[0]?.targetPartId, orphaned.targetPartId);
assert.equal(importedOrphan.mechanisms[0]?.targetPathId, orphaned.targetPathId);
assert.equal(importedOrphan.mechanisms[0]?.targetAnchorJointId, orphaned.targetAnchorJointId);
assert.equal(importedOrphan.mechanisms[0]?.generatedPath, undefined);
assert.equal(importedOrphan.mechanisms[0]?.foundryExport, undefined);
assert.equal(importedOrphan.lastFoundryExport, undefined);

const designInspectorSource = readFileSync(new URL('../components/stages/mechanism/DesignInspectorPanel.tsx', import.meta.url), 'utf8');
assert(designInspectorSource.includes('data-recovery-target'), 'Design exposes compatible target/path/anchor highlight data');

assert(!JSON.stringify(mixedProject).includes('recovery-blocked'), 'runtime policy adds no serialized recovery tier');

console.log('mechanism recovery consumer contracts passed');

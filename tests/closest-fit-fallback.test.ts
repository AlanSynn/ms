import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import {
  clearFourBarFitCache,
  fitFourBarKitMechanismToPath,
  fourBarFitCacheEntryCount,
  fourBarPathFitTolerance,
} from '../utils/fourBarPathFit';
import { boardToScene, SCENE_PX_PER_MM } from '../utils/coordinates';
import { replacePrimaryMechanismOutputBinding } from '../utils/mechanismBindings';
import { mechanismPathFitBindingIssues } from '../utils/pathTargets';
import { createFabricationRecipe } from '../utils/fabricationRecipes';
import {
  applyProjectAction,
  createDefaultMechanism,
  createSampleProject,
  loadProjectSnapshot,
} from '../utils/project';
import { serializeProject } from '../utils/projectSerialization';
import { useAppMechanismActions } from '../hooks/useAppMechanismActions';
import { runProjectImportJob } from '../runtime/import/projectImportJob';
import {
  createMechanismFitWorkerClient,
  type MechanismFitFrameScheduler,
  type MechanismFitWorkerPort,
} from '../runtime/fitting/mechanismFitWorkerClient';
import {
  runMechanismFitJob,
  type MechanismFitWorkerRequest,
  type MechanismFitWorkerResponse,
} from '../runtime/fitting/mechanismFitJob';
import type {
  FoundryExportPackage,
  MechanismConfig,
  ProjectAction,
  ProjectState,
} from '../types';

clearFourBarFitCache();
const project = createSampleProject();
const path = project.paths['path-right-arm'];
assert(path, 'sample project supplies the right-arm target path');

const seed = {
  ...createDefaultMechanism('4bar', 'closest-seed'),
  targetPartId: path.partId,
  targetPathId: path.id,
  targetAnchorJointId: path.targetAnchorJointId,
  activeVisualPartIds: [path.partId],
};

// A path that no kit mechanism can trace within hard tolerance must still
// produce its closest fabrication-valid candidate instead of a bare rejection.
const closest = fitFourBarKitMechanismToPath(project, seed, path);
assert(closest, 'an unfollowable path still yields a closest fabrication candidate');
const pathFit = closest.fabricationMetadata?.pathFit;
assert.equal(pathFit?.status, 'closest', 'the fit result is labeled as a closest match');
assert.equal(pathFit?.targetPathId, path.id, 'closest fit keeps the target path binding');
assert.equal(
  pathFit?.kitProfileKey,
  project.settings.physicalKit.profileKey,
  'closest fit records the fabrication kit profile',
);
assert.equal(pathFit?.tolerance, fourBarPathFitTolerance(project), 'closest fit records the hard tolerance it missed');
assert(Number.isFinite(pathFit?.error) && (pathFit?.error ?? 0) > 0, 'closest fit reports a finite nonzero error');
assert(
  pathFit!.error! > pathFit!.tolerance! || pathFit!.maxError! > pathFit!.tolerance!,
  'closest fit exercises the finite above-tolerance acceptance path',
);
assert(Array.isArray(closest.generatedPath) && closest.generatedPath.length > 8, 'closest fit exposes its generated path preview');
assert(closest.warnings?.includes('No fabrication-valid path fit.'), 'closest fit keeps the fabrication blocker warning');
assert.equal(pathFit?.acceptedClosest, undefined, 'an unaccepted closest match does not claim acceptance');

// Accepting the closest match (status promoted with acceptedClosest) clears
// binding issues; without acceptance the tolerance breach stays flagged.
const acceptedForm = {
  ...closest,
  fabricationMetadata: {
    ...(closest.fabricationMetadata ?? {}),
    pathFit: {
      ...(closest.fabricationMetadata?.pathFit ?? {}),
      status: 'fit' as const,
      acceptedClosest: true,
    },
  },
};
assert.equal(
  mechanismPathFitBindingIssues(project, acceptedForm).length,
  0,
  'an accepted closest match passes fabrication binding checks',
);
const unacceptedFitForm = {
  ...acceptedForm,
  fabricationMetadata: {
    ...(acceptedForm.fabricationMetadata ?? {}),
    pathFit: {
      ...(acceptedForm.fabricationMetadata?.pathFit ?? {}),
      acceptedClosest: undefined,
    },
  },
};
assert(
  mechanismPathFitBindingIssues(project, unacceptedFitForm).length > 0,
  'a promoted closest match without acceptance still flags the tolerance breach',
);

// The closest candidate must remain fabricatable: anchor on a board hole and
// its full sweep stays inside the board.
const anchorX = closest.anchorX ?? closest.sceneAnchor?.x ?? 0;
const anchorY = closest.anchorY ?? closest.sceneAnchor?.y ?? 0;
const halfSpan =
  ((project.settings.physicalKit.boardCells - 1) / 2) *
  project.settings.physicalKit.gridPitchMm *
  SCENE_PX_PER_MM;
assert(
  Math.abs(anchorX) <= halfSpan + 1e-6 && Math.abs(anchorY) <= halfSpan + 1e-6,
  'closest fit anchors on the fabrication board',
);
const sweepHalfSpan = halfSpan * Math.SQRT2;
assert(
  (closest.generatedPath ?? []).every(
    (point) => Math.abs(point.x) <= sweepHalfSpan + 1e-6 && Math.abs(point.y) <= sweepHalfSpan + 1e-6,
  ),
  'closest fit generated path stays inside the board sweep area',
);

// A path no board anchor can possibly reach stays rejected: every candidate
// is pruned before ranking, so there is no fabrication-valid approximation.
const farPath = {
  ...path,
  id: 'closest-far',
  points: [{ x: 4000, y: 4000 }, { x: 4200, y: 4200 }, { x: 4400, y: 4000 }],
};
const rejected = fitFourBarKitMechanismToPath(
  { ...project, paths: { ...project.paths, [farPath.id]: farPath } },
  { ...seed, id: 'closest-far-seed' },
  farPath,
);
assert.equal(rejected, undefined, 'an unreachable path still produces no fabricated mechanism');

// Fit results are cached per (project, mechanism, path) and the cache stays bounded.
clearFourBarFitCache();
const first = fitFourBarKitMechanismToPath(project, seed, path);
const second = fitFourBarKitMechanismToPath(project, seed, path);
assert.equal(first?.fabricationMetadata?.pathFit?.status, 'closest');
assert.equal(second?.fabricationMetadata?.pathFit?.status, 'closest', 'cached refit reproduces the closest label');
assert(fourBarFitCacheEntryCount() <= 32, 'the fit cache stays bounded');

// Closed paths are fit as true cycles: samples divide the loop into equal
// arcs (no duplicated-endpoint drift), so a fabricable circle fits at ANY
// starting phase with a compensating phase offset — previously such circles
// breached tolerance at some phases and were mislabeled 'closest'.
clearFourBarFitCache();
const pitchPx = project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM;
const circleCenter = boardToScene(7, 7, project.settings.physicalKit);
const circleRadius = 4 * pitchPx;
const circleAtPhase = (phaseDeg: number) =>
  Array.from({ length: 36 }, (_, index) => ({
    x: circleCenter.x + circleRadius * Math.cos((phaseDeg * Math.PI) / 180 + (index / 36) * 2 * Math.PI),
    y: circleCenter.y + circleRadius * Math.sin((phaseDeg * Math.PI) / 180 + (index / 36) * 2 * Math.PI),
  }));
const circleErrors: number[] = [];
for (const phaseDeg of [0, 61.875, 137.4, 211.7]) {
  const circlePath = { ...path, id: `circle-phase-${phaseDeg}`, points: circleAtPhase(phaseDeg), closed: true };
  const circleProject = { ...project, paths: { [circlePath.id]: circlePath }, mechanisms: [] };
  const circleSeed = {
    ...createDefaultMechanism('4bar', `circle-seed-${phaseDeg}`),
    targetPartId: circlePath.partId,
    targetPathId: circlePath.id,
    targetAnchorJointId: circlePath.targetAnchorJointId,
    activeVisualPartIds: [circlePath.partId],
  };
  clearFourBarFitCache();
  const circleFit = fitFourBarKitMechanismToPath(circleProject, circleSeed, circlePath);
  const circleResult = circleFit?.fabricationMetadata?.pathFit;
  assert.equal(circleResult?.status, 'fit', `a fabricable closed circle fits at phase ${phaseDeg}°`);
  assert(Number.isFinite(circleResult?.phaseOffset), `the circle fit reports a phase offset at ${phaseDeg}°`);
  circleErrors.push(circleResult!.error!);
}
// Residual error spread across phases comes from the 11.25° phase
// quantization at refinement — bounded, known, and separate from the
// closed-loop sampling contract under test here.
assert(
  Math.max(...circleErrors) < fourBarPathFitTolerance(project),
  'every closed-circle phase stays inside the fabrication tolerance',
);

console.log('closest fabrication fit fallback contract passed');

// A reopened mechanism carries materialized outputs whose binding still holds
// the prior rejected fit. Refitting must still produce the closest
// recommendation (with the binding synced), not a bare rejection.
clearFourBarFitCache();
const staleFit = {
  status: 'rejected' as const,
  targetPathId: path.id,
  outputTraceId: 'B',
  error: 999,
  maxError: 999,
  tolerance: fourBarPathFitTolerance(project),
  kitProfileKey: project.settings.physicalKit.profileKey,
};
const withStaleOutputs = replacePrimaryMechanismOutputBinding(project, {
  ...createDefaultMechanism('4bar', 'stale-binding-seed'),
  targetPartId: path.partId,
  targetPathId: path.id,
  targetAnchorJointId: path.targetAnchorJointId,
  fabricationMetadata: { pathFit: staleFit },
}, path.id, { fit: staleFit });
assert(withStaleOutputs.outputs?.[0]?.fit?.status === 'rejected', 'seed carries a stale rejected binding fit');
const refit = fitFourBarKitMechanismToPath(project, withStaleOutputs, path);
assert.equal(
  refit?.fabricationMetadata?.pathFit?.status,
  'closest',
  'a stale rejected binding fit does not block the closest recommendation',
);
assert(
  (refit?.generatedPath ?? []).length > 8,
  'the refit keeps its generated path preview despite the stale binding',
);
assert.equal(
  refit?.outputs?.[0]?.fit?.status,
  'closest',
  'the stale binding is synced to the fresh closest fit',
);

// The reducer must not silently demote a closest recommendation: project
// dispatches preserve its status and generated path like any usable fit.
const roundTripped = applyProjectAction(project, { type: 'upsert_mechanism', mechanism: refit! });
const committed = roundTripped.mechanisms.find((mechanism) => mechanism.id === refit!.id);
assert.equal(
  committed?.fabricationMetadata?.pathFit?.status,
  'closest',
  'upsert_mechanism preserves the closest status',
);
assert(
  (committed?.generatedPath ?? []).length > 8,
  'upsert_mechanism keeps the closest generated path',
);
// A saved-and-reopened project must hand back the same recommendation: both
// the accepted promotion and the unaccepted closest survive serialization,
// with their rotation fields (ground angle, phase offset, direction) intact.
const serializeAndLoad = (mechanism: typeof refit) => {
  const snapshot = loadProjectSnapshot(JSON.parse(serializeProject({
    ...project,
    mechanisms: [...project.mechanisms, mechanism],
  })));
  return snapshot.mechanisms.find((candidate) => candidate.id === refit!.id);
};
const acceptedFit = {
  ...(refit!.fabricationMetadata?.pathFit ?? {}),
  status: 'fit' as const,
  acceptedClosest: true,
};
const acceptedBound = replacePrimaryMechanismOutputBinding(project, {
  ...refit!,
  fabricationMetadata: {
    ...(refit!.fabricationMetadata ?? {}),
    pathFit: acceptedFit,
  },
}, path.id, { outputTraceId: acceptedFit.outputTraceId, fit: acceptedFit });
const reloadedAccepted = serializeAndLoad(acceptedBound);
assert.equal(
  reloadedAccepted?.fabricationMetadata?.pathFit?.status,
  'fit',
  'an accepted closest match survives a save/reload as a fit',
);
assert.equal(
  reloadedAccepted?.fabricationMetadata?.pathFit?.acceptedClosest,
  true,
  'the acceptance flag survives a save/reload',
);
const reloadedUnaccepted = serializeAndLoad(refit!);
assert.equal(
  reloadedUnaccepted?.fabricationMetadata?.pathFit?.status,
  'closest',
  'an unaccepted closest match survives a save/reload unchanged',
);
assert(
  (reloadedUnaccepted?.generatedPath ?? []).length > 8,
  'the reloaded closest match keeps its generated path',
);
for (const reloaded of [reloadedAccepted, reloadedUnaccepted]) {
  const pathFit = reloaded?.fabricationMetadata?.pathFit;
  assert(Number.isFinite(pathFit?.phaseOffset), 'reloaded fit keeps its phase offset');
  assert(Number.isFinite(pathFit?.direction), 'reloaded fit keeps its direction');
  assert(Number.isFinite(reloaded?.groundAngle), 'reloaded mechanism keeps its ground angle');
  assert.equal(
    reloaded?.outputs?.[0]?.fit?.status,
    pathFit?.status,
    'the reloaded output binding matches the fabrication fit',
  );
}

// Exercise the production acceptance path: Foundry package -> action hook ->
// cancellable fit worker -> committed ProjectState -> portable import -> live
// fabrication recipe.  Each package warning location contains the blocker and
// a distinct warning so acceptance can be checked without losing context.
const fitBlocker = 'No fabrication-valid path fit.';
const foundryWarnings = ['Keep foundry warning.', 'Other context: No fabrication-valid path fit.'];
const foundryGlobalWarnings = ['Keep foundry global warning.'];
const parameterWarnings = ['Keep parameter warning.'];
const foundryMetadataWarnings = ['Keep foundry metadata warning.'];
const metadataWarnings = ['Keep metadata warning.'];
const flowFoundry = {
  ...closest,
  id: 'foundry-preview-flow',
  warnings: [fitBlocker, ...foundryGlobalWarnings],
  fabricationMetadata: {
    ...(closest.fabricationMetadata ?? {}),
    warnings: [fitBlocker, ...foundryMetadataWarnings],
  },
};
const flowPackageParameters: Partial<MechanismConfig> = {
  ...flowFoundry,
  id: 'flow-package-parameters',
  warnings: [fitBlocker, ...parameterWarnings],
  fabricationMetadata: {
    ...(flowFoundry.fabricationMetadata ?? {}),
    warnings: [fitBlocker, ...metadataWarnings],
  },
};
const flowPackage: FoundryExportPackage = {
  id: 'flow-package',
  createdAt: '2026-09-12T00:00:00.000Z',
  mechanismId: 'flow-mechanism',
  mechanismType: '4bar',
  parameters: flowPackageParameters,
  pivot: {
    x: closest.anchorX ?? closest.sceneAnchor?.x ?? 0,
    y: closest.anchorY ?? closest.sceneAnchor?.y ?? 0,
  },
  outputPoint: closest.generatedPath?.[0],
  outputPortId: 'C',
  generatedPath: closest.generatedPath ?? [],
  simulationSummary: 'closest',
  visual: { color: closest.color, scale: 1, constraintsVisible: true },
  animation: { duration: 1200, steps: closest.generatedPath?.length ?? 0, loop: true },
  metadata: {
    sourceTab: 'mechanism-foundry',
    selectedPreset: 'flow-closest',
    recommendation: 'flow closest',
  },
  targetPartId: path.partId,
  targetPathId: path.id,
  targetAnchorJointId: path.targetAnchorJointId,
  warnings: [fitBlocker, ...foundryWarnings],
  source: 'mechanism-foundry',
};

class FlowFitWorker implements MechanismFitWorkerPort {
  onmessage: MechanismFitWorkerPort['onmessage'] = null;
  onmessageerror: MechanismFitWorkerPort['onmessageerror'] = null;
  onerror: MechanismFitWorkerPort['onerror'] = null;
  posted: MechanismFitWorkerRequest[] = [];
  terminated = false;

  postMessage(message: MechanismFitWorkerRequest) {
    this.posted.push(message);
    const result = runMechanismFitJob(message.input);
    this.onmessage?.({
      data: {
        type: 'result',
        generationId: message.generationId,
        inputFingerprint: message.input.inputFingerprint,
        result,
      },
    } as MessageEvent<MechanismFitWorkerResponse>);
  }

  terminate() {
    this.terminated = true;
  }
}

const flowFrameCallbacks = new Map<number, FrameRequestCallback>();
let flowFrameId = 0;
const flowScheduler: MechanismFitFrameScheduler = {
  requestFrame(callback) {
    const id = ++flowFrameId;
    flowFrameCallbacks.set(id, callback);
    return id;
  },
  cancelFrame(handle) {
    flowFrameCallbacks.delete(handle);
  },
};
const runFlowFrame = () => {
  const entry = flowFrameCallbacks.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  assert(entry, 'the action fit schedules a deferred worker frame');
  flowFrameCallbacks.delete(entry[0]);
  entry[1](0);
};
const flowWorkers: FlowFitWorker[] = [];
const flowFitClient = createMechanismFitWorkerClient(() => {
  const worker = new FlowFitWorker();
  flowWorkers.push(worker);
  return worker;
}, flowScheduler);
const flowDispatches: ProjectAction[] = [];
let flowActions: ReturnType<typeof useAppMechanismActions> | undefined;
const FlowHarness = () => {
  flowActions = useAppMechanismActions({
    project,
    dispatch: (action) => flowDispatches.push(action),
    selectedPart: project.parts[path.partId],
    selectedPath: path,
    foundry: flowFoundry,
    mechanismConfig: {
      speed: project.settings.animationSpeed,
      rotation: 0,
      mechanisms: project.mechanisms,
    },
    angle: 0,
    setStage: () => undefined,
    setCommandStatus: () => undefined,
    mechanismFitClient: flowFitClient,
  });
  return null;
};
renderToString(createElement(FlowHarness));
assert(flowActions, 'the production mechanism action hook renders');
flowActions.exportFoundryMechanism(flowPackage);
assert.equal(flowWorkers.length, 0, 'the action waits for the fit worker paint frames');
runFlowFrame();
runFlowFrame();
assert.equal(flowWorkers.length, 1, 'the action starts the production fit worker client');
assert(flowWorkers[0].posted[0]?.input.mode === 'sheet', 'Foundry acceptance completes through the sheet fit job');
assert(flowWorkers[0].terminated, 'the production fit worker is released after action completion');
assert.deepEqual(flowDispatches.map((action) => action.type), ['set_foundry_export', 'set_mechanisms']);

const foundryExportAction = flowDispatches[0] as Extract<ProjectAction, { type: 'set_foundry_export' }>;
assert(!foundryExportAction.foundryExport.warnings.includes(fitBlocker), 'accepted package retires only the exact blocker at the package root');
assert(foundryExportAction.foundryExport.warnings.includes(foundryWarnings[0]), 'accepted package keeps unrelated root warnings');
assert(foundryExportAction.foundryExport.warnings.includes(foundryWarnings[1]), 'accepted package keeps non-exact fit warning text');
const flowMechanismAction = flowDispatches[1] as Extract<ProjectAction, { type: 'set_mechanisms' }>;
const flowCommittedMechanism = flowMechanismAction.mechanisms[0];
assert.equal(flowCommittedMechanism.fabricationMetadata?.pathFit?.status, 'fit', 'worker completion commits the accepted fit status');
assert.equal(flowCommittedMechanism.fabricationMetadata?.pathFit?.acceptedClosest, true, 'worker completion commits explicit closest acceptance');
assert.equal(flowCommittedMechanism.outputs?.[0]?.fit?.status, 'fit', 'worker completion commits the accepted output binding fit');
assert.equal(flowCommittedMechanism.outputs?.[0]?.fit?.acceptedClosest, true, 'worker completion keeps closest acceptance on the output binding');
for (const warnings of [
  flowCommittedMechanism.warnings,
  flowCommittedMechanism.fabricationMetadata?.warnings,
  flowCommittedMechanism.foundryExport?.warnings,
  flowCommittedMechanism.foundryExport?.parameters.warnings,
  flowCommittedMechanism.foundryExport?.parameters.fabricationMetadata?.warnings,
]) {
  assert(!warnings?.includes(fitBlocker), 'accepted completion retires the exact blocker from every mechanism/package warning list');
}
for (const warning of [
  ...foundryWarnings,
  ...foundryGlobalWarnings,
  ...parameterWarnings,
  ...foundryMetadataWarnings,
  ...metadataWarnings,
]) {
  assert(
    flowCommittedMechanism.warnings?.includes(warning) ||
      flowCommittedMechanism.fabricationMetadata?.warnings?.includes(warning) ||
      flowCommittedMechanism.foundryExport?.warnings.includes(warning) ||
      flowCommittedMechanism.foundryExport?.parameters.warnings?.includes(warning) ||
      flowCommittedMechanism.foundryExport?.parameters.fabricationMetadata?.warnings?.includes(warning),
    `accepted completion keeps unrelated warning: ${warning}`,
  );
}

let flowCommittedProject = project;
for (const action of flowDispatches) flowCommittedProject = applyProjectAction(flowCommittedProject, action);
const reopenedFlow = (await runProjectImportJob({
  kind: 'project',
  file: new File([serializeProject(flowCommittedProject)], 'accepted-closest.motionsmith'),
})).project;
const reopenedFlowMechanism = reopenedFlow.mechanisms.find((mechanism) => mechanism.id === flowCommittedMechanism.id);
assert(reopenedFlowMechanism, 'portable import reopens the committed mechanism');
assert.equal(reopenedFlowMechanism?.fabricationMetadata?.pathFit?.acceptedClosest, true, 'portable import preserves closest acceptance');
assert.equal(reopenedFlowMechanism?.outputs?.[0]?.fit?.acceptedClosest, true, 'portable import preserves closest acceptance on the output binding');
assert.equal(
  mechanismPathFitBindingIssues(reopenedFlow, reopenedFlowMechanism!).length,
  0,
  'a finite above-tolerance accepted fit remains usable after portable import',
);
for (const warnings of [
  reopenedFlowMechanism?.warnings,
  reopenedFlowMechanism?.fabricationMetadata?.warnings,
  reopenedFlowMechanism?.foundryExport?.warnings,
  reopenedFlowMechanism?.foundryExport?.parameters.warnings,
  reopenedFlowMechanism?.foundryExport?.parameters.fabricationMetadata?.warnings,
  reopenedFlow.lastFoundryExport?.warnings,
  reopenedFlow.lastFoundryExport?.parameters.warnings,
  reopenedFlow.lastFoundryExport?.parameters.fabricationMetadata?.warnings,
]) {
  assert(!warnings?.includes(fitBlocker), 'portable import preserves the retired package blocker');
}
const reopenedFlowRecipe = createFabricationRecipe(reopenedFlow, reopenedFlowMechanism!);
assert(!reopenedFlowRecipe.warnings.includes(fitBlocker), 'the live assembly recipe omits the retired exact blocker');
assert(
  [
    ...foundryWarnings,
    ...foundryGlobalWarnings,
    ...parameterWarnings,
    ...foundryMetadataWarnings,
    ...metadataWarnings,
  ].every((warning) => reopenedFlowRecipe.warnings.includes(warning)),
  'the live assembly recipe keeps every unrelated warning',
);

// Runtime and portable values must not bypass the required metric check. JSON
// cannot carry NaN or infinities, so direct values and their null/string forms
// are checked separately through the same binding guard.
for (const [field, value] of [
  ['error', undefined],
  ['maxError', undefined],
  ['error', Number.NaN],
  ['maxError', Number.POSITIVE_INFINITY],
  ['error', Number.NEGATIVE_INFINITY],
  ['maxError', null],
  ['error', '12'],
] as const) {
  const malformedFit = {
    ...(flowCommittedMechanism.fabricationMetadata?.pathFit ?? {}),
    status: 'fit' as const,
    acceptedClosest: true,
    [field]: value,
  } as unknown as NonNullable<MechanismConfig['fabricationMetadata']>['pathFit'];
  const malformedMechanism: MechanismConfig = {
    ...flowCommittedMechanism,
    fabricationMetadata: {
      ...(flowCommittedMechanism.fabricationMetadata ?? {}),
      pathFit: malformedFit,
    },
  };
  assert(
    mechanismPathFitBindingIssues(reopenedFlow, malformedMechanism).includes('Fit error exceeds tolerance.'),
    `accepted closest does not waive missing/non-finite ${field}`,
  );
}
const importedEnvelope = JSON.parse(serializeProject(flowCommittedProject)) as {
  project: ProjectState & { mechanisms: MechanismConfig[] };
  integrity: { contentFingerprint: string };
};
const importedRawFit = importedEnvelope.project.mechanisms[0].fabricationMetadata?.pathFit;
assert(importedRawFit, 'portable envelope carries the accepted fit metadata');
importedRawFit.error = null as unknown as number;
importedRawFit.maxError = '12' as unknown as number;
const importedOutputFit = importedEnvelope.project.mechanisms[0].outputs?.[0]?.fit;
assert(importedOutputFit, 'portable envelope carries the accepted output binding fit');
importedOutputFit.error = null as unknown as number;
importedOutputFit.maxError = '12' as unknown as number;
let importedHash = 0x811c9dc5;
const importedContent = JSON.stringify(importedEnvelope.project);
for (let index = 0; index < importedContent.length; index += 1) {
  importedHash = Math.imul(importedHash ^ importedContent.charCodeAt(index), 0x01000193);
}
importedEnvelope.integrity.contentFingerprint = (importedHash >>> 0).toString(16).padStart(8, '0');
const malformedImported = (await runProjectImportJob({
  kind: 'project',
  file: new File([JSON.stringify(importedEnvelope)], 'malformed-fit.motionsmith'),
})).project;
const malformedImportedMechanism = malformedImported.mechanisms[0];
assert(
  mechanismPathFitBindingIssues(malformedImported, malformedImportedMechanism).includes('Fit error exceeds tolerance.'),
  'portable null/string metrics remain blocked after import normalization',
);

flowFitClient.dispose();
console.log('closest fit acceptance dataflow contract passed');

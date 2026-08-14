import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  MechanismConfig,
  ProjectState,
} from '../types';
import { AssemblyGuide } from '../components/stages/assembly/AssemblyGuide';
import { BlueprintExport } from '../components/stages/blueprint/BlueprintExport';
import {
  boardGridCenter,
  boardRoundTripError,
  boardRoundTripTolerance,
  boardToScene,
  defaultPhysicalKit,
  sceneBoundsForBoard,
  scenePointWithinBoard,
  sceneToBoard,
  sceneToBoardRaw,
} from '../utils/coordinates';
import {
  createFabricationPackage,
  validateForFabrication,
} from '../utils/fabrication';
import {
  fabricationExportPolicy,
} from '../utils/fabricationReadiness';
import {
  mechanismDescriptorFitsCutSheet,
  mechanismDescriptorWithinBoard,
  mechanismDescriptorWithinSheet,
} from '../utils/mechanismCollision';
import { compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { resolveNewMechanismCandidateCommit } from '../utils/mechanismEditAuthority';
import type { MechanismPhysicalEnvelopeDescriptor } from '../utils/mechanismPhysicalEnvelope';
import { applyProjectAction, createSampleProject, loadProjectSnapshot } from '../utils/project';

const descriptor = (
  envelope: MechanismPhysicalEnvelopeDescriptor['envelope'],
): MechanismPhysicalEnvelopeDescriptor => ({
  layerKey: 'g2-layer',
  mechanismId: 'g2-mechanism',
  layerId: 'g2-layer',
  phaseIndex: 0,
  phaseRad: 0,
  envelope,
  backFaceMm: 0,
  frontFaceMm: 1,
  role: 'linkage',
  collisionClass: 'mechanism-part',
});

const boundMechanism = (id: string): MechanismConfig => ({
  ...createDefaultMechanism('4bar', id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const largeReadyProject = (): ProjectState => {
  const project = createSampleProject();
  const mechanism = boundMechanism('g2-ready');
  return {
    ...project,
    mechanisms: [mechanism],
    selectedMechanismId: mechanism.id,
    settings: {
      ...project.settings,
      physicalKit: {
        ...project.settings.physicalKit,
        boardCells: 41,
        sheetWidthMm: 1_000,
        sheetHeightMm: 1_000,
      },
    },
  };
};

const defaultKit = defaultPhysicalKit();
const evenKit = { ...defaultKit, profileKey: 'g2-even-12x12', boardCells: 12 };

assert.equal(boardGridCenter(defaultKit), 7, 'odd board origin uses its central hole index');
assert.equal(boardGridCenter(evenKit), 5.5, 'even board origin is the midpoint between central holes');
assert.deepEqual(sceneBoundsForBoard(evenKit), { x: -240, y: -240, width: 480, height: 480 }, 'even board containment stays physically centered');

for (const [col, row] of [[0, 0], [11, 0], [0, 11], [11, 11]] as const) {
  const scene = boardToScene(col, row, evenKit);
  const raw = sceneToBoardRaw(scene, evenKit);
  assert.equal(raw.valid, true, `even board corner ${col},${row} is a valid hole`);
  assert.deepEqual(boardToScene(raw.col, raw.row, evenKit), scene, `even board corner ${col},${row} round-trips exactly`);
}

const evenBounds = sceneBoundsForBoard(evenKit);
const exactBoundary = { x: evenBounds.x + evenBounds.width, y: evenBounds.y + evenBounds.height };
assert(scenePointWithinBoard(exactBoundary, evenKit), 'exact board boundary is contained with the shared boundary policy');
assert(!scenePointWithinBoard({ x: exactBoundary.x + 1e-6, y: exactBoundary.y }, evenKit), 'outside board boundary is not contained');
assert.equal(sceneToBoardRaw(exactBoundary, evenKit).valid, false, 'an outer boundary is not mislabeled as an exact board hole');
assert(boardRoundTripError(exactBoundary, evenKit) <= boardRoundTripTolerance(evenKit), 'outer boundary maps to its nearest hole within explicit round-trip tolerance');
assert.equal(sceneToBoard({ x: 9999, y: 9999 }, evenKit).valid, false, 'authoring clamp preserves raw invalidity for an off-board point');

const freshEvenCandidate = resolveNewMechanismCandidateCommit(createDefaultMechanism('4bar', 'g2-fresh-even'), evenKit);
assert.equal(freshEvenCandidate.status, 'accepted', 'fresh even-board mechanism uses the frozen creation resolver');
if (freshEvenCandidate.status === 'accepted') {
  const resolvedAnchor = { x: freshEvenCandidate.mechanism.anchorX!, y: freshEvenCandidate.mechanism.anchorY! };
  const resolvedBoard = sceneToBoardRaw(resolvedAnchor, evenKit);
  assert.equal(resolvedBoard.valid, true, 'fresh even-board mechanism resolves to a real hole');
  assert.deepEqual(boardToScene(resolvedBoard.col, resolvedBoard.row, evenKit), resolvedAnchor, 'fresh resolver stores the snapped anchor explicitly');
}

const explicitOffGrid = { ...createDefaultMechanism('4bar', 'g2-explicit-off-grid'), anchorX: -119, anchorY: -39 };
const explicitBefore = { anchorX: explicitOffGrid.anchorX, anchorY: explicitOffGrid.anchorY };
const explicitCompilation = compileMechanismGraphFabrication(explicitOffGrid, evenKit);
assert.equal(explicitCompilation.buildable, false, 'existing even-board off-grid geometry remains blocked by strict compiler snap checks');
assert.equal(explicitOffGrid.anchorX, explicitBefore.anchorX, 'strict compiler does not mutate an explicit anchor');
assert.equal(explicitOffGrid.anchorY, explicitBefore.anchorY, 'strict compiler does not mutate an explicit anchor Y');

const board = sceneBoundsForBoard(defaultKit);
const edgeCircle = descriptor({
  kind: 'circle',
  x: board.x + 12,
  y: 0,
  rotation: 0,
  radius: 12,
});
assert.equal(mechanismDescriptorWithinBoard(edgeCircle, defaultKit), true, 'circle touching the board edge remains contained');
assert.equal(mechanismDescriptorWithinBoard({ ...edgeCircle, envelope: { ...edgeCircle.envelope, x: board.x + 12 - 1e-8 } }, defaultKit), false, 'circle beyond the board edge is blocked');

const rotatedEdgeBox = descriptor({
  kind: 'oriented-box',
  x: board.x + 10,
  y: 0,
  rotation: Math.PI / 2,
  width: 40,
  height: 20,
});
assert.equal(mechanismDescriptorWithinBoard(rotatedEdgeBox, defaultKit), true, 'rotated part touching the board edge remains contained');
assert.equal(mechanismDescriptorWithinBoard({ ...rotatedEdgeBox, envelope: { ...rotatedEdgeBox.envelope, x: board.x + 10 - 1e-8 } }, defaultKit), false, 'rotated part beyond the board edge is blocked');

const sheet = {
  width: defaultKit.sheetWidthMm * 2,
  height: defaultKit.sheetHeightMm * 2,
};
const rotatedPart = descriptor({
  kind: 'oriented-box',
  x: 9999,
  y: 9999,
  rotation: Math.PI / 2,
  width: sheet.height - 1,
  height: sheet.width - 1,
});
assert.equal(mechanismDescriptorFitsCutSheet(rotatedPart, defaultKit), true, 'individual cut-part fit permits a ninety-degree sheet rotation');
assert.equal(mechanismDescriptorWithinSheet(rotatedPart, defaultKit), false, 'individual cut-part fit does not claim whole-assembly sheet containment');
assert.equal(mechanismDescriptorFitsCutSheet({ ...rotatedPart, envelope: { ...rotatedPart.envelope, width: sheet.height + 1 } }, defaultKit), false, 'individual cut-part dimensions block after rotation when either sheet axis is exceeded');

const softProject = (() => {
  const project = largeReadyProject();
  return {
    ...project,
    settings: {
      ...project.settings,
      physicalKit: { ...project.settings.physicalKit, sheetWidthMm: 20, sheetHeightMm: 20 },
    },
  };
})();
const softValidation = validateForFabrication(softProject, { allowSoftReadinessBlockers: true });
const softPolicy = fabricationExportPolicy(softValidation.readiness, softValidation.errors);
assert.equal(softPolicy.severity, 'warning', 'part-fit-only readiness is a warning severity');
assert.equal(softPolicy.eligible, true, 'warning-only readiness remains export eligible');
const hardProject = { ...softProject, mechanisms: [{ ...softProject.mechanisms[0], anchorX: 9_999, anchorY: 9_999 }] };
const hardValidation = validateForFabrication(hardProject, { allowSoftReadinessBlockers: true });
const hardPolicy = fabricationExportPolicy(hardValidation.readiness, hardValidation.errors);
assert.equal(hardPolicy.severity, 'blocked', 'board or geometry errors remain blocking severity');
assert.equal(hardPolicy.eligible, false, 'hard readiness errors cannot use the warning export policy');

const packageSource = largeReadyProject();
const generatedPackage = createFabricationPackage(packageSource);
const exported = applyProjectAction(packageSource, { type: 'set_export', fabricationPackage: generatedPackage });
assert.strictEqual(exported.lastExport, generatedPackage, 'set_export preserves the generated package identity through touch');
const blueprintHtml = renderToStaticMarkup(createElement(BlueprintExport, {
  project: exported,
  dispatch: () => {},
  goStage: () => {},
}));
assert(blueprintHtml.includes('blueprint-export-package-json'), 'Blueprint consumes the preserved current package directly');
const assemblyHtml = renderToStaticMarkup(createElement(AssemblyGuide, {
  project: exported,
  dispatch: () => {},
  goStage: () => {},
  stepIndex: 0,
  setStepIndex: () => {},
  stepProgress: 0,
  setStepProgress: () => {},
  playing: false,
  setPlaying: () => {},
  setStepCount: () => {},
}));
assert(assemblyHtml.includes('aria-label="Print"'), 'Assembly consumes the preserved current package directly');

const uiOnly = applyProjectAction(exported, { type: 'update_settings', settings: { theme: 'dark' } });
assert.strictEqual(uiOnly.lastExport, generatedPackage, 'UI-only settings preserve the export package');
const physicalChange = applyProjectAction(exported, {
  type: 'update_settings',
  settings: { physicalKit: { ...exported.settings.physicalKit, gridPitchMm: 25 } },
});
assert.equal(physicalChange.lastExport, undefined, 'physical-kit changes clear stale exports at the aggregate boundary');
const mechanismChange = applyProjectAction(exported, {
  type: 'update_joint',
  jointId: 'right_elbow',
  updates: { position: { x: 222, y: 111 } },
});
assert.equal(mechanismChange.lastExport, undefined, 'scene edits clear stale exports at the aggregate boundary');
const imported = loadProjectSnapshot({ ...exported, lastExport: generatedPackage });
assert.equal(imported.lastExport, undefined, 'project load never trusts a serialized export package');

console.log('G2 coordinate, readiness, and export contracts passed');

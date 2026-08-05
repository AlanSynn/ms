import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MechanismRecommendationSheet } from '../components/stages/path/MechanismRecommendationSheet';
import type { MechanismConfig, ProjectState } from '../types';
import { boardToScene, physicalKitPreset, sceneToBoard } from '../utils/coordinates';
import { resolveFoundryTransaction } from '../utils/foundryTransaction';
import { completeAutomaticFitCandidate } from '../utils/fourBarPathFit';
import { calculateLinkage } from '../utils/kinematics';
import { mechanismDescriptorWithinSheet } from '../utils/mechanismCollision';
import { compileMechanismGraphFabrication } from '../utils/mechanismCompiler';
import {
  authorMechanismConnectionSelection,
  connectionSelectionAccepted,
  resolveFourBarConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { buildMechanismPhysicalEnvelopeDescriptors } from '../utils/mechanismPhysicalEnvelope';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { synchronizedMechanismCollisionOracle } from '../utils/mechanismCollision';
import { mechanismReadiness, projectMechanismReadiness } from '../utils/mechanismReadiness';
import {
  buildMechanismRecommendations,
  fitMechanismToTargetPathResult,
  fitRecommendedMechanismToSheet,
} from '../utils/mechanismRecommendations';
import { validateMechanismPreviewReadiness } from '../utils/mechanismPreviewReadiness';
import { ALL_MECHANISM_TYPES, AUTHORABLE_MECHANISM_TYPES } from '../utils/mechanismTemplates';
import { pathOwnedTargetFields } from '../utils/pathTargets';
import { applyProjectAction, createLessonProject, createSampleProject } from '../utils/project';

const fitProject = (): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    mechanisms: [],
  };
};

const fitSeed = (type: MechanismConfig['type']): MechanismConfig => ({
  ...createDefaultMechanism(type, `fit-${type}`),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const withoutPackage = (mechanism: MechanismConfig) => {
  const { foundryExport: _foundryExport, ...geometry } = mechanism;
  return geometry;
};

{
  const project = createLessonProject('waving-arm');
  const prior = project.mechanisms[0]!;
  const rawTarget = { ...prior, couplerLength: 111 };
  const fitted = fitRecommendedMechanismToSheet(project, rawTarget);
  assert.notEqual(fitted.couplerLength, 111, 'Fit snaps a raw target between linkage sizes to a legal blank');
  assert.equal(
    fitted.connectionSelections?.['4bar.output-joint']?.kind,
    'linkage-hole',
    'Fit persists the physical output hole for the snapped aggregate',
  );
  assert.equal(
    compileMechanismGraphFabrication(fitted, project.settings.physicalKit).buildable,
    true,
    'Fit returns a directly compiler-ready aggregate',
  );
  assert.deepEqual(
    validateMechanismPreviewReadiness(fitted, project.settings.physicalKit),
    [],
    'Fit returns an aggregate without preview-readiness errors',
  );
}

const numbersAreFinite = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(numbersAreFinite);
  if (value && typeof value === 'object') return Object.values(value).every(numbersAreFinite);
  return true;
};

const isExactBoardHole = (point: { x: number; y: number }, project: ProjectState) => {
  const board = sceneToBoard(point, project.settings.physicalKit);
  return board.valid
    && Math.hypot(
      point.x - boardToScene(board.col, board.row, project.settings.physicalKit).x,
      point.y - boardToScene(board.col, board.row, project.settings.physicalKit).y,
    ) < 0.001;
};

for (const type of AUTHORABLE_MECHANISM_TYPES) {
  const project = fitProject();
  const prior = fitSeed(type);
  const result = fitMechanismToTargetPathResult(project, prior, 'path-right-arm');
  if (result.accepted) {
    assert.equal(result.readiness.simulationSafe, true, `${type} publishes only a simulation-safe fit`);
    assert.equal(result.mechanism.targetPartId, 'right_hand_part', `${type} keeps exact path ownership`);
    assert.deepEqual(result.mechanism.activeVisualPartIds, ['right_hand_part'], `${type} keeps one exact visual owner`);
    assert(numbersAreFinite(result.mechanism), `${type} publishes only finite candidate data`);
    const board = sceneToBoard(
      { x: result.mechanism.anchorX ?? 0, y: result.mechanism.anchorY ?? 0 },
      project.settings.physicalKit,
    );
    assert.deepEqual(
      { x: result.mechanism.anchorX, y: result.mechanism.anchorY },
      boardToScene(board.col, board.row, project.settings.physicalKit),
      `${type} publishes a board-snapped anchor`,
    );
  } else {
    assert(result.blockers.length > 0, `${type} returns an explicit blocker when no candidate is accepted`);
    assert.deepEqual(withoutPackage(result.mechanism), withoutPackage(prior), `${type} preserves prior geometry on rejection`);
  }
}

const noRecipeProject = fitProject();
const noRecipeFit = fitMechanismToTargetPathResult(noRecipeProject, fitSeed('5bar'), 'path-right-arm');
assert.equal(noRecipeFit.accepted, true, 'missing recipe alone does not block simulation-safe Fit');
assert.equal(noRecipeFit.readiness.status, 'fabrication-unsupported', 'no-recipe Fit keeps its explicit fabrication tier');

for (const type of ALL_MECHANISM_TYPES) {
  const detached = fitSeed(type);
  delete detached.targetPartId;
  delete detached.targetPathId;
  delete detached.targetAnchorJointId;
  const detachedResult = completeAutomaticFitCandidate(fitProject(), detached, detached);
  assert.equal(detachedResult.accepted, false, `${type} detached candidate cannot complete automatic Fit`);
  assert.equal(detachedResult.readiness.simulationSafe, false, `${type} detached Fit fails project-context acceptance`);

  const owner = fitSeed('4bar');
  owner.id = `fit-owner-${type}`;
  const duplicate = fitSeed(type);
  const duplicateProject = fitProject();
  duplicateProject.mechanisms = [owner];
  const duplicateResult = completeAutomaticFitCandidate(duplicateProject, duplicate, duplicate);
  assert.equal(duplicateResult.accepted, false, `${type} duplicate-owner candidate cannot complete automatic Fit`);
  assert.equal(duplicateResult.readiness.simulationSafe, false, `${type} duplicate Fit fails project-context acceptance`);
}

const recommendationProject = fitProject();
const recommendationPath = recommendationProject.paths['path-right-arm'];
const recommendations = buildMechanismRecommendations(
  recommendationProject,
  recommendationProject.parts.right_hand_part,
  recommendationPath,
);
assert(recommendations.length > 0, 'recommendations publish accepted whole candidates');
assert(recommendations.every(option => option.fabricationErrors.length === 0), 'build recommendations publish only project-ready candidates');
const fourBarRecommendation = recommendations.find(option => option.type === '4bar');
assert(fourBarRecommendation, 'the default physical kit keeps a safe four-bar recommendation');
assert.equal(
  projectMechanismReadiness({ ...recommendationProject, mechanisms: [fourBarRecommendation.mechanism] }).status,
  'project-ready',
  'the default-kit four-bar recommendation is project-ready',
);
assert.deepEqual(
  {
    targetPartId: fourBarRecommendation.mechanism.targetPartId,
    targetSceneObjectId: fourBarRecommendation.mechanism.targetSceneObjectId,
    targetPathId: fourBarRecommendation.mechanism.targetPathId,
    targetAnchorJointId: fourBarRecommendation.mechanism.targetAnchorJointId,
    activeVisualPartIds: fourBarRecommendation.mechanism.activeVisualPartIds,
  },
  pathOwnedTargetFields(recommendationPath),
  'the safe four-bar recommendation keeps exact path ownership',
);
recommendationProject.mechanisms = [fitSeed('5bar')];
assert.deepEqual(
  buildMechanismRecommendations(
    recommendationProject,
    recommendationProject.parts.right_hand_part,
    recommendationPath,
  ),
  [],
  'occupied ownership suppresses automatic recommendations',
);
const noSafeFitMarkup = renderToString(createElement(MechanismRecommendationSheet, {
  isOpen: true,
  project: recommendationProject,
  selectedPart: recommendationProject.parts.right_hand_part,
  selectedPath: recommendationPath,
  onClose: () => undefined,
  onApply: () => undefined,
}));
assert(noSafeFitMarkup.includes('No safe fit.'), 'a valid path with no accepted recommendation shows the safe-fit blocker');
assert(!noSafeFitMarkup.includes('Draw more path.'), 'a valid path does not ask for more points');

const shortPath = { ...recommendationPath, points: recommendationPath.points.slice(0, 2) };
const shortPathMarkup = renderToString(createElement(MechanismRecommendationSheet, {
  isOpen: true,
  project: recommendationProject,
  selectedPart: recommendationProject.parts.right_hand_part,
  selectedPath: shortPath,
  onClose: () => undefined,
  onApply: () => undefined,
}));
assert(shortPathMarkup.includes('Draw more path.'), 'paths with fewer than three points ask for more path');

const deterministicProject = fitProject();
const deterministicSeed = fitSeed('piston');
const firstFit = fitMechanismToTargetPathResult(deterministicProject, deterministicSeed, 'path-right-arm');
const secondFit = fitMechanismToTargetPathResult(deterministicProject, deterministicSeed, 'path-right-arm');
assert.deepEqual(secondFit, firstFit, 'repeated Fit does not drift warnings, path, anchor, or readiness');

const compactEnvelopeProject = createLessonProject('waving-arm');
const compactEnvelopePath = compactEnvelopeProject.paths['path-right-arm'];
const compactLandingBoard = sceneToBoard(
  compactEnvelopePath.points[0],
  compactEnvelopeProject.settings.physicalKit,
);
const compactLanding = boardToScene(
  compactLandingBoard.col,
  compactLandingBoard.row,
  compactEnvelopeProject.settings.physicalKit,
);
let compactEnvelopePrior: MechanismConfig = {
  ...compactEnvelopeProject.mechanisms[0],
  anchorX: compactLanding.x,
  anchorY: compactLanding.y,
  sceneAnchor: compactLanding,
  transform: {
    ...(compactEnvelopeProject.mechanisms[0].transform ?? {
      x: compactLanding.x,
      y: compactLanding.y,
      rotation: 90,
      scale: 1,
    }),
    x: compactLanding.x,
    y: compactLanding.y,
    rotation: 90,
  },
  groundAngle: 90,
  groundLength: 120,
  crankLength: 160,
  couplerLength: 160,
  rockerLength: 160,
};
compactEnvelopePrior = {
  ...compactEnvelopePrior,
  ...authorMechanismConnectionSelection(
    compactEnvelopePrior,
    '4bar.input-joint',
    { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 4 },
  ),
};
compactEnvelopePrior = {
  ...compactEnvelopePrior,
  ...authorMechanismConnectionSelection(
    compactEnvelopePrior,
    '4bar.output-joint',
    { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 4 },
  ),
};
compactEnvelopeProject.mechanisms = [compactEnvelopePrior];
compactEnvelopeProject.selectedMechanismId = compactEnvelopePrior.id;
const physicalDescriptors = (mechanism: MechanismConfig) => {
  const compiled = compileMechanismGraphFabrication(
    mechanism,
    compactEnvelopeProject.settings.physicalKit,
  );
  return buildMechanismPhysicalEnvelopeDescriptors(
    mechanism,
    undefined,
    compiled.renderPlan,
    compactEnvelopeProject.settings.physicalKit,
  );
};
assert(
  physicalDescriptors(compactEnvelopePrior).some(
    descriptor => !mechanismDescriptorWithinSheet(
      descriptor,
      compactEnvelopeProject.settings.physicalKit,
    ),
  ),
  'compact 5-hole four-bar starts with its compiler-backed physical envelope off-sheet near the guided target',
);
const compactEnvelopeSelections = structuredClone(compactEnvelopePrior.connectionSelections);
const compactEnvelopeFit = fitRecommendedMechanismToSheet(
  compactEnvelopeProject,
  compactEnvelopePrior,
);
assert(physicalDescriptors(compactEnvelopeFit).length > 0, 'fitted compact four-bar has complete physical-envelope coverage');
assert(
  physicalDescriptors(compactEnvelopeFit).every(
    descriptor => mechanismDescriptorWithinSheet(
      descriptor,
      compactEnvelopeProject.settings.physicalKit,
    ),
  ),
  'sheet fitting moves every compiler-backed linkage and hardware envelope inside the sheet',
);
assert.equal(isExactBoardHole(
  { x: compactEnvelopeFit.anchorX ?? 0, y: compactEnvelopeFit.anchorY ?? 0 },
  compactEnvelopeProject,
), true, 'physical-envelope fitting preserves exact board-hole anchor snapping');
assert.deepEqual(
  compactEnvelopeFit.connectionSelections,
  compactEnvelopeSelections,
  'physical-envelope fitting preserves accepted 5-hole linkage selections',
);
assert.equal(
  projectMechanismReadiness({ ...compactEnvelopeProject, mechanisms: [compactEnvelopeFit] }).status,
  'project-ready',
  'a valid binding proceeds through project readiness after physical-envelope placement',
);

const customPitchLesson = applyProjectAction(createLessonProject('waving-arm'), {
  type: 'update_settings',
  settings: { physicalKit: { gridPitchMm: 25 } as ProjectState['settings']['physicalKit'] },
});
const customPitchPrior = customPitchLesson.mechanisms.find(({ type }) => type === '4bar')!;
const customPitchPriorState = calculateLinkage(customPitchPrior, 0);
assert.equal(
  mechanismReadiness(customPitchLesson, customPitchPrior).simulationSafe,
  false,
  'changing Options grid pitch leaves the stored four-bar unsafe until canonical recovery',
);
assert.equal(
  projectMechanismReadiness(customPitchLesson).status,
  'blocked',
  'the unsafe stored four-bar blocks project readiness',
);
assert.equal(
  isExactBoardHole(customPitchPriorState.p2, customPitchLesson),
  false,
  'the stored four-bar ground endpoint is off the active 25mm board grid',
);
const customPitchFit = fitMechanismToTargetPathResult(
  customPitchLesson,
  customPitchPrior,
  customPitchPrior.targetPathId,
);
assert.equal(customPitchFit.accepted, true, 'canonical Fit recovers the four-bar on a custom board pitch');
assert.equal(customPitchFit.readiness.simulationSafe, true, 'custom-pitch recovery publishes a complete safe candidate');
assert.equal(customPitchFit.readiness.fabricationReady, true, 'custom-pitch recovery publishes a fabrication-ready candidate');
const customPitchFitState = calculateLinkage(customPitchFit.mechanism, 0);
assert.equal(isExactBoardHole(customPitchFitState.p1, customPitchLesson), true, 'recovered input anchor is an active-kit board hole');
assert.equal(isExactBoardHole(customPitchFitState.p2, customPitchLesson), true, 'recovered ground endpoint is an active-kit board hole');
assert.equal(
  projectMechanismReadiness({ ...customPitchLesson, mechanisms: [customPitchFit.mechanism] }).status,
  'project-ready',
  'installing the recovered four-bar makes the project ready',
);
assert.deepEqual(
  {
    targetPartId: customPitchFit.mechanism.targetPartId,
    targetSceneObjectId: customPitchFit.mechanism.targetSceneObjectId,
    targetPathId: customPitchFit.mechanism.targetPathId,
    targetAnchorJointId: customPitchFit.mechanism.targetAnchorJointId,
    activeVisualPartIds: customPitchFit.mechanism.activeVisualPartIds,
  },
  pathOwnedTargetFields(customPitchLesson.paths[customPitchPrior.targetPathId!]),
  'custom-pitch recovery preserves exact target and path ownership',
);

const authoredProject = applyProjectAction(fitProject(), {
  type: 'update_settings',
  settings: {
    physicalKit: { boardCells: 31, sheetWidthMm: 700, sheetHeightMm: 700 } as ProjectState['settings']['physicalKit'],
  },
});
const authoredPath = authoredProject.paths['path-right-arm'];
let authoredPrior = {
  ...createDefaultMechanism('4bar', 'authored-fit-four-bar'),
  ...pathOwnedTargetFields(authoredPath),
};
authoredPrior = {
  ...authoredPrior,
  ...authorMechanismConnectionSelection(
    authoredPrior,
    '4bar.input-joint',
    { kind: 'linkage-hole', linkageKey: 'linkage-8-cell', holeIndex: 3 },
  ),
};
authoredPrior = {
  ...authoredPrior,
  ...authorMechanismConnectionSelection(
    authoredPrior,
    '4bar.output-joint',
    { kind: 'linkage-hole', linkageKey: 'linkage-8-cell', holeIndex: 5 },
  ),
};
authoredProject.mechanisms = [authoredPrior];
authoredProject.selectedMechanismId = authoredPrior.id;
assert.equal(projectMechanismReadiness(authoredProject).status, 'project-ready', 'authored interior-hole fixture is fabrication-valid');
const authoredSelections = structuredClone(authoredPrior.connectionSelections);
const authoredLengths = { crankLength: authoredPrior.crankLength, rockerLength: authoredPrior.rockerLength };
const authoredFit = fitMechanismToTargetPathResult(authoredProject, authoredPrior, authoredPath.id);
if (authoredFit.accepted) {
  const resolved = resolveFourBarConnectionSelections(authoredFit.mechanism);
  assert.deepEqual(authoredFit.mechanism.connectionSelections, authoredSelections, 'Fit preserves exact accepted physical-hole choices');
  assert(connectionSelectionAccepted(resolved.validation, '4bar.input-joint'), 'Fit keeps the input selection accepted');
  assert(connectionSelectionAccepted(resolved.validation, '4bar.output-joint'), 'Fit keeps the output selection accepted');
  assert.deepEqual(
    { crankLength: authoredFit.mechanism.crankLength, rockerLength: authoredFit.mechanism.rockerLength },
    authoredLengths,
    'Fit keeps compatibility scalars aligned with accepted physical-hole lengths',
  );
  assert.equal(resolved.inputJoint?.length, authoredFit.mechanism.crankLength, 'input selection and crank scalar cannot diverge');
  assert.equal(resolved.outputJoint?.length, authoredFit.mechanism.rockerLength, 'output selection and rocker scalar cannot diverge');
} else {
  assert.deepEqual(authoredFit.mechanism, authoredPrior, 'failed authored Fit preserves the original mechanism atomically');
  assert(authoredFit.blockers.length > 0, 'failed authored Fit reports recovery blockers');
}

const tinyProject = fitProject();
tinyProject.settings = {
  ...tinyProject.settings,
  physicalKit: {
    ...tinyProject.settings.physicalKit,
    boardCells: 2,
    sheetWidthMm: 20,
    sheetHeightMm: 20,
  },
};
const packagedPrior = {
  ...fitSeed('piston'),
  foundryExport: {} as NonNullable<MechanismConfig['foundryExport']>,
};
const rejected = fitMechanismToTargetPathResult(tinyProject, packagedPrior, 'path-right-arm');
assert.equal(rejected.accepted, false, 'recipe-backed automatic Fit cannot succeed off-sheet');
assert.strictEqual(rejected.mechanism, packagedPrior, 'rejected Fit preserves the exact prior mechanism aggregate');
assert.strictEqual(rejected.mechanism.foundryExport, packagedPrior.foundryExport, 'rejected Fit preserves the exact prior package');
assert(rejected.blockers.length > 0, 'rejected Fit returns the shared readiness blocker');

const collisionProject = createSampleProject();
collisionProject.mechanisms = [];
collisionProject.settings = {
  ...collisionProject.settings,
  physicalKit: physicalKitPreset('letter-12x12-2cm', collisionProject.settings.physicalKit),
};
const rightPath = collisionProject.paths['path-right-arm'];
collisionProject.paths['path-left-arm'] = {
  ...rightPath,
  id: 'path-left-arm',
  partId: 'left_hand_part',
  targetAnchorJointId: 'left_hand',
  chainRootJointId: 'left_shoulder',
};
const firstOwnerFit = fitMechanismToTargetPathResult(
  collisionProject,
  { ...fitSeed('4bar'), id: 'fit-right-owner' },
  'path-right-arm',
);
assert.equal(firstOwnerFit.accepted, true, 'collision fixture starts with one accepted active-kit Fit');
const firstOwner = firstOwnerFit.mechanism;
const stalePackage = {} as NonNullable<MechanismConfig['foundryExport']>;
const secondOwnerPrior: MechanismConfig = {
  ...firstOwner,
  id: 'fit-left-owner',
  targetPartId: 'left_hand_part',
  targetPathId: 'path-left-arm',
  targetAnchorJointId: 'left_hand',
  activeVisualPartIds: ['left_hand_part'],
  foundryExport: stalePackage,
};
collisionProject.mechanisms = [firstOwner, secondOwnerPrior];
collisionProject.selectedMechanismId = secondOwnerPrior.id;
assert.deepEqual(
  projectMechanismReadiness(collisionProject).activeMechanismIds,
  [firstOwner.id, secondOwnerPrior.id],
  'both distinct owners are active in the collision gate',
);

assert.notEqual(firstOwner.id, secondOwnerPrior.id, 'overlapping mechanisms retain distinct IDs');
assert.deepEqual(
  { x: secondOwnerPrior.anchorX, y: secondOwnerPrior.anchorY },
  { x: firstOwner.anchorX, y: firstOwner.anchorY },
  'distinct owners may occupy the same physical position',
);
assert(
  synchronizedMechanismCollisionOracle(
    firstOwner,
    secondOwnerPrior,
    collisionProject.settings.physicalKit,
  ).collision,
  'same-position mechanisms collide under the active letter-size kit',
);

const collisionFit = fitMechanismToTargetPathResult(
  collisionProject,
  secondOwnerPrior,
  'path-left-arm',
);
const fittedProject = {
  ...collisionProject,
  mechanisms: collisionProject.mechanisms.map(mechanism =>
    mechanism.id === collisionFit.mechanism.id ? collisionFit.mechanism : mechanism,
  ),
};
const fittedReadiness = projectMechanismReadiness(fittedProject);
if (collisionFit.accepted) {
  assert.equal(fittedReadiness.status, 'project-ready', 'accepted collision-aware Fit is exactly project-ready');
  assert.equal(collisionFit.mechanism.targetPartId, 'left_hand_part', 'accepted Fit keeps exact part ownership');
  assert.equal(collisionFit.mechanism.targetPathId, 'path-left-arm', 'accepted Fit keeps exact path ownership');
  assert.equal(collisionFit.mechanism.targetAnchorJointId, 'left_hand', 'accepted Fit keeps exact anchor ownership');
  assert.deepEqual(collisionFit.mechanism.activeVisualPartIds, ['left_hand_part'], 'accepted Fit keeps exact visual ownership');
  const activeKitBoard = sceneToBoard(
    { x: collisionFit.mechanism.anchorX ?? 0, y: collisionFit.mechanism.anchorY ?? 0 },
    collisionProject.settings.physicalKit,
  );
  assert.deepEqual(
    { x: collisionFit.mechanism.anchorX, y: collisionFit.mechanism.anchorY },
    boardToScene(activeKitBoard.col, activeKitBoard.row, collisionProject.settings.physicalKit),
    'accepted Fit snaps through the active 12x12 kit',
  );
} else {
  assert(
    collisionFit.blockers.some(blocker => /collid|move one mechanism/i.test(blocker)),
    'rejected overlapping Fit reports a collision blocker',
  );
  assert.deepEqual(
    withoutPackage(collisionFit.mechanism),
    withoutPackage(secondOwnerPrior),
    'collision rejection preserves exact prior canonical geometry',
  );
  assert.equal(
    collisionProject.mechanisms[1]?.foundryExport,
    stalePackage,
    'pure Fit rejection does not mutate the stored stale package',
  );
  const transaction = resolveFoundryTransaction({
    project: collisionProject,
    candidate: collisionFit.mechanism,
    intent: 'fabrication-package',
  });
  assert.equal(transaction.status, 'blocked', 'collision blocks the transaction before commit');
  const committed = applyProjectAction(collisionProject, {
    type: 'commit_mechanism_candidate',
    result: transaction,
  });
  const committedSecondOwner = committed.mechanisms.find(mechanism => mechanism.id === secondOwnerPrior.id)!;
  assert.strictEqual(committed, collisionProject, 'blocked transaction commit preserves the exact prior project aggregate');
  assert.strictEqual(committedSecondOwner, secondOwnerPrior, 'blocked transaction commit preserves the exact prior mechanism');
  assert.strictEqual(committedSecondOwner.foundryExport, stalePackage, 'blocked transaction commit preserves the exact prior package');
}

console.log('mechanism fit readiness contracts passed');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { MechanismConfig, ProjectState } from '../types';
import { compactStudentActionForFabricationDiagnostic } from '../utils/fabricationReadiness';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { projectMechanismReadiness } from '../utils/mechanismReadiness';
import { fitMechanismToTargetPathResult } from '../utils/mechanismRecommendations';
import { createSampleProject } from '../utils/project';

const boundMechanism = (type: MechanismConfig['type'], id: string): MechanismConfig => ({
  ...createDefaultMechanism(type, id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const projectWith = (...mechanisms: MechanismConfig[]): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    mechanisms,
    selectedMechanismId: mechanisms[0]?.id,
    settings: {
      ...project.settings,
      physicalKit: {
        ...project.settings.physicalKit,
        sheetWidthMm: 1_000,
        sheetHeightMm: 1_000,
      },
    },
  };
};

const assertStudentBlockers = (project: ProjectState, forbiddenIds: string[]) => {
  const blockers = projectMechanismReadiness(project).blockers;
  assert.equal(blockers.length, new Set(blockers).size, 'visible project blockers are deduped');
  assert(blockers.every(blocker => blocker.length <= 90), 'visible project blockers stay compact');
  assert(blockers.every(blocker => !forbiddenIds.some(id => blocker.includes(id))), 'mechanism IDs stay structured, not visible');
  assert(blockers.every(blocker => !/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+:|\b[a-z]+_[a-z_]+\b|\bscore\b|\d+\.\d+/i.test(blocker)), 'visible blockers omit pairs, tuples, and scores');
  return blockers;
};

const duplicateA = boundMechanism('4bar', 'duplicate_alpha');
const duplicateB = boundMechanism('piston', 'duplicate_beta');
const duplicateBlockers = assertStudentBlockers(projectWith(duplicateA, duplicateB), [duplicateA.id, duplicateB.id]);
assert.deepEqual(duplicateBlockers, ['Fix: Choose anchor'], 'duplicate targets use the one binding recovery action');

const missingPath = boundMechanism('4bar', 'missing_path_mechanism');
delete missingPath.targetPathId;
const missingPathBlockers = assertStudentBlockers(projectWith(missingPath), [missingPath.id]);
assert.deepEqual(missingPathBlockers, ['Fix: Choose anchor'], 'missing paths use the exact binding recovery blocker');

const offSheet = boundMechanism('piston', 'off_sheet_mechanism');
const offSheetProject = projectWith(offSheet);
offSheetProject.settings.physicalKit = createSampleProject().settings.physicalKit;
const offSheetBlockers = assertStudentBlockers(offSheetProject, [offSheet.id]);
assert(offSheetBlockers.includes('Fit inside board.'), 'off-sheet geometry produces a board-fit action');

const collisionA = boundMechanism('4bar', 'collision_alpha');
const collisionB = { ...boundMechanism('piston', 'collision_beta'), targetPartId: 'left_hand_part' };
const collisionProject = projectWith(collisionA, collisionB);
collisionProject.settings.physicalKit = {
  ...collisionProject.settings.physicalKit,
  profileKey: 'warning-presentation-board',
  boardCells: 41,
};
collisionProject.paths['path-left-collision'] = {
  ...collisionProject.paths['path-right-arm'],
  id: 'path-left-collision',
  partId: 'left_hand_part',
  targetAnchorJointId: 'left_hand',
  chainRootJointId: 'left_shoulder',
};
collisionB.targetPathId = 'path-left-collision';
collisionB.targetAnchorJointId = 'left_hand';
collisionA.anchorX = collisionB.anchorX = 120;
const collisionBlockers = assertStudentBlockers(collisionProject, [collisionA.id, collisionB.id]);
assert.deepEqual(collisionBlockers, ['Move one mechanism. Mechanisms collide.'], 'collisions expose one compact action without an ID pair');

assert.equal(
  compactStudentActionForFabricationDiagnostic('Fix: Choose anchor'),
  'Fix: Choose anchor',
  'binding recovery copy remains exact',
);
assert.equal(
  compactStudentActionForFabricationDiagnostic('No motion · score 0.00'),
  'No full motion. Try reset or smaller links.',
  'no-motion scores become novice-safe copy',
);
assert.equal(
  compactStudentActionForFabricationDiagnostic('Motion 42% · 0°–151°'),
  'Motion may jam. Try a smaller move.',
  'partial-motion percentages become novice-safe copy',
);
assert.equal(
  compactStudentActionForFabricationDiagnostic('Fix: Placement off board'),
  'Fix: Fit inside board.',
  'meaningful Fix actions are preserved',
);

const tinyProject = projectWith();
tinyProject.settings.physicalKit = {
  ...tinyProject.settings.physicalKit,
  boardCells: 2,
  sheetWidthMm: 20,
  sheetHeightMm: 20,
};
const rejectedFit = fitMechanismToTargetPathResult(
  tinyProject,
  boundMechanism('piston', 'rejected_fit_mechanism'),
  'path-right-arm',
);
assert.equal(rejectedFit.accepted, false, 'tiny-board Fit exercises the rejected path');
assert(compactStudentActionForFabricationDiagnostic(rejectedFit.blockers[0]), 'rejected Fit has compact visible copy');

const workflowSource = readFileSync(new URL('../components/stages/mechanism/DesignWorkflowPanel.tsx', import.meta.url), 'utf8');
assert(workflowSource.includes('data-testid="design-add-blocker"'), 'rejected add/Fit has a visible local blocker');
assert(workflowSource.includes('setAddBlocker(null)') && workflowSource.includes('if (fitResult && !fitResult.accepted)'), 'new attempts clear old copy and rejected fits set it');

const inspectorSource = readFileSync(new URL('../components/stages/mechanism/DesignInspectorPanel.tsx', import.meta.url), 'utf8');
assert(inspectorSource.includes('compactStudentActionForFabricationDiagnostic(\n    projectReadiness.blockers[0]'), 'Design inspector compacts project blockers before rendering');
assert(!inspectorSource.includes('{projectReadiness.blockers[0]}'), 'Design inspector never renders raw project blockers');

console.log('mechanism warning presentation contracts passed');

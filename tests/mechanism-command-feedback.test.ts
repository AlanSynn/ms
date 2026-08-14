import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { AppStage, ProjectAction } from '../types';
import { useAppMechanismActions } from '../hooks/useAppMechanismActions';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import {
  constrainMechanismUpdate,
  resolveMechanismEditAttempt,
} from '../utils/mechanismEditAuthority';
import { applyProjectAction, createLessonProject } from '../utils/project';

const project = createLessonProject('waving-arm');
const mechanism = project.mechanisms[0]!;
const selectedPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
const dispatches: ProjectAction[] = [];
let stage: AppStage = 'character';
let commandStatus = '';
let actions: ReturnType<typeof useAppMechanismActions> | undefined;

const Harness = () => {
  actions = useAppMechanismActions({
    project,
    dispatch: (action) => dispatches.push(action),
    selectedPath,
    selectedMechanism: mechanism,
    foundry: createDefaultMechanism('4bar', 'feedback-foundry'),
    mechanismConfig: {
      speed: project.settings.animationSpeed,
      rotation: 0,
      mechanisms: project.mechanisms,
    },
    angle: 0,
    setStage: (nextStage) => { stage = nextStage; },
    setCommandStatus: (status) => { commandStatus = status; },
    setShowRecommendations: () => undefined,
  });
  return null;
};

renderToString(createElement(Harness));
assert(actions);
assert.deepEqual(
  constrainMechanismUpdate(
    mechanism,
    { groundAngle: mechanism.groundAngle ?? 0 },
    project.settings.physicalKit,
  ),
  {},
  'the legal endpoint is a true changed-only no-op before command feedback is evaluated',
);
assert.equal(
  actions.updateMechanism(mechanism.id, { groundAngle: mechanism.groundAngle ?? 0 }),
  true,
  'a legal no-op mechanism command returns accepted feedback',
);
assert.deepEqual(dispatches, [], 'a legal no-op command does not dispatch an unnecessary project write');
assert.equal(stage, 'character', 'a legal no-op command does not navigate stages');
assert.notEqual(commandStatus, 'Change blocked', 'a legal no-op command does not report a blocker');
assert.equal(
  actions.updateMechanism(mechanism.id, {}),
  true,
  'an empty legal mechanism command is reported as a no-op success',
);
assert.deepEqual(dispatches, [], 'an empty legal command does not dispatch a project write');

const clonedAttempt = resolveMechanismEditAttempt(project, mechanism, structuredClone(mechanism));
assert.equal(clonedAttempt.status, 'accepted');
assert.equal(clonedAttempt.outcome, 'no-op', 'the command boundary exposes a stable no-op outcome');
assert.strictEqual(clonedAttempt.mechanism, mechanism, 'a semantic no-op returns the exact prior aggregate member');
assert.strictEqual(
  applyProjectAction(project, { type: 'upsert_mechanism', mechanism: structuredClone(mechanism) }),
  project,
  'a semantic no-op preserves the exact ProjectState so history receives no write',
);

const snapProject = createLessonProject('waving-arm');
const snapMechanism = {
  ...snapProject.mechanisms[0]!,
  couplerLength: 111,
};
snapProject.mechanisms = [snapMechanism];
const snapDispatches: ProjectAction[] = [];
let snapCommandStatus = '';
let snapActions: ReturnType<typeof useAppMechanismActions> | undefined;
const SnapHarness = () => {
  snapActions = useAppMechanismActions({
    project: snapProject,
    dispatch: (action) => snapDispatches.push(action),
    selectedPath: snapProject.paths[snapMechanism.targetPathId!],
    selectedMechanism: snapMechanism,
    foundry: createDefaultMechanism('4bar', 'snap-feedback-foundry'),
    mechanismConfig: {
      speed: snapProject.settings.animationSpeed,
      rotation: 0,
      mechanisms: snapProject.mechanisms,
    },
    angle: 0,
    setStage: () => undefined,
    setCommandStatus: (status) => { snapCommandStatus = status; },
    setShowRecommendations: () => undefined,
  });
  return null;
};
renderToString(createElement(SnapHarness));
assert(snapActions);
await snapActions.optimizeSelectedMechanism();
assert.equal(
  snapCommandStatus,
  'Snapped: 5-hole',
  'an accepted automatic Fit surfaces its bounded physical snap result',
);
assert.equal(snapDispatches.length, 1, 'an accepted snapped Fit dispatches one complete aggregate write');

console.log('mechanism command feedback contracts passed');

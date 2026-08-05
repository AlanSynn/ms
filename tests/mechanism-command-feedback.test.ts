import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { AppStage, ProjectAction } from '../types';
import { useAppMechanismActions } from '../hooks/useAppMechanismActions';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { constrainMechanismUpdate } from '../utils/mechanismEditAuthority';
import { createLessonProject } from '../utils/project';

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

console.log('mechanism command feedback contracts passed');

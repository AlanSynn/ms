import assert from 'node:assert/strict';

import {
  FINAL_STUDY_ARTIFACT_MAX_BYTES,
  buildFinalStudyArtifact,
  emitFinalStudyArtifact,
  fabricationSignatureForStudy,
} from '../infrastructure/study-final/artifact';
import { pendingRecipeForMechanism } from '../utils/assemblyPlayback';
import { createLessonProject } from '../utils/project';

const project = createLessonProject('waving-arm');
const mechanism = project.mechanisms[0];
assert(mechanism, 'study fixture includes the guided mechanism');
const recipes = [pendingRecipeForMechanism(project, mechanism)];
const artifact = buildFinalStudyArtifact({
  project,
  recipes,
  fabrication: {
    signature: fabricationSignatureForStudy(project, recipes),
    readiness: 'ready',
  },
  blueprintReached: true,
  packageGenerated: false,
});

assert.equal(artifact.schema, 'motionsmith-final-study-v1');
assert.deepEqual(
  artifact.parts.map((part) => part.id),
  [...artifact.parts.map((part) => part.id)].sort(),
  'study parts are sorted by stable id',
);
assert.deepEqual(
  artifact.joints.map((joint) => joint.id),
  [...artifact.joints.map((joint) => joint.id)].sort(),
  'study joints are sorted by stable id',
);
assert.equal(artifact.paths[0]?.duration, project.paths['path-right-arm']?.duration);
assert.equal(artifact.mechanisms[0]?.type, mechanism.type);
assert.equal(artifact.fabrication.readiness, 'ready');
assert.equal(artifact.workflow.blueprintReached, true);
assert.equal(artifact.workflow.packageGenerated, false);

const payload = JSON.stringify(artifact);
assert(payload.includes('connectionSelections'));
assert(!payload.includes('sourceImageName'));
assert(!payload.includes('generatedPath'));
assert(!payload.includes('pointer'));
assert(!payload.includes('autosave'));
assert(new TextEncoder().encode(payload).byteLength <= FINAL_STUDY_ARTIFACT_MAX_BYTES);

const events: unknown[] = [];
const studyWindow = {
  dispatchEvent: (event: Event) => {
    events.push(event);
    return true;
  },
} as Window;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: studyWindow,
});
assert.equal(emitFinalStudyArtifact(artifact), true, 'study emits one final artifact');
assert.equal(emitFinalStudyArtifact(artifact), false, 'study refuses a second artifact');
assert.equal(events.length, 1, 'study emits one semantic event');
Reflect.deleteProperty(globalThis, 'window');

console.log('b695 final study artifact contract passed');

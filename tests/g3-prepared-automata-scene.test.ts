import assert from "node:assert/strict";

import {
  buildAutomataSceneModel,
  prepareAutomataSceneModel,
  samplePreparedAutomataSceneModel,
} from "../utils/automataSceneModel";
import { calculatePreparedLinkage } from "../utils/kinematics";
import { buildProjectMechanismSceneContract } from "../utils/mechanismSceneContract";
import { prepareMotionPreviewForProject } from "../utils/motion";
import { createLessonProject } from "../utils/project";

const project = createLessonProject("waving-arm");
const mechanism = project.mechanisms[0]!;
const prepared = prepareAutomataSceneModel(project, mechanism, "design-live");

assert.equal(prepared.kind, "active");
assert(prepared.foundryPreview);
assert(prepared.mechanismContract);
assert(prepared.fullMotion);
assert(prepared.selectedMotion);
assert.equal(
  prepared.fullMotion.mechanisms[0]?.kinematics,
  prepared.foundryPreview.kinematics,
  "the full-project motion and Foundry frame share one prepared kinematic input",
);
assert.equal(
  prepared.selectedMotion.mechanisms[0]?.kinematics,
  prepared.foundryPreview.kinematics,
  "the selected motion sampler reuses the same prepared kinematic input",
);

const structuralContract = prepared.mechanismContract;
const structuralPoints = prepared.foundryPreview.previewPoints;
const structuralTraces = prepared.foundryPreview.pointTraces;
const structuralWarnings = JSON.stringify(prepared.warnings);
const phases = [0, Math.PI / 7, Math.PI, Math.PI * 1.9];

for (const phase of phases) {
  const scene = samplePreparedAutomataSceneModel(prepared, phase);
  assert.equal(scene.mechanismContract, structuralContract);
  assert.equal(scene.foundryPreview?.previewPoints, structuralPoints);
  assert.equal(scene.foundryPreview?.pointTraces, structuralTraces);
  assert.deepEqual(
    scene.foundryPreview?.physicalSimulation.rawState,
    calculatePreparedLinkage(
      prepared.foundryPreview.kinematics,
      scene.foundryPreview.physicalSimulation.inputAngleRad,
    ),
  );
  assert.equal(scene.targetError, 0);
  assert.equal(scene.motionSource, "generatedPath");
}

assert.equal(JSON.stringify(prepared.warnings), structuralWarnings);
assert.equal(prepared.mechanismContract, structuralContract);
assert.equal(prepared.foundryPreview.previewPoints, structuralPoints);
assert.equal(prepared.foundryPreview.pointTraces, structuralTraces);

const replacedMechanism = { ...mechanism };
const replacedProject = { ...project, mechanisms: [replacedMechanism] };
assert.throws(
  () =>
    prepareMotionPreviewForProject(
      replacedProject,
      [replacedMechanism],
      new Map([[mechanism.id, prepared.foundryPreview!.kinematics]]),
    ),
  /stale/,
  "authoritative project replacement cannot reuse stale prepared motion",
);

for (const phase of phases.slice(1)) {
  const compatibility = buildAutomataSceneModel(
    project,
    mechanism,
    phase,
    "design-live",
  );
  const angleContract = buildProjectMechanismSceneContract(
    project,
    mechanism.id,
    undefined,
    phase,
  );
  assert.deepEqual(
    compatibility.mechanismContract?.physicalInstances,
    angleContract?.physicalInstances,
    "the compatibility builder preserves its angle-specific physical-instance contract",
  );
}

const recoveryMechanism = { ...mechanism, targetPartId: "missing-part" };
const recoveryProject = {
  ...project,
  mechanisms: [recoveryMechanism],
};
const recovery = prepareAutomataSceneModel(
  recoveryProject,
  recoveryMechanism,
  "assembly-live",
);
assert.equal(recovery.kind, "recovery");
const recoveryAtZero = samplePreparedAutomataSceneModel(recovery, 0);
const recoveryLater = samplePreparedAutomataSceneModel(recovery, Math.PI);
assert.equal(recoveryAtZero.foundryPreview, recoveryLater.foundryPreview);
assert.equal(recoveryLater.recoveryMechanism?.id, recoveryMechanism.id);
assert.equal(recoveryLater.motionSource, "none");

const hiddenMechanism = { ...mechanism, crankLength: Number.NaN };
const hiddenProject = { ...project, mechanisms: [hiddenMechanism] };
const hidden = prepareAutomataSceneModel(hiddenProject, hiddenMechanism);
assert.equal(hidden.kind, "hidden");
assert.equal(
  samplePreparedAutomataSceneModel(hidden, Math.PI / 3).foundryPreview,
  undefined,
);

const empty = prepareAutomataSceneModel(project, undefined);
assert.equal(empty.kind, "empty");
assert.deepEqual(samplePreparedAutomataSceneModel(empty, 1).mechanisms, []);

console.log("prepared automata scene contracts passed");

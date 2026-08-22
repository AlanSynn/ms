import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMechanismFitJobInput,
  runMechanismFitJob,
  type MechanismFitWorkerResponse,
} from '../runtime/fitting/mechanismFitJob';
import {
  createMechanismFitWorkerClient,
  type MechanismFitFrameScheduler,
  type MechanismFitWorkerPort,
} from '../runtime/fitting/mechanismFitWorkerClient';
import { designFamilyFitAuthorityChanged } from '../runtime/fitting/designFamilyFitAuthority';
import {
  applyProjectAction,
  createDefaultMechanism,
  createLessonProject,
  createSampleProject,
} from '../utils/project';
import { mechanismBoardPlacementErrors } from '../utils/fabrication';
import { boardToScene } from '../utils/coordinates';
import { snapMechanismAnchor } from '../utils/mechanismRecommendations';

const project = createSampleProject();
const pathId = project.selectedPathId ?? Object.keys(project.paths)[0];
const selectedPath = project.paths[pathId];
assert(pathId && selectedPath);
const mechanism = {
  ...createDefaultMechanism('gear_linkage', 'fit-worker-test'),
  targetPathId: pathId,
  targetPartId: selectedPath.partId,
};

const input = createMechanismFitJobInput(project, mechanism, 'path', pathId);
assert.doesNotThrow(() => structuredClone(input));
assert.deepEqual(
  runMechanismFitJob(input),
  runMechanismFitJob(input),
  'serialized fit jobs remain deterministic',
);

const offBoardSheetInput = createMechanismFitJobInput(
  project,
  { ...mechanism, targetPathId: undefined, anchorX: 9_999, anchorY: 9_999 },
  'sheet',
);
const offBoardSheetResult = runMechanismFitJob(offBoardSheetInput);
assert.deepEqual(
  mechanismBoardPlacementErrors(project, offBoardSheetResult.mechanism),
  [],
  'sheet fitting returns only a board-valid placement',
);
assert.notEqual(
  offBoardSheetResult.mechanism.anchorX,
  9_999,
  'sheet fitting moves an off-board anchor instead of accepting it',
);
let nearestBoardDistance = Number.POSITIVE_INFINITY;
for (let col = 0; col < project.settings.physicalKit.boardCells; col += 1) {
  for (let row = 0; row < project.settings.physicalKit.boardCells; row += 1) {
    const anchor = boardToScene(col, row, project.settings.physicalKit);
    const candidate = snapMechanismAnchor({
      ...offBoardSheetResult.mechanism,
      anchorX: anchor.x,
      anchorY: anchor.y,
    }, project);
    if (mechanismBoardPlacementErrors(project, candidate).length) continue;
    nearestBoardDistance = Math.min(
      nearestBoardDistance,
      Math.hypot(anchor.x - 9_999, anchor.y - 9_999),
    );
  }
}
assert(
  Math.hypot(
    (offBoardSheetResult.mechanism.anchorX ?? 0) - 9_999,
    (offBoardSheetResult.mechanism.anchorY ?? 0) - 9_999,
  ) <= nearestBoardDistance + 1e-9,
  'sheet fitting selects the nearest board-valid anchor, not the first valid cell',
);
assert.throws(
  () => runMechanismFitJob(createMechanismFitJobInput(
    project,
    {
      ...mechanism,
      targetPathId: undefined,
      anchorX: 9_999,
      anchorY: 9_999,
      crankLength: 5_000,
      groundLength: 5_000,
      couplerLength: 5_000,
      rockerLength: 5_000,
      couplerPointDist: 5_000,
    },
    'sheet',
  )),
  /No valid board placement/,
  'the fit worker fails instead of publishing an unplaceable mechanism',
);

const designProject = createLessonProject('waving-arm');
const designPathId = designProject.selectedPathId;
const designPath = designPathId ? designProject.paths[designPathId] : undefined;
const designFourBar = designProject.mechanisms[0];
assert(designPathId && designPath && designFourBar);
const editedFourBar = runMechanismFitJob(createMechanismFitJobInput(
  designProject,
  { ...designFourBar, anchorX: 280, anchorY: -120 },
  'path',
  designPathId,
)).mechanism;
const projectAfterInspectorFit = {
  ...applyProjectAction(designProject, {
    type: 'upsert_mechanism',
    mechanism: editedFourBar,
  }),
  metadata: {
    ...designProject.metadata,
    updatedAt: '2099-01-01T00:00:00.000Z',
  },
};
assert.equal(
  designFamilyFitAuthorityChanged(designProject, projectAfterInspectorFit),
  false,
  'a preceding four-bar inspector commit does not cancel an in-flight family fit',
);
const gearCandidate = {
  ...createDefaultMechanism('gear', 'design-gear-family'),
  targetPathId: designPath.id,
  targetPartId: designPath.sceneObjectId ? undefined : designPath.partId,
  targetSceneObjectId: designPath.sceneObjectId,
};
const fittedGear = runMechanismFitJob(createMechanismFitJobInput(
  designProject,
  gearCandidate,
  'path',
  designPath.id,
)).mechanism;
assert.deepEqual(
  mechanismBoardPlacementErrors(projectAfterInspectorFit, fittedGear),
  [],
  'the surviving Gear train result remains board-valid against the concurrent inspector commit',
);
const projectAfterGearSelection = applyProjectAction(projectAfterInspectorFit, {
  type: 'upsert_mechanism',
  mechanism: fittedGear,
});
assert.equal(
  projectAfterGearSelection.mechanisms.find(
    (candidate) => candidate.id === designFourBar.id,
  )?.anchorX,
  editedFourBar.anchorX,
  'the additive Gear train selection preserves the completed four-bar edit',
);
assert.equal(
  projectAfterGearSelection.mechanisms.find(
    (candidate) => candidate.id === fittedGear.id,
  )?.type,
  'gear',
  'the Gear train becomes the selected fitted family instead of remaining on four-bar',
);
assert.equal(projectAfterGearSelection.selectedMechanismId, fittedGear.id);
assert.equal(
  designFamilyFitAuthorityChanged(
    projectAfterInspectorFit,
    {
      ...projectAfterInspectorFit,
      paths: {
        ...projectAfterInspectorFit.paths,
        [designPath.id]: {
          ...designPath,
          points: designPath.points.map((point, index) =>
            index === 0 ? { x: point.x + 1, y: point.y } : point,
          ),
        },
      },
    },
  ),
  true,
  'a real target-path geometry change still cancels a stale family fit',
);
assert.equal(
  designFamilyFitAuthorityChanged(
    projectAfterInspectorFit,
    {
      ...projectAfterInspectorFit,
      settings: {
        ...projectAfterInspectorFit.settings,
        physicalKit: {
          ...projectAfterInspectorFit.settings.physicalKit,
          gridPitchMm:
            projectAfterInspectorFit.settings.physicalKit.gridPitchMm + 1,
        },
      },
    },
  ),
  true,
  'a fabrication-kit change still cancels a stale family fit',
);

class FakeWorker implements MechanismFitWorkerPort {
  onmessage: MechanismFitWorkerPort['onmessage'] = null;
  onmessageerror: MechanismFitWorkerPort['onmessageerror'] = null;
  onerror: MechanismFitWorkerPort['onerror'] = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(response: MechanismFitWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MechanismFitWorkerResponse>);
  }
}

const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
const scheduler: MechanismFitFrameScheduler = {
  requestFrame(callback) {
    const id = ++nextFrameId;
    frameCallbacks.set(id, callback);
    return id;
  },
  cancelFrame(handle) {
    frameCallbacks.delete(handle);
  },
};
const runFrame = () => {
  const entry = frameCallbacks.entries().next().value as
    | [number, FrameRequestCallback]
    | undefined;
  assert(entry, 'a deferred frame is scheduled');
  frameCallbacks.delete(entry[0]);
  entry[1](0);
};

const workers: FakeWorker[] = [];
const completions: string[] = [];
const client = createMechanismFitWorkerClient(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker;
}, scheduler);

client.request(input, {
  complete: () => completions.push('cancelled'),
  failed: (error) => assert.fail(error.message),
});
assert.equal(workers.length, 0, 'fit waits for two paints before constructing a worker');
runFrame();
client.cancel();
assert.equal(frameCallbacks.size, 0, 'cancellation clears a deferred second frame');
assert.equal(workers.length, 0, 'cancel-before-start allocates no worker heap');

client.request(input, {
  complete: () => completions.push('first'),
  failed: (error) => assert.fail(error.message),
});
runFrame();
runFrame();
assert.equal(workers.length, 1);
const staleHandler = workers[0].onmessage;
client.request(input, {
  complete: () => completions.push('second'),
  failed: (error) => assert.fail(error.message),
});
assert(workers[0].terminated, 'superseding a running fit releases its worker');
runFrame();
runFrame();
const activeWorker = workers[1];
activeWorker.respond({
  type: 'result',
  generationId: 4,
  inputFingerprint: input.inputFingerprint,
  result: runMechanismFitJob(input),
});
assert(activeWorker.terminated, 'successful fit releases the heavy worker heap');
assert.deepEqual(completions, ['second']);
staleHandler?.({
  data: {
    type: 'error',
    generationId: 3,
    inputFingerprint: input.inputFingerprint,
    message: 'stale',
  },
} as MessageEvent<MechanismFitWorkerResponse>);
assert.deepEqual(completions, ['second'], 'stale generations cannot update UI');
client.dispose();

const workerSource = readFileSync(
  join(process.cwd(), 'workers/mechanismFitWorker.ts'),
  'utf8',
);
assert(workerSource.includes('await import('), 'the heavy fit job loads inside its worker');

console.log('mechanism fit worker contract ok');

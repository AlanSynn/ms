import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import type { StarterImageTemplate } from '../components/AppShell';
import { useAppCharacterImportActions } from '../hooks/useAppCharacterImportActions';
import type { ProjectAction } from '../types';
import { createSampleProject } from '../utils/project';
import type { WebOnnxResult } from '../utils/webOnnx';
import { createCharacterImportProgressStore } from '../runtime/ai/characterImportProgressStore';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

type CharacterImageProcessor = NonNullable<
  Parameters<typeof useAppCharacterImportActions>[0]['processCharacterImage']
>;

type ProcessorCall = {
  file: File;
  generationId: number | undefined;
  signal: AbortSignal | undefined;
  completion: ReturnType<typeof deferred<WebOnnxResult>>;
};

type FetchCall = {
  url: RequestInfo | URL;
  signal: AbortSignal | null | undefined;
  completion: ReturnType<typeof deferred<Response>>;
};

const sample = createSampleProject();
assert(sample.skeleton, 'sample fixture has a skeleton');
const processedResult: WebOnnxResult = {
  skeleton: sample.skeleton,
  parts: sample.partOrder.map((partId) => sample.parts[partId]),
  textureUrl: 'data:image/png;base64,c291cmNl',
  maskUrl: 'data:image/png;base64,bWFzaw==',
  keypoints: [],
};

const processorCalls: ProcessorCall[] = [];
let nextProcessorStarted: ((call: ProcessorCall) => void) | undefined;
const processCharacterImage: CharacterImageProcessor = (
  file,
  _onProgress,
  options,
) => {
  const call: ProcessorCall = {
    file,
    generationId: options?.generationId,
    signal: options?.signal,
    completion: deferred<WebOnnxResult>(),
  };
  processorCalls.push(call);
  nextProcessorStarted?.(call);
  nextProcessorStarted = undefined;
  return call.completion.promise;
};

const fetchCalls: FetchCall[] = [];
const fetchStarterImage = ((url: RequestInfo | URL, init?: RequestInit) => {
  const call: FetchCall = {
    url,
    signal: init?.signal,
    completion: deferred<Response>(),
  };
  fetchCalls.push(call);
  return call.completion.promise;
}) as typeof fetch;

const template = (id: string): StarterImageTemplate => ({
  id,
  label: id,
  fileName: `${id}.png`,
  url: `/starters/${id}.png`,
  thumbUrl: `/starters/${id}.png`,
});

const dispatches: ProjectAction[] = [];
const characterImportProgress = createCharacterImportProgressStore();
let readyPublications = 0;
characterImportProgress.subscribeProgress(() => {
  if (characterImportProgress.getProgress()?.stage === 'ready') readyPublications += 1;
});
let actions: ReturnType<typeof useAppCharacterImportActions> | undefined;
const Harness = () => {
  actions = useAppCharacterImportActions({
    project: sample,
    stage: 'character',
    dispatch: (action) => dispatches.push(action),
    setProject: () => {},
    setStage: () => {},
    setCommandStatus: () => {},
    setShowGettingStarted: () => {},
    setOnnxCacheStatus: () => {},
    characterImportProgress,
    processCharacterImage,
    fetchStarterImage,
    yieldBeforeInference: () => undefined,
  });
  return null;
};
renderToString(createElement(Harness));
assert(actions, 'character import action harness renders');

const readyCount = () => readyPublications;

const staleStarter = actions.loadStarterImage(template('stale-starter'));
assert.equal(fetchCalls.length, 1, 'starter acquisition begins immediately');
const staleStarterFetch = fetchCalls[0];
assert(staleStarterFetch.signal, 'starter fetch receives its import AbortSignal');
assert.equal(staleStarterFetch.signal.aborted, false);

const latestDirect = actions.runWebOnnx(
  new File(['latest'], 'latest-direct.png', { type: 'image/png' }),
);
assert.equal(staleStarterFetch.signal.aborted, true, 'new direct import aborts the older starter fetch');
assert.equal(processorCalls.length, 1, 'new direct import starts inference without waiting for the stale starter');
const latestDirectCall = processorCalls[0];

let staleBlobReads = 0;
staleStarterFetch.completion.resolve({
  ok: true,
  blob: async () => {
    staleBlobReads += 1;
    return new Blob(['stale'], { type: 'image/png' });
  },
} as Response);
await staleStarter;
assert.equal(staleBlobReads, 0, 'a superseded starter response cannot continue into blob work');
assert.equal(processorCalls.length, 1, 'a superseded starter response cannot start inference');
assert.equal(latestDirectCall.signal?.aborted, false, 'the stale starter completion cannot abort the newer direct import');

latestDirectCall.completion.resolve(processedResult);
await latestDirect;
assert.equal(readyCount(), 1, 'the newer direct import is the only committed result');

const staleDirect = actions.runWebOnnx(
  new File(['stale'], 'stale-direct.png', { type: 'image/png' }),
);
const staleDirectCall = processorCalls.at(-1)!;
const latestStarter = actions.loadStarterImage(template('latest-starter'));
const latestStarterFetch = fetchCalls.at(-1)!;
assert.equal(staleDirectCall.signal?.aborted, true, 'new starter selection aborts older direct inference');
assert(latestStarterFetch.signal, 'new starter fetch receives its own AbortSignal');
assert.notEqual(latestStarterFetch.signal, staleDirectCall.signal, 'each user import owns a distinct controller');

const latestProcessorStarted = new Promise<ProcessorCall>((resolve) => {
  nextProcessorStarted = resolve;
});
latestStarterFetch.completion.resolve({
  ok: true,
  blob: async () => new Blob(['latest'], { type: 'image/png' }),
} as Response);
const latestStarterCall = await latestProcessorStarted;
assert.equal(latestStarterCall.file.name, 'latest-starter.png');

staleDirectCall.completion.resolve(processedResult);
await staleDirect;
assert.equal(readyCount(), 1, 'a stale direct inference result cannot commit over a newer starter');
assert.equal(latestStarterCall.signal?.aborted, false, 'a stale direct result cannot abort newer starter inference');

latestStarterCall.completion.resolve(processedResult);
await latestStarter;
assert.equal(readyCount(), 2, 'the newer starter result commits after stale direct inference settles');

console.log('character import supersession contract ok');

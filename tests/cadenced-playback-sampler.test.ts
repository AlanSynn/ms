import { strict as assert } from 'node:assert';

import type { PlaybackClockFrame } from '../runtime/playback/externalPlaybackClock';
import {
  HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS,
  subscribeCadencedPlaybackSampler,
} from '../runtime/playback/cadencedPlaybackSampler';

let phase = 0;
let listener: ((frame: PlaybackClockFrame) => void) | undefined;
const clock = {
  getPhase: () => phase,
  subscribe: (next: (frame: PlaybackClockFrame) => void) => {
    listener = next;
    return () => {
      listener = undefined;
    };
  },
};
const sampledPhases: number[] = [];
const appliedPhases: number[] = [];
const unsubscribe = subscribeCadencedPlaybackSampler({
  clock,
  minFrameIntervalMs: 50,
  sample: (nextPhase) => {
    sampledPhases.push(nextPhase);
    return { phase: nextPhase };
  },
  apply: (frame) => appliedPhases.push(frame.phase),
});

assert.deepEqual(sampledPhases, [0], 'subscription samples the initial frame once');
assert(listener, 'subscription installs one clock listener');

for (let time = 8; time <= 1_000; time += 8) {
  phase += 0.01;
  listener({
    elapsedMs: 8,
    phase,
    time,
    phaseChanged: true,
  });
}

assert(
  sampledPhases.length >= 19 && sampledPhases.length <= 21,
  '50ms cadence limits expensive sampling to about 20fps under a 125Hz clock',
);
assert.equal(
  appliedPhases.length,
  sampledPhases.length,
  'every computed frame is applied exactly once',
);

const beforeScrub = sampledPhases.length;
phase = 2.4;
listener({
  elapsedMs: 0,
  phase,
  time: 1_001,
  phaseChanged: true,
});
assert.equal(
  sampledPhases.length,
  beforeScrub + 1,
  'explicit scrub samples immediately even inside the cadence window',
);

listener({
  elapsedMs: 8,
  phase,
  time: 1_009,
  phaseChanged: false,
});
assert.equal(
  sampledPhases.length,
  beforeScrub + 1,
  'unchanged clock ticks do not sample',
);

unsubscribe();
assert.equal(listener, undefined, 'unsubscribe releases the clock listener');

const deferredSampledPhases: number[] = [];
const deferredAppliedPhases: number[] = [];
const unsubscribeDeferred = subscribeCadencedPlaybackSampler({
  clock,
  minFrameIntervalMs: 50,
  sampleInitial: false,
  sample: (nextPhase) => {
    deferredSampledPhases.push(nextPhase);
    return { phase: nextPhase };
  },
  apply: (frame) => deferredAppliedPhases.push(frame.phase),
});

assert.deepEqual(
  deferredSampledPhases,
  [],
  'a retained scene can own its initial frame without a duplicate subscription sample',
);
phase = 2.7;
const deferredListener = listener as ((frame: PlaybackClockFrame) => void) | undefined;
assert(deferredListener, 'deferred sampler installs one clock listener');
deferredListener({
  elapsedMs: 0,
  phase,
  time: 1_100,
  phaseChanged: true,
});
assert.deepEqual(
  deferredSampledPhases,
  [2.7],
  'deferred initial sampling still applies an explicit scrub immediately',
);
assert.deepEqual(
  deferredAppliedPhases,
  deferredSampledPhases,
  'deferred sampling applies every delivered frame exactly once',
);
unsubscribeDeferred();
assert.equal(listener, undefined, 'deferred sampler releases its clock listener');

const toleranceSamples: number[] = [];
const unsubscribeTolerance = subscribeCadencedPlaybackSampler({
  clock,
  minFrameIntervalMs: 25,
  earlyToleranceMs: HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS,
  sampleInitial: false,
  sample: (nextPhase) => nextPhase,
  apply: (nextPhase) => toleranceSamples.push(nextPhase),
});
const toleranceListener = listener as ((frame: PlaybackClockFrame) => void) | undefined;
assert(toleranceListener, 'tolerant sampler installs one clock listener');
toleranceListener({
  elapsedMs: 24,
  phase: 3,
  time: 24,
  phaseChanged: true,
});
assert.deepEqual(
  toleranceSamples,
  [3],
  'High probation accepts a clock tick no more than 1ms before its 25ms cadence boundary',
);
toleranceListener({
  elapsedMs: 23,
  phase: 3.1,
  time: 47,
  phaseChanged: true,
});
assert.deepEqual(
  toleranceSamples,
  [3],
  'the tolerance cannot submit more than 1ms before the accumulated boundary',
);
toleranceListener({
  elapsedMs: 1,
  phase: 3.2,
  time: 48,
  phaseChanged: true,
});
assert.deepEqual(
  toleranceSamples,
  [3, 3.2],
  'the accumulated cadence remains anchored instead of drifting earlier each frame',
);
unsubscribeTolerance();
assert.equal(listener, undefined, 'tolerant sampler releases its clock listener');

console.log('cadenced playback sampler contract ok');

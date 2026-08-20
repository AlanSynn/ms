import { strict as assert } from 'node:assert';

import type { PlaybackClockFrame } from '../runtime/playback/externalPlaybackClock';
import { subscribeCadencedPlaybackSampler } from '../runtime/playback/cadencedPlaybackSampler';

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

console.log('cadenced playback sampler contract ok');

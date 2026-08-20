import type {
  PlaybackClock,
  PlaybackClockFrame,
} from './externalPlaybackClock';

type CadencedPlaybackClock = Pick<PlaybackClock, 'getPhase' | 'subscribe'>;

export type CadencedPlaybackSamplerOptions<Frame> = {
  clock: CadencedPlaybackClock;
  sample: (phase: number) => Frame | undefined;
  minFrameIntervalMs: number;
  apply: (frame: Frame, time: number, forced: boolean) => void;
};

export const subscribeCadencedPlaybackSampler = <Frame>({
  clock,
  sample,
  minFrameIntervalMs,
  apply,
}: CadencedPlaybackSamplerOptions<Frame>) => {
  let lastSampleTime = Number.NEGATIVE_INFINITY;
  const sampleAt = (phase: number, time: number, forced: boolean) => {
    if (
      !forced &&
      time !== 0 &&
      time - lastSampleTime < minFrameIntervalMs
    )
      return;
    const frame = sample(phase);
    if (frame === undefined) return;
    if (
      !forced &&
      Number.isFinite(lastSampleTime) &&
      minFrameIntervalMs > 0
    ) {
      const elapsedIntervals = Math.max(
        1,
        Math.floor((time - lastSampleTime) / minFrameIntervalMs),
      );
      lastSampleTime += elapsedIntervals * minFrameIntervalMs;
    } else {
      lastSampleTime = time;
    }
    apply(frame, time, forced);
  };

  sampleAt(clock.getPhase(), 0, true);
  return clock.subscribe((clockFrame: PlaybackClockFrame) => {
    if (!clockFrame.phaseChanged && clockFrame.elapsedMs !== 0) return;
    sampleAt(
      clockFrame.phase,
      clockFrame.time,
      clockFrame.elapsedMs === 0,
    );
  });
};

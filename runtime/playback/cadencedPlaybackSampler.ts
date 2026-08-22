import type {
  PlaybackClock,
  PlaybackClockFrame,
} from './externalPlaybackClock';

type CadencedPlaybackClock = Pick<PlaybackClock, 'getPhase' | 'subscribe'>;

export type CadencedPlaybackSamplerOptions<Frame> = {
  clock: CadencedPlaybackClock;
  sample: (phase: number) => Frame | undefined;
  minFrameIntervalMs: number;
  earlyToleranceMs?: number;
  apply: (frame: Frame, time: number, forced: boolean) => void;
  sampleInitial?: boolean;
};

// Chrome's rAF timestamps can arrive fractionally before an accumulated
// cadence boundary. High-resolution probation uses this small margin so a
// nominal 25ms sample is not delayed by a full display refresh. Callers must
// opt in; Balanced and Fast retain their exact cadence.
export const HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS = 1;

export const subscribeCadencedPlaybackSampler = <Frame>({
  clock,
  sample,
  minFrameIntervalMs,
  earlyToleranceMs = 0,
  apply,
  sampleInitial = true,
}: CadencedPlaybackSamplerOptions<Frame>) => {
  let lastSampleTime = Number.NEGATIVE_INFINITY;
  const cadenceThresholdMs = Math.max(
    0,
    minFrameIntervalMs - Math.max(0, earlyToleranceMs),
  );
  const sampleAt = (phase: number, time: number, forced: boolean) => {
    if (
      !forced &&
      time !== 0 &&
      time - lastSampleTime < cadenceThresholdMs
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

  if (sampleInitial) sampleAt(clock.getPhase(), 0, true);
  return clock.subscribe((clockFrame: PlaybackClockFrame) => {
    if (!clockFrame.phaseChanged && clockFrame.elapsedMs !== 0) return;
    sampleAt(
      clockFrame.phase,
      clockFrame.time,
      clockFrame.elapsedMs === 0,
    );
  });
};

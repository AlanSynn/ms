import type { ProjectState } from "../../types";

export type PlaybackClockFrame = {
  elapsedMs: number;
  phase: number;
  time: number;
  phaseChanged: boolean;
  timelineMs?: number;
};

export type PlaybackPhaseAdvance = (
  elapsedMs: number,
  previousPhase: number,
) => number | undefined;

export type PlaybackClock = {
  readonly phaseRef: { current: number };
  readonly timelineMsRef: { current: number };
  getPhase: () => number;
  getTimelineMs: () => number;
  setPhase: (phase: number) => void;
  setTimelineDuration: (durationMs: number) => void;
  subscribe: (listener: (frame: PlaybackClockFrame) => void) => () => void;
  start: (options: {
    initialPhase?: number;
    advancePhase: PlaybackPhaseAdvance;
    onFrame?: (frame: PlaybackClockFrame) => void;
  }) => void;
  stop: () => void;
  isRunning: () => boolean;
};

const TWO_PI = Math.PI * 2;

const normalizePhase = (phase: number) => {
  if (!Number.isFinite(phase)) return 0;
  const wrapped = phase % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
};

const normalizeDuration = (durationMs: number) =>
  Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;

const signedPhaseDelta = (previousPhase: number, nextPhase: number) => {
  let delta = nextPhase - previousPhase;
  if (delta < -Math.PI) delta += TWO_PI;
  else if (delta > Math.PI) delta -= TWO_PI;
  return delta;
};

type ClockScheduler = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
};

const browserScheduler = (): ClockScheduler => ({
  now: () => performance.now(),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
});

export const createPlaybackClock = (
  scheduler: ClockScheduler = browserScheduler(),
): PlaybackClock => {
  const phaseRef = { current: 0 };
  const timelineMsRef = { current: 0 };
  const listeners = new Set<(frame: PlaybackClockFrame) => void>();
  let frameHandle: number | null = null;
  let running = false;
  let lastTime = 0;
  let advancePhase: PlaybackPhaseAdvance = () => phaseRef.current;
  let onFrame: ((frame: PlaybackClockFrame) => void) | undefined;
  let timelineDurationMs = 1;

  const emit = (elapsedMs: number, time: number, phaseChanged: boolean) => {
    const frame = {
      elapsedMs,
      phase: phaseRef.current,
      time,
      phaseChanged,
      timelineMs: timelineMsRef.current,
    } satisfies PlaybackClockFrame;
    onFrame?.(frame);
    listeners.forEach((listener) => listener(frame));
  };

  const tick = (time: number) => {
    frameHandle = null;
    if (!running) return;
    const elapsedMs = Math.max(0, time - lastTime);
    lastTime = time;
    const previousPhase = phaseRef.current;
    const nextPhase = advancePhase(elapsedMs, previousPhase);
    if (typeof nextPhase === "number" && Number.isFinite(nextPhase)) {
      const normalizedNextPhase = normalizePhase(nextPhase);
      timelineMsRef.current +=
        (signedPhaseDelta(previousPhase, normalizedNextPhase) / TWO_PI) *
        timelineDurationMs;
      phaseRef.current = normalizedNextPhase;
    }
    emit(elapsedMs, time, phaseRef.current !== previousPhase);
    if (running) frameHandle = scheduler.requestFrame(tick);
  };

  return {
    phaseRef,
    timelineMsRef,
    getPhase: () => phaseRef.current,
    getTimelineMs: () => timelineMsRef.current,
    setPhase: (phase) => {
      const nextPhase = normalizePhase(phase);
      const phaseChanged = nextPhase !== phaseRef.current;
      phaseRef.current = nextPhase;
      timelineMsRef.current = (nextPhase / TWO_PI) * timelineDurationMs;
      emit(0, scheduler.now(), phaseChanged);
    },
    setTimelineDuration: (durationMs) => {
      const nextDurationMs = normalizeDuration(durationMs);
      if (nextDurationMs === timelineDurationMs) return;
      timelineDurationMs = nextDurationMs;
      if (!running) {
        timelineMsRef.current = (phaseRef.current / TWO_PI) * timelineDurationMs;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: ({ initialPhase, advancePhase: nextAdvancePhase, onFrame: nextOnFrame }) => {
      if (running) return;
      if (typeof initialPhase === "number") {
        const normalizedInitialPhase = normalizePhase(initialPhase);
        if (normalizedInitialPhase !== phaseRef.current) {
          phaseRef.current = normalizedInitialPhase;
          timelineMsRef.current =
            (normalizedInitialPhase / TWO_PI) * timelineDurationMs;
        }
      }
      advancePhase = nextAdvancePhase;
      onFrame = nextOnFrame;
      running = true;
      lastTime = scheduler.now();
      frameHandle = scheduler.requestFrame(tick);
    },
    stop: () => {
      running = false;
      if (frameHandle !== null) scheduler.cancelFrame(frameHandle);
      frameHandle = null;
      onFrame = undefined;
    },
    isRunning: () => running,
  };
};

export type WorkspacePlaybackConfig = {
  playbackDurationMs: number;
  animationSpeed: number;
  timingProfile: ProjectState["settings"]["timingProfile"];
};

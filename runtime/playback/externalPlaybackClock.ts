import type { ProjectState } from "../../types";

export type PlaybackClockFrame = {
  elapsedMs: number;
  phase: number;
  time: number;
  phaseChanged: boolean;
};

export type PlaybackPhaseAdvance = (
  elapsedMs: number,
  previousPhase: number,
) => number | undefined;

export type PlaybackClock = {
  readonly phaseRef: { current: number };
  getPhase: () => number;
  setPhase: (phase: number) => void;
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
  const listeners = new Set<(frame: PlaybackClockFrame) => void>();
  let frameHandle: number | null = null;
  let running = false;
  let lastTime = 0;
  let advancePhase: PlaybackPhaseAdvance = () => phaseRef.current;
  let onFrame: ((frame: PlaybackClockFrame) => void) | undefined;

  const emit = (elapsedMs: number, time: number, phaseChanged: boolean) => {
    const frame = {
      elapsedMs,
      phase: phaseRef.current,
      time,
      phaseChanged,
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
      phaseRef.current = normalizePhase(nextPhase);
    }
    emit(elapsedMs, time, phaseRef.current !== previousPhase);
    if (running) frameHandle = scheduler.requestFrame(tick);
  };

  return {
    phaseRef,
    getPhase: () => phaseRef.current,
    setPhase: (phase) => {
      const nextPhase = normalizePhase(phase);
      const phaseChanged = nextPhase !== phaseRef.current;
      phaseRef.current = nextPhase;
      emit(0, scheduler.now(), phaseChanged);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: ({ initialPhase, advancePhase: nextAdvancePhase, onFrame: nextOnFrame }) => {
      if (running) return;
      if (typeof initialPhase === "number") phaseRef.current = normalizePhase(initialPhase);
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

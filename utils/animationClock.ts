/**
 * The clean production-preview baseline measured a 100 ms maximum RAF
 * interval. Foreground playback therefore follows every real RAF; the 150 ms
 * watchdog is that observed maximum plus a 50 ms margin, so it cannot fire at
 * the ordinary baseline maximum.
 */
export const ANIMATION_CLOCK_BASELINE_MAX_STALL_MS = 100;
export const ANIMATION_CLOCK_FALLBACK_MARGIN_MS = 50;
export const ANIMATION_CLOCK_FALLBACK_STALL_MS =
  ANIMATION_CLOCK_BASELINE_MAX_STALL_MS + ANIMATION_CLOCK_FALLBACK_MARGIN_MS;
export type AnimationScheduler = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
};

export type AnimationDriver = {
  start: () => void;
  stop: () => void;
};

export const nextAnimationFramePace = (
  last: number,
  time: number,
) => {
  const elapsed = Math.max(0, time - last);
  return {
    elapsed,
    last: time,
  };
};

export const nextAnimationFrameFallbackPace = (
  last: number,
  time: number,
  stallMs = ANIMATION_CLOCK_FALLBACK_STALL_MS,
) => {
  const elapsed = Math.max(0, time - last);
  const delayMs = Math.max(0, stallMs - elapsed);
  if (elapsed < stallMs) return { elapsed: 0, last, delayMs };
  return { elapsed, last: time, delayMs: stallMs };
};

const browserAnimationScheduler = (): AnimationScheduler => ({
  now: () => performance.now(),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
});

export const createAnimationDriver = ({
  onAdvance,
  scheduler = browserAnimationScheduler(),
  stallMs = ANIMATION_CLOCK_FALLBACK_STALL_MS,
}: {
  onAdvance: (elapsedMs: number, frameTime: number) => void;
  scheduler?: AnimationScheduler;
  stallMs?: number;
}): AnimationDriver => {
  let active = false;
  let frameHandle: number | null = null;
  let timerHandle: number | null = null;
  let lastActivityAt = 0;
  let lastAdvancedAt = 0;

  const advance = (time: number) => {
    const next = nextAnimationFramePace(lastAdvancedAt, time);
    if (!next.elapsed) return;
    lastAdvancedAt = next.last;
    lastActivityAt = Math.max(lastActivityAt, time);
    onAdvance(next.elapsed, next.last);
  };

  const scheduleFallback = () => {
    if (!active) return;
    const pace = nextAnimationFrameFallbackPace(
      lastActivityAt,
      scheduler.now(),
      stallMs,
    );
    timerHandle = scheduler.setTimeout(fallbackTick, Math.max(1, pace.delayMs));
  };

  const fallbackTick = () => {
    timerHandle = null;
    if (!active) return;
    const time = scheduler.now();
    const pace = nextAnimationFrameFallbackPace(lastActivityAt, time, stallMs);
    if (pace.elapsed) {
      lastActivityAt = time;
      advance(time);
    }
    scheduleFallback();
  };

  const tick = (time: number) => {
    frameHandle = null;
    if (!active) return;
    lastActivityAt = Math.max(lastActivityAt, time);
    advance(time);
    if (active) frameHandle = scheduler.requestFrame(tick);
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      const now = scheduler.now();
      lastActivityAt = now;
      lastAdvancedAt = now;
      frameHandle = scheduler.requestFrame(tick);
      scheduleFallback();
    },
    stop: () => {
      active = false;
      if (frameHandle !== null) scheduler.cancelFrame(frameHandle);
      if (timerHandle !== null) scheduler.clearTimeout(timerHandle);
      frameHandle = null;
      timerHandle = null;
    },
  };
};

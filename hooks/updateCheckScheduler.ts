export const FIRST_PROBE_DELAY_MS = 45_000;
export const MIN_PROBE_SPACING_MS = 300_000;
export const VISIBLE_TIMER_INTERVAL_MS = 1_800_000;
export const PROBE_TIMEOUT_MS = 5_000;

const BACKOFF_BASE_MS = 300_000;
const BACKOFF_CAP_MS = 3_600_000;

export type UpdateProbeTrigger = 'first' | 'retry' | 'visibility' | 'interval' | 'preload';

// The browser host uses numeric ids. Keeping this boundary numeric also makes
// deterministic test clocks independent of Node's Timeout object type.
export type UpdateCheckTimerHandle = number;

export type UpdateCheckSchedulerHost = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => UpdateCheckTimerHandle;
  clearTimeout: (handle: UpdateCheckTimerHandle) => void;
  setInterval: (callback: () => void, delayMs: number) => UpdateCheckTimerHandle;
  clearInterval: (handle: UpdateCheckTimerHandle) => void;
  isVisible?: () => boolean;
  onVisibilityChange?: (callback: () => void) => () => void;
  onPreloadError?: (callback: () => void) => () => void;
};

export type MayStartUpdateProbeInput = {
  enabled: boolean;
  active: boolean;
  inFlight: boolean;
  now: number;
  lastAttemptAt: number | null;
  backoffDeadlineAt: number;
  minimumSpacingMs?: number;
  bypassOrdinaryDeadlines?: boolean;
};

/**
 * The single ordinary-start gate. Event handlers and timers must all go
 * through this policy; preload escalation is the only explicit bypass.
 */
export const mayStart = ({
  enabled,
  active,
  inFlight,
  now,
  lastAttemptAt,
  backoffDeadlineAt,
  minimumSpacingMs = MIN_PROBE_SPACING_MS,
  bypassOrdinaryDeadlines = false,
}: MayStartUpdateProbeInput): boolean => {
  if (!enabled || !active || inFlight) return false;
  if (bypassOrdinaryDeadlines) return true;

  const spacingDeadlineAt = lastAttemptAt === null
    ? 0
    : lastAttemptAt + minimumSpacingMs;
  return now >= Math.max(spacingDeadlineAt, backoffDeadlineAt);
};

export const updateCheckBackoffDelayMs = (failures: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures), BACKOFF_CAP_MS);

export type UpdateCheckSchedulerOptions<T> = {
  enabled: boolean;
  host: UpdateCheckSchedulerHost;
  fetchProbe: (signal: AbortSignal) => Promise<T>;
  onSuccess: (value: T) => void;
  onFailure?: (error: unknown) => void;
  firstProbeDelayMs?: number;
  minimumSpacingMs?: number;
  visibleIntervalMs?: number;
  probeTimeoutMs?: number;
};

export type UpdateCheckSchedulerSnapshot = {
  active: boolean;
  inFlight: boolean;
  lastAttemptAt: number | null;
  failureCount: number;
  backoffDeadlineAt: number;
  preloadPending: boolean;
};

export type UpdateCheckScheduler = {
  start: () => void;
  request: (trigger: UpdateProbeTrigger) => boolean;
  dispose: () => void;
  snapshot: () => UpdateCheckSchedulerSnapshot;
};

/**
 * Owns one effect session's timers, listeners, request generation, and
 * backoff. A new React effect gets a new scheduler, while dispose makes all
 * completions from the old session inert even if abort is not honoured by a
 * fetch implementation.
 */
export const createUpdateCheckScheduler = <T>({
  enabled,
  host,
  fetchProbe,
  onSuccess,
  onFailure,
  firstProbeDelayMs = FIRST_PROBE_DELAY_MS,
  minimumSpacingMs = MIN_PROBE_SPACING_MS,
  visibleIntervalMs = VISIBLE_TIMER_INTERVAL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
}: UpdateCheckSchedulerOptions<T>): UpdateCheckScheduler => {
  let active = false;
  let sessionGeneration = 0;
  let requestGeneration = 0;
  let inFlight: { generation: number; controller: AbortController } | null = null;
  let firstProbeTimer: UpdateCheckTimerHandle | null = null;
  let retryTimer: UpdateCheckTimerHandle | null = null;
  let visibleTimer: UpdateCheckTimerHandle | null = null;
  let timeoutTimer: UpdateCheckTimerHandle | null = null;
  let removeVisibilityListener: (() => void) | null = null;
  let removePreloadListener: (() => void) | null = null;
  let lastAttemptAt: number | null = null;
  let failureCount = 0;
  let backoffDeadlineAt = 0;
  let preloadPending = false;

  const clearRetryTimer = () => {
    if (retryTimer === null) return;
    host.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const clearFirstProbeTimer = () => {
    if (firstProbeTimer === null) return;
    host.clearTimeout(firstProbeTimer);
    firstProbeTimer = null;
  };

  const clearTimeoutTimer = () => {
    if (timeoutTimer === null) return;
    host.clearTimeout(timeoutTimer);
    timeoutTimer = null;
  };

  const scheduleRetry = (deadlineAt: number) => {
    clearRetryTimer();
    if (!active) return;
    const delayMs = Math.max(0, deadlineAt - host.now());
    retryTimer = host.setTimeout(() => {
      retryTimer = null;
      if (request('retry')) return;
      // A clock can move backwards between scheduling and delivery. Keep the
      // retry alive until the same authoritative gate becomes satisfiable.
      if (active && failureCount > 0) scheduleRetry(backoffDeadlineAt);
    }, delayMs);
  };

  const settlePendingPreload = () => {
    if (!preloadPending || !active) return;
    preloadPending = false;
    request('preload');
  };

  const finish = (
    generation: number,
    outcome: 'success' | 'failure',
    value: T | unknown,
  ) => {
    if (!active || inFlight?.generation !== generation) return;

    inFlight = null;
    clearTimeoutTimer();
    if (outcome === 'success') {
      failureCount = 0;
      backoffDeadlineAt = 0;
      clearRetryTimer();
      onSuccess(value as T);
    } else {
      failureCount += 1;
      backoffDeadlineAt = host.now() + updateCheckBackoffDelayMs(failureCount - 1);
      onFailure?.(value);
      scheduleRetry(backoffDeadlineAt);
    }
    settlePendingPreload();
  };

  function request(trigger: UpdateProbeTrigger): boolean {
    if (trigger === 'preload' && inFlight !== null) {
      if (active) preloadPending = true;
      return false;
    }

    const now = host.now();
    if (!mayStart({
      enabled,
      active,
      inFlight: inFlight !== null,
      now,
      lastAttemptAt,
      backoffDeadlineAt,
      minimumSpacingMs,
      bypassOrdinaryDeadlines: trigger === 'preload',
    })) return false;

    clearFirstProbeTimer();
    clearRetryTimer();
    lastAttemptAt = now;
    const generation = ++requestGeneration;
    const controller = new AbortController();
    inFlight = { generation, controller };
    if (Number.isFinite(probeTimeoutMs) && probeTimeoutMs > 0) {
      timeoutTimer = host.setTimeout(() => controller.abort(), probeTimeoutMs);
    }

    let promise: Promise<T>;
    try {
      promise = fetchProbe(controller.signal);
    } catch (error) {
      finish(generation, 'failure', error);
      return true;
    }
    void promise.then(
      value => finish(generation, 'success', value),
      error => finish(generation, 'failure', error),
    );
    return true;
  }

  const dispose = () => {
    if (!active) return;
    active = false;
    sessionGeneration += 1;
    preloadPending = false;
    clearFirstProbeTimer();
    clearRetryTimer();
    if (visibleTimer !== null) {
      host.clearInterval(visibleTimer);
      visibleTimer = null;
    }
    clearTimeoutTimer();
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    removePreloadListener?.();
    removePreloadListener = null;
    inFlight?.controller.abort();
    inFlight = null;
  };

  const start = () => {
    if (!enabled || active) return;
    active = true;
    const generation = ++sessionGeneration;
    firstProbeTimer = host.setTimeout(() => {
      firstProbeTimer = null;
      if (active && sessionGeneration === generation) request('first');
    }, firstProbeDelayMs);
    visibleTimer = host.setInterval(() => {
      if (active && host.isVisible?.() !== false) request('interval');
    }, visibleIntervalMs);
    removeVisibilityListener = host.onVisibilityChange?.(() => {
      if (active && host.isVisible?.() !== false) request('visibility');
    }) ?? null;
    removePreloadListener = host.onPreloadError?.(() => {
      if (active) request('preload');
    }) ?? null;
  };

  const snapshot = (): UpdateCheckSchedulerSnapshot => ({
    active,
    inFlight: inFlight !== null,
    lastAttemptAt,
    failureCount,
    backoffDeadlineAt,
    preloadPending,
  });

  return { start, request, dispose, snapshot };
};

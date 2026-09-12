import { strict as assert } from 'node:assert';
import {
  FIRST_PROBE_DELAY_MS,
  MIN_PROBE_SPACING_MS,
  shouldProbeNow,
  updateBannerState,
  updateCheckBackoffDelayMs,
  updateCheckEnabled,
  parseUpdateManifest,
} from '../hooks/useUpdateCheck';
import {
  createUpdateCheckScheduler,
  mayStart,
} from '../hooks/updateCheckScheduler';

// Backoff: a five-minute base that doubles per failure and caps at one hour.
assert.equal(updateCheckBackoffDelayMs(0), 300_000);
assert.equal(updateCheckBackoffDelayMs(1), 600_000);
assert.equal(updateCheckBackoffDelayMs(2), 1_200_000);
assert.equal(updateCheckBackoffDelayMs(4), 3_600_000);
assert.equal(updateCheckBackoffDelayMs(8), 3_600_000);
assert(updateCheckBackoffDelayMs(3) > updateCheckBackoffDelayMs(2), 'backoff keeps growing until the cap');

// Spacing gate: the first probe is always allowed, later probes only after spacing.
assert.equal(shouldProbeNow(0, 1_000_000_000_000), true);
assert.equal(shouldProbeNow(1_000, 1_000 + MIN_PROBE_SPACING_MS - 1), false);
assert.equal(shouldProbeNow(1_000, 1_000 + MIN_PROBE_SPACING_MS), true);
assert.equal(shouldProbeNow(null, 0), true);

// The ordinary gate combines the effect generation, request serialization,
// first-probe deadline, minimum spacing, and retry backoff. Preload escalation
// is an explicit exception for the two ordinary deadlines only.
const ordinaryGate = {
  enabled: true,
  active: true,
  inFlight: false,
  now: 10_000,
  lastAttemptAt: null,
  backoffDeadlineAt: 0,
};
assert.equal(mayStart(ordinaryGate), true);
assert.equal(mayStart({ ...ordinaryGate, inFlight: true }), false);
assert.equal(mayStart({ ...ordinaryGate, active: false }), false);
assert.equal(mayStart({ ...ordinaryGate, lastAttemptAt: 10_000, now: 10_000 + MIN_PROBE_SPACING_MS - 1 }), false);
assert.equal(mayStart({ ...ordinaryGate, lastAttemptAt: 10_000, now: 10_000 + MIN_PROBE_SPACING_MS }), true);
assert.equal(mayStart({ ...ordinaryGate, now: 30_000, backoffDeadlineAt: 40_000 }), false);
assert.equal(mayStart({ ...ordinaryGate, now: 40_000, backoffDeadlineAt: 40_000 }), true);
assert.equal(mayStart({ ...ordinaryGate, bypassOrdinaryDeadlines: true }), true);

// Banner visibility: only a differing, non-dismissed remote build shows.
assert.equal(updateBannerState('local-1', 'local-1', null), 'hidden');
assert.equal(updateBannerState('local-1', null, null), 'hidden');
assert.equal(updateBannerState('local-1', 'remote-2', 'remote-2'), 'hidden');
assert.equal(updateBannerState('local-1', 'remote-2', 'other-3'), 'visible');
assert.equal(updateBannerState('local-1', 'remote-2', null), 'visible');

// Update checks run only in the browser build, never inside Tauri.
assert.equal(updateCheckEnabled(false, false), true);
assert.equal(updateCheckEnabled(true, false), false);
assert.equal(updateCheckEnabled(false, true), false);
assert.equal(updateCheckEnabled(true, true), false);

type FakeTask = {
  id: number;
  dueAt: number;
  intervalMs: number | null;
  callback: () => void;
  active: boolean;
  order: number;
};

class FakeUpdateCheckClock {
  nowMs = 0;
  visible = true;
  private nextId = 1;
  private nextOrder = 1;
  private tasks = new Map<number, FakeTask>();
  private visibilityListeners = new Set<() => void>();
  private preloadListeners = new Set<() => void>();

  readonly host = {
    now: () => this.nowMs,
    setTimeout: (callback: () => void, delayMs: number) => this.addTask(callback, delayMs, null),
    clearTimeout: (id: number) => this.clearTask(id),
    setInterval: (callback: () => void, delayMs: number) => this.addTask(callback, delayMs, delayMs),
    clearInterval: (id: number) => this.clearTask(id),
    isVisible: () => this.visible,
    onVisibilityChange: (callback: () => void) => {
      this.visibilityListeners.add(callback);
      return () => this.visibilityListeners.delete(callback);
    },
    onPreloadError: (callback: () => void) => {
      this.preloadListeners.add(callback);
      return () => this.preloadListeners.delete(callback);
    },
  };

  private addTask(callback: () => void, delayMs: number, intervalMs: number | null): number {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      dueAt: this.nowMs + Math.max(0, delayMs),
      intervalMs,
      callback,
      active: true,
      order: this.nextOrder++,
    });
    return id;
  }

  private clearTask(id: number): void {
    const task = this.tasks.get(id);
    if (task) task.active = false;
  }

  advanceBy(deltaMs: number): void {
    const target = this.nowMs + deltaMs;
    while (true) {
      const next = [...this.tasks.values()]
        .filter(task => task.active && task.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.order - b.order)[0];
      if (!next) break;
      this.nowMs = next.dueAt;
      if (next.intervalMs === null) next.active = false;
      else next.dueAt += next.intervalMs;
      next.callback();
    }
    this.nowMs = target;
  }

  fireVisibility(): void {
    for (const listener of [...this.visibilityListeners]) listener();
  }

  firePreloadError(): void {
    for (const listener of [...this.preloadListeners]) listener();
  }

  activeTimerCount(): number {
    return [...this.tasks.values()].filter(task => task.active).length;
  }

  listenerCount(): number {
    return this.visibilityListeners.size + this.preloadListeners.size;
  }
}

type PendingProbe<T> = {
  signal: AbortSignal;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferredProbeQueue = <T>() => {
  const pending: PendingProbe<T>[] = [];
  const fetchProbe = (signal: AbortSignal): Promise<T> => new Promise<T>((resolve, reject) => {
    pending.push({ signal, resolve, reject });
  });
  return { pending, fetchProbe };
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

// Without a visibility regain, the production scheduler waits its concrete
// 45-second first-probe delay. The test keeps that user-visible value explicit
// instead of deriving it from the implementation constant alone.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  const started: number[] = [];
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    fetchProbe: signal => {
      started.push(clock.nowMs);
      return probes.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  assert.equal(FIRST_PROBE_DELAY_MS, 45_000);
  clock.advanceBy(45_000 - 1);
  assert.deepEqual(started, [], 'the first timer has not fired before 45 seconds');
  clock.advanceBy(1);
  assert.deepEqual(started, [45_000], 'the first timer probes at 45 seconds');
  probes.pending[0].resolve({ buildId: 'remote-1' });
  await flushMicrotasks();
  scheduler.dispose();
}

// The first visibility regain may start the initial probe immediately, but a
// later regain still waits five minutes after that attempt.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    fetchProbe: signal => {
      starts += 1;
      return probes.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.fireVisibility();
  assert.equal(starts, 1, 'the first visible regain probes before the fallback timer');
  probes.pending.shift()!.reject(new Error('offline'));
  await flushMicrotasks();
  clock.advanceBy(MIN_PROBE_SPACING_MS - 1);
  clock.fireVisibility();
  assert.equal(starts, 1, 'visibility respects the failed attempt backoff');
  clock.advanceBy(1);
  clock.fireVisibility();
  assert.equal(starts, 2, 'visibility retries at the five-minute deadline');
  probes.pending.shift()!.resolve({ buildId: 'remote-visible' });
  await flushMicrotasks();
  scheduler.dispose();
}

// A retry and a visible interval can mature at exactly the same timestamp;
// whichever callback runs first owns the one serialized request.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    visibleIntervalMs: MIN_PROBE_SPACING_MS,
    fetchProbe: signal => {
      starts += 1;
      return probes.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.advanceBy(0);
  assert.equal(starts, 1);
  probes.pending.shift()!.reject(new Error('offline'));
  await flushMicrotasks();
  clock.advanceBy(MIN_PROBE_SPACING_MS);
  assert.equal(starts, 2, 'equal-time retry and interval triggers start only one request');
  assert.equal(scheduler.snapshot().inFlight, true);
  probes.pending.shift()!.resolve({ buildId: 'remote-2' });
  await flushMicrotasks();
  scheduler.dispose();
}

// The first failed request schedules its retry five minutes later. A retry at
// the exact deadline is allowed, while earlier visibility requests remain
// blocked by the same backoff deadline.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: signal => {
      starts += 1;
      return probes.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.advanceBy(0);
  probes.pending.shift()!.reject(new Error('offline'));
  await flushMicrotasks();
  assert.equal(scheduler.snapshot().backoffDeadlineAt, MIN_PROBE_SPACING_MS);
  clock.advanceBy(MIN_PROBE_SPACING_MS - 1);
  assert.equal(scheduler.request('visibility'), false);
  clock.advanceBy(1);
  assert.equal(starts, 2, 'the first retry starts at five minutes');
  probes.pending.shift()!.resolve({ buildId: 'retry-success' });
  await flushMicrotasks();
  scheduler.dispose();
}

// The fetch path validates JSON before the success callback. Null and
// non-string build ids therefore stay silent and enter the ordinary backoff
// path instead of throwing from a promise fulfillment handler.
for (const malformed of [null, { buildId: 42 }]) {
  const clock = new FakeUpdateCheckClock();
  let published = 0;
  let failures = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: async () => parseUpdateManifest(malformed),
    onSuccess: () => { published += 1; },
    onFailure: () => { failures += 1; },
  });
  scheduler.start();
  clock.advanceBy(0);
  await flushMicrotasks();
  assert.equal(published, 0, 'malformed manifests never publish an update');
  assert.equal(failures, 1, 'malformed manifests use the silent failure path');
  assert.equal(scheduler.snapshot().failureCount, 1);
  assert.equal(scheduler.snapshot().backoffDeadlineAt, MIN_PROBE_SPACING_MS);
  scheduler.dispose();
}

// A successful probe still observes the minimum spacing gate. The exact
// boundary is inclusive so a focus request at the deadline is allowed.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: signal => {
      starts += 1;
      return probes.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.advanceBy(0);
  probes.pending.shift()!.resolve({ buildId: 'remote-3' });
  await flushMicrotasks();
  assert.equal(scheduler.request('visibility'), false, 'focus inside the spacing window is ignored');
  clock.advanceBy(MIN_PROBE_SPACING_MS - 1);
  assert.equal(scheduler.request('visibility'), false);
  clock.advanceBy(1);
  assert.equal(scheduler.request('visibility'), true, 'focus at the spacing boundary probes');
  assert.equal(starts, 2);
  probes.pending.shift()!.resolve({ buildId: 'remote-4' });
  await flushMicrotasks();
  scheduler.dispose();
}

// Disabled sessions install no timers or listeners and cannot be started by
// any trigger.
{
  const clock = new FakeUpdateCheckClock();
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: false,
    host: clock.host,
    fetchProbe: async () => {
      starts += 1;
      return { buildId: 'never' };
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.advanceBy(FIRST_PROBE_DELAY_MS * 2);
  clock.fireVisibility();
  clock.firePreloadError();
  assert.equal(starts, 0);
  assert.equal(clock.activeTimerCount(), 0);
  assert.equal(clock.listenerCount(), 0);
}

// A stale async completion from a disposed session is aborted and discarded;
// the replacement session remains able to publish its own success.
{
  const clock = new FakeUpdateCheckClock();
  const stale = deferredProbeQueue<{ buildId: string }>();
  const fresh = deferredProbeQueue<{ buildId: string }>();
  const published: string[] = [];
  const oldScheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: stale.fetchProbe,
    onSuccess: result => published.push(`old:${result.buildId}`),
    onFailure: error => published.push(`old-error:${String(error)}`),
  });
  oldScheduler.start();
  clock.advanceBy(0);
  assert.equal(stale.pending.length, 1);
  const staleSignal = stale.pending[0].signal;
  oldScheduler.dispose();
  assert.equal(staleSignal.aborted, true, 'dispose aborts the old request');

  const newScheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: fresh.fetchProbe,
    onSuccess: result => published.push(`new:${result.buildId}`),
    onFailure: error => published.push(`new-error:${String(error)}`),
  });
  newScheduler.start();
  clock.advanceBy(0);
  stale.pending[0].resolve({ buildId: 'stale' });
  await flushMicrotasks();
  assert.deepEqual(published, [], 'stale success cannot publish after cleanup');
  fresh.pending[0].resolve({ buildId: 'fresh' });
  await flushMicrotasks();
  assert.deepEqual(published, ['new:fresh']);
  newScheduler.dispose();
}

// React StrictMode's setup-cleanup-setup sequence gets two operational
// sessions: the old timers/listeners are gone, and the replayed session keeps
// its five-minute retry state after its first probe fails.
{
  const clock = new FakeUpdateCheckClock();
  const first = deferredProbeQueue<{ buildId: string }>();
  const second = deferredProbeQueue<{ buildId: string }>();
  let starts = 0;
  const oldScheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: FIRST_PROBE_DELAY_MS,
    fetchProbe: signal => {
      starts += 1;
      return first.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  oldScheduler.start();
  oldScheduler.dispose();
  const replayedScheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: FIRST_PROBE_DELAY_MS,
    fetchProbe: signal => {
      starts += 1;
      return second.fetchProbe(signal);
    },
    onSuccess: () => undefined,
  });
  replayedScheduler.start();
  clock.advanceBy(FIRST_PROBE_DELAY_MS - 1);
  assert.equal(starts, 0);
  clock.advanceBy(1);
  assert.equal(starts, 1, 'StrictMode replay does not permanently disable the scheduler');
  second.pending[0].reject(new Error('replayed session offline'));
  await flushMicrotasks();
  assert.equal(
    replayedScheduler.snapshot().backoffDeadlineAt,
    FIRST_PROBE_DELAY_MS + MIN_PROBE_SPACING_MS,
    'the replayed session schedules its first retry five minutes after failure',
  );
  clock.advanceBy(MIN_PROBE_SPACING_MS - 1);
  assert.equal(starts, 1);
  clock.advanceBy(1);
  assert.equal(starts, 2, 'the replayed session remains active through its retry');
  second.pending[1].resolve({ buildId: 'replayed' });
  await flushMicrotasks();
  replayedScheduler.dispose();
}

// Preload errors intentionally bypass the ordinary first/backoff/spacing
// deadlines, but a second preload while a request is active is queued and
// serialized after it settles.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let concurrent = 0;
  let maxConcurrent = 0;
  let starts = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: FIRST_PROBE_DELAY_MS,
    fetchProbe: signal => {
      starts += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return probes.fetchProbe(signal).finally(() => {
        concurrent -= 1;
      });
    },
    onSuccess: () => undefined,
  });
  scheduler.start();
  clock.firePreloadError();
  assert.equal(starts, 1, 'preload escalation bypasses the first ordinary deadline');
  clock.firePreloadError();
  assert.equal(starts, 1, 'preload escalation does not overlap the active request');
  assert.equal(scheduler.snapshot().preloadPending, true);
  probes.pending.shift()!.resolve({ buildId: 'preload-1' });
  await flushMicrotasks();
  assert.equal(starts, 2, 'queued preload runs after the first request settles');
  assert.equal(maxConcurrent, 1, 'preload requests remain serialized');
  probes.pending.shift()!.resolve({ buildId: 'preload-2' });
  await flushMicrotasks();
  scheduler.dispose();
}

// Cleanup clears every timer and listener, including the request timeout, and
// later browser events cannot revive the disposed scheduler.
{
  const clock = new FakeUpdateCheckClock();
  const probes = deferredProbeQueue<{ buildId: string }>();
  let published = 0;
  const scheduler = createUpdateCheckScheduler({
    enabled: true,
    host: clock.host,
    firstProbeDelayMs: 0,
    fetchProbe: probes.fetchProbe,
    onSuccess: () => { published += 1; },
  });
  scheduler.start();
  clock.advanceBy(0);
  assert.equal(clock.activeTimerCount(), 2, 'first request owns the interval and timeout timers');
  scheduler.dispose();
  assert.equal(clock.activeTimerCount(), 0);
  assert.equal(clock.listenerCount(), 0);
  probes.pending[0].resolve({ buildId: 'late' });
  await flushMicrotasks();
  clock.advanceBy(FIRST_PROBE_DELAY_MS * 2);
  clock.fireVisibility();
  clock.firePreloadError();
  assert.equal(published, 0, 'disposed async work and events stay inert');
}

console.log('Update check scheduler, backoff, spacing, banner, and enablement contracts passed.');

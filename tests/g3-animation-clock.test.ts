import { strict as assert } from "node:assert";
import {
  ANIMATION_CLOCK_FALLBACK_STALL_MS,
  createAnimationDriver,
  type AnimationScheduler,
} from "../utils/animationClock";

type FakeScheduler = AnimationScheduler & {
  advance: (ms: number) => void;
  fireFrame: (time?: number) => void;
  pendingFrames: () => number;
  pendingTimers: () => number;
};

const fakeScheduler = (): FakeScheduler => {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map<number, (time: number) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const runTimers = () => {
    let next = [...timers.entries()]
      .filter(([, timer]) => timer.at <= time)
      .sort(([, left], [, right]) => left.at - right.at)[0];
    while (next) {
      timers.delete(next[0]);
      next[1].callback();
      next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort(([, left], [, right]) => left.at - right.at)[0];
    }
  };
  return {
    now: () => time,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { at: time + delayMs, callback });
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle),
    advance: (ms) => {
      time += ms;
      runTimers();
    },
    fireFrame: (frameTime = time) => {
      const callback = frames.values().next().value as ((time: number) => void) | undefined;
      if (!callback) return;
      frames.delete(frames.keys().next().value as number);
      callback(frameTime);
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
};

const test = (name: string, fn: () => void) => {
  fn();
  console.log(`ok - ${name}`);
};

test("advances at actual RAF cadence without a policy frame budget", () => {
  const scheduler = fakeScheduler();
  const advances: number[] = [];
  const driver = createAnimationDriver({
    scheduler,
    onAdvance: (elapsed) => advances.push(elapsed),
  });
  driver.start();
  scheduler.advance(16);
  scheduler.fireFrame(16);
  scheduler.advance(17);
  scheduler.fireFrame(33);
  assert.deepEqual(advances, [16, 17]);
});

test("fallback waits for the measured genuine-stall threshold", () => {
  const scheduler = fakeScheduler();
  const advances: number[] = [];
  const driver = createAnimationDriver({
    scheduler,
    onAdvance: (elapsed) => advances.push(elapsed),
  });
  driver.start();
  scheduler.advance(149);
  assert.deepEqual(advances, []);
  scheduler.advance(ANIMATION_CLOCK_FALLBACK_STALL_MS - 149);
  assert.deepEqual(advances, [ANIMATION_CLOCK_FALLBACK_STALL_MS]);
});

test("a fallback and RAF at the same timestamp advance once", () => {
  const scheduler = fakeScheduler();
  let count = 0;
  const driver = createAnimationDriver({
    scheduler,
    onAdvance: () => {
      count += 1;
    },
  });
  driver.start();
  scheduler.advance(ANIMATION_CLOCK_FALLBACK_STALL_MS);
  scheduler.fireFrame(ANIMATION_CLOCK_FALLBACK_STALL_MS);
  assert.equal(count, 1);
});

test("the active driver reads the latest callback without restarting", () => {
  const scheduler = fakeScheduler();
  const values: string[] = [];
  let callback = (value: string) => values.push(`old:${value}`);
  const driver = createAnimationDriver({
    scheduler,
    onAdvance: () => callback("frame"),
  });
  driver.start();
  const framesBefore = scheduler.pendingFrames();
  callback = (value) => values.push(`new:${value}`);
  scheduler.advance(16);
  scheduler.fireFrame(16);
  assert.equal(framesBefore, 1);
  assert.deepEqual(values, ["new:frame"]);
  driver.stop();
});

test("repeated RAFs keep one RAF and one watchdog pending", () => {
  const scheduler = fakeScheduler();
  const driver = createAnimationDriver({ scheduler, onAdvance: () => {} });
  driver.start();
  for (const time of [16, 32, 48, 64]) {
    assert.equal(scheduler.pendingFrames(), 1);
    assert.equal(scheduler.pendingTimers(), 1);
    scheduler.advance(16);
    scheduler.fireFrame(time);
  }
  assert.equal(scheduler.pendingFrames(), 1);
  assert.equal(scheduler.pendingTimers(), 1);
  driver.stop();
});

test("stop during an advance callback does not schedule another RAF", () => {
  const scheduler = fakeScheduler();
  let driver: ReturnType<typeof createAnimationDriver>;
  driver = createAnimationDriver({
    scheduler,
    onAdvance: () => driver.stop(),
  });
  driver.start();
  scheduler.advance(16);
  scheduler.fireFrame(16);
  assert.equal(scheduler.pendingFrames(), 0);
  assert.equal(scheduler.pendingTimers(), 0);
});

test("stop cancels both RAF and fallback timer", () => {
  const scheduler = fakeScheduler();
  let count = 0;
  const driver = createAnimationDriver({
    scheduler,
    onAdvance: () => {
      count += 1;
    },
  });
  driver.start();
  driver.stop();
  assert.equal(scheduler.pendingFrames(), 0);
  assert.equal(scheduler.pendingTimers(), 0);
  scheduler.advance(ANIMATION_CLOCK_FALLBACK_STALL_MS * 2);
  scheduler.fireFrame();
  assert.equal(count, 0);
});

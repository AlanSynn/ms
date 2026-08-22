export const HIGH_RESOLUTION_SCALE_LADDER = Object.freeze([
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
] as const);

export const HIGH_RESOLUTION_ADAPTATION_RULES = Object.freeze({
  badWindowSize: 60,
  goodWindowSize: 120,
  goodWindowsPerUpshift: 2,
  upshiftCooldownMs: 5_000,
  goodP95MaxMs: 33.3,
  goodIntervalMaxMs: 50,
} as const);

export const shouldRecordAdaptiveSubmission = (continuous?: boolean) =>
  continuous === true;

const BAD_WINDOW_SIZE = HIGH_RESOLUTION_ADAPTATION_RULES.badWindowSize;
const GOOD_WINDOW_SIZE = HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowSize;
const UPSHIFT_COOLDOWN_MS =
  HIGH_RESOLUTION_ADAPTATION_RULES.upshiftCooldownMs;

type PendingScaleChange =
  | { direction: "down"; targetIndex: number }
  | { direction: "up"; targetIndex: number; eligibleAt: number };

export type AdaptiveHighResolutionSnapshot = {
  requestedCap: number;
  ladderCap: number;
  availableCap: number;
  pendingDirection: "up" | "down" | "none";
  consecutiveGoodWindows: number;
};

export type AdaptiveHighResolutionController = {
  snapshot: () => AdaptiveHighResolutionSnapshot;
  setAvailableCap: (cap: number) => void;
  recordSubmission: (submittedAtMs: number) => void;
  resetSubmissionWindow: () => void;
  recordContextLoss: () => void;
  setGestureActive: (owner: object, active: boolean) => void;
  setTopologyBuildActive: (owner: object, active: boolean) => void;
  subscribe: (listener: (snapshot: AdaptiveHighResolutionSnapshot) => void) => () => void;
};

/**
 * Hold the shared High session at its current DPR while an initial retained
 * scene is incomplete. The returned release is idempotent so both normal
 * completion and React cleanup can own the same lease safely.
 */
export const acquireAdaptiveTopologyBuildLease = (
  controller: Pick<AdaptiveHighResolutionController, "setTopologyBuildActive">,
  owner: object,
) => {
  let active = true;
  controller.setTopologyBuildActive(owner, true);
  return () => {
    if (!active) return;
    active = false;
    controller.setTopologyBuildActive(owner, false);
  };
};

const percentile = (sorted: readonly number[], quantile: number) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
};

export const createAdaptiveHighResolutionController = (): AdaptiveHighResolutionController => {
  const listeners = new Set<(snapshot: AdaptiveHighResolutionSnapshot) => void>();
  const gestures = new Set<object>();
  const topologyBuilds = new Set<object>();
  let ladderIndex = HIGH_RESOLUTION_SCALE_LADDER.indexOf(1);
  let availableCap = Number.POSITIVE_INFINITY;
  let previousSubmissionAt: number | undefined;
  let badWindow: number[] = [];
  let goodWindow: number[] = [];
  let consecutiveGoodWindows = 0;
  let lastScaleChangeAt: number | undefined;
  let pending: PendingScaleChange | undefined;

  const isSafeBoundary = () => gestures.size === 0 && topologyBuilds.size === 0;
  const requestedCap = () => Math.min(
    HIGH_RESOLUTION_SCALE_LADDER[ladderIndex],
    availableCap,
  );
  const snapshot = (): AdaptiveHighResolutionSnapshot => ({
    requestedCap: requestedCap(),
    ladderCap: HIGH_RESOLUTION_SCALE_LADDER[ladderIndex],
    availableCap,
    pendingDirection: pending?.direction ?? "none",
    consecutiveGoodWindows,
  });
  const emit = () => {
    const next = snapshot();
    listeners.forEach((listener) => listener(next));
  };
  const clearWindows = () => {
    badWindow = [];
    goodWindow = [];
    consecutiveGoodWindows = 0;
  };
  const queueDown = (steps: number) => {
    const targetIndex = Math.max(0, ladderIndex - steps);
    if (targetIndex === ladderIndex) return;
    if (pending?.direction === "down") {
      pending = {
        direction: "down",
        targetIndex: Math.min(pending.targetIndex, targetIndex),
      };
    } else {
      pending = { direction: "down", targetIndex };
    }
    clearWindows();
  };
  const queueSevereDown = () => {
    pending = { direction: "down", targetIndex: 0 };
    clearWindows();
  };
  const applyPendingAtBoundary = (nowMs: number) => {
    if (!pending) return;
    if (
      pending.direction === "up" &&
      (!isSafeBoundary() || nowMs < pending.eligibleAt)
    ) return;
    const nextIndex = pending.targetIndex;
    pending = undefined;
    if (nextIndex === ladderIndex) return;
    ladderIndex = nextIndex;
    lastScaleChangeAt = nowMs;
    clearWindows();
    emit();
  };

  return {
    snapshot,
    setAvailableCap(cap) {
      const next = Number.isFinite(cap) && cap > 0
        ? cap
        : Number.POSITIVE_INFINITY;
      if (next === availableCap) return;
      availableCap = next;
    },
    recordSubmission(submittedAtMs) {
      if (!Number.isFinite(submittedAtMs)) return;
      applyPendingAtBoundary(submittedAtMs);
      if (previousSubmissionAt === undefined) {
        previousSubmissionAt = submittedAtMs;
        lastScaleChangeAt ??= submittedAtMs;
        return;
      }
      const interval = submittedAtMs - previousSubmissionAt;
      previousSubmissionAt = submittedAtMs;
      if (!(interval > 0)) return;
      if (interval > 200) {
        queueSevereDown();
        applyPendingAtBoundary(submittedAtMs);
        return;
      }
      badWindow.push(interval);
      goodWindow.push(interval);
      if (badWindow.length === BAD_WINDOW_SIZE) {
        const sorted = [...badWindow].sort((a, b) => a - b);
        const over50 = badWindow.filter((value) => value > 50).length;
        const isBad =
          percentile(sorted, 0.95) > 42 ||
          over50 / badWindow.length > 0.05 ||
          percentile(sorted, 0.99) > 75;
        badWindow = [];
        if (isBad) {
          queueDown(1);
          applyPendingAtBoundary(submittedAtMs);
          return;
        }
      }
      if (goodWindow.length === GOOD_WINDOW_SIZE) {
        const sorted = [...goodWindow].sort((a, b) => a - b);
        const isGood =
          percentile(sorted, 0.95) <=
            HIGH_RESOLUTION_ADAPTATION_RULES.goodP95MaxMs &&
          goodWindow.every(
            (value) =>
              value <= HIGH_RESOLUTION_ADAPTATION_RULES.goodIntervalMaxMs,
          );
        goodWindow = [];
        consecutiveGoodWindows = isGood ? consecutiveGoodWindows + 1 : 0;
        const nextLadderCap = HIGH_RESOLUTION_SCALE_LADDER[ladderIndex + 1];
        if (
          consecutiveGoodWindows >=
            HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowsPerUpshift &&
          nextLadderCap !== undefined &&
          nextLadderCap <= availableCap
        ) {
          pending = {
            direction: "up",
            targetIndex: ladderIndex + 1,
            eligibleAt: (lastScaleChangeAt ?? submittedAtMs) + UPSHIFT_COOLDOWN_MS,
          };
          applyPendingAtBoundary(submittedAtMs);
        }
      }
    },
    resetSubmissionWindow() {
      previousSubmissionAt = undefined;
      badWindow = [];
      goodWindow = [];
      consecutiveGoodWindows = 0;
    },
    recordContextLoss() {
      lastScaleChangeAt = previousSubmissionAt ?? lastScaleChangeAt;
      pending = undefined;
      const changed = ladderIndex !== 0;
      ladderIndex = 0;
      clearWindows();
      previousSubmissionAt = undefined;
      if (changed) emit();
    },
    setGestureActive(owner, active) {
      if (active) gestures.add(owner);
      else gestures.delete(owner);
    },
    setTopologyBuildActive(owner, active) {
      if (active) topologyBuilds.add(owner);
      else topologyBuilds.delete(owner);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

// One browser-session authority shared by the Puppet and Foundry engines.
export const highResolutionSessionController =
  createAdaptiveHighResolutionController();

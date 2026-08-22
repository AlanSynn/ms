import { strict as assert } from "node:assert";

import {
  HIGH_RESOLUTION_ADAPTATION_RULES,
  HIGH_RESOLUTION_SCALE_LADDER,
  acquireAdaptiveTopologyBuildLease,
  createAdaptiveHighResolutionController,
  shouldRecordAdaptiveSubmission,
} from "../runtime/render/adaptiveHighResolutionController";

const submitIntervals = (
  controller: ReturnType<typeof createAdaptiveHighResolutionController>,
  intervals: readonly number[],
  startAt = 0,
) => {
  let now = startAt;
  controller.recordSubmission(now);
  intervals.forEach((interval) => {
    now += interval;
    controller.recordSubmission(now);
  });
  return now;
};

assert.deepEqual(
  HIGH_RESOLUTION_SCALE_LADDER,
  [0.5, 0.75, 1, 1.25, 1.5, 2],
  "High uses the approved bounded resolution ladder",
);
assert.deepEqual(
  HIGH_RESOLUTION_ADAPTATION_RULES,
  {
    badWindowSize: 60,
    goodWindowSize: 120,
    goodWindowsPerUpshift: 2,
    upshiftCooldownMs: 5_000,
    goodP95MaxMs: 33.3,
    goodIntervalMaxMs: 50,
  },
  "audit timing derives from the same immutable rules as the controller",
);
assert.equal(
  shouldRecordAdaptiveSubmission(undefined),
  false,
  "an idle or canonical render cannot turn an arbitrary gap into adaptive pressure",
);
assert.equal(
  shouldRecordAdaptiveSubmission(false),
  false,
  "an explicitly transient render is excluded from the cadence window",
);
assert.equal(
  shouldRecordAdaptiveSubmission(true),
  true,
  "only a continuous playback submission contributes an interval sample",
);

const availability = createAdaptiveHighResolutionController();
assert.equal(availability.snapshot().requestedCap, 1, "High starts at DPR cap 1");
availability.setAvailableCap(0.8);
assert.equal(
  availability.snapshot().requestedCap,
  0.8,
  "the request never exceeds device, viewport, or renderbuffer availability",
);
availability.setAvailableCap(2);
assert.equal(availability.snapshot().requestedCap, 1, "raising hardware capacity does not skip the safe start");

const hardwareBound = createAdaptiveHighResolutionController();
hardwareBound.setAvailableCap(0.8);
submitIntervals(hardwareBound, Array(240).fill(25));
hardwareBound.setAvailableCap(2);
assert.equal(hardwareBound.snapshot().requestedCap, 1, "good samples cannot bank hidden upshifts above the hardware cap");

const p95Bad = createAdaptiveHighResolutionController();
submitIntervals(p95Bad, Array(60).fill(43));
assert.equal(p95Bad.snapshot().requestedCap, 0.75, "a bad 60-submit p95 steps down one level");

const over50Bad = createAdaptiveHighResolutionController();
submitIntervals(over50Bad, [...Array(56).fill(25), ...Array(4).fill(51)]);
assert.equal(over50Bad.snapshot().requestedCap, 0.75, "more than 5% over 50ms steps down");

const p99Bad = createAdaptiveHighResolutionController();
submitIntervals(p99Bad, [...Array(59).fill(25), 76]);
assert.equal(p99Bad.snapshot().requestedCap, 0.75, "the p99 limit catches a sparse slow submission");

const severe = createAdaptiveHighResolutionController();
const severeNotifications: number[] = [];
severe.subscribe((snapshot) => severeNotifications.push(snapshot.requestedCap));
submitIntervals(severe, [201]);
assert.equal(severe.snapshot().requestedCap, 0.5, "a >200ms submit interval drops directly to 0.5");
assert.deepEqual(severeNotifications, [0.5], "the severe drop notifies both renderer subscribers immediately");

const contextLoss = createAdaptiveHighResolutionController();
const contextLossNotifications: number[] = [];
contextLoss.subscribe((snapshot) => contextLossNotifications.push(snapshot.requestedCap));
contextLoss.recordContextLoss();
assert.equal(contextLoss.snapshot().requestedCap, 0.5, "context loss drops directly to 0.5");
assert.deepEqual(contextLossNotifications, [0.5], "context loss notifies before a restored context submits");

const good = createAdaptiveHighResolutionController();
submitIntervals(good, Array(240).fill(25));
assert.equal(good.snapshot().requestedCap, 1.25, "two good 120-submit windows and 5s permit one upshift");

const cooldown = createAdaptiveHighResolutionController();
let cooldownNow = submitIntervals(cooldown, Array(240).fill(1));
assert.equal(cooldown.snapshot().requestedCap, 1, "two fast windows alone cannot bypass the 5s cooldown");
cooldown.resetSubmissionWindow();
cooldownNow = 5_000;
cooldown.recordSubmission(cooldownNow);
assert.equal(cooldown.snapshot().requestedCap, 1.25, "the pending upshift applies at the first safe boundary after cooldown");

const sharedOwners = createAdaptiveHighResolutionController();
const puppetGesture = {};
const foundryGesture = {};
sharedOwners.setGestureActive(puppetGesture, true);
sharedOwners.setGestureActive(foundryGesture, true);
let now = submitIntervals(sharedOwners, Array(240).fill(25));
assert.equal(sharedOwners.snapshot().requestedCap, 1, "no upshift applies while either renderer owns a gesture");
sharedOwners.setGestureActive(puppetGesture, false);
now += 25;
sharedOwners.recordSubmission(now);
assert.equal(sharedOwners.snapshot().requestedCap, 1, "releasing one shared owner is insufficient");
sharedOwners.setGestureActive(foundryGesture, false);
now += 25;
sharedOwners.recordSubmission(now);
assert.equal(sharedOwners.snapshot().requestedCap, 1.25, "the next safe shared render boundary applies the upshift");

const slowGesture = createAdaptiveHighResolutionController();
const slowGestureOwner = {};
slowGesture.setGestureActive(slowGestureOwner, true);
submitIntervals(slowGesture, Array(60).fill(43));
assert.equal(
  slowGesture.snapshot().requestedCap,
  0.75,
  "a bad window downshifts even while a gesture owns the session",
);
submitIntervals(slowGesture, [201], 10_000);
assert.equal(
  slowGesture.snapshot().requestedCap,
  0.5,
  "a severe interval forces 0.5 even while a gesture is active",
);

const topology = createAdaptiveHighResolutionController();
const topologyOwner = {};
topology.setTopologyBuildActive(topologyOwner, true);
now = submitIntervals(topology, Array(240).fill(25));
assert.equal(topology.snapshot().requestedCap, 1, "topology work blocks an otherwise eligible upshift");
topology.setTopologyBuildActive(topologyOwner, false);
topology.recordSubmission(now + 25);
assert.equal(topology.snapshot().requestedCap, 1.25, "upshift resumes only at a safe post-topology submission");

const sharedPuppetSettlement = createAdaptiveHighResolutionController();
sharedPuppetSettlement.setAvailableCap(2);
const foundryConsumerSnapshots: number[] = [];
sharedPuppetSettlement.subscribe((snapshot) => {
  foundryConsumerSnapshots.push(snapshot.requestedCap);
});
const releasePuppetInitialTopology = acquireAdaptiveTopologyBuildLease(
  sharedPuppetSettlement,
  {},
);
assert.equal(
  sharedPuppetSettlement.snapshot().requestedCap,
  1,
  "High Puppet initial settlement owns the shared session until topology completes",
);
releasePuppetInitialTopology();
releasePuppetInitialTopology();
submitIntervals(sharedPuppetSettlement, Array(720).fill(25), 10_000);
assert.equal(
  sharedPuppetSettlement.snapshot().requestedCap,
  2,
  "an idempotently released Puppet topology lease permits three 240-interval promotions from 1 to 2",
);
assert.equal(
  foundryConsumerSnapshots.at(-1),
  2,
  "a Foundry subscriber observes the final DPR 2 cap from the shared session authority",
);

console.log("adaptive High resolution controller contract ok");

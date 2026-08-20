import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookAcceptance,
  evaluateChromebookPlaybackAcceptance,
  percentile,
  type PlaybackAudit,
} from "./browser/chromebookAuditReport";
import {
  CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS,
  buildChromebookFeatureAudit,
  type FeatureActionAudit,
  type FeatureRuntimeProbe,
} from "./browser/chromebookFeatureAuditReport";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

assert.deepEqual(CHROMEBOOK_AUDIT_ENVIRONMENT.viewport, { width: 1366, height: 768 });
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor, 1);
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate, 6);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP50Ms, 33.3);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP95Ms, 42);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP99Ms, 75);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver50Percent, 5);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver200, 0);
assert.equal(CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS.nextPaintP95Ms, 100);
assert.equal(CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS.mainThreadLongTaskP95Ms, 50);
assert.equal(percentile([40, 10, 30, 20], 0.95), 40, "percentiles use deterministic nearest-rank ordering");

const passingPlayback: PlaybackAudit = {
  durationMs: 600_000,
  frameCount: 18_000,
  frameIntervalMs: { p50: 32, p95: 40, p99: 70 },
  framesOver50: 100,
  framesOver50Percent: 0.56,
  framesOver200: 0,
  longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  browserEventLatencyMs: { p50: 0, p95: 0, p99: 0 },
  reactCommits: 0,
  heap: {
    supported: true,
    samples: 122,
    firstBytes: 20_000_000,
    lastBytes: 21_000_000,
    growthBytes: 1_000_000,
    allowedGrowthBytes: 8 * 1024 * 1024,
    tailRangeBytes: 500_000,
    stable: true,
  },
  webgl: {
    before: { contextsCreated: 1, contextsLost: 0, contextsRestored: 0, attachedCanvases: 1, resources: {} },
    after: { contextsCreated: 1, contextsLost: 0, contextsRestored: 0, attachedCanvases: 1, resources: {} },
    liveResourceDelta: 0,
    contextDelta: 0,
    topologyBuildDelta: 0,
    geometryCacheDelta: 0,
    materialCacheDelta: 0,
  },
};
assert.equal(
  evaluateChromebookPlaybackAcceptance(
    passingPlayback,
    { p50: 40, p95: 80, p99: 90 },
  ).passed.passed,
  true,
  "the short Foundry gate evaluates playback and its own controls without an end-to-end tab flow",
);
assert.equal(
  evaluateChromebookAcceptance(
    passingPlayback,
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  true,
  "the gate passes only a fully bounded emulation result",
);
assert.equal(
  evaluateChromebookAcceptance(
    { ...passingPlayback, framesOver200: 1 },
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  false,
  "one 200ms playback stall fails acceptance",
);
assert.equal(
  evaluateChromebookAcceptance(
    {
      ...passingPlayback,
      webgl: { ...passingPlayback.webgl, geometryCacheDelta: 1 },
    },
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  false,
  "geometry growth during steady playback fails acceptance",
);

const featureProbe = (
  acquired: number,
  released: number,
  heapBytes: number,
): FeatureRuntimeProbe => ({
  atMs: acquired * 100,
  heapBytes,
  longTaskCount: 0,
  puppetTopologyCount: 0,
  lifecycle: {
    probeSupport: { workers: true, imageBitmaps: true, objectUrls: true },
    workers: {
      acquired,
      released,
      active: acquired - released,
      peakActive: acquired ? 1 : 0,
    },
    imageBitmaps: { acquired: 0, released: 0, active: 0, peakActive: 0 },
    objectUrls: { acquired: 0, released: 0, active: 0, peakActive: 0 },
  },
});
const featureBaseline = featureProbe(0, 0, 20_000_000);
const featureFinal = {
  ...featureProbe(2, 2, 21_000_000),
  heapSamplesBytes: [21_000_000, 21_100_000, 21_050_000],
};
const featureActions: FeatureActionAudit[] = [
  {
    label: "cancel",
    cycle: 1,
    outcome: "cancelled",
    nextPaintMs: 70,
    settleMs: 100,
    longTasks: {
      durationsMs: [],
      latencyMs: { p50: 0, p95: 0, p99: 0 },
      totalMs: 0,
      maxMs: 0,
    },
    puppetTopologyDurationsMs: [],
    before: featureBaseline,
    after: featureBaseline,
  },
  {
    label: "complete",
    cycle: 2,
    outcome: "completed",
    nextPaintMs: 80,
    settleMs: 300,
    jobCompletionMs: 250,
    longTasks: {
      durationsMs: [40],
      latencyMs: { p50: 40, p95: 40, p99: 40 },
      totalMs: 40,
      maxMs: 40,
    },
    puppetTopologyDurationsMs: [],
    before: featureBaseline,
    after: featureFinal,
  },
];
const passingFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  featureBaseline,
  featureFinal,
  {
    minimumWorkerCreations: 2,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  },
);
assert.equal(passingFeature.acceptance.passed.passed, true);
assert.equal(passingFeature.nextPaintLatencyMs.p95, 80);
assert.equal(passingFeature.jobCompletionLatencyMs.p95, 250);
assert.equal(passingFeature.heap.stable, true);
const unstabilizedFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  featureBaseline,
  { ...featureFinal, heapSamplesBytes: undefined },
  {
    minimumWorkerCreations: 2,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  },
);
assert.equal(
  unstabilizedFeature.acceptance.heapStable.passed,
  false,
  "heap support requires three post-GC stabilization samples",
);
const leakingFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  featureBaseline,
  {
    ...featureFinal,
    lifecycle: {
      ...featureFinal.lifecycle,
      workers: { ...featureFinal.lifecycle.workers, active: 1 },
    },
  },
  {
    minimumWorkerCreations: 2,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  },
);
assert.equal(
  leakingFeature.acceptance.workersReturnedToBaseline.passed,
  false,
  "a worker still owned after close fails the feature lifecycle gate",
);

const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
assert(packageJson.scripts["test:chromebook-audit"].startsWith("bun run build &&"), "acceptance runs a normal production build");
assert(!packageJson.scripts["test:chromebook-audit"].includes("build:e2e"), "acceptance excludes diagnostic-build overhead");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-features-audit.spec.ts"), "production-preview acceptance includes the M3 feature audit");
assert.equal(packageJson.scripts["test:chromebook-audit:real-ai"], undefined, "the removed image-recognition workload has no audit command");
assert(!packageJson.scripts["test:chromebook-audit"].includes("chromebook-audit.spec.ts"), "the short per-feature audit is the primary gate");
assert(packageJson.scripts["test:chromebook-audit:full"].includes("chromebook-audit.spec.ts"), "the full workflow and soak remain available separately");
const config = read("playwright.config.ts");
assert(config.includes("channel: 'chrome'") && config.includes("--enable-precise-memory-info"));
assert(config.includes("reuseExistingServer: !process.env.CI && !auditEnabled"), "audit cannot reuse a stale preview server");
const spec = read("tests/browser/chromebook-audit.spec.ts");
const featureSpec = read("tests/browser/chromebook-features-audit.spec.ts");
for (const stage of ["Path", "Foundry", "Design", "Blueprint", "Assembly"]) {
  assert(spec.includes(`measureStage(page, actions, \"${stage}\"`), `audit measures the ${stage} transition`);
}
assert(spec.includes("forbiddenImageRecognitionRequests") && spec.includes("actualChromebookTested: false"));
for (const feature of ["auditRecommend", "auditDesignFit", "auditTraceGif"]) {
  assert(featureSpec.includes(feature), `feature audit exercises ${feature}`);
}
assert(featureSpec.includes("measureClickToNextPaint") && featureSpec.includes("jobCompletionMs"));
assert(!featureSpec.includes("auditAiImport") && !featureSpec.includes("deterministic-ai-worker-boundary"), "the feature gate contains no removed image-recognition workload");
assert(featureSpec.includes("waitForLifecycleBaseline") && featureSpec.includes("collectStableFeatureProbe"));
assert(!featureSpec.includes("minimumObjectUrlCreations"), "the worker-owned GIF path gates URL leaks without requiring main-window URL creation");
const featureRunner = read("tests/browser/chromebookFeatureAuditRunner.ts");
assert(featureRunner.includes("chromebook-feature-${report.feature.name}-audit.json"));
assert(featureRunner.includes('"artifacts/chromebook-audit/features"'), "passed feature reports survive Playwright output cleanup");
assert(
  featureRunner.indexOf("await prepare?.(page)") < featureRunner.indexOf("applyChromebookEmulation(page)"),
  "short feature audits prepare the fixture before throttling the measured action",
);
assert(featureRunner.includes('throttlingScope: "feature-action"'), "feature reports disclose their throttling scope");
const harness = read("tests/browser/chromebookAuditHarness.ts");
assert(harness.includes("Emulation.setCPUThrottlingRate"));
assert(harness.includes("Network.emulateNetworkConditions"));
assert(harness.includes('type: "longtask"') && harness.includes('type: "event"'));
assert(harness.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__") && harness.includes("resourceMethods"));
assert(harness.includes("AuditedWorker") && harness.includes("trackedBitmaps") && harness.includes("activeObjectUrls"));
assert(!harness.includes("value < 2_000"), "multi-second stalls remain visible to the frame gate");
const foundry = read("components/stages/foundry/ThreeFoundryPreview.tsx");
assert(foundry.includes("recordFoundryTopologyBuild"), "normal production rendering exposes topology work only to an injected audit sink");
const workflow = read("tests/browser/workflow.spec.ts");
assert(workflow.includes("clickOptionalButton") && workflow.includes("is visible before its conditional click"));

console.log("Chromebook audit contracts ok");

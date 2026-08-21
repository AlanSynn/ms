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
for (const script of [
  "test:chromebook-audit",
  "test:chromebook-audit:quick",
  "test:chromebook-audit:full",
]) {
  assert(packageJson.scripts[script].startsWith("bun run build:e2e &&"), `${script} runs the production diagnostics build required by retained-renderer probes`);
}
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-features-audit.spec.ts"), "production-preview acceptance includes the M3 feature audit");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-stage-switch-audit.spec.ts"), "production-preview acceptance includes repeated stage ownership checks");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-simulation-audit.spec.ts"), "production-preview acceptance covers every animated classroom stage");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-interaction-audit.spec.ts"), "production-preview acceptance covers direct classroom manipulation");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-import-audit.spec.ts"), "production-preview acceptance covers bounded project and character imports");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-export-audit.spec.ts"), "production-preview acceptance covers Blueprint package generation");
assert.equal(packageJson.scripts["test:chromebook-audit:real-ai"], undefined, "the removed image-recognition workload has no audit command");
assert(!packageJson.scripts["test:chromebook-audit"].includes("chromebook-audit.spec.ts"), "the short per-feature audit is the primary gate");
assert(packageJson.scripts["test:chromebook-audit:full"].includes("chromebook-audit.spec.ts"), "the full workflow and soak remain available separately");
const config = read("playwright.config.ts");
assert(config.includes("channel: 'chrome'") && config.includes("--enable-precise-memory-info"));
assert(config.includes("reuseExistingServer: !process.env.CI && !auditEnabled"), "audit cannot reuse a stale preview server");
const spec = read("tests/browser/chromebook-audit.spec.ts");
const featureSpec = read("tests/browser/chromebook-features-audit.spec.ts");
const stageSwitchSpec = read("tests/browser/chromebook-stage-switch-audit.spec.ts");
const simulationSpec = read("tests/browser/chromebook-simulation-audit.spec.ts");
const interactionSpec = read("tests/browser/chromebook-interaction-audit.spec.ts");
const importSpec = read("tests/browser/chromebook-import-audit.spec.ts");
const exportSpec = read("tests/browser/chromebook-export-audit.spec.ts");
const interactionAudit = read("tests/browser/chromebookInteractionAudit.ts");
const auditHarness = read("tests/browser/chromebookAuditHarness.ts");
const workflowRail = read("components/shell/WorkflowRail.tsx");
assert(workflowRail.includes("workflow-stage-${item.id}"), "stage timing uses stable rail controls without accessibility-tree traversal overhead");
const stageRouter = read("components/AppStageRouter.tsx");
assert(stageRouter.includes("useDeferredStageMount") && stageRouter.includes("stage-transition-frame"), "stage navigation paints its response before mounting a heavy viewport");
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
for (const stage of ["Path", "Foundry", "Design", "Blueprint", "Assembly", "Character", "Options"]) {
  assert(stageSwitchSpec.includes(`\"${stage}\"`), `the short ownership audit revisits ${stage}`);
}
assert(stageSwitchSpec.includes("await runCycles(warmSequence, 1, 3, samples)"), "stage ownership is checked across repeated warm transitions");
assert(stageSwitchSpec.includes("coldLongTaskMax") && stageSwitchSpec.includes("warmBaseline"));
assert(stageSwitchSpec.includes("warmCycleEndLiveResources") && stageSwitchSpec.includes("resourcePlateau"));
assert(stageSwitchSpec.includes("resourcesReturned") && stageSwitchSpec.includes("noContextLoss"));
for (const stage of ["path", "design", "assembly"]) {
  assert(simulationSpec.includes(`\"${stage}\"`), `simulation audit measures ${stage} playback`);
}
assert(simulationSpec.includes("collectPlaybackAudit") && simulationSpec.includes("forbiddenRuntimeRequests"));
for (const interaction of [
  "pathGestures",
  "foundryGestures",
  "designControls",
  "characterControls",
  "optionsHistory",
]) {
  assert(interactionSpec.includes(`\"${interaction}\"`), `interaction audit measures ${interaction}`);
}
assert(interactionSpec.includes("measurePointerEventToNextPaint") && interactionSpec.includes("measureRangeUpdate") && interactionSpec.includes("measureSelectUpdate"));
assert(interactionSpec.includes('toBeAttached({ timeout: 15_000 })'), "Path interaction diagnostics fail boundedly instead of waiting forever when the probe build is absent");
assert(interactionSpec.includes('"part-add"') && interactionSpec.includes('"part-remove"') && interactionSpec.includes('"joint-commit"'), "Character interaction audit covers topology and joint manipulation");
assert(interactionSpec.includes('"performance-fast"') && interactionSpec.includes('"undo"') && interactionSpec.includes('"redo"'), "Options interaction audit covers render policy and project history");
assert(interactionAudit.includes("webglResourceGrowthBounded") && interactionAudit.includes("webglResourcePlateau") && interactionAudit.includes("puppetTopologyP95"));
for (const importFeature of [
  "projectImport",
  "characterPackageImport",
  "sceneObjectImage",
]) {
  assert(importSpec.includes(`"${importFeature}"`), `import audit measures ${importFeature}`);
}
assert(importSpec.includes("12 * 1024 * 1024") && importSpec.includes("Buffer.alloc(5 * 1024 * 1024"), "import audit exercises supersession while large bounded files are still owned");
assert(importSpec.includes('"x".repeat(384 * 1024)') && importSpec.includes('object-artwork-supersede-raster-complete'), "object artwork audit supersedes a large bounded vector and completes a real bounded raster decode");
assert(importSpec.includes("minimumWorkerCreations: 2") && importSpec.includes("waitForLifecycleBaseline"), "import audit requires worker cancellation and final ownership return");
assert(importSpec.includes("FORBIDDEN_RUNTIME") && importSpec.includes("forbiddenRequests"), "local import audit blocks recognition and physics downloads");
assert(auditHarness.includes("longTaskEntries") && auditHarness.includes("actionStartedAt") && auditHarness.includes("entry.startTime + entry.duration"), "feature Long Tasks are clipped to the measured action window so file-injection setup is not attributed to app work");
assert(exportSpec.includes('"blueprintPackage"') && exportSpec.includes("minimumWorkerCreations: 2") && exportSpec.includes("data-audit-cancelled-on-dispatch"), "Blueprint audit measures paint, cancellation, completion, and worker release independently");
assert(exportSpec.includes("FORBIDDEN_RUNTIME") && exportSpec.includes("blueprint-export-package-json"), "Blueprint audit blocks recognition/physics requests and hidden production package serialization");
assert(
  stageSwitchSpec.indexOf("await openWavingArm(page)") < stageSwitchSpec.indexOf("applyChromebookEmulation(page)"),
  "the stage audit throttles only measured stage interactions",
);
const featureRunner = read("tests/browser/chromebookFeatureAuditRunner.ts");
assert(featureRunner.includes("chromebook-feature-${report.feature.name}-audit.json"));
assert(featureRunner.includes('"artifacts/chromebook-audit/features"'), "passed feature reports survive Playwright output cleanup");
assert(
  featureRunner.indexOf("await prepare?.(page)") < featureRunner.indexOf("applyChromebookEmulation(page)"),
  "short feature audits prepare the fixture before throttling the measured action",
);
assert(featureRunner.includes('throttlingScope: "feature-action"'), "feature reports disclose their throttling scope");
assert(featureRunner.includes('browser.browserType().launch({') && featureRunner.includes('channel: "chrome"') && featureRunner.includes('await auditBrowser.close()'), "each short feature audit owns and closes an isolated branded-Chrome process");
const harness = read("tests/browser/chromebookAuditHarness.ts");
assert(harness.includes("Emulation.setCPUThrottlingRate"));
assert(harness.includes("Network.emulateNetworkConditions"));
assert(harness.includes('type: "longtask"') && harness.includes('type: "event"'));
assert(harness.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__") && harness.includes("resourceMethods"));
assert(harness.includes("AuditedWorker") && harness.includes("trackedBitmaps") && harness.includes("activeObjectUrls"));
assert(!harness.includes("value < 2_000"), "multi-second stalls remain visible to the frame gate");
const foundry = read("components/stages/foundry/ThreeFoundryPreview.tsx");
assert(foundry.includes("recordFoundryTopologyBuild"), "normal production rendering exposes topology work only to an injected audit sink");
assert(foundry.includes("partTopology.edgeGeometryEnabled") && foundry.includes("partTopology.bevelEnabled"), "Foundry automata geometry follows the selected detail policy");
const foundryPrimitives = read("components/stages/foundry/foundryThreePrimitives.ts");
assert(foundryPrimitives.includes("edgeGeometryEnabled") && foundryPrimitives.includes("if (!material.edge) return"), "Balanced Foundry primitives skip decorative edge extraction");
const threeResourceKit = read("utils/threeResourceKit.ts");
assert(threeResourceKit.includes("acquireSharedWebGLRenderer") && threeResourceKit.includes("renderer.renderLists.dispose()"));
assert(foundry.includes("acquireSharedWebGLRenderer") && foundry.includes("rendererLease.release()"));
const puppet = read("components/ThreePuppetPreview.tsx");
assert(puppet.includes("acquireSharedWebGLRenderer") && puppet.includes("rendererLease.release()"));
const workflow = read("tests/browser/workflow.spec.ts");
assert(workflow.includes("clickOptionalButton") && workflow.includes("is visible before its conditional click"));

console.log("Chromebook audit contracts ok");

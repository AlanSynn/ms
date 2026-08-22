import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
import {
  CHROMEBOOK_AUDIT_PROFILES,
  resolveChromebookAuditProfile,
  type ChromebookAuditProfileName,
} from "./browser/chromebookAuditProfiles";
import {
  buildHighResolutionPressureEvidence,
  buildHighResolutionColdStageEvidence,
  advanceHighResolutionWarmPlateau,
  evaluateChromebookHighResolutionAcceptance,
  HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL,
  HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
  HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES,
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS,
  playbackControlTestIdForSurface,
  sharedRendererContextPredatesStageClick,
  initialHighResolutionWarmPlateauState,
  partitionScenarioLongTasks,
  type HighResolutionDprSample,
  type HighResolutionScenarioEvidence,
  type HighResolutionSurfaceEvidence,
} from "./browser/chromebookHighResolutionAudit";
import {
  advanceFoundryBaselineStability,
  buildInteractionAudit,
  FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES,
  initialFoundryBaselineStability,
  type FoundryBaselineFrameProbe,
  type VisualProbe,
} from "./browser/chromebookInteractionAudit";
import {
  expectedChromebookAuditReports,
  prepareChromebookAuditArtifacts,
  validateChromebookAuditArtifacts,
} from "./browser/chromebookAuditArtifacts";
import { HIGH_RESOLUTION_ADAPTATION_RULES } from "../runtime/render/adaptiveHighResolutionController";
import { staticImportSpecifiers } from "../scripts/browser-bundle-graph.mjs";
import {
  classifyClassroomStagePreloadReadiness,
  mayStartAdjacentStagePreload,
  type ClassroomStageReadinessSignals,
} from "../components/classroomStageModules";
import { analyzeChromebookCdpTrace } from "./browser/chromebookCdpTrace";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

assert.deepEqual(CHROMEBOOK_AUDIT_ENVIRONMENT.viewport, { width: 1366, height: 768 });
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor, 1);
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate, 6);
assert.equal(CHROMEBOOK_AUDIT_PROFILES["regression-4x"].environment.cpuThrottlingRate, 4);
assert.equal(CHROMEBOOK_AUDIT_PROFILES["acceptance-6x"].environment.cpuThrottlingRate, 6);
assert.equal(
  CHROMEBOOK_AUDIT_PROFILES["acceptance-6x"].environment
    .cpuThrottleDisclosure.dedicatedWorkerTargets,
  "not-attached-or-calibrated",
  "page-target CDP throttling never claims dedicated-worker calibration",
);
assert.equal(resolveChromebookAuditProfile("regression-4x").purpose, "regression");
assert.throws(() => resolveChromebookAuditProfile("physical-chromebook"));
const readyStageSignals: ClassroomStageReadinessSignals = {
  rendererExpected: true,
  rendererStatus: "webgl",
  authoritativeRendererReady: true,
  emptyStage: false,
  previewLoadFailed: false,
};
assert.equal(
  classifyClassroomStagePreloadReadiness(readyStageSignals),
  "ready",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    authoritativeRendererReady: false,
  }),
  "waiting",
  "WebGL creation alone cannot release adjacent-stage parsing before authoritative scene readiness",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    rendererStatus: "pending",
  }),
  "waiting",
  "a pending renderer cannot release adjacent-stage parsing",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    rendererStatus: null,
    authoritativeRendererReady: false,
  }),
  "waiting",
  "a missing viewport is not silently promoted to the bounded fallback",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    rendererStatus: "unavailable",
    authoritativeRendererReady: false,
  }),
  "safe-fallback",
  "WebGL unavailability takes the bounded non-renderer fallback",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    rendererStatus: null,
    authoritativeRendererReady: false,
    previewLoadFailed: true,
  }),
  "safe-fallback",
  "an explicit deferred-preview failure takes the delayed safe fallback instead of deadlocking adjacent preload",
);
assert.equal(
  classifyClassroomStagePreloadReadiness({
    ...readyStageSignals,
    rendererExpected: false,
    rendererStatus: null,
    authoritativeRendererReady: false,
    emptyStage: true,
  }),
  "safe-fallback",
  "an explicit empty stage takes the bounded non-renderer fallback",
);
assert.equal(mayStartAdjacentStagePreload("waiting", true), false);
assert.equal(mayStartAdjacentStagePreload("safe-fallback", false), false);
assert.equal(mayStartAdjacentStagePreload("safe-fallback", true), true);
assert.equal(mayStartAdjacentStagePreload("ready", false), true);
assert.equal(HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS, 3);
assert.equal(
  playbackControlTestIdForSurface("path"),
  "workspace-player-dock",
  "Path playback remains owned by the shared workspace clock",
);
assert.equal(
  playbackControlTestIdForSurface("foundry"),
  "foundry-toolbar",
  "Foundry playback drives the local Foundry simulation clock",
);
assert.equal(
  sharedRendererContextPredatesStageClick(10, 10),
  true,
  "a context created by the settled Character boundary can be reused at the Path click",
);
assert.equal(
  sharedRendererContextPredatesStageClick(11, 10),
  false,
  "a context first created after the Path click is cold Path work, not shared readiness",
);
assert.equal(
  sharedRendererContextPredatesStageClick(null, 10),
  false,
  "missing context provenance cannot claim a settled shared renderer",
);
assert.equal(
  HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS,
  HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowSize *
    HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowsPerUpshift * 3,
  "the native-DPR audit derives all three controller upshifts",
);
assert.equal(HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS, 24_578);
assert.equal(
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS,
  26_000,
  "the bounded production window includes margin above the slowest qualifying controller evidence",
);
const warmPlateauSample = (
  globalGlIndex: number,
  overrides: Partial<Parameters<typeof advanceHighResolutionWarmPlateau>[1]> = {},
): Parameters<typeof advanceHighResolutionWarmPlateau>[1] => ({
  globalGlIndex,
  rendererReady: true,
  topologyReady: true,
  initialSceneResourcesReady: true,
  pendingInitialSceneResources: 0,
  declaredPartTextures: 14,
  rendererTextures: 13,
  contextIndex: 0,
  canvasCount: 1,
  contextsCreated: 1,
  contextsLost: 0,
  contextsRestored: 0,
  reactCommits: 4,
  foundryTopologyBuilds: 1,
  foundryGeometryCacheSize: 9,
  foundryMaterialCacheSize: 9,
  liveResources: 50,
  liveResourcesByKind: {},
  resourceCountersByKind: {},
  liveResourcesSignature: "buffer:40,texture:10",
  resourcesSignature: "stable-resources",
  ...overrides,
});
let warmPlateauState = initialHighResolutionWarmPlateauState();
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(1),
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(1),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  1,
  "host polls without a new actual GL submission do not establish a plateau",
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(2),
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(3),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  3,
  "a stable lower renderer texture count is valid only after pending work drains and full counters remain unchanged",
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(4, { reactCommits: 5 }),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  1,
  "a React commit resets the actual-frame ownership plateau",
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(5, {
    reactCommits: 5,
    resourceCountersByKind: {
      buffer: { created: 11, deleted: 1, live: 10 },
    },
    resourcesSignature: "resource-churn",
  }),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  1,
  "identity-aware resource churn resets the ownership plateau",
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(6, { topologyReady: false }),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  0,
  "an unfinished topology cannot become the playback baseline",
);
warmPlateauState = advanceHighResolutionWarmPlateau(
  warmPlateauState,
  warmPlateauSample(7, {
    initialSceneResourcesReady: false,
    pendingInitialSceneResources: 1,
    rendererTextures: 13,
  }),
);
assert.equal(
  warmPlateauState.stableActualFrames,
  0,
  "pending initial-scene resources cannot become the playback baseline",
);
const causalColdPath = buildHighResolutionColdStageEvidence({
  surface: "path",
  requestedAtMs: 0,
  clickedAtMs: 1,
  transitionFrameAtMs: 2,
  stageContentAtMs: 5,
  inspectorMountedAtMs: 5,
  exampleMountedAtMs: null,
  previewLoadingAtMs: 5,
  previewMountedAtMs: 7,
  contextCreatedAtMs: 8,
  rendererWebglAtMs: 10,
  firstGlSubmissionAtMs: 10,
  topologyReadyAtMs: 16,
  initialSceneResourcesReadyAtMs: 18,
  completedAtMs: 20,
  foundryChildMarkers: null,
  predecessorResourceDisposal: {
    predecessorSurface: "character",
    contextIndices: [0],
    canvasClassNameAtStart: "three-puppet-canvas",
    canvasDetachObservedAtMs: 9,
    deletions: [{
      atMs: 12,
      kind: "texture",
      contextIndex: 0,
      canvasClassName: "three-puppet-canvas",
      canvasConnected: false,
      liveBefore: 2,
      liveAfter: 1,
      ownership: "predecessor-canvas",
    }],
    batches: [{
      contextIndex: 0,
      canvasClassName: "three-puppet-canvas",
      canvasConnectedAtStart: false,
      firstAtMs: 12,
      lastAtMs: 12,
      stackReturnedAtMs: 13,
      uniqueDeletionCount: 1,
      ownership: "predecessor-canvas",
    }],
  },
  scriptResources: [{
    name: "PathEditor-contract.js",
    role: "stage-adapter",
    startTime: 1.5,
    responseEnd: 3,
    duration: 1.5,
    transferSize: 100,
    decodedBodySize: 200,
    loadedBeforeClick: false,
  }],
}, [
  { startTime: 2, duration: 2 },
  { startTime: 10, duration: 5 },
]);
assert(
  causalColdPath.phaseWindows.some(
    (phase) => phase.label === "path:stage-adapter-fetch",
  ) && causalColdPath.phaseWindows.some(
    (phase) => phase.label === "path:first-gl-compile-and-topology",
  ),
  "cold-stage evidence separates stage loading from first-GL compile/topology work",
);
assert.equal(causalColdPath.unattributedLongTasks.length, 0);
assert(
  causalColdPath.longTaskAttribution[1]?.phaseLabels.includes(
    "path:first-gl-compile-and-topology",
  ),
  "a renderer-init Long Task remains causally attributed and acceptance-visible",
);
assert.equal(
  causalColdPath.longTaskAttribution[1]
    ?.predecessorResourceDeletions.length,
  1,
  "identity-owned predecessor GL deletion timestamps remain attached to an overlapping cold Long Task",
);
assert.equal(
  causalColdPath.longTaskAttribution[1]?.overlapsPredecessorTeardown,
  true,
  "the diagnostic records teardown overlap through the microtask stack-return boundary",
);
assert.deepEqual(causalColdPath.predecessorTeardownTiming, {
  canvasDetachObservedAtMs: 9,
  firstDeletionAtMs: 12,
  lastDeletionAtMs: 12,
  cleanupStackReturnedAtMs: 13,
  detachObservationToFirstDeletionMs: 3,
  deletionIssueDurationMs: 0,
  lastDeletionToStackReturnMs: 1,
  firstDeletionToStackReturnMs: 1,
});
const eagerFoundryExample = buildHighResolutionColdStageEvidence({
  ...causalColdPath,
  surface: "foundry",
  predecessorResourceDisposal: {
    predecessorSurface: "path",
    contextIndices: [],
    canvasClassNameAtStart: null,
    canvasDetachObservedAtMs: null,
    deletions: [],
    batches: [],
  },
  exampleMountedAtMs: 6,
  scriptResources: [{
    name: "ClassroomExampleVideo-contract.js",
    role: "inspector-example",
    startTime: 2,
    responseEnd: 4,
    duration: 2,
    transferSize: 100,
    decodedBodySize: 200,
    loadedBeforeClick: false,
  }],
}, []);
assert.equal(
  eagerFoundryExample.inspectorExampleDeferred,
  false,
  "the cold Foundry gate rejects eager example-video mount or loading",
);
const foundryChildMarkers = {
  installedAtMs: 0,
  clicked: { atMs: 1, reactCommits: 10 },
  transitionFrame: { atMs: 2, reactCommits: 11 },
  stageContent: { atMs: 5, reactCommits: 12 },
  inspector: { atMs: 5, reactCommits: 12 },
  gallery: { atMs: 5, reactCommits: 12 },
  galleryVisiblePreviews: [
    { count: 0, atMs: 5, reactCommits: 12 },
    { count: 1, atMs: 11, reactCommits: 13 },
  ],
  galleryPreviews: [{
    name: "foundry-mini-simulation-4bar",
    atMs: 11,
    reactCommits: 13,
  }],
  galleryGhosts: [{
    name: "foundry-mini-ghost-4bar-0",
    atMs: 13,
    reactCommits: 15,
  }],
  parametricEditor: { atMs: 15, reactCommits: 18 },
  deferredThreePlaceholder: { atMs: 5, reactCommits: 12 },
  deferredThreePlaceholderRemoved: { atMs: 17, reactCommits: 19 },
  deferredThreeLoadStates: [{
    name: "loading",
    atMs: 5,
    reactCommits: 12,
  }],
  threePreview: { atMs: 17, reactCommits: 19 },
  threeCanvas: { atMs: 17, reactCommits: 19 },
  rendererWebgl: { atMs: 18, reactCommits: 19 },
  firstGlSubmission: { atMs: 18, reactCommits: 19 },
  topologyReady: { atMs: 19, reactCommits: 20 },
  completed: { atMs: 20, reactCommits: 20 },
};
const childAttributedFoundry = buildHighResolutionColdStageEvidence({
  ...causalColdPath,
  surface: "foundry",
  previewMountedAtMs: 17,
  contextCreatedAtMs: 18,
  rendererWebglAtMs: 18,
  firstGlSubmissionAtMs: 18,
  topologyReadyAtMs: 19,
  initialSceneResourcesReadyAtMs: 19,
  foundryChildMarkers,
  predecessorResourceDisposal: {
    predecessorSurface: "path",
    contextIndices: [0],
    canvasClassNameAtStart: "three-puppet-canvas",
    canvasDetachObservedAtMs: 5.5,
    deletions: [
      {
        atMs: 6,
        kind: "buffer",
        contextIndex: 0,
        canvasClassName: "three-puppet-canvas",
        canvasConnected: false,
        liveBefore: 3,
        liveAfter: 2,
        ownership: "predecessor-canvas",
      },
      {
        atMs: 7,
        kind: "shader",
        contextIndex: 0,
        canvasClassName: "foundry-three-canvas",
        canvasConnected: true,
        liveBefore: 2,
        liveAfter: 1,
        ownership: "successor-on-shared-context",
      },
    ],
    batches: [{
      contextIndex: 0,
      canvasClassName: "three-puppet-canvas",
      canvasConnectedAtStart: false,
      firstAtMs: 6,
      lastAtMs: 6,
      stackReturnedAtMs: 6.5,
      uniqueDeletionCount: 1,
      ownership: "predecessor-canvas",
    }],
  },
  scriptResources: [],
}, [{ startTime: 5.1, duration: 7 }]);
assert(
  childAttributedFoundry.foundryChildLongTaskAttribution[0]
    ?.markersInsideTask.some((mark) => mark.name === "gallery-visible-1"),
  "full High cold evidence reuses progressive Foundry child markers without removing the Long Task",
);
assert.equal(
  childAttributedFoundry.longTaskAttribution[0]
    ?.predecessorResourceDeletions[0]?.kind,
  "buffer",
  "the same cold Long Task reports exact Path-context disposal activity",
);
assert.equal(
  childAttributedFoundry.longTaskAttribution[0]
    ?.predecessorResourceDeletions.length,
  1,
  "successor shader cleanup on a reused context is not mislabeled as Path teardown",
);
const syntheticCdpAttribution = analyzeChromebookCdpTrace({
  traceEvents: [
    {
      name: "motionsmith:high-foundry-trace:start",
      cat: "blink.user_timing",
      ph: "R",
      pid: 1,
      tid: 2,
      ts: 1_000,
    },
    {
      name: "ThreadControllerImpl::RunTask",
      cat: "toplevel",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 1_000,
      dur: 70_000,
    },
    {
      name: "RunTask",
      cat: "toplevel",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 1_050,
      dur: 69_900,
    },
    {
      name: "FunctionCall",
      cat: "devtools.timeline",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 2_000,
      dur: 40_000,
      args: {
        data: {
          functionName: "mountFoundry",
          url: "http://localhost/assets/MechanismFoundry-contract.js",
          lineNumber: 10,
        },
      },
    },
    {
      name: "UpdateLayoutTree",
      cat: "devtools.timeline",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 42_000,
      dur: 10_000,
    },
    {
      name: "Paint",
      cat: "devtools.timeline",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 52_000,
      dur: 5_000,
    },
    {
      name: "MinorGC",
      cat: "v8",
      ph: "X",
      pid: 1,
      tid: 2,
      ts: 57_000,
      dur: 3_000,
    },
    {
      name: "motionsmith:high-foundry-trace:end",
      cat: "blink.user_timing",
      ph: "R",
      pid: 1,
      tid: 2,
      ts: 90_000,
    },
  ],
  cpuProfile: {
    startTime: 0,
    endTime: 90_000,
    nodes: [{
      id: 7,
      callFrame: {
        functionName: "mountFoundry",
        url: "http://localhost/assets/MechanismFoundry-contract.js",
        lineNumber: 10,
        columnNumber: 2,
      },
    }],
    samples: [7, 7, 7],
    timeDeltas: [10_000, 10_000, 10_000],
  },
  longTasks: [{ startTime: 0, duration: 70 }],
  startedAtPageMs: 0,
});
assert.equal(
  syntheticCdpAttribution.tasks[0]?.matchingRunTask?.durationMs,
  70,
  "the bounded CDP diagnostic aligns a page Long Task with the renderer main-thread task",
);
assert.equal(
  syntheticCdpAttribution.rendererTasksOver50[0]?.duration,
  69.9,
  "trace-visible renderer tasks remain diagnostic even when the Long Tasks API omits rendering work",
);
assert.equal(
  syntheticCdpAttribution.rendererTasksOver50.length,
  1,
  "nested scheduler wrappers do not double-count one renderer task",
);
assert(
  (syntheticCdpAttribution.tasks[0]?.selfTimeMs.javascript ?? 0) > 0 &&
    (syntheticCdpAttribution.tasks[0]?.selfTimeMs["style-layout"] ?? 0) > 0 &&
    (syntheticCdpAttribution.tasks[0]?.selfTimeMs["paint-composite"] ?? 0) > 0 &&
    (syntheticCdpAttribution.tasks[0]?.selfTimeMs.gc ?? 0) > 0,
  "CDP trace attribution keeps JavaScript, style/layout, paint/composite, and GC costs separate",
);
assert.equal(
  syntheticCdpAttribution.tasks[0]?.topCpuFunctions[0]?.url,
  "http://localhost/assets/MechanismFoundry-contract.js",
  "the CPU profile preserves the responsible script URL and function",
);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP50Ms, 33.3);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP95Ms, 42);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP99Ms, 75);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver50Percent, 5);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver200, 0);
assert.equal(CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS.nextPaintP95Ms, 100);
assert.equal(CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS.mainThreadLongTaskP95Ms, 50);
assert.equal(CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS.mainThreadLongTaskMaxMs, 50);
assert.equal(percentile([40, 10, 30, 20], 0.95), 40, "percentiles use deterministic nearest-rank ordering");
assert.deepEqual(
  staticImportSpecifiers(
    'import{a}from"./static-a.js";import"./static-b.js";const load=()=>import("./dynamic.js");',
  ),
  ["./static-a.js", "./static-b.js"],
  "bundle closure includes emitted static imports but excludes lazy stage imports",
);

const passingPlayback: PlaybackAudit = {
  frameSource: "webgl-clear-submission",
  timedWindow: { startedAtMs: 0, endedAtMs: 600_000 },
  memoryMeasurementWindows: [
    {
      owner: "playback",
      phase: "baseline",
      sampleIndex: 0,
      startedAtMs: -20,
      endedAtMs: -10,
    },
    {
      owner: "playback",
      phase: "tail",
      sampleIndex: 0,
      startedAtMs: 600_010,
      endedAtMs: 600_020,
    },
  ],
  warmPlateau: {
    surface: "path",
    requiredStableActualFrames: HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES,
    stableActualFrames: HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES,
    startedAtMs: -100,
    pausedAtMs: -30,
    playNextPaintMs: 30,
    pauseNextPaintMs: 25,
    firstGlobalGlIndex: 1,
    lastGlobalGlIndex: 3,
    rendererReady: true,
    topologyReady: true,
    initialSceneResourcesReady: true,
    pendingInitialSceneResources: 0,
    declaredPartTextures: 14,
    rendererTextures: 13,
    reactCommits: 2,
    foundryTopologyBuilds: 1,
    foundryGeometryCacheSize: 9,
    foundryMaterialCacheSize: 9,
    liveResources: 50,
    liveResourcesByKind: {},
    resourceCountersByKind: {},
    contextsLost: 0,
    contextsRestored: 0,
  },
  durationMs: 600_000,
  frameCount: 18_000,
  frameIntervalMs: { p50: 32, p95: 40, p99: 70 },
  framesOver50: 100,
  framesOver50Percent: 0.56,
  framesOver200: 0,
  eventLoopRaf: {
    sampleCount: 36_000,
    intervalMs: { p50: 16, p95: 17, p99: 18 },
    intervalsOver50: 0,
    intervalsOver50Percent: 0,
    intervalsOver200: 0,
  },
  longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  browserEventLatencyMs: { p50: 0, p95: 0, p99: 0 },
  reactCommits: 0,
  heap: {
    supported: true,
    diagnosticAvailable: true,
    metricSource: "measure-user-agent-specific-memory",
    authoritative: true,
    crossOriginIsolated: true,
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
    resourceDeltaByKind: {},
    liveResourceDelta: 0,
    contextDelta: 0,
    contextLossDelta: 0,
    contextRestoreDelta: 0,
    topologyBuildDelta: 0,
    geometryCacheDelta: 0,
    materialCacheDelta: 0,
  },
};
const highResolutionEnvironment = (profile: ChromebookAuditProfileName) => ({
  ...CHROMEBOOK_AUDIT_PROFILES[profile].environment,
  deviceScaleFactor: 2 as const,
  browserVersion: "contract",
  userAgent: "contract",
  measuredDeviceScaleFactor: 2,
  throttlingScope: "feature-action" as const,
  memoryIsolation: {
    source: "diagnostic-preview-response-headers" as const,
    crossOriginOpenerPolicy: "same-origin" as const,
    crossOriginEmbedderPolicy: "require-corp" as const,
    crossOriginIsolated: true,
  },
  graphics: {
    windowDevicePixelRatio: 2,
    visualViewportScale: 1,
    effectiveRendererDpr: 1.25,
    contexts: [{
      api: "webgl2" as const,
      vendor: "contract",
      renderer: "contract",
      unmaskedVendor: "contract",
      unmaskedRenderer: "contract",
      maxRenderbufferDimension: 8192,
    }],
    drawingBuffers: [],
  },
});
const highResolutionSample = (
  requestedDprCap: number,
  atMs: number,
): HighResolutionDprSample => {
  const drawingBufferWidth = Math.round(500 * requestedDprCap);
  const drawingBufferHeight = Math.round(250 * requestedDprCap);
  return {
    globalGlIndex: atMs,
    atMs,
    contextIndex: 0,
    className: "contract-canvas",
    requestedDprCap,
    effectiveDpr: requestedDprCap,
    drawingBufferWidth,
    drawingBufferHeight,
    drawingBufferPixels: drawingBufferWidth * drawingBufferHeight,
    maxRenderbufferDimension: 8192,
  };
};
const playbackForWindow = (
  startedAtMs: number,
  durationMs: number,
  heap: PlaybackAudit["heap"] = passingPlayback.heap,
): PlaybackAudit => ({
  ...structuredClone(passingPlayback),
  durationMs,
  timedWindow: {
    startedAtMs,
    endedAtMs: startedAtMs + durationMs,
  },
  memoryMeasurementWindows: [
    {
      owner: "playback",
      phase: "baseline",
      sampleIndex: 0,
      startedAtMs: startedAtMs - 20,
      endedAtMs: startedAtMs - 10,
    },
    {
      owner: "playback",
      phase: "tail",
      sampleIndex: 0,
      startedAtMs: startedAtMs + durationMs + 10,
      endedAtMs: startedAtMs + durationMs + 20,
    },
  ],
  heap,
});
const highResolutionSurface = (
  surface: "path" | "foundry",
  samples: HighResolutionDprSample[],
): HighResolutionSurfaceEvidence => {
  const playback = structuredClone(passingPlayback);
  playback.warmPlateau!.surface = surface;
  playback.warmPlateau!.pendingInitialSceneResources =
    surface === "path" ? 0 : null;
  return {
    surface,
    startedAtMs: 0,
    endedAtMs: Math.max(500, ...samples.map((sample) => sample.atMs + 1)),
    submissionCount: samples.length,
    submissionHistory: samples,
    dprHistory: samples,
    backingStoreHistory: samples.map((sample) => ({
      atMs: sample.atMs,
      contextIndex: sample.contextIndex,
      changedDimension: "submission" as const,
      className: sample.className,
      width: sample.drawingBufferWidth,
      height: sample.drawingBufferHeight,
      pixels: sample.drawingBufferPixels,
      maxRenderbufferDimension: sample.maxRenderbufferDimension,
    })),
    highWaterPixels: Math.max(...samples.map((sample) => sample.drawingBufferPixels)),
    playback,
    playbackAcceptance: evaluateChromebookPlaybackAcceptance(
      playback,
      { p50: 20, p95: 30, p99: 40 },
    ),
  };
};
const highResolutionScenario = (
  profile: ChromebookAuditProfileName,
  preset: "balanced" | "high",
  pathSamples: HighResolutionDprSample[],
  foundrySamples: HighResolutionDprSample[],
): HighResolutionScenarioEvidence => ({
  preset,
  environment: highResolutionEnvironment(profile),
  backingStoreMutationProbeSupported: true,
  contextsLost: 0,
  contextsRestored: 0,
  pageErrors: [],
  pathContextCreatedBeforeClick: true,
  coldStages: {
    path: buildHighResolutionColdStageEvidence({
      surface: "path",
      requestedAtMs: 0,
      clickedAtMs: 1,
      transitionFrameAtMs: 2,
      stageContentAtMs: 3,
      inspectorMountedAtMs: 3,
      exampleMountedAtMs: null,
      previewLoadingAtMs: null,
      previewMountedAtMs: 4,
      contextCreatedAtMs: 4,
      rendererWebglAtMs: 5,
      firstGlSubmissionAtMs: 5,
      topologyReadyAtMs: 6,
      initialSceneResourcesReadyAtMs: 6,
      completedAtMs: 7,
      foundryChildMarkers: null,
      predecessorResourceDisposal: {
        predecessorSurface: "character",
        contextIndices: [],
        canvasClassNameAtStart: null,
        canvasDetachObservedAtMs: null,
        deletions: [],
        batches: [],
      },
      scriptResources: [],
    }, []),
    foundry: buildHighResolutionColdStageEvidence({
      surface: "foundry",
      requestedAtMs: 10,
      clickedAtMs: 11,
      transitionFrameAtMs: 12,
      stageContentAtMs: 13,
      inspectorMountedAtMs: 13,
      exampleMountedAtMs: null,
      previewLoadingAtMs: null,
      previewMountedAtMs: 14,
      contextCreatedAtMs: 4,
      rendererWebglAtMs: 15,
      firstGlSubmissionAtMs: 15,
      topologyReadyAtMs: 16,
      initialSceneResourcesReadyAtMs: 16,
      completedAtMs: 17,
      foundryChildMarkers: null,
      predecessorResourceDisposal: {
        predecessorSurface: "path",
        contextIndices: [],
        canvasClassNameAtStart: null,
        canvasDetachObservedAtMs: null,
        deletions: [],
        batches: [],
      },
      scriptResources: [],
    }, []),
  },
  measuredLongTasks: {
    count: 0,
    durationsMs: [],
    maxMs: 0,
    rawEntries: [],
    rawCount: 0,
    rawDurationsMs: [],
    rawMaxMs: 0,
    measuredPhaseWindows: [{
      label: "contract",
      startedAtMs: 0,
      endedAtMs: 600_000,
    }],
    outsideMeasuredPhaseEntries: [],
    outsideMeasuredPhaseDurationsMs: [],
    outsideMeasuredPhaseMaxMs: 0,
    phaseAttribution: [],
    auditInternalMemoryMeasurementWindows: [],
    excludedProbeEntries: [],
    excludedProbeDurationsMs: [],
    excludedProbeMaxMs: 0,
  },
  path: highResolutionSurface("path", pathSamples),
  foundry: highResolutionSurface("foundry", foundrySamples),
});
const balanced4x = highResolutionScenario(
  "regression-4x",
  "balanced",
  [highResolutionSample(0.5, 10)],
  [highResolutionSample(0.5, 20)],
);
const high4x = highResolutionScenario(
  "regression-4x",
  "high",
  [
    highResolutionSample(1, 10),
    highResolutionSample(1.25, 8_000),
    highResolutionSample(1.5, 16_000),
    highResolutionSample(2, 25_000),
    highResolutionSample(2, HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS + 100),
    highResolutionSample(2, HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS + 200),
  ],
  [highResolutionSample(2, HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS + 500)],
);
const promotionPlayback = playbackForWindow(
  0,
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS,
);
const promotionInitialPixels = high4x.path.submissionHistory[0].drawingBufferPixels;
const promotionFinalPixels = high4x.path.submissionHistory[3].drawingBufferPixels;
const promotionDeltaPixels = promotionFinalPixels - promotionInitialPixels;
high4x.path.promotion = {
  playback: promotionPlayback,
  playbackAcceptance: evaluateChromebookPlaybackAcceptance(
    promotionPlayback,
    { p50: 20, p95: 30, p99: 40 },
  ),
  allocation: {
    initialPixels: promotionInitialPixels,
    finalPixels: promotionFinalPixels,
    deltaPixels: promotionDeltaPixels,
    observedGrowthBytes: promotionPlayback.heap.growthBytes,
    bytesPerPixelBudget: HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL,
    fixedOverheadBytes: HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
    allowedGrowthBytes:
      promotionDeltaPixels * HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL +
      HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
    bounded: true,
    nearFourMegapixelMemoryUnproven: true,
  },
};
high4x.path.playback = playbackForWindow(
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS + 50,
  3_000,
);
high4x.path.playbackAcceptance = evaluateChromebookPlaybackAcceptance(
  high4x.path.playback,
  { p50: 20, p95: 30, p99: 40 },
);
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: high4x,
  }).passed.passed,
  true,
  "DPR2 High passes only after the capable 4x path promotes and Foundry inherits it",
);
const noPromotion4x = structuredClone(high4x);
noPromotion4x.path.dprHistory = [highResolutionSample(1, 10)];
noPromotion4x.path.submissionHistory = [highResolutionSample(1, 10)];
noPromotion4x.foundry.dprHistory = [highResolutionSample(1, 300)];
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: noPromotion4x,
  }).capablePromotion4x.passed,
  false,
  "a High run that never promotes cannot claim capable-hardware coverage",
);
const partialPromotion4x = structuredClone(high4x);
partialPromotion4x.path.dprHistory = [
  highResolutionSample(1, 10),
  highResolutionSample(1.25, 200),
];
partialPromotion4x.path.submissionHistory = [...partialPromotion4x.path.dprHistory];
partialPromotion4x.foundry.dprHistory = [highResolutionSample(1.25, 300)];
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: partialPromotion4x,
  }).capablePromotion4x.passed,
  false,
  "a 1 -> 1.25 partial promotion cannot claim native-DPR capable coverage",
);
const cappedEffective4x = structuredClone(high4x);
cappedEffective4x.path.dprHistory.at(-1)!.effectiveDpr = 1.5;
cappedEffective4x.path.submissionHistory
  .filter((sample) => sample.atMs <= HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS)
  .at(-1)!.effectiveDpr = 1.5;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: cappedEffective4x,
  }).capablePromotion4x.passed,
  false,
  "a requested DPR 2 sample whose effective backing ratio is lower cannot pass",
);
const shortPromotion4x = structuredClone(high4x);
shortPromotion4x.path.promotion!.playback.durationMs =
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS - 1;
shortPromotion4x.path.promotion!.playback.timedWindow.endedAtMs =
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS - 1;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: shortPromotion4x,
  }).promotionWindowSufficient4x.passed,
  false,
  "native DPR samples cannot excuse a promotion window shorter than the derived audit bound",
);
const expectedPromotionGrowth4x = structuredClone(high4x);
expectedPromotionGrowth4x.path.promotion!.playback.heap.stable = false;
expectedPromotionGrowth4x.path.promotion!.playbackAcceptance.heapStable.passed = false;
expectedPromotionGrowth4x.path.promotion!.playbackAcceptance.passed.passed = false;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: expectedPromotionGrowth4x,
  }).passed.passed,
  true,
  "bounded DPR backing-store allocation is separated from post-promotion leak stability",
);
const underSampledPromotion4x = structuredClone(high4x);
underSampledPromotion4x.path.promotion!.playback.frameCount =
  HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS - 1;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: underSampledPromotion4x,
  }).promotionSubmissionEvidence4x.passed,
  false,
  "warm-up submissions outside the exact promotion window cannot satisfy controller evidence",
);
const unboundedPromotionGrowth4x = structuredClone(expectedPromotionGrowth4x);
unboundedPromotionGrowth4x.path.promotion!.allocation.bounded = false;
unboundedPromotionGrowth4x.path.promotion!.allocation.observedGrowthBytes =
  unboundedPromotionGrowth4x.path.promotion!.allocation.allowedGrowthBytes + 1;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: unboundedPromotionGrowth4x,
  }).promotionAllocationBounded4x.passed,
  false,
  "promotion allocation above the pixel-derived budget still fails",
);
const missingSettledPath4x = structuredClone(high4x);
delete missingSettledPath4x.path.playback;
delete missingSettledPath4x.path.playbackAcceptance;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: missingSettledPath4x,
  }).settledPathNativeDpr4x.passed,
  false,
  "native promotion cannot replace a separate settled Path memory/resource gate",
);
const unstableSettledPath4x = structuredClone(high4x);
unstableSettledPath4x.path.playback!.heap.stable = false;
unstableSettledPath4x.path.playbackAcceptance!.heapStable.passed = false;
unstableSettledPath4x.path.playbackAcceptance!.passed.passed = false;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: unstableSettledPath4x,
  }).settledPathNativeDpr4x.passed,
  false,
  "post-promotion DPR2 Path instability fails even when promotion succeeds",
);
const preWindowPromotion4x = structuredClone(high4x);
preWindowPromotion4x.path.promotion!.playback.timedWindow.startedAtMs = 24_000;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: preWindowPromotion4x,
  }).capablePromotion4x.passed,
  false,
  "DPR changes before the exact timed promotion origin do not count",
);
const overlappingMemoryProbe4x = structuredClone(high4x);
overlappingMemoryProbe4x.path.promotion!.playback.memoryMeasurementWindows[0] = {
  owner: "playback",
  phase: "baseline",
  sampleIndex: 0,
  startedAtMs: -10,
  endedAtMs: 1,
};
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: overlappingMemoryProbe4x,
  }).memoryProbesQuiescent.passed,
  false,
  "a memory probe that overlaps active playback invalidates the audit",
);
const missingWarmPlateau4x = structuredClone(high4x);
delete missingWarmPlateau4x.path.promotion!.playback.warmPlateau;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: missingWarmPlateau4x,
  }).playbackOwnershipWarmPlateau.passed,
  false,
  "cold ownership cannot be hidden by starting the steady playback baseline early",
);
const incompleteColdStage4x = structuredClone(high4x);
incompleteColdStage4x.coldStages.path.markersComplete = false;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: incompleteColdStage4x,
  }).coldStageCausalEvidence.passed,
  false,
  "a playback pass cannot substitute for missing cold module/renderer phase evidence",
);
const coldPathContext4x = structuredClone(high4x);
coldPathContext4x.pathContextCreatedBeforeClick = false;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: coldPathContext4x,
  }).settledCharacterContextBeforePath.passed,
  false,
  "a context first created after the Path click cannot masquerade as shared Character readiness",
);
const eagerColdExample4x = structuredClone(high4x);
eagerColdExample4x.coldStages.foundry.inspectorExampleDeferred = false;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: eagerColdExample4x,
  }).coldStageCausalEvidence.passed,
  false,
  "cold Foundry cannot pass while the collapsed example module mounts eagerly",
);
const wrongWarmOwner4x = structuredClone(high4x);
wrongWarmOwner4x.foundry.playback!.warmPlateau!.surface = "path";
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: wrongWarmOwner4x,
  }).playbackOwnershipWarmPlateau.passed,
  false,
  "a Path plateau cannot prove Foundry ownership readiness",
);
const slowWarmControl4x = structuredClone(high4x);
slowWarmControl4x.path.promotion!.playback.warmPlateau!.playNextPaintMs = 101;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: slowWarmControl4x,
  }).warmControlLatency.passed,
  false,
  "moving cold ownership outside steady counters does not waive Play response",
);
const pendingInitialResources4x = structuredClone(high4x);
Object.assign(
  pendingInitialResources4x.path.promotion!.playback.warmPlateau!,
  {
    initialSceneResourcesReady: false,
    pendingInitialSceneResources: 1,
    declaredPartTextures: 14,
    rendererTextures: 13,
  },
);
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: pendingInitialResources4x,
  }).playbackOwnershipWarmPlateau.passed,
  false,
  "a topology plateau cannot hide pending initial-scene resource work",
);
const hiddenWarmResourceChurn4x = structuredClone(high4x);
const churnPlayback = hiddenWarmResourceChurn4x.path.promotion!.playback;
churnPlayback.warmPlateau!.liveResources = 10;
churnPlayback.warmPlateau!.liveResourcesByKind = { buffer: 10 };
churnPlayback.warmPlateau!.resourceCountersByKind = {
  buffer: { created: 10, deleted: 0, live: 10 },
};
const churnSnapshot = {
  contextsCreated: 1,
  contextsLost: 0,
  contextsRestored: 0,
  attachedCanvases: 1,
  resources: {
    buffer: { created: 11, deleted: 1, live: 10, peakLive: 11 },
  },
};
churnPlayback.webgl.before = structuredClone(churnSnapshot);
churnPlayback.webgl.after = structuredClone(churnSnapshot);
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: hiddenWarmResourceChurn4x,
  }).playbackOwnershipWarmPlateau.passed,
  false,
  "net-zero GPU churn between warm readiness and the exact baseline remains visible",
);
const partitionedLongTasks = partitionScenarioLongTasks(
  [
    { startTime: 110, duration: 60 },
    { startTime: 90, duration: 30 },
    { startTime: 190, duration: 30 },
    { startTime: 300, duration: 51 },
    { startTime: 500, duration: 80 },
  ],
  [{
    owner: "playback",
    phase: "tail",
    sampleIndex: 0,
    startedAtMs: 100,
    endedAtMs: 200,
  }],
  [{ label: "steady-playback", startedAtMs: 100, endedAtMs: 400 }],
);
assert.deepEqual(
  partitionedLongTasks.excludedProbeEntries,
  [{ startTime: 110, duration: 60 }],
  "only Long Tasks fully contained in an isolated internal probe are excluded",
);
assert.deepEqual(
  partitionedLongTasks.appWorkEntries,
  [
    { startTime: 90, duration: 30 },
    { startTime: 190, duration: 30 },
    { startTime: 300, duration: 51 },
    { startTime: 500, duration: 80 },
  ],
  "Long Tasks straddling probe/phase boundaries and cold setup tasks remain application work",
);
assert.deepEqual(
  partitionedLongTasks.outsideMeasuredPhaseEntries,
  [{ startTime: 500, duration: 80 }],
  "setup and teardown Long Tasks remain separately attributable",
);
assert.deepEqual(
  partitionedLongTasks.phaseAttribution.at(-1),
  {
    startTime: 500,
    duration: 80,
    phaseLabels: [],
    attribution: "scenario-setup-control-teardown",
  },
  "outside-phase attribution does not remove cold runtime work from acceptance",
);
const coldSetupLongTask4x = structuredClone(high4x);
const coldSetupDurations = partitionedLongTasks.appWorkEntries.map(
  (entry) => entry.duration,
);
coldSetupLongTask4x.measuredLongTasks = {
  ...coldSetupLongTask4x.measuredLongTasks,
  count: coldSetupDurations.length,
  durationsMs: coldSetupDurations,
  maxMs: Math.max(...coldSetupDurations),
  rawEntries: partitionedLongTasks.phaseAttribution.map(
    ({ startTime, duration }) => ({ startTime, duration }),
  ),
  rawCount: partitionedLongTasks.phaseAttribution.length,
  rawDurationsMs: partitionedLongTasks.phaseAttribution.map(
    (entry) => entry.duration,
  ),
  rawMaxMs: Math.max(
    ...partitionedLongTasks.phaseAttribution.map((entry) => entry.duration),
  ),
  outsideMeasuredPhaseEntries:
    partitionedLongTasks.outsideMeasuredPhaseEntries,
  outsideMeasuredPhaseDurationsMs:
    partitionedLongTasks.outsideMeasuredPhaseEntries.map(
      (entry) => entry.duration,
    ),
  outsideMeasuredPhaseMaxMs: 80,
  phaseAttribution: partitionedLongTasks.phaseAttribution,
};
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: coldSetupLongTask4x,
  }).measuredLongTaskMax.passed,
  false,
  "a cold stage task above 50ms still fails when attributed outside steady playback",
);
const droppedFoundry4x = structuredClone(high4x);
droppedFoundry4x.foundry.dprHistory.push(highResolutionSample(1.5, 450));
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: droppedFoundry4x,
  }).sharedPathFoundryOwnership.passed,
  false,
  "Path promotion must remain native through the settled Foundry run",
);
const pixelOverflow4x = structuredClone(high4x);
pixelOverflow4x.foundry.backingStoreHistory[0].pixels = 4_000_001;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: pixelOverflow4x,
  }).pixelBudget.passed,
  false,
  "one transient backing-store sample above four million pixels fails High",
);
const dimensionOverflow4x = structuredClone(high4x);
dimensionOverflow4x.path.backingStoreHistory[0].width = 8193;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: dimensionOverflow4x,
  }).renderbufferDimensionBudget.passed,
  false,
  "one backing-store dimension above MAX_RENDERBUFFER_SIZE fails High",
);
const driftingBalanced4x = structuredClone(balanced4x);
driftingBalanced4x.path.dprHistory[0].effectiveDpr = 0.75;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: driftingBalanced4x,
    high: high4x,
  }).balancedFixedDpr.passed,
  false,
  "the DPR2 comparison cannot hide a Balanced resolution regression",
);
const balanced6x = highResolutionScenario(
  "acceptance-6x",
  "balanced",
  [highResolutionSample(0.5, 10)],
  [highResolutionSample(0.5, 20)],
);
const high6x = highResolutionScenario(
  "acceptance-6x",
  "high",
  [highResolutionSample(1, 10)],
  [highResolutionSample(1, 100), highResolutionSample(0.75, 201)],
);
high6x.pressure = {
  startedAtMs: 100,
  endedAtMs: 2_700,
  submissionCount: 61,
  timerTaskCount: 61,
  intervalMs: { p50: 43, p95: 43, p99: 43 },
  qualifyingBadWindow: {
    startedAtMs: 100,
    endedAtMs: 200,
    intervalMs: { p50: 43, p95: 43, p99: 43 },
    framesOver50Percent: 0,
  },
  requestedDprBefore: 1,
  requestedDprAfter: 0.75,
  downshiftAtMs: 201,
  pressurePlayback: playbackForWindow(100, 2_600),
};
high6x.pressure.pressurePlayback.warmPlateau!.surface = "foundry";
high6x.pressure.pressurePlayback.warmPlateau!.pendingInitialSceneResources =
  null;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["acceptance-6x"],
    balanced: balanced6x,
    high: high6x,
  }).passed.passed,
  true,
  "the 6x High gate requires a causal bad window, downshift, and settled acceptance",
);
const noDownshift6x = structuredClone(high6x);
noDownshift6x.pressure!.requestedDprAfter = 1;
noDownshift6x.pressure!.downshiftAtMs = null;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["acceptance-6x"],
    balanced: balanced6x,
    high: noDownshift6x,
  }).deterministicDownshift6x.passed,
  false,
  "bad 6x submissions without an actual DPR reduction fail",
);
const longPressure6x = structuredClone(high6x);
longPressure6x.pressure!.pressurePlayback.longTasks.maxMs = 51;
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["acceptance-6x"],
    balanced: balanced6x,
    high: longPressure6x,
  }).pressureNonFrameSafety.passed,
  false,
  "synthetic pressure cannot conceal a Long Task above 50ms",
);
const longScenario4x = structuredClone(high4x);
longScenario4x.measuredLongTasks = {
  ...longScenario4x.measuredLongTasks,
  count: 1,
  durationsMs: [51],
  maxMs: 51,
  rawEntries: [{ startTime: 300, duration: 51 }],
  rawCount: 1,
  rawDurationsMs: [51],
  rawMaxMs: 51,
};
assert.equal(
  evaluateChromebookHighResolutionAcceptance({
    profile: CHROMEBOOK_AUDIT_PROFILES["regression-4x"],
    balanced: balanced4x,
    high: longScenario4x,
  }).measuredLongTaskMax.passed,
  false,
  "High stage entry and ownership transitions also enforce the 50ms Long Task maximum",
);
const pressureSurface = highResolutionSurface(
  "foundry",
  [highResolutionSample(1, 90), highResolutionSample(0.75, 2_681)],
);
pressureSurface.submissionCount = 61;
pressureSurface.submissionHistory = Array.from(
  { length: 61 },
  (_, index) => highResolutionSample(index === 60 ? 0.75 : 1, 100 + index * 43),
);
pressureSurface.backingStoreHistory = pressureSurface.submissionHistory.map(
  (sample) => ({
    atMs: sample.atMs,
    contextIndex: sample.contextIndex,
    changedDimension: "submission" as const,
    className: sample.className,
    width: sample.drawingBufferWidth,
    height: sample.drawingBufferHeight,
    pixels: sample.drawingBufferPixels,
    maxRenderbufferDimension: sample.maxRenderbufferDimension,
  }),
);
const builtPressure = buildHighResolutionPressureEvidence({
  foundry: pressureSurface,
  startedAtMs: 90,
  endedAtMs: 2_700,
  pressurePlayback: passingPlayback,
  timerTaskCount: 61,
});
assert.equal(builtPressure.qualifyingBadWindow?.intervalMs.p95, 43);
assert.equal(builtPressure.requestedDprBefore, 1);
assert.equal(builtPressure.requestedDprAfter, 0.75);
assert.equal(
  builtPressure.downshiftAtMs! >= builtPressure.qualifyingBadWindow!.endedAtMs,
  true,
  "the reported DPR reduction follows the observed bad 60-submission window",
);
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
assert.equal(
  evaluateChromebookPlaybackAcceptance(
    {
      ...passingPlayback,
      webgl: {
        ...passingPlayback.webgl,
        liveResourceDelta: 0,
        resourceDeltaByKind: {
          buffer: { created: 1, deleted: 1, live: 0 },
        },
      },
    },
    { p50: 20, p95: 30, p99: 40 },
  ).webglResourceChurnAbsent.passed,
  false,
  "net-zero per-kind WebGL allocation churn still fails steady playback",
);
const frozenPlaybackAcceptance = evaluateChromebookPlaybackAcceptance(
  {
    ...passingPlayback,
    frameCount: 0,
    frameIntervalMs: { p50: 0, p95: 0, p99: 0 },
    framesOver50: 0,
    framesOver50Percent: 0,
  },
  { p50: 10, p95: 20, p99: 20 },
);
assert.equal(
  frozenPlaybackAcceptance.passed.passed,
  false,
  "a frozen renderer cannot pass on a healthy host rAF loop",
);
assert.equal(frozenPlaybackAcceptance.renderSubmissionsObserved.passed, false);
const contextRecoveryDuringPlayback = evaluateChromebookPlaybackAcceptance(
  {
    ...passingPlayback,
    webgl: {
      ...passingPlayback.webgl,
      after: {
        ...passingPlayback.webgl.after,
        contextsLost: 1,
        contextsRestored: 1,
      },
      contextLossDelta: 1,
      contextRestoreDelta: 1,
    },
  },
  { p50: 10, p95: 20, p99: 20 },
);
assert.equal(contextRecoveryDuringPlayback.passed.passed, false);
assert.equal(contextRecoveryDuringPlayback.webglContextLossAbsent.passed, false);
assert.equal(
  contextRecoveryDuringPlayback.webglContextRestorationAbsent.passed,
  false,
);
const unsupportedPlaybackHeap = evaluateChromebookPlaybackAcceptance(
  {
    ...passingPlayback,
    heap: { ...passingPlayback.heap, supported: false, stable: true },
  },
  { p50: 10, p95: 20, p99: 20 },
);
assert.equal(unsupportedPlaybackHeap.passed.passed, false);
assert.equal(unsupportedPlaybackHeap.heapSupported.passed, false);

const onePlaybackLongTask = evaluateChromebookPlaybackAcceptance(
  {
    ...passingPlayback,
    longTasks: { count: 1, totalMs: 50.1, maxMs: 50.1 },
  },
  { p50: 10, p95: 20, p99: 20 },
);
assert.equal(onePlaybackLongTask.mainThreadLongTaskMax.passed, false);
assert.equal(onePlaybackLongTask.passed.passed, false);
const diagnosticOnlyPlayback = evaluateChromebookPlaybackAcceptance(
  {
    ...passingPlayback,
    heap: {
      ...passingPlayback.heap,
      metricSource: "performance-memory-diagnostic",
      authoritative: false,
      crossOriginIsolated: false,
    },
  },
  { p50: 10, p95: 20, p99: 20 },
);
assert.equal(diagnosticOnlyPlayback.memoryAuthoritative.passed, false);
assert.equal(
  diagnosticOnlyPlayback.passed.passed,
  false,
  "the default 6x acceptance profile cannot pass on performance.memory",
);

const featureProbe = (
  acquired: number,
  released: number,
  heapBytes: number,
): FeatureRuntimeProbe => ({
  atMs: acquired * 100,
  heapBytes,
  memory: {
    source: "measure-user-agent-specific-memory",
    authoritative: true,
    crossOriginIsolated: true,
    bytes: heapBytes,
  },
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
const unsupportedFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  { ...featureBaseline, heapBytes: undefined },
  { ...featureFinal, heapBytes: undefined, heapSamplesBytes: [] },
  {
    minimumWorkerCreations: 2,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  },
);
assert.equal(unsupportedFeature.acceptance.passed.passed, false);
assert.equal(unsupportedFeature.acceptance.heapSupported.passed, false);
assert.equal(unsupportedFeature.acceptance.heapBounded.passed, false);
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
const diagnosticOnlyProbe: FeatureRuntimeProbe = {
  ...featureFinal,
  memory: {
    source: "performance-memory-diagnostic",
    authoritative: false,
    crossOriginIsolated: false,
    bytes: featureFinal.heapBytes,
  },
};
const diagnosticOnlyFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  {
    ...featureBaseline,
    memory: diagnosticOnlyProbe.memory,
  },
  diagnosticOnlyProbe,
  { minimumWorkerCreations: 2 },
);
assert.equal(diagnosticOnlyFeature.acceptance.memoryAuthoritative.passed, false);
assert.equal(diagnosticOnlyFeature.heap.supported, false);
const mixedMemoryFeature = buildChromebookFeatureAudit(
  "recommend",
  featureActions,
  featureBaseline,
  {
    ...featureFinal,
    memory: diagnosticOnlyProbe.memory,
  },
  { minimumWorkerCreations: 2 },
);
assert.equal(mixedMemoryFeature.heap.metricSource, "unsupported");
assert.equal(mixedMemoryFeature.heap.authoritative, false);
assert.equal(
  mixedMemoryFeature.acceptance.heapSupported.passed,
  false,
  "mixed authoritative and diagnostic memory sources cannot pass",
);

const longTaskOutlierActions: FeatureActionAudit[] = Array.from(
  { length: 21 },
  (_, index) => ({
    ...featureActions[0],
    label: `long-task-${index}`,
    cycle: index,
    longTasks: {
      durationsMs: [index === 20 ? 50.1 : 10],
      latencyMs: { p50: 10, p95: 10, p99: index === 20 ? 50.1 : 10 },
      totalMs: index === 20 ? 50.1 : 10,
      maxMs: index === 20 ? 50.1 : 10,
    },
  }),
);
const longTaskOutlierFeature = buildChromebookFeatureAudit(
  "recommend",
  longTaskOutlierActions,
  featureBaseline,
  featureFinal,
  { minimumWorkerCreations: 2 },
);
assert.equal(longTaskOutlierFeature.mainThreadLongTaskLatencyMs.p95, 10);
assert.equal(
  longTaskOutlierFeature.acceptance.mainThreadLongTaskMax.passed,
  false,
  "one Long Task over 50ms fails even when the feature p95 remains below 50ms",
);
const foundryBaselineFrame = (
  globalGlIndex: number,
  topologyBuilds: number,
  bufferCount: number,
): FoundryBaselineFrameProbe => ({
  globalGlIndex,
  foundryContextIndex: 0,
  rendererReady: true,
  topologyReady: topologyBuilds > 0,
  foundryCanvasCount: 1,
  contextsCreated: 1,
  contextsLost: 0,
  contextsRestored: 0,
  foundryTopologyBuilds: topologyBuilds,
  foundryGeometryCacheSize: topologyBuilds > 0 ? 9 : 0,
  foundryMaterialCacheSize: topologyBuilds > 0 ? 9 : 0,
  resources: {
    buffer: {
      created: bufferCount,
      deleted: 0,
      live: bufferCount,
      peakLive: bufferCount,
    },
  },
});
let foundryBaselineStability = initialFoundryBaselineStability();
foundryBaselineStability = advanceFoundryBaselineStability(
  foundryBaselineStability,
  foundryBaselineFrame(0, 0, 6),
);
assert.equal(
  foundryBaselineStability.stableActualFrames,
  0,
  "a WebGL frame before Foundry topology readiness cannot establish the baseline",
);
for (const sample of [
  foundryBaselineFrame(1, 1, 38),
  foundryBaselineFrame(2, 2, 47),
  foundryBaselineFrame(3, 3, 53),
  foundryBaselineFrame(4, 3, 53),
]) {
  foundryBaselineStability = advanceFoundryBaselineStability(
    foundryBaselineStability,
    sample,
  );
}
assert.equal(
  foundryBaselineStability.stableActualFrames,
  2,
  "cold topology/cache growth continually resets the stable-frame run",
);
foundryBaselineStability = advanceFoundryBaselineStability(
  foundryBaselineStability,
  foundryBaselineFrame(4, 3, 53),
);
assert.equal(
  foundryBaselineStability.stableActualFrames,
  2,
  "polling one host frame twice cannot fabricate an actual GL stability sample",
);
foundryBaselineStability = advanceFoundryBaselineStability(
  foundryBaselineStability,
  foundryBaselineFrame(5, 3, 53),
);
assert.equal(FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES, 3);
assert.equal(
  foundryBaselineStability.stableActualFrames,
  FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES,
  "only three distinct GL submissions with identical identity/resource counters release the gesture baseline",
);
const foundryVisualActions: FeatureActionAudit[] = [
  "D-move",
  "M-move",
  "orbit-move",
].map((label, index) => {
  const actionStartedAtMs = 1_000 + index * 100;
  const eventToFirstGlMs = 38 + index * 2;
  const tracksGesture = label !== "orbit-move";
  return {
    ...featureActions[0],
    label,
    cycle: index + 1,
    outcome: "completed",
    interactionClass: "direct",
    nextPaintMs: index === 2 ? 50.1 : 40 + index,
    renderSubmissionOffsetsMs: [eventToFirstGlMs],
    causality: {
      actionStartedAtMs,
      globalGlStartIndex: index * 10,
      globalGlEndIndex: index * 10 + 1,
      causalGlobalGlIndex: index * 10,
      causalGlAtMs: actionStartedAtMs + eventToFirstGlMs,
      foundryCanvasGlStartCount: index,
      foundryCanvasGlEndCount: index + 1,
      rigSubmissionStartCount: index,
      rigSubmissionEndCount: index + 1,
      gestureEmissionStartCount: tracksGesture ? index : undefined,
      gestureEmissionCount: tracksGesture ? index + 1 : undefined,
      gestureEmissionAtMs: tracksGesture ? actionStartedAtMs + 5 : undefined,
      pointerEventTimestampsMs: Array.from(
        { length: 6 },
        (_, pointerIndex) => actionStartedAtMs + pointerIndex,
      ),
      pointerEventOffsetsMs: [0, 1, 2, 3, 4, 5],
      eventToGestureEmissionMs: tracksGesture ? 5 : undefined,
      gestureEmissionToFirstGlMs: tracksGesture
        ? eventToFirstGlMs - 5
        : undefined,
      eventToFirstGlMs,
    },
  };
});
const foundryCommitActions: FeatureActionAudit[] = ["D-commit", "M-commit"]
  .map((label, index) => ({
    ...featureActions[0],
    label,
    cycle: index + 1,
    outcome: "completed",
    interactionClass: "direct",
    nextPaintMs: 40,
    renderSubmissionOffsetsMs: [500 + index],
  }));
const directOutlierActions = [...foundryVisualActions, ...foundryCommitActions];
const emptyVisualProbe: VisualProbe = {
  reactCommits: 0,
  foundryTopologyBuilds: 0,
  foundryGeometryCacheSize: 0,
  foundryMaterialCacheSize: 0,
  webgl: {
    contextsCreated: 1,
    contextsLost: 0,
    contextsRestored: 0,
    attachedCanvases: 1,
    resources: {},
  },
};
const directOutlierFeature = buildInteractionAudit(
  "foundryGestures",
  directOutlierActions,
  featureBaseline,
  featureFinal,
  emptyVisualProbe,
  emptyVisualProbe,
  {
    maxTopologyBuilds: 0,
    maxLiveResourceGrowth: 0,
    maxGeometryCacheGrowth: 0,
    maxMaterialCacheGrowth: 0,
  },
);
assert.equal(directOutlierFeature.acceptance.nextPaintP95.passed, true);
assert.equal(directOutlierFeature.acceptance.directInteractionP95.passed, false);
assert.equal(directOutlierFeature.acceptance.directVisualSubmissionP95.passed, true);
assert.equal(directOutlierFeature.visual.directVisualSubmissionSampleCount, 3);
assert.equal(directOutlierFeature.visual.directVisualSubmissionRequiredCount, 3);
assert.equal(directOutlierFeature.visual.directVisualCausalSampleCount, 3);
assert.equal(directOutlierFeature.acceptance.directVisualCausalCoverage.passed, true);
assert.equal(
  directOutlierFeature.acceptance.passed.passed,
  false,
  "a direct manipulation over 50ms fails even when the general 100ms gate passes",
);

const visualSubmissionOutlierFeature = buildInteractionAudit(
  "foundryGestures",
  directOutlierActions.map((action, index) => ({
    ...action,
    nextPaintMs: 40,
    renderSubmissionOffsetsMs: [index === 2 ? 50.1 : 45 + index],
  })),
  featureBaseline,
  featureFinal,
  emptyVisualProbe,
  emptyVisualProbe,
  {
    maxTopologyBuilds: 0,
    maxLiveResourceGrowth: 0,
    maxGeometryCacheGrowth: 0,
    maxMaterialCacheGrowth: 0,
  },
);
assert.equal(visualSubmissionOutlierFeature.acceptance.directInteractionP95.passed, true);
assert.equal(
  visualSubmissionOutlierFeature.acceptance.directVisualSubmissionP95.passed,
  false,
);
assert.equal(
  visualSubmissionOutlierFeature.acceptance.passed.passed,
  false,
  "a visual-changing D/M/orbit move whose first actual GL submission exceeds 50ms fails even when host paint passes",
);

const missingVisualSubmissionFeature = buildInteractionAudit(
  "foundryGestures",
  directOutlierActions.map((action, index) => ({
    ...action,
    nextPaintMs: 40,
    renderSubmissionOffsetsMs: index === 1 ? [] : [40],
  })),
  featureBaseline,
  featureFinal,
  emptyVisualProbe,
  emptyVisualProbe,
  {
    maxTopologyBuilds: 0,
    maxLiveResourceGrowth: 0,
    maxGeometryCacheGrowth: 0,
    maxMaterialCacheGrowth: 0,
  },
);
assert.equal(
  missingVisualSubmissionFeature.acceptance.directVisualSubmissionCoverage.passed,
  false,
  "D move, M move, and orbit move must each produce an actual GL submission sample",
);
assert.equal(missingVisualSubmissionFeature.acceptance.passed.passed, false);

const wrongCanvasSubmissionFeature = buildInteractionAudit(
  "foundryGestures",
  directOutlierActions.map((action, index) => index !== 1 || !action.causality
    ? action
    : {
        ...action,
        causality: {
          ...action.causality,
          foundryCanvasGlEndCount: action.causality.foundryCanvasGlStartCount,
        },
      }),
  featureBaseline,
  featureFinal,
  emptyVisualProbe,
  emptyVisualProbe,
  {
    maxTopologyBuilds: 0,
    maxLiveResourceGrowth: 0,
    maxGeometryCacheGrowth: 0,
    maxMaterialCacheGrowth: 0,
  },
);
assert.equal(
  wrongCanvasSubmissionFeature.acceptance.directVisualCausalCoverage.passed,
  false,
  "a global GL clear from another canvas cannot satisfy Foundry move coverage",
);

const artifactParent = join(tmpdir(), "chromebook-audit");
mkdirSync(artifactParent, { recursive: true });
const artifactRoot = mkdtempSync(join(artifactParent, "contract-"));
try {
  await assert.rejects(() => prepareChromebookAuditArtifacts(
    join(tmpdir(), "unrelated-user-directory"),
    "feature",
    "regression-4x",
  ), /Refusing unsafe/);
  writeFileSync(join(artifactRoot, "stale.json"), "{}", "utf8");
  const prepared = await prepareChromebookAuditArtifacts(
    artifactRoot,
    "feature",
    "regression-4x",
  );
  assert.equal(prepared.preparedEmpty, true);
  assert.equal(
    expectedChromebookAuditReports("feature").length,
    21,
    "the short manifest expects entry, 14 features, four playback surfaces, stages, and adaptive High resolution",
  );
  for (const reportPath of expectedChromebookAuditReports("feature")) {
    const path = join(artifactRoot, reportPath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({
      schemaVersion: 3,
      profile: "regression-4x",
      productionBuild: true,
      actualChromebookTested: false,
      provenance: {
        sourceRevision: "contract",
        distSha256: "contract",
        invocation: {
          auditProfile: "regression-4x",
          command: "contract",
        },
      },
    }), "utf8");
  }
  const validated = await validateChromebookAuditArtifacts(
    artifactRoot,
    "feature",
    "regression-4x",
  );
  assert.equal(validated.validation, "passed");
  writeFileSync(join(artifactRoot, "unexpected.json"), "{}", "utf8");
  await assert.rejects(() => validateChromebookAuditArtifacts(
    artifactRoot,
    "feature",
    "regression-4x",
  ));
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
}

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
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-audit-instrumentation.spec.ts"), "production-preview acceptance includes adversarial audit-probe coverage");
assert(packageJson.scripts["test:chromebook-audit"].includes("chromebook-high-resolution-audit.spec.ts"), "the short production-preview gate includes the proven adaptive High matrix");
assert(packageJson.scripts["test:chromebook-audit:full"].includes("chromebook-high-resolution-audit.spec.ts"), "the full acceptance gate reuses the proven adaptive High matrix on its single dist");
assert(
  packageJson.scripts["test:chromebook-audit:high-resolution"].includes(
    "chromebook-high-resolution-audit.spec.ts",
  ) &&
    packageJson.scripts["test:chromebook-audit:high-resolution"].includes(
      "CHROMEBOOK_AUDIT_ENFORCE=1",
    ) &&
    packageJson.scripts["test:chromebook-audit:high-resolution"].includes(
      "--workers=1",
    ),
  "the focused DPR2 production-preview comparison is enforcing and serial",
);
assert.equal(packageJson.scripts["test:chromebook-audit:real-ai"], undefined, "the removed image-recognition workload has no audit command");
assert(!packageJson.scripts["test:chromebook-audit"].includes("chromebook-audit.spec.ts"), "the short per-feature audit is the primary gate");
assert(packageJson.scripts["test:chromebook-audit:full"].includes("chromebook-audit.spec.ts"), "the full workflow and soak remain available separately");
const bundleBudget = read("scripts/check-browser-bundle.mjs");
assert(bundleBudget.includes("collectStaticImportClosure") && bundleBudget.includes("entryJsGzipBytes"), "core bundle enforcement follows the emitted static-import closure while reporting entry-only size");
assert(bundleBudget.includes("schemaVersion: 2"), "the bundle report version identifies static-closure semantics");
const config = read("playwright.config.ts");
assert(config.includes("channel: 'chrome'") && config.includes("--enable-precise-memory-info"));
assert(config.includes("reuseExistingServer: !process.env.CI && !auditEnabled"), "audit cannot reuse a stale preview server");
const spec = read("tests/browser/chromebook-audit.spec.ts");
const featureSpec = read("tests/browser/chromebook-features-audit.spec.ts");
const stageSwitchSpec = read("tests/browser/chromebook-stage-switch-audit.spec.ts");
const simulationSpec = read("tests/browser/chromebook-simulation-audit.spec.ts");
const playbackSpec = read("tests/browser/chromebook-playback-audit.spec.ts");
const highResolutionSpec = read(
  "tests/browser/chromebook-high-resolution-audit.spec.ts",
);
const foundryColdDiagnosticSpec = read(
  "tests/browser/chromebookFoundryColdDiagnostic.ts",
);
const interactionSpec = read("tests/browser/chromebook-interaction-audit.spec.ts");
const importSpec = read("tests/browser/chromebook-import-audit.spec.ts");
const exportSpec = read("tests/browser/chromebook-export-audit.spec.ts");
const entrySpec = read("tests/browser/classroom-entry-performance.spec.ts");
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
for (const feature of [
  "auditRecommend",
  "auditDesignFit",
  "auditTraceGif",
  "auditTraceVideo",
  "auditRapierDiagnostics",
]) {
  assert(featureSpec.includes(feature), `feature audit exercises ${feature}`);
}
assert(featureSpec.includes("measureClickToNextPaint") && featureSpec.includes("jobCompletionMs"));
assert(!featureSpec.includes("auditAiImport") && !featureSpec.includes("deterministic-ai-worker-boundary"), "the feature gate contains no removed image-recognition workload");
assert(featureSpec.includes("waitForLifecycleBaseline") && featureSpec.includes("collectStableFeatureProbe"));
assert(featureSpec.includes("minimumObjectUrlCreations: 2"), "Video Trace exercises and releases both cancelled and completed Object URLs");
assert(featureSpec.includes("rapierRequestedOnce") && featureSpec.includes("forbiddenRuntimeAbsent"), "Rapier performance coverage gates one lazy chunk request without recognition payloads");
assert(entrySpec.includes("event.isTrusted") && entrySpec.includes("nextPaintMs"), "classroom entry measures a trusted click through its next paint boundary");
assert(entrySpec.includes("CHROMEBOOK_ENTRY_SAMPLES") && entrySpec.includes("value ?? 20"), "classroom entry defaults to 20 cold samples while retaining a bounded smoke override");
assert(
  entrySpec.includes("interactiveReadyMs") &&
    entrySpec.includes("character-part-list") &&
    entrySpec.includes("waitForCharacterRendererBoundary") &&
    entrySpec.includes("data-three-renderer-status") &&
    entrySpec.includes("data-three-topology-ready") &&
    entrySpec.includes("data-three-pending-initial-scene-resources") &&
    entrySpec.includes("data-three-render-submissions") &&
    entrySpec.includes("task.startTime < readyAt"),
  "Character entry remains timed through its final submitted renderer boundary and Long Tasks",
);
const highCharacterBoundarySource = highResolutionSpec.slice(
  highResolutionSpec.indexOf("const waitForCharacterRendererBoundary"),
  highResolutionSpec.indexOf("const configurePreset"),
);
assert(
  highCharacterBoundarySource.includes("data-three-renderer-status") &&
    highCharacterBoundarySource.includes("data-three-topology-ready") &&
    highCharacterBoundarySource.includes(
      "data-three-pending-initial-scene-resources",
    ) &&
    highCharacterBoundarySource.includes("data-three-render-submissions") &&
    highResolutionSpec.includes("sharedRendererContextPredatesStageClick") &&
    highResolutionSpec.includes("pathContextCreatedBeforeClick"),
  "High Path starts only after Character's authoritative final GL boundary and reuses its pre-click context",
);
for (const stage of ["Path", "Foundry", "Design", "Blueprint", "Assembly", "Character", "Options"]) {
  assert(stageSwitchSpec.includes(`\"${stage}\"`), `the short ownership audit revisits ${stage}`);
}
assert(stageSwitchSpec.includes("await runCycles(warmSequence, 1, 3, samples)"), "stage ownership is checked across repeated warm transitions");
assert(stageSwitchSpec.includes("coldLongTaskMax") && stageSwitchSpec.includes("warmBaseline"));
assert(stageSwitchSpec.includes("warmCycleEndLiveResources") && stageSwitchSpec.includes("resourcePlateau"));
assert(stageSwitchSpec.includes("resourcesReturned") && stageSwitchSpec.includes("noContextLoss"));
assert(stageSwitchSpec.includes("heapSupported") && stageSwitchSpec.includes("noContextRestoration"));
assert(
  stageSwitchSpec.includes("waitForStageContent") &&
    stageSwitchSpec.includes("data-three-topology-ready") &&
    stageSwitchSpec.includes("data-three-render-submissions"),
  "stage readiness waits for the application renderer instead of the host rAF alone",
);
assert(
  stageSwitchSpec.includes("readSettledStageProbe") &&
    stageSwitchSpec.includes("resourcePeakGrowthByKind") &&
    stageSwitchSpec.includes("warmBaselineResourceLive") &&
    stageSwitchSpec.includes("ownershipSettledMs"),
  "stage resource gates compare identity-aware per-kind ownership at settled same-stage boundaries",
);
for (const stage of ["path", "design", "assembly"]) {
  assert(simulationSpec.includes(`\"${stage}\"`), `simulation audit measures ${stage} playback`);
}
assert(simulationSpec.includes("collectPlaybackAudit") && simulationSpec.includes("forbiddenRuntimeRequests"));
assert(
  highResolutionSpec.includes("deviceScaleFactor: HIGH_RESOLUTION_DEVICE_SCALE_FACTOR") &&
    highResolutionSpec.includes('preset: "balanced"') &&
    highResolutionSpec.includes('preset: "high"') &&
    highResolutionSpec.includes('openSurface(page, "path")') &&
    highResolutionSpec.includes('openSurface(page, "foundry")') &&
    highResolutionSpec.includes("PRESSURE_BUSY_MS = 43") &&
    highResolutionSpec.includes("HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS") &&
    highResolutionSpec.includes("minimumEvidenceMs") &&
    highResolutionSpec.includes("configuredPlaybackMs"),
  "the focused High audit owns fresh DPR2 Balanced/High contexts and the two renderer engines",
);
assert(
  highResolutionSpec.includes("startColdStageProbe") &&
    highResolutionSpec.includes("finishColdStageProbe") &&
    highResolutionSpec.includes("new MutationObserver(record)") &&
    highResolutionSpec.includes("contextCreatedAtMs") &&
    highResolutionSpec.includes("firstGlSubmissionAtMs") &&
    highResolutionSpec.includes("topologyReadyAtMs") &&
    highResolutionSpec.includes("ClassroomExampleVideo-") &&
    highResolutionSpec.includes("buildHighResolutionColdStageEvidence") &&
    highResolutionSpec.includes("installFoundryColdMountProbe") &&
    highResolutionSpec.includes("finishFoundryColdMountProbe") &&
    highResolutionSpec.includes("foundryChildMarkers") &&
    highResolutionSpec.includes("predecessorContextIndices") &&
    highResolutionSpec.includes("resourceDeletionStartIndex"),
  "the High audit causally separates lazy stage commit, progressive Foundry children, predecessor disposal, renderer first GL/topology, and collapsed inspector-example work",
);
assert(
  highResolutionSpec.includes("probe.previewMountedAtMs ?? probe.clickedAtMs ?? requestedAtMs") &&
    foundryColdDiagnosticSpec.includes("markers.threeCanvas?.atMs ??") &&
    foundryColdDiagnosticSpec.includes("markers.threePreview?.atMs ??"),
  "shared renderer history cannot be mistaken for the successor stage's first GL submission while a concurrent transition keeps the predecessor canvas alive",
);
assert(
  highResolutionSpec.includes("startChromebookFoundryCdpTrace") &&
    highResolutionSpec.includes("stopChromebookFoundryCdpTrace") &&
    highResolutionSpec.includes("TRACE_FOUNDRY && ENFORCE") &&
    highResolutionSpec.indexOf("startChromebookFoundryCdpTrace") <
      highResolutionSpec.lastIndexOf('openSurface(page, "foundry")'),
  "optional CDP tracing surrounds only the full-history High Foundry transition and refuses enforcing mode",
);
assert(
  auditHarness.includes("webglResourceDeletions") &&
    auditHarness.includes("webglResourceDeletionBatches") &&
    auditHarness.includes("canvasConnected") &&
    auditHarness.includes("liveBefore") &&
    auditHarness.includes("liveAfter") &&
    auditHarness.includes("stackReturnedAtMs") &&
    highResolutionSpec.includes("predecessorCanvasDetachObservedAtMs") &&
    highResolutionSpec.includes("successor-on-shared-context"),
  "test-only WebGL identity instrumentation times DOM detach, unique resource deletion batches, stack return, and shared-context successor ownership",
);
const highPathReadinessSource = highResolutionSpec.slice(
  highResolutionSpec.indexOf("const openSurface"),
  highResolutionSpec.indexOf("const measureSettledPlayback"),
);
assert(
  highPathReadinessSource.includes(
    'const preview = page.getByTestId("path-three-puppet")',
  ) &&
    highPathReadinessSource.includes(
      'const state = page.getByTestId("path-three-puppet-state")',
    ) &&
    highPathReadinessSource.includes(
      'expect(preview).toHaveAttribute("data-three-renderer-status", "webgl")',
    ) &&
    highPathReadinessSource.includes(
      'expect(state).toHaveAttribute("data-three-topology-ready", "true")',
    ) &&
    !highPathReadinessSource.includes(
      'expect(state).toHaveAttribute("data-three-renderer-status"',
    ),
  "Path High readiness reads renderer ownership from the outer preview and topology ownership from its diagnostics state",
);
const highPlaybackHelperSource = highResolutionSpec.slice(
  highResolutionSpec.indexOf("const measureSettledPlayback"),
  highResolutionSpec.indexOf("const runScenario"),
);
const highWarmPlateauSource = highResolutionSpec.slice(
  highResolutionSpec.indexOf("const readWarmPlateauSample"),
  highResolutionSpec.indexOf("const measureSettledPlayback"),
);
assert(
  highWarmPlateauSource.includes("frameSubmissions.at(-1)?.globalGlIndex") &&
    highWarmPlateauSource.includes("advanceHighResolutionWarmPlateau") &&
    highWarmPlateauSource.includes("resourcesSignature") &&
    highWarmPlateauSource.includes("reactCommits") &&
    highWarmPlateauSource.includes("data-three-part-texture-count") &&
    highWarmPlateauSource.includes("data-three-part-art-count") &&
    highWarmPlateauSource.includes("data-three-renderer-texture-count") &&
    highWarmPlateauSource.includes(
      "data-three-pending-initial-scene-resources",
    ) &&
    highWarmPlateauSource.includes("initialSceneResourcesReady") &&
    !highWarmPlateauSource.includes(
      "rendererTextures >= declaredPartTextures",
    ) &&
    highWarmPlateauSource.includes("measureClickToNextPaint(play)") &&
    highWarmPlateauSource.includes("measureClickToNextPaint(pause)"),
  "High playback warms identity/resource/topology ownership on actual GL frames while retaining control latency",
);
assert(
  highPlaybackHelperSource.includes("surface: HighResolutionSurface") &&
    highPlaybackHelperSource.includes(
      "playbackControlTestIdForSurface(surface)",
    ) &&
    /measureSettledPlayback\(\s*page,\s*"path"/.test(highResolutionSpec) &&
    /measureSettledPlayback\(\s*page,\s*"foundry"/.test(highResolutionSpec) &&
    highResolutionSpec.includes(
      'playbackControlTestIdForSurface("foundry")',
    ) &&
    highResolutionSpec.includes("syntheticPressure"),
  "High audit routes Path to the workspace clock and all Foundry settled/pressure playback to the Foundry clock",
);
assert(
  highResolutionSpec.includes("entry.startTime < foundryEndedAtMs") &&
    highResolutionSpec.includes("entry.startTime + entry.duration > pathStartedAtMs") &&
    highResolutionSpec.includes("partitionScenarioLongTasks") &&
    highResolutionSpec.includes("excludedProbeEntries") &&
    highResolutionSpec.includes("phaseAttribution") &&
    highResolutionSpec.includes("outsideMeasuredPhaseEntries") &&
    highResolutionSpec.includes("rawEntries") &&
    highResolutionSpec.indexOf("const pathStartedAtMs = await openSurface") <
      highResolutionSpec.indexOf("entry.startTime < foundryEndedAtMs"),
  "the scenario gate retains and phase-labels cold/control Long Tasks while excluding only probe-contained work",
);
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
assert(interactionAudit.includes("DIRECT_INTERACTION_P95_MS = 50") && interactionAudit.includes("directInteractionP95"), "drag, orbit, and scrub samples have a distinct 50ms p95 gate");
assert(interactionAudit.includes("DIRECT_VISUAL_SUBMISSION_P95_MS = 50") && interactionAudit.includes("directVisualSubmissionP95"), "Foundry visual-changing moves have a distinct 50ms actual-GL-submission p95 gate");
assert(interactionAudit.includes('"D-move"') && interactionAudit.includes('"M-move"') && interactionAudit.includes('"orbit-move"'), "GL coverage names exactly the three Foundry inputs that change pixels");
const foundryInteractionSource = interactionSpec.slice(
  interactionSpec.indexOf("const auditFoundryGestures"),
  interactionSpec.indexOf("const auditDesignControls"),
);
const foundryBaselineHelperSource = interactionAudit.slice(
  interactionAudit.indexOf("export const waitForFoundryInteractionBaseline"),
  interactionAudit.indexOf("const liveResources"),
);
assert(
  foundryBaselineHelperSource.includes('getByTestId("foundry-toolbar")') &&
    !foundryBaselineHelperSource.includes("workspace-player-dock"),
  "Foundry cold-baseline playback advances the local Foundry simulation rather than the workspace clock",
);
assert(
  foundryInteractionSource.indexOf("await waitForFoundryInteractionBaseline(page)") <
    foundryInteractionSource.indexOf("collectStableFeatureProbe(page, client)") &&
    foundryInteractionSource.indexOf("await waitForFoundryInteractionBaseline(page)") <
      foundryInteractionSource.indexOf("readVisualProbe(page)"),
  "Foundry interaction baselines are sampled only after cold renderer ownership settles",
);
assert(
  interactionAudit.includes("entry.canvas === foundryCanvas") &&
    interactionAudit.includes("globalGlIndex <= state.lastGlobalGlIndex") &&
    interactionAudit.includes("FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES = 3") &&
    interactionAudit.includes("foundryTopologyBuilds > 0") &&
    interactionAudit.includes("foundryGeometryCacheSize") &&
    interactionAudit.includes("foundryMaterialCacheSize") &&
    interactionAudit.includes("structuredClone(state.webgl.resources)"),
  "cold Foundry readiness requires three distinct canvas GL frames with stable identity/resource and topology/cache counters",
);
assert(
  interactionSpec.includes("readCanonicalProjectActionCount") &&
    interactionSpec.includes("measureFoundryPointerMoveToNextPaint") &&
    interactionAudit.includes("foundryCanvasGlStartCount") &&
    interactionAudit.includes("causalGlobalGlIndex"),
  "Foundry commits prove their canonical ProjectState action while visual-changing moves prove canvas-specific causal GL delivery",
);
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
  stageSwitchSpec.indexOf("await openWavingArm(page)") < stageSwitchSpec.indexOf("await applyChromebookEmulation(page, isolationClient)"),
  "the stage audit throttles only measured stage interactions",
);
const featureRunner = read("tests/browser/chromebookFeatureAuditRunner.ts");
assert(featureRunner.includes("chromebook-feature-${report.feature.name}-audit.json"));
assert(featureRunner.includes('"artifacts/chromebook-audit/features"'), "passed feature reports survive Playwright output cleanup");
assert(
  featureRunner.indexOf("await prepare?.(page)") < featureRunner.indexOf("await applyChromebookEmulation(page, client)"),
  "short feature audits prepare the fixture before throttling the measured action",
);
assert(
  featureRunner.indexOf("installChromebookAuditIsolation(page)") < featureRunner.indexOf('page.goto("/"'),
  "feature audits install diagnostic COOP/COEP response headers before navigation",
);
assert(featureRunner.includes('"feature-action"'), "feature reports disclose their throttling scope");
assert(featureRunner.includes('browser.browserType().launch({') && featureRunner.includes('channel: "chrome"') && featureRunner.includes('await auditBrowser.close()'), "each short feature audit owns and closes an isolated branded-Chrome process");
const harness = read("tests/browser/chromebookAuditHarness.ts");
assert(harness.includes("Emulation.setCPUThrottlingRate"));
assert(harness.includes("Network.emulateNetworkConditions"));
assert(harness.includes('type: "longtask"') && harness.includes('type: "event"'));
assert(harness.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__") && harness.includes("resourceMethods"));
assert(harness.includes("AuditedWorker") && harness.includes("trackedBitmaps") && harness.includes("activeObjectUrls"));
assert(harness.includes("webglFrameSubmissions") && harness.includes('frameSource: "webgl-clear-submission"'), "playback intervals come from real GL clear submissions");
assert(
  harness.includes("foundryGestureVisualEmissions") &&
    interactionAudit.includes("audit.foundryGestureVisualEmissions") &&
    interactionAudit.includes("causalSubmission.globalGlIndex"),
  "Foundry move causality starts at the imperative visual-frame emission and ends at the same canvas GL clear",
);
assert(harness.includes("const tracked = new WeakSet<object>()") && harness.includes("!released.has"), "WebGL deletion accounting is identity-aware");
assert(!harness.includes("value < 2_000"), "multi-second stalls remain visible to the frame gate");
assert(harness.includes("measureUserAgentSpecificMemory") && harness.includes("performance-memory-diagnostic"), "memory evidence prefers the standard API and labels Chrome's heap fallback as diagnostic");
const controlledPlaybackSource = harness.slice(
  harness.indexOf("export const collectPlaybackAudit"),
);
assert(
  controlledPlaybackSource.indexOf('measureMemory("baseline", 0)') <
      controlledPlaybackSource.indexOf('findControlButton("Play")?.click()') &&
    controlledPlaybackSource.indexOf('findControlButton("Play")?.click()') <
      controlledPlaybackSource.indexOf("playNextPaintMs = await") &&
    controlledPlaybackSource.indexOf("playNextPaintMs = await") <
      controlledPlaybackSource.indexOf("const before = snapshotWebGL()") &&
    controlledPlaybackSource.indexOf("const end = performance.now()") <
      controlledPlaybackSource.indexOf('findControlButton("Pause")?.click()') &&
    controlledPlaybackSource.indexOf('findControlButton("Pause")?.click()') <
      controlledPlaybackSource.indexOf('measureMemory("tail", 0)'),
  "playback memory is sampled only while paused around one exact controlled renderer window",
);
assert(
  controlledPlaybackSource.includes("resourceDeltaByKind") &&
    controlledPlaybackSource.includes(
      "created: afterCounters.created - beforeCounters.created",
    ) &&
    controlledPlaybackSource.includes(
      "deleted: afterCounters.deleted - beforeCounters.deleted",
    ),
  "steady playback reports per-kind WebGL creation/deletion instead of trusting a net live count",
);
assert(
  controlledPlaybackSource.includes("entry.startTime < end") &&
    controlledPlaybackSource.includes(
      "entry.startTime + entry.duration > start",
    ) &&
    controlledPlaybackSource.includes("syntheticPressure") &&
    controlledPlaybackSource.includes("startedAtMs: start") &&
    controlledPlaybackSource.includes("endedAtMs: end"),
  "Long Tasks and synthetic pressure share the exact playback timing origin",
);
assert(
  [spec, playbackSpec, simulationSpec, highResolutionSpec].every((source) =>
    source.includes("controlsTestId")
  ),
  "production playback callsites let the harness keep baseline and tail memory probes quiescent",
);
assert(!harness.includes("Fetch.continueResponse") && harness.includes("diagnostic-preview-response-headers") && config.includes("MOTIONSMITH_AUDIT_ISOLATION=1"), "the audit uses preview response headers established before navigation instead of ineffective response-stage CDP rewriting");
const viteConfig = read("vite.config.ts");
assert(viteConfig.includes("auditIsolationEnabled") && viteConfig.includes("Cross-Origin-Opener-Policy") && viteConfig.includes("Cross-Origin-Embedder-Policy"), "only the explicit audit preview enables the isolation required by authoritative UA memory measurement");
assert(harness.includes("effectiveRendererDpr") && harness.includes("unmaskedRenderer"), "reports preserve renderer identity and effective drawing-buffer scale");
assert(
  harness.includes('wrapCanvasDimension("width")') &&
    harness.includes('wrapCanvasDimension("height")') &&
    harness.includes("backingStoreMutationProbeSupported") &&
    harness.includes("MAX_RENDERBUFFER_SIZE"),
  "High evidence records every diagnostic canvas allocation and its actual renderbuffer limit",
);
const performanceWorkflow = read(".github/workflows/performance-audit.yml");
assert(performanceWorkflow.includes("regression-4x") && performanceWorkflow.includes("acceptance-6x"), "CI exposes separate regression and acceptance profiles");
assert(performanceWorkflow.includes("chromebookAuditArtifacts.ts prepare") && performanceWorkflow.includes("chromebookAuditArtifacts.ts validate"), "CI empties and validates a run-specific evidence manifest");
assert(performanceWorkflow.includes("CHROMEBOOK_HIGH_RESOLUTION_AUDIT_OUTPUT=${output_root}/high-resolution/chromebook-high-resolution-audit.json"), "CI writes adaptive High evidence into the strict run manifest");
assert(expectedChromebookAuditReports("feature").includes("high-resolution/chromebook-high-resolution-audit.json"), "the strict feature and full manifests require adaptive High evidence");
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
assert(
  puppet.includes("data-testid={testId}") &&
    puppet.includes("data-three-renderer-status={rendererStatus}") &&
    puppet.includes('data-testid={`${testId}-state`') &&
    puppet.includes("dataset.threeTopologyReady"),
  "ThreePuppet production markup preserves separate renderer and topology readiness owners",
);
const workflow = read("tests/browser/workflow.spec.ts");
assert(workflow.includes("clickOptionalButton") && workflow.includes("is visible before its conditional click"));

console.log("Chromebook audit contracts ok");

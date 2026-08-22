import type { ChromebookAuditProvenance } from "./chromebookAuditProvenance";
import {
  CHROMEBOOK_AUDIT_PROFILE,
  type ChromebookAuditEnvironment,
  type ChromebookAuditProfileName,
} from "./chromebookAuditProfiles";

export const CHROMEBOOK_AUDIT_ENVIRONMENT =
  CHROMEBOOK_AUDIT_PROFILE.environment;

export const CHROMEBOOK_ACCEPTANCE_THRESHOLDS = {
  frameP50Ms: 33.3,
  frameP95Ms: 42,
  frameP99Ms: 75,
  framesOver50Percent: 5,
  framesOver200: 0,
  interactionP95Ms: 100,
  tabSwitchP95Ms: 500,
  mainThreadLongTaskMaxMs: 50,
  reactPlaybackCommits: 0,
  heapGrowthRatio: 0.15,
  heapGrowthFloorBytes: 8 * 1024 * 1024,
} as const;

export type Percentiles = { p50: number; p95: number; p99: number };

export type WebGLResourceCounts = Record<
  string,
  { created: number; deleted: number; live: number; peakLive: number }
>;

export type WebGLAuditSnapshot = {
  contextsCreated: number;
  contextsLost: number;
  contextsRestored: number;
  attachedCanvases: number;
  resources: WebGLResourceCounts;
};

export type NetworkRequestRecord = {
  phase: "cold-boot" | "warm-boot" | "workflow";
  method: string;
  resourceType: string;
  url: string;
  status?: number;
  contentLength?: number;
  failed?: string;
};

export type BootAudit = {
  cache: "cold" | "warm";
  wallMs: number;
  domContentLoadedMs: number;
  loadEventMs: number;
  transferBytes: number;
  decodedBytes: number;
  requestCount: number;
  longTaskCount: number;
  longTaskMaxMs: number;
};

export type ActionLatency = {
  label: string;
  kind: "click" | "drag" | "scrub" | "tab";
  durationMs: number;
};

export type AuditInternalMemoryMeasurementWindow = {
  owner: "playback" | "feature-probe";
  phase: "baseline" | "tail" | "stable-probe";
  sampleIndex: number;
  startedAtMs: number;
  endedAtMs: number;
};

export type PlaybackWarmPlateauEvidence = {
  surface: "path" | "foundry";
  requiredStableActualFrames: number;
  stableActualFrames: number;
  startedAtMs: number;
  pausedAtMs: number;
  playNextPaintMs: number;
  pauseNextPaintMs: number;
  firstGlobalGlIndex: number;
  lastGlobalGlIndex: number;
  rendererReady: boolean;
  topologyReady: boolean;
  initialSceneResourcesReady: boolean;
  pendingInitialSceneResources: number | null;
  declaredPartTextures: number;
  rendererTextures: number;
  reactCommits: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  liveResources: number;
  liveResourcesByKind: Record<string, number>;
  resourceCountersByKind: Record<
    string,
    { created: number; deleted: number; live: number }
  >;
  contextsLost: number;
  contextsRestored: number;
};

export type PlaybackAudit = {
  frameSource: "webgl-clear-submission";
  timedWindow: { startedAtMs: number; endedAtMs: number };
  controlActions?: {
    controlsTestId: string;
    playNextPaintMs: number;
    pauseNextPaintMs: number;
  };
  warmPlateau?: PlaybackWarmPlateauEvidence;
  memoryMeasurementWindows: AuditInternalMemoryMeasurementWindow[];
  syntheticPressure?: {
    startedAtMs: number;
    endedAtMs: number;
    timerTaskCount: number;
  };
  durationMs: number;
  frameCount: number;
  frameIntervalMs: Percentiles;
  framesOver50: number;
  framesOver50Percent: number;
  framesOver200: number;
  eventLoopRaf: {
    sampleCount: number;
    intervalMs: Percentiles;
    intervalsOver50: number;
    intervalsOver50Percent: number;
    intervalsOver200: number;
  };
  longTasks: { count: number; totalMs: number; maxMs: number };
  browserEventLatencyMs: Percentiles;
  reactCommits: number;
  heap: {
    supported: boolean;
    diagnosticAvailable: boolean;
    metricSource:
      | "measure-user-agent-specific-memory"
      | "performance-memory-diagnostic"
      | "unsupported";
    authoritative: boolean;
    crossOriginIsolated: boolean;
    userAgentSpecificMemoryError?: string;
    samples: number;
    firstBytes: number;
    lastBytes: number;
    growthBytes: number;
    allowedGrowthBytes: number;
    tailRangeBytes: number;
    stable: boolean;
  };
  webgl: {
    before: WebGLAuditSnapshot;
    after: WebGLAuditSnapshot;
    resourceDeltaByKind: Record<string, {
      created: number;
      deleted: number;
      live: number;
    }>;
    liveResourceDelta: number;
    contextDelta: number;
    contextLossDelta: number;
    contextRestoreDelta: number;
    topologyBuildDelta: number;
    geometryCacheDelta: number;
    materialCacheDelta: number;
  };
};

export type ChromebookDrawingBufferProvenance = {
  canvasIndex: number;
  className: string;
  cssWidth: number;
  cssHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  effectiveDprX: number | null;
  effectiveDprY: number | null;
  maxRenderbufferDimension: number;
  backingStoreHighWaterWidth: number;
  backingStoreHighWaterHeight: number;
  backingStoreHighWaterPixels: number;
};

export type ChromebookGraphicsProvenance = {
  windowDevicePixelRatio: number;
  visualViewportScale: number | null;
  effectiveRendererDpr: number | null;
  contexts: Array<{
    api: "webgl" | "webgl2" | "experimental-webgl";
    vendor: string;
    renderer: string;
    unmaskedVendor: string | null;
    unmaskedRenderer: string | null;
    maxRenderbufferDimension: number;
  }>;
  drawingBuffers: ChromebookDrawingBufferProvenance[];
};

export type ChromebookRuntimeEnvironment = ChromebookAuditEnvironment & {
  browserVersion: string;
  userAgent: string;
  measuredDeviceScaleFactor: number;
  throttlingScope: "navigation-and-action" | "feature-action";
  memoryIsolation: {
    source: "diagnostic-preview-response-headers";
    crossOriginOpenerPolicy: "same-origin";
    crossOriginEmbedderPolicy: "require-corp";
    crossOriginIsolated: boolean;
  };
  graphics: ChromebookGraphicsProvenance;
};

export type AcceptanceCheck = {
  passed: boolean;
  observed: number | boolean;
  limit: number | boolean | string;
};

export type ChromebookAcceptance = Record<string, AcceptanceCheck> & {
  passed: AcceptanceCheck;
};

export type ChromebookAuditReport = {
  schemaVersion: 3;
  generatedAt: string;
  profile: ChromebookAuditProfileName;
  resultLabel: typeof CHROMEBOOK_AUDIT_PROFILE.resultLabel;
  productionBuild: true;
  actualChromebookTested: false;
  provenance: ChromebookAuditProvenance;
  environment: ChromebookRuntimeEnvironment;
  boot: { cold: BootAudit; warm: BootAudit };
  actions: ActionLatency[];
  actionLatencyMs: Percentiles;
  tabSwitchLatencyMs: Percentiles;
  playback: PlaybackAudit;
  networkRequests: NetworkRequestRecord[];
  forbiddenImageRecognitionRequests: string[];
  acceptance: Record<string, AcceptanceCheck> & {
    passed: AcceptanceCheck;
  };
};

export type ChromebookPlaybackAuditReport = {
  schemaVersion: 3;
  generatedAt: string;
  profile: ChromebookAuditProfileName;
  resultLabel: typeof CHROMEBOOK_AUDIT_PROFILE.resultLabel;
  productionBuild: true;
  actualChromebookTested: false;
  provenance: ChromebookAuditProvenance;
  workload:
    | "foundry-playback"
    | "path-playback"
    | "design-playback"
    | "assembly-playback";
  environment: ChromebookRuntimeEnvironment;
  actions: ActionLatency[];
  interactionLatencyMs: Percentiles;
  playback: PlaybackAudit;
  acceptance: Record<string, AcceptanceCheck> & {
    passed: AcceptanceCheck;
  };
};

export const percentile = (values: readonly number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

export const percentiles = (values: readonly number[]): Percentiles => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
});

export const evaluateChromebookPlaybackAcceptance = (
  playback: PlaybackAudit,
  interactionLatencyMs: Percentiles,
): ChromebookAcceptance => {
  const limit = CHROMEBOOK_ACCEPTANCE_THRESHOLDS;
  const resourceChurn = Object.values(playback.webgl.resourceDeltaByKind)
    .reduce(
      (sum, delta) => sum + Math.abs(delta.created) + Math.abs(delta.deleted),
      0,
    );
  const checks: Record<string, AcceptanceCheck> = {
    actualRenderTelemetry: { passed: playback.frameSource === "webgl-clear-submission", observed: playback.frameSource === "webgl-clear-submission", limit: true },
    renderSubmissionsObserved: { passed: playback.frameCount >= 2, observed: playback.frameCount, limit: ">=2" },
    frameP50: { passed: playback.frameIntervalMs.p50 <= limit.frameP50Ms, observed: playback.frameIntervalMs.p50, limit: limit.frameP50Ms },
    frameP95: { passed: playback.frameIntervalMs.p95 <= limit.frameP95Ms, observed: playback.frameIntervalMs.p95, limit: limit.frameP95Ms },
    frameP99: { passed: playback.frameIntervalMs.p99 <= limit.frameP99Ms, observed: playback.frameIntervalMs.p99, limit: limit.frameP99Ms },
    framesOver50: { passed: playback.framesOver50Percent <= limit.framesOver50Percent, observed: playback.framesOver50Percent, limit: limit.framesOver50Percent },
    framesOver200: { passed: playback.framesOver200 <= limit.framesOver200, observed: playback.framesOver200, limit: limit.framesOver200 },
    mainThreadLongTaskMax: { passed: playback.longTasks.maxMs <= limit.mainThreadLongTaskMaxMs, observed: playback.longTasks.maxMs, limit: limit.mainThreadLongTaskMaxMs },
    interactionLatency: { passed: interactionLatencyMs.p95 <= limit.interactionP95Ms, observed: interactionLatencyMs.p95, limit: limit.interactionP95Ms },
    heapSupported: { passed: playback.heap.supported, observed: playback.heap.supported, limit: true },
    memoryAuthoritative: {
      passed:
        !CHROMEBOOK_AUDIT_PROFILE.officialAcceptance ||
        playback.heap.authoritative,
      observed: playback.heap.authoritative,
      limit: CHROMEBOOK_AUDIT_PROFILE.officialAcceptance
        ? true
        : "diagnostic fallback allowed for regression",
    },
    heapStable: { passed: playback.heap.supported && playback.heap.stable, observed: playback.heap.stable, limit: true },
    reactPlaybackCommits: { passed: playback.reactCommits <= limit.reactPlaybackCommits, observed: playback.reactCommits, limit: limit.reactPlaybackCommits },
    webglResourcesStable: { passed: playback.webgl.liveResourceDelta <= 0, observed: playback.webgl.liveResourceDelta, limit: 0 },
    webglResourceChurnAbsent: { passed: resourceChurn === 0, observed: resourceChurn, limit: 0 },
    webglContextsStable: { passed: playback.webgl.contextDelta <= 0, observed: playback.webgl.contextDelta, limit: 0 },
    webglContextLossAbsent: { passed: playback.webgl.contextLossDelta === 0, observed: playback.webgl.contextLossDelta, limit: 0 },
    webglContextRestorationAbsent: { passed: playback.webgl.contextRestoreDelta === 0, observed: playback.webgl.contextRestoreDelta, limit: 0 },
    geometryCacheStable: { passed: playback.webgl.geometryCacheDelta <= 0, observed: playback.webgl.geometryCacheDelta, limit: 0 },
    materialCacheStable: { passed: playback.webgl.materialCacheDelta <= 0, observed: playback.webgl.materialCacheDelta, limit: 0 },
    persistentTopology: { passed: playback.webgl.topologyBuildDelta <= 0, observed: playback.webgl.topologyBuildDelta, limit: 0 },
  };
  const passed = Object.values(checks).every((check) => check.passed);
  return { ...checks, passed: { passed, observed: passed, limit: true } };
};

export const evaluateChromebookAcceptance = (
  playback: PlaybackAudit,
  actionLatencyMs: Percentiles,
  tabSwitchLatencyMs: Percentiles,
  forbiddenImageRecognitionRequestCount: number,
  boot?: { cold: BootAudit; warm: BootAudit },
): ChromebookAcceptance => {
  const playbackAcceptance = evaluateChromebookPlaybackAcceptance(
    playback,
    actionLatencyMs,
  );
  const { passed: _playbackPassed, ...playbackChecks } = playbackAcceptance;
  const limit = CHROMEBOOK_ACCEPTANCE_THRESHOLDS;
  const checks: Record<string, AcceptanceCheck> = {
    ...playbackChecks,
    tabSwitchLatency: { passed: tabSwitchLatencyMs.p95 <= limit.tabSwitchP95Ms, observed: tabSwitchLatencyMs.p95, limit: limit.tabSwitchP95Ms },
    imageRecognitionAbsent: {
      passed: forbiddenImageRecognitionRequestCount === 0,
      observed: forbiddenImageRecognitionRequestCount,
      limit: 0,
    },
    ...(boot ? {
      coldBootLongTaskMax: {
        passed:
          boot.cold.longTaskMaxMs <= limit.mainThreadLongTaskMaxMs,
        observed: boot.cold.longTaskMaxMs,
        limit: limit.mainThreadLongTaskMaxMs,
      },
      warmBootLongTaskMax: {
        passed:
          boot.warm.longTaskMaxMs <= limit.mainThreadLongTaskMaxMs,
        observed: boot.warm.longTaskMaxMs,
        limit: limit.mainThreadLongTaskMaxMs,
      },
    } : {}),
  };
  const passed = Object.values(checks).every((check) => check.passed);
  return { ...checks, passed: { passed, observed: passed, limit: true } };
};

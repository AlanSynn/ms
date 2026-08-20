export const CHROMEBOOK_AUDIT_ENVIRONMENT = {
  browser: "chrome",
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
  cpuThrottlingRate: 6,
  network: {
    name: "bounded-classroom-wifi",
    latencyMs: 40,
    downloadBytesPerSecond: 1_310_720,
    uploadBytesPerSecond: 655_360,
  },
} as const;

export const CHROMEBOOK_ACCEPTANCE_THRESHOLDS = {
  frameP50Ms: 33.3,
  frameP95Ms: 42,
  frameP99Ms: 75,
  framesOver50Percent: 5,
  framesOver200: 0,
  interactionP95Ms: 100,
  tabSwitchP95Ms: 500,
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

export type PlaybackAudit = {
  durationMs: number;
  frameCount: number;
  frameIntervalMs: Percentiles;
  framesOver50: number;
  framesOver50Percent: number;
  framesOver200: number;
  longTasks: { count: number; totalMs: number; maxMs: number };
  browserEventLatencyMs: Percentiles;
  reactCommits: number;
  heap: {
    supported: boolean;
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
    liveResourceDelta: number;
    contextDelta: number;
    topologyBuildDelta: number;
    geometryCacheDelta: number;
    materialCacheDelta: number;
  };
};

export type AcceptanceCheck = {
  passed: boolean;
  observed: number | boolean;
  limit: number | boolean | string;
};

export type ChromebookAuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  resultLabel: "6x CPU emulation";
  productionBuild: true;
  actualChromebookTested: false;
  environment: typeof CHROMEBOOK_AUDIT_ENVIRONMENT & {
    browserVersion: string;
    userAgent: string;
    measuredDeviceScaleFactor: number;
  };
  boot: { cold: BootAudit; warm: BootAudit };
  actions: ActionLatency[];
  actionLatencyMs: Percentiles;
  tabSwitchLatencyMs: Percentiles;
  playback: PlaybackAudit;
  networkRequests: NetworkRequestRecord[];
  bootAiRequests: string[];
  acceptance: Record<string, AcceptanceCheck> & {
    passed: AcceptanceCheck;
  };
};

export type ChromebookPlaybackAuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  resultLabel: "6x CPU emulation";
  productionBuild: true;
  actualChromebookTested: false;
  workload: "foundry-playback";
  environment: typeof CHROMEBOOK_AUDIT_ENVIRONMENT & {
    browserVersion: string;
    userAgent: string;
    measuredDeviceScaleFactor: number;
    throttlingScope: "feature-action";
  };
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
) => {
  const limit = CHROMEBOOK_ACCEPTANCE_THRESHOLDS;
  const checks: Record<string, AcceptanceCheck> = {
    frameP50: { passed: playback.frameIntervalMs.p50 <= limit.frameP50Ms, observed: playback.frameIntervalMs.p50, limit: limit.frameP50Ms },
    frameP95: { passed: playback.frameIntervalMs.p95 <= limit.frameP95Ms, observed: playback.frameIntervalMs.p95, limit: limit.frameP95Ms },
    frameP99: { passed: playback.frameIntervalMs.p99 <= limit.frameP99Ms, observed: playback.frameIntervalMs.p99, limit: limit.frameP99Ms },
    framesOver50: { passed: playback.framesOver50Percent <= limit.framesOver50Percent, observed: playback.framesOver50Percent, limit: limit.framesOver50Percent },
    framesOver200: { passed: playback.framesOver200 <= limit.framesOver200, observed: playback.framesOver200, limit: limit.framesOver200 },
    interactionLatency: { passed: interactionLatencyMs.p95 <= limit.interactionP95Ms, observed: interactionLatencyMs.p95, limit: limit.interactionP95Ms },
    heapStable: { passed: playback.heap.stable, observed: playback.heap.stable, limit: true },
    reactPlaybackCommits: { passed: playback.reactCommits <= limit.reactPlaybackCommits, observed: playback.reactCommits, limit: limit.reactPlaybackCommits },
    webglResourcesStable: { passed: playback.webgl.liveResourceDelta <= 0, observed: playback.webgl.liveResourceDelta, limit: 0 },
    webglContextsStable: { passed: playback.webgl.contextDelta <= 0, observed: playback.webgl.contextDelta, limit: 0 },
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
  bootAiRequestCount: number,
) => {
  const playbackAcceptance = evaluateChromebookPlaybackAcceptance(
    playback,
    actionLatencyMs,
  );
  const { passed: _playbackPassed, ...playbackChecks } = playbackAcceptance;
  const limit = CHROMEBOOK_ACCEPTANCE_THRESHOLDS;
  const checks: Record<string, AcceptanceCheck> = {
    ...playbackChecks,
    tabSwitchLatency: { passed: tabSwitchLatencyMs.p95 <= limit.tabSwitchP95Ms, observed: tabSwitchLatencyMs.p95, limit: limit.tabSwitchP95Ms },
    aiBootOptIn: { passed: bootAiRequestCount === 0, observed: bootAiRequestCount, limit: 0 },
  };
  const passed = Object.values(checks).every((check) => check.passed);
  return { ...checks, passed: { passed, observed: passed, limit: true } };
};

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  percentiles,
  type AcceptanceCheck,
  type Percentiles,
} from "./chromebookAuditReport";

export const CHROMEBOOK_FEATURE_NAMES = [
  "recommend",
  "designFit",
  "traceGif",
  "pathGestures",
  "foundryGestures",
  "designControls",
  "projectImport",
  "characterPackageImport",
] as const;

export type ChromebookFeatureName = (typeof CHROMEBOOK_FEATURE_NAMES)[number];

export const CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS = {
  nextPaintP95Ms: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
  mainThreadLongTaskP95Ms: 50,
  heapGrowthRatio: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
  heapGrowthFloorBytes: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
} as const;

export type RuntimeResourceCounter = {
  acquired: number;
  released: number;
  active: number;
  peakActive: number;
};

export type RuntimeLifecycleSnapshot = {
  probeSupport: {
    workers: boolean;
    imageBitmaps: boolean;
    objectUrls: boolean;
  };
  workers: RuntimeResourceCounter;
  imageBitmaps: RuntimeResourceCounter;
  objectUrls: RuntimeResourceCounter;
};

export type FeatureRuntimeProbe = {
  atMs: number;
  heapBytes?: number;
  heapSamplesBytes?: number[];
  longTaskCount: number;
  puppetTopologyCount: number;
  lifecycle: RuntimeLifecycleSnapshot;
};

export type FeatureActionAudit = {
  label: string;
  cycle: number;
  outcome: "completed" | "cancelled";
  nextPaintMs: number;
  settleMs: number;
  jobCompletionMs?: number;
  longTasks: {
    durationsMs: number[];
    latencyMs: Percentiles;
    totalMs: number;
    maxMs: number;
  };
  puppetTopologyDurationsMs: number[];
  before: FeatureRuntimeProbe;
  after: FeatureRuntimeProbe;
};

export type FeatureLifecycleRequirements = {
  minimumWorkerCreations: number;
  minimumImageBitmapAcquisitions?: number;
  minimumObjectUrlCreations?: number;
  requireCompletedCycle?: boolean;
  requireCancelledCycle?: boolean;
};

export type FeatureAudit = {
  name: ChromebookFeatureName;
  actions: FeatureActionAudit[];
  nextPaintLatencyMs: Percentiles;
  jobCompletionLatencyMs: Percentiles;
  settleLatencyMs: Percentiles;
  mainThreadLongTaskLatencyMs: Percentiles;
  lifecycle: {
    baseline: RuntimeLifecycleSnapshot;
    final: RuntimeLifecycleSnapshot;
    workerCreations: number;
    imageBitmapAcquisitions: number;
    objectUrlCreations: number;
  };
  heap: {
    supported: boolean;
    baselineBytes: number;
    finalBytes: number;
    growthBytes: number;
    allowedGrowthBytes: number;
    finalSamplesBytes: number[];
    tailRangeBytes: number;
    stable: boolean;
  };
  acceptance: Record<string, AcceptanceCheck> & {
    passed: AcceptanceCheck;
  };
};

export type ChromebookFeatureAuditReport = {
  schemaVersion: 1;
  generatedAt: string;
  resultLabel: "6x CPU emulation";
  productionBuild: true;
  actualChromebookTested: false;
  runtimeProbe: "browser-api-ownership-v1";
  workload: "production-feature" | "production-interaction";
  environment: {
    browser: "chrome";
    browserVersion: string;
    userAgent: string;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    cpuThrottlingRate: number;
    throttlingScope: "feature-action";
    network: {
      name: string;
      latencyMs: number;
      downloadBytesPerSecond: number;
      uploadBytesPerSecond: number;
    };
  };
  feature: FeatureAudit;
  acceptance: {
    passed: AcceptanceCheck;
  };
};

const counterDelta = (
  before: RuntimeLifecycleSnapshot,
  after: RuntimeLifecycleSnapshot,
  key: "workers" | "imageBitmaps" | "objectUrls",
) => after[key].acquired - before[key].acquired;

const returnedToBaseline = (
  before: RuntimeLifecycleSnapshot,
  after: RuntimeLifecycleSnapshot,
  key: "workers" | "imageBitmaps" | "objectUrls",
) => after[key].active === before[key].active;

export const buildChromebookFeatureAudit = (
  name: ChromebookFeatureName,
  actions: FeatureActionAudit[],
  baseline: FeatureRuntimeProbe,
  final: FeatureRuntimeProbe,
  requirements: FeatureLifecycleRequirements,
): FeatureAudit => {
  const thresholds = CHROMEBOOK_FEATURE_ACCEPTANCE_THRESHOLDS;
  const nextPaintLatencyMs = percentiles(actions.map((action) => action.nextPaintMs));
  const completed = actions.filter((action) => action.outcome === "completed");
  const cancelled = actions.filter((action) => action.outcome === "cancelled");
  const jobCompletionLatencyMs = percentiles(
    completed.flatMap((action) =>
      action.jobCompletionMs === undefined ? [] : [action.jobCompletionMs],
    ),
  );
  const settleLatencyMs = percentiles(actions.map((action) => action.settleMs));
  const longTasks = actions.flatMap((action) => action.longTasks.durationsMs);
  const mainThreadLongTaskLatencyMs = percentiles(longTasks);
  const workerCreations = counterDelta(
    baseline.lifecycle,
    final.lifecycle,
    "workers",
  );
  const imageBitmapAcquisitions = counterDelta(
    baseline.lifecycle,
    final.lifecycle,
    "imageBitmaps",
  );
  const objectUrlCreations = counterDelta(
    baseline.lifecycle,
    final.lifecycle,
    "objectUrls",
  );
  const heapSupported =
    baseline.heapBytes !== undefined && final.heapBytes !== undefined;
  const baselineBytes = baseline.heapBytes ?? 0;
  const finalBytes = final.heapBytes ?? baselineBytes;
  const growthBytes = finalBytes - baselineBytes;
  const allowedGrowthBytes = Math.max(
    thresholds.heapGrowthFloorBytes,
    baselineBytes * thresholds.heapGrowthRatio,
  );
  const finalSamplesBytes = final.heapSamplesBytes ?? [];
  const tailRangeBytes = finalSamplesBytes.length
    ? Math.max(...finalSamplesBytes) - Math.min(...finalSamplesBytes)
    : 0;
  const heapStable =
    !heapSupported ||
    (finalSamplesBytes.length >= 3 && tailRangeBytes <= allowedGrowthBytes);
  const checks: Record<string, AcceptanceCheck> = {
    nextPaintP95: {
      passed: actions.length > 0 && nextPaintLatencyMs.p95 <= thresholds.nextPaintP95Ms,
      observed: nextPaintLatencyMs.p95,
      limit: thresholds.nextPaintP95Ms,
    },
    mainThreadLongTaskP95: {
      passed: mainThreadLongTaskLatencyMs.p95 <= thresholds.mainThreadLongTaskP95Ms,
      observed: mainThreadLongTaskLatencyMs.p95,
      limit: thresholds.mainThreadLongTaskP95Ms,
    },
    workerProbeSupported: {
      passed: baseline.lifecycle.probeSupport.workers,
      observed: baseline.lifecycle.probeSupport.workers,
      limit: true,
    },
    imageBitmapProbeSupported: {
      passed: baseline.lifecycle.probeSupport.imageBitmaps,
      observed: baseline.lifecycle.probeSupport.imageBitmaps,
      limit: true,
    },
    objectUrlProbeSupported: {
      passed: baseline.lifecycle.probeSupport.objectUrls,
      observed: baseline.lifecycle.probeSupport.objectUrls,
      limit: true,
    },
    workersReturnedToBaseline: {
      passed: returnedToBaseline(
        baseline.lifecycle,
        final.lifecycle,
        "workers",
      ),
      observed: final.lifecycle.workers.active - baseline.lifecycle.workers.active,
      limit: 0,
    },
    imageBitmapsReturnedToBaseline: {
      passed: returnedToBaseline(
        baseline.lifecycle,
        final.lifecycle,
        "imageBitmaps",
      ),
      observed:
        final.lifecycle.imageBitmaps.active - baseline.lifecycle.imageBitmaps.active,
      limit: 0,
    },
    objectUrlsReturnedToBaseline: {
      passed: returnedToBaseline(
        baseline.lifecycle,
        final.lifecycle,
        "objectUrls",
      ),
      observed: final.lifecycle.objectUrls.active - baseline.lifecycle.objectUrls.active,
      limit: 0,
    },
    workerCyclesExercised: {
      passed: workerCreations >= requirements.minimumWorkerCreations,
      observed: workerCreations,
      limit: `>=${requirements.minimumWorkerCreations}`,
    },
    imageBitmapOwnershipExercised: {
      passed:
        imageBitmapAcquisitions >=
        (requirements.minimumImageBitmapAcquisitions ?? 0),
      observed: imageBitmapAcquisitions,
      limit: `>=${requirements.minimumImageBitmapAcquisitions ?? 0}`,
    },
    objectUrlOwnershipExercised: {
      passed:
        objectUrlCreations >= (requirements.minimumObjectUrlCreations ?? 0),
      observed: objectUrlCreations,
      limit: `>=${requirements.minimumObjectUrlCreations ?? 0}`,
    },
    completedCycle: {
      passed: !requirements.requireCompletedCycle || completed.length > 0,
      observed: completed.length,
      limit: requirements.requireCompletedCycle ? ">=1" : ">=0",
    },
    cancelledCycle: {
      passed: !requirements.requireCancelledCycle || cancelled.length > 0,
      observed: cancelled.length,
      limit: requirements.requireCancelledCycle ? ">=1" : ">=0",
    },
    heapBounded: {
      passed: !heapSupported || growthBytes <= allowedGrowthBytes,
      observed: growthBytes,
      limit: heapSupported ? allowedGrowthBytes : "unsupported-recorded",
    },
    heapStable: {
      passed: heapStable,
      observed: tailRangeBytes,
      limit: heapSupported ? allowedGrowthBytes : "unsupported-recorded",
    },
  };
  const passed = Object.values(checks).every((check) => check.passed);
  return {
    name,
    actions,
    nextPaintLatencyMs,
    jobCompletionLatencyMs,
    settleLatencyMs,
    mainThreadLongTaskLatencyMs,
    lifecycle: {
      baseline: baseline.lifecycle,
      final: final.lifecycle,
      workerCreations,
      imageBitmapAcquisitions,
      objectUrlCreations,
    },
    heap: {
      supported: heapSupported,
      baselineBytes,
      finalBytes,
      growthBytes,
      allowedGrowthBytes,
      finalSamplesBytes,
      tailRangeBytes,
      stable: heapStable,
    },
    acceptance: {
      ...checks,
      passed: { passed, observed: passed, limit: true },
    },
  };
};

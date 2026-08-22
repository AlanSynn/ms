import { RENDER_VIEWPORT_PIXEL_BUDGET } from "../../utils/renderPerformancePolicy";
import {
  HIGH_RESOLUTION_ADAPTATION_RULES,
  HIGH_RESOLUTION_SCALE_LADDER,
} from "../../runtime/render/adaptiveHighResolutionController";
import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  percentiles,
  type AcceptanceCheck,
  type AuditInternalMemoryMeasurementWindow,
  type ChromebookAcceptance,
  type ChromebookRuntimeEnvironment,
  type PlaybackAudit,
} from "./chromebookAuditReport";
import type { ChromebookAuditProvenance } from "./chromebookAuditProvenance";
import type { ChromebookAuditProfile } from "./chromebookAuditProfiles";
import type {
  ChromebookHighResolutionTelemetry,
  ChromebookWebGLResourceDeletion,
  ChromebookWebGLResourceDeletionBatch,
} from "./chromebookAuditHarness";
import {
  attributeFoundryColdLongTasks,
  type FoundryColdLongTask,
  type FoundryColdMountMarkers,
} from "./chromebookFoundryColdDiagnostic";

export const HIGH_RESOLUTION_DEVICE_SCALE_FACTOR = 2 as const;
export const HIGH_RESOLUTION_BALANCED_DPR = 0.5;
export const HIGH_RESOLUTION_SAFE_START_DPR = 1;
export const HIGH_RESOLUTION_NATIVE_DPR = 2;
export const HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL = 12;
export const HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES = 1024 * 1024;
export const HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES = 3;

export type HighResolutionWarmPlateauSample = {
  globalGlIndex: number;
  rendererReady: boolean;
  topologyReady: boolean;
  initialSceneResourcesReady: boolean;
  pendingInitialSceneResources: number | null;
  declaredPartTextures: number;
  rendererTextures: number;
  contextIndex: number;
  canvasCount: number;
  contextsCreated: number;
  contextsLost: number;
  contextsRestored: number;
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
  liveResourcesSignature: string;
  resourcesSignature: string;
};

export type HighResolutionWarmPlateauState = {
  firstGlobalGlIndex: number;
  lastGlobalGlIndex: number;
  stableSignature: string | null;
  stableActualFrames: number;
};

export const initialHighResolutionWarmPlateauState = ():
  HighResolutionWarmPlateauState => ({
    firstGlobalGlIndex: -1,
    lastGlobalGlIndex: -1,
    stableSignature: null,
    stableActualFrames: 0,
  });

const warmPlateauSignature = (sample: HighResolutionWarmPlateauSample) =>
  JSON.stringify({
    contextIndex: sample.contextIndex,
    canvasCount: sample.canvasCount,
    contextsCreated: sample.contextsCreated,
    contextsLost: sample.contextsLost,
    contextsRestored: sample.contextsRestored,
    initialSceneResourcesReady: sample.initialSceneResourcesReady,
    pendingInitialSceneResources: sample.pendingInitialSceneResources,
    declaredPartTextures: sample.declaredPartTextures,
    rendererTextures: sample.rendererTextures,
    reactCommits: sample.reactCommits,
    foundryTopologyBuilds: sample.foundryTopologyBuilds,
    foundryGeometryCacheSize: sample.foundryGeometryCacheSize,
    foundryMaterialCacheSize: sample.foundryMaterialCacheSize,
    liveResources: sample.liveResources,
    liveResourcesByKind: sample.liveResourcesByKind,
    resourceCountersByKind: sample.resourceCountersByKind,
    liveResourcesSignature: sample.liveResourcesSignature,
    resourcesSignature: sample.resourcesSignature,
  });

export const advanceHighResolutionWarmPlateau = (
  state: HighResolutionWarmPlateauState,
  sample: HighResolutionWarmPlateauSample,
): HighResolutionWarmPlateauState => {
  if (sample.globalGlIndex <= state.lastGlobalGlIndex) return state;
  if (
    !sample.rendererReady ||
    !sample.topologyReady ||
    !sample.initialSceneResourcesReady
  ) {
    return {
      firstGlobalGlIndex: -1,
      lastGlobalGlIndex: sample.globalGlIndex,
      stableSignature: null,
      stableActualFrames: 0,
    };
  }
  const stableSignature = warmPlateauSignature(sample);
  const unchanged = stableSignature === state.stableSignature;
  return {
    firstGlobalGlIndex: unchanged
      ? state.firstGlobalGlIndex
      : sample.globalGlIndex,
    lastGlobalGlIndex: sample.globalGlIndex,
    stableSignature,
    stableActualFrames: unchanged ? state.stableActualFrames + 1 : 1,
  };
};

const safeStartIndex = HIGH_RESOLUTION_SCALE_LADDER.indexOf(
  HIGH_RESOLUTION_SAFE_START_DPR,
);
const nativeDprIndex = HIGH_RESOLUTION_SCALE_LADDER.indexOf(
  HIGH_RESOLUTION_NATIVE_DPR,
);

if (safeStartIndex < 0 || nativeDprIndex <= safeStartIndex) {
  throw new Error("High-resolution audit cannot derive the native-DPR promotion path");
}

export const HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS =
  nativeDprIndex - safeStartIndex;
export const HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS =
  HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowSize *
  HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowsPerUpshift *
  HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS;

// A 120-interval window may contain six intervals above the p95 boundary, but
// every interval must remain at or below the controller's 50ms good-frame cap.
// Derive the slowest qualifying window so the audit cannot expire before a
// conforming controller has enough evidence to climb 1 -> 1.25 -> 1.5 -> 2.
const goodIntervalsAtP95 = Math.ceil(
  HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowSize * 0.95,
);
const slowestGoodWindowMs =
  goodIntervalsAtP95 * HIGH_RESOLUTION_ADAPTATION_RULES.goodP95MaxMs +
  (HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowSize - goodIntervalsAtP95) *
    HIGH_RESOLUTION_ADAPTATION_RULES.goodIntervalMaxMs;
const slowestUpshiftEvidenceMs = Math.max(
  slowestGoodWindowMs *
    HIGH_RESOLUTION_ADAPTATION_RULES.goodWindowsPerUpshift,
  HIGH_RESOLUTION_ADAPTATION_RULES.upshiftCooldownMs,
);
export const HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS = Math.ceil(
  slowestUpshiftEvidenceMs * HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS,
);
export const HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS =
  Math.ceil(HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS / 1_000) * 1_000 +
  1_000;

export type HighResolutionSurface = "path" | "foundry";

export const playbackControlTestIdForSurface = (
  surface: HighResolutionSurface,
) => surface === "path" ? "workspace-player-dock" : "foundry-toolbar";

export type HighResolutionDprSample = {
  globalGlIndex: number;
  atMs: number;
  contextIndex: number;
  className: string;
  requestedDprCap: number | null;
  effectiveDpr: number | null;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  drawingBufferPixels: number;
  maxRenderbufferDimension: number;
};

export type HighResolutionBackingStoreSample = {
  atMs: number;
  contextIndex: number;
  changedDimension: "initial" | "width" | "height" | "submission";
  className: string;
  width: number;
  height: number;
  pixels: number;
  maxRenderbufferDimension: number;
};

export type HighResolutionSurfaceEvidence = {
  surface: HighResolutionSurface;
  startedAtMs: number;
  endedAtMs: number;
  submissionCount: number;
  submissionHistory: HighResolutionDprSample[];
  dprHistory: HighResolutionDprSample[];
  backingStoreHistory: HighResolutionBackingStoreSample[];
  highWaterPixels: number;
  playback?: PlaybackAudit;
  playbackAcceptance?: ChromebookAcceptance;
  promotion?: {
    playback: PlaybackAudit;
    playbackAcceptance: ChromebookAcceptance;
    allocation: {
      initialPixels: number;
      finalPixels: number;
      deltaPixels: number;
      observedGrowthBytes: number;
      bytesPerPixelBudget: typeof HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL;
      fixedOverheadBytes: typeof HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES;
      allowedGrowthBytes: number;
      bounded: boolean;
      nearFourMegapixelMemoryUnproven: true;
    };
  };
};

export type HighResolutionLongTaskEntry = {
  startTime: number;
  duration: number;
};

export type HighResolutionColdStageScriptResource = {
  name: string;
  role:
    | "stage-adapter"
    | "renderer"
    | "inspector-example"
    | "motion-dependency"
    | "other-script";
  startTime: number;
  responseEnd: number;
  duration: number;
  transferSize: number;
  decodedBodySize: number;
  loadedBeforeClick: boolean;
};

export type HighResolutionColdStageProbe = {
  surface: HighResolutionSurface;
  requestedAtMs: number;
  clickedAtMs: number | null;
  transitionFrameAtMs: number | null;
  stageContentAtMs: number | null;
  inspectorMountedAtMs: number | null;
  exampleMountedAtMs: number | null;
  previewLoadingAtMs: number | null;
  previewMountedAtMs: number | null;
  contextCreatedAtMs: number | null;
  rendererWebglAtMs: number | null;
  firstGlSubmissionAtMs: number | null;
  topologyReadyAtMs: number | null;
  initialSceneResourcesReadyAtMs: number | null;
  completedAtMs: number;
  scriptResources: HighResolutionColdStageScriptResource[];
  foundryChildMarkers: FoundryColdMountMarkers | null;
  predecessorResourceDisposal: {
    predecessorSurface: "character" | "path";
    contextIndices: number[];
    canvasClassNameAtStart: string | null;
    canvasDetachObservedAtMs: number | null;
    deletions: Array<ChromebookWebGLResourceDeletion & {
      ownership: "predecessor-canvas" | "successor-on-shared-context";
    }>;
    batches: Array<ChromebookWebGLResourceDeletionBatch & {
      ownership: "predecessor-canvas" | "successor-on-shared-context";
    }>;
  };
};

export type HighResolutionColdStageEvidence = HighResolutionColdStageProbe & {
  phaseWindows: HighResolutionMeasuredPhaseWindow[];
  longTaskAttribution: Array<HighResolutionLongTaskEntry & {
    phaseLabels: string[];
    predecessorResourceDeletions: ChromebookWebGLResourceDeletion[];
    overlapsPredecessorTeardown: boolean;
  }>;
  foundryChildLongTaskAttribution: FoundryColdLongTask[];
  predecessorTeardownTiming: {
    canvasDetachObservedAtMs: number | null;
    firstDeletionAtMs: number | null;
    lastDeletionAtMs: number | null;
    cleanupStackReturnedAtMs: number | null;
    detachObservationToFirstDeletionMs: number | null;
    deletionIssueDurationMs: number | null;
    lastDeletionToStackReturnMs: number | null;
    firstDeletionToStackReturnMs: number | null;
  };
  unattributedLongTasks: HighResolutionLongTaskEntry[];
  markersComplete: boolean;
  inspectorExampleDeferred: boolean;
};

const finiteMark = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

export const sharedRendererContextPredatesStageClick = (
  contextCreatedAtMs: number | null,
  clickedAtMs: number | null,
) => finiteMark(contextCreatedAtMs) &&
  finiteMark(clickedAtMs) &&
  contextCreatedAtMs <= clickedAtMs;

export const buildHighResolutionColdStageEvidence = (
  probe: HighResolutionColdStageProbe,
  entries: readonly HighResolutionLongTaskEntry[],
): HighResolutionColdStageEvidence => {
  const phases: HighResolutionMeasuredPhaseWindow[] = [];
  const addPhase = (
    label: string,
    startedAtMs: number | null,
    endedAtMs: number | null,
  ) => {
    if (
      finiteMark(startedAtMs) &&
      finiteMark(endedAtMs) &&
      endedAtMs > startedAtMs
    ) {
      phases.push({ label, startedAtMs, endedAtMs });
    }
  };
  const click = probe.clickedAtMs;
  const stage = probe.stageContentAtMs;
  const stageAdapterResponseEnd = probe.scriptResources
    .filter((resource) =>
      resource.role === "stage-adapter" &&
      finiteMark(click) &&
      resource.responseEnd > click &&
      (!finiteMark(stage) || resource.responseEnd <= stage)
    )
    .reduce<number | null>(
      (latest, resource) => Math.max(latest ?? -Infinity, resource.responseEnd),
      null,
    );
  if (stageAdapterResponseEnd !== null) {
    addPhase(`${probe.surface}:stage-adapter-fetch`, click, stageAdapterResponseEnd);
    addPhase(
      `${probe.surface}:stage-adapter-eval-and-commit`,
      stageAdapterResponseEnd,
      stage,
    );
  } else {
    addPhase(`${probe.surface}:preloaded-stage-commit`, click, stage);
  }
  addPhase(
    `${probe.surface}:inspector-mount`,
    stage,
    probe.inspectorMountedAtMs,
  );
  addPhase(
    `${probe.surface}:renderer-module-and-mount`,
    stage,
    probe.previewMountedAtMs,
  );
  const contextBoundary = finiteMark(probe.contextCreatedAtMs) &&
      finiteMark(probe.previewMountedAtMs) &&
      finiteMark(probe.firstGlSubmissionAtMs) &&
      probe.contextCreatedAtMs >= probe.previewMountedAtMs &&
      probe.contextCreatedAtMs <= probe.firstGlSubmissionAtMs
    ? probe.contextCreatedAtMs
    : probe.previewMountedAtMs;
  addPhase(
    `${probe.surface}:renderer-context-acquisition`,
    probe.previewMountedAtMs,
    contextBoundary,
  );
  addPhase(
    `${probe.surface}:renderer-init-before-first-gl`,
    contextBoundary,
    probe.firstGlSubmissionAtMs,
  );
  addPhase(
    `${probe.surface}:first-gl-compile-and-topology`,
    probe.firstGlSubmissionAtMs,
    probe.topologyReadyAtMs,
  );
  addPhase(
    `${probe.surface}:initial-scene-resource-drain`,
    probe.topologyReadyAtMs,
    probe.initialSceneResourcesReadyAtMs,
  );
  addPhase(
    `${probe.surface}:readiness-settle`,
    probe.initialSceneResourcesReadyAtMs,
    probe.completedAtMs,
  );
  const clickedAtMs = probe.clickedAtMs ?? probe.requestedAtMs;
  const coldLongTasks = entries.filter((entry) =>
    entry.startTime < probe.completedAtMs &&
    entry.startTime + entry.duration > clickedAtMs
  );
  const predecessorDeletions = probe.predecessorResourceDisposal.deletions
    .filter((deletion) => deletion.ownership === "predecessor-canvas");
  const predecessorBatches = probe.predecessorResourceDisposal.batches
    .filter((batch) => batch.ownership === "predecessor-canvas");
  const firstDeletionAtMs = predecessorDeletions[0]?.atMs ?? null;
  const lastDeletionAtMs = predecessorDeletions.at(-1)?.atMs ?? null;
  const cleanupStackReturnedAtMs = predecessorBatches.length
    ? Math.max(...predecessorBatches.map((batch) =>
        batch.stackReturnedAtMs ?? batch.lastAtMs
      ))
    : null;
  const canvasDetachObservedAtMs =
    probe.predecessorResourceDisposal.canvasDetachObservedAtMs;
  const delta = (start: number | null, end: number | null) =>
    start === null || end === null ? null : end - start;
  const predecessorTeardownTiming = {
    canvasDetachObservedAtMs,
    firstDeletionAtMs,
    lastDeletionAtMs,
    cleanupStackReturnedAtMs,
    detachObservationToFirstDeletionMs: delta(
      canvasDetachObservedAtMs,
      firstDeletionAtMs,
    ),
    deletionIssueDurationMs: delta(firstDeletionAtMs, lastDeletionAtMs),
    lastDeletionToStackReturnMs: delta(
      lastDeletionAtMs,
      cleanupStackReturnedAtMs,
    ),
    firstDeletionToStackReturnMs: delta(
      firstDeletionAtMs,
      cleanupStackReturnedAtMs,
    ),
  };
  const longTaskAttribution = coldLongTasks.map((entry) => {
    const entryEnd = entry.startTime + entry.duration;
    const teardownStartCandidates = [
      canvasDetachObservedAtMs,
      firstDeletionAtMs,
    ].filter((value): value is number => value !== null);
    const teardownStartedAtMs = teardownStartCandidates.length
      ? Math.min(...teardownStartCandidates)
      : null;
    return {
      ...entry,
      phaseLabels: phases
        .filter((phase) =>
          entry.startTime < phase.endedAtMs && entryEnd > phase.startedAtMs
        )
        .map((phase) => phase.label),
      predecessorResourceDeletions:
        predecessorDeletions.filter((deletion) =>
          deletion.atMs >= entry.startTime && deletion.atMs <= entryEnd
        ),
      overlapsPredecessorTeardown:
        teardownStartedAtMs !== null &&
        cleanupStackReturnedAtMs !== null &&
        entry.startTime < cleanupStackReturnedAtMs &&
        entryEnd > teardownStartedAtMs,
    };
  });
  const unattributedLongTasks = longTaskAttribution
    .filter((entry) => entry.phaseLabels.length === 0)
    .map(({ startTime, duration }) => ({ startTime, duration }));
  const markers = [
    probe.clickedAtMs,
    probe.transitionFrameAtMs,
    probe.stageContentAtMs,
    probe.inspectorMountedAtMs,
    probe.previewMountedAtMs,
    probe.contextCreatedAtMs,
    probe.rendererWebglAtMs,
    probe.firstGlSubmissionAtMs,
    probe.topologyReadyAtMs,
    probe.initialSceneResourcesReadyAtMs,
  ];
  const markersComplete = markers.every(finiteMark) &&
    probe.requestedAtMs <= probe.clickedAtMs! &&
    probe.clickedAtMs! <= probe.transitionFrameAtMs! &&
    probe.clickedAtMs! <= probe.stageContentAtMs! &&
    probe.stageContentAtMs! <= probe.inspectorMountedAtMs! &&
    probe.stageContentAtMs! <= probe.previewMountedAtMs! &&
    probe.contextCreatedAtMs! <= probe.firstGlSubmissionAtMs! &&
    probe.previewMountedAtMs! <= probe.rendererWebglAtMs! &&
    probe.previewMountedAtMs! <= probe.firstGlSubmissionAtMs! &&
    probe.firstGlSubmissionAtMs! <= probe.topologyReadyAtMs! &&
    probe.topologyReadyAtMs! <= probe.initialSceneResourcesReadyAtMs! &&
    probe.initialSceneResourcesReadyAtMs! <= probe.completedAtMs;
  const inspectorExampleDeferred = probe.surface !== "foundry" || (
    probe.exampleMountedAtMs === null &&
    probe.scriptResources.every((resource) =>
      resource.role !== "inspector-example" ||
      resource.loadedBeforeClick ||
      resource.responseEnd > probe.completedAtMs
    )
  );
  return {
    ...probe,
    phaseWindows: phases,
    longTaskAttribution,
    foundryChildLongTaskAttribution: probe.foundryChildMarkers
      ? attributeFoundryColdLongTasks(probe.foundryChildMarkers, coldLongTasks)
      : [],
    predecessorTeardownTiming,
    unattributedLongTasks,
    markersComplete,
    inspectorExampleDeferred,
  };
};

export type HighResolutionMeasuredPhaseWindow = {
  label: string;
  startedAtMs: number;
  endedAtMs: number;
};

export type HighResolutionMeasuredLongTasks = {
  count: number;
  durationsMs: number[];
  maxMs: number;
  rawEntries: HighResolutionLongTaskEntry[];
  rawCount: number;
  rawDurationsMs: number[];
  rawMaxMs: number;
  measuredPhaseWindows: HighResolutionMeasuredPhaseWindow[];
  outsideMeasuredPhaseEntries: HighResolutionLongTaskEntry[];
  outsideMeasuredPhaseDurationsMs: number[];
  outsideMeasuredPhaseMaxMs: number;
  phaseAttribution: Array<HighResolutionLongTaskEntry & {
    phaseLabels: string[];
    attribution: "measured-playback" | "scenario-setup-control-teardown";
  }>;
  auditInternalMemoryMeasurementWindows: AuditInternalMemoryMeasurementWindow[];
  excludedProbeEntries: HighResolutionLongTaskEntry[];
  excludedProbeDurationsMs: number[];
  excludedProbeMaxMs: number;
};

export const partitionScenarioLongTasks = (
  entries: readonly HighResolutionLongTaskEntry[],
  windows: readonly AuditInternalMemoryMeasurementWindow[],
  measuredPhases: readonly HighResolutionMeasuredPhaseWindow[],
) => {
  const outsideMeasuredPhaseEntries: HighResolutionLongTaskEntry[] = [];
  const phaseAttribution: HighResolutionMeasuredLongTasks["phaseAttribution"] = [];
  for (const entry of entries) {
    const entryEnd = entry.startTime + entry.duration;
    const phaseLabels = measuredPhases
      .filter((phase) =>
        entry.startTime < phase.endedAtMs && entryEnd > phase.startedAtMs
      )
      .map((phase) => phase.label);
    if (!phaseLabels.length) outsideMeasuredPhaseEntries.push(entry);
    phaseAttribution.push({
      ...entry,
      phaseLabels,
      attribution: phaseLabels.length
        ? "measured-playback"
        : "scenario-setup-control-teardown",
    });
  }
  const excludedProbeEntries: HighResolutionLongTaskEntry[] = [];
  const appWorkEntries: HighResolutionLongTaskEntry[] = [];
  for (const entry of entries) {
    const entryEnd = entry.startTime + entry.duration;
    const fullyContained = windows.some((window) =>
      entry.startTime >= window.startedAtMs && entryEnd <= window.endedAtMs
    );
    (fullyContained ? excludedProbeEntries : appWorkEntries).push(entry);
  }
  return {
    appWorkEntries,
    excludedProbeEntries,
    outsideMeasuredPhaseEntries,
    phaseAttribution,
  };
};

export type HighResolutionPressureEvidence = {
  startedAtMs: number;
  endedAtMs: number;
  submissionCount: number;
  timerTaskCount: number;
  intervalMs: ReturnType<typeof percentiles>;
  qualifyingBadWindow: {
    startedAtMs: number;
    endedAtMs: number;
    intervalMs: ReturnType<typeof percentiles>;
    framesOver50Percent: number;
  } | null;
  requestedDprBefore: number | null;
  requestedDprAfter: number | null;
  downshiftAtMs: number | null;
  pressurePlayback: PlaybackAudit;
};

export type HighResolutionScenarioEvidence = {
  preset: "balanced" | "high";
  environment: ChromebookRuntimeEnvironment;
  backingStoreMutationProbeSupported: boolean;
  contextsLost: number;
  contextsRestored: number;
  pageErrors: string[];
  pathContextCreatedBeforeClick: boolean;
  coldStages: {
    path: HighResolutionColdStageEvidence;
    foundry: HighResolutionColdStageEvidence;
  };
  measuredLongTasks: HighResolutionMeasuredLongTasks;
  path: HighResolutionSurfaceEvidence;
  foundry: HighResolutionSurfaceEvidence;
  pressure?: HighResolutionPressureEvidence;
};

export type ChromebookHighResolutionAuditReport = {
  schemaVersion: 3;
  generatedAt: string;
  profile: ChromebookAuditProfile["name"];
  resultLabel: ChromebookAuditProfile["resultLabel"];
  productionBuild: true;
  actualChromebookTested: false;
  provenance: ChromebookAuditProvenance;
  matrix: {
    viewport: { width: 1366; height: 768 };
    deviceScaleFactor: 2;
    cpuThrottlingRate: 4 | 6;
    contextsInThisRun: 2;
    pairedProfilesRequired: readonly ["regression-4x", "acceptance-6x"];
    promotion: {
      fromDpr: 1;
      toDpr: 2;
      upshiftsRequired: number;
      goodSubmissionsRequired: number;
      minimumEvidenceMs: number;
      configuredPlaybackMs: number;
      bytesPerPixelBudget: 12;
      fixedOverheadBytes: number;
      nearFourMegapixelMemoryUnproven: true;
    };
  };
  balanced: HighResolutionScenarioEvidence;
  high: HighResolutionScenarioEvidence;
  acceptance: ChromebookAcceptance;
  diagnostics: {
    maximumEffectiveDpr: number;
    reachedNativeDpr2: boolean;
  };
};

const canvasClassFor = (surface: HighResolutionSurface) =>
  surface === "path" ? "three-puppet-canvas" : "foundry-three-canvas";

const inWindow = (atMs: number, startedAtMs: number, endedAtMs: number) =>
  atMs >= startedAtMs && atMs <= endedAtMs;

export const buildHighResolutionSurfaceEvidence = ({
  telemetry,
  surface,
  startedAtMs,
  endedAtMs,
  playback,
  playbackAcceptance,
  promotionPlayback,
  promotionPlaybackAcceptance,
}: {
  telemetry: ChromebookHighResolutionTelemetry;
  surface: HighResolutionSurface;
  startedAtMs: number;
  endedAtMs: number;
  playback?: PlaybackAudit;
  playbackAcceptance?: ChromebookAcceptance;
  promotionPlayback?: PlaybackAudit;
  promotionPlaybackAcceptance?: ChromebookAcceptance;
}): HighResolutionSurfaceEvidence => {
  const className = canvasClassFor(surface);
  const submissions = telemetry.contexts.flatMap((context) =>
    context.frameSubmissions
      .filter((sample) =>
        sample.className.includes(className) &&
        inWindow(sample.atMs, startedAtMs, endedAtMs)
      )
      .map((sample): HighResolutionDprSample => ({
        ...sample,
        contextIndex: context.contextIndex,
        drawingBufferPixels:
          sample.drawingBufferWidth * sample.drawingBufferHeight,
        maxRenderbufferDimension: context.maxRenderbufferDimension,
      }))
  ).sort((left, right) => left.atMs - right.atMs);
  const dprHistory = submissions.filter((sample, index) => {
    const previous = submissions[index - 1];
    return !previous ||
      sample.contextIndex !== previous.contextIndex ||
      sample.requestedDprCap !== previous.requestedDprCap ||
      sample.effectiveDpr !== previous.effectiveDpr ||
      sample.drawingBufferWidth !== previous.drawingBufferWidth ||
      sample.drawingBufferHeight !== previous.drawingBufferHeight;
  });
  const mutations = telemetry.contexts.flatMap((context) =>
    context.backingStore.mutations
      .filter((sample) =>
        sample.className.includes(className) &&
        inWindow(sample.atMs, startedAtMs, endedAtMs)
      )
      .map((sample): HighResolutionBackingStoreSample => ({
        ...sample,
        contextIndex: context.contextIndex,
        maxRenderbufferDimension: context.maxRenderbufferDimension,
      }))
  );
  const submissionBackingStores = submissions.map(
    (sample): HighResolutionBackingStoreSample => ({
      atMs: sample.atMs,
      contextIndex: sample.contextIndex,
      changedDimension: "submission",
      className: sample.className,
      width: sample.drawingBufferWidth,
      height: sample.drawingBufferHeight,
      pixels: sample.drawingBufferPixels,
      maxRenderbufferDimension: sample.maxRenderbufferDimension,
    }),
  );
  const backingStoreHistory = [...mutations, ...submissionBackingStores]
    .sort((left, right) => left.atMs - right.atMs);
  const promotionSamples = promotionPlayback
    ? submissions.filter((sample) => inWindow(
        sample.atMs,
        promotionPlayback.timedWindow.startedAtMs,
        promotionPlayback.timedWindow.endedAtMs,
      ))
    : [];
  const initialPixels = promotionSamples[0]?.drawingBufferPixels ?? 0;
  const finalPixels = promotionSamples.at(-1)?.drawingBufferPixels ?? 0;
  const deltaPixels = Math.max(0, finalPixels - initialPixels);
  const observedGrowthBytes = Math.max(
    0,
    promotionPlayback?.heap.growthBytes ?? 0,
  );
  const allowedGrowthBytes =
    deltaPixels * HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL +
    HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES;
  return {
    surface,
    startedAtMs,
    endedAtMs,
    submissionCount: submissions.length,
    submissionHistory: submissions,
    dprHistory,
    backingStoreHistory,
    highWaterPixels: backingStoreHistory.length
      ? Math.max(...backingStoreHistory.map((sample) => sample.pixels))
      : 0,
    playback,
    playbackAcceptance,
    promotion: promotionPlayback && promotionPlaybackAcceptance
      ? {
          playback: promotionPlayback,
          playbackAcceptance: promotionPlaybackAcceptance,
          allocation: {
            initialPixels,
            finalPixels,
            deltaPixels,
            observedGrowthBytes,
            bytesPerPixelBudget: HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL,
            fixedOverheadBytes:
              HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
            allowedGrowthBytes,
            bounded:
              deltaPixels > 0 && observedGrowthBytes <= allowedGrowthBytes,
            nearFourMegapixelMemoryUnproven: true,
          },
        }
      : undefined,
  };
};

const badSubmissionWindow = (samples: readonly HighResolutionDprSample[]) => {
  const intervals = samples.slice(1).map((sample, index) =>
    sample.atMs - samples[index].atMs
  );
  for (let end = 59; end < intervals.length; end += 1) {
    const window = intervals.slice(end - 59, end + 1);
    if (window.some((value) => value > 200)) continue;
    const intervalMs = percentiles(window);
    const framesOver50Percent =
      window.filter((value) => value > 50).length / window.length * 100;
    if (
      intervalMs.p95 > 42 ||
      framesOver50Percent > 5 ||
      intervalMs.p99 > 75
    ) {
      return {
        startedAtMs: samples[end - 59].atMs,
        endedAtMs: samples[end + 1].atMs,
        intervalMs,
        framesOver50Percent,
      };
    }
  }
  return null;
};

export const buildHighResolutionPressureEvidence = ({
  foundry,
  startedAtMs,
  endedAtMs,
  pressurePlayback,
  timerTaskCount,
}: {
  foundry: HighResolutionSurfaceEvidence;
  startedAtMs: number;
  endedAtMs: number;
  pressurePlayback: PlaybackAudit;
  timerTaskCount: number;
}): HighResolutionPressureEvidence => {
  const samples = foundry.submissionHistory;
  const pressureSamples = samples.filter((sample) =>
    inWindow(sample.atMs, startedAtMs, endedAtMs)
  );
  const requestedBeforePressure = foundry.dprHistory
    .filter((sample) =>
      sample.atMs <= startedAtMs && sample.requestedDprCap !== null
    )
    .at(-1);
  const requestedSamples = foundry.dprHistory.filter((sample) =>
    inWindow(sample.atMs, startedAtMs, endedAtMs) &&
    sample.requestedDprCap !== null
  );
  const requestedDprBefore = requestedBeforePressure?.requestedDprCap ??
    requestedSamples[0]?.requestedDprCap ?? null;
  const downshift = requestedDprBefore === null
    ? undefined
    : requestedSamples.find((sample) =>
        sample.requestedDprCap !== null &&
        sample.requestedDprCap < requestedDprBefore
      );
  const intervals = pressureSamples.slice(1).map((sample, index) =>
    sample.atMs - pressureSamples[index].atMs
  );
  return {
    startedAtMs,
    endedAtMs,
    submissionCount: pressureSamples.length,
    timerTaskCount,
    intervalMs: percentiles(intervals),
    qualifyingBadWindow: badSubmissionWindow(pressureSamples),
    requestedDprBefore,
    requestedDprAfter: downshift?.requestedDprCap ?? requestedDprBefore,
    downshiftAtMs: downshift?.atMs ?? null,
    pressurePlayback,
  };
};

const allSurfaces = (scenario: HighResolutionScenarioEvidence) => [
  scenario.path,
  scenario.foundry,
];
const samplesFor = (scenario: HighResolutionScenarioEvidence) =>
  allSurfaces(scenario).flatMap((surface) => surface.dprHistory);
const backingFor = (scenario: HighResolutionScenarioEvidence) =>
  allSurfaces(scenario).flatMap((surface) => surface.backingStoreHistory);
const playbackPasses = (
  scenario: HighResolutionScenarioEvidence,
  requiredSurfaces: readonly HighResolutionSurface[],
) => requiredSurfaces.every((surface) =>
  scenario[surface].playback !== undefined &&
  scenario[surface].playbackAcceptance?.passed.passed === true
);
const near = (value: number | null, expected: number) =>
  value !== null && Math.abs(value - expected) <= 0.011;
const playbackMemoryIsQuiescent = (playback: PlaybackAudit) =>
  playback.memoryMeasurementWindows.every((window) =>
    window.phase === "baseline"
      ? window.endedAtMs <= playback.timedWindow.startedAtMs
      : window.startedAtMs >= playback.timedWindow.endedAtMs
  );
const playbackTimedWindowIsExact = (playback: PlaybackAudit) =>
  Math.abs(
    playback.durationMs -
      (playback.timedWindow.endedAtMs - playback.timedWindow.startedAtMs),
  ) <= 1;
const playbackWarmPlateauPasses = (
  playback: PlaybackAudit,
  expectedSurface: HighResolutionSurface,
) => {
  const plateau = playback.warmPlateau;
  const baselineWindow = playback.memoryMeasurementWindows.find(
    (window) => window.phase === "baseline",
  );
  const playbackLiveResourcesByKind = Object.fromEntries(
    Object.entries(playback.webgl.before.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, counters.live]),
  );
  const playbackResourceCountersByKind = Object.fromEntries(
    Object.entries(playback.webgl.before.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, {
        created: counters.created,
        deleted: counters.deleted,
        live: counters.live,
      }]),
  );
  return plateau !== undefined &&
    plateau.surface === expectedSurface &&
    plateau.requiredStableActualFrames ===
      HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES &&
    plateau.stableActualFrames >= plateau.requiredStableActualFrames &&
    plateau.startedAtMs < plateau.pausedAtMs &&
    (baselineWindow === undefined ||
      plateau.pausedAtMs <= baselineWindow.startedAtMs) &&
    plateau.firstGlobalGlIndex >= 0 &&
    plateau.lastGlobalGlIndex > plateau.firstGlobalGlIndex &&
    plateau.rendererReady &&
    plateau.topologyReady &&
    plateau.initialSceneResourcesReady &&
    (expectedSurface === "path"
      ? plateau.pendingInitialSceneResources === 0
      : plateau.pendingInitialSceneResources === null) &&
    JSON.stringify(playbackLiveResourcesByKind) ===
      JSON.stringify(plateau.liveResourcesByKind) &&
    JSON.stringify(playbackResourceCountersByKind) ===
      JSON.stringify(plateau.resourceCountersByKind) &&
    plateau.contextsLost === 0 &&
    plateau.contextsRestored === 0;
};
const acceptancePassesExceptPromotionHeap = (
  acceptance: ChromebookAcceptance | undefined,
) => acceptance !== undefined && Object.entries(acceptance).every(
  ([name, check]) => name === "passed" || name === "heapStable" || check.passed,
);
const promotionAllocationIsBounded = (
  promotion: HighResolutionSurfaceEvidence["promotion"],
) => {
  if (!promotion) return false;
  const allocation = promotion.allocation;
  const expectedDelta = Math.max(
    0,
    allocation.finalPixels - allocation.initialPixels,
  );
  const expectedLimit =
    expectedDelta * HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL +
    HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES;
  return allocation.bounded &&
    allocation.deltaPixels === expectedDelta &&
    allocation.bytesPerPixelBudget === HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL &&
    allocation.fixedOverheadBytes ===
      HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES &&
    allocation.allowedGrowthBytes === expectedLimit &&
    allocation.observedGrowthBytes <= expectedLimit;
};

export const evaluateChromebookHighResolutionAcceptance = ({
  profile,
  balanced,
  high,
}: {
  profile: ChromebookAuditProfile;
  balanced: HighResolutionScenarioEvidence;
  high: HighResolutionScenarioEvidence;
}): ChromebookAcceptance => {
  const scenarios = [balanced, high];
  const coldStageEvidence = scenarios.flatMap((scenario) => [
    scenario.coldStages.path,
    scenario.coldStages.foundry,
  ]);
  const dprSamples = scenarios.flatMap(samplesFor);
  const backingSamples = scenarios.flatMap(backingFor);
  const balancedSamples = samplesFor(balanced);
  const highSamples = samplesFor(high);
  const highPathSamples = high.path.dprHistory;
  const highFoundrySamples = high.foundry.dprHistory;
  const promotion = high.path.promotion;
  const promotionSamples = promotion
    ? high.path.submissionHistory.filter((sample) => inWindow(
        sample.atMs,
        promotion.playback.timedWindow.startedAtMs,
        promotion.playback.timedWindow.endedAtMs,
      ))
    : [];
  const settledHighPathSamples = high.path.playback
    ? high.path.submissionHistory.filter((sample) => inWindow(
        sample.atMs,
        high.path.playback!.timedWindow.startedAtMs,
        high.path.playback!.timedWindow.endedAtMs,
      ))
    : [];
  const pressure = high.pressure;
  const measuredPlaybackEntries = scenarios.flatMap((scenario) => [
    { surface: "path" as const, playback: scenario.path.playback },
    { surface: "path" as const, playback: scenario.path.promotion?.playback },
    { surface: "foundry" as const, playback: scenario.foundry.playback },
    { surface: "foundry" as const, playback: scenario.pressure?.pressurePlayback },
  ]).filter((entry): entry is {
    surface: HighResolutionSurface;
    playback: PlaybackAudit;
  } => entry.playback !== undefined);
  const measuredPlaybacks = measuredPlaybackEntries.map(
    (entry) => entry.playback,
  );
  const warmControlLatencyMaxMs = Math.max(
    0,
    ...measuredPlaybacks.flatMap((playback) => playback.warmPlateau
      ? [
          playback.warmPlateau.playNextPaintMs,
          playback.warmPlateau.pauseNextPaintMs,
        ]
      : []),
  );
  const pressureSafety = pressure === undefined || (
    pressure.pressurePlayback.framesOver200 === 0 &&
    pressure.pressurePlayback.longTasks.maxMs <= 50 &&
    pressure.pressurePlayback.reactCommits === 0 &&
    pressure.pressurePlayback.heap.supported &&
    pressure.pressurePlayback.heap.stable &&
    pressure.pressurePlayback.webgl.liveResourceDelta <= 0 &&
    Object.values(pressure.pressurePlayback.webgl.resourceDeltaByKind)
      .every((delta) => delta.created === 0 && delta.deleted === 0) &&
    pressure.pressurePlayback.webgl.contextDelta <= 0 &&
    pressure.pressurePlayback.webgl.contextLossDelta === 0 &&
    pressure.pressurePlayback.webgl.contextRestoreDelta === 0 &&
    pressure.pressurePlayback.webgl.topologyBuildDelta <= 0 &&
    pressure.pressurePlayback.webgl.geometryCacheDelta <= 0 &&
    pressure.pressurePlayback.webgl.materialCacheDelta <= 0
  );
  const balancedPlaybackPasses = playbackPasses(balanced, ["path", "foundry"]);
  const highPlaybackPasses = playbackPasses(
    high,
    profile.environment.cpuThrottlingRate === 4
      ? ["path", "foundry"]
      : ["foundry"],
  );
  const checks: Record<string, AcceptanceCheck> = {
    settledCharacterContextBeforePath: {
      passed: scenarios.every(
        (scenario) => scenario.pathContextCreatedBeforeClick,
      ),
      observed: scenarios.filter(
        (scenario) => scenario.pathContextCreatedBeforeClick,
      ).length,
      limit: "2/2 Path contexts created no later than the Path click",
    },
    coldStageCausalEvidence: {
      passed: coldStageEvidence.length === 4 && coldStageEvidence.every(
        (evidence) =>
          evidence.markersComplete &&
          evidence.unattributedLongTasks.length === 0 &&
          evidence.inspectorExampleDeferred,
      ),
      observed: coldStageEvidence.filter(
        (evidence) =>
          evidence.markersComplete &&
          evidence.unattributedLongTasks.length === 0 &&
          evidence.inspectorExampleDeferred,
      ).length,
      limit: "4/4 complete; every cold Long Task phase-attributed; Foundry example deferred",
    },
    exactDpr2Environment: {
      passed: scenarios.every((scenario) =>
        scenario.environment.measuredDeviceScaleFactor === 2 &&
        scenario.environment.viewport.width === 1366 &&
        scenario.environment.viewport.height === 768
      ),
      observed: scenarios.every((scenario) =>
        scenario.environment.measuredDeviceScaleFactor === 2
      ),
      limit: true,
    },
    backingStoreMutationTelemetry: {
      passed: scenarios.every((scenario) =>
        scenario.backingStoreMutationProbeSupported
      ) && backingSamples.length > 0,
      observed: backingSamples.length,
      limit: ">0 with probe support",
    },
    pixelBudget: {
      passed: backingSamples.length > 0 && backingSamples.every((sample) =>
        sample.pixels <= RENDER_VIEWPORT_PIXEL_BUDGET
      ),
      observed: backingSamples.length
        ? Math.max(...backingSamples.map((sample) => sample.pixels))
        : 0,
      limit: RENDER_VIEWPORT_PIXEL_BUDGET,
    },
    renderbufferDimensionBudget: {
      passed: backingSamples.length > 0 && backingSamples.every((sample) =>
        sample.width <= sample.maxRenderbufferDimension &&
        sample.height <= sample.maxRenderbufferDimension
      ),
      observed: backingSamples.every((sample) =>
        sample.width <= sample.maxRenderbufferDimension &&
        sample.height <= sample.maxRenderbufferDimension
      ),
      limit: true,
    },
    dprBounds: {
      passed: dprSamples.length > 0 && dprSamples.every((sample) =>
        sample.requestedDprCap !== null &&
        sample.effectiveDpr !== null &&
        sample.effectiveDpr <= sample.requestedDprCap + 0.011 &&
        sample.requestedDprCap <= HIGH_RESOLUTION_DEVICE_SCALE_FACTOR
      ),
      observed: dprSamples.length,
      limit: ">0 and effective <= requested <= 2",
    },
    balancedFixedDpr: {
      passed: balancedSamples.length > 0 && balancedSamples.every((sample) =>
        near(sample.requestedDprCap, HIGH_RESOLUTION_BALANCED_DPR) &&
        near(sample.effectiveDpr, HIGH_RESOLUTION_BALANCED_DPR)
      ),
      observed: balancedSamples.length
        ? Math.max(...balancedSamples.map((sample) => sample.effectiveDpr ?? 0))
        : 0,
      limit: HIGH_RESOLUTION_BALANCED_DPR,
    },
    highRaisesResolution: {
      passed: highSamples.some((sample) =>
        (sample.effectiveDpr ?? 0) > HIGH_RESOLUTION_BALANCED_DPR + 0.1
      ),
      observed: highSamples.length
        ? Math.max(...highSamples.map((sample) => sample.effectiveDpr ?? 0))
        : 0,
      limit: `>${HIGH_RESOLUTION_BALANCED_DPR}`,
    },
    sharedPathFoundryOwnership: {
      passed:
        highPathSamples.length > 0 &&
        highFoundrySamples.length > 0 &&
        (profile.environment.cpuThrottlingRate === 4
          ? highFoundrySamples.every((sample) =>
              near(sample.requestedDprCap, HIGH_RESOLUTION_NATIVE_DPR) &&
              near(sample.effectiveDpr, HIGH_RESOLUTION_NATIVE_DPR)
            )
          : (highFoundrySamples[0].requestedDprCap ?? 0) >=
            (highPathSamples.at(-1)?.requestedDprCap ?? 0) - 0.011),
      observed: highFoundrySamples.length
        ? Math.min(...highFoundrySamples.flatMap((sample) => [
            sample.requestedDprCap ?? 0,
            sample.effectiveDpr ?? 0,
          ]))
        : 0,
      limit: profile.environment.cpuThrottlingRate === 4
        ? "Foundry retains requested/effective DPR ~= 2 for the settled run"
        : "shared session cap survives Path -> Foundry",
    },
    capablePromotion4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 || (
        promotionSamples.some((sample) =>
          near(sample.requestedDprCap, HIGH_RESOLUTION_SAFE_START_DPR) &&
          near(sample.effectiveDpr, HIGH_RESOLUTION_SAFE_START_DPR)
        ) &&
        promotionSamples.some((sample) =>
          near(sample.requestedDprCap, HIGH_RESOLUTION_NATIVE_DPR) &&
          near(sample.effectiveDpr, HIGH_RESOLUTION_NATIVE_DPR)
        )
      ),
      observed: promotionSamples.length
        ? Math.min(
            Math.max(...promotionSamples.map(
              (sample) => sample.requestedDprCap ?? 0,
            )),
            Math.max(...promotionSamples.map(
              (sample) => sample.effectiveDpr ?? 0,
            )),
          )
        : 0,
      limit: profile.environment.cpuThrottlingRate === 4
        ? "Path observes requested/effective DPR ~= 1, then ~= 2"
        : "n/a",
    },
    promotionWindowSufficient4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 || (
        (promotion?.playback.durationMs ?? 0) >=
          HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS
      ),
      observed: promotion?.playback.durationMs ?? 0,
      limit: profile.environment.cpuThrottlingRate === 4
        ? HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS
        : "n/a",
    },
    promotionSubmissionEvidence4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 ||
        (promotion?.playback.frameCount ?? 0) >=
          HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS,
      observed: promotion?.playback.frameCount ?? 0,
      limit: profile.environment.cpuThrottlingRate === 4
        ? HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS
        : "n/a",
    },
    promotionNonMemorySafety4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 ||
        acceptancePassesExceptPromotionHeap(promotion?.playbackAcceptance),
      observed: profile.environment.cpuThrottlingRate !== 4 ||
        acceptancePassesExceptPromotionHeap(promotion?.playbackAcceptance),
      limit: true,
    },
    promotionAllocationBounded4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 ||
        promotionAllocationIsBounded(promotion),
      observed: promotion?.allocation.observedGrowthBytes ?? 0,
      limit: profile.environment.cpuThrottlingRate === 4
        ? promotion?.allocation.allowedGrowthBytes ?? 0
        : "n/a",
    },
    settledPathNativeDpr4x: {
      passed: profile.environment.cpuThrottlingRate !== 4 || (
        settledHighPathSamples.length >= 2 &&
        settledHighPathSamples.every((sample) =>
          near(sample.requestedDprCap, HIGH_RESOLUTION_NATIVE_DPR) &&
          near(sample.effectiveDpr, HIGH_RESOLUTION_NATIVE_DPR)
        ) &&
        high.path.playbackAcceptance?.passed.passed === true
      ),
      observed: settledHighPathSamples.length,
      limit: profile.environment.cpuThrottlingRate === 4
        ? ">=2 DPR2 submissions with full settled playback acceptance"
        : "n/a",
    },
    exactTimedPlaybackWindows: {
      passed: measuredPlaybacks.length > 0 &&
        measuredPlaybacks.every(playbackTimedWindowIsExact),
      observed: measuredPlaybacks.length,
      limit: ">0 and duration equals timestamp boundary within 1ms",
    },
    memoryProbesQuiescent: {
      passed: measuredPlaybacks.length > 0 &&
        measuredPlaybacks.every(playbackMemoryIsQuiescent),
      observed: measuredPlaybacks.every(playbackMemoryIsQuiescent),
      limit: true,
    },
    playbackOwnershipWarmPlateau: {
      passed: measuredPlaybackEntries.length > 0 &&
        measuredPlaybackEntries.every((entry) =>
          playbackWarmPlateauPasses(entry.playback, entry.surface)
        ),
      observed: measuredPlaybackEntries.every((entry) =>
        playbackWarmPlateauPasses(entry.playback, entry.surface)
      ),
      limit: true,
    },
    warmControlLatency: {
      passed: measuredPlaybacks.length > 0 &&
        measuredPlaybacks.every((playback) =>
          playback.warmPlateau !== undefined &&
          playback.warmPlateau.playNextPaintMs <=
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms &&
          playback.warmPlateau.pauseNextPaintMs <=
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms
        ),
      observed: warmControlLatencyMaxMs,
      limit: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
    },
    deterministicDownshift6x: {
      passed: profile.environment.cpuThrottlingRate !== 6 || Boolean(
        pressure?.qualifyingBadWindow &&
        pressure.startedAtMs === pressure.pressurePlayback.timedWindow.startedAtMs &&
        pressure.endedAtMs === pressure.pressurePlayback.timedWindow.endedAtMs &&
        pressure.timerTaskCount > 0 &&
        pressure.requestedDprBefore !== null &&
        pressure.requestedDprAfter !== null &&
        pressure.requestedDprAfter < pressure.requestedDprBefore &&
        pressure.downshiftAtMs !== null &&
        pressure.downshiftAtMs >= pressure.qualifyingBadWindow.endedAtMs
      ),
      observed: pressure?.requestedDprAfter ?? 0,
      limit: profile.environment.cpuThrottlingRate === 6
        ? "lower than pre-pressure DPR after a bad 60-submit window"
        : "n/a",
    },
    settledPlaybackAcceptance: {
      passed: balancedPlaybackPasses && highPlaybackPasses,
      observed: balancedPlaybackPasses && highPlaybackPasses,
      limit: true,
    },
    pressureNonFrameSafety: {
      passed: pressureSafety,
      observed: pressureSafety,
      limit: true,
    },
    measuredLongTaskMax: {
      passed: scenarios.every((scenario) => scenario.measuredLongTasks.maxMs <= 50),
      observed: Math.max(
        0,
        ...scenarios.map((scenario) => scenario.measuredLongTasks.maxMs),
      ),
      limit: 50,
    },
    pageErrorsAbsent: {
      passed: scenarios.every((scenario) => scenario.pageErrors.length === 0),
      observed: scenarios.reduce(
        (sum, scenario) => sum + scenario.pageErrors.length,
        0,
      ),
      limit: 0,
    },
    contextLossAbsent: {
      passed: scenarios.every((scenario) => scenario.contextsLost === 0),
      observed: scenarios.reduce((sum, scenario) => sum + scenario.contextsLost, 0),
      limit: 0,
    },
    contextRestorationAbsent: {
      passed: scenarios.every((scenario) => scenario.contextsRestored === 0),
      observed: scenarios.reduce(
        (sum, scenario) => sum + scenario.contextsRestored,
        0,
      ),
      limit: 0,
    },
  };
  const passed = Object.values(checks).every((check) => check.passed);
  return { ...checks, passed: { passed, observed: passed, limit: true } };
};

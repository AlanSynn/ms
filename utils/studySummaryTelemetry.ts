import {
  COMMAND_FAMILIES,
  ERROR_NAMES,
  EXPORT_BLOCKERS,
  EXPORT_OUTCOMES,
  FIT_OUTCOMES,
  IMAGE_INFERENCE_OUTCOMES,
  LATENCY_BUCKET_COUNT,
  MECHANISM_FAMILIES,
  STAGES,
  STUDY_SUMMARY_SCHEMA,
  MAX_STUDY_SUMMARY_BYTES,
  MAX_STUDY_SUMMARY_COUNTER,
  MAX_STUDY_SUMMARY_DURATION_MS,
  estimateStudySummaryMemoryBytes,
  finiteNonnegative,
  latencyBucketIndex,
  normalizeAutosaveOutcome,
  normalizeBuildSha,
  normalizeCommandFamily,
  normalizeCommandOutcome,
  normalizeErrorName,
  normalizeExportBlocker,
  normalizeExportOutcome,
  normalizeFitOutcome,
  normalizeHardwareBucket,
  normalizeImageInferenceOutcome,
  normalizeMechanismFamily,
  normalizeNetworkBucket,
  normalizePointerBucket,
  normalizeProfile,
  normalizeStage,
  normalizeViewportBucket,
  type StudyPerformanceInput,
  type StudyPerformanceSummary,
  type StudySummary,
  type StudySummaryInspection,
  type StudySummaryProfile,
  type StudySummarySession,
  type StudySummarySessionOptions,
} from "../infrastructure/study-summary/schema";

export * from "../infrastructure/study-summary/schema";

const makeCounts = (size: number): number[] => Array.from({ length: size }, () => 0);
const makeHistogram = (): number[] => makeCounts(LATENCY_BUCKET_COUNT);
const bump = (values: number[], index: number): void => {
  values[index] = Math.min(MAX_STUDY_SUMMARY_COUNTER, values[index] + 1);
};
const arrayIndex = <T extends string>(values: readonly T[], value: T): number => values.indexOf(value);
const nowOf = (clock: StudySummarySessionOptions["clock"]): (() => number) => {
  const raw = typeof clock === "function" ? clock : clock?.now ?? Date.now;
  let previous = 0;
  return () => {
    const next = raw();
    const current = typeof next === "number" && Number.isFinite(next) ? next : previous;
    previous = Math.max(previous, current);
    return previous;
  };
};
const recordHistogram = (histogram: number[], value: number | undefined): void => {
  const index = latencyBucketIndex(value);
  if (index !== null) bump(histogram, index);
};
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
const cloneSummary = (summary: StudySummary): StudySummary => ({
  ...summary,
  context: { ...summary.context },
  stageEntries: [...summary.stageEntries],
  stageDurationMs: [...summary.stageDurationMs],
  commandAccepted: [...summary.commandAccepted],
  commandRejected: [...summary.commandRejected],
  commandNoOp: [...summary.commandNoOp],
  commandUnknown: [...summary.commandUnknown],
  mechanismFamilies: [...summary.mechanismFamilies],
  fitOutcomes: [...summary.fitOutcomes],
  fitLatency: [...summary.fitLatency],
  exportOutcomes: [...summary.exportOutcomes],
  exportBlockers: [...summary.exportBlockers],
  autosaveDuration: [...summary.autosaveDuration],
  imageInferenceLatency: [...summary.imageInferenceLatency],
  errorNames: [...summary.errorNames],
  performance: { ...summary.performance },
});
const emptyPerformance = () => ({
  inputLatencyP95Ms: null,
  inputLatencyDeltaP95Ms: null,
  inputLatencyDeltaPercentP95: null,
  frameIntervalP95Ms: null,
  frameIntervalDeltaPercentP95: null,
  longTasksOver50Ms: null,
});
const safePerformanceNumber = (value: unknown, max = MAX_STUDY_SUMMARY_DURATION_MS): number | null => finiteNonnegative(value, max);

export const createStudySummarySession = (options: StudySummarySessionOptions): StudySummarySession => {
  const profile = normalizeProfile(options.profile);
  const enabled = profile !== "off";
  const now = nowOf(options.clock);
  const startedAt = now();
  const context = {
    viewport: normalizeViewportBucket(options.context?.viewport),
    hardwareConcurrency: normalizeHardwareBucket(options.context?.hardwareConcurrency),
    pointer: normalizePointerBucket(options.context?.pointer),
    network: normalizeNetworkBucket(options.context?.network),
  };
  const stageEntries = makeCounts(STAGES.length);
  const stageDurationMs = makeCounts(STAGES.length);
  const commandAccepted = makeCounts(COMMAND_FAMILIES.length);
  const commandRejected = makeCounts(COMMAND_FAMILIES.length);
  const commandNoOp = makeCounts(COMMAND_FAMILIES.length);
  const commandUnknown = makeCounts(COMMAND_FAMILIES.length);
  const mechanismFamilies = makeCounts(MECHANISM_FAMILIES.length);
  const fitOutcomes = makeCounts(FIT_OUTCOMES.length);
  const fitLatency = makeHistogram();
  const exportOutcomes = makeCounts(EXPORT_OUTCOMES.length);
  const exportBlockers = makeCounts(EXPORT_BLOCKERS.length);
  const autosaveDuration = makeHistogram();
  const imageInferenceLatency = makeHistogram();
  const errorNames = makeCounts(ERROR_NAMES.length);
  let fitRequests = 0;
  let exportAttempts = 0;
  let autosaveSuccess = 0;
  let autosaveFailure = 0;
  let autosaveRecovery = 0;
  let imageInferenceSuccess = 0;
  let imageInferenceFailure = 0;
  let performance: StudyPerformanceSummary = emptyPerformance();
  let activeStage: (typeof STAGES)[number] | undefined;
  let stageStartedAt = startedAt;
  let normalFlushAttempted = false;
  let beaconAttempted = false;
  let normalSendCount = 0;
  let beaconCount = 0;

  const addStageDuration = (stage: (typeof STAGES)[number], durationMs: number): void => {
    if (!enabled) return;
    const index = arrayIndex(STAGES, stage);
    stageDurationMs[index] = Math.min(MAX_STUDY_SUMMARY_DURATION_MS, stageDurationMs[index] + durationMs);
  };
  const enterStage = (stage: (typeof STAGES)[number]): void => {
    if (!enabled) return;
    const next = normalizeStage(stage);
    const current = now();
    if (activeStage !== undefined) addStageDuration(activeStage, Math.max(0, Math.round(current - stageStartedAt)));
    activeStage = next;
    stageStartedAt = current;
    bump(stageEntries, arrayIndex(STAGES, next));
  };
  if (options.initialStage !== undefined) enterStage(options.initialStage);

  const snapshot = (): StudySummary => {
    const durations = [...stageDurationMs];
    if (activeStage !== undefined) {
      const index = arrayIndex(STAGES, activeStage);
      durations[index] = Math.min(MAX_STUDY_SUMMARY_DURATION_MS, durations[index] + Math.round(Math.max(0, now() - stageStartedAt)));
    }
    return {
      schema: STUDY_SUMMARY_SCHEMA,
      buildSha: normalizeBuildSha(options.buildSha),
      profile,
      sessionDurationMs: Math.min(MAX_STUDY_SUMMARY_DURATION_MS, Math.round(Math.max(0, now() - startedAt))),
      context,
      stageEntries: [...stageEntries],
      stageDurationMs: durations,
      commandAccepted: [...commandAccepted],
      commandRejected: [...commandRejected],
      commandNoOp: [...commandNoOp],
      commandUnknown: [...commandUnknown],
      mechanismFamilies: [...mechanismFamilies],
      fitRequests,
      fitOutcomes: [...fitOutcomes],
      fitLatency: [...fitLatency],
      exportAttempts,
      exportOutcomes: [...exportOutcomes],
      exportBlockers: [...exportBlockers],
      autosaveSuccess,
      autosaveFailure,
      autosaveRecovery,
      autosaveDuration: [...autosaveDuration],
      imageInferenceSuccess,
      imageInferenceFailure,
      imageInferenceLatency: [...imageInferenceLatency],
      errorNames: [...errorNames],
      performance: { ...performance },
    };
  };
  const encoded = (): { payload: string; bytes: number } | null => {
    const payload = JSON.stringify(snapshot());
    const bytes = byteLength(payload);
    return bytes <= MAX_STUDY_SUMMARY_BYTES ? { payload, bytes } : null;
  };

  const session: StudySummarySession = {
    profile,
    enterStage,
    recordCommand: (family, outcome) => {
      if (!enabled) return;
      const normalized = normalizeCommandOutcome(outcome);
      const target = normalized === "accepted"
        ? commandAccepted
        : normalized === "rejected"
          ? commandRejected
          : normalized === "no-op"
            ? commandNoOp
            : commandUnknown;
      bump(target, arrayIndex(COMMAND_FAMILIES, normalizeCommandFamily(family)));
    },
    recordMechanism: (family) => {
      if (!enabled) return;
      bump(mechanismFamilies, arrayIndex(MECHANISM_FAMILIES, normalizeMechanismFamily(family)));
    },
    recordFit: (outcome, latencyMs) => {
      if (!enabled) return;
      fitRequests = Math.min(MAX_STUDY_SUMMARY_COUNTER, fitRequests + 1);
      bump(fitOutcomes, arrayIndex(FIT_OUTCOMES, normalizeFitOutcome(outcome)));
      recordHistogram(fitLatency, latencyMs);
    },
    recordExport: (outcome, blocker) => {
      if (!enabled) return;
      exportAttempts = Math.min(MAX_STUDY_SUMMARY_COUNTER, exportAttempts + 1);
      const normalized = normalizeExportOutcome(outcome);
      bump(exportOutcomes, arrayIndex(EXPORT_OUTCOMES, normalized));
      bump(exportBlockers, arrayIndex(EXPORT_BLOCKERS, normalizeExportBlocker(blocker ?? (normalized === "success" ? "none" : "unknown"))));
    },
    recordAutosave: (outcome, recovery = false, durationMs) => {
      if (!enabled) return;
      const normalized = normalizeAutosaveOutcome(outcome);
      if (normalized === "success") autosaveSuccess = Math.min(MAX_STUDY_SUMMARY_COUNTER, autosaveSuccess + 1);
      if (normalized === "failure") autosaveFailure = Math.min(MAX_STUDY_SUMMARY_COUNTER, autosaveFailure + 1);
      if (recovery) autosaveRecovery = Math.min(MAX_STUDY_SUMMARY_COUNTER, autosaveRecovery + 1);
      recordHistogram(autosaveDuration, durationMs);
    },
    recordImageInference: (outcome, latencyMs) => {
      if (!enabled) return;
      const normalized = normalizeImageInferenceOutcome(outcome);
      if (normalized === "success") imageInferenceSuccess = Math.min(MAX_STUDY_SUMMARY_COUNTER, imageInferenceSuccess + 1);
      if (normalized === "failure") imageInferenceFailure = Math.min(MAX_STUDY_SUMMARY_COUNTER, imageInferenceFailure + 1);
      recordHistogram(imageInferenceLatency, latencyMs);
    },
    recordError: (errorName) => {
      if (!enabled) return;
      bump(errorNames, arrayIndex(ERROR_NAMES, normalizeErrorName(errorName)));
    },
    recordPerformance: (input: StudyPerformanceInput) => {
      if (!enabled) return;
      if (!input || typeof input !== "object") return;
      performance = {
        inputLatencyP95Ms: safePerformanceNumber(input.inputLatencyP95Ms),
        inputLatencyDeltaP95Ms: safePerformanceNumber(input.inputLatencyDeltaP95Ms),
        inputLatencyDeltaPercentP95: safePerformanceNumber(input.inputLatencyDeltaPercentP95, 1_000),
        frameIntervalP95Ms: safePerformanceNumber(input.frameIntervalP95Ms),
        frameIntervalDeltaPercentP95: safePerformanceNumber(input.frameIntervalDeltaPercentP95, 1_000),
        longTasksOver50Ms: safePerformanceNumber(input.longTasksOver50Ms, MAX_STUDY_SUMMARY_COUNTER),
      };
    },
    flush: async () => {
      if (!enabled || normalFlushAttempted || !options.transport?.send) return false;
      normalFlushAttempted = true;
      const encodedPayload = encoded();
      if (!encodedPayload) return false;
      normalSendCount = 1;
      try {
        await options.transport.send(options.endpoint, encodedPayload.payload);
        return true;
      } catch {
        return false;
      }
    },
    beacon: () => {
      if (!enabled || beaconAttempted || !options.transport?.beacon) return false;
      beaconAttempted = true;
      const encodedPayload = encoded();
      if (!encodedPayload) return false;
      beaconCount = 1;
      try {
        return options.transport.beacon(options.endpoint, encodedPayload.payload) !== false;
      } catch {
        return false;
      }
    },
    snapshot: () => cloneSummary(snapshot()),
    inspect: () => {
      const summary = snapshot();
      const payload = JSON.stringify(summary);
      return {
        summary: cloneSummary(summary),
        payload,
        payloadBytes: byteLength(payload),
        estimatedMemoryBytes: estimateStudySummaryMemoryBytes(),
        normalSendCount,
        beaconCount,
        normalFlushAttempted,
        beaconAttempted,
      } satisfies StudySummaryInspection;
    },
  };
  return session;
};

export const makeEmptyStudySummary = (buildSha = "unknown", profile: StudySummaryProfile = "off"): StudySummary =>
  createStudySummarySession({ buildSha, profile, endpoint: "", clock: () => 0 }).snapshot();

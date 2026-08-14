export const STUDY_SUMMARY_SCHEMA = "study-summary-v1" as const;
export const MAX_STUDY_SUMMARY_BYTES = 8_192;
export const MAX_STUDY_SUMMARY_MEMORY_BYTES = 262_144;
export const MAX_STUDY_SUMMARY_COUNTER = 1_000_000;
export const MAX_STUDY_SUMMARY_DURATION_MS = 86_400_000;

export const STAGES = ["character", "path", "foundry", "design", "blueprint", "assembly", "options", "unknown"] as const;
export type StudyStage = (typeof STAGES)[number];
export const COMMAND_FAMILIES = ["navigation", "authoring", "path", "mechanism", "fit", "export", "autosave", "inference", "playback", "settings", "unknown"] as const;
export type StudyCommandFamily = (typeof COMMAND_FAMILIES)[number];
export const COMMAND_OUTCOMES = ["accepted", "rejected", "no-op", "unknown"] as const;
export type StudyCommandOutcome = (typeof COMMAND_OUTCOMES)[number];
export const MECHANISM_FAMILIES = ["four-bar", "slider", "gear", "cam", "rack", "linkage", "custom", "unknown"] as const;
export type StudyMechanismFamily = (typeof MECHANISM_FAMILIES)[number];
export const FIT_OUTCOMES = ["accepted", "rejected", "no-op", "error", "unknown"] as const;
export type StudyFitOutcome = (typeof FIT_OUTCOMES)[number];
export const EXPORT_OUTCOMES = ["success", "failure", "cancelled", "unknown"] as const;
export type StudyExportOutcome = (typeof EXPORT_OUTCOMES)[number];
export const EXPORT_BLOCKERS = ["none", "no-path", "invalid-mechanism", "board-fit", "missing-part", "collision", "unsupported", "unknown"] as const;
export type StudyExportBlocker = (typeof EXPORT_BLOCKERS)[number];
export const AUTOSAVE_OUTCOMES = ["success", "failure", "unknown"] as const;
export type StudyAutosaveOutcome = (typeof AUTOSAVE_OUTCOMES)[number];
export const IMAGE_INFERENCE_OUTCOMES = ["success", "failure", "unknown"] as const;
export type StudyImageInferenceOutcome = (typeof IMAGE_INFERENCE_OUTCOMES)[number];
export const ERROR_NAMES = ["Error", "ReferenceError", "SyntaxError", "TypeError", "RangeError", "AbortError", "NetworkError", "NotSupportedError", "QuotaExceededError", "SecurityError", "unknown"] as const;
export type StudyErrorName = (typeof ERROR_NAMES)[number];
export const VIEWPORT_BUCKETS = ["small", "medium", "large", "unknown"] as const;
export type StudyViewportBucket = (typeof VIEWPORT_BUCKETS)[number];
export const HARDWARE_BUCKETS = ["low", "medium", "high", "unknown"] as const;
export type StudyHardwareBucket = (typeof HARDWARE_BUCKETS)[number];
export const POINTER_BUCKETS = ["mouse", "touch", "pen", "unknown"] as const;
export type StudyPointerBucket = (typeof POINTER_BUCKETS)[number];
export const NETWORK_BUCKETS = ["offline", "slow", "fast", "unknown"] as const;
export type StudyNetworkBucket = (typeof NETWORK_BUCKETS)[number];
export const LATENCY_BUCKET_UPPER_MS = [1, 4, 8, 16, 32, 64, 128, 250, 500, 1_000, 2_000, 5_000] as const;
export const LATENCY_BUCKET_COUNT = LATENCY_BUCKET_UPPER_MS.length + 1;
export const FIXED_ARRAY_CELL_COUNT =
  STAGES.length * 2 +
  COMMAND_FAMILIES.length * 4 +
  MECHANISM_FAMILIES.length +
  FIT_OUTCOMES.length +
  LATENCY_BUCKET_COUNT +
  EXPORT_OUTCOMES.length +
  EXPORT_BLOCKERS.length +
  LATENCY_BUCKET_COUNT * 2 +
  ERROR_NAMES.length;
export const FIXED_SCALAR_CELL_COUNT = 14;
export const STUDY_SUMMARY_NUMBER_CELL_BYTES = 16;
export const STUDY_SUMMARY_FIXED_OVERHEAD_BYTES = 8_192;
export const STUDY_SUMMARY_MEMORY_ESTIMATE_BYTES =
  (FIXED_ARRAY_CELL_COUNT + FIXED_SCALAR_CELL_COUNT) * STUDY_SUMMARY_NUMBER_CELL_BYTES +
  MAX_STUDY_SUMMARY_BYTES +
  STUDY_SUMMARY_FIXED_OVERHEAD_BYTES;

export type StudySummaryProfile = "off" | "metrics" | "study";
export const normalizeProfile = (value: unknown): StudySummaryProfile => value === "study" || value === "metrics" || value === "off" ? value : "off";
export type StudyPerformanceSummary = {
  inputLatencyP95Ms: number | null;
  inputLatencyDeltaP95Ms: number | null;
  inputLatencyDeltaPercentP95: number | null;
  frameIntervalP95Ms: number | null;
  frameIntervalDeltaPercentP95: number | null;
  longTasksOver50Ms: number | null;
};
export type StudyPerformanceInput = Partial<StudyPerformanceSummary>;
export type StudySummaryContext = {
  viewport: StudyViewportBucket;
  hardwareConcurrency: StudyHardwareBucket;
  pointer: StudyPointerBucket;
  network: StudyNetworkBucket;
};
export type StudySummaryContextInput = {
  viewport?: unknown;
  hardwareConcurrency?: unknown;
  pointer?: unknown;
  network?: unknown;
};
export type StudySummary = {
  schema: typeof STUDY_SUMMARY_SCHEMA;
  buildSha: string;
  profile: StudySummaryProfile;
  sessionDurationMs: number;
  context: StudySummaryContext;
  stageEntries: readonly number[];
  stageDurationMs: readonly number[];
  commandAccepted: readonly number[];
  commandRejected: readonly number[];
  commandNoOp: readonly number[];
  commandUnknown: readonly number[];
  mechanismFamilies: readonly number[];
  fitRequests: number;
  fitOutcomes: readonly number[];
  fitLatency: readonly number[];
  exportAttempts: number;
  exportOutcomes: readonly number[];
  exportBlockers: readonly number[];
  autosaveSuccess: number;
  autosaveFailure: number;
  autosaveRecovery: number;
  autosaveDuration: readonly number[];
  imageInferenceSuccess: number;
  imageInferenceFailure: number;
  imageInferenceLatency: readonly number[];
  errorNames: readonly number[];
  performance: StudyPerformanceSummary;
};
export type StudySummaryClock = { now: () => number } | (() => number);
export type StudySummaryTransport = {
  send: (endpoint: string, payload: string) => void | Promise<unknown>;
  beacon?: (endpoint: string, payload: string) => boolean | void;
};
export type StudySummarySessionOptions = {
  buildSha: string;
  profile: StudySummaryProfile;
  endpoint: string;
  clock?: StudySummaryClock;
  transport?: StudySummaryTransport;
  context?: StudySummaryContextInput;
  initialStage?: StudyStage;
};
export type StudySummaryInspection = {
  summary: StudySummary;
  payload: string;
  payloadBytes: number;
  estimatedMemoryBytes: number;
  normalSendCount: number;
  beaconCount: number;
  normalFlushAttempted: boolean;
  beaconAttempted: boolean;
};
export type StudySummarySession = {
  readonly profile: StudySummaryProfile;
  enterStage: (stage: StudyStage) => void;
  recordCommand: (family: StudyCommandFamily, outcome: StudyCommandOutcome) => void;
  recordMechanism: (family: StudyMechanismFamily) => void;
  recordFit: (outcome: StudyFitOutcome, latencyMs?: number) => void;
  recordExport: (outcome: StudyExportOutcome, blocker?: StudyExportBlocker) => void;
  recordAutosave: (outcome: StudyAutosaveOutcome, recovery?: boolean, durationMs?: number) => void;
  recordImageInference: (outcome: StudyImageInferenceOutcome, latencyMs?: number) => void;
  recordError: (errorName: StudyErrorName) => void;
  recordPerformance: (summary: StudyPerformanceInput) => void;
  flush: () => Promise<boolean>;
  beacon: () => boolean;
  snapshot: () => StudySummary;
  inspect: () => StudySummaryInspection;
};

const canonical = <T extends string>(value: unknown, values: readonly T[]): T =>
  typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : values[values.length - 1];
export const normalizeStage = (value: unknown): StudyStage => canonical(value, STAGES);
export const normalizeCommandFamily = (value: unknown): StudyCommandFamily => canonical(value, COMMAND_FAMILIES);
export const normalizeCommandOutcome = (value: unknown): StudyCommandOutcome => canonical(value, COMMAND_OUTCOMES);
export const normalizeMechanismFamily = (value: unknown): StudyMechanismFamily => canonical(value, MECHANISM_FAMILIES);
export const normalizeFitOutcome = (value: unknown): StudyFitOutcome => canonical(value, FIT_OUTCOMES);
export const normalizeExportOutcome = (value: unknown): StudyExportOutcome => canonical(value, EXPORT_OUTCOMES);
export const normalizeExportBlocker = (value: unknown): StudyExportBlocker => canonical(value, EXPORT_BLOCKERS);
export const normalizeAutosaveOutcome = (value: unknown): StudyAutosaveOutcome => canonical(value, AUTOSAVE_OUTCOMES);
export const normalizeImageInferenceOutcome = (value: unknown): StudyImageInferenceOutcome => canonical(value, IMAGE_INFERENCE_OUTCOMES);
export const normalizeErrorName = (value: unknown): StudyErrorName => {
  const token = typeof value === "string" ? value : "";
  return canonical(token, ERROR_NAMES);
};
export const normalizeViewportBucket = (value: unknown): StudyViewportBucket => {
  if (typeof value === "number" && Number.isFinite(value)) return value <= 640 ? "small" : value <= 1_440 ? "medium" : "large";
  if (value && typeof value === "object" && typeof (value as { width?: unknown }).width === "number") return normalizeViewportBucket((value as { width: number }).width);
  return canonical(value, VIEWPORT_BUCKETS);
};
export const normalizeHardwareBucket = (value: unknown): StudyHardwareBucket => {
  if (typeof value === "number" && Number.isFinite(value)) return value <= 4 ? "low" : value <= 8 ? "medium" : "high";
  return canonical(value, HARDWARE_BUCKETS);
};
export const normalizePointerBucket = (value: unknown): StudyPointerBucket => canonical(value, POINTER_BUCKETS);
export const normalizeNetworkBucket = (value: unknown): StudyNetworkBucket => canonical(value, NETWORK_BUCKETS);
export const normalizeBuildSha = (value: unknown): string => typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value) ? value.toLowerCase() : "unknown";

export const finiteNonnegative = (value: unknown, max = MAX_STUDY_SUMMARY_DURATION_MS): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(max, Math.round(value));
};
export const latencyBucketIndex = (value: unknown): number | null => {
  const duration = finiteNonnegative(value);
  if (duration === null) return null;
  const index = LATENCY_BUCKET_UPPER_MS.findIndex((limit) => duration <= limit);
  return index >= 0 ? index : LATENCY_BUCKET_COUNT - 1;
};
export const estimateStudySummaryMemoryBytes = (): number => STUDY_SUMMARY_MEMORY_ESTIMATE_BYTES;

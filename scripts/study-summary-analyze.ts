import { readFile, writeFile } from "node:fs/promises";
import {
  COMMAND_FAMILIES,
  ERROR_NAMES,
  EXPORT_BLOCKERS,
  EXPORT_OUTCOMES,
  FIT_OUTCOMES,
  IMAGE_INFERENCE_OUTCOMES,
  LATENCY_BUCKET_UPPER_MS,
  MECHANISM_FAMILIES,
  normalizeBuildSha,
  STUDY_SUMMARY_SCHEMA,
  STAGES,
  type StudySummary,
  type StudySummaryProfile,
} from "../utils/studySummaryTelemetry";

export type StudyRate = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export type StudyBucketPercentile = {
  percentile: number;
  count: number;
  bucketIndex: number | null;
  upperBoundMs: number | null;
};

export type StudySummaryGroup = {
  buildSha: string;
  profile: StudySummaryProfile | "unknown";
  sessionCount: number;
  sessionDuration: { count: number; medianMs: number | null };
  fitAcceptedRate: StudyRate;
  exportSuccessRate: StudyRate;
  autosaveSuccessRate: StudyRate;
  imageInferenceSuccessRate: StudyRate;
  fitLatencyP50: StudyBucketPercentile;
  fitLatencyP95: StudyBucketPercentile;
};

export type StudySummaryAnalysis = {
  schema: typeof STUDY_SUMMARY_SCHEMA;
  totalRecords: number;
  validSessions: number;
  missingSessions: number;
  missingFields: Record<string, number>;
  counts: {
    stageEntries: number[];
    commandAccepted: number[];
    commandRejected: number[];
    commandNoOp: number[];
    commandUnknown: number[];
    mechanismFamilies: number[];
    fitOutcomes: number[];
    exportOutcomes: number[];
    exportBlockers: number[];
    errorNames: number[];
  };
  rates: {
    fitAccepted: StudyRate;
    exportSuccess: StudyRate;
    autosaveSuccess: StudyRate;
    imageInferenceSuccess: StudyRate;
  };
  sessionDuration: { count: number; medianMs: number | null };
  latency: {
    fitP50: StudyBucketPercentile;
    fitP95: StudyBucketPercentile;
    autosaveP50: StudyBucketPercentile;
    autosaveP95: StudyBucketPercentile;
    imageInferenceP50: StudyBucketPercentile;
    imageInferenceP95: StudyBucketPercentile;
  };
  stratification: StudySummaryGroup[];
};

const MISSING_FIELD_NAMES = [
  "schema",
  "buildSha",
  "profile",
  "sessionDurationMs",
  "stageEntries",
  "stageDurationMs",
  "commandAccepted",
  "commandRejected",
  "commandNoOp",
  "commandUnknown",
  "mechanismFamilies",
  "fitRequests",
  "fitOutcomes",
  "fitLatency",
  "exportAttempts",
  "exportOutcomes",
  "exportBlockers",
  "autosaveSuccess",
  "autosaveFailure",
  "autosaveRecovery",
  "autosaveDuration",
  "imageInferenceSuccess",
  "imageInferenceFailure",
  "imageInferenceLatency",
  "errorNames",
  "performance",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const numberValue = (value: unknown): number => finite(value) ?? 0;
const arrayValue = (value: unknown, size: number): number[] => {
  if (!Array.isArray(value)) return Array.from({ length: size }, () => 0);
  return Array.from({ length: size }, (_, index) => numberValue(value[index]));
};
const addArrays = (target: number[], value: unknown, size: number): void => {
  const source = arrayValue(value, size);
  for (let index = 0; index < size; index += 1) target[index] += source[index];
};
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const countOf = (value: unknown): number => Math.max(0, Math.floor(numberValue(value)));

export const median = (values: readonly number[]): number | null => {
  const ordered = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

export const rate = (numerator: number, denominator: number): StudyRate => ({
  numerator,
  denominator,
  value: denominator > 0 ? numerator / denominator : null,
});

export const fixedBucketPercentile = (
  histogram: readonly number[],
  percentile: number,
): StudyBucketPercentile => {
  const safePercentile = Math.min(1, Math.max(0, Number.isFinite(percentile) ? percentile : 0));
  const counts = LATENCY_BUCKET_UPPER_MS.map((_, index) => countOf(histogram[index]));
  const finalIndex = LATENCY_BUCKET_UPPER_MS.length;
  counts.push(countOf(histogram[finalIndex]));
  const count = sum(counts);
  if (!count) return { percentile: safePercentile, count: 0, bucketIndex: null, upperBoundMs: null };
  const rank = Math.max(1, Math.ceil(count * safePercentile));
  let cumulative = 0;
  for (let index = 0; index < counts.length; index += 1) {
    cumulative += counts[index];
    if (cumulative >= rank) {
      return {
        percentile: safePercentile,
        count,
        bucketIndex: index,
        upperBoundMs: index < LATENCY_BUCKET_UPPER_MS.length ? LATENCY_BUCKET_UPPER_MS[index] : null,
      };
    }
  }
  return { percentile: safePercentile, count, bucketIndex: finalIndex, upperBoundMs: null };
};

const missingFieldsOf = (value: Record<string, unknown>): Record<string, number> => {
  const missing: Record<string, number> = {};
  for (const field of MISSING_FIELD_NAMES) {
    if (!(field in value)) missing[field] = 1;
  }
  return missing;
};

const addMissingFields = (target: Record<string, number>, value: Record<string, unknown>): void => {
  for (const [field, count] of Object.entries(missingFieldsOf(value))) target[field] = (target[field] ?? 0) + count;
};

const profileOf = (value: unknown): StudySummaryProfile | "unknown" =>
  value === "off" || value === "metrics" || value === "study" ? value : "unknown";
const buildShaOf = (value: unknown): string => normalizeBuildSha(value);

const isSummary = (value: unknown): value is StudySummary =>
  isRecord(value) && value.schema === STUDY_SUMMARY_SCHEMA;

const emptyCounts = () => ({
  stageEntries: Array.from({ length: STAGES.length }, () => 0),
  commandAccepted: Array.from({ length: COMMAND_FAMILIES.length }, () => 0),
  commandRejected: Array.from({ length: COMMAND_FAMILIES.length }, () => 0),
  commandNoOp: Array.from({ length: COMMAND_FAMILIES.length }, () => 0),
  commandUnknown: Array.from({ length: COMMAND_FAMILIES.length }, () => 0),
  mechanismFamilies: Array.from({ length: MECHANISM_FAMILIES.length }, () => 0),
  fitOutcomes: Array.from({ length: FIT_OUTCOMES.length }, () => 0),
  exportOutcomes: Array.from({ length: EXPORT_OUTCOMES.length }, () => 0),
  exportBlockers: Array.from({ length: EXPORT_BLOCKERS.length }, () => 0),
  errorNames: Array.from({ length: ERROR_NAMES.length }, () => 0),
});

type AggregateState = {
  buildSha: string;
  profile: StudySummaryProfile | "unknown";
  sessionCount: number;
  durations: number[];
  fitAccepted: number;
  fitDenominator: number;
  exportSuccess: number;
  exportDenominator: number;
  autosaveSuccess: number;
  autosaveDenominator: number;
  imageInferenceSuccess: number;
  imageInferenceDenominator: number;
  fitLatency: number[];
};

const newGroup = (buildSha: string, profile: StudySummaryProfile | "unknown"): AggregateState => ({
  buildSha,
  profile,
  sessionCount: 0,
  durations: [],
  fitAccepted: 0,
  fitDenominator: 0,
  exportSuccess: 0,
  exportDenominator: 0,
  autosaveSuccess: 0,
  autosaveDenominator: 0,
  imageInferenceSuccess: 0,
  imageInferenceDenominator: 0,
  fitLatency: [],
});

const groupKey = (buildSha: string, profile: StudySummaryProfile | "unknown"): string => `${buildSha}\u0000${profile}`;

const summaryGroup = (group: AggregateState): StudySummaryGroup => ({
  buildSha: group.buildSha,
  profile: group.profile,
  sessionCount: group.sessionCount,
  sessionDuration: { count: group.durations.length, medianMs: median(group.durations) },
  fitAcceptedRate: rate(group.fitAccepted, group.fitDenominator),
  exportSuccessRate: rate(group.exportSuccess, group.exportDenominator),
  autosaveSuccessRate: rate(group.autosaveSuccess, group.autosaveDenominator),
  imageInferenceSuccessRate: rate(group.imageInferenceSuccess, group.imageInferenceDenominator),
  fitLatencyP50: fixedBucketPercentile(group.fitLatency, 0.5),
  fitLatencyP95: fixedBucketPercentile(group.fitLatency, 0.95),
});

/**
 * Aggregate already-computed summaries. This function never replays actions or
 * infers causality; malformed records become explicit missingness instead.
 */
export const analyzeStudySummaries = (records: readonly unknown[]): StudySummaryAnalysis => {
  const counts = emptyCounts();
  const missingFields: Record<string, number> = {};
  const durations: number[] = [];
  const fitLatency: number[] = [];
  const autosaveLatency: number[] = [];
  const imageInferenceLatency: number[] = [];
  const groups = new Map<string, AggregateState>();
  let missingSessions = 0;
  let validSessions = 0;
  let fitAccepted = 0;
  let fitDenominator = 0;
  let exportSuccess = 0;
  let exportDenominator = 0;
  let autosaveSuccess = 0;
  let autosaveDenominator = 0;
  let imageInferenceSuccess = 0;
  let imageInferenceDenominator = 0;

  for (const record of records) {
    if (!isRecord(record) || !isSummary(record)) {
      missingSessions += 1;
      continue;
    }
    validSessions += 1;
    addMissingFields(missingFields, record);
    addArrays(counts.stageEntries, record.stageEntries, STAGES.length);
    addArrays(counts.commandAccepted, record.commandAccepted, COMMAND_FAMILIES.length);
    addArrays(counts.commandRejected, record.commandRejected, COMMAND_FAMILIES.length);
    addArrays(counts.commandNoOp, record.commandNoOp, COMMAND_FAMILIES.length);
    addArrays(counts.commandUnknown, record.commandUnknown, COMMAND_FAMILIES.length);
    addArrays(counts.mechanismFamilies, record.mechanismFamilies, MECHANISM_FAMILIES.length);
    addArrays(counts.fitOutcomes, record.fitOutcomes, FIT_OUTCOMES.length);
    addArrays(counts.exportOutcomes, record.exportOutcomes, EXPORT_OUTCOMES.length);
    addArrays(counts.exportBlockers, record.exportBlockers, EXPORT_BLOCKERS.length);
    addArrays(counts.errorNames, record.errorNames, ERROR_NAMES.length);

    const sessionDuration = finite(record.sessionDurationMs);
    if (sessionDuration !== null) durations.push(sessionDuration);
    const fitAttempts = countOf(record.fitRequests);
    const fitAcceptedForSession = countOf(record.fitOutcomes?.[0]);
    const exports = countOf(record.exportAttempts);
    const successfulExports = countOf(record.exportOutcomes?.[0]);
    const autosaveSuccessForSession = countOf(record.autosaveSuccess);
    const autosaveFailureForSession = countOf(record.autosaveFailure);
    const imageSuccessForSession = countOf(record.imageInferenceSuccess);
    const imageFailureForSession = countOf(record.imageInferenceFailure);
    fitAccepted += fitAcceptedForSession;
    fitDenominator += fitAttempts;
    exportSuccess += successfulExports;
    exportDenominator += exports;
    autosaveSuccess += autosaveSuccessForSession;
    autosaveDenominator += autosaveSuccessForSession + autosaveFailureForSession;
    imageInferenceSuccess += imageSuccessForSession;
    imageInferenceDenominator += imageSuccessForSession + imageFailureForSession;
    for (const [target, source] of [[fitLatency, record.fitLatency], [autosaveLatency, record.autosaveDuration], [imageInferenceLatency, record.imageInferenceLatency]] as const) {
      if (Array.isArray(source)) {
        for (let index = 0; index < LATENCY_BUCKET_UPPER_MS.length + 1; index += 1) target[index] = (target[index] ?? 0) + countOf(source[index]);
      }
    }

    const buildSha = buildShaOf(record.buildSha);
    const profile = profileOf(record.profile);
    const key = groupKey(buildSha, profile);
    const group = groups.get(key) ?? newGroup(buildSha, profile);
    group.sessionCount += 1;
    if (sessionDuration !== null) group.durations.push(sessionDuration);
    group.fitAccepted += fitAcceptedForSession;
    group.fitDenominator += fitAttempts;
    group.exportSuccess += successfulExports;
    group.exportDenominator += exports;
    group.autosaveSuccess += autosaveSuccessForSession;
    group.autosaveDenominator += autosaveSuccessForSession + autosaveFailureForSession;
    group.imageInferenceSuccess += imageSuccessForSession;
    group.imageInferenceDenominator += imageSuccessForSession + imageFailureForSession;
    if (Array.isArray(record.fitLatency)) {
      for (let index = 0; index < LATENCY_BUCKET_UPPER_MS.length + 1; index += 1) group.fitLatency[index] = (group.fitLatency[index] ?? 0) + countOf(record.fitLatency[index]);
    }
    groups.set(key, group);
  }

  const sortedGroups = [...groups.values()]
    .sort((a, b) => a.buildSha.localeCompare(b.buildSha) || a.profile.localeCompare(b.profile))
    .map(summaryGroup);
  return {
    schema: STUDY_SUMMARY_SCHEMA,
    totalRecords: records.length,
    validSessions,
    missingSessions,
    missingFields,
    counts,
    rates: {
      fitAccepted: rate(fitAccepted, fitDenominator),
      exportSuccess: rate(exportSuccess, exportDenominator),
      autosaveSuccess: rate(autosaveSuccess, autosaveDenominator),
      imageInferenceSuccess: rate(imageInferenceSuccess, imageInferenceDenominator),
    },
    sessionDuration: { count: durations.length, medianMs: median(durations) },
    latency: {
      fitP50: fixedBucketPercentile(fitLatency, 0.5),
      fitP95: fixedBucketPercentile(fitLatency, 0.95),
      autosaveP50: fixedBucketPercentile(autosaveLatency, 0.5),
      autosaveP95: fixedBucketPercentile(autosaveLatency, 0.95),
      imageInferenceP50: fixedBucketPercentile(imageInferenceLatency, 0.5),
      imageInferenceP95: fixedBucketPercentile(imageInferenceLatency, 0.95),
    },
    stratification: sortedGroups,
  };
};

/** Parse a JSON array, one JSON object, an object with `sessions`, or JSONL. */
export const parseStudySummaryText = (text: string): unknown[] => {
  const source = text.trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.sessions)) return parsed.sessions;
    return [parsed];
  } catch {
    return source.split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    });
  }
};

export const analyzeStudySummaryText = (text: string): StudySummaryAnalysis =>
  analyzeStudySummaries(parseStudySummaryText(text));

const cli = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const input = args.find((value) => !value.startsWith("--"));
  if (!input) {
    console.error("Usage: bun scripts/study-summary-analyze.ts <summary.json|summary.jsonl> [--out path]");
    process.exitCode = 1;
    return;
  }
  const outputFlag = args.indexOf("--out");
  const output = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
  const result = analyzeStudySummaryText(await readFile(input, "utf8"));
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) await writeFile(output, json, { encoding: "utf8" });
  process.stdout.write(json);
};

if (process.argv[1]?.endsWith("study-summary-analyze.ts")) void cli();

import { strict as assert } from "node:assert";
import {
  LATENCY_BUCKET_UPPER_MS,
  createStudySummarySession,
  makeEmptyStudySummary,
} from "../utils/studySummaryTelemetry";
import {
  analyzeStudySummaries,
  analyzeStudySummaryText,
  fixedBucketPercentile,
  median,
  parseStudySummaryText,
} from "../scripts/study-summary-analyze";

let now = 0;
const clock = () => now;
const first = createStudySummarySession({ buildSha: "abcdef1", profile: "study", endpoint: "unused", clock });
first.recordFit("accepted", 17);
first.recordExport("success");
first.recordAutosave("success", false, 10);
first.recordImageInference("success", 300);
now = 100;
const second = createStudySummarySession({ buildSha: "abcdef1", profile: "study", endpoint: "unused", clock });
second.recordFit("rejected", 600);
second.recordExport("failure", "no-path");
second.recordAutosave("failure", false, 700);
second.recordImageInference("failure", 5_001);
now = 200;
const third = createStudySummarySession({ buildSha: "abcdef2", profile: "metrics", endpoint: "unused", clock });
third.recordMechanism("gear");

const result = analyzeStudySummaries([first.snapshot(), second.snapshot(), third.snapshot(), null, { schema: "other" }]);
assert.equal(result.totalRecords, 5);
assert.equal(result.validSessions, 3);
assert.equal(result.missingSessions, 2);
assert.equal(result.rates.fitAccepted.numerator, 1);
assert.equal(result.rates.fitAccepted.denominator, 2);
assert.equal(result.rates.fitAccepted.value, 0.5);
assert.equal(result.rates.exportSuccess.value, 0.5);
assert.equal(result.rates.autosaveSuccess.value, 0.5);
assert.equal(result.rates.imageInferenceSuccess.value, 0.5);
assert.equal(result.latency.fitP50.upperBoundMs, 32);
assert.equal(result.latency.fitP95.upperBoundMs, 1_000);
assert.equal(result.latency.autosaveP50.upperBoundMs, 16);
assert.equal(result.latency.autosaveP95.upperBoundMs, 1_000);
assert.equal(result.latency.imageInferenceP95.upperBoundMs, null);
assert.equal(result.sessionDuration.count, 3);
assert.equal(result.sessionDuration.medianMs, 100);
assert.equal(result.stratification.length, 2);
assert.deepEqual(result.stratification.map((group) => `${group.buildSha}/${group.profile}`), ["abcdef1/study", "abcdef2/metrics"]);
assert.equal(result.stratification[0].fitAcceptedRate.value, 0.5);

const incomplete = { schema: "study-summary-v1", buildSha: "abcdef3", profile: "study" };
const missingResult = analyzeStudySummaries([incomplete]);
assert.equal(missingResult.validSessions, 1);
assert.equal(missingResult.missingFields.fitLatency, 1);
assert.equal(missingResult.missingFields.performance, 1);

assert.equal(median([]), null);
assert.equal(median([9, 1, 5]), 5);
assert.equal(median([9, 1]), 5);
assert.deepEqual(fixedBucketPercentile([], 0.95), { percentile: 0.95, count: 0, bucketIndex: null, upperBoundMs: null });
assert.equal(fixedBucketPercentile([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5).upperBoundMs, LATENCY_BUCKET_UPPER_MS[2]);

const json = JSON.stringify([first.snapshot(), second.snapshot()]);
assert.equal(parseStudySummaryText(json).length, 2);
assert.equal(parseStudySummaryText(JSON.stringify({ sessions: [first.snapshot()] })).length, 1);
assert.equal(parseStudySummaryText(`${JSON.stringify(first.snapshot())}\nnot-json\n${JSON.stringify(second.snapshot())}`).length, 3);
assert.equal(analyzeStudySummaryText(`${JSON.stringify(first.snapshot())}\nnot-json`).missingSessions, 1);
assert.equal(makeEmptyStudySummary().schema, "study-summary-v1");

console.log("study-summary-analyze: ok");

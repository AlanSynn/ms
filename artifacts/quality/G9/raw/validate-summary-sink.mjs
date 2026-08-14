import assert from "node:assert/strict";

const endpoint = process.argv[2] ?? "http://127.0.0.1:43197/stats";
const expectedSha = "0707c38aaf2ddc121cdfc550a2067812354b0123";
const expectedTopLevel = [
  "autosaveDuration",
  "autosaveFailure",
  "autosaveRecovery",
  "autosaveSuccess",
  "buildSha",
  "commandAccepted",
  "commandNoOp",
  "commandRejected",
  "commandUnknown",
  "context",
  "errorNames",
  "exportAttempts",
  "exportBlockers",
  "exportOutcomes",
  "fitLatency",
  "fitOutcomes",
  "fitRequests",
  "imageInferenceFailure",
  "imageInferenceLatency",
  "imageInferenceSuccess",
  "mechanismFamilies",
  "performance",
  "profile",
  "schema",
  "sessionDurationMs",
  "stageDurationMs",
  "stageEntries",
].sort();
const expectedContext = [
  "hardwareConcurrency",
  "network",
  "pointer",
  "viewport",
].sort();
const expectedPerformance = [
  "frameIntervalDeltaPercentP95",
  "frameIntervalP95Ms",
  "inputLatencyDeltaP95Ms",
  "inputLatencyDeltaPercentP95",
  "inputLatencyP95Ms",
  "longTasksOver50Ms",
].sort();

const response = await fetch(endpoint);
assert.equal(response.ok, true, "summary sink stats must be readable");
const stats = await response.json();
assert.equal(stats.requestCount, 2, "one normal POST plus one exit beacon");
assert.deepEqual(
  stats.requests.map((request) => request.secFetchMode),
  ["cors", "no-cors"],
  "normal POST precedes the exit beacon",
);

for (const request of stats.requests) {
  assert(request.bytes <= 8_192, `payload ${request.bytes} exceeds 8,192 bytes`);
  assert.match(request.contentType, /^text\/plain;charset=/i);
  assert.equal(request.origin, "http://127.0.0.1:43196");
  const summary = JSON.parse(request.body);
  assert.deepEqual(Object.keys(summary).sort(), expectedTopLevel);
  assert.deepEqual(Object.keys(summary.context).sort(), expectedContext);
  assert.deepEqual(Object.keys(summary.performance).sort(), expectedPerformance);
  assert.equal(summary.schema, "study-summary-v1");
  assert.equal(summary.buildSha, expectedSha);
  assert.equal(summary.profile, "study");
  assert(!request.body.includes("Make a hand wave"));
  assert(!request.body.includes(".motionsmith"));
  assert(!request.body.includes("@"));
}

console.log(
  JSON.stringify({
    requestCount: stats.requestCount,
    modes: stats.requests.map((request) => request.secFetchMode),
    bytes: stats.requests.map((request) => request.bytes),
    schema: "study-summary-v1",
    buildSha: expectedSha,
    exactAllowlist: true,
    sensitiveSentinelsAbsent: true,
  }),
);

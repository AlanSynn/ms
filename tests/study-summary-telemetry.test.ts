import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  COMMAND_FAMILIES,
  ERROR_NAMES,
  EXPORT_BLOCKERS,
  FIT_OUTCOMES,
  FIXED_ARRAY_CELL_COUNT,
  FIXED_SCALAR_CELL_COUNT,
  LATENCY_BUCKET_COUNT,
  MAX_STUDY_SUMMARY_BYTES,
  MAX_STUDY_SUMMARY_COUNTER,
  MAX_STUDY_SUMMARY_MEMORY_BYTES,
  STAGES,
  STUDY_SUMMARY_FIXED_OVERHEAD_BYTES,
  STUDY_SUMMARY_MEMORY_ESTIMATE_BYTES,
  STUDY_SUMMARY_NUMBER_CELL_BYTES,
  createStudySummarySession,
  normalizeBuildSha,
  normalizeCommandOutcome,
  normalizeMechanismFamily,
  normalizeExportBlocker,
  normalizeExportOutcome,
  normalizeFitOutcome,
  normalizeErrorName,
} from "../utils/studySummaryTelemetry";

let now = 0;
const clock = () => now;
const session = createStudySummarySession({
  buildSha: "ABCDEF1",
  profile: "study",
  endpoint: "https://collector.invalid/summary",
  clock,
  initialStage: "character",
  context: {
    viewport: { width: 1280, height: 720 },
    hardwareConcurrency: 8,
    pointer: "pen",
    network: "fast",
  },
});

now = 100;
session.enterStage("path");
now = 150;
session.recordCommand("authoring", "accepted");
session.recordCommand("unknown", "no-op");
session.recordCommand("unknown", "unknown");
session.recordMechanism("four-bar");
session.recordFit("accepted", 17);
session.recordFit("unknown", 9_999);
session.recordExport("success", undefined);
session.recordExport("failure", "board-fit");
session.recordAutosave("success", true, 8);
session.recordAutosave("failure", false, 700);
session.recordImageInference("success", 300);
session.recordImageInference("failure", 5_001);
session.recordError("TypeError");
session.recordError("unknown");
session.recordPerformance({
  inputLatencyP95Ms: 12,
  inputLatencyDeltaP95Ms: 0.5,
  inputLatencyDeltaPercentP95: 1.2,
  frameIntervalP95Ms: 18,
  frameIntervalDeltaPercentP95: 1.5,
  longTasksOver50Ms: 0,
});

const summary = session.snapshot();
const payload = JSON.stringify(summary);
assert.equal(summary.schema, "study-summary-v1");
assert.equal(summary.buildSha, "abcdef1");
assert.deepEqual(summary.context, { viewport: "medium", hardwareConcurrency: "medium", pointer: "pen", network: "fast" });
assert.equal(summary.stageEntries[STAGES.indexOf("character")], 1);
assert.equal(summary.stageEntries[STAGES.indexOf("path")], 1);
assert.equal(summary.stageDurationMs[STAGES.indexOf("character")], 100);
assert.equal(summary.stageDurationMs[STAGES.indexOf("path")], 50);
assert.equal(summary.commandAccepted[COMMAND_FAMILIES.indexOf("authoring")], 1);
assert.equal(summary.commandNoOp[COMMAND_FAMILIES.indexOf("unknown")], 1);
assert.equal(summary.commandUnknown[COMMAND_FAMILIES.indexOf("unknown")], 1);
assert.equal(summary.mechanismFamilies[0], 1);
assert.equal(summary.fitRequests, 2);
assert.equal(summary.fitOutcomes[FIT_OUTCOMES.indexOf("accepted")], 1);
assert.equal(summary.fitOutcomes[FIT_OUTCOMES.indexOf("unknown")], 1);
assert.equal(summary.exportAttempts, 2);
assert.equal(summary.exportBlockers[EXPORT_BLOCKERS.indexOf("none")], 1);
assert.equal(summary.exportBlockers[EXPORT_BLOCKERS.indexOf("board-fit")], 1);
assert.equal(summary.autosaveSuccess, 1);
assert.equal(summary.autosaveFailure, 1);
assert.equal(summary.autosaveRecovery, 1);
assert.equal(summary.fitLatency.reduce((a, b) => a + b, 0), 2);
assert.equal(summary.autosaveDuration.reduce((a, b) => a + b, 0), 2);
assert.equal(summary.imageInferenceSuccess, 1);
assert.equal(summary.imageInferenceFailure, 1);
assert.equal(summary.imageInferenceLatency.reduce((a, b) => a + b, 0), 2);
assert.equal(summary.errorNames[ERROR_NAMES.indexOf("TypeError")], 1);
assert.equal(summary.errorNames[ERROR_NAMES.indexOf("unknown")], 1);
assert.equal(summary.performance.inputLatencyP95Ms, 12);
assert(!payload.includes("private message"));
assert(!payload.includes("secret.json"));
assert(!payload.includes("/tmp"));
assert(!payload.includes("fourbar"));
assert(!payload.includes("board_fit"));
assert(!payload.includes("https://collector.invalid"));
assert(new TextEncoder().encode(payload).byteLength <= MAX_STUDY_SUMMARY_BYTES);
assert(session.inspect().estimatedMemoryBytes < MAX_STUDY_SUMMARY_MEMORY_BYTES);
assert.equal(session.inspect().estimatedMemoryBytes, STUDY_SUMMARY_MEMORY_ESTIMATE_BYTES);
assert.equal(
  STUDY_SUMMARY_MEMORY_ESTIMATE_BYTES,
  (FIXED_ARRAY_CELL_COUNT + FIXED_SCALAR_CELL_COUNT) * STUDY_SUMMARY_NUMBER_CELL_BYTES + MAX_STUDY_SUMMARY_BYTES + STUDY_SUMMARY_FIXED_OVERHEAD_BYTES,
);
assert.equal(summary.fitLatency.length, LATENCY_BUCKET_COUNT);

assert.equal(normalizeMechanismFamily("four-bar"), "four-bar");
assert.equal(normalizeMechanismFamily("fourbar"), "unknown");
assert.equal(normalizeExportBlocker("board-fit"), "board-fit");
assert.equal(normalizeExportBlocker("board_fit"), "unknown");
assert.equal(normalizeExportOutcome("success"), "success");
assert.equal(normalizeExportOutcome("ok"), "unknown");
assert.equal(normalizeFitOutcome("no-op"), "no-op");
assert.equal(normalizeFitOutcome("noop"), "unknown");
assert.equal(normalizeCommandOutcome("no-op"), "no-op");
assert.equal(normalizeCommandOutcome("no_op"), "unknown");
assert.equal(normalizeErrorName("Error"), "Error");
assert.equal(normalizeErrorName("ReferenceError"), "ReferenceError");
assert.equal(normalizeErrorName("SyntaxError"), "SyntaxError");
assert.equal(normalizeErrorName("TypeError: details"), "unknown");
assert.equal(normalizeBuildSha("ABCDEF1"), "abcdef1");
assert.equal(normalizeBuildSha("build-1"), "unknown");
assert.equal(normalizeBuildSha("a".repeat(41)), "unknown");
assert.equal(normalizeMechanismFamily("four bar with coordinates"), "unknown");

const sent: Array<{ endpoint: string; payload: string }> = [];
const beacons: Array<{ endpoint: string; payload: string }> = [];
const delivered = createStudySummarySession({
  buildSha: "abcdef2",
  profile: "metrics",
  endpoint: "injected-endpoint",
  clock,
  transport: {
    send: (endpoint, body) => sent.push({ endpoint, payload: body }),
    beacon: (endpoint, body) => {
      beacons.push({ endpoint, payload: body });
      return true;
    },
  },
});
assert.equal(await delivered.flush(), true);
assert.equal(await delivered.flush(), false);
assert.equal(delivered.beacon(), true);
assert.equal(delivered.beacon(), false);
assert.equal(sent.length, 1);
assert.equal(beacons.length, 1);
assert.equal(sent[0].endpoint, "injected-endpoint");
assert.equal(beacons[0].endpoint, "injected-endpoint");
assert.equal(delivered.inspect().normalSendCount, 1);
assert.equal(delivered.inspect().beaconCount, 1);

const disabled = createStudySummarySession({ buildSha: "abcdef3", profile: "off", endpoint: "never" });
disabled.enterStage("character");
disabled.recordCommand("authoring", "accepted");
assert.equal(disabled.snapshot().stageEntries.reduce((a, b) => a + b, 0), 0);
assert.equal(disabled.snapshot().commandAccepted.reduce((a, b) => a + b, 0), 0);
assert.equal(await disabled.flush(), false);
assert.equal(disabled.beacon(), false);

const source = readFileSync(new URL("../utils/studySummaryTelemetry.ts", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../hooks/useStudySummaryTelemetry.ts", import.meta.url), "utf8");
assert(!/pointermove|pointerdown|requestAnimationFrame|setInterval|addEventListener|localStorage|indexedDB/i.test(`${source}\n${hookSource}`));

const bounded = createStudySummarySession({ buildSha: "abcdef4", profile: "study", endpoint: "x" });
for (let index = 0; index < MAX_STUDY_SUMMARY_COUNTER + 2; index += 1) bounded.recordMechanism("custom");
assert.equal(bounded.snapshot().mechanismFamilies[6], MAX_STUDY_SUMMARY_COUNTER);

console.log("study-summary-telemetry: ok");

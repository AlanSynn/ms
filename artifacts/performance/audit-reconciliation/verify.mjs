import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const baseline = "97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af";
const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(repository, relativePath), "utf8"));

const cpu = await readJson(
  "artifacts/performance/audit-cpu/raw/runtime-evidence.json",
);
const gpu = await readJson(
  "artifacts/performance/audit-gpu/raw/runtime-headful-attempt-3.json",
);
const orcaSession = await readJson(
  "artifacts/performance/orca-baseline/raw/session.json",
);
const orcaBlocker = await readJson(
  "artifacts/performance/orca-baseline/raw/visibility-blocker.json",
);

assert.equal(cpu.baseline, baseline);
assert.equal(gpu.baseline, baseline);
assert.equal(orcaSession.worktree.head, baseline);

const cpuStage = (name) => {
  const stage = cpu.stages.find((candidate) => candidate.name === name);
  assert.ok(stage, `missing CPU stage ${name}`);
  return stage.counters;
};
const hit = (stage, name) => stage.hits[name] ?? 0;

const pathSvg = cpuStage("path-svg");
assert.equal(pathSvg.reactCommits.length, 164);
assert.equal(pathSvg.presentedRafFrameProxyCount, 164);
assert.equal(hit(pathSvg, "motion.motionPreviewForPath"), 328);

const pathThree = cpuStage("path-three");
assert.equal(hit(pathThree, "three.Box3.setFromObject:components/ThreePuppetPreview.tsx"), 910);
assert.equal(pathThree.webglClears, 65);
assert.equal(pathThree.genericJson.bytes, 132_978);

const expectedCpu = {
  foundry: {
    commits: 21,
    frames: 21,
    compiler: 1_161,
    editSafety: 3_700,
    phaseSets: 3_720,
    kinematics: 238_762,
    candidates: 20,
  },
  design: {
    commits: 30,
    frames: 31,
    compiler: 1_200,
    editSafety: 5_340,
    phaseSets: 5_370,
    kinematics: 351_240,
    candidates: 30,
  },
  assembly: {
    commits: 77,
    frames: 78,
    compiler: 308,
    editSafety: 156,
    phaseSets: 156,
    kinematics: 8_479,
    candidates: 0,
  },
};

for (const [name, expected] of Object.entries(expectedCpu)) {
  const stage = cpuStage(name);
  assert.equal(stage.reactCommits.length, expected.commits, `${name} commits`);
  assert.equal(stage.presentedRafFrameProxyCount, expected.frames, `${name} rAF proxy`);
  assert.equal(hit(stage, "inspector.compileMechanismGraphFabrication"), expected.compiler, `${name} compiler`);
  assert.equal(hit(stage, "safety.mechanismEditIsSafe"), expected.editSafety, `${name} edit safety`);
  assert.equal(hit(stage, "safety.phaseLinkageEvaluationSet"), expected.phaseSets, `${name} phase sets`);
  assert.equal(hit(stage, "motion.prepareMechanismKinematics"), expected.kinematics, `${name} kinematics`);
  assert.equal(hit(stage, "connection.enumeratePhysicalCandidates"), expected.candidates, `${name} candidates`);
}

const boot = cpu.diagnostic.stages.boot;
assert.equal(hit(boot, "autosave.serializeProject"), 3);
assert.equal(hit(boot, "autosave.writeSnapshot"), 2);
assert.equal(boot.json["project-json.serializeProjectModule"].bytes, 149_604);
assert.equal(cpu.controlledConditions.onnxModelRequests.length, 1);

const gpuScenario = (label) => {
  const scenario = gpu.scenarios.find((candidate) => candidate.label === label);
  assert.ok(scenario, `missing GPU scenario ${label}`);
  return scenario;
};
for (const [label, frames, clears] of [
  ["path-three-playback", 175, 880],
  ["foundry-planetary-playback", 34, 31],
  ["design-playback", 51, 51],
  ["assembly-playback", 253, 245],
]) {
  const scenario = gpuScenario(label);
  assert.equal(scenario.delta.animationFrames, frames, `${label} rAF proxy`);
  assert.equal(scenario.delta.totals.clearCalls, clears, `${label} clear proxy`);
}

const loop = gpuScenario("three-stage-loop-final-paused");
assert.deepEqual(
  {
    tracked: loop.after.totals.trackedContexts,
    attached: loop.after.totals.attachedContexts,
    nonLost: loop.after.totals.nonLostContexts,
    detachedNonLost: loop.after.totals.detachedNonLostContexts,
  },
  { tracked: 21, attached: 1, nonLost: 16, detachedNonLost: 15 },
);

const recovery = gpuScenario("webgl-lose-context-restore");
const restoredContext = recovery.afterRestore.contexts.find(
  (context) => context.id === recovery.restoreRequest.contextId,
);
const lostAt = restoredContext.events.find((event) => event.type === "webglcontextlost").at;
const restoredAt = restoredContext.events.find(
  (event) => event.type === "webglcontextrestored",
).at;
assert.equal(Number((restoredAt - lostAt).toFixed(1)), 516.4);
assert.equal(recovery.redrawDelta.drawCalls, 0);
assert.equal(recovery.redrawDelta.clearCalls, 0);

assert.equal(orcaSession.browser.active, true);
assert.equal(orcaSession.visibility_samples[0].visibility, "visible");
assert.equal(orcaSession.version_integrity.page_after_reload, "v0.0.9");
assert.equal(orcaSession.version_integrity.package_json, "1.1.0");
assert.equal(orcaBlocker.terminal_send_result.accepted, true);
assert.equal(orcaBlocker.terminal_read_result.latestCursor, "0");

const checkTsv = async (relativePath, columns) => {
  const source = (await readFile(path.join(repository, relativePath), "utf8")).trim();
  const rows = source.split("\n");
  rows.forEach((row, index) =>
    assert.equal(row.split("\t").length, columns, `${relativePath}:${index + 1}`),
  );
  return rows.length - 1;
};

const initialCounterRows = await checkTsv(
  "artifacts/performance/baseline/initial-counters.tsv",
  5,
);
const bottleneckRows = await checkTsv(
  "artifacts/performance/audit-reconciliation/bottleneck-ledger.tsv",
  9,
);
await checkTsv("artifacts/performance/ownership-ledger.tsv", 11);

assert.ok(initialCounterRows >= 19, "all required initial counters must be present");
assert.ok(bottleneckRows >= 10, "ledger must retain ranked claims and approval gaps");

console.log(
  JSON.stringify({
    baseline,
    status: "passed",
    initialCounterRows,
    bottleneckRows,
    pathSubmissionProxy: 880 / 175,
    finalTrackedContexts: 21,
    contextRestoreMs: 516.4,
  }),
);

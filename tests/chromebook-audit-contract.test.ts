import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookAcceptance,
  percentile,
  type PlaybackAudit,
} from "./browser/chromebookAuditReport";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

assert.deepEqual(CHROMEBOOK_AUDIT_ENVIRONMENT.viewport, { width: 1366, height: 768 });
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor, 1);
assert.equal(CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate, 6);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP50Ms, 33.3);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP95Ms, 42);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.frameP99Ms, 75);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver50Percent, 5);
assert.equal(CHROMEBOOK_ACCEPTANCE_THRESHOLDS.framesOver200, 0);
assert.equal(percentile([40, 10, 30, 20], 0.95), 40, "percentiles use deterministic nearest-rank ordering");

const passingPlayback: PlaybackAudit = {
  durationMs: 600_000,
  frameCount: 18_000,
  frameIntervalMs: { p50: 32, p95: 40, p99: 70 },
  framesOver50: 100,
  framesOver50Percent: 0.56,
  framesOver200: 0,
  longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  browserEventLatencyMs: { p50: 0, p95: 0, p99: 0 },
  reactCommits: 0,
  heap: {
    supported: true,
    samples: 122,
    firstBytes: 20_000_000,
    lastBytes: 21_000_000,
    growthBytes: 1_000_000,
    allowedGrowthBytes: 8 * 1024 * 1024,
    tailRangeBytes: 500_000,
    stable: true,
  },
  webgl: {
    before: { contextsCreated: 1, contextsLost: 0, contextsRestored: 0, attachedCanvases: 1, resources: {} },
    after: { contextsCreated: 1, contextsLost: 0, contextsRestored: 0, attachedCanvases: 1, resources: {} },
    liveResourceDelta: 0,
    contextDelta: 0,
    topologyBuildDelta: 0,
    geometryCacheDelta: 0,
    materialCacheDelta: 0,
  },
};
assert.equal(
  evaluateChromebookAcceptance(
    passingPlayback,
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  true,
  "the gate passes only a fully bounded emulation result",
);
assert.equal(
  evaluateChromebookAcceptance(
    { ...passingPlayback, framesOver200: 1 },
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  false,
  "one 200ms playback stall fails acceptance",
);
assert.equal(
  evaluateChromebookAcceptance(
    {
      ...passingPlayback,
      webgl: { ...passingPlayback.webgl, geometryCacheDelta: 1 },
    },
    { p50: 40, p95: 80, p99: 90 },
    { p50: 100, p95: 400, p99: 450 },
    0,
  ).passed.passed,
  false,
  "geometry growth during steady playback fails acceptance",
);

const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
assert(packageJson.scripts["test:chromebook-audit"].startsWith("bun run build &&"), "acceptance runs a normal production build");
assert(!packageJson.scripts["test:chromebook-audit"].includes("build:e2e"), "acceptance excludes diagnostic-build overhead");
const config = read("playwright.config.ts");
assert(config.includes("channel: 'chrome'") && config.includes("--enable-precise-memory-info"));
assert(config.includes("reuseExistingServer: !process.env.CI && !auditEnabled"), "audit cannot reuse a stale preview server");
const spec = read("tests/browser/chromebook-audit.spec.ts");
for (const stage of ["Path", "Foundry", "Design", "Blueprint", "Assembly"]) {
  assert(spec.includes(`measureStage(page, actions, \"${stage}\"`), `audit measures the ${stage} transition`);
}
assert(spec.includes("bootAiRequests") && spec.includes("actualChromebookTested: false"));
const harness = read("tests/browser/chromebookAuditHarness.ts");
assert(harness.includes("Emulation.setCPUThrottlingRate"));
assert(harness.includes("Network.emulateNetworkConditions"));
assert(harness.includes('type: "longtask"') && harness.includes('type: "event"'));
assert(harness.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__") && harness.includes("resourceMethods"));
assert(!harness.includes("value < 2_000"), "multi-second stalls remain visible to the frame gate");
const foundry = read("components/stages/foundry/ThreeFoundryPreview.tsx");
assert(foundry.includes("recordFoundryTopologyBuild"), "normal production rendering exposes topology work only to an injected audit sink");
const workflow = read("tests/browser/workflow.spec.ts");
assert(workflow.includes("clickOptionalButton") && workflow.includes("is visible before its conditional click"));

console.log("Chromebook audit contracts ok");

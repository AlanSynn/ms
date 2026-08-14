import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type CDPSession, type Page } from "@playwright/test";

const auditDirectory = path.dirname(fileURLToPath(import.meta.url));
const rawDirectory = path.join(auditDirectory, "raw");
const baseURL = process.env.MS_AUDIT_URL ?? "http://127.0.0.1:5207";
const sampleDurationMs = Number(process.env.MS_AUDIT_SAMPLE_MS ?? "2500");
const warmupDurationMs = Number(process.env.MS_AUDIT_WARMUP_MS ?? "700");

if (!Number.isFinite(sampleDurationMs) || sampleDurationMs <= 0)
  throw new Error("MS_AUDIT_SAMPLE_MS must be a positive number");
if (!Number.isFinite(warmupDurationMs) || warmupDurationMs < 0)
  throw new Error("MS_AUDIT_WARMUP_MS must be a non-negative number");

type Metric = { name: string; value: number };
type CpuProfile = {
  nodes?: Array<{
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    parent?: number;
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

type SamplingHeapProfileNode = {
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  selfSize: number;
  children?: SamplingHeapProfileNode[];
};

type SamplingHeapProfile = { head?: SamplingHeapProfileNode };

const auditInitScript = String.raw`(() => {
  const encoder = new TextEncoder();
  const byStage = Object.create(null);
  let activeStage = "boot";
  let activeRafTimestamp = null;
  const maxEvents = 400;
  const clean = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  };
  const stage = () => {
    if (!byStage[activeStage]) {
      byStage[activeStage] = {
        name: activeStage,
        startedAtMs: performance.now(),
        endedAtMs: null,
        hits: Object.create(null),
        json: Object.create(null),
        reactCommits: [],
        rafTimestampBuckets: Object.create(null),
        webglClears: 0,
        webglClearsOutsideRaf: 0,
        storageWrites: [],
        genericJson: { calls: 0, bytes: 0 },
        loaf: [],
        longTasks: [],
      };
    }
    return byStage[activeStage];
  };
  const recordJson = (label, serialized) => {
    const bucket = stage();
    const next = bucket.json[label] || { calls: 0, bytes: 0 };
    next.calls += 1;
    next.bytes += encoder.encode(serialized || "").byteLength;
    bucket.json[label] = next;
  };
  const api = {
    hit(label) {
      const bucket = stage();
      bucket.hits[label] = (bucket.hits[label] || 0) + 1;
    },
    json: recordJson,
    begin(name) {
      activeStage = name;
      const bucket = stage();
      bucket.startedAtMs = performance.now();
      bucket.endedAtMs = null;
      return name;
    },
    end() {
      const bucket = stage();
      bucket.endedAtMs = performance.now();
      const rafKeys = Object.keys(bucket.rafTimestampBuckets);
      bucket.durationMs = bucket.endedAtMs - bucket.startedAtMs;
      bucket.presentedRafFrameProxyCount = rafKeys.length;
      bucket.maxRafCallbacksPerTimestamp = rafKeys.reduce(
        (max, key) => Math.max(max, bucket.rafTimestampBuckets[key].callbacks || 0),
        0,
      );
      bucket.maxWebglClearsPerTimestamp = rafKeys.reduce(
        (max, key) => Math.max(max, bucket.rafTimestampBuckets[key].webglClears || 0),
        0,
      );
      return clean(bucket);
    },
    report() {
      return clean({ activeStage, stages: byStage });
    },
  };
  window.__MS_AUDIT__ = api;

  const originalRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => originalRaf((timestamp) => {
    const bucket = stage();
    const key = String(Math.round(timestamp * 10) / 10);
    const record = bucket.rafTimestampBuckets[key] || { callbacks: 0, webglClears: 0 };
    record.callbacks += 1;
    bucket.rafTimestampBuckets[key] = record;
    const prior = activeRafTimestamp;
    activeRafTimestamp = key;
    try { callback(timestamp); } finally { activeRafTimestamp = prior; }
  });

  const patchClear = (prototype) => {
    if (!prototype || prototype.__msAuditClearPatched) return;
    const original = prototype.clear;
    if (typeof original !== "function") return;
    Object.defineProperty(prototype, "__msAuditClearPatched", { value: true });
    prototype.clear = function(...args) {
      const bucket = stage();
      bucket.webglClears += 1;
      if (activeRafTimestamp === null) bucket.webglClearsOutsideRaf += 1;
      else {
        const record = bucket.rafTimestampBuckets[activeRafTimestamp] || { callbacks: 0, webglClears: 0 };
        record.webglClears += 1;
        bucket.rafTimestampBuckets[activeRafTimestamp] = record;
      }
      return original.apply(this, args);
    };
  };
  patchClear(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  patchClear(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);

  const originalStringify = JSON.stringify.bind(JSON);
  JSON.stringify = function(...args) {
    const serialized = originalStringify(...args);
    const bucket = stage();
    bucket.genericJson.calls += 1;
    bucket.genericJson.bytes += encoder.encode(serialized || "").byteLength;
    return serialized;
  };

  const storagePrototype = window.Storage && window.Storage.prototype;
  if (storagePrototype && !storagePrototype.__msAuditSetItemPatched) {
    const originalSetItem = storagePrototype.setItem;
    Object.defineProperty(storagePrototype, "__msAuditSetItemPatched", { value: true });
    storagePrototype.setItem = function(key, value) {
      const bucket = stage();
      if (bucket.storageWrites.length < maxEvents) {
        bucket.storageWrites.push({
          key: String(key),
          bytes: encoder.encode(String(value)).byteLength,
          atMs: performance.now(),
        });
      }
      return originalSetItem.call(this, key, value);
    };
  }

  const pushLoaf = (entry) => {
    const bucket = stage();
    if (bucket.loaf.length >= maxEvents) return;
    const scripts = Array.isArray(entry.scripts) ? entry.scripts.map((script) => ({
      duration: script.duration,
      forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
      invoker: script.invoker,
      invokerType: script.invokerType,
      sourceURL: script.sourceURL,
      sourceFunctionName: script.sourceFunctionName,
      sourceCharPosition: script.sourceCharPosition,
    })) : [];
    bucket.loaf.push({
      startTime: entry.startTime,
      duration: entry.duration,
      renderStart: entry.renderStart,
      styleAndLayoutStart: entry.styleAndLayoutStart,
      scripts,
    });
  };
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(pushLoaf)).observe({
      type: "long-animation-frame",
      buffered: true,
    });
  } catch (error) {
    stage().loafObserverError = String(error);
  }
  try {
    new PerformanceObserver((list) => {
      const bucket = stage();
      for (const entry of list.getEntries()) {
        if (bucket.longTasks.length < maxEvents)
          bucket.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch (error) {
    stage().longTaskObserverError = String(error);
  }

  let rendererId = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      rendererId += 1;
      this.renderers.set(rendererId, renderer);
      return rendererId;
    },
    onCommitFiberRoot(id, root, priorityLevel) {
      const bucket = stage();
      if (bucket.reactCommits.length < maxEvents)
        bucket.reactCommits.push({ atMs: performance.now(), rendererId: id, priorityLevel: priorityLevel ?? null, hasRoot: Boolean(root) });
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
})();`;

const valueFor = (metrics: Metric[], name: string) =>
  metrics.find((metric) => metric.name === name)?.value ?? null;

const selectedMetrics = (metrics: Metric[]) => ({
  JSHeapUsedSize: valueFor(metrics, "JSHeapUsedSize"),
  JSHeapTotalSize: valueFor(metrics, "JSHeapTotalSize"),
  ScriptDuration: valueFor(metrics, "ScriptDuration"),
  TaskDuration: valueFor(metrics, "TaskDuration"),
  LayoutCount: valueFor(metrics, "LayoutCount"),
  RecalcStyleCount: valueFor(metrics, "RecalcStyleCount"),
  Nodes: valueFor(metrics, "Nodes"),
});

const waitForStage = async (page: Page, label: string, testId: string) => {
  const rail = page.getByTestId("workspace-steps");
  await rail.getByRole("button", { name: label, exact: true }).click();
  await page.getByTestId(testId).waitFor({ state: "visible", timeout: 30_000 });
};

const beginAuditStage = (page: Page, name: string) =>
  page.evaluate((stageName) => (window as any).__MS_AUDIT__.begin(stageName), name);

const endAuditStage = (page: Page) =>
  page.evaluate(() => (window as any).__MS_AUDIT__.end());

const profileStacks = (profile: CpuProfile) => {
  const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node]));
  const totals = new Map<string, number>();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const leaf = nodes.get(profile.samples![index]!);
    if (!leaf) continue;
    const frames: string[] = [];
    let current: typeof leaf | undefined = leaf;
    let guard = 0;
    while (current && guard < 12) {
      const callFrame = current.callFrame;
      const file = callFrame.url.split("/").at(-1) || "<native>";
      frames.push(`${callFrame.functionName || "<anonymous>"}@${file}:${callFrame.lineNumber + 1}`);
      current = current.parent === undefined ? undefined : nodes.get(current.parent);
      guard += 1;
    }
    const stack = frames.reverse().join(" <- ");
    const deltaUs = profile.timeDeltas?.[index] ?? 0;
    totals.set(stack, (totals.get(stack) ?? 0) + deltaUs);
  }
  return [...totals.entries()]
    .map(([stack, selfAndInclusiveUs]) => ({ stack, selfAndInclusiveUs }))
    .sort((left, right) => right.selfAndInclusiveUs - left.selfAndInclusiveUs)
    .slice(0, 20);
};

const allocationStacks = (profile: SamplingHeapProfile) => {
  const totals = new Map<string, number>();
  const visit = (node: SamplingHeapProfileNode, parents: string[]) => {
    const file = node.callFrame.url.split("/").at(-1) || "<native>";
    const frame = `${node.callFrame.functionName || "<anonymous>"}@${file}:${node.callFrame.lineNumber + 1}`;
    const stack = [...parents, frame].slice(-12);
    if (node.selfSize > 0)
      totals.set(stack.join(" <- "), (totals.get(stack.join(" <- ")) ?? 0) + node.selfSize);
    for (const child of node.children ?? []) visit(child, stack);
  };
  if (profile.head) visit(profile.head, []);
  return [...totals.entries()]
    .map(([stack, allocatedBytes]) => ({ stack, allocatedBytes }))
    .sort((left, right) => right.allocatedBytes - left.allocatedBytes)
    .slice(0, 20);
};

const traceGcSummary = (events: Array<Record<string, unknown>>) => {
  const gc = events.filter((event) => /(?:^|\.)GC|gc/i.test(String(event.name ?? "")));
  const byName = new Map<string, { count: number; durationUs: number }>();
  for (const event of gc) {
    const name = String(event.name ?? "unknown");
    const previous = byName.get(name) ?? { count: 0, durationUs: 0 };
    previous.count += 1;
    previous.durationUs += Number(event.dur ?? 0);
    byName.set(name, previous);
  }
  return {
    matchingEventCount: gc.length,
    byName: Object.fromEntries([...byName.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
};

const callRates = (snapshot: any) => {
  const durationSeconds = Math.max(0.001, Number(snapshot.durationMs) / 1000);
  const frameCount = Number(snapshot.presentedRafFrameProxyCount ?? 0);
  return Object.fromEntries(
    Object.entries(snapshot.hits ?? {}).map(([label, count]) => [label, {
      count,
      callsPerSecond: Number(Number(count) / durationSeconds),
      callsPerPresentedRafFrameProxy: frameCount ? Number(count) / frameCount : null,
    }]),
  );
};

const runStage = async ({
  page,
  cdp,
  name,
  action,
  mode = "steady",
}: {
  page: Page;
  cdp: CDPSession;
  name: string;
  action: () => Promise<void>;
  mode?: "steady" | "entry";
}) => {
  let entryCounters: unknown = null;
  if (mode === "steady") {
    await beginAuditStage(page, `${name}-entry`);
    await action();
    entryCounters = await endAuditStage(page);
    await beginAuditStage(page, `${name}-settling`);
    await page.waitForTimeout(warmupDurationMs);
  } else {
    await beginAuditStage(page, name);
  }
  if (mode === "steady") await beginAuditStage(page, name);
  const before = selectedMetrics((await cdp.send("Performance.getMetrics")).metrics as Metric[]);
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 32 * 1024,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await cdp.send("Profiler.start");
  if (mode === "entry") {
    await action();
    await page.waitForTimeout(warmupDurationMs);
  }
  await page.waitForTimeout(sampleDurationMs);
  const snapshot = await endAuditStage(page);
  const profile = (await cdp.send("Profiler.stop")).profile as CpuProfile;
  const allocationProfile = (await cdp.send("HeapProfiler.stopSampling")).profile as SamplingHeapProfile;
  const after = selectedMetrics((await cdp.send("Performance.getMetrics")).metrics as Metric[]);
  await writeFile(
    path.join(rawDirectory, `cpu-profile-${name}.json`),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  await writeFile(
    path.join(rawDirectory, `allocation-profile-${name}.json`),
    `${JSON.stringify(allocationProfile, null, 2)}\n`,
  );
  return {
    name,
    samplingMode: mode === "entry" ? "entry-plus-post-entry" : "steady-after-entry-and-warmup",
    entryCounters,
    counters: snapshot,
    exactRates: callRates(snapshot),
    metrics: { before, after },
    cpuProfileTopStacks: profileStacks(profile),
    allocationProfileTopStacks: allocationStacks(allocationProfile),
  };
};

const openGuidedWavingArm = async (page: Page) => {
  await page.locator("#boot-loader").waitFor({ state: "detached", timeout: 30_000 });
  const dialog = page.getByTestId("getting-started-dialog");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await page.getByTestId("character-screen").waitFor({ state: "visible", timeout: 30_000 });
};

const enableFoundryPlayback = async (page: Page) => {
  const toolbar = page.getByTestId("foundry-toolbar");
  await toolbar.waitFor({ state: "visible", timeout: 30_000 });
  const play = toolbar.getByRole("button", { name: "Play", exact: true });
  if (await play.count()) await play.click();
};

const enableSharedPlayback = async (page: Page) => {
  const dock = page.getByTestId("workspace-player-dock");
  await dock.waitFor({ state: "visible", timeout: 30_000 });
  const play = dock.getByRole("button", { name: "Play", exact: true });
  if (await play.count()) await play.click();
};

const main = async () => {
  await mkdir(rawDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript({ content: auditInitScript });

  const consoleMessages: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const modelRequests: string[] = [];
  page.on("console", (message) => {
    if (consoleMessages.length < 400)
      consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/onnx/pose_model.onnx", async (route) => {
    modelRequests.push(route.request().url());
    await route.fulfill({ status: 503, contentType: "text/plain", body: "CPU audit suppresses optional model payload" });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const traceEvents: Array<Record<string, unknown>> = [];
  cdp.on("Tracing.dataCollected", (event) => traceEvents.push(...(event.value as Array<Record<string, unknown>>)));
  const traceComplete = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()));

  try {
    await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await openGuidedWavingArm(page);
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline,v8,disabled-by-default-v8.gc,blink.user_timing",
      options: "record-continuously",
    });

    const stages = [];
    stages.push(await runStage({
      page,
      cdp,
      name: "path-svg",
      action: async () => {
        await waitForStage(page, "Path Editor", "path-view-switch");
        await page.getByTestId("path-view-2d").click();
        await page.getByTestId("path-canvas").waitFor({ state: "visible", timeout: 30_000 });
        await enableSharedPlayback(page);
      },
    }));
    stages.push(await runStage({
      page,
      cdp,
      name: "path-three",
      action: async () => {
        await page.getByTestId("path-view-3d").click();
        await page.getByTestId("path-three-puppet").waitFor({ state: "visible", timeout: 30_000 });
      },
    }));
    stages.push(await runStage({
      page,
      cdp,
      name: "foundry",
      action: async () => {
        await waitForStage(page, "Mechanism Foundry", "foundry-canvas-pane");
        await enableFoundryPlayback(page);
      },
    }));
    stages.push(await runStage({
      page,
      cdp,
      name: "design",
      action: async () => {
        await waitForStage(page, "Mechanism Design", "design-shared-foundry-preview");
        await enableSharedPlayback(page);
      },
    }));
    stages.push(await runStage({
      page,
      cdp,
      name: "blueprint-entry",
      mode: "entry",
      action: async () => {
        await waitForStage(page, "Blueprint", "blueprint-canvas-preview");
        await page.getByTestId("blueprint-svg-preview").waitFor({ state: "visible", timeout: 30_000 });
      },
    }));
    stages.push(await runStage({
      page,
      cdp,
      name: "assembly",
      action: async () => {
        await waitForStage(page, "Assembly", "assembly-canvas-preview");
        const step = page.getByTestId("assembly-step-list").getByRole("button").first();
        if (await step.count()) await step.click();
        await enableSharedPlayback(page);
      },
    }));

    await cdp.send("Tracing.end");
    await traceComplete;
    await writeFile(
      path.join(rawDirectory, "chrome-trace.json"),
      `${JSON.stringify({ traceEvents }, null, 2)}\n`,
    );

    const mergedStacks = new Map<string, number>();
    for (const stage of stages) {
      for (const stack of stage.cpuProfileTopStacks) {
        mergedStacks.set(stack.stack, (mergedStacks.get(stack.stack) ?? 0) + stack.selfAndInclusiveUs);
      }
    }
    const report = {
      schema: "motionsmith-cpu-audit-v1",
      baseline: "97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af",
      capturedAt: new Date().toISOString(),
      runtime: {
        browser: await browser.version(),
        launch: "headless Chromium",
        viewport: "1366x768",
        deviceScaleFactor: 1,
        hardwareQualification: "Not a Chromebook trace. Exact JavaScript call counts are runtime evidence; timing and heap values are developer-host diagnostic evidence only.",
        build: "Vite production-mode audit build with counter-only source transforms; production source files are unchanged.",
      },
      controlledConditions: {
        onnxModelRequests: modelRequests,
        onnxModelPayload: "intercepted with HTTP 503 after recording the startup request; no model download or inference is included in stage samples",
        sampleDurationMs,
        warmupDurationMs,
      },
      stages,
      fiveDominantSampledStacks: [...mergedStacks.entries()]
        .map(([stack, selfAndInclusiveUs]) => ({ stack, selfAndInclusiveUs }))
        .sort((left, right) => right.selfAndInclusiveUs - left.selfAndInclusiveUs)
        .slice(0, 5),
      traceGcSummary: traceGcSummary(traceEvents),
      diagnostic: await page.evaluate(() => (window as any).__MS_AUDIT__.report()),
      consoleMessages,
      pageErrors,
    };
    await writeFile(
      path.join(rawDirectory, "runtime-evidence.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify({ status: "passed", stages: stages.map((stage) => stage.name), raw: "artifacts/performance/audit-cpu/raw/runtime-evidence.json" }));
  } catch (error) {
    const failure = {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      consoleMessages,
      pageErrors,
      modelRequests,
    };
    await writeFile(
      path.join(rawDirectory, "runtime-failure.json"),
      `${JSON.stringify(failure, null, 2)}\n`,
    );
    throw error;
  } finally {
    await cdp.detach().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

await main();

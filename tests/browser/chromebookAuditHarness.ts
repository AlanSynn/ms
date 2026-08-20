import { expect, type BrowserContext, type Locator, type Page, type Request } from "@playwright/test";
import { performance as nodePerformance } from "node:perf_hooks";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  type ActionLatency,
  type BootAudit,
  type NetworkRequestRecord,
  type PlaybackAudit,
  type WebGLAuditSnapshot,
} from "./chromebookAuditReport";

type BrowserAuditState = {
  longTasks: number[];
  eventDurations: number[];
  reactCommits: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  webgl: WebGLAuditSnapshot;
};

export const installChromebookAuditInstrumentation = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    const resources: WebGLAuditSnapshot["resources"] = {};
    const state: BrowserAuditState = {
      longTasks: [],
      eventDurations: [],
      reactCommits: 0,
      foundryTopologyBuilds: 0,
      foundryGeometryCacheSize: 0,
      foundryMaterialCacheSize: 0,
      webgl: {
        contextsCreated: 0,
        contextsLost: 0,
        contextsRestored: 0,
        attachedCanvases: 0,
        resources,
      },
    };
    (window as Window & { __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState })
      .__MOTIONSMITH_CHROMEBOOK_AUDIT__ = state;
    performance.setResourceTimingBufferSize(2_000);

    try {
      new PerformanceObserver((list) => {
        state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Chromium exposes long-task entries; unsupported browsers keep an empty list.
    }
    try {
      new PerformanceObserver((list) => {
        state.eventDurations.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      // Event Timing is supplementary; action-to-paint timings remain authoritative.
    }

    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      value: {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        onCommitFiberRoot: () => { state.reactCommits += 1; },
        onCommitFiberUnmount: () => undefined,
      },
    });

    const resourceMethods = [
      ["buffer", "createBuffer", "deleteBuffer"],
      ["texture", "createTexture", "deleteTexture"],
      ["program", "createProgram", "deleteProgram"],
      ["shader", "createShader", "deleteShader"],
      ["framebuffer", "createFramebuffer", "deleteFramebuffer"],
      ["renderbuffer", "createRenderbuffer", "deleteRenderbuffer"],
      ["vertexArray", "createVertexArray", "deleteVertexArray"],
      ["query", "createQuery", "deleteQuery"],
      ["sampler", "createSampler", "deleteSampler"],
      ["transformFeedback", "createTransformFeedback", "deleteTransformFeedback"],
      ["sync", "fenceSync", "deleteSync"],
    ] as const;
    const seenContexts = new WeakSet<object>();
    const instrumentContext = (gl: Record<string, unknown>, canvas: HTMLCanvasElement) => {
      if (seenContexts.has(gl)) return;
      seenContexts.add(gl);
      state.webgl.contextsCreated += 1;
      canvas.addEventListener("webglcontextlost", () => { state.webgl.contextsLost += 1; });
      canvas.addEventListener("webglcontextrestored", () => { state.webgl.contextsRestored += 1; });
      for (const [kind, createName, deleteName] of resourceMethods) {
        const create = gl[createName];
        const remove = gl[deleteName];
        if (typeof create !== "function" || typeof remove !== "function") continue;
        resources[kind] ??= { created: 0, deleted: 0, live: 0, peakLive: 0 };
        try {
          gl[createName] = function (this: unknown, ...args: unknown[]) {
            const value = Reflect.apply(create, this, args);
            if (value) {
              const count = resources[kind];
              count.created += 1;
              count.live += 1;
              count.peakLive = Math.max(count.peakLive, count.live);
            }
            return value;
          };
          gl[deleteName] = function (this: unknown, ...args: unknown[]) {
            if (args[0]) {
              const count = resources[kind];
              count.deleted += 1;
              count.live = Math.max(0, count.live - 1);
            }
            return Reflect.apply(remove, this, args);
          };
        } catch {
          // A read-only browser method leaves renderer.info and topology probes available.
        }
      }
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      const gl = Reflect.apply(getContext, this, [type, ...args]);
      if (gl && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
        instrumentContext(gl as Record<string, unknown>, this);
      }
      return gl;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
};

export const applyChromebookEmulation = async (page: Page) => {
  const client = await page.context().newCDPSession(page);
  const profile = CHROMEBOOK_AUDIT_ENVIRONMENT;
  await client.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottlingRate });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: profile.viewport.width,
    height: profile.viewport.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    mobile: false,
  });
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.network.latencyMs,
    downloadThroughput: profile.network.downloadBytesPerSecond,
    uploadThroughput: profile.network.uploadBytesPerSecond,
  });
  return client;
};

export const attachNetworkRecorder = (page: Page) => {
  let phase: NetworkRequestRecord["phase"] = "cold-boot";
  const records: NetworkRequestRecord[] = [];
  const byRequest = new Map<Request, NetworkRequestRecord>();
  const pending = new Set<Promise<void>>();
  page.on("request", (request) => {
    const record: NetworkRequestRecord = {
      phase,
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    };
    records.push(record);
    byRequest.set(request, record);
  });
  page.on("response", (response) => {
    const record = byRequest.get(response.request());
    if (!record) return;
    record.status = response.status();
    const task = response.headerValue("content-length").then((value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) record.contentLength = parsed;
    }).finally(() => pending.delete(task));
    pending.add(task);
  });
  page.on("requestfailed", (request) => {
    const record = byRequest.get(request);
    if (record) record.failed = request.failure()?.errorText ?? "request failed";
  });
  return {
    records,
    setPhase: (next: NetworkRequestRecord["phase"]) => { phase = next; },
    flush: async () => { await Promise.all([...pending]); },
  };
};

export const measureBoot = async (
  page: Page,
  cache: BootAudit["cache"],
  navigate: () => Promise<unknown>,
  requestCount: () => number,
): Promise<BootAudit> => {
  const beforeRequests = requestCount();
  const startedAt = nodePerformance.now();
  await navigate();
  await expect(page.getByTestId("shared-workbench")).toBeVisible({ timeout: 180_000 });
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  const wallMs = nodePerformance.now() - startedAt;
  return page.evaluate(({ cache, wallMs, requestCount }) => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    const longTasks = state?.longTasks ?? [];
    return {
      cache,
      wallMs,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
      loadEventMs: navigation?.loadEventEnd ?? 0,
      transferBytes: (navigation?.transferSize ?? 0) + resources.reduce((sum, item) => sum + item.transferSize, 0),
      decodedBytes: (navigation?.decodedBodySize ?? 0) + resources.reduce((sum, item) => sum + item.decodedBodySize, 0),
      requestCount,
      longTaskCount: longTasks.length,
      longTaskMaxMs: longTasks.length ? Math.max(...longTasks) : 0,
    };
  }, { cache, wallMs, requestCount: requestCount() - beforeRequests });
};

export const measureAction = async (
  page: Page,
  label: string,
  kind: ActionLatency["kind"],
  control: Locator,
  action: () => Promise<unknown>,
  ready: () => Promise<unknown>,
): Promise<ActionLatency> => {
  await expect(control, `${label} control is visible`).toBeVisible();
  await expect(control, `${label} control is enabled`).toBeEnabled();
  const start = await page.evaluate(() => performance.now());
  await action();
  await ready();
  const end = await page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  }));
  return { label, kind, durationMs: end - start };
};

export const collectPlaybackAudit = async (page: Page, durationMs: number): Promise<PlaybackAudit> =>
  page.evaluate(async ({ durationMs, growthRatio, growthFloor }) => {
    const auditState = () => (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    const snapshotWebGL = (): WebGLAuditSnapshot => {
      const state = auditState();
      return {
        contextsCreated: state?.webgl.contextsCreated ?? 0,
        contextsLost: state?.webgl.contextsLost ?? 0,
        contextsRestored: state?.webgl.contextsRestored ?? 0,
        attachedCanvases: document.querySelectorAll("canvas").length,
        resources: structuredClone(state?.webgl.resources ?? {}),
      };
    };
    const liveResources = (snapshot: WebGLAuditSnapshot) =>
      Object.values(snapshot.resources).reduce((sum, item) => sum + item.live, 0);
    const measurePercentiles = (values: number[]) => {
      if (!values.length) return { p50: 0, p95: 0, p99: 0 };
      const sorted = [...values].sort((left, right) => left - right);
      const at = (fraction: number) =>
        sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
      return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
    };
    const probeNumber = (name: "foundryTopologyBuilds" | "foundryGeometryCacheSize" | "foundryMaterialCacheSize") =>
      Number(auditState()?.[name] ?? 0);
    const state = auditState();
    const before = snapshotWebGL();
    const beforeLongTasks = state?.longTasks.length ?? 0;
    const beforeEvents = state?.eventDurations.length ?? 0;
    const beforeCommits = state?.reactCommits ?? 0;
    const beforeTopology = probeNumber("foundryTopologyBuilds");
    const beforeGeometry = probeNumber("foundryGeometryCacheSize");
    const beforeMaterial = probeNumber("foundryMaterialCacheSize");
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const heap = memory ? [memory.usedJSHeapSize] : [];
    const heapTimer = window.setInterval(() => {
      if (memory) heap.push(memory.usedJSHeapSize);
    }, Math.min(5_000, Math.max(250, durationMs / 20)));
    const intervals: number[] = [];
    const start = performance.now();
    let previous = start;
    await new Promise<void>((resolve) => {
      const tick = (time: number) => {
        intervals.push(time - previous);
        previous = time;
        if (time - start >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    clearInterval(heapTimer);
    if (memory) heap.push(memory.usedJSHeapSize);
    const validIntervals = intervals.filter((value) => value > 0);
    const longTasks = (state?.longTasks ?? []).slice(beforeLongTasks);
    const eventDurations = (state?.eventDurations ?? []).slice(beforeEvents);
    const firstBytes = heap[0] ?? 0;
    const lastBytes = heap.at(-1) ?? firstBytes;
    const allowedGrowthBytes = Math.max(growthFloor, firstBytes * growthRatio);
    const tail = heap.slice(Math.max(0, Math.floor(heap.length * 0.8)));
    const tailRangeBytes = tail.length ? Math.max(...tail) - Math.min(...tail) : 0;
    const after = snapshotWebGL();
    const framesOver50 = validIntervals.filter((value) => value > 50).length;
    return {
      durationMs: performance.now() - start,
      frameCount: validIntervals.length,
      frameIntervalMs: measurePercentiles(validIntervals),
      framesOver50,
      framesOver50Percent: validIntervals.length ? framesOver50 / validIntervals.length * 100 : 100,
      framesOver200: validIntervals.filter((value) => value > 200).length,
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((sum, value) => sum + value, 0),
        maxMs: longTasks.length ? Math.max(...longTasks) : 0,
      },
      browserEventLatencyMs: measurePercentiles(eventDurations),
      reactCommits: Math.max(0, (state?.reactCommits ?? 0) - beforeCommits),
      heap: {
        supported: Boolean(memory),
        samples: heap.length,
        firstBytes,
        lastBytes,
        growthBytes: lastBytes - firstBytes,
        allowedGrowthBytes,
        tailRangeBytes,
        stable: Boolean(memory) && lastBytes - firstBytes <= allowedGrowthBytes && tailRangeBytes <= allowedGrowthBytes,
      },
      webgl: {
        before,
        after,
        liveResourceDelta: liveResources(after) - liveResources(before),
        contextDelta: after.contextsCreated - before.contextsCreated,
        topologyBuildDelta: probeNumber("foundryTopologyBuilds") - beforeTopology,
        geometryCacheDelta: probeNumber("foundryGeometryCacheSize") - beforeGeometry,
        materialCacheDelta: probeNumber("foundryMaterialCacheSize") - beforeMaterial,
      },
    };
  }, {
    durationMs,
    growthRatio: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
    growthFloor: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
  });

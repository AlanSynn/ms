import {
  expect,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { performance as nodePerformance } from "node:perf_hooks";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  percentiles,
  type ActionLatency,
  type BootAudit,
  type NetworkRequestRecord,
  type PlaybackAudit,
  type WebGLAuditSnapshot,
} from "./chromebookAuditReport";
import type {
  FeatureActionAudit,
  FeatureRuntimeProbe,
  RuntimeLifecycleSnapshot,
} from "./chromebookFeatureAuditReport";

type BrowserAuditState = {
  longTasks: number[];
  eventDurations: number[];
  reactCommits: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  puppetTopologyDurations: number[];
  externalFileAction: {
    sequence: number;
    startedAt: number;
    nextPaintMs?: number;
  };
  runtime: RuntimeLifecycleSnapshot;
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
      puppetTopologyDurations: [],
      externalFileAction: { sequence: 0, startedAt: 0 },
      runtime: {
        probeSupport: {
          workers: false,
          imageBitmaps: false,
          objectUrls: false,
        },
        workers: { acquired: 0, released: 0, active: 0, peakActive: 0 },
        imageBitmaps: { acquired: 0, released: 0, active: 0, peakActive: 0 },
        objectUrls: { acquired: 0, released: 0, active: 0, peakActive: 0 },
      },
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

    document.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const sequence = state.externalFileAction.sequence + 1;
      const startedAt = performance.now();
      state.externalFileAction = { sequence, startedAt };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (state.externalFileAction.sequence !== sequence) return;
        state.externalFileAction.nextPaintMs = performance.now() - startedAt;
      }));
    }, true);

    const acquire = (
      counter: RuntimeLifecycleSnapshot["workers"],
    ) => {
      counter.acquired += 1;
      counter.active += 1;
      counter.peakActive = Math.max(counter.peakActive, counter.active);
    };
    const release = (
      counter: RuntimeLifecycleSnapshot["workers"],
    ) => {
      counter.released += 1;
      counter.active = Math.max(0, counter.active - 1);
    };

    const trackedBitmaps = new WeakSet<object>();
    const releasedBitmaps = new WeakSet<object>();
    const trackBitmap = (value: unknown) => {
      if (
        typeof ImageBitmap === "undefined" ||
        !(value instanceof ImageBitmap) ||
        trackedBitmaps.has(value)
      ) return;
      trackedBitmaps.add(value);
      acquire(state.runtime.imageBitmaps);
    };
    try {
      const nativeClose = ImageBitmap.prototype.close;
      Object.defineProperty(ImageBitmap.prototype, "close", {
        configurable: true,
        value: function (this: ImageBitmap) {
          if (trackedBitmaps.has(this) && !releasedBitmaps.has(this)) {
            releasedBitmaps.add(this);
            release(state.runtime.imageBitmaps);
          }
          return Reflect.apply(nativeClose, this, []);
        },
      });
      state.runtime.probeSupport.imageBitmaps = true;
    } catch {
      // The audit gate records unsupported ownership probes instead of guessing.
    }
    try {
      const nativeCreateImageBitmap = window.createImageBitmap;
      Object.defineProperty(window, "createImageBitmap", {
        configurable: true,
        value: (...args: unknown[]) => (
          Reflect.apply(nativeCreateImageBitmap, window, args) as Promise<ImageBitmap>
        ).then((bitmap) => {
          trackBitmap(bitmap);
          return bitmap;
        }),
      });
    } catch {
      // Transferred worker bitmaps remain tracked even if the factory is read-only.
    }

    try {
      const NativeWorker = window.Worker;
      const AuditedWorker = new Proxy(NativeWorker, {
        construct(target, args) {
          const instance = Reflect.construct(target, args) as Worker;
          const workerName = (
            args[1] as WorkerOptions | undefined
          )?.name ?? "";
          let terminated = false;
          acquire(state.runtime.workers);
          instance.addEventListener("message", (event) => {
            const payload = event.data as { bitmap?: unknown } | undefined;
            if (payload?.bitmap) trackBitmap(payload.bitmap);
          });
          const nativeTerminate = instance.terminate.bind(instance);
          const nativePostMessage = instance.postMessage.bind(instance) as (
            ...messageArgs: unknown[]
          ) => void;
          Object.defineProperty(instance, "postMessage", {
            configurable: true,
            value: (...messageArgs: unknown[]) => {
              const message = messageArgs[0] as { type?: string } | undefined;
              window.dispatchEvent(new CustomEvent(
                "motionsmith:chromebook-worker-request",
                {
                  detail: {
                    name: workerName,
                    type: message?.type ?? "unknown",
                  },
                },
              ));
              nativePostMessage(...messageArgs);
            },
          });
          Object.defineProperty(instance, "terminate", {
            configurable: true,
            value: () => {
              if (!terminated) {
                terminated = true;
                release(state.runtime.workers);
              }
              nativeTerminate();
            },
          });
          return instance;
        },
      });
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: AuditedWorker,
      });
      state.runtime.probeSupport.workers = true;
    } catch {
      // Chrome should permit wrapping Worker; a failed probe is an explicit gate.
    }

    const activeObjectUrls = new Set<string>();
    try {
      const nativeCreateObjectUrl = URL.createObjectURL.bind(URL);
      const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: (object: Blob | MediaSource) => {
          const url = nativeCreateObjectUrl(object);
          if (!activeObjectUrls.has(url)) {
            activeObjectUrls.add(url);
            acquire(state.runtime.objectUrls);
          }
          return url;
        },
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: (url: string) => {
          if (activeObjectUrls.delete(url)) release(state.runtime.objectUrls);
          nativeRevokeObjectUrl(url);
        },
      });
      state.runtime.probeSupport.objectUrls = true;
    } catch {
      // Chrome should permit wrapping URL ownership; unsupported is reported.
    }

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

export type FeatureNextPaintTiming = {
  startedAt: number;
  nextPaintMs: number;
};

export const measureClickToNextPaint = async (
  control: Locator,
): Promise<FeatureNextPaintTiming> => {
  await expect(control, "feature action is visible before timing").toBeVisible();
  await expect(control, "feature action is enabled before timing").toBeEnabled();
  return control.evaluate((element: HTMLElement) => {
    const startedAt = performance.now();
    element.click();
    return new Promise<FeatureNextPaintTiming>((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          resolve({
            startedAt,
            nextPaintMs: performance.now() - startedAt,
          }),
        ),
      );
    });
  });
};

export const measureExternalActionToNextPaint = async (
  page: Page,
  action: () => Promise<unknown>,
): Promise<FeatureNextPaintTiming> => {
  const sequence = await page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    return state.externalFileAction.sequence;
  });
  await action();
  await expect.poll(() => page.evaluate((previousSequence) => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    return (state?.externalFileAction.sequence ?? 0) > previousSequence;
  }, sequence), { message: "file action reaches its browser change event" }).toBe(true);
  return page.evaluate(() => new Promise<FeatureNextPaintTiming>((resolve) => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    const read = () => {
      if (state.externalFileAction.nextPaintMs === undefined) {
        requestAnimationFrame(read);
        return;
      }
      resolve({
        startedAt: state.externalFileAction.startedAt,
        nextPaintMs: state.externalFileAction.nextPaintMs,
      });
    };
    read();
  }));
};

export const elapsedFeatureTime = (
  page: Page,
  timing: FeatureNextPaintTiming,
) => page.evaluate((startedAt) => performance.now() - startedAt, timing.startedAt);

export const readFeatureRuntimeProbe = (
  page: Page,
): Promise<FeatureRuntimeProbe> =>
  page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    const memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    return {
      atMs: performance.now(),
      heapBytes: memory?.usedJSHeapSize,
      longTaskCount: state.longTasks.length,
      puppetTopologyCount: state.puppetTopologyDurations.length,
      lifecycle: structuredClone(state.runtime),
    };
  });

export const collectFeatureGarbage = async (
  page: Page,
  client: CDPSession,
) => {
  try {
    await client.send("HeapProfiler.collectGarbage");
  } catch {
    // Precise heap remains optional; the JSON records whether it is available.
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
};

export const collectStableFeatureProbe = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureRuntimeProbe> => {
  const samples: number[] = [];
  await collectFeatureGarbage(page, client);
  let probe: FeatureRuntimeProbe | undefined;
  for (let index = 0; index < 3; index += 1) {
    probe = await readFeatureRuntimeProbe(page);
    if (probe.heapBytes !== undefined) samples.push(probe.heapBytes);
    if (index < 2) {
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
    }
  }
  if (!probe) throw new Error("Could not collect a stable feature probe");
  return { ...probe, heapSamplesBytes: samples };
};

export const waitForLifecycleBaseline = async (
  page: Page,
  baseline: RuntimeLifecycleSnapshot,
) => {
  await expect.poll(
    async () => {
      const current = (await readFeatureRuntimeProbe(page)).lifecycle;
      return {
        workers: current.workers.active,
        imageBitmaps: current.imageBitmaps.active,
        objectUrls: current.objectUrls.active,
      };
    },
    { message: "feature resources return to their ownership baseline" },
  ).toEqual({
    workers: baseline.workers.active,
    imageBitmaps: baseline.imageBitmaps.active,
    objectUrls: baseline.objectUrls.active,
  });
};

export const finishFeatureAction = async (
  page: Page,
  input: {
    label: string;
    cycle: number;
    outcome: FeatureActionAudit["outcome"];
    timing: FeatureNextPaintTiming;
    before: FeatureRuntimeProbe;
    jobCompletionMs?: number;
  },
): Promise<FeatureActionAudit> => {
  const settleMs = await elapsedFeatureTime(page, input.timing);
  const result = await page.evaluate(
    ({ longTaskOffset, puppetTopologyOffset }) => {
      const state = (window as Window & {
        __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
      }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
      if (!state) throw new Error("Chromebook runtime probe is not installed");
      const memory = (
        performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory;
      return {
        after: {
          atMs: performance.now(),
          heapBytes: memory?.usedJSHeapSize,
          longTaskCount: state.longTasks.length,
          puppetTopologyCount: state.puppetTopologyDurations.length,
          lifecycle: structuredClone(state.runtime),
        } satisfies FeatureRuntimeProbe,
        longTasks: state.longTasks.slice(longTaskOffset),
        puppetTopologyDurations: state.puppetTopologyDurations.slice(puppetTopologyOffset),
      };
    },
    {
      longTaskOffset: input.before.longTaskCount,
      puppetTopologyOffset: input.before.puppetTopologyCount,
    },
  );
  const latencyMs = percentiles(result.longTasks);
  return {
    label: input.label,
    cycle: input.cycle,
    outcome: input.outcome,
    nextPaintMs: input.timing.nextPaintMs,
    settleMs,
    jobCompletionMs: input.jobCompletionMs,
    longTasks: {
      durationsMs: result.longTasks,
      latencyMs,
      totalMs: result.longTasks.reduce((sum, duration) => sum + duration, 0),
      maxMs: result.longTasks.length ? Math.max(...result.longTasks) : 0,
    },
    puppetTopologyDurationsMs: result.puppetTopologyDurations,
    before: input.before,
    after: result.after,
  };
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

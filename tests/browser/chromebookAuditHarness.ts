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
  type AuditInternalMemoryMeasurementWindow,
  type BootAudit,
  type NetworkRequestRecord,
  type PlaybackAudit,
  type PlaybackWarmPlateauEvidence,
  type WebGLAuditSnapshot,
  type ChromebookRuntimeEnvironment,
} from "./chromebookAuditReport";
import type {
  FeatureActionAudit,
  FeatureRuntimeProbe,
  RuntimeLifecycleSnapshot,
} from "./chromebookFeatureAuditReport";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

export type ChromebookWebGLResourceDeletion = {
  atMs: number;
  kind: string;
  contextIndex: number;
  canvasClassName: string;
  canvasConnected: boolean;
  liveBefore: number;
  liveAfter: number;
};

export type ChromebookWebGLResourceDeletionBatch = {
  contextIndex: number;
  canvasClassName: string;
  canvasConnectedAtStart: boolean;
  firstAtMs: number;
  lastAtMs: number;
  stackReturnedAtMs: number | null;
  uniqueDeletionCount: number;
};

type BrowserAuditState = {
  longTasks: number[];
  longTaskEntries: Array<{ startTime: number; duration: number }>;
  eventDurations: number[];
  reactCommits: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  puppetTopologyDurations: number[];
  webglFrameSubmissions: number[];
  webglResourceDeletions: ChromebookWebGLResourceDeletion[];
  webglResourceDeletionBatches: ChromebookWebGLResourceDeletionBatch[];
  foundryGestureVisualEmissions: number[];
  auditInternalMemoryMeasurementWindows: AuditInternalMemoryMeasurementWindow[];
  externalFileAction: {
    sequence: number;
    startedAt: number;
    nextPaintMs?: number;
  };
  runtime: RuntimeLifecycleSnapshot;
  webgl: WebGLAuditSnapshot;
  graphicsContexts: Array<{
    api: "webgl" | "webgl2" | "experimental-webgl";
    createdAtMs: number;
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    canvas: HTMLCanvasElement;
    vendor: string;
    renderer: string;
    unmaskedVendor: string | null;
    unmaskedRenderer: string | null;
    maxRenderbufferDimension: number;
    backingStore: {
      mutations: Array<{
        atMs: number;
        changedDimension: "initial" | "width" | "height";
        className: string;
        width: number;
        height: number;
        pixels: number;
      }>;
      highWaterWidth: number;
      highWaterHeight: number;
      highWaterPixels: number;
    };
    frameSubmissions: Array<{
      globalGlIndex: number;
      atMs: number;
      className: string;
      drawingBufferWidth: number;
      drawingBufferHeight: number;
      requestedDprCap: number | null;
      effectiveDpr: number | null;
    }>;
  }>;
  backingStoreMutationProbeSupported: boolean;
};

export type ChromebookHighResolutionTelemetry = {
  backingStoreMutationProbeSupported: boolean;
  contextsLost: number;
  contextsRestored: number;
  longTaskEntries: Array<{ startTime: number; duration: number }>;
  auditInternalMemoryMeasurementWindows:
    BrowserAuditState["auditInternalMemoryMeasurementWindows"];
  contexts: Array<{
    contextIndex: number;
    createdAtMs: number;
    maxRenderbufferDimension: number;
    backingStore: BrowserAuditState["graphicsContexts"][number]["backingStore"];
    frameSubmissions: BrowserAuditState["graphicsContexts"][number]["frameSubmissions"];
  }>;
};

export const installChromebookAuditInstrumentation = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    const resources: WebGLAuditSnapshot["resources"] = {};
    const state: BrowserAuditState = {
      longTasks: [],
      longTaskEntries: [],
      eventDurations: [],
      reactCommits: 0,
      foundryTopologyBuilds: 0,
      foundryGeometryCacheSize: 0,
      foundryMaterialCacheSize: 0,
      puppetTopologyDurations: [],
      webglFrameSubmissions: [],
      webglResourceDeletions: [],
      webglResourceDeletionBatches: [],
      foundryGestureVisualEmissions: [],
      auditInternalMemoryMeasurementWindows: [],
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
      graphicsContexts: [],
      backingStoreMutationProbeSupported: false,
    };
    (window as Window & { __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState })
      .__MOTIONSMITH_CHROMEBOOK_AUDIT__ = state;
    performance.setResourceTimingBufferSize(2_000);

    const backingStores = new WeakMap<
      HTMLCanvasElement,
      BrowserAuditState["graphicsContexts"][number]["backingStore"]
    >();
    const canvasClassName = (canvas: HTMLCanvasElement) =>
      typeof canvas.className === "string" ? canvas.className : "";
    const backingStoreFor = (canvas: HTMLCanvasElement) => {
      let backingStore = backingStores.get(canvas);
      if (backingStore) return backingStore;
      const width = canvas.width;
      const height = canvas.height;
      backingStore = {
        mutations: [{
          atMs: performance.now(),
          changedDimension: "initial",
          className: canvasClassName(canvas),
          width,
          height,
          pixels: width * height,
        }],
        highWaterWidth: width,
        highWaterHeight: height,
        highWaterPixels: width * height,
      };
      backingStores.set(canvas, backingStore);
      return backingStore;
    };
    const recordBackingStore = (
      canvas: HTMLCanvasElement,
      changedDimension: "width" | "height",
    ) => {
      const backingStore = backingStoreFor(canvas);
      const width = canvas.width;
      const height = canvas.height;
      const pixels = width * height;
      backingStore.mutations.push({
        atMs: performance.now(),
        changedDimension,
        className: canvasClassName(canvas),
        width,
        height,
        pixels,
      });
      backingStore.highWaterWidth = Math.max(backingStore.highWaterWidth, width);
      backingStore.highWaterHeight = Math.max(backingStore.highWaterHeight, height);
      backingStore.highWaterPixels = Math.max(backingStore.highWaterPixels, pixels);
    };
    const wrapCanvasDimension = (property: "width" | "height") => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        property,
      );
      if (!descriptor?.get || !descriptor.set || descriptor.configurable === false) {
        return false;
      }
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        ...descriptor,
        get: descriptor.get,
        set(this: HTMLCanvasElement, value: number) {
          descriptor.set!.call(this, value);
          recordBackingStore(this, property);
        },
      });
      return true;
    };
    state.backingStoreMutationProbeSupported =
      wrapCanvasDimension("width") && wrapCanvasDimension("height");

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
            window.dispatchEvent(new CustomEvent(
              "motionsmith:chromebook-object-url-acquired",
              { detail: { url } },
            ));
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
        const entries = list.getEntries();
        state.longTasks.push(...entries.map((entry) => entry.duration));
        state.longTaskEntries.push(...entries.map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })));
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
    const instrumentContext = (
      gl: Record<string, unknown>,
      canvas: HTMLCanvasElement,
      api: "webgl" | "webgl2" | "experimental-webgl",
    ) => {
      if (seenContexts.has(gl)) return;
      seenContexts.add(gl);
      state.webgl.contextsCreated += 1;
      const contextIndex = state.graphicsContexts.length;
      const typedGl = gl as unknown as WebGLRenderingContext | WebGL2RenderingContext;
      const debugInfo = typedGl.getExtension("WEBGL_debug_renderer_info") as {
        UNMASKED_VENDOR_WEBGL: number;
        UNMASKED_RENDERER_WEBGL: number;
      } | null;
      const graphicsContext: BrowserAuditState["graphicsContexts"][number] = {
        api,
        createdAtMs: performance.now(),
        gl: typedGl,
        canvas,
        vendor: String(typedGl.getParameter(typedGl.VENDOR) ?? "unknown"),
        renderer: String(typedGl.getParameter(typedGl.RENDERER) ?? "unknown"),
        unmaskedVendor: debugInfo
          ? String(typedGl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? "unknown")
          : null,
        unmaskedRenderer: debugInfo
          ? String(typedGl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "unknown")
          : null,
        maxRenderbufferDimension: Number(
          typedGl.getParameter(typedGl.MAX_RENDERBUFFER_SIZE),
        ),
        backingStore: backingStoreFor(canvas),
        frameSubmissions: [],
      };
      state.graphicsContexts.push(graphicsContext);
      canvas.addEventListener("webglcontextlost", () => { state.webgl.contextsLost += 1; });
      canvas.addEventListener("webglcontextrestored", () => { state.webgl.contextsRestored += 1; });
      let activeDeletionBatch: ChromebookWebGLResourceDeletionBatch | null = null;
      const recordDeletionBatch = (atMs: number) => {
        const currentClassName = canvasClassName(canvas);
        if (
          activeDeletionBatch &&
          activeDeletionBatch.canvasClassName === currentClassName
        ) {
          activeDeletionBatch.lastAtMs = atMs;
          activeDeletionBatch.uniqueDeletionCount += 1;
          return;
        }
        const batch: ChromebookWebGLResourceDeletionBatch = {
          contextIndex,
          canvasClassName: currentClassName,
          canvasConnectedAtStart: canvas.isConnected,
          firstAtMs: atMs,
          lastAtMs: atMs,
          stackReturnedAtMs: null,
          uniqueDeletionCount: 1,
        };
        state.webglResourceDeletionBatches.push(batch);
        activeDeletionBatch = batch;
        queueMicrotask(() => {
          batch.stackReturnedAtMs = performance.now();
          if (activeDeletionBatch === batch) activeDeletionBatch = null;
        });
      };
      for (const [kind, createName, deleteName] of resourceMethods) {
        const create = gl[createName];
        const remove = gl[deleteName];
        if (typeof create !== "function" || typeof remove !== "function") continue;
        resources[kind] ??= { created: 0, deleted: 0, live: 0, peakLive: 0 };
        const tracked = new WeakSet<object>();
        const released = new WeakSet<object>();
        try {
          gl[createName] = function (this: unknown, ...args: unknown[]) {
            const value = Reflect.apply(create, this, args);
            if (value) {
              tracked.add(value as object);
              const count = resources[kind];
              count.created += 1;
              count.live += 1;
              count.peakLive = Math.max(count.peakLive, count.live);
            }
            return value;
          };
          gl[deleteName] = function (this: unknown, ...args: unknown[]) {
            const value = args[0];
            if (
              value !== null &&
              (typeof value === "object" || typeof value === "function") &&
              tracked.has(value as object) &&
              !released.has(value as object)
            ) {
              released.add(value as object);
              const count = resources[kind];
              const liveBefore = count.live;
              const atMs = performance.now();
              count.deleted += 1;
              count.live = Math.max(0, count.live - 1);
              state.webglResourceDeletions.push({
                atMs,
                kind,
                contextIndex,
                canvasClassName: canvasClassName(canvas),
                canvasConnected: canvas.isConnected,
                liveBefore,
                liveAfter: count.live,
              });
              recordDeletionBatch(atMs);
            }
            return Reflect.apply(remove, this, args);
          };
        } catch {
          // A read-only browser method leaves renderer.info and topology probes available.
        }
      }
      const clear = gl.clear;
      if (typeof clear === "function") {
        try {
          gl.clear = function (this: unknown, ...args: unknown[]) {
            const atMs = performance.now();
            const globalGlIndex = state.webglFrameSubmissions.length;
            state.webglFrameSubmissions.push(atMs);
            const requestedDprCap = Number(canvas.dataset.threeRequestedDprCap);
            const effectiveDpr = Number(canvas.dataset.threeEffectiveDpr);
            graphicsContext.frameSubmissions.push({
              globalGlIndex,
              atMs,
              className: canvasClassName(canvas),
              drawingBufferWidth: typedGl.drawingBufferWidth,
              drawingBufferHeight: typedGl.drawingBufferHeight,
              requestedDprCap: Number.isFinite(requestedDprCap)
                ? requestedDprCap
                : null,
              effectiveDpr: Number.isFinite(effectiveDpr) ? effectiveDpr : null,
            });
            return Reflect.apply(clear, this, args);
          };
        } catch {
          // Missing GL submission telemetry is an explicit playback failure.
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
        instrumentContext(
          gl as Record<string, unknown>,
          this,
          type,
        );
      }
      return gl;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
};

export const installChromebookAuditIsolation = async (page: Page) => {
  // The audit-only Vite preview owns COOP/COEP before navigation. Response-
  // stage CDP header rewriting happens too late for Chrome to establish the
  // agent cluster, so CDP is reserved for emulation and garbage collection.
  return page.context().newCDPSession(page);
};

export const applyChromebookEmulation = async (
  page: Page,
  existingClient?: CDPSession,
  overrides: { deviceScaleFactor?: 1 | 2 } = {},
) => {
  const client = existingClient ?? await installChromebookAuditIsolation(page);
  const profile = CHROMEBOOK_AUDIT_ENVIRONMENT;
  await client.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottlingRate });
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: profile.viewport.width,
    height: profile.viewport.height,
    deviceScaleFactor: overrides.deviceScaleFactor ?? profile.deviceScaleFactor,
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

export const collectChromebookRuntimeEnvironment = async (
  page: Page,
  browserVersion: string,
  throttlingScope: ChromebookRuntimeEnvironment["throttlingScope"],
  overrides: { expectedDeviceScaleFactor?: 1 | 2 } = {},
): Promise<ChromebookRuntimeEnvironment> => {
  const runtime = await page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    const drawingBuffers = state.graphicsContexts.map((entry, canvasIndex) => {
      const rect = entry.canvas.getBoundingClientRect();
      const cssWidth = rect.width;
      const cssHeight = rect.height;
      return {
        canvasIndex,
        className: entry.canvas.className,
        cssWidth,
        cssHeight,
        drawingBufferWidth: entry.gl.drawingBufferWidth,
        drawingBufferHeight: entry.gl.drawingBufferHeight,
        effectiveDprX: cssWidth > 0
          ? entry.gl.drawingBufferWidth / cssWidth
          : null,
        effectiveDprY: cssHeight > 0
          ? entry.gl.drawingBufferHeight / cssHeight
          : null,
        maxRenderbufferDimension: entry.maxRenderbufferDimension,
        backingStoreHighWaterWidth: entry.backingStore.highWaterWidth,
        backingStoreHighWaterHeight: entry.backingStore.highWaterHeight,
        backingStoreHighWaterPixels: entry.backingStore.highWaterPixels,
      };
    });
    const effectiveScales = drawingBuffers.flatMap((buffer) => [
      buffer.effectiveDprX,
      buffer.effectiveDprY,
    ]).filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      measuredDeviceScaleFactor: window.devicePixelRatio,
      graphics: {
        windowDevicePixelRatio: window.devicePixelRatio,
        visualViewportScale: window.visualViewport?.scale ?? null,
        effectiveRendererDpr: effectiveScales.length
          ? Math.max(...effectiveScales)
          : null,
        contexts: state.graphicsContexts.map((entry) => ({
          api: entry.api,
          vendor: entry.vendor,
          renderer: entry.renderer,
          unmaskedVendor: entry.unmaskedVendor,
          unmaskedRenderer: entry.unmaskedRenderer,
          maxRenderbufferDimension: entry.maxRenderbufferDimension,
        })),
        drawingBuffers,
      },
      crossOriginIsolated,
    };
  });
  expect(runtime.viewport).toEqual(CHROMEBOOK_AUDIT_ENVIRONMENT.viewport);
  const expectedDeviceScaleFactor = overrides.expectedDeviceScaleFactor ??
    CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor;
  expect(runtime.measuredDeviceScaleFactor).toBe(expectedDeviceScaleFactor);
  return {
    ...CHROMEBOOK_AUDIT_ENVIRONMENT,
    deviceScaleFactor: expectedDeviceScaleFactor,
    browserVersion,
    userAgent: runtime.userAgent,
    measuredDeviceScaleFactor: runtime.measuredDeviceScaleFactor,
    throttlingScope,
    memoryIsolation: {
      source: "diagnostic-preview-response-headers",
      crossOriginOpenerPolicy: "same-origin",
      crossOriginEmbedderPolicy: "require-corp",
      crossOriginIsolated: runtime.crossOriginIsolated,
    },
    graphics: runtime.graphics,
  };
};

export const collectChromebookHighResolutionTelemetry = (
  page: Page,
): Promise<ChromebookHighResolutionTelemetry> =>
  page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    return {
      backingStoreMutationProbeSupported:
        state.backingStoreMutationProbeSupported,
      contextsLost: state.webgl.contextsLost,
      contextsRestored: state.webgl.contextsRestored,
      longTaskEntries: structuredClone(state.longTaskEntries),
      auditInternalMemoryMeasurementWindows: structuredClone(
        state.auditInternalMemoryMeasurementWindows,
      ),
      contexts: state.graphicsContexts.map((entry, contextIndex) => ({
        contextIndex,
        createdAtMs: entry.createdAtMs,
        maxRenderbufferDimension: entry.maxRenderbufferDimension,
        backingStore: structuredClone(entry.backingStore),
        frameSubmissions: structuredClone(entry.frameSubmissions),
      })),
    };
  });

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
  eventTaskEndMs?: number;
  firstRafMs?: number;
  nextPaintMs: number;
  interactionClass?: "general" | "direct";
  pointerEventOffsetsMs?: number[];
  causal?: {
    globalGlStartIndex: number;
    causalGlobalGlIndex: number;
    causalGlAtMs: number;
    foundryCanvasGlStartCount: number;
    foundryCanvasGlEndCount: number;
    rigSubmissionStartCount: number;
    rigSubmissionEndCount: number;
    gestureEmissionStartCount?: number;
    gestureEmissionCount?: number;
    gestureEmissionAtMs?: number;
    causalGlNotBeforeAtMs: number;
  };
};

export const measureClickToNextPaint = async (
  control: Locator,
): Promise<FeatureNextPaintTiming> => {
  await expect(control, "feature action is visible before timing").toBeVisible();
  await expect(control, "feature action is enabled before timing").toBeEnabled();
  return control.evaluate((element: HTMLElement) => {
    const startedAt = performance.now();
    element.click();
    let eventTaskEndMs: number | undefined;
    queueMicrotask(() => { eventTaskEndMs = performance.now() - startedAt; });
    return new Promise<FeatureNextPaintTiming>((resolve) => {
      requestAnimationFrame(() => {
        const firstRafMs = performance.now() - startedAt;
        requestAnimationFrame(() =>
          resolve({
            startedAt,
            eventTaskEndMs,
            firstRafMs,
            nextPaintMs: performance.now() - startedAt,
          }),
        );
      });
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
      memory: {
        source: memory
          ? "performance-memory-diagnostic"
          : "unsupported",
        authoritative: false,
        crossOriginIsolated,
        bytes: memory?.usedJSHeapSize,
      },
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

const measureFeatureMemory = (page: Page, sampleIndex: number) =>
  page.evaluate(async (sampleIndex) => {
    const extended = performance as Performance & {
      memory?: { usedJSHeapSize: number };
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    };
    if (typeof extended.measureUserAgentSpecificMemory === "function") {
      const state = (window as Window & {
        __MOTIONSMITH_CHROMEBOOK_AUDIT__?: BrowserAuditState;
      }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
      const startedAtMs = performance.now();
      try {
        const measurement = await extended.measureUserAgentSpecificMemory();
        return {
          source: "measure-user-agent-specific-memory" as const,
          authoritative: true,
          crossOriginIsolated,
          bytes: measurement.bytes,
        };
      } catch (error) {
        const fallback = extended.memory?.usedJSHeapSize;
        return {
          source: fallback !== undefined
            ? "performance-memory-diagnostic" as const
            : "unsupported" as const,
          authoritative: false,
          crossOriginIsolated,
          bytes: fallback,
          userAgentSpecificMemoryError:
            error instanceof Error ? error.message : String(error),
        };
      } finally {
        state?.auditInternalMemoryMeasurementWindows.push({
          owner: "feature-probe",
          phase: "stable-probe",
          sampleIndex,
          startedAtMs,
          endedAtMs: performance.now(),
        });
      }
    }
    const fallback = extended.memory?.usedJSHeapSize;
    return {
      source: fallback !== undefined
        ? "performance-memory-diagnostic" as const
        : "unsupported" as const,
      authoritative: false,
      crossOriginIsolated,
      bytes: fallback,
      userAgentSpecificMemoryError: "API unavailable",
    };
  }, sampleIndex);

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
  const memoryMeasurements = [await measureFeatureMemory(page, 0)];
  if (memoryMeasurements[0].authoritative) {
    for (let index = 1; index < 3; index += 1) {
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      memoryMeasurements.push(await measureFeatureMemory(page, index));
    }
  }
  const authoritativeSamples =
    memoryMeasurements.length === 3 &&
    memoryMeasurements.every(
      (measurement) =>
        measurement.source === "measure-user-agent-specific-memory" &&
        measurement.authoritative &&
        measurement.bytes !== undefined,
    )
    ? memoryMeasurements.flatMap((measurement) =>
        measurement.bytes === undefined ? [] : [measurement.bytes]
      )
    : [];
  const authoritativeMemory = authoritativeSamples.length === 3;
  const diagnosticBytes = samples.at(-1);
  const memoryError = memoryMeasurements.find(
    (measurement) => measurement.userAgentSpecificMemoryError,
  )?.userAgentSpecificMemoryError;
  const measuredMemory = authoritativeMemory
    ? memoryMeasurements.at(-1)!
    : {
        source: diagnosticBytes !== undefined
          ? "performance-memory-diagnostic" as const
          : "unsupported" as const,
        authoritative: false,
        crossOriginIsolated:
          memoryMeasurements.at(-1)?.crossOriginIsolated ?? false,
        bytes: diagnosticBytes,
        userAgentSpecificMemoryError:
          memoryError ?? "Authoritative memory sampling did not remain available",
      };
  return {
    ...probe,
    heapBytes: measuredMemory.bytes,
    heapSamplesBytes: authoritativeMemory
      ? authoritativeSamples
      : samples,
    memory: measuredMemory,
  };
};

export const waitForLifecycleBaseline = async (
  page: Page,
  baseline: RuntimeLifecycleSnapshot,
) => {
  await expect.poll(
    async () => {
      const current = (await readFeatureRuntimeProbe(page)).lifecycle;
      return {
        workers: current.workers.active <= baseline.workers.active,
        imageBitmaps: current.imageBitmaps.active <= baseline.imageBitmaps.active,
        objectUrls: current.objectUrls.active <= baseline.objectUrls.active,
      };
    },
    { message: "feature resources return to their ownership baseline" },
  ).toEqual({
    workers: true,
    imageBitmaps: true,
    objectUrls: true,
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
    ({
      actionStartedAt,
      causalGlNotBeforeAtMs,
      causalGlobalGlIndex,
      globalGlStartIndex,
      longTaskOffset,
      puppetTopologyOffset,
    }) => {
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
        longTasks: state.longTaskEntries
          .slice(longTaskOffset)
          .map((entry) => Math.max(
            0,
            entry.startTime + entry.duration - Math.max(
              entry.startTime,
              actionStartedAt,
            ),
          ))
          .filter((duration) => duration > 0),
        puppetTopologyDurations: state.puppetTopologyDurations.slice(puppetTopologyOffset),
        globalGlEndIndex: state.webglFrameSubmissions.length,
        renderSubmissionOffsetsMs: state.webglFrameSubmissions
          .slice(causalGlobalGlIndex ?? globalGlStartIndex)
          .filter((submittedAt) => submittedAt >= causalGlNotBeforeAtMs)
          .map((submittedAt) => submittedAt - actionStartedAt),
      };
    },
    {
      actionStartedAt: input.timing.startedAt,
      causalGlNotBeforeAtMs:
        input.timing.causal?.causalGlNotBeforeAtMs ?? input.timing.startedAt,
      causalGlobalGlIndex: input.timing.causal?.causalGlobalGlIndex,
      globalGlStartIndex: input.timing.causal?.globalGlStartIndex ?? 0,
      longTaskOffset: input.before.longTaskCount,
      puppetTopologyOffset: input.before.puppetTopologyCount,
    },
  );
  const latencyMs = percentiles(result.longTasks);
  const firstCausalGlOffsetMs = result.renderSubmissionOffsetsMs[0];
  const gestureEmissionOffsetMs = input.timing.causal?.gestureEmissionAtMs === undefined
    ? undefined
    : input.timing.causal.gestureEmissionAtMs - input.timing.startedAt;
  return {
    label: input.label,
    cycle: input.cycle,
    outcome: input.outcome,
    interactionClass: input.timing.interactionClass ?? "general",
    eventTaskEndMs: input.timing.eventTaskEndMs,
    firstRafMs: input.timing.firstRafMs,
    nextPaintMs: input.timing.nextPaintMs,
    renderSubmissionOffsetsMs: result.renderSubmissionOffsetsMs,
    causality: input.timing.causal && firstCausalGlOffsetMs !== undefined
      ? {
          actionStartedAtMs: input.timing.startedAt,
          globalGlStartIndex: input.timing.causal.globalGlStartIndex,
          globalGlEndIndex: result.globalGlEndIndex,
          causalGlobalGlIndex: input.timing.causal.causalGlobalGlIndex,
          causalGlAtMs: input.timing.causal.causalGlAtMs,
          foundryCanvasGlStartCount:
            input.timing.causal.foundryCanvasGlStartCount,
          foundryCanvasGlEndCount:
            input.timing.causal.foundryCanvasGlEndCount,
          rigSubmissionStartCount: input.timing.causal.rigSubmissionStartCount,
          rigSubmissionEndCount: input.timing.causal.rigSubmissionEndCount,
          gestureEmissionStartCount:
            input.timing.causal.gestureEmissionStartCount,
          gestureEmissionCount: input.timing.causal.gestureEmissionCount,
          gestureEmissionAtMs: input.timing.causal.gestureEmissionAtMs,
          pointerEventTimestampsMs: (input.timing.pointerEventOffsetsMs ?? [])
            .map((offset) => input.timing.startedAt + offset),
          pointerEventOffsetsMs: input.timing.pointerEventOffsetsMs ?? [],
          eventToGestureEmissionMs: gestureEmissionOffsetMs,
          gestureEmissionToFirstGlMs: gestureEmissionOffsetMs === undefined
            ? undefined
            : firstCausalGlOffsetMs - gestureEmissionOffsetMs,
          eventToFirstGlMs: firstCausalGlOffsetMs,
        }
      : undefined,
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

export type PlaybackAuditOptions = {
  controlsTestId?: string;
  warmPlateau?: PlaybackWarmPlateauEvidence;
  syntheticPressure?: {
    busyMs: number;
    startDelayMs: number;
  };
};

export const collectPlaybackAudit = async (
  page: Page,
  durationMs: number,
  options: PlaybackAuditOptions = {},
): Promise<PlaybackAudit> =>
  page.evaluate(async ({
    durationMs,
    growthRatio,
    growthFloor,
    requireAuthoritativeMemory,
    controlsTestId,
    warmPlateau,
    syntheticPressure,
  }) => {
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
    const extendedPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    };
    const measureMemory = async (
      phase: "baseline" | "tail",
      sampleIndex: number,
    ) => {
      if (typeof extendedPerformance.measureUserAgentSpecificMemory === "function") {
        const startedAtMs = performance.now();
        try {
          return {
            source: "measure-user-agent-specific-memory" as const,
            authoritative: true,
            crossOriginIsolated,
            bytes: (await extendedPerformance.measureUserAgentSpecificMemory()).bytes,
          };
        } catch (error) {
          const fallback = extendedPerformance.memory?.usedJSHeapSize;
          return {
            source: fallback !== undefined
              ? "performance-memory-diagnostic" as const
              : "unsupported" as const,
            authoritative: false,
            crossOriginIsolated,
            bytes: fallback,
            userAgentSpecificMemoryError:
              error instanceof Error ? error.message : String(error),
          };
        } finally {
          auditState()?.auditInternalMemoryMeasurementWindows.push({
            owner: "playback",
            phase,
            sampleIndex,
            startedAtMs,
            endedAtMs: performance.now(),
          });
        }
      }
      const fallback = extendedPerformance.memory?.usedJSHeapSize;
      return {
        source: fallback !== undefined
          ? "performance-memory-diagnostic" as const
          : "unsupported" as const,
        authoritative: false,
        crossOriginIsolated,
        bytes: fallback,
        userAgentSpecificMemoryError: "API unavailable",
      };
    };
    const findControlButton = (name: "Play" | "Pause") => {
      if (!controlsTestId) return undefined;
      const root = [...document.querySelectorAll<HTMLElement>("[data-testid]")]
        .find((element) => element.dataset.testid === controlsTestId);
      if (!root) throw new Error(`Playback controls ${controlsTestId} are missing`);
      const button = [...root.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) =>
          candidate.getAttribute("aria-label") === name ||
          candidate.textContent?.trim() === name
        );
      if (!button || button.disabled || button.getClientRects().length === 0) {
        throw new Error(`${controlsTestId} ${name} is not interactive`);
      }
      return button;
    };
    // Authoritative memory can itself block for seconds. Keep it in an
    // explicitly recorded, quiescent window before starting the renderer.
    findControlButton("Play");
    const memoryWindowOffset =
      auditState()?.auditInternalMemoryMeasurementWindows.length ?? 0;
    const firstMemory = await measureMemory("baseline", 0);
    const state = auditState();
    const diagnosticMemory = extendedPerformance.memory;
    const heap = diagnosticMemory ? [diagnosticMemory.usedJSHeapSize] : [];
    let playNextPaintMs = 0;
    if (controlsTestId) {
      const playStartedAtMs = performance.now();
      findControlButton("Play")?.click();
      playNextPaintMs = await new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame((time) =>
          resolve(time - playStartedAtMs)
        ));
      });
      findControlButton("Pause");
    }
    // Control commits and ownership setup are deliberately outside the steady
    // playback window. The caller must establish any cold-resource plateau
    // before the paused memory baseline.
    const before = snapshotWebGL();
    const beforeEvents = state?.eventDurations.length ?? 0;
    const beforeCommits = state?.reactCommits ?? 0;
    const beforeTopology = probeNumber("foundryTopologyBuilds");
    const beforeGeometry = probeNumber("foundryGeometryCacheSize");
    const beforeMaterial = probeNumber("foundryMaterialCacheSize");
    const beforeFrameSubmissions = state?.webglFrameSubmissions.length ?? 0;
    const eventLoopIntervals: number[] = [];
    const start = performance.now();
    const heapTimer = window.setInterval(() => {
      if (diagnosticMemory) heap.push(diagnosticMemory.usedJSHeapSize);
    }, Math.min(5_000, Math.max(250, durationMs / 20)));
    let pressureActive = syntheticPressure !== undefined;
    let pressureTimerTaskCount = 0;
    let pressureTimer: number | undefined;
    if (syntheticPressure) {
      const pressureTick = () => {
        if (!pressureActive) return;
        const busyUntil = performance.now() + syntheticPressure.busyMs;
        while (performance.now() < busyUntil) {
          // Deliberately block below the 50ms application Long Task gate.
        }
        pressureTimerTaskCount += 1;
        pressureTimer = window.setTimeout(pressureTick, 0);
      };
      pressureTimer = window.setTimeout(
        pressureTick,
        syntheticPressure.startDelayMs,
      );
    }
    let previous = start;
    await new Promise<void>((resolve) => {
      const tick = (time: number) => {
        eventLoopIntervals.push(time - previous);
        previous = time;
        if (time - start >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const end = performance.now();
    pressureActive = false;
    if (pressureTimer !== undefined) clearTimeout(pressureTimer);
    clearInterval(heapTimer);
    if (diagnosticMemory) heap.push(diagnosticMemory.usedJSHeapSize);
    const after = snapshotWebGL();
    const afterCommits = state?.reactCommits ?? 0;
    const afterTopology = probeNumber("foundryTopologyBuilds");
    const afterGeometry = probeNumber("foundryGeometryCacheSize");
    const afterMaterial = probeNumber("foundryMaterialCacheSize");
    const eventDurations = (state?.eventDurations ?? []).slice(beforeEvents);
    let pauseNextPaintMs = 0;
    if (controlsTestId) {
      const pauseStartedAtMs = performance.now();
      findControlButton("Pause")?.click();
      pauseNextPaintMs = await new Promise<number>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame((time) =>
          resolve(time - pauseStartedAtMs)
        ));
      });
      findControlButton("Play");
    }
    const frameSubmissions = (state?.webglFrameSubmissions ?? [])
      .slice(beforeFrameSubmissions)
      .filter((time) => time >= start && time <= end);
    const submissionIntervals: number[] = [];
    let priorSubmission = start;
    for (const submission of frameSubmissions) {
      submissionIntervals.push(submission - priorSubmission);
      priorSubmission = submission;
    }
    submissionIntervals.push(end - priorSubmission);
    const validIntervals = submissionIntervals.filter((value) => value > 0);
    const validEventLoopIntervals = eventLoopIntervals.filter((value) => value > 0);
    const longTasks = (state?.longTaskEntries ?? [])
      .filter((entry) =>
        entry.startTime < end && entry.startTime + entry.duration > start
      )
      .map((entry) => entry.duration);
    // Tail measurements run only after playback and pressure are stopped.
    const memoryTailMeasurements = [await measureMemory("tail", 0)];
    if (
      firstMemory.authoritative &&
      memoryTailMeasurements[0].authoritative
    ) {
      memoryTailMeasurements.push(await measureMemory("tail", 1));
      memoryTailMeasurements.push(await measureMemory("tail", 2));
    }
    const allMemoryMeasurements = [firstMemory, ...memoryTailMeasurements];
    const lastMemory = memoryTailMeasurements.at(-1)!;
    const sameMemorySource = allMemoryMeasurements.every(
      (measurement) => measurement.source === firstMemory.source,
    );
    const memorySource = sameMemorySource && firstMemory.source !== "unsupported"
      ? firstMemory.source
      : "unsupported" as const;
    const authoritative =
      memorySource === "measure-user-agent-specific-memory" &&
      allMemoryMeasurements.every(
        (measurement) =>
          measurement.authoritative && measurement.bytes !== undefined,
      ) &&
      crossOriginIsolated;
    const diagnosticAvailable =
      memorySource !== "unsupported" &&
      allMemoryMeasurements.every(
        (measurement) => measurement.bytes !== undefined,
      );
    const firstBytes = diagnosticAvailable ? firstMemory.bytes! : 0;
    const lastBytes = diagnosticAvailable ? lastMemory.bytes! : 0;
    const allowedGrowthBytes = Math.max(growthFloor, firstBytes * growthRatio);
    const authoritativeTail = authoritative
      ? memoryTailMeasurements.flatMap((measurement) =>
          measurement.bytes === undefined ? [] : [measurement.bytes]
        )
      : [];
    const diagnosticTail = memorySource === "performance-memory-diagnostic"
      ? [
          ...heap.slice(Math.max(0, Math.floor(heap.length * 0.8))),
          ...(lastMemory.bytes === undefined ? [] : [lastMemory.bytes]),
        ]
      : [];
    const tail = authoritativeTail.length >= 3
      ? authoritativeTail
      : diagnosticTail;
    const tailRangeBytes = tail.length ? Math.max(...tail) - Math.min(...tail) : 0;
    const memorySupported =
      diagnosticAvailable && (!requireAuthoritativeMemory || authoritative);
    const resourceKinds = new Set([
      ...Object.keys(before.resources),
      ...Object.keys(after.resources),
    ]);
    const resourceDeltaByKind = Object.fromEntries(
      [...resourceKinds].sort().map((kind) => {
        const beforeCounters = before.resources[kind] ?? {
          created: 0,
          deleted: 0,
          live: 0,
          peakLive: 0,
        };
        const afterCounters = after.resources[kind] ?? {
          created: 0,
          deleted: 0,
          live: 0,
          peakLive: 0,
        };
        return [kind, {
          created: afterCounters.created - beforeCounters.created,
          deleted: afterCounters.deleted - beforeCounters.deleted,
          live: afterCounters.live - beforeCounters.live,
        }];
      }),
    );
    const framesOver50 = validIntervals.filter((value) => value > 50).length;
    return {
      frameSource: "webgl-clear-submission" as const,
      timedWindow: { startedAtMs: start, endedAtMs: end },
      controlActions: controlsTestId
        ? { controlsTestId, playNextPaintMs, pauseNextPaintMs }
        : undefined,
      warmPlateau,
      memoryMeasurementWindows:
        (auditState()?.auditInternalMemoryMeasurementWindows ?? [])
          .slice(memoryWindowOffset),
      syntheticPressure: syntheticPressure
        ? {
            startedAtMs: start,
            endedAtMs: end,
            timerTaskCount: pressureTimerTaskCount,
          }
        : undefined,
      durationMs: end - start,
      frameCount: frameSubmissions.length,
      frameIntervalMs: measurePercentiles(validIntervals),
      framesOver50,
      framesOver50Percent: validIntervals.length ? framesOver50 / validIntervals.length * 100 : 100,
      framesOver200: validIntervals.filter((value) => value > 200).length,
      eventLoopRaf: {
        sampleCount: validEventLoopIntervals.length,
        intervalMs: measurePercentiles(validEventLoopIntervals),
        intervalsOver50: validEventLoopIntervals.filter((value) => value > 50).length,
        intervalsOver50Percent: validEventLoopIntervals.length
          ? validEventLoopIntervals.filter((value) => value > 50).length /
            validEventLoopIntervals.length * 100
          : 100,
        intervalsOver200: validEventLoopIntervals.filter((value) => value > 200).length,
      },
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((sum, value) => sum + value, 0),
        maxMs: longTasks.length ? Math.max(...longTasks) : 0,
      },
      browserEventLatencyMs: measurePercentiles(eventDurations),
      reactCommits: Math.max(0, afterCommits - beforeCommits),
      heap: {
        supported: memorySupported,
        diagnosticAvailable,
        metricSource: memorySource,
        authoritative,
        crossOriginIsolated,
        userAgentSpecificMemoryError:
          (!sameMemorySource
            ? "Memory metric source changed between baseline and final"
            : allMemoryMeasurements.find(
                (measurement) => measurement.userAgentSpecificMemoryError,
              )?.userAgentSpecificMemoryError),
        samples: tail.length,
        firstBytes,
        lastBytes,
        growthBytes: lastBytes - firstBytes,
        allowedGrowthBytes,
        tailRangeBytes,
        stable:
          memorySupported &&
          tail.length >= 3 &&
          lastBytes - firstBytes <= allowedGrowthBytes &&
          tailRangeBytes <= allowedGrowthBytes,
      },
      webgl: {
        before,
        after,
        resourceDeltaByKind,
        liveResourceDelta: liveResources(after) - liveResources(before),
        contextDelta: after.contextsCreated - before.contextsCreated,
        contextLossDelta: after.contextsLost - before.contextsLost,
        contextRestoreDelta: after.contextsRestored - before.contextsRestored,
        topologyBuildDelta: afterTopology - beforeTopology,
        geometryCacheDelta: afterGeometry - beforeGeometry,
        materialCacheDelta: afterMaterial - beforeMaterial,
      },
    };
  }, {
    durationMs,
    growthRatio: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
    growthFloor: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
    requireAuthoritativeMemory: CHROMEBOOK_AUDIT_PROFILE.officialAcceptance,
    controlsTestId: options.controlsTestId,
    warmPlateau: options.warmPlateau,
    syntheticPressure: options.syntheticPressure,
  });

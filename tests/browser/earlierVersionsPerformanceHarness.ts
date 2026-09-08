import { type BrowserContext, type CDPSession, type Page } from "@playwright/test";

export type WorkerRequest = {
  id?: number;
  type: string;
  postedAtMs: number;
  nativePostMessageTransferDurationMs: number;
  transferCount: number;
};

export type WorkerResponse = {
  id?: number;
  type?: string;
  responseAtMs: number;
  workerDurationMs: number | null;
  roundTripMs: number | null;
};

export type VersionWorkerMetric = {
  workerId: number;
  url: string;
  name: string;
  isVersionWorker: boolean;
  constructedAtMs: number;
  terminatedAtMs?: number;
  requests: WorkerRequest[];
  responses: WorkerResponse[];
};

export type HeapSample = {
  phase: string;
  atMs: number;
  jsHeapUsedSize: number | null;
  jsHeapTotalSize: number | null;
  documents: number | null;
  nodes: number | null;
  jsEventListeners: number | null;
  projectPuppetCount: number;
  canvasCount: number;
  previewCount: number;
  panelCanvasCount: number;
  versionWorkerCount: number;
  liveVersionWorkerCount: number;
};

type StoredVersionManifest = {
  authority?: { branchId?: string; projectId?: string };
  projectName?: string;
  entries?: Array<{
    id: string;
    reason: string;
    assetIds: string[];
    snapshotId: string;
    bytes: number;
  }>;
  snapshotBytes?: Record<string, number>;
  assetBytes?: Record<string, number>;
};

export type StorageSnapshot = {
  branchId?: string;
  catalog: Array<{ branchId: string; bytes: number; versions: number }>;
  manifest?: StoredVersionManifest;
  keyCount: number;
};

/**
 * Install before the shared Chromebook probe so its native prototype wrapper
 * remains underneath the probe's postMessage wrapper.
 */
export const installVersionPerformanceInstrumentation = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    const state = { workers: [] as VersionWorkerMetric[] };
    const host = window as Window & {
      __MOTIONSMITH_EARLIER_VERSIONS_PERF__?: { workers: VersionWorkerMetric[] };
    };
    host.__MOTIONSMITH_EARLIER_VERSIONS_PERF__ = state;

    const NativeWorker = window.Worker;
    const workerByInstance = new WeakMap<Worker, VersionWorkerMetric>();
    const nativePostMessage = NativeWorker.prototype.postMessage;
    const nativeTerminate = NativeWorker.prototype.terminate;

    try {
      Object.defineProperty(NativeWorker.prototype, "postMessage", {
        configurable: true,
        value: function (this: Worker, message: unknown, ...rest: unknown[]) {
          const metric = workerByInstance.get(this);
          const data = message && typeof message === "object"
            ? message as { id?: unknown; type?: unknown }
            : undefined;
          const request: WorkerRequest | undefined = metric?.isVersionWorker
            ? {
                id: typeof data?.id === "number" ? data.id : undefined,
                type: typeof data?.type === "string" ? data.type : "unknown",
                postedAtMs: performance.now(),
                nativePostMessageTransferDurationMs: 0,
                transferCount: Array.isArray(rest[0]) ? rest[0].length : 0,
              }
            : undefined;
          if (request) metric!.requests.push(request);
          const startedAt = request?.postedAtMs ?? performance.now();
          try {
            return rest.length
              ? Reflect.apply(nativePostMessage, this, [message, ...rest])
              : Reflect.apply(nativePostMessage, this, [message]);
          } finally {
            if (request) request.nativePostMessageTransferDurationMs = performance.now() - startedAt;
          }
        },
      });
    } catch {
      // The raw metric remains available where the native prototype is read-only.
    }

    try {
      Object.defineProperty(NativeWorker.prototype, "terminate", {
        configurable: true,
        value: function (this: Worker) {
          const metric = workerByInstance.get(this);
          if (metric && metric.terminatedAtMs === undefined) metric.terminatedAtMs = performance.now();
          return Reflect.apply(nativeTerminate, this, []);
        },
      });
    } catch {
      // Worker lifetime is still measured from construction when termination is unavailable.
    }

    const InstrumentedWorker = new Proxy(NativeWorker, {
      construct(target, args) {
        const instance = Reflect.construct(target, args) as Worker;
        const options = args[1] as WorkerOptions | undefined;
        const url = String(args[0] ?? "");
        const name = options?.name ?? "";
        const metric: VersionWorkerMetric = {
          workerId: state.workers.length + 1,
          url,
          name,
          isVersionWorker: name === "motionsmith-versions" || /projectVersionsWorker/i.test(url),
          constructedAtMs: performance.now(),
          requests: [],
          responses: [],
        };
        state.workers.push(metric);
        workerByInstance.set(instance, metric);

        if (metric.isVersionWorker) {
          instance.addEventListener("message", (event: MessageEvent) => {
            const payload = event.data as { id?: unknown; type?: unknown; durationMs?: unknown } | undefined;
            const id = typeof payload?.id === "number" ? payload.id : undefined;
            const request = metric.requests.find(item => item.id === id &&
              !metric.responses.some(response => response.id === item.id));
            const responseAtMs = performance.now();
            const workerDurationMs = typeof payload?.durationMs === "number" &&
              Number.isFinite(payload.durationMs) ? payload.durationMs : null;
            metric.responses.push({
              id,
              type: typeof payload?.type === "string" ? payload.type : request?.type,
              responseAtMs,
              workerDurationMs,
              roundTripMs: request ? responseAtMs - request.postedAtMs : null,
            });
          });
        }
        return instance;
      },
    });
    Object.defineProperty(window, "Worker", { configurable: true, value: InstrumentedWorker });
  });
};

export const readWorkerActivity = async (page: Page, startedAtMs: number, endedAtMs: number) => page.evaluate(({ startedAtMs, endedAtMs }) => {
  const state = (window as Window & {
    __MOTIONSMITH_EARLIER_VERSIONS_PERF__?: { workers: VersionWorkerMetric[] };
  }).__MOTIONSMITH_EARLIER_VERSIONS_PERF__;
  const versionWorkers = state?.workers.filter(worker => worker.isVersionWorker) ?? [];
  const requests = versionWorkers.flatMap(worker => worker.requests)
    .filter(request => request.postedAtMs >= startedAtMs && request.postedAtMs <= endedAtMs);
  const requestIds = new Set(requests.map(request => request.id));
  const responses = versionWorkers.flatMap(worker => worker.responses)
    .filter(response => requestIds.has(response.id));
  return { requests, responses };
}, { startedAtMs, endedAtMs });

export const readStorage = async (page: Page): Promise<StorageSnapshot> => page.evaluate(async ({ databaseName, storeName }) => {
  const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB read failed"));
  });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const operation = indexedDB.open(databaseName, 1);
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB open failed"));
  });
  const store = database.transaction(storeName, "readonly").objectStore(storeName);
  const metadata = await request(store.get("metadata")) as { historyBranchId?: string } | undefined;
  const keys = (await request(store.getAllKeys())).map(String);
  const catalog = await request(store.get("versions:catalog")) as StorageSnapshot["catalog"] | undefined;
  const branchId = metadata?.historyBranchId ?? keys
    .find(key => key.startsWith("versions:") && key.endsWith(":manifest"))
    ?.slice("versions:".length, -":manifest".length);
  const manifest = branchId
    ? await request(store.get(`versions:${branchId}:manifest`)) as StoredVersionManifest | undefined
    : undefined;
  database.close();
  return { branchId, catalog: catalog ?? [], manifest, keyCount: keys.length };
}, { databaseName: "motionsmith-persistence", storeName: "autosave-journal" });

export const sampleHeap = async (page: Page, client: CDPSession, phase: string): Promise<HeapSample> => {
  const metrics = await client.send("Performance.getMetrics").catch(() => ({ metrics: [] as Array<{ name: string; value: number }> })) as { metrics: Array<{ name: string; value: number }> };
  const byName = new Map(metrics.metrics.map(item => [item.name, item.value]));
  const dom = await client.send("Memory.getDOMCounters").catch(() => ({})) as Partial<HeapSample>;
  const counts = await page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_EARLIER_VERSIONS_PERF__?: { workers: VersionWorkerMetric[] };
    }).__MOTIONSMITH_EARLIER_VERSIONS_PERF__;
    const workers = state?.workers.filter(worker => worker.isVersionWorker) ?? [];
    return {
      atMs: performance.now(),
      projectPuppetCount: document.querySelectorAll('[data-testid="project-three-puppet"]').length,
      canvasCount: document.querySelectorAll("canvas").length,
      previewCount: document.querySelectorAll('[data-testid="earlier-version-preview"]').length,
      panelCanvasCount: document.querySelectorAll('[data-testid="earlier-versions-panel"] canvas').length,
      versionWorkerCount: workers.length,
      liveVersionWorkerCount: workers.filter(worker => worker.terminatedAtMs === undefined).length,
      jsHeapUsedSize: (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize ?? null,
    };
  });
  return {
    phase,
    atMs: counts.atMs,
    jsHeapUsedSize: byName.get("JSHeapUsedSize") ?? counts.jsHeapUsedSize,
    jsHeapTotalSize: byName.get("JSHeapTotalSize") ?? null,
    documents: typeof dom.documents === "number" ? dom.documents : null,
    nodes: typeof dom.nodes === "number" ? dom.nodes : null,
    jsEventListeners: typeof dom.jsEventListeners === "number" ? dom.jsEventListeners : null,
    projectPuppetCount: counts.projectPuppetCount,
    canvasCount: counts.canvasCount,
    previewCount: counts.previewCount,
    panelCanvasCount: counts.panelCanvasCount,
    versionWorkerCount: counts.versionWorkerCount,
    liveVersionWorkerCount: counts.liveVersionWorkerCount,
  };
};

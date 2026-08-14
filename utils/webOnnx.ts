import {
  createWebOnnxCacheStatus,
  resolveWebOnnxModelUrl,
  WebOnnxError,
  type WebOnnxCacheStatus,
  type WebOnnxResult,
  type WorkerMessage,
} from "./webOnnxProtocol";

export { WebOnnxError } from "./webOnnxProtocol";
export type {
  WebOnnxCacheStatus,
  WebOnnxResult,
} from "./webOnnxProtocol";

let nextJobId = 1;
type Job = {
  cancel: (code: "canceled" | "superseded") => void;
};

let activeProcessJob: Job | undefined;
let warmInFlight: Promise<WebOnnxCacheStatus> | undefined;
let reusableWorker: Worker | undefined;

const documentUrl = () =>
  typeof window !== "undefined"
    ? window.location.href
    : globalThis.location?.href ?? "http://motionsmith.invalid/";

const modelUrl = () => resolveWebOnnxModelUrl(
  import.meta.env?.BASE_URL ?? "/",
  documentUrl(),
);

const imageAiWorker = () =>
  (reusableWorker ??= new Worker(
    new URL("./webOnnxWorker.ts", import.meta.url),
    { type: "module", name: "motionsmith-image-ai" },
  ));

const retireWorker = (worker: Worker) => {
  if (reusableWorker === worker) reusableWorker = undefined;
  worker.terminate();
};

const canceledError = () =>
  new WebOnnxError("canceled", "Image import canceled.");

const waitForWarm = (signal?: AbortSignal) => {
  const pending = warmInFlight;
  if (!pending) {
    return signal?.aborted ? Promise.reject(canceledError()) : Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(canceledError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    pending.then(finish, finish);
  });
};

const runWorker = <T>(
  request: { type: "warm" } | { type: "process"; file: File },
  onMessage: (message: WorkerMessage) => void,
  signal?: AbortSignal,
  serializeAfterWarm = false,
) => {
  if (request.type === "process") activeProcessJob?.cancel("superseded");
  return new Promise<T>((resolve, reject) => {
    let worker: Worker | undefined;
    let id = 0;
    let settled = false;
    const finish = (value: T | WebOnnxError, failed = false, retire = failed) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        if (retire) retireWorker(worker);
      }
      if (activeProcessJob?.cancel === cancel) activeProcessJob = undefined;
      if (failed) reject(value);
      else resolve(value as T);
    };
    const cancel = (code: "canceled" | "superseded") =>
      finish(
        new WebOnnxError(
          code,
          code === "canceled" ? "Image import canceled." : "A newer image import started.",
        ),
        true,
        true,
      );
    const abort = () => cancel("canceled");
    if (request.type === "process") activeProcessJob = { cancel };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    const start = () => {
      if (settled) return;
      if (typeof Worker === "undefined") {
        finish(new WebOnnxError("worker-unavailable", "This browser cannot run image AI."), true);
        return;
      }
      id = nextJobId++;
      worker = imageAiWorker();
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (data.id !== id) return;
        if (typeof performance !== "undefined") {
          if (data.type === "progress" && request.type === "process") {
            performance.mark("motionsmith-image-process-progress", {
              detail: { requestId: id, stage: data.stage, progress: data.progress },
            });
          }
          if (data.type === "result") {
            const markName = request.type === "process"
              ? "motionsmith-image-process-result"
              : "motionsmith-image-warm-result";
            const result = data.result;
            performance.mark(markName, {
              detail: {
                requestId: id,
                metrics: result && typeof result === "object" && "metrics" in result
                  ? result.metrics
                  : undefined,
              },
            });
          }
        }
        onMessage(data);
        if (data.type === "result") finish(data.result as T);
        if (data.type === "error") finish(new WebOnnxError(data.code, data.message), true);
      };
      worker.onerror = () =>
        finish(new WebOnnxError("worker-unavailable", "Image AI worker failed to start."), true);
      const message = { id, modelUrl: modelUrl(), ...request };
      if (request.type === "process" && typeof performance !== "undefined") {
        performance.mark("motionsmith-image-process-dispatch", {
          detail: { requestId: id },
        });
      }
      worker.postMessage(message);
    };
    if (serializeAfterWarm && warmInFlight) {
      void waitForWarm(signal).then(
        start,
        (error) => finish(error instanceof WebOnnxError ? error : canceledError(), true, false),
      );
    } else {
      start();
    }
  });
};

export const cancelWebOnnxProcessing = () => activeProcessJob?.cancel("canceled");

export const warmWebOnnxCache = async (
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
): Promise<WebOnnxCacheStatus> => {
  if (warmInFlight) {
    const existing = warmInFlight;
    return existing.then((status) => {
      onStatus(status);
      return status;
    });
  }
  const operation = runWorker<WebOnnxCacheStatus>({ type: "warm" }, (message) => {
    if (message.type === "cache") onStatus(message.status);
  });
  const settled = operation.then(
    (status) => status,
    (error) => {
      if (error instanceof WebOnnxError && (error.code === "canceled" || error.code === "superseded")) {
        return createWebOnnxCacheStatus("missing", 0);
      }
      const failed = createWebOnnxCacheStatus("error", 0, {
        error: error instanceof Error ? error.message : String(error),
      });
      onStatus(failed);
      return failed;
    },
  );
  warmInFlight = settled;
  void settled.then(() => {
    if (warmInFlight === settled) warmInFlight = undefined;
  });
  try {
    return await settled;
  } finally {
    if (warmInFlight === settled) warmInFlight = undefined;
  }
};

export const processImageWithWebOnnx = (
  file: File,
  onProgress: (stage: string, progress: number) => void = () => {},
  options: { signal?: AbortSignal } = {},
) =>
  runWorker<WebOnnxResult>(
    { type: "process", file },
    (message) => {
      if (message.type === "progress") onProgress(message.stage, message.progress);
    },
    options.signal,
    true,
  );

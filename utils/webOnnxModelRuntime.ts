import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import {
  createWebOnnxCacheStatus,
  WEB_ONNX_LEGACY_MODEL_CACHE_NAMES,
  WEB_ONNX_MODEL_BYTES,
  WEB_ONNX_MODEL_BYTES_HEADER,
  WEB_ONNX_MODEL_CACHE_NAME,
  WEB_ONNX_MODEL_DOWNLOAD_STALL_MS,
  WEB_ONNX_GIT_LFS_POINTER_PREFIX,
  WEB_ONNX_MODEL_LABEL,
  type WebOnnxCacheStatus,
  type WebOnnxCacheStage,
  type WebOnnxRuntimeFailurePhase,
} from "./webOnnxProtocol";

export type OrtRuntime = typeof import("onnxruntime-web/wasm");
export type OrtSession = Awaited<
  ReturnType<OrtRuntime["InferenceSession"]["create"]>
>;

export type WebOnnxModelPhase = "downloading-model" | "loading-model";

export class WebOnnxRuntimeError extends Error {
  constructor(
    public readonly phase: WebOnnxRuntimeFailurePhase,
    message: string,
  ) {
    super(message);
    this.name = "WebOnnxRuntimeError";
  }
}

const bundledAssetUrl = (path: string) =>
  new URL(path, self.location.href).href;

export const ortRuntimeWasmUrl = () => bundledAssetUrl(ortWasmUrl);

const supportsCacheApi = () => "caches" in self;
const cacheStatus = (
  stage: WebOnnxCacheStage,
  progress: number,
  extra: Partial<WebOnnxCacheStatus> = {},
) => createWebOnnxCacheStatus(stage, progress, extra);

const cachedModelResponse = async (modelUrl: string) => {
  if (!supportsCacheApi()) return undefined;
  const cache = await caches.open(WEB_ONNX_MODEL_CACHE_NAME);
  return cache.match(modelUrl);
};

export const deleteCachedModel = async (modelUrl: string) => {
  if (!supportsCacheApi()) return;
  const cache = await caches.open(WEB_ONNX_MODEL_CACHE_NAME);
  await cache.delete(modelUrl);
};

export const bufferLooksLikeGitLfsPointer = (buffer: ArrayBuffer) =>
  new TextDecoder()
    .decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)))
    .startsWith(WEB_ONNX_GIT_LFS_POINTER_PREFIX);

export const isUsableModelBuffer = (buffer: ArrayBuffer) =>
  buffer.byteLength === WEB_ONNX_MODEL_BYTES &&
  !bufferLooksLikeGitLfsPointer(buffer);

export const assertUsableModelBuffer = (
  buffer: ArrayBuffer,
  source: string,
) => {
  if (isUsableModelBuffer(buffer)) return;
  if (bufferLooksLikeGitLfsPointer(buffer)) {
    throw new Error(
      `${source} is a Git LFS pointer, not ONNX model bytes. Redeploy with Git LFS assets fetched.`,
    );
  }
  throw new Error(
    `${source} is ${buffer.byteLength} bytes; expected ${WEB_ONNX_MODEL_BYTES} real ONNX model bytes.`,
  );
};

const assertCompleteModelDownload = (buffer: ArrayBuffer, total?: number) => {
  if (!total || buffer.byteLength === total) return;
  throw new Error(
    `${WEB_ONNX_MODEL_LABEL} download disconnected after ${buffer.byteLength}/${total} bytes. Try again.`,
  );
};

export const readCachedModel = async (modelUrl: string) => {
  const response = await cachedModelResponse(modelUrl);
  if (!response) return undefined;
  const markedBytes = Number(response.headers.get(WEB_ONNX_MODEL_BYTES_HEADER)) || undefined;
  const buffer = await response.arrayBuffer();
  if (markedBytes && markedBytes !== buffer.byteLength) {
    await deleteCachedModel(modelUrl);
    return undefined;
  }
  if (!isUsableModelBuffer(buffer)) {
    await deleteCachedModel(modelUrl);
    return undefined;
  }
  if (!response.headers.has(WEB_ONNX_MODEL_BYTES_HEADER)) {
    await cacheModelBuffer(modelUrl, buffer);
  }
  return buffer;
};

const fetchModelWithProgress = async (
  modelUrl: string,
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
) => {
  const reportStatus = createProgressReporter(onStatus);
  const response = await fetch(modelUrl, { cache: "reload" });
  if (!response.ok) {
    throw new Error(`Could not download ${WEB_ONNX_MODEL_LABEL}: ${response.status}`);
  }
  const total = Number(response.headers.get("content-length")) || undefined;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    assertCompleteModelDownload(buffer, total);
    reportStatus(cacheStatus("downloading", 100, {
      bytesLoaded: buffer.byteLength,
      bytesTotal: total,
    }));
    return buffer;
  }

  let loaded = 0;
  let stallTimer = 0;
  const resetStallTimer = (
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    self.clearTimeout(stallTimer);
    stallTimer = self.setTimeout(
      () => controller.error(new Error("model-download-stalled")),
      WEB_ONNX_MODEL_DOWNLOAD_STALL_MS,
    );
  };
  const monitored = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start: resetStallTimer,
      transform(value, controller) {
        resetStallTimer(controller);
        loaded += value.byteLength;
        reportStatus(cacheStatus(
          "downloading",
          total ? Math.round((loaded / total) * 100) : 50,
          { bytesLoaded: loaded, bytesTotal: total },
        ));
        controller.enqueue(value);
      },
      flush() {
        self.clearTimeout(stallTimer);
      },
    }),
  );
  try {
    const buffer = await new Response(monitored).arrayBuffer();
    assertCompleteModelDownload(buffer, total);
    return buffer;
  } finally {
    self.clearTimeout(stallTimer);
  }
};

const cacheModelBuffer = async (modelUrl: string, buffer: ArrayBuffer) => {
  assertUsableModelBuffer(buffer, WEB_ONNX_MODEL_LABEL);
  if (!supportsCacheApi()) return;
  const cache = await caches.open(WEB_ONNX_MODEL_CACHE_NAME);
  await cache.put(
    modelUrl,
    new Response(buffer, {
      headers: {
        "content-type": "application/octet-stream",
        [WEB_ONNX_MODEL_BYTES_HEADER]: String(buffer.byteLength),
      },
    }),
  );
};

export const checkWebOnnxCache = async (modelUrl: string): Promise<WebOnnxCacheStatus> => {
  try {
    if (supportsCacheApi()) {
      await Promise.all(
        WEB_ONNX_LEGACY_MODEL_CACHE_NAMES.map((name) => caches.delete(name)),
      );
    }
    const buffer = await readCachedModel(modelUrl);
    if (buffer) {
      return cacheStatus("cached", 100, {
        bytesLoaded: buffer.byteLength,
        bytesTotal: buffer.byteLength,
      });
    }
    return cacheStatus("missing", 0);
  } catch (error) {
    return cacheStatus("error", 0, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const warmWebOnnxCache = async (
  modelUrl: string,
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
): Promise<WebOnnxCacheStatus> => {
  try {
    onStatus(cacheStatus("checking", 0));
    const cached = await checkWebOnnxCache(modelUrl);
    if (cached.stage === "cached") {
      const ready = cacheStatus("cached", 100, {
        bytesLoaded: cached.bytesLoaded,
        bytesTotal: cached.bytesTotal,
      });
      onStatus(ready);
      return ready;
    }
    const buffer = await fetchModelWithProgress(modelUrl, onStatus);
    await cacheModelBuffer(modelUrl, buffer);
    const ready = cacheStatus("cached", 100, {
      bytesLoaded: buffer.byteLength,
      bytesTotal: buffer.byteLength,
    });
    onStatus(ready);
    return ready;
  } catch (error) {
    const failed = cacheStatus("error", 0, {
      error: error instanceof Error ? error.message : String(error),
    });
    onStatus(failed);
    return failed;
  }
};

export const loadWebOnnxModelBuffer = async (
  modelUrl: string,
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
) => {
  const cached = await readCachedModel(modelUrl);
  if (cached) {
    onStatus(cacheStatus("cached", 100, {
      bytesLoaded: cached.byteLength,
      bytesTotal: cached.byteLength,
    }));
    return cached;
  }
  const buffer = await fetchModelWithProgress(modelUrl, onStatus);
  await cacheModelBuffer(modelUrl, buffer);
  onStatus(cacheStatus("cached", 100, {
    bytesLoaded: buffer.byteLength,
    bytesTotal: buffer.byteLength,
  }));
  return buffer;
};

let ortRuntimePromise: Promise<OrtRuntime> | null = null;
export const loadOrtRuntime = () => {
  ortRuntimePromise ??= import("onnxruntime-web/wasm");
  return ortRuntimePromise;
};

export const configureOrtWasm = (ort: OrtRuntime) => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortRuntimeWasmUrl() };
};

const PROGRESS_UPDATE_INTERVAL_MS = 120;
const PROGRESS_UPDATE_PERCENT_DELTA = 5;

const createProgressReporter = (
  onStatus: (status: WebOnnxCacheStatus) => void,
) => {
  let lastProgress = -1;
  let lastReportedAt = -Infinity;
  return (status: WebOnnxCacheStatus) => {
    if (status.stage !== "downloading") {
      onStatus(status);
      return;
    }
    const progress = Math.max(0, Math.min(100, Math.round(status.progress)));
    const now = performance.now();
    const terminal = progress >= 100;
    if (
      !terminal &&
      (
        now - lastReportedAt < PROGRESS_UPDATE_INTERVAL_MS ||
        progress - lastProgress < PROGRESS_UPDATE_PERCENT_DELTA
      )
    ) {
      return;
    }
    lastProgress = progress;
    lastReportedAt = now;
    onStatus({ ...status, progress });
  };
};

export interface WebOnnxSessionLease {
  session: OrtSession;
  modelInitMs: number;
  modelReused: boolean;
  modelBytes: number;
}

let cachedSession: {
  modelUrl: string;
  session: OrtSession;
  modelInitMs: number;
} | undefined;
let sessionLoad: {
  modelUrl: string;
  promise: Promise<WebOnnxSessionLease>;
} | undefined;

const createWebOnnxSession = async (
  modelUrl: string,
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
  onPhase: (phase: WebOnnxModelPhase) => void = () => {},
): Promise<WebOnnxSessionLease> => {
  onPhase("downloading-model");
  let modelBuffer: ArrayBuffer;
  try {
    modelBuffer = await loadWebOnnxModelBuffer(modelUrl, onStatus);
  } catch (error) {
    throw new WebOnnxRuntimeError(
      "model-download",
      error instanceof Error ? error.message : String(error),
    );
  }
  onPhase("loading-model");
  let session: OrtSession;
  let modelInitMs: number;
  try {
    const ort = await loadOrtRuntime();
    configureOrtWasm(ort);
    const startedAt = performance.now();
    session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
      executionProviders: ["wasm"],
    });
    modelInitMs = performance.now() - startedAt;
  } catch (error) {
    throw new WebOnnxRuntimeError(
      "session-create",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (cachedSession && cachedSession.modelUrl !== modelUrl) {
    await cachedSession.session.release();
  }
  cachedSession = { modelUrl, session, modelInitMs };
  // Keep only the ORT session. The 136 MB ArrayBuffer is intentionally local
  // to this call; after creation there are zero application-owned references to
  // that buffer. This does not claim that ORT's internal/native copies are GC'd.
  return {
    session,
    modelInitMs,
    modelReused: false,
    modelBytes: modelBuffer.byteLength,
  };
};

export const loadWebOnnxSession = async (
  modelUrl: string,
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
  onPhase: (phase: WebOnnxModelPhase) => void = () => {},
): Promise<WebOnnxSessionLease> => {
  if (cachedSession?.modelUrl === modelUrl) {
    onPhase("loading-model");
    return {
      session: cachedSession.session,
      modelInitMs: 0,
      modelReused: true,
      modelBytes: WEB_ONNX_MODEL_BYTES,
    };
  }
  if (sessionLoad?.modelUrl === modelUrl) return sessionLoad.promise;
  const promise = createWebOnnxSession(modelUrl, onStatus, onPhase);
  sessionLoad = { modelUrl, promise };
  try {
    return await promise;
  } finally {
    if (sessionLoad?.promise === promise) sessionLoad = undefined;
  }
};

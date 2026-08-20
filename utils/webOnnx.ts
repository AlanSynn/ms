import ortWasmJsepUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import {
  runWebOnnxInferenceInWorker,
  type WebOnnxInferenceOutput,
} from '../runtime/ai/webOnnxInference';
import { webOnnxModelJobCoordinator } from '../runtime/ai/webOnnxModelJobCoordinator';

export interface WebOnnxResult extends WebOnnxInferenceOutput {}

const publicAssetUrl = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
const bundledAssetUrl = (path: string) => new URL(path, window.location.href).href;

export const modelUrl = () => publicAssetUrl('onnx/pose_model.onnx');
export const ortWasmUrl = () => bundledAssetUrl(ortWasmJsepUrl);

export type WebOnnxCacheStage =
  | 'checking'
  | 'available'
  | 'missing'
  | 'downloading'
  | 'cached'
  | 'error';

export interface WebOnnxCacheStatus {
  stage: WebOnnxCacheStage;
  label: string;
  progress: number;
  bytesLoaded?: number;
  bytesTotal?: number;
  error?: string;
}

const MODEL_CACHE_NAME = 'motionsmith-web-onnx-v1';
const MODEL_LABEL = 'AI pose model';
const MIN_MODEL_BYTES = 1_000_000;
const MODEL_BYTES_HEADER = 'x-motionsmith-model-bytes';
const supportsCacheApi = () => typeof window !== 'undefined' && 'caches' in window;

const cacheStatus = (
  stage: WebOnnxCacheStage,
  progress: number,
  extra: Partial<WebOnnxCacheStatus> = {},
): WebOnnxCacheStatus => ({
  stage,
  label: MODEL_LABEL,
  progress,
  ...extra,
});

const cachedModelResponse = async () => {
  if (!supportsCacheApi()) return undefined;
  const cache = await caches.open(MODEL_CACHE_NAME);
  return cache.match(modelUrl());
};

const deleteCachedModel = async () => {
  if (!supportsCacheApi()) return;
  const cache = await caches.open(MODEL_CACHE_NAME);
  await cache.delete(modelUrl());
};

export const checkWebOnnxCache = async (): Promise<WebOnnxCacheStatus> => {
  try {
    const cached = await cachedModelResponse();
    if (!cached) return cacheStatus('missing', 0);
    const bytes = Number(cached.headers.get(MODEL_BYTES_HEADER))
      || Number(cached.headers.get('content-length'))
      || 0;
    if (bytes <= MIN_MODEL_BYTES) {
      await deleteCachedModel();
      return cacheStatus('missing', 0);
    }
    return cacheStatus('cached', 100, {
      bytesLoaded: bytes,
      bytesTotal: bytes,
    });
  } catch (error) {
    return cacheStatus('error', 0, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Retained for callers that explicitly probe the direct API. Large model bytes
 * are never assembled on the UI thread; Chrome-class runtimes must use the
 * dedicated cache worker below.
 */
export const warmWebOnnxCache = async (
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
): Promise<WebOnnxCacheStatus> => {
  const current = await checkWebOnnxCache();
  if (current.stage === 'cached') {
    onStatus(current);
    return current;
  }
  const unavailable = cacheStatus('error', 0, {
    error: 'Web Worker support is required to download the local AI model.',
  });
  onStatus(unavailable);
  return unavailable;
};

export const warmWebOnnxCacheInWorker = (
  onStatus: (status: WebOnnxCacheStatus) => void = () => {},
): Promise<WebOnnxCacheStatus> => {
  if (typeof Worker === 'undefined') return warmWebOnnxCache(onStatus);

  return webOnnxModelJobCoordinator.runWarm(() => new Promise<WebOnnxCacheStatus>((resolve) => {
    let settled = false;
    const worker = new Worker(
      new URL('../workers/webOnnxCacheWorker.ts', import.meta.url),
      { type: 'module' },
    );
    const settle = (result: WebOnnxCacheStatus) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      onStatus(result);
      resolve(result);
    };
    worker.addEventListener(
      'message',
      (event: MessageEvent<{ type: 'status'; status: WebOnnxCacheStatus }>) => {
        if (event.data?.type !== 'status') return;
        onStatus(event.data.status);
        if (
          event.data.status.stage === 'cached'
          || event.data.status.stage === 'error'
        ) {
          settle(event.data.status);
        }
      },
    );
    worker.addEventListener(
      'error',
      (event) => settle(cacheStatus('error', 0, {
        error: event.message || 'AI model cache worker failed.',
      })),
      { once: true },
    );
    try {
      worker.postMessage({
        type: 'warm',
        url: modelUrl(),
        cacheName: MODEL_CACHE_NAME,
        label: MODEL_LABEL,
        minBytes: MIN_MODEL_BYTES,
        bytesHeader: MODEL_BYTES_HEADER,
      });
    } catch (error) {
      settle(cacheStatus('error', 0, {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }));
};

export const processImageWithWebOnnx = async (
  file: File,
  onProgress: (stage: string, progress: number) => void = () => {},
  options: { generationId?: number; signal?: AbortSignal } = {},
): Promise<WebOnnxResult> => {
  let runtimeStage = 'decode-image';
  try {
    if (webOnnxModelJobCoordinator.hasActiveWarm()) {
      runtimeStage = 'downloading-model';
      onProgress('downloading-model', 1);
    }
    return await webOnnxModelJobCoordinator.runInference(
      () => runWebOnnxInferenceInWorker({
        generationId: options.generationId ?? 0,
        model: {
          url: modelUrl(),
          cacheName: MODEL_CACHE_NAME,
          label: MODEL_LABEL,
          minBytes: MIN_MODEL_BYTES,
          bytesHeader: MODEL_BYTES_HEADER,
        },
        file,
        wasmUrl: ortWasmUrl(),
        signal: options.signal,
        onProgress: (stage, progress) => {
          runtimeStage = stage;
          onProgress(stage, progress);
        },
      }),
      options.signal,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Web ONNX image processing failed during ${runtimeStage} at ${modelUrl()}: ${message}`,
    );
  }
};

import type { BodyPartLayer, Point, StandardSkeleton } from '../types';

export interface WebOnnxResult {
    skeleton: StandardSkeleton;
    parts: BodyPartLayer[];
    textureUrl: string;
    maskUrl: string;
    keypoints: Array<Point & { confidence: number; name: string }>;
    metrics: {
        inputWidth: number;
        inputHeight: number;
        workingWidth: number;
        workingHeight: number;
        provider: 'wasm';
        model: 'fp32';
    };
}

export type WebOnnxCacheStage = 'checking' | 'missing' | 'downloading' | 'cached' | 'error';

export interface WebOnnxCacheStatus {
    stage: WebOnnxCacheStage;
    label: string;
    progress: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    error?: string;
}

export type WebOnnxErrorCode =
    | 'canceled'
    | 'superseded'
    | 'worker-unavailable'
    | 'unsupported-image'
    | 'model-download-stalled'
    | 'model-download-failed'
    | 'model-invalid'
    | 'wasm-unavailable'
    | 'inference-failed'
    | 'image-output-too-large'
    | 'image-processing-failed';

export class WebOnnxError extends Error {
    constructor(public readonly code: WebOnnxErrorCode, message: string) {
        super(message);
        this.name = 'WebOnnxError';
    }
}

type WorkerMessage =
    | { id: number; type: 'progress'; stage: string; progress: number }
    | { id: number; type: 'cache'; status: WebOnnxCacheStatus }
    | { id: number; type: 'result'; result: WebOnnxResult | WebOnnxCacheStatus }
    | { id: number; type: 'error'; code: WebOnnxErrorCode; message: string };

const MODEL_CACHE_NAME = 'motionsmith-web-onnx-v2';
const LEGACY_MODEL_CACHE_NAME = 'motionsmith-web-onnx-v1';
const MODEL_BYTES_HEADER = 'x-motionsmith-model-bytes';
const MODEL_LABEL = 'AI pose model';
const MIN_MODEL_BYTES = 1_000_000;
const cacheStatus = (stage: WebOnnxCacheStage, progress: number, extra: Partial<WebOnnxCacheStatus> = {}): WebOnnxCacheStatus => ({
    stage,
    label: MODEL_LABEL,
    progress,
    ...extra
});

export const modelUrl = () => new URL(`${import.meta.env.BASE_URL}onnx/pose_model.onnx`, window.location.href).href;

export const checkWebOnnxCache = async (): Promise<WebOnnxCacheStatus> => {
    if (typeof window === 'undefined' || !('caches' in window)) return cacheStatus('missing', 0);
    try {
        await caches.delete(LEGACY_MODEL_CACHE_NAME);
        const cache = await caches.open(MODEL_CACHE_NAME);
        const response = await cache.match(modelUrl());
        if (!response) return cacheStatus('missing', 0);
        const bytes = Number(response.headers.get(MODEL_BYTES_HEADER));
        if (bytes > MIN_MODEL_BYTES) return cacheStatus('cached', 100, { bytesLoaded: bytes, bytesTotal: bytes });
        await cache.delete(modelUrl());
        return cacheStatus('missing', 0);
    } catch (error) {
        return cacheStatus('error', 0, { error: error instanceof Error ? error.message : String(error) });
    }
};

let nextJobId = 1;
let activeJob: { cancel: (code: 'canceled' | 'superseded') => void } | undefined;
let reusableWorker: Worker | undefined;

const imageAiWorker = () => reusableWorker ??= new Worker(
    new URL('./webOnnxWorker.ts', import.meta.url),
    { type: 'module', name: 'motionsmith-image-ai' }
);

const retireWorker = (worker: Worker) => {
    if (reusableWorker === worker) reusableWorker = undefined;
    worker.terminate();
};

const runWorker = <T>(
    request: { type: 'warm' } | { type: 'process'; file: File },
    onMessage: (message: WorkerMessage) => void,
    signal?: AbortSignal
) => {
    activeJob?.cancel('superseded');
    return new Promise<T>((resolve, reject) => {
        if (typeof Worker === 'undefined') {
            reject(new WebOnnxError('worker-unavailable', 'This browser cannot run image AI.'));
            return;
        }
        const id = nextJobId++;
        const worker = imageAiWorker();
        let settled = false;
        const finish = (value: T | WebOnnxError, failed = false, retire = failed) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            worker.onmessage = null;
            worker.onerror = null;
            if (retire) retireWorker(worker);
            if (activeJob?.cancel === cancel) activeJob = undefined;
            if (failed) reject(value);
            else resolve(value as T);
        };
        const cancel = (code: 'canceled' | 'superseded') => finish(new WebOnnxError(code, code === 'canceled' ? 'Image import canceled.' : 'A newer image import started.'), true, true);
        const abort = () => cancel('canceled');
        activeJob = { cancel };
        if (signal?.aborted) {
            abort();
            return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
            if (data.id !== id) return;
            if (data.type === 'result') performance.mark('motionsmith-image-worker-result');
            onMessage(data);
            if (data.type === 'result') finish(data.result as T);
            if (data.type === 'error') finish(new WebOnnxError(data.code, data.message), true);
        };
        worker.onerror = () => finish(new WebOnnxError('worker-unavailable', 'Image AI worker failed to start.'), true);
        worker.postMessage({ id, ...request });
    });
};

export const cancelWebOnnxProcessing = () => activeJob?.cancel('canceled');

export const warmWebOnnxCache = async (
    onStatus: (status: WebOnnxCacheStatus) => void = () => {}
): Promise<WebOnnxCacheStatus> => {
    const current = await checkWebOnnxCache();
    onStatus(current);
    if (current.stage === 'cached') return current;
    try {
        return await runWorker<WebOnnxCacheStatus>(
            { type: 'warm' },
            message => {
                if (message.type === 'cache') onStatus(message.status);
            }
        );
    } catch (error) {
        const failed = cacheStatus('error', 0, { error: error instanceof Error ? error.message : String(error) });
        onStatus(failed);
        return failed;
    }
};

export const processImageWithWebOnnx = (
    file: File,
    onProgress: (stage: string, progress: number) => void = () => {},
    options: { signal?: AbortSignal } = {}
) => runWorker<WebOnnxResult>(
    { type: 'process', file },
    message => {
        if (message.type === 'progress') onProgress(message.stage, message.progress);
    },
    options.signal
);

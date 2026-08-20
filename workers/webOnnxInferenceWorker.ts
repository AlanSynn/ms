import type { WebOnnxInferenceOutput, WebOnnxInferenceStage } from '../runtime/ai/webOnnxInference';
import {
  buildWebOnnxSkeleton,
  extractWebOnnxKeypoints,
} from '../runtime/ai/webOnnxImageGeometry';
import {
  finishWebOnnxImage,
  prepareWebOnnxImage,
} from '../runtime/ai/webOnnxImageRaster';
import { createDistinctIntegerProgress } from '../runtime/ai/distinctProgress';

type InferenceWorkerRequest = {
  type: 'run';
  generationId: number;
  model: {
    url: string;
    cacheName: string;
    label: string;
    minBytes: number;
    bytesHeader: string;
  };
  file: Blob;
  wasmUrl: string;
};

type InferenceWorkerMessage =
  | {
      type: 'progress';
      generationId: number;
      stage: WebOnnxInferenceStage;
      progress: number;
    }
  | {
      type: 'result';
      generationId: number;
      result: WebOnnxInferenceOutput;
    }
  | {
      type: 'error';
      generationId: number;
      message: string;
    };

type InferenceWorkerScope = {
  onmessage: ((event: MessageEvent<InferenceWorkerRequest>) => void) | null;
  postMessage: (message: InferenceWorkerMessage, transfer?: Transferable[]) => void;
  close: () => void;
};

const worker = globalThis as unknown as InferenceWorkerScope;

const publishProgress = (
  generationId: number,
  stage: WebOnnxInferenceStage,
  progress: number,
) => worker.postMessage({ type: 'progress', generationId, stage, progress });

const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs';

const assertUsableModel = (
  buffer: ArrayBuffer,
  model: InferenceWorkerRequest['model'],
) => {
  const prefix = new TextDecoder().decode(
    new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)),
  );
  if (prefix.startsWith(GIT_LFS_POINTER_PREFIX)) {
    throw new Error(`${model.label} is a Git LFS pointer, not ONNX model bytes.`);
  }
  if (buffer.byteLength <= model.minBytes) {
    throw new Error(
      `${model.label} is only ${buffer.byteLength} bytes; expected real ONNX model bytes.`,
    );
  }
};

const readCachedModel = async (model: InferenceWorkerRequest['model']) => {
  if (!('caches' in globalThis)) return undefined;
  const cache = await caches.open(model.cacheName);
  const response = await cache.match(model.url);
  if (!response) return undefined;
  const markedBytes = Number(response.headers.get(model.bytesHeader)) || undefined;
  const buffer = await response.arrayBuffer();
  try {
    if (markedBytes && markedBytes !== buffer.byteLength) {
      throw new Error(`${model.label} cache length does not match its manifest.`);
    }
    assertUsableModel(buffer, model);
    return buffer;
  } catch {
    await cache.delete(model.url);
    return undefined;
  }
};

const downloadAndCacheModel = async (
  generationId: number,
  model: InferenceWorkerRequest['model'],
) => {
  const response = await fetch(model.url, { cache: 'reload' });
  if (!response.ok) {
    throw new Error(`Could not download ${model.label}: ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || undefined;
  let loaded = 0;
  const distinctProgress = createDistinctIntegerProgress(5);
  const trackedBody = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        const progress = distinctProgress(
          total ? Math.min(34, 12 + (loaded / total) * 22) : 23,
        );
        if (progress !== undefined) {
          publishProgress(generationId, 'downloading-model', progress);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers(response.headers);
  if (total) headers.set(model.bytesHeader, String(total));
  const trackedResponse = new Response(trackedBody ?? (await response.arrayBuffer()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cacheResponse = 'caches' in globalThis
    ? trackedResponse.clone()
    : undefined;
  const cachePromise = cacheResponse
    ? caches.open(model.cacheName).then((cache) => cache.put(model.url, cacheResponse))
    : Promise.resolve();
  const buffer = await trackedResponse.arrayBuffer();
  await cachePromise.catch(() => undefined);
  if (total && buffer.byteLength !== total) {
    if ('caches' in globalThis) {
      const cache = await caches.open(model.cacheName);
      await cache.delete(model.url);
    }
    throw new Error(
      `${model.label} download disconnected after ${buffer.byteLength}/${total} bytes.`,
    );
  }
  try {
    assertUsableModel(buffer, model);
  } catch (error) {
    if ('caches' in globalThis) {
      const cache = await caches.open(model.cacheName);
      await cache.delete(model.url);
    }
    throw error;
  }
  return buffer;
};

const loadModel = async (
  generationId: number,
  model: InferenceWorkerRequest['model'],
) => {
  const cached = await readCachedModel(model);
  if (cached) return cached;
  publishProgress(generationId, 'downloading-model', 12);
  return downloadAndCacheModel(generationId, model);
};

const releaseWithoutThrowing = async (resource: {
  dispose?: () => void;
  release?: () => void | Promise<void>;
} | null) => {
  if (!resource) return;
  try {
    resource.dispose?.();
    await resource.release?.();
  } catch {
    // The worker is terminated after its response, so cleanup remains bounded.
  }
};

const run = async (request: InferenceWorkerRequest) => {
  let session: Awaited<
    ReturnType<(typeof import('onnxruntime-web'))['InferenceSession']['create']>
  > | null = null;
  let inputTensor: import('onnxruntime-web').Tensor | null = null;
  let outputTensor: import('onnxruntime-web').Tensor | null = null;
  let response: InferenceWorkerMessage;
  try {
    publishProgress(request.generationId, 'decode-image', 2);
    const prepared = await prepareWebOnnxImage(request.file);
    publishProgress(request.generationId, 'segment-character', 10);
    const modelBuffer = await loadModel(request.generationId, request.model);
    publishProgress(request.generationId, 'loading-model', 35);
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: request.wasmUrl };
    session = await ort.InferenceSession.create(
      new Uint8Array(modelBuffer),
      { executionProviders: ['wasm'] },
    );
    inputTensor = new ort.Tensor(
      'float32',
      prepared.poseData,
      prepared.poseDims,
    );
    publishProgress(request.generationId, 'running-onnx', 45);
    const outputs = await session.run({ [session.inputNames[0]]: inputTensor });
    outputTensor = Object.values(outputs)[0] ?? null;
    if (!outputTensor) throw new Error('Pose model returned no output tensor');
    publishProgress(request.generationId, 'extracting-keypoints', 70);
    const keypoints = extractWebOnnxKeypoints(
      outputTensor.data as Float32Array,
      outputTensor.dims.map(Number),
      prepared.poseBounds,
    );
    const skeleton = buildWebOnnxSkeleton(
      keypoints,
      prepared.width,
      prepared.height,
      prepared.mask,
      request.model.url,
    );
    publishProgress(request.generationId, 'extracting-parts', 75);
    const raster = await finishWebOnnxImage(prepared, skeleton);
    publishProgress(request.generationId, 'normalizing', 90);
    response = {
      type: 'result',
      generationId: request.generationId,
      result: { skeleton, keypoints, ...raster },
    };
  } catch (error) {
    response = {
      type: 'error',
      generationId: request.generationId,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await releaseWithoutThrowing(outputTensor);
    await releaseWithoutThrowing(inputTensor);
    await releaseWithoutThrowing(session);
    try {
      worker.postMessage(response!);
    } finally {
      worker.close();
    }
  }
};

worker.onmessage = (event) => {
  const request = event.data;
  if (!request || request.type !== 'run') return;
  void run(request);
};

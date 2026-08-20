import { createDistinctIntegerProgress } from '../runtime/ai/distinctProgress';

type CacheStage = 'checking' | 'downloading' | 'cached' | 'error';

type WarmRequest = {
  type: 'warm';
  url: string;
  cacheName: string;
  label: string;
  minBytes: number;
  bytesHeader: string;
};

type CacheStatus = {
  stage: CacheStage;
  label: string;
  progress: number;
  bytesLoaded?: number;
  bytesTotal?: number;
  error?: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<WarmRequest>) => void) | null;
  postMessage: (message: { type: 'status'; status: CacheStatus }) => void;
};

const worker = globalThis as unknown as WorkerScope;
const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs';

const makeStatus = (
  request: WarmRequest,
  stage: CacheStage,
  progress: number,
  extra: Partial<CacheStatus> = {},
): CacheStatus => ({
  stage,
  label: request.label,
  progress,
  ...extra,
});

const publish = (
  request: WarmRequest,
  stage: CacheStage,
  progress: number,
  extra: Partial<CacheStatus> = {},
) => {
  worker.postMessage({
    type: 'status',
    status: makeStatus(request, stage, progress, extra),
  });
};

const hasCacheApi = () => 'caches' in globalThis;

const looksLikeGitLfsPointer = (buffer: ArrayBuffer | Uint8Array) =>
  new TextDecoder()
    .decode(
      buffer instanceof Uint8Array
        ? buffer.subarray(0, 64)
        : new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)),
    )
    .startsWith(GIT_LFS_POINTER_PREFIX);

const readCachedModel = async (request: WarmRequest) => {
  if (!hasCacheApi()) return undefined;
  const cache = await caches.open(request.cacheName);
  const response = await cache.match(request.url);
  if (!response) return undefined;
  const markedBytes = Number(response.headers.get(request.bytesHeader))
    || Number(response.headers.get('content-length'))
    || 0;
  const reader = response.body?.getReader();
  const firstChunk = reader ? await reader.read() : undefined;
  await reader?.cancel().catch(() => undefined);
  if (
    markedBytes <= request.minBytes
    || !firstChunk?.value
    || looksLikeGitLfsPointer(firstChunk.value)
  ) {
    await cache.delete(request.url);
    return undefined;
  }
  return markedBytes;
};

const downloadAndCacheModel = async (request: WarmRequest) => {
  const response = await fetch(request.url, { cache: 'reload' });
  if (!response.ok) throw new Error(`Could not download ${request.label}: ${response.status}`);

  const total = Number(response.headers.get('content-length')) || undefined;
  if (!total) {
    throw new Error(`${request.label} download did not provide a bounded byte length.`);
  }
  if (!response.body) {
    throw new Error(`${request.label} download did not provide a streaming body.`);
  }
  let loaded = 0;
  const prefix = new Uint8Array(64);
  let prefixLength = 0;
  const distinctProgress = createDistinctIntegerProgress(5);
  const trackedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        if (prefixLength < prefix.length) {
          const take = Math.min(prefix.length - prefixLength, chunk.byteLength);
          prefix.set(chunk.subarray(0, take), prefixLength);
          prefixLength += take;
        }
        const progress = distinctProgress(total ? (loaded / total) * 100 : 50);
        if (progress !== undefined) {
          publish(request, 'downloading', progress, {
            bytesLoaded: loaded,
            bytesTotal: total,
          });
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers(response.headers);
  if (total) headers.set(request.bytesHeader, String(total));
  const trackedResponse = new Response(trackedBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(request.cacheName);
  try {
    await cache.put(request.url, trackedResponse);
  } catch (error) {
    await cache.delete(request.url).catch(() => undefined);
    throw error;
  }
  if (loaded !== total) {
    if (hasCacheApi()) {
      await cache.delete(request.url);
    }
    throw new Error(`${request.label} download disconnected after ${loaded}/${total} bytes.`);
  }
  if (loaded <= request.minBytes || looksLikeGitLfsPointer(prefix.subarray(0, prefixLength))) {
    if (hasCacheApi()) {
      await cache.delete(request.url);
    }
    if (looksLikeGitLfsPointer(prefix.subarray(0, prefixLength))) {
      throw new Error(`${request.label} is a Git LFS pointer, not model bytes.`);
    }
    throw new Error(`${request.label} is only ${loaded} bytes; expected real model bytes.`);
  }
  return loaded;
};

const warm = async (request: WarmRequest) => {
  publish(request, 'checking', 0);
  if (!hasCacheApi()) {
    throw new Error('Cache Storage is unavailable; the AI model was not retained.');
  }
  const cached = await readCachedModel(request);
  if (cached) {
    publish(request, 'cached', 100, {
      bytesLoaded: cached,
      bytesTotal: cached,
    });
    return;
  }

  const bytes = await downloadAndCacheModel(request);
  publish(request, 'cached', 100, {
    bytesLoaded: bytes,
    bytesTotal: bytes,
  });
};

worker.onmessage = (event) => {
  const request = event.data;
  if (!request || request.type !== 'warm') return;
  void warm(request).catch((error) => {
    publish(request, 'error', 0, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

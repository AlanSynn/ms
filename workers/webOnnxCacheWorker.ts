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

const looksLikeGitLfsPointer = (buffer: ArrayBuffer) =>
  new TextDecoder()
    .decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)))
    .startsWith(GIT_LFS_POINTER_PREFIX);

const isUsableModel = (buffer: ArrayBuffer, minBytes: number) =>
  buffer.byteLength > minBytes && !looksLikeGitLfsPointer(buffer);

const readCachedModel = async (request: WarmRequest) => {
  if (!hasCacheApi()) return undefined;
  const cache = await caches.open(request.cacheName);
  const response = await cache.match(request.url);
  if (!response) return undefined;
  const markedBytes = Number(response.headers.get(request.bytesHeader)) || undefined;
  const buffer = await response.arrayBuffer();
  if (
    (markedBytes && markedBytes !== buffer.byteLength) ||
    !isUsableModel(buffer, request.minBytes)
  ) {
    await cache.delete(request.url);
    return undefined;
  }
  return buffer;
};

const downloadModel = async (request: WarmRequest) => {
  const response = await fetch(request.url, { cache: 'reload' });
  if (!response.ok) throw new Error(`Could not download ${request.label}: ${response.status}`);

  const total = Number(response.headers.get('content-length')) || undefined;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (total && buffer.byteLength !== total) {
      throw new Error(`${request.label} download disconnected after ${buffer.byteLength}/${total} bytes.`);
    }
    publish(request, 'downloading', 100, {
      bytesLoaded: buffer.byteLength,
      bytesTotal: total,
    });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    publish(request, 'downloading', total ? Math.round((loaded / total) * 100) : 50, {
      bytesLoaded: loaded,
      bytesTotal: total,
    });
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (total && buffer.byteLength !== total) {
    throw new Error(`${request.label} download disconnected after ${buffer.byteLength}/${total} bytes.`);
  }
  return buffer.buffer;
};

const cacheModel = async (request: WarmRequest, buffer: ArrayBuffer) => {
  if (!isUsableModel(buffer, request.minBytes)) {
    if (looksLikeGitLfsPointer(buffer)) {
      throw new Error(`${request.label} is a Git LFS pointer, not model bytes.`);
    }
    throw new Error(`${request.label} is only ${buffer.byteLength} bytes; expected real model bytes.`);
  }
  if (!hasCacheApi()) return;
  const cache = await caches.open(request.cacheName);
  await cache.put(
    request.url,
    new Response(buffer.slice(0), {
      headers: {
        'content-type': 'application/octet-stream',
        [request.bytesHeader]: String(buffer.byteLength),
      },
    }),
  );
};

const warm = async (request: WarmRequest) => {
  publish(request, 'checking', 0);
  const cached = await readCachedModel(request);
  if (cached) {
    publish(request, 'cached', 100, {
      bytesLoaded: cached.byteLength,
      bytesTotal: cached.byteLength,
    });
    return;
  }

  const buffer = await downloadModel(request);
  await cacheModel(request, buffer);
  publish(request, 'cached', 100, {
    bytesLoaded: buffer.byteLength,
    bytesTotal: buffer.byteLength,
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

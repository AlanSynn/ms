import {
  assertTrackingGifDecodeInput,
  planTrackingGifFromMetadata,
  scanTrackingGifMetadata,
  trackingGifFallbackReplayWindow,
  TRACKING_GIF_MAX_COMPRESSED_BYTES,
  TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES,
  TRACKING_MEDIA_MAX_EDGE_PX,
  DEFAULT_TRACKING_MEDIA_LIMITS,
  type TrackingGifMetadata,
  type TrackingGifPlan,
  type TrackingMediaLimits,
} from '../runtime/media/trackingMediaPolicy';

type GifWorkerRequest =
  | {
      type: 'load';
      generationId: number;
      buffer: ArrayBuffer;
      limits?: TrackingMediaLimits;
    }
  | { type: 'frame'; generationId: number; requestId: number; index: number }
  | { type: 'dispose'; generationId: number };

type GifWorkerResponse =
  | { type: 'ready'; generationId: number; plan: TrackingGifPlan }
  | {
      type: 'frame';
      generationId: number;
      requestId: number;
      index: number;
      bitmap: ImageBitmap;
    }
  | { type: 'error'; generationId: number; message: string };

type GifWorkerScope = {
  onmessage: ((event: MessageEvent<GifWorkerRequest>) => void) | null;
  postMessage: (message: GifWorkerResponse, transfer?: Transferable[]) => void;
  close: () => void;
};

type GifLibrary = typeof import('gifuct-js');
type GifRawFrame = Parameters<GifLibrary['decompressFrame']>[0];
type GifDecodedFrame = ReturnType<GifLibrary['decompressFrame']>;
type PreviousFrameState = Pick<GifDecodedFrame, 'dims' | 'disposalType'>;

const worker = globalThis as unknown as GifWorkerScope;
let generationId = -1;
let plan: TrackingGifPlan | null = null;
let nativeDecoder: ImageDecoder | null = null;
let fallbackLibrary: GifLibrary | null = null;
let fallbackFrames: GifRawFrame[] = [];
let fallbackGlobalColorTable: [number, number, number][] = [];
let sourceCanvas: OffscreenCanvas | null = null;
let sourceContext: OffscreenCanvasRenderingContext2D | null = null;
let patchCanvas: OffscreenCanvas | null = null;
let patchContext: OffscreenCanvasRenderingContext2D | null = null;
let outputCanvas: OffscreenCanvas | null = null;
let outputContext: OffscreenCanvasRenderingContext2D | null = null;
let currentRawFrame = -1;
let previousFrame: PreviousFrameState | undefined;
let restoreImage: ImageData | undefined;
let activeLimits = DEFAULT_TRACKING_MEDIA_LIMITS;

const resetComposite = () => {
  currentRawFrame = -1;
  previousFrame = undefined;
  restoreImage = undefined;
  sourceContext?.clearRect(
    0,
    0,
    sourceCanvas?.width ?? 0,
    sourceCanvas?.height ?? 0,
  );
};

const release = () => {
  nativeDecoder?.close();
  nativeDecoder = null;
  fallbackLibrary = null;
  fallbackFrames = [];
  fallbackGlobalColorTable = [];
  plan = null;
  resetComposite();
  sourceCanvas = null;
  sourceContext = null;
  patchCanvas = null;
  patchContext = null;
  outputCanvas = null;
  outputContext = null;
};

const outputBitmap = () => {
  if (!outputCanvas) throw new Error('GIF output canvas is unavailable');
  return outputCanvas.transferToImageBitmap();
};

const applyPreviousDisposal = () => {
  if (!sourceContext || !previousFrame) return;
  if (previousFrame.disposalType === 2) {
    sourceContext.clearRect(
      previousFrame.dims.left,
      previousFrame.dims.top,
      previousFrame.dims.width,
      previousFrame.dims.height,
    );
  } else if (previousFrame.disposalType === 3 && restoreImage) {
    sourceContext.putImageData(restoreImage, 0, 0);
  }
};

const compositeFallbackThrough = (targetRawFrame: number) => {
  if (!fallbackLibrary || !sourceCanvas || !sourceContext) {
    throw new Error('GIF fallback decoder is not ready');
  }
  const replay = trackingGifFallbackReplayWindow(
    currentRawFrame,
    targetRawFrame,
    fallbackFrames.length,
  );
  if (replay.reset) resetComposite();
  for (let index = replay.start; index <= replay.end; index += 1) {
    applyPreviousDisposal();
    const frame = fallbackLibrary.decompressFrame(
      fallbackFrames[index],
      fallbackGlobalColorTable,
      true,
    );
    if (frame.disposalType === 3) {
      restoreImage = sourceContext.getImageData(
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );
    } else {
      restoreImage = undefined;
    }
    patchCanvas ??= new OffscreenCanvas(frame.dims.width, frame.dims.height);
    if (
      patchCanvas.width !== frame.dims.width ||
      patchCanvas.height !== frame.dims.height
    ) {
      patchCanvas.width = frame.dims.width;
      patchCanvas.height = frame.dims.height;
      patchContext = null;
    }
    patchContext ??= patchCanvas.getContext('2d');
    if (!patchContext) throw new Error('GIF patch canvas unavailable');
    patchContext.clearRect(0, 0, frame.dims.width, frame.dims.height);
    const patchPixels = new Uint8ClampedArray(frame.patch.length);
    patchPixels.set(frame.patch);
    patchContext.putImageData(
      new ImageData(patchPixels, frame.dims.width, frame.dims.height),
      0,
      0,
    );
    sourceContext.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    previousFrame = {
      dims: frame.dims,
      disposalType: frame.disposalType,
    };
    currentRawFrame = index;
  }
};

const renderNativeFrame = async (rawFrameIndex: number) => {
  if (!nativeDecoder || !plan || !outputContext) {
    throw new Error('GIF native decoder is not ready');
  }
  const result = await nativeDecoder.decode({
    frameIndex: rawFrameIndex,
    completeFramesOnly: true,
  });
  try {
    outputContext.clearRect(0, 0, plan.width, plan.height);
    outputContext.drawImage(result.image, 0, 0, plan.width, plan.height);
    return outputBitmap();
  } finally {
    result.image.close();
  }
};

const renderFallbackFrame = (rawFrameIndex: number) => {
  if (!plan || !sourceCanvas || !outputContext) {
    throw new Error('GIF fallback decoder is not ready');
  }
  compositeFallbackThrough(rawFrameIndex);
  outputContext.clearRect(0, 0, plan.width, plan.height);
  outputContext.drawImage(sourceCanvas, 0, 0, plan.width, plan.height);
  return outputBitmap();
};

const renderFrame = async (index: number) => {
  if (!plan) throw new Error('GIF decoder is not ready');
  const safeIndex = Math.max(
    0,
    Math.min(plan.sampledFrames - 1, Math.round(index)),
  );
  const rawFrameIndex = plan.rawFrameIndices[safeIndex];
  const bitmap = nativeDecoder
    ? await renderNativeFrame(rawFrameIndex)
    : renderFallbackFrame(rawFrameIndex);
  return { safeIndex, bitmap };
};

const initializeOutput = (nextPlan: TrackingGifPlan) => {
  outputCanvas = new OffscreenCanvas(nextPlan.width, nextPlan.height);
  outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('GIF output canvas unavailable');
};

const tryInitializeNativeDecoder = async (
  buffer: ArrayBuffer,
  metadata: TrackingGifMetadata,
) => {
  if (typeof ImageDecoder === 'undefined') return false;
  if (!(await ImageDecoder.isTypeSupported('image/gif'))) return false;
  const initialPlan = planTrackingGifFromMetadata(metadata, activeLimits);
  const decoder = new ImageDecoder({
    data: buffer,
    type: 'image/gif',
    preferAnimation: true,
    desiredWidth: initialPlan.width,
    desiredHeight: initialPlan.height,
  });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount < 1) {
      throw new Error('GIF has no decodable image track.');
    }
    const rawFrames = Math.floor(track.frameCount);
    plan = planTrackingGifFromMetadata({
      ...metadata,
      rawFrames,
      durationMs:
        metadata.durationMs * (rawFrames / Math.max(1, metadata.rawFrames)),
    }, activeLimits);
    nativeDecoder = decoder;
    initializeOutput(plan);
    return true;
  } catch (error) {
    decoder.close();
    throw error;
  }
};

const initializeBoundedFallback = async (
  buffer: ArrayBuffer,
  metadata: TrackingGifMetadata,
) => {
  const fallbackFrameLimit = Math.min(
    TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES,
    activeLimits.maxFrames,
  );
  if (metadata.rawFrames > fallbackFrameLimit) {
    throw new Error(
      `This browser cannot safely decode GIFs above ${fallbackFrameLimit} frames.`,
    );
  }
  const fallbackEdgeLimit = Math.min(
    TRACKING_MEDIA_MAX_EDGE_PX,
    activeLimits.maxEdgePx,
  );
  if (Math.max(metadata.width, metadata.height) > fallbackEdgeLimit) {
    throw new Error(
      `This browser cannot safely scale GIFs above ${fallbackEdgeLimit}px.`,
    );
  }
  const library = await import('gifuct-js');
  const parsed = library.parseGIF(buffer);
  const frames = parsed.frames.filter(
    (frame): frame is GifRawFrame => 'image' in frame,
  );
  if (!frames.length) throw new Error('No frames found in GIF');
  if (frames.length > fallbackFrameLimit) {
    throw new Error('GIF fallback frame budget was exceeded.');
  }
  const unsafeFrame = frames.find((frame) => {
    const descriptor = frame.image.descriptor;
    return (
      descriptor.width < 1 ||
      descriptor.height < 1 ||
      descriptor.width > fallbackEdgeLimit ||
      descriptor.height > fallbackEdgeLimit ||
      descriptor.left + descriptor.width > metadata.width ||
      descriptor.top + descriptor.height > metadata.height
    );
  });
  if (unsafeFrame) {
    throw new Error('GIF frame dimensions exceed the bounded compositor.');
  }
  fallbackLibrary = library;
  fallbackFrames = frames;
  fallbackGlobalColorTable = parsed.gct;
  plan = planTrackingGifFromMetadata({
    ...metadata,
    rawFrames: frames.length,
  }, activeLimits);
  sourceCanvas = new OffscreenCanvas(plan.width, plan.height);
  sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('GIF compositor canvas unavailable');
  initializeOutput(plan);
};

const load = async (request: Extract<GifWorkerRequest, { type: 'load' }>) => {
  release();
  generationId = request.generationId;
  activeLimits = request.limits ?? DEFAULT_TRACKING_MEDIA_LIMITS;
  if (request.buffer.byteLength > TRACKING_GIF_MAX_COMPRESSED_BYTES) {
    throw new Error('GIF files must be 32MB or smaller.');
  }
  const metadata = scanTrackingGifMetadata(new Uint8Array(request.buffer));
  assertTrackingGifDecodeInput(metadata);
  const nativeReady = await tryInitializeNativeDecoder(request.buffer, metadata);
  if (!nativeReady) await initializeBoundedFallback(request.buffer, metadata);
  if (!plan) throw new Error('GIF decoder did not produce a playback plan');
  worker.postMessage({ type: 'ready', generationId, plan });
};

const reportError = (requestGenerationId: number, error: unknown) => {
  worker.postMessage({
    type: 'error',
    generationId: requestGenerationId,
    message: error instanceof Error ? error.message : String(error),
  });
};

worker.onmessage = (event) => {
  const request = event.data;
  if (!request) return;
  if (request.type === 'dispose') {
    if (request.generationId === generationId) {
      release();
      worker.close();
    }
    return;
  }
  if (request.type === 'load') {
    void load(request).catch((error) => reportError(request.generationId, error));
    return;
  }
  if (request.generationId !== generationId) return;
  void renderFrame(request.index)
    .then(({ safeIndex, bitmap }) => {
      if (request.generationId !== generationId) {
        bitmap.close();
        return;
      }
      worker.postMessage(
        {
          type: 'frame',
          generationId,
          requestId: request.requestId,
          index: safeIndex,
          bitmap,
        },
        [bitmap],
      );
    })
    .catch((error) => reportError(request.generationId, error));
};

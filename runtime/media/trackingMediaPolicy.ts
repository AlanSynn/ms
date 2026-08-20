export const TRACKING_MEDIA_MAX_EDGE_PX = 1280;
export const TRACKING_MEDIA_MAX_FPS = 30;
export const TRACKING_MEDIA_MAX_SAMPLED_FRAMES = 600;
export const TRACKING_GIF_MAX_IN_FLIGHT_FRAMES = 1;
export const TRACKING_GIF_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES =
  TRACKING_MEDIA_MAX_SAMPLED_FRAMES;

export type TrackingMediaLimits = {
  maxEdgePx: number;
  maxFrames: number;
  maxFramesPerSecond: number;
};

export const DEFAULT_TRACKING_MEDIA_LIMITS: TrackingMediaLimits = Object.freeze({
  maxEdgePx: TRACKING_MEDIA_MAX_EDGE_PX,
  maxFrames: TRACKING_MEDIA_MAX_SAMPLED_FRAMES,
  maxFramesPerSecond: TRACKING_MEDIA_MAX_FPS,
});

export type TrackingGifPlan = {
  width: number;
  height: number;
  fps: number;
  sampledFrames: number;
  rawFrames: number;
  rawFrameIndices: number[];
};

export type TrackingGifMetadata = {
  width: number;
  height: number;
  rawFrames: number;
  durationMs: number;
};

export type TrackingGifReplayWindow = {
  reset: boolean;
  start: number;
  end: number;
  decodeFrames: number;
};

export const assertTrackingGifDecodeInput = (
  metadata: TrackingGifMetadata,
) => {
  if (metadata.rawFrames > TRACKING_MEDIA_MAX_SAMPLED_FRAMES) {
    throw new Error(
      `GIFs must contain ${TRACKING_MEDIA_MAX_SAMPLED_FRAMES} frames or fewer.`,
    );
  }
};

export const fitTrackingMediaDimensions = (
  width: number,
  height: number,
  maxEdge = TRACKING_MEDIA_MAX_EDGE_PX,
) => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
};

export const planTrackingGifFromMetadata = ({
  width,
  height,
  rawFrames: inputRawFrames,
  durationMs: inputDurationMs,
}: TrackingGifMetadata, limits: TrackingMediaLimits = DEFAULT_TRACKING_MEDIA_LIMITS): TrackingGifPlan => {
  const rawFrames = Math.max(1, Math.floor(inputRawFrames));
  const durationMs = Math.max(1, inputDurationMs);
  const sourceFps = (rawFrames * 1000) / durationMs;
  const fps = Math.max(1, Math.min(limits.maxFramesPerSecond, sourceFps));
  const sampledFrames = Math.max(
    1,
    Math.min(
      rawFrames,
      limits.maxFrames,
      Math.ceil((durationMs / 1000) * fps),
    ),
  );
  const rawFrameIndices = Array.from({ length: sampledFrames }, (_, index) =>
    sampledFrames === 1
      ? 0
      : Math.round((index * (rawFrames - 1)) / (sampledFrames - 1)),
  );
  return {
    ...fitTrackingMediaDimensions(width, height, limits.maxEdgePx),
    fps,
    sampledFrames,
    rawFrames,
    rawFrameIndices,
  };
};

export const planTrackingGif = ({
  width,
  height,
  frameDelaysMs,
}: {
  width: number;
  height: number;
  frameDelaysMs: number[];
}, limits: TrackingMediaLimits = DEFAULT_TRACKING_MEDIA_LIMITS): TrackingGifPlan =>
  planTrackingGifFromMetadata({
    width,
    height,
    rawFrames: frameDelaysMs.length,
    durationMs: frameDelaysMs.reduce(
      (total, delay) =>
        total + Math.max(10, Number.isFinite(delay) ? delay : 100),
      0,
    ),
  }, limits);

export const trackingGifFallbackReplayWindow = (
  currentRawFrame: number,
  targetRawFrame: number,
  rawFrames: number,
): TrackingGifReplayWindow => {
  const boundedRawFrames = Math.max(1, Math.floor(rawFrames));
  if (boundedRawFrames > TRACKING_GIF_FALLBACK_MAX_RAW_FRAMES) {
    throw new Error('GIF fallback replay exceeds its raw-frame budget.');
  }
  const end = Math.max(
    0,
    Math.min(boundedRawFrames - 1, Math.round(targetRawFrame)),
  );
  const reset = end < currentRawFrame;
  const start = reset ? 0 : Math.max(0, currentRawFrame + 1);
  return {
    reset,
    start,
    end,
    decodeFrames: Math.max(0, end - start + 1),
  };
};

const readUint16LittleEndian = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8);

const skipGifSubBlocks = (bytes: Uint8Array, start: number) => {
  let offset = start;
  while (offset < bytes.length) {
    const blockSize = bytes[offset];
    offset += 1;
    if (blockSize === 0) return offset;
    if (offset + blockSize > bytes.length) {
      throw new Error('GIF data ended inside a sub-block.');
    }
    offset += blockSize;
  }
  throw new Error('GIF data ended before a sub-block terminator.');
};

/**
 * Reads only the GIF block structure. Unlike a full GIF parser this does not
 * retain compressed frame blocks, color tables, or one object per raw frame.
 */
export const scanTrackingGifMetadata = (
  bytes: Uint8Array,
): TrackingGifMetadata => {
  if (bytes.length < 13) throw new Error('GIF header is incomplete.');
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new Error('Invalid GIF signature.');
  }
  const width = readUint16LittleEndian(bytes, 6);
  const height = readUint16LittleEndian(bytes, 8);
  if (width < 1 || height < 1) throw new Error('GIF dimensions are invalid.');

  const globalTableFlags = bytes[10];
  const globalTableBytes =
    globalTableFlags & 0x80
      ? 3 * 2 ** ((globalTableFlags & 0x07) + 1)
      : 0;
  let offset = 13 + globalTableBytes;
  if (offset > bytes.length) throw new Error('GIF global color table is incomplete.');

  let rawFrames = 0;
  let durationMs = 0;
  let pendingDelayMs = 100;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      if (offset >= bytes.length) throw new Error('GIF extension is incomplete.');
      const label = bytes[offset];
      offset += 1;
      if (label === 0xf9) {
        if (offset >= bytes.length) {
          throw new Error('GIF graphics control extension is incomplete.');
        }
        const blockSize = bytes[offset];
        offset += 1;
        if (blockSize < 4 || offset + blockSize > bytes.length) {
          throw new Error('GIF graphics control extension is invalid.');
        }
        const delayHundredths = readUint16LittleEndian(bytes, offset + 1);
        pendingDelayMs = Math.max(10, (delayHundredths || 10) * 10);
        offset += blockSize;
        if (bytes[offset] !== 0) {
          throw new Error('GIF graphics control extension has no terminator.');
        }
        offset += 1;
      } else {
        offset = skipGifSubBlocks(bytes, offset);
      }
      continue;
    }

    if (marker !== 0x2c) throw new Error('GIF contains an unknown block.');
    if (offset + 9 > bytes.length) throw new Error('GIF image descriptor is incomplete.');
    const imageFlags = bytes[offset + 8];
    offset += 9;
    if (imageFlags & 0x80) {
      offset += 3 * 2 ** ((imageFlags & 0x07) + 1);
    }
    if (offset >= bytes.length) throw new Error('GIF image data is incomplete.');
    offset += 1; // LZW minimum code size
    offset = skipGifSubBlocks(bytes, offset);
    rawFrames += 1;
    durationMs += pendingDelayMs;
    pendingDelayMs = 100;
  }

  if (rawFrames < 1) throw new Error('No frames found in GIF.');
  return { width, height, rawFrames, durationMs };
};

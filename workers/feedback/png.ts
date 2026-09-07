import { FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_IMAGE_DIMENSION, FEEDBACK_MAX_IMAGE_PIXELS } from '../../shared/feedbackProtocol';

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function checksum(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function requirePng(condition: unknown): asserts condition {
  if (!condition) throw new Error('Use a fresh app screenshot.');
}

/** Validates the non-interlaced 8-bit RGB/RGBA PNGs produced by canvas.toBlob. */
export async function validateScreenshotPng(bytes: Uint8Array): Promise<void> {
  requirePng(bytes.length >= 57 && bytes.length <= FEEDBACK_MAX_IMAGE_BYTES);
  requirePng(signature.every((byte, index) => bytes[index] === byte));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let finished = false;
  let imageStarted = false;
  let imageEnded = false;
  let count = 0;
  const compressed: Uint8Array[] = [];
  // Capture does not need textual metadata, animation, palettes, or EXIF.
  const ancillaryLengths: Record<string, number> = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9, cICP: 4 };
  const seen = new Set<string>();
  while (offset < bytes.length) {
    requirePng(!finished && offset + 12 <= bytes.length && ++count <= 512);
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    requirePng(end <= bytes.length);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    requirePng(checksum(bytes.subarray(offset + 4, end - 4)) === view.getUint32(end - 4));
    if (count === 1) {
      requirePng(type === 'IHDR' && length === 13);
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      requirePng(width > 0 && height > 0 && width <= FEEDBACK_MAX_IMAGE_DIMENSION && height <= FEEDBACK_MAX_IMAGE_DIMENSION);
      requirePng(width * height <= FEEDBACK_MAX_IMAGE_PIXELS);
      requirePng(depth === 8 && (color === 2 || color === 6));
      requirePng(bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] === 0);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      requirePng(!imageEnded);
      imageStarted = true;
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (type === 'IEND') {
      requirePng(imageStarted && length === 0 && end === bytes.length);
      finished = true;
    } else {
      requirePng(Object.hasOwn(ancillaryLengths, type) && length === ancillaryLengths[type] && !seen.has(type));
      if (type !== 'pHYs') requirePng(!imageStarted);
      seen.add(type);
      if (imageStarted) imageEnded = true;
    }
    offset = end;
  }
  requirePng(finished && compressed.some(chunk => chunk.length));
  const stride = width * channels + 1;
  const expected = height * stride;
  const stream = new Blob(compressed.map(chunk => new Uint8Array(chunk))).stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  let decoded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      requirePng(decoded + value.length <= expected);
      const firstFilter = (stride - decoded % stride) % stride;
      for (let index = firstFilter; index < value.length; index += stride) requirePng(value[index] <= 4);
      decoded += value.length;
    }
    requirePng(decoded === expected);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

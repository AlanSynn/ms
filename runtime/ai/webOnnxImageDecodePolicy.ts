export const WEB_ONNX_IMAGE_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
export const WEB_ONNX_IMAGE_HEADER_SCAN_BYTES = 1024 * 1024;

export type WebOnnxEncodedImageMetadata = {
  type: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
};

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const validDimensions = (
  type: WebOnnxEncodedImageMetadata['type'],
  width: number,
  height: number,
): WebOnnxEncodedImageMetadata => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Image dimensions are invalid.');
  }
  return { type, width, height };
};

const pngMetadata = (bytes: Uint8Array) => {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || ascii(bytes, 1, 3) !== 'PNG'
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || ascii(bytes, 12, 4) !== 'IHDR'
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return validDimensions('image/png', view.getUint32(16), view.getUint32(20));
};

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

const jpegMetadata = (bytes: Uint8Array) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error('JPEG size header is invalid.');
      return validDimensions(
        'image/jpeg',
        view.getUint16(offset + 5),
        view.getUint16(offset + 3),
      );
    }
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions were not found inside the 1MB header budget.');
};

const uint24LittleEndian = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

const webpMetadata = (bytes: Uint8Array) => {
  if (
    bytes.length < 20
    || ascii(bytes, 0, 4) !== 'RIFF'
    || ascii(bytes, 8, 4) !== 'WEBP'
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + chunkSize > bytes.length) break;
    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return validDimensions(
        'image/webp',
        uint24LittleEndian(bytes, payload + 4) + 1,
        uint24LittleEndian(bytes, payload + 7) + 1,
      );
    }
    if (
      chunkType === 'VP8 '
      && chunkSize >= 10
      && bytes[payload + 3] === 0x9d
      && bytes[payload + 4] === 0x01
      && bytes[payload + 5] === 0x2a
    ) {
      return validDimensions(
        'image/webp',
        view.getUint16(payload + 6, true) & 0x3fff,
        view.getUint16(payload + 8, true) & 0x3fff,
      );
    }
    if (chunkType === 'VP8L' && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const width = 1 + bytes[payload + 1] + ((bytes[payload + 2] & 0x3f) << 8);
      const height = 1
        + (bytes[payload + 2] >> 6)
        + (bytes[payload + 3] << 2)
        + ((bytes[payload + 4] & 0x0f) << 10);
      return validDimensions('image/webp', width, height);
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  throw new Error('WebP dimensions were not found inside the 1MB header budget.');
};

export const readWebOnnxImageMetadata = (
  bytes: Uint8Array,
): WebOnnxEncodedImageMetadata => {
  const metadata = pngMetadata(bytes) ?? jpegMetadata(bytes) ?? webpMetadata(bytes);
  if (!metadata) throw new Error('Use a valid PNG, JPEG, or WebP image.');
  return metadata;
};

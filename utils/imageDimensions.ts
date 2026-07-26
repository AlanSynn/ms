const readPngSize = (bytes: Uint8Array) => bytes.length >= 24
  && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ? {
      width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16),
      height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
    }
  : undefined;

const readJpegSize = (bytes: Uint8Array) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (length < 2) break;
    offset += length + 2;
  }
  return undefined;
};

const readWebpSize = (bytes: Uint8Array) => {
  const text = new TextDecoder();
  if (bytes.length < 30 || text.decode(bytes.subarray(0, 4)) !== "RIFF" || text.decode(bytes.subarray(8, 12)) !== "WEBP") return undefined;
  const chunk = text.decode(bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  return undefined;
};

export const encodedImageSize = async (file: File) => {
  const header = new Uint8Array(await file.slice(0, 128 * 1_024).arrayBuffer());
  return readPngSize(header) ?? readJpegSize(header) ?? readWebpSize(header);
};

export const boundedImageSize = (
  width: number,
  height: number,
  maxEdge: number,
  maxPixels: number,
) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

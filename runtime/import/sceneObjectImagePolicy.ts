const MEBIBYTE = 1024 * 1024;

export const SCENE_OBJECT_IMAGE_LIMITS = Object.freeze({
  compressedBytes: 12 * MEBIBYTE,
  svgBytes: 512 * 1024,
  maxSourcePixels: 4_000_000,
  maxSourceEdge: 2_048,
  textureEdge: 512,
  contourEdge: 160,
});

export type ImageDimensions = { width: number; height: number };

const supportedType = /^(?:image\/(?:png|jpeg|webp|svg\+xml))$/i;
const extensionType: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export const sceneObjectImageMimeType = (file: Pick<File, "name" | "type">) => {
  if (supportedType.test(file.type)) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return extensionType[extension];
};

export const validateSceneObjectImageFile = (
  file: Pick<File, "name" | "size" | "type">,
) => {
  const mimeType = sceneObjectImageMimeType(file);
  if (!mimeType) throw new Error("Use a PNG, JPEG, WebP, or SVG object image.");
  if (file.size > SCENE_OBJECT_IMAGE_LIMITS.compressedBytes) {
    throw new Error("Object image is larger than the 12 MB classroom limit.");
  }
  if (
    mimeType === "image/svg+xml" &&
    file.size > SCENE_OBJECT_IMAGE_LIMITS.svgBytes
  ) {
    throw new Error("Object SVG is larger than the 512 KB classroom limit.");
  }
  return mimeType;
};

export const validateSceneObjectImageDimensions = (
  dimensions: ImageDimensions,
) => {
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Object image dimensions could not be read.");
  }
  if (
    width > SCENE_OBJECT_IMAGE_LIMITS.maxSourceEdge ||
    height > SCENE_OBJECT_IMAGE_LIMITS.maxSourceEdge ||
    width * height > SCENE_OBJECT_IMAGE_LIMITS.maxSourcePixels
  ) {
    throw new Error("Object image exceeds the 2048 px or 4 megapixel classroom limit.");
  }
  return { width: Math.floor(width), height: Math.floor(height) };
};

export const fitSceneObjectImageDimensions = (
  dimensions: ImageDimensions,
  maxEdge: number,
) => {
  const scale = Math.min(1, maxEdge / Math.max(dimensions.width, dimensions.height));
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
};

const isLocalSvgFragment = (value: string) =>
  /^#[a-z0-9_.:-]+$/i.test(value.trim());

const hasNonLocalSvgReference = (svgText: string) => {
  const referencePatterns = [
    /(?:^|[\s<])(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
  ];
  for (const pattern of referencePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(svgText)) !== null) {
      const reference = match[1] ?? match[2] ?? match[3] ?? "";
      if (!isLocalSvgFragment(reference)) return true;
    }
  }
  return false;
};

export const assertLocalSceneObjectSvg = (svgText: string) => {
  const normalized = svgText.toLowerCase();
  const unsafePattern =
    /<script\b|<foreignobject\b|<(?:image|feimage)\b|javascript:|data:(?:text\/html|image\/)|href\s*=\s*["']?\s*(https?:|\/\/)|xlink:href\s*=\s*["']?\s*(https?:|\/\/)|url\(\s*["']?\s*(https?:|\/\/)|@import/i;
  if (
    !/<svg(?:\s|>)/i.test(svgText) ||
    unsafePattern.test(normalized) ||
    hasNonLocalSvgReference(svgText)
  ) {
    throw new Error("Object SVG must be local artwork only.");
  }
};

export const sceneObjectSvgDimensions = (svgText: string): ImageDimensions => {
  const fail = (): never => { throw new Error("Use an SVG with fixed width and height or a viewBox."); };
  const source = svgText.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  // Read only the outer SVG, including quoted > characters. DTD entities are
  // unsupported because they can redefine dimensions outside this budget check.
  const root = source.match(/^\s*(?:<!DOCTYPE[^<>\[\]]*>\s*)?<svg\b((?:"[^"]*"|'[^']*'|[^'">])*)>/i);
  if (!root) return fail();
  const attributes = new Map<string, string>();
  for (const match of root[1].matchAll(/(?:^|\s)([^\s=<>/'"]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) return fail();
    if (['width', 'height', 'viewbox'].includes(name) && match[1] !== (name === 'viewbox' ? 'viewBox' : name)) return fail();
    attributes.set(name, match[2] ?? match[3] ?? match[4]);
  }
  // CSS can override presentation dimensions. Keep the image source untouched
  // and reject contextual/escaped CSS sizing instead of guessing its allocation.
  const styles = [attributes.get('style') ?? '', ...Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi), match => match[1])];
  if (styles.some(style => /[\\&]|(?:^|[;{])\s*(?:(?:min|max)-)?(?:width|height|inline-size|block-size|aspect-ratio)\s*:/i.test(style.replace(/\/\*[\s\S]*?\*\//g, '')))
    || /\battributeName\s*=\s*["']\s*(?:width|height|viewBox|style)\s*["']/i.test(source)) return fail();
  // CSS absolute units: https://www.w3.org/TR/css-values-4/#absolute-lengths
  const units: Record<string, number> = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
  const dimension = (name: string) => {
    const value = attributes.get(name);
    if (value === undefined) return undefined;
    const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?$/i);
    if (!match) return fail();
    const pixels = Number(match[1]) * units[(match[2] ?? '').toLowerCase()];
    if (!Number.isFinite(pixels) || pixels <= 0) return fail();
    return pixels;
  };
  const width = dimension('width'), height = dimension('height');
  const rawViewBox = attributes.get('viewbox');
  const viewBoxValues = rawViewBox?.trim().split(/[\s,]+/);
  if (viewBoxValues?.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return fail();
  const viewBox = viewBoxValues?.map(value => Number(value));
  if (viewBox && (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0)) return fail();
  if (width !== undefined && height !== undefined) return { width, height };
  if (viewBox) return {
    width: width ?? (height !== undefined ? height * viewBox[2] / viewBox[3] : viewBox[2]),
    height: height ?? (width !== undefined ? width * viewBox[3] / viewBox[2] : viewBox[3]),
  };
  return { width: width ?? 512, height: height ?? 512 };
};

const jpegSofMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const rasterImageDimensions = (
  bytes: Uint8Array,
  mimeType: string,
): ImageDimensions | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png" && bytes.length >= 24) {
    const png = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.every((value, index) => bytes[index] === value)) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
  }
  if (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (jpegSofMarkers.has(marker)) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (
    mimeType === "image/webp" &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height:
          1 +
          ((bytes[22] & 0xc0) >> 6) +
          (bytes[23] << 2) +
          ((bytes[24] & 0x0f) << 10),
      };
    }
  }
  return undefined;
};

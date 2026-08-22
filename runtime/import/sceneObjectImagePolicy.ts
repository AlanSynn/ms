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

export const boundedSceneObjectSvgDataUrl = (
  svgText: string,
  dimensions: ImageDimensions,
) => {
  const bounded = svgText.replace(/<svg\b([^>]*)>/i, (_match, attributes: string) => {
    const retained = attributes
      .replace(/\swidth\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i, "")
      .replace(/\sheight\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i, "");
    return `<svg${retained} width="${dimensions.width}" height="${dimensions.height}">`;
  });
  const bytes = new TextEncoder().encode(bounded);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
};

export const sceneObjectSvgDimensions = (svgText: string): ImageDimensions => {
  const numberAttribute = (name: string) => {
    const match = svgText.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)`, "i"));
    return match ? Number(match[1]) : undefined;
  };
  const width = numberAttribute("width");
  const height = numberAttribute("height");
  if (width && height) return { width, height };
  const viewBox = svgText.match(
    /\bviewBox\s*=\s*["']\s*[-+0-9.e]+[ ,]+[-+0-9.e]+[ ,]+([-+0-9.e]+)[ ,]+([-+0-9.e]+)/i,
  );
  return {
    width: viewBox ? Number(viewBox[1]) : 512,
    height: viewBox ? Number(viewBox[2]) : 512,
  };
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

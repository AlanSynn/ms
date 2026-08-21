import {
  assertLocalSceneObjectSvg,
  rasterImageDimensions,
  sceneObjectImageMimeType,
  sceneObjectSvgDimensions,
  type ImageDimensions,
} from "./sceneObjectImagePolicy";

const KIBIBYTE = 1024;

/**
 * Project artwork is uploaded directly to Three textures, unlike the 512 px
 * scene-object import output. Keep both one source and the combined unique
 * source set inside a Chromebook-sized GPU upload envelope.
 */
export const PROJECT_RASTER_IMPORT_LIMITS = Object.freeze({
  headerBytes: 512 * KIBIBYTE,
  svgBytes: 512 * KIBIBYTE,
  maxSourceEdge: 2_048,
  maxSourcePixels: 4_000_000,
  maxAggregateSourcePixels: 8_000_000,
});

export type ProjectRasterImportSummary = {
  uniqueSourceCount: number;
  totalSourcePixels: number;
};

type ProjectRasterReference = {
  label: string;
  url: string;
};

type RasterBudgetState = {
  totalSourcePixels: number;
  uniqueSourceCount: number;
};

type ParsedDataUrl = {
  mimeType: string;
  base64: boolean;
  payload: string;
};

const SUPPORTED_RASTER_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const parseDataUrl = (url: string, label: string): ParsedDataUrl => {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 6) {
    throw new Error(`${label} is not a readable embedded image.`);
  }
  const metadata = url.slice(5, comma).split(";");
  const mimeType = metadata.shift()?.trim().toLowerCase() ?? "";
  return {
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
    base64: metadata.some((entry) => entry.trim().toLowerCase() === "base64"),
    payload: url.slice(comma + 1),
  };
};

const compactBase64 = (payload: string) => payload.replace(/\s/g, "");

const decodeBase64Prefix = (
  payload: string,
  maximumBytes: number,
  label: string,
) => {
  const compact = compactBase64(payload);
  const requestedCharacters = Math.min(
    compact.length,
    Math.ceil(maximumBytes / 3) * 4,
  );
  const completeCharacters = requestedCharacters - (requestedCharacters % 4);
  const prefix = compact.slice(0, completeCharacters);
  try {
    const binary = atob(prefix);
    const bytes = new Uint8Array(Math.min(binary.length, maximumBytes));
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error(`${label} is not a readable embedded image.`);
  }
};

const decodePercentEncodedPrefix = (
  payload: string,
  maximumBytes: number,
  label: string,
) => {
  const bytes: number[] = [];
  for (let index = 0; index < payload.length && bytes.length < maximumBytes;) {
    if (payload[index] === "%") {
      const value = Number.parseInt(payload.slice(index + 1, index + 3), 16);
      if (!Number.isFinite(value) || index + 2 >= payload.length) {
        throw new Error(`${label} is not a readable embedded image.`);
      }
      bytes.push(value);
      index += 3;
      continue;
    }
    const code = payload.charCodeAt(index);
    if (code > 0xff) {
      throw new Error(`${label} is not a readable embedded image.`);
    }
    bytes.push(code);
    index += 1;
  }
  return Uint8Array.from(bytes);
};

const decodeSvgText = (source: ParsedDataUrl, label: string) => {
  try {
    if (source.base64) {
      const compact = compactBase64(source.payload);
      const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
      const byteLength = Math.floor(compact.length * 3 / 4) - padding;
      if (byteLength > PROJECT_RASTER_IMPORT_LIMITS.svgBytes) {
        throw new Error(`${label} SVG is larger than the 512 KB classroom limit.`);
      }
      const bytes = decodeBase64Prefix(
        compact,
        PROJECT_RASTER_IMPORT_LIMITS.svgBytes + 1,
        label,
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    const text = decodeURIComponent(source.payload);
    if (new TextEncoder().encode(text).byteLength > PROJECT_RASTER_IMPORT_LIMITS.svgBytes) {
      throw new Error(`${label} SVG is larger than the 512 KB classroom limit.`);
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes("classroom limit")) {
      throw error;
    }
    throw new Error(`${label} is not a readable embedded SVG.`);
  }
};

const dimensionsForReference = (
  reference: ProjectRasterReference,
): ImageDimensions => {
  const source = parseDataUrl(reference.url, reference.label);
  if (source.mimeType === "image/svg+xml") {
    const svgText = decodeSvgText(source, reference.label);
    assertLocalSceneObjectSvg(svgText);
    return sceneObjectSvgDimensions(svgText);
  }
  if (!SUPPORTED_RASTER_MIME_TYPES.has(source.mimeType)) {
    throw new Error(
      `${reference.label} uses an unsupported image format. Use PNG, JPEG, WebP, or local SVG artwork.`,
    );
  }
  const bytes = source.base64
    ? decodeBase64Prefix(
        source.payload,
        PROJECT_RASTER_IMPORT_LIMITS.headerBytes,
        reference.label,
      )
    : decodePercentEncodedPrefix(
        source.payload,
        PROJECT_RASTER_IMPORT_LIMITS.headerBytes,
        reference.label,
      );
  const dimensions = rasterImageDimensions(bytes, source.mimeType);
  if (!dimensions) {
    throw new Error(`${reference.label} image dimensions could not be read safely.`);
  }
  return dimensions;
};

const addDimensionsToBudget = (
  state: RasterBudgetState,
  dimensions: ImageDimensions,
  label: string,
) => {
  const width = Math.floor(dimensions.width);
  const height = Math.floor(dimensions.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`${label} image dimensions could not be read safely.`);
  }
  const sourcePixels = width * height;
  if (
    width > PROJECT_RASTER_IMPORT_LIMITS.maxSourceEdge ||
    height > PROJECT_RASTER_IMPORT_LIMITS.maxSourceEdge ||
    sourcePixels > PROJECT_RASTER_IMPORT_LIMITS.maxSourcePixels
  ) {
    throw new Error(
      `${label} exceeds the 2048 px or 4 megapixel classroom texture limit.`,
    );
  }
  if (
    state.totalSourcePixels + sourcePixels >
    PROJECT_RASTER_IMPORT_LIMITS.maxAggregateSourcePixels
  ) {
    throw new Error("Imported artwork exceeds the combined 8 megapixel classroom texture limit.");
  }
  state.totalSourcePixels += sourcePixels;
  state.uniqueSourceCount += 1;
};

const projectRasterReferences = (project: unknown): ProjectRasterReference[] => {
  const raw = asRecord(project);
  const references: ProjectRasterReference[] = [];
  const add = (value: unknown, label: string) => {
    if (typeof value !== "string" || !value.startsWith("data:")) return;
    references.push({ label, url: value });
  };

  for (const [partId, value] of Object.entries(asRecord(raw.parts))) {
    const part = asRecord(value);
    add(part.textureUrl, `Part ${partId} artwork`);
    add(part.maskUrl, `Part ${partId} mask`);
  }
  for (const [objectId, value] of Object.entries(asRecord(raw.sceneObjects))) {
    add(asRecord(value).textureUrl, `Scene object ${objectId} artwork`);
  }
  const characterPackage = asRecord(raw.characterPackage);
  add(characterPackage.sourceTextureUrl, "Character source artwork");
  add(characterPackage.maskUrl, "Character source mask");
  return references;
};

export const validateProjectRasterSources = (
  project: unknown,
): ProjectRasterImportSummary => {
  const seen = new Set<string>();
  const state: RasterBudgetState = {
    totalSourcePixels: 0,
    uniqueSourceCount: 0,
  };

  for (const reference of projectRasterReferences(project)) {
    if (seen.has(reference.url)) continue;
    seen.add(reference.url);
    addDimensionsToBudget(
      state,
      dimensionsForReference(reference),
      reference.label,
    );
  }

  return state;
};

export const validateCharacterPackageRasterFiles = async (
  files: readonly File[],
): Promise<ProjectRasterImportSummary> => {
  const seen = new Set<File>();
  const state: RasterBudgetState = {
    totalSourcePixels: 0,
    uniqueSourceCount: 0,
  };
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const mimeType = sceneObjectImageMimeType(file);
    const label = `Character image ${file.name}`;
    if (!mimeType) {
      throw new Error(
        `${label} uses an unsupported image format. Use PNG, JPEG, WebP, or local SVG artwork.`,
      );
    }
    let dimensions: ImageDimensions | undefined;
    if (mimeType === "image/svg+xml") {
      if (file.size > PROJECT_RASTER_IMPORT_LIMITS.svgBytes) {
        throw new Error(`${label} SVG is larger than the 512 KB classroom limit.`);
      }
      const svgText = await file.text();
      assertLocalSceneObjectSvg(svgText);
      dimensions = sceneObjectSvgDimensions(svgText);
    } else {
      const bytes = new Uint8Array(await file
        .slice(0, PROJECT_RASTER_IMPORT_LIMITS.headerBytes)
        .arrayBuffer());
      dimensions = rasterImageDimensions(bytes, mimeType);
    }
    if (!dimensions) {
      throw new Error(`${label} image dimensions could not be read safely.`);
    }
    addDimensionsToBudget(state, dimensions, label);
  }
  return state;
};

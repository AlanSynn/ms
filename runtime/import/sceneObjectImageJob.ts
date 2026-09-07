import type { Point, ProjectState, SceneObject } from "../../types";
import { createPortableProjectBlob } from "../persistence/projectDownloadJob";
import {
  assertLocalSceneObjectSvg,
  fitSceneObjectImageDimensions,
  rasterImageDimensions,
  SCENE_OBJECT_IMAGE_LIMITS,
  sceneObjectSvgDimensions,
  validateSceneObjectImageDimensions,
  validateSceneObjectImageFile,
  type ImageDimensions,
} from "./sceneObjectImagePolicy";

export type SceneObjectImageWorkerRequest = {
  type: "create-object";
  generationId: number;
  file: File;
  objectId: string;
  project?: ProjectState;
};

export type SceneObjectImageWorkerResponse =
  | {
      type: "result";
      generationId: number;
      object: SceneObject;
    }
  | { type: "error"; generationId: number; message: string };

type DecodedImage = {
  image: CanvasImageSource;
  close: () => void;
};

const readDimensions = async (file: File, mimeType: string) => {
  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer(),
  );
  const dimensions = rasterImageDimensions(header, mimeType);
  if (!dimensions) throw new Error("Object image dimensions could not be read.");
  return validateSceneObjectImageDimensions(dimensions);
};

const decodeImage = async (
  file: File,
  mimeType: string,
  output: ImageDimensions,
): Promise<DecodedImage> => {
  if (
    mimeType !== "image/svg+xml" &&
    typeof ImageDecoder !== "undefined" &&
    await ImageDecoder.isTypeSupported(mimeType)
  ) {
    const decoder = new ImageDecoder({
      data: file.stream(),
      type: mimeType,
      desiredWidth: output.width,
      desiredHeight: output.height,
    });
    try {
      await decoder.tracks.ready;
      const result = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
      return {
        image: result.image,
        close: () => {
          result.image.close();
          decoder.close();
        },
      };
    } catch (error) {
      decoder.close();
      throw error;
    }
  }
  const bitmap = await createImageBitmap(file, {
    resizeWidth: output.width,
    resizeHeight: output.height,
    resizeQuality: "medium",
  });
  return { image: bitmap, close: () => bitmap.close() };
};

/** Preserve validated file bytes; preview/contour resolution never becomes source. */
const originalImageDataUrl = async (file: File, mimeType: string) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const fallbackContour = (width: number, height: number): Point[] => [
  { x: -width / 2, y: -height / 2 },
  { x: width / 2, y: -height / 2 },
  { x: width / 2, y: height / 2 },
  { x: -width / 2, y: height / 2 },
];

const imageContour = (
  pixels: Uint8ClampedArray,
  pixelWidth: number,
  pixelHeight: number,
  width: number,
  height: number,
) => {
  let alphaVariance = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    alphaVariance += Math.abs(pixels[index] - 255);
  }
  const alphaDriven = alphaVariance > pixels.length * 0.002;
  let minX = pixelWidth;
  let minY = pixelHeight;
  let maxX = -1;
  let maxY = -1;
  const isForeground = (x: number, y: number) => {
    const index = (y * pixelWidth + x) * 4;
    const luma =
      0.299 * pixels[index] +
      0.587 * pixels[index + 1] +
      0.114 * pixels[index + 2];
    return alphaDriven
      ? pixels[index + 3] > 12
      : pixels[index + 3] > 12 && luma < 246;
  };
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      if (!isForeground(x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return fallbackContour(width, height);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const bins: Array<{ x: number; y: number; d2: number } | null> = Array(48).fill(null);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!isForeground(x, y)) continue;
      const dx = x - center.x;
      const dy = y - center.y;
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const index = Math.min(
        bins.length - 1,
        Math.floor((angle / (Math.PI * 2)) * bins.length),
      );
      const d2 = dx * dx + dy * dy;
      if (!bins[index] || d2 > bins[index]!.d2) bins[index] = { x, y, d2 };
    }
  }
  const points = bins.flatMap((point) =>
    point
      ? [{
          x: (point.x / pixelWidth - 0.5) * width,
          y: (0.5 - point.y / pixelHeight) * height,
        }]
      : [],
  );
  return points.length >= 3 ? points : fallbackContour(width, height);
};

const buildSceneObject = (
  file: File,
  objectId: string,
  sourceDimensions: ImageDimensions,
  textureUrl: string,
  contourPoints?: Point[],
): SceneObject => {
  const size = 118;
  const ratio = sourceDimensions.width / sourceDimensions.height;
  const bounds = ratio >= 1
    ? { width: size, height: size / ratio }
    : { width: size * ratio, height: size };
  return {
    id: objectId,
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Object",
    shape: "block",
    fabrication: "decoration",
    textureUrl,
    contourPoints: contourPoints ?? fallbackContour(bounds.width, bounds.height),
    contourSource: "imported",
    sourceImageName: file.name,
    transform: { x: 112, y: 142, rotation: 0, scale: 1 },
    bounds,
    fillColor: "#c4b5fd",
    opacity: 0.96,
    visible: true,
    locked: false,
    zIndex: 20,
  };
};

export const runSceneObjectImageJob = async (
  file: File,
  objectId: string,
  project?: ProjectState,
): Promise<SceneObject> => {
  const mimeType = validateSceneObjectImageFile(file);
  const finish = (object: SceneObject) => {
    if (project) {
      // A preserved original may be larger than a preview. Reuse the Save/Open
      // byte, aggregate-image and round-trip gates before committing the owner.
      createPortableProjectBlob({ ...project,
        sceneObjects: { ...project.sceneObjects, [object.id]: object },
        sceneObjectOrder: project.sceneObjectOrder.includes(object.id)
          ? project.sceneObjectOrder : [...project.sceneObjectOrder, object.id],
      });
    }
    return object;
  };
  if (mimeType === "image/svg+xml") {
    const svgText = await file.text();
    assertLocalSceneObjectSvg(svgText);
    const sourceDimensions = validateSceneObjectImageDimensions(
      sceneObjectSvgDimensions(svgText),
    );
    return finish(buildSceneObject(
      file,
      objectId,
      sourceDimensions,
      await originalImageDataUrl(file, mimeType),
    ));
  }
  const sourceDimensions = await readDimensions(file, mimeType);
  const textureDimensions = fitSceneObjectImageDimensions(
    sourceDimensions,
    SCENE_OBJECT_IMAGE_LIMITS.textureEdge,
  );
  const decoded = await decodeImage(file, mimeType, textureDimensions);
  let contourCanvas: OffscreenCanvas | undefined;
  try {
    const textureUrl = await originalImageDataUrl(file, mimeType);

    const size = 118;
    const ratio = sourceDimensions.width / sourceDimensions.height;
    const bounds = ratio >= 1
      ? { width: size, height: size / ratio }
      : { width: size * ratio, height: size };
    const contourDimensions = fitSceneObjectImageDimensions(
      sourceDimensions,
      SCENE_OBJECT_IMAGE_LIMITS.contourEdge,
    );
    contourCanvas = new OffscreenCanvas(
      contourDimensions.width,
      contourDimensions.height,
    );
    const contourContext = contourCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    let contourPoints = fallbackContour(bounds.width, bounds.height);
    if (contourContext) {
      contourContext.drawImage(
        decoded.image,
        0,
        0,
        contourCanvas.width,
        contourCanvas.height,
      );
      const pixels = contourContext.getImageData(
        0,
        0,
        contourCanvas.width,
        contourCanvas.height,
      ).data;
      contourPoints = imageContour(
        pixels,
        contourCanvas.width,
        contourCanvas.height,
        bounds.width,
        bounds.height,
      );
    }
    return finish(buildSceneObject(
      file,
      objectId,
      sourceDimensions,
      textureUrl,
      contourPoints,
    ));
  } finally {
    decoded.close();
    if (contourCanvas) { contourCanvas.width = 0; contourCanvas.height = 0; }
  }
};

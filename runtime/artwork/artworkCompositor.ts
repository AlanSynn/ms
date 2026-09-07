import type { ArtworkDocument, ArtworkOperation, Bounds, Point } from '../../types';

export type ArtworkCanvas = HTMLCanvasElement | OffscreenCanvas;
type ArtworkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ArtworkClip =
  | { kind: 'none' }
  | { kind: 'contour'; points: readonly Readonly<Point>[]; holes?: readonly { center: Readonly<Point>; radius: number }[] };
export type ArtworkResolution = { width: number; height: number };
export type ArtworkCompositeInput = {
  document: ArtworkDocument;
  assets: { texture?: CanvasImageSource };
  targetFrame: Bounds;
  clip: ArtworkClip;
  resolution: ArtworkResolution;
  baseColor?: string;
  createCanvas?: (width: number, height: number) => ArtworkCanvas;
};

// At most 32 MiB for the two RGBA surfaces used by one composite. Print callers
// report an oversized result instead of silently lowering the requested DPI.
export const ARTWORK_RASTER_LIMITS = Object.freeze({ edge: 4096, pixels: 4_000_000 });

export const createArtworkCanvas = (width: number, height: number): ArtworkCanvas => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new Error('A Canvas 2D surface is required to render artwork.');
};

export const disposeArtworkCanvas = (canvas: ArtworkCanvas) => {
  canvas.width = 0;
  canvas.height = 0;
};

const contextFor = (canvas: ArtworkCanvas): ArtworkContext => {
  const context = canvas.getContext('2d') as ArtworkContext | null;
  if (!context) throw new Error('Artwork preview could not start. Try opening the editor again.');
  return context;
};

const stroke = (context: ArtworkContext, points: readonly Readonly<Point>[], width: number) => {
  if (!points.length) return;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (points.length === 1 || points.every(point => point.x === points[0].x && point.y === points[0].y)) {
    context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
};

/** Command replay is also used for the in-progress gesture overlay. */
export const replayArtworkOperation = (context: ArtworkContext, operation: ArtworkOperation) => {
  context.save();
  context.globalCompositeOperation = operation.kind === 'erase' ? 'destination-out' : 'source-over';
  context.fillStyle = context.strokeStyle = 'color' in operation ? operation.color : '#000000';
  if (operation.kind === 'brush' || operation.kind === 'erase') stroke(context, operation.points, operation.width);
  else if (operation.kind === 'line') stroke(context, [operation.from, operation.to], operation.width);
  else {
    const x = Math.min(operation.from.x, operation.to.x), y = Math.min(operation.from.y, operation.to.y);
    const width = Math.abs(operation.to.x - operation.from.x), height = Math.abs(operation.to.y - operation.from.y);
    if (operation.kind === 'rectangle') context.fillRect(x, y, width, height);
    else if (width > 0 && height > 0) {
      context.beginPath();
      context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
};

const setOwnerTransform = (context: ArtworkContext, target: Bounds, resolution: ArtworkResolution) => {
  const sx = resolution.width / target.width, sy = resolution.height / target.height;
  context.setTransform(sx, 0, 0, -sy, -target.x * sx, (target.y + target.height) * sy);
};

const applyClip = (context: ArtworkContext, clip: ArtworkClip) => {
  if (clip.kind === 'none') return;
  if (clip.points.length < 3) throw new Error('Artwork needs a valid cut outline.');
  context.beginPath();
  context.moveTo(clip.points[0].x, clip.points[0].y);
  for (const point of clip.points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  for (const hole of clip.holes ?? []) {
    context.moveTo(hole.center.x + hole.radius, hole.center.y);
    context.arc(hole.center.x, hole.center.y, hole.radius, 0, Math.PI * 2);
    context.closePath();
  }
  context.clip('evenodd');
};

/**
 * One front-side compositor for editing, Three textures and print. Ink replays on
 * an isolated transparent surface. Erase affects only earlier ink; the substrate
 * is placed beneath the completed ink, and physical clipping never edits source.
 */
export const compositeArtwork = (input: ArtworkCompositeInput): ArtworkCanvas => {
  const { document, assets, targetFrame, clip, resolution, baseColor } = input;
  const { width, height } = resolution;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > ARTWORK_RASTER_LIMITS.edge || height > ARTWORK_RASTER_LIMITS.edge
      || width * height > ARTWORK_RASTER_LIMITS.pixels) {
    throw new Error('Artwork is too large at this resolution. Use a smaller physical piece.');
  }
  if (![targetFrame.x, targetFrame.y, targetFrame.width, targetFrame.height].every(Number.isFinite)
      || targetFrame.width <= 0 || targetFrame.height <= 0) throw new Error('Artwork target frame is invalid.');
  if (document.sourceImage && !assets.texture) throw new Error('Original artwork could not be loaded. Your painting is unchanged.');
  const createCanvas = input.createCanvas ?? createArtworkCanvas;
  const ink = createCanvas(width, height);
  let result: ArtworkCanvas | undefined;
  try {
    const inkContext = contextFor(ink);
    inkContext.clearRect(0, 0, width, height);
    setOwnerTransform(inkContext, targetFrame, resolution);
    if (document.sourceImage && assets.texture) {
      const source = document.sourceImage.frame;
      inkContext.save();
      // Image row 0 belongs at the owner's top (positive Y), with no mirrored back.
      inkContext.translate(source.x, source.y + source.height);
      inkContext.scale(1, -1);
      inkContext.drawImage(assets.texture, 0, 0, source.width, source.height);
      inkContext.restore();
    }
    for (const operation of document.operations) replayArtworkOperation(inkContext, operation);
    result = createCanvas(width, height);
    const context = contextFor(result);
    context.clearRect(0, 0, width, height);
    context.save();
    setOwnerTransform(context, targetFrame, resolution);
    applyClip(context, clip);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(ink, 0, 0);
    if (baseColor) {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = baseColor;
      context.fillRect(0, 0, width, height);
    }
    context.restore();
    return result;
  } catch (error) {
    if (result) disposeArtworkCanvas(result);
    throw error;
  } finally {
    disposeArtworkCanvas(ink);
  }
};

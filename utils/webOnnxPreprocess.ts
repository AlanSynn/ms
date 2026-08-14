import type { Bounds } from "../types";

export type ForegroundMask = {
  data: Uint8Array;
  bbox: Bounds;
};

export const bboxFromMask = (
  mask: Uint8Array,
  width: number,
  height: number,
): Bounds | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const keepSignificantComponents = (
  mask: Uint8Array,
  width: number,
  height: number,
) => {
  const labels = new Int32Array(width * height).fill(-1);
  const areas: number[] = [];
  const queue = new Int32Array(width * height);
  let label = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || labels[i] !== -1) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    labels[i] = label;
    queue[tail++] = i;
    while (head < tail) {
      const index = queue[head++];
      area += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && labels[next] === -1) {
            labels[next] = label;
            queue[tail++] = next;
          }
        }
      }
    }
    areas[label++] = area;
  }
  if (!areas.length) return mask;
  const largest = areas.reduce((max, area) => Math.max(max, area), 0);
  const total = areas.reduce((sum, area) => sum + area, 0);
  const threshold = Math.max(64, total * 0.003, largest * 0.01);
  const keep = new Uint8Array(mask.length);
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] >= 0 && areas[labels[i]] >= threshold) keep[i] = 255;
  }
  return keep.some(Boolean) ? keep : mask;
};

export const foregroundMaskFromRgba = (
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): ForegroundMask => {
  const mask = new Uint8Array(width * height);
  let alphaVariance = 0;
  let whitePixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    alphaVariance += Math.abs((rgba[i + 3] ?? 255) - 255);
    const luma = 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    if (luma > 240) whitePixels += 1;
  }
  const alphaDriven = alphaVariance > rgba.length * 0.01;
  const lineArt = whitePixels / mask.length > 0.4;
  for (let p = 0, i = 0; i < rgba.length; i += 4, p += 1) {
    const luma = 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    mask[p] = alphaDriven
      ? (rgba[i + 3] ?? 255) > 10 ? 255 : 0
      : lineArt
        ? luma < 242 ? 255 : 0
        : luma < 245 && luma > 8 ? 255 : 0;
  }
  const data = keepSignificantComponents(mask, width, height);
  return {
    data,
    bbox: bboxFromMask(data, width, height) ?? { x: 0, y: 0, width, height },
  };
};

export const poseCropBounds = (bbox: Bounds, imageWidth: number, imageHeight: number): Bounds => {
  const margin = 0.2;
  const x = Math.max(0, bbox.x - bbox.width * margin);
  const y = Math.max(0, bbox.y - bbox.height * margin);
  const right = Math.min(imageWidth, bbox.x + bbox.width * (1 + margin));
  const bottom = Math.min(imageHeight, bbox.y + bbox.height * (1 + margin));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};

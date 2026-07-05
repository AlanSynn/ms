import type { Point } from "../types";
import { partOutlineBounds } from "./partGeometry";

export type CutViewport = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type CutFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SvgClientRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clampStart = (
  value: number,
  min: number,
  max: number,
  size: number,
) => {
  const upper = max - size;
  if (upper <= min) return min;
  return Math.max(min, Math.min(upper, value));
};

const cutPointToCanvas = (point: Point): Point => ({
  x: point.x,
  y: -point.y,
});

export const buildCutBaseViewport = ({
  autoPoints,
  points,
  fallbackFrame,
  sourceFrame,
}: {
  autoPoints: Point[];
  points: Point[];
  fallbackFrame: CutFrame;
  sourceFrame?: CutFrame;
}): CutViewport => {
  const displayPoints = [...autoPoints, ...points]
    .map(cutPointToCanvas)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const fallbackPoints = [
    { x: fallbackFrame.x, y: fallbackFrame.y },
    {
      x: fallbackFrame.x + fallbackFrame.width,
      y: fallbackFrame.y + fallbackFrame.height,
    },
  ];
  const editBounds = partOutlineBounds(
    displayPoints.length ? displayPoints : fallbackPoints,
  );
  const source = sourceFrame ?? fallbackFrame;
  const centerX = (editBounds.minX + editBounds.maxX) / 2;
  const centerY = (editBounds.minY + editBounds.maxY) / 2;
  const hasSourceFrame = Boolean(sourceFrame);
  const desiredWidth = Math.max(
    140,
    editBounds.width * (hasSourceFrame ? 3.2 : 1.7),
  );
  const desiredHeight = Math.max(
    140,
    editBounds.height * (hasSourceFrame ? 3.2 : 1.7),
  );
  const width = Math.min(
    Math.max(desiredWidth, source.width * (hasSourceFrame ? 0.28 : 0.75)),
    source.width,
  );
  const height = Math.min(
    Math.max(desiredHeight, source.height * (hasSourceFrame ? 0.28 : 0.75)),
    source.height,
  );
  return {
    minX: clampStart(centerX - width / 2, source.x, source.x + source.width, width),
    minY: clampStart(centerY - height / 2, source.y, source.y + source.height, height),
    width,
    height,
  };
};

const clampCutViewport = (
  next: CutViewport,
  baseViewport: CutViewport,
  viewBounds: CutFrame,
): CutViewport => {
  const padX = Math.max(24, baseViewport.width * 0.08);
  const padY = Math.max(24, baseViewport.height * 0.08);
  const minX = viewBounds.x - padX;
  const minY = viewBounds.y - padY;
  const maxX = viewBounds.x + viewBounds.width + padX;
  const maxY = viewBounds.y + viewBounds.height + padY;
  const clamp = (value: number, min: number, max: number, size: number) => {
    const upper = max - size;
    if (upper <= min) return (min + max - size) / 2;
    return Math.max(min, Math.min(upper, value));
  };
  return {
    minX: clamp(next.minX, minX, maxX, next.width),
    minY: clamp(next.minY, minY, maxY, next.height),
    width: next.width,
    height: next.height,
  };
};

export const zoomCutViewport = ({
  viewport,
  baseViewport,
  viewBounds,
  svgRect,
  clientX,
  clientY,
  factor,
}: {
  viewport: CutViewport;
  baseViewport: CutViewport;
  viewBounds: CutFrame;
  svgRect?: SvgClientRect;
  clientX?: number;
  clientY?: number;
  factor: number;
}): CutViewport => {
  const usableRect = svgRect && svgRect.width > 0 && svgRect.height > 0
    ? svgRect
    : undefined;
  const anchor = usableRect
    ? {
        x:
          viewport.minX +
          (((clientX ?? usableRect.left + usableRect.width / 2) - usableRect.left) /
            usableRect.width) *
            viewport.width,
        y:
          viewport.minY +
          (((clientY ?? usableRect.top + usableRect.height / 2) - usableRect.top) /
            usableRect.height) *
            viewport.height,
      }
    : {
        x: viewport.minX + viewport.width / 2,
        y: viewport.minY + viewport.height / 2,
      };
  const minWidth = Math.max(24, baseViewport.width * 0.16);
  const minHeight = Math.max(24, baseViewport.height * 0.16);
  const maxWidth = Math.max(baseViewport.width * 1.6, viewBounds.width);
  const maxHeight = Math.max(baseViewport.height * 1.6, viewBounds.height);
  const width = Math.max(minWidth, Math.min(maxWidth, viewport.width * factor));
  const height = Math.max(minHeight, Math.min(maxHeight, viewport.height * factor));
  const anchorRatioX = viewport.width
    ? (anchor.x - viewport.minX) / viewport.width
    : 0.5;
  const anchorRatioY = viewport.height
    ? (anchor.y - viewport.minY) / viewport.height
    : 0.5;
  return clampCutViewport(
    {
      minX: anchor.x - anchorRatioX * width,
      minY: anchor.y - anchorRatioY * height,
      width,
      height,
    },
    baseViewport,
    viewBounds,
  );
};

export const panCutViewport = ({
  startViewport,
  baseViewport,
  viewBounds,
  svgRect,
  deltaClientX,
  deltaClientY,
}: {
  startViewport: CutViewport;
  baseViewport: CutViewport;
  viewBounds: CutFrame;
  svgRect: SvgClientRect;
  deltaClientX: number;
  deltaClientY: number;
}): CutViewport | undefined => {
  if (svgRect.width <= 0 || svgRect.height <= 0) return undefined;
  return clampCutViewport(
    {
      ...startViewport,
      minX: startViewport.minX - (deltaClientX / svgRect.width) * startViewport.width,
      minY: startViewport.minY - (deltaClientY / svgRect.height) * startViewport.height,
    },
    baseViewport,
    viewBounds,
  );
};

export const clientPointToCutPoint = ({
  viewport,
  svgRect,
  clientX,
  clientY,
}: {
  viewport: CutViewport;
  svgRect: SvgClientRect;
  clientX: number;
  clientY: number;
}): Point | undefined => {
  if (svgRect.width <= 0 || svgRect.height <= 0) return undefined;
  const x = viewport.minX + ((clientX - svgRect.left) / svgRect.width) * viewport.width;
  const y = viewport.minY + ((clientY - svgRect.top) / svgRect.height) * viewport.height;
  return { x: Number(x.toFixed(1)), y: Number((-y).toFixed(1)) };
};

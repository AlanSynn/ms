import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BodyPartLayer, Point } from "../../../types";
import { partOutlineBounds } from "../../../utils/partGeometry";

const contourCentroid = (points: Point[]): Point => {
  if (!points.length) return { x: 0, y: 0 };
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
};

export const scaleContour = (points: Point[], factor: number): Point[] => {
  const center = contourCentroid(points);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
};

const contourPathD = (points: Point[], flipY = false) =>
  points.length
    ? `M ${points.map((point) => `${point.x.toFixed(2)} ${(flipY ? -point.y : point.y).toFixed(2)}`).join(" L ")} Z`
    : "";

const cutPointToCanvas = (point: Point): Point => ({ x: point.x, y: -point.y });

type CutViewport = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export const CutOutlineEditorDialog = ({
  part,
  sourceTextureUrl,
  points,
  autoPoints,
  selectedIndex,
  setSelectedIndex,
  updatePointAt,
  addPoint,
  removePoint,
  onUseAuto,
  onExpand,
  onShrink,
  onClose,
}: {
  part: BodyPartLayer;
  sourceTextureUrl?: string;
  points: Point[];
  autoPoints: Point[];
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  updatePointAt: (index: number, updates: Partial<Point>) => void;
  addPoint: () => void;
  removePoint: () => void;
  onUseAuto: () => void;
  onExpand: () => void;
  onShrink: () => void;
  onClose: () => void;
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startViewport: CutViewport;
    moved: boolean;
  } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [viewOverride, setViewOverride] = useState<CutViewport | null>(null);
  const fallbackImageFrame = {
    x: part.bounds.x,
    y: -(part.bounds.y + part.bounds.height),
    width: part.bounds.width,
    height: part.bounds.height,
  };
  const sourceImageFrame =
    sourceTextureUrl && part.sourceImageFrame
      ? part.sourceImageFrame
      : undefined;
  const imageFrame = sourceImageFrame ?? fallbackImageFrame;
  const imageHref = sourceImageFrame ? sourceTextureUrl : part.textureUrl;
  const baseViewport = useMemo(() => {
    const displayPoints = [...autoPoints, ...points]
      .map(cutPointToCanvas)
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    const fallbackPoints = [
      { x: fallbackImageFrame.x, y: fallbackImageFrame.y },
      {
        x: fallbackImageFrame.x + fallbackImageFrame.width,
        y: fallbackImageFrame.y + fallbackImageFrame.height,
      },
    ];
    const editBounds = partOutlineBounds(
      displayPoints.length ? displayPoints : fallbackPoints,
    );
    const sourceFrame = sourceImageFrame ?? fallbackImageFrame;
    const centerX = (editBounds.minX + editBounds.maxX) / 2;
    const centerY = (editBounds.minY + editBounds.maxY) / 2;
    const desiredWidth = Math.max(
      140,
      editBounds.width * (sourceImageFrame ? 3.2 : 1.7),
    );
    const desiredHeight = Math.max(
      140,
      editBounds.height * (sourceImageFrame ? 3.2 : 1.7),
    );
    const width = Math.min(
      Math.max(
        desiredWidth,
        sourceFrame.width * (sourceImageFrame ? 0.28 : 0.75),
      ),
      sourceFrame.width,
    );
    const height = Math.min(
      Math.max(
        desiredHeight,
        sourceFrame.height * (sourceImageFrame ? 0.28 : 0.75),
      ),
      sourceFrame.height,
    );
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
    return {
      minX: clampStart(
        centerX - width / 2,
        sourceFrame.x,
        sourceFrame.x + sourceFrame.width,
        width,
      ),
      minY: clampStart(
        centerY - height / 2,
        sourceFrame.y,
        sourceFrame.y + sourceFrame.height,
        height,
      ),
      width,
      height,
    };
  }, [
    autoPoints,
    fallbackImageFrame.height,
    fallbackImageFrame.width,
    fallbackImageFrame.x,
    fallbackImageFrame.y,
    points,
    sourceImageFrame,
  ]);
  const viewBounds = sourceImageFrame ?? fallbackImageFrame;
  const clampViewport = (next: CutViewport): CutViewport => {
    const padX = Math.max(24, baseViewport.width * 0.08);
    const padY = Math.max(24, baseViewport.height * 0.08);
    const minX = viewBounds.x - padX;
    const minY = viewBounds.y - padY;
    const maxX = viewBounds.x + viewBounds.width + padX;
    const maxY = viewBounds.y + viewBounds.height + padY;
    const clampStart = (value: number, min: number, max: number, size: number) => {
      const upper = max - size;
      if (upper <= min) return (min + max - size) / 2;
      return Math.max(min, Math.min(upper, value));
    };
    return {
      minX: clampStart(next.minX, minX, maxX, next.width),
      minY: clampStart(next.minY, minY, maxY, next.height),
      width: next.width,
      height: next.height,
    };
  };
  const viewport = viewOverride ?? baseViewport;
  const zoomPercent = Math.round((baseViewport.width / viewport.width) * 100);
  useEffect(() => {
    setViewOverride(null);
  }, [part.id]);
  const zoomViewAt = (clientX: number | undefined, clientY: number | undefined, factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const anchor = rect
      ? {
          x:
            viewport.minX +
            (((clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width) *
              viewport.width,
          y:
            viewport.minY +
            (((clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height) *
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
    const anchorRatioX = viewport.width ? (anchor.x - viewport.minX) / viewport.width : 0.5;
    const anchorRatioY = viewport.height ? (anchor.y - viewport.minY) / viewport.height : 0.5;
    setViewOverride(
      clampViewport({
        minX: anchor.x - anchorRatioX * width,
        minY: anchor.y - anchorRatioY * height,
        width,
        height,
      }),
    );
  };
  const panViewBy = (deltaClientX: number, deltaClientY: number, startViewport: CutViewport) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    setViewOverride(
      clampViewport({
        ...startViewport,
        minX: startViewport.minX - (deltaClientX / rect.width) * startViewport.width,
        minY: startViewport.minY - (deltaClientY / rect.height) * startViewport.height,
      }),
    );
  };
  const pointFromPointer = (
    event: React.PointerEvent<SVGSVGElement>,
  ): Point | undefined => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    const canvasPoint = {
      x: Number(
        (
          viewport.minX +
          ((event.clientX - rect.left) / rect.width) * viewport.width
        ).toFixed(1),
      ),
      y: Number(
        (
          viewport.minY +
          ((event.clientY - rect.top) / rect.height) * viewport.height
        ).toFixed(1),
      ),
    };
    return { x: canvasPoint.x, y: -canvasPoint.y };
  };
  const movePointFromPointer = (
    event: React.PointerEvent<SVGSVGElement>,
    index = selectedIndex,
  ) => {
    if (part.locked || !points.length) return;
    const point = pointFromPointer(event);
    if (!point) return;
    updatePointAt(index, point);
  };
  const stopDrag = (event?: React.PointerEvent<SVGSVGElement>) => {
    if (event && svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
    dragIndexRef.current = null;
    panRef.current = null;
    setDraggingIndex(null);
  };
  const dialog = (
    <div
      className="modal-backdrop cut-outline-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-sheet cut-outline-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cut-outline-title"
        data-testid="cut-outline-dialog"
      >
        <div className="cut-outline-head">
          <div>
            <div className="section-title">Cut</div>
            <h3 id="cut-outline-title">Edit {part.name}</h3>
            <p>Drag points. Drag canvas. Scroll zoom.</p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            data-testid="cut-outline-close"
            onClick={onClose}
          >
            Done
          </button>
        </div>
        <div className="cut-outline-canvas-wrap">
          <svg
            ref={svgRef}
            className={`cut-outline-canvas ${panRef.current?.moved ? "panning" : ""}`}
            data-testid="cut-outline-canvas"
            viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label="Cut outline editing canvas"
            onWheel={(event) => {
              event.preventDefault();
              zoomViewAt(event.clientX, event.clientY, event.deltaY > 0 ? 1.12 : 0.88);
            }}
            onPointerDown={(event) => {
              const target = event.target as Element;
              if (target.closest("[data-cut-point]")) return;
              panRef.current = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startViewport: viewport,
                moved: false,
              };
              svgRef.current?.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const index = dragIndexRef.current;
              if (index !== null) {
                movePointFromPointer(event, index);
                return;
              }
              const pan = panRef.current;
              if (!pan || pan.pointerId !== event.pointerId) return;
              const deltaX = event.clientX - pan.startClientX;
              const deltaY = event.clientY - pan.startClientY;
              if (!pan.moved && Math.hypot(deltaX, deltaY) < 5) return;
              pan.moved = true;
              panViewBy(deltaX, deltaY, pan.startViewport);
            }}
            onPointerUp={(event) => {
              const pan = panRef.current;
              if (pan && pan.pointerId === event.pointerId && !pan.moved) {
                movePointFromPointer(event);
              }
              stopDrag(event);
            }}
            onPointerCancel={stopDrag}
            onPointerLeave={stopDrag}
          >
          <defs>
            <pattern
              id={`cut-grid-${part.id}`}
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="#d8dfec"
                strokeWidth="0.7"
                opacity="0.9"
              />
            </pattern>
          </defs>
          <rect
            x={viewport.minX}
            y={viewport.minY}
            width={viewport.width}
            height={viewport.height}
            fill={`url(#cut-grid-${part.id})`}
          />
          {imageHref ? (
            <image
              data-testid="cut-outline-art"
              className="cut-outline-art"
              href={imageHref}
              x={imageFrame.x}
              y={imageFrame.y}
              width={imageFrame.width}
              height={imageFrame.height}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <rect
              data-testid="cut-outline-art"
              className="cut-outline-art"
              x={fallbackImageFrame.x}
              y={fallbackImageFrame.y}
              width={fallbackImageFrame.width}
              height={fallbackImageFrame.height}
              fill={part.fillColor}
            />
          )}
          {sourceImageFrame && (
            <rect
              className="cut-outline-part-window"
              x={fallbackImageFrame.x}
              y={fallbackImageFrame.y}
              width={fallbackImageFrame.width}
              height={fallbackImageFrame.height}
            />
          )}
          {autoPoints.length >= 3 && (
            <path
              className="cut-outline-auto"
              d={contourPathD(autoPoints, true)}
            />
          )}
          {points.length >= 3 && (
            <path className="cut-outline-user" d={contourPathD(points, true)} />
          )}
            {points.map((point, index) => {
              const isActive = index === selectedIndex;
              const isNeighbor =
                points.length > 2 &&
                (index === (selectedIndex + 1) % points.length ||
                  index === (selectedIndex - 1 + points.length) % points.length);
              return (
                <g
                  key={`${index}-${point.x}-${point.y}`}
                  data-cut-point="true"
                  className={`cut-outline-point-group ${isActive ? "active" : ""} ${isNeighbor ? "neighbor" : ""} ${draggingIndex === index ? "dragging" : ""}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedIndex(index);
                    dragIndexRef.current = index;
                    setDraggingIndex(index);
                    svgRef.current?.setPointerCapture(event.pointerId);
                  }}
                >
                  <circle
                    className="cut-outline-hit-target"
                    cx={point.x}
                    cy={-point.y}
                    r={16}
                  />
                  <circle
                    data-testid={`cut-outline-point-${index}`}
                    className={`cut-outline-point ${isActive ? "active" : ""} ${isNeighbor ? "neighbor" : ""} ${draggingIndex === index ? "dragging" : ""}`}
                    cx={point.x}
                    cy={-point.y}
                    r={isActive ? 7 : isNeighbor ? 5.4 : 3.8}
                  />
                </g>
              );
            })}
          </svg>
          <div className="cut-outline-view-tools" aria-label="Cut view controls">
            <button
              type="button"
              className="btn-secondary"
              data-testid="cut-outline-zoom-out"
              onClick={() => zoomViewAt(undefined, undefined, 1.18)}
            >
              −
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="cut-outline-fit"
              onClick={() => setViewOverride(null)}
            >
              Fit
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="cut-outline-zoom-in"
              onClick={() => zoomViewAt(undefined, undefined, 0.84)}
            >
              +
            </button>
            <span className="cut-outline-zoom-chip">{zoomPercent}%</span>
          </div>
        </div>
        <div className="cut-outline-tools">
          <div
            className="cut-outline-point-readout"
            data-testid="part-cut-point-readout"
          >
            Handle {points.length ? selectedIndex + 1 : 0}/{points.length}
          </div>
          <div className="cut-outline-actions">
            <button
              type="button"
              data-testid="part-cut-auto"
              className="btn-secondary"
              disabled={part.locked}
              onClick={onUseAuto}
            >
              Auto cut
            </button>
            <button
              type="button"
              data-testid="part-cut-expand"
              className="btn-secondary"
              disabled={part.locked}
              onClick={onExpand}
            >
              Expand
            </button>
            <button
              type="button"
              data-testid="part-cut-shrink"
              className="btn-secondary"
              disabled={part.locked}
              onClick={onShrink}
            >
              Shrink
            </button>
            <button
              type="button"
              data-testid="part-cut-add-point"
              className="btn-secondary"
              disabled={part.locked || points.length < 2}
              onClick={addPoint}
            >
              Add point
            </button>
            <button
              type="button"
              data-testid="part-cut-remove-point"
              className="btn-secondary"
              disabled={part.locked || points.length <= 3}
              onClick={removePoint}
            >
              Remove point
            </button>
          </div>
        </div>
      </section>
    </div>
  );
  return createPortal(dialog, document.body);
};

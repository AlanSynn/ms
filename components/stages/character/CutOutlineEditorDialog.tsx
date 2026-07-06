import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BodyPartLayer, Point } from "../../../types";
import {
  buildCutBaseViewport,
  clientPointToCutPoint,
  panCutViewport,
  zoomCutViewport,
  type CutViewport,
} from "../../../utils/cutEditorViewport";
import { contourPathD } from "../../../utils/partGeometry";

type CutTool = "edit" | "draw" | "pan";

const CUT_DRAW_MIN_DISTANCE = 8;
const CUT_DRAW_MAX_POINTS = 96;

const cutStrokePathD = (points: Point[]) =>
  points.length
    ? `M ${points.map((point) => `${point.x.toFixed(2)} ${(-point.y).toFixed(2)}`).join(" L ")}`
    : "";

const cutToolHints: Record<CutTool, string> = {
  edit: "Drag a point, or click where the selected point should go.",
  draw: "Drag one clean loop around the part.",
  pan: "Drag canvas. Scroll zoom.",
};

export const CutOutlineEditorDialog = ({
  part,
  sourceTextureUrl,
  points,
  autoPoints,
  selectedIndex,
  setSelectedIndex,
  updatePointAt,
  replacePoints,
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
  replacePoints: (nextPoints: Point[], nextSelectedIndex?: number) => void;
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
  const drawRef = useRef<{
    pointerId: number;
    points: Point[];
    lastPoint: Point;
  } | null>(null);
  const [tool, setTool] = useState<CutTool>("edit");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [isPanning, setIsPanning] = useState(false);
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
  const baseViewport = useMemo(
    () =>
      buildCutBaseViewport({
        autoPoints,
        points,
        fallbackFrame: fallbackImageFrame,
        sourceFrame: sourceImageFrame,
      }),
    [
      autoPoints,
      fallbackImageFrame.height,
      fallbackImageFrame.width,
      fallbackImageFrame.x,
      fallbackImageFrame.y,
      points,
      sourceImageFrame,
    ],
  );
  const viewBounds = sourceImageFrame ?? fallbackImageFrame;
  const viewport = viewOverride ?? baseViewport;
  const zoomPercent = Math.round((baseViewport.width / viewport.width) * 100);
  useEffect(() => {
    setViewOverride(null);
  }, [part.id]);
  const zoomViewAt = (
    clientX: number | undefined,
    clientY: number | undefined,
    factor: number,
  ) => {
    const rect = svgRef.current?.getBoundingClientRect();
    setViewOverride(
      zoomCutViewport({
        viewport,
        baseViewport,
        viewBounds,
        svgRect: rect ?? undefined,
        clientX,
        clientY,
        factor,
      }),
    );
  };
  const panViewBy = (
    deltaClientX: number,
    deltaClientY: number,
    startViewport: CutViewport,
  ) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const next = panCutViewport({
      startViewport,
      baseViewport,
      viewBounds,
      svgRect: rect,
      deltaClientX,
      deltaClientY,
    });
    if (next) setViewOverride(next);
  };
  const pointFromPointer = (
    event: React.PointerEvent<SVGSVGElement>,
  ): Point | undefined => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    return clientPointToCutPoint({
      viewport,
      svgRect: rect,
      clientX: event.clientX,
      clientY: event.clientY,
    });
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
  const startPan = (event: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewport,
      moved: false,
    };
    setIsPanning(true);
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const startDraw = (event: React.PointerEvent<SVGSVGElement>) => {
    if (part.locked) return;
    const point = pointFromPointer(event);
    if (!point) return;
    drawRef.current = {
      pointerId: event.pointerId,
      points: [point],
      lastPoint: point,
    };
    setDraftPoints([point]);
    setSelectedIndex(0);
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const appendDrawPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return;
    const point = pointFromPointer(event);
    if (!point) return;
    if (draw.points.length >= CUT_DRAW_MAX_POINTS) return;
    const distance = Math.hypot(point.x - draw.lastPoint.x, point.y - draw.lastPoint.y);
    if (distance < CUT_DRAW_MIN_DISTANCE) return;
    draw.points = [...draw.points, point];
    draw.lastPoint = point;
    setDraftPoints(draw.points);
  };
  const finishDraw = (event: React.PointerEvent<SVGSVGElement>) => {
    const draw = drawRef.current;
    if (!draw || draw.pointerId !== event.pointerId) return false;
    if (draw.points.length >= 3) replacePoints(draw.points, 0);
    drawRef.current = null;
    setDraftPoints([]);
    return true;
  };
  const stopDrag = (event?: React.PointerEvent<SVGSVGElement>) => {
    if (event && svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
    dragIndexRef.current = null;
    panRef.current = null;
    drawRef.current = null;
    setDraftPoints([]);
    setIsPanning(false);
    setDraggingIndex(null);
  };
  const wheelFactor = (deltaY: number) =>
    Math.exp(Math.max(-180, Math.min(180, deltaY)) * 0.0012);
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
            <p>{cutToolHints[tool]}</p>
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
            className={`cut-outline-canvas tool-${tool} ${isPanning ? "panning" : ""}`}
            data-testid="cut-outline-canvas"
            data-cut-tool={tool}
            viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label="Cut outline editing canvas"
            onWheel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              zoomViewAt(event.clientX, event.clientY, wheelFactor(event.deltaY));
            }}
            onPointerDown={(event) => {
              if (tool === "draw") {
                startDraw(event);
                return;
              }
              if (tool === "pan") {
                startPan(event);
                return;
              }
              const target = event.target as Element;
              if (target.closest("[data-cut-point]") || part.locked || !points.length) return;
              dragIndexRef.current = selectedIndex;
              setDraggingIndex(selectedIndex);
              movePointFromPointer(event, selectedIndex);
              svgRef.current?.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              appendDrawPoint(event);
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
              finishDraw(event);
              stopDrag(event);
            }}
            onPointerCancel={stopDrag}
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
          {draftPoints.length >= 2 && (
            <path className="cut-outline-draft" d={cutStrokePathD(draftPoints)} />
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
                    if (tool !== "edit") return;
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
          <div className="cut-outline-mode-panel">
            <div className="cut-outline-mode-buttons" aria-label="Cut tools">
              {([
                ["edit", "Edit points"],
                ["draw", "Draw cut"],
                ["pan", "Pan"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`cut-tool-${id}`}
                  className={`btn-secondary ${tool === id ? "active" : ""}`}
                  aria-pressed={tool === id}
                  onClick={() => setTool(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="cut-outline-tool-meta">
              <span
                className="cut-outline-point-readout"
                data-testid="part-cut-point-readout"
              >
                Handle {points.length ? selectedIndex + 1 : 0}/{points.length}
              </span>
              <span className="cut-outline-tool-hint" data-testid="cut-tool-hint">
                {cutToolHints[tool]}
              </span>
            </div>
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

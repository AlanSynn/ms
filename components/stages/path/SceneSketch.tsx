import React, { useEffect, useRef, useState } from "react";

import type {
  CanvasViewport,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../../../types";
import {
  boardGridLines,
  pathFromPoints,
  sceneBoundsForSheet,
  sceneToSvg,
  SCENE_VIEW,
} from "../../../utils/coordinates";
import { motionPreviewForPath, preferredMotionJointId } from "../../../utils/motion";
import {
  canvasPanOffset,
  canvasViewBoxForViewport,
  zoomCanvasViewportAtPoint,
} from "../../../utils/viewport";
import { formatGridLabel } from "../../../utils/units";
import { PartShape } from "./PartShape";
import { createPathPointerFrameSession } from "./pathPointerFrameSession";

export const SceneSketch = ({
  project,
  svgRef,
  selectedPath,
  dragPoint,
  selectedPoint,
  onPointDragStart,
  onPointMove,
  onPointUp,
  onCanvasDown,
  onJointPick,
  dispatch,
  drawMode,
  pathLocked,
  isPlaying,
  angle,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  svgRef: React.RefObject<SVGSVGElement | null>;
  selectedPath?: ProjectMotionPath;
  dragPoint: number | null;
  selectedPoint: number | null;
  onPointDragStart: (index: number) => void;
  onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onPointUp: () => void;
  onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onJointPick: (jointId: string) => void;
  dispatch: (action: ProjectAction) => void;
  drawMode?: boolean;
  pathLocked?: boolean;
  isPlaying: boolean;
  angle: number;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
  const kit = project.settings.physicalKit;
  const sheet = sceneBoundsForSheet(kit);
  const pathMechanism = selectedPath
    ? project.mechanisms.find(
        (m) =>
          m.targetPathId === selectedPath.id &&
          (selectedPath.sceneObjectId
            ? m.targetSceneObjectId === selectedPath.sceneObjectId
            : m.targetPartId === selectedPath.partId),
      )
    : undefined;
  const requestedTargetJointId =
    pathMechanism?.targetAnchorJointId ?? selectedPath?.targetAnchorJointId;
  const targetJointId = selectedPath && !selectedPath.sceneObjectId
    ? preferredMotionJointId(
        project,
        selectedPath.partId,
        requestedTargetJointId,
        { preferDistalWhenRoot: !requestedTargetJointId },
      )
    : undefined;
  const previewAngle = isPlaying ? angle : 0;
  const pathPreview =
    selectedPath?.visible &&
    selectedPath.enabled &&
    selectedPath.points.length > 1
      ? motionPreviewForPath(project, selectedPath, previewAngle, targetJointId)
      : undefined;
  const previewSkeleton = pathPreview?.skeleton ?? project.skeleton;
  const previewParts = pathPreview?.parts ?? {};
  const previewSceneObjects = pathPreview?.sceneObjects ?? {};
  const objectShape = (object: SceneObject) => {
    const center = sceneToSvg(object.transform);
    const scale = object.transform.scale || 1;
    const width = object.bounds.width * scale;
    const height = object.bounds.height * scale;
    const selected = project.selectedSceneObjectId === object.id;
    const common = {
      fill: object.fillColor,
      opacity: object.opacity,
      stroke: selected ? "#7c3aed" : "#475569",
      strokeWidth: selected ? 3 : 1.5,
    };
    const transform = `translate(${center.x} ${center.y}) rotate(${-object.transform.rotation})`;
    const contourD = (object.contourPoints && object.contourPoints.length >= 3
      ? object.contourPoints
      : [
          { x: -object.bounds.width / 2, y: -object.bounds.height / 2 },
          { x: object.bounds.width / 2, y: -object.bounds.height / 2 },
          { x: object.bounds.width / 2, y: object.bounds.height / 2 },
          { x: -object.bounds.width / 2, y: object.bounds.height / 2 },
        ])
      .map((point, index) => `${index === 0 ? "M" : "L"} ${(point.x * scale).toFixed(2)} ${(-point.y * scale).toFixed(2)}`)
      .join(" ") + " Z";
    if (object.textureUrl) {
      const clipId = `path-scene-object-clip-${object.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
      return (
        <g transform={transform}>
          <defs>
            <clipPath id={clipId}>
              <path d={contourD} />
            </clipPath>
          </defs>
          <image
            data-testid={`path-scene-object-art-${object.id}`}
            href={object.textureUrl}
            x={-width / 2}
            y={-height / 2}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
            opacity={object.opacity}
          />
          <path d={contourD} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} opacity={selected ? 0.9 : 0.42} />
        </g>
      );
    }
    if (object.shape === "star") {
      const points = Array.from({ length: 10 }, (_, index) => {
        const radius = (index % 2 === 0 ? Math.min(width, height) : Math.min(width, height) * 0.48) / 2;
        const a = -Math.PI / 2 + (index * Math.PI) / 5;
        return `${center.x + Math.cos(a) * radius},${center.y + Math.sin(a) * radius}`;
      }).join(" ");
      return <polygon points={points} {...common} />;
    }
    if (object.shape === "cloud") {
      return <ellipse cx={center.x} cy={center.y} rx={width / 2} ry={height / 2.8} {...common} />;
    }
    const x = center.x - width / 2;
    const y = center.y - height / 2;
    return <rect x={x} y={y} width={width} height={height} rx={object.shape === "piggy-bank" ? 22 : 10} {...common} />;
  };
  const sheetSvg = {
    x: SCENE_VIEW.width / 2 + sheet.x,
    y: SCENE_VIEW.height / 2 - sheet.y - sheet.height,
    width: sheet.width,
    height: sheet.height,
  };
  const gridLines = boardGridLines(kit).map((line) => {
    const a = sceneToSvg(line.a);
    const b = sceneToSvg(line.b);
    return (
      <line
        key={line.key}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#e5e8f0"
        strokeWidth="1"
      />
    );
  });
  const viewBox = canvasViewBoxForViewport(viewport, SCENE_VIEW);
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    offset: Point;
  } | null>(null);
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const panFrameSessionRef = useRef<
    ReturnType<typeof createPathPointerFrameSession<Point>> | null
  >(null);
  if (!panFrameSessionRef.current) {
    panFrameSessionRef.current = createPathPointerFrameSession<Point>({
      commit: (offset) =>
        setViewportRef.current((previous) => ({ ...previous, offset })),
    });
  }
  const panFrameSession = panFrameSessionRef.current;
  useEffect(
    () => () => panFrameSession.reset(),
    [panFrameSession],
  );
  const handlePanOrDrawDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (
      !drawMode &&
      e.button === 0 &&
      !(
        e.target instanceof Element &&
        e.target.closest('[data-canvas-interactive="true"]')
      )
    ) {
      panFrameSession.start();
      setPanStart({ x: e.clientX, y: e.clientY, offset: viewport.offset });
      e.preventDefault();
      return;
    }
    onCanvasDown(e);
  };
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (panStart) {
      const offset = canvasPanOffset({
        startOffset: panStart.offset,
        startClientX: panStart.x,
        startClientY: panStart.y,
        clientX: e.clientX,
        clientY: e.clientY,
        rect: svgRef.current?.getBoundingClientRect(),
        scene: SCENE_VIEW,
      });
      panFrameSession.move(offset);
      return;
    }
    onPointMove(e);
  };
  const finishInteraction = () => {
    panFrameSession.finish();
    setPanStart(null);
    onPointUp();
  };
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.stopPropagation();
    setViewport(zoomCanvasViewportAtPoint({
      viewport,
      rect,
      clientX: e.clientX,
      clientY: e.clientY,
      deltaY: e.deltaY,
      scene: SCENE_VIEW,
    }));
  };
  return (
    <svg
      ref={svgRef}
      aria-label="Path editor canvas"
      data-testid="path-canvas"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? "cursor-crosshair" : panStart ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseDown={handlePanOrDrawDown}
      onMouseMove={handleMove}
      onMouseUp={finishInteraction}
      onMouseLeave={finishInteraction}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onLostPointerCapture={finishInteraction}
      onWheel={handleWheel}
    >
      <defs>
        <filter id="soft">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodOpacity="0.13" />
        </filter>
      </defs>
      <rect
        x={sheetSvg.x}
        y={sheetSvg.y}
        width={sheetSvg.width}
        height={sheetSvg.height}
        rx="18"
        fill="white"
        stroke="#d6dbe8"
        strokeWidth="1.5"
      />
      {gridLines}
      <text
        x={sheetSvg.x + 16}
        y={sheetSvg.y + 28}
        className="fill-slate-400 text-[12px] font-bold"
        data-testid="scene-grid-label"
      >
        {formatGridLabel(kit, project.settings.gridUnit)}
      </text>
      {project.settings.debugVisuals && (
        <g data-testid="canvas-debug-visuals" pointerEvents="none">
          <rect
            x={sheetSvg.x + sheetSvg.width - 178}
            y={sheetSvg.y + 14}
            width="160"
            height="72"
            rx="12"
            fill="#0f172a"
            opacity="0.78"
          />
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 38}
            fill="white"
            fontSize="12"
            fontWeight="800"
          >
            Dev layer
          </text>
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 57}
            fill="#cbd5e1"
            fontSize="11"
          >
            {project.partOrder.length} parts ·{" "}
            {Object.keys(project.skeleton?.joints ?? {}).length} joints
          </text>
          <text
            x={sheetSvg.x + sheetSvg.width - 164}
            y={sheetSvg.y + 75}
            fill="#cbd5e1"
            fontSize="11"
          >
            snap {project.settings.physicsSnapMode} · fab{" "}
            {project.settings.fabricationReadyMode ? "on" : "off"}
          </text>
        </g>
      )}
      {previewSkeleton?.bones.map(([a, b]) => {
        const ja = previewSkeleton?.joints[a];
        const jb = previewSkeleton?.joints[b];
        if (!ja || !jb) return null;
        const pa = sceneToSvg(ja.position);
        const pb = sceneToSvg(jb.position);
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="#434a59"
            strokeWidth="2"
            opacity="0.12"
          />
        );
      })}
      {project.partOrder
        .map((id) => previewParts[id] ?? project.parts[id])
        .filter(Boolean)
        .map((part) => (
          <React.Fragment key={part.id}>
            <PartShape
              part={part}
              skeleton={previewSkeleton}
              selected={project.selectedPartId === part.id}
              drawMode={drawMode}
              onSelect={() =>
                dispatch({ type: "select_part", partId: part.id })
              }
            />
          </React.Fragment>
        ))}
      {project.sceneObjectOrder
        .map((id) => previewSceneObjects[id] ?? project.sceneObjects[id])
        .filter((object): object is SceneObject => Boolean(object?.visible))
        .map((object) => (
          <g
            key={object.id}
            data-canvas-interactive="true"
            className={drawMode ? undefined : "cursor-pointer"}
            onClick={(e) => {
              if (!drawMode) {
                e.stopPropagation();
                dispatch({ type: "select_scene_object", objectId: object.id });
              }
            }}
          >
            {objectShape(object)}
          </g>
        ))}
      {previewSkeleton &&
        Object.values(previewSkeleton.joints).map((j) => {
          const p = sceneToSvg(j.position);
          const pickable = Boolean(selectedPath && !selectedPath.sceneObjectId && !pathLocked && !drawMode);
          return (
            <g
              key={j.id}
              data-canvas-interactive={pickable ? "true" : undefined}
              className={pickable ? "cursor-pointer" : undefined}
              onClick={(e) => {
                if (!pickable) return;
                e.stopPropagation();
                onJointPick(j.id);
              }}
            >
              <circle
                data-testid={`skeleton-joint-${j.id}`}
                cx={p.x}
                cy={p.y}
                r={j.locked ? 6 : 4.5}
                fill={j.locked ? "#64748b" : "#94a3b8"}
                stroke="white"
                strokeWidth="2"
                opacity={pickable ? 0.85 : 0.3}
              />
              <title>
                {j.id} bend {j.bendDirection}
              </title>
            </g>
          );
        })}
      {Object.values(project.paths)
        .filter((p) => p.visible)
        .map((path) => (
          <path
            key={path.id}
            data-testid={path.id === selectedPath?.id ? "selected-motion-path" : undefined}
            data-path-closed={path.id === selectedPath?.id ? String(path.closed) : undefined}
            d={pathFromPoints(path.points, path.closed, path.smoothness)}
            fill="none"
            stroke={path.enabled ? "#5a6cff" : "#94a3b8"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.8"
          />
        ))}
      {selectedPath?.visible &&
        selectedPath.points.map((pt, i) => {
          const p = sceneToSvg(pt);
          const active = dragPoint === i || selectedPoint === i;
          return (
            <circle
              data-canvas-interactive="true"
              key={`${selectedPath.id}-${i}`}
              cx={p.x}
              cy={p.y}
              r={active ? 8 : 6}
              fill={active ? "#5a6cff" : "#fff"}
              stroke="#5a6cff"
              strokeWidth="3"
              className={pathLocked ? "cursor-not-allowed" : "cursor-grab"}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (!pathLocked) onPointDragStart(i);
              }}
            />
          );
        })}
      {pathPreview?.target &&
        (() => {
          const target = pathPreview.target;
          const p = sceneToSvg(target);
          return (
            <g pointerEvents="none">
              <circle
                cx={p.x}
                cy={p.y}
                r="10"
                fill="#5a6cff"
                stroke="white"
                strokeWidth="3"
              />
              <text
                x={p.x + 14}
                y={p.y - 10}
                className="body-preview-label text-[12px] font-black"
              >
                Motion target
              </text>
            </g>
          );
        })()}
    </svg>
  );
};

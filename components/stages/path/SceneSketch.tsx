import React, { useState } from "react";

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
import { clampCanvasZoom } from "../../../utils/viewport";
import { formatGridLabel } from "../../../utils/units";
import { PartShape } from "./PartShape";

export const SceneSketch = ({
  project,
  svgRef,
  selectedPath,
  dragPoint,
  selectedPoint,
  setDragPoint,
  setSelectedPoint,
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
  setDragPoint: (i: number | null) => void;
  setSelectedPoint: (i: number | null) => void;
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
    const x = center.x - width / 2;
    const y = center.y - height / 2;
    const selected = project.selectedSceneObjectId === object.id;
    const common = {
      fill: object.fillColor,
      opacity: object.opacity,
      stroke: selected ? "#7c3aed" : "#475569",
      strokeWidth: selected ? 3 : 1.5,
    };
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
  const viewWidth = SCENE_VIEW.width / viewport.zoom;
  const viewHeight = SCENE_VIEW.height / viewport.zoom;
  const viewX =
    (SCENE_VIEW.width - viewWidth) / 2 - viewport.offset.x / viewport.zoom;
  const viewY =
    (SCENE_VIEW.height - viewHeight) / 2 - viewport.offset.y / viewport.zoom;
  const [panStart, setPanStart] = useState<{
    x: number;
    y: number;
    offset: Point;
  } | null>(null);
  const scalePan = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect
      ? {
          x:
            ((e.clientX - (panStart?.x ?? e.clientX)) * SCENE_VIEW.width) /
            rect.width,
          y:
            ((e.clientY - (panStart?.y ?? e.clientY)) * SCENE_VIEW.height) /
            rect.height,
        }
      : { x: 0, y: 0 };
  };
  const handlePanOrDrawDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (
      !drawMode &&
      e.button === 0 &&
      !(
        e.target instanceof Element &&
        e.target.closest('[data-canvas-interactive="true"]')
      )
    ) {
      setPanStart({ x: e.clientX, y: e.clientY, offset: viewport.offset });
      e.preventDefault();
      return;
    }
    onCanvasDown(e);
  };
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (panStart) {
      const delta = scalePan(e);
      setViewport((prev) => ({
        ...prev,
        offset: {
          x: panStart.offset.x + delta.x,
          y: panStart.offset.y + delta.y,
        },
      }));
      return;
    }
    onPointMove(e);
  };
  const finishInteraction = () => {
    setPanStart(null);
    onPointUp();
  };
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.stopPropagation();
    const nextZoom = clampCanvasZoom(viewport.zoom * (1 - e.deltaY * 0.001));
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const worldX = viewX + fx * viewWidth;
    const worldY = viewY + fy * viewHeight;
    const nextViewWidth = SCENE_VIEW.width / nextZoom;
    const nextViewHeight = SCENE_VIEW.height / nextZoom;
    const nextViewX = worldX - fx * nextViewWidth;
    const nextViewY = worldY - fy * nextViewHeight;
    setViewport({
      zoom: nextZoom,
      offset: {
        x: ((SCENE_VIEW.width - nextViewWidth) / 2 - nextViewX) * nextZoom,
        y: ((SCENE_VIEW.height - nextViewHeight) / 2 - nextViewY) * nextZoom,
      },
    });
  };
  return (
    <svg
      ref={svgRef}
      aria-label="Path editor canvas"
      data-testid="path-canvas"
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      className={`h-[calc(100vh-160px)] min-h-[560px] w-full bg-[#f8fbff] ${drawMode ? "cursor-crosshair" : panStart ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseDown={handlePanOrDrawDown}
      onMouseMove={handleMove}
      onMouseUp={finishInteraction}
      onMouseLeave={finishInteraction}
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
              e.stopPropagation();
              dispatch({ type: "select_scene_object", objectId: object.id });
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
                if (!pathLocked) {
                  setSelectedPoint(i);
                  setDragPoint(i);
                }
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

import React from "react";

import { CanvasZoomToolbar } from "../../AppShell";
import { ThreePuppetPreview } from "../../ThreePuppetPreview";
import type {
  CanvasViewport,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import type { MotionPreview } from "../../../utils/motion";
import { SceneSketch } from "./SceneSketch";

interface PathCanvasPaneProps {
  svgRef: React.RefObject<SVGSVGElement | null>;
  project: ProjectState;
  selectedPath?: ProjectMotionPath;
  dragPoint: number | null;
  selectedPoint: number | null;
  setDragPoint: (value: number | null) => void;
  setSelectedPoint: (value: number | null) => void;
  onPointMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onPointUp: () => void;
  onCanvasDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onJointPick: (jointId: string) => void;
  dispatch: (action: ProjectAction) => void;
  drawMode: boolean;
  pathLocked: boolean;
  isPlaying: boolean;
  angle: number;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
  pathViewMode: "2d" | "3d";
  switchPathView: (mode: "2d" | "3d") => void;
  pathPreview?: MotionPreview;
}

export const PathCanvasPane = ({
  svgRef,
  project,
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
  pathViewMode,
  switchPathView,
  pathPreview,
}: PathCanvasPaneProps) => (
  <div className="path-canvas-shell canvas-workspace overflow-hidden p-0">
    <CanvasZoomToolbar viewport={viewport} setViewport={setViewport} />
    <div
      className="path-view-switch"
      data-testid="path-view-switch"
      aria-label="Path view mode"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="path-view-2d"
        className={pathViewMode === "2d" ? "active" : ""}
        aria-pressed={pathViewMode === "2d"}
        onClick={() => switchPathView("2d")}
      >
        2D
      </button>
      <button
        type="button"
        data-testid="path-view-3d"
        className={pathViewMode === "3d" ? "active" : ""}
        aria-pressed={pathViewMode === "3d"}
        onClick={() => switchPathView("3d")}
      >
        3D
      </button>
    </div>
    {pathViewMode === "2d" ? (
      <SceneSketch
        svgRef={svgRef}
        project={project}
        selectedPath={selectedPath}
        dragPoint={dragPoint}
        selectedPoint={selectedPoint}
        setDragPoint={setDragPoint}
        setSelectedPoint={setSelectedPoint}
        onPointMove={onPointMove}
        onPointUp={onPointUp}
        onCanvasDown={onCanvasDown}
        onJointPick={onJointPick}
        dispatch={dispatch}
        drawMode={drawMode}
        pathLocked={pathLocked}
        isPlaying={isPlaying}
        angle={angle}
        viewport={viewport}
        setViewport={setViewport}
      />
    ) : (
      <ThreePuppetPreview
        project={project}
        animatedParts={pathPreview?.parts ?? {}}
        animatedSceneObjects={pathPreview?.sceneObjects ?? {}}
        skeleton={pathPreview?.skeleton ?? project.skeleton}
        mechanisms={[]}
        paths={selectedPath ? [selectedPath] : []}
        selectedPathId={selectedPath?.id}
        angle={angle}
        viewport={viewport}
        setViewport={setViewport}
        inputMode="always"
        testId="path-three-puppet"
        cameraPresets={["iso"]}
        onSelectPart={(partId) => dispatch({ type: "select_part", partId })}
        onSelectSceneObject={(objectId) =>
          dispatch({ type: "select_scene_object", objectId })
        }
      />
    )}
  </div>
);

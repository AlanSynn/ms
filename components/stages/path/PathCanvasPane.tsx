import React from "react";

import { CanvasZoomToolbar } from "../../AppShell";
import { DeferredThreePuppetPreview } from "../../DeferredThreePuppetPreview";
import type {
  CanvasViewport,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../../../types";
import type { MotionPreview } from "../../../utils/motion";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import type { PathGestureDraft } from "../../../runtime/path/pathGestureDraft";

interface PathCanvasPaneProps {
  project: ProjectState;
  selectedPath?: ProjectMotionPath;
  selectedPoint: number | null;
  onDrawPoint: (point: Point) => void;
  onDrawEnd: () => void;
  onPathPointPick: (pathId: string, pointIndex: number) => void;
  onPathPointMove: (point: Point) => void;
  onPathPointEnd: () => void;
  onJointPick: (jointId: string) => void;
  dispatch: (action: ProjectAction) => void;
  drawMode: boolean;
  pathLocked: boolean;
  isPlaying: boolean;
  angle: number;
  playbackClock: PlaybackClock;
  playbackSample: (phase: number) => MotionPreview | undefined;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
  pathViewMode: "2d" | "3d";
  switchPathView: (mode: "2d" | "3d") => void;
  pathPreview?: MotionPreview;
  pathGestureDraft: PathGestureDraft;
}

export const PathCanvasPane = ({
  project,
  selectedPath,
  selectedPoint,
  onDrawPoint,
  onDrawEnd,
  onPathPointPick,
  onPathPointMove,
  onPathPointEnd,
  onJointPick,
  dispatch,
  drawMode,
  pathLocked,
  isPlaying,
  angle,
  playbackClock,
  playbackSample,
  viewport,
  setViewport,
  pathViewMode,
  switchPathView,
  pathPreview,
  pathGestureDraft,
}: PathCanvasPaneProps) => {
  const pathsToRender = React.useMemo(
    () => selectedPath ? [selectedPath] : [],
    [selectedPath],
  );

  return <div className="path-canvas-shell canvas-workspace overflow-hidden p-0">
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
    <DeferredThreePuppetPreview
      project={project}
      animatedParts={pathPreview?.parts ?? {}}
      animatedSceneObjects={pathPreview?.sceneObjects ?? {}}
      skeleton={pathPreview?.skeleton ?? project.skeleton}
      mechanisms={[]}
      paths={pathsToRender}
      selectedPathId={selectedPath?.id}
      selectedPathPointIndex={selectedPoint}
      angle={angle}
      playback={{
        clock: playbackClock,
        sample: (phase) => isPlaying ? playbackSample(phase) : undefined,
      }}
      viewport={viewport}
      setViewport={setViewport}
      inputMode="always"
      testId="path-three-puppet"
      cameraPresets={[pathViewMode === "2d" ? "front" : "iso"]}
      initialCameraPreset={pathViewMode === "2d" ? "front" : "iso"}
      showCameraPresets={false}
      drawMode={pathViewMode === "2d" && drawMode && !pathLocked}
      onDrawPoint={onDrawPoint}
      onDrawEnd={onDrawEnd}
      onSelectPathPoint={pathLocked ? undefined : onPathPointPick}
      onMovePathPoint={pathLocked ? undefined : onPathPointMove}
      onEndPathPointEdit={onPathPointEnd}
      pathGestureDraft={pathGestureDraft}
      onSelectPart={(partId) => dispatch({ type: "select_part", partId })}
      onSelectSceneObject={(objectId) =>
        dispatch({ type: "select_scene_object", objectId })
      }
      onSelectJoint={onJointPick}
    />
  </div>;
};

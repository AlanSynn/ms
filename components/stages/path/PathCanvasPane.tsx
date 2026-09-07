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

const E2E_DIAGNOSTICS = typeof __MOTIONSMITH_E2E_DIAGNOSTICS__ === "boolean"
  ? __MOTIONSMITH_E2E_DIAGNOSTICS__
  : false;

interface PathCanvasPaneProps {
  project: ProjectState;
  motionPaths: ProjectMotionPath[];
  selectedPath?: ProjectMotionPath;
  selectedPoint: number | null;
  onDrawPoint: (point: Point) => void;
  onDrawEnd: () => void;
  onGestureCancel: () => void;
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
  motionPaths,
  selectedPath,
  selectedPoint,
  onDrawPoint,
  onDrawEnd,
  onGestureCancel,
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
    () => motionPaths.filter((path) => path.visible),
    [motionPaths],
  );

  return <div
    className="path-canvas-shell canvas-workspace overflow-hidden p-0"
    data-path-held-phase={E2E_DIAGNOSTICS && !isPlaying ? angle : undefined}
  >
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
        sample: playbackSample,
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
      onDrawCancel={onGestureCancel}
      onSelectPathPoint={pathLocked ? undefined : onPathPointPick}
      onMovePathPoint={pathLocked ? undefined : onPathPointMove}
      onEndPathPointEdit={onPathPointEnd}
      onCancelPathPointEdit={onGestureCancel}
      pathGestureDraft={pathGestureDraft}
      onSelectPart={pathLocked ? undefined : (partId) => dispatch({ type: "select_part", partId })}
      onSelectSceneObject={pathLocked ? undefined : (objectId) =>
        dispatch({ type: "select_scene_object", objectId })
      }
      onSelectJoint={pathLocked ? undefined : onJointPick}
    />
  </div>;
};

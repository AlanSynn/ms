import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  CanvasViewport,
  Point,
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../../../types";
import {
  clearMotionPathGeometry,
  createMotionPathForTarget,
  describeMotionChain,
  motionAnchorJointIds,
  motionChainRootJointIds,
  motionPathsInProjectOrder,
  motionPreviewForPaths,
  motionTimelineMsForPhase,
  playableMotionPaths,
  sharedMotionPlaybackDurationMs,
} from "../../../utils/motion";
import { addDrawSamplePoint, normalizeDrawTimedPoints, type DrawSamplePoint } from "../../../utils/pathDrawing";
import { PathCanvasPane } from "./PathCanvasPane";
import { PathInspectorPanel } from "./PathInspectorPanel";
import { PathWorkflowPanel } from "./PathWorkflowPanel";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import { createPathGestureDraft } from "../../../runtime/path/pathGestureDraft";
import { capturePathGestureIdentity, pathGestureIdentityMatches, type PathGestureIdentity } from "../../../runtime/path/pathGestureIdentity";
import type { PathTargetKind } from "../../../utils/pathTargets";

export const PathEditor = ({
  project,
  sortedParts,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  drawMode,
  setDrawMode,
  dispatch,
  setPathPoints,
  openTracking,
  isPlaying,
  setIsPlaying,
  angle,
  setAngle,
  playbackClock,
  goStage,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  dispatch: (action: ProjectAction) => void;
  setPathPoints: (
    points: Point[],
    source?: ProjectMotionPath["source"],
    timedPoints?: ProjectMotionPath["timedPoints"],
    pathId?: string,
  ) => void;
  openTracking: () => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  angle: number;
  setAngle: React.Dispatch<React.SetStateAction<number>>;
  playbackClock: PlaybackClock;
  goStage: (stage: AppStage) => void;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
  const pathGestureDraft = useMemo(() => createPathGestureDraft(), []);
  const freeDraftRef = useRef<DrawSamplePoint[] | null>(null);
  const pointDragDraftRef = useRef<Point[] | null>(null);
  const pointDragDirtyRef = useRef(false);
  const gestureIdentityRef = useRef<PathGestureIdentity | undefined>(undefined);
  const gestureCancelledRef = useRef(false);
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isFreeDrawing, setIsFreeDrawing] = useState(false);
  const [clearedPath, setClearedPath] = useState<ProjectMotionPath | null>(null);
  const [pathViewMode, setPathViewMode] = useState<"2d" | "3d">("3d");
  const pathLocked = Boolean(selectedSceneObject?.locked ?? selectedPart?.locked);
  const targetKind: PathTargetKind = selectedSceneObject ? "scene-object" : "part";
  const targetId = selectedSceneObject?.id ?? selectedPart?.id;
  const gestureMatches = () => !gestureCancelledRef.current && pathGestureIdentityMatches(
    gestureIdentityRef.current, project, targetKind, targetId, selectedPath,
  );
  const cancelGesture = (finished = false) => {
    gestureCancelledRef.current = !finished;
    if (finished) gestureIdentityRef.current = undefined;
    freeDraftRef.current = null;
    pointDragDraftRef.current = null;
    pointDragDirtyRef.current = false;
    pathGestureDraft.clear();
    setIsFreeDrawing(false);
    setDragPoint(null);
    setDrawMode(false);
  };
  const pointCount = selectedPath?.points.length ?? 0;
  const jointOptions = selectedPart
    ? motionAnchorJointIds(project, selectedPart.id)
    : [];
  const ikDescriptor = selectedPart
    ? describeMotionChain(project, selectedPart.id, selectedPath?.targetAnchorJointId, {
        rootJointId: selectedPath?.chainRootJointId,
      })
    : undefined;
  const selectedIkJointId = ikDescriptor?.targetJointId;
  const selectedChainRootId = ikDescriptor?.rootJointId;
  const chainRootOptions = selectedPart
    ? motionChainRootJointIds(project, selectedPart.id, selectedIkJointId)
    : [];
  const bendJoint = ikDescriptor?.canFold && ikDescriptor.foldJointId
    ? project.skeleton?.joints[ikDescriptor.foldJointId]
    : undefined;
  const jointLabel = (id?: string) =>
    id ? (project.skeleton?.joints[id]?.name || id).replaceAll("_", " ") : "none";
  useEffect(() => () => pathGestureDraft.dispose(), [pathGestureDraft]);
  useEffect(() => {
    if (gestureIdentityRef.current && !gestureMatches()) cancelGesture();
  }, [project, selectedPath, selectedPart?.id, selectedSceneObject?.id]);
  useEffect(() => {
    freeDraftRef.current = null;
    pointDragDraftRef.current = null;
    pointDragDirtyRef.current = false;
    pathGestureDraft.clear();
    setIsFreeDrawing(false);
    setDragPoint(null);
    setSelectedPoint(null);
  }, [pathGestureDraft, selectedPart?.id, selectedPath?.id, selectedSceneObject?.id]);
  useEffect(() => {
    if (pathGestureDraft.getSnapshot()) pathGestureDraft.clear();
  }, [pathGestureDraft, selectedPath?.points]);
  const publishPathDraft = (
    points: Point[],
    selectedPointIndex: number | null,
    force = false,
  ) => {
    const identity = gestureIdentityRef.current;
    if (!identity || !gestureMatches()) return;
    pathGestureDraft.publish(
      {
        pathId: identity.path?.id ?? `path-${identity.targetId}`,
        points,
        closed: selectedPath?.closed ?? true,
        selectedPointIndex,
      },
      force,
    );
  };
  const appendFreePoint = (point: Point, seed = false) => {
    if (seed) setClearedPath(null);
    const next = addDrawSamplePoint(
      freeDraftRef.current,
      point,
      performance.now(),
      seed,
    );
    if (next === freeDraftRef.current) return;
    freeDraftRef.current = next;
    publishPathDraft(
      next.map(({ x, y }) => ({ x, y })),
      null,
      seed,
    );
  };
  const onDrawPoint = (point: Point) => {
    if (!drawMode || pathLocked || gestureCancelledRef.current) return;
    if (!gestureIdentityRef.current) {
      gestureIdentityRef.current = capturePathGestureIdentity(project, targetKind, targetId, selectedPath);
    }
    if (!gestureMatches()) return;
    const seed = !freeDraftRef.current?.length;
    if (seed) {
      setIsFreeDrawing(true);
    }
    appendFreePoint(point, seed);
  };
  const updatePath = (updates: Partial<ProjectMotionPath>) =>
    selectedPath &&
    !pathLocked &&
    dispatch({ type: "upsert_path", path: { ...selectedPath, ...updates } });
  const updateChainRoot = (chainRootJointId: string) =>
    updatePath({ chainRootJointId });
  const updateIkHandle = (targetAnchorJointId: string) => {
    if (!selectedPart) return;
    const roots = motionChainRootJointIds(
      project,
      selectedPart.id,
      targetAnchorJointId,
    );
    const descriptor = describeMotionChain(project, selectedPart.id, targetAnchorJointId, {
      rootJointId: selectedPath?.chainRootJointId && roots.includes(selectedPath.chainRootJointId)
        ? selectedPath.chainRootJointId : undefined,
    });
    updatePath({
      targetAnchorJointId: descriptor.targetJointId,
      chainRootJointId: descriptor.rootJointId,
    });
  };
  const resetMotionJoints = () => {
    if (!selectedPart) return;
    const descriptor = describeMotionChain(project, selectedPart.id);
    updatePath({
      targetAnchorJointId: descriptor.targetJointId,
      chainRootJointId: descriptor.rootJointId,
    });
  };
  const pickIkJoint = (jointId: string) => {
    if (!selectedPath || !selectedPart || pathLocked) return;
    if (
      selectedIkJointId &&
      jointId !== selectedIkJointId &&
      chainRootOptions.includes(jointId)
    )
      updateChainRoot(jointId);
    else updateIkHandle(jointId);
  };
  const setBendDirection = (bendDirection: number) =>
    bendJoint &&
    !bendJoint.locked &&
    !pathLocked &&
    dispatch({
      type: "update_joint",
      jointId: bendJoint.id,
      updates: { bendDirection },
    });
  const movePoint = (point: Point) => {
    if (!gestureMatches()) return;
    if (isFreeDrawing && !pathLocked) {
      appendFreePoint(point);
      return;
    }
    if (dragPoint === null || !selectedPath || pathLocked)
      return;
    const points = [...(pointDragDraftRef.current ?? selectedPath.points)];
    points[dragPoint] = point;
    pointDragDraftRef.current = points;
    pointDragDirtyRef.current = true;
    publishPathDraft(points, dragPoint);
  };
  const pickPathPoint = (pathId: string, pointIndex: number) => {
    if (pathLocked || selectedPath?.id !== pathId) return;
    gestureCancelledRef.current = false;
    gestureIdentityRef.current = capturePathGestureIdentity(project, targetKind, targetId, selectedPath);
    if (!gestureMatches()) return;
    setSelectedPoint(pointIndex);
    setDragPoint(pointIndex);
    pointDragDraftRef.current = [...selectedPath.points];
    pointDragDirtyRef.current = false;
    publishPathDraft(pointDragDraftRef.current, pointIndex, true);
  };
  const stopPointEdit = () => {
    const identity = gestureIdentityRef.current;
    const valid = gestureMatches();
    const points = pointDragDraftRef.current;
    const dirty = pointDragDirtyRef.current;
    pointDragDraftRef.current = null;
    pointDragDirtyRef.current = false;
    gestureIdentityRef.current = undefined;
    gestureCancelledRef.current = false;
    setDragPoint(null);
    if (!valid || !dirty || !points || !identity?.path) {
      pathGestureDraft.clear();
      return;
    }
    pathGestureDraft.flush();
    setPathPoints(points, identity.path.source, undefined, identity.path.id);
  };
  const stopDrawing = () => {
    const identity = gestureIdentityRef.current;
    const valid = gestureMatches();
    const freeDraft = freeDraftRef.current;
    const finishedFreeStroke = Boolean(freeDraft?.length);
    setDragPoint(null);
    setIsFreeDrawing(false);
    freeDraftRef.current = null;
    gestureIdentityRef.current = undefined;
    gestureCancelledRef.current = false;
    if (valid && identity && freeDraft?.length) {
      const timed = normalizeDrawTimedPoints(
        freeDraft,
        identity.path?.duration ?? identity.project.settings.animationDurationMs,
        { closed: identity.path?.closed ?? true },
      );
      pathGestureDraft.flush();
      setPathPoints(
        timed.map(({ x, y }) => ({ x, y })),
        "drawn",
        timed,
        identity.path?.id,
      );
    } else {
      pathGestureDraft.clear();
    }
    if (finishedFreeStroke) setDrawMode(false);
  };
  const deletePoint = () => {
    if (selectedPoint === null || !selectedPath || pathLocked) return;
    setPathPoints(
      selectedPath.points.filter((_, i) => i !== selectedPoint),
      selectedPath.source,
      undefined,
      selectedPath.id,
    );
    setSelectedPoint(null);
  };
  const clearPath = () => {
    if (!selectedPath || pathLocked) return;
    setClearedPath({
      ...selectedPath,
      points: selectedPath.points.map((point) => ({ ...point })),
      timedPoints: selectedPath.timedPoints?.map((point) => ({ ...point })),
    });
    dispatch({
      type: "upsert_path",
      path: clearMotionPathGeometry(selectedPath),
    });
  };
  const undoClearPath = () => {
    if (!clearedPath || pathLocked || selectedPath?.id !== clearedPath.id) return;
    dispatch({ type: "upsert_path", path: clearedPath });
    setClearedPath(null);
  };
  const selectMotion = (pathId: string) => {
    setDrawMode(false);
    setSelectedPoint(null);
    dispatch({ type: "select_path", pathId });
  };
  const addMotion = (targetKind: PathTargetKind, targetId: string) => {
    const target = targetKind === "scene-object" ? project.sceneObjects[targetId] : project.parts[targetId];
    if (!target || target.locked) return;
    const path = createMotionPathForTarget(project, targetKind, targetId);
    if (!path) return;
    if (targetKind === "scene-object") {
      dispatch({ type: "select_scene_object", objectId: targetId });
    } else {
      dispatch({ type: "select_part", partId: targetId });
    }
    dispatch({ type: "upsert_path", path });
    setDrawMode(false);
  };
  const switchPathView = (mode: "2d" | "3d") => {
    setPathViewMode(mode);
    if (mode === "3d" && drawMode) {
      stopDrawing();
      setDrawMode(false);
    }
  };
  const togglePathDrawing = () => {
    setPathViewMode("2d");
    if (drawMode) stopDrawing();
    else {
      setSelectedPoint(null);
      if (!gestureIdentityRef.current) gestureCancelledRef.current = false;
    }
    setDrawMode(!drawMode);
  };
  const motionPaths = useMemo(
    () => motionPathsInProjectOrder(project),
    [project.paths, project.pathOrder],
  );
  const activeMotionPaths = useMemo(
    () => playableMotionPaths(project, motionPaths),
    [motionPaths, project],
  );
  const playbackDurationMs = sharedMotionPlaybackDurationMs(
    project,
    activeMotionPaths,
  );
  useEffect(() => {
    playbackClock.setTimelineDuration(playbackDurationMs);
  }, [playbackClock, playbackDurationMs]);
  const previewAngle = angle;
  const pathPreview = activeMotionPaths.length
      ? motionPreviewForPaths(
          project,
          activeMotionPaths,
          playbackClock.getTimelineMs() || motionTimelineMsForPhase(previewAngle, playbackDurationMs),
        )
      : undefined;
  return (
    <EditorStageFrame
      stage="path"
      className="path-stage-frame"
      progressivePanes
      layout={{
        workflow: workflowPane(
          <PathWorkflowPanel
            project={project}
            sortedParts={sortedParts}
            selectedPart={selectedPart}
            selectedSceneObject={selectedSceneObject}
            selectedPath={selectedPath}
            motionPaths={motionPaths}
            drawMode={drawMode}
            pathLocked={pathLocked}
            pointCount={pointCount}
            selectedPoint={selectedPoint}
            isPlaying={isPlaying}
            dispatch={dispatch}
            goStage={goStage}
            togglePathDrawing={togglePathDrawing}
            clearPath={clearPath}
            undoClearPath={undoClearPath}
            canUndoClear={Boolean(clearedPath && selectedPath?.id === clearedPath.id)}
            selectMotion={selectMotion}
            addMotion={addMotion}
            updatePath={updatePath}
            openTracking={openTracking}
            setIsPlaying={playing => {
              if (!playing) {
                playbackClock.stop();
                setAngle(playbackClock.getPhase());
              }
              setIsPlaying(playing);
            }}
            setAngle={setAngle}
            deletePoint={deletePoint}
            playablePathCount={activeMotionPaths.length}
          />,
        ),
        canvas: canvasPane(
          <PathCanvasPane
            project={project}
            motionPaths={motionPaths}
            selectedPath={selectedPath}
            selectedPoint={selectedPoint}
            onDrawPoint={onDrawPoint}
            onDrawEnd={stopDrawing}
            onGestureCancel={() => cancelGesture(true)}
            onPathPointPick={pickPathPoint}
            onPathPointMove={movePoint}
            onPathPointEnd={stopPointEdit}
            onJointPick={pickIkJoint}
            dispatch={dispatch}
            drawMode={drawMode}
            pathLocked={pathLocked}
            isPlaying={isPlaying}
            angle={angle}
            playbackClock={playbackClock}
            playbackSample={(phase) =>
              activeMotionPaths.length
                ? motionPreviewForPaths(
                    project,
                    activeMotionPaths,
                    playbackClock.getTimelineMs() ||
                      motionTimelineMsForPhase(phase, playbackDurationMs),
                  )
                : undefined
            }
            viewport={viewport}
            setViewport={setViewport}
            pathViewMode={pathViewMode}
            switchPathView={switchPathView}
            pathPreview={pathPreview}
            pathGestureDraft={pathGestureDraft}
          />,
        ),
        inspector: inspectorPane(
          <PathInspectorPanel
            project={project}
            selectedPartId={selectedPart?.id}
            selectedPartName={selectedSceneObject?.name ?? selectedPart?.name}
            selectedSceneObjectId={selectedSceneObject?.id}
            selectedPath={selectedPath}
            pointCount={pointCount}
            selectedPoint={selectedPoint}
            pathLocked={pathLocked}
            selectedChainRootId={selectedChainRootId}
            chainRootOptions={chainRootOptions}
            selectedIkJointId={selectedIkJointId}
            jointOptions={jointOptions}
            ikDescriptor={ikDescriptor}
            bendJoint={bendJoint}
            jointLabel={jointLabel}
            updateChainRoot={updateChainRoot}
            updateIkHandle={updateIkHandle}
            motionWarning={selectedPath ? pathPreview?.warnings?.[selectedPath.id]?.[0]?.replace("Move target", "Move path") : undefined}
            resetMotionJoints={resetMotionJoints}
            setBendDirection={setBendDirection}
          />,
        ),
      }}
    />
  );
};

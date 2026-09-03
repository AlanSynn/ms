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
  motionChainOptionLabel,
  motionChainRootJointIds,
  motionPathsInProjectOrder,
  motionPreviewForPaths,
  motionTimelineMsForPhase,
  playableMotionPaths,
  preferredMotionJointId,
  sharedMotionPlaybackDurationMs,
} from "../../../utils/motion";
import { addDrawSamplePoint, normalizeDrawTimedPoints, type DrawSamplePoint } from "../../../utils/pathDrawing";
import { PathCanvasPane } from "./PathCanvasPane";
import { PathInspectorPanel } from "./PathInspectorPanel";
import { PathWorkflowPanel } from "./PathWorkflowPanel";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import { createPathGestureDraft } from "../../../runtime/path/pathGestureDraft";

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
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isFreeDrawing, setIsFreeDrawing] = useState(false);
  const [clearedPath, setClearedPath] = useState<ProjectMotionPath | null>(null);
  const [pathViewMode, setPathViewMode] = useState<"2d" | "3d">("3d");
  const pathLocked = Boolean(selectedSceneObject?.locked ?? selectedPart?.locked);
  const pointCount = selectedPath?.points.length ?? 0;
  const jointOptions = selectedPart
    ? motionAnchorJointIds(project, selectedPart.id)
    : [];
  const selectedIkJointId = selectedPart
    ? preferredMotionJointId(
        project,
        selectedPart.id,
        selectedPath?.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId },
      )
    : undefined;
  const chainRootOptions = selectedPart
    ? motionChainRootJointIds(project, selectedPart.id, selectedIkJointId)
    : [];
  const selectedChainRootId =
    selectedPath?.chainRootJointId &&
    chainRootOptions.includes(selectedPath.chainRootJointId)
      ? selectedPath.chainRootJointId
      : selectedPart?.anchorJointId;
  const ikDescriptor = selectedPart
    ? describeMotionChain(project, selectedPart.id, selectedIkJointId, {
        rootJointId: selectedChainRootId,
      })
    : undefined;
  const bendJoint = ikDescriptor?.foldJointId
    ? project.skeleton?.joints[ikDescriptor.foldJointId]
    : undefined;
  const jointLabel = (id?: string) => (id ? id.replaceAll("_", " ") : "none");
  useEffect(() => () => pathGestureDraft.dispose(), [pathGestureDraft]);
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
    const targetId = selectedSceneObject?.id ?? selectedPart?.id;
    if (!targetId) return;
    pathGestureDraft.publish(
      {
        pathId: selectedPath?.id ?? `path-${targetId}`,
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
    if (!drawMode || pathLocked) return;
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
    updatePath({
      targetAnchorJointId,
      chainRootJointId:
        selectedPath?.chainRootJointId &&
        roots.includes(selectedPath.chainRootJointId)
          ? selectedPath.chainRootJointId
          : selectedPart.anchorJointId,
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
    dispatch({
      type: "update_joint",
      jointId: bendJoint.id,
      updates: { bendDirection },
    });
  const movePoint = (point: Point) => {
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
    setSelectedPoint(pointIndex);
    setDragPoint(pointIndex);
    pointDragDraftRef.current = [...selectedPath.points];
    pointDragDirtyRef.current = false;
    publishPathDraft(pointDragDraftRef.current, pointIndex, true);
  };
  const stopPointEdit = () => {
    const points = pointDragDraftRef.current;
    const dirty = pointDragDirtyRef.current;
    pointDragDraftRef.current = null;
    pointDragDirtyRef.current = false;
    setDragPoint(null);
    if (!dirty || !points || !selectedPath) {
      pathGestureDraft.clear();
      return;
    }
    pathGestureDraft.flush();
    setPathPoints(points, selectedPath.source, undefined, selectedPath.id);
  };
  const stopDrawing = () => {
    const freeDraft = freeDraftRef.current;
    const finishedFreeStroke = Boolean(freeDraft?.length);
    setDragPoint(null);
    setIsFreeDrawing(false);
    freeDraftRef.current = null;
    if (freeDraft?.length) {
      const timed = normalizeDrawTimedPoints(
        freeDraft,
        selectedPath?.duration ?? project.settings.animationDurationMs,
        { closed: selectedPath?.closed ?? true },
      );
      pathGestureDraft.flush();
      setPathPoints(
        timed.map(({ x, y }) => ({ x, y })),
        "drawn",
        timed,
        selectedPath?.id,
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
  const addMotion = () => {
    const targetId = selectedSceneObject?.id ?? selectedPart?.id;
    if (!targetId || pathLocked) return;
    const targetKind = selectedSceneObject ? "scene-object" : "part";
    const path = createMotionPathForTarget(project, targetKind, targetId);
    if (!path) return;
    if (targetKind === "scene-object") {
      dispatch({ type: "select_scene_object", objectId: targetId });
    } else {
      dispatch({ type: "select_part", partId: targetId });
    }
    dispatch({ type: "upsert_path", path });
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
    else setSelectedPoint(null);
    setDrawMode(!drawMode);
  };
  const motionPaths = useMemo(
    () => motionPathsInProjectOrder(project),
    [project.paths],
  );
  const activeMotionPaths = useMemo(
    () => playableMotionPaths(project, motionPaths),
    [motionPaths, project.parts, project.sceneObjects],
  );
  const playbackDurationMs = sharedMotionPlaybackDurationMs(
    project,
    activeMotionPaths,
  );
  useEffect(() => {
    playbackClock.setTimelineDuration(playbackDurationMs);
  }, [playbackClock, playbackDurationMs]);
  const previewAngle = isPlaying ? angle : 0;
  const pathPreview = activeMotionPaths.length
      ? motionPreviewForPaths(
          project,
          activeMotionPaths,
          motionTimelineMsForPhase(previewAngle, playbackDurationMs),
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
            setIsPlaying={setIsPlaying}
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
            setBendDirection={setBendDirection}
          />,
        ),
      }}
    />
  );
};

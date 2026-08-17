import React, { useEffect, useRef, useState } from "react";
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
  describeMotionChain,
  motionAnchorJointIds,
  motionChainOptionLabel,
  motionChainRootJointIds,
  motionPreviewForPath,
  preferredMotionJointId,
} from "../../../utils/motion";
import { addDrawSamplePoint, normalizeDrawTimedPoints, type DrawSamplePoint } from "../../../utils/pathDrawing";
import { PathCanvasPane } from "./PathCanvasPane";
import { PathInspectorPanel } from "./PathInspectorPanel";
import { PathWorkflowPanel } from "./PathWorkflowPanel";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

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
  const freeDraftRef = useRef<DrawSamplePoint[] | null>(null);
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isFreeDrawing, setIsFreeDrawing] = useState(false);
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
  useEffect(() => {
    freeDraftRef.current = null;
    setIsFreeDrawing(false);
    setDragPoint(null);
    setSelectedPoint(null);
  }, [selectedPart?.id, selectedSceneObject?.id]);
  const appendFreePoint = (point: Point, seed = false) => {
    const next = addDrawSamplePoint(
      freeDraftRef.current,
      point,
      performance.now(),
      seed,
    );
    if (next === freeDraftRef.current) return;
    const timed = normalizeDrawTimedPoints(
      next,
      selectedPath?.duration ?? project.settings.animationDurationMs,
      { closed: selectedPath?.closed ?? true },
    );
    freeDraftRef.current = next;
    setPathPoints(
      timed.map(({ x, y }) => ({ x, y })),
      "drawn",
      timed,
    );
  };
  const onDrawPoint = (point: Point) => {
    if (!drawMode || pathLocked) return;
    const seed = !freeDraftRef.current?.length;
    if (seed) {
      setSelectedPoint(null);
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
    const points = [...selectedPath.points];
    points[dragPoint] = point;
    setPathPoints(points, selectedPath.source);
  };
  const pickPathPoint = (pathId: string, pointIndex: number) => {
    if (pathLocked || selectedPath?.id !== pathId) return;
    setSelectedPoint(pointIndex);
    setDragPoint(pointIndex);
  };
  const stopPointEdit = () => setDragPoint(null);
  const stopDrawing = () => {
    const finishedFreeStroke = Boolean(freeDraftRef.current?.length);
    setDragPoint(null);
    setIsFreeDrawing(false);
    freeDraftRef.current = null;
    if (finishedFreeStroke) setDrawMode(false);
  };
  const deletePoint = () => {
    if (selectedPoint === null || !selectedPath || pathLocked) return;
    setPathPoints(
      selectedPath.points.filter((_, i) => i !== selectedPoint),
      selectedPath.source,
    );
    setSelectedPoint(null);
  };
  const clearPath = () =>
    selectedPath &&
    !pathLocked &&
    dispatch({ type: "delete_path", pathId: selectedPath.id });
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
    setDrawMode(!drawMode);
  };
  const pathMechanism = selectedPath
    ? project.mechanisms.find(
        (m) =>
          m.targetPathId === selectedPath.id &&
          (selectedPath.sceneObjectId
            ? m.targetSceneObjectId === selectedPath.sceneObjectId
            : m.targetPartId === selectedPath.partId),
      )
    : undefined;
  const previewTargetJointId = selectedPath
    && !selectedPath.sceneObjectId
    ? preferredMotionJointId(
        project,
        selectedPath.partId,
        pathMechanism?.targetAnchorJointId ?? selectedPath.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath.targetAnchorJointId },
      )
    : undefined;
  const previewAngle = isPlaying ? angle : 0;
  const pathPreview =
    selectedPath?.visible &&
    selectedPath.enabled &&
    selectedPath.points.length > 1
      ? motionPreviewForPath(
          project,
          selectedPath,
          previewAngle,
          previewTargetJointId,
        )
      : undefined;
  return (
    <EditorStageFrame
      stage="path"
      className="path-stage-frame"
      layout={{
        workflow: workflowPane(
          <PathWorkflowPanel
            project={project}
            sortedParts={sortedParts}
            selectedPart={selectedPart}
            selectedSceneObject={selectedSceneObject}
            selectedPath={selectedPath}
            drawMode={drawMode}
            pathLocked={pathLocked}
            pointCount={pointCount}
            selectedPoint={selectedPoint}
            isPlaying={isPlaying}
            dispatch={dispatch}
            goStage={goStage}
            togglePathDrawing={togglePathDrawing}
            clearPath={clearPath}
            updatePath={updatePath}
            openTracking={openTracking}
            setIsPlaying={setIsPlaying}
            setAngle={setAngle}
            deletePoint={deletePoint}
          />,
        ),
        canvas: canvasPane(
          <PathCanvasPane
            project={project}
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
              selectedPath?.visible &&
              selectedPath.enabled &&
              selectedPath.points.length > 1
                ? motionPreviewForPath(
                    project,
                    selectedPath,
                    phase,
                    previewTargetJointId,
                  )
                : undefined
            }
            viewport={viewport}
            setViewport={setViewport}
            pathViewMode={pathViewMode}
            switchPathView={switchPathView}
            pathPreview={pathPreview}
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

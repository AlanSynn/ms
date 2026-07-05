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
} from "../../../types";
import { svgPointerToScene } from "../../../utils/coordinates";
import {
  describeMotionChain,
  motionAnchorJointIds,
  motionChainOptionLabel,
  motionChainRootJointIds,
  motionPreviewForPath,
  preferredMotionJointId,
} from "../../../utils/motion";
import { uid } from "../../../utils/project";
import { PathCanvasPane } from "./PathCanvasPane";
import { PathInspectorPanel } from "./PathInspectorPanel";
import { PathWorkflowPanel } from "./PathWorkflowPanel";

export const PathEditor = ({
  project,
  sortedParts,
  selectedPart,
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
  goStage,
  viewport,
  setViewport,
}: {
  project: ProjectState;
  sortedParts: BodyPartLayer[];
  selectedPart?: BodyPartLayer;
  selectedPath?: ProjectMotionPath;
  drawMode: boolean;
  setDrawMode: (v: boolean) => void;
  dispatch: (action: ProjectAction) => void;
  setPathPoints: (
    points: Point[],
    source?: ProjectMotionPath["source"],
  ) => void;
  openTracking: () => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  angle: number;
  setAngle: React.Dispatch<React.SetStateAction<number>>;
  goStage: (stage: AppStage) => void;
  viewport: CanvasViewport;
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const freeDraftRef = useRef<Point[] | null>(null);
  const [dragPoint, setDragPoint] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [isFreeDrawing, setIsFreeDrawing] = useState(false);
  const [pathViewMode, setPathViewMode] = useState<"2d" | "3d">("3d");
  const pathLocked = Boolean(selectedPart?.locked);
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
  }, [selectedPart?.id]);
  const appendFreePoint = (point: Point, seed = false) => {
    const base =
      seed || !freeDraftRef.current
        ? [...(selectedPath?.points ?? [])]
        : freeDraftRef.current;
    const last = base.at(-1);
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 5) return;
    const next = [...base, point].slice(-2000);
    freeDraftRef.current = next;
    setPathPoints(next, "drawn");
  };
  const onCanvasDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawMode || !svgRef.current || pathLocked || e.button !== 0) return;
    const p = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
    setSelectedPoint(null);
    setIsFreeDrawing(true);
    appendFreePoint(p, true);
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
  const addJointAtIkHandle = () => {
    if (!project.skeleton || !selectedPart || !selectedIkJointId) return;
    const parent = project.skeleton.joints[selectedIkJointId];
    if (!parent) return;
    const id = uid("joint");
    dispatch({
      type: "add_joint",
      joint: {
        id,
        name: "Motion handle",
        position: { x: parent.position.x + 34, y: parent.position.y - 34 },
        parentId: parent.id,
        locked: false,
        bendDirection: 1,
      },
    });
    if (selectedPath && !pathLocked)
      dispatch({
        type: "upsert_path",
        path: { ...selectedPath, targetAnchorJointId: id },
      });
  };
  const movePoint = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isFreeDrawing && svgRef.current && !pathLocked) {
      appendFreePoint(svgPointerToScene(svgRef.current, e.clientX, e.clientY));
      return;
    }
    if (dragPoint === null || !svgRef.current || !selectedPath || pathLocked)
      return;
    const points = [...selectedPath.points];
    points[dragPoint] = svgPointerToScene(svgRef.current, e.clientX, e.clientY);
    setPathPoints(points, selectedPath.source);
  };
  const stopDrawing = () => {
    setDragPoint(null);
    setIsFreeDrawing(false);
    freeDraftRef.current = null;
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
  const addLayer = () => {
    const base = selectedPart;
    const id = uid("part");
    const anchorJointId =
      base?.anchorJointId ??
      project.skeleton?.rootJointIds[0] ??
      Object.keys(project.skeleton?.joints ?? {})[0] ??
      "root";
    dispatch({
      type: "upsert_part",
      part: base
        ? {
            ...base,
            id,
            name: `${base.name} copy`,
            transform: {
              ...base.transform,
              x: base.transform.x + 24,
              y: base.transform.y - 24,
            },
            zIndex: Math.max(0, ...sortedParts.map((p) => p.zIndex)) + 1,
          }
        : {
            id,
            name: "New layer",
            anchorJointId,
            transform: { x: 0, y: 0, rotation: 0, scale: 1 },
            zIndex: sortedParts.length,
            opacity: 0.9,
            visible: true,
            locked: false,
            selectable: true,
            bounds: { x: -40, y: -40, width: 80, height: 80 },
            fillColor: "#64748b",
          },
    });
  };
  const pathMechanism = selectedPath
    ? project.mechanisms.find(
        (m) =>
          m.targetPathId === selectedPath.id &&
          m.targetPartId === selectedPath.partId,
      )
    : undefined;
  const previewTargetJointId = selectedPath
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
            addLayer={addLayer}
            addJointAtIkHandle={addJointAtIkHandle}
          />,
        ),
        canvas: canvasPane(
          <PathCanvasPane
            svgRef={svgRef}
            project={project}
            selectedPath={selectedPath}
            dragPoint={dragPoint}
            selectedPoint={selectedPoint}
            setDragPoint={setDragPoint}
            setSelectedPoint={setSelectedPoint}
            onPointMove={movePoint}
            onPointUp={stopDrawing}
            onCanvasDown={onCanvasDown}
            onJointPick={pickIkJoint}
            dispatch={dispatch}
            drawMode={drawMode}
            pathLocked={pathLocked}
            isPlaying={isPlaying}
            angle={angle}
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
            selectedPartName={selectedPart?.name}
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

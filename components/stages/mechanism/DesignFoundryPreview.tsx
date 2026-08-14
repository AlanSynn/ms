import React, { useMemo, useRef, useState } from "react";
import type {
  MechanismConfig,
  MechanismEditFeedback,
  Point,
  ProjectAction,
  ProjectState,
} from "../../../types";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  projectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import { useFrameCommitSession } from "../../../hooks/useFrameCommitSession";
import {
  prepareAutomataSceneModel,
  samplePreparedAutomataSceneModel,
} from "../../../utils/automataSceneModel";
import { pointsToSvgPath } from "../../../utils/mechanismPreview";
import {
  connectionSelectionSceneCoordinates,
  connectionSelectionSignature,
} from "../../../utils/mechanismConnectionSelections";
import { ThreeFoundryPreview } from "../foundry/ThreeFoundryPreview";
import {
  MechanismConnectionOverlay,
  projectMechanismConnectionHoleHandles,
  useMechanismConnectionDrag,
} from "./MechanismConnectionOverlay";

type DesignFoundryPreviewProps = {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  setIsPlaying: (v: boolean) => void;
  showTrace: boolean;
  dispatch: (action: ProjectAction) => void;
  updateMechanism: (
    id: string,
    updates: Partial<MechanismConfig>,
  ) => boolean | void;
  mechanismEditFeedback?: MechanismEditFeedback | null;
};

const noPoint = { x: 0, y: 0 };
type ViewerTool = "move" | "rotate" | "zoom";

const cameraLabel = (camera: FoundryCamera) =>
  camera.preset === "custom"
    ? "Custom view"
    : FOUNDRY_VIEW_PRESETS[camera.preset].label;

export const DesignFoundryPreview = ({
  project,
  mechanism,
  angle,
  setIsPlaying,
  showTrace,
  dispatch,
  updateMechanism,
  mechanismEditFeedback,
}: DesignFoundryPreviewProps) => {
  const [showGrid, setShowGrid] = useState(true);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showMechanismPathPreview, setShowMechanismPathPreview] = useState(true);
  const [viewerTool, setViewerTool] = useState<ViewerTool>("rotate");
  const [camera, setCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [projectionSize, setProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const orbitStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    zoom: number;
    pan: Point;
    mode: "orbit" | "zoom" | "pan";
  } | null>(null);
  const cameraFrameSession = useFrameCommitSession<FoundryCamera>(setCamera);

  const preparedSceneModel = useMemo(
    () => prepareAutomataSceneModel(project, mechanism, "design-live"),
    [mechanism, project],
  );
  const sceneModel = useMemo(
    () => samplePreparedAutomataSceneModel(preparedSceneModel, angle),
    [angle, preparedSceneModel],
  );
  const previewMechanism = sceneModel.mechanism ?? sceneModel.recoveryMechanism;
  const automataContext = useMemo(
    () =>
      sceneModel.mechanism
        ? {
            project,
            animatedParts: sceneModel.animatedParts,
            animatedSceneObjects: sceneModel.animatedSceneObjects,
            skeleton: sceneModel.skeleton,
            paths: [],
            showCharacter: true,
            showSkeleton: false,
          }
        : undefined,
    [project, sceneModel],
  );
  const showUserPath = showTrace && showUserPathPreview;
  const showMechanismPath = showTrace && showMechanismPathPreview;
  const connectionHoleHandles = useMemo(() => {
    if (!previewMechanism || !sceneModel.foundryPreview || !sceneModel.mechanismContract)
      return [];
    const layers = sceneModel.mechanismContract.renderPlan.layers;
    return projectMechanismConnectionHoleHandles({
      mechanism: sceneModel.foundryPreview.mechanism,
      state: sceneModel.foundryPreview.physicalSimulation.state,
      kit: project.settings.physicalKit,
      camera,
      projectionSize,
      layers,
      renderedLayerZ: layers.map((layer) => layer.z),
    });
  }, [camera, previewMechanism, projectionSize, project.settings.physicalKit, sceneModel]);
  const connectionMechanism = sceneModel.foundryPreview?.mechanism;
  const connectionInteraction = useMechanismConnectionDrag({
    mechanism: connectionMechanism,
    handles: connectionHoleHandles,
    projectionSize,
    kit: project.settings.physicalKit,
    disabled: !connectionMechanism || Boolean(sceneModel.recoveryMechanism),
    onCommit: (updates) => {
      return connectionMechanism
        ? updateMechanism(connectionMechanism.id, updates)
        : false;
    },
    onInteractionStart: () => setIsPlaying(false),
  });
  const selectedConnectionHandle =
    connectionInteraction.selectedHandle ??
    connectionHoleHandles.find((handle) => handle.selected) ??
    connectionHoleHandles.find((handle) => handle.provisional);
  const connectionCoordinates = sceneModel.foundryPreview
    ? connectionSelectionSceneCoordinates(
        sceneModel.foundryPreview.mechanism,
        sceneModel.foundryPreview.physicalSimulation.state,
        sceneModel.foundryPreview.mechanism.connectionSelections,
        project.settings.physicalKit,
      )
    : {};
  const connectionExportSignature = connectionSelectionSignature(
    sceneModel.mechanismContract?.renderPlan.connectionSelectionSummary
      ?.connectionSelections ?? {},
  );
  const matchingEditFeedback =
    mechanismEditFeedback && mechanismEditFeedback.mechanismId === previewMechanism?.id
      ? mechanismEditFeedback
      : null;
  const editBlocker = matchingEditFeedback?.blocker ?? sceneModel.mechanismContract?.runtimeBlocker;
  const userPathD = useMemo(() => {
    if (!showUserPath || !sceneModel.foundryPreview?.userPathPoints.length) return "";
    const projected = sceneModel.foundryPreview.userPathPoints
      .map((point) => projectFoundryOverlayPoint(point, camera, projectionSize, 0.08))
      .filter((point): point is Point => Boolean(point));
    return projected.length >= 2 ? pointsToSvgPath(projected) : "";
  }, [camera, sceneModel.foundryPreview?.userPathPoints, projectionSize, showUserPath]);

  const updateProjectionSize = (size: FoundryOverlaySize) =>
    setProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );

  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) => {
    cameraFrameSession.reset();
    setCamera({ ...FOUNDRY_VIEW_PRESETS[preset], preset, pan: { x: 0, y: 0 } });
  };

  const resetCamera = () => setCameraPreset("iso");

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode: "orbit" | "zoom" | "pan" =
      event.shiftKey || event.button === 1
        ? "pan"
        : event.altKey || event.button === 2
          ? "zoom"
          : viewerTool === "move"
            ? "pan"
            : viewerTool === "zoom"
              ? "zoom"
              : "orbit";
    orbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: camera.zoom,
      pan: camera.pan ?? noPoint,
      mode,
    };
    cameraFrameSession.start();
    setIsOrbiting(mode === "orbit");
    setIsZooming(mode === "zoom");
    setIsPanning(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    const start = orbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    cameraFrameSession.move((() => {
      if (start.mode === "zoom")
        return {
          yaw: start.yaw,
          pitch: start.pitch,
          zoom: clampFoundryZoom(start.zoom * (1 - dy * 0.006)),
          preset: "custom",
          pan: start.pan,
        };
      if (start.mode === "pan")
        return {
          yaw: start.yaw,
          pitch: start.pitch,
          zoom: start.zoom,
          pan: { x: start.pan.x - dx * 0.018, y: start.pan.y + dy * 0.018 },
          preset: "custom",
        };
      return {
        yaw: start.yaw + dx * 0.38,
        pitch: clampFoundryPitch(start.pitch + dy * 0.28),
        zoom: start.zoom,
        preset: "custom",
        pan: start.pan,
      };
    })());
  };

  const finishPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (orbitStartRef.current?.pointerId !== event.pointerId) return;
    cameraFrameSession.finish();
    orbitStartRef.current = null;
    setIsOrbiting(false);
    setIsZooming(false);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };

  if (!previewMechanism || !sceneModel.foundryPreview || !sceneModel.mechanismContract) {
    return (
      <div className="blueprint-empty-state" data-testid="design-shared-foundry-empty">
        Add a mechanism.
      </div>
    );
  }

  const targetError = sceneModel.targetError;
  const target = sceneModel.target;
  const physicsOverlay = sceneModel.foundryPreview.physicsOverlay;

  return (
    <section
      className="design-automata-preview canvas-workspace"
      data-testid="design-shared-foundry-preview"
      data-renderer-source="ThreeFoundryPreview"
      data-shared-with="foundry-renderer"
      data-design-scene-mode="single-foundry-automata-scene"
      data-automata-model-source="prepareAutomataSceneModel/samplePreparedAutomataSceneModel"
      data-mechanism-id={previewMechanism.id}
      data-mechanism-type={previewMechanism.type}
      data-recovery-mode={sceneModel.recoveryMechanism ? "static" : "bound"}
      data-foundry-feature-label={sceneModel.featureLabel ?? ""}
      data-foundry-feature-issue-count={sceneModel.featureIssues.length}
      data-guided-context-mode="single-scene-automata"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={sceneModel.userPath ? 1 : 0}
      data-guided-context-path-id={sceneModel.userPath?.id ?? ""}
      data-user-path-preview={showUserPath ? "shown" : "hidden"}
      data-mechanism-path-preview={showMechanismPath ? "shown" : "hidden"}
      data-design-motion-source={sceneModel.motionSource}
      data-design-generated-path-count={sceneModel.mechanism?.generatedPath?.length ?? 0}
      data-design-path-fit-status={sceneModel.pathFitStatus}
      data-design-path-fit-error={
        sceneModel.pathFitError === undefined ? "unmeasured" : sceneModel.pathFitError.toFixed(3)
      }
      data-design-path-fit-threshold={
        sceneModel.pathFitThreshold === undefined
          ? "unmeasured"
          : sceneModel.pathFitThreshold.toFixed(3)
      }
      data-design-visible-mechanism-count={sceneModel.mechanisms.length}
      data-design-target-joint-id={sceneModel.targetJointId ?? ""}
      data-design-target-error={targetError === undefined ? "missing" : targetError.toFixed(3)}
      data-design-target-x={target ? target.x.toFixed(2) : "missing"}
      data-design-target-y={target ? target.y.toFixed(2) : "missing"}
      data-design-animated-part-count={Object.keys(sceneModel.animatedParts).length}
      data-design-animated-object-count={Object.keys(sceneModel.animatedSceneObjects).length}
      data-design-show-trace={showTrace ? "true" : "false"}
      data-design-trace-layer={showTrace ? "shown" : "hidden"}
      data-design-foundry-contract-source="preparedAutomataSceneModel"
      data-design-mechanism-contract-id={sceneModel.mechanismContract?.mechanismId ?? ""}
      data-design-viewer-tool={viewerTool}
    >
      <div
        className="design-editor-toolbar"
        data-testid="design-editor-toolbar"
        aria-label="Editor tools"
      >
        <span className="foundry-camera-readout" data-testid="design-foundry-camera-readout">
          3D {cameraLabel(camera)} · {Math.round(camera.zoom * 100)}%
        </span>
        {([
          ["move", "Move"],
          ["rotate", "Rotate"],
          ["zoom", "Zoom"],
        ] as const).map(([tool, label]) => (
          <button
            key={tool}
            type="button"
            data-testid={`design-tool-${tool}`}
            className={viewerTool === tool ? "active" : ""}
            aria-pressed={viewerTool === tool}
            onClick={() => setViewerTool(tool)}
          >
            {label}
          </button>
        ))}
        <span className="viewer-toolbar-divider" aria-hidden="true" />
        <button type="button" data-testid="design-reset-view" onClick={resetCamera}>
          Reset
        </button>
      </div>
      <div
        className="design-view-controls"
        data-testid="design-foundry-camera-controls"
        aria-label="View layers"
      >
        <div className="design-view-control-group" aria-label="View">
          {(["front", "iso", "side", "top"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className={camera.preset === preset ? "active" : ""}
              aria-pressed={camera.preset === preset}
              onClick={() => setCameraPreset(preset)}
            >
              {FOUNDRY_VIEW_PRESETS[preset].label}
            </button>
          ))}
        </div>
        <div className="design-view-control-group" aria-label="Layers">
          <button
            type="button"
            data-testid="design-toggle-grid"
            className={showGrid ? "active" : ""}
            aria-pressed={showGrid}
            onClick={() => setShowGrid((value) => !value)}
          >
            Grid
          </button>
          <button
            type="button"
            data-testid="design-toggle-user-path"
            className={showUserPath ? "active" : ""}
            aria-pressed={showUserPath}
            disabled={!showTrace}
            onClick={() => setShowUserPathPreview((value) => !value)}
          >
            User path
          </button>
          <button
            type="button"
            data-testid="design-toggle-mechanism-path"
            className={showMechanismPath ? "active" : ""}
            aria-pressed={showMechanismPath}
            disabled={!showTrace}
            onClick={() => setShowMechanismPathPreview((value) => !value)}
          >
            Mech path
          </button>
        </div>
      </div>
      <ThreeFoundryPreview
        mechanism={sceneModel.foundryPreview.mechanism}
        mechanismContract={sceneModel.mechanismContract}
        simulation={sceneModel.foundryPreview.physicalSimulation}
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.94}
        color={sceneModel.foundryPreview.mechanism.color}
        pathPoints={sceneModel.foundryPreview.previewPoints}
        pathTraces={sceneModel.foundryPreview.pointTraces}
        showGrid={showGrid}
        showPathPreview={showMechanismPath && sceneModel.mechanismContract.projectDriveEnabled === true}
        showTrail={showMechanismPath && sceneModel.mechanismContract.projectDriveEnabled === true}
        showForces={false}
        showVelocity={false}
        explode={0}
        physicsRule={physicsOverlay.rule}
        velocityMagnitude={physicsOverlay.velocityMagnitude}
        forceMagnitude={physicsOverlay.forceMagnitude}
        frictionCoefficient={project.settings.simulationFriction}
        frictionMagnitude={physicsOverlay.frictionMagnitude}
        constraintError={physicsOverlay.constraintError}
        cameraLabel={cameraLabel(camera)}
        isPickingAnchor={false}
        isOrbiting={isOrbiting}
        isZooming={isZooming}
        isPanning={isPanning}
        onAnchorPick={() => {}}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerMove}
        onPointerCancel={finishPointerMove}
        onWheel={handleWheel}
        onProjectionSizeChange={updateProjectionSize}
        onAutomataPartSelect={(partId) =>
          dispatch({ type: "select_part", partId })
        }
        onAutomataSceneObjectSelect={(objectId) =>
          dispatch({ type: "select_scene_object", objectId })
        }
        connectionSelectionCoordinates={connectionCoordinates}
        connectionExportSignature={connectionExportSignature}
        selectedConnection={selectedConnectionHandle ? {
          role: selectedConnectionHandle.role,
          kind: selectedConnectionHandle.kind,
          holeIndex: selectedConnectionHandle.holeIndex,
        } : undefined}
        viewerTab="design"
        automataContext={automataContext}
      >
        {userPathD && (
          <svg
            data-testid="design-user-path-overlay"
            viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
            className="foundry-preview-overlay"
            aria-hidden="true"
          >
            <path
              d={userPathD}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="10 8"
              opacity="0.86"
            />
          </svg>
        )}
        <MechanismConnectionOverlay
          surface="design"
          handles={connectionHoleHandles}
          projectionSize={projectionSize}
          dragging={connectionInteraction.dragging}
          recoveryRole={connectionInteraction.recoveryRole}
          blocker={connectionInteraction.blocker ?? editBlocker}
          disabled={Boolean(sceneModel.recoveryMechanism)}
          onInteractionStart={connectionInteraction.beginInteraction}
          onSelect={connectionInteraction.selectHandle}
          onPointerDown={connectionInteraction.onPointerDown}
          onPointerMove={connectionInteraction.onPointerMove}
          onPointerUp={connectionInteraction.onPointerUp}
        />
      </ThreeFoundryPreview>
    </section>
  );
};

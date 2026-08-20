import React, { useMemo, useRef, useState } from "react";
import type { MechanismConfig, Point, ProjectAction, ProjectState } from "../../../types";
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
import {
  createAutomataSceneRuntime,
  sampleAutomataSceneRuntime,
} from "../../../utils/automataSceneModel";
import { pointsToSvgPath } from "../../../utils/mechanismPreview";
import {
  ThreeFoundryPreview,
  type FoundryPlaybackFrame,
} from "../foundry/ThreeFoundryPreview";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

type DesignFoundryPreviewProps = {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  playbackClock: PlaybackClock;
  isPlaying: boolean;
  showTrace: boolean;
  dispatch: (action: ProjectAction) => void;
};

const noPoint = { x: 0, y: 0 };

const cameraLabel = (camera: FoundryCamera) =>
  camera.preset === "custom"
    ? "Custom view"
    : FOUNDRY_VIEW_PRESETS[camera.preset].label;

export const DesignFoundryPreview = React.memo(({
  project,
  mechanism,
  angle,
  playbackClock,
  isPlaying,
  showTrace,
  dispatch,
}: DesignFoundryPreviewProps) => {
  const [showGrid, setShowGrid] = useState(true);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showMechanismPathPreview, setShowMechanismPathPreview] = useState(true);
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

  const sceneRuntime = useMemo(
    () => createAutomataSceneRuntime(project, mechanism, "design-live"),
    [mechanism, project],
  );
  const sceneModel = useMemo(
    () => sampleAutomataSceneRuntime(sceneRuntime, angle),
    [angle, sceneRuntime],
  );
  const automataContext = useMemo(
    () =>
      sceneModel.mechanism
        ? {
            project,
            animatedParts: sceneModel.animatedParts,
            animatedSceneObjects: sceneModel.animatedSceneObjects,
            geometrySkeleton: project.skeleton,
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
  const playbackSample = useMemo(
    () => (phase: number): FoundryPlaybackFrame | undefined => {
      const frame = sampleAutomataSceneRuntime(sceneRuntime, phase);
      if (!frame.foundryPreview || !frame.mechanism) return undefined;
      return {
        simulation: frame.foundryPreview.physicalSimulation,
        automataContext: {
          project,
          animatedParts: frame.animatedParts,
          animatedSceneObjects: frame.animatedSceneObjects,
          geometrySkeleton: project.skeleton,
          skeleton: frame.skeleton,
          paths: [],
          showCharacter: true,
          showSkeleton: false,
        },
      };
    },
    [project, sceneRuntime],
  );
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

  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) =>
    setCamera({ ...FOUNDRY_VIEW_PRESETS[preset], preset, pan: { x: 0, y: 0 } });

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const mode: "orbit" | "zoom" | "pan" =
      event.shiftKey || event.button === 1
        ? "pan"
        : event.altKey || event.button === 2
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
    setCamera((prev) => {
      if (start.mode === "zoom")
        return {
          ...prev,
          zoom: clampFoundryZoom(start.zoom * (1 - dy * 0.006)),
          preset: "custom",
        };
      if (start.mode === "pan")
        return {
          ...prev,
          pan: { x: start.pan.x - dx * 0.018, y: start.pan.y + dy * 0.018 },
          preset: "custom",
        };
      return {
        ...prev,
        yaw: start.yaw + dx * 0.38,
        pitch: clampFoundryPitch(start.pitch + dy * 0.28),
        preset: "custom",
      };
    });
  };

  const finishPointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (orbitStartRef.current?.pointerId !== event.pointerId) return;
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

  if (!sceneModel.mechanism || !sceneModel.foundryPreview) {
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
      data-automata-model-source="automata-scene-runtime"
      data-mechanism-id={sceneModel.mechanism.id}
      data-mechanism-type={sceneModel.mechanism.type}
      data-foundry-feature-label={sceneModel.featureLabel ?? ""}
      data-foundry-feature-issue-count={sceneModel.featureIssues.length}
      data-guided-context-mode="single-scene-automata"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={sceneModel.userPath ? 1 : 0}
      data-guided-context-path-id={sceneModel.userPath?.id ?? ""}
      data-user-path-preview={showUserPath ? "shown" : "hidden"}
      data-mechanism-path-preview={showMechanismPath ? "shown" : "hidden"}
      data-design-motion-source={sceneModel.motionSource}
      data-design-generated-path-count={sceneModel.mechanism.generatedPath?.length ?? 0}
      data-design-generated-path-error={
        sceneModel.generatedPathError === undefined
          ? "missing"
          : sceneModel.generatedPathError.toFixed(3)
      }
      data-design-fit-status={
        sceneModel.mechanism.fabricationMetadata?.pathFit?.status ?? "unfitted"
      }
      data-design-fit-error={
        sceneModel.mechanism.fabricationMetadata?.pathFit?.error === undefined
          ? "missing"
          : sceneModel.mechanism.fabricationMetadata.pathFit.error.toFixed(3)
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
      data-design-foundry-contract-source="automata-scene-runtime"
      data-design-mechanism-contract-id={sceneModel.mechanismContract?.mechanismId ?? ""}
    >
      <div
        className="foundry-camera-hud design-foundry-camera-hud"
        data-testid="design-foundry-camera-controls"
        aria-label="Automata viewer controls"
      >
        <span className="foundry-camera-readout" data-testid="design-foundry-camera-readout">
          3D {cameraLabel(camera)} · {Math.round(camera.zoom * 100)}%
        </span>
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
        <span className="viewer-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
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
      <ThreeFoundryPreview
        mechanism={sceneModel.foundryPreview.mechanism}
        performancePreset={project.settings.performancePreset}
        simulation={sceneModel.foundryPreview.physicalSimulation}
        playback={
          isPlaying
            ? {
                clock: playbackClock,
                sample: playbackSample,
              }
            : undefined
        }
        kit={project.settings.physicalKit}
        camera={camera}
        rigOpacity={0.94}
        color={sceneModel.foundryPreview.mechanism.color}
        pathPoints={sceneModel.foundryPreview.previewPoints}
        pathTraces={sceneModel.foundryPreview.pointTraces}
        showGrid={showGrid}
        showPathPreview={showMechanismPath}
        showTrail={showMechanismPath}
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
      </ThreeFoundryPreview>
    </section>
  );
});

DesignFoundryPreview.displayName = "DesignFoundryPreview";

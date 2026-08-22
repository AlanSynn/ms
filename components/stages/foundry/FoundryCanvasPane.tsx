import React, { useMemo } from "react";
import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
  ProjectState,
} from "../../../types";
import { resolveRenderPerformancePolicy } from "../../../utils/renderPerformancePolicy";
import {
  projectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import { SCENE_PX_PER_MM } from "../../../utils/coordinates";
import { pointsToSvgPath, type MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import {
  FoundryCameraControls,
  FoundryPlaybackPanel,
  FoundrySimBadge,
} from "./FoundryCanvasChrome";
import {
  FoundryOverlayLayer,
  type FoundryOverlayPlaybackFrame,
  type FoundryParamHandle,
  type FoundryParamHandleId,
} from "./FoundryOverlayLayer";
import { DeferredThreeFoundryPreview } from "./DeferredThreeFoundryPreview";
import type { FoundryPlaybackFrame } from "./ThreeFoundryPreview";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import type { TransientValueController } from "../../../runtime/render/transientValueController";

type FoundryCanvasPaneProps = {
  foundry: MechanismConfig;
  landedFoundry: MechanismConfig;
  foundryPlaying: boolean;
  foundryPhase: number;
  foundryPhaseDegrees: number;
  playbackClock: PlaybackClock;
  playbackSample: (phase: number) => FoundryPlaybackFrame | undefined;
  foundryCamera: FoundryCamera;
  transientCamera: TransientValueController<FoundryCamera>;
  transientFrame: TransientValueController<FoundryPlaybackFrame>;
  foundryCameraLabel: string;
  foundryRigOpacity: number;
  foundryExplode: number;
  foundryProjectionSize: FoundryOverlaySize;
  selectedPhysicalSimulation: MechanismPreviewSimulation;
  previewPoints: Point[];
  foundryPointTraces: Array<{
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
  }>;
  userPathPoints: Point[];
  targetPathId?: string;
  kit: PhysicalKitSettings;
  performancePreset: ProjectState["settings"]["performancePreset"];
  showFoundryGrid: boolean;
  showUserPathPreview: boolean;
  showPathPreview: boolean;
  showTrail: boolean;
  showForces: boolean;
  showVelocity: boolean;
  outputTraceLabel: string;
  canCycleOutputTrace: boolean;
  isPickingAnchor: boolean;
  isOrbitingFoundry: boolean;
  isZoomingFoundry: boolean;
  isPanningFoundry: boolean;
  physicsRule: string;
  motionWarning?: string | null;
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionCoefficient: number;
  frictionMagnitude: number;
  constraintError: number;
  projectedPlayhead?: Point;
  projectedVelocityTip?: Point;
  projectedForceTip?: Point;
  projectedFrictionTip?: Point;
  projectedDriveOrigin?: Point;
  projectedDriveTip?: Point;
  projectedAnchorMarker?: Point;
  playheadSource: string;
  velocityRaw: Point;
  forceRaw: Point;
  foundryParamHandles: FoundryParamHandle[];
  foundryParamHandleZSummary: string;
  hasManualAnchor: boolean;
  landingBoardLabel: string;
  gestureActive: boolean;
  gestureEmissionCount: number;
  onSetCameraPreset: (preset: Exclude<FoundryViewPreset, "custom">) => void;
  onToggleGrid: () => void;
  onToggleUserPathPreview: () => void;
  onTogglePathPreview: () => void;
  onToggleForces: () => void;
  onToggleVelocity: () => void;
  onCycleOutputTrace: () => void;
  onToggleTrail: () => void;
  onTogglePlaying: () => void;
  onResetPreview: () => void;
  onPhaseChange: (phase: number) => void;
  onAnchorPick: (point: Point) => void;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onProjectionSizeChange: (size: FoundryOverlaySize) => void;
  onParamPointerDown: (
    handle: FoundryParamHandleId,
  ) => React.PointerEventHandler<SVGCircleElement>;
  onParamPointerMove: React.PointerEventHandler<SVGCircleElement>;
  onParamPointerUp: React.PointerEventHandler<SVGCircleElement>;
  playbackOverlay: {
    clock: PlaybackClock;
    sample: (phase: number) => FoundryOverlayPlaybackFrame | undefined;
    minFrameIntervalMs?: number;
  };
};

export const FoundryCanvasPane = ({
  foundry,
  landedFoundry,
  foundryPlaying,
  foundryPhase,
  foundryPhaseDegrees,
  playbackClock,
  playbackSample,
  foundryCamera,
  transientCamera,
  transientFrame,
  foundryCameraLabel,
  foundryRigOpacity,
  foundryExplode,
  foundryProjectionSize,
  selectedPhysicalSimulation,
  previewPoints,
  foundryPointTraces,
  userPathPoints,
  targetPathId,
  kit,
  performancePreset,
  showFoundryGrid,
  showUserPathPreview,
  showPathPreview,
  showTrail,
  showForces,
  showVelocity,
  outputTraceLabel,
  canCycleOutputTrace,
  isPickingAnchor,
  isOrbitingFoundry,
  isZoomingFoundry,
  isPanningFoundry,
  physicsRule,
  motionWarning,
  velocityMagnitude,
  forceMagnitude,
  frictionCoefficient,
  frictionMagnitude,
  constraintError,
  projectedPlayhead,
  projectedVelocityTip,
  projectedForceTip,
  projectedFrictionTip,
  projectedDriveOrigin,
  projectedDriveTip,
  projectedAnchorMarker,
  playheadSource,
  velocityRaw,
  forceRaw,
  foundryParamHandles,
  foundryParamHandleZSummary,
  hasManualAnchor,
  landingBoardLabel,
  gestureActive,
  gestureEmissionCount,
  onSetCameraPreset,
  onToggleGrid,
  onToggleUserPathPreview,
  onTogglePathPreview,
  onToggleForces,
  onToggleVelocity,
  onCycleOutputTrace,
  onToggleTrail,
  onTogglePlaying,
  onResetPreview,
  onPhaseChange,
  onAnchorPick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onProjectionSizeChange,
  onParamPointerDown,
  onParamPointerMove,
  onParamPointerUp,
  playbackOverlay,
}: FoundryCanvasPaneProps) => {
  const renderPolicy = resolveRenderPerformancePolicy(performancePreset);
  const pathFitError = useMemo(() => {
    if (!userPathPoints.length || !previewPoints.length) return undefined;
    const total = userPathPoints.reduce((sum, userPoint) => {
      const nearest = previewPoints.reduce(
        (best, mechPoint) =>
          Math.min(
            best,
            Math.hypot(userPoint.x - mechPoint.x, userPoint.y - mechPoint.y),
          ),
        Number.POSITIVE_INFINITY,
      );
      return sum + nearest;
    }, 0);
    return total / userPathPoints.length;
  }, [previewPoints, userPathPoints]);
  const userPathBounds = useMemo(() => {
    if (!userPathPoints.length) return "";
    const xs = userPathPoints.map((point) => point.x);
    const ys = userPathPoints.map((point) => point.y);
    return [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ]
      .map((value) => value.toFixed(2))
      .join(",");
  }, [userPathPoints]);
  const userPathD = useMemo(() => {
    if (!showUserPathPreview || userPathPoints.length < 2) return "";
    const projected = userPathPoints
      .map((point) =>
        projectFoundryOverlayPoint(
          point,
          foundryCamera,
          foundryProjectionSize,
          0.08,
        ),
      )
      .filter((point): point is Point => Boolean(point));
    return projected.length >= 2 ? pointsToSvgPath(projected) : "";
  }, [
    foundryCamera,
    foundryProjectionSize,
    showUserPathPreview,
    userPathPoints,
  ]);
  const anchorGrid = useMemo(() => {
    const pitch = kit.gridPitchMm * SCENE_PX_PER_MM;
    const x = landedFoundry.anchorX ?? 0;
    const y = landedFoundry.anchorY ?? 0;
    return Number.isFinite(x) && Number.isFinite(y) && pitch > 0
      ? `${(x / pitch).toFixed(0)},${(y / pitch).toFixed(0)}`
      : "";
  }, [kit.gridPitchMm, landedFoundry.anchorX, landedFoundry.anchorY]);

  return (
    <section
      className="path-canvas-shell foundry-canvas-shell canvas-workspace p-0"
      data-testid="foundry-canvas-pane"
      data-user-path-preview={showUserPathPreview ? "shown" : "hidden"}
      data-mechanism-path-preview={showPathPreview ? "shown" : "hidden"}
      data-user-path-basis="mechanism-fit-context"
      data-user-path-bounds={userPathBounds}
      data-user-path-point-count={userPathPoints.length}
      data-fit-board-cells={kit.boardCells}
      data-fit-anchor-grid={anchorGrid}
      data-fit-target-path={targetPathId ?? landedFoundry.targetPathId ?? ""}
      data-foundry-gesture-draft={gestureActive ? "active" : "idle"}
      data-foundry-gesture-emissions={gestureEmissionCount}
      data-user-to-mech-fit-error={
        pathFitError === undefined ? "missing" : pathFitError.toFixed(2)
      }
    >
    <FoundrySimBadge foundryPlaying={foundryPlaying} />
    <FoundryCameraControls
      foundryCamera={foundryCamera}
      foundryCameraLabel={foundryCameraLabel}
      showFoundryGrid={showFoundryGrid}
      showUserPathPreview={showUserPathPreview}
      showPathPreview={showPathPreview}
      showForces={showForces}
      showVelocity={showVelocity}
      showTrail={showTrail}
      onSetCameraPreset={onSetCameraPreset}
      onToggleGrid={onToggleGrid}
      onToggleUserPathPreview={onToggleUserPathPreview}
      onTogglePathPreview={onTogglePathPreview}
      onToggleForces={onToggleForces}
      outputTraceLabel={outputTraceLabel}
      canCycleOutputTrace={canCycleOutputTrace}
      onToggleVelocity={onToggleVelocity}
      onCycleOutputTrace={onCycleOutputTrace}
      onToggleTrail={onToggleTrail}
    />
    {motionWarning && (
      <div className="warning foundry-motion-warning" data-testid="foundry-motion-warning">
        {motionWarning}
      </div>
    )}
    <FoundryPlaybackPanel
      foundryPlaying={foundryPlaying}
      foundryPhaseDegrees={foundryPhaseDegrees}
      playbackClock={playbackClock}
      onTogglePlaying={onTogglePlaying}
      onResetPreview={onResetPreview}
      onPhaseChange={onPhaseChange}
    />
    <DeferredThreeFoundryPreview
      mechanism={landedFoundry}
      performancePreset={performancePreset}
      simulation={selectedPhysicalSimulation}
      playback={foundryPlaying ? {
        clock: playbackClock,
        sample: playbackSample,
      } : undefined}
      kit={kit}
      camera={foundryCamera}
      transientCamera={transientCamera}
      transientFrame={transientFrame}
      rigOpacity={foundryRigOpacity / 100}
      color={foundry.color}
      pathPoints={previewPoints}
      pathTraces={foundryPointTraces}
      showGrid={showFoundryGrid}
      showPathPreview={showPathPreview}
      showTrail={showTrail}
      showForces={showForces}
      showVelocity={showVelocity}
      explode={foundryExplode / 100}
      physicsRule={physicsRule}
      velocityMagnitude={velocityMagnitude}
      forceMagnitude={forceMagnitude}
      frictionCoefficient={frictionCoefficient}
      frictionMagnitude={frictionMagnitude}
      constraintError={constraintError}
      cameraLabel={foundryCameraLabel}
      isPickingAnchor={isPickingAnchor}
      isOrbiting={isOrbitingFoundry}
      isZooming={isZoomingFoundry}
      isPanning={isPanningFoundry}
      onAnchorPick={onAnchorPick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onProjectionSizeChange={onProjectionSizeChange}
      deferMechanismTopology={gestureActive}
    >
      {userPathD && (
        <svg
          data-testid="foundry-user-path-overlay"
          viewBox={`0 0 ${foundryProjectionSize.width} ${foundryProjectionSize.height}`}
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
            opacity="0.85"
          />
        </svg>
      )}
      <FoundryOverlayLayer
        foundryProjectionSize={foundryProjectionSize}
        showForces={showForces}
        showVelocity={showVelocity}
        isPickingAnchor={isPickingAnchor}
        projectedPlayhead={projectedPlayhead}
        projectedVelocityTip={projectedVelocityTip}
        projectedForceTip={projectedForceTip}
        projectedFrictionTip={projectedFrictionTip}
        projectedDriveOrigin={projectedDriveOrigin}
        projectedDriveTip={projectedDriveTip}
        projectedAnchorMarker={projectedAnchorMarker}
        playheadSource={playheadSource}
        velocityRaw={velocityRaw}
        forceRaw={forceRaw}
        velocityMagnitude={velocityMagnitude}
        forceMagnitude={forceMagnitude}
        frictionMagnitude={frictionMagnitude}
        constraintError={constraintError}
        physicsRule={physicsRule}
        foundryParamHandles={foundryParamHandles}
        foundryParamHandleZSummary={foundryParamHandleZSummary}
        hasManualAnchor={hasManualAnchor}
        landingBoardLabel={landingBoardLabel}
        onParamPointerDown={onParamPointerDown}
        onParamPointerMove={onParamPointerMove}
        onParamPointerUp={onParamPointerUp}
        playback={{
          ...playbackOverlay,
          minFrameIntervalMs: renderPolicy.minOverlayIntervalMs,
        }}
      />
    </DeferredThreeFoundryPreview>
    <div hidden data-testid="foundry-toolbar-state">
      Toolbar: {foundryPlaying ? "playing" : "paused"} · grid{" "}
      {showFoundryGrid ? "shown" : "hidden"} · user path{" "}
      {showUserPathPreview ? "shown" : "hidden"} · mech path{" "}
      {showPathPreview ? "shown" : "hidden"} · camera {foundryCameraLabel} ·
      phase {Math.round((foundryPhase * 180) / Math.PI)}°
    </div>
    </section>
  );
};

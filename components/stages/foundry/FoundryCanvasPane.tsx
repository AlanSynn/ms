import React from "react";
import type { MechanismConfig, PhysicalKitSettings, Point } from "../../../types";
import type { FoundryCamera, FoundryOverlaySize, FoundryViewPreset } from "../../../utils/foundryCamera";
import { fitMechanismSimulation } from "../../../utils/mechanismPreview";
import {
  FoundryCameraControls,
  FoundryPlaybackPanel,
  FoundrySimBadge,
} from "./FoundryCanvasChrome";
import {
  FoundryOverlayLayer,
  type FoundryParamHandle,
} from "./FoundryOverlayLayer";
import { ThreeFoundryPreview } from "./ThreeFoundryPreview";

type FoundryCanvasPaneProps = {
  foundry: MechanismConfig;
  landedFoundry: MechanismConfig;
  foundryPlaying: boolean;
  foundryPhase: number;
  foundryPhaseDegrees: number;
  foundryCamera: FoundryCamera;
  foundryCameraLabel: string;
  foundryRigOpacity: number;
  foundryExplode: number;
  foundryProjectionSize: FoundryOverlaySize;
  selectedPhysicalSimulation: ReturnType<typeof fitMechanismSimulation>;
  previewPoints: Point[];
  foundryPointTraces: Array<{
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
  }>;
  kit: PhysicalKitSettings;
  showFoundryGrid: boolean;
  showPathPreview: boolean;
  showTrail: boolean;
  showForces: boolean;
  showVelocity: boolean;
  isPickingAnchor: boolean;
  isOrbitingFoundry: boolean;
  isZoomingFoundry: boolean;
  isPanningFoundry: boolean;
  physicsRule: string;
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
  onSetCameraPreset: (preset: Exclude<FoundryViewPreset, "custom">) => void;
  onToggleGrid: () => void;
  onTogglePathPreview: () => void;
  onToggleForces: () => void;
  onToggleVelocity: () => void;
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
    handle: "B" | "C" | "D",
  ) => React.PointerEventHandler<SVGCircleElement>;
  onParamPointerMove: React.PointerEventHandler<SVGCircleElement>;
  onParamPointerUp: React.PointerEventHandler<SVGCircleElement>;
};

export const FoundryCanvasPane = ({
  foundry,
  landedFoundry,
  foundryPlaying,
  foundryPhase,
  foundryPhaseDegrees,
  foundryCamera,
  foundryCameraLabel,
  foundryRigOpacity,
  foundryExplode,
  foundryProjectionSize,
  selectedPhysicalSimulation,
  previewPoints,
  foundryPointTraces,
  kit,
  showFoundryGrid,
  showPathPreview,
  showTrail,
  showForces,
  showVelocity,
  isPickingAnchor,
  isOrbitingFoundry,
  isZoomingFoundry,
  isPanningFoundry,
  physicsRule,
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
  onSetCameraPreset,
  onToggleGrid,
  onTogglePathPreview,
  onToggleForces,
  onToggleVelocity,
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
}: FoundryCanvasPaneProps) => (
  <section className="path-canvas-shell foundry-canvas-shell canvas-workspace p-0">
    <FoundrySimBadge foundryPlaying={foundryPlaying} />
    <FoundryCameraControls
      foundryCamera={foundryCamera}
      foundryCameraLabel={foundryCameraLabel}
      showFoundryGrid={showFoundryGrid}
      showPathPreview={showPathPreview}
      showForces={showForces}
      showVelocity={showVelocity}
      showTrail={showTrail}
      onSetCameraPreset={onSetCameraPreset}
      onToggleGrid={onToggleGrid}
      onTogglePathPreview={onTogglePathPreview}
      onToggleForces={onToggleForces}
      onToggleVelocity={onToggleVelocity}
      onToggleTrail={onToggleTrail}
    />
    <FoundryPlaybackPanel
      foundryPlaying={foundryPlaying}
      foundryPhaseDegrees={foundryPhaseDegrees}
      onTogglePlaying={onTogglePlaying}
      onResetPreview={onResetPreview}
      onPhaseChange={onPhaseChange}
    />
    <ThreeFoundryPreview
      mechanism={landedFoundry}
      simulation={selectedPhysicalSimulation}
      kit={kit}
      camera={foundryCamera}
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
    >
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
      />
    </ThreeFoundryPreview>
    <div hidden data-testid="foundry-toolbar-state">
      Toolbar: {foundryPlaying ? "playing" : "paused"} · grid{" "}
      {showFoundryGrid ? "shown" : "hidden"} · path{" "}
      {showPathPreview ? "shown" : "hidden"} · camera {foundryCameraLabel} ·
      phase {Math.round((foundryPhase * 180) / Math.PI)}°
    </div>
  </section>
);

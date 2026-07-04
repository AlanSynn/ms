import React from "react";
import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import {
  FOUNDRY_VIEW_PRESETS,
  type FoundryCamera,
  type FoundryCameraPreset,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import { fitMechanismSimulation } from "../../../utils/mechanismPreview";
import { VIEWER3D_CONTRACT_VERSION } from "../../../utils/viewer3d";
import { ThreeFoundryPreview } from "./ThreeFoundryPreview";

type FoundryParamHandle = {
  id: string;
  label: string;
  point: Point;
  draggable: boolean;
  z: number;
  screen?: Point;
};

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
    <div className="foundry-sim-badge" data-testid="foundry-sim-badge">
      <span className={foundryPlaying ? "status-pulse" : ""} />
      {foundryPlaying ? "Active Sim" : "Paused"}
    </div>
    <div
      className="foundry-camera-hud"
      data-testid="foundry-camera-controls"
      aria-label="Shared 3D viewer toolbar"
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
    >
      <span
        className="foundry-camera-readout"
        data-testid="foundry-camera-readout"
      >
        3D {foundryCameraLabel} · {Math.round(foundryCamera.zoom * 100)}%
      </span>
      {(
        Object.entries(FOUNDRY_VIEW_PRESETS) as Array<
          [Exclude<FoundryViewPreset, "custom">, FoundryCameraPreset]
        >
      ).map(([preset, view]) => (
        <button
          key={preset}
          type="button"
          data-testid={`foundry-camera-preset-${preset}`}
          className={foundryCamera.preset === preset ? "active" : ""}
          aria-pressed={foundryCamera.preset === preset}
          onClick={() => onSetCameraPreset(preset)}
        >
          {view.label}
        </button>
      ))}
      <span className="viewer-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        data-testid="foundry-toggle-grid"
        className={showFoundryGrid ? "active" : ""}
        aria-label="Grid layer"
        aria-pressed={showFoundryGrid}
        onClick={onToggleGrid}
      >
        Grid
      </button>
      <button
        type="button"
        data-testid="foundry-toggle-paths"
        className={showPathPreview ? "active" : ""}
        aria-label="Path layer"
        aria-pressed={showPathPreview}
        onClick={onTogglePathPreview}
      >
        Path
      </button>
      <button
        type="button"
        data-testid="foundry-toggle-forces"
        className={showForces ? "active" : ""}
        aria-label="Force vector layer"
        aria-pressed={showForces}
        onClick={onToggleForces}
      >
        Force
      </button>
      <button
        type="button"
        data-testid="foundry-toggle-velocity"
        className={showVelocity ? "active" : ""}
        aria-label="Speed vector layer"
        aria-pressed={showVelocity}
        onClick={onToggleVelocity}
      >
        v
      </button>
      <button
        type="button"
        data-testid="foundry-toggle-trail"
        className={showTrail ? "active" : ""}
        aria-label="Motion trace layer"
        aria-pressed={showTrail}
        onClick={onToggleTrail}
      >
        Trace
      </button>
    </div>
    <div
      className="foundry-playback-hud foundry-toolbar"
      data-testid="foundry-toolbar"
      aria-label="Foundry playback"
    >
      <button
        className={`btn-secondary ${foundryPlaying ? "active" : ""}`}
        onClick={onTogglePlaying}
      >
        {foundryPlaying ? "Pause" : "Play"}
      </button>
      <button className="btn-secondary" onClick={onResetPreview}>
        Reset
      </button>
      <input
        aria-label="Foundry phase"
        type="range"
        min="0"
        max="360"
        value={foundryPhaseDegrees}
        onChange={(event) => onPhaseChange(Number(event.target.value))}
      />
      <span>{foundryPhaseDegrees}°</span>
    </div>
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
      <svg
        data-testid="foundry-preview-overlay"
        viewBox={`0 0 ${foundryProjectionSize.width} ${foundryProjectionSize.height}`}
        className="foundry-preview-overlay"
        aria-label="Foundry physical joint overlay"
        data-projection-aspect={(
          foundryProjectionSize.width /
          Math.max(1, foundryProjectionSize.height)
        ).toFixed(3)}
      >
        {showForces &&
          projectedPlayhead &&
          projectedForceTip &&
          projectedDriveOrigin &&
          projectedDriveTip && (
            <g
              data-testid="foundry-forces-overlay"
              className="physics-vector physics-force"
              data-projection="three-camera"
              data-origin-source={playheadSource}
              data-physics-rule={physicsRule}
              data-fx={forceRaw.x.toFixed(3)}
              data-fy={forceRaw.y.toFixed(3)}
              data-force-magnitude={forceMagnitude.toFixed(3)}
              data-friction-magnitude={frictionMagnitude.toFixed(3)}
              data-constraint-error={constraintError.toFixed(3)}
              stroke="#ef4444"
              strokeWidth="3"
              strokeLinecap="round"
            >
              <defs>
                <marker
                  id="foundry-arrow-force-overlay"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#ef4444" />
                </marker>
              </defs>
              <defs>
                <marker
                  id="foundry-arrow-friction-overlay"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#f59e0b" />
                </marker>
              </defs>
              <line
                data-testid="foundry-force-vector"
                x1={projectedPlayhead.x}
                y1={projectedPlayhead.y}
                x2={projectedForceTip.x}
                y2={projectedForceTip.y}
                markerEnd="url(#foundry-arrow-force-overlay)"
              />
              <line
                data-testid="foundry-drive-force-vector"
                x1={projectedDriveOrigin.x}
                y1={projectedDriveOrigin.y}
                x2={projectedDriveTip.x}
                y2={projectedDriveTip.y}
                opacity="0.68"
                markerEnd="url(#foundry-arrow-force-overlay)"
              />
              {projectedFrictionTip && (
                <line
                  data-testid="foundry-friction-vector"
                  x1={projectedPlayhead.x}
                  y1={projectedPlayhead.y}
                  x2={projectedFrictionTip.x}
                  y2={projectedFrictionTip.y}
                  stroke="#f59e0b"
                  markerEnd="url(#foundry-arrow-friction-overlay)"
                />
              )}
              <text x={projectedForceTip.x + 5} y={projectedForceTip.y - 3}>
                F / a
              </text>
              <text x={projectedDriveTip.x + 5} y={projectedDriveTip.y + 9}>
                drive τ
              </text>
              {projectedFrictionTip && (
                <text
                  x={projectedFrictionTip.x + 5}
                  y={projectedFrictionTip.y + 9}
                  fill="#92400e"
                >
                  μ
                </text>
              )}
            </g>
          )}
        {showVelocity && projectedPlayhead && projectedVelocityTip && (
          <g
            data-testid="foundry-velocity-overlay"
            className="physics-vector physics-velocity"
            data-projection="three-camera"
            data-origin-source={playheadSource}
            data-vx={velocityRaw.x.toFixed(3)}
            data-vy={velocityRaw.y.toFixed(3)}
            data-speed={velocityMagnitude.toFixed(3)}
            stroke="#10b981"
            strokeWidth="4"
            strokeLinecap="round"
          >
            <defs>
              <marker
                id="foundry-arrow-velocity-overlay"
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#10b981" />
              </marker>
            </defs>
            <line
              data-testid="foundry-velocity-vector"
              x1={projectedPlayhead.x}
              y1={projectedPlayhead.y}
              x2={projectedVelocityTip.x}
              y2={projectedVelocityTip.y}
              markerEnd="url(#foundry-arrow-velocity-overlay)"
            />
            <text x={projectedVelocityTip.x + 5} y={projectedVelocityTip.y - 3}>
              v
            </text>
          </g>
        )}
        {projectedPlayhead && (
          <circle
            data-testid="foundry-playhead"
            data-projection="three-camera"
            data-origin-source={playheadSource}
            cx={projectedPlayhead.x}
            cy={projectedPlayhead.y}
            r="7"
            fill="#f472b6"
            stroke="white"
            strokeWidth="3"
          />
        )}
        {foundryParamHandles.length > 0 && (
          <g
            data-testid="foundry-param-handles"
            data-handle-contract="4bar-A-B-C-D"
            data-projection="three-camera"
            data-handle-z-contract="board-pivots-bottom-floating-top"
            data-handle-z-map={foundryParamHandleZSummary}
          >
            {foundryParamHandles.map((handle) => (
              <g
                key={handle.id}
                transform={`translate(${handle.screen!.x} ${handle.screen!.y})`}
                data-testid={`foundry-param-handle-group-${handle.id}`}
              >
                <circle
                  data-testid={`foundry-param-handle-${handle.id}`}
                  className={`foundry-param-handle ${handle.draggable ? "is-draggable" : "is-locked"}`}
                  data-param-handle={handle.id}
                  data-param-role={handle.label}
                  data-draggable={String(handle.draggable)}
                  data-projection-z={handle.z.toFixed(2)}
                  r={handle.draggable ? 8 : 6}
                  fill={handle.draggable ? "#ffffff" : "#e2e8f0"}
                  stroke={handle.draggable ? "#4f46e5" : "#64748b"}
                  strokeWidth="3"
                  onPointerDown={
                    handle.draggable
                      ? onParamPointerDown(handle.id as "B" | "C" | "D")
                      : undefined
                  }
                  onPointerMove={
                    handle.draggable ? onParamPointerMove : undefined
                  }
                  onPointerUp={handle.draggable ? onParamPointerUp : undefined}
                  onPointerCancel={
                    handle.draggable ? onParamPointerUp : undefined
                  }
                />
                <text className="foundry-param-label" x="10" y="-8">
                  {handle.id}
                </text>
              </g>
            ))}
          </g>
        )}
        {(isPickingAnchor || hasManualAnchor) && projectedAnchorMarker && (
          <g
            data-testid="foundry-anchor-marker"
            data-projection="three-camera"
            transform={`translate(${projectedAnchorMarker.x} ${projectedAnchorMarker.y})`}
          >
            <circle r="8" fill="#ffffff" stroke="#8b5cf6" strokeWidth="3" />
            <path
              d="M -13 0 H 13 M 0 -13 V 13"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <text x="12" y="-10" fill="#5b21b6" fontSize="8" fontWeight="900">
              {landingBoardLabel}
            </text>
          </g>
        )}
      </svg>
    </ThreeFoundryPreview>
    <div hidden data-testid="foundry-toolbar-state">
      Toolbar: {foundryPlaying ? "playing" : "paused"} · grid{" "}
      {showFoundryGrid ? "shown" : "hidden"} · path{" "}
      {showPathPreview ? "shown" : "hidden"} · camera {foundryCameraLabel} ·
      phase {Math.round((foundryPhase * 180) / Math.PI)}°
    </div>
  </section>
);

import React from "react";
import type { Point } from "../../../types";
import type { FoundryOverlaySize } from "../../../utils/foundryCamera";

export type FoundryParamHandle = {
  id: string;
  label: string;
  point: Point;
  draggable: boolean;
  z: number;
  screen?: Point;
};

type FoundryOverlayLayerProps = {
  foundryProjectionSize: FoundryOverlaySize;
  showForces: boolean;
  showVelocity: boolean;
  isPickingAnchor: boolean;
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
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionMagnitude: number;
  constraintError: number;
  physicsRule: string;
  foundryParamHandles: FoundryParamHandle[];
  foundryParamHandleZSummary: string;
  hasManualAnchor: boolean;
  landingBoardLabel: string;
  onParamPointerDown: (
    handle: "B" | "C" | "D",
  ) => React.PointerEventHandler<SVGCircleElement>;
  onParamPointerMove: React.PointerEventHandler<SVGCircleElement>;
  onParamPointerUp: React.PointerEventHandler<SVGCircleElement>;
};

export const FoundryOverlayLayer = ({
  foundryProjectionSize,
  showForces,
  showVelocity,
  isPickingAnchor,
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
  velocityMagnitude,
  forceMagnitude,
  frictionMagnitude,
  constraintError,
  physicsRule,
  foundryParamHandles,
  foundryParamHandleZSummary,
  hasManualAnchor,
  landingBoardLabel,
  onParamPointerDown,
  onParamPointerMove,
  onParamPointerUp,
}: FoundryOverlayLayerProps) => (
  <svg
    data-testid="foundry-preview-overlay"
    viewBox={`0 0 ${foundryProjectionSize.width} ${foundryProjectionSize.height}`}
    className="foundry-preview-overlay"
    aria-label="Foundry physical joint overlay"
    data-projection-aspect={(
      foundryProjectionSize.width / Math.max(1, foundryProjectionSize.height)
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
            Push
          </text>
          <text x={projectedDriveTip.x + 5} y={projectedDriveTip.y + 9}>
            Turn
          </text>
          {projectedFrictionTip && (
            <text
              x={projectedFrictionTip.x + 5}
              y={projectedFrictionTip.y + 9}
              fill="#92400e"
            >
              Rub
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
          Speed
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
              onPointerMove={handle.draggable ? onParamPointerMove : undefined}
              onPointerUp={handle.draggable ? onParamPointerUp : undefined}
              onPointerCancel={handle.draggable ? onParamPointerUp : undefined}
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
);

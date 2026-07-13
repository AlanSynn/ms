import React from "react";
import type { ConnectionSelection, ConnectionSelectionRole, Point } from "../../../types";
import type { FoundryOverlaySize } from "../../../utils/foundryCamera";

export type FoundryParamHandleId = "M" | "A" | "B" | "C" | "D";

export type FoundryParamHandle = {
  id: FoundryParamHandleId;
  label: string;
  point: Point;
  draggable: boolean;
  z: number;
  screen: Point;
};

export type FoundryConnectionHoleHandle = {
  role: ConnectionSelectionRole;
  kind: ConnectionSelection["kind"];
  partKey: string;
  holeIndex: number;
  z: number;
  screen: Point;
  selected: boolean;
  provisional: boolean;
  selection: ConnectionSelection;
};

export type DraggingFoundryConnectionSelection = {
  role: ConnectionSelectionRole;
  holeIndex: number;
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
  connectionHoleHandles: FoundryConnectionHoleHandle[];
  onConnectionHolePointerDown: (
    handle: FoundryConnectionHoleHandle,
  ) => React.PointerEventHandler<SVGCircleElement>;
  onConnectionHolePointerMove: (
    handle: FoundryConnectionHoleHandle,
  ) => React.PointerEventHandler<SVGCircleElement>;
  onConnectionHolePointerUp: (
    handle: FoundryConnectionHoleHandle,
  ) => React.PointerEventHandler<SVGCircleElement>;
  draggingConnectionSelection?: DraggingFoundryConnectionSelection;
  hasManualAnchor: boolean;
  landingBoardLabel: string;
  onParamPointerDown: (
    handle: FoundryParamHandleId,
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
  connectionHoleHandles,
  onConnectionHolePointerDown,
  onConnectionHolePointerMove,
  onConnectionHolePointerUp,
  draggingConnectionSelection,
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
    style={{ pointerEvents: "auto" }}
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
        data-handle-contract="move-anchor-plus-shape-handles"
        data-handle-ids={foundryParamHandles.map((handle) => handle.id).join(",")}
        data-projection="three-camera"
        data-handle-z-contract="board-pivots-bottom-floating-top"
        data-handle-z-map={foundryParamHandleZSummary}
      >
        {foundryParamHandles.map((handle) => (
          <g
            key={handle.id}
            transform={`translate(${handle.screen.x} ${handle.screen.y})`}
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
                  ? onParamPointerDown(handle.id)
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

    {connectionHoleHandles.length > 0 && (
      <g
        data-testid="foundry-connection-hole-handles"
        data-authority="physical-affordance"
      >
        {connectionHoleHandles
          .filter((handle) =>
            draggingConnectionSelection
              ? handle.role === draggingConnectionSelection.role
              : handle.selected || handle.provisional,
          )
          .map((handle) => {
            const isDragTarget =
              draggingConnectionSelection?.role === handle.role &&
              draggingConnectionSelection.holeIndex === handle.holeIndex;
            const isCandidate =
              draggingConnectionSelection?.role === handle.role &&
              !handle.selected;
            return (
              <g
                key={`${handle.role}-${handle.partKey}-${handle.holeIndex}`}
                transform={`translate(${handle.screen.x} ${handle.screen.y})`}
                data-testid={`foundry-connection-hole-${handle.role}-${handle.holeIndex}`}
              >
                <circle
                  className="foundry-connection-hole-hit"
                  style={{ pointerEvents: "auto" }}
                  data-connection-role={handle.role}
                  data-connection-kind={handle.kind}
                  data-connection-part-key={handle.partKey}
                  data-connection-hole-index={handle.holeIndex}
                  data-connection-z={handle.z.toFixed(3)}
                  data-connection-selected={String(handle.selected)}
                  data-connection-provisional={String(handle.provisional)}
                  r={isDragTarget ? "11.5" : "10"}
                  fill={
                    isDragTarget
                      ? "rgba(245, 158, 11, 0.34)"
                      : handle.selected
                        ? "#f59e0b"
                        : "rgba(37, 99, 235, 0.18)"
                  }
                  fillOpacity={
                    handle.selected || isDragTarget ? "0.92" : "0.42"
                  }
                  stroke={
                    isDragTarget
                      ? "#b45309"
                      : handle.selected
                        ? "#92400e"
                        : "#2563eb"
                  }
                  strokeOpacity={isCandidate ? "0.7" : "1"}
                  strokeWidth={isDragTarget ? "4" : "3"}
                  onPointerDown={onConnectionHolePointerDown(handle)}
                  onPointerMove={onConnectionHolePointerMove(handle)}
                  onPointerUp={onConnectionHolePointerUp(handle)}
                  onPointerCancel={onConnectionHolePointerUp(handle)}
                />
                <circle r="3" fill="#111827" pointerEvents="none" />
              </g>
            );
          })}
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

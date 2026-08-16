import React, { useEffect, useRef } from "react";
import type { Point } from "../../../types";
import type { FoundryOverlaySize } from "../../../utils/foundryCamera";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";

export type FoundryParamHandleId = "M" | "A" | "B" | "C" | "D";

export type FoundryParamHandle = {
  id: FoundryParamHandleId;
  label: string;
  point: Point;
  draggable: boolean;
  z: number;
  screen: Point;
};

export type FoundryOverlayPlaybackFrame = {
  projectedPlayhead?: Point;
  projectedVelocityTip?: Point;
  projectedForceTip?: Point;
  projectedFrictionTip?: Point;
  projectedDriveOrigin?: Point;
  projectedDriveTip?: Point;
  playheadSource: string;
  velocityRaw: Point;
  forceRaw: Point;
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionMagnitude: number;
  constraintError: number;
  physicsRule: string;
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
    handle: FoundryParamHandleId,
  ) => React.PointerEventHandler<SVGCircleElement>;
  onParamPointerMove: React.PointerEventHandler<SVGCircleElement>;
  onParamPointerUp: React.PointerEventHandler<SVGCircleElement>;
  playback?: {
    clock: PlaybackClock;
    sample: (phase: number) => FoundryOverlayPlaybackFrame | undefined;
    minFrameIntervalMs?: number;
  };
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
  playback,
}: FoundryOverlayLayerProps) => {
  const overlayRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!playback) return;
    let lastFrameTime = -Infinity;
    const setAttribute = (node: Element | null, name: string, value: string) => {
      node?.setAttribute(name, value);
    };
    const setPoint = (
      node: Element | null,
      xName: string,
      yName: string,
      point?: Point,
    ) => {
      if (!point) return;
      setAttribute(node, xName, String(point.x));
      setAttribute(node, yName, String(point.y));
    };
    const apply = (
      frame: FoundryOverlayPlaybackFrame,
      time: number,
      force = false,
    ) => {
      const minFrameInterval = playback.minFrameIntervalMs ?? 0;
      if (!force && time !== 0 && time - lastFrameTime < minFrameInterval) return;
      lastFrameTime = time;
      const svg = overlayRef.current;
      if (!svg) return;
      const playhead = svg.querySelector('[data-testid="foundry-playhead"]');
      const forces = svg.querySelector('[data-testid="foundry-forces-overlay"]');
      const velocity = svg.querySelector('[data-testid="foundry-velocity-overlay"]');
      setPoint(playhead, "cx", "cy", frame.projectedPlayhead);
      setPoint(
        svg.querySelector('[data-testid="foundry-force-vector"]'),
        "x1",
        "y1",
        frame.projectedPlayhead,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-force-vector"]'),
        "x2",
        "y2",
        frame.projectedForceTip,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-drive-force-vector"]'),
        "x1",
        "y1",
        frame.projectedDriveOrigin,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-drive-force-vector"]'),
        "x2",
        "y2",
        frame.projectedDriveTip,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-friction-vector"]'),
        "x1",
        "y1",
        frame.projectedPlayhead,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-friction-vector"]'),
        "x2",
        "y2",
        frame.projectedFrictionTip,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-velocity-vector"]'),
        "x1",
        "y1",
        frame.projectedPlayhead,
      );
      setPoint(
        svg.querySelector('[data-testid="foundry-velocity-vector"]'),
        "x2",
        "y2",
        frame.projectedVelocityTip,
      );
      setAttribute(forces, "data-origin-source", frame.playheadSource);
      setAttribute(forces, "data-physics-rule", frame.physicsRule);
      setAttribute(forces, "data-fx", frame.forceRaw.x.toFixed(3));
      setAttribute(forces, "data-fy", frame.forceRaw.y.toFixed(3));
      setAttribute(forces, "data-force-magnitude", frame.forceMagnitude.toFixed(3));
      setAttribute(forces, "data-friction-magnitude", frame.frictionMagnitude.toFixed(3));
      setAttribute(forces, "data-constraint-error", frame.constraintError.toFixed(3));
      setAttribute(velocity, "data-origin-source", frame.playheadSource);
      setAttribute(velocity, "data-vx", frame.velocityRaw.x.toFixed(3));
      setAttribute(velocity, "data-vy", frame.velocityRaw.y.toFixed(3));
      setAttribute(velocity, "data-speed", frame.velocityMagnitude.toFixed(3));
      const forceText = forces?.querySelectorAll("text") ?? [];
      if (forceText[0]) {
        forceText[0].setAttribute("x", String((frame.projectedForceTip?.x ?? 0) + 5));
        forceText[0].setAttribute("y", String((frame.projectedForceTip?.y ?? 0) - 3));
      }
      if (forceText[1]) {
        forceText[1].setAttribute("x", String((frame.projectedDriveTip?.x ?? 0) + 5));
        forceText[1].setAttribute("y", String((frame.projectedDriveTip?.y ?? 0) + 9));
      }
      if (forceText[2]) {
        forceText[2].setAttribute("x", String((frame.projectedFrictionTip?.x ?? 0) + 5));
        forceText[2].setAttribute("y", String((frame.projectedFrictionTip?.y ?? 0) + 9));
      }
      const velocityText = velocity?.querySelector("text");
      if (velocityText) {
        velocityText.setAttribute("x", String((frame.projectedVelocityTip?.x ?? 0) + 5));
        velocityText.setAttribute("y", String((frame.projectedVelocityTip?.y ?? 0) - 3));
      }
    };
    const initial = playback.sample(playback.clock.getPhase());
    if (initial) apply(initial, 0, true);
    return playback.clock.subscribe((clockFrame) => {
      if (!clockFrame.phaseChanged && clockFrame.elapsedMs !== 0) return;
      const frame = playback.sample(clockFrame.phase);
      if (frame) apply(frame, clockFrame.time, clockFrame.elapsedMs === 0);
    });
  }, [playback]);

  return (
  <svg
    ref={overlayRef}
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
        data-handle-contract="move-anchor-plus-shape-handles"
        data-handle-ids={foundryParamHandles.map((handle) => handle.id).join(",")}
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
};

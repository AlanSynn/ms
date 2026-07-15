import React, { useEffect, useRef, useState } from "react";

import type {
  ConnectionSelectionRole,
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import {
  type ConnectionSelectionSceneState,
  type MechanismConnectionHoleCandidate,
} from "../../../utils/mechanismConnectionSelections";
import { defaultPhysicalKit } from "../../../utils/coordinates";
import {
  mechanismPhysicalConnectionCandidates,
  resolveMechanismPhysicalSelectionAttempt,
} from "../../../utils/mechanismPhysicalCandidates";
import {
  projectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
} from "../../../utils/foundryCamera";
import { MECHANISM_BINDING_BLOCKER } from "../../../utils/pathTargets";

export type MechanismConnectionHoleHandle = Omit<MechanismConnectionHoleCandidate, "coordinate"> & { z: number; screen: Point };
export type DraggingMechanismConnectionSelection = {
  role: ConnectionSelectionRole;
  identity: string;
  holeIndex: number;
};
type ConnectionLayer = { sourceNodeId?: string; partKey: string; z: number };
type ConnectionPointerHandler = React.PointerEventHandler<SVGCircleElement>;
type DisplayedConnectionHoleHandle = MechanismConnectionHoleHandle & {
  coincidentOrigin?: Point;
};

const spreadCoincidentConnectionHoleHandles = (
  handles: MechanismConnectionHoleHandle[],
  role: ConnectionSelectionRole | null | undefined,
  projectionSize: FoundryOverlaySize,
): DisplayedConnectionHoleHandle[] => {
  if (!role) return handles;
  const roleHandles = handles.filter((handle) => handle.role === role);
  return handles.map((handle) => {
    if (handle.role !== role) return handle;
    const coincident = roleHandles.filter(
      (candidate) =>
        (candidate.screen.x - handle.screen.x) ** 2 +
          (candidate.screen.y - handle.screen.y) ** 2 <=
        1,
    );
    if (coincident.length < 2) return handle;
    const anchor =
      coincident.find((candidate) => candidate.selected) ??
      coincident.find((candidate) => candidate.provisional) ??
      coincident[0];
    if (handle.identity === anchor?.identity) {
      return { ...handle, coincidentOrigin: handle.screen };
    }
    const alternatives = coincident
      .filter((candidate) => candidate.identity !== anchor?.identity)
      .sort((a, b) => a.identity.localeCompare(b.identity));
    const slot = alternatives.findIndex(
      (candidate) => candidate.identity === handle.identity,
    );
    const angle =
      Math.atan2(
        projectionSize.height / 2 - handle.screen.y,
        projectionSize.width / 2 - handle.screen.x,
      ) +
      (slot - (alternatives.length - 1) / 2) * (Math.PI / 5);
    return {
      ...handle,
      coincidentOrigin: handle.screen,
      screen: {
        x: handle.screen.x + Math.cos(angle) * 30,
        y: handle.screen.y + Math.sin(angle) * 30,
      },
    };
  });
};

const CONNECTION_ROLE_LABELS: Record<ConnectionSelectionRole, string> = {
  "4bar.input-joint": "Input joint",
  "4bar.output-joint": "Output joint",
  "gear_linkage.drive-pin": "Drive pin",
  "gear_linkage.output-pin": "Output pin",
  "gear.drive-pin": "Drive pin",
  "gear.output-pin": "Output pin",
  "planetary_gear.carrier-planet-pivot": "Planet pivot",
  "planetary_gear.carrier-output-hole": "Carrier output",
  "cam.guide-mount": "Guide mount",
  "cam.follower-output-hole": "Follower output",
  "piston.crank-pin": "Crank pin",
  "piston.rod-slider-pin": "Slider pin",
  "piston.guide-mount": "Guide mount",
};

export const connectionRoleLabel = (role: ConnectionSelectionRole) => CONNECTION_ROLE_LABELS[role];

const connectionHandleLabel = (handle: MechanismConnectionHoleHandle) => {
  const choice = handle.selection.kind === "board-mount-pattern"
    ? handle.selection.boardHoleIds.join(" → ")
    : handle.selection.kind === "module-hole"
      ? handle.selection.holeId
      : `hole ${handle.holeIndex + 1}`;
  return `${connectionRoleLabel(handle.role)}, ${handle.partKey}, ${choice}`;
};

export const projectMechanismConnectionHoleHandles = ({
  mechanism,
  state,
  camera,
  projectionSize,
  kit = defaultPhysicalKit(),
  candidates,
  layers = [],
  renderedLayerZ = [],
}: {
  mechanism: MechanismConfig;
  state: ConnectionSelectionSceneState;
  camera: FoundryCamera;
  projectionSize: FoundryOverlaySize;
  kit?: PhysicalKitSettings;
  candidates?: readonly MechanismConnectionHoleCandidate[];
  layers?: readonly ConnectionLayer[];
  renderedLayerZ?: readonly number[];
}): MechanismConnectionHoleHandle[] =>
  (candidates ?? mechanismPhysicalConnectionCandidates(
    mechanism,
    state,
    kit,
    mechanism.connectionSelections,
  )).flatMap((candidate) => {
    const layerIndex = layers.findIndex(
      (layer) =>
        layer.sourceNodeId === candidate.sourceNodeId &&
        (layer.partKey === candidate.printedPartKey ||
          layer.partKey === candidate.partKey),
    );
    const z = layerIndex >= 0
      ? (renderedLayerZ[layerIndex] ?? layers[layerIndex]?.z ?? 0)
      : 0;
    const screen = projectFoundryOverlayPoint(candidate.coordinate, camera, projectionSize, z);
    if (!screen) return [];
    const { coordinate: _coordinate, ...handle } = candidate;
    return [{ ...handle, z, screen }];
  });

export type MechanismConnectionDropResult =
  | { status: "accepted"; updates: Partial<MechanismConfig> }
  | { status: "rejected"; blocker: typeof MECHANISM_BINDING_BLOCKER };

export const resolveMechanismConnectionDrop = (
  mechanism: MechanismConfig,
  target?: MechanismConnectionHoleHandle,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConnectionDropResult => {
  if (!target) return { status: "rejected", blocker: MECHANISM_BINDING_BLOCKER };
  return resolveMechanismPhysicalSelectionAttempt(
    mechanism,
    target.role,
    target.selection,
    kit,
  );
};

type ConnectionDrag = {
  pointerId: number;
  role: ConnectionSelectionRole;
  startX: number;
  startY: number;
  startIdentity: string;
  startHoleIndex: number;
  targetIdentity?: string;
};

const pointerPoint = (
  event: React.PointerEvent<SVGCircleElement>,
  projectionSize: FoundryOverlaySize,
) => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return undefined;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    x: ((event.clientX - rect.left) / rect.width) * projectionSize.width,
    y: ((event.clientY - rect.top) / rect.height) * projectionSize.height,
  };
};

const nearestRoleHandle = (handles: MechanismConnectionHoleHandle[], role: ConnectionSelectionRole, point: Point | undefined) => {
  if (!point) return undefined;
  let nearest: MechanismConnectionHoleHandle | undefined;
  let distanceSq = 28 ** 2;
  for (const handle of handles) {
    if (handle.role !== role) continue;
    const candidateDistanceSq =
      (handle.screen.x - point.x) ** 2 + (handle.screen.y - point.y) ** 2;
    if (candidateDistanceSq > distanceSq) continue;
    if (
      Math.abs(candidateDistanceSq - distanceSq) < 1e-6 &&
      nearest?.selected &&
      !handle.selected
    ) continue;
    nearest = handle;
    distanceSq = candidateDistanceSq;
  }
  return nearest;
};

export const useMechanismConnectionDrag = ({
  mechanism,
  handles,
  projectionSize,
  kit = defaultPhysicalKit(),
  disabled = false,
  onCommit,
  onInteractionStart,
}: {
  mechanism?: MechanismConfig;
  handles: MechanismConnectionHoleHandle[];
  projectionSize: FoundryOverlaySize;
  kit?: PhysicalKitSettings;
  disabled?: boolean;
  onCommit: (updates: Partial<MechanismConfig>) => boolean | void;
  onInteractionStart?: () => void;
}) => {
  const dragRef = useRef<ConnectionDrag | null>(null);
  const [dragging, setDragging] = useState<DraggingMechanismConnectionSelection>();
  const [selectedRole, setSelectedRole] = useState<ConnectionSelectionRole | null>(null);
  const [recoveryRole, setRecoveryRole] = useState<ConnectionSelectionRole | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const interactionHandles = spreadCoincidentConnectionHoleHandles(
    handles,
    dragging?.role ?? recoveryRole,
    projectionSize,
  );
  const beginInteraction = () => onInteractionStart?.();

  useEffect(() => {
    dragRef.current = null;
    setDragging(undefined);
    setSelectedRole(null);
    setRecoveryRole(null);
    setBlocker(null);
  }, [mechanism?.id, mechanism?.targetAnchorJointId, mechanism?.targetPartId, mechanism?.targetPathId, mechanism?.type]);

  useEffect(() => {
    if (!disabled) return;
    dragRef.current = null;
    setDragging(undefined);
    setRecoveryRole(null);
    setBlocker(null);
  }, [disabled]);

  const reject = (role: ConnectionSelectionRole) => {
    setBlocker(MECHANISM_BINDING_BLOCKER);
    setRecoveryRole(role);
  };

  const selectHandle = (target: MechanismConnectionHoleHandle) => {
    if (disabled || !mechanism) return;
    const result = resolveMechanismConnectionDrop(mechanism, target, kit);
    if (result.status === "rejected" || onCommit(result.updates) === false) {
      reject(target.role);
      return;
    }
    setSelectedRole(target.role);
    setRecoveryRole(null);
    setBlocker(null);
  };

  const onPointerDown =
    (handle: MechanismConnectionHoleHandle) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      if (disabled || !mechanism) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; the selected SVG target still owns the drag.
      }
      beginInteraction();
      setSelectedRole(handle.role);
      setBlocker(null);
      setRecoveryRole(null);
      dragRef.current = {
        pointerId: event.pointerId,
        role: handle.role,
        startX: event.clientX,
        startY: event.clientY,
        startIdentity: handle.identity,
        startHoleIndex: handle.holeIndex,
        targetIdentity: handle.identity,
      };
      setDragging({
        role: handle.role,
        identity: handle.identity,
        holeIndex: handle.holeIndex,
      });
    };

  const onPointerMove: ConnectionPointerHandler = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const moved =
      (event.clientX - drag.startX) ** 2 +
        (event.clientY - drag.startY) ** 2 >=
      9;
    const target = moved
      ? nearestRoleHandle(interactionHandles, drag.role, pointerPoint(event, projectionSize))
      : undefined;
    drag.targetIdentity = moved ? target?.identity : drag.startIdentity;
    setDragging({
      role: drag.role,
      identity: target?.identity ?? drag.startIdentity,
      holeIndex: target?.holeIndex ?? drag.startHoleIndex,
    });
  };

  const onPointerUp: ConnectionPointerHandler = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(undefined);
    if (event.type === "pointercancel") {
      setBlocker(null);
      setRecoveryRole(null);
      return;
    }
    const target = interactionHandles.find(
      (handle) =>
        handle.role === drag.role && handle.identity === drag.targetIdentity,
    );
    if (!target) {
      reject(drag.role);
      return;
    }
    selectHandle(target);
  };

  return {
    blocker,
    recoveryRole,
    dragging,
    selectedHandle:
      handles.find((handle) => handle.role === selectedRole && handle.selected) ??
      handles.find((handle) => handle.selected),
    selectHandle,
    beginInteraction,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
};

type MechanismConnectionOverlayProps = {
  surface: "foundry" | "design";
  projectionSize: FoundryOverlaySize;
  handles: MechanismConnectionHoleHandle[];
  dragging?: DraggingMechanismConnectionSelection;
  recoveryRole?: ConnectionSelectionRole | null;
  blocker?: string | null;
  disabled?: boolean;
  onInteractionStart?: () => void;
  onSelect: (handle: MechanismConnectionHoleHandle) => void;
  onPointerDown: (handle: MechanismConnectionHoleHandle) => ConnectionPointerHandler;
  onPointerMove: ConnectionPointerHandler;
  onPointerUp: ConnectionPointerHandler;
};

export const MechanismConnectionOverlay = ({
  surface,
  projectionSize,
  handles,
  dragging,
  recoveryRole,
  blocker,
  disabled = false,
  onInteractionStart,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: MechanismConnectionOverlayProps) => {
  const [keyboardIdentity, setKeyboardIdentity] = useState<string | null>(null);
  const handleRefs = useRef(new Map<string, SVGCircleElement>());
  const keyboardHandle = handles.find(
    (handle) => handle.identity === keyboardIdentity,
  );
  const keyboardRole = keyboardHandle?.role ?? null;
  const displayedHandles = spreadCoincidentConnectionHoleHandles(
    handles,
    dragging?.role ?? keyboardRole ?? recoveryRole,
    projectionSize,
  );
  const visibleHandles = displayedHandles
    .filter((handle) =>
      dragging
        ? handle.role === dragging.role
        : handle.role === keyboardRole ||
          handle.selected ||
          handle.provisional ||
          (recoveryRole === handle.role && handle.recoveryEligible),
    )
    .sort((a, b) => Number(a.selected) - Number(b.selected));

  useEffect(() => {
    if (!keyboardIdentity) return;
    handleRefs.current.get(keyboardIdentity)?.focus();
  }, [keyboardIdentity]);

  useEffect(() => {
    if (keyboardIdentity && !handles.some((handle) => handle.identity === keyboardIdentity)) {
      setKeyboardIdentity(null);
    }
  }, [handles, keyboardIdentity]);

  const onHandleKeyDown = (
    event: React.KeyboardEvent<SVGCircleElement>,
    handle: MechanismConnectionHoleHandle,
  ) => {
    if (disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setKeyboardIdentity(null);
      return;
    }
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (direction) {
      event.preventDefault();
      onInteractionStart?.();
      const roleHandles = handles.filter((candidate) => candidate.role === handle.role);
      const currentIndex = Math.max(
        0,
        roleHandles.findIndex((candidate) => candidate.identity === handle.identity),
      );
      const next = roleHandles[
        (currentIndex + direction + roleHandles.length) % roleHandles.length
      ];
      if (next) setKeyboardIdentity(next.identity);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onInteractionStart?.();
    if (keyboardIdentity === handle.identity && !handle.selected) {
      onSelect(handle);
      setKeyboardIdentity(null);
      return;
    }
    setKeyboardIdentity(handle.identity);
  };

  return (
    <div
      className="mechanism-connection-overlay"
      data-testid={`${surface}-mechanism-connection-overlay`}
      data-direct-manipulation="shared-physical-connections"
      data-invalid-drop-reason={MECHANISM_BINDING_BLOCKER}
      data-disabled={String(disabled)}
    >
      <svg
        viewBox={`0 0 ${projectionSize.width} ${projectionSize.height}`}
        aria-label={`${surface === "foundry" ? "Foundry" : "Design"} physical connection handles`}
      >
        <g
          data-testid="foundry-connection-hole-handles"
          data-authority="physical-affordance"
        >
          {visibleHandles.map((handle) => {
            const isDragTarget =
              dragging?.role === handle.role &&
              dragging.identity === handle.identity;
            const isCandidate = dragging?.role === handle.role && !handle.selected;
            const isRecovery =
              recoveryRole === handle.role && handle.recoveryEligible;
            const label = connectionHandleLabel(handle);
            return (
              <g
                key={handle.identity}
                transform={`translate(${handle.screen.x} ${handle.screen.y})`}
              >
                {handle.coincidentOrigin &&
                  (handle.coincidentOrigin.x !== handle.screen.x ||
                    handle.coincidentOrigin.y !== handle.screen.y) && (
                    <line
                      x1={handle.coincidentOrigin.x - handle.screen.x}
                      y1={handle.coincidentOrigin.y - handle.screen.y}
                      x2="0"
                      y2="0"
                      stroke="#1d4ed8"
                      strokeWidth="2"
                      strokeDasharray="3 3"
                      pointerEvents="none"
                    />
                  )}
                <circle
                  ref={(element) => {
                    if (element) handleRefs.current.set(handle.identity, element);
                    else handleRefs.current.delete(handle.identity);
                  }}
                  role="button"
                  tabIndex={
                    !disabled && (
                      handle.identity === keyboardIdentity ||
                      (!keyboardIdentity && (handle.selected || handle.provisional))
                    )
                      ? 0
                      : -1
                  }
                  aria-label={label}
                  aria-pressed={handle.selected}
                  aria-expanded={keyboardRole === handle.role}
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space Escape"
                  className={`foundry-connection-hole-hit${isRecovery ? " is-recovery" : ""}`}
                  data-testid={`foundry-connection-hole-${handle.role}-${handle.partKey}-${handle.holeIndex}`}
                  data-connection-identity={handle.identity}
                  data-connection-role={handle.role}
                  data-connection-kind={handle.kind}
                  data-connection-part-key={handle.partKey}
                  data-connection-hole-index={handle.holeIndex}
                  data-connection-board-holes={
                    handle.selection.kind === "board-mount-pattern"
                      ? handle.selection.boardHoleIds.join(",")
                      : undefined
                  }
                  data-connection-module-hole={
                    handle.selection.kind === "module-hole"
                      ? handle.selection.holeId
                      : undefined
                  }
                  data-connection-z={handle.z.toFixed(3)}
                  data-connection-selected={String(handle.selected)}
                  data-connection-provisional={String(handle.provisional)}
                  data-coincident-choice={String(Boolean(handle.coincidentOrigin))}
                  data-recovery-candidate={String(isRecovery)}
                  r={isDragTarget || isRecovery ? "11.5" : "10"}
                  fill={
                    isDragTarget
                      ? "rgba(245, 158, 11, 0.34)"
                      : handle.selected
                        ? "#f59e0b"
                        : "rgba(37, 99, 235, 0.18)"
                  }
                  fillOpacity={handle.selected || isDragTarget ? "0.92" : "0.5"}
                  stroke={
                    isDragTarget
                      ? "#b45309"
                      : handle.selected
                        ? "#78350f"
                        : "#1d4ed8"
                  }
                  strokeDasharray={isRecovery ? "4 3" : undefined}
                  strokeOpacity={isCandidate ? "0.75" : "1"}
                  strokeWidth={isDragTarget || isRecovery ? "4" : "3"}
                  onPointerDown={disabled ? undefined : onPointerDown(handle)}
                  onPointerMove={disabled ? undefined : onPointerMove}
                  onPointerUp={disabled ? undefined : onPointerUp}
                  onPointerCancel={disabled ? undefined : onPointerUp}
                  onKeyDown={(event) => onHandleKeyDown(event, handle)}
                />
                {handle.coincidentOrigin ? (
                  <text
                    y="4"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#111827"
                    pointerEvents="none"
                  >
                    {handle.holeIndex + 1}
                  </text>
                ) : (
                  <circle r="3" fill="#111827" pointerEvents="none" />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {blocker && (
        <div
          className="mechanism-connection-recovery warning"
          data-testid={`${surface}-connection-recovery`}
          role="status"
          aria-live="polite"
        >
          {blocker}
        </div>
      )}
    </div>
  );
};

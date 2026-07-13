import { useEffect, useMemo, useRef, useState } from "react";
import { FoundryCanvasPane } from "./FoundryCanvasPane";
import { FoundryInspectorPanel } from "./FoundryInspectorPanel";
import { FoundryWorkflowPanel } from "./FoundryWorkflowPanel";
import type {
  FoundryConnectionHoleHandle,
  FoundryParamHandle,
  FoundryParamHandleId,
  DraggingFoundryConnectionSelection,
} from "./FoundryOverlayLayer";
import {
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
} from "../../../utils/mechanismPreviewStacks";
import {
  clampMechanismParam,
  motionSafeParamRange,
} from "../mechanism/mechanismParamPolicy";
import { constrainMechanismUpdate } from "../../../utils/mechanismEditAuthority";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
  ConnectionSelectionRole,
  FoundryExportPackage,
  MechanismConfig,
  MechanismType,
  Point,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../../../types";
import {
  calculateLinkage,
  generateCurvePoints,
  generateMechanismPointTraces,
  mechanismTraceDefinitionsForState,
} from "../../../utils/kinematics";
import {
  createFoundryPlaybackFrame,
  generateFoundryPlaybackPointTraces,
} from "../../../utils/foundryPlayback";
import { buildFoundryPhysicsOverlay } from "../../../utils/physicsSession";
import {
  FABRICATION_RENDER_LAYER_Z_STEP,
  sampleFeasibleRange,
} from "../../../utils/fabrication";
import { compactStudentActionForFabricationDiagnostic } from "../../../utils/fabricationReadiness";
import { compileMechanismRenderPlan } from "../../../utils/mechanismCompiler";
import {
  authorMechanismConnectionSelection,
  connectionSelectionAccepted,
  connectionSelectionSignature,
  connectionSelectionSceneCoordinates,
  mechanismConnectionHoleCandidates,
  normalizeMechanismConnectionSelections,
} from "../../../utils/mechanismConnectionSelections";
import {
  boardToScene,
  bodyPartPivotScene,
  sceneToBoard,
  SCENE_VIEW,
} from "../../../utils/coordinates";
import {
  FOUNDRY_ANIMATION_COMMIT_MS,
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  clampFoundryPitch,
  clampFoundryZoom,
  projectFoundryOverlayPoint,
  unprojectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import {
  FOUNDRY_MECHANISM_TYPES,
  FOUNDRY_PRESETS,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
} from "../../../utils/mechanismTemplates";
import {
  createMechanismFitContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import {
  fitRecommendedMechanismToSheet,
  fitMechanismToTargetPath,
  normalizeGearMeshMechanism,
} from "../../../utils/mechanismRecommendations";
import {
  createDefaultMechanism,
  mechanismWithGeneratedPath,
  uid,
} from "../../../utils/project";
import { preferredMotionJointId } from "../../../utils/motion";
import {
  mechanismForTargetFields,
  pathOwnedTargetFields,
} from "../../../utils/pathTargets";

const traceDistanceToGeneratedPath = (
  trace: { points: Point[] },
  generatedPath: Point[],
) => {
  if (!trace.points.length || !generatedPath.length)
    return Number.POSITIVE_INFINITY;
  const count = Math.min(12, trace.points.length, generatedPath.length);
  return Array.from({ length: count }, (_, index) => {
    const generatedIndex = Math.round(
      (index * (generatedPath.length - 1)) / Math.max(1, count - 1),
    );
    const traceIndex = Math.round(
      (index * (trace.points.length - 1)) / Math.max(1, count - 1),
    );
    const a = generatedPath[generatedIndex];
    const b = trace.points[traceIndex];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }).reduce((sum, distance) => sum + distance, 0);
};

export const MechanismFoundry = ({
  project,
  foundry,
  setFoundry,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  goStage,
  onExport,
}: {
  project: ProjectState;
  foundry: MechanismConfig;
  setFoundry: (m: MechanismConfig) => void;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  goStage: (stage: AppStage) => void;
  onExport: (pkg: FoundryExportPackage) => void;
}) => {
  const [foundryPlaying, setFoundryPlaying] = useState(false);
  const [foundryPhase, setFoundryPhase] = useState(0);
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);
  const [manualAnchor, setManualAnchor] = useState<Point | null>(null);
  const [showForces, setShowForces] = useState(true);
  const [showVelocity, setShowVelocity] = useState(true);
  const [showTrail, setShowTrail] = useState(false);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showPathPreview, setShowPathPreview] = useState(false);
  const [selectedOutputTraceId, setSelectedOutputTraceId] = useState<
    string | null
  >(null);
  const [showFoundryGrid, setShowFoundryGrid] = useState(true);
  const [showSensemaking, setShowSensemaking] = useState(false);
  const [foundryExplode, setFoundryExplode] = useState(0);
  const [foundryCamera, setFoundryCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [foundryRigOpacity, setFoundryRigOpacity] = useState(85);
  const [lastSelectedConnectionRole, setLastSelectedConnectionRole] =
    useState<ConnectionSelectionRole | null>(null);
  const [foundryProjectionSize, setFoundryProjectionSize] =
    useState<FoundryOverlaySize>(FOUNDRY_OVERLAY_SIZE);
  const [isOrbitingFoundry, setIsOrbitingFoundry] = useState(false);
  const [isZoomingFoundry, setIsZoomingFoundry] = useState(false);
  const [isPanningFoundry, setIsPanningFoundry] = useState(false);
  const foundryOrbitStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    zoom: number;
    pan: Point;
    mode: "orbit" | "zoom" | "pan";
  } | null>(null);
  const foundryParamDragRef = useRef<{
    pointerId: number;
    handle: FoundryParamHandleId;
  } | null>(null);
  const foundryConnectionDragRef = useRef<{
    pointerId: number;
    role: ConnectionSelectionRole;
    startX: number;
    startY: number;
    startHoleIndex: number;
    lastHoleIndex: number;
    moved: boolean;
  } | null>(null);
  const targetReady = Boolean(
    (selectedPart || selectedSceneObject) &&
    selectedPath &&
    selectedPath.enabled &&
    selectedPath.points.length >= 3,
  );
  const targetIkJointId = selectedPart
    ? preferredMotionJointId(
        project,
        selectedPart.id,
        selectedPath?.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId },
      )
    : undefined;
  const foundryPathAnchor =
    selectedPath &&
    foundry.targetPathId === selectedPath.id &&
    Number.isFinite(foundry.anchorX) &&
    Number.isFinite(foundry.anchorY)
      ? { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 }
      : undefined;
  const rawLanding =
    manualAnchor ??
    foundryPathAnchor ??
    (Number.isFinite(foundry.anchorX) && Number.isFinite(foundry.anchorY)
      ? { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 }
      : undefined) ??
    selectedPath?.points[0] ??
    (selectedSceneObject ? selectedSceneObject.transform : undefined) ??
    (selectedPart
      ? bodyPartPivotScene(selectedPart, project.skeleton)
      : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
  const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
  const landing = boardToScene(
    landingBoard.col,
    landingBoard.row,
    project.settings.physicalKit,
  );
  const targetFields = selectedPath
    ? pathOwnedTargetFields(selectedPath)
    : {
        targetPartId: foundry.targetPartId,
        targetSceneObjectId: foundry.targetSceneObjectId,
        targetPathId: foundry.targetPathId,
        targetAnchorJointId: foundry.targetAnchorJointId,
      };
  const targetIdentity = [
    targetFields.targetPartId ?? "",
    targetFields.targetSceneObjectId ?? "",
    targetFields.targetPathId ?? "",
    targetFields.targetAnchorJointId ?? "",
  ].join(":");
  const draftMechanismId = useMemo(() => uid("mech"), [targetIdentity]);
  const foundryMechanismId =
    mechanismForTargetFields(project, targetFields)?.id ?? draftMechanismId;
  const landedFoundry = useMemo(
    () => ({
      ...foundry,
      id: foundryMechanismId,
      anchorX: landing.x,
      anchorY: landing.y,
      sceneAnchor: landing,
    }),
    [foundry, foundryMechanismId, landing.x, landing.y],
  );
  const anchorMarker = {
    x: 180 + (landing.x / SCENE_VIEW.width) * 360,
    y: 120 - (landing.y / SCENE_VIEW.height) * 240,
  };
  const rawFoundryPointTraces = useMemo(() => {
    const traces = generateFoundryPlaybackPointTraces(landedFoundry, 96).traces;
    const selectedTrace = selectedOutputTraceId
      ? traces.find((trace) => trace.id === selectedOutputTraceId)
      : undefined;
    if (selectedTrace)
      return traces.map((trace) => ({
        ...trace,
        primary: trace.id === selectedTrace.id,
      }));
    const generatedPath = landedFoundry.generatedPath ?? [];
    if (!generatedPath.length || traces.length < 2) return traces;
    const fittedTrace = traces.reduce((best, trace) =>
      traceDistanceToGeneratedPath(trace, generatedPath) <
      traceDistanceToGeneratedPath(best, generatedPath)
        ? trace
        : best,
    );
    return traces.map((trace) => ({
      ...trace,
      primary: trace.id === fittedTrace.id,
    }));
  }, [landedFoundry, selectedOutputTraceId]);
  const preview = useMemo(
    () =>
      rawFoundryPointTraces.find((trace) => trace.primary)?.points ??
      rawFoundryPointTraces[0]?.points ??
      generateCurvePoints(landedFoundry, 96).points,
    [landedFoundry, rawFoundryPointTraces],
  );
  const range = useMemo(
    () => sampleFeasibleRange(landedFoundry),
    [landedFoundry],
  );
  const library = MECHANISM_LIBRARY[foundry.type];
  const classroomSensemaking = library.classroomSensemaking;
  const feasibilityText = range.warning ?? "360°";
  const motionWarning = compactStudentActionForFabricationDiagnostic(range.warning);
  const foundryFitContext = useMemo(
    () =>
      createMechanismFitContext(
        landedFoundry,
        360,
        240,
        96,
        selectedPath?.points ?? [],
      ),
    [landedFoundry, selectedPath?.points],
  );
  const foundryPlaybackFrame = useMemo(
    () =>
      createFoundryPlaybackFrame(
        landedFoundry,
        foundryPhase,
        foundryFitContext,
      ),
    [landedFoundry, foundryPhase, foundryFitContext],
  );
  const selectedSimulation = foundryPlaybackFrame.simulation;
  const foundryPointTraces = useMemo(
    () =>
      rawFoundryPointTraces.map((trace) => ({
        ...trace,
        points: trace.points.map(foundryFitContext.map),
      })),
    [foundryFitContext, rawFoundryPointTraces],
  );
  const previewPoints = useMemo(
    () =>
      foundryPointTraces.find((trace) => trace.primary)?.points ??
      foundryPointTraces[0]?.points ??
      fitPointsToBox(preview, 360, 240),
    [foundryPointTraces, preview],
  );
  const foundryUserPathPoints = useMemo(
    () => selectedPath?.points.map(foundryFitContext.map) ?? [],
    [foundryFitContext, selectedPath],
  );
  const selectedPhysicalSimulation = useMemo(
    () => ({
      ...selectedSimulation,
      pathPoints: previewPoints,
      pathD: pointsToSvgPath(previewPoints),
    }),
    [previewPoints, selectedSimulation],
  );
  const physicsOverlay = useMemo(
    () =>
      buildFoundryPhysicsOverlay(
        landedFoundry,
        selectedPhysicalSimulation,
        foundryPlaybackFrame.playbackPhaseRad,
        project.settings,
        previewPoints,
      ),
    [
      landedFoundry,
      selectedPhysicalSimulation,
      foundryPlaybackFrame.playbackPhaseRad,
      project.settings,
      previewPoints,
    ],
  );
  const {
    playhead,
    playheadSource,
    velocityRaw,
    forceRaw,
    velocityTip,
    forceTip,
    frictionTip,
    driveTip,
    velocityMagnitude,
    frictionMagnitude,
    forceMagnitude,
    constraintError,
    rule: physicsRule,
  } = physicsOverlay;
  const foundryRenderPlan = useMemo(
    () =>
      compileMechanismRenderPlan(landedFoundry, project.settings.physicalKit),
    [landedFoundry, project.settings.physicalKit],
  );
  const selectedConnectionState =
    foundryRenderPlan.connectionSelectionSummary ??
    normalizeMechanismConnectionSelections(
      landedFoundry,
      landedFoundry.connectionSelections,
      landedFoundry.connectionSelectionValidation,
    );
  const foundryTopLayer = foundryRenderPlan.layers.at(-1);
  const foundryStackLayerZ = useMemo(
    () =>
      foundryRenderPlan.layers.map(
        (item, presentationIndex) =>
          item.z +
          (foundryExplode / 100) *
            presentationIndex *
            FABRICATION_RENDER_LAYER_Z_STEP *
            1.5,
      ),
    [foundryExplode, foundryRenderPlan.layers],
  );
  const foundryRenderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        foundryRenderPlan.layers,
        foundryStackLayerZ,
      ),
    [foundryRenderPlan.layers, foundryStackLayerZ],
  );
  const foundryOverlayPinStacks = useMemo(
    () =>
      foundryPinStacks(
        foundryPinStackPoints(
          foundryRenderPlan,
          { state: selectedSimulation.state },
        ),
        foundryRenderPlan,
      ),
    [
      foundryRenderPlan,
      selectedSimulation.state,
    ],
  );
  const foundryOverlayPinStackById = useMemo(
    () => new Map(foundryOverlayPinStacks.map((pin) => [pin.id, pin])),
    [foundryOverlayPinStacks],
  );
  const foundryOverlayZ =
    (foundryTopLayer?.z ?? 0.22) +
    (foundryTopLayer
      ? (foundryExplode / 100) *
        Math.max(0, foundryRenderPlan.layers.length - 1) *
        FABRICATION_RENDER_LAYER_Z_STEP *
        1.5
      : 0) +
    0.18;
  const foundryOverlayZForHandle = (handleId?: string) => {
    const pin = foundryOverlayPinStackById.get(
      handleId === "M" ? "A" : (handleId ?? ""),
    );
    if (landedFoundry.type === "4bar" && (handleId === "A" || handleId === "D"))
      return pin?.bottomZ ?? foundryOverlayZ;
    return pin?.topZ ?? foundryOverlayZ;
  };
  const projectOverlay = (point: Point | undefined) =>
    projectFoundryOverlayPoint(
      point,
      foundryCamera,
      foundryProjectionSize,
      foundryOverlayZ,
    );
  const projectedPlayhead = projectOverlay(playhead);
  const projectedVelocityTip = projectOverlay(velocityTip);
  const projectedForceTip = projectOverlay(forceTip);
  const projectedFrictionTip = projectOverlay(frictionTip);
  const projectedDriveOrigin = projectOverlay(selectedSimulation.state.j1);
  const projectedDriveTip = projectOverlay(driveTip);
  const projectedAnchorMarker = projectFoundryOverlayPoint(
    anchorMarker,
    foundryCamera,
    foundryProjectionSize,
    0,
  );
  const paramHasSafeTravel = (key: keyof MechanismConfig) => {
    const range = motionSafeParamRange(
      landedFoundry,
      key,
      project.settings.physicalKit,
    );
    return Boolean(
      range?.currentSafe && Math.abs(range.max - range.min) > 0.001,
    );
  };
  const fourBarInputAuthored = connectionSelectionAccepted(
    selectedConnectionState.connectionSelectionValidation,
    "4bar.input-joint",
  );
  const fourBarOutputAuthored = connectionSelectionAccepted(
    selectedConnectionState.connectionSelectionValidation,
    "4bar.output-joint",
  );
  const rawFoundryParamHandles: Array<
    Omit<FoundryParamHandle, "z" | "screen">
  > = [
    {
      id: "M",
      label: "Move",
      point: selectedSimulation.state.p1,
      draggable: true,
    },
    ...(landedFoundry.type === "4bar"
      ? [
          {
            id: "A" as const,
            label: "A fixed",
            point: selectedSimulation.state.p1,
            draggable: false,
          },
          {
            id: "B" as const,
            label: "B crank",
            point: selectedSimulation.state.j1,
            draggable:
              !fourBarInputAuthored &&
              (fourBarOutputAuthored || paramHasSafeTravel("crankLength")),
          },
          {
            id: "C" as const,
            label: "C output",
            point: selectedSimulation.state.j2,
            draggable:
              !fourBarOutputAuthored &&
              (fourBarInputAuthored ||
                paramHasSafeTravel("couplerLength") ||
                paramHasSafeTravel("rockerLength")),
          },
          {
            id: "D" as const,
            label: "D ground",
            point: selectedSimulation.state.p2,
            draggable: paramHasSafeTravel("groundLength"),
          },
        ]
      : []),
  ];
  const foundryParamHandles: FoundryParamHandle[] =
    rawFoundryParamHandles.flatMap((handle) => {
      const z = foundryOverlayZForHandle(handle.id);
      const screen = projectFoundryOverlayPoint(
        handle.point,
        foundryCamera,
        foundryProjectionSize,
        z,
      );
      return screen ? [{ ...handle, z, screen }] : [];
    });
  const foundryParamHandleZSummary = foundryParamHandles
    .map((handle) => `${handle.id}:${handle.z.toFixed(2)}`)
    .join(",");

  const authoredConnectionSelectionCoordinates = useMemo(
    () =>
      connectionSelectionSceneCoordinates(
        landedFoundry,
        selectedSimulation.state,
        selectedConnectionState.connectionSelections,
      ),
    [
      landedFoundry,
      selectedConnectionState.connectionSelections,
      selectedSimulation.state,
    ],
  );
  const connectionExportSignature = connectionSelectionSignature(
    foundryRenderPlan.connectionSelectionSummary?.connectionSelections ?? {},
  );
  const connectionHoleHandles: FoundryConnectionHoleHandle[] = useMemo(() => {
    const zForConnection = (
      role: ConnectionSelectionRole,
      selection: FoundryConnectionHoleHandle["selection"],
    ) => {
      const target =
        role === "4bar.input-joint"
          ? { sourceNodeId: "input-link", renderKind: "linkage" }
          : role === "4bar.output-joint"
            ? { sourceNodeId: "output-link", renderKind: "linkage" }
            : selection.kind === "gear-attachment-hole"
              ? { sourceNodeId: `gear-${selection.gearIndex}`, renderKind: "gear" }
              : undefined;
      const index = target
        ? foundryRenderPlan.layers.findIndex(
            (layer) =>
              layer.sourceNodeId === target.sourceNodeId &&
              layer.renderKind === target.renderKind,
          )
        : -1;
      return index >= 0 ? (foundryRenderedLayerZ[index] ?? 0) : 0;
    };

    return mechanismConnectionHoleCandidates(
      landedFoundry,
      selectedSimulation.state,
      landedFoundry.connectionSelections,
    ).flatMap((candidate) => {
      const { coordinate, ...handle } = candidate;
      const z = zForConnection(handle.role, handle.selection);
      const screen = projectFoundryOverlayPoint(
        coordinate,
        foundryCamera,
        foundryProjectionSize,
        z,
      );
      return screen ? [{ ...handle, z, screen }] : [];
    });
  }, [
    foundryCamera,
    foundryProjectionSize,
    foundryRenderedLayerZ,
    foundryRenderPlan.layers,
    landedFoundry,
    selectedSimulation.state,
  ]);
  const selectedConnectionHandle =
    connectionHoleHandles.find((handle) => handle.role === lastSelectedConnectionRole && handle.selected) ??
    connectionHoleHandles.find((handle) => handle.selected);
  const primaryOutputTrace =
    rawFoundryPointTraces.find((trace) => trace.primary) ??
    rawFoundryPointTraces[0];
  const outputTraceLabel = primaryOutputTrace?.id ?? "—";
  const cycleOutputTrace = () => {
    if (rawFoundryPointTraces.length < 2) return;
    const currentIndex = Math.max(
      0,
      rawFoundryPointTraces.findIndex(
        (trace) => trace.id === primaryOutputTrace?.id,
      ),
    );
    const next =
      rawFoundryPointTraces[(currentIndex + 1) % rawFoundryPointTraces.length];
    setSelectedOutputTraceId(next?.id ?? null);
    setShowPathPreview(true);
  };
  const hardBlocked =
    !targetReady ||
    range.percentValid === 0 ||
    selectedConnectionState.connectionSelectionValidation?.status === "invalid" ||
    !Number.isFinite(landing.x) ||
    !Number.isFinite(landing.y);
  const foundryCameraLabel =
    foundryCamera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[foundryCamera.preset].label;
  const foundryPhaseDegrees = Math.round(
    ((((foundryPhase / (Math.PI * 2)) % 1) + 1) % 1) * 360,
  );
  const applyAnchor = (point: Point) => {
    const board = sceneToBoard(point, project.settings.physicalKit);
    const snapped = boardToScene(
      board.col,
      board.row,
      project.settings.physicalKit,
    );
    setManualAnchor(snapped);
    setFoundry({
      ...foundry,
      anchorX: snapped.x,
      anchorY: snapped.y,
      sceneAnchor: snapped,
      transform: {
        ...(foundry.transform ?? {
          x: snapped.x,
          y: snapped.y,
          rotation: foundry.groundAngle ?? 0,
          scale: 1,
        }),
        x: snapped.x,
        y: snapped.y,
      },
    });
  };
  const updateFoundryProjectionSize = (size: FoundryOverlaySize) =>
    setFoundryProjectionSize((prev) =>
      Math.abs(prev.width - size.width) < 1 &&
      Math.abs(prev.height - size.height) < 1
        ? prev
        : size,
    );
  const handleAnchorPick = (point: Point) => {
    if (!isPickingAnchor) return;
    applyAnchor(point);
    setIsPickingAnchor(false);
  };
  const setCameraPreset = (preset: Exclude<FoundryViewPreset, "custom">) =>
    setFoundryCamera({
      ...FOUNDRY_VIEW_PRESETS[preset],
      preset,
      pan: { x: 0, y: 0 },
    });
  const handleFoundryPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      isPickingAnchor ||
      (event.button !== 0 && event.button !== 1 && event.button !== 2)
    )
      return;
    const mode = event.altKey
      ? "zoom"
      : event.shiftKey || event.button === 1 || event.button === 2
        ? "pan"
        : "orbit";
    foundryOrbitStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: foundryCamera.yaw,
      pitch: foundryCamera.pitch,
      zoom: foundryCamera.zoom,
      pan: foundryCamera.pan ?? { x: 0, y: 0 },
      mode,
    };
    setIsOrbitingFoundry(mode === "orbit");
    setIsZoomingFoundry(mode === "zoom");
    setIsPanningFoundry(mode === "pan");
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleFoundryPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const start = foundryOrbitStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (start.mode === "zoom") {
      setFoundryCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: clampFoundryZoom(start.zoom + (start.y - event.clientY) * 0.006),
        preset: "custom",
        pan: start.pan,
      });
      return;
    }
    if (start.mode === "pan") {
      const scale = 0.018 / Math.max(0.45, start.zoom);
      setFoundryCamera({
        yaw: start.yaw,
        pitch: start.pitch,
        zoom: start.zoom,
        preset: "custom",
        pan: {
          x: start.pan.x - (event.clientX - start.x) * scale,
          y: start.pan.y + (event.clientY - start.y) * scale,
        },
      });
      return;
    }
    setFoundryCamera({
      yaw: start.yaw + (event.clientX - start.x) * 0.45,
      pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
      zoom: start.zoom,
      preset: "custom",
      pan: start.pan,
    });
  };
  const finishFoundryOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (foundryOrbitStartRef.current?.pointerId === event.pointerId) {
      foundryOrbitStartRef.current = null;
      setIsOrbitingFoundry(false);
      setIsZoomingFoundry(false);
      setIsPanningFoundry(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleFoundryWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isPickingAnchor) return;
    event.preventDefault();
    event.stopPropagation();
    setFoundryCamera((prev) => ({
      ...prev,
      zoom: clampFoundryZoom(prev.zoom * (event.deltaY < 0 ? 1.1 : 0.9)),
      preset: "custom",
    }));
  };
  const refreshEditedFoundryMechanism = (mechanism: MechanismConfig) => {
    const normalized = normalizeGearMeshMechanism(mechanism);
    if (normalized.type !== "4bar" || !normalized.generatedPath?.length)
      return mechanismWithGeneratedPath(normalized);
    const bcTraces = generateMechanismPointTraces(normalized, 96).traces.filter(
      (trace) => trace.id === "B" || trace.id === "C",
    );
    if (bcTraces.length === 0) return mechanismWithGeneratedPath(normalized);
    const selectedTrace = bcTraces.reduce((best, trace) =>
      traceDistanceToGeneratedPath(trace, normalized.generatedPath ?? []) <
      traceDistanceToGeneratedPath(best, normalized.generatedPath ?? [])
        ? trace
        : best,
    );
    return mechanismWithGeneratedPath(
      { ...normalized, generatedPath: selectedTrace.points },
      { preserveGeneratedPath: true },
    );
  };
  const applyDirectFoundryUpdates = (updates: Partial<MechanismConfig>) => {
    if (!Object.keys(updates).length) return;
    setFoundry(refreshEditedFoundryMechanism({ ...foundry, ...updates }));
  };
  const applySafeFoundryUpdates = (updates: Partial<MechanismConfig>) => {
    const constrainedUpdates = constrainMechanismUpdate(
      foundry,
      updates,
      project.settings.physicalKit,
    );
    if (!Object.keys(constrainedUpdates).length) return;
    applyDirectFoundryUpdates(constrainedUpdates);
  };
  const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
    if (key === "anchorX" || key === "anchorY") {
      const anchor = {
        x: key === "anchorX" ? value : (foundry.anchorX ?? landing.x),
        y: key === "anchorY" ? value : (foundry.anchorY ?? landing.y),
      };
      setManualAnchor(anchor);
      applySafeFoundryUpdates({
        [key]: value,
        sceneAnchor: anchor,
        transform: {
          ...(foundry.transform ?? {
            x: anchor.x,
            y: anchor.y,
            rotation: foundry.groundAngle ?? 0,
            scale: 1,
          }),
          x: anchor.x,
          y: anchor.y,
        },
      } as Partial<MechanismConfig>);
      return;
    }
    applySafeFoundryUpdates({ [key]: value } as Partial<MechanismConfig>);
  };
  const updateFoundryParams = (updates: Partial<MechanismConfig>) => {
    if (updates.connectionSelections) {
      setFoundry(mechanismWithGeneratedPath({ ...foundry, ...updates }));
      return;
    }
    if (foundry.type === "gear_linkage" && updates.gearTrainRadii) {
      applyDirectFoundryUpdates(updates);
      return;
    }
    applySafeFoundryUpdates(updates);
  };
  const foundryPointFromOverlayEvent = (
    event: React.PointerEvent<SVGCircleElement>,
    handleId?: string,
  ) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return unprojectFoundryOverlayPoint(
      {
        x:
          ((event.clientX - rect.left) / rect.width) *
          foundryProjectionSize.width,
        y:
          ((event.clientY - rect.top) / rect.height) *
          foundryProjectionSize.height,
      },
      foundryCamera,
      foundryProjectionSize,
      foundryOverlayZForHandle(handleId),
    );
  };
  const applyFoundryParamHandleDrag = (
    handle: FoundryParamHandleId,
    point: Point,
  ) => {
    const s = selectedSimulation.state;
    const scale = Math.max(0.001, selectedSimulation.scale);
    const sceneDistance = (a: Point, b: Point) =>
      Math.hypot(a.x - b.x, a.y - b.y) / scale;
    if (handle === "M") {
      applyAnchor({
        x: landing.x + (point.x - s.p1.x) / scale,
        y: landing.y - (point.y - s.p1.y) / scale,
      });
      return;
    }
    if (handle === "B") {
      updateFoundryParam(
        "crankLength",
        clampMechanismParam("crankLength", sceneDistance(s.p1, point)),
      );
      return;
    }
    if (handle === "D") {
      updateFoundryParams({
        groundLength: clampMechanismParam(
          "groundLength",
          sceneDistance(s.p1, point),
        ),
        groundAngle:
          (Math.atan2(point.y - s.p1.y, point.x - s.p1.x) * 180) / Math.PI,
      });
      return;
    }
    updateFoundryParams({
      couplerLength: clampMechanismParam(
        "couplerLength",
        sceneDistance(s.j1, point),
      ),
      ...(fourBarOutputAuthored
        ? {}
        : {
            rockerLength: clampMechanismParam(
              "rockerLength",
              sceneDistance(s.p2, point),
            ),
          }),
    });
  };

  const foundryConnectionHolePointFromEvent = (
    event: React.PointerEvent<SVGCircleElement>,
  ) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return {
      x:
        ((event.clientX - rect.left) / rect.width) *
        foundryProjectionSize.width,
      y:
        ((event.clientY - rect.top) / rect.height) *
        foundryProjectionSize.height,
    };
  };
  const connectionSnapDistanceSq = 24 ** 2;
  const pickConnectionHoleByRole = (
    role: ConnectionSelectionRole,
    point: Point,
  ) => {
    const candidates = connectionHoleHandles.filter(
      (candidate) => candidate.role === role,
    );
    if (!candidates.length) return undefined;
    let best = { handle: candidates[0], distanceSq: Number.POSITIVE_INFINITY };
    for (const candidate of candidates) {
      const dx = candidate.screen.x - point.x;
      const dy = candidate.screen.y - point.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < best.distanceSq) {
        best = { handle: candidate, distanceSq };
      }
    }
    return best.distanceSq <= connectionSnapDistanceSq
      ? best.handle.holeIndex
      : undefined;
  };
  const pickConnectionHoleUnderPointer = (
    event: React.PointerEvent<SVGCircleElement>,
    role: ConnectionSelectionRole,
  ) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const hit = svg.ownerDocument.elementFromPoint(
      event.clientX,
      event.clientY,
    );
    if (!hit) return undefined;
    const target = hit.closest("circle.foundry-connection-hole-hit");
    if (!target) return undefined;
    if (target.getAttribute("data-connection-role") !== role) {
      return undefined;
    }
    const holeIndex = Number(target.getAttribute("data-connection-hole-index"));
    return Number.isFinite(holeIndex) &&
      connectionHoleHandles.some(
        (candidate) =>
          candidate.role === role && candidate.holeIndex === holeIndex,
      )
      ? holeIndex
      : undefined;
  };
  const setConnectionHoleSelection = (selection: {
    role: ConnectionSelectionRole;
    holeIndex: number;
  }) => {
    const target = connectionHoleHandles.find(
      (candidate) =>
        candidate.role === selection.role &&
        candidate.holeIndex === selection.holeIndex,
    );
    if (!target) return;
    updateFoundryParams(
      authorMechanismConnectionSelection(
        landedFoundry,
        target.role,
        target.selection,
      ),
    );
    setLastSelectedConnectionRole(target.role);
  };
  const [draggingConnectionSelection, setDraggingConnectionSelection] =
    useState<DraggingFoundryConnectionSelection | undefined>(undefined);
  const handleConnectionHolePointerDown =
    (handle: FoundryConnectionHoleHandle) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        Number.isFinite(event.pointerId) &&
        !event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setFoundryPlaying(false);
      setLastSelectedConnectionRole(handle.role);
      foundryConnectionDragRef.current = {
        pointerId: event.pointerId,
        role: handle.role,
        startX: event.clientX,
        startY: event.clientY,
        startHoleIndex: handle.holeIndex,
        lastHoleIndex: handle.holeIndex,
        moved: false,
      };
      setDraggingConnectionSelection({
        role: handle.role,
        holeIndex: handle.holeIndex,
      });
    };
  const handleConnectionHolePointerMove =
    (_handle: FoundryConnectionHoleHandle) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      const drag = foundryConnectionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = foundryConnectionHolePointFromEvent(event);
      if (!point) return;
      const moveSq =
        (event.clientX - drag.startX) ** 2 +
        (event.clientY - drag.startY) ** 2;
      if (!drag.moved && moveSq < 9) {
        setDraggingConnectionSelection({
          role: drag.role,
          holeIndex: drag.lastHoleIndex,
        });
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
      }
      const snapHoleIndex = pickConnectionHoleByRole(drag.role, point);
      drag.lastHoleIndex = snapHoleIndex ?? drag.startHoleIndex;
      setDraggingConnectionSelection({
        role: drag.role,
        holeIndex: drag.lastHoleIndex,
      });
    };
  const handleConnectionHolePointerUp =
    (_handle: FoundryConnectionHoleHandle) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      const drag = foundryConnectionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const cancelled = event.type === "pointercancel";
      const point = foundryConnectionHolePointFromEvent(event);
      const underPointerHole = pickConnectionHoleUnderPointer(event, drag.role);
      const nearHole =
        point &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= foundryProjectionSize.width &&
        point.y <= foundryProjectionSize.height
          ? pickConnectionHoleByRole(drag.role, point)
          : undefined;
      const snapHoleIndex = underPointerHole ?? nearHole;
      foundryConnectionDragRef.current = null;
      setDraggingConnectionSelection(undefined);
      if (cancelled || snapHoleIndex === undefined) return;
      const target = connectionHoleHandles.find(
        (candidate) =>
          candidate.role === drag.role && candidate.holeIndex === snapHoleIndex,
      );
      if (target) {
        setConnectionHoleSelection({
          role: target.role,
          holeIndex: target.holeIndex,
        });
      }
    };
  const handleFoundryParamPointerDown =
    (handle: FoundryParamHandleId) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      foundryParamDragRef.current = { pointerId: event.pointerId, handle };
      setFoundryPlaying(false);
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  const handleFoundryParamPointerMove = (
    event: React.PointerEvent<SVGCircleElement>,
  ) => {
    const drag = foundryParamDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = foundryPointFromOverlayEvent(event, drag.handle);
    if (point) applyFoundryParamHandleDrag(drag.handle, point);
  };
  const handleFoundryParamPointerUp = (
    event: React.PointerEvent<SVGCircleElement>,
  ) => {
    if (foundryParamDragRef.current?.pointerId === event.pointerId) {
      foundryParamDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keepCurrentAnchor = (mechanism: MechanismConfig): MechanismConfig => ({
    ...mechanism,
    anchorX: landing.x,
    anchorY: landing.y,
    sceneAnchor: landing,
    transform: {
      ...(mechanism.transform ?? {
        x: landing.x,
        y: landing.y,
        rotation: mechanism.groundAngle ?? 0,
        scale: 1,
      }),
      x: landing.x,
      y: landing.y,
    },
  });
  const setAnchoredFoundry = (mechanism: MechanismConfig) => {
    const anchored = normalizeGearMeshMechanism(keepCurrentAnchor(mechanism));
    setFoundry(fitRecommendedMechanismToSheet(project, anchored));
  };
  const createPathFittedFoundry = (mechanism: MechanismConfig) => {
    const anchored = keepCurrentAnchor(mechanism);
    if (!targetReady || !selectedPath)
      return normalizeGearMeshMechanism(anchored);
    return fitMechanismToTargetPath(
      project,
      {
        ...anchored,
        targetPartId: selectedPath.sceneObjectId
          ? undefined
          : selectedPath.partId,
        targetSceneObjectId: selectedPath.sceneObjectId,
        targetPathId: selectedPath.id,
        targetAnchorJointId: selectedPath.sceneObjectId
          ? undefined
          : targetIkJointId,
        activeVisualPartIds: selectedPath.sceneObjectId
          ? []
          : [selectedPath.partId],
        source: "optimized",
        recommendation: mechanism.recommendation ?? "Fit path",
      },
      selectedPath.id,
    );
  };
  const applyPathFit = (mechanism = foundry) => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
    setSelectedOutputTraceId(null);
    setShowUserPathPreview(true);
    setShowPathPreview(true);
    setFoundry(createPathFittedFoundry(mechanism));
  };
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
    setSelectedOutputTraceId(null);
    setIsPickingAnchor(false);
    setShowForces(true);
    setShowVelocity(true);
    setShowTrail(false);
    setShowUserPathPreview(true);
    setShowPathPreview(false);
    setFoundryExplode(0);
    setFoundryCamera({
      ...FOUNDRY_VIEW_PRESETS.iso,
      preset: "iso",
      pan: { x: 0, y: 0 },
    });
    setAnchoredFoundry({
      ...createDefaultMechanism(foundry.type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    });
  };
  useEffect(() => {
    if (!foundryPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const elapsed = time - last;
      if (elapsed >= FOUNDRY_ANIMATION_COMMIT_MS) {
        last = time - (elapsed % FOUNDRY_ANIMATION_COMMIT_MS);
        setFoundryPhase(
          (prev) =>
            (prev +
              Math.min(96, elapsed) *
                0.0025 *
                project.settings.animationSpeed) %
            (Math.PI * 2),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [foundryPlaying, project.settings.animationSpeed]);
  const makePackage = (): FoundryExportPackage => {
    const mechanismId = landedFoundry.id;
    const state = calculateLinkage(landedFoundry, 0);
    const physicalOutputPoint =
      mechanismTraceDefinitionsForState(landedFoundry.type, state).find(
        (trace) => trace.id === primaryOutputTrace?.id,
      )?.point ??
      (landedFoundry.type === "4bar" ||
      landedFoundry.type === "5bar" ||
      landedFoundry.type === "6bar"
        ? state.j2
        : (state.effector ?? state.j2));
    const preset = foundry.presetId ?? "balanced";
    return {
      id: `foundry-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      mechanismId,
      mechanismType: landedFoundry.type,
      parameters: { ...landedFoundry, id: mechanismId },
      pivot: landing,
      outputPoint: state.isValid ? physicalOutputPoint : undefined,
      generatedPath: preview,
      simulationSummary: feasibilityText,
      visual: {
        color: landedFoundry.color,
        scale: landedFoundry.transform?.scale ?? 1,
        constraintsVisible: true,
      },
      animation: {
        duration: selectedPath?.duration ?? 3200,
        steps: preview.length,
        loop: true,
      },
      targetPartId: selectedPart?.id,
      targetSceneObjectId: selectedSceneObject?.id,
      targetPathId: selectedPath?.id,
      targetAnchorJointId: targetIkJointId,
      metadata: {
        sourceTab: "mechanism-foundry",
        selectedPreset: preset,
        recommendation:
          foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation,
        simulationFriction: project.settings.simulationFriction,
        simulationMassKg: project.settings.simulationMassKg,
        connectionExportSignature,
      },
      warnings: motionWarning ? [motionWarning] : [],
      source: "mechanism-foundry",
    };
  };
  const useFoundryMechanism = () => onExport(makePackage());
  const selectFoundryMechanismType = (type: MechanismType) => {
    setSelectedOutputTraceId(null);
    const next = {
      ...createDefaultMechanism(type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    };
    setAnchoredFoundry(next);
  };
  const selectFoundryPreset = (presetId: string) => {
    setSelectedOutputTraceId(null);
    const preset = FOUNDRY_PRESETS[presetId];
    const { label: _label, ...updates } = preset;
    const base =
      presetId === "balanced"
        ? createDefaultMechanism(foundry.type, "foundry-preview")
        : foundry;
    const next = {
      ...base,
      color: foundry.color,
      ...updates,
      presetId,
      recommendation: preset.recommendation,
    };
    setAnchoredFoundry(next);
  };
  return (
    <EditorStageFrame
      stage="foundry"
      className="foundry-stage-frame"
      layout={{
        workflow: workflowPane(
          <FoundryWorkflowPanel
            project={project}
            goStage={goStage}
            foundry={foundry}
            foundryPhase={foundryPhase}
            targetReady={targetReady}
            isPickingAnchor={isPickingAnchor}
            hardBlocked={hardBlocked}
            onToggleAnchorPick={() => setIsPickingAnchor((value) => !value)}
            onFitPath={() => applyPathFit()}
            onUseMechanism={useFoundryMechanism}
            onSelectMechanismType={selectFoundryMechanismType}
          />,
        ),
        canvas: canvasPane(
          <FoundryCanvasPane
            foundry={foundry}
            landedFoundry={landedFoundry}
            foundryPlaying={foundryPlaying}
            foundryPhase={foundryPhase}
            foundryPhaseDegrees={foundryPhaseDegrees}
            foundryCamera={foundryCamera}
            foundryCameraLabel={foundryCameraLabel}
            foundryRigOpacity={foundryRigOpacity}
            foundryExplode={foundryExplode}
            foundryProjectionSize={foundryProjectionSize}
            selectedPhysicalSimulation={selectedPhysicalSimulation}
            previewPoints={previewPoints}
            foundryPointTraces={foundryPointTraces}
            userPathPoints={foundryUserPathPoints}
            targetPathId={selectedPath?.id}
            kit={project.settings.physicalKit}
            showFoundryGrid={showFoundryGrid}
            showUserPathPreview={showUserPathPreview}
            showPathPreview={showPathPreview}
            showTrail={showTrail}
            showForces={showForces}
            showVelocity={showVelocity}
            outputTraceLabel={outputTraceLabel}
            canCycleOutputTrace={rawFoundryPointTraces.length > 1}
            isPickingAnchor={isPickingAnchor}
            isOrbitingFoundry={isOrbitingFoundry}
            isZoomingFoundry={isZoomingFoundry}
            isPanningFoundry={isPanningFoundry}
            physicsRule={physicsRule}
            motionWarning={motionWarning}
            velocityMagnitude={velocityMagnitude}
            forceMagnitude={forceMagnitude}
            frictionCoefficient={project.settings.simulationFriction}
            frictionMagnitude={frictionMagnitude}
            constraintError={constraintError}
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
            foundryParamHandles={foundryParamHandles}
            foundryParamHandleZSummary={foundryParamHandleZSummary}
            connectionHoleHandles={connectionHoleHandles}
            connectionSelectionCoordinates={authoredConnectionSelectionCoordinates}
            connectionExportSignature={connectionExportSignature}
            selectedConnection={selectedConnectionHandle ? { role: selectedConnectionHandle.role, kind: selectedConnectionHandle.kind, holeIndex: selectedConnectionHandle.holeIndex } : undefined}
            hasManualAnchor={Boolean(manualAnchor)}
            landingBoardLabel={landingBoard.label}
            onSetCameraPreset={setCameraPreset}
            onToggleGrid={() => setShowFoundryGrid((value) => !value)}
            onToggleUserPathPreview={() =>
              setShowUserPathPreview((value) => !value)
            }
            onTogglePathPreview={() => setShowPathPreview((value) => !value)}
            onToggleForces={() => setShowForces((value) => !value)}
            onToggleVelocity={() => setShowVelocity((value) => !value)}
            onCycleOutputTrace={cycleOutputTrace}
            onToggleTrail={() => setShowTrail((value) => !value)}
            onTogglePlaying={() => setFoundryPlaying((value) => !value)}
            onResetPreview={resetFoundryPreview}
            onPhaseChange={(degrees) => {
              setFoundryPlaying(false);
              setFoundryPhase((degrees * Math.PI) / 180);
            }}
            onAnchorPick={handleAnchorPick}
            onPointerDown={handleFoundryPointerDown}
            onPointerMove={handleFoundryPointerMove}
            onPointerUp={finishFoundryOrbit}
            onPointerCancel={finishFoundryOrbit}
            onWheel={handleFoundryWheel}
            onProjectionSizeChange={updateFoundryProjectionSize}
            onParamPointerDown={handleFoundryParamPointerDown}
            onParamPointerMove={handleFoundryParamPointerMove}
            onParamPointerUp={handleFoundryParamPointerUp}
            onConnectionHolePointerDown={handleConnectionHolePointerDown}
            onConnectionHolePointerMove={handleConnectionHolePointerMove}
            onConnectionHolePointerUp={handleConnectionHolePointerUp}
            draggingConnectionSelection={draggingConnectionSelection}
          />,
        ),
        inspector: inspectorPane(
          <FoundryInspectorPanel
            foundry={foundry}
            kit={project.settings.physicalKit}
            libraryLabel={library.label}
            classroomAssessmentKey={project.settings.classroomAssessmentKey}
            classroomSensemaking={classroomSensemaking}
            foundryRigOpacity={foundryRigOpacity}
            foundryExplode={foundryExplode}
            showSensemaking={showSensemaking}
            onRigOpacityChange={setFoundryRigOpacity}
            onExplodeChange={setFoundryExplode}
            onUpdateParams={updateFoundryParams}
            onChangeParam={updateFoundryParam}
            onSetMechanismType={selectFoundryMechanismType}
            onSetPreset={selectFoundryPreset}
            onToggleSensemaking={() => setShowSensemaking((value) => !value)}
          />,
        ),
      }}
    />
  );
};

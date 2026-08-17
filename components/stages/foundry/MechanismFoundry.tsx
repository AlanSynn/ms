import { useEffect, useMemo, useRef, useState } from "react";
import { FoundryCanvasPane } from "./FoundryCanvasPane";
import { useWorkspacePlaybackLoop } from "../../../hooks/useWorkspacePlaybackLoop";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import { FoundryInspectorPanel } from "./FoundryInspectorPanel";
import { FoundryWorkflowPanel } from "./FoundryWorkflowPanel";
import type {
  FoundryOverlayPlaybackFrame,
  FoundryParamHandle,
  FoundryParamHandleId,
} from "./FoundryOverlayLayer";
import {
  foundryAssemblyPinPoints,
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
  isMovingRenderKind,
} from "./foundryPreviewStacks";
import { clampMechanismParam } from "../mechanism/mechanismParamPolicy";
import {
  EditorStageFrame,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type {
  AppStage,
  BodyPartLayer,
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
  feasibilityStatusForRange,
  fabricationRenderPlanForMechanism,
  sampleFeasibleRange,
} from "../../../utils/fabrication";
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
  fitMechanismToTargetPath,
  normalizeGearMeshMechanism,
} from "../../../utils/mechanismRecommendations";
import { createDefaultMechanism, mechanismWithGeneratedPath, uid } from "../../../utils/project";
import {
  mechanismPathFitIsUsable,
  preferredMotionJointId,
} from "../../../utils/motion";

const traceDistanceToGeneratedPath = (
  trace: { points: Point[] },
  generatedPath: Point[],
) => {
  if (!trace.points.length || !generatedPath.length) return Number.POSITIVE_INFINITY;
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
  onDraftChange,
  selectedPart,
  selectedSceneObject,
  selectedPath,
  playbackClock,
  goStage,
  onExport,
}: {
  project: ProjectState;
  foundry: MechanismConfig;
  setFoundry: (m: MechanismConfig) => void;
  onDraftChange: (m: MechanismConfig) => void;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  playbackClock: PlaybackClock;
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
  const [selectedOutputTraceId, setSelectedOutputTraceId] = useState<string | null>(null);
  const [showFoundryGrid, setShowFoundryGrid] = useState(true);
  const [showSensemaking, setShowSensemaking] = useState(false);
  const [foundryExplode, setFoundryExplode] = useState(0);
  const [foundryCamera, setFoundryCamera] = useState<FoundryCamera>({
    ...FOUNDRY_VIEW_PRESETS.iso,
    preset: "iso",
    pan: { x: 0, y: 0 },
  });
  const [foundryRigOpacity, setFoundryRigOpacity] = useState(85);
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
  const targetReady = Boolean(
    selectedPath &&
    selectedPath.enabled &&
    selectedPath.points.length >= 3 &&
    (selectedPath.sceneObjectId || project.parts[selectedPath.partId]),
  );
  const targetIkJointId = selectedPath && !selectedPath.sceneObjectId
    ? preferredMotionJointId(
        project,
        selectedPath.partId,
        selectedPath.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath.targetAnchorJointId },
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
    (selectedSceneObject
      ? selectedSceneObject.transform
      : undefined) ??
    (selectedPart
      ? bodyPartPivotScene(selectedPart, project.skeleton)
      : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
  const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
  const landing = boardToScene(
    landingBoard.col,
    landingBoard.row,
    project.settings.physicalKit,
  );
  const landedFoundry = useMemo(
    () => ({
      ...foundry,
      anchorX: landing.x,
      anchorY: landing.y,
      sceneAnchor: landing,
    }),
    [foundry, landing.x, landing.y],
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
    const fitTraceId = landedFoundry.fabricationMetadata?.pathFit?.outputTraceId;
    const fittedTrace = fitTraceId
      ? traces.find((trace) => trace.id === fitTraceId) ?? traces[0]
      : traces.reduce((best, trace) =>
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
  const feasibilityStatus = feasibilityStatusForRange(range);
  const library = MECHANISM_LIBRARY[foundry.type];
  const classroomSensemaking = library.classroomSensemaking;
  const feasibilityText = range.warning ?? "360°";
  const motionWarning = range.warning
    ? range.warning.startsWith("No motion")
      ? "No full motion. Try reset or smaller links."
      : "Motion may jam. Try a smaller move."
    : null;
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
  const foundryPhaseRemainderRef = useRef(0);
  useWorkspacePlaybackLoop({
    stage: "foundry",
    isPlaying: foundryPlaying,
    drawMode: false,
    optimizerBusy: false,
    showGettingStarted: false,
    playbackDurationMs: (Math.PI * 2) / 0.0025,
    animationSpeed: project.settings.animationSpeed,
    timingProfile: "linear",
    playbackClock,
    phaseAdvance: (elapsedMs, previousPhase) => {
      foundryPhaseRemainderRef.current += elapsedMs;
      if (foundryPhaseRemainderRef.current < FOUNDRY_ANIMATION_COMMIT_MS)
        return previousPhase;
      const committedElapsed = foundryPhaseRemainderRef.current;
      foundryPhaseRemainderRef.current %= FOUNDRY_ANIMATION_COMMIT_MS;
      return (
        previousPhase +
        Math.min(96, committedElapsed) *
          0.0025 *
          project.settings.animationSpeed
      );
    },
    driverStage: "foundry",
  });
  useEffect(() => {
    if (!foundryPlaying) foundryPhaseRemainderRef.current = 0;
  }, [foundryPlaying]);
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
    () => fabricationRenderPlanForMechanism(landedFoundry),
    [landedFoundry],
  );
  const foundryTopLayer = foundryRenderPlan.layers.at(-1);
  const foundryStackLayerZ = useMemo(
    () =>
      foundryRenderPlan.layers.map(
        (item) =>
          item.z +
          (foundryExplode / 100) *
            item.stackIndex *
            FABRICATION_RENDER_LAYER_Z_STEP *
            1.5,
      ),
    [foundryExplode, foundryRenderPlan.layers],
  );
  const foundryRenderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        landedFoundry.type,
        foundryRenderPlan.layers,
        foundryStackLayerZ,
      ),
    [foundryRenderPlan.layers, foundryStackLayerZ, landedFoundry.type],
  );
  const foundryMovingLayerIndexes = useMemo(
    () =>
      foundryRenderPlan.layers.flatMap((item, index) =>
        isMovingRenderKind(item.renderKind) ? [index] : [],
      ),
    [foundryRenderPlan.layers],
  );
  const foundrySpacerLayerIndexes = useMemo(
    () =>
      foundryRenderPlan.layers.flatMap((item, index) =>
        item.role === "spacer" ? [index] : [],
      ),
    [foundryRenderPlan.layers],
  );
  const foundryOverlayPinStacks = useMemo(
    () =>
      foundryPinStacks(
        foundryPinStackPoints(
          landedFoundry.type,
          foundryAssemblyPinPoints(
            landedFoundry.type,
            selectedSimulation.state,
          ),
          foundryMovingLayerIndexes,
          foundrySpacerLayerIndexes,
        ),
        foundryRenderedLayerZ,
      ),
    [
      foundryMovingLayerIndexes,
      foundryRenderedLayerZ,
      foundrySpacerLayerIndexes,
      landedFoundry.type,
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
        foundryTopLayer.stackIndex *
        FABRICATION_RENDER_LAYER_Z_STEP *
        1.5
      : 0) +
    0.18;
  const foundryOverlayZForHandle = (handleId?: string) => {
    const pin = foundryOverlayPinStackById.get(handleId === "M" ? "A" : (handleId ?? ""));
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
  const playbackOverlaySample = (phase: number): FoundryOverlayPlaybackFrame => {
    const frame = createFoundryPlaybackFrame(
      landedFoundry,
      phase,
      foundryFitContext,
    );
    const physicalSimulation = {
      ...frame.simulation,
      pathPoints: previewPoints,
      pathD: pointsToSvgPath(previewPoints),
    };
    const overlay = buildFoundryPhysicsOverlay(
      landedFoundry,
      physicalSimulation,
      frame.playbackPhaseRad,
      project.settings,
      previewPoints,
    );
    return {
      projectedPlayhead: projectOverlay(overlay.playhead),
      projectedVelocityTip: projectOverlay(overlay.velocityTip),
      projectedForceTip: projectOverlay(overlay.forceTip),
      projectedFrictionTip: projectOverlay(overlay.frictionTip),
      projectedDriveOrigin: projectOverlay(physicalSimulation.state.j1),
      projectedDriveTip: projectOverlay(overlay.driveTip),
      playheadSource: overlay.playheadSource,
      velocityRaw: overlay.velocityRaw,
      forceRaw: overlay.forceRaw,
      velocityMagnitude: overlay.velocityMagnitude,
      forceMagnitude: overlay.forceMagnitude,
      frictionMagnitude: overlay.frictionMagnitude,
      constraintError: overlay.constraintError,
      physicsRule: overlay.rule,
    };
  };
  const rawFoundryParamHandles: Array<Omit<FoundryParamHandle, "z" | "screen">> = [
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
            draggable: true,
          },
          {
            id: "C" as const,
            label: "C output",
            point: selectedSimulation.state.j2,
            draggable: true,
          },
          {
            id: "D" as const,
            label: "D ground",
            point: selectedSimulation.state.p2,
            draggable: true,
          },
        ]
      : []),
  ];
  const foundryParamHandles: FoundryParamHandle[] = rawFoundryParamHandles.flatMap((handle) => {
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
  const primaryOutputTrace = rawFoundryPointTraces.find((trace) => trace.primary) ?? rawFoundryPointTraces[0];
  const outputTraceLabel = primaryOutputTrace?.id ?? "—";
  const cycleOutputTrace = () => {
    if (rawFoundryPointTraces.length < 2) return;
    const currentIndex = Math.max(
      0,
      rawFoundryPointTraces.findIndex((trace) => trace.id === primaryOutputTrace?.id),
    );
    const next = rawFoundryPointTraces[(currentIndex + 1) % rawFoundryPointTraces.length];
    setSelectedOutputTraceId(next?.id ?? null);
    setShowPathPreview(true);
  };
  const committedTargetMechanism = project.mechanisms.find(
    (mechanism) =>
      mechanism.targetPathId === foundry.targetPathId &&
      mechanism.targetSceneObjectId === foundry.targetSceneObjectId &&
      (foundry.targetSceneObjectId || mechanism.targetPartId === foundry.targetPartId),
  );
  const effectiveFitMechanism = committedTargetMechanism ?? foundry;
  const effectivePathFit =
    selectedPath?.id === foundry.targetPathId
      ? effectiveFitMechanism.fabricationMetadata?.pathFit
      : undefined;
  const pathFitStatus = effectivePathFit?.status;
  const pathFitUsable =
    pathFitStatus === "fit" &&
    mechanismPathFitIsUsable(project, effectiveFitMechanism);
  const fitRequired = foundry.type === "4bar";
  const hardBlocked =
    !targetReady ||
    range.percentValid === 0 ||
    !Number.isFinite(landing.x) ||
    !Number.isFinite(landing.y) ||
      (fitRequired && targetReady && !pathFitUsable);
  const foundryCameraLabel =
    foundryCamera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[foundryCamera.preset].label;
  const foundryPhaseDegrees = Math.round(
    ((((foundryPhase / (Math.PI * 2)) % 1) + 1) % 1) * 360,
  );
  const setFoundryDraft = (mechanism: MechanismConfig) => {
    setFoundry(mechanism);
    onDraftChange(mechanism);
  };
  const applyAnchor = (point: Point) => {
    const board = sceneToBoard(point, project.settings.physicalKit);
    const snapped = boardToScene(
      board.col,
      board.row,
      project.settings.physicalKit,
    );
    setManualAnchor(snapped);
    setFoundryDraft(invalidatePathFit({
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
    }));
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
  const invalidatePathFit = (mechanism: MechanismConfig): MechanismConfig => {
    const pathFit = mechanism.fabricationMetadata?.pathFit;
    if (!pathFit) return mechanism;
    const warnings = (mechanism.warnings ?? []).filter(
      (warning) => !warning.startsWith("Closest kit fit:") && warning !== "No fabrication-valid path fit.",
    );
    return {
      ...mechanism,
      warnings,
      fabricationMetadata: {
        ...(mechanism.fabricationMetadata ?? {}),
        warnings: (mechanism.fabricationMetadata?.warnings ?? []).filter(
          (warning) => !warning.startsWith("Closest kit fit:") && warning !== "No fabrication-valid path fit.",
        ),
        pathFit: {
          ...pathFit,
          status: "unfitted",
          error: undefined,
          maxError: undefined,
          phaseOffset: undefined,
          direction: undefined,
        },
      },
    };
  };
  const refreshEditedFoundryMechanism = (mechanism: MechanismConfig) => {
    const normalized = invalidatePathFit(normalizeGearMeshMechanism(mechanism));
    if (normalized.type !== "4bar" || !normalized.generatedPath?.length)
      return mechanismWithGeneratedPath(normalized);
    const bcTraces = generateMechanismPointTraces(normalized, 96).traces.filter(
      (trace) => trace.id === "B" || trace.id === "C",
    );
    if (bcTraces.length === 0) return mechanismWithGeneratedPath(normalized);
    const fitTraceId = normalized.fabricationMetadata?.pathFit?.outputTraceId;
    const selectedTrace = fitTraceId
      ? bcTraces.find((trace) => trace.id === fitTraceId) ?? bcTraces[0]
      : bcTraces.reduce((best, trace) =>
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
  const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
    if (key === "anchorX" || key === "anchorY") {
      const anchor = {
        x: key === "anchorX" ? value : (foundry.anchorX ?? landing.x),
        y: key === "anchorY" ? value : (foundry.anchorY ?? landing.y),
      };
      setManualAnchor(anchor);
      setFoundryDraft(
        refreshEditedFoundryMechanism({
          ...foundry,
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
        }),
      );
      return;
    }
    setFoundryDraft(refreshEditedFoundryMechanism({ ...foundry, [key]: value }));
  };
  const updateFoundryParams = (updates: Partial<MechanismConfig>) => {
    setFoundryDraft(refreshEditedFoundryMechanism({ ...foundry, ...updates }));
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
      rockerLength: clampMechanismParam(
        "rockerLength",
        sceneDistance(s.p2, point),
      ),
    });
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
  const setAnchoredFoundry = (mechanism: MechanismConfig) =>
    setFoundryDraft(invalidatePathFit(normalizeGearMeshMechanism(keepCurrentAnchor(mechanism))));
  const createPathFittedFoundry = (mechanism: MechanismConfig) => {
    const anchored = keepCurrentAnchor(mechanism);
    if (!targetReady || !selectedPath) return normalizeGearMeshMechanism(anchored);
    return fitMechanismToTargetPath(
      project,
      {
        ...anchored,
        targetPartId: selectedPath.sceneObjectId ? undefined : selectedPath.partId,
        targetSceneObjectId: selectedPath.sceneObjectId,
        targetPathId: selectedPath.id,
        targetAnchorJointId: selectedPath.sceneObjectId ? undefined : targetIkJointId,
        activeVisualPartIds: selectedPath.sceneObjectId ? [] : [selectedPath.partId],
        source: "optimized",
        recommendation: mechanism.recommendation ?? "Fit path",
      },
      selectedPath.id,
    );
  };
  const setFoundryPhaseAndClock = (phase: number) => {
    playbackClock.setPhase(phase);
    setFoundryPhase(phase);
  };
  const toggleFoundryPlaying = () => {
    if (foundryPlaying) setFoundryPhaseAndClock(playbackClock.getPhase());
    setFoundryPlaying((value) => !value);
  };
  const applyPathFit = (mechanism = foundry) => {
    setFoundryPlaying(false);
    setFoundryPhaseAndClock(0);
    setManualAnchor(null);
    setSelectedOutputTraceId(null);
    setShowUserPathPreview(true);
    setShowPathPreview(true);
    setFoundryDraft(createPathFittedFoundry(mechanism));
  };
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhaseAndClock(0);
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
  const makePackage = (): FoundryExportPackage => {
    const mechanismId = uid("mech");
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
    const fitWarnings = [
      ...(landedFoundry.warnings ?? []),
      ...(landedFoundry.fabricationMetadata?.warnings ?? []),
    ];
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
      targetPartId: selectedPath?.sceneObjectId ? undefined : selectedPath?.partId,
      targetSceneObjectId: selectedPath?.sceneObjectId,
      targetPathId: selectedPath?.id,
      targetAnchorJointId: targetIkJointId,
      metadata: {
        sourceTab: "mechanism-foundry",
        selectedPreset: preset,
        recommendation:
          foundry.recommendation ?? FOUNDRY_PRESETS[preset]?.recommendation,
        simulationFriction: project.settings.simulationFriction,
        simulationMassKg: project.settings.simulationMassKg,
      },
      warnings: [...new Set([
        ...fitWarnings,
        ...(range.warning ? [range.warning] : []),
      ])],
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
            fitRequired={fitRequired}
            fitState={foundry.fabricationMetadata?.pathFit?.status}
            fitError={effectivePathFit?.error}
            fitMaxError={effectivePathFit?.maxError}
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
            playbackClock={playbackClock}
            playbackSample={(phase) => ({
              simulation: createFoundryPlaybackFrame(
                landedFoundry,
                phase,
                foundryFitContext,
              ).simulation,
            })}
            playbackOverlay={{
              clock: playbackClock,
              sample: playbackOverlaySample,
              minFrameIntervalMs: 1000 / 30,
            }}
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
            onTogglePlaying={toggleFoundryPlaying}
            onResetPreview={resetFoundryPreview}
            onPhaseChange={(degrees) => {
              setFoundryPlaying(false);
              setFoundryPhaseAndClock((degrees * Math.PI) / 180);
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
          />,
        ),
        inspector: inspectorPane(
          <FoundryInspectorPanel
            foundry={foundry}
            libraryLabel={library.label}
            classroomAssessmentKey={project.settings.classroomAssessmentKey}
            classroomSensemaking={classroomSensemaking}
            foundryRigOpacity={foundryRigOpacity}
            foundryExplode={foundryExplode}
            feasibilityStatus={feasibilityStatus}
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

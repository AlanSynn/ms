import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FoundryCanvasPane } from "./FoundryCanvasPane";
import type { FoundryPlaybackFrame as ThreeFoundryPlaybackFrame } from "./ThreeFoundryPreview";
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
  mechanismBoardPlacementErrors,
  sampleFeasibleRange,
} from "../../../utils/fabrication";
import {
  boardToScene,
  bodyPartPivotScene,
  sceneToBoard,
} from "../../../utils/coordinates";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
  FOUNDRY_WORK_PLANE_Z,
  clampFoundryPitch,
  clampFoundryZoom,
  projectFoundryOverlayPoint,
  sceneToFoundryPreviewPoint,
  unprojectFoundryOverlayPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
  type FoundryViewPreset,
} from "../../../utils/foundryCamera";
import {
  FOUNDRY_PRESETS,
  MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY,
  isMechanismTypeEnabled,
} from "../../../utils/mechanismTemplates";
import {
  createMechanismFitContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import {
  fitRecommendedMechanismToSheet,
  normalizeGearMeshMechanism,
} from "../../../utils/mechanismRecommendations";
import { createDefaultMechanism, mechanismWithGeneratedPath, uid } from "../../../utils/project";
import {
  mechanismPathFitIsUsable,
  motionPathReadiness,
  preferredMotionJointId,
} from "../../../utils/motion";
import { resolveRenderPerformancePolicy } from "../../../utils/renderPerformancePolicy";
import { sampleIndexedValues } from "../../../utils/interactiveSampling";
import { createCadencedGestureDraft } from "../../../runtime/interactions/cadencedGestureDraft";
import {
  captureFoundryGesturePlayback,
  createPostPaintFoundryGestureCommit,
  foundryMechanismForHandleGesture,
  isExpectedFoundryGestureProjectChange,
  retainFoundryGestureAnalysis,
  settleExternalFoundryFrame,
  shouldCommitFoundryGesture,
  shouldForceFirstFoundryGestureMove,
} from "./foundryHandleGesture";
import { createMechanismFitJobInput } from "../../../runtime/fitting/mechanismFitJob";
import { createMechanismFitWorkerClient } from "../../../runtime/fitting/mechanismFitWorkerClient";
import { highResolutionSessionController } from "../../../runtime/render/adaptiveHighResolutionController";
import { createTransientValueController } from "../../../runtime/render/transientValueController";
import { compatibleMechanismsForBinding } from "../../../utils/mechanismBindings";

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
  foundry: committedFoundry,
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
  onDraftChange: (m: MechanismConfig) => boolean | void;
  selectedPart?: BodyPartLayer;
  selectedSceneObject?: SceneObject;
  selectedPath?: ProjectMotionPath;
  playbackClock: PlaybackClock;
  goStage: (stage: AppStage) => void;
  onExport: (pkg: FoundryExportPackage, options?: { reuseMechanismId?: string }) => void;
}) => {
  const renderPolicy = resolveRenderPerformancePolicy(
    project.settings.performancePreset,
  );
  const foundryGestureDraft = useMemo(
    () => createCadencedGestureDraft<MechanismConfig>({
      minFrameIntervalMs: renderPolicy.minRenderIntervalMs,
    }),
    [renderPolicy.minRenderIntervalMs],
  );
  const foundryGestureCommit = useMemo(
    () => createPostPaintFoundryGestureCommit<MechanismConfig>(),
    [],
  );
  const expectedCommittedFoundryRef = useRef<MechanismConfig | null>(null);
  const foundryParamDragRef = useRef<{
    pointerId: number;
    handle: FoundryParamHandleId;
    draft: MechanismConfig;
    dirty: boolean;
    phase: number;
    simulation: ReturnType<typeof createFoundryPlaybackFrame>["simulation"];
    landing: Point;
    restoreFrame: ThreeFoundryPlaybackFrame;
  } | null>(null);
  const [gestureFoundry, setGestureFoundry] =
    useState<MechanismConfig | null>(null);
  const retainedPointTracesRef = useRef<
    ReturnType<typeof generateFoundryPlaybackPointTraces>["traces"] | null
  >(null);
  const retainedRangeRef = useRef<ReturnType<typeof sampleFeasibleRange> | null>(
    null,
  );
  const retainedFitContextRef = useRef<
    ReturnType<typeof createMechanismFitContext> | null
  >(null);
  const retainedPhysicsOverlayRef = useRef<
    ReturnType<typeof buildFoundryPhysicsOverlay> | null
  >(null);
  const retainedRenderPlanRef = useRef<
    ReturnType<typeof fabricationRenderPlanForMechanism> | null
  >(null);
  const foundry = gestureFoundry ?? committedFoundry;
  useEffect(
    () => foundryGestureDraft.subscribe(setGestureFoundry),
    [foundryGestureDraft],
  );
  useEffect(
    () => () => {
      foundryGestureCommit.dispose();
      foundryGestureDraft.dispose();
    },
    [foundryGestureCommit, foundryGestureDraft],
  );
  const previewTraceSamples =
    gestureFoundry
      ? Math.min(16, renderPolicy.interactiveDetail.mechanismTraceSamples)
      : renderPolicy.interactiveDetail.mechanismTraceSamples;
  const [foundryPlaying, setFoundryPlaying] = useState(false);
  const [foundryPhase, setFoundryPhase] = useState(0);
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);
  const [manualAnchor, setManualAnchor] = useState<Point | null>(null);
  const [showForces, setShowForces] = useState(false);
  const [showVelocity, setShowVelocity] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showPathPreview, setShowPathPreview] = useState(false);
  const [selectedOutputTraceId, setSelectedOutputTraceId] = useState<string | null>(null);
  const [reuseMechanismId, setReuseMechanismId] = useState<string>();
  const [showFoundryGrid, setShowFoundryGrid] = useState(true);
  const [showSensemaking, setShowSensemaking] = useState(false);
  const [pathFitBusy, setPathFitBusy] = useState(false);
  const [pathFitJobError, setPathFitJobError] = useState(false);
  const [boardPlacementWarning, setBoardPlacementWarning] = useState<string | null>(null);
  const pathFitClient = useMemo(() => createMechanismFitWorkerClient(), []);
  const pathFitProjectRef = useRef(project);
  pathFitProjectRef.current = project;
  useEffect(() => () => pathFitClient.dispose(), [pathFitClient]);
  useEffect(() => {
    pathFitClient.cancel();
    setPathFitBusy(false);
  }, [pathFitClient, project]);
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
  const foundryCameraGestureOwnerRef = useRef<object>({});
  const transientFoundryCamera = useMemo(
    () => createTransientValueController<FoundryCamera>({
      onActiveChange: (active) => {
        if (active) highResolutionSessionController.resetSubmissionWindow();
        highResolutionSessionController.setGestureActive(
          foundryCameraGestureOwnerRef.current,
          active,
        );
      },
    }),
    [],
  );
  useEffect(
    () => () => transientFoundryCamera.dispose(),
    [transientFoundryCamera],
  );
  const transientFoundryFrame = useMemo(
    () => createTransientValueController<ThreeFoundryPlaybackFrame>(),
    [],
  );
  useEffect(
    () => () => transientFoundryFrame.dispose(),
    [transientFoundryFrame],
  );
  const targetReadiness = selectedPath ? motionPathReadiness(project, selectedPath) : undefined;
  const targetReady = Boolean(targetReadiness?.playable);
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
  const anchorMarker = sceneToFoundryPreviewPoint(landing);
  const rawFoundryPointTraces = useMemo(
    () =>
      retainFoundryGestureAnalysis(
        Boolean(gestureFoundry),
        retainedPointTracesRef,
        () => {
          const traces = generateFoundryPlaybackPointTraces(
            landedFoundry,
            previewTraceSamples,
          ).traces;
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
          const fitTraceId =
            landedFoundry.fabricationMetadata?.pathFit?.outputTraceId;
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
        },
      ),
    [gestureFoundry, landedFoundry, previewTraceSamples, selectedOutputTraceId],
  );
  const preview = useMemo(
    () =>
      rawFoundryPointTraces.find((trace) => trace.primary)?.points ??
      rawFoundryPointTraces[0]?.points ??
      generateCurvePoints(landedFoundry, previewTraceSamples).points,
    [landedFoundry, previewTraceSamples, rawFoundryPointTraces],
  );
  const range = useMemo(
    () =>
      retainFoundryGestureAnalysis(
        Boolean(gestureFoundry),
        retainedRangeRef,
        () => sampleFeasibleRange(landedFoundry, 96),
      ),
    [gestureFoundry, landedFoundry],
  );
  const feasibilityStatus = feasibilityStatusForRange(range);
  const library = MECHANISM_LIBRARY[foundry.type];
  const classroomSensemaking = library.classroomSensemaking;
  const feasibilityText = range.warning ?? "360°";
  const motionWarning = boardPlacementWarning ?? (range.warning
    ? range.warning.startsWith("No motion")
      ? "No full motion. Try reset or smaller links."
      : "Motion may jam. Try a smaller move."
    : null);
  const foundryFitContext = useMemo(
    () =>
      retainFoundryGestureAnalysis(
        Boolean(gestureFoundry),
        retainedFitContextRef,
        () =>
          createMechanismFitContext(
            landedFoundry,
            360,
            240,
            previewTraceSamples,
            selectedPath
              ? sampleIndexedValues(
                  selectedPath.points,
                  renderPolicy.interactiveDetail.maxPathLinePoints,
                ).map(({ value }) => value)
              : [],
          ),
      ),
    [
      gestureFoundry,
      landedFoundry,
      previewTraceSamples,
      renderPolicy.interactiveDetail.maxPathLinePoints,
      selectedPath,
    ],
  );
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
    phaseAdvance: (elapsedMs, previousPhase) =>
      previousPhase +
      Math.min(96, elapsedMs) *
        0.0025 *
        project.settings.animationSpeed,
    driverStage: "foundry",
  });
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
    () => selectedPath
      ? sampleIndexedValues(
          selectedPath.points,
          renderPolicy.interactiveDetail.maxPathLinePoints,
        ).map(({ value }) => foundryFitContext.map(value))
      : [],
    [
      foundryFitContext,
      renderPolicy.interactiveDetail.maxPathLinePoints,
      selectedPath,
    ],
  );
  const selectedPhysicalSimulation = useMemo(
    () => ({
      ...selectedSimulation,
      pathPoints: previewPoints,
      pathD: pointsToSvgPath(previewPoints),
    }),
    [previewPoints, selectedSimulation],
  );
  useLayoutEffect(() => {
    if (
      isExpectedFoundryGestureProjectChange(
        foundryGestureCommit.hasPending(),
        expectedCommittedFoundryRef.current,
        committedFoundry,
      )
    ) {
      expectedCommittedFoundryRef.current = null;
      return;
    }
    expectedCommittedFoundryRef.current = null;
    foundryGestureCommit.cancel();
    foundryParamDragRef.current = null;
    settleExternalFoundryFrame(
      transientFoundryFrame,
      gestureFoundry !== null,
      {
        mechanism: landedFoundry,
        simulation: selectedPhysicalSimulation,
        deferMechanismTopology: false,
        measureSubmissionInterval: false,
      },
    );
    foundryGestureDraft.clear();
    // This effect intentionally follows only external aggregate revisions.
    // Gesture drafts must not cancel their own transient renderer ownership.
  }, [
    committedFoundry,
    foundryGestureCommit,
    foundryGestureDraft,
    project,
    transientFoundryFrame,
  ]);
  const physicsOverlay = useMemo(
    () =>
      retainFoundryGestureAnalysis(
        Boolean(gestureFoundry),
        retainedPhysicsOverlayRef,
        () =>
          buildFoundryPhysicsOverlay(
            landedFoundry,
            selectedPhysicalSimulation,
            foundryPlaybackFrame.playbackPhaseRad,
            project.settings,
            previewPoints,
          ),
      ),
    [
      gestureFoundry,
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
      retainFoundryGestureAnalysis(
        Boolean(gestureFoundry),
        retainedRenderPlanRef,
        () => fabricationRenderPlanForMechanism(landedFoundry),
      ),
    [gestureFoundry, landedFoundry],
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
    FOUNDRY_WORK_PLANE_Z,
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
  const reusableMechanisms = useMemo(
    () => selectedPath
      ? compatibleMechanismsForBinding(
          project,
          landedFoundry,
          selectedPath.id,
          primaryOutputTrace?.id,
          { ignoreMechanismId: foundry.id },
        )
      : [],
    [foundry.id, landedFoundry, primaryOutputTrace?.id, project, selectedPath],
  );
  useEffect(() => {
    if (reuseMechanismId && !reusableMechanisms.some(candidate => candidate.mechanism.id === reuseMechanismId)) {
      setReuseMechanismId(undefined);
    }
  }, [reuseMechanismId, reusableMechanisms]);
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
    const fitted = fitRecommendedMechanismToSheet(project, mechanism);
    const placementErrors = mechanismBoardPlacementErrors(project, fitted);
    if (placementErrors.length) {
      setBoardPlacementWarning(`Fix: ${placementErrors[0]}`);
      return undefined;
    }
    setBoardPlacementWarning(null);
    if (onDraftChange(fitted) === false) return undefined;
    setFoundry(fitted);
    return fitted;
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
    transientFoundryCamera.begin(foundryCamera);
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
      transientFoundryCamera.update({
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
      transientFoundryCamera.update({
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
    transientFoundryCamera.update({
      yaw: start.yaw + (event.clientX - start.x) * 0.45,
      pitch: clampFoundryPitch(start.pitch - (event.clientY - start.y) * 0.45),
      zoom: start.zoom,
      preset: "custom",
      pan: start.pan,
    });
  };
  const finishFoundryOrbit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (foundryOrbitStartRef.current?.pointerId === event.pointerId) {
      const finalCamera = transientFoundryCamera.finish();
      foundryOrbitStartRef.current = null;
      startTransition(() => {
        setIsOrbitingFoundry(false);
        setIsZoomingFoundry(false);
        setIsPanningFoundry(false);
        if (finalCamera) setFoundryCamera(finalCamera);
      });
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
    const bcTraces = generateMechanismPointTraces(
      normalized,
      previewTraceSamples,
    ).traces.filter(
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
    const drag = foundryParamDragRef.current;
    if (!drag || drag.handle !== handle) return;
    const forceVisualSample = shouldForceFirstFoundryGestureMove(drag.dirty);
    const next = foundryMechanismForHandleGesture({
      mechanism: drag.draft,
      handle,
      point,
      simulation: drag.simulation,
      landing: drag.landing,
      kit: project.settings.physicalKit,
    });
    const transientPlaybackFrame = createFoundryPlaybackFrame(
      next,
      drag.phase,
      foundryFitContext,
    );
    transientFoundryFrame.update(
      {
        mechanism: next,
        simulation: {
          ...transientPlaybackFrame.simulation,
          pathPoints: previewPoints,
          pathD: pointsToSvgPath(previewPoints),
        },
        deferMechanismTopology: true,
        measureSubmissionInterval: false,
      },
      () => foundryGestureDraft.publish(next, forceVisualSample),
    );
    drag.draft = next;
    drag.dirty = true;
  };
  const handleFoundryParamPointerDown =
    (handle: FoundryParamHandleId) =>
    (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const gestureMechanism = pathFitBusy
        ? createPathFitCandidate(landedFoundry)
        : foundry;
      if (pathFitBusy) {
        pathFitClient.cancel();
        setPathFitBusy(false);
      }
      if (handle === "M") setManualAnchor(null);
      const playback = captureFoundryGesturePlayback(
        playbackClock,
        (phase) =>
          createFoundryPlaybackFrame(
            landedFoundry,
            phase,
            foundryFitContext,
          ).simulation,
      );
      const gestureSimulation = gestureMechanism === foundry
        ? playback.simulation
        : createFoundryPlaybackFrame(
            gestureMechanism,
            playback.phase,
            foundryFitContext,
          ).simulation;
      const restoreFrame: ThreeFoundryPlaybackFrame = {
        mechanism: landedFoundry,
        simulation: {
          ...playback.simulation,
          pathPoints: previewPoints,
          pathD: pointsToSvgPath(previewPoints),
        },
        deferMechanismTopology: true,
        measureSubmissionInterval: false,
      };
      transientFoundryFrame.begin(restoreFrame);
      foundryParamDragRef.current = {
        pointerId: event.pointerId,
        handle,
        draft: gestureMechanism,
        dirty: false,
        phase: playback.phase,
        simulation: gestureSimulation,
        landing: { ...landing },
        restoreFrame,
      };
      foundryGestureCommit.cancel();
      setFoundryPhase(playback.phase);
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
    const drag = foundryParamDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      foundryParamDragRef.current = null;
      if (!shouldCommitFoundryGesture(event.type, drag.dirty)) {
        if (drag.dirty) {
          transientFoundryFrame.restoreAndRelease(drag.restoreFrame);
        } else {
          transientFoundryFrame.cancel();
        }
        foundryGestureDraft.clear();
      } else {
        transientFoundryFrame.finish();
        foundryGestureCommit.schedule(drag.draft, {
          present: (draft) => foundryGestureDraft.publish(draft, true),
          commit: (draft) => {
            const refreshed = refreshEditedFoundryMechanism(draft);
            startTransition(() => {
              const fitted = setFoundryDraft(refreshed);
              if (fitted) expectedCommittedFoundryRef.current = fitted;
            });
          },
          release: () => startTransition(() => foundryGestureDraft.clear()),
        });
      }
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
  const createPathFitCandidate = (mechanism: MechanismConfig) => {
    const anchored = keepCurrentAnchor(mechanism);
    return normalizeGearMeshMechanism({
      ...anchored,
      targetPartId: selectedPath?.sceneObjectId ? undefined : selectedPath?.partId,
      targetSceneObjectId: selectedPath?.sceneObjectId,
      targetPathId: selectedPath?.id,
      targetAnchorJointId: selectedPath?.sceneObjectId ? undefined : targetIkJointId,
      activeVisualPartIds: selectedPath?.sceneObjectId ? [] : selectedPath ? [selectedPath.partId] : [],
      source: "optimized",
      recommendation: mechanism.recommendation ?? "Fit path",
    });
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
    if (pathFitBusy) {
      pathFitClient.cancel();
      setPathFitBusy(false);
      return;
    }
    setFoundryPlaying(false);
    setFoundryPhaseAndClock(0);
    setManualAnchor(null);
    setSelectedOutputTraceId(null);
    setShowUserPathPreview(true);
    setShowPathPreview(true);
    const candidate = createPathFitCandidate(mechanism);
    if (!targetReady || !selectedPath) {
      setFoundryDraft(candidate);
      return;
    }
    setPathFitJobError(false);
    setPathFitBusy(true);
    pathFitClient.request(
      createMechanismFitJobInput(project, candidate, "path", selectedPath.id),
      {
        complete: ({ mechanism: fitted }) => {
          if (pathFitProjectRef.current !== project) return;
          startTransition(() => {
            setFoundryDraft(fitted);
            setPathFitBusy(false);
          });
        },
        failed: () => {
          setPathFitBusy(false);
          setPathFitJobError(true);
        },
      },
    );
  };
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhaseAndClock(0);
    setManualAnchor(null);
    setSelectedOutputTraceId(null);
    setIsPickingAnchor(false);
    setShowForces(false);
    setShowVelocity(false);
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
      outputPortId: primaryOutputTrace?.id,
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
  const useFoundryMechanism = () => onExport(makePackage(), { reuseMechanismId });
  const selectFoundryMechanismType = (type: MechanismType) => {
    if (!isMechanismTypeEnabled(type)) return;
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
      progressivePanes
      layout={{
        workflow: workflowPane(
      <FoundryWorkflowPanel
            project={project}
            goStage={goStage}
            foundry={foundry}
            foundryPhase={foundryPhase}
            targetReady={targetReady}
            targetBlocker={targetReadiness?.reason ?? "Draw path first"}
            fitRequired={fitRequired}
            fitState={foundry.fabricationMetadata?.pathFit?.status}
            fitError={effectivePathFit?.error}
            fitMaxError={effectivePathFit?.maxError}
            fitBusy={pathFitBusy}
            fitJobError={pathFitJobError}
            isPickingAnchor={isPickingAnchor}
            hardBlocked={hardBlocked}
            onToggleAnchorPick={() => setIsPickingAnchor((value) => !value)}
            onFitPath={() => applyPathFit()}
            onUseMechanism={useFoundryMechanism}
            reusableMechanisms={reusableMechanisms.map(({ mechanism }) => ({
              id: mechanism.id,
              label: MECHANISM_LIBRARY[mechanism.type].label,
            }))}
            reuseMechanismId={reuseMechanismId}
            onReuseMechanismChange={setReuseMechanismId}
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
            }}
            foundryCamera={foundryCamera}
            transientCamera={transientFoundryCamera}
            transientFrame={transientFoundryFrame}
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
            performancePreset={project.settings.performancePreset}
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
            gestureActive={Boolean(gestureFoundry)}
            gestureEmissionCount={foundryGestureDraft.getEmissionCount()}
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

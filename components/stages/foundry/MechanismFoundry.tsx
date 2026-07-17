import { useEffect, useMemo, useRef, useState } from "react";
import { FoundryCanvasPane } from "./FoundryCanvasPane";
import { FoundryInspectorPanel } from "./FoundryInspectorPanel";
import { FoundryWorkflowPanel } from "./FoundryWorkflowPanel";
import type {
  FoundryParamHandle,
  FoundryParamHandleId,
} from "./FoundryOverlayLayer";
import {
  projectMechanismConnectionHoleHandles,
  useMechanismConnectionDrag,
} from "../mechanism/MechanismConnectionOverlay";
import {
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
} from "../../../utils/mechanismPreviewStacks";
import {
  clampMechanismParam,
  motionSafeParamRange,
} from "../mechanism/mechanismParamPolicy";
import {
  constrainMechanismUpdate,
  resolveMechanismCandidateCommit,
  resolveNewMechanismCandidateCommit,
} from "../../../utils/mechanismEditAuthority";
import { resolveFoundryTransaction } from "../../../utils/foundryTransaction";
import { isReferenceExportReady } from "../../../utils/mechanismReference";
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
  PhysicalKitSettings,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
} from "../../../types";
import {
  calculateLinkage,
  generateCurvePoints,
  mechanismTraceDefinitionsForState,
} from "../../../utils/kinematics";
import {
  createFoundryPlaybackFrame,
  resolveFoundryPlaybackTraceAuthority,
} from "../../../utils/foundryPlayback";
import { buildFoundryPhysicsOverlay } from "../../../utils/physicsSession";
import {
  FABRICATION_RENDER_LAYER_Z_STEP,
  sampleFeasibleRange,
} from "../../../utils/fabrication";
import { compactStudentActionForFabricationDiagnostic, fabricationDiagnosticCategory } from "../../../utils/fabricationReadiness";
import { recordStudyEvent } from "../../../utils/studyTelemetry";
import { buildProjectMechanismSceneContract } from "../../../utils/mechanismSceneContract";
import {
  connectionSelectionSignature,
  connectionSelectionSceneCoordinates,
  normalizeAuthoredMechanismToFabricationSet,
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

export const resolveLocalFoundryCandidate = (
  previous: MechanismConfig,
  candidate: MechanismConfig,
  kit: PhysicalKitSettings,
  fresh = false,
) => {
  const result = fresh
    ? resolveNewMechanismCandidateCommit(candidate, kit)
    : resolveMechanismCandidateCommit(previous, candidate, kit);
  return result.status === "accepted"
    ? { accepted: true as const, mechanism: result.mechanism }
    : { accepted: false as const, mechanism: previous };
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
  const targetFields = useMemo(() => selectedPath
    ? pathOwnedTargetFields(selectedPath)
    : {
        targetPartId: foundry.targetPartId,
        targetSceneObjectId: foundry.targetSceneObjectId,
        targetPathId: foundry.targetPathId,
        targetAnchorJointId: foundry.targetAnchorJointId,
      }, [
        foundry.targetAnchorJointId,
        foundry.targetPartId,
        foundry.targetPathId,
        foundry.targetSceneObjectId,
        selectedPath,
      ]);
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
  const foundrySceneMechanism = useMemo(
    () => ({ ...landedFoundry, ...targetFields }),
    [landedFoundry, targetFields],
  );
  const foundrySceneProject = useMemo(() => {
    const exists = project.mechanisms.some((mechanism) => mechanism.id === foundrySceneMechanism.id);
    return {
      ...project,
      mechanisms: exists
        ? project.mechanisms.map((mechanism) => mechanism.id === foundrySceneMechanism.id ? foundrySceneMechanism : mechanism)
        : [...project.mechanisms, foundrySceneMechanism],
    };
  }, [foundrySceneMechanism, project]);
  const foundrySceneContract = useMemo(
    () => buildProjectMechanismSceneContract(foundrySceneProject, foundrySceneMechanism.id, undefined, 0),
    [foundrySceneMechanism.id, foundrySceneProject],
  );
  const foundryProjectDriveEnabled = foundrySceneContract?.projectDriveEnabled === true;
  const anchorMarker = {
    x: 180 + (landing.x / SCENE_VIEW.width) * 360,
    y: 120 - (landing.y / SCENE_VIEW.height) * 240,
  };
  const foundryTraceAuthority = useMemo(
    () => resolveFoundryPlaybackTraceAuthority(
      landedFoundry,
      96,
      project.settings.physicalKit,
      selectedOutputTraceId,
    ),
    [landedFoundry, project.settings.physicalKit, selectedOutputTraceId],
  );
  const rawFoundryPointTraces = foundryTraceAuthority.traces;
  const preview = useMemo(
    () =>
      foundryTraceAuthority.primary?.points ??
      generateCurvePoints(
        landedFoundry,
        96,
        project.settings.physicalKit,
      ).points,
    [foundryTraceAuthority.primary, landedFoundry, project.settings.physicalKit],
  );
  const range = useMemo(
    () => sampleFeasibleRange(landedFoundry, 96, project.settings.physicalKit),
    [landedFoundry, project.settings.physicalKit],
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
        project.settings.physicalKit,
      ),
    [landedFoundry, project.settings.physicalKit, selectedPath?.points],
  );
  const foundryPlaybackFrame = useMemo(
    () =>
      createFoundryPlaybackFrame(
        landedFoundry,
        foundryProjectDriveEnabled ? foundryPhase : 0,
        foundryFitContext,
        project.settings.physicalKit,
      ),
    [foundryProjectDriveEnabled, foundryFitContext, foundryPhase, landedFoundry, project.settings.physicalKit],
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
  const foundryRenderPlan = foundrySceneContract?.renderPlan;
  const foundryRenderLayers = foundryRenderPlan?.layers ?? [];
  const selectedConnectionState =
    foundryRenderPlan?.connectionSelectionSummary ??
    normalizeMechanismConnectionSelections(
      landedFoundry,
      landedFoundry.connectionSelections,
      landedFoundry.connectionSelectionValidation,
      { kit: project.settings.physicalKit },
    );
  const foundryTopLayer = foundryRenderLayers.at(-1);
  const foundryStackLayerZ = useMemo(
    () =>
      foundryRenderLayers.map(
        (item, presentationIndex) =>
          item.z +
          (foundryExplode / 100) *
            presentationIndex *
            FABRICATION_RENDER_LAYER_Z_STEP *
            1.5,
      ),
    [foundryExplode, foundryRenderLayers],
  );
  const foundryRenderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        foundryRenderLayers,
        foundryStackLayerZ,
      ),
    [foundryRenderLayers, foundryStackLayerZ],
  );
  const foundryOverlayPinStacks = useMemo(
    () => foundryRenderPlan
      ? foundryPinStacks(
        foundryPinStackPoints(
          foundryRenderPlan,
          { state: selectedSimulation.state },
        ),
        foundryRenderPlan,
      )
      : [],
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
        Math.max(0, foundryRenderLayers.length - 1) *
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
            draggable: false,
          },
          {
            id: "C" as const,
            label: "C output",
            point: selectedSimulation.state.j2,
            draggable: false,
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
        project.settings.physicalKit,
      ),
    [
      landedFoundry,
      project.settings.physicalKit,
      selectedConnectionState.connectionSelections,
      selectedSimulation.state,
    ],
  );
  const connectionExportSignature = connectionSelectionSignature(
    foundryRenderPlan?.connectionSelectionSummary?.connectionSelections ?? {},
  );
  const connectionHoleHandles = useMemo(
    () =>
      projectMechanismConnectionHoleHandles({
        mechanism: landedFoundry,
        state: selectedSimulation.state,
        kit: project.settings.physicalKit,
        camera: foundryCamera,
        projectionSize: foundryProjectionSize,
        layers: foundryRenderLayers,
        renderedLayerZ: foundryRenderedLayerZ,
      }),
    [
      foundryCamera,
      foundryProjectionSize,
      foundryRenderedLayerZ,
      foundryRenderLayers,
      landedFoundry,
      project.settings.physicalKit,
      selectedSimulation.state,
    ],
  );
  const primaryOutputTrace = foundryTraceAuthority.primary;
  const displayOutputTrace = foundryTraceAuthority.display;
  const outputTraceLabel = displayOutputTrace?.id ?? "—";
  const cycleOutputTrace = () => {
    if (rawFoundryPointTraces.length < 2) return;
    const currentIndex = Math.max(
      0,
      rawFoundryPointTraces.findIndex(
        (trace) => trace.id === displayOutputTrace?.id,
      ),
    );
    const next =
      rawFoundryPointTraces[(currentIndex + 1) % rawFoundryPointTraces.length];
    setSelectedOutputTraceId(next?.id ?? null);
    setShowPathPreview(true);
  };
  const foundryCandidate = useMemo(
    () => mechanismWithGeneratedPath({
      ...landedFoundry,
      ...targetFields,
      source: "foundry",
      warnings: motionWarning ? [motionWarning] : [],
    }, { kit: project.settings.physicalKit }),
    [landedFoundry, motionWarning, project.settings.physicalKit, targetFields],
  );
  const foundryIntent = isReferenceExportReady(foundryCandidate.type)
    ? "fabrication-package" as const
    : "simulation-only" as const;
  const foundryTransaction = useMemo(
    () => resolveFoundryTransaction({
      project,
      candidate: foundryCandidate,
      intent: foundryIntent,
    }),
    [foundryCandidate, foundryIntent, project],
  );
  const hardBlocked = !targetReady || !foundryProjectDriveEnabled;
  const foundryCameraLabel =
    foundryCamera.preset === "custom"
      ? "Custom view"
      : FOUNDRY_VIEW_PRESETS[foundryCamera.preset].label;
  const foundryPhaseDegrees = Math.round(
    ((((foundryPhase / (Math.PI * 2)) % 1) + 1) % 1) * 360,
  );
  const installFoundryCandidate = (
    candidate: MechanismConfig,
    fresh = false,
    manualAnchorAfterInstall?: Point | null,
  ) => {
    const result = resolveLocalFoundryCandidate(
      landedFoundry,
      candidate,
      project.settings.physicalKit,
      fresh,
    );
    if (!result.accepted) return false;
    const approvedAnchor = {
      x: result.mechanism.anchorX ?? 0,
      y: result.mechanism.anchorY ?? 0,
    };
    const keepManualAnchor = manualAnchorAfterInstall === undefined
      ? Boolean(manualAnchor)
      : manualAnchorAfterInstall !== null;
    setManualAnchor(keepManualAnchor ? approvedAnchor : null);
    setFoundry(result.mechanism);
    return true;
  };
  const applyAnchor = (point: Point) => {
    const board = sceneToBoard(point, project.settings.physicalKit);
    const snapped = boardToScene(
      board.col,
      board.row,
      project.settings.physicalKit,
    );
    installFoundryCandidate(
      {
        ...landedFoundry,
        anchorX: snapped.x,
        anchorY: snapped.y,
        sceneAnchor: snapped,
        transform: {
          ...(landedFoundry.transform ?? {
            x: snapped.x,
            y: snapped.y,
            rotation: landedFoundry.groundAngle ?? 0,
            scale: 1,
          }),
          x: snapped.x,
          y: snapped.y,
        },
      },
      false,
      snapped,
    );
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
    const normalized = normalizeAuthoredMechanismToFabricationSet(
      mechanism,
      project.settings.physicalKit,
    );
    return mechanismWithGeneratedPath(normalized, {
      kit: project.settings.physicalKit,
    });
  };
  const applyDirectFoundryUpdates = (updates: Partial<MechanismConfig>) => {
    if (!Object.keys(updates).length) return false;
    const candidate = updates.connectionSelections
      ? { ...landedFoundry, ...updates }
      : refreshEditedFoundryMechanism({ ...landedFoundry, ...updates });
    return installFoundryCandidate(candidate);
  };
  const applySafeFoundryUpdates = (updates: Partial<MechanismConfig>) => {
    const constrainedUpdates = constrainMechanismUpdate(
      landedFoundry,
      updates,
      project.settings.physicalKit,
    );
    if (!Object.keys(constrainedUpdates).length) return;
    applyDirectFoundryUpdates(constrainedUpdates);
  };
  const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
    if (key === "anchorX" || key === "anchorY") {
      const anchor = {
        x: key === "anchorX" ? value : (landedFoundry.anchorX ?? landing.x),
        y: key === "anchorY" ? value : (landedFoundry.anchorY ?? landing.y),
      };
      applySafeFoundryUpdates({
        [key]: value,
        sceneAnchor: anchor,
        transform: {
          ...(landedFoundry.transform ?? {
            x: anchor.x,
            y: anchor.y,
            rotation: landedFoundry.groundAngle ?? 0,
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
    if (updates.connectionSelections || updates.gearTrainRadii)
      applyDirectFoundryUpdates(updates);
    else applySafeFoundryUpdates(updates);
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
    if (handle === "M") {
      applyAnchor({
        x: landing.x + (point.x - s.p1.x) / scale,
        y: landing.y - (point.y - s.p1.y) / scale,
      });
      return;
    }
    if (handle === "B" || handle === "C") {
      return;
    }
    if (handle === "D") {
      const intendedEndpoint = {
        x: landing.x + (point.x - s.p1.x) / scale,
        y: landing.y - (point.y - s.p1.y) / scale,
      };
      const board = sceneToBoard(
        intendedEndpoint,
        project.settings.physicalKit,
      );
      const endpoint = boardToScene(
        board.col,
        board.row,
        project.settings.physicalKit,
      );
      applyDirectFoundryUpdates({
        groundLength: Math.hypot(endpoint.x - landing.x, endpoint.y - landing.y),
        groundAngle:
          (Math.atan2(endpoint.y - landing.y, endpoint.x - landing.x) * 180) /
          Math.PI,
      });
      return;
    }
  };

  const connectionInteraction = useMechanismConnectionDrag({
    mechanism: landedFoundry,
    handles: connectionHoleHandles,
    projectionSize: foundryProjectionSize,
    kit: project.settings.physicalKit,
    onCommit: applyDirectFoundryUpdates,
    onInteractionStart: () => setFoundryPlaying(false),
  });
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
    const anchored = normalizeAuthoredMechanismToFabricationSet(
      keepCurrentAnchor(mechanism),
      project.settings.physicalKit,
    );
    installFoundryCandidate(fitRecommendedMechanismToSheet(project, anchored));
  };
  const setFreshAnchoredFoundry = (
    mechanism: MechanismConfig,
    manualAnchorAfterInstall?: Point | null,
  ) => {
    const anchored = normalizeGearMeshMechanism(keepCurrentAnchor(mechanism));
    installFoundryCandidate(
      fitRecommendedMechanismToSheet(project, anchored),
      true,
      manualAnchorAfterInstall,
    );
  };
  const createPathFittedFoundry = (mechanism: MechanismConfig) => {
    const anchored = keepCurrentAnchor(mechanism);
    if (!targetReady || !selectedPath)
      return normalizeAuthoredMechanismToFabricationSet(
        anchored,
        project.settings.physicalKit,
      );
    return fitMechanismToTargetPath(
      project,
      normalizeAuthoredMechanismToFabricationSet({
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
      }, project.settings.physicalKit),
      selectedPath.id,
    );
  };
  const applyPathFit = (mechanism = foundry) => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setSelectedOutputTraceId(null);
    setShowUserPathPreview(true);
    setShowPathPreview(true);
    installFoundryCandidate(createPathFittedFoundry(mechanism), false, null);
  };
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
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
    setFreshAnchoredFoundry(
      {
        ...createDefaultMechanism(foundry.type, "foundry-preview"),
        color: foundry.color,
        presetId: "balanced",
        recommendation: FOUNDRY_PRESETS.balanced.recommendation,
      },
      null,
    );
  };
  useEffect(() => {
    if (foundryProjectDriveEnabled) return;
    setFoundryPlaying(false);
    setFoundryPhase(0);
  }, [foundryProjectDriveEnabled]);
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
  useEffect(() => {
    recordStudyEvent(
      "simulation.foundry",
      {
        state: foundryPlaying ? "playing" : "stopped",
        mechanismType: foundry.type,
        valid: selectedSimulation.state.isValid,
        driveEnabled: foundryProjectDriveEnabled,
      },
      { level: "metrics", immediate: true },
    );
  }, [foundryPlaying]);
  useEffect(() => {
    recordStudyEvent(
      "simulation.validation",
      {
        mechanismType: foundry.type,
        valid: selectedSimulation.state.isValid && foundryProjectDriveEnabled && !motionWarning,
        warning: Boolean(motionWarning),
        transaction: foundryTransaction.status,
        category: fabricationDiagnosticCategory(foundryTransaction.blocker, motionWarning) ?? "none",
      },
      { level: "metrics", coalesceKey: "foundry-validation" },
    );
  }, [foundry.type, foundryProjectDriveEnabled, foundryTransaction.status, motionWarning, selectedSimulation.state.isValid]);
  const makePackage = (): FoundryExportPackage => {
    const mechanismId = landedFoundry.id;
    const state = calculateLinkage(
      landedFoundry,
      0,
      project.settings.physicalKit,
    );
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
      parameters: { ...foundryCandidate, id: mechanismId },
      pivot: landing,
      outputPoint: state.isValid ? physicalOutputPoint : undefined,
      generatedPath: foundryCandidate.generatedPath ?? preview,
      simulationSummary: feasibilityText,
      visual: {
        color: landedFoundry.color,
        scale: landedFoundry.transform?.scale ?? 1,
        constraintsVisible: true,
      },
      animation: {
        duration: selectedPath?.duration ?? 3200,
        steps: foundryCandidate.generatedPath?.length ?? preview.length,
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
  const useFoundryMechanism = () => {
    if (!foundryProjectDriveEnabled) return;
    onExport(makePackage());
  };
  const selectFoundryMechanismType = (type: MechanismType) => {
    setSelectedOutputTraceId(null);
    const next = {
      ...createDefaultMechanism(type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    };
    setFreshAnchoredFoundry(next);
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
    if (presetId === "balanced") setFreshAnchoredFoundry(next);
    else setAnchoredFoundry(next);
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
            transactionBlocker={
              targetReady && foundryTransaction.status === "blocked"
                ? foundryTransaction.blocker
                : undefined
            }
            onToggleAnchorPick={() => setIsPickingAnchor((value) => !value)}
            onFitPath={() => applyPathFit()}
            onUseMechanism={useFoundryMechanism}
            onSelectMechanismType={selectFoundryMechanismType}
          />,
        ),
        canvas: canvasPane(
          foundrySceneContract ? <FoundryCanvasPane
            foundry={foundry}
            landedFoundry={landedFoundry}
            mechanismContract={foundrySceneContract}
            foundryPlaying={foundryPlaying && foundryProjectDriveEnabled}
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
            showPathPreview={showPathPreview && foundryProjectDriveEnabled}
            showTrail={showTrail && foundryProjectDriveEnabled}
            showForces={showForces && foundryProjectDriveEnabled}
            showVelocity={showVelocity && foundryProjectDriveEnabled}
            outputTraceLabel={outputTraceLabel}
            canCycleOutputTrace={rawFoundryPointTraces.length > 1}
            isPickingAnchor={isPickingAnchor}
            isOrbitingFoundry={isOrbitingFoundry}
            isZoomingFoundry={isZoomingFoundry}
            isPanningFoundry={isPanningFoundry}
            physicsRule={physicsRule}
            motionWarning={motionWarning}
            velocityMagnitude={foundryProjectDriveEnabled ? velocityMagnitude : 0}
            forceMagnitude={foundryProjectDriveEnabled ? forceMagnitude : 0}
            frictionCoefficient={project.settings.simulationFriction}
            frictionMagnitude={foundryProjectDriveEnabled ? frictionMagnitude : 0}
            constraintError={foundryProjectDriveEnabled ? constraintError : 0}
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
            selectedConnection={connectionInteraction.selectedHandle ? { role: connectionInteraction.selectedHandle.role, kind: connectionInteraction.selectedHandle.kind, holeIndex: connectionInteraction.selectedHandle.holeIndex } : undefined}
            connectionBlocker={connectionInteraction.blocker}
            connectionRecoveryRole={connectionInteraction.recoveryRole}
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
            onConnectionHoleSelect={connectionInteraction.selectHandle}
            onConnectionHoleInteractionStart={connectionInteraction.beginInteraction}
            onConnectionHolePointerDown={connectionInteraction.onPointerDown}
            onConnectionHolePointerMove={connectionInteraction.onPointerMove}
            onConnectionHolePointerUp={connectionInteraction.onPointerUp}
            draggingConnectionSelection={connectionInteraction.dragging}
          /> : (
            <div className="foundry-preview-blocked" data-testid="foundry-unsafe-preview">
              Fix mechanism geometry.
            </div>
          ),
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

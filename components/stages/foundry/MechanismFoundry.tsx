import { useEffect, useMemo, useRef, useState } from "react";
import { ThreeFoundryPreview } from "./ThreeFoundryPreview";
import { FoundryInspectorPanel } from "./FoundryInspectorPanel";
import { FoundryWorkflowPanel } from "./FoundryWorkflowPanel";
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
} from "../../../types";
import {
  calculateLinkage,
  generateCurvePoints,
  generateMechanismPointTraces,
} from "../../../utils/kinematics";
import { buildFoundryPhysicsOverlay } from "../../../utils/physicsSession";
import {
  FABRICATION_RENDER_LAYER_Z_STEP,
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
  type FoundryCameraPreset,
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
  fitMechanismSimulationWithContext,
  fitPointsToBox,
  pointsToSvgPath,
} from "../../../utils/mechanismPreview";
import { normalizeGearMeshMechanism } from "../../../utils/mechanismRecommendations";
import { VIEWER3D_CONTRACT_VERSION } from "../../../utils/viewer3d";
import { createDefaultMechanism, uid } from "../../../utils/project";
import { preferredMotionJointId } from "../../../utils/motion";

export const MechanismFoundry = ({
  project,
  foundry,
  setFoundry,
  selectedPart,
  selectedPath,
  goStage,
  onExport,
}: {
  project: ProjectState;
  foundry: MechanismConfig;
  setFoundry: (m: MechanismConfig) => void;
  selectedPart?: BodyPartLayer;
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
  const [showPathPreview, setShowPathPreview] = useState(false);
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
    handle: "B" | "C" | "D";
  } | null>(null);
  const targetReady = Boolean(
    selectedPart &&
    selectedPath &&
    selectedPath.enabled &&
    selectedPath.points.length >= 3,
  );
  const rawLanding =
    manualAnchor ??
    selectedPath?.points[0] ??
    (selectedPart
      ? bodyPartPivotScene(selectedPart, project.skeleton)
      : { x: foundry.anchorX ?? 0, y: foundry.anchorY ?? 0 });
  const landingBoard = sceneToBoard(rawLanding, project.settings.physicalKit);
  const landing = boardToScene(
    landingBoard.col,
    landingBoard.row,
    project.settings.physicalKit,
  );
  const snapDistance = Math.hypot(
    rawLanding.x - landing.x,
    rawLanding.y - landing.y,
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
  const rawFoundryPointTraces = useMemo(
    () => generateMechanismPointTraces(landedFoundry, 96).traces,
    [landedFoundry],
  );
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
  const targetIkJointId = selectedPart
    ? preferredMotionJointId(
        project,
        selectedPart.id,
        selectedPath?.targetAnchorJointId,
        { preferDistalWhenRoot: !selectedPath?.targetAnchorJointId },
      )
    : undefined;
  const targetChainRootJointId =
    selectedPath?.chainRootJointId ?? selectedPart?.anchorJointId;
  const feasibilityText = range.warning ?? "360°";
  const foundryFitContext = useMemo(
    () => createMechanismFitContext(landedFoundry, 360, 240, 96),
    [landedFoundry],
  );
  const selectedSimulation = useMemo(
    () =>
      fitMechanismSimulationWithContext(
        landedFoundry,
        foundryPhase,
        foundryFitContext,
      ),
    [landedFoundry, foundryPhase, foundryFitContext],
  );
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
        foundryPhase,
        project.settings,
        previewPoints,
      ),
    [
      landedFoundry,
      selectedPhysicalSimulation,
      foundryPhase,
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
    const pin = foundryOverlayPinStackById.get(handleId ?? "");
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
  const foundryParamHandles =
    landedFoundry.type === "4bar"
      ? (
          [
            {
              id: "A",
              label: "A fixed",
              point: selectedSimulation.state.p1,
              draggable: false,
            },
            {
              id: "B",
              label: "B crank",
              point: selectedSimulation.state.j1,
              draggable: true,
            },
            {
              id: "C",
              label: "C output",
              point: selectedSimulation.state.j2,
              draggable: true,
            },
            {
              id: "D",
              label: "D ground",
              point: selectedSimulation.state.p2,
              draggable: true,
            },
          ] as const
        )
          .map((handle) => {
            const z = foundryOverlayZForHandle(handle.id);
            return {
              ...handle,
              z,
              screen: projectFoundryOverlayPoint(
                handle.point,
                foundryCamera,
                foundryProjectionSize,
                z,
              ),
            };
          })
          .filter((handle) => handle.screen)
      : [];
  const foundryParamHandleZSummary = foundryParamHandles
    .map((handle) => `${handle.id}:${handle.z.toFixed(2)}`)
    .join(",");
  const hardBlocked =
    !targetReady ||
    range.percentValid === 0 ||
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
  const updateFoundryParam = (key: keyof MechanismConfig, value: number) => {
    if (key === "anchorX" || key === "anchorY") {
      const anchor = {
        x: key === "anchorX" ? value : (foundry.anchorX ?? landing.x),
        y: key === "anchorY" ? value : (foundry.anchorY ?? landing.y),
      };
      setManualAnchor(anchor);
      setFoundry(
        normalizeGearMeshMechanism({
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
    setFoundry(normalizeGearMeshMechanism({ ...foundry, [key]: value }));
  };
  const updateFoundryParams = (updates: Partial<MechanismConfig>) => {
    setFoundry(normalizeGearMeshMechanism({ ...foundry, ...updates }));
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
    handle: "B" | "C" | "D",
    point: Point,
  ) => {
    const s = selectedSimulation.state;
    const scale = Math.max(0.001, selectedSimulation.scale);
    const sceneDistance = (a: Point, b: Point) =>
      Math.hypot(a.x - b.x, a.y - b.y) / scale;
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
    (handle: "B" | "C" | "D") =>
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
    setFoundry(normalizeGearMeshMechanism(keepCurrentAnchor(mechanism)));
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
    setIsPickingAnchor(false);
    setShowForces(true);
    setShowVelocity(true);
    setShowTrail(false);
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
    const mechanismId = uid("mech");
    const state = calculateLinkage(landedFoundry, 0);
    const physicalOutputPoint =
      landedFoundry.type === "4bar" ||
      landedFoundry.type === "5bar" ||
      landedFoundry.type === "6bar"
        ? state.j2
        : (state.effector ?? state.j2);
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
      warnings: range.warning ? [range.warning] : [],
      source: "mechanism-foundry",
    };
  };
  const useFoundryMechanism = () => onExport(makePackage());
  const selectFoundryMechanismType = (type: MechanismType) =>
    setAnchoredFoundry({
      ...createDefaultMechanism(type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    });
  const selectFoundryPreset = (presetId: string) => {
    const preset = FOUNDRY_PRESETS[presetId];
    const { label: _label, ...updates } = preset;
    const base =
      presetId === "balanced"
        ? createDefaultMechanism(foundry.type, "foundry-preview")
        : foundry;
    setAnchoredFoundry({
      ...base,
      color: foundry.color,
      ...updates,
      presetId,
      recommendation: preset.recommendation,
    });
  };
  return (
    <EditorStageFrame
      stage="foundry"
      className="foundry-stage-frame"
      layout={{
        workflow: workflowPane(
          <FoundryWorkflowPanel
            project={project}
            selectedPart={selectedPart}
            selectedPath={selectedPath}
            goStage={goStage}
            foundry={foundry}
            foundryPhase={foundryPhase}
            landingBoardLabel={landingBoard.label}
            targetChainRootJointId={targetChainRootJointId}
            targetIkJointId={targetIkJointId}
            snapDistance={snapDistance}
            rangePercentValid={range.percentValid}
            rangeWarning={range.warning}
            feasibilityText={feasibilityText}
            targetReady={targetReady}
            isPickingAnchor={isPickingAnchor}
            hasManualAnchor={Boolean(manualAnchor)}
            hardBlocked={hardBlocked}
            showSensemaking={showSensemaking}
            classroomSensemaking={classroomSensemaking}
            physicsRule={physicsRule}
            libraryLabel={library.label}
            onToggleAnchorPick={() => setIsPickingAnchor((value) => !value)}
            onUseMechanism={useFoundryMechanism}
            onSelectMechanismType={selectFoundryMechanismType}
          />,
        ),
        canvas: canvasPane(
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
                3D {foundryCameraLabel} · {Math.round(foundryCamera.zoom * 100)}
                %
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
                  onClick={() => setCameraPreset(preset)}
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
                onClick={() => setShowFoundryGrid(!showFoundryGrid)}
              >
                Grid
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-paths"
                className={showPathPreview ? "active" : ""}
                aria-label="Path layer"
                aria-pressed={showPathPreview}
                onClick={() => setShowPathPreview(!showPathPreview)}
              >
                Path
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-forces"
                className={showForces ? "active" : ""}
                aria-label="Force vector layer"
                aria-pressed={showForces}
                onClick={() => setShowForces(!showForces)}
              >
                Force
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-velocity"
                className={showVelocity ? "active" : ""}
                aria-label="Speed vector layer"
                aria-pressed={showVelocity}
                onClick={() => setShowVelocity(!showVelocity)}
              >
                v
              </button>
              <button
                type="button"
                data-testid="foundry-toggle-trail"
                className={showTrail ? "active" : ""}
                aria-label="Motion trace layer"
                aria-pressed={showTrail}
                onClick={() => setShowTrail(!showTrail)}
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
                onClick={() => setFoundryPlaying(!foundryPlaying)}
              >
                {foundryPlaying ? "Pause" : "Play"}
              </button>
              <button className="btn-secondary" onClick={resetFoundryPreview}>
                Reset
              </button>
              <input
                aria-label="Foundry phase"
                type="range"
                min="0"
                max="360"
                value={foundryPhaseDegrees}
                onChange={(event) => {
                  setFoundryPlaying(false);
                  setFoundryPhase((Number(event.target.value) * Math.PI) / 180);
                }}
              />
              <span>{foundryPhaseDegrees}°</span>
            </div>
            <ThreeFoundryPreview
              mechanism={landedFoundry}
              simulation={selectedPhysicalSimulation}
              kit={project.settings.physicalKit}
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
              frictionCoefficient={project.settings.simulationFriction}
              frictionMagnitude={frictionMagnitude}
              constraintError={constraintError}
              cameraLabel={foundryCameraLabel}
              isPickingAnchor={isPickingAnchor}
              isOrbiting={isOrbitingFoundry}
              isZooming={isZoomingFoundry}
              isPanning={isPanningFoundry}
              onAnchorPick={handleAnchorPick}
              onPointerDown={handleFoundryPointerDown}
              onPointerMove={handleFoundryPointerMove}
              onPointerUp={finishFoundryOrbit}
              onPointerCancel={finishFoundryOrbit}
              onWheel={handleFoundryWheel}
              onProjectionSizeChange={updateFoundryProjectionSize}
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
                      <text
                        x={projectedForceTip.x + 5}
                        y={projectedForceTip.y - 3}
                      >
                        F / a
                      </text>
                      <text
                        x={projectedDriveTip.x + 5}
                        y={projectedDriveTip.y + 9}
                      >
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
                    <text
                      x={projectedVelocityTip.x + 5}
                      y={projectedVelocityTip.y - 3}
                    >
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
                              ? handleFoundryParamPointerDown(
                                  handle.id as "B" | "C" | "D",
                                )
                              : undefined
                          }
                          onPointerMove={
                            handle.draggable
                              ? handleFoundryParamPointerMove
                              : undefined
                          }
                          onPointerUp={
                            handle.draggable
                              ? handleFoundryParamPointerUp
                              : undefined
                          }
                          onPointerCancel={
                            handle.draggable
                              ? handleFoundryParamPointerUp
                              : undefined
                          }
                        />
                        <text className="foundry-param-label" x="10" y="-8">
                          {handle.id}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
                {(isPickingAnchor || manualAnchor) && projectedAnchorMarker && (
                  <g
                    data-testid="foundry-anchor-marker"
                    data-projection="three-camera"
                    transform={`translate(${projectedAnchorMarker.x} ${projectedAnchorMarker.y})`}
                  >
                    <circle
                      r="8"
                      fill="#ffffff"
                      stroke="#8b5cf6"
                      strokeWidth="3"
                    />
                    <path
                      d="M -13 0 H 13 M 0 -13 V 13"
                      stroke="#8b5cf6"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <text
                      x="12"
                      y="-10"
                      fill="#5b21b6"
                      fontSize="8"
                      fontWeight="900"
                    >
                      {landingBoard.label}
                    </text>
                  </g>
                )}
              </svg>
            </ThreeFoundryPreview>
            <div hidden data-testid="foundry-toolbar-state">
              Toolbar: {foundryPlaying ? "playing" : "paused"} · grid{" "}
              {showFoundryGrid ? "shown" : "hidden"} · path{" "}
              {showPathPreview ? "shown" : "hidden"} · camera{" "}
              {foundryCameraLabel} · phase{" "}
              {Math.round((foundryPhase * 180) / Math.PI)}°
            </div>
          </section>,
        ),
        inspector: inspectorPane(
          <FoundryInspectorPanel
            foundry={foundry}
            libraryLabel={library.label}
            physicsRule={physicsRule}
            velocityMagnitude={velocityMagnitude}
            forceMagnitude={forceMagnitude}
            simulationFriction={project.settings.simulationFriction}
            constraintError={constraintError}
            simulationMassKg={project.settings.simulationMassKg}
            foundryRigOpacity={foundryRigOpacity}
            foundryExplode={foundryExplode}
            showForces={showForces}
            showVelocity={showVelocity}
            showTrail={showTrail}
            showPathPreview={showPathPreview}
            showSensemaking={showSensemaking}
            onRigOpacityChange={setFoundryRigOpacity}
            onExplodeChange={setFoundryExplode}
            onUpdateParams={updateFoundryParams}
            onChangeParam={updateFoundryParam}
            onSetMechanismType={selectFoundryMechanismType}
            onSetPreset={selectFoundryPreset}
            onToggleForces={() => setShowForces((value) => !value)}
            onToggleVelocity={() => setShowVelocity((value) => !value)}
            onToggleTrail={() => setShowTrail((value) => !value)}
            onTogglePathPreview={() => setShowPathPreview((value) => !value)}
            onToggleSensemaking={() => setShowSensemaking((value) => !value)}
            onHideSensemaking={() => setShowSensemaking(false)}
          />,
        ),
      }}
    />
  );
};

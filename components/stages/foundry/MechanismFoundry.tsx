import { useEffect, useMemo, useRef, useState } from "react";
import { FoundryCanvasPane } from "./FoundryCanvasPane";
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
  SceneObject,
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
import {
  fitMechanismToTargetPath,
  normalizeGearMeshMechanism,
} from "../../../utils/mechanismRecommendations";
import { createDefaultMechanism, uid } from "../../../utils/project";
import { preferredMotionJointId } from "../../../utils/motion";

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
    const traces = generateMechanismPointTraces(landedFoundry, 96).traces;
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
  }, [landedFoundry]);
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
  const applyPathFit = (mechanism = foundry) => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
    setShowUserPathPreview(true);
    setShowPathPreview(true);
    setFoundry(createPathFittedFoundry(mechanism));
  };
  const resetFoundryPreview = () => {
    setFoundryPlaying(false);
    setFoundryPhase(0);
    setManualAnchor(null);
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
      },
      warnings: range.warning ? [range.warning] : [],
      source: "mechanism-foundry",
    };
  };
  const useFoundryMechanism = () => onExport(makePackage());
  const selectFoundryMechanismType = (type: MechanismType) => {
    const next = {
      ...createDefaultMechanism(type, "foundry-preview"),
      color: foundry.color,
      presetId: "balanced",
      recommendation: FOUNDRY_PRESETS.balanced.recommendation,
    };
    setAnchoredFoundry(next);
  };
  const selectFoundryPreset = (presetId: string) => {
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
            rangeWarning={range.warning}
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
            isPickingAnchor={isPickingAnchor}
            isOrbitingFoundry={isOrbitingFoundry}
            isZoomingFoundry={isZoomingFoundry}
            isPanningFoundry={isPanningFoundry}
            physicsRule={physicsRule}
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

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import {
  gearPairOutputRatio,
  gearTrainMeshPhaseDegAt,
  gearTrainOutputRatio,
  gearTrainPitchRadii,
  planetaryCarrierOutputRatio,
} from "../../../utils/kinematics";
import {
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_RENDER_PART_DEPTH,
  fabricationRenderPlanForMechanism,
  planetaryGearConventionForMechanism,
  planetaryGearRadii,
  validateMechanismPreviewReadiness,
} from "../../../utils/fabrication";
import { SCENE_PX_PER_MM, SCENE_VIEW } from "../../../utils/coordinates";
import {
  loadRapierPhysicsKernel,
  physicsKernelErrorMessage,
} from "../../../utils/physicsKernel";
import {
  VIEWER3D_CONTRACT_VERSION,
  createViewer3DContract,
  viewer3DLayerDataValue,
} from "../../../utils/viewer3d";
import {
  degToRad,
  foundryCameraPosition,
  foundryCameraTarget,
  type FoundryCamera,
  type FoundryOverlaySize,
} from "../../../utils/foundryCamera";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import { setRendererPixelRatioCap } from "../../../utils/threeResourceKit";
import { fittedGearTrainCenters } from "./foundryPreviewGeometry";
import { FoundryPreviewStateProbe } from "./FoundryPreviewStateProbe";
import {
  foundryAssemblyLayerFocusSummary,
  renderFoundryAssemblySceneOverlay,
  type FoundryAssemblySceneFrame,
} from "./foundryAssemblySceneOverlay";
import {
  createFoundryThreePrimitiveFactory,
  disposeFoundryThreeObject,
} from "./foundryThreePrimitives";
import { renderFoundryDynamicLayers } from "./foundryThreeRenderLayers";
import { foundryRenderedInventory } from "./foundryRenderInventory";
import {
  foundryAssemblyPinContract,
  foundryAssemblyPinPoints,
  foundryLocalSpacerZForPin,
  foundryLocalSpacerZsForPin,
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
  foundrySpacerTouchesPin,
  isMovingRenderKind,
  type FoundryPinStackPoint,
} from "./foundryPreviewStacks";

type ThreeFoundryPreviewProps = {
  mechanism: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  kit: PhysicalKitSettings;
  camera: FoundryCamera;
  rigOpacity: number;
  color: string;
  pathPoints: Point[];
  pathTraces: Array<{
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
  }>;
  showGrid: boolean;
  showPathPreview: boolean;
  showTrail: boolean;
  showForces: boolean;
  showVelocity: boolean;
  explode: number;
  physicsRule: string;
  velocityMagnitude: number;
  forceMagnitude: number;
  frictionCoefficient: number;
  frictionMagnitude: number;
  constraintError: number;
  cameraLabel: string;
  isPickingAnchor: boolean;
  isOrbiting: boolean;
  isZooming: boolean;
  isPanning: boolean;
  onAnchorPick: (point: Point) => void;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onProjectionSizeChange: (size: FoundryOverlaySize) => void;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  children: React.ReactNode;
};

export const ThreeFoundryPreview = ({
  mechanism,
  simulation,
  kit,
  camera,
  rigOpacity,
  color,
  pathPoints,
  pathTraces,
  showGrid,
  showPathPreview,
  showTrail,
  showForces,
  showVelocity,
  explode,
  physicsRule,
  velocityMagnitude,
  forceMagnitude,
  frictionCoefficient,
  frictionMagnitude,
  constraintError,
  cameraLabel,
  isPickingAnchor,
  isOrbiting,
  isZooming,
  isPanning,
  onAnchorPick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onProjectionSizeChange,
  assemblySceneFrame,
  children,
}: ThreeFoundryPreviewProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraStateRef = useRef(camera);
  const dynamicBuildCountRef = useRef(0);
  const geometryCacheRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const materialCacheRef = useRef<Map<string, THREE.Material>>(new Map());
  const [physicsKernelRuntime, setPhysicsKernelRuntime] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [physicsKernelVersion, setPhysicsKernelVersion] = useState("pending");
  const [physicsKernelError, setPhysicsKernelError] = useState("none");
  const isGearTrain =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const isPlanetaryGear = mechanism.type === "planetary_gear";
  const gearRadii = isGearTrain
    ? gearTrainPitchRadii(mechanism)
    : mechanism.type === "planetary_gear"
      ? planetaryGearRadii(mechanism)
      : [mechanism.crankLength, mechanism.rockerLength];
  const gearCenters = isGearTrain
    ? fittedGearTrainCenters(
        gearRadii,
        simulation.state.p1,
        simulation.state.p2,
      )
    : [];
  const planetaryConvention =
    mechanism.type === "planetary_gear"
      ? planetaryGearConventionForMechanism(mechanism)
      : null;
  const baseInv = foundryRenderedInventory(mechanism.type);
  const inv = isGearTrain
    ? {
        ...baseInv,
        gears: gearRadii.length,
        parts: Math.max(baseInv.parts, gearRadii.length + 4),
      }
    : mechanism.type === "planetary_gear"
      ? {
          ...baseInv,
          gears: gearRadii.length,
          parts: Math.max(baseInv.parts, gearRadii.length + 4),
        }
      : baseInv;
  const pinionRotation = simulation.driveAngleDeg;
  const renderPlan = useMemo(
    () => fabricationRenderPlanForMechanism(mechanism),
    [mechanism],
  );
  const physicalValidationErrors = useMemo(
    () => validateMechanismPreviewReadiness(mechanism),
    [mechanism],
  );
  const physicalValidationSummary = physicalValidationErrors.join(" | ");
  const stackLayerZ = useMemo(
    () =>
      renderPlan.layers.map(
        (item) =>
          item.z +
          explode * item.stackIndex * FABRICATION_RENDER_LAYER_Z_STEP * 1.5,
      ),
    [explode, renderPlan],
  );
  const gearLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        item.renderKind === "gear" ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const gearMeshPlaneZ =
    (isGearTrain || isPlanetaryGear) && explode <= 0 && gearLayerIndexes.length
      ? stackLayerZ[gearLayerIndexes[0]]
      : undefined;
  const renderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        mechanism.type,
        renderPlan.layers,
        stackLayerZ,
        gearMeshPlaneZ,
      ),
    [gearMeshPlaneZ, mechanism.type, renderPlan.layers, stackLayerZ],
  );
  const activeGearPlaneZ =
    typeof gearMeshPlaneZ === "number"
      ? gearMeshPlaneZ
      : isPlanetaryGear && gearLayerIndexes.length
        ? renderedLayerZ[gearLayerIndexes[0]]
        : undefined;
  const gearPlaneMode = isGearTrain
    ? typeof gearMeshPlaneZ === "number"
      ? "coplanar-fixed-axles"
      : "exploded-stack"
    : isPlanetaryGear
      ? typeof gearMeshPlaneZ === "number"
        ? "planetary-coplanar-ring-sun-planet"
        : "exploded-stack"
      : "not-gear-train";
  const viewerContract = useMemo(
    () =>
      createViewer3DContract("foundry", camera.preset, {
        grid: showGrid,
        character: "absent",
        skeleton: "absent",
        mechanisms: true,
        paths: showPathPreview,
        forces: showForces,
        velocity: showVelocity,
        trail: showTrail,
      }),
    [
      camera.preset,
      showForces,
      showGrid,
      showPathPreview,
      showTrail,
      showVelocity,
    ],
  );
  const spacerLayerCount = renderPlan.layers.filter(
    (item) => item.role === "spacer",
  ).length;
  const assemblyPinPoints = useMemo(
    () =>
      isGearTrain
        ? mechanism.type === "gear_linkage"
          ? [
              ...gearCenters,
              simulation.state.j1,
              simulation.state.j2,
              simulation.state.effector,
            ].filter((point): point is Point => Boolean(point))
          : gearCenters
        : foundryAssemblyPinPoints(mechanism.type, simulation.state),
    [gearCenters, isGearTrain, mechanism.type, simulation.state],
  );
  const assemblyPinContract = foundryAssemblyPinContract(mechanism.type);
  const movingLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        isMovingRenderKind(item.renderKind) ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const spacerLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        item.role === "spacer" ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const pinStackPoints = useMemo(
    () =>
      foundryPinStackPoints(
        mechanism.type,
        assemblyPinPoints,
        movingLayerIndexes,
        spacerLayerIndexes,
      ),
    [assemblyPinPoints, mechanism.type, movingLayerIndexes, spacerLayerIndexes],
  );
  const localSpacerZsForPin = useMemo(
    () => (pin: FoundryPinStackPoint) =>
      foundryLocalSpacerZsForPin(
        mechanism.type,
        pin,
        renderedLayerZ,
        renderPlan.layers,
      ),
    [mechanism.type, renderPlan.layers, renderedLayerZ],
  );
  const localSpacerZForPin = useMemo(
    () => (pin: FoundryPinStackPoint, spacerLayerIndex?: number) =>
      foundryLocalSpacerZForPin(
        mechanism.type,
        pin,
        renderedLayerZ,
        renderPlan.layers,
        spacerLayerIndex,
      ),
    [mechanism.type, renderPlan.layers, renderedLayerZ],
  );
  const usesLocalSpacerPins =
    mechanism.type === "4bar" || isGearTrain || isPlanetaryGear;
  const pinStacks = useMemo(
    () =>
      foundryPinStacks(pinStackPoints, renderedLayerZ, {
        includeSpacerZ: usesLocalSpacerPins,
        spacerZForPin: localSpacerZsForPin,
      }),
    [localSpacerZsForPin, pinStackPoints, renderedLayerZ, usesLocalSpacerPins],
  );
  const spacerRenderCount = spacerLayerIndexes.reduce(
    (count, spacerIndex) =>
      count +
      pinStackPoints.filter((pin) => foundrySpacerTouchesPin(pin, spacerIndex))
        .length,
    0,
  );
  const boardPivotPinStacks =
    mechanism.type === "4bar"
      ? pinStacks.filter((pin) => pin.id === "A" || pin.id === "D")
      : [];
  const boardPivotSpacerZ = (pin: FoundryPinStackPoint) =>
    localSpacerZForPin(pin);
  const boardPivotSpacerSummary = boardPivotPinStacks
    .map((pin) => `${pin.id}:${boardPivotSpacerZ(pin)?.toFixed(2) ?? "n/a"}`)
    .join(",");
  const gearBoardSpacerSummary = isGearTrain
    ? pinStackPoints
        .slice(0, gearCenters.length)
        .map(
          (pin) => `${pin.id}:${localSpacerZForPin(pin)?.toFixed(2) ?? "n/a"}`,
        )
        .join(",")
    : "";
  const gearAxleZOrderSummary = isGearTrain
    ? pinStackPoints
        .slice(0, gearCenters.length)
        .map((pin) => {
          const gearLayerIndex = pin.movingLayerIndexes.find(
            (index) => renderPlan.layers[index]?.renderKind === "gear",
          );
          const gearZ =
            typeof gearLayerIndex === "number"
              ? renderedLayerZ[gearLayerIndex]
              : undefined;
          const spacerZ = localSpacerZForPin(pin);
          const fastenerZ = pinStacks.find(
            (stack) => stack.id === pin.id,
          )?.topZ;
          const ordered =
            typeof spacerZ === "number" &&
            typeof gearZ === "number" &&
            typeof fastenerZ === "number" &&
            spacerZ < gearZ &&
            gearZ < fastenerZ;
          return `${pin.id}:${ordered ? "S10<gear<fastener" : "invalid"}`;
        })
        .join(",")
    : "";
  const gearLinkagePinZOrderSummary =
    mechanism.type === "gear_linkage"
      ? pinStackPoints
          .slice(gearCenters.length)
          .map((pin) => {
            const movingEntries = pin.movingLayerIndexes
              .map((index) => ({
                z: renderedLayerZ[index],
                label:
                  renderPlan.layers[index]?.renderKind === "gear"
                    ? "gear"
                    : renderPlan.layers[index]?.renderKind === "guide"
                      ? "bracket"
                      : (renderPlan.layers[index]?.renderKind ?? "part"),
              }))
              .filter(
                (entry): entry is { z: number; label: string } =>
                  typeof entry.z === "number",
              );
            const spacerEntries = localSpacerZsForPin(pin).map((z) => ({
              z,
              label: "S10",
            }));
            const ordered = [...movingEntries, ...spacerEntries]
              .sort((a, b) => a.z - b.z)
              .map((entry) => entry.label)
              .join("<");
            const validCrank =
              pin.id === "B"
                ? /gear<.*S10<.*linkage/.test(ordered)
                : pin.id === "C"
                  ? /gear<.*S10<.*S10<.*linkage/.test(ordered)
                  : pin.id === "R"
                    ? /linkage<.*S10<.*linkage/.test(ordered)
                    : true;
            return `${pin.id}:${validCrank ? ordered : "invalid"}`;
          })
          .join(",")
      : "";
  const stackZGap =
    renderPlan.layers.length > 1
      ? renderPlan.layers[1].z - renderPlan.layers[0].z
      : 0;
  const pinBottomZ = pinStacks.length
    ? Math.min(...pinStacks.map((pin) => pin.bottomZ))
    : (renderedLayerZ[0] ?? 0.22) - 0.08;
  const pinTopZ = pinStacks.length
    ? Math.max(...pinStacks.map((pin) => pin.topZ))
    : (renderedLayerZ.at(-1) ?? 0.22) + 0.18;
  const pinLengthZ = pinStacks.length
    ? Math.max(...pinStacks.map((pin) => pin.lengthZ))
    : Math.max(0.55, pinTopZ - pinBottomZ);
  const pinSpanSummary = pinStacks
    .map((pin) => `${pin.id}:${pin.lengthZ.toFixed(2)}`)
    .join(",");
  const pinStackLayerSummary = pinStackPoints
    .map((pin) => `${pin.id}:${pin.movingLayerIndexes.join("+") || "none"}`)
    .join(",");
  const spacerPinIdSummary = spacerLayerIndexes
    .map(
      (spacerIndex) =>
        `${spacerIndex}:${pinStackPoints
          .filter((pin) => foundrySpacerTouchesPin(pin, spacerIndex))
          .map((pin) => pin.id)
          .join("+")}`,
    )
    .join(",");
  const gearAxleCenters = isGearTrain
    ? pinStackPoints.slice(0, gearCenters.length).map((pin) => pin.point)
    : [];
  const gearCenterSummary = gearCenters
    .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
    .join(",");
  const gearAxleCenterSummary = gearAxleCenters
    .map((point) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`)
    .join(",");
  const gearEndpointMode = isGearTrain
    ? gearRadii.length > 2
      ? "idler-connected-pitch-chain"
      : mechanism.type === "gear"
        ? "direct-pitch-mesh"
        : "separated-endpoints-dual-drivers"
    : "not-gear-train";
  const gearUsesMeshPhases =
    gearEndpointMode === "direct-pitch-mesh" ||
    gearEndpointMode === "idler-connected-pitch-chain";
  const gearCouplingMode = isGearTrain
    ? gearEndpointMode === "idler-connected-pitch-chain"
      ? "idler-coupled"
      : gearEndpointMode === "direct-pitch-mesh"
        ? "direct-mesh"
        : "dual-driven-endpoints"
    : "not-gear-train";
  const gearMeshPhaseSummary = isGearTrain
    ? gearRadii
        .map((_, index) =>
          gearUsesMeshPhases
            ? gearTrainMeshPhaseDegAt(gearRadii, index).toFixed(2)
            : "0.00",
        )
        .join(",")
    : "";
  const gearCenterSource = isGearTrain
    ? gearUsesMeshPhases
      ? "fitted-simulation-pitch-centers"
      : "separated-dual-driver-endpoints"
    : "not-gear-train";
  const gearLinkageSpacingContract =
    mechanism.type === "gear_linkage"
      ? gearEndpointMode === "idler-connected-pitch-chain"
        ? "idler-connected-pitch-chain"
        : "separated-endpoints-await-idlers"
      : "not-gear-linkage";
  const gearCenterMaxError =
    isGearTrain && gearUsesMeshPhases && gearCenters.length > 1
      ? Math.max(
          ...gearCenters.slice(1).map((center, index) => {
            const previous = gearCenters[index];
            const expected =
              (gearRadii[index] + gearRadii[index + 1]) * simulation.scale;
            return Math.abs(
              Math.hypot(center.x - previous.x, center.y - previous.y) -
                expected,
            );
          }),
        )
      : 0;
  const gearOutputRatioForDisplay = isGearTrain
    ? mechanism.type === "gear_linkage" && gearRadii.length <= 2
      ? Number.isFinite(mechanism.speed2)
        ? (mechanism.speed2 ?? 1)
        : Number.isFinite(mechanism.gearRatio)
          ? (mechanism.gearRatio ?? 1)
          : gearTrainOutputRatio(mechanism)
      : gearTrainOutputRatio(mechanism)
    : mechanism.type === "planetary_gear"
      ? planetaryCarrierOutputRatio(
          mechanism.crankLength,
          mechanism.rockerLength,
        )
      : gearPairOutputRatio(mechanism.crankLength, mechanism.rockerLength);
  const localSpacerViolationCount = usesLocalSpacerPins
    ? pinStackPoints.reduce((count, pin) => {
        const movingZ = pin.movingLayerIndexes
          .map((index) => renderedLayerZ[index])
          .filter((z): z is number => typeof z === "number")
          .sort((a, b) => a - b);
        const uniqueMovingZ = movingZ.filter(
          (z, index) => index === 0 || Math.abs(z - movingZ[index - 1]) > 0.001,
        );
        if (!uniqueMovingZ.length) return count;
        const spacerZs = localSpacerZsForPin(pin);
        const expectsLocalSpacer =
          mechanism.type === "4bar"
            ? pin.id === "A" ||
              pin.id === "D" ||
              ((pin.id === "B" || pin.id === "C") && uniqueMovingZ.length >= 2)
            : isGearTrain || isPlanetaryGear;
        if (!expectsLocalSpacer) return count;
        if (!spacerZs.length) return count + 1;
        const minZ = uniqueMovingZ[0];
        const maxZ = uniqueMovingZ.at(-1) ?? minZ;
        const invalid = spacerZs.some((z) =>
          uniqueMovingZ.length === 1
            ? !(
                z < minZ &&
                z >= minZ - FABRICATION_RENDER_LAYER_Z_STEP &&
                z + FABRICATION_RENDER_MIN_CLEARANCE / 2 <=
                  minZ - FABRICATION_RENDER_PART_DEPTH / 2 + 0.001
              )
            : !(z > minZ && z < maxZ),
        );
        return count + (invalid ? 1 : 0);
      }, 0)
    : 0;
  const zCollisionCount =
    pinStacks.filter((pin) => pin.topZ <= pin.bottomZ || pin.lengthZ <= 0)
      .length + localSpacerViolationCount;
  const visiblePathTraces = useMemo(
    () =>
      pathTraces.length
        ? pathTraces
        : [
            {
              id: "output",
              label: "Output path",
              points: pathPoints,
              primary: true,
            },
          ],
    [pathPoints, pathTraces],
  );
  const primaryPathId =
    visiblePathTraces.find((trace) => trace.primary)?.id ??
    visiblePathTraces[0]?.id ??
    "";
  const pathLayerZ = pinTopZ + 0.08;
  const camContactErrorForData =
    mechanism.type === "cam"
      ? (() => {
          const s = simulation.state;
          const guideDx = s.j2.x - s.p1.x;
          const guideDy = s.j2.y - s.p1.y;
          const guideLength = Math.hypot(guideDx, guideDy);
          const guide =
            guideLength > 0.001
              ? { x: guideDx / guideLength, y: guideDy / guideLength }
              : {
                  x: Math.cos(degToRad(mechanism.groundAngle ?? 90)),
                  y: -Math.sin(degToRad(mechanism.groundAngle ?? 90)),
                };
          const contactGap = Math.abs(
            Math.hypot(s.j2.x - s.j1.x, s.j2.y - s.j1.y) -
              Math.max(0, mechanism.sliderOffset) * simulation.scale,
          );
          const axisError = Math.abs(
            (s.j1.x - s.p1.x) * guide.y - (s.j1.y - s.p1.y) * guide.x,
          );
          return Math.max(contactGap, axisError);
        })()
    : 0;
  const assemblyLayerFocusSummary = useMemo(
    () => foundryAssemblyLayerFocusSummary(assemblySceneFrame, renderPlan.layers),
    [assemblySceneFrame, renderPlan.layers],
  );
  useEffect(() => {
    let active = true;
    loadRapierPhysicsKernel()
      .then((kernel) => {
        if (!active) return;
        setPhysicsKernelRuntime("ready");
        setPhysicsKernelVersion(kernel.version());
        setPhysicsKernelError("none");
      })
      .catch((error) => {
        if (!active) return;
        setPhysicsKernelRuntime("unavailable");
        setPhysicsKernelVersion("unavailable");
        setPhysicsKernelError(physicsKernelErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const renderCamera = (view: FoundryCamera) => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    cam.position.copy(foundryCameraPosition(view));
    cam.lookAt(foundryCameraTarget(view));
    renderer.render(scene, cam);
  };
  const handleAnchorClick: React.MouseEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (!isPickingAnchor) return;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!renderer || !cam) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cam);
    const hit = new THREE.Vector3();
    if (
      !raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
        hit,
      )
    )
      return;
    const previewX = 180 + hit.x * 18;
    const previewY = 120 - hit.y * 18;
    onAnchorPick({
      x: (previewX / 360 - 0.5) * SCENE_VIEW.width,
      y: (0.5 - previewY / 240) * SCENE_VIEW.height,
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    setRendererPixelRatioCap(renderer);
    renderer.shadowMap.enabled = false;
    renderer.domElement.className = "foundry-three-canvas";
    renderer.domElement.dataset.testid = "foundry-three-canvas";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8f9ff");
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 8, 10);
    key.castShadow = true;
    scene.add(key);
    const staticRoot = new THREE.Group();
    staticRoot.name = "foundry-static";
    const grid = new THREE.GridHelper(24, 24, "#c7d2fe", "#e2e8f0");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.9;
    staticRoot.add(grid);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 16),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.9,
        transparent: true,
        opacity: 0.72,
      }),
    );
    plane.receiveShadow = true;
    plane.position.z = -0.94;
    staticRoot.add(plane);
    scene.add(staticRoot);
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = cam;
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      onProjectionSizeChange({ width, height });
      renderer.setSize(width, height, false);
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
      renderCamera(cameraStateRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    renderCamera(cameraStateRef.current);
    return () => {
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentElement === host)
        host.removeChild(renderer.domElement);
      disposeFoundryThreeObject(scene);
      geometryCacheRef.current.forEach((geometry) => geometry.dispose());
      materialCacheRef.current.forEach((material) => material.dispose());
      geometryCacheRef.current.clear();
      materialCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    cameraStateRef.current = camera;
    renderCamera(camera);
  }, [camera]);

  useEffect(() => {
    const scene = sceneRef.current;
    const staticRoot = scene?.getObjectByName("foundry-static");
    if (!staticRoot) return;
    staticRoot.visible = showGrid;
    renderCamera(cameraStateRef.current);
  }, [showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    const old = scene.getObjectByName("foundry-dynamic");
    if (old) {
      scene.remove(old);
      disposeFoundryThreeObject(old);
    }
    const root = new THREE.Group();
    root.name = "foundry-dynamic";
    scene.add(root);
    if (renderPlan.validationErrors.length || physicalValidationErrors.length) {
      dynamicBuildCountRef.current += 1;
      if (stateRef.current) {
        stateRef.current.dataset.threeDynamicBuildCount = String(
          dynamicBuildCountRef.current,
        );
        stateRef.current.dataset.threeGeometryCacheSize = String(
          geometryCacheRef.current.size,
        );
        stateRef.current.dataset.threeMaterialCacheSize = String(
          materialCacheRef.current.size,
        );
      }
      renderCamera(cameraStateRef.current);
      return;
    }
    const primitives = createFoundryThreePrimitiveFactory({
      root,
      geometryCache: geometryCacheRef.current,
      materialCache: materialCacheRef.current,
      mechanism,
      kit,
      color,
      rigOpacity,
      baseColor: renderPlan.base.color,
      simulationScale: simulation.scale,
    });
    renderFoundryDynamicLayers({
      mechanism,
      simulation,
      primitives,
      renderPlan,
      renderedLayerZ,
      pinStacks,
      localSpacerZForPin,
      visiblePathTraces,
      pathLayerZ,
      showPathPreview,
      showTrail,
      pinionRotation,
      isGearTrain,
      gearRadii,
      gearCenters,
      gearUsesMeshPhases,
      gearOutputRatioForDisplay,
      assemblySceneFrame,
    });
    renderFoundryAssemblySceneOverlay({
      root,
      frame: assemblySceneFrame,
      mechanism,
      simulation,
      kit,
      pinBottomZ,
      pinTopZ,
      pathLayerZ,
      pathPoints,
    });

    dynamicBuildCountRef.current += 1;
    if (stateRef.current) {
      stateRef.current.dataset.threeDynamicBuildCount = String(
        dynamicBuildCountRef.current,
      );
      stateRef.current.dataset.threeGeometryCacheSize = String(
        geometryCacheRef.current.size,
      );
      stateRef.current.dataset.threeMaterialCacheSize = String(
        materialCacheRef.current.size,
      );
    }
    renderCamera(cameraStateRef.current);
  }, [
    mechanism,
    simulation,
    kit,
    color,
    visiblePathTraces,
    pathLayerZ,
    showPathPreview,
    showTrail,
    pinionRotation,
    renderPlan,
    renderedLayerZ,
    pinStacks,
    rigOpacity,
    physicalValidationErrors,
    assemblySceneFrame,
    pinBottomZ,
    pinTopZ,
    pathPoints,
    localSpacerZForPin,
  ]);

  return (
    <div
      data-testid="foundry-preview"
      onClick={handleAnchorClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      className={`foundry-preview h-[520px] w-full ${isPickingAnchor ? "is-picking-anchor" : ""} ${isOrbiting ? "is-orbiting" : ""} ${isZooming ? "is-zooming" : ""} ${isPanning ? "is-panning" : ""}`}
      aria-label="Foundry 3D view"
      data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
      data-viewer-contract-state={JSON.stringify(viewerContract)}
      data-viewer-tab={viewerContract.tab}
      data-layer-grid={viewer3DLayerDataValue(showGrid)}
      data-layer-mechanisms={viewer3DLayerDataValue(true)}
      data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
      data-layer-forces={viewer3DLayerDataValue(showForces)}
      data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
      data-layer-trail={viewer3DLayerDataValue(showTrail)}
    >
      <div ref={hostRef} className="foundry-three-host" />
      <FoundryPreviewStateProbe
        stateRef={stateRef}
        viewerContract={viewerContract}
        camera={camera}
        showGrid={showGrid}
        showPathPreview={showPathPreview}
        showForces={showForces}
        showVelocity={showVelocity}
        showTrail={showTrail}
        rigOpacity={rigOpacity}
        physicsKernelRuntime={physicsKernelRuntime}
        physicsKernelVersion={physicsKernelVersion}
        physicsKernelError={physicsKernelError}
        mechanism={mechanism}
        inv={inv}
        gearRadii={gearRadii}
        gearCenters={gearCenters}
        planetaryConvention={planetaryConvention}
        gearOutputRatioForDisplay={gearOutputRatioForDisplay}
        gearCenterSource={gearCenterSource}
        gearCouplingMode={gearCouplingMode}
        gearCenterSummary={gearCenterSummary}
        gearAxleCenterSummary={gearAxleCenterSummary}
        gearCenterMaxError={gearCenterMaxError}
        gearEndpointMode={gearEndpointMode}
        gearUsesMeshPhases={gearUsesMeshPhases}
        gearMeshPhaseSummary={gearMeshPhaseSummary}
        gearPlaneMode={gearPlaneMode}
        activeGearPlaneZ={activeGearPlaneZ}
        gearBoardSpacerSummary={gearBoardSpacerSummary}
        gearAxleZOrderSummary={gearAxleZOrderSummary}
        gearLinkageSpacingContract={gearLinkageSpacingContract}
        gearLinkagePinZOrderSummary={gearLinkagePinZOrderSummary}
        spacerLayerCount={spacerLayerCount}
        spacerRenderCount={spacerRenderCount}
        spacerPinIdSummary={spacerPinIdSummary}
        boardPivotPinStacks={boardPivotPinStacks}
        boardPivotSpacerSummary={boardPivotSpacerSummary}
        assemblyPinPoints={assemblyPinPoints}
        assemblyPinContract={assemblyPinContract}
        pinStackLayerSummary={pinStackLayerSummary}
        pinSpanSummary={pinSpanSummary}
        zCollisionCount={zCollisionCount}
        camContactErrorForData={camContactErrorForData}
        simulationScale={simulation.scale}
        pinionRotation={pinionRotation}
        visiblePathTraces={visiblePathTraces}
        primaryPathId={primaryPathId}
        pathLayerZ={pathLayerZ}
        physicsRule={physicsRule}
        velocityMagnitude={velocityMagnitude}
        forceMagnitude={forceMagnitude}
        frictionCoefficient={frictionCoefficient}
        frictionMagnitude={frictionMagnitude}
        constraintError={constraintError}
        cameraLabel={cameraLabel}
        dynamicBuildCount={dynamicBuildCountRef.current}
        geometryCacheSize={geometryCacheRef.current.size}
        materialCacheSize={materialCacheRef.current.size}
        explode={explode}
        pinBottomZ={pinBottomZ}
        pinTopZ={pinTopZ}
        pinLengthZ={pinLengthZ}
        stackZGap={stackZGap}
        renderPlan={renderPlan}
        renderedLayerZ={renderedLayerZ}
        physicalValidationErrors={physicalValidationErrors}
        physicalValidationSummary={physicalValidationSummary}
        assemblySceneFrame={assemblySceneFrame}
        assemblyLayerFocusSummary={assemblyLayerFocusSummary}
      />
      {children}
    </div>
  );
};

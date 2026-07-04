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
  gearTrainPitchCenterDistance,
  gearTrainPitchRadii,
  gearTrainResolvedCenterDistance,
  gearTrainRotationRatioAt,
  normalizeCamProfileSamples,
  planetaryCarrierOutputRatio,
  planetaryPlanetSpinRatio,
  sampledCamProfileScale,
} from "../../../utils/kinematics";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_WIDTH_MM,
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_RENDER_PART_DEPTH,
  FABRICATION_SPACER_SPEC,
  fabricationGearProfileForPitchRadius,
  fabricationLinkageSpecForSceneLength,
  fabricationRingGearProfileForPitchRadius,
  fabricationRingInnerGearOutlinePoints,
  fabricationRenderPlanForMechanism,
  planetaryGearConventionForMechanism,
  planetaryGearRadii,
  planetaryRingPitchRadius,
  validateMechanismPreviewReadiness,
} from "../../../utils/fabrication";
import { SCENE_PX_PER_MM, SCENE_VIEW } from "../../../utils/coordinates";
import {
  HIGH_THROUGHPUT_SCENE_POLICY,
  PHYSICS_KERNEL_ENGINE,
  PHYSICS_RENDER_STACK,
  PHYSICS_UPDATE_POLICY,
  loadRapierPhysicsKernel,
  physicsKernelErrorMessage,
} from "../../../utils/physicsKernel";
import { WEBGL_PIXEL_RATIO_CAP } from "../../../utils/viewport";
import {
  VIEWER3D_CONTRACT_VERSION,
  createViewer3DContract,
  viewer3DLayerDataValue,
} from "../../../utils/viewer3d";
import {
  FOUNDRY_ANIMATION_COMMIT_MS,
  degToRad,
  foundryCameraDistance,
  foundryCameraPosition,
  foundryCameraTarget,
  type FoundryCamera,
  type FoundryOverlaySize,
} from "../../../utils/foundryCamera";
import { fitMechanismSimulation } from "../../../utils/mechanismPreview";
import { fittedGearTrainCenters } from "./foundryPreviewGeometry";
import { foundryRenderedInventory } from "./foundryRenderInventory";
import {
  foundryAssemblyPinContract,
  foundryAssemblyPinPoints,
  foundryLayerGeometryContract,
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
  simulation: ReturnType<typeof fitMechanismSimulation>;
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
  children: React.ReactNode;
};

const disposeThreeObject = (object: THREE.Object3D) =>
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.foundryCached)
      mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material))
      material.forEach((item) => {
        if (!item.userData.foundryCached) item.dispose();
      });
    else if (material && !material.userData.foundryCached) material.dispose();
  });

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
  const driveReferencePoint =
    mechanism.type === "cam" && simulation.state.aux
      ? simulation.state.aux
      : simulation.state.j1;
  const pinionRotation =
    (Math.atan2(
      driveReferencePoint.y - simulation.state.p1.y,
      driveReferencePoint.x - simulation.state.p1.x,
    ) *
      180) /
    Math.PI;
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
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, WEBGL_PIXEL_RATIO_CAP),
    );
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
      disposeThreeObject(scene);
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
      disposeThreeObject(old);
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
    const geometryCache = geometryCacheRef.current;
    const materialCache = materialCacheRef.current;
    const cachedGeometry = <T extends THREE.BufferGeometry>(
      key: string,
      create: () => T,
    ): T => {
      const existing = geometryCache.get(key) as T | undefined;
      if (existing) return existing;
      const geometry = create();
      geometry.userData.foundryCached = true;
      geometryCache.set(key, geometry);
      return geometry;
    };
    const cachedMaterial = <T extends THREE.Material>(
      key: string,
      create: () => T,
    ): T => {
      const existing = materialCache.get(key) as T | undefined;
      if (existing) return existing;
      const material = create();
      material.userData.foundryCached = true;
      materialCache.set(key, material);
      return material;
    };
    const materialForLayer = (
      colorValue: string,
      roughness = 0.66,
      metalness = 0.03,
    ) =>
      cachedMaterial(
        `standard:${colorValue}:${roughness.toFixed(2)}:${metalness.toFixed(2)}:${rigOpacity.toFixed(3)}`,
        () =>
          new THREE.MeshStandardMaterial({
            color: colorValue,
            roughness,
            metalness,
            transparent: rigOpacity < 0.995,
            opacity: rigOpacity,
          }),
      );
    const material = {
      base: materialForLayer(renderPlan.base.color, 0.82, 0.01),
      accent: materialForLayer("#60a5fa", 0.45, 0.08),
      hole: cachedMaterial(
        "standard:#ffffff:0.25:0.00:1",
        () =>
          new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.25 }),
      ),
      dark: materialForLayer("#334155", 0.62, 0.03),
      edge: cachedMaterial(
        "edge:#334155:0.72",
        () =>
          new THREE.LineBasicMaterial({
            color: "#334155",
            transparent: true,
            opacity: 0.72,
          }),
      ),
      path: cachedMaterial(
        `path:${color}`,
        () =>
          new THREE.LineDashedMaterial({
            color: new THREE.Color(color),
            dashSize: 0.25,
            gapSize: 0.16,
            linewidth: 2,
          }),
      ),
      trail: cachedMaterial(
        `trail:${color}`,
        () =>
          new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.18,
          }),
      ),
    };
    const to3 = (point: Point, z = 0) =>
      new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);
    const mmToThree = SCENE_PX_PER_MM / 18;
    const thickness = Math.max(0.2, kit.holeDiameterMm / 10);
    const spacerDepth = Math.max(0.08, FABRICATION_RENDER_MIN_CLEARANCE);
    const barW = Math.max(0.34, FABRICATION_LINKAGE_WIDTH_MM * mmToThree);
    const holeR = Math.max(0.08, FABRICATION_HOLE_RADIUS_MM * mmToThree);
    const spacerOuterR =
      (FABRICATION_SPACER_SPEC.outerDiameterMm * mmToThree) / 2;
    const spacerInnerR =
      (FABRICATION_SPACER_SPEC.innerDiameterMm * mmToThree) / 2;
    const addEdges = (mesh: THREE.Mesh, key = mesh.geometry.uuid) => {
      const edges = new THREE.LineSegments(
        cachedGeometry(
          `edges:${key}`,
          () => new THREE.EdgesGeometry(mesh.geometry),
        ),
        material.edge,
      );
      mesh.add(edges);
    };
    const circularHole = (x: number, y: number, r = holeR) => {
      const hole = new THREE.Path();
      hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
      return hole;
    };
    const roundedRectShape = (
      width: number,
      height: number,
      radius = height / 2,
    ) => {
      const r = Math.min(radius, width / 2, height / 2);
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2 + r, -height / 2);
      shape.lineTo(width / 2 - r, -height / 2);
      shape.quadraticCurveTo(
        width / 2,
        -height / 2,
        width / 2,
        -height / 2 + r,
      );
      shape.lineTo(width / 2, height / 2 - r);
      shape.quadraticCurveTo(width / 2, height / 2, width / 2 - r, height / 2);
      shape.lineTo(-width / 2 + r, height / 2);
      shape.quadraticCurveTo(
        -width / 2,
        height / 2,
        -width / 2,
        height / 2 - r,
      );
      shape.lineTo(-width / 2, -height / 2 + r);
      shape.quadraticCurveTo(
        -width / 2,
        -height / 2,
        -width / 2 + r,
        -height / 2,
      );
      return shape;
    };
    const addHoleRing = (
      group: THREE.Group,
      x: number,
      y: number,
      z: number,
    ) => {
      const ring = new THREE.Mesh(
        cachedGeometry(
          `hole-ring:${holeR.toFixed(3)}`,
          () => new THREE.TorusGeometry(holeR * 1.1, 0.025, 8, 24),
        ),
        material.accent,
      );
      ring.position.set(x, y, z + thickness / 2 + 0.025);
      group.add(ring);
    };
    const addSpacerWasher = (
      point: Point | undefined,
      z: number,
      mat: THREE.Material,
    ) => {
      if (!point) return;
      const p = to3(point, z);
      const geometryKey = `spacer:${spacerOuterR.toFixed(3)}:${spacerInnerR.toFixed(3)}:${spacerDepth.toFixed(3)}`;
      const washer = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = new THREE.Shape();
          shape.absellipse(
            0,
            0,
            spacerOuterR,
            spacerOuterR,
            0,
            Math.PI * 2,
            false,
          );
          shape.holes.push(circularHole(0, 0, spacerInnerR));
          return new THREE.ExtrudeGeometry(shape, {
            depth: spacerDepth,
            bevelEnabled: true,
            bevelSize: 0.012,
          });
        }),
        mat,
      );
      washer.position.set(p.x, p.y, z - spacerDepth / 2);
      washer.castShadow = true;
      addEdges(washer, geometryKey);
      root.add(washer);
    };
    const addClipCap = (
      point: Point | undefined,
      z: number,
      mat: THREE.Material,
      radiusScale = 1.35,
    ) => {
      if (!point) return;
      const p = to3(point, z);
      const clip = new THREE.Mesh(
        cachedGeometry(
          `clip:${holeR.toFixed(3)}:${radiusScale.toFixed(2)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * radiusScale,
              holeR * radiusScale,
              0.08,
              24,
            ),
        ),
        mat,
      );
      clip.rotation.x = Math.PI / 2;
      clip.position.copy(p);
      clip.position.z = z;
      root.add(clip);
    };
    const addBar = (
      a: Point | undefined,
      b: Point | undefined,
      z: number,
      mat: THREE.Material,
      holeCount = 2,
    ) => {
      if (!a || !b) return;
      const av = to3(a, z),
        bv = to3(b, z);
      const dx = bv.x - av.x,
        dy = bv.y - av.y,
        len = Math.hypot(dx, dy);
      if (len < 0.05) return;
      const sceneLength = Math.hypot(b.x - a.x, b.y - a.y);
      const linkageSpec = fabricationLinkageSpecForSceneLength(
        sceneLength,
        kit.gridPitchMm,
        holeCount,
      );
      const templateLen = linkageSpec.lengthMm * mmToThree;
      const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
      const holeXs = linkageSpec.holeCentersMm.map(
        (point) =>
          (point.x - firstHoleX - linkageSpec.lengthMm / 2) * mmToThree,
      );
      const outlineLen = templateLen + barW;
      const group = new THREE.Group();
      group.position.set((av.x + bv.x) / 2, (av.y + bv.y) / 2, z);
      group.rotation.z = Math.atan2(dy, dx);
      const geometryKey = `bar:${linkageSpec.key}:${kit.gridPitchMm}:${outlineLen.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = roundedRectShape(outlineLen, barW);
          shape.holes.push(...holeXs.map((x) => circularHole(x, 0)));
          return new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.018,
          });
        }),
        mat,
      );
      mesh.position.z = -thickness / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      addEdges(mesh, geometryKey);
      group.add(mesh);
      holeXs.forEach((x) => addHoleRing(group, x, 0, 0));
      root.add(group);
    };
    const shapeFromPoints = (points: Point[]) => {
      const shape = new THREE.Shape();
      points.forEach((point, index) => {
        if (index === 0) shape.moveTo(point.x, point.y);
        else shape.lineTo(point.x, point.y);
      });
      shape.closePath();
      return shape;
    };
    const addGear = (
      center: Point,
      radius: number,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.38, (radius * simulation.scale) / 18);
      const profile = fabricationGearProfileForPitchRadius(
        r,
        radius / SCENE_PX_PER_MM,
      );
      const shape = shapeFromPoints(profile.outlinePoints);
      const axleHoleRadius = Math.max(holeR * 0.7, profile.axleHoleRadius);
      shape.holes.push(circularHole(0, 0, axleHoleRadius));
      profile.attachmentHoleCenters.forEach((point) =>
        shape.holes.push(
          circularHole(
            point.x,
            point.y,
            Math.max(holeR * 0.55, profile.axleHoleRadius),
          ),
        ),
      );
      const geometryKey = `gear:${mechanism.type}:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const geom = cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = (rotation * Math.PI) / 180;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
      const holes = new THREE.Group();
      holes.position.set(c.x, c.y, z);
      holes.rotation.z = mesh.rotation.z;
      addHoleRing(holes, 0, 0, 0);
      profile.attachmentHoleCenters.forEach((point) =>
        addHoleRing(holes, point.x, point.y, 0),
      );
      root.add(holes);
    };
    const addRingGear = (
      center: Point,
      radius: number,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.82, (radius * simulation.scale) / 18);
      const profile = fabricationRingGearProfileForPitchRadius(r);
      const shape = new THREE.Shape();
      shape.absellipse(
        0,
        0,
        profile.outerRadius,
        profile.outerRadius,
        0,
        Math.PI * 2,
        false,
      );
      const inner = new THREE.Path();
      fabricationRingInnerGearOutlinePoints(r).forEach((point, index) => {
        if (index === 0) inner.moveTo(point.x, point.y);
        else inner.lineTo(point.x, point.y);
      });
      inner.closePath();
      shape.holes.push(inner);
      const mountHoleRadius = Math.max(holeR * 0.58, profile.mountHoleRadius);
      profile.mountHoleCenters.forEach((point) =>
        shape.holes.push(circularHole(point.x, point.y, mountHoleRadius)),
      );
      const geometryKey = `ring-gear:${radius.toFixed(3)}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const geom = cachedGeometry(
        geometryKey,
        () =>
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.025,
            bevelThickness: 0.02,
          }),
      );
      const mesh = new THREE.Mesh(geom, mat);
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = (rotation * Math.PI) / 180;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
      const holes = new THREE.Group();
      holes.position.set(c.x, c.y, z);
      profile.mountHoleCenters.forEach((point) =>
        addHoleRing(holes, point.x, point.y, 0),
      );
      root.add(holes);
    };
    const addCam = (
      center: Point,
      z: number,
      rotation: number,
      mat: THREE.Material,
    ) => {
      const r = Math.max(0.5, (mechanism.crankLength * simulation.scale) / 22);
      const shape = new THREE.Shape();
      for (let i = 0; i < 56; i++) {
        const a = (i / 56) * Math.PI * 2;
        const rr = r * sampledCamProfileScale(a, mechanism.camProfileSamples);
        const x = Math.cos(a) * rr,
          y = Math.sin(a) * rr;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      shape.holes.push(circularHole(0, 0, holeR * 1.35));
      const geometryKey = `cam:${mechanism.crankLength.toFixed(2)}:${(mechanism.camProfileSamples ?? []).join(",")}:${simulation.scale.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(
          geometryKey,
          () =>
            new THREE.ExtrudeGeometry(shape, {
              depth: thickness,
              bevelEnabled: true,
              bevelSize: 0.025,
            }),
        ),
        mat,
      );
      const c = to3(center, z);
      mesh.position.set(c.x, c.y, z - thickness / 2);
      mesh.rotation.z = rotation;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      root.add(mesh);
    };
    const addSlotPlate = (
      center: Point,
      length: number,
      rotation: number,
      z: number,
      mat: THREE.Material,
    ) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      group.rotation.z = rotation;
      const geometryKey = `slot:${length.toFixed(3)}:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const mesh = new THREE.Mesh(
        cachedGeometry(geometryKey, () => {
          const shape = roundedRectShape(length, barW * 1.35, barW * 0.28);
          shape.holes.push(
            roundedRectShape(length * 0.7, barW * 0.46, barW * 0.23),
          );
          return new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelSize: 0.02,
            bevelThickness: 0.015,
          });
        }),
        mat,
      );
      mesh.position.z = -thickness / 2;
      mesh.castShadow = true;
      addEdges(mesh, geometryKey);
      group.add(mesh);
      root.add(group);
    };
    const addFollowerBlock = (
      center: Point,
      z: number,
      mat: THREE.Material,
      rotation = 0,
    ) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      group.rotation.z = rotation;
      const blockKey = `follower-block:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const block = new THREE.Mesh(
        cachedGeometry(
          blockKey,
          () => new THREE.BoxGeometry(barW * 1.45, barW * 1.8, thickness),
        ),
        mat,
      );
      addEdges(block, blockKey);
      group.add(block);
      const roller = new THREE.Mesh(
        cachedGeometry(
          `follower-roller:${holeR.toFixed(3)}:${thickness.toFixed(3)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * 1.3,
              holeR * 1.3,
              thickness * 1.18,
              28,
            ),
        ),
        material.accent,
      );
      roller.position.set(0, -barW * 0.74, 0.04);
      roller.rotation.x = Math.PI / 2;
      group.add(roller);
      root.add(group);
    };
    const addEndStop = (center: Point, offset: number, z: number) => {
      const c = to3(center, z);
      const stopKey = `end-stop:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const stop = new THREE.Mesh(
        cachedGeometry(
          stopKey,
          () => new THREE.BoxGeometry(0.22, barW * 1.65, thickness * 1.25),
        ),
        material.dark,
      );
      stop.position.set(c.x + offset, c.y, z);
      addEdges(stop, stopKey);
      root.add(stop);
    };
    const addRack = (center: Point, z: number, mat: THREE.Material) => {
      const c = to3(center, z);
      const group = new THREE.Group();
      group.position.copy(c);
      const rackKey = `rack:${barW.toFixed(3)}:${thickness.toFixed(3)}`;
      const rack = new THREE.Mesh(
        cachedGeometry(
          rackKey,
          () => new THREE.BoxGeometry(4.6, barW, thickness),
        ),
        mat,
      );
      addEdges(rack, rackKey);
      group.add(rack);
      for (let i = 0; i < 10; i++) {
        const toothKey = `rack-tooth:${thickness.toFixed(3)}`;
        const tooth = new THREE.Mesh(
          cachedGeometry(
            toothKey,
            () => new THREE.BoxGeometry(0.22, 0.18, thickness),
          ),
          mat,
        );
        tooth.position.set(-2.1 + i * 0.46, -barW * 0.65, 0.06);
        tooth.rotation.z = Math.PI / 4;
        group.add(tooth);
      }
      root.add(group);
    };
    const addPath = (points: Point[], z: number, mat: THREE.Material) => {
      if (points.length < 2) return;
      const geom = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => to3(point, z)),
      );
      const line = new THREE.Line(geom, mat);
      if ("computeLineDistances" in line) line.computeLineDistances();
      root.add(line);
    };

    if (showTrail)
      visiblePathTraces.forEach((trace) =>
        addPath(trace.points, pathLayerZ - 0.05, material.trail),
      );
    if (showPathPreview)
      visiblePathTraces.forEach((trace) =>
        addPath(trace.points, pathLayerZ, material.path),
      );

    const s = simulation.state;
    const angle = pinionRotation;
    const camGuideFallback = {
      x: Math.cos(degToRad(mechanism.groundAngle ?? 90)),
      y: -Math.sin(degToRad(mechanism.groundAngle ?? 90)),
    };
    const camGuideVector =
      mechanism.type === "cam"
        ? (() => {
            const dx = s.j2.x - s.p1.x;
            const dy = s.j2.y - s.p1.y;
            const len = Math.hypot(dx, dy);
            return len > 0.001
              ? { x: dx / len, y: dy / len }
              : camGuideFallback;
          })()
        : camGuideFallback;
    const camGuideRotation = Math.atan2(camGuideVector.y, camGuideVector.x);
    const camFollowerRotation = camGuideRotation - Math.PI / 2;
    const camGuideCenter =
      mechanism.type === "cam"
        ? {
            x:
              s.p1.x +
              camGuideVector.x *
                (mechanism.crankLength +
                  mechanism.sliderOffset +
                  mechanism.rockerLength * 0.5) *
                simulation.scale,
            y:
              s.p1.y +
              camGuideVector.y *
                (mechanism.crankLength +
                  mechanism.sliderOffset +
                  mechanism.rockerLength * 0.5) *
                simulation.scale,
          }
        : s.j2;
    const usesMeshedPitchCenters = [
      "gear",
      "gear_linkage",
      "planetary_gear",
      "rack-pinion",
      "cam",
    ].includes(mechanism.type);
    if (!usesMeshedPitchCenters && mechanism.type !== "4bar")
      addBar(s.p1, s.p2, 0, material.base, 3);
    const clipLayer = renderPlan.layers.find(
      (layer) => layer.renderKind === "clip",
    );
    const clipMat = clipLayer
      ? materialForLayer(clipLayer.color, 0.66, 0.03)
      : material.dark;
    const renderLinkageLayer = (
      label: string,
      z: number,
      mat: THREE.Material,
    ) => {
      if (mechanism.type === "gear") return;
      if (
        mechanism.type === "gear_linkage" &&
        /drive.*L|Drive L|drive.*linkage/i.test(label)
      )
        addBar(s.j1, s.effector, z, mat, 4);
      else if (
        mechanism.type === "gear_linkage" &&
        /output.*L|Output L|output.*linkage|L4|linkage/i.test(label)
      )
        addBar(s.j2, s.effector, z, mat, 4);
      else if (mechanism.type === "6bar" && /output rocker/i.test(label))
        addBar(s.p2, s.j2, z, mat, 3);
      else if (mechanism.type === "6bar" && /dyad/i.test(label))
        addBar(s.j2, s.aux, z, mat, 2);
      else if (mechanism.type === "6bar" && /follower/i.test(label))
        addBar(s.p2, s.aux, z, mat, 2);
      else if (mechanism.type === "planetary_gear" && /carrier/i.test(label))
        addBar(s.p1, s.p2, z, mat, 3);
      else if (mechanism.type === "4bar" && /output|rocker/i.test(label))
        addBar(s.p2, s.j2, z, mat, 3);
      else if (/input|crank|left/i.test(label)) addBar(s.p1, s.j1, z, mat, 3);
      else if (/right/i.test(label)) addBar(s.p2, s.j2, z, mat, 3);
      else if (/coupler|center|carrier/i.test(label))
        addBar(s.j1, s.j2, z, mat, 4);
      else if (/output|follower/i.test(label))
        addBar(s.j2, s.effector, z, mat, 2);
      else addBar(s.j1, s.j2, z, mat, 3);
    };
    const renderGearLayer = (
      label: string,
      z: number,
      mat: THREE.Material,
      gearTrainIndex = 0,
    ) => {
      if (mechanism.type === "planetary_gear") {
        if (/ring/i.test(label))
          addRingGear(s.p1, planetaryRingPitchRadius(mechanism), z, 0, mat);
        else if (/planet|G3|3-space/i.test(label)) {
          const planetCenters = [s.p2];
          const planetCount = Math.max(1, planetCenters.length);
          planetCenters.forEach((center, index) =>
            addGear(
              center,
              mechanism.rockerLength,
              z,
              angle *
                planetaryPlanetSpinRatio(
                  mechanism.crankLength,
                  mechanism.rockerLength,
                ) +
                ((mechanism.phase ?? 0) * 180) / Math.PI +
                index * (360 / planetCount),
              mat,
            ),
          );
        } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
      } else if (isGearTrain) {
        const index = Math.max(
          0,
          Math.min(gearTrainIndex, Math.max(0, gearRadii.length - 1)),
        );
        const fallbackCenter = index === 0 ? s.p1 : s.p2;
        const fallbackRadius =
          index === 0 ? mechanism.crankLength : mechanism.rockerLength;
        const isLastGear = index === gearRadii.length - 1;
        const phaseDeg =
          (gearUsesMeshPhases ? gearTrainMeshPhaseDegAt(gearRadii, index) : 0) +
          (isLastGear ? ((mechanism.phase ?? 0) * 180) / Math.PI : 0);
        const ratio = gearUsesMeshPhases
          ? gearTrainRotationRatioAt(gearRadii, index)
          : mechanism.type === "gear_linkage"
            ? index === 0
              ? 1
              : isLastGear
                ? gearOutputRatioForDisplay
                : 0
            : 0;
        addGear(
          gearCenters[index] ?? fallbackCenter,
          gearRadii[index] ?? fallbackRadius,
          z,
          angle * ratio + phaseDeg,
          mat,
        );
      } else addGear(s.p1, mechanism.crankLength, z, angle, mat);
    };
    let gearTrainLayerIndex = 0;
    renderPlan.layers.forEach((layerItem, index) => {
      const z = renderedLayerZ[index] ?? layerItem.z;
      const mat = materialForLayer(
        layerItem.color,
        layerItem.role === "spacer" ? 0.55 : 0.66,
        layerItem.role === "spacer" ? 0.06 : 0.03,
      );
      if (layerItem.renderKind === "clip") return;
      else if (layerItem.renderKind === "spacer")
        pinStacks
          .filter((pin) => foundrySpacerTouchesPin(pin, index))
          .forEach((pin) =>
            addSpacerWasher(
              pin.point,
              localSpacerZForPin(pin, index) ?? z,
              mat,
            ),
          );
      else if (layerItem.renderKind === "linkage")
        renderLinkageLayer(layerItem.label, z, mat);
      else if (layerItem.renderKind === "gear") {
        renderGearLayer(layerItem.label, z, mat, gearTrainLayerIndex);
        if (isGearTrain) gearTrainLayerIndex += 1;
      } else if (layerItem.renderKind === "cam")
        addCam(s.p1, z, degToRad(angle), mat);
      else if (layerItem.renderKind === "guide") {
        const slotRotation =
          mechanism.type === "cam"
            ? camGuideRotation
            : /follower|slider|rack/i.test(layerItem.label)
              ? Math.PI / 2
              : Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x);
        const slotCenter =
          mechanism.type === "cam"
            ? camGuideCenter
            : /quick/i.test(layerItem.label)
              ? { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 }
              : s.j2;
        addSlotPlate(
          slotCenter,
          /rack/i.test(layerItem.label) ? 4.8 : 3.2,
          slotRotation,
          z,
          mat,
        );
      } else if (layerItem.renderKind === "rack") {
        addRack(s.j2, z, mat);
        addEndStop(s.j2, -2.55, z + 0.04);
        addEndStop(s.j2, 2.55, z + 0.04);
      } else if (layerItem.renderKind === "follower")
        addFollowerBlock(
          s.j2,
          z,
          mat,
          mechanism.type === "cam" ? camFollowerRotation : 0,
        );
    });
    pinStacks.forEach((pinStack) => {
      const boardPivotFastener =
        mechanism.type === "4bar" &&
        (pinStack.id === "A" || pinStack.id === "D");
      addClipCap(
        pinStack.point,
        pinStack.bottomZ,
        clipMat,
        boardPivotFastener ? 1.5 : 1.35,
      );
      addClipCap(
        pinStack.point,
        pinStack.topZ + (boardPivotFastener ? 0.035 : 0),
        clipMat,
        boardPivotFastener ? 1.75 : 1.35,
      );
      const p = to3(pinStack.point, pinStack.centerZ);
      const pin = new THREE.Mesh(
        cachedGeometry(
          `pin:${holeR.toFixed(3)}:${pinStack.lengthZ.toFixed(3)}`,
          () =>
            new THREE.CylinderGeometry(
              holeR * 0.8,
              holeR * 0.8,
              pinStack.lengthZ,
              20,
            ),
        ),
        material.dark,
      );
      pin.rotation.x = Math.PI / 2;
      pin.position.copy(p);
      root.add(pin);
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
      <div
        ref={stateRef}
        data-testid="foundry-camera-rig"
        data-viewer-contract={VIEWER3D_CONTRACT_VERSION}
        data-viewer-contract-state={JSON.stringify(viewerContract)}
        data-viewer-tab={viewerContract.tab}
        data-camera-preset={camera.preset}
        data-layer-grid={viewer3DLayerDataValue(showGrid)}
        data-layer-mechanisms={viewer3DLayerDataValue(true)}
        data-layer-character={viewer3DLayerDataValue(undefined)}
        data-layer-skeleton={viewer3DLayerDataValue(undefined)}
        data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
        data-layer-forces={viewer3DLayerDataValue(showForces)}
        data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
        data-layer-trail={viewer3DLayerDataValue(showTrail)}
        data-camera-yaw={camera.yaw.toFixed(1)}
        data-camera-pitch={camera.pitch.toFixed(1)}
        data-camera-zoom={camera.zoom.toFixed(3)}
        data-camera-pan-x={(camera.pan?.x ?? 0).toFixed(3)}
        data-camera-pan-y={(camera.pan?.y ?? 0).toFixed(3)}
        data-camera-distance={foundryCameraDistance(camera).toFixed(3)}
        data-rig-opacity={rigOpacity.toFixed(2)}
        data-three-renderer="webgl"
        data-three-engine-stack={PHYSICS_RENDER_STACK}
        data-physics-kernel={PHYSICS_KERNEL_ENGINE}
        data-physics-update-policy={PHYSICS_UPDATE_POLICY}
        data-high-throughput-scene-policy={HIGH_THROUGHPUT_SCENE_POLICY}
        data-physics-contact-mode="kinematic-estimate-rapier-contact-probe"
        data-physics-kernel-runtime={physicsKernelRuntime}
        data-physics-kernel-version={physicsKernelVersion}
        data-physics-kernel-error={physicsKernelError}
        data-physics-authority="motionsmith-kinematics"
        data-mechanism-type={mechanism.type}
        data-three-part-count={inv.parts}
        data-three-hole-count={inv.holes}
        data-three-slot-count={inv.slots}
        data-three-gear-count={inv.gears}
        data-three-rack-count={inv.racks}
        data-three-cam-count={inv.cams}
        data-three-follower-count={inv.followers}
        data-three-end-stop-count={inv.endStops}
        data-three-gear-radii={gearRadii
          .map((radius) => radius.toFixed(2))
          .join(",")}
        data-cam-profile={
          mechanism.type === "cam"
            ? normalizeCamProfileSamples(mechanism.camProfileSamples)
                .map((value) => value.toFixed(2))
                .join(",")
            : ""
        }
        data-three-gear-pitch-center={(isGearTrain
          ? gearTrainResolvedCenterDistance(mechanism)
          : mechanism.type === "planetary_gear"
            ? planetaryGearConventionForMechanism(mechanism).carrierPitchRadius
            : mechanism.groundLength
        ).toFixed(2)}
        data-three-gear-pitch-sum={(isGearTrain
          ? gearTrainPitchCenterDistance(mechanism)
          : mechanism.type === "planetary_gear"
            ? planetaryGearConventionForMechanism(mechanism).ringPitchRadius
            : mechanism.crankLength + mechanism.rockerLength
        ).toFixed(2)}
        data-three-gear-output-ratio={gearOutputRatioForDisplay.toFixed(3)}
        data-three-planet-count={planetaryConvention?.planetCount ?? 0}
        data-three-planetary-syntax={planetaryConvention?.syntax ?? ""}
        data-three-planetary-fixed={planetaryConvention?.fixedMember ?? ""}
        data-three-planetary-input={planetaryConvention?.inputMember ?? ""}
        data-three-planetary-output={planetaryConvention?.outputMember ?? ""}
        data-three-planetary-ring-radius={
          planetaryConvention?.ringPitchRadius.toFixed(2) ?? ""
        }
        data-three-planetary-carrier-radius={
          planetaryConvention?.carrierPitchRadius.toFixed(2) ?? ""
        }
        data-three-planetary-center-source={
          isPlanetaryGear ? "simulation-state-carrier-center" : "not-planetary"
        }
        data-three-gear-train-linkage-mode={
          mechanism.type === "gear"
            ? "gear-only-train"
            : mechanism.type === "gear_linkage"
              ? "two-gear-two-link-coupler"
              : "template-specific"
        }
        data-three-gear-linkage-mode={
          mechanism.type === "gear_linkage"
            ? "two-gear-two-link-coupler"
            : "none"
        }
        data-three-gear-center-source={gearCenterSource}
        data-three-gear-coupling-mode={gearCouplingMode}
        data-three-gear-center-count={gearCenters.length}
        data-three-gear-centers={gearCenterSummary}
        data-three-gear-axle-centers={gearAxleCenterSummary}
        data-three-gear-axle-center-contract={
          isGearTrain
            ? "pin-stacks-use-rendered-gear-centers"
            : "not-gear-train"
        }
        data-three-gear-center-max-error={gearCenterMaxError.toFixed(3)}
        data-three-gear-train-endpoint-mode={gearEndpointMode}
        data-three-gear-mesh-phase-contract={
          isGearTrain
            ? gearUsesMeshPhases
              ? "alternating-three-quarter-tooth-gap-phase"
              : "dual-driven-endpoints-no-mesh-phase"
            : "not-gear-train"
        }
        data-three-gear-mesh-phases={gearMeshPhaseSummary}
        data-three-gear-plane-mode={gearPlaneMode}
        data-three-gear-plane-z={
          typeof activeGearPlaneZ === "number"
            ? activeGearPlaneZ.toFixed(2)
            : ""
        }
        data-three-gear-axle-stack-contract={
          isGearTrain
            ? "board-side>S10-spacer>gear>fastener-head"
            : isPlanetaryGear
              ? "sun/carrier and planet/carrier pins use local S10 spacers"
              : "not-gear-train"
        }
        data-three-gear-board-side-spacer-z={gearBoardSpacerSummary}
        data-three-gear-axle-z-order={gearAxleZOrderSummary}
        data-three-gear-linkage-spacing-contract={gearLinkageSpacingContract}
        data-three-gear-linkage-crank-stack-contract={
          mechanism.type === "gear_linkage"
            ? "B-gear-hole>S10>drive-link;C-gear-hole>S10>S10>output-link;R-drive-link>S10>output-link"
            : "not-gear-linkage"
        }
        data-three-gear-linkage-bracket-anchor={
          mechanism.type === "gear_linkage"
            ? "no-output-bracket"
            : "not-gear-linkage"
        }
        data-three-gear-linkage-pin-z-order={gearLinkagePinZOrderSummary}
        data-three-linkage-pin-radius={
          mechanism.type === "gear_linkage"
            ? mechanism.couplerPointDist.toFixed(2)
            : ""
        }
        data-three-spacer-key={FABRICATION_SPACER_SPEC.key}
        data-three-spacer-label={FABRICATION_SPACER_SPEC.label}
        data-three-spacer-mm={`${FABRICATION_SPACER_SPEC.outerDiameterMm}x${FABRICATION_SPACER_SPEC.innerDiameterMm}`}
        data-three-spacer-layers={spacerLayerCount}
        data-three-spacer-render-count={spacerRenderCount}
        data-three-spacer-render-contract="recipe-pin-spacer-sites"
        data-three-spacer-pin-ids={spacerPinIdSummary}
        data-three-board-pivot-spacer-mode={
          mechanism.type === "4bar"
            ? "single-board-side-spacer"
            : "not-board-pivot"
        }
        data-three-board-pivot-spacer-ids={boardPivotPinStacks
          .map((pin) => pin.id)
          .join(",")}
        data-three-board-pivot-spacer-z={boardPivotSpacerSummary}
        data-three-fourbar-ground-link-plane={
          mechanism.type === "4bar" ? "fabrication-stack-separated" : "not-4bar"
        }
        data-three-board-pivot-fastener-contract={
          mechanism.type === "4bar"
            ? "fastener-end>S10-board-side>linkage>fastener-head"
            : "template-specific"
        }
        data-three-physical-pin-count={assemblyPinPoints.length}
        data-three-physical-pin-contract={assemblyPinContract}
        data-three-pin-stack-policy="per-pin-adjacent-stack"
        data-three-pin-stack-z-sources={
          mechanism.type === "4bar"
            ? "fourbar-board-pivots-include-board-side-spacer"
            : isGearTrain
              ? "gear-axles-include-board-side-spacer"
              : isPlanetaryGear
                ? "planetary-carrier-pins-include-local-spacers"
                : "moving-layers-only"
        }
        data-three-pin-stack-layer-indexes={pinStackLayerSummary}
        data-three-pin-stack-spans={pinSpanSummary}
        data-three-pin-stack-clearance-contract="local-spacers-fill-adjacent-z-gaps"
        data-three-z-collision-count={zCollisionCount}
        data-three-ground-span-mode={
          mechanism.type === "4bar" ? "board-reference" : "rendered-reference"
        }
        data-three-cam-guide-mode={
          mechanism.type === "cam" ? "fixed-board-guide" : "not-cam"
        }
        data-three-cam-contact-mode={
          mechanism.type === "cam" ? "sampled-profile-on-guide-axis" : "not-cam"
        }
        data-three-cam-contact-error={
          mechanism.type === "cam" ? camContactErrorForData.toFixed(3) : ""
        }
        data-three-cam-follower-offset={
          mechanism.type === "cam"
            ? (Math.max(0, mechanism.sliderOffset) * simulation.scale).toFixed(
                3,
              )
            : ""
        }
        data-three-cam-pin-contract={
          mechanism.type === "cam"
            ? "cam-axle-and-follower-center-only"
            : "not-cam"
        }
        data-three-cam-rotation-deg={
          mechanism.type === "cam" ? pinionRotation.toFixed(2) : ""
        }
        data-three-ring-mount-mode={
          mechanism.type === "planetary_gear"
            ? "fixed-ring-holes"
            : "not-planetary"
        }
        data-three-path-source="moving-joints"
        data-three-path-trace-count={visiblePathTraces.length}
        data-three-path-trace-ids={visiblePathTraces
          .map((trace) => trace.id)
          .join(",")}
        data-three-primary-path-id={primaryPathId}
        data-three-path-z={pathLayerZ.toFixed(2)}
        data-path-preview={showPathPreview ? "shown" : "hidden"}
        data-trail={showTrail ? "shown" : "hidden"}
        data-forces={showForces ? "shown" : "hidden"}
        data-velocity={showVelocity ? "shown" : "hidden"}
        data-pinion-rotation-deg={pinionRotation.toFixed(2)}
        data-physics-rule={physicsRule}
        data-velocity-magnitude={velocityMagnitude.toFixed(3)}
        data-force-magnitude={forceMagnitude.toFixed(3)}
        data-friction-coefficient={frictionCoefficient.toFixed(3)}
        data-friction-magnitude={frictionMagnitude.toFixed(3)}
        data-constraint-error={constraintError.toFixed(3)}
        data-camera-label={cameraLabel}
        data-anchor-pick-mode="three-raycaster-plane"
        data-three-hole-mode="extruded-cut-through"
        data-three-render-loop="camera-only-orbit"
        data-three-pixel-ratio-cap={WEBGL_PIXEL_RATIO_CAP.toFixed(1)}
        data-three-animation-commit-ms={FOUNDRY_ANIMATION_COMMIT_MS.toFixed(1)}
        data-three-dynamic-build-count={dynamicBuildCountRef.current}
        data-three-geometry-cache-size={geometryCacheRef.current.size}
        data-three-material-cache-size={materialCacheRef.current.size}
        data-three-static-grid-mode="persistent-scene-layer"
        data-three-fit-bounds="phase-invariant-sweep"
        data-three-inventory-source="rendered-template"
        data-three-stack-source="fabricationStackForMechanism"
        data-three-stack-mode="assembled-spacer-separated"
        data-three-exploded={explode > 0 ? "true" : "false"}
        data-three-explode-percent={Math.round(explode * 100)}
        data-three-pin-z-min={pinBottomZ.toFixed(2)}
        data-three-pin-z-max={pinTopZ.toFixed(2)}
        data-three-pin-length={pinLengthZ.toFixed(2)}
        data-three-spacer-z-gap={stackZGap.toFixed(2)}
        data-three-base-layer={renderPlan.base.label}
        data-three-stack-order={renderPlan.stackSummary}
        data-three-stack-occurrences={renderPlan.occurrenceSummary}
        data-three-stack-roles={renderPlan.roleSummary}
        data-three-stack-colors={renderPlan.colorSummary}
        data-three-stack-z={renderPlan.zSummary}
        data-three-stack-layer-count={renderPlan.layers.length}
        data-three-rendered-layer-labels={renderPlan.layers
          .map((item) => item.label)
          .join(" → ")}
        data-three-rendered-layer-roles={renderPlan.layers
          .map((item) => item.renderKind)
          .join(">")}
        data-three-rendered-layer-colors={renderPlan.layers
          .map((item) => item.color)
          .join(",")}
        data-three-rendered-layer-z={renderedLayerZ
          .map((z) => z.toFixed(2))
          .join(",")}
        data-three-geometry-contract={renderPlan.layers
          .map((item) =>
            foundryLayerGeometryContract(
              mechanism.type,
              item.label,
              item.renderKind,
            ),
          )
          .join(" → ")}
        data-three-stack-validation-errors={renderPlan.validationErrors.length}
        data-three-physical-validation-errors={physicalValidationErrors.length}
        data-three-physical-validation-summary={physicalValidationSummary}
        data-three-preview-renderable={
          renderPlan.validationErrors.length || physicalValidationErrors.length
            ? "blocked"
            : "ready"
        }
        className="foundry-three-scene-state"
      />
      {children}
    </div>
  );
};

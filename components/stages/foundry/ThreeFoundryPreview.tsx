import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  BodyPartLayer,
  MechanismConfig,
  PhysicalKitSettings,
  Point,
  ProjectMotionPath,
  ProjectState,
  SceneObject,
  StandardSkeleton,
} from "../../../types";
import {
  camFollowerConstraintError,
  gearPairOutputRatio,
  gearTrainMeshPhaseDegAt,
  gearTrainOutputRatio,
  gearTrainPitchRadii,
  planetaryCarrierOutputRatio,
} from "../../../utils/kinematics";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_Z_EPSILON_MM,
  planetaryGearConventionForMechanism,
  planetaryGearRadii,
  validateMechanismPreviewReadiness,
} from "../../../utils/fabrication";
import type { MechanismSceneContract } from "../../../utils/mechanismSceneContract";
import { mechanismInventoryForMechanism } from "../../../utils/mechanismInventory";
import { SCENE_PX_PER_MM, SCENE_VIEW } from "../../../utils/coordinates";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
  pointInsideOutline,
} from "../../../utils/partGeometry";
import {
  loadRapierPhysicsKernel,
  physicsKernelErrorMessage,
} from "../../../utils/physicsKernel";
import {
  VIEWER3D_CONTRACT_VERSION,
  createViewer3DContract,
  viewer3DLayerDataValue,
  type Viewer3DTabKey,
} from "../../../utils/viewer3d";
import {
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
  FOUNDRY_CACHE_MARKER,
  createFoundryThreePrimitiveFactory,
  disposeFoundryThreeObject,
} from "./foundryThreePrimitives";
import { renderFoundryDynamicLayers } from "./foundryThreeRenderLayers";
import {
  foundryAssemblyPinContract,
  foundryLocalSpacerZForPin,
  foundryPinStackPoints,
  foundryPinStacks,
  foundryRenderedLayerZForMechanism,
  foundrySpacerTouchesPin,
  type FoundryPinStackPoint,
} from "../../../utils/mechanismPreviewStacks";

type ThreeFoundryPreviewProps = {
  mechanism: MechanismConfig;
  mechanismContract: MechanismSceneContract;
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
  onAutomataPartSelect?: (partId: string) => void;
  onAutomataSceneObjectSelect?: (objectId: string) => void;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  connectionSelectionCoordinates?: Record<string, Point>;
  connectionExportSignature?: string;
  selectedConnection?: { role: string; kind: string; holeIndex: number };
  viewerTab?: Viewer3DTabKey;
  automataContext?: FoundryAutomataContext;
  children: React.ReactNode;
};

type FoundryAutomataContext = {
  project: ProjectState;
  animatedParts?: Record<string, BodyPartLayer>;
  animatedSceneObjects?: Record<string, SceneObject>;
  skeleton?: StandardSkeleton | null;
  paths?: ProjectMotionPath[];
  selectedPathId?: string;
  showCharacter?: boolean;
  showSkeleton?: boolean;
};

const FOUNDRY_PREVIEW_WIDTH = 360;
const FOUNDRY_PREVIEW_HEIGHT = 240;
const SCENE_TO_FOUNDRY_SCALE = Math.min(
  FOUNDRY_PREVIEW_WIDTH / SCENE_VIEW.width,
  FOUNDRY_PREVIEW_HEIGHT / SCENE_VIEW.height,
);

const foundryTo3 = (point: Point, z = 0) =>
  new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);

const sceneToFoundryPreview = (point: Point): Point => ({
  x: FOUNDRY_PREVIEW_WIDTH / 2 + point.x * SCENE_TO_FOUNDRY_SCALE,
  y: FOUNDRY_PREVIEW_HEIGHT / 2 - point.y * SCENE_TO_FOUNDRY_SCALE,
});

const sceneTo3 = (point: Point, z = 0) =>
  foundryTo3(sceneToFoundryPreview(point), z);

const sceneLocalToFoundryLocal = (point: Point): Point => ({
  x: point.x * SCENE_TO_FOUNDRY_SCALE,
  y: -point.y * SCENE_TO_FOUNDRY_SCALE,
});

const sceneLocalFromFoundryGeometry = (x: number, y: number): Point => ({
  x: (x * 18) / SCENE_TO_FOUNDRY_SCALE,
  y: (y * 18) / SCENE_TO_FOUNDRY_SCALE,
});

const AUTOMATA_PART_ART_SURFACE_Z = 0.09;
const AUTOMATA_STACKED_BASE_LIFT_Z = 0.16;
const AUTOMATA_DESIGN_SURFACE_CLEARANCE_Z = 0.03;

const foundryLocalHole = (x: number, y: number, r: number) => {
  const hole = new THREE.Path();
  hole.absellipse(x, y, r, r, 0, Math.PI * 2, true);
  return hole;
};

const foundryLocalShape = (points: Point[]) => {
  const shape = new THREE.Shape(
    points.map((point) => new THREE.Vector2(point.x / 18, -point.y / 18)),
  );
  shape.closePath();
  return shape;
};

const foundrySceneLocalShape = (points: Point[]) =>
  foundryLocalShape(points.map(sceneLocalToFoundryLocal));

const foundrySceneLocalHole = (point: Point, radius: number) =>
  foundryLocalHole(
    (point.x * SCENE_TO_FOUNDRY_SCALE) / 18,
    (point.y * SCENE_TO_FOUNDRY_SCALE) / 18,
    (radius * SCENE_TO_FOUNDRY_SCALE) / 18,
  );

const foundrySceneObjectShape = (object: SceneObject) => {
  const points = object.contourPoints && object.contourPoints.length >= 3
    ? object.contourPoints
    : [
        { x: -object.bounds.width / 2, y: -object.bounds.height / 2 },
        { x: object.bounds.width / 2, y: -object.bounds.height / 2 },
        { x: object.bounds.width / 2, y: object.bounds.height / 2 },
        { x: -object.bounds.width / 2, y: object.bounds.height / 2 },
      ];
  return foundrySceneLocalShape(points);
};

type FoundryScreenTarget = {
  kind: "object" | "part";
  id: string;
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  visible: boolean;
};

type FoundryScreenTargets = {
  objectTargets: FoundryScreenTarget[];
  partTargets: FoundryScreenTarget[];
  mechanismTargets?: FoundryScreenTarget[];
};

const roundedFoundryScreenTargets = (targets: FoundryScreenTarget[]) =>
  targets.map((target) => ({
    kind: target.kind,
    id: target.id,
    x: Number(target.x.toFixed(1)),
    y: Number(target.y.toFixed(1)),
    left: Number(target.left.toFixed(1)),
    top: Number(target.top.toFixed(1)),
    right: Number(target.right.toFixed(1)),
    bottom: Number(target.bottom.toFixed(1)),
    radius: Number(target.radius.toFixed(1)),
    visible: target.visible,
  }));

const createFoundryFallbackScreenTarget = (
  kind: FoundryScreenTarget["kind"],
  id: string,
  point: Point,
  automataBaseZ: number,
  renderer: THREE.WebGLRenderer | null,
  cam: THREE.PerspectiveCamera | null,
): FoundryScreenTarget | null => {
  if (!renderer || !cam) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const projected = sceneTo3(point, automataBaseZ).project(cam);
  const x = rect.left + ((projected.x + 1) / 2) * rect.width;
  const y = rect.top + ((1 - projected.y) / 2) * rect.height;
  const radius = 24;
  return {
    kind,
    id,
    x,
    y,
    left: x - radius,
    top: y - radius,
    right: x + radius,
    bottom: y + radius,
    radius,
    visible: rect.width > 0 && rect.height > 0,
  };
};

const createFoundryFallbackSceneObjectTargets = (
  visibleObjectIds: string[],
  visiblePartIds: string[],
  automataContext: FoundryAutomataContext | undefined,
  automataBaseZ: number,
  renderer: THREE.WebGLRenderer | null,
  cam: THREE.PerspectiveCamera | null,
) => {
  const fallbackObjectTargets = visibleObjectIds
    .map((id) =>
      createFoundryFallbackScreenTarget(
        "object",
        id,
        (automataContext?.animatedSceneObjects?.[id] ??
          automataContext?.project.sceneObjects[id])?.transform ?? { x: 0, y: 0 },
        automataBaseZ,
        renderer,
        cam,
      ),
    )
    .filter((target): target is FoundryScreenTarget => Boolean(target));
  const fallbackPartTargets = visiblePartIds
    .map((id) =>
      createFoundryFallbackScreenTarget(
        "part",
        id,
        (automataContext?.animatedParts?.[id] ??
          automataContext?.project.parts[id])?.transform ?? { x: 0, y: 0 },
        automataBaseZ,
        renderer,
        cam,
      ),
    )
    .filter((target): target is FoundryScreenTarget => Boolean(target));
  return {
    objectTargets: roundedFoundryScreenTargets(fallbackObjectTargets),
    partTargets: roundedFoundryScreenTargets(fallbackPartTargets),
  };
};

const visibleAutomataSceneIds = (automataContext?: FoundryAutomataContext) => {
  if (!automataContext?.showCharacter) {
    return {
      partIds: [] as string[],
      objectIds: [] as string[],
      partArtIds: [] as string[],
    };
  }
  const partIds = automataContext.project.partOrder.filter((id) =>
    (automataContext.animatedParts?.[id] ??
      automataContext.project.parts[id])?.visible,
  );
  const objectIds = automataContext.project.sceneObjectOrder.filter((id) =>
    (automataContext.animatedSceneObjects?.[id] ??
      automataContext.project.sceneObjects[id])?.visible,
  );
  const partArtIds = partIds.filter(
    (id) => Boolean(automataContext.project.parts[id]?.textureUrl),
  );
  return { partIds, objectIds, partArtIds };
};

const foundryAutomataMaterial = (
  color: string,
  opacity: number,
  materialCache: Map<string, THREE.Material>,
) => {
  const key = `automata:${color}:${opacity.toFixed(2)}`;
  const existing = materialCache.get(key);
  if (existing) return existing;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.64,
    metalness: 0.02,
    transparent: opacity < 0.995,
    opacity,
  });
  material.userData[FOUNDRY_CACHE_MARKER] = true;
  materialCache.set(key, material);
  return material;
};

const foundryAutomataTextureMaterial = (
  textureUrl: string | undefined,
  opacity: number,
  onLoaded: () => void,
  materialCache: Map<string, THREE.Material>,
) => {
  const key = `automata-texture:${textureUrl ?? "none"}:${opacity.toFixed(2)}`;
  const existing = materialCache.get(key);
  if (existing) return existing as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({
    color: textureUrl ? "#ffffff" : "#f8fafc",
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  if (textureUrl) {
    const texture = new THREE.TextureLoader().load(textureUrl, onLoaded);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    material.needsUpdate = true;
  }
  material.userData[FOUNDRY_CACHE_MARKER] = true;
  materialCache.set(key, material);
  return material;
};

const placeFoundryLocalGroup = (
  group: THREE.Group,
  transform: { x: number; y: number; rotation: number; scale: number },
  z: number,
) => {
  const p = foundryTo3(transform, z);
  group.position.copy(p);
  group.rotation.z = (-transform.rotation * Math.PI) / 180;
  group.scale.set(transform.scale, transform.scale, 1);
};

const placeSceneLocalGroup = (
  group: THREE.Group,
  transform: { x: number; y: number; rotation: number; scale: number },
  z: number,
) => {
  const p = sceneTo3(transform, z);
  group.position.copy(p);
  group.rotation.z = (transform.rotation * Math.PI) / 180;
  group.scale.set(transform.scale, transform.scale, 1);
};

const renderFoundryAutomataContext = ({
  root,
  context,
  assemblySceneFrame,
  materialCache,
  onLoaded,
  baseZ,
}: {
  root: THREE.Group;
  context?: FoundryAutomataContext;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  materialCache: Map<string, THREE.Material>;
  onLoaded: () => void;
  baseZ: number;
}) => {
  if (!context?.showCharacter) return;
  const project = context.project;
  const skeleton = context.skeleton ?? project.skeleton;
  const animatedParts = context.animatedParts ?? {};
  const animatedSceneObjects = context.animatedSceneObjects ?? {};
  const parts = project.partOrder
    .map((id) => animatedParts[id] ?? project.parts[id])
    .filter((part): part is BodyPartLayer => Boolean(part?.visible));
  const sceneObjects = project.sceneObjectOrder
    .map((id) => animatedSceneObjects[id] ?? project.sceneObjects[id])
    .filter((object): object is SceneObject => Boolean(object?.visible));
  const edge = foundryAutomataMaterial("#334155", 0.58, materialCache);
  const selected = foundryAutomataMaterial("#a78bfa", 0.56, materialCache);
  const activeAssemblyPartIds = new Set(
    assemblySceneFrame?.kind === "character"
      ? assemblySceneFrame.activePartIds
      : [],
  );
  const assemblyLift =
    assemblySceneFrame?.kind === "character" && assemblySceneFrame.explodeAxis === "z"
      ? 0.3 + assemblySceneFrame.progress * 0.8
      : 0;
  const holeRadius = Math.max(
    1,
    FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM,
  );
  const automataRoot = new THREE.Group();
  automataRoot.name = "foundry-automata-context";
  root.add(automataRoot);

  parts.forEach((part) => {
    const base = project.parts[part.id] ?? part;
    const landmarks = partLandmarkLocalPoints(base, skeleton);
    const outline = fabricablePartOutlinePoints(base, landmarks);
    if (outline.length < 3) return;
    const shape = foundrySceneLocalShape(outline);
    landmarks
      .filter((local) => pointInsideOutline(local, outline, 0.5))
      .forEach((local) =>
        shape.holes.push(foundrySceneLocalHole(local, holeRadius)),
      );
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.012,
    });
    const material =
      part.id === project.selectedPartId
        ? selected
        : foundryAutomataMaterial(
            base.fillColor,
            activeAssemblyPartIds.size && !activeAssemblyPartIds.has(part.id)
              ? 0.24
              : Math.min(0.72, base.opacity),
            materialCache,
          );
    const group = new THREE.Group();
    group.name = `foundry-automata-part-${part.id}`;
    group.userData.partId = part.id;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.08;
    mesh.userData.partId = part.id;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edge));
    group.add(mesh);
    if (base.textureUrl) {
      const artGeometry = new THREE.ShapeGeometry(shape);
      const positions = artGeometry.getAttribute("position");
      const uvs: number[] = [];
      const width = Math.max(1, base.bounds.width);
      const height = Math.max(1, base.bounds.height);
      for (let i = 0; i < positions.count; i += 1) {
        const local = sceneLocalFromFoundryGeometry(positions.getX(i), positions.getY(i));
        uvs.push((local.x - base.bounds.x) / width, (local.y - base.bounds.y) / height);
      }
      artGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      const art = new THREE.Mesh(
        artGeometry,
        foundryAutomataTextureMaterial(
          base.textureUrl,
          Math.min(0.82, base.opacity),
          onLoaded,
          materialCache,
        ),
      );
      art.name = `foundry-automata-art-${part.id}`;
      art.position.z = 0.09;
      art.userData.partId = part.id;
      group.add(art);
    }
    placeSceneLocalGroup(
      group,
      part.transform,
      baseZ +
        part.zIndex * 0.045 +
        (activeAssemblyPartIds.has(part.id) ? assemblyLift : 0),
    );
    automataRoot.add(group);
  });

  sceneObjects.forEach((object) => {
    const shape = foundrySceneObjectShape(object);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelSize: 0.014,
      bevelThickness: 0.01,
    });
    const group = new THREE.Group();
    group.name = `foundry-automata-object-${object.id}`;
    group.userData.sceneObjectId = object.id;
    const material =
      object.id === project.selectedSceneObjectId
        ? selected
        : foundryAutomataMaterial(object.fillColor, Math.min(0.76, object.opacity), materialCache);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.07;
    mesh.userData.sceneObjectId = object.id;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edge));
    group.add(mesh);
    if (object.textureUrl) {
      const artGeometry = new THREE.ShapeGeometry(shape);
      const positions = artGeometry.getAttribute("position");
      const uvs: number[] = [];
      const width = Math.max(1, object.bounds.width);
      const height = Math.max(1, object.bounds.height);
      for (let i = 0; i < positions.count; i += 1) {
        const local = sceneLocalFromFoundryGeometry(positions.getX(i), positions.getY(i));
        uvs.push(local.x / width + 0.5, 0.5 - local.y / height);
      }
      artGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      const art = new THREE.Mesh(
        artGeometry,
        foundryAutomataTextureMaterial(
          object.textureUrl,
          Math.min(0.86, object.opacity),
          onLoaded,
          materialCache,
        ),
      );
      art.position.z = 0.08;
      art.userData.sceneObjectId = object.id;
      group.add(art);
    }
    placeSceneLocalGroup(group, object.transform, baseZ + 0.12 + object.zIndex * 0.045);
    automataRoot.add(group);
  });

  (context.paths ?? [])
    .filter((path) => path.visible !== false && path.enabled !== false && path.points.length > 1)
    .forEach((path) => {
      const material = foundryAutomataMaterial(
        path.id === context.selectedPathId ? "#7c3aed" : "#8b5cf6",
        path.id === context.selectedPathId ? 0.94 : 0.62,
        materialCache,
      );
      const points = path.points.map((point) => sceneTo3(point, baseZ + 0.36));
      const linePoints = path.closed && points.length > 2 ? [...points, points[0].clone()] : points;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(linePoints),
        material,
      );
      line.name = `foundry-automata-path-${path.id}`;
      automataRoot.add(line);
    });
};

export const ThreeFoundryPreview = ({
  mechanism,
  mechanismContract,
  simulation,
  kit,
  camera,
  rigOpacity,
  color,
  pathPoints,
  pathTraces,
  showGrid,
  showPathPreview: requestedShowPathPreview,
  showTrail: requestedShowTrail,
  showForces: requestedShowForces,
  showVelocity: requestedShowVelocity,
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
  onAutomataPartSelect,
  onAutomataSceneObjectSelect,
  assemblySceneFrame,
  connectionSelectionCoordinates = {},
  connectionExportSignature = "",
  selectedConnection,
  viewerTab = "foundry",
  automataContext,
  children,
}: ThreeFoundryPreviewProps) => {
  const boundRuntime = mechanismContract.projectDriveEnabled === true;
  const showPathPreview = boundRuntime && requestedShowPathPreview;
  const showTrail = boundRuntime && requestedShowTrail;
  const showForces = boundRuntime && requestedShowForces;
  const showVelocity = boundRuntime && requestedShowVelocity;
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
  const inv = mechanismInventoryForMechanism(mechanism, kit);
  const pinionRotation = simulation.driveAngleDeg;
  const renderPlan = mechanismContract.renderPlan;
  const physicalValidationErrors = useMemo(
    () => validateMechanismPreviewReadiness(mechanism, kit),
    [kit, mechanism],
  );
  const physicalValidationSummary = physicalValidationErrors.join(" | ");
  const stackLayerZ = useMemo(
    () =>
      renderPlan.layers.map(
        (item, presentationIndex) =>
          item.z +
          explode * presentationIndex * FABRICATION_RENDER_LAYER_Z_STEP * 1.5,
      ),
    [explode, renderPlan],
  );
  const gearPlaneLayerIndexes = useMemo(
    () =>
      renderPlan.layers.flatMap((item, index) =>
        item.gearPlaneId ? [index] : [],
      ),
    [renderPlan.layers],
  );
  const gearMeshPlaneZ =
    explode <= 0 && gearPlaneLayerIndexes.length
      ? stackLayerZ[gearPlaneLayerIndexes[0]]
      : undefined;
  const renderedLayerZ = useMemo(
    () =>
      foundryRenderedLayerZForMechanism(
        renderPlan.layers,
        stackLayerZ,
      ),
    [renderPlan.layers, stackLayerZ],
  );
  const activeGearPlaneZ =
    typeof gearMeshPlaneZ === "number"
      ? gearMeshPlaneZ
      : gearPlaneLayerIndexes.length
        ? renderedLayerZ[gearPlaneLayerIndexes[0]]
        : undefined;
  const gearPlaneMode = gearPlaneLayerIndexes.length
    ? explode > 0
      ? "exploded-stack"
      : isPlanetaryGear
        ? "planetary-coplanar-ring-sun-planet"
        : "coplanar-fixed-axles"
    : isGearTrain
      ? "independent-gear-planes"
      : "not-gear-train";

  const viewerContract = useMemo(
    () =>
      createViewer3DContract(viewerTab, camera.preset, {
        grid: showGrid,
        character: automataContext?.showCharacter ? true : "absent",
        skeleton: automataContext?.showSkeleton ? true : "absent",
        mechanisms: true,
        paths: showPathPreview,
        forces: showForces,
        velocity: showVelocity,
        trail: showTrail,
      }),
    [
      camera.preset,
      viewerTab,
      automataContext?.showCharacter,
      automataContext?.showSkeleton,
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
        renderPlan,
        {
          state: simulation.state,
          gearCenters,
          planetCenters: [simulation.state.p2],
        },
      ),
    [gearCenters, renderPlan, simulation.state],
  );
  const assemblyPinPoints = useMemo(
    () => pinStackPoints.map((pin) => pin.point),
    [pinStackPoints],
  );
  const assemblyPinContract = foundryAssemblyPinContract();
  const localSpacerZForPin = useMemo(
    () => (pin: FoundryPinStackPoint, spacerLayerIndex?: number) =>
      foundryLocalSpacerZForPin(
        pin,
        renderedLayerZ,
        spacerLayerIndex,
      ),
    [renderedLayerZ],
  );
  const { partIds: visibleAutomataPartIds, objectIds: visibleAutomataObjectIds, partArtIds: visibleAutomataPartArtIds } =
    useMemo(() => visibleAutomataSceneIds(automataContext), [automataContext]);
  const pinStacks = useMemo(
    () => foundryPinStacks(pinStackPoints, renderPlan),
    [pinStackPoints, renderPlan],
  );
  const spacerRenderCount = spacerLayerIndexes.reduce(
    (count, spacerIndex) =>
      count +
      pinStackPoints.filter((pin) => foundrySpacerTouchesPin(pin, spacerIndex))
        .length,
    0,
  );
  const boardSupportNodeIds = new Set(
    renderPlan.supportNodes
      .filter((node) => node.kind === "board")
      .map((node) => node.id),
  );
  const boardPivotPinStacks = pinStacks.filter((pin) =>
    pin.supportNodeIds.some((nodeId) => boardSupportNodeIds.has(nodeId)),
  );
  const boardPivotSpacerZ = (pin: FoundryPinStackPoint) =>
    localSpacerZForPin(pin);
  const boardPivotSpacerSummary = boardPivotPinStacks
    .map((pin) => `${pin.id}:${boardPivotSpacerZ(pin)?.toFixed(2) ?? "n/a"}`)
    .join(",");
  const gearPinStackPoints = pinStackPoints.filter((pin) =>
    pin.movingLayerIndexes.some(
      (index) => renderPlan.layers[index]?.renderKind === "gear",
    ),
  );
  const gearBoardSpacerSummary = isGearTrain
    ? gearPinStackPoints
        .map(
          (pin) => `${pin.id}:${localSpacerZForPin(pin)?.toFixed(2) ?? "n/a"}`,
        )
        .join(",")
    : "";
  const gearAxleZOrderSummary = isGearTrain
    ? gearPinStackPoints
        .map((pin) => `${pin.id}:${pin.layerIndexes
          .map((index) => renderPlan.layers[index]?.renderKind)
          .filter(Boolean)
          .join(">")}`)
        .join(",")
    : "";
  const gearLinkagePinZOrderSummary =
    mechanism.type === "gear_linkage"
      ? pinStackPoints
          .map((pin) => `${pin.id}:${pin.layerIndexes
            .map((index) => renderPlan.layers[index]?.renderKind)
            .filter(Boolean)
            .join(">")}`)
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
    .map((pin) => `${pin.id}:${pin.layerIndexes.join("+") || "none"}`)
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
    ? gearPinStackPoints.map((pin) => pin.point)
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
  const supportNodeById = new Map(
    renderPlan.supportNodes.map((node) => [node.id, node]),
  );
  const supportContactErrorCount = renderPlan.supportEdges.filter((edge) => {
    if (edge.kind !== "face-contact" && edge.kind !== "retains") return false;
    const from = supportNodeById.get(edge.fromNodeId);
    const to = supportNodeById.get(edge.toNodeId);
    if (!from || !to || typeof edge.contactFaceMm !== "number") return true;
    return Math.abs(from.frontFaceMm - to.backFaceMm) > FABRICATION_Z_EPSILON_MM
      || Math.abs(edge.contactFaceMm - from.frontFaceMm) > FABRICATION_Z_EPSILON_MM
      || Math.abs(edge.contactFaceMm - to.backFaceMm) > FABRICATION_Z_EPSILON_MM;
  }).length;
  const spacerSupportErrorCount = renderPlan.supportPaths.reduce((count, path) => {
    const pathEdges = renderPlan.supportEdges.filter(
      (edge) => edge.supportPathId === path.id
        && (edge.kind === "face-contact" || edge.kind === "retains"),
    );
    const pathSpacerNodeIds = path.orderedLayerIds.flatMap((layerId) => {
      const layer = renderPlan.layers.find((candidate) => candidate.layerId === layerId);
      if (layer?.renderKind !== "spacer") return [];
      return renderPlan.supportNodes
        .filter((node) => node.ownerLayerId === layerId)
        .map((node) => node.id);
    });
    return count + pathSpacerNodeIds.filter((nodeId) =>
      pathEdges.filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId).length !== 2,
    ).length;
  }, 0);
  const supportBlockerCount = renderPlan.validationErrors.length
    + supportContactErrorCount
    + spacerSupportErrorCount;
  const zCollisionCount = pinStacks.filter(
    (pin) => pin.topZ <= pin.bottomZ || pin.lengthZ <= 0,
  ).length + supportContactErrorCount + spacerSupportErrorCount;
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
  const automataBaseZ =
    viewerTab === "design" && !assemblySceneFrame
      ? pinTopZ + AUTOMATA_DESIGN_SURFACE_CLEARANCE_Z - AUTOMATA_PART_ART_SURFACE_Z
      : pinTopZ + AUTOMATA_STACKED_BASE_LIFT_Z;
  const automataSurfaceZ = automataBaseZ + AUTOMATA_PART_ART_SURFACE_Z;
  const camContactErrorForData =
    mechanism.type === "cam"
      ? camFollowerConstraintError(mechanism, simulation.rawState) *
        simulation.scale
    : 0;
  const assemblyLayerFocusSummary = useMemo(
    () => foundryAssemblyLayerFocusSummary(assemblySceneFrame, renderPlan.layers),
    [assemblySceneFrame, renderPlan.layers],
  );
  useEffect(() => {
    if (!mechanismContract.boundPhysicsEnabled) {
      setPhysicsKernelRuntime("unavailable");
      setPhysicsKernelVersion("disabled");
      setPhysicsKernelError(mechanismContract.runtimeBlocker ?? "disabled");
      return;
    }
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
  }, [mechanismContract.boundPhysicsEnabled, mechanismContract.runtimeBlocker]);

  const renderCamera = (
    view: FoundryCamera,
    screenTargetOverride?: FoundryScreenTargets,
  ) => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    cam.position.copy(foundryCameraPosition(view));
    cam.lookAt(foundryCameraTarget(view));
    renderer.render(scene, cam);
    if (!stateRef.current) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const projectWorld = (point: THREE.Vector3) => {
      const projected = point.clone().project(cam);
      return {
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - projected.y) / 2) * rect.height,
        z: projected.z,
      };
    };
    const targetForObject = (
      kind: FoundryScreenTarget["kind"],
      id: string,
      object: THREE.Object3D,
    ): FoundryScreenTarget | null => {
      if (!object.visible) return null;
      object.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(object);
      const center = new THREE.Vector3();
      const worldPoints: THREE.Vector3[] = [];
      if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
        object.getWorldPosition(center);
        worldPoints.push(center.clone());
      } else {
        box.getCenter(center);
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              worldPoints.push(new THREE.Vector3(x, y, z));
            }
          }
        }
      }
      const centerScreen = projectWorld(center);
      let left = centerScreen.x;
      let right = centerScreen.x;
      let top = centerScreen.y;
      let bottom = centerScreen.y;
      let radius = 0;
      worldPoints.forEach((point) => {
        const screen = projectWorld(point);
        left = Math.min(left, screen.x);
        right = Math.max(right, screen.x);
        top = Math.min(top, screen.y);
        bottom = Math.max(bottom, screen.y);
        radius = Math.max(radius, Math.hypot(screen.x - centerScreen.x, screen.y - centerScreen.y));
      });
      const intersectsViewport =
        right >= rect.left && left <= rect.right && bottom >= rect.top && top <= rect.bottom;
      const visible = intersectsViewport;
      const visibleLeft = Math.max(left, rect.left);
      const visibleRight = Math.min(right, rect.right);
      const visibleTop = Math.max(top, rect.top);
      const visibleBottom = Math.min(bottom, rect.bottom);
      const clickX = visible ? (visibleLeft + visibleRight) / 2 : centerScreen.x;
      const clickY = visible ? (visibleTop + visibleBottom) / 2 : centerScreen.y;
      return { kind, id, x: clickX, y: clickY, left, top, right, bottom, radius, visible };
    };
    const dynamicObjectTargets = new Map<string, FoundryScreenTarget>();
    const dynamicPartTargets = new Map<string, FoundryScreenTarget>();
    const dynamic = scene.getObjectByName("foundry-dynamic");
    dynamic?.traverse((object) => {
      const sceneObjectId = object.userData.sceneObjectId;
      if (
        typeof sceneObjectId === "string" &&
        !dynamicObjectTargets.has(sceneObjectId)
      ) {
        const target = targetForObject("object", sceneObjectId, object);
        if (target) dynamicObjectTargets.set(sceneObjectId, target);
      }
      const partId = object.userData.partId;
      if (typeof partId === "string" && !dynamicPartTargets.has(partId)) {
        const target = targetForObject("part", partId, object);
        if (target) dynamicPartTargets.set(partId, target);
      }
    });
    const targetsToWrite = screenTargetOverride
      ? {
          objectTargets:
            screenTargetOverride.objectTargets.length > 0
              ? screenTargetOverride.objectTargets
              : roundedFoundryScreenTargets([...dynamicObjectTargets.values()]),
          partTargets:
            screenTargetOverride.partTargets.length > 0
              ? screenTargetOverride.partTargets
              : roundedFoundryScreenTargets([...dynamicPartTargets.values()]),
          mechanismTargets:
            screenTargetOverride.mechanismTargets ?? roundedFoundryScreenTargets([]),
        }
      : {
          objectTargets: roundedFoundryScreenTargets([...dynamicObjectTargets.values()]),
          partTargets: roundedFoundryScreenTargets([...dynamicPartTargets.values()]),
          mechanismTargets: [],
        };
    stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(
      targetsToWrite.objectTargets,
    );
    stateRef.current.dataset.threePartScreenTargets = JSON.stringify(
      targetsToWrite.partTargets,
    );
    stateRef.current.dataset.threeMechanismScreenTargets = JSON.stringify(
      targetsToWrite.mechanismTargets,
    );
    const assemblyBoard = scene.getObjectByName("assembly-15x15-board-surface");
    stateRef.current.dataset.threeAssemblyBoardSurface = assemblyBoard
      ? String(assemblyBoard.userData.assemblyBoardSurface ?? "15x15-hole-board")
      : "hidden";
    stateRef.current.dataset.threeAssemblyBoardHoleCount = String(
      assemblyBoard?.userData.assemblyBoardHoleCount ?? 0,
    );
    stateRef.current.dataset.threeAssemblyBoardZ = assemblyBoard
      ? Number(assemblyBoard.userData.assemblyBoardZ ?? 0).toFixed(2)
      : "";
  };
  const pickAutomataTarget = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !automataContext?.showCharacter ||
      (!onAutomataPartSelect && !onAutomataSceneObjectSelect)
    )
      return false;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cam);
    const dynamic = scene.getObjectByName("foundry-dynamic");
    const hits = raycaster.intersectObjects(
      dynamic ? dynamic.children : scene.children,
      true,
    );
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const sceneObjectId = object.userData.sceneObjectId;
        if (typeof sceneObjectId === "string" && onAutomataSceneObjectSelect) {
          onAutomataSceneObjectSelect(sceneObjectId);
          return true;
        }
        const partId = object.userData.partId;
        if (typeof partId === "string" && onAutomataPartSelect) {
          onAutomataPartSelect(partId);
          return true;
        }
        object = object.parent;
      }
    }
    if (onAutomataSceneObjectSelect && stateRef.current) {
      try {
        const targets = JSON.parse(
          stateRef.current.dataset.threeSceneObjectScreenTargets || "[]",
        ) as Array<FoundryScreenTarget>;
        const target = targets.find(
          (item) =>
            item.visible &&
            event.clientX >= item.left &&
            event.clientX <= item.right &&
            event.clientY >= item.top &&
            event.clientY <= item.bottom,
        );
        if (target) {
          onAutomataSceneObjectSelect(target.id);
          return true;
        }
        if (targets.length === 1) {
          onAutomataSceneObjectSelect(targets[0].id);
          return true;
        }
      } catch {
        // Ignore malformed test-only telemetry and keep normal ray picking.
      }
      const visibleObjectIds =
        automataContext.project.sceneObjectOrder.filter(
          (id) =>
            (automataContext.animatedSceneObjects?.[id] ??
              automataContext.project.sceneObjects[id])?.visible,
        );
      if (visibleObjectIds.length === 1) {
        onAutomataSceneObjectSelect(visibleObjectIds[0]);
        return true;
      }
    }
    if (onAutomataPartSelect && stateRef.current) {
      try {
        const targets = JSON.parse(
          stateRef.current.dataset.threePartScreenTargets || "[]",
        ) as Array<FoundryScreenTarget>;
        const target = targets.find(
          (item) =>
            item.visible &&
            event.clientX >= item.left &&
            event.clientX <= item.right &&
            event.clientY >= item.top &&
            event.clientY <= item.bottom,
        );
        if (target) {
          onAutomataPartSelect(target.id);
          return true;
        }
      } catch {
        // Ignore malformed test-only telemetry and keep normal ray picking.
      }
    }
    return false;
  };

  const handleAnchorClick: React.MouseEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (!isPickingAnchor && pickAutomataTarget(event)) return;
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
      materialCacheRef.current.forEach((material) => {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      });
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
    if (supportBlockerCount || physicalValidationErrors.length) {
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
    const fallbackTargets = createFoundryFallbackSceneObjectTargets(
      visibleAutomataObjectIds,
      visibleAutomataPartIds,
          automataContext,
          automataBaseZ,
          renderer,
          cam,
        );
        stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(
          fallbackTargets.objectTargets,
        );
        stateRef.current.dataset.threePartScreenTargets = JSON.stringify(
          fallbackTargets.partTargets,
        );
        stateRef.current.dataset.threeMechanismScreenTargets = "[]";
        renderCamera(cameraStateRef.current, {
          objectTargets: fallbackTargets.objectTargets,
          partTargets: fallbackTargets.partTargets,
          mechanismTargets: [],
        });
        return;
      }
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
      kit,
      simulation,
      primitives,
      renderPlan,
      renderedLayerZ,
      pinStacks,
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
    renderFoundryAutomataContext({
      root,
      context: automataContext,
      assemblySceneFrame,
      materialCache: materialCacheRef.current,
      onLoaded: () => renderCamera(cameraStateRef.current),
      baseZ: automataBaseZ,
    });

    dynamicBuildCountRef.current += 1;
    if (stateRef.current) {
      const visiblePartIds = visibleAutomataPartIds;
      const visibleObjectIds = visibleAutomataObjectIds;
      const visiblePartArtIds = visibleAutomataPartArtIds;
      stateRef.current.dataset.threeDynamicBuildCount = String(
        dynamicBuildCountRef.current,
      );
      stateRef.current.dataset.threeGeometryCacheSize = String(
        geometryCacheRef.current.size,
      );
      stateRef.current.dataset.threeMaterialCacheSize = String(
        materialCacheRef.current.size,
      );
      stateRef.current.dataset.threeAutomataContext =
        automataContext?.showCharacter ? "shown" : "absent";
      stateRef.current.dataset.partCount = String(visiblePartIds.length);
      stateRef.current.dataset.sceneObjectCount = String(visibleObjectIds.length);
      stateRef.current.dataset.selectedPartId =
        automataContext?.project.selectedPartId ?? "";
      stateRef.current.dataset.selectedSceneObjectId =
        automataContext?.project.selectedSceneObjectId ?? "";
      stateRef.current.dataset.threeAutomataPartCount = String(
        visiblePartIds.length,
      );
      stateRef.current.dataset.threePartArt = visiblePartArtIds.length
        ? "top-texture-decal"
        : "none";
      stateRef.current.dataset.threePartArtCount = String(
        visiblePartArtIds.length,
      );
      stateRef.current.dataset.threeAutomataObjectCount = String(
        visibleObjectIds.length,
      );
      stateRef.current.dataset.threeScenePropCount = String(
        visibleObjectIds.length,
      );
      stateRef.current.dataset.threeScenePropIds = visibleObjectIds.join(",");
      const fallbackTargets = createFoundryFallbackSceneObjectTargets(
        visibleObjectIds,
        visiblePartIds,
        automataContext,
        automataBaseZ,
        renderer,
        cam,
      );
      stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(
        fallbackTargets.objectTargets,
      );
      stateRef.current.dataset.threePartScreenTargets = JSON.stringify(
        fallbackTargets.partTargets,
      );
      stateRef.current.dataset.threeMechanismScreenTargets = "[]";
      const assemblyBoard = scene.getObjectByName("assembly-15x15-board-surface");
      stateRef.current.dataset.threeAssemblyBoardSurface = assemblyBoard
        ? String(assemblyBoard.userData.assemblyBoardSurface ?? "15x15-hole-board")
        : "hidden";
      stateRef.current.dataset.threeAssemblyBoardHoleCount = String(
        assemblyBoard?.userData.assemblyBoardHoleCount ?? 0,
      );
      stateRef.current.dataset.threeAssemblyBoardZ = assemblyBoard
        ? Number(assemblyBoard.userData.assemblyBoardZ ?? 0).toFixed(2)
        : "";
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
    supportBlockerCount,
    assemblySceneFrame,
    pinBottomZ,
    pinTopZ,
    automataBaseZ,
    viewerTab,
    pathPoints,
    automataContext,
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
      data-mechanism-compiler-signature={mechanismContract.compilerSignature}
      data-mechanism-runtime-mode={mechanismContract.runtimeMode ?? ""}
      data-viewer-contract-state={JSON.stringify(viewerContract)}
      data-viewer-tab={viewerContract.tab}
      data-layer-grid={viewer3DLayerDataValue(showGrid)}
      data-layer-mechanisms={viewer3DLayerDataValue(true)}
      data-layer-character={viewer3DLayerDataValue(automataContext?.showCharacter ? true : undefined)}
      data-layer-skeleton={viewer3DLayerDataValue(automataContext?.showSkeleton ? true : undefined)}
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
        supportContactErrorCount={supportContactErrorCount}
        spacerSupportErrorCount={spacerSupportErrorCount}
        supportBlockerCount={supportBlockerCount}
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
        automataBaseZ={automataBaseZ}
        automataSurfaceZ={automataSurfaceZ}
        pinLengthZ={pinLengthZ}
        stackZGap={stackZGap}
        renderPlan={renderPlan}
        renderedLayerZ={renderedLayerZ}
        physicalValidationErrors={physicalValidationErrors}
        physicalValidationSummary={physicalValidationSummary}
        assemblySceneFrame={assemblySceneFrame}
        assemblyLayerFocusSummary={assemblyLayerFocusSummary}
        visibleSceneObjectCount={visibleAutomataObjectIds.length}
        visiblePartCount={Math.max(visibleAutomataPartIds.length, inv.parts)}
        visibleSceneObjectIds={visibleAutomataObjectIds}
        selectedSceneObjectId={automataContext?.project.selectedSceneObjectId ?? ""}
        connectionSelectionCoordinates={connectionSelectionCoordinates}
        connectionExportSignature={connectionExportSignature}
        selectedConnection={selectedConnection}
      />
      {children}
    </div>
  );
};

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { registerCanvasCapture } from "../../../utils/canvasCapture";
import { fitWorkingPreviewCamera, visibleObjectBounds, workingPreviewFrame, type WorkingPreviewFit } from "../../../utils/workingPreviewCamera";
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
  gearPairOutputRatio,
  gearTrainMeshPhaseDegAt,
  gearTrainOutputRatio,
  gearTrainPitchRadii,
  planetaryCarrierOutputRatio,
} from "../../../utils/kinematics";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_RENDER_LAYER_Z_STEP,
  FABRICATION_RENDER_MIN_CLEARANCE,
  FABRICATION_RENDER_PART_DEPTH,
  fabricationRenderPlanForMechanism,
  planetaryGearConventionForMechanism,
  planetaryGearRadii,
  validateMechanismPreviewReadiness,
} from "../../../utils/fabrication";
import { SCENE_PX_PER_MM, SCENE_VIEW, boardToScene, sceneBoundsForSheet } from "../../../utils/coordinates";
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
  degToRad,
  foundryPreviewToScenePoint,
  foundryCameraPosition,
  foundryCameraTarget,
  FOUNDRY_WORK_PLANE_Z,
  sceneToFoundryPreviewPoint,
  type FoundryCamera,
  type FoundryOverlaySize,
} from "../../../utils/foundryCamera";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import type { PlaybackClock } from "../../../runtime/playback/externalPlaybackClock";
import {
  HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS,
  subscribeCadencedPlaybackSampler,
} from "../../../runtime/playback/cadencedPlaybackSampler";
import { scheduleIncrementalTopologyBuild } from "../../../runtime/render/incrementalTopologyBuild";
import {
  createKeyedInitialTopologySettlement,
  foundryInitialShaderSettlementSteps,
  foundryInitialTopologySettlementSteps,
  type FoundryInitialShaderSettlementStep,
  type FoundryInitialTopologySettlementStep,
  type KeyedInitialTopologySettlement,
} from "../../../runtime/render/initialSceneSettlement";
import {
  highResolutionSessionController,
  shouldRecordAdaptiveSubmission,
} from "../../../runtime/render/adaptiveHighResolutionController";
import type {
  TransientValueController,
} from "../../../runtime/render/transientValueController";
import {
  acquireSharedWebGLRenderer,
  cachedThreeResource,
  collectThreeObjectResourceUsage,
  pruneUnusedThreeResourceCache,
  rendererEffectivePixelRatio,
  resizeRendererToPerformancePolicy,
} from "../../../utils/threeResourceKit";
import {
  recordFoundryGestureVisualEmission,
  recordFoundryTopologyBuild,
} from "../../../utils/performanceAudit";
import { resolveRenderPerformancePolicy } from "../../../utils/renderPerformancePolicy";
import type { PartTopologyPolicy } from "../../../utils/renderPerformancePolicy";
import { sampleIndexedValues } from "../../../utils/interactiveSampling";
import { retainFoundryGestureAnalysis } from "./foundryHandleGesture";
import { fittedGearTrainCenters } from "./foundryPreviewGeometry";
import { FoundryPreviewStateProbe } from "./FoundryPreviewStateProbe";
import {
  disposeFoundryAssemblyOverlayRuntime,
  foundryAssemblyLayerFocusSummary,
  renderFoundryAssemblySceneOverlay,
  type FoundryAssemblySceneFrame,
} from "./foundryAssemblySceneOverlay";
import {
  FOUNDRY_CACHE_MARKER,
  createFoundryThreePrimitiveFactory,
  disposeFoundryThreeObject,
} from "./foundryThreePrimitives";
import { FoundryThreeObjectPool } from "./foundryThreeObjectPool";
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

const E2E_DIAGNOSTICS = __MOTIONSMITH_E2E_DIAGNOSTICS__;
type FoundryRendererStatus = "pending" | "webgl" | "restoring" | "unavailable";

const sharedFoundryGeometryCache = new Map<string, THREE.BufferGeometry>();
const sharedFoundryMaterialCache = new Map<string, THREE.Material>();
const foundryProjectTopologyRevisions = new WeakMap<ProjectState, number>();
let nextFoundryProjectTopologyRevision = 1;

const foundryProjectTopologyRevision = (project: ProjectState) => {
  const existing = foundryProjectTopologyRevisions.get(project);
  if (existing !== undefined) return existing;
  const revision = nextFoundryProjectTopologyRevision;
  nextFoundryProjectTopologyRevision += 1;
  foundryProjectTopologyRevisions.set(project, revision);
  return revision;
};

const foundryTopologyPointKey = (points: readonly Point[]) =>
  points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(";");

export type ThreeFoundryPreviewProps = {
  mechanism: MechanismConfig;
  performancePreset: ProjectState["settings"]["performancePreset"];
  simulation: MechanismPreviewSimulation;
  playback?: {
    clock: PlaybackClock;
    sample: (phase: number) => FoundryPlaybackFrame | undefined;
    minFrameIntervalMs?: number;
  };
  kit: PhysicalKitSettings;
  camera: FoundryCamera;
  cameraFit?: WorkingPreviewFit;
  onCameraFit?: (camera: FoundryCamera) => void;
  transientCamera?: TransientValueController<FoundryCamera>;
  transientFrame?: TransientValueController<FoundryPlaybackFrame>;
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
  viewerTab?: Viewer3DTabKey;
  automataContext?: FoundryAutomataContext;
  deferMechanismTopology?: boolean;
  children: React.ReactNode;
};

type FoundryAutomataContext = {
  project: ProjectState;
  animatedParts?: Record<string, BodyPartLayer>;
  animatedSceneObjects?: Record<string, SceneObject>;
  geometrySkeleton?: StandardSkeleton | null;
  skeleton?: StandardSkeleton | null;
  paths?: ProjectMotionPath[];
  selectedPathId?: string;
  showCharacter?: boolean;
  showSkeleton?: boolean;
};

export type FoundryPlaybackFrame = {
  mechanism?: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  automataContext?: FoundryAutomataContext;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  explode?: number;
  deferMechanismTopology?: boolean;
  measureSubmissionInterval?: boolean;
};

type FoundryRenderFrame = FoundryPlaybackFrame & {
  initialTopologySettlement?: FoundryInitialTopologySettlementStep;
};

const foundryInitialTopologyKey = ({
  mechanism,
  renderPlan,
  kit,
  partTopology,
  automataContext,
  assemblySceneFrame,
  pinStackCount,
  physicalValidationSummary,
}: {
  mechanism: MechanismConfig;
  renderPlan: ReturnType<typeof fabricationRenderPlanForMechanism>;
  kit: PhysicalKitSettings;
  partTopology: PartTopologyPolicy;
  automataContext?: FoundryAutomataContext;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  pinStackCount: number;
  physicalValidationSummary: string;
}) =>
  JSON.stringify({
    mechanism: [
      mechanism.id,
      mechanism.type,
      mechanism.crankLength,
      mechanism.groundLength,
      mechanism.couplerLength,
      mechanism.rockerLength,
      mechanism.rodLength ?? null,
      mechanism.sliderOffset,
      mechanism.couplerPointDist,
      mechanism.couplerPointAngle,
      mechanism.assemblyMode ?? null,
      mechanism.gearRatio ?? null,
      mechanism.gearTrainRadii ?? null,
      mechanism.camProfileSamples ?? null,
      mechanism.showOutputGear ?? null,
      mechanism.outputGearRadius ?? null,
    ],
    renderPlan: [
      renderPlan.occurrenceSummary,
      renderPlan.zSummary,
      renderPlan.validationErrors,
      physicalValidationSummary,
    ],
    kit: [
      kit.profileKey,
      kit.gridPitchMm,
      kit.sheetWidthMm,
      kit.sheetHeightMm,
      kit.boardCells,
      kit.holeDiameterMm,
    ],
    partTopology: [
      partTopology.bevelEnabled,
      partTopology.edgeGeometryEnabled,
      partTopology.curveSegments,
    ],
    projectRevision: automataContext
      ? [
          foundryProjectTopologyRevision(automataContext.project),
          automataContext.project.metadata.id,
          automataContext.project.metadata.updatedAt,
          automataContext.showCharacter ?? false,
          automataContext.showSkeleton ?? false,
        ]
      : null,
    assemblyTopology: assemblySceneFrame
      ? [
          assemblySceneFrame.version,
          assemblySceneFrame.kind,
          assemblySceneFrame.boardMode,
          assemblySceneFrame.kitProfileKey ?? null,
          assemblySceneFrame.visibleParts.map((part) => [
            part.id,
            part.role,
            part.zMm ?? null,
          ]),
          assemblySceneFrame.activeBoardCoords,
          assemblySceneFrame.floatingReferenceCoords,
          assemblySceneFrame.mechanismContract
            ? [
                assemblySceneFrame.mechanismContract.version,
                assemblySceneFrame.mechanismContract.mechanismId,
                assemblySceneFrame.mechanismContract.zSummary,
                assemblySceneFrame.mechanismContract.layers.map(
                  (layer) => layer.id,
                ),
              ]
            : null,
        ]
      : null,
    pinStackCount,
  });

const FOUNDRY_PREVIEW_WIDTH = 360;
const FOUNDRY_PREVIEW_HEIGHT = 240;
const SCENE_TO_FOUNDRY_SCALE = Math.min(
  FOUNDRY_PREVIEW_WIDTH / SCENE_VIEW.width,
  FOUNDRY_PREVIEW_HEIGHT / SCENE_VIEW.height,
);

const foundryTo3 = (point: Point, z = 0) =>
  new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);

const sceneToFoundryPreview = (point: Point): Point =>
  sceneToFoundryPreviewPoint(point);

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
) => {
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
  geometryCache,
  materialCache,
  onLoaded,
  baseZ,
  maxPathLinePoints,
  partTopology,
}: {
  root: THREE.Group;
  context?: FoundryAutomataContext;
  assemblySceneFrame?: FoundryAssemblySceneFrame;
  geometryCache: Map<string, THREE.BufferGeometry>;
  materialCache: Map<string, THREE.Material>;
  onLoaded: () => void;
  baseZ: number;
  maxPathLinePoints: number;
  partTopology: PartTopologyPolicy;
}): boolean => {
  let automataRoot = root.getObjectByName(
    "foundry-automata-context",
  ) as THREE.Group | undefined;
  if (!context?.showCharacter) {
    if (!automataRoot) return false;
    automataRoot.removeFromParent();
    disposeFoundryThreeObject(automataRoot);
    return true;
  }
  const project = context.project;
  const skeleton =
    context.geometrySkeleton ?? project.skeleton ?? context.skeleton;
  const animatedParts = context.animatedParts ?? {};
  const animatedSceneObjects = context.animatedSceneObjects ?? {};
  const paths = context.paths ?? [];
  const pathTopologyKey = paths
    .map(
      (path) =>
        `${path.id}:${path.closed ? 1 : 0}:${path.points
          .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
          .join(";")}`,
    )
    .join("|");
  const topologyRefs = automataRoot?.userData.topologyRefs as
    | {
        parts: ProjectState["parts"];
        partOrder: ProjectState["partOrder"];
        sceneObjects: ProjectState["sceneObjects"];
        sceneObjectOrder: ProjectState["sceneObjectOrder"];
        skeleton: StandardSkeleton | null | undefined;
        pathTopologyKey: string;
        topologyDetailKey: string;
      }
    | undefined;
  const topologyMatches = Boolean(
    automataRoot &&
      topologyRefs?.parts === project.parts &&
      topologyRefs.partOrder === project.partOrder &&
      topologyRefs.sceneObjects === project.sceneObjects &&
      topologyRefs.sceneObjectOrder === project.sceneObjectOrder &&
      topologyRefs.skeleton === skeleton &&
      topologyRefs.pathTopologyKey === pathTopologyKey &&
      topologyRefs.topologyDetailKey ===
        `${partTopology.bevelEnabled}:${partTopology.edgeGeometryEnabled}:${partTopology.curveSegments}`,
  );
  const edge = partTopology.edgeGeometryEnabled
    ? foundryAutomataMaterial("#334155", 0.58, materialCache)
    : null;
  const selected = foundryAutomataMaterial("#a78bfa", 0.56, materialCache);
  const holeRadius = Math.max(
    1,
    FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM,
  );
  let topologyChanged = false;
  if (!topologyMatches) {
    if (automataRoot) {
      automataRoot.removeFromParent();
      disposeFoundryThreeObject(automataRoot);
    }
    automataRoot = new THREE.Group();
    automataRoot.name = "foundry-automata-context";
    automataRoot.userData.topologyRefs = {
      parts: project.parts,
      partOrder: project.partOrder,
      sceneObjects: project.sceneObjects,
      sceneObjectOrder: project.sceneObjectOrder,
      skeleton,
      pathTopologyKey,
      topologyDetailKey: `${partTopology.bevelEnabled}:${partTopology.edgeGeometryEnabled}:${partTopology.curveSegments}`,
    };
    root.add(automataRoot);
    topologyChanged = true;

    project.partOrder.forEach((partId) => {
      const base = project.parts[partId];
      if (!base) return;
      const landmarks = partLandmarkLocalPoints(base, skeleton);
      const outline = fabricablePartOutlinePoints(base, landmarks);
      if (outline.length < 3) return;
      const shape = foundrySceneLocalShape(outline);
      const localHoles = landmarks.filter((local) =>
        pointInsideOutline(local, outline, 0.5)
      );
      localHoles.forEach((local) =>
        shape.holes.push(foundrySceneLocalHole(local, holeRadius))
      );
      const geometryKey = `automata-part:${partId}:${foundryTopologyPointKey(outline)}:${foundryTopologyPointKey(localHoles)}:${partTopology.bevelEnabled}:${partTopology.curveSegments}`;
      const geometry = cachedThreeResource(
        geometryCache,
        geometryKey,
        () => new THREE.ExtrudeGeometry(shape, {
          depth: 0.16,
          bevelEnabled: partTopology.bevelEnabled,
          bevelSize: 0.018,
          bevelThickness: 0.012,
          bevelSegments: 1,
          curveSegments: partTopology.curveSegments,
          steps: 1,
        }),
        FOUNDRY_CACHE_MARKER,
      );
      const group = new THREE.Group();
      group.name = `foundry-automata-part-${partId}`;
      group.userData.partId = partId;
      const mesh = new THREE.Mesh(
        geometry,
        foundryAutomataMaterial(
          base.fillColor,
          Math.min(0.72, base.opacity),
          materialCache,
        ),
      );
      mesh.position.z = -0.08;
      mesh.userData.partId = partId;
      if (edge) {
        mesh.add(new THREE.LineSegments(
          cachedThreeResource(
            geometryCache,
            `edges:${geometryKey}`,
            () => new THREE.EdgesGeometry(geometry),
            FOUNDRY_CACHE_MARKER,
          ),
          edge,
        ));
      }
      group.add(mesh);
      if (base.textureUrl) {
        const artGeometry = cachedThreeResource(
          geometryCache,
          `art:${geometryKey}`,
          () => {
            const next = new THREE.ShapeGeometry(shape, partTopology.curveSegments);
            const positions = next.getAttribute("position");
            const uvs: number[] = [];
            const width = Math.max(1, base.bounds.width);
            const height = Math.max(1, base.bounds.height);
            for (let index = 0; index < positions.count; index += 1) {
              const local = sceneLocalFromFoundryGeometry(
                positions.getX(index),
                positions.getY(index),
              );
              uvs.push(
                (local.x - base.bounds.x) / width,
                (local.y - base.bounds.y) / height,
              );
            }
            next.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
            return next;
          },
          FOUNDRY_CACHE_MARKER,
        );
        const art = new THREE.Mesh(
          artGeometry,
          foundryAutomataTextureMaterial(
            base.textureUrl,
            Math.min(0.82, base.opacity),
            onLoaded,
          ),
        );
        art.name = `foundry-automata-art-${partId}`;
        art.position.z = 0.09;
        art.userData.partId = partId;
        group.add(art);
      }
      automataRoot?.add(group);
    });

    project.sceneObjectOrder.forEach((objectId) => {
      const base = project.sceneObjects[objectId];
      if (!base) return;
      const shape = foundrySceneObjectShape(base);
      const geometryKey = `automata-object:${objectId}:${base.bounds.width.toFixed(2)}:${base.bounds.height.toFixed(2)}:${partTopology.bevelEnabled}:${partTopology.curveSegments}`;
      const geometry = cachedThreeResource(
        geometryCache,
        geometryKey,
        () => new THREE.ExtrudeGeometry(shape, {
          depth: 0.14,
          bevelEnabled: partTopology.bevelEnabled,
          bevelSize: 0.014,
          bevelThickness: 0.01,
          bevelSegments: 1,
          curveSegments: partTopology.curveSegments,
          steps: 1,
        }),
        FOUNDRY_CACHE_MARKER,
      );
      const group = new THREE.Group();
      group.name = `foundry-automata-object-${objectId}`;
      group.userData.sceneObjectId = objectId;
      const mesh = new THREE.Mesh(
        geometry,
        foundryAutomataMaterial(
          base.fillColor,
          Math.min(0.76, base.opacity),
          materialCache,
        ),
      );
      mesh.position.z = -0.07;
      mesh.userData.sceneObjectId = objectId;
      if (edge) {
        mesh.add(new THREE.LineSegments(
          cachedThreeResource(
            geometryCache,
            `edges:${geometryKey}`,
            () => new THREE.EdgesGeometry(geometry),
            FOUNDRY_CACHE_MARKER,
          ),
          edge,
        ));
      }
      group.add(mesh);
      if (base.textureUrl) {
        const artGeometry = cachedThreeResource(
          geometryCache,
          `art:${geometryKey}`,
          () => {
            const next = new THREE.ShapeGeometry(shape, partTopology.curveSegments);
            const positions = next.getAttribute("position");
            const uvs: number[] = [];
            const width = Math.max(1, base.bounds.width);
            const height = Math.max(1, base.bounds.height);
            for (let index = 0; index < positions.count; index += 1) {
              const local = sceneLocalFromFoundryGeometry(
                positions.getX(index),
                positions.getY(index),
              );
              uvs.push(local.x / width + 0.5, 0.5 - local.y / height);
            }
            next.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
            return next;
          },
          FOUNDRY_CACHE_MARKER,
        );
        const art = new THREE.Mesh(
          artGeometry,
          foundryAutomataTextureMaterial(
            base.textureUrl,
            Math.min(0.86, base.opacity),
            onLoaded,
          ),
        );
        art.name = `foundry-automata-art-${objectId}`;
        art.position.z = 0.08;
        art.userData.sceneObjectId = objectId;
        group.add(art);
      }
      automataRoot?.add(group);
    });

    paths
      .filter((path) => path.points.length > 1)
      .forEach((path) => {
        const points = sampleIndexedValues(path.points, maxPathLinePoints)
          .map(({ value }) => sceneTo3(value, 0));
        const linePoints =
          path.closed && points.length > 2
            ? [...points, points[0].clone()]
            : points;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(linePoints),
          foundryAutomataMaterial("#8b5cf6", 0.62, materialCache),
        );
        line.name = `foundry-automata-path-${path.id}`;
        automataRoot?.add(line);
      });
  }

  const activeAssemblyPartIds = new Set(
    assemblySceneFrame?.kind === "character"
      ? assemblySceneFrame.activePartIds
      : [],
  );
  const assemblyLift =
    assemblySceneFrame?.kind === "character" && assemblySceneFrame.explodeAxis === "z"
      ? 0.3 + assemblySceneFrame.progress * 0.8
      : 0;
  project.partOrder.forEach((partId) => {
    const base = project.parts[partId];
    const part = animatedParts[partId] ?? base;
    const group = automataRoot?.getObjectByName(
      `foundry-automata-part-${partId}`,
    ) as THREE.Group | undefined;
    if (!base || !part || !group) return;
    group.visible = part.visible;
    const mesh = group.children[0] as THREE.Mesh | undefined;
    if (mesh) {
      mesh.material =
        partId === project.selectedPartId
          ? selected
          : foundryAutomataMaterial(
              base.fillColor,
              activeAssemblyPartIds.size &&
                !activeAssemblyPartIds.has(partId)
                ? 0.24
                : Math.min(0.72, base.opacity),
              materialCache,
            );
    }
    placeSceneLocalGroup(
      group,
      part.transform,
      baseZ +
        part.zIndex * 0.045 +
        (activeAssemblyPartIds.has(partId) ? assemblyLift : 0),
    );
  });

  project.sceneObjectOrder.forEach((objectId) => {
    const base = project.sceneObjects[objectId];
    const object = animatedSceneObjects[objectId] ?? base;
    const group = automataRoot?.getObjectByName(
      `foundry-automata-object-${objectId}`,
    ) as THREE.Group | undefined;
    if (!base || !object || !group) return;
    group.visible = object.visible;
    const mesh = group.children[0] as THREE.Mesh | undefined;
    if (mesh) {
      mesh.material =
        objectId === project.selectedSceneObjectId
          ? selected
          : foundryAutomataMaterial(
              base.fillColor,
              Math.min(0.76, base.opacity),
              materialCache,
            );
    }
    placeSceneLocalGroup(group, object.transform, baseZ + 0.12 + object.zIndex * 0.045);
  });

  paths.forEach((path) => {
    const line = automataRoot?.getObjectByName(
      `foundry-automata-path-${path.id}`,
    ) as THREE.Line | undefined;
    if (!line) return;
    line.visible = path.visible !== false;
    line.position.z = baseZ + 0.36;
    line.material = foundryAutomataMaterial(
        path.id === context.selectedPathId ? "#7c3aed" : "#8b5cf6",
        path.id === context.selectedPathId ? 0.94 : 0.62,
      materialCache,
    );
  });
  if (automataRoot) automataRoot.visible = true;
  return topologyChanged;
};

export const ThreeFoundryPreview = ({
  mechanism,
  performancePreset,
  simulation,
  playback,
  kit,
  camera,
  cameraFit,
  onCameraFit,
  transientCamera,
  transientFrame,
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
  onAutomataPartSelect,
  onAutomataSceneObjectSelect,
  assemblySceneFrame,
  viewerTab = "foundry",
  automataContext,
  deferMechanismTopology = false,
  children,
}: ThreeFoundryPreviewProps) => {
  const renderPolicy = resolveRenderPerformancePolicy(performancePreset);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraStateRef = useRef(camera);
  const cameraFitRef = useRef(cameraFit);
  const completedCameraFitRef = useRef<WorkingPreviewFit | undefined>(undefined);
  const onCameraFitRef = useRef(onCameraFit);
  cameraFitRef.current = cameraFit;
  onCameraFitRef.current = onCameraFit;
  const dynamicBuildCountRef = useRef(0);
  const primitivePoolRef = useRef<FoundryThreeObjectPool | null>(null);
  const automataContextRef = useRef<FoundryAutomataContext | undefined>(automataContext);
  const assemblySceneFrameRef = useRef<FoundryAssemblySceneFrame | undefined>(assemblySceneFrame);
  const renderDynamicRef = useRef<((frame: FoundryRenderFrame) => void) | null>(null);
  const playbackSampleRef = useRef(playback?.sample);
  const renderSubmissionCountRef = useRef(0);
  const effectiveDprRef = useRef(renderPolicy.pixelRatioCap);
  const requestedDprCapRef = useRef(renderPolicy.pixelRatioCap);
  const rendererResizeRef = useRef<(() => void) | null>(null);
  const reportedProjectionSizeRef = useRef<FoundryOverlaySize | null>(null);
  const adaptiveTopologyOwnerRef = useRef<object>({});
  const adaptiveInitialSettlementOwnerRef = useRef<object>({});
  const renderPolicyPresetRef = useRef(renderPolicy.preset);
  const initialShaderSettlementActiveRef = useRef(false);
  const initialTopologyCompleteRef = useRef(false);
  const completedInitialTopologyKeyRef = useRef<string | null>(null);
  const initialTopologySettlementRef = useRef<
    KeyedInitialTopologySettlement<
      FoundryPlaybackFrame,
      FoundryInitialTopologySettlementStep
    > | null
  >(null);
  const retainedRenderPlanRef = useRef<
    ReturnType<typeof fabricationRenderPlanForMechanism> | null
  >(null);
  const retainedValidationRef = useRef<
    ReturnType<typeof validateMechanismPreviewReadiness> | null
  >(null);
  const publishInitialTopologyReady = (ready: boolean) => {
    initialTopologyCompleteRef.current = ready;
    const value = ready ? "true" : "false";
    if (stateRef.current) stateRef.current.dataset.threeTopologyReady = value;
    const preview = hostRef.current?.parentElement;
    if (preview) preview.dataset.threeTopologyReady = value;
  };
  const publishInitialTopologyTransitionDiagnostics = () => {
    if (!E2E_DIAGNOSTICS) return;
    const snapshot = initialTopologySettlementRef.current?.snapshot();
    if (!snapshot) return;
    const publish = (element: HTMLElement | null | undefined) => {
      if (!element) return;
      element.dataset.threeInitialTopologyActive = String(snapshot.active);
      element.dataset.threeInitialTopologyStarts = String(
        snapshot.generationsStarted,
      );
      element.dataset.threeInitialTopologyUpdates = String(
        snapshot.sameKeyUpdates,
      );
      element.dataset.threeInitialTopologyRestarts = String(
        snapshot.generationsRestarted,
      );
      element.dataset.threeInitialTopologyCancels = String(
        snapshot.generationsCancelled,
      );
      element.dataset.threeInitialTopologySteps = String(
        snapshot.stepsDelivered,
      );
      element.dataset.threeInitialTopologyCompletes = String(
        snapshot.generationsCompleted,
      );
    };
    publish(stateRef.current);
    publish(hostRef.current?.parentElement);
  };
  const cancelInitialTopologySettlement = () => {
    initialTopologySettlementRef.current?.cancel();
    completedInitialTopologyKeyRef.current = null;
    highResolutionSessionController.setTopologyBuildActive(
      adaptiveInitialSettlementOwnerRef.current,
      false,
    );
  };
  renderPolicyPresetRef.current = renderPolicy.preset;
  const initialTopologySettlementController =
    initialTopologySettlementRef.current ??
    createKeyedInitialTopologySettlement<
      FoundryPlaybackFrame,
      FoundryInitialTopologySettlementStep
    >({
      schedule: (steps, visit, complete) =>
        scheduleIncrementalTopologyBuild(steps, visit, {
          maxItemsPerFrame: 1,
          frameBudgetMs: 4,
          onComplete: complete,
        }),
      onStart: () => {
        publishInitialTopologyReady(false);
        if (renderPolicyPresetRef.current === "high") {
          highResolutionSessionController.setTopologyBuildActive(
            adaptiveInitialSettlementOwnerRef.current,
            true,
          );
        }
        publishInitialTopologyTransitionDiagnostics();
      },
      onStep: (settlement, latestFrame) => {
        renderDynamicRef.current?.({
          ...latestFrame,
          measureSubmissionInterval: false,
          initialTopologySettlement: settlement,
        });
        publishInitialTopologyTransitionDiagnostics();
      },
      onComplete: (_latestFrame, key) => {
        completedInitialTopologyKeyRef.current = key;
        highResolutionSessionController.setTopologyBuildActive(
          adaptiveInitialSettlementOwnerRef.current,
          false,
        );
        publishInitialTopologyReady(true);
        publishInitialTopologyTransitionDiagnostics();
      },
      onCancel: () => {
        highResolutionSessionController.setTopologyBuildActive(
          adaptiveInitialSettlementOwnerRef.current,
          false,
        );
        publishInitialTopologyTransitionDiagnostics();
      },
    });
  initialTopologySettlementRef.current = initialTopologySettlementController;
  automataContextRef.current = automataContext;
  assemblySceneFrameRef.current = assemblySceneFrame;
  playbackSampleRef.current = playback?.sample;
  const geometryCacheRef = useRef(sharedFoundryGeometryCache);
  const materialCacheRef = useRef(sharedFoundryMaterialCache);
  const [rendererStatus, setRendererStatus] = useState<FoundryRendererStatus>("pending");
  const [physicsKernelRuntime, setPhysicsKernelRuntime] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [physicsKernelVersion, setPhysicsKernelVersion] = useState("not-loaded");
  const [physicsKernelError, setPhysicsKernelError] = useState("none");
  const isGearTrain =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const isPlanetaryGear = mechanism.type === "planetary_gear";
  const gearRadii = useMemo(
    () =>
      isGearTrain
        ? gearTrainPitchRadii(mechanism)
        : mechanism.type === "planetary_gear"
          ? planetaryGearRadii(mechanism)
          : [mechanism.crankLength, mechanism.rockerLength],
    [isGearTrain, mechanism],
  );
  const gearCenters = useMemo(
    () =>
      isGearTrain
        ? fittedGearTrainCenters(
            gearRadii,
            simulation.state.p1,
            simulation.state.p2,
          )
        : [],
    [gearRadii, isGearTrain, simulation.state.p1, simulation.state.p2],
  );
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
    () =>
      retainFoundryGestureAnalysis(
        deferMechanismTopology,
        retainedRenderPlanRef,
        () => fabricationRenderPlanForMechanism(mechanism),
      ),
    [deferMechanismTopology, mechanism],
  );
  const physicalValidationErrors = useMemo(
    () =>
      retainFoundryGestureAnalysis(
        deferMechanismTopology,
        retainedValidationRef,
        () => validateMechanismPreviewReadiness(mechanism),
      ),
    [deferMechanismTopology, mechanism],
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
    () => {
      const traces = pathTraces.length
        ? pathTraces
        : [
            {
              id: "output",
              label: "Output path",
              points: pathPoints,
              primary: true,
            },
          ];
      const stride = renderPolicy.interactiveDetail.overlayPointStride;
      if (stride <= 1) return traces;
      return traces.map((trace) => ({
        ...trace,
        points: trace.points.filter(
          (_point, index) =>
            index % stride === 0 || index === trace.points.length - 1,
        ),
      }));
    },
    [pathPoints, pathTraces, renderPolicy.interactiveDetail.overlayPointStride],
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
    if (!showForces) return;
    let active = true;
    setPhysicsKernelRuntime("loading");
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
  }, [showForces]);

  const renderCamera = (
    view: FoundryCamera,
    continuous = false,
    allowInitialShaderSettlement = false,
  ) => {
    if (
      initialShaderSettlementActiveRef.current &&
      !allowInitialShaderSettlement
    ) return;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;
    cam.position.copy(foundryCameraPosition(view));
    cam.lookAt(foundryCameraTarget(view));
    cam.far = Math.max(100, cam.position.distanceTo(foundryCameraTarget(view)) * 3);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    if (continuous && renderPolicy.preset === "high") {
      highResolutionSessionController.recordSubmission(performance.now());
    }
    if (!E2E_DIAGNOSTICS || !stateRef.current) return;
    renderSubmissionCountRef.current += 1;
    stateRef.current.dataset.threeRenderSubmissions = String(
      renderSubmissionCountRef.current,
    );
    stateRef.current.dataset.threeRenderCalls = String(renderer.info.render.calls);
    stateRef.current.dataset.threeRendererGeometryCount = String(
      renderer.info.memory.geometries,
    );
    stateRef.current.dataset.threeRendererTextureCount = String(
      renderer.info.memory.textures,
    );
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
    const objectTargets = new Map<string, FoundryScreenTarget>();
    const partTargets = new Map<string, FoundryScreenTarget>();
    const dynamic = scene.getObjectByName("foundry-dynamic");
    dynamic?.traverse((object) => {
      const sceneObjectId = object.userData.sceneObjectId;
      if (typeof sceneObjectId === "string" && !objectTargets.has(sceneObjectId)) {
        const target = targetForObject("object", sceneObjectId, object);
        if (target) objectTargets.set(sceneObjectId, target);
      }
      const partId = object.userData.partId;
      if (typeof partId === "string" && !partTargets.has(partId)) {
        const target = targetForObject("part", partId, object);
        if (target) partTargets.set(partId, target);
      }
    });
    stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(
      roundedFoundryScreenTargets([...objectTargets.values()]),
    );
    stateRef.current.dataset.threePartScreenTargets = JSON.stringify(
      roundedFoundryScreenTargets([...partTargets.values()]),
    );
    stateRef.current.dataset.threeMechanismScreenTargets = "[]";
    const assemblyBoardObject = scene.getObjectByName(
      "assembly-15x15-board-surface",
    );
    const assemblyBoard =
      assemblyBoardObject?.visible && assemblyBoardObject.parent?.visible
        ? assemblyBoardObject
        : undefined;
    stateRef.current.dataset.threeAssemblyBoardSurface = assemblyBoard
      ? String(assemblyBoard.userData.assemblyBoardSurface ?? "15x15-hole-board")
      : "hidden";
    stateRef.current.dataset.threeAssemblyBoardHoleCount = String(
      assemblyBoard?.userData.assemblyBoardHoleCount ?? 0,
    );
    const assemblyBoardHoles = assemblyBoard?.getObjectByName(
      "assembly-board-z0-holes-instanced",
    );
    stateRef.current.dataset.threeAssemblyBoardInstanceCount = String(
      assemblyBoardHoles instanceof THREE.InstancedMesh
        ? assemblyBoardHoles.count
        : 0,
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
    if (E2E_DIAGNOSTICS && onAutomataSceneObjectSelect && stateRef.current) {
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
    if (E2E_DIAGNOSTICS && onAutomataPartSelect && stateRef.current) {
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
        new THREE.Plane(
          new THREE.Vector3(0, 0, 1),
          -FOUNDRY_WORK_PLANE_Z,
        ),
        hit,
      )
    )
      return;
    onAnchorPick(
      foundryPreviewToScenePoint({
        x: FOUNDRY_PREVIEW_WIDTH / 2 + hit.x * 18,
        y: FOUNDRY_PREVIEW_HEIGHT / 2 - hit.y * 18,
      }),
    );
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    cancelInitialTopologySettlement();
    publishInitialTopologyReady(false);
    initialShaderSettlementActiveRef.current = true;
    setRendererStatus("pending");
    let cancelInitialShaderSettlement: () => void = () => undefined;
    let restartInitialShaderSettlement: () => void = () => undefined;
    let rendererLease;
    try {
      rendererLease = acquireSharedWebGLRenderer({
        antialias: renderPolicy.antialias,
        alpha: true,
      });
    } catch (error) {
      initialShaderSettlementActiveRef.current = false;
      console.warn("ThreeFoundryPreview WebGL unavailable", error);
      setRendererStatus("unavailable");
      return;
    }
    const renderer = rendererLease.renderer;
    renderer.shadowMap.enabled = false;
    renderer.domElement.className = "foundry-three-canvas";
    if (E2E_DIAGNOSTICS) renderer.domElement.dataset.testid = "foundry-three-canvas";
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      cancelInitialShaderSettlement();
      initialShaderSettlementActiveRef.current = true;
      setRendererStatus("restoring");
      if (renderPolicy.preset === "high") {
        highResolutionSessionController.recordContextLoss();
      }
    };
    const handleContextRestored = () => {
      rendererResizeRef.current?.();
      restartInitialShaderSettlement();
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);
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
    staticRoot.visible = showGrid;
    const grid = new THREE.GridHelper(24, 24, "#c7d2fe", "#e2e8f0");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.9;
    grid.visible = false;
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
    plane.visible = false;
    staticRoot.add(plane);
    scene.add(staticRoot);
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = cam;
    const unregisterCapture = registerCanvasCapture(renderer.domElement, () => {
      if (renderer.getContext().isContextLost()) throw new Error('Scene unavailable');
      renderer.render(scene, cam);
    });
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const reportedProjectionSize = reportedProjectionSizeRef.current;
      if (
        !reportedProjectionSize ||
        Math.abs(reportedProjectionSize.width - width) >= 1 ||
        Math.abs(reportedProjectionSize.height - height) >= 1
      ) {
        reportedProjectionSizeRef.current = { width, height };
        onProjectionSizeChange({ width, height });
      }
      const viewportSize = { width, height };
      if (renderPolicy.preset === "high") {
        highResolutionSessionController.setAvailableCap(
          rendererEffectivePixelRatio(renderer, renderPolicy, viewportSize),
        );
      }
      const requestedCap = renderPolicy.preset === "high"
        ? highResolutionSessionController.snapshot().requestedCap
        : renderPolicy.pixelRatioCap;
      const effectiveDpr = resizeRendererToPerformancePolicy(
        renderer,
        renderPolicy,
        viewportSize,
        requestedCap,
      );
      effectiveDprRef.current = effectiveDpr;
      requestedDprCapRef.current = requestedCap;
      renderer.domElement.dataset.threeEffectiveDpr = effectiveDpr.toFixed(3);
      renderer.domElement.dataset.threeRequestedDprCap = requestedCap.toFixed(2);
      if (stateRef.current) {
        stateRef.current.dataset.threeEffectiveDpr = effectiveDpr.toFixed(3);
        stateRef.current.dataset.threeRequestedDprCap = requestedCap.toFixed(2);
      }
      if (host.parentElement) {
        host.parentElement.dataset.threeEffectiveDpr = effectiveDpr.toFixed(3);
        host.parentElement.dataset.threeRequestedDprCap = requestedCap.toFixed(2);
      }
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
      renderCamera(cameraStateRef.current);
    };
    rendererResizeRef.current = resize;
    resize();
    const unsubscribeAdaptive = renderPolicy.preset === "high"
      ? highResolutionSessionController.subscribe(() => {
          if (!renderer.getContext().isContextLost()) resize();
        })
      : undefined;
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    window.addEventListener("resize", resize);
    const shaderSettlementSteps = foundryInitialShaderSettlementSteps();
    const renderShaderSettlementStep = (
      step: FoundryInitialShaderSettlementStep,
    ) => {
      grid.visible = step.gridLines;
      plane.visible = step.workSurface;
      renderCamera(cameraStateRef.current, false, true);
    };
    restartInitialShaderSettlement = () => {
      cancelInitialShaderSettlement();
      initialShaderSettlementActiveRef.current = true;
      grid.visible = false;
      plane.visible = false;
      const [firstShaderFamily, ...remainingShaderFamilies] =
        shaderSettlementSteps;
      if (!firstShaderFamily) return;
      renderShaderSettlementStep(firstShaderFamily);
      if (renderer.getContext().isContextLost()) return;
      cancelInitialShaderSettlement = scheduleIncrementalTopologyBuild(
        remainingShaderFamilies,
        renderShaderSettlementStep,
        {
          maxItemsPerFrame: 1,
          frameBudgetMs: 4,
          onComplete: () => {
            if (renderer.getContext().isContextLost()) return;
            initialShaderSettlementActiveRef.current = false;
            setRendererStatus("webgl");
          },
        },
      );
    };
    restartInitialShaderSettlement();
    return () => {
      cancelInitialShaderSettlement();
      unregisterCapture();
      initialShaderSettlementActiveRef.current = false;
      ro.disconnect();
      unsubscribeAdaptive?.();
      cancelInitialTopologySettlement();
      publishInitialTopologyReady(false);
      rendererResizeRef.current = null;
      highResolutionSessionController.setTopologyBuildActive(
        adaptiveTopologyOwnerRef.current,
        false,
      );
      window.removeEventListener("resize", resize);
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      renderDynamicRef.current = null;
      const dynamicRoot = scene.getObjectByName("foundry-dynamic");
      if (dynamicRoot instanceof THREE.Group)
        disposeFoundryAssemblyOverlayRuntime(dynamicRoot);
      disposeFoundryThreeObject(scene);
      pruneUnusedThreeResourceCache(
        geometryCacheRef.current,
        new Set(),
        renderPolicy.repeatedGeometry.maxGeometryCacheEntries,
      );
      pruneUnusedThreeResourceCache(
        materialCacheRef.current,
        new Set(),
        renderPolicy.repeatedGeometry.maxMaterialCacheEntries,
      );
      primitivePoolRef.current = null;
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
      if (renderer.domElement.parentElement === host)
        host.removeChild(renderer.domElement);
      rendererLease.release();
    };
  }, [renderPolicy]);

  const renderCameraRef = useRef(renderCamera);
  renderCameraRef.current = renderCamera;

  useEffect(
    () => transientCamera?.subscribe((view) => {
      cameraStateRef.current = view;
      // Sparse pointer events are not a continuous playback cadence window.
      renderCameraRef.current(view);
    }),
    [transientCamera],
  );

  const cameraGestureActive = isOrbiting || isZooming || isPanning;
  useEffect(() => {
    const root = hostRef.current?.parentElement;
    if (!root) return;
    const overlays = root.querySelectorAll<HTMLElement>(
      ".foundry-preview-overlay",
    );
    overlays.forEach((overlay) => {
      overlay.style.visibility = cameraGestureActive ? "hidden" : "";
    });
    return () => {
      overlays.forEach((overlay) => {
        overlay.style.visibility = "";
      });
    };
  }, [cameraGestureActive, children]);

  useEffect(() => {
    const previousCamera = cameraStateRef.current;
    cameraStateRef.current = camera;
    if (previousCamera === camera) return;
    renderCamera(camera);
  }, [camera]);

  useEffect(() => {
    const scene = sceneRef.current;
    const staticRoot = scene?.getObjectByName("foundry-static");
    if (!staticRoot) return;
    if (staticRoot.visible === showGrid) return;
    staticRoot.visible = showGrid;
    renderCamera(cameraStateRef.current);
  }, [showGrid]);

  const pruneFoundryResourceCaches = (root: THREE.Object3D) => {
    if (
      geometryCacheRef.current.size <=
        renderPolicy.repeatedGeometry.maxGeometryCacheEntries &&
      materialCacheRef.current.size <=
        renderPolicy.repeatedGeometry.maxMaterialCacheEntries
    )
      return;
    const usage = collectThreeObjectResourceUsage(root);
    pruneUnusedThreeResourceCache(
      geometryCacheRef.current,
      usage.geometries,
      renderPolicy.repeatedGeometry.maxGeometryCacheEntries,
    );
    pruneUnusedThreeResourceCache(
      materialCacheRef.current,
      usage.materials,
      renderPolicy.repeatedGeometry.maxMaterialCacheEntries,
    );
  };

  const renderDynamicScene = (frame: FoundryRenderFrame) => {
    if (initialShaderSettlementActiveRef.current) return;
    const { simulation } = frame;
    const initialTopologySettlement = frame.initialTopologySettlement;
    const measureSubmissionInterval = shouldRecordAdaptiveSubmission(
      frame.measureSubmissionInterval,
    );
    const activeMechanism = frame.mechanism ?? mechanism;
    const activeDeferMechanismTopology =
      frame.deferMechanismTopology ?? deferMechanismTopology;
    const activeAutomataContext =
      frame.automataContext ?? automataContextRef.current;
    const activeAssemblySceneFrame =
      frame.assemblySceneFrame ?? assemblySceneFrameRef.current;
    const activeExplode = frame.explode ?? explode;
    const frameStackLayerZ = renderPlan.layers.map(
      (item) =>
        item.z +
        activeExplode *
          item.stackIndex *
          FABRICATION_RENDER_LAYER_Z_STEP *
          1.5,
    );
    const frameGearMeshPlaneZ =
      (isGearTrain || isPlanetaryGear) &&
      activeExplode <= 0 &&
      gearLayerIndexes.length
        ? frameStackLayerZ[gearLayerIndexes[0]]
        : undefined;
    const frameRenderedLayerZ = foundryRenderedLayerZForMechanism(
      activeMechanism.type,
      renderPlan.layers,
      frameStackLayerZ,
      frameGearMeshPlaneZ,
    );
    const frameLocalSpacerZsForPin = (pin: FoundryPinStackPoint) =>
      foundryLocalSpacerZsForPin(
        activeMechanism.type,
        pin,
        frameRenderedLayerZ,
        renderPlan.layers,
      );
    const frameLocalSpacerZForPin = (
      pin: FoundryPinStackPoint,
      spacerLayerIndex?: number,
    ) =>
      foundryLocalSpacerZForPin(
        activeMechanism.type,
        pin,
        frameRenderedLayerZ,
        renderPlan.layers,
        spacerLayerIndex,
      );
    const frameGearCenters = isGearTrain
      ? fittedGearTrainCenters(
          gearRadii,
          simulation.state.p1,
          simulation.state.p2,
        )
      : [];
    const frameAssemblyPinPoints = isGearTrain
      ? activeMechanism.type === "gear_linkage"
        ? [
            ...frameGearCenters,
            simulation.state.j1,
            simulation.state.j2,
            simulation.state.effector,
          ].filter((point): point is Point => Boolean(point))
        : frameGearCenters
      : foundryAssemblyPinPoints(activeMechanism.type, simulation.state);
    const framePinStackPoints = foundryPinStackPoints(
      activeMechanism.type,
      frameAssemblyPinPoints,
      movingLayerIndexes,
      spacerLayerIndexes,
    );
    const framePinStacks = foundryPinStacks(
      framePinStackPoints,
      frameRenderedLayerZ,
      {
        includeSpacerZ: usesLocalSpacerPins,
        spacerZForPin: frameLocalSpacerZsForPin,
      },
    );
    const framePinBottomZ = framePinStacks.length
      ? Math.min(...framePinStacks.map((pin) => pin.bottomZ))
      : (frameRenderedLayerZ[0] ?? 0.22) - 0.08;
    const framePinTopZ = framePinStacks.length
      ? Math.max(...framePinStacks.map((pin) => pin.topZ))
      : (frameRenderedLayerZ.at(-1) ?? 0.22) + 0.18;
    const framePathLayerZ = framePinTopZ + 0.08;
    const framePinionRotation = simulation.driveAngleDeg;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const cam = cameraRef.current;
    if (!scene || !renderer || !cam) return;

    let root = scene.getObjectByName("foundry-dynamic") as THREE.Group | undefined;
    if (!root) {
      root = new THREE.Group();
      root.name = "foundry-dynamic";
      scene.add(root);
    }
    let mechanismRoot = root.getObjectByName(
      "foundry-mechanism-runtime",
    ) as THREE.Group | undefined;
    if (!mechanismRoot) {
      mechanismRoot = new THREE.Group();
      mechanismRoot.name = "foundry-mechanism-runtime";
      root.add(mechanismRoot);
    }
    if (
      !primitivePoolRef.current ||
      primitivePoolRef.current.root !== mechanismRoot
    ) {
      primitivePoolRef.current = new FoundryThreeObjectPool(
        mechanismRoot,
        disposeFoundryThreeObject,
        renderPolicy.repeatedGeometry.maxPoolEntries,
      );
    }
    const objectPool = primitivePoolRef.current;
    const initialTopologyKey = foundryInitialTopologyKey({
      mechanism: activeMechanism,
      renderPlan,
      kit,
      partTopology: renderPolicy.partTopology,
      automataContext: activeAutomataContext,
      assemblySceneFrame: activeAssemblySceneFrame,
      pinStackCount: framePinStacks.length,
      physicalValidationSummary,
    });
    const initialTopologyValid =
      renderPlan.validationErrors.length === 0 &&
      physicalValidationErrors.length === 0;
    if (!initialTopologySettlement && !initialTopologyValid) {
      initialTopologySettlementController.cancel();
    } else if (
      !initialTopologySettlement &&
      (initialTopologySettlementController.isActive() ||
        !initialTopologyCompleteRef.current ||
        completedInitialTopologyKeyRef.current !== initialTopologyKey)
    ) {
      initialTopologySettlementController.update(
        initialTopologyKey,
        frame,
        foundryInitialTopologySettlementSteps(
          renderPlan.layers.length,
          framePinStacks.length,
        ),
      );
      publishInitialTopologyTransitionDiagnostics();
      return;
    }
    objectPool.beginFrame();
    const topologyRevisionBefore = objectPool.topologyRevision;
    if (renderPlan.validationErrors.length || physicalValidationErrors.length) {
      objectPool.endFrame();
      const assemblyLayer = root.getObjectByName(
        "assembly-scene-contract-overlay",
      );
      if (assemblyLayer) assemblyLayer.visible = false;
      const automataLayer = root.getObjectByName("foundry-automata-context");
      if (automataLayer) automataLayer.visible = false;
      pruneFoundryResourceCaches(root);
      renderCamera(cameraStateRef.current, measureSubmissionInterval);
      if (E2E_DIAGNOSTICS && stateRef.current) {
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
      if (!initialTopologySettlement) publishInitialTopologyReady(true);
      return;
    }
    const primitives = createFoundryThreePrimitiveFactory({
      geometryCache: geometryCacheRef.current,
      materialCache: materialCacheRef.current,
      mechanism: activeMechanism,
      kit,
      color,
      rigOpacity,
      baseColor: renderPlan.base.color,
      simulationScale: simulation.scale,
      objectPool,
      edgeGeometryEnabled: renderPolicy.partTopology.edgeGeometryEnabled,
      bevelEnabled: renderPolicy.partTopology.bevelEnabled,
      curveSegments: renderPolicy.partTopology.curveSegments,
      deferBarTopologyChanges: activeDeferMechanismTopology,
    });
    const includeCanonicalSceneContexts =
      !initialTopologySettlement || initialTopologySettlement.complete;
    renderFoundryDynamicLayers({
      mechanism: activeMechanism,
      simulation,
      primitives,
      renderPlan,
      renderedLayerZ: frameRenderedLayerZ,
      pinStacks: framePinStacks,
      localSpacerZForPin: frameLocalSpacerZForPin,
      visiblePathTraces,
      pathLayerZ: framePathLayerZ,
      showPathPreview,
      showTrail,
      pinionRotation: framePinionRotation,
      isGearTrain,
      gearRadii,
      gearCenters: frameGearCenters,
      gearUsesMeshPhases,
      gearOutputRatioForDisplay,
      assemblySceneFrame: includeCanonicalSceneContexts
        ? activeAssemblySceneFrame
        : undefined,
      initialTopologySettlement,
    });
    objectPool.endFrame();
    const assemblyTopologyChanged = renderFoundryAssemblySceneOverlay({
      root,
      frame: includeCanonicalSceneContexts
        ? activeAssemblySceneFrame
        : undefined,
      mechanism: activeMechanism,
      simulation,
      kit,
      pinBottomZ: framePinBottomZ,
      pinTopZ: framePinTopZ,
      pathLayerZ: framePathLayerZ,
      pathPoints,
      resourcePolicy: renderPolicy.repeatedGeometry,
    });
    const automataTopologyChanged = renderFoundryAutomataContext({
      root,
      context: includeCanonicalSceneContexts
        ? activeAutomataContext
        : undefined,
      assemblySceneFrame: includeCanonicalSceneContexts
        ? activeAssemblySceneFrame
        : undefined,
      geometryCache: geometryCacheRef.current,
      materialCache: materialCacheRef.current,
      onLoaded: () => renderCamera(cameraStateRef.current),
      baseZ: framePinTopZ + 0.16,
      maxPathLinePoints: renderPolicy.interactiveDetail.maxPathLinePoints,
      partTopology: renderPolicy.partTopology,
    });
    pruneFoundryResourceCaches(root);

    const requestedFit = cameraFitRef.current;
    if (requestedFit && requestedFit !== completedCameraFitRef.current &&
        includeCanonicalSceneContexts && activeAutomataContext?.showCharacter) {
      const content = root.getObjectByName("foundry-automata-context");
      const contentBounds = content ? visibleObjectBounds(content) : new THREE.Box3();
      const bounds = requestedFit.scope === "scene" || contentBounds.isEmpty()
        ? visibleObjectBounds(scene) : contentBounds;
      if (requestedFit.scope === "scene") {
        const sheet = sceneBoundsForSheet(kit);
        // The workbench grid can be CSS-backed; use its existing physical-kit
        // extent even when the retained Three board surface is hidden.
        [sheet, { x: sheet.x + sheet.width, y: sheet.y + sheet.height },
          boardToScene(0, 0, kit), boardToScene(kit.boardCells - 1, kit.boardCells - 1, kit)]
          .forEach(point => bounds.expandByPoint(sceneTo3(point)));
      }
      if (!bounds.isEmpty()) {
        completedCameraFitRef.current = requestedFit;
        onCameraFitRef.current?.(fitWorkingPreviewCamera(cameraStateRef.current, bounds, cam.aspect,
          hostRef.current ? workingPreviewFrame(hostRef.current) : undefined));
      }
    }

    const topologyChanged =
      objectPool.topologyRevision !== topologyRevisionBefore ||
      assemblyTopologyChanged ||
      automataTopologyChanged;
    if (topologyChanged) {
      dynamicBuildCountRef.current += 1;
      recordFoundryTopologyBuild(
        geometryCacheRef.current.size,
        materialCacheRef.current.size,
      );
    }
    const publishFoundryE2EDiagnosticsAfterRender = () => {
      if (!E2E_DIAGNOSTICS || !stateRef.current) return;
      const visiblePartIds =
        activeAutomataContext?.showCharacter
          ? activeAutomataContext.project.partOrder.filter(
              (id) =>
                (activeAutomataContext.animatedParts?.[id] ??
                  activeAutomataContext.project.parts[id])?.visible,
            )
          : [];
      const visibleObjectIds =
        activeAutomataContext?.showCharacter
          ? activeAutomataContext.project.sceneObjectOrder.filter(
              (id) =>
                (activeAutomataContext.animatedSceneObjects?.[id] ??
                  activeAutomataContext.project.sceneObjects[id])?.visible,
            )
          : [];
      const visiblePartArtIds = visiblePartIds.filter(
        (id) => Boolean(activeAutomataContext?.project.parts[id]?.textureUrl),
      );
      stateRef.current.dataset.threeDynamicBuildCount = String(
        dynamicBuildCountRef.current,
      );
      stateRef.current.dataset.threePoolSize = String(
        objectPool.retainedObjectCount,
      );
      stateRef.current.dataset.threeRendererGeometryCount = String(
        renderer.info.memory.geometries,
      );
      stateRef.current.dataset.threeRendererTextureCount = String(
        renderer.info.memory.textures,
      );
      stateRef.current.dataset.threeGeometryCacheSize = String(
        geometryCacheRef.current.size,
      );
      stateRef.current.dataset.threeMaterialCacheSize = String(
        materialCacheRef.current.size,
      );
      stateRef.current.dataset.threeAutomataContext =
        activeAutomataContext?.showCharacter ? "shown" : "absent";
      stateRef.current.dataset.threeWorkingPhase = String(simulation.inputAngleRad);
      const automataRoot = root.getObjectByName("foundry-automata-context");
      stateRef.current.dataset.threeAutomataPaths = JSON.stringify(
        automataRoot?.children.filter(object => object.visible && object.name.startsWith("foundry-automata-path-"))
          .map(object => {
            const line = object as THREE.Line<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
            const points = line.geometry.getAttribute("position");
            return { id: line.name.slice("foundry-automata-path-".length), points: points.count,
              color: line.material.color.getHexString(), opacity: line.material.opacity };
          }) ?? [],
      );
      stateRef.current.dataset.threeAutomataPartTransforms = JSON.stringify(
        automataRoot?.children.filter(object => object.visible && object.userData.partId)
          .map(object => ({ id: object.userData.partId, position: object.position.toArray(),
            rotation: object.rotation.z, scale: object.scale.toArray() })) ?? [],
      );
      stateRef.current.dataset.threeWorkingMechanismTransforms = JSON.stringify(
        mechanismRoot.children.filter(object => object.visible).slice(0, 24).map(object => ({
          position: object.position.toArray(), rotation: object.rotation.toArray().slice(0, 3),
          scale: object.scale.toArray(), vertices: (object as THREE.Mesh).geometry?.getAttribute("position")?.count ?? 0,
        })),
      );
      stateRef.current.dataset.partCount = String(visiblePartIds.length);
      stateRef.current.dataset.sceneObjectCount = String(visibleObjectIds.length);
      stateRef.current.dataset.selectedPartId =
        activeAutomataContext?.project.selectedPartId ?? "";
      stateRef.current.dataset.selectedSceneObjectId =
        activeAutomataContext?.project.selectedSceneObjectId ?? "";
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
      const fallbackScreenTarget = (
        kind: FoundryScreenTarget["kind"],
        id: string,
        point: Point,
      ): FoundryScreenTarget | null => {
        const renderer = rendererRef.current;
        const cam = cameraRef.current;
        if (!renderer || !cam) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        const projected = sceneTo3(point, framePinTopZ + 0.16).project(cam);
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
      stateRef.current.dataset.threeSceneObjectScreenTargets = JSON.stringify(
        roundedFoundryScreenTargets(
          visibleObjectIds
            .map((id) =>
              fallbackScreenTarget(
                "object",
                id,
                (activeAutomataContext?.animatedSceneObjects?.[id] ??
                  activeAutomataContext?.project.sceneObjects[id])?.transform ?? { x: 0, y: 0 },
              ),
            )
            .filter((target): target is FoundryScreenTarget => Boolean(target)),
        ),
      );
      stateRef.current.dataset.threePartScreenTargets = JSON.stringify(
        roundedFoundryScreenTargets(
          visiblePartIds
            .map((id) =>
              fallbackScreenTarget(
                "part",
                id,
                (activeAutomataContext?.animatedParts?.[id] ??
                  activeAutomataContext?.project.parts[id])?.transform ?? { x: 0, y: 0 },
              ),
            )
            .filter((target): target is FoundryScreenTarget => Boolean(target)),
        ),
      );
      stateRef.current.dataset.threeMechanismScreenTargets = "[]";
      const assemblyBoardObject = scene.getObjectByName(
        "assembly-15x15-board-surface",
      );
      const assemblyBoard =
        assemblyBoardObject?.visible && assemblyBoardObject.parent?.visible
          ? assemblyBoardObject
          : undefined;
      stateRef.current.dataset.threeAssemblyBoardSurface = assemblyBoard
        ? String(assemblyBoard.userData.assemblyBoardSurface ?? "15x15-hole-board")
        : "hidden";
      stateRef.current.dataset.threeAssemblyBoardHoleCount = String(
        assemblyBoard?.userData.assemblyBoardHoleCount ?? 0,
      );
      const assemblyBoardHoles = assemblyBoard?.getObjectByName(
        "assembly-board-z0-holes-instanced",
      );
      stateRef.current.dataset.threeAssemblyBoardInstanceCount = String(
        assemblyBoardHoles instanceof THREE.InstancedMesh
          ? assemblyBoardHoles.count
          : 0,
      );
      stateRef.current.dataset.threeAssemblyBoardZ = assemblyBoard
        ? Number(assemblyBoard.userData.assemblyBoardZ ?? 0).toFixed(2)
        : "";
    };
    if (topologyChanged && renderPolicy.preset === "high") {
      highResolutionSessionController.setTopologyBuildActive(
        adaptiveTopologyOwnerRef.current,
        true,
      );
    }
    try {
      renderCamera(cameraStateRef.current, measureSubmissionInterval);
    } finally {
      if (topologyChanged && renderPolicy.preset === "high") {
        highResolutionSessionController.setTopologyBuildActive(
          adaptiveTopologyOwnerRef.current,
          false,
        );
      }
    }
    publishFoundryE2EDiagnosticsAfterRender();
  };
  renderDynamicRef.current = renderDynamicScene;

  useEffect(
    () =>
      transientFrame?.subscribe((frame) => {
        recordFoundryGestureVisualEmission();
        renderDynamicRef.current?.(frame);
      }),
    [transientFrame],
  );

  useLayoutEffect(() => {
    if (rendererStatus !== "webgl") return;
    if (transientFrame?.isActive()) return;
    const nextFrame = {
      simulation,
      automataContext,
      assemblySceneFrame,
    };
    if (initialTopologySettlementController.isActive()) {
      renderDynamicRef.current?.(nextFrame);
      return;
    }
    if (deferMechanismTopology) {
      if (transientFrame) return;
      renderDynamicRef.current?.(nextFrame);
      return;
    }
    const frame = requestAnimationFrame(() => {
      renderDynamicRef.current?.(nextFrame);
    });
    return () => cancelAnimationFrame(frame);
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
    automataContext,
    renderPolicy,
    rendererStatus,
    deferMechanismTopology,
    transientFrame,
    cameraFit,
  ]);

  const playbackClock = playback?.clock;
  const playbackMinFrameIntervalMs =
    playback?.minFrameIntervalMs ?? renderPolicy.minRenderIntervalMs;
  useEffect(() => {
    if (!playbackClock) {
      if (renderPolicy.preset === "high") {
        highResolutionSessionController.resetSubmissionWindow();
      }
      return;
    }
    if (renderPolicy.preset === "high") {
      highResolutionSessionController.resetSubmissionWindow();
    }
    const unsubscribe = subscribeCadencedPlaybackSampler({
      clock: playbackClock,
      sample: (phase) => playbackSampleRef.current?.(phase),
      minFrameIntervalMs: playbackMinFrameIntervalMs,
      earlyToleranceMs: renderPolicy.preset === "high"
        ? HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS
        : 0,
      sampleInitial: false,
      apply: (frame) =>
        renderDynamicRef.current?.({
          ...frame,
          measureSubmissionInterval: true,
        }),
    });
    return () => {
      unsubscribe();
      if (renderPolicy.preset === "high") {
        highResolutionSessionController.resetSubmissionWindow();
      }
    };
  }, [playbackClock, playbackMinFrameIntervalMs, renderPolicy.preset]);

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
      data-layer-character={viewer3DLayerDataValue(automataContext?.showCharacter ? true : undefined)}
      data-layer-skeleton={viewer3DLayerDataValue(automataContext?.showSkeleton ? true : undefined)}
      data-layer-paths={viewer3DLayerDataValue(showPathPreview)}
      data-layer-forces={viewer3DLayerDataValue(showForces)}
      data-layer-velocity={viewer3DLayerDataValue(showVelocity)}
      data-layer-trail={viewer3DLayerDataValue(showTrail)}
      data-three-renderer-status={rendererStatus}
      data-three-topology-ready={
        initialTopologyCompleteRef.current ? "true" : "false"
      }
      data-three-effective-dpr={effectiveDprRef.current.toFixed(3)}
      data-three-requested-dpr-cap={requestedDprCapRef.current.toFixed(2)}
    >
      <div ref={hostRef} className="foundry-three-host" />
      {rendererStatus !== "pending" && rendererStatus !== "webgl" && (
        <div
          className="three-renderer-status"
          data-testid="foundry-renderer-status"
          role="status"
        >
          {rendererStatus === "restoring" ? "Restoring 3D…" : "3D unavailable"}
        </div>
      )}
      {E2E_DIAGNOSTICS && <FoundryPreviewStateProbe
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
        renderPolicy={renderPolicy}
        effectiveDpr={effectiveDprRef.current}
        requestedDprCap={requestedDprCapRef.current}
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
      />}
      {children}
    </div>
  );
};

import * as THREE from "three";

import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import { boardToScene, SCENE_VIEW } from "../../../utils/coordinates";
import type { FabricationRenderPlan } from "../../../utils/fabrication";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import type { AssemblySceneFrame } from "../../../utils/assemblySceneFrame";
import {
  cachedThreeResource,
  collectThreeObjectResourceUsage,
  pruneUnusedThreeResourceCache,
} from "../../../utils/threeResourceKit";
import type { RepeatedGeometryPolicy } from "../../../utils/renderPerformancePolicy";
import {
  FOUNDRY_CACHE_MARKER,
  disposeFoundryThreeObject,
} from "./foundryThreePrimitives";
import { FoundryThreeObjectPool } from "./foundryThreeObjectPool";

export type FoundryAssemblySceneFrame = AssemblySceneFrame;

type FoundryAssemblyLayerLike = FabricationRenderPlan["layers"][number];

type FoundryAssemblyLayerState = {
  focused: boolean;
  opacity: number;
  color: string;
};

type FoundryAssemblySceneOverlayOptions = {
  root: THREE.Group;
  frame?: AssemblySceneFrame;
  mechanism: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  kit: PhysicalKitSettings;
  pinBottomZ: number;
  pinTopZ: number;
  pathLayerZ: number;
  pathPoints: Point[];
  resourcePolicy: RepeatedGeometryPolicy;
};

const ACTIVE_COLOR = "#8b5cf6";
const BOARD_COLOR = "#7c3aed";
const BOARD_SURFACE_COLOR = "#eef2ff";
const FLOATING_COLOR = "#c4b5fd";
const FOUNDRY_PREVIEW_WIDTH = 360;
const FOUNDRY_PREVIEW_HEIGHT = 240;
const SCENE_TO_FOUNDRY_SCALE = Math.min(
  FOUNDRY_PREVIEW_WIDTH / SCENE_VIEW.width,
  FOUNDRY_PREVIEW_HEIGHT / SCENE_VIEW.height,
);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenSet = (value: string) =>
  new Set(normalize(value).split(" ").filter(Boolean));

const sharesSpecificToken = (a: string, b: string) => {
  const generic = new Set([
    "the",
    "a",
    "an",
    "part",
    "board",
    "hole",
    "linkage",
    "gear",
    "spacer",
  ]);
  const bTokens = tokenSet(b);
  return [...tokenSet(a)].some(
    (token) => token.length > 1 && !generic.has(token) && bTokens.has(token),
  );
};

const textMatches = (candidate: string, target: string) => {
  const c = normalize(candidate);
  const t = normalize(target);
  if (!c || !t) return false;
  return c.includes(t) || t.includes(c) || sharesSpecificToken(c, t);
};

export const foundryAssemblyLayerState = (
  frame: AssemblySceneFrame | undefined,
  layer: FoundryAssemblyLayerLike,
): FoundryAssemblyLayerState => {
  if (!frame || frame.kind !== "mechanism") {
    return { focused: false, opacity: 0.66, color: layer.color };
  }
  const activeParts = frame.visibleParts.filter((part) => part.active);
  if (
    !activeParts.length ||
    frame.motion === "mount_travel_xy" ||
    frame.motion === "scrub_time"
  ) {
    return { focused: false, opacity: 0.72, color: layer.color };
  }
  const focused = activeParts.some(
    (part) =>
      textMatches(layer.label, part.label) ||
      textMatches(layer.role, part.role) ||
      textMatches(layer.renderKind, part.role),
  );
  return {
    focused,
    opacity: focused ? 0.98 : 0.24,
    color: focused ? ACTIVE_COLOR : layer.color,
  };
};

export const foundryAssemblyLayerFocusSummary = (
  frame: AssemblySceneFrame | undefined,
  layers: FoundryAssemblyLayerLike[],
) =>
  frame?.kind === "mechanism"
    ? layers
        .map((layer, index) =>
          foundryAssemblyLayerState(frame, layer).focused ? String(index) : "-",
        )
        .filter((value) => value !== "-")
        .join(",")
    : "";

const boardCoordToScenePoint = (
  coord: string,
  kit: PhysicalKitSettings,
): Point | null => {
  const match = /^([A-Z])([1-9]|1[0-5])$/i.exec(coord.trim());
  if (!match) return null;
  const col = match[1].toUpperCase().charCodeAt(0) - 65;
  const row = Number(match[2]) - 1;
  if (col < 0 || row < 0 || col >= kit.boardCells || row >= kit.boardCells)
    return null;
  return boardToScene(col, row, kit);
};

const boardCoordToPreviewPoint = (
  coord: string,
  kit: PhysicalKitSettings,
  mechanism: MechanismConfig,
  simulation: MechanismPreviewSimulation,
): Point | null => {
  const scenePoint = boardCoordToScenePoint(coord, kit);
  if (!scenePoint) return null;
  const origin = {
    x: mechanism.anchorX ?? 0,
    y: mechanism.anchorY ?? 0,
  };
  return {
    x: simulation.state.p1.x + (scenePoint.x - origin.x) * simulation.scale,
    y: simulation.state.p1.y - (scenePoint.y - origin.y) * simulation.scale,
  };
};

const scenePointToPreviewPoint = (point: Point): Point => ({
  x: FOUNDRY_PREVIEW_WIDTH / 2 + point.x * SCENE_TO_FOUNDRY_SCALE,
  y: FOUNDRY_PREVIEW_HEIGHT / 2 - point.y * SCENE_TO_FOUNDRY_SCALE,
});

const previewPointToThree = (point: Point, z = 0) =>
  new THREE.Vector3((point.x - 180) / 18, (120 - point.y) / 18, z);

const boardPreviewPoints = (kit: PhysicalKitSettings) => {
  const points: Point[] = [];
  for (let row = 0; row < kit.boardCells; row += 1) {
    for (let col = 0; col < kit.boardCells; col += 1) {
      points.push(scenePointToPreviewPoint(boardToScene(col, row, kit)));
    }
  }
  return points;
};

type FoundryAssemblyOverlayRuntime = {
  overlay: THREE.Group;
  pool: FoundryThreeObjectPool;
  geometryCache: Map<string, THREE.BufferGeometry>;
  materialCache: Map<string, THREE.Material>;
  resourcePolicy: RepeatedGeometryPolicy;
};

const overlayRuntimes = new WeakMap<THREE.Group, FoundryAssemblyOverlayRuntime>();

const overlayRuntime = (
  root: THREE.Group,
  resourcePolicy: RepeatedGeometryPolicy,
) => {
  const existing = overlayRuntimes.get(root);
  if (existing) return existing;
  const overlay = new THREE.Group();
  overlay.name = "assembly-scene-contract-overlay";
  root.add(overlay);
  const runtime: FoundryAssemblyOverlayRuntime = {
    overlay,
    pool: new FoundryThreeObjectPool(
      overlay,
      disposeFoundryThreeObject,
      resourcePolicy.maxPoolEntries,
    ),
    geometryCache: new Map(),
    materialCache: new Map(),
    resourcePolicy,
  };
  overlayRuntimes.set(root, runtime);
  return runtime;
};

const pruneOverlayResourceCaches = (
  runtime: FoundryAssemblyOverlayRuntime,
) => {
  if (
    runtime.geometryCache.size <=
      runtime.resourcePolicy.maxGeometryCacheEntries &&
    runtime.materialCache.size <=
      runtime.resourcePolicy.maxMaterialCacheEntries
  )
    return;
  const usage = collectThreeObjectResourceUsage(runtime.overlay);
  pruneUnusedThreeResourceCache(
    runtime.geometryCache,
    usage.geometries,
    runtime.resourcePolicy.maxGeometryCacheEntries,
  );
  pruneUnusedThreeResourceCache(
    runtime.materialCache,
    usage.materials,
    runtime.resourcePolicy.maxMaterialCacheEntries,
  );
};

const cachedGeometry = <T extends THREE.BufferGeometry>(
  runtime: FoundryAssemblyOverlayRuntime,
  key: string,
  create: () => T,
) =>
  cachedThreeResource(
    runtime.geometryCache,
    key,
    create,
    FOUNDRY_CACHE_MARKER,
  );

const cachedMaterial = <T extends THREE.Material>(
  runtime: FoundryAssemblyOverlayRuntime,
  key: string,
  create: () => T,
) =>
  cachedThreeResource(
    runtime.materialCache,
    key,
    create,
    FOUNDRY_CACHE_MARKER,
  );

const standardMaterial = (
  runtime: FoundryAssemblyOverlayRuntime,
  color: string,
  opacity = 0.92,
) =>
  cachedMaterial(runtime, `standard:${color}:${opacity.toFixed(2)}`, () =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.54,
      metalness: 0.04,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity > 0.5,
    }),
  );

const lineMaterial = (
  runtime: FoundryAssemblyOverlayRuntime,
  opacity: number,
) =>
  cachedMaterial(runtime, `line:${ACTIVE_COLOR}:${opacity.toFixed(2)}`, () =>
    new THREE.LineBasicMaterial({
      color: ACTIVE_COLOR,
      transparent: true,
      opacity,
    }),
  );

const addAssemblyBoardSurface = (
  runtime: FoundryAssemblyOverlayRuntime,
  kit: PhysicalKitSettings,
  z: number,
) => {
  const topologyKey = `${kit.boardCells}:${kit.gridPitchMm}:${kit.sheetWidthMm}:${kit.sheetHeightMm}:${z}`;
  runtime.pool.acquire("board", topologyKey, () => {
    const points = boardPreviewPoints(kit);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const pitch =
      kit.boardCells > 1
        ? Math.abs(
            scenePointToPreviewPoint(boardToScene(1, 0, kit)).x -
              scenePointToPreviewPoint(boardToScene(0, 0, kit)).x,
          )
        : 0;
    const minX = Math.min(...xs) - pitch / 2;
    const maxX = Math.max(...xs) + pitch / 2;
    const minY = Math.min(...ys) - pitch / 2;
    const maxY = Math.max(...ys) + pitch / 2;
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const board = new THREE.Group();
    board.name = "assembly-15x15-board-surface";
    board.userData.assemblyBoardSurface = "15x15-hole-board";
    board.userData.assemblyBoardHoleCount = kit.boardCells * kit.boardCells;
    board.userData.assemblyBoardZ = z;
    const plateKey = `board-plate:${((maxX - minX) / 18).toFixed(3)}:${((maxY - minY) / 18).toFixed(3)}`;
    const plate = new THREE.Mesh(
      cachedGeometry(
        runtime,
        plateKey,
        () => new THREE.BoxGeometry((maxX - minX) / 18, (maxY - minY) / 18, 0.04),
      ),
      standardMaterial(runtime, BOARD_SURFACE_COLOR, 0.36),
    );
    plate.name = "assembly-board-z0-plate";
    plate.position.copy(previewPointToThree(center, z - 0.03));
    board.add(plate);
    const holeGeometry = cachedGeometry(
      runtime,
      "board-hole:0.08:0.012:6:18",
      () => new THREE.TorusGeometry(0.08, 0.012, 6, 18),
    );
    const holeMaterial = standardMaterial(runtime, BOARD_COLOR, 0.54);
    if (points.length >= runtime.resourcePolicy.instancingThreshold) {
      const holes = new THREE.InstancedMesh(
        holeGeometry,
        holeMaterial,
        points.length,
      );
      holes.name = "assembly-board-z0-holes-instanced";
      holes.userData.assemblyBoardHoleCount = points.length;
      holes.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const transform = new THREE.Object3D();
      points.forEach((point, index) => {
        transform.position.copy(previewPointToThree(point, z + 0.02));
        transform.updateMatrix();
        holes.setMatrixAt(index, transform.matrix);
      });
      holes.instanceMatrix.needsUpdate = true;
      board.add(holes);
    } else {
      points.forEach((point) => {
        const hole = new THREE.Mesh(holeGeometry, holeMaterial);
        hole.name = "assembly-board-z0-hole";
        hole.position.copy(previewPointToThree(point, z + 0.02));
        board.add(hole);
      });
    }
    return board;
  });
};

const addMarkerRing = (
  runtime: FoundryAssemblyOverlayRuntime,
  point: Point,
  z: number,
  material: THREE.Material,
  radius = 0.28,
) => {
  const geometryKey = `marker:${radius.toFixed(3)}`;
  const { object: ring } = runtime.pool.acquire("marker", geometryKey, () =>
    new THREE.Mesh(
      cachedGeometry(runtime, geometryKey, () =>
        new THREE.TorusGeometry(radius, 0.035, 8, 32),
      ),
      material,
    ),
  );
  ring.name = "assembly-board-ring";
  ring.material = material;
  ring.position.copy(previewPointToThree(point, z));
};

const addVerticalGuide = (
  runtime: FoundryAssemblyOverlayRuntime,
  point: Point,
  bottomZ: number,
  topZ: number,
  material: THREE.Material,
) => {
  const height = Math.max(0.24, topZ - bottomZ);
  const { object: guide } = runtime.pool.acquire("guide", "guide:unit", () =>
    new THREE.Mesh(
      cachedGeometry(runtime, "guide:unit", () =>
        new THREE.CylinderGeometry(0.035, 0.035, 1, 16),
      ),
      material,
    ),
  );
  guide.name = "assembly-z-guide";
  guide.material = material;
  guide.rotation.x = Math.PI / 2;
  guide.scale.set(1, height, 1);
  guide.position.copy(previewPointToThree(point, bottomZ + height / 2));
};

const addTravelLine = (
  runtime: FoundryAssemblyOverlayRuntime,
  start: Point,
  end: Point,
  z: number,
  material: THREE.Material,
) => {
  const points = [
    previewPointToThree(start, z + 0.72),
    previewPointToThree(end, z + 0.08),
  ];
  const { object: line } = runtime.pool.acquire("travel-line", "line:2", () =>
    new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material),
  );
  const position = line.geometry.getAttribute("position");
  points.forEach((point, index) => position.setXYZ(index, point.x, point.y, point.z));
  position.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.material = material;
  line.name = "assembly-travel-line";
};

export const disposeFoundryAssemblyOverlayRuntime = (root: THREE.Group) => {
  const runtime = overlayRuntimes.get(root);
  if (!runtime) return;
  runtime.overlay.removeFromParent();
  disposeFoundryThreeObject(runtime.overlay);
  runtime.geometryCache.forEach((geometry) => geometry.dispose());
  runtime.materialCache.forEach((material) => material.dispose());
  runtime.geometryCache.clear();
  runtime.materialCache.clear();
  overlayRuntimes.delete(root);
};

export const renderFoundryAssemblySceneOverlay = ({
  root,
  frame,
  mechanism,
  simulation,
  kit,
  pinBottomZ,
  pinTopZ,
  pathLayerZ,
  pathPoints,
  resourcePolicy,
}: FoundryAssemblySceneOverlayOptions): boolean => {
  const existing = overlayRuntimes.get(root);
  if (!frame && !existing) return false;
  const runtime = existing ?? overlayRuntime(root, resourcePolicy);
  runtime.pool.beginFrame();
  const topologyRevisionBefore = runtime.pool.topologyRevision;
  runtime.overlay.visible = Boolean(frame);
  if (!frame) {
    runtime.pool.endFrame();
    pruneOverlayResourceCaches(runtime);
    return runtime.pool.topologyRevision !== topologyRevisionBefore;
  }
  runtime.overlay.userData.assemblyFrameVersion = frame.version;
  runtime.overlay.userData.assemblyMotion = frame.motion;
  runtime.overlay.userData.assemblyBoardMode = frame.boardMode;

  const boardMaterial = standardMaterial(runtime, BOARD_COLOR, 0.9);
  const floatingMaterial = standardMaterial(runtime, FLOATING_COLOR, 0.45);
  const travelMaterial = lineMaterial(runtime, 0.72);

  const zTop = Math.max(pinTopZ + 0.2, pathLayerZ + 0.1);
  const zBottom = Math.min(pinBottomZ - 0.08, 0);
  const boardSurfaceZ = 0;
  if (frame.boardMode !== "hidden") {
    addAssemblyBoardSurface(runtime, kit, boardSurfaceZ);
  }
  const activePoints =
    frame.kind === "character"
      ? (frame.activeScenePoints ?? []).map(scenePointToPreviewPoint)
      : frame.activeBoardCoords
          .map((coord) => boardCoordToPreviewPoint(coord, kit, mechanism, simulation))
          .filter((point): point is Point => Boolean(point));
  const floatingPoints =
    frame.kind === "character"
      ? (frame.floatingReferencePoints ?? []).map(scenePointToPreviewPoint)
      : frame.floatingReferenceCoords
          .map((coord) => boardCoordToPreviewPoint(coord, kit, mechanism, simulation))
          .filter((point): point is Point => Boolean(point));

  activePoints.forEach((point) => {
    addMarkerRing(runtime, point, zTop, boardMaterial, 0.34);
    addVerticalGuide(runtime, point, zBottom, zTop, boardMaterial);
  });
  floatingPoints.forEach((point) =>
    addMarkerRing(runtime, point, zTop + 0.06, floatingMaterial, 0.24),
  );

  const travelTargets = activePoints.length
    ? activePoints
    : [simulation.state.p1];
  if (frame.motion === "explode_z") {
    travelTargets.forEach((point) =>
      addVerticalGuide(
        runtime,
        point,
        zBottom,
        zTop + 0.5 * frame.progress,
        boardMaterial,
      ),
    );
  } else if (
    frame.motion === "mount_travel_xy" ||
    frame.motion === "connect_travel_xy"
  ) {
    travelTargets.forEach((point) =>
      addTravelLine(
        runtime,
        {
          x: point.x - 42 * (1 - frame.progress),
          y: point.y - 26 * (1 - frame.progress),
        },
        point,
        zTop,
        travelMaterial,
      ),
    );
  } else if (frame.motion === "scrub_time" && pathPoints.length >= 2) {
    const points = pathPoints.map((point) =>
      previewPointToThree(point, zTop + 0.22),
    );
    const { object: path } = runtime.pool.acquire(
      "scrub-path",
      `path:${points.length}`,
      () =>
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          lineMaterial(runtime, 0.58),
        ),
    );
    const position = path.geometry.getAttribute("position");
    points.forEach((point, index) =>
      position.setXYZ(index, point.x, point.y, point.z),
    );
    position.needsUpdate = true;
    path.geometry.computeBoundingSphere();
    path.material = lineMaterial(runtime, 0.58);
    path.name = "assembly-scrub-path";
  }
  runtime.pool.endFrame();
  pruneOverlayResourceCaches(runtime);
  return runtime.pool.topologyRevision !== topologyRevisionBefore;
};

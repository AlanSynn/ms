import * as THREE from "three";

import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import { boardToScene, parseBoardCoordinateLabel, SCENE_VIEW } from "../../../utils/coordinates";
import type { FabricationRenderPlan } from "../../../utils/fabrication";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";
import type { AssemblySceneFrame } from "../../../utils/assemblySceneFrame";

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
  const parsed = parseBoardCoordinateLabel(coord);
  if (!parsed) return null;
  const { col, row } = parsed;
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

const makeMaterial = (color: string, opacity = 0.92) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.54,
    metalness: 0.04,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity > 0.5,
  });


const boardPreviewPoints = (kit: PhysicalKitSettings) => {
  const points: Point[] = [];
  for (let row = 0; row < kit.boardCells; row += 1) {
    for (let col = 0; col < kit.boardCells; col += 1) {
      points.push(scenePointToPreviewPoint(boardToScene(col, row, kit)));
    }
  }
  return points;
};

const addAssemblyBoardSurface = (
  group: THREE.Group,
  kit: PhysicalKitSettings,
  z: number,
) => {
  const points = boardPreviewPoints(kit);
  if (!points.length) return;
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

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry((maxX - minX) / 18, (maxY - minY) / 18, 0.04),
    makeMaterial(BOARD_SURFACE_COLOR, 0.36),
  );
  plate.name = "assembly-board-z0-plate";
  plate.position.copy(previewPointToThree(center, z - 0.03));
  board.add(plate);

  const holeMaterial = makeMaterial(BOARD_COLOR, 0.54);
  points.forEach((point) => {
    const hole = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.012, 6, 18),
      holeMaterial,
    );
    hole.name = "assembly-board-z0-hole";
    hole.position.copy(previewPointToThree(point, z + 0.02));
    board.add(hole);
  });
  group.add(board);
};

const addMarkerRing = (
  group: THREE.Group,
  point: Point,
  z: number,
  material: THREE.Material,
  radius = 0.28,
) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.035, 8, 32),
    material,
  );
  ring.name = "assembly-board-ring";
  ring.position.copy(previewPointToThree(point, z));
  group.add(ring);
};

const addVerticalGuide = (
  group: THREE.Group,
  point: Point,
  bottomZ: number,
  topZ: number,
  material: THREE.Material,
) => {
  const height = Math.max(0.24, topZ - bottomZ);
  const guide = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, height, 16),
    material,
  );
  guide.name = "assembly-z-guide";
  guide.rotation.x = Math.PI / 2;
  guide.position.copy(previewPointToThree(point, bottomZ + height / 2));
  group.add(guide);
};

const addTravelLine = (
  group: THREE.Group,
  start: Point,
  end: Point,
  z: number,
  material: THREE.Material,
) => {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    previewPointToThree(start, z + 0.72),
    previewPointToThree(end, z + 0.08),
  ]);
  const line = new THREE.Line(geometry, material);
  line.name = "assembly-travel-line";
  group.add(line);
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
}: FoundryAssemblySceneOverlayOptions) => {
  if (!frame) return;

  const overlay = new THREE.Group();
  overlay.name = "assembly-scene-contract-overlay";
  overlay.userData.assemblyFrameVersion = frame.version;
  overlay.userData.assemblyMotion = frame.motion;
  overlay.userData.assemblyBoardMode = frame.boardMode;

  const boardMaterial = makeMaterial(BOARD_COLOR, 0.9);
  const floatingMaterial = makeMaterial(FLOATING_COLOR, 0.45);
  const travelMaterial = new THREE.LineBasicMaterial({
    color: ACTIVE_COLOR,
    transparent: true,
    opacity: 0.72,
  });

  const zTop = Math.max(pinTopZ + 0.2, pathLayerZ + 0.1);
  const zBottom = Math.min(pinBottomZ - 0.08, 0);
  const boardSurfaceZ = 0;
  if (frame.boardMode !== "hidden") {
    addAssemblyBoardSurface(overlay, kit, boardSurfaceZ);
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
    addMarkerRing(overlay, point, zTop, boardMaterial, 0.34);
    addVerticalGuide(overlay, point, zBottom, zTop, boardMaterial);
  });
  floatingPoints.forEach((point) =>
    addMarkerRing(overlay, point, zTop + 0.06, floatingMaterial, 0.24),
  );

  const travelTargets = activePoints.length
    ? activePoints
    : [simulation.state.p1];
  if (frame.motion === "explode_z") {
    travelTargets.forEach((point) =>
      addVerticalGuide(
        overlay,
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
        overlay,
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
    const geometry = new THREE.BufferGeometry().setFromPoints(
      pathPoints.map((point) => previewPointToThree(point, zTop + 0.22)),
    );
    const path = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: ACTIVE_COLOR,
        transparent: true,
        opacity: 0.58,
      }),
    );
    path.name = "assembly-scrub-path";
    overlay.add(path);
  }

  root.add(overlay);
};

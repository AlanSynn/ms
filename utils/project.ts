import {
  AppSettings,
  AppStage,
  BodyPartLayer,
  CharacterPackageArtifact,
  MechanismConfig,
  Point,
  ProcessingStatus,
  ProjectAction,
  ProjectSnapshotLoadResult,
  ProjectMotionPath,
  SceneObject,
  ProjectState,
  RejectedConnectionSelectionDiagnostic,
  StandardJoint,
  StandardSkeleton,
  Transform,
} from "../types";
import {
  defaultPhysicalKit,
  localPivotOffsetForScene,
  SCENE_PX_PER_MM,
  sceneBoundsForSheet,
} from "./coordinates";
import {
  REFERENCE_DEFAULTS,
  normalizeMechanismToFabricationSet,
  normalizeMechanismToReference,
} from "./mechanismReference";
import {
  createDefaultMechanism,
  mechanismRequiredParts,
} from "./mechanismDefaults";
import { mechanismWithGeneratedPath } from "./mechanismGeneratedPath";
import {
  gearTrainOutputRatio,
  gearTrainCenters,
  normalizeCamProfileSamples,
} from "./kinematics";
import {
  clampNumber,
  finiteNumber,
  sanitizeHexColor,
  sanitizeMechanismType,
  sanitizePoint,
} from "./sanitize";
import {
  mechanismConnectionCompatibilityUpdates,
  normalizeMechanismConnectionSelections,
  resolveMechanismPhysicalConnections,
} from "./mechanismConnectionSelections";
import { isUsableContourPoints } from "./partGeometry";
import {
  DEFAULT_CLASSROOM_ASSESSMENT_KEY,
  normalizeClassroomAssessmentKey,
} from "./classroomContent";
import {
  mechanismEditIsSafe,
  resolveMechanismEditAttempt,
} from "./mechanismEditAuthority";
import { fitMechanismToTargetPathResult } from "./mechanismRecommendations";
import { completeAutomaticFitCandidate } from "./fourBarPathFit";
import { MECHANISM_BINDING_BLOCKER, pathOwnedTargetFields } from "./pathTargets";
import { assessProjectMechanismRuntime } from "./mechanismRuntimePolicy";
import {
  guidedFourBarTimedPoints,
  guidedGearDriverPhaseOffset,
  guidedGearTimedPoints,
  guidedHeadBobTimedPoints,
} from "./guidedLessonTiming";

export { createDefaultMechanism, mechanismRequiredParts } from "./mechanismDefaults";
export { mechanismWithGeneratedPath } from "./mechanismGeneratedPath";

export const APP_STATE_VERSION = 2 as const;

export const nowIso = () => new Date().toISOString();
export const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export const idleProcessing = (): ProcessingStatus => ({
  stage: "idle",
  message: "Ready",
  progress: 0,
});

export const defaultSettings = (): AppSettings => ({
  animationSpeed: 1,
  animationDurationMs: 3200,
  timingProfile: "linear",
  theme: "light",
  uiTextScale: "normal",
  toolbarVisible: false,
  partPanelVisible: true,
  autosave: true,
  autosaveIntervalSeconds: 60,
  performancePreset: "balanced",
  physicsSnapMode: "balanced",
  simulationFriction: 0.18,
  simulationMassKg: 1,
  debugVisuals: false,
  detailedProcessingSteps: false,
  classroomAssessmentKey: DEFAULT_CLASSROOM_ASSESSMENT_KEY,
  gridUnit: "cm",
  fabricationReadyMode: true,
  physicalKit: defaultPhysicalKit(),
});

const pickOne = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const normalizePhysicalKitSettings = (
  value: unknown,
  fallback = defaultPhysicalKit(),
): AppSettings["physicalKit"] => {
  const raw = asRecord(value);
  return {
    ...fallback,
    profileKey:
      typeof raw.profileKey === "string" && raw.profileKey.trim()
        ? raw.profileKey
        : fallback.profileKey,
    gridPitchMm: clampNumber(raw.gridPitchMm, fallback.gridPitchMm, 5, 50),
    sheetWidthMm: clampNumber(
      raw.sheetWidthMm,
      fallback.sheetWidthMm,
      80,
      1200,
    ),
    sheetHeightMm: clampNumber(
      raw.sheetHeightMm,
      fallback.sheetHeightMm,
      80,
      1600,
    ),
    boardCells: Math.round(
      clampNumber(raw.boardCells, fallback.boardCells, 4, 40),
    ),
    holeDiameterMm: clampNumber(
      raw.holeDiameterMm,
      fallback.holeDiameterMm,
      1,
      20,
    ),
    exportMode: pickOne(
      raw.exportMode,
      ["custom-parts", "prefab-board", "both"] as const,
      fallback.exportMode,
    ),
    defaultExportFormat: pickOne(
      raw.defaultExportFormat,
      ["svg", "json", "both"] as const,
      fallback.defaultExportFormat,
    ),
    cutSheetFileType: pickOne(
      raw.cutSheetFileType,
      ["pdf", "svg"] as const,
      fallback.cutSheetFileType,
    ),
  };
};

const normalizeAppSettings = (
  value: unknown,
  fallback = defaultSettings(),
): AppSettings => {
  const raw = asRecord(value);
  return {
    ...fallback,
    animationSpeed: clampNumber(
      raw.animationSpeed,
      fallback.animationSpeed,
      0.1,
      5,
    ),
    animationDurationMs: Math.round(
      clampNumber(
        raw.animationDurationMs,
        fallback.animationDurationMs,
        100,
        60000,
      ),
    ),
    timingProfile: pickOne(
      raw.timingProfile,
      [
        "linear",
        "ease-in",
        "ease-out",
        "ease-in-out",
        "realtime",
        "slow",
        "presentation",
      ] as const,
      fallback.timingProfile,
    ),
    theme: pickOne(
      raw.theme,
      ["light", "dark", "blueprint"] as const,
      fallback.theme,
    ),
    uiTextScale: pickOne(
      raw.uiTextScale,
      ["compact", "normal", "large"] as const,
      fallback.uiTextScale,
    ),
    toolbarVisible:
      typeof raw.toolbarVisible === "boolean"
        ? raw.toolbarVisible
        : fallback.toolbarVisible,
    partPanelVisible:
      typeof raw.partPanelVisible === "boolean"
        ? raw.partPanelVisible
        : fallback.partPanelVisible,
    autosave:
      typeof raw.autosave === "boolean" ? raw.autosave : fallback.autosave,
    autosaveIntervalSeconds: Math.round(
      clampNumber(
        raw.autosaveIntervalSeconds,
        fallback.autosaveIntervalSeconds,
        1,
        600,
      ),
    ),
    performancePreset: pickOne(
      raw.performancePreset,
      ["fast", "balanced", "high"] as const,
      fallback.performancePreset,
    ),
    physicsSnapMode: pickOne(
      raw.physicsSnapMode,
      ["fast", "balanced", "high"] as const,
      fallback.physicsSnapMode,
    ),
    simulationFriction: clampNumber(
      raw.simulationFriction,
      fallback.simulationFriction,
      0,
      2,
    ),
    simulationMassKg: clampNumber(
      raw.simulationMassKg,
      fallback.simulationMassKg,
      0.05,
      10,
    ),
    debugVisuals:
      typeof raw.debugVisuals === "boolean"
        ? raw.debugVisuals
        : fallback.debugVisuals,
    detailedProcessingSteps:
      typeof raw.detailedProcessingSteps === "boolean"
        ? raw.detailedProcessingSteps
        : fallback.detailedProcessingSteps,
    classroomAssessmentKey: normalizeClassroomAssessmentKey(
      raw.classroomAssessmentKey ?? asRecord(raw.classroom).assessmentKey,
      fallback.classroomAssessmentKey,
    ),
    gridUnit: pickOne(
      raw.gridUnit,
      ["cm", "inch", "px"] as const,
      fallback.gridUnit,
    ),
    fabricationReadyMode:
      typeof raw.fabricationReadyMode === "boolean"
        ? raw.fabricationReadyMode
        : fallback.fabricationReadyMode,
    physicalKit: normalizePhysicalKitSettings(
      raw.physicalKit,
      fallback.physicalKit,
    ),
  };
};

const joint = (
  id: string,
  x: number,
  y: number,
  parentId: string | null = null,
): StandardJoint => ({
  id,
  name: id.replaceAll("_", " "),
  position: { x, y },
  parentId,
  locked: false,
  bendDirection: 1,
});

export const buildSkeleton = (joints: StandardJoint[]): StandardSkeleton => {
  const map: Record<string, StandardJoint> = {};
  const hierarchy: Record<string, string[]> = {};
  const bones: [string, string][] = [];
  const rootJointIds: string[] = [];
  const jointMap: Record<string, string> = {};

  joints.forEach((j) => {
    map[j.id] = { ...j, bendDirection: j.bendDirection ?? 1 };
    jointMap[j.name.replaceAll(" ", "_")] = j.id;
    if (j.parentId && joints.some((other) => other.id === j.parentId)) {
      bones.push([j.parentId, j.id]);
      hierarchy[j.parentId] = [...(hierarchy[j.parentId] ?? []), j.id];
    } else {
      rootJointIds.push(j.id);
    }
  });

  return {
    joints: map,
    bones,
    rootJointIds,
    jointMap,
    hierarchy,
    metadata: {
      sourceFormat: "web-port",
      scale: 1,
      normalization: "letter-sheet-scene",
    },
  };
};

export const wouldCreateCycle = (
  joints: Record<string, StandardJoint>,
  jointId: string,
  parentId?: string | null,
) => {
  let current = parentId ?? null;
  while (current) {
    if (current === jointId) return true;
    current = joints[current]?.parentId ?? null;
  }
  return false;
};

const defaultSkeleton = () =>
  buildSkeleton([
    joint("root", 0, -70),
    joint("hip", 0, -70, "root"),
    joint("torso", 0, 40, "hip"),
    joint("neck", 0, 120, "torso"),
    joint("head_top", 0, 170, "neck"),
    joint("left_shoulder", 58, 92, "torso"),
    joint("left_elbow", 108, 28, "left_shoulder"),
    joint("left_hand", 128, -34, "left_elbow"),
    joint("right_shoulder", -58, 92, "torso"),
    joint("right_elbow", -108, 28, "right_shoulder"),
    joint("right_hand", -128, -34, "right_elbow"),
    joint("left_hip", 34, -72, "root"),
    joint("left_knee", 50, -150, "left_hip"),
    joint("left_foot", 72, -218, "left_knee"),
    joint("right_hip", -34, -72, "root"),
    joint("right_knee", -50, -150, "right_hip"),
    joint("right_foot", -72, -218, "right_knee"),
  ]);

const skeletonPoint = (skeleton: StandardSkeleton, jointId: string): Point =>
  skeleton.joints[jointId]?.position ?? { x: 0, y: 0 };

const guidedArmWaveMechanism = (id = "mech-1"): MechanismConfig =>
  mechanismWithGeneratedPath(
    normalizeMechanismToFabricationSet({
      ...createDefaultMechanism("4bar", id),
      anchorX: 0,
      anchorY: -40,
      transform: { x: 0, y: -40, rotation: 180, scale: 1 },
      sceneAnchor: { x: 0, y: -40 },
      groundAngle: 180,
      groundLength: 160,
      crankLength: 80,
      couplerLength: 160,
      rockerLength: 160,
      couplerPointDist: 40,
      couplerPointAngle: -90,
      assemblyMode: "crossed",
      source: "optimized",
      presetId: "sample-fitted",
      recommendation: "sample path fit",
      targetPartId: "right_hand_part",
      targetPathId: "path-right-arm",
      targetAnchorJointId: "right_hand",
      activeVisualPartIds: ["right_hand_part"],
    }),
  );

const guidedArmWaveCycle = () =>
  guidedArmWaveMechanism().generatedPath ?? [];

const guidedArmWavePath = (): Point[] =>
  guidedArmWaveCycle().filter((_, index) => index % 8 === 0);

const guidedArmWaveTimedPoints = (
  duration: number,
): NonNullable<ProjectMotionPath["timedPoints"]> =>
  guidedArmWaveCycle()
    .filter((_, index) => index % 2 === 0)
    .map((point, index, points) => ({
      ...point,
      time: (index / points.length) * duration,
    }));

const guidedHeadBobPath = (skeleton: StandardSkeleton): Point[] => {
  const headTop = skeletonPoint(skeleton, "head_top");
  const centerY = headTop.y - 2.4;
  const lift = 2.4;
  return [
    { x: headTop.x, y: centerY - lift },
    { x: headTop.x, y: centerY },
    { x: headTop.x, y: centerY + lift },
    { x: headTop.x, y: centerY },
  ];
};

const guidedFootStepPath = (skeleton: StandardSkeleton): Point[] => {
  const hip = skeletonPoint(skeleton, "right_hip");
  const foot = skeletonPoint(skeleton, "right_foot");
  const side = Math.sign(foot.x - hip.x) || 1;
  const mirror = -side;
  return [
    { x: -62, y: -49.589 },
    { x: -71.382, y: -23.607 },
    { x: -73.157, y: -17.743 },
    { x: -64.269, y: -43.898 },
    { x: -53.154, y: -69.187 },
    { x: -39.905, y: -93.426 },
    { x: -24.617, y: -116.434 },
    { x: -7.408, y: -138.041 },
    { x: -3.346, y: -142.627 },
    { x: -20.967, y: -121.354 },
    { x: -36.696, y: -98.645 },
    { x: -50.407, y: -74.664 },
  ].map((offset) => ({
    x: hip.x + offset.x * mirror,
    y: hip.y + offset.y,
  }));
};

type StarterPartShape = "torso" | "head" | "limb" | "hand" | "foot";

const capsuleContour = (width: number, height: number): Point[] => {
  const r = Math.min(width, height) / 2;
  const halfW = width / 2;
  const halfH = height / 2;
  const steps = 6;
  const points: Point[] = [];
  if (height >= width) {
    for (let i = 0; i <= steps; i += 1) {
      const t = Math.PI - (Math.PI * i) / steps;
      points.push({ x: Math.cos(t) * r, y: halfH - r + Math.sin(t) * r });
    }
    for (let i = 0; i <= steps; i += 1) {
      const t = -(Math.PI * i) / steps;
      points.push({ x: Math.cos(t) * r, y: -halfH + r + Math.sin(t) * r });
    }
    return points;
  }
  for (let i = 0; i <= steps; i += 1) {
    const t = Math.PI / 2 - (Math.PI * i) / steps;
    points.push({ x: halfW - r + Math.cos(t) * r, y: Math.sin(t) * r });
  }
  for (let i = 0; i <= steps; i += 1) {
    const t = -Math.PI / 2 - (Math.PI * i) / steps;
    points.push({ x: -halfW + r + Math.cos(t) * r, y: Math.sin(t) * r });
  }
  return points;
};

const starterContour = (
  shape: StarterPartShape,
  width: number,
  height: number,
): Point[] => {
  const hw = width / 2;
  const hh = height / 2;
  if (shape === "head") {
    return [
      { x: -hw * 0.62, y: -hh * 0.78 },
      { x: 0, y: -hh * 0.94 },
      { x: hw * 0.62, y: -hh * 0.78 },
      { x: hw * 0.82, y: 0 },
      { x: hw * 0.55, y: hh * 0.78 },
      { x: 0, y: hh * 0.92 },
      { x: -hw * 0.55, y: hh * 0.78 },
      { x: -hw * 0.82, y: 0 },
    ];
  }
  if (shape === "torso") {
    return [
      { x: -hw * 0.76, y: -hh * 0.96 },
      { x: hw * 0.76, y: -hh * 0.96 },
      { x: hw * 0.96, y: -hh * 0.68 },
      { x: hw * 0.98, y: hh * 0.76 },
      { x: hw * 0.72, y: hh },
      { x: -hw * 0.72, y: hh },
      { x: -hw * 0.98, y: hh * 0.76 },
      { x: -hw * 0.96, y: -hh * 0.68 },
    ];
  }
  if (shape === "hand") {
    return [
      { x: -hw * 0.6, y: -hh * 0.72 },
      { x: hw * 0.55, y: -hh * 0.82 },
      { x: hw * 0.9, y: -hh * 0.12 },
      { x: hw * 0.58, y: hh * 0.98 },
      { x: -hw * 0.58, y: hh * 0.98 },
      { x: -hw * 0.9, y: hh * 0.08 },
    ];
  }
  if (shape === "foot") {
    return [
      { x: -hw * 0.92, y: -hh * 0.52 },
      { x: hw * 0.35, y: -hh * 0.82 },
      { x: hw * 0.94, y: -hh * 0.2 },
      { x: hw * 0.76, y: hh * 0.72 },
      { x: -hw * 0.58, y: hh * 0.96 },
      { x: -hw * 0.96, y: hh * 0.3 },
    ];
  }
  return capsuleContour(width, height);
};

const textureFromContour = (
  width: number,
  height: number,
  points: Point[],
  fillColor: string,
) => {
  const d =
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${(point.x + width / 2).toFixed(2)} ${(point.y + height / 2).toFixed(2)}`,
      )
      .join(" ") + " Z";
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${d}" fill="${fillColor}"/></svg>`)}`;
};

const part = (
  id: string,
  name: string,
  anchorJointId: string,
  transform: Transform,
  bounds: { width: number; height: number },
  fillColor: string,
  zIndex: number,
  shape: StarterPartShape = "limb",
): BodyPartLayer => {
  const contourPoints = starterContour(shape, bounds.width, bounds.height);
  return {
    id,
    name,
    anchorJointId,
    transform,
    bounds: { x: -bounds.width / 2, y: -bounds.height / 2, ...bounds },
    zIndex,
    opacity: 0.9,
    visible: true,
    locked: false,
    selectable: true,
    fillColor,
    contourPoints,
    contourSource: "imported",
    textureUrl: textureFromContour(
      bounds.width,
      bounds.height,
      contourPoints,
      fillColor,
    ),
    originalSvgPath: `sample-assets/${id}.svg`,
    enhancedSvgPath: `sample-assets/${id}-enhanced.svg`,
  };
};

export const createDefaultSceneObject = (
  shape: SceneObject["shape"] = "piggy-bank",
  id = uid("object"),
): SceneObject => ({
  id,
  name:
    shape === "piggy-bank"
      ? "Flying piggy bank"
      : shape === "cloud"
        ? "Cloud"
        : shape === "star"
          ? "Star"
          : "Block",
  shape,
  transform: {
    x: 112,
    y: 142,
    rotation: shape === "piggy-bank" ? -8 : 0,
    scale: 1,
  },
  bounds: {
    width: shape === "star" ? 68 : 96,
    height: shape === "piggy-bank" ? 62 : 68,
  },
  fillColor:
    shape === "piggy-bank"
      ? "#f9a8d4"
      : shape === "cloud"
        ? "#bfdbfe"
        : shape === "star"
          ? "#fde68a"
          : "#c4b5fd",
  opacity: 0.92,
  visible: true,
  locked: false,
  zIndex: 20,
});

const invalidateMechanismArtifacts = (
  mechanism: MechanismConfig,
  parts: Record<string, BodyPartLayer>,
): MechanismConfig => {
  const {
    foundryExport: _foundryExport,
    generatedPath: _generatedPath,
    fabricationMetadata: _fabricationMetadata,
    warnings: _warnings,
    ...authored
  } = mechanism;
  return {
    ...authored,
    activeVisualPartIds:
      mechanism.targetPartId && parts[mechanism.targetPartId]
        ? [mechanism.targetPartId]
        : [],
    warnings: [],
  };
};

const invalidateOrphanedMechanisms = (project: ProjectState): ProjectState => {
  const assessment = assessProjectMechanismRuntime(project);
  let invalidated = false;
  const mechanisms = project.mechanisms.map((mechanism) => {
    if (assessment.gates.get(mechanism.id)?.canDriveProject) return mechanism;
    invalidated = true;
    return invalidateMechanismArtifacts(mechanism, project.parts);
  });
  return invalidated
    ? {
        ...project,
        mechanisms,
        lastExport: undefined,
        lastFoundryExport: undefined,
      }
    : project;
};

const invalidatesAcceptedBinding = (
  previous: ProjectState,
  candidate: ProjectState,
) => {
  const previousAssessment = assessProjectMechanismRuntime(previous);
  const candidateAssessment = assessProjectMechanismRuntime(candidate);
  return previous.mechanisms.some((mechanism) =>
    previousAssessment.gates.get(mechanism.id)?.canDriveProject &&
    !candidateAssessment.gates.get(mechanism.id)?.canDriveProject
  );
};

const samePoint = (a: Point | undefined, b: Point | undefined) =>
  (!a && !b) || Boolean(a && b && a.x === b.x && a.y === b.y);

const samePoints = (a: Point[] = [], b: Point[] = []) =>
  a.length === b.length &&
  a.every((point, index) => samePoint(point, b[index]));

const sameTimedPoints = (
  a: ProjectMotionPath["timedPoints"] = [],
  b: ProjectMotionPath["timedPoints"] = [],
) =>
  a.length === b.length &&
  a.every(
    (point, index) =>
      samePoint(point, b[index]) && point.time === b[index]?.time,
  );

const pathGeneratedGeometryUnchanged = (
  previous: ProjectMotionPath | undefined,
  next: ProjectMotionPath,
) => {
  if (!previous) return false;
  return (
    previous.partId === next.partId &&
    previous.sceneObjectId === next.sceneObjectId &&
    previous.targetAnchorJointId === next.targetAnchorJointId &&
    previous.chainRootJointId === next.chainRootJointId &&
    previous.smoothness === next.smoothness &&
    previous.duration === next.duration &&
    previous.closed === next.closed &&
    samePoints(previous.points, next.points) &&
    sameTimedPoints(previous.timedPoints, next.timedPoints)
  );
};

const mechanismWithKitConnections = (
  mechanism: MechanismConfig,
  connectionState: ReturnType<typeof normalizeMechanismConnectionSelections>,
  kit: AppSettings["physicalKit"],
) => {
  const authored = { ...mechanism, ...connectionState };
  const hasAcceptedConnection = connectionState.connectionSelectionValidation?.entries
    .some((entry) => entry.status === "accepted");
  const canonical = hasAcceptedConnection
    ? {
        ...authored,
        ...mechanismConnectionCompatibilityUpdates(mechanism, connectionState),
      }
    : authored;
  return mechanismEditIsSafe(canonical, kit) ? canonical : authored;
};

const revalidateMechanismArtifacts = (
  project: ProjectState,
  sourceMechanisms: MechanismConfig[],
  options: { preserveExactTargetFit?: boolean } = {},
): ProjectState => {
  const mechanisms = sourceMechanisms.map((mechanism) => {
    const connectionState = normalizeMechanismConnectionSelections(
      mechanism,
      mechanism.connectionSelections,
      mechanism.connectionSelectionValidation,
      {
        kit: project.settings.physicalKit,
        priorDiagnostics: mechanism.rejectedConnectionSelectionDiagnostics,
      },
    );
    return invalidateMechanismArtifacts(
      mechanismWithKitConnections(
        mechanism,
        connectionState,
        project.settings.physicalKit,
      ),
      project.parts,
    );
  });
  const cleanProject = {
    ...project,
    mechanisms,
    lastExport: undefined,
    lastFoundryExport: undefined,
  };
  const assessment = assessProjectMechanismRuntime(cleanProject);
  return {
    ...cleanProject,
    mechanisms: mechanisms.map((mechanism, index) => {
      if (!assessment.gates.get(mechanism.id)?.canDriveProject) return mechanism;
      const rebuilt = mechanismWithGeneratedPath(mechanism, {
        kit: project.settings.physicalKit,
      });
      const targetPath = mechanism.targetPathId
        ? cleanProject.paths[mechanism.targetPathId]
        : undefined;
      const sourcePath = sourceMechanisms[index]?.generatedPath;
      return options.preserveExactTargetFit && targetPath && sourcePath && samePoints(sourcePath, targetPath.points)
        ? {
            ...rebuilt,
            generatedPath: targetPath.points.map((point) => ({ ...point })),
          }
        : rebuilt;
    }),
  };
};

const mechanismDriverConflictSignatures = (project: ProjectState) => {
  return [...assessProjectMechanismRuntime(project).driverGroups.entries()]
    .flatMap(([driver, ids]) => {
      const sortedIds = [...ids].sort();
      return sortedIds.flatMap((left, leftIndex) =>
        sortedIds.slice(leftIndex + 1).map((right) => `${driver}:${left},${right}`),
      );
    })
    .sort();
};

const mechanismDriverConflict = (project: ProjectState, mechanism: MechanismConfig) => {
  const mechanisms = project.mechanisms.some(candidate => candidate.id === mechanism.id)
    ? project.mechanisms.map(candidate => candidate.id === mechanism.id ? mechanism : candidate)
    : [...project.mechanisms, mechanism];
  const candidateProject = { ...project, mechanisms };
  return [...assessProjectMechanismRuntime(candidateProject).driverGroups.values()].some(
    ids => ids.length > 1 && ids.includes(mechanism.id),
  );
};

const introducesMechanismDriverConflict = (current: ProjectState, next: ProjectState) => {
  const currentConflicts = new Set(mechanismDriverConflictSignatures(current));
  return mechanismDriverConflictSignatures(next).some((signature) => !currentConflicts.has(signature));
};

export const createEmptyProject = (): ProjectState => ({
  version: APP_STATE_VERSION,
  metadata: {
    id: uid("project"),
    name: "Untitled automata",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    normalizationScale: 1,
    status: "empty",
  },
  parts: {},
  partOrder: [],
  sceneObjects: {},
  sceneObjectOrder: [],
  skeleton: null,
  paths: {},
  mechanisms: [],
  settings: defaultSettings(),
  selectedMechanismId: undefined,
  processing: idleProcessing(),
});

export const createSampleProject = (
  options: { includeMechanism?: boolean } = {},
): ProjectState => {
  const includeMechanism = options.includeMechanism ?? false;
  const skeleton = defaultSkeleton();
  const partsArray = [
    part(
      "torso",
      "Torso",
      "torso",
      { x: 0, y: 12, rotation: 0, scale: 1 },
      { width: 132, height: 220 },
      "#cbd5e1",
      0,
      "torso",
    ),
    part(
      "head",
      "Head",
      "neck",
      { x: 0, y: 152, rotation: 0, scale: 1 },
      { width: 78, height: 78 },
      "#e2e8f0",
      5,
      "head",
    ),
    part(
      "left_arm_upper",
      "Left upper arm",
      "left_shoulder",
      { x: 80, y: 56, rotation: 20, scale: 1 },
      { width: 44, height: 104 },
      "#b6c2d2",
      3,
      "limb",
    ),
    part(
      "left_arm_lower",
      "Left lower arm",
      "left_elbow",
      { x: 116, y: -10, rotation: 18, scale: 1 },
      { width: 42, height: 104 },
      "#b6c2d2",
      3,
      "limb",
    ),
    part(
      "left_hand_part",
      "Left hand",
      "left_hand",
      { x: 134, y: -54, rotation: 18, scale: 1 },
      { width: 40, height: 42 },
      "#d1d5db",
      4,
      "hand",
    ),
    part(
      "right_arm_upper",
      "Right upper arm",
      "right_shoulder",
      { x: -80, y: 56, rotation: -20, scale: 1 },
      { width: 44, height: 104 },
      "#b6c2d2",
      3,
      "limb",
    ),
    part(
      "right_arm_lower",
      "Right lower arm",
      "right_elbow",
      { x: -116, y: -10, rotation: -18, scale: 1 },
      { width: 42, height: 104 },
      "#b6c2d2",
      3,
      "limb",
    ),
    part(
      "right_hand_part",
      "Right hand",
      "right_hand",
      { x: -134, y: -54, rotation: -18, scale: 1 },
      { width: 40, height: 42 },
      "#d1d5db",
      4,
      "hand",
    ),
    part(
      "left_leg_upper",
      "Left upper leg",
      "left_hip",
      { x: 42, y: -114, rotation: 8, scale: 1 },
      { width: 48, height: 108 },
      "#94a3b8",
      1,
      "limb",
    ),
    part(
      "left_leg_lower",
      "Left lower leg",
      "left_knee",
      { x: 60, y: -194, rotation: 8, scale: 1 },
      { width: 48, height: 112 },
      "#94a3b8",
      1,
      "limb",
    ),
    part(
      "left_foot_part",
      "Left foot",
      "left_foot",
      { x: 82, y: -238, rotation: 8, scale: 1 },
      { width: 66, height: 58 },
      "#94a3b8",
      2,
      "foot",
    ),
    part(
      "right_leg_upper",
      "Right upper leg",
      "right_hip",
      { x: -42, y: -114, rotation: -8, scale: 1 },
      { width: 48, height: 108 },
      "#94a3b8",
      1,
      "limb",
    ),
    part(
      "right_leg_lower",
      "Right lower leg",
      "right_knee",
      { x: -60, y: -194, rotation: -8, scale: 1 },
      { width: 48, height: 112 },
      "#94a3b8",
      1,
      "limb",
    ),
    part(
      "right_foot_part",
      "Right foot",
      "right_foot",
      { x: -82, y: -238, rotation: -8, scale: 1 },
      { width: 66, height: 58 },
      "#94a3b8",
      2,
      "foot",
    ),
  ].map((p) => ({
    ...p,
    localPivotOffset: localPivotOffsetForScene(
      p,
      skeleton.joints[p.anchorJointId]?.position ?? p.transform,
    ),
    localPivotJointId: p.anchorJointId,
  }));
  const mechanisms = includeMechanism ? [guidedArmWaveMechanism()] : [];

  const pathPoints = guidedArmWavePath();
  const armPathDuration = 1800;

  return {
    ...createEmptyProject(),
    metadata: {
      id: uid("project"),
      name: "Humanoid starter character",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      normalizationScale: 1,
      status: "sample",
    },
    parts: Object.fromEntries(partsArray.map((p) => [p.id, p])),
    partOrder: partsArray.sort((a, b) => a.zIndex - b.zIndex).map((p) => p.id),
    skeleton,
    paths: {
      "path-right-arm": {
        id: "path-right-arm",
        partId: "right_hand_part",
        targetAnchorJointId: "right_hand",
        chainRootJointId: "right_shoulder",
        points: pathPoints,
        timedPoints: guidedArmWaveTimedPoints(armPathDuration),
        duration: armPathDuration,
        closed: true,
        enabled: true,
        visible: true,
        source: "drawn",
        warnings: [],
      },
    },
    mechanisms,
    selectedPartId: "right_hand_part",
    selectedPathId: "path-right-arm",
    selectedMechanismId: mechanisms[0]?.id,
    characterPackage: {
      id: "sample-character-package",
      createdAt: nowIso(),
      sourceImageName: "sample",
      outputDir: "sample://built-in",
      partsInfo: {
        parts: Object.fromEntries(
          partsArray.map((p) => [
            p.id,
            {
              name: p.name,
              texture_path: `sample-assets/${p.id}.svg`,
              original_svg_path: p.originalSvgPath,
              enhanced_svg_path: p.enhancedSvgPath,
              contour_points: p.contourPoints,
              contour_source: p.contourSource,
              anchor_joint_id: p.anchorJointId,
              transform: p.transform,
              z_index: p.zIndex,
              visible: p.visible,
            },
          ]),
        ),
      },
      charCfg: {
        joints: skeleton.joints,
        bones: skeleton.bones,
        root_joint_ids: skeleton.rootJointIds,
        metadata: skeleton.metadata,
      },
      replacementContext: {
        mode: "plain-load",
        rebindingSummary: includeMechanism
          ? "Built-in sample with a ready path and mechanism."
          : "Built-in full humanoid starter with no mechanisms.",
      },
    },
    processing: { stage: "ready", message: "Sample loaded", progress: 100 },
  };
};

export const CLASSROOM_LESSONS = [
  {
    id: "waving-arm",
    label: "Waving arm",
    shortLabel: "Waving arm",
    description: "Right hand path + fitted four-bar mechanism.",
    actionLabel: "Open lesson",
    outcome: "Make a hand wave",
    changeCue: "hand path",
    buildCue: "four-bar",
    startStage: "character" as AppStage,
    mechanismType: "4bar" as MechanismConfig["type"],
    sensemaking: {
      directTranslation: "Crank turns -> rocker swings",
      tryThis: "Move the hand path",
      teacherTakeaway: "Rotary motion can become swinging motion.",
      studentCheck: "Which pivot stays fixed?",
      expectedAnswer: "The board pivots stay fixed",
      evidenceCue: "right hand follows the rocker arc",
      clipSlot: "generated-loop" as const,
    },
  },
  {
    id: "head-bob",
    label: "Head bob",
    shortLabel: "Head bob",
    description: "Head lift path + cam follower baseline.",
    actionLabel: "Open lesson",
    outcome: "Make a head bob",
    changeCue: "head path",
    buildCue: "cam",
    startStage: "character" as AppStage,
    mechanismType: "cam" as MechanismConfig["type"],
    sensemaking: {
      directTranslation: "Cam shape -> follower lifts",
      tryThis: "Drag the lift path",
      teacherTakeaway: "A shaped cam can turn rotation into timed lifting.",
      studentCheck: "Where does the follower touch?",
      expectedAnswer: "The follower touches the cam edge",
      evidenceCue: "head lift follows the cam profile",
      clipSlot: "generated-loop" as const,
    },
  },
  {
    id: "walking-leg",
    label: "Walking leg",
    shortLabel: "Walking leg",
    description: "Foot path + board-ready four-bar baseline.",
    actionLabel: "Open lesson",
    outcome: "Make a foot step",
    changeCue: "foot path",
    buildCue: "four-bar",
    startStage: "character" as AppStage,
    mechanismType: "4bar" as MechanismConfig["type"],
    sensemaking: {
      directTranslation: "Crank turns -> leg steps",
      tryThis: "Move the foot loop",
      teacherTakeaway: "A four-bar can turn rotation into a stepping swing.",
      studentCheck: "Which pivot stays fixed?",
      expectedAnswer: "The board pivots stay fixed",
      evidenceCue: "lower leg follows the foot loop",
      clipSlot: "generated-loop" as const,
    },
  },
  {
    id: "spin-gears",
    label: "Spin gears",
    shortLabel: "Spin gears",
    description: "Gear pair baseline with board-ready axles.",
    actionLabel: "Open lesson",
    outcome: "Make gears spin",
    changeCue: "gear size",
    buildCue: "gear pair",
    startStage: "character" as AppStage,
    mechanismType: "gear" as MechanismConfig["type"],
    sensemaking: {
      directTranslation: "Touching teeth -> spin transfers",
      tryThis: "Swap gear size",
      teacherTakeaway: "Meshed gears transfer rotation and can change speed.",
      studentCheck: "Which gear turns opposite?",
      expectedAnswer: "The meshed gear turns opposite the driver",
      evidenceCue: "touching teeth transfer spin",
      clipSlot: "generated-loop" as const,
    },
  },
] as const;

export type ClassroomLessonId = (typeof CLASSROOM_LESSONS)[number]["id"];
export type ClassroomLessonTemplate = (typeof CLASSROOM_LESSONS)[number];

export const classroomLessonById = (
  id?: string,
): ClassroomLessonTemplate | undefined =>
  CLASSROOM_LESSONS.find((lesson) => lesson.id === id);

export const createLessonProject = (
  lessonId: ClassroomLessonId,
): ProjectState => {
  const lesson = classroomLessonById(lessonId);
  if (!lesson) throw new Error(`Unknown classroom lesson: ${lessonId}`);

  let project = createSampleProject({
    includeMechanism: lesson.id === "waving-arm",
  });
  const lessonSkeleton = project.skeleton ?? defaultSkeleton();
  let paths = project.paths;
  let mechanisms = project.mechanisms;
  let selectedPartId = project.selectedPartId;
  let selectedPathId = project.selectedPathId;
  let selectedMechanismId = project.selectedMechanismId;
  const persistLessonMechanism = (
    mechanism: MechanismConfig,
    pathId: string,
  ): MechanismConfig => {
    const path = paths[pathId];
    if (!path) return mechanismWithGeneratedPath(mechanism);
    const targeted = { ...mechanism, ...pathOwnedTargetFields(path) };
    const fitProject = {
      ...project,
      paths,
      mechanisms: mechanisms.filter((item) => item.id !== mechanism.id),
    };
    const direct = completeAutomaticFitCandidate(
      fitProject,
      targeted,
      mechanismWithGeneratedPath(targeted),
    );
    const fit = direct.accepted
      ? direct
      : fitMechanismToTargetPathResult(fitProject, targeted, pathId);
    if (!fit.accepted || !fit.readiness.fabricationReady)
      throw new Error(fit.blockers[0] ?? `Lesson mechanism blocked: ${mechanism.id}`);
    return {
      ...fit.mechanism,
      generatedPath: path.points.map((point) => ({ ...point })),
      id: mechanism.id,
      color: mechanism.color,
      visible: mechanism.visible,
      enabled: mechanism.enabled,
      source: mechanism.source,
      presetId: mechanism.presetId,
      recommendation: mechanism.recommendation,
      foundryExport: undefined,
      warnings: [...new Set([...(mechanism.warnings ?? []), ...(fit.mechanism.warnings ?? [])])],
      ...pathOwnedTargetFields(path),
    };
  };

  if (lesson.id === "waving-arm") {
    const armPath = paths["path-right-arm"];
    if (armPath) {
      paths = {
        ...paths,
        [armPath.id]: {
          ...armPath,
          partId: "right_hand_part",
          targetAnchorJointId: "right_hand",
          chainRootJointId: "right_shoulder",
        },
      };
      selectedPartId = "right_hand_part";
      selectedPathId = armPath.id;
    }
    const armFourBar = mechanisms[0];
    if (armFourBar) {
      Object.assign(armFourBar, {
        anchorX: 0,
        anchorY: -40,
        groundAngle: 180,
        groundLength: 160,
        crankLength: 80,
        couplerLength: 160,
        rockerLength: 160,
        couplerPointDist: 40,
        couplerPointAngle: -90,
        assemblyMode: "crossed",
        speed1: 1,
        driverPhaseOffset: 0,
        transform: { x: 0, y: -40, rotation: 180, scale: 1 },
        sceneAnchor: { x: 0, y: -40 },
        targetPartId: "right_hand_part",
        targetPathId: "path-right-arm",
        targetAnchorJointId: "right_hand",
        activeVisualPartIds: ["right_hand_part"],
        recommendation: lesson.description,
      } satisfies Partial<MechanismConfig>);
      mechanisms = [persistLessonMechanism(armFourBar, "path-right-arm")];
      selectedMechanismId = armFourBar.id;
    }
  } else if (lesson.id === "head-bob") {
    const pathId = "path-head-bob";
    const pathDuration = 1600;
    const headTop = skeletonPoint(lessonSkeleton, "head_top");
    paths = {
      [pathId]: {
        id: pathId,
        partId: "head",
        targetAnchorJointId: "head_top",
        chainRootJointId: "neck",
        points: guidedHeadBobPath(lessonSkeleton),
        timedPoints: guidedHeadBobTimedPoints(headTop, pathDuration),
        duration: pathDuration,
        closed: false,
        enabled: true,
        visible: true,
        source: "drawn",
        warnings: [],
      },
    };
    const cam = createDefaultMechanism("cam", "mech-head-bob");
    Object.assign(cam, {
      anchorX: 0,
      anchorY: 200,
      groundAngle: 270,
      driverPhaseOffset: Math.PI / 2,
      crankLength: 30,
      sliderOffset: 5,
      camProfileSamples: [0.84, 0.92, 1, 0.92],
      transform: { x: 0, y: 200, rotation: 270, scale: 1 },
      sceneAnchor: { x: 0, y: 200 },
      targetPartId: "head",
      targetPathId: pathId,
      targetAnchorJointId: "head_top",
      activeVisualPartIds: ["head"],
      source: "manual",
      presetId: "lesson-head-bob",
      recommendation: lesson.description,
    } satisfies Partial<MechanismConfig>);
    mechanisms = [persistLessonMechanism(cam, pathId)];
    selectedPartId = "head";
    selectedPathId = pathId;
    selectedMechanismId = cam.id;
  } else if (lesson.id === "walking-leg") {
    const pathId = "path-right-foot-step";
    const pathDuration = 1900;
    paths = {
      [pathId]: {
        id: pathId,
        partId: "right_foot_part",
        targetAnchorJointId: "right_foot",
        chainRootJointId: "right_hip",
        points: guidedFootStepPath(lessonSkeleton),
        timedPoints: guidedFourBarTimedPoints(
          { x: -120, y: 0 },
          pathDuration,
        ),
        duration: pathDuration,
        closed: true,
        enabled: true,
        visible: true,
        source: "drawn",
        warnings: [],
      },
    };
    const legFourBar = createDefaultMechanism("4bar", "mech-walking-leg");
    Object.assign(legFourBar, {
      anchorX: -120,
      anchorY: 0,
      groundAngle: 0,
      groundLength: 320,
      crankLength: 80,
      couplerLength: 160,
      rockerLength: 320,
      couplerPointDist: 80,
      couplerPointAngle: 0,
      assemblyMode: "crossed",
      speed1: -1,
      driverPhaseOffset: Math.PI,
      transform: { x: -120, y: 0, rotation: 0, scale: 1 },
      sceneAnchor: { x: -120, y: 0 },
      targetPartId: "right_foot_part",
      targetPathId: pathId,
      targetAnchorJointId: "right_foot",
      activeVisualPartIds: ["right_foot_part"],
      source: "manual",
      presetId: "lesson-walking-leg",
      recommendation: lesson.description,
    } satisfies Partial<MechanismConfig>);
    mechanisms = [persistLessonMechanism(legFourBar, pathId)];
    selectedPartId = "right_foot_part";
    selectedPathId = pathId;
    selectedMechanismId = legFourBar.id;
  } else if (lesson.id === "spin-gears") {
    const pathId = "path-gear-spin";
    const pathDuration = 1600;
    const rightShoulder = lessonSkeleton.joints.right_shoulder.position;
    const rightHand = lessonSkeleton.joints.right_hand.position;
    // Both lesson endpoints need real off-axis attachment holes. G1/g8 is an
    // axle-only gear, so the lesson uses the smallest attachment-capable pair.
    // A vertical three-pitch pair stays on the physical sheet while keeping the
    // output circle wholly on the viewer-left side of the character.
    const gearRadii: [number, number] = [60, 60];
    const gearGridStep = project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM;
    const gearAnchorX = -2 * gearGridStep;
    const gearAnchorY = 120;
    const gearGroundAngle = rightHand.y <= rightShoulder.y ? 270 : 90;
    const gear = createDefaultMechanism("gear", "mech-spin-gears");
    Object.assign(gear, {
      anchorX: gearAnchorX,
      anchorY: gearAnchorY,
      groundAngle: gearGroundAngle,
      groundLength: gearRadii[0] + gearRadii[1],
      crankLength: gearRadii[0],
      rockerLength: gearRadii[1],
      gearTrainRadii: gearRadii,
      gearRatio: gearTrainOutputRatio(gearRadii),
      speed2: gearTrainOutputRatio(gearRadii),
      driverPhaseOffset: guidedGearDriverPhaseOffset(gearRadii),
      couplerPointDist: 0,
      couplerPointAngle: 0,
      transform: { x: gearAnchorX, y: gearAnchorY, rotation: gearGroundAngle, scale: 1 },
      sceneAnchor: { x: gearAnchorX, y: gearAnchorY },
      source: "manual",
      presetId: "lesson-spin-gears",
      recommendation: lesson.description,
    } satisfies Partial<MechanismConfig>);
    const outputConnection = resolveMechanismPhysicalConnections(gear).connections.find(
      (connection) => connection.role === "gear.output-pin",
    );
    if (!outputConnection?.local) throw new Error("Spin-gears needs an output attachment hole.");
    const outputCenter = gearTrainCenters(gear).at(-1);
    if (!outputCenter) throw new Error("Spin-gears needs an output gear center.");
    const outputHandleRadius = outputConnection.local.length;
    const outputHandleAngle = outputConnection.local.localAngle;
    paths = {
      [pathId]: {
        id: pathId,
        partId: "right_hand_part",
        targetAnchorJointId: "right_hand",
        chainRootJointId: "right_shoulder",
        points: Array.from({ length: 8 }, (_, index) => {
          const angle = (index / 8) * Math.PI * 2;
          return {
            x: outputCenter.x + outputHandleRadius * Math.cos(angle + outputHandleAngle),
            y: outputCenter.y + outputHandleRadius * Math.sin(angle + outputHandleAngle),
          };
        }),
        timedPoints: guidedGearTimedPoints(
          outputCenter,
          gearRadii,
          outputHandleRadius,
          pathDuration,
          outputHandleAngle,
        ),
        duration: pathDuration,
        closed: true,
        enabled: true,
        visible: true,
        source: "drawn",
        warnings: [],
      },
    };
    Object.assign(gear, {
      targetPartId: "right_hand_part",
      targetPathId: pathId,
      targetAnchorJointId: "right_hand",
      activeVisualPartIds: ["right_hand_part"],
    } satisfies Partial<MechanismConfig>);
    mechanisms = [persistLessonMechanism(gear, pathId)];
    selectedPartId = "right_hand_part";
    selectedPathId = pathId;
    selectedMechanismId = gear.id;
  } else {
    mechanisms = project.mechanisms.map((mechanism) =>
      mechanismWithGeneratedPath(mechanism),
    );
  }

  return {
    ...project,
    metadata: {
      ...project.metadata,
      name: lesson.label,
      classroomLessonId: lesson.id,
      classroomLessonLabel: lesson.label,
    },
    paths,
    mechanisms,
    selectedPartId,
    selectedPathId,
    selectedMechanismId,
    characterPackage: project.characterPackage
      ? {
          ...project.characterPackage,
          replacementContext: {
            mode: "plain-load",
            rebindingSummary: `${lesson.label}: ${lesson.description}`,
          },
        }
      : project.characterPackage,
    processing: {
      stage: "ready",
      message: `${lesson.shortLabel} ready`,
      progress: 100,
    },
  };
};

export const resetProjectToLessonBaseline = (
  project: ProjectState,
): ProjectState | undefined => {
  const lesson = classroomLessonById(project.metadata.classroomLessonId);
  if (!lesson) return undefined;
  const baseline = createLessonProject(lesson.id);
  return revalidateMechanismArtifacts(
    { ...baseline, settings: project.settings },
    baseline.mechanisms,
  );
};

export const replaceCharacterProject = (
  next: ProjectState,
  previous: ProjectState,
  previousStage: AppStage = "character",
): ProjectState => {
  const mechanisms = previous.mechanisms.map((mechanism) =>
    invalidateMechanismArtifacts(mechanism, next.parts),
  );
  return {
    ...next,
    paths: previous.paths,
    mechanisms,
    selectedPartId: previous.selectedPartId,
    selectedPathId: previous.selectedPathId,
    selectedMechanismId: previous.selectedMechanismId,
    lastExport: undefined,
    lastFoundryExport: undefined,
    characterPackage: next.characterPackage
      ? {
          ...next.characterPackage,
          replacementContext: {
            mode: "replace-character",
            previousStage,
            rebindingSummary: MECHANISM_BINDING_BLOCKER,
          },
        }
      : next.characterPackage,
  };
};
export const normalizePartsToSheet = (
  parts: BodyPartLayer[],
  settings = defaultSettings(),
) => {
  if (!parts.length) return { parts, scale: 1, center: { x: 0, y: 0 } };
  const xs = parts.flatMap((p) => [
    p.transform.x + p.bounds.x * p.transform.scale,
    p.transform.x + (p.bounds.x + p.bounds.width) * p.transform.scale,
  ]);
  const ys = parts.flatMap((p) => [
    p.transform.y + p.bounds.y * p.transform.scale,
    p.transform.y + (p.bounds.y + p.bounds.height) * p.transform.scale,
  ]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const sheet = sceneBoundsForSheet(settings.physicalKit);
  const scale = Math.min(
    1,
    (sheet.width * 0.78) / width,
    (sheet.height * 0.78) / height,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    center: { x: cx, y: cy },
    parts: parts.map((p) => ({
      ...p,
      transform: {
        ...p.transform,
        x: (p.transform.x - cx) * scale,
        y: (p.transform.y - cy) * scale,
        scale: p.transform.scale * scale,
      },
    })),
  };
};

const normalizeSkeletonToSheet = (
  skeleton: StandardSkeleton,
  scale: number,
  center: Point,
): StandardSkeleton => {
  const joints = Object.values(skeleton.joints).map((j) => ({
    ...j,
    position: {
      x: (j.position.x - center.x) * scale,
      y: (j.position.y - center.y) * scale,
    },
  }));
  const normalized = buildSkeleton(joints);
  normalized.metadata = {
    ...skeleton.metadata,
    scale: (Number(skeleton.metadata.scale) || 1) * scale,
    normalization: `fit:${scale.toFixed(3)}`,
  };
  return normalized;
};

export const createProjectFromProcessed = (input: {
  name: string;
  sourceImageName: string;
  skeleton: StandardSkeleton;
  parts: BodyPartLayer[];
  textureUrl?: string;
  maskUrl?: string;
  keypoints?: unknown;
  replacementContext?: CharacterPackageArtifact["replacementContext"];
}): ProjectState => {
  const base = createEmptyProject();
  const normalized = normalizePartsToSheet(input.parts, base.settings);
  const parts = Object.fromEntries(normalized.parts.map((p) => [p.id, p]));
  const characterPackage: CharacterPackageArtifact = {
    id: `char-${Date.now().toString(36)}`,
    createdAt: nowIso(),
    sourceImageName: input.sourceImageName,
    outputDir: `web-onnx://${input.sourceImageName}`,
    partsInfo: {
      parts: Object.fromEntries(
        normalized.parts.map((p) => [
          p.id,
          {
            name: p.name,
            texture_path: p.textureUrl ? `${p.id}.png` : undefined,
            mask_path: p.maskUrl ? `${p.id}-mask.png` : undefined,
            original_svg_path: p.originalSvgPath,
            enhanced_svg_path: p.enhancedSvgPath,
            anchor_joint_id: p.anchorJointId,
            transform: p.transform,
            z_index: p.zIndex,
            opacity: p.opacity,
            visible: p.visible,
            fixed: p.locked,
            roi: [p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height],
            contour_points: p.contourPoints,
            contour_source: p.contourSource,
            local_pivot_offset: p.localPivotOffset
              ? [p.localPivotOffset.x, p.localPivotOffset.y]
              : undefined,
            local_pivot_joint_id: p.localPivotJointId ?? p.anchorJointId,
            fill_color: p.fillColor,
          },
        ]),
      ),
    },
    charCfg: {
      width: input.skeleton.metadata.imageBounds?.width,
      height: input.skeleton.metadata.imageBounds?.height,
      joints: input.skeleton.joints,
      bones: input.skeleton.bones,
      root_joint_ids: input.skeleton.rootJointIds,
      metadata: input.skeleton.metadata,
    },
    maskUrl: input.maskUrl,
    sourceTextureUrl: input.textureUrl,
    keypoints: input.keypoints,
    replacementContext: input.replacementContext,
  };
  return {
    ...base,
    metadata: {
      ...base.metadata,
      name: input.name,
      sourceImageName: input.sourceImageName,
      normalizationScale: normalized.scale,
      status: "processed",
      updatedAt: nowIso(),
    },
    parts,
    partOrder: normalized.parts
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((p) => p.id),
    skeleton: normalizeSkeletonToSheet(
      input.skeleton,
      normalized.scale,
      normalized.center,
    ),
    mechanisms: [],
    selectedMechanismId: undefined,
    selectedPartId: normalized.parts[0]?.id,
    characterPackage,
    processing: {
      stage: "ready",
      message: "Character package ready",
      progress: 100,
    },
  };
};

const touch = (
  project: ProjectState,
  options: { preserveExport?: boolean; preserveFoundryExport?: boolean } = {},
): ProjectState => ({
  ...project,
  lastExport: options.preserveExport ? project.lastExport : undefined,
  lastFoundryExport: options.preserveFoundryExport
    ? project.lastFoundryExport
    : undefined,
  metadata: { ...project.metadata, updatedAt: nowIso() },
});

export const handoffGate = (
  project: ProjectState,
  targetStage: import("../types").AppStage,
) => {
  const fail = (
    message: string,
    recoveryStage: import("../types").AppStage = "character",
  ) => ({ ok: false as const, message, recoveryStage });
  const mechanisms = project.mechanisms.filter(
    (m) => m.visible && m.enabled !== false,
  );
  if (targetStage === "character" || targetStage === "options")
    return { ok: true as const, message: "Ready" };
  if (!project.partOrder.length)
    return fail("Load a character package before entering this workflow.");
  if (targetStage === "path")
    return project.skeleton || project.metadata.status === "sample"
      ? { ok: true as const, message: "Parts ready" }
      : fail("Skeleton missing or unreadable.");
  if (targetStage === "foundry")
    return { ok: true as const, message: "Parts ready for mechanism search" };
  if (targetStage === "design")
    return {
      ok: true as const,
      message: mechanisms.length
        ? "Mechanisms ready"
        : "Parts ready; add a mechanism in Design",
    };
  if (targetStage === "blueprint" || targetStage === "assembly")
    return mechanisms.every(
      (m) => m.id && Number.isFinite(m.anchorX) && Number.isFinite(m.anchorY),
    )
      ? { ok: true as const, message: "Fabrication inputs ready" }
      : fail(
          "Each enabled mechanism needs an id and board anchor before Blueprint.",
          "design",
        );
  return { ok: true as const, message: "Ready" };
};

export const applyProjectAction = (
  project: ProjectState,
  action: ProjectAction,
): ProjectState => {
  switch (action.type) {
    case "load_project": {
      const loaded = loadProjectSnapshot(action.project, project);
      return loaded.status === "loaded" ? loaded.project : project;
    }
    case "set_processing":
      return { ...project, processing: action.processing };
    case "select_part": {
      const nextPath = Object.values(project.paths).find(
        (path) => !path.sceneObjectId && path.partId === action.partId,
      );
      return {
        ...project,
        selectedPartId: action.partId,
        selectedSceneObjectId: undefined,
        selectedPathId: nextPath?.id,
      };
    }
    case "upsert_part": {
      const exists = Boolean(project.parts[action.part.id]);
      if (
        exists &&
        action.part.anchorJointId &&
        !project.skeleton?.joints[action.part.anchorJointId]
      ) return project;
      const parts = { ...project.parts, [action.part.id]: action.part };
      const partOrder = exists
        ? project.partOrder
        : [...project.partOrder, action.part.id];
      const nextPartProject = { ...project, parts };
      if (exists && invalidatesAcceptedBinding(project, nextPartProject))
        return project;
      return touch({
        ...nextPartProject,
        partOrder,
        selectedPartId: action.part.id,
        selectedSceneObjectId: undefined,
      });
    }
    case "delete_part": {
      if (project.parts[action.partId]?.locked) return project;
      const { [action.partId]: _part, ...parts } = project.parts;
      const removedPathIds = new Set(
        Object.values(project.paths)
          .filter((path) => !path.sceneObjectId && path.partId === action.partId)
          .map((path) => path.id),
      );
      const paths = Object.fromEntries(
        Object.entries(project.paths).filter(
          ([, path]) => path.sceneObjectId || path.partId !== action.partId,
        ),
      );
      const mechanisms = project.mechanisms.map((m) =>
        m.targetPartId === action.partId || removedPathIds.has(m.targetPathId ?? "")
          ? invalidateMechanismArtifacts(m, parts)
          : m,
      );
      const nextPartId = project.partOrder.find((id) => id !== action.partId);
      return touch({
        ...project,
        parts,
        paths,
        mechanisms,
        partOrder: project.partOrder.filter((id) => id !== action.partId),
        selectedPartId:
          project.selectedPartId === action.partId
            ? nextPartId
            : project.selectedPartId,
        selectedPathId:
          project.paths[project.selectedPathId ?? ""]?.partId === action.partId
            ? undefined
            : project.selectedPathId,
      });
    }
    case "update_part":
      if (!project.parts[action.partId]) return project;
      if (
        action.updates.anchorJointId &&
        !project.skeleton?.joints[action.updates.anchorJointId]
      )
        return project;
      if (
        project.parts[action.partId].locked &&
        Object.keys(action.updates).some((key) => key !== "locked")
      )
        return project;
      const updatedPartProject = {
        ...project,
        parts: {
          ...project.parts,
          [action.partId]: {
            ...project.parts[action.partId],
            ...action.updates,
          },
        },
      };
      if (
        action.updates.anchorJointId !== undefined &&
        invalidatesAcceptedBinding(project, updatedPartProject)
      ) return project;
      return touch(updatedPartProject);
    case "reorder_part": {
      if (project.parts[action.partId]?.locked) return project;
      const order = [...project.partOrder];
      const i = order.indexOf(action.partId);
      const j = i + action.direction;
      if (i < 0 || j < 0 || j >= order.length) return project;
      [order[i], order[j]] = [order[j], order[i]];
      return touch({ ...project, partOrder: order });
    }
    case "select_scene_object": {
      const nextPath = Object.values(project.paths).find(
        (path) => path.sceneObjectId === action.objectId,
      );
      return {
        ...project,
        selectedSceneObjectId: action.objectId,
        selectedPartId: action.objectId ? undefined : project.selectedPartId,
        selectedPathId: nextPath?.id,
      };
    }
    case "upsert_scene_object": {
      const exists = Boolean(project.sceneObjects[action.object.id]);
      const sceneObjects = {
        ...project.sceneObjects,
        [action.object.id]: action.object,
      };
      const sceneObjectOrder = exists
        ? project.sceneObjectOrder
        : [...project.sceneObjectOrder, action.object.id];
      const nextPath = Object.values(project.paths).find(
        (path) => path.sceneObjectId === action.object.id,
      );
      return touch({
        ...project,
        sceneObjects,
        sceneObjectOrder,
        selectedSceneObjectId: action.object.id,
        selectedPartId: undefined,
        selectedPathId: nextPath?.id,
      });
    }
    case "update_scene_object":
      if (!project.sceneObjects[action.objectId]) return project;
      if (
        project.sceneObjects[action.objectId].locked &&
        Object.keys(action.updates).some((key) => key !== "locked")
      )
        return project;
      return touch({
        ...project,
        sceneObjects: {
          ...project.sceneObjects,
          [action.objectId]: {
            ...project.sceneObjects[action.objectId],
            ...action.updates,
          },
        },
      });
    case "delete_scene_object": {
      if (project.sceneObjects[action.objectId]?.locked) return project;
      const { [action.objectId]: _object, ...sceneObjects } =
        project.sceneObjects;
      const paths = Object.fromEntries(
        Object.entries(project.paths).filter(
          ([, path]) => path.sceneObjectId !== action.objectId,
        ),
      );
      const removedPathIds = new Set(
        Object.values(project.paths)
          .filter((path) => path.sceneObjectId === action.objectId)
          .map((path) => path.id),
      );
      const mechanisms = project.mechanisms.map((m) =>
        m.targetSceneObjectId === action.objectId || removedPathIds.has(m.targetPathId ?? "")
          ? invalidateMechanismArtifacts(m, project.parts)
          : m,
      );
      return touch({
        ...project,
        sceneObjects,
        paths,
        mechanisms,
        sceneObjectOrder: project.sceneObjectOrder.filter(
          (id) => id !== action.objectId,
        ),
        selectedSceneObjectId:
          project.selectedSceneObjectId === action.objectId
            ? undefined
            : project.selectedSceneObjectId,
        selectedPathId:
          project.paths[project.selectedPathId ?? ""]?.sceneObjectId ===
          action.objectId
            ? undefined
            : project.selectedPathId,
      });
    }
    case "set_skeleton":
      return touch(invalidateOrphanedMechanisms({
        ...project,
        skeleton: action.skeleton,
      }));
    case "update_joint": {
      if (!project.skeleton?.joints[action.jointId]) return project;
      if (
        project.skeleton.joints[action.jointId].locked &&
        Object.keys(action.updates).some((key) => key !== "locked")
      )
        return project;
      if (
        action.updates.parentId !== undefined &&
        ((action.updates.parentId &&
          !project.skeleton.joints[action.updates.parentId]) ||
          wouldCreateCycle(
            project.skeleton.joints,
            action.jointId,
            action.updates.parentId,
          ))
      )
        return project;
      const joints = {
        ...project.skeleton.joints,
        [action.jointId]: {
          ...project.skeleton.joints[action.jointId],
          ...action.updates,
        },
      };
      const skeleton = buildSkeleton(Object.values(joints));
      const moved = action.updates.position && skeleton.joints[action.jointId];
      const parts = moved
        ? Object.fromEntries(
            Object.entries(project.parts).map(([id, part]) => [
              id,
              part.anchorJointId === action.jointId
                ? {
                    ...part,
                    localPivotOffset: localPivotOffsetForScene(
                      part,
                      skeleton.joints[action.jointId].position,
                    ),
                    localPivotJointId: action.jointId,
                  }
                : part,
            ]),
          )
        : project.parts;
      const updatedJointProject = { ...project, parts, skeleton };
      if (
        action.updates.parentId !== undefined &&
        invalidatesAcceptedBinding(project, updatedJointProject)
      ) return project;
      return touch(updatedJointProject);
    }
    case "add_joint":
      return touch({
        ...project,
        skeleton: buildSkeleton([
          ...(project.skeleton ? Object.values(project.skeleton.joints) : []),
          action.joint,
        ]),
      });
    case "remove_joint": {
      if (!project.skeleton) return project;
      const remove = new Set([action.jointId]);
      let changed = true;
      while (changed) {
        changed = false;
        Object.values(project.skeleton.joints).forEach((j) => {
          if (j.parentId && remove.has(j.parentId) && !remove.has(j.id)) {
            remove.add(j.id);
            changed = true;
          }
        });
      }
      if ([...remove].some((id) => project.skeleton?.joints[id]?.locked))
        return project;
      const remaining = Object.values(project.skeleton.joints).filter(
        (j) => !remove.has(j.id),
      );
      return touch(invalidateOrphanedMechanisms({
        ...project,
        skeleton: buildSkeleton(remaining),
      }));
    }
    case "upsert_path": {
      const path = validatePath(action.path);
      if (
        path.sceneObjectId
          ? project.sceneObjects[path.sceneObjectId]?.locked
          : project.parts[path.partId]?.locked
      )
        return project;
      const previousPath = project.paths[path.id]
        ? validatePath(project.paths[path.id])
        : undefined;
      const paths = { ...project.paths, [path.id]: path };
      const nextPathProject = { ...project, paths };
      if (
        previousPath &&
        invalidatesAcceptedBinding(project, nextPathProject)
      ) return project;
      const mechanisms = project.mechanisms.map((m) =>
        m.targetPathId === path.id
          ? pathGeneratedGeometryUnchanged(previousPath, path)
            ? m
            : invalidateMechanismArtifacts(m, project.parts)
          : m,
      );
      return touch({ ...nextPathProject, mechanisms, selectedPathId: path.id });
    }
    case "delete_path": {
      const current = project.paths[action.pathId];
      if (
        current &&
        (current.sceneObjectId
          ? project.sceneObjects[current.sceneObjectId]?.locked
          : project.parts[current.partId]?.locked)
      )
        return project;
      const { [action.pathId]: _removed, ...paths } = project.paths;
      const mechanisms = project.mechanisms.map((m) =>
        m.targetPathId === action.pathId
          ? invalidateMechanismArtifacts(m, project.parts)
          : m,
      );
      return touch({
        ...project,
        paths,
        mechanisms,
        selectedPathId:
          project.selectedPathId === action.pathId
            ? undefined
            : project.selectedPathId,
      });
    }
    case "set_mechanisms": {
      const mechanisms: MechanismConfig[] = [];
      for (const candidate of action.mechanisms) {
        const previous = project.mechanisms.find((item) => item.id === candidate.id);
        const attempt = resolveMechanismEditAttempt(project, previous, candidate);
        if (attempt.status !== "accepted") return project;
        mechanisms.push(attempt.mechanism);
      }
      const preservesExactPrior =
        mechanisms.length === project.mechanisms.length &&
        mechanisms.every((mechanism, index) => mechanism === project.mechanisms[index]);
      const requestedSelection =
        action.selectedMechanismId ?? project.selectedMechanismId;
      if (preservesExactPrior) {
        const selectedMechanismId =
          requestedSelection &&
          mechanisms.some((mechanism) => mechanism.id === requestedSelection)
            ? requestedSelection
            : project.selectedMechanismId;
        return selectedMechanismId === project.selectedMechanismId
          ? project
          : touch({ ...project, selectedMechanismId });
      }
      const next = {
        ...project,
        mechanisms,
        selectedMechanismId:
          requestedSelection &&
          mechanisms.some((mechanism) => mechanism.id === requestedSelection)
            ? requestedSelection
            : project.selectedMechanismId,
      };
      return introducesMechanismDriverConflict(project, next) ? project : touch(next);
    }
    case "upsert_mechanism": {
      const selectedMechanism = project.mechanisms.find(
        (mechanism) => mechanism.id === project.selectedMechanismId,
      );
      const replacementCandidateById = action.replaceMechanismId
        ? project.mechanisms.find(
            (mechanism) => mechanism.id === action.replaceMechanismId,
          )
        : undefined;
      const replacementCandidateBySelection =
        action.mechanism.id === project.selectedMechanismId &&
        selectedMechanism?.type === action.mechanism.type
          ? selectedMechanism
          : undefined;
      const replacementCandidate =
        replacementCandidateById ?? replacementCandidateBySelection;
      const resolvedMechanismId = replacementCandidate
        ? replacementCandidate.id
        : action.mechanism.id;
      const replacementSeedTargets = replacementCandidate
        ? {
            targetPartId: replacementCandidate.targetPartId,
            targetSceneObjectId: replacementCandidate.targetSceneObjectId,
            targetPathId: replacementCandidate.targetPathId,
            targetAnchorJointId: replacementCandidate.targetAnchorJointId,
            activeVisualPartIds: replacementCandidate.activeVisualPartIds,
          }
        : {
            targetPartId: undefined,
            targetSceneObjectId: undefined,
            targetPathId: undefined,
            targetAnchorJointId: undefined,
            activeVisualPartIds: undefined,
          };
      const mergedIncomingMechanism = {
        ...action.mechanism,
        targetPartId:
          !Object.hasOwn(action.mechanism, "targetPartId")
            ? replacementSeedTargets.targetPartId
            : action.mechanism.targetPartId,
        targetSceneObjectId:
          !Object.hasOwn(action.mechanism, "targetSceneObjectId")
            ? replacementSeedTargets.targetSceneObjectId
            : action.mechanism.targetSceneObjectId,
        targetPathId:
          !Object.hasOwn(action.mechanism, "targetPathId")
            ? replacementSeedTargets.targetPathId
            : action.mechanism.targetPathId,
        targetAnchorJointId:
          !Object.hasOwn(action.mechanism, "targetAnchorJointId")
            ? replacementSeedTargets.targetAnchorJointId
            : action.mechanism.targetAnchorJointId,
        activeVisualPartIds:
          !Object.hasOwn(action.mechanism, "activeVisualPartIds")
            ? replacementSeedTargets.activeVisualPartIds
            : action.mechanism.activeVisualPartIds,
      };

      const mechanism = {
        ...mergedIncomingMechanism,
        id: resolvedMechanismId,
      };
      const previous = project.mechanisms.find((m) => m.id === mechanism.id);
      const result = resolveMechanismEditAttempt(project, previous, mechanism);
      if (result.status !== "accepted") return project;
      const accepted = result.mechanism;
      if (mechanismDriverConflict(project, accepted)) return project;
      const mechanisms = previous
        ? project.mechanisms.map((m) => (m.id === accepted.id ? accepted : m))
        : [...project.mechanisms, accepted];
      return touch({
        ...project,
        mechanisms,
        selectedMechanismId: accepted.id,
      });
    }
    case "commit_mechanism_candidate": {
      const { result } = action;
      if (result.status === "blocked") return project;
      const previous = project.mechanisms.find(
        (mechanism) => mechanism.id === result.mechanism.id,
      );
      if (previous === result.mechanism && !result.foundryExport) return project;
      const attempt = resolveMechanismEditAttempt(
        project,
        previous,
        result.mechanism,
      );
      if (attempt.status !== "accepted") return project;
      const accepted = result.foundryExport
        ? { ...attempt.mechanism, foundryExport: result.foundryExport }
        : (() => {
            const { foundryExport: _foundryExport, ...withoutPackage } =
              attempt.mechanism;
            return withoutPackage as MechanismConfig;
          })();
      if (mechanismDriverConflict(project, accepted)) return project;
      const mechanisms = previous
        ? project.mechanisms.map((mechanism) =>
            mechanism.id === accepted.id ? accepted : mechanism,
          )
        : [...project.mechanisms, accepted];
      return touch(
        {
          ...project,
          mechanisms,
          selectedMechanismId: accepted.id,
          lastFoundryExport: result.foundryExport,
        },
        { preserveFoundryExport: Boolean(result.foundryExport) },
      );
    }
    case "delete_mechanism":
      return touch({
        ...project,
        mechanisms: project.mechanisms.filter(
          (m) => m.id !== action.mechanismId,
        ),
        selectedMechanismId:
          project.selectedMechanismId === action.mechanismId
            ? undefined
            : project.selectedMechanismId,
      });
    case "update_settings": {
      const settings = normalizeAppSettings(
        {
          ...project.settings,
          ...action.settings,
          physicalKit: {
            ...project.settings.physicalKit,
            ...(action.settings.physicalKit ?? {}),
          },
        },
        project.settings,
      );
      const invalidatesExport = Boolean(
        action.settings.physicalKit ||
        action.settings.fabricationReadyMode !== undefined ||
        action.settings.physicsSnapMode !== undefined ||
        action.settings.simulationFriction !== undefined ||
        action.settings.simulationMassKg !== undefined,
      );
      const nextProject = action.settings.physicalKit
        ? revalidateMechanismArtifacts(
            { ...project, settings },
            project.mechanisms,
          )
        : { ...project, settings };
      return invalidatesExport
        ? touch(nextProject)
        : nextProject;
    }
    case "set_export":
      return touch(
        { ...project, lastExport: action.fabricationPackage },
        { preserveExport: true },
      );
    default:
      return project;
  }
};

export const validatePath = (path: ProjectMotionPath): ProjectMotionPath => {
  const raw = asRecord(path);
  const points = Array.isArray(raw.points)
    ? raw.points.map((p) => sanitizePoint(p)).slice(0, 2000)
    : [];
  const source = ["drawn", "tracked", "generated", "imported"].includes(
    String(raw.source),
  )
    ? (raw.source as ProjectMotionPath["source"])
    : "imported";
  const sceneObjectId =
    typeof raw.sceneObjectId === "string" && raw.sceneObjectId.trim()
      ? raw.sceneObjectId.slice(0, 80)
      : undefined;
  const normalized: ProjectMotionPath = {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.slice(0, 80)
        : uid("path"),
    partId: sceneObjectId
      ? ""
      : typeof raw.partId === "string"
        ? raw.partId
        : "",
    sceneObjectId,
    targetAnchorJointId:
      !sceneObjectId &&
      typeof raw.targetAnchorJointId === "string" &&
      raw.targetAnchorJointId.trim()
        ? raw.targetAnchorJointId.slice(0, 80)
        : undefined,
    chainRootJointId:
      !sceneObjectId &&
      typeof raw.chainRootJointId === "string" &&
      raw.chainRootJointId.trim()
        ? raw.chainRootJointId.slice(0, 80)
        : undefined,
    smoothness: clampNumber(raw.smoothness, 0, 0, 100),
    points,
    timedPoints: Array.isArray(raw.timedPoints)
      ? raw.timedPoints
          .map((p) => ({
            ...sanitizePoint(p),
            time: finiteNumber(asRecord(p).time, 0),
          }))
          .slice(0, 2000)
      : undefined,
    duration: clampNumber(raw.duration, 1800, 100, 120000),
    closed: raw.closed === undefined ? true : Boolean(raw.closed),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    source,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map(String).slice(0, 20)
      : [],
  };
  return {
    ...normalized,
    warnings: [
      ...normalized.warnings,
      ...(normalized.points.length < 3 ? ["Path needs at least 3 points"] : []),
      ...(normalized.enabled && normalized.points.length > 1
        ? []
        : ["Path disabled or empty"]),
    ],
  };
};

export const serializeProject = (project: ProjectState): string =>
  JSON.stringify({ ...project, version: APP_STATE_VERSION }, null, 2);

const normalizeSkeletonSnapshot = (
  skeleton: unknown,
): StandardSkeleton | null => {
  if (!skeleton || typeof skeleton !== "object") return null;
  const raw = skeleton as Partial<StandardSkeleton> & {
    skeleton?: Array<{
      name?: string;
      loc?: [number, number];
      parent?: string | null;
    }>;
  };
  if (Array.isArray(raw.skeleton)) {
    return buildSkeleton(
      raw.skeleton.map((item) => ({
        id: item.name ?? uid("joint"),
        name: item.name ?? "joint",
        position: Array.isArray(item.loc)
          ? { x: Number(item.loc[0]) || 0, y: Number(item.loc[1]) || 0 }
          : { x: 0, y: 0 },
        parentId: item.parent ?? null,
        locked: false,
        bendDirection: 1,
      })),
    );
  }
  const joints =
    raw.joints && typeof raw.joints === "object"
      ? Object.values(raw.joints)
      : [];
  if (!joints.length) return null;
  const normalized = joints.map((jointLike: unknown) => {
    const j = jointLike as Partial<StandardJoint> & {
      loc?: [number, number];
      position?: Point;
    };
    return {
      id: String(j.id || j.name || uid("joint")),
      name: String(j.name || j.id || "joint"),
      position:
        j.position ??
        (Array.isArray(j.loc)
          ? { x: Number(j.loc[0]) || 0, y: Number(j.loc[1]) || 0 }
          : { x: 0, y: 0 }),
      parentId: j.parentId ?? null,
      locked: Boolean(j.locked),
      bendDirection: Number.isFinite(j.bendDirection)
        ? Number(j.bendDirection)
        : 1,
    } satisfies StandardJoint;
  });
  const rebuilt = buildSkeleton(normalized);
  rebuilt.metadata = { ...rebuilt.metadata, ...(raw.metadata ?? {}) };
  return rebuilt;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const normalizeTransformSnapshot = (
  value: unknown,
  fallback: Transform = { x: 0, y: 0, rotation: 0, scale: 1 },
): Transform => {
  const raw = asRecord(value);
  return {
    x: finiteNumber(raw.x, fallback.x),
    y: finiteNumber(raw.y, fallback.y),
    rotation: finiteNumber(raw.rotation, fallback.rotation),
    scale: clampNumber(raw.scale, fallback.scale, 0.01, 20),
  };
};

const normalizeContourPoints = (value: unknown): Point[] | undefined => {
  const points = Array.isArray(value)
    ? value
        .flatMap((point) => {
          const raw = Array.isArray(point)
            ? { x: point[0], y: point[1] }
            : asRecord(point);
          const x = Number(raw.x);
          const y = Number(raw.y);
          return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
        })
        .slice(0, 256)
    : [];
  return isUsableContourPoints(points) ? points : undefined;
};

const safeRasterTextureUrl = (value: unknown): string | undefined =>
  typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);/i.test(value)
    ? value
    : undefined;

const normalizePartSnapshot = (
  id: string,
  value: unknown,
  skeleton: StandardSkeleton | null,
): BodyPartLayer => {
  const raw = asRecord(value);
  const fallbackAnchor =
    skeleton?.rootJointIds[0] ??
    Object.keys(skeleton?.joints ?? {})[0] ??
    "root";
  const requestedAnchor =
    typeof raw.anchorJointId === "string" ? raw.anchorJointId : fallbackAnchor;
  const anchorJointId = skeleton?.joints[requestedAnchor]
    ? requestedAnchor
    : fallbackAnchor;
  const rawBounds = asRecord(raw.bounds);
  const rawPivot = raw.localPivotOffset;
  const textureUrl =
    typeof raw.textureUrl === "string" &&
    raw.textureUrl.startsWith("data:image/")
      ? raw.textureUrl
      : undefined;
  const maskUrl =
    typeof raw.maskUrl === "string" && raw.maskUrl.startsWith("data:image/")
      ? raw.maskUrl
      : undefined;
  const rawSourceFrame = asRecord(
    raw.sourceImageFrame ?? raw.source_image_frame,
  );
  const sourceImageFrame =
    rawSourceFrame.width !== undefined && rawSourceFrame.height !== undefined
      ? {
          x: finiteNumber(rawSourceFrame.x, 0),
          y: finiteNumber(rawSourceFrame.y, 0),
          width: clampNumber(rawSourceFrame.width, 1, 1, 20000),
          height: clampNumber(rawSourceFrame.height, 1, 1, 20000),
        }
      : undefined;
  const contourPoints = normalizeContourPoints(
    raw.contourPoints ??
      raw.contour_points ??
      raw.outlinePoints ??
      raw.outline_points,
  );
  const rawContourSource = raw.contourSource ?? raw.contour_source;
  const contourSource =
    rawContourSource === "onnx-mask" ||
    rawContourSource === "user" ||
    rawContourSource === "imported"
      ? rawContourSource
      : contourPoints
        ? "imported"
        : undefined;
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.slice(0, 80)
        : id,
    textureUrl,
    maskUrl,
    sourceImageFrame,
    contourPoints,
    contourSource,
    originalSvgPath:
      typeof raw.originalSvgPath === "string"
        ? raw.originalSvgPath
        : typeof raw.original_svg_path === "string"
          ? raw.original_svg_path
          : undefined,
    enhancedSvgPath:
      typeof raw.enhancedSvgPath === "string"
        ? raw.enhancedSvgPath
        : typeof raw.enhanced_svg_path === "string"
          ? raw.enhanced_svg_path
          : undefined,
    anchorJointId,
    transform: normalizeTransformSnapshot(raw.transform),
    zIndex: finiteNumber(raw.zIndex, 0),
    opacity: clampNumber(raw.opacity, 0.9, 0, 1),
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    locked: Boolean(raw.locked),
    selectable: typeof raw.selectable === "boolean" ? raw.selectable : true,
    bounds: {
      x: finiteNumber(rawBounds.x, -40),
      y: finiteNumber(rawBounds.y, -40),
      width: clampNumber(rawBounds.width, 80, 1, 10000),
      height: clampNumber(rawBounds.height, 80, 1, 10000),
    },
    localPivotOffset: rawPivot ? sanitizePoint(rawPivot) : undefined,
    localPivotJointId:
      typeof raw.localPivotJointId === "string"
        ? raw.localPivotJointId
        : typeof raw.local_pivot_joint_id === "string"
          ? raw.local_pivot_joint_id
          : rawPivot
            ? anchorJointId
            : undefined,
    group: typeof raw.group === "string" ? raw.group.slice(0, 80) : undefined,
    fillColor: sanitizeHexColor(raw.fillColor, "#64748b"),
  };
};

const normalizeSceneObjectSnapshot = (
  id: string,
  value: unknown,
): SceneObject => {
  const raw = asRecord(value);
  const shape = pickOne(
    raw.shape,
    ["piggy-bank", "cloud", "star", "block"] as const,
    "block",
  );
  const rawBounds = asRecord(raw.bounds);
  const textureUrl = safeRasterTextureUrl(raw.textureUrl);
  const contourPoints = normalizeContourPoints(
    raw.contourPoints ??
      raw.contour_points ??
      raw.outlinePoints ??
      raw.outline_points,
  );
  const rawContourSource = raw.contourSource ?? raw.contour_source;
  const contourSource =
    rawContourSource === "user" || rawContourSource === "imported"
      ? rawContourSource
      : contourPoints
        ? "imported"
        : undefined;
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.slice(0, 80)
        : id,
    shape,
    textureUrl,
    contourPoints,
    contourSource,
    sourceImageName:
      typeof raw.sourceImageName === "string"
        ? raw.sourceImageName.slice(0, 120)
        : typeof raw.source_image_name === "string"
          ? raw.source_image_name.slice(0, 120)
          : undefined,
    transform: normalizeTransformSnapshot(raw.transform),
    bounds: {
      width: clampNumber(rawBounds.width, 72, 8, 600),
      height: clampNumber(rawBounds.height, 56, 8, 600),
    },
    fillColor: sanitizeHexColor(raw.fillColor, "#c4b5fd"),
    opacity: clampNumber(raw.opacity, 0.92, 0, 1),
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    locked: Boolean(raw.locked),
    zIndex: Math.round(clampNumber(raw.zIndex, 20, -100, 100)),
  };
};

export const normalizeMechanismSnapshot = (
  value: unknown,
  sourceVersion: 1 | 2 = APP_STATE_VERSION,
  kit = defaultPhysicalKit(),
): MechanismConfig => {
  const raw = asRecord(value);
  const type = sanitizeMechanismType(raw.type);
  const base = createDefaultMechanism(
    type,
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.slice(0, 80)
      : uid("mech"),
  );
  const optionalNumber = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const parsed = finiteNumber(v, Number.NaN);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const anchor = {
    x: optionalNumber(raw.anchorX) ?? base.anchorX ?? 0,
    y: optionalNumber(raw.anchorY) ?? base.anchorY ?? 0,
  };
  const activeVisualPartIds = Array.isArray(raw.activeVisualPartIds)
    ? raw.activeVisualPartIds.map(String).slice(0, 50)
    : typeof raw.targetPartId === "string"
      ? [raw.targetPartId]
      : [];
  const crankLength = finiteNumber(raw.crankLength, base.crankLength);
  const rockerLength = finiteNumber(raw.rockerLength, base.rockerLength);
  const gearTrainRadii = Array.isArray(raw.gearTrainRadii)
    ? raw.gearTrainRadii
        .map((value, index) => finiteNumber(value, base.gearTrainRadii?.[index] ?? 1))
        .slice(0, 8)
    : type === "gear" || type === "gear_linkage"
      ? [crankLength, rockerLength]
      : base.gearTrainRadii;
  const gearRatio = raw.gearRatio === undefined
    ? base.gearRatio
    : finiteNumber(raw.gearRatio, base.gearRatio ?? 1);
  const camProfileSamples = Array.isArray(raw.camProfileSamples)
    ? raw.camProfileSamples
        .map((value, index) => finiteNumber(value, base.camProfileSamples?.[index] ?? 0))
        .slice(0, 64)
    : base.camProfileSamples;
  const normalized: MechanismConfig = {
    ...base,
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.slice(0, 80)
        : base.id,
    type,
    visible: typeof raw.visible === "boolean" ? raw.visible : base.visible,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    color: sanitizeHexColor(raw.color, base.color),
    anchorX: optionalNumber(raw.anchorX),
    anchorY: optionalNumber(raw.anchorY),
    transform: normalizeTransformSnapshot(raw.transform, {
      x: anchor.x,
      y: anchor.y,
      rotation: finiteNumber(raw.groundAngle, base.groundAngle ?? 0),
      scale: 1,
    }),
    sceneAnchor: sanitizePoint(raw.sceneAnchor, anchor),
    activeVisualPartIds,
    fabricationMetadata: undefined,
    foundryExport: undefined,
    groundAngle: finiteNumber(raw.groundAngle, base.groundAngle ?? 0),
    groundLength: finiteNumber(raw.groundLength, base.groundLength),
    crankLength,
    couplerLength: finiteNumber(raw.couplerLength, base.couplerLength),
    rockerLength,
    sliderOffset: finiteNumber(raw.sliderOffset, base.sliderOffset),
    couplerPointDist: finiteNumber(raw.couplerPointDist, base.couplerPointDist),
    couplerPointAngle: finiteNumber(
      raw.couplerPointAngle,
      base.couplerPointAngle,
    ),
    assemblyMode:
      raw.assemblyMode === "crossed"
        ? "crossed"
        : raw.assemblyMode === "open"
          ? "open"
          : base.assemblyMode,
    speed1: finiteNumber(raw.speed1, base.speed1 ?? 1),
    speed2: finiteNumber(raw.speed2, base.speed2 ?? 1),
    gearRatio,
    gearTrainRadii,
    camProfileSamples,
    driverGroupId:
      typeof raw.driverGroupId === "string" && raw.driverGroupId.trim()
        ? raw.driverGroupId.slice(0, 80)
        : base.driverGroupId,
    driverPhaseOffset: finiteNumber(
      raw.driverPhaseOffset,
      base.driverPhaseOffset ?? 0,
    ),
    rodLength:
      raw.rodLength === undefined
        ? base.rodLength
        : finiteNumber(raw.rodLength, base.rodLength ?? 0),
    phase: finiteNumber(raw.phase, base.phase ?? 0),
    showOutputGear:
      typeof raw.showOutputGear === "boolean"
        ? raw.showOutputGear
        : base.showOutputGear,
    outputGearRadius:
      raw.outputGearRadius === undefined
        ? base.outputGearRadius
        : finiteNumber(raw.outputGearRadius, base.outputGearRadius ?? 0),
    targetPartId:
      typeof raw.targetPartId === "string" ? raw.targetPartId : undefined,
    targetSceneObjectId:
      typeof raw.targetSceneObjectId === "string"
        ? raw.targetSceneObjectId
        : undefined,
    targetPathId:
      typeof raw.targetPathId === "string" ? raw.targetPathId : undefined,
    targetAnchorJointId:
      typeof raw.targetAnchorJointId === "string"
        ? raw.targetAnchorJointId
        : undefined,
    presetId: typeof raw.presetId === "string" ? raw.presetId : base.presetId,
    recommendation:
      typeof raw.recommendation === "string"
        ? raw.recommendation
        : base.recommendation,
    source: ["manual", "foundry", "optimized", "imported"].includes(
      String(raw.source),
    )
      ? (raw.source as MechanismConfig["source"])
      : base.source,
    generatedPath: Array.isArray(raw.generatedPath)
      ? raw.generatedPath.map((p) => sanitizePoint(p)).slice(0, 1000)
      : undefined,
    warnings: [],
  };
  const connectionState = normalizeMechanismConnectionSelections(
    normalized,
    raw.connectionSelections,
    (raw as Partial<MechanismConfig>).connectionSelectionValidation,
    {
      sourceVersion,
      kit,
      priorDiagnostics: Array.isArray(raw.rejectedConnectionSelectionDiagnostics)
        ? raw.rejectedConnectionSelectionDiagnostics
        : undefined,
    },
  );
  return mechanismWithKitConnections(normalized, connectionState, kit);
};

type ProjectSnapshotEnvelope = {
  data: Record<string, unknown>;
  sourceVersion: 1 | 2;
};

const PROJECT_SNAPSHOT_CONTENT_KEYS = [
  "metadata",
  "parts",
  "partOrder",
  "sceneObjects",
  "sceneObjectOrder",
  "skeleton",
  "paths",
  "mechanisms",
  "settings",
] as const;

const PROJECT_V2_REQUIRED_KEYS = [
  ...PROJECT_SNAPSHOT_CONTENT_KEYS,
  "processing",
] as const;

const snapshotRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const snapshotRecordValuesAreRecords = (value: unknown) =>
  snapshotRecord(value) && Object.values(value).every(snapshotRecord);

const snapshotSkeletonShapeIsValid = (value: unknown) => {
  if (value === null) return true;
  if (!snapshotRecord(value)) return false;
  if (Object.hasOwn(value, "joints") && !snapshotRecordValuesAreRecords(value.joints)) return false;
  if (
    Object.hasOwn(value, "bones") &&
    (!Array.isArray(value.bones) || !value.bones.every((bone) =>
      Array.isArray(bone) && bone.length === 2 && bone.every((id) => typeof id === "string")))
  ) return false;
  if (
    Object.hasOwn(value, "rootJointIds") &&
    (!Array.isArray(value.rootJointIds) || !value.rootJointIds.every((id) => typeof id === "string"))
  ) return false;
  if (
    Object.hasOwn(value, "skeleton") &&
    (!Array.isArray(value.skeleton) || !value.skeleton.every(snapshotRecord))
  ) return false;
  return true;
};

const projectSnapshotShapeIsValid = (
  data: Record<string, unknown>,
  sourceVersion: 1 | 2,
) => {
  if (
    sourceVersion === 2 &&
    PROJECT_V2_REQUIRED_KEYS.some((key) => !Object.hasOwn(data, key))
  ) return false;
  if (
    ["metadata", "settings", "processing"].some(
      (key) => Object.hasOwn(data, key) && !snapshotRecord(data[key]),
    )
  ) return false;
  if (
    ["parts", "sceneObjects", "paths"].some(
      (key) => Object.hasOwn(data, key) && !snapshotRecordValuesAreRecords(data[key]),
    )
  ) return false;
  if (
    ["partOrder", "sceneObjectOrder"].some(
      (key) => Object.hasOwn(data, key) &&
        (!Array.isArray(data[key]) || !(data[key] as unknown[]).every((item) => typeof item === "string")),
    )
  ) return false;
  if (
    Object.hasOwn(data, "mechanisms") &&
    (!Array.isArray(data.mechanisms) || !data.mechanisms.every(snapshotRecord))
  ) return false;
  if (
    Object.hasOwn(data, "skeleton") &&
    !snapshotSkeletonShapeIsValid(data.skeleton)
  ) return false;
  if (
    ["selectedPartId", "selectedPathId", "selectedMechanismId", "selectedSceneObjectId"].some(
      (key) => Object.hasOwn(data, key) && data[key] != null && typeof data[key] !== "string",
    )
  ) return false;
  if (
    Object.hasOwn(data, "characterPackage") &&
    data.characterPackage !== null &&
    !snapshotRecord(data.characterPackage)
  ) return false;
  const physicalKit = snapshotRecord(data.settings) ? data.settings.physicalKit : undefined;
  return physicalKit === undefined || snapshotRecord(physicalKit);
};

const projectSnapshotEnvelope = (
  raw: unknown,
): ProjectSnapshotEnvelope | { reason: "unsupported-version" | "invalid-snapshot" } => {
  if (!snapshotRecord(raw)) {
    return { reason: "invalid-snapshot" };
  }
  const data = raw;
  if (!PROJECT_SNAPSHOT_CONTENT_KEYS.some((key) => Object.hasOwn(data, key))) {
    return { reason: "invalid-snapshot" };
  }
  const sourceVersion = data.version === undefined || data.version === 1
    ? 1
    : data.version === 2
      ? 2
      : undefined;
  if (!sourceVersion) {
    return { reason: typeof data.version === "number" ? "unsupported-version" : "invalid-snapshot" };
  }
  return projectSnapshotShapeIsValid(data, sourceVersion)
    ? { data, sourceVersion }
    : { reason: "invalid-snapshot" };
};

/**
 * Converts an already-versioned envelope only. Raw ingress must go through
 * `loadProjectSnapshot`, which preserves the current aggregate on rejection.
 */
const migrateProjectSnapshot = (
  data: Record<string, unknown>,
  sourceVersion: 1 | 2,
): ProjectState => {
  const fallback = createEmptyProject();
  const skeleton = normalizeSkeletonSnapshot(data.skeleton);
  const rawParts = asRecord(data.parts);
  const parts = Object.fromEntries(
    Object.entries(rawParts).map(([id, value]) => [
      id,
      normalizePartSnapshot(id, value, skeleton),
    ]),
  );
  const partOrder = (Array.isArray(data.partOrder)
    ? data.partOrder.filter((id): id is string => typeof id === "string")
    : Object.keys(parts)).filter((id) =>
    Boolean(parts[id]),
  );
  const rawSceneObjects = asRecord(data.sceneObjects);
  const sceneObjects = Object.fromEntries(
    Object.entries(rawSceneObjects).map(([id, value]) => [
      id,
      normalizeSceneObjectSnapshot(id, value),
    ]),
  );
  const sceneObjectOrder = (Array.isArray(data.sceneObjectOrder)
    ? data.sceneObjectOrder.filter((id): id is string => typeof id === "string")
    : Object.keys(sceneObjects)).filter((id) => Boolean(sceneObjects[id]));
  const rawPaths = asRecord(data.paths);
  const paths = Object.fromEntries(
    Object.entries(rawPaths).map(([id, path]) => [
      id,
      validatePath({ ...asRecord(path), id } as ProjectMotionPath),
    ]),
  );
  const settings = normalizeAppSettings(data.settings, fallback.settings);
  const mechanisms = (Array.isArray(data.mechanisms)
    ? data.mechanisms
    : fallback.mechanisms).map((m) =>
      normalizeMechanismSnapshot(m, sourceVersion, settings.physicalKit)
    );
  const selectedPartId =
    typeof data.selectedPartId === "string" && parts[data.selectedPartId]
      ? data.selectedPartId
      : undefined;
  const selectedPathId =
    typeof data.selectedPathId === "string" && paths[data.selectedPathId]
      ? data.selectedPathId
      : undefined;
  const selectedMechanismId =
    typeof data.selectedMechanismId === "string" &&
    mechanisms.some((mechanism) => mechanism.id === data.selectedMechanismId)
      ? data.selectedMechanismId
      : undefined;
  const selectedSceneObjectId =
    typeof data.selectedSceneObjectId === "string" && sceneObjects[data.selectedSceneObjectId]
      ? data.selectedSceneObjectId
      : undefined;
  const project: ProjectState = {
    ...fallback,
    version: APP_STATE_VERSION,
    metadata: {
      ...fallback.metadata,
      ...asRecord(data.metadata),
      updatedAt: nowIso(),
    },
    parts,
    partOrder,
    sceneObjects,
    sceneObjectOrder,
    skeleton,
    paths,
    mechanisms,
    settings,
    selectedPartId,
    selectedPathId,
    selectedMechanismId,
    selectedSceneObjectId,
    processing:
      data.processing && typeof data.processing === "object"
        ? data.processing as ProcessingStatus
        : idleProcessing(),
    lastExport: undefined,
    characterPackage:
      data.characterPackage && typeof data.characterPackage === "object"
        ? (data.characterPackage as CharacterPackageArtifact)
        : undefined,
    lastFoundryExport: undefined,
  };
  return revalidateMechanismArtifacts(project, mechanisms, {
    preserveExactTargetFit: true,
  });
};

const projectSnapshotDiagnostics = (
  project: ProjectState,
): RejectedConnectionSelectionDiagnostic[] =>
  project.mechanisms
    .flatMap((mechanism) => mechanism.rejectedConnectionSelectionDiagnostics ?? [])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    .slice(0, 24);

/** Trusted fixture convenience. Rejected input throws instead of fabricating an empty project. */
export function loadProjectSnapshot(raw: unknown): ProjectState;
/** Raw file/autosave/reducer ingress preserves the exact current project on rejection. */
export function loadProjectSnapshot(
  raw: unknown,
  currentProject: ProjectState,
): ProjectSnapshotLoadResult;
export function loadProjectSnapshot(
  raw: unknown,
  currentProject?: ProjectState,
): ProjectState | ProjectSnapshotLoadResult {
  const envelope = projectSnapshotEnvelope(raw);
  if ("reason" in envelope) {
    if (currentProject === undefined) {
      throw new TypeError(`Project snapshot rejected: ${envelope.reason}`);
    }
    return {
      status: "rejected",
      project: currentProject,
      blocker: "Fix: Update project",
      reason: envelope.reason,
    };
  }
  const project = migrateProjectSnapshot(envelope.data, envelope.sourceVersion);
  const result: ProjectSnapshotLoadResult = {
    status: "loaded",
    project,
    sourceVersion: envelope.sourceVersion,
    migrated: envelope.sourceVersion === 1,
    diagnostics: projectSnapshotDiagnostics(project),
  };
  return currentProject === undefined ? result.project : result;
}

export const downloadText = (
  filename: string,
  text: string,
  type = "application/json",
) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const projectSelfCheck = () => {
  const sample = createSampleProject();
  const loaded = loadProjectSnapshot(JSON.parse(serializeProject(sample)));
  const duplicateA = createDefaultMechanism("4bar", "a");
  const duplicateB = createDefaultMechanism("4bar", "b");
  if (loaded.partOrder.length === 0)
    throw new Error("selfcheck: sample parts missing");
  if (new Set([duplicateA.id, duplicateB.id]).size !== 2)
    throw new Error("selfcheck: mechanism ids collide");
  const migrated = loadProjectSnapshot({
    skeleton: {
      joints: { root: { id: "root", name: "root", position: { x: 0, y: 0 } } },
    },
  });
  if (migrated.skeleton?.joints.root.bendDirection !== 1)
    throw new Error(
      "selfcheck: skeleton migration missing bendDirection default",
    );
  const objectAdded = applyProjectAction(sample, {
    type: "upsert_scene_object",
    object: createDefaultSceneObject("piggy-bank", "object-selfcheck"),
  });
  if (
    !objectAdded.sceneObjects["object-selfcheck"] ||
    objectAdded.selectedPartId
  )
    throw new Error("selfcheck: scene object add/select failed");
  const removed = applyProjectAction(sample, {
    type: "remove_joint",
    jointId: "right_elbow",
  });
  if (removed.parts.right_arm_lower?.anchorJointId !== "right_elbow")
    throw new Error("selfcheck: joint delete did not preserve authored anchor");
  return true;
};

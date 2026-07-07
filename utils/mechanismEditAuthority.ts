import type {
  MechanismConfig,
  MechanismType,
  PhysicalKitSettings,
} from "../types";
import {
  boardToScene,
  defaultPhysicalKit,
  sceneToBoardRaw,
} from "./coordinates";
import {
  closePhysicalValue,
  closeToBoardPitch,
  closeToFabricationLinkage,
  physicalTolerance,
  sampleFeasibleRange,
} from "./fabricationReadiness";
import {
  FABRICATION_LINKAGE_ROLE_MIN_HOLES,
  planetaryRingPitchRadius,
} from "./fabricationSizing";
import {
  gearTrainPitchCenterDistance,
  gearTrainPitchRadii,
  gearTrainResolvedCenterDistance,
} from "./kinematics";
import { compileMechanismGraphFabrication } from "./mechanismCompiler";

export type MechanismParamMeta = {
  key: keyof MechanismConfig;
  label: string;
  min: number;
  max: number;
  step?: number;
};

export const MECHANISM_PARAM_META: MechanismParamMeta[] = [
  { key: "anchorX", label: "anchor X", min: -260, max: 260, step: 40 },
  { key: "anchorY", label: "anchor Y", min: -260, max: 260, step: 40 },
  { key: "groundAngle", label: "ground angle", min: -180, max: 180 },
  { key: "crankLength", label: "crank", min: 10, max: 180 },
  { key: "groundLength", label: "ground", min: 0, max: 280 },
  { key: "couplerLength", label: "coupler", min: 0, max: 320 },
  { key: "rockerLength", label: "rocker / gear", min: 0, max: 220 },
  { key: "sliderOffset", label: "slider offset", min: -120, max: 120 },
  { key: "couplerPointDist", label: "output dist", min: 0, max: 220 },
  { key: "couplerPointAngle", label: "output angle", min: -180, max: 180 },
  { key: "gearRatio", label: "gear ratio", min: -6, max: 6, step: 0.1 },
  { key: "rodLength", label: "rod length", min: 10, max: 260 },
  { key: "speed2", label: "second speed", min: -5, max: 5, step: 0.1 },
  { key: "phase", label: "phase", min: -3.14, max: 3.14, step: 0.01 },
];

const compactParametricKeys: Partial<
  Record<MechanismType, Array<keyof MechanismConfig>>
> = {
  "4bar": ["crankLength", "couplerLength", "rockerLength"],
  gear: [
    "crankLength",
    "rockerLength",
    "gearRatio",
    "gearTrainRadii",
    "groundLength",
    "couplerPointDist",
    "couplerPointAngle",
    "speed2",
  ],
  gear_linkage: [
    "crankLength",
    "rockerLength",
    "couplerLength",
    "gearRatio",
    "gearTrainRadii",
    "groundLength",
    "couplerPointDist",
    "couplerPointAngle",
    "speed2",
  ],
};

export const shouldShowMechanismParam = (
  type: MechanismType,
  key: keyof MechanismConfig,
) => {
  if (type === "cam") return false;
  if (type === "piston") return false;
  if (type === "planetary_gear") return key === "phase";
  if (compactParametricKeys[type]?.includes(key)) return false;
  if (key === "speed2") return type === "5bar";
  if (key === "phase")
    return ["5bar", "gear", "gear_linkage", "planetary_gear"].includes(type);
  if (key === "gearRatio") return false;
  if (key === "rodLength") return ["5bar", "6bar", "piston"].includes(type);
  if (key === "groundLength")
    return ![
      "cam",
      "yoke",
      "rack-pinion",
      "gear",
      "gear_linkage",
      "planetary_gear",
    ].includes(type);
  if (key === "couplerLength")
    return !["cam", "gear", "planetary_gear", "yoke", "rack-pinion"].includes(
      type,
    );
  return true;
};

export const clampMechanismParam = (
  key: keyof MechanismConfig,
  value: number,
) => {
  const param = MECHANISM_PARAM_META.find((item) => item.key === key);
  if (!param) return value;
  return Math.max(param.min, Math.min(param.max, value));
};

const MOTION_SAFE_PARAM_SAMPLES = 28;
const MOTION_SAFE_RANGE_STEPS = 24;
const MOTION_AUTHORITY_SAMPLES = 48;

export const mechanismMotionCompletes = (mechanism: MechanismConfig) =>
  sampleFeasibleRange(mechanism, MOTION_SAFE_PARAM_SAMPLES).warning === null;

const gearTrainRadiiShapeIsBuildable = (mechanism: MechanismConfig) => {
  if (mechanism.type !== "gear" && mechanism.type !== "gear_linkage")
    return true;
  if (!Array.isArray(mechanism.gearTrainRadii)) return false;
  if (
    mechanism.gearTrainRadii.length < 2 ||
    mechanism.gearTrainRadii.length > 8
  )
    return false;
  if (
    !mechanism.gearTrainRadii.every(
      (value) => Number.isFinite(value) && Math.abs(value) >= 1,
    )
  )
    return false;
  const first = Math.abs(mechanism.gearTrainRadii[0]);
  const last = Math.abs(mechanism.gearTrainRadii.at(-1) ?? first);
  return (
    closePhysicalValue(first, Math.abs(mechanism.crankLength)) &&
    closePhysicalValue(last, Math.abs(mechanism.rockerLength))
  );
};

const mechanismDimensionsAreBuildable = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  const physicalNumbers = [
    mechanism.crankLength,
    mechanism.couplerLength,
    mechanism.groundLength,
    mechanism.rockerLength,
    mechanism.sliderOffset,
    mechanism.couplerPointDist,
    mechanism.couplerPointAngle,
  ];
  if (
    mechanism.type === "5bar" ||
    mechanism.type === "6bar" ||
    mechanism.type === "piston"
  ) {
    physicalNumbers.push(mechanism.rodLength ?? Number.NaN);
  }
  if (
    mechanism.type === "gear" ||
    mechanism.type === "gear_linkage" ||
    mechanism.type === "planetary_gear"
  ) {
    physicalNumbers.push(
      mechanism.gearRatio ?? Number.NaN,
      mechanism.speed2 ?? Number.NaN,
    );
  }
  if (!physicalNumbers.every(Number.isFinite)) return false;
  if (
    (mechanism.type === "gear" ||
      mechanism.type === "gear_linkage" ||
      mechanism.type === "planetary_gear") &&
    (mechanism.gearRatio ?? 0) === 0
  ) {
    return false;
  }
  if (mechanism.type === "4bar") {
    return (
      closeToBoardPitch(mechanism.groundLength, kit.gridPitchMm) &&
      closeToFabricationLinkage(
        mechanism.crankLength,
        FABRICATION_LINKAGE_ROLE_MIN_HOLES.driver,
        kit.gridPitchMm,
      ) &&
      closeToFabricationLinkage(
        mechanism.couplerLength,
        FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler,
        kit.gridPitchMm,
      ) &&
      closeToFabricationLinkage(
        mechanism.rockerLength,
        FABRICATION_LINKAGE_ROLE_MIN_HOLES.output,
        kit.gridPitchMm,
      )
    );
  }
  if (mechanism.type === "gear") {
    if (!gearTrainRadiiShapeIsBuildable(mechanism)) return false;
    const pitchSpan = gearTrainPitchCenterDistance(mechanism);
    const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
    return (
      closePhysicalValue(Math.abs(mechanism.groundLength), pitchSpan) &&
      closePhysicalValue(resolvedSpan, pitchSpan)
    );
  }
  if (mechanism.type === "gear_linkage") {
    if (!gearTrainRadiiShapeIsBuildable(mechanism)) return false;
    const radii = gearTrainPitchRadii(mechanism);
    const pitchSpan = gearTrainPitchCenterDistance(mechanism);
    const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
    const actualGround = Math.abs(mechanism.groundLength);
    if (radii.length > 2) {
      return (
        closePhysicalValue(actualGround, pitchSpan) &&
        closePhysicalValue(resolvedSpan, pitchSpan)
      );
    }
    return (
      actualGround > pitchSpan + physicalTolerance(pitchSpan) &&
      closePhysicalValue(actualGround, resolvedSpan)
    );
  }
  if (mechanism.type === "planetary_gear") {
    const expectedCarrier =
      Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength);
    const expectedRing =
      Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength) * 2;
    return (
      closePhysicalValue(Math.abs(mechanism.groundLength), expectedCarrier) &&
      closePhysicalValue(planetaryRingPitchRadius(mechanism), expectedRing)
    );
  }
  return true;
};

const mechanismGraphBuildIsSafe = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => compileMechanismGraphFabrication(mechanism, kit).buildable;

export const mechanismEditIsSafe = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) =>
  sampleFeasibleRange(mechanism, MOTION_AUTHORITY_SAMPLES).warning === null &&
  mechanismDimensionsAreBuildable(mechanism, kit) &&
  mechanismGraphBuildIsSafe(mechanism, kit);

const nearestBuildableBoardAnchorValue = (
  mechanism: MechanismConfig,
  key: "anchorX" | "anchorY",
  requestedValue: number,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  const currentAnchor = {
    x: Number.isFinite(mechanism.anchorX) ? (mechanism.anchorX ?? 0) : 0,
    y: Number.isFinite(mechanism.anchorY) ? (mechanism.anchorY ?? 0) : 0,
  };
  const currentBoard = sceneToBoardRaw(currentAnchor, kit);
  const fixedIndex =
    key === "anchorX"
      ? Math.max(0, Math.min(kit.boardCells - 1, currentBoard.row))
      : Math.max(0, Math.min(kit.boardCells - 1, currentBoard.col));
  const candidates = Array.from({ length: kit.boardCells }, (_, index) => {
    const point =
      key === "anchorX"
        ? boardToScene(index, fixedIndex, kit)
        : boardToScene(fixedIndex, index, kit);
    return key === "anchorX" ? point.x : point.y;
  }).sort(
    (a, b) => Math.abs(a - requestedValue) - Math.abs(b - requestedValue),
  );
  return (
    candidates.find((value) =>
      mechanismEditIsSafe({ ...mechanism, [key]: value }, kit),
    ) ?? Number(mechanism[key] ?? 0)
  );
};

export const motionSafeParamRange = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  const param = MECHANISM_PARAM_META.find((item) => item.key === key);
  if (!param) return undefined;
  const current = Number(mechanism[key] ?? 0);
  if (!Number.isFinite(current))
    return { min: param.min, max: param.max, locked: false, currentSafe: true };
  const values = Array.from(
    { length: MOTION_SAFE_RANGE_STEPS + 1 },
    (_, index) =>
      param.min + ((param.max - param.min) * index) / MOTION_SAFE_RANGE_STEPS,
  );
  values.push(current);
  const sorted = [
    ...new Set(values.map((value) => Number(value.toFixed(4)))),
  ].sort((a, b) => a - b);
  const safeAt = (value: number) =>
    mechanismEditIsSafe({ ...mechanism, [key]: value }, kit);
  const currentSafe = safeAt(current);
  if (!currentSafe)
    return { min: param.min, max: param.max, locked: true, currentSafe: false };
  const currentIndex = sorted.findIndex((value) => value >= current);
  let min = current;
  for (let index = Math.max(0, currentIndex - 1); index >= 0; index -= 1) {
    if (!safeAt(sorted[index])) break;
    min = sorted[index];
  }
  let max = current;
  for (
    let index = Math.max(0, currentIndex);
    index < sorted.length;
    index += 1
  ) {
    if (!safeAt(sorted[index])) break;
    max = sorted[index];
  }
  return { min, max, locked: min > param.min || max < param.max, currentSafe };
};

export const clampMechanismParamForMotion = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  value: number,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  if (key === "anchorX" || key === "anchorY") {
    return nearestBuildableBoardAnchorValue(mechanism, key, value, kit);
  }
  const range = motionSafeParamRange(mechanism, key, kit);
  const clamped = clampMechanismParam(key, value);
  const bounded = range?.currentSafe
    ? Math.max(range.min, Math.min(range.max, clamped))
    : clamped;
  return mechanismEditIsSafe({ ...mechanism, [key]: bounded }, kit)
    ? bounded
    : Number(mechanism[key] ?? 0);
};

export const MECHANISM_FEASIBILITY_AUTHORITY_KEYS = [
  "anchorX",
  "anchorY",
  "groundAngle",
  "crankLength",
  "groundLength",
  "couplerLength",
  "rockerLength",
  "sliderOffset",
  "couplerPointDist",
  "couplerPointAngle",
  "assemblyMode",
  "speed1",
  "speed2",
  "gearRatio",
  "gearTrainRadii",
  "camProfileSamples",
  "driverPhaseOffset",
  "rodLength",
  "phase",
  "outputGearRadius",
  "showOutputGear",
] as const satisfies readonly (keyof MechanismConfig)[];

export const MECHANISM_REPLACEMENT_ONLY_KEYS = [
  "type",
] as const satisfies readonly (keyof MechanismConfig)[];

export const MECHANISM_NON_FEASIBILITY_EDIT_KEYS = [
  "id",
  "visible",
  "enabled",
  "color",
  "driverGroupId",
  "transform",
  "sceneAnchor",
  "activeVisualPartIds",
  "fabricationMetadata",
  "foundryExport",
  "targetPartId",
  "targetSceneObjectId",
  "targetPathId",
  "targetAnchorJointId",
  "presetId",
  "recommendation",
  "source",
  "generatedPath",
  "warnings",
] as const satisfies readonly (keyof MechanismConfig)[];

const motionAuthorityKeys = new Set<keyof MechanismConfig>(
  MECHANISM_FEASIBILITY_AUTHORITY_KEYS,
);
const replacementOnlyKeys = new Set<keyof MechanismConfig>(
  MECHANISM_REPLACEMENT_ONLY_KEYS,
);

export const mechanismUpdateChangesMotion = (
  updates: Partial<MechanismConfig>,
) =>
  Object.keys(updates).some((key) =>
    motionAuthorityKeys.has(key as keyof MechanismConfig),
  );

export const mechanismUpdateRequiresReplacement = (
  updates: Partial<MechanismConfig>,
) =>
  Object.keys(updates).some((key) =>
    replacementOnlyKeys.has(key as keyof MechanismConfig),
  );

const isFiniteScalarParam = (
  key: keyof MechanismConfig,
  value: unknown,
): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  MECHANISM_PARAM_META.some((param) => param.key === key);

export const safeMechanismUpdate = (
  mechanism: MechanismConfig,
  updates: Partial<MechanismConfig>,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) =>
  !mechanismUpdateRequiresReplacement(updates) &&
  (!mechanismUpdateChangesMotion(updates) ||
    mechanismEditIsSafe({ ...mechanism, ...updates }, kit));

export const constrainMechanismUpdate = (
  mechanism: MechanismConfig,
  updates: Partial<MechanismConfig>,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Partial<MechanismConfig> => {
  if (
    !mechanismUpdateRequiresReplacement(updates) &&
    !mechanismUpdateChangesMotion(updates)
  )
    return updates;
  if (safeMechanismUpdate(mechanism, updates, kit)) return updates;

  const constrained: Partial<MechanismConfig> = {};
  (Object.entries(updates) as Array<[keyof MechanismConfig, unknown]>).forEach(
    ([key, value]) => {
      if (replacementOnlyKeys.has(key)) return;
      if (!motionAuthorityKeys.has(key)) {
        (constrained as Record<keyof MechanismConfig, unknown>)[key] = value;
        return;
      }
      if (
        mechanismEditIsSafe({ ...mechanism, ...constrained, [key]: value }, kit)
      ) {
        (constrained as Record<keyof MechanismConfig, unknown>)[key] = value;
        return;
      }
      if (!isFiniteScalarParam(key, value)) return;
      const nextValue = clampMechanismParamForMotion(
        { ...mechanism, ...constrained },
        key,
        value,
        kit,
      );
      if (nextValue !== mechanism[key]) {
        (constrained as Record<keyof MechanismConfig, unknown>)[key] =
          nextValue;
      }
    },
  );
  return constrained;
};

export const constrainMechanismCommit = (
  previous: MechanismConfig | undefined,
  next: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConfig => {
  if (!previous || previous.id !== next.id) return next;
  if (previous.type !== next.type)
    return mechanismEditIsSafe(next, kit) ? next : previous;
  const { id: _id, type: _type, ...updates } = next;
  return { ...previous, ...constrainMechanismUpdate(previous, updates, kit) };
};

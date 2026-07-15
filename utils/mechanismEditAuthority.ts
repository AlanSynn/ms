import type {
  MechanismConfig,
  MechanismRecoveryCandidates,
  MechanismType,
  PhysicalKitSettings,
  ProjectState,
} from "../types";
import {
  boardToScene,
  defaultPhysicalKit,
  sceneToBoardRaw,
} from "./coordinates";
import {
  calculateLinkage,
  mechanismSafetyPhaseSchedule,
} from "./kinematics";
import {
  connectionSelectionRolesForMechanism,
  mechanismConnectionCompatibilityUpdates,
  normalizeMechanismConnectionSelections,
} from "./mechanismConnectionSelections";
import { mechanismWithGeneratedPath } from "./mechanismGeneratedPath";
import { mechanismGraphForMechanism } from "./mechanismGraph";
import {
  assessMechanismTargetBinding,
  MECHANISM_BINDING_BLOCKER,
} from "./pathTargets";

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

const MOTION_SAFE_RANGE_STEPS = 24;

const uniqueSortedNumbers = (values: number[]) =>
  [...new Set(values.map((value) => Number(value.toFixed(4))))].sort(
    (a, b) => a - b,
  );

export const mechanismMotionCompletes = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => mechanismHasFiniteValidStates(mechanism, kit);

const scalarDomain = new Map(
  MECHANISM_PARAM_META.map(({ key, min, max }) => [key, { min, max }]),
);

const familyScalarDomain = new Map<string, { min: number; max: number }>([
  ["4bar:groundLength", { min: 0, max: 320 }],
  ["4bar:rockerLength", { min: 0, max: 320 }],
  ["cam:rockerLength", { min: 0, max: 320 }],
]);

const scalarDomainAppliesToFamily = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
) => {
  if (key === "rodLength")
    return ["5bar", "6bar", "piston"].includes(mechanism.type);
  if (key === "gearRatio" || key === "outputGearRadius")
    return ["gear", "gear_linkage", "planetary_gear"].includes(mechanism.type);
  if (key === "phase")
    return ["5bar", "gear", "gear_linkage", "planetary_gear"].includes(
      mechanism.type,
    );
  if (key === "rockerLength" && mechanism.type === "rack-pinion") return false;
  return true;
};

const numberInDeclaredDomain = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  value: unknown,
) => {
  if (value === undefined) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (!scalarDomainAppliesToFamily(mechanism, key)) return true;
  const domain = key === "groundAngle"
    ? { min: -360, max: 360 }
    : familyScalarDomain.get(`${mechanism.type}:${String(key)}`) ??
      scalarDomain.get(key);
  return !domain || (value >= domain.min && value <= domain.max);
};

const pointIsDeclaredBoardHole = (
  point: { x: number; y: number },
  kit: PhysicalKitSettings,
) => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const board = sceneToBoardRaw(point, kit);
  const snapped = boardToScene(board.col, board.row, kit);
  return board.valid && Math.abs(point.x - snapped.x) <= 1e-4 &&
    Math.abs(point.y - snapped.y) <= 1e-4;
};

const boardAnchorIsDeclared = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) => pointIsDeclaredBoardHole(
  { x: mechanism.anchorX ?? Number.NaN, y: mechanism.anchorY ?? Number.NaN },
  kit,
);

const boardPivotsAreDeclared = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) => mechanismGraphForMechanism(mechanism, kit).nodes
  .filter((node) => node.role === "board-anchor")
  .every((node) => node.position !== undefined && pointIsDeclaredBoardHole(node.position, kit));

export const completeMechanismCandidateIsValid = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  for (const key of MECHANISM_FEASIBILITY_AUTHORITY_KEYS) {
    if (!candidateValueIsFinite(mechanism[key])) return false;
    if (key === "gearTrainRadii" || key === "camProfileSamples" ||
        key === "connectionSelections" || key === "assemblyMode" ||
        key === "showOutputGear") continue;
    if (!numberInDeclaredDomain(mechanism, key, mechanism[key])) return false;
  }
  if (mechanism.assemblyMode !== undefined &&
      mechanism.assemblyMode !== "open" && mechanism.assemblyMode !== "crossed") return false;
  if (mechanism.showOutputGear !== undefined && typeof mechanism.showOutputGear !== "boolean") return false;
  if ((mechanism.rodLength !== undefined && mechanism.rodLength <= 0) ||
      (mechanism.outputGearRadius !== undefined && mechanism.outputGearRadius <= 0)) return false;
  if ((mechanism.type === "gear" || mechanism.type === "gear_linkage") &&
      (!Array.isArray(mechanism.gearTrainRadii) || mechanism.gearTrainRadii.length < 2 ||
       mechanism.gearTrainRadii.length > 8 || mechanism.gearTrainRadii.some((value) => !Number.isFinite(value) || value < 1 || value > 220))) return false;
  if (mechanism.type === "cam" &&
      (!Array.isArray(mechanism.camProfileSamples) || !mechanism.camProfileSamples.length ||
       mechanism.camProfileSamples.length > 64 || mechanism.camProfileSamples.some((value) => !Number.isFinite(value) || value < 0 || value > 320))) return false;
  const connectionState = normalizeMechanismConnectionSelections(
    mechanism,
    mechanism.connectionSelections,
    undefined,
    { kit },
  );
  const compatibilityUpdates = mechanismConnectionCompatibilityUpdates(
    mechanism,
    connectionState,
  );
  return connectionState.connectionSelectionValidation?.status !== "invalid" &&
    Object.entries(compatibilityUpdates).every(([key, value]) =>
      sameCandidateValue(mechanism[key as keyof MechanismConfig], value)
    ) &&
    boardAnchorIsDeclared(mechanism, kit) && boardPivotsAreDeclared(mechanism, kit);
};

const mechanismHasFiniteValidStates = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) =>
  mechanismSafetyPhaseSchedule(mechanism.type).every((phase) => {
    const state = calculateLinkage(mechanism, phase, kit);
    return state.isValid && candidateValueIsFinite(state);
  });

export const mechanismEditIsSafe = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => completeMechanismCandidateIsValid(mechanism, kit) &&
  mechanismHasFiniteValidStates(mechanism, kit);

const MECHANISM_PLACEMENT_RECOVERY_KEYS = new Set<keyof MechanismConfig>([
  "anchorX",
  "anchorY",
]);

export const mechanismParamIsPlacementRecoveryEditable = (
  mechanism: MechanismConfig,
  key: keyof MechanismConfig,
  _kit: PhysicalKitSettings = defaultPhysicalKit(),
): key is "anchorX" | "anchorY" | "groundLength" =>
  MECHANISM_PLACEMENT_RECOVERY_KEYS.has(key) ||
  (mechanism.type === "4bar" && key === "groundLength");

const nearestBoardSpan = (value: number, kit: PhysicalKitSettings) => {
  const center = Math.floor(kit.boardCells / 2);
  const a = boardToScene(center, center, kit);
  const b = boardToScene(Math.min(kit.boardCells - 1, center + 1), center, kit);
  const pitch = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  return Math.max(pitch, Math.round(Math.abs(value) / pitch) * pitch);
};

const boardAnchorAxisValues = (
  mechanism: MechanismConfig,
  key: "anchorX" | "anchorY",
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
  return uniqueSortedNumbers(
    Array.from({ length: kit.boardCells }, (_, index) => {
      const point =
        key === "anchorX"
          ? boardToScene(index, fixedIndex, kit)
          : boardToScene(fixedIndex, index, kit);
      return key === "anchorX" ? point.x : point.y;
    }),
  );
};

const boardAnchorAxisCandidates = (
  mechanism: MechanismConfig,
  key: "anchorX" | "anchorY",
  requestedValue: number,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) =>
  boardAnchorAxisValues(mechanism, key, kit).sort(
    (a, b) => Math.abs(a - requestedValue) - Math.abs(b - requestedValue),
  );

const fourBarGroundSpanValues = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  const anchor = {
    x: Number(mechanism.anchorX ?? 0),
    y: Number(mechanism.anchorY ?? 0),
  };
  const angle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
  return uniqueSortedNumbers(
    Array.from({ length: kit.boardCells * kit.boardCells }, (_, index) => {
      const endpoint = boardToScene(
        index % kit.boardCells,
        Math.floor(index / kit.boardCells),
        kit,
      );
      return Math.hypot(endpoint.x - anchor.x, endpoint.y - anchor.y);
    }).filter((span) =>
      pointIsDeclaredBoardHole(
        {
          x: anchor.x + span * Math.cos(angle),
          y: anchor.y + span * Math.sin(angle),
        },
        kit,
      )
    ),
  );
};

const motionSafeParamCandidates = (
  mechanism: MechanismConfig,
  param: MechanismParamMeta,
  current: number,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  if (param.key === "anchorX" || param.key === "anchorY") {
    return uniqueSortedNumbers([
      ...boardAnchorAxisValues(mechanism, param.key, kit),
      current,
    ]);
  }
  if (mechanism.type === "4bar" && param.key === "groundLength")
    return fourBarGroundSpanValues(mechanism, kit);
  const step = param.step;
  if (step && step > 0) {
    const totalSteps = Math.floor(
      (param.max - param.min) / step + 1e-9,
    );
    const stride = Math.max(
      1,
      Math.ceil(totalSteps / MOTION_SAFE_RANGE_STEPS),
    );
    const values = Array.from(
      { length: Math.floor(totalSteps / stride) + 1 },
      (_, index) => param.min + index * stride * step,
    );
    values.push(param.min, param.max, current);
    return uniqueSortedNumbers(values);
  }
  return uniqueSortedNumbers([
    ...Array.from(
      { length: MOTION_SAFE_RANGE_STEPS + 1 },
      (_, index) =>
        param.min + ((param.max - param.min) * index) / MOTION_SAFE_RANGE_STEPS,
    ),
    current,
  ]);
};

const nearestBuildableBoardAnchorValue = (
  mechanism: MechanismConfig,
  key: "anchorX" | "anchorY",
  requestedValue: number,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  const candidates = boardAnchorAxisCandidates(
    mechanism,
    key,
    requestedValue,
    kit,
  );
  const safeCandidate = candidates.find((value) =>
    mechanismEditIsSafe({ ...mechanism, [key]: value }, kit),
  );
  if (safeCandidate !== undefined) return safeCandidate;
  return mechanismParamIsPlacementRecoveryEditable(mechanism, key, kit)
    ? (candidates[0] ?? Number(mechanism[key] ?? 0))
    : Number(mechanism[key] ?? 0);
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
  const sorted = motionSafeParamCandidates(mechanism, param, current, kit);
  const safeAt = (value: number) =>
    mechanismEditIsSafe({ ...mechanism, [key]: value }, kit);
  const currentSafe = safeAt(current);
  if (!currentSafe)
    return { min: param.min, max: param.max, locked: true, currentSafe: false };
  if (mechanism.type === "4bar" && key === "groundLength") {
    const safe = sorted.filter(safeAt);
    return {
      min: safe[0] ?? current,
      max: safe.at(-1) ?? current,
      locked: true,
      currentSafe,
    };
  }
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
  if (
    key === "groundLength" &&
    mechanism.type === "4bar"
  ) {
    const requested = clampMechanismParam(key, value);
    const safe = fourBarGroundSpanValues(mechanism, kit)
      .sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested))
      .find((span) => mechanismEditIsSafe({ ...mechanism, [key]: span }, kit));
    if (safe !== undefined) return safe;
    return mechanismEditIsSafe(mechanism, kit)
      ? Number(mechanism[key] ?? 0)
      : nearestBoardSpan(requested, kit);
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
  "connectionSelections",
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
  "connectionSelectionValidation",
  // Import-recovery provenance is display-only; it must not alter mechanism
  // geometry or make a previously valid aggregate fail a safe edit.
  "rejectedConnectionSelectionDiagnostics",
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

const physicalGeometryKeys = new Set<keyof MechanismConfig>([
  ...MECHANISM_FEASIBILITY_AUTHORITY_KEYS,
  ...MECHANISM_REPLACEMENT_ONLY_KEYS,
]);

const geometryKeys = new Set<keyof MechanismConfig>([
  ...physicalGeometryKeys,
  "targetPartId",
  "targetSceneObjectId",
  "targetPathId",
  "targetAnchorJointId",
]);

const sameCandidateValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameCandidateValue(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
  return keys.every((key) => sameCandidateValue(leftRecord[key], rightRecord[key]));
};

export const mechanismGeometryChanged = (
  previous: MechanismConfig,
  next: MechanismConfig,
) => [...geometryKeys].some((key) => !sameCandidateValue(previous[key], next[key]));

const mechanismPhysicalGeometryChanged = (
  previous: MechanismConfig,
  next: MechanismConfig,
) => [...physicalGeometryKeys].some(
  (key) => !sameCandidateValue(previous[key], next[key]),
);

const derivedStateKeys = [
  "generatedPath",
  "foundryExport",
  "transform",
  "sceneAnchor",
  "fabricationMetadata",
  "activeVisualPartIds",
  "warnings",
] as const satisfies readonly (keyof MechanismConfig)[];

const candidateValueIsFinite = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(candidateValueIsFinite);
  if (value && typeof value === "object")
    return Object.values(value).every(candidateValueIsFinite);
  return true;
};

const declaredConnectionValidation = (
  mechanism: MechanismConfig,
  fallback?: MechanismConfig["connectionSelectionValidation"],
) => {
  const declaredRoles = connectionSelectionRolesForMechanism(mechanism.type);
  const currentEntries = mechanism.connectionSelectionValidation?.entries ?? [];
  const fallbackEntries = fallback?.entries ?? [];
  const canonicalEntries = declaredRoles.flatMap((role) => {
    const entry = currentEntries.find((item) => item.role === role)
      ?? fallbackEntries.find((item) => item.role === role);
    return entry ? [entry] : [];
  });
  return canonicalEntries.length
    ? {
        status: canonicalEntries.some((entry) => entry.status === "rejected")
          ? "invalid" as const
          : "valid" as const,
        entries: canonicalEntries,
      }
    : undefined;
};

const withoutCandidateDerivedState = (
  mechanism: MechanismConfig,
  fallbackValidation?: MechanismConfig["connectionSelectionValidation"],
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConfig => {
  const {
    generatedPath: _generatedPath,
    foundryExport: _foundryExport,
    transform: _transform,
    sceneAnchor: _sceneAnchor,
    fabricationMetadata: _fabricationMetadata,
    activeVisualPartIds: _activeVisualPartIds,
    warnings: _warnings,
    connectionSelectionValidation: _connectionSelectionValidation,
    ...geometry
  } = mechanism;
  const connectionState = normalizeMechanismConnectionSelections(
    geometry as MechanismConfig,
    geometry.connectionSelections,
    declaredConnectionValidation(mechanism, fallbackValidation),
    { kit },
  );
  const compatible = {
    ...geometry,
    connectionSelections: connectionState.connectionSelections,
    connectionSelectionValidation: connectionState.connectionSelectionValidation,
    warnings: [],
    activeVisualPartIds: [],
  } as MechanismConfig;
  return mechanismWithGeneratedPath(compatible, { kit });
};

export type CompleteMechanismCandidateResult =
  | { status: "accepted"; mechanism: MechanismConfig; geometryChanged: boolean }
  | { status: "preserved"; mechanism: MechanismConfig; geometryChanged: boolean; blocker: string }
  | { status: "recovery-blocked"; mechanism: MechanismConfig; geometryChanged: boolean; blocker: string };

export type NewMechanismCandidateResult =
  | { status: "accepted"; mechanism: MechanismConfig }
  | { status: "rejected"; blocker: string };

export type MechanismEditAttemptResult =
  | { status: "accepted"; mechanism: MechanismConfig }
  | {
      status: "rejected";
      mechanism: MechanismConfig;
      blocker: string;
      recoveryCandidates: MechanismRecoveryCandidates;
    };

export const resolveNewMechanismCandidateCommit = (
  candidate: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): NewMechanismCandidateResult => {
  const rebuilt = withoutCandidateDerivedState(candidate, undefined, kit);
  return mechanismEditIsSafe(rebuilt, kit)
    ? { status: "accepted", mechanism: rebuilt }
    : { status: "rejected", blocker: "Fix mechanism geometry" };
};

export const resolveMechanismCandidateCommit = (
  previous: MechanismConfig,
  candidate: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
  mode: "edit" | "recovery" = "edit",
): CompleteMechanismCandidateResult => {
  const changed = mechanismGeometryChanged(previous, candidate);
  if (mode === "recovery") {
    const rebuilt = withoutCandidateDerivedState(candidate, previous.connectionSelectionValidation, kit);
    return mechanismEditIsSafe(rebuilt, kit)
      ? { status: "accepted", mechanism: rebuilt, geometryChanged: changed }
      : { status: "recovery-blocked", mechanism: previous, geometryChanged: changed, blocker: "Fix mechanism geometry" };
  }
  if (!changed) {
    const trustedDerived = derivedStateKeys.every((key) =>
      candidateValueIsFinite(previous[key])
    ) ? previous : withoutCandidateDerivedState(previous, undefined, kit);
    const mechanism = { ...candidate };
    for (const key of derivedStateKeys) {
      (mechanism as Record<keyof MechanismConfig, unknown>)[key] =
        trustedDerived[key];
    }
    const connectionState = normalizeMechanismConnectionSelections(
      mechanism,
      mechanism.connectionSelections,
      declaredConnectionValidation(candidate, previous.connectionSelectionValidation),
      { kit },
    );
    mechanism.connectionSelections = connectionState.connectionSelections;
    mechanism.connectionSelectionValidation = connectionState.connectionSelectionValidation;
    return { status: "accepted", mechanism, geometryChanged: false };
  }
  const rebuilt = withoutCandidateDerivedState(candidate, previous.connectionSelectionValidation, kit);
  if (mechanismEditIsSafe(rebuilt, kit))
    return { status: "accepted", mechanism: rebuilt, geometryChanged: true };
  if (
    !mechanismPhysicalGeometryChanged(previous, candidate) &&
    !mechanismEditIsSafe(previous, kit) &&
    MECHANISM_FEASIBILITY_AUTHORITY_KEYS.every((key) =>
      candidateValueIsFinite(candidate[key])
    )
  ) {
    return {
      status: "recovery-blocked",
      mechanism: previous,
      geometryChanged: true,
      blocker: "Fix mechanism geometry",
    };
  }
  return { status: "preserved", mechanism: previous, geometryChanged: true, blocker: "Fix mechanism geometry" };
};

export const resolveMechanismEditAttempt = (
  project: ProjectState,
  previous: MechanismConfig | undefined,
  candidate: MechanismConfig,
): MechanismEditAttemptResult => {
  if (previous === candidate) {
    const binding = assessMechanismTargetBinding(project, candidate);
    return binding.valid
      ? { status: "accepted", mechanism: previous }
      : {
          status: "rejected",
          mechanism: previous,
          blocker: MECHANISM_BINDING_BLOCKER,
          recoveryCandidates: binding.recoveryCandidates,
        };
  }
  const physical = previous
    ? resolveMechanismCandidateCommit(
        previous,
        candidate,
        project.settings.physicalKit,
      )
    : resolveNewMechanismCandidateCommit(
        candidate,
        project.settings.physicalKit,
      );
  const recoveryCandidates = assessMechanismTargetBinding(
    project,
    candidate,
  ).recoveryCandidates;
  if (physical.status !== "accepted") {
    return {
      status: "rejected",
      mechanism: previous ?? candidate,
      blocker: physical.blocker,
      recoveryCandidates,
    };
  }
  const binding = assessMechanismTargetBinding(project, physical.mechanism);
  if (!binding.valid) {
    return {
      status: "rejected",
      mechanism: previous ?? candidate,
      blocker: MECHANISM_BINDING_BLOCKER,
      recoveryCandidates: binding.recoveryCandidates,
    };
  }
  return {
    status: "accepted",
    mechanism: {
      ...physical.mechanism,
      activeVisualPartIds: binding.activeVisualPartIds,
    },
  };
};

export const safeMechanismUpdate = (
  mechanism: MechanismConfig,
  updates: Partial<MechanismConfig>,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => !mechanismUpdateRequiresReplacement(updates) &&
  resolveMechanismCandidateCommit(mechanism, { ...mechanism, ...updates }, kit).status === "accepted";

export const constrainMechanismUpdate = (
  mechanism: MechanismConfig,
  updates: Partial<MechanismConfig>,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Partial<MechanismConfig> => {
  if (mechanismUpdateRequiresReplacement(updates)) return {};
  const result = resolveMechanismCandidateCommit(mechanism, { ...mechanism, ...updates }, kit);
  if (result.status !== "accepted") return {};
  const accepted: Partial<MechanismConfig> = {};
  for (const key of Object.keys(updates) as Array<keyof MechanismConfig>) {
    (accepted as Record<keyof MechanismConfig, unknown>)[key] = result.mechanism[key];
  }
  return accepted;
};

export const constrainMechanismCommit = (
  previous: MechanismConfig,
  next: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConfig => {
  if (previous.id !== next.id) return previous;
  return resolveMechanismCandidateCommit(previous, next, kit).mechanism;
};

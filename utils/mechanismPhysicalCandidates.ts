import type {
  ConnectionSelection,
  ConnectionSelectionRole,
  MechanismConfig,
  PhysicalKitSettings,
} from "../types";
import { defaultPhysicalKit, SCENE_PX_PER_MM } from "./coordinates";
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
} from "./fabricationContract";
import {
  gearTrainPitchRadii,
  gearTrainResolvedCenterDistance,
} from "./kinematics";
import { MECHANISM_BINDING_BLOCKER } from "./pathTargets";
import {
  authorMechanismConnectionSelection,
  connectionSelectionIdentity,
  mechanismConnectionHoleCandidates,
  type ConnectionSelectionSceneState,
  type MechanismConnectionHoleCandidate,
} from "./mechanismConnectionSelections";
import { mechanismEditIsSafe } from "./mechanismEditAuthority";
import { compileMechanismGraphFabrication } from "./mechanismCompiler";
import { normalizeGearLinkageToReference } from "./mechanismReference";
import { validateMechanismPreviewReadiness } from "./mechanismPreviewReadiness";

export type MechanismPhysicalSelectionAttempt =
  | { status: "accepted"; updates: Partial<MechanismConfig> }
  | { status: "rejected"; blocker: typeof MECHANISM_BINDING_BLOCKER };

const physicalFamilyUpdates = (
  mechanism: MechanismConfig,
  selection: ConnectionSelection,
): Partial<MechanismConfig> => {
  if (selection.kind !== "gear-attachment-hole") return {};
  const spec = FABRICATION_GEAR_SPECS.find(
    (candidate) => candidate.key === selection.gearKey,
  );
  const radii = gearTrainPitchRadii(mechanism);
  if (!spec || selection.gearIndex < 0 || selection.gearIndex >= radii.length)
    return {};
  const next = [...radii];
  next[selection.gearIndex] = spec.pitchRadiusMm * SCENE_PX_PER_MM;
  const updates = {
    crankLength: next[0],
    rockerLength: next.at(-1) ?? next[0],
    gearTrainRadii: next,
  } satisfies Partial<MechanismConfig>;
  const resolved = {
    ...updates,
    groundLength: gearTrainResolvedCenterDistance({ ...mechanism, ...updates }),
  };
  if (mechanism.type !== "gear_linkage") return resolved;
  const normalized = normalizeGearLinkageToReference({
    ...mechanism,
    ...resolved,
  });
  return {
    ...resolved,
    speed2: normalized.speed2,
    gearRatio: normalized.gearRatio,
  };
};

const compiledSelectionIsBacked = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  kit: PhysicalKitSettings,
) => {
  const compiled = compileMechanismGraphFabrication(mechanism, kit);
  const summary = compiled.renderPlan.connectionSelectionSummary;
  const connection = summary?.physicalConnections.find(
    (item) => item.role === role,
  );
  if (
    !compiled.buildable ||
    compiled.renderPlan.validationErrors.length ||
    !connection ||
    connectionSelectionIdentity(role, connection.selection) !==
      connectionSelectionIdentity(role, selection)
  ) return false;
  return compiled.renderPlan.layers.some(
    (layer) =>
      layer.sourceNodeId === connection.sourceNodeId &&
      layer.partKey === connection.partKey,
  );
};

const preflightPhysicalSelectionUpdates = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  kit: PhysicalKitSettings,
): Partial<MechanismConfig> | undefined => {
  const familyUpdates = physicalFamilyUpdates(mechanism, selection);
  const prospective = { ...mechanism, ...familyUpdates };
  const updates = authorMechanismConnectionSelection(
    prospective,
    role,
    selection,
    kit,
  );
  if (updates.rejection) return undefined;
  const candidate = { ...prospective, ...updates };
  const {
    connectionSelectionValidation: _connectionSelectionValidation,
    ...candidateWithoutValidation
  } = candidate;
  return mechanismEditIsSafe(candidateWithoutValidation, kit)
    && validateMechanismPreviewReadiness(candidateWithoutValidation, kit).length === 0
    && compiledSelectionIsBacked(candidateWithoutValidation, role, selection, kit)
    ? { ...familyUpdates, ...updates }
    : undefined;
};

export const resolveMechanismPhysicalSelectionAttempt = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismPhysicalSelectionAttempt => {
  const updates = preflightPhysicalSelectionUpdates(
    mechanism,
    role,
    selection,
    kit,
  );
  return updates
    ? { status: "accepted", updates }
    : { status: "rejected", blocker: MECHANISM_BINDING_BLOCKER };
};

const selectionDistanceMm = (selection: ConnectionSelection | undefined) => {
  if (selection?.kind === "gear-attachment-hole") {
    const spec = FABRICATION_GEAR_SPECS.find(
      (candidate) => candidate.key === selection.gearKey,
    );
    const hole = spec?.attachmentHoleCentersMm[selection.holeIndex];
    return hole ? Math.hypot(hole.x, hole.y) : 0;
  }
  if (selection?.kind === "linkage-hole") {
    const spec = FABRICATION_LINKAGE_SPECS.find(
      (candidate) => candidate.key === selection.linkageKey,
    );
    const origin = spec?.holeCentersMm[0];
    const hole = spec?.holeCentersMm[selection.holeIndex];
    return origin && hole ? Math.hypot(hole.x - origin.x, hole.y - origin.y) : 0;
  }
  return 0;
};

export const resolveMechanismPhysicalFamilySelectionAttempt = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  familyKey: string,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismPhysicalSelectionAttempt => {
  const current = mechanism.connectionSelections?.[role];
  const targetDistance = selectionDistanceMm(current);
  const gear = FABRICATION_GEAR_SPECS.find(
    (candidate) => candidate.key === familyKey,
  );
  if (current?.kind === "gear-attachment-hole" && gear?.attachmentHoleCentersMm.length) {
    const holeIndex = gear.attachmentHoleCentersMm.reduce(
      (best, hole, index) =>
        Math.abs(Math.hypot(hole.x, hole.y) - targetDistance) < best.error
          ? { index, error: Math.abs(Math.hypot(hole.x, hole.y) - targetDistance) }
          : best,
      { index: 0, error: Number.POSITIVE_INFINITY },
    ).index;
    return resolveMechanismPhysicalSelectionAttempt(
      mechanism,
      role,
      {
        kind: "gear-attachment-hole",
        gearKey: gear.key,
        gearIndex: current.gearIndex,
        holeIndex,
      },
      kit,
    );
  }
  const linkage = FABRICATION_LINKAGE_SPECS.find(
    (candidate) => candidate.key === familyKey,
  );
  if (current?.kind === "linkage-hole" && linkage && linkage.holeCentersMm.length > 1) {
    const origin = linkage.holeCentersMm[0];
    const holeIndex = linkage.holeCentersMm.slice(1).reduce(
      (best, hole, index) => {
        const distance = Math.hypot(hole.x - origin.x, hole.y - origin.y);
        return Math.abs(distance - targetDistance) < best.error
          ? { index: index + 1, error: Math.abs(distance - targetDistance) }
          : best;
      },
      { index: 1, error: Number.POSITIVE_INFINITY },
    ).index;
    return resolveMechanismPhysicalSelectionAttempt(
      mechanism,
      role,
      { kind: "linkage-hole", linkageKey: linkage.key, holeIndex },
      kit,
    );
  }
  return { status: "rejected", blocker: MECHANISM_BINDING_BLOCKER };
};

/** Canonical UI candidate list: real inventory entries that pass commit authority. */
export const mechanismPhysicalConnectionCandidates = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
  rawSelections: unknown = mechanism.connectionSelections,
): MechanismConnectionHoleCandidate[] =>
  mechanismConnectionHoleCandidates(
    mechanism,
    state,
    rawSelections,
    kit,
  ).filter(
    (candidate) =>
      Boolean(preflightPhysicalSelectionUpdates(
        mechanism,
        candidate.role,
        candidate.selection,
        kit,
      )),
  );

import type {
  ConnectionSelection,
  ConnectionSelectionRole,
  ConnectionSelectionValidation,
  MechanismConfig,
  Point,
} from '../types';
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  fabricationGearSpecForPitchRadius,
} from './fabricationContract';
import { SCENE_PX_PER_MM } from './coordinates';

export const CONNECTION_SELECTION_ROLES = [
  '4bar.input-joint',
  '4bar.output-joint',
  'gear_linkage.drive-pin',
  'gear_linkage.output-pin',
] as const satisfies readonly ConnectionSelectionRole[];

export type ConnectionSelectionSummary = {
  connectionSelections: MechanismConfig['connectionSelections'];
  connectionSelectionValidation: ConnectionSelectionValidation;
};

export const connectionSelectionSignature = (
  selections: MechanismConfig['connectionSelections'],
): string =>
  CONNECTION_SELECTION_ROLES.flatMap((role) => {
    const selection = selections?.[role];
    if (!selection) return [];
    return selection.kind === 'linkage-hole'
      ? `${role}:${selection.linkageKey}:${selection.holeIndex}`
      : `${role}:${selection.gearKey}:${selection.gearIndex}:${selection.holeIndex}`;
  }).join('|');

const roleSet = new Set<string>(CONNECTION_SELECTION_ROLES);
const linkageRoles = new Set<ConnectionSelectionRole>(['4bar.input-joint', '4bar.output-joint']);
const gearRoles = new Set<ConnectionSelectionRole>(['gear_linkage.drive-pin', 'gear_linkage.output-pin']);

const linkageSpec = (key: unknown) =>
  typeof key === 'string' ? FABRICATION_LINKAGE_SPECS.find((spec) => spec.key === key) : undefined;

const gearSpec = (key: unknown) =>
  typeof key === 'string' ? FABRICATION_GEAR_SPECS.find((spec) => spec.key === key) : undefined;

const finiteIndex = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;

const expectedGearIndex = (role: ConnectionSelectionRole, mechanism: MechanismConfig) =>
  role === 'gear_linkage.drive-pin' ? 0 : Math.max(0, (mechanism.gearTrainRadii?.length ?? 2) - 1);

const expectedGearSpec = (role: ConnectionSelectionRole, mechanism: MechanismConfig) => {
  const index = expectedGearIndex(role, mechanism);
  const radius = mechanism.gearTrainRadii?.[index] ?? (role === 'gear_linkage.drive-pin' ? mechanism.crankLength : mechanism.rockerLength);
  return fabricationGearSpecForPitchRadius(Math.abs(radius ?? 0) / SCENE_PX_PER_MM);
};

const linkageSpecForSceneLength = (sceneLength: number, minHoleCount = 3) => {
  const lengthMm = Math.abs(sceneLength) / SCENE_PX_PER_MM;
  const candidates = FABRICATION_LINKAGE_SPECS.filter((spec) => spec.holeCentersMm.length >= minHoleCount);
  const pool = candidates.length ? candidates : FABRICATION_LINKAGE_SPECS;
  return pool.reduce((best, spec) =>
    Math.abs(spec.lengthMm - lengthMm) < Math.abs(best.lengthMm - lengthMm) ? spec : best
  );
};

const defaultLinkageSelection = (mechanism: MechanismConfig, role: ConnectionSelectionRole): ConnectionSelection => {
  const length = role === '4bar.input-joint' ? mechanism.crankLength : mechanism.rockerLength;
  const spec = linkageSpecForSceneLength(length);
  return { kind: 'linkage-hole', linkageKey: spec.key, holeIndex: spec.holeCentersMm.length - 1 };
};

const defaultSelectionForRole = (mechanism: MechanismConfig, role: ConnectionSelectionRole): ConnectionSelection | undefined => {
  if (mechanism.type === '4bar' && linkageRoles.has(role)) return defaultLinkageSelection(mechanism, role);
  if (mechanism.type === 'gear_linkage' && gearRoles.has(role)) return defaultGearSelection(mechanism, role);
  return undefined;
};

const nearestGearAttachmentHoleIndex = (spec: (typeof FABRICATION_GEAR_SPECS)[number], sceneOffset: number) => {
  const targetOffsetMm = Math.abs(sceneOffset) / SCENE_PX_PER_MM;
  return spec.attachmentHoleCentersMm.reduce(
    (best, point, index) => {
      const errorMm = Math.abs(Math.hypot(point.x, point.y) - targetOffsetMm);
      return errorMm < best.errorMm || (errorMm === best.errorMm && index < best.index)
        ? { index, errorMm }
        : best;
    },
    { index: 0, errorMm: Number.POSITIVE_INFINITY },
  ).index;
};

const defaultGearSelection = (mechanism: MechanismConfig, role: ConnectionSelectionRole): ConnectionSelection => {
  const spec = expectedGearSpec(role, mechanism);
  const legacyOffset = Number.isFinite(mechanism.couplerPointDist) ? mechanism.couplerPointDist : 0;
  return {
    kind: 'gear-attachment-hole',
    gearKey: spec.key,
    gearIndex: expectedGearIndex(role, mechanism),
    holeIndex: nearestGearAttachmentHoleIndex(spec, legacyOffset),
  };
};

const defaultSelections = (mechanism: MechanismConfig): Partial<Record<ConnectionSelectionRole, ConnectionSelection>> => {
  if (mechanism.type === '4bar') {
    return {
      '4bar.input-joint': defaultLinkageSelection(mechanism, '4bar.input-joint'),
      '4bar.output-joint': defaultLinkageSelection(mechanism, '4bar.output-joint'),
    };
  }
  if (mechanism.type === 'gear_linkage') {
    return {
      'gear_linkage.drive-pin': defaultGearSelection(mechanism, 'gear_linkage.drive-pin'),
      'gear_linkage.output-pin': defaultGearSelection(mechanism, 'gear_linkage.output-pin'),
    };
  }
  return {};
};

const reject = (validation: ConnectionSelectionValidation, role: string, reason: string) => {
  validation.entries.push({ role, status: 'rejected', reason });
};

const rawSelectionMatches = (value: unknown, selection: ConnectionSelection | undefined) => {
  if (!selection || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return selection.kind === 'linkage-hole'
    ? item.kind === 'linkage-hole' && item.linkageKey === selection.linkageKey && item.holeIndex === selection.holeIndex
    : item.kind === 'gear-attachment-hole' && item.gearKey === selection.gearKey && item.gearIndex === selection.gearIndex && item.holeIndex === selection.holeIndex;
};

export const normalizeMechanismConnectionSelections = (
  mechanism: MechanismConfig,
  rawSelections: unknown,
  priorValidation?: ConnectionSelectionValidation,
): Pick<MechanismConfig, 'connectionSelections' | 'connectionSelectionValidation'> => {
  const priorDefaultedRoles = new Set(
    priorValidation?.entries
      .filter((entry) => entry.status === 'defaulted' && roleSet.has(entry.role))
      .map((entry) => entry.role as ConnectionSelectionRole) ?? [],
  );
  const priorRejectedEntries = priorValidation?.entries
    .filter((entry) => entry.status === 'rejected')
    .sort((a, b) => a.role.localeCompare(b.role)) ?? [];
  const priorRejectedRoles = new Set(
    priorRejectedEntries
      .filter((entry) => roleSet.has(entry.role))
      .map((entry) => entry.role as ConnectionSelectionRole),
  );
  const validation: ConnectionSelectionValidation = { status: 'valid', entries: [] };
  if (rawSelections !== undefined && (!rawSelections || typeof rawSelections !== 'object' || Array.isArray(rawSelections))) {
    reject(validation, 'connectionSelections', 'connection selection state must be a role-keyed object');
    return { connectionSelections: {}, connectionSelectionValidation: { ...validation, status: 'invalid' } };
  }

  const selections: Partial<Record<ConnectionSelectionRole, ConnectionSelection>> = {};
  const rawSelectionEntries = rawSelections === undefined
    ? []
    : Object.entries(rawSelections as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const rawRoles = new Set(rawSelectionEntries.map(([role]) => role));
  validation.entries.push(
    ...priorRejectedEntries.filter((entry) => !rawRoles.has(entry.role)),
  );
  const defaults = defaultSelections(mechanism);
  for (const role of Object.keys(defaults).sort() as ConnectionSelectionRole[]) {
    if (rawRoles.has(role) || priorRejectedRoles.has(role)) continue;
    selections[role] = defaults[role];
    validation.entries.push({ role, status: 'defaulted', reason: 'legacy connection selection absent' });
  }
  for (const role of [...priorDefaultedRoles].sort()) {
    const selection = defaultSelectionForRole(mechanism, role);
    const rawValue = rawSelectionEntries.find(([rawRole]) => rawRole === role)?.[1];
    if (selection && rawSelectionMatches(rawValue, selection)) {
      selections[role] = selection;
      validation.entries.push({ role, status: 'defaulted', reason: 'legacy connection selection absent' });
    }
  }
  for (const [role, value] of rawSelectionEntries) {
    if (priorDefaultedRoles.has(role as ConnectionSelectionRole) && rawSelectionMatches(value, defaultSelectionForRole(mechanism, role as ConnectionSelectionRole))) continue;
    if (!roleSet.has(role)) {
      reject(validation, role, 'invalid role');
      continue;
    }
    const typedRole = role as ConnectionSelectionRole;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      reject(validation, role, 'connection selection value must be an object');
      continue;
    }
    const item = value as Record<string, unknown>;
    if (linkageRoles.has(typedRole)) {
      if (mechanism.type !== '4bar') {
        reject(validation, role, 'role is not valid for mechanism type');
        continue;
      }
      if (item.kind !== 'linkage-hole') {
        reject(validation, role, 'wrong kind for 4bar role');
        continue;
      }
      const spec = linkageSpec(item.linkageKey);
      const holeIndex = finiteIndex(item.holeIndex);
      if (!spec) {
        reject(validation, role, 'invalid linkageKey');
        continue;
      }
      if (holeIndex < 0 || holeIndex >= spec.holeCentersMm.length) {
        reject(validation, role, 'invalid holeIndex');
        continue;
      }
      selections[typedRole] = { kind: 'linkage-hole', linkageKey: spec.key, holeIndex };
      validation.entries.push({ role, status: 'accepted' });
      continue;
    }
    if (mechanism.type !== 'gear_linkage') {
      reject(validation, role, 'role is not valid for mechanism type');
      continue;
    }
    if (!gearRoles.has(typedRole) || item.kind !== 'gear-attachment-hole') {
      reject(validation, role, 'wrong kind for gear_linkage role');
      continue;
    }
    const spec = gearSpec(item.gearKey);
    const gearIndex = finiteIndex(item.gearIndex);
    const holeIndex = finiteIndex(item.holeIndex);
    const expectedIndex = expectedGearIndex(typedRole, mechanism);
    const expectedSpec = expectedGearSpec(typedRole, mechanism);
    if (!spec) {
      reject(validation, role, 'invalid gearKey');
      continue;
    }
    if (spec.key !== expectedSpec.key) {
      reject(validation, role, 'gearKey does not match gear index');
      continue;
    }
    if (gearIndex !== expectedIndex) {
      reject(validation, role, 'invalid gearIndex');
      continue;
    }
    if (holeIndex < 0 || holeIndex >= spec.attachmentHoleCentersMm.length) {
      reject(validation, role, 'invalid holeIndex');
      continue;
    }
    selections[typedRole] = { kind: 'gear-attachment-hole', gearKey: spec.key, gearIndex, holeIndex };
    validation.entries.push({ role, status: 'accepted' });
  }

  const invalid = validation.entries.some((entry) => entry.status === 'rejected');
  const hasSelections = Object.keys(selections).length > 0;
  return {
    connectionSelections: rawSelections === undefined && !hasSelections && validation.entries.length === 0
      ? undefined
      : selections,
    connectionSelectionValidation: validation.entries.length
      ? { ...validation, status: invalid ? 'invalid' : 'valid' }
      : priorValidation?.status === 'invalid'
        ? priorValidation
        : undefined,
  };
};

const resolvedSelectionState = (
  mechanism: MechanismConfig,
): Pick<MechanismConfig, 'connectionSelections' | 'connectionSelectionValidation'> =>
  normalizeMechanismConnectionSelections(
    mechanism,
    mechanism.connectionSelections,
    mechanism.connectionSelectionValidation,
  );

const rotate = (point: Point, angleRad: number): Point => ({
  x: point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
  y: point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
});

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

const scaleMm = (point: Point): Point => ({ x: point.x * SCENE_PX_PER_MM, y: point.y * SCENE_PX_PER_MM });

export type ResolvedConnectionLocal = {
  role: ConnectionSelectionRole;
  selection: ConnectionSelection;
  localOffsetMm: Point;
  localOffset: Point;
  length: number;
  localAngle: number;
};

export type ResolvedConnectionPoint = ResolvedConnectionLocal & {
  position: Point;
  angle: number;
};

export type ResolvedFourBarConnections = {
  selections?: MechanismConfig['connectionSelections'];
  validation?: MechanismConfig['connectionSelectionValidation'];
  inputJoint?: ResolvedConnectionLocal;
  outputJoint?: ResolvedConnectionLocal;
};

export type ResolvedMechanismConnections = {
  selections?: MechanismConfig['connectionSelections'];
  validation?: MechanismConfig['connectionSelectionValidation'];
  inputJoint?: ResolvedConnectionPoint;
  outputJoint?: ResolvedConnectionPoint;
  drivePin?: ResolvedConnectionPoint;
  outputPin?: ResolvedConnectionPoint;
};

const linkageOffsetMm = (selection: ConnectionSelection): Point | undefined => {
  if (selection.kind !== 'linkage-hole') return undefined;
  const spec = linkageSpec(selection.linkageKey);
  const hole = spec?.holeCentersMm[selection.holeIndex];
  const ground = spec?.holeCentersMm[0];
  return hole && ground ? { x: hole.x - ground.x, y: hole.y - ground.y } : undefined;
};

const gearOffsetMm = (selection: ConnectionSelection): Point | undefined => {
  if (selection.kind !== 'gear-attachment-hole') return undefined;
  return gearSpec(selection.gearKey)?.attachmentHoleCentersMm[selection.holeIndex];
};

const resolvedLocal = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection | undefined,
  offsetMm: Point | undefined,
): ResolvedConnectionLocal | undefined => {
  if (!selection || !offsetMm) return undefined;
  const localOffset = scaleMm(offsetMm);
  return {
    role,
    selection,
    localOffsetMm: offsetMm,
    localOffset,
    length: Math.hypot(localOffset.x, localOffset.y),
    localAngle: Math.atan2(localOffset.y, localOffset.x),
  };
};

export const connectionPointAt = (
  connection: ResolvedConnectionLocal,
  origin: Point,
  rotationAngleRad: number,
): ResolvedConnectionPoint => {
  const rotated = rotate(connection.localOffset, rotationAngleRad);
  return {
    ...connection,
    position: add(origin, rotated),
    angle: Math.atan2(rotated.y, rotated.x),
  };
};

export const resolveFourBarConnectionSelections = (
  mechanism: MechanismConfig,
): ResolvedFourBarConnections => {
  const state = resolvedSelectionState(mechanism);
  const inputSelection = state.connectionSelections?.['4bar.input-joint'];
  const outputSelection = state.connectionSelections?.['4bar.output-joint'];
  return {
    selections: state.connectionSelections,
    validation: state.connectionSelectionValidation,
    inputJoint: resolvedLocal('4bar.input-joint', inputSelection, inputSelection && linkageOffsetMm(inputSelection)),
    outputJoint: resolvedLocal('4bar.output-joint', outputSelection, outputSelection && linkageOffsetMm(outputSelection)),
  };
};

export const resolveGearLinkageConnectionGeometry = (
  mechanism: MechanismConfig,
  driveAngleRad: number,
  outputAngleRad: number,
  centers: Point[],
): ResolvedMechanismConnections => {
  const state = resolvedSelectionState(mechanism);
  const driveSelection = state.connectionSelections?.['gear_linkage.drive-pin'];
  const outputSelection = state.connectionSelections?.['gear_linkage.output-pin'];
  const driveConnection = resolvedLocal('gear_linkage.drive-pin', driveSelection, driveSelection && gearOffsetMm(driveSelection));
  const outputConnection = resolvedLocal('gear_linkage.output-pin', outputSelection, outputSelection && gearOffsetMm(outputSelection));
  return {
    selections: state.connectionSelections,
    validation: state.connectionSelectionValidation,
    drivePin: driveConnection && centers[0] ? connectionPointAt(driveConnection, centers[0], driveAngleRad) : undefined,
    outputPin: outputConnection && (centers.at(-1) ?? centers[0])
      ? connectionPointAt(outputConnection, centers.at(-1) ?? centers[0], outputAngleRad)
      : undefined,
  };
};

export type ConnectionSelectionSceneState = {
  p1: Point;
  j1: Point;
  p2: Point;
  j2: Point;
};

export type ResolvedLinkageBlankPose = {
  role: '4bar.input-joint' | '4bar.output-joint';
  selection: Extract<ConnectionSelection, { kind: 'linkage-hole' }>;
  partKey: string;
  holeCount: number;
  selectedHoleIndex: number;
  origin: Point;
  selectedJoint: Point;
  end: Point;
};

export type MechanismConnectionHoleCandidate = {
  role: ConnectionSelectionRole;
  kind: ConnectionSelection['kind'];
  partKey: string;
  holeIndex: number;
  selection: ConnectionSelection;
  coordinate: Point;
  selected: boolean;
};

const sameSelection = (a: ConnectionSelection | undefined, b: ConnectionSelection) => {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'linkage-hole'
    ? b.kind === 'linkage-hole' && a.linkageKey === b.linkageKey && a.holeIndex === b.holeIndex
    : b.kind === 'gear-attachment-hole' && a.gearKey === b.gearKey && a.gearIndex === b.gearIndex && a.holeIndex === b.holeIndex;
};

const angleBetween = (origin: Point, tip: Point) => Math.atan2(tip.y - origin.y, tip.x - origin.x);

const resolvedLinkageBlankPose = (
  role: ResolvedLinkageBlankPose['role'],
  selection: ConnectionSelection | undefined,
  origin: Point,
  selectedJoint: Point,
): ResolvedLinkageBlankPose | undefined => {
  if (selection?.kind !== 'linkage-hole') return undefined;
  const spec = linkageSpec(selection.linkageKey);
  const firstHole = spec?.holeCentersMm[0];
  const selectedHole = spec?.holeCentersMm[selection.holeIndex];
  const lastHole = spec?.holeCentersMm.at(-1);
  if (!spec || !firstHole || !selectedHole || !lastHole) return undefined;
  const selectedOffset = scaleMm({ x: selectedHole.x - firstHole.x, y: selectedHole.y - firstHole.y });
  const fullOffset = scaleMm({ x: lastHole.x - firstHole.x, y: lastHole.y - firstHole.y });
  const selectedLength = Math.hypot(selectedOffset.x, selectedOffset.y);
  const actualLength = Math.hypot(selectedJoint.x - origin.x, selectedJoint.y - origin.y);
  if (selectedLength < 0.001 || actualLength < 0.001) return undefined;
  const phase = angleBetween(origin, selectedJoint) - Math.atan2(selectedOffset.y, selectedOffset.x);
  const scaledFullOffset = rotate(
    { x: fullOffset.x * actualLength / selectedLength, y: fullOffset.y * actualLength / selectedLength },
    phase,
  );
  return {
    role,
    selection,
    partKey: spec.key,
    holeCount: spec.holeCentersMm.length,
    selectedHoleIndex: selection.holeIndex,
    origin,
    selectedJoint,
    end: add(origin, scaledFullOffset),
  };
};

export const resolveFourBarLinkageBlankPoses = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
): Partial<Record<ResolvedLinkageBlankPose['role'], ResolvedLinkageBlankPose>> => {
  if (mechanism.type !== '4bar') return {};
  const selections = resolvedSelectionState(mechanism).connectionSelections;
  const input = resolvedLinkageBlankPose(
    '4bar.input-joint',
    selections?.['4bar.input-joint'],
    state.p1,
    state.j1,
  );
  const output = resolvedLinkageBlankPose(
    '4bar.output-joint',
    selections?.['4bar.output-joint'],
    state.p2,
    state.j2,
  );
  return {
    ...(input ? { '4bar.input-joint': input } : {}),
    ...(output ? { '4bar.output-joint': output } : {}),
  };
};

const scenePoseForRole = (role: ConnectionSelectionRole, state: ConnectionSelectionSceneState) => {
  switch (role) {
    case '4bar.input-joint':
    case 'gear_linkage.drive-pin':
      return { origin: state.p1, angle: angleBetween(state.p1, state.j1) };
    case '4bar.output-joint':
    case 'gear_linkage.output-pin':
      return { origin: state.p2, angle: angleBetween(state.p2, state.j2) };
  }
};

const selectedCoordinatesForSelections = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  selections: MechanismConfig['connectionSelections'],
) => {
  const coordinates: Partial<Record<ConnectionSelectionRole, Point>> = {};
  for (const role of CONNECTION_SELECTION_ROLES) {
    const selection = selections?.[role];
    if (mechanism.type === '4bar' && linkageRoles.has(role) && selection?.kind === 'linkage-hole') {
      const local = resolvedLocal(role, selection, linkageOffsetMm(selection));
      if (!local) continue;
      const pose = scenePoseForRole(role, state);
      coordinates[role] = connectionPointAt(local, pose.origin, pose.angle).position;
    }
    if (mechanism.type === 'gear_linkage' && gearRoles.has(role) && selection?.kind === 'gear-attachment-hole') {
      const local = resolvedLocal(role, selection, gearOffsetMm(selection));
      if (!local) continue;
      coordinates[role] = role === 'gear_linkage.drive-pin' ? state.j1 : state.j2;
    }
  }
  return coordinates;
};

export const connectionSelectionSceneCoordinates = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  rawSelections: unknown = mechanism.connectionSelections,
): Partial<Record<ConnectionSelectionRole, Point>> =>
  selectedCoordinatesForSelections(
    mechanism,
    state,
    normalizeMechanismConnectionSelections(mechanism, rawSelections, mechanism.connectionSelectionValidation).connectionSelections,
  );

export const mechanismConnectionHoleCandidates = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  rawSelections: unknown = mechanism.connectionSelections,
): MechanismConnectionHoleCandidate[] => {
  const resolvedState = normalizeMechanismConnectionSelections(mechanism, rawSelections, mechanism.connectionSelectionValidation);
  const resolved = resolvedState.connectionSelections;
  const selected = resolved ?? {};
  const candidates: MechanismConnectionHoleCandidate[] = [];

  const addLinkageRole = (role: '4bar.input-joint' | '4bar.output-joint') => {
    const active = resolved?.[role] ?? defaultLinkageSelection(mechanism, role);
    if (active?.kind !== 'linkage-hole') return;
    const spec = linkageSpec(active.linkageKey);
    const ground = spec?.holeCentersMm[0];
    if (!spec || !ground) return;
    const pose = scenePoseForRole(role, state);
    spec.holeCentersMm.forEach((hole, holeIndex) => {
      if (holeIndex === 0) return;
      const selection: ConnectionSelection = { kind: 'linkage-hole', linkageKey: spec.key, holeIndex };
      const local = resolvedLocal(role, selection, { x: hole.x - ground.x, y: hole.y - ground.y });
      if (!local) return;
      candidates.push({
        role,
        kind: selection.kind,
        partKey: spec.key,
        holeIndex,
        selection,
        coordinate: connectionPointAt(local, pose.origin, pose.angle).position,
        selected: sameSelection(selected[role], selection),
      });
    });
  };

  const addGearRole = (role: 'gear_linkage.drive-pin' | 'gear_linkage.output-pin') => {
    const active = resolved?.[role] ?? defaultGearSelection(mechanism, role);
    if (active?.kind !== 'gear-attachment-hole') return;
    const spec = gearSpec(active.gearKey);
    const activeLocal = resolvedLocal(role, active, gearOffsetMm(active));
    if (!spec || !activeLocal) return;
    const pose = scenePoseForRole(role, state);
    const phase = pose.angle - activeLocal.localAngle;
    spec.attachmentHoleCentersMm.forEach((hole, holeIndex) => {
      const selection: ConnectionSelection = {
        kind: 'gear-attachment-hole',
        gearKey: spec.key,
        gearIndex: expectedGearIndex(role, mechanism),
        holeIndex,
      };
      const local = resolvedLocal(role, selection, hole);
      if (!local) return;
      candidates.push({
        role,
        kind: selection.kind,
        partKey: spec.key,
        holeIndex,
        selection,
        coordinate: connectionPointAt(local, pose.origin, phase).position,
        selected: sameSelection(selected[role], selection),
      });
    });
  };

  if (mechanism.type === '4bar') {
    addLinkageRole('4bar.input-joint');
    addLinkageRole('4bar.output-joint');
  }
  if (mechanism.type === 'gear_linkage') {
    addGearRole('gear_linkage.drive-pin');
    addGearRole('gear_linkage.output-pin');
  }
  return candidates;
};

export const connectionSelectionAccepted = (
  validation: ConnectionSelectionValidation | undefined,
  role: ConnectionSelectionRole,
) => validation?.entries.some((entry) => entry.role === role && entry.status === 'accepted') ?? false;

export const mechanismConnectionCompatibilityUpdates = (
  mechanism: MechanismConfig,
  state = normalizeMechanismConnectionSelections(
    mechanism,
    mechanism.connectionSelections,
    mechanism.connectionSelectionValidation,
  ),
): Partial<MechanismConfig> => {
  if (mechanism.type !== '4bar') return {};
  const updates: Partial<MechanismConfig> = {};
  const input = state.connectionSelections?.['4bar.input-joint'];
  const output = state.connectionSelections?.['4bar.output-joint'];
  const inputLength = input && resolvedLocal('4bar.input-joint', input, linkageOffsetMm(input))?.length;
  const outputLength = output && resolvedLocal('4bar.output-joint', output, linkageOffsetMm(output))?.length;
  if (inputLength !== undefined && Math.abs((mechanism.crankLength ?? 0) - inputLength) > 0.001) updates.crankLength = inputLength;
  if (outputLength !== undefined && Math.abs((mechanism.rockerLength ?? 0) - outputLength) > 0.001) updates.rockerLength = outputLength;
  return updates;
};

export const authorMechanismConnectionSelection = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
): Partial<MechanismConfig> => {
  const current = resolvedSelectionState(mechanism);
  const priorValidation = current.connectionSelectionValidation
    ? {
        ...current.connectionSelectionValidation,
        entries: current.connectionSelectionValidation.entries.filter(
          (entry) => !(entry.role === role && entry.status === 'defaulted'),
        ),
      }
    : undefined;
  const normalized = normalizeMechanismConnectionSelections(
    mechanism,
    {
      ...(current.connectionSelections ?? {}),
      [role]: selection,
    },
    priorValidation,
  );
  return {
    ...mechanismConnectionCompatibilityUpdates(mechanism, normalized),
    connectionSelections: normalized.connectionSelections,
    connectionSelectionValidation: normalized.connectionSelectionValidation,
  };
};

export const connectionSelectionSummary = (mechanism: MechanismConfig): ConnectionSelectionSummary | undefined => {
  const state = resolvedSelectionState(mechanism);
  return state.connectionSelectionValidation
    ? { connectionSelections: state.connectionSelections, connectionSelectionValidation: state.connectionSelectionValidation }
    : undefined;
};

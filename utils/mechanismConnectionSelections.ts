import type {
  ConnectionSelection,
  ConnectionSelectionRole,
  ConnectionSelectionValidation,
  FabricationBoardMountKey,
  FabricationModuleKey,
  MechanismConfig,
  RejectedConnectionSelectionDiagnostic,
  RejectedConnectionSelectionReason,
  PhysicalKitSettings,
  Point,
} from '../types';
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_MODULE_SPECS,
} from './fabricationContract';
import {
  boardCoordinateLabel,
  boardToScene,
  defaultPhysicalKit,
  isBoardCoordinateInKit,
  parseBoardCoordinateLabel,
  SCENE_PX_PER_MM,
} from './coordinates';
import {
  CONNECTION_SELECTION_ROLES,
  CONNECTION_SELECTION_ROLE_POLICIES,
  connectionSelectionIdentity,
  connectionSelectionPartKey,
  connectionSelectionRolesForMechanism,
  connectionSelectionSourceNodeId,
  defaultSelectionForRole,
  defaultSelections,
  expectedGearIndex,
  expectedGearSpec,
  finiteIndex,
  gearSpec,
  linkageSpec,
  mechanismWithConnectionSelectionFamily,
} from './mechanismConnectionSelectionPolicy';
import { normalizeMechanismToFabricationSet } from './mechanismReference';

export {
  CONNECTION_SELECTION_ROLES,
  CONNECTION_SELECTION_ROLE_POLICIES,
  connectionSelectionIdentity,
  connectionSelectionPartKey,
  connectionSelectionRolesForMechanism,
  connectionSelectionSignature,
  connectionSelectionSourceNodeId,
} from './mechanismConnectionSelectionPolicy';

export type ConnectionSelectionSummary = {
  connectionSelections: MechanismConfig['connectionSelections'];
  connectionSelectionValidation: ConnectionSelectionValidation;
  physicalConnections: readonly ResolvedPhysicalConnection[];
  physicalConnectionSignature: string;
};

const roleSet = new Set<string>(CONNECTION_SELECTION_ROLES);

const KNOWN_KINDS = new Set<ConnectionSelection['kind']>([
  'linkage-hole',
  'gear-attachment-hole',
  'board-mount-pattern',
  'module-hole',
]);
const MAX_INVENTORY_KEY_LENGTH = 64;
const MAX_DIAGNOSTIC_INDEX = 999;
const MAX_REJECTED_SELECTION_DIAGNOSTICS = 12;

export type NormalizeConnectionSelectionOptions = {
  sourceVersion?: 1 | 2;
  priorDiagnostics?: readonly RejectedConnectionSelectionDiagnostic[];
  kit?: PhysicalKitSettings;
};

export type NormalizedConnectionSelectionState = Pick<
  MechanismConfig,
  'connectionSelections' | 'connectionSelectionValidation' | 'rejectedConnectionSelectionDiagnostics'
>;

const boundedCatalogKey = (item: Record<string, unknown>) => {
  const value = [item.linkageKey, item.gearKey, item.mountKey, item.moduleKey]
    .find((candidate) => typeof candidate === 'string');
  return typeof value === 'string' && value
    ? value.slice(0, MAX_INVENTORY_KEY_LENGTH)
    : undefined;
};

const boundedIndices = (item: Record<string, unknown>) => [item.gearIndex, item.holeIndex]
  .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
  .slice(0, 3)
  .map((value) => Math.max(-MAX_DIAGNOSTIC_INDEX, Math.min(MAX_DIAGNOSTIC_INDEX, value)));

const diagnosticFor = (
  sourceVersion: 1 | 2,
  role: string,
  value: unknown,
  reason: RejectedConnectionSelectionReason,
): RejectedConnectionSelectionDiagnostic => {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const kind = typeof item.kind === 'string' && KNOWN_KINDS.has(item.kind as ConnectionSelection['kind'])
    ? item.kind as ConnectionSelection['kind']
    : 'unknown';
  const catalogKey = boundedCatalogKey(item);
  const indices = boundedIndices(item);
  return {
    sourceVersion,
    role: roleSet.has(role) ? role as ConnectionSelectionRole : 'unknown',
    kind,
    ...(catalogKey ? { catalogKey } : {}),
    ...(indices.length ? { indices } : {}),
    reason,
  };
};

const sanitizeDiagnostic = (value: unknown): RejectedConnectionSelectionDiagnostic | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const sourceVersion = raw.sourceVersion === 1 ? 1 : 2;
  const knownReasons: readonly RejectedConnectionSelectionReason[] = [
    'invalid-selection-shape',
    'invalid-role',
    'wrong-family',
    'invalid-kind',
    'invalid-inventory-key',
    'invalid-index',
    'invalid-mount-pattern',
    'incompatible-selection',
  ];
  const role = typeof raw.role === 'string' && roleSet.has(raw.role)
    ? raw.role as ConnectionSelectionRole
    : 'unknown';
  const kind = typeof raw.kind === 'string' && KNOWN_KINDS.has(raw.kind as ConnectionSelection['kind'])
    ? raw.kind as ConnectionSelection['kind']
    : 'unknown';
  const catalogKey = typeof raw.catalogKey === 'string'
    ? raw.catalogKey.slice(0, MAX_INVENTORY_KEY_LENGTH)
    : undefined;
  const indices = Array.isArray(raw.indices)
    ? raw.indices
      .filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
      .slice(0, 3)
      .map((item) => Math.max(-MAX_DIAGNOSTIC_INDEX, Math.min(MAX_DIAGNOSTIC_INDEX, item)))
    : [];
  return {
    sourceVersion,
    role,
    kind,
    ...(catalogKey ? { catalogKey } : {}),
    ...(indices.length ? { indices } : {}),
    reason: knownReasons.includes(raw.reason as RejectedConnectionSelectionReason)
      ? raw.reason as RejectedConnectionSelectionReason
      : 'invalid-selection-shape',
  };
};

const diagnosticIdentity = (diagnostic: RejectedConnectionSelectionDiagnostic) =>
  `${diagnostic.sourceVersion}:${diagnostic.role}:${diagnostic.kind}:${diagnostic.catalogKey ?? ''}:${(diagnostic.indices ?? []).join(',')}:${diagnostic.reason}`;

const boardMountSelection = (
  role: ConnectionSelectionRole,
  item: Record<string, unknown>,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ConnectionSelection | undefined => {
  const expectedMount: FabricationBoardMountKey | undefined = role === 'cam.guide-mount'
    ? 'cam-guide-2-hole'
    : role === 'piston.guide-mount'
      ? 'piston-guide-3-hole'
      : undefined;
  if (item.mountKey !== expectedMount || !expectedMount || !Array.isArray(item.boardHoleIds)) return undefined;
  const spec = FABRICATION_BOARD_MOUNT_SPECS.find((candidate) => candidate.key === expectedMount);
  if (!spec || item.boardHoleIds.length !== spec.sourceHoleIndices.length) return undefined;
  const holes = item.boardHoleIds.map((value) => typeof value === 'string' ? parseBoardCoordinateLabel(value) : null);
  if (holes.some((hole) => !hole || !isBoardCoordinateInKit(hole.label, kit))) return undefined;
  const [first, second, third] = holes as NonNullable<(typeof holes)[number]>[];
  if (!first || !second) return undefined;
  const ordered = expectedMount === 'cam-guide-2-hole'
    ? first.col === second.col && second.row - first.row === -spec.gridPitchCount
    : Boolean(third)
      && first.col === second.col
      && second.col === third!.col
      && second.row - first.row === 1
      && third!.row - first.row === 2;
  if (!ordered) return undefined;
  return {
    kind: 'board-mount-pattern',
    mountKey: expectedMount,
    boardHoleIds: holes.map((hole) => hole!.label),
  };
};

const validateSelection = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  value: unknown,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): { selection?: ConnectionSelection; reason?: RejectedConnectionSelectionReason } => {
  const policy = CONNECTION_SELECTION_ROLE_POLICIES[role];
  if (policy.mechanismType !== mechanism.type) return { reason: 'wrong-family' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { reason: 'invalid-selection-shape' };
  const item = value as Record<string, unknown>;
  if (item.kind !== policy.kind) return { reason: 'invalid-kind' };

  if (item.kind === 'linkage-hole') {
    const spec = linkageSpec(item.linkageKey);
    const holeIndex = finiteIndex(item.holeIndex);
    if (!spec) return { reason: 'invalid-inventory-key' };
    if (holeIndex < 0 || holeIndex >= spec.holeCentersMm.length) return { reason: 'invalid-index' };
    if (role === 'planetary_gear.carrier-planet-pivot' && (spec.key !== 'linkage-4-cell' || holeIndex < 2 || holeIndex > 4)) return { reason: 'incompatible-selection' };
    if (role === 'planetary_gear.carrier-output-hole' && spec.key !== 'linkage-4-cell') return { reason: 'incompatible-selection' };
    if (role === 'piston.crank-pin' && (spec.key !== 'linkage-2-cell' || holeIndex < 1 || holeIndex > 2)) return { reason: 'incompatible-selection' };
    if (role === 'piston.rod-slider-pin' && (spec.key !== 'linkage-6-cell' || holeIndex < 1 || holeIndex > 6)) return { reason: 'incompatible-selection' };
    return { selection: { kind: 'linkage-hole', linkageKey: spec.key, holeIndex } };
  }

  if (item.kind === 'gear-attachment-hole') {
    const spec = gearSpec(item.gearKey);
    const gearIndex = finiteIndex(item.gearIndex);
    const holeIndex = finiteIndex(item.holeIndex);
    const expectedIndex = expectedGearIndex(role, mechanism);
    const expectedSpec = expectedGearSpec(role, mechanism);
    if (!spec || spec.attachmentHoleCentersMm.length === 0) return { reason: 'invalid-inventory-key' };
    if (spec.key !== expectedSpec.key || gearIndex !== expectedIndex) return { reason: 'incompatible-selection' };
    if (holeIndex < 0 || holeIndex >= spec.attachmentHoleCentersMm.length) return { reason: 'invalid-index' };
    return { selection: { kind: 'gear-attachment-hole', gearKey: spec.key, gearIndex, holeIndex } };
  }

  if (item.kind === 'board-mount-pattern') {
    const selection = boardMountSelection(role, item, kit);
    return selection ? { selection } : { reason: 'invalid-mount-pattern' };
  }

  const moduleKey = item.moduleKey as FabricationModuleKey;
  const spec = FABRICATION_MODULE_SPECS.find((candidate) => candidate.key === moduleKey);
  if (!spec || item.moduleKey !== spec.key) return { reason: 'invalid-inventory-key' };
  if (typeof item.holeId !== 'string' || !(item.holeId in spec.holes)) return { reason: 'invalid-index' };
  return {
    selection: {
      kind: 'module-hole',
      moduleKey: spec.key,
      holeId: item.holeId as keyof typeof spec.holes,
    },
  };
};

export const normalizeMechanismConnectionSelections = (
  mechanism: MechanismConfig,
  rawSelections: unknown,
  priorValidation?: ConnectionSelectionValidation,
  options: NormalizeConnectionSelectionOptions = {},
): NormalizedConnectionSelectionState => {
  const sourceVersion = options.sourceVersion ?? 2;
  const kit = options.kit ?? defaultPhysicalKit();
  const diagnostics = new Map<string, RejectedConnectionSelectionDiagnostic>();
  for (const diagnostic of options.priorDiagnostics ?? mechanism.rejectedConnectionSelectionDiagnostics ?? []) {
    const safe = sanitizeDiagnostic(diagnostic);
    if (safe) diagnostics.set(diagnosticIdentity(safe), safe);
  }
  const priorDefaultedRoles = new Set(
    priorValidation?.entries
      .filter((entry) => entry.status === 'defaulted' && roleSet.has(entry.role))
      .map((entry) => entry.role as ConnectionSelectionRole) ?? [],
  );
  const priorRejectedRoles = new Set(
    [...(priorValidation?.entries ?? []), ...diagnostics.values()]
      .filter((entry) => entry.role !== 'unknown' && (('status' in entry && entry.status === 'rejected') || !('status' in entry)))
      .map((entry) => entry.role as ConnectionSelectionRole),
  );
  const validation: ConnectionSelectionValidation = { status: 'valid', entries: [] };
  const validationReason = (
    value: unknown,
    reason: RejectedConnectionSelectionReason,
  ) => {
    const item = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    if (reason === 'invalid-role') return 'invalid role';
    if (reason === 'wrong-family') return 'role is not valid for mechanism type';
    if (reason === 'invalid-kind') return `wrong kind for ${mechanism.type} role`;
    if (reason === 'invalid-inventory-key') {
      if (typeof item.linkageKey === 'string') return 'invalid linkageKey';
      if (typeof item.gearKey === 'string') return 'invalid gearKey';
      if (typeof item.mountKey === 'string') return 'invalid mountKey';
      if (typeof item.moduleKey === 'string') return 'invalid moduleKey';
      return 'invalid inventory key';
    }
    if (reason === 'invalid-index') {
      if (typeof item.gearIndex === 'number') return 'invalid gearIndex';
      if (typeof item.holeIndex === 'number' || typeof item.holeId === 'string') return 'invalid holeIndex';
      return 'invalid index';
    }
    if (reason === 'incompatible-selection' && typeof item.gearKey === 'string') return 'gearKey does not match gear index';
    return reason.replace(/-/g, ' ');
  };
  const reject = (role: string, value: unknown, reason: RejectedConnectionSelectionReason) => {
    const safeRole = role.length > MAX_INVENTORY_KEY_LENGTH ? 'unknown' : role;
    validation.entries.push({ role: safeRole, status: 'rejected', reason: validationReason(value, reason) });
    const diagnostic = diagnosticFor(sourceVersion, role, value, reason);
    diagnostics.set(diagnosticIdentity(diagnostic), diagnostic);
  };
  if (rawSelections !== undefined && (!rawSelections || typeof rawSelections !== 'object' || Array.isArray(rawSelections))) {
    reject('unknown', rawSelections, 'invalid-selection-shape');
    const rejectedConnectionSelectionDiagnostics = [...diagnostics.values()]
      .sort((a, b) => diagnosticIdentity(a).localeCompare(diagnosticIdentity(b)))
      .slice(0, MAX_REJECTED_SELECTION_DIAGNOSTICS);
    return {
      connectionSelections: {},
      connectionSelectionValidation: { ...validation, status: 'invalid' },
      ...(rejectedConnectionSelectionDiagnostics.length ? { rejectedConnectionSelectionDiagnostics } : {}),
    };
  }

  const selections: Partial<Record<ConnectionSelectionRole, ConnectionSelection>> = {};
  const rawSelectionEntries = rawSelections === undefined
    ? []
    : Object.entries(rawSelections as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  const rawRoles = new Set(rawSelectionEntries.map(([role]) => role));
  const retainedRejectedEntries = new Map<string, { role: string; status: 'rejected'; reason?: string }>();
  for (const entry of priorValidation?.entries ?? []) {
    if (entry.status !== 'rejected' || rawRoles.has(entry.role)) continue;
    const role = entry.role.length > MAX_INVENTORY_KEY_LENGTH ? 'unknown' : entry.role;
    retainedRejectedEntries.set(`validation:${role}`, { role, status: 'rejected', ...(entry.reason ? { reason: entry.reason } : {}) });
  }
  for (const diagnostic of diagnostics.values()) {
    if (rawRoles.has(diagnostic.role)) continue;
    const role = diagnostic.role;
    const key = `diagnostic:${role}`;
    const priorAlreadyRepresentsUnknown = role === 'unknown'
      && (priorValidation?.entries ?? []).some((entry) => entry.status === 'rejected' && !roleSet.has(entry.role));
    if (!retainedRejectedEntries.has(`validation:${role}`) && !priorAlreadyRepresentsUnknown) {
      retainedRejectedEntries.set(key, { role, status: 'rejected', reason: diagnostic.reason.replace(/-/g, ' ') });
    }
  }
  validation.entries.push(...retainedRejectedEntries.values());
  const defaults = defaultSelections(mechanism, kit);
  for (const role of Object.keys(defaults).sort() as ConnectionSelectionRole[]) {
    if (rawRoles.has(role) || priorRejectedRoles.has(role)) continue;
    selections[role] = defaults[role];
    validation.entries.push({ role, status: 'defaulted', reason: 'legacy connection selection absent' });
  }
  const refreshedDefaultedRoles = new Set<ConnectionSelectionRole>();
  for (const role of [...priorDefaultedRoles].sort()) {
    const selection = defaultSelectionForRole(mechanism, role, kit);
    if (selection && rawRoles.has(role)) {
      refreshedDefaultedRoles.add(role);
      selections[role] = selection;
      validation.entries.push({ role, status: 'defaulted', reason: 'legacy connection selection absent' });
    }
  }
  for (const [role, value] of rawSelectionEntries) {
    if (refreshedDefaultedRoles.has(role as ConnectionSelectionRole)) continue;
    if (!roleSet.has(role)) {
      reject(role, value, 'invalid-role');
      continue;
    }
    const typedRole = role as ConnectionSelectionRole;
    const result = validateSelection(mechanism, typedRole, value, kit);
    if (!result.selection) {
      reject(role, value, result.reason ?? 'invalid-selection-shape');
      continue;
    }
    selections[typedRole] = result.selection;
    validation.entries.push({ role, status: 'accepted' });
    for (const [identity, diagnostic] of diagnostics) {
      if (diagnostic.role === typedRole) diagnostics.delete(identity);
    }
  }

  const planet = selections['planetary_gear.carrier-planet-pivot'];
  const output = selections['planetary_gear.carrier-output-hole'];
  if (planet?.kind === 'linkage-hole' && output?.kind === 'linkage-hole'
    && (planet.linkageKey !== output.linkageKey || output.holeIndex === planet.holeIndex || output.holeIndex === planet.holeIndex - 2)) {
    delete selections['planetary_gear.carrier-output-hole'];
    validation.entries = validation.entries.filter((entry) => entry.role !== 'planetary_gear.carrier-output-hole');
    reject('planetary_gear.carrier-output-hole', output, 'incompatible-selection');
  }

  const invalid = validation.entries.some((entry) => entry.status === 'rejected');
  const rejectedConnectionSelectionDiagnostics = [...diagnostics.values()]
    .sort((a, b) => diagnosticIdentity(a).localeCompare(diagnosticIdentity(b)))
    .slice(0, MAX_REJECTED_SELECTION_DIAGNOSTICS);
  const hasSelections = Object.keys(selections).length > 0;
  return {
    connectionSelections: rawSelections === undefined && !hasSelections && validation.entries.length === 0
      ? undefined
      : selections,
    connectionSelectionValidation: validation.entries.length
      ? { ...validation, status: invalid ? 'invalid' : 'valid' }
      : undefined,
    ...(rejectedConnectionSelectionDiagnostics.length ? { rejectedConnectionSelectionDiagnostics } : {}),
  };
};

const resolvedSelectionState = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Pick<MechanismConfig, 'connectionSelections' | 'connectionSelectionValidation'> =>
  normalizeMechanismConnectionSelections(
    mechanism,
    mechanism.connectionSelections,
    mechanism.connectionSelectionValidation,
    { kit },
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

export type ResolvedBoardMountPose = {
  selection: Extract<ConnectionSelection, { kind: 'board-mount-pattern' }>;
  origin: Point;
  center: Point;
  length: number;
  axisAngle: number;
  sourceRotation: number;
};

/** Derives board-space orientation from the selected tuple, never an assumed asset orientation. */
export const resolveBoardMountPose = (
  selection: ConnectionSelection | undefined,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ResolvedBoardMountPose | undefined => {
  if (selection?.kind !== 'board-mount-pattern') return undefined;
  const spec = FABRICATION_BOARD_MOUNT_SPECS.find((item) => item.key === selection.mountKey);
  const sourceStart = spec?.sourceHoleCentersMm[0];
  const sourceEnd = spec?.sourceHoleCentersMm.at(-1);
  const first = parseBoardCoordinateLabel(selection.boardHoleIds[0]);
  const last = parseBoardCoordinateLabel(selection.boardHoleIds.at(-1));
  if (!spec || !sourceStart || !sourceEnd || !first || !last) return undefined;
  const origin = boardToScene(first.col, first.row, kit);
  const end = boardToScene(last.col, last.row, kit);
  const sourceAngle = Math.atan2(sourceEnd.y - sourceStart.y, sourceEnd.x - sourceStart.x);
  const axisAngle = Math.atan2(end.y - origin.y, end.x - origin.x);
  return {
    selection,
    origin,
    center: { x: (origin.x + end.x) / 2, y: (origin.y + end.y) / 2 },
    length: Math.hypot(end.x - origin.x, end.y - origin.y),
    axisAngle,
    sourceRotation: axisAngle - sourceAngle,
  };
};

const linkageOffsetMmForRole = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  selections: MechanismConfig['connectionSelections'],
) => {
  if (selection.kind !== 'linkage-hole') return undefined;
  const spec = linkageSpec(selection.linkageKey);
  const hole = spec?.holeCentersMm[selection.holeIndex];
  const planetSelection = role === 'planetary_gear.carrier-planet-pivot'
    ? selection
    : selections?.['planetary_gear.carrier-planet-pivot'];
  const anchorIndex = role.startsWith('planetary_gear.') && planetSelection?.kind === 'linkage-hole'
    ? planetSelection.holeIndex - 2
    : 0;
  const anchor = spec?.holeCentersMm[anchorIndex];
  return hole && anchor ? { x: hole.x - anchor.x, y: hole.y - anchor.y } : undefined;
};

const linkageAnchorHoleIndexForRole = (
  role: ConnectionSelectionRole,
  selection: Extract<ConnectionSelection, { kind: 'linkage-hole' }>,
  selections: MechanismConfig['connectionSelections'],
) => {
  if (!role.startsWith('planetary_gear.')) return 0;
  const planet = role === 'planetary_gear.carrier-planet-pivot'
    ? selection
    : selections?.['planetary_gear.carrier-planet-pivot'];
  return planet?.kind === 'linkage-hole' ? planet.holeIndex - 2 : -1;
};

const resolvedLinkageAssetGeometry = (
  role: ConnectionSelectionRole,
  selection: Extract<ConnectionSelection, { kind: 'linkage-hole' }>,
  selections: MechanismConfig['connectionSelections'],
): ResolvedLinkageAssetGeometry | undefined => {
  const spec = linkageSpec(selection.linkageKey);
  const anchorHoleIndex = linkageAnchorHoleIndexForRole(role, selection, selections);
  const anchor = spec?.holeCentersMm[anchorHoleIndex];
  const start = spec?.holeCentersMm[0];
  const end = spec?.holeCentersMm.at(-1);
  if (!anchor || !start || !end) return undefined;
  const startOffsetMm = { x: start.x - anchor.x, y: start.y - anchor.y };
  const endOffsetMm = { x: end.x - anchor.x, y: end.y - anchor.y };
  return {
    anchorHoleIndex,
    holeCount: spec.holeCentersMm.length,
    startOffsetMm,
    endOffsetMm,
    centerOffsetMm: {
      x: (startOffsetMm.x + endOffsetMm.x) / 2,
      y: (startOffsetMm.y + endOffsetMm.y) / 2,
    },
  };
};

const moduleOffsetMm = (selection: ConnectionSelection) => {
  if (selection.kind !== 'module-hole') return undefined;
  const spec = FABRICATION_MODULE_SPECS.find((item) => item.key === selection.moduleKey);
  const origin = spec?.holes['output-0'];
  const hole = spec?.holes[selection.holeId];
  return origin && hole ? { x: hole.x - origin.x, y: hole.y - origin.y } : undefined;
};

export type ResolvedPhysicalConnection = {
  role: ConnectionSelectionRole;
  selection: ConnectionSelection;
  sourceNodeId: string;
  partKey: string;
  local?: ResolvedConnectionLocal;
  linkageAsset?: ResolvedLinkageAssetGeometry;
  boardMount?: ResolvedBoardMountPose;
};

/**
 * The physical blank is anchored at the role's derived source hole. Keeping
 * these source-local extents alongside the selected local offset lets the
 * instance and collision paths place the complete printed blank rather than
 * a scalar endpoint segment.
 */
export type ResolvedLinkageAssetGeometry = {
  anchorHoleIndex: number;
  holeCount: number;
  startOffsetMm: Point;
  endOffsetMm: Point;
  centerOffsetMm: Point;
};

export type ResolvedPhysicalConnectionSet = {
  selections?: MechanismConfig['connectionSelections'];
  validation?: MechanismConfig['connectionSelectionValidation'];
  valid: boolean;
  connections: ResolvedPhysicalConnection[];
};

/** Stable graph/compiler handoff fingerprint for real source-node assets. */
export const physicalConnectionSignature = (
  connections: readonly ResolvedPhysicalConnection[],
) => [...connections]
  .sort((left, right) => CONNECTION_SELECTION_ROLES.indexOf(left.role) - CONNECTION_SELECTION_ROLES.indexOf(right.role))
  .map((connection) => `${connectionSelectionIdentity(connection.role, connection.selection)}:${connection.sourceNodeId}:${connection.partKey}`)
  .join('|');

/**
 * Single structural resolver for every authorable physical role. Its records
 * are the only source of role -> selection -> graph node -> printable asset.
 */
export const resolveMechanismPhysicalConnections = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ResolvedPhysicalConnectionSet => {
  const state = resolvedSelectionState(mechanism, kit);
  const selections = state.connectionSelections;
  const connections = connectionSelectionRolesForMechanism(mechanism.type).flatMap((role) => {
    const selection = selections?.[role];
    if (!selection) return [];
    const localOffsetMm = selection.kind === 'linkage-hole'
      ? linkageOffsetMmForRole(role, selection, selections)
      : selection.kind === 'gear-attachment-hole'
        ? gearOffsetMm(selection)
        : selection.kind === 'module-hole'
          ? moduleOffsetMm(selection)
          : undefined;
    const local = resolvedLocal(role, selection, localOffsetMm);
    const boardMount = resolveBoardMountPose(selection, kit);
    const linkageAsset = selection.kind === 'linkage-hole'
      ? resolvedLinkageAssetGeometry(role, selection, selections)
      : undefined;
    return [{
      role,
      selection,
      sourceNodeId: connectionSelectionSourceNodeId(role, selection),
      partKey: connectionSelectionPartKey(role, selection),
      ...(local ? { local } : {}),
      ...(linkageAsset ? { linkageAsset } : {}),
      ...(boardMount ? { boardMount } : {}),
    }];
  });
  const requiredRoles = connectionSelectionRolesForMechanism(mechanism.type);
  return {
    selections,
    validation: state.connectionSelectionValidation,
    valid: state.connectionSelectionValidation?.status !== 'invalid'
      && requiredRoles.every((role) => connections.some((connection) => connection.role === role)),
    connections,
  };
};

export const physicalConnectionForRole = (
  resolved: ResolvedPhysicalConnectionSet,
  role: ConnectionSelectionRole,
) => resolved.connections.find((connection) => connection.role === role);

export const physicalConnectionForSourceNode = (
  resolved: ResolvedPhysicalConnectionSet,
  sourceNodeId: string | undefined,
) => resolved.connections.find((connection) => connection.sourceNodeId === sourceNodeId);

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
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ResolvedFourBarConnections => {
  const resolved = resolveMechanismPhysicalConnections(mechanism, kit);
  return {
    selections: resolved.selections,
    validation: resolved.validation,
    inputJoint: physicalConnectionForRole(resolved, '4bar.input-joint')?.local,
    outputJoint: physicalConnectionForRole(resolved, '4bar.output-joint')?.local,
  };
};

export const resolveGearLinkageConnectionGeometry = (
  mechanism: MechanismConfig,
  driveAngleRad: number,
  outputAngleRad: number,
  centers: Point[],
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ResolvedMechanismConnections => {
  const resolved = resolveMechanismPhysicalConnections(mechanism, kit);
  const driveConnection = physicalConnectionForRole(resolved, 'gear_linkage.drive-pin')?.local;
  const outputConnection = physicalConnectionForRole(resolved, 'gear_linkage.output-pin')?.local;
  return {
    selections: resolved.selections,
    validation: resolved.validation,
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
  effector?: Point;
};

/** The derived source anchor and selected physical point for one sampled state. */
export const physicalConnectionAnchorAndSelected = (
  connection: ResolvedPhysicalConnection | undefined,
  state: ConnectionSelectionSceneState,
): { anchor: Point; selected: Point } | undefined => {
  if (!connection?.local) return undefined;
  switch (connection.role) {
    case '4bar.input-joint':
    case 'gear_linkage.drive-pin':
    case 'gear.drive-pin':
    case 'piston.crank-pin':
      return { anchor: state.p1, selected: state.j1 };
    case '4bar.output-joint':
    case 'gear_linkage.output-pin':
    case 'gear.output-pin':
      return { anchor: state.p2, selected: state.j2 };
    case 'planetary_gear.carrier-planet-pivot':
      return { anchor: state.p1, selected: state.p2 };
    case 'planetary_gear.carrier-output-hole':
      return state.effector ? { anchor: state.p1, selected: state.effector } : undefined;
    case 'cam.follower-output-hole':
      return state.effector ? { anchor: state.j2, selected: state.effector } : undefined;
    case 'piston.rod-slider-pin':
      return { anchor: state.j1, selected: state.j2 };
    case 'cam.guide-mount':
    case 'piston.guide-mount':
      return undefined;
  }
};

export type ResolvedPhysicalLinkageAssetPose = {
  start: Point;
  end: Point;
  center: Point;
  rotation: number;
};

/**
 * Transforms the real source blank from its selected anchor hole. This is
 * shared by renderer instances and collision envelopes so neither can turn a
 * selected hole into an unrelated scalar line segment.
 */
export const resolvePhysicalLinkageAssetPose = (
  connection: ResolvedPhysicalConnection | undefined,
  sampled: { anchor: Point; selected: Point } | undefined,
): ResolvedPhysicalLinkageAssetPose | undefined => {
  if (!connection?.local || !connection.linkageAsset || !sampled) return undefined;
  const dx = sampled.selected.x - sampled.anchor.x;
  const dy = sampled.selected.y - sampled.anchor.y;
  if (Math.hypot(dx, dy) < 0.001) return undefined;
  const rotation = Math.atan2(dy, dx) - connection.local.localAngle;
  const world = (offsetMm: Point) => add(sampled.anchor, rotate(scaleMm(offsetMm), rotation));
  return {
    start: world(connection.linkageAsset.startOffsetMm),
    end: world(connection.linkageAsset.endOffsetMm),
    center: world(connection.linkageAsset.centerOffsetMm),
    rotation,
  };
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
  printedPartKey: string;
  sourceNodeId: string;
  identity: string;
  holeIndex: number;
  selection: ConnectionSelection;
  coordinate: Point;
  frameProjection: MechanismConnectionFrameProjection;
  legal: true;
  recoveryEligible: boolean;
  selected: boolean;
  provisional: boolean;
};

export type MechanismConnectionFrameProjection =
  | { kind: 'fixed'; coordinate: Point }
  | {
      kind: 'local';
      local: ResolvedConnectionLocal;
      activeLocal: ResolvedConnectionLocal;
      guideSourceRotation?: number;
    };

const sameSelection = (a: ConnectionSelection | undefined, b: ConnectionSelection) => {
  if (!a || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'linkage-hole':
      return b.kind === 'linkage-hole'
        && a.linkageKey === b.linkageKey
        && a.holeIndex === b.holeIndex;
    case 'gear-attachment-hole':
      return b.kind === 'gear-attachment-hole'
        && a.gearKey === b.gearKey
        && a.gearIndex === b.gearIndex
        && a.holeIndex === b.holeIndex;
    case 'board-mount-pattern':
      return b.kind === 'board-mount-pattern'
        && a.mountKey === b.mountKey
        && a.boardHoleIds.length === b.boardHoleIds.length
        && a.boardHoleIds.every((hole, index) => hole === b.boardHoleIds[index]);
    case 'module-hole':
      return b.kind === 'module-hole'
        && a.moduleKey === b.moduleKey
        && a.holeId === b.holeId;
  }
};

const angleBetween = (origin: Point, tip: Point) => Math.atan2(tip.y - origin.y, tip.x - origin.x);

const resolvedLinkageBlankPose = (
  role: ResolvedLinkageBlankPose['role'],
  connection: ResolvedPhysicalConnection | undefined,
  origin: Point,
  selectedJoint: Point,
): ResolvedLinkageBlankPose | undefined => {
  const selection = connection?.selection;
  const local = connection?.local;
  const asset = connection?.linkageAsset;
  if (selection?.kind !== 'linkage-hole' || !local || !asset) return undefined;
  const fullOffset = scaleMm(asset.endOffsetMm);
  const selectedLength = local.length;
  const actualLength = Math.hypot(selectedJoint.x - origin.x, selectedJoint.y - origin.y);
  if (selectedLength < 0.001 || actualLength < 0.001) return undefined;
  const phase = angleBetween(origin, selectedJoint) - local.localAngle;
  const scaledFullOffset = rotate(
    { x: fullOffset.x * actualLength / selectedLength, y: fullOffset.y * actualLength / selectedLength },
    phase,
  );
  return {
    role,
    selection,
    partKey: connection.partKey,
    holeCount: asset.holeCount,
    selectedHoleIndex: selection.holeIndex,
    origin,
    selectedJoint,
    end: add(origin, scaledFullOffset),
  };
};

export const resolveFourBarLinkageBlankPosesFromPhysicalConnections = (
  connections: readonly ResolvedPhysicalConnection[],
  state: ConnectionSelectionSceneState,
): Partial<Record<ResolvedLinkageBlankPose['role'], ResolvedLinkageBlankPose>> => {
  const input = resolvedLinkageBlankPose(
    '4bar.input-joint',
    connections.find((connection) => connection.role === '4bar.input-joint'),
    state.p1,
    state.j1,
  );
  const output = resolvedLinkageBlankPose(
    '4bar.output-joint',
    connections.find((connection) => connection.role === '4bar.output-joint'),
    state.p2,
    state.j2,
  );
  return {
    ...(input ? { '4bar.input-joint': input } : {}),
    ...(output ? { '4bar.output-joint': output } : {}),
  };
};

export const resolveFourBarLinkageBlankPoses = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Partial<Record<ResolvedLinkageBlankPose['role'], ResolvedLinkageBlankPose>> => {
  if (mechanism.type !== '4bar') return {};
  return resolveFourBarLinkageBlankPosesFromPhysicalConnections(
    resolveMechanismPhysicalConnections(mechanism, kit).connections,
    state,
  );
};

const localForSelection = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  selections: MechanismConfig['connectionSelections'],
) => {
  const offsetMm = selection.kind === 'linkage-hole'
    ? linkageOffsetMmForRole(role, selection, selections)
    : selection.kind === 'gear-attachment-hole'
      ? gearOffsetMm(selection)
      : selection.kind === 'module-hole'
        ? moduleOffsetMm(selection)
        : undefined;
  return resolvedLocal(role, selection, offsetMm);
};

const candidatePartKey = (selection: ConnectionSelection) => selection.kind === 'linkage-hole'
  ? selection.linkageKey
  : selection.kind === 'gear-attachment-hole'
    ? selection.gearKey
    : selection.kind === 'board-mount-pattern'
      ? selection.mountKey
      : selection.moduleKey;

const selectedCoordinateForRole = (
  _role: ConnectionSelectionRole,
  connection: ResolvedPhysicalConnection | undefined,
  state: ConnectionSelectionSceneState,
): Point | undefined => {
  if (!connection) return undefined;
  if (connection.boardMount) return connection.boardMount.center;
  return physicalConnectionAnchorAndSelected(connection, state)?.selected;
};

const selectedCoordinatesForSelections = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  selections: MechanismConfig['connectionSelections'],
  kit: PhysicalKitSettings,
) => {
  const resolved = resolveMechanismPhysicalConnections({
    ...mechanism,
    connectionSelections: selections,
    connectionSelectionValidation: undefined,
  }, kit);
  return connectionSelectionSceneCoordinatesForPhysicalConnections(
    resolved.connections,
    state,
  );
};

export const connectionSelectionSceneCoordinatesForPhysicalConnections = (
  connections: readonly ResolvedPhysicalConnection[],
  state: ConnectionSelectionSceneState,
): Partial<Record<ConnectionSelectionRole, Point>> =>
  connections.reduce<Partial<Record<ConnectionSelectionRole, Point>>>((coordinates, connection) => {
    const coordinate = selectedCoordinateForRole(connection.role, connection, state);
    if (coordinate) coordinates[connection.role] = coordinate;
    return coordinates;
  }, {});

export const connectionSelectionSceneCoordinates = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  rawSelections: unknown = mechanism.connectionSelections,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Partial<Record<ConnectionSelectionRole, Point>> =>
  selectedCoordinatesForSelections(
    mechanism,
    state,
    normalizeMechanismConnectionSelections(
      mechanism,
      rawSelections,
      mechanism.connectionSelectionValidation,
      { kit },
    ).connectionSelections,
    kit,
  );

const candidateFrameProjection = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  active: ConnectionSelection | undefined,
  selections: MechanismConfig['connectionSelections'],
  kit: PhysicalKitSettings,
): MechanismConnectionFrameProjection | undefined => {
  const mounted = resolveBoardMountPose(selection, kit);
  if (mounted) return { kind: 'fixed', coordinate: mounted.center };
  const local = localForSelection(role, selection, selections);
  const activeLocal = active ? localForSelection(role, active, selections) : undefined;
  if (!local || !activeLocal) return undefined;
  const guide = selections?.['cam.guide-mount'];
  const guideSourceRotation = role === 'cam.follower-output-hole'
    ? resolveBoardMountPose(guide, kit)?.sourceRotation
    : undefined;
  return {
    kind: 'local',
    local,
    activeLocal,
    ...(guideSourceRotation !== undefined ? { guideSourceRotation } : {}),
  };
};

const candidateCoordinate = (
  role: ConnectionSelectionRole,
  state: ConnectionSelectionSceneState,
  projection: MechanismConnectionFrameProjection,
): Point | undefined => {
  if (projection.kind === 'fixed') return projection.coordinate;
  const { local, activeLocal } = projection;
  const phaseFrom = (origin: Point, selectedPoint: Point) =>
    angleBetween(origin, selectedPoint) - activeLocal.localAngle;
  switch (role) {
    case '4bar.input-joint':
      return connectionPointAt(local, state.p1, phaseFrom(state.p1, state.j1)).position;
    case '4bar.output-joint':
      return connectionPointAt(local, state.p2, phaseFrom(state.p2, state.j2)).position;
    case 'gear_linkage.drive-pin':
    case 'gear.drive-pin':
      return connectionPointAt(local, state.p1, phaseFrom(state.p1, state.j1)).position;
    case 'gear_linkage.output-pin':
    case 'gear.output-pin':
      return connectionPointAt(local, state.p2, phaseFrom(state.p2, state.j2)).position;
    case 'planetary_gear.carrier-planet-pivot':
      return connectionPointAt(local, state.p1, phaseFrom(state.p1, state.p2)).position;
    case 'planetary_gear.carrier-output-hole':
      return connectionPointAt(local, state.p1, phaseFrom(state.p1, state.effector ?? state.j2)).position;
    case 'piston.crank-pin':
      return connectionPointAt(local, state.p1, phaseFrom(state.p1, state.j1)).position;
    case 'piston.rod-slider-pin':
      return connectionPointAt(local, state.j1, phaseFrom(state.j1, state.j2)).position;
    case 'cam.follower-output-hole': {
      return connectionPointAt(
        local,
        state.j2,
        projection.guideSourceRotation ?? 0,
      ).position;
    }
  }
};

export const mechanismConnectionHoleCandidates = (
  mechanism: MechanismConfig,
  state: ConnectionSelectionSceneState,
  rawSelections: unknown = mechanism.connectionSelections,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConnectionHoleCandidate[] => {
  const resolvedState = normalizeMechanismConnectionSelections(
    mechanism,
    rawSelections,
    mechanism.connectionSelectionValidation,
    { kit },
  );
  const resolved = resolvedState.connectionSelections;
  const selected = resolved ?? {};
  const candidates: MechanismConnectionHoleCandidate[] = [];
  const structuralMechanism = {
    ...mechanism,
    connectionSelectionValidation: undefined,
    rejectedConnectionSelectionDiagnostics: undefined,
  };
  const isLegal = (role: ConnectionSelectionRole, selection: ConnectionSelection) => {
    // Rejected sibling roles are repair evidence, not a reason to hide this
    // role's real asset holes. Re-normalize the current retained selections
    // without stale diagnostics so this candidate is judged only against the
    // structural selections it would actually coexist with.
    const prospectiveMechanism = mechanismWithConnectionSelectionFamily(
      structuralMechanism,
      role,
      selection,
    );
    const normalized = normalizeMechanismConnectionSelections(
      prospectiveMechanism,
      { ...selected, [role]: selection },
      undefined,
      { kit },
    );
    return normalized.connectionSelectionValidation?.status === 'valid'
      && sameSelection(normalized.connectionSelections?.[role], selection)
      && normalized.connectionSelectionValidation?.entries.some(
        (entry) => entry.role === role && (entry.status === 'accepted' || entry.status === 'defaulted'),
      );
  };
  const add = (
    role: ConnectionSelectionRole,
    selection: ConnectionSelection,
    frameProjection: MechanismConnectionFrameProjection | undefined,
    holeIndex: number,
  ) => {
    const coordinate = frameProjection
      ? candidateCoordinate(role, state, frameProjection)
      : undefined;
    if (!coordinate || !frameProjection || !isLegal(role, selection)) return;
    const active = selected[role] ?? defaultSelectionForRole(mechanism, role, kit);
    const selectedForRole = selected[role];
    candidates.push({
      role,
      kind: selection.kind,
      partKey: candidatePartKey(selection),
      printedPartKey: connectionSelectionPartKey(role, selection),
      sourceNodeId: connectionSelectionSourceNodeId(role, selection),
      identity: connectionSelectionIdentity(role, selection),
      holeIndex,
      selection,
      coordinate,
      frameProjection,
      legal: true,
      recoveryEligible: !sameSelection(selectedForRole, selection),
      selected: sameSelection(selectedForRole, selection),
      provisional: !selectedForRole && sameSelection(active, selection),
    });
  };
  const addLinkageRole = (role: Extract<ConnectionSelectionRole, `${'4bar' | 'planetary_gear' | 'piston'}.${string}`>, allowed: (index: number) => boolean) => {
    const active = selected[role] ?? defaultSelectionForRole(mechanism, role, kit);
    if (active?.kind !== 'linkage-hole') return;
    const specs = mechanism.type === '4bar'
      ? FABRICATION_LINKAGE_SPECS
      : FABRICATION_LINKAGE_SPECS.filter((spec) => spec.key === active.linkageKey);
    specs.forEach((spec) => {
      spec.holeCentersMm.forEach((_, holeIndex) => {
        if (!allowed(holeIndex)) return;
        const selection: ConnectionSelection = { kind: 'linkage-hole', linkageKey: spec.key, holeIndex };
        add(
          role,
          selection,
          candidateFrameProjection(
            mechanism,
            role,
            selection,
            active,
            { ...selected, [role]: selection },
            kit,
          ),
          holeIndex,
        );
      });
    });
  };
  const addGearRole = (role: Extract<ConnectionSelectionRole, `${'gear' | 'gear_linkage'}.${string}`>) => {
    const active = selected[role] ?? defaultSelectionForRole(mechanism, role, kit);
    if (active?.kind !== 'gear-attachment-hole') return;
    FABRICATION_GEAR_SPECS.forEach((spec) => {
      spec.attachmentHoleCentersMm.forEach((_, holeIndex) => {
        const selection: ConnectionSelection = { kind: 'gear-attachment-hole', gearKey: spec.key, gearIndex: expectedGearIndex(role, mechanism), holeIndex };
        add(
          role,
          selection,
          candidateFrameProjection(
            mechanism,
            role,
            selection,
            active,
            { ...selected, [role]: selection },
            kit,
          ),
          holeIndex,
        );
      });
    });
  };
  const addBoardMount = (role: 'cam.guide-mount' | 'piston.guide-mount') => {
    const spec = FABRICATION_BOARD_MOUNT_SPECS.find((item) =>
      item.key === (role === 'cam.guide-mount' ? 'cam-guide-2-hole' : 'piston-guide-3-hole')
    );
    if (!spec) return;
    let candidateIndex = 0;
    for (let col = 0; col < kit.boardCells; col += 1) {
      const firstRows = role === 'cam.guide-mount'
        ? Array.from(
            { length: Math.max(0, kit.boardCells - spec.gridPitchCount) },
            (_, index) => index + spec.gridPitchCount,
          )
        : Array.from(
            { length: Math.max(0, kit.boardCells - spec.sourceHoleIndices.length + 1) },
            (_, index) => index,
          );
      for (const firstRow of firstRows) {
        const boardHoleIds = role === 'cam.guide-mount'
          ? [
              boardCoordinateLabel(col, firstRow),
              boardCoordinateLabel(col, firstRow - spec.gridPitchCount),
            ]
          : spec.sourceHoleIndices.map((_, index) =>
              boardCoordinateLabel(col, firstRow + index)
            );
        const selection: ConnectionSelection = {
          kind: 'board-mount-pattern',
          mountKey: spec.key,
          boardHoleIds,
        };
        add(
          role,
          selection,
          candidateFrameProjection(
            mechanism,
            role,
            selection,
            selected[role],
            { ...selected, [role]: selection },
            kit,
          ),
          candidateIndex,
        );
        candidateIndex += 1;
      }
    }
  };
  const addModuleRole = () => {
    const role = 'cam.follower-output-hole' as const;
    const active = selected[role] ?? defaultSelectionForRole(mechanism, role, kit);
    if (active?.kind !== 'module-hole') return;
    const spec = FABRICATION_MODULE_SPECS.find(item => item.key === active.moduleKey);
    if (!spec) return;
    Object.keys(spec.holes).forEach((holeId, holeIndex) => {
      const selection: ConnectionSelection = { kind: 'module-hole', moduleKey: spec.key, holeId: holeId as keyof typeof spec.holes };
      add(
        role,
        selection,
        candidateFrameProjection(
          mechanism,
          role,
          selection,
          active,
          { ...selected, [role]: selection },
          kit,
        ),
        holeIndex,
      );
    });
  };

  if (mechanism.type === '4bar') {
    addLinkageRole('4bar.input-joint', index => index > 0);
    addLinkageRole('4bar.output-joint', index => index > 0);
  } else if (mechanism.type === 'gear_linkage') {
    addGearRole('gear_linkage.drive-pin');
    addGearRole('gear_linkage.output-pin');
  } else if (mechanism.type === 'gear') {
    addGearRole('gear.drive-pin');
    addGearRole('gear.output-pin');
  } else if (mechanism.type === 'planetary_gear') {
    addLinkageRole('planetary_gear.carrier-planet-pivot', index => index >= 2 && index <= 4);
    addLinkageRole('planetary_gear.carrier-output-hole', () => true);
  } else if (mechanism.type === 'cam') {
    addBoardMount('cam.guide-mount');
    addModuleRole();
  } else if (mechanism.type === 'piston') {
    addLinkageRole('piston.crank-pin', index => index >= 1 && index <= 2);
    addLinkageRole('piston.rod-slider-pin', index => index >= 1 && index <= 6);
    addBoardMount('piston.guide-mount');
  }
  return candidates;
};

/** Reproject an already validated catalog candidate set using frame math only. */
export const projectMechanismConnectionHoleCandidates = (
  state: ConnectionSelectionSceneState,
  candidates: readonly MechanismConnectionHoleCandidate[],
): MechanismConnectionHoleCandidate[] => candidates.flatMap((candidate) => {
  const coordinate = candidateCoordinate(
    candidate.role,
    state,
    candidate.frameProjection,
  );
  return coordinate ? [{ ...candidate, coordinate }] : [];
});

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

export const normalizeAuthoredMechanismToFabricationSet = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConfig => {
  const fabricated = normalizeMechanismToFabricationSet(mechanism);
  if (
    mechanism.connectionSelections === undefined
    && mechanism.connectionSelectionValidation === undefined
    && mechanism.rejectedConnectionSelectionDiagnostics === undefined
  ) {
    return fabricated;
  }
  const connectionState = normalizeMechanismConnectionSelections(
    fabricated,
    mechanism.connectionSelections,
    mechanism.connectionSelectionValidation,
    { kit },
  );
  return {
    ...fabricated,
    ...mechanismConnectionCompatibilityUpdates(fabricated, connectionState),
    ...connectionState,
  };
};

/**
 * Normalizes a mechanism and materializes the deterministic physical
 * selections used by an exact fabrication combination. Legacy normalization
 * intentionally leaves absent selections absent; resolver callers need the
 * complete catalog-backed state instead.
 */
export const normalizeMechanismWithFabricationSelections = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismConfig => {
  const fabricated = normalizeMechanismToFabricationSet(mechanism);
  const rawRoles = new Set(Object.keys(mechanism.connectionSelections ?? {}));
  const priorValidation = mechanism.connectionSelectionValidation
    ? {
        ...mechanism.connectionSelectionValidation,
        entries: mechanism.connectionSelectionValidation.entries.filter(
          (entry) => !(entry.status === 'defaulted' && rawRoles.has(entry.role)),
        ),
      }
    : undefined;
  const initialState = normalizeMechanismConnectionSelections(
    fabricated,
    mechanism.connectionSelections,
    priorValidation,
    { kit },
  );
  if (
    initialState.connectionSelectionValidation?.status === 'invalid'
    || !initialState.connectionSelections
  ) {
    return {
      ...fabricated,
      ...mechanismConnectionCompatibilityUpdates(fabricated, initialState),
      ...initialState,
    };
  }
  // Defaults are useful compatibility evidence, but they are not a license to
  // skip catalog validation. Revalidate the complete persisted set without the
  // legacy provenance so an off-board default mount cannot become buildable.
  const connectionState = normalizeMechanismConnectionSelections(
    { ...fabricated, rejectedConnectionSelectionDiagnostics: undefined },
    initialState.connectionSelections,
    undefined,
    { kit },
  );
  return {
    ...fabricated,
    ...mechanismConnectionCompatibilityUpdates(fabricated, connectionState),
    ...connectionState,
  };
};

export type RejectedConnectionSelectionAttempt = Readonly<{
  role: ConnectionSelectionRole | 'unknown';
  reason: RejectedConnectionSelectionReason;
  diagnostic: RejectedConnectionSelectionDiagnostic;
}>;

/**
 * A rejected pointer candidate is feedback, not project state. Keeping this
 * property non-enumerable lets existing `{ ...authorMechanismConnectionSelection(...) }`
 * callers retain the exact prior mechanism while still exposing bounded detail
 * to a direct authoring surface.
 */
export type ConnectionSelectionAuthoringResult = Partial<MechanismConfig> & {
  readonly rejection?: RejectedConnectionSelectionAttempt;
};

const rejectedAuthoringResult = (
  role: string,
  selection: unknown,
  reason: RejectedConnectionSelectionReason,
): ConnectionSelectionAuthoringResult => {
  const result: ConnectionSelectionAuthoringResult = {};
  Object.defineProperty(result, 'rejection', {
    value: Object.freeze({
      role: roleSet.has(role) ? role as ConnectionSelectionRole : 'unknown',
      reason,
      diagnostic: Object.freeze(diagnosticFor(2, role, selection, reason)),
    }),
    enumerable: false,
  });
  return result;
};

export const authorMechanismConnectionSelection = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ConnectionSelectionAuthoringResult => {
  if (!roleSet.has(role)) return rejectedAuthoringResult(String(role), selection, 'invalid-role');
  const candidate = validateSelection(mechanism, role, selection, kit);
  if (!candidate.selection) {
    return rejectedAuthoringResult(role, selection, candidate.reason ?? 'invalid-selection-shape');
  }
  const current = resolvedSelectionState(mechanism, kit);
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
    { kit },
  );
  const acceptedSelection = normalized.connectionSelections?.[role];
  const accepted = acceptedSelection
    && sameSelection(acceptedSelection, candidate.selection)
    && normalized.connectionSelectionValidation?.entries.some(
      (entry) => entry.role === role && entry.status === 'accepted',
    );
  if (!accepted) return rejectedAuthoringResult(role, selection, 'incompatible-selection');
  return {
    ...mechanismConnectionCompatibilityUpdates(mechanism, normalized),
    connectionSelections: normalized.connectionSelections,
    connectionSelectionValidation: normalized.connectionSelectionValidation,
    rejectedConnectionSelectionDiagnostics: normalized.rejectedConnectionSelectionDiagnostics,
  };
};

export const connectionSelectionSummary = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ConnectionSelectionSummary | undefined => {
  const resolved = resolveMechanismPhysicalConnections(mechanism, kit);
  return resolved.validation
    ? {
        connectionSelections: resolved.selections,
        connectionSelectionValidation: resolved.validation,
        physicalConnections: resolved.connections,
        physicalConnectionSignature: physicalConnectionSignature(resolved.connections),
      }
    : undefined;
};

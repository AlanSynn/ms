import type {
  ConnectionSelection,
  ConnectionSelectionRole,
  FabricationBoardMountKey,
  MechanismConfig,
  MechanismType,
  PhysicalKitSettings,
  Point,
} from '../types';
import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_MODULE_SPECS,
  fabricationGearSpecForPitchRadius,
} from './fabricationContract';
import {
  boardCoordinateLabel,
  defaultPhysicalKit,
  SCENE_PX_PER_MM,
  sceneToBoardRaw,
} from './coordinates';

const FOUR_BAR_CONNECTION_ROLES = [
  '4bar.input-joint',
  '4bar.output-joint',
] as const satisfies readonly ConnectionSelectionRole[];

const GEAR_LINKAGE_CONNECTION_ROLES = [
  'gear_linkage.drive-pin',
  'gear_linkage.output-pin',
] as const satisfies readonly ConnectionSelectionRole[];

const GEAR_CONNECTION_ROLES = [
  'gear.drive-pin',
  'gear.output-pin',
] as const satisfies readonly ConnectionSelectionRole[];

const PLANETARY_CONNECTION_ROLES = [
  'planetary_gear.carrier-planet-pivot',
  'planetary_gear.carrier-output-hole',
] as const satisfies readonly ConnectionSelectionRole[];

const CAM_CONNECTION_ROLES = [
  'cam.guide-mount',
  'cam.follower-output-hole',
] as const satisfies readonly ConnectionSelectionRole[];

const PISTON_CONNECTION_ROLES = [
  'piston.crank-pin',
  'piston.rod-slider-pin',
  'piston.guide-mount',
] as const satisfies readonly ConnectionSelectionRole[];

export const CONNECTION_SELECTION_ROLES = [
  ...FOUR_BAR_CONNECTION_ROLES,
  ...GEAR_LINKAGE_CONNECTION_ROLES,
  ...GEAR_CONNECTION_ROLES,
  ...PLANETARY_CONNECTION_ROLES,
  ...CAM_CONNECTION_ROLES,
  ...PISTON_CONNECTION_ROLES,
] as const satisfies readonly ConnectionSelectionRole[];

/**
 * One persisted source matrix. Resolver/compiler work may consume this without
 * stage-private role guesses. `sourceNode` is the concrete graph node id (or
 * a gear-index template) that owns the physical asset.
 */
export const CONNECTION_SELECTION_ROLE_POLICIES = {
  '4bar.input-joint': { mechanismType: '4bar', kind: 'linkage-hole', sourceNode: 'input-link', partKey: 'linkages:linkage-2-cell' },
  '4bar.output-joint': { mechanismType: '4bar', kind: 'linkage-hole', sourceNode: 'output-link', partKey: 'linkages:linkage-2-cell' },
  'gear_linkage.drive-pin': { mechanismType: 'gear_linkage', kind: 'gear-attachment-hole', sourceNode: 'gear[0]', partKey: 'gears:g24' },
  'gear_linkage.output-pin': { mechanismType: 'gear_linkage', kind: 'gear-attachment-hole', sourceNode: 'gear[last]', partKey: 'gears:g24' },
  'gear.drive-pin': { mechanismType: 'gear', kind: 'gear-attachment-hole', sourceNode: 'gear[0]', partKey: 'gears:g24' },
  'gear.output-pin': { mechanismType: 'gear', kind: 'gear-attachment-hole', sourceNode: 'gear[last]', partKey: 'gears:g24' },
  'planetary_gear.carrier-planet-pivot': { mechanismType: 'planetary_gear', kind: 'linkage-hole', sourceNode: 'carrier', partKey: 'linkages:linkage-4-cell' },
  'planetary_gear.carrier-output-hole': { mechanismType: 'planetary_gear', kind: 'linkage-hole', sourceNode: 'carrier', partKey: 'linkages:linkage-4-cell' },
  'cam.guide-mount': { mechanismType: 'cam', kind: 'board-mount-pattern', sourceNode: 'follower-guide', partKey: 'cam_modules:u-channel-guide-cartridge' },
  'cam.follower-output-hole': { mechanismType: 'cam', kind: 'module-hole', sourceNode: 'follower-head', partKey: 'cam_modules:gravity-follower-module-v2' },
  'piston.crank-pin': { mechanismType: 'piston', kind: 'linkage-hole', sourceNode: 'crank-link', partKey: 'linkages:linkage-2-cell' },
  'piston.rod-slider-pin': { mechanismType: 'piston', kind: 'linkage-hole', sourceNode: 'connecting-rod', partKey: 'linkages:linkage-6-cell' },
  'piston.guide-mount': { mechanismType: 'piston', kind: 'board-mount-pattern', sourceNode: 'guide', partKey: 'brackets:3-hole-straight' },
} as const satisfies Record<ConnectionSelectionRole, {
  mechanismType: MechanismType;
  kind: ConnectionSelection['kind'];
  sourceNode: string;
  partKey: string;
}>;

const MECHANISM_TYPE_CONNECTION_ROLES = {
  crank: [] as const,
  '4bar': FOUR_BAR_CONNECTION_ROLES,
  piston: PISTON_CONNECTION_ROLES,
  yoke: [] as const,
  'quick-return': [] as const,
  '5bar': [] as const,
  '6bar': [] as const,
  cam: CAM_CONNECTION_ROLES,
  'rack-pinion': [] as const,
  gear: GEAR_CONNECTION_ROLES,
  gear_linkage: GEAR_LINKAGE_CONNECTION_ROLES,
  planetary_gear: PLANETARY_CONNECTION_ROLES,
} satisfies Record<MechanismType, readonly ConnectionSelectionRole[]>;

export const connectionSelectionRolesForMechanism = (type: MechanismType): readonly ConnectionSelectionRole[] =>
  MECHANISM_TYPE_CONNECTION_ROLES[type];

export const connectionSelectionSignature = (
  selections: MechanismConfig['connectionSelections'],
): string =>
  CONNECTION_SELECTION_ROLES.flatMap((role) => {
    const selection = selections?.[role];
    if (!selection) return [];
    switch (selection.kind) {
      case 'linkage-hole':
        return `${role}:${selection.linkageKey}:${selection.holeIndex}`;
      case 'gear-attachment-hole':
        return `${role}:${selection.gearKey}:${selection.gearIndex}:${selection.holeIndex}`;
      case 'board-mount-pattern':
        return `${role}:${selection.mountKey}:${selection.boardHoleIds.join(',')}`;
      case 'module-hole':
        return `${role}:${selection.moduleKey}:${selection.holeId}`;
    }
  }).join('|');

/** Stable candidate identity: persisted physical choice, never a screen point. */
export const connectionSelectionIdentity = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
) => connectionSelectionSignature({ [role]: selection });

/** Resolves policy aliases such as gear[last] to the concrete derived graph node. */
export const connectionSelectionSourceNodeId = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
) => {
  const sourceNode = CONNECTION_SELECTION_ROLE_POLICIES[role].sourceNode;
  if ((sourceNode === 'gear[0]' || sourceNode === 'gear[last]') && selection.kind === 'gear-attachment-hole') {
    return `gear-${selection.gearIndex}`;
  }
  return sourceNode;
};

/** The printable asset is selected from the same persisted choice as the graph node. */
export const connectionSelectionPartKey = (
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
) => {
  if (selection.kind === 'linkage-hole') return `linkages:${selection.linkageKey}`;
  if (selection.kind === 'gear-attachment-hole') return `gears:${selection.gearKey}`;
  if (selection.kind === 'module-hole') {
    return FABRICATION_MODULE_SPECS.find((spec) => spec.key === selection.moduleKey)?.partKey
      ?? CONNECTION_SELECTION_ROLE_POLICIES[role].partKey;
  }
  return CONNECTION_SELECTION_ROLE_POLICIES[role].partKey;
};

const linkageRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES['4bar']);
const gearLinkageRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES.gear_linkage);
const gearRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES.gear);
const planetaryRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES.planetary_gear);
const camRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES.cam);
const pistonRoles = new Set<ConnectionSelectionRole>(MECHANISM_TYPE_CONNECTION_ROLES.piston);

export const linkageSpec = (key: unknown) =>
  typeof key === 'string' ? FABRICATION_LINKAGE_SPECS.find((spec) => spec.key === key) : undefined;

export const gearSpec = (key: unknown) =>
  typeof key === 'string' ? FABRICATION_GEAR_SPECS.find((spec) => spec.key === key) : undefined;

export const finiteIndex = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;

export const expectedGearIndex = (role: ConnectionSelectionRole, mechanism: MechanismConfig) =>
  role === 'gear_linkage.drive-pin' || role === 'gear.drive-pin'
    ? 0
    : Math.max(0, (mechanism.gearTrainRadii?.length ?? 2) - 1);

export const expectedGearSpec = (role: ConnectionSelectionRole, mechanism: MechanismConfig) => {
  const index = expectedGearIndex(role, mechanism);
  const radius = mechanism.gearTrainRadii?.[index]
    ?? (role === 'gear_linkage.drive-pin' || role === 'gear.drive-pin'
      ? mechanism.crankLength
      : mechanism.rockerLength);
  return fabricationGearSpecForPitchRadius(Math.abs(radius ?? 0) / SCENE_PX_PER_MM);
};

export const mechanismWithConnectionSelectionFamily = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  selection: ConnectionSelection,
) => {
  if (selection.kind !== 'gear-attachment-hole') return mechanism;
  const spec = gearSpec(selection.gearKey);
  if (!spec) return mechanism;
  const radii = mechanism.gearTrainRadii?.length
    ? [...mechanism.gearTrainRadii]
    : [mechanism.crankLength, mechanism.rockerLength];
  const index = expectedGearIndex(role, mechanism);
  if (index < 0 || index >= radii.length) return mechanism;
  radii[index] = spec.pitchRadiusMm * SCENE_PX_PER_MM;
  return {
    ...mechanism,
    crankLength: radii[0],
    rockerLength: radii.at(-1) ?? radii[0],
    gearTrainRadii: radii,
  };
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

const defaultBoardMountSelection = (
  mechanism: MechanismConfig,
  mountKey: FabricationBoardMountKey,
  offsets: readonly Point[],
  kit: PhysicalKitSettings,
): ConnectionSelection | undefined => {
  const anchor = sceneToBoardRaw({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, kit);
  const holes = offsets.map(({ x, y }) => ({ col: anchor.col + x, row: anchor.row + y }));
  // Keep translated defaults intact at the board edge so the canonical
  // physical envelope can report the precise fit blocker. Explicit authored
  // selections are still validated against real board holes below.
  if (!anchor.valid) return undefined;
  return {
    kind: 'board-mount-pattern',
    mountKey,
    boardHoleIds: holes.map(({ col, row }) => boardCoordinateLabel(col, row)),
  };
};

export const defaultSelectionForRole = (
  mechanism: MechanismConfig,
  role: ConnectionSelectionRole,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): ConnectionSelection | undefined => {
  if (mechanism.type === '4bar' && linkageRoles.has(role)) return defaultLinkageSelection(mechanism, role);
  if (mechanism.type === 'gear_linkage' && gearLinkageRoles.has(role)) return defaultGearSelection(mechanism, role);
  if (mechanism.type === 'gear' && gearRoles.has(role)) return defaultGearSelection(mechanism, role);
  if (mechanism.type === 'planetary_gear' && planetaryRoles.has(role)) {
    return role === 'planetary_gear.carrier-planet-pivot'
      ? { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 2 }
      : { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 1 };
  }
  if (mechanism.type === 'cam' && camRoles.has(role)) {
    if (role === 'cam.guide-mount') return defaultCamGuideMountSelection(mechanism, kit);
    return { kind: 'module-hole', moduleKey: 'gravity-follower-module-v2', holeId: 'output-0' };
  }
  if (mechanism.type === 'piston' && pistonRoles.has(role)) {
    if (role === 'piston.crank-pin') return { kind: 'linkage-hole', linkageKey: 'linkage-2-cell', holeIndex: 1 };
    if (role === 'piston.rod-slider-pin') {
      const spec = linkageSpec('linkage-6-cell');
      if (!spec) return undefined;
      const target = Math.abs(mechanism.rodLength ?? mechanism.couplerLength);
      const holeIndex = spec.holeCentersMm.reduce((best, hole, index) => {
        if (index === 0) return best;
        const distance = Math.hypot(
          hole.x - spec.holeCentersMm[0].x,
          hole.y - spec.holeCentersMm[0].y,
        ) * SCENE_PX_PER_MM;
        return Math.abs(distance - target) < best.error
          ? { index, error: Math.abs(distance - target) }
          : best;
      }, { index: 1, error: Number.POSITIVE_INFINITY }).index;
      return { kind: 'linkage-hole', linkageKey: 'linkage-6-cell', holeIndex };
    }
    return defaultBoardMountSelection(
      mechanism,
      'piston-guide-3-hole',
      [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }],
      kit,
    );
  }
  return undefined;
};

const defaultCamGuideMountSelection = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
): ConnectionSelection | undefined => defaultBoardMountSelection(
  mechanism,
  'cam-guide-2-hole',
  [{ x: 5, y: 2 }, { x: 5, y: 0 }],
  kit,
);

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

const defaultGearSelection = (mechanism: MechanismConfig, role: ConnectionSelectionRole): ConnectionSelection | undefined => {
  const spec = expectedGearSpec(role, mechanism);
  // A gear with no real attachment hole (for example the G1 sun/output)
  // must remain unselected. Inventing hole zero would turn an otherwise valid
  // legacy mechanism into an invalid persisted selection on reload.
  if (spec.attachmentHoleCentersMm.length === 0) return undefined;
  const legacyOffset = Number.isFinite(mechanism.couplerPointDist) ? mechanism.couplerPointDist : 0;
  return {
    kind: 'gear-attachment-hole',
    gearKey: spec.key,
    gearIndex: expectedGearIndex(role, mechanism),
    holeIndex: nearestGearAttachmentHoleIndex(spec, legacyOffset),
  };
};

export const defaultSelections = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
): Partial<Record<ConnectionSelectionRole, ConnectionSelection>> => {
  return Object.fromEntries(
    connectionSelectionRolesForMechanism(mechanism.type).map((role) => [role, defaultSelectionForRole(mechanism, role, kit)]).filter(([, selection]) => selection) as [
      ConnectionSelectionRole,
      ConnectionSelection,
    ][],
  );
};

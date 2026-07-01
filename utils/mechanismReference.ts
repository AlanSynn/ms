import type { MechanismConfig, MechanismType } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { FABRICATION_GEAR_SPECS, FABRICATION_LINKAGE_SPECS, FABRICATION_SPACER_SPEC, type FabricationGearSpec, type FabricationLinkageSpec } from './fabricationContract';

export type ReferenceSupport = 'fabrication-ready' | 'simulation-only' | 'unsupported';

export type ReferenceCanonicalKey =
    | 'four_bar'
    | 'gear_train'
    | 'gear_linkage'
    | 'cam_follower'
    | 'planetary_gear'
    | 'slider_crank'
    | 'five_bar'
    | 'six_bar'
    | 'unsupported'
    | 'driver';

export type ReferencePartRequirement = {
    name: string;
    label: string;
    quantity: number;
    count: number;
    part: string;
    category: string;
    key: string;
};

export type ReferenceAssemblyStackItem = {
    order: number;
    label: string;
    role: string;
    part?: string;
};

export type ReferenceAssemblyStep = {
    index: number;
    label: string;
    title: string;
    action: string;
    role: string;
    boardCoordinate: string;
    zMm: number;
    coords: string[];
    coordRoles: string[];
    instruction: string;
    check?: string;
    stack: ReferenceAssemblyStackItem[];
};

export type ReferenceMechanismRecipe = {
    appType: MechanismType;
    canonicalKey: ReferenceCanonicalKey;
    title: string;
    physicsRule: string;
    foundryVisible: boolean;
    exportReady: boolean;
    support: ReferenceSupport;
    recipeId?: string;
    guideSvg?: string;
    reason?: string;
    requiredParts: ReferencePartRequirement[];
    stackLabels: string[];
    assemblySteps: ReferenceAssemblyStep[];
};

export const mmToScene = (mm: number) => mm * SCENE_PX_PER_MM;

export const REFERENCE_DEFAULTS = {
    pitchMm: 20,
    holeMm: 4,
    spacerPart: FABRICATION_SPACER_SPEC.label,
    fourBar: {
        ground: mmToScene(80),
        input: mmToScene(40),
        coupler: mmToScene(80),
        output: mmToScene(40)
    },
    gearTrain: {
        driveRadius: mmToScene(30),
        outputRadius: mmToScene(30),
        centerDistance: mmToScene(60)
    },
    gearLinkage: {
        driveRadius: mmToScene(30),
        outputRadius: mmToScene(30),
        centerDistance: mmToScene(60),
        handleRadius: mmToScene(20),
        outputLinkage: mmToScene(80)
    },
    planetary: {
        sunRadius: mmToScene(10),
        planetRadius: mmToScene(30),
        carrierRadius: mmToScene(40),
        ringPitchRadius: mmToScene(70),
        planetCount: 1
    },
    cam: {
        radius: mmToScene(15),
        followerTravel: mmToScene(160)
    },
    sliderCrank: {
        crank: mmToScene(40),
        rod: mmToScene(120),
        guideOffset: 0
    }
} as const;


export const REFERENCE_PART_HOLE_COUNTS: Record<string, number> = {
    'gears:g24': 5, // G3: axle + four 20 mm handle/linkage holes in fabrication/gears/gear-24t.svg
    'gears:g8': 1, // G1: axle-only sun gear in fabrication/gears/gear-8t.svg
    'ring_gears:ring-g8-g24': 4, // R56 ring mount holes in fabrication/ring_gears/ring-g8-g24.svg
    'linkages:linkage-2-cell': 3,
    'linkages:linkage-4-cell': 5,
    'linkages:linkage-6-cell': 7,
    'brackets:2-hole-straight': 2,
    'brackets:3-hole-straight': 3,
    'cams:eccentric': 5,
    'followers:f3-round': 1,
    'spacers:s10': 0
};

export const referencePartHoleCount = (partRequirement: Pick<ReferencePartRequirement, 'part' | 'key' | 'label' | 'name'>) =>
    REFERENCE_PART_HOLE_COUNTS[partRequirement.part]
    ?? REFERENCE_PART_HOLE_COUNTS[partRequirement.key]
    ?? REFERENCE_PART_HOLE_COUNTS[partRequirement.label]
    ?? REFERENCE_PART_HOLE_COUNTS[partRequirement.name]
    ?? 0;

export const referenceRequiredPartsHoleCount = (parts: Array<Pick<ReferencePartRequirement, 'part' | 'key' | 'label' | 'name' | 'quantity'>>) =>
    parts.reduce((sum, partRequirement) => sum + referencePartHoleCount(partRequirement) * Math.max(0, partRequirement.quantity), 0);

export const isBoardFixedCoordRole = (role: string) => role === 'board' || role === 'board_axle';

const COORD_ROLE_LABELS: Record<string, string> = {
    board: 'Board',
    board_axle: 'Board axle',
    link_end_reference: 'link end reference',
    link_joint_reference: 'link joint reference',
    gear_handle_reference: 'gear handle reference',
    carrier_reference: 'carrier reference',
    slider_reference: 'slider reference',
    moving_reference: 'moving reference'
};

export const readableCoordRole = (role: string) =>
    COORD_ROLE_LABELS[role] ?? role.replace(/_/g, ' ');

export const referenceStepCoordinateCallout = (step: Pick<ReferenceAssemblyStep, 'boardCoordinate'> & Partial<Pick<ReferenceAssemblyStep, 'coords' | 'coordRoles'>>) => {
    const coords = step.coords ?? [];
    const roles = step.coordRoles ?? [];
    const fixedIndex = roles.findIndex(isBoardFixedCoordRole);
    if (fixedIndex >= 0) return `Board ${coords[fixedIndex] ?? step.boardCoordinate}`;
    const coord = coords[0] ?? step.boardCoordinate;
    const role = roles[0] ?? 'moving_reference';
    return `${readableCoordRole(role)} ${coord}`;
};

export const referenceRequiredPartsForMechanism = (mechanism: Pick<MechanismConfig, 'type'> & Partial<Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'couplerLength' | 'gearTrainRadii'>>) => {
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) return [];
    const parts = recipe.requiredParts.map(partRequirement => ({ ...partRequirement }));
    if (mechanism.type === 'gear') {
        return aggregatePartRequirements([
            ...gearRequirementsForMechanism(normalizeGearTrainToFabrication(mechanism)),
            ...parts.filter(partRequirement => partRequirement.category !== 'gears')
        ]);
    }
    if (mechanism.type === 'gear_linkage') {
        const normalized = normalizeGearLinkageToReference(mechanism);
        const couplerLinkage = linkageRequirementForSceneLength(normalized.couplerLength ?? REFERENCE_DEFAULTS.gearLinkage.outputLinkage);
        return aggregatePartRequirements([
            ...gearRequirementsForMechanism(normalized),
            { ...couplerLinkage, quantity: couplerLinkage.quantity * 2, count: couplerLinkage.quantity * 2 },
            ...parts.filter(partRequirement => partRequirement.category !== 'gears' && partRequirement.category !== 'linkages')
        ]);
    }
    return parts;
};

const part = (partId: string, category: string, key: string, label: string, quantity: number): ReferencePartRequirement => ({
    name: label,
    label,
    quantity,
    count: quantity,
    part: partId,
    category,
    key
});

const sceneToMm = (scene: number) => Math.abs(scene) / SCENE_PX_PER_MM;
const sceneGearRadiusForSpec = (spec: FabricationGearSpec) => mmToScene(spec.pitchRadiusMm);
const sceneLinkageLengthForSpec = (spec: FabricationLinkageSpec) => mmToScene(spec.lengthMm);

const attachmentGearSpecs = FABRICATION_GEAR_SPECS.filter(spec => spec.attachmentHoleCentersMm.length > 0);

export const fabricationGearSpecForSceneRadius = (sceneRadius: number, candidates: readonly FabricationGearSpec[] = FABRICATION_GEAR_SPECS) => {
    const radiusMm = sceneToMm(sceneRadius);
    const pool = candidates.length ? candidates : FABRICATION_GEAR_SPECS;
    return pool.reduce((best, spec) =>
        Math.abs(spec.pitchRadiusMm - radiusMm) < Math.abs(best.pitchRadiusMm - radiusMm) ? spec : best
    );
};

export const fabricationLinkageSpecForSceneLength = (sceneLength: number) => {
    const lengthMm = sceneToMm(sceneLength);
    return FABRICATION_LINKAGE_SPECS.reduce((best, spec) =>
        Math.abs(spec.lengthMm - lengthMm) < Math.abs(best.lengthMm - lengthMm) ? spec : best
    );
};

const normalizeGearTrainRadii = (
    mechanism: Partial<MechanismConfig>,
    fallbackDrive: number,
    fallbackOutput: number,
    options?: { outputNeedsAttachment?: boolean; endpointsNeedAttachment?: boolean }
) => {
    const raw = Array.isArray(mechanism.gearTrainRadii) && mechanism.gearTrainRadii.length >= 2
        ? mechanism.gearTrainRadii
        : [mechanism.crankLength ?? fallbackDrive, mechanism.rockerLength ?? fallbackOutput];
    const limited = raw.filter(value => Number.isFinite(value)).slice(0, 8);
    const source = limited.length >= 2 ? limited : [fallbackDrive, fallbackOutput];
    const snapped = source.map((radius, index) => {
        const isOutput = index === source.length - 1;
        const needsAttachment = (options?.endpointsNeedAttachment && (index === 0 || isOutput)) || (options?.outputNeedsAttachment && isOutput);
        const candidates = needsAttachment ? attachmentGearSpecs : FABRICATION_GEAR_SPECS;
        return sceneGearRadiusForSpec(fabricationGearSpecForSceneRadius(radius, candidates));
    });
    return snapped.length >= 2 ? snapped : [fallbackDrive, fallbackOutput];
};

const pitchDistanceForRadii = (radii: number[]) => radii.slice(1).reduce((sum, radius, index) => sum + radii[index] + radius, 0);
const outputRatioForRadii = (radii: number[]) => {
    const meshCount = Math.max(1, radii.length - 1);
    const sign = meshCount % 2 === 1 ? -1 : 1;
    return sign * (radii[0] / Math.max(1, radii.at(-1) ?? radii[0]));
};

const attachmentOffsetsMmForSceneGear = (sceneRadius: number) =>
    fabricationGearSpecForSceneRadius(sceneRadius, attachmentGearSpecs)
        .attachmentHoleCentersMm
        .map(point => Math.hypot(point.x, point.y))
        .filter(radius => radius > 0);

const nearestSharedAttachmentRadiusForScene = (driveGearRadius: number, outputGearRadius: number, requested: number) => {
    const requestedMm = sceneToMm(requested || REFERENCE_DEFAULTS.gearLinkage.handleRadius);
    const driveOffsets = attachmentOffsetsMmForSceneGear(driveGearRadius);
    const outputOffsets = attachmentOffsetsMmForSceneGear(outputGearRadius);
    const sharedOffsets = driveOffsets.filter(driveOffset =>
        outputOffsets.some(outputOffset => Math.abs(outputOffset - driveOffset) < 0.01)
    );
    const candidates = sharedOffsets.length ? sharedOffsets : outputOffsets.length ? outputOffsets : driveOffsets;
    const bestMm = candidates.length
        ? candidates.reduce((best, radius) => Math.abs(radius - requestedMm) < Math.abs(best - requestedMm) ? radius : best)
        : sceneToMm(REFERENCE_DEFAULTS.gearLinkage.handleRadius);
    return mmToScene(bestMm);
};

export const normalizeGearTrainToFabrication = <T extends Partial<MechanismConfig>>(mechanism: T): T => {
    const radii = normalizeGearTrainRadii(mechanism, REFERENCE_DEFAULTS.gearTrain.driveRadius, REFERENCE_DEFAULTS.gearTrain.outputRadius);
    const ratio = outputRatioForRadii(radii);
    return {
        ...mechanism,
        crankLength: radii[0],
        rockerLength: radii.at(-1) ?? radii[0],
        groundLength: pitchDistanceForRadii(radii),
        gearTrainRadii: radii,
        gearRatio: ratio,
        speed2: ratio,
        couplerPointDist: mechanism.couplerPointDist ?? 0
    };
};

const gearRequirementForSceneRadius = (sceneRadius: number, quantity = 1) => {
    const spec = fabricationGearSpecForSceneRadius(sceneRadius);
    return part(`gears:${spec.key}`, 'gears', spec.key, spec.label, quantity);
};

const gearRequirementsForMechanism = (mechanism: Partial<MechanismConfig>) =>
    normalizeGearTrainRadii(mechanism, REFERENCE_DEFAULTS.gearTrain.driveRadius, REFERENCE_DEFAULTS.gearTrain.outputRadius, { endpointsNeedAttachment: mechanism.type === 'gear_linkage' })
        .map(radius => gearRequirementForSceneRadius(radius));

const linkageRequirementForSceneLength = (sceneLength: number) => {
    const spec = fabricationLinkageSpecForSceneLength(sceneLength);
    return part(`linkages:${spec.key}`, 'linkages', spec.key, `L${spec.cells} linkage`, 1);
};

const aggregatePartRequirements = (parts: ReferencePartRequirement[]) => {
    const map = new Map<string, ReferencePartRequirement>();
    parts.forEach(item => {
        const current = map.get(item.part);
        if (current) {
            current.quantity += item.quantity;
            current.count = current.quantity;
        } else {
            map.set(item.part, { ...item });
        }
    });
    return [...map.values()];
};

const G3 = (quantity: number) => part('gears:g24', 'gears', 'g24', 'G3 / 3-space gear', quantity);
const G1 = () => part('gears:g8', 'gears', 'g8', 'G1 / 1-space gear', 1);
const R56 = () => part('ring_gears:ring-g8-g24', 'ring_gears', 'ring-g8-g24', 'R56 internal ring gear', 1);
const S10 = part('spacers:s10', 'spacers', 's10', FABRICATION_SPACER_SPEC.label, 8);
const L2 = (quantity: number) => part('linkages:linkage-2-cell', 'linkages', 'linkage-2-cell', 'L2 linkage', quantity);
const L4 = (quantity = 1) => part('linkages:linkage-4-cell', 'linkages', 'linkage-4-cell', 'L4 linkage', quantity);
const L6 = () => part('linkages:linkage-6-cell', 'linkages', 'linkage-6-cell', 'L6 linkage', 1);
const BR2 = () => part('brackets:2-hole-straight', 'brackets', '2-hole-straight', '2-hole bracket', 1);
const BR3 = () => part('brackets:3-hole-straight', 'brackets', '3-hole-straight', '3-hole bracket', 1);
const CAM = () => part('cams:eccentric', 'cams', 'eccentric', 'Eccentric cam', 1);
const F3 = () => part('followers:f3-round', 'followers', 'f3-round', 'Round follower', 1);

const stack = (items: Array<Omit<ReferenceAssemblyStackItem, 'order'>>): ReferenceAssemblyStackItem[] =>
    items.map((item, index) => ({ ...item, order: index + 1 }));

const bareFastener = (coord: string) => stack([
    { label: `Board hole ${coord}`, role: 'board' },
    { label: 'Paper fastener', role: 'paper-fastener' },
    { label: 'Open tabs behind board', role: 'fastener-tabs' }
]);

const movingPartStack = (coordLabel: string, label: string, partId: string, startRole = 'board') => startRole === 'board'
    ? stack([
        { label: coordLabel, role: startRole },
        { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
        { label, role: 'moving-part', part: partId },
        { label: 'Paper fastener head', role: 'paper-fastener' },
        { label: 'Open tabs behind board', role: 'fastener-tabs' }
    ])
    : startRole === 'gear-handle-hole'
        ? stack([
            { label: coordLabel, role: startRole },
            { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
            { label, role: 'moving-part', part: partId },
            { label: FABRICATION_SPACER_SPEC.label, role: 'top-spacer', part: 'spacers:s10' },
            { label: 'Paper fastener through gear handle hole', role: 'paper-fastener' },
            { label: 'Open tabs loosely', role: 'fastener-tabs' }
        ])
        : stack([
            { label: coordLabel, role: startRole },
            { label: 'Paper fastener', role: 'paper-fastener' },
            { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
            { label, role: 'moving-part', part: partId },
            { label: FABRICATION_SPACER_SPEC.label, role: 'top-spacer', part: 'spacers:s10' },
            { label: 'Open tabs loosely', role: 'fastener-tabs' }
        ]);

const gearLinkageConnectorStack = () => stack([
    { label: 'Shared L4 drive/output end holes', role: 'link-end-hole' },
    { label: 'Drive L4 linkage end', role: 'moving-part', part: 'linkages:linkage-4-cell' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
    { label: 'Output L4 linkage end', role: 'moving-part', part: 'linkages:linkage-4-cell' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'top-spacer', part: 'spacers:s10' },
    { label: '2-hole bracket', role: 'moving-part', part: 'brackets:2-hole-straight' },
    { label: 'Paper fastener through shared connector', role: 'paper-fastener' },
    { label: 'Open tabs loosely', role: 'fastener-tabs' }
]);

const gearLinkageCrankStack = (coordLabel: string, label: string, partId: string, clearanceSpacerCount: 1 | 2) => stack([
    { label: coordLabel, role: 'gear-handle-hole' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
    ...(clearanceSpacerCount === 2 ? [{ label: `${FABRICATION_SPACER_SPEC.label} riser`, role: 'spacer' as const, part: 'spacers:s10' }] : []),
    { label, role: 'moving-part', part: partId },
    { label: FABRICATION_SPACER_SPEC.label, role: 'top-spacer', part: 'spacers:s10' },
    { label: 'Paper fastener through gear handle hole', role: 'paper-fastener' },
    { label: 'Open tabs loosely', role: 'fastener-tabs' }
]);

const fixedPartStack = (coord: string, label: string, partId: string, repeat?: string) => stack([
    { label: `Board hole ${coord}`, role: 'board' },
    { label: 'Paper fastener', role: 'paper-fastener' },
    { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: 'spacers:s10' },
    { label, role: 'fixed-part', part: partId },
    { label: 'Open tabs behind board', role: 'fastener-tabs' },
    ...(repeat ? [{ label: repeat, role: 'repeat-fastener-sites' }] : [])
]);

const stepBoardCoordinate = (coords: string[], coordRoles: string[]) => {
    const boardIndex = coordRoles.findIndex(isBoardFixedCoordRole);
    return coords[boardIndex >= 0 ? boardIndex : 0] ?? '';
};

const step = (
    index: number,
    title: string,
    action: string,
    coords: string[],
    coordRoles: string[],
    instruction: string,
    check: string,
    stackItems: ReferenceAssemblyStackItem[]
): ReferenceAssemblyStep => ({
    index,
    label: title,
    title,
    action,
    role: action,
    boardCoordinate: stepBoardCoordinate(coords, coordRoles),
    zMm: 0,
    coords,
    coordRoles,
    instruction,
    check,
    stack: stackItems
});

const unsupportedRecipe = (type: MechanismType, canonicalKey: ReferenceCanonicalKey, reason: string): ReferenceMechanismRecipe => ({
    appType: type,
    canonicalKey,
    title: `${type} (not fabrication-ready)`,
    physicsRule: `${type} simulation-only motion`,
    foundryVisible: false,
    exportReady: false,
    support: canonicalKey === 'unsupported' ? 'unsupported' : 'simulation-only',
    reason,
    requiredParts: [],
    stackLabels: [],
    assemblySteps: []
});

const gearTrainSteps: ReferenceAssemblyStep[] = [
    step(1, 'Start at H6', 'place-fastener', ['H6'], ['board'], 'Place a paper fastener at H6.', 'The fastener turns freely.', bareFastener('H6')),
    step(2, 'Add drive G3 gear', 'add-part', ['H6'], ['board'], 'Add one S10 spacer, then place drive G3 on H6.', 'Drive G3 spins without rubbing.', movingPartStack('Board hole H6', 'G3 / 3-space gear', 'gears:g24')),
    step(3, 'Add output G3 gear', 'add-part', ['H9'], ['board'], 'Place output G3 at H9 so it touches drive G3 lightly.', 'Both gears turn when drive G3 turns.', movingPartStack('Board hole H9', 'G3 / 3-space gear', 'gears:g24')),
    step(4, 'Turn the handle hole', 'test-motion', ['H6', 'H9'], ['board', 'board'], 'Use a handle hole on drive G3 and rotate slowly.', 'If the mesh binds, loosen both fasteners.', movingPartStack('Board hole H6', 'G3 / 3-space gear', 'gears:g24'))
];

const camSteps: ReferenceAssemblyStep[] = [
    step(1, 'Mount cam axle', 'place-fastener', ['J7'], ['board'], 'Place a paper fastener at J7.', 'The axle is loose enough to rotate.', bareFastener('J7')),
    step(2, 'Add eccentric cam', 'add-part', ['J7'], ['board'], 'Add S10 spacer, then place the eccentric cam at J7.', 'The cam turns cleanly.', movingPartStack('Board hole J7', 'Eccentric cam', 'cams:eccentric')),
    step(3, 'Add follower guide', 'add-guide', ['G7'], ['board'], 'Pin the follower guide slot at G7 with a loose spacer stack.', 'The follower can slide up and down.', movingPartStack('Board hole G7', 'Round follower', 'followers:f3-round')),
    step(4, 'Check lift', 'test-motion', ['J7', 'G7'], ['board', 'board'], 'Turn the cam and watch the follower rise.', 'Loosen the guide if it sticks.', movingPartStack('Board hole G7', 'Round follower', 'followers:f3-round'))
];

const fourBarSteps: ReferenceAssemblyStep[] = [
    step(1, 'Set ground pivots', 'place-ground', ['I5', 'I9'], ['board', 'board'], 'Pin ground pivots at I5 and I9.', 'Both ground pivots are fixed.', stack([
        { label: 'Board hole I5', role: 'board' },
        { label: 'Paper fastener', role: 'paper-fastener' },
        { label: 'Open tabs behind board', role: 'fastener-tabs' },
        { label: 'Repeat this stack at I5, I9', role: 'repeat-fastener-sites' }
    ])),
    step(2, 'Add input link', 'add-linkage', ['I5', 'G6'], ['board', 'link_end_reference'], 'Place L2 from I5 toward G6 with spacers.', 'The input link swings freely.', movingPartStack('Board hole I5', 'L2 linkage', 'linkages:linkage-2-cell')),
    step(3, 'Add coupler', 'add-linkage', ['G6', 'G10'], ['link_joint_reference', 'link_end_reference'], 'Join L4 to the free input-link hole near G6, then point the other end toward G10.', 'The coupler moves without scraping.', movingPartStack('Moving joint near G6', 'L4 linkage', 'linkages:linkage-4-cell', 'link-joint-hole')),
    step(4, 'Close output link', 'add-linkage', ['G10', 'I9'], ['link_joint_reference', 'board'], 'Place L2 from G10 back to I9.', 'All pivots move when the input link turns.', movingPartStack('Board hole I9', 'L2 linkage', 'linkages:linkage-2-cell')),
    step(5, 'Join output to coupler', 'add-linkage', ['G10'], ['link_joint_reference'], 'Fasten the L4 coupler to the free output-link hole near G10 only (not the board).', 'The G10 joint floats with the links and is not pinned to the board.', movingPartStack('Moving joint near G10', 'L4 linkage', 'linkages:linkage-4-cell', 'link-joint-hole'))
];

const gearLinkageSteps: ReferenceAssemblyStep[] = [
    step(1, 'Mount drive gear', 'place-fastener', ['I6'], ['board'], 'Place the drive gear fastener at I6.', 'The axle is straight.', bareFastener('I6')),
    step(2, 'Add drive G3 gear', 'add-part', ['I6'], ['board'], 'Add S10 spacer, then place drive G3 at I6.', 'Drive G3 rotates freely.', movingPartStack('Board hole I6', 'G3 / 3-space gear', 'gears:g24')),
    step(3, 'Mesh output G3 gear', 'add-part', ['I9'], ['board'], 'Place output G3 at I9 and mesh it with drive G3.', 'The gears move together.', movingPartStack('Board hole I9', 'G3 / 3-space gear', 'gears:g24')),
    step(4, 'Add drive crank link', 'add-linkage', ['I6', 'I12'], ['gear_handle_reference', 'link_end_reference'], 'Fasten L4 through an off-center drive G3 handle hole only (not the board), then point the free end toward I12.', 'The drive linkage rides around the gear center instead of locking to the board.', gearLinkageCrankStack('Drive G3 handle hole near I6', 'L4 linkage', 'linkages:linkage-4-cell', 1)),
    step(5, 'Add output crank link', 'add-linkage', ['I9', 'I12'], ['gear_handle_reference', 'link_end_reference'], 'Fasten a second L4 through an off-center output G3 handle hole only (not the board), then meet the first L4 at I12.', 'Both L4 links meet at one moving output point.', gearLinkageCrankStack('Output G3 handle hole near I9', 'L4 linkage', 'linkages:linkage-4-cell', 2)),
    step(6, 'Join moving connector', 'add-bracket', ['I12'], ['link_end_reference'], 'Fasten the 2-hole bracket through the two free L4 ends near I12 as a moving handle.', 'The bracket follows both link ends with spacer clearance and is not pinned to the board.', gearLinkageConnectorStack())
];

const planetarySteps: ReferenceAssemblyStep[] = [
    step(1, 'Pin the sun axle', 'place-fastener', ['H8'], ['board'], 'Place the sun gear fastener at H8.', 'The center axle is straight and fixed.', bareFastener('H8')),
    step(2, 'Mount R56 internal ring gear', 'add-ring', ['D8', 'H4', 'H12', 'L8'], ['board', 'board', 'board', 'board'], 'Center R56 internal ring gear around H8 and fasten its outer mount holes at D8, H4, H12, and L8.', 'The ring gear is fixed to the board and does not rotate.', fixedPartStack('D8', 'R56 internal ring gear', 'ring_gears:ring-g8-g24', 'Repeat this stack at D8, H4, H12, L8')),
    step(3, 'Add G1 sun gear', 'add-part', ['H8'], ['board'], 'Add S10 spacer, then place G1 on H8.', 'G1 spins cleanly before the carrier is added.', movingPartStack('Board hole H8', 'G1 / 1-space gear', 'gears:g8')),
    step(4, 'Add carrier link', 'add-linkage', ['H8', 'H10'], ['board', 'carrier_reference'], 'Place L2 from H8 toward H10 as the carrier.', 'The carrier swings loosely around the sun axle.', movingPartStack('Board hole H8', 'L2 linkage', 'linkages:linkage-2-cell')),
    step(5, 'Add G3 moving planet gear', 'add-part', ['H10'], ['carrier_reference'], 'Align the free carrier hole near H10, then fasten G3 through the carrier hole only (not the board) so it meshes with both G1 and R56 internal ring gear.', 'The planet axle travels with the carrier and rolls between sun and ring.', movingPartStack('Carrier hole near H10', 'G3 / 3-space gear', 'gears:g24', 'carrier-hole')),
    step(6, 'Rotate the carrier', 'test-motion', ['H8', 'H10'], ['board', 'carrier_reference'], 'Hold the ring fixed and use the carrier end/handle hole to orbit the planet around H8.', 'If the orbit binds, loosen the planet fastener and spacer stack.', movingPartStack('Carrier hole near H10', 'G3 / 3-space gear', 'gears:g24', 'carrier-hole'))
];

const sliderCrankSteps: ReferenceAssemblyStep[] = [
    step(1, 'Pin crank axle', 'place-fastener', ['I5'], ['board'], 'Place the crank axle fastener at I5.', 'The crank axle is fixed to the board.', bareFastener('I5')),
    step(2, 'Add crank link', 'add-linkage', ['I5', 'G6'], ['board', 'link_end_reference'], 'Place L2 on I5 with its free hole near G6.', 'The crank rotates without scraping.', movingPartStack('Board hole I5', 'L2 linkage', 'linkages:linkage-2-cell')),
    step(3, 'Add connecting rod', 'add-linkage', ['G6', 'G12'], ['link_joint_reference', 'slider_reference'], 'Fasten L6 to the crank free hole near G6, then point it toward G12.', 'The rod joint is moving and is not pinned to the board.', movingPartStack('Moving joint near G6', 'L6 linkage', 'linkages:linkage-6-cell', 'link-joint-hole')),
    step(4, 'Fix slider guide', 'add-guide', ['G11', 'G12', 'G13'], ['board', 'board', 'board'], 'Fasten the 3-hole bracket along G11, G12, and G13 as the straight guide.', 'The guide is fixed; only the slider block should move.', fixedPartStack('G11', '3-hole bracket', 'brackets:3-hole-straight', 'Repeat this stack at G11, G12, G13')),
    step(5, 'Add slider block', 'add-bracket', ['G12'], ['slider_reference'], 'Fasten the 2-hole bracket to the free L6 end near G12 only (not the board).', 'The block travels along the guide as the crank turns.', movingPartStack('Link output hole near G12', '2-hole bracket', 'brackets:2-hole-straight', 'link-end-hole')),
    step(6, 'Turn crank and check slide', 'test-motion', ['I5', 'G12'], ['board', 'slider_reference'], 'Rotate the L2 crank slowly; the slider block should move left-right along G11-G13.', 'If it binds, loosen the G6 and G12 moving joints.', movingPartStack('Link output hole near G12', '2-hole bracket', 'brackets:2-hole-straight', 'link-end-hole'))
];

export const REFERENCE_MECHANISM_RECIPES: Record<MechanismType, ReferenceMechanismRecipe> = {
    crank: unsupportedRecipe('crank', 'driver', 'Low-level driver only; choose a physical mechanism recipe for fabrication.'),
    '4bar': {
        appType: '4bar',
        canonicalKey: 'four_bar',
        title: 'Four-bar linkage',
        physicsRule: 'pin reactions + coupler acceleration',
        foundryVisible: true,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'four-bar-basic',
        guideSvg: 'fabrication/assembly/03-four-bar-basic.svg',
        requiredParts: [L2(2), L4(), S10],
        stackLabels: ['Input L2 linkage', 'Coupler L4 linkage', 'Output L2 linkage'],
        assemblySteps: fourBarSteps
    },
    piston: {
        appType: 'piston',
        canonicalKey: 'slider_crank',
        title: 'Slider-crank linkage',
        physicsRule: 'slider thrust + guide normal force',
        foundryVisible: false,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'slider-crank-basic',
        guideSvg: 'fabrication/assembly/06-slider-crank-basic.svg',
        requiredParts: [L2(1), L6(), BR2(), BR3(), S10],
        stackLabels: ['L2 linkage', 'L6 linkage', '3-hole bracket', '2-hole bracket'],
        assemblySteps: sliderCrankSteps
    },
    yoke: unsupportedRecipe('yoke', 'unsupported', 'Scotch yoke needs recipe.'),
    'quick-return': unsupportedRecipe('quick-return', 'unsupported', 'Quick-return needs recipe.'),
    '5bar': unsupportedRecipe('5bar', 'five_bar', 'Five-bar needs recipe.'),
    '6bar': unsupportedRecipe('6bar', 'six_bar', 'Six-bar needs recipe.'),
    cam: {
        appType: 'cam',
        canonicalKey: 'cam_follower',
        title: 'Cam and follower lift',
        physicsRule: 'cam normal force + follower lift velocity',
        foundryVisible: true,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'cam-follower-basic',
        guideSvg: 'fabrication/assembly/02-cam-follower-basic.svg',
        requiredParts: [CAM(), F3(), BR2(), S10],
        stackLabels: ['Eccentric cam', 'Round follower', '2-hole bracket'],
        assemblySteps: camSteps
    },
    'rack-pinion': unsupportedRecipe('rack-pinion', 'unsupported', 'Rack-pinion has no mechanism-reference recipe or kit part contract yet.'),
    gear: {
        appType: 'gear',
        canonicalKey: 'gear_train',
        title: 'Gear train',
        physicsRule: 'gear mesh force + opposite angular velocity',
        foundryVisible: true,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'gear-train-basic',
        guideSvg: 'fabrication/assembly/01-gear-train-basic.svg',
        requiredParts: [G3(2), S10],
        stackLabels: ['Drive G3 / 3-space gear', 'Output G3 / 3-space gear'],
        assemblySteps: gearTrainSteps
    },
    gear_linkage: {
        appType: 'gear_linkage',
        canonicalKey: 'gear_linkage',
        title: 'Gear crank linkage',
        physicsRule: 'gear mesh force + two crank-link circle intersection',
        foundryVisible: true,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'gear-linkage-crank',
        guideSvg: 'fabrication/assembly/04-gear-linkage-crank.svg',
        requiredParts: [G3(2), L4(2), BR2(), S10],
        stackLabels: ['Drive G3 / 3-space gear', 'Output G3 / 3-space gear', 'Drive L4 linkage', 'Output L4 linkage', '2-hole bracket'],
        assemblySteps: gearLinkageSteps
    },
    planetary_gear: {
        appType: 'planetary_gear',
        canonicalKey: 'planetary_gear',
        title: 'Planetary ring gear',
        physicsRule: 'sun/planet mesh force + carrier velocity',
        foundryVisible: true,
        exportReady: true,
        support: 'fabrication-ready',
        recipeId: 'planetary-gear-basic',
        guideSvg: 'fabrication/assembly/05-planetary-gear-basic.svg',
        requiredParts: [R56(), G1(), G3(1), L2(1), S10],
        stackLabels: ['R56 internal ring gear', 'G1 / 1-space gear', 'L2 linkage', 'G3 / 3-space gear'],
        assemblySteps: planetarySteps
    }
};

export const referenceRecipeForType = (type: MechanismType) => REFERENCE_MECHANISM_RECIPES[type];
export const referencePhysicsRuleForType = (type: MechanismType) => referenceRecipeForType(type).physicsRule;
export const isReferenceExportReady = (type: MechanismType) => referenceRecipeForType(type).exportReady;
export const isReferenceFoundryVisible = (type: MechanismType) => referenceRecipeForType(type).foundryVisible;

export const REFERENCE_EXPORT_READY_TYPES = Object.values(REFERENCE_MECHANISM_RECIPES)
    .filter(recipe => recipe.exportReady)
    .map(recipe => recipe.appType) as MechanismType[];

export const REFERENCE_FOUNDRY_TYPES = Object.values(REFERENCE_MECHANISM_RECIPES)
    .filter(recipe => recipe.foundryVisible)
    .map(recipe => recipe.appType) as MechanismType[];

export const REFERENCE_AUTHORABLE_TYPES = REFERENCE_EXPORT_READY_TYPES;

export const referenceSupportWarning = (type: MechanismType) => {
    const recipe = referenceRecipeForType(type);
    return recipe.exportReady ? null : `${type}: ${recipe.reason ?? 'not fabrication-ready under mechanism-reference.'}`;
};

export const normalizeGearLinkageToReference = <T extends Partial<MechanismConfig>>(mechanism: T): T => {
    const radii = normalizeGearTrainRadii(mechanism, REFERENCE_DEFAULTS.gearLinkage.driveRadius, REFERENCE_DEFAULTS.gearLinkage.outputRadius, { endpointsNeedAttachment: true });
    const drive = radii[0] ?? REFERENCE_DEFAULTS.gearLinkage.driveRadius;
    const output = radii.at(-1) ?? REFERENCE_DEFAULTS.gearLinkage.outputRadius;
    const ratio = outputRatioForRadii(radii);
    const linkageSpec = fabricationLinkageSpecForSceneLength(mechanism.couplerLength ?? REFERENCE_DEFAULTS.gearLinkage.outputLinkage);
    return {
        ...mechanism,
        crankLength: radii[0],
        rockerLength: output,
        groundLength: pitchDistanceForRadii(radii),
        couplerPointDist: nearestSharedAttachmentRadiusForScene(drive, output, mechanism.couplerPointDist ?? REFERENCE_DEFAULTS.gearLinkage.handleRadius),
        couplerLength: sceneLinkageLengthForSpec(linkageSpec),
        gearTrainRadii: radii,
        gearRatio: ratio,
        speed2: ratio
    };
};

export const normalizeMechanismToReference = <T extends Partial<MechanismConfig> & Pick<MechanismConfig, 'type'>>(mechanism: T): T => {
    if (mechanism.type === '4bar') {
        return {
            ...mechanism,
            groundLength: REFERENCE_DEFAULTS.fourBar.ground,
            crankLength: REFERENCE_DEFAULTS.fourBar.input,
            couplerLength: REFERENCE_DEFAULTS.fourBar.coupler,
            rockerLength: REFERENCE_DEFAULTS.fourBar.output,
            assemblyMode: mechanism.assemblyMode ?? 'open'
        };
    }
    if (mechanism.type === 'gear') {
        return normalizeGearTrainToFabrication(mechanism);
    }
    if (mechanism.type === 'gear_linkage') {
        return normalizeGearLinkageToReference(mechanism);
    }
    if (mechanism.type === 'planetary_gear') {
        return {
            ...mechanism,
            crankLength: REFERENCE_DEFAULTS.planetary.sunRadius,
            rockerLength: REFERENCE_DEFAULTS.planetary.planetRadius,
            groundLength: REFERENCE_DEFAULTS.planetary.carrierRadius,
            couplerPointDist: REFERENCE_DEFAULTS.planetary.carrierRadius
        };
    }
    if (mechanism.type === 'cam') {
        return {
            ...mechanism,
            groundAngle: 90,
            groundLength: 0,
            crankLength: REFERENCE_DEFAULTS.cam.radius,
            rockerLength: REFERENCE_DEFAULTS.cam.followerTravel,
            couplerLength: 0
        };
    }
    if (mechanism.type === 'piston') {
        return {
            ...mechanism,
            groundAngle: 0,
            groundLength: 0,
            crankLength: REFERENCE_DEFAULTS.sliderCrank.crank,
            couplerLength: REFERENCE_DEFAULTS.sliderCrank.rod,
            rockerLength: 0,
            sliderOffset: REFERENCE_DEFAULTS.sliderCrank.guideOffset,
            rodLength: REFERENCE_DEFAULTS.sliderCrank.rod
        };
    }
    return mechanism;
};

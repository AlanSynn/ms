import type { JointState, MechanismConfig, MechanismType, Point } from '../types';
import { normalizeGearLinkageToReference } from './mechanismReference';
import {
    calculateLinkage,
    gearTrainCenters,
    gearTrainOutputRatio,
    gearTrainPitchRadii,
    planetaryCarrierOutputRatio,
    planetaryPlanetSpinRatio,
    planetaryRingPitchRadius
} from './kinematics';

export const MECHANISM_GRAPH_IR_VERSION = 1;
export const MECHANISM_GRAPH_LIVE_SOLVE_BUDGET_MS = 16;

export type MechanismGraphNodeRole =
    | 'board-anchor'
    | 'rigid-part'
    | 'moving-joint'
    | 'link'
    | 'gear'
    | 'ring-gear'
    | 'cam'
    | 'follower'
    | 'guide'
    | 'slider'
    | 'spacer'
    | 'fastener'
    | 'output-point'
    | 'generated-point';

export type MechanismConstraintRole =
    | 'fixed-to-board'
    | 'board-snap'
    | 'pin-joint'
    | 'distance'
    | 'gear-mesh'
    | 'contact'
    | 'prismatic'
    | 'phase'
    | 'output-offset'
    | 'clearance';

export type MechanismGraphDiagnostic = {
    severity: 'info' | 'warning' | 'error';
    message: string;
};

export type MechanismGraphNode = {
    id: string;
    label: string;
    role: MechanismGraphNodeRole;
    position?: Point;
    value?: number;
    samples?: number[];
};

export type MechanismConstraint = {
    id: string;
    label: string;
    role: MechanismConstraintRole;
    nodes: string[];
    value?: number;
    angle?: number;
    vector?: Point;
    samples?: number[];
};

export type MechanismGraphSource = 'derived-legacy-adapter' | 'family-definition' | 'free-graph-authoring' | 'imported-graph';

export type MechanismGraphSolver = 'legacy-closed-form' | 'constraint-graph' | 'diagnostic-only';

export type MechanismDriver = {
    id: string;
    label: string;
    role: 'rotary-input' | 'derived-output';
    nodeId: string;
    solver: MechanismGraphSolver;
    ratio?: number;
};

export type MechanismFamilyDefinition = {
    id: string;
    legacyType?: MechanismType;
    firstCompilerTarget: boolean;
    authoringMode: 'classroom-preset' | 'advanced-diagnostic';
};

export type MechanismGraph = {
    version: typeof MECHANISM_GRAPH_IR_VERSION;
    id: string;
    mechanismId: string;
    legacyType?: MechanismType;
    source: MechanismGraphSource;
    family: MechanismFamilyDefinition;
    solver: MechanismGraphSolver;
    persisted: false;
    nodes: MechanismGraphNode[];
    constraints: MechanismConstraint[];
    drivers: MechanismDriver[];
    diagnostics: MechanismGraphDiagnostic[];
};

export type MechanismGraphMotionSample = {
    angle: number;
    state: JointState;
    source: 'calculateLinkage';
};

const FIRST_COMPILER_TARGETS = new Set<MechanismType>(['4bar', 'gear']);
const CLASSROOM_PRESET_TARGETS = new Set<MechanismType>(['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear']);
const toRad = (degrees = 0) => (degrees * Math.PI) / 180;
const finiteNumber = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value as number : fallback;
const offsetVector = (distance: number | undefined, angleDegrees: number | undefined): Point => {
    const length = finiteNumber(distance);
    const angle = toRad(finiteNumber(angleDegrees));
    return { x: length * Math.cos(angle), y: length * Math.sin(angle) };
};

const outputOffset = (
    id: string,
    label: string,
    nodes: string[],
    distance: number | undefined,
    angleDegrees: number | undefined,
    samples?: number[]
): MechanismConstraint => ({
    id,
    label,
    role: 'output-offset',
    nodes,
    value: finiteNumber(distance),
    angle: toRad(finiteNumber(angleDegrees)),
    vector: offsetVector(distance, angleDegrees),
    samples
});

const fixedBoard = (id: string, label: string, position: Point): MechanismGraphNode => ({
    id,
    label,
    role: 'board-anchor',
    position
});

const fixedBoardConstraints = (nodeId: string, label: string): MechanismConstraint[] => [
    { id: `${nodeId}-fixed`, label: `${label} stays on the board`, role: 'fixed-to-board', nodes: [nodeId] },
    { id: `${nodeId}-board-snap`, label: `${label} snaps to pegboard`, role: 'board-snap', nodes: [nodeId] }
];

const gearTrainGraphParts = (mechanism: MechanismConfig) => {
    const radii = gearTrainPitchRadii(mechanism);
    const centers = gearTrainCenters(mechanism);
    const gearNodes: MechanismGraphNode[] = radii.map((radius, index) => ({
        id: `gear-${index}`,
        label: index === 0 ? 'Drive gear' : index === radii.length - 1 ? 'Output gear' : `Idler gear ${index}`,
        role: 'gear',
        position: centers[index],
        value: radius
    }));
    const boardConstraints: MechanismConstraint[] = gearNodes.flatMap(node => fixedBoardConstraints(node.id, `${node.label} axle`));
    const meshConstraints: MechanismConstraint[] = radii.slice(1).map((radius, index) => ({
        id: `mesh-${index}-${index + 1}`,
        label: `Gear ${index} meshes with gear ${index + 1}`,
        role: 'gear-mesh',
        nodes: [`gear-${index}`, `gear-${index + 1}`],
        value: radii[index] + radius
    }));
    return { radii, centers, gearNodes, boardConstraints, meshConstraints };
};

const mechanismFamily = (type: MechanismType): MechanismFamilyDefinition => ({
    id: type,
    legacyType: type,
    firstCompilerTarget: FIRST_COMPILER_TARGETS.has(type),
    authoringMode: CLASSROOM_PRESET_TARGETS.has(type) ? 'classroom-preset' : 'advanced-diagnostic'
});

export type FreeMechanismGraphDraft = {
    id: string;
    familyId?: string;
    source?: Extract<MechanismGraphSource, 'free-graph-authoring' | 'imported-graph' | 'family-definition'>;
    nodes: MechanismGraphNode[];
    constraints: MechanismConstraint[];
    drivers?: MechanismDriver[];
    diagnostics?: MechanismGraphDiagnostic[];
};

export const mechanismGraphFromDraft = (draft: FreeMechanismGraphDraft): MechanismGraph => ({
    version: MECHANISM_GRAPH_IR_VERSION,
    id: `${draft.id}:graph`,
    mechanismId: draft.id,
    source: draft.source ?? 'free-graph-authoring',
    family: {
        id: draft.familyId ?? draft.id,
        firstCompilerTarget: false,
        authoringMode: 'advanced-diagnostic'
    },
    solver: 'constraint-graph',
    persisted: false,
    nodes: draft.nodes.map(node => ({ ...node })),
    constraints: draft.constraints.map(constraint => ({ ...constraint, nodes: [...constraint.nodes] })),
    drivers: (draft.drivers ?? []).map(driver => ({ ...driver, solver: driver.solver ?? 'constraint-graph' })),
    diagnostics: [...(draft.diagnostics ?? [])]
});

export const legacyFourBarToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const groundAngle = toRad(mechanism.groundAngle ?? 0);
    const p2 = {
        x: p1.x + mechanism.groundLength * Math.cos(groundAngle),
        y: p1.y + mechanism.groundLength * Math.sin(groundAngle)
    };

    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('4bar'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Input board pivot', p1),
            fixedBoard('p2', 'Output board pivot', p2),
            { id: 'input-link', label: 'Input link', role: 'link', value: mechanism.crankLength },
            { id: 'coupler-link', label: 'Coupler link', role: 'link', value: mechanism.couplerLength },
            { id: 'output-link', label: 'Output link', role: 'link', value: mechanism.rockerLength },
            { id: 'j1', label: 'Input moving joint', role: 'moving-joint' },
            { id: 'j2', label: 'Output moving joint', role: 'moving-joint' },
            { id: 'effector', label: 'Motion target point', role: 'output-point' }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Input pivot'),
            ...fixedBoardConstraints('p2', 'Output pivot'),
            { id: 'input-length', label: 'Input link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength },
            { id: 'coupler-length', label: 'Coupler link length', role: 'distance', nodes: ['j1', 'j2'], value: mechanism.couplerLength },
            { id: 'output-length', label: 'Output link length', role: 'distance', nodes: ['p2', 'j2'], value: mechanism.rockerLength },
            outputOffset('effector-offset', 'Target point rides on coupler', ['j1', 'j2', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'input-rotation', label: 'Turn input pivot', role: 'rotary-input', nodeId: 'p1', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const legacyGearToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const { radii, gearNodes, boardConstraints, meshConstraints } = gearTrainGraphParts(mechanism);

    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('gear'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            ...gearNodes,
            { id: 'drive-pin', label: 'Drive handle point', role: 'moving-joint' },
            { id: 'output-pin', label: 'Output handle point', role: 'moving-joint' },
            { id: 'effector', label: 'Motion target point', role: 'output-point' }
        ],
        constraints: [
            ...boardConstraints,
            ...meshConstraints,
            { id: 'gear-phase', label: 'Meshed gears keep opposite phase', role: 'phase', nodes: gearNodes.map(node => node.id), value: gearTrainOutputRatio(radii) },
            outputOffset('output-offset', 'Target point rides on output gear', ['output-pin', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [
            { id: 'drive-gear-rotation', label: 'Turn drive gear', role: 'rotary-input', nodeId: 'gear-0', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 },
            { id: 'output-gear-rotation', label: 'Output follows gear ratio', role: 'derived-output', nodeId: `gear-${Math.max(0, radii.length - 1)}`, solver: 'legacy-closed-form', ratio: gearTrainOutputRatio(radii) }
        ],
        diagnostics: []
    };
};

export const legacyPistonToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 0);
    const guideAnchor = {
        x: p1.x + (mechanism.crankLength + mechanism.couplerLength) * Math.cos(trackAngle),
        y: p1.y + (mechanism.crankLength + mechanism.couplerLength) * Math.sin(trackAngle)
    };
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('piston'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Crank board pivot', p1),
            fixedBoard('guide-anchor', 'Slider guide mount', guideAnchor),
            { id: 'crank-link', label: 'Crank link', role: 'link', value: mechanism.crankLength },
            { id: 'connecting-rod', label: 'Connecting rod', role: 'link', value: mechanism.rodLength ?? mechanism.couplerLength },
            { id: 'j1', label: 'Crank pin', role: 'moving-joint' },
            { id: 'slider', label: 'Slider block', role: 'slider' },
            { id: 'guide', label: 'Straight guide', role: 'guide' },
            { id: 'effector', label: 'Motion target point', role: 'output-point' }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Crank pivot'),
            ...fixedBoardConstraints('guide-anchor', 'Slider guide mount'),
            { id: 'crank-length', label: 'Crank link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength },
            { id: 'rod-length', label: 'Connecting rod length', role: 'distance', nodes: ['j1', 'slider'], value: mechanism.rodLength ?? mechanism.couplerLength },
            { id: 'slider-guide', label: 'Slider stays inside the guide', role: 'prismatic', nodes: ['slider', 'guide'], value: mechanism.sliderOffset },
            outputOffset('effector-offset', 'Target point rides on slider rod', ['j1', 'slider', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'crank-rotation', label: 'Turn crank', role: 'rotary-input', nodeId: 'p1', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const legacyCamToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 90);
    const guideAnchor = {
        x: p1.x + Math.max(1, mechanism.crankLength) * 2 * Math.cos(trackAngle),
        y: p1.y + Math.max(1, mechanism.crankLength) * 2 * Math.sin(trackAngle)
    };
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('cam'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            fixedBoard('cam-axle', 'Cam axle', p1),
            fixedBoard('guide-anchor', 'Follower guide mount', guideAnchor),
            { id: 'cam-disk', label: 'Cam disk', role: 'cam', value: mechanism.crankLength, samples: mechanism.camProfileSamples?.map(sample => finiteNumber(sample, 1)) },
            { id: 'follower-head', label: 'Rounded follower head', role: 'follower', value: mechanism.sliderOffset },
            { id: 'follower-guide', label: 'Vertical guide cartridge', role: 'guide' },
            { id: 'effector', label: 'Motion target point', role: 'output-point' }
        ],
        constraints: [
            ...fixedBoardConstraints('cam-axle', 'Cam axle'),
            ...fixedBoardConstraints('guide-anchor', 'Follower guide mount'),
            { id: 'cam-follower-contact', label: 'Follower rests on cam edge', role: 'contact', nodes: ['cam-disk', 'follower-head'], value: mechanism.sliderOffset },
            { id: 'follower-guide-slide', label: 'Follower moves only along the guide', role: 'prismatic', nodes: ['follower-head', 'follower-guide'] },
            outputOffset('effector-offset', 'Target point rides on follower', ['follower-head', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle, mechanism.camProfileSamples?.map(sample => finiteNumber(sample, 1)))
        ],
        drivers: [{ id: 'cam-rotation', label: 'Turn cam axle', role: 'rotary-input', nodeId: 'cam-axle', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const legacyGearLinkageToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const referencePair = normalizeGearLinkageToReference(mechanism);
    const { radii, gearNodes, boardConstraints, meshConstraints } = gearTrainGraphParts(referencePair);
    const linkLength = Math.max(1, Math.abs(referencePair.couplerLength));
    const physicalMeshConstraints = radii.length > 2 ? meshConstraints : [];
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('gear_linkage'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            ...gearNodes,
            { id: 'drive-pin', label: 'Drive linkage handle point', role: 'moving-joint' },
            { id: 'output-pin', label: 'Output linkage handle point', role: 'moving-joint' },
            { id: 'effector', label: 'Shared linkage target point', role: 'output-point' },
            { id: 'drive-crank-link', label: 'Drive crank link', role: 'link', value: referencePair.couplerPointDist },
            { id: 'output-crank-link', label: 'Output crank link', role: 'link', value: referencePair.couplerPointDist },
            { id: 'connector-link-a', label: 'Drive connector link', role: 'link', value: linkLength },
            { id: 'connector-link-b', label: 'Output connector link', role: 'link', value: linkLength }
        ],
        constraints: [
            ...boardConstraints,
            ...physicalMeshConstraints,
            { id: 'gear-phase', label: radii.length > 2 ? 'Meshed gears keep opposite phase' : 'Endpoint cranks keep selected timing', role: 'phase', nodes: gearNodes.map(node => node.id), value: gearTrainOutputRatio(radii) },
            outputOffset('drive-crank-offset', 'Drive link rides on drive gear', ['gear-0', 'drive-pin'], referencePair.couplerPointDist, referencePair.couplerPointAngle),
            outputOffset('output-crank-offset', 'Output link rides on output gear', ['gear-' + Math.max(0, radii.length - 1), 'output-pin'], referencePair.couplerPointDist, referencePair.couplerPointAngle),
            { id: 'drive-connector-length', label: 'Drive linkage length', role: 'distance', nodes: ['drive-pin', 'effector'], value: linkLength },
            { id: 'output-connector-length', label: 'Output linkage length', role: 'distance', nodes: ['output-pin', 'effector'], value: linkLength },
            outputOffset('connector-output', 'Target point is the shared linkage connector', ['drive-pin', 'output-pin', 'effector'], linkLength, referencePair.couplerPointAngle)
        ],
        drivers: [
            { id: 'drive-gear-rotation', label: 'Turn drive gear', role: 'rotary-input', nodeId: 'gear-0', solver: 'legacy-closed-form', ratio: referencePair.speed1 ?? 1 },
            { id: 'output-gear-rotation', label: 'Output follows gear ratio', role: 'derived-output', nodeId: `gear-${Math.max(0, radii.length - 1)}`, solver: 'legacy-closed-form', ratio: gearTrainOutputRatio(radii) }
        ],
        diagnostics: []
    };
};

export const legacyPlanetaryGearToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const sunRadius = Math.max(1, mechanism.crankLength);
    const planetRadius = Math.max(1, mechanism.rockerLength || 36);
    const ringRadius = planetaryRingPitchRadius(sunRadius, planetRadius);
    const carrierRadius = Math.max(1, mechanism.groundLength || sunRadius + planetRadius);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        legacyType: mechanism.type,
        source: 'derived-legacy-adapter',
        family: mechanismFamily('planetary_gear'),
        solver: 'legacy-closed-form',
        persisted: false,
        nodes: [
            { id: 'sun-gear', label: 'Sun gear axle', role: 'gear', position: p1, value: sunRadius },
            { id: 'ring-gear', label: 'Fixed ring gear', role: 'ring-gear', position: p1, value: ringRadius },
            { id: 'carrier', label: 'Carrier arm', role: 'link', value: carrierRadius },
            { id: 'planet-gear', label: 'Moving planet gear', role: 'gear', value: planetRadius },
            { id: 'output-point', label: 'Carrier output point', role: 'output-point', value: mechanism.couplerPointDist }
        ],
        constraints: [
            ...fixedBoardConstraints('sun-gear', 'Sun gear axle'),
            ...fixedBoardConstraints('ring-gear', 'Ring gear'),
            { id: 'sun-planet-mesh', label: 'Planet meshes with sun gear', role: 'gear-mesh', nodes: ['sun-gear', 'planet-gear'], value: sunRadius + planetRadius },
            { id: 'planet-ring-mesh', label: 'Planet meshes inside ring gear', role: 'gear-mesh', nodes: ['planet-gear', 'ring-gear'], value: ringRadius - planetRadius },
            { id: 'planet-carrier-pin', label: 'Planet axle rides on carrier', role: 'pin-joint', nodes: ['carrier', 'planet-gear'] },
            { id: 'carrier-phase', label: 'Carrier follows planetary ratio', role: 'phase', nodes: ['sun-gear', 'carrier'], value: planetaryCarrierOutputRatio(sunRadius, planetRadius) },
            { id: 'planet-spin-phase', label: 'Planet spins from gear contact', role: 'phase', nodes: ['sun-gear', 'planet-gear'], value: planetaryPlanetSpinRatio(sunRadius, planetRadius) },
            outputOffset('carrier-output', 'Target point rides on carrier', ['carrier', 'output-point'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [
            { id: 'sun-driver', label: 'Turn sun gear', role: 'rotary-input', nodeId: 'sun-gear', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 },
            { id: 'carrier-output', label: 'Carrier follows gear set', role: 'derived-output', nodeId: 'carrier', solver: 'legacy-closed-form', ratio: planetaryCarrierOutputRatio(sunRadius, planetRadius) }
        ],
        diagnostics: []
    };
};

const unsupportedLegacyMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => ({
    version: MECHANISM_GRAPH_IR_VERSION,
    id: `${mechanism.id}:graph`,
    mechanismId: mechanism.id,
    legacyType: mechanism.type,
    source: 'derived-legacy-adapter',
    family: mechanismFamily(mechanism.type),
    solver: 'diagnostic-only',
    persisted: false,
    nodes: [{ id: 'legacy-mechanism', label: `${mechanism.type} legacy mechanism`, role: 'generated-point' }],
    constraints: [],
    drivers: [],
    diagnostics: [{
        severity: 'info',
        message: `${mechanism.type} compiles as a diagnostic graph until a fabrication recipe compiler owns this family.`
    }]
});

type MechanismGraphAdapter = (mechanism: MechanismConfig) => MechanismGraph;

export const MECHANISM_GRAPH_ADAPTERS = Object.freeze({
    '4bar': legacyFourBarToMechanismGraph,
    piston: legacyPistonToMechanismGraph,
    cam: legacyCamToMechanismGraph,
    gear: legacyGearToMechanismGraph,
    gear_linkage: legacyGearLinkageToMechanismGraph,
    planetary_gear: legacyPlanetaryGearToMechanismGraph
} satisfies Partial<Record<MechanismType, MechanismGraphAdapter>>);

export const MECHANISM_GRAPH_ADAPTER_TYPES = Object.freeze(Object.keys(MECHANISM_GRAPH_ADAPTERS) as MechanismType[]);

export const mechanismGraphForMechanism = (mechanism: MechanismConfig): MechanismGraph => {
    const adapter = (MECHANISM_GRAPH_ADAPTERS as Partial<Record<MechanismType, MechanismGraphAdapter>>)[mechanism.type];
    return (adapter ?? unsupportedLegacyMechanismGraph)(mechanism);
};

export const sampleMechanismGraphMotion = (mechanism: MechanismConfig, angle: number): MechanismGraphMotionSample => ({
    angle,
    state: calculateLinkage(mechanism, angle),
    source: 'calculateLinkage'
});

const duplicateIds = (ids: string[]) => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    ids.forEach(id => {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
    });
    return [...duplicates];
};

const VALID_GRAPH_SOURCES: readonly MechanismGraphSource[] = ['derived-legacy-adapter', 'family-definition', 'free-graph-authoring', 'imported-graph'];
const VALID_GRAPH_SOLVERS: readonly MechanismGraphSolver[] = ['legacy-closed-form', 'constraint-graph', 'diagnostic-only'];

const CONSTRAINT_NODE_COUNTS: Partial<Record<MechanismConstraintRole, number | [min: number, max?: number]>> = {
    'fixed-to-board': 1,
    'board-snap': 1,
    'pin-joint': 2,
    distance: 2,
    'gear-mesh': 2,
    contact: 2,
    prismatic: 2,
    clearance: 2,
    phase: [2],
    'output-offset': [2]
};

const finiteDiagnostic = (diagnostics: MechanismGraphDiagnostic[], path: string, value: number | undefined) => {
    if (value !== undefined && !Number.isFinite(value)) diagnostics.push({ severity: 'error', message: `Graph ${path} must be finite.` });
};

const finitePointDiagnostic = (diagnostics: MechanismGraphDiagnostic[], path: string, point: Point | undefined) => {
    if (!point) return;
    finiteDiagnostic(diagnostics, `${path}.x`, point.x);
    finiteDiagnostic(diagnostics, `${path}.y`, point.y);
};

const finiteSamplesDiagnostic = (diagnostics: MechanismGraphDiagnostic[], path: string, samples: number[] | undefined) =>
    samples?.forEach((sample, index) => finiteDiagnostic(diagnostics, `${path}[${index}]`, sample));

const constraintNodeCountValid = (constraint: MechanismConstraint) => {
    const expected = CONSTRAINT_NODE_COUNTS[constraint.role];
    if (!expected) return true;
    if (typeof expected === 'number') return constraint.nodes.length === expected;
    const [min, max] = expected;
    return constraint.nodes.length >= min && (max === undefined || constraint.nodes.length <= max);
};

export type MechanismGraphValidation = {
    valid: boolean;
    diagnostics: MechanismGraphDiagnostic[];
};

export const validateMechanismGraph = (graph: MechanismGraph): MechanismGraphValidation => {
    const diagnostics: MechanismGraphDiagnostic[] = [];
    if (graph.version !== MECHANISM_GRAPH_IR_VERSION) diagnostics.push({ severity: 'error', message: `Graph version ${graph.version} is not supported.` });
    if (graph.persisted !== false) diagnostics.push({ severity: 'error', message: 'Graph IR must remain a derived non-persisted artifact.' });
    if (!VALID_GRAPH_SOURCES.includes(graph.source)) diagnostics.push({ severity: 'error', message: `Graph source ${String(graph.source)} is not supported.` });
    if (!VALID_GRAPH_SOLVERS.includes(graph.solver)) diagnostics.push({ severity: 'error', message: `Graph solver ${String(graph.solver)} is not supported.` });
    if (!graph.id || !graph.mechanismId || !graph.family?.id) diagnostics.push({ severity: 'error', message: 'Graph id, mechanismId, and family id are required.' });
    if (graph.source === 'derived-legacy-adapter' && !graph.legacyType) diagnostics.push({ severity: 'error', message: 'Derived legacy graph must preserve legacyType.' });

    const nodeIds = graph.nodes.map(node => node.id);
    duplicateIds(nodeIds).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph node id: ${id}.` }));
    duplicateIds(graph.constraints.map(constraint => constraint.id)).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph constraint id: ${id}.` }));
    duplicateIds(graph.drivers.map(driver => driver.id)).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph driver id: ${id}.` }));

    const nodeIdSet = new Set(nodeIds);
    graph.nodes.forEach(node => {
        if (!node.id || !node.label || !node.role) diagnostics.push({ severity: 'error', message: `Graph node ${node.id || '(missing)'} is missing id, label, or role.` });
        finitePointDiagnostic(diagnostics, `node ${node.id}.position`, node.position);
        finiteDiagnostic(diagnostics, `node ${node.id}.value`, node.value);
        finiteSamplesDiagnostic(diagnostics, `node ${node.id}.samples`, node.samples);
    });
    graph.constraints.forEach(constraint => {
        if (!constraint.id || !constraint.label || !constraint.role) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id || '(missing)'} is missing id, label, or role.` });
        if (!constraint.nodes.length) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} has no nodes.` });
        if (!constraintNodeCountValid(constraint)) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} has invalid ${constraint.role} node count.` });
        constraint.nodes.forEach(nodeId => {
            if (!nodeIdSet.has(nodeId)) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} references missing node ${nodeId}.` });
        });
        finiteDiagnostic(diagnostics, `constraint ${constraint.id}.value`, constraint.value);
        finiteDiagnostic(diagnostics, `constraint ${constraint.id}.angle`, constraint.angle);
        finitePointDiagnostic(diagnostics, `constraint ${constraint.id}.vector`, constraint.vector);
        finiteSamplesDiagnostic(diagnostics, `constraint ${constraint.id}.samples`, constraint.samples);
    });
    graph.drivers.forEach(driver => {
        if (!driver.id || !driver.label || !driver.nodeId) diagnostics.push({ severity: 'error', message: `Graph driver ${driver.id || '(missing)'} is missing id, label, or nodeId.` });
        if (!nodeIdSet.has(driver.nodeId)) diagnostics.push({ severity: 'error', message: `Graph driver ${driver.id} references missing node ${driver.nodeId}.` });
        if (!VALID_GRAPH_SOLVERS.includes(driver.solver)) diagnostics.push({ severity: 'error', message: `Graph driver ${driver.id} uses unsupported solver ${String(driver.solver)}.` });
        finiteDiagnostic(diagnostics, `driver ${driver.id}.ratio`, driver.ratio);
    });

    return {
        valid: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
        diagnostics
    };
};

import type { JointState, MechanismConfig, MechanismType, Point } from '../types';
import { mmToScene, normalizeGearLinkageToReference, REFERENCE_DEFAULTS } from './mechanismReference';
import {
    calculateLinkage,
    gearTrainCenters,
    gearTrainOutputRatio,
    gearTrainPitchRadii,
    planetaryCarrierOutputRatio,
    planetaryPlanetSpinRatio,
    planetaryRingPitchRadius
} from './kinematics';
import {
    connectionSelectionSummary,
    resolveFourBarConnectionSelections,
    type ConnectionSelectionSummary
} from './mechanismConnectionSelections';

export const MECHANISM_GRAPH_IR_VERSION = 1;
export const MECHANISM_GRAPH_LIVE_SOLVE_BUDGET_MS = 16;
// Graph coordinates are deterministic scene-space doubles; this tolerance absorbs roundoff only, not fabrication slack.
export const MECHANISM_GRAPH_POSITIONED_DISTANCE_TOLERANCE = 1e-6;

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

type MechanismGraphNodeBase = {
    id: string;
    label: string;
    /** False when this graph span is embodied by another fabricated part, such as a gear attachment hole. */
    fabricated?: boolean;
    position?: Point;
    value?: number;
    samples?: number[];
};

export type MechanismGraphNode =
    | (MechanismGraphNodeBase & { role: 'moving-joint'; ownerPartId?: string })
    | (MechanismGraphNodeBase & { role: Exclude<MechanismGraphNodeRole, 'moving-joint'>; ownerPartId?: never });

type MechanismConstraintBase = {
    id: string;
    label: string;
    nodes: string[];
    value?: number;
    angle?: number;
    vector?: Point;
    samples?: number[];
};

export type MechanismConstraint =
    | (MechanismConstraintBase & { role: 'distance'; fabricatedPartNodeId: string })
    | (MechanismConstraintBase & { role: Exclude<MechanismConstraintRole, 'distance'>; fabricatedPartNodeId?: never });

export type MechanismGraphSource = 'family-definition' | 'free-graph-authoring' | 'imported-graph';

export type MechanismGraphSolver = 'closed-form-kinematics' | 'constraint-graph';

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
    mechanismType?: MechanismType;
    firstCompilerTarget: boolean;
    authoringMode: 'classroom-preset' | 'advanced-diagnostic';
};

export type MechanismGraph = {
    version: typeof MECHANISM_GRAPH_IR_VERSION;
    id: string;
    mechanismId: string;
    mechanismType?: MechanismType;
    source: MechanismGraphSource;
    family: MechanismFamilyDefinition;
    solver: MechanismGraphSolver;
    persisted: false;
    connectionSelectionSummary?: ConnectionSelectionSummary;
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
const REFERENCE_BOARD_PITCH_SCENE = mmToScene(REFERENCE_DEFAULTS.pitchMm);
const nearestReferenceBoardDistance = (distance: number, minCells = 0) => {
    const cells = Math.max(minCells, Math.round(Math.abs(distance) / REFERENCE_BOARD_PITCH_SCENE));
    return cells * REFERENCE_BOARD_PITCH_SCENE;
};
const nearestReferenceBoardOffset = (offset: number, minCells = 0) => {
    const direction = offset < 0 ? -1 : 1;
    return direction * nearestReferenceBoardDistance(offset, minCells);
};
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

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const endpointOffset = (origin: Point, endpoint: Point) => {
    const vector = { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
    return {
        length: Math.hypot(vector.x, vector.y),
        angleDegrees: Math.atan2(vector.y, vector.x) * 180 / Math.PI
    };
};

const graphState = (mechanism: MechanismConfig) => {
    const reference = calculateLinkage(mechanism, 0);
    if (reference.isValid) return reference;
    for (let index = 1; index < 24; index += 1) {
        const candidate = calculateLinkage(mechanism, index * Math.PI * 2 / 24);
        if (candidate.isValid) return candidate;
    }
    return reference;
};

const fromLocal = (origin: Point, angleRad: number, x: number, y: number): Point => ({
    x: origin.x + x * Math.cos(angleRad) - y * Math.sin(angleRad),
    y: origin.y + x * Math.sin(angleRad) + y * Math.cos(angleRad)
});

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
    mechanismType: type,
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

export const fourBarMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const state = graphState(mechanism);
    const { p1, p2, j1, j2, effector } = state;
    const resolvedConnections = resolveFourBarConnectionSelections(mechanism);
    const inputLength = resolvedConnections.inputJoint?.length ?? mechanism.crankLength;
    const outputLength = resolvedConnections.outputJoint?.length ?? mechanism.rockerLength;
    const connectionSummary = connectionSelectionSummary(mechanism);

    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('4bar'),
        solver: 'closed-form-kinematics',
        persisted: false,
        connectionSelectionSummary: connectionSummary,
        nodes: [
            fixedBoard('p1', 'Input board pivot', p1),
            fixedBoard('p2', 'Output board pivot', p2),
            { id: 'input-link', label: 'Input link', role: 'link', position: midpoint(p1, j1), value: inputLength },
            { id: 'coupler-link', label: 'Coupler link', role: 'link', position: midpoint(j1, j2), value: mechanism.couplerLength },
            { id: 'output-link', label: 'Output link', role: 'link', position: midpoint(p2, j2), value: outputLength },
            { id: 'j1', label: 'Input moving joint', role: 'moving-joint', position: j1 },
            { id: 'j2', label: 'Output moving joint', role: 'moving-joint', position: j2 },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Input pivot'),
            ...fixedBoardConstraints('p2', 'Output pivot'),
            { id: 'input-length', label: 'Input link length', role: 'distance', nodes: ['p1', 'j1'], value: inputLength, fabricatedPartNodeId: 'input-link' },
            { id: 'coupler-length', label: 'Coupler link length', role: 'distance', nodes: ['j1', 'j2'], value: mechanism.couplerLength, fabricatedPartNodeId: 'coupler-link' },
            { id: 'output-length', label: 'Output link length', role: 'distance', nodes: ['p2', 'j2'], value: outputLength, fabricatedPartNodeId: 'output-link' },
            outputOffset('effector-offset', 'Target point rides on coupler', ['j1', 'j2', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'input-rotation', label: 'Turn input pivot', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const gearMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const { radii, gearNodes, boardConstraints, meshConstraints } = gearTrainGraphParts(mechanism);
    const state = graphState(mechanism);

    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('gear'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            ...gearNodes,
            { id: 'drive-pin', label: 'Drive handle point', role: 'moving-joint', position: state.j1 },
            { id: 'output-pin', label: 'Output handle point', role: 'moving-joint', position: state.j2 },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...boardConstraints,
            ...meshConstraints,
            { id: 'gear-phase', label: 'Meshed gears keep opposite phase', role: 'phase', nodes: gearNodes.map(node => node.id), value: gearTrainOutputRatio(radii) },
            outputOffset('output-offset', 'Target point rides on output gear', ['output-pin', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [
            { id: 'drive-gear-rotation', label: 'Turn drive gear', role: 'rotary-input', nodeId: 'gear-0', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 },
            { id: 'output-gear-rotation', label: 'Output follows gear ratio', role: 'derived-output', nodeId: `gear-${Math.max(0, radii.length - 1)}`, solver: 'closed-form-kinematics', ratio: gearTrainOutputRatio(radii) }
        ],
        diagnostics: []
    };
};

export const pistonMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 0);
    const guideAnchor = {
        x: p1.x + (mechanism.crankLength + mechanism.couplerLength) * Math.cos(trackAngle),
        y: p1.y + (mechanism.crankLength + mechanism.couplerLength) * Math.sin(trackAngle)
    };
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('piston'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Crank board pivot', p1),
            fixedBoard('guide-anchor', 'Slider guide mount', guideAnchor),
            { id: 'crank-link', label: 'Crank link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'connecting-rod', label: 'Connecting rod', role: 'link', position: midpoint(state.j1, state.j2), value: mechanism.rodLength ?? mechanism.couplerLength },
            { id: 'j1', label: 'Crank pin', role: 'moving-joint', position: state.j1 },
            { id: 'slider', label: 'Slider block', role: 'slider', position: state.j2 },
            { id: 'guide', label: 'Straight guide', role: 'guide', position: guideAnchor },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Crank pivot'),
            ...fixedBoardConstraints('guide-anchor', 'Slider guide mount'),
            { id: 'crank-length', label: 'Crank link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'crank-link' },
            { id: 'rod-length', label: 'Connecting rod length', role: 'distance', nodes: ['j1', 'slider'], value: mechanism.rodLength ?? mechanism.couplerLength, fabricatedPartNodeId: 'connecting-rod' },
            { id: 'slider-guide', label: 'Slider stays inside the guide', role: 'prismatic', nodes: ['slider', 'guide'], value: mechanism.sliderOffset },
            outputOffset('effector-offset', 'Target point rides on slider rod', ['j1', 'slider', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'crank-rotation', label: 'Turn crank', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const camMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 90);
    const guideAnchor = {
        x: p1.x + nearestReferenceBoardDistance(Math.max(1, mechanism.crankLength) * 2, 2) * Math.cos(trackAngle),
        y: p1.y + nearestReferenceBoardDistance(Math.max(1, mechanism.crankLength) * 2, 2) * Math.sin(trackAngle)
    };
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('cam'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('cam-axle', 'Cam axle', p1),
            fixedBoard('guide-anchor', 'Follower guide mount', guideAnchor),
            { id: 'cam-disk', label: 'Swappable cam disk', role: 'cam', position: p1, value: mechanism.crankLength, samples: mechanism.camProfileSamples?.map(sample => finiteNumber(sample, 1)) },
            { id: 'follower-head', label: 'Preassembled gravity follower module', role: 'follower', position: state.j2, value: mechanism.sliderOffset },
            { id: 'follower-guide', label: 'U-channel guide cartridge', role: 'guide', position: guideAnchor },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('cam-axle', 'Cam axle'),
            ...fixedBoardConstraints('guide-anchor', 'Follower guide mount'),
            { id: 'cam-follower-contact', label: 'Follower rests on cam edge', role: 'contact', nodes: ['cam-disk', 'follower-head'], value: mechanism.sliderOffset },
            { id: 'follower-guide-slide', label: 'Follower moves only along the guide', role: 'prismatic', nodes: ['follower-head', 'follower-guide'] },
            outputOffset('effector-offset', 'Target point rides on follower', ['follower-head', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle, mechanism.camProfileSamples?.map(sample => finiteNumber(sample, 1)))
        ],
        drivers: [{ id: 'cam-rotation', label: 'Turn cam axle', role: 'rotary-input', nodeId: 'cam-axle', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const gearLinkageMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const referencePair = normalizeGearLinkageToReference(mechanism);
    const { radii, gearNodes, boardConstraints, meshConstraints } = gearTrainGraphParts(referencePair);
    const linkLength = Math.max(1, Math.abs(referencePair.couplerLength));
    const physicalMeshConstraints = radii.length > 2 ? meshConstraints : [];
    const state = graphState(referencePair);
    const driveCenter = gearNodes[0]?.position ?? state.p1;
    const outputCenter = gearNodes.at(-1)?.position ?? state.p2;
    const driveOffset = endpointOffset(driveCenter, state.j1);
    const outputOffsetGeometry = endpointOffset(outputCenter, state.j2);
    const connectorOffset = endpointOffset(state.j1, state.effector);
    const connectionSummary = connectionSelectionSummary(referencePair);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('gear_linkage'),
        solver: 'closed-form-kinematics',
        persisted: false,
        connectionSelectionSummary: connectionSummary,
        nodes: [
            ...gearNodes,
            { id: 'drive-pin', label: 'Drive linkage handle point', role: 'moving-joint', position: state.j1 },
            { id: 'output-pin', label: 'Output linkage handle point', role: 'moving-joint', position: state.j2 },
            { id: 'effector', label: 'Shared linkage target point', role: 'output-point', position: state.effector },
            { id: 'drive-crank-link', label: 'Drive gear attachment span', role: 'link', fabricated: false, position: midpoint(driveCenter, state.j1), value: driveOffset.length },
            { id: 'output-crank-link', label: 'Output gear attachment span', role: 'link', fabricated: false, position: midpoint(outputCenter, state.j2), value: outputOffsetGeometry.length },
            { id: 'connector-link-a', label: 'Drive connector link', role: 'link', position: midpoint(state.j1, state.effector), value: linkLength },
            { id: 'connector-link-b', label: 'Output connector link', role: 'link', position: midpoint(state.j2, state.effector), value: linkLength }
        ],
        constraints: [
            ...boardConstraints,
            ...physicalMeshConstraints,
            { id: 'gear-phase', label: radii.length > 2 ? 'Meshed gears keep opposite phase' : 'Endpoint cranks keep selected timing', role: 'phase', nodes: gearNodes.map(node => node.id), value: gearTrainOutputRatio(radii) },
            outputOffset('drive-crank-offset', 'Drive link rides on drive gear', ['gear-0', 'drive-pin'], driveOffset.length, driveOffset.angleDegrees),
            outputOffset('output-crank-offset', 'Output link rides on output gear', ['gear-' + Math.max(0, radii.length - 1), 'output-pin'], outputOffsetGeometry.length, outputOffsetGeometry.angleDegrees),
            { id: 'drive-connector-length', label: 'Drive linkage length', role: 'distance', nodes: ['drive-pin', 'effector'], value: linkLength, fabricatedPartNodeId: 'connector-link-a' },
            { id: 'output-connector-length', label: 'Output linkage length', role: 'distance', nodes: ['output-pin', 'effector'], value: linkLength, fabricatedPartNodeId: 'connector-link-b' },
            outputOffset('connector-output', 'Target point is the shared linkage connector', ['drive-pin', 'output-pin', 'effector'], linkLength, connectorOffset.angleDegrees)
        ],
        drivers: [
            { id: 'drive-gear-rotation', label: 'Turn drive gear', role: 'rotary-input', nodeId: 'gear-0', solver: 'closed-form-kinematics', ratio: referencePair.speed1 ?? 1 },
            { id: 'output-gear-rotation', label: 'Output follows gear ratio', role: 'derived-output', nodeId: `gear-${Math.max(0, radii.length - 1)}`, solver: 'closed-form-kinematics', ratio: gearTrainOutputRatio(radii) }
        ],
        diagnostics: []
    };
};

export const planetaryGearMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const sunRadius = Math.max(1, mechanism.crankLength);
    const planetRadius = Math.max(1, mechanism.rockerLength || 36);
    const ringRadius = planetaryRingPitchRadius(sunRadius, planetRadius);
    const carrierRadius = Math.max(1, mechanism.groundLength || sunRadius + planetRadius);
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('planetary_gear'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            { id: 'sun-gear', label: 'Sun gear axle', role: 'gear', position: p1, value: sunRadius },
            { id: 'ring-gear', label: 'Fixed ring gear', role: 'ring-gear', position: p1, value: ringRadius },
            { id: 'carrier', label: 'Carrier arm', role: 'link', position: midpoint(p1, state.p2), value: carrierRadius },
            { id: 'planet-gear', label: 'Moving planet gear', role: 'gear', position: state.p2, value: planetRadius },
            { id: 'carrier-central-pivot', label: 'Carrier central pivot', role: 'moving-joint', fabricated: false, position: p1, ownerPartId: 'carrier' },
            { id: 'carrier-planet-pivot', label: 'Carrier planet pivot', role: 'moving-joint', fabricated: false, position: state.p2, ownerPartId: 'carrier' },
            { id: 'output-point', label: 'Carrier output point', role: 'output-point', position: state.effector, value: mechanism.couplerPointDist }
        ],
        constraints: [
            ...fixedBoardConstraints('sun-gear', 'Sun gear axle'),
            ...fixedBoardConstraints('ring-gear', 'Ring gear'),
            { id: 'sun-planet-mesh', label: 'Planet meshes with sun gear', role: 'gear-mesh', nodes: ['sun-gear', 'planet-gear'], value: sunRadius + planetRadius },
            { id: 'planet-ring-mesh', label: 'Planet meshes inside ring gear', role: 'gear-mesh', nodes: ['planet-gear', 'ring-gear'], value: ringRadius - planetRadius },
            { id: 'sun-carrier-pivot-pin', label: 'Sun axle supports carrier', role: 'pin-joint', nodes: ['sun-gear', 'carrier-central-pivot'] },
            { id: 'planet-carrier-pin', label: 'Planet axle rides on carrier', role: 'pin-joint', nodes: ['planet-gear', 'carrier-planet-pivot'] },
            { id: 'carrier-phase', label: 'Carrier follows planetary ratio', role: 'phase', nodes: ['sun-gear', 'carrier'], value: planetaryCarrierOutputRatio(sunRadius, planetRadius) },
            { id: 'planet-spin-phase', label: 'Planet spins from gear contact', role: 'phase', nodes: ['sun-gear', 'planet-gear'], value: planetaryPlanetSpinRatio(sunRadius, planetRadius) },
            outputOffset('carrier-output', 'Target point rides on carrier', ['carrier', 'output-point'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [
            { id: 'sun-driver', label: 'Turn sun gear', role: 'rotary-input', nodeId: 'sun-gear', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 },
            { id: 'carrier-output', label: 'Carrier follows gear set', role: 'derived-output', nodeId: 'carrier', solver: 'closed-form-kinematics', ratio: planetaryCarrierOutputRatio(sunRadius, planetRadius) }
        ],
        diagnostics: []
    };
};

export const crankMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('crank'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Crank board pivot', p1),
            { id: 'crank-link', label: 'Crank link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'j1', label: 'Crank pin', role: 'moving-joint', position: state.j1 },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Crank pivot'),
            { id: 'crank-length', label: 'Crank link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'crank-link' },
            outputOffset('effector-offset', 'Target rides on crank pin', ['j1', 'effector'], mechanism.couplerPointDist || mechanism.crankLength, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'crank-rotation', label: 'Turn crank', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const yokeMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 0);
    const guideAnchor = fromLocal(p1, trackAngle, 0, nearestReferenceBoardOffset(mechanism.sliderOffset || 0));
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('yoke'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Crank board pivot', p1),
            fixedBoard('guide-anchor', 'Yoke guide mount', guideAnchor),
            { id: 'crank-link', label: 'Crank link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'yoke-slider', label: 'Yoke slider', role: 'slider', position: state.j2 },
            { id: 'guide', label: 'Straight guide', role: 'guide', position: guideAnchor },
            { id: 'j1', label: 'Crank pin', role: 'moving-joint', position: state.j1 },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Crank pivot'),
            ...fixedBoardConstraints('guide-anchor', 'Yoke guide mount'),
            { id: 'crank-length', label: 'Crank link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'crank-link' },
            { id: 'yoke-slide', label: 'Yoke moves in guide', role: 'prismatic', nodes: ['yoke-slider', 'guide'], value: mechanism.sliderOffset },
            outputOffset('effector-offset', 'Target point rides on yoke', ['yoke-slider', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'crank-rotation', label: 'Turn crank', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const quickReturnMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const groundAngle = toRad(mechanism.groundAngle ?? 0);
    const p2 = fromLocal(p1, groundAngle, mechanism.groundLength, mechanism.sliderOffset);
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('quick-return'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Crank board pivot', p1),
            fixedBoard('p2', 'Slotted arm pivot', p2),
            { id: 'crank-link', label: 'Crank link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'slotted-arm', label: 'Slotted arm', role: 'link', position: midpoint(state.p2, state.j2), value: mechanism.rockerLength },
            { id: 'j1', label: 'Crank pin in slot', role: 'moving-joint', position: state.j1 },
            { id: 'j2', label: 'Output point on slotted arm', role: 'moving-joint', position: state.j2 },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Crank pivot'),
            ...fixedBoardConstraints('p2', 'Slotted arm pivot'),
            { id: 'crank-length', label: 'Crank link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'crank-link' },
            { id: 'arm-length', label: 'Slotted arm length', role: 'distance', nodes: ['p2', 'j2'], value: mechanism.rockerLength, fabricatedPartNodeId: 'slotted-arm' },
            { id: 'slot-contact', label: 'Crank pin slides in slot', role: 'prismatic', nodes: ['j1', 'slotted-arm'] },
            outputOffset('effector-offset', 'Target point rides on slotted arm', ['j2', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'crank-rotation', label: 'Turn crank', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const fiveBarMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const groundAngle = toRad(mechanism.groundAngle ?? 0);
    const p2 = { x: p1.x + mechanism.groundLength * Math.cos(groundAngle), y: p1.y + mechanism.groundLength * Math.sin(groundAngle) };
    const state = graphState(mechanism);
    const rightRodLength = mechanism.rodLength || 100;
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('5bar'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Left board pivot', p1),
            fixedBoard('p2', 'Right board pivot', p2),
            { id: 'left-crank', label: 'Left crank link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'right-crank', label: 'Right crank link', role: 'link', position: midpoint(p2, state.aux ?? p2), value: mechanism.rockerLength },
            { id: 'left-coupler', label: 'Left coupler link', role: 'link', position: midpoint(state.j1, state.j2), value: mechanism.couplerLength },
            { id: 'right-coupler', label: 'Right coupler link', role: 'link', position: midpoint(state.aux ?? p2, state.j2), value: rightRodLength },
            { id: 'j1', label: 'Left moving joint', role: 'moving-joint', position: state.j1 },
            { id: 'j2', label: 'Shared moving joint', role: 'moving-joint', position: state.j2 },
            { id: 'aux', label: 'Right moving joint', role: 'moving-joint', position: state.aux },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Left pivot'),
            ...fixedBoardConstraints('p2', 'Right pivot'),
            { id: 'left-crank-length', label: 'Left crank length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'left-crank' },
            { id: 'right-crank-length', label: 'Right crank length', role: 'distance', nodes: ['p2', 'aux'], value: mechanism.rockerLength, fabricatedPartNodeId: 'right-crank' },
            { id: 'left-coupler-length', label: 'Left coupler length', role: 'distance', nodes: ['j1', 'j2'], value: mechanism.couplerLength, fabricatedPartNodeId: 'left-coupler' },
            { id: 'right-coupler-length', label: 'Right coupler length', role: 'distance', nodes: ['aux', 'j2'], value: rightRodLength, fabricatedPartNodeId: 'right-coupler' },
            outputOffset('effector-offset', 'Target point rides on shared joint', ['j2', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [
            { id: 'left-crank-rotation', label: 'Turn left crank', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 },
            { id: 'right-crank-rotation', label: 'Turn right crank', role: 'derived-output', nodeId: 'p2', solver: 'closed-form-kinematics', ratio: mechanism.speed2 ?? mechanism.gearRatio ?? 1 }
        ],
        diagnostics: []
    };
};

export const sixBarMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const groundAngle = toRad(mechanism.groundAngle ?? 0);
    const p2 = { x: p1.x + mechanism.groundLength * Math.cos(groundAngle), y: p1.y + mechanism.groundLength * Math.sin(groundAngle) };
    const state = graphState(mechanism);
    const dyadLength = mechanism.rodLength || 95;
    const followerLength = mechanism.couplerPointDist || 95;
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('6bar'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('p1', 'Input board pivot', p1),
            fixedBoard('p2', 'Output board pivot', p2),
            { id: 'input-link', label: 'Input link', role: 'link', position: midpoint(p1, state.j1), value: mechanism.crankLength },
            { id: 'coupler-link', label: 'Coupler link', role: 'link', position: midpoint(state.j1, state.j2), value: mechanism.couplerLength },
            { id: 'output-link', label: 'Output link', role: 'link', position: midpoint(p2, state.j2), value: mechanism.rockerLength },
            { id: 'dyad-link', label: 'Dyad link', role: 'link', position: midpoint(state.j2, state.aux ?? state.j2), value: dyadLength },
            { id: 'follower-link', label: 'Follower link', role: 'link', position: midpoint(p2, state.aux ?? p2), value: followerLength },
            { id: 'j1', label: 'Input moving joint', role: 'moving-joint', position: state.j1 },
            { id: 'j2', label: 'Output moving joint', role: 'moving-joint', position: state.j2 },
            { id: 'aux', label: 'Follower moving joint', role: 'moving-joint', position: state.aux },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('p1', 'Input pivot'),
            ...fixedBoardConstraints('p2', 'Output pivot'),
            { id: 'input-length', label: 'Input link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength, fabricatedPartNodeId: 'input-link' },
            { id: 'coupler-length', label: 'Coupler link length', role: 'distance', nodes: ['j1', 'j2'], value: mechanism.couplerLength, fabricatedPartNodeId: 'coupler-link' },
            { id: 'output-length', label: 'Output link length', role: 'distance', nodes: ['p2', 'j2'], value: mechanism.rockerLength, fabricatedPartNodeId: 'output-link' },
            { id: 'dyad-length', label: 'Dyad link length', role: 'distance', nodes: ['j2', 'aux'], value: dyadLength, fabricatedPartNodeId: 'dyad-link' },
            { id: 'follower-length', label: 'Follower link length', role: 'distance', nodes: ['p2', 'aux'], value: followerLength, fabricatedPartNodeId: 'follower-link' }
        ],
        drivers: [{ id: 'input-rotation', label: 'Turn input pivot', role: 'rotary-input', nodeId: 'p1', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const rackPinionMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const trackAngle = toRad(mechanism.groundAngle ?? 90);
    const guideAnchor = fromLocal(p1, trackAngle, 0, nearestReferenceBoardDistance(mechanism.crankLength + Math.abs(mechanism.sliderOffset || 0), 1));
    const state = graphState(mechanism);
    return {
        version: MECHANISM_GRAPH_IR_VERSION,
        id: `${mechanism.id}:graph`,
        mechanismId: mechanism.id,
        mechanismType: mechanism.type,
        source: 'family-definition',
        family: mechanismFamily('rack-pinion'),
        solver: 'closed-form-kinematics',
        persisted: false,
        nodes: [
            fixedBoard('pinion', 'Pinion axle', p1),
            fixedBoard('guide-anchor', 'Rack guide mount', guideAnchor),
            { id: 'pinion-gear', label: 'Pinion gear', role: 'gear', position: p1, value: mechanism.crankLength },
            { id: 'rack', label: 'Rack slider', role: 'slider', position: state.p2, value: mechanism.rockerLength },
            { id: 'guide', label: 'Rack guide', role: 'guide', position: guideAnchor },
            { id: 'effector', label: 'Motion target point', role: 'output-point', position: state.effector }
        ],
        constraints: [
            ...fixedBoardConstraints('pinion', 'Pinion axle'),
            ...fixedBoardConstraints('guide-anchor', 'Rack guide mount'),
            { id: 'pinion-rack-contact', label: 'Pinion teeth push rack', role: 'contact', nodes: ['pinion-gear', 'rack'], value: mechanism.crankLength },
            { id: 'rack-guide-slide', label: 'Rack slides in guide', role: 'prismatic', nodes: ['rack', 'guide'], value: mechanism.sliderOffset },
            outputOffset('effector-offset', 'Target point rides on rack', ['rack', 'effector'], mechanism.couplerPointDist, mechanism.couplerPointAngle)
        ],
        drivers: [{ id: 'pinion-rotation', label: 'Turn pinion', role: 'rotary-input', nodeId: 'pinion', solver: 'closed-form-kinematics', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

type MechanismGraphAdapter = (mechanism: MechanismConfig) => MechanismGraph;

export const MECHANISM_GRAPH_ADAPTERS = Object.freeze({
    crank: crankMechanismGraph,
    '4bar': fourBarMechanismGraph,
    piston: pistonMechanismGraph,
    yoke: yokeMechanismGraph,
    'quick-return': quickReturnMechanismGraph,
    '5bar': fiveBarMechanismGraph,
    '6bar': sixBarMechanismGraph,
    cam: camMechanismGraph,
    'rack-pinion': rackPinionMechanismGraph,
    gear: gearMechanismGraph,
    gear_linkage: gearLinkageMechanismGraph,
    planetary_gear: planetaryGearMechanismGraph
} satisfies Record<MechanismType, MechanismGraphAdapter>);

export const MECHANISM_GRAPH_ADAPTER_TYPES = Object.freeze(Object.keys(MECHANISM_GRAPH_ADAPTERS) as MechanismType[]);

export const mechanismGraphForMechanism = (mechanism: MechanismConfig): MechanismGraph => {
    return MECHANISM_GRAPH_ADAPTERS[mechanism.type](mechanism);
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

const VALID_GRAPH_SOURCES: readonly MechanismGraphSource[] = ['family-definition', 'free-graph-authoring', 'imported-graph'];
const VALID_GRAPH_SOLVERS: readonly MechanismGraphSolver[] = ['closed-form-kinematics', 'constraint-graph'];

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

const positionedDistanceTolerance = (expected: number) =>
    Math.max(MECHANISM_GRAPH_POSITIONED_DISTANCE_TOLERANCE, Math.abs(expected) * 1e-9);

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
    if (graph.source === 'family-definition' && !graph.mechanismType) diagnostics.push({ severity: 'error', message: 'Family graph imported from MechanismConfig must preserve mechanismType.' });

    const nodeIds = graph.nodes.map(node => node.id);
    duplicateIds(nodeIds).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph node id: ${id}.` }));
    duplicateIds(graph.constraints.map(constraint => constraint.id)).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph constraint id: ${id}.` }));
    duplicateIds(graph.drivers.map(driver => driver.id)).forEach(id => diagnostics.push({ severity: 'error', message: `Duplicate graph driver id: ${id}.` }));

    const nodeIdSet = new Set(nodeIds);
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    graph.nodes.forEach(node => {
        if (!node.id || !node.label || !node.role) diagnostics.push({ severity: 'error', message: `Graph node ${node.id || '(missing)'} is missing id, label, or role.` });
        finitePointDiagnostic(diagnostics, `node ${node.id}.position`, node.position);
        finiteDiagnostic(diagnostics, `node ${node.id}.value`, node.value);
        finiteSamplesDiagnostic(diagnostics, `node ${node.id}.samples`, node.samples);
    });
    const fabricatedOwnerRoles = new Set<MechanismGraphNodeRole>(['link', 'rigid-part', 'gear', 'ring-gear', 'cam', 'follower', 'guide', 'slider']);
    graph.nodes.forEach(node => {
        if ('ownerPartId' in node && node.ownerPartId !== undefined) {
            if (node.fabricated !== false) diagnostics.push({ severity: 'error', message: `Graph owned pivot ${node.id} must be nonfabricated.` });
            if (!node.position) diagnostics.push({ severity: 'error', message: `Graph owned pivot ${node.id} needs a position.` });
            const owner = nodeById.get(node.ownerPartId);
            if (!owner) diagnostics.push({ severity: 'error', message: `Graph owned pivot ${node.id} references missing owner ${node.ownerPartId}.` });
            else if (owner.id === node.id || owner.fabricated === false || !fabricatedOwnerRoles.has(owner.role)) diagnostics.push({ severity: 'error', message: `Graph owned pivot ${node.id} has unsupported owner ${owner.id}.` });
            const pins = graph.constraints.filter(constraint => constraint.role === 'pin-joint' && constraint.nodes.includes(node.id));
            if (pins.length !== 1) diagnostics.push({ severity: 'error', message: `Graph owned pivot ${node.id} must participate in exactly one pin.` });
        }
    });

    graph.constraints.forEach(constraint => {
        if (!constraint.id || !constraint.label || !constraint.role) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id || '(missing)'} is missing id, label, or role.` });
        if (!constraint.nodes.length) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} has no nodes.` });
        if (!constraintNodeCountValid(constraint)) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} has invalid ${constraint.role} node count.` });
        constraint.nodes.forEach(nodeId => {
            if (!nodeIdSet.has(nodeId)) diagnostics.push({ severity: 'error', message: `Graph constraint ${constraint.id} references missing node ${nodeId}.` });
        });
        if (constraint.role === 'distance') {
            const fabricatedPartNodeId = constraint.fabricatedPartNodeId;
            const fabricatedPart = fabricatedPartNodeId ? nodeById.get(fabricatedPartNodeId) : undefined;
            if (!fabricatedPartNodeId) diagnostics.push({ severity: 'error', message: `Graph distance constraint ${constraint.id} is missing fabricatedPartNodeId.` });
            else if (!fabricatedPart) diagnostics.push({ severity: 'error', message: `Graph distance constraint ${constraint.id} references missing fabricated part ${fabricatedPartNodeId}.` });
            else if (fabricatedPart.fabricated === false || (fabricatedPart.role !== 'link' && fabricatedPart.role !== 'rigid-part')) {
                diagnostics.push({ severity: 'error', message: `Graph distance constraint ${constraint.id} references unsupported fabricated part ${fabricatedPartNodeId}.` });
            }
        } else {
            const invalidFabricatedPartNodeId = (constraint as MechanismConstraintBase & { fabricatedPartNodeId?: unknown }).fabricatedPartNodeId;
            if (invalidFabricatedPartNodeId !== undefined) diagnostics.push({ severity: 'error', message: `Graph ${constraint.role} constraint ${constraint.id} cannot own fabricated part ${String(invalidFabricatedPartNodeId)}.` });
        }
        finiteDiagnostic(diagnostics, `constraint ${constraint.id}.value`, constraint.value);
        finiteDiagnostic(diagnostics, `constraint ${constraint.id}.angle`, constraint.angle);
        finitePointDiagnostic(diagnostics, `constraint ${constraint.id}.vector`, constraint.vector);
        finiteSamplesDiagnostic(diagnostics, `constraint ${constraint.id}.samples`, constraint.samples);
        if (constraint.role === 'pin-joint' && constraint.nodes.length === 2) {
            const [a, b] = constraint.nodes.map(nodeId => nodeById.get(nodeId));
            if (a?.position && b?.position) {
                const actual = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
                if (actual > MECHANISM_GRAPH_POSITIONED_DISTANCE_TOLERANCE) diagnostics.push({ severity: 'error', message: `Graph pin-joint ${constraint.id} endpoints are not coincident.` });
            }
        }
        if ((constraint.role === 'distance' || constraint.role === 'gear-mesh') && constraint.nodes.length === 2 && Number.isFinite(constraint.value)) {
            const [start, end] = constraint.nodes.map(nodeId => nodeById.get(nodeId)?.position);
            if (start && end
                && Number.isFinite(start.x) && Number.isFinite(start.y)
                && Number.isFinite(end.x) && Number.isFinite(end.y)) {
                const expected = Math.abs(constraint.value as number);
                const actual = Math.hypot(end.x - start.x, end.y - start.y);
                const tolerance = positionedDistanceTolerance(expected);
                if (Math.abs(actual - expected) > tolerance) {
                    diagnostics.push({
                        severity: 'error',
                        message: `Graph ${constraint.role} constraint ${constraint.id} positions are ${actual} apart but value is ${expected} (tolerance ${tolerance}).`
                    });
                }
            }
        }
    });
    const distanceOwnerIds = graph.constraints
        .filter((constraint): constraint is Extract<MechanismConstraint, { role: 'distance' }> => constraint.role === 'distance')
        .map(constraint => constraint.fabricatedPartNodeId)
        .filter(Boolean);
    duplicateIds(distanceOwnerIds).forEach(id => diagnostics.push({ severity: 'error', message: `Fabricated graph part ${id} is owned by multiple distance constraints.` }));
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

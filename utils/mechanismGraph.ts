import type { JointState, MechanismConfig, MechanismType, Point } from '../types';
import {
    fabricationRenderPlanForMechanism,
    prefabAssemblySteps,
    sampleFeasibleRange,
    validateMechanismPreviewReadiness,
    type FabricationFeasibleRange
} from './fabrication';
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
    | 'moving-joint'
    | 'link'
    | 'gear'
    | 'ring-gear'
    | 'cam'
    | 'follower'
    | 'guide'
    | 'slider'
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
    | 'output-offset';

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
};

export type MechanismConstraint = {
    id: string;
    label: string;
    role: MechanismConstraintRole;
    nodes: string[];
    value?: number;
};

export type MechanismDriver = {
    id: string;
    label: string;
    role: 'rotary-input' | 'derived-output';
    nodeId: string;
    solver: 'legacy-closed-form';
    ratio?: number;
};

export type MechanismFamilyDefinition = {
    id: MechanismType | 'legacy-diagnostic';
    legacyType: MechanismType;
    firstCompilerTarget: boolean;
    authoringMode: 'classroom-preset' | 'advanced-diagnostic';
};

export type MechanismGraph = {
    version: typeof MECHANISM_GRAPH_IR_VERSION;
    id: string;
    mechanismId: string;
    legacyType: MechanismType;
    source: 'derived-legacy-adapter';
    family: MechanismFamilyDefinition;
    solver: 'legacy-closed-form';
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

export type CompiledMechanism = {
    graph: MechanismGraph;
    motionSamples: MechanismGraphMotionSample[];
    feasibleRange: FabricationFeasibleRange;
    readinessErrors: string[];
    fabrication: {
        renderPlanSource: 'fabricationRenderPlanForMechanism';
        assemblyPlanSource: 'prefabAssemblySteps';
        assemblyBoardCoordinate: string;
        assemblyStepCount: number;
        assemblyStepLabels: string[];
        layerCount: number;
        stackSummary: string;
        roleSummary: string;
        validationErrors: string[];
    };
};

const FIRST_COMPILER_TARGETS = new Set<MechanismType>(['4bar', 'gear']);
const CLASSROOM_PRESET_TARGETS = new Set<MechanismType>(['4bar', 'piston', 'cam', 'gear', 'gear_linkage', 'planetary_gear']);
const toRad = (degrees = 0) => (degrees * Math.PI) / 180;

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

const mechanismFamily = (type: MechanismType): MechanismFamilyDefinition => ({
    id: type,
    legacyType: type,
    firstCompilerTarget: FIRST_COMPILER_TARGETS.has(type),
    authoringMode: CLASSROOM_PRESET_TARGETS.has(type) ? 'classroom-preset' : 'advanced-diagnostic'
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
            { id: 'effector-offset', label: 'Target point rides on coupler', role: 'output-offset', nodes: ['j1', 'j2', 'effector'], value: mechanism.couplerPointDist }
        ],
        drivers: [{ id: 'input-rotation', label: 'Turn input pivot', role: 'rotary-input', nodeId: 'p1', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const legacyGearToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
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
            { id: 'output-offset', label: 'Target point rides on output gear', role: 'output-offset', nodes: ['output-pin', 'effector'], value: mechanism.couplerPointDist }
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
            { id: 'effector-offset', label: 'Target point rides on slider rod', role: 'output-offset', nodes: ['j1', 'slider', 'effector'], value: mechanism.couplerPointDist }
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
            { id: 'cam-disk', label: 'Cam disk', role: 'cam', value: mechanism.crankLength },
            { id: 'follower-head', label: 'Rounded follower head', role: 'follower', value: mechanism.sliderOffset },
            { id: 'follower-guide', label: 'Vertical guide cartridge', role: 'guide' },
            { id: 'effector', label: 'Motion target point', role: 'output-point' }
        ],
        constraints: [
            ...fixedBoardConstraints('cam-axle', 'Cam axle'),
            ...fixedBoardConstraints('guide-anchor', 'Follower guide mount'),
            { id: 'cam-follower-contact', label: 'Follower rests on cam edge', role: 'contact', nodes: ['cam-disk', 'follower-head'], value: mechanism.sliderOffset },
            { id: 'follower-guide-slide', label: 'Follower moves only along the guide', role: 'prismatic', nodes: ['follower-head', 'follower-guide'] },
            { id: 'effector-offset', label: 'Target point rides on follower', role: 'output-offset', nodes: ['follower-head', 'effector'], value: mechanism.couplerPointDist }
        ],
        drivers: [{ id: 'cam-rotation', label: 'Turn cam axle', role: 'rotary-input', nodeId: 'cam-axle', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }],
        diagnostics: []
    };
};

export const legacyGearLinkageToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const gearGraph = legacyGearToMechanismGraph({ ...mechanism, type: 'gear' });
    const linkLength = Math.max(1, Math.abs(mechanism.couplerLength));
    return {
        ...gearGraph,
        family: mechanismFamily('gear_linkage'),
        legacyType: mechanism.type,
        nodes: [
            ...gearGraph.nodes,
            { id: 'drive-crank-link', label: 'Drive crank link', role: 'link', value: mechanism.couplerPointDist },
            { id: 'output-crank-link', label: 'Output crank link', role: 'link', value: mechanism.couplerPointDist },
            { id: 'connector-link-a', label: 'Drive connector link', role: 'link', value: linkLength },
            { id: 'connector-link-b', label: 'Output connector link', role: 'link', value: linkLength }
        ],
        constraints: [
            ...gearGraph.constraints,
            { id: 'drive-connector-length', label: 'Drive linkage length', role: 'distance', nodes: ['drive-pin', 'effector'], value: linkLength },
            { id: 'output-connector-length', label: 'Output linkage length', role: 'distance', nodes: ['output-pin', 'effector'], value: linkLength },
            { id: 'connector-output', label: 'Target point is the shared linkage connector', role: 'output-offset', nodes: ['drive-pin', 'output-pin', 'effector'], value: linkLength }
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
            fixedBoard('sun-gear', 'Sun gear axle', p1),
            fixedBoard('ring-gear', 'Fixed ring gear', p1),
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
            { id: 'carrier-output', label: 'Target point rides on carrier', role: 'output-offset', nodes: ['carrier', 'output-point'], value: mechanism.couplerPointDist }
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
    solver: 'legacy-closed-form',
    persisted: false,
    nodes: [{ id: 'legacy-mechanism', label: `${mechanism.type} legacy mechanism`, role: 'generated-point' }],
    constraints: [],
    drivers: [],
    diagnostics: [{
        severity: 'info',
        message: `${mechanism.type} compiles as a diagnostic graph until a fabrication recipe compiler owns this family.`
    }]
});

export const mechanismGraphForMechanism = (mechanism: MechanismConfig): MechanismGraph => {
    if (mechanism.type === '4bar') return legacyFourBarToMechanismGraph(mechanism);
    if (mechanism.type === 'piston') return legacyPistonToMechanismGraph(mechanism);
    if (mechanism.type === 'cam') return legacyCamToMechanismGraph(mechanism);
    if (mechanism.type === 'gear') return legacyGearToMechanismGraph(mechanism);
    if (mechanism.type === 'gear_linkage') return legacyGearLinkageToMechanismGraph(mechanism);
    if (mechanism.type === 'planetary_gear') return legacyPlanetaryGearToMechanismGraph(mechanism);
    return unsupportedLegacyMechanismGraph(mechanism);
};

export const sampleMechanismGraphMotion = (mechanism: MechanismConfig, angle: number): MechanismGraphMotionSample => ({
    angle,
    state: calculateLinkage(mechanism, angle),
    source: 'calculateLinkage'
});

export const compileMechanismGraphSidecar = (
    mechanism: MechanismConfig,
    angles: number[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    feasibleSamples = 24
): CompiledMechanism => {
    const graph = mechanismGraphForMechanism(mechanism);
    const renderPlan = fabricationRenderPlanForMechanism(mechanism);
    const assemblyBoardCoordinate = mechanism.fabricationMetadata?.boardCoordinate ?? 'H8';
    const assemblySteps = prefabAssemblySteps(mechanism, assemblyBoardCoordinate);
    return {
        graph,
        motionSamples: angles.map(angle => sampleMechanismGraphMotion(mechanism, angle)),
        feasibleRange: sampleFeasibleRange(mechanism, feasibleSamples),
        readinessErrors: validateMechanismPreviewReadiness(mechanism),
        fabrication: {
            renderPlanSource: 'fabricationRenderPlanForMechanism',
            assemblyPlanSource: 'prefabAssemblySteps',
            assemblyBoardCoordinate,
            assemblyStepCount: assemblySteps.length,
            assemblyStepLabels: assemblySteps.map(step => step.label),
            layerCount: renderPlan.layers.length,
            stackSummary: renderPlan.stackSummary,
            roleSummary: renderPlan.roleSummary,
            validationErrors: renderPlan.validationErrors
        }
    };
};

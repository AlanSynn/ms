import type { JointState, MechanismConfig, MechanismType, Point } from '../types';
import {
    fabricationRenderPlanForMechanism,
    sampleFeasibleRange,
    validateMechanismPreviewReadiness,
    type FabricationFeasibleRange
} from './fabrication';
import {
    calculateLinkage,
    gearTrainCenters,
    gearTrainOutputRatio,
    gearTrainPitchRadii
} from './kinematics';

export const MECHANISM_GRAPH_IR_VERSION = 1;

export type MechanismGraphNodeRole =
    | 'board-anchor'
    | 'moving-joint'
    | 'link'
    | 'gear'
    | 'output-point'
    | 'generated-point';

export type MechanismConstraintRole =
    | 'fixed-to-board'
    | 'board-snap'
    | 'pin-joint'
    | 'distance'
    | 'gear-mesh'
    | 'phase'
    | 'output-offset';

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
    id: '4bar' | 'gear' | 'legacy-unsupported';
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
        layerCount: number;
        stackSummary: string;
        roleSummary: string;
        validationErrors: string[];
    };
};

const fixedBoard = (id: string, label: string, position: Point): MechanismGraphNode => ({
    id,
    label,
    role: 'board-anchor',
    position
});

const mechanismFamily = (type: MechanismType): MechanismFamilyDefinition => ({
    id: type === '4bar' || type === 'gear' ? type : 'legacy-unsupported',
    legacyType: type,
    firstCompilerTarget: type === '4bar' || type === 'gear',
    authoringMode: type === '4bar' || type === 'gear' ? 'classroom-preset' : 'advanced-diagnostic'
});

export const legacyFourBarToMechanismGraph = (mechanism: MechanismConfig): MechanismGraph => {
    const p1 = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    const groundAngle = ((mechanism.groundAngle ?? 0) * Math.PI) / 180;
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
            { id: 'p1-fixed', label: 'Input pivot stays on the board', role: 'fixed-to-board', nodes: ['p1'] },
            { id: 'p2-fixed', label: 'Output pivot stays on the board', role: 'fixed-to-board', nodes: ['p2'] },
            { id: 'p1-board-snap', label: 'Input pivot snaps to pegboard', role: 'board-snap', nodes: ['p1'] },
            { id: 'p2-board-snap', label: 'Output pivot snaps to pegboard', role: 'board-snap', nodes: ['p2'] },
            { id: 'input-length', label: 'Input link length', role: 'distance', nodes: ['p1', 'j1'], value: mechanism.crankLength },
            { id: 'coupler-length', label: 'Coupler link length', role: 'distance', nodes: ['j1', 'j2'], value: mechanism.couplerLength },
            { id: 'output-length', label: 'Output link length', role: 'distance', nodes: ['p2', 'j2'], value: mechanism.rockerLength },
            { id: 'effector-offset', label: 'Target point rides on coupler', role: 'output-offset', nodes: ['j1', 'j2', 'effector'], value: mechanism.couplerPointDist }
        ],
        drivers: [{ id: 'input-rotation', label: 'Turn input pivot', role: 'rotary-input', nodeId: 'p1', solver: 'legacy-closed-form', ratio: mechanism.speed1 ?? 1 }]
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
    const boardConstraints: MechanismConstraint[] = gearNodes.flatMap(node => ([
        { id: `${node.id}-fixed`, label: `${node.label} axle stays on the board`, role: 'fixed-to-board' as const, nodes: [node.id] },
        { id: `${node.id}-board-snap`, label: `${node.label} axle snaps to pegboard`, role: 'board-snap' as const, nodes: [node.id] }
    ]));
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
        ]
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
    drivers: []
});

export const mechanismGraphForMechanism = (mechanism: MechanismConfig): MechanismGraph => {
    if (mechanism.type === '4bar') return legacyFourBarToMechanismGraph(mechanism);
    if (mechanism.type === 'gear') return legacyGearToMechanismGraph(mechanism);
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
    return {
        graph,
        motionSamples: angles.map(angle => sampleMechanismGraphMotion(mechanism, angle)),
        feasibleRange: sampleFeasibleRange(mechanism, feasibleSamples),
        readinessErrors: validateMechanismPreviewReadiness(mechanism),
        fabrication: {
            renderPlanSource: 'fabricationRenderPlanForMechanism',
            layerCount: renderPlan.layers.length,
            stackSummary: renderPlan.stackSummary,
            roleSummary: renderPlan.roleSummary,
            validationErrors: renderPlan.validationErrors
        }
    };
};

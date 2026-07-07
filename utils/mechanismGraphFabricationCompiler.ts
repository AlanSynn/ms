import type { FabricationPartRequirement, FabricationRecipe, PhysicalKitSettings, Point } from '../types';
import { boardToScene, defaultPhysicalKit, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { closePhysicalValue, physicalTolerance } from './fabricationReadiness';
import {
    FABRICATION_SPACER_SPEC,
    fabricationGearSpecForPitchRadius,
    fabricationLinkageSpecForCells,
    fabricationPartDisplayLabel
} from './fabricationContract';
import {
    FABRICATION_RENDER_BASE_Z,
    FABRICATION_RENDER_LAYER_Z_STEP,
    type FabricationRenderKind,
    type FabricationRenderLayer,
    type FabricationRenderPlan
} from './fabricationRenderPlan';
import { assemblyStepFingerprint, type AssemblyStepFingerprint } from './fabricationAssemblyFingerprint';
import { fabricationBaseLayer, STACK_COLORS, type FabricationStackLayer } from './fabricationStackModel';
import { validateMechanismGraph, type MechanismConstraintRole, type MechanismGraph, type MechanismGraphNode, type MechanismGraphNodeRole } from './mechanismGraph';

export type GraphRecipeCompilerSource = 'compileGraphFabricationRecipe';

export type GraphAssemblyStepFingerprint = AssemblyStepFingerprint;

export type AuthoredGraphFabricationResult = {
    recipeCompilerSource: GraphRecipeCompilerSource;
    buildable: boolean;
    blocker?: 'Graph invalid' | 'Recipe missing';
    recipe?: FabricationRecipe;
    renderPlan?: FabricationRenderPlan;
    assemblyStepFingerprints?: GraphAssemblyStepFingerprint[];
};

const graphPartRoleForNode = (role: MechanismGraph['nodes'][number]['role']): FabricationStackLayer['role'] | null => {
    if (role === 'link' || role === 'rigid-part') return 'linkage';
    if (role === 'gear' || role === 'ring-gear') return 'gear';
    if (role === 'cam') return 'cam';
    if (role === 'guide' || role === 'slider') return 'guide';
    if (role === 'follower' || role === 'output-point' || role === 'generated-point') return 'follower';
    if (role === 'spacer') return 'spacer';
    if (role === 'fastener') return 'clip';
    return null;
};

const renderKindForGraphRole = (role: FabricationStackLayer['role']): FabricationRenderKind => role === 'base' ? 'base' : role;

const boardSnapTolerance = (kit: PhysicalKitSettings) => physicalTolerance(kit.gridPitchMm * SCENE_PX_PER_MM);

const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const boardCoordinateForPoint = (point: Point | undefined, kit: PhysicalKitSettings) => {
    if (!point) return null;
    const board = sceneToBoardRaw(point, kit);
    const sceneAnchor = board.valid ? boardToScene(board.col, board.row, kit) : point;
    const snapDistance = board.valid ? distanceBetween(point, sceneAnchor) : Number.POSITIVE_INFINITY;
    return { board, sceneAnchor, coordinate: board.label, snapDistance, snapped: board.valid && snapDistance <= boardSnapTolerance(kit) };
};

const BOARD_MOUNTED_GRAPH_PART_ROLES = new Set<MechanismGraph['nodes'][number]['role']>(['gear', 'ring-gear', 'cam', 'guide']);
const GRAPH_FABRICATION_PART_ROLES = new Set<MechanismGraphNodeRole>([
    'rigid-part',
    'link',
    'gear',
    'ring-gear',
    'cam',
    'follower',
    'guide',
    'slider',
    'spacer',
    'fastener'
]);
const FABRICATED_CONSTRAINT_ROLES = new Set<MechanismConstraintRole>(['distance', 'gear-mesh', 'contact', 'prismatic', 'pin-joint']);

const stack = (...items: Array<{ label: string; role: string; part?: string }>): FabricationRecipe['assemblySteps'][number]['stack'] =>
    items.map((item, index) => ({ order: index + 1, ...item }));

const linkageSpecForGraphNode = (node: MechanismGraphNode) => {
    const cells = Math.max(2, Math.round(Math.abs(node.value ?? 0) / Math.max(1, SCENE_PX_PER_MM * 20)));
    return fabricationLinkageSpecForCells(cells);
};

const graphPartLabelForNode = (node: MechanismGraphNode) => {
    if (node.role === 'gear' || node.role === 'ring-gear') {
        return fabricationGearSpecForPitchRadius(Math.abs(node.value ?? 30) / SCENE_PX_PER_MM).label;
    }
    if (node.role === 'link' || node.role === 'rigid-part') return node.label || linkageSpecForGraphNode(node).label;
    return node.label;
};

const graphPartKeyForNode = (node: MechanismGraphNode, role: FabricationStackLayer['role']) => {
    if (node.role === 'link' || node.role === 'rigid-part') return `linkages:${linkageSpecForGraphNode(node).key}`;
    if (node.role === 'gear' || node.role === 'ring-gear') {
        return `gears:${fabricationGearSpecForPitchRadius(Math.abs(node.value ?? 30) / SCENE_PX_PER_MM).key}`;
    }
    return `${role}s:${node.id}`;
};

const requirementCategoryForPart = (part: string | undefined, _role: string) => {
    if (!part) return null;
    const lowerPart = part.toLowerCase();
    if (lowerPart.startsWith('linkages:')) return 'linkage';
    if (lowerPart.startsWith('gears:')) return 'gear';
    if (lowerPart.startsWith('cams:')) return 'cam';
    if (lowerPart.startsWith('guides:')) return 'guide';
    if (lowerPart.startsWith('followers:')) return 'follower';
    if (lowerPart.startsWith('spacers:')) return 'spacer';
    if (lowerPart.startsWith('hardware:')) return 'fastener';
    return null;
};

const requirementNameForStackItem = (item: AssemblyStackItem) => {
    const part = item.part ?? '';
    const linkageMatch = part.match(/^linkages:linkage-(\d+)-cell$/);
    if (linkageMatch) return fabricationLinkageSpecForCells(Number(linkageMatch[1])).label;
    if (part === `spacers:${FABRICATION_SPACER_SPEC.key}`) return FABRICATION_SPACER_SPEC.label;
    if (part.startsWith('hardware:paper-fastener')) return 'Paper fastener';
    return item.label;
};

const requirementKeyForStackItem = (item: AssemblyStackItem, category: string) => {
    if (item.part) return item.part;
    return `${category}:${item.label}`;
};

const requiredPartsFromAssemblySteps = (assemblySteps: FabricationRecipe['assemblySteps']): FabricationPartRequirement[] => {
    const counts = new Map<string, FabricationPartRequirement>();
    assemblySteps.forEach(step => (step.stack ?? []).forEach(item => {
        const category = requirementCategoryForPart(item.part, item.role);
        if (!category) return;
        const key = requirementKeyForStackItem(item, category);
        const previous = counts.get(key);
        counts.set(key, {
            ...previous,
            name: previous?.name ?? requirementNameForStackItem(item),
            quantity: (previous?.quantity ?? 0) + 1,
            category,
            key: item.part?.split(':')[1] ?? previous?.key ?? key,
            part: item.part ?? previous?.part
        });
    }));
    return [...counts.values()].filter(part => part.quantity > 0);
};

type AssemblyStackItem = NonNullable<FabricationRecipe['assemblySteps'][number]['stack']>[number];

const renderRoleForAssemblyStackItem = (item: AssemblyStackItem): FabricationStackLayer['role'] | null => {
    const role = item.role.toLowerCase();
    const label = item.label.toLowerCase();
    const part = item.part?.toLowerCase() ?? '';
    if (role === 'spacer' || part.startsWith('spacers:') || label.includes('spacer')) return 'spacer';
    if (role === 'paper-fastener' || role === 'clip' || part.startsWith('hardware:paper-fastener')) return 'clip';
    if (role !== 'moving-part') return null;
    if (part.startsWith('linkages:') || label.includes('link')) return 'linkage';
    if (part.startsWith('gears:') || label.includes('gear')) return 'gear';
    if (part.startsWith('cams:') || label.includes('cam')) return 'cam';
    if (part.startsWith('guides:') || label.includes('guide')) return 'guide';
    if (part.startsWith('followers:') || label.includes('follower') || label.includes('slider')) return 'follower';
    return 'linkage';
};

const graphRenderPlan = (assemblySteps: FabricationRecipe['assemblySteps'], validationErrors: string[]): FabricationRenderPlan => {
    const stackLayers: FabricationStackLayer[] = assemblySteps.flatMap(step => (step.stack ?? []).flatMap(item => {
        const role = renderRoleForAssemblyStackItem(item);
        return role ? [{ label: item.label, role, color: STACK_COLORS[role] }] : [];
    }));
    const layers = stackLayers.map((item, index): FabricationRenderLayer => ({
        ...item,
        source: 'mechanism-graph',
        stackIndex: index,
        occurrence: stackLayers.slice(0, index).filter(previous => previous.role === item.role).length,
        z: FABRICATION_RENDER_BASE_Z + index * FABRICATION_RENDER_LAYER_Z_STEP,
        renderKind: renderKindForGraphRole(item.role)
    }));
    return {
        base: { ...fabricationBaseLayer(), source: 'mechanism-graph', stackIndex: -1, occurrence: 0, z: 0, renderKind: 'base' },
        layers,
        stackSummary: layers.map(item => item.label).join(' → '),
        roleSummary: layers.map(item => item.role).join('>'),
        occurrenceSummary: layers.map(item => `${item.role}#${item.occurrence}:${item.label}`).join('>'),
        colorSummary: layers.map(item => item.color).join(','),
        zSummary: layers.map(item => item.z.toFixed(2)).join(','),
        validationErrors
    };
};

const distanceConstraintHasExplicitPart = (
    constraint: MechanismGraph['constraints'][number],
    nodeById: Map<string, MechanismGraphNode>,
    explicitPartNodes: MechanismGraphNode[]
) => {
    if (constraint.nodes.some(nodeId => {
        const role = nodeById.get(nodeId)?.role;
        return role === 'link' || role === 'rigid-part';
    })) return true;

    const [startNode, endNode] = constraint.nodes.slice(0, 2).map(nodeId => nodeById.get(nodeId));
    const midpoint = startNode?.position && endNode?.position
        ? { x: (startNode.position.x + endNode.position.x) / 2, y: (startNode.position.y + endNode.position.y) / 2 }
        : null;
    const expectedLength = Math.abs(constraint.value ?? 0);
    return explicitPartNodes.some(node => {
        if (!Number.isFinite(node.value) || !closePhysicalValue(Math.abs(node.value ?? 0), expectedLength)) return false;
        if (!midpoint || !node.position) return false;
        return distanceBetween(node.position, midpoint) <= physicalTolerance(expectedLength || SCENE_PX_PER_MM * 20);
    });
};

export const compileGraphFabricationRecipe = (graph: MechanismGraph, kit = defaultPhysicalKit()): AuthoredGraphFabricationResult => {
    const validation = validateMechanismGraph(graph);
    const validationErrors = validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message);
    if (validationErrors.length) {
        return { recipeCompilerSource: 'compileGraphFabricationRecipe', buildable: false, blocker: 'Graph invalid' };
    }
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const boardAnchors = graph.nodes.filter(node => node.role === 'board-anchor');
    const primaryAnchor = boardAnchors.map(node => boardCoordinateForPoint(node.position, kit)).find(placement => placement?.snapped);
    const explicitPartNodes = graph.nodes.filter(node => (node.role === 'link' || node.role === 'rigid-part') && Number.isFinite(node.value));
    const synthesizedDistanceConstraints = graph.constraints
        .filter(constraint => constraint.role === 'distance' && Number.isFinite(constraint.value))
        .filter(constraint => !distanceConstraintHasExplicitPart(constraint, nodeById, explicitPartNodes));
    const hasFabricatedMovingPart = graph.nodes.some(node => GRAPH_FABRICATION_PART_ROLES.has(node.role) && !['fastener', 'spacer'].includes(node.role))
        || synthesizedDistanceConstraints.length > 0;
    const boardAnchorsArePlaced = boardAnchors.every(node => boardCoordinateForPoint(node.position, kit)?.snapped);
    const fabricatedPartNodesArePlaced = graph.nodes
        .filter(node => GRAPH_FABRICATION_PART_ROLES.has(node.role))
        .every(node => boardCoordinateForPoint(node.position, kit)?.snapped);
    const fabricatedConstraintNodeIds = new Set(graph.constraints
        .filter(constraint => FABRICATED_CONSTRAINT_ROLES.has(constraint.role))
        .flatMap(constraint => constraint.nodes));
    const fabricatedConstraintNodesArePlaced = [...fabricatedConstraintNodeIds]
        .every(nodeId => boardCoordinateForPoint(nodeById.get(nodeId)?.position, kit)?.snapped);
    if (!primaryAnchor || !boardAnchorsArePlaced || !fabricatedPartNodesArePlaced || !fabricatedConstraintNodesArePlaced || !hasFabricatedMovingPart) {
        return { recipeCompilerSource: 'compileGraphFabricationRecipe', buildable: false, blocker: 'Recipe missing' };
    }
    const boardCoordinateForNode = (nodeId: string) => {
        const node = nodeById.get(nodeId);
        return boardCoordinateForPoint(node?.position, kit)?.coordinate ?? node?.label ?? nodeId;
    };
    const coordRoleForNode = (nodeId: string, fallback: string) => {
        const node = nodeById.get(nodeId);
        if (!node) return fallback;
        if (node.role === 'board-anchor') return 'board';
        return boardCoordinateForPoint(node.position, kit)?.snapped ? 'graph_reference' : fallback;
    };
    const boardSteps = boardAnchors.map((node, index) => {
        const coord = boardCoordinateForNode(node.id);
        return {
            index: index + 1,
            label: `Pin ${node.label}`,
            role: 'place-fastener',
            boardCoordinate: coord,
            zMm: 0,
            coords: [coord],
            coordRoles: ['board'],
            action: 'place-fastener',
            instruction: `Place ${node.label} at ${coord}.`,
            check: 'The pin stays fixed on the board.',
            stack: stack(
                { label: `Board hole ${coord}`, role: 'board' },
                { label: 'Paper fastener', role: 'paper-fastener', part: 'hardware:paper-fastener' },
                { label: 'Open tabs behind board', role: 'fastener-tabs' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const distanceSteps = synthesizedDistanceConstraints.map((constraint, index) => {
        const cells = Math.max(2, Math.round(Math.abs(constraint.value ?? 0) / Math.max(1, SCENE_PX_PER_MM * 20)));
        const spec = fabricationLinkageSpecForCells(cells);
        const coords = constraint.nodes.slice(0, 2).map(boardCoordinateForNode);
        return {
            index: boardSteps.length + index + 1,
            label: `Add ${constraint.label}`,
            role: 'add-part',
            boardCoordinate: coords[0] ?? primaryAnchor.coordinate,
            zMm: Number((FABRICATION_RENDER_BASE_Z * 10 + index * FABRICATION_RENDER_LAYER_Z_STEP * 10).toFixed(1)),
            coords,
            coordRoles: constraint.nodes.slice(0, 2).map((nodeId, coordIndex) => coordRoleForNode(nodeId, coordIndex === 0 ? 'board' : 'link_end_reference')),
            action: 'stack-layer',
            instruction: `Connect ${fabricationPartDisplayLabel(spec.label)} between ${coords.join(' and ')}.`,
            check: 'The link can swing without rubbing.',
            stack: stack(
                { label: `Start hole ${coords[0] ?? primaryAnchor.coordinate}`, role: 'board' },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}` },
                { label: spec.label, role: 'moving-part', part: `linkages:${spec.key}` },
                { label: 'Paper fastener', role: 'paper-fastener', part: 'hardware:paper-fastener' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const partSteps = graph.nodes.filter(node => GRAPH_FABRICATION_PART_ROLES.has(node.role)).map((node, index) => {
        const coord = boardCoordinateForNode(node.id);
        const role = graphPartRoleForNode(node.role) ?? 'linkage';
        const label = graphPartLabelForNode(node);
        return {
            index: boardSteps.length + distanceSteps.length + index + 1,
            label: `Add ${node.label}`,
            role: 'add-part',
            boardCoordinate: coord,
            zMm: Number((FABRICATION_RENDER_BASE_Z * 10 + (distanceSteps.length + index) * FABRICATION_RENDER_LAYER_Z_STEP * 10).toFixed(1)),
            coords: [coord],
            coordRoles: [BOARD_MOUNTED_GRAPH_PART_ROLES.has(node.role) ? 'board' : 'graph_reference'],
            action: 'stack-layer',
            instruction: `Place ${fabricationPartDisplayLabel(label)} at ${coord}.`,
            check: role === 'gear' ? 'The gear spins without rubbing.' : 'The part moves freely.',
            stack: stack(
                { label: `Graph point ${coord}`, role: node.role === 'gear' || node.role === 'ring-gear' ? 'board' : 'graph-reference' },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}` },
                { label, role: 'moving-part', part: graphPartKeyForNode(node, role) },
                { label: 'Paper fastener', role: 'paper-fastener', part: 'hardware:paper-fastener' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const assemblySteps = [...boardSteps, ...distanceSteps, ...partSteps].map((step, index) => ({ ...step, index: index + 1 }));
    const requiredParts = requiredPartsFromAssemblySteps(assemblySteps);
    const renderPlan = graphRenderPlan(assemblySteps, validationErrors);
    const recipe: FabricationRecipe = {
        mechanismId: graph.mechanismId,
        type: 'graph',
        graphFamilyId: graph.family.id,
        graphSource: graph.source,
        compilerSource: 'mechanismCompiler',
        boardCoordinate: primaryAnchor.coordinate,
        board: primaryAnchor.board,
        sceneAnchor: primaryAnchor.sceneAnchor,
        offsetFromBoardMm: { x: 0, y: 0 },
        requiredParts,
        steps: [
            `Place graph module at ${primaryAnchor.coordinate}.`,
            `Graph family: ${graph.family.id}.`,
            `Parts: ${requiredParts.map(part => `${fabricationPartDisplayLabel(part.name)} × ${part.quantity}`).join(', ')}.`,
            validationErrors.length ? `Fix: ${validationErrors.join('; ')}` : 'Ready.'
        ],
        assemblySteps,
        warnings: graph.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').map(diagnostic => diagnostic.message)
    };
    return {
        recipeCompilerSource: 'compileGraphFabricationRecipe',
        buildable: true,
        recipe,
        renderPlan,
        assemblyStepFingerprints: assemblySteps.map(assemblyStepFingerprint)
    };
};

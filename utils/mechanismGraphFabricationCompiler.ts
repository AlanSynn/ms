import type { FabricationPartRequirement, FabricationRecipe, PhysicalKitSettings, Point } from '../types';
import { boardToScene, defaultPhysicalKit, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { closePhysicalValue, physicalTolerance } from './fabricationReadiness';
import {
    FABRICATION_GEAR_SPECS,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_SPACER_SPEC,
    fabricationGearSpecForPitchRadius,
    fabricationRingGearSpecForPitchRadius,
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
    blocker?: string;
    recipe?: FabricationRecipe;
    renderPlan: FabricationRenderPlan;
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

const DIMENSIONED_GRAPH_PART_ROLES = new Set<MechanismGraphNodeRole>([
    'rigid-part',
    'link',
    'gear',
    'ring-gear'
]);

const graphNodeIsFabricatedPart = (node: MechanismGraphNode) =>
    node.fabricated !== false && GRAPH_FABRICATION_PART_ROLES.has(node.role);

const FABRICATED_CONSTRAINT_ROLES = new Set<MechanismConstraintRole>(['distance', 'gear-mesh', 'contact', 'prismatic', 'pin-joint']);

const stack = (...items: Array<{ label: string; role: string; part?: string }>): FabricationRecipe['assemblySteps'][number]['stack'] =>
    items.map((item, index) => ({ order: index + 1, ...item }));

const finiteGraphPartValue = (node: MechanismGraphNode) => {
    if (!Number.isFinite(node.value)) throw new Error(`Missing graph part dimension for ${node.id}`);
    return Number(node.value);
};

const selectedLinkageSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const role = node.id === 'input-link'
        ? '4bar.input-joint'
        : node.id === 'output-link'
            ? '4bar.output-joint'
            : undefined;
    const selection = role ? graph.connectionSelectionSummary?.connectionSelections?.[role] : undefined;
    return selection?.kind === 'linkage-hole'
        ? FABRICATION_LINKAGE_SPECS.find(spec => spec.key === selection.linkageKey)
        : undefined;
};

const linkageSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const selected = selectedLinkageSpecForGraphNode(graph, node);
    if (selected) return selected;
    const cells = Math.max(2, Math.round(Math.abs(finiteGraphPartValue(node)) / Math.max(1, SCENE_PX_PER_MM * 20)));
    return fabricationLinkageSpecForCells(cells);
};

const selectedGearSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    if (graph.mechanismType !== 'gear_linkage') return undefined;
    const selections = graph.connectionSelectionSummary?.connectionSelections;
    const selection = node.id === 'gear-0'
        ? selections?.['gear_linkage.drive-pin']
        : selections?.['gear_linkage.output-pin'];
    return selection?.kind === 'gear-attachment-hole' && node.id === `gear-${selection.gearIndex}`
        ? FABRICATION_GEAR_SPECS.find(spec => spec.key === selection.gearKey)
        : undefined;
};

const graphGearSpecForNode = (graph: MechanismGraph, node: MechanismGraphNode) =>
    selectedGearSpecForGraphNode(graph, node)
    ?? fabricationGearSpecForPitchRadius(Math.abs(finiteGraphPartValue(node)) / SCENE_PX_PER_MM);

const graphPartLabelForNode = (node: MechanismGraphNode, graph: MechanismGraph) => {
    const { source } = graph;
    if (node.role === 'ring-gear') {
        const ringLabel = fabricationRingGearSpecForPitchRadius(Math.abs(finiteGraphPartValue(node)) / SCENE_PX_PER_MM).label;
        return source !== 'family-definition' ? node.label || ringLabel : ringLabel;
    }
    if (node.role === 'gear') {
        const gearLabel = graphGearSpecForNode(graph, node).label;
        if (source !== 'family-definition') return node.label || gearLabel;
        const idlerMatch = /^Idler gear\s*(\d+)$/i.exec(node.label);
        if (idlerMatch) return `Idler ${gearLabel} ${idlerMatch[1]}`;
        const roleLabel = node.label.replace(/\b(gear|axle)\b/gi, '').trim();
        return roleLabel ? `${roleLabel} ${gearLabel}` : gearLabel;
    }
    if (node.role === 'link') {
        const holeLabel = fabricationPartDisplayLabel(linkageSpecForGraphNode(graph, node).label);
        if (source !== 'family-definition') return node.label || holeLabel;
        const roleLabel = node.label.replace(/\blink\b/i, '').trim();
        return roleLabel ? `${roleLabel} ${holeLabel}` : holeLabel;
    }
    if (node.role === 'rigid-part') return node.label || fabricationPartDisplayLabel(linkageSpecForGraphNode(graph, node).label);
    return node.label;
};

const graphPartKeyForNode = (node: MechanismGraphNode, role: FabricationStackLayer['role'], graph: MechanismGraph) => {
    if (node.role === 'link' || node.role === 'rigid-part') return `linkages:${linkageSpecForGraphNode(graph, node).key}`;
    if (node.role === 'ring-gear') {
        return `ring_gears:${fabricationRingGearSpecForPitchRadius(Math.abs(finiteGraphPartValue(node)) / SCENE_PX_PER_MM).key}`;
    }
    if (node.role === 'gear') {
        return `gears:${graphGearSpecForNode(graph, node).key}`;
    }
    return `${role}s:${node.id}`;
};

const requirementCategoryForPart = (part: string | undefined, _role: string) => {
    if (!part) return null;
    const lowerPart = part.toLowerCase();
    if (lowerPart.startsWith('linkages:')) return 'linkage';
    if (lowerPart.startsWith('gears:') || lowerPart.startsWith('ring_gears:')) return 'gear';
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
    if (linkageMatch) return fabricationPartDisplayLabel(fabricationLinkageSpecForCells(Number(linkageMatch[1])).label);
    const gearMatch = part.match(/^gears:(.+)$/);
    if (gearMatch) return FABRICATION_GEAR_SPECS.find(spec => spec.key === gearMatch[1])?.label ?? item.label;
    const ringGearMatch = part.match(/^ring_gears:(.+)$/);
    if (ringGearMatch) return fabricationRingGearSpecForPitchRadius().label;
    if (part === `spacers:${FABRICATION_SPACER_SPEC.key}`) return fabricationPartDisplayLabel(FABRICATION_SPACER_SPEC.label);
    if (part.startsWith('hardware:paper-fastener')) return 'Paper fastener';
    return item.label;
};

const requirementKeyForStackItem = (item: AssemblyStackItem, category: string) => {
    if (item.part) return item.part;
    return `${category}:${item.label}`;
};


const footprintRadiusForNode = (node: MechanismGraphNode) => {
    if (node.role === 'gear' || node.role === 'ring-gear' || node.role === 'cam') return Math.abs(node.value ?? 0);
    if (node.role === 'link' || node.role === 'rigid-part' || node.role === 'guide' || node.role === 'slider' || node.role === 'follower') {
        return Math.max(SCENE_PX_PER_MM * 8, Math.abs(node.value ?? 0) / 2);
    }
    return 0;
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
    if (role === 'hardware') return null;
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

const graphRenderPlan = (
    graph: MechanismGraph,
    assemblySteps: FabricationRecipe['assemblySteps'],
    validationErrors: string[]
): FabricationRenderPlan => {
    const stackLayers: FabricationStackLayer[] = assemblySteps
        .filter(step => step.role !== 'place-fastener')
        .flatMap(step => (step.stack ?? []).flatMap(item => {
        const role = renderRoleForAssemblyStackItem(item);
        return role ? [{ label: item.label, role, color: STACK_COLORS[role] }] : [];
    }));
    const isPegboardCamModule = stackLayers.some(item => item.label === 'Swappable cam disk')
        && stackLayers.some(item => item.label === 'U-channel guide cartridge')
        && stackLayers.some(item => item.label === 'Preassembled gravity follower module');
    const compactCamZ = isPegboardCamModule ? [
        Number((-FABRICATION_RENDER_LAYER_Z_STEP * 0.45).toFixed(2)),
        FABRICATION_RENDER_BASE_Z,
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 0.32).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 0.58).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 0.92).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 1.08).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 1.22).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 0.98).toFixed(2)),
        Number((FABRICATION_RENDER_BASE_Z + FABRICATION_RENDER_LAYER_Z_STEP * 1.04).toFixed(2))
    ] : [];
    const layers = stackLayers.map((item, index): FabricationRenderLayer => ({
        ...item,
        source: 'mechanism-graph',
        stackIndex: index,
        occurrence: stackLayers.slice(0, index).filter(previous => previous.role === item.role).length,
        z: compactCamZ[index] ?? FABRICATION_RENDER_BASE_Z + index * FABRICATION_RENDER_LAYER_Z_STEP,
        renderKind: renderKindForGraphRole(item.role)
    }));
    return {
        base: { ...fabricationBaseLayer(), source: 'mechanism-graph', stackIndex: -1, occurrence: 0, z: 0, renderKind: 'base' },
        layers,
        ...(graph.connectionSelectionSummary ? { connectionSelectionSummary: graph.connectionSelectionSummary } : {}),
        stackSummary: layers.map(item => item.label).join(' → '),
        roleSummary: layers.map(item => item.role).join('>'),
        occurrenceSummary: layers.map(item => `${item.role}#${item.occurrence}:${item.label}`).join('>'),
        colorSummary: layers.map(item => item.color).join(','),
        zSummary: layers.map(item => item.z.toFixed(2)).join(','),
        validationErrors
    };
};

const explicitPartNodeMatchesConstraint = (
    node: MechanismGraphNode,
    constraint: MechanismGraph['constraints'][number],
    nodeById: Map<string, MechanismGraphNode>,
    kit: PhysicalKitSettings
) => {
    if ((node.role !== 'link' && node.role !== 'rigid-part') || !Number.isFinite(node.value) || !Number.isFinite(constraint.value)) return false;
    const [startNode, endNode] = constraint.nodes.slice(0, 2).map(nodeId => nodeById.get(nodeId));
    if (!startNode?.position || !endNode?.position || !node.position) return false;
    const midpoint = { x: (startNode.position.x + endNode.position.x) / 2, y: (startNode.position.y + endNode.position.y) / 2 };
    return closePhysicalValue(Math.abs(node.value ?? 0), Math.abs(constraint.value ?? 0))
        && distanceBetween(node.position, midpoint) <= physicalTolerance(Math.abs(constraint.value ?? 0) || SCENE_PX_PER_MM * kit.gridPitchMm);
};

const constraintPartNameScore = (
    node: MechanismGraphNode,
    constraint: MechanismGraph['constraints'][number]
) => {
    const nodeText = `${node.id} ${node.label}`.toLowerCase();
    const constraintText = `${constraint.id} ${constraint.label}`.toLowerCase();
    return [
        'input',
        'output',
        'coupler',
        'left',
        'right',
        'drive',
        'crank',
        'connector',
        'rod',
        'dyad',
        'follower',
        'carrier',
        'slotted',
        'arm'
    ].reduce((score, token) => score + (nodeText.includes(token) && constraintText.includes(token) ? 1 : 0), 0);
};

const fabricatedLinkConstraints = (
    constraints: MechanismGraph['constraints'],
    explicitPartNodes: MechanismGraphNode[],
    nodeById: Map<string, MechanismGraphNode>,
    kit: PhysicalKitSettings
) => {
    const usedPartNodeIds = new Set<string>();
    return constraints
        .filter(constraint =>
            (constraint.role === 'distance' || (constraint.role === 'output-offset' && constraint.nodes.length === 2))
            && Number.isFinite(constraint.value)
            && constraint.nodes.length >= 2
        )
        .map(constraint => {
            const partNode = explicitPartNodes
                .filter(node => !usedPartNodeIds.has(node.id) && explicitPartNodeMatchesConstraint(node, constraint, nodeById, kit))
                .sort((a, b) => constraintPartNameScore(b, constraint) - constraintPartNameScore(a, constraint))[0];
            if (partNode) usedPartNodeIds.add(partNode.id);
            return { constraint, partNode };
        })
        .filter((entry): entry is { constraint: MechanismGraph['constraints'][number]; partNode: MechanismGraphNode } => Boolean(entry.partNode));
};

const explicitLinkPartIdsForConstraints = (
    constraints: Array<{ partNode: MechanismGraphNode }>
) => new Set(constraints.map(entry => entry.partNode.id));


export const compileGraphFabricationRecipe = (graph: MechanismGraph, kit = defaultPhysicalKit()): AuthoredGraphFabricationResult => {
    const missingDimensionNodes = graph.nodes.filter(node =>
        graphNodeIsFabricatedPart(node)
        && DIMENSIONED_GRAPH_PART_ROLES.has(node.role)
        && !Number.isFinite(node.value)
    );
    if (missingDimensionNodes.length) {
        const blocker = `Missing graph part dimension: ${missingDimensionNodes.map(node => node.label || node.id).join(', ')}`;
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker,
            renderPlan: graphRenderPlan(graph, [], [blocker])
        };
    }
    const validation = validateMechanismGraph(graph);
    const validationErrors = validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message);
    if (validationErrors.length) {
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker: 'Graph invalid',
            renderPlan: graphRenderPlan(graph, [], validationErrors)
        };
    }
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const boardMountedNodeIds = new Set(graph.constraints
        .filter(constraint => constraint.role === 'fixed-to-board' || constraint.role === 'board-snap')
        .flatMap(constraint => constraint.nodes));
    const boardMountedNodes = graph.nodes.filter(node => node.role === 'board-anchor' || boardMountedNodeIds.has(node.id));
    const primaryAnchor = boardMountedNodes.map(node => boardCoordinateForPoint(node.position, kit)).find(placement => placement?.snapped);
    const explicitPartNodes = graph.nodes.filter(node =>
        node.fabricated !== false
        && (node.role === 'link' || node.role === 'rigid-part')
        && Number.isFinite(node.value)
    );
    const linkConstraintEntries = fabricatedLinkConstraints(graph.constraints, explicitPartNodes, nodeById, kit);
    const representedLinkPartNodeIds = explicitLinkPartIdsForConstraints(linkConstraintEntries);
    const fabricatedMovingPartNodes = graph.nodes.filter(node =>
        graphNodeIsFabricatedPart(node)
        && !['fastener', 'spacer'].includes(node.role)
        && !representedLinkPartNodeIds.has(node.id)
    );
    const fabricatedMovingPartNodesArePlaced = fabricatedMovingPartNodes.every(node =>
        node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
    );
    const hasFabricatedMovingPart = fabricatedMovingPartNodes.length > 0
        || linkConstraintEntries.length > 0;
    const boardMountedNodesArePlaced = boardMountedNodes.every(node => boardCoordinateForPoint(node.position, kit)?.snapped);
    const fabricatedConstraintNodeIds = new Set(graph.constraints
        .filter(constraint => FABRICATED_CONSTRAINT_ROLES.has(constraint.role))
        .flatMap(constraint => constraint.nodes));
    const fabricatedBoardConstraintNodesArePlaced = [...fabricatedConstraintNodeIds]
        .filter(nodeId => boardMountedNodeIds.has(nodeId) || nodeById.get(nodeId)?.role === 'board-anchor')
        .every(nodeId => boardCoordinateForPoint(nodeById.get(nodeId)?.position, kit)?.snapped);
    const linkConstraintEndpointsArePlaced = linkConstraintEntries.every(({ constraint }) =>
        constraint.nodes.slice(0, 2).every(nodeId => {
            const point = nodeById.get(nodeId)?.position;
            return point && Number.isFinite(point.x) && Number.isFinite(point.y);
        })
    );
    const boardExtent = Math.floor(kit.boardCells / 2) * kit.gridPitchMm * SCENE_PX_PER_MM;
    const footprintConstrainedNodes = fabricatedMovingPartNodes.filter(node => node.role === 'cam' || node.role === 'guide');
    const fabricatedMovingPartFootprintsFit = footprintConstrainedNodes.every(node => {
        if (!node.position) return false;
        const radius = footprintRadiusForNode(node);
        return node.position.x - radius >= -boardExtent
            && node.position.x + radius <= boardExtent
            && node.position.y - radius >= -boardExtent
            && node.position.y + radius <= boardExtent;
    });
    if (!primaryAnchor || !boardMountedNodesArePlaced || !fabricatedBoardConstraintNodesArePlaced || !fabricatedMovingPartNodesArePlaced || !linkConstraintEndpointsArePlaced || !hasFabricatedMovingPart) {
        const offGridBoardNodes = boardMountedNodes
            .filter(node => !boardCoordinateForPoint(node.position, kit)?.snapped)
            .map(node => node.label || node.id);
        const offGridFabricatedBoardNodes = [...fabricatedConstraintNodeIds]
            .filter(nodeId => boardMountedNodeIds.has(nodeId) || nodeById.get(nodeId)?.role === 'board-anchor')
            .filter(nodeId => !boardCoordinateForPoint(nodeById.get(nodeId)?.position, kit)?.snapped)
            .map(nodeId => nodeById.get(nodeId)?.label || nodeId);
        const unplacedParts = fabricatedMovingPartNodes
            .filter(node => !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
            .map(node => node.label || node.id);
        const unplacedLinkEndpoints = linkConstraintEntries
            .filter(({ constraint }) => !constraint.nodes.slice(0, 2).every(nodeId => {
                const point = nodeById.get(nodeId)?.position;
                return point && Number.isFinite(point.x) && Number.isFinite(point.y);
            }))
            .map(({ constraint }) => constraint.label || constraint.id);
        const recipeErrors = [
            !primaryAnchor ? 'No board-snapped graph anchor' : '',
            offGridBoardNodes.length ? `Board-mounted nodes must snap to holes: ${offGridBoardNodes.join(', ')}` : '',
            offGridFabricatedBoardNodes.length ? `Fabricated board constraint nodes must snap to holes: ${offGridFabricatedBoardNodes.join(', ')}` : '',
            unplacedParts.length ? `Fabricated graph parts need positions: ${unplacedParts.join(', ')}` : '',
            unplacedLinkEndpoints.length ? `Fabricated link endpoints need positions: ${unplacedLinkEndpoints.join(', ')}` : '',
            !hasFabricatedMovingPart ? 'No fabricated moving part in graph' : ''
        ].filter(Boolean);
        const blocker = recipeErrors[0] ?? 'Graph placement requirements not met';
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker,
            renderPlan: graphRenderPlan(graph, [], [blocker, ...recipeErrors.filter(error => error !== blocker)])
        };
    }
    if (!fabricatedMovingPartFootprintsFit) {
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker: 'Placement off board',
            renderPlan: graphRenderPlan(graph, [], ['Placement off board'])
        };
    }
    const boardCoordinateForNode = (nodeId: string) => {
        const node = nodeById.get(nodeId);
        return boardCoordinateForPoint(node?.position, kit)?.coordinate ?? node?.label ?? nodeId;
    };
    const coordRoleForNode = (nodeId: string, fallback = 'graph_reference') => {
        const node = nodeById.get(nodeId);
        if (!node) return fallback;
        if (node.role === 'board-anchor' || boardMountedNodeIds.has(node.id)) return 'board';
        if (fallback !== 'graph_reference') return fallback;
        if (node.role === 'output-point' || node.role === 'generated-point') return 'output_reference';
        if (node.role === 'moving-joint') return 'link_joint_reference';
        if (graph.constraints.some(constraint => constraint.role === 'pin-joint' && constraint.nodes.includes(nodeId) && constraint.nodes.some(otherNodeId => nodeById.get(otherNodeId)?.id === 'carrier'))) {
            return 'carrier_reference';
        }
        if (graph.constraints.some(constraint => constraint.role === 'output-offset' && constraint.nodes.includes(nodeId) && constraint.nodes.some(otherNodeId => ['gear', 'ring-gear'].includes(nodeById.get(otherNodeId)?.role ?? '')))) {
            return 'gear_handle_reference';
        }
        if (graph.constraints.some(constraint => constraint.role === 'contact' && constraint.nodes.includes(nodeId))) return 'contact_reference';
        if (graph.constraints.some(constraint => constraint.role === 'prismatic' && constraint.nodes.includes(nodeId))) return 'guide_reference';
        return 'graph_reference';
    };
    const boardSteps = boardMountedNodes.map((node, index) => {
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
    if (graph.mechanismType === 'cam') {
        const camNode = graph.nodes.find(node => node.role === 'cam');
        const guideNode = graph.nodes.find(node => node.role === 'guide');
        const followerNode = graph.nodes.find(node => node.role === 'follower');
        if (!camNode || !guideNode || !followerNode) {
            const blocker = 'Cam module graph is missing cam, guide, or follower';
            return {
                recipeCompilerSource: 'compileGraphFabricationRecipe',
                buildable: false,
                blocker,
                renderPlan: graphRenderPlan(graph, [], [blocker])
            };
        }
        const camCoord = boardCoordinateForNode(camNode.id);
        const guideCoord = boardCoordinateForNode(guideNode.id);
        const followerCoord = boardCoordinateForNode(followerNode.id);
        const camAssemblyStep = {
            index: boardSteps.length + 1,
            label: 'Add pegboard cam follower module',
            role: 'add-part',
            boardCoordinate: camCoord,
            zMm: Number((FABRICATION_RENDER_BASE_Z * 10).toFixed(1)),
            coords: [camCoord, guideCoord, followerCoord],
            coordRoles: ['board', 'guide_reference', 'contact_reference'],
            action: 'stack-layer',
            instruction: 'Add the crank, washers, cam disk, guide cartridge, and follower module on the pegboard.',
            check: 'The follower should slide in the guide and stay on the cam.',
            stack: stack(
                { label: 'Crank handle', role: 'moving-part', part: 'linkages:crank-handle' },
                { label: 'Axle peg', role: 'spacer', part: 'spacers:axle-peg' },
                { label: 'Paper washer', role: 'spacer', part: 'spacers:paper-washer' },
                { label: 'Cam spacer', role: 'spacer', part: 'spacers:cam-spacer' },
                { label: graphPartLabelForNode(camNode, graph), role: 'moving-part', part: graphPartKeyForNode(camNode, 'cam', graph) },
                { label: 'Paper washer', role: 'spacer', part: 'spacers:paper-washer' },
                { label: 'Cam lock disk', role: 'clip', part: 'hardware:cam-lock-disk' },
                { label: graphPartLabelForNode(guideNode, graph), role: 'moving-part', part: graphPartKeyForNode(guideNode, 'guide', graph) },
                { label: graphPartLabelForNode(followerNode, graph), role: 'moving-part', part: graphPartKeyForNode(followerNode, 'follower', graph) }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
        const assemblySteps = [...boardSteps, camAssemblyStep].map((step, index) => ({ ...step, index: index + 1 }));
        const camModulePartPriority = (part: FabricationPartRequirement) => {
            const text = `${part.part ?? ''} ${part.name}`.toLowerCase();
            if (text.includes('cam-disk') || text.includes('swappable cam')) return 0;
            if (text.includes('follower')) return 1;
            if (text.includes('guide') || text.includes('cartridge')) return 2;
            if (text.includes('crank handle')) return 3;
            if (text.includes('axle peg')) return 4;
            return 5;
        };
        const requiredParts = requiredPartsFromAssemblySteps(assemblySteps)
            .sort((a, b) => camModulePartPriority(a) - camModulePartPriority(b));
        const renderPlan = graphRenderPlan(graph, assemblySteps, validationErrors);
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
                'Use the pegboard cam follower cartridge.',
                `Parts: ${requiredParts.map(part => `${fabricationPartDisplayLabel(part.name)} × ${part.quantity}`).join(', ')}.`,
                validationErrors.length ? `Fix: ${validationErrors.join('; ')}` : 'Ready.'
            ],
            assemblySteps,
            warnings: graph.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').map(diagnostic => diagnostic.message)
        };
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: validationErrors.length === 0,
            blocker: validationErrors.length ? 'Graph invalid' : undefined,
            recipe,
            renderPlan,
            assemblyStepFingerprints: assemblySteps.map(assemblyStepFingerprint)
        };
    }

    const linkSteps = linkConstraintEntries.map(({ constraint, partNode }, index) => {
        const coords = constraint.nodes.slice(0, 2).map(boardCoordinateForNode);
        const label = graphPartLabelForNode(partNode, graph);
        return {
            index: boardSteps.length + index + 1,
            label: `Add ${label}`,
            role: 'add-part',
            boardCoordinate: coords[0] ?? primaryAnchor.coordinate,
            zMm: Number((FABRICATION_RENDER_BASE_Z * 10 + index * FABRICATION_RENDER_LAYER_Z_STEP * 10).toFixed(1)),
            coords,
            coordRoles: constraint.nodes.slice(0, 2).map(nodeId => coordRoleForNode(nodeId)),
            action: 'stack-layer',
            instruction: `Connect ${fabricationPartDisplayLabel(label)} between ${coords.join(' and ')}.`,
            check: 'The link can swing without rubbing.',
            stack: stack(
                { label: 'Back Clip', role: 'clip' },
                { label, role: 'moving-part', part: graphPartKeyForNode(partNode, graphPartRoleForNode(partNode.role) ?? 'linkage', graph) },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}` },
                { label: `End hole ${coords[1] ?? coords[0] ?? primaryAnchor.coordinate}`, role: coordRoleForNode(constraint.nodes[1] ?? constraint.nodes[0]) },
                { label: 'Paper fastener', role: 'hardware', part: 'hardware:paper-fastener' },
                { label: 'Front Clip', role: 'clip' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const partSteps = graph.nodes
        .filter(node => graphNodeIsFabricatedPart(node) && !representedLinkPartNodeIds.has(node.id))
        .map((node, index) => {
        const coord = boardCoordinateForNode(node.id);
        const role = graphPartRoleForNode(node.role) ?? 'linkage';
        const label = graphPartLabelForNode(node, graph);
        const stackReferenceRole = boardMountedNodeIds.has(node.id) ? 'board' : coordRoleForNode(node.id);
        return {
            index: boardSteps.length + linkSteps.length + index + 1,
            label: `Add ${node.label}`,
            role: 'add-part',
            boardCoordinate: coord,
            zMm: Number((FABRICATION_RENDER_BASE_Z * 10 + (linkSteps.length + index) * FABRICATION_RENDER_LAYER_Z_STEP * 10).toFixed(1)),
            coords: [coord],
            coordRoles: [coordRoleForNode(node.id)],
            action: 'stack-layer',
            instruction: `Place ${fabricationPartDisplayLabel(label)} at ${coord}.`,
            check: role === 'gear' ? 'The gear spins without rubbing.' : 'The part moves freely.',
            stack: stack(
                { label: 'Back Clip', role: 'clip' },
                { label, role: 'moving-part', part: graphPartKeyForNode(node, role, graph) },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}` },
                { label: `Graph point ${coord}`, role: stackReferenceRole },
                { label: 'Paper fastener', role: 'hardware', part: 'hardware:paper-fastener' },
                { label: 'Front Clip', role: 'clip' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const movingPartSteps = graph.mechanismType === 'gear_linkage'
        ? [...partSteps, ...linkSteps]
        : [...linkSteps, ...partSteps];
    const assemblySteps = [...boardSteps, ...movingPartSteps].map((step, index) => ({ ...step, index: index + 1 }));
    const requiredParts = requiredPartsFromAssemblySteps(assemblySteps);
    const renderPlan = graphRenderPlan(graph, assemblySteps, validationErrors);
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

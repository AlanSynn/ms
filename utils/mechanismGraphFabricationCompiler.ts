import type { AssemblyStepStackItem, FabricationPartRequirement, FabricationRecipe, PhysicalKitSettings, Point } from '../types';
import { boardToScene, defaultPhysicalKit, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import { physicalTolerance } from './fabricationReadiness';
import {
    FABRICATION_GEAR_SPECS,
    FABRICATION_LINKAGE_SPECS,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SPACER_SPEC,
    fabricationGearSpecForPitchRadius,
    fabricationRingGearSpecForPitchRadius,
    fabricationLinkageSpecForCells,
    fabricationPartDisplayLabel
} from './fabricationContract';
import {
    PLATE_DEPTH_MM,
    SPACER_DEPTH_MM,
    packFabricationRenderPlan,
    type FabricationRenderKind,
    type FabricationRenderLayer,
    type FabricationRenderPlan
} from './mechanismFabricationZStack';
import { assemblyStepFingerprint, type AssemblyStepFingerprint } from './fabricationAssemblyFingerprint';
import { fabricationBaseLayer, STACK_COLORS, type FabricationStackLayer } from './fabricationStackModel';
import { validateMechanismGraph, type MechanismConstraintRole, type MechanismGraph, type MechanismGraphNode, type MechanismGraphNodeRole } from './mechanismGraph';
import {
    connectionSelectionPartKey,
    connectionSelectionRolesForMechanism,
    connectionSelectionSourceNodeId,
} from './mechanismConnectionSelections';

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

const graphPartRoleForNode = (node: MechanismGraphNode): FabricationStackLayer['role'] | null => {
    const { role } = node;
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
    const sceneAnchor = boardToScene(board.col, board.row, kit);
    const snapDistance = distanceBetween(point, sceneAnchor);
    // Grid alignment and board containment are separate physical facts. Keep
    // an aligned off-board node compilable so the envelope/readiness layer can
    // return the exact fit blocker instead of misreporting a snap failure.
    return { board, sceneAnchor, coordinate: board.label, snapDistance, snapped: snapDistance <= boardSnapTolerance(kit) };
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

type GraphAssemblyStackItem = AssemblyStepStackItem;

type GraphAssemblyStep = Omit<FabricationRecipe['assemblySteps'][number], 'stack'> & {
    stack?: GraphAssemblyStackItem[];
};

const stack = (...items: Array<Omit<GraphAssemblyStackItem, 'order'>>): GraphAssemblyStackItem[] =>
    items.map((item, index) => ({ order: index + 1, ...item }));

const finiteGraphPartValue = (node: MechanismGraphNode) => {
    if (!Number.isFinite(node.value)) throw new Error(`Missing graph part dimension for ${node.id}`);
    return Number(node.value);
};

const selectedPhysicalConnectionForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    if (!graph.mechanismType) return undefined;
    const selections = graph.connectionSelectionSummary?.connectionSelections;
    return connectionSelectionRolesForMechanism(graph.mechanismType).flatMap(role => {
        const selection = selections?.[role];
        return selection && connectionSelectionSourceNodeId(role, selection) === node.id ? [{ role, selection }] : [];
    })[0];
};

const selectedLinkageSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const selection = selectedPhysicalConnectionForGraphNode(graph, node)?.selection;
    return selection?.kind === 'linkage-hole'
        ? FABRICATION_LINKAGE_SPECS.find(spec => spec.key === selection.linkageKey)
        : undefined;
};

const graphRequiresExactCatalogParts = (graph: MechanismGraph) =>
    graph.source === 'family-definition' && graph.family.authoringMode === 'classroom-preset';

const exactSceneLengthMatches = (value: number | undefined, lengthMm: number) =>
    Number.isFinite(value) && Math.abs(Math.abs(value as number) - lengthMm * SCENE_PX_PER_MM) <= 1e-6;

const physicalConnectionsForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) =>
    graph.connectionSelectionSummary?.physicalConnections.filter(connection => connection.sourceNodeId === node.id) ?? [];

const linkageSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const selected = selectedLinkageSpecForGraphNode(graph, node);
    if (selected) return selected;
    if (graphRequiresExactCatalogParts(graph)) {
        return FABRICATION_LINKAGE_SPECS.find(spec => exactSceneLengthMatches(node.value, spec.lengthMm));
    }
    const cells = Math.max(2, Math.round(Math.abs(finiteGraphPartValue(node)) / Math.max(1, SCENE_PX_PER_MM * 20)));
    return fabricationLinkageSpecForCells(cells);
};

const selectedGearSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const selection = selectedPhysicalConnectionForGraphNode(graph, node)?.selection;
    return selection?.kind === 'gear-attachment-hole'
        ? FABRICATION_GEAR_SPECS.find(spec => spec.key === selection.gearKey)
        : undefined;
};

const graphGearSpecForNode = (graph: MechanismGraph, node: MechanismGraphNode) => {
    const selected = selectedGearSpecForGraphNode(graph, node);
    if (selected) return selected;
    return graphRequiresExactCatalogParts(graph)
        ? FABRICATION_GEAR_SPECS.find(spec => exactSceneLengthMatches(node.value, spec.pitchRadiusMm))
        : fabricationGearSpecForPitchRadius(Math.abs(finiteGraphPartValue(node)) / SCENE_PX_PER_MM);
};

const ringGearSpecForGraphNode = (graph: MechanismGraph, node: MechanismGraphNode) =>
    graphRequiresExactCatalogParts(graph)
        ? exactSceneLengthMatches(node.value, FABRICATION_RING_GEAR_SPEC.pitchRadiusMm)
            ? FABRICATION_RING_GEAR_SPEC
            : undefined
        : fabricationRingGearSpecForPitchRadius(Math.abs(finiteGraphPartValue(node)) / SCENE_PX_PER_MM);

const graphPartLabelForNode = (node: MechanismGraphNode, graph: MechanismGraph) => {
    const { source } = graph;
    if (node.role === 'ring-gear') {
        const ringLabel = ringGearSpecForGraphNode(graph, node)?.label ?? node.label;
        return source !== 'family-definition' ? node.label || ringLabel : ringLabel;
    }
    if (node.role === 'gear') {
        const gearLabel = graphGearSpecForNode(graph, node)?.label ?? node.label;
        if (source !== 'family-definition') return node.label || gearLabel;
        const idlerMatch = /^Idler gear\s*(\d+)$/i.exec(node.label);
        if (idlerMatch) return `Idler ${gearLabel} ${idlerMatch[1]}`;
        const roleLabel = node.label.replace(/\b(gear|axle)\b/gi, '').trim();
        return roleLabel ? `${roleLabel} ${gearLabel}` : gearLabel;
    }
    if (node.role === 'link') {
        const holeLabel = fabricationPartDisplayLabel(linkageSpecForGraphNode(graph, node)?.label ?? node.label);
        if (source !== 'family-definition') return node.label || holeLabel;
        const roleLabel = node.label.replace(/\blink\b/i, '').trim();
        return roleLabel ? `${roleLabel} ${holeLabel}` : holeLabel;
    }
    if (node.role === 'rigid-part') return node.label || fabricationPartDisplayLabel(linkageSpecForGraphNode(graph, node)?.label ?? node.label);
    return node.label;
};

const graphPartKeyForNode = (node: MechanismGraphNode, role: FabricationStackLayer['role'], graph: MechanismGraph) => {
    if (node.id === 'rack') return 'racks:rack';
    const selected = selectedPhysicalConnectionForGraphNode(graph, node);
    if (selected) return connectionSelectionPartKey(selected.role, selected.selection);
    if (node.role === 'link' || node.role === 'rigid-part') {
        const spec = linkageSpecForGraphNode(graph, node);
        return spec ? `linkages:${spec.key}` : `linkages:unapproved`;
    }
    if (node.role === 'ring-gear') {
        const spec = ringGearSpecForGraphNode(graph, node);
        return spec ? `ring_gears:${spec.key}` : 'ring_gears:unapproved';
    }
    if (node.role === 'gear') {
        const spec = graphGearSpecForNode(graph, node);
        return spec ? `gears:${spec.key}` : 'gears:unapproved';
    }
    return `${role}s:${node.id}`;
};

const requirementCategoryForPart = (part: string | undefined, _role: string) => {
    if (!part) return null;
    const lowerPart = part.toLowerCase();
    if (lowerPart.startsWith('linkages:')) return 'linkage';
    if (lowerPart.startsWith('gears:') || lowerPart.startsWith('ring_gears:')) return 'gear';
    if (lowerPart.startsWith('cams:')) return 'cam';
    if (lowerPart.startsWith('cam_modules:')) return 'cam-module';
    if (lowerPart.startsWith('brackets:')) return 'guide';
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

const catalogSelectionRolesForGraph = (graph: MechanismGraph) => {
    if (!graph.mechanismType) return [];
    return connectionSelectionRolesForMechanism(graph.mechanismType).filter(role =>
        role.startsWith('4bar.')
        || role.startsWith('gear')
        || role.startsWith('planetary_gear.')
        || role === 'piston.crank-pin'
        || role === 'piston.rod-slider-pin'
    );
};

const exactCatalogValidationErrors = (graph: MechanismGraph): string[] => {
    if (!graphRequiresExactCatalogParts(graph)) return [];
    const errors = new Set<string>();
    const physicalConnections = graph.connectionSelectionSummary?.physicalConnections ?? [];
    catalogSelectionRolesForGraph(graph).forEach(role => {
        if (physicalConnections.some(connection => connection.role === role)) return;
        errors.add(role.startsWith('gear') ? 'Fix: approved gear required' : 'Fix: approved linkage required');
    });
    graph.nodes.filter(graphNodeIsFabricatedPart).forEach(node => {
        if (node.role === 'link' || node.role === 'rigid-part') {
            const connections = physicalConnectionsForGraphNode(graph, node);
            const validSelection = connections.length > 0
                ? connections.every(connection => {
                    const selection = connection.selection;
                    if (selection.kind !== 'linkage-hole') return false;
                    return FABRICATION_LINKAGE_SPECS.some(spec => spec.key === selection.linkageKey);
                })
                : Boolean(linkageSpecForGraphNode(graph, node));
            if (!validSelection) errors.add('Fix: approved linkage required');
            return;
        }
        if (node.role === 'gear') {
            const connections = physicalConnectionsForGraphNode(graph, node);
            const validSelection = connections.length > 0
                ? connections.every(connection => {
                    if (connection.selection.kind !== 'gear-attachment-hole') return false;
                    const spec = FABRICATION_GEAR_SPECS.find(candidate =>
                        connection.selection.kind === 'gear-attachment-hole'
                        && candidate.key === connection.selection.gearKey
                    );
                    return Boolean(spec && exactSceneLengthMatches(node.value, spec.pitchRadiusMm));
                })
                : FABRICATION_GEAR_SPECS.some(spec => exactSceneLengthMatches(node.value, spec.pitchRadiusMm));
            if (!validSelection) errors.add('Fix: approved gear required');
            return;
        }
        if (node.role === 'ring-gear' && !ringGearSpecForGraphNode(graph, node)) {
            errors.add('Fix: approved gear required');
        }
    });
    return [...errors];
};

type AssemblyStackItem = NonNullable<FabricationRecipe['assemblySteps'][number]['stack']>[number];

const graphRenderPlan = (
    graph: MechanismGraph,
    assemblySteps: GraphAssemblyStep[],
    validationErrors: string[]
): FabricationRenderPlan => {
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const boardMountedNodeIds = new Set(graph.constraints
        .filter(constraint => constraint.role === 'fixed-to-board' || constraint.role === 'board-snap')
        .flatMap(constraint => constraint.nodes));
    const sourceConstraintIdsFor = (sourceNodeId: string, declared: readonly string[] = []) => declared.length
        ? [...declared]
        : graph.constraints
            .filter(constraint => constraint.nodes.includes(sourceNodeId)
                || (constraint.role === 'distance' && constraint.fabricatedPartNodeId === sourceNodeId))
            .map(constraint => constraint.id)
            .sort();
    const stackLayers = assemblySteps.flatMap(step => (step.stack ?? []).flatMap(item => {
        if (item.axialRole !== 'structural' || !item.sourceNodeId) return [];
        const node = nodeById.get(item.sourceNodeId);
        const role = node ? graphPartRoleForNode(node) ?? 'linkage' : 'linkage';
        return [{
            label: item.label,
            role,
            color: STACK_COLORS[role],
            stepIndex: step.index,
            stackItemIndex: item.order - 1,
            part: item.part,
            sourceNodeId: item.sourceNodeId,
            sourceConstraintIds: sourceConstraintIdsFor(item.sourceNodeId, item.sourceConstraintIds)
        }];
    }));
    const occurrenceByRole = new Map<FabricationStackLayer['role'], number>();
    const drafts = stackLayers.map(item => {
        const occurrence = occurrenceByRole.get(item.role) ?? 0;
        occurrenceByRole.set(item.role, occurrence + 1);
        return {
            label: item.label,
            role: item.role,
            color: item.color,
            source: 'mechanism-graph' as const,
            stackIndex: item.stepIndex,
            stackItemIndex: item.stackItemIndex,
            occurrence,
            renderKind: renderKindForGraphRole(item.role),
            partKey: item.part,
            sourceNodeId: item.sourceNodeId,
            sourceConstraintIds: item.sourceConstraintIds,
            preferredBackFaceMm: undefined as number | undefined
        };
    });
    const draftIndexesByNode = new Map<string, number[]>();
    drafts.forEach((draft, index) => draftIndexesByNode.set(draft.sourceNodeId, [...(draftIndexesByNode.get(draft.sourceNodeId) ?? []), index]));
    const exactDraftIndex = (nodeId: string) => {
        const matches = draftIndexesByNode.get(nodeId) ?? [];
        if (matches.length !== 1) return undefined;
        return matches[0];
    };
    const gearNodeIds = new Set(graph.nodes.filter(node => node.role === 'gear' || node.role === 'ring-gear').map(node => node.id));
    const parent = new Map([...gearNodeIds].map(id => [id, id]));
    const find = (id: string): string => {
        const p = parent.get(id) ?? id;
        if (p === id) return p;
        const r = find(p);
        parent.set(id, r);
        return r;
    };
    const unite = (a: string, b: string) => { parent.set(find(a), find(b)); };
    graph.constraints.filter(constraint => constraint.role === 'gear-mesh').forEach(constraint => {
        const [a, b] = constraint.nodes;
        if (gearNodeIds.has(a) && gearNodeIds.has(b)) unite(a, b);
    });
    const components = new Map<string, string[]>();
    [...gearNodeIds].forEach(id => {
        const root = find(id);
        components.set(root, [...(components.get(root) ?? []), id]);
    });
    const gearPlaneComponents = [...components.values()]
        .map(ids => ids.sort())
        .filter(ids => ids.length >= 2)
        .map(ids => ({ id: `${graph.id}:gear-plane:${ids.join('+')}`, sourceNodeIds: ids }));

    const parentDraft = new Map(drafts.map((_, index) => [index, index]));
    const findDraft = (index: number): number => {
        const value = parentDraft.get(index) ?? index;
        if (value === index) return value;
        const root = findDraft(value);
        parentDraft.set(index, root);
        return root;
    };
    const uniteDraft = (a: number, b: number) => parentDraft.set(findDraft(a), findDraft(b));
    gearPlaneComponents.forEach(component => {
        const indexes = component.sourceNodeIds.map(exactDraftIndex).filter((value): value is number => typeof value === 'number');
        indexes.slice(1).forEach(index => uniteDraft(indexes[0], index));
    });
    graph.constraints.filter(constraint => constraint.role === 'contact' || constraint.role === 'prismatic').forEach(constraint => {
        const indexes = constraint.nodes.map(exactDraftIndex).filter((value): value is number => typeof value === 'number');
        indexes.slice(1).forEach(index => uniteDraft(indexes[0], index));
    });

    const attachmentDrafts = new Map<string, Set<number>>();
    const attach = (nodeId: string, draftIndex: number | undefined) => {
        if (typeof draftIndex !== 'number') return;
        const indexes = attachmentDrafts.get(nodeId) ?? new Set<number>();
        indexes.add(draftIndex);
        attachmentDrafts.set(nodeId, indexes);
    };
    drafts.forEach((draft, index) => attach(draft.sourceNodeId, index));
    graph.constraints.filter(constraint => constraint.role === 'distance').forEach(constraint => {
        const partIndex = drafts.findIndex(draft => draft.sourceConstraintIds.includes(constraint.id));
        constraint.nodes.slice(0, 2).forEach(nodeId => attach(nodeId, partIndex >= 0 ? partIndex : undefined));
    });
    graph.constraints.filter(constraint => constraint.role === 'output-offset').forEach(constraint => {
        if (constraint.nodes.length !== 2) return;
        const structuralIndexes = constraint.nodes.map(exactDraftIndex).filter((value): value is number => typeof value === 'number');
        constraint.nodes.forEach(nodeId => structuralIndexes.forEach(index => attach(nodeId, index)));
    });

    type RelationCandidate = {
        id: string;
        sourceKind: 'board' | 'pin-joint' | 'distance-joint' | 'contact' | 'prismatic' | 'generated-joint';
        sourceIds: string[];
        rootNodeId: string;
        draftIndexes: number[];
        rootedToBoard: boolean;
        pinBearing: boolean;
        transitionKinds?: Array<'face-contact' | 'contact-overlap' | 'guide-capture'>;
        ownerExpansions?: Array<{ pivotNodeId: string; ownerPartId: string; ownerLayerId: string }>;
    };
    const draftLayerId = (index: number) => {
        const draft = drafts[index];
        return `${graph.id}:step:${draft.stackIndex}:node:${draft.sourceNodeId}:occ:${draft.occurrence}`;
    };
    const resolveConstraintDrafts = (constraint: MechanismGraph['constraints'][number]) => constraint.nodes.flatMap(nodeId => {
        const node = nodeById.get(nodeId);
        const sourceId = node?.role === 'moving-joint' && node.ownerPartId ? node.ownerPartId : nodeId;
        const index = exactDraftIndex(sourceId);
        return typeof index === 'number' ? [index] : [];
    });
    const ownerExpansionsFor = (constraint: MechanismGraph['constraints'][number]) => constraint.nodes.flatMap(nodeId => {
        const node = nodeById.get(nodeId);
        if (node?.role !== 'moving-joint' || !node.ownerPartId) return [];
        const ownerIndex = exactDraftIndex(node.ownerPartId);
        return typeof ownerIndex === 'number'
            ? [{ pivotNodeId: node.id, ownerPartId: node.ownerPartId, ownerLayerId: draftLayerId(ownerIndex) }]
            : [];
    });
    const candidates: RelationCandidate[] = [];
    graph.constraints.filter(constraint => constraint.role === 'pin-joint').forEach(constraint => {
        const indexes = [...new Set(resolveConstraintDrafts(constraint))];
        candidates.push({
            id: `${graph.id}:support:pin:${constraint.id}:occ:0`, sourceKind: 'pin-joint', sourceIds: [constraint.id],
            rootNodeId: constraint.nodes[0] ?? constraint.id, draftIndexes: indexes,
            rootedToBoard: constraint.nodes.some(nodeId => boardMountedNodeIds.has(nodeId)), pinBearing: true,
            ownerExpansions: ownerExpansionsFor(constraint)
        });
    });
    graph.constraints.filter(constraint => constraint.role === 'contact' || constraint.role === 'prismatic').forEach(constraint => {
        const indexes = [...new Set(resolveConstraintDrafts(constraint))];
        const sourceKind = constraint.role === 'contact' ? 'contact' as const : 'prismatic' as const;
        candidates.push({
            id: `${graph.id}:support:${sourceKind}:${constraint.id}:occ:0`, sourceKind, sourceIds: [constraint.id],
            rootNodeId: constraint.nodes[0] ?? constraint.id, draftIndexes: indexes,
            // A prismatic pair is guide containment, not an axial stack from
            // the board into the moving slider/follower. Its fixed guide has
            // its own board support path; rooting the pair here invents a
            // vertical contact gap before the moving part.
            rootedToBoard: constraint.role !== 'prismatic' && constraint.nodes.some(nodeId => boardMountedNodeIds.has(nodeId)), pinBearing: false,
            transitionKinds: indexes.slice(1).map(() => sourceKind === 'contact' ? 'contact-overlap' : 'guide-capture')
        });
    });
    const distanceConstraints = graph.constraints.filter(constraint => constraint.role === 'distance');
    const distanceJointNodeIds = [...new Set(distanceConstraints.flatMap(constraint => constraint.nodes.slice(0, 2)))];
    distanceJointNodeIds.forEach(nodeId => {
        const incident = distanceConstraints.filter(constraint => constraint.nodes.slice(0, 2).includes(nodeId));
        const indexes = [...(attachmentDrafts.get(nodeId) ?? [])];
        if (!indexes.length) return;
        const sourceIds = incident.map(constraint => constraint.id).sort();
        candidates.push({
            id: `${graph.id}:support:distance:${nodeId}:${sourceIds.join('+')}:occ:0`, sourceKind: 'distance-joint', sourceIds,
            rootNodeId: nodeId, draftIndexes: indexes,
            rootedToBoard: nodeById.get(nodeId)?.role === 'board-anchor' || boardMountedNodeIds.has(nodeId) || indexes.some(index => boardMountedNodeIds.has(drafts[index].sourceNodeId)),
            pinBearing: true
        });
    });
    if (graph.mechanismType === 'cam') {
        const crank = exactDraftIndex('cam-axle');
        const cam = exactDraftIndex('cam-disk');
        if (typeof crank === 'number' && typeof cam === 'number') candidates.push({
            id: `${graph.id}:support:board:cam-axle:occ:0`, sourceKind: 'board', sourceIds: ['cam-axle-fixed'], rootNodeId: 'cam-axle',
            draftIndexes: [crank, cam], rootedToBoard: true, pinBearing: true
        });
    }

    const relationDraftIndexes = new Set(candidates.flatMap(candidate => candidate.draftIndexes));
    drafts.forEach((draft, index) => {
        if (!boardMountedNodeIds.has(draft.sourceNodeId) || relationDraftIndexes.has(index)) return;
        candidates.push({
            id: `${graph.id}:support:board:${draft.sourceNodeId}:occ:0`, sourceKind: 'board', sourceIds: [], rootNodeId: draft.sourceNodeId,
            draftIndexes: [index], rootedToBoard: true, pinBearing: true
        });
    });
    drafts.forEach((draft, index) => {
        if (candidates.some(candidate => candidate.draftIndexes.includes(index))) return;
        candidates.push({
            id: `${graph.id}:support:generated:${draft.sourceNodeId}:occ:0`, sourceKind: 'generated-joint', sourceIds: draft.sourceConstraintIds,
            rootNodeId: draft.sourceNodeId, draftIndexes: [index], rootedToBoard: false, pinBearing: true
        });
    });

    const groupMembers = new Map<number, number[]>();
    drafts.forEach((_, index) => {
        const root = findDraft(index);
        groupMembers.set(root, [...(groupMembers.get(root) ?? []), index]);
    });
    const groupLevel = new Map<number, number>();
    candidates.filter(candidate => candidate.rootedToBoard).forEach(candidate => candidate.draftIndexes.forEach(index => groupLevel.set(findDraft(index), 0)));
    const sequentialCandidates = candidates.filter(candidate => !candidate.transitionKinds?.length && candidate.draftIndexes.length > 1);
    const groupAdjacency = new Map<number, Set<number>>();
    sequentialCandidates.forEach(candidate => {
        const groups = [...new Set(candidate.draftIndexes.map(findDraft))];
        groups.slice(1).forEach((group, index) => {
            const previous = groups[index];
            groupAdjacency.set(previous, new Set([...(groupAdjacency.get(previous) ?? []), group]));
            groupAdjacency.set(group, new Set([...(groupAdjacency.get(group) ?? []), previous]));
        });
    });
    const queue = [...groupLevel.keys()];
    while (queue.length) {
        const group = queue.shift()!;
        const level = groupLevel.get(group) ?? 0;
        (groupAdjacency.get(group) ?? []).forEach(next => {
            if (groupLevel.has(next)) return;
            groupLevel.set(next, level + 1);
            queue.push(next);
        });
    }
    groupMembers.forEach((_, group) => { if (!groupLevel.has(group)) groupLevel.set(group, 0); });
    for (let pass = 0; pass < drafts.length; pass += 1) {
        let changed = false;
        sequentialCandidates.forEach(candidate => {
            const groups = [...new Set(candidate.draftIndexes.map(findDraft))]
                .sort((a, b) => (groupLevel.get(a) ?? 0) - (groupLevel.get(b) ?? 0) || Math.min(...groupMembers.get(a)!) - Math.min(...groupMembers.get(b)!));
            groups.slice(1).forEach((group, index) => {
                const required = (groupLevel.get(groups[index]) ?? 0) + 1;
                if ((groupLevel.get(group) ?? 0) < required) {
                    groupLevel.set(group, required);
                    changed = true;
                }
            });
        });
        if (!changed) break;
    }
    const preferredBack = (index: number) => {
        const sourceNodeId = drafts[index].sourceNodeId;
        if (graph.mechanismType === 'cam' && ['cam-disk', 'follower-head', 'follower-guide'].includes(sourceNodeId)) return 8.8;
        return Number(((groupLevel.get(findDraft(index)) ?? 0) * (PLATE_DEPTH_MM + SPACER_DEPTH_MM)).toFixed(6));
    };
    drafts.forEach((draft, index) => { draft.preferredBackFaceMm = preferredBack(index); });
    candidates.forEach(candidate => {
        if (candidate.transitionKinds?.length) return;
        candidate.draftIndexes.sort((a, b) => preferredBack(a) - preferredBack(b) || a - b);
    });
    let aliasOrdinal = 0;
    const pathDrafts = candidates.map(candidate => ({
        id: candidate.id,
        sourceKind: candidate.sourceKind,
        sourceIds: candidate.sourceIds,
        rootNodeId: candidate.rootNodeId,
        orderedDraftIndexes: candidate.draftIndexes,
        transitionKinds: candidate.transitionKinds,
        rootedToBoard: candidate.rootedToBoard,
        pinBearing: candidate.pinBearing,
        accessoryStackIndex: Math.max(0, ...candidate.draftIndexes.map(index => drafts[index]?.stackIndex ?? 0)),
        ownerExpansions: candidate.ownerExpansions,
        ...(candidate.pinBearing ? { displayAlias: String.fromCharCode(65 + aliasOrdinal++) } : {})
    }));
    const physicalConnectionErrors = graph.connectionSelectionSummary?.physicalConnections.flatMap(connection =>
        drafts.some(draft => draft.sourceNodeId === connection.sourceNodeId && draft.partKey === connection.partKey)
            ? []
            : [`Missing compiled physical layer for ${connection.role} (${connection.sourceNodeId}/${connection.partKey})`]
    ) ?? [];
    return packFabricationRenderPlan({
        graphId: graph.id,
        layers: drafts,
        validationErrors: [...validationErrors, ...physicalConnectionErrors],
        ...(graph.connectionSelectionSummary ? { connectionSelectionSummary: graph.connectionSelectionSummary } : {}),
        gearPlaneComponents,
        pathDrafts
    });
};

const assemblyStepsWithPackedZ = (assemblySteps: FabricationRecipe['assemblySteps'], renderPlan: FabricationRenderPlan): FabricationRecipe['assemblySteps'] =>
    assemblySteps.map(step => ({
        ...step,
        zMm: renderPlan.layers.find(layer => layer.stackIndex === step.index)?.centerMm ?? step.zMm
    }));

const fabricatedLinkConstraints = (
    constraints: MechanismGraph['constraints'],
    nodeById: Map<string, MechanismGraphNode>
) => constraints
    .filter((constraint): constraint is Extract<MechanismGraph['constraints'][number], { role: 'distance' }> =>
        constraint.role === 'distance'
        && Number.isFinite(constraint.value)
        && constraint.nodes.length >= 2
    )
    .map(constraint => ({ constraint, partNode: nodeById.get(constraint.fabricatedPartNodeId) }))
    .filter((entry): entry is { constraint: Extract<MechanismGraph['constraints'][number], { role: 'distance' }>; partNode: MechanismGraphNode } => Boolean(entry.partNode));

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
    const errorDiagnostics = validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const validationErrors = errorDiagnostics.map(diagnostic => diagnostic.message);
    const familyPositionDiagnosticsOnly = graph.source === 'family-definition'
        && errorDiagnostics.length > 0
        && errorDiagnostics.every(diagnostic => diagnostic.code === 'position-mismatch');
    if (validationErrors.length && !familyPositionDiagnosticsOnly) {
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker: 'Graph invalid',
            renderPlan: graphRenderPlan(graph, [], validationErrors)
        };
    }
    const exactPartErrors = exactCatalogValidationErrors(graph);
    if (exactPartErrors.length) {
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: false,
            blocker: exactPartErrors[0],
            renderPlan: graphRenderPlan(graph, [], exactPartErrors)
        };
    }
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const boardMountedNodeIds = new Set(graph.constraints
        .filter(constraint => constraint.role === 'fixed-to-board' || constraint.role === 'board-snap')
        .flatMap(constraint => constraint.nodes));
    const boardMountedNodes = graph.nodes.filter(node => node.role === 'board-anchor' || boardMountedNodeIds.has(node.id));
    const primaryAnchor = boardMountedNodes.map(node => boardCoordinateForPoint(node.position, kit)).find(placement => placement?.snapped);
    const linkConstraintEntries = fabricatedLinkConstraints(graph.constraints, nodeById);
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
    const boardMountedNodesFit = boardMountedNodes.every(node => boardCoordinateForPoint(node.position, kit)?.board.valid);
    const fabricatedConstraintNodeIds = new Set(graph.constraints
        .filter(constraint => FABRICATED_CONSTRAINT_ROLES.has(constraint.role))
        .flatMap(constraint => constraint.nodes));
    const fabricatedBoardConstraintNodesArePlaced = [...fabricatedConstraintNodeIds]
        .filter(nodeId => boardMountedNodeIds.has(nodeId) || nodeById.get(nodeId)?.role === 'board-anchor')
        .every(nodeId => boardCoordinateForPoint(nodeById.get(nodeId)?.position, kit)?.snapped);
    const linkConstraintEndpointsArePlaced = linkConstraintEntries.every(({ constraint, partNode }) =>
        Boolean(partNode.position && Number.isFinite(partNode.position.x) && Number.isFinite(partNode.position.y))
        && constraint.nodes.slice(0, 2).every(nodeId => {
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
    if (!boardMountedNodesFit || !fabricatedMovingPartFootprintsFit) {
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
            zMm: 0,
            coords: [camCoord, guideCoord, followerCoord],
            coordRoles: ['board', 'guide_reference', 'contact_reference'],
            action: 'stack-layer',
            instruction: 'Add the crank, washers, cam disk, guide cartridge, and follower module on the pegboard.',
            check: 'The follower should slide in the guide and stay on the cam.',
            stack: stack(
                { label: 'Crank handle', role: 'moving-part', part: 'linkages:crank-handle', sourceNodeId: 'cam-axle', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'structural' },
                { label: 'Axle peg', role: 'spacer', part: 'spacers:axle-peg', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'spacer' },
                { label: 'Paper washer', role: 'spacer', part: 'spacers:paper-washer', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'spacer' },
                { label: 'Cam spacer', role: 'spacer', part: 'spacers:cam-spacer', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'spacer' },
                { label: graphPartLabelForNode(camNode, graph), role: 'moving-part', part: graphPartKeyForNode(camNode, 'cam', graph), sourceNodeId: camNode.id, sourceConstraintIds: ['cam-follower-contact'], axialRole: 'structural' },
                { label: 'Paper washer', role: 'spacer', part: 'spacers:paper-washer', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'spacer' },
                { label: 'Cam lock disk', role: 'clip', part: 'hardware:cam-lock-disk', sourceConstraintIds: ['cam-axle-fixed'], axialRole: 'front-retainer' },
                { label: graphPartLabelForNode(guideNode, graph), role: 'moving-part', part: graphPartKeyForNode(guideNode, 'guide', graph), sourceNodeId: guideNode.id, sourceConstraintIds: ['follower-guide-slide'], axialRole: 'structural' },
                { label: graphPartLabelForNode(followerNode, graph), role: 'moving-part', part: graphPartKeyForNode(followerNode, 'follower', graph), sourceNodeId: followerNode.id, sourceConstraintIds: ['cam-follower-contact', 'follower-guide-slide'], axialRole: 'structural' }
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
        const packedAssemblySteps = assemblyStepsWithPackedZ(assemblySteps, renderPlan);
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
            assemblySteps: packedAssemblySteps,
            warnings: graph.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').map(diagnostic => diagnostic.message)
        };
        return {
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            buildable: renderPlan.validationErrors.length === 0,
            blocker: renderPlan.validationErrors[0],
            ...(validationErrors.length ? {} : { recipe }),
            renderPlan,
            assemblyStepFingerprints: packedAssemblySteps.map(assemblyStepFingerprint)
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
            zMm: 0,
            coords,
            coordRoles: constraint.nodes.slice(0, 2).map(nodeId => coordRoleForNode(nodeId)),
            action: 'stack-layer',
            instruction: `Connect ${fabricationPartDisplayLabel(label)} between ${coords.join(' and ')}.`,
            check: 'The link can swing without rubbing.',
            stack: stack(
                { label: 'Back Clip', role: 'clip', sourceConstraintIds: [constraint.id], axialRole: 'back-retainer' },
                { label, role: 'moving-part', part: graphPartKeyForNode(partNode, graphPartRoleForNode(partNode) ?? 'linkage', graph), sourceNodeId: partNode.id, sourceConstraintIds: [constraint.id], axialRole: 'structural' },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}`, sourceConstraintIds: [constraint.id], axialRole: 'spacer' },
                { label: `End hole ${coords[1] ?? coords[0] ?? primaryAnchor.coordinate}`, role: coordRoleForNode(constraint.nodes[1] ?? constraint.nodes[0]) },
                { label: 'Paper fastener', role: 'hardware', part: 'hardware:paper-fastener' },
                { label: 'Front Clip', role: 'clip', sourceConstraintIds: [constraint.id], axialRole: 'front-retainer' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const partSteps = graph.nodes
        .filter(node => graphNodeIsFabricatedPart(node) && !representedLinkPartNodeIds.has(node.id))
        .map((node, index) => {
        const coord = boardCoordinateForNode(node.id);
        const role = graphPartRoleForNode(node) ?? 'linkage';
        const label = graphPartLabelForNode(node, graph);
        const stackReferenceRole = boardMountedNodeIds.has(node.id) ? 'board' : coordRoleForNode(node.id);
        return {
            index: boardSteps.length + linkSteps.length + index + 1,
            label: `Add ${node.label}`,
            role: 'add-part',
            boardCoordinate: coord,
            zMm: 0,
            coords: [coord],
            coordRoles: [coordRoleForNode(node.id)],
            action: 'stack-layer',
            instruction: `Place ${fabricationPartDisplayLabel(label)} at ${coord}.`,
            check: role === 'gear' ? 'The gear spins without rubbing.' : 'The part moves freely.',
            stack: stack(
                { label: 'Back Clip', role: 'clip', axialRole: 'back-retainer' },
                { label, role: 'moving-part', part: graphPartKeyForNode(node, role, graph), sourceNodeId: node.id, axialRole: 'structural' },
                { label: FABRICATION_SPACER_SPEC.label, role: 'spacer', part: `spacers:${FABRICATION_SPACER_SPEC.key}`, axialRole: 'spacer' },
                { label: `Graph point ${coord}`, role: stackReferenceRole },
                { label: 'Paper fastener', role: 'hardware', part: 'hardware:paper-fastener' },
                { label: 'Front Clip', role: 'clip', axialRole: 'front-retainer' }
            )
        } satisfies FabricationRecipe['assemblySteps'][number];
    });
    const movingPartSteps = graph.mechanismType === 'gear_linkage'
        ? [...partSteps, ...linkSteps]
        : [...linkSteps, ...partSteps];
    const assemblySteps = [...boardSteps, ...movingPartSteps].map((step, index) => ({ ...step, index: index + 1 }));
    const requiredParts = requiredPartsFromAssemblySteps(assemblySteps);
    const renderPlan = graphRenderPlan(graph, assemblySteps, validationErrors);
    const packedAssemblySteps = assemblyStepsWithPackedZ(assemblySteps, renderPlan);
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
        assemblySteps: packedAssemblySteps,
        warnings: graph.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').map(diagnostic => diagnostic.message)
    };
    return {
        recipeCompilerSource: 'compileGraphFabricationRecipe',
        buildable: renderPlan.validationErrors.length === 0,
        blocker: renderPlan.validationErrors[0],
        ...(validationErrors.length ? {} : { recipe }),
        renderPlan,
        assemblyStepFingerprints: packedAssemblySteps.map(assemblyStepFingerprint)
    };
};

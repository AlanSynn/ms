import type { ConnectionSelectionSummary } from './mechanismConnectionSelections';

export type FabricationLayerRole = 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';

export type FabricationLayerShape = {
  label: string;
  role: FabricationLayerRole;
  color: string;
};

export type PhysicalZMm = {
  centerMm: number;
  backFaceMm: number;
  frontFaceMm: number;
  physicalDepthMm: number;
};

export type FabricationRenderKind = 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';

export type FabricationRenderLayer = FabricationLayerShape & PhysicalZMm & {
  source: 'fabrication-stack' | 'mechanism-graph';
  stackIndex: number;
  stackItemIndex?: number;
  occurrence: number;
  z: number;
  renderKind: FabricationRenderKind;
  layerId: string;
  sourceNodeId?: string;
  sourceConstraintIds: string[];
  stackOccurrenceId: string;
  supportPathIds: string[];
  gearPlaneId?: string;
};

export type PackedFabricationLayer = FabricationRenderLayer;

export type RetainedSupportNodeKind = 'board' | 'plate' | 'spacer' | 'washer' | 'clip' | 'fastener-head' | 'fastener-tab';
export type RetainedSupportNodeMm = PhysicalZMm & {
  id: string;
  kind: RetainedSupportNodeKind;
  ownerLayerId?: string;
};

export type RetainedSupportEdgeKind = 'face-contact' | 'retains' | 'pin-through' | 'contact-overlap' | 'guide-capture';
export type RetainedSupportEdgeMm = {
  id: string;
  supportPathId: string;
  kind: RetainedSupportEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  contactFaceMm?: number;
  pinSpanId?: string;
};

export type PinSpanMm = PhysicalZMm & {
  id: string;
  supportPathId: string;
  supportNodeIds: string[];
};

export type PartOwnedPivotExpansion = { pivotNodeId: string; ownerPartId: string; ownerLayerId: string };

export type CompiledSupportPath = {
  id: string;
  sourceKind: 'board' | 'pin-joint' | 'distance-joint' | 'contact' | 'prismatic' | 'generated-joint';
  sourceIds: string[];
  occurrence: number;
  rootNodeId: string;
  orderedLayerIds: string[];
  ownerExpansions: PartOwnedPivotExpansion[];
  edgeIds: string[];
  pinSpanId?: string;
  displayAlias?: string;
};

export type FabricationRenderPlan = {
  base: FabricationRenderLayer;
  layers: FabricationRenderLayer[];
  supportPaths: CompiledSupportPath[];
  supportNodes: RetainedSupportNodeMm[];
  supportEdges: RetainedSupportEdgeMm[];
  pinSpans: PinSpanMm[];
  connectionSelectionSummary?: ConnectionSelectionSummary;
  stackSummary: string;
  roleSummary: string;
  occurrenceSummary: string;
  colorSummary: string;
  zSummary: string;
  validationErrors: string[];
};

export const FABRICATION_Z_RENDER_UNITS_PER_MM = 0.1;
export const FABRICATION_Z_EPSILON_MM = 0.001;
export const BOARD_DEPTH_MM = 0.4;
export const PLATE_DEPTH_MM = 4.0;
export const SPACER_DEPTH_MM = 1.6;
export const CLIP_HEAD_DEPTH_MM = 0.8;
export const FASTENER_TAB_DEPTH_MM = 0.8;
export const PIN_BACK_TERMINAL_MM = 0.8;
export const PIN_FRONT_TERMINAL_MM = 1.8;

export const FABRICATION_RENDER_BASE_Z = 0;
export const FABRICATION_RENDER_LAYER_Z_STEP = SPACER_DEPTH_MM * FABRICATION_Z_RENDER_UNITS_PER_MM;
export const FABRICATION_RENDER_PART_DEPTH = PLATE_DEPTH_MM * FABRICATION_Z_RENDER_UNITS_PER_MM;
export const FABRICATION_RENDER_MIN_CLEARANCE = 0;

export const projectFabricationZMm = (mm: number) => Number((mm * FABRICATION_Z_RENDER_UNITS_PER_MM).toFixed(6));
export const unprojectFabricationZ = (z: number) => Number((z / FABRICATION_Z_RENDER_UNITS_PER_MM).toFixed(6));

export const physicalZ = (backFaceMm: number, physicalDepthMm: number): PhysicalZMm => {
  const frontFaceMm = Number((backFaceMm + physicalDepthMm).toFixed(6));
  return {
    backFaceMm: Number(backFaceMm.toFixed(6)),
    frontFaceMm,
    physicalDepthMm: Number(physicalDepthMm.toFixed(6)),
    centerMm: Number(((backFaceMm + frontFaceMm) / 2).toFixed(6))
  };
};

export const depthForRenderKind = (kind: FabricationRenderKind, label = '') => {
  if (kind === 'base') return BOARD_DEPTH_MM;
  if (kind === 'spacer' || /washer|spacer|axle peg/i.test(label)) return SPACER_DEPTH_MM;
  if (kind === 'clip' || /clip|head|tab|lock disk/i.test(label)) return CLIP_HEAD_DEPTH_MM;
  return PLATE_DEPTH_MM;
};

export const retainedKindForLayer = (layer: Pick<FabricationRenderLayer, 'renderKind' | 'label'>): RetainedSupportNodeKind => {
  if (layer.renderKind === 'base') return 'board';
  if (layer.renderKind === 'spacer') return /washer/i.test(layer.label) ? 'washer' : 'spacer';
  if (layer.renderKind === 'clip') return /tab/i.test(layer.label) ? 'fastener-tab' : /head/i.test(layer.label) ? 'fastener-head' : 'clip';
  return 'plate';
};

type LayerDraft = FabricationLayerShape & {
  source: 'fabrication-stack' | 'mechanism-graph';
  stackIndex: number;
  stackItemIndex?: number;
  occurrence: number;
  renderKind: FabricationRenderKind;
  sourceNodeId?: string;
  sourceConstraintIds?: string[];
  preferredBackFaceMm?: number;
  supportKind?: RetainedSupportNodeKind;
};

type GearPlaneComponent = { id: string; sourceNodeIds: string[] };

type PathDraft = {
  id: string;
  sourceKind: CompiledSupportPath['sourceKind'];
  sourceIds: string[];
  rootNodeId: string;
  orderedDraftIndexes: number[];
  transitionKinds?: Array<'face-contact' | 'contact-overlap' | 'guide-capture'>;
  rootedToBoard: boolean;
  pinBearing: boolean;
  accessoryStackIndex?: number;
  ownerExpansions?: PartOwnedPivotExpansion[];
  displayAlias?: string;
};

const GENERATED_LAYER_COLORS = { spacer: '#f59e0b', clip: '#334155' } as const;

const layerIdForDraft = (graphId: string, draft: LayerDraft) => draft.sourceNodeId
  ? `${graphId}:step:${draft.stackIndex}:node:${draft.sourceNodeId}:occ:${draft.occurrence}`
  : `${graphId}:step:${draft.stackIndex}:kind:${draft.renderKind}:occ:${draft.occurrence}`;

const faceMismatch = (from: PhysicalZMm, to: PhysicalZMm) => Number((to.backFaceMm - from.frontFaceMm).toFixed(6));

export const packFabricationRenderPlan = ({
  graphId,
  layers: drafts,
  validationErrors,
  connectionSelectionSummary,
  gearPlaneComponents = [],
  pathDrafts = []
}: {
  graphId: string;
  layers: LayerDraft[];
  validationErrors: string[];
  connectionSelectionSummary?: ConnectionSelectionSummary;
  gearPlaneComponents?: GearPlaneComponent[];
  pathDrafts?: PathDraft[];
}): FabricationRenderPlan => {
  const packingErrors: string[] = [];
  const gearPlaneBySource = new Map<string, string>();
  gearPlaneComponents.forEach(component => component.sourceNodeIds.forEach(id => gearPlaneBySource.set(id, component.id)));
  const planeFaces = new Map<string, PhysicalZMm>();
  let cursor = 0;
  const layers: FabricationRenderLayer[] = [];
  const layerByDraftIndex = new Map<number, FabricationRenderLayer>();
  const occurrenceByKind = new Map<FabricationRenderKind, number>();
  drafts.forEach(draft => occurrenceByKind.set(draft.renderKind, Math.max(occurrenceByKind.get(draft.renderKind) ?? 0, draft.occurrence + 1)));
  drafts.forEach((draft, index) => {
    const depth = depthForRenderKind(draft.renderKind, draft.label);
    const planeId = draft.sourceNodeId ? gearPlaneBySource.get(draft.sourceNodeId) : undefined;
    let zMm: PhysicalZMm;
    if (typeof draft.preferredBackFaceMm === 'number') {
      zMm = physicalZ(draft.preferredBackFaceMm, depth);
      if (planeId) {
        const existing = planeFaces.get(planeId);
        if (existing && (Math.abs(existing.backFaceMm - zMm.backFaceMm) > FABRICATION_Z_EPSILON_MM || Math.abs(existing.frontFaceMm - zMm.frontFaceMm) > FABRICATION_Z_EPSILON_MM)) {
          packingErrors.push(`Gear plane ${planeId} has conflicting member faces.`);
        } else {
          planeFaces.set(planeId, zMm);
        }
      }
    } else if (planeId) {
      zMm = planeFaces.get(planeId) ?? physicalZ(0, PLATE_DEPTH_MM);
      planeFaces.set(planeId, zMm);
    } else if (draft.renderKind === 'clip' && /back/i.test(draft.label)) {
      zMm = physicalZ(-CLIP_HEAD_DEPTH_MM, CLIP_HEAD_DEPTH_MM);
      cursor = Math.max(cursor, 0);
    } else {
      if (draft.renderKind !== 'clip' || !/front|head|cap|lock/i.test(draft.label)) cursor = Math.max(cursor, 0);
      zMm = physicalZ(cursor, depth);
      cursor = zMm.frontFaceMm;
    }
    const layerId = layerIdForDraft(graphId, draft);
    const stackOccurrenceId = `${draft.stackIndex}:${draft.stackItemIndex ?? index}:${draft.renderKind}:${draft.occurrence}`;
    const layer: FabricationRenderLayer = {
      ...draft,
      ...zMm,
      z: projectFabricationZMm(zMm.centerMm),
      layerId,
      sourceConstraintIds: [...(draft.sourceConstraintIds ?? [])].sort(),
      stackOccurrenceId,
      supportPathIds: [],
      ...(planeId ? { gearPlaneId: planeId } : {})
    };
    layers.push(layer);
    layerByDraftIndex.set(index, layer);
  });
  const baseZ = physicalZ(-BOARD_DEPTH_MM, BOARD_DEPTH_MM);
  const base: FabricationRenderLayer = {
    label: 'Base board', role: 'base', color: '#94a3b8',
    source: drafts[0]?.source ?? 'mechanism-graph', stackIndex: -1, occurrence: 0,
    renderKind: 'base', ...baseZ, z: projectFabricationZMm(baseZ.centerMm),
    layerId: `${graphId}:base`, sourceConstraintIds: [], stackOccurrenceId: '-1:0:base:0', supportPathIds: []
  };
  const supportNodes: RetainedSupportNodeMm[] = [{ id: `${graphId}:support:board`, kind: 'board', ownerLayerId: base.layerId, ...baseZ }];
  const supportNodeByLayer = new Map<string, string>();
  const registerSupportNode = (layer: FabricationRenderLayer, explicitKind?: RetainedSupportNodeKind) => {
    const existing = supportNodeByLayer.get(layer.layerId);
    if (existing) return existing;
    const id = `${layer.layerId}:support`;
    supportNodes.push({ id, kind: explicitKind ?? retainedKindForLayer(layer), ownerLayerId: layer.layerId, ...physicalZ(layer.backFaceMm, layer.physicalDepthMm) });
    supportNodeByLayer.set(layer.layerId, id);
    return id;
  };
  drafts.forEach((draft, index) => {
    const layer = layerByDraftIndex.get(index);
    if (layer) registerSupportNode(layer, draft.supportKind);
  });
  const paths: CompiledSupportPath[] = [];
  const edges: RetainedSupportEdgeMm[] = [];
  const pinSpans: PinSpanMm[] = [];
  const generatedLayer = ({
    path,
    renderKind,
    backFaceMm,
    label,
    ordinal,
    supportKind
  }: {
    path: PathDraft;
    renderKind: 'spacer' | 'clip';
    backFaceMm: number;
    label: string;
    ordinal: number;
    supportKind: RetainedSupportNodeKind;
  }) => {
    const occurrence = occurrenceByKind.get(renderKind) ?? 0;
    occurrenceByKind.set(renderKind, occurrence + 1);
    const draft: LayerDraft = {
      label,
      role: renderKind,
      color: GENERATED_LAYER_COLORS[renderKind],
      source: drafts[0]?.source ?? 'mechanism-graph',
      stackIndex: path.accessoryStackIndex ?? 0,
      stackItemIndex: 1000 + ordinal,
      occurrence,
      renderKind,
      sourceConstraintIds: [...path.sourceIds],
      preferredBackFaceMm: backFaceMm,
      supportKind
    };
    const zMm = physicalZ(backFaceMm, depthForRenderKind(renderKind, label));
    const layer: FabricationRenderLayer = {
      ...draft,
      ...zMm,
      z: projectFabricationZMm(zMm.centerMm),
      layerId: layerIdForDraft(graphId, draft),
      stackOccurrenceId: `${draft.stackIndex}:${draft.stackItemIndex}:${renderKind}:${occurrence}`,
      sourceConstraintIds: [...path.sourceIds].sort(),
      supportPathIds: []
    };
    layers.push(layer);
    registerSupportNode(layer, supportKind);
    return layer;
  };

  const fillGap = (path: PathDraft, from: FabricationRenderLayer, to: FabricationRenderLayer, ordinalBase: number) => {
    const gap = faceMismatch(from, to);
    if (gap < -FABRICATION_Z_EPSILON_MM) {
      packingErrors.push(`Support path ${path.id} has overlapping faces between ${from.layerId} and ${to.layerId}: ${gap.toFixed(3)} mm.`);
      return [];
    }
    if (Math.abs(gap) <= FABRICATION_Z_EPSILON_MM) return [];
    const fillers: FabricationRenderLayer[] = [];
    let cursorMm = from.frontFaceMm;
    let remaining = gap;
    let ordinal = ordinalBase;
    while (remaining >= SPACER_DEPTH_MM - FABRICATION_Z_EPSILON_MM) {
      fillers.push(generatedLayer({ path, renderKind: 'spacer', backFaceMm: cursorMm, label: 'S10 spacer', ordinal, supportKind: 'spacer' }));
      cursorMm = Number((cursorMm + SPACER_DEPTH_MM).toFixed(6));
      remaining = Number((to.backFaceMm - cursorMm).toFixed(6));
      ordinal += 1;
    }
    if (Math.abs(remaining) <= FABRICATION_Z_EPSILON_MM) return fillers;
    if (Math.abs(remaining - CLIP_HEAD_DEPTH_MM) <= FABRICATION_Z_EPSILON_MM) {
      fillers.push(generatedLayer({ path, renderKind: 'clip', backFaceMm: cursorMm, label: 'Retainer shim', ordinal, supportKind: 'clip' }));
      return fillers;
    }
    packingErrors.push(`Support path ${path.id} has an unsupported ${gap.toFixed(3)} mm contact gap between ${from.layerId} and ${to.layerId}.`);
    return fillers;
  };

  const fallbackPath: PathDraft = {
    id: `${graphId}:support:generated:stack:occ:0`,
    sourceKind: 'generated-joint',
    sourceIds: [],
    rootNodeId: 'stack',
    orderedDraftIndexes: drafts.map((_, index) => index),
    rootedToBoard: false,
    pinBearing: false
  };
  const pathInputs = pathDrafts.length ? pathDrafts : drafts.length ? [fallbackPath] : [];
  pathInputs.forEach((draft, occurrence) => {
    const structural = draft.orderedDraftIndexes.map(index => layerByDraftIndex.get(index)).filter(Boolean) as FabricationRenderLayer[];
    const pathId = draft.id;
    if (!structural.length) {
      packingErrors.push(`Support path ${pathId} has no retained structural layer.`);
      return;
    }
    const ordered: FabricationRenderLayer[] = [];
    let generatedOrdinal = 0;
    if (draft.pinBearing && !draft.rootedToBoard) {
      const first = structural[0];
      ordered.push(generatedLayer({ path: draft, renderKind: 'clip', backFaceMm: first.backFaceMm - CLIP_HEAD_DEPTH_MM, label: 'Back Clip', ordinal: generatedOrdinal++, supportKind: 'clip' }));
    }
    structural.forEach((layer, index) => {
      ordered.push(layer);
      const next = structural[index + 1];
      if (!next) return;
      const transition = draft.transitionKinds?.[index] ?? 'face-contact';
      if (transition === 'contact-overlap' || transition === 'guide-capture') return;
      const fillers = fillGap(draft, layer, next, generatedOrdinal);
      generatedOrdinal += fillers.length;
      ordered.push(...fillers);
    });
    if (draft.pinBearing && structural.length === 1) {
      const last = ordered.at(-1)!;
      ordered.push(generatedLayer({ path: draft, renderKind: 'spacer', backFaceMm: last.frontFaceMm, label: 'S10 spacer', ordinal: generatedOrdinal++, supportKind: 'spacer' }));
    }
    if (draft.pinBearing) {
      const last = ordered.at(-1)!;
      ordered.push(generatedLayer({ path: draft, renderKind: 'clip', backFaceMm: last.frontFaceMm, label: 'Front Clip', ordinal: generatedOrdinal++, supportKind: 'fastener-head' }));
    }
    const orderedLayerIds = ordered.map(layer => layer.layerId);
    const supportNodeIds: string[] = [];
    if (draft.rootedToBoard) {
      const tabId = `${pathId}:tab`;
      supportNodes.push({ id: tabId, kind: 'fastener-tab', ...physicalZ(-BOARD_DEPTH_MM - FASTENER_TAB_DEPTH_MM, FASTENER_TAB_DEPTH_MM) });
      supportNodeIds.push(tabId, `${graphId}:support:board`);
    }
    supportNodeIds.push(...orderedLayerIds.map(id => supportNodeByLayer.get(id)).filter(Boolean) as string[]);
    ordered.forEach(layer => {
      if (!layer.supportPathIds.includes(pathId)) layer.supportPathIds.push(pathId);
    });
    const edgeIds: string[] = [];
    for (let i = 0; i < supportNodeIds.length - 1; i += 1) {
      const from = supportNodes.find(node => node.id === supportNodeIds[i]);
      const to = supportNodes.find(node => node.id === supportNodeIds[i + 1]);
      if (!from || !to) {
        packingErrors.push(`Support path ${pathId} has a missing support edge endpoint.`);
        continue;
      }
      const edgeId = `${pathId}:edge:${i}:${supportNodeIds[i]}->${supportNodeIds[i + 1]}`;
      const structuralFromIndex = from.ownerLayerId ? structural.findIndex(layer => layer.layerId === from.ownerLayerId) : -1;
      const structuralToIndex = to.ownerLayerId ? structural.findIndex(layer => layer.layerId === to.ownerLayerId) : -1;
      const structuralTransition = structuralFromIndex >= 0 && structuralToIndex === structuralFromIndex + 1
        ? draft.transitionKinds?.[structuralFromIndex]
        : undefined;
      if (structuralTransition === 'contact-overlap' || structuralTransition === 'guide-capture') {
        const sameFaces = Math.abs(from.backFaceMm - to.backFaceMm) <= FABRICATION_Z_EPSILON_MM
          && Math.abs(from.frontFaceMm - to.frontFaceMm) <= FABRICATION_Z_EPSILON_MM;
        if (!sameFaces) {
          packingErrors.push(`Support path ${pathId} has conflicting ${structuralTransition} faces.`);
          continue;
        }
        edges.push({ id: edgeId, supportPathId: pathId, kind: structuralTransition, fromNodeId: from.id, toNodeId: to.id });
        edgeIds.push(edgeId);
        continue;
      }
      const mismatch = faceMismatch(from, to);
      if (Math.abs(mismatch) > FABRICATION_Z_EPSILON_MM) {
        packingErrors.push(`Support path ${pathId} has a ${mismatch > 0 ? 'gap' : 'overlap'} of ${Math.abs(mismatch).toFixed(3)} mm between ${from.id} and ${to.id}.`);
        continue;
      }
      const kind: RetainedSupportEdgeKind = to.kind === 'clip' || to.kind === 'fastener-head' || to.kind === 'fastener-tab' ? 'retains' : 'face-contact';
      edges.push({ id: edgeId, supportPathId: pathId, kind, fromNodeId: from.id, toNodeId: to.id, contactFaceMm: from.frontFaceMm });
      edgeIds.push(edgeId);
    }
    let pinSpanId: string | undefined;
    if (draft.pinBearing) {
      const retained = supportNodes.filter(node => supportNodeIds.includes(node.id));
      const firstBack = Math.min(...retained.map(node => node.backFaceMm));
      const lastFront = Math.max(...retained.map(node => node.frontFaceMm));
      const back = draft.rootedToBoard ? -BOARD_DEPTH_MM - FASTENER_TAB_DEPTH_MM : firstBack - PIN_BACK_TERMINAL_MM;
      const span = physicalZ(back, lastFront - back + PIN_FRONT_TERMINAL_MM);
      pinSpanId = `${pathId}:pin`;
      pinSpans.push({ id: pinSpanId, supportPathId: pathId, supportNodeIds: [...new Set(supportNodeIds)].sort(), ...span });
      const pinEdgeId = `${pathId}:edge:pin:${supportNodeIds[0]}->${supportNodeIds.at(-1)}`;
      edges.push({ id: pinEdgeId, supportPathId: pathId, kind: 'pin-through', fromNodeId: supportNodeIds[0], toNodeId: supportNodeIds.at(-1)!, pinSpanId });
      edgeIds.push(pinEdgeId);
    }
    paths.push({ id: pathId, sourceKind: draft.sourceKind, sourceIds: [...draft.sourceIds], occurrence, rootNodeId: draft.rootNodeId, orderedLayerIds, ownerExpansions: [...(draft.ownerExpansions ?? [])], edgeIds, ...(pinSpanId ? { pinSpanId } : {}), ...(draft.displayAlias ? { displayAlias: draft.displayAlias } : {}) });
  });
  layers.forEach(layer => layer.supportPathIds.sort());
  layers.sort((a, b) => {
    const aBackRetainer = a.renderKind === 'clip' && a.frontFaceMm <= 0 ? 0 : 1;
    const bBackRetainer = b.renderKind === 'clip' && b.frontFaceMm <= 0 ? 0 : 1;
    return aBackRetainer - bBackRetainer
      || a.stackIndex - b.stackIndex
      || (a.stackItemIndex ?? Number.MAX_SAFE_INTEGER) - (b.stackItemIndex ?? Number.MAX_SAFE_INTEGER)
      || a.occurrence - b.occurrence
      || a.stackOccurrenceId.localeCompare(b.stackOccurrenceId);
  });
  return {
    base,
    layers,
    supportPaths: paths,
    supportNodes,
    supportEdges: edges,
    pinSpans,
    ...(connectionSelectionSummary ? { connectionSelectionSummary } : {}),
    stackSummary: layers.map(item => item.label).join(' → '),
    roleSummary: layers.map(item => item.role).join('>'),
    occurrenceSummary: layers.map(item => `${item.role}#${item.occurrence}:${item.label}`).join('>'),
    colorSummary: layers.map(item => item.color).join(','),
    zSummary: layers.map(item => item.z.toFixed(2)).join(','),
    validationErrors: [...new Set([...validationErrors, ...packingErrors])]
  };
};

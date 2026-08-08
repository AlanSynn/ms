import type { MechanismConfig, PhysicalKitSettings, Point } from '../types';
import { defaultPhysicalKit, SCENE_PX_PER_MM } from './coordinates';
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_WIDTH_MM,
  FABRICATION_MODULE_SPECS,
  FABRICATION_RING_GEAR_SPEC,
  fabricationLinkageSpecForCells
} from './fabricationContract';
import {
  fabricationGearProfileForPitchRadius,
  fabricationRingGearProfileForPitchRadius,
  fabricationRingInnerGearOutlinePoints
} from './fabricationProfiles';
import { sampleMechanismGraphMotion, type MechanismGraph } from './mechanismGraph';
import {
  physicalConnectionAnchorAndSelected,
  physicalConnectionForSourceNode,
  resolveMechanismPhysicalConnections,
  resolvePhysicalLinkageAssetPose,
} from './mechanismConnectionSelections';
import type {
  FabricationRenderKind,
  FabricationRenderLayer,
  FabricationRenderPlan,
  PhysicalZMm,
  RetainedSupportNodeKind
} from './mechanismFabricationZStack';

export type PhysicalVectorMm = Readonly<{ x: number; y: number }>;
export type PhysicalContourMm = readonly PhysicalVectorMm[];
export type PhysicalHoleRole = 'axle' | 'attachment' | 'mount' | 'support';

export type PhysicalPartHole = Readonly<{
  id: string;
  role: PhysicalHoleRole;
  centerMm: PhysicalVectorMm;
  diameterMm: number;
  contourMm: PhysicalContourMm;
}>;

export type PhysicalPartCutout = Readonly<{
  id: string;
  role: 'cutout' | 'slot';
  contourMm: PhysicalContourMm;
}>;

export type MechanismPhysicalPartDefinition = Readonly<{
  partKey: string;
  units: 'mm';
  contourMm: PhysicalContourMm;
  cutouts: readonly PhysicalPartCutout[];
  holes: readonly PhysicalPartHole[];
}>;

export type MechanismPhysicalInstanceKind = FabricationRenderKind | 'pin' | 'retainer';

export type MechanismPhysicalPartInstance = Readonly<{
  instanceId: string;
  partKey: string;
  kind: MechanismPhysicalInstanceKind;
  phaseRad: number;
  pose: Readonly<{ translationMm: PhysicalVectorMm; rotationRad: number }>;
  z: PhysicalZMm;
  layerId?: string;
  sourceNodeId?: string;
  supportNodeId?: string;
  supportNodeKind?: RetainedSupportNodeKind;
  supportPathIds: readonly string[];
  pinSpanId?: string;
}>;

export type CompiledMechanismPhysicalInstances = Readonly<{
  definitions: readonly MechanismPhysicalPartDefinition[];
  instances: readonly MechanismPhysicalPartInstance[];
}>;

const round = (value: number) => Number(value.toFixed(6));
const mmPoint = (point: Point): PhysicalVectorMm => Object.freeze({ x: round(point.x / SCENE_PX_PER_MM), y: round(point.y / SCENE_PX_PER_MM) });
const close = (points: readonly PhysicalVectorMm[]): PhysicalContourMm => {
  const finite = points.map(point => Object.freeze({ x: round(point.x), y: round(point.y) }));
  if (!finite.length) return Object.freeze([]);
  const first = finite[0];
  const last = finite.at(-1)!;
  if (first.x !== last.x || first.y !== last.y) finite.push(first);
  return Object.freeze(finite);
};
const circle = (radius: number, center: PhysicalVectorMm = { x: 0, y: 0 }, segments = 32) => close(
  Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  })
);
const rectangle = (width: number, height: number) => close([
  { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
  { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 }
]);
const rectangleAt = (width: number, height: number, center: PhysicalVectorMm) => close([
  { x: center.x - width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y - height / 2 },
  { x: center.x + width / 2, y: center.y + height / 2 }, { x: center.x - width / 2, y: center.y + height / 2 }
]);
const capsule = (length: number, width: number) => {
  const radius = width / 2;
  const halfStraight = Math.max(0, length / 2);
  return close(Array.from({ length: 34 }, (_, index) => {
    const left = index < 17;
    const angle = (left ? Math.PI / 2 : -Math.PI / 2) + (index % 17) * Math.PI / 16;
    return { x: (left ? -halfStraight : halfStraight) + Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }));
};
const freezeHole = (id: string, role: PhysicalHoleRole, centerMm: PhysicalVectorMm, diameterMm: number): PhysicalPartHole => Object.freeze({
  id,
  role,
  centerMm: Object.freeze({ ...centerMm }),
  diameterMm: round(diameterMm),
  contourMm: circle(diameterMm / 2, centerMm)
});
const freezeDefinition = (
  partKey: string,
  contourMm: PhysicalContourMm,
  holes: readonly PhysicalPartHole[] = [],
  cutouts: readonly PhysicalPartCutout[] = []
): MechanismPhysicalPartDefinition => Object.freeze({
  partKey,
  units: 'mm',
  contourMm,
  holes: Object.freeze([...holes]),
  cutouts: Object.freeze(cutouts.map(cutout => Object.freeze({ ...cutout, contourMm: cutout.contourMm })))
});

const nodeForLayer = (graph: MechanismGraph, layer: FabricationRenderLayer) => graph.nodes.find(node => node.id === layer.sourceNodeId);
const physicalKindForLayer = (layer: FabricationRenderLayer): FabricationRenderKind => layer.sourceNodeId === 'rack' ? 'rack' : layer.renderKind;
const linkageCells = (partKey: string) => Number(/linkage-(\d+)-cell/.exec(partKey)?.[1] ?? 2);
const sourceRelative = (origin: Point, point: Point): PhysicalVectorMm => ({ x: point.x - origin.x, y: point.y - origin.y });
const sourceAssetDefinition = (partKey: string, holes: readonly Point[], holeDiameter: number, role: PhysicalHoleRole) => {
  const origin = holes[0] ?? { x: 0, y: 0 };
  const local = holes.map(point => sourceRelative(origin, point));
  const x = local.map(point => point.x);
  const y = local.map(point => point.y);
  const minX = Math.min(...x, 0);
  const maxX = Math.max(...x, 0);
  const minY = Math.min(...y, 0);
  const maxY = Math.max(...y, 0);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return freezeDefinition(
    partKey,
    rectangleAt(Math.max(FABRICATION_LINKAGE_WIDTH_MM * 2, maxX - minX + FABRICATION_LINKAGE_WIDTH_MM * 2), Math.max(FABRICATION_LINKAGE_WIDTH_MM * 2, maxY - minY + FABRICATION_LINKAGE_WIDTH_MM * 2), center),
    local.map((centerMm, index) => freezeHole(`${role}-${index}`, role, centerMm, holeDiameter)),
  );
};

const definitionForLayer = (
  graph: MechanismGraph,
  mechanism: MechanismConfig,
  layer: FabricationRenderLayer,
  kit: PhysicalKitSettings
): MechanismPhysicalPartDefinition => {
  const node = nodeForLayer(graph, layer);
  const physicalKind = physicalKindForLayer(layer);
  const holeDiameter = kit.holeDiameterMm;
  if (layer.renderKind === 'base') {
    const boardSize = kit.boardCells * kit.gridPitchMm;
    const offset = (kit.boardCells - 1) * kit.gridPitchMm / 2;
    const holes = Array.from({ length: kit.boardCells * kit.boardCells }, (_, index) => freezeHole(
      `board-${index % kit.boardCells}-${Math.floor(index / kit.boardCells)}`,
      'mount',
      { x: index % kit.boardCells * kit.gridPitchMm - offset, y: offset - Math.floor(index / kit.boardCells) * kit.gridPitchMm },
      holeDiameter
    ));
    return freezeDefinition(layer.partKey, rectangle(boardSize, boardSize), holes);
  }
  if (physicalKind === 'linkage') {
    const spec = fabricationLinkageSpecForCells(linkageCells(layer.partKey), kit.gridPitchMm);
    const centerX = (spec.holeCentersMm[0].x + spec.holeCentersMm.at(-1)!.x) / 2;
    const holes = spec.holeCentersMm.map((center, index) => freezeHole(`hole-${index}`, index === 0 ? 'axle' : 'attachment', { x: center.x - centerX, y: 0 }, holeDiameter));
    return freezeDefinition(layer.partKey, capsule(spec.lengthMm, spec.widthMm), holes);
  }
  if (physicalKind === 'gear') {
    if (node?.role === 'ring-gear' || layer.partKey.startsWith('ring_gears:')) {
      const profile = fabricationRingGearProfileForPitchRadius(FABRICATION_RING_GEAR_SPEC.pitchRadiusMm);
      const holes = profile.mountHoleCenters.map((center, index) => freezeHole(`mount-${index}`, 'mount', center, holeDiameter));
      return freezeDefinition(layer.partKey, circle(profile.outerRadius), holes, [Object.freeze({ id: 'ring-teeth', role: 'cutout' as const, contourMm: close(fabricationRingInnerGearOutlinePoints(profile.pitchRadius)) })]);
    }
    const selectedGear = FABRICATION_GEAR_SPECS.find(spec => layer.partKey === `gears:${spec.key}`);
    const pitchRadius = selectedGear?.pitchRadiusMm ?? Math.max(0.001, Math.abs(node?.value ?? mechanism.crankLength) / SCENE_PX_PER_MM);
    const profile = fabricationGearProfileForPitchRadius(pitchRadius);
    const holes = [
      freezeHole('axle', 'axle', { x: 0, y: 0 }, holeDiameter),
      ...profile.attachmentHoleCenters.map((center, index) => freezeHole(`attachment-${index}`, 'attachment', center, holeDiameter))
    ];
    return freezeDefinition(layer.partKey, close(profile.outlinePoints), holes);
  }
  if (physicalKind === 'cam') {
    const baseRadius = Math.max(4, Math.abs(node?.value ?? mechanism.crankLength) / SCENE_PX_PER_MM);
    const samples = mechanism.camProfileSamples?.length ? mechanism.camProfileSamples : [1];
    const contour = close(Array.from({ length: Math.max(32, samples.length) }, (_, index) => {
      const angle = index * Math.PI * 2 / Math.max(32, samples.length);
      const sample = samples[Math.floor(index * samples.length / Math.max(32, samples.length))] ?? 1;
      return { x: Math.cos(angle) * baseRadius * sample, y: Math.sin(angle) * baseRadius * sample };
    }));
    return freezeDefinition(layer.partKey, contour, [freezeHole('axle', 'axle', { x: 0, y: 0 }, holeDiameter)]);
  }
  if (physicalKind === 'rack') {
    const length = Math.max(kit.gridPitchMm * 2, Math.abs(node?.value ?? mechanism.rockerLength) / SCENE_PX_PER_MM);
    return freezeDefinition(layer.partKey, rectangle(length, FABRICATION_LINKAGE_WIDTH_MM), [freezeHole('support', 'support', { x: 0, y: 0 }, holeDiameter)]);
  }
  if (physicalKind === 'guide') {
    const mountSpec = FABRICATION_BOARD_MOUNT_SPECS.find(spec => spec.partKey === layer.partKey);
    if (mountSpec) return sourceAssetDefinition(layer.partKey, mountSpec.sourceHoleCentersMm, holeDiameter, 'mount');
    const length = Math.max(kit.gridPitchMm * 2, Math.abs(node?.value ?? mechanism.rockerLength) / SCENE_PX_PER_MM);
    const slot = rectangle(Math.max(holeDiameter * 2, length - FABRICATION_LINKAGE_WIDTH_MM), holeDiameter * 1.5);
    return freezeDefinition(layer.partKey, rectangle(length, FABRICATION_LINKAGE_WIDTH_MM * 1.5), [], [Object.freeze({ id: 'guide-slot', role: 'slot' as const, contourMm: slot })]);
  }
  if (physicalKind === 'follower') {
    const module = FABRICATION_MODULE_SPECS.find(spec => spec.partKey === layer.partKey);
    if (module) return sourceAssetDefinition(layer.partKey, Object.values(module.holes), holeDiameter, 'attachment');
    return freezeDefinition(layer.partKey, circle(Math.max(5, Math.abs(node?.value ?? 10) / SCENE_PX_PER_MM)), [freezeHole('support', 'support', { x: 0, y: 0 }, holeDiameter)]);
  }
  if (physicalKind === 'spacer') return freezeDefinition(layer.partKey, circle(5), [freezeHole('axle', 'axle', { x: 0, y: 0 }, holeDiameter)]);
  return freezeDefinition(layer.partKey, circle(Math.max(4, holeDiameter)), [freezeHole('axle', 'axle', { x: 0, y: 0 }, holeDiameter)]);
};

const statePoints = (mechanism: MechanismConfig, angle: number, kit: PhysicalKitSettings) => {
  const sample = sampleMechanismGraphMotion(mechanism, angle, kit).state;
  return { p1: sample.p1, p2: sample.p2, j1: sample.j1, j2: sample.j2, ...(sample.aux ? { aux: sample.aux } : {}), effector: sample.effector };
};
const dynamicPoint = (graphPoint: Point | undefined, atZero: ReturnType<typeof statePoints>, atPhase: ReturnType<typeof statePoints>) => {
  if (!graphPoint) return undefined;
  const match = Object.entries(atZero).reduce<{ key?: keyof typeof atZero; distance: number }>((best, [key, point]) => {
    const distance = Math.hypot(point.x - graphPoint.x, point.y - graphPoint.y);
    return distance < best.distance ? { key: key as keyof typeof atZero, distance } : best;
  }, { distance: Number.POSITIVE_INFINITY });
  return match.key && match.distance <= 0.001 ? atPhase[match.key] : graphPoint;
};
const poseForLayer = (
  graph: MechanismGraph,
  mechanism: MechanismConfig,
  layer: FabricationRenderLayer,
  phaseRad: number,
  kit: PhysicalKitSettings,
) => {
  if (layer.renderKind === 'base') return Object.freeze({ translationMm: Object.freeze({ x: 0, y: 0 }), rotationRad: 0 });
  const node = nodeForLayer(graph, layer);
  const atZero = statePoints(mechanism, 0, kit);
  const atPhase = statePoints(mechanism, phaseRad, kit);
  const sourceConnection = physicalConnectionForSourceNode(resolveMechanismPhysicalConnections(mechanism, kit), layer.sourceNodeId);
  const linkagePose = resolvePhysicalLinkageAssetPose(
    sourceConnection,
    physicalConnectionAnchorAndSelected(sourceConnection, atPhase),
  );
  if (linkagePose) return Object.freeze({ translationMm: mmPoint(linkagePose.center), rotationRad: round(linkagePose.rotation) });
  const mounted = sourceConnection?.boardMount;
  if (mounted) return Object.freeze({ translationMm: mmPoint(mounted.origin), rotationRad: round(mounted.sourceRotation) });
  if (node?.id === 'carrier') {
    const pivots = graph.nodes.filter(candidate => candidate.role === 'moving-joint' && candidate.ownerPartId === node.id);
    const a = dynamicPoint(pivots.find(pivot => pivot.id === 'carrier-central-pivot')?.position, atZero, atPhase);
    const b = dynamicPoint(pivots.find(pivot => pivot.id === 'carrier-planet-pivot')?.position, atZero, atPhase);
    if (a && b) return Object.freeze({
      translationMm: mmPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      rotationRad: round(Math.atan2(b.y - a.y, b.x - a.x))
    });
  }
  const distance = graph.constraints.find(constraint => constraint.role === 'distance' && constraint.fabricatedPartNodeId === node?.id);
  if (distance) {
    const aNode = graph.nodes.find(candidate => candidate.id === distance.nodes[0]);
    const bNode = graph.nodes.find(candidate => candidate.id === distance.nodes[1]);
    const a = dynamicPoint(aNode?.position, atZero, atPhase);
    const b = dynamicPoint(bNode?.position, atZero, atPhase);
    if (a && b) return Object.freeze({
      translationMm: mmPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      rotationRad: round(Math.atan2(b.y - a.y, b.x - a.x))
    });
  }
  const point = dynamicPoint(node?.position, atZero, atPhase) ?? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
  const rotates = layer.renderKind === 'gear' || layer.renderKind === 'cam';
  return Object.freeze({ translationMm: mmPoint(point), rotationRad: rotates ? round(phaseRad) : 0 });
};

export const compilePhysicalInstancesFromPlan = (
  mechanism: MechanismConfig,
  graph: MechanismGraph,
  renderPlan: FabricationRenderPlan,
  phaseRad: number,
  kit: PhysicalKitSettings = defaultPhysicalKit()
): CompiledMechanismPhysicalInstances => {
  if (!Number.isFinite(phaseRad)) throw new Error('Physical instance phase must be finite.');
  const layers = [renderPlan.base, ...renderPlan.layers];
  const supportNodeByLayer = new Map(renderPlan.supportNodes.flatMap(node => node.ownerLayerId ? [[node.ownerLayerId, node] as const] : []));
  const pathById = new Map(renderPlan.supportPaths.map(path => [path.id, path]));
  const definitions = new Map<string, MechanismPhysicalPartDefinition>();
  const instances: MechanismPhysicalPartInstance[] = layers.map(layer => {
    if (!definitions.has(layer.partKey)) definitions.set(layer.partKey, definitionForLayer(graph, mechanism, layer, kit));
    const supportNode = supportNodeByLayer.get(layer.layerId);
    const supportPath = layer.supportPathIds.map(id => pathById.get(id)).find(Boolean);
    const root = graph.nodes.find(node => node.id === supportPath?.rootNodeId);
    const layerPose = layer.sourceNodeId
      ? poseForLayer(graph, mechanism, layer, phaseRad, kit)
      : Object.freeze({ translationMm: mmPoint(root?.position ?? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }), rotationRad: 0 });
    return Object.freeze({
      instanceId: layer.layerId,
      partKey: layer.partKey,
      kind: layer.renderKind === 'clip' ? 'retainer' : physicalKindForLayer(layer),
      phaseRad: round(phaseRad),
      pose: layerPose,
      z: Object.freeze({ backFaceMm: layer.backFaceMm, frontFaceMm: layer.frontFaceMm, centerMm: layer.centerMm, physicalDepthMm: layer.physicalDepthMm }),
      layerId: layer.layerId,
      ...(layer.sourceNodeId ? { sourceNodeId: layer.sourceNodeId } : {}),
      ...(supportNode ? { supportNodeId: supportNode.id, supportNodeKind: supportNode.kind } : {}),
      supportPathIds: Object.freeze([...layer.supportPathIds]),
      ...(supportPath?.pinSpanId ? { pinSpanId: supportPath.pinSpanId } : {})
    });
  });
  renderPlan.pinSpans.forEach(span => {
    const partKey = 'hardware:pin';
    if (!definitions.has(partKey)) definitions.set(partKey, freezeDefinition(partKey, circle(kit.holeDiameterMm / 2)));
    const path = pathById.get(span.supportPathId);
    const root = graph.nodes.find(node => node.id === path?.rootNodeId);
    instances.push(Object.freeze({
      instanceId: span.id,
      partKey,
      kind: 'pin',
      phaseRad: round(phaseRad),
      pose: Object.freeze({ translationMm: mmPoint(root?.position ?? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }), rotationRad: 0 }),
      z: Object.freeze({ backFaceMm: span.backFaceMm, frontFaceMm: span.frontFaceMm, centerMm: span.centerMm, physicalDepthMm: span.physicalDepthMm }),
      supportPathIds: Object.freeze([span.supportPathId]),
      pinSpanId: span.id
    }));
  });
  return Object.freeze({ definitions: Object.freeze([...definitions.values()]), instances: Object.freeze(instances) });
};

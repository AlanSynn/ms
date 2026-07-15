import type { JointState, MechanismConfig, PhysicalKitSettings, Point } from '../types';
import { defaultPhysicalKit, SCENE_PX_PER_MM } from './coordinates';
import {
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_LINKAGE_WIDTH_MM,
    FABRICATION_SPACER_SPEC,
    fabricationGearSpecForPitchRadius
} from './fabricationContract';
import { fabricationRingGearProfileForPitchRadius } from './fabricationProfiles';
import {
    calculateLinkage,
    gearTrainCenters,
    gearTrainPitchRadii,
    mechanismSafetyPhaseSchedule,
    normalizeCamProfileSamples
} from './kinematics';
import { planetaryRingPitchRadius } from './fabricationSizing';
import { compileMechanismRenderPlan } from './mechanismCompiler';
import type { FabricationRenderLayer, FabricationRenderPlan } from './mechanismFabricationZStack';
import { foundryPinStackPoints } from './mechanismPreviewStacks';
import {
    physicalConnectionAnchorAndSelected,
    physicalConnectionForSourceNode,
    resolveMechanismPhysicalConnections,
    resolvePhysicalLinkageAssetPose,
} from './mechanismConnectionSelections';

export type MechanismPhysicalEnvelopeDescriptor = {
    layerKey: string;
    mechanismId: string;
    layerId: string;
    sourceNodeId?: string;
    phaseIndex: number;
    phaseRad: number;
    envelope:
        | { kind: 'circle'; x: number; y: number; rotation: 0; radius: number }
        | { kind: 'capsule'; x: number; y: number; rotation: number; length: number; radius: number }
        | { kind: 'oriented-box'; x: number; y: number; rotation: number; width: number; height: number };
    backFaceMm: number;
    frontFaceMm: number;
    role: string;
    collisionClass: 'mechanism-part' | 'owned-hardware';
};

type Envelope = MechanismPhysicalEnvelopeDescriptor['envelope'];
type DescriptorSeed = Omit<MechanismPhysicalEnvelopeDescriptor, 'layerKey' | 'mechanismId' | 'phaseIndex' | 'phaseRad'>;

const positive = (value: number, fallback = 1) => Number.isFinite(value) && value > 0 ? value : fallback;
const point = (value: Point | undefined, fallback: Point): Point =>
    value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : fallback;
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const box = (center: Point, rotation: number, width: number, height: number): Envelope => ({
    kind: 'oriented-box', x: center.x, y: center.y, rotation, width: positive(width), height: positive(height)
});
const circle = (center: Point, radius: number): Envelope => ({
    kind: 'circle', x: center.x, y: center.y, rotation: 0, radius: positive(radius)
});
const capsule = (a: Point, b: Point): Envelope => ({
    kind: 'capsule',
    ...midpoint(a, b),
    rotation: Math.atan2(b.y - a.y, b.x - a.x),
    length: positive(Math.hypot(b.x - a.x, b.y - a.y)),
    radius: FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM / 2
});

const linkageEndpoints = (
    mechanism: MechanismConfig,
    sourceNodeId: string | undefined,
    state: JointState,
    kit: PhysicalKitSettings,
): [Point, Point] => {
    const sourceConnection = physicalConnectionForSourceNode(
        resolveMechanismPhysicalConnections(mechanism, kit),
        sourceNodeId,
    );
    const physicalPose = resolvePhysicalLinkageAssetPose(
        sourceConnection,
        physicalConnectionAnchorAndSelected(sourceConnection, state),
    );
    if (physicalPose) return [physicalPose.start, physicalPose.end];
    const endpoints: Record<string, [Point | undefined, Point | undefined]> = {
        'input-link': [state.p1, state.j1], 'crank-link': [state.p1, state.j1], 'cam-axle': [state.p1, state.aux],
        'coupler-link': [state.j1, state.j2], 'connecting-rod': [state.j1, state.j2],
        'output-link': [state.p2, state.j2], 'slotted-arm': [state.p2, state.j2],
        'left-crank': [state.p1, state.j1], 'right-crank': [state.p2, state.aux],
        'left-coupler': [state.j1, state.j2], 'right-coupler': [state.aux, state.j2],
        'dyad-link': [state.j2, state.aux], 'follower-link': [state.p2, state.aux],
        'connector-link-a': [state.j1, state.effector], 'connector-link-b': [state.j2, state.effector],
        carrier: [state.p1, state.p2]
    };
    const fallback = point(state.p1, { x: 0, y: 0 });
    const [a, b] = endpoints[sourceNodeId ?? ''] ?? [state.j1, state.j2];
    return [point(a, fallback), point(b, fallback)];
};

const gearEnvelope = (mechanism: MechanismConfig, sourceNodeId: string | undefined, state: JointState): Envelope => {
    if (sourceNodeId === 'ring-gear') {
        const ringProfile = fabricationRingGearProfileForPitchRadius(planetaryRingPitchRadius(mechanism) / SCENE_PX_PER_MM);
        return circle(state.p1, ringProfile.outerRadius * SCENE_PX_PER_MM);
    }
    if (sourceNodeId === 'sun-gear') return circle(state.p1, fabricationGearSpecForPitchRadius(mechanism.crankLength / SCENE_PX_PER_MM).outerRadiusMm * SCENE_PX_PER_MM);
    if (sourceNodeId === 'planet-gear') return circle(state.p2, fabricationGearSpecForPitchRadius(mechanism.rockerLength / SCENE_PX_PER_MM).outerRadiusMm * SCENE_PX_PER_MM);
    const radii = gearTrainPitchRadii(mechanism);
    const centers = gearTrainCenters(mechanism);
    const index = Math.max(0, Math.min(Number(/^gear-(\d+)$/.exec(sourceNodeId ?? '')?.[1] ?? 0), radii.length - 1));
    const pitchRadius = sourceNodeId === 'pinion-gear' ? mechanism.crankLength : radii[index] ?? mechanism.crankLength;
    const center = sourceNodeId === 'pinion-gear' ? state.p1 : centers[index] ?? state.p1;
    return circle(center, fabricationGearSpecForPitchRadius(pitchRadius / SCENE_PX_PER_MM).outerRadiusMm * SCENE_PX_PER_MM);
};

const layerEnvelope = (
    mechanism: MechanismConfig,
    layer: FabricationRenderLayer,
    state: JointState,
    kit: PhysicalKitSettings,
): Envelope => {
    const source = layer.sourceNodeId;
    if (layer.renderKind === 'linkage') {
        const [a, b] = linkageEndpoints(mechanism, source, state, kit);
        return capsule(a, b);
    }
    if (layer.renderKind === 'gear') return gearEnvelope(mechanism, source, state);
    if (layer.renderKind === 'cam') {
        const outerScale = Math.max(...normalizeCamProfileSamples(mechanism.camProfileSamples));
        return circle(state.p1, positive(mechanism.crankLength * outerScale));
    }
    const mounted = physicalConnectionForSourceNode(resolveMechanismPhysicalConnections(mechanism, kit), source)?.boardMount;
    if (mounted) {
        const sourceAxis = source === 'follower-guide' ? Math.PI / 2 : 0;
        return box(
            mounted.center,
            mounted.sourceRotation + sourceAxis,
            Math.max(FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.5, mounted.length + FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM),
            FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.5,
        );
    }
    const trackRotation = (mechanism.groundAngle ?? 0) * Math.PI / 180;
    if (source === 'rack') return box(state.j2, trackRotation, positive(mechanism.rockerLength), FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.3);
    if (source === 'slider' || source === 'yoke-slider') return box(state.j2, trackRotation, FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.45, FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.8);
    if (layer.renderKind === 'follower') {
        const rotation = Math.atan2(state.j2.y - state.p1.y, state.j2.x - state.p1.x) - Math.PI / 2;
        return box(state.j2, rotation, FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.45, FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.8);
    }
    const rotation = source === 'follower-guide'
        ? Math.atan2(state.j2.y - state.p1.y, state.j2.x - state.p1.x)
        : source === 'guide' ? Math.PI / 2 : trackRotation;
    const center = source === 'follower-guide'
        ? {
            x: state.p1.x + Math.cos(rotation) * (mechanism.crankLength + mechanism.sliderOffset + mechanism.rockerLength * 0.5),
            y: state.p1.y + Math.sin(rotation) * (mechanism.crankLength + mechanism.sliderOffset + mechanism.rockerLength * 0.5)
        }
        : state.j2;
    return box(center, rotation, (source === 'guide' && mechanism.type === 'rack-pinion' ? 4.8 : 3.2) * 18, FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * 1.35);
};

const descriptor = (
    mechanism: MechanismConfig,
    phaseIndex: number,
    phaseRad: number,
    seed: DescriptorSeed
): MechanismPhysicalEnvelopeDescriptor => ({
    layerKey: `${mechanism.id}:${seed.layerId}`,
    mechanismId: mechanism.id,
    phaseIndex,
    phaseRad,
    ...seed
});

const phaseDescriptors = (
    mechanism: MechanismConfig,
    renderPlan: FabricationRenderPlan,
    phaseRad: number,
    phaseIndex: number,
    kit: PhysicalKitSettings,
): MechanismPhysicalEnvelopeDescriptor[] => {
    const state = calculateLinkage(mechanism, phaseRad, kit);
    const gearCenters = gearTrainCenters(mechanism);
    const pinPoints = foundryPinStackPoints(renderPlan, { state, gearCenters, planetCenters: [state.p2] });
    const seeds: DescriptorSeed[] = [];
    renderPlan.layers.forEach(layer => {
        if (layer.renderKind === 'base') return;
        if (layer.renderKind !== 'clip' && layer.renderKind !== 'spacer') {
            seeds.push({
                layerId: layer.layerId,
                ...(layer.sourceNodeId ? { sourceNodeId: layer.sourceNodeId } : {}),
                envelope: layerEnvelope(mechanism, layer, state, kit),
                backFaceMm: layer.backFaceMm,
                frontFaceMm: layer.frontFaceMm,
                role: layer.role,
                collisionClass: 'mechanism-part'
            });
            return;
        }
        const layerIndex = renderPlan.layers.indexOf(layer);
        pinPoints.filter(pin => pin.layerIndexes.includes(layerIndex)).forEach(pin => seeds.push({
            layerId: `${layer.layerId}:support:${pin.pathId}`,
            envelope: circle(pin.point, (layer.renderKind === 'spacer'
                ? FABRICATION_SPACER_SPEC.outerDiameterMm / 2
                : FABRICATION_HOLE_RADIUS_MM * 1.35) * SCENE_PX_PER_MM),
            backFaceMm: layer.backFaceMm,
            frontFaceMm: layer.frontFaceMm,
            role: layer.role,
            collisionClass: 'owned-hardware'
        }));
    });
    pinPoints.forEach(pin => {
        const span = renderPlan.pinSpans.find(candidate => candidate.id === pin.pinSpanId);
        if (!span) return;
        seeds.push({
            layerId: `pin:${span.id}`,
            envelope: circle(pin.point, FABRICATION_HOLE_RADIUS_MM * 0.8 * SCENE_PX_PER_MM),
            backFaceMm: span.backFaceMm,
            frontFaceMm: span.frontFaceMm,
            role: 'pin',
            collisionClass: 'owned-hardware'
        });
    });
    return seeds.map(seed => descriptor(mechanism, phaseIndex, phaseRad, seed));
};

export const buildMechanismPhysicalEnvelopeDescriptors = (
    mechanism: MechanismConfig,
    phases: readonly number[] | undefined,
    renderPlan: FabricationRenderPlan,
    kit: PhysicalKitSettings,
): MechanismPhysicalEnvelopeDescriptor[] => (phases ?? mechanismSafetyPhaseSchedule(mechanism.type)).flatMap((phaseRad, phaseIndex) =>
    phaseDescriptors(mechanism, renderPlan, phaseRad, phaseIndex, kit)
);

/** Bounded mechanism-only diagnostic for tests and isolated family tooling. */
export const buildLowLevelMechanismPhysicalEnvelopeDescriptors = (
    mechanism: MechanismConfig,
    phases?: readonly number[],
    kit: PhysicalKitSettings = defaultPhysicalKit(),
): MechanismPhysicalEnvelopeDescriptor[] => buildMechanismPhysicalEnvelopeDescriptors(
    mechanism,
    phases,
    compileMechanismRenderPlan(mechanism, kit),
    kit,
);

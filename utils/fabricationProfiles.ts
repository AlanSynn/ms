import type { Point } from '../types';
import { svgNumber } from './numberFormat';
import { SCENE_PX_PER_MM } from './coordinates';
import {
    FABRICATION_HOLE_RADIUS_MM,
    FABRICATION_RING_GEAR_SPEC,
    FABRICATION_SOURCE_SSOT,
    fabricationGearSpecForPitchRadius,
    fabricationRingGearSpecForPitchRadius,
    type FabricationGearSpec,
    type FabricationRingGearSpec
} from './fabricationContract';

export type FabricationGearProfile = {
    source: typeof FABRICATION_SOURCE_SSOT;
    preset: FabricationGearSpec;
    pitchRadius: number;
    rootRadius: number;
    outerRadius: number;
    teeth: number;
    axleHoleRadius: number;
    attachmentHoleCenters: Point[];
    outlinePoints: Point[];
};

export type FabricationRingGearProfile = {
    source: typeof FABRICATION_SOURCE_SSOT;
    key: 'ring-g8-g24';
    internalTeeth: number;
    outerRadius: number;
    pitchRadius: number;
    tipRadius: number;
    rootRadius: number;
    mountHoleCenters: Point[];
    mountHoleRadius: number;
};

const scalePoint = (point: Point, scale: number): Point => ({ x: point.x * scale, y: point.y * scale });

const svgPathFromPoints = (points: Point[]): string => points.length
    ? `M ${points.map(point => `${svgNumber(point.x)} ${svgNumber(point.y)}`).join(' L ')} Z`
    : '';

const circlePathD = (radius: number, cx = 0, cy = 0): string => {
    const r = Math.max(0.001, Math.abs(radius));
    return `M ${svgNumber(cx + r)} ${svgNumber(cy)} A ${svgNumber(r)} ${svgNumber(r)} 0 1 0 ${svgNumber(cx - r)} ${svgNumber(cy)} A ${svgNumber(r)} ${svgNumber(r)} 0 1 0 ${svgNumber(cx + r)} ${svgNumber(cy)} Z`;
};

export const fabricationGearProfileForPitchRadius = (pitchRadius: number, presetPitchRadiusMm = pitchRadius): FabricationGearProfile => {
    const safePitchRadius = Math.max(0.001, Math.abs(pitchRadius));
    const preset = fabricationGearSpecForPitchRadius(presetPitchRadiusMm);
    const scale = safePitchRadius / preset.pitchRadiusMm;
    const rootRadius = preset.rootRadiusMm * scale;
    const outerRadius = preset.outerRadiusMm * scale;
    const toothAngle = (Math.PI * 2) / preset.teeth;
    const outlinePoints: Point[] = [];
    for (let i = 0; i < preset.teeth; i += 1) {
        const base = i * toothAngle;
        [
            { angle: base, radius: rootRadius },
            { angle: base + toothAngle * 0.25, radius: outerRadius },
            { angle: base + toothAngle * 0.5, radius: outerRadius },
            { angle: base + toothAngle * 0.75, radius: rootRadius }
        ].forEach(({ angle, radius }) => outlinePoints.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }));
    }
    return {
        source: FABRICATION_SOURCE_SSOT,
        preset,
        pitchRadius: safePitchRadius,
        rootRadius,
        outerRadius,
        teeth: preset.teeth,
        axleHoleRadius: (preset.holeDiameterMm * scale) / 2,
        attachmentHoleCenters: preset.attachmentHoleCentersMm.map(point => scalePoint(point, scale)),
        outlinePoints
    };
};

export const fabricationGearPathD = (pitchRadius: number, presetPitchRadiusMm = pitchRadius): string => {
    const profile = fabricationGearProfileForPitchRadius(pitchRadius, presetPitchRadiusMm);
    return [
        svgPathFromPoints(profile.outlinePoints),
        circlePathD(profile.axleHoleRadius),
        ...profile.attachmentHoleCenters.map(point => circlePathD(profile.axleHoleRadius, point.x, point.y))
    ].join(' ');
};

export const gearPathD = (radius: number) => fabricationGearPathD(radius, radius / SCENE_PX_PER_MM);

export const fabricationRingGearProfileForPitchRadius = (pitchRadius: number): FabricationRingGearProfile => {
    const safePitchRadius = Math.max(0.001, Math.abs(pitchRadius));
    const preset = fabricationRingGearSpecForPitchRadius(safePitchRadius);
    return {
        source: FABRICATION_SOURCE_SSOT,
        key: preset.key,
        internalTeeth: preset.internalTeeth,
        outerRadius: preset.outerRadiusMm,
        pitchRadius: preset.pitchRadiusMm,
        tipRadius: preset.innerTipRadiusMm,
        rootRadius: preset.innerRootRadiusMm,
        mountHoleCenters: preset.mountHoleCentersMm,
        mountHoleRadius: FABRICATION_HOLE_RADIUS_MM * (preset.pitchRadiusMm / FABRICATION_RING_GEAR_SPEC.pitchRadiusMm)
    };
};

export const fabricationRingInnerGearOutlinePoints = (pitchRadius: number): Point[] => {
    const profile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    const toothAngle = (Math.PI * 2) / profile.internalTeeth;
    const points: Point[] = [];
    for (let i = 0; i < profile.internalTeeth; i += 1) {
        const base = i * toothAngle;
        [
            { angle: base, radius: profile.rootRadius },
            { angle: base + toothAngle * 0.25, radius: profile.tipRadius },
            { angle: base + toothAngle * 0.5, radius: profile.tipRadius },
            { angle: base + toothAngle * 0.75, radius: profile.rootRadius }
        ].forEach(({ angle, radius }) => points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }));
    }
    return points;
};

export const fabricationRingGearPathD = (pitchRadius: number): string => {
    const profile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    const mountHoleRadius = profile.mountHoleRadius;
    return [
        circlePathD(profile.outerRadius),
        svgPathFromPoints(fabricationRingInnerGearOutlinePoints(pitchRadius)),
        ...profile.mountHoleCenters.map(point => circlePathD(mountHoleRadius, point.x, point.y))
    ].join(' ');
};

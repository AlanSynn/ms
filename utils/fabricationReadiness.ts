import type { MechanismConfig } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { fabricationLinkageSpecForSceneLength } from './fabricationStackModel';
import { calculateLinkage, camProfileSmoothnessWarning } from './kinematics';
import { REFERENCE_DEFAULTS } from './mechanismReference';

export type FabricationFeasibleRange = {
    percentValid: number;
    startDeg: number;
    endDeg: number;
    intervals: Array<{ startDeg: number; endDeg: number }>;
    warning: string | null;
};

export type FabricationFeasibilityStatus = 'valid' | 'may-jam' | 'no-motion';

export const feasibilityStatusForRange = (
    range: Pick<FabricationFeasibleRange, 'percentValid' | 'warning'>,
): FabricationFeasibilityStatus => {
    if (range.percentValid <= 0) return 'no-motion';
    return range.warning ? 'may-jam' : 'valid';
};

export const feasibilityLabelForStatus = (status: FabricationFeasibilityStatus) => {
    switch (status) {
        case 'no-motion':
            return 'No motion';
        case 'may-jam':
            return 'May jam';
        default:
            return 'Valid';
    }
};

export const sampleFeasibleRange = (mechanism: MechanismConfig, samples = 96): FabricationFeasibleRange => {
    const profileWarning = mechanism.type === 'cam'
        ? camProfileSmoothnessWarning(mechanism.camProfileSamples)
        : null;
    let valid = 0;
    const validSamples: boolean[] = [];
    const loops = mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'planetary_gear' ? 8 : 1;
    const baseSamples = Math.max(1, Math.round(samples));
    const totalSamples = baseSamples * loops;
    for (let i = 0; i <= totalSamples; i++) {
        const angle = (i / totalSamples) * Math.PI * 2;
        validSamples[i] = calculateLinkage(mechanism, angle).isValid;
        if (validSamples[i]) valid++;
    }
    const intervals: Array<{ startDeg: number; endDeg: number }> = [];
    let start: number | null = null;
    validSamples.forEach((ok, i) => {
        if (ok && start === null) start = i;
        if ((!ok || i === totalSamples) && start !== null) {
            const end = ok && i === totalSamples ? i : i - 1;
            intervals.push({ startDeg: Math.round(start * 360 / totalSamples), endDeg: Math.round(end * 360 / totalSamples) });
            start = null;
        }
    });
    const intervalText = intervals.map(i => `${i.startDeg}°–${i.endDeg}°`).join(', ');
    return {
        percentValid: valid / (totalSamples + 1),
        startDeg: intervals[0]?.startDeg ?? 0,
        endDeg: intervals.at(-1)?.endDeg ?? 0,
        intervals,
        warning: profileWarning ?? (valid === totalSamples + 1 ? null : valid === 0 ? 'No motion' : `Motion ${Math.round((valid / (totalSamples + 1)) * 100)}% · ${intervalText}`)
    };
};

export const physicalTolerance = (value: number) => Math.max(1, Math.abs(value) * 0.03);

export const closePhysicalValue = (actual: number, expected: number) =>
    Math.abs(actual - expected) <= physicalTolerance(expected || actual || 1);

const fabricationPitchMmFor = (mechanism?: Pick<MechanismConfig, 'fabricationMetadata'>) => {
    const pitchMm = mechanism?.fabricationMetadata?.gridPitchMm;
    return typeof pitchMm === 'number' && Number.isFinite(pitchMm) && pitchMm > 0
        ? pitchMm
        : REFERENCE_DEFAULTS.pitchMm;
};

export const closeToBoardPitch = (sceneLength: number, pitchMm: number = REFERENCE_DEFAULTS.pitchMm) => {
    const pitch = pitchMm * SCENE_PX_PER_MM;
    const cells = Math.max(1, Math.round(Math.abs(sceneLength) / Math.max(1, pitch)));
    return closePhysicalValue(Math.abs(sceneLength), cells * pitch);
};

export const closeToFabricationLinkage = (sceneLength: number, minHoleCount = 2, pitchMm: number = REFERENCE_DEFAULTS.pitchMm) => {
    const spec = fabricationLinkageSpecForSceneLength(sceneLength, pitchMm, minHoleCount);
    return closePhysicalValue(Math.abs(sceneLength), spec.lengthMm * SCENE_PX_PER_MM);
};

export const fabricationPitchMmForMechanism = fabricationPitchMmFor;

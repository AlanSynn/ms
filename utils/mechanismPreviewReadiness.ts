import type { MechanismConfig } from '../types';
import { validateFabricationStack } from './fabricationRenderPlan';
import { FABRICATION_LINKAGE_ROLE_MIN_HOLES, planetaryRingPitchRadius } from './fabricationSizing';
import {
    closePhysicalValue,
    closeToBoardPitch,
    closeToFabricationLinkage,
    physicalTolerance,
    sampleFeasibleRange
} from './fabricationReadiness';
import { gearTrainPitchCenterDistance, gearTrainPitchRadii, gearTrainResolvedCenterDistance } from './kinematics';
import { referenceRecipeForType } from './mechanismReference';

export const validateMechanismPreviewReadiness = (mechanism: MechanismConfig): string[] => {
    const errors = [...validateFabricationStack(mechanism)];
    const recipe = referenceRecipeForType(mechanism.type);
    if (!recipe.exportReady) errors.push(recipe.reason ?? 'not fabrication-ready.');

    const physicalNumbers = [
        mechanism.crankLength,
        mechanism.couplerLength,
        mechanism.groundLength,
        mechanism.rockerLength,
        mechanism.sliderOffset,
        mechanism.couplerPointDist,
        mechanism.couplerPointAngle
    ];
    if (mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'piston') physicalNumbers.push(mechanism.rodLength ?? Number.NaN);
    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') physicalNumbers.push(mechanism.gearRatio ?? Number.NaN, mechanism.speed2 ?? Number.NaN);
    if (!physicalNumbers.every(Number.isFinite)) errors.push('bad dimension.');
    if ((mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') && (mechanism.gearRatio ?? 0) === 0) errors.push('gear ratio 0.');

    if (mechanism.type === '4bar') {
        const lengthsAreFabricationSnapped =
            closeToBoardPitch(mechanism.groundLength) &&
            closeToFabricationLinkage(mechanism.crankLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.driver) &&
            closeToFabricationLinkage(mechanism.couplerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.coupler) &&
            closeToFabricationLinkage(mechanism.rockerLength, FABRICATION_LINKAGE_ROLE_MIN_HOLES.output);
        if (!lengthsAreFabricationSnapped) errors.push('snap four-bar linkage lengths.');
    }

    if (mechanism.type === 'gear') {
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) {
            errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'gear_linkage') {
        const radii = gearTrainPitchRadii(mechanism);
        const pitchSpan = gearTrainPitchCenterDistance(mechanism);
        const resolvedSpan = gearTrainResolvedCenterDistance(mechanism);
        const actualGround = Math.abs(mechanism.groundLength);
        if (radii.length > 2) {
            if (!closePhysicalValue(actualGround, pitchSpan) || !closePhysicalValue(resolvedSpan, pitchSpan)) errors.push('snap gear pitch.');
        } else {
            if (actualGround <= pitchSpan + physicalTolerance(pitchSpan)) {
                errors.push('gear linkage endpoint gears must be separated; add idler gears for meshing.');
            }
            if (!closePhysicalValue(actualGround, resolvedSpan)) errors.push('snap gear pitch.');
        }
    }
    if (mechanism.type === 'planetary_gear') {
        const expectedCarrier = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength);
        const expectedRing = Math.abs(mechanism.crankLength) + Math.abs(mechanism.rockerLength) * 2;
        if (!closePhysicalValue(Math.abs(mechanism.groundLength), expectedCarrier)) errors.push('planetary carrier radius must equal sun plus planet.');
        if (!closePhysicalValue(planetaryRingPitchRadius(mechanism), expectedRing)) errors.push('planetary ring radius must equal sun plus two planet radii.');
    }

    const range = sampleFeasibleRange(mechanism);
    if (range.warning?.startsWith('No motion')) errors.push('No motion.');
    return [...new Set(errors.filter(Boolean))];
};

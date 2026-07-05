import type { MechanismConfig, Point } from '../types';
import { planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, planetaryRingPitchRadius as kinematicPlanetaryRingPitchRadius } from './kinematics';
import { FABRICATION_SOURCE_SSOT } from './fabricationContract';
import { fabricationLinkageSpecForSceneLength } from './fabricationStackModel';

export const PLANETARY_GEAR_SYNTAX = 'ring-fixed-sun-input-carrier-output' as const;
export const PLANETARY_GEAR_PLANET_COUNT = 1;

const positiveSceneRadius = (value: number, fallback = 1) => Math.max(1, Math.abs(Number.isFinite(value) ? value : fallback));

export const planetaryCarrierPitchRadius = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>) =>
    Math.max(1, mechanism.groundLength || positiveSceneRadius(mechanism.crankLength) + positiveSceneRadius(mechanism.rockerLength));

export const planetaryRingPitchRadius = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength'>) =>
    kinematicPlanetaryRingPitchRadius(mechanism.crankLength, mechanism.rockerLength);

export const planetaryGearRadii = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength'>): number[] => [
    positiveSceneRadius(mechanism.crankLength),
    ...Array.from({ length: PLANETARY_GEAR_PLANET_COUNT }, () => positiveSceneRadius(mechanism.rockerLength)),
    planetaryRingPitchRadius(mechanism)
];

export const planetaryPlanetCenters = (origin: Point, mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>, carrierAngleRad = 0): Point[] => {
    const radius = planetaryCarrierPitchRadius(mechanism);
    return Array.from({ length: PLANETARY_GEAR_PLANET_COUNT }, (_, index) => {
        const angle = carrierAngleRad + (Math.PI * 2 * index) / PLANETARY_GEAR_PLANET_COUNT;
        return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
    });
};

export const planetaryGearConventionForMechanism = (mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'groundLength'>) => ({
    source: FABRICATION_SOURCE_SSOT,
    syntax: PLANETARY_GEAR_SYNTAX,
    fixedMember: 'ring' as const,
    inputMember: 'sun' as const,
    outputMember: 'carrier' as const,
    planetCount: PLANETARY_GEAR_PLANET_COUNT,
    sunPitchRadius: positiveSceneRadius(mechanism.crankLength),
    planetPitchRadius: positiveSceneRadius(mechanism.rockerLength),
    carrierPitchRadius: planetaryCarrierPitchRadius(mechanism),
    ringPitchRadius: planetaryRingPitchRadius(mechanism),
    carrierOutputRatio: planetaryCarrierOutputRatio(mechanism.crankLength, mechanism.rockerLength),
    planetSpinRatio: planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength),
    pitchRadii: planetaryGearRadii(mechanism)
});

export const FABRICATION_LINKAGE_ROLE_MIN_HOLES: Record<keyof FabricationLinkageRoleLengths, number> = {
    base: 3,
    driver: 3,
    coupler: 4,
    output: 3,
    effector: 2,
    follower: 2
};

export type FabricationLinkageRoleLengths = {
    base: number;
    driver: number;
    coupler: number;
    output: number;
    effector: number;
    follower: number;
};

export const fabricationLinkageHoleCountForSceneLength = (sceneLength: number, pitchMm = 20, minHoleCount = 2) =>
    fabricationLinkageSpecForSceneLength(sceneLength, pitchMm, minHoleCount).holeCentersMm.length;

const minimumSceneLinkageLength = (value: number, fallback = 20) => Math.max(1, Math.abs(Number.isFinite(value) ? value : fallback));

/**
 * Scene-unit linkage blank lengths used before dynamic transforms.
 *
 * This is intentionally fabrication-facing, not renderer-facing: every Three/2D
 * linkage blank should start from the physical span it represents so the drilled
 * holes match the generated SVG linkage templates from
 * fabrication/generate_fabrication_templates.py instead of being stretched from a
 * shorter visual placeholder.
 */
export const fabricationLinkageSceneLengthsForMechanism = (mechanism: Pick<MechanismConfig, 'type' | 'groundLength' | 'crankLength' | 'couplerLength' | 'rockerLength' | 'couplerPointDist' | 'rodLength'>): FabricationLinkageRoleLengths => {
    const output = minimumSceneLinkageLength(Math.max(20, mechanism.couplerPointDist));
    const follower = minimumSceneLinkageLength(Math.max(20, mechanism.rodLength ?? mechanism.couplerPointDist));
    const standard: FabricationLinkageRoleLengths = {
        base: minimumSceneLinkageLength(mechanism.groundLength),
        driver: minimumSceneLinkageLength(mechanism.crankLength),
        coupler: minimumSceneLinkageLength(mechanism.couplerLength),
        output: minimumSceneLinkageLength(mechanism.rockerLength),
        effector: output,
        follower
    };
    if (mechanism.type === 'planetary_gear') {
        const carrier = planetaryCarrierPitchRadius(mechanism);
        return {
            base: carrier,
            driver: carrier,
            coupler: carrier,
            output: carrier,
            effector: output,
            follower
        };
    }
    if (mechanism.type === 'gear') {
        return { ...standard, driver: output, coupler: output, output, effector: output };
    }
    if (mechanism.type === 'gear_linkage') {
        const handle = minimumSceneLinkageLength(Math.max(20, mechanism.couplerPointDist));
        const link = minimumSceneLinkageLength(Math.max(20, mechanism.couplerLength));
        return { ...standard, driver: handle, coupler: link, output: link, effector: link };
    }
    if (mechanism.type === 'rack-pinion') {
        return { ...standard, output, effector: output };
    }
    return standard;
};

export const fabricationLinkageHoleCountsForMechanism = (mechanism: Parameters<typeof fabricationLinkageSceneLengthsForMechanism>[0], pitchMm = 20) => {
    const lengths = fabricationLinkageSceneLengthsForMechanism(mechanism);
    return Object.fromEntries(Object.entries(lengths).map(([role, length]) => [
        role,
        fabricationLinkageHoleCountForSceneLength(length, pitchMm, FABRICATION_LINKAGE_ROLE_MIN_HOLES[role as keyof FabricationLinkageRoleLengths])
    ])) as Record<keyof FabricationLinkageRoleLengths, number>;
};

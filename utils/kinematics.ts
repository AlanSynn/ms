
import { Point, MechanismConfig, JointState, AppSettings, PhysicalKitSettings } from '../types';
import { defaultPhysicalKit, SCENE_PX_PER_MM } from './coordinates';
import { fabricationGearSpecForPitchRadius } from './fabricationContract';
import { normalizeGearLinkageToReference } from './mechanismReference';
import {
    connectionPointAt,
    physicalConnectionForRole,
    resolveMechanismPhysicalConnections,
} from './mechanismConnectionSelections';

const toRad = (deg: number) => (deg * Math.PI) / 180;

const HIGH_DENSITY_SAFETY_PHASE_TYPES = new Set<MechanismConfig['type']>(['5bar', '6bar', 'planetary_gear']);

export const mechanismSafetyPhaseSchedule = (type: MechanismConfig['type']): number[] => {
    const count = HIGH_DENSITY_SAFETY_PHASE_TYPES.has(type) ? 384 : 48;
    return Array.from({ length: count }, (_, index) => (Math.PI * 2 * index) / count);
};

export const synchronizedMechanismSafetyPhaseSchedule = (
    first: MechanismConfig['type'],
    second: MechanismConfig['type']
): number[] => {
    const count = Math.max(mechanismSafetyPhaseSchedule(first).length, mechanismSafetyPhaseSchedule(second).length);
    return Array.from({ length: count }, (_, index) => (Math.PI * 2 * index) / count);
};

export const camProfileScale = (angleRad: number) => 0.72 + 0.2 * (1 - Math.cos(angleRad)) + 0.08 * Math.sin(angleRad * 2);

export const DEFAULT_CAM_PROFILE_SAMPLE_COUNT = 16;
export const defaultCamProfileSamples = (count = DEFAULT_CAM_PROFILE_SAMPLE_COUNT) =>
    Array.from({ length: Math.max(4, Math.round(count)) }, (_, index) => camProfileScale((index / Math.max(4, Math.round(count))) * Math.PI * 2));

export const normalizeCamProfileSamples = (samples?: number[]) => {
    const clean = Array.isArray(samples)
        ? samples.map(value => Number.isFinite(value) ? Math.max(0.35, Math.min(1.65, Math.abs(value))) : Number.NaN).filter(Number.isFinite).slice(0, 64)
        : [];
    return clean.length >= 4 ? clean : defaultCamProfileSamples();
};

export const camProfileSmoothnessWarning = (samples?: number[]) => {
    const profile = normalizeCamProfileSamples(samples);
    const steepDropLimit = 0.55;
    const steepEdge = profile.some((value, index) => {
        const next = profile[(index + 1) % profile.length];
        return Math.abs(next - value) > steepDropLimit;
    });
    return steepEdge ? 'Cam edge too steep. Smooth the profile.' : null;
};

const sampleNormalizedCamProfileScale = (
    angleRad: number,
    profile: readonly number[],
) => {
    if (profile.length < 4) return camProfileScale(angleRad);
    const turns = (((angleRad / (Math.PI * 2)) % 1) + 1) % 1;
    const scaled = turns * profile.length;
    const i0 = Math.floor(scaled) % profile.length;
    const i1 = (i0 + 1) % profile.length;
    const t = scaled - Math.floor(scaled);
    return profile[i0] + (profile[i1] - profile[i0]) * t;
};

export const sampledCamProfileScale = (angleRad: number, samples?: number[]) =>
    sampleNormalizedCamProfileScale(
        angleRad,
        samples && samples.length >= 4 ? normalizeCamProfileSamples(samples) : [],
    );

export const camFollowerRise = (liftLength: number, angleRad: number, samples?: number[]) => {
    const lift = Math.max(1, liftLength);
    const baseScale = sampledCamProfileScale(0, samples);
    const highScale = Math.max(...normalizeCamProfileSamples(samples));
    const fullRiseScale = highScale - baseScale;
    return Math.max(0, sampledCamProfileScale(angleRad, samples) - baseScale) * (lift / Math.max(fullRiseScale, 0.001));
};

const safeRadiusRatio = (numerator: number, denominator: number, fallback: number) => {
    const n = Math.max(0.001, Math.abs(numerator));
    const d = Math.max(0.001, Math.abs(denominator));
    const ratio = n / d;
    return Number.isFinite(ratio) ? ratio : fallback;
};

export const gearPairOutputRatio = (inputPitchRadius: number, outputPitchRadius: number) =>
    -safeRadiusRatio(inputPitchRadius, outputPitchRadius, 1);

const positiveRadius = (value: number, fallback = 1) => {
    const radius = Math.abs(Number.isFinite(value) ? value : fallback);
    return Math.max(1, radius);
};

export const gearTrainPitchRadii = (config: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'gearTrainRadii'>) => {
    const explicit = Array.isArray(config.gearTrainRadii)
        ? config.gearTrainRadii
            .filter(value => Number.isFinite(value) && Math.abs(value) >= 1)
            .slice(0, 8)
            .map(value => positiveRadius(value))
        : [];
    return explicit.length >= 2
        ? [positiveRadius(config.crankLength), ...explicit.slice(1, -1), positiveRadius(config.rockerLength)]
        : [positiveRadius(config.crankLength), positiveRadius(config.rockerLength)];
};

export const gearTrainOutputRatio = (configOrRadii: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'gearTrainRadii'> | number[]) => {
    const radii = (Array.isArray(configOrRadii)
        ? configOrRadii.filter(value => Number.isFinite(value) && Math.abs(value) >= 1).map(value => positiveRadius(value))
        : gearTrainPitchRadii(configOrRadii));
    if (radii.length < 2) return gearPairOutputRatio(radii[0] ?? 1, radii[1] ?? 1);
    const meshCount = radii.length - 1;
    const sign = meshCount % 2 === 1 ? -1 : 1;
    return sign * safeRadiusRatio(radii[0], radii.at(-1) ?? radii[0], 1);
};

export const gearTrainRotationRatioAt = (radii: number[], index: number) => {
    const drive = Math.max(0.001, Math.abs(radii[0] ?? 1));
    const current = Math.max(0.001, Math.abs(radii[index] ?? radii.at(-1) ?? drive));
    return (index % 2 === 1 ? -1 : 1) * drive / current;
};

export const gearTrainMeshPhaseDegAt = (radii: number[], index: number) => {
    if (index % 2 === 0) return 0;
    const sceneRadius = Math.max(1, Math.abs(radii[index] ?? radii.at(-1) ?? radii[0] ?? 1));
    const pitchRadiusMm = sceneRadius / SCENE_PX_PER_MM;
    // ponytail: preview phase follows the generated kit gear preset; move to a render helper if non-kit gears become real.
    const teeth = Math.max(1, fabricationGearSpecForPitchRadius(pitchRadiusMm).teeth);
    return 270 / teeth;
};

export const gearTrainMeshPhaseRadAt = (radii: number[], index: number) =>
    (gearTrainMeshPhaseDegAt(radii, index) * Math.PI) / 180;

export const gearTrainPitchCenterDistance = (config: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'gearTrainRadii'>) => {
    const radii = gearTrainPitchRadii(config);
    return radii.slice(1).reduce((sum, radius, index) => sum + radii[index] + radius, 0);
};

export const gearTrainResolvedCenterDistance = (config: Pick<MechanismConfig, 'groundLength' | 'crankLength' | 'rockerLength' | 'gearTrainRadii'> & Partial<Pick<MechanismConfig, 'type'>>) => {
    const pitchChainDistance = gearTrainPitchCenterDistance(config);
    const radii = gearTrainPitchRadii(config);
    if (radii.length > 2) return pitchChainDistance;
    if (config.type !== 'gear_linkage') return pitchChainDistance;
    const requested = Number.isFinite(config.groundLength) ? Math.abs(config.groundLength ?? 0) : pitchChainDistance;
    // Gear-linkage endpoint gears are intentionally separated: each gear is a
    // driving crank, and inserted idlers are the only optional mesh path. Plain
    // gear trains use direct pitch contact instead.
    if (requested <= pitchChainDistance + 1e-6) return pitchChainDistance * 2;
    return Math.max(requested, pitchChainDistance);
};

export const gearTrainCenters = (config: Pick<MechanismConfig, 'anchorX' | 'anchorY' | 'groundAngle' | 'groundLength' | 'crankLength' | 'rockerLength' | 'gearTrainRadii'>): Point[] => {
    const radii = gearTrainPitchRadii(config);
    const angle = toRad(config.groundAngle ?? 0);
    const origin = { x: config.anchorX ?? 0, y: config.anchorY ?? 0 };
    const resolvedSpan = gearTrainResolvedCenterDistance(config);
    let distance = 0;
    return radii.map((radius, index) => {
        if (index > 0) distance = radii.length === 2 ? resolvedSpan : distance + radii[index - 1] + radius;
        return {
            x: origin.x + distance * Math.cos(angle),
            y: origin.y + distance * Math.sin(angle)
        };
    });
};

export const planetaryRingPitchRadius = (sunPitchRadius: number, planetPitchRadius: number) =>
    positiveRadius(sunPitchRadius) + 2 * positiveRadius(planetPitchRadius);

export const planetaryCarrierOutputRatio = (sunPitchRadius: number, planetPitchRadius: number) => {
    const sun = positiveRadius(sunPitchRadius);
    const ring = planetaryRingPitchRadius(sunPitchRadius, planetPitchRadius);
    return safeRadiusRatio(sun, sun + ring, 0.125);
};

export const planetaryPlanetSpinRatio = (sunPitchRadius: number, planetPitchRadius: number) => {
    const sun = positiveRadius(sunPitchRadius);
    const planet = positiveRadius(planetPitchRadius);
    const carrierRatio = planetaryCarrierOutputRatio(sun, planet);
    return carrierRatio - (sun / planet) * (1 - carrierRatio);
};

export const animationDeltaRadians = (
    dtMs: number,
    durationMs: number,
    speed = 1,
    timingProfile: AppSettings['timingProfile'] = 'linear',
    currentAngleRad = 0
) => {
    const profileRate = timingProfile === 'slow' ? 0.5 : timingProfile === 'presentation' ? 0.75 : 1;
    const periodMs = Math.max(300, durationMs) / Math.max(0.01, speed * profileRate);
    const linearDelta = Math.max(0, dtMs) / periodMs;
    const cycle = (value: number) => ((value % 1) + 1) % 1;
    const ease = (t: number) => {
        if (timingProfile === 'ease-in') return t * t;
        if (timingProfile === 'ease-out') return 1 - (1 - t) * (1 - t);
        if (timingProfile === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
        return t;
    };
    const inverseEase = (y: number) => {
        if (timingProfile === 'ease-in') return Math.sqrt(y);
        if (timingProfile === 'ease-out') return 1 - Math.sqrt(1 - y);
        if (timingProfile === 'ease-in-out') return y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt((1 - y) / 2);
        return y;
    };
    const currentEased = cycle(currentAngleRad / (Math.PI * 2));
    const nextLinear = cycle(inverseEase(currentEased) + linearDelta);
    const nextEased = ease(nextLinear);
    return cycle(nextEased - currentEased) * Math.PI * 2;
};

type PreparedGearKinematics = {
    radii: number[];
    centers: Point[];
    outputRatio: number;
    meshPhaseRad: number;
};

type PreparedGearLinkageKinematics = PreparedGearKinematics & {
    reference: MechanismConfig;
    physicalConnections: ReturnType<typeof resolveMechanismPhysicalConnections>;
};

export type PreparedMechanismKinematics = {
    mechanism: MechanismConfig;
    kit: PhysicalKitSettings;
    physicalConnections: ReturnType<typeof resolveMechanismPhysicalConnections>;
    camProfileSamples?: number[];
    gear?: PreparedGearKinematics;
    gearLinkage?: PreparedGearLinkageKinematics;
};

type MechanismKinematicsPreparationDependencies = {
    resolvePhysicalConnections: typeof resolveMechanismPhysicalConnections;
    normalizeGearLinkage: typeof normalizeGearLinkageToReference;
    normalizeCamProfile: typeof normalizeCamProfileSamples;
    gearMeshPhaseAt: typeof gearTrainMeshPhaseRadAt;
};

const defaultPreparationDependencies: MechanismKinematicsPreparationDependencies = {
    resolvePhysicalConnections: resolveMechanismPhysicalConnections,
    normalizeGearLinkage: normalizeGearLinkageToReference,
    normalizeCamProfile: normalizeCamProfileSamples,
    gearMeshPhaseAt: gearTrainMeshPhaseRadAt,
};

/**
 * Resolve catalog-backed structural inputs once per immutable mechanism edit.
 * Animation callers keep this object and sample only the numeric frame model.
 */
export const prepareMechanismKinematics = (
    mechanism: MechanismConfig,
    kit: PhysicalKitSettings = defaultPhysicalKit(),
    dependencies: Partial<MechanismKinematicsPreparationDependencies> = {},
): PreparedMechanismKinematics => {
    const resolve = { ...defaultPreparationDependencies, ...dependencies };
    const physicalConnections = resolve.resolvePhysicalConnections(mechanism, kit);
    const camProfileSamples = mechanism.type === 'cam'
        && mechanism.camProfileSamples
        && mechanism.camProfileSamples.length >= 4
        ? resolve.normalizeCamProfile(mechanism.camProfileSamples)
        : undefined;
    const gear = mechanism.type === 'gear'
        ? (() => {
            const radii = gearTrainPitchRadii(mechanism);
            return {
                radii,
                centers: gearTrainCenters(mechanism),
                outputRatio: gearTrainOutputRatio(radii),
                meshPhaseRad: resolve.gearMeshPhaseAt(radii, radii.length - 1),
            };
        })()
        : undefined;
    const gearLinkage = mechanism.type === 'gear_linkage'
        ? (() => {
            const reference = resolve.normalizeGearLinkage(mechanism);
            const radii = gearTrainPitchRadii(reference);
            const hasInsertedIdlers = radii.length > 2;
            const directOutputRatio = Number.isFinite(reference.speed2)
                ? (reference.speed2 ?? 1)
                : Number.isFinite(reference.gearRatio)
                    ? (reference.gearRatio ?? 1)
                    : gearTrainOutputRatio(radii);
            return {
                reference,
                physicalConnections: resolve.resolvePhysicalConnections(reference, kit),
                radii,
                centers: gearTrainCenters(reference),
                outputRatio: hasInsertedIdlers
                    ? gearTrainOutputRatio(radii)
                    : directOutputRatio,
                meshPhaseRad: hasInsertedIdlers
                    ? resolve.gearMeshPhaseAt(radii, radii.length - 1)
                    : 0,
            };
        })()
        : undefined;
    return {
        mechanism,
        kit,
        physicalConnections,
        ...(camProfileSamples ? { camProfileSamples } : {}),
        ...(gear ? { gear } : {}),
        ...(gearLinkage ? { gearLinkage } : {}),
    };
};

/**
 * Calculates the intersection of two circles with safety epsilon. 
 */
function getCircleIntersection(p0: Point, r0: number, p1: Point, r1: number, flip: boolean = false): Point | null {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const EPSILON = 0.1; // Safety margin for floating point errors

    // Check if circles are too far apart or one is inside another
    // We use EPSILON to be forgiving at the boundaries (tangent circles)
    if (d > r0 + r1 + EPSILON || d < Math.abs(r0 - r1) - EPSILON || d === 0) {
        return null;
    }

    const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
    const x2 = p0.x + (dx * a) / d;
    const y2 = p0.y + (dy * a) / d;
    
    if (flip) {
        return {
            x: x2 - (h * dy) / d,
            y: y2 + (h * dx) / d
        };
    } else {
        return {
            x: x2 + (h * dy) / d,
            y: y2 - (h * dx) / d
        };
    }
}

export const calculatePreparedLinkage = (
    prepared: PreparedMechanismKinematics,
    crankAngleRad: number,
): JointState => {
    const { mechanism: config, physicalConnections } = prepared;
    // P1: Anchor Point (Main Crank Pivot)
    const p1: Point = { 
        x: config.anchorX ?? 0, 
        y: config.anchorY ?? 0 
    };
    
    // J1: Crank Tip
    // Rotates around P1 based on speed1
    const s1 = config.speed1 ?? 1;
    const driverPhaseOffset = config.driverPhaseOffset ?? 0;
    const angle1 = crankAngleRad * s1 + driverPhaseOffset;
    const invalidPhysicalSelection = !physicalConnections.valid;
    if (invalidPhysicalSelection) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
    const fourBarInput = physicalConnectionForRole(physicalConnections, '4bar.input-joint')?.local;
    const pistonCrank = physicalConnectionForRole(physicalConnections, 'piston.crank-pin')?.local;
    const j1: Point = config.type === '4bar' && fourBarInput
        ? connectionPointAt(fourBarInput, p1, angle1).position
        : config.type === 'piston' && pistonCrank
            ? connectionPointAt(pistonCrank, p1, angle1).position
            : {
                x: p1.x + config.crankLength * Math.cos(angle1),
                y: p1.y + config.crankLength * Math.sin(angle1),
            };

    // --- BASIC CRANK ---
    if (config.type === 'crank') {
        return { p1, p2: p1, j1, j2: j1, effector: j1, isValid: true };
    }

    // --- CAM FOLLOWER ---
    else if (config.type === 'cam') {
        const guideMount = physicalConnectionForRole(physicalConnections, 'cam.guide-mount')?.boardMount;
        const followerOutput = physicalConnectionForRole(physicalConnections, 'cam.follower-output-hole')?.local;
        if (!guideMount || !followerOutput) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
        // The guide SVG is vertical in source space. Its selected ordered board
        // tuple is the transform; a scalar ground angle is only legacy UI state.
        const trackAngle = guideMount.sourceRotation + Math.PI / 2;
        const radius = Math.max(1, config.crankLength);
        const followerRadius = Math.max(0, config.sliderOffset || 0);
        const axis = { x: Math.cos(trackAngle), y: Math.sin(trackAngle) };
        const contactProfileAngle = trackAngle - angle1;
        const contactRadius = radius * sampleNormalizedCamProfileScale(
            contactProfileAngle,
            prepared.camProfileSamples ?? [],
        );
        const guideProjection = (p1.x - guideMount.center.x) * axis.x + (p1.y - guideMount.center.y) * axis.y;
        const contactPoint: Point = {
            x: guideMount.center.x + axis.x * (guideProjection + contactRadius),
            y: guideMount.center.y + axis.y * (guideProjection + contactRadius)
        };
        const followerCenter: Point = {
            x: guideMount.center.x + axis.x * (guideProjection + contactRadius + followerRadius),
            y: guideMount.center.y + axis.y * (guideProjection + contactRadius + followerRadius)
        };
        const driveReference: Point = {
            x: p1.x + radius * Math.cos(angle1),
            y: p1.y + radius * Math.sin(angle1)
        };
        const effector = connectionPointAt(followerOutput, followerCenter, trackAngle - Math.PI / 2).position;
        return { p1, p2: followerCenter, j1: contactPoint, j2: followerCenter, aux: driveReference, effector, isValid: true };
    }

    // --- RACK AND PINION ---
    else if (config.type === 'rack-pinion') {
        const trackAngle = toRad(config.groundAngle ?? 90);
        const radius = Math.max(1, config.crankLength);
        const rackLength = Math.max(radius * 2, config.rockerLength || radius * 3);
        const rackOffset = Number.isFinite(config.sliderOffset) && config.sliderOffset !== 0
            ? config.sliderOffset
            : radius + 12;
        const travel = radius * (angle1 - Math.PI);
        const axis = { x: Math.cos(trackAngle), y: Math.sin(trackAngle) };
        const normal = { x: -Math.sin(trackAngle), y: Math.cos(trackAngle) };
        const rackCenter: Point = {
            x: p1.x + axis.x * travel + normal.x * rackOffset,
            y: p1.y + axis.y * travel + normal.y * rackOffset
        };
        const pinionIndex: Point = {
            x: p1.x + radius * Math.cos(angle1),
            y: p1.y + radius * Math.sin(angle1)
        };
        const effector: Point = {
            x: rackCenter.x + axis.x * Math.min(config.couplerPointDist || rackLength * 0.35, rackLength * 0.5),
            y: rackCenter.y + axis.y * Math.min(config.couplerPointDist || rackLength * 0.35, rackLength * 0.5)
        };
        const maxTravel = Math.max(0, (rackLength - radius * 2) / 2);
        return { p1, p2: rackCenter, j1: pinionIndex, j2: rackCenter, effector, isValid: Math.abs(travel) <= maxTravel + 1e-6 };
    }

    // --- SIMPLE GEAR OUTPUT ---
    else if (config.type === 'gear') {
        const gear = prepared.gear;
        if (!gear) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
        const { radii, centers } = gear;
        const p2 = centers.at(-1) ?? p1;
        const outAngle = angle1 * gear.outputRatio + gear.meshPhaseRad + (config.phase ?? 0);
        const drivePin = physicalConnectionForRole(physicalConnections, 'gear.drive-pin')?.local;
        const outputPin = physicalConnectionForRole(physicalConnections, 'gear.output-pin')?.local;
        if (!drivePin || !outputPin) return { p1, p2, j1: p1, j2: p2, effector: p2, isValid: false };
        const drivePoint = connectionPointAt(drivePin, p1, angle1).position;
        const j2 = connectionPointAt(outputPin, p2, outAngle).position;
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(outAngle + toRad(config.couplerPointAngle)),
            y: j2.y + config.couplerPointDist * Math.sin(outAngle + toRad(config.couplerPointAngle))
        };
        return { p1, p2, j1: drivePoint, j2, aux: centers.length > 2 ? centers[1] : undefined, effector, isValid: true };
    }

    // --- GEAR-DRIVEN TWO-LINK COUPLER ---
    else if (config.type === 'gear_linkage') {
        // Paper-style gear linkage: separated endpoint gear crank pins drive two
        // fabricated rods; inserted idlers are the only gear-coupling path. Both
        // crank pins are real off-center attachment holes.
        const gearLinkage = prepared.gearLinkage;
        if (!gearLinkage) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
        const { reference: referencePair, radii, centers } = gearLinkage;
        const p2 = centers.at(-1) ?? p1;
        const outAngle = angle1 * gearLinkage.outputRatio + gearLinkage.meshPhaseRad + (config.phase ?? 0);
        const driveConnection = physicalConnectionForRole(gearLinkage.physicalConnections, 'gear_linkage.drive-pin')?.local;
        const outputConnection = physicalConnectionForRole(gearLinkage.physicalConnections, 'gear_linkage.output-pin')?.local;
        if (!gearLinkage.physicalConnections.valid || !driveConnection || !outputConnection) {
            return { p1, p2, j1: p1, j2: p2, effector: p1, isValid: false };
        }
        const drivePin = connectionPointAt(driveConnection, centers[0] ?? p1, angle1).position;
        const outputPin = connectionPointAt(outputConnection, centers.at(-1) ?? p2, outAngle).position;
        const linkLength = Math.max(1, Math.abs(referencePair.couplerLength));
        const effector = getCircleIntersection(drivePin, linkLength, outputPin, linkLength, config.assemblyMode !== 'crossed');
        const fallbackEffector = { x: (drivePin.x + outputPin.x) / 2, y: (drivePin.y + outputPin.y) / 2 };
        return {
            p1,
            p2,
            j1: drivePin,
            j2: outputPin,
            aux: centers.length > 2 ? centers[1] : undefined,
            effector: effector ?? fallbackEffector,
            isValid: Boolean(effector)
        };
    }

    // --- PLANETARY GEAR / EPITROCHOID OUTPUT ---
    else if (config.type === 'planetary_gear') {
        const planet = Math.max(1, config.rockerLength || 36);
        const carrierConnection = physicalConnectionForRole(physicalConnections, 'planetary_gear.carrier-planet-pivot')?.local;
        const outputConnection = physicalConnectionForRole(physicalConnections, 'planetary_gear.carrier-output-hole')?.local;
        if (!carrierConnection || !outputConnection) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
        const carrierAngle = angle1 * planetaryCarrierOutputRatio(config.crankLength, planet);
        const spin = angle1 * planetaryPlanetSpinRatio(config.crankLength, planet) + (config.phase ?? 0);
        const center = connectionPointAt(carrierConnection, p1, carrierAngle).position;
        const j2: Point = {
            x: center.x + planet * Math.cos(spin),
            y: center.y + planet * Math.sin(spin)
        };
        const effector = connectionPointAt(outputConnection, p1, carrierAngle).position;
        return { p1, p2: center, j1, j2, aux: center, effector, isValid: true };
    }

    // --- 4-BAR LINKAGE ---
    else if (config.type === '4bar') {
        // P2: Ground Pivot
        // Relative to P1 based on groundLength and groundAngle
        const gAngle = toRad(config.groundAngle ?? 0);
        const p2: Point = { 
            x: p1.x + config.groundLength * Math.cos(gAngle), 
            y: p1.y + config.groundLength * Math.sin(gAngle) 
        };

        const outputLength = physicalConnectionForRole(physicalConnections, '4bar.output-joint')?.local?.length;
        if (!outputLength) return { p1, p2, j1, j2: p1, effector: p1, isValid: false };
        const j2 = getCircleIntersection(j1, config.couplerLength, p2, outputLength, config.assemblyMode !== 'crossed');

        if (!j2) {
            return { p1, p2, j1, j2: p1, effector: p1, isValid: false };
        }

        const couplerAngle = Math.atan2(j2.y - j1.y, j2.x - j1.x);
        const effectorAngle = couplerAngle + toRad(config.couplerPointAngle);
        
        const effector: Point = {
            x: j1.x + config.couplerPointDist * Math.cos(effectorAngle),
            y: j1.y + config.couplerPointDist * Math.sin(effectorAngle),
        };

        return { p1, p2, j1, j2, effector, isValid: true };
    }

    // --- 6-BAR LINKAGE ---
    else if (config.type === '6bar') {
        // Watt-style novice contract:
        // A=P1 and D=P2 are fixed ground pivots. A-B, B-C, C-D form the
        // base four-bar; C-E and D-E add the second dyad/follower.
        const gAngle = toRad(config.groundAngle ?? 0);
        const p2: Point = {
            x: p1.x + config.groundLength * Math.cos(gAngle),
            y: p1.y + config.groundLength * Math.sin(gAngle)
        };

        const j2 = getCircleIntersection(j1, config.couplerLength, p2, config.rockerLength, config.assemblyMode !== 'crossed');
        if (!j2) return { p1, p2, j1, j2: p1, effector: p1, isValid: false };

        const dyadLength = config.rodLength || 95;
        const followerLength = config.couplerPointDist || 95;
        const aux = getCircleIntersection(j2, dyadLength, p2, followerLength, config.assemblyMode !== 'crossed');
        if (!aux) return { p1, p2, j1, j2, effector: p1, isValid: false };

        return { p1, p2, j1, j2, aux, effector: aux, isValid: true };
    }

    // --- 5-BAR LINKAGE ---
    else if (config.type === '5bar') {
        // A=p1 and E=p2 are fixed ground pivots. A-B-C-D-E closes with A-E as
        // the ground link. D is stored in `aux`; C is stored in `j2`.
        const gAngle = toRad(config.groundAngle ?? 0);
        const p2: Point = { 
            x: p1.x + config.groundLength * Math.cos(gAngle), 
            y: p1.y + config.groundLength * Math.sin(gAngle) 
        };

        // D: tip of the right crank, driven by the second input.
        const s2 = config.speed2 ?? (config.gearRatio ?? 1);
        const ph = config.phase ?? 0;
        const angle2 = (crankAngleRad * s2) + ph + driverPhaseOffset;

        const aux: Point = {
            x: p2.x + config.rockerLength * Math.cos(angle2),
            y: p2.y + config.rockerLength * Math.sin(angle2)
        };

        // C: intersection of B-C and D-C.
        const r1 = config.couplerLength;
        const r2 = config.rodLength || 100;

        const intersect = getCircleIntersection(j1, r1, aux, r2, config.assemblyMode !== 'crossed');

        if (!intersect) {
             return { p1, p2, j1, j2: p1, aux, effector: p1, isValid: false };
        }
        
        const j2 = intersect; // Connectivity point

        // Effector extends from J1 through J2
        const dx = j2.x - j1.x;
        const dy = j2.y - j1.y;
        const angle = Math.atan2(dy, dx);
        
        const extension = config.couplerPointDist;
        const effector: Point = {
            x: j2.x + extension * Math.cos(angle),
            y: j2.y + extension * Math.sin(angle)
        };

        return { p1, p2, j1, j2, aux, effector, isValid: true };
    }

    // --- SLIDER CRANK (PISTON) ---
    else if (config.type === 'piston') {
        const guideMount = physicalConnectionForRole(physicalConnections, 'piston.guide-mount')?.boardMount;
        const rodConnection = physicalConnectionForRole(physicalConnections, 'piston.rod-slider-pin')?.local;
        if (!guideMount || !rodConnection) return { p1, p2: p1, j1: p1, j2: p1, effector: p1, isValid: false };
        // The printed piston guide starts horizontal. Its selected board tuple
        // supplies the rotation, including the legal vertical reference tuple.
        const trackAngle = guideMount.sourceRotation;
        const offset = config.sliderOffset || 0;
        const rodLength = rodConnection.length;
        const guideCenter = guideMount.center;

        // Transform J1 to local space where P1 is 0,0 and track is horizontal y = offset
        const dx = j1.x - guideCenter.x;
        const dy = j1.y - guideCenter.y;
        
        const localJ1x = dx * Math.cos(-trackAngle) - dy * Math.sin(-trackAngle);
        const localJ1y = dx * Math.sin(-trackAngle) + dy * Math.cos(-trackAngle);
        
        const localTrackY = offset;
        const dy_link = localTrackY - localJ1y;
        
        if (Math.abs(dy_link) > rodLength) {
             const p2x = guideCenter.x + (localJ1x) * Math.cos(trackAngle) - localTrackY * Math.sin(trackAngle);
             const p2y = guideCenter.y + (localJ1x) * Math.sin(trackAngle) + localTrackY * Math.cos(trackAngle);
             return { p1, p2: {x: p2x, y: p2y}, j1, j2: p1, effector: p1, isValid: false };
        }

        const dx_link = Math.sqrt(rodLength * rodLength - dy_link * dy_link);
        const localJ2x = localJ1x + dx_link;
        const localJ2y = localTrackY;
        
        const j2: Point = {
            x: guideCenter.x + localJ2x * Math.cos(trackAngle) - localJ2y * Math.sin(trackAngle),
            y: guideCenter.y + localJ2x * Math.sin(trackAngle) + localJ2y * Math.cos(trackAngle)
        };

        const couplerAngle = Math.atan2(j2.y - j1.y, j2.x - j1.x);
        const effectorAngle = couplerAngle + toRad(config.couplerPointAngle);

        const effector: Point = {
            x: j1.x + config.couplerPointDist * Math.cos(effectorAngle),
            y: j1.y + config.couplerPointDist * Math.sin(effectorAngle),
        };
        
        return { p1, p2: j2, j1, j2, effector, isValid: true };
    }

    // --- SCOTCH YOKE ---
    else if (config.type === 'yoke') {
        const trackAngle = toRad(config.groundAngle ?? 0);
        const offset = config.sliderOffset || 0;
        
        const dx = j1.x - p1.x;
        const dy = j1.y - p1.y;
        const localJ1x = dx * Math.cos(-trackAngle) - dy * Math.sin(-trackAngle);
        
        const localJ2x = localJ1x;
        const localJ2y = offset;
        
        const j2: Point = {
            x: p1.x + localJ2x * Math.cos(trackAngle) - localJ2y * Math.sin(trackAngle),
            y: p1.y + localJ2x * Math.sin(trackAngle) + localJ2y * Math.cos(trackAngle)
        };
        
        const effectorAngle = trackAngle + toRad(config.couplerPointAngle);
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(effectorAngle),
            y: j2.y + config.couplerPointDist * Math.sin(effectorAngle)
        };

        return { p1, p2: j2, j1, j2, effector, isValid: true };
    }

    // --- QUICK RETURN (Slotted Crank) ---
    else if (config.type === 'quick-return') {
        const gAngle = toRad(config.groundAngle ?? 0);
        const localP2x = config.groundLength;
        const localP2y = config.sliderOffset;
        
        const p2: Point = {
            x: p1.x + localP2x * Math.cos(gAngle) - localP2y * Math.sin(gAngle),
            y: p1.y + localP2x * Math.sin(gAngle) + localP2y * Math.cos(gAngle)
        };
        
        const armAngle = Math.atan2(j1.y - p2.y, j1.x - p2.x);
        
        const j2: Point = {
            x: p2.x + config.rockerLength * Math.cos(armAngle),
            y: p2.y + config.rockerLength * Math.sin(armAngle)
        };
        
        const effAngle = armAngle + toRad(config.couplerPointAngle);
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(effAngle),
            y: j2.y + config.couplerPointDist * Math.sin(effAngle)
        };

        return { p1, p2, j1, j2, effector, isValid: true };
    }

    return { p1, p2: p1, j1, j2: p1, effector: p1, isValid: false };
};

export const calculateLinkage = (
    config: MechanismConfig,
    crankAngleRad: number,
    kit: PhysicalKitSettings = defaultPhysicalKit(),
): JointState => calculatePreparedLinkage(
    prepareMechanismKinematics(config, kit),
    crankAngleRad,
);

export const preparedCamFollowerConstraintError = (
    prepared: PreparedMechanismKinematics,
    state: JointState,
): number => {
    const { mechanism: config, physicalConnections } = prepared;
    if (config.type !== 'cam' || !state.isValid) return Number.POSITIVE_INFINITY;
    const guideMount = physicalConnectionForRole(
        physicalConnections,
        'cam.guide-mount',
    )?.boardMount;
    if (!guideMount) return Number.POSITIVE_INFINITY;
    const trackAngle = guideMount.sourceRotation + Math.PI / 2;
    const axis = { x: Math.cos(trackAngle), y: Math.sin(trackAngle) };
    const guideError = (point: Point) => Math.abs(
        (point.x - guideMount.center.x) * axis.y
        - (point.y - guideMount.center.y) * axis.x,
    );
    const contactGap = Math.abs(
        Math.hypot(state.j2.x - state.j1.x, state.j2.y - state.j1.y)
        - Math.max(0, config.sliderOffset),
    );
    return Math.max(contactGap, guideError(state.j1), guideError(state.j2));
};

export const camFollowerConstraintError = (
    config: MechanismConfig,
    state: JointState,
    kit: PhysicalKitSettings = defaultPhysicalKit(),
): number => preparedCamFollowerConstraintError(
    prepareMechanismKinematics(config, kit),
    state,
);

export const generatePreparedCurvePoints = (
    prepared: PreparedMechanismKinematics,
    resolution: number = 36,
): { points: Point[], percentValid: number } => {
    const points: Point[] = [];
    let validCount = 0;
    const { mechanism: config } = prepared;
    
    // For 5-bar, use more loops to ensure closure for complex ratios
    let loops = 1;
    if (config.type === '5bar' || config.type === '6bar' || config.type === 'planetary_gear') loops = 8;

    const res = resolution * loops;

    for (let i = 0; i < res; i++) {
        const angle = (i / resolution) * 2 * Math.PI;
        const state = calculatePreparedLinkage(prepared, angle);
        if (state.isValid) {
            points.push(state.effector);
            validCount++;
        }
    }

    return { points, percentValid: validCount / res };
};

export const generateCurvePoints = (
    config: MechanismConfig,
    resolution: number = 36,
    kit: PhysicalKitSettings = defaultPhysicalKit(),
): { points: Point[], percentValid: number } => generatePreparedCurvePoints(
    prepareMechanismKinematics(config, kit),
    resolution,
);

export interface MechanismPointTrace {
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
}

export const mechanismTraceDefinitionsForState = (
    type: MechanismConfig['type'],
    state: JointState
): Array<{ id: string; label: string; point?: Point; primary?: boolean }> => {
    if (type === '4bar') return [
        { id: 'B', label: 'B crank joint', point: state.j1 },
        { id: 'C', label: 'C output joint', point: state.j2, primary: true }
    ];
    if (type === '5bar') return [
        { id: 'B', label: 'B left crank joint', point: state.j1 },
        { id: 'C', label: 'C coupler joint', point: state.j2, primary: true },
        { id: 'D', label: 'D right crank joint', point: state.aux }
    ];
    if (type === '6bar') return [
        { id: 'B', label: 'B input crank joint', point: state.j1 },
        { id: 'C', label: 'C four-bar joint', point: state.j2 },
        { id: 'E', label: 'E follower joint', point: state.aux, primary: true }
    ];
    if (type === 'cam') return [
        { id: 'B', label: 'B cam contact', point: state.j1 },
        { id: 'C', label: 'C follower output', point: state.effector, primary: true }
    ];
    if (type === 'planetary_gear') return [
        { id: 'B', label: 'B drive point', point: state.j1 },
        { id: 'C', label: 'C carrier output', point: state.effector, primary: true },
        { id: 'D', label: 'D planet pitch trace', point: state.j2 }
    ];
    if (type === 'crank') return [
        { id: 'B', label: 'B crank pin', point: state.j1, primary: true }
    ];
    if (type === 'gear_linkage') return [
        { id: 'B', label: 'B drive crank pin', point: state.j1 },
        { id: 'C', label: 'C output crank pin', point: state.j2 },
        { id: 'R', label: 'R shared link output', point: state.effector, primary: true }
    ];
    if (type === 'gear') return [
        { id: 'B', label: 'B drive point', point: state.j1 },
        { id: 'C', label: 'C output point', point: state.j2, primary: true }
    ];
    return [
        { id: 'B', label: 'B drive point', point: state.j1 },
        { id: 'C', label: 'C output point', point: state.j2, primary: true }
    ];
};

/**
 * Physical traces shown in Foundry: moving joints/pins, not an arbitrary
 * coupler-effector curve. Keep generateCurvePoints as the optimizer/exporter
 * effector trace; use this helper for point-specific mechanism previews.
 */
export const generateMechanismPointTraces = (
    config: MechanismConfig,
    resolution: number = 36,
    kit: PhysicalKitSettings = defaultPhysicalKit(),
): { traces: MechanismPointTrace[], percentValid: number } => {
    const traces = new Map<string, MechanismPointTrace>();
    let validCount = 0;
    const prepared = prepareMechanismKinematics(config, kit);
    let loops = 1;
    if (config.type === '5bar' || config.type === '6bar' || config.type === 'planetary_gear') loops = 8;
    const res = resolution * loops;

    for (let i = 0; i < res; i++) {
        const angle = (i / resolution) * 2 * Math.PI;
        const state = calculatePreparedLinkage(prepared, angle);
        if (!state.isValid) continue;
        validCount++;
        mechanismTraceDefinitionsForState(config.type, state).forEach(def => {
            if (!def.point || !Number.isFinite(def.point.x) || !Number.isFinite(def.point.y)) return;
            const trace = traces.get(def.id) ?? { id: def.id, label: def.label, points: [], primary: Boolean(def.primary) };
            trace.primary = trace.primary || Boolean(def.primary);
            trace.points.push(def.point);
            traces.set(def.id, trace);
        });
    }

    const allTraces = [...traces.values()].filter(trace => trace.points.length > 1);
    if (allTraces.length && !allTraces.some(trace => trace.primary)) allTraces[allTraces.length - 1].primary = true;
    return { traces: allTraces, percentValid: validCount / res };
};

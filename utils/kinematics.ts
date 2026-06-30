
import { Point, MechanismConfig, JointState, AppSettings } from '../types';
import { normalizeGearLinkageToReference } from './mechanismReference';

const toRad = (deg: number) => (deg * Math.PI) / 180;

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

export const sampledCamProfileScale = (angleRad: number, samples?: number[]) => {
    if (!samples || samples.length < 4) return camProfileScale(angleRad);
    const profile = normalizeCamProfileSamples(samples);
    const turns = (((angleRad / (Math.PI * 2)) % 1) + 1) % 1;
    const scaled = turns * profile.length;
    const i0 = Math.floor(scaled) % profile.length;
    const i1 = (i0 + 1) % profile.length;
    const t = scaled - Math.floor(scaled);
    return profile[i0] + (profile[i1] - profile[i0]) * t;
};

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

export const gearTrainPitchCenterDistance = (config: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'gearTrainRadii'>) => {
    const radii = gearTrainPitchRadii(config);
    return radii.slice(1).reduce((sum, radius, index) => sum + radii[index] + radius, 0);
};

export const gearTrainCenters = (config: Pick<MechanismConfig, 'anchorX' | 'anchorY' | 'groundAngle' | 'crankLength' | 'rockerLength' | 'gearTrainRadii'>): Point[] => {
    const radii = gearTrainPitchRadii(config);
    const angle = toRad(config.groundAngle ?? 0);
    const origin = { x: config.anchorX ?? 0, y: config.anchorY ?? 0 };
    let distance = 0;
    return radii.map((radius, index) => {
        if (index > 0) distance += radii[index - 1] + radius;
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

export const calculateLinkage = (config: MechanismConfig, crankAngleRad: number): JointState => {
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

    const j1: Point = {
        x: p1.x + config.crankLength * Math.cos(angle1),
        y: p1.y + config.crankLength * Math.sin(angle1),
    };

    // --- BASIC CRANK ---
    if (config.type === 'crank') {
        return { p1, p2: p1, j1, j2: j1, effector: j1, isValid: true };
    }

    // --- CAM FOLLOWER ---
    else if (config.type === 'cam') {
        const trackAngle = toRad(config.groundAngle ?? 90);
        const lift = Math.max(1, config.rockerLength || config.crankLength);
        const radius = Math.max(1, config.crankLength);
        const rise = camFollowerRise(lift, angle1, config.camProfileSamples);
        const base = radius + (config.sliderOffset || 0);
        const profileRadius = radius * sampledCamProfileScale(angle1, config.camProfileSamples);
        const p2: Point = {
            x: p1.x + Math.cos(trackAngle) * (base + rise),
            y: p1.y + Math.sin(trackAngle) * (base + rise)
        };
        const camPoint: Point = {
            x: p1.x + profileRadius * Math.cos(angle1),
            y: p1.y + profileRadius * Math.sin(angle1)
        };
        return { p1, p2, j1: camPoint, j2: p2, effector: p2, isValid: true };
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
        const radii = gearTrainPitchRadii(config);
        const centers = gearTrainCenters(config);
        const inputRadius = radii[0];
        const outputRadius = radii.at(-1) ?? config.rockerLength;
        const p2 = centers.at(-1) ?? p1;
        const drivePoint: Point = {
            x: p1.x + inputRadius * Math.cos(angle1),
            y: p1.y + inputRadius * Math.sin(angle1)
        };
        const ratio = gearTrainOutputRatio(radii);
        const outAngle = angle1 * ratio + (config.phase ?? 0);
        const j2: Point = {
            x: p2.x + outputRadius * Math.cos(outAngle),
            y: p2.y + outputRadius * Math.sin(outAngle)
        };
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(outAngle + toRad(config.couplerPointAngle)),
            y: j2.y + config.couplerPointDist * Math.sin(outAngle + toRad(config.couplerPointAngle))
        };
        return { p1, p2, j1: drivePoint, j2, aux: centers.length > 2 ? centers[1] : undefined, effector, isValid: true };
    }

    // --- GEAR-DRIVEN OUTPUT LINKAGE ---
    else if (config.type === 'gear_linkage') {
        // Gear-linkage is a fixed mechanism-reference recipe: two meshed G3 gears only.
        // Do not inherit arbitrary gear-train idlers from a raw config; the output linkage
        // attaches to the driven G3 handle hole, not to a compound train endpoint.
        const referencePair = normalizeGearLinkageToReference(config);
        const radii = gearTrainPitchRadii(referencePair);
        const centers = gearTrainCenters(referencePair);
        const inputRadius = radii[0];
        const outputRadius = radii.at(-1) ?? config.rockerLength;
        const p2 = centers.at(-1) ?? p1;
        const drivePoint: Point = {
            x: p1.x + inputRadius * Math.cos(angle1),
            y: p1.y + inputRadius * Math.sin(angle1)
        };
        const ratio = gearTrainOutputRatio(radii);
        const outAngle = angle1 * ratio + (config.phase ?? 0);
        const handleRadius = Math.max(1, Math.abs(referencePair.couplerPointDist));
        const j2: Point = {
            x: p2.x + handleRadius * Math.cos(outAngle),
            y: p2.y + handleRadius * Math.sin(outAngle)
        };
        const linkLength = Math.max(1, Math.abs(referencePair.couplerLength));
        const effectorAngle = outAngle + toRad(config.couplerPointAngle);
        const effector: Point = {
            x: j2.x + linkLength * Math.cos(effectorAngle),
            y: j2.y + linkLength * Math.sin(effectorAngle)
        };
        return { p1, p2, j1: drivePoint, j2, aux: centers.length > 2 ? centers[1] : undefined, effector, isValid: true };
    }

    // --- PLANETARY GEAR / EPITROCHOID OUTPUT ---
    else if (config.type === 'planetary_gear') {
        const planet = Math.max(1, config.rockerLength || 36);
        const carrier = Math.max(1, config.groundLength || positiveRadius(config.crankLength) + planet);
        const arm = config.couplerPointDist || 65;
        const carrierAngle = angle1 * planetaryCarrierOutputRatio(config.crankLength, planet);
        const spin = angle1 * planetaryPlanetSpinRatio(config.crankLength, planet) + (config.phase ?? 0);
        const center: Point = {
            x: p1.x + carrier * Math.cos(carrierAngle),
            y: p1.y + carrier * Math.sin(carrierAngle)
        };
        const j2: Point = {
            x: center.x + planet * Math.cos(spin),
            y: center.y + planet * Math.sin(spin)
        };
        const effector: Point = {
            x: p1.x + arm * Math.cos(carrierAngle + toRad(config.couplerPointAngle)),
            y: p1.y + arm * Math.sin(carrierAngle + toRad(config.couplerPointAngle))
        };
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

        const j2 = getCircleIntersection(j1, config.couplerLength, p2, config.rockerLength, config.assemblyMode !== 'crossed');

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
        const trackAngle = toRad(config.groundAngle ?? 0);
        const offset = config.sliderOffset || 0;

        // Transform J1 to local space where P1 is 0,0 and track is horizontal y = offset
        const dx = j1.x - p1.x;
        const dy = j1.y - p1.y;
        
        const localJ1x = dx * Math.cos(-trackAngle) - dy * Math.sin(-trackAngle);
        const localJ1y = dx * Math.sin(-trackAngle) + dy * Math.cos(-trackAngle);
        
        const localTrackY = offset;
        const dy_link = localTrackY - localJ1y;
        
        if (Math.abs(dy_link) > config.couplerLength) {
             const p2x = p1.x + (localJ1x) * Math.cos(trackAngle) - localTrackY * Math.sin(trackAngle);
             const p2y = p1.y + (localJ1x) * Math.sin(trackAngle) + localTrackY * Math.cos(trackAngle);
             return { p1, p2: {x: p2x, y: p2y}, j1, j2: p1, effector: p1, isValid: false };
        }

        const dx_link = Math.sqrt(config.couplerLength * config.couplerLength - dy_link * dy_link);
        const localJ2x = localJ1x + dx_link;
        const localJ2y = localTrackY;
        
        const j2: Point = {
            x: p1.x + localJ2x * Math.cos(trackAngle) - localJ2y * Math.sin(trackAngle),
            y: p1.y + localJ2x * Math.sin(trackAngle) + localJ2y * Math.cos(trackAngle)
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

export const generateCurvePoints = (config: MechanismConfig, resolution: number = 36): { points: Point[], percentValid: number } => {
    const points: Point[] = [];
    let validCount = 0;
    
    // For 5-bar, use more loops to ensure closure for complex ratios
    let loops = 1;
    if (config.type === '5bar' || config.type === '6bar' || config.type === 'planetary_gear') loops = 8;

    const res = resolution * loops;

    for (let i = 0; i < res; i++) {
        const angle = (i / resolution) * 2 * Math.PI;
        const state = calculateLinkage(config, angle);
        if (state.isValid) {
            points.push(state.effector);
            validCount++;
        }
    }

    return { points, percentValid: validCount / res };
};

export interface MechanismPointTrace {
    id: string;
    label: string;
    points: Point[];
    primary: boolean;
}

const compactTraceDefinitions = (
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
        { id: 'C', label: 'C follower', point: state.j2, primary: true }
    ];
    if (type === 'planetary_gear') return [
        { id: 'B', label: 'B drive point', point: state.j1 },
        { id: 'C', label: 'C carrier', point: state.p2, primary: true },
        { id: 'D', label: 'D planet pitch trace', point: state.j2 }
    ];
    if (type === 'crank') return [
        { id: 'B', label: 'B crank pin', point: state.j1, primary: true }
    ];
    if (type === 'gear_linkage') return [
        { id: 'B', label: 'B drive point', point: state.j1 },
        { id: 'C', label: 'C output point', point: state.effector, primary: true },
        { id: 'D', label: 'D gear handle', point: state.j2 }
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
export const generateMechanismPointTraces = (config: MechanismConfig, resolution: number = 36): { traces: MechanismPointTrace[], percentValid: number } => {
    const traces = new Map<string, MechanismPointTrace>();
    let validCount = 0;
    let loops = 1;
    if (config.type === '5bar' || config.type === '6bar' || config.type === 'planetary_gear') loops = 8;
    const res = resolution * loops;

    for (let i = 0; i < res; i++) {
        const angle = (i / resolution) * 2 * Math.PI;
        const state = calculateLinkage(config, angle);
        if (!state.isValid) continue;
        validCount++;
        compactTraceDefinitions(config.type, state).forEach(def => {
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

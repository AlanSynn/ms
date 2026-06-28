
import { Point, MechanismConfig, JointState, AppSettings } from '../types';

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const camProfileScale = (angleRad: number) => 0.72 + 0.2 * (1 - Math.cos(angleRad)) + 0.08 * Math.sin(angleRad * 2);

export const camFollowerRise = (liftLength: number, angleRad: number) => {
    const lift = Math.max(1, liftLength);
    const baseScale = camProfileScale(0);
    const fullRiseScale = camProfileScale(Math.PI) - baseScale;
    return Math.max(0, camProfileScale(angleRad) - baseScale) * (lift / Math.max(fullRiseScale, 0.001));
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
        const rise = camFollowerRise(lift, angle1);
        const base = radius + (config.sliderOffset || 0);
        const profileRadius = radius * camProfileScale(angle1);
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

    // --- GEARED 5-BAR LINKAGE ---
    else if (config.type === '5bar') {
        // P2: Secondary Gear Center
        const gAngle = toRad(config.groundAngle ?? 0);
        const p2: Point = { 
            x: p1.x + config.groundLength * Math.cos(gAngle), 
            y: p1.y + config.groundLength * Math.sin(gAngle) 
        };

        // Aux: Tip of Secondary Crank (Right Gear)
        // Rotates at speed2 + phase offset
        const s2 = config.speed2 ?? (config.gearRatio ?? 1);
        const ph = config.phase ?? 0;
        const angle2 = (crankAngleRad * s2) + ph + driverPhaseOffset;
        
        // RockerLength is reused as the radius of the second gear/crank
        const aux: Point = {
            x: p2.x + config.rockerLength * Math.cos(angle2),
            y: p2.y + config.rockerLength * Math.sin(angle2)
        };

        // J2 is the intersection point on the main arm.
        // It is distance 'couplerLength' from J1
        // It is distance 'rodLength' from Aux
        const r1 = config.couplerLength;
        const r2 = config.rodLength || 100;

        const intersect = getCircleIntersection(j1, r1, aux, r2);

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

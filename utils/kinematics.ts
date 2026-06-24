
import { Point, MechanismConfig, JointState, AppSettings } from '../types';

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const animationDeltaRadians = (
    dtMs: number,
    durationMs: number,
    speed = 1,
    timingProfile: AppSettings['timingProfile'] = 'realtime'
) => {
    const profileRate = timingProfile === 'slow' ? 0.5 : timingProfile === 'presentation' ? 0.75 : 1;
    const periodMs = Math.max(300, durationMs) / Math.max(0.01, speed * profileRate);
    return (Math.max(0, dtMs) / periodMs) * Math.PI * 2;
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
    const angle1 = crankAngleRad * s1;

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
        const rise = (1 - Math.cos(angle1)) * 0.5 * lift;
        const base = config.sliderOffset || 0;
        const p2: Point = {
            x: p1.x + Math.cos(trackAngle) * (base + rise),
            y: p1.y + Math.sin(trackAngle) * (base + rise)
        };
        const camPoint: Point = {
            x: p1.x + radius * (1 + 0.18 * Math.sin(angle1 * 2)) * Math.cos(angle1),
            y: p1.y + radius * (1 + 0.18 * Math.sin(angle1 * 2)) * Math.sin(angle1)
        };
        return { p1, p2, j1: camPoint, j2: p2, effector: p2, isValid: true };
    }

    // --- SIMPLE GEAR OUTPUT ---
    else if (config.type === 'gear') {
        const gAngle = toRad(config.groundAngle ?? 0);
        const p2: Point = {
            x: p1.x + config.groundLength * Math.cos(gAngle),
            y: p1.y + config.groundLength * Math.sin(gAngle)
        };
        const ratio = config.gearRatio ?? config.speed2 ?? -1;
        const outAngle = -angle1 * ratio + (config.phase ?? 0);
        const j2: Point = {
            x: p2.x + config.rockerLength * Math.cos(outAngle),
            y: p2.y + config.rockerLength * Math.sin(outAngle)
        };
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(outAngle + toRad(config.couplerPointAngle)),
            y: j2.y + config.couplerPointDist * Math.sin(outAngle + toRad(config.couplerPointAngle))
        };
        return { p1, p2, j1, j2, effector, isValid: true };
    }

    // --- PLANETARY GEAR / EPITROCHOID OUTPUT ---
    else if (config.type === 'planetary_gear') {
        const carrier = Math.max(1, config.groundLength || 90);
        const planet = Math.max(1, config.rockerLength || 36);
        const arm = config.couplerPointDist || 65;
        const ratio = config.gearRatio ?? config.speed2 ?? 3;
        const center: Point = {
            x: p1.x + carrier * Math.cos(angle1),
            y: p1.y + carrier * Math.sin(angle1)
        };
        const spin = -angle1 * ratio + (config.phase ?? 0);
        const j2: Point = {
            x: center.x + planet * Math.cos(spin),
            y: center.y + planet * Math.sin(spin)
        };
        const effector: Point = {
            x: center.x + arm * Math.cos(spin + toRad(config.couplerPointAngle)),
            y: center.y + arm * Math.sin(spin + toRad(config.couplerPointAngle))
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

        const j2 = getCircleIntersection(j1, config.couplerLength, p2, config.rockerLength);

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
        const angle2 = (crankAngleRad * s2) + ph;
        
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
        
        const effector: Point = {
            x: j2.x + config.couplerPointDist * Math.cos(toRad(config.couplerPointAngle)),
            y: j2.y + config.couplerPointDist * Math.sin(toRad(config.couplerPointAngle)) 
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
    if (config.type === '5bar' || config.type === 'planetary_gear') loops = 8;

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

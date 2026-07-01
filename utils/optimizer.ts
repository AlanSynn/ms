
import { MechanismConfig, Point, MechanismType } from '../types';
import { gearTrainOutputRatio, gearTrainResolvedCenterDistance, generateCurvePoints, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from './kinematics';
import { AUTHORABLE_MECHANISM_TYPES } from './mechanismTemplates';
import { normalizeGearLinkageToReference } from './mechanismReference';

export const OPTIMIZER_MECHANISM_TYPES: MechanismType[] = [...AUTHORABLE_MECHANISM_TYPES];

// Proven harmonic gear ratio pairs for clean, closed 5-bar curves
// Each produces a distinct, predictable pattern
const FIVE_BAR_HARMONIC_RATIOS: { s1: number; s2: number; name: string }[] = [
    // Co-rotating (Rose curves)
    { s1: 1, s2: 1, name: 'circle' },
    { s1: 1, s2: 2, name: 'cardioid' },
    { s1: 1, s2: 3, name: 'trefoil' },
    { s1: 1, s2: 4, name: 'quatrefoil' },
    { s1: 2, s2: 3, name: 'rose-2-3' },
    { s1: 2, s2: 5, name: 'rose-2-5' },
    { s1: 3, s2: 4, name: 'rose-3-4' },
    // Counter-rotating (Lissajous-like)
    { s1: 1, s2: -1, name: 'ellipse' },
    { s1: 1, s2: -2, name: 'figure-8' },
    { s1: 1, s2: -3, name: 'tri-loop' },
    { s1: 1, s2: -4, name: 'quad-loop' },
    { s1: 2, s2: -3, name: 'lissajous-2-3' },
    { s1: 2, s2: -5, name: 'lissajous-2-5' },
    { s1: 3, s2: -4, name: 'lissajous-3-4' },
    { s1: 3, s2: -5, name: 'lissajous-3-5' },
];

// Phase samples to try for 5-bar (covers full rotation)
const PHASE_SAMPLES = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2, 2 * Math.PI / 3, 3 * Math.PI / 4, 5 * Math.PI / 6, Math.PI];

// Legacy ratios for backward compatibility
const HARMONIC_RATIOS = [1, 2, 3, 4, 0.5, 0.25, 1.5, 0.666, 2.5, 0.4, 1.333, 0.75, 1.25, 0.8, -1, -2, -3, -4, -0.5, -0.25, -1.5, -0.666, -2.5, -0.4, -1.333, -0.75, -1.25, -0.8];

export const getBounds = (points: Point[]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    });
    return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};

// Resample a path to uniform point count for fair comparison
const resamplePath = (points: Point[], targetCount: number): Point[] => {
    if (points.length < 2) return points;

    // Calculate total path length
    let totalLen = 0;
    for (let i = 1; i < points.length; i++) {
        totalLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }

    const segmentLen = totalLen / (targetCount - 1);
    const result: Point[] = [points[0]];
    let accumulated = 0;
    let srcIdx = 0;

    for (let i = 1; i < targetCount; i++) {
        const targetDist = i * segmentLen;
        while (srcIdx < points.length - 1) {
            const dx = points[srcIdx + 1].x - points[srcIdx].x;
            const dy = points[srcIdx + 1].y - points[srcIdx].y;
            const segLen = Math.hypot(dx, dy);

            if (accumulated + segLen >= targetDist) {
                const t = (targetDist - accumulated) / segLen;
                result.push({
                    x: points[srcIdx].x + dx * t,
                    y: points[srcIdx].y + dy * t
                });
                break;
            }
            accumulated += segLen;
            srcIdx++;
        }
    }

    // Ensure we have the right count
    while (result.length < targetCount && points.length > 0) {
        result.push(points[points.length - 1]);
    }

    return result;
};

// Compute Fourier descriptors for shape matching (rotation/scale invariant)
const computeFourierDescriptors = (points: Point[], numCoeffs: number = 12): number[] => {
    if (points.length < 4) return [];

    const resampled = resamplePath(points, 64);
    const n = resampled.length;

    // Compute centroid
    let cx = 0, cy = 0;
    for (const p of resampled) { cx += p.x; cy += p.y; }
    cx /= n; cy /= n;

    // Compute DFT coefficients (magnitude only for rotation invariance)
    const descriptors: number[] = [];
    for (let k = 1; k <= numCoeffs; k++) {
        let realX = 0, imagX = 0, realY = 0, imagY = 0;
        for (let j = 0; j < n; j++) {
            const angle = (2 * Math.PI * k * j) / n;
            realX += (resampled[j].x - cx) * Math.cos(angle);
            imagX += (resampled[j].x - cx) * Math.sin(angle);
            realY += (resampled[j].y - cy) * Math.cos(angle);
            imagY += (resampled[j].y - cy) * Math.sin(angle);
        }
        // Store magnitude (scale-independent when normalized)
        const mag = Math.sqrt(realX * realX + imagX * imagX + realY * realY + imagY * imagY);
        descriptors.push(mag);
    }

    // Normalize by first non-zero coefficient for scale invariance
    const norm = descriptors[0] || 1;
    return descriptors.map(d => d / norm);
};

// Compute shape similarity using Fourier descriptors (0 = identical, higher = different)
const fourierShapeError = (path1: Point[], path2: Point[]): number => {
    const desc1 = computeFourierDescriptors(path1);
    const desc2 = computeFourierDescriptors(path2);

    if (desc1.length === 0 || desc2.length === 0) return 1e6;

    let error = 0;
    const weights = [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.08, 0.06];
    for (let i = 0; i < Math.min(desc1.length, desc2.length); i++) {
        const w = weights[i] || 0.05;
        error += w * Math.abs(desc1[i] - desc2[i]);
    }

    return error * 1000; // Scale to be comparable with chamfer distance
};

// Compute how well a curve closes (for periodic mechanisms)
const computeClosureQuality = (points: Point[]): number => {
    if (points.length < 10) return 1e6;

    const start = points[0];
    const end = points[points.length - 1];
    const gap = Math.hypot(start.x - end.x, start.y - end.y);

    // Also check tangent continuity at closure
    const startTangent = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
    const endTangent = { x: points[points.length - 1].x - points[points.length - 2].x, y: points[points.length - 1].y - points[points.length - 2].y };

    const dot = startTangent.x * endTangent.x + startTangent.y * endTangent.y;
    const mag1 = Math.hypot(startTangent.x, startTangent.y) || 1;
    const mag2 = Math.hypot(endTangent.x, endTangent.y) || 1;
    const tangentSimilarity = Math.abs(dot / (mag1 * mag2)); // 1 = same direction

    const tangentPenalty = (1 - tangentSimilarity) * 100;

    return gap * 10 + tangentPenalty;
};

// Count approximate number of loops/petals in a curve
const countCurveLoops = (points: Point[]): number => {
    if (points.length < 10) return 0;

    const bounds = getBounds(points);
    const cx = bounds.cx, cy = bounds.cy;

    // Count sign changes in angle from center
    let crossings = 0;
    let lastPositive: boolean | null = null;

    for (const p of points) {
        const angle = Math.atan2(p.y - cy, p.x - cx);
        const isPositive = angle >= 0;
        if (lastPositive !== null && isPositive !== lastPositive) {
            crossings++;
        }
        lastPositive = isPositive;
    }

    return Math.floor(crossings / 2);
};

// Compute turning function - cumulative direction change along curve
const computeTurningFunction = (points: Point[], numSamples: number = 64): number[] => {
    if (points.length < 4) return [];

    const resampled = resamplePath(points, numSamples);
    const n = resampled.length;
    const turns: number[] = [];
    let cumAngle = 0;

    for (let i = 1; i < n; i++) {
        const dx = resampled[i].x - resampled[i - 1].x;
        const dy = resampled[i].y - resampled[i - 1].y;
        const angle = Math.atan2(dy, dx);

        if (i === 1) {
            cumAngle = angle;
        } else {
            // Handle angle wrapping
            let delta = angle - turns[turns.length - 1] % (2 * Math.PI);
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            cumAngle += delta;
        }
        turns.push(cumAngle);
    }

    // Normalize to [0, 2π] range for comparison
    const minT = Math.min(...turns);
    return turns.map(t => t - minT);
};

// Compute turning function distance between two curves
const turningDistance = (curve1: Point[], curve2: Point[]): number => {
    const turn1 = computeTurningFunction(curve1);
    const turn2 = computeTurningFunction(curve2);

    if (turn1.length === 0 || turn2.length === 0) return 1e6;

    // Try different cyclic offsets to find best alignment
    let bestDist = Infinity;
    const n = Math.min(turn1.length, turn2.length);

    for (let offset = 0; offset < n; offset += Math.max(1, Math.floor(n / 16))) {
        let dist = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + offset) % n;
            dist += Math.abs(turn1[i] - turn2[j]);
        }
        dist /= n;
        if (dist < bestDist) bestDist = dist;
    }

    return bestDist * 100; // Scale to be comparable
};

// Find best cyclic alignment between generated and target curves
const findBestCyclicOffset = (generated: Point[], target: Point[]): number => {
    if (generated.length < 10 || target.length < 10) return 0;

    const gBounds = getBounds(generated);
    const tBounds = getBounds(target);

    // Normalize both curves to same center
    const gNorm = generated.map(p => ({ x: p.x - gBounds.cx, y: p.y - gBounds.cy }));
    const tNorm = target.map(p => ({ x: p.x - tBounds.cx, y: p.y - tBounds.cy }));

    // Try different starting points
    let bestOffset = 0;
    let bestError = Infinity;

    const step = Math.max(1, Math.floor(gNorm.length / 32));
    for (let offset = 0; offset < gNorm.length; offset += step) {
        let error = 0;
        for (let i = 0; i < Math.min(32, tNorm.length); i++) {
            const tIdx = Math.floor(i * tNorm.length / 32);
            const gIdx = (Math.floor(i * gNorm.length / 32) + offset) % gNorm.length;
            error += Math.hypot(gNorm[gIdx].x - tNorm[tIdx].x, gNorm[gIdx].y - tNorm[tIdx].y);
        }
        if (error < bestError) {
            bestError = error;
            bestOffset = offset;
        }
    }

    return bestOffset;
};

// Recommend best gear ratio based on target path characteristics
const recommendGearRatio = (targetPath: Point[]): { s1: number; s2: number } => {
    const loops = countCurveLoops(targetPath);
    const bounds = getBounds(targetPath);
    const aspectRatio = (bounds.w || 1) / (bounds.h || 1);

    // Check if path crosses itself (figure-8 like)
    const isFigure8 = detectSelfCrossing(targetPath);

    if (isFigure8) {
        return { s1: 1, s2: -2 }; // Figure-8 pattern
    } else if (loops <= 1) {
        // Simple closed loop
        if (Math.abs(aspectRatio - 1) < 0.3) {
            return { s1: 1, s2: 1 }; // Circle
        } else {
            return { s1: 1, s2: -1 }; // Ellipse
        }
    } else if (loops === 2) {
        return { s1: 1, s2: 2 }; // Cardioid
    } else if (loops === 3) {
        return { s1: 1, s2: 3 }; // Trefoil
    } else {
        return { s1: 2, s2: 3 }; // Complex rose
    }
};

// Detect if a curve crosses itself (figure-8 detection)
const detectSelfCrossing = (points: Point[]): boolean => {
    if (points.length < 20) return false;

    const step = Math.max(1, Math.floor(points.length / 20));
    for (let i = 0; i < points.length - step * 3; i += step) {
        for (let j = i + step * 2; j < points.length - step; j += step) {
            // Check if line segment i-i+step crosses segment j-j+step
            if (lineSegmentsIntersect(
                points[i], points[i + step],
                points[j], points[j + step]
            )) {
                return true;
            }
        }
    }
    return false;
};

// Check if two line segments intersect
const lineSegmentsIntersect = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
    const d1 = direction(p3, p4, p1);
    const d2 = direction(p3, p4, p2);
    const d3 = direction(p1, p2, p3);
    const d4 = direction(p1, p2, p4);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    return false;
};

const direction = (p1: Point, p2: Point, p3: Point): number => {
    return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
};

export const evaluateFitness = (config: MechanismConfig, targetPath: Point[]): number => {
    // For 5-bar, we need more points to check for loop closure and detail
    const resolution = config.type === '5bar' || config.type === '6bar' ? 120 : 60;
    const { points: generatedPath, percentValid } = generateCurvePoints(config, resolution);

    // CRITICAL: Heavy penalty for any invalidity (breaking/locking)
    if (percentValid < 1) {
        return 1e9 + (1.0 - percentValid) * 1e9;
    }

    if (generatedPath.length < 10) return 1e9;

    // Bidirectional Chamfer Distance
    let forwardError = 0;
    for (const pg of generatedPath) {
        let minD = Infinity;
        for (const pt of targetPath) {
            const d = (pg.x - pt.x) ** 2 + (pg.y - pt.y) ** 2;
            if (d < minD) minD = d;
        }
        forwardError += minD;
    }
    forwardError /= generatedPath.length;

    let backwardError = 0;
    for (const pt of targetPath) {
        let minD = Infinity;
        for (const pg of generatedPath) {
            const d = (pt.x - pg.x) ** 2 + (pt.y - pg.y) ** 2;
            if (d < minD) minD = d;
        }
        backwardError += minD;
    }
    backwardError /= targetPath.length;

    const chamferDistance = forwardError + backwardError;

    // Closure penalty for ALL periodic mechanisms (not just 5-bar)
    let closurePenalty = 0;
    if (generatedPath.length > 0 && config.type !== 'piston') {
        const start = generatedPath[0];
        const end = generatedPath[generatedPath.length - 1];
        const gap = Math.hypot(start.x - end.x, start.y - end.y);
        if (gap > 5) closurePenalty = gap * gap * 2;
    }

    // Enhanced 5-bar scoring with turning function distance
    if (config.type === '5bar') {
        const shapeError = fourierShapeError(generatedPath, targetPath);
        const turnError = turningDistance(generatedPath, targetPath);
        const closureQuality = computeClosureQuality(generatedPath);

        // Count loops to match complexity
        const targetLoops = countCurveLoops(targetPath);
        const generatedLoops = countCurveLoops(generatedPath);
        const loopMismatch = Math.abs(targetLoops - generatedLoops) * 300;

        // Check if target is figure-8 and generated matches
        const targetIsFigure8 = detectSelfCrossing(targetPath);
        const generatedIsFigure8 = detectSelfCrossing(generatedPath);
        const figure8Mismatch = (targetIsFigure8 !== generatedIsFigure8) ? 500 : 0;

        // Use best of Fourier or turning function (whichever gives lower error)
        const bestShapeError = Math.min(shapeError, turnError * 10);

        // Weighted combination optimized for 5-bar curves
        return chamferDistance * 0.40 +      // Point proximity
            bestShapeError * 0.25 +        // Shape similarity (best method)
            closureQuality * 0.15 +        // Loop closure quality  
            closurePenalty * 0.10 +        // Basic closure
            loopMismatch * 0.05 +          // Complexity match
            figure8Mismatch * 0.05;        // Figure-8 match
    }

    return chamferDistance + closurePenalty;
};

// Enforce 5-bar geometric constraints
const enforceFiveBarConstraints = (conf: MechanismConfig) => {
    if (conf.type !== '5bar') return conf;

    const maxSeparation = Math.abs(conf.groundLength) + Math.abs(conf.crankLength) + Math.abs(conf.rockerLength);
    const currentTotalArm = Math.abs(conf.couplerLength) + Math.abs(conf.rodLength || 100);
    const minTotalArm = maxSeparation * 1.15;

    if (currentTotalArm < minTotalArm) {
        const diff = minTotalArm - currentTotalArm;
        conf.couplerLength += diff / 2;
        conf.rodLength = (conf.rodLength || 100) + diff / 2;
    }

    const armDiff = Math.abs(conf.couplerLength - (conf.rodLength || 100));
    const minSeparation = Math.max(0, Math.abs(conf.groundLength) - Math.abs(conf.crankLength) - Math.abs(conf.rockerLength));

    if (armDiff > minSeparation) {
        const avg = (conf.couplerLength + (conf.rodLength || 100)) / 2;
        conf.couplerLength = (conf.couplerLength + avg) / 2;
        conf.rodLength = ((conf.rodLength || 100) + avg) / 2;
    }

    return conf;
};

const enforceSixBarConstraints = (conf: MechanismConfig) => {
    if (conf.type !== '6bar') return conf;
    const minCoupler = Math.max(20, Math.abs(conf.groundLength - conf.rockerLength) - conf.crankLength + 12);
    if (conf.couplerLength < minCoupler) conf.couplerLength = minCoupler;
    const follower = Math.max(20, conf.couplerPointDist || 90);
    const dyad = Math.max(20, conf.rodLength || 90);
    const minReach = Math.abs(conf.rockerLength - follower) + 12;
    if (dyad < minReach) conf.rodLength = minReach;
    if ((conf.rodLength || 0) + follower < conf.rockerLength + 12) {
        const needed = conf.rockerLength + 12 - ((conf.rodLength || 0) + follower);
        conf.rodLength = (conf.rodLength || dyad) + needed / 2;
        conf.couplerPointDist = follower + needed / 2;
    }
    conf.assemblyMode = conf.assemblyMode ?? 'open';
    return conf;
};

export const generateSmartConfig = (targetPath?: Point[], forcedType?: MechanismType, excludedType?: MechanismType): MechanismConfig => {
    let cx = 0, cy = 0, scale = 100;

    if (targetPath && targetPath.length > 0) {
        const bounds = getBounds(targetPath);
        cx = bounds.cx;
        cy = bounds.cy;
        scale = Math.max(bounds.w, bounds.h);
    }

    const s = (factor: number) => scale * factor * (0.5 + Math.random());

    let availableTypes = OPTIMIZER_MECHANISM_TYPES;
    if (forcedType) {
        availableTypes = [forcedType];
    } else if (excludedType) {
        availableTypes = OPTIMIZER_MECHANISM_TYPES.filter(t => t !== excludedType);
    }

    const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];

    let anchorX = cx + (Math.random() - 0.5) * scale * 3.0;
    let anchorY = cy + (Math.random() - 0.5) * scale * 3.0;

    const config: MechanismConfig = {
        id: Math.random().toString(36).substr(2, 9),
        type: type,
        visible: true,
        enabled: true,
        color: '#3b82f6',

        anchorX: anchorX,
        anchorY: anchorY,
        groundAngle: Math.random() * 360,

        groundLength: s(0.8),
        crankLength: s(0.3),
        couplerLength: s(1.0),
        rockerLength: s(0.8),

        sliderOffset: 0,
        couplerPointDist: s(0.5),
        couplerPointAngle: Math.random() * 360,

        speed1: 1,
        speed2: 1,
        rodLength: s(1.0),
        phase: Math.random() * Math.PI * 2
    };

    // Type-specific initialization
    if (type === 'yoke') {
        config.sliderOffset = (Math.random() - 0.5) * s(0.5);
    } else if (type === 'piston') {
        config.sliderOffset = (Math.random() - 0.5) * s(0.5);
        config.couplerLength = Math.abs(config.sliderOffset) + config.crankLength + s(0.5);
    } else if (type === 'quick-return') {
        config.sliderOffset = (Math.random() - 0.5) * s(1.0);
        config.groundLength = Math.max(s(0.5), config.crankLength + 10);
        config.rockerLength = s(1.5);
    } else if (type === 'cam') {
        config.groundAngle = 90;
        config.groundLength = 0;
        config.couplerLength = 0;
        config.rockerLength = s(0.5);
        config.sliderOffset = (Math.random() - 0.5) * s(0.4);
    } else if (type === 'rack-pinion') {
        config.groundAngle = 90;
        config.groundLength = 0;
        config.couplerLength = 0;
        config.crankLength = s(0.2);
        config.rockerLength = Math.max(s(0.9), config.crankLength * (2 * Math.PI + 2.2));
        config.sliderOffset = Math.max(config.crankLength + 8, s(0.25));
        config.couplerPointAngle = 0;
    } else if (type === 'gear') {
        config.rockerLength = s(0.25);
        config.gearTrainRadii = [config.crankLength, config.rockerLength];
        config.groundLength = gearTrainResolvedCenterDistance(config);
        config.gearRatio = gearTrainOutputRatio(config);
        config.speed2 = config.gearRatio;
        config.couplerLength = 0;
    } else if (type === 'gear_linkage') {
        Object.assign(config, normalizeGearLinkageToReference(config));
    } else if (type === 'planetary_gear') {
        config.rockerLength = s(0.18);
        config.groundLength = config.crankLength + config.rockerLength;
        config.gearRatio = planetaryCarrierOutputRatio(config.crankLength, config.rockerLength);
        config.speed2 = planetaryPlanetSpinRatio(config.crankLength, config.rockerLength);
        config.couplerLength = 0;
    } else if (type === '6bar') {
        if (targetPath && targetPath.length > 0) {
            const bounds = getBounds(targetPath);
            const pathDiagonal = Math.hypot(bounds.w, bounds.h) || 100;
            config.anchorX = bounds.cx - pathDiagonal * 0.35;
            config.anchorY = bounds.cy - pathDiagonal * 0.25;
            config.groundLength = pathDiagonal * 0.72;
            config.crankLength = pathDiagonal * 0.24;
            config.rockerLength = pathDiagonal * 0.48;
            config.couplerLength = pathDiagonal * 0.78;
            config.rodLength = pathDiagonal * 0.46;
            config.couplerPointDist = pathDiagonal * 0.48;
        } else {
            config.groundLength = s(0.72);
            config.crankLength = s(0.24);
            config.rockerLength = s(0.48);
            config.couplerLength = s(0.78);
            config.rodLength = s(0.46);
            config.couplerPointDist = s(0.48);
        }
        config.speed1 = 1;
        config.speed2 = 1;
        config.phase = 0;
        config.assemblyMode = 'open';
        enforceSixBarConstraints(config);
    } else if (type === '5bar') {
        // Select gear ratio - prefer recommended ratio based on target path analysis
        let selectedRatio: { s1: number; s2: number };

        if (targetPath && targetPath.length > 10 && Math.random() < 0.4) {
            // 40% chance to use recommended ratio based on target analysis
            selectedRatio = recommendGearRatio(targetPath);
        } else {
            // Random from proven harmonic ratios
            const preset = FIVE_BAR_HARMONIC_RATIOS[Math.floor(Math.random() * FIVE_BAR_HARMONIC_RATIOS.length)];
            selectedRatio = { s1: preset.s1, s2: preset.s2 };
        }

        config.speed1 = selectedRatio.s1;
        config.speed2 = selectedRatio.s2;

        // Select phase from samples with some randomness
        const basePhase = PHASE_SAMPLES[Math.floor(Math.random() * PHASE_SAMPLES.length)];
        config.phase = basePhase + (Math.random() - 0.5) * 0.3;

        // Position anchor strategically relative to target path
        if (targetPath && targetPath.length > 0) {
            const bounds = getBounds(targetPath);
            const pathDiagonal = Math.hypot(bounds.w, bounds.h) || 100;

            // Place anchor offset from path center to create natural curve placement
            const anchorAngle = Math.random() * Math.PI * 2;
            const anchorDist = pathDiagonal * (0.3 + Math.random() * 0.5);
            config.anchorX = bounds.cx + Math.cos(anchorAngle) * anchorDist;
            config.anchorY = bounds.cy + Math.sin(anchorAngle) * anchorDist;

            // Scale gear radii appropriately
            config.crankLength = pathDiagonal * (0.15 + Math.random() * 0.2);
            config.rockerLength = pathDiagonal * (0.15 + Math.random() * 0.2);
            config.groundLength = pathDiagonal * (0.4 + Math.random() * 0.4);

            // Arms should reach across the ground + cranks
            const reachNeeded = config.groundLength + config.crankLength + config.rockerLength;
            const armLen = reachNeeded * (0.6 + Math.random() * 0.3);
            config.couplerLength = armLen;
            config.rodLength = armLen * (0.9 + Math.random() * 0.2);

            // Extension point
            config.couplerPointDist = pathDiagonal * (0.1 + Math.random() * 0.3);
        } else {
            config.groundLength = s(0.6);
            config.crankLength = s(0.3);
            config.rockerLength = s(0.3);

            const avgArmLen = scale * (1.0 + Math.random() * 0.4);
            config.couplerLength = avgArmLen;
            config.rodLength = avgArmLen;
            config.couplerPointDist = Math.random() * s(0.5);
        }

        enforceFiveBarConstraints(config);
    }

    return config;
};

export const mutateConfig = (config: MechanismConfig, temperature: number = 1.0, fixedType: boolean = false, excludedType?: MechanismType): MechanismConfig => {
    const newConfig = { ...config };

    const mutate = (val: number, range: number = 0.2) => {
        const change = val * range * temperature * (Math.random() - 0.5) * 2;
        return val + change;
    };

    const mutateAbs = (val: number, amount: number) => {
        return val + (Math.random() - 0.5) * amount * temperature;
    }

    // Structure Mutation
    if (!fixedType && temperature > 0.3 && Math.random() < 0.15) {
        let types = OPTIMIZER_MECHANISM_TYPES;
        if (excludedType) types = types.filter(t => t !== excludedType);
        types = types.filter(t => t !== config.type);

        if (types.length > 0) {
            newConfig.type = types[Math.floor(Math.random() * types.length)];
        if (newConfig.type === '5bar') {
            // Use harmonic ratio preset
            const ratio = FIVE_BAR_HARMONIC_RATIOS[Math.floor(Math.random() * FIVE_BAR_HARMONIC_RATIOS.length)];
            newConfig.speed1 = ratio.s1;
            newConfig.speed2 = ratio.s2;
            newConfig.phase = PHASE_SAMPLES[Math.floor(Math.random() * PHASE_SAMPLES.length)];
            newConfig.rodLength = newConfig.couplerLength;
        } else if (newConfig.type === '6bar') {
            newConfig.speed1 = 1;
            newConfig.speed2 = 1;
            newConfig.phase = 0;
            newConfig.rodLength = newConfig.rodLength || Math.max(60, newConfig.couplerLength * 0.65);
            newConfig.assemblyMode = 'open';
        } else if (newConfig.type === 'rack-pinion') {
            newConfig.groundAngle = 90;
            newConfig.groundLength = 0;
            newConfig.couplerLength = 0;
            newConfig.sliderOffset = Math.max(newConfig.crankLength + 8, Math.abs(newConfig.sliderOffset || 0));
            newConfig.couplerPointAngle = 0;
        }
        }
    }

    // Global Scale Mutation
    if (Math.random() < 0.15) {
        const scaleFactor = 1.0 + (Math.random() - 0.5) * 0.5 * temperature;
        newConfig.groundLength *= scaleFactor;
        newConfig.crankLength *= scaleFactor;
        newConfig.couplerLength *= scaleFactor;
        newConfig.rockerLength *= scaleFactor;
        if (newConfig.rodLength) newConfig.rodLength *= scaleFactor;
        if (newConfig.sliderOffset) newConfig.sliderOffset *= scaleFactor;
        if (newConfig.couplerPointDist) newConfig.couplerPointDist *= scaleFactor;
        if (newConfig.outputGearRadius) newConfig.outputGearRadius *= scaleFactor;
    }

    // Position & Orientation
    if (Math.random() < 0.7) newConfig.anchorX = mutateAbs(newConfig.anchorX!, 150);
    if (Math.random() < 0.7) newConfig.anchorY = mutateAbs(newConfig.anchorY!, 150);
    if (Math.random() < 0.7) newConfig.groundAngle = mutateAbs(newConfig.groundAngle!, 60);

    // Dimension Mutation
    if (Math.random() < 0.7) newConfig.groundLength = mutate(newConfig.groundLength);
    if (Math.random() < 0.7) newConfig.couplerLength = mutate(newConfig.couplerLength);
    if (Math.random() < 0.7) newConfig.rockerLength = mutate(newConfig.rockerLength);
    if (Math.random() < 0.7) newConfig.couplerPointDist = mutate(newConfig.couplerPointDist);
    if (Math.random() < 0.7) newConfig.crankLength = mutate(newConfig.crankLength);

    // 5-Bar Specific Mutation
    if (newConfig.type === '5bar') {
        if (Math.random() < 0.7) newConfig.rodLength = mutate(newConfig.rodLength || 100);

        // Stronger phase mutation - phase is very important for 5-bar curves
        if (Math.random() < 0.8) {
            newConfig.phase = (newConfig.phase || 0) + (Math.random() - 0.5) * Math.PI * temperature;
        }

        // Occasionally jump to a completely different harmonic ratio (exploration)
        if (Math.random() < 0.15 * temperature) {
            const newRatio = FIVE_BAR_HARMONIC_RATIOS[Math.floor(Math.random() * FIVE_BAR_HARMONIC_RATIOS.length)];
            newConfig.speed1 = newRatio.s1;
            newConfig.speed2 = newRatio.s2;
            // Reset phase when changing ratios
            newConfig.phase = PHASE_SAMPLES[Math.floor(Math.random() * PHASE_SAMPLES.length)];
        }
    }
    if (newConfig.type === '6bar') {
        if (Math.random() < 0.65) newConfig.rodLength = mutate(newConfig.rodLength || newConfig.couplerLength * 0.65);
        newConfig.assemblyMode = 'open';
    }

    if (Math.random() < 0.7) newConfig.sliderOffset = mutateAbs(newConfig.sliderOffset, 30);
    if (Math.random() < 0.7) newConfig.couplerPointAngle = mutateAbs(newConfig.couplerPointAngle, 60);

    newConfig.groundLength = Math.max(5, Math.abs(newConfig.groundLength));
    newConfig.crankLength = Math.max(5, Math.abs(newConfig.crankLength));
    newConfig.couplerLength = Math.max(5, Math.abs(newConfig.couplerLength));
    newConfig.rockerLength = Math.max(5, Math.abs(newConfig.rockerLength));
    if (newConfig.rodLength) newConfig.rodLength = Math.max(5, Math.abs(newConfig.rodLength));

    if (newConfig.type === '5bar') {
        enforceFiveBarConstraints(newConfig);
    }
    if (newConfig.type === '6bar') {
        enforceSixBarConstraints(newConfig);
    }
    if (newConfig.type === 'gear' || newConfig.type === 'gear_linkage' || newConfig.type === 'planetary_gear') {
        if (newConfig.type === 'gear_linkage') {
            Object.assign(newConfig, normalizeGearLinkageToReference(newConfig));
        } else if (newConfig.type === 'gear') {
            newConfig.couplerLength = 0;
            const idlers = Array.isArray(newConfig.gearTrainRadii) && newConfig.gearTrainRadii.length > 2
                ? newConfig.gearTrainRadii.slice(1, -1)
                : [];
            newConfig.gearTrainRadii = [newConfig.crankLength, ...idlers, newConfig.rockerLength];
            newConfig.groundLength = gearTrainResolvedCenterDistance(newConfig);
            newConfig.gearRatio = gearTrainOutputRatio(newConfig);
            newConfig.speed2 = newConfig.gearRatio ?? newConfig.speed2;
        } else {
            newConfig.couplerLength = 0;
            newConfig.groundLength = newConfig.crankLength + newConfig.rockerLength;
            newConfig.gearRatio = planetaryCarrierOutputRatio(newConfig.crankLength, newConfig.rockerLength);
            newConfig.speed2 = planetaryPlanetSpinRatio(newConfig.crankLength, newConfig.rockerLength);
        }
    }
    if (newConfig.type === 'rack-pinion') {
        newConfig.groundLength = 0;
        newConfig.couplerLength = 0;
        newConfig.rockerLength = Math.max(newConfig.rockerLength, newConfig.crankLength * (2 * Math.PI + 2.2));
        const rackOffsetSign = Math.sign(newConfig.sliderOffset || 1);
        newConfig.sliderOffset = rackOffsetSign * Math.max(Math.abs(newConfig.sliderOffset || 0), newConfig.crankLength + 8);
        newConfig.couplerPointAngle = 0;
    }

    return newConfig;
};

// Local gradient refinement for 5-bar - fine-tune parameters after evolutionary search
export const localRefine5bar = (
    config: MechanismConfig,
    targetPath: Point[],
    iterations: number = 30
): MechanismConfig => {
    if (config.type !== '5bar') return config;

    let best = { ...config };
    let bestScore = evaluateFitness(best, targetPath);

    const smallMutate = (val: number, amount: number): number => val + (Math.random() - 0.5) * amount;

    for (let i = 0; i < iterations; i++) {
        // Generate small variations
        const variants: MechanismConfig[] = [
            { ...best, phase: (best.phase || 0) + 0.05 },
            { ...best, phase: (best.phase || 0) - 0.05 },
            { ...best, couplerLength: smallMutate(best.couplerLength, 5) },
            { ...best, rodLength: smallMutate(best.rodLength || 100, 5) },
            { ...best, couplerPointDist: smallMutate(best.couplerPointDist, 3) },
            { ...best, anchorX: smallMutate(best.anchorX || 0, 10) },
            { ...best, anchorY: smallMutate(best.anchorY || 0, 10) },
            { ...best, groundAngle: smallMutate(best.groundAngle || 0, 5) },
        ];

        for (const variant of variants) {
            enforceFiveBarConstraints(variant);
            const score = evaluateFitness(variant, targetPath);
            if (score < bestScore) {
                best = variant;
                bestScore = score;
            }
        }
    }

    return best;
};

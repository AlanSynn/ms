import type { BodyPartLayer, Point, StandardJoint, StandardSkeleton } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundedBoxPoints = (cx: number, cy: number, width: number, height: number, radius: number, steps = 5): Point[] => {
    const hw = Math.max(1, width / 2);
    const hh = Math.max(1, height / 2);
    const r = clamp(radius, 1, Math.min(hw, hh));
    const corners = [
        { x: cx + hw - r, y: cy + hh - r, start: 0, end: Math.PI / 2 },
        { x: cx - hw + r, y: cy + hh - r, start: Math.PI / 2, end: Math.PI },
        { x: cx - hw + r, y: cy - hh + r, start: Math.PI, end: Math.PI * 1.5 },
        { x: cx + hw - r, y: cy - hh + r, start: Math.PI * 1.5, end: Math.PI * 2 }
    ];
    return corners.flatMap(corner => Array.from({ length: steps + 1 }, (_, i) => {
        const t = corner.start + ((corner.end - corner.start) * i) / steps;
        return { x: corner.x + Math.cos(t) * r, y: corner.y + Math.sin(t) * r };
    }));
};

const capsulePoints = (a: Point, b: Point, width: number, steps = 8): Point[] => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) return roundedBoxPoints(a.x, a.y, width, width, width / 2, steps);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const nx = -uy;
    const ny = ux;
    const radius = Math.max(1, width / 2);
    const normalAngle = Math.atan2(ny, nx);
    const points: Point[] = [
        { x: a.x + nx * radius, y: a.y + ny * radius },
        { x: b.x + nx * radius, y: b.y + ny * radius }
    ];
    for (let i = 1; i <= steps; i += 1) {
        const t = normalAngle - (Math.PI * i) / steps;
        points.push({ x: b.x + Math.cos(t) * radius, y: b.y + Math.sin(t) * radius });
    }
    points.push({ x: a.x - nx * radius, y: a.y - ny * radius });
    for (let i = 1; i <= steps; i += 1) {
        const t = normalAngle - Math.PI - (Math.PI * i) / steps;
        points.push({ x: a.x + Math.cos(t) * radius, y: a.y + Math.sin(t) * radius });
    }
    return points;
};

const farthestPair = (points: Point[]): [Point, Point] => {
    let best: [Point, Point] = [points[0], points[1] ?? points[0]];
    let bestDistance = -1;
    for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
            const distance = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
            if (distance > bestDistance) {
                bestDistance = distance;
                best = [points[i], points[j]];
            }
        }
    }
    return best;
};

export const partWorldPointToLocal = (part: BodyPartLayer, point: Point): Point => {
    const rotation = -(part.transform.rotation * Math.PI) / 180;
    const scale = Math.max(0.001, part.transform.scale);
    const dx = point.x - part.transform.x;
    const dy = point.y - part.transform.y;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
        x: (dx * cos - dy * sin) / scale,
        y: (dx * sin + dy * cos) / scale
    };
};

export const pointInsidePartBounds = (part: BodyPartLayer, point: Point, margin = 0) => (
    point.x >= part.bounds.x - margin &&
    point.x <= part.bounds.x + part.bounds.width + margin &&
    point.y >= part.bounds.y - margin &&
    point.y <= part.bounds.y + part.bounds.height + margin
);

export const partLocalJointPoints = (part: BodyPartLayer, joints: Array<StandardJoint | Point>, margin = 2): Point[] => {
    const seen = new Set<string>();
    return joints
        .map(item => 'position' in item ? item.position : item)
        .map(point => partWorldPointToLocal(part, point))
        .filter(point => pointInsidePartBounds(part, point, margin))
        .filter(point => {
            const key = `${Math.round(point.x * 10) / 10}:${Math.round(point.y * 10) / 10}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

const partLabel = (part: BodyPartLayer) => `${part.id} ${part.name}`.toLowerCase();

export const partLandmarkJointIds = (part: BodyPartLayer, skeleton?: StandardSkeleton | null): string[] => {
    const label = partLabel(part);
    const explicit: Array<[RegExp, string[]]> = [
        [/head/, ['neck', 'head_top']],
        [/(torso|body|trunk|chest)/, ['neck', 'torso', 'hip', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']],
        [/(left).*arm.*upper|left.*upper.*arm/, ['left_shoulder', 'left_elbow']],
        [/(right).*arm.*upper|right.*upper.*arm/, ['right_shoulder', 'right_elbow']],
        [/(left).*arm.*(lower|forearm)|left.*(lower|forearm).*arm/, ['left_elbow', 'left_hand']],
        [/(right).*arm.*(lower|forearm)|right.*(lower|forearm).*arm/, ['right_elbow', 'right_hand']],
        [/(left).*arm/, ['left_shoulder', 'left_elbow', 'left_hand']],
        [/(right).*arm/, ['right_shoulder', 'right_elbow', 'right_hand']],
        [/(left).*leg.*upper|left.*(upper|thigh).*leg/, ['left_hip', 'left_knee']],
        [/(right).*leg.*upper|right.*(upper|thigh).*leg/, ['right_hip', 'right_knee']],
        [/(left).*leg.*(lower|calf|shin)|left.*(lower|calf|shin).*leg/, ['left_knee', 'left_foot']],
        [/(right).*leg.*(lower|calf|shin)|right.*(lower|calf|shin).*leg/, ['right_knee', 'right_foot']],
        [/(left).*leg/, ['left_hip', 'left_knee', 'left_foot']],
        [/(right).*leg/, ['right_hip', 'right_knee', 'right_foot']]
    ];
    const matched = explicit.find(([pattern]) => pattern.test(label))?.[1] ?? [];
    const available = (ids: string[]) => ids.filter(id => Boolean(skeleton?.joints[id]));
    const direct = available(matched);
    if (direct.length >= 2) return direct;

    const fallback = [part.anchorJointId, ...(skeleton?.hierarchy?.[part.anchorJointId] ?? [])];
    const seen = new Set<string>();
    const resolved = fallback.filter(id => id && !seen.has(id) && seen.add(id) && Boolean(skeleton?.joints[id]));
    if (resolved.length >= 2) return resolved.slice(0, 3);
    return available([part.anchorJointId, ...matched]);
};

export const partLandmarkLocalPoints = (part: BodyPartLayer, skeleton?: StandardSkeleton | null, margin = 2): Point[] => {
    const joints = partLandmarkJointIds(part, skeleton).map(id => skeleton?.joints[id]).filter((joint): joint is StandardJoint => Boolean(joint));
    const local = partLocalJointPoints(part, joints, margin);
    if (local.length >= 2 || joints.length === 0) return local;
    return joints.map(joint => partWorldPointToLocal(part, joint.position));
};

export const pointInsideOutline = (point: Point, outline: Point[], tolerance = 1e-6) => {
    if (outline.length < 3) return false;
    const nearSegment = (a: Point, b: Point) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 <= tolerance) return Math.hypot(point.x - a.x, point.y - a.y) <= tolerance;
        const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2, 0, 1);
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= tolerance;
    };
    const isLeft = (a: Point, b: Point) => (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    let winding = 0;
    for (let i = 0; i < outline.length; i += 1) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        if (nearSegment(a, b)) return true;
        if (a.y <= point.y) {
            if (b.y > point.y && isLeft(a, b) > -tolerance) winding += 1;
        } else if (b.y <= point.y && isLeft(a, b) < tolerance) {
            winding -= 1;
        }
    }
    return winding !== 0;
};

export const partOutlineBounds = (points: Point[]) => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

export const contourPolygonArea = (points: Point[]) => {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
};

export const isUsableContourPoints = (points: Point[], minArea = 1): boolean => {
    const unique = new Set(points.map(point => `${point.x.toFixed(3)}:${point.y.toFixed(3)}`));
    return unique.size >= 3 && contourPolygonArea(points) >= minArea;
};

const sourceContourPoints = (part: BodyPartLayer): Point[] => {
    const points = part.contourPoints?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? [];
    if (points.length < 3) return [];
    const margin = Math.max(18, Math.min(part.bounds.width, part.bounds.height) * 0.25);
    const clamped = points.map(point => ({
        x: clamp(point.x, part.bounds.x - margin, part.bounds.x + part.bounds.width + margin),
        y: clamp(point.y, part.bounds.y - margin, part.bounds.y + part.bounds.height + margin)
    }));
    return isUsableContourPoints(clamped) ? clamped : [];
};

export const fabricablePartOutlinePoints = (part: BodyPartLayer, localJoints: Point[] = []): Point[] => {
    const sourceContour = sourceContourPoints(part);
    if (sourceContour.length >= 3) return sourceContour;

    const cx = part.bounds.x + part.bounds.width / 2;
    const cy = part.bounds.y + part.bounds.height / 2;
    const minDim = Math.min(part.bounds.width, part.bounds.height);
    const maxDim = Math.max(part.bounds.width, part.bounds.height);
    const fallbackWidth = clamp(part.bounds.width, Math.min(42, part.bounds.width), Math.min(part.bounds.width, 150));
    const fallbackHeight = clamp(part.bounds.height, Math.min(42, part.bounds.height), Math.min(part.bounds.height, 170));
    if (localJoints.length < 2) {
        return roundedBoxPoints(cx, cy, fallbackWidth, fallbackHeight, Math.min(fallbackWidth, fallbackHeight) * 0.28);
    }

    const jointBounds = partOutlineBounds(localJoints);
    const jointCx = (jointBounds.minX + jointBounds.maxX) / 2;
    const jointCy = (jointBounds.minY + jointBounds.maxY) / 2;
    const torsoLike = /(torso|body|trunk|chest|pelvis|hip|head)/i.test(`${part.id} ${part.name}`) || localJoints.length >= 4;
    if (torsoLike) {
        const width = clamp(jointBounds.width + minDim * 0.7, Math.min(58, maxDim), Math.min(part.bounds.width, 170));
        const height = clamp(jointBounds.height + minDim * 0.72, Math.min(58, maxDim), Math.min(part.bounds.height, 190));
        return roundedBoxPoints(jointCx, jointCy, width, height, Math.min(width, height) * 0.26);
    }

    const [a, b] = farthestPair(localJoints);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const width = clamp(minDim * 0.72, 26, Math.min(74, Math.max(28, span * 0.64)));
    return capsulePoints(a, b, width);
};

export const partOutlinePathD = (part: BodyPartLayer, localJoints: Point[] = [], options: { scale?: number; flipY?: boolean } = {}) => {
    const scale = options.scale ?? 1;
    const points = fabricablePartOutlinePoints(part, localJoints);
    if (!points.length) return '';
    const project = (point: Point) => `${(point.x * scale).toFixed(2)} ${((options.flipY ? -point.y : point.y) * scale).toFixed(2)}`;
    return `M ${project(points[0])} ${points.slice(1).map(point => `L ${project(point)}`).join(' ')} Z`;
};

#!/usr/bin/env bun
// Generates fabrication/sample_character.svg + fabrication/sample_character.pdf
// from the built-in humanoid guide character (`createSampleProject()`).
//
// Requirements encoded here:
//   - The character prints as an EXPLODED humanoid: parts keep their screen
//     pose (person silhouette preserved) but push apart with cutting gaps at
//     1:1 scene scale (2 px = 1 mm).
//   - Gap sizes are computed: each child part slides along its push direction
//     until its outline clears the parent's (convex SAT test) plus a safety
//     margin. Lower legs push horizontally outward so knees separate too.
//   - Lower arm + hand merged into one cut piece per side (no internal line).
//   - A small assembled-pose reference sits in the top-right corner.
//   - Part labels NEVER overlap any shape: each label is placed at the first
//     collision-free candidate position around its piece.
//   - Pin holes stay at joint landmarks (4 mm, kit peg size).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BodyPartLayer, Point, ProjectState } from '../types';
import { LETTER_SHEET, SCENE_PX_PER_MM } from '../utils/coordinates';
import {
    fabricablePartOutlinePoints,
    partLandmarkLocalPoints,
    pointInsideOutline
} from '../utils/partGeometry';
import { createSampleProject } from '../utils/project';
import { circlePath, makePdfDocument, num, pdfText } from '../utils/simplePdf';

type Piece = {
    id: string;
    label: string;
    zIndex: number;
    /** World-space outline in mm (page-y: larger = lower on page), un-scaled. */
    outlineMm: Point[];
    /** World-space pin holes in mm, each tagged with its joint id. */
    holesMm: Array<Point & { joint: string }>;
};

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fabrication');
const SVG_PATH = join(OUT_DIR, 'sample_character.svg');
const PDF_PATH = join(OUT_DIR, 'sample_character.pdf');

const PAGE = {
    widthMm: LETTER_SHEET.widthMm,
    heightMm: LETTER_SHEET.heightMm,
    marginMm: 6,
    titleBandMm: 9,
    footerBandMm: 2
};
/** Small assembled-pose reference in the top-right corner. */
const REF_BOX = { widthMm: 24, heightMm: 36 };
/** Estimated label metrics (Arial bold, ~0.55 em per char + safety). */
const LABEL_CHAR_MM = 1.7;
const LABEL_HEIGHT_MM = 2.4;

const transformedPartPoint = (part: BodyPartLayer, point: Point): Point => {
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = Math.max(0.001, part.transform.scale);
    const x = point.x * scale;
    const y = point.y * scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

const scenePxToWorldMm = (point: Point): Point => ({
    x: point.x / SCENE_PX_PER_MM,
    y: -point.y / SCENE_PX_PER_MM
});

const boundsOf = (points: Point[]) => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
    };
};

const convexHull = (points: Point[]): Point[] => {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Point, a: Point, b: Point) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Point[] = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }
    const upper: Point[] = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const point = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
};

/** Separating-axis intersection test for convex polygons. */
const polysIntersect = (a: Point[], b: Point[]): boolean => {
    if (a.length < 3 || b.length < 3) return false;
    const axesOf = (poly: Point[]) =>
        poly.map((p, i) => {
            const q = poly[(i + 1) % poly.length];
            return { x: -(q.y - p.y), y: q.x - p.x };
        });
    for (const axis of [...axesOf(a), ...axesOf(b)]) {
        const proj = (poly: Point[]) => poly.map(p => p.x * axis.x + p.y * axis.y);
        const pa = proj(a);
        const pb = proj(b);
        if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
    return true;
};

const translate = (points: Point[], by: Point): Point[] =>
    points.map(point => ({ x: point.x + by.x, y: point.y + by.y }));

const partOutlineWorldMm = (part: BodyPartLayer, project: ProjectState): Point[] => {
    const landmarks = partLandmarkLocalPoints(part, project.skeleton);
    const outline = fabricablePartOutlinePoints(part, landmarks);
    if (outline.length < 3) return [];
    return outline.map(point => scenePxToWorldMm(transformedPartPoint(part, point)));
};

const jointWorldMm = (project: ProjectState, jointId: string): Point | null => {
    const joint = project.skeleton?.joints[jointId];
    return joint ? scenePxToWorldMm(joint.position) : null;
};

const partWorldLocal = (part: BodyPartLayer, project: ProjectState, jointId: string): Point | null => {
    const joint = project.skeleton?.joints[jointId];
    if (!joint) return null;
    const rotation = -(part.transform.rotation * Math.PI) / 180;
    const scale = Math.max(0.001, part.transform.scale);
    const dx = joint.position.x - part.transform.x;
    const dy = joint.position.y - part.transform.y;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return { x: (dx * cos - dy * sin) / scale, y: (dx * sin + dy * cos) / scale };
};

// Landmark joint ids per part, mirroring partGeometry's explicit table for
// the starter part names.
const landmarkJointIdsForPart = (part: BodyPartLayer, project: ProjectState): string[] => {
    const label = `${part.id} ${part.name}`.toLowerCase();
    const table: Array<[RegExp, string[]]> = [
        [/head/, ['neck', 'head_top']],
        [/(torso|body|trunk|chest)/, ['neck', 'torso', 'hip', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']],
        [/(left).*arm.*upper|left.*upper.*arm/, ['left_shoulder', 'left_elbow']],
        [/(right).*arm.*upper|right.*upper.*arm/, ['right_shoulder', 'right_elbow']],
        [/(left).*leg.*upper|left.*(upper|thigh).*leg/, ['left_hip', 'left_knee']],
        [/(right).*leg.*upper|right.*(upper|thigh).*leg/, ['right_hip', 'right_knee']],
        [/(left).*leg.*(lower|calf|shin)|left.*(lower|calf|shin).*leg/, ['left_knee', 'left_foot']],
        [/(right).*leg.*(lower|calf|shin)|right.*(lower|calf|shin).*leg/, ['right_knee', 'right_foot']],
    ];
    const matched = table.find(([pattern]) => pattern.test(label))?.[1] ?? [];
    const available = matched.filter(id => Boolean(project.skeleton?.joints[id]));
    if (available.length >= 2) return available;
    return [part.anchorJointId].filter(id => Boolean(project.skeleton?.joints[id]));
};

const buildPieces = (project: ProjectState): Piece[] => {
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const pieceForPart = (part: BodyPartLayer): Piece | null => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outlineLocal = fabricablePartOutlinePoints(part, landmarks);
        if (outlineLocal.length < 3) return null;
        const holesMm = landmarkJointIdsForPart(part, project)
            .map(jointId => {
                const world = jointWorldMm(project, jointId);
                const local = partWorldLocal(part, project, jointId);
                if (!world || !local || !pointInsideOutline(local, outlineLocal, 0.5)) return null;
                return { ...world, joint: jointId };
            })
            .filter((hole): hole is Point & { joint: string } => Boolean(hole));
        return {
            id: part.id,
            label: part.name,
            zIndex: part.zIndex,
            outlineMm: partOutlineWorldMm(part, project),
            holesMm
        };
    };

    const pieces: Piece[] = [];
    const mergedAway = new Set(['left_hand_part', 'right_hand_part', 'left_arm_lower', 'right_arm_lower']);
    for (const part of parts) {
        if (mergedAway.has(part.id)) continue;
        const piece = pieceForPart(part);
        if (piece) pieces.push(piece);
    }
    // Merged lower arm + hand per side: hull of both world outlines, pin holes
    // at elbow + hand joints (world), so no internal cut line remains.
    for (const side of ['left', 'right'] as const) {
        const lower = parts.find(part => part.id === `${side}_arm_lower`);
        const hand = parts.find(part => part.id === `${side}_hand_part`);
        if (!lower || !hand) continue;
        const combined = [...partOutlineWorldMm(lower, project), ...partOutlineWorldMm(hand, project)];
        if (combined.length < 3) continue;
        const hull = convexHull(combined);
        const holesMm = [`${side}_elbow`, `${side}_hand`]
            .map(jointId => {
                const world = jointWorldMm(project, jointId);
                return world && pointInsideOutline(world, hull, 0.5) ? { ...world, joint: jointId } : null;
            })
            .filter((hole): hole is Point & { joint: string } => Boolean(hole));
        pieces.push({
            id: `${side}_forearm_merged`,
            label: `${side === 'left' ? 'Left' : 'Right'} lower arm + hand`,
            zIndex: Math.max(lower.zIndex, hand.zIndex),
            outlineMm: hull,
            holesMm
        });
    }
    return pieces;
};

/** Cut order: front-most layer (highest zIndex) first, torso last. */
const cutOrderRank = (pieces: Piece[]) => {
    const byZ = [...pieces].sort((a, b) => b.zIndex - a.zIndex || a.label.localeCompare(b.label));
    const rank = new Map<string, number>();
    byZ.forEach((piece, index) => rank.set(piece.id, index + 1));
    return rank;
};

const normalize = (point: Point): Point => {
    const length = Math.hypot(point.x, point.y) || 1;
    return { x: point.x / length, y: point.y / length };
};

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

type PlacedPiece = Piece & {
    outline: Point[];
    holes: Array<Point & { joint: string }>;
};

type ExplodeSpec = {
    parentId: string;
    /** Push direction; 'outward' resolves to horizontal away from center. */
    dirFrom?: string;
    dirTo?: string;
    outward?: boolean;
};

/** Exploded-pose layout: every child separates from its parent with a SAT-
 * computed gap along its push direction (lower legs move horizontally
 * outward so the knees fully separate). */
const explodeLayout = (pieces: Piece[], project: ProjectState, clearMm: number) => {
    const byId = new Map(pieces.map(piece => [piece.id, piece]));
    const spec: Record<string, ExplodeSpec> = {
        head: { parentId: 'torso', dirFrom: 'neck', dirTo: 'head_top' },
        left_arm_upper: { parentId: 'torso', dirFrom: 'left_shoulder', dirTo: 'left_elbow' },
        right_arm_upper: { parentId: 'torso', dirFrom: 'right_shoulder', dirTo: 'right_elbow' },
        left_forearm_merged: { parentId: 'left_arm_upper', dirFrom: 'left_elbow', dirTo: 'left_hand' },
        right_forearm_merged: { parentId: 'right_arm_upper', dirFrom: 'right_elbow', dirTo: 'right_hand' },
        left_leg_upper: { parentId: 'torso', dirFrom: 'left_hip', dirTo: 'left_knee' },
        right_leg_upper: { parentId: 'torso', dirFrom: 'right_hip', dirTo: 'right_knee' },
        left_leg_lower: { parentId: 'left_leg_upper', outward: true },
        right_leg_lower: { parentId: 'right_leg_upper', outward: true },
        left_foot_part: { parentId: 'left_leg_lower', dirFrom: 'left_knee', dirTo: 'left_foot' },
        right_foot_part: { parentId: 'right_leg_lower', dirFrom: 'right_knee', dirTo: 'right_foot' }
    };
    const centerXOf = (piece: Piece): number => {
        const box = boundsOf(piece.outlineMm);
        return (box.minX + box.maxX) / 2;
    };
    const directionOf = (id: string): Point => {
        const entry = spec[id];
        if (!entry) return { x: 0, y: 0 };
        if (entry.outward) {
            // Push away from the torso centerline; do not assume which screen
            // side a left/right id lands on (skeleton handedness varies).
            const child = byId.get(id);
            const torso = byId.get('torso');
            if (!child || !torso) return { x: 0, y: 0 };
            return { x: Math.sign(centerXOf(child) - centerXOf(torso)) || 1, y: 0 };
        }
        const from = jointWorldMm(project, entry.dirFrom!);
        const to = jointWorldMm(project, entry.dirTo!);
        if (!from || !to) return { x: 0, y: 0 };
        return normalize(subtract(to, from));
    };
    const chainDepth = (id: string): number => {
        const entry = spec[id];
        return entry ? 1 + chainDepth(entry.parentId) : 0;
    };
    const offsets = new Map<string, Point>([['torso', { x: 0, y: 0 }]]);
    const gaps = new Map<string, number>();
    const resolveOffset = (id: string): Point => {
        if (offsets.has(id)) return offsets.get(id)!;
        const entry = spec[id];
        if (!entry) return { x: 0, y: 0 };
        const child = byId.get(id);
        const parent = byId.get(entry.parentId);
        if (!child || !parent) return { x: 0, y: 0 };
        const parentOffset = resolveOffset(entry.parentId);
        const dir = directionOf(id);
        const parentOutline = translate(parent.outlineMm, parentOffset);
        let t = 0;
        for (; t <= 60; t += 0.25) {
            if (!polysIntersect(translate(child.outlineMm, { x: parentOffset.x + dir.x * t, y: parentOffset.y + dir.y * t }), parentOutline)) break;
        }
        const gap = Math.min(t, 60) + (t < 60 ? clearMm : 0);
        gaps.set(id, gap);
        const offset = { x: parentOffset.x + dir.x * gap, y: parentOffset.y + dir.y * gap };
        offsets.set(id, offset);
        return offset;
    };
    for (const piece of pieces) resolveOffset(piece.id);

    // Cross-pair safety pass: if any non-parent pair still intersects (e.g. a
    // pushed-out shin grazing a forearm), nudge the deeper chain piece along
    // its own direction until clear.
    for (let pass = 0; pass < 40; pass += 1) {
        let moved = false;
        for (const a of pieces) {
            for (const b of pieces) {
                if (a.id === b.id) continue;
                const oa = translate(a.outlineMm, offsets.get(a.id)!);
                const ob = translate(b.outlineMm, offsets.get(b.id)!);
                if (!polysIntersect(oa, ob)) continue;
                const child = chainDepth(a.id) >= chainDepth(b.id) ? a : b;
                const dir = directionOf(child.id);
                if (dir.x === 0 && dir.y === 0) continue;
                const base = offsets.get(child.id)!;
                offsets.set(child.id, { x: base.x + dir.x * 0.5, y: base.y + dir.y * 0.5 });
                moved = true;
            }
        }
        if (!moved) break;
    }
    // Hard guarantee: if any pair still intersects after the pass budget,
    // fail loudly instead of shipping an overlapping cut sheet.
    for (const a of pieces) {
        for (const b of pieces) {
            if (a.id === b.id) continue;
            if (polysIntersect(translate(a.outlineMm, offsets.get(a.id)!), translate(b.outlineMm, offsets.get(b.id)!))) {
                throw new Error(`Residual piece overlap after explode: ${a.id} vs ${b.id}`);
            }
        }
    }
    return { offsets, gaps };
};

/** Build the placed (page-space) pieces: explode, then center on the page. */
const placePieces = (pieces: Piece[], project: ProjectState, clearMm: number) => {
    const { offsets, gaps } = explodeLayout(pieces, project, clearMm);
    const usable = {
        left: PAGE.marginMm,
        right: PAGE.widthMm - PAGE.marginMm,
        top: PAGE.titleBandMm + 1,
        bottom: PAGE.heightMm - PAGE.footerBandMm
    };
    const exploded: PlacedPiece[] = pieces.map(piece => {
        const offset = offsets.get(piece.id) ?? { x: 0, y: 0 };
        return {
            ...piece,
            outline: translate(piece.outlineMm, offset),
            holes: piece.holesMm.map(hole => ({ ...translate([hole], offset)[0], joint: hole.joint }))
        };
    });
    const figure = boundsOf(exploded.flatMap(piece => piece.outline));
    const fits = figure.width <= usable.right - usable.left && figure.height <= usable.bottom - usable.top;
    const center = {
        x: (usable.left + usable.right - figure.width) / 2 - figure.minX,
        y: (usable.top + usable.bottom - figure.height) / 2 - figure.minY
    };
    const placed = exploded.map(piece => ({
        ...piece,
        outline: translate(piece.outline, center),
        holes: piece.holes.map(hole => ({ ...translate([hole], center)[0], joint: hole.joint }))
    }));
    return { placed, figure, fits, gaps };
};

type Rect = { x: number; y: number; width: number; height: number };

const rectToPoly = (rect: Rect): Point[] => [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
];

const rectsOverlap = (a: Rect, b: Rect, pad = 0) =>
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad &&
    a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;

type LabelPlacement = {
    text: string;
    anchor: 'start' | 'middle' | 'end';
    x: number;
    y: number;
    rect: Rect;
};

/**
 * Place each part label at the first candidate position whose rectangle
 * clears every piece outline, the reference box, the title row, the page
 * bounds, and all previously placed labels. Absolute no-overlap rule.
 */
const placeLabels = (
    placed: PlacedPiece[],
    rank: Map<string, number>,
    refRect: Rect
): LabelPlacement[] => {
    const obstacles = placed.map(piece => piece.outline);
    const titleRect: Rect = { x: PAGE.marginMm, y: 3, width: 62, height: 4 };
    const labels: LabelPlacement[] = [];
    const placedRects: Rect[] = [refRect, titleRect];
    for (const piece of placed) {
        const text = `${rank.get(piece.id) ?? ''}. ${piece.label}`;
        const width = text.length * LABEL_CHAR_MM;
        const box = boundsOf(piece.outline);
        const cx = (box.minX + box.maxX) / 2;
        const cy = (box.minY + box.maxY) / 2;
        type Candidate = { anchor: LabelPlacement['anchor']; x: number; y: number; rect: Rect };
        const candidates: Candidate[] = [];
        for (const k of [1.2, 2.5, 4.5, 7, 10, 14]) {
            candidates.push(
                { anchor: 'middle', x: cx, y: box.minY - k, rect: { x: cx - width / 2, y: box.minY - k - LABEL_HEIGHT_MM, width, height: LABEL_HEIGHT_MM } },
                { anchor: 'start', x: box.minX - 0.3, y: box.minY - k, rect: { x: box.minX - 0.3, y: box.minY - k - LABEL_HEIGHT_MM, width, height: LABEL_HEIGHT_MM } },
                { anchor: 'end', x: box.maxX + 0.3, y: box.minY - k, rect: { x: box.maxX + 0.3 - width, y: box.minY - k - LABEL_HEIGHT_MM, width, height: LABEL_HEIGHT_MM } },
                { anchor: 'start', x: box.maxX + k, y: cy + 1, rect: { x: box.maxX + k, y: cy + 1 - LABEL_HEIGHT_MM, width, height: LABEL_HEIGHT_MM } },
                { anchor: 'end', x: box.minX - k, y: cy + 1, rect: { x: box.minX - k - width, y: cy + 1 - LABEL_HEIGHT_MM, width, height: LABEL_HEIGHT_MM } },
                { anchor: 'middle', x: cx, y: box.maxY + k + LABEL_HEIGHT_MM, rect: { x: cx - width / 2, y: box.maxY + k, width, height: LABEL_HEIGHT_MM } }
            );
        }
        const inPage = (rect: Rect) =>
            rect.x >= PAGE.marginMm - 0.2 &&
            rect.x + rect.width <= PAGE.widthMm - PAGE.marginMm + 0.2 &&
            rect.y >= PAGE.titleBandMm + 0.8 &&
            rect.y + rect.height <= PAGE.heightMm - PAGE.footerBandMm;
        const pick = candidates.find(candidate =>
            inPage(candidate.rect) &&
            !rectsOverlap(candidate.rect, refRect, 0.4) &&
            !rectsOverlap(candidate.rect, titleRect, 0.4) &&
            !placedRects.some(rect => rectsOverlap(candidate.rect, rect, 0.4)) &&
            !obstacles.some(outline => polysIntersect(rectToPoly(candidate.rect), outline))
        ) ?? candidates[0];
        labels.push({ text, anchor: pick.anchor, x: pick.x, y: pick.y, rect: pick.rect });
        placedRects.push(pick.rect);
    }
    return labels;
};

const svgNumber = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : '0');

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));

const pathD = (points: Point[]) =>
    points.length
        ? `M ${points.map(point => `${svgNumber(point.x)} ${svgNumber(point.y)}`).join(' L ')} Z`
        : '';

const MM_TO_PT = 72 / 25.4;
const pdfPoint = (point: Point) => ({ x: point.x * MM_TO_PT, y: 792 - point.y * MM_TO_PT });

const buildSvg = (placed: PlacedPiece[], rank: Map<string, number>, labels: LabelPlacement[], refPaths: Point[][]): string => {
    const holeRadius = 2;
    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${PAGE.widthMm}mm" height="${PAGE.heightMm}mm" viewBox="0 0 ${PAGE.widthMm} ${PAGE.heightMm}" data-sheet="sample-character" data-print-scale="1" data-scene-ratio-px-per-mm="${SCENE_PX_PER_MM}" data-hole-diameter-mm="4" data-parts="${placed.length}">`);
    parts.push(`<title>Sample Character</title>`);
    parts.push(`<desc>Built-in humanoid guide character, exploded for cutting at 1:1 scene scale (2 px = 1 mm). Lower arm and hand are one merged piece per side. Small assembled reference in the top-right corner. Pin holes are 4 mm.</desc>`);
    parts.push(`<defs><style>
      .cut { fill: none; stroke: #111827; stroke-width: 0.3; stroke-miterlimit: 10; }
      .drill { fill: #ffffff; stroke: #0071bc; stroke-width: 0.2; stroke-miterlimit: 10; }
      .drill-cross { stroke: #0071bc; stroke-width: 0.12; }
      .label { fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 2.8px; font-weight: bold; }
      .title { fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 5px; font-weight: bold; }
      .frame { fill: none; stroke: #94a3b8; stroke-width: 0.15; stroke-dasharray: 2 1; }
      .ref-part { fill: #e2e8f0; stroke: #64748b; stroke-width: 0.2; }
    </style></defs>`);
    parts.push(`<text x="${PAGE.marginMm}" y="6.5" class="title">Sample Character</text>`);
    parts.push(`<rect x="${PAGE.marginMm}" y="${PAGE.titleBandMm}" width="${PAGE.widthMm - PAGE.marginMm * 2}" height="${PAGE.heightMm - PAGE.titleBandMm - PAGE.footerBandMm}" class="frame"/>`);
    parts.push(`<g data-reference-figure="assembled-pose">`);
    for (const outline of refPaths) {
        parts.push(`<path d="${pathD(outline)}" class="ref-part"/>`);
    }
    parts.push(`</g>`);
    for (const piece of placed) {
        const holes = piece.holes
            .map(hole => {
                const cross = `<path d="M ${svgNumber(hole.x - holeRadius - 0.5)} ${svgNumber(hole.y)} L ${svgNumber(hole.x + holeRadius + 0.5)} ${svgNumber(hole.y)} M ${svgNumber(hole.x)} ${svgNumber(hole.y - holeRadius - 0.5)} L ${svgNumber(hole.x)} ${svgNumber(hole.y + holeRadius + 0.5)}" class="drill-cross"/>`;
                return `<circle cx="${svgNumber(hole.x)}" cy="${svgNumber(hole.y)}" r="${svgNumber(holeRadius)}" class="drill"/>${cross}`;
            })
            .join('');
        parts.push(`<g data-part="${esc(piece.id)}" data-cut-order="${rank.get(piece.id) ?? ''}"><path d="${pathD(piece.outline)}" class="cut"/>${holes}</g>`);
    }
    for (const label of labels) {
        parts.push(`<text x="${svgNumber(label.x)}" y="${svgNumber(label.y)}" class="label" text-anchor="${label.anchor}">${esc(label.text)}</text>`);
    }
    parts.push('</svg>');
    return parts.join('\n');
};

const buildPdf = (placed: PlacedPiece[], rank: Map<string, number>, labels: LabelPlacement[], refPaths: Point[][]): string => {
    const holeRadius = 2;
    const commands: string[] = [];
    const leftPt = PAGE.marginMm * MM_TO_PT;
    commands.push(`BT /F1 13 Tf ${num(leftPt)} ${num(792 - 6.5 * MM_TO_PT)} Td (${pdfText('Sample Character')}) Tj ET`);
    commands.push('0.58 0.65 0.72 RG 0.4 w [5.7 2.85] 0 d');
    const frameA = pdfPoint({ x: PAGE.marginMm, y: PAGE.titleBandMm });
    const frameB = pdfPoint({ x: PAGE.widthMm - PAGE.marginMm, y: PAGE.heightMm - PAGE.footerBandMm });
    commands.push(`${num(frameA.x)} ${num(frameB.y)} ${num(frameB.x - frameA.x)} ${num(frameA.y - frameB.y)} re S`);
    commands.push('[] 0 d');
    commands.push('0.88 0.91 0.95 rg 0.39 0.45 0.55 RG 0.25 w');
    for (const outline of refPaths) {
        const outlinePt = outline.map(pdfPoint);
        commands.push(`${num(outlinePt[0].x)} ${num(outlinePt[0].y)} m ${outlinePt.slice(1).map(point => `${num(point.x)} ${num(point.y)} l`).join(' ')} h B`);
    }
    for (const piece of placed) {
        const outlinePt = piece.outline.map(pdfPoint);
        commands.push('0.07 0.09 0.16 RG 0.85 w');
        commands.push(`${num(outlinePt[0].x)} ${num(outlinePt[0].y)} m ${outlinePt.slice(1).map(point => `${num(point.x)} ${num(point.y)} l`).join(' ')} h S`);
        for (const hole of piece.holes) {
            const holePt = pdfPoint(hole);
            const r = holeRadius * MM_TO_PT;
            commands.push('1 1 1 rg 0 0.44 0.74 RG 0.6 w');
            commands.push(`${circlePath(holePt.x, holePt.y, r)} B`);
            commands.push('0 0.44 0.74 RG 0.35 w');
            commands.push(`${num(holePt.x - r - 1.4)} ${num(holePt.y)} m ${num(holePt.x + r + 1.4)} ${num(holePt.y)} l S`);
            commands.push(`${num(holePt.x)} ${num(holePt.y - r - 1.4)} m ${num(holePt.x)} ${num(holePt.y + r + 1.4)} l S`);
        }
    }
    // Labels last, same collision-free positions as the SVG (7 pt Helvetica
    // ≈ 2.47 mm caps; text-anchor emulated with an estimated glyph width).
    for (const label of labels) {
        const widthPt = label.text.length * LABEL_CHAR_MM * MM_TO_PT;
        const pt = pdfPoint({ x: label.x, y: label.y - LABEL_HEIGHT_MM + 0.4 });
        const x = label.anchor === 'middle' ? pt.x - widthPt / 2 : label.anchor === 'end' ? pt.x - widthPt : pt.x;
        commands.push(`0.07 0.09 0.16 rg BT /F1 7 Tf ${num(x)} ${num(pt.y)} Td (${pdfText(label.text)}) Tj ET`);
    }
    return makePdfDocument(commands.join('\n'));
};

const main = () => {
    const project = createSampleProject();
    const pieces = buildPieces(project);
    if (!pieces.length) throw new Error('No printable pieces found');
    const rank = cutOrderRank(pieces);

    // Try clearance levels until the exploded figure fits the page.
    let result = placePieces(pieces, project, 1.8);
    for (const clear of [1.4, 1.0, 0.7]) {
        if (result.fits) break;
        result = placePieces(pieces, project, clear);
    }
    if (!result.fits) {
        throw new Error(`Exploded figure ${result.figure.width.toFixed(1)} x ${result.figure.height.toFixed(1)} mm exceeds Letter printable area`);
    }
    const { placed, gaps } = result;

    // Small assembled reference in the top-right corner (original pose).
    const assembled = boundsOf(pieces.flatMap(piece => piece.outlineMm));
    const refScale = Math.min(REF_BOX.widthMm / assembled.width, REF_BOX.heightMm / assembled.height);
    const refX = PAGE.widthMm - PAGE.marginMm - REF_BOX.widthMm;
    const refY = PAGE.marginMm + 1;
    const refRect: Rect = { x: refX - 0.5, y: refY - 0.5, width: REF_BOX.widthMm + 1, height: REF_BOX.heightMm + 1 };
    const refOrigin = {
        x: refX + (REF_BOX.widthMm - assembled.width * refScale) / 2 - assembled.minX * refScale,
        y: refY + (REF_BOX.heightMm - assembled.height * refScale) / 2 - assembled.minY * refScale
    };
    const refPaths = pieces.map(piece =>
        piece.outlineMm.map(point => ({
            x: refOrigin.x + point.x * refScale,
            y: refOrigin.y + point.y * refScale
        }))
    );

    const labels = placeLabels(placed, rank, refRect);
    const svg = buildSvg(placed, rank, labels, refPaths);
    const pdf = buildPdf(placed, rank, labels, refPaths);
    mkdirSync(dirname(SVG_PATH), { recursive: true });
    writeFileSync(SVG_PATH, svg, 'utf8');
    writeFileSync(PDF_PATH, pdf, 'utf8');
    console.log(JSON.stringify({
        svg: SVG_PATH,
        pdf: PDF_PATH,
        figureMm: { width: +result.figure.width.toFixed(1), height: +result.figure.height.toFixed(1) },
        explodeGapsMm: Object.fromEntries([...gaps.entries()].map(([id, gap]) => [id, +gap.toFixed(2)]))
    }, null, 2));
};

main();

import type { Point, ProjectState } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { buildCharacterPrintLayout } from './fabricationCharacterPrintLayout';
import { svgNumber } from './numberFormat';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlineBounds, pointInsideOutline } from './partGeometry';
import { circlePath, makePdfDocument, num, pdfText } from './simplePdf';

export const makeCustomPartsSvg = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const layout = buildCharacterPrintLayout(project);
    const point = (p: Point) => `${svgNumber(p.x)} ${svgNumber(p.y)}`;
    const path = (points: Point[]) => points.length ? `M ${point(points[0])} ${points.slice(1).map(p => `L ${point(p)}`).join(' ')} Z` : '';
    const items = layout.parts.map(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const d = path(outlineMm);
        const holes = holeMm
            .map(p => `<circle cx="${svgNumber(p.x)}" cy="${svgNumber(p.y)}" r="${svgNumber(layout.holeRadiusMm)}" fill="#ffffff" stroke="#334155" stroke-width="0.45"/>`)
            .join('');
        return `<g data-part-id="${esc(part.id)}">
<line x1="${svgNumber(sourceCenterMm.x)}" y1="${svgNumber(sourceCenterMm.y)}" x2="${svgNumber(printCenterMm.x)}" y2="${svgNumber(printCenterMm.y)}" stroke="#cbd5e1" stroke-width="0.35" stroke-dasharray="1.8 1.8"/>
<path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="0.5"/>
<path d="${d}" fill="${esc(part.fillColor)}" opacity="0.18"/>
${holes}
</g>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${kit.sheetWidthMm}mm" height="${kit.sheetHeightMm}mm" viewBox="0 0 ${kit.sheetWidthMm} ${kit.sheetHeightMm}" data-character-print-page="letter" data-character-print-mode="whole-character-exploded">
<metadata>${esc(JSON.stringify({ project: project.metadata.name, mode: 'custom-parts', printMode: 'whole-character-exploded', page: 'letter', units: 'mm', scale: layout.scale, source: 'fabricablePartOutlinePoints' }))}</metadata>
<rect width="100%" height="100%" fill="#ffffff"/>
<rect x="6" y="6" width="${svgNumber(kit.sheetWidthMm - 12)}" height="${svgNumber(kit.sheetHeightMm - 12)}" rx="6" fill="none" stroke="#dbe3f0" stroke-width="0.5"/>
<text x="10" y="12" font-family="Inter,Arial" font-size="5" font-weight="900" fill="#172033">MotionSmith character cut sheet</text>
<text x="10" y="${svgNumber(kit.sheetHeightMm - 8)}" font-family="Inter,Arial" font-size="3.4" font-weight="700" fill="#64748b">${layout.parts.length} parts · ${kit.holeDiameterMm}mm holes · one letter page</text>
<g data-character-exploded-sheet>
${items}
</g>
</svg>`;
};

const stlNum = (value: number) => Number.isFinite(value) ? Number(value.toFixed(4)) : 0;

export const makeCustomPartsStl = (project: ProjectState) => {
    const thicknessMm = 2.4;
    const holeRadiusMm = Math.max(0.5, project.settings.physicalKit.holeDiameterMm / 2);
    const cellMm = Math.max(1, Math.min(2, holeRadiusMm * 0.75));
    const facets: string[] = [];
    const vertex = (x: number, y: number, z: number) => `      vertex ${stlNum(x)} ${stlNum(y)} ${stlNum(z)}`;
    const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        facets.push(`  facet normal 0 0 0\n    outer loop\n${vertex(...a)}\n${vertex(...b)}\n${vertex(...c)}\n    endloop\n  endfacet`);
    };
    const edge = (a: [number, number], b: [number, number]) => {
        tri([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], thicknessMm]);
        tri([a[0], a[1], 0], [b[0], b[1], thicknessMm], [a[0], a[1], thicknessMm]);
    };
    let cursorX = 0;
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return;
        const bounds = partOutlineBounds(outline);
        const outlineMm = outline.map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const holesMm = landmarks
            .filter(p => pointInsideOutline(p, outline, 0.5))
            .map(p => ({ x: (p.x - bounds.minX) / SCENE_PX_PER_MM, y: (p.y - bounds.minY) / SCENE_PX_PER_MM }));
        const cols = Math.ceil(bounds.width / SCENE_PX_PER_MM / cellMm);
        const rows = Math.ceil(bounds.height / SCENE_PX_PER_MM / cellMm);
        const occupied = new Set<string>();
        const inside = (x: number, y: number) => pointInsideOutline({ x, y }, outlineMm, cellMm * 0.75)
            && !holesMm.some(hole => Math.hypot(x - hole.x, y - hole.y) < holeRadiusMm);
        for (let col = 0; col < cols; col += 1) {
            for (let row = 0; row < rows; row += 1) {
                const cx = (col + 0.5) * cellMm;
                const cy = (row + 0.5) * cellMm;
                if (inside(cx, cy)) occupied.add(`${col}:${row}`);
            }
        }
        const hasCell = (col: number, row: number) => occupied.has(`${col}:${row}`);
        occupied.forEach(key => {
            const [col, row] = key.split(':').map(Number);
            const x0 = cursorX + col * cellMm;
            const y0 = row * cellMm;
            const x1 = cursorX + (col + 1) * cellMm;
            const y1 = (row + 1) * cellMm;
            tri([x0, y0, thicknessMm], [x1, y0, thicknessMm], [x1, y1, thicknessMm]);
            tri([x0, y0, thicknessMm], [x1, y1, thicknessMm], [x0, y1, thicknessMm]);
            tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]);
            tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
            if (!hasCell(col - 1, row)) edge([x0, y0], [x0, y1]);
            if (!hasCell(col + 1, row)) edge([x1, y1], [x1, y0]);
            if (!hasCell(col, row - 1)) edge([x1, y0], [x0, y0]);
            if (!hasCell(col, row + 1)) edge([x0, y1], [x1, y1]);
        });
        cursorX += bounds.width / SCENE_PX_PER_MM + 12;
    });
    return `solid motionsmith_custom_parts_with_${project.settings.physicalKit.holeDiameterMm}mm_holes\n${facets.join('\n')}\nendsolid motionsmith_custom_parts\n`;
};

export const makeCustomPartsPdf = (project: ProjectState) => {
    const kit = project.settings.physicalKit;
    const layout = buildCharacterPrintLayout(project);
    const page = { width: 612, height: 792, margin: 38 };
    const pageScale = Math.min(page.width / kit.sheetWidthMm, page.height / kit.sheetHeightMm);
    const toPdf = (point: Point) => ({ x: point.x * pageScale, y: page.height - point.y * pageScale });
    const border = {
        x: 6 * pageScale,
        y: page.height - (kit.sheetHeightMm - 6) * pageScale,
        width: (kit.sheetWidthMm - 12) * pageScale,
        height: (kit.sheetHeightMm - 12) * pageScale
    };
    const commands: string[] = [
        `BT /F1 14 Tf ${num(page.margin)} ${num(page.height - 32)} Td (${pdfText('MotionSmith character cut sheet')}) Tj ET`,
        `BT /F1 8 Tf ${num(page.margin)} ${num(page.height - 48)} Td (${pdfText(`${project.metadata.name} / whole-character-exploded / letter page / ${kit.holeDiameterMm}mm holes`)}) Tj ET`,
        `0.86 0.89 0.94 RG 0.5 w ${num(border.x)} ${num(border.y)} ${num(border.width)} ${num(border.height)} re S`
    ];
    layout.parts.forEach(({ part, outlineMm, holeMm, sourceCenterMm, printCenterMm }) => {
        const source = toPdf(sourceCenterMm);
        const target = toPdf(printCenterMm);
        commands.push(`0.80 0.84 0.90 RG 0.35 w ${num(source.x)} ${num(source.y)} m ${num(target.x)} ${num(target.y)} l S`);
        const mapped = outlineMm.map(toPdf);
        if (mapped.length) {
            commands.push('0.10 0.16 0.28 RG 0.97 0.98 1.00 rg 0.7 w');
            commands.push(`${num(mapped[0].x)} ${num(mapped[0].y)} m ${mapped.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} h B`);
            const label = toPdf(printCenterMm);
            commands.push(`0.29 0.33 0.43 rg BT /F1 6 Tf ${num(label.x + 5)} ${num(label.y)} Td (${pdfText(part.name)}) Tj ET`);
        }
        holeMm.forEach(point => {
            const center = toPdf(point);
            const radius = Math.max(1.2, layout.holeRadiusMm * pageScale);
            commands.push('0.10 0.16 0.28 RG 1 1 1 rg 0.5 w');
            commands.push(`${circlePath(center.x, center.y, radius)} B`);
        });
    });
    commands.push(`0.39 0.45 0.55 rg BT /F1 7 Tf ${num(page.margin)} ${num(30)} Td (${pdfText(`${layout.parts.length} parts on one letter page`)}) Tj ET`);
    return makePdfDocument(commands.join('\n'));
};

import type { BuildPlanV1 } from './buildPlan';
import { buildPlanCharacterPrintLayout } from './fabricationCustomParts';
import { svgNumber } from './numberFormat';

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));

/** Machine-oriented contours and physical holes only; painted marks are never toolpaths. */
export const makeBuildPlanCutSvg = (plan: BuildPlanV1) => {
    const layout = buildPlanCharacterPrintLayout(plan);
    const width = plan.profile.sheetWidthMm;
    const height = plan.profile.sheetHeightMm;
    const groups = layout.parts.map(item => {
        const offset = item.pageIndex * height;
        const outline = item.outlineMm.map(point => `${svgNumber(point.x)} ${svgNumber(point.y + offset)}`).join(' L ');
        const holes = item.holeMm.map(point => `<circle cx="${svgNumber(point.x)}" cy="${svgNumber(point.y + offset)}" r="${svgNumber(layout.holeRadiusMm)}"/>`).join('');
        return `<g data-part-ref="${esc(item.part.ref)}" data-owner-kind="${item.part.artwork.ownerKind}" data-owner-id="${esc(item.part.artwork.ownerId)}"><path d="M ${outline} Z"/>${holes}</g>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height * layout.pageCount}mm" viewBox="0 0 ${width} ${height * layout.pageCount}" data-build-plan-digest="${esc(plan.sourceDigest)}" data-page-count="${layout.pageCount}" data-artwork="excluded"><g fill="none" stroke="#000000" stroke-width="0.2">${groups}</g></svg>`;
};

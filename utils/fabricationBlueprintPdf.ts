import type { Point } from '../types';
import type { BuildPlanMechanismV1, BuildPlanMotionPathV1, BuildPlanV1 } from './buildPlan';
import { circlePath, makePdfDocument, num, PDF_POINTS_PER_MM, pdfText } from './simplePdf';

const BLUEPRINT_SHEET_MM = 12 * 25.4;
export const BLUEPRINT_PDF_PAGE = Object.freeze({ width: 12 * 72, height: 12 * 72 });

export const BLUEPRINT_PRINT = Object.freeze({
    widthMm: BLUEPRINT_SHEET_MM,
    heightMm: BLUEPRINT_SHEET_MM,
    scale: 1
});

export type BlueprintTile = {
    mechanismIndex: number;
    mechanismId: string;
    tileId: string;
    column: number;
    row: number;
    columns: number;
    rows: number;
    originMm: Point;
    widthMm: number;
    heightMm: number;
};

export const blueprintTilesForBuildPlan = (plan: BuildPlanV1): BlueprintTile[] =>
    plan.mechanisms.map((mechanism, mechanismIndex) => ({
        mechanismIndex,
        mechanismId: mechanism.sourceMechanismId,
        tileId: 'SHEET',
        column: 0,
        row: 0,
        columns: 1,
        rows: 1,
        originMm: { x: -BLUEPRINT_PRINT.widthMm / 2, y: -BLUEPRINT_PRINT.heightMm / 2 },
        widthMm: BLUEPRINT_PRINT.widthMm,
        heightMm: BLUEPRINT_PRINT.heightMm
    }));

const linePath = (points: Point[], toPdf: (point: Point) => Point, close = false) => {
    const mapped = points.map(toPdf);
    if (!mapped.length) return '';
    return `${num(mapped[0].x)} ${num(mapped[0].y)} m ${mapped.slice(1).map(point => `${num(point.x)} ${num(point.y)} l`).join(' ')}${close ? ' h' : ''}`;
};

const motionForMechanism = (motions: readonly BuildPlanMotionPathV1[], mechanism: BuildPlanMechanismV1) =>
    motions.filter(motion => motion.mechanismRefs.includes(mechanism.ref));

const pageForTile = (plan: BuildPlanV1, mechanism: BuildPlanMechanismV1, tile: BlueprintTile) => {
    const left = 0;
    const bottom = 0;
    const width = tile.widthMm * PDF_POINTS_PER_MM;
    const height = tile.heightMm * PDF_POINTS_PER_MM;
    const toPdf = (point: Point): Point => ({
        x: left + (point.x - tile.originMm.x) * PDF_POINTS_PER_MM,
        y: bottom + (point.y - tile.originMm.y) * PDF_POINTS_PER_MM
    });
    const kit = plan.profile;
    const boardSizeMm = kit.boardCells * kit.gridPitchMm;
    const boardHalf = boardSizeMm / 2;
    const paths = motionForMechanism(plan.motions, mechanism);
    const target = paths.map(path => `${path.label} / ${path.id}`).join(', ') || 'Unassigned motion';
    const commands: string[] = [
        `%MS_BLUEPRINT_PAGE document=Blueprint sheet=12x12in scale=1 points_per_mm=${PDF_POINTS_PER_MM.toFixed(9)} mechanism=${mechanism.sourceMechanismId} build=${plan.sourceDigest} geometry=${mechanism.geometry.signature} project=${pdfText(plan.projectName)} target=${pdfText(target)}`,
        'q',
        `${num(left)} ${num(bottom)} ${num(width)} ${num(height)} re W n`,
        '0.78 0.82 0.87 RG 0.35 w',
        `${linePath([
            { x: -boardHalf, y: -boardHalf },
            { x: boardHalf, y: -boardHalf },
            { x: boardHalf, y: boardHalf },
            { x: -boardHalf, y: boardHalf }
        ], toPdf, true)} S`
    ];
    for (let column = 0; column < kit.boardCells; column += 1) {
        for (let row = 0; row < kit.boardCells; row += 1) {
            const point = {
                x: (column - (kit.boardCells - 1) / 2) * kit.gridPitchMm,
                y: ((kit.boardCells - 1) / 2 - row) * kit.gridPitchMm
            };
            const mapped = toPdf(point);
            commands.push('0.58 0.63 0.70 RG 1 1 1 rg 0.35 w');
            commands.push(`${circlePath(mapped.x, mapped.y, kit.holeDiameterMm * PDF_POINTS_PER_MM / 2)} B`);
        }
    }
    paths.forEach(path => {
        if (path.pointsMm.length < 2) return;
        commands.push('[4 3] 0 d 0.05 0.48 0.49 RG 0.75 w');
        commands.push(`${linePath(path.pointsMm, toPdf, path.closed)} S`);
        commands.push('[] 0 d');
    });
    mechanism.geometry.outlines.forEach(outline => {
        if (outline.pointsMm.length < 2) return;
        commands.push('0.08 0.14 0.23 RG 0.97 0.98 1 rg 0.7 w');
        commands.push(`${linePath(outline.pointsMm, toPdf, outline.closed)} B`);
    });
    mechanism.geometry.points.forEach(point => {
        const mapped = toPdf({ x: point.xMm, y: point.yMm });
        commands.push('0.08 0.14 0.23 RG 1 1 1 rg 0.55 w');
        commands.push(`${circlePath(mapped.x, mapped.y, kit.holeDiameterMm * PDF_POINTS_PER_MM / 2)} B`);
        commands.push(`0.08 0.14 0.23 rg BT /F1 6 Tf ${num(mapped.x + 5)} ${num(mapped.y + 5)} Td (${pdfText(point.label)}) Tj ET`);
    });
    commands.push('Q');
    return commands.join('\n');
};

export const makeBlueprintPdfPageContentsFromBuildPlan = (plan: BuildPlanV1) => {
    const tiles = blueprintTilesForBuildPlan(plan);
    if (!tiles.length) return [`BT /F1 15 Tf 40 824 Td (${pdfText(`${plan.projectName} / Blueprint`)}) Tj ET\nBT /F1 10 Tf 40 792 Td (No enabled mechanisms.) Tj ET`];
    return tiles.map(tile => pageForTile(plan, plan.mechanisms[tile.mechanismIndex], tile));
};

export const makeBlueprintPdfFromBuildPlan = (plan: BuildPlanV1) =>
    makePdfDocument(makeBlueprintPdfPageContentsFromBuildPlan(plan), BLUEPRINT_PDF_PAGE);

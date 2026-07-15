import type { FabricationRecipe, ProjectState } from '../types';
import { boardToScene, sceneBoundsForSheet } from './coordinates';
import {
    fabricationBoardColumnLabel,
    fabricationBoardRowLabel
} from './fabricationContract';
import { fabricationRecipeTitle, recipeBoardCallout } from './fabricationRecipes';
import { generateCurvePoints } from './kinematics';
import { circlePath, hexRgb, makePdfDocument, num, pdfText } from './simplePdf';

export const makeCutSheetPdf = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const page = { width: 612, height: 792, margin: 38, titleY: 760 };
    const scale = Math.min((page.width - page.margin * 2) / bounds.width, (page.height - 150) / bounds.height);
    const origin = { x: page.width / 2, y: 390 };
    const toPdf = (p: { x: number; y: number }) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale });
    const sheetLeft = origin.x + bounds.x * scale;
    const sheetBottom = origin.y + bounds.y * scale;
    const commands: string[] = [
        `BT /F1 14 Tf ${page.margin} ${page.titleY} Td (Cut sheet: ${pdfText(project.metadata.name)}) Tj ET`,
        `BT /F1 9 Tf ${page.margin} ${page.titleY - 18} Td (Profile ${pdfText(kit.profileKey)} / ${kit.gridPitchMm}mm pitch / ${kit.boardCells}x${kit.boardCells} board holes) Tj ET`,
        '0.92 0.95 1.00 rg 0.10 0.16 0.28 RG 1.1 w',
        `${num(sheetLeft)} ${num(sheetBottom)} ${num(bounds.width * scale)} ${num(bounds.height * scale)} re B`
    ];
    for (let c = 0; c < kit.boardCells; c++) {
        for (let r = 0; r < kit.boardCells; r++) {
            const recipe = recipes.find(x => x.board.valid !== false && x.board.col === c && x.board.row === r);
            const p = toPdf(boardToScene(c, r, kit));
            if (r === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 4)} ${num(p.y + 13)} Td (${pdfText(fabricationBoardColumnLabel(c))}) Tj ET`);
            if (c === 0) commands.push(`0.40 0.46 0.57 rg BT /F1 6 Tf ${num(p.x - 20)} ${num(p.y - 2)} Td (${pdfText(fabricationBoardRowLabel(r))}) Tj ET`);
            commands.push(recipe ? '0.94 0.27 0.27 rg' : '0.62 0.68 0.78 rg');
            commands.push(`${circlePath(p.x, p.y, recipe ? 3.8 : 1.7)} f`);
            if (recipe) commands.push(`0.10 0.16 0.28 rg BT /F1 7 Tf ${num(p.x + 6)} ${num(p.y + 5)} Td (${pdfText(`${recipe.mechanismId} ${recipeBoardCallout(recipe)}`)}) Tj ET`);
        }
    }
    project.mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        const points = generateCurvePoints(m, 48, kit).points.map(toPdf);
        if (points.length > 1) {
            commands.push(`${hexRgb(m.color)} RG 0.9 w`);
            commands.push(`${num(points[0].x)} ${num(points[0].y)} m ${points.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} S`);
        }
    });
    recipes.slice(0, 12).forEach((recipe, index) => {
        commands.push(`0.10 0.16 0.28 rg BT /F1 8 Tf ${page.margin} ${118 - index * 10} Td (${pdfText(`${recipe.mechanismId}: ${fabricationRecipeTitle(recipe)} anchor ${recipeBoardCallout(recipe)}`)}) Tj ET`);
    });
    return makePdfDocument(commands.join('\n'));
};

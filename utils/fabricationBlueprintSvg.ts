import type { BodyPartLayer, FabricationRecipe, Point, ProjectState } from '../types';
import { boardToScene, sceneBoundsForSheet, sceneToSvg } from './coordinates';
import {
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationPartDisplayLabel
} from './fabricationContract';
import { referenceRecipeForType } from './mechanismReference';
import { svgNumber } from './numberFormat';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlineBounds } from './partGeometry';

export const makeBlueprintSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const label = (value: unknown, max = 24) => {
        const text = String(value);
        return esc(text.length > max ? `${text.slice(0, max - 1)}…` : text);
    };
    const requiredParts = Array.from(recipes.flatMap(recipe => recipe.requiredParts).reduce((map, part) => {
        map.set(part.name, (map.get(part.name) ?? 0) + part.quantity);
        return map;
    }, new Map<string, number>()).entries());
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, mechanisms: recipes.map(r => r.mechanismId) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:11px;font-weight:900;letter-spacing:.14em;fill:#64748b}.body{font-size:11px;font-weight:800;fill:#1f2937}.muted{fill:#64748b}.chip{fill:#eef2ff;stroke:#c4b5fd;stroke-width:1}.sheet{fill:#fff;stroke:#0f172a;stroke-width:1.5}.hole{fill:#cbd5e1}.anchor{fill:#ef4444;stroke:#fff;stroke-width:2.5}.callout{fill:#fff7ed;stroke:#fed7aa;stroke-width:1.1}]]></style>`;
    const sheet = { x: 450 + bounds.x, y: 340 - bounds.y - bounds.height, width: bounds.width, height: bounds.height };
    svg += `<rect x="${svgNumber(sheet.x)}" y="${svgNumber(sheet.y)}" width="${svgNumber(sheet.width)}" height="${svgNumber(sheet.height)}" class="sheet"/>`;
    for (let c = 0; c < kit.boardCells; c += 1) {
        for (let r = 0; r < kit.boardCells; r += 1) {
            const recipe = recipes.find(item => item.board.valid !== false && item.board.col === c && item.board.row === r);
            const { x, y } = sceneToSvg(boardToScene(c, r, kit));
            if (r === 0) svg += `<text x="${svgNumber(x)}" y="${svgNumber(y - 16)}" font-size="8" font-weight="900" text-anchor="middle" fill="#64748b">${esc(fabricationBoardColumnLabel(c))}</text>`;
            if (c === 0) svg += `<text x="${svgNumber(x - 16)}" y="${svgNumber(y + 3)}" font-size="8" font-weight="900" text-anchor="end" fill="#64748b">${esc(fabricationBoardRowLabel(r))}</text>`;
            svg += `<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${recipe ? 5 : 2}" class="${recipe ? 'anchor' : 'hole'}"/>`;
            if (recipe) {
                const boardCallout = fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);
                const title = `${referenceRecipeForType(recipe.type).title} · ${boardCallout}`;
                svg += `<g data-recipe-anchor="${esc(recipe.mechanismId)}" data-board-callout="${esc(boardCallout)}"><rect x="${svgNumber(Math.min(742, x + 9))}" y="${svgNumber(y - 19)}" width="132" height="24" rx="12" class="callout"/><text x="${svgNumber(Math.min(750, x + 17))}" y="${svgNumber(y - 3)}" class="body">${label(title, 22)}</text></g>`;
            }
        }
    }
    svg += `<text x="30" y="54" class="caps">KIT PARTS</text>`;
    (requiredParts.length ? requiredParts.slice(0, 14) : [['No mechanism module', 0] as [string, number]]).forEach(([name, quantity], index) => {
        const y = 82 + index * 30;
        svg += `<rect x="28" y="${svgNumber(y - 17)}" width="178" height="23" rx="11.5" class="chip"/>`;
        svg += `<text x="42" y="${svgNumber(y - 1)}" class="body">${label(fabricationPartDisplayLabel(name), 18)}${quantity ? ` × ${quantity}` : ''}</text>`;
    });
    svg += `</svg>`;
    return svg;
};


export const makeBlueprintPreviewSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const safeColor = (value: string | undefined) => /^#[0-9a-fA-F]{3,8}$/.test(value ?? '') ? value : '#64748b';
    const label = (value: unknown, max = 28) => {
        const text = String(value);
        return esc(text.length > max ? `${text.slice(0, max - 1)}…` : text);
    };
    const partOutline = (part: BodyPartLayer, x: number, y: number, width: number, height: number, index: number) => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return '';
        const bounds = partOutlineBounds(outline);
        const scale = Math.min(width / Math.max(1, bounds.width), (height - 14) / Math.max(1, bounds.height));
        const ox = (width - bounds.width * scale) / 2 - bounds.minX * scale;
        const oy = 7 - bounds.minY * scale;
        const xy = (point: Point) => `${svgNumber(ox + point.x * scale)} ${svgNumber(oy + point.y * scale)}`;
        const d = `M ${xy(outline[0])} ${outline.slice(1).map(point => `L ${xy(point)}`).join(' ')} Z`;
        const holes = landmarks
            .filter(point => point.x >= bounds.minX - 1 && point.x <= bounds.maxX + 1 && point.y >= bounds.minY - 1 && point.y <= bounds.maxY + 1)
            .map(point => `<circle cx="${svgNumber(ox + point.x * scale)}" cy="${svgNumber(oy + point.y * scale)}" r="${svgNumber(Math.max(2.2, kit.holeDiameterMm * 0.72))}" fill="#ffffff" stroke="#334155" stroke-width="1.2"/>`)
            .join('');
        return `<g data-cut-part="${esc(part.id)}" transform="translate(${svgNumber(x)} ${svgNumber(y)})"><rect width="${svgNumber(width)}" height="${svgNumber(height)}" rx="16" class="part-tile"/><path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="1.3"/><path d="${d}" fill="${esc(safeColor(part.fillColor))}" opacity="0.34"/>${holes}<circle cx="18" cy="18" r="10" class="part-number"/><text x="18" y="22" text-anchor="middle" class="number-label">${index + 1}</text></g>`;
    };
    const requiredParts = Array.from(recipes.flatMap(recipe => recipe.requiredParts).reduce((map, part) => {
        map.set(part.name, (map.get(part.name) ?? 0) + part.quantity);
        return map;
    }, new Map<string, number>()).entries());
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const cells = Math.max(1, kit.boardCells);
    const pitch = Math.min(34, 462 / Math.max(1, cells - 1));
    const boardX = 350;
    const boardY = 132;
    const boardSize = pitch * Math.max(0, cells - 1);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract" data-blueprint-visual-mode="board-hero">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, recipes: recipes.map(r => ({ id: r.mechanismId, type: r.type, board: r.boardCoordinate })) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:12px;font-weight:900;letter-spacing:.16em;fill:#64748b}.body{font-size:12px;font-weight:800;fill:#1f2937}.muted{fill:#64748b}.board-label{font-size:10px;font-weight:900;fill:#64748b}.hole{fill:#cbd5e1}.anchor{fill:#ef4444;stroke:white;stroke-width:3}.anchor-ring{fill:rgba(239,68,68,.12);stroke:#ef4444;stroke-width:2.6}.part-card,.kit-card{fill:white;stroke:#e2e8f0;stroke-width:1.4}.part-tile{fill:#ffffff;stroke:#e2e8f0;stroke-width:1}.board-card{fill:white;stroke:#0f172a;stroke-width:1.8}.board-shadow{fill:#e2e8f0}.callout{fill:#fff7ed;stroke:#fed7aa;stroke-width:1.2}.chip{fill:#eef2ff;stroke:#c4b5fd;stroke-width:1}.part-number,.recipe-number{fill:#8b5cf6;stroke:#fff;stroke-width:2}.number-label{font-size:10px;font-weight:900;fill:#fff}.step-dot{fill:#ede9fe;stroke:#8b5cf6;stroke-width:1.4}.trace{fill:none;stroke:#8b5cf6;stroke-width:2;stroke-dasharray:8 8;opacity:.52}]]></style>`;
    svg += `<g data-blueprint-flow="visual-summary"><circle cx="38" cy="36" r="10" class="step-dot"/><path d="M54 36H96" class="trace"/><circle cx="112" cy="36" r="10" class="step-dot"/><path d="M128 36H170" class="trace"/><circle cx="186" cy="36" r="10" class="step-dot"/><text x="210" y="41" class="caps">CUT · PLACE · BUILD</text></g>`;
    svg += `<g data-blueprint-parts-panel"><text x="32" y="76" class="caps">PARTS</text><rect x="24" y="94" width="244" height="382" rx="22" class="part-card"/>`;
    if (parts.length) {
        parts.slice(0, 8).forEach((part, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            svg += partOutline(part, 42 + col * 108, 114 + row * 84, 92, 70, index);
        });
        if (parts.length > 8) svg += `<text x="42" y="456" class="body muted">+${parts.length - 8}</text>`;
    } else {
        svg += `<rect x="64" y="206" width="164" height="74" rx="18" fill="#f8fafc" stroke="#e2e8f0"/><text x="146" y="249" text-anchor="middle" class="body muted">No cuts</text>`;
    }
    svg += `</g>`;
    svg += `<g data-blueprint-kit-panel"><text x="32" y="514" class="caps">KIT</text><rect x="24" y="532" width="244" height="108" rx="22" class="kit-card"/>`;
    const kitLines = requiredParts.length ? requiredParts.slice(0, 6) : [['No mechanism module', 0] as [string, number]];
    kitLines.forEach(([name, quantity], index) => {
        const x = 42 + (index % 2) * 106;
        const y = 558 + Math.floor(index / 2) * 30;
        svg += `<rect x="${x}" y="${svgNumber(y - 17)}" width="92" height="23" rx="11.5" class="chip"/>`;
        svg += `<text x="${x + 10}" y="${svgNumber(y - 1)}" class="body">${label(fabricationPartDisplayLabel(name), 10)}${quantity ? ` ×${quantity}` : ''}</text>`;
    });
    svg += `</g>`;

    svg += `<g data-blueprint-board-hero"><text x="${boardX - 30}" y="76" class="caps">BOARD</text><text x="${boardX + 28}" y="76" class="body muted">${cells}×${cells} · ${kit.gridPitchMm}mm</text>`;
    svg += `<rect x="${boardX - 36}" y="${boardY - 36}" width="${boardSize + 72}" height="${boardSize + 72}" rx="28" class="board-shadow" opacity=".48" transform="translate(8 10)"/>`;
    svg += `<rect x="${boardX - 36}" y="${boardY - 36}" width="${boardSize + 72}" height="${boardSize + 72}" rx="28" class="board-card"/>`;
    for (let c = 0; c < cells; c += 1) {
        for (let r = 0; r < cells; r += 1) {
            const x = boardX + c * pitch;
            const y = boardY + r * pitch;
            const atCell = recipes.filter(recipe => recipe.board.valid !== false && recipe.board.col === c && recipe.board.row === r);
            if (r === 0) svg += `<text x="${svgNumber(x)}" y="${svgNumber(boardY - 50)}" text-anchor="middle" class="board-label">${esc(fabricationBoardColumnLabel(c))}</text>`;
            if (c === 0) svg += `<text x="${svgNumber(boardX - 48)}" y="${svgNumber(y + 3)}" text-anchor="end" class="board-label">${esc(fabricationBoardRowLabel(r))}</text>`;
            svg += `<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${atCell.length ? 5.5 : 2.4}" class="${atCell.length ? 'anchor' : 'hole'}"/>`;
            if (atCell.length) {
                atCell.slice(0, 2).forEach((recipe, index) => {
                    const boardCallout = fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);
                    const calloutX = Math.min(806, x + 18);
                    const calloutY = Math.max(112, y - 22 + index * 27);
                    const recipeNumber = recipes.findIndex(item => item.mechanismId === recipe.mechanismId) + 1;
                    svg += `<g data-recipe-anchor="${esc(recipe.mechanismId)}" data-board-callout="${esc(boardCallout)}" data-recipe-number="${recipeNumber}"><circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="17" class="anchor-ring"/><rect x="${svgNumber(calloutX)}" y="${svgNumber(calloutY - 15)}" width="78" height="24" rx="12" class="callout"/><circle cx="${svgNumber(calloutX + 13)}" cy="${svgNumber(calloutY - 3)}" r="10" class="recipe-number"/><text x="${svgNumber(calloutX + 13)}" y="${svgNumber(calloutY + 1)}" text-anchor="middle" class="number-label">${recipeNumber}</text><text x="${svgNumber(calloutX + 29)}" y="${svgNumber(calloutY + 1)}" class="body">${esc(boardCallout.split(' · ')[0])}</text></g>`;
                });
            }
        }
    }
    if (!recipes.length) svg += `<rect x="${svgNumber(boardX + boardSize / 2 - 84)}" y="${svgNumber(boardY + boardSize / 2 - 24)}" width="168" height="48" rx="24" class="chip"/><text x="${svgNumber(boardX + boardSize / 2)}" y="${svgNumber(boardY + boardSize / 2 + 4)}" text-anchor="middle" class="body muted">Add mechanism</text>`;
    svg += `</g></svg>`;
    return svg;
};

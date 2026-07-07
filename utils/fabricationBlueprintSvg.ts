import type { BodyPartLayer, FabricationRecipe, Point, ProjectState } from '../types';
import { boardToScene, sceneBoundsForSheet, sceneToSvg } from './coordinates';
import {
    fabricationBoardColumnLabel,
    fabricationBoardCoordinateCallout,
    fabricationBoardRowLabel,
    fabricationPartDisplayLabel
} from './fabricationContract';
import { buildCharacterPrintLayout } from './fabricationCharacterPrintLayout';
import { fabricationRecipeTitle } from './fabricationRecipes';
import { svgNumber } from './numberFormat';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlineBounds } from './partGeometry';
import { sampledCamProfileScale } from './kinematics';

const camProfilePathD = (samples: number[] | undefined, x: number, y: number, radius: number) => {
    if (!samples?.length) return '';
    const points = Array.from({ length: 48 }, (_, index) => {
        const angle = (index / 48) * Math.PI * 2;
        const rr = radius * sampledCamProfileScale(angle, samples);
        return `${svgNumber(x + Math.cos(angle) * rr)} ${svgNumber(y + Math.sin(angle) * rr)}`;
    });
    return `M ${points.join(' L ')} Z`;
};

const camProfileEntries = (recipes: FabricationRecipe[]) =>
    recipes.flatMap(recipe => recipe.type === 'cam' && recipe.camProfileSamples?.length
        ? [{ id: recipe.mechanismId, samples: recipe.camProfileSamples }]
        : []);

const firstCamProfileSamples = (recipes: FabricationRecipe[]) =>
    camProfileEntries(recipes)[0]?.samples;

const isBoardBuildRole = (role: string | undefined) =>
    Boolean(role && (role === 'board' || role === 'board_axle' || role.includes('board')));

const buildCoordinateEntries = (recipes: FabricationRecipe[]) => {
    const seen = new Set<string>();
    return recipes.flatMap(recipe => [
        { coord: recipe.boardCoordinate, recipe },
        ...recipe.assemblySteps.flatMap(step => (step.coords ?? [])
            .map((coord, index) => ({ coord, role: step.coordRoles?.[index], recipe }))
            .filter(item => isBoardBuildRole(item.role)))
    ]).filter(item => {
        if (!/^[A-O](?:[1-9]|1[0-5])$/.test(item.coord)) return false;
        const key = `${item.recipe.mechanismId}:${item.coord}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

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
    const camProfiles = camProfileEntries(recipes);
    const buildCoordinates = buildCoordinateEntries(recipes);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, mechanisms: recipes.map(r => r.mechanismId), camProfiles: recipes.filter(r => r.type === 'cam').map(r => ({ id: r.mechanismId, samples: r.camProfileSamples ?? [] })) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:11px;font-weight:900;letter-spacing:.14em;fill:#64748b}.body{font-size:11px;font-weight:800;fill:#1f2937}.muted{fill:#64748b}.chip{fill:#eef2ff;stroke:#c4b5fd;stroke-width:1}.sheet{fill:#fff;stroke:#0f172a;stroke-width:1.5}.hole{fill:#cbd5e1}.anchor{fill:#ef4444;stroke:#fff;stroke-width:2.5}.callout{fill:#fff7ed;stroke:#fed7aa;stroke-width:1.1}]]></style>`;
    const sheet = { x: 450 + bounds.x, y: 340 - bounds.y - bounds.height, width: bounds.width, height: bounds.height };
    svg += `<rect x="${svgNumber(sheet.x)}" y="${svgNumber(sheet.y)}" width="${svgNumber(sheet.width)}" height="${svgNumber(sheet.height)}" class="sheet"/>`;
    for (let c = 0; c < kit.boardCells; c += 1) {
        for (let r = 0; r < kit.boardCells; r += 1) {
            const recipe = recipes.find(item => item.board.valid !== false && item.board.col === c && item.board.row === r);
            const coord = `${fabricationBoardColumnLabel(c)}${r + 1}`;
            const buildSpot = buildCoordinates.find(item => item.coord === coord);
            const { x, y } = sceneToSvg(boardToScene(c, r, kit));
            if (r === 0) svg += `<text x="${svgNumber(x)}" y="${svgNumber(y - 16)}" font-size="8" font-weight="900" text-anchor="middle" fill="#64748b">${esc(fabricationBoardColumnLabel(c))}</text>`;
            if (c === 0) svg += `<text x="${svgNumber(x - 16)}" y="${svgNumber(y + 3)}" font-size="8" font-weight="900" text-anchor="end" fill="#64748b">${esc(fabricationBoardRowLabel(r))}</text>`;
            svg += `<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${recipe || buildSpot ? 5 : 2}" class="${recipe || buildSpot ? 'anchor' : 'hole'}" ${buildSpot ? `data-blueprint-board-coordinate="${esc(coord)}"` : ''}/>`;
            if (recipe) {
                const boardCallout = fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board);
                const title = `${fabricationRecipeTitle(recipe)} · ${boardCallout}`;
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
    camProfiles.slice(0, 5).forEach((entry, index) => {
        const cy = 154 + index * 54;
        svg += `<g data-blueprint-cam-profile="${esc(entry.samples.join(','))}" data-blueprint-cam-profile-id="${esc(entry.id)}" data-cam-profile="${esc(entry.samples.join(','))}"><path d="${camProfilePathD(entry.samples, 295, cy, 26)}" fill="#fed7aa" stroke="#ea580c" stroke-width="3"/><circle cx="295" cy="${svgNumber(cy)}" r="7" fill="#fff" stroke="#334155" stroke-width="2"/><text x="338" y="${svgNumber(cy + 5)}" class="body">${label(`Edited cam disk ${index + 1}`, 20)}</text></g>`;
    });
    svg += `</svg>`;
    return svg;
};


export const makeBlueprintPreviewSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const layout = buildCharacterPrintLayout(project);
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const safeColor = (value: string | undefined) => /^#[0-9a-fA-F]{3,8}$/.test(value ?? '') ? value : '#64748b';
    const label = (value: unknown, max = 28) => {
        const text = String(value);
        return esc(text.length > max ? `${text.slice(0, max - 1)}…` : text);
    };
    const requiredParts = Array.from(recipes.flatMap(recipe => recipe.requiredParts).reduce((map, part) => {
        map.set(part.name, (map.get(part.name) ?? 0) + part.quantity);
        return map;
    }, new Map<string, number>()).entries());
    const camProfiles = camProfileEntries(recipes);
    const camProfileSamples = camProfiles[0]?.samples;
    const point = (p: Point, x: number, y: number, scale: number) => `${svgNumber(x + p.x * scale)} ${svgNumber(y + p.y * scale)}`;
    const path = (points: Point[], x: number, y: number, scale: number) => points.length
        ? `M ${point(points[0], x, y, scale)} ${points.slice(1).map(p => `L ${point(p, x, y, scale)}`).join(' ')} Z`
        : '';

    const characterSheet = (x: number, y: number, width: number, height: number) => {
        if (!layout.parts.length) return `<rect x="${x + 28}" y="${y + 136}" width="${width - 56}" height="86" rx="18" class="empty-card"/><text x="${x + width / 2}" y="${y + 186}" text-anchor="middle" class="body muted">No character cuts</text>`;
        const pages = Array.from({ length: layout.pageCount }, (_, index) => index);
        const gap = 12;
        const pageWidth = (width - gap * (pages.length - 1)) / pages.length;
        const pageScale = Math.min(pageWidth / kit.sheetWidthMm, height / kit.sheetHeightMm);
        const scaledPageWidth = kit.sheetWidthMm * pageScale;
        const scaledPageHeight = kit.sheetHeightMm * pageScale;
        return pages.map(pageIndex => {
            const pageX = x + pageIndex * (pageWidth + gap) + (pageWidth - scaledPageWidth) / 2;
            const pageY = y + (height - scaledPageHeight) / 2;
            const items = layout.parts.filter(item => item.pageIndex === pageIndex).map(({ part, outlineMm, holeMm }, index) => {
                const d = path(outlineMm, pageX, pageY, pageScale);
                const holes = holeMm.map(hole => `<circle cx="${svgNumber(pageX + hole.x * pageScale)}" cy="${svgNumber(pageY + hole.y * pageScale)}" r="${svgNumber(Math.max(1.8, layout.holeRadiusMm * pageScale))}" fill="#ffffff" stroke="#334155" stroke-width="1.1"/>`).join('');
                return `<g data-print-character-part="${esc(part.id)}"><path d="${d}" fill="#f8fafc" stroke="#172033" stroke-width="1.25"/><path d="${d}" fill="${esc(safeColor(part.fillColor))}" opacity="0.28"/>${holes}</g>`;
            }).join('');
            return `<g data-character-sheet-page="${pageIndex + 1}"><rect x="${svgNumber(pageX)}" y="${svgNumber(pageY)}" width="${svgNumber(scaledPageWidth)}" height="${svgNumber(scaledPageHeight)}" rx="10" class="print-page"/><text x="${svgNumber(pageX + 12)}" y="${svgNumber(pageY + 18)}" class="page-label">Page ${pageIndex + 1}</text>${items}</g>`;
        }).join('');
    };

    const mechanismIcon = (name: string, x: number, y: number) => {
        const text = fabricationPartDisplayLabel(name);
        if (/guide|cartridge/i.test(text)) return `<g data-blueprint-icon="guide-cartridge"><rect x="${x + 15}" y="${y + 9}" width="34" height="44" rx="8" class="guide-shape"/><rect x="${x + 25}" y="${y + 14}" width="14" height="34" rx="5" fill="#fff" stroke="#2563eb" stroke-width="2"/></g>`;
        if (/follower/i.test(text)) return `<g data-blueprint-icon="gravity-follower"><rect x="${x + 28}" y="${y + 9}" width="9" height="35" rx="4" class="follower-shape"/><circle cx="${x + 32.5}" cy="${y + 47}" r="8" class="part-hole"/></g>`;
        if (/swappable cam|cam disk|cam lock|crank handle|axle peg/i.test(text)) {
            const d = camProfilePathD(camProfileSamples, x + 32, y + 31, 22)
                || `M ${svgNumber(x + 32)} ${svgNumber(y + 8)} C ${svgNumber(x + 52)} ${svgNumber(y + 11)} ${svgNumber(x + 57)} ${svgNumber(y + 32)} ${svgNumber(x + 43)} ${svgNumber(y + 45)} C ${svgNumber(x + 28)} ${svgNumber(y + 59)} ${svgNumber(x + 9)} ${svgNumber(y + 47)} ${svgNumber(x + 12)} ${svgNumber(y + 28)} C ${svgNumber(x + 14)} ${svgNumber(y + 14)} ${svgNumber(x + 22)} ${svgNumber(y + 6)} ${svgNumber(x + 32)} ${svgNumber(y + 8)} Z`;
            return `<g data-blueprint-icon="cam-module" ${camProfileSamples?.length ? `data-cam-profile="${esc(camProfileSamples.join(','))}"` : ''}><path d="${d}" class="cam-shape"/><circle cx="${x + 32}" cy="${y + 31}" r="7" class="part-hole"/></g>`;
        }
        if (/gear|teeth|ring/i.test(text)) return `<g><circle cx="${x + 32}" cy="${y + 31}" r="25" class="gear-shape"/><circle cx="${x + 32}" cy="${y + 31}" r="8" class="part-hole"/><circle cx="${x + 32}" cy="${y + 31}" r="19" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-dasharray="3 5"/></g>`;
        if (/spacer|washer/i.test(text)) return `<g><circle cx="${x + 32}" cy="${y + 31}" r="22" class="spacer-shape"/><circle cx="${x + 32}" cy="${y + 31}" r="8" class="part-hole"/></g>`;
        if (/clip/i.test(text)) return `<g><rect x="${x + 13}" y="${y + 13}" width="38" height="36" rx="12" class="clip-shape"/><circle cx="${x + 32}" cy="${y + 31}" r="7" class="part-hole"/></g>`;
        return `<g><rect x="${x + 9}" y="${y + 20}" width="50" height="22" rx="11" class="link-shape"/><circle cx="${x + 18}" cy="${y + 31}" r="5.5" class="part-hole"/><circle cx="${x + 50}" cy="${y + 31}" r="5.5" class="part-hole"/></g>`;
    };

    const mechanismSheet = (x: number, y: number, width: number, height: number) => {
        if (!requiredParts.length) return `<rect x="${x + 22}" y="${y + 116}" width="${width - 44}" height="74" rx="18" class="empty-card"/><text x="${x + width / 2}" y="${y + 160}" text-anchor="middle" class="body muted">Add mechanism</text>`;
        return requiredParts.slice(0, 8).map(([name, quantity], index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const tileX = x + 18 + col * ((width - 48) / 2 + 12);
            const tileY = y + 36 + row * 76;
            const tileWidth = (width - 48) / 2;
            return `<g data-print-mechanism-part="${esc(name)}"><rect x="${svgNumber(tileX)}" y="${svgNumber(tileY)}" width="${svgNumber(tileWidth)}" height="64" rx="14" class="mechanism-tile"/>${mechanismIcon(name, tileX + 4, tileY + 1)}<text x="${svgNumber(tileX + 70)}" y="${svgNumber(tileY + 29)}" class="body">${label(fabricationPartDisplayLabel(name), 15)}</text><text x="${svgNumber(tileX + 70)}" y="${svgNumber(tileY + 47)}" class="muted small">×${quantity}</text></g>`;
        }).join('') + (requiredParts.length > 8 ? `<text x="${x + 20}" y="${y + height - 18}" class="body muted">+${requiredParts.length - 8} more</text>` : '');
    };

    const boardSummary = (x: number, y: number, width: number, height: number) => {
        const cells = Math.max(1, kit.boardCells);
        const pitch = Math.min((width - 48) / Math.max(1, cells - 1), (height - 46) / Math.max(1, cells - 1));
        const gridX = x + 24;
        const gridY = y + 34;
        const anchors = buildCoordinateEntries(recipes);
        let grid = '';
        for (let c = 0; c < cells; c += 1) {
            for (let r = 0; r < cells; r += 1) {
                const coord = `${String.fromCharCode(65 + c)}${r + 1}`;
                const atCell = anchors.filter(item => item.coord === coord);
                const cx = gridX + c * pitch;
                const cy = gridY + r * pitch;
                grid += `<circle cx="${svgNumber(cx)}" cy="${svgNumber(cy)}" r="${atCell.length ? 4.5 : 1}" class="${atCell.length ? 'anchor' : 'hole'}" ${atCell.length ? `data-blueprint-board-coordinate="${esc(coord)}"` : ''}/>`;
            }
        }
        return `<g data-blueprint-board-summary><text x="${x}" y="${y + 15}" class="caps">BOARD</text><text x="${x + 72}" y="${y + 15}" class="body muted">${anchors.length ? `${anchors.length} build spot${anchors.length === 1 ? '' : 's'}` : 'No build spots'}</text><rect x="${x}" y="${y + 24}" width="${width}" height="${height - 24}" rx="18" class="board-card"/>${grid}</g>`;
    };

    const camProfileGallery = (x: number, y: number) => camProfiles.slice(0, 4).map((entry, index) => {
        const cx = x + (index % 2) * 118;
        const cy = y + Math.floor(index / 2) * 48;
        return `<g data-blueprint-cam-profile="${esc(entry.samples.join(','))}" data-blueprint-cam-profile-id="${esc(entry.id)}" data-cam-profile="${esc(entry.samples.join(','))}"><path d="${camProfilePathD(entry.samples, cx + 24, cy + 22, 18)}" class="cam-shape"/><circle cx="${svgNumber(cx + 24)}" cy="${svgNumber(cy + 22)}" r="5" class="part-hole"/><text x="${svgNumber(cx + 50)}" y="${svgNumber(cy + 27)}" class="small muted">${label(entry.id, 13)}</text></g>`;
    }).join('');

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680" data-blueprint-source="fabrication-contract" data-blueprint-visual-mode="print-sheet-hero" data-blueprint-visual-density="student-simple">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, recipes: recipes.map(r => ({ id: r.mechanismId, type: r.type, board: r.boardCoordinate })), characterPages: layout.pageCount }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    svg += `<style><![CDATA[text{font-family:Manrope,Inter,Arial,sans-serif}.caps{font-size:12px;font-weight:900;letter-spacing:.16em;fill:#64748b}.body{font-size:12px;font-weight:850;fill:#1f2937}.muted{fill:#64748b}.small{font-size:10px;font-weight:800}.mini-label{font-size:7px;font-weight:850;fill:#64748b}.page-label{font-size:9px;font-weight:900;fill:#64748b}.sheet-card,.print-page,.board-card{fill:#fff;stroke:#e2e8f0;stroke-width:1.5}.print-page{stroke:#cbd5e1}.empty-card,.mechanism-tile{fill:#fff;stroke:#e2e8f0;stroke-width:1.2}.hole{fill:#cbd5e1;opacity:.48}.anchor{fill:#8b5cf6;stroke:white;stroke-width:2}.part-hole{fill:#fff;stroke:#334155;stroke-width:2}.gear-shape{fill:#ede9fe;stroke:#8b5cf6;stroke-width:3;stroke-dasharray:3 4}.spacer-shape{fill:#fef3c7;stroke:#d97706;stroke-width:3}.clip-shape{fill:#e0f2fe;stroke:#0284c7;stroke-width:2}.link-shape{fill:#dbeafe;stroke:#2563eb;stroke-width:2}.cam-shape{fill:#fed7aa;stroke:#ea580c;stroke-width:2.4}.guide-shape{fill:#dbeafe;stroke:#2563eb;stroke-width:2.4}.follower-shape{fill:#dcfce7;stroke:#16a34a;stroke-width:2.2}.step-dot{fill:#ede9fe;stroke:#8b5cf6;stroke-width:1.4}.trace{fill:none;stroke:#8b5cf6;stroke-width:2;stroke-dasharray:8 8;opacity:.52}]]></style>`;
    svg += `<g data-blueprint-flow="visual-summary"><circle cx="38" cy="36" r="10" class="step-dot"/><path d="M54 36H96" class="trace"/><circle cx="112" cy="36" r="10" class="step-dot"/><path d="M128 36H170" class="trace"/><circle cx="186" cy="36" r="10" class="step-dot"/><text x="210" y="41" class="caps">PRINT · CUT · BUILD</text></g>`;
    svg += `<g data-blueprint-print-hero><text x="32" y="76" class="caps">CHARACTER SHEET</text><text x="206" y="76" class="body muted">Print, cut, then pin</text><rect x="24" y="92" width="520" height="540" rx="24" class="sheet-card"/>${characterSheet(44, 118, 480, 488)}<text x="44" y="614" class="body muted">${layout.parts.length} character part${layout.parts.length === 1 ? '' : 's'} · ${layout.pageCount} page${layout.pageCount === 1 ? '' : 's'}</text><text x="578" y="76" class="caps">MECHANISM PARTS</text><rect x="566" y="92" width="302" height="360" rx="24" class="sheet-card"/>${mechanismSheet(584, 112, 266, 318)}${camProfileGallery(590, 412)}${boardSummary(566, 486, 302, 146)}</g>`;
    svg += `</svg>`;
    return svg;
};

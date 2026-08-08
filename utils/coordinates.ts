import { BodyPartLayer, Bounds, Point, PhysicalKitSettings, StandardSkeleton } from '../types';

export const LETTER_SHEET = { widthMm: 215.9, heightMm: 279.4 } as const;
export const DEFAULT_BOARD_CELLS = 15;
export const DEFAULT_GRID_PITCH_MM = 20;
export const SCENE_PX_PER_MM = 2;
export const SCENE_VIEW = { width: 900, height: 680 } as const;

export const defaultPhysicalKit = (): PhysicalKitSettings => ({
    profileKey: 'letter-15x15-2cm',
    gridPitchMm: DEFAULT_GRID_PITCH_MM,
    sheetWidthMm: LETTER_SHEET.widthMm,
    sheetHeightMm: LETTER_SHEET.heightMm,
    boardCells: DEFAULT_BOARD_CELLS,
    holeDiameterMm: 4,
    exportMode: 'both',
    defaultExportFormat: 'both',
    cutSheetFileType: 'pdf'
});

export const boardColumnLabel = (col: number) => {
    const safeCol = Math.floor(col);
    if (!Number.isFinite(safeCol) || safeCol < 0) return '?';
    let index = safeCol;
    let label = '';
    do {
        label = String.fromCharCode(65 + (index % 26)) + label;
        index = Math.floor(index / 26) - 1;
    } while (index >= 0);
    return label;
};

export const boardColumnIndex = (label: string) => {
    const cleaned = label.trim().toUpperCase();
    if (!/^[A-Z]+$/.test(cleaned)) return null;
    let index = 0;
    for (const ch of cleaned) index = index * 26 + (ch.charCodeAt(0) - 64);
    return index - 1;
};

export const boardCoordinateLabel = (col: number, row: number) => `${boardColumnLabel(col)}${row + 1}`;

export const parseBoardCoordinateLabel = (coordinate: string | undefined) => {
    const match = /^([A-Z]+)([1-9]\d*)$/i.exec((coordinate ?? '').trim());
    if (!match) return null;
    const col = boardColumnIndex(match[1]);
    const row = Number(match[2]) - 1;
    if (col === null || !Number.isFinite(row) || row < 0) return null;
    return { col, row, label: `${boardColumnLabel(col)}${row + 1}` };
};

export const isBoardCoordinateInKit = (coordinate: string | undefined, kit: PhysicalKitSettings) => {
    const parsed = parseBoardCoordinateLabel(coordinate);
    return Boolean(parsed && parsed.col >= 0 && parsed.row >= 0 && parsed.col < kit.boardCells && parsed.row < kit.boardCells);
};

export const physicalKitPreset = (profileKey: string, current = defaultPhysicalKit()): PhysicalKitSettings => {
    const base = { ...current, profileKey };
    if (profileKey === 'letter-12x12-2cm') return { ...base, gridPitchMm: 20, sheetWidthMm: LETTER_SHEET.widthMm, sheetHeightMm: LETTER_SHEET.heightMm, boardCells: 12, holeDiameterMm: 4 };
    if (profileKey === 'letter-15x15-2cm') return { ...base, gridPitchMm: 20, sheetWidthMm: LETTER_SHEET.widthMm, sheetHeightMm: LETTER_SHEET.heightMm, boardCells: 15, holeDiameterMm: 4 };
    return base;
};

export const sceneToSheetMm = (p: Point, kit: PhysicalKitSettings): Point => ({
    x: kit.sheetWidthMm / 2 + p.x / SCENE_PX_PER_MM,
    y: kit.sheetHeightMm / 2 - p.y / SCENE_PX_PER_MM
});

export const sheetMmToScene = (p: Point, kit: PhysicalKitSettings): Point => ({
    x: (p.x - kit.sheetWidthMm / 2) * SCENE_PX_PER_MM,
    y: (kit.sheetHeightMm / 2 - p.y) * SCENE_PX_PER_MM
});

export const sceneToBoardRaw = (p: Point, kit: PhysicalKitSettings) => {
    const xMm = p.x / SCENE_PX_PER_MM;
    const yMm = p.y / SCENE_PX_PER_MM;
    const center = Math.floor(kit.boardCells / 2);
    const col = Math.round(xMm / kit.gridPitchMm) + center;
    const row = center - Math.round(yMm / kit.gridPitchMm);
    const valid = col >= 0 && row >= 0 && col < kit.boardCells && row < kit.boardCells;
    const label = valid ? boardCoordinateLabel(col, row) : `off-board(${col},${row})`;
    return { col, row, label, xMm, yMm, valid };
};

export const sceneToBoard = (p: Point, kit: PhysicalKitSettings) => {
    const raw = sceneToBoardRaw(p, kit);
    const col = Math.max(0, Math.min(kit.boardCells - 1, raw.col));
    const row = Math.max(0, Math.min(kit.boardCells - 1, raw.row));
    const label = boardCoordinateLabel(col, row);
    return { ...raw, col, row, label };
};

export const boardToScene = (col: number, row: number, kit: PhysicalKitSettings): Point => {
    const center = Math.floor(kit.boardCells / 2);
    return {
        x: (col - center) * kit.gridPitchMm * SCENE_PX_PER_MM,
        y: (center - row) * kit.gridPitchMm * SCENE_PX_PER_MM
    };
};

export const sceneBoundsForBoard = (kit: PhysicalKitSettings): Bounds => {
    const first = boardToScene(0, 0, kit);
    const last = boardToScene(kit.boardCells - 1, kit.boardCells - 1, kit);
    const edge = (kit.gridPitchMm * SCENE_PX_PER_MM) / 2;
    const minX = Math.min(first.x, last.x) - edge;
    const maxX = Math.max(first.x, last.x) + edge;
    const minY = Math.min(first.y, last.y) - edge;
    const maxY = Math.max(first.y, last.y) + edge;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const boardGridLines = (kit: PhysicalKitSettings) => {
    const lines: Array<{ key: string; a: Point; b: Point }> = [];
    for (let col = 0; col < kit.boardCells; col++) {
        lines.push({ key: `board-x-${col}`, a: boardToScene(col, 0, kit), b: boardToScene(col, kit.boardCells - 1, kit) });
    }
    for (let row = 0; row < kit.boardCells; row++) {
        lines.push({ key: `board-y-${row}`, a: boardToScene(0, row, kit), b: boardToScene(kit.boardCells - 1, row, kit) });
    }
    return lines;
};

export const sceneToSvg = (p: Point): Point => ({
    x: SCENE_VIEW.width / 2 + p.x,
    y: SCENE_VIEW.height / 2 - p.y
});

export const svgToScene = (p: Point): Point => ({
    x: p.x - SCENE_VIEW.width / 2,
    y: SCENE_VIEW.height / 2 - p.y
});

export const boundsToSvg = (b: Bounds, transform = { x: 0, y: 0, rotation: 0, scale: 1 }) => {
    const topLeft = sceneToSvg({ x: transform.x + b.x * transform.scale, y: transform.y + (b.y + b.height) * transform.scale });
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: b.width * transform.scale,
        height: b.height * transform.scale
    };
};

export const sceneBoundsForSheet = (kit: PhysicalKitSettings): Bounds => ({
    x: -kit.sheetWidthMm * SCENE_PX_PER_MM / 2,
    y: -kit.sheetHeightMm * SCENE_PX_PER_MM / 2,
    width: kit.sheetWidthMm * SCENE_PX_PER_MM,
    height: kit.sheetHeightMm * SCENE_PX_PER_MM
});

export const pathFromPoints = (points: Point[], close = false, smoothness = 0): string => {
    if (!points.length) return '';
    const [first, ...rest] = points.map(sceneToSvg);
    if (smoothness <= 0 || rest.length < 2) return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest.map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')}${close ? ' Z' : ''}`;
    const pts = [first, ...rest];
    const corner = Math.min(0.5, Math.max(0, smoothness / 200));
    const segments = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const next = pts[i + 1];
        const before = { x: curr.x + (prev.x - curr.x) * corner, y: curr.y + (prev.y - curr.y) * corner };
        const after = { x: curr.x + (next.x - curr.x) * corner, y: curr.y + (next.y - curr.y) * corner };
        segments.push(`L ${before.x.toFixed(2)} ${before.y.toFixed(2)} Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${after.x.toFixed(2)} ${after.y.toFixed(2)}`);
    }
    const last = pts.at(-1)!;
    segments.push(`L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`);
    return `${segments.join(' ')}${close ? ' Z' : ''}`;
};

export const svgPointerToScene = (svg: SVGSVGElement, clientX: number, clientY: number): Point => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPoint = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return svgToScene(svgPoint);
};

export const bodyPartPivotScene = (part: BodyPartLayer, skeleton?: StandardSkeleton | null): Point => {
    const anchor = skeleton?.joints[part.anchorJointId]?.position;
    const hasMatchingLocalPivot = part.localPivotOffset && (!skeleton || !part.localPivotJointId || part.localPivotJointId === part.anchorJointId);
    const pivot = hasMatchingLocalPivot ? part.localPivotOffset! : (anchor
        ? localPivotOffsetForScene(part, anchor)
        : { x: 0, y: 0 });
    const angle = (part.transform.rotation * Math.PI) / 180;
    const x = pivot.x * part.transform.scale;
    const y = pivot.y * part.transform.scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

export const localPivotOffsetForScene = (part: BodyPartLayer, target: Point): Point => {
    const dx = target.x - part.transform.x;
    const dy = target.y - part.transform.y;
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = part.transform.scale || 1;
    return {
        x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale,
        y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale
    };
};

export const placeBodyPartPivotAt = (part: BodyPartLayer, target: Point, skeleton?: StandardSkeleton | null): BodyPartLayer => {
    const anchor = skeleton?.joints[part.anchorJointId]?.position;
    const pivotPart = anchor && part.localPivotJointId !== part.anchorJointId
        ? { ...part, localPivotOffset: localPivotOffsetForScene(part, anchor), localPivotJointId: part.anchorJointId }
        : part;
    const current = bodyPartPivotScene(pivotPart, skeleton);
    return { ...pivotPart, transform: { ...pivotPart.transform, x: pivotPart.transform.x + target.x - current.x, y: pivotPart.transform.y + target.y - current.y } };
};

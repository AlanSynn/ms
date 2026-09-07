import type { BodyPartLayer, Point, ProjectState } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints } from './partGeometry';
import { characterFabricationHoles } from './characterFabricationHoles';

export type CharacterPrintPart = {
    part: BodyPartLayer;
    pageIndex: number;
    sourceCenterMm: Point;
    printCenterMm: Point;
    outlineMm: Point[];
    holeMm: Point[];
};

export type CharacterPrintLayout = {
    parts: CharacterPrintPart[];
    scale: number;
    pageCount: number;
    partPaddingMm: number;
    holeRadiusMm: number;
};

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

const printBoundsForPoints = (points: Point[]) => {
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

export const buildCharacterPrintLayout = (project: ProjectState): CharacterPrintLayout => {
    const kit = project.settings.physicalKit;
    const fabricationHoles = characterFabricationHoles(project);
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const source = parts.map(part => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return null;
        const outlineScene = outline.map(point => transformedPartPoint(part, point));
        const holeScene = (fabricationHoles.get(part.id) ?? [])
            .map(hole => hole.center)
            .map(point => transformedPartPoint(part, point));
        const bounds = printBoundsForPoints(outlineScene);
        return {
            part,
            outlineScene,
            holeScene,
            centerScene: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2
            }
        };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const partPaddingMm = 4;
    if (!source.length) return { parts: [], scale: 1, pageCount: 1, partPaddingMm, holeRadiusMm: kit.holeDiameterMm / 2 };

    const rawItems = source.map(item => {
        const toRawMm = (point: Point) => ({ x: point.x / SCENE_PX_PER_MM, y: -point.y / SCENE_PX_PER_MM });
        const outlineRawMm = item.outlineScene.map(toRawMm);
        const rawBounds = printBoundsForPoints(outlineRawMm);
        return {
            part: item.part,
            centerRawMm: toRawMm(item.centerScene),
            outlineRawMm,
            holeRawMm: item.holeScene.map(toRawMm),
            rawBounds
        };
    });
    const margin = 10;
    const titleBand = 18;
    const footerBand = 10;
    const maxPages = Math.max(1, rawItems.length);
    const pageRight = kit.sheetWidthMm - margin;
    const pageBottom = kit.sheetHeightMm - footerBand;
    const packAtScale = (scale: number): CharacterPrintPart[] | null => {
        let pageIndex = 0;
        let cursorX = margin;
        let cursorY = titleBand;
        let rowHeight = 0;
        const packed: CharacterPrintPart[] = [];
        const newRow = () => {
            cursorX = margin;
            cursorY += rowHeight;
            rowHeight = 0;
        };
        const newPage = () => {
            pageIndex += 1;
            cursorX = margin;
            cursorY = titleBand;
            rowHeight = 0;
        };
        for (const item of rawItems) {
            const itemWidth = item.rawBounds.width * scale + partPaddingMm * 2;
            const itemHeight = item.rawBounds.height * scale + partPaddingMm * 2;
            if (itemWidth > pageRight - margin || itemHeight > pageBottom - titleBand) return null;
            if (cursorX > margin && cursorX + itemWidth > pageRight) newRow();
            if (cursorY + itemHeight > pageBottom) newPage();
            if (pageIndex >= maxPages) return null;
            const origin = {
                x: cursorX + partPaddingMm - item.rawBounds.minX * scale,
                y: cursorY + partPaddingMm - item.rawBounds.minY * scale
            };
            const toPageMm = (point: Point) => ({ x: origin.x + point.x * scale, y: origin.y + point.y * scale });
            const printCenterMm = toPageMm(item.centerRawMm);
            packed.push({
                part: item.part,
                pageIndex,
                sourceCenterMm: printCenterMm,
                printCenterMm,
                outlineMm: item.outlineRawMm.map(toPageMm),
                holeMm: item.holeRawMm.map(toPageMm)
            });
            cursorX += itemWidth;
            rowHeight = Math.max(rowHeight, itemHeight);
        }
        return packed;
    };
    const scale = 1;
    const packed = packAtScale(scale);
    if (!packed) throw new Error('Character part exceeds the printable Letter area at 100% scale.');
    return {
        scale,
        pageCount: Math.max(1, packed.reduce((max, item) => Math.max(max, item.pageIndex + 1), 1)),
        partPaddingMm,
        holeRadiusMm: Math.max(0.5, (kit.holeDiameterMm / 2) * scale),
        parts: packed
    };
};

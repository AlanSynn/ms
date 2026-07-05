import type { BodyPartLayer, Point, ProjectState } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, pointInsideOutline } from './partGeometry';

export type CharacterPrintPart = {
    part: BodyPartLayer;
    sourceCenterMm: Point;
    printCenterMm: Point;
    outlineMm: Point[];
    holeMm: Point[];
};

export type CharacterPrintLayout = {
    parts: CharacterPrintPart[];
    scale: number;
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
    const parts = project.partOrder.map(id => project.parts[id]).filter((part): part is BodyPartLayer => Boolean(part?.visible));
    const source = parts.map(part => {
        const landmarks = partLandmarkLocalPoints(part, project.skeleton);
        const outline = fabricablePartOutlinePoints(part, landmarks);
        if (outline.length < 3) return null;
        const outlineScene = outline.map(point => transformedPartPoint(part, point));
        const holeScene = landmarks
            .filter(point => pointInsideOutline(point, outline, 0.5))
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
    if (!source.length) return { parts: [], scale: 1, holeRadiusMm: kit.holeDiameterMm / 2 };

    const allScene = source.flatMap(item => item.outlineScene);
    const allBounds = printBoundsForPoints(allScene);
    const characterCenter = {
        x: (allBounds.minX + allBounds.maxX) / 2,
        y: (allBounds.minY + allBounds.maxY) / 2
    };
    const explodeScene = 10 * SCENE_PX_PER_MM;
    const rawItems = source.map(item => {
        const dx = item.centerScene.x - characterCenter.x;
        const dy = item.centerScene.y - characterCenter.y;
        const length = Math.hypot(dx, dy) || 1;
        const offset = { x: (dx / length) * explodeScene, y: (dy / length) * explodeScene };
        const toRawMm = (point: Point) => ({ x: (point.x + offset.x) / SCENE_PX_PER_MM, y: -(point.y + offset.y) / SCENE_PX_PER_MM });
        const sourceCenterMm = { x: item.centerScene.x / SCENE_PX_PER_MM, y: -item.centerScene.y / SCENE_PX_PER_MM };
        return {
            part: item.part,
            sourceCenterMm,
            printCenterRawMm: toRawMm(item.centerScene),
            outlineRawMm: item.outlineScene.map(toRawMm),
            holeRawMm: item.holeScene.map(toRawMm)
        };
    });
    const rawBounds = printBoundsForPoints(rawItems.flatMap(item => item.outlineRawMm));
    const margin = 12;
    const titleBand = 18;
    const footerBand = 10;
    const availableWidth = Math.max(1, kit.sheetWidthMm - margin * 2);
    const availableHeight = Math.max(1, kit.sheetHeightMm - titleBand - footerBand);
    const scale = Math.min(1, availableWidth / Math.max(1, rawBounds.width), availableHeight / Math.max(1, rawBounds.height));
    const offset = {
        x: kit.sheetWidthMm / 2 - ((rawBounds.minX + rawBounds.maxX) / 2) * scale,
        y: titleBand + availableHeight / 2 - ((rawBounds.minY + rawBounds.maxY) / 2) * scale
    };
    const toPageMm = (point: Point) => ({ x: offset.x + point.x * scale, y: offset.y + point.y * scale });
    return {
        scale,
        holeRadiusMm: Math.max(0.5, (kit.holeDiameterMm / 2) * scale),
        parts: rawItems.map(item => ({
            part: item.part,
            sourceCenterMm: toPageMm(item.sourceCenterMm),
            printCenterMm: toPageMm(item.printCenterRawMm),
            outlineMm: item.outlineRawMm.map(toPageMm),
            holeMm: item.holeRawMm.map(toPageMm)
        }))
    };
};

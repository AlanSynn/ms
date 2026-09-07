import type { Bounds, Point } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import type { BuildPlanPrintPart } from './fabricationCustomParts';
import { PDF_POINTS_PER_MM } from './simplePdf';
import { ARTWORK_RASTER_LIMITS } from '../runtime/artwork/artworkCompositor';

export const PAINT_PRINT_PPI = 300;
// Two compositor surfaces and one PDF input are used sequentially per part.
// Refuse oversized raster allocations instead of silently lowering print quality.
export const PAINT_PRINT_MAX_PIXELS = ARTWORK_RASTER_LIMITS.pixels;
export const PAINT_PRINT_MAX_EDGE = ARTWORK_RASTER_LIMITS.edge;

export type PdfAffineTransform = Readonly<{
    a: number; b: number; c: number; d: number; e: number; f: number;
}>;

export const transformPdfPoint = (matrix: PdfAffineTransform, point: Point): Point => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

export const buildPartLocalToPdf = (item: BuildPlanPrintPart, pageHeight = 792): PdfAffineTransform => {
    const transform = item.part.localToScene;
    const angle = transform.rotation * Math.PI / 180;
    const factor = item.sceneToPageMm.scale * PDF_POINTS_PER_MM;
    const scale = (transform.scale || 1) * factor;
    return {
        a: Math.cos(angle) * scale,
        b: Math.sin(angle) * scale,
        c: -Math.sin(angle) * scale,
        d: Math.cos(angle) * scale,
        e: (item.sceneToPageMm.x + transform.x * item.sceneToPageMm.scale) * PDF_POINTS_PER_MM,
        f: pageHeight - item.sceneToPageMm.y * PDF_POINTS_PER_MM + transform.y * factor,
    };
};

export const buildPartSceneToLocal = (item: BuildPlanPrintPart, point: Point): Point => {
    const transform = item.part.localToScene;
    const angle = transform.rotation * Math.PI / 180;
    const x = point.x - transform.x;
    const y = point.y - transform.y;
    const scale = transform.scale || 1;
    return { x: (x * Math.cos(angle) + y * Math.sin(angle)) / scale, y: (-x * Math.sin(angle) + y * Math.cos(angle)) / scale };
};

export const buildPartPrintRasterFrame = (item: BuildPlanPrintPart): Bounds => {
    const local = item.part.outline.map(point => buildPartSceneToLocal(item, point));
    const xs = local.map(point => point.x);
    const ys = local.map(point => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

export const buildPartPrintLocalHoles = (item: BuildPlanPrintPart, holeRadiusMm: number) =>
    item.holeMm.map(point => ({
        center: buildPartSceneToLocal(item, {
            x: (point.x - item.sceneToPageMm.x) / item.sceneToPageMm.scale,
            y: -(point.y - item.sceneToPageMm.y) / item.sceneToPageMm.scale,
        }),
        radius: holeRadiusMm / (item.sceneToPageMm.scale * Math.abs(item.part.localToScene.scale)),
    }));

export const buildPartPrintResolution = (item: BuildPlanPrintPart, frame: Bounds) => {
    const density = PAINT_PRINT_PPI / (25.4 * SCENE_PX_PER_MM) * Math.abs(item.part.localToScene.scale || 1);
    const width = Math.ceil(frame.width * density);
    const height = Math.ceil(frame.height * density);
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= PAINT_PRINT_MAX_EDGE) || width * height > PAINT_PRINT_MAX_PIXELS) {
        throw new Error(`${item.part.name}: artwork exceeds the 300 ppi print limit. Reduce the physical size.`);
    }
    return { width, height };
};

import { CanvasViewport } from '../types';

export const MIN_CANVAS_ZOOM = 0.25;
export const MAX_CANVAS_ZOOM = 4;
export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { offset: { x: 0, y: 0 }, zoom: 1 };
export const WEBGL_PIXEL_RATIO_CAP = 1.5;

export const clampCanvasZoom = (zoom: number) => Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom));

export const normalizeCanvasViewport = (value: unknown): CanvasViewport | null => {
    if (!value || typeof value !== 'object') return null;
    const maybe = value as Partial<CanvasViewport>;
    const offset = maybe.offset;
    if (!offset || typeof offset !== 'object') return null;
    const x = Number((offset as { x?: unknown }).x);
    const y = Number((offset as { y?: unknown }).y);
    const zoom = Number(maybe.zoom);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
    return { offset: { x, y }, zoom: clampCanvasZoom(zoom) };
};

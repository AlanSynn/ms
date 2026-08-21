import { CanvasViewport } from '../types';

export const MIN_CANVAS_ZOOM = 0.25;
export const MAX_CANVAS_ZOOM = 4;
export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { offset: { x: 0, y: 0 }, zoom: 1 };

export const clampCanvasZoom = (zoom: number) => Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom));

type CanvasSceneSize = {
    width: number;
    height: number;
};

type CanvasClientRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

export const canvasViewBoxForViewport = (viewport: CanvasViewport, scene: CanvasSceneSize) => {
    const width = scene.width / viewport.zoom;
    const height = scene.height / viewport.zoom;
    return {
        x: (scene.width - width) / 2 - viewport.offset.x / viewport.zoom,
        y: (scene.height - height) / 2 - viewport.offset.y / viewport.zoom,
        width,
        height
    };
};

export const canvasPanOffset = ({
    startOffset,
    startClientX,
    startClientY,
    clientX,
    clientY,
    rect,
    scene
}: {
    startOffset: CanvasViewport['offset'];
    startClientX: number;
    startClientY: number;
    clientX: number;
    clientY: number;
    rect?: Pick<CanvasClientRect, 'width' | 'height'>;
    scene: CanvasSceneSize;
}): CanvasViewport['offset'] => {
    if (!rect || rect.width <= 0 || rect.height <= 0) return startOffset;
    return {
        x: startOffset.x + ((clientX - startClientX) * scene.width) / rect.width,
        y: startOffset.y + ((clientY - startClientY) * scene.height) / rect.height
    };
};

export const zoomCanvasViewportAtPoint = ({
    viewport,
    rect,
    clientX,
    clientY,
    deltaY,
    scene
}: {
    viewport: CanvasViewport;
    rect: CanvasClientRect;
    clientX: number;
    clientY: number;
    deltaY: number;
    scene: CanvasSceneSize;
}): CanvasViewport => {
    const viewBox = canvasViewBoxForViewport(viewport, scene);
    const nextZoom = clampCanvasZoom(viewport.zoom * (1 - deltaY * 0.001));
    const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    const worldX = viewBox.x + fx * viewBox.width;
    const worldY = viewBox.y + fy * viewBox.height;
    const nextWidth = scene.width / nextZoom;
    const nextHeight = scene.height / nextZoom;
    const nextX = worldX - fx * nextWidth;
    const nextY = worldY - fy * nextHeight;
    return {
        zoom: nextZoom,
        offset: {
            x: ((scene.width - nextWidth) / 2 - nextX) * nextZoom,
            y: ((scene.height - nextHeight) / 2 - nextY) * nextZoom
        }
    };
};

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

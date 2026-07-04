import type React from 'react';
import type { CanvasViewport } from '../../types';
import { clampCanvasZoom, DEFAULT_CANVAS_VIEWPORT } from '../../utils/viewport';

export const CanvasZoomToolbar = ({ viewport, setViewport }: { viewport: CanvasViewport; setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>> }) => {
  const zoomBy = (factor: number) => setViewport(prev => ({ ...prev, zoom: clampCanvasZoom(prev.zoom * factor) }));
  const reset = () => setViewport(DEFAULT_CANVAS_VIEWPORT);
  return <div className="canvas-zoom-toolbar" onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
    <span data-testid="canvas-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
    <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
    <button type="button" aria-label="Fit view" onClick={reset}>Fit</button>
  </div>;
};

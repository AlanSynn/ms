/** A weak registry owns no screenshot bytes and follows each pooled canvas lease. */
const currentFrameRenderers = new WeakMap<HTMLCanvasElement, () => void>();

export const registerCanvasCapture = (canvas: HTMLCanvasElement, renderCurrentFrame: () => void) => {
  currentFrameRenderers.set(canvas, renderCurrentFrame);
  return () => {
    if (currentFrameRenderers.get(canvas) === renderCurrentFrame) currentFrameRenderers.delete(canvas);
  };
};

export const renderCanvasForCapture = (canvas: HTMLCanvasElement) => {
  const render = currentFrameRenderers.get(canvas);
  if (render) render();
  // An unregistered WebGL canvas may already have a discarded drawing buffer.
  // Asking for 2D cannot create a new context on an existing WebGL canvas.
  else if (!canvas.getContext('2d')) throw new Error('Scene capture unavailable');
};

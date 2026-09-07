import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

// These are real Canvas 2D pixels, independent of UI event tests. The shared
// compositor is bundled directly, with no mocked image/rendering implementation.
const bundled = await build({
  stdin: { contents: `export * from './utils/artwork'; export * from './runtime/artwork/artworkCompositor'; export * from './runtime/artwork/artworkRaster';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ArtworkTest',
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const art = (window as unknown as { ArtworkTest: typeof import('../utils/artwork') & typeof import('../runtime/artwork/artworkCompositor') & typeof import('../runtime/artwork/artworkRaster') }).ArtworkTest;
    const frame = { x: -50, y: -50, width: 100, height: 100 };
    const resolution = { width: 100, height: 100 };
    const outline = [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }];
    const pixel = (canvas: HTMLCanvasElement | OffscreenCanvas, x: number, y: number) => Array.from((canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data);
    const document = art.appendArtworkOperation(art.createArtworkDocument(frame), {
      id: 'stripe', kind: 'brush', points: [{ x: -30, y: 10 }, { x: 30, y: 10 }], width: 12, color: '#ef4444',
    });
    const erased = art.appendArtworkOperation(document, { id: 'erase-middle', kind: 'erase', points: [{ x: 0, y: 10 }], width: 16 });
    const repainted = art.appendArtworkOperation(erased, { id: 'blue-dot', kind: 'brush', points: [{ x: 0, y: 10 }], width: 4, color: '#2563eb' });
    const compose = (doc: typeof document, points = outline, target = frame, size = resolution) => art.compositeArtwork({
      document: doc, assets: {}, targetFrame: target, clip: { kind: 'contour', points, holes: [{ center: { x: 20, y: 10 }, radius: 3 }] },
      resolution: size, baseColor: '#fde68a',
    });
    const before = compose(document), afterErase = compose(erased), afterRepaint = compose(repainted);
    const replay = {
      stripe: pixel(before, 50, 40),
      erased: pixel(afterErase, 50, 40),
      retained: pixel(afterErase, 25, 40),
      repainted: pixel(afterRepaint, 50, 40),
      erasedRing: pixel(afterRepaint, 55, 40),
      physicalHole: pixel(afterRepaint, 70, 40),
      outside: pixel(afterRepaint, 5, 5),
      substrate: pixel(afterRepaint, 50, 70),
    };
    const shrink = [{ x: -10, y: -40 }, { x: 10, y: -40 }, { x: 10, y: 40 }, { x: -10, y: 40 }];
    const shrunk = compose(document, shrink);
    const expanded = compose(document);
    const widerFrame = compose(document, outline, { x: -100, y: -100, width: 200, height: 200 }, { width: 200, height: 200 });
    const clipping = { hidden: pixel(shrunk, 25, 40), revealed: pixel(expanded, 25, 40), registration: pixel(widerFrame, 75, 90), sourceCount: document.operations.length };

    const sourceImage = documentCreateCanvas();
    function documentCreateCanvas() { return window.document.createElement('canvas'); }
    sourceImage.width = 20; sourceImage.height = 20;
    const sourceContext = sourceImage.getContext('2d')!;
    sourceContext.fillStyle = '#ff0000'; sourceContext.fillRect(0, 0, 20, 10);
    sourceContext.fillStyle = '#00ff00'; sourceContext.fillRect(0, 10, 20, 10);
    const textureUrl = sourceImage.toDataURL();
    const owner = { bounds: frame, fillColor: '#ffffff', textureUrl,
      artwork: art.appendArtworkOperation(art.createArtworkDocument(frame, { sourceImageFrame: frame }), {
        id: 'erase-photo', kind: 'erase', points: [{ x: 0, y: 20 }], width: 8,
      }) };
    const raster = await art.rasterizeOwnerArtwork({ owner, targetFrame: frame, clip: { kind: 'none' }, resolution });
    const imported = { top: pixel(raster, 25, 25), bottom: pixel(raster, 25, 75), erased: pixel(raster, 50, 30) };
    const png = await art.artworkCanvasPng(raster);
    const decoded = await art.loadArtworkImage(png);
    const roundtrip = art.compositeArtwork({ document: art.createArtworkDocument(frame, { sourceImageFrame: frame }),
      assets: { texture: decoded.image }, targetFrame: frame, clip: { kind: 'none' }, resolution });
    const pngRoundtrip = { top: pixel(roundtrip, 25, 25), bottom: pixel(roundtrip, 25, 75) };
    decoded.dispose();
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="10" fill="#112233"/><rect y="10" width="20" height="10" fill="#abcdef"/></svg>');
    const svgLoaded = await art.loadArtworkImage(svg);
    const svgCanvas = art.compositeArtwork({ document: art.createArtworkDocument(frame, { sourceImageFrame: frame }),
      assets: { texture: svgLoaded.image }, targetFrame: frame, clip: { kind: 'none' }, resolution });
    const svgPixels = { top: pixel(svgCanvas, 25, 25), bottom: pixel(svgCanvas, 25, 75) };
    svgLoaded.dispose();

    let shapes = art.createArtworkDocument(frame);
    shapes = art.appendArtworkOperation(shapes, { id: 'square', kind: 'rectangle', from: { x: -30, y: 20 }, to: { x: -10, y: 40 }, color: '#123456' });
    shapes = art.appendArtworkOperation(shapes, { id: 'ellipse', kind: 'ellipse', from: { x: 10, y: -30 }, to: { x: 30, y: -10 }, color: '#654321' });
    shapes = art.appendArtworkOperation(shapes, { id: 'line', kind: 'line', from: { x: -30, y: -30 }, to: { x: -10, y: -30 }, color: '#00ffff', width: 2 });
    const shapeCanvas = compose(shapes);
    const shapePixels = { squareCorner: pixel(shapeCanvas, 21, 11), ellipseMiddle: pixel(shapeCanvas, 70, 70), line: pixel(shapeCanvas, 30, 80), empty: pixel(shapeCanvas, 50, 50) };
    let oversized = false, canceled = false, missingSource = false;
    try { compose(document, outline, frame, { width: 4096, height: 4096 }); } catch { oversized = true; }
    const cancel = new AbortController(); cancel.abort();
    try { await art.loadArtworkImage(textureUrl, cancel.signal); } catch (error) { canceled = error instanceof DOMException && error.name === 'AbortError'; }
    try { art.compositeArtwork({ document: owner.artwork, assets: {}, targetFrame: frame, clip: { kind: 'none' }, resolution }); } catch { missingSource = true; }
    const canvases = [before, afterErase, afterRepaint, shrunk, expanded, widerFrame, raster, roundtrip, svgCanvas, shapeCanvas];
    for (const canvas of canvases) art.disposeArtworkCanvas(canvas);
    return { replay, clipping, imported, pngRoundtrip, svgPixels, shapePixels, oversized, canceled, missingSource,
      disposed: canvases.every(canvas => canvas.width === 0 && canvas.height === 0) };
  });
  assert.deepEqual(result.replay, {
    stripe: [239, 68, 68, 255], erased: [253, 230, 138, 255], retained: [239, 68, 68, 255],
    repainted: [37, 99, 235, 255], erasedRing: [253, 230, 138, 255], physicalHole: [0, 0, 0, 0],
    outside: [0, 0, 0, 0], substrate: [253, 230, 138, 255],
  });
  assert.deepEqual(result.clipping, { hidden: [0, 0, 0, 0], revealed: [239, 68, 68, 255], registration: [239, 68, 68, 255], sourceCount: 1 });
  assert.deepEqual(result.imported, { top: [255, 0, 0, 255], bottom: [0, 255, 0, 255], erased: [255, 255, 255, 255] });
  assert.deepEqual(result.pngRoundtrip, { top: [255, 0, 0, 255], bottom: [0, 255, 0, 255] });
  assert.deepEqual(result.svgPixels, { top: [17, 34, 51, 255], bottom: [171, 205, 239, 255] });
  assert.deepEqual(result.shapePixels, { squareCorner: [18, 52, 86, 255], ellipseMiddle: [101, 67, 33, 255], line: [0, 255, 255, 255], empty: [253, 230, 138, 255] });
  assert(result.oversized && result.canceled && result.missingSource && result.disposed);
  console.log('artwork compositor real pixels, clipping, source orientation, and disposal ok');
} finally {
  await browser.close();
}

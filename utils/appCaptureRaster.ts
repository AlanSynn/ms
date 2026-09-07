import {
  boundedCaptureSize, canvasHasVisibleContent, CAPTURE_FAILURE, CAPTURE_MAX_BYTES, CAPTURE_SCENE_SAMPLE_SIZE,
  type AppCaptureResult, type FrozenAppView,
} from './appCapture';
import { stripPngExif } from './appCapturePng';

const MAX_RESOURCE_BYTES = 5_000_000;
const MAX_RESOURCE_TOTAL = 10_000_000;
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i;
const FONT_DATA = /^data:(font\/[-\w]+|application\/(font-woff|x-font-ttf|octet-stream))[;,]/i;

const blobDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(new Error('Capture asset unavailable'));
  reader.readAsDataURL(blob);
});

/** Only local, bounded assets are inlined. The SVG raster never receives a remote URL. */
const inlineAssets = async (frozen: FrozenAppView) => {
  const cache = new Map<string, Promise<string>>();
  let bytes = 0;
  const resource = (raw: string, font = false) => {
    frozen.signal.throwIfAborted();
    if (raw.startsWith('#')) return Promise.resolve(raw);
    if (raw.startsWith('data:')) {
      if (!(font ? FONT_DATA : IMAGE_DATA).test(raw) || raw.length > MAX_RESOURCE_BYTES * 1.4) throw new Error('Unsupported capture asset');
      return Promise.resolve(raw);
    }
    const url = new URL(raw, frozen.baseUrl);
    const page = new URL(frozen.baseUrl);
    if (url.hash && url.href.split('#')[0] === page.href.split('#')[0]) return Promise.resolve(url.hash);
    if (url.origin !== page.origin || !['https:', 'http:', 'blob:', 'tauri:', 'asset:'].includes(url.protocol)) throw new Error('External capture asset');
    const key = `${font}:${url.href}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      const response = await fetch(url.href, { mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'force-cache', signal: frozen.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESOURCE_BYTES) throw new Error('Capture asset unavailable');
      const blob = await response.blob();
      bytes += blob.size;
      if (blob.size > MAX_RESOURCE_BYTES || bytes > MAX_RESOURCE_TOTAL) throw new Error('Capture assets too large');
      const data = await blobDataUrl(blob);
      frozen.signal.throwIfAborted();
      if (!(font ? FONT_DATA : IMAGE_DATA).test(data)) throw new Error('Unsupported capture asset');
      return data;
    })());
    return cache.get(key)!;
  };
  const css = async (value: string, font = false) => {
    const matches = Array.from(value.matchAll(CSS_URL));
    let result = value;
    for (const match of matches) result = result.replace(match[0], `url("${await resource(match[2], font)}")`);
    return result;
  };
  try {
    const nodes = frozen.root ? [frozen.root, ...Array.from(frozen.root.querySelectorAll('*'))] : [];
    for (const node of nodes) {
      frozen.signal.throwIfAborted();
      if (node instanceof HTMLElement || node instanceof SVGElement) {
        for (const property of Array.from(node.style)) {
          const value = node.style.getPropertyValue(property);
          if (value.includes('url(')) node.style.setProperty(property, await css(value));
        }
      }
      if (node instanceof SVGImageElement) node.setAttribute('href', await resource(node.getAttribute('href') || ''));
      // SVG presentation attributes may contain resource references too.
      for (const { name, value } of Array.from(node.attributes)) {
        if (name !== 'style' && value.includes('url(')) node.setAttribute(name, await css(value));
      }
    }
    frozen.fonts = await Promise.all(frozen.fonts.map(value => css(value, true)));
    frozen.nativeStyles = await Promise.all(frozen.nativeStyles.map(value => css(value)));
  } finally {
    cache.clear();
  }
};

const encodePng = async (canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Blob> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG capture unavailable')), 'image/png');
  });
  signal.throwIfAborted();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  return new Blob([stripPngExif(bytes)], { type: 'image/png' });
};

/** A nonblank header cannot make a dropped or displaced scene successful evidence. */
const verifySceneComposition = (canvas: HTMLCanvasElement, frozen: FrozenAppView) => {
  const sample = canvas.ownerDocument.createElement('canvas');
  const size = CAPTURE_SCENE_SAMPLE_SIZE;
  sample.width = sample.height = size;
  try {
    const context = sample.getContext('2d');
    if (!context) throw new Error('Capture verification unavailable');
    const scaleX = canvas.width / frozen.width, scaleY = canvas.height / frozen.height;
    for (const scene of frozen.scenes) {
      context.clearRect(0, 0, size, size);
      context.drawImage(canvas, (scene.left - frozen.left) * scaleX, (scene.top - frozen.top) * scaleY,
        scene.width * scaleX, scene.height * scaleY, 0, 0, size, size);
      const actual = context.getImageData(0, 0, size, size).data;
      let candidates = 0, matches = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const x = scene.left + ((i / 4) % size + .5) / size * scene.width;
        const y = scene.top + (Math.floor(i / 4 / size) + .5) / size * scene.height;
        if (x < frozen.left || y < frozen.top || x >= frozen.left + frozen.width || y >= frozen.top + frozen.height) continue;
        if (scene.pixels[i + 3] < 240 || Math.min(scene.pixels[i], scene.pixels[i + 1], scene.pixels[i + 2]) >= 220) continue;
        candidates++;
        if ([0, 1, 2].every(channel => Math.abs(actual[i + channel] - scene.pixels[i + channel]) < 23)) matches++;
      }
      // HUDs may cover part of a scene; most visible foreground must still survive.
      if (candidates >= 16 && matches / candidates < .45) throw new Error('Scene composition incomplete');
    }
  } finally { sample.width = sample.height = 0; }
};

/** Heavy work is loaded on demand after freezeAppView has taken the current frame. */
export const rasterizeAppView = async (frozen: FrozenAppView): Promise<AppCaptureResult> => {
  let canvas: HTMLCanvasElement | undefined;
  let image: HTMLImageElement | undefined;
  let wrapper: HTMLDivElement | undefined;
  const abort = () => { image?.removeAttribute('src'); };
  try {
    if (frozen.failure || !frozen.root || frozen.signal.aborted) throw new Error('Capture unavailable');
    frozen.signal.addEventListener('abort', abort, { once: true });
    await inlineAssets(frozen);
    if (!frozen.root) throw new Error('Capture discarded');
    const document = frozen.root.ownerDocument;
    const size = boundedCaptureSize(frozen.width, frozen.height);
    wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = `position:relative;transform:translate(${-frozen.left}px,${-frozen.top}px);width:${frozen.viewportWidth}px;height:${frozen.viewportHeight}px;background:${frozen.background};overflow:hidden;`;
    const fontStyle = document.createElement('style');
    fontStyle.textContent = [...frozen.fonts, ...frozen.nativeStyles].join('\n');
    wrapper.append(fontStyle, frozen.root);
    const contents = new XMLSerializer().serializeToString(wrapper);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${frozen.width} ${frozen.height}"><foreignObject x="0" y="0" width="${frozen.viewportWidth}" height="${frozen.viewportHeight}">${contents}</foreignObject></svg>`;
    image = document.createElement('img');
    // A self-contained SVG data URL avoids the foreignObject/blob origin taint in WebKit.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    frozen.signal.throwIfAborted();
    canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Capture unavailable');
    const paint = () => {
      context.clearRect(0, 0, canvas!.width, canvas!.height);
      context.drawImage(image!, 0, 0, canvas!.width, canvas!.height);
    };
    paint();
    const sample = document.createElement('canvas');
    try {
      sample.width = sample.height = 48;
      const sampleContext = sample.getContext('2d');
      if (!sampleContext) throw new Error('Capture unavailable');
      sampleContext.drawImage(canvas, 0, 0, 48, 48);
      if (!canvasHasVisibleContent(sampleContext.getImageData(0, 0, 48, 48).data)) throw new Error('Capture incomplete');
    } finally { sample.width = sample.height = 0; }
    verifySceneComposition(canvas, frozen);
    let blob = await encodePng(canvas, frozen.signal);
    frozen.signal.throwIfAborted();
    while (blob.size > CAPTURE_MAX_BYTES) {
      const ratio = Math.min(.85, Math.sqrt(CAPTURE_MAX_BYTES / blob.size) * .92);
      const width = Math.floor(canvas.width * ratio);
      const height = Math.floor(canvas.height * ratio);
      if (width < size.width * .5 || height < size.height * .5) throw new Error('Readable screenshot too large');
      canvas.width = width;
      canvas.height = height;
      paint();
      blob = await encodePng(canvas, frozen.signal);
      frozen.signal.throwIfAborted();
    }
    return { status: 'ready', blob, width: canvas.width, height: canvas.height };
  } catch {
    return { status: 'failed', reason: CAPTURE_FAILURE };
  } finally {
    frozen.signal.removeEventListener('abort', abort);
    image?.removeAttribute('src');
    if (canvas) canvas.width = canvas.height = 0;
    wrapper?.replaceChildren();
    frozen.dispose();
  }
};

import { renderCanvasForCapture } from './canvasCapture';

export const CAPTURE_MAX_SIDE = 1600;
export const CAPTURE_MAX_PIXELS = 2_000_000;
export const CAPTURE_MAX_BYTES = 1_500_000;
export const CAPTURE_FAILURE = 'Screenshot unavailable. Send without it.';

export type CaptureSceneSample = {
  left: number; top: number; width: number; height: number;
  pixels: Uint8ClampedArray;
};
export const CAPTURE_SCENE_SAMPLE_SIZE = 96;

export type FrozenAppView = {
  root: HTMLElement | null;
  width: number;
  height: number;
  left: number;
  top: number;
  viewportWidth: number;
  viewportHeight: number;
  background: string;
  baseUrl: string;
  fonts: string[];
  nativeStyles: string[];
  signal: AbortSignal;
  scenes: CaptureSceneSample[];
  failure: string | null;
  dispose: () => void;
};

export type AppCaptureResult =
  | { status: 'ready'; blob: Blob; width: number; height: number }
  | { status: 'failed'; reason: string };

export const boundedCaptureSize = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Empty capture area');
  }
  const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(width, height), Math.sqrt(CAPTURE_MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
};

type Bounds = { left: number; top: number; right: number; bottom: number };
const intersection = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
});
const intersects = (a: Bounds, b: Bounds) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
const isClipped = (value: string) => /^(hidden|clip|scroll|auto)$/.test(value);
const isStyleElement = (value: Element): value is HTMLElement | SVGElement => 'style' in value;

const copyStyle = (source: CSSStyleDeclaration, target: CSSStyleDeclaration) => {
  target.cssText = '';
  for (const property of Array.from(source)) {
    if (property.startsWith('--')) continue;
    target.setProperty(property, source.getPropertyValue(property));
  }
  target.setProperty('animation', 'none', 'important');
  target.setProperty('transition', 'none', 'important');
  target.setProperty('caret-color', 'transparent');
  // Chromium 149/150 clips unrelated foreignObject content at blur bounds.
  // Keep the frozen fills and content; omit decorative backdrop blur in the copy.
  target.setProperty('backdrop-filter', 'none');
  target.setProperty('-webkit-backdrop-filter', 'none');
};

/** Sample the copied image, never the live canvas. Blank or black evidence fails closed. */
export const canvasHasVisibleContent = (pixels: Uint8ClampedArray) => {
  let first = -1;
  let variation = false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    if (first < 0) first = color;
    else if (color !== first) variation = true;
  }
  return variation;
};

const freezePixels = (source: CanvasImageSource, width: number, height: number, scene: boolean, document: Document, scenes: CaptureSceneSample[]) => {
  const size = boundedCaptureSize(width, height);
  const copy = document.createElement('canvas');
  const sample = document.createElement('canvas');
  try {
    copy.width = size.width;
    copy.height = size.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('Image capture unavailable');
    context.drawImage(source, 0, 0, size.width, size.height);
    if (scene) {
      sample.width = sample.height = CAPTURE_SCENE_SAMPLE_SIZE;
      const sampleContext = sample.getContext('2d');
      if (!sampleContext) throw new Error('Scene capture unavailable');
      sampleContext.drawImage(copy, 0, 0, sample.width, sample.height);
      const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
      if (!canvasHasVisibleContent(pixels)) throw new Error('Scene capture incomplete');
      const { left, top, width, height } = (source as HTMLCanvasElement).getBoundingClientRect();
      scenes.push({ left, top, width, height, pixels });
    }
    // toDataURL throws for tainted images, including local scene assets with remote content.
    return copy.toDataURL('image/png');
  } finally {
    copy.width = copy.height = sample.width = sample.height = 0;
  }
};

const removePrivateAttributes = (clone: Element) => {
  for (const { name, value } of Array.from(clone.attributes)) {
    if (/^(on|data-|aria-)/i.test(name) || /^(title|name|form|action|autofocus|src|srcset|poster|value)$/i.test(name)
      || (/^(href|xlink:href)$/i.test(name) && !value.startsWith('#'))) clone.removeAttribute(name);
  }
};

const freezeFonts = (document: Document, families: Set<string>, app: HTMLElement, nativeStyles: string[]) => {
  const fonts: string[] = [];
  const visit = (rules: CSSRuleList, base: string) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const face = rule as CSSFontFaceRule;
        const family = face.style.fontFamily.replace(/["']/g, '').toLowerCase();
        if (![...families].some(value => value.includes(family))) continue;
        if (!document.fonts.check(`${face.style.fontWeight || 'normal'} 16px "${family}"`)) continue;
        fonts.push(face.cssText.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (_, _quote, url: string) => `url("${new URL(url, base).href}")`));
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const styleRule = rule as CSSStyleRule;
        if (!/::(-webkit-slider|-moz-range|marker)/.test(styleRule.selectorText)) continue;
        const selector = styleRule.selectorText.replace(/::[-\w]+/g, '');
        if (app.querySelector(selector)) nativeStyles.push(styleRule.cssText);
      } else if ('cssRules' in rule) {
        if (rule.type === CSSRule.MEDIA_RULE && !document.defaultView!.matchMedia((rule as CSSMediaRule).conditionText).matches) continue;
        visit((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    // Cross-origin styles cannot be safely re-fetched during a local capture.
    visit(sheet.cssRules, sheet.href || document.baseURI);
  }
  return fonts;
};

/** Must run before opening Feedback and before any await/lazy import. No network or project reads. */
export const freezeAppView = (app: HTMLElement): FrozenAppView => {
  const document = app.ownerDocument;
  const view = document.defaultView!;
  const area = intersection(app.getBoundingClientRect(), { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight });
  const controller = new AbortController();
  const frozen: FrozenAppView = {
    root: null, width: area.right - area.left, height: area.bottom - area.top,
    left: area.left, top: area.top, viewportWidth: view.innerWidth, viewportHeight: view.innerHeight,
    background: view.getComputedStyle(document.body).backgroundColor, baseUrl: document.baseURI,
    fonts: [], nativeStyles: [], signal: controller.signal, scenes: [], failure: null,
    dispose: () => {
      controller.abort();
      frozen.root?.replaceChildren();
      frozen.root = null;
      frozen.fonts.length = 0;
      frozen.nativeStyles.length = 0;
      frozen.scenes.length = 0;
    },
  };
  const families = new Set<string>();
  const cloneElement = (source: Element, clip: Bounds, inSvg = false): Element | null => {
    if (source.matches('[data-capture-exclude], [hidden], script, style, link, template, noscript')) return null;
    const style = view.getComputedStyle(source);
    if (style.display === 'none' || style.contentVisibility === 'hidden') return null;
    const rect = source.getBoundingClientRect();
    const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) !== 0;
    const outside = !intersects(rect, clip);
    const clone = (source instanceof HTMLImageElement || source instanceof HTMLVideoElement
      ? document.createElement(source.tagName) : source.cloneNode(false)) as HTMLElement | SVGElement;
    removePrivateAttributes(clone);
    if (!isStyleElement(clone)) return null;
    copyStyle(style, clone.style);
    // Overlay scrollbars have no occupied width in the real view. SVG image mode
    // otherwise invents permanently visible native bars and changes pane content.
    if (source instanceof HTMLElement) {
      if (source.offsetWidth - source.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) < 1 && isClipped(style.overflowY)) clone.style.overflowY = 'hidden';
      if (source.offsetHeight - source.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth) < 1 && isClipped(style.overflowX)) clone.style.overflowX = 'hidden';
    }
    // Keep layout boxes for clipped content but never copy its text or asset bytes.
    if (!visible || (outside && !inSvg && (isClipped(style.overflowX) || isClipped(style.overflowY) || source.childElementCount === 0))) {
      clone.style.visibility = 'hidden';
      if (rect.width && rect.height) {
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
      }
      return clone;
    }
    families.add(style.fontFamily.toLowerCase());
    const masked = source.hasAttribute('data-capture-mask') || (source instanceof HTMLInputElement && source.type === 'password');
    if (masked) {
      clone.style.backgroundImage = 'none';
      if (clone instanceof HTMLInputElement) clone.setAttribute('value', '••••••');
      else clone.textContent = '••••••';
      return clone;
    }
    if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement || source instanceof HTMLVideoElement) {
      const image = document.createElement('img');
      copyStyle(style, image.style);
      let width: number, height: number;
      if (source instanceof HTMLCanvasElement) {
        renderCanvasForCapture(source);
        width = source.width; height = source.height;
      } else if (source instanceof HTMLImageElement) {
        if (!source.complete || !source.naturalWidth) throw new Error('Image not ready');
        width = source.naturalWidth; height = source.naturalHeight;
      } else {
        if (source.readyState < 2) throw new Error('Video not ready');
        width = source.videoWidth; height = source.videoHeight;
      }
      image.src = freezePixels(source, width, height, source instanceof HTMLCanvasElement, document, frozen.scenes);
      image.width = source instanceof HTMLCanvasElement ? source.width : width;
      image.height = source instanceof HTMLCanvasElement ? source.height : height;
      return image;
    }
    if (source.matches('iframe, object, embed')) throw new Error('Embedded view cannot be captured');
    if (source instanceof HTMLInputElement) {
      clone.setAttribute('value', source.value);
      if (source.checked) clone.setAttribute('checked', ''); else clone.removeAttribute('checked');
    }
    if (source instanceof HTMLTextAreaElement) { clone.textContent = source.value; return clone; }
    if (source instanceof HTMLSelectElement) {
      // Copy only the shown option; offscreen choices are not part of the screenshot.
      const option = document.createElement('option');
      option.textContent = source.selectedOptions[0]?.textContent || '';
      option.setAttribute('selected', '');
      clone.append(option);
      return clone;
    }
    if (source instanceof SVGImageElement) clone.setAttribute('href', source.href.baseVal);
    const childClip = intersection(clip, {
      left: isClipped(style.overflowX) ? rect.left : clip.left,
      right: isClipped(style.overflowX) ? rect.right : clip.right,
      top: isClipped(style.overflowY) ? rect.top : clip.top,
      bottom: isClipped(style.overflowY) ? rect.bottom : clip.bottom,
    });
    const pseudo = (kind: '::before' | '::after') => {
      if (inSvg) return;
      const css = view.getComputedStyle(source, kind);
      if (!css.content || css.content === 'none' || css.content === 'normal' || css.display === 'none') return;
      const span = document.createElement('span');
      copyStyle(css, span.style);
      span.textContent = css.content.replace(/^["']|["']$/g, '');
      clone.append(span);
    };
    pseudo('::before');
    for (const child of Array.from(source.childNodes)) {
      if (child instanceof Element) {
        const copied = cloneElement(child, childClip, inSvg || source instanceof SVGElement);
        if (copied) clone.append(copied);
      } else if (child.nodeType === Node.TEXT_NODE && !outside) clone.append(child.cloneNode());
    }
    pseudo('::after');
    if (source.scrollTop || source.scrollLeft) {
      const inner = document.createElement('div');
      for (const property of ['display', 'gap', 'flex-direction', 'flex-wrap', 'align-items', 'align-content', 'justify-content', 'grid-template-columns', 'grid-template-rows']) {
        inner.style.setProperty(property, style.getPropertyValue(property));
      }
      inner.style.width = `${source.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`;
      inner.style.transform = `translate(${-source.scrollLeft}px, ${-source.scrollTop}px)`;
      inner.append(...Array.from(clone.childNodes));
      clone.style.display = 'block';
      clone.style.overflow = 'hidden';
      clone.append(inner);
    }
    return clone;
  };
  try {
    boundedCaptureSize(frozen.width, frozen.height);
    if (!app.isConnected) throw new Error('View unavailable');
    const root = cloneElement(app, area) as HTMLElement | null;
    if (!root) throw new Error('View hidden');
    const rect = app.getBoundingClientRect();
    root.style.position = 'absolute';
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.margin = '0';
    const rootStyle = view.getComputedStyle(app);
    for (const property of Array.from(rootStyle)) {
      if (property.startsWith('--')) root.style.setProperty(property, rootStyle.getPropertyValue(property));
    }
    frozen.root = root;
    frozen.fonts = freezeFonts(document, families, app, frozen.nativeStyles);
  } catch {
    frozen.dispose();
    frozen.failure = CAPTURE_FAILURE;
  }
  return frozen;
};

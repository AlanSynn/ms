import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { validateScreenshotPng } from '../../workers/feedback/png';

const captureScript = build({
  stdin: { contents: `import {freezeAppView} from './utils/appCapture';
    import {rasterizeAppView} from './utils/appCaptureRaster';
    import {registerCanvasCapture} from './utils/canvasCapture';
    window.captureHarness = {freezeAppView, rasterizeAppView, registerCanvasCapture};`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
}).then(result => result.outputFiles[0].text);

const fixture = async (page: Page, body: string) => {
  await page.route('**/__capture_fixture', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html><head><style>body{margin:0;background:rgb(1,2,3)}*{box-sizing:border-box}</style></head><body>${body}</body></html>`,
  }));
  await page.goto('/__capture_fixture');
  await page.addScriptTag({ content: await captureScript });
};

type Harness = {
  freezeAppView: typeof import('../../utils/appCapture').freezeAppView;
  rasterizeAppView: typeof import('../../utils/appCaptureRaster').rasterizeAppView;
  registerCanvasCapture: typeof import('../../utils/canvasCapture').registerCanvasCapture;
};
declare global { interface Window { captureHarness: Harness } }

test('capture freezes DOM, SVG, current WebGL, clipped panes and warnings before async encoding', async ({ page }, testInfo) => {
  await fixture(page, `<div>Outside the app</div><div id="app" style="position:absolute;left:20px;top:30px;width:400px;height:300px;overflow:hidden;background:white">
    <div style="position:absolute;left:0;top:0;width:5px;height:300px;backdrop-filter:blur(18px);background:rgba(255,255,255,.9)"></div>
    <div style="position:absolute;left:10px;top:10px;width:40px;height:40px;background:rgb(220,20,20)"></div>
    <svg style="position:absolute;left:60px;top:10px;width:60px;height:60px" viewBox="0 0 60 60"><path d="M0 0H60V60H0Z" fill="#fed000"/><circle cx="30" cy="30" r="10" fill="#102030"/></svg>
    <canvas id="scene" width="80" height="60" style="position:absolute;left:130px;top:10px;width:80px;height:60px"></canvas>
    <input id="title" data-capture-mask value="SECRET PROJECT" style="position:absolute;left:220px;top:10px;width:160px;height:35px">
    <select id="choice" style="position:absolute;left:220px;top:50px;width:150px;height:30px"><option>Old option</option><option selected>Current option</option></select>
    <div id="scroll" style="position:absolute;left:10px;top:100px;width:100px;height:40px;overflow:auto"><div style="height:40px;background:red">CLIPPED SECRET</div><div style="height:40px;background:rgb(20,210,40)">Visible</div><div style="height:40px;background:blue">OFFSCREEN SECRET</div></div>
    <div id="warning" style="position:absolute;left:10px;top:200px;width:150px;height:40px;background:rgb(255,130,0)">Fix: synthetic warning</div>
    <div hidden>HIDDEN SECRET</div><div data-capture-exclude>Feedback excluded</div>
  </div>`);
  const data = await page.evaluate(async () => {
    const { freezeAppView, rasterizeAppView, registerCanvasCapture } = window.captureHarness;
    const app = document.getElementById('app')!;
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false })!;
    let renders = 0;
    const camera = { x: 7, y: 11 };
    const render = () => {
      renders++;
      gl.disable(gl.SCISSOR_TEST); gl.clearColor(.1, .2, .9, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(camera.x, camera.y, 30, 25); gl.clearColor(.1, .8, .3, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    };
    render();
    const release = registerCanvasCapture(canvas, render);
    document.getElementById('scroll')!.scrollTop = 40;
    const frozen = freezeAppView(app);
    const cloned = frozen.root?.outerHTML || '';
    const before = { renders, camera: { ...camera }, liveTitle: (document.getElementById('title') as HTMLInputElement).value };
    document.getElementById('warning')!.remove();
    // A new panel and scene change after freeze cannot enter the snapshot.
    app.append(Object.assign(document.createElement('div'), { textContent: 'LATE FEEDBACK PANEL' }));
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    await Promise.resolve();
    const result = await rasterizeAppView(frozen);
    release();
    if (result.status !== 'ready') return { status: result.status, reason: result.reason, before, cloned };
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const image = await createImageBitmap(result.blob);
    const output = document.createElement('canvas'); output.width = result.width; output.height = result.height;
    const ctx = output.getContext('2d')!; ctx.drawImage(image, 0, 0); image.close();
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      status: result.status, before, width: result.width, height: result.height, size: result.blob.size,
      titleMasked: !cloned.includes('SECRET PROJECT'), hiddenExcluded: !cloned.includes('HIDDEN SECRET'),
      clippedExcluded: !cloned.includes('OFFSCREEN SECRET'), panelExcluded: !cloned.includes('Feedback excluded'),
      selectedOption: cloned.includes('Current option') && !cloned.includes('Old option'), disposed: frozen.root === null,
      pixels: [pixel(20, 20), pixel(70, 20), pixel(90, 40), pixel(135, 15), pixel(155, 45), pixel(80, 125), pixel(20, 225)],
      png: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')),
    };
  });
  expect(data.status, 'native DOM and current-frame WebGL must produce actual PNG evidence').toBe('ready');
  if (data.status !== 'ready' || !('pixels' in data)) return;
  await testInfo.attach('app-generated-capture', { body: Buffer.from(data.png!, 'base64'), contentType: 'image/png' });
  expect(data.before).toEqual({ renders: 2, camera: { x: 7, y: 11 }, liveTitle: 'SECRET PROJECT' });
  expect([data.width, data.height]).toEqual([400, 300]);
  expect(data.size).toBeLessThanOrEqual(1_500_000);
  for (const key of ['titleMasked', 'hiddenExcluded', 'clippedExcluded', 'panelExcluded', 'selectedOption', 'disposed'] as const) expect(data[key], key).toBe(true);
  const expectedPixels = [
    [220, 20, 20, 255], [254, 208, 0, 255], [16, 32, 48, 255], [26, 51, 230, 255],
    [26, 204, 76, 255], [20, 210, 40, 255], [255, 130, 0, 255],
  ];
  data.pixels.forEach((pixel, index) => pixel.forEach((channel, component) => {
    // GPU UNORM conversion may round a half-channel value up or down.
    expect(Math.abs(channel - expectedPixels[index][component])).toBeLessThanOrEqual(index === 3 || index === 4 ? 1 : 0);
  }));
});

test('blank, unregistered WebGL and tainted assets fail explicitly without asset requests', async ({ page }) => {
  await fixture(page, '<div id="app" style="width:300px;height:200px;background:white"><canvas id="scene" width="80" height="80"></canvas></div>');
  const failures = await page.evaluate(async () => {
    const api = window.captureHarness;
    const app = document.getElementById('app')!;
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    const unregistered = await api.rasterizeAppView(api.freezeAppView(app));
    const release = api.registerCanvasCapture(canvas, () => { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
    const black = await api.rasterizeAppView(api.freezeAppView(app));
    release();
    canvas.remove();
    const failImage = document.createElement('canvas'); failImage.width = 40; failImage.height = 40;
    const context = failImage.getContext('2d')!; context.fillStyle = 'red'; context.fillRect(0, 0, 40, 20);
    app.append(failImage);
    const native = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Tainted', 'SecurityError'); };
    const tainted = api.freezeAppView(app);
    HTMLCanvasElement.prototype.toDataURL = native;
    const result = await api.rasterizeAppView(tainted);
    return [unregistered.status, black.status, result.status, tainted.root];
  });
  expect(failures).toEqual(['failed', 'failed', 'failed', null]);
});

test('capture refuses a remote CSS resource and explicit discard releases frozen content', async ({ page }) => {
  await fixture(page, '<div id="app" style="width:300px;height:200px;background:white"><div id="asset" style="width:40px;height:40px;background:red"></div></div>');
  const result = await page.evaluate(async () => {
    const api = window.captureHarness;
    const frozen = api.freezeAppView(document.getElementById('app')!);
    frozen.root!.querySelector<HTMLElement>('#asset')!.style.backgroundImage = 'url("https://outside.invalid/image.png")';
    let fetches = 0;
    const native = window.fetch;
    window.fetch = () => { fetches++; return Promise.reject(new Error('External request')); };
    const capture = await api.rasterizeAppView(frozen);
    window.fetch = native;
    const discard = api.freezeAppView(document.getElementById('app')!);
    discard.dispose();
    const afterDiscard = await api.rasterizeAppView(discard);
    return { capture: capture.status, fetches, released: frozen.root === null && discard.root === null, afterDiscard: afterDiscard.status };
  });
  expect(result).toEqual({ capture: 'failed', fetches: 0, released: true, afterDiscard: 'failed' });
});

test('a real cross-origin tainted image fails without another image request', async ({ page }) => {
  await fixture(page, '<div id="app" style="width:300px;height:200px;background:white"></div>');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 20, 20);
    return canvas.toDataURL().split(',')[1];
  });
  let imageRequests = 0;
  await page.route('https://capture-asset.invalid/image.png', route => {
    imageRequests++;
    return route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  const capture = await page.evaluate(async () => {
    const app = document.getElementById('app')!;
    const image = document.createElement('img'); image.src = 'https://capture-asset.invalid/image.png';
    app.append(image); await image.decode();
    return window.captureHarness.rasterizeAppView(window.captureHarness.freezeAppView(app));
  });
  expect(capture.status).toBe('failed');
  expect(imageRequests).toBe(1);
});

test('discard aborts an in-flight local capture asset and releases the snapshot', async ({ page }) => {
  await fixture(page, '<div id="app" style="width:300px;height:200px;background:white"><div id="asset">Visible</div></div>');
  const result = await page.evaluate(async () => {
    const api = window.captureHarness;
    const frozen = api.freezeAppView(document.getElementById('app')!);
    frozen.root!.querySelector<HTMLElement>('#asset')!.style.backgroundImage = 'url("/capture-delayed.png")';
    let started!: () => void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    let aborted = false;
    const native = window.fetch;
    window.fetch = (_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
      started();
    });
    const pending = api.rasterizeAppView(frozen);
    await fetching; frozen.dispose();
    const capture = await pending;
    window.fetch = native;
    return { status: capture.status, aborted, released: frozen.root === null, signal: frozen.signal.aborted };
  });
  expect(result).toEqual({ status: 'failed', aborted: true, released: true, signal: true });
});

test('a nonblank header does not hide a missing scene in the encoded image', async ({ page }) => {
  await fixture(page, '<div id="app" style="width:300px;height:200px;background:white"><strong>Visible header</strong><canvas width="160" height="140" style="display:block"></canvas></div>');
  const status = await page.evaluate(async () => {
    const app = document.getElementById('app')!;
    const canvas = app.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(80,120,230)'; ctx.fillRect(0, 0, 160, 140);
    ctx.fillStyle = 'rgb(180,50,10)'; ctx.fillRect(15, 20, 60, 60);
    const frozen = window.captureHarness.freezeAppView(app);
    frozen.root!.querySelector('img')!.remove();
    return (await window.captureHarness.rasterizeAppView(frozen)).status;
  });
  expect(status).toBe('failed');
});

test('large views respect PNG limits or report an unsupported native raster', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 2400, height: 1400 });
  await fixture(page, '<div id="app" style="width:2400px;height:1400px;background:white"><canvas width="2400" height="1400" style="width:2400px;height:1400px"></canvas></div>');
  const result = await page.evaluate(async () => {
    const app = document.getElementById('app')!;
    const canvas = app.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    const captureInfo = async () => {
      const frozen = window.captureHarness.freezeAppView(app);
      const capture = await window.captureHarness.rasterizeAppView(frozen);
      return capture.status === 'ready'
        ? { status: capture.status, width: capture.width, height: capture.height, bytes: capture.blob.size, reason: null, released: frozen.root === null }
        : { ...capture, width: 0, height: 0, bytes: 0, released: frozen.root === null };
    };
    context.fillStyle = 'white'; context.fillRect(0, 0, 2400, 1400);
    context.fillStyle = 'rgb(40,110,220)'; context.fillRect(40, 40, 1000, 900);
    context.fillStyle = 'rgb(230,80,20)'; context.fillRect(1300, 600, 1000, 600);
    const structured = await captureInfo();
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      pixels.data[i] = i % 4 === 3 || Math.floor(i / 4) % canvas.width >= 1200 ? 255 : seed >>> 24;
    }
    context.putImageData(pixels, 0, 0);
    const encodes: number[] = [];
    const native = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback, ...options) {
      return native.call(this, blob => { encodes.push(blob?.size || 0); callback(blob); }, ...options);
    };
    const noisy = await captureInfo();
    HTMLCanvasElement.prototype.toBlob = native;
    return { structured, noisy, encodes };
  });
  if (browserName !== 'webkit') expect(result.structured.status).toBe('ready');
  for (const capture of [result.structured, result.noisy]) {
    expect(capture.released).toBe(true);
    if (capture.status === 'failed') {
      // WebKit can omit a scaled nested PNG from foreignObject; never attach it.
      expect(capture.reason).toBe('Screenshot unavailable. Send without it.');
      expect(capture.bytes).toBe(0);
    } else {
      expect(Math.max(capture.width, capture.height)).toBeLessThanOrEqual(1600);
      expect(capture.width * capture.height).toBeLessThanOrEqual(2_000_000);
      expect(capture.bytes).toBeGreaterThan(0);
      expect(capture.bytes).toBeLessThanOrEqual(1_500_000);
    }
  }
  if (result.encodes.length > 1) expect(result.encodes.at(-1)).toBeLessThan(result.encodes[0]);
});

const authoredSnapshot = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-menu-file').click();
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8')).project;
  return { parts: data.parts, skeleton: data.skeleton, paths: data.paths, mechanisms: data.mechanisms, assignments: data.assignments };
};

for (const stage of ['character', 'path', 'foundry', 'assembly']) {
  test(`Feedback captures the real ${stage} view and preserves the project`, async ({ page }, testInfo) => {
    const viewport = stage === 'character' ? { width: 1311, height: 995 } : { width: stage === 'assembly' ? 1024 : 1366, height: 768 };
    await page.setViewportSize(viewport);
    const posts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.goto(process.env.PLAYWRIGHT_BASE_PATH || '/');
    await dismissStartupAnnouncement(page);
    await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
    const starter = page.getByTestId('getting-started-dialog');
    await starter.getByTestId('getting-started-card-guided').click();
    await starter.getByTestId('guided-project-card-waving-arm').click();
    await expect(starter).toHaveCount(0);
    await page.getByTestId(`workflow-stage-${stage}`).click();
    const puppet = stage === 'path' || stage === 'character';
    const scene = puppet ? page.getByTestId(`${stage}-three-puppet`) : page.getByTestId('foundry-preview');
    await expect(scene).toHaveAttribute('data-three-renderer-status', 'webgl');
    await expect(scene).toHaveAttribute(puppet ? 'data-three-initial-scene-ready' : 'data-three-topology-ready', 'true');
    if (stage === 'foundry') await page.getByTestId('foundry-camera-preset-iso').click();
    const before = await authoredSnapshot(page);
    if (stage === 'character') {
      await page.getByTestId('find-feature-entry').click();
      await page.getByRole('combobox', { name: 'Find a feature' }).fill('save my work');
      await page.locator('[data-feature-result="project.save"]').click();
      await expect(page.getByTestId('command-download-snapshot')).toBeFocused();
    }
    // Observe the app's own immediate WebGL copy, independently of its DOM raster.
    await page.evaluate(() => {
      const native = CanvasRenderingContext2D.prototype.drawImage;
      (window as any).captureSceneSamples = [];
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: any[]) {
        Reflect.apply(native, this, args);
        const source = args[0];
        if (!(source instanceof HTMLCanvasElement) || !source.className.includes('three')) return;
        const rect = source.getBoundingClientRect();
        const width = this.canvas.width, height = this.canvas.height;
        const pixels = this.getImageData(0, 0, width, height).data;
        const samples: { x: number; y: number; color: number[] }[] = [];
        for (let y = 3; y < height - 3; y += 2) for (let x = 3; x < width - 3; x += 2) {
          const index = (y * width + x) * 4;
          const color = Array.from(pixels.slice(index, index + 4));
          if (color[3] !== 255 || Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)) < 18) continue;
          if (![index - 8, index + 8, index - width * 8, index + width * 8].every(offset => color.every((v, component) => Math.abs(v - pixels[offset + component]) < 3))) continue;
          const point = { x: rect.left + x / width * rect.width, y: rect.top + y / height * rect.height, color };
          // DOM controls over the canvas intentionally cover those scene pixels.
          const covered = document.elementsFromPoint(point.x, point.y).some(element => {
            if (element === source || element.contains(source)) return false;
            const background = getComputedStyle(element).backgroundColor;
            return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
          });
          if (!covered) samples.push(point);
        }
        (window as any).captureSceneSamples = samples.filter((_, index) => index % Math.max(1, Math.floor(samples.length / 80)) === 0);
      } as typeof native;
      const footer = document.querySelector<HTMLElement>('[data-testid="status-bar"]')!;
      footer.style.background = 'rgb(255, 130, 0)';
      footer.textContent = 'Fix: synthetic capture warning';
      (window as any).captureControlRects = Array.from(document.querySelectorAll<HTMLElement>(
        '.app-header-icon, .stage-left-pane .section-title, .stage-left-pane button, .stage-right-inspector button',
      )).map(element => ({ rect: element.getBoundingClientRect(), image: element instanceof HTMLImageElement, inset: element instanceof HTMLButtonElement ? 3 : 0 }))
        .filter(({ rect }) => rect.width > 12 && rect.height > 10 && rect.top >= 0 && rect.bottom < innerHeight)
        // Native high-DPI one-pixel button outlines are not stable raster landmarks.
        .map(({ rect, image, inset }) => ({ left: rect.left + inset, top: rect.top + inset, width: rect.width - inset * 2, height: rect.height - inset * 2, image }));
    });
    const cameraBefore = await scene.getAttribute('data-viewer-contract-state');
    const visibleImage = await page.screenshot();
    const visibleReference = visibleImage.toString('base64');
    await testInfo.attach(`${stage} visible reference`, { body: visibleImage, contentType: 'image/png' });
    await page.getByTestId('feedback-entry').click();
    const panel = page.getByRole('dialog', { name: 'Feedback', exact: true });
    await expect(panel).toBeVisible();
    const screenshot = page.getByTestId('feedback-screenshot');
    await expect(screenshot, 'Feedback supplies its own screenshot, including the scene').toBeVisible();
    const capture = await screenshot.evaluate(async (element: HTMLImageElement, reference) => {
      const blob = await (await fetch(element.src)).blob();
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
      const expectedImage = new Image(); expectedImage.src = `data:image/png;base64,${reference}`;
      await expectedImage.decode();
      const expectedCanvas = document.createElement('canvas'); expectedCanvas.width = canvas.width; expectedCanvas.height = canvas.height;
      const expectedContext = expectedCanvas.getContext('2d')!; expectedContext.drawImage(expectedImage, 0, 0, canvas.width, canvas.height);
      const samples = (window as any).captureSceneSamples as { x: number; y: number; color: number[] }[];
      const matching = samples.filter(sample => {
        const pixel = context.getImageData(Math.floor(sample.x), Math.floor(sample.y), 1, 1).data;
        const expected = expectedContext.getImageData(Math.floor(sample.x), Math.floor(sample.y), 1, 1).data;
        return Array.from(expected).every((value, index) => Math.abs(value - pixel[index]) < 12);
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const controls = ((window as any).captureControlRects as { left: number; top: number; width: number; height: number; image: boolean }[]).map(rect => {
        const x = Math.floor(rect.left), y = Math.floor(rect.top), w = Math.floor(rect.width), h = Math.floor(rect.height);
        const expected = expectedContext.getImageData(x, y, w, h).data;
        const actual = context.getImageData(x, y, w, h).data;
        let count = 0, matches = 0;
        for (let index = 0; index < expected.length; index += 4) {
          if (Math.min(expected[index], expected[index + 1], expected[index + 2]) > 180) continue;
          count++;
          // Native high-DPI text and an SVG image can differ by one raster pixel.
          // Missing/clipped controls still have no nearby matching foreground.
          if ([-w - 1, -w, -w + 1, -1, 0, 1, w - 1, w, w + 1].some(offset => {
            const candidate = index + offset * 4;
            return candidate >= 0 && candidate + 2 < actual.length && [0, 1, 2].every(component =>
              Math.abs(expected[index + component] - actual[candidate + component]) < (rect.image ? 80 : 35));
          })) matches++;
        }
        return { ...rect, count, ratio: count ? matches / count : 1 };
      });
      return { width: canvas.width, height: canvas.height, size: blob.size, samples: samples.length, matches: matching.length,
        controls,
        footer: Array.from(context.getImageData(canvas.width - 12, canvas.height - 12, 1, 1).data),
        png: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) };
    }, visibleReference);
    const artifact = Buffer.from(capture.png, 'base64');
    await validateScreenshotPng(new Uint8Array(artifact));
    await writeFile(testInfo.outputPath(`${stage}-app-capture.png`), artifact);
    await testInfo.attach(`${stage} app-generated screenshot`, { body: artifact, contentType: 'image/png' });
    expect([capture.width, capture.height]).toEqual([viewport.width, viewport.height]);
    expect(capture.size).toBeLessThanOrEqual(1_500_000);
    expect(capture.samples, 'current scene contains colored physical geometry').toBeGreaterThan(12);
    expect(capture.matches / capture.samples, 'current camera geometry survives DOM and canvas compositing').toBeGreaterThan(.8);
    for (const control of capture.controls.filter(item => item.count > 12)) expect(control.ratio, `visible control at ${control.left},${control.top}`).toBeGreaterThan(.6);
    expect(capture.footer).toEqual([255, 130, 0, 255]);
    expect(await scene.getAttribute('data-viewer-contract-state')).toEqual(cameraBefore);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await authoredSnapshot(page)).toEqual(before);
    await page.getByTestId('feedback-entry').click();
    await expect(screenshot).toBeVisible();
    await panel.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(screenshot).toHaveCount(0);
    await panel.getByRole('button', { name: 'Discard draft', exact: true }).click();
    expect(posts, 'opening, closing, removal and local discard do not transmit feedback').toEqual([]);
  });
}

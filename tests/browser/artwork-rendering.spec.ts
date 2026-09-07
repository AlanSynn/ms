import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
  artworkSurfaces, beginPaintStroke, completePaintStroke, installImageDecodeGate,
  installedSurface, openArtworkLesson, openOwnerPaint, releaseImageDecodeGate,
  saveArtworkProject, setImageDecodeGate,
} from './artworkRenderingHarness';

test.use({ viewport: { width: 1366, height: 768 } });

test('mechanism serializers load for explicit SVG and DXF downloads', async ({ page }, info) => {
  const serializers: string[] = [];
  page.on('request', request => {
    if (/\/exporter-[\w-]+\.js/.test(request.url())) serializers.push(request.url());
  });
  await openArtworkLesson(page);
  expect(serializers).toEqual([]);
  await page.getByTestId('workflow-stage-design').click();
  const svg = page.getByRole('button', { name: 'SVG', exact: true });
  await expect(svg).toBeVisible();
  expect(serializers).toEqual([]);
  for (const format of ['SVG', 'DXF']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: format, exact: true }).click();
    const file = info.outputPath(`mechanism.${format.toLowerCase()}`);
    await (await pending).saveAs(file);
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain(format === 'SVG' ? '<svg' : 'ENTITIES');
    expect(contents).not.toContain('NaN');
  }
  expect(new Set(serializers).size).toBe(1);
});

test('legacy character uploads retain live decoded image resources', async ({ page }, info) => {
  await page.addInitScript(() => {
    const resources = new WeakMap<ImageBitmap, { id: number; closed?: string }>();
    const audit = { created: 0, closed: 0, imageUploads: [] as unknown[], invalidUploads: [] as unknown[] };
    (window as any).__artworkResourceAudit = audit;
    const create = window.createImageBitmap;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => Reflect.apply(create, window, args).then((bitmap: ImageBitmap) => {
      resources.set(bitmap, { id: ++audit.created });
      return bitmap;
    })) as typeof createImageBitmap;
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      audit.closed += 1;
      const resource = resources.get(this);
      if (resource) resource.closed = new Error('Decoded image released').stack;
      return close.call(this);
    };
    for (const method of ['texImage2D', 'texSubImage2D'] as const) {
      const original = WebGL2RenderingContext.prototype[method];
      (WebGL2RenderingContext.prototype[method] as any) = function (this: WebGL2RenderingContext, ...args: unknown[]) {
        const image = args[args.length - 1];
        if (image instanceof ImageBitmap && (!image.width || !image.height)) audit.invalidUploads.push({ method, ...resources.get(image) });
        if (image instanceof HTMLImageElement) audit.imageUploads.push({ method, url: image.src.slice(0, 200), width: image.width, height: image.height, naturalWidth: image.naturalWidth, complete: image.complete });
        return Reflect.apply(original, this, args);
      };
    }
  });
  const imageWarnings: string[] = [];
  page.on('console', message => {
    if (/bad image data|Texture is immutable/.test(message.text())) imageWarnings.push(message.text());
  });
  await openArtworkLesson(page);
  const audit = await page.evaluate(() => (window as any).__artworkResourceAudit);
  await info.attach('image-resource-ownership', { body: JSON.stringify({ audit, imageWarnings }, null, 2), contentType: 'application/json' });
  expect(audit.invalidUploads).toEqual([]);
  expect(imageWarnings).toEqual([]);
});

test('paint interruptions and failed or delayed textures preserve committed owners', async ({ page }, info) => {
  await installImageDecodeGate(page);
  await openArtworkLesson(page);
  await openOwnerPaint(page);
  const initialRevision = await completePaintStroke(page);
  const initialSurface = await installedSurface(page, 'head', initialRevision);
  const unrelated = (await artworkSurfaces(page)).find(surface => surface.ownerId === 'torso')!;
  expect(unrelated.textureId).toBeTruthy();

  await beginPaintStroke(page, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-artwork-revision', initialRevision);

  await beginPaintStroke(page, 0);
  await page.getByTestId('paint-canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.up();
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-artwork-revision', initialRevision);

  await beginPaintStroke(page, -10);
  await page.getByRole('button', { name: 'Eraser', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-artwork-revision', initialRevision);

  await beginPaintStroke(page, -10);
  await page.getByTestId('character-part-item-right_arm_lower').focus();
  await page.keyboard.press('Enter');
  await page.mouse.up();
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-paint-owner', 'right_arm_lower');
  const armRevision = await completePaintStroke(page, 0);
  await installedSurface(page, 'right_arm_lower', armRevision);
  await beginPaintStroke(page, -10);
  await page.getByTestId('workflow-stage-path').focus();
  await page.keyboard.press('Enter');
  await page.mouse.up();
  await expect(page.locator('[data-stage="path"]')).toBeVisible();
  await installedSurface(page, 'head', initialRevision);
  await installedSurface(page, 'right_arm_lower', armRevision);

  // Actual installed artwork remains on the animated part through all shared views.
  for (const stage of ['path', 'project', 'design']) {
    await page.getByTestId(`workflow-stage-${stage}`).click();
    const transforms: string[] = [];
    for (const value of ['0', '35', '70']) {
      await page.getByRole('slider', { name: 'Workspace scrubber', exact: true }).fill(value);
      await installedSurface(page, 'head', initialRevision);
      await installedSurface(page, 'right_arm_lower', armRevision);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      transforms.push(await page.locator('[data-three-part-transforms], [data-three-automata-part-transforms]').evaluateAll(elements =>
        JSON.stringify(elements.map(element => {
          const data = (element as HTMLElement).dataset;
          const parts = JSON.parse(data.threePartTransforms ?? data.threeAutomataPartTransforms ?? '{}');
          return Array.isArray(parts) ? parts.find(part => part.id === 'right_arm_lower') : parts.right_arm_lower;
        }))));
    }
    expect(new Set(transforms).size, `${stage} samples move the painted bound arm`).toBeGreaterThan(1);
    await page.screenshot({ path: info.outputPath(`painted-moving-${stage}.png`) });
  }

  await openOwnerPaint(page);
  const beforeDelay = await installedSurface(page, 'head', initialRevision);
  await expect(page.getByTestId('character-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
  const unrelatedBeforeDelay = (await artworkSurfaces(page)).find(surface => surface.ownerId === 'torso')!;
  // Hold an older embedded source decode, author a newer revision, then release
  // the real decoded images in reverse order. Only the latest surface may win.
  await setImageDecodeGate(page, true);
  const staleRevision = await completePaintStroke(page, 3);
  const newestRevision = await completePaintStroke(page, -7);
  await expect.poll(() => page.evaluate(() => (window as any).__artworkDecodeGate.jobs.length)).toBeGreaterThan(1);
  await releaseImageDecodeGate(page);
  const newestSurface = await installedSurface(page, 'head', newestRevision);
  expect(newestSurface.installedRevision).not.toBe(staleRevision);
  expect(newestSurface.geometryId).toBe(beforeDelay.geometryId);
  expect(newestSurface.materialId).toBe(beforeDelay.materialId);
  const unrelatedAfterDelay = (await artworkSurfaces(page)).find(surface => surface.ownerId === 'torso')!;
  expect(unrelatedAfterDelay.materialId).toBe(unrelatedBeforeDelay.materialId);
  expect(unrelatedAfterDelay.textureId).toBe(unrelatedBeforeDelay.textureId);

  await setImageDecodeGate(page, true);
  const failedRevision = await completePaintStroke(page, -17);
  await expect.poll(() => page.evaluate(() => (window as any).__artworkDecodeGate.jobs.length)).toBeGreaterThan(0);
  await releaseImageDecodeGate(page, true);
  await expect.poll(async () => (await artworkSurfaces(page)).find(surface => surface.ownerId === 'head')?.status).toBe('failed');
  const saved = await saveArtworkProject(page, info, 'texture-failure-keeps-source');
  expect(saved.parts.head.artwork?.revision).toBe(failedRevision);
  expect(saved.parts.head.artwork?.operations.length).toBe(4);
  expect(saved.parts.right_arm_lower.artwork?.revision).toBe(armRevision);
  expect(saved.parts.right_arm_lower.artwork?.operations.length).toBe(1);
  await page.getByRole('button', { name: 'Undo paint', exact: true }).click();
  await installedSurface(page, 'head', newestRevision);
  await page.getByRole('button', { name: 'Redo paint', exact: true }).click();
  await installedSurface(page, 'head', failedRevision);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: info.outputPath('texture-failure-recovered.png') });
  expect(initialSurface.width).toBeGreaterThan(0);
});

test('paint canvas retains owner resources under six-times CPU throttling at classroom sizes', async ({ page }, info) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.addInitScript(() => {
    const audit = { pointerSecondFrameMs: [] as number[], longTasks: [] as number[], active: false };
    (window as any).__artworkInteractionAudit = audit;
    document.addEventListener('pointermove', event => {
      if (!audit.active || !event.buttons || !(event.target instanceof HTMLCanvasElement)
          || event.target.dataset.testid !== 'paint-canvas') return;
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => audit.pointerSecondFrameMs.push(performance.now() - start)));
    }, true);
    new PerformanceObserver(list => {
      if (audit.active) audit.longTasks.push(...list.getEntries().map(entry => entry.duration));
    }).observe({ type: 'longtask' });
  });
  await openArtworkLesson(page);
  const measurements: unknown[] = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await openOwnerPaint(page);
    await installedSurface(page, 'head', await completePaintStroke(page, 20));
    const workspaceBox = (await page.getByTestId('paint-workspace').boundingBox())!;
    for (const name of ['Brush', 'Eraser', 'Thin brush', 'Broad brush', 'Done', 'Clear paint']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    const before = await artworkSurfaces(page);
    const beforeHeap = await client.send('Runtime.getHeapUsage');
    await page.evaluate(() => {
      const audit = (window as any).__artworkInteractionAudit;
      audit.pointerSecondFrameMs = []; audit.longTasks = []; audit.active = true;
    });
    let revision = '';
    for (let index = 0; index < 8; index += 1) revision = await completePaintStroke(page, 15 - index * 4);
    await installedSurface(page, 'head', revision);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const interaction = await page.evaluate(() => {
      const audit = (window as any).__artworkInteractionAudit;
      audit.active = false;
      return { pointerSecondFrameMs: audit.pointerSecondFrameMs, longTasksMs: audit.longTasks };
    });
    expect(interaction.pointerSecondFrameMs.length).toBeGreaterThan(0);
    const after = await artworkSurfaces(page);
    for (const surface of before.filter(item => item.ownerId !== 'head')) {
      expect(after.find(item => item.ownerId === surface.ownerId)?.textureId).toBe(surface.textureId);
      expect(after.find(item => item.ownerId === surface.ownerId)?.materialId).toBe(surface.materialId);
      expect(after.find(item => item.ownerId === surface.ownerId)?.geometryId).toBe(surface.geometryId);
    }
    const currentHead = after.find(surface => surface.ownerId === 'head')!;
    expect(currentHead.geometryId).toBe(before.find(surface => surface.ownerId === 'head')?.geometryId);
    const afterHeap = await client.send('Runtime.getHeapUsage');
    await client.send('HeapProfiler.collectGarbage');
    const settledHeap = await client.send('Runtime.getHeapUsage');
    await page.getByTestId('paint-workspace').screenshot({ path: info.outputPath(`paint-${viewport.width}-cpu6.png`) });
    measurements.push({ viewport, cpuThrottlingRate: 6, workspaceBox, beforeHeap, afterHeap, settledHeap,
      surfaceCount: after.length, liveRasterPixels: after.reduce((total, surface) => total + surface.width * surface.height, 0),
      interaction, finalRevision: revision });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  const output = info.outputPath('artwork-rendering-measurements.json');
  await writeFile(output, JSON.stringify({
    note: 'Chromium CDP 6x CPU emulation, not Chromebook hardware. Pointer latency is elapsed time to the second animation frame after real drawing input. Heap excludes GPU memory.',
    measurements,
  }, null, 2));
  await info.attach('artwork-rendering-measurements', { path: output, contentType: 'application/json' });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

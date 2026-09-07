import { expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Point, ProjectState } from '../../types';
import { dismissStartupAnnouncement } from './startupHarness';

export type Surface = {
  ownerId: string; revision: string; installedRevision?: string; status: string;
  geometryId: string; materialId: string; textureId?: string; width: number; height: number;
};

export const openArtworkLesson = async (page: Page) => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await dismissStartupAnnouncement(page);
  await page.getByTestId('getting-started-card-guided').click();
  await page.getByTestId('guided-project-card-waving-arm').click();
  await expect(page.getByTestId('character-three-puppet')).toHaveAttribute('data-three-initial-scene-ready', 'true');
};

export const openOwnerPaint = async (page: Page, ownerId = 'head') => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId(`character-part-item-${ownerId}`).click();
  if (!await page.getByTestId('paint-workspace').count()) await page.getByTestId('character-draw-paint').click();
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-paint-owner', ownerId);
  await expect(page.getByTestId('paint-canvas')).toBeVisible();
};

export const paintPoint = async (page: Page, point: Point) => {
  const canvas = page.getByTestId('paint-canvas');
  const rect = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute('data-paint-view'))!);
  return { x: rect.x + (point.x - view.minX) / view.width * rect.width,
    y: rect.y + (-point.y - view.minY) / view.height * rect.height };
};

export const beginPaintStroke = async (page: Page, y = 12) => {
  const first = await paintPoint(page, { x: -20, y });
  const last = await paintPoint(page, { x: 20, y });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 12 });
};

export const completePaintStroke = async (page: Page, y = 12) => {
  const revision = await page.getByTestId('paint-workspace').getAttribute('data-artwork-revision');
  await beginPaintStroke(page, y);
  await page.mouse.up();
  await expect(page.getByTestId('paint-workspace')).not.toHaveAttribute('data-artwork-revision', revision!);
  return (await page.getByTestId('paint-workspace').getAttribute('data-artwork-revision'))!;
};

export const artworkSurfaces = (page: Page): Promise<Surface[]> => page.locator('[data-three-artwork-surfaces]').evaluateAll(elements =>
  elements.flatMap(element => JSON.parse((element as HTMLElement).dataset.threeArtworkSurfaces || '[]')));

export const installedSurface = async (page: Page, ownerId: string, revision: string) => {
  await expect.poll(async () => (await artworkSurfaces(page)).some(surface => surface.ownerId === ownerId
    && surface.installedRevision === revision && surface.status === 'current')).toBe(true);
  return (await artworkSurfaces(page)).find(surface => surface.ownerId === ownerId && surface.installedRevision === revision)!;
};

export const saveArtworkProject = async (page: Page, info: TestInfo, name: string): Promise<ProjectState> => {
  await page.getByTestId('command-menu-file').click();
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const output = info.outputPath(`${name}.motionsmith`);
  await (await pending).saveAs(output);
  return JSON.parse(await readFile(output, 'utf8')).project;
};

/** Fault injection only controls actual embedded image decoding; source is untouched. */
export const installImageDecodeGate = (page: Page) => page.addInitScript(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  const gate = {
    enabled: false,
    jobs: [] as Array<{ image: HTMLImageElement; url: string }>,
    release(fail: boolean) {
      this.enabled = false;
      for (const job of this.jobs.splice(0).reverse()) {
        if (fail) job.image.dispatchEvent(new Event('error'));
        else descriptor.set!.call(job.image, job.url);
      }
    },
  };
  (window as any).__artworkDecodeGate = gate;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...descriptor,
    set(value: string) {
      if (gate.enabled && String(value).startsWith('data:image/')) gate.jobs.push({ image: this, url: String(value) });
      else descriptor.set!.call(this, value);
    },
  });
});

export const setImageDecodeGate = (page: Page, enabled: boolean) => page.evaluate(value => {
  (window as any).__artworkDecodeGate.enabled = value;
}, enabled);

export const releaseImageDecodeGate = (page: Page, fail = false) => page.evaluate(value => {
  (window as any).__artworkDecodeGate.release(value);
}, fail);

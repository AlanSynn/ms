import { expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Point, ProjectState } from '../../types';

export const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? '/';

export const saveFile = async (page: Page, testInfo: TestInfo, name: string) => {
  await page.getByTestId('command-menu-file').click();
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const file = testInfo.outputPath(`${name}.motionsmith`);
  await download.saveAs(file);
  const packet = JSON.parse(await readFile(file, 'utf8'));
  expect(packet.format).toBe('motionsmith-project');
  return { file, project: packet.project as ProjectState };
};

export const paintHead = async (page: Page) => {
  await page.getByTestId('workflow-stage-character').click();
  await page.getByTestId('character-part-item-head').click();
  await page.getByTestId('character-draw-paint').click();
  await expect(page.getByTestId('paint-workspace')).toHaveAttribute('data-paint-owner', 'head');
};

export const screenPoint = async (page: Page, point: Point) => {
  const canvas = page.getByTestId('paint-canvas');
  const bounds = (await canvas.boundingBox())!;
  const view = JSON.parse((await canvas.getAttribute('data-paint-view'))!);
  return { x: bounds.x + (point.x - view.minX) / view.width * bounds.width,
    y: bounds.y + (-point.y - view.minY) / view.height * bounds.height };
};

export const drawMark = async (page: Page, points: Point[]) => {
  const first = await screenPoint(page, points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const position = await screenPoint(page, p);
    await page.mouse.move(position.x, position.y, { steps: 4 });
  }
  await page.mouse.up();
};

export const pixel = async (page: Page, point: Point): Promise<number[]> => page.getByTestId('paint-canvas').evaluate((element, p) => {
  const canvas = element as HTMLCanvasElement;
  const view = JSON.parse(canvas.dataset.paintView!);
  const x = Math.round((p.x - view.minX) / view.width * canvas.width);
  const y = Math.round((-p.y - view.minY) / view.height * canvas.height);
  return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
}, point);

export const physicalState = (project: ProjectState) => ({
  parts: Object.fromEntries(Object.entries(project.parts).map(([id, { artwork: _art, ...part }]) => [id, part])),
  skeleton: project.skeleton, paths: project.paths, mechanisms: project.mechanisms,
});

export const installedArtwork = async (page: Page, ownerId: string, revision: string) => {
  await expect.poll(async () => page.locator('[data-three-artwork-surfaces]').evaluateAll((elements, expected) => {
    return elements.flatMap(element => JSON.parse((element as HTMLElement).dataset.threeArtworkSurfaces || '[]'))
      .some(surface => surface.ownerId === expected.ownerId && surface.installedRevision === expected.revision && surface.status === 'current' && surface.width > 0);
  }, { ownerId, revision })).toBe(true);
};


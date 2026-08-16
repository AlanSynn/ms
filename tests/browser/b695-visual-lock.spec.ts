import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLessonProject, serializeProject } from '../../utils/project';

const ENABLED = process.env.B695_VISUAL_LOCK === '1';
const OUTPUT_ROOT = process.env.B695_GOLDEN_DIR ?? join(process.cwd(), 'artifacts/b695-visual-lock/baseline');
const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;
const PHASES = [0, 45, 90, 180, 270] as const;
const TEST_ONNX_MODEL_BYTES = Buffer.alloc(1_000_001, 1);

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const waitForBoot = async (page: Page) => {
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
};

const writeLesson = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motionsmith-b695-lock-'));
  const path = join(directory, 'waving-arm.motionsmith.json');
  await writeFile(path, serializeProject(createLessonProject('waving-arm')), 'utf8');
  return path;
};

const importLesson = async (page: Page) => {
  await waitForBoot(page);
  const path = await writeLesson();
  const dialog = page.getByTestId('getting-started-dialog');
  if (await dialog.count()) {
    if (await dialog.getByTestId('guided-project-library').count()) {
      await dialog.getByRole('button', { name: 'Starters' }).click();
    }
    await dialog.getByTestId('getting-started-import-input').setInputFiles(path);
  } else {
    await page.getByTestId('project-file-input').setInputFiles(path);
  }
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
};

const stage = (page: Page, label: string | RegExp) => {
  const aliases: Record<string, RegExp> = {
    Character: /^Character$/i,
    'Path Editor': /^Path Editor$/i,
    Foundry: /Mechanism Foundry|Foundry/i,
    'Mechanism Foundry': /Mechanism Foundry|Foundry/i,
    Design: /Mechanism Design|Design/i,
    'Mechanism Design': /Mechanism Design|Design/i,
    Blueprint: /^Blueprint$/i,
    Assembly: /^Assembly$/i,
  };
  return page
    .getByTestId('workspace-steps')
    .getByRole('button', { name: typeof label === 'string' ? aliases[label] ?? new RegExp(`^${label}$`, 'i') : label });
};

const pauseWorkspace = async (page: Page) => {
  const dock = page.getByTestId('workspace-player-dock');
  const pause = dock.getByRole('button', { name: 'Pause' });
  if (await pause.count()) await pause.click();
};

const pauseFoundry = async (page: Page) => {
  const play = page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play' });
  if (await play.count()) return;
  const pause = page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause' });
  if (await pause.count()) await pause.click();
};

const makePhaseExact = async (input: Locator) => {
  await input.evaluate(node => node.setAttribute('step', 'any'));
};

const setWorkspacePhase = async (page: Page, percent: number) => {
  const input = page.getByLabel('Workspace scrubber');
  await makePhaseExact(input);
  await input.fill(String(percent));
  await expect(input).toHaveValue(String(percent));
};

const capture = async (page: Page, viewportName: string, name: string) => {
  const directory = join(OUTPUT_ROOT, viewportName, 'screens');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  const bytes = await readFile(path);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
};

const readProbe = async (page: Page) => page.evaluate(() => {
  const interesting = [
    '[data-testid$="-state"]',
    '[data-testid="foundry-camera-rig"]',
    '[data-testid="design-shared-foundry-preview"]',
    '[data-testid="blueprint-svg-preview"]',
  ];
  const nodes = Array.from(document.querySelectorAll(interesting.join(',')));
  const serialize = (node: Element) => ({
    testId: node.getAttribute('data-testid'),
    attributes: Object.fromEntries(Array.from(node.attributes).map(attribute => [attribute.name, attribute.value])),
  });
  const controls = Array.from(document.querySelectorAll('button, input, select, textarea')).map(node => ({
    tag: node.tagName,
    type: node.getAttribute('type'),
    ariaLabel: node.getAttribute('aria-label'),
    testId: node.getAttribute('data-testid'),
    text: node.textContent?.trim() ?? '',
    value: 'value' in node ? String((node as HTMLInputElement).value) : undefined,
    disabled: 'disabled' in node ? Boolean((node as HTMLButtonElement).disabled) : undefined,
    pressed: node.getAttribute('aria-pressed'),
  }));
  return {
    url: location.href,
    title: document.title,
    testIds: Array.from(document.querySelectorAll('[data-testid]')).map(node => node.getAttribute('data-testid')).filter(Boolean).sort(),
    probes: nodes.map(serialize),
    controls,
    svgHashes: Array.from(document.querySelectorAll('svg')).map(svg => ({
      testId: svg.getAttribute('data-testid'),
      hash: svg.outerHTML.length,
    })),
  };
});

const record = async (page: Page, viewportName: string, name: string, extra: Record<string, unknown> = {}) => {
  const screenshot = await capture(page, viewportName, name);
  const probe = await readProbe(page);
  const path = join(OUTPUT_ROOT, viewportName, `${name}.json`);
  await writeFile(path, JSON.stringify({ name, screenshot, probe, ...extra }, null, 2) + '\n', 'utf8');
  return { screenshot, probe };
};

const downloadHash = async (page: Page, button: Locator) => {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  return { filename: download.suggestedFilename(), sha256: sha256(bytes), bytes: bytes.length };
};

test.describe('b695 visual lock evidence', () => {
  test.skip(!ENABLED, 'run with B695_VISUAL_LOCK=1 to capture or compare the visual-lock evidence');
  test.describe.configure({ mode: 'serial' });

  test('captures the complete baseline evidence set', async ({ page }) => {
    await page.route('**/onnx/pose_model.onnx', async route => route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'content-length': String(TEST_ONNX_MODEL_BYTES.length) },
      body: TEST_ONNX_MODEL_BYTES,
    }));
    const manifest: Record<string, unknown> = {
      baseline: 'b695b02275d03506969f2d13c98bc38107c17e0e',
      capturedAt: new Date().toISOString(),
      viewports: {},
    };

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await importLesson(page);
      const viewportManifest: Record<string, unknown> = {};

      await stage(page, 'Character').click();
      await expect(page.getByTestId('character-three-puppet')).toBeVisible();
      await page.getByTestId('character-three-puppet-view-2d').click();
      viewportManifest.characterFront = await record(page, viewport.name, 'character-front');
      await page.getByTestId('character-three-puppet-view-3d').click();
      viewportManifest.characterIsometric = await record(page, viewport.name, 'character-isometric');

      await stage(page, 'Path Editor').click();
      await pauseWorkspace(page);
      await setWorkspacePhase(page, 0);
      await expect(page.getByTestId('path-three-puppet-canvas')).toBeVisible();
      viewportManifest.pathPaused3d = await record(page, viewport.name, 'path-paused-3d');
      await page.getByTestId('path-view-2d').click();
      viewportManifest.pathPaused2d = await record(page, viewport.name, 'path-paused-2d');

      await stage(page, 'Foundry').click();
      await expect(page.getByTestId('foundry-canvas-pane')).toBeVisible();
      await pauseFoundry(page);
      const foundryPhase = page.getByLabel('Foundry phase');
      await makePhaseExact(foundryPhase);
      const foundryManifest: Record<string, unknown> = {};
      for (const phase of PHASES) {
        await foundryPhase.fill(String(phase));
        const front = page.getByTestId('foundry-camera-preset-front');
        await front.click();
        foundryManifest[`front${phase}`] = await record(page, viewport.name, `foundry-front-${phase}`);
        await page.getByTestId('foundry-camera-preset-iso').click();
        foundryManifest[`isometric${phase}`] = await record(page, viewport.name, `foundry-isometric-${phase}`);
      }
      for (const selector of ['foundry-toggle-paths', 'foundry-toggle-trail']) {
        const button = page.getByTestId(selector);
        if (await button.getAttribute('aria-pressed') === 'false') await button.click();
      }
      await foundryPhase.fill('90');
      await page.getByTestId('foundry-camera-preset-iso').click();
      foundryManifest.allOverlays = await record(page, viewport.name, 'foundry-isometric-all-overlays', {
        phaseDegrees: 90,
      });
      viewportManifest.foundry = foundryManifest;

      const useMechanism = page.getByRole('button', { name: /Use mechanism/i });
      if (await useMechanism.count()) await useMechanism.click();
      await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
      await pauseWorkspace(page);
      await setWorkspacePhase(page, 0);
      const designControls = page.getByTestId('design-foundry-camera-controls');
      const designManifest: Record<string, unknown> = {};
      for (const [label, name] of [['front', 'Front'], ['isometric', 'Isometric']] as const) {
        await designControls.getByRole('button', { name, exact: true }).click();
        designManifest[label] = await record(page, viewport.name, `design-${label}`);
      }
      viewportManifest.design = designManifest;

      await stage(page, 'Blueprint').click();
      await expect(page.getByTestId('blueprint-svg-preview')).toBeVisible();
      const blueprintDocument = await record(page, viewport.name, 'blueprint-document');
      const generate = page.getByRole('button', { name: /Generate package/i });
      if (await generate.count()) await generate.click();
      await expect(page.getByTestId('blueprint-export-package-json')).toBeAttached();
      const exportedPackage = JSON.parse((await page.getByTestId('blueprint-export-package-json').textContent())!);
      const svgExport = await downloadHash(page, page.getByRole('button', { name: 'Download SVG default' }));
      const pdfExport = await downloadHash(page, page.getByRole('button', { name: 'Download PDF cut sheet default' }));
      viewportManifest.blueprint = {
        document: blueprintDocument,
        packageHash: sha256(JSON.stringify(exportedPackage)),
        packageFields: Object.keys(exportedPackage).sort(),
        svgExport,
        pdfExport,
      };

      await stage(page, 'Assembly').click();
      await expect(page.getByTestId('assembly-canvas-preview')).toBeVisible();
      const steps = page.getByTestId('assembly-step-list').getByRole('button');
      const assemblyManifest: Record<string, unknown> = {};
      const stepCount = await steps.count();
      for (const index of [...new Set([0, Math.max(0, Math.min(2, stepCount - 1)), Math.max(0, stepCount - 1)])]) {
        await steps.nth(index).click();
        assemblyManifest[`step${index}`] = await record(page, viewport.name, `assembly-step-${index}`);
      }
      viewportManifest.assembly = assemblyManifest;
      (manifest.viewports as Record<string, unknown>)[viewport.name] = viewportManifest;
    }

    await mkdir(OUTPUT_ROOT, { recursive: true });
    await writeFile(join(OUTPUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  });
});

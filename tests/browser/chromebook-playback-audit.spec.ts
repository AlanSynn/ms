import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import {
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookPlaybackAcceptance,
  percentiles,
  type ActionLatency,
  type ChromebookPlaybackAuditReport,
} from './chromebookAuditReport';
import {
  applyChromebookEmulation,
  collectPlaybackAudit,
  installChromebookAuditInstrumentation,
  measureClickToNextPaint,
} from './chromebookAuditHarness';

const ENABLED = process.env.CHROMEBOOK_AUDIT === '1';
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== '0';
const PLAYBACK_MS = Number(
  process.env.CHROMEBOOK_PLAYBACK_AUDIT_MS ?? 15_000,
);
const OUTPUT = process.env.CHROMEBOOK_PLAYBACK_AUDIT_OUTPUT
  ?? join(
    process.cwd(),
    'artifacts/chromebook-audit/playback/chromebook-playback-audit.json',
  );

const outputPath = () => extname(OUTPUT).toLowerCase() === '.json'
  ? OUTPUT
  : join(OUTPUT, 'chromebook-playback-audit.json');

const openWavingArmFoundry = async (page: Page) => {
  const dialog = page.getByTestId('getting-started-dialog');
  await expect(dialog).toBeVisible();
  const guide = dialog.getByTestId('getting-started-card-guided');
  await expect(guide).toBeVisible();
  await expect(guide).toBeEnabled();
  await guide.click();
  const wavingArm = dialog.getByTestId('guided-project-card-waving-arm');
  await expect(wavingArm).toBeVisible();
  await expect(wavingArm).toBeEnabled();
  await wavingArm.click();
  await expect(dialog).toHaveCount(0);

  const foundry = page
    .getByTestId('workspace-steps')
    .getByRole('button', { name: /Mechanism Foundry|Foundry/i });
  await expect(foundry).toBeVisible();
  await expect(foundry).toBeEnabled();
  await foundry.click();
  await expect(page.getByTestId('foundry-preview')).toBeVisible();
  await expect(page.locator('canvas.foundry-three-canvas')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
};

test.describe('Chromebook Foundry playback audit', () => {
  test.skip(!ENABLED, 'run with CHROMEBOOK_AUDIT=1 against a production preview');

  test('Balanced playback keeps frames, heap, React, and Three resources bounded', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(0);
    const context = await browser.newContext({
      viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
      screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
      deviceScaleFactor: CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
    });
    await installChromebookAuditInstrumentation(context);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#boot-loader')).toHaveCount(0, {
        timeout: 180_000,
      });
      expect(
        await page.locator('script[src*="/@vite/client"]').count(),
        'playback audit runs the production preview',
      ).toBe(0);
      await openWavingArmFoundry(page);
      const client = await applyChromebookEmulation(page);

      try {
        await client.send('HeapProfiler.collectGarbage').catch(() => undefined);
        const runtimeEnvironment = await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          deviceScaleFactor: window.devicePixelRatio,
        }));
        expect(runtimeEnvironment.viewport).toEqual(
          CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
        );
        expect(runtimeEnvironment.deviceScaleFactor).toBe(
          CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
        );

        const actions: ActionLatency[] = [];
        const toolbar = page.getByTestId('foundry-toolbar');
        const play = toolbar.getByRole('button', { name: 'Play', exact: true });
        const playTiming = await measureClickToNextPaint(play);
        actions.push({
          label: 'foundry-play',
          kind: 'click',
          durationMs: playTiming.nextPaintMs,
        });
        await expect(
          toolbar.getByRole('button', { name: 'Pause', exact: true }),
        ).toBeVisible();
        const playback = await collectPlaybackAudit(page, PLAYBACK_MS);
        const pause = toolbar.getByRole('button', { name: 'Pause', exact: true });
        const pauseTiming = await measureClickToNextPaint(pause);
        actions.push({
          label: 'foundry-pause',
          kind: 'click',
          durationMs: pauseTiming.nextPaintMs,
        });
        await expect(
          toolbar.getByRole('button', { name: 'Play', exact: true }),
        ).toBeVisible();

        const interactionLatencyMs = percentiles(
          actions.map((action) => action.durationMs),
        );
        const acceptance = evaluateChromebookPlaybackAcceptance(
          playback,
          interactionLatencyMs,
        );
        const report: ChromebookPlaybackAuditReport = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          resultLabel: '6x CPU emulation',
          productionBuild: true,
          actualChromebookTested: false,
          workload: 'foundry-playback',
          environment: {
            ...CHROMEBOOK_AUDIT_ENVIRONMENT,
            browserVersion: browser.version(),
            userAgent: runtimeEnvironment.userAgent,
            measuredDeviceScaleFactor: runtimeEnvironment.deviceScaleFactor,
            throttlingScope: 'feature-action',
          },
          actions,
          interactionLatencyMs,
          playback,
          acceptance,
        };
        const json = `${JSON.stringify(report, null, 2)}\n`;
        const testOutput = testInfo.outputPath('chromebook-playback-audit.json');
        await writeFile(testOutput, json, 'utf8');
        await testInfo.attach('chromebook-playback-audit', {
          path: testOutput,
          contentType: 'application/json',
        });
        const externalOutput = outputPath();
        await mkdir(dirname(externalOutput), { recursive: true });
        await writeFile(externalOutput, json, 'utf8');

        expect(pageErrors, 'playback audit has no uncaught page errors').toEqual([]);
        if (ENFORCE) {
          for (const [name, check] of Object.entries(acceptance)) {
            expect(
              check.passed,
              `${name}: observed ${check.observed}, limit ${check.limit}`,
            ).toBe(true);
          }
        }
      } finally {
        await client.detach().catch(() => undefined);
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});

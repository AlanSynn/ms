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
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
  installChromebookAuditIsolation,
} from './chromebookAuditHarness';
import { collectChromebookAuditProvenance } from './chromebookAuditProvenance';
import { CHROMEBOOK_AUDIT_PROFILE } from './chromebookAuditProfiles';

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
    const client = await installChromebookAuditIsolation(page);
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
      await applyChromebookEmulation(page, client);

      try {
        await client.send('HeapProfiler.collectGarbage').catch(() => undefined);
        const actions: ActionLatency[] = [];
        const toolbar = page.getByTestId('foundry-toolbar');
        const play = toolbar.getByRole('button', { name: 'Play', exact: true });
        await expect(play).toBeVisible();
        const playback = await collectPlaybackAudit(page, PLAYBACK_MS, {
          controlsTestId: 'foundry-toolbar',
        });
        if (!playback.controlActions) {
          throw new Error('Foundry playback audit did not record control latency');
        }
        actions.push(
          {
            label: 'foundry-play',
            kind: 'click',
            durationMs: playback.controlActions.playNextPaintMs,
          },
          {
            label: 'foundry-pause',
            kind: 'click',
            durationMs: playback.controlActions.pauseNextPaintMs,
          },
        );

        const interactionLatencyMs = percentiles(
          actions.map((action) => action.durationMs),
        );
        const acceptance = evaluateChromebookPlaybackAcceptance(
          playback,
          interactionLatencyMs,
        );
        const baseURL = testInfo.project.use.baseURL;
        if (typeof baseURL !== 'string') {
          throw new Error('Chromebook playback audit requires a preview base URL');
        }
        const report: ChromebookPlaybackAuditReport = {
          schemaVersion: 3,
          generatedAt: new Date().toISOString(),
          profile: CHROMEBOOK_AUDIT_PROFILE.name,
          resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
          productionBuild: true,
          actualChromebookTested: false,
          provenance: await collectChromebookAuditProvenance(baseURL),
          workload: 'foundry-playback',
          environment: await collectChromebookRuntimeEnvironment(
            page,
            browser.version(),
            'feature-action',
          ),
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

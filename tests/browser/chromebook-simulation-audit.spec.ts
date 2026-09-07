import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookPlaybackAcceptance,
  percentiles,
  type ActionLatency,
  type ChromebookPlaybackAuditReport,
} from "./chromebookAuditReport";
import {
  applyChromebookEmulation,
  collectPlaybackAudit,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
  installChromebookAuditIsolation,
} from "./chromebookAuditHarness";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const PLAYBACK_MS = Number(
  process.env.CHROMEBOOK_SIMULATION_AUDIT_MS ?? 5_000,
);
const OUTPUT_DIR = process.env.CHROMEBOOK_SIMULATION_AUDIT_OUTPUT ?? join(
  process.cwd(),
  "artifacts/chromebook-audit/playback",
);

type SimulationStage = "path" | "design" | "assembly";

const stageCanvas: Record<SimulationStage, string> = {
  path: "canvas.three-puppet-canvas",
  design: "canvas.foundry-three-canvas",
  assembly: "canvas.foundry-three-canvas",
};

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-stage="character"]')).toBeVisible();
};

const prepareStage = async (page: Page, stage: SimulationStage) => {
  await page.getByTestId(`workflow-stage-${stage}`).click();
  await expect(page.locator(`[data-stage="${stage}"]`)).toBeVisible();
  await expect(page.locator(stageCanvas[stage])).toBeVisible();
  if (stage === "path") {
    await expect(page.getByTestId("path-three-puppet-state")).toHaveAttribute(
      "data-three-topology-ready",
      "true",
    );
  }
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const dock = page.getByTestId("workspace-player-dock");
  const play = dock.getByRole("button", { name: "Play", exact: true });
  await play.click();
  const pause = dock.getByRole("button", { name: "Pause", exact: true });
  await expect(pause).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.setTimeout(resolve, 750);
  }));
  await pause.click();
  await expect(play).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
};

for (const stage of ["path", "design", "assembly"] as const) {
  test.describe(`Chromebook ${stage} simulation audit`, () => {
    test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

    test(`${stage} playback stays responsive and allocation-stable`, async ({
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
      const requests: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));

      try {
        await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/', { waitUntil: "domcontentloaded" });
        await dismissStartupAnnouncement(page);
        await expect(page.locator("#boot-loader")).toHaveCount(0, {
          timeout: 180_000,
        });
        expect(await page.locator('script[src*="/@vite/client"]').count()).toBe(0);
        await openWavingArm(page);
        await prepareStage(page, stage);
        await applyChromebookEmulation(page, client);

        try {
          const requestOffset = requests.length;
          const dock = page.getByTestId("workspace-player-dock");
          const play = dock.getByRole("button", { name: "Play", exact: true });
          const actions: ActionLatency[] = [];
          await expect(play).toBeVisible();
          const playback = await collectPlaybackAudit(page, PLAYBACK_MS, {
            controlsTestId: "workspace-player-dock",
          });
          if (!playback.controlActions) {
            throw new Error(`${stage} playback did not record control latency`);
          }
          actions.push(
            {
              label: `${stage}-play`,
              kind: "click",
              durationMs: playback.controlActions.playNextPaintMs,
            },
            {
              label: `${stage}-pause`,
              kind: "click",
              durationMs: playback.controlActions.pauseNextPaintMs,
            },
          );
          await expect(play).toBeVisible();

          const interactionLatencyMs = percentiles(
            actions.map((action) => action.durationMs),
          );
          const acceptance = evaluateChromebookPlaybackAcceptance(
            playback,
            interactionLatencyMs,
          );
          const featureRequests = requests.slice(requestOffset);
          const forbiddenRuntimeRequests = featureRequests.filter((url) =>
            /rapier|onnx|ort-wasm|u2net|character-segmentation/i.test(url)
          );
          const baseURL = testInfo.project.use.baseURL;
          if (typeof baseURL !== "string") {
            throw new Error("Chromebook simulation audit requires a preview base URL");
          }
          const report: ChromebookPlaybackAuditReport & {
            networkRequests: string[];
            forbiddenRuntimeRequests: string[];
          } = {
            schemaVersion: 3,
            generatedAt: new Date().toISOString(),
            profile: CHROMEBOOK_AUDIT_PROFILE.name,
            resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
            productionBuild: true,
            actualChromebookTested: false,
            provenance: await collectChromebookAuditProvenance(baseURL),
            workload: `${stage}-playback`,
            environment: await collectChromebookRuntimeEnvironment(
              page,
              browser.version(),
              "feature-action",
            ),
            actions,
            interactionLatencyMs,
            playback,
            acceptance,
            networkRequests: featureRequests,
            forbiddenRuntimeRequests,
          };
          const json = `${JSON.stringify(report, null, 2)}\n`;
          const filename = `chromebook-${stage}-playback-audit.json`;
          const testOutput = testInfo.outputPath(filename);
          await writeFile(testOutput, json, "utf8");
          await testInfo.attach(`chromebook-${stage}-playback-audit`, {
            path: testOutput,
            contentType: "application/json",
          });
          const externalOutput = join(OUTPUT_DIR, filename);
          await mkdir(dirname(externalOutput), { recursive: true });
          await writeFile(externalOutput, json, "utf8");

          expect(pageErrors, `${stage} playback has no uncaught page errors`)
            .toEqual([]);
          expect(
            forbiddenRuntimeRequests,
            `${stage} playback keeps optional WASM/inference runtimes dormant`,
          ).toEqual([]);
          if (ENFORCE) {
            for (const [name, check] of Object.entries(acceptance)) {
              expect(
                check.passed,
                `${stage} ${name}: observed ${check.observed}, limit ${check.limit}`,
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
}

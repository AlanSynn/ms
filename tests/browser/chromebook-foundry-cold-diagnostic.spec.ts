import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  applyChromebookEmulation,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
  installChromebookAuditIsolation,
} from "./chromebookAuditHarness";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import {
  completeFoundryColdDiagnosticRun,
  finishFoundryColdMountProbe,
  FOUNDRY_COLD_LONG_TASK_LIMIT_MS,
  foundryColdPresetForRun,
  installFoundryColdMountProbe,
  summarizeFoundryColdRuns,
  type FoundryColdDiagnosticRun,
  type FoundryColdPreset,
} from "./chromebookFoundryColdDiagnostic";

const ENABLED = process.env.CHROMEBOOK_FOUNDRY_COLD_DIAGNOSTIC === "1";
const RUN_COUNT = Number(process.env.CHROMEBOOK_FOUNDRY_COLD_RUNS ?? 8);
const OUTPUT = process.env.CHROMEBOOK_FOUNDRY_COLD_OUTPUT ?? join(
  "/tmp",
  "chromebook-audit",
  "foundry-cold-diagnostic-4x.json",
);

if (!Number.isInteger(RUN_COUNT) || RUN_COUNT < 1 || RUN_COUNT > 20) {
  throw new Error("CHROMEBOOK_FOUNDRY_COLD_RUNS must be an integer from 1 through 20");
}

const afterTwoPaints = (page: Page) => page.evaluate(() =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  })
);

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-stage="character"]')).toBeVisible();
  const preview = page.getByTestId("character-three-puppet");
  await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
  await expect(preview).toHaveAttribute("data-three-initial-scene-ready", "true");
  await expect(preview.locator("canvas.three-puppet-canvas")).toBeVisible();
};

const configurePreset = async (page: Page, preset: FoundryColdPreset) => {
  await page.getByTestId("workflow-stage-options").click();
  await expect(page.locator('[data-stage="options"]')).toBeVisible();
  const control = page.getByLabel("Performance preset");
  await control.selectOption(preset);
  await expect(control).toHaveValue(preset);
  await afterTwoPaints(page);
};

const openSettledPathAndWaitForFoundryPreload = async (page: Page) => {
  await page.getByTestId("workflow-stage-path").click();
  await expect(page.locator('[data-stage="path"]')).toBeVisible();
  const preview = page.getByTestId("path-three-puppet");
  await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
  await expect(preview).toHaveAttribute("data-three-initial-scene-ready", "true");
  await expect(preview.locator("canvas.three-puppet-canvas")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const files = (performance.getEntriesByType("resource") as
      PerformanceResourceTiming[]).map((entry) =>
        new URL(entry.name).pathname.split("/").at(-1) ?? ""
      );
    return {
      foundryStage: files.some((file) => file.startsWith("MechanismFoundry-")),
      foundryRenderer: files.some((file) => file.startsWith("ThreeFoundryPreview-")),
    };
  }), {
    message: "Path readiness releases both adjacent Foundry preload tasks",
    intervals: [0],
    timeout: 60_000,
  }).toEqual({ foundryStage: true, foundryRenderer: true });
  await afterTwoPaints(page);
};

const waitForCompleteFoundryMount = async (page: Page) => {
  await expect(page.locator('[data-stage="foundry"]')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const gallery = document.querySelector<HTMLElement>(
      '[data-testid="foundry-mechanism-gallery"]',
    );
    const visible = Number(gallery?.getAttribute("data-visible-previews") ?? "-1");
    const total = gallery?.querySelectorAll("button.recommendation-card").length ?? 0;
    return {
      galleryComplete:
        total > 0 &&
        visible === total &&
        gallery?.querySelectorAll('[data-testid^="foundry-mini-simulation-"]')
          .length === total &&
        gallery?.querySelectorAll('[data-testid^="foundry-mini-ghost-"]')
          .length === total * 2,
      parametricEditor: Boolean(
        document.querySelector('[data-testid="foundry-parametric-editor"]'),
      ),
      placeholderRemoved: !document.querySelector(
        '[data-testid="foundry-preview-loading"]',
      ),
      rendererWebgl:
        document.querySelector('[data-testid="foundry-preview"]')
          ?.getAttribute("data-three-renderer-status") === "webgl",
      topologyReady:
        document.querySelector('[data-testid="foundry-camera-rig"]')
          ?.getAttribute("data-three-topology-ready") === "true",
    };
  }), {
    message: "all progressive Foundry mount owners become observable",
    intervals: [0],
    timeout: 60_000,
  }).toEqual({
    galleryComplete: true,
    parametricEditor: true,
    placeholderRemoved: true,
    rendererWebgl: true,
    topologyReady: true,
  });
  await afterTwoPaints(page);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
};

const runColdMount = async ({
  browser,
  browserVersion,
  run,
  preset,
}: {
  browser: Browser;
  browserVersion: string;
  run: number;
  preset: FoundryColdPreset;
}): Promise<FoundryColdDiagnosticRun> => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 2,
  });
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();
  const client = await installChromebookAuditIsolation(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
    await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
    await openWavingArm(page);
    await configurePreset(page, preset);
    await applyChromebookEmulation(page, client, { deviceScaleFactor: 2 });
    await openSettledPathAndWaitForFoundryPreload(page);
    await installFoundryColdMountProbe(page);
    await page.getByTestId("workflow-stage-foundry").click();
    await waitForCompleteFoundryMount(page);
    const raw = await finishFoundryColdMountProbe(page);
    await collectChromebookRuntimeEnvironment(
      page,
      browserVersion,
      "feature-action",
      { expectedDeviceScaleFactor: 2 },
    );
    return completeFoundryColdDiagnosticRun(raw, { run, preset, pageErrors });
  } finally {
    await client.detach().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
};

test.describe("Chromebook cold Foundry causal diagnostic", () => {
  test.skip(
    !ENABLED,
    "run explicitly against the production preview with CPU4/DPR2",
  );

  test("counterbalanced fresh contexts preserve the 50ms Long Task gate", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(0);
    expect(
      CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottlingRate,
      "the focused diagnostic is calibrated only for the regression-4x profile",
    ).toBe(4);
    const runs: FoundryColdDiagnosticRun[] = [];
    for (let run = 1; run <= RUN_COUNT; run += 1) {
      runs.push(await runColdMount({
        browser,
        browserVersion: browser.version(),
        run,
        preset: foundryColdPresetForRun(run),
      }));
    }
    const summary = summarizeFoundryColdRuns(runs);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== "string") {
      throw new Error("Foundry cold diagnostic requires a production preview URL");
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      productionBuild: true,
      actualChromebookTested: false,
      provenance: await collectChromebookAuditProvenance(baseURL),
      matrix: {
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 2,
        cpuThrottlingRate: 4,
        cpuThrottleScope:
          CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottleDisclosure,
        network: CHROMEBOOK_AUDIT_PROFILE.environment.network,
        runCount: RUN_COUNT,
        order: runs.map((run) => run.preset),
        freshContextPerRun: true,
        authoritativeMemoryProbes: "not-run-by-design",
      },
      threshold: { maximumLongTaskMs: FOUNDRY_COLD_LONG_TASK_LIMIT_MS },
      summary,
      runs,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, json, "utf8");
    const attachment = testInfo.outputPath("foundry-cold-diagnostic.json");
    await writeFile(attachment, json, "utf8");
    await testInfo.attach("foundry-cold-diagnostic", {
      path: attachment,
      contentType: "application/json",
    });

    expect(summary.markerCoverage, "every causal mount marker is present").toBe(true);
    expect(summary.noMemoryProbeOverlap, "the short diagnostic runs no UASM").toBe(true);
    expect(summary.noPageErrors, "cold Foundry produces no page errors").toBe(true);
    expect(summary.noContextLoss, "cold Foundry keeps its WebGL context").toBe(true);
    expect(
      summary.maximumLongTaskMs,
      `cold Foundry Long Task max remains <=${FOUNDRY_COLD_LONG_TASK_LIMIT_MS}ms`,
    ).toBeLessThanOrEqual(FOUNDRY_COLD_LONG_TASK_LIMIT_MS);
  });
});

import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  percentiles,
} from "./chromebookAuditReport";
import {
  applyChromebookEmulation,
  collectStableFeatureProbe,
  installChromebookAuditInstrumentation,
  measureClickToNextPaint,
  readFeatureRuntimeProbe,
} from "./chromebookAuditHarness";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const OUTPUT = process.env.CHROMEBOOK_STAGE_AUDIT_OUTPUT ?? join(
  process.cwd(),
  "artifacts/chromebook-audit/stages/chromebook-stage-switch-audit.json",
);

type StageName =
  | "Character"
  | "Path"
  | "Foundry"
  | "Design"
  | "Blueprint"
  | "Assembly"
  | "Options";

type StageSample = {
  cycle: number;
  from: StageName;
  to: StageName;
  nextPaintMs: number;
  readyMs: number;
  longTasksMs: number[];
  liveResources: number;
  contextsCreated: number;
  geometryCacheSize: number;
  materialCacheSize: number;
};

const stageId: Record<StageName, string> = {
  Character: "character",
  Path: "path",
  Foundry: "foundry",
  Design: "design",
  Blueprint: "blueprint",
  Assembly: "assembly",
  Options: "options",
};

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Character" })).toBeVisible();
  await expect(page.locator("canvas.three-puppet-canvas")).toBeVisible();
};

const readStageProbe = (page: Page) => page.evaluate(() => {
  type Resource = { created: number; deleted: number; live: number; peakLive: number };
  type Audit = {
    longTasks: number[];
    foundryGeometryCacheSize?: number;
    foundryMaterialCacheSize?: number;
    webgl: {
      contextsCreated: number;
      contextsLost: number;
      contextsRestored: number;
      resources: Record<string, Resource>;
    };
  };
  const audit = (window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: Audit;
  }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  const resources = structuredClone(audit?.webgl.resources ?? {});
  return {
    atMs: performance.now(),
    longTasks: [...(audit?.longTasks ?? [])],
    contextsCreated: audit?.webgl.contextsCreated ?? 0,
    contextsLost: audit?.webgl.contextsLost ?? 0,
    contextsRestored: audit?.webgl.contextsRestored ?? 0,
    attachedCanvases: document.querySelectorAll("canvas").length,
    geometryCacheSize: audit?.foundryGeometryCacheSize ?? 0,
    materialCacheSize: audit?.foundryMaterialCacheSize ?? 0,
    resources,
    liveResources: Object.values(resources).reduce(
      (sum, resource) => sum + resource.live,
      0,
    ),
  };
});

test.describe("Chromebook stage-switch audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

  test("all classroom stages keep cold response and warm ownership bounded", async ({
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
    page.on("pageerror", (error) => pageErrors.push(error.message));
    let client: CDPSession | undefined;

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#boot-loader")).toHaveCount(0, {
        timeout: 180_000,
      });
      expect(await page.locator('script[src*="/@vite/client"]').count()).toBe(0);
      await openWavingArm(page);
      client = await applyChromebookEmulation(page);
      await expect.poll(
        async () => (await readFeatureRuntimeProbe(page)).lifecycle.workers.active,
        { message: "fixture autosave worker settles before the stage baseline" },
      ).toBe(0);
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const initialRuntime = await collectStableFeatureProbe(page, client);
      const initial = await readStageProbe(page);
      let current: StageName = "Character";
      let longTaskOffset = initial.longTasks.length;
      const coldSequence: StageName[] = [
        "Path",
        "Foundry",
        "Design",
        "Blueprint",
        "Assembly",
        "Character",
        "Options",
      ];
      const warmSequence: StageName[] = [
        "Character",
        "Path",
        "Foundry",
        "Design",
        "Blueprint",
        "Assembly",
        "Options",
      ];
      const runCycles = async (
        sequence: StageName[],
        firstCycle: number,
        count: number,
        target: StageSample[],
      ) => {
        for (let cycle = firstCycle; cycle < firstCycle + count; cycle += 1) {
        for (const next of sequence) {
          const button = page.getByTestId(`workflow-stage-${stageId[next]}`);
          const timing = await measureClickToNextPaint(button);
          await expect(page.locator(`[data-stage="${stageId[next]}"]`))
            .toBeVisible();
          await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }));
          const ready = await readStageProbe(page);
          target.push({
            cycle,
            from: current,
            to: next,
            nextPaintMs: timing.nextPaintMs,
            readyMs: ready.atMs - timing.startedAt,
            longTasksMs: ready.longTasks.slice(longTaskOffset),
            liveResources: ready.liveResources,
            contextsCreated: ready.contextsCreated,
            geometryCacheSize: ready.geometryCacheSize,
            materialCacheSize: ready.materialCacheSize,
          });
          longTaskOffset = ready.longTasks.length;
          current = next;
        }
        }
      };

      const coldSamples: StageSample[] = [];
      await runCycles(coldSequence, 0, 1, coldSamples);
      const warmRuntime = await collectStableFeatureProbe(page, client);
      const warmBaseline = await readStageProbe(page);
      longTaskOffset = warmBaseline.longTasks.length;

      const samples: StageSample[] = [];
      await runCycles(warmSequence, 1, 3, samples);

      const finalRuntime = await collectStableFeatureProbe(page, client);
      const final = await readStageProbe(page);
      const coldNextPaint = percentiles(
        coldSamples.map((sample) => sample.nextPaintMs),
      );
      const coldReady = percentiles(coldSamples.map((sample) => sample.readyMs));
      const coldLongTaskDurations = coldSamples.flatMap(
        (sample) => sample.longTasksMs,
      );
      const coldLongTasks = percentiles(coldLongTaskDurations);
      const coldLongTaskMax = Math.max(0, ...coldLongTaskDurations);
      const nextPaint = percentiles(samples.map((sample) => sample.nextPaintMs));
      const ready = percentiles(samples.map((sample) => sample.readyMs));
      const longTasks = percentiles(samples.flatMap((sample) => sample.longTasksMs));
      const warmCycleEndLiveResources = samples
        .filter((sample) => sample.to === "Options")
        .map((sample) => sample.liveResources);
      const firstWarmCycleLiveResources =
        warmCycleEndLiveResources[0] ?? warmBaseline.liveResources;
      const lastWarmCycleLiveResources =
        warmCycleEndLiveResources.at(-1) ?? final.liveResources;
      const baselineHeap = initialRuntime.heapBytes ?? 0;
      const finalHeap = finalRuntime.heapBytes ?? baselineHeap;
      const heapAllowance = Math.max(
        CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
        baselineHeap * CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
      );
      const checks = {
        coldNextPaintP95:
          coldNextPaint.p95 <= CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
        coldReadyP95:
          coldReady.p95 <= CHROMEBOOK_ACCEPTANCE_THRESHOLDS.tabSwitchP95Ms,
        coldLongTaskMax: coldLongTaskMax <= 100,
        nextPaintP95: nextPaint.p95 <= CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
        readyP95: ready.p95 <= CHROMEBOOK_ACCEPTANCE_THRESHOLDS.tabSwitchP95Ms,
        longTaskP95: longTasks.p95 <= 50,
        heapGrowth: finalHeap - baselineHeap <= heapAllowance,
        workersReturned:
          finalRuntime.lifecycle.workers.active === warmRuntime.lifecycle.workers.active,
        canvasesReturned:
          final.attachedCanvases === warmBaseline.attachedCanvases,
        resourcesReturned:
          final.liveResources <= firstWarmCycleLiveResources,
        resourcePlateau:
          lastWarmCycleLiveResources <= firstWarmCycleLiveResources,
        contextCountStable: final.contextsCreated === initial.contextsCreated,
        noContextLoss: final.contextsLost === initial.contextsLost,
      };
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        resultLabel: "6x CPU emulation",
        productionBuild: true,
        actualChromebookTested: false,
        environment: CHROMEBOOK_AUDIT_ENVIRONMENT,
        coldCycles: 1,
        measuredCycles: 3,
        coldSamples,
        samples,
        coldLatencyMs: {
          nextPaint: coldNextPaint,
          ready: coldReady,
          longTasks: coldLongTasks,
          longTaskMax: coldLongTaskMax,
        },
        latencyMs: { nextPaint, ready, longTasks },
        heap: {
          baselineBytes: baselineHeap,
          finalBytes: finalHeap,
          growthBytes: finalHeap - baselineHeap,
          allowedGrowthBytes: heapAllowance,
          finalSamplesBytes: finalRuntime.heapSamplesBytes ?? [],
        },
        runtime: {
          initial: initialRuntime.lifecycle,
          warmBaseline: warmRuntime.lifecycle,
          final: finalRuntime.lifecycle,
        },
        webgl: {
          initial,
          warmBaseline,
          final,
          contextDelta: final.contextsCreated - initial.contextsCreated,
          cacheWarmupLiveResourceDelta:
            warmBaseline.liveResources - initial.liveResources,
          warmLiveResourceDelta:
            final.liveResources - warmBaseline.liveResources,
          warmCycleEndLiveResources,
          warmCyclePlateauDelta:
            lastWarmCycleLiveResources - firstWarmCycleLiveResources,
        },
        checks,
        acceptance: Object.values(checks).every(Boolean),
      };
      const json = `${JSON.stringify(report, null, 2)}\n`;
      const testOutput = testInfo.outputPath("chromebook-stage-switch-audit.json");
      await writeFile(testOutput, json, "utf8");
      await testInfo.attach("chromebook-stage-switch-audit", {
        path: testOutput,
        contentType: "application/json",
      });
      await mkdir(dirname(OUTPUT), { recursive: true });
      await writeFile(OUTPUT, json, "utf8");

      expect(pageErrors).toEqual([]);
      if (ENFORCE) {
        for (const [name, passed] of Object.entries(checks)) {
          expect(passed, `${name} failed; inspect the stage audit artifact`).toBe(true);
        }
      }
    } finally {
      await client?.detach().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });
});

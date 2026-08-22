import {
  expect,
  test,
  type Browser,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import {
  CHROMEBOOK_ACCEPTANCE_THRESHOLDS,
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  percentiles,
  type ChromebookRuntimeEnvironment,
} from "./chromebookAuditReport";
import {
  applyChromebookEmulation,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
} from "./chromebookAuditHarness";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const OUTPUT = process.env.CHROMEBOOK_ENTRY_AUDIT_OUTPUT ?? join(
  process.cwd(),
  "artifacts/chromebook-audit/entry/chromebook-classroom-entry-audit.json",
);

const boundedSampleCount = (value: string | undefined) => {
  const parsed = Number(value ?? 20);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("CHROMEBOOK_ENTRY_SAMPLES must be an integer from 1 to 100");
  }
  return parsed;
};

const SAMPLE_COUNT = boundedSampleCount(process.env.CHROMEBOOK_ENTRY_SAMPLES);

type TrustedClickTiming = {
  sequence: number;
  startedAt: number;
  eventTaskEndMs?: number;
  firstRafMs: number;
  nextPaintMs: number;
  trusted: boolean;
};

type EntryActionSample = {
  action: "starter" | "guide" | "lesson";
  sample: number;
  cacheScope: "fresh-browser-context" | "same-context-after-guide";
  click: TrustedClickTiming;
  interactiveReadyMs: number;
  longTasks: Array<{
    startTime: number;
    duration: number;
    overlapMs: number;
  }>;
};

type EntryAuditWindow = Window & {
  __MOTIONSMITH_ENTRY_CLICK__?: Partial<TrustedClickTiming>;
  __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
    longTaskEntries: Array<{ startTime: number; duration: number }>;
  };
};

const measureTrustedClickToNextPaint = async (
  control: Locator,
): Promise<TrustedClickTiming> => {
  await expect(control, "entry action is visible before timing").toBeVisible();
  await expect(control, "entry action is enabled before timing").toBeEnabled();
  const sequence = await control.evaluate((element) => {
    const host = window as EntryAuditWindow;
    const next = (host.__MOTIONSMITH_ENTRY_CLICK__?.sequence ?? 0) + 1;
    host.__MOTIONSMITH_ENTRY_CLICK__ = { sequence: next };
    element.addEventListener("click", (event) => {
      const startedAt = performance.now();
      host.__MOTIONSMITH_ENTRY_CLICK__ = {
        sequence: next,
        startedAt,
        trusted: event.isTrusted,
      };
      queueMicrotask(() => {
        const current = host.__MOTIONSMITH_ENTRY_CLICK__;
        if (current?.sequence === next) {
          current.eventTaskEndMs = performance.now() - startedAt;
        }
      });
      requestAnimationFrame(() => {
        const current = host.__MOTIONSMITH_ENTRY_CLICK__;
        if (current?.sequence !== next) return;
        current.firstRafMs = performance.now() - startedAt;
        requestAnimationFrame(() => {
          const latest = host.__MOTIONSMITH_ENTRY_CLICK__;
          if (latest?.sequence === next) {
            latest.nextPaintMs = performance.now() - startedAt;
          }
        });
      });
    }, { capture: true, once: true });
    return next;
  });
  await control.click();
  await expect.poll(() => control.page().evaluate((expected) => {
    const timing = (window as EntryAuditWindow).__MOTIONSMITH_ENTRY_CLICK__;
    return timing?.sequence === expected ? timing.nextPaintMs : undefined;
  }, sequence), { message: "trusted click reaches its second paint boundary" })
    .not.toBeUndefined();
  return control.page().evaluate((expected) => {
    const timing = (window as EntryAuditWindow).__MOTIONSMITH_ENTRY_CLICK__;
    if (
      timing?.sequence !== expected ||
      timing.startedAt === undefined ||
      timing.firstRafMs === undefined ||
      timing.nextPaintMs === undefined ||
      timing.trusted === undefined
    ) throw new Error("Trusted entry click timing was not delivered");
    return timing as TrustedClickTiming;
  }, sequence);
};

const waitForCharacterRendererBoundary = async (page: Page) => {
  const preview = page.getByTestId("character-three-puppet");
  const state = page.getByTestId("character-three-puppet-state");
  await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
  await expect(state).toHaveAttribute("data-three-topology-ready", "true");
  await expect(state).toHaveAttribute(
    "data-three-pending-initial-scene-resources",
    "0",
  );
  await expect(state).toHaveAttribute(
    "data-three-render-submissions",
    /^[1-9]\d*$/,
  );
  await expect(preview.locator("canvas.three-puppet-canvas")).toBeVisible();
};

const finishEntryAction = async (
  page: Page,
  input: Omit<EntryActionSample, "interactiveReadyMs" | "longTasks">,
  ready: () => Promise<unknown>,
): Promise<EntryActionSample> => {
  await ready();
  const readyAt = await page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => resolve(performance.now()));
  }));
  const longTasks = await page.evaluate(({ startedAt, readyAt }) => {
    const tasks = (window as EntryAuditWindow)
      .__MOTIONSMITH_CHROMEBOOK_AUDIT__?.longTaskEntries ?? [];
    return tasks.filter((task) =>
      task.startTime < readyAt && task.startTime + task.duration > startedAt
    ).map((task) => ({
      ...task,
      overlapMs: Math.max(
        0,
        Math.min(readyAt, task.startTime + task.duration) -
          Math.max(startedAt, task.startTime),
      ),
    }));
  }, { startedAt: input.click.startedAt, readyAt });
  return {
    ...input,
    interactiveReadyMs: readyAt - input.click.startedAt,
    longTasks,
  };
};

const openThrottledPage = async (browser: Browser) => {
  const context = await browser.newContext({
    viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    deviceScaleFactor: CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
  });
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();
  const client = await applyChromebookEmulation(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  expect(await page.locator('script[src*="/@vite/client"]').count()).toBe(0);
  return { context, page, client };
};

const outputPath = () => extname(OUTPUT).toLowerCase() === ".json"
  ? OUTPUT
  : join(OUTPUT, "chromebook-classroom-entry-audit.json");

test.describe("Classroom entry performance", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against production preview");

  test(`starter and Guide are interactive at ${CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate}x CPU`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const samples: EntryActionSample[] = [];
    let runtimeEnvironment: ChromebookRuntimeEnvironment | undefined;

    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const starter = await openThrottledPage(browser);
      try {
        expect(
          await starter.page.locator("canvas").count(),
          "Getting Started keeps WebGL unmounted",
        ).toBe(0);
        const starterButton = starter.page.getByTestId(
          "getting-started-card-humanoid",
        );
        const click = await measureTrustedClickToNextPaint(starterButton);
        samples.push(await finishEntryAction(starter.page, {
          action: "starter",
          sample,
          cacheScope: "fresh-browser-context",
          click,
        }, async () => {
          await expect(starter.page.getByTestId("character-screen")).toBeVisible();
          await expect(starter.page.getByTestId("character-part-list")).toBeVisible();
          await expect(starter.page.getByTestId("workflow-stage-path")).toBeEnabled();
          await waitForCharacterRendererBoundary(starter.page);
        }));
      } finally {
        await starter.client.detach().catch(() => undefined);
        await starter.context.close().catch(() => undefined);
      }

      const guide = await openThrottledPage(browser);
      try {
        const guideButton = guide.page.getByTestId("getting-started-card-guided");
        const guideClick = await measureTrustedClickToNextPaint(guideButton);
        samples.push(await finishEntryAction(guide.page, {
          action: "guide",
          sample,
          cacheScope: "fresh-browser-context",
          click: guideClick,
        }, async () => {
          await expect(guide.page.getByTestId("guided-project-library"))
            .toBeVisible();
          await expect(guide.page.getByTestId("guided-project-card-waving-arm"))
            .toBeEnabled();
        }));

        const lessonButton = guide.page.getByTestId(
          "guided-project-card-waving-arm",
        );
        const lessonClick = await measureTrustedClickToNextPaint(lessonButton);
        samples.push(await finishEntryAction(guide.page, {
          action: "lesson",
          sample,
          cacheScope: "same-context-after-guide",
          click: lessonClick,
        }, async () => {
          await expect(guide.page.getByTestId("character-screen")).toBeVisible();
          await expect(guide.page.getByTestId("character-make-it-yours"))
            .toBeVisible();
          await expect(guide.page.getByTestId("workflow-stage-path")).toBeEnabled();
          await waitForCharacterRendererBoundary(guide.page);
        }));
        runtimeEnvironment = await collectChromebookRuntimeEnvironment(
          guide.page,
          browser.version(),
          "navigation-and-action",
        );
      } finally {
        await guide.client.detach().catch(() => undefined);
        await guide.context.close().catch(() => undefined);
      }
    }

    if (!runtimeEnvironment) {
      throw new Error("Classroom entry did not collect a runtime environment");
    }
    const actionReport = Object.fromEntries(
      (["starter", "guide", "lesson"] as const).map((action) => {
        const actionSamples = samples.filter((sample) => sample.action === action);
        const longTasks = actionSamples.flatMap((sample) => sample.longTasks);
        return [action, {
          sampleCount: actionSamples.length,
          clickToNextPaintMs: percentiles(
            actionSamples.map((sample) => sample.click.nextPaintMs),
          ),
          interactiveReadyMs: percentiles(
            actionSamples.map((sample) => sample.interactiveReadyMs),
          ),
          trustedClicks: actionSamples.filter((sample) => sample.click.trusted).length,
          longTaskCount: longTasks.length,
          longTaskMaxMs: Math.max(0, ...longTasks.map((task) => task.duration)),
        }];
      }),
    );
    const checks = Object.fromEntries(
      Object.entries(actionReport).flatMap(([action, report]) => [
        [`${action}NextPaintP95`, {
          passed:
            report.clickToNextPaintMs.p95 <=
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
          observed: report.clickToNextPaintMs.p95,
          limit: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.interactionP95Ms,
        }],
        [`${action}InteractiveReadyP95`, {
          passed:
            report.interactiveReadyMs.p95 <=
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.tabSwitchP95Ms,
          observed: report.interactiveReadyMs.p95,
          limit: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.tabSwitchP95Ms,
        }],
        [`${action}TrustedClicks`, {
          passed: report.trustedClicks === report.sampleCount,
          observed: report.trustedClicks,
          limit: report.sampleCount,
        }],
        [`${action}LongTaskMax`, {
          passed:
            report.longTaskMaxMs <=
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.mainThreadLongTaskMaxMs,
          observed: report.longTaskMaxMs,
          limit: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.mainThreadLongTaskMaxMs,
        }],
      ]),
    );
    const passed = Object.values(checks).every((check) => check.passed);
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== "string") {
      throw new Error("Classroom entry audit requires a preview base URL");
    }
    const report = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      profile: CHROMEBOOK_AUDIT_PROFILE.name,
      resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
      productionBuild: true,
      actualChromebookTested: false,
      provenance: await collectChromebookAuditProvenance(baseURL),
      environment: runtimeEnvironment,
      coldSampleCount: SAMPLE_COUNT,
      coldIsolation: "fresh-browser-context",
      samples,
      actions: actionReport,
      checks,
      acceptance: { passed },
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const testOutput = testInfo.outputPath(
      "chromebook-classroom-entry-audit.json",
    );
    await writeFile(testOutput, json, "utf8");
    await testInfo.attach("chromebook-classroom-entry-audit", {
      path: testOutput,
      contentType: "application/json",
    });
    const externalOutput = outputPath();
    await mkdir(dirname(externalOutput), { recursive: true });
    await writeFile(externalOutput, json, "utf8");

    if (ENFORCE) {
      for (const [name, check] of Object.entries(checks)) {
        expect(
          check.passed,
          `${name}: observed ${check.observed}, limit ${check.limit}`,
        ).toBe(true);
      }
    }
  });
});

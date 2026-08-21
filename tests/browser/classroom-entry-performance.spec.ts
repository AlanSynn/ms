import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { percentiles } from "./chromebookAuditReport";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const SAMPLE_COUNT = 3;

type EntryTiming = {
  startedAt: number;
  insertedAt: number;
  responseMs: number;
};

const armDomResponse = async (
  page: Page,
  trigger: Locator,
  selector: string,
) => {
  await trigger.evaluate((element, responseSelector) => {
    const host = window as Window & {
      __MOTIONSMITH_ENTRY_TIMING__?: EntryTiming;
    };
    const timing: EntryTiming = {
      startedAt: 0,
      insertedAt: 0,
      responseMs: 0,
    };
    host.__MOTIONSMITH_ENTRY_TIMING__ = timing;
    const observe = new MutationObserver(() => {
      if (!timing.startedAt || timing.insertedAt) return;
      if (!document.querySelector(responseSelector)) return;
      timing.insertedAt = performance.now();
      timing.responseMs = timing.insertedAt - timing.startedAt;
      observe.disconnect();
    });
    observe.observe(document.body, { childList: true, subtree: true });
    element.addEventListener("click", () => {
      timing.startedAt = performance.now();
    }, { once: true });
  }, selector);
};

const readDomResponse = async (page: Page) => {
  await expect.poll(() => page.evaluate(() =>
    (window as Window & {
      __MOTIONSMITH_ENTRY_TIMING__?: EntryTiming;
    }).__MOTIONSMITH_ENTRY_TIMING__?.responseMs ?? 0,
  ), { message: "classroom action commits its next screen" }).toBeGreaterThan(0);
  return page.evaluate(() =>
    (window as Window & {
      __MOTIONSMITH_ENTRY_TIMING__?: EntryTiming;
    }).__MOTIONSMITH_ENTRY_TIMING__!,
  );
};

const openThrottledPage = async (browser: Browser) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const host = window as Window & {
      __MOTIONSMITH_ENTRY_LONG_TASKS__?: Array<{
        startTime: number;
        duration: number;
      }>;
    };
    host.__MOTIONSMITH_ENTRY_LONG_TASKS__ = [];
    new PerformanceObserver((list) => {
      host.__MOTIONSMITH_ENTRY_LONG_TASKS__?.push(
        ...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      );
    }).observe({ type: "longtask", buffered: true });
  });
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto("/");
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  return { context, page };
};

const blockingTasksBeforeResponse = (page: Page, timing: EntryTiming) =>
  page.evaluate(({ startedAt, insertedAt }) => {
    const tasks = (window as Window & {
      __MOTIONSMITH_ENTRY_LONG_TASKS__?: Array<{
        startTime: number;
        duration: number;
      }>;
    }).__MOTIONSMITH_ENTRY_LONG_TASKS__ ?? [];
    return tasks.filter((task) =>
      task.startTime < insertedAt && task.startTime + task.duration > startedAt,
    );
  }, timing);

test.describe("Classroom entry performance", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against production preview");

  test("starter and Guide screens respond within 100ms at 6x CPU", async ({ browser }, testInfo) => {
    const starterMs: number[] = [];
    const guideMs: number[] = [];
    const lessonMs: number[] = [];
    const blockingTasks: Array<{ action: string; duration: number }> = [];

    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const starter = await openThrottledPage(browser);
      expect(await starter.page.locator("canvas").count(), "Getting Started keeps WebGL unmounted").toBe(0);
      const starterButton = starter.page.getByTestId("getting-started-card-humanoid");
      await armDomResponse(starter.page, starterButton, '[data-testid="character-screen"]');
      await starterButton.click();
      const starterTiming = await readDomResponse(starter.page);
      starterMs.push(starterTiming.responseMs);
      blockingTasks.push(...(await blockingTasksBeforeResponse(starter.page, starterTiming))
        .map((task) => ({ action: "starter", duration: task.duration })));
      await starter.context.close();

      const guide = await openThrottledPage(browser);
      const guideButton = guide.page.getByTestId("getting-started-card-guided");
      await armDomResponse(guide.page, guideButton, '[data-testid="guided-project-library"]');
      await guideButton.click();
      const guideTiming = await readDomResponse(guide.page);
      guideMs.push(guideTiming.responseMs);
      blockingTasks.push(...(await blockingTasksBeforeResponse(guide.page, guideTiming))
        .map((task) => ({ action: "guide", duration: task.duration })));

      const lessonButton = guide.page.getByTestId("guided-project-card-waving-arm");
      await armDomResponse(guide.page, lessonButton, '[data-testid="character-screen"]');
      await lessonButton.click();
      const lessonTiming = await readDomResponse(guide.page);
      lessonMs.push(lessonTiming.responseMs);
      blockingTasks.push(...(await blockingTasksBeforeResponse(guide.page, lessonTiming))
        .map((task) => ({ action: "lesson", duration: task.duration })));
      await guide.context.close();
    }

    const report = {
      environment: {
        viewport: "1366x768",
        deviceScaleFactor: 1,
        mainThreadCpuThrottle: 6,
      },
      starter: percentiles(starterMs),
      guide: percentiles(guideMs),
      lesson: percentiles(lessonMs),
      blockingTasks,
    };
    await testInfo.attach("classroom-entry-performance.json", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json",
    });

    expect(report.starter.p95).toBeLessThanOrEqual(100);
    expect(report.guide.p95).toBeLessThanOrEqual(100);
    expect(report.lesson.p95).toBeLessThanOrEqual(100);
    expect(blockingTasks).toEqual([]);
  });
});

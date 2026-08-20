import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSampleProject } from "../../utils/project";

import {
  buildChromebookFeatureAudit,
  type FeatureActionAudit,
  type FeatureAudit,
  type FeatureRuntimeProbe,
} from "./chromebookFeatureAuditReport";
import { runChromebookFeatureAudit } from "./chromebookFeatureAuditRunner";
import {
  collectStableFeatureProbe,
  elapsedFeatureTime,
  finishFeatureAction,
  measureClickToNextPaint,
  measureExternalActionToNextPaint,
  readFeatureRuntimeProbe,
  waitForLifecycleBaseline,
} from "./chromebookAuditHarness";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const REAL_AI = process.env.CHROMEBOOK_AUDIT_REAL_AI === "1";
const GIF_FIXTURE = join(process.cwd(), "ref/animation.gif");
const IMAGE_FIXTURE = join(process.cwd(), "tests/fixtures/stick-character.png");
const TEST_TEXTURE = `data:image/png;base64,${readFileSync(IMAGE_FIXTURE).toString("base64")}`;

const setupDeterministicAiWorker = async (page: Page) => {
  const project = createSampleProject();
  if (!project.skeleton) throw new Error("sample project requires a skeleton");
  const result = {
    skeleton: project.skeleton,
    parts: project.partOrder.map((partId) => ({
      ...project.parts[partId],
      textureUrl: TEST_TEXTURE,
      maskUrl: TEST_TEXTURE,
    })),
    textureUrl: TEST_TEXTURE,
    maskUrl: TEST_TEXTURE,
    keypoints: [],
  };
  const resultUrl = "/__motionsmith_audit__/web-onnx-result.json";
  const body = `
const timeline = [
  ['decode-image', 2],
  ['segment-character', 10],
  ['downloading-model', 12],
  ['downloading-model', 22],
  ['loading-model', 35],
  ['running-onnx', 45],
  ['extracting-keypoints', 70],
  ['extracting-parts', 75],
  ['normalizing', 90],
];
self.onmessage = async ({ data }) => {
  const result = await fetch(${JSON.stringify(resultUrl)}).then((response) => response.json());
  timeline.forEach(([stage, progress], index) => setTimeout(() => {
    self.postMessage({ type: 'progress', generationId: data.generationId, stage, progress });
  }, index * 20));
  setTimeout(() => self.postMessage({
    type: 'result',
    generationId: data.generationId,
    result,
  }), timeline.length * 20 + 20);
};`;
  await page.route(`**${resultUrl}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(result),
  }));
  await page.route(/\/assets\/webOnnxInferenceWorker-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body }));
};

const stageButton = (page: Page, name: "Character" | "Path" | "Design") => {
  const names = {
    Character: /^Character$/i,
    Path: /^Path Editor$/i,
    Design: /Mechanism Design|Design/i,
  } as const;
  return page
    .getByTestId("workspace-steps")
    .getByRole("button", { name: names[name] });
};

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("character-screen")).toBeVisible();
};

const goToStage = async (
  page: Page,
  name: "Character" | "Path" | "Design",
) => {
  await stageButton(page, name).click();
  const ready = name === "Character"
    ? page.getByRole("heading", { name: "Character" })
    : name === "Path"
      ? page.getByRole("heading", { name: "Path Editor" })
      : page.getByRole("heading", { name: "Mechanism Design" });
  await expect(ready).toBeVisible();
  if (name === "Design") {
    await expect(page.getByRole("button", { name: /Recommend/i }))
      .toHaveAttribute("data-recommendation-worker-prepared", "true");
    await expect(page.getByRole("button", { name: "Fit", exact: true }))
      .toHaveAttribute("data-optimizer-worker-prepared", "true");
  }
};

const workerActive = async (page: Page) =>
  (await readFeatureRuntimeProbe(page)).lifecycle.workers.active;

const stableProbe = async (
  page: Page,
  client: CDPSession,
) => collectStableFeatureProbe(page, client);

const finalProbe = async (
  page: Page,
  client: CDPSession,
  baseline: FeatureRuntimeProbe,
) => {
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  return stableProbe(page, client);
};

const auditRecommend = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];
  const recommend = page.getByRole("button", { name: /Recommend/i });
  const cancelledSheet = page.getByTestId("recommendation-sheet");

  await cancelledSheet.evaluate((sheet) => {
    const close = Array.from(sheet.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Close",
    );
    if (!(close instanceof HTMLButtonElement)) {
      throw new Error("Recommendation Close button is unavailable.");
    }
    const cancelWhenDispatched = () => {
      if (sheet.getAttribute("data-recommendation-worker-request") !== "active") {
        return;
      }
      observer.disconnect();
      sheet.setAttribute("data-audit-cancelled-on-dispatch", "true");
      close.click();
    };
    const observer = new MutationObserver(cancelWhenDispatched);
    observer.observe(sheet, {
      attributes: true,
      attributeFilter: ["data-recommendation-worker-request"],
    });
    cancelWhenDispatched();
  });

  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledTiming = await measureClickToNextPaint(recommend);
  await expect(cancelledSheet).toHaveAttribute(
    "data-audit-cancelled-on-dispatch",
    "true",
  );
  await expect(cancelledSheet).toBeHidden();
  expect(await workerActive(page)).toBeLessThanOrEqual(
    baseline.lifecycle.workers.active,
  );
  actions.push(await finishFeatureAction(page, {
    label: "recommend-cancel",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureClickToNextPaint(recommend);
  const completedSheet = page.getByTestId("recommendation-sheet");
  await expect(completedSheet).toBeVisible();
  await expect(completedSheet).toHaveAttribute(
    "data-recommendation-state",
    "ready",
    { timeout: 120_000 },
  );
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await expect(page.getByTestId("recommendation-card-4bar")).toBeVisible();
  await completedSheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(completedSheet).toBeHidden();
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "recommend-complete",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  const final = await finalProbe(page, client, baseline);
  return buildChromebookFeatureAudit("recommend", actions, baseline, final, {
    minimumWorkerCreations: 1,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  });
};

const auditDesignFit = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];
  const fit = page.getByTestId("design-fit-button");

  await page.evaluate(() => {
    window.addEventListener(
      "motionsmith:optimizer-worker-request",
      () => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="design-fit-button"]',
        );
        if (!button || button.textContent?.trim() !== "Cancel") {
          throw new Error("Design Fit cancel control is unavailable.");
        }
        button.setAttribute("data-audit-cancelled-on-dispatch", "true");
        button.click();
      },
      { once: true },
    );
  });

  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledTiming = await measureClickToNextPaint(fit);
  await expect(page.getByTestId("design-fit-button")).toHaveAttribute(
    "data-audit-cancelled-on-dispatch",
    "true",
  );
  await expect(fit).toBeEnabled();
  expect(await workerActive(page)).toBeLessThanOrEqual(
    baseline.lifecycle.workers.active,
  );
  actions.push(await finishFeatureAction(page, {
    label: "design-fit-cancel",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureClickToNextPaint(fit);
  await expect(fit).toBeEnabled({ timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("motionsmith.autosave") ?? "{}");
    return saved.mechanisms?.find(
      (mechanism: { id?: string }) => mechanism.id === saved.selectedMechanismId,
    )?.source;
  }), { message: "the completed optimizer result reaches canonical project state" })
    .toBe("optimized");
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "design-fit-complete",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  const final = await finalProbe(page, client, baseline);
  return buildChromebookFeatureAudit("designFit", actions, baseline, final, {
    minimumWorkerCreations: 1,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  });
};

const openTrace = async (page: Page) => {
  const panel = page.getByTestId("novice-path-panel");
  const more = panel.getByText("More", { exact: true });
  const detailsOpen = await more.evaluate(
    (element) => (element.parentElement as HTMLDetailsElement | null)?.open ?? false,
  );
  if (!detailsOpen) await more.click();
  await panel.getByRole("button", { name: "Trace", exact: true }).click();
  const modal = page.getByTestId("tracking-modal");
  await expect(modal).toBeVisible();
  return modal;
};

const auditTraceGif = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];

  const cancelledModal = await openTrace(page);
  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledInput = cancelledModal.locator('input[type="file"]');
  const cancelledTiming = await measureExternalActionToNextPaint(
    page,
    () => cancelledInput.setInputFiles(GIF_FIXTURE),
  );
  await expect.poll(() => workerActive(page), {
    message: "Trace owns its GIF decoder worker before close",
  }).toBeGreaterThan(baseline.lifecycle.workers.active);
  await cancelledModal.getByRole("button", { name: "Close trace" }).click();
  await expect(cancelledModal).toHaveCount(0);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "trace-gif-close-during-load",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const completedModal = await openTrace(page);
  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedInput = completedModal.locator('input[type="file"]');
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => completedInput.setInputFiles(GIF_FIXTURE),
  );
  await expect.poll(async () =>
    (await readFeatureRuntimeProbe(page)).lifecycle.imageBitmaps.active,
  { message: "Trace transfers one owned ImageBitmap to the editor" })
    .toBeGreaterThan(baseline.lifecycle.imageBitmaps.active);
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await expect(completedModal.locator("canvas")).toBeVisible();
  await completedModal.getByRole("button", { name: "Close trace" }).click();
  await expect(completedModal).toHaveCount(0);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "trace-gif-complete-close",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  const final = await finalProbe(page, client, baseline);
  return buildChromebookFeatureAudit("traceGif", actions, baseline, final, {
    minimumWorkerCreations: 2,
    minimumImageBitmapAcquisitions: 1,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  });
};

const auditAiImport = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  await expect(page.getByTestId("character-screen")).toBeVisible();
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];
  const onboardingInput = page.getByTestId("getting-started-onnx-input");
  const input = (await onboardingInput.count())
    ? onboardingInput
    : page.getByTestId("onnx-input");

  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledTiming = await measureExternalActionToNextPaint(
    page,
    () => input.setInputFiles(IMAGE_FIXTURE),
  );
  await expect.poll(() => workerActive(page), {
    message: "explicit AI import owns an inference worker before supersession",
  }).toBeGreaterThan(baseline.lifecycle.workers.active);

  const completedBefore = await readFeatureRuntimeProbe(page);
  const releasedBefore = completedBefore.lifecycle.workers.released;
  const repeatInput = page.getByTestId("onnx-input");
  await expect(repeatInput).toHaveCount(1);
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => repeatInput.setInputFiles(IMAGE_FIXTURE),
  );
  await expect.poll(async () =>
    (await readFeatureRuntimeProbe(page)).lifecycle.workers.released,
  { timeout: 120_000, message: "the superseded AI import terminates its worker" })
    .toBeGreaterThan(releasedBefore);
  actions.push(await finishFeatureAction(page, {
    label: "ai-import-superseded",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const review = page.getByTestId("character-import-review");
  const importOutcome = await page.waitForFunction(() => {
    if (document.querySelector('[data-testid="character-import-review"]')) {
      return { kind: "ready", message: "" };
    }
    const error = document.querySelector(
      '[data-testid="character-status-dock"] pre',
    );
    if (error?.textContent) {
      return { kind: "error", message: error.textContent };
    }
    return undefined;
  }, undefined, { timeout: 300_000 }).then((handle) => handle.jsonValue());
  if (!importOutcome) throw new Error("Explicit AI import produced no outcome");
  if (importOutcome.kind === "error") {
    throw new Error(`Explicit AI import failed: ${importOutcome.message}`);
  }
  await expect(review).toBeVisible();
  await expect(review.getByText("Ready", { exact: true })).toBeVisible();
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await expect.poll(async () =>
    (await readFeatureRuntimeProbe(page)).lifecycle.workers.active,
  { message: "completed inference releases its worker before review" })
    .toBe(baseline.lifecycle.workers.active);
  actions.push(await finishFeatureAction(page, {
    label: "ai-import-complete",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  const acceptBefore = await readFeatureRuntimeProbe(page);
  const acceptTiming = await measureClickToNextPaint(
    review.getByRole("button", { name: "Use it", exact: true }),
  );
  await expect(review).toHaveCount(0);
  await expect(page.getByTestId("character-three-puppet")).toHaveAttribute(
    "data-part-count",
    /[1-9]\d*/,
  );
  await expect.poll(async () =>
    (await readFeatureRuntimeProbe(page)).lifecycle.imageBitmaps.acquired,
  { message: "accepted artwork decodes outside HTML image tasks" })
    .toBeGreaterThan(baseline.lifecycle.imageBitmaps.acquired);
  actions.push(await finishFeatureAction(page, {
    label: "ai-import-accept",
    cycle: 3,
    outcome: "completed",
    timing: acceptTiming,
    before: acceptBefore,
  }));

  await page.getByTestId("top-command-bar").getByText("File", { exact: true }).click();
  const newProject = page.getByRole("button", { name: "New Project", exact: true });
  page.once("dialog", (dialog) => dialog.accept());
  const cleanupBefore = await readFeatureRuntimeProbe(page);
  const cleanupTiming = await measureClickToNextPaint(newProject);
  await expect(page.getByTestId("character-three-puppet")).toHaveAttribute(
    "data-part-count",
    "0",
  );
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "ai-import-release",
    cycle: 4,
    outcome: "completed",
    timing: cleanupTiming,
    before: cleanupBefore,
  }));

  const final = await finalProbe(page, client, baseline);
  return buildChromebookFeatureAudit("aiImport", actions, baseline, final, {
    minimumWorkerCreations: 2,
    minimumImageBitmapAcquisitions: 1,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  });
};

test.describe("Chromebook M3 feature audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");
  test.describe.configure({ mode: "serial" });

  test("Recommend returns worker ownership and heap to baseline", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "recommend",
      prepare: async (page) => {
        await openWavingArm(page);
        await goToStage(page, "Design");
      },
      audit: auditRecommend,
    });
  });

  test("Design Fit returns worker ownership and heap to baseline", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "designFit",
      prepare: async (page) => {
        await openWavingArm(page);
        await goToStage(page, "Design");
      },
      audit: auditDesignFit,
    });
  });

  test("Trace GIF closes workers, bitmaps, URLs, and heap", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "traceGif",
      prepare: async (page) => {
        await openWavingArm(page);
        await goToStage(page, "Path");
      },
      audit: auditTraceGif,
    });
  });

  test("explicit AI import supersedes cleanly and stabilizes heap", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "aiImport",
      setup: REAL_AI ? undefined : setupDeterministicAiWorker,
      workload: REAL_AI
        ? "production-feature"
        : "deterministic-ai-worker-boundary",
      audit: auditAiImport,
    });
  });
});

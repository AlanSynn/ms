import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { join } from "node:path";

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
import { readBrowserAutosaveProject } from "./autosaveIndexedDbProbe";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const GIF_FIXTURE = join(process.cwd(), "ref/animation.gif");
const VIDEO_FIXTURE = join(process.cwd(), "ref/vid.mp4");

const stageButton = (
  page: Page,
  name: "Character" | "Path" | "Foundry" | "Design",
) => {
  const names = {
    Character: /^Character$/i,
    Path: /^Path Editor$/i,
    Foundry: /Mechanism Foundry|Foundry/i,
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
  name: "Character" | "Path" | "Foundry" | "Design",
) => {
  await stageButton(page, name).click();
  const ready = name === "Character"
    ? page.getByRole("heading", { name: "Character" })
    : name === "Path"
      ? page.getByRole("heading", { name: "Path Editor" })
      : name === "Foundry"
        ? page.getByRole("heading", { name: "Foundry" })
      : page.getByRole("heading", { name: "Mechanism Design" });
  await expect(ready).toBeVisible();
  if (name === "Design") {
    await expect(page.getByRole("button", { name: /Recommend/i }))
      .toHaveAttribute("data-recommendation-worker", "on-demand");
    await expect(page.getByRole("button", { name: "Fit", exact: true }))
      .toHaveAttribute("data-optimizer-worker", "on-demand");
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

  await fit.evaluate((button) => {
    const fitButton = button as HTMLButtonElement;
    const cancelDispatchedFit = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; type?: string }>).detail;
      if (
        detail?.name !== "motionsmith-mechanism-optimizer" ||
        detail.type !== "optimize"
      ) return;
      window.removeEventListener(
        "motionsmith:chromebook-worker-request",
        cancelDispatchedFit,
      );
      const cancel = () => {
        if (fitButton.getAttribute("aria-busy") !== "true") {
          requestAnimationFrame(cancel);
          return;
        }
        fitButton.setAttribute("data-audit-cancelled-on-dispatch", "true");
        fitButton.click();
      };
      cancel();
    };
    window.addEventListener(
      "motionsmith:chromebook-worker-request",
      cancelDispatchedFit,
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
  await expect.poll(async () => {
    const saved = await readBrowserAutosaveProject(page);
    return saved?.mechanisms?.find(
      (mechanism: { id?: string }) => mechanism.id === saved?.selectedMechanismId,
    )?.source;
  }, { message: "the completed optimizer result reaches canonical project state" })
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
  await cancelledModal.evaluate((modal) => {
    const cancelOnDispatch = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type !== "load") return;
      window.removeEventListener(
        "motionsmith:chromebook-worker-request",
        cancelOnDispatch,
      );
      requestAnimationFrame(() => {
        document.documentElement.dataset.auditTraceCancelledOnDispatch = "true";
        (modal.querySelector(
          'button[aria-label="Close trace"]',
        ) as HTMLButtonElement | null)?.click();
      });
    };
    window.addEventListener(
      "motionsmith:chromebook-worker-request",
      cancelOnDispatch,
    );
  });
  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledInput = cancelledModal.locator('input[type="file"]');
  const cancelledTiming = await measureExternalActionToNextPaint(
    page,
    () => cancelledInput.setInputFiles(GIF_FIXTURE),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-audit-trace-cancelled-on-dispatch",
    "true",
  );
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

const auditTraceVideo = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];

  const cancelledModal = await openTrace(page);
  await cancelledModal.evaluate((modal) => {
    const cancelOnUrl = () => {
      window.removeEventListener(
        "motionsmith:chromebook-object-url-acquired",
        cancelOnUrl,
      );
      requestAnimationFrame(() => {
        document.documentElement.dataset.auditVideoCancelledOnUrl = "true";
        (modal.querySelector(
          'button[aria-label="Close trace"]',
        ) as HTMLButtonElement | null)?.click();
      });
    };
    window.addEventListener(
      "motionsmith:chromebook-object-url-acquired",
      cancelOnUrl,
    );
  });
  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledTiming = await measureExternalActionToNextPaint(
    page,
    () => cancelledModal.locator('input[type="file"]').setInputFiles(
      VIDEO_FIXTURE,
    ),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-audit-video-cancelled-on-url",
    "true",
  );
  await expect(cancelledModal).toHaveCount(0);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "trace-video-close-during-metadata",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const completedModal = await openTrace(page);
  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => completedModal.locator('input[type="file"]').setInputFiles(
      VIDEO_FIXTURE,
    ),
  );
  const timeline = completedModal.locator('input[type="range"]');
  await expect(timeline).toBeVisible();
  await expect(completedModal.locator("canvas")).toHaveAttribute("width", "800");
  await expect(completedModal.locator("canvas")).toHaveAttribute("height", "450");
  expect(Number(await timeline.getAttribute("max"))).toBeLessThan(180);
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  actions.push(await finishFeatureAction(page, {
    label: "trace-video-metadata-complete",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  const play = completedModal.getByTitle("Play");
  const frameLabel = completedModal.locator("span").filter({
    hasText: /^Frame \d+ \/ \d+$/,
  });
  const frameBefore = await frameLabel.textContent();
  const playbackBefore = await readFeatureRuntimeProbe(page);
  const playbackTiming = await measureClickToNextPaint(play);
  await expect.poll(() => frameLabel.textContent(), {
    message: "video playback advances a delivered media frame",
  }).not.toBe(frameBefore);
  await completedModal.getByTitle("Stop").click();
  await completedModal.getByRole("button", { name: "Close trace" }).click();
  await expect(completedModal).toHaveCount(0);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "trace-video-play-close",
    cycle: 3,
    outcome: "completed",
    timing: playbackTiming,
    before: playbackBefore,
  }));

  const final = await finalProbe(page, client, baseline);
  return buildChromebookFeatureAudit("traceVideo", actions, baseline, final, {
    minimumWorkerCreations: 0,
    minimumObjectUrlCreations: 2,
    requireCompletedCycle: true,
    requireCancelledCycle: true,
  });
};

const auditRapierDiagnostics = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const baseline = await stableProbe(page, client);
  const actions: FeatureActionAudit[] = [];
  const rig = page.getByTestId("foundry-camera-rig");
  const forces = page.getByTestId("foundry-toggle-forces");
  await expect(rig).toHaveAttribute("data-physics-kernel-runtime", "idle");

  const coldBefore = await readFeatureRuntimeProbe(page);
  const coldTiming = await measureClickToNextPaint(forces);
  await expect(rig).toHaveAttribute("data-physics-kernel-runtime", "ready", {
    timeout: 120_000,
  });
  await expect(rig).toHaveAttribute(
    "data-physics-kernel-version",
    /\d+\.\d+\.\d+/,
  );
  const jobCompletionMs = await elapsedFeatureTime(page, coldTiming);
  actions.push(await finishFeatureAction(page, {
    label: "rapier-diagnostics-cold-load",
    cycle: 1,
    outcome: "completed",
    timing: coldTiming,
    before: coldBefore,
    jobCompletionMs,
  }));

  const offBefore = await readFeatureRuntimeProbe(page);
  const offTiming = await measureClickToNextPaint(forces);
  await expect(forces).toHaveAttribute("aria-pressed", "false");
  actions.push(await finishFeatureAction(page, {
    label: "rapier-diagnostics-close",
    cycle: 2,
    outcome: "completed",
    timing: offTiming,
    before: offBefore,
  }));

  const warmBefore = await readFeatureRuntimeProbe(page);
  const warmTiming = await measureClickToNextPaint(forces);
  await expect(forces).toHaveAttribute("aria-pressed", "true");
  await expect(rig).toHaveAttribute("data-physics-kernel-runtime", "ready");
  actions.push(await finishFeatureAction(page, {
    label: "rapier-diagnostics-warm-repeat",
    cycle: 3,
    outcome: "completed",
    timing: warmTiming,
    before: warmBefore,
  }));
  await forces.click();
  await expect(forces).toHaveAttribute("aria-pressed", "false");

  const final = await finalProbe(page, client, baseline);
  const expectedRequests = requests.filter((url) =>
    /\/assets\/rapier-[^/]+\.js(?:\?|$)/.test(url)
  );
  const forbiddenRequests = requests.filter((url) =>
    /onnx|ort-wasm|u2net|character-segmentation/i.test(url)
  );
  const feature = buildChromebookFeatureAudit(
    "rapierDiagnostics",
    actions,
    baseline,
    final,
    { minimumWorkerCreations: 0, requireCompletedCycle: true },
  );
  const rapierRequestedOnce = {
    passed: expectedRequests.length === 1,
    observed: expectedRequests.length,
    limit: 1,
  };
  const forbiddenRuntimeAbsent = {
    passed: forbiddenRequests.length === 0,
    observed: forbiddenRequests.length,
    limit: 0,
  };
  const checks = {
    ...feature.acceptance,
    rapierRequestedOnce,
    forbiddenRuntimeAbsent,
  };
  const passed = Object.entries(checks)
    .filter(([name]) => name !== "passed")
    .every(([, check]) => check.passed);
  return {
    ...feature,
    network: { requests, expectedRequests, forbiddenRequests },
    acceptance: {
      ...checks,
      passed: { passed, observed: passed, limit: true },
    },
  };
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
        await page.getByTestId("workflow-stage-options").click();
        await expect(page.locator('[data-stage="options"]')).toBeVisible();
        const autosave = page.getByLabel("Enable autosave");
        if (await autosave.isChecked()) await autosave.uncheck();
        await goToStage(page, "Path");
        await expect.poll(() => workerActive(page), {
          message: "Trace begins after unrelated autosave work settles",
        }).toBe(0);
      },
      audit: auditTraceGif,
    });
  });

  test("Trace Video bounds playback and releases Object URLs", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "traceVideo",
      prepare: async (page) => {
        await openWavingArm(page);
        await goToStage(page, "Path");
        await expect.poll(() => workerActive(page), {
          message: "Video Trace begins after unrelated autosave work settles",
        }).toBe(0);
      },
      audit: auditTraceVideo,
    });
  });

  test("Rapier diagnostics lazily load once and remain interactive", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "rapierDiagnostics",
      prepare: async (page) => {
        await openWavingArm(page);
        await goToStage(page, "Foundry");
        await expect(page.locator("canvas.foundry-three-canvas")).toBeVisible();
        await expect.poll(() => workerActive(page), {
          message: "Rapier audit begins after unrelated autosave work settles",
        }).toBe(0);
      },
      audit: auditRapierDiagnostics,
    });
  });

});

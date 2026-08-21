import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

import { serializeProject } from "../../utils/project";
import { createFabricationReadyFourBarProject } from "../fixtures/fabricationProject";
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
  readFeatureRuntimeProbe,
  waitForLifecycleBaseline,
} from "./chromebookAuditHarness";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const FORBIDDEN_RUNTIME = /(?:onnx|u2net|ort-wasm|rapier)/i;

const activeWorkers = async (page: Page) =>
  (await readFeatureRuntimeProbe(page)).lifecycle.workers.active;

const prepareBlueprint = async (page: Page) => {
  const project = createFabricationReadyFourBarProject();
  project.settings = { ...project.settings, autosave: false };
  await page.getByTestId("project-file-input").setInputFiles({
    name: "classroom-blueprint.motionsmith.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByRole("heading", { name: "Path Editor" })).toBeVisible();
  await page.getByTestId("workflow-stage-blueprint").click();
  await expect(page.getByRole("heading", { name: "Blueprint" })).toBeVisible();
  const create = page.getByRole("button", { name: "Generate package" });
  await expect(create).toBeEnabled();
  await expect(create).toHaveAttribute("data-blueprint-package-worker", "on-demand");
  await expect(page.getByTestId("blueprint-export-package-json")).toHaveCount(0);
};

const finalProbe = async (
  page: Page,
  client: CDPSession,
  baseline: FeatureRuntimeProbe,
) => {
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  return collectStableFeatureProbe(page, client);
};

const auditBlueprintPackage = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  await expect.poll(() => activeWorkers(page), {
    message: "Blueprint begins after import workers settle",
  }).toBe(0);
  const baseline = await collectStableFeatureProbe(page, client);
  const actions: FeatureActionAudit[] = [];
  const create = page.getByRole("button", { name: "Generate package" });

  await create.evaluate((button) => {
    const cancelOnDispatch = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; type?: string }>).detail;
      if (
        detail?.name !== "motionsmith-blueprint-package" ||
        detail.type !== "create-package"
      ) return;
      window.removeEventListener(
        "motionsmith:chromebook-worker-request",
        cancelOnDispatch,
      );
      button.setAttribute("data-audit-cancelled-on-dispatch", "true");
      (button as HTMLButtonElement).click();
    };
    window.addEventListener(
      "motionsmith:chromebook-worker-request",
      cancelOnDispatch,
    );
  });

  const cancelledBefore = await readFeatureRuntimeProbe(page);
  const cancelledTiming = await measureClickToNextPaint(create);
  await expect(create).toHaveAttribute("data-audit-cancelled-on-dispatch", "true");
  await expect(create).toContainText("Make files");
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "blueprint-package-cancel",
    cycle: 1,
    outcome: "cancelled",
    timing: cancelledTiming,
    before: cancelledBefore,
  }));

  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureClickToNextPaint(create);
  await expect(
    page.getByRole("button", { name: "Download PDF cut sheet default" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("blueprint-export-package-json"),
    "memory audit does not retain a diagnostic copy of the package JSON",
  ).toHaveCount(0);
  await expect(create).toContainText("Make files");
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "blueprint-package-complete",
    cycle: 2,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  return buildChromebookFeatureAudit(
    "blueprintPackage",
    actions,
    baseline,
    await finalProbe(page, client, baseline),
    {
      minimumWorkerCreations: 2,
      requireCompletedCycle: true,
      requireCancelledCycle: true,
    },
  );
};

test.describe("Chromebook Blueprint export audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

  test("Blueprint package stays responsive and releases worker memory", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(0);
    const forbiddenRequests: string[] = [];
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "blueprintPackage",
      setup: async (page) => {
        page.on("request", (request) => {
          if (FORBIDDEN_RUNTIME.test(request.url())) {
            forbiddenRequests.push(request.url());
          }
        });
      },
      prepare: prepareBlueprint,
      audit: auditBlueprintPackage,
    });
    expect(
      forbiddenRequests,
      "Blueprint export does not request removed recognition or optional physics",
    ).toEqual([]);
  });
});

import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createLessonProject, serializeProject } from "../../utils/project";
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
  measureExternalActionToNextPaint,
  readFeatureRuntimeProbe,
  waitForLifecycleBaseline,
} from "./chromebookAuditHarness";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const FIXTURE_ROOT = join(process.cwd(), "tests/fixtures/package");
const FORBIDDEN_RUNTIME = /(?:onnx|u2net|ort-wasm|rapier)/i;

const projectPayload = (name: string, paddingBytes = 0) => {
  const project = createLessonProject("waving-arm");
  project.settings = { ...project.settings, autosave: false };
  if (paddingBytes > 0) {
    const partId = project.partOrder[0];
    project.parts[partId] = {
      ...project.parts[partId],
      originalSvgPath: `memory://${"x".repeat(paddingBytes)}`,
    };
  }
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  };
};

const largePackagePayload = () => [
  {
    name: "parts_info.json",
    mimeType: "application/json",
    buffer: readFileSync(join(FIXTURE_ROOT, "parts_info.json")),
  },
  {
    name: "char_cfg.yaml",
    mimeType: "application/yaml",
    buffer: readFileSync(join(FIXTURE_ROOT, "char_cfg.yaml")),
  },
  ...["body.png", "unused-1.png", "unused-2.png", "unused-3.png"].map(
    (name) => ({
      name,
      mimeType: "image/png",
      buffer: Buffer.alloc(5 * 1024 * 1024, 0x61),
    }),
  ),
];

type BrowserFileSeed = {
  name: string;
  mimeType: string;
  base64: string;
};

const armSupersedingImport = (
  page: Page,
  inputTestId:
    | "project-file-input"
    | "blank-package-input"
    | "scene-object-image-input",
  files: BrowserFileSeed[],
  workerName = "motionsmith-project-import",
  workerRequestType = "import",
) => page.evaluate(({ inputTestId, files, workerName, workerRequestType }) => {
  const input = document.querySelector<HTMLInputElement>(
    `[data-testid="${inputTestId}"]`,
  );
  if (!input) throw new Error(`Could not arm ${inputTestId}`);
  const nextFiles = files.map((file) => {
    const binary = atob(file.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new File([bytes], file.name, { type: file.mimeType });
  });
  const supersede = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: string; type?: string }>).detail;
    if (
      detail?.name !== workerName ||
      detail.type !== workerRequestType
    ) return;
    window.removeEventListener(
      "motionsmith:chromebook-worker-request",
      supersede,
    );
    const transfer = new DataTransfer();
    for (const file of nextFiles) transfer.items.add(file);
    input.files = transfer.files;
    input.setAttribute("data-audit-superseded-on-dispatch", "true");
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  window.addEventListener(
    "motionsmith:chromebook-worker-request",
    supersede,
  );
}, { inputTestId, files, workerName, workerRequestType });

const textSeed = (name: string, mimeType: string, text: string): BrowserFileSeed => ({
  name,
  mimeType,
  base64: Buffer.from(text).toString("base64"),
});

const packageSeeds = (): BrowserFileSeed[] => [
  {
    name: "parts_info.json",
    mimeType: "application/json",
    base64: readFileSync(join(FIXTURE_ROOT, "parts_info.json")).toString("base64"),
  },
  {
    name: "char_cfg.yaml",
    mimeType: "application/yaml",
    base64: readFileSync(join(FIXTURE_ROOT, "char_cfg.yaml")).toString("base64"),
  },
  {
    name: "body.png",
    mimeType: "image/png",
    base64: readFileSync(join(FIXTURE_ROOT, "body.png")).toString("base64"),
  },
];

const objectPngSeed = (): BrowserFileSeed => ({
  name: "body.png",
  mimeType: "image/png",
  base64: readFileSync(join(FIXTURE_ROOT, "body.png")).toString("base64"),
});

const largeObjectSvgPayload = () => ({
  name: "superseded-prop.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="1000" viewBox="0 0 8000 1000"><!--${"x".repeat(384 * 1024)}--><rect width="8000" height="1000" fill="#8b5cf6"/></svg>`,
  ),
});

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("character-screen")).toBeVisible();
  await page.getByTestId("workflow-stage-options").click();
  await expect(page.getByRole("heading", { name: "Options" })).toBeVisible();
  const autosave = page.getByLabel("Enable autosave");
  if (await autosave.isChecked()) await autosave.uncheck();
  await page.getByTestId("workflow-stage-character").click();
  await expect(page.getByTestId("character-screen")).toBeVisible();
};

const activeWorkers = async (page: Page) =>
  (await readFeatureRuntimeProbe(page)).lifecycle.workers.active;

const waitForPuppetTopologyPlateau = async (page: Page) => {
  let previous = -1;
  let stableSamples = 0;
  await expect.poll(async () => {
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const current = (await readFeatureRuntimeProbe(page)).puppetTopologyCount;
    stableSamples = current === previous ? stableSamples + 1 : 0;
    previous = current;
    return stableSamples;
  }, { message: "import begins after initial character topology reaches a plateau" })
    .toBeGreaterThanOrEqual(2);
};

const finalProbe = async (
  page: Page,
  client: CDPSession,
  baseline: FeatureRuntimeProbe,
) => {
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  return collectStableFeatureProbe(page, client);
};

const auditProjectImport = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  await expect.poll(() => activeWorkers(page), {
    message: "project import begins after prior disposable workers settle",
  }).toBe(0);
  await waitForPuppetTopologyPlateau(page);
  const baseline = await collectStableFeatureProbe(page, client);
  const input = page.getByTestId("project-file-input");
  const actions: FeatureActionAudit[] = [];

  await armSupersedingImport(page, "project-file-input", [textSeed(
    "classroom.json",
    "application/json",
    projectPayload("classroom.json").buffer.toString(),
  )]);
  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => input.setInputFiles(projectPayload("superseded.json", 12 * 1024 * 1024)),
  );
  await expect(input).toHaveAttribute("data-audit-superseded-on-dispatch", "true");

  await expect(page.getByRole("heading", { name: "Path Editor" })).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText(
    "Loaded project classroom.json",
  );
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "project-import-supersede-complete",
    cycle: 1,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  return buildChromebookFeatureAudit(
    "projectImport",
    actions,
    baseline,
    await finalProbe(page, client, baseline),
    {
      minimumWorkerCreations: 2,
      requireCompletedCycle: true,
    },
  );
};

const auditCharacterPackageImport = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  await expect.poll(() => activeWorkers(page), {
    message: "package import begins after prior disposable workers settle",
  }).toBe(0);
  await waitForPuppetTopologyPlateau(page);
  const baseline = await collectStableFeatureProbe(page, client);
  const input = page.getByTestId("blank-package-input");
  const actions: FeatureActionAudit[] = [];

  await armSupersedingImport(page, "blank-package-input", packageSeeds());
  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => input.setInputFiles(largePackagePayload()),
  );
  await expect(input).toHaveAttribute("data-audit-superseded-on-dispatch", "true");

  const review = page.getByTestId("character-import-review");
  await expect(review.getByText("Ready", { exact: true })).toBeVisible();
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await review.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(review).toHaveCount(0);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "character-package-supersede-complete-discard",
    cycle: 1,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  return buildChromebookFeatureAudit(
    "characterPackageImport",
    actions,
    baseline,
    await finalProbe(page, client, baseline),
    {
      minimumWorkerCreations: 2,
      requireCompletedCycle: true,
    },
  );
};

const auditSceneObjectImage = async (
  page: Page,
  client: CDPSession,
): Promise<FeatureAudit> => {
  await expect.poll(() => activeWorkers(page), {
    message: "object artwork begins after prior disposable workers settle",
  }).toBe(0);
  await waitForPuppetTopologyPlateau(page);
  const baseline = await collectStableFeatureProbe(page, client);
  const input = page.getByTestId("scene-object-image-input");
  const actions: FeatureActionAudit[] = [];

  await armSupersedingImport(
    page,
    "scene-object-image-input",
    [objectPngSeed()],
    "motionsmith-scene-object-image",
    "create-object",
  );
  const completedBefore = await readFeatureRuntimeProbe(page);
  const completedTiming = await measureExternalActionToNextPaint(
    page,
    () => input.setInputFiles(largeObjectSvgPayload()),
  );
  await expect(input).toHaveAttribute("data-audit-superseded-on-dispatch", "true");
  await expect(page.getByTestId("character-workflow-summary")).toContainText(
    "1 objects",
  );
  const inspector = page.getByTestId("scene-object-inspector");
  await expect(inspector).toContainText("body");
  await expect(inspector).toContainText("body.png");
  const jobCompletionMs = await elapsedFeatureTime(page, completedTiming);
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  actions.push(await finishFeatureAction(page, {
    label: "object-artwork-supersede-raster-complete",
    cycle: 1,
    outcome: "completed",
    timing: completedTiming,
    before: completedBefore,
    jobCompletionMs,
  }));

  return buildChromebookFeatureAudit(
    "sceneObjectImage",
    actions,
    baseline,
    await finalProbe(page, client, baseline),
    {
      minimumWorkerCreations: 2,
      requireCompletedCycle: true,
    },
  );
};

test.describe("Chromebook bounded import audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");
  test.describe.configure({ mode: "serial" });

  for (const auditCase of [
    { name: "projectImport" as const, audit: auditProjectImport },
    {
      name: "characterPackageImport" as const,
      audit: auditCharacterPackageImport,
    },
    {
      name: "sceneObjectImage" as const,
      audit: auditSceneObjectImage,
    },
  ]) {
    test(`${auditCase.name} stays responsive and releases superseded files`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(0);
      const forbiddenRequests: string[] = [];
      await runChromebookFeatureAudit({
        browser,
        testInfo,
        name: auditCase.name,
        setup: async (page) => {
          page.on("request", (request) => {
            if (FORBIDDEN_RUNTIME.test(request.url())) {
              forbiddenRequests.push(request.url());
            }
          });
        },
        prepare: openWavingArm,
        audit: auditCase.audit,
      });
      expect(
        forbiddenRequests,
        "local import does not request removed recognition or optional physics runtimes",
      ).toEqual([]);
    });
  }
});

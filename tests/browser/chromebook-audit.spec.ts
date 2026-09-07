import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookAcceptance,
  percentiles,
  type ActionLatency,
  type ChromebookAuditReport,
} from "./chromebookAuditReport";
import {
  applyChromebookEmulation,
  attachNetworkRecorder,
  collectPlaybackAudit,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
  measureAction,
  measureBoot,
} from "./chromebookAuditHarness";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const PLAYBACK_MS = Number(process.env.CHROMEBOOK_AUDIT_PLAYBACK_MS ?? 10 * 60 * 1_000);
const OUTPUT = process.env.CHROMEBOOK_AUDIT_OUTPUT;
const FORBIDDEN_IMAGE_RECOGNITION_REQUEST = /(?:\/onnx\/|pose_model\.onnx|onnxruntime|ort(?:\.bundle|-wasm)|webOnnx(?:Cache|Inference)Worker)/i;

const stageButton = (page: Page, name: string) => {
  const names: Record<string, RegExp> = {
    Character: /^Character$/i,
    Path: /^Path Editor$/i,
    Foundry: /Mechanism Foundry|Foundry/i,
    Design: /Mechanism Design|Design/i,
    Blueprint: /^Build \/ Print$/i,
    Assembly: /^Assembly$/i,
  };
  return page.getByTestId("workspace-steps").getByRole("button", { name: names[name] });
};

const measureStage = async (
  page: Page,
  actions: ActionLatency[],
  name: string,
  ready: Locator,
) => {
  const button = stageButton(page, name);
  actions.push(await measureAction(
    page,
    `tab:${name}`,
    "tab",
    button,
    () => button.click(),
    () => expect(ready, `${name} stage is ready`).toBeVisible(),
  ));
};

test.describe("Chromebook workflow audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");
  test.describe.configure({ mode: "serial" });

  test(`audits cold/warm boot and Character through Assembly at ${CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate}x CPU`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const context = await browser.newContext({
      viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
      screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
      deviceScaleFactor: CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
    });
    await installChromebookAuditInstrumentation(context);
    const page = await context.newPage();
    const client = await applyChromebookEmulation(page);
    const network = attachNetworkRecorder(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const cold = await measureBoot(
      page,
      "cold",
      () => page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/', { waitUntil: "domcontentloaded" }),
      () => network.records.length,
    );
    network.setPhase("warm-boot");
    const warm = await measureBoot(
      page,
      "warm",
      () => page.reload({ waitUntil: "domcontentloaded" }),
      () => network.records.length,
    );
    network.setPhase("workflow");

    await dismissStartupAnnouncement(page);
    const actions: ActionLatency[] = [];
    const dialog = page.getByTestId("getting-started-dialog");
    await expect(dialog).toBeVisible();
    const guide = dialog.getByTestId("getting-started-card-guided");
    actions.push(await measureAction(
      page,
      "open-guide",
      "click",
      guide,
      () => guide.click(),
      () => expect(dialog.getByTestId("guided-project-library")).toBeVisible(),
    ));
    const wavingArm = dialog.getByTestId("guided-project-card-waving-arm");
    actions.push(await measureAction(
      page,
      "open-waving-arm",
      "click",
      wavingArm,
      () => wavingArm.click(),
      async () => {
        await expect(dialog).toHaveCount(0);
        await expect(page.getByTestId("character-screen")).toBeVisible();
      },
    ));

    await measureStage(page, actions, "Path", page.getByRole("heading", { name: "Path Editor" }));
    await measureStage(page, actions, "Foundry", page.getByRole("heading", { name: "Foundry" }));
    await expect(page.locator("canvas.foundry-three-canvas")).toBeVisible();

    const toolbar = page.getByTestId("foundry-toolbar");
    const play = toolbar.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeVisible();
    const playback = await collectPlaybackAudit(page, PLAYBACK_MS, {
      controlsTestId: "foundry-toolbar",
    });
    if (!playback.controlActions) {
      throw new Error("Foundry playback did not record control latency");
    }
    actions.push(
      {
        label: "foundry-play",
        kind: "click",
        durationMs: playback.controlActions.playNextPaintMs,
      },
      {
        label: "foundry-pause",
        kind: "click",
        durationMs: playback.controlActions.pauseNextPaintMs,
      },
    );

    const phase = page.getByLabel("Foundry phase");
    for (const value of [30, 90, 150, 210, 270]) {
      actions.push(await measureAction(
        page,
        `foundry-scrub-${value}`,
        "scrub",
        phase,
        () => phase.fill(String(value)),
        () => expect(phase).toHaveValue(String(value)),
      ));
    }

    const preview = page.getByTestId("foundry-preview");
    const previewBox = await preview.boundingBox();
    expect(previewBox, "Foundry preview has a drag target").toBeTruthy();
    const cameraReadout = page.getByTestId("foundry-camera-readout");
    actions.push(await measureAction(
      page,
      "foundry-orbit",
      "drag",
      preview,
      async () => {
        const box = previewBox!;
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42);
        await page.mouse.up();
      },
      () => expect(cameraReadout).toContainText("Custom view"),
    ));

    await measureStage(page, actions, "Design", page.getByRole("heading", { name: "Mechanism Design" }));
    await measureStage(page, actions, "Blueprint", page.getByRole("heading", { name: "Blueprint" }));
    await expect(page.getByTestId("blueprint-canvas-preview")).toBeVisible();
    await measureStage(page, actions, "Assembly", page.getByTestId("assembly-canvas-preview"));

    await network.flush();
    const forbiddenImageRecognitionRequests = network.records
      .filter((request) => FORBIDDEN_IMAGE_RECOGNITION_REQUEST.test(request.url))
      .map((request) => request.url);
    const actionLatencyMs = percentiles(actions.filter((action) => action.kind !== "tab").map((action) => action.durationMs));
    const tabSwitchLatencyMs = percentiles(actions.filter((action) => action.kind === "tab").map((action) => action.durationMs));
    const acceptance = evaluateChromebookAcceptance(
      playback,
      actionLatencyMs,
      tabSwitchLatencyMs,
      forbiddenImageRecognitionRequests.length,
      { cold, warm },
    );
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== "string") {
      throw new Error("Chromebook workflow audit requires a preview base URL");
    }
    const report: ChromebookAuditReport = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      profile: CHROMEBOOK_AUDIT_PROFILE.name,
      resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
      productionBuild: true,
      actualChromebookTested: false,
      provenance: await collectChromebookAuditProvenance(baseURL),
      environment: await collectChromebookRuntimeEnvironment(
        page,
        browser.version(),
        "navigation-and-action",
      ),
      boot: { cold, warm },
      actions,
      actionLatencyMs,
      tabSwitchLatencyMs,
      playback,
      networkRequests: network.records,
      forbiddenImageRecognitionRequests,
      acceptance,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const testOutput = testInfo.outputPath("chromebook-audit.json");
    await writeFile(testOutput, json, "utf8");
    await testInfo.attach("chromebook-audit", { path: testOutput, contentType: "application/json" });
    if (OUTPUT) {
      await mkdir(dirname(OUTPUT), { recursive: true });
      await writeFile(OUTPUT, json, "utf8");
    }

    expect(network.records.filter((request) => request.url.includes("/@vite/client")), "audit used a production preview").toEqual([]);
    expect(
      forbiddenImageRecognitionRequests,
      "the complete workflow never requests image-recognition models or runtime assets",
    ).toEqual([]);
    expect(pageErrors, "audit workflow has no uncaught page errors").toEqual([]);
    if (ENFORCE) {
      for (const [name, check] of Object.entries(acceptance)) {
        expect(check.passed, `${name}: observed ${check.observed}, limit ${check.limit}`).toBe(true);
      }
    }

    await client.detach();
    await context.close();
  });
});

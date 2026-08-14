import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";

import {
  clickStage,
  installPageDiagnostics,
  makeInvalidProject,
  makeUnoccupiedWavingArmProject,
  readBlueprintPackage,
  sampleFrameMetrics,
  waitForBootLoader,
  writeG7Json,
  type PageDiagnostics,
} from "./quality-helpers";

const IMAGE_FIXTURE = join(process.cwd(), "tests/fixtures/stick-character.png");
const ONNX_MODEL_RESPONSE = /\/onnx\/pose_model\.onnx(?:\?.*)?$/;

let latestEvidence: Record<string, unknown> = {};
let activeDiagnostics: PageDiagnostics | undefined;

test.beforeEach(async ({ page }) => {
  latestEvidence = {};
  activeDiagnostics = installPageDiagnostics(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await activeDiagnostics?.flush(testInfo, { evidence: latestEvidence });
});

const expectProjectCounts = async (page: Page, expected: RegExp) => {
  await expect(page.getByTestId("stage-project-card")).toHaveAttribute("aria-label", expected);
};

const waitForReview = async (page: Page) => {
  await expect(page.getByTestId("character-import-review")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("character-import-media-summary")).toBeVisible({ timeout: 180_000 });
};

const openGuidedWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await expect(dialog.getByTestId("guided-project-library")).toBeVisible();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(page.getByRole("heading", { name: "Character", exact: true })).toBeVisible();
  await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
};

const readSnapshotFromDownload = async (page: Page) => {
  await page.getByTestId("top-command-bar").getByText("File", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("command-download-snapshot").click(),
  ]);
  const path = await download.path();
  expect(path, "snapshot download has a readable temporary path").toBeTruthy();
  return {
    filename: download.suggestedFilename(),
    snapshot: JSON.parse(await readFile(path!, "utf8")) as Record<string, any>,
  };
};

const ensurePlayerPaused = async (page: Page) => {
  const pause = page.getByTestId("workspace-player-dock").getByRole("button", { name: "Pause", exact: true });
  if (await pause.count()) await pause.click();
};

const playSharedStage = async (page: Page, label: string) => {
  await ensurePlayerPaused(page);
  const scrubber = page.getByLabel("Workspace scrubber");
  const before = await scrubber.inputValue();
  await page.getByTestId("workspace-player-dock").getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => scrubber.inputValue(), { message: `${label} playback advances the shared scrubber` }).not.toBe(before);
  await ensurePlayerPaused(page);
  return { before, after: await scrubber.inputValue() };
};

test("G7 isolated critical flow covers the integrated workbench", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const modelResponsePromise = page.waitForResponse(ONNX_MODEL_RESPONSE, { timeout: 180_000 });
  await page.goto("/");
  await waitForBootLoader(page);
  const modelResponse = await modelResponsePromise;
  expect(modelResponse.status(), "image processing downloads the real ONNX model").toBe(200);
  expect(modelResponse.url(), "model response uses the deployed ONNX path").toMatch(ONNX_MODEL_RESPONSE);
  const modelContentLength = modelResponse.headers()["content-length"];
  const modelAssetBytes = statSync(join(process.cwd(), "public/onnx/pose_model.onnx")).size;
  expect(modelAssetBytes, "the deployed ONNX asset is the recorded 135 MB model").toBe(135_929_562);
  if (modelContentLength !== undefined) {
    expect(Number(modelContentLength), "ONNX response content length matches the deployed asset").toBe(modelAssetBytes);
  }

  // 1. Guided project: the primary classroom entry creates real editable state.
  await openGuidedWavingArm(page);
  await expect(page.getByTestId("character-make-it-yours")).toBeVisible();
  latestEvidence.guidedProject = {
    card: "waving-arm",
    counts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
    editableOwnership: await page.getByTestId("character-make-it-yours").getAttribute("data-change-cue"),
  };

  // 2. Image fixture import/process: verify the browser-local review artifact, then retain the lesson.
  await page.getByTestId("onnx-input").setInputFiles(IMAGE_FIXTURE);
  await waitForReview(page);
  const media = page.getByTestId("character-import-media-summary");
  const mediaEvidence = await media.evaluate((element) => ({
    totalParts: Number(element.getAttribute("data-total-parts")),
    artParts: Number(element.getAttribute("data-art-parts")),
    maskParts: Number(element.getAttribute("data-mask-parts")),
    modelPath: element.getAttribute("data-model-path"),
    inferenceMs: Number(element.getAttribute("data-inference-ms")),
  }));
  expect(mediaEvidence.totalParts, "image processing creates editable parts").toBeGreaterThan(0);
  expect(mediaEvidence.artParts, "processed parts retain cropped art").toBe(mediaEvidence.totalParts);
  expect(mediaEvidence.maskParts, "processed parts retain cropped masks").toBe(mediaEvidence.totalParts);
  expect(mediaEvidence.inferenceMs, "image processing reports inference latency").toBeGreaterThan(0);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("character-import-review")).toHaveCount(0);
  latestEvidence.imageImport = {
    ...mediaEvidence,
    modelResponse: {
      status: modelResponse.status(),
      url: modelResponse.url(),
      contentLength: modelContentLength ?? null,
      assetBytes: modelAssetBytes,
    },
  };

  // Use a serializable lesson without a mechanism so creation below cannot be mistaken for editing a starter.
  const unoccupiedProject = await makeUnoccupiedWavingArmProject();
  await page.getByTestId("onboarding-import-input").setInputFiles(unoccupiedProject);
  await expect(page.getByRole("heading", { name: "Path Editor", exact: true })).toBeVisible();
  await expectProjectCounts(page, /14 parts, 1 paths, 0 mechanisms/);

  // 3. Native path draw/edit: one continuous gesture creates points, then the path inspector changes them.
  await page.getByTestId("path-view-2d").click();
  await expect(page.getByTestId("path-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Draw free path", exact: true }).click();
  const pathCanvas = page.getByTestId("path-canvas");
  const pathBox = await pathCanvas.boundingBox();
  expect(pathBox, "2D path canvas accepts a pointer gesture").toBeTruthy();
  if (!pathBox) throw new Error("missing 2D path canvas box");
  const points = [
    [0.35, 0.40],
    [0.42, 0.44],
    [0.50, 0.48],
    [0.58, 0.45],
    [0.65, 0.40],
  ];
  await page.mouse.move(pathBox.x + pathBox.width * points[0]![0], pathBox.y + pathBox.height * points[0]![1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(pathBox.x + pathBox.width * x, pathBox.y + pathBox.height * y, { steps: 2 });
  }
  await page.mouse.up();
  const drawStatus = page.getByTestId("free-draw-status");
  await expect(drawStatus).toContainText("Path ready");
  expect(Number(await drawStatus.getAttribute("data-point-count")), "free draw commits at least three points").toBeGreaterThanOrEqual(3);
  const shapeControls = page.getByTestId("path-shape-controls");
  await shapeControls.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(shapeControls.getByRole("button", { name: "Closed", exact: true })).toHaveClass(/active/);
  await page.getByLabel("Smoothness number").fill("24");
  await page.getByLabel("Smoothness number").press("Tab");
  await expect(page.getByLabel("Smoothness number")).toHaveValue("24");
  latestEvidence.path = {
    pointCount: await drawStatus.getAttribute("data-point-count"),
    closed: true,
    smoothness: await page.getByLabel("Smoothness number").inputValue(),
  };

  // 4. Mechanism creation and edit: Foundry commits a new mechanism from the no-mechanism lesson.
  await clickStage(page, "Foundry");
  await expect(page.getByRole("heading", { name: /Mechanism Foundry/i })).toBeVisible();
  await page.getByTestId("foundry-mechanism-gallery").getByRole("button", { name: /Four-bar linkage/i }).click();
  const foundryRig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  await expect(foundryRig).toHaveAttribute("data-mechanism-type", "4bar");
  await page.getByRole("button", { name: "Use mechanism", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mechanism Design", exact: true })).toBeVisible();
  await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  const designPreview = page.getByTestId("design-shared-foundry-preview");
  const designRig = designPreview.getByTestId("foundry-camera-rig");
  await expect(designRig).toHaveAttribute("data-mechanism-type", "4bar");
  const visible = page.getByLabel("Visible");
  const visibleBefore = await visible.isChecked();
  await visible.setChecked(!visibleBefore);
  await expect(visible, "a legal mechanism edit commits a visibility change").toBeChecked({ checked: !visibleBefore });
  await visible.setChecked(visibleBefore);
  await expect(visible).toBeChecked({ checked: visibleBefore });
  await expect(designRig).toHaveAttribute("data-three-preview-renderable", "ready");

  // 5. Accepted, rejected, and no-op command outcomes at the visible Design authority boundary.
  const target = page.getByLabel("Mechanism target");
  const validTarget = await target.inputValue();
  await target.selectOption("head");
  await expect(target, "a rejected target command retains the prior valid owner").toHaveValue(validTarget);
  const rejectionWarnings = page.getByTestId("stage-right-inspector").locator(".warning").filter({ hasText: /Fix:/ });
  await expect(rejectionWarnings).toHaveCount(1);
  await expect(rejectionWarnings).toHaveText("Fix: Choose anchor");
  const noOpSignature = await designRig.getAttribute("data-three-fabrication-export-signature");
  await target.selectOption(validTarget);
  await expect(target, "a semantic no-op retains the current valid mechanism target").toHaveValue(validTarget);
  await expect(designRig, "a semantic no-op preserves the rendered mechanism identity").toHaveAttribute("data-three-fabrication-export-signature", noOpSignature ?? "");
  await expect(rejectionWarnings, "the accepted no-op clears the rejected-command blocker").toHaveCount(0);
  latestEvidence.commandOutcomes = {
    accepted: { control: "Visible", from: visibleBefore, to: !visibleBefore, restored: visibleBefore },
    rejected: { control: "Mechanism target", attempted: "head", retained: validTarget },
    noOp: { control: "Mechanism target", value: validTarget, signaturePreserved: true, warnings: 0 },
  };

  // 6. Design Fit uses the integrated Foundry renderer and reports a fitted target.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(designPreview).toHaveAttribute("data-design-path-fit-status", "fit");
  expect(Number(await designPreview.getAttribute("data-design-target-error")), "Design Fit leaves a bounded target error").toBeLessThan(1);
  latestEvidence.designFit = {
    status: await designPreview.getAttribute("data-design-path-fit-status"),
    targetError: Number(await designPreview.getAttribute("data-design-target-error")),
  };

  // 7. Playback in Foundry, Design, and Path all advances the shared mechanism/path state.
  await clickStage(page, "Foundry");
  const foundryPhase = page.getByLabel("Foundry phase");
  const foundryPhaseBefore = await foundryPhase.inputValue();
  const foundryToolbar = page.getByTestId("foundry-toolbar");
  const foundryPlay = foundryToolbar.getByRole("button", { name: "Play", exact: true });
  await foundryPlay.click();
  await expect(foundryToolbar.getByRole("button", { name: "Pause", exact: true }), "Foundry toolbar enters its active state").toHaveText("Pause");
  await expect.poll(() => foundryPhase.inputValue(), { message: "Foundry phase advances" }).not.toBe(foundryPhaseBefore);
  const foundryPhaseAfter = await foundryPhase.inputValue();
  await foundryToolbar.getByRole("button", { name: "Pause", exact: true }).click();
  await clickStage(page, "Mechanism Design");
  const designPlayback = await playSharedStage(page, "Design");
  await clickStage(page, "Path Editor");
  const pathMore = page.getByTestId("novice-path-panel").locator("details").first();
  await pathMore.locator("summary").click();
  await pathMore.getByRole("button", { name: "Play", exact: true }).click();
  await expect(pathMore.getByRole("button", { name: "Play / Stop", exact: true }), "Path playback enters its active state").toHaveText("Stop");
  await pathMore.getByRole("button", { name: "Play / Stop", exact: true }).click();
  latestEvidence.playback = {
    foundryPhaseBefore,
    foundryPhaseAfter,
    design: designPlayback,
    path: "started and stopped",
  };

  // 8. Board policy switch: change the physical board profile and restore the buildable profile.
  await clickStage(page, "Options");
  const board = page.getByLabel("Board");
  await board.selectOption("letter-12x12-2cm");
  await expect(page.getByTestId("grid-cell-readout")).toContainText("12×12 board grid");
  const constrainedBoardReadout = await page.getByTestId("grid-cell-readout").innerText();
  await board.selectOption("letter-15x15-2cm");
  await expect(page.getByTestId("grid-cell-readout")).toContainText("15×15 board grid");
  latestEvidence.boardPolicy = { constrainedBoardReadout, restored: await board.inputValue() };

  // 9. Blueprint output: package generation exposes printable mechanism and assembly artifacts.
  await clickStage(page, "Blueprint");
  await expect(page.getByTestId("blueprint-svg-preview")).toBeVisible();
  await page.getByRole("button", { name: "Generate package", exact: true }).click();
  const blueprintPackage = await readBlueprintPackage(page);
  expect(blueprintPackage.metadataJson, "Blueprint emits metadata").toContain("validationIssues");
  expect(blueprintPackage.metadataJson, "Blueprint emits required part metadata").toContain("requiredParts");
  expect(blueprintPackage.assemblyGuideHtml, "Blueprint emits Assembly guide HTML").toContain("assembly guide");
  expect(blueprintPackage.assemblyGuidePdf, "Blueprint emits Assembly guide PDF bytes").toMatch(/^%PDF-/);
  const [cutSheetDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download PDF cut sheet default", exact: true }).click(),
  ]);
  expect(cutSheetDownload.suggestedFilename(), "Blueprint PDF download has a printable filename").toMatch(/\.pdf$/i);
  latestEvidence.blueprint = {
    metadataBytes: blueprintPackage.metadataJson?.length ?? 0,
    assemblyGuideHtmlBytes: blueprintPackage.assemblyGuideHtml?.length ?? 0,
    assemblyGuidePdfBytes: blueprintPackage.assemblyGuidePdf?.length ?? 0,
    cutSheetFilename: cutSheetDownload.suggestedFilename(),
  };

  // 7 continued / 9 continued. Assembly renders and plays the generated build steps.
  await clickStage(page, "Assembly");
  await expect(page.getByTestId("assembly-canvas-preview")).toBeVisible();
  await expect(page.getByTestId("assembly-step-list")).toBeVisible();
  const assemblyStepList = page.getByTestId("assembly-step-list");
  await assemblyStepList.getByRole("button").first().click();
  const assemblyWorkbench = page.getByTestId("assembly-readonly-step-strip");
  const assemblyProgressBefore = Number(await assemblyWorkbench.getAttribute("data-progress"));
  const assemblyPlayer = page.getByTestId("workspace-player-dock");
  await assemblyPlayer.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => Number(await assemblyWorkbench.getAttribute("data-progress")), { message: "Assembly playback advances the active build step" }).toBeGreaterThan(assemblyProgressBefore);
  await ensurePlayerPaused(page);
  latestEvidence.assembly = {
    step: await assemblyWorkbench.getAttribute("data-step-phase"),
    progressBefore: assemblyProgressBefore,
    progressAfter: Number(await assemblyWorkbench.getAttribute("data-progress")),
    stack: await page.getByTestId("assembly-stack-summary").innerText(),
  };

  // 10. Save, reload, undo, redo: snapshot and browser autosave preserve the canonical aggregate.
  const saved = await readSnapshotFromDownload(page);
  expect(saved.filename).toMatch(/\.motionsmith\.json$/);
  expect(saved.snapshot.version).toBe(2);
  expect(Object.keys(saved.snapshot.parts ?? {}).length).toBeGreaterThan(0);
  expect(saved.snapshot.paths).toBeTruthy();
  expect(saved.snapshot.mechanisms?.length).toBe(1);
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem("motionsmith.autosave"))), { timeout: 15_000 }).toBe(true);

  await clickStage(page, "Options");
  const toolbar = page.getByLabel("Show toolbar");
  const toolbarBefore = await toolbar.isChecked();
  await toolbar.setChecked(!toolbarBefore);
  await expect(toolbar).toBeChecked({ checked: !toolbarBefore });
  await page.getByTestId("top-command-bar").getByText("Edit", { exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(toolbar).toBeChecked({ checked: toolbarBefore });
  await page.getByTestId("top-command-bar").getByText("Edit", { exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(toolbar).toBeChecked({ checked: !toolbarBefore });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForBootLoader(page);
  const reloadDialog = page.getByTestId("getting-started-dialog");
  if (await reloadDialog.count()) await reloadDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  latestEvidence.persistence = {
    savedFilename: saved.filename,
    savedVersion: saved.snapshot.version,
    autosavePresent: true,
    reloadedCounts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
    undoRestoredToolbar: toolbarBefore,
    redoRestoredToolbar: !toolbarBefore,
  };

  // 11. Invalid project import is rejected without mutating the current aggregate.
  const invalidProject = await makeInvalidProject();
  await page.getByTestId("project-file-input").setInputFiles(invalidProject);
  await expect(page.getByTestId("status-bar")).toContainText("Fix: Update project");
  await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  latestEvidence.invalidImport = { status: "Fix: Update project", stateRetained: true };

  // 12. Exercise Chrome's real page lifecycle and retain the live preview.
  await clickStage(page, "Foundry");
  const restoredRig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  await expect(restoredRig).toHaveAttribute("data-three-preview-renderable", "ready");
  const signatureBeforeLifecycle = await restoredRig.getAttribute("data-three-fabrication-export-signature");
  const dynamicBuildCountBeforeLifecycle = await restoredRig.getAttribute("data-three-dynamic-build-count");
  expect(signatureBeforeLifecycle, "the Foundry preview exposes a stable fabrication signature").toBeTruthy();
  expect(dynamicBuildCountBeforeLifecycle, "the Foundry preview exposes its dynamic build count").toBeTruthy();

  const backgroundTab = await page.context().newPage();
  let backgroundVisibility = "unknown";
  try {
    await backgroundTab.goto("about:blank");
    await backgroundTab.bringToFront();
    backgroundVisibility = await page.evaluate(() => document.visibilityState);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState), { message: "the app tab restores visible state" }).toBe("visible");
    await expect(restoredRig).toHaveAttribute("data-three-preview-renderable", "ready");
    await expect(restoredRig).toHaveAttribute("data-three-fabrication-export-signature", signatureBeforeLifecycle ?? "");
    await expect(restoredRig).toHaveAttribute("data-three-dynamic-build-count", dynamicBuildCountBeforeLifecycle ?? "");
  } finally {
    await backgroundTab.close();
  }
  latestEvidence.tabLifecycle = {
    backgroundTab: "foregrounded",
    restored: true,
    backgroundVisibility,
    hiddenVisibilitySupported: backgroundVisibility === "hidden",
    restoredVisibility: await page.evaluate(() => document.visibilityState),
    renderable: "ready",
    signature: "stable",
    dynamicBuildCount: "stable",
  };

  // 13. Constrained-performance probe: compare idle and active rAF/long-task metrics in a short viewport.
  await page.setViewportSize({ width: 900, height: 520 });
  await expect(foundryToolbar.getByRole("button", { name: "Play", exact: true }), "Foundry is paused before the idle performance sample").toBeVisible();
  const beforePerformance = await sampleFrameMetrics(page, "foundry-idle", 30);
  await foundryToolbar.getByRole("button", { name: "Play", exact: true }).click();
  const duringPerformance = await sampleFrameMetrics(page, "foundry-playing", 45);
  const foundryPause = foundryToolbar.getByRole("button", { name: "Pause", exact: true });
  await expect(foundryPause, "Foundry toolbar owns the active performance pause").toBeVisible();
  await foundryPause.click();
  await expect(foundryToolbar.getByRole("button", { name: "Play", exact: true }), "Foundry toolbar reports paused state").toBeVisible();
  expect(beforePerformance.frames).toBeGreaterThanOrEqual(30);
  expect(duringPerformance.frames).toBeGreaterThanOrEqual(45);
  expect(duringPerformance.frameIntervalMs.p95, "active preview keeps constrained p95 frame interval bounded").toBeLessThan(100);
  expect(duringPerformance.longTasks.filter((entry) => entry.duration > 250), "active preview has no extreme long task").toEqual([]);
  latestEvidence.performance = { before: beforePerformance, during: duringPerformance };
  await writeG7Json("raw/critical-flow-evidence.json", latestEvidence);

  expect(activeDiagnostics?.pageErrors ?? [], "critical flow has no uncaught page errors").toEqual([]);
  expect(activeDiagnostics?.consoleErrors ?? [], "critical flow has no console errors").toEqual([]);
});

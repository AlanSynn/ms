import { expect, test, type CDPSession, type Page } from "@playwright/test";

import type { FeatureActionAudit } from "./chromebookFeatureAuditReport";
import { runChromebookFeatureAudit } from "./chromebookFeatureAuditRunner";
import {
  collectStableFeatureProbe,
  measureClickToNextPaint,
} from "./chromebookAuditHarness";
import {
  buildInteractionAudit,
  finalProbes,
  finishAction,
  measurePointerEventToNextPaint,
  measureRangeUpdate,
  measureSelectUpdate,
  openStage,
  openWavingArm,
  readVisualProbe,
  type InteractionAudit,
} from "./chromebookInteractionAudit";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";

const settleTopologyFrames = (page: Page) => page.evaluate(
  () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ));
  }),
);

const auditPathGestures = async (
  page: Page,
  client: CDPSession,
): Promise<InteractionAudit> => {
  const baseline = await collectStableFeatureProbe(page, client);
  const visualBaseline = await readVisualProbe(page);
  const actions: FeatureActionAudit[] = [];
  const state = page.getByTestId("path-three-puppet-state");
  await expect(
    state,
    "Path audit requires the production diagnostics probe",
  ).toBeAttached({ timeout: 15_000 });
  type ScreenTarget = { id: string; x: number; y: number; visible: boolean };
  const targets = JSON.parse(
    await state.getAttribute("data-three-path-point-screen-targets") ?? "[]",
  ) as ScreenTarget[];
  const target = targets.find((item) => item.visible);
  if (!target) throw new Error("Path gesture audit has no visible edit point");

  await page.mouse.move(target.x, target.y);
  actions.push(await finishAction(page, "path-point-down", 1, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () => page.mouse.down()),
  ));
  actions.push(await finishAction(page, "path-point-move", 1, () =>
    measurePointerEventToNextPaint(page, "pointermove", () =>
      page.mouse.move(target.x + 32, target.y + 18, { steps: 6 })),
  ));
  actions.push(await finishAction(page, "path-point-commit", 1, () =>
    measurePointerEventToNextPaint(page, "pointerup", () => page.mouse.up()),
    () => expect(state).toHaveAttribute("data-path-gesture-draft", "idle"),
  ));

  const draw = page.getByRole("button", { name: "Draw free path", exact: true });
  actions.push(await finishAction(page, "path-draw-mode", 2, () =>
    measureClickToNextPaint(draw),
  ));
  await expect(page.getByTestId("free-draw-status")).toHaveAttribute(
    "data-selected-point",
    "none",
  );
  const canvas = page.getByTestId("path-three-puppet-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Path gesture audit has no canvas bounds");
  const start = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.42 };
  await page.mouse.move(start.x, start.y);
  actions.push(await finishAction(page, "path-stroke-down", 2, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () => page.mouse.down()),
  ));
  actions.push(await finishAction(page, "path-stroke-move", 2, () =>
    measurePointerEventToNextPaint(page, "pointermove", () =>
      page.mouse.move(start.x + 48, start.y + 26, { steps: 6 })),
    () => expect(state).toHaveAttribute("data-path-gesture-draft", "active"),
  ));
  actions.push(await finishAction(page, "path-stroke-commit", 2, () =>
    measurePointerEventToNextPaint(page, "pointerup", () => page.mouse.up()),
    () => expect(page.getByTestId("free-draw-status")).toHaveAttribute(
      "data-draw-mode",
      "idle",
    ),
  ));

  const final = await finalProbes(page, client, baseline);
  return buildInteractionAudit(
    "pathGestures",
    actions,
    baseline,
    final.feature,
    visualBaseline,
    final.visual,
    {
      maxTopologyBuilds: 0,
      maxLiveResourceGrowth: 8,
      maxGeometryCacheGrowth: 0,
      maxMaterialCacheGrowth: 0,
    },
  );
};

const dragFoundryHandle = async (
  page: Page,
  handleId: "D" | "M",
  cycle: number,
  actions: FeatureActionAudit[],
) => {
  const handle = page.getByTestId(`foundry-param-handle-${handleId}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`${handleId} handle has no bounds`);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  actions.push(await finishAction(page, `${handleId}-down`, cycle, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () => page.mouse.down()),
  ));
  actions.push(await finishAction(page, `${handleId}-move`, cycle, () =>
    measurePointerEventToNextPaint(page, "pointermove", () =>
      page.mouse.move(start.x + (handleId === "M" ? 56 : 28), start.y + 16, { steps: 6 })),
  ));
  actions.push(await finishAction(page, `${handleId}-commit`, cycle, () =>
    measurePointerEventToNextPaint(page, "pointerup", () => page.mouse.up()),
    () => expect(page.getByTestId("foundry-canvas-pane"))
      .toHaveAttribute("data-foundry-gesture-draft", "idle"),
  ));
};

const auditFoundryGestures = async (
  page: Page,
  client: CDPSession,
): Promise<InteractionAudit> => {
  const baseline = await collectStableFeatureProbe(page, client);
  const visualBaseline = await readVisualProbe(page);
  const actions: FeatureActionAudit[] = [];
  await dragFoundryHandle(page, "D", 1, actions);
  await dragFoundryHandle(page, "M", 2, actions);

  const preview = page.getByTestId("foundry-preview");
  const rig = page.getByTestId("foundry-camera-rig");
  const box = await preview.boundingBox();
  if (!box) throw new Error("Foundry gesture audit has no preview bounds");
  const start = { x: box.x + box.width * 0.52, y: box.y + box.height * 0.5 };
  const yaw = await rig.getAttribute("data-camera-yaw");
  await page.mouse.move(start.x, start.y);
  actions.push(await finishAction(page, "orbit-down", 3, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () => page.mouse.down()),
  ));
  actions.push(await finishAction(page, "orbit-move", 3, () =>
    measurePointerEventToNextPaint(page, "pointermove", () =>
      page.mouse.move(start.x + 72, start.y - 28, { steps: 6 })),
    () => expect(rig).not.toHaveAttribute("data-camera-yaw", yaw ?? ""),
  ));
  actions.push(await finishAction(page, "orbit-up", 3, () =>
    measurePointerEventToNextPaint(page, "pointerup", () => page.mouse.up()),
  ));

  const final = await finalProbes(page, client, baseline);
  return buildInteractionAudit(
    "foundryGestures",
    actions,
    baseline,
    final.feature,
    visualBaseline,
    final.visual,
    {
      maxTopologyBuilds: 4,
      maxLiveResourceGrowth: 32,
      maxGeometryCacheGrowth: 8,
      maxMaterialCacheGrowth: 0,
    },
  );
};

const auditDesignControls = async (
  page: Page,
  client: CDPSession,
): Promise<InteractionAudit> => {
  const baseline = await collectStableFeatureProbe(page, client);
  const visualBaseline = await readVisualProbe(page);
  const actions: FeatureActionAudit[] = [];
  const slider = page.getByLabel("anchor X slider");
  const current = Number(await slider.inputValue());
  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  const step = Math.max(1, Number(await slider.getAttribute("step")) || 1);
  const next = current + step <= max
    ? current + step
    : Math.max(min, current - step);
  actions.push(await finishAction(page, "slider-down", 1, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () =>
      slider.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" })),
  ));
  actions.push(await finishAction(page, "slider-draft", 1, () =>
    measureRangeUpdate(slider, next),
    () => expect(slider).toHaveValue(String(next)),
  ));
  actions.push(await finishAction(page, "slider-commit", 1, () =>
    measurePointerEventToNextPaint(page, "pointerup", () =>
      slider.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" })),
  ));

  const scrubber = page.getByLabel("Workspace scrubber");
  const rig = page.getByTestId("design-shared-foundry-preview")
    .getByTestId("foundry-camera-rig");
  for (const [index, value] of [22, 58, 34].entries()) {
    const rotation = await rig.getAttribute("data-pinion-rotation-deg");
    actions.push(await finishAction(page, `timeline-${value}`, index + 2, () =>
      measureRangeUpdate(scrubber, value),
      () => expect(rig).not.toHaveAttribute(
        "data-pinion-rotation-deg",
        rotation ?? "",
      ),
    ));
  }

  const final = await finalProbes(page, client, baseline);
  return buildInteractionAudit(
    "designControls",
    actions,
    baseline,
    final.feature,
    visualBaseline,
    final.visual,
    {
      maxTopologyBuilds: 2,
      maxLiveResourceGrowth: 8,
      maxGeometryCacheGrowth: 2,
      maxMaterialCacheGrowth: 0,
    },
  );
};

const auditCharacterControls = async (
  page: Page,
  client: CDPSession,
): Promise<InteractionAudit> => {
  const baseline = await collectStableFeatureProbe(page, client);
  const visualBaseline = await readVisualProbe(page);
  const actions: FeatureActionAudit[] = [];
  const part = page.getByTestId("character-part-item-right_arm_lower");
  actions.push(await finishAction(page, "part-select", 1, () =>
    measureClickToNextPaint(part),
    () => expect(part).toHaveAttribute("aria-pressed", "true"),
  ));

  const panel = page.getByTestId("character-setup-panel");
  const partX = panel.getByLabel("X number").first();
  const nextPartX = Number(await partX.inputValue()) + 4;
  actions.push(await finishAction(page, "part-position", 2, () =>
    measureRangeUpdate(partX, nextPartX),
    () => expect(partX).toHaveValue(String(nextPartX)),
  ));

  const summary = page.getByTestId("character-workflow-summary");
  const addLayer = panel.getByRole("button", { name: "Add layer" });
  actions.push(await finishAction(page, "part-add", 3, () =>
    measureClickToNextPaint(addLayer),
    () => expect(summary).toContainText("15 parts"),
  ));
  const removeLayer = panel.getByRole("button", { name: "Remove layer" });
  actions.push(await finishAction(page, "part-remove", 4, () =>
    measureClickToNextPaint(removeLayer),
    () => expect(summary).toContainText("14 parts"),
  ));
  await settleTopologyFrames(page);
  const warmedLayerVisual = await readVisualProbe(page);
  actions.push(await finishAction(page, "part-add-repeat", 5, () =>
    measureClickToNextPaint(addLayer),
    () => expect(summary).toContainText("15 parts"),
  ));
  const repeatedRemove = panel.getByRole("button", { name: "Remove layer" });
  actions.push(await finishAction(page, "part-remove-repeat", 6, () =>
    measureClickToNextPaint(repeatedRemove),
    () => expect(summary).toContainText("14 parts"),
  ));
  await settleTopologyFrames(page);
  const repeatedLayerVisual = await readVisualProbe(page);

  const jointX = panel.getByLabel("Joint X slider");
  const currentJointX = Number(await jointX.inputValue());
  const nextJointX = currentJointX + 2;
  actions.push(await finishAction(page, "joint-down", 7, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () =>
      jointX.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" })),
  ));
  actions.push(await finishAction(page, "joint-draft", 7, () =>
    measureRangeUpdate(jointX, nextJointX),
    () => expect(jointX).toHaveValue(String(nextJointX)),
  ));
  actions.push(await finishAction(page, "joint-commit", 7, () =>
    measurePointerEventToNextPaint(page, "pointerup", () =>
      jointX.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" })),
  ));
  await settleTopologyFrames(page);
  const warmedJointVisual = await readVisualProbe(page);
  const repeatedJointX = nextJointX + 2;
  actions.push(await finishAction(page, "joint-down-repeat", 8, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () =>
      jointX.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "mouse" })),
  ));
  actions.push(await finishAction(page, "joint-draft-repeat", 8, () =>
    measureRangeUpdate(jointX, repeatedJointX),
    () => expect(jointX).toHaveValue(String(repeatedJointX)),
  ));
  actions.push(await finishAction(page, "joint-commit-repeat", 8, () =>
    measurePointerEventToNextPaint(page, "pointerup", () =>
      jointX.dispatchEvent("pointerup", { pointerId: 2, pointerType: "mouse" })),
  ));
  const foldLeft = panel.getByRole("button", { name: "Fold left" });
  actions.push(await finishAction(page, "joint-fold", 9, () =>
    measureClickToNextPaint(foldLeft),
    () => expect(foldLeft).toHaveClass(/active/),
  ));

  const final = await finalProbes(page, client, baseline);
  return buildInteractionAudit(
    "characterControls",
    actions,
    baseline,
    final.feature,
    visualBaseline,
    final.visual,
    {
      maxTopologyBuilds: 0,
      maxLiveResourceGrowth: 8,
      maxGeometryCacheGrowth: 0,
      maxMaterialCacheGrowth: 0,
    },
    [
      { baseline: warmedLayerVisual, final: repeatedLayerVisual },
      { baseline: warmedJointVisual, final: final.visual },
    ],
  );
};

const auditOptionsHistory = async (
  page: Page,
  client: CDPSession,
): Promise<InteractionAudit> => {
  const baseline = await collectStableFeatureProbe(page, client);
  const visualBaseline = await readVisualProbe(page);
  const actions: FeatureActionAudit[] = [];

  const performancePreset = page.getByLabel("Performance preset");
  actions.push(await finishAction(page, "performance-fast", 1, () =>
    measureSelectUpdate(performancePreset, "fast"),
    () => expect(performancePreset).toHaveValue("fast"),
  ));

  const speed = page.getByLabel("Animation speed slider");
  const nextSpeed = Math.min(5, Number(await speed.inputValue()) + 0.2);
  actions.push(await finishAction(page, "speed-down", 2, () =>
    measurePointerEventToNextPaint(page, "pointerdown", () =>
      speed.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" })),
  ));
  actions.push(await finishAction(page, "speed-draft", 2, () =>
    measureRangeUpdate(speed, nextSpeed),
    () => expect(speed).toHaveValue(String(nextSpeed)),
  ));
  actions.push(await finishAction(page, "speed-commit", 2, () =>
    measurePointerEventToNextPaint(page, "pointerup", () =>
      speed.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" })),
  ));

  const toolbar = page.getByLabel("Show toolbar");
  actions.push(await finishAction(page, "toolbar-hide", 3, () =>
    measureClickToNextPaint(toolbar),
    () => expect(page.getByTestId("quick-toolbar")).toHaveCount(0),
  ));

  const commandBar = page.getByTestId("top-command-bar");
  await commandBar.getByText("Edit", { exact: true }).click();
  const undo = commandBar.getByRole("button", { name: "Undo", exact: true });
  actions.push(await finishAction(page, "undo", 4, () =>
    measureClickToNextPaint(undo),
    async () => {
      await expect(toolbar).toBeChecked();
      await expect(page.getByTestId("quick-toolbar")).toBeVisible();
    },
  ));

  await commandBar.getByText("Edit", { exact: true }).click();
  const redo = commandBar.getByRole("button", { name: "Redo", exact: true });
  actions.push(await finishAction(page, "redo", 5, () =>
    measureClickToNextPaint(redo),
    async () => {
      await expect(toolbar).not.toBeChecked();
      await expect(page.getByTestId("quick-toolbar")).toHaveCount(0);
    },
  ));

  const final = await finalProbes(page, client, baseline);
  return buildInteractionAudit(
    "optionsHistory",
    actions,
    baseline,
    final.feature,
    visualBaseline,
    final.visual,
    {
      maxTopologyBuilds: 0,
      maxLiveResourceGrowth: 0,
      maxGeometryCacheGrowth: 0,
      maxMaterialCacheGrowth: 0,
    },
  );
};

test.describe("Chromebook direct interaction audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

  test("Path gestures stay responsive and memory-bounded", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "pathGestures",
      workload: "production-interaction",
      prepare: async (page) => {
        await openWavingArm(page);
        await openStage(page, "path");
        await page.getByTestId("path-view-2d").click();
      },
      audit: auditPathGestures,
    });
  });

  test("Foundry handles and orbit stay responsive and topology-bounded", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "foundryGestures",
      workload: "production-interaction",
      prepare: async (page) => {
        await openWavingArm(page);
        await openStage(page, "foundry");
        await expect(page.getByTestId("foundry-param-handle-D")).toBeVisible();
        await expect(page.getByTestId("foundry-param-handle-M")).toBeVisible();
      },
      audit: auditFoundryGestures,
    });
  });

  test("Design sliders and timeline stay responsive and resource-bounded", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "designControls",
      workload: "production-interaction",
      prepare: async (page) => {
        await openWavingArm(page);
        await openStage(page, "design");
        await expect(page.getByLabel("anchor X slider")).toBeVisible();
      },
      audit: auditDesignControls,
    });
  });

  test("Character parts and joints stay responsive and resource-bounded", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "characterControls",
      workload: "production-interaction",
      prepare: async (page) => {
        await openWavingArm(page);
        await page.getByTestId("workflow-stage-options").click();
        await expect(page.locator('[data-stage="options"]')).toBeVisible();
        const autosave = page.getByLabel("Enable autosave");
        if (await autosave.isChecked()) await autosave.uncheck();
        await page.getByTestId("workflow-stage-character").click();
        await expect(page.locator('[data-stage="character"]')).toBeVisible();
        await page.getByText("Edit skeleton", { exact: true }).click();
        await page.getByLabel("Edit joint").selectOption("right_hand");
        await expect(page.getByLabel("Joint X slider")).toBeEnabled();
      },
      audit: auditCharacterControls,
    });
  });

  test("Options and history stay responsive without resource growth", async ({ browser }, testInfo) => {
    test.setTimeout(0);
    await runChromebookFeatureAudit({
      browser,
      testInfo,
      name: "optionsHistory",
      workload: "production-interaction",
      prepare: async (page) => {
        await openWavingArm(page);
        await page.getByTestId("workflow-stage-options").click();
        await expect(page.locator('[data-stage="options"]')).toBeVisible();
        const autosave = page.getByLabel("Enable autosave");
        if (await autosave.isChecked()) await autosave.uncheck();
        const toolbar = page.getByLabel("Show toolbar");
        if (!await toolbar.isChecked()) await toolbar.check();
      },
      audit: auditOptionsHistory,
    });
  });
});

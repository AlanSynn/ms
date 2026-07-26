import { expect, test, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConnectionSelectionRole } from "../../types";
import { createLessonProject, serializeProject } from "../../utils/project";

const ONNX_MODEL_ROUTE = "**/onnx/pose_model.int8.ort";
const TEST_ONNX_MODEL_BYTES = Buffer.alloc(1_000_001, 1);

test.beforeEach(async ({ page }) => {
  await page.route(ONNX_MODEL_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "content-length": String(TEST_ONNX_MODEL_BYTES.length) },
      body: TEST_ONNX_MODEL_BYTES,
    });
  });
});

const importWavingArmLesson = async (page: Page) => {
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  const dir = await mkdtemp(join(tmpdir(), "motionsmith-g008-"));
  const path = join(dir, "waving-arm.motionsmith.json");
  await writeFile(path, serializeProject(createLessonProject("waving-arm")), "utf8");
  const dialog = page.getByTestId("getting-started-dialog");
  if (await dialog.count()) {
    if (await dialog.getByTestId("guided-project-library").count()) {
      await dialog.getByRole("button", { name: "Starters" }).click();
    }
    await page.getByTestId("getting-started-import-input").setInputFiles(path);
  } else {
    await page.getByTestId("project-file-input").setInputFiles(path);
  }
  await expect(page.getByRole("heading", { name: "Path Editor" })).toBeVisible();
};

const overlayFor = (page: Page, surface: "foundry" | "design") =>
  page.getByTestId(`${surface}-mechanism-connection-overlay`);

const roleHandle = (overlay: Locator, role: ConnectionSelectionRole, selected: boolean) =>
  overlay.locator(
    `circle.foundry-connection-hole-hit[data-connection-role="${role}"][data-connection-selected="${selected}"]`,
  );

const candidateHandle = (
  overlay: Locator,
  role: ConnectionSelectionRole,
  partKey: string,
  holeIndex: number,
) => overlay.getByTestId(
  `foundry-connection-hole-${role}-${partKey}-${holeIndex}`,
);

const commitNextKeyboardCandidate = async (
  page: Page,
  surface: "foundry" | "design",
  role: ConnectionSelectionRole,
) => {
  const overlay = overlayFor(page, surface);
  await expect(overlay).toHaveAttribute(
    "data-direct-manipulation",
    "shared-physical-connections",
  );
  const selected = roleHandle(overlay, role, true);
  await expect(selected).toBeVisible();
  await expect(selected).toHaveAttribute(
    "aria-keyshortcuts",
    "ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space Escape",
  );
  const beforeIdentity = await selected.getAttribute("data-connection-identity");
  expect(beforeIdentity).toBeTruthy();
  await selected.focus();
  await selected.press("ArrowRight");
  await expect.poll(async () => {
    let visible = 0;
    const handles = overlay.locator(
      `circle.foundry-connection-hole-hit[data-connection-role="${role}"]`,
    );
    for (const handle of await handles.all()) if (await handle.isVisible()) visible += 1;
    return visible;
  }, { message: `${surface} reveals alternate physical candidates from the keyboard` })
    .toBeGreaterThan(1);
  const focused = overlay.locator("circle.foundry-connection-hole-hit:focus");
  await expect(focused).toBeVisible();
  await expect(focused).not.toHaveAttribute(
    "data-connection-identity",
    beforeIdentity!,
  );
  const nextIdentity = await focused.getAttribute("data-connection-identity");
  const nextPartKey = await focused.getAttribute("data-connection-part-key");
  const nextHoleIndex = Number(await focused.getAttribute("data-connection-hole-index"));
  expect(nextPartKey).toBeTruthy();
  expect(Number.isInteger(nextHoleIndex)).toBe(true);
  const next = candidateHandle(overlay, role, nextPartKey!, nextHoleIndex);
  await expect(next).toHaveAttribute("data-connection-identity", nextIdentity!);
  await expect(next).toHaveAttribute("aria-label", new RegExp(nextPartKey!));
  await expect(roleHandle(overlay, role, true)).toHaveAttribute(
    "data-connection-identity",
    beforeIdentity!,
  );
  await focused.press("Escape");
  await expect(roleHandle(overlay, role, true)).toHaveAttribute(
    "data-connection-identity",
    beforeIdentity!,
  );
  await selected.focus();
  await selected.press("ArrowRight");
  const commitFocused = candidateHandle(overlay, role, nextPartKey!, nextHoleIndex);
  await expect(commitFocused).toHaveAttribute(
    "data-connection-identity",
    nextIdentity!,
  );
  await commitFocused.press("Enter");
  await expect.poll(
    () => roleHandle(overlay, role, true).getAttribute("data-connection-identity"),
    { message: `${surface} commits the keyboard-selected physical candidate` },
  ).toBe(nextIdentity);
  return nextIdentity!;
};

test("G008 shared physical overlay supports keyboard commit and preserves state on rejected pointer drop", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await importWavingArmLesson(page);
  await page.getByTestId("workspace-steps").getByRole("button", {
    name: /Mechanism Foundry|Foundry/i,
  }).click();
  await expect(page.getByRole("heading", { name: "Foundry" })).toBeVisible();

  const foundryRig = page.getByTestId("foundry-camera-rig");
  const foundryIdentity = await commitNextKeyboardCandidate(
    page,
    "foundry",
    "4bar.input-joint",
  );
  await expect(foundryRig).toHaveAttribute(
    "data-three-selected-connection-role",
    "4bar.input-joint",
  );
  await expect(page.getByTestId("foundry-param-handle-B")).toHaveAttribute(
    "data-draggable",
    "false",
  );
  await expect(page.getByTestId("foundry-param-handle-C")).toHaveAttribute(
    "data-draggable",
    "false",
  );
  await expect(page.getByLabel("Input link length")).toBeDisabled();
  await expect(page.getByLabel("Output link length")).toBeDisabled();

  const signatureBeforeReject = await foundryRig.getAttribute(
    "data-three-fabrication-export-signature",
  );
  const selected = roleHandle(
    overlayFor(page, "foundry"),
    "4bar.input-joint",
    true,
  );
  await selected.hover();
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("foundry-connection-recovery")).toHaveText(
    "Fix: Choose anchor",
  );
  await expect(foundryRig).toHaveAttribute(
    "data-three-fabrication-export-signature",
    signatureBeforeReject!,
  );
  await expect(roleHandle(overlayFor(page, "foundry"), "4bar.input-joint", true))
    .toHaveAttribute("data-connection-identity", foundryIdentity);
  await roleHandle(overlayFor(page, "foundry"), "4bar.input-joint", true).click();
  await expect(page.getByTestId("foundry-connection-recovery")).toHaveCount(0);

  await page.getByRole("button", { name: /Use mechanism/i }).click();
  await expect(page.getByRole("heading", { name: "Mechanism Design" })).toBeVisible();
  const designIdentity = await commitNextKeyboardCandidate(
    page,
    "design",
    "4bar.output-joint",
  );
  await expect(
    roleHandle(overlayFor(page, "design"), "4bar.output-joint", true),
  ).toHaveAttribute("data-connection-identity", designIdentity);
  await expect(page.getByTestId("design-parametric-editor").getByLabel("Input link length"))
    .toBeDisabled();
  await expect(page.getByTestId("design-parametric-editor").getByLabel("Output link length"))
    .toBeDisabled();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

const focusFamilyCandidate = async (
  overlay: Locator,
  role: ConnectionSelectionRole,
  partKey: string,
  holeIndex: number,
) => {
  const selected = roleHandle(overlay, role, true);
  const target = candidateHandle(overlay, role, partKey, holeIndex);
  await expect(selected).toBeVisible();
  await selected.focus();
  for (let index = 0; index < 32; index += 1) {
    await overlay.locator("circle.foundry-connection-hole-hit:focus").press("ArrowRight");
    if (await target.count() && await target.evaluate((element) => element === document.activeElement))
      return target;
  }
  throw new Error(`No ${role} candidate for ${partKey} hole ${holeIndex}`);
};

const planetaryPivotSignature = async (rig: Locator) =>
  ((await rig.getAttribute("data-three-fabrication-export-signature")) ?? "")
    .split("|")
    .find((part) => part.startsWith("planetary_gear.carrier-planet-pivot:"));

const dragPlanetaryPivot = async (
  page: Page,
  surface: "foundry" | "design",
  fromHoleIndex: 2 | 4,
  toHoleIndex: 2 | 4,
) => {
  const overlay = overlayFor(page, surface);
  const role = "planetary_gear.carrier-planet-pivot";
  const start = candidateHandle(overlay, role, "linkage-4-cell", fromHoleIndex);
  await expect(start).toHaveAttribute("data-connection-selected", "true");
  await start.hover();
  await page.mouse.down();

  const target = candidateHandle(overlay, role, "linkage-4-cell", toHoleIndex);
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("role", "button");
  await expect(target).toHaveAttribute(
    "aria-label",
    `Planet pivot, linkage-4-cell, hole ${toHoleIndex + 1}`,
  );
  await expect(target).toHaveAttribute("data-coincident-choice", "true");
  const [startBox, targetBox] = await Promise.all([
    start.boundingBox(),
    target.boundingBox(),
  ]);
  expect(startBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  expect(
    Math.hypot(
      targetBox!.x + targetBox!.width / 2 - (startBox!.x + startBox!.width / 2),
      targetBox!.y + targetBox!.height / 2 - (startBox!.y + startBox!.height / 2),
    ),
    `${surface} gives coincident planetary pivots separate pointer targets`,
  ).toBeGreaterThan(20);

  await target.hover({ force: true });
  await page.mouse.up();
  await expect(target).toHaveAttribute("data-connection-selected", "true");
};

test("G018 family prospects commit atomically in Foundry and Design", async ({ page }) => {
  await page.goto("/");
  await importWavingArmLesson(page);
  await page.getByTestId("workspace-steps").getByRole("button", {
    name: /Mechanism Foundry|Foundry/i,
  }).click();
  await page.getByText("Mechanism options", { exact: true }).click();
  await page.getByLabel("Foundry mechanism type").selectOption("gear_linkage");

  const foundryOverlay = overlayFor(page, "foundry");
  const prospectiveG40 = await focusFamilyCandidate(
    foundryOverlay,
    "gear_linkage.drive-pin",
    "g40",
    0,
  );
  await prospectiveG40.press("Enter");
  await expect(page.getByLabel("Drive gear size")).toHaveValue("g40");
  await expect(candidateHandle(foundryOverlay, "gear_linkage.drive-pin", "g40", 0))
    .toHaveAttribute("data-connection-selected", "true");
  await expect(page.getByTestId("foundry-camera-rig"))
    .toHaveAttribute(
      "data-three-fabrication-export-signature",
      /gear_linkage\.drive-pin:g40:0:\d+/,
    );

  const useMechanism = page.getByRole("button", { name: /Use mechanism/i });
  await expect(useMechanism).toBeEnabled();
  await useMechanism.click();
  await expect(page.getByRole("heading", { name: "Mechanism Design" })).toBeVisible();
  await page.getByTestId("design-parametric-editor").getByLabel("Drive gear size")
    .selectOption("g24");
  const designOverlay = overlayFor(page, "design");
  await expect(candidateHandle(designOverlay, "gear_linkage.drive-pin", "g24", 0))
    .toHaveAttribute("data-connection-selected", "true");
  await expect(
    page.getByTestId("design-shared-foundry-preview").getByTestId("foundry-camera-rig"),
  ).toHaveAttribute(
    "data-three-fabrication-export-signature",
    /gear_linkage\.drive-pin:g24:0:\d+/,
  );
});

test("physical drag commits A after returning A to B to A inside the start deadzone", async ({ page }) => {
  await page.goto("/");
  await importWavingArmLesson(page);
  await page.getByTestId("workspace-steps").getByRole("button", {
    name: /Mechanism Foundry|Foundry/i,
  }).click();
  await page.getByText("Mechanism options", { exact: true }).click();
  await page.getByLabel("Foundry mechanism type").selectOption("planetary_gear");

  const role = "planetary_gear.carrier-planet-pivot";
  const overlay = overlayFor(page, "foundry");
  const rig = page.locator(
    '[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]',
  );
  const start = candidateHandle(overlay, role, "linkage-4-cell", 2);
  await expect(start).toHaveAttribute("data-connection-selected", "true");
  const startIdentity = await start.getAttribute("data-connection-identity");
  expect(startIdentity).toBeTruthy();
  await start.hover();
  const startBox = await start.boundingBox();
  expect(startBox).toBeTruthy();
  await page.mouse.down();

  const target = candidateHandle(overlay, role, "linkage-4-cell", 4);
  await expect(target).toBeVisible();
  const targetBox = await target.boundingBox();
  expect(targetBox).toBeTruthy();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
  );
  await expect(target).toHaveAttribute("r", "11.5");
  await page.mouse.move(
    startBox!.x + startBox!.width / 2 + 1,
    startBox!.y + startBox!.height / 2 + 1,
  );
  await expect(start).toHaveAttribute("r", "11.5");
  await page.mouse.up();

  await expect.poll(() => planetaryPivotSignature(rig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:2",
  );
  await expect(roleHandle(overlay, role, true)).toHaveAttribute(
    "data-connection-identity",
    startIdentity!,
  );
});

test("planetary coincident pivot identity commits exactly in Foundry and Design", async ({ page }) => {
  await page.goto("/");
  await importWavingArmLesson(page);
  await page.getByTestId("workspace-steps").getByRole("button", {
    name: /Mechanism Foundry|Foundry/i,
  }).click();
  await page.getByText("Mechanism options", { exact: true }).click();
  await page.getByLabel("Foundry mechanism type").selectOption("planetary_gear");

  const foundryRig = page.locator(
    '[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]',
  );
  await expect.poll(() => planetaryPivotSignature(foundryRig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:2",
  );
  const foundryBefore = await foundryRig.getAttribute(
    "data-three-fabrication-export-signature",
  );
  await dragPlanetaryPivot(page, "foundry", 2, 4);
  await expect.poll(() => planetaryPivotSignature(foundryRig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:4",
  );
  await expect(foundryRig).not.toHaveAttribute(
    "data-three-fabrication-export-signature",
    foundryBefore!,
  );

  await dragPlanetaryPivot(page, "foundry", 4, 2);
  await expect.poll(() => planetaryPivotSignature(foundryRig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:2",
  );
  await page.getByRole("button", { name: /Use mechanism/i }).click();
  await expect(page.getByRole("heading", { name: "Mechanism Design" })).toBeVisible();
  await page.getByTestId("workspace-player-dock").getByRole("button", {
    name: "Pause",
  }).click();
  await page.getByLabel("Workspace scrubber").fill("0");

  const designRig = page.locator(
    '[data-testid="foundry-camera-rig"][data-viewer-tab="design"]',
  );
  await expect.poll(() => planetaryPivotSignature(designRig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:2",
  );
  const designBefore = await designRig.getAttribute(
    "data-three-fabrication-export-signature",
  );
  await dragPlanetaryPivot(page, "design", 2, 4);
  await expect.poll(() => planetaryPivotSignature(designRig)).toBe(
    "planetary_gear.carrier-planet-pivot:linkage-4-cell:4",
  );
  await expect(designRig).not.toHaveAttribute(
    "data-three-fabrication-export-signature",
    designBefore!,
  );
});

test("G018 cam and planetary secondary traces stay display-only", async ({ page }) => {
  await page.goto("/");
  await importWavingArmLesson(page);
  await page.getByTestId("workspace-steps").getByRole("button", {
    name: /Mechanism Foundry|Foundry/i,
  }).click();
  await page.getByText("Mechanism options", { exact: true }).click();

  const rig = page.getByTestId("foundry-camera-rig");
  for (const [type, secondary] of [
    ["cam", "B"],
    ["planetary_gear", "D"],
  ] as const) {
    await page.getByLabel("Foundry mechanism type").selectOption(type);
    await expect(rig).toHaveAttribute("data-mechanism-type", type);
    await expect(rig).toHaveAttribute("data-three-primary-path-id", "C");
    const canonicalBounds = await rig.getAttribute("data-three-primary-path-bounds");
    await page.getByTestId("foundry-cycle-output-trace").click();
    await expect(page.getByTestId("foundry-cycle-output-trace"))
      .toHaveText(`Target ${secondary}`);
    await expect(rig).toHaveAttribute("data-three-primary-path-id", "C");
    await expect(rig).toHaveAttribute(
      "data-three-primary-path-bounds",
      canonicalBounds ?? "",
    );
  }
});

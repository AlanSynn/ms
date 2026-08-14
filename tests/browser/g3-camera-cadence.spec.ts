import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

const TEST_ONNX_MODEL_BYTES = Buffer.alloc(1_000_001, 1);

test.beforeEach(async ({ page }) => {
  await page.route("**/onnx/pose_model.onnx", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "content-length": String(TEST_ONNX_MODEL_BYTES.length) },
      body: TEST_ONNX_MODEL_BYTES,
    });
  });
});

test("Assembly camera flushes its final pointer sample", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });

  const gettingStarted = page.getByTestId("getting-started-dialog");
  await gettingStarted.getByTestId("getting-started-card-guided").click();
  await gettingStarted.getByTestId("guided-project-card-waving-arm").click();
  await page
    .getByTestId("workspace-steps")
    .getByRole("button", { name: /Assembly/i })
    .click();

  await page
    .getByTestId("assembly-mode-switch")
    .getByRole("button", { name: /^Character$/ })
    .click();
  const preview = page.getByTestId("assembly-character-three-preview");
  const rig = preview.getByTestId("foundry-camera-rig");
  await expect(rig).toHaveAttribute("data-viewer-tab", "assembly");
  const canvasBox = await preview.locator("canvas.foundry-three-canvas").boundingBox();
  expect(canvasBox, "Assembly Foundry canvas accepts camera gestures").toBeTruthy();

  const yawBefore = Number(await rig.getAttribute("data-camera-yaw"));
  const start = {
    x: canvasBox!.x + canvasBox!.width * 0.5,
    y: canvasBox!.y + canvasBox!.height * 0.5,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 92, start.y - 18, { steps: 7 });
  await page.mouse.up();

  await expect(rig).toHaveAttribute("data-camera-preset", "custom");
  await expect
    .poll(
      async () =>
        Math.abs(Number(await rig.getAttribute("data-camera-yaw")) - yawBefore),
      { message: "pointer-up flushes the last Assembly camera sample" },
    )
    .toBeGreaterThan(1);
});

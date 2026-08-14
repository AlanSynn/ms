import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

type MediaEvidence = {
  artParts: number;
  maskParts: number;
  totalParts: number;
  modelPath: string;
  modelInitMs: number;
  modelReused: boolean;
  inferenceMs: number;
  ownedModelBufferReferencesRetained: number;
  retainedModelSessionCount: number;
  requestTensorRetainedBytes: number;
  imageBitmapClosed: boolean;
  partTextureDataUrlChars: number;
  partMaskDataUrlChars: number;
};

const readMediaEvidence = async (page: Page): Promise<MediaEvidence> =>
  page.getByTestId("character-import-media-summary").evaluate((element) => ({
    artParts: Number(element.getAttribute("data-art-parts")),
    maskParts: Number(element.getAttribute("data-mask-parts")),
    totalParts: Number(element.getAttribute("data-total-parts")),
    modelPath: element.getAttribute("data-model-path") ?? "",
    modelInitMs: Number(element.getAttribute("data-model-init-ms")),
    modelReused: element.getAttribute("data-model-reused") === "true",
    inferenceMs: Number(element.getAttribute("data-inference-ms")),
    ownedModelBufferReferencesRetained: Number(element.getAttribute("data-owned-model-buffer-references-retained")),
    retainedModelSessionCount: Number(element.getAttribute("data-retained-model-session-count")),
    requestTensorRetainedBytes: Number(element.getAttribute("data-request-tensor-retained-bytes")),
    imageBitmapClosed: element.getAttribute("data-image-bitmap-closed") === "true",
    partTextureDataUrlChars: Number(element.getAttribute("data-part-texture-data-url-chars")),
    partMaskDataUrlChars: Number(element.getAttribute("data-part-mask-data-url-chars")),
  }));

const readProcessEvidence = async (
  page: Page,
  selectionStart: number,
  reviewEnd: number,
  media: MediaEvidence,
) => page.evaluate(({ selectionStart: harnessStart, reviewEnd: processEnd, mediaEvidence }) => {
  type MarkDetail = { requestId?: number; metrics?: Record<string, unknown> };
  type MarkWithDetail = PerformanceEntry & { detail?: MarkDetail };
  type LongTaskEvidence = { startTime: number; duration: number };
  const processMarks = performance
    .getEntriesByName("motionsmith-image-process-result")
    .map((entry) => entry as MarkWithDetail)
    .filter((entry) => entry.startTime >= harnessStart && Number.isFinite(entry.detail?.requestId));
  const processMark = processMarks.at(-1);
  if (!processMark?.detail?.requestId) throw new Error("No process-specific worker result mark was recorded");
  const requestId = processMark.detail.requestId;
  const dispatchMark = performance
    .getEntriesByName("motionsmith-image-process-dispatch")
    .map((entry) => entry as MarkWithDetail)
    .find((entry) => entry.detail?.requestId === requestId);
  if (!dispatchMark) throw new Error(`No app-owned process dispatch mark was recorded for request ${requestId}`);
  const progressMarks = performance
    .getEntriesByName("motionsmith-image-process-progress")
    .map((entry) => entry as MarkWithDetail)
    .filter((entry) => entry.detail?.requestId === requestId);
  const phaseMarks = [
    "motionsmith-image-result-application-start",
    "motionsmith-image-result-application-end",
  ].flatMap((name) => performance
    .getEntriesByName(name)
    .map((entry) => entry as MarkWithDetail)
    .filter((entry) => entry.detail?.requestId === requestId)
    .map((entry) => ({ name, startTime: entry.startTime, duration: entry.duration, detail: entry.detail })));
  const target = window as Window & { __g5LongTasks?: LongTaskEvidence[] };
  const longTasks = (target.__g5LongTasks ?? []).filter((entry) =>
    entry.startTime < processEnd && entry.startTime + entry.duration > dispatchMark.startTime,
  );
  const reviewMark = performance
    .getEntriesByName("g5-process-1-review-visible")
    .concat(performance.getEntriesByName("g5-process-2-review-visible"))
    .map((entry) => entry as MarkWithDetail)
    .at(-1);
  return {
    requestId,
    dispatchMark: {
      startTime: dispatchMark.startTime,
      duration: dispatchMark.duration,
      detail: dispatchMark.detail,
    },
    processResultMark: {
      startTime: processMark.startTime,
      duration: processMark.duration,
      detail: processMark.detail,
    },
    processProgressMessageCount: progressMarks.length,
    processProgressMarks: progressMarks.map((entry) => ({
      startTime: entry.startTime,
      duration: entry.duration,
      detail: entry.detail,
    })),
    phaseMarks,
    reviewMark: reviewMark
      ? { startTime: reviewMark.startTime, duration: reviewMark.duration, detail: reviewMark.detail }
      : undefined,
    overlappingLongTasks: longTasks,
    media: mediaEvidence,
  };
}, { selectionStart, reviewEnd, mediaEvidence: media });

const assertMediaContract = (media: MediaEvidence, reused: boolean) => {
  expect(media.totalParts, "image import creates body parts").toBeGreaterThan(0);
  expect(media.artParts, "every imported part keeps cropped art").toBe(media.totalParts);
  expect(media.maskParts, "every imported part keeps a cropped mask").toBe(media.totalParts);
  expect(media.modelPath).toContain("/onnx/pose_model.onnx");
  expect(media.modelReused).toBe(reused);
  expect(media.inferenceMs, "inference latency is measured").toBeGreaterThan(0);
  expect(media.ownedModelBufferReferencesRetained).toBe(0);
  expect(media.retainedModelSessionCount).toBe(1);
  expect(media.requestTensorRetainedBytes).toBe(0);
  expect(media.imageBitmapClosed).toBe(true);
  expect(media.partTextureDataUrlChars).toBeGreaterThan(0);
  expect(media.partMaskDataUrlChars).toBeGreaterThan(0);
  expect(media.partTextureDataUrlChars).toBeLessThanOrEqual(media.totalParts * 400_000);
  expect(media.partMaskDataUrlChars).toBeLessThanOrEqual(media.totalParts * 220_000);
};

test("Create from image upload keeps transforms off the UI thread", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("character-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });

  const dialog = page.getByTestId("getting-started-dialog");
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await expect(page.getByTestId("character-screen")).toBeVisible();

  await page.evaluate(() => {
    const target = window as Window & {
      __g5LongTasks?: Array<{ startTime: number; duration: number }>;
      __g5LongTaskObserverSupported?: boolean;
    };
    target.__g5LongTasks = [];
    target.__g5LongTaskObserverSupported = Boolean(
      "PerformanceObserver" in window &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask"),
    );
    if (!target.__g5LongTaskObserverSupported) return;
    const observer = new PerformanceObserver((list) => {
      target.__g5LongTasks?.push(...list.getEntries().map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
      })));
    });
    observer.observe({ type: "longtask", buffered: false });
  });

  const processStart = await page.evaluate(() => {
    performance.mark("g5-process-1-start");
    return performance.now();
  });
  await page.getByTestId("onnx-input").setInputFiles(
    join(process.cwd(), "tests/fixtures/stick-character.png"),
  );
  await expect(page.getByTestId("character-import-review")).toBeVisible({
    timeout: 180_000,
  });
  await page.getByTestId("character-import-media-summary").waitFor();
  const firstPreview = page.getByTestId("character-import-review").locator('img[alt="Imported character"]');
  await expect(firstPreview).toBeVisible();
  const firstPreviewBox = await firstPreview.boundingBox();
  expect(firstPreviewBox?.width ?? 0, "review thumbnail has visible bounded width").toBeGreaterThan(0);
  expect(firstPreviewBox?.width ?? Infinity, "review thumbnail stays compact").toBeLessThanOrEqual(320);
  expect(firstPreviewBox?.height ?? Infinity, "review thumbnail stays bounded in height").toBeLessThanOrEqual(128);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const firstMedia = await readMediaEvidence(page);
  const firstReviewEnd = await page.evaluate(() => {
    performance.mark("g5-process-1-review-visible");
    return performance.now();
  });
  const firstEvidence = await readProcessEvidence(page, processStart, firstReviewEnd, firstMedia);
  console.log(JSON.stringify({ g5FirstEvidence: firstEvidence }));
  const observerSupported = await page.evaluate(() =>
    (window as Window & { __g5LongTaskObserverSupported?: boolean }).__g5LongTaskObserverSupported === true,
  );
  expect(observerSupported, "production Chromium exposes the long-task observer").toBe(true);
  assertMediaContract(firstMedia, false);
  expect(firstMedia.modelInitMs, "first import measures session initialization").toBeGreaterThan(0);
  expect(firstEvidence.processProgressMessageCount, "download progress is coalesced per process request").toBeLessThanOrEqual(40);
  expect(firstEvidence.overlappingLongTasks.filter((entry) => entry.duration > 50), "app dispatch through review has no UI long task over 50 ms").toEqual([]);

  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("character-import-review")).toHaveCount(0);
  const secondStart = await page.evaluate(() => {
    performance.mark("g5-process-2-start");
    return performance.now();
  });
  await page.getByTestId("onnx-input").setInputFiles(
    join(process.cwd(), "tests/fixtures/stick-character.png"),
  );
  await expect(page.getByTestId("character-import-review")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("character-import-media-summary").waitFor();
  const secondPreview = page.getByTestId("character-import-review").locator('img[alt="Imported character"]');
  await expect(secondPreview).toBeVisible();
  const secondPreviewBox = await secondPreview.boundingBox();
  expect(secondPreviewBox?.width ?? 0, "reused review thumbnail has visible bounded width").toBeGreaterThan(0);
  expect(secondPreviewBox?.width ?? Infinity, "reused review thumbnail stays compact").toBeLessThanOrEqual(320);
  expect(secondPreviewBox?.height ?? Infinity, "reused review thumbnail stays bounded in height").toBeLessThanOrEqual(128);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const secondMedia = await readMediaEvidence(page);
  const secondReviewEnd = await page.evaluate(() => {
    performance.mark("g5-process-2-review-visible");
    return performance.now();
  });
  const secondEvidence = await readProcessEvidence(page, secondStart, secondReviewEnd, secondMedia);
  assertMediaContract(secondMedia, true);
  expect(secondMedia.modelInitMs, "reused import does not recreate the model session").toBe(0);
  expect(secondEvidence.processProgressMessageCount, "reused request still has bounded progress reporting").toBeLessThanOrEqual(40);
  expect(secondEvidence.overlappingLongTasks.filter((entry) => entry.duration > 50), "sustained app dispatch through review has no UI long task over 50 ms").toEqual([]);
  const processMarkCount = await page.evaluate(() => performance.getEntriesByName("motionsmith-image-process-result").length);
  expect(processMarkCount, "warm completion is not counted as image processing").toBe(2);
  expect(pageErrors, "image import has no uncaught browser errors").toEqual([]);
  console.log(JSON.stringify({
    g5BrowserEvidence: {
      observerSupported,
      first: firstEvidence,
      second: secondEvidence,
      processResultMarkCount: processMarkCount,
    },
  }));
});

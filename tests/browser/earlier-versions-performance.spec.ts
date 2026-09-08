import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { dismissStartupAnnouncement } from "./startupHarness";
import { createDefaultSceneObject, createSampleProject, serializeProject } from "../../utils/project";
import type { ProjectState } from "../../types";
import {
  applyChromebookEmulation,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
} from "./chromebookAuditHarness";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import { CHROMEBOOK_ACCEPTANCE_THRESHOLDS, CHROMEBOOK_AUDIT_ENVIRONMENT } from "./chromebookAuditReport";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";
import {
  installVersionPerformanceInstrumentation,
  readStorage,
  readWorkerActivity,
  sampleHeap,
  type HeapSample,
  type StorageSnapshot,
  type VersionWorkerMetric,
  type WorkerRequest,
  type WorkerResponse,
} from "./earlierVersionsPerformanceHarness";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? "/";
const OUTPUT = process.env.EARLIER_VERSIONS_PERFORMANCE_OUTPUT ?? join(
  process.cwd(),
  "artifacts/earlier-versions/earlier-versions-performance.json",
);
type TimedAction = {
  label: "keep" | "read-preview" | "restore" | "save";
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  workerRequests: WorkerRequest[];
  workerResponses: WorkerResponse[];
};

const openThrottledPage = async (browser: Browser) => {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    deviceScaleFactor: CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
  });
  await installVersionPerformanceInstrumentation(context);
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();
  const client = await applyChromebookEmulation(page);
  await page.goto(APP_PATH, { waitUntil: "domcontentloaded" });
  await dismissStartupAnnouncement(page);
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  expect(await page.locator('script[src*="/@vite/client"]').count()).toBe(0);
  return { context, page, client };
};

const openFixture = async (page: Page, project: ProjectState) => {
  const entry = page.getByTestId("getting-started-dialog");
  const chooser = page.waitForEvent("filechooser");
  await entry.getByTestId("getting-started-open-project").click();
  await (await chooser).setFiles({
    name: "earlier-versions-performance.motionsmith",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(entry).toHaveCount(0);
  await expect(page.getByTestId("status-bar")).toContainText("Loaded project earlier-versions-performance.motionsmith");
};

const waitForReadyViewer = async (viewer: Locator) => {
  await expect(viewer).toHaveAttribute("data-three-renderer-status", "webgl", { timeout: 180_000 });
  await expect(viewer).toHaveAttribute("data-three-initial-scene-ready", "true", { timeout: 180_000 });
  await expect.poll(async () => Number(await viewer.getAttribute("data-part-count") ?? 0)).toBeGreaterThan(1);
};

const openVersions = async (page: Page) => {
  await page.getByTestId("workflow-stage-project").click();
  const panel = page.getByTestId("earlier-versions-panel");
  const lifecycle = page.getByTestId("project-lifecycle-panel");
  await expect.poll(async () => {
    if (await panel.count()) return "history";
    if (await lifecycle.count()) return "lifecycle";
    return "";
  }).not.toBe("");
  if (await lifecycle.count()) await lifecycle.getByTestId("project-earlier-versions").click();
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("earlier-versions-list")).toBeVisible();
};

const closeVersions = async (page: Page) => {
  const panel = page.getByTestId("earlier-versions-panel");
  if (await panel.count()) await panel.getByTestId("earlier-versions-close").click();
  await expect(page.getByTestId("project-lifecycle-panel")).toBeVisible();
};

const editHead = async (page: Page, rotation: number) => {
  await page.getByTestId("workflow-stage-character").click();
  await page.getByTestId("character-part-item-head").click();
  const field = page.getByTestId("stage-right-inspector").getByLabel("Rotation number", { exact: true });
  await field.fill(String(rotation));
  await field.press("Tab");
  await expect(field).toHaveValue(String(rotation));
};

const timeAction = async (
  page: Page,
  label: TimedAction["label"],
  action: () => Promise<void>,
  ready: () => Promise<void>,
): Promise<TimedAction> => {
  const startedAtMs = await page.evaluate(() => performance.now());
  await action();
  await ready();
  const endedAtMs = await page.evaluate(() => performance.now());
  const worker = await readWorkerActivity(page, startedAtMs, endedAtMs);
  return {
    label,
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    workerRequests: worker.requests,
    workerResponses: worker.responses,
  };
};

const keepVersion = async (page: Page, name: string) => {
  const panel = page.getByTestId("earlier-versions-panel");
  const field = page.getByLabel("Keep version name");
  await field.fill(name);
  const row = panel.locator('[data-version-reason="manual"]').filter({ hasText: name }).first();
  const action = await timeAction(page, "keep", () => panel.getByTestId("earlier-version-keep").click(), async () => {
    await expect(row).toHaveAttribute("data-version-status", "committed");
  });
  return { action, row };
};

const readPreview = async (page: Page, row: Locator) => {
  const preview = page.getByTestId("earlier-version-preview");
  const action = await timeAction(page, "read-preview", () => row.locator("[data-earlier-version-select]").click(), async () => {
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("earlier-version-viewing")).toHaveText("Viewing earlier version");
    await waitForReadyViewer(preview.getByTestId("project-three-puppet"));
  });
  return { action, preview };
};

const restorePreview = async (page: Page) => {
  const preview = page.getByTestId("earlier-version-preview");
  const action = await timeAction(page, "restore", async () => {
    const dialog = page.waitForEvent("dialog");
    await preview.getByTestId("earlier-version-restore").click();
    const confirmation = await dialog;
    await confirmation.accept();
  }, async () => {
    await expect(page.getByTestId("status-bar")).toContainText("Version restored. Current work was kept.");
    await expect(preview).toHaveCount(0);
    await expect(page.getByTestId("earlier-versions-panel").locator('[data-version-reason="restored"]')).toHaveCount(1);
  });
  return action;
};

const assetStorageReport = (storage: StorageSnapshot) => {
  const manifest = storage.manifest;
  const entries = manifest?.entries ?? [];
  const snapshotBytes = Object.values(manifest?.snapshotBytes ?? {}).reduce((sum, bytes) => sum + bytes, 0);
  const assetBytes = manifest?.assetBytes ?? {};
  const referenceCounts = new Map<string, number>();
  for (const entry of entries) for (const id of entry.assetIds ?? []) referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);
  const referencedAssetBytes = [...referenceCounts].reduce((sum, [id, count]) => sum + (assetBytes[id] ?? 0) * count, 0);
  const storedAssetBytes = Object.values(assetBytes).reduce((sum, bytes) => sum + bytes, 0);
  const entryBytes = Buffer.byteLength(JSON.stringify(entries));
  return {
    branchId: storage.branchId,
    entryCount: entries.length,
    keyCount: storage.keyCount,
    snapshotCount: Object.keys(manifest?.snapshotBytes ?? {}).length,
    snapshotBytes,
    entryBytes,
    storedAssetCount: Object.keys(assetBytes).length,
    storedAssetBytes,
    referencedAssetBytes,
    deduplicatedAssetBytesSaved: Math.max(0, referencedAssetBytes - storedAssetBytes),
    sharedAssetIds: [...referenceCounts].filter(([, count]) => count > 1).map(([id]) => id),
    catalog: storage.catalog,
  };
};

test.describe("Earlier versions performance", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

  test(`measures retained history at ${CHROMEBOOK_AUDIT_ENVIRONMENT.cpuThrottlingRate}x CPU`, async ({ browser }, testInfo) => {
    test.setTimeout(0);
    const session = await openThrottledPage(browser);
    const pageErrors: string[] = [];
    session.page.on("pageerror", error => pageErrors.push(error.message));
    await session.client.send("Performance.enable").catch(() => undefined);

    const actions: TimedAction[] = [];
    const retention: HeapSample[] = [];
    let savedFilename: string | undefined;
    try {
      const project = createSampleProject();
      project.metadata = { ...project.metadata, name: "Earlier versions performance" };
      const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
      const embeddedArtwork = `data:image/png;base64,${Buffer.concat([validPng, Buffer.alloc(3 * 1024 * 1024)]).toString("base64")}`;
      const artworkObject = { ...createDefaultSceneObject("block", "performance-artwork"), textureUrl: embeddedArtwork };
      project.sceneObjects = { ...project.sceneObjects, [artworkObject.id]: artworkObject };
      project.sceneObjectOrder = [...project.sceneObjectOrder, artworkObject.id];
      await openFixture(session.page, project);
      await session.page.getByTestId("workflow-stage-project").click();
      await waitForReadyViewer(session.page.getByTestId("project-three-puppet"));

      await openVersions(session.page);
      const first = await keepVersion(session.page, "Performance baseline");
      actions.push(first.action);
      await closeVersions(session.page);
      await editHead(session.page, 12);
      await openVersions(session.page);
      const second = await keepVersion(session.page, "Performance edit one");
      actions.push(second.action);
      await closeVersions(session.page);
      await editHead(session.page, 24);
      await openVersions(session.page);
      const third = await keepVersion(session.page, "Performance edit two");
      actions.push(third.action);

      const preview = await readPreview(session.page, first.row);
      actions.push(preview.action);
      actions.push(await restorePreview(session.page));

      await closeVersions(session.page);
      const saveButton = session.page.getByTestId("project-lifecycle-panel").getByRole("button", { name: "Save Project", exact: true });
      actions.push(await timeAction(session.page, "save", async () => {
        const download = session.page.waitForEvent("download");
        await saveButton.click();
        savedFilename = (await download).suggestedFilename();
      }, async () => undefined));

      await session.client.send("HeapProfiler.collectGarbage").catch(() => undefined);
      retention.push(await sampleHeap(session.page, session.client, "baseline-after-save"));
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        await openVersions(session.page);
        const panel = session.page.getByTestId("earlier-versions-panel");
        await expect(panel.locator("canvas"), "history rows do not mount per-row viewers").toHaveCount(0);
        await expect(session.page.getByTestId("earlier-version-preview")).toHaveCount(0);
        retention.push(await sampleHeap(session.page, session.client, `cycle-${cycle}-list`));
        const row = panel.locator('[data-version-reason="manual"]').filter({ hasText: "Performance baseline" }).first();
        await row.locator("[data-earlier-version-select]").click();
        const cyclePreview = session.page.getByTestId("earlier-version-preview");
        await expect(cyclePreview).toBeVisible();
        await waitForReadyViewer(cyclePreview.getByTestId("project-three-puppet"));
        retention.push(await sampleHeap(session.page, session.client, `cycle-${cycle}-preview`));
        await cyclePreview.getByTestId("earlier-version-back").click();
        await expect(session.page.getByTestId("earlier-version-preview")).toHaveCount(0);
        await panel.getByTestId("earlier-versions-close").click();
        await expect(session.page.getByTestId("project-lifecycle-panel")).toBeVisible();
        await waitForReadyViewer(session.page.getByTestId("project-three-puppet"));
        await session.client.send("HeapProfiler.collectGarbage");
        retention.push(await sampleHeap(session.page, session.client, `cycle-${cycle}-after-close`));
      }

      await expect.poll(async () => (await readStorage(session.page)).manifest?.entries?.length ?? 0).toBeGreaterThanOrEqual(3);
      const finalStorage = await readStorage(session.page);
      const storageReport = assetStorageReport(finalStorage);
      expect(storageReport.entryCount).toBeGreaterThanOrEqual(3);
      expect(storageReport.sharedAssetIds.length).toBeGreaterThan(0);
      expect(savedFilename).toBeTruthy();
      expect(pageErrors).toEqual([]);
      const workerMetrics = await session.page.evaluate(() => {
        const state = (window as Window & {
          __MOTIONSMITH_EARLIER_VERSIONS_PERF__?: { workers: VersionWorkerMetric[] };
        }).__MOTIONSMITH_EARLIER_VERSIONS_PERF__;
        return state?.workers ?? [];
      });
      const observedResponses = workerMetrics.flatMap(worker => worker.responses);
      for (const type of ['capture', 'read', 'download']) {
        expect(observedResponses.some(response => response.type === type &&
          response.workerDurationMs !== null && response.roundTripMs !== null),
        `${type} has an observed Worker duration and round trip`).toBe(true);
      }
      const environment = await collectChromebookRuntimeEnvironment(
        session.page,
        browser.version(),
        "navigation-and-action",
      );
      const baseURL = testInfo.project.use.baseURL;
      if (typeof baseURL !== "string") throw new Error("Earlier versions audit requires a preview base URL");
      const maxProjectPuppetCount = Math.max(0, ...retention.map(sample => sample.projectPuppetCount));
      const maxLiveVersionWorkerCount = Math.max(0, ...retention.map(sample => sample.liveVersionWorkerCount));
      const heapValues = retention.filter(sample => sample.phase === 'baseline-after-save' || sample.phase.endsWith('after-close')).map(sample => sample.jsHeapUsedSize)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const firstHeapBytes = heapValues[0] ?? null;
      const lastHeapBytes = heapValues[heapValues.length - 1] ?? null;
      const tailHeapValues = heapValues.slice(-3);
      const allowedHeapGrowthBytes = firstHeapBytes === null
        ? null
        : Math.max(
            firstHeapBytes * CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
            CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
          );
      const heapGrowthBytes = firstHeapBytes !== null && lastHeapBytes !== null
        ? lastHeapBytes - firstHeapBytes
        : null;
      const tailRangeBytes = tailHeapValues.length
        ? Math.max(...tailHeapValues) - Math.min(...tailHeapValues)
        : null;
      const heapStable = allowedHeapGrowthBytes !== null && heapGrowthBytes !== null &&
        tailHeapValues.length >= 3 && heapGrowthBytes <= allowedHeapGrowthBytes &&
        (tailRangeBytes ?? Number.POSITIVE_INFINITY) <= allowedHeapGrowthBytes;
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        profile: CHROMEBOOK_AUDIT_PROFILE.name,
        resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
        productionBuild: true,
        actualChromebookTested: false,
        provenance: await collectChromebookAuditProvenance(baseURL),
        environment,
        cpuThrottleScope: CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottleDisclosure,
        workerTimingScope: "Version worker timings are observed from the page; the CDP CPU/network emulation is attached to the main page target only.",
        workerMetrics,
        fixture: { embeddedArtworkBytes: Buffer.byteLength(embeddedArtwork) },
        actions,
        storage: storageReport,
        retention: {
          samples: retention,
          baseline: retention[0],
          final: retention[retention.length - 1],
          maxProjectPuppetCount,
          maxCanvasCount: Math.max(0, ...retention.map(sample => sample.canvasCount)),
          maxLiveVersionWorkerCount,
          noPerRowViewers: retention.every(sample => sample.panelCanvasCount === 0),
        },
        memory: {
          source: "CDP Performance.getMetrics JSHeapUsedSize",
          firstBytes: firstHeapBytes,
          lastBytes: lastHeapBytes,
          growthBytes: heapGrowthBytes,
          allowedGrowthBytes: allowedHeapGrowthBytes,
          tailRangeBytes,
          stable: heapStable,
          thresholds: {
            growthRatio: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthRatio,
            growthFloorBytes: CHROMEBOOK_ACCEPTANCE_THRESHOLDS.heapGrowthFloorBytes,
          },
        },
        acceptance: {
          noPerRowViewers: { passed: retention.every(sample => sample.panelCanvasCount === 0), observed: retention.every(sample => sample.panelCanvasCount === 0), limit: true },
          singleProjectViewer: { passed: maxProjectPuppetCount <= 1, observed: maxProjectPuppetCount, limit: 1 },
          singleLiveVersionWorker: { passed: maxLiveVersionWorkerCount <= 1, observed: maxLiveVersionWorkerCount, limit: 1 },
          heapStable: { passed: heapStable, observed: heapStable, limit: true },
        },
        savedFilename,
        pageErrors,
      };
      const json = `${JSON.stringify(report, null, 2)}\n`;
      const testOutput = testInfo.outputPath("earlier-versions-performance.json");
      await writeFile(testOutput, json, "utf8");
      await testInfo.attach("earlier-versions-performance", { path: testOutput, contentType: "application/json" });
      await mkdir(dirname(OUTPUT), { recursive: true });
      await writeFile(OUTPUT, json, "utf8");
      expect(report.retention.noPerRowViewers).toBe(true);
      expect(report.acceptance.singleProjectViewer.passed).toBe(true);
      expect(report.acceptance.singleLiveVersionWorker.passed).toBe(true);
      if (ENFORCE) expect(report.acceptance.heapStable.passed).toBe(true);
    } finally {
      await session.client.detach().catch(() => undefined);
      await session.context.close().catch(() => undefined);
    }
  });
});

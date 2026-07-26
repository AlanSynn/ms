import { expect, test, type Page, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createSampleProject, serializeProject } from "../../utils/project";

type Batch = {
  batchId: string;
  eventSchema: string;
  snapshotSchema: string;
  buildSha: string;
  deployment: string;
  profile: string;
  classId: string;
  classSessionId: string;
  teamId: string;
  participantId: string;
  records: Array<{ type: string; stage?: string; data?: unknown }>;
};

const decodeBatch = (request: Request): Batch => {
  const body = request.postDataBuffer() ?? Buffer.alloc(0);
  const decoded = request.headers()["content-encoding"] === "gzip" ? gunzipSync(body) : body;
  return JSON.parse(decoded.toString("utf8")) as Batch;
};

const completeSnapshotIdsFromRecords = (
  records: Batch["records"],
) => {
  return new Set(records.flatMap((record) => {
    if (record.type !== "project.snapshot.begin") return [];
    const begin = record.data as { snapshotId?: string; total?: number };
    if (!begin.snapshotId || !begin.total) return [];
    const chunks = new Set(records
      .filter((candidate) => candidate.type === "project.snapshot.chunk")
      .map((candidate) => candidate.data as { snapshotId?: string; index?: number })
      .filter((candidate) => candidate.snapshotId === begin.snapshotId)
      .map((candidate) => candidate.index));
    return chunks.size === begin.total ? [begin.snapshotId] : [];
  }));
};

const completeSnapshotIds = (batches: Batch[]) =>
  completeSnapshotIdsFromRecords(batches.flatMap((batch) => batch.records));

const exitCheckpoint = (page: Page, pagehides = 0) => page.evaluate((count) => {
  for (let index = 0; index < count; index += 1) {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
  }
  const raw = localStorage.getItem("motionsmith.study.exit.v1");
  const parsed = raw ? JSON.parse(raw) as {
    batches?: Array<{ batchId?: string; json?: string }>;
  } : undefined;
  const records = (parsed?.batches ?? []).flatMap((batch) => {
    try {
      return (JSON.parse(batch.json ?? "") as {
        records?: Array<{ type: string; stage?: string; data?: unknown }>;
      }).records ?? [];
    } catch {
      return [];
    }
  });
  return {
    batchIds: (parsed?.batches ?? []).flatMap((batch) =>
      batch.batchId ? [batch.batchId] : []),
    records,
  };
}, pagehides);

const queuedSnapshotIds = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("motionsmith-study", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const request = db.transaction("outbox", "readonly")
    .objectStore("outbox")
    .getAll();
  const items = await new Promise<Array<{
    deliveryClass?: string;
    snapshotKey?: string;
  }>>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const counts = new Map<string, number>();
  items.forEach((item) => {
    if (item.deliveryClass !== "snapshot" || !item.snapshotKey) return;
    counts.set(item.snapshotKey, (counts.get(item.snapshotKey) ?? 0) + 1);
  });
  return [...counts].flatMap(([snapshotKey, count]) => {
    const snapshotId = /:(snp_[0-9a-f-]{36})$/.exec(snapshotKey)?.[1];
    return count > 1 && snapshotId ? [snapshotId] : [];
  });
});

const largeProject = () => {
  const project = createSampleProject();
  project.settings.autosave = false;
  project.partOrder.forEach((id) => {
    project.parts[id].textureUrl = undefined;
  });
  const template = Object.values(project.paths)[0]!;
  project.paths = Object.fromEntries(
    Array.from({ length: 12 }, (_, pathIndex) => {
      const id = `large-path-${pathIndex}`;
      return [id, {
        ...template,
        id,
        points: Array.from({ length: 3_000 }, (__, pointIndex) => ({
          x: pointIndex / 5,
          y: Math.sin((pointIndex + pathIndex) / 9) * 120,
        })),
      }];
    }),
  );
  return project;
};

test("capture profiles emit only their allowed records and assets", async ({ page }) => {
  const profile = process.env.VITE_STUDY_PROFILE ?? "off";
  test.skip(profile === "off", "requires an enabled telemetry profile");
  const batches: Batch[] = [];
  let assets = 0;

  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/batch", (route) => {
    batches.push(decodeBatch(route.request()));
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
  });
  await page.route("**/ms-study/v1/asset", (route) => {
    assets += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
  });

  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  const project = createSampleProject();
  project.parts[project.partOrder[0]].textureUrl =
    `data:image/png;base64,${readFileSync("resources/examples/thumbs/girl-thumb.png").toString("base64")}`;
  await page.getByTestId("getting-started-import-input").setInputFiles({
    name: "profile-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await page.getByTestId("workspace-steps")
    .getByRole("button", { name: /Options/i })
    .click();
  await expect.poll(() => batches.length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(
    () => batches.flatMap((batch) => batch.records)
      .some((record) => record.type === "session.start"),
    { timeout: 20_000 },
  ).toBe(true);

  if (profile !== "metrics") {
    await expect.poll(
      () => batches.flatMap((batch) => batch.records)
        .some((record) => record.type.startsWith("project.snapshot")),
      { timeout: 20_000 },
    ).toBe(true);
  }
  if (profile === "study") {
    await expect.poll(() => assets, { timeout: 20_000 }).toBeGreaterThan(0);
  }

  const records = batches.flatMap((batch) => batch.records);
  expect(batches.every((batch) => batch.profile === profile)).toBe(true);
  if (profile === "metrics") {
    expect(records.some((record) =>
      record.type === "project.replace"
      || record.type === "project.action"
      || record.type.startsWith("project.snapshot")
      || record.type === "ui.activate"
      || record.type === "ui.change"
      || record.type.startsWith("ui.pointer"),
    )).toBe(false);
    expect(assets).toBe(0);
  } else if (profile === "replay") {
    expect(records.some((record) =>
      record.type === "project.replace"
      || record.type.startsWith("project.snapshot"),
    )).toBe(true);
    expect(records.some((record) => record.type.startsWith("asset."))).toBe(false);
    expect(assets).toBe(0);
  }
});

test("study profile stays responsive, strips assignment query, batches, and retries offline work", async ({ page, context }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  const batches: Batch[] = [];
  const assets: Array<{ metadata: Record<string, unknown>; bytes: number; type: string }> = [];
  const encodings: string[] = [];
  let bugRequests = 0;
  let bugFails = false;
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/asset", (route) => {
    const request = route.request();
    assets.push({
      metadata: JSON.parse(Buffer.from(request.headers()["x-motionsmith-meta"], "base64url").toString("utf8")) as Record<string, unknown>,
      bytes: request.postDataBuffer()?.byteLength ?? 0,
      type: request.headers()["content-type"],
    });
    return route.fulfill({ status: 201, contentType: "application/json", body: "{\"ok\":true}" });
  });
  await page.route("**/ms-study/v1/bug", (route) => {
    bugRequests += 1;
    if (bugFails) return route.abort("failed");
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ issueUrl: "https://github.com/AlanSynn/ms/issues/42" }),
    });
  });
  await page.route("**/ms-study/v1/batch", async (route) => {
    batches.push(decodeBatch(route.request()));
    encodings.push(route.request().headers()["content-encoding"] ?? "identity");
    if (batches.length === 1) await firstBlocked;
    await route.fulfill({ status: 201, contentType: "application/json", body: "{\"ok\":true}" });
  });

  await page.goto("/?msParticipant=pupil-17&msTeam=team-4&msClass=class-2&msSession=lesson-8&keep=yes");
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  // First batch follows session.start. The study build compiles ONNX + Rapier wasm
  // and mounts the heavy Foundry workspace right after the boot-loader clears, so the
  // flush setTimeout can be starved for a few seconds until the main thread yields.
  // 20s covers that post-boot burst while still catching a genuine delivery regression.
  await expect.poll(() => batches.length, { timeout: 20_000 }).toBeGreaterThan(0);

  const url = new URL(page.url());
  expect(url.searchParams.get("keep")).toBe("yes");
  for (const key of ["msParticipant", "msTeam", "msClass", "msSession"]) expect(url.searchParams.has(key)).toBe(false);

  const welcome = page.getByTestId("getting-started-dialog");
  const project = createSampleProject();
  const rawProjectId = project.metadata.id;
  project.partOrder.forEach((id) => { project.parts[id].textureUrl = undefined; });
  project.parts[project.partOrder[0]].textureUrl = `data:image/png;base64,${readFileSync("resources/examples/thumbs/girl-thumb.png").toString("base64")}`;
  await welcome.getByTestId("getting-started-import-input").setInputFiles({
    name: "anonymous-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(welcome).toHaveCount(0);
  await page.getByTestId("workspace-steps").getByRole("button", { name: /Character/i }).click();
  await page.getByTestId("scene-object-image-input").setInputFiles({
    name: "anonymous-object.png",
    mimeType: "image/png",
    buffer: readFileSync("resources/examples/thumbs/boy-thumb.png"),
  });
  await page.getByTestId("workspace-steps").getByRole("button", { name: /Options/i }).click();
  await expect(page.locator("h2.current-stage-title")).toHaveText("Options");
  releaseFirst();

  await expect.poll(() => batches.flatMap((batch) => batch.records).some((record) => record.type === "stage.view" && record.stage === "options"), { timeout: 15_000 }).toBe(true);
  expect(batches.every((batch) => batch.deployment === "browser-test")).toBe(true);
  expect(batches.every((batch) => batch.eventSchema === "motionsmith-study-event-v1" && batch.snapshotSchema === "motionsmith-study-snapshot-v1" && batch.buildSha === "local")).toBe(true);
  expect(batches.every((batch) => batch.participantId === "pupil-17" && batch.teamId === "team-4" && batch.classId === "class-2" && batch.classSessionId === "lesson-8")).toBe(true);
  expect(encodings).toContain("gzip");
  expect(JSON.stringify(batches)).not.toMatch(/sourceImageName|student-face|data:image|userAgent/i);
  expect(JSON.stringify(batches)).not.toContain(rawProjectId);
  await expect.poll(() => assets.map((asset) => asset.metadata.kind), { timeout: 15_000 }).toEqual(expect.arrayContaining(["character_part", "object"]));
  expect(assets.every((asset) => asset.bytes > 0 && asset.bytes <= 192 * 1024 && ["image/webp", "image/png"].includes(asset.type))).toBe(true);
  expect(JSON.stringify(assets)).not.toMatch(/anonymous-project|anonymous-object|sourceImageName/i);

  await page.getByTestId("bug-report-button").click();
  const report = page.getByTestId("bug-report-overlay");
  await report.getByLabel("What broke?").fill("Playback stopped");
  await report.getByLabel("What did you do?").fill("Opened Options after editing an object.");
  await report.getByLabel("What should happen?").fill("Playback should continue.");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByRole("status")).toHaveText("Report sent");
  expect(bugRequests).toBe(1);
  bugFails = true;
  await report.getByLabel("What broke?").fill("Playback stopped again");
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByRole("status")).toHaveText("Open GitHub to finish report");
  await expect(report.getByRole("link", { name: /Open GitHub/ })).toBeVisible();
  expect(bugRequests).toBe(2);

  const beforeOffline = batches.length;
  await context.setOffline(true);
  await page.getByTestId("workspace-steps").getByRole("button", { name: /Character/i }).click();
  await expect(page.locator("h2.current-stage-title")).toHaveText("Character");
  await page.waitForTimeout(2_500);
  expect(batches.length).toBe(beforeOffline);

  await context.setOffline(false);
  await page.waitForTimeout(1_000);
  expect(batches.length, "reconnect uses a jitter window instead of bursting immediately").toBe(beforeOffline);
  await expect.poll(() => batches.length, { timeout: 15_000 }).toBeGreaterThan(beforeOffline);
  await page.waitForTimeout(2_000);
  const settled = batches.length;
  await page.waitForTimeout(11_000);
  expect(
    batches.slice(settled).every((batch) => batch.records.length > 0),
    "adaptive recovery sends queued data, never empty polling traffic",
  ).toBe(true);

  const checkpoint = await exitCheckpoint(page, 2);
  expect(checkpoint.batchIds.length).toBeGreaterThanOrEqual(2);
  expect(
    checkpoint.records.filter((record) => record.type === "session.pagehide").length,
    "back-to-back exit flushes merge instead of overwriting the first checkpoint",
  ).toBe(2);
  await expect.poll(() => batches.flatMap((batch) => batch.records).some((record) => record.type === "session.pagehide"), { timeout: 15_000 }).toBe(true);
});

test("large final snapshot survives collector outage and page exit @study-performance", async ({ page, context }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  const delivered: Batch[] = [];
  let collectorAvailable = false;

  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/batch", (route) => {
    if (!collectorAvailable) return route.abort("failed");
    delivered.push(decodeBatch(route.request()));
    return route.fulfill({ status: 201, contentType: "application/json", body: "{\"ok\":true}" });
  });

  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  const project = largeProject();
  await page.getByTestId("getting-started-import-input").setInputFiles({
    name: "large-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("getting-started-dialog")).toHaveCount(0);
  await expect.poll(
    async () => (await queuedSnapshotIds(page)).length,
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
  collectorAvailable = true;
  await page.reload();
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  await expect.poll(() => {
    return completeSnapshotIds(delivered).size > 0;
  }, { timeout: 120_000 }).toBe(true);

  const recoveredSnapshots = completeSnapshotIds(delivered);
  collectorAvailable = false;
  const reloadedWelcome = page.getByTestId("getting-started-dialog");
  await expect(reloadedWelcome).toBeVisible();
  await reloadedWelcome.getByTestId("getting-started-import-input").setInputFiles({
    name: "large-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(reloadedWelcome).toHaveCount(0);
  await expect.poll(
    async () => (await queuedSnapshotIds(page))
      .filter((id) => !recoveredSnapshots.has(id)).length,
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
  const initialSnapshots = new Set([
    ...recoveredSnapshots,
    ...await queuedSnapshotIds(page),
  ]);
  await page.getByTestId("workspace-steps").getByRole("button", { name: /Options/i }).click();
  await expect(page.locator("h2.current-stage-title")).toHaveText("Options");
  const pause = page.getByTestId("workspace-player-dock")
    .getByRole("button", { name: "Pause" });
  if (await pause.isVisible()) await pause.click();
  await page.waitForTimeout(15_500);

  const cdp = await context.newCDPSession(page);
  await page.evaluate(() => {
    const state = window as Window & {
      __studyLongTasks?: Array<{ startTime: number; duration: number }>;
      __studyLongTaskObserver?: PerformanceObserver;
    };
    state.__studyLongTasks = [];
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      state.__studyLongTaskObserver = new PerformanceObserver((list) => {
        state.__studyLongTasks?.push(
          ...list.getEntries().map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          })),
        );
      });
      state.__studyLongTaskObserver.observe({ type: "longtask" });
    }
  });
  const samples: Array<{
    measurementStartedAt: number;
    handoff: number;
    handoffStartedAt: number;
    commit: number;
    commitStartedAt: number;
    longTasks: Array<{ startTime: number; duration: number }>;
    longTaskSupported: boolean;
  }> = [];
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  try {
    for (let index = 0; index < 3; index += 1) {
      if (index) await page.waitForTimeout(15_500);
      const measurementStartedAt = await page.evaluate(() => {
        performance.clearMeasures("motionsmith.study.snapshot.handoff");
        performance.clearMeasures("motionsmith.study.snapshot.commit");
        return performance.now();
      });
      await page.getByLabel("Duration number").fill(String(7 + index));
      await expect.poll(
        () => page.evaluate(() =>
          performance.getEntriesByName(
            "motionsmith.study.snapshot.commit",
            "measure",
          ).length),
        { timeout: 20_000 },
      ).toBeGreaterThan(0);
      await page.waitForTimeout(100);
      samples.push(await page.evaluate((startedAt) => {
        const latest = (name: string) => {
          const entry = performance
            .getEntriesByName(name, "measure")
            .at(-1);
          return {
            duration: entry?.duration ?? Infinity,
            startTime: entry?.startTime ?? Infinity,
          };
        };
        const state = window as Window & {
          __studyLongTasks?: Array<{ startTime: number; duration: number }>;
        };
        const handoff = latest("motionsmith.study.snapshot.handoff");
        const commit = latest("motionsmith.study.snapshot.commit");
        return {
          measurementStartedAt: startedAt,
          handoff: handoff.duration,
          handoffStartedAt: handoff.startTime,
          commit: commit.duration,
          commitStartedAt: commit.startTime,
          longTasks: (state.__studyLongTasks ?? []).filter(
            (entry) => entry.startTime >= startedAt,
          ),
          longTaskSupported:
            PerformanceObserver.supportedEntryTypes.includes("longtask"),
        };
      }, measurementStartedAt));
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  const phases = samples.flatMap(({ handoff, commit }) => [handoff, commit]);
  const p95 = [...phases].sort((a, b) => a - b)[
    Math.ceil(phases.length * 0.95) - 1
  ];
  const maxLongTask = Math.max(
    0,
    ...samples.flatMap((sample) =>
      sample.longTasks.map((entry) => entry.duration)),
  );
  const sampleSnapshots = (await queuedSnapshotIds(page))
    .filter((snapshotId) => !initialSnapshots.has(snapshotId));
  console.log("study snapshot main-thread @6x", JSON.stringify({
    samples,
    p95,
    maxLongTask,
  }));
  expect(samples.every((sample) => sample.longTaskSupported)).toBe(true);
  expect(
    sampleSnapshots.length,
    "constrained recovery keeps the newest complete snapshot generation",
  ).toBeGreaterThan(0);
  expect(
    Math.max(...phases),
    `snapshot main-thread phases at 6× CPU: ${JSON.stringify(samples)}`,
  ).toBeLessThan(50);
  expect(p95).toBeLessThan(50);
  expect(
    maxLongTask,
    `interaction long tasks at 6× CPU: ${JSON.stringify(samples)}`,
  ).toBeLessThan(50);
});

test("page exit checkpoints a large import while its snapshot Worker is still pending", async ({ page }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class PendingStudyWorker extends NativeWorker {
      postMessage(): void {
        // Keep snapshot preparation pending until the page is gone. The exit path
        // must not depend on a Worker callback that the browser may never deliver.
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: PendingStudyWorker,
    });
  });
  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/batch", (route) => {
    return route.abort("failed");
  });

  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  await page.getByTestId("getting-started-import-input").setInputFiles({
    name: "exit-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(largeProject())),
  });
  const checkpoint = await exitCheckpoint(page, 1);
  expect(
    completeSnapshotIdsFromRecords(checkpoint.records).size,
    "exit fallback stores every chunk of the imported project",
  ).toBeGreaterThan(0);
  expect(checkpoint.records.some((record) => record.type === "project.replace"))
    .toBe(true);

  await page.reload();
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  await expect.poll(
    async () => (await queuedSnapshotIds(page)).length,
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
});

test("page exit includes a batch already reserved by a normal flush", async ({ page }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  const delivered: Batch[] = [];
  await page.addInitScript(() => {
    if (sessionStorage.getItem("motionsmith.test.blocked-compression")) return;
    Math.random = () => 1;
    class PendingCompressionStream {
      readable: ReadableStream;
      writable: WritableStream;

      constructor() {
        const decoder = new TextDecoder();
        let json = "";
        const stream = new TransformStream({
          transform(chunk: Uint8Array) {
            json += decoder.decode(chunk, { stream: true });
          },
          flush() {
            json += decoder.decode();
            const batch = JSON.parse(json) as { batchId: string };
            (window as Window & {
              __blockedStudyBatchId?: string;
            }).__blockedStudyBatchId = batch.batchId;
            sessionStorage.setItem(
              "motionsmith.test.blocked-compression",
              "true",
            );
            return new Promise<void>(() => {});
          },
        });
        this.readable = stream.readable;
        this.writable = stream.writable;
      }
    }
    Object.defineProperty(window, "CompressionStream", {
      configurable: true,
      value: PendingCompressionStream,
    });
  });
  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/batch", (route) => {
    delivered.push(decodeBatch(route.request()));
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
  });

  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  const welcome = page.getByTestId("getting-started-dialog");
  if (await welcome.count()) {
    await welcome.getByRole("button", { name: "Close" }).click();
  }
  for (let index = 0; index < 12; index += 1) {
    const stage = index % 2 ? /Character/i : /Options/i;
    await page.getByTestId("workspace-steps").getByRole("button", {
      name: stage,
    }).click();
  }
  await expect.poll(
    () => page.evaluate(() =>
      (window as Window & {
        __blockedStudyBatchId?: string;
      }).__blockedStudyBatchId),
    { timeout: 20_000 },
  ).toBeTruthy();
  const blockedBatchId = await page.evaluate(() =>
    (window as Window & {
      __blockedStudyBatchId?: string;
    }).__blockedStudyBatchId);
  const checkpoint = await exitCheckpoint(page, 1);
  expect(
    checkpoint.batchIds,
    "the exit checkpoint keeps the exact batch reserved before compression",
  ).toContain(blockedBatchId);

  await page.reload();
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  await expect.poll(
    () => delivered.some((batch) => batch.batchId === blockedBatchId),
    { timeout: 30_000 },
  ).toBe(true);
});

test("a replacement invalidates an older prepared snapshot before page exit", async ({ page }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  await page.route("**/onnx/pose_model.int8.ort", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.alloc(1_000_001, 1),
  }));
  await page.route("**/ms-study/v1/batch", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: "{\"ok\":true}",
  }));

  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  const welcome = page.getByTestId("getting-started-dialog");
  if (await welcome.count()) {
    await welcome.getByRole("button", { name: "Close" }).click();
  }
  await expect.poll(
    () => page.evaluate(() =>
      performance.getEntriesByName(
        "motionsmith.study.snapshot.commit",
        "measure",
      ).length),
    { timeout: 20_000 },
  ).toBeGreaterThan(0);

  await page.getByTestId("workspace-steps")
    .getByRole("button", { name: /Options/i })
    .click();
  let commitStartedAt = await page.evaluate(() =>
    performance.getEntriesByName(
      "motionsmith.study.snapshot.commit",
      "measure",
    ).at(-1)?.startTime ?? 0);
  await page.getByLabel("Duration number").fill("4");
  await expect.poll(
    () => page.evaluate(() =>
      performance.getEntriesByName(
        "motionsmith.study.snapshot.commit",
        "measure",
      ).at(-1)?.startTime ?? 0),
    { timeout: 20_000 },
  ).toBeGreaterThan(commitStartedAt);

  commitStartedAt = await page.evaluate(() =>
    performance.getEntriesByName(
      "motionsmith.study.snapshot.commit",
      "measure",
    ).at(-1)?.startTime ?? 0);
  await page.getByTestId("workspace-steps")
    .getByRole("button", { name: /Character/i })
    .click();
  await expect.poll(
    () => page.evaluate(() =>
      performance.getEntriesByName(
        "motionsmith.study.snapshot.commit",
        "measure",
      ).at(-1)?.startTime ?? 0),
    { timeout: 20_000 },
  ).toBeGreaterThan(commitStartedAt);
  await page.evaluate(() => {
    Worker.prototype.postMessage = () => {};
  });

  const replacement = createSampleProject();
  replacement.settings.animationDurationMs = 9_900;
  await page.getByTestId("onboarding-import-input").setInputFiles({
    name: "replacement.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(replacement)),
  });
  const checkpoint = await exitCheckpoint(page, 1);
  const durations = checkpoint.records.flatMap((record) => {
    if (record.type !== "project.snapshot") return [];
    const state = (record.data as {
      state?: { settings?: { animationDurationMs?: number } };
    }).state;
    return state?.settings?.animationDurationMs ?? [];
  });
  expect(durations).toContain(9_900);
  expect(durations, "the prepared pre-replacement snapshot is discarded")
    .not.toContain(4_000);
});

test("off profile emits no telemetry", async ({ page }) => {
  test.skip(Boolean(process.env.VITE_STUDY_PROFILE && process.env.VITE_STUDY_PROFILE !== "off"), "requires default/off build");
  let requests = 0;
  await page.route("**/ms-study/v1/{batch,asset}", (route) => {
    requests += 1;
    return route.fulfill({ status: 201, contentType: "application/json", body: "{\"ok\":true}" });
  });
  await page.goto("/");
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  const welcome = page.getByTestId("getting-started-dialog");
  if (await welcome.count()) await welcome.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("workspace-steps").getByRole("button", { name: /Options/i }).click();
  await page.waitForTimeout(3_000);
  expect(requests).toBe(0);
});

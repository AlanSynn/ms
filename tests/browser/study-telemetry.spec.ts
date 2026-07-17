import { expect, test, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createSampleProject, serializeProject } from "../../utils/project";

type Batch = {
  eventSchema: string;
  snapshotSchema: string;
  buildSha: string;
  deployment: string;
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

test("study profile stays responsive, strips assignment query, batches, and retries offline work", async ({ page, context }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  const batches: Batch[] = [];
  const assets: Array<{ metadata: Record<string, unknown>; bytes: number; type: string }> = [];
  const encodings: string[] = [];
  let bugRequests = 0;
  let bugFails = false;
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await page.route("**/onnx/pose_model.onnx", (route) => route.fulfill({
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
  await expect.poll(() => batches.length, { timeout: 15_000 }).toBeGreaterThan(beforeOffline);
  await page.waitForTimeout(2_000);
  const settled = batches.length;
  await page.waitForTimeout(11_000);
  expect(batches.length, "no polling traffic while idle").toBe(settled);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => batches.flatMap((batch) => batch.records).some((record) => record.type === "session.pagehide"), { timeout: 15_000 }).toBe(true);
});

test("large final snapshot survives collector outage and page exit", async ({ page }) => {
  test.skip(process.env.VITE_STUDY_PROFILE !== "study", "requires study-enabled build");
  const delivered: Batch[] = [];
  let collectorAvailable = false;

  await page.route("**/onnx/pose_model.onnx", (route) => route.fulfill({
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
  const project = createSampleProject();
  project.settings.autosave = false;
  project.partOrder.forEach((id) => { project.parts[id].textureUrl = undefined; });
  const template = Object.values(project.paths)[0]!;
  project.paths = Object.fromEntries(Array.from({ length: 12 }, (_, pathIndex) => {
    const id = `large-path-${pathIndex}`;
    return [id, {
      ...template,
      id,
      points: Array.from({ length: 3_000 }, (__, pointIndex) => ({
        x: pointIndex / 5,
        y: Math.sin((pointIndex + pathIndex) / 9) * 120,
      })),
    }];
  }));
  await page.getByTestId("getting-started-import-input").setInputFiles({
    name: "large-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("getting-started-dialog")).toHaveCount(0);
  collectorAvailable = true;
  await page.reload();
  await expect(page.locator("#boot-loader")).toHaveCount(0, { timeout: 180_000 });
  await expect.poll(() => {
    const records = delivered.flatMap((batch) => batch.records);
    return records.some((record) => {
      if (record.type !== "project.snapshot.begin") return false;
      const begin = record.data as { snapshotId?: string; total?: number };
      if (!begin.snapshotId || !begin.total || begin.total < 2) return false;
      const chunks = new Set(records
        .filter((candidate) => candidate.type === "project.snapshot.chunk")
        .map((candidate) => candidate.data as { snapshotId?: string; index?: number })
        .filter((candidate) => candidate.snapshotId === begin.snapshotId)
        .map((candidate) => candidate.index));
      return chunks.size === begin.total;
    });
  }, { timeout: 30_000 }).toBe(true);
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

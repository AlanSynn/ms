import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const raw = join(here, "raw");
const screenshots = join(here, "screenshots");
const runId = process.env.MS_AUDIT_RUN_ID ?? "runtime-headful";
const output = join(raw, `${runId}.json`);
const tracePath = join(raw, `${runId}-trace.zip`);
const baseUrl = process.env.MS_AUDIT_URL ?? "http://127.0.0.1:4173";
const chromePath = process.env.MS_AUDIT_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const run = {
  schemaVersion: 1,
  baseline: process.env.MS_AUDIT_BASELINE ?? "97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af",
  command: process.argv.join(" "),
  baseUrl,
  chromePath,
  startedAt: new Date().toISOString(),
  mode: { requested: "headed-visible-foreground", actual: "unverified" },
  platform: {},
  foreground: {},
  browser: {},
  scenarios: [],
  errors: [],
  tracePath,
};

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const asError = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const write = async () => writeFile(output, `${JSON.stringify(run, null, 2)}\n`);
const command = (file, args) => {
  try {
    return { ok: true, value: execFileSync(file, args, { encoding: "utf8", timeout: 2_000 }).trim() };
  } catch (error) {
    return { ok: false, error: asError(error) };
  }
};
const appleScript = (script) => command("osascript", ["-e", script]);
const numberDelta = (after, before, field) => (after?.[field] ?? 0) - (before?.[field] ?? 0);

const totalsDelta = (before, after) => {
  const fields = [
    "trackedContexts",
    "attachedContexts",
    "nonLostContexts",
    "detachedNonLostContexts",
    "drawCalls",
    "estimatedTriangles",
    "clearCalls",
    "shaderCompiles",
    "programLinks",
    "livePrograms",
    "liveTextures",
    "estimatedTextureBytes",
  ];
  return Object.fromEntries(fields.map((field) => [field, numberDelta(after?.totals, before?.totals, field)]));
};

const contextDelta = (before, after) => after.contexts.map((context) => {
  const previous = before.contexts.find((candidate) => candidate.id === context.id) ?? {};
  return {
    id: context.id,
    attached: context.attached,
    contextLost: context.contextLost,
    drawCalls: numberDelta(context, previous, "drawCalls"),
    estimatedTriangles: numberDelta(context, previous, "estimatedTriangles"),
    clearCalls: numberDelta(context, previous, "clearCalls"),
    shaderCompiles: numberDelta(context, previous, "shaderCompiles"),
    programLinks: numberDelta(context, previous, "programLinks"),
    textureCreates: numberDelta(context, previous, "textureCreates"),
    textureDeletes: numberDelta(context, previous, "textureDeletes"),
    estimatedTextureBytes: numberDelta(context, previous, "estimatedTextureBytes"),
  };
});

const pageMemory = async (page, session) => {
  const values = await session.send("Performance.getMetrics").catch((error) => ({ error: asError(error) }));
  const pageValues = await page.evaluate(async () => {
    const memory = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null;
    const uaMemory = typeof performance.measureUserAgentSpecificMemory === "function"
      ? await performance.measureUserAgentSpecificMemory().then((value) => ({ bytes: value.bytes })).catch((error) => ({ error: String(error) }))
      : { unavailable: true };
    return { memory, uaMemory };
  });
  return { cdp: values, page: pageValues };
};

const auditSnapshot = (page) => page.evaluate(() => window.__MS_GPU_AUDIT__.snapshot());

const focusEvidence = async (page) => {
  await page.bringToFront();
  await sleep(200);
  const frontmost = appleScript('tell application "System Events" to get name of first application process whose frontmost is true');
  const pageState = await page.evaluate(() => ({
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: document.hasFocus(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  return { frontmost, page: pageState };
};

const capture = async (page, session, label, durationMs = 700) => {
  const before = await auditSnapshot(page);
  const memoryBefore = await pageMemory(page, session);
  await sleep(durationMs);
  const gpuTimer = await page.evaluate(() => window.__MS_GPU_AUDIT__.measureGpuFrame());
  const after = await auditSnapshot(page);
  const memoryAfter = await pageMemory(page, session);
  const scenario = {
    label,
    durationMs,
    before,
    after,
    delta: {
      totals: totalsDelta(before, after),
      contexts: contextDelta(before, after),
      animationFrames: after.animationFrames - before.animationFrames,
    },
    gpuTimer,
    memoryBefore,
    memoryAfter,
  };
  run.scenarios.push(scenario);
  await page.screenshot({ path: join(screenshots, `${String(run.scenarios.length).padStart(2, "0")}-${label}.png`), fullPage: false });
  await write();
  return scenario;
};

const clickStage = async (page, name, heading) => {
  await page.getByTestId("workspace-steps").getByRole("button", { name }).click();
  await page.getByRole("heading", { name: heading }).waitFor({ state: "visible", timeout: 60_000 });
};

const drawPath = async (page) => {
  await page.getByRole("button", { name: "Draw free path" }).click();
  const canvas = page.getByTestId("path-canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Path SVG canvas has no layout box");
  const points = [
    [0.30, 0.54],
    [0.37, 0.45],
    [0.45, 0.40],
    [0.53, 0.44],
    [0.61, 0.52],
  ];
  await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 });
  await page.mouse.up();
  await page.getByTestId("free-draw-status").waitFor({ state: "visible" });
};

const toggleFoundryPlayback = async (page, expected) => {
  const toolbar = page.getByTestId("foundry-toolbar");
  const button = toolbar.getByRole("button", { name: expected ? "Play" : "Pause" });
  await button.click();
};

const maybeSetPlanetary = async (page) => {
  const details = page.getByTestId("stage-right-inspector").locator("details.advanced-panel").first();
  if (await details.count()) {
    const isOpen = await details.evaluate((element) => element.open);
    if (!isOpen) await details.locator("summary").click();
  }
  const type = page.getByLabel("Foundry mechanism type");
  if (await type.count()) {
    const options = await type.locator("option").evaluateAll((items) => items.map((item) => item.getAttribute("value")));
    if (options.includes("planetary_gear")) await type.selectOption("planetary_gear");
  }
};

const useFourBar = async (page) => {
  const type = page.getByLabel("Foundry mechanism type");
  if (await type.count()) await type.selectOption("4bar");
  const use = page.getByRole("button", { name: "Use mechanism" });
  if (await use.isEnabled()) {
    await use.click();
    await page.getByRole("heading", { name: "Mechanism Design" }).waitFor({ state: "visible", timeout: 60_000 });
    return true;
  }
  return false;
};

const setSharedPlayback = async (page, shouldPlay) => {
  const dock = page.getByTestId("workspace-player-dock");
  if (!(await dock.count())) return false;
  const transition = dock.getByRole("button", { name: shouldPlay ? "Play" : "Pause" });
  if (!(await transition.count())) return false;
  await transition.click();
  return true;
};

const repeatedStageLoop = async (page) => {
  const steps = [
    [/^Character$/i, "Character"],
    [/^Path Editor$/i, "Path Editor"],
    [/Foundry/i, "Foundry"],
    [/Mechanism Design|Design/i, "Mechanism Design"],
    [/^Blueprint$/i, "Blueprint"],
    [/^Assembly$/i, "Assembly"],
  ];
  for (let loop = 0; loop < 3; loop += 1) {
    for (const [name, heading] of steps) await clickStage(page, name, heading);
  }
};

await mkdir(raw, { recursive: true });
await mkdir(screenshots, { recursive: true });
run.platform = {
  uname: command("uname", ["-a"]),
  osVersion: command("sw_vers", []),
  architecture: command("uname", ["-m"]),
};
await write();

let browser;
let context;
try {
  browser = await chromium.launch({
    headless: false,
    executablePath: chromePath,
    args: ["--window-size=1366,768"],
  });
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  await page.addInitScript({ path: join(here, "webgl-probe.js") });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  run.browser.systemInfo = await browser.newBrowserCDPSession().then((sessionBrowser) => sessionBrowser.send("SystemInfo.getInfo")).catch((error) => ({ error: asError(error) }));
  run.foreground.before = appleScript('tell application "Google Chrome" to activate');
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.getByTestId("shared-workbench").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator("#boot-loader").waitFor({ state: "detached", timeout: 180_000 });
  const dialog = page.getByTestId("getting-started-dialog");
  if (await dialog.count()) {
    let starter = dialog.getByRole("button", { name: "Open starter rig" });
    if (!(await starter.count())) {
      const starters = dialog.getByRole("button", { name: "Starters", exact: true });
      if (await starters.count()) await starters.click();
      starter = dialog.getByRole("button", { name: "Open starter rig" });
    }
    await starter.click();
  }
  await page.getByTestId("character-screen").waitFor({ state: "visible", timeout: 60_000 });
  run.foreground.active = await focusEvidence(page);
  const foregroundPage = run.foreground.active.page;
  run.mode.actual = foregroundPage.visibilityState === "visible" && foregroundPage.hasFocus && run.foreground.active.frontmost.ok && run.foreground.active.frontmost.value === "Google Chrome"
    ? "headed-frontmost-chrome-developer-reference"
    : "headed-run-with-foreground-verification-incomplete";
  await capture(page, session, "cold-character-paused");

  await clickStage(page, /^Path Editor$/i, "Path Editor");
  await page.getByTestId("path-three-puppet").waitFor({ state: "visible", timeout: 60_000 });
  await setSharedPlayback(page, false);
  await capture(page, session, "warm-path-three-paused");
  await page.getByTestId("path-view-2d").click();
  await page.getByTestId("path-canvas").waitFor({ state: "visible", timeout: 60_000 });
  await capture(page, session, "path-svg-paused");
  await drawPath(page);
  await capture(page, session, "path-svg-after-draw");
  await page.getByTestId("path-view-3d").click();
  await page.getByTestId("path-three-puppet").waitFor({ state: "visible", timeout: 60_000 });
  await capture(page, session, "path-three-remount-paused");
  await setSharedPlayback(page, true);
  await capture(page, session, "path-three-playback", 1_400);
  await setSharedPlayback(page, false);

  await clickStage(page, /Foundry/i, "Foundry");
  await page.getByTestId("foundry-three-canvas").waitFor({ state: "visible", timeout: 60_000 });
  await capture(page, session, "warm-foundry-paused");
  await maybeSetPlanetary(page);
  await page.getByTestId("foundry-camera-rig").waitFor({ state: "visible", timeout: 60_000 });
  await capture(page, session, "foundry-planetary-paused");
  await toggleFoundryPlayback(page, true);
  await capture(page, session, "foundry-planetary-playback", 1_400);
  await toggleFoundryPlayback(page, false);
  const mechanismInstalled = await useFourBar(page);
  run.mechanismInstalled = mechanismInstalled;

  if (mechanismInstalled) {
    await capture(page, session, "warm-design-paused");
    await setSharedPlayback(page, true);
    await capture(page, session, "design-playback", 1_400);
    await setSharedPlayback(page, false);
  }

  await clickStage(page, /^Blueprint$/i, "Blueprint");
  await capture(page, session, "warm-blueprint-paused");
  await clickStage(page, /^Assembly$/i, "Assembly");
  await page.getByTestId("assembly-mechanism-three-preview").waitFor({ state: "visible", timeout: 60_000 });
  await capture(page, session, "warm-assembly-paused");
  await setSharedPlayback(page, true);
  await capture(page, session, "assembly-playback", 1_400);
  await setSharedPlayback(page, false);

  const hiddenStart = await auditSnapshot(page);
  const hidden = await session.send("Emulation.setPageVisibilityState", { visibilityState: "hidden" }).catch((error) => ({ error: asError(error) }));
  await sleep(700);
  const hiddenAfter = await auditSnapshot(page);
  const resumed = await session.send("Emulation.setPageVisibilityState", { visibilityState: "visible" }).catch((error) => ({ error: asError(error) }));
  await sleep(400);
  const resumeAfter = await auditSnapshot(page);
  run.scenarios.push({
    label: "emulated-hidden-resume-paused",
    method: "CDP Emulation.setPageVisibilityState; not an actual backgrounded-device measurement",
    hiddenCommand: hidden,
    visibleCommand: resumed,
    before: hiddenStart,
    hiddenAfter,
    resumeAfter,
    hiddenDelta: { totals: totalsDelta(hiddenStart, hiddenAfter), animationFrames: hiddenAfter.animationFrames - hiddenStart.animationFrames },
    resumeDelta: { totals: totalsDelta(hiddenAfter, resumeAfter), animationFrames: resumeAfter.animationFrames - hiddenAfter.animationFrames },
  });
  await page.screenshot({ path: join(screenshots, "13-emulated-hidden-resume.png"), fullPage: false });

  const lossBefore = await auditSnapshot(page);
  const lossRequest = await page.evaluate(() => window.__MS_GPU_AUDIT__.forceContextLoss());
  await sleep(500);
  const lossAfter = await auditSnapshot(page);
  const restoreRequest = await page.evaluate(() => window.__MS_GPU_AUDIT__.restoreContext());
  await sleep(1_000);
  const restoreAfter = await auditSnapshot(page);
  const canvas = page.locator("canvas.foundry-three-canvas").last();
  const box = await canvas.boundingBox();
  if (box) await page.mouse.wheel(0, -80);
  await sleep(500);
  const redrawAfter = await auditSnapshot(page);
  run.scenarios.push({
    label: "webgl-lose-context-restore",
    before: lossBefore,
    lossRequest,
    afterLoss: lossAfter,
    restoreRequest,
    afterRestore: restoreAfter,
    afterRedrawGesture: redrawAfter,
    lossDelta: totalsDelta(lossBefore, lossAfter),
    restoreDelta: totalsDelta(lossAfter, restoreAfter),
    redrawDelta: totalsDelta(restoreAfter, redrawAfter),
  });
  await page.screenshot({ path: join(screenshots, "14-webgl-context-restored.png"), fullPage: false });

  await repeatedStageLoop(page);
  await capture(page, session, "three-stage-loop-final-paused");
  run.foreground.after = await focusEvidence(page);
  await context.tracing.stop({ path: tracePath });
  run.finishedAt = new Date().toISOString();
  run.success = true;
} catch (error) {
  run.success = false;
  run.errors.push({ fatal: asError(error) });
  run.finishedAt = new Date().toISOString();
  process.exitCode = 1;
  try { await context?.tracing.stop({ path: tracePath }); } catch {}
} finally {
  await write();
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}

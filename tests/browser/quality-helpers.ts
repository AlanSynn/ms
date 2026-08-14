import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

import { createLessonProject, serializeProject } from "../../utils/project";

const G7_ARTIFACT_ROOT = join(process.cwd(), "artifacts", "quality", "G7");

const safeFilePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160);

export const writeG7Json = async (relativePath: string, value: unknown) => {
  const path = join(G7_ARTIFACT_ROOT, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
};

export const writeG7Text = async (relativePath: string, value: string) => {
  const path = join(G7_ARTIFACT_ROOT, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return path;
};

export const makeUnoccupiedWavingArmProject = async () => {
  const project = createLessonProject("waving-arm");
  project.mechanisms = [];
  project.selectedMechanismId = undefined;
  project.lastFoundryExport = undefined;
  return writeG7Text(
    "raw/waving-arm-unoccupied.motionsmith.json",
    serializeProject(project),
  );
};

export const makeInvalidProject = async () => writeG7Text(
  "raw/invalid-project.motionsmith.json",
  JSON.stringify({ version: 2, parts: [] }),
);

export type PageDiagnostics = {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  readonly failedRequests: string[];
  flush: (testInfo: TestInfo, extra?: Record<string, unknown>) => Promise<string>;
};

export const installPageDiagnostics = (page: Page): PageDiagnostics => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? "unknown"}`);
  });

  const flush = async (testInfo: TestInfo, extra: Record<string, unknown> = {}) => {
    let pageState: Record<string, unknown> = { unavailable: true };
    try {
      pageState = await page.evaluate(() => ({
        url: window.location.href,
        visibilityState: document.visibilityState,
        stage: document.querySelector("h2.current-stage-title")?.textContent?.trim() ?? "",
        status: document.querySelector('[data-testid="status-bar"]')?.textContent?.trim() ?? "",
        performanceEntries: performance.getEntriesByType("longtask").map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
        })),
      }));
    } catch (error) {
      pageState = { unavailable: true, error: error instanceof Error ? error.message : String(error) };
    }
    return writeG7Json(`raw/diagnostics-${safeFilePart(testInfo.testId)}.json`, {
      testId: testInfo.testId,
      status: testInfo.status,
      pageErrors,
      consoleErrors,
      failedRequests,
      pageState,
      attachments: testInfo.attachments.map(({ name, contentType, path }) => ({ name, contentType, path })),
      ...extra,
    });
  };

  return { pageErrors, consoleErrors, failedRequests, flush };
};

export const sampleFrameMetrics = async (page: Page, label: string, frameCount = 30) => page.evaluate(
  async ({ label: metricLabel, frameCount: count }) => {
    const startedAt = performance.now();
    const frameIntervals: number[] = [];
    let previous = startedAt;
    let frames = 0;
    await new Promise<void>((resolve) => {
      const collect = (timestamp: number) => {
        if (frames > 0) frameIntervals.push(timestamp - previous);
        previous = timestamp;
        frames += 1;
        if (frames >= count) resolve();
        else requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    });
    const sorted = [...frameIntervals].sort((a, b) => a - b);
    const percentile = (fraction: number) => sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!
      : 0;
    return {
      label: metricLabel,
      startedAt,
      elapsedMs: performance.now() - startedAt,
      requestedFrames: count,
      frames,
      frameIntervalMs: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: sorted.at(-1) ?? 0,
      },
      longTasks: performance
        .getEntriesByType("longtask")
        .filter((entry) => entry.startTime >= startedAt)
        .map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
      visibilityState: document.visibilityState,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    };
  },
  { label, frameCount },
);

export const waitForBootLoader = async (page: Page) => {
  await page.getByTestId("shared-workbench").waitFor();
  await page.locator("#boot-loader").waitFor({ state: "detached", timeout: 180_000 });
};

export const clickStage = async (page: Page, name: "Character" | "Path Editor" | "Foundry" | "Mechanism Design" | "Blueprint" | "Assembly" | "Options") => {
  const aliases: Record<typeof name, RegExp> = {
    Character: /^Character$/i,
    "Path Editor": /Path Editor/i,
    Foundry: /Foundry/i,
    "Mechanism Design": /Mechanism Design|Design/i,
    Blueprint: /Blueprint/i,
    Assembly: /Assembly/i,
    Options: /Options/i,
  };
  await page.getByTestId("workspace-steps").getByRole("button", { name: aliases[name] }).click();
};

export const readBlueprintPackage = async (page: Page) => {
  const text = await page.getByTestId("blueprint-export-package-json").textContent();
  if (!text) throw new Error("Blueprint package harness is empty");
  return JSON.parse(text) as {
    metadataJson?: string;
    assemblyGuideHtml?: string;
    assemblyGuidePdf?: string;
    [key: string]: unknown;
  };
};

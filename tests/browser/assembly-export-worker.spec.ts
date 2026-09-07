import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

import { serializeProject } from "../../utils/project";
import { readableFabricationStackSummary } from "../../utils/fabrication";
import { createFabricationReadyFourBarProject } from "../fixtures/fabricationProject";

type ExportWorkerProbe = {
  requests: Array<{ name: string; type: string }>;
  terminated: string[];
};

test("Blueprint owns reusable export jobs and keeps Character outputs separate", async ({ page }) => {
  await page.addInitScript(() => {
    const probe: ExportWorkerProbe = { requests: [], terminated: [] };
    const NativeWorker = window.Worker;
    Object.defineProperty(window, "__MOTIONSMITH_EXPORT_WORKER_PROBE__", {
      configurable: true,
      value: probe,
    });
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: new Proxy(NativeWorker, {
        construct(target, args) {
          const instance = Reflect.construct(target, args) as Worker;
          const name = (args[1] as WorkerOptions | undefined)?.name ?? "";
          const postMessage = instance.postMessage.bind(instance) as (
            message: unknown,
          ) => void;
          const terminate = instance.terminate.bind(instance);
          Object.defineProperty(instance, "postMessage", {
            configurable: true,
            value: (message: { type?: string }) => {
              probe.requests.push({ name, type: message?.type ?? "unknown" });
              postMessage(message);
            },
          });
          Object.defineProperty(instance, "terminate", {
            configurable: true,
            value: () => {
              probe.terminated.push(name);
              terminate();
            },
          });
          return instance;
        },
      }),
    });
  });

  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/');
  await dismissStartupAnnouncement(page);
  await expect(page.locator("#boot-loader")).toHaveCount(0, {
    timeout: 180_000,
  });
  const project = createFabricationReadyFourBarProject();
  project.settings = { ...project.settings, autosave: false };
  await page.getByTestId("project-file-input").setInputFiles({
    name: "assembly-export-worker.motionsmith.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByRole("heading", { name: "Path Editor" })).toBeVisible();

  await page.getByTestId("workflow-stage-blueprint").click();
  await expect(page.getByRole("heading", { name: "Blueprint" })).toBeVisible();
  const generate = page.getByRole("button", { name: "Download Blueprint PDF" });
  await expect(generate).toHaveAttribute("data-blueprint-package-worker", "on-demand");
  const [packetDownload] = await Promise.all([
    page.waitForEvent("download"),
    generate.click(),
  ]);
  expect(packetDownload.suggestedFilename()).toMatch(/-blueprint\.pdf$/);
  const packetPath = await packetDownload.path();
  expect(packetPath).toBeTruthy();
  const packetPdf = await readFile(packetPath!, "utf8");
  expect(packetPdf).toContain("/MediaBox [0 0 864 864]");
  expect(packetPdf).toContain("sheet=12x12in scale=1");
  expect(packetPdf).toContain(project.mechanisms[0].id);
  await expect.poll(async () => page.evaluate(() => {
    const probe = (window as unknown as Window & {
      __MOTIONSMITH_EXPORT_WORKER_PROBE__: ExportWorkerProbe;
    }).__MOTIONSMITH_EXPORT_WORKER_PROBE__;
    return {
      requests: probe.requests.filter(({ name }) => name === "motionsmith-blueprint-package"),
      terminations: probe.terminated.filter((name) => name === "motionsmith-blueprint-package").length,
    };
  })).toEqual({
    requests: [{ name: "motionsmith-blueprint-package", type: "create-package" }],
    terminations: 1,
  });

  const [characterPdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Character PDF" }).click(),
  ]);
  expect(characterPdfDownload.suggestedFilename()).toMatch(/-character\.pdf$/);
  const characterPdfPath = await characterPdfDownload.path();
  expect(characterPdfPath).toBeTruthy();
  const characterPdf = await readFile(characterPdfPath!, "utf8");
  expect(characterPdf).toContain("/MediaBox [0 0 612 792]");
  expect(characterPdf).toContain("character cut sheet");
  expect(characterPdf).not.toContain("MS_BLUEPRINT_PAGE");

  const [characterSvgDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Character SVG" }).click(),
  ]);
  expect(characterSvgDownload.suggestedFilename()).toMatch(/-character\.svg$/);
  const characterSvgPath = await characterSvgDownload.path();
  expect(characterSvgPath).toBeTruthy();
  const characterSvg = await readFile(characterSvgPath!, "utf8");
  expect(characterSvg).toContain('width="215.9mm"');
  expect(characterSvg).toContain('height="279.4mm"');
  expect(characterSvg).toContain('data-character-exploded-sheet="true"');

  await page.getByText("Other cut files", { exact: true }).click();
  const stlButton = page.getByRole("button", { name: "Download character STL" });
  await expect(stlButton).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    stlButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/custom-parts\.stl$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const stl = await readFile(path!, "utf8");
  expect(stl).toContain("solid motionsmith_custom_parts");
  expect(stl).toContain("facet normal");
  await page.getByTestId("workflow-stage-assembly").click();
  await expect(page.getByTestId("assembly-stack-summary")).toHaveText(
    readableFabricationStackSummary(project.mechanisms[0]),
  );
  await expect(page.getByRole("button", { name: "Download Blueprint PDF" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const probe = (window as unknown as Window & {
      __MOTIONSMITH_EXPORT_WORKER_PROBE__: ExportWorkerProbe;
    }).__MOTIONSMITH_EXPORT_WORKER_PROBE__;
    return probe.requests
      .filter(({ name }) => name === "motionsmith-blueprint-package")
      .map(({ type }) => type);
  })).toEqual([
    "create-package",
    "create-character-template",
    "create-character-template",
    "create-custom-parts-stl",
  ]);
});

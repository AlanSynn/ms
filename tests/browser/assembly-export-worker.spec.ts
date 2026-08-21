import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

import { serializeProject } from "../../utils/project";
import { createFabricationReadyFourBarProject } from "../fixtures/fabricationProject";

type ExportWorkerProbe = {
  requests: Array<{ name: string; type: string }>;
  terminated: string[];
};

test("Assembly reuses the export worker and STL stays explicit", async ({ page }) => {
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

  await page.goto("/");
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

  await page.getByTestId("workflow-stage-assembly").click();
  await expect(page.getByRole("heading", { name: "Assembly" })).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate package" });
  await expect(generate).toHaveAttribute("data-assembly-package-worker", "on-demand");
  await generate.click();
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
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

  await page.getByTestId("workflow-stage-blueprint").click();
  await expect(page.getByRole("heading", { name: "Blueprint" })).toBeVisible();
  const packageJson = await page.getByTestId("blueprint-export-package-json").textContent();
  expect(packageJson).toBeTruthy();
  expect(JSON.parse(packageJson!).customPartsStl).toBe("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download character STL" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/custom-parts\.stl$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const stl = await readFile(path!, "utf8");
  expect(stl).toContain("solid motionsmith_custom_parts");
  expect(stl).toContain("facet normal");
  await expect.poll(async () => page.evaluate(() => {
    const probe = (window as unknown as Window & {
      __MOTIONSMITH_EXPORT_WORKER_PROBE__: ExportWorkerProbe;
    }).__MOTIONSMITH_EXPORT_WORKER_PROBE__;
    return probe.requests
      .filter(({ name }) => name === "motionsmith-blueprint-package")
      .map(({ type }) => type);
  })).toEqual(["create-package", "create-custom-parts-stl"]);
});

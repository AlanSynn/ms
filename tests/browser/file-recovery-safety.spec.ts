import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ProjectState } from "../../types";
import { createSampleProject, loadProjectSnapshot, serializeProject } from "../../utils/project";
import { assertProjectRoundTrip } from "../../utils/projectSerialization";
import { writeAutosaveSnapshot } from "../../utils/projectAutosaveTransactions";
import { readBrowserAutosaveProbe } from "./autosaveIndexedDbProbe";
import { dismissStartupAnnouncement } from "./startupHarness";
import { readPortableProjectBundle } from '../../runtime/versions/versionPortable';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? "/";
const RECOVERY = "motionsmith-autosave-recovery";
const IMPORT = "motionsmith-project-import";
type SafetyProbe = {
  hold(name: string, enabled?: boolean): void;
  count(name: string): number;
  release(name: string): void;
};
declare global { interface Window { __fileSafety: SafetyProbe; __restoreDownloadClick?: () => void } }

const fixture = (name: string, id = name, autosave = false) => {
  const base = createSampleProject({ includeMechanism: true });
  return loadProjectSnapshot({ ...base,
    metadata: { ...base.metadata, id, name },
    settings: { ...base.settings, autosave },
  });
};

const seedBackup = async (page: Page, project: ProjectState) => {
  const values = new Map<string, string>();
  const result = writeAutosaveSnapshot(project, {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  });
  expect(result.status).toBe("saved");
  await page.addInitScript(entries => {
    if (localStorage.getItem("file-safety-seeded")) return;
    for (const [key, value] of entries) localStorage.setItem(key, value);
    localStorage.setItem("file-safety-seeded", "yes");
  }, [...values]);
};

const journal = async (page: Page) => ({
  local: await page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
    .filter(key => key.startsWith("motionsmith.autosave"))
    .sort().map(key => [key, localStorage.getItem(key)]))),
  indexed: await readBrowserAutosaveProbe(page),
});

// Delay real Worker results, including callbacks already queued before termination.
const installWorkerGate = (page: Page, initiallyHeld: string[] = []) => page.addInitScript(names => {
  const heldNames = new Set(names);
  const waiting: Array<{ name: string; deliver: () => void }> = [];
  window.__fileSafety = {
    hold: (name, enabled = true) => { if (enabled) heldNames.add(name); else heldNames.delete(name); },
    count: name => waiting.filter(item => item.name === name).length,
    release: name => {
      heldNames.delete(name);
      for (const item of waiting.filter(item => item.name === name)) {
        waiting.splice(waiting.indexOf(item), 1);
        item.deliver();
      }
    },
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      const name = options?.name ?? "";
      if (!["motionsmith-project-import", "motionsmith-autosave-recovery"].includes(name)) return;
      let listener: Worker["onmessage"] = null;
      Object.defineProperty(this, "onmessage", {
        get: () => listener, set: (next: Worker["onmessage"]) => { listener = next; },
      });
      this.addEventListener("message", event => {
        const captured = listener;
        if (!captured) return;
        const deliver = () => captured.call(this, event);
        if (heldNames.has(name)) waiting.push({ name, deliver });
        else deliver();
      });
    }
  };
}, initiallyHeld);

const start = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
};
const menu = async (page: Page) => {
  const button = page.getByTestId("command-menu-file");
  if (!await button.evaluate(node => (node.parentElement as HTMLDetailsElement).open)) await button.click();
};
const choose = async (page: Page, content: string | null, name = "classroom.motionsmith") => {
  const chooser = page.waitForEvent("filechooser");
  if (await page.getByTestId("getting-started-dialog").count()) {
    await page.getByTestId("getting-started-open-project").click();
  } else {
    await menu(page);
    await page.getByTestId("command-load-project").click();
  }
  await (await chooser).setFiles(content === null ? [] : {
    name, mimeType: "application/json", buffer: Buffer.from(content),
  });
};
const open = async (page: Page, project: ProjectState, name = "classroom.motionsmith") => {
  await choose(page, serializeProject(project), name);
  await expect(page.getByTestId("status-bar")).toContainText(`Loaded project ${name}`);
  await expect(page.getByTestId("getting-started-dialog")).toHaveCount(0);
};
const savedProject = async (page: Page): Promise<ProjectState> => {
  await menu(page);
  const download = page.waitForEvent("download", item => !/-recovery-\d+\.motionsmith$/.test(item.suggestedFilename()));
  await page.getByTestId("command-download-snapshot").click();
  const file = await (await download).path();
  await expect(page.getByTestId("status-bar")).toContainText("Download started:");
  return (await readPortableProjectBundle(JSON.parse(await readFile(file!, 'utf8')))).project;
};

test("an older same-ID file and its edit survive a deliberately late browser recovery", async ({ page }) => {
  const older = fixture("Chosen older file", "same-project");
  const backup = { ...older, metadata: { ...older.metadata, name: "Newer browser copy", updatedAt: "2099-01-01T00:00:00Z" } };
  await seedBackup(page, backup);
  await installWorkerGate(page, [RECOVERY]);
  await start(page);
  await expect.poll(() => page.evaluate(name => window.__fileSafety.count(name), RECOVERY)).toBe(1);
  const beforeJournal = await journal(page);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await journal(page)).toEqual(beforeJournal);
  await open(page, older);
  await page.getByRole("spinbutton", { name: "Smoothness number", exact: true }).fill("61");
  const edited = await savedProject(page);
  expect(edited.metadata.name).toBe(older.metadata.name);
  expect(edited.paths[edited.selectedPathId!].smoothness).toBe(61);
  await page.evaluate(name => window.__fileSafety.release(name), RECOVERY);
  const after = await savedProject(page);
  assertProjectRoundTrip(edited, after);
  expect(await journal(page)).toEqual(beforeJournal);
});

test("entry settings, interval, pagehide, and reload preserve an unchosen browser backup", async ({ page }) => {
  await page.clock.install();
  const backup = fixture("Unchosen classroom backup");
  await seedBackup(page, backup);
  await start(page);
  await expect(page.getByTestId("recover-browser-backup")).toContainText(backup.metadata.name);
  const beforeJournal = await journal(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("workflow-stage-options").click();
  await page.getByRole("spinbutton", { name: "Grid pitch mm number", exact: true }).fill("21");
  await page.getByTestId("workflow-stage-project").click();
  await expect(page.getByTestId("project-backup-status")).toHaveAttribute("data-backup-state", "waiting");
  await page.clock.fastForward(61_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
  });
  expect(await journal(page)).toEqual(beforeJournal);
  await page.reload();
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  await expect(page.getByTestId("recover-browser-backup")).toContainText(backup.metadata.name);
  expect(await journal(page)).toEqual(beforeJournal);
});

test("recovery is explicit and canceled replacement preserves work and the journal", async ({ page }) => {
  const backup = fixture("Browser recovery A");
  const file = fixture("Active file B");
  await seedBackup(page, backup);
  await start(page);
  await expect(page.getByTestId("recover-browser-backup")).toContainText(backup.metadata.name);
  const beforeJournal = await journal(page);
  await open(page, file);
  page.once("dialog", dialog => dialog.dismiss());
  await menu(page);
  await page.locator('[data-command-id="project.recoverAutosave"]').click();
  await expect(page.getByTestId("status-bar")).toContainText("Project unchanged");
  assertProjectRoundTrip(file, await savedProject(page));
  expect(await journal(page)).toEqual(beforeJournal);
  page.once("dialog", dialog => dialog.accept());
  await menu(page);
  await page.locator('[data-command-id="project.recoverAutosave"]').click();
  await expect(page.getByTestId("status-bar")).toHaveText("Recovered browser backup");
  assertProjectRoundTrip(backup, await savedProject(page));
});

test("late import cannot replace a newer selected file or New Project", async ({ page }) => {
  await installWorkerGate(page);
  await start(page);
  await page.evaluate(name => window.__fileSafety.hold(name), IMPORT);
  await choose(page, serializeProject(fixture("Slow import A")), "slow.motionsmith");
  await expect.poll(() => page.evaluate(name => window.__fileSafety.count(name), IMPORT)).toBe(1);
  await page.evaluate(name => window.__fileSafety.hold(name, false), IMPORT);
  const latest = fixture("Newer selected file B");
  await open(page, latest, "newer.motionsmith");
  await page.evaluate(name => window.__fileSafety.release(name), IMPORT);
  assertProjectRoundTrip(latest, await savedProject(page));
  await page.evaluate(name => window.__fileSafety.hold(name), IMPORT);
  await choose(page, serializeProject(fixture("Interrupted import C")), "interrupted.motionsmith");
  await expect.poll(() => page.evaluate(name => window.__fileSafety.count(name), IMPORT)).toBe(1);
  page.once("dialog", dialog => dialog.accept());
  await menu(page);
  await page.locator('[data-command-id="project.new"]').click();
  await expect(page.getByTestId("status-bar")).toHaveText("New project");
  await page.evaluate(name => window.__fileSafety.release(name), IMPORT);
  const empty = await savedProject(page);
  expect(empty.partOrder).toHaveLength(0);
  expect(Object.keys(empty.paths)).toHaveLength(0);
});

test("prepared starters respect replacement cancellation and fence a late import", async ({ page }) => {
  await installWorkerGate(page);
  await start(page);
  const current = fixture("Keep this authored project");
  await open(page, current);
  await page.getByTestId("workflow-stage-character").click();
  await page.getByRole("button", { name: "Open Getting Started", exact: true }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByTestId("getting-started-card-humanoid").click();
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("Project unchanged");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assertProjectRoundTrip(current, await savedProject(page));
  await page.getByRole("button", { name: "Open Getting Started", exact: true }).click();
  await page.evaluate(name => window.__fileSafety.hold(name), IMPORT);
  await choose(page, serializeProject(fixture("Late import after starter")), "late.motionsmith");
  await expect.poll(() => page.evaluate(name => window.__fileSafety.count(name), IMPORT)).toBe(1);
  page.once("dialog", dialog => dialog.accept());
  await page.getByTestId("getting-started-card-humanoid").click();
  await expect(page.getByTestId("getting-started-dialog")).toHaveCount(0);
  const starter = await savedProject(page);
  expect(starter.metadata.id).not.toBe(current.metadata.id);
  expect(starter.partOrder.length).toBeGreaterThan(0);
  await page.evaluate(name => window.__fileSafety.release(name), IMPORT);
  assertProjectRoundTrip(starter, await savedProject(page));
});

test("failed and empty selections preserve entry, current work, and last-good backup; same file can reopen", async ({ page }) => {
  const backup = fixture("Protected backup A");
  await seedBackup(page, backup);
  await start(page);
  await expect(page.getByTestId("recover-browser-backup")).toBeVisible();
  const beforeJournal = await journal(page);
  await choose(page, "{broken JSON", "broken.motionsmith");
  await expect(page.getByTestId("status-bar")).toContainText("Project import failed:");
  await expect(page.getByTestId("getting-started-dialog")).toBeVisible();
  expect(await journal(page)).toEqual(beforeJournal);
  await choose(page, null);
  expect(await journal(page)).toEqual(beforeJournal);
  const current = fixture("Protected open file B");
  await open(page, current, "repeat.motionsmith");
  const failures = [
    { name: "unrelated.json", text: JSON.stringify({ unrelated: true }) },
    { name: "future.json", text: JSON.stringify({ ...current, version: 999 }) },
    { name: "future.motionsmith", text: JSON.stringify({ ...JSON.parse(serializeProject(current)), schemaVersion: 999 }) },
    { name: "missing-art.motionsmith", text: serializeProject({ ...current, parts: { ...current.parts,
      torso: { ...current.parts.torso, textureUrl: "blob:missing-required-artwork" },
    } }) },
  ];
  for (const failure of failures) {
    await choose(page, failure.text, failure.name);
    await expect(page.getByTestId("status-bar")).toContainText("Project import failed:");
    await expect(page.getByTestId("project-file-input")).toHaveValue("");
    assertProjectRoundTrip(current, await savedProject(page));
    expect(await journal(page)).toEqual(beforeJournal);
  }
  page.once("dialog", dialog => dialog.dismiss());
  await choose(page, serializeProject(fixture("Canceled replacement")));
  await expect(page.getByTestId("status-bar")).toHaveText("Project unchanged");
  assertProjectRoundTrip(current, await savedProject(page));
  expect(await journal(page)).toEqual(beforeJournal);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    page.once("dialog", dialog => dialog.accept());
    await open(page, current, "repeat.motionsmith");
    assertProjectRoundTrip(current, await savedProject(page));
  }
});

test("denied browser storage does not block file Open or Save and reports backup failure", async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException("Storage denied for test", "SecurityError"); };
    Object.defineProperty(window, "indexedDB", { configurable: true, get: denied });
    Storage.prototype.getItem = denied;
    Storage.prototype.setItem = denied;
    Storage.prototype.removeItem = denied;
  });
  await start(page);
  const project = fixture("Storage-independent portable file", "storage-independent", true);
  await open(page, project);
  await page.getByTestId("workflow-stage-project").click();
  await expect(page.getByTestId("project-backup-status")).toHaveAttribute("data-backup-state", "failed");
  assertProjectRoundTrip(project, await savedProject(page));
});

test("failed download never claims a saved file or changes authoring", async ({ page }) => {
  await start(page);
  const project = fixture("Failed file write protection");
  await open(page, project);
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    window.__restoreDownloadClick = () => { HTMLAnchorElement.prototype.click = original; };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith("blob:")) throw new Error("Synthetic download failure");
      original.call(this);
    };
  });
  await menu(page);
  await page.getByTestId("command-download-snapshot").click();
  await expect(page.getByTestId("status-bar")).toContainText("Project save failed:");
  expect(downloads).toBe(0);
  await page.getByTestId("workflow-stage-project").click();
  await expect(page.getByTestId("project-lifecycle-panel")).toContainText(project.metadata.name);
  await expect(page.getByTestId("project-summary")).toContainText(`${Object.keys(project.paths).length} paths`);
  await page.evaluate(() => window.__restoreDownloadClick?.());
  assertProjectRoundTrip(project, await savedProject(page));
});

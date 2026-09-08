import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ProjectState } from '../../types';
import { createLessonProject, serializeProject } from '../../utils/project';
import { dismissStartupAnnouncement } from './startupHarness';
import { readBrowserAutosaveProject } from './autosaveIndexedDbProbe';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';

type ProjectFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

const projectFile = (project: ProjectState, name: string): ProjectFile => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(serializeProject(project)),
});

const openFileMenu = async (page: Page) => {
  const menu = page.getByTestId('command-menu-file');
  const open = await menu.evaluate((element) =>
    Boolean((element.parentElement as HTMLDetailsElement | null)?.open),
  );
  if (!open) await menu.click();
};

const openProjectFromCommand = async (page: Page, file: string | ProjectFile) => {
  page.once('dialog', dialog => dialog.accept());
  await openFileMenu(page);
  const pending = page.waitForEvent('filechooser');
  await page.getByTestId('command-load-project').click();
  await (await pending).setFiles(file);
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project');
};

const saveProjectFromCommand = async (page: Page) => {
  await openFileMenu(page);
  const pending = page.waitForEvent('download');
  await page.getByTestId('command-download-snapshot').click();
  const download = await pending;
  const path = await download.path();
  expect(path, 'the repaired project can be downloaded for a real reopen').toBeTruthy();
  // Read the bytes here so the test proves the command produced a file before
  // feeding that same file back through the production file chooser.
  return { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readFile(path!) };
};

const legacyOrphanProject = () => {
  const project = createLessonProject('waving-arm');
  const mechanism = project.mechanisms[0];
  if (!mechanism) throw new Error('waving-arm lesson has no mechanism');
  return {
    ...project,
    mechanisms: [{
      ...mechanism,
      // Keep the old scalar references in the file, but point them at objects
      // that are no longer present. This is the legacy orphan shape that the
      // loader must preserve as a disabled, repairable mechanism.
      targetPartId: 'removed-part',
      targetSceneObjectId: undefined,
      targetPathId: 'removed-path',
      targetAnchorJointId: 'removed-joint',
      outputs: [],
      activeVisualPartIds: [],
      fabricationMetadata: {
        ...(mechanism.fabricationMetadata ?? {}),
        targetPathId: 'removed-path',
        pathFit: undefined,
      },
    }],
    selectedMechanismId: mechanism.id,
  } satisfies ProjectState;
};

const openWavingArm = async (page: Page) => {
  const directory = await mkdtemp(join(tmpdir(), 'motionsmith-template-hotfix-'));
  const projectPath = join(directory, 'waving-arm.motionsmith.json');
  await writeFile(projectPath, serializeProject(createLessonProject('waving-arm')), 'utf8');

  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count() && await gettingStarted.getByTestId('guided-project-library').count()) {
    await gettingStarted.getByRole('button', { name: 'Starters' }).click();
  }
  await page.getByTestId('project-file-input').setInputFiles(projectPath);
  await expect(page.getByTestId('status-bar')).toContainText(
    new RegExp(`Loaded project ${basename(projectPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
};

type BindingState = {
  id: string;
  type: string;
  paths: string[];
};

const readMechanismState = async (page: Page): Promise<BindingState[]> => {
  const project = await readBrowserAutosaveProject(page);
  return (project?.mechanisms ?? [])
    .filter(mechanism => mechanism.visible !== false && mechanism.enabled !== false)
    .map(mechanism => ({
      id: mechanism.id,
      type: mechanism.type,
      paths: [...new Set([
        ...(mechanism.outputs ?? [])
          .filter(binding => binding.enabled !== false)
          .map(binding => binding.pathId),
        mechanism.targetPathId,
      ].filter((pathId): pathId is string => Boolean(pathId)))],
    }));
};

const expectTemplateState = async (
  page: Page,
  expectedType: string,
  mechanismId: string,
  pathId: string,
) => {
  await expect.poll(
    () => readMechanismState(page),
    { message: `${expectedType} replaces the selected mechanism without dropping its path` },
  ).toEqual([{ id: mechanismId, type: expectedType, paths: [pathId] }]);
};

const chooseTemplate = async (page: Page, label: string) => {
  const button = page.getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'false');
};

const openEditMenu = async (page: Page) => {
  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
};

test('Design template changes preserve one mechanism owner and its path through undo/redo', async ({ page }) => {
  await openWavingArm(page);
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();

  await expect.poll(
    () => readMechanismState(page),
    { message: 'waving-arm opens with one active path-bound mechanism' },
  ).toHaveLength(1);
  const initialState = await readMechanismState(page);
  const mechanismId = initialState[0]?.id;
  const pathId = initialState[0]?.paths[0];
  expect(mechanismId, 'the starter mechanism has a stable per-instance id').toBeTruthy();
  expect(pathId, 'the starter mechanism owns the lesson motion path').toBeTruthy();

  await chooseTemplate(page, 'Gear train');
  await expectTemplateState(page, 'gear', mechanismId!, pathId!);

  await chooseTemplate(page, 'Gear linkage');
  await expectTemplateState(page, 'gear_linkage', mechanismId!, pathId!);

  await openEditMenu(page);
  await page.getByTestId('command-edit-undo').click();
  await expect(page.getByTestId('status-bar')).toContainText('Undo applied');
  await expectTemplateState(page, 'gear', mechanismId!, pathId!);

  {
    await openEditMenu(page);
    await page.getByTestId('command-edit-undo').click();
    await expect(page.getByTestId('status-bar')).toContainText('Undo applied');
    await expectTemplateState(page, '4bar', mechanismId!, pathId!);
  }

  await openEditMenu(page);
  await page.getByTestId('command-edit-redo').click();
  await expect(page.getByTestId('status-bar')).toContainText('Redo applied');
  await expectTemplateState(page, 'gear', mechanismId!, pathId!);

  {
    await openEditMenu(page);
    await page.getByTestId('command-edit-redo').click();
    await expect(page.getByTestId('status-bar')).toContainText('Redo applied');
    await expectTemplateState(page, 'gear_linkage', mechanismId!, pathId!);
  }
});

test('legacy orphan stays disabled until repaired, then keeps its binding through project reopen', async ({ page }) => {
  const orphan = legacyOrphanProject();
  const mechanismId = orphan.mechanisms[0]!.id;

  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  const gettingStarted = page.getByTestId('getting-started-dialog');
  if (await gettingStarted.count() && await gettingStarted.getByTestId('guided-project-library').count()) {
    await gettingStarted.getByRole('button', { name: 'Starters' }).click();
  }
  await page.getByTestId('project-file-input').setInputFiles(
    projectFile(orphan, 'legacy-orphan.motionsmith'),
  );
  await expect(page.getByTestId('status-bar')).toContainText('Loaded project legacy-orphan.motionsmith');
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();

  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect.poll(async () => {
    const project = await readBrowserAutosaveProject(page);
    const mechanism = project?.mechanisms.find((item) => item.id === mechanismId);
    return {
      enabled: mechanism?.enabled,
      targetPartId: mechanism?.targetPartId,
      targetPathId: mechanism?.targetPathId,
      outputCount: mechanism?.outputs?.length,
      warning: mechanism?.warnings?.some((warning) => warning.includes('choose target + path.')),
    };
  }, { message: 'legacy missing target/path is retained as an explicitly disabled orphan' }).toEqual({
    enabled: false,
    targetPartId: undefined,
    targetPathId: undefined,
    outputCount: 0,
    warning: true,
  });
  await expect(page.getByLabel('Mechanism target')).toHaveValue('');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('');
  await expect(page.getByText('Choose target and path.', { exact: true })).toBeVisible();

  await page.getByTestId('workflow-stage-blueprint').click();
  const inactive = page.locator(`[data-blueprint-inactive-mechanism="${mechanismId}"]`);
  await expect(inactive).toBeVisible();
  await expect(inactive).toContainText('Four-bar linkage · No path · Off');
  const repair = page.getByTestId(`blueprint-inactive-recovery-${mechanismId}`);
  await expect(repair).toBeVisible();
  await expect(repair).toHaveAccessibleName(/Connect path/i);

  await repair.click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  const enabled = page.locator('label').filter({ hasText: 'Enabled' }).locator('input[type="checkbox"]');
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(page.getByTestId('status-bar')).toContainText('Connect a motion path first.');
  await expect(enabled).not.toBeChecked();

  // The target select chooses the lesson's real path for this body part. The
  // explicit connection enables the mechanism when the fit result is committed.
  await page.getByLabel('Mechanism target').selectOption('right_hand_part');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('path-right-arm');
  await expect(page.getByTestId('status-bar')).toContainText('Fit ready');
  await expect.poll(async () => {
    const project = await readBrowserAutosaveProject(page);
    const mechanism = project?.mechanisms.find((item) => item.id === mechanismId);
    return {
      enabled: mechanism?.enabled,
      targetPartId: mechanism?.targetPartId,
      targetPathId: mechanism?.targetPathId,
      outputPathIds: mechanism?.outputs?.map((binding) => binding.pathId),
      fitStatus: mechanism?.fabricationMetadata?.pathFit?.status,
      outputFitStatus: mechanism?.outputs?.[0]?.fit?.status,
    };
  }, { message: 'explicit target repair enables one real path binding after fitting' }).toEqual({
    enabled: true,
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    outputPathIds: ['path-right-arm'],
    fitStatus: 'fit',
    outputFitStatus: 'fit',
  });

  await expect(enabled).toBeChecked();
  await page.getByTestId('workflow-stage-blueprint').click();
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();

  // Browser autosave is the reload path for a local project. Recovery remains
  // explicit; the saved binding must be present before the user chooses it.
  await page.getByTestId('workflow-stage-project').click();
  await expect(page.getByTestId('project-backup-status')).toHaveAttribute('data-backup-state', 'saved');
  await page.reload();
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
  await expect(page.getByTestId('recover-browser-backup')).toBeVisible();
  await page.getByTestId('recover-browser-backup').click();
  await expect(page.getByTestId('status-bar')).toContainText('Recovered browser backup');
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect.poll(async () => {
    const project = await readBrowserAutosaveProject(page);
    const mechanism = project?.mechanisms.find((item) => item.id === mechanismId);
    return {
      enabled: mechanism?.enabled,
      targetPartId: mechanism?.targetPartId,
      targetPathId: mechanism?.targetPathId,
      outputPathIds: mechanism?.outputs?.map((binding) => binding.pathId),
    };
  }, { message: 'browser recovery keeps the repaired binding' }).toEqual({
    enabled: true,
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    outputPathIds: ['path-right-arm'],
  });
  await expect(page.getByLabel('Mechanism target')).toHaveValue('right_hand_part');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('path-right-arm');

  const savedPath = await saveProjectFromCommand(page);
  await openProjectFromCommand(page, savedPath);
  await expect(page.getByRole('heading', { name: 'Path Editor' })).toBeVisible();
  await page.getByRole('button', { name: /Mechanism Design/i }).click();
  await expect(page.getByRole('heading', { name: 'Mechanism Design' })).toBeVisible();
  await expect.poll(async () => {
    const project = await readBrowserAutosaveProject(page);
    const mechanism = project?.mechanisms.find((item) => item.id === mechanismId);
    return {
      enabled: mechanism?.enabled,
      targetPartId: mechanism?.targetPartId,
      targetPathId: mechanism?.targetPathId,
      outputPathIds: mechanism?.outputs?.map((binding) => binding.pathId),
    };
  }, { message: 'repaired binding survives the production save and reopen flow' }).toEqual({
    enabled: true,
    targetPartId: 'right_hand_part',
    targetPathId: 'path-right-arm',
    outputPathIds: ['path-right-arm'],
  });
  await expect(page.getByLabel('Mechanism target')).toHaveValue('right_hand_part');
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('path-right-arm');
  await expect(page.getByText('Choose target and path.', { exact: true })).toHaveCount(0);

  await page.getByTestId('workflow-stage-blueprint').click();
  await expect(page.getByTestId('blueprint-build-print')).toBeEnabled();
  const buildDownload = page.waitForEvent('download');
  await page.getByTestId('blueprint-build-print').click();
  const buildPath = await (await buildDownload).path();
  expect((await readFile(buildPath!)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByTestId('blueprint-motion-count')).toHaveText('1 motion / 1 mechanism');
});

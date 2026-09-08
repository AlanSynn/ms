import { expect, test, type Page } from '@playwright/test';
import type { MechanismConfig, ProjectState } from '../../types';
import { createDefaultSceneObject, createSampleProject, serializeProject } from '../../utils/project';
import { dismissStartupAnnouncement } from './startupHarness';

const APP_PATH = process.env.PLAYWRIGHT_BASE_PATH ?? process.env.VITE_BASE_PATH ?? '/';

const openApp = async (page: Page) => {
  await page.goto(APP_PATH);
  await dismissStartupAnnouncement(page);
  await expect(page.getByTestId('getting-started-dialog')).toBeVisible();
};

const projectFile = (project: ProjectState, name: string) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(serializeProject(project)),
});

const openProject = async (page: Page, project: ProjectState, name: string) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('getting-started-dialog').getByRole('button', { name: 'Open Project', exact: true }).click();
  await (await chooser).setFiles(projectFile(project, name));
  await expect(page.getByTestId('status-bar')).toContainText(`Loaded project ${name}`);
};

const brokenBindingProject = (): ProjectState => {
  const project = createSampleProject({ includeMechanism: true });
  const mechanism = project.mechanisms[0]!;
  const broken: MechanismConfig = {
    ...mechanism,
    outputs: [{
      id: `${mechanism.id}:output-1`,
      portId: 'C',
      outputTraceId: 'C',
      pathId: 'path-right-arm',
      targetPartId: 'right_arm_lower',
      targetAnchorJointId: 'right_hand',
      enabled: false,
    }],
    targetPartId: 'right_arm_lower',
    targetSceneObjectId: undefined,
    targetPathId: 'path-right-arm',
    targetAnchorJointId: 'right_hand',
    warnings: [],
  };
  return {
    ...project,
    metadata: { ...project.metadata, name: 'Missing motion target' },
    mechanisms: [broken],
    selectedMechanismId: broken.id,
  };
};

const inactiveOrphanProject = (): ProjectState => {
  const project = brokenBindingProject();
  const mechanism = project.mechanisms[0]!;
  return {
    ...project,
    paths: {},
    pathOrder: [],
    mechanisms: [{ ...mechanism, enabled: false }],
  };
};

const inactiveSceneObjectOrphanProject = (): ProjectState => {
  const project = inactiveOrphanProject();
  const mechanism = project.mechanisms[0]!;
  const object = createDefaultSceneObject('star', 'object-recovery');
  return {
    ...project,
    paths: {},
    pathOrder: [],
    sceneObjects: { [object.id]: object },
    sceneObjectOrder: [object.id],
    selectedPartId: undefined,
    selectedPathId: undefined,
    selectedSceneObjectId: undefined,
    mechanisms: [{
      ...mechanism,
      enabled: false,
      targetPartId: undefined,
      targetSceneObjectId: object.id,
      targetPathId: 'deleted-object-path',
      targetAnchorJointId: undefined,
      outputs: [{
        id: `${mechanism.id}:output-1`,
        portId: 'C',
        outputTraceId: 'C',
        pathId: 'deleted-object-path',
        targetSceneObjectId: object.id,
        enabled: false,
      }],
    }],
  };
};

test.use({ viewport: { width: 1366, height: 768 }, trace: 'on' });

test('Blueprint names an inactive mechanism and recovers with its path selected', async ({ page }) => {
  await openApp(page);
  const project = brokenBindingProject();
  const mechanismId = project.mechanisms[0]!.id;
  await openProject(page, project, 'missing-target.motionsmith');
  await page.getByTestId('workflow-stage-blueprint').click();

  const orphan = page.locator(`[data-blueprint-inactive-mechanism="${mechanismId}"]`);
  await expect(orphan).toContainText('Four-bar linkage · Check paths · Off');
  const issue = page.getByTestId('blueprint-control-panel').getByRole('button', {
    name: 'Connect path for Four-bar linkage',
    exact: true,
  });
  await expect(issue).toHaveText('Connect path');
  await expect(page.getByTestId('blueprint-control-panel')).toContainText('Four-bar linkage · Check paths · Off');
  await expect(page.getByTestId('blueprint-control-panel')).not.toContainText(mechanismId);

  await issue.click();
  await expect(page.locator('.editor-stage-frame[data-stage="design"]')).toBeVisible();
  await expect(page.getByLabel('Mechanism instance')).toHaveValue(mechanismId);
  await expect(page.getByLabel('Mechanism target')).toBeVisible();
  await expect(page.getByLabel('Mechanism motion path')).toHaveValue('path-right-arm');

  await page.getByTestId('top-command-bar').getByText('Edit', { exact: true }).click();
  await expect(page.getByTestId('command-edit-redo')).toBeVisible();
});

test('Blueprint surfaces an inactive orphan with a Draw path recovery action', async ({ page }) => {
  await openApp(page);
  const project = inactiveOrphanProject();
  const mechanismId = project.mechanisms[0]!.id;
  await openProject(page, project, 'inactive-orphan.motionsmith');
  await page.getByTestId('workflow-stage-blueprint').click();

  const orphan = page.locator(`[data-blueprint-inactive-mechanism="${mechanismId}"]`);
  await expect(orphan).toContainText('Four-bar linkage · No path · Off');
  const recover = orphan.getByRole('button', { name: 'Draw path for Four-bar linkage', exact: true });
  await expect(recover).toBeVisible();
  await recover.click();
  await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
});

test('Draw path recovery selects an inactive mechanism scene object after its path is deleted', async ({ page }) => {
  await openApp(page);
  const project = inactiveSceneObjectOrphanProject();
  const mechanismId = project.mechanisms[0]!.id;
  await openProject(page, project, 'inactive-object-orphan.motionsmith');
  await page.getByTestId('workflow-stage-blueprint').click();

  const orphan = page.locator(`[data-blueprint-inactive-mechanism="${mechanismId}"]`);
  await expect(orphan).toContainText('Four-bar linkage · No path · Off');
  await orphan.getByRole('button', { name: 'Draw path for Four-bar linkage', exact: true }).click();
  await expect(page.locator('.editor-stage-frame[data-stage="path"]')).toBeVisible();
  await expect(page.getByLabel('Motion target', { exact: true })).toHaveValue('object-recovery');
});

import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppStage, MechanismConfig, ProjectAction, ProjectState } from '../types';
import { AssemblyGuide } from '../components/stages/assembly/AssemblyGuide';
import { BlueprintExport } from '../components/stages/blueprint/BlueprintExport';
import { DesignInspectorPanel } from '../components/stages/mechanism/DesignInspectorPanel';
import { createFabricationPackage, validateForFabrication } from '../utils/fabrication';
import { isSoftReadinessBlocker } from '../utils/fabricationReadiness';
import { generateProjectReadyDXF, generateProjectReadySVG } from '../utils/exporter';
import { navigateAppStage } from '../utils/appStageNavigation';
import { createDefaultMechanism } from '../utils/mechanismDefaults';
import { projectMechanismReadiness } from '../utils/mechanismReadiness';
import { createSampleProject } from '../utils/project';
import { workflowStatusFor } from '../utils/workflowStatus';

const boundMechanism = (id = 'build-ready'): MechanismConfig => ({
  ...createDefaultMechanism('4bar', id),
  targetPartId: 'right_hand_part',
  targetPathId: 'path-right-arm',
  targetAnchorJointId: 'right_hand',
});

const projectWith = (mechanism: MechanismConfig): ProjectState => {
  const project = createSampleProject();
  return {
    ...project,
    mechanisms: [mechanism],
    selectedMechanismId: mechanism.id,
    settings: {
      ...project.settings,
      physicalKit: {
        ...project.settings.physicalKit,
        sheetWidthMm: 1_000,
        sheetHeightMm: 1_000,
      },
    },
  };
};

const readyProject = projectWith(boundMechanism());
assert.equal(projectMechanismReadiness(readyProject).status, 'project-ready', 'fixture is canonically build-ready');
assert.equal(validateForFabrication(readyProject).errors.length, 0, 'fabrication validation accepts canonical readiness');
assert.equal(createFabricationPackage(readyProject).recipes.length, 1, 'package emits the canonical ready mechanism');
assert.equal(generateProjectReadySVG(readyProject, 0).ok, true, 'guarded SVG export accepts a ready project');
assert.equal(generateProjectReadyDXF(readyProject, 0).ok, true, 'guarded DXF export accepts a ready project');

const blockedProjects = [
  projectWith({ ...boundMechanism('recovery'), crankLength: Number.NaN }),
  projectWith({ ...boundMechanism('detached'), targetPartId: undefined, targetPathId: undefined }),
  projectWith({ ...createDefaultMechanism('5bar', 'unsupported'), targetPartId: 'right_hand_part', targetPathId: 'path-right-arm', targetAnchorJointId: 'right_hand' }),
  (() => {
    const project = projectWith(boundMechanism('off-sheet'));
    project.settings = { ...project.settings, physicalKit: createSampleProject().settings.physicalKit };
    project.mechanisms[0] = { ...project.mechanisms[0], anchorX: 9_999, anchorY: 9_999 };
    return project;
  })(),
  (() => {
    const first = boundMechanism('collision-a');
    const second = {
      ...createDefaultMechanism('piston', 'collision-b'),
      targetPartId: 'left_hand_part',
      targetPathId: 'path-left-collision',
      targetAnchorJointId: 'left_hand',
    };
    const project = projectWith(first);
    project.paths['path-left-collision'] = {
      ...project.paths['path-right-arm'],
      id: 'path-left-collision',
      partId: 'left_hand_part',
      targetAnchorJointId: 'left_hand',
      chainRootJointId: 'left_shoulder',
    };
    project.mechanisms = [first, second];
    return project;
  })(),
];

const softBlockedProject = (() => {
  const project = projectWith({ ...boundMechanism('soft-blocked') });
  project.settings = {
    ...project.settings,
    physicalKit: {
      ...project.settings.physicalKit,
      sheetWidthMm: 500,
      sheetHeightMm: 500,
    },
  };
  project.settings.physicalKit.sheetWidthMm = 20;
  project.settings.physicalKit.sheetHeightMm = 20;
  return project;
})();

for (const project of blockedProjects) {
  const readiness = projectMechanismReadiness(project);
  assert.equal(readiness.status, 'blocked', `${project.mechanisms[0].id} is canonically blocked`);
  assert.deepEqual(validateForFabrication(project).errors, readiness.blockers, `${project.mechanisms[0].id} fabrication agrees with readiness`);
  assert.throws(() => createFabricationPackage(project), `${project.mechanisms[0].id} creates no fabrication package`);
  assert.deepEqual(generateProjectReadySVG(project, 0), { ok: false, blockers: readiness.blockers }, `${project.mechanisms[0].id} creates no SVG artifact`);
  assert.deepEqual(generateProjectReadyDXF(project, 0), { ok: false, blockers: readiness.blockers }, `${project.mechanisms[0].id} creates no DXF artifact`);

  for (const target of ['blueprint', 'assembly'] as AppStage[]) {
    const dispatches: ProjectAction[] = [];
    let stage: AppStage = 'design';
    const gate = navigateAppStage({
      project,
      target,
      dispatch: action => dispatches.push(action),
      setStage: next => { stage = next; },
      setCommandStatus: () => {},
      stageLabel: value => value,
    });
    assert.equal(gate.ok, false, `${project.mechanisms[0].id} cannot open ${target}`);
    assert.equal(stage, 'design', `${target} returns to Design recovery`);
    assert.equal(dispatches[0]?.type, 'set_processing', `${target} reports its blocker`);
  }

  const status = workflowStatusFor('blueprint', 'Blueprint', project);
  assert.equal(status.blocker, readiness.blockers[0], 'workflow status uses the canonical project blocker');
  assert.equal(status.nextAction, 'Fix', 'blocked Blueprint points to recovery');
}

{
  const readiness = projectMechanismReadiness(softBlockedProject);
  assert.equal(readiness.status, 'blocked', 'soft-blocked project remains blocked');
  assert(readiness.blockers.length > 0, 'soft blocked project has explicit blockers');
  assert(readiness.blockers.every(isSoftReadinessBlocker), 'soft blockers are all soft-ready');
  const validation = validateForFabrication(softBlockedProject, {
    allowSoftReadinessBlockers: true,
  });
  assert.equal(validation.errors.length, 0, 'soft blocker project validates as non-error when allowed');
  assert.equal(validation.warnings.length > 0, true, 'soft blocker project reports warnings');
  assert.doesNotThrow(
    () => createFabricationPackage(softBlockedProject, {
      allowSoftReadinessBlockers: true,
    }),
    'soft blocker project can create a package',
  );

  for (const target of ['blueprint', 'assembly'] as AppStage[]) {
    const dispatches: ProjectAction[] = [];
    let stage: AppStage = 'design';
    const gate = navigateAppStage({
      project: softBlockedProject,
      target,
      dispatch: action => dispatches.push(action),
      setStage: next => { stage = next; },
      setCommandStatus: () => {},
      stageLabel: value => value,
    });
    assert.equal(gate.ok, true, `soft blockers can open ${target}`);
    assert.equal(stage, target, `${target} is reachable with soft blockers`);
    assert.equal(dispatches.length, 0, `${target} does not emit recovery processing on soft blockers`);
  }

  const status = workflowStatusFor('blueprint', 'Blueprint', softBlockedProject);
  assert.equal(status.nextAction, 'Make sheets', 'workflow status allows make sheets for soft blockers');
}

for (const target of ['blueprint', 'assembly'] as AppStage[]) {
  let stage: AppStage = 'design';
  const gate = navigateAppStage({
    project: readyProject,
    target,
    dispatch: () => { throw new Error('ready navigation must not dispatch'); },
    setStage: next => { stage = next; },
    setCommandStatus: () => {},
    stageLabel: value => value,
  });
  assert.equal(gate.ok, true, `ready project opens ${target}`);
  assert.equal(stage, target, `ready project reaches ${target}`);
}

const stalePackage = createFabricationPackage(readyProject);
const staleBlockedProject = { ...blockedProjects[1], lastExport: stalePackage };
const blueprintHtml = renderToStaticMarkup(createElement(BlueprintExport, {
  project: staleBlockedProject,
  dispatch: () => {},
  goStage: () => {},
}));
assert(!blueprintHtml.includes('blueprint-export-package-json'), 'blocked Blueprint hides a stale package');
assert(!blueprintHtml.includes('Download SVG default'), 'blocked Blueprint exposes no stale download');
assert(blueprintHtml.includes('aria-label="Generate package" disabled=""'), 'blocked Blueprint disables package generation');

const noop = () => {};
const assemblyHtml = renderToStaticMarkup(createElement(AssemblyGuide, {
  project: staleBlockedProject,
  dispatch: noop,
  goStage: noop,
  stepIndex: 0,
  setStepIndex: noop,
  stepProgress: 0,
  setStepProgress: noop,
  playing: false,
  setPlaying: noop,
  setStepCount: noop,
}));
assert(!assemblyHtml.includes('aria-label="Print"'), 'blocked Assembly exposes no stale print artifact');

const designHtml = renderToStaticMarkup(createElement(DesignInspectorPanel, {
  project: staleBlockedProject,
  selectedMechanism: staleBlockedProject.mechanisms[0],
  updateMechanism: () => false,
  dispatch: noop,
  optimizerBusy: false,
  onOptimize: noop,
  exportSvg: noop,
  exportDxf: noop,
  onBlueprint: noop,
}));
assert(designHtml.includes('disabled="">SVG</button>'), 'blocked Design disables SVG');
assert(designHtml.includes('disabled="">DXF</button>'), 'blocked Design disables DXF');
assert(designHtml.includes('aria-label="Export Blueprint" disabled=""'), 'blocked Design disables Blueprint');

console.log('mechanism build gates passed');

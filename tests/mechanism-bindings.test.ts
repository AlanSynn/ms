import { strict as assert } from 'node:assert';

import type { ProjectMotionPath, SceneObject } from '../types';
import { createFabricationRecipe } from '../utils/fabricationRecipes';
import {
    allocateMechanismOutput,
    assignMechanismOutputBinding,
    mechanismBindingForPath,
    mechanismOutputBindings,
    mechanismWithOutputBindings,
} from '../utils/mechanismBindings';
import { motionPreviewForProject } from '../utils/motion';
import { createDefaultMechanism, createEmptyProject, loadProjectSnapshot } from '../utils/project';

const object = (id: string): SceneObject => ({
    id,
    name: id,
    shape: 'block',
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    bounds: { width: 30, height: 30 },
    fillColor: '#64748b',
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
});

const path = (id: string, sceneObjectId: string): ProjectMotionPath => ({
    id,
    partId: '',
    sceneObjectId,
    points: [{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }],
    duration: 1_000,
    closed: true,
    enabled: true,
    visible: true,
    source: 'drawn',
    warnings: [],
});

const project = createEmptyProject();
const objects = [object('flag'), object('cloud'), object('star')];
const paths = [path('wave', 'flag'), path('float', 'cloud'), path('spin', 'star')];
const projectWithMotions = {
    ...project,
    sceneObjects: Object.fromEntries(objects.map(item => [item.id, item])),
    sceneObjectOrder: objects.map(item => item.id),
    paths: Object.fromEntries(paths.map(item => [item.id, item])),
    pathOrder: paths.map(item => item.id),
};

const legacy = loadProjectSnapshot({
    ...projectWithMotions,
    mechanisms: [{
        ...createDefaultMechanism('4bar', 'legacy-four-bar'),
        targetSceneObjectId: 'flag',
        targetPathId: 'wave',
        fabricationMetadata: { pathFit: { status: 'fit', targetPathId: 'wave', outputTraceId: 'B' } },
    }],
});
assert.equal(mechanismOutputBindings(legacy.mechanisms[0]).length, 1, 'legacy scalar targets migrate through one binding adapter');
assert.equal(mechanismOutputBindings(legacy.mechanisms[0])[0]?.portId, 'B', 'legacy fitted trace selects its declared output port');

const fourBar = createDefaultMechanism('4bar', 'shared-four-bar');
const firstBinding = mechanismBindingForPath(projectWithMotions, fourBar, 'wave', { portId: 'B' });
assert(firstBinding);
const sharedProject = {
    ...projectWithMotions,
    mechanisms: [mechanismWithOutputBindings(fourBar, [firstBinding])],
};
const secondBinding = mechanismBindingForPath(sharedProject, sharedProject.mechanisms[0], 'float', { portId: 'C' });
assert(secondBinding);
const shared = assignMechanismOutputBinding(sharedProject, fourBar.id, secondBinding);
assert(shared.ok);
assert.strictEqual(shared.project.paths, sharedProject.paths, 'binding assignment never replaces or mutates authored paths');
assert.equal(shared.project.mechanisms.length, 1, 'compatible ports share one physical mechanism');
assert.equal(mechanismOutputBindings(shared.project.mechanisms[0]).length, 2, 'every shared output remains explicit');

const fullPortBinding = mechanismBindingForPath(shared.project, shared.project.mechanisms[0], 'spin', { portId: 'C' });
assert(fullPortBinding);
const rejectedCapacity = assignMechanismOutputBinding(shared.project, fourBar.id, fullPortBinding);
assert(!rejectedCapacity.ok && rejectedCapacity.code === 'port-capacity');
assert.strictEqual(rejectedCapacity.project, shared.project, 'over-capacity rejection is transactional');

const sameDriverDraft = { ...fourBar, id: 'independent-four-bar', driverGroupId: fourBar.driverGroupId };
const independent = allocateMechanismOutput(sharedProject, sameDriverDraft, 'float', {
    reuseMechanismId: fourBar.id,
    portId: 'B',
});
assert(independent.ok);
assert.equal(independent.project.mechanisms.length, 2, 'an occupied requested output creates an independent mechanism');
assert(independent.createdIndependent && independent.reuseRejected, 'the allocator reports the explicit reuse fallback');
assert.strictEqual(independent.project.paths, sharedProject.paths, 'reuse fallback preserves path storage');

const preview = motionPreviewForProject(shared.project, shared.project.mechanisms, Math.PI / 3);
assert(preview.sceneObjects?.flag, 'the first mechanism binding is sampled');
assert(preview.sceneObjects?.cloud, 'the second mechanism binding is sampled');
assert.notDeepEqual(
    preview.sceneObjects?.flag?.transform,
    preview.sceneObjects?.cloud?.transform,
    'distinct physical output ports produce distinct target samples',
);

const recipe = createFabricationRecipe(shared.project, shared.project.mechanisms[0]);
assert.equal(recipe.outputBindings.length, 2, 'one physical recipe declares all output attachments');
assert.equal(recipe.assemblySteps.filter(step => step.role === 'attach-output').length, 2, 'assembly includes one attachment step per binding');

console.log('mechanism binding contracts ok');

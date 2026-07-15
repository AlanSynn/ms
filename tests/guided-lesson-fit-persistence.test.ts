import assert from 'node:assert/strict';
import { CLASSROOM_LESSONS, createLessonProject, loadProjectSnapshot, serializeProject } from '../utils/project';

for (const lesson of CLASSROOM_LESSONS) {
  const project = createLessonProject(lesson.id);
  const mechanism = project.mechanisms[0];
  const path = mechanism?.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
  assert(mechanism && path, `${lesson.id} has a fitted mechanism and authored path`);
  assert.deepEqual(mechanism.generatedPath, path.points, `${lesson.id} stores its authored path as generatedPath`);

  const reloaded = loadProjectSnapshot(JSON.parse(serializeProject(project)));
  const reloadedMechanism = reloaded.mechanisms[0];
  const reloadedPath = reloadedMechanism?.targetPathId ? reloaded.paths[reloadedMechanism.targetPathId] : undefined;
  assert(reloadedMechanism && reloadedPath, `${lesson.id} reloads its mechanism and path`);
  assert.deepEqual(reloadedMechanism.generatedPath, reloadedPath.points, `${lesson.id} preserves authored Fit persistence`);
}

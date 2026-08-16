import assert from "node:assert/strict";

import { createLessonProject } from "../utils/project";
import {
  createMotionPathPreviewRuntime,
  motionPreviewForSceneObject,
  motionPreviewForProject,
  motionPreviewForTarget,
  motionPreviewForPath,
  pointOnProjectPath,
  preferredMotionJointId,
} from "../utils/motion";

const project = createLessonProject("waving-arm");
const path = project.paths["path-right-arm"];
assert(path, "waving-arm lesson supplies a motion path");

const legacyMotionPreviewForPath = (
  angle: number,
  targetJointId = preferredMotionJointId(
    project,
    path.partId,
    path.targetAnchorJointId,
    { preferDistalWhenRoot: !path.targetAnchorJointId },
  ),
) => {
  const target = pointOnProjectPath(path, angle);
  return path.sceneObjectId
    ? motionPreviewForSceneObject(project, path.sceneObjectId, target, {
        parts: {},
        sceneObjects: {},
        skeleton: project.skeleton,
      })
    : motionPreviewForTarget(
        project,
        path.partId,
        targetJointId,
        target,
        { parts: {}, sceneObjects: {}, skeleton: project.skeleton },
        { rootJointId: path.chainRootJointId },
      );
};

const runtime = createMotionPathPreviewRuntime(project, path);
assert.equal(
  runtime,
  createMotionPathPreviewRuntime(project, path),
  "prepared path runtime is cached by immutable project/path identity",
);
assert.equal(
  motionPreviewForProject(project, project.mechanisms, 0.75),
  motionPreviewForProject(project, project.mechanisms, 0.75),
  "project motion projection is reused for the same immutable mechanism set and phase",
);

for (const angle of [0, Math.PI / 3, Math.PI, Math.PI * 1.75]) {
  const optimized = runtime.previewAt(angle);
  const regular = legacyMotionPreviewForPath(angle);
  assert.deepEqual(
    optimized,
    regular,
    `prepared path runtime preserves preview output at angle ${angle}`,
  );
  assert.deepEqual(
    runtime.pointAt(angle),
    pointOnProjectPath(path, angle),
    `prepared path runtime samples the same target at angle ${angle}`,
  );
  assert.deepEqual(
    motionPreviewForPath(project, path, angle),
    regular,
    `public path preview preserves legacy output at angle ${angle}`,
  );
}

console.log("b695 frame contract ok");

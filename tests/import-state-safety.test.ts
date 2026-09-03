import assert from "node:assert/strict";

import {
  createProjectImportGuard,
  projectHasStudentWork,
  projectImportGuardAllows,
} from "../hooks/useAppCharacterImportActions";
import {
  applyProjectAction,
  createDefaultSceneObject,
  createEmptyProject,
  createSampleProject,
  loadProjectSnapshot,
  replaceCharacterProject,
} from "../utils/project";
import { assertProjectRoundTrip } from "../utils/projectSerialization";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";

{
  const source = createEmptyProject();
  const guard = createProjectImportGuard(source, "loading-model", "Loading project...");
  const loading = applyProjectAction(source, {
    type: "set_processing",
    processing: {
      stage: "loading-model",
      message: "Loading project...",
      progress: 20,
    },
  });
  const settingEdited = applyProjectAction(source, {
    type: "update_settings",
    settings: { autosave: !source.settings.autosave },
  });
  const replacement = createEmptyProject();

  assert.equal(projectImportGuardAllows(guard, source), true);
  assert.equal(projectImportGuardAllows(guard, loading), true);
  assert.equal(
    projectImportGuardAllows(guard, settingEdited),
    false,
    "same-generation setting edits invalidate an import result",
  );
  assert.equal(
    projectImportGuardAllows(guard, replacement),
    false,
    "a replacement project invalidates an import result",
  );
}

{
  const sceneObject = createDefaultSceneObject("star", "student-prop");
  const sceneOnlyProject = {
    ...createEmptyProject(),
    sceneObjects: { [sceneObject.id]: sceneObject },
    sceneObjectOrder: [sceneObject.id],
  };
  assert.equal(
    projectHasStudentWork(sceneOnlyProject),
    true,
    "scene-object-only projects require replacement protection",
  );
}

{
  const malformed = loadProjectSnapshot({
    ...createEmptyProject(),
    skeleton: {
      joints: {
        root: {
          id: "root",
          name: "root",
          position: { x: "not-a-number", y: Number.NaN },
          parentId: null,
        },
        hand: {
          id: "hand",
          name: "hand",
          position: { x: "12.5", y: "-4" },
          parentId: "root",
        },
      },
    },
  });
  assert.deepEqual(malformed.skeleton?.joints.root.position, { x: 0, y: 0 });
  assert.deepEqual(malformed.skeleton?.joints.hand.position, { x: 12.5, y: -4 });

  const legacy = loadProjectSnapshot({
    ...createEmptyProject(),
    skeleton: {
      skeleton: [{ name: "root", loc: [Number.POSITIVE_INFINITY, "bad"], parent: null }],
    },
  });
  assert.deepEqual(legacy.skeleton?.joints.root.position, { x: 0, y: 0 });
}

{
  const previous = createSampleProject({ includeMechanism: true });
  const target = createSampleProject({ includeMechanism: false });
  const scaledSkeleton = target.skeleton
    ? {
        ...target.skeleton,
        joints: Object.fromEntries(
          Object.entries(target.skeleton.joints).map(([id, joint]) => [id, {
            ...joint,
            position: {
              x: joint.position.x * 1.37,
              y: joint.position.y * 1.37,
            },
          }]),
        ),
      }
    : target.skeleton;
  const replacement = replaceCharacterProject(
    { ...target, skeleton: scaledSkeleton },
    previous,
  );
  const blob = createPortableProjectBlob(replacement);
  const document = JSON.parse(await blob.text()) as unknown;
  const reopened = loadProjectSnapshot(document);

  assertProjectRoundTrip(replacement, reopened);
}

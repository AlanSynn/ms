import { strict as assert } from "node:assert";
import type {
  ProjectAction,
  ProjectMotionPath,
  ProjectState,
} from "../types";
import {
  applyProjectAction,
  createDefaultSceneObject,
  createEmptyProject,
  createLessonProject,
  createSampleProject,
  loadProjectSnapshot,
  replaceCharacterProject,
} from "../utils/project";
import {
  APP_STATE_VERSION,
  PORTABLE_PROJECT_FORMAT,
  assertProjectRoundTrip,
  projectContentFingerprint,
  projectStateFromPortableDocument,
  serializeProject,
  type PortableProjectDocument,
} from "../utils/projectSerialization";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";

const FIXED_CREATED_AT = "2026-08-20T13:00:00.000Z";
const FIXED_UPDATED_AT = "2026-08-20T14:35:12.000Z";

const cloneJson = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

const jsonValue = <T>(value: T): T => cloneJson(value);

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((entry) => {
      deepFreeze(entry);
    });
    Object.freeze(value);
  }
  return value;
};

const createClassroomProject = (): ProjectState => {
  const base = createSampleProject({ includeMechanism: true });
  const basePath = base.paths["path-right-arm"];
  const baseMechanism = base.mechanisms[0];
  assert(basePath, "sample fixture provides a motion path");
  assert(baseMechanism, "sample fixture provides a mechanism");

  const armPoints = [
    { x: 118.25, y: -47.5 },
    { x: 127.75, y: -58.125 },
    { x: 139.5, y: -49.25 },
    { x: 131.125, y: -35.75 },
  ];
  const headPoints = [
    { x: -118.5, y: -45.25 },
    { x: -128.75, y: -64.5 },
    { x: -143.125, y: -51.875 },
    { x: -132.25, y: -32.5 },
  ];
  const armPath: ProjectMotionPath = {
    ...basePath,
    id: "path-right-wave",
    smoothness: 38,
    points: armPoints,
    timedPoints: armPoints.map((point, index) => ({
      ...point,
      time: index * 620,
    })),
    duration: 2480,
  };
  const headPath: ProjectMotionPath = {
    ...basePath,
    id: "path-left-wave",
    partId: "left_arm_lower",
    targetAnchorJointId: "left_hand",
    chainRootJointId: "left_shoulder",
    smoothness: 61,
    points: headPoints,
    timedPoints: headPoints.map((point, index) => ({
      ...point,
      time: 180 + index * 540,
    })),
    duration: 2340,
  };
  const rightMechanism = {
    ...cloneJson(baseMechanism),
    id: "mechanism-right-wave",
    targetPathId: armPath.id,
    targetPartId: armPath.partId,
    targetAnchorJointId: armPath.targetAnchorJointId,
    fabricationMetadata: baseMechanism.fabricationMetadata
      ? {
          ...cloneJson(baseMechanism.fabricationMetadata),
          targetPathId: armPath.id,
        }
      : undefined,
  };
  const leftMechanism = {
    ...cloneJson(baseMechanism),
    id: "mechanism-left-wave",
    color: "#0f766e",
    anchorX: -36.5,
    anchorY: 184.25,
    transform: { x: -36.5, y: 184.25, rotation: 28.5, scale: 1 },
    sceneAnchor: { x: -36.5, y: 184.25 },
    targetPathId: headPath.id,
    targetPartId: headPath.partId,
    targetAnchorJointId: headPath.targetAnchorJointId,
    fabricationMetadata: baseMechanism.fabricationMetadata
      ? {
          ...cloneJson(baseMechanism.fabricationMetadata),
          targetPathId: headPath.id,
          sceneAnchor: { x: -36.5, y: 184.25 },
        }
      : undefined,
  };
  const sceneObject = {
    ...createDefaultSceneObject("star", "classroom-stage-prop"),
    name: "Team stage marker",
    transform: { x: 44.25, y: -76.5, rotation: 17.25, scale: 0.8 },
  };

  const normalized = loadProjectSnapshot({
    ...base,
    revision: 37,
    metadata: {
      ...base.metadata,
      id: "project-classroom-round-trip",
      name: "Room 214 automata team",
      createdAt: FIXED_CREATED_AT,
      updatedAt: FIXED_UPDATED_AT,
    },
    paths: {
      [armPath.id]: armPath,
      [headPath.id]: headPath,
    },
    pathOrder: [armPath.id, headPath.id],
    motionTimeline: {
      durationMs: 4200,
      startOffsetByPathId: {
        [armPath.id]: 0,
        [headPath.id]: 180,
      },
    },
    mechanisms: [rightMechanism, leftMechanism],
    sceneObjects: { [sceneObject.id]: sceneObject },
    sceneObjectOrder: [sceneObject.id],
    selectedPartId: headPath.partId,
    selectedPathId: headPath.id,
    selectedMechanismId: leftMechanism.id,
    selectedSceneObjectId: sceneObject.id,
  });

  assert.deepEqual(normalized.pathOrder, [armPath.id, headPath.id]);
  assert.deepEqual(
    normalized.mechanisms.map(({ id }) => id),
    [rightMechanism.id, leftMechanism.id],
  );
  return normalized;
};

{
  const project = createClassroomProject();
  const sourceBefore = JSON.stringify(project);
  const document = JSON.parse(serializeProject(project)) as PortableProjectDocument;

  assert.equal(document.format, PORTABLE_PROJECT_FORMAT);
  assert.equal(document.schemaVersion, APP_STATE_VERSION);
  assert.equal(document.manifest.projectId, project.metadata.id);
  assert.equal(document.manifest.projectName, project.metadata.name);
  assert.equal(document.manifest.revision, project.revision);
  assert.deepEqual(document.manifest.pathIds, project.pathOrder);
  assert.deepEqual(
    document.manifest.mechanismIds,
    project.mechanisms.map(({ id }) => id),
  );
  assert.equal(
    document.integrity.contentFingerprint,
    projectContentFingerprint(project),
  );
  assert.deepEqual(projectStateFromPortableDocument(document), document.project);
  assert.equal(
    JSON.stringify(project),
    sourceBefore,
    "creating and extracting a .motionsmith document does not mutate its source",
  );
}

{
  const project = createLessonProject("waving-arm");
  project.parts.torso = {
    ...project.parts.torso,
    maskUrl: "blob:https://motionsmith.local/torso-mask",
  };
  const blob = createPortableProjectBlob(project);
  const reopened = loadProjectSnapshot(
    JSON.parse(await blob.text()) as PortableProjectDocument,
  );

  assertProjectRoundTrip(project, reopened);
  assert.equal(
    reopened.parts.torso.maskUrl,
    undefined,
    "guided lesson saves omit non-portable legacy part masks instead of failing verification",
  );
}

{
  const project = createLessonProject("waving-arm");
  const unboundMechanism = {
    ...project.mechanisms[0],
    id: "lesson-unbound-round-trip",
  };
  const unboundRecord = unboundMechanism as unknown as Record<string, unknown>;
  for (const key of [
    "outputs",
    "targetPartId",
    "targetJointId",
    "targetPathId",
    "pathId",
  ]) {
    delete unboundRecord[key];
  }
  project.mechanisms = [...project.mechanisms, unboundMechanism];

  assert.equal(
    Object.prototype.hasOwnProperty.call(unboundMechanism, "outputs"),
    false,
    "the regression fixture starts with an absent outputs property",
  );
  const migrated = loadProjectSnapshot(project);
  const migratedMechanism = migrated.mechanisms.find(
    (mechanism) => mechanism.id === unboundMechanism.id,
  );
  assert(migratedMechanism, "the legacy mechanism survives migration");
  assert.equal(
    migratedMechanism.enabled,
    false,
    "legacy unbound mechanisms are quarantined before persistence",
  );
  assert.deepEqual(
    migratedMechanism.generatedPath,
    unboundMechanism.generatedPath,
    "quarantine preserves the legacy mechanism geometry",
  );
  assert.deepEqual(
    migratedMechanism.activeVisualPartIds,
    [],
    "quarantine removes stale active visual target references",
  );
  assert(
    migratedMechanism.warnings?.some((warning) =>
      warning.startsWith("Output detached:"),
    ),
    "quarantine keeps a visible recovery warning",
  );
  const blob = createPortableProjectBlob(migrated);
  const reopened = loadProjectSnapshot(
    JSON.parse(await blob.text()) as PortableProjectDocument,
  );

  assertProjectRoundTrip(migrated, reopened);
  assert.deepEqual(
    reopened.mechanisms.find(
      (mechanism) => mechanism.id === unboundMechanism.id,
    )?.outputs,
    [],
    "portable save canonicalizes an unbound mechanism to empty outputs",
  );
}

{
  const project = createClassroomProject();
  const sourceImageName = "classroom-source-".repeat(20);
  project.metadata = { ...project.metadata, sourceImageName };
  const projectBefore = JSON.stringify(project);
  const blob = createPortableProjectBlob(project);
  assert.equal(blob.type, "application/vnd.motionsmith.project+json");
  const savedDocument = JSON.parse(
    await blob.text(),
  ) as PortableProjectDocument;
  const reopened = loadProjectSnapshot(savedDocument);

  assertProjectRoundTrip(project, reopened);
  assert.equal(reopened.metadata.sourceImageName, sourceImageName.slice(0, 240));
  assert.equal(reopened.metadata.updatedAt, FIXED_UPDATED_AT);
  assert.deepEqual(jsonValue(reopened.parts), jsonValue(project.parts));
  assert.deepEqual(jsonValue(reopened.skeleton), jsonValue(project.skeleton));
  assert.deepEqual(jsonValue(reopened.paths), jsonValue(project.paths));
  assert.deepEqual(
    jsonValue(reopened.mechanisms),
    jsonValue(project.mechanisms),
  );
  assert.deepEqual(
    jsonValue(reopened.sceneObjects),
    jsonValue(project.sceneObjects),
  );
  assert.deepEqual(reopened.motionTimeline, project.motionTimeline);
  assert.equal(
    JSON.stringify(project),
    projectBefore,
    "Save self-round-trip leaves the open project untouched",
  );
}

{
  const project = createClassroomProject();
  const projectBefore = JSON.stringify(project);
  const tampered = JSON.parse(
    serializeProject(project),
  ) as PortableProjectDocument;
  tampered.project.paths["path-right-wave"].points[0].x += 0.5;

  assert.throws(
    () => loadProjectSnapshot(tampered),
    /Project file integrity check failed/,
  );
  assert.equal(
    JSON.stringify(project),
    projectBefore,
    "a rejected file cannot alter the current project",
  );
}

{
  const project = createClassroomProject();
  const legacy = cloneJson(project);
  legacy.version = 1;
  delete legacy.revision;
  delete legacy.pathOrder;
  const legacyBefore = JSON.stringify(legacy);
  const reopened = loadProjectSnapshot(legacy);

  assert.equal(reopened.version, APP_STATE_VERSION);
  assert.deepEqual(reopened.pathOrder, ["path-right-wave", "path-left-wave"]);
  assert.deepEqual(
    reopened.mechanisms.map(({ id }) => id),
    ["mechanism-right-wave", "mechanism-left-wave"],
  );
  assert.equal(reopened.metadata.updatedAt, FIXED_UPDATED_AT);
  assert.deepEqual(
    jsonValue(reopened.paths["path-right-wave"].points),
    jsonValue(legacy.paths["path-right-wave"].points),
  );
  assert.equal(
    JSON.stringify(legacy),
    legacyBefore,
    "v1 migration does not mutate the raw legacy snapshot",
  );
}

{
  const project = createClassroomProject();
  const points = Array.from({ length: 2000 }, (_, index) => ({
    x: index * 0.25 - 200,
    y: (index % 37) - 18,
  }));
  const longPath: ProjectMotionPath = {
    ...project.paths["path-right-wave"],
    id: "path-2000-points",
    points,
    timedPoints: points.map((point, index) => ({
      ...point,
      time: index * 4,
    })),
    duration: 8000,
  };
  project.paths = { ...project.paths, [longPath.id]: longPath };
  project.pathOrder = [...(project.pathOrder ?? []), longPath.id];

  const reopened = loadProjectSnapshot(JSON.parse(serializeProject(project)));
  assert.equal(reopened.paths[longPath.id].points.length, 2000);
  assert.equal(reopened.paths[longPath.id].timedPoints?.length, 2000);
  assert.deepEqual(reopened.paths[longPath.id].points, points);
  assert.deepEqual(
    reopened.paths[longPath.id].timedPoints,
    longPath.timedPoints,
  );
}

{
  const project = createClassroomProject();
  const unresolvedPath: ProjectMotionPath = {
    ...project.paths["path-left-wave"],
    id: "path-unresolved-owner",
    partId: "classroom-paper-wing",
    targetAnchorJointId: undefined,
    chainRootJointId: undefined,
    warnings: [],
  };
  project.paths = { ...project.paths, [unresolvedPath.id]: unresolvedPath };
  project.pathOrder = [...(project.pathOrder ?? []), unresolvedPath.id];

  const reopened = loadProjectSnapshot(JSON.parse(serializeProject(project)));
  assert(reopened.paths[unresolvedPath.id], "unresolved path remains in the project");
  assert(reopened.pathOrder?.includes(unresolvedPath.id));
  assert.equal(reopened.paths[unresolvedPath.id].enabled, true);
  assert(
    reopened.paths[unresolvedPath.id].warnings.includes(
      "Missing body part: classroom-paper-wing",
    ),
    "unresolved ownership is reported instead of deleting student geometry",
  );
  assert.deepEqual(reopened.paths[unresolvedPath.id].points, unresolvedPath.points);
}

{
  const project = createClassroomProject();
  const before = JSON.stringify(project);
  const selected = applyProjectAction(project, {
    type: "select_path",
    pathId: "path-right-wave",
  });

  assert.notEqual(selected, project);
  assert.equal(selected.selectedPathId, "path-right-wave");
  assert.equal(selected.selectedPartId, "right_arm_lower");
  assert.equal(selected.metadata.updatedAt, project.metadata.updatedAt);
  assert.equal(selected.revision, project.revision);
  assert.equal(selected.paths, project.paths);
  assert.equal(
    JSON.stringify(project),
    before,
    "select_path changes selection without touching project content",
  );
}

{
  const previous = createClassroomProject();
  const replacement = createSampleProject({ includeMechanism: false });
  const previousBefore = structuredClone(previous);
  const replacementBefore = structuredClone(replacement);
  const replaced = replaceCharacterProject(replacement, previous, "path");

  assert.deepEqual(
    Object.keys(replaced.paths).sort(),
    Object.keys(previous.paths).sort(),
  );
  assert.deepEqual(replaced.pathOrder, previous.pathOrder);
  assert.deepEqual(
    replaced.mechanisms.map(({ id }) => id),
    previous.mechanisms.map(({ id }) => id),
  );
  assert.deepEqual(replaced.sceneObjects, previous.sceneObjects);
  assert.deepEqual(replaced.sceneObjectOrder, previous.sceneObjectOrder);
  assert.deepEqual(previous, previousBefore);
  assert.deepEqual(replacement, replacementBefore);
}

{
  const previous = createClassroomProject();
  const unresolvedPath: ProjectMotionPath = {
    ...previous.paths["path-right-wave"],
    id: "path-student-cutout",
    partId: "student-cutout-without-match",
    targetAnchorJointId: undefined,
    chainRootJointId: undefined,
    warnings: [],
  };
  previous.paths = { ...previous.paths, [unresolvedPath.id]: unresolvedPath };
  previous.pathOrder = [...(previous.pathOrder ?? []), unresolvedPath.id];
  previous.mechanisms = previous.mechanisms.map((mechanism, index) =>
    index === 0
      ? {
          ...mechanism,
          targetPartId: unresolvedPath.partId,
          targetPathId: unresolvedPath.id,
          targetAnchorJointId: undefined,
        }
      : mechanism,
  );
  const replacement = createEmptyProject();
  const previousBefore = structuredClone(previous);
  const replacementBefore = structuredClone(replacement);
  const replaced = replaceCharacterProject(replacement, previous, "character");

  assert(replaced.paths[unresolvedPath.id], "replacement retains an unmatched path");
  assert.equal(replaced.paths[unresolvedPath.id].enabled, false);
  assert(
    replaced.paths[unresolvedPath.id].warnings.includes(
      "Choose a body part after character replacement",
    ),
  );
  assert.deepEqual(
    replaced.mechanisms.map(({ id }) => id),
    previous.mechanisms.map(({ id }) => id),
  );
  assert.deepEqual(replaced.sceneObjects, previous.sceneObjects);
  assert.deepEqual(previous, previousBefore);
  assert.deepEqual(replacement, replacementBefore);
}

const allProjectActions = (project: ProjectState): ProjectAction[] => {
  const partId = project.partOrder[0];
  const part = project.parts[partId];
  const path = project.paths[project.pathOrder?.[0] ?? ""];
  const mechanism = project.mechanisms[0];
  const sceneObjectId = project.sceneObjectOrder[0];
  const sceneObject = project.sceneObjects[sceneObjectId];
  const joint = Object.values(project.skeleton?.joints ?? {}).find(
    (candidate) => !candidate.locked,
  );
  assert(part && path && mechanism && sceneObject && joint);

  const foundryExport: NonNullable<ProjectState["lastFoundryExport"]> = {
    id: "action-foundry-export",
    createdAt: FIXED_UPDATED_AT,
    mechanismId: mechanism.id,
    mechanismType: mechanism.type,
    parameters: {},
    pivot: { x: 0, y: 0 },
    generatedPath: [],
    simulationSummary: "Mutation guard fixture",
    visual: { color: mechanism.color, scale: 1, constraintsVisible: false },
    animation: { duration: 1000, steps: 12, loop: true },
    metadata: { sourceTab: "foundry" },
    warnings: [],
    source: "mechanism-foundry",
  };

  return [
    { type: "load_project", project },
    {
      type: "set_processing",
      processing: { stage: "ready", message: "Mutation guard", progress: 100 },
    },
    { type: "select_part", partId },
    { type: "select_path", pathId: path.id },
    { type: "select_scene_object", objectId: sceneObjectId },
    {
      type: "upsert_part",
      part: { ...cloneJson(part), id: "action-new-part", name: "Action part" },
    },
    { type: "delete_part", partId },
    { type: "update_part", partId, updates: { opacity: 0.75 } },
    { type: "reorder_part", partId, direction: 1 },
    {
      type: "upsert_scene_object",
      object: {
        ...cloneJson(sceneObject),
        id: "action-new-scene-object",
        name: "Action object",
      },
    },
    {
      type: "update_scene_object",
      objectId: sceneObjectId,
      updates: { opacity: 0.65 },
    },
    { type: "delete_scene_object", objectId: sceneObjectId },
    { type: "set_skeleton", skeleton: project.skeleton },
    {
      type: "update_joint",
      jointId: joint.id,
      updates: { bendDirection: joint.bendDirection * -1 || 1 },
    },
    {
      type: "add_joint",
      joint: {
        id: "action-new-joint",
        name: "Action joint",
        position: { x: 12, y: 18 },
        parentId: joint.id,
        locked: false,
        bendDirection: 1,
      },
    },
    { type: "remove_joint", jointId: joint.id },
    {
      type: "upsert_path",
      path: {
        ...cloneJson(path),
        id: "action-new-path",
        points: path.points.map((point) => ({ x: point.x + 1, y: point.y })),
      },
    },
    { type: "delete_path", pathId: path.id },
    { type: "set_mechanisms", mechanisms: project.mechanisms },
    {
      type: "upsert_mechanism",
      mechanism: { ...cloneJson(mechanism), color: "#be123c" },
    },
    { type: "delete_mechanism", mechanismId: mechanism.id },
    { type: "update_settings", settings: { animationSpeed: 1.25 } },
    {
      type: "set_export",
      fabricationPackage: {} as NonNullable<ProjectState["lastExport"]>,
    },
    { type: "set_foundry_export", foundryExport },
  ];
};

{
  const project = createClassroomProject();
  const actions = allProjectActions(project);
  const projectBefore = JSON.stringify(project);
  deepFreeze(project);

  for (const action of actions) {
    const actionBefore = JSON.stringify(action);
    deepFreeze(action);
    applyProjectAction(project, action);
    assert.equal(
      JSON.stringify(project),
      projectBefore,
      `${action.type} must not mutate its source ProjectState`,
    );
    assert.equal(
      JSON.stringify(action),
      actionBefore,
      `${action.type} must not mutate its action payload`,
    );
  }
}

console.log("classroom persistence ok");

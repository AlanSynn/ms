import assert from "node:assert/strict";
import type { ProjectState } from "../types";
import { applyProjectAction, createEmptyProject, createSampleProject, loadProjectSnapshot } from "../utils/project";
import { assertProjectRoundTrip, serializeProject } from "../utils/projectSerialization";
import { createPortableProjectBlob } from "../runtime/persistence/projectDownloadJob";
import { runProjectImportJob } from "../runtime/import/projectImportJob";
import { readProjectFileCandidate } from "../runtime/import/projectFileCandidate";
import { createProjectDecisionBoundary, projectAuthoringChanged } from "../runtime/persistence/projectDecisionBoundary";
import { confirmProjectReplacement } from "../runtime/persistence/projectReplacementSafety";
import { createAutosaveTransaction } from "../runtime/persistence/autosaveTransaction";
import { createAutosaveLifecycleDisposal } from "../hooks/useProjectAutosave";
import { AUTOSAVE_SNAPSHOT_MAX_BYTES } from "../utils/projectAutosaveFormat";

const reopen = async (source: ProjectState) => {
  const file = new File([createPortableProjectBlob(source)], "classroom.motionsmith");
  const result = await runProjectImportJob({ kind: "project", file });
  assertProjectRoundTrip(source, result.project);
  return result.project;
};
const base = createSampleProject({ includeMechanism: true });
const first = base.paths["path-right-arm"];
const second = {
  ...first, id: "path-left-class", partId: "left_arm_lower",
  targetAnchorJointId: "left_hand", chainRootJointId: "left_shoulder",
  points: first.points.map(({ x, y }) => ({ x: -x, y: y + 14 })),
  timedPoints: first.timedPoints?.map(({ x, y, time }) => ({ x: -x, y: y + 14, time })),
  smoothness: 47, duration: 3200,
};
const project = loadProjectSnapshot({
  ...base, paths: { ...base.paths, [second.id]: second },
  pathOrder: [first.id, second.id],
  metadata: { ...base.metadata, name: "Two classroom paths" },
});

// Neither portable operation may depend on browser storage availability.
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
try {
  const opened = await reopen(project);
  assert.equal(Object.keys(opened.paths).length, 2);
  assert.deepEqual(opened.parts, loadProjectSnapshot(project).parts);
  const changed = loadProjectSnapshot({
    ...opened,
    metadata: { ...opened.metadata, name: "Second class changes" },
    paths: { ...opened.paths, [second.id]: { ...opened.paths[second.id], smoothness: 63 } },
  });
  const nextClass = await reopen(changed);
  assert.equal(nextClass.paths[second.id].smoothness, 63);
  assert.deepEqual(nextClass.paths[first.id], opened.paths[first.id]);
  for (const candidate of [
    loadProjectSnapshot({ ...project, paths: {}, pathOrder: [], mechanisms: [], selectedPathId: undefined, selectedMechanismId: undefined }),
    loadProjectSnapshot({ ...project, mechanisms: [], selectedMechanismId: undefined }),
  ]) {
    const restored = await reopen(candidate);
    assert.equal(restored.mechanisms.length, 0);
    assert.equal(Object.keys(restored.paths).length, Object.keys(candidate.paths).length);
  }
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
}

const large = loadProjectSnapshot({
  ...createSampleProject(),
  characterPackage: {
    id: "large-portable", createdAt: "2026-09-07T00:00:00.000Z", sourceImageName: "large.png",
    outputDir: "portable", partsInfo: { padding: "x".repeat(AUTOSAVE_SNAPSHOT_MAX_BYTES) }, charCfg: {},
  },
});
const largeBlob = createPortableProjectBlob(large);
assert(largeBlob.size > AUTOSAVE_SNAPSHOT_MAX_BYTES);
assertProjectRoundTrip(large, (await runProjectImportJob({
  kind: "project", file: new File([largeBlob], "larger-than-browser-backup.motionsmith"),
})).project);

const sourceBefore = JSON.stringify(project);
for (const value of [
  { hello: "unrelated JSON" },
  { ...project, version: 999 },
  { ...JSON.parse(serializeProject(project)), schemaVersion: 999 },
  { ...project, parts: { ...project.parts, torso: { ...project.parts.torso, textureUrl: "blob:missing" } } },
  { ...project, parts: { ...project.parts, torso: { ...project.parts.torso, textureUrl: "https://example.invalid/art.png" } } },
  { ...project, characterPackage: { partsInfo: { parts: { torso: { texture_path: "absent.png" } } } },
    parts: { ...project.parts, torso: { ...project.parts.torso, textureUrl: undefined } } },
]) {
  assert.throws(() => readProjectFileCandidate(value));
  assert.equal(JSON.stringify(project), sourceBefore);
}
await assert.rejects(runProjectImportJob({ kind: "project", file: new File(["{bad"], "corrupt.motionsmith") }));
const legacy = { ...project, version: 1 };
assert.equal(readProjectFileCandidate(legacy).metadata.id, project.metadata.id);
const tampered = JSON.parse(serializeProject(project));
tampered.project.paths[first.id].points[0].x += 1;
assert.throws(() => readProjectFileCandidate(tampered), /integrity/);

// Save and Open share artwork and file-size policy, while preserving the source.
const oversizedPng = Buffer.alloc(25);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedPng);
oversizedPng.writeUInt32BE(13, 8);
oversizedPng.write("IHDR", 12);
oversizedPng.writeUInt32BE(2049, 16);
oversizedPng.writeUInt32BE(1, 20);
const unsafeArtwork = { ...project, parts: { ...project.parts, torso: {
  ...project.parts.torso, textureUrl: `data:image/png;base64,${oversizedPng.toString("base64")}`,
} } };
assert.throws(() => createPortableProjectBlob(unsafeArtwork), /texture limit/);
await assert.rejects(runProjectImportJob({
  kind: "project", file: new File([serializeProject(unsafeArtwork)], "oversized-art.motionsmith"),
}), /texture limit/);
assert.equal(JSON.stringify(project), sourceBefore);
await assert.rejects(runProjectImportJob({ kind: "project", file: new File([" ".repeat(12 * 1024 * 1024 + 1)], "huge.motionsmith") }), /12 MB/);

const decision = createProjectDecisionBoundary();
const oldRecovery = decision.begin();
const chosenFile = decision.begin();
assert.equal(decision.complete(oldRecovery), false, "a newer file choice fences late recovery");
assert.equal(decision.isAuthorized(), false, "merely choosing a file does not permit backup writes");
assert.equal(decision.complete(chosenFile), true);
const lateImport = decision.begin();
decision.authoredEdit();
assert.equal(decision.complete(lateImport), false, "an authored edit fences the interrupted import");
for (const presentation of [
  { ...project, selectedPathId: second.id },
  { ...project, processing: { ...project.processing, message: "Opening file" } },
  applyProjectAction(project, { type: "update_settings", settings: { autosave: false } }),
]) assert.equal(projectAuthoringChanged(project, presentation), false);
const untouchedEntry = createEmptyProject();
assert.equal(projectAuthoringChanged(untouchedEntry, applyProjectAction(untouchedEntry, {
  type: "update_settings", settings: {
    physicalKit: { ...untouchedEntry.settings.physicalKit, holeDiameterMm: 5 },
  },
})), false, "changing build settings on an empty entry must not authorize replacing its backup");
assert.equal(projectAuthoringChanged(project, { ...project, paths: { ...project.paths, [second.id]: { ...second, smoothness: 5 } } }), true);

// Closing entry while a transaction has queued defaults cannot write even a dirty marker.
const lifecycleDecision = createProjectDecisionBoundary();
let dirty = 0;
let prepared = 0;
const queued = new Set<() => void>();
const transaction = createAutosaveTransaction<ProjectState, string>({
  boundary: { request: (callback) => { queued.add(callback); return {}; }, cancel: () => queued.clear() },
  preparation: { start: () => { prepared += 1; }, cancel: () => {}, dispose: () => {} },
  commit: () => assert.fail("No prepared data"), markDirty: () => { dirty += 1; },
});
const microtasks: Array<() => void> = [];
const lifecycle = createAutosaveLifecycleDisposal((callback) => microtasks.push(callback), lifecycleDecision.isAuthorized);
transaction.accept(createEmptyProject());
lifecycle.cleanup(transaction as Parameters<typeof lifecycle.cleanup>[0]);
lifecycle.setup(transaction as Parameters<typeof lifecycle.setup>[0]);
microtasks.splice(0).forEach((callback) => callback());
assert.equal(dirty, 0);
assert.equal(prepared, 0);
assert.equal(queued.size, 0);
lifecycleDecision.complete(lifecycleDecision.begin());
transaction.accept(project);
lifecycle.cleanup(transaction as Parameters<typeof lifecycle.cleanup>[0]);
assert.equal(dirty, 1, "an explicit successful decision permits recovery lifecycle writes");
microtasks.splice(0).forEach((callback) => callback());

const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let confirms = 0;
let downloads = 0;
try {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => { confirms += 1; return false; } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => { throw new Error("Download should not start"); },
  } });
  assert.equal(confirmProjectReplacement(project, "Open another project"), false);
  assert.equal(confirms, 1);
  assert.equal(JSON.stringify(project), sourceBefore);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
  assert.throws(() => confirmProjectReplacement(project, "Recover browser backup"), /Download should not start/);
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => ({ click: () => { downloads += 1; } }),
    body: { appendChild: () => {}, removeChild: () => {} },
  } });
  assert.equal(confirmProjectReplacement(project, "Open the prepared starter rig"), true);
  assert.equal(downloads, 1);
} finally {
  for (const [key, descriptor] of [["window", priorWindow], ["document", priorDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
console.log("file authority, portable limits, replacement and recovery gate ok");

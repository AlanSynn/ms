import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../infrastructure/study/worker.js";
import type { ProjectAction } from "../types";
import { applyProjectAction, applyProjectActionResult, createSampleProject } from "../utils/project";
import {
  checkpointBatchIntact,
  mergeExitCheckpointBatches,
  studyProfileIncludes,
  studyTransportPolicyFor,
} from "../utils/studyTelemetry";
import { projectStudyReplayState, reassembleStudyEvents } from "../utils/studyReplayProjection";
import {
  makeStudySnapshotRecords,
  prepareStudySnapshotRecords,
  scrubStudyValue,
  STUDY_EVENT_SCHEMA,
  STUDY_SNAPSHOT_SCHEMA,
  studyEntityAlias,
  studyProjectAction,
  studyProjectSnapshot,
} from "../utils/studyTelemetryProject";

const project = createSampleProject();
project.metadata.name = "Student Name";
project.metadata.sourceImageName = "student-face.png";
project.settings.classroomAssessmentKey = "school-id-123";
project.processing = { stage: "error", message: "student@example.com", progress: 0, error: "file:///Users/student" };
project.skeleton!.joints["student-private-joint"] = {
  id: "student-private-joint",
  name: "Student Private Joint",
  position: { x: 0, y: 0 },
  locked: false,
  bendDirection: 1,
};
project.skeleton!.jointMap.student_private_joint = "student-private-joint";
project.skeleton!.hierarchy["student-private-joint"] = ["student-private-child"];
const firstPart = project.parts[project.partOrder[0]];
firstPart.name = "Alan";
firstPart.textureUrl = "data:image/png;base64,private";

const projectAlias = "prj_00000000-0000-4000-8000-000000000000";
const telemetryTransportSource = readFileSync(join(process.cwd(), "utils/studyTelemetry.ts"), "utf8");
assert(telemetryTransportSource.includes('openCursor()') && !telemetryTransportSource.includes('.getAll()') && telemetryTransportSource.includes('Array<{ id: string; deliveryClass: DeliveryClass }>'), "outbox scans through cursors and retains only metadata for incompatible queue entries");
assert(telemetryTransportSource.includes('state: "quarantined"') && telemetryTransportSource.includes('deliveryClass'), "delivery preserves priority metadata and quarantines non-retryable batches without retaining payloads");
assert(telemetryTransportSource.includes("scheduleReconnectDrain") && telemetryTransportSource.includes("collapseSnapshots"), "reconnect jitter and constrained snapshot collapse are explicit");
assert(telemetryTransportSource.includes('batch = makeBatch(false, deliveryClass);'), "exit beacons only reserve one keepalive-sized packet; remaining snapshot chunks use durable batches");
assert(telemetryTransportSource.includes("prepared.generation !== snapshotGeneration") && telemetryTransportSource.includes("activeBatches"), "snapshot commits require the current generation and exit checkpoints retain reserved batches");
assert(readFileSync(join(process.cwd(), "utils/studySnapshotWorker.ts"), "utf8").includes("contentHash,\n      records,") && !readFileSync(join(process.cwd(), "utils/studyTelemetry.ts"), "utf8").includes("new TextDecoder().decode(event.data.recordsBuffer)"), "snapshot records use native Worker structured clone without a second main-thread JSON decode and parse");
assert(telemetryTransportSource.includes("makeBufferedBatches(beacon, beacon || checkpoint)") && telemetryTransportSource.includes("durableOnly ? \"snapshot-continue\"") && telemetryTransportSource.includes("MAX_OUTBOX_BYTES / MAX_OUTBOX_ITEM_BYTES") && telemetryTransportSource.includes("!newSnapshotKeys.has(item.snapshotKey)"), "normal snapshot batches yield between durable writes without rescanning queued payloads, while exit drains fully and constrained collapse preserves current-generation chunks");
const studyImageWorkerSource = readFileSync(join(process.cwd(), "utils/studyImageWorker.ts"), "utf8");
assert(telemetryTransportSource.includes('new URL("./studyImageWorker.ts", import.meta.url)') && !telemetryTransportSource.includes('document.createElement("canvas")') && !telemetryTransportSource.includes("blob ?? source"), "study images normalize in a Worker and never fall back to the source blob");
assert(studyImageWorkerSource.includes("new OffscreenCanvas") && studyImageWorkerSource.includes("512 / Math.max") && studyImageWorkerSource.includes("192 * 1024") && studyImageWorkerSource.includes('type: "image/webp"'), "study image Worker emits only bounded 512px/192KB WebP assets");
const imageImportHookSource = readFileSync(join(process.cwd(), "hooks/useAppCharacterImportActions.ts"), "utf8");
assert(imageImportHookSource.includes('"image.processing"') && imageImportHookSource.includes("pixelBucket") && !imageImportHookSource.includes("sourceImageName: result"), "image processing telemetry uses bounded enums/buckets without source names or exact original dimensions");
const viteConfigSource = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
assert(viteConfigSource.includes("motionsmith-study-boundary") && viteConfigSource.includes("loadEnv"), "one Vite-aware build boundary controls the optional telemetry runtime");
assert(readFileSync(join(process.cwd(), "hooks/useStudyTelemetryBoundary.ts"), "utf8").includes('typeof import("./useStudyTelemetry").useStudyTelemetry'), "the removable no-op hook type-checks against the real study hook");
assert(readFileSync(join(process.cwd(), "hooks/useMotionSmithAppController.ts"), "utf8").includes("./useStudyTelemetryBoundary"), "the app compiles against the removable telemetry hook boundary");
assert(readFileSync(join(process.cwd(), "scripts/study-analyze.ts"), "utf8").includes("Number(a.t) - Number(b.t)") && readFileSync(join(process.cwd(), "scripts/study-replay.ts"), "utf8").includes("String(a.contextId).localeCompare(String(b.contextId))"), "cross-context scripts order by elapsed time and context before a local sequence tie-breaker");
const snapshotText = JSON.stringify(studyProjectSnapshot(project, projectAlias));
const skeletonActionText = JSON.stringify(studyProjectAction({ type: "set_skeleton", skeleton: project.skeleton }, projectAlias));
for (const forbidden of ["Student Name", "student-face.png", "school-id-123", "student@example.com", "file:///Users/student", "student-private-joint", "student-private-child", "Student Private Joint", "data:image", '"Alan"']) {
  assert(!snapshotText.includes(forbidden), `snapshot removes ${forbidden}`);
  assert(!skeletonActionText.includes(forbidden), `skeleton action removes ${forbidden}`);
}
assert(snapshotText.includes('"mechanisms"'), "snapshot keeps mechanism state");
assert.deepEqual(studyProjectAction({ type: "load_project", project: { email: "student@example.com" } }), { type: "load_project" });
assert.deepEqual(scrubStudyValue({ email: "x@y.z", schoolId: "student-7", value: 3 }), { value: 3 }, "generic scrub removes direct identity fields");
const rawEntityId = "student-object-raw-314159";
const aliasedAction = studyProjectAction({ type: "select_part", partId: rawEntityId }, projectAlias) as { partId: string };
assert.equal(aliasedAction.partId, studyEntityAlias(projectAlias, rawEntityId), "project entity references use project-scoped aliases");
assert(!JSON.stringify(aliasedAction).includes(rawEntityId), "raw entity id never enters telemetry action");

// Replay reducer fidelity. The HTML reducer embedded in scripts/study-replay.ts
// must reconstruct the same authored state the real applyProjectAction produces
// for the accepted, guard-free edit surface. The reducer source is read straight
// from the script (single source of truth — edits auto-track) and compiled here
// so it is actually executed and diffed, not merely string-matched. Edges that
// involve normalization or invalidation side-effects (update_settings, skeleton
// / joint edits, mechanism edits, deletes that orphan mechanisms) are documented,
// snapshot-bounded divergences — the periodic project.snapshot resyncs replay to
// truth — and are intentionally outside this guard-free baseline.
{
  const scriptSrc = readFileSync(join(process.cwd(), "scripts/study-replay.ts"), "utf8");
  const reducerSrc = scriptSrc.slice(scriptSrc.indexOf("function values"), scriptSrc.indexOf("const snapshots"));
  const replayApply = new Function(`${reducerSrc}\nreturn applyAction;`)() as (state: unknown, action: unknown) => Record<string, unknown>;
  const fidAlias = "prj_fidelity";
  const base = createSampleProject();
  const firstPartId = base.partOrder[0];
  const edits: ProjectAction[] = [
    { type: "update_part", partId: firstPartId, updates: { locked: false } },
    { type: "select_part", partId: firstPartId },
  ];
  if (base.partOrder.length > 1) edits.push({ type: "reorder_part", partId: firstPartId, direction: 1 });
  if (base.sceneObjectOrder.length) edits.push({ type: "select_scene_object", objectId: base.sceneObjectOrder[0] });
  for (const action of edits) {
    const realNext = applyProjectAction(base, action);
    assert.notEqual(realNext, base, `real reducer applies ${action.type}`);
    const liveScrubbed = studyProjectSnapshot(realNext, fidAlias);
    const replayNext = replayApply(studyProjectSnapshot(base, fidAlias), studyProjectAction(action, fidAlias));
    // Project state treats an absent key and an explicitly-undefined key as the
    // same thing; the scrub strips undefined values while the reducer may write
    // them, so compare through a JSON round-trip (state is plain serializable)
    // that collapses undefined-vs-absent without weakening any real divergence.
    assert.deepEqual(
      JSON.parse(JSON.stringify(replayNext)),
      JSON.parse(JSON.stringify(liveScrubbed)),
      `replay reducer matches real reducer for ${action.type}`,
    );
  }
  console.log("replay reducer fidelity verified for", edits.length, "guard-free authored edits");
}

// Rejected-action telemetry. applyProjectAction returns the SAME project
// reference whenever one of its guards rejects an action (missing entity,
// locked target, out-of-range reorder, ...). applyProjectActionResult must
// surface that as applied:false — computed against the true previous state — so
// the replay projection can trust the flag and skip rejected edits rather than
// treating them as applied. Positive controls confirm applied actions return a
// new reference.
{
  const rejBase = createSampleProject();
  const rejPartId = rejBase.partOrder[0];
  const missingPart = applyProjectActionResult(rejBase, { type: "update_part", partId: "part_does_not_exist", updates: { locked: false } });
  assert.equal(missingPart.applied, false, "update_part on a missing part is rejected");
  assert.equal(missingPart.state, rejBase, "rejected action returns the same state reference");
  const lastPartId = rejBase.partOrder[rejBase.partOrder.length - 1];
  const offEnd = applyProjectActionResult(rejBase, { type: "reorder_part", partId: lastPartId, direction: 1 });
  assert.equal(offEnd.applied, false, "reorder_part past the end of partOrder is rejected");
  const selected = applyProjectActionResult(rejBase, { type: "select_part", partId: rejPartId });
  assert.equal(selected.applied, true, "select_part applies");
  assert.notEqual(selected.state, rejBase, "applied action returns a new state reference");
  const updated = applyProjectActionResult(rejBase, { type: "update_part", partId: rejPartId, updates: { locked: !rejBase.parts[rejPartId].locked } });
  assert.equal(updated.applied, true, "update_part on an existing part applies");
  assert.notEqual(updated.state, rejBase, "applied update returns a new state reference");
  console.log("rejected-action applied flag verified: 2 rejected, 2 applied");
}

// Canonical replay projection (projectStudyReplayState) golden fidelity. The
// projection is the single fold analysis code must use instead of raw events,
// pinned here against hand-built streams that exercise edges the reducer-only
// fidelity test above cannot reach: undo/redo, the rejected-action skip (trust
// applied:false), multi-context reconnect, and chunk reassembly.
{
  const baseState = { parts: {}, partOrder: [], paths: {}, sceneObjects: {}, sceneObjectOrder: [], mechanisms: [] };
  const part = (id: string) => ({ id, transform: { x: 1, y: 1 }, bounds: { width: 10, height: 10 }, fillColor: "#ffffff", opacity: 1 });
  const hasPart = (state: unknown, id: string) =>
    Boolean(state && typeof state === "object" && (state as { parts?: Record<string, unknown> }).parts && id in (state as { parts: Record<string, unknown> }).parts);

  // Undo/redo: upsert -> undo (reverts) -> redo (re-applies).
  const undoRedo = projectStudyReplayState([
    { type: "project.snapshot", contextId: "ctx_u", t: 1, seq: 1, data: { reason: "initial", state: { ...baseState } } },
    { type: "project.action", contextId: "ctx_u", t: 2, seq: 2, data: { type: "upsert_part", part: part("ent_u1") } },
    { type: "project.undo", contextId: "ctx_u", t: 3, seq: 3, data: {} },
    { type: "project.redo", contextId: "ctx_u", t: 4, seq: 4, data: {} },
  ]);
  const undoRedoCtx = undoRedo.contexts.find((c) => c.contextId === "ctx_u")!;
  assert.equal(hasPart(undoRedoCtx.snapshots[1], "ent_u1"), true, "upsert_part applies under the projection");
  assert.equal(hasPart(undoRedoCtx.snapshots[2], "ent_u1"), false, "undo reverts the applied edit");
  assert.equal(hasPart(undoRedoCtx.snapshots[3], "ent_u1"), true, "redo re-applies the reverted edit");

  // Rejected action (applied:false) must be skipped entirely: it neither mutates
  // state nor wipes the redo stack. After upsert + undo, a rejected edit followed
  // by redo must still restore the upsert — proving the reject did not clear
  // future. Regression guard for the rejected-action replay bug.
  const rejected = projectStudyReplayState([
    { type: "project.snapshot", contextId: "ctx_r", t: 1, seq: 1, data: { reason: "initial", state: { ...baseState } } },
    { type: "project.action", contextId: "ctx_r", t: 2, seq: 2, data: { type: "upsert_part", part: part("ent_r1") } },
    { type: "project.undo", contextId: "ctx_r", t: 3, seq: 3, data: {} },
    { type: "project.action", contextId: "ctx_r", t: 4, seq: 4, data: { type: "update_part", partId: "ent_missing", updates: { locked: true }, applied: false } },
    { type: "project.redo", contextId: "ctx_r", t: 5, seq: 5, data: {} },
  ]);
  const rejectedCtx = rejected.contexts.find((c) => c.contextId === "ctx_r")!;
  assert.equal(hasPart(rejectedCtx.snapshots[3], "ent_r1"), false, "rejected action does not mutate state");
  assert.equal(hasPart(rejectedCtx.snapshots[4], "ent_r1"), true, "rejected action does not wipe the redo stack");

  // Reconnect: two contexts fold independently — an edit in one never bleeds into
  // the other's final state.
  const reconnect = projectStudyReplayState([
    { type: "project.snapshot", contextId: "ctx_a", t: 1, seq: 1, data: { reason: "initial", state: { ...baseState } } },
    { type: "project.action", contextId: "ctx_a", t: 2, seq: 2, data: { type: "upsert_part", part: part("ent_a") } },
    { type: "project.snapshot", contextId: "ctx_b", t: 3, seq: 1, data: { reason: "reconnect", state: { ...baseState } } },
    { type: "project.action", contextId: "ctx_b", t: 4, seq: 2, data: { type: "upsert_part", part: part("ent_b") } },
  ]);
  const ctxA = reconnect.contexts.find((c) => c.contextId === "ctx_a")!;
  const ctxB = reconnect.contexts.find((c) => c.contextId === "ctx_b")!;
  assert.equal(hasPart(ctxA.finalState, "ent_a"), true, "context a retains its edit");
  assert.equal(hasPart(ctxA.finalState, "ent_b"), false, "context a is untouched by context b");
  assert.equal(hasPart(ctxB.finalState, "ent_b"), true, "context b retains its edit");

  // Chunk reassembly: begin + 2 chunks collapse into one project.snapshot event
  // with zero losses, and the projection applies the reassembled state.
  const chunkedState = { marker: "reassembled", parts: { ent_c: { id: "ent_c" } }, paths: {}, sceneObjects: {}, mechanisms: [] };
  const encoded = Buffer.from(JSON.stringify(chunkedState)).toString("base64url");
  const split = Math.ceil(encoded.length / 2);
  const { events: reassembled, losses: chunkLosses } = reassembleStudyEvents([
    { type: "project.snapshot.begin", contextId: "ctx_c", t: 1, seq: 1, data: { snapshotId: "snp_c", reason: "chunked", total: 2 } },
    { type: "project.snapshot.chunk", contextId: "ctx_c", t: 2, seq: 2, data: { snapshotId: "snp_c", index: 0, parts: [encoded.slice(0, split)] } },
    { type: "project.snapshot.chunk", contextId: "ctx_c", t: 3, seq: 3, data: { snapshotId: "snp_c", index: 1, parts: [encoded.slice(split)] } },
  ]);
  assert.equal(chunkLosses.length, 0, "complete chunk set produces no loss");
  assert.equal(reassembled.length, 1, "begin + chunks collapse to one snapshot event");
  assert.equal(reassembled[0].type, "project.snapshot");
  const chunked = projectStudyReplayState(reassembled);
  assert.deepEqual(JSON.parse(JSON.stringify(chunked.contexts[0].finalState)), chunkedState, "reassembled snapshot folds into the projected state");

  // Incomplete chunk set surfaces a loss instead of silently bridging.
  const { losses: gapLosses } = reassembleStudyEvents([
    { type: "project.snapshot.begin", contextId: "ctx_g", t: 1, seq: 1, data: { snapshotId: "snp_g", reason: "chunked", total: 2 } },
    { type: "project.snapshot.chunk", contextId: "ctx_g", t: 2, seq: 2, data: { snapshotId: "snp_g", index: 0, parts: [encoded.slice(0, split)] } },
  ]);
  assert.equal(gapLosses.length, 1, "missing chunk is surfaced as a loss");
  assert.equal(gapLosses[0].kind, "incomplete_snapshot");
  console.log("projectStudyReplayState golden fidelity verified: undo/redo, rejected-action skip, reconnect, chunk reassembly");
}

const largeProject = createSampleProject();
const largePathId = Object.keys(largeProject.paths)[0];
const largePath = largeProject.paths[largePathId];
largeProject.paths = Object.fromEntries(Array.from({ length: 8 }, (_, pathIndex) => {
  const id = `large-path-${pathIndex}`;
  return [id, {
    ...largePath,
    id,
    points: Array.from({ length: 4_096 }, (__, index) => ({ x: index / 7, y: Math.sin((index + pathIndex) / 13) * 120 })),
  }];
}));
const largeRecords = makeStudySnapshotRecords(largeProject, projectAlias, "large", "snp_large") as Array<{ type: string; data: Record<string, unknown> }>;
assert(largeRecords.length > 2 && largeRecords[0].type === "project.snapshot.begin", "large snapshots split into replay records instead of being omitted");
assert(largeRecords.every((record) => Buffer.byteLength(JSON.stringify(record)) < 400 * 1024), "each snapshot chunk fits batch record limits");
const recoveredSnapshot = JSON.parse(Buffer.concat(largeRecords.slice(1).map((record) => {
  const parts = record.data.parts as string[];
  return Buffer.from(parts.join(""), "base64url");
})).toString("utf8"));
assert.deepEqual(recoveredSnapshot, studyProjectSnapshot(largeProject, projectAlias), "chunked snapshot round-trips exactly");
const preparedLarge = await prepareStudySnapshotRecords(largeProject, projectAlias, "large", "snp_large");
assert.deepEqual(preparedLarge.records, largeRecords, "worker snapshot preparation preserves the synchronous snapshot contract");
const identityVariant = structuredClone(largeProject);
identityVariant.metadata.name = "A Different Student";
identityVariant.parts[identityVariant.partOrder[0]].name = "Private Part Name";
const preparedIdentityVariant = await prepareStudySnapshotRecords(identityVariant, projectAlias, "different-reason", "snp_other");
assert.equal(preparedIdentityVariant.contentHash, preparedLarge.contentHash, "snapshot content hash ignores scrubbed identity and transport metadata");

const normalPolicy = studyTransportPolicyFor("normal");
const constrainedPolicy = studyTransportPolicyFor("constrained");
const recoveryPolicy = studyTransportPolicyFor("offline-recovery");
assert(
  constrainedPolicy.flushIntervalMs > normalPolicy.flushIntervalMs
    && constrainedPolicy.batchBytes > normalPolicy.batchBytes
    && constrainedPolicy.retryFloorMs > normalPolicy.retryFloorMs
    && constrainedPolicy.collapseSnapshots,
  "constrained transport batches more, flushes less, retries slower, and collapses stale snapshots",
);
assert(
  recoveryPolicy.outboxItemsPerDrain < normalPolicy.outboxItemsPerDrain
    && recoveryPolicy.drainDelayMs[1] > normalPolicy.drainDelayMs[1]
    && recoveryPolicy.collapseSnapshots,
  "offline recovery drains a small jittered window without a reconnect burst",
);

const checkpointBatch = (batchId: string, type: string) => ({
  batchId,
  json: JSON.stringify({ records: [{ type }] }),
});
const mergedCheckpoint = mergeExitCheckpointBatches(
  [
    checkpointBatch("snapshot-old", "project.snapshot"),
    checkpointBatch("core-old", "project.action"),
  ],
  [
    checkpointBatch("snapshot-new", "project.snapshot"),
    checkpointBatch("core-new", "stage.view"),
  ],
  3,
);
assert.deepEqual(
  mergedCheckpoint.batches.map((batch) => batch.batchId),
  ["core-old", "snapshot-new", "core-new"],
  "exit checkpoints merge instead of overwrite, retaining core actions and the newest snapshot",
);
assert.deepEqual(
  mergedCheckpoint.dropped.map((batch) => batch.batchId),
  ["snapshot-old"],
  "checkpoint pressure drops the oldest lower-priority snapshot first",
);
const snapshotCheckpointBatch = (
  batchId: string,
  snapshotId: string,
  fill: string,
) => ({
  batchId,
  json: JSON.stringify({
    participantId: "participant",
    sessionId: "session",
    contextId: "context",
    records: [{
      project: "project",
      type: "project.snapshot.chunk",
      data: { snapshotId, fill },
    }],
  }),
});
const checkpointCore = checkpointBatch("core", "project.action");
const olderSnapshot = [
  snapshotCheckpointBatch("snapshot-old-1", "snapshot-old", "x".repeat(200)),
  snapshotCheckpointBatch("snapshot-old-2", "snapshot-old", "x".repeat(200)),
];
const newerSnapshot = [
  snapshotCheckpointBatch("snapshot-new-1", "snapshot-new", "x".repeat(200)),
  snapshotCheckpointBatch("snapshot-new-2", "snapshot-new", "x".repeat(200)),
];
const byteBoundCheckpoint = mergeExitCheckpointBatches(
  [],
  [...olderSnapshot, ...newerSnapshot, checkpointCore],
  10,
  checkpointCore.json.length
    + newerSnapshot.reduce(
      (total, batch) => total + batch.batchId.length + batch.json.length,
      0,
    )
    + checkpointCore.batchId.length,
);
assert.deepEqual(
  byteBoundCheckpoint.batches.map((batch) => batch.batchId),
  ["snapshot-new-1", "snapshot-new-2", "core"],
  "checkpoint byte pressure keeps core actions and the newest complete snapshot",
);
assert.deepEqual(
  byteBoundCheckpoint.dropped.map((batch) => batch.batchId),
  ["snapshot-old-1", "snapshot-old-2"],
  "checkpoint byte pressure drops an old snapshot as one complete generation",
);

assert(studyProfileIncludes("metrics", "metrics") && !studyProfileIncludes("metrics", "replay"), "metrics profile sends metrics only");
assert(studyProfileIncludes("replay", "replay") && !studyProfileIncludes("replay", "study"), "replay profile adds semantic replay without pixels");
assert(studyProfileIncludes("study", "study"), "study profile includes all approved levels");

type Stored = {
  bytes: Uint8Array;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

class FakeR2 {
  objects = new Map<string, Stored>();

  async put(key: string, body: BodyInit | Uint8Array, options: { onlyIf?: { etagDoesNotMatch?: string }; httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } = {}) {
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    const bytes = body instanceof Uint8Array
      ? body
      : new Uint8Array(await new Response(body).arrayBuffer());
    const stored = { bytes, uploaded: new Date(), httpMetadata: options.httpMetadata, customMetadata: options.customMetadata };
    this.objects.set(key, stored);
    return { key, size: bytes.byteLength, ...stored };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      size: stored.bytes.byteLength,
      uploaded: stored.uploaded,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      body: new Blob([stored.bytes]).stream(),
      arrayBuffer: async () => stored.bytes.slice().buffer,
      json: async () => JSON.parse(new TextDecoder().decode(stored.bytes)),
    };
  }

  async delete(key: string) {
    return this.objects.delete(key);
  }

  async list(options: { prefix?: string; delimiter?: string; limit?: number; cursor?: string; include?: string[] } = {}) {
    const prefix = options.prefix || "";
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const delimitedPrefixes = new Set<string>();
    const objects = [];
    for (const key of keys) {
      const remainder = key.slice(prefix.length);
      if (options.delimiter && remainder.includes(options.delimiter)) {
        delimitedPrefixes.add(`${prefix}${remainder.split(options.delimiter)[0]}${options.delimiter}`);
        continue;
      }
      const stored = this.objects.get(key)!;
      objects.push({ key, size: stored.bytes.byteLength, customMetadata: stored.customMetadata });
    }
    return { objects: objects.slice(0, options.limit || 1000), delimitedPrefixes: [...delimitedPrefixes], truncated: false };
  }
}

const bucket = new FakeR2();
const env = {
  ALLOWED_ORIGIN: "https://alansynn.com",
  STUDY_BUCKET: bucket,
  GITHUB_TOKEN: "worker-secret",
  GITHUB_REPOSITORY: "AlanSynn/ms",
  ADMIN_TOKEN: "admin-secret",
};
const call = (request: Request) => worker.fetch(request, env);
const listCount = async (prefix: string) => {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, cursor });
    count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return count;
};

const envelope = {
  v: 1,
  eventSchema: STUDY_EVENT_SCHEMA,
  snapshotSchema: STUDY_SNAPSHOT_SCHEMA,
  batchId: "bat_00000000-0000-4000-8000-000000000001",
  deployment: "v0.0.9",
  appVersion: "0.0.9",
  buildSha: "0123456789abcdef0123456789abcdef01234567",
  profile: "study",
  classId: "class-a",
  classSessionId: "session-a",
  teamId: "team-a",
  participantId: "participant-a",
  sessionId: "ses_00000000-0000-4000-8000-000000000002",
  contextId: "ctx_00000000-0000-4000-8000-000000000003",
  sessionCount: 2,
  reconnectCount: 4,
  records: [{ seq: 1, t: 1250, type: "stage.view", stage: "character", project: "prj_00000000-0000-4000-8000-000000000004", data: { from: "character", to: "path", dwellMs: 1200 } }],
};

const batchResponse = await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify(envelope),
}));
assert.equal(batchResponse.status, 201, "valid batch stored");
assert([...bucket.objects.keys()].some((key) => key.includes(envelope.sessionId) && key.endsWith(".json.gz")), "session-keyed canonical gzip batch exists");

// Entity aliases must stay opaque to the Worker's phone/email identity guard.
// Aliases are grouped `ent_xxxx_xxxx_xxxx_xxxx` (4 hex per `_`-separated block).
// The deployed guard matches only SEPARATED digit groups (space/paren/dot/dash)
// or a leading-`+` run; underscore is not a phone separator, so the grouped
// alias never reads as a phone — and this must hold for hostile seeds too.
{
  const identityPattern = /(?:[^\s@]+@[^\s@]+\.[^\s@]+)|(?:\+?\(?\d{1,4}[ ().-]+\d{2,4}(?:[ ().-]+\d{2,4}){1,3})|(?:\+\d{7,15})/;
  for (const seed of ["part_a", "path_b", "joint_c", "9999999999", "1111111111111111", "p_00000000-0000-4000-8000-000000000001"]) {
    const alias = studyEntityAlias("prj_guard", seed);
    assert(/^ent_[0-9a-f]{4}(_[0-9a-f]{4}){3}$/.test(alias), `alias shape stable for ${seed}: ${alias}`);
    assert(!identityPattern.test(alias), `alias never reads as identity for ${seed}: ${alias}`);
  }
}

// A snapshot carrying aliased entity keys and values (whose hex digests hold long
// digit runs under the old format) must still ingest — the alias format keeps it
// opaque to the Worker's identity guard. This is the regression that the prod
// smoke caught: the prior single-record fixture had no aliased entity keys, so
// it never exercised a snapshot against the deployed validator.
{
  const snapshotEnvelope = {
    ...envelope,
    batchId: "bat_00000000-0000-4000-8000-0000000000snap",
    records: [
      { seq: 1, t: 500, type: "project.snapshot", stage: "character", project: "prj_snap", data: { reason: "initial", snapshotSchema: STUDY_SNAPSHOT_SCHEMA, state: studyProjectSnapshot(createSampleProject(), "prj_snap") } },
    ],
  };
  const snapshotResponse = await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(snapshotEnvelope),
  }));
  assert.equal(snapshotResponse.status, 201, `snapshot with aliased entity keys ingests instead of being rejected as identity: ${await snapshotResponse.text()}`);
}

// A rejected-action record carries applied:false. The flag is a boolean (no
// digit run, no PII), so it is identity-guard-safe and the Worker must accept
// it at ingest — the replay projection handles skipping applied:false, not the
// collector.
{
  const rejectedEnvelope = {
    ...envelope,
    batchId: "bat_00000000-0000-4000-8000-0000000000rej",
    records: [
      { seq: 1, t: 500, type: "project.action", stage: "character", project: "prj_rej", data: { ...studyProjectAction({ type: "update_part", partId: "part_does_not_exist", updates: { locked: false } }, "prj_rej"), applied: false } },
    ],
  };
  const rejectedResponse = await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(rejectedEnvelope),
  }));
  assert.equal(rejectedResponse.status, 201, `applied:false project.action ingests (identity-guard-safe flag): ${await rejectedResponse.text()}`);
}

// The two new low-cardinality study fields — simulation.validation.category
// (enum) and recommendation.candidates[].reasonKey (enum) plus
// recommendation.accept rank/score/candidateCount (numbers) — must ingest.
// The enum slugs carry no digit run and the numerics are real JSON numbers
// (not strings), so the Worker's 9+-digit identity guard must not mistake any
// of them for PII and reject the batch. This is the release gate: the new
// fields ship only if they survive the deployed validator on real numeric
// payloads (a long digit run in a score string would have been caught here).
{
  const numericEnvelope = {
    ...envelope,
    batchId: "bat_00000000-0000-4000-8000-0000000000num",
    records: [
      { seq: 1, t: 500, type: "simulation.validation", stage: "foundry", project: "prj_num", data: { mechanismType: "4bar", valid: false, category: "collision" } },
      { seq: 2, t: 510, type: "recommendation.candidates", stage: "path", project: "prj_num", data: { candidates: [
        { type: "4bar", score: 0.917, blocked: false, reasonKey: "arc_limb" },
        { type: "crank", score: 0.812, blocked: true, reasonKey: "blocked" },
        { type: "compact", score: 0.76, blocked: false, reasonKey: "compact_loop" },
      ] } },
      { seq: 3, t: 520, type: "recommendation.accept", stage: "path", project: "prj_num", data: { mechanismType: "4bar", presetId: "recommendation-4bar", rank: 1, score: 0.917, candidateCount: 3 } },
    ],
  };
  const numericResponse = await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(numericEnvelope),
  }));
  assert.equal(numericResponse.status, 201, `enum+numeric study fields ingest through the identity guard: ${await numericResponse.text()}`);
}

// Hardened identity guard (#17). The phone arm now requires SEPARATORS (or a
// leading '+') so a bare digit run no longer reads as PII. A stringified
// timestamp / numeric ID — the false positive that bit new telemetry string
// fields — must INGEST, while formatted and international phones still reject.
// All three use the neutral key `value` (not a DIRECT_KEY), so the verdict is
// driven solely by the value regex, not the key blocklist.
{
  // Bare 13-digit run, no separators, no '+'. The prior `+?\d[\d ().-]{7,}\d`
  // arm matched this and rejected; it must now ingest.
  const bareNumeric = structuredClone(envelope);
  bareNumeric.batchId = "bat_00000000-0000-4000-8000-000000000bare";
  bareNumeric.records[0].data = { value: "1719900000000" } as never;
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(bareNumeric),
  }))).status, 201, "bare 13-digit numeric string ingests (no longer a phone false positive)");

  // Formatted domestic phone (separators between digit groups) — still rejected.
  const formattedPhone = structuredClone(envelope);
  formattedPhone.batchId = "bat_00000000-0000-4000-8000-0000000000ph1";
  formattedPhone.records[0].data = { value: "555-123-4567" } as never;
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(formattedPhone),
  }))).status, 400, "formatted domestic phone (separators) still rejected");

  // Bare international phone (leading '+', 7-15 digits) — still rejected.
  const intlPhone = structuredClone(envelope);
  intlPhone.batchId = "bat_00000000-0000-4000-8000-0000000000ph2";
  intlPhone.records[0].data = { value: "+15551234567" } as never;
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(intlPhone),
  }))).status, 400, "bare international phone (+ leading) still rejected");
}

const duplicateGzipBody = await new Response(new Blob([JSON.stringify(envelope)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
const batchObjectsBeforeDuplicate = bucket.objects.size;
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json", "Content-Encoding": "gzip" },
  body: duplicateGzipBody,
}))).status, 200, "same batch sent by beacon and gzip queue deduplicates");
assert.equal(bucket.objects.size, batchObjectsBeforeDuplicate, "transport encoding cannot create duplicate replay records");
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify({ ...envelope, records: [{ ...envelope.records[0], t: 9999 }] }),
}))).status, 409, "same batch id with different contents is rejected");

const gzipBody = await new Response(new Blob([JSON.stringify({ ...envelope, batchId: "bat_00000000-0000-4000-8000-000000000005" })]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
const gzipResponse = await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json", "Content-Encoding": "gzip" },
  body: gzipBody,
}));
assert.equal(gzipResponse.status, 201, "gzip batch stored");

const identityLeak = structuredClone(envelope);
identityLeak.batchId = "bat_00000000-0000-4000-8000-000000000006";
identityLeak.records[0].data = { email: "student@example.com" } as never;
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify(identityLeak),
}))).status, 400, "server rejects direct-identity field");
const neutralIdentityLeak = structuredClone(envelope);
neutralIdentityLeak.batchId = "bat_00000000-0000-4000-8000-000000000008";
neutralIdentityLeak.records[0].data = { value: "student@example.com" } as never;
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify(neutralIdentityLeak),
}))).status, 400, "server rejects identity-shaped values even under neutral keys");
const derivedSkeletonLeak = structuredClone(envelope);
derivedSkeletonLeak.batchId = "bat_00000000-0000-4000-8000-000000000009";
derivedSkeletonLeak.records[0].data = { jointMap: { student_private_joint: "student-private-joint" } } as never;
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify(derivedSkeletonLeak),
}))).status, 400, "server rejects derived skeleton maps that can retain raw ids");
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
  body: JSON.stringify(envelope),
}))).status, 403, "collector rejects foreign origin");
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify({ ...envelope, v: 2, batchId: "bat_00000000-0000-4000-8000-000000000007" }),
}))).status, 400, "schema version changes are rejected instead of silently misread");

const gzipBomb = await new Response(new Blob([`{"padding":"${"x".repeat(600 * 1024)}"}`]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json", "Content-Encoding": "gzip" },
  body: gzipBomb,
}))).status, 413, "collector caps decompressed batches while streaming");

assert.equal((await worker.fetch(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify({ ...envelope, batchId: "bat_rate-limited" }),
}), {
  ...env,
  INGEST_RATE_LIMITER: { limit: async () => ({ success: false }) },
})).status, 429, "tokenless collector rate-limits abusive sources without persisting IP data");

assert.equal((await worker.fetch(new Request("https://alansynn.com/ms-study/v1/batch", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
  body: JSON.stringify({ ...envelope, batchId: "bat_00000000-0000-4000-8000-000000000010" }),
}), {
  ...env,
  PARTICIPANT_RATE_LIMITER: { limit: async () => ({ success: false }) },
})).status, 429, "participant limit is independent from the shared-NAT IP backstop");

{
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  };
  const response = await worker.fetch(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: {
      Origin: "https://alansynn.com",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.9",
    },
    body: JSON.stringify({ ...envelope, batchId: "bat_00000000-0000-4000-8000-000000000011" }),
  }), { ...env, INGEST_RATE_LIMITER: limiter });
  assert.equal(response.status, 201, "shared-NAT request remains accepted when both buckets allow it");
  assert(keys.some((key) => key.includes(":ip:")) && keys.some((key) => key.includes(":participant:")), "ingest checks separate participant and IP keys");
}

const loadResponses = await Promise.all(Array.from({ length: 300 }, (_, index) => {
  const suffix = index.toString().padStart(3, "0");
  return call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify({
      ...envelope,
      batchId: `bat_load-${suffix}`,
      sessionId: `ses_load-${suffix}`,
      contextId: `ctx_load-${suffix}`,
    }),
  }));
}));
assert(loadResponses.every((response) => response.status === 201), "collector accepts 300 independent classroom clients without shared mutable state");

const assetMeta = {
  v: 1,
  deployment: "v0.0.9",
  participantId: "participant-a",
  sessionId: envelope.sessionId,
  contextId: envelope.contextId,
  projectId: "prj_00000000-0000-4000-8000-000000000004",
  assetId: "ast_0123456789abcdef0123456789abcdef",
  kind: "character",
  width: 1,
  height: 1,
  bytes: 8,
};
const assetHeader = Buffer.from(JSON.stringify(assetMeta)).toString("base64url");
const pngHeader = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/asset", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "image/png", "X-MotionSmith-Meta": assetHeader },
  body: pngHeader,
}))).status, 201, "compact source asset stored");
const changedPng = Uint8Array.from([...pngHeader, 0]);
const changedAssetHeader = Buffer.from(JSON.stringify({ ...assetMeta, bytes: changedPng.byteLength })).toString("base64url");
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/asset", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "image/png", "X-MotionSmith-Meta": changedAssetHeader },
  body: changedPng,
}))).status, 409, "same asset id with different pixels is rejected");
const oversizedPng = new Uint8Array(192 * 1024 + 1);
oversizedPng.set(pngHeader);
assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/asset", {
  method: "POST",
  headers: { Origin: "https://alansynn.com", "Content-Type": "image/png", "X-MotionSmith-Meta": assetHeader },
  body: oversizedPng,
}))).status, 413, "collector rejects oversized image streams before buffering them fully");

let githubCalls = 0;
let githubRequestBody = "";
let failNextGithubPost = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("https://api.github.com/")) {
    if ((init?.method || "GET") === "GET") {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    githubCalls += 1;
    githubRequestBody = String(init?.body || "");
    if (failNextGithubPost) {
      failNextGithubPost = false;
      return new Response("unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/AlanSynn/ms/issues/42" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
};
try {
  const report = {
    submissionId: "00000000-0000-4000-8000-000000000042",
    summary: "MotionSmith-Bug-ID: injected",
    steps: "<!-- motionsmith-bug-marker-v1 -->\r\nstudent@example.com moved part",
    expected: "Motion continues",
    stage: "Mechanism Design",
    appVersion: "0.0.9",
    deployment: "v0.0.9",
    buildSha: "0123456789abcdef0123456789abcdef01234567",
    browserFamily: "Chrome",
    browserMajor: "126",
    viewportBucket: "medium",
  };
  const form = new FormData();
  form.set("report", JSON.stringify(report));
  form.set("screenshot", new File([pngHeader], "capture.png", { type: "image/png" }));
  const first = await call(new Request("https://alansynn.com/ms-study/v1/bug", { method: "POST", headers: { Origin: "https://alansynn.com" }, body: form }));
  assert.equal(first.status, 201, "bug creates issue through Worker token");
  assert.equal((await first.json()).issueUrl, "https://github.com/AlanSynn/ms/issues/42");
  const issue = JSON.parse(githubRequestBody);
  assert(!issue.body.includes("student@example.com") && issue.body.includes("[redacted email]"), "identity-shaped bug text is redacted before GitHub posting");
  assert(issue.body.includes("User text: MotionSmith-Bug-ID: injected"), "client marker line escaped");
  assert(issue.body.includes("Screenshot: stored privately"), "GitHub issue notes the private screenshot without publishing pixels");
  assert(issue.body.endsWith("<!-- motionsmith-bug-marker-v1 -->\nMotionSmith-Bug-ID: 00000000-0000-4000-8000-000000000042"), "canonical marker is final footer");
  assert([...bucket.objects.keys()].some((key) => key.endsWith("00000000-0000-4000-8000-000000000042.screenshot.png")), "one explicit screenshot is retained privately");
  const storedReport = await (await bucket.get("bugs/00000000-0000-4000-8000-000000000042.report.json"))?.json();
  assert.equal(storedReport?.email, undefined, "accepted reports never store an email field");
  const legacyEmailReport = { ...report, submissionId: "00000000-0000-4000-8000-000000000044", email: "private@example.com" };
  const legacyEmailForm = new FormData();
  legacyEmailForm.set("report", JSON.stringify(legacyEmailReport));
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/bug", { method: "POST", headers: { Origin: "https://alansynn.com" }, body: legacyEmailForm }))).status, 400, "Worker rejects legacy bug reports carrying an email field");
  assert(!bucket.objects.has("bugs/00000000-0000-4000-8000-000000000044.report.json"), "rejected legacy email reports are not stored");
  const duplicate = await call(new Request("https://alansynn.com/ms-study/v1/bug", { method: "POST", headers: { Origin: "https://alansynn.com" }, body: form }));
  assert.equal(duplicate.status, 200, "duplicate report returns stored issue");
  assert.equal(githubCalls, 1, "duplicate never creates second GitHub issue");

  const retryReport = { ...report, submissionId: "00000000-0000-4000-8000-000000000043" };
  const retryForm = new FormData();
  retryForm.set("report", JSON.stringify(retryReport));
  failNextGithubPost = true;
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/bug", { method: "POST", headers: { Origin: "https://alansynn.com" }, body: retryForm }))).status, 503, "temporary GitHub failure remains retryable");
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/bug", { method: "POST", headers: { Origin: "https://alansynn.com" }, body: retryForm }))).status, 201, "same bug id succeeds after temporary GitHub failure");
  assert.equal(githubCalls, 3, "retry creates one failed and one successful GitHub request without duplicate success");
} finally {
  globalThis.fetch = realFetch;
}

const admin = await call(new Request(`https://alansynn.com/ms-study/v1/admin/session/${envelope.sessionId}?deployment=v0.0.9`, {
  headers: { Authorization: "Bearer admin-secret" },
}));
assert.equal(admin.status, 200, "admin can retrieve session replay");
const replay = await admin.json() as { batches: unknown[]; assets: unknown[] };
assert(replay.batches.length >= 2 && replay.assets.length === 1, "admin replay joins semantic batches and imported visuals by session");
assert(replay.batches.every((batch) => typeof (batch as { receivedAt?: unknown }).receivedAt === "string"), "server receipt times anchor relative replay records to real session time");
assert.equal((await call(new Request(`https://alansynn.com/ms-study/v1/admin/session/${envelope.sessionId}?deployment=v0.0.9`))).status, 401, "session replay stays private");

const contextA = "ctx_00000000-0000-4000-8000-0000000000aa";
const contextB = "ctx_00000000-0000-4000-8000-0000000000bb";
const replayStateA = { marker: "context-a", parts: {}, paths: {}, sceneObjects: {}, mechanisms: [] };
const encodedReplayStateA = Buffer.from(JSON.stringify(replayStateA)).toString("base64url");
const replaySplit = Math.ceil(encodedReplayStateA.length / 2);
const replayBatches = [
  {
    ...envelope,
    contextId: contextA,
    records: [
      { seq: 1, t: 10, type: "project.snapshot.begin", stage: "character", data: { snapshotId: "snp_replay", reason: "test", total: 2 } },
      { seq: 2, t: 11, type: "project.snapshot.chunk", stage: "character", data: { snapshotId: "snp_replay", index: 0, parts: [encodedReplayStateA.slice(0, replaySplit)] } },
    ],
  },
  {
    ...envelope,
    contextId: contextA,
    records: [
      { seq: 3, t: 12, type: "project.snapshot.chunk", stage: "character", data: { snapshotId: "snp_replay", index: 1, parts: [encodedReplayStateA.slice(replaySplit)] } },
      { seq: 4, t: 13, type: "project.action", stage: "path", data: { type: "upsert_path", path: { id: "ent_replay_path", partId: "ent_replay_part", points: [{ x: 10, y: 20 }], visible: true } } },
      { seq: 5, t: 14, type: "stage.view", stage: "path", data: { from: "character", to: "path" } },
    ],
  },
  {
    ...envelope,
    contextId: contextB,
    records: [
      { seq: 1, t: 10, type: "project.snapshot", stage: "character", data: { state: { marker: "context-b", parts: {}, paths: {}, sceneObjects: {}, mechanisms: [] } } },
    ],
  },
];

const replayFixture = Bun.serve({
  port: 0,
  fetch(request) {
    if (request.headers.get("Authorization") !== "Bearer replay-secret") return new Response("no", { status: 401 });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/admin/session/")) {
      return Response.json({
        batches: replayBatches,
        assets: [{ key: "assets/v0.0.9/sessions/example/project/asset.png", size: pngHeader.byteLength, metadata: { kind: "character" } }],
        cursor: null,
      });
    }
    if (url.pathname === "/admin/object") return new Response(pngHeader, { headers: { "Content-Type": "image/png" } });
    return new Response("missing", { status: 404 });
  },
});
const replayDir = await mkdtemp(join(tmpdir(), "motionsmith-replay-"));
const replayPath = join(replayDir, "replay.html");
try {
  const replayCommand = [
    "bun",
    "scripts/study-replay.ts",
    "--endpoint",
    `http://127.0.0.1:${replayFixture.port}`,
    "--deployment",
    "v0.0.9",
    "--session",
    envelope.sessionId,
    "--out",
    replayPath,
  ];
  const child = Bun.spawn(replayCommand, {
    cwd: process.cwd(),
    env: { ...process.env, STUDY_ADMIN_TOKEN: "replay-secret" },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(await child.exited, 0, `replay CLI exits cleanly: ${await new Response(child.stderr).text()}`);
  const replayHtml = await readFile(replayPath, "utf8");
  const replayScript = replayHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
  assert.doesNotThrow(() => new Function(replayScript), "generated replay JavaScript parses");
  assert(replayHtml.includes("MotionSmith Study Replay") && replayHtml.includes("context-a") && replayHtml.includes("context-b") && replayHtml.includes("function applyAction") && replayHtml.includes("ent_replay_path") && replayHtml.includes('stage.view') && replayHtml.includes(Buffer.from(pngHeader).toString("base64")), "replay CLI reassembles snapshots, applies semantic actions per context, and embeds source visuals");
  assert.equal((await stat(replayPath)).mode & 0o777, 0o600, "replay output is owner-readable only");
  const overwrite = Bun.spawn(replayCommand, {
    cwd: process.cwd(),
    env: { ...process.env, STUDY_ADMIN_TOKEN: "replay-secret" },
    stdout: "ignore",
    stderr: "ignore",
  });
  assert.notEqual(await overwrite.exited, 0, "replay CLI does not overwrite an existing private artifact without --force");
} finally {
  replayFixture.stop(true);
  await rm(replayDir, { recursive: true, force: true });
}

// Incomplete chunked snapshots must surface a visible gap, not bridge silently.
// A session whose begin declares total:2 but only delivers chunk 0 leaves the
// context reconstructing from a stale/null baseline — the CLI must report that
// in its log and the generated HTML banner (regression guard for the
// silent-snapshot-loss fix).
{
  const incompleteBatches = [
    {
      ...envelope,
      contextId: "ctx_00000000-0000-4000-8000-0000000000gap",
      records: [
        { seq: 1, t: 10, type: "project.snapshot.begin", stage: "character", data: { snapshotId: "snp_gap", reason: "test", total: 2 } },
        { seq: 2, t: 11, type: "project.snapshot.chunk", stage: "character", data: { snapshotId: "snp_gap", index: 0, parts: [encodedReplayStateA.slice(0, replaySplit)] } },
      ],
    },
  ];
  const gapFixture = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.headers.get("Authorization") !== "Bearer replay-secret") return new Response("no", { status: 401 });
      return Response.json({ batches: incompleteBatches, assets: [], cursor: null });
    },
  });
  const gapDir = await mkdtemp(join(tmpdir(), "motionsmith-replay-gap-"));
  const gapPath = join(gapDir, "gap.html");
  try {
    const child = Bun.spawn(
      ["bun", "scripts/study-replay.ts", "--endpoint", `http://127.0.0.1:${gapFixture.port}`, "--deployment", "v0.0.9", "--session", envelope.sessionId, "--out", gapPath],
      { cwd: process.cwd(), env: { ...process.env, STUDY_ADMIN_TOKEN: "replay-secret" }, stdout: "pipe", stderr: "pipe" },
    );
    const stdoutText = await new Response(child.stdout).text();
    assert.equal(await child.exited, 0, `gap replay CLI exits cleanly: ${await new Response(child.stderr).text()}`);
    assert(stdoutText.includes("gap"), `CLI surfaces snapshot gap in its log: ${stdoutText}`);
    const gapHtml = await readFile(gapPath, "utf8");
    assert(gapHtml.includes("gap"), "generated HTML surfaces snapshot gap in its banner");
  } finally {
    gapFixture.stop(true);
    await rm(gapDir, { recursive: true, force: true });
  }
}

// Exit-checkpoint recovery must survive a release-tag bump. VITE_STUDY_DEPLOYMENT
// is the git ref_name, so every release changes `deployment`. A checkpoint written
// under the previous tag must still recover next session — the body carries
// deployment and the server partitions by it, so the validator must not require the
// in-body deployment to equal the running one (regression guard for the data-loss
// bug where a tag bump silently orphaned undelivered pagehide checkpoints).
{
  const batchId = "bat_00000000-0000-4000-8000-000000000000";
  const envelope = (deployment: string) => JSON.stringify({
    batchId,
    deployment,
    profile: "study",
    eventSchema: "motionsmith-study-event-v1",
    records: [],
  });
  assert.equal(
    checkpointBatchIntact({ batchId, json: envelope("v1.2.3") }, "study"),
    true,
    "checkpoint batch with a well-formed body is intact",
  );
  assert.equal(
    checkpointBatchIntact({ batchId, json: envelope("v1.2.4") }, "study"),
    true,
    "checkpoint recovers across a deployment/tag bump (deployment not equality-checked)",
  );
  assert.equal(
    checkpointBatchIntact({ batchId, json: envelope("v1.2.4") }, "metrics"),
    false,
    "checkpoint is rejected when its capture profile exceeds the running profile",
  );
  assert.equal(
    checkpointBatchIntact({ batchId, json: envelope("v1.2.4").replace('"deployment":"v1.2.4"', '"deployment":9') }, "study"),
    false,
    "checkpoint is rejected when the in-body deployment is malformed",
  );
  assert.equal(
    checkpointBatchIntact({ batchId: "bat_not-a-uuid", json: envelope("v1.2.4") }, "study"),
    false,
    "checkpoint is rejected when the batch id is malformed",
  );
  assert.equal(
    checkpointBatchIntact({ batchId, json: envelope("v1.2.4").replace(batchId, "bat_deadbeef-0000-4000-8000-000000000000") }, "study"),
    false,
    "checkpoint is rejected when the body batchId does not match the wrapper",
  );
}

// Admin purge (DELETE) clears telemetry + assets for a deployment tag or a
// single session, so test/smoke data can be wiped before real classroom
// sessions — research data must not mix with test logs. Requires ADMIN_TOKEN;
// the deployment-wide purge additionally requires ?confirm=<tag>.
{
  const beforeTelemetry = await listCount("telemetry/v0.0.9/");
  const beforeAssets = await listCount("assets/v0.0.9/");
  assert(beforeTelemetry > 0 && beforeAssets > 0, "fixtures populated telemetry + assets before purge");

  // Auth + confirm guards on the destructive deployment-wide route.
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/admin/deployment/v0.0.9?confirm=v0.0.9", { method: "DELETE" }))).status, 401, "deployment purge requires admin token");
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/admin/deployment/v0.0.9", { headers: { Authorization: "Bearer admin-secret" }, method: "DELETE" }))).status, 400, "deployment purge requires the tag echoed as confirm");
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/admin/deployment/v0.0.9?confirm=other", { headers: { Authorization: "Bearer admin-secret" }, method: "DELETE" }))).status, 400, "deployment purge rejects a mismatched confirm");
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/admin/session/ses_x?deployment=v0.0.9", { method: "DELETE" }))).status, 401, "session purge requires admin token");

  // Deployment-wide purge clears telemetry + assets for the tag.
  const deployPurge = await call(new Request("https://alansynn.com/ms-study/v1/admin/deployment/v0.0.9?confirm=v0.0.9", { headers: { Authorization: "Bearer admin-secret" }, method: "DELETE" }));
  assert.equal(deployPurge.status, 200, "admin can purge a whole deployment");
  const deployBody = await deployPurge.json() as { purged: { telemetry: number; assets: number } };
  assert(deployBody.purged.telemetry >= 1 && deployBody.purged.assets >= 1, "deployment purge deletes across telemetry + asset prefixes");
  assert.equal(await listCount("telemetry/v0.0.9/"), 0, "deployment purge empties telemetry");
  assert.equal(await listCount("assets/v0.0.9/"), 0, "deployment purge empties assets");

  // Single-session purge: ingest under a fresh session, then remove just it.
  const purgeSession = "ses_purge-target-0001";
  const purgeCtx = "ctx_purge-target-0001";
  const ingestEnvelope = {
    ...envelope,
    batchId: "bat_purge-target-0001",
    sessionId: purgeSession,
    contextId: purgeCtx,
    deployment: "v0.0.9",
  };
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify(ingestEnvelope),
  }))).status, 201, "purge-target batch ingested");
  const neighborSession = "ses_purge-neighbor-0001";
  assert.equal((await call(new Request("https://alansynn.com/ms-study/v1/batch", {
    method: "POST",
    headers: { Origin: "https://alansynn.com", "Content-Type": "application/json" },
    body: JSON.stringify({ ...ingestEnvelope, batchId: "bat_purge-neighbor-0001", sessionId: neighborSession }),
  }))).status, 201, "neighbor batch ingested");
  const sessionPurge = await call(new Request(`https://alansynn.com/ms-study/v1/admin/session/${purgeSession}?deployment=v0.0.9`, { headers: { Authorization: "Bearer admin-secret" }, method: "DELETE" }));
  assert.equal(sessionPurge.status, 200, "admin can purge a single session");
  const sessionBody = await sessionPurge.json() as { purged: { telemetry: number; assets: number } };
  assert(sessionBody.purged.telemetry >= 1, "session purge reports telemetry deletes");
  assert.equal(await listCount(`telemetry/v0.0.9/sessions/${purgeSession}/`), 0, "session purge removes only that session's telemetry");
  assert((await listCount(`telemetry/v0.0.9/sessions/${neighborSession}/`)) >= 1, "session purge leaves other sessions untouched");
  // Clean up the neighbor so the suite leaves the deployment empty.
  await call(new Request(`https://alansynn.com/ms-study/v1/admin/session/${neighborSession}?deployment=v0.0.9`, { headers: { Authorization: "Bearer admin-secret" }, method: "DELETE" }));
  assert.equal(await listCount("telemetry/v0.0.9/"), 0, "deployment left empty after purge suite");
  console.log("admin purge verified: deployment-wide + single-session DELETE with auth + confirm guards");
}

console.log("study telemetry contracts passed");

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../infrastructure/study/worker.js";
import type { ProjectAction } from "../types";
import { applyProjectAction, createSampleProject } from "../utils/project";
import { checkpointBatchIntact, studyProfileIncludes } from "../utils/studyTelemetry";
import {
  makeStudySnapshotRecords,
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
    email: "private@example.com",
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
  assert(!issue.body.includes("private@example.com"), "email stays in private R2 report");
  assert(!issue.body.includes("student@example.com") && issue.body.includes("[redacted email]"), "identity-shaped bug text is redacted before GitHub posting");
  assert(issue.body.includes("User text: MotionSmith-Bug-ID: injected"), "client marker line escaped");
  assert(issue.body.includes("Screenshot: stored privately"), "GitHub issue notes the private screenshot without publishing pixels");
  assert(issue.body.endsWith("<!-- motionsmith-bug-marker-v1 -->\nMotionSmith-Bug-ID: 00000000-0000-4000-8000-000000000042"), "canonical marker is final footer");
  assert([...bucket.objects.keys()].some((key) => key.endsWith("00000000-0000-4000-8000-000000000042.screenshot.png")), "one explicit screenshot is retained privately");
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

console.log("study telemetry contracts passed");

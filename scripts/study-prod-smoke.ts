#!/usr/bin/env bun
// scripts/study-prod-smoke.ts
//
// One-shot, idempotent production smoke for the /ms-study/v1 replay pipeline.
// Posts a single de-identified batch through the REAL client scrub path
// (studyProjectSnapshot / studyProjectAction / makeStudySnapshotRecords), then
// drives the deployed Worker's admin + replay endpoints to prove the full
// ingest -> R2 -> admin -> replay chain on production infra.
//
// Re-runs are idempotent: the batchId is fixed, so the Worker deduplicates and
// no test data accumulates. Records are de-identified (scrubbed + aliased + the
// Worker re-validates and would 400 on any identity leak) and sit under an
// isolated "smoke-*" deployment tag so they are clearly test data and never mix
// with classroom sessions.
//
// Requires STUDY_ADMIN_TOKEN in the environment (source .env first):
//   set -a; . ./.env; set +a
//   bun scripts/study-prod-smoke.ts [--endpoint URL] [--deployment TAG] [--out PATH]

import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { ProjectAction } from "../types";
import { applyProjectAction, createSampleProject } from "../utils/project";
import {
  STUDY_EVENT_SCHEMA,
  STUDY_SNAPSHOT_SCHEMA,
  makeStudySnapshotRecords,
  studyProjectAction,
} from "../utils/studyTelemetryProject";

type Args = { endpoint?: string; deployment?: string; out?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--endpoint" && value) { args.endpoint = value; index += 1; }
    else if (flag === "--deployment" && value) { args.deployment = value; index += 1; }
    else if (flag === "--out" && value) { args.out = value; index += 1; }
  }
  return args;
}

function die(message: string): never {
  console.error(`study-prod-smoke: FAIL — ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint ?? "https://alansynn.com/ms-study/v1";
const deployment = args.deployment ?? "smoke-prod";
const outPath = args.out ?? "/tmp/ms-prod-smoke-replay.html";
const token = process.env.STUDY_ADMIN_TOKEN;
if (!token) die("STUDY_ADMIN_TOKEN is required (run `set -a; . ./.env; set +a` first)");

const allowedOrigin = "https://alansynn.com";
const projectAlias = "prj_smoke";
const sessionId = "ses_smoke-00000000-0000-4000-8000-000000000001";
const contextId = "ctx_smoke-00000000-0000-4000-8000-000000000002";
const batchId = "bat_smoke-00000000-0000-4000-8000-000000000003";

let buildSha = "smoke.00000000000000000000000000000000000000";
try { buildSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || buildSha; } catch { /* keep placeholder */ }

// Build a realistic, ordered record stream from a synthetic project: a session
// start, a navigation, a baseline snapshot, two authored edits, a post-edit
// snapshot, and another navigation. Snapshots + actions go through the real
// scrub/alias path so the batch is byte-identical in shape to real client traffic.
const base = createSampleProject();
const firstPart = base.partOrder[0] ?? die("sample project has no parts to exercise");
const edits: ProjectAction[] = [
  { type: "update_part", partId: firstPart, updates: { locked: false } },
  { type: "select_part", partId: firstPart },
];
let current = base;
for (const action of edits) current = applyProjectAction(current, action);

const baseSnapshot = makeStudySnapshotRecords(base, projectAlias, "initial", "snp_smoke_1");
const nextSnapshot = makeStudySnapshotRecords(current, projectAlias, "after-edits", "snp_smoke_2");
const actionRecords = edits.map((action) => ({ type: "project.action", data: studyProjectAction(action, projectAlias) }));

type RawRecord = { type: string; stage?: string; data: unknown };
const rawRecords: RawRecord[] = [
  { type: "session.start", stage: "character", data: { profile: "replay", entryStage: "character" } },
  { type: "stage.view", stage: "path", data: { from: "character", to: "path", dwellMs: 1200 } },
  ...baseSnapshot.map((record) => ({ ...record, stage: "character" })),
  ...actionRecords.map((record) => ({ ...record, stage: "character" })),
  ...nextSnapshot.map((record) => ({ ...record, stage: "character" })),
  { type: "stage.view", stage: "foundry", data: { from: "path", to: "foundry", dwellMs: 900 } },
];
const expectedRecords = rawRecords.length;

const records = rawRecords.map((record, index) => ({
  seq: index + 1,
  t: 1000 * (index + 1),
  type: record.type,
  stage: record.stage,
  project: projectAlias,
  data: record.data,
}));

const envelope = {
  v: 1,
  eventSchema: STUDY_EVENT_SCHEMA,
  snapshotSchema: STUDY_SNAPSHOT_SCHEMA,
  batchId,
  deployment,
  appVersion: "0.0.9",
  buildSha,
  profile: "replay",
  classId: "smoke-class",
  classSessionId: "smoke-session",
  teamId: "smoke-team",
  participantId: "smoke-participant",
  sessionId,
  contextId,
  sessionCount: 1,
  reconnectCount: 1,
  records,
};

// 1. Ingest: POST the batch through the deployed Worker. Origin is the allowed
//    origin so the public-write gate accepts it; identity encoding is fine, the
//    Worker gzips on store.
const postResponse = await fetch(`${endpoint}/batch`, {
  method: "POST",
  headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
  body: JSON.stringify(envelope),
});
const postBody = await postResponse.text();
console.log(`POST /batch            -> ${postResponse.status} ${postBody}`);
if (postResponse.status !== 201 && postResponse.status !== 200) {
  die(`batch ingest rejected by Worker (status ${postResponse.status})`);
}

// 2. Admin list: the session must appear under the smoke deployment tag.
const listUrl = `${endpoint}/admin/sessions?deployment=${encodeURIComponent(deployment)}`;
const listResponse = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
const listed = await listResponse.json().catch(() => ({ sessions: [] })) as { sessions?: string[] };
console.log(`GET  /admin/sessions   -> ${listResponse.status} sessions=${listed.sessions?.length ?? 0}`);
if (listResponse.status !== 200) die(`admin sessions list failed (status ${listResponse.status})`);
if (!listed.sessions?.includes(sessionId)) die("ingested session is not listed under its deployment tag");

// 3. Admin session detail: confirm the batch + any assets are retrievable.
const sessionUrl = `${endpoint}/admin/session/${sessionId}?deployment=${encodeURIComponent(deployment)}`;
const sessionResponse = await fetch(sessionUrl, { headers: { Authorization: `Bearer ${token}` } });
const session = await sessionResponse.json().catch(() => ({ batches: [], assets: [] })) as { batches?: unknown[]; assets?: unknown[] };
console.log(`GET  /admin/session    -> ${sessionResponse.status} batches=${session.batches?.length ?? 0} assets=${session.assets?.length ?? 0}`);
if ((session.batches?.length ?? 0) < 1) die("session detail returned no batches");

// 4. Replay: generate a self-contained HTML through the real replay CLI against
//    production, then assert it reconstructed the record stream losslessly.
const replay = spawnSync("bun", ["scripts/study-replay.ts", "--endpoint", endpoint, "--deployment", deployment, "--session", sessionId, "--out", outPath], {
  cwd: process.cwd(),
  env: { ...process.env, STUDY_ADMIN_TOKEN: token },
  encoding: "utf8",
});
const replayStdout = (replay.stdout ?? "").trim();
const replayStderr = (replay.stderr ?? "").trim();
console.log(`study-replay            -> exit ${replay.status} :: ${replayStdout}`);
if (replay.status !== 0) die(`replay CLI failed:\n${replayStderr}`);

const html = readFileSync(outPath, "utf8");
const checks = {
  "session id embedded": html.includes(sessionId),
  "reducer embedded": html.includes("function applyAction"),
  "snapshot alias embedded": html.includes(projectAlias),
  "record count matched": replayStdout.includes(`${expectedRecords} records`),
  "no snapshot gaps": !replayStdout.includes("gap"),
};
console.log("replay HTML checks:");
for (const [name, passed] of Object.entries(checks)) {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`);
}
if (!Object.values(checks).every(Boolean)) die("one or more replay HTML checks failed");

console.log(`\nstudy-prod-smoke: PASS — full ingest -> R2 -> admin -> replay chain verified on ${endpoint} (deployment=${deployment}). Replay written to ${outPath} (mode 0600).`);

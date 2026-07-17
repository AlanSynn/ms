import type { AppStage, ProjectAction, ProjectState } from "../types";
import {
  makeStudySnapshotRecords,
  scrubStudyValue,
  STUDY_EVENT_SCHEMA,
  STUDY_SNAPSHOT_SCHEMA,
  studyProjectAction,
  studyProjectCounts,
} from "./studyTelemetryProject";

export type StudyProfile = "off" | "metrics" | "replay" | "study";
export type StudyLevel = Exclude<StudyProfile, "off">;

type StudyRecord = {
  seq: number;
  t: number;
  type: string;
  stage?: AppStage;
  project?: string;
  data?: unknown;
};

type BufferedRecord = StudyRecord & { coalesceKey?: string };
type OutboxItem = {
  id: string;
  created: number;
  scope: string;
  level: StudyLevel;
  path: "/batch" | "/asset";
  body: Blob;
  headers: Record<string, string>;
  bytes: number;
};

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const profileValue = env.VITE_STUDY_PROFILE;
export const STUDY_PROFILE: StudyProfile =
  profileValue === "metrics" || profileValue === "replay" || profileValue === "study"
    ? profileValue
    : "off";
export const STUDY_ENDPOINT = (env.VITE_STUDY_ENDPOINT || "/ms-study/v1").replace(/\/+$/, "");

const safeCode = (value: string | undefined, fallback = "none") =>
  value && /^[a-z0-9._-]{1,80}$/i.test(value) ? value : fallback;

const studyQuery = (() => {
  if (typeof location === "undefined") return new URLSearchParams();
  return new URLSearchParams(location.search);
})();
const queryCode = (key: string, fallback?: string) =>
  safeCode(studyQuery.get(key) || fallback);
const deployment = safeCode(env.VITE_STUDY_DEPLOYMENT, `v${appVersion}`);
const buildSha = safeCode(env.VITE_STUDY_BUILD_SHA, "local");
const classId = queryCode("msClass", env.VITE_STUDY_CLASS_ID);
const classSessionId = queryCode("msSession", env.VITE_STUDY_SESSION_ID);
const teamId = queryCode("msTeam", env.VITE_STUDY_TEAM_ID);
const assignedParticipantId = queryCode("msParticipant", env.VITE_STUDY_PARTICIPANT_ID);
const levelRank = { off: 0, metrics: 1, replay: 2, study: 3 } as const;
const isStudyLevel = (value: unknown): value is StudyLevel =>
  value === "metrics" || value === "replay" || value === "study";
export const studyProfileIncludes = (profile: StudyProfile, level: StudyLevel) =>
  levelRank[profile] >= levelRank[level];
const enabledHost = () => {
  if (typeof location === "undefined") return false;
  return location.hostname === "alansynn.com" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
};
export const studyTelemetryEnabled = () =>
  STUDY_PROFILE !== "off" && enabledHost();

const INSTALLATION_KEY = "motionsmith.study.installation.v1";
const PROJECTS_KEY = "motionsmith.study.projects.v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_OUTBOX_BYTES = 48 * 1024 * 1024;
const MAX_OUTBOX_ITEMS = 256;
// Scope by collector endpoint only. Deployment travels inside each batch/asset
// body (server partitions storage by the in-body deployment), so an app-version
// bump must never reclassify still-undelivered offline data as incompatible and
// drop it. Legacy items written as `${endpoint}|${deployment}` are still
// accepted via scopeMatches below so this change loses no queued data.
const outboxScope = STUDY_ENDPOINT;
const scopeMatches = (scope: string) => scope === outboxScope || scope.startsWith(`${outboxScope}|`);
const EXIT_CHECKPOINT_KEY = "motionsmith.study.exit.v1";

type InstallationState = {
  id: string;
  sessionId: string;
  sessionStartedAt: number;
  lastSeenAt: number;
  sessionCount: number;
  reconnectCount: number;
};

const randomUuid = () => {
  const availableCrypto = globalThis.crypto;
  if (availableCrypto?.randomUUID) return availableCrypto.randomUUID().toLowerCase();
  if (availableCrypto?.getRandomValues) {
    const bytes = availableCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return `${Date.now().toString(16).slice(-8).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`;
};
const uuid = (prefix: string) => `${prefix}_${randomUuid()}`;
const readJson = <T>(key: string): T | undefined => {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return undefined;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Telemetry storage never blocks product storage or interaction.
  }
};

let installation: InstallationState | undefined;
const ensureInstallation = () => {
  if (installation) return installation;
  const now = Date.now();
  const stored = readJson<InstallationState>(INSTALLATION_KEY);
  const valid = stored && /^ins_[0-9a-f-]{36}$/.test(stored.id) && /^ses_[0-9a-f-]{36}$/.test(stored.sessionId);
  const continueSession = Boolean(
    valid && now >= stored!.lastSeenAt && now - stored!.lastSeenAt < SESSION_IDLE_MS,
  );
  installation = {
    id: valid ? stored!.id : uuid("ins"),
    sessionId: continueSession ? stored!.sessionId : uuid("ses"),
    sessionStartedAt: continueSession ? stored!.sessionStartedAt : now,
    lastSeenAt: now,
    sessionCount: continueSession ? Math.max(1, stored!.sessionCount) : Math.max(0, stored?.sessionCount ?? 0) + 1,
    reconnectCount: Math.max(0, stored?.reconnectCount ?? 0) + 1,
  };
  writeJson(INSTALLATION_KEY, installation);
  return installation;
};

const participantId = () =>
  assignedParticipantId === "none" ? ensureInstallation().id : assignedParticipantId;

let contextId: string | undefined;
const currentContextId = () => contextId ??= uuid("ctx");
let sequence = 0;
let lastElapsed = 0;
let lastInstallationWrite = 0;
let currentStage: AppStage = "character";
let currentProject: string | undefined;
let currentStageStarted = 0;

const elapsedMs = () => {
  const state = ensureInstallation();
  lastElapsed = Math.max(lastElapsed, Math.max(0, Date.now() - state.sessionStartedAt));
  if (Date.now() - lastInstallationWrite > 10_000) {
    state.lastSeenAt = Date.now();
    lastInstallationWrite = Date.now();
    writeJson(INSTALLATION_KEY, state);
  }
  return Math.round(lastElapsed);
};

export const studyProjectAlias = (rawId: string) => {
  const projects = readJson<Record<string, string>>(PROJECTS_KEY) ?? {};
  if (projects[rawId]) return projects[rawId];
  const alias = uuid("prj");
  const entries = Object.entries({ ...projects, [rawId]: alias }).slice(-64);
  writeJson(PROJECTS_KEY, Object.fromEntries(entries));
  return alias;
};

let buffer: BufferedRecord[] = [];
const inFlightRecords = new Set<number>();
let flushTimer: number | undefined;
let flushDueAt = 0;
let flushRunning = false;

const scheduleFlush = (delay = 10_000) => {
  if (typeof window === "undefined") return;
  const dueAt = Date.now() + delay;
  if (flushTimer !== undefined && dueAt >= flushDueAt) return;
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    flushDueAt = 0;
    void flushStudyTelemetry("activity");
  }, delay);
};

export const recordStudyEvent = (
  type: string,
  data?: unknown,
  options: {
    level?: StudyLevel;
    immediate?: boolean;
    coalesceKey?: string;
  } = {},
) => {
  if (!studyTelemetryEnabled()) return;
  const level = options.level ?? "replay";
  if (levelRank[STUDY_PROFILE] < levelRank[level]) return;
  const record: BufferedRecord = {
    seq: ++sequence,
    t: elapsedMs(),
    type: safeCode(type, "unknown"),
    stage: currentStage,
    project: currentProject,
    data: scrubStudyValue(data),
    coalesceKey: options.coalesceKey,
  };
  if (options.coalesceKey) {
    let index = -1;
    for (let cursor = buffer.length - 1; cursor >= 0; cursor -= 1) {
      if (buffer[cursor].coalesceKey === options.coalesceKey) {
        index = cursor;
        break;
      }
    }
    if (index >= 0) buffer[index] = record;
    else buffer.push(record);
  } else {
    buffer.push(record);
  }
  if (buffer.length >= 50 || options.immediate) scheduleFlush(250 + Math.floor(Math.random() * 1_500));
  else scheduleFlush();
};

export const setStudyViewContext = (stage: AppStage, projectAlias?: string) => {
  currentStage = stage;
  currentProject = projectAlias;
};

export const recordStudyStage = (stage: AppStage) => {
  const now = elapsedMs();
  const from = currentStage;
  const dwellMs = Math.max(0, now - currentStageStarted);
  currentStage = stage;
  currentStageStarted = now;
  recordStudyEvent(
    "stage.view",
    { from, to: stage, dwellMs },
    { level: "metrics", immediate: true },
  );
};

export const recordStudyProjectAction = (
  action: ProjectAction,
  applied: boolean,
) =>
  recordStudyEvent(
    "project.action",
    { ...(studyProjectAction(action, currentProject) as Record<string, unknown>), applied },
    {
      level: "replay",
      // A rejected action (applied:false) must never replace a prior applied
      // action that shares its coalesce key — that would erase the real edit.
      coalesceKey: applied ? projectActionCoalesceKey(action) : undefined,
    },
  );

const projectActionCoalesceKey = (action: ProjectAction) => {
  if (action.type === "update_part") return `${action.type}:${action.partId}:${Object.keys(action.updates).sort().join(",")}`;
  if (action.type === "update_scene_object") return `${action.type}:${action.objectId}:${Object.keys(action.updates).sort().join(",")}`;
  if (action.type === "update_joint") return `${action.type}:${action.jointId}:${Object.keys(action.updates).sort().join(",")}`;
  if (action.type === "upsert_path") return `${action.type}:${action.path.id}`;
  if (action.type === "upsert_mechanism") return `${action.type}:${action.mechanism.id}`;
  if (action.type === "update_settings") return `${action.type}:${Object.keys(action.settings).sort().join(",")}`;
  if (action.type === "set_processing") return action.type;
  return undefined;
};

let forceNextSnapshot = false;
export const recordStudyProjectReplace = (options: { history?: boolean; resetHistory?: boolean }) => {
  forceNextSnapshot = true;
  recordStudyEvent("project.replace", options, { level: "replay" });
};

let pendingSnapshot: { project: ProjectState; alias: string; reason: string } | undefined;
let snapshotTimer: number | undefined;
let snapshotIdle: number | undefined;
let lastSnapshotAt = 0;

const commitPendingSnapshot = (emergency = false) => {
  if (!pendingSnapshot) return;
  if (snapshotTimer !== undefined || snapshotIdle !== undefined) clearSnapshotSchedule();
  const { project, alias, reason } = pendingSnapshot;
  pendingSnapshot = undefined;
  lastSnapshotAt = Date.now();
  makeStudySnapshotRecords(project, alias, reason, uuid("snp")).forEach((record) =>
    recordStudyEvent(record.type, record.data, { level: "replay" }),
  );
  void flushStudyTelemetry("snapshot", false, true, emergency);
};

export const commitPendingStudySnapshot = () => commitPendingSnapshot(true);

const clearSnapshotSchedule = () => {
  if (snapshotTimer !== undefined) window.clearTimeout(snapshotTimer);
  if (snapshotIdle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(snapshotIdle);
  snapshotTimer = undefined;
  snapshotIdle = undefined;
};

const scheduleSnapshotIdle = () => {
  if (typeof window.requestIdleCallback === "function") {
    snapshotIdle = window.requestIdleCallback(() => {
      snapshotIdle = undefined;
      commitPendingSnapshot();
    }, { timeout: 1_000 });
    return;
  }
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = undefined;
    commitPendingSnapshot();
  }, 0);
};

export const scheduleStudySnapshot = (
  project: ProjectState,
  alias: string,
  reason = "commit",
  immediate = false,
) => {
  if (levelRank[STUDY_PROFILE] < levelRank.replay || !studyTelemetryEnabled()) return;
  pendingSnapshot = { project, alias, reason };
  if (forceNextSnapshot) {
    forceNextSnapshot = false;
    clearSnapshotSchedule();
    commitPendingSnapshot(true);
    return;
  }
  if (immediate) {
    clearSnapshotSchedule();
    scheduleSnapshotIdle();
    return;
  }
  clearSnapshotSchedule();
  const continuousDelay = Math.max(0, 15_000 - (Date.now() - lastSnapshotAt));
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = undefined;
    scheduleSnapshotIdle();
  }, Math.max(1_200, continuousDelay));
};

let dbPromise: Promise<IDBDatabase> | undefined;
let outboxDb: IDBDatabase | undefined;
const openOutbox = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("motionsmith-study", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("outbox", { keyPath: "id" });
        store.createIndex("created", "created");
      };
      request.onsuccess = () => {
        outboxDb = request.result;
        outboxDb.onversionchange = () => {
          outboxDb?.close();
          outboxDb = undefined;
          dbPromise = undefined;
        };
        resolve(outboxDb);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const writeOutboxItems = (db: IDBDatabase, items: OutboxItem[]) => {
  try {
    const tx = db.transaction("outbox", "readwrite", { durability: "relaxed" });
    const store = tx.objectStore("outbox");
    items.forEach((item) => store.put(item));
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    return Promise.reject(error);
  }
};

const queueOutboxItems = (items: OutboxItem[]) => {
  if (!items.length) return Promise.resolve(true);
  const write = outboxDb
    ? writeOutboxItems(outboxDb, items)
    : openOutbox().then((db) => writeOutboxItems(db, items));
  return write.then(() => {
    void trimOutbox();
    return true;
  }).catch(() => {
    // IndexedDB failure drops research data, never product state.
    return false;
  });
};

const queueOutbox = (item: OutboxItem) => queueOutboxItems([item]);

const listOutbox = async () => {
  const db = await openOutbox();
  const tx = db.transaction("outbox", "readonly");
  const items = await requestResult(tx.objectStore("outbox").getAll()) as OutboxItem[];
  return items.sort((a, b) => a.created - b.created);
};

const deleteOutbox = async (ids: string[]) => {
  if (!ids.length) return;
  const db = await openOutbox();
  const tx = db.transaction("outbox", "readwrite", { durability: "relaxed" });
  ids.forEach((id) => tx.objectStore("outbox").delete(id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const trimOutbox = async () => {
  try {
    const items = await listOutbox();
    let bytes = items.reduce((total, item) => total + item.bytes, 0);
    const remove: string[] = [];
    const removalOrder = [
      ...items.filter((item) => item.path === "/asset"),
      ...items.filter((item) => item.path === "/batch"),
    ];
    while (items.length - remove.length > MAX_OUTBOX_ITEMS || bytes > MAX_OUTBOX_BYTES) {
      const item = removalOrder[remove.length];
      if (!item) break;
      remove.push(item.id);
      bytes -= item.bytes;
    }
    await deleteOutbox(remove);
  } catch {
    // Best-effort research queue bound.
  }
};

const gzip = async (json: string) => {
  if (typeof CompressionStream === "undefined" || json.length < 1_024) {
    return new Blob([json], { type: "application/json" });
  }
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()], { type: "application/gzip" });
};

const makeBatch = (beacon = false) => {
  const records: StudyRecord[] = [];
  const recordIds: number[] = [];
  let recordBytes = 0;
  if (beacon) {
    for (const buffered of buffer) {
      if (inFlightRecords.has(buffered.seq)) continue;
      const { coalesceKey: _key, ...candidate } = buffered;
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
      if (records.length < 200 && bytes <= 48 * 1024 && recordBytes + bytes <= 48 * 1024) {
        records.push(candidate);
        recordIds.push(candidate.seq);
        recordBytes += bytes;
      }
    }
  } else {
    for (const buffered of buffer) {
      if (inFlightRecords.has(buffered.seq)) continue;
      const { coalesceKey: _key, ...candidate } = buffered;
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
      if (records.length && recordBytes + bytes > 400 * 1024) break;
      recordIds.push(candidate.seq);
      if (bytes > 400 * 1024) {
        records.push({
          ...candidate,
          data: { omitted: "record_too_large", bytes },
        });
        break;
      }
      records.push(candidate);
      recordBytes += bytes;
      if (records.length >= 200) break;
    }
  }
  if (!records.length) return undefined;
  const state = ensureInstallation();
  const batchId = uuid("bat");
  const envelope = {
    v: 1,
    eventSchema: STUDY_EVENT_SCHEMA,
    snapshotSchema: STUDY_SNAPSHOT_SCHEMA,
    batchId,
    deployment,
    appVersion,
    buildSha,
    profile: STUDY_PROFILE,
    classId,
    classSessionId,
    teamId,
    participantId: participantId(),
    sessionId: state.sessionId,
    contextId: currentContextId(),
    sessionCount: state.sessionCount,
    reconnectCount: state.reconnectCount,
    records,
  };
  return { batchId, json: JSON.stringify(envelope), recordIds };
};

type StudyBatch = NonNullable<ReturnType<typeof makeBatch>>;
type ExitCheckpoint = {
  id: string;
  created: number;
  scope: string;
  level: StudyLevel;
  batches: Array<{ batchId: string; json: string }>;
};
const reserveBatch = (batch: StudyBatch) => batch.recordIds.forEach((id) => inFlightRecords.add(id));
const finishBatches = (batches: StudyBatch[], stored: boolean) => {
  const ids = new Set(batches.flatMap((batch) => batch.recordIds));
  if (stored) buffer = buffer.filter((record) => !ids.has(record.seq));
  ids.forEach((id) => inFlightRecords.delete(id));
};
const outboxBatch = (batch: StudyBatch, body: Blob): OutboxItem => ({
  id: `${outboxScope}:${batch.batchId}`,
  created: Date.now(),
  scope: outboxScope,
  level: STUDY_PROFILE as StudyLevel,
  path: "/batch",
  body,
  headers: body.type === "application/gzip"
    ? { "Content-Type": "application/json", "Content-Encoding": "gzip" }
    : { "Content-Type": "application/json" },
  bytes: body.size,
});

const clearExitCheckpoint = (id?: string) => {
  try {
    const current = readJson<ExitCheckpoint>(EXIT_CHECKPOINT_KEY);
    if (!id || current?.id === id) localStorage.removeItem(EXIT_CHECKPOINT_KEY);
  } catch {
    // Best-effort emergency cleanup.
  }
};

const saveExitCheckpoint = (batches: StudyBatch[]) => {
  const checkpoint: ExitCheckpoint = {
    id: uuid("chk"),
    created: Date.now(),
    scope: outboxScope,
    level: STUDY_PROFILE as StudyLevel,
    batches: batches.map(({ batchId, json }) => ({ batchId, json })),
  };
  try {
    localStorage.setItem(EXIT_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    return checkpoint.id;
  } catch {
    return undefined;
  }
};

const CHECKPOINT_BATCH_ID_RE = /^bat_[0-9a-f-]{36}$/;
/**
 * A checkpoint batch is recoverable as long as its body is intact and its capture
 * profile still fits the running profile. Deployment is intentionally NOT compared:
 * it travels inside the body and the server partitions storage by the in-body
 * deployment, so a release-tag bump (VITE_STUDY_DEPLOYMENT = git ref_name) must
 * never orphan a checkpoint written under the previous tag. This recovery path is
 * the only window where that loss is observable — a tab closed during a pagehide
 * whose outbox write failed, then the app auto-updates between sessions — which is
 * exactly when a deployment change is most likely.
 */
export const checkpointBatchIntact = (
  batch: { batchId: string; json: string },
  level: StudyLevel,
): boolean => {
  if (!CHECKPOINT_BATCH_ID_RE.test(batch.batchId) || typeof batch.json !== "string" || batch.json.length > 512 * 1024) return false;
  try {
    const envelope = JSON.parse(batch.json) as { batchId?: unknown; deployment?: unknown; profile?: unknown };
    return envelope.batchId === batch.batchId
      && typeof envelope.deployment === "string"
      && envelope.profile === level;
  } catch {
    return false;
  }
};

const readExitCheckpoint = () => {
  const checkpoint = readJson<ExitCheckpoint>(EXIT_CHECKPOINT_KEY);
  const valid = checkpoint
    && /^chk_[0-9a-f-]{36}$/.test(checkpoint.id)
    && scopeMatches(checkpoint.scope)
    && isStudyLevel(checkpoint.level)
    && levelRank[checkpoint.level] <= levelRank[STUDY_PROFILE]
    && Number.isSafeInteger(checkpoint.created)
    && Array.isArray(checkpoint.batches)
    && checkpoint.batches.length > 0
    && checkpoint.batches.length <= MAX_OUTBOX_ITEMS
    && checkpoint.batches.every((batch) => checkpointBatchIntact(batch, checkpoint.level));
  if (!valid) {
    if (checkpoint) clearExitCheckpoint();
    return undefined;
  }
  return checkpoint;
};

const recoverExitCheckpoint = async () => {
  const checkpoint = readExitCheckpoint();
  if (!checkpoint) return;
  const stored = await queueOutboxItems(checkpoint.batches.map((batch) => ({
    id: `${checkpoint.scope}:${batch.batchId}`,
    created: Date.now(),
    scope: checkpoint.scope,
    level: checkpoint.level,
    path: "/batch" as const,
    body: new Blob([batch.json], { type: "application/json" }),
    headers: { "Content-Type": "application/json" },
    bytes: new Blob([batch.json]).size,
  })));
  if (stored) clearExitCheckpoint(checkpoint.id);
};

let deliveryRetryTimer: number | undefined;
let deliveryRetryMs = 5_000;
const scheduleDeliveryRetry = (delay = deliveryRetryMs) => {
  if (deliveryRetryTimer !== undefined || typeof window === "undefined") return;
  deliveryRetryTimer = window.setTimeout(() => {
    deliveryRetryTimer = undefined;
    void flushOutbox();
  }, Math.min(5 * 60_000, Math.max(1_000, delay)));
  deliveryRetryMs = Math.min(5 * 60_000, Math.max(deliveryRetryMs * 2, delay));
};

const flushOutbox = async () => {
  if (flushRunning || !studyTelemetryEnabled() || navigator.onLine === false) return;
  flushRunning = true;
  let deliverySucceeded = true;
  let retryAfterMs = 0;
  try {
    const allItems = await listOutbox();
    const deliverable = (item: OutboxItem) =>
      scopeMatches(item.scope)
      && isStudyLevel(item.level)
      && levelRank[item.level] <= levelRank[STUDY_PROFILE];
    const incompatible = allItems.filter((item) => !deliverable(item));
    await deleteOutbox(incompatible.map((item) => item.id));
    const items = allItems.filter(deliverable).slice(0, 8);
    for (const item of items) {
      const body = item.path === "/batch" && item.body.type === "application/json"
        ? await gzip(await item.body.text())
        : item.body;
      const headers = body.type === "application/gzip"
        ? { "Content-Type": "application/json", "Content-Encoding": "gzip" }
        : item.headers;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(`${STUDY_ENDPOINT}${item.path}`, {
        method: "POST",
        headers,
        body,
        keepalive: body.size <= 60 * 1024,
        credentials: "omit",
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      if (!response.ok) {
        if ([400, 401, 403, 404, 405, 409, 413, 415, 422].includes(response.status)) {
          await deleteOutbox([item.id]);
          continue;
        }
        const retryAfter = Number(response.headers.get("Retry-After"));
        retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0;
        deliverySucceeded = false;
        break;
      }
      await deleteOutbox([item.id]);
      deliveryRetryMs = 5_000;
    }
  } catch {
    deliverySucceeded = false;
    // Offline/server failure remains queued and never reaches product UI.
  } finally {
    flushRunning = false;
    if (deliverySucceeded) {
      try {
        if ((await listOutbox()).length) window.setTimeout(() => void flushOutbox(), 1_000);
      } catch {
        // A later interaction retries unavailable storage.
      }
    } else {
      scheduleDeliveryRetry(retryAfterMs || deliveryRetryMs);
    }
  }
};

export const flushStudyTelemetry = async (
  reason = "manual",
  beacon = false,
  durableOnly = false,
  checkpoint = false,
) => {
  if (!studyTelemetryEnabled()) return;
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  flushDueAt = 0;
  const first = makeBatch(beacon);
  if (!first) {
    if (!beacon) await flushOutbox();
    return;
  }
  const batches = [first];
  reserveBatch(first);
  try {
    if (beacon || durableOnly) {
      let remaining = makeBatch();
      while (remaining) {
        reserveBatch(remaining);
        batches.push(remaining);
        remaining = makeBatch();
      }
    }
    if (beacon && first.json.length <= 60 * 1024) {
      const exitBody = new Blob([first.json], { type: "application/json" });
      const sent = navigator.sendBeacon?.(`${STUDY_ENDPOINT}/batch`, exitBody) ?? false;
      if (!sent) {
        void fetch(`${STUDY_ENDPOINT}/batch`, {
          method: "POST",
          body: exitBody,
          keepalive: true,
          credentials: "omit",
        }).catch(() => undefined);
      }
    }
    const bodies = beacon || durableOnly
      ? batches.map((batch) => new Blob([batch.json], { type: "application/json" }))
      : await Promise.all(batches.map((batch) => gzip(batch.json)));
    const checkpointId = checkpoint ? saveExitCheckpoint(batches) : undefined;
    const stored = await queueOutboxItems(batches.map((batch, index) => outboxBatch(batch, bodies[index])));
    finishBatches(batches, stored);
    if (stored && checkpointId) clearExitCheckpoint(checkpointId);
    if (stored && !beacon && !durableOnly) await flushOutbox();
    const hasBufferLeft = buffer.some((record) => !inFlightRecords.has(record.seq));
    if (hasBufferLeft) {
      scheduleFlush(stored ? 0 : 1_000);
    } else if (stored && durableOnly && !beacon) {
      // durableOnly stored records to the outbox without posting (large snapshot
      // commits, visibility/page transitions). This branch also cleared the pending
      // activity timer above, and finishBatches already emptied the buffer, so
      // without a follow-up drain the stored items would sit undelivered until some
      // unrelated event happens to flush — which may be never this session. Arm a
      // coalesced drain so delivery is guaranteed, not best-effort.
      scheduleFlush(1_000);
    }
  } catch {
    // Compression/storage failure must never strand reserved seqs in-flight nor
    // surface to the product UI. Release the reservations and re-arm a coalesced
    // retry so a transient throw self-heals instead of leaving buffered records
    // un-armed until the next unrelated event.
    finishBatches(batches, false);
    scheduleFlush(1_000);
  }
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const imageBlob = async (dataUrl: string) => {
  const source = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(source);
  let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  let output = source;
  let width = 0;
  let height = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    width = Math.max(1, Math.round(bitmap.width * scale));
    height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: true })?.drawImage(bitmap, 0, 0, width, height);
    output = await new Promise<Blob>((resolve) =>
      canvas.toBlob(
        (blob) => resolve(blob ?? source),
        "image/webp",
        0.68,
      ),
    );
    if (output.size <= 192 * 1024) break;
    scale *= 0.72;
  }
  bitmap.close();
  if (output.size > 192 * 1024 || !["image/webp", "image/png"].includes(output.type)) {
    throw new Error("asset_too_large");
  }
  return { blob: output, width, height };
};

const assetIdFor = async (blob: Blob, kind: string) => {
  const state = ensureInstallation();
  const salt = new TextEncoder().encode(`${state.id}:${kind}`);
  const body = new Uint8Array(await blob.arrayBuffer());
  const combined = new Uint8Array(salt.length + body.length);
  combined.set(salt);
  combined.set(body, salt.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
  return `ast_${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const queuedSources = new Set<string>();
const imageQueue: Array<{ dataUrl: string; kind: string; project: string }> = [];
let imageQueueRunning = false;

const runImageQueue = async () => {
  if (imageQueueRunning || !imageQueue.length) return;
  imageQueueRunning = true;
  try {
    while (imageQueue.length) {
      const item = imageQueue.shift()!;
      try {
        const normalized = await imageBlob(item.dataUrl);
        const assetId = await assetIdFor(normalized.blob, item.kind);
        const state = ensureInstallation();
        const metadata = {
          v: 1,
          deployment,
          participantId: participantId(),
          sessionId: state.sessionId,
          contextId: currentContextId(),
          projectId: item.project,
          assetId,
          kind: item.kind,
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.blob.size,
        };
        const header = base64Url(new TextEncoder().encode(JSON.stringify(metadata)));
        await queueOutbox({
          id: `${outboxScope}:${state.sessionId}:${item.project}:${assetId}`,
          created: Date.now(),
          scope: outboxScope,
          level: "study",
          path: "/asset",
          body: normalized.blob,
          headers: {
            "Content-Type": normalized.blob.type || "image/png",
            "X-MotionSmith-Meta": header,
          },
          bytes: normalized.blob.size,
        });
        recordStudyEvent("asset.imported", metadata, { level: "study" });
        await flushOutbox();
        await new Promise((resolve) => window.setTimeout(resolve, 500 + Math.floor(Math.random() * 750)));
      } catch {
        recordStudyEvent("asset.omitted", { kind: item.kind, reason: "normalize_failed" }, { level: "study" });
      }
    }
  } finally {
    imageQueueRunning = false;
  }
};

export const queueStudySourceImages = (project: ProjectState, projectAlias: string) => {
  if (STUDY_PROFILE !== "study" || !studyTelemetryEnabled()) return;
  const sources: Array<[string | undefined, string]> = [
    [project.characterPackage?.sourceTextureUrl, "character"],
    ...project.sceneObjectOrder.map((id) => [project.sceneObjects[id]?.textureUrl, "object"] as [string | undefined, string]),
  ];
  if (!project.characterPackage?.sourceTextureUrl) {
    sources.push(...project.partOrder.map((id) => [project.parts[id]?.textureUrl, "character_part"] as [string | undefined, string]));
  }
  let queued = false;
  sources.forEach(([dataUrl, kind]) => {
    if (!dataUrl?.startsWith("data:image/")) return;
    let hash = 0x811c9dc5;
    const stride = Math.max(1, Math.floor(dataUrl.length / 1024));
    for (let index = 0; index < dataUrl.length; index += stride) {
      hash = Math.imul(hash ^ dataUrl.charCodeAt(index), 0x01000193);
    }
    const sourceKey = `${kind}:${dataUrl.length}:${(hash >>> 0).toString(16)}`;
    if (queuedSources.has(sourceKey)) return;
    queuedSources.add(sourceKey);
    if (queuedSources.size > 256) queuedSources.delete(queuedSources.values().next().value!);
    imageQueue.push({ dataUrl, kind, project: projectAlias });
    queued = true;
  });
  if (queued) window.setTimeout(() => void runImageQueue(), 1_000);
};

export const studyTechnicalContext = () => {
  const ua = navigator.userAgent;
  const browser = /Edg\/(\d+)/.exec(ua)?.[1]
    ? ["edge", /Edg\/(\d+)/.exec(ua)![1]]
    : /Chrome\/(\d+)/.exec(ua)?.[1]
      ? ["chrome", /Chrome\/(\d+)/.exec(ua)![1]]
      : /Firefox\/(\d+)/.exec(ua)?.[1]
        ? ["firefox", /Firefox\/(\d+)/.exec(ua)![1]]
        : /Version\/(\d+).*Safari/.exec(ua)?.[1]
          ? ["safari", /Version\/(\d+).*Safari/.exec(ua)![1]]
          : ["other", "0"];
  const os = /CrOS/.test(ua) ? "chromeos" : /Windows/.test(ua) ? "windows" : /Mac OS/.test(ua) ? "macos" : /Android/.test(ua) ? "android" : /iPhone|iPad/.test(ua) ? "ios" : /Linux/.test(ua) ? "linux" : "other";
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    browser: browser[0],
    browserMajor: Number(browser[1]) || 0,
    os,
    viewport: [Math.round(innerWidth / 32) * 32, Math.round(innerHeight / 32) * 32],
    screen: [Math.round(screen.width / 64) * 64, Math.round(screen.height / 64) * 64],
    dpr: Math.round(devicePixelRatio * 4) / 4,
    pointer: matchMedia("(pointer: coarse)").matches ? "coarse" : "fine",
    network: connection?.effectiveType && /^[234]g|slow-2g$/.test(connection.effectiveType) ? connection.effectiveType : "unknown",
    saveData: Boolean(connection?.saveData),
    loadMs: navigation ? Math.round(navigation.duration / 100) * 100 : 0,
    memoryGb: deviceMemory ? Math.min(8, deviceMemory) : 0,
  };
};

let sessionStartRecorded = false;
export const recordStudySessionStart = (project: ProjectState, projectAlias: string) => {
  if (sessionStartRecorded || !studyTelemetryEnabled()) return;
  sessionStartRecorded = true;
  void openOutbox()
    .then(recoverExitCheckpoint)
    .then(() => flushOutbox())
    .catch(() => undefined);
  setStudyViewContext(currentStage, projectAlias);
  const state = ensureInstallation();
  recordStudyEvent(
    "session.start",
    {
      participantId: participantId(),
      classId,
      classSessionId,
      teamId,
      sessionCount: state.sessionCount,
      reconnectCount: state.reconnectCount,
      technical: studyTechnicalContext(),
      project: studyProjectCounts(project),
    },
    { level: "metrics", immediate: true },
  );
};

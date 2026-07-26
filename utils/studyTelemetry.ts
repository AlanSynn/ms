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

type DeliveryClass = "core-action" | "technical" | "snapshot" | "asset";
type OutboxState = "queued" | "quarantined";

type BufferedRecord = StudyRecord & {
  coalesceKey?: string;
  deliveryClass: DeliveryClass;
};
type OutboxItem = {
  id: string;
  created: number;
  scope: string;
  level: StudyLevel;
  path: "/batch" | "/asset";
  body: Blob;
  headers: Record<string, string>;
  bytes: number;
  deliveryClass?: DeliveryClass;
  state?: OutboxState;
  snapshotKey?: string;
  snapshotSeries?: string;
  failureStatus?: number;
  quarantinedAt?: number;
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
export type StudyTelemetryStatus = "off" | "host_disabled" | "enabled";
let hostPolicyNoticeEmitted = false;
export const studyTelemetryStatus = (): StudyTelemetryStatus => {
  if (STUDY_PROFILE === "off") return "off";
  return enabledHost() ? "enabled" : "host_disabled";
};
export const studyTelemetryEnabled = () => {
  const status = studyTelemetryStatus();
  if (status === "host_disabled" && !hostPolicyNoticeEmitted) {
    hostPolicyNoticeEmitted = true;
    console.info("MotionSmith study telemetry disabled: hostname policy");
  }
  return status === "enabled";
};

const INSTALLATION_KEY = "motionsmith.study.installation.v1";
const PROJECTS_KEY = "motionsmith.study.projects.v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_OUTBOX_BYTES = 48 * 1024 * 1024;
const MAX_OUTBOX_ITEMS = 256;
const MAX_EXIT_CHECKPOINT_CHARS = 2_000_000;
const MAX_BUFFERED_RECORDS = 400;
const DELIVERY_ORDER: DeliveryClass[] = [
  "core-action",
  "technical",
  "snapshot",
  "asset",
];
const deliveryRank = (deliveryClass: DeliveryClass) =>
  DELIVERY_ORDER.indexOf(deliveryClass);
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
export type TransportMode = "normal" | "constrained" | "offline-recovery";
type TransportPolicy = {
  flushIntervalMs: number;
  batchBytes: number;
  batchRecords: number;
  outboxItemsPerDrain: number;
  drainDelayMs: [number, number];
  retryFloorMs: number;
  collapseSnapshots: boolean;
};
const connectionIsConstrained = () => {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  return Boolean(
    connection?.saveData
      || connection?.effectiveType === "slow-2g"
      || connection?.effectiveType === "2g"
      || connection?.effectiveType === "3g",
  );
};
const TRANSPORT_POLICIES: Record<TransportMode, TransportPolicy> = {
  normal: {
    flushIntervalMs: 10_000,
    batchBytes: 256 * 1024,
    batchRecords: 160,
    outboxItemsPerDrain: 8,
    drainDelayMs: [750, 1_500],
    retryFloorMs: 5_000,
    collapseSnapshots: false,
  },
  constrained: {
    flushIntervalMs: 30_000,
    batchBytes: 400 * 1024,
    batchRecords: 200,
    outboxItemsPerDrain: 4,
    drainDelayMs: [4_000, 7_000],
    retryFloorMs: 15_000,
    collapseSnapshots: true,
  },
  "offline-recovery": {
    flushIntervalMs: 20_000,
    batchBytes: 320 * 1024,
    batchRecords: 180,
    outboxItemsPerDrain: 2,
    drainDelayMs: [2_000, 8_000],
    retryFloorMs: 10_000,
    collapseSnapshots: true,
  },
};
const MAX_OUTBOX_ITEM_BYTES = Math.max(
  ...Object.values(TRANSPORT_POLICIES).map((policy) => policy.batchBytes),
);
export const studyTransportPolicyFor = (mode: TransportMode) => ({
  ...TRANSPORT_POLICIES[mode],
  drainDelayMs: [...TRANSPORT_POLICIES[mode].drainDelayMs] as [number, number],
});
const activeTransportMode = () =>
  connectionIsConstrained() ? "constrained" : transportMode;
const transportPolicy = () => TRANSPORT_POLICIES[activeTransportMode()];
const randomBetween = ([min, max]: [number, number]) =>
  min + Math.floor(Math.random() * Math.max(1, max - min + 1));
let transportMode: TransportMode = "normal";
let consecutiveDeliveryFailures = 0;
let consecutiveSlowDeliveries = 0;
let consecutiveDeliverySuccesses = 0;
let sawOffline = false;
let lastSnapshotPreparationMs = 0;
let maxSnapshotPreparationMs = 0;
let snapshotPreparationFailures = 0;
const telemetryLosses: Record<DeliveryClass, number> = {
  "core-action": 0,
  technical: 0,
  snapshot: 0,
  asset: 0,
};
let reportingLoss = false;

const deliveryClassFor = (type: string): DeliveryClass => {
  if (type.startsWith("project.snapshot")) return "snapshot";
  if (type.startsWith("asset.")) return "asset";
  if (
    type.startsWith("project.")
    || type.startsWith("stage.")
    || type.startsWith("ui.")
    || type.startsWith("simulation.")
    || type.startsWith("recommendation.")
    || type.startsWith("export.")
  ) {
    return "core-action";
  }
  return "technical";
};

export const studyTelemetryDiagnostics = () => ({
  bufferedRecords: buffer.length,
  losses: { ...telemetryLosses },
  transportMode: activeTransportMode(),
  snapshotPreparation: {
    lastMs: lastSnapshotPreparationMs,
    maxMs: maxSnapshotPreparationMs,
    failures: snapshotPreparationFailures,
  },
});

const reportTelemetryLosses = (
  deliveryClass: DeliveryClass,
  removed = 1,
) => {
  if (removed <= 0) return;
  telemetryLosses[deliveryClass] += removed;
  // The exported counter is always observable. Avoid adding another record while
  // the failed queue is full, because that would defeat the memory bound.
  if (reportingLoss || buffer.length >= MAX_BUFFERED_RECORDS) return;
  reportingLoss = true;
  recordStudyEvent(
    "technical.loss",
    { deliveryClass, count: telemetryLosses[deliveryClass] },
    { level: "metrics", immediate: true },
  );
  reportingLoss = false;
};
const reportTelemetryLoss = (deliveryClass: DeliveryClass) =>
  reportTelemetryLosses(deliveryClass);

const discardBufferedLowPriority = () => {
  while (buffer.length > MAX_BUFFERED_RECORDS) {
    let candidate = -1;
    let candidateRank = -1;
    for (let index = 0; index < buffer.length; index += 1) {
      const record = buffer[index];
      if (inFlightRecords.has(record.seq)) continue;
      const rank = deliveryRank(record.deliveryClass);
      if (rank > candidateRank) {
        candidate = index;
        candidateRank = rank;
      }
    }
    // Keep core behavioral actions in memory as long as possible. A sustained
    // total storage failure may still require a hard bound at twice the cap.
    if (candidate < 0 || (buffer[candidate].deliveryClass === "core-action" && buffer.length <= MAX_BUFFERED_RECORDS * 2)) break;
    const [dropped] = buffer.splice(candidate, 1);
    reportTelemetryLoss(dropped.deliveryClass);
  }
};

const spillBuffer = () => {
  void flushStudyTelemetry("buffer-pressure", false, true).then((stored) => {
    if (!stored) discardBufferedLowPriority();
  });
};

const scheduleFlush = (
  delay = transportPolicy().flushIntervalMs,
  durableOnly = false,
) => {
  if (typeof window === "undefined") return;
  const dueAt = Date.now() + delay;
  if (flushTimer !== undefined && dueAt >= flushDueAt) return;
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    flushDueAt = 0;
    void flushStudyTelemetry(
      durableOnly ? "snapshot-continue" : "activity",
      false,
      durableOnly,
    );
  }, delay);
};

export const recordStudyEvent = (
  type: string,
  data?: unknown,
  options: {
    level?: StudyLevel;
    immediate?: boolean;
    coalesceKey?: string;
    prescrubbed?: boolean;
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
    data: options.prescrubbed ? data : scrubStudyValue(data),
    coalesceKey: options.coalesceKey,
    deliveryClass: deliveryClassFor(type),
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
  if (buffer.length >= MAX_BUFFERED_RECORDS) spillBuffer();
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
export const recordStudyProjectReplace = (
  options: { history?: boolean; resetHistory?: boolean },
  project?: ProjectState,
) => {
  forceNextSnapshot = true;
  const alias = project ? studyProjectAlias(project.metadata.id) : undefined;
  if (alias) setStudyViewContext(currentStage, alias);
  recordStudyEvent("project.replace", options, { level: "replay" });
  if (project && alias) {
    scheduleStudySnapshot(
      project,
      alias,
      "replace",
      true,
    );
  }
};

let pendingSnapshot: {
  project: ProjectState;
  alias: string;
  reason: string;
  generation: number;
  immediate: boolean;
} | undefined;
let preparedSnapshot: {
  records: Array<{ type: string; data: unknown }>;
  contentHash: string;
  generation: number;
} | undefined;
let snapshotTimer: number | undefined;
let snapshotIdle: number | undefined;
let snapshotCommitTimer: number | undefined;
let snapshotWorker: Worker | undefined;
let lastSnapshotAt = 0;
let snapshotGeneration = 0;
let lastSnapshotContentHash = "";
let snapshotExitPending = false;
const measureSnapshotMain = (
  phase: "handoff" | "commit" | "exit",
  startedAt: number,
) => {
  const name = `motionsmith.study.snapshot.${phase}`;
  try {
    performance.clearMeasures(name);
    performance.measure(name, { start: startedAt, end: performance.now() });
  } catch {
    // Performance diagnostics never affect snapshot durability.
  }
};

const discardPreparedSnapshot = () => {
  preparedSnapshot = undefined;
  if (snapshotCommitTimer !== undefined) {
    window.clearTimeout(snapshotCommitTimer);
    snapshotCommitTimer = undefined;
  }
};

const commitPreparedSnapshot = (emergency = false) => {
  const prepared = preparedSnapshot;
  if (!prepared || prepared.generation !== snapshotGeneration) return false;
  discardPreparedSnapshot();
  if (prepared.contentHash === lastSnapshotContentHash) return false;
  lastSnapshotAt = Date.now();
  lastSnapshotContentHash = prepared.contentHash;
  prepared.records.forEach((record) =>
    recordStudyEvent(record.type, record.data, {
      level: "replay",
      prescrubbed: true,
    }),
  );
  void flushStudyTelemetry("snapshot", false, true, emergency);
  return true;
};

const stopSnapshotWorker = () => {
  snapshotWorker?.terminate();
  snapshotWorker = undefined;
};

const clearSnapshotSchedule = () => {
  if (snapshotTimer !== undefined) window.clearTimeout(snapshotTimer);
  if (snapshotIdle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(snapshotIdle);
  snapshotTimer = undefined;
  snapshotIdle = undefined;
};

const startSnapshotPreparation = (generation: number) => {
  const request = pendingSnapshot;
  if (!request || request.generation !== generation) return;
  if (typeof Worker === "undefined") {
    pendingSnapshot = undefined;
    snapshotPreparationFailures += 1;
    reportTelemetryLoss("snapshot");
    return;
  }
  stopSnapshotWorker();
  const worker = new Worker(
    new URL("./studySnapshotWorker.ts", import.meta.url),
    { type: "module" },
  );
  snapshotWorker = worker;
  worker.onmessage = (event: MessageEvent<{
    generation: number;
    contentHash?: string;
    records?: Array<{ type: string; data: unknown }>;
    durationMs?: number;
    error?: string;
  }>) => {
    const startedAt = performance.now();
    try {
      if (snapshotWorker === worker) snapshotWorker = undefined;
      worker.terminate();
      if (
        event.data.generation !== snapshotGeneration
        || event.data.generation !== request.generation
      ) return;
      pendingSnapshot = undefined;
      if (
        event.data.error
        || !event.data.contentHash
        || !Array.isArray(event.data.records)
      ) {
        snapshotPreparationFailures += 1;
        reportTelemetryLoss("snapshot");
        return;
      }
      lastSnapshotPreparationMs = Math.max(0, event.data.durationMs ?? 0);
      maxSnapshotPreparationMs = Math.max(
        maxSnapshotPreparationMs,
        lastSnapshotPreparationMs,
      );
      preparedSnapshot = {
        records: event.data.records,
        contentHash: event.data.contentHash,
        generation: event.data.generation,
      };
      if (
        request.immediate
        || snapshotExitPending
        || Date.now() - lastSnapshotAt >= 15_000
      ) {
        commitPreparedSnapshot(snapshotExitPending);
        snapshotExitPending = false;
        return;
      }
      if (snapshotCommitTimer === undefined) {
        snapshotCommitTimer = window.setTimeout(() => {
          snapshotCommitTimer = undefined;
          commitPreparedSnapshot();
        }, Math.max(0, 15_000 - (Date.now() - lastSnapshotAt)));
      }
    } finally {
      measureSnapshotMain("commit", startedAt);
    }
  };
  worker.onerror = () => {
    if (snapshotWorker === worker) snapshotWorker = undefined;
    worker.terminate();
    if (request.generation !== snapshotGeneration) return;
    pendingSnapshot = undefined;
    snapshotPreparationFailures += 1;
    reportTelemetryLoss("snapshot");
  };
  try {
    const startedAt = performance.now();
    worker.postMessage({
      generation,
      project: request.project,
      alias: request.alias,
      reason: request.reason,
      snapshotId: uuid("snp"),
    });
    measureSnapshotMain("handoff", startedAt);
  } catch {
    worker.onerror?.(new ErrorEvent("error"));
  }
};

const scheduleSnapshotPreparation = (
  generation: number,
  delay: number,
) => {
  clearSnapshotSchedule();
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = undefined;
    if (delay === 0) {
      if (generation === snapshotGeneration) startSnapshotPreparation(generation);
      return;
    }
    const start = () => {
      snapshotIdle = undefined;
      if (generation === snapshotGeneration) startSnapshotPreparation(generation);
    };
    if (typeof window.requestIdleCallback === "function") {
      snapshotIdle = window.requestIdleCallback(start, { timeout: 1_000 });
    } else {
      start();
    }
  }, delay);
};

export const commitPendingStudySnapshot = () => {
  const request = pendingSnapshot;
  if (request?.immediate) {
    const startedAt = performance.now();
    clearSnapshotSchedule();
    stopSnapshotWorker();
    discardPreparedSnapshot();
    pendingSnapshot = undefined;
    snapshotExitPending = false;
    try {
      const records = makeStudySnapshotRecords(
        request.project,
        request.alias,
        request.reason,
        uuid("snp"),
      );
      lastSnapshotAt = Date.now();
      records.forEach((record) =>
        recordStudyEvent(record.type, record.data, {
          level: "replay",
          prescrubbed: true,
        }),
      );
      measureSnapshotMain("exit", startedAt);
      void flushStudyTelemetry("snapshot-exit", false, true, true);
      return;
    } catch {
      snapshotPreparationFailures += 1;
      reportTelemetryLoss("snapshot");
    }
  }
  snapshotExitPending = Boolean(pendingSnapshot || snapshotWorker);
  commitPreparedSnapshot(true);
  if (pendingSnapshot && !snapshotWorker) {
    clearSnapshotSchedule();
    startSnapshotPreparation(pendingSnapshot.generation);
  }
};

export const scheduleStudySnapshot = (
  project: ProjectState,
  alias: string,
  reason = "commit",
  immediate = false,
) => {
  if (levelRank[STUDY_PROFILE] < levelRank.replay || !studyTelemetryEnabled()) return;
  const force = forceNextSnapshot;
  if (pendingSnapshot?.immediate && !immediate && !force) return;
  if (pendingSnapshot?.project === project) return;
  if (document.hidden && !immediate && !force) return;
  const generation = ++snapshotGeneration;
  discardPreparedSnapshot();
  forceNextSnapshot = false;
  pendingSnapshot = {
    project,
    alias,
    reason,
    generation,
    immediate: immediate || force,
  };
  stopSnapshotWorker();
  scheduleSnapshotPreparation(generation, immediate || force ? 0 : 400);
};

let dbPromise: Promise<IDBDatabase> | undefined;
let outboxDb: IDBDatabase | undefined;
const openOutbox = () => {
  if (!dbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
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
    dbPromise = opening;
    // Storage may recover after a temporary quota or browser failure. Do not
    // leave telemetry permanently bound to one rejected promise.
    void opening.catch(() => {
      if (dbPromise === opening) dbPromise = undefined;
    });
  }
  return dbPromise;
};

const writeOutboxItems = (
  db: IDBDatabase,
  items: OutboxItem[],
  collapseSnapshots: boolean,
) => {
  try {
    const tx = db.transaction("outbox", "readwrite", { durability: "relaxed" });
    const store = tx.objectStore("outbox");
    items.forEach((item) => store.put(item));
    let supersededSnapshots = 0;
    const newIds = new Set(items.map((item) => item.id));
    const newSeries = new Set(
      items
        .map((item) => item.snapshotSeries)
        .filter((series): series is string => Boolean(series)),
    );
    const newSnapshotKeys = new Set(
      items
        .map((item) => item.snapshotKey)
        .filter((key): key is string => Boolean(key)),
    );
    if (collapseSnapshots && newSeries.size) {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const item = entry.value as OutboxItem;
        if (
          !newIds.has(item.id)
          && item.state !== "quarantined"
          && item.deliveryClass === "snapshot"
          && item.snapshotSeries
          && newSeries.has(item.snapshotSeries)
          && (!item.snapshotKey || !newSnapshotKeys.has(item.snapshotKey))
        ) {
          entry.delete();
          supersededSnapshots += 1;
        }
        entry.continue();
      };
    }
    return new Promise<number>((resolve, reject) => {
      tx.oncomplete = () => resolve(supersededSnapshots);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    return Promise.reject(error);
  }
};

const queueOutboxItems = (
  items: OutboxItem[],
  collapseSnapshots = transportPolicy().collapseSnapshots,
) => {
  if (!items.length) return Promise.resolve(true);
  const write = outboxDb
    ? writeOutboxItems(outboxDb, items, collapseSnapshots)
    : openOutbox().then((db) =>
        writeOutboxItems(db, items, collapseSnapshots));
  return write.then((supersededSnapshots) => {
    reportTelemetryLosses("snapshot", supersededSnapshots);
    void trimOutbox();
    return true;
  }).catch(() => {
    // IndexedDB failure drops research data, never product state.
    return false;
  });
};

const queueOutbox = (item: OutboxItem) => queueOutboxItems([item]);

const outboxDeliveryClass = (item: OutboxItem): DeliveryClass =>
  item.deliveryClass ?? (item.path === "/asset" ? "asset" : "technical");

const outboxState = (item: OutboxItem): OutboxState => item.state ?? "queued";

const visitOutbox = async (visit: (item: OutboxItem) => void) => {
  const db = await openOutbox();
  const tx = db.transaction("outbox", "readonly");
  const request = tx.objectStore("outbox").index("created").openCursor();
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      visit(cursor.value as OutboxItem);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
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

const quarantineOutbox = async (item: OutboxItem, status: number) => {
  const db = await openOutbox();
  const tx = db.transaction("outbox", "readwrite", { durability: "relaxed" });
  tx.objectStore("outbox").put({
    ...item,
    body: new Blob(),
    headers: {},
    bytes: 0,
    state: "quarantined",
    failureStatus: status,
    quarantinedAt: Date.now(),
  } satisfies OutboxItem);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const trimOutbox = async () => {
  try {
    const db = await openOutbox();
    const countRequest = db.transaction("outbox", "readonly")
      .objectStore("outbox")
      .count();
    const itemCount = await new Promise<number>((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
    if (
      itemCount <= MAX_OUTBOX_ITEMS
      && itemCount <= Math.floor(MAX_OUTBOX_BYTES / MAX_OUTBOX_ITEM_BYTES)
    ) return;
    let scannedItems = 0;
    let bytes = 0;
    type TrimCandidate = {
      id: string;
      bytes: number;
      deliveryClass: DeliveryClass;
      created: number;
      priority: number;
    };
    const standalone: TrimCandidate[] = [];
    const snapshotGroups = new Map<string, TrimCandidate[]>();
    await visitOutbox((item) => {
      scannedItems += 1;
      bytes += item.bytes;
      const deliveryClass = outboxDeliveryClass(item);
      const candidate = {
        id: item.id,
        bytes: item.bytes,
        deliveryClass,
        created: item.created,
        priority: outboxState(item) === "quarantined" ? 5 : deliveryRank(deliveryClass),
      };
      if (deliveryClass === "snapshot" && item.snapshotKey) {
        const group = snapshotGroups.get(item.snapshotKey) ?? [];
        group.push(candidate);
        snapshotGroups.set(item.snapshotKey, group);
        return;
      }
      standalone.push(candidate);
    });
    // A chunked snapshot is useful only as a complete generation. Treat its
    // Outbox batches as one trim unit so pressure never leaves orphan chunks.
    const removalOrder = [
      ...standalone.map((candidate) => [candidate]),
      ...snapshotGroups.values(),
    ].sort((a, b) => {
      const priorityA = Math.max(...a.map((candidate) => candidate.priority));
      const priorityB = Math.max(...b.map((candidate) => candidate.priority));
      const createdA = Math.min(...a.map((candidate) => candidate.created));
      const createdB = Math.min(...b.map((candidate) => candidate.created));
      return priorityB - priorityA || createdA - createdB;
    });
    const remove = new Map<string, TrimCandidate>();
    for (const group of removalOrder) {
      if (scannedItems <= MAX_OUTBOX_ITEMS && bytes <= MAX_OUTBOX_BYTES) break;
      for (const candidate of group) {
        remove.set(candidate.id, candidate);
        scannedItems -= 1;
        bytes -= candidate.bytes;
      }
    }
    const removed = [...remove.values()];
    await deleteOutbox(removed.map((candidate) => candidate.id));
    removed.forEach((candidate) => reportTelemetryLoss(candidate.deliveryClass));
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

const snapshotIdFrom = (records: StudyRecord[]) => {
  for (const record of records) {
    const data = record.data;
    if (!data || typeof data !== "object") continue;
    const snapshotId = (data as { snapshotId?: unknown }).snapshotId;
    if (typeof snapshotId === "string" && snapshotId) return snapshotId;
  }
  return undefined;
};

const makeBatch = (beacon: boolean, deliveryClass: DeliveryClass) => {
  const records: StudyRecord[] = [];
  const recordIds: number[] = [];
  let recordBytes = 0;
  const policy = transportPolicy();
  const batchBytes = beacon ? 48 * 1024 : policy.batchBytes - 16 * 1024;
  const batchRecords = beacon ? 200 : policy.batchRecords;
  if (beacon) {
    for (const buffered of buffer) {
      if (inFlightRecords.has(buffered.seq) || buffered.deliveryClass !== deliveryClass) continue;
      const { coalesceKey: _key, deliveryClass: _deliveryClass, ...candidate } = buffered;
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
      if (records.length < batchRecords && bytes <= batchBytes && recordBytes + bytes <= batchBytes) {
        records.push(candidate);
        recordIds.push(candidate.seq);
        recordBytes += bytes;
      }
    }
  } else {
    for (const buffered of buffer) {
      if (inFlightRecords.has(buffered.seq) || buffered.deliveryClass !== deliveryClass) continue;
      const { coalesceKey: _key, deliveryClass: _deliveryClass, ...candidate } = buffered;
      const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
      if (records.length && recordBytes + bytes > batchBytes) break;
      recordIds.push(candidate.seq);
      if (bytes > batchBytes) {
        records.push({
          ...candidate,
          data: { omitted: "record_too_large", bytes },
        });
        break;
      }
      records.push(candidate);
      recordBytes += bytes;
      if (records.length >= batchRecords) break;
    }
  }
  if (!records.length) return undefined;
  const state = ensureInstallation();
  const batchId = uuid("bat");
  const snapshotId = deliveryClass === "snapshot" ? snapshotIdFrom(records) : undefined;
  const snapshotSeries = deliveryClass === "snapshot"
    ? `${participantId()}:${state.sessionId}:${currentContextId()}:${records[0]?.project ?? "none"}`
    : undefined;
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
  return {
    batchId,
    json: JSON.stringify(envelope),
    recordIds,
    deliveryClass,
    snapshotSeries,
    snapshotKey: snapshotSeries && snapshotId
      ? `${snapshotSeries}:${snapshotId}`
      : undefined,
  };
};

type StudyBatch = NonNullable<ReturnType<typeof makeBatch>>;
type ExitCheckpoint = {
  id: string;
  created: number;
  scope: string;
  level: StudyLevel;
  batches: Array<{ batchId: string; json: string }>;
};
type ExitCheckpointBatch = ExitCheckpoint["batches"][number];
const activeBatches = new Map<string, StudyBatch>();
const reserveBatch = (batch: StudyBatch) => {
  activeBatches.set(batch.batchId, batch);
  batch.recordIds.forEach((id) => inFlightRecords.add(id));
};
const finishBatches = (batches: StudyBatch[], stored: boolean) => {
  const ids = new Set(batches.flatMap((batch) => batch.recordIds));
  if (stored) buffer = buffer.filter((record) => !ids.has(record.seq));
  ids.forEach((id) => inFlightRecords.delete(id));
  batches.forEach((batch) => activeBatches.delete(batch.batchId));
};
const makeBufferedBatches = (beacon: boolean, drain: boolean) => {
  const batches: StudyBatch[] = [];
  if (beacon) {
    // Beacon is only for one small best-effort packet. Durable queue batches
    // retain their transport-policy ceiling so large snapshot chunks survive a
    // page exit instead of being rejected by the keepalive byte limit.
    for (const deliveryClass of DELIVERY_ORDER) {
      const first = makeBatch(true, deliveryClass);
      if (!first) continue;
      reserveBatch(first);
      batches.push(first);
      break;
    }
    if (!drain) return batches;
  }
  for (const deliveryClass of DELIVERY_ORDER) {
    let batch = makeBatch(false, deliveryClass);
    while (batch) {
      reserveBatch(batch);
      batches.push(batch);
      if (!drain) return batches;
      // Only the first exit packet is constrained by keepalive. All remaining
      // records must still be durably enqueued at the normal batch ceiling.
      batch = makeBatch(false, deliveryClass);
    }
  }
  return batches;
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
  deliveryClass: batch.deliveryClass,
  state: "queued",
  snapshotKey: batch.snapshotKey,
  snapshotSeries: batch.snapshotSeries,
});

const batchDeliveryClass = (json: string): DeliveryClass => {
  try {
    const records = (JSON.parse(json) as { records?: Array<{ type?: unknown }> }).records;
    if (!records?.length) return "technical";
    return records.reduce<DeliveryClass>((priority, record) => {
      const candidate = deliveryClassFor(typeof record.type === "string" ? record.type : "");
      return deliveryRank(candidate) < deliveryRank(priority) ? candidate : priority;
    }, "asset");
  } catch {
    return "technical";
  }
};

const batchSnapshotMetadata = (json: string) => {
  try {
    const envelope = JSON.parse(json) as {
      participantId?: unknown;
      sessionId?: unknown;
      contextId?: unknown;
      records?: Array<{ project?: unknown; data?: unknown }>;
    };
    const first = envelope.records?.[0];
    const snapshotId = first?.data && typeof first.data === "object"
      ? (first.data as { snapshotId?: unknown }).snapshotId
      : undefined;
    if (
      typeof envelope.participantId !== "string"
      || typeof envelope.sessionId !== "string"
      || typeof envelope.contextId !== "string"
      || typeof first?.project !== "string"
      || typeof snapshotId !== "string"
    ) return {};
    const snapshotSeries = `${envelope.participantId}:${envelope.sessionId}:${envelope.contextId}:${first.project}`;
    return {
      snapshotSeries,
      snapshotKey: `${snapshotSeries}:${snapshotId}`,
    };
  } catch {
    return {};
  }
};

const clearExitCheckpoint = (id?: string) => {
  try {
    const current = readJson<ExitCheckpoint>(EXIT_CHECKPOINT_KEY);
    if (!id || current?.id === id) localStorage.removeItem(EXIT_CHECKPOINT_KEY);
  } catch {
    // Best-effort emergency cleanup.
  }
};

export const mergeExitCheckpointBatches = (
  existing: ExitCheckpointBatch[],
  incoming: ExitCheckpointBatch[],
  limit = MAX_OUTBOX_ITEMS,
  charLimit = MAX_EXIT_CHECKPOINT_CHARS,
) => {
  const deduplicated = new Map<string, ExitCheckpointBatch>();
  [...existing, ...incoming].forEach((batch) =>
    deduplicated.set(batch.batchId, batch));
  const entries = [...deduplicated.values()].map((batch, order) => ({
    batch,
    order,
    priority: deliveryRank(batchDeliveryClass(batch.json)),
    unitKey: batchSnapshotMetadata(batch.json).snapshotKey
      ?? batch.batchId,
  }));
  const units = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    const unit = units.get(entry.unitKey) ?? [];
    unit.push(entry);
    units.set(entry.unitKey, unit);
  });
  const ranked = [...units.values()].sort((a, b) =>
    Math.min(...a.map((entry) => entry.priority))
      - Math.min(...b.map((entry) => entry.priority))
    || Math.max(...b.map((entry) => entry.order))
      - Math.max(...a.map((entry) => entry.order)));
  const keptIds = new Set<string>();
  let keptChars = 0;
  for (const unit of ranked) {
    const unitChars = unit.reduce(
      (total, { batch }) => total + batch.batchId.length + batch.json.length,
      0,
    );
    if (
      keptIds.size + unit.length > limit
      || keptChars + unitChars > charLimit
    ) continue;
    unit.forEach(({ batch }) => keptIds.add(batch.batchId));
    keptChars += unitChars;
  }
  const kept = entries.filter(({ batch }) => keptIds.has(batch.batchId));
  return {
    batches: kept.map(({ batch }) => batch),
    dropped: entries
      .filter(({ batch }) => !keptIds.has(batch.batchId))
      .map(({ batch }) => batch),
  };
};

const saveExitCheckpoint = (batches: StudyBatch[]) => {
  const existing = readExitCheckpoint();
  if (existing && existing.level !== STUDY_PROFILE) return false;
  const merged = mergeExitCheckpointBatches(
    existing?.batches ?? [],
    batches.map(({ batchId, json }) => ({ batchId, json })),
  );
  const checkpoint: ExitCheckpoint = {
    id: uuid("chk"),
    created: existing?.created ?? Date.now(),
    scope: outboxScope,
    level: STUDY_PROFILE as StudyLevel,
    batches: merged.batches,
  };
  try {
    localStorage.setItem(EXIT_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    merged.dropped.forEach((batch) =>
      reportTelemetryLoss(batchDeliveryClass(batch.json)));
    return true;
  } catch {
    return false;
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

const removeExitCheckpointBatches = (batchIds: string[]) => {
  if (!batchIds.length) return;
  const checkpoint = readExitCheckpoint();
  if (!checkpoint) return;
  const stored = new Set(batchIds);
  const batches = checkpoint.batches.filter(
    (batch) => !stored.has(batch.batchId),
  );
  if (!batches.length) {
    clearExitCheckpoint(checkpoint.id);
    return;
  }
  try {
    localStorage.setItem(
      EXIT_CHECKPOINT_KEY,
      JSON.stringify({ ...checkpoint, batches }),
    );
  } catch {
    // Retaining already-stored batches is safe; server batch ids are idempotent.
  }
};

const recoverExitCheckpoint = async () => {
  const checkpoint = readExitCheckpoint();
  if (!checkpoint) return;
  const stored = await queueOutboxItems(checkpoint.batches.map((batch) => {
    const deliveryClass = batchDeliveryClass(batch.json);
    const snapshot = deliveryClass === "snapshot"
      ? batchSnapshotMetadata(batch.json)
      : {};
    const body = new Blob([batch.json], { type: "application/json" });
    return {
      id: `${checkpoint.scope}:${batch.batchId}`,
      created: Date.now(),
      scope: checkpoint.scope,
      level: checkpoint.level,
      path: "/batch" as const,
      body,
      headers: { "Content-Type": "application/json" },
      bytes: body.size,
      deliveryClass,
      state: "queued" as const,
      ...snapshot,
    };
  }));
  if (stored) {
    removeExitCheckpointBatches(
      checkpoint.batches.map((batch) => batch.batchId),
    );
  }
};

let deliveryRetryTimer: number | undefined;
let deliveryRetryMs = 5_000;
let reconnectDrainTimer: number | undefined;
let deliveryDrainTimer: number | undefined;

const noteDelivery = (success: boolean, rttMs = 0) => {
  if (!success) {
    consecutiveDeliveryFailures += 1;
    consecutiveDeliverySuccesses = 0;
  } else {
    consecutiveDeliveryFailures = 0;
    consecutiveDeliverySuccesses += 1;
    consecutiveSlowDeliveries = rttMs >= 3_000 ? consecutiveSlowDeliveries + 1 : 0;
  }
  if (
    connectionIsConstrained()
    || consecutiveDeliveryFailures >= 2
    || consecutiveSlowDeliveries >= 2
  ) {
    transportMode = "constrained";
  } else if (transportMode !== "normal" && consecutiveDeliverySuccesses >= 3) {
    transportMode = "normal";
  }
};

const scheduleDeliveryRetry = (delay = deliveryRetryMs) => {
  if (deliveryRetryTimer !== undefined || typeof window === "undefined") return;
  const capped = Math.min(
    5 * 60_000,
    Math.max(transportPolicy().retryFloorMs, delay),
  );
  const jittered = randomBetween([capped, Math.min(5 * 60_000, Math.round(capped * 1.5))]);
  deliveryRetryTimer = window.setTimeout(() => {
    deliveryRetryTimer = undefined;
    void flushOutbox();
  }, jittered);
  deliveryRetryMs = Math.min(5 * 60_000, Math.max(deliveryRetryMs * 2, capped));
};

const scheduleReconnectDrain = () => {
  if (reconnectDrainTimer !== undefined || typeof window === "undefined") return;
  transportMode = "offline-recovery";
  consecutiveDeliverySuccesses = 0;
  sawOffline = false;
  if (deliveryRetryTimer !== undefined) {
    window.clearTimeout(deliveryRetryTimer);
    deliveryRetryTimer = undefined;
  }
  if (deliveryDrainTimer !== undefined) {
    window.clearTimeout(deliveryDrainTimer);
    deliveryDrainTimer = undefined;
  }
  reconnectDrainTimer = window.setTimeout(() => {
    reconnectDrainTimer = undefined;
    void flushOutbox();
  }, randomBetween(TRANSPORT_POLICIES["offline-recovery"].drainDelayMs));
};

const selectOutboxForDelivery = async () => {
  const items: OutboxItem[] = [];
  const incompatible: Array<{ id: string; deliveryClass: DeliveryClass }> = [];
  await visitOutbox((rawItem) => {
    const item: OutboxItem = {
      ...rawItem,
      deliveryClass: outboxDeliveryClass(rawItem),
      state: outboxState(rawItem),
    };
    const deliverable = scopeMatches(item.scope)
      && isStudyLevel(item.level)
      && levelRank[item.level] <= levelRank[STUDY_PROFILE];
    if (!deliverable) {
      incompatible.push({ id: item.id, deliveryClass: outboxDeliveryClass(item) });
      return;
    }
    if (item.state !== "queued") return;
    items.push(item);
    items.sort((a, b) =>
      deliveryRank(outboxDeliveryClass(a)) - deliveryRank(outboxDeliveryClass(b))
      || a.created - b.created,
    );
    if (items.length > transportPolicy().outboxItemsPerDrain) items.pop();
  });
  return { items, incompatible };
};

const hasQueuedOutbox = async () => {
  let queued = false;
  await visitOutbox((item) => {
    if (queued || outboxState(item) !== "queued") return;
    if (
      scopeMatches(item.scope)
      && isStudyLevel(item.level)
      && levelRank[item.level] <= levelRank[STUDY_PROFILE]
    ) {
      queued = true;
    }
  });
  return queued;
};

const flushOutbox = async () => {
  if (flushRunning || !studyTelemetryEnabled()) return;
  if (navigator.onLine === false) {
    sawOffline = true;
    return;
  }
  if (sawOffline) {
    scheduleReconnectDrain();
    return;
  }
  flushRunning = true;
  let deliverySucceeded = true;
  let retryAfterMs = 0;
  try {
    const { items, incompatible } = await selectOutboxForDelivery();
    await deleteOutbox(incompatible.map((item) => item.id));
    incompatible.forEach((item) => reportTelemetryLoss(item.deliveryClass));
    for (const item of items) {
      const body = item.path === "/batch" && item.body.type === "application/json"
        ? await gzip(await item.body.text())
        : item.body;
      const headers = body.type === "application/gzip"
        ? { "Content-Type": "application/json", "Content-Encoding": "gzip" }
        : item.headers;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      const startedAt = performance.now();
      const response = await fetch(`${STUDY_ENDPOINT}${item.path}`, {
        method: "POST",
        headers,
        body,
        keepalive: body.size <= 60 * 1024,
        credentials: "omit",
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      const rttMs = performance.now() - startedAt;
      if (!response.ok) {
        if ([400, 401, 403, 404, 405, 409, 413, 415, 422].includes(response.status)) {
          await quarantineOutbox(item, response.status);
          recordStudyEvent(
            "technical.quarantine",
            { deliveryClass: outboxDeliveryClass(item), status: response.status },
            { level: "metrics", immediate: true },
          );
          continue;
        }
        const retryAfter = Number(response.headers.get("Retry-After"));
        retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0;
        deliverySucceeded = false;
        noteDelivery(false, rttMs);
        break;
      }
      await deleteOutbox([item.id]);
      noteDelivery(true, rttMs);
      deliveryRetryMs = transportPolicy().retryFloorMs;
    }
  } catch {
    deliverySucceeded = false;
    noteDelivery(false);
    // Offline/server failure remains queued and never reaches product UI.
  } finally {
    flushRunning = false;
    if (deliverySucceeded) {
      try {
        if (await hasQueuedOutbox()) {
          const policy = transportPolicy();
          if (deliveryDrainTimer !== undefined) {
            window.clearTimeout(deliveryDrainTimer);
          }
          deliveryDrainTimer = window.setTimeout(
            () => {
              deliveryDrainTimer = undefined;
              void flushOutbox();
            },
            randomBetween(policy.drainDelayMs),
          );
        }
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
  if (!studyTelemetryEnabled()) return false;
  const reconnecting = reason === "online";
  if (reconnecting) scheduleReconnectDrain();
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  flushDueAt = 0;
  // Normal durable flushes store one bounded batch per task. Exit checkpoints
  // still drain every batch so a closing page cannot strand a generation.
  const batches = makeBufferedBatches(beacon, beacon || checkpoint);
  if (checkpoint && activeBatches.size) {
    saveExitCheckpoint([...activeBatches.values()]);
  }
  if (!batches.length) {
    if (!beacon && reconnectDrainTimer === undefined) await flushOutbox();
    return true;
  }
  const unfinished = new Set(batches.map((batch) => batch.batchId));
  let allStored = true;
  try {
    const first = batches[0];
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
    for (const deliveryClass of DELIVERY_ORDER) {
      const group = batches.filter((batch) => batch.deliveryClass === deliveryClass);
      if (!group.length) continue;
      let stored = false;
      try {
        const bodies = beacon || durableOnly
          ? group.map((batch) => new Blob([batch.json], { type: "application/json" }))
          : await Promise.all(group.map((batch) => gzip(batch.json)));
        stored = await queueOutboxItems(
          group.map((batch, index) => outboxBatch(batch, bodies[index])),
        );
      } finally {
        finishBatches(group, stored);
        group.forEach((batch) => unfinished.delete(batch.batchId));
      }
      allStored &&= stored;
      if (stored) {
        removeExitCheckpointBatches(group.map((batch) => batch.batchId));
      }
    }
    if (
      allStored
      && !beacon
      && !durableOnly
      && reconnectDrainTimer === undefined
    ) await flushOutbox();
    const hasBufferLeft = buffer.some((record) => !inFlightRecords.has(record.seq));
    if (hasBufferLeft) {
      scheduleFlush(
        allStored ? 0 : 1_000,
        durableOnly && !beacon,
      );
    } else if (allStored && durableOnly && !beacon) {
      // durableOnly stored records to the outbox without posting (large snapshot
      // commits, visibility/page transitions). This branch also cleared the pending
      // activity timer above, and finishBatches already emptied the buffer, so
      // without a follow-up drain the stored items would sit undelivered until some
      // unrelated event happens to flush — which may be never this session. Arm a
      // coalesced drain so delivery is guaranteed, not best-effort.
      scheduleFlush(1_000);
    }
    return allStored;
  } catch {
    // Compression/storage failure must never strand reserved seqs in-flight nor
    // surface to the product UI. Release the reservations and re-arm a coalesced
    // retry so a transient throw self-heals instead of leaving buffered records
    // un-armed until the next unrelated event.
    finishBatches(
      batches.filter((batch) => unfinished.has(batch.batchId)),
      false,
    );
    scheduleFlush(1_000);
    return false;
  }
};

const base64Url = (bytes: Uint8Array) => {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const imageBlob = async (dataUrl: string) => {
  const source = await (await fetch(dataUrl)).blob();
  return new Promise<{ blob: Blob; width: number; height: number }>((resolve, reject) => {
    const worker = new Worker(new URL("./studyImageWorker.ts", import.meta.url), { type: "module", name: "motionsmith-study-image" });
    const finish = () => worker.terminate();
    worker.onmessage = ({ data }: MessageEvent<{ type: "result"; blob: Blob; width: number; height: number } | { type: "error" }>) => {
      finish();
      if (data.type === "result") resolve(data);
      else reject(new Error("normalize_failed"));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("normalize_failed"));
    };
    worker.postMessage({ id: 1, source });
  });
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
          deliveryClass: "asset",
          state: "queued",
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
    network: connection?.effectiveType && /^(?:[234]g|slow-2g)$/.test(connection.effectiveType) ? connection.effectiveType : "unknown",
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

// Offline batch analysis CLI. Lists sessions for a deployment tag, folds each
// through the canonical pipeline (reassemble -> project -> compute metrics),
// aggregates across the deployment, and writes a JSON + CSV export plus a
// stdout summary. Read-only: it never mutates R2. Purging stays a manual
// operator action via the admin DELETE routes (see docs/study/runbook.md).
//
// Reuses the admin-fetch + cursor pagination conventions from
// scripts/study-replay.ts. The one piece study-replay.ts lacks is the session
// list loop — /admin/sessions returns { sessions, cursor } — which this CLI
// drives to enumerate a whole deployment.

import { writeFile } from "node:fs/promises";
import { reassembleStudyEvents, projectStudyReplayState } from "../utils/studyReplayProjection";
import {
    aggregateSessionMetrics,
    computeSessionMetrics,
    deploymentMetricsToCsvRows,
    toCsv,
    type SessionEnvelopeMeta,
} from "../utils/studyMetrics";

const args = Object.fromEntries(
    process.argv.slice(2).flatMap((value, index, values) =>
        value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : [],
    ),
);
const endpoint = (args.endpoint || "https://alansynn.com/ms-study/v1").replace(/\/+$/, "");
const deployment = args.deployment;
const singleSession = args.session;
const output = args.out || `study-analysis-${deployment || singleSession || "deployment"}`;
const limit = args.limit ? Number(args.limit) : 0;
const expectedProfile = args.profile;
const token = process.env.STUDY_ADMIN_TOKEN;
const force = Object.hasOwn(args, "force");

if (!deployment || !token) {
    console.error("Usage: STUDY_ADMIN_TOKEN=... bun scripts/study-analyze.ts --deployment v0.0.10 [--session ses_...] [--limit N] [--profile study|replay|metrics] [--endpoint URL] [--out prefix] [--force]");
    process.exit(1);
}

const adminFetch = async (path: string) => {
    const response = await fetch(`${endpoint}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`${response.status} ${path}`);
    return response;
};

type Envelope = SessionEnvelopeMeta & {
    batchId: string;
    contextId: string;
    records: Array<Record<string, unknown>>;
};

type SessionPage = {
    batches: Envelope[];
    cursor?: string | null;
};

// Enumerate sessions under a deployment tag. /admin/sessions returns the
// session-id folders under telemetry/<deployment>/sessions/ via delimiter
// listing, paginated on cursor.
const listSessions = async (): Promise<string[]> => {
    if (singleSession) return [singleSession];
    const sessions: string[] = [];
    let cursor = "";
    do {
        const query = new URLSearchParams({ deployment, ...(cursor ? { cursor } : {}) });
        const page = await (await adminFetch(`/admin/sessions?${query}`)).json() as { sessions: string[]; cursor: string | null };
        for (const session of page.sessions) {
            sessions.push(session);
            if (limit && sessions.length >= limit) return sessions;
        }
        cursor = page.cursor || "";
    } while (cursor);
    return sessions;
};

// Pull every batch for a session, flatten records to a stream annotated with
// contextId/participantId, and sort by (t, contextId, seq) — the same key
// study-replay.ts uses so the fold sees a single deterministic order.
const fetchSessionEvents = async (sessionId: string) => {
    const batches: Envelope[] = [];
    let cursor = "";
    do {
        const query = new URLSearchParams({ deployment, ...(cursor ? { cursor } : {}) });
        const page = await (await adminFetch(`/admin/session/${encodeURIComponent(sessionId)}?${query}`)).json() as SessionPage;
        batches.push(...page.batches);
        cursor = page.cursor || "";
    } while (cursor);

    if (!batches.length) return { meta: null as SessionEnvelopeMeta | null, rawEvents: [] as Array<Record<string, unknown>> };

    // Envelope-level identity is constant across a session's batches; reconnect
    // count is cumulative so take the max (most recent) across batches.
    const first = batches[0];
    const reconnectCount = batches.reduce((max, batch) => Math.max(max, batch.reconnectCount || 0), 0);
    const sessionCount = batches.reduce((max, batch) => Math.max(max, batch.sessionCount || 0), 0);
    const receivedAt = batches
        .map((batch) => batch.receivedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
    const meta: SessionEnvelopeMeta = {
        deployment: first.deployment,
        appVersion: first.appVersion,
        buildSha: first.buildSha,
        profile: first.profile,
        classId: first.classId,
        classSessionId: first.classSessionId,
        teamId: first.teamId,
        participantId: first.participantId,
        sessionId: first.sessionId,
        sessionCount,
        reconnectCount,
        receivedAt,
    };

    const rawEvents = batches.flatMap((batch) =>
        batch.records.map((record) => ({
            ...record,
            contextId: batch.contextId,
            participantId: batch.participantId,
        })),
    ).sort((a, b) =>
        Number(a.t) - Number(b.t) || String(a.contextId).localeCompare(String(b.contextId)) || Number(a.seq) - Number(b.seq),
    );
    return { meta, rawEvents };
};

const sessions = await listSessions();
console.error(`study-analyze: ${sessions.length} session(s) under ${deployment}`);

const warnings: string[] = [];
const metricsList = [];
const buildShas = new Set<string>();
for (const sessionId of sessions) {
    const { meta, rawEvents } = await fetchSessionEvents(sessionId);
    if (!meta) {
        warnings.push(`session ${sessionId}: no batches found, skipped`);
        continue;
    }
    buildShas.add(meta.buildSha);
    const { events, losses } = reassembleStudyEvents(rawEvents);
    const projection = projectStudyReplayState(events);
    const ts = events.map((event) => Number(event.t)).filter((value) => Number.isFinite(value));
    const firstT = ts.length ? Math.min(...ts) : 0;
    const lastT = ts.length ? Math.max(...ts) : 0;
    const metrics = computeSessionMetrics({ meta, events, losses, projection, firstT, lastT });
    metricsList.push(metrics);
    if (expectedProfile && meta.profile !== expectedProfile) {
        warnings.push(`session ${sessionId}: profile ${meta.profile} != expected ${expectedProfile} (projection-derived fields may be null)`);
    }
    if (metrics.lossCount > 0) {
        warnings.push(`session ${sessionId}: ${metrics.lossCount} reassembly gap(s) — ${metrics.incompleteSnapshots} incomplete snapshot(s); state may reconstruct from a stale baseline`);
    }
}

// Cross-session drift warnings. Schema versions are pinned at ingest
// (validEnvelope rejects non-v1 envelopes), so they cannot drift within stored
// data; profile and build-sha can.
const profiles = new Set(metricsList.map((metrics) => metrics.profile));
if (profiles.size > 1) {
    warnings.push(`deployment ${deployment}: mixed capture profiles ${[...profiles].join(", ")} — projection-derived fields (mechanism distribution, final counts, lesson id) are null for metrics-profile sessions`);
}
if (buildShas.size > 1) {
    warnings.push(`deployment ${deployment}: ${buildShas.size} distinct build shas (${[...buildShas].join(", ").slice(0, 120)}) — sessions may run different code`);
}

const aggregate = aggregateSessionMetrics(metricsList);
const result = {
    deployment,
    generatedAt: new Date().toISOString(),
    sessions: metricsList,
    aggregate,
    warnings,
};

const jsonPath = `${output}.json`;
const csvPath = `${output}.csv`;
const flag = force ? "w" : "wx";
await writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag });
await writeFile(csvPath, toCsv(deploymentMetricsToCsvRows(metricsList)), { mode: 0o600, flag });

// Stdout human summary — always printed, even when warnings exist.
const funnel = aggregate.completionFunnel;
const topMechanisms = Object.entries(aggregate.mechanismTypeDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => `${type}=${count}`)
    .join(" ");
const fmtMs = (ms: number | null) => {
    if (ms == null) return "n/a";
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
console.log(
    `deployment ${deployment} · ${aggregate.sessionCount} session(s) · profile=${[...profiles].join("/") || "none"} · generated ${result.generatedAt}`,
);
console.log(
    `completion funnel: path=${funnel.path} foundry=${funnel.foundry} design=${funnel.design} blueprint=${funnel.blueprint} assembly=${funnel.assembly} export=${funnel.export} completed=${funnel.completed}`,
);
console.log(
    `median sessionActiveMs: ${fmtMs(aggregate.medianSessionActiveMs)} · median rejectedActionRate: ${aggregate.medianRejectedActionRate ?? "n/a"} · median undoCount: ${aggregate.medianUndoCount ?? "n/a"} · median redoCount: ${aggregate.medianRedoCount ?? "n/a"}`,
);
if (topMechanisms) console.log(`top mechanism types: ${topMechanisms}`);
if (aggregate.meanRankAtAcceptance != null) console.log(`mean rank at acceptance: ${Math.round(aggregate.meanRankAtAcceptance * 100) / 100}`);
if (warnings.length) console.log(`${warnings.length} warning(s) (see warnings[] in JSON)`);
console.log(`wrote: ${jsonPath} (mode 0600)`);
console.log(`wrote: ${csvPath} (mode 0600)`);

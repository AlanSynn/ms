import assert from "node:assert/strict";
import type { ReplayEvent, StudyReplayProjection } from "../utils/studyReplayProjection";
import { projectStudyReplayState, reassembleStudyEvents } from "../utils/studyReplayProjection";
import {
    actionFamilyOf,
    aggregateSessionMetrics,
    computeSessionMetrics,
    deploymentMetricsToCsvRows,
    mean,
    median,
    quantile,
    sessionMetricsToCsvRow,
    toCsv,
    type SessionEnvelopeMeta,
    type SessionMetricsInput,
} from "../utils/studyMetrics";

const baseMeta: SessionEnvelopeMeta = {
    deployment: "v0.0.10",
    appVersion: "0.0.10",
    buildSha: "0123456789abcdef0123456789abcdef01234567",
    profile: "study",
    classId: "class-a",
    classSessionId: "session-a",
    teamId: "team-a",
    participantId: "participant-a",
    sessionId: "ses_test",
    sessionCount: 1,
    reconnectCount: 2,
};

type Ev = ReplayEvent;
const ev = (
    type: string,
    t: number,
    seq: number,
    data: Record<string, unknown>,
    contextId = "ctx_1",
    stage?: string,
): Ev => ({ type, t, seq, contextId, stage, data });

// Fold raw events through the canonical pipeline (reassemble + project) and
// hand the result to computeSessionMetrics exactly the way the CLI will. This
// keeps the metrics module honest: it must consume the same projection every
// other consumer uses, not a bespoke one.
const buildInput = (
    events: Ev[],
    metaOverrides: Partial<SessionEnvelopeMeta> = {},
): SessionMetricsInput => {
    const { events: reassembled, losses } = reassembleStudyEvents(events);
    const projection = projectStudyReplayState(reassembled);
    const ts = reassembled.map((event) => Number(event.t)).filter((value) => Number.isFinite(value));
    const firstT = ts.length ? Math.min(...ts) : 0;
    const lastT = ts.length ? Math.max(...ts) : 0;
    return { meta: { ...baseMeta, ...metaOverrides }, events: reassembled, losses, projection, firstT, lastT };
};

// T1 — per-session metric correctness. Every field equals the hand-computed
// value for a fixed stream exercising every metric family.
{
    const baseState = { parts: {}, partOrder: [], paths: {}, sceneObjects: {}, sceneObjectOrder: [], mechanisms: [] };
    const events: Ev[] = [
        ev("session.start", 100, 1, { reconnectCount: 2, technical: { browser: "chrome", os: "macos", pointer: "mouse", network: "4g", viewport: "1280x800" }, project: { parts: 0, mechanisms: 0 } }),
        ev("project.snapshot", 150, 2, { reason: "initial", state: { ...baseState, metadata: { classroomLessonId: "lesson-7" }, mechanisms: [
            { id: "ent_m1", type: "four_bar", enabled: true },
            { id: "ent_m2", type: "cam", enabled: false },
        ] } }),
        ev("stage.view", 200, 3, { from: "character", to: "path", dwellMs: 1200 }),
        ev("stage.view", 300, 4, { from: "path", to: "foundry", dwellMs: 800 }),
        ev("stage.view", 400, 5, { from: "foundry", to: "design", dwellMs: 500 }),
        ev("stage.navigation", 450, 6, { outcome: "blocked", recoveryStage: "path" }),
        ev("recommendation.request", 500, 7, {}),
        ev("recommendation.candidates", 510, 8, { candidates: [
            { type: "four_bar", score: 0.9, blocked: false, reasonKey: "arc_limb" },
            { type: "cam", score: 0.8, blocked: true, reasonKey: "blocked" },
            { type: "gear", score: 0.7, blocked: false, reasonKey: "push_pull" },
            { type: "slider", score: 0.6, blocked: false, reasonKey: "lift" },
        ] }),
        ev("recommendation.accept", 900, 9, { mechanismType: "four_bar", presetId: "recommendation-four_bar", rank: 2, score: 0.71, candidateCount: 4 }),
        ev("project.action", 1000, 10, { type: "upsert_part", part: { id: "ent_p1" } }),
        ev("project.action", 1100, 11, { type: "update_part", partId: "ent_missing", updates: { locked: true }, applied: false }),
        ev("project.action", 1200, 12, { type: "upsert_path", path: { id: "ent_path1", points: [{ x: 0, y: 0 }] } }),
        ev("project.action", 1250, 13, { type: "delete_path", pathId: "ent_path1" }),
        ev("project.undo", 1300, 14, {}),
        ev("project.undo", 1310, 15, {}),
        ev("project.redo", 1320, 16, {}),
        ev("simulation.validation", 2000, 17, { type: "four_bar", valid: false, category: "collision" }),
        ev("simulation.validation", 2010, 18, { type: "four_bar", valid: true, category: "none" }),
        ev("simulation.validation", 2020, 19, { type: "four_bar", valid: true, category: "none" }),
        ev("simulation.foundry", 2100, 20, { state: "playing" }),
        ev("export.download", 3000, 21, { extension: "pdf", mime: "application/pdf", bytes: 42 }),
        ev("project.completed", 3100, 22, { recipes: 2, validationIssues: 0 }),
        ev("session.pagehide", 3200, 23, { activeMs: 14000, completed: true }),
    ];
    const metrics = computeSessionMetrics(buildInput(events));

    assert.equal(metrics.sessionActiveMs, 14000, "sessionActiveMs reads pagehide.activeMs");
    assert.equal(metrics.contextCount, 1);
    assert.equal(metrics.stageDwellMs.path, 800, "stage dwell attributed to the stage left (path->foundry carries path's dwell)");
    assert.equal(metrics.stageDwellMs.foundry, 500);
    assert.equal(metrics.stageDwellMs.design, 13600, "terminal stage dwell bounded by sessionActiveMs");
    assert.deepEqual(metrics.stageVisitOrder, ["path", "foundry", "design"]);
    assert.equal(metrics.stageNavigationBlockedRate, 1.0);
    assert.deepEqual(metrics.recoveryStageDistribution, { path: 1 });
    assert.deepEqual(metrics.rankAtAcceptance, [2]);
    assert.deepEqual(metrics.candidateCountAtAcceptance, [4]);
    assert.deepEqual(metrics.recommendationConsiderationMs, [400], "consideration = accept t - matching request t");
    assert.equal(metrics.recommendationAcceptRate, 1.0);
    assert.equal(metrics.rejectedActions, 1);
    assert.equal(metrics.totalActions, 4);
    assert.equal(metrics.rejectedActionRate, 0.25);
    assert.deepEqual(metrics.actionFamilyCounts.part, 2, "upsert_part + rejected update_part both count as part family");
    assert.deepEqual(metrics.actionFamilyCounts.path, 2, "upsert_path + delete_path count as path family");
    assert.equal(metrics.undoCount, 2);
    assert.equal(metrics.redoCount, 1);
    assert.equal(metrics.pathEditCount, 2);
    assert.equal(metrics.validationPassRate, 2 / 3);
    assert.deepEqual(metrics.validationCategoryCounts, { collision: 1, none: 2 });
    assert.equal(metrics.foundryPlaySessions, 1);
    assert.equal(metrics.reachedExport, true);
    assert.equal(metrics.completedProject, true);
    assert.deepEqual(metrics.exportDownloads, [{ extension: "pdf", mime: "application/pdf", bytes: 42 }]);
    assert.equal(metrics.initialLessonId, "lesson-7");
    assert.equal(metrics.finalMechanismCount, 2, "final mechanism count read from projection finalState");
    assert.equal(metrics.finalValidMechanismCount, 1, "valid = enabled-only (warnings scrubbed at replay depth)");
    assert.deepEqual(metrics.mechanismTypeDistribution, { four_bar: 1, cam: 1 });
    assert.deepEqual(metrics.mechanismTypesAccepted, ["four_bar"]);
    assert.equal(metrics.lossCount, 0);
    console.log("T1 per-session metrics verified against hand-computed stream");
}

// T2 — aggregation correctness. Three sessions with different funnel reach
// produce correct medians, funnel counts, and distribution sums.
{
    const mkSession = (id: string, reach: "export" | "foundry" | "assembly") => {
        const events: Ev[] = [
            ev("session.start", 100, 1, {}),
            ev("stage.view", 200, 2, { from: "character", to: "path", dwellMs: 1000 }),
            ev("stage.view", 300, 3, { from: "path", to: "foundry", dwellMs: 2000 }),
        ];
        if (reach === "foundry") {
            events.push(ev("session.pagehide", 400, 4, { activeMs: 4000, completed: false }));
            return computeSessionMetrics(buildInput(events, { sessionId: id }));
        }
        events.push(ev("stage.view", 400, 4, { from: "foundry", to: "design", dwellMs: 3000 }));
        events.push(ev("stage.view", 500, 5, { from: "design", to: "blueprint", dwellMs: 1000 }));
        events.push(ev("stage.view", 600, 6, { from: "blueprint", to: "assembly", dwellMs: 1000 }));
        if (reach === "assembly") {
            events.push(ev("session.pagehide", 700, 7, { activeMs: 8000, completed: false }));
            return computeSessionMetrics(buildInput(events, { sessionId: id }));
        }
        events.push(ev("export.download", 700, 7, { extension: "pdf", mime: "application/pdf", bytes: 10 }));
        events.push(ev("session.pagehide", 800, 8, { activeMs: 9000, completed: true }));
        return computeSessionMetrics(buildInput(events, { sessionId: id }));
    };
    const sessions = [mkSession("ses_a", "export"), mkSession("ses_b", "foundry"), mkSession("ses_c", "assembly")];
    const aggregate = aggregateSessionMetrics(sessions);

    assert.equal(aggregate.sessionCount, 3);
    assert.equal(aggregate.completionFunnel.path, 3, "all three reached path");
    assert.equal(aggregate.completionFunnel.foundry, 3, "all three reached foundry");
    assert.equal(aggregate.completionFunnel.assembly, 2, "a + c reached assembly");
    assert.equal(aggregate.completionFunnel.export, 1, "only a reached export");
    assert.equal(aggregate.completionRate, 1 / 3);
    // activeMs values: a=9000, b=4000, c=8000 -> median 8000, p25~6000, p75~8500
    assert.equal(aggregate.medianSessionActiveMs, 8000);
    assert.equal(aggregate.p25SessionActiveMs, 6000);
    assert.equal(aggregate.p75SessionActiveMs, 8500);
    console.log("T2 aggregation verified: funnel counts, completion rate, sessionActiveMs quantiles");
}

// T3 — projection-reuse invariant (the architectural guard). State-derived
// metrics read ONLY from input.projection, never from raw project.action
// records. A naive reader would count raw upsert/delete actions; the metric
// must reflect the projection's finalState instead.
{
    const baseState = { parts: {}, partOrder: [], paths: {}, sceneObjects: {}, sceneObjectOrder: [], mechanisms: [] };
    // Raw actions suggest two mechanisms were added then one deleted (naive
    // count: 2 added, or 1 remaining). The projection is the source of truth.
    const events: Ev[] = [
        ev("project.snapshot", 100, 1, { reason: "initial", state: { ...baseState, mechanisms: [
            { id: "ent_m1", type: "four_bar", enabled: true },
        ] } }),
        ev("project.action", 200, 2, { type: "upsert_mechanism", mechanism: { id: "ent_m2", type: "cam" } }),
        ev("project.action", 300, 3, { type: "upsert_mechanism", mechanism: { id: "ent_m3", type: "gear" } }),
        ev("project.action", 400, 4, { type: "delete_mechanism", mechanismId: "ent_m2" }),
    ];
    // Hand-build a projection whose finalState disagrees with a raw-action
    // reading: exactly one mechanism survives. computeSessionMetrics must trust
    // this, not the events.
    const survivingState = { ...baseState, mechanisms: [{ id: "ent_m1", type: "four_bar", enabled: true }] };
    const projection: StudyReplayProjection = {
        contexts: [{ contextId: "ctx_1", finalState: survivingState, snapshots: [survivingState] }],
        timeline: [survivingState],
    };
    const input: SessionMetricsInput = {
        meta: { ...baseMeta },
        events: reassembleStudyEvents(events).events,
        losses: [],
        projection,
        firstT: 100,
        lastT: 400,
    };
    const metrics = computeSessionMetrics(input);
    assert.equal(metrics.finalMechanismCount, 1, "projection finalState wins over raw action count");
    assert.deepEqual(metrics.mechanismTypeDistribution, { four_bar: 1 });
    assert.equal(metrics.mechanismEditCount, 3, "edit COUNT still comes from raw actions (effort signal)");
    console.log("T3 projection-reuse invariant verified: state from projection, effort from raw actions");
}

// T4 — stage skip detection. A session that jumps character -> assembly skips
// the canonical intermediate stages.
{
    const events: Ev[] = [
        ev("session.start", 100, 1, {}),
        ev("stage.view", 200, 2, { from: "character", to: "assembly", dwellMs: 500 }),
        ev("session.pagehide", 300, 3, { activeMs: 1000, completed: false }),
    ];
    const metrics = computeSessionMetrics(buildInput(events));
    assert.deepEqual(metrics.skippedStagesBeforeAssembly, ["path", "foundry", "design", "blueprint"]);
    assert.equal(metrics.reachedAssembly, true);
    assert.equal(metrics.reachedFoundry, false);
    assert.equal(metrics.reachedExport, false);
    console.log("T4 stage skip detection verified");
}

// T5 — CSV row flattening. A metrics-profile session (no snapshots, no actions)
// produces a stable column set with no holes; absent optionals serialize as "".
{
    const events: Ev[] = [
        ev("session.start", 100, 1, {}),
        ev("stage.view", 200, 2, { from: "character", to: "path", dwellMs: 1000 }),
        ev("simulation.validation", 300, 3, { type: "four_bar", valid: true, category: "none" }),
        ev("recommendation.accept", 400, 4, { mechanismType: "four_bar", rank: 1, candidateCount: 3 }),
        ev("session.pagehide", 500, 5, { activeMs: 2000, completed: false }),
    ];
    const metrics = computeSessionMetrics(buildInput(events, { profile: "metrics" }));
    const row = sessionMetricsToCsvRow(metrics);

    assert.equal(row.profile, "metrics");
    assert.equal(row.finalMechanismCount, "", "absent projection field serializes as empty string");
    assert.equal(row.initialLessonId, "");
    assert.equal(row.mechanismTypeDistribution, "");
    assert.equal(row.rankAtAcceptance, "1");
    assert.equal(row.stageVisitOrder, "path");
    assert.equal(row.reachedExport, false);
    // Every value is a primitive — no undefined leaks into the CSV row.
    for (const [key, value] of Object.entries(row)) {
        assert(value !== undefined, `CSV column ${key} is not undefined`);
        assert(value !== null, `CSV column ${key} is not null`);
    }
    const csv = toCsv([row]);
    assert.equal(csv.split("\n").length, 3, "header + row + trailing newline");
    assert.ok(csv.startsWith("sessionId,"), "deterministic header starts with sessionId");
    console.log("T5 CSV flattening verified: stable columns, no holes, no undefined leaks");
}

// T6 — loss surfacing. An incomplete chunk set propagates from
// reassembleStudyEvents.losses into the metrics lossCount / incompleteSnapshots.
{
    const chunkedState = { parts: { ent_c: { id: "ent_c" } }, paths: {}, sceneObjects: {}, mechanisms: [] };
    const encoded = Buffer.from(JSON.stringify(chunkedState)).toString("base64url");
    const split = Math.ceil(encoded.length / 2);
    const events: Ev[] = [
        ev("project.snapshot.begin", 10, 1, { snapshotId: "snp_g", reason: "chunked", total: 2 }),
        ev("project.snapshot.chunk", 11, 2, { snapshotId: "snp_g", index: 0, parts: [encoded.slice(0, split)] }),
    ];
    const metrics = computeSessionMetrics(buildInput(events));
    assert.equal(metrics.lossCount, 1);
    assert.equal(metrics.incompleteSnapshots, 1);
    console.log("T6 loss surfacing verified");
}

// T7 — profile degradation. A metrics-profile session with no snapshots yields
// null projection-derived fields without throwing.
{
    const events: Ev[] = [
        ev("session.start", 100, 1, {}),
        ev("stage.view", 200, 2, { from: "character", to: "path", dwellMs: 1000 }),
        ev("session.pagehide", 300, 3, { activeMs: 1000, completed: false }),
    ];
    const metrics = computeSessionMetrics(buildInput(events, { profile: "metrics" }));
    assert.equal(metrics.finalMechanismCount, null);
    assert.equal(metrics.finalValidMechanismCount, null);
    assert.equal(metrics.initialLessonId, null);
    assert.equal(metrics.finalHasExport, false);
    assert.deepEqual(metrics.mechanismTypeDistribution, {});
    console.log("T7 profile degradation verified: null state-derived fields, no throw");
}

// T8 — reconnect / multi-context. Two contexts fold without bleed; the session
// finalState is the latest authored state across contexts (timeline last).
{
    const baseState = { parts: {}, partOrder: [], paths: {}, sceneObjects: {}, sceneObjectOrder: [], mechanisms: [] };
    const events: Ev[] = [
        ev("project.snapshot", 10, 1, { reason: "initial", state: { ...baseState, mechanisms: [{ id: "ent_a", type: "four_bar", enabled: true }] } }, "ctx_a"),
        ev("project.action", 20, 2, { type: "upsert_mechanism", mechanism: { id: "ent_a2", type: "cam", enabled: true } }, "ctx_a"),
        ev("project.snapshot", 30, 1, { reason: "reconnect", state: { ...baseState, mechanisms: [{ id: "ent_b", type: "gear", enabled: true }] } }, "ctx_b"),
        ev("project.action", 40, 2, { type: "upsert_mechanism", mechanism: { id: "ent_b2", type: "slider", enabled: false } }, "ctx_b"),
    ];
    const metrics = computeSessionMetrics(buildInput(events));
    assert.equal(metrics.contextCount, 2);
    // ctx_b is chronologically last, so its authored state wins as the session
    // finalState: gear (snapshot) + slider (edit) = 2 mechanisms.
    assert.equal(metrics.finalMechanismCount, 2);
    assert.deepEqual(metrics.mechanismTypeDistribution, { gear: 1, slider: 1 });
    console.log("T8 reconnect/multi-context verified: latest authored state wins, no cross-context bleed");
}

// Pure-helper unit checks (statistical primitives + action family mapping).
{
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
    assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
    assert.equal(mean([2, 4, 6]), 4);
    assert.equal(mean([]), null);
    assert.equal(actionFamilyOf("upsert_part"), "part");
    assert.equal(actionFamilyOf("delete_mechanism"), "mechanism");
    assert.equal(actionFamilyOf("commit_mechanism_candidate"), "mechanism");
    assert.equal(actionFamilyOf("set_mechanisms"), "mechanism");
    assert.equal(actionFamilyOf("add_joint"), "skeleton");
    assert.equal(actionFamilyOf("set_skeleton"), "skeleton");
    assert.equal(actionFamilyOf("update_settings"), "settings");
    assert.equal(actionFamilyOf("select_part"), "transient");
    assert.equal(actionFamilyOf("load_project"), "load");
    console.log("pure helpers verified: median, quantile, mean, actionFamilyOf (verb-suffix mapping)");
}

// deploymentMetricsToCsvRows mirrors sessionMetricsToCsvRow one-for-one.
{
    const events: Ev[] = [
        ev("session.start", 100, 1, {}),
        ev("session.pagehide", 200, 2, { activeMs: 1000, completed: false }),
    ];
    const sessions = [
        computeSessionMetrics(buildInput(events, { sessionId: "ses_a" })),
        computeSessionMetrics(buildInput(events, { sessionId: "ses_b" })),
    ];
    const rows = deploymentMetricsToCsvRows(sessions);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sessionId, "ses_a");
    assert.equal(rows[1].sessionId, "ses_b");
    const csv = toCsv(rows);
    assert.equal(csv.split("\n").length, 4, "header + 2 rows + trailing newline");
    console.log("deployment CSV rows verified");
}

console.log("study metrics contracts passed");

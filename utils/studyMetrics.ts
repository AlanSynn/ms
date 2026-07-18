// Offline study-metrics module. Pure functions that turn an already-reassembled
// event stream + already-folded projection into research metrics, plus a
// deployment-wide aggregate. The single architectural rule: every state-derived
// metric (mechanism distribution, final counts, lesson id) reads ONLY from the
// projection's final state, never from raw project.action records — raw actions
// reflect attempts (including rejected and later-undone edits), not authored
// truth. computeSessionMetrics accepts the projection as an input; it never
// calls projectStudyReplayState itself.
//
// Catalog basis + field anchors live in docs/study/data-dictionary.md and
// docs/study/metrics.md. Two scrub-layer facts shape the definitions:
//   - mechanism.warnings is stripped by scrubStudyValue (utils/studyTelemetryProject),
//     so "valid mechanism" at the replay layer degrades to enabled-only.
//   - project.action types are verb-prefixed (upsert_part, delete_mechanism), so
//     actionFamilyOf maps by suffix, not prefix.

import type {
    ReassembleLoss,
    ReplayEvent,
    ReplayState,
    StudyReplayProjection,
} from "./studyReplayProjection";

export type StageEnum =
    | "character"
    | "path"
    | "foundry"
    | "design"
    | "blueprint"
    | "assembly"
    | "options";

export type SessionEnvelopeMeta = {
    deployment: string;
    appVersion: string;
    buildSha: string;
    profile: "metrics" | "replay" | "study";
    classId: string;
    classSessionId: string;
    teamId: string;
    participantId: string;
    sessionId: string;
    sessionCount: number;
    reconnectCount: number;
    receivedAt?: string;
};

// Caller (the CLI) is responsible for reassembly + fold. computeSessionMetrics
// never re-derives state from raw events.
export type SessionMetricsInput = {
    meta: SessionEnvelopeMeta;
    events: ReplayEvent[];
    losses: ReassembleLoss[];
    projection: StudyReplayProjection;
    firstT: number;
    lastT: number;
};

export type StageVisit = {
    stage: StageEnum;
    enteredAtT: number;
    dwellMs: number;
};

export type SessionMetrics = {
    /* identity */
    sessionId: string;
    deployment: string;
    participantId: string;
    classId: string;
    classSessionId: string;
    teamId: string;
    profile: SessionEnvelopeMeta["profile"];
    /* engagement */
    sessionActiveMs: number | null;
    reconnectCount: number;
    contextCount: number;
    pauseCount: number;
    resumeCount: number;
    pauseMsLowerBound: number;
    /* stage behavior */
    stageVisits: StageVisit[];
    stageDwellMs: Partial<Record<StageEnum, number>>;
    stageVisitOrder: StageEnum[];
    stagesVisited: StageEnum[];
    stageReentryCounts: Partial<Record<StageEnum, number>>;
    stageBlockedCount: number;
    stageOpenedCount: number;
    stageNavigationBlockedRate: number;
    recoveryStageDistribution: Record<string, number>;
    skippedStagesBeforeAssembly: StageEnum[];
    /* funnel */
    reachedPath: boolean;
    reachedFoundry: boolean;
    reachedDesign: boolean;
    reachedBlueprint: boolean;
    reachedAssembly: boolean;
    reachedExport: boolean;
    completedProject: boolean;
    /* mechanism */
    mechanismTypesAccepted: string[];
    mechanismTypeDistribution: Record<string, number>;
    recommendationRequests: number;
    recommendationAccepts: number;
    recommendationDismisses: number;
    recommendationAcceptRate: number;
    recommendationDismissRate: number;
    rankAtAcceptance: number[];
    candidateCountAtAcceptance: number[];
    recommendationConsiderationMs: number[];
    /* authoring */
    totalActions: number;
    rejectedActions: number;
    rejectedActionRate: number;
    actionFamilyCounts: Record<string, number>;
    undoCount: number;
    redoCount: number;
    undoToActionRatio: number;
    pathEditCount: number;
    skeletonEditCount: number;
    mechanismEditCount: number;
    /* simulation / fabrication */
    validationRuns: number;
    validationPassRate: number;
    validationCategoryCounts: Record<string, number>;
    mechanismTypeValidationFailureRate: Record<string, number>;
    foundryPlaySessions: number;
    /* ui / help */
    modalOpens: Record<string, number>;
    helpOpens: number;
    helpCloseRate: number;
    commandRuns: Record<string, number>;
    gestureVolume: { count: number; totalDurationMs: number };
    /* technical */
    technicalStatusCounts: Record<string, number>;
    technicalErrors: number;
    technicalContext: { browser: string; os: string; pointer: string; network: string } | null;
    assetImports: number;
    assetOmitted: number;
    exportDownloads: Array<{ extension: string; mime: string; bytes: number }>;
    /* projection health */
    lossCount: number;
    incompleteSnapshots: number;
    /* projection-derived final state */
    initialLessonId: string | null;
    finalMechanismCount: number | null;
    finalValidMechanismCount: number | null;
    finalHasExport: boolean;
};

export type DeploymentAggregate = {
    sessionCount: number;
    completionFunnel: Record<string, number>;
    completionRate: number;
    medianSessionActiveMs: number | null;
    p25SessionActiveMs: number | null;
    p75SessionActiveMs: number | null;
    medianStageDwellMs: Partial<Record<StageEnum, number>>;
    mechanismTypeDistribution: Record<string, number>;
    meanRankAtAcceptance: number | null;
    meanCandidateCountAtAcceptance: number | null;
    medianRejectedActionRate: number | null;
    medianUndoCount: number | null;
    medianRedoCount: number | null;
    validationCategoryFrequency: Record<string, number>;
    meanValidationPassRate: number | null;
    technicalStatusFrequency: Record<string, number>;
    technicalContextDistribution: {
        browser: Record<string, number>;
        os: Record<string, number>;
        pointer: Record<string, number>;
        network: Record<string, number>;
    };
    recommendationAcceptRate: number | null;
    medianRecommendationConsiderationMs: number | null;
};

export type DeploymentMetrics = {
    deployment: string;
    generatedAt: string;
    sessions: SessionMetrics[];
    aggregate: DeploymentAggregate;
    warnings: string[];
};

const STAGE_ENUMS: readonly StageEnum[] = [
    "character",
    "path",
    "foundry",
    "design",
    "blueprint",
    "assembly",
    "options",
];

const asStageEnum = (value: unknown): StageEnum | null => {
    const stage = typeof value === "string" ? value : null;
    return stage && (STAGE_ENUMS as readonly string[]).includes(stage) ? (stage as StageEnum) : null;
};

const dataOf = (event: ReplayEvent): Record<string, unknown> =>
    (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;

const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;

const tally = (counts: Record<string, number>, key: string): void => {
    counts[key] = (counts[key] || 0) + 1;
};

const sum = (values: readonly number[]): number =>
    values.reduce((total, value) => total + value, 0);

export const median = (values: readonly number[]): number | null => {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const mid = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
};

export const quantile = (values: readonly number[], q: number): number | null => {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const position = (ordered.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return ordered[lower];
    const weight = position - lower;
    return ordered[lower] * (1 - weight) + ordered[upper] * weight;
};

export const mean = (values: readonly number[]): number | null =>
    values.length ? sum(values) / values.length : null;

// Coarse authoring-action family. Project action types are verb-prefixed
// (upsert_part, delete_mechanism, commit_mechanism_candidate), so this maps by
// suffix plus the few whole-word types (set_skeleton, set_export, ...). No new
// vocabulary — every bucket corresponds to an applyReplayAction case family.
export const actionFamilyOf = (actionType: string): string => {
    if (actionType === "set_skeleton") return "skeleton";
    if (actionType === "update_settings") return "settings";
    if (actionType === "set_export") return "export";
    if (actionType === "set_processing" || actionType === "select_part" || actionType === "select_scene_object") return "transient";
    if (actionType === "load_project") return "load";
    if (actionType.endsWith("_part") || actionType === "reorder_part") return "part";
    if (actionType.endsWith("_scene_object")) return "scene_object";
    if (actionType.endsWith("_path")) return "path";
    if (actionType.endsWith("_mechanism") || actionType === "set_mechanisms" || actionType === "commit_mechanism_candidate") return "mechanism";
    if (actionType.endsWith("_joint")) return "skeleton";
    return "other";
};

// One StageVisit per stage.view event. dwellMs for a visit is the dwell of THAT
// stage: the dwellMs carried on the NEXT stage.view whose `from` matches this
// stage (the client emits dwellMs for the stage being left at navigation time).
// The terminal stage (no following navigation) carries 0 — its dwell is not
// observable without an exit event; sessionActiveMs covers total engagement.
export const stageVisitsFromEvents = (
    events: readonly ReplayEvent[],
    sessionActiveMs: number | null,
): StageVisit[] => {
    const views = events.filter((event) => event.type === "stage.view");
    const visits: StageVisit[] = [];
    for (let index = 0; index < views.length; index += 1) {
        const current = views[index];
        const currentData = dataOf(current);
        const stage = asStageEnum(currentData.to);
        if (!stage) continue;
        const next = views[index + 1];
        const nextData = next ? dataOf(next) : null;
        const chainedDwell =
            next && asStageEnum(nextData?.from) === stage ? num(nextData?.dwellMs) ?? 0 : 0;
        const terminalDwell =
            !next && sessionActiveMs != null
                ? Math.max(0, sessionActiveMs - (num(current.t) ?? 0))
                : 0;
        visits.push({
            stage,
            enteredAtT: num(current.t) ?? 0,
            dwellMs: chainedDwell || terminalDwell,
        });
    }
    return visits;
};

export const stageVisitOrderFromVisits = (visits: readonly StageVisit[]): StageEnum[] =>
    visits.map((visit) => visit.stage);

export const completionFunnelFromEvents = (events: readonly ReplayEvent[]) => {
    const reached = new Set<StageEnum>();
    let reachedExport = false;
    let completedProject = false;
    for (const event of events) {
        if (event.type === "stage.view") {
            const stage = asStageEnum(dataOf(event).to);
            if (stage) reached.add(stage);
        }
        const stageField = asStageEnum(event.stage);
        if (stageField) reached.add(stageField);
        if (event.type === "export.download") reachedExport = true;
        if (event.type === "project.completed") completedProject = true;
    }
    return {
        reachedPath: reached.has("path"),
        reachedFoundry: reached.has("foundry"),
        reachedDesign: reached.has("design"),
        reachedBlueprint: reached.has("blueprint"),
        reachedAssembly: reached.has("assembly"),
        reachedExport,
        completedProject,
    };
};

// State-derived mechanism-type tally. Reads ONLY the chosen final state's
// mechanisms (the projection's latest authored state across contexts — see
// finalStateOfSession), so reconnects that re-snapshot earlier state never
// double-count. Returns {} when there is no final state (metrics profile).
export const mechanismTypeDistributionFromProjection = (
    projection: StudyReplayProjection,
): Record<string, number> => {
    const finalState = finalStateOfSession(projection);
    const mechanisms = (finalState?.mechanisms || []) as Array<Record<string, unknown>>;
    const counts: Record<string, number> = {};
    for (const mechanism of mechanisms) {
        const type = str(mechanism.type);
        if (type) tally(counts, type);
    }
    return counts;
};

export const validationCategoryCountsFromEvents = (
    events: readonly ReplayEvent[],
): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const event of events) {
        if (event.type !== "simulation.validation") continue;
        const category = str(dataOf(event).category) || "none";
        tally(counts, category);
    }
    return counts;
};

// The session's latest authored state: the projection's timeline is in stream
// (chronological) order across all contexts, so its last entry is the owning
// context's state after the chronologically final event — the most recent
// authored truth. Snapshot resets (reconnect resyncs) are intentional, so
// latest-by-stream-order is the correct single representative.
const finalStateOfSession = (projection: StudyReplayProjection): ReplayState | null => {
    const timeline = projection.timeline;
    return timeline.length ? (timeline[timeline.length - 1] ?? null) : null;
};

const EMPTY_DISTRIBUTION: Record<string, number> = {};

export const computeSessionMetrics = (input: SessionMetricsInput): SessionMetrics => {
    const { meta, events, losses, projection, firstT, lastT } = input;
    const contextCount = projection.contexts.length;

    // sessionActiveMs: prefer the pagehide terminal active duration; fall back
    // to the envelope-bounded event span.
    let sessionActiveMs: number | null = null;
    for (const event of events) {
        if (event.type === "session.pagehide") {
            const active = num(dataOf(event).activeMs);
            if (active != null) sessionActiveMs = active;
        }
    }
    if (sessionActiveMs == null && Number.isFinite(firstT) && Number.isFinite(lastT)) {
        sessionActiveMs = Math.max(0, lastT - firstT);
    }

    // Stage behavior.
    const stageVisits = stageVisitsFromEvents(events, sessionActiveMs);
    const stageDwellMs: Partial<Record<StageEnum, number>> = {};
    const stageReentryCounts: Partial<Record<StageEnum, number>> = {};
    const visitedInOrder: StageEnum[] = [];
    const seenStages = new Set<StageEnum>();
    for (const visit of stageVisits) {
        stageDwellMs[visit.stage] = (stageDwellMs[visit.stage] || 0) + visit.dwellMs;
        stageReentryCounts[visit.stage] = (stageReentryCounts[visit.stage] || 0) + 1;
        if (!seenStages.has(visit.stage)) {
            seenStages.add(visit.stage);
            visitedInOrder.push(visit.stage);
        }
    }
    let stageBlockedCount = 0;
    let stageOpenedCount = 0;
    const recoveryStageDistribution: Record<string, number> = {};
    for (const event of events) {
        if (event.type !== "stage.navigation") continue;
        stageOpenedCount += 1;
        const detail = dataOf(event);
        if (detail.outcome === "blocked") {
            stageBlockedCount += 1;
            const recovery = str(detail.recoveryStage);
            if (recovery) tally(recoveryStageDistribution, recovery);
        }
    }
    const funnel = completionFunnelFromEvents(events);
    const skippedStagesBeforeAssembly: StageEnum[] = funnel.reachedAssembly
        ? (["path", "foundry", "design", "blueprint"] as const).filter(
              (stage) => !seenStages.has(stage),
          )
        : [];

    // Mechanism + recommendation behavior.
    const mechanismTypesAccepted: string[] = [];
    let recommendationRequests = 0;
    let recommendationAccepts = 0;
    let recommendationDismisses = 0;
    const rankAtAcceptance: number[] = [];
    const candidateCountAtAcceptance: number[] = [];
    const considerationMs: number[] = [];
    let lastRequestTByContext: Record<string, number> = {};
    for (const event of events) {
        const detail = dataOf(event);
        const contextId = str(event.contextId) || "";
        if (event.type === "recommendation.request") {
            recommendationRequests += 1;
            lastRequestTByContext[contextId] = num(event.t) ?? lastRequestTByContext[contextId] ?? 0;
        } else if (event.type === "recommendation.accept") {
            recommendationAccepts += 1;
            const type = str(detail.mechanismType);
            if (type) mechanismTypesAccepted.push(type);
            const rank = num(detail.rank);
            if (rank != null) rankAtAcceptance.push(rank);
            const candidateCount = num(detail.candidateCount);
            if (candidateCount != null) candidateCountAtAcceptance.push(candidateCount);
            const requestT = lastRequestTByContext[contextId];
            if (requestT != null) considerationMs.push(Math.max(0, (num(event.t) ?? 0) - requestT));
        } else if (event.type === "recommendation.dismiss") {
            recommendationDismisses += 1;
            const requestT = lastRequestTByContext[contextId];
            if (requestT != null) considerationMs.push(Math.max(0, (num(event.t) ?? 0) - requestT));
        }
    }

    // Authoring effort + recovery.
    let totalActions = 0;
    let rejectedActions = 0;
    const actionFamilyCounts: Record<string, number> = {};
    let undoCount = 0;
    let redoCount = 0;
    let pathEditCount = 0;
    let skeletonEditCount = 0;
    let mechanismEditCount = 0;
    for (const event of events) {
        if (event.type !== "project.action") continue;
        totalActions += 1;
        const detail = dataOf(event);
        if (detail.applied === false) rejectedActions += 1;
        const actionType = str(detail.type) || "unknown";
        tally(actionFamilyCounts, actionFamilyOf(actionType));
        if (actionType === "upsert_path" || actionType === "delete_path") pathEditCount += 1;
        if (actionType === "add_joint" || actionType === "update_joint" || actionType === "remove_joint" || actionType === "set_skeleton") skeletonEditCount += 1;
        if (actionType === "upsert_mechanism" || actionType === "commit_mechanism_candidate" || actionType === "delete_mechanism" || actionType === "set_mechanisms") mechanismEditCount += 1;
        if (actionType === "redo") redoCount += 1;
    }
    for (const event of events) {
        if (event.type === "project.undo") undoCount += 1;
        if (event.type === "project.redo") redoCount += 1;
    }

    // Simulation / fabrication.
    let validationRuns = 0;
    let validationPasses = 0;
    const validationCategoryCounts = validationCategoryCountsFromEvents(events);
    const mechanismValidations: Record<string, { total: number; failed: number }> = {};
    let foundryPlaySessions = 0;
    let foundryPlaying = false;
    for (const event of events) {
        if (event.type === "simulation.validation") {
            validationRuns += 1;
            const detail = dataOf(event);
            const valid = detail.valid === true;
            if (valid) validationPasses += 1;
            const type = str(detail.type) || "unknown";
            if (!mechanismValidations[type]) mechanismValidations[type] = { total: 0, failed: 0 };
            mechanismValidations[type].total += 1;
            if (!valid) mechanismValidations[type].failed += 1;
        } else if (event.type === "simulation.foundry") {
            const state = str(dataOf(event).state);
            if (state === "playing" && !foundryPlaying) {
                foundryPlaySessions += 1;
                foundryPlaying = true;
            } else if (state && state !== "playing") {
                foundryPlaying = false;
            }
        }
    }
    const mechanismTypeValidationFailureRate: Record<string, number> = {};
    for (const [type, counts] of Object.entries(mechanismValidations)) {
        mechanismTypeValidationFailureRate[type] = counts.total ? counts.failed / counts.total : 0;
    }

    // UI / help / commands / gestures.
    const modalOpens: Record<string, number> = {};
    let helpOpens = 0;
    let helpCloses = 0;
    const commandRuns: Record<string, number> = {};
    let gestureCount = 0;
    let gestureDuration = 0;
    for (const event of events) {
        const detail = dataOf(event);
        if (event.type === "ui.modal") {
            const modal = str(detail.modal);
            if (modal) tally(modalOpens, modal);
        } else if (event.type === "help.context") {
            if (detail.action === "open") helpOpens += 1;
            else if (detail.action === "close") helpCloses += 1;
        } else if (event.type === "command.run") {
            const id = str(detail.id);
            if (id) tally(commandRuns, id);
        } else if (event.type === "ui.gesture") {
            gestureCount += 1;
            gestureDuration += num(detail.durationMs) ?? 0;
        }
    }

    // Technical context + assets + exports.
    const technicalStatusCounts: Record<string, number> = {};
    let technicalErrors = 0;
    let technicalContext: { browser: string; os: string; pointer: string; network: string } | null = null;
    let assetImports = 0;
    let assetOmitted = 0;
    const exportDownloads: Array<{ extension: string; mime: string; bytes: number }> = [];
    for (const event of events) {
        const detail = dataOf(event);
        if (event.type === "technical.status") {
            const code = str(detail.code) || "unknown";
            tally(technicalStatusCounts, code);
        } else if (event.type === "technical.error") {
            technicalErrors += 1;
        } else if (event.type === "asset.imported") {
            assetImports += 1;
        } else if (event.type === "asset.omitted") {
            assetOmitted += 1;
        } else if (event.type === "export.download") {
            exportDownloads.push({
                extension: str(detail.extension) || "",
                mime: str(detail.mime) || "",
                bytes: num(detail.bytes) ?? 0,
            });
        } else if (event.type === "session.start" && !technicalContext) {
            // First session.start wins: technical context is captured once at
            // session open (studyTechnicalContext in utils/studyTelemetry).
            const technical = detail.technical && typeof detail.technical === "object"
                ? (detail.technical as Record<string, unknown>)
                : {};
            const browser = str(technical.browser);
            const os = str(technical.os);
            const pointer = str(technical.pointer);
            const network = str(technical.network);
            if (browser || os || pointer || network) {
                technicalContext = {
                    browser: browser || "unknown",
                    os: os || "unknown",
                    pointer: pointer || "unknown",
                    network: network || "unknown",
                };
            }
        }
    }

    // Engagement pauses.
    let pauseCount = 0;
    let resumeCount = 0;
    let pauseMsLowerBound = 0;
    let openPauseT: number | null = null;
    for (const event of events) {
        if (event.type === "session.pause") {
            pauseCount += 1;
            openPauseT = num(event.t) ?? openPauseT;
        } else if (event.type === "session.resume") {
            resumeCount += 1;
            if (openPauseT != null) {
                pauseMsLowerBound += Math.max(0, (num(event.t) ?? openPauseT) - openPauseT);
                openPauseT = null;
            }
        }
    }

    // Projection-derived final state (single-projection-reuse rule).
    const finalState = finalStateOfSession(projection);
    const initialLessonId = readInitialLessonId(projection);
    const mechanisms = (finalState?.mechanisms || []) as Array<Record<string, unknown>>;
    const finalMechanismCount = finalState ? mechanisms.length : null;
    // warnings is scrubbed from snapshots (utils/studyTelemetryProject), so the
    // live "enabled && !warnings" rule degrades to enabled-only at replay depth.
    const finalValidMechanismCount = finalState
        ? mechanisms.filter((mechanism) => mechanism.enabled === true).length
        : null;
    const finalHasExport = finalState ? Boolean(finalState.exportSummary) : false;

    const incompleteSnapshots = losses.filter((loss) => loss.kind === "incomplete_snapshot").length;

    return {
        sessionId: meta.sessionId,
        deployment: meta.deployment,
        participantId: meta.participantId,
        classId: meta.classId,
        classSessionId: meta.classSessionId,
        teamId: meta.teamId,
        profile: meta.profile,
        sessionActiveMs,
        reconnectCount: meta.reconnectCount,
        contextCount,
        pauseCount,
        resumeCount,
        pauseMsLowerBound,
        stageVisits,
        stageDwellMs,
        stageVisitOrder: visitedInOrder,
        stagesVisited: [...seenStages],
        stageReentryCounts,
        stageBlockedCount,
        stageOpenedCount,
        stageNavigationBlockedRate: stageOpenedCount ? stageBlockedCount / stageOpenedCount : 0,
        recoveryStageDistribution,
        skippedStagesBeforeAssembly,
        reachedPath: funnel.reachedPath,
        reachedFoundry: funnel.reachedFoundry,
        reachedDesign: funnel.reachedDesign,
        reachedBlueprint: funnel.reachedBlueprint,
        reachedAssembly: funnel.reachedAssembly,
        reachedExport: funnel.reachedExport,
        completedProject: funnel.completedProject,
        mechanismTypesAccepted,
        mechanismTypeDistribution: finalState ? mechanismTypeDistributionFromProjection(projection) : EMPTY_DISTRIBUTION,
        recommendationRequests,
        recommendationAccepts,
        recommendationDismisses,
        recommendationAcceptRate: recommendationRequests ? recommendationAccepts / recommendationRequests : 0,
        recommendationDismissRate: recommendationRequests ? recommendationDismisses / recommendationRequests : 0,
        rankAtAcceptance,
        candidateCountAtAcceptance,
        recommendationConsiderationMs: considerationMs,
        totalActions,
        rejectedActions,
        rejectedActionRate: totalActions ? rejectedActions / totalActions : 0,
        actionFamilyCounts,
        undoCount,
        redoCount,
        undoToActionRatio: totalActions ? undoCount / totalActions : 0,
        pathEditCount,
        skeletonEditCount,
        mechanismEditCount,
        validationRuns,
        validationPassRate: validationRuns ? validationPasses / validationRuns : 0,
        validationCategoryCounts,
        mechanismTypeValidationFailureRate,
        foundryPlaySessions,
        modalOpens,
        helpOpens,
        helpCloseRate: helpOpens ? helpCloses / helpOpens : 0,
        commandRuns,
        gestureVolume: { count: gestureCount, totalDurationMs: gestureDuration },
        technicalStatusCounts,
        technicalErrors,
        technicalContext,
        assetImports,
        assetOmitted,
        exportDownloads,
        lossCount: losses.length,
        incompleteSnapshots,
        initialLessonId,
        finalMechanismCount,
        finalValidMechanismCount,
        finalHasExport,
    };
};

// The first snapshot's classroomLessonId, read from projection state. A session
// that never snapshotted (metrics profile) yields null — there is no authored
// state to read a lesson from.
const readInitialLessonId = (projection: StudyReplayProjection): string | null => {
    for (const context of projection.contexts) {
        const firstState = context.snapshots.find((state) => state != null);
        if (firstState) {
            const metadata = (firstState as { metadata?: Record<string, unknown> }).metadata;
            const lesson = metadata ? str(metadata.classroomLessonId) : null;
            if (lesson) return lesson;
        }
    }
    return null;
};

const addDistribution = (
    target: Record<string, number>,
    source: Record<string, number>,
): void => {
    for (const [key, value] of Object.entries(source)) {
        target[key] = (target[key] || 0) + value;
    }
};

export const aggregateSessionMetrics = (sessions: SessionMetrics[]): DeploymentAggregate => {
    const sessionCount = sessions.length;
    const completionFunnel: Record<string, number> = {
        path: 0,
        foundry: 0,
        design: 0,
        blueprint: 0,
        assembly: 0,
        export: 0,
        completed: 0,
    };
    const medianStageDwellMs: Partial<Record<StageEnum, number>> = {};
    const stageDwellSamples: Partial<Record<StageEnum, number[]>> = {};
    const mechanismTypeDistribution: Record<string, number> = {};
    const validationCategoryFrequency: Record<string, number> = {};
    const technicalStatusFrequency: Record<string, number> = {};
    const technicalContextDistribution = {
        browser: {} as Record<string, number>,
        os: {} as Record<string, number>,
        pointer: {} as Record<string, number>,
        network: {} as Record<string, number>,
    };
    const activeMsValues: number[] = [];
    const rankValues: number[] = [];
    const candidateValues: number[] = [];
    const rejectedRateValues: number[] = [];
    const undoValues: number[] = [];
    const redoValues: number[] = [];
    const validationPassRates: number[] = [];
    const considerationMsValues: number[] = [];
    let totalRequests = 0;
    let totalAccepts = 0;

    for (const session of sessions) {
        if (session.reachedPath) completionFunnel.path += 1;
        if (session.reachedFoundry) completionFunnel.foundry += 1;
        if (session.reachedDesign) completionFunnel.design += 1;
        if (session.reachedBlueprint) completionFunnel.blueprint += 1;
        if (session.reachedAssembly) completionFunnel.assembly += 1;
        if (session.reachedExport) completionFunnel.export += 1;
        if (session.completedProject) completionFunnel.completed += 1;
        for (const stage of STAGE_ENUMS) {
            const dwell = session.stageDwellMs[stage];
            if (dwell != null) {
                (stageDwellSamples[stage] ||= []).push(dwell);
            }
        }
        addDistribution(mechanismTypeDistribution, session.mechanismTypeDistribution);
        addDistribution(validationCategoryFrequency, session.validationCategoryCounts);
        addDistribution(technicalStatusFrequency, session.technicalStatusCounts);
        if (session.technicalContext) {
            tally(technicalContextDistribution.browser, session.technicalContext.browser);
            tally(technicalContextDistribution.os, session.technicalContext.os);
            tally(technicalContextDistribution.pointer, session.technicalContext.pointer);
            tally(technicalContextDistribution.network, session.technicalContext.network);
        }
        if (session.sessionActiveMs != null) activeMsValues.push(session.sessionActiveMs);
        rankValues.push(...session.rankAtAcceptance);
        candidateValues.push(...session.candidateCountAtAcceptance);
        if (session.totalActions) rejectedRateValues.push(session.rejectedActionRate);
        undoValues.push(session.undoCount);
        redoValues.push(session.redoCount);
        if (session.validationRuns) validationPassRates.push(session.validationPassRate);
        considerationMsValues.push(...session.recommendationConsiderationMs);
        totalRequests += session.recommendationRequests;
        totalAccepts += session.recommendationAccepts;
    }

    for (const stage of STAGE_ENUMS) {
        const samples = stageDwellSamples[stage];
        if (samples && samples.length) medianStageDwellMs[stage] = median(samples) ?? undefined;
    }

    return {
        sessionCount,
        completionFunnel,
        completionRate: sessionCount ? completionFunnel.export / sessionCount : 0,
        medianSessionActiveMs: median(activeMsValues),
        p25SessionActiveMs: quantile(activeMsValues, 0.25),
        p75SessionActiveMs: quantile(activeMsValues, 0.75),
        medianStageDwellMs,
        mechanismTypeDistribution,
        meanRankAtAcceptance: mean(rankValues),
        meanCandidateCountAtAcceptance: mean(candidateValues),
        medianRejectedActionRate: median(rejectedRateValues),
        medianUndoCount: median(undoValues),
        medianRedoCount: median(redoValues),
        validationCategoryFrequency,
        meanValidationPassRate: mean(validationPassRates),
        technicalStatusFrequency,
        technicalContextDistribution,
        recommendationAcceptRate: totalRequests ? totalAccepts / totalRequests : null,
        medianRecommendationConsiderationMs: median(considerationMsValues),
    };
};

const csvCell = (value: string | number | boolean | null | undefined): string => {
    if (value == null) return "";
    const text = typeof value === "string" ? value : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvPair = (
    row: Record<string, string | number | boolean>,
    key: string,
    value: string | number | boolean | null | undefined,
): void => {
    row[key] = value == null ? "" : value;
};

// Flat CSV row. Columns are deterministic; absent optionals serialize as "" so a
// metrics-profile session (no projection-derived fields) produces no holes.
export const sessionMetricsToCsvRow = (
    metrics: SessionMetrics,
): Record<string, string | number | boolean> => {
    const row: Record<string, string | number | boolean> = {};
    csvPair(row, "sessionId", metrics.sessionId);
    csvPair(row, "deployment", metrics.deployment);
    csvPair(row, "participantId", metrics.participantId);
    csvPair(row, "classId", metrics.classId);
    csvPair(row, "classSessionId", metrics.classSessionId);
    csvPair(row, "teamId", metrics.teamId);
    csvPair(row, "profile", metrics.profile);
    csvPair(row, "sessionActiveMs", metrics.sessionActiveMs);
    csvPair(row, "reconnectCount", metrics.reconnectCount);
    csvPair(row, "contextCount", metrics.contextCount);
    csvPair(row, "pauseCount", metrics.pauseCount);
    csvPair(row, "resumeCount", metrics.resumeCount);
    csvPair(row, "pauseMsLowerBound", metrics.pauseMsLowerBound);
    csvPair(row, "stageVisitOrder", metrics.stageVisitOrder.join(">"));
    csvPair(row, "stagesVisited", metrics.stagesVisited.join("|"));
    csvPair(row, "stageNavigationBlockedRate", round4(metrics.stageNavigationBlockedRate));
    csvPair(row, "skippedStagesBeforeAssembly", metrics.skippedStagesBeforeAssembly.join("|"));
    for (const stage of STAGE_ENUMS) {
        csvPair(row, `stageDwellMs.${stage}`, metrics.stageDwellMs[stage] ?? null);
    }
    csvPair(row, "reachedPath", metrics.reachedPath);
    csvPair(row, "reachedFoundry", metrics.reachedFoundry);
    csvPair(row, "reachedDesign", metrics.reachedDesign);
    csvPair(row, "reachedBlueprint", metrics.reachedBlueprint);
    csvPair(row, "reachedAssembly", metrics.reachedAssembly);
    csvPair(row, "reachedExport", metrics.reachedExport);
    csvPair(row, "completedProject", metrics.completedProject);
    csvPair(row, "mechanismTypesAccepted", metrics.mechanismTypesAccepted.join("|"));
    csvPair(row, "mechanismTypeDistribution", formatDistribution(metrics.mechanismTypeDistribution));
    csvPair(row, "recommendationRequests", metrics.recommendationRequests);
    csvPair(row, "recommendationAccepts", metrics.recommendationAccepts);
    csvPair(row, "recommendationDismisses", metrics.recommendationDismisses);
    csvPair(row, "recommendationAcceptRate", round4(metrics.recommendationAcceptRate));
    csvPair(row, "recommendationDismissRate", round4(metrics.recommendationDismissRate));
    csvPair(row, "rankAtAcceptance", metrics.rankAtAcceptance.join("|") || "");
    csvPair(row, "candidateCountAtAcceptance", metrics.candidateCountAtAcceptance.join("|") || "");
    csvPair(row, "recommendationConsiderationMs", metrics.recommendationConsiderationMs.join("|") || "");
    csvPair(row, "totalActions", metrics.totalActions);
    csvPair(row, "rejectedActions", metrics.rejectedActions);
    csvPair(row, "rejectedActionRate", round4(metrics.rejectedActionRate));
    csvPair(row, "actionFamilyCounts", formatDistribution(metrics.actionFamilyCounts));
    csvPair(row, "undoCount", metrics.undoCount);
    csvPair(row, "redoCount", metrics.redoCount);
    csvPair(row, "undoToActionRatio", round4(metrics.undoToActionRatio));
    csvPair(row, "pathEditCount", metrics.pathEditCount);
    csvPair(row, "skeletonEditCount", metrics.skeletonEditCount);
    csvPair(row, "mechanismEditCount", metrics.mechanismEditCount);
    csvPair(row, "validationRuns", metrics.validationRuns);
    csvPair(row, "validationPassRate", round4(metrics.validationPassRate));
    csvPair(row, "validationCategoryCounts", formatDistribution(metrics.validationCategoryCounts));
    csvPair(row, "foundryPlaySessions", metrics.foundryPlaySessions);
    csvPair(row, "modalOpens", formatDistribution(metrics.modalOpens));
    csvPair(row, "helpOpens", metrics.helpOpens);
    csvPair(row, "helpCloseRate", round4(metrics.helpCloseRate));
    csvPair(row, "commandRuns", formatDistribution(metrics.commandRuns));
    csvPair(row, "gestureCount", metrics.gestureVolume.count);
    csvPair(row, "gestureTotalDurationMs", metrics.gestureVolume.totalDurationMs);
    csvPair(row, "technicalStatusCounts", formatDistribution(metrics.technicalStatusCounts));
    csvPair(row, "technicalErrors", metrics.technicalErrors);
    csvPair(row, "assetImports", metrics.assetImports);
    csvPair(row, "assetOmitted", metrics.assetOmitted);
    csvPair(row, "exportDownloadCount", metrics.exportDownloads.length);
    csvPair(row, "exportDownloadBytes", sum(metrics.exportDownloads.map((item) => item.bytes)));
    csvPair(row, "lossCount", metrics.lossCount);
    csvPair(row, "incompleteSnapshots", metrics.incompleteSnapshots);
    csvPair(row, "initialLessonId", metrics.initialLessonId);
    csvPair(row, "finalMechanismCount", metrics.finalMechanismCount);
    csvPair(row, "finalValidMechanismCount", metrics.finalValidMechanismCount);
    csvPair(row, "finalHasExport", metrics.finalHasExport);
    return row;
};

export const deploymentMetricsToCsvRows = (
    sessions: SessionMetrics[],
): Array<Record<string, string | number | boolean>> =>
    sessions.map(sessionMetricsToCsvRow);

const formatDistribution = (distribution: Record<string, number>): string =>
    Object.entries(distribution)
        .map(([key, value]) => `${key}:${value}`)
        .join("|");

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

// CSV serialization with a deterministic header order. The header is the union
// of every row's keys, in first-seen order, so adding a metric does not
// silently reorder existing columns.
export const toCsv = (rows: Array<Record<string, string | number | boolean>>): string => {
    const headers: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!headers.includes(key)) headers.push(key);
        }
    }
    const escape = (value: string | number | boolean): string => csvCell(value);
    const lines = [headers.join(",")];
    for (const row of rows) {
        lines.push(headers.map((header) => escape(row[header] ?? "")).join(","));
    }
    return `${lines.join("\n")}\n`;
};

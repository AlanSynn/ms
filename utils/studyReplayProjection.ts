// Canonical study-replay projection. The single source of truth for how raw
// telemetry records fold back into authored project state. The browser replay
// HTML (scripts/study-replay.ts) and Node-side analysis both ultimately follow
// this logic; tests pin applyReplayAction to the real applyProjectAction so the
// port cannot silently drift.
//
// Two responsibilities, kept separate:
//   reassembleStudyEvents  — chunked-snapshot reassembly + loss surfacing
//   projectStudyReplayState — per-context state fold (snapshot reset, action
//                             apply, undo/redo) over already-reassembled events

export type ReplayPoint = { x: number; y: number };

export type ReplayState = {
    parts?: Record<string, unknown>;
    partOrder?: string[];
    sceneObjects?: Record<string, unknown>;
    sceneObjectOrder?: string[];
    paths?: Record<string, unknown>;
    mechanisms?: unknown[];
    skeleton?: Record<string, unknown> | null;
    settings?: Record<string, unknown>;
    processing?: unknown;
    lastExport?: unknown;
    selectedPartId?: string;
    selectedSceneObjectId?: string;
    selectedPathId?: string;
    selectedMechanismId?: string;
    [key: string]: unknown;
};

export type ReplayAction = {
    type: string;
    applied?: boolean;
    [key: string]: unknown;
};

export type ReplayEvent = {
    type: string;
    t?: number;
    seq?: number;
    contextId?: string;
    stage?: string;
    data?: unknown;
    [key: string]: unknown;
};

export type ReassembleLoss = {
    kind: string;
    contextId: string;
    snapshotId: string;
    reason?: string;
    total?: number;
    missing?: number[];
};

export type ReassembleResult = {
    events: ReplayEvent[];
    losses: ReassembleLoss[];
};

export type StudyReplayContext = {
    contextId: string;
    finalState: ReplayState | null;
    /** State after each event this context owns (null until the first snapshot). */
    snapshots: Array<ReplayState | null>;
};

export type StudyReplayProjection = {
    contexts: StudyReplayContext[];
    /**
     * State after each event in stream order across ALL contexts (the value is
     * the owning context's state at that event). Matches the browser slider's
     * cross-context timeline exactly.
     */
    timeline: Array<ReplayState | null>;
};

const replayValues = (value: unknown): unknown[] =>
    value && typeof value === "object" ? Object.values(value as Record<string, unknown>) : [];

const replayPoint = (value: unknown): ReplayPoint | null => {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { x?: unknown; y?: unknown };
    return Number.isFinite(candidate.x as number) && Number.isFinite(candidate.y as number)
        ? { x: candidate.x as number, y: candidate.y as number }
        : null;
};

const replayWithout = (object: Record<string, unknown> | undefined, id: string): Record<string, unknown> => {
    const next = { ...(object || {}) };
    delete next[id];
    return next;
};

// Mirrors the skeleton rebuild done by the real reducer so joint add/update/
// remove stay consistent under replay. Bones, root ids, hierarchy and the
// name->id map are derived purely from the joint set.
const rebuildReplaySkeleton = (
    previous: Record<string, unknown> | null | undefined,
    joints: Record<string, { id: string; name?: string; parentId?: string }>,
): Record<string, unknown> => {
    const bones: Array<[string, string]> = [];
    const rootJointIds: string[] = [];
    const hierarchy: Record<string, string[]> = {};
    const jointMap: Record<string, string> = {};
    for (const joint of Object.values(joints)) {
        if (joint.parentId && joints[joint.parentId]) {
            bones.push([joint.parentId, joint.id]);
            (hierarchy[joint.parentId] ||= []).push(joint.id);
        } else {
            rootJointIds.push(joint.id);
        }
        jointMap[String(joint.name || joint.id).replaceAll(" ", "_")] = joint.id;
    }
    return {
        ...(previous || {}),
        joints,
        bones,
        rootJointIds,
        hierarchy,
        jointMap,
        metadata: (previous && previous.metadata) || {},
    };
};

// Pure reducer. This is a verbatim TypeScript port of the reducer inlined in
// scripts/study-replay.ts; the replay-fidelity test reads that inlined source
// straight from the script and diffs it against the real applyProjectAction, so
// the two must stay byte-for-byte equivalent in behavior. Guard failures return
// the SAME state reference — projectStudyReplayState uses that (plus the
// applied flag) to detect no-ops.
export const applyReplayAction = (
    state: ReplayState | null,
    action: ReplayAction | null | undefined,
): ReplayState | null => {
    if (!state || !action || typeof action !== "object") return state;
    const parts = (state.parts || {}) as Record<string, Record<string, unknown> & { id?: string }>;
    const objects = (state.sceneObjects || {}) as Record<string, Record<string, unknown> & { id?: string }>;
    const paths = (state.paths || {}) as Record<string, Record<string, unknown> & { id?: string; partId?: string; sceneObjectId?: string }>;
    const mechanisms = (state.mechanisms || []) as Array<Record<string, unknown> & { id?: string }>;
    const partOrder = (state.partOrder || []) as string[];
    const sceneObjectOrder = (state.sceneObjectOrder || []) as string[];
    switch (action.type) {
        case "set_processing":
            return { ...state, processing: action.processing };
        case "select_part": {
            const path = replayValues(paths).find((item) => {
                const p = item as Record<string, unknown>;
                return !p.sceneObjectId && p.partId === action.partId;
            }) as Record<string, unknown> | undefined;
            return { ...state, selectedPartId: action.partId as string, selectedSceneObjectId: undefined, selectedPathId: path && (path.id as string) };
        }
        case "select_scene_object": {
            const path = replayValues(paths).find((item) => {
                const p = item as Record<string, unknown>;
                return p.sceneObjectId === action.objectId;
            }) as Record<string, unknown> | undefined;
            return {
                ...state,
                selectedSceneObjectId: action.objectId as string,
                selectedPartId: action.objectId ? undefined : state.selectedPartId,
                selectedPathId: path && (path.id as string),
            };
        }
        case "upsert_part": {
            const part = action.part as ({ id?: string } & Record<string, unknown>) | undefined;
            if (!part || !part.id) return state;
            return {
                ...state,
                parts: { ...parts, [part.id]: part },
                partOrder: parts[part.id] ? partOrder : [...partOrder, part.id],
                selectedPartId: part.id,
                selectedSceneObjectId: undefined,
            };
        }
        case "update_part": {
            const existing = parts[action.partId as string];
            if (!existing) return state;
            return { ...state, parts: { ...parts, [action.partId as string]: { ...existing, ...((action.updates as object) || {}) } } };
        }
        case "delete_part": {
            const removedPaths = Object.fromEntries(
                Object.entries(paths).filter(([, path]) => path.sceneObjectId || path.partId !== (action.partId as string)),
            );
            return {
                ...state,
                parts: replayWithout(parts, action.partId as string),
                partOrder: partOrder.filter((id) => id !== (action.partId as string)),
                paths: removedPaths,
                selectedPartId: state.selectedPartId === action.partId ? partOrder.find((id) => id !== (action.partId as string)) : state.selectedPartId,
                selectedPathId: removedPaths[state.selectedPathId as string] ? state.selectedPathId : undefined,
            };
        }
        case "reorder_part": {
            const order = [...partOrder];
            const from = order.indexOf(action.partId as string);
            const to = from + Number(action.direction);
            if (from < 0 || to < 0 || to >= order.length) return state;
            [order[from], order[to]] = [order[to], order[from]];
            return { ...state, partOrder: order };
        }
        case "upsert_scene_object": {
            const object = action.object as ({ id?: string } & Record<string, unknown>) | undefined;
            if (!object || !object.id) return state;
            return {
                ...state,
                sceneObjects: { ...objects, [object.id]: object },
                sceneObjectOrder: objects[object.id] ? sceneObjectOrder : [...sceneObjectOrder, object.id],
                selectedSceneObjectId: object.id,
                selectedPartId: undefined,
            };
        }
        case "update_scene_object": {
            const existing = objects[action.objectId as string];
            if (!existing) return state;
            return { ...state, sceneObjects: { ...objects, [action.objectId as string]: { ...existing, ...((action.updates as object) || {}) } } };
        }
        case "delete_scene_object": {
            const remainingPaths = Object.fromEntries(
                Object.entries(paths).filter(([, path]) => path.sceneObjectId !== (action.objectId as string)),
            );
            return {
                ...state,
                sceneObjects: replayWithout(objects, action.objectId as string),
                sceneObjectOrder: sceneObjectOrder.filter((id) => id !== (action.objectId as string)),
                paths: remainingPaths,
                selectedSceneObjectId: state.selectedSceneObjectId === action.objectId ? undefined : state.selectedSceneObjectId,
                selectedPathId: remainingPaths[state.selectedPathId as string] ? state.selectedPathId : undefined,
            };
        }
        case "set_skeleton":
            return { ...state, skeleton: action.skeleton as ReplayState["skeleton"] };
        case "update_joint": {
            const skeleton = state.skeleton as { joints?: Record<string, { id: string; name?: string; parentId?: string }> } | null | undefined;
            if (!skeleton || !skeleton.joints || !skeleton.joints[action.jointId as string]) return state;
            return {
                ...state,
                skeleton: rebuildReplaySkeleton(skeleton, {
                    ...skeleton.joints,
                    [action.jointId as string]: { ...skeleton.joints[action.jointId as string], ...((action.updates as object) || {}) },
                }),
            };
        }
        case "add_joint": {
            const skeleton = state.skeleton as { joints?: Record<string, { id: string; name?: string; parentId?: string }> } | null | undefined;
            const joint = action.joint as ({ id?: string } & { id: string; name?: string; parentId?: string }) | undefined;
            if (!joint || !joint.id) return state;
            return {
                ...state,
                skeleton: rebuildReplaySkeleton(skeleton, { ...((skeleton && skeleton.joints) || {}), [joint.id]: joint }),
            };
        }
        case "remove_joint": {
            const skeleton = state.skeleton as { joints?: Record<string, { id: string; parentId?: string; name?: string }> } | null | undefined;
            if (!skeleton) return state;
            const remove = new Set<string>([action.jointId as string]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const joint of Object.values(skeleton.joints || {})) {
                    if (joint.parentId && remove.has(joint.parentId) && !remove.has(joint.id)) {
                        remove.add(joint.id);
                        changed = true;
                    }
                }
            }
            return {
                ...state,
                skeleton: rebuildReplaySkeleton(
                    skeleton,
                    Object.fromEntries(Object.entries(skeleton.joints || {}).filter(([id]) => !remove.has(id))) as Record<string, { id: string; name?: string; parentId?: string }>,
                ),
            };
        }
        case "upsert_path": {
            const path = action.path as ({ id?: string } & Record<string, unknown>) | undefined;
            if (!path || !path.id) return state;
            return { ...state, paths: { ...paths, [path.id]: path }, selectedPathId: path.id };
        }
        case "delete_path":
            return {
                ...state,
                paths: replayWithout(paths, action.pathId as string),
                selectedPathId: state.selectedPathId === action.pathId ? undefined : state.selectedPathId,
            };
        case "set_mechanisms":
            return {
                ...state,
                mechanisms: Array.isArray(action.mechanisms) ? (action.mechanisms as unknown[]) : mechanisms,
                selectedMechanismId: (action.selectedMechanismId as string) || state.selectedMechanismId,
            };
        case "upsert_mechanism": {
            const mechanism = action.mechanism as ({ id?: string } & Record<string, unknown>) | undefined;
            if (!mechanism || !mechanism.id) return state;
            const replacedId = action.replaceMechanismId as string | undefined;
            const replaced = replacedId ? mechanisms.find((item) => item.id === replacedId) : undefined;
            const resolved = replaced ? { ...mechanism, id: replaced.id } : mechanism;
            const exists = mechanisms.some((item) => item.id === resolved.id);
            return {
                ...state,
                mechanisms: exists ? mechanisms.map((item) => (item.id === resolved.id ? resolved : item)) : [...mechanisms, resolved],
                selectedMechanismId: resolved.id,
            };
        }
        case "commit_mechanism_candidate": {
            const result = action.result as { status?: string; mechanism?: ({ id?: string } & Record<string, unknown>) | undefined } | undefined;
            const mechanism = result && result.status !== "blocked" ? result.mechanism : undefined;
            if (!mechanism || !mechanism.id) return state;
            const exists = mechanisms.some((item) => item.id === mechanism.id);
            return {
                ...state,
                mechanisms: exists ? mechanisms.map((item) => (item.id === mechanism.id ? mechanism : item)) : [...mechanisms, mechanism],
                selectedMechanismId: mechanism.id,
            };
        }
        case "delete_mechanism":
            return {
                ...state,
                mechanisms: mechanisms.filter((item) => item.id !== (action.mechanismId as string)),
                selectedMechanismId: state.selectedMechanismId === action.mechanismId ? undefined : state.selectedMechanismId,
            };
        case "update_settings": {
            const incoming = (action.settings as Record<string, unknown>) || {};
            const priorSettings = (state.settings as Record<string, unknown>) || {};
            const priorKit = (priorSettings.physicalKit as Record<string, unknown>) || {};
            const incomingKit = (incoming.physicalKit as Record<string, unknown>) || {};
            return {
                ...state,
                settings: { ...priorSettings, ...incoming, physicalKit: { ...priorKit, ...incomingKit } },
            };
        }
        case "set_export":
            return { ...state, lastExport: action.fabricationPackage };
        default:
            return state;
    }
};

// Reassemble chunked snapshots into single project.snapshot events and surface
// data-loss (incomplete chunk sets, orphan chunks whose begin was lost) instead
// of silently bridging it. Pure port of the pipeline that lived inlined in
// scripts/study-replay.ts.
export const reassembleStudyEvents = (rawEvents: readonly ReplayEvent[]): ReassembleResult => {
    const chunked = new Map<string, { reason: string; total: number; chunks: Array<Uint8Array | undefined> }>();
    const orphanChunks = new Set<string>();
    const events: ReplayEvent[] = [];
    for (const event of rawEvents) {
        const data = event.data as Record<string, unknown> | undefined;
        if (event.type === "project.snapshot.begin" && data && typeof data.snapshotId === "string" && Number.isSafeInteger(data.total)) {
            chunked.set(`${event.contextId ?? ""}\0${data.snapshotId}`, {
                reason: typeof data.reason === "string" ? data.reason : "chunked",
                total: Number(data.total),
                chunks: Array.from({ length: Number(data.total) }),
            });
            continue;
        }
        if (event.type === "project.snapshot.chunk" && data && typeof data.snapshotId === "string" && Array.isArray(data.parts)) {
            const chunkKey = `${event.contextId ?? ""}\0${data.snapshotId}`;
            const pending = chunked.get(chunkKey);
            const index = Number(data.index);
            if (!pending) {
                orphanChunks.add(chunkKey);
                continue;
            }
            if (!Number.isSafeInteger(index) || index < 0 || index >= pending.total) continue;
            pending.chunks[index] = Buffer.from((data.parts as string[]).join(""), "base64url");
            if (pending.chunks.every(Boolean)) {
                try {
                    const state = JSON.parse(Buffer.concat(pending.chunks as Uint8Array[]).toString("utf8"));
                    events.push({ ...event, type: "project.snapshot", data: { reason: pending.reason, state } });
                } catch {
                    // Corrupt/incomplete research records do not block the rest of a replay.
                }
                chunked.delete(chunkKey);
            }
            continue;
        }
        events.push(event);
    }

    const losses: ReassembleLoss[] = [];
    for (const [key, pending] of chunked) {
        const [contextId, snapshotId] = key.split("\0");
        const missing = pending.chunks
            .map((chunk, idx) => (chunk ? null : idx))
            .filter((idx): idx is number => idx !== null);
        losses.push({ kind: "incomplete_snapshot", contextId, snapshotId, reason: pending.reason, total: pending.total, missing });
    }
    for (const key of orphanChunks) {
        if (chunked.has(key)) continue;
        const [contextId, snapshotId] = key.split("\0");
        losses.push({ kind: "orphan_chunk_no_begin", contextId, snapshotId });
    }
    return { events, losses };
};

// Fold already-reassembled events into per-context authored state. Mirrors the
// browser replay slider's fold loop. Undo/redo follow the real reducer's
// undoable-action set; select_part/set_processing/set_export are transient and
// do not enter the undo stack.
//
// Rejected actions (project.action with applied:false, recorded since the
// rejected-action fix) are trusted and skipped ENTIRELY: they neither mutate
// state nor reset the redo stack. Pre-fix records carry no flag and fall back to
// the reducer's reference-inequality no-op detection — but those records still
// reset the redo stack only when they actually change state, matching the
// corrected semantics.
export const projectStudyReplayState = (events: readonly ReplayEvent[]): StudyReplayProjection => {
    const views: Record<string, { state: ReplayState | null; past: ReplayState[]; future: ReplayState[] }> = {};
    const perContext: Record<string, StudyReplayContext> = {};
    const timeline: Array<ReplayState | null> = [];
    const undoableDeny = new Set(["set_processing", "select_part", "set_export"]);

    for (const event of events) {
        const contextId = String(event.contextId || "unknown");
        let view = views[contextId];
        if (!view) {
            view = { state: null, past: [], future: [] };
            views[contextId] = view;
            perContext[contextId] = { contextId, finalState: null, snapshots: [] };
        }
        const data = event.data as Record<string, unknown> | undefined;

        if (event.type === "project.snapshot" && data && data.state) {
            view.state = data.state as ReplayState;
            view.past = [];
            view.future = [];
        } else if (event.type === "project.action" && view.state) {
            const action = (data ?? {}) as ReplayAction;
            const flaggedApplied = action.applied !== false;
            const next = flaggedApplied ? applyReplayAction(view.state, action) : view.state;
            // Reference inequality detects both explicit rejects (applied:false,
            // next === state by construction) and pre-flag guard no-ops. Only a
            // real state change advances state and clears the redo stack — so a
            // rejected edit can no longer silently wipe a pending redo.
            if (next !== view.state) {
                if (!undoableDeny.has(action.type)) view.past = [...view.past.slice(-79), view.state];
                view.state = next;
                view.future = [];
            }
        } else if (event.type === "project.undo" && view.past.length) {
            const previous = view.past[view.past.length - 1];
            view.past = view.past.slice(0, -1);
            view.future = [view.state as ReplayState, ...view.future].slice(0, 80);
            view.state = previous;
        } else if (event.type === "project.redo" && view.future.length) {
            const next = view.future[0];
            view.future = view.future.slice(1);
            view.past = [...view.past.slice(-79), view.state as ReplayState];
            view.state = next;
        }

        perContext[contextId].snapshots.push(view.state);
        timeline.push(view.state);
    }

    const contexts = Object.values(perContext).map((ctx) => {
        const view = views[ctx.contextId];
        return { contextId: ctx.contextId, finalState: view ? view.state : null, snapshots: ctx.snapshots };
    });
    return { contexts, timeline };
};

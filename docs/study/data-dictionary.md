# Study Telemetry Data Dictionary

Last refreshed: 2026-07-17 · Schema versions: `motionsmith-study-event-v1`, `motionsmith-study-snapshot-v1`

The canonical field reference for everything MotionSmith can emit to the
`/ms-study/v1` Worker. Every field below is either an enum, a bounded number, a
boolean, or an opaque alias — there is no free-text student content, no
per-frame pose data, no image pixels (except normalized compact source assets
under the `study` profile), no error text or stack trace. If a field is not in
this dictionary, it is not emitted.

Pinned by `tests/study-telemetry.test.ts` (ingestion + identity guard + replay
projection) and `tests/project-contract.test.ts` (reducer fidelity). Change the
schema → bump the schema version constant → the Worker rejects old envelopes.

## Pipeline (two-layer PII control)

```
recordStudyEvent ──scrubStudyValue──▶ buffer ──▶ /batch ──▶ Worker validStudyData ──▶ R2
```

1. **Client scrub** (`scrubStudyValue`, `utils/studyTelemetryProject.ts:117`).
   Applied to every record's `data` before buffering
   (`utils/studyTelemetry.ts:212`):
   - drops keys in `PRIVATE_KEYS` and any key ending in `Url|Filename|Name|Label`
     or matching `PRIVATE_TEXT_KEYS` (`title|instruction|description|actual|
     expected|summary|steps|note|comment|text`);
   - keeps booleans; keeps finite numbers; drops non-finite numbers;
   - runs strings through `safeString` (≤256 chars, no newlines, rejects
     `data:|blob:|file:|https?:` schemes and email/phone-shaped values);
   - truncates arrays/objects to 4096 entries, depth ≤ 24.
2. **Server guard** (`validStudyData`, `infrastructure/study/worker.js`).
   Re-validates on ingest with the same rules plus a 9+-decimal-digit / email
   identity pattern on both values AND object keys. Any violation rejects the
   **whole batch** (400). Entity ids are aliased (`ent_<4hex>_<4hex>_<4hex>_<4hex>`,
   grouped blocks) so hex digests cannot read as phone numbers.

## Envelope (batch wrapper)

Posted to `/ms-study/v1/batch`. All `*Id` fields must match `SAFE_ID`
(`/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/`).

| field | type | notes |
|---|---|---|
| `v` | const `1` | envelope version |
| `eventSchema` | const `motionsmith-study-event-v1` | |
| `snapshotSchema` | const `motionsmith-study-snapshot-v1` | |
| `batchId` | id | UUID-shaped, idempotency key |
| `deployment` | id | git release tag (e.g. `v0.0.10`); R2 partition |
| `appVersion` | id | `package.json` version |
| `buildSha` | id | 40-char commit sha |
| `profile` | enum `metrics|replay|study` | capture ceiling |
| `classId` `classSessionId` `teamId` `participantId` | id | pseudonymous study grouping |
| `sessionId` `contextId` | id | replay partition (context = one connected window) |
| `sessionCount` `reconnectCount` | int ≥ 1 | |
| `records[]` | array ≤ 200 | see Record below |

## Record

| field | type | notes |
|---|---|---|
| `seq` | int ≥ 1 | per-context monotonic |
| `t` | int ≥ 0 | ms since context start |
| `type` | code (`SAFE_CODE`, ≤80 chars, `[A-Za-z0-9._-]`) | event type, see catalog |
| `stage` | enum `character|path|foundry|design|blueprint|assembly|options` | optional |
| `project` | id (project alias) | optional |
| `data` | object | scrubbed; shape per event type |

## Capture profiles (what each ceiling emits)

| profile | includes |
|---|---|
| `off` | nothing |
| `metrics` | counts, durations, enum states, recommendation picks — no authored edits, no snapshots, no images |
| `replay` | adds `project.action`, `project.snapshot` (chunked), `project.undo/redo/replace`, viewport, ui.activate/change, foundry/assembly state |
| `study` | adds `ui.gesture` (pointer drags) and normalized compact source images (`asset.imported`) |

## Event catalog

Levels: **M** = metrics, **R** = replay, **S** = study.

### Session + network
| type | level | fields | source |
|---|---|---|---|
| `session.start` | M | `participantId,classId,classSessionId,teamId,sessionCount,reconnectCount,technical{...},project{...}` — see sub-shapes below | `utils/studyTelemetry.ts:939` |

`session.start.technical` (`studyTechnicalContext`, `utils/studyTelemetry.ts:899`)
is coarse-bucketed, not a fingerprint: `browser:enum(edge,chrome,firefox,safari,other)`,
`browserMajor:int`, `os:enum(chromeos,windows,macos,android,ios,linux,other)`,
`viewport:[w,h]` rounded to 32 px, `screen:[w,h]` rounded to 64 px, `dpr:number`
rounded to 0.25, `pointer:enum(coarse,fine)`, `network:enum(2g,3g,4g,slow-2g,unknown)`,
`saveData:bool`, `loadMs:int` rounded to 100 ms, `memoryGb:int` capped at 8.
`session.start.project` (`studyProjectCounts`, `utils/studyTelemetryProject.ts:263`):
`parts,objects,paths,mechanisms,validMechanisms,hasSkeleton,hasExport`.
| `session.pause` | M | `activeMs:int` | `hooks/useStudyTelemetry.ts:272` |
| `session.resume` | M | — | `hooks/useStudyTelemetry.ts:277` |
| `session.pagehide` | M | `activeMs:int,completed:bool,parts:int,objects:int,paths:int,mechanisms:int` | `hooks/useStudyTelemetry.ts:286` |
| `network.state` | M | `state:enum(online,offline)` | `hooks/useStudyTelemetry.ts:261,265` |

### Stage + navigation
| type | level | fields | source |
|---|---|---|---|
| `stage.view` | M | `from:stage,to:stage,dwellMs:int` | `utils/studyTelemetry.ts:237` |
| `stage.navigation` | M | `target:stage,outcome:enum(blocked,opened),recoveryStage?:stage` | `utils/appStageNavigation.ts:41,59` |

### Project authoring (replay-reconstructable)
| type | level | fields | source |
|---|---|---|---|
| `project.action` | R | `{...scrubbedAction, applied:bool}` — `applied:false` marks a guard-rejected edit (replay skips it) | `utils/studyTelemetry.ts:250` |
| `project.undo` `project.redo` | R | — | `hooks/useProjectHistory.ts:89,104` |
| `project.replace` | R | `history:bool?,resetHistory:bool?` | `utils/studyTelemetry.ts:277` |
| `project.snapshot` | R | `reason,snapshotSchema,state` (or chunked, below) | `utils/studyTelemetryProject.ts:226` |
| `project.snapshot.begin` | R | `snapshotId,reason,snapshotSchema,total:int` | chunked split |
| `project.snapshot.chunk` | R | `snapshotId,index:int,total:int,encoding:"base64url-json",parts:string[]` | chunked split |
| `project.completed` | M | `recipes:int,validationIssues:int` | `hooks/useStudyTelemetry.ts:130` |

`project.snapshot` is emitted when the scrubbed state ≤ 240 KB; otherwise it
splits into `begin` + N `chunk` records (≤ 400 KB each) that the replay
projection reassembles (`reassembleStudyEvents`, `utils/studyReplayProjection.ts`).

### Mechanism + simulation + recommendation
| type | level | fields | source |
|---|---|---|---|
| `simulation.foundry` | M | `state:enum(playing,stopped),mechanismType,valid:bool,driveEnabled:bool` | `MechanismFoundry.tsx:1054` |
| `simulation.validation` | M (coalesce `foundry-validation`) | `mechanismType,valid:bool,warning:bool,transaction,category:enum` | `MechanismFoundry.tsx:1066` |
| `simulation.playback` | M | `state:enum(playing,stopped),mechanismCount:int` | `hooks/useStudyTelemetry.ts:159` |
| `simulation.trace` | M | `visible:bool` | `hooks/useMotionSmithAppController.ts:327` |
| `foundry.state` | R (coalesce `foundry-state`) | `mechanism:MechanismConfig` (scrubbed) | `hooks/useMotionSmithAppController.ts:306` |
| `path.draw_mode` | M | `active:bool` | `hooks/useMotionSmithAppController.ts:313` |
| `assembly.state` | R (coalesce `assembly-state`) | `step:int,playing:bool` | `hooks/useMotionSmithAppController.ts:320` |
| `recommendation.request` | M | — | `hooks/useMotionSmithAppController.ts:396` |
| `recommendation.candidates` | M | `candidates:[{type,score:number,blocked:bool,reasonKey:enum}]` | `MechanismRecommendationSheet.tsx:150` |
| `recommendation.accept` | M | `mechanismType,presetId,rank:int,score:number,candidateCount:int` | `MechanismRecommendationSheet.tsx:166` |
| `recommendation.dismiss` | M | — | `hooks/useMotionSmithAppController.ts:449` |

`simulation.validation.category` enum: `feasibility|collision|geometry|connection|constraint|none`
(classified from the foundry blocker / motion warning by
`fabricationDiagnosticCategory`, `utils/fabricationReadiness.ts`).
`recommendation.candidates[].reasonKey` enum: `arc_limb|push_pull|lift|gear_crank|reverse_rotation|compact_loop|blocked|other`
(`recommendationReasonKey`, `utils/mechanismRecommendations.ts`).
`transaction` is the foundry commit-transaction status (bounded by the foundry
state machine; emitted as a short code, not free text).

### UI + interaction
| type | level | fields | source |
|---|---|---|---|
| `ui.modal` | M (coalesce `modal`) | `modal:enum(getting_started,shortcuts,about,recommendations,tracking,none)` | `hooks/useStudyTelemetry.ts:189` |
| `ui.activate` `ui.change` | R | `control` (stable control code, not label text) | `hooks/useStudyTelemetry.ts:197,201` |
| `ui.gesture` | S | `control,outcome:enum(complete,cancel),dx:int,dy:int,durationMs:int` | `hooks/useStudyTelemetry.ts:216` |
| `view.viewport` | R (coalesce `viewport`) | `x:int,y:int,zoom:number` | `hooks/useStudyTelemetry.ts:145` |
| `help.context` | M | `helpId,action:enum(open,close)` | `components/ui/ContextHelp.tsx:98` |
| `command.run` | M | `id` (command id) | `utils/appCommandHandlers.ts:26` |

### Technical + export + assets
| type | level | fields | source |
|---|---|---|---|
| `technical.status` | M | `code:enum,processingStage` | `hooks/useStudyTelemetry.ts:169` |
| `technical.error` | M | `code:enum(window_error,unhandled_rejection),kind` — `kind` is `Error.name` truncated to 48 chars (class name only, **never** message or stack) | `hooks/useStudyTelemetry.ts:249,255` |
| `export.download` | M | `extension,mime,bytes:int` | `utils/project.ts:2984` |
| `asset.imported` | S | `v,deployment,participantId,sessionId,contextId,projectId,assetId,kind,width:int,height:int,bytes:int` | `utils/studyTelemetry.ts:860` |
| `asset.omitted` | S | `kind,reason:enum(normalize_failed)` | `utils/studyTelemetry.ts:864` |

`technical.status.code` enum: `collision|constraint|invalid|export_failed|save_failed|network|application_error|blocked`.

## project.action field families

`project.action.data` is the scrubbed + entity-aliased action produced by
`studyProjectAction` (`utils/studyTelemetryProject.ts:212`), plus `applied:bool`.
Field set by action family:

- **part**: `update_part{partId,updates}`, `upsert_part{part}`, `delete_part{partId}`, `reorder_part{partId,direction}`, `select_part{partId}`
- **scene object**: `upsert_scene_object{object}`, `update_scene_object{objectId,updates}`, `delete_scene_object{objectId}`, `select_scene_object{objectId}`
- **path**: `upsert_path{path}`, `delete_path{pathId}` (path `points[]` are numeric coordinates only — scrubbed)
- **mechanism**: `set_mechanisms{mechanisms,selectedMechanismId}`, `upsert_mechanism{mechanism,replaceMechanismId?}`, `commit_mechanism_candidate{result}`, `delete_mechanism{mechanismId}`
- **skeleton/joint**: `set_skeleton{skeleton}`, `update_joint{jointId,updates}`, `add_joint{joint}`, `remove_joint{jointId}` (skeleton carries only `joints,bones,rootJointIds,metadata.scale`)
- **settings/export**: `update_settings{settings}`, `set_export{fabricationPackage}`, `set_processing{processing}`

All entity ids (`partId`, `jointId`, `path.id`, etc.) are replaced with
project-scoped aliases; raw ids never leave the client.

## project.snapshot state shape

Top-level keys of the scrubbed snapshot state
(`studyProjectSnapshot`, `utils/studyTelemetryProject.ts:153`):

```
version, metadata{projectAlias,status,classroomLessonId,normalizationScale},
parts, partOrder, sceneObjects, sceneObjectOrder, skeleton, paths, mechanisms,
settings{...classroomAssessmentKey:undefined}, selectedPartId, selectedPathId,
selectedMechanismId, selectedSceneObjectId, processing{stage,progress},
exportSummary{recipeCount,cutPartCount,validationIssueCount},
characterPackage{present,replacementMode},
foundryExportSummary{mechanismType,parameters,generatedPath,targetPartId,targetSceneObjectId,targetPathId}
```

`classroomAssessmentKey` is explicitly undefined-dropped (it can carry a
school-assigned id). Image/texture URLs on parts are stripped by the
`Url`/`Filename` suffix rule.

## Replay projection

`projectStudyReplayState(events)` (`utils/studyReplayProjection.ts`) is the
single fold analysis code uses to reconstruct authored state from records — do
not read raw events. It reassembles chunked snapshots, applies actions per
context, honors `project.undo/redo`, and **trusts `applied:false`** (a rejected
action is skipped entirely: it neither mutates state nor clears the redo stack).
Golden fidelity tests pin undo/redo, rejected-action skip, multi-context
reconnect, and chunk reassembly.

## Admin / retention

- `GET /admin/sessions`, `GET /admin/session/{id}`, `GET /admin/bugs`,
  `GET /admin/object` — read (ADMIN_TOKEN).
- `DELETE /admin/session/{id}?deployment={tag}` — purge one session's telemetry + assets.
- `DELETE /admin/deployment/{tag}?confirm={tag}` — purge a whole disposable
  deployment tag (test/smoke cleanup before real sessions; confirm echo required).

R2 layout: `telemetry/{deployment}/sessions/{sessionId}/{contextId}/{batchId}.json.gz`,
`assets/{deployment}/sessions/{sessionId}/{projectId}/{assetId}.{ext}`,
`bugs/{submissionId}.*`.

## What is deliberately NOT collected

SVG/PDF/STL export files, per-frame pose trajectories, keypose telemetry, student
free text, full error messages or stack traces, direct-assistance / bug-report
channel content (bugs are a separate opt-in private path), fine point-level
editing history. These are not essential to the research questions; the
collector and this dictionary intentionally exclude them.

# Study Metrics Catalog

What the analysis platform measures, why, and exactly which event fields or
projection inputs compute each metric. This is the contract between the
research questions and `utils/studyMetrics.ts` / `scripts/study-analyze.ts`.
For the raw field reference see [`data-dictionary.md`](data-dictionary.md);
for the tool that computes these see [`analysis-platform.md`](analysis-platform.md).

## Research questions

No PRD states research questions directly. These six are inferred from the
classroom product constraints in `docs/prd/classroom-field-support-plan.md`
(web-first, guided entry, motion scaffolding, stable reset) and
`docs/prd/classroom-sensemaking-discoverability-plan.md` (visible meaning,
cause/action hints). Every metric below maps to one of them.

- **RQ1 — Stage navigation & engagement.** Do students follow the canonical
  authoring path `character → path → foundry → design → blueprint → assembly`?
  Where do they skip, stall, or bounce?
- **RQ2 — Mechanism-choice behavior.** Which mechanism types do students pick?
  Top-ranked recommendation or scrolled? How many candidates considered?
- **RQ3 — Fabrication-readiness friction.** Where does the validator block?
  Which fabrication categories dominate failures?
- **RQ4 — Authoring effort & recovery.** How much editing? How often do guards
  reject edits? Does rejection predict undo/give-up?
- **RQ5 — Completion funnel.** What fraction reach export and assembly? Steepest
  drop-off?
- **RQ6 — Engagement & technical context.** Duration, pause/resume, reconnect
  count, viewport, pointer, network vs completion.

## Aggregation + output legend

- **Agg**: `S` per-session, `D` per-deployment aggregate, `S+D` both.
- **Output**: `cnt` count, `dur` ms duration, `rt` rate [0,1], `dist` categorical
  distribution, `seq` ordered sequence, `bool` flag.

## Catalog

### Stage navigation & engagement (RQ1)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `stageDwellMs` | S+D | dur per stage | `stage.view.dwellMs` attributed to the stage left (the event's `from`); terminal stage bounded by `sessionActiveMs` |
| `stageVisitOrder` | S | seq | `stage.view.to` in stream order |
| `stagesVisited` | S+D | dist | unique `stage.view.to` |
| `stageReentryCounts` | S+D | dist | tally of `stage.view.to` per stage |
| `stageNavigationBlockedRate` | S+D | rt | `stage.navigation.outcome === "blocked"` / total `stage.navigation` |
| `recoveryStageDistribution` | D | dist | `stage.navigation.recoveryStage` when outcome=blocked |
| `skippedStagesBeforeAssembly` | S+D | dist | stages in `{path,foundry,design,blueprint}` absent before first assembly entry |
| `modalOpens` | S+D | dist | `ui.modal.modal` enum tally |

### Mechanism-choice behavior (RQ2)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `mechanismTypeDistribution` | D | dist | tally of `m.type` across the projection's chosen final state mechanisms |
| `mechanismTypesAccepted` | S+D | dist | `recommendation.accept.mechanismType` |
| `rankAtAcceptance` | S+D | dist | `recommendation.accept.rank` |
| `candidateCountAtAcceptance` | S+D | dist | `recommendation.accept.candidateCount` |
| `recommendationRequestCount` | S+D | cnt | count of `recommendation.request` |
| `recommendationAcceptRate` | S+D | rt | `recommendation.accept` / `recommendation.request` |
| `recommendationDismissRate` | S+D | rt | `recommendation.dismiss` / `recommendation.request` |
| `recommendationConsiderationMs` | S+D | dur | `t(accept or dismiss) - t(matching request)` paired by context |

### Fabrication-readiness friction (RQ3)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `validationRunCount` | S+D | cnt | count of `simulation.validation` |
| `validationPassRate` | S+D | rt | `simulation.validation.valid === true` / total validations |
| `validationCategoryFrequency` | D | dist | `simulation.validation.category` enum tally (`feasibility\|collision\|geometry\|connection\|constraint\|none`) |
| `mechanismTypeValidationFailureRate` | D | dist of rt | per `mechanismType`: `valid=false / total` |
| `foundryPlaySessionCount` | S+D | cnt | transitions into `simulation.foundry.state === "playing"` |

### Authoring effort & recovery (RQ4)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `rejectedActionRate` | S+D | rt | `project.action.applied === false` / total `project.action` |
| `actionFamilyCounts` | S+D | dist | tally by action family (see Family map below) |
| `undoCount` / `redoCount` | S+D | cnt | count of `project.undo` / `project.redo` |
| `undoToActionRatio` | S+D | rt | `undoCount / totalActions` |
| `pathEditCount` | S+D | cnt | `upsert_path + delete_path` |
| `skeletonEditCount` | S+D | cnt | `add_joint + update_joint + remove_joint + set_skeleton` |
| `mechanismEditCount` | S+D | cnt | `upsert_mechanism + commit_mechanism_candidate + delete_mechanism + set_mechanisms` |
| `helpOpens` / `helpCloseRate` | S+D | cnt + rt | `help.context.action === open\|close` |
| `commandRunCounts` | D | dist | `command.run.id` tally |
| `lossCount` / `incompleteSnapshots` | S+D | cnt | `reassembleStudyEvents(...).losses`; subset `kind === "incomplete_snapshot"` |

#### Action family map

Action types are **verb-prefixed** (`upsert_part`, `delete_mechanism`,
`commit_mechanism_candidate`). `actionFamilyOf` maps by suffix plus the few
whole-word types — every bucket corresponds to an `applyReplayAction` case family:

| Family | Action types |
|---|---|
| `part` | `upsert_part`, `update_part`, `delete_part`, `reorder_part` |
| `scene_object` | `upsert_scene_object`, `update_scene_object`, `delete_scene_object` |
| `path` | `upsert_path`, `delete_path` |
| `mechanism` | `set_mechanisms`, `upsert_mechanism`, `commit_mechanism_candidate`, `delete_mechanism` |
| `skeleton` | `set_skeleton`, `add_joint`, `update_joint`, `remove_joint` |
| `settings` | `update_settings` |
| `export` | `set_export` |
| `transient` | `set_processing`, `select_part`, `select_scene_object` (not undoable) |
| `load` | `load_project` |

### Completion funnel (RQ5)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `completionFunnel` | S+D | dist of bool | reached each stage in `character → path → foundry → design → blueprint → assembly` |
| `reachedExport` | S+D | bool | any `export.download` |
| `completedProject` | S+D | bool | any `project.completed` |
| `exportDownloads` | S+D | dist + dur | `export.download.{extension, mime, bytes}` |
| `finalMechanismCount` | S+D | cnt | `projection` chosen final state mechanisms length |
| `finalValidMechanismCount` | S+D | cnt | mechanisms with `enabled === true` (see note below) |
| `finalHasExport` | S+D | bool | chosen final state `exportSummary` present |

### Engagement & technical context (RQ6)

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `sessionActiveMs` | S+D | dur | `session.pagehide.activeMs`; fallback `lastT - firstT` |
| `pauseCount` / `resumeCount` | S+D | cnt | count of `session.pause` / `session.resume` |
| `pauseMsLowerBound` | S+D | dur | Σ `t(resume) - t(pause)` paired in context (lower bound — no duration field) |
| `reconnectCount` | S+D | cnt | `session.start.reconnectCount` |
| `contextCount` | S+D | cnt | `projection.contexts.length` |
| `gestureVolume` | S+D | cnt + dur | count of `ui.gesture` + Σ `durationMs` (study profile only) |
| `technicalStatusFrequency` | D | dist | `technical.status.code` enum tally |
| `technicalErrors` | S+D | cnt | count of `technical.error` |
| `technicalContext` / `technicalContextDistribution` | S / D | dist | `session.start.technical.{browser, os, pointer, network}` |
| `assetImportCount` / `assetOmittedCount` | S+D | cnt | `asset.imported` / `asset.omitted` (study profile only) |

### Projection-derived final state

| Metric | Agg | Output | Computed from |
|---|---|---|---|
| `initialLessonId` | S+D | dist | first snapshot state's `metadata.classroomLessonId` |
| `finalMechanismCount` / `finalValidMechanismCount` | S+D | cnt | chosen final state (see RQ5) |

## Architectural rule: single-projection reuse

Every state-derived metric (`mechanismTypeDistribution`, `finalMechanismCount`,
`finalValidMechanismCount`, `initialLessonId`, `finalHasExport`) reads ONLY from
`computeSessionMetrics`'s `projection` input — the output of
`projectStudyReplayState(events)` in `utils/studyReplayProjection.ts` — never
from raw `project.action` records. Raw actions reflect attempts (rejected,
later-undone), not authored truth. The session's chosen final state is the
projection timeline's last entry: the owning context's state after the
chronologically final event (latest authored state wins; reconnect resyncs are
intentional). Test T3 in `tests/study-analyze.test.ts` makes this rule
executable — it fails loudly if a future refactor reads raw actions for
state-derived metrics.

## Scrub-layer caveats

Two facts in `utils/studyTelemetryProject.ts` shape the definitions:

- **`finalValidMechanismCount` is `enabled`-only.** The live
  `studyProjectCounts.validMechanisms` rule is `enabled && !warnings?.length`,
  but `warnings` is a `PRIVATE_KEY` and stripped by `scrubStudyValue` before the
  snapshot is stored. At replay depth the `warnings` field is gone, so "valid"
  degrades to `enabled === true`. Treat this as a lower bound on validity, not a
  fabrication-readiness verdict — pair with `validationPassRate` for friction.
- **Action types are verb-prefixed.** See the family map above; `actionFamilyOf`
  maps by suffix, not prefix.

## What the current field set cannot compute

Strict dictionary constraint (no free text, no per-frame pose, no asset pixels,
no error text). Within that fence:

| Gap | Why blocked | Minimal unlock (enum / bounded int / bool only) |
|---|---|---|
| Per-modal dwell | `ui.modal` emits only the `modal` enum, no `dwellMs` | Add `dwellMs:int` to `ui.modal` mirroring `stage.view.dwellMs`. Bounded int, identity-guard-safe. Schema bump required. |
| Per-candidate inspection dwell | `recommendation.candidates` is one event with the full list | None. Not observable from discrete events; `rankAtAcceptance` is the proxy. |
| Assessment-prompt interactions | `classroomAssessmentKey` is dropped by the scrubber | None. Deliberate privacy fence. |
| Abandonment reason | No event fires on mid-task tab close | None suitable. Infer from funnel position + `sessionActiveMs` + `rejectedActionRate`. |
| Generated-path motion quality | `foundryExportSummary.generatedPath` is opaque; per-frame pose excluded | None. Out of research scope. |

All other RQ1–RQ6 sub-questions are computable from the current schema.

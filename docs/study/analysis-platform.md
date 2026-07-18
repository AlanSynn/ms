# Study Analysis Platform

How raw session batches turn into research metrics. The platform is a batch
offline analyzer — a researcher runs it after a class against one deployment
tag and reads a JSON + CSV export. No live dashboards, no streaming ingest.
For what is measured see [`metrics.md`](metrics.md); for the raw fields see
[`data-dictionary.md`](data-dictionary.md); to operate it see
[`runbook.md`](runbook.md).

## Shape

Two files, both new:

- `utils/studyMetrics.ts` — pure metric module. Inputs are an already-reassembled
  event stream and an already-folded projection. Never re-derives state from raw
  events. Fully unit-testable without a network.
- `scripts/study-analyze.ts` — thin CLI. Lists sessions, folds each, aggregates,
  writes the export. Reuses the admin-fetch + cursor conventions from
  `scripts/study-replay.ts`.

## Pipeline

```
   GET /admin/sessions?deployment=X        (cursor loop — the one route study-replay.ts lacks)
           │
           ▼
      sessionIds[]
           │
           ▼  for each
   GET /admin/session/{id}?deployment=X    (cursor loop — reused from study-replay.ts)
           │
           ▼
   batches[] → records[]                   (flatten + annotate contextId/participantId, sort by t/contextId/seq)
           │
           ▼
   reassembleStudyEvents(rawEvents)        ← utils/studyReplayProjection.ts
           │
           ▼
   { events, losses }
           │
           ▼
   projectStudyReplayState(events)         ← utils/studyReplayProjection.ts  (SINGLE FOLD)
           │
           ▼
   { contexts, timeline }
           │
           ▼
   computeSessionMetrics({ meta, events, losses, projection, firstT, lastT })
           │
           ▼
   SessionMetrics  ──▶ aggregateSessionMetrics ──▶ DeploymentAggregate
           │
           ├──▶ <out>.json   (full DeploymentMetrics, mode 0600)
           ├──▶ <out>.csv    (one row per session, mode 0600)
           └──▶ stdout       (human funnel summary)
```

The fold runs exactly once per session, in `utils/studyReplayProjection.ts` —
the same fold the browser replay slider and the fidelity tests use. The metrics
module consumes its output; it never calls `projectStudyReplayState` itself.

## Module contract (`utils/studyMetrics.ts`)

Pure entry points (all unit-tested in `tests/study-analyze.test.ts`):

- `computeSessionMetrics(input: SessionMetricsInput): SessionMetrics`
- `aggregateSessionMetrics(sessions: SessionMetrics[]): DeploymentAggregate`
- `sessionMetricsToCsvRow(metrics): Record<string, string|number|boolean>`
- `deploymentMetricsToCsvRows(sessions): Array<Record<...>>`
- `toCsv(rows): string` — deterministic header (first-seen order), RFC-compliant quoting
- Sub-pure helpers: `stageVisitsFromEvents`, `stageVisitOrderFromVisits`,
  `completionFunnelFromEvents`, `mechanismTypeDistributionFromProjection`,
  `validationCategoryCountsFromEvents`, `actionFamilyOf`
- Stats primitives: `median`, `quantile`, `mean`

`SessionMetricsInput` is constructed by the CLI:

```ts
{
  meta: SessionEnvelopeMeta;     // identity + profile, from the session's batches
  events: ReplayEvent[];         // post-reassembleStudyEvents
  losses: ReassembleLoss[];      // surfacing gaps, not swallowed
  projection: StudyReplayProjection;  // post-projectStudyReplayState
  firstT: number; lastT: number; // envelope-bounded event span
}
```

Invariants baked into the module:

1. State-derived fields read ONLY `input.projection`'s chosen final state. T3 is
   the executable guard. See [`metrics.md`](metrics.md) §Architectural rule.
2. `actionFamilyOf` maps by action-type suffix (actions are verb-prefixed).
3. Every distribution folds events through the documented enum sets.
4. Absent optionals serialize as `""` in CSV (no `undefined` leaks); the column
   set is stable across profile mixes.

## CLI (`scripts/study-analyze.ts`)

```
STUDY_ADMIN_TOKEN=... bun scripts/study-analyze.ts \
  --deployment v0.0.10 \
  [--session ses_...]      # single-session mode (skips list step)
  [--limit N]              # cap sessions (smoke)
  [--profile study|replay|metrics]   # warn on profile mismatch
  [--endpoint URL]         # default https://alansynn.com/ms-study/v1
  [--out prefix]           # default study-analysis-<deployment>
  [--force]                # overwrite an existing export
```

Auth reuses `STUDY_ADMIN_TOKEN` (the same bearer `study-replay.ts` uses). No
OAuth, no per-user accounts. The Worker source pins admin auth at
`infrastructure/study/worker.js` (`isAdmin`).

Output files are written mode `0600` (owner-readable only, matching
`study-replay.ts`). Without `--force` the CLI fails rather than silently
overwriting a prior export.

### Reuse from `scripts/study-replay.ts`

| Concern | Source |
|---|---|
| Bearer `adminFetch` helper | `study-replay.ts` arg + fetch pattern |
| Cursor-paginated session fetch | `study-replay.ts` cursor loop |
| Batch → record flatten + contextId/participantId annotation | `study-replay.ts` flatten |
| Stream sort key (`t` → `contextId` → `seq`) | `study-replay.ts` sort |
| Loss surfacing + single fold | `utils/studyReplayProjection.ts` |

The only new code the CLI owns: the `/admin/sessions` list loop (returns
`{ sessions, cursor }`) and per-session envelope-metadata extraction. The Worker
returns full envelopes in each batch (spread in `adminSession`), so identity
fields come from the first batch; `reconnectCount` / `sessionCount` are
cumulative and taken as the max across batches.

### Warnings surfaced

The CLI never silently drops signal. `DeploymentMetrics.warnings[]` records:

- **Profile mix** — a deployment with sessions of different `profile` values.
  Projection-derived fields are null for `metrics`-profile sessions (no
  snapshots). If `--profile` is set, each mismatched session is named.
- **Loss total** — any session with `lossCount > 0` (incomplete chunk sets,
  orphan chunks). State for affected contexts may reconstruct from a stale
  baseline; treat as unverified.
- **Build drift** — multiple distinct `buildSha` values in one deployment mean
  sessions ran different code.

Schema versions are NOT checked at runtime: `validEnvelope` pins
`eventSchema`/`snapshotSchema` to the v1 constants and rejects others at ingest,
so they cannot drift within stored data.

## Testing strategy (`tests/study-analyze.test.ts`)

Mirrors `tests/study-telemetry.test.ts`: top-level `{ }` blocks,
`node:assert/strict`, no `describe`/`it`. Runner is the root `test` script
(finds `tests/*.test.ts`).

| Block | What it locks |
|---|---|
| T1 | Per-session correctness: every field equals a hand-computed value for a fixed stream |
| T2 | Aggregation: medians, funnel counts, distribution sums, `sessionActiveMs` quantiles |
| T3 | Projection-reuse invariant (raw actions misleading → projection wins) |
| T4 | Stage skip detection (`character → assembly` skips the middle) |
| T5 | CSV flattening: stable columns, no holes, no `undefined` leaks |
| T6 | Loss surfacing propagates from `reassembleStudyEvents` |
| T7 | Profile degradation: `metrics` profile yields null state fields without throwing |
| T8 | Reconnect/multi-context: no bleed, latest authored state wins |
| T9 | CLI smoke: stub Worker → list → fold → JSON+CSV (mode 0600), `--force` gate |

T3 is the architectural guard.

## Scope guard (what this is NOT)

The v1 analyzer is a **batch offline** tool. Explicitly excluded:

- Live dashboards / web UI / watch mode / streaming ingest.
- Per-frame pose trajectories, keypose telemetry, motion-quality scoring
  (dictionary forbids; out of research scope).
- ML inference, clustering, classification, sequence models, p-values,
  regression. Descriptive statistics only; inference is the researcher's
  downstream tool.
- Anything needing free-text fields (assessment prompts, error messages,
  student notes). The scrubber drops these at the source.
- Cross-deployment comparison. One `--deployment` at a time; a future
  `--compare` flag would add multi-deployment diffs.
- Asset pixel content analysis. Counts and bytes only.
- Identification / re-identification across deployments. Entity aliases are
  project-scoped and irreversible by design.
- Automatic purge integration. The CLI is strictly read-only. Purging is a
  manual operator action via the existing DELETE routes (see
  [`runbook.md`](runbook.md)).
- The `ui.modal.dwellMs` schema addition (proposed in
  [`metrics.md`](metrics.md) gap table). A separate proposal gated by a
  schema-version bump; not part of the v1 build.

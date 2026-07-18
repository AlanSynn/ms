# Study Runbook

Operating the study-data pipeline: purge test data before a real class, run a
deployment analysis, and read the export. The analyzer is **read-only**; it
never mutates R2. Purging is a separate, deliberate operator action.

All commands assume you are in the repo root and have
`STUDY_ADMIN_TOKEN` exported (the same Worker admin bearer `study-replay.ts`
uses; it lives only as a Worker secret — never commit it, never put it in
`.env`).

## 1. Purge test / smoke data

Disposable deployment data must not mix with real classroom sessions. Before a
class, wipe the deployment tag you smoke-tested against. Both routes require
`ADMIN_TOKEN`; the deployment-wide purge additionally requires the tag echoed
back as `?confirm=<tag>` so a malformed call cannot wipe a tag.

**Whole deployment** (clears telemetry + assets for the tag):

```bash
curl -X DELETE \
  -H "Authorization: Bearer $STUDY_ADMIN_TOKEN" \
  "https://alansynn.com/ms-study/v1/admin/deployment/v0.0.10?confirm=v0.0.10"
```

**Single session** (surgical; leaves every other session intact):

```bash
curl -X DELETE \
  -H "Authorization: Bearer $STUDY_ADMIN_TOKEN" \
  "https://alansynn.com/ms-study/v1/admin/session/ses_...?deployment=v0.0.10"
```

Both return `{ ok, deployment, purged: { telemetry, assets } }` with the object
counts deleted. Guards: auth (401 without token), `confirm` match (400 on
mismatch), `SAFE_ID` validation on the tag/session id. See
`infrastructure/study/worker.js` (`adminPurgeDeployment`, `adminPurgeSession`,
`purgePrefix`).

## 2. Run a deployment analysis

```bash
STUDY_ADMIN_TOKEN=... bun run study:analyze -- --deployment v0.0.10
```

(`bun run study:analyze` resolves to `bun scripts/study-analyze.ts`; the `--`
separates bun flags from script flags.) Or call the script directly:

```bash
STUDY_ADMIN_TOKEN=... bun scripts/study-analyze.ts --deployment v0.0.10
```

Useful flags:

- `--session ses_...` — analyze one session (skips the list step; fast smoke).
- `--limit N` — cap sessions (smoke against a large deployment).
- `--profile study` — warn on any session whose capture profile differs.
- `--out prefix` — output prefix (default `study-analysis-<deployment>`).
- `--force` — overwrite an existing export. Without it the CLI fails rather
  than silently clobber a prior run.

Output is two mode-`0600` files plus a stdout summary:

- `<prefix>.json` — full `DeploymentMetrics` (`deployment`, `generatedAt`,
  `sessions[]`, `aggregate`, `warnings[]`).
- `<prefix>.csv` — one row per session, deterministic columns, absent
  optionals as empty strings.
- stdout — funnel counts, median engagement / rejection / undo, top mechanism
  types, warning count.

## 3. Read the export

### CSV (per-session)

Load `<prefix>.csv` into a notebook or spreadsheet. Columns are deterministic
and documented in [`metrics.md`](metrics.md). Distributions serialize as
`key:count|key:count`; sequences as `a>b>c` or `a|b|c`. A `metrics`-profile
session has empty projection-derived columns (`finalMechanismCount`,
`initialLessonId`, `mechanismTypeDistribution`) — that is expected, not a bug.

### JSON (full)

`aggregate` holds deployment-wide rollups:

- `completionFunnel` — session count reaching each stage + export + completed.
- `completionRate` — `reachedExport / sessionCount`.
- `medianSessionActiveMs` / `p25` / `p75` — engagement spread.
- `medianStageDwellMs` — per-stage median dwell.
- `mechanismTypeDistribution` — sum of chosen-final-state mechanism types.
- `meanRankAtAcceptance`, `meanCandidateCountAtAcceptance`.
- `medianRejectedActionRate`, `medianUndoCount`, `medianRedoCount`.
- `validationCategoryFrequency`, `meanValidationPassRate`.
- `technicalContextDistribution` — `{ browser, os, pointer, network }` tallies.
- `recommendationAcceptRate`, `medianRecommendationConsiderationMs`.

`sessions[]` holds the full per-session record (see `SessionMetrics` in
`utils/studyMetrics.ts`).

## 4. Interpret warnings

`warnings[]` records signal the CLI refused to swallow:

- **Profile mix** — sessions with different `profile` values in one deployment.
  `metrics`-profile sessions carry no snapshots, so their projection-derived
  fields are null. Either filter them out of projection-dependent analysis or
  re-run with `--profile study` to name each mismatch.
- **Loss total** — a session with `lossCount > 0` had an incomplete chunk set
  or an orphan chunk (begin lost). Its affected contexts reconstruct from a
  stale or null baseline; treat their final state as **unverified**, not
  authoritative. Cross-check against neighbor sessions or the raw replay
  (`study:replay`) before citing a final-state metric.
- **Build drift** — multiple `buildSha` values mean sessions ran different
  code. Note this in any cross-session comparison; a behavior change between
  builds can masquerade as a cohort effect.

## 5. Replay a session for qualitative check

When a metric needs context the aggregate hides, rebuild the visual replay:

```bash
STUDY_ADMIN_TOKEN=... bun run study:replay -- --deployment v0.0.10 --session ses_...
```

This writes a private (`0600`) self-contained HTML that reassembles snapshots,
applies semantic actions per context, and embeds imported visuals. See
`scripts/study-replay.ts`.

## 6. Cleanup note

The stale duplicate field reference that previously lived at
`docs/observability/study-telemetry-data-dictionary.md` has been removed; the
canonical reference is [`data-dictionary.md`](data-dictionary.md) in this hub.
`docs/observability/README.md` remains as a four-line signpost to here.

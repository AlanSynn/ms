# Study Data Hub

The study-data boundary for MotionSmith: what the `/ms-study/v1` Worker
collects, how it is replayed, and how raw session batches turn into research
metrics. Everything needed to reason about classroom study data lives here.

- [`data-dictionary.md`](data-dictionary.md) — canonical field reference for every telemetry event, the snapshot schema, capture profiles, two-layer PII controls, and the replay projection. If a field is not listed there it is not emitted.
- [`metrics.md`](metrics.md) — research metrics catalog: each metric mapped to its research question, the event fields + projection inputs that compute it, and aggregation level.
- [`analysis-platform.md`](analysis-platform.md) — design of the offline analysis tool that folds sessions through the canonical projection into research metrics and an analyzable export.
- [`runbook.md`](runbook.md) — how to purge test data, run a deployment analysis, and read the export.

Operational deploy controls (profiles, secrets, R2 layout) remain in
[`../deployment.md`](../deployment.md); the Worker source is at
`infrastructure/study/worker.js`; the canonical replay fold is at
`utils/studyReplayProjection.ts`.

## Build switch

The normal build is telemetry-free:

```bash
bun run build
```

Enable the optional runtime with one build variable:

```bash
VITE_STUDY_PROFILE=metrics bun run build
VITE_STUDY_PROFILE=replay bun run build
VITE_STUDY_PROFILE=study bun run build
```

Without that variable, Vite keeps the two no-op boundary modules and does not
bundle `utils/studyTelemetry.ts`, `hooks/useStudyTelemetry.ts`, or the snapshot
worker. Shell variables and Vite mode files such as `.env.local` use the same
switch.

To remove client capture, keep the no-op boundaries, remove the
`motionsmith-study-boundary` Vite plugin and the three real runtime files. The
existing app call sites then remain harmless no-ops. Full-system retirement also
requires removing the tagged-release study profile, Worker batch/asset routes,
R2 data, analysis scripts, tests, and study docs. `/ms-study/v1/bug` is
independent private bug intake and can remain.

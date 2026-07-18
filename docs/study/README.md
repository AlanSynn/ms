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

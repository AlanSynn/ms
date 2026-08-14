# G8 study-summary schema

Schema version: `study-summary-v1`.

`utils/studySummaryTelemetry.ts` exposes `createStudySummarySession`. The
adapter receives a validated build SHA, fixed profile, injected endpoint, and
injected transport. Its only event methods are `enterStage`, `recordCommand`,
`recordMechanism`, `recordFit`, `recordExport`, `recordAutosave`,
`recordImageInference`, `recordError`, and `recordPerformance`. Delivery is
explicit: one `flush()` and one `beacon()` at most.

## Fixed fields

- `schema`, validated `buildSha`, fixed `profile`, and bounded session duration.
- Coarse `context`: viewport, hardware-concurrency, pointer, and network bucket.
- Enum-indexed stage entries and stage durations.
- Enum-indexed command outcomes: accepted, rejected, no-op, and unknown.
- Enum-indexed mechanism families.
- Fit request/outcome counters plus one fixed latency histogram.
- Export attempt/outcome counters plus fixed blocker counters.
- Autosave success/failure/recovery counters plus one fixed duration histogram.
- Image-inference success/failure counters plus one fixed latency histogram.
- Error-name counters from the fixed allowlist: `Error`, `ReferenceError`,
  `SyntaxError`, `TypeError`, `RangeError`, bounded DOM names, and `unknown`.
- Six precomputed performance fields: input p95, input delta p95, input delta
  percent p95, frame-interval p95, frame-interval delta percent p95, and long
  tasks over 50 ms.

All arrays have compile-time fixed lengths from the exported allowlists. Latency
histograms use upper bounds `1,4,8,16,32,64,128,250,500,1000,2000,5000` ms and
one final `+inf` bucket.

## Privacy and bounds

No snapshots, action streams, IDs, aliases, coordinates, paths, parameters,
geometry, screenshots, images, masks, project files, free text, URLs, file
names, stacks, messages, pointer samples, replay history, storage, timers,
compression, retry, or worker are accepted or serialized. Categorical inputs
must already be exact fixed values; noncanonical values map to `unknown`.
Numeric viewport and hardware-concurrency inputs are reduced to coarse buckets.
Only a normalized lowercase 7–40 hex build SHA and the constant schema string
are strings in the payload. The endpoint is transport input only.

Counters saturate at `1,000,000`; duration values are bounded to one day;
payloads are rejected above 8,192 UTF-8 bytes. The current fixed accounting is
135 array number cells and 14 scalar number cells:
`(135 + 14) × 16 + 8,192 max payload + 8,192 fixed overhead = 18,768 bytes`,
below the 262,144-byte gate. Disabled (`off`) sessions are no-op adapters and
never send.

## Analyzer

`scripts/study-summary-analyze.ts` exports pure JSON/JSONL parsing, median,
fixed-bucket percentile, rates with numerator and denominator, missing-session
and missing-field counts, fixed category counts, and deterministic build/profile
stratification. It aggregates precomputed summaries only; it does not replay
actions or make causal claims.

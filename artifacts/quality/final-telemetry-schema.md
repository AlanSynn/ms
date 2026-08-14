# Final study-summary schema

Schema: `study-summary-v1`

Runtime profile: `study` only

Default profile: absent at compile time

## Compile boundary

The runtime can be included only by building with all three explicit inputs:

- `MOTIONSMITH_SUMMARY=1`
- `MOTIONSMITH_SUMMARY_TARGET=<absolute HTTP(S) URL without credentials>`
- `MOTIONSMITH_BUILD_SHA=<7–40 hexadecimal Git SHA>`

Unset or `MOTIONSMITH_SUMMARY=0` builds define the feature as false and the
production tree-shake removes the session, lifecycle, endpoint, and summary
schema. Ordinary `VITE_*` client variables cannot enable it. Autosave, save,
export, navigation, rendering, and unload do not depend on the summary path.

## Fixed payload

Every payload has only the following bounded fields:

- `schema`, normalized `buildSha`, fixed `profile`, and bounded
  `sessionDurationMs`;
- coarse viewport, hardware-concurrency, pointer, and network buckets;
- fixed arrays for stage entries and stage duration;
- fixed arrays for accepted, rejected, no-op, and unknown command outcomes;
- fixed mechanism-family counters;
- Fit request/outcome counters and a fixed latency histogram;
- export attempt/outcome and blocker counters;
- autosave success, failure, recovery, and fixed duration histogram;
- image-inference success, failure, and fixed latency histogram;
- allowlisted JavaScript/DOM error-name counters; and
- six optional precomputed performance scalars: input p95, input p95 delta in
  milliseconds and percent, frame-interval p95 and percent delta, and long-task
  count over 50ms.

The fixed latency bounds are `1, 4, 8, 16, 32, 64, 128, 250, 500, 1000,
2000, 5000` milliseconds plus one `+inf` bucket. Counters saturate at
`1,000,000`; durations saturate at one day. Noncanonical categories map to the
fixed `unknown` bucket.

## Bounds and delivery

- Maximum UTF-8 payload: 8,192 bytes.
- Fixed accounting: 135 array cells plus 14 scalar cells.
- Conservative memory estimate:
  `(135 + 14) × 16 + 8,192 payload + 8,192 overhead = 18,768 bytes`, below the
  262,144-byte budget.
- At most one best-effort normal POST, issued at the first export boundary.
- At most one best-effort `sendBeacon`, issued on `pagehide`.
- POST uses text/plain, omitted credentials, no referrer, and keepalive.
- There is no timer, retry, queue, worker, persistence, compression, or durable
  delivery guarantee.

## Privacy boundary

The adapter cannot accept or serialize identity, names, email, phone, free
text, URLs, file names, project IDs, project state, geometry, coordinates,
paths, mechanism parameters, screenshots, images, masks, stacks, messages,
pointer samples, action streams, undo history, replay records, or browser
fingerprints. Error collection records only a fixed error name; event messages
and file names are never read.

## Runtime wiring

Stable command boundaries record navigation/authoring outcomes, mechanism
family, Fit, export, autosave/recovery, and local ONNX inference. A memoized
lifecycle records stage changes and allowlisted uncaught error names. It does
no work in pointer, animation, or render loops. Performance A/B measurements
remain external validation evidence; they are not injected into ordinary
sessions, so those six fields may be `null`.

## Analyzer limits

The analyzer accepts summary JSON/JSONL and may report counts, rates with
explicit denominators, medians, fixed-bucket percentiles, missing-session and
missing-field counts, and build/profile strata. It cannot reconstruct a
workflow, claim complete delivery, infer causality, or replay a session.

## Historical disposition

The historical privacy allowlist and low-cardinality measurement intent are
retained in this schema. Full replay, snapshots, checkpoints, durable outbox,
batch/retry delivery, screenshots, bug intake, purge flows, server/R2 storage,
and action-stream analysis are intentionally deleted and were not restored.

## Final verification

The default production bundle at source SHA
`0707c38aaf2ddc121cdfc550a2067812354b0123` contains none of the schema,
counter, flush, environment-variable, or study-target markers and made zero
summary requests through export and pagehide. The enabled build emitted one
1,114-byte normal POST and one 1,114-byte exit beacon. Both payloads matched
the exact top-level, context, and performance allowlists above and contained
the expected schema, source SHA, and `study` profile.

The warmed Orca crossover measured an input p95 delta of `-0.25 ms`
(`-0.58%`) and a playback-frame p95 delta of `+0.75 ms` (`+0.87%`), with no
attributable long task, no structural scene rebuild, and identical measured
playback clear counts. See `artifacts/quality/final-performance.json` and
`artifacts/quality/G9/raw/orca-ab-evidence.json`.

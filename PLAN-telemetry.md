# Plan — Chromebook-Robust Study Telemetry & Persistence

## Context

Study telemetry and metrics are deployed and production-verified, but the system has not been validated on its real target: student Chromebooks on a slow, filtered, shared school network.

The verified risks are concentrated in four areas:

* One production metric is silently incorrect.
* Autosave can fail or lose recent work under tab eviction and storage pressure.
* Pointer-driven editing and snapshot encoding can block the main thread on low-end CPUs.
* Shared NAT, synchronized exports, and unreliable Wi-Fi can delay or lose telemetry delivery.

## Implementation Update — 2026-07-25

The targeted follow-up findings are implemented:

* Snapshot normalization, stringify, hashing, and Base64 chunking run in
  `studySnapshotWorker.ts`. Prepared records return through native Worker
  structured clone so the main thread does not repeat JSON decode and parse;
  it only hands off `ProjectState` and commits the current generation.
* Hidden/pagehide checkpoints merge instead of overwrite. Core actions are
  enqueued before technical and snapshot batches in separate transactions,
  already-reserved batches remain recoverable, and only successfully stored
  checkpoint batches are removed.
* Network transport now has `normal`, `constrained`, and `offline-recovery`
  policies with hysteresis, larger bounded constrained batches, slower retry
  spacing, stale-snapshot collapse, and a randomized reconnect drain window.
* Normal builds resolve telemetry calls to no-op boundaries. One
  `VITE_STUDY_PROFILE=metrics|replay|study` setting opts in to the real runtime;
  the default bundle contains neither that runtime nor the snapshot Worker.
* Closed recommendation UI no longer performs path-fit optimization after
  unrelated project edits.

Production-preview verification used a 36,000-point project for three mutations
at 6× CPU throttle. Maximum Worker handoff was 15.8 ms, maximum and p95
prepared-record commit was 23.2 ms, and no interaction Long Task was observed.
This is a repeatable headless regression gate, not a physical Chromebook claim.
All four capture profiles have build/runtime coverage; the tagged release
workflow runs the study browser gate before building `/ms/`.

## Completion Criteria

Under a representative Chromebook profile:

* No interaction long task exceeds 50 ms under 6× CPU throttle.
* Dragging and joint editing continue to track the pointer without visible stalls.
* Student work survives tab discard, reload, and temporary offline periods.
* Core behavioral events are never silently dropped.
* Local Export never waits for telemetry delivery.
* Telemetry recovers and drains after network reconnection.

## Baseline Environment

* Celeron N4500/N5100-class CPU
* Approximately 4 GB RAM
* Chrome OS tab eviction under memory pressure
* 1280×720–1366×768 display
* Shared school NAT
* Slow, filtered, or intermittent Wi-Fi
* Managed devices with `getDisplayMedia` often disabled
* Shared Chromebook carts
* Whole-class synchronized Export bursts

---

## Verified Findings

| ID  | Finding                                                                         | Severity | Primary Impact                            |
| --- | ------------------------------------------------------------------------------- | -------: | ----------------------------------------- |
| F1  | `simulation.validation` emits `mechanismType`, while metrics read `detail.type` |     HIGH | Invalid RQ3 mechanism-type failure rates  |
| F2  | Autosave depends on `localStorage` and unload events                            |     HIGH | Recent work lost on tab discard           |
| F3  | Base64 textures can exceed `localStorage` quota; errors are swallowed           |     HIGH | False “saved” state and full-project loss |
| F5  | Multiple tabs can reuse the same `seq` values                                   |     HIGH | Replay ordering corruption                |
| F9  | Exit checkpoint depends primarily on `pagehide`                                 |      MED | Final checkpoint gap on eviction          |
| F6  | Snapshot scheduling runs in `useLayoutEffect`                                   |     HIGH | Pre-paint interaction stalls              |
| F7  | Pointer movement dispatches full project updates repeatedly                     |     HIGH | Path and joint editing jank               |
| F10 | The in-memory telemetry buffer is unbounded                                     |      MED | Memory growth during long sessions        |
| F4  | Rate limiting is keyed primarily by public IP                                   |     HIGH | Whole-school throttling behind shared NAT |
| F8  | Snapshot clone, stringify, and Base64 encoding run on the main thread           |     HIGH | Multi-megabyte long tasks                 |
| F12 | Delivery does not adapt to measured network health                              |      MED | Inefficient delivery on slow Wi-Fi        |
| F11 | Some stage changes bypass navigation counting                                   |      MED | Biased navigation metrics                 |
| F13 | Hostname rejection disables telemetry without an observable signal              |      MED | Silent school-proxy data gaps             |
| F14 | Screenshot denial can fail the entire bug report                                |      MED | Bug reports fail on managed devices       |
| F15 | Client and Worker identity scrubbers differ                                     |      LOW | Benign fields may be removed client-side  |
| F16 | Network enum regex precedence is incorrect                                      |      LOW | Validation is broader than intended       |

---

# Approach

Each phase is independently shippable and should land as one atomic commit. Work is ordered by student-data risk and expected Chromebook impact.

## Phase 1 — Metric Correctness and Basic Persistence

**Fixes:** F1, F2, F3, F5, F9

### F1 — Correct the metric field

In `utils/studyMetrics.ts:484`:

```ts
str(detail.type)
```

becomes:

```ts
str(detail.mechanismType)
```

Update all affected `simulation.validation` fixtures in `tests/study-analyze.test.ts` from `type` to `mechanismType`.

Add a regression assertion that pins:

```ts
metrics.mechanismTypeValidationFailureRate
```

to the expected per-type result. The assertion must fail on the old implementation.

### F2/F3 — Move autosave to IndexedDB

Replace the `localStorage` autosave with an IndexedDB store using the existing Outbox database pattern.

Requirements:

* Store the latest complete project snapshot in IndexedDB.
* Preserve one previous valid generation for recovery.
* Migrate an existing `localStorage` autosave once, then remove the legacy key.
* Surface explicit `saving`, `saved`, and `failed` states.
* Never report `saved` until the IndexedDB transaction completes.
* Handle quota and transaction failures explicitly.
* Observe storage pressure with `navigator.storage.estimate()` where available.
* Request persistent storage with `navigator.storage.persist()` where available, without depending on approval.

IndexedDB avoids the small synchronous `localStorage` ceiling but is not unlimited. Autosave generations and stale data must remain bounded.

Do not introduce texture-blob deduplication in this phase. First establish a correct and recoverable persistence path.

### Hidden-tab behavior

Do not begin expensive serialization only after the page becomes hidden.

Instead:

* Prepare autosave snapshots during normal debounced operation.
* On `visibilitychange → hidden`, commit the latest prepared snapshot.
* If no prepared snapshot is available, record a dirty marker and minimal recovery metadata.
* Keep `pagehide` and `beforeunload` as fallback signals.

### F5 — Make ordering tab-safe

Keep `seq` numeric and local to one browser context.

Use the explicit ordering tuple:

```text
participantId
sessionId
contextId
seq
```

Do not flatten `contextId` and `seq` into one lexicographically sorted string.

Within one context, `seq` defines order. Across contexts, analysis should use `t` and `contextId` without claiming a strict total order when events are concurrent.

### F9 — Flush on hidden

On `visibilitychange → hidden`:

* Commit the latest prepared autosave.
* Save the exit checkpoint.
* Commit any pending telemetry snapshot.
* Trigger a non-blocking Outbox flush when delivery is possible.

### Verification

* `bun run test`
* New F1 regression assertion fails on old code and passes on new code.
* Force-discard and reopen the tab; the project restores successfully.
* Open the same session in two tabs; no event-key or sequence collision occurs.
* Simulate IndexedDB failure; the UI reports `failed`, not `saved`.

---

## Phase 2 — Pointer and Interaction Latency

**Fixes:** F6, F7, F10

### F6 — Remove heavy work from the paint path

Change the telemetry snapshot scheduling effect in `hooks/useStudyTelemetry.ts` from `useLayoutEffect` to `useEffect`.

The effect may schedule work but must not synchronously clone, stringify, encode, or upload a project.

### F7 — Coalesce pointer-driven updates

Apply the same interaction model to path drawing and joint editing:

* Keep live drag state in component-local state or refs.
* Update the visible canvas at animation-frame cadence.
* Dispatch permanent project state at most once per animation frame.
* Always commit the final state on `pointerup`, `pointercancel`, or lost capture.
* Preserve the existing invariant that rejected actions cannot replace prior applied actions.

Telemetry should represent a gesture rather than every pointer pixel.

Record:

* gesture start
* gesture commit
* duration
* pointer sample count
* final delta or path length
* affected entity count where relevant

Do not discard research-relevant interaction information solely to reduce event count.

### F10 — Bound memory without dropping core events

Do not use unconditional `drop-oldest`.

When the memory buffer reaches its cap:

1. Spill buffered records to IndexedDB immediately.
2. Remove them from memory only after the transaction succeeds.
3. If persistence fails, discard low-priority snapshot or technical records before behavioral actions.
4. Preserve core action events as long as possible.
5. Emit an observable loss counter if any record is dropped.

### Verification

Under 6× CPU throttle:

* Draw a path and edit multiple joints.
* Pointer tracking remains visually continuous.
* No interaction long task exceeds 50 ms.
* Permanent state commits occur at most once per frame.
* Telemetry contains one gesture-level record set rather than one full record per pointer movement.
* Core events survive buffer pressure.

---

## Phase 3 — Rate Limiting and Delivery Safety

**Fixes:** F4 and Outbox delivery gaps

### F4 — Use dual rate limiting

Use two server-side limits:

* Primary per-`participantId` limit
* Looser per-IP backstop

Retain:

* `participantId` format validation
* request-size limits
* route restrictions
* identity guard
* optional per-session protection

This prevents one school NAT from sharing the normal participant limit while still limiting clients that mint arbitrary participant IDs.

### Retry behavior

The existing delivery path already has single-flight delivery, exponential backoff, offline skipping, and `Retry-After` handling. Strengthen it with:

* Random retry jitter to prevent synchronized class-wide retries
* Explicit dead-letter or quarantine accounting for non-retryable `4xx` batches
* No silent deletion of malformed batches
* Bounded diagnostic metadata without retaining sensitive payloads indefinitely

### Export isolation

The local Export path must not await:

* `flushOutbox`
* snapshot encoding
* asset upload
* telemetry acknowledgment

Telemetry delivery remains fire-and-forget after durable local enqueue.

### Outbox memory usage

Replace full `getAll()` reads with cursor-based or paginated reads for:

* delivery
* trimming
* startup recovery
* diagnostics

Avoid loading the maximum Outbox contents into memory at once.

### Priority handling

Separate or tag records so trimming can prefer:

1. Removing stale assets
2. Removing superseded snapshots
3. Preserving core behavioral actions

Snapshot and action data should not be inseparable if that prevents priority-based retention.

### Compression

Do not persist both raw and compressed copies by default.

* Cache compressed request bodies during one delivery attempt.
* Recompress after a page restart.
* Persist compressed bodies only if profiling proves recompression is a material CPU bottleneck.

### Verification

* Deploy the Worker and run `scripts/study-prod-smoke.ts`.
* Verify independent participant limits behind one simulated IP.
* Verify the looser IP backstop remains active.
* Work offline, Export locally, reconnect, and confirm Outbox recovery.
* Confirm retries are jittered.
* Confirm malformed `4xx` batches are quarantined or counted rather than silently deleted.

---

## Phase 4 — Outbox and Snapshot Priority

**Fixes:** queue pressure and avoidable data loss

Implement explicit delivery classes:

```text
core-action
technical
snapshot
asset
```

Requirements:

* Core actions receive the highest retention priority.
* Superseded snapshots may collapse to the latest valid snapshot.
* Assets may be removed before actions when storage pressure requires trimming.
* Snapshot batches should not block action delivery.
* A failed snapshot must not prevent unrelated behavioral events from being delivered.
* All trimming and loss decisions must increment observable counters.

Keep Outbox size and item-count caps.

### Verification

Fill the Outbox to its configured limit and confirm:

* Core actions remain present.
* Older snapshots collapse or trim first.
* Assets trim before behavioral actions.
* The browser does not load the entire Outbox into memory.
* Loss counters match the actual removed records.

---

## Phase 5 — Snapshot Encoding Off the Interaction Path

**Fixes:** F8

Start with low-risk changes before introducing a Worker.

### Stage 1 — Deduplicate and cancel

* Keep only the latest pending snapshot request.
* Cancel or invalidate stale work using a generation token or `AbortController`.
* Skip encoding when the normalized snapshot content is unchanged.
* Remove unnecessary derived state before `JSON.stringify`.
* Pause non-essential snapshot generation while `document.hidden`.

### Stage 2 — Chunk expensive work

Replace per-byte `String.fromCharCode` conversion with bounded chunk processing.

Schedule snapshot work with:

* `requestIdleCallback` with an explicit timeout
* `setTimeout` fallback
* `scheduler.yield()` where available and useful

A timeout is required so snapshots are not postponed indefinitely during continuous interaction.

Chunking must cover the expensive path, not only the final Base64 loop. A single large synchronous `JSON.stringify` may still produce a long task.

### Stage 3 — Measure

Profile:

* clone time
* normalization time
* stringify time
* encoding time
* maximum task duration
* p95 snapshot preparation time

If any snapshot stage still creates interaction long tasks above the completion criterion, move only the snapshot encode pipeline to a dedicated Web Worker.

Do not move unrelated application state or rendering logic into the Worker.

### Verification

Under repeated project mutations at 6× CPU throttle:

* Only one snapshot encode is active.
* Stale requests are cancelled or ignored.
* Unchanged content produces no new snapshot.
* Snapshot work does not block pointer interaction.
* No interaction long task exceeds 50 ms.

---

## Phase 6 — Autosave Size Optimization

Implement only after measuring the IndexedDB autosave introduced in Phase 1.

Escalate if autosave size, serialization time, or storage growth remains material.

### Texture blob deduplication

Store large textures as separate IndexedDB blobs referenced by stable content hashes.

The implementation must include:

* Versioned project-reference format
* Atomic project and blob updates
* Recovery when a referenced blob is missing
* Migration from inline texture data
* Reference counting or mark-and-sweep garbage collection
* Export reconstruction
* Bounded old-generation cleanup
* Hashing outside latency-sensitive interaction paths

Do not add this architecture solely because textures are theoretically large. Add it when measurements show that full autosave snapshots remain too expensive.

### Verification

* Repeated saves of an unchanged textured project do not duplicate blob storage.
* Deleting or replacing textures eventually removes unreferenced blobs.
* Interrupted writes restore the previous valid project generation.
* Export reconstructs the complete project correctly.
* Autosave size and duration improve materially over the Phase 1 baseline.

---

## Phase 7 — Network-Adaptive Transport

**Fixes:** F12

Adapt transport behavior only. Never change what behavioral data is collected or what metrics mean.

Use three delivery states:

```text
normal
constrained
offline-recovery
```

Inputs may include:

* `navigator.connection.saveData`
* `navigator.connection.effectiveType`
* recent request RTT
* consecutive failures
* recent successful deliveries

Use hysteresis:

* Do not change state after one slow or failed request.
* Enter `constrained` after sustained high RTT or repeated failures.
* Return to `normal` only after multiple successful deliveries.

In constrained mode:

* Increase the flush interval.
* Keep delivery concurrency at one.
* Use moderately larger batches within strict byte limits.
* Collapse superseded snapshots.
* Preserve all core behavioral actions.
* Increase retry spacing.

Batch limits must account for:

* uncompressed bytes
* compressed bytes
* event count
* server request limits
* `keepalive` constraints
* retry cost

Do not create excessively large batches simply to reduce request count.

### Verification

Under Slow 3G, intermittent failure, and Save-Data:

* Delivery moves into constrained mode without changing event semantics.
* Core behavioral events remain complete.
* Snapshot uploads collapse appropriately.
* Recovery does not produce a synchronized retry burst.
* State does not oscillate after isolated slow requests.

---

## Phase 8 — Metric and Environment Cleanup

**Fixes:** F11, F13, F14, F15, F16

* Route genuine stage moves through `navigateAppStage`.
* Emit navigation-count events for project reset, load, and recovery transitions.
* Emit a one-time technical status when hostname policy disables telemetry.
* Submit bug reports without screenshots when `getDisplayMedia` is denied.
* Align client and Worker identity scrubber patterns.
* Fix the network regex:

```ts
/^(?:[234]g|slow-2g)$/
```

No readiness-gate behavior should change.

---

# End-to-End Verification

## Unit and Contract Tests

Run after every phase:

```sh
bun run test
```

The F1 regression assertion must prove the metric correction.

## Chromebook Performance

Use a real baseline Chromebook where possible. Otherwise use:

* 6× CPU throttle
* memory pressure
* Slow 3G
* offline transitions

Measure:

* maximum interaction task duration
* dropped frames during dragging
* pointer-to-visual response
* p95 permanent-state commit time
* autosave preparation and commit time
* snapshot preparation time
* Outbox delivery CPU time
* memory growth
* recovery success rate
* event delivery delay

## Durability

Test:

* forced tab discard
* browser restart
* temporary offline use
* IndexedDB transaction failure
* storage pressure
* two tabs sharing one participant session
* full Outbox recovery

## Production Pipeline

After Worker changes:

* Purge the previous smoke batch.
* Run `scripts/study-prod-smoke.ts`.
* Verify per-participant limiting and the IP backstop.
* Run the targeted identity-guard probe.

---

# Security Envelope

Unchanged:

* Cloudflare OAuth through `CLOUDFLARE_API_TOKEN`
* No `wrangler login`
* `.env` remains ignored
* Deploy only to `alansynn.com/ms-study/v1/*`
* Preserve identity validation and request-size limits
* Use a browser-like `User-Agent` for production smoke tests
* Do not collect additional identifying data for optimization

---

# Out of Scope

* `ui.modal.dwellMs` schema-version upgrade
* Per-frame generated-path quality scoring
* Broader free-text PII hardening for private bug intake
* Per-candidate inspection dwell events
* Explicit abandonment-reason events
* Additional Worker pipelines beyond the measured snapshot encoder

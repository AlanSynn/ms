# Chromebook Classroom Performance Audit

Status: full emulation audits are local-only; prior 6× CPU emulation evidence retained
Evidence date: 2026-08-21
Actual Chromebook tested: no

## Claim

The retained historical production-preview evidence was collected at 1366×768,
DPR 1, Chrome CPU throttling 6×, 40 ms network latency, 10 Mbps download, and
5 Mbps upload. It contains 12 feature interactions and repeated stage switching
from the v0.0.13 Balanced run, plus four actual-WebGL playback checks refreshed
against the v0.0.14 release branch. Those reports passed the gates in force at
the time; they do not yet establish the tightened acceptance profile described
below. This is emulator evidence, not a physical-Chromebook result.

The tables below are retained historical evidence. They predate the strict
50 ms maximum Long Task rule, the Video/Rapier feature gates, run-manifest
validation, and the 20-sample entry gate. They must not be promoted as evidence
for the tightened acceptance profile until those reports are regenerated from
one clean production-preview build.

## Audit profiles and invocation

The harness has two typed profiles. `regression-4x` is the local development
signal; `acceptance-6x` is the local release-candidate signal. Both use Chrome at
1366×768 and DPR 1 with the bounded classroom network profile. The commands are:

```sh
CHROMEBOOK_AUDIT_PROFILE=regression-4x bun run test:chromebook-audit
CHROMEBOOK_AUDIT_PROFILE=acceptance-6x bun run test:chromebook-audit
CHROMEBOOK_AUDIT_PROFILE=acceptance-6x bun run test:chromebook-audit:full
```

CDP applies the requested slowdown to the attached page target. Dedicated
worker targets are not separately attached or calibrated, so a `4×` or `6×`
label is a main-page regression/acceptance label, not a claim that worker CPU
ran at that factor. Worker completion time is reported separately and is not
used as click-response evidence. The slowdown is relative to the current host,
not calibrated to a physical Chromebook. Reports record host/CI identity,
invocation, Chrome renderer strings, window DPR, and effective canvas drawing
buffer scale so unlike runs are not silently compared.

Each local invocation empties a unique run directory before measurement and
validates an exact expected-report manifest afterward. Missing, unexpected,
wrong-profile, stale-schema, or provenance-free JSON fails validation instead
of accepting checked-in evidence as if it came from the run.

Full emulation audits are local-only. GitHub-hosted timing is not release
evidence: shared runner CPU, software rendering, memory-probe latency, and
serial fresh-context setup made the same suite take roughly six hours without
making it more representative of a classroom Chromebook. Pull-request CI keeps
the deterministic contracts, ordinary production build, bundle budget,
image-recognition exclusion, and focused production-preview browser checks.
Run the commands above on a controlled local host before a release candidate;
retain the generated provenance-bound reports and validate their exact manifest.

The primary acceptance scope is deliberately interaction-sized. Each feature
runs in a fresh branded Chrome process so an earlier feature cannot warm or
pollute its heap, workers, WebGL state, or code cache. The complete
Character-to-Assembly workflow remains a regression check rather than the
performance claim; it passed separately, but end-to-end wall time is not used
as an interactivity metric.

The diagnostics build installs measurement probes. A separate ordinary
production build is used for the shipping bundle and image-recognition
exclusion gates, so diagnostics code is not counted as classroom payload.

## Feature interaction and memory evidence

Acceptance limits are next-screen paint p95 ≤100 ms, every measured main-window
Long Task ≤50 ms, and post-cleanup heap growth no greater than the larger of 15% or
8 MiB. Worker, `ImageBitmap`, and Object URL counts must return to their
baseline after completion and cancellation.

Direct manipulation (drag, orbit, and scrub/range updates) has a separate
p95 ≤50 ms gate. Other click and stage actions retain the general p95 ≤100 ms
limit.

| Feature | Next paint p95 | Long Task p95 | Worker job p95 | Heap growth | Heap tail range | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Blueprint package | 30.8 ms | 0 ms | 289.9 ms | +1.97 MB | 0.14 MB | Pass |
| Character controls | 40.9 ms | 0 ms | — | +2.07 MB | 1.54 MB | Pass |
| Character package import | 34.8 ms | 0 ms | 292.9 ms | +0.44 MB | 1.61 MB | Pass |
| Design controls | 59.1 ms | 0 ms | — | +1.72 MB | 0.36 MB | Pass |
| Design Fit | 47.7 ms | 0 ms | 97.8 ms | +0.77 MB | 0.64 MB | Pass |
| Foundry gestures | 71.7 ms | 0 ms | — | +1.43 MB | 1.37 MB | Pass |
| Options and history | 23.6 ms | 0 ms | — | +0.81 MB | 0.54 MB | Pass |
| Path gestures | 41.4 ms | 0 ms | — | +2.67 MB | 1.03 MB | Pass |
| Project import | 32.3 ms | 0 ms | 475.6 ms | −0.95 MB | 0.99 MB | Pass |
| Recommend | 20.9 ms | 0 ms | 313.7 ms | +0.99 MB | 0.06 MB | Pass |
| Scene-object image | 9.9 ms | 0 ms | 295.6 ms | −0.93 MB | 0.53 MB | Pass |
| Trace GIF | 24.8 ms | 0 ms | 175.9 ms | +0.99 MB | 0.66 MB | Pass |

The worker-job column reports background completion, not click response. Import,
recommendation, fitting, Blueprint generation, image rasterization, and GIF
decode use bounded workers. The final artifacts show all owned workers and
media resources returned after their cancel/complete cycles; Trace exercised
one transferred bitmap. Ordinary scene-object images and GIF Trace remain
available. They are not image recognition.

The refreshed feature set also includes bounded MP4 Trace and Rapier
diagnostics. Video measures file-change paint, metadata completion, playback,
cancellation, and Object URL return. Rapier measures the first lazy request,
its separate completion time, a warm repeat, and verifies that the optional
chunk is requested exactly once without recognition payloads. These two rows
remain pending until the next clean 4×/6× evidence run.

Evidence is regenerated on demand by `bun run test:chromebook-audit` under the gitignored `artifacts/chromebook-audit/features/` directory; it is no longer committed.

## Balanced simulation evidence

`Balanced` intentionally trades a small amount of visual detail for classroom
latency: the renderer caps pixel ratio at 0.5, disables antialiasing and plate
bevel/edge geometry, targets 40 fps, limits overlays to 15 fps, bounds
trace/path detail, caps media at 800 px, 180 sampled frames, and 20 fps, and
uses bounded shared geometry/material pools. This is an explicit preset policy,
not User-Agent detection. `Fast` remains available as the more aggressive
0.4-pixel-ratio, 20 fps fallback.

| Surface | Sample | Frame p50 | Frame p95 | Frame p99 | Frames >50 ms | Frames >200 ms | React commits | Heap/WebGL delta | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Foundry | 5 s | 25.0 ms | 33.7 ms | 35.3 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Path | 3 s | 25.0 ms | 33.6 ms | 34.2 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Design | 3 s | 24.9 ms | 32.7 ms | 34.0 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Assembly | 3 s | 25.1 ms | 33.5 ms | 34.7 ms | 0% | 0 | 0 | 0 / 0 | Pass |

These frame intervals come from instrumented `webgl-clear-submission` events,
not the host display's independent requestAnimationFrame cadence. All four
surfaces used the same retained simulation/scene contracts. Playback changed
transforms, visibility, and matrices without React commits or topology
rebuilds. Live WebGL resources, contexts, geometry caches, and material caches
were unchanged across each measured interval. Heap measurement was supported;
growth and the measured tail range were zero in every refreshed workload.

Evidence is regenerated on demand by `bun run test:chromebook-audit` under the gitignored `artifacts/chromebook-audit/playback/` directory; it is no longer committed.

## High-resolution boundary

`High resolution` is an explicit capable-hardware option, not the classroom
default. It raises the DPR cap from 0.5 to 2 while retaining `Balanced` cadence,
antialiasing, overlays, topology detail, media, and cache limits. The effective
DPR is also bounded by device DPR, `MAX_RENDERBUFFER_SIZE`, and a 4,000,000
drawing-buffer-pixel budget. Cold character topology is phased in with smaller
work slices under High so raising resolution does not add a larger synchronous
construction task.

The enforcing DPR2 audit keeps memory measurement outside active playback.
Its Path timing starts only after the guided Character viewport reaches WebGL,
finishes topology and initial-scene work, and records a real renderer
submission; the Path probe must then prove that its context was created before
the Path click. Character's cold renderer work is not discarded by this
separation: the classroom-entry audit times starter and lesson clicks through
that same final renderer boundary and keeps every overlapping Long Task under
the existing 50 ms maximum.

Adjacent-stage code warming also waits for the active viewport's production
readiness signal before requesting browser idle time. Puppet stages publish
readiness only after initial topology/resources and the restored canonical GL
submission; Foundry-backed stages publish completed topology. WebGL-unavailable
and explicit empty-stage views use a one-second quiet fallback before the same
idle scheduler. Stage changes cancel observers, fallback timers, and idle work.
Only the next adapter is warmed; Path may additionally warm that same adjacent
Foundry adapter's renderer dependency. Workers, media payloads, physics, and
export jobs remain on demand.

Before each baseline it drives the surface until topology, React commits, and
identity-aware WebGL ownership are unchanged across three actual submissions.
Path's explicit pending initial-scene resource count must also reach zero.
Declared part-art references and renderer texture counts remain diagnostics:
shared URLs and visibility-dependent uploads mean they are not one-to-one.
Their values and all identity-aware resource counters must nevertheless remain
unchanged through the submitted-frame plateau and paused baseline, so a late
upload still invalidates readiness. The cold-stage record separately preserves
the trusted click, transition frame, stage and inspector mounts, relevant script
response timing, renderer/context acquisition, first GL submission, topology
readiness, and initial-scene resource drain. This attributes cold Long Tasks
without excluding them, and rejects an eagerly mounted Foundry example while
its Hint is collapsed. The renderer then pauses. The authoritative baseline is
taken while paused; Play response is measured separately, and only after that
response paints does the exact steady submission window begin. Pause ends the
window, and tail samples run only after the renderer is quiescent. Raw Long
Tasks, phase attribution, and memory-probe windows remain in the artifact. Only
tasks fully contained by an isolated probe window are removed from the
application-work maximum: cold stage, control, boundary-straddling, and
steady-playback tasks all still fail above 50 ms.
Steady windows also require zero per-kind WebGL creation/deletion, even when net
live resources are unchanged. The 4× High run treats the one-time DPR1→DPR2 allocation separately,
bounding it by 12 bytes per added backing-store pixel plus 1 MiB, then requires
a new settled DPR2 Path run and a settled DPR2 Foundry run to pass the complete
frame, heap, resource, context, and React-commit gates. This does not prove
memory behavior for a canvas driven close to the 4,000,000-pixel ceiling; that
limit remains a renderbuffer safety gate pending dedicated near-budget memory
evidence.

A supplementary six-stage local comparison used actual WebGL submissions at
1366×768 with CPU throttling 6×. On ANGLE Metal with an Apple M1 Pro,
Balanced DPR 1 and High DPR 1/DPR 2 all stayed within the short interaction
limits: the maximum p95 render interval was 35.3 ms, maximum next-paint latency
was 69.1 ms, no interval exceeded 200 ms, and the largest backing store was
1,522,560 pixels. Overall main-heap growth ranged from 2.88 MB to 5.76 MB.

Forced SwiftShader provides the important counterexample. Balanced itself
reached p95 80.7 ms and next-paint 279.5 ms; High reached p95 156.7 ms and
next-paint 381 ms, and the DPR 2 sample included one interval over 200 ms.
Metal M1 Pro is optimistic and SwiftShader is a software-renderer stress test;
neither is a physical Chromebook GPU. The comparison is not a soak or a
same-SHA acceptance artifact, and first Path playback lazily allocated the same
six GPU resources in every preset. Therefore High is not claimed safe on all
Chromebooks and remains opt-in; `Balanced` is the only Chromebook-default
acceptance claim.

The raw supplementary reports are regenerated by `bun run test:chromebook-audit:high-resolution` under the gitignored `artifacts/chromebook-audit/high-resolution/` directory; they are no longer committed.

## Stage switching

The cold stage-switch cycle recorded next-paint p95 78.3 ms and ready p95
437.3 ms. Warm cycles recorded next-paint p95 35.0 ms, ready p95 271.1 ms,
and Long Task p95 50 ms. Heap grew 3.87 MB, the WebGL context count stayed
constant, and three warm cycles ended at the same live-resource count. Cold
initialization still produced tasks up to 94 ms while first creating stage
assets. That prior artifact no longer passes the tightened maximum-50-ms rule;
it is diagnostic history, not current acceptance evidence.

See the stage-switch report regenerated under the gitignored `artifacts/chromebook-audit/stages/` directory.

## Implemented performance changes

- Foundry, Design, Path, and Assembly now render through persistent scene
  graphs with shared geometry/materials, pooling, instancing, bounded caches,
  and transform-only playback updates.
- Character plates retain unchanged topology. Lock-only edits build no new
  geometry, one changed plate rebuilds only that plate, and removing a plate
  leaves surviving meshes intact.
- Heavy deterministic work runs behind cancellable, generation-checked worker
  seams. Feature UI owns workers locally so opening or closing a sheet does not
  rerender unrelated stages.
- GIF and ordinary artwork processing use bounded dimensions/frame counts,
  transferable bitmaps, explicit cancellation, URL revocation, and cleanup
  checks.
- Blueprint STL tessellation remains manifold and preserves physical holes
  while reducing the fixture STL from 1.89 MB to 1.21 MB and its portable
  package from 2.17 MB to 1.45 MB. Diagnostics no longer retain a second large
  serialized package copy during the memory gate.
- Rapier remains a literal lazy physics chunk. It is absent from initial boot
  traffic and loads only when the optional contact diagnostic is requested.

## Production bundle and image-recognition exclusion

The ordinary static production build contains 156,137 gzip bytes of core
JavaScript against the 200,000-byte limit and 217,411 compressed bytes in the
initial shell against the 300,000-byte limit. Optional worker and Rapier
chunks are excluded from those initial-request totals.

Image recognition was removed completely from the classroom product and build.
`scripts/check-no-image-recognition.mjs` checks both source and `dist/`: no
`.onnx` model, `onnxruntime-web`, ORT recognition WASM/chunk, recognition worker,
model URL, image-recognition control, or image-recognition starter asset may be
present. A school network therefore has no recognition model or ORT payload to
request, even accidentally.

`bun run test:bundle-budget` recomputes the budget from `dist/` on every run and writes it to the gitignored `artifacts/chromebook-audit/bundle-budget.json`; the limits live in `scripts/check-browser-bundle.mjs`.

## Recovery and release boundaries

Production-preview regression coverage verifies local project/package import,
missing-file recovery, ordinary scene-object images, GIF/video Trace, legacy
autosave migration, WebGL-unavailable fallback, context-loss restoration,
Blueprint export, and project round trip. These checks preserve data and
recovery behavior, but their full-workflow wall time is not part of the primary
performance gate.

Classroom releases remain version-tag-only through GitHub Pages. The local
performance harness cannot publish, and the production exclusion check must
pass in CI before the tagged artifact is uploaded.

## Evidence boundaries

- No physical Chromebook was tested. Report this result only as `6× CPU
  emulation passed`.
- The acceptance evidence uses short, isolated feature gates and 3–5 second
  playback samples. It does not establish ten-minute heap stabilization.
- Memory reports prefer `measureUserAgentSpecificMemory()` when Chrome exposes
  it under the required isolation policy. Otherwise they identify
  `performance.memory.usedJSHeapSize` as a diagnostic fallback; the fallback is
  not relabeled as a complete process-memory measurement. The 4× regression
  profile may retain that diagnostic signal. The official 6× profile requires
  cross-origin-isolated, authoritative `measureUserAgentSpecificMemory()`
  baseline/final/tail samples from the same metric source and fails otherwise.
  The diagnostics preview adds COOP `same-origin` and COEP `require-corp` only
  when `MOTIONSMITH_AUDIT_ISOLATION=1`. This is recorded in each report; it
  does not change or make a claim about shipping-site response headers.
- Classroom entry defaults to 20 fresh-context samples and records trusted
  click-to-next-paint separately from interactive readiness. A bounded
  `CHROMEBOOK_ENTRY_SAMPLES` override exists only for focused local smoke.
- Cold first-entry stage creation has more headroom than warm interaction; the
  prior 94 ms maximum is now a failing datum, not an accepted exception.
- The refreshed v0.0.14 playback evidence is local production-preview evidence.
  GitHub-hosted timing is not release evidence and would not turn this into a
  physical-Chromebook result.

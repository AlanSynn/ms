# Chromebook Classroom Performance Audit

Status: 6× CPU emulation passed for short classroom feature and simulation gates
Evidence date: 2026-08-21
Actual Chromebook tested: no

## Claim

The default `Balanced` preset passes the measured production-preview gates at
1366×768, DPR 1, Chrome CPU throttling 6×, 40 ms network latency, 10 Mbps
download, and 5 Mbps upload. The evidence set contains 12 feature interactions
and repeated stage switching from the v0.0.13 Balanced acceptance run, plus
four actual-WebGL playback checks refreshed against the v0.0.14 release branch.
Every recorded check passed. This is emulator evidence, not a
physical-Chromebook result.

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

Acceptance limits are next-screen paint p95 ≤100 ms, main-window Long Task p95
≤50 ms, and post-cleanup heap growth no greater than the larger of 15% or
8 MiB. Worker, `ImageBitmap`, and Object URL counts must return to their
baseline after completion and cancellation.

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

Evidence is stored under
[`artifacts/chromebook-audit/features`](../artifacts/chromebook-audit/features/).

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

Evidence is stored under
[`artifacts/chromebook-audit/playback`](../artifacts/chromebook-audit/playback/).

## High-resolution boundary

`High resolution` is an explicit capable-hardware option, not the classroom
default. It raises the DPR cap from 0.5 to 2 while retaining `Balanced` cadence,
antialiasing, overlays, topology detail, media, and cache limits. The effective
DPR is also bounded by device DPR, `MAX_RENDERBUFFER_SIZE`, and a 4,000,000
drawing-buffer-pixel budget. Cold character topology is phased in with smaller
work slices under High so raising resolution does not add a larger synchronous
construction task.

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

The raw supplementary reports and their provenance limitations are retained in
[`artifacts/chromebook-audit/high-resolution`](../artifacts/chromebook-audit/high-resolution/).

## Stage switching

The cold stage-switch cycle recorded next-paint p95 78.3 ms and ready p95
437.3 ms. Warm cycles recorded next-paint p95 35.0 ms, ready p95 271.1 ms,
and Long Task p95 50 ms. Heap grew 3.87 MB, the WebGL context count stayed
constant, and three warm cycles ended at the same live-resource count. Cold
initialization still produced tasks up to 94 ms while first creating stage
assets; this is the main measured headroom that remains, although the cold
paint and ready gates passed.

See the
[`stage-switch artifact`](../artifacts/chromebook-audit/stages/chromebook-stage-switch-audit.json).

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

The ordinary static production build contains 147,074 gzip bytes of core
JavaScript against the 450,000-byte limit and 208,130 compressed bytes in the
initial shell against the 1,500,000-byte limit. Optional worker and Rapier
chunks are excluded from those initial-request totals.

Image recognition was removed completely from the classroom product and build.
`scripts/check-no-image-recognition.mjs` checks both source and `dist/`: no
`.onnx` model, `onnxruntime-web`, ORT recognition WASM/chunk, recognition worker,
model URL, image-recognition control, or image-recognition starter asset may be
present. A school network therefore has no recognition model or ORT payload to
request, even accidentally.

See the [`bundle artifact`](../artifacts/chromebook-audit/bundle-budget.json).

## Recovery and release boundaries

Production-preview regression coverage verifies local project/package import,
missing-file recovery, ordinary scene-object images, GIF/video Trace, legacy
autosave migration, WebGL-unavailable fallback, context-loss restoration,
Blueprint export, and project round trip. These checks preserve data and
recovery behavior, but their full-workflow wall time is not part of the primary
performance gate.

Classroom releases remain version-tag-only for both the Cloudflare root site and
the GitHub Pages mirror. Performance workflows cannot publish, and the
production exclusion check must pass before either tagged artifact is uploaded.

## Evidence boundaries

- No physical Chromebook was tested. Report this result only as `6× CPU
  emulation passed`.
- The acceptance evidence uses short, isolated feature gates and 3–5 second
  playback samples. It does not establish ten-minute heap stabilization.
- Cold first-entry stage creation has more headroom than warm interaction; its
  observed Long Task maximum was 94 ms even though all cold switch acceptance
  limits passed.
- The refreshed v0.0.14 playback evidence is local production-preview evidence.
  GitHub-hosted CI is a separate release gate and does not turn this into a
  physical-Chromebook result.

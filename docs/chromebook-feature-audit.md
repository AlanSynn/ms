# Chromebook Classroom Performance Audit

Status: 6× CPU emulation passed for short classroom feature and simulation gates
Evidence date: 2026-08-20
Actual Chromebook tested: no

## Claim

The default `Balanced` preset passes the measured production-preview gates at
1366×768, DPR 1, Chrome CPU throttling 6×, 40 ms network latency, 10 Mbps
download, and 5 Mbps upload. The final enforcing run passed all 17 checks: 12
feature interactions, four playback surfaces, and repeated stage switching.
This is emulator evidence, not a physical-Chromebook result.

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
latency: the renderer caps pixel ratio at 0.625, disables antialiasing and plate
bevel/edge geometry, targets 30 fps, limits overlay cadence, bounds trace/path
detail, caps media at 900 px and 240 sampled frames, and uses bounded shared
geometry/material pools. This is an explicit preset policy, not User-Agent
detection. `Fast` remains available as a more aggressive 0.5-pixel-ratio,
20 fps fallback.

| Surface | Sample | Frame p50 | Frame p95 | Frame p99 | Frames >50 ms | Frames >200 ms | React commits | Heap/WebGL delta | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Foundry | 15 s | 8.3 ms | 9.2 ms | 9.3 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Path | 5 s | 8.3 ms | 9.2 ms | 9.4 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Design | 5 s | 8.3 ms | 9.2 ms | 9.3 ms | 0% | 0 | 0 | 0 / 0 | Pass |
| Assembly | 5 s | 8.3 ms | 9.2 ms | 16.6 ms | 0% | 0 | 0 | 0 / 0 | Pass |

All four surfaces used the same retained simulation/scene contracts. Playback
changed transforms, visibility, and matrices without React commits or topology
rebuilds. Live WebGL resources, contexts, geometry caches, and material caches
were unchanged across each measured interval.

Evidence is stored under
[`artifacts/chromebook-audit/playback`](../artifacts/chromebook-audit/playback/).

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

The ordinary static production build contains 393,510 compressed bytes of core
JavaScript against the 450,000-byte limit and 454,568 compressed bytes in the
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

The classroom branch does not deploy. GitHub Pages remains version-tag-only;
the performance workflows cannot publish, and the production exclusion check
must pass before any future tagged artifact can be uploaded.

## Evidence boundaries

- No physical Chromebook was tested. Report this result only as `6× CPU
  emulation passed`.
- The final acceptance run used short, isolated feature gates and 5–15 second
  playback samples. It does not establish ten-minute heap stabilization.
- Cold first-entry stage creation has more headroom than warm interaction; its
  observed Long Task maximum was 94 ms even though all cold switch acceptance
  limits passed.
- GitHub workflow definitions were validated locally but have not been proven
  on GitHub-hosted runners in this branch.

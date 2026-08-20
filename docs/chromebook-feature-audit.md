# Chromebook Feature Audit

Status: 6× CPU emulation passed for the short non-AI feature gates
Evidence date: 2026-08-20
Actual Chromebook tested: no

## Claim

The default `Balanced` preset passes the production-preview interaction,
short-memory, and retained-renderer gates below at 1366×768, DPR 1, Chrome CPU
throttling 6×, 40 ms network latency, 10 Mbps download, and 5 Mbps upload.
This is not evidence from physical Chromebook hardware.

The primary audit is intentionally feature-scoped: Recommend, Design Fit,
Trace GIF, and Foundry playback run independently. Image recognition is no
longer an audited optional workload because its model, ORT/WASM runtime,
workers, UI, dependency, and starter assets are absent from the product.
The Character-to-Assembly workflow and ten-minute soak remain separate
manual/nightly checks.

## Interaction and short-memory evidence

Acceptance limits are next-screen paint p95 ≤100 ms, main-window Long Task p95
≤50 ms, and post-cleanup heap growth no greater than the larger of 15% or 8 MiB.
Worker, ImageBitmap, and ObjectURL active counts must return to their baseline.

| Feature | Next paint p95 | Long Task p95 | Worker job | Heap growth | Heap tail range | Ownership returned | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Recommend | 32.1 ms | 0 ms | 402.3 ms | +541,630 B | 424,390 B | 1/1 worker | Pass |
| Design Fit | 58.9 ms | 0 ms | 136.7 ms | +899,060 B | 375,216 B | 1/1 worker | Pass |
| Trace GIF | 28.7 ms | 0 ms | 194.8 ms | +583,763 B | 56,616 B | 2/2 workers, 2/2 bitmaps | Pass |

The worker-job column is completion time, not click response. Design entry
prepares tiny recommendation and optimizer worker entries; heavy job chunks
load only when Recommend or Fit runs. Each feature returns owned workers and
media resources after completion or cancellation.

Evidence:

- [`recommend`](../artifacts/chromebook-audit/features/chromebook-feature-recommend-audit.json)
- [`designFit`](../artifacts/chromebook-audit/features/chromebook-feature-designFit-audit.json)
- [`traceGif`](../artifacts/chromebook-audit/features/chromebook-feature-traceGif-audit.json)

## Balanced playback evidence

The 15-second Foundry sample recorded frame intervals of p50 8.4 ms, p95
17.0 ms, and p99 17.6 ms. No interval exceeded 50 ms or 200 ms. The sample
recorded zero React playback commits, zero heap growth, and zero deltas for live
WebGL resources, contexts, topology builds, geometry cache, and material cache.

This short sample is an interactive leak gate, not a ten-minute stabilization
claim. See the [`playback artifact`](../artifacts/chromebook-audit/playback/chromebook-playback-audit.json).

## Production bundle and network exclusion

The static compressed production-shell gate reports 396,005 bytes of core JS
against a 450,000-byte limit and 457,044 bytes of initial shell assets against
a 1,500,000-byte limit. Rapier remains a lazy physics chunk; recommendation,
optimizer, and GIF workers remain lazy feature chunks.

`scripts/check-no-image-recognition.mjs` verifies both source and `dist/`. The
production output contains no `.onnx` model, `onnxruntime-web`, ORT recognition
WASM/chunk, inference/cache worker, or model URL. Browser workflow coverage also
records forbidden recognition requests and requires zero across boot and all
measured tabs. See the [`bundle artifact`](../artifacts/chromebook-audit/bundle-budget.json).

## Recovery and release gates

Production-preview coverage verifies local package review and missing-file
recovery, ordinary scene-object image import, GIF/video Trace, legacy autosave
migration, WebGL-unavailable fallback, and restoration of the retained Foundry
scene after context loss. Pull requests run contracts, production and
diagnostics builds, the bundle/exclusion gates, and focused browser recovery
tests with bounded Playwright workers.

The nightly/manual performance workflow keeps two scopes:

- `feature`: the four short gates above.
- `full`: the short gates plus Character-to-Assembly audit and ten-minute soak.

Neither verification workflow can deploy. GitHub Pages remains tag-only, and
the deployment build reruns the image-recognition exclusion before upload.

## Boundaries and remaining P3 work

- Run the same gates on physical Chromebook hardware before changing the result
  label from `6× CPU emulation`.
- Obtain a nightly ten-minute artifact to make the long-run heap stabilization
  claim; it was not run locally in this acceptance pass.
- The GitHub workflows were source- and YAML-validated locally but have not yet
  run on GitHub-hosted runners.

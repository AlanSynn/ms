# Chromebook Feature Audit

Status: 6× CPU emulation passed for the short feature gates
Evidence date: 2026-08-20
Actual Chromebook tested: no

## Claim

The default `Balanced` preset passes the production-preview interaction,
short-memory, and retained-renderer gates below at 1366×768, DPR 1, Chrome CPU
throttling 6×, 40 ms network latency, 10 Mbps download, and 5 Mbps upload.
This is not evidence from physical Chromebook hardware.

The primary audit is intentionally feature-scoped. It runs Recommend, Design
Fit, Trace GIF, deterministic AI import ownership, and Foundry playback as five
independent tests. The verified run completed in about two minutes; individual
tests took 18–33 seconds. The Character-to-Assembly workflow and ten-minute soak
remain separate manual/nightly checks.

## Interaction and short-memory evidence

Acceptance limits are next-screen paint p95 ≤100 ms, main-window Long Task p95
≤50 ms, and post-cleanup heap growth no greater than the larger of 15% or 8 MiB.
Worker, ImageBitmap, and ObjectURL active counts must return to their baseline.

| Feature | Next paint p95 | Long Task p95 | Worker job | Heap growth | Heap tail range | Ownership returned | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Recommend | 59.5 ms | 0 ms | 8,062.9 ms | -1,953,567 B | 1,327,420 B | 2/2 workers | Pass |
| Design Fit | 30.8 ms | 0 ms | 8,111.3 ms | +707,503 B | 772,726 B | 2/2 workers | Pass |
| Trace GIF | 25.1 ms | 0 ms | 177.7 ms | +221,427 B | 63,472 B | 2/2 workers, 2/2 bitmaps | Pass |
| AI boundary fixture | 70.5 ms | 0 ms | 373.6 ms | +3,403,155 B | 935,464 B | 2/2 workers, 14/14 bitmaps | Pass |
| Actual ONNX model | 61.3 ms | 0 ms | 118,500.7 ms | +2,441,166 B | 69,252 B | 2/2 workers, 10/10 bitmaps | Pass |

The worker-job column is completion time, not click response. In particular,
the uncached 130 MB ONNX path took about 118.5 seconds under the constrained
network profile. The UI stayed inside its interaction and Long Task limits, but
the cold AI wait remains a product limitation rather than a fast-AI claim.

On Design entry, the 0.62 KB recommendation and 0.77 KB optimizer worker
entries each acknowledge readiness and terminate before the feature baseline.
The baseline therefore records three acquired, two released, and one active
worker; the one active worker is autosave. The heavy job chunks remain unloaded
until Recommend or Fit, and both job workers return afterward.

Evidence:

- [`recommend`](../artifacts/chromebook-audit/features/chromebook-feature-recommend-audit.json)
- [`designFit`](../artifacts/chromebook-audit/features/chromebook-feature-designFit-audit.json)
- [`traceGif`](../artifacts/chromebook-audit/features/chromebook-feature-traceGif-audit.json)
- [`deterministic aiImport`](../artifacts/chromebook-audit/features/chromebook-feature-aiImport-audit.json)
- [`actual ONNX aiImport`](../artifacts/chromebook-audit/real-ai/chromebook-feature-aiImport-audit.json)

## Balanced playback evidence

The 15.0-second Foundry sample recorded 1,796 browser rAF intervals. Frame
intervals were p50 8.3 ms, p95 9.2 ms, and p99 9.3 ms; no interval exceeded
50 ms or 200 ms. Play/Pause next-paint p95 was 52.8 ms. The sample recorded zero
Long Tasks, zero React playback commits, zero heap growth, and zero deltas for
live WebGL resources, contexts, topology builds, geometry cache, and material
cache.

This short sample is an interactive leak gate, not a ten-minute stabilization
claim. See the [`playback artifact`](../artifacts/chromebook-audit/playback/chromebook-playback-audit.json).

## Production bundle evidence

The static compressed production-shell gate reports 396,784 bytes of core JS
against a 450,000-byte limit and 899,787 bytes of initial shell assets against
a 1,500,000-byte limit. The initial shell consists of compressed HTML, the index
and App entries, the local wordmark font, and the already-compressed app icon.
The opt-in ONNX model and lazy AI, Rapier, recommendation, optimizer, and media
chunks are not counted unless they enter the initial shell graph.

This is a reproducible static compressed-size calculation, not an observed CDN
transfer measurement. See the [`bundle artifact`](../artifacts/chromebook-audit/bundle-budget.json).

## Recovery and release gates

The same production-preview work also verified AI-idle startup, package review
and missing-file recovery, legacy autosave migration, WebGL-unavailable fallback,
and restoration of the retained Foundry scene after context loss. Pull requests
run contracts, production and diagnostics builds, the bundle budget, and focused
browser recovery tests with three bounded Playwright workers.

The nightly/manual performance workflow keeps three explicit scopes:

- `feature`: the five short gates above.
- `full`: the short gates plus the Character-to-Assembly audit and ten-minute
  playback soak.
- `real-ai`: the explicit shipped-model import gate.

Neither verification workflow can deploy. The existing GitHub Pages workflow
remains tag-only.

## Boundaries and remaining P3 work

- Run the same gates on physical Chromebook hardware before changing the result
  label from `6× CPU emulation`.
- Obtain a nightly ten-minute artifact to make the long-run heap stabilization
  claim; it was not run locally in this acceptance pass.
- Measure warm-cache actual-model completion separately. The cold-model result
  proves responsiveness and ownership, not acceptable classroom wait time.
- The new GitHub workflows were source- and YAML-validated locally but have not
  yet run on GitHub-hosted runners.

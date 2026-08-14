# G3 result

G3 is complete. MotionSmith now uses explicit Foundry root lifecycle states,
prepared structural models, retained angle-only frame bindings, one measured
foreground playback driver, shared latest-only gesture queues, a single
Foundry render-submission queue, and exact-once Three resource teardown.

## Verified behavior

- Valid roots attach before old-root disposal; authoritative invalid project
  replacement clears stale geometry; only a rejected edit retains the old root.
- Ordinary playback/scrub frames use prepared simulation inputs and retained
  owner bindings. They perform no catalog search, mechanism compilation,
  normalization, structural traversal, or Three-root rebuild.
- One animation driver schedules one RAF and one 150 ms watchdog. Foreground
  RAF always wins; genuine stalls recover; coincident callbacks advance once;
  stop/unmount cancels both.
- Foundry has one renderer submission site. The foreground Orca probe observed
  402 WebGL clears in 402 RAF buckets, maximum one clear per bucket, and zero
  clears outside the wrapped RAF.
- Path, Foundry parameters, connection handles, inspector ranges, all CAD
  cameras, and cam-profile edits coalesce pointer bursts to the latest sample
  per display frame. Pointer up/cancel/lost-capture routes flush or cancel the
  correct terminal sample; replacement/unmount discards stale callbacks.
- Camera/explode/tab state remains stage-local. Select-only puppet
  manipulation stays immediate instead of entering the camera queue.
- Geometry, materials, and textures use stable cache ownership. Shared
  resources dispose exactly once and every cache clears on teardown.
- Automatic Fit feedback and authoritative boolean edit results survive the
  Design adapter; physical edits still enter the frozen G1 safety boundary.

## Quantitative evidence

The deciding measurement is [performance.json](performance.json). It ran in
the visible, foreground Orca embedded production preview at
`http://127.0.0.1:5197/`.

- Playback-only simulation drift: 0.4263° over 6383.9 ms.
- Frame intervals: p50 8.4 ms, p95 50 ms, p99 50.9 ms, max 66.7 ms.
- Input-to-visual samples: 0.4–0.7 ms; p95 0.7 ms.
- Long tasks: 10, total 549 ms, max 60 ms over 35.84 seconds. This is raw
  observer evidence, not an attribution claim.
- Structural builds during playback: 0; historical baseline: 79.
- Geometry/material caches: 10/10 before and after.
- Hidden-to-visible recovery: phase advanced 234° to 281° with build count
  stable at 1.

The candidate p95 frame interval is 33.3% lower and p99 is 49.1% lower than
the historical foreground baseline (75 ms and 100 ms). A background/occluded
sample and a drift sample whose clock began while paused were explicitly
discarded.

## Evidence and gates

- Lifecycle: `tests/g3-foundry-lifecycle.test.ts`.
- Retained frame and assembly bindings:
  `tests/g3-foundry-retained-frame.test.ts`.
- Animation-driver leaks/fallback: `tests/g3-animation-clock.test.ts`.
- Resource allocation/disposal: `tests/g3-three-resource-kit.test.ts`.
- Frame queues/cadence: `tests/g3-frame-commit-queue.test.ts` and the focused
  Path, connection, Foundry-param, camera, and cam-profile contracts.
- Render submission: `tests/g3-foundry-render-submission.test.ts` plus the Orca
  WebGL probe.
- Production-preview browser gate: shared scene ownership, Foundry playback
  performance, and CAD camera preset/drag flows; 3 passed in 36.6 seconds.
- `bunx tsc --noEmit`, `bun run build`, `bun tests/project-contract.test.ts`,
  and `git diff --check` passed in deciding slices.

Raw stdout, review corrections, and Orca identifiers are retained in the other
files under `artifacts/quality/G3/`.

## Historical disposition

All 19 single-lane G3 commits are `VERIFIED_CLEAN_IMPLEMENTATION`; none was
replayed. G3-only hunks from mixed commit `283e0be9` are finalized in the hunk
ledger. Its two G3+G4 browser-characterization hunks remain parent-row work for
G9 after both lane results are available. See
[historical-dispositions.md](historical-dispositions.md).

## Intentional omissions

- No historical fixed 4 ms poll, 64 ms constant, low-mode compatibility layer,
  second renderer, or second scene representation.
- No domain acceptance-policy change, speculative renderer abstraction, or
  dependency addition.
- No performance claim from an occluded/background Orca window.
- No claim that raw long tasks were caused by MotionSmith rather than the Orca
  host; G8 owns the later attributable telemetry A/B threshold.

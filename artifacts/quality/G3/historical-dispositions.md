# G3 historical dispositions

No historical commit was cherry-picked. The quality pass inspected the old
intent and accepted the smaller clean-implementation seams listed below.

## Renderer and stage behavior — `VERIFIED_CLEAN_IMPLEMENTATION`

- `0b9b1979` — lifecycle state is explicit; valid replacement attaches before
  disposal, authoritative invalid replacement clears, and only rejected edits
  retain the prior root. Accepted seams: `e058ddf`, `e410685`.
- `078d8cea` — retained owners are updated through prepared binding tables
  without structural traversal; render-space transforms and exploded spacer Z
  are fixture-tested. Accepted seams: `256df49`, `bc6aa84`.
- `b6fadabc` — Design and Assembly consume prepared structural models and sample
  angle-only frames. Accepted seams: `e7f45be`, `3c86589`, `32f6c93`.
- `8628dfa3` — authoritative project replacement, rejected retention, cache
  status, and Foundry transaction behavior are covered by the lifecycle and
  production-preview gates. Accepted seams: `e058ddf`, `256df49`.
- `3431186e` — snapped fabrication combinations remain authoritative through
  the frozen G1 update boundary and the Design boolean result is preserved.
  Accepted seams: `a52ef5d`, `9af0012`.
- `24013add` — automatic Fit snap feedback remains visible after a successful
  authoritative commit. Accepted seam: `7401c1a`.
- `8b2f3ee1` — projected connection handles are bounded, keyboard/pointer
  accessible, frame-coalesced, and terminally committed. Accepted seams:
  `d6225a2`, `988c8cf`.
- `5e52d575` — Assembly owns its local explode state and samples a prepared
  scene; the shared Foundry renderer consumes the derived presentation.
  Accepted seams: `40f88f2`, `32f6c93`, `256df49`.

## Playback and render performance — `VERIFIED_CLEAN_IMPLEMENTATION`

- `6c52e204` — structural preparation and angle-only frame sampling are split
  across Foundry, Design, Assembly, and the puppet preview. Accepted seams:
  `e02c336`, `e7f45be`, `801bd68`, `256df49`.
- `7a26b4a7` — historical low-resource polling constants are rejected. The
  current driver follows native RAF and uses the measured 150 ms genuine-stall
  watchdog. Accepted seam: `7fa49cb`.
- `8485dcf5` — Foundry render submission is latest-only and enters one shared
  display-frame queue. Accepted seams: `256df49`, `9b2ad85`.
- `516c764b` — Path drawing, handle editing, and pan commit at shared
  display-frame cadence and flush terminal samples. Accepted seams: `2a7f31d`,
  `d3700a7`.
- `a9c6a990` — Foundry and Assembly use the same measured animation driver;
  stage-local playback state remains local. Accepted seam: `7fa49cb`.
- `345b6196` — Assembly/Foundry presentation reuses retained frame bindings,
  including distinct spacer ordinals and fixed spanning hardware. Accepted
  seams: `40f88f2`, `256df49`.
- `9c32a7c6` — constrained presentation is covered by prepared-envelope,
  support-point, automata-scene, and retained-binding fixtures. Accepted seams:
  `ab6beb0`, `7beae5c`, `e7f45be`, `256df49`.
- `f2e50c82` — fallback advances only after the measured foreground RAF maximum
  plus margin. Accepted seam: `7fa49cb`.
- `a508a102` — one driver owns one RAF and one watchdog; stop/unmount cancels
  both and a coincident RAF/fallback advances once. Accepted seam: `7fa49cb`.
- `29138b23` — the historical prescriptive plan is superseded by measured
  implementation evidence; no old timing constant or compatibility layer was
  restored.
- `f566c870` — Foundry, Path, camera, inspector, connection, and cam-profile
  pointer bursts use latest-only frame queues with terminal flush/cancel rules.
  Accepted seams: `e16f1c8`, `988c8cf`, `d4651e8`, `2a7f31d`, `d3700a7`,
  `4aec375`, `9b2ad85`.

## Mixed commit `283e0be9` — G3 hunks

The renderer texture-cache hunks are verified through the shared resource kit:
cache ownership is stable, material texture maps dispose exactly once, and the
runtime geometry/material caches remain at 10/10 during playback. Pointer
cadence, rejected-number restoration, grid-pitch stepping, Path finalization,
and cross-stage browser characterization are covered by the accepted G3 seams
and production-preview flows. Historical inline scheduling/cache code was
replaced by shared queues, prepared models, and `utils/threeResourceKit.ts`.

The parent mixed row remains pending until G8 finalizes its telemetry hunks.

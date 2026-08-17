# b695 Visual-Lock Performance Backport Plan

**Immutable UX baseline:** `b695b02275d03506969f2d13c98bc38107c17e0e`
**Donor branch:** `perf/unified-three-sol` at `983c421348e83c07b7d5a49f4517ec8efbaca6bc` when audited
**Commit range:** 122 commits after the baseline
**Execution model:** Luna Max only
**Primary rule:** no canvas appearance, controls, camera result, material, geometry, layout, animation path, or interaction output may change.

## 1. Decision

Do not repair `perf/unified-three-sol` in place.

Create a clean branch and worktree from the visual authority:

```bash
git worktree add ../ms-wt/b695-visual-lock   -b perf/b695-visual-lock   b695b02275d03506969f2d13c98bc38107c17e0e
```

Keep `perf/unified-three-sol` read-only as a donor branch.

The unified-workbench branch contains useful performance ideas, but its main gains are entangled with renderer replacement, fixed-view stage migration, camera changes, live SVG removal, prepared-scene contracts, and later visual recovery. Blindly cherry-picking those commits defeats the baseline decision.

## 2. Audit result

The complete row-by-row disposition is in `B695_VISUAL_LOCK_COMMIT_LEDGER.tsv`.

Recommended-action counts:

```json
{
  "skip": 12,
  "exclude from performance pack": 26,
  "reject under visual lock": 34,
  "evidence only": 36,
  "do not cherry-pick": 3,
  "conditional partial cherry-pick": 1,
  "reject whole commit": 1,
  "optional partial cherry-pick": 1,
  "manual backport": 4,
  "partial cherry-pick candidate": 1,
  "intent-only backport": 1,
  "manual redesign": 2
}
```

Category counts:

```json
{
  "checkpoint or merge": 6,
  "mechanism or fabrication behavior": 26,
  "visual, interaction, or stage architecture": 34,
  "tests, evidence, docs, CI, or release": 34,
  "fabrication tooling or repository migration": 6,
  "performance donor coupled to renderer or output changes": 3,
  "visual-neutral performance donor": 7,
  "mixed release aggregation": 1,
  "optional nonvisual correctness": 1,
  "unified-workbench architecture contract": 1,
  "telemetry or study collection": 3
}
```

Only a small donor set is suitable for visual-neutral work:

| Bundle | Donor commits | Apply mode | Why |
|---|---|---|---|
| P1 Lazy AI | `1716660` | partial cherry-pick candidate | Removes boot ONNX warmup and retires successful Workers without touching canvas rendering. |
| P2 Async autosave | `5f5e2a8` | manual backport | Keeps serialization and storage writes off gesture/playback hot paths. |
| P3 Inspector cache | `89c0abe` | manual backport | Avoids compile/readiness/safe-range analysis during phase-only renders. |
| P4 Diagnostics gate | `87b7e30` plus baseline-specific code | manual backport | Compiles E2E diagnostics out of production and removes per-frame scene traversal, JSON, and dataset writes. |
| P5 React-free playback | `613d83e`, `e06357d`, `cdd7cae` as references only | baseline-specific implementation | Largest CPU gain, but donor commits depend on the replacement renderer. Preserve b695 renderers and output exactly. |
| P6 Allocation and projection reuse | performance audit, no safe donor commit | manual implementation | Reuse camera, Box3, vectors, maps, arrays, and IK scratch buffers. |
| P7 Fit early return | `10a0a589` | conditional partial cherry-pick | Stops generic fallback only after an accepted four-bar result. |
| P8 Blueprint cache | `78964d5` | manual backport | Move model preparation outside React render while preserving the exact document and export bytes. |
| T1 Final study artifact | `de88b12`, `29c335e` | manual redesign | Replace continuous collection with one bounded final semantic artifact. |

## 3. Visual-lock contract

Before the first patch, record the baseline in the same production browser and viewport.

### Frozen files and properties

No patch may change these unless a hunk is proven byte-identical in output:

- `index.html` canvas and controller CSS;
- renderer creation options;
- camera preset constants and transition behavior;
- materials, lights, opacity, colors, line widths, textures, anisotropy, z-order, and background;
- canvas/SVG JSX structure and controller labels;
- viewBox, canvas bounds, aspect ratio, and viewport mapping;
- layer default visibility;
- mechanism, path, joint, pin, spacer, and part geometry;
- animation duration, timing profile, phase mapping, and visible motion;
- pointer, wheel, keyboard, selection, drawing, Fit, export, and stage-navigation results.

### Golden evidence

Capture at 1366×768 and 1440×900:

- Character front and isometric;
- Path paused and phases 0°, 45°, 90°, 180°, 270°;
- Foundry front, isometric, all visible overlays, and the same phase set;
- Design front and isometric with character, path, and mechanism;
- Blueprint document and exported SVG/PDF hashes;
- Assembly representative steps.

For deterministic static frames require zero screenshot pixel difference. If WebGL antialiasing is nondeterministic in the harness, additionally require exact camera/material/geometry hashes and use a tightly bounded image threshold only for antialiased edge pixels.

### Runtime parity

At fixed phases, compare:

- path coordinates;
- skeleton joint coordinates;
- part transforms;
- scene-object transforms;
- mechanism state;
- overlay endpoints;
- camera matrices;
- selected IDs and control states.

The playback-runtime patch is accepted only if phase progression and sampled outputs match b695.

## 4. Patch bundle

## Commit A: lazy AI

```text
perf(ai): remove boot model warming
```

Source intent: `1716660`.

Requirements:

- boot does not create an AI Worker;
- boot does not request or read the model cache;
- explicit image import still behaves exactly as b695;
- cancellation and supersession remain correct;
- successful standalone work releases the Worker/session;
- no canvas, controller, CSS, or stage markup file changes.

Apply with `git cherry-pick -n` only in the dedicated worktree. Keep only compatible AI files and reimplement conflicts manually.

## Commit B: autosave off the gesture path

```text
perf(persistence): coalesce and workerize autosave
```

Source intent: `5f5e2a8`.

Requirements:

- pointer/frame updates perform no synchronous project serialization or localStorage write;
- one latest accepted project is serialized after idle;
- stale Worker responses are rejected;
- pagehide flushes prepared bytes or a dirty marker, not a fresh serialization;
- crash recovery and generation checks stay intact;
- save indicators and recovery UX remain exactly b695.

This is a manual backport because the donor depends on later transaction modules.

## Commit C: inspector analysis cache

```text
perf(inspector): cache edit analysis by semantic revision
```

Source intent: `89c0abe`.

Cache:

- fabrication compilation;
- project readiness;
- feasible range;
- safe numeric ranges;
- catalog option validity;
- connection confirmation derivation.

Do not copy the donor's conditional unmounting of advanced controls. Preserve b695 DOM, labels, disabled choices, tab order, and details behavior. Only replace repeated calculations with a bounded cache keyed by relevant project/mechanism/kit/binding revisions.

## Commit D: production diagnostic compile-out

```text
perf(diagnostics): remove E2E probes from production frames
```

Source intent: `87b7e30`.

Add a literal build-time profile:

```text
default build: diagnostics false
E2E build: diagnostics true
study build: diagnostics false
study + E2E: rejected
```

In the existing b695 renderer paths, production must execute zero:

- `Box3.setFromObject` for test screen targets;
- full scene-target traversal;
- diagnostic `JSON.stringify`;
- frame-by-frame `data-*` writes;
- state-probe summary construction.

Tests use a test-only pull store or the existing attributes only in the E2E build. The visible scene is unchanged.

## Commit E: baseline-specific React-free playback

```text
perf(playback): move phase sampling off React without changing output
```

Donor commits are references only. Do not cherry-pick `cdd7cae`, `e06357d`, or `613d83e`.

Keep the b695 renderer, canvas, DOM, SVG, camera, material, and interaction implementation. Introduce one external playback clock that:

- owns mutable phase;
- applies the exact existing formulas;
- updates existing Three object refs and SVG/DOM refs directly;
- publishes control readouts at no more than 10 Hz;
- creates no second renderer or alternate scene;
- makes zero React animation commits.

Do not make any side preview static. The donor `abd9e9e` is explicitly rejected because it removes visible animation.

This is the largest performance task and should start only after Commit D freezes static visual evidence.

## Commit F: allocation-free frame helpers

```text
perf(frame): reuse projection and IK scratch state
```

Without changing formulas or output:

- reuse the actual renderer camera;
- reuse `Vector2`, `Vector3`, `Box3`, `Raycaster`, arrays, maps, and frame records;
- prepare path segments and IK chains only after edits;
- use mutable numeric buffers during playback;
- remove frame-local `JSON.stringify`, object spreads, and project-like pose graphs;
- preserve exact fixed-phase output.

This may be combined with Commit E if the same Luna owner can prove a single visual-parity milestone. Do not create a generic replacement scene.

## Commit G: accepted Fit early return

```text
perf(fit): stop after an accepted four-bar fit
```

Source: `10a0a589`.

The donor changes only evaluation order: compute the four-bar result first and return it when accepted before building the generic fallback. Apply only when:

- accepted and rejected results are deeply equal to b695 across the committed fixture matrix;
- generated paths, warnings, snapped values, selected mechanisms, and readiness are identical;
- no observable progress or status behavior changes.

Do not backport `8280ce6` in the visual-lock pack. It changes discovery limits, coarse trace resolution, ranking, and materialization and can select a different Fit result.

## Commit H: Blueprint preparation cache

```text
perf(blueprint): cache exact preview and package models
```

Source intent: `78964d5`.

Preserve the complete b695 Blueprint DOM and immediate visible result. Cache validation, recipes, contracts, and exact preview SVG by fabrication revision. Do not replace the Blueprint canvas or defer a currently visible proof unless the baseline UX remains identical.

## Commit I: final study artifact

```text
study: emit one final semantic artifact
```

Do not cherry-pick the donor commits because they depend on `PreparedWorkbenchScene`.

On b695, create one artifact at fabrication-ready Blueprint entry or successful package generation from data already owned by the product:

- sorted character parts and joint topology;
- rest transforms;
- path points and duration;
- mechanism type, canonical parameters, connection selections, anchor, and target binding;
- fabrication signature/readiness;
- Blueprint reached and package generated flags.

Optional motion samples may be included only if produced from the exact baseline sampler outside playback and validated against it.

Exclude:

- raw frames or screenshots;
- pointer and command streams;
- continuous stage counters;
- autosave and inference timing;
- errors and messages;
- undo history;
- source images and masks;
- replay, snapshots, durable outbox, retry, compression work during playback, and pagehide serialization.

Default builds compile the study path out. Study builds perform no work during playback and send at most one prepared payload.

## 5. Commits explicitly rejected

Do not cherry-pick:

- the six latest UI/render-quality recovery commits, because b695 already owns the desired visual result;
- persistent renderer, orthographic shell, stage migration, camera, path, Foundry, Design, Assembly, Blueprint-view, and live-SVG-removal commits;
- `abd9e9e`, because it makes a visible side preview static;
- `8280ce6`, because it can change Fit selection;
- `a363e5d`, because it is a mixed release aggregation;
- mechanism/fabrication authority and board commits unless a separate correctness project explicitly approves their UX and output changes;
- test/docs/audit commits as production patches.

## 6. Luna Max worktree plan

All agents use Luna Max.

1. `luna-history`: maintain the 122-row ledger and visual-lock baseline evidence.
2. `luna-io`: Commit A and B.
3. `luna-analysis-cache`: Commit C and D.
4. `luna-playback`: Commit E and F.
5. `luna-fit-blueprint`: Commit G and H.
6. `luna-study`: Commit I.
7. `luna-qa`: visual parity, runtime parity, production proxy, and final report. It does not patch production code.

The integration lead cherry-picks only newly created b695 backport commits, never the donor architecture commits.

## 7. Validation cadence

Per backport commit:

```text
bun run build
one focused browser flow
visual-lock static screenshot set for the affected stage
git diff --check
```

After Commit D:

```text
production bundle marker scan
E2E build flow
full static screenshot lock
```

After Commit F:

```text
Path, Foundry, and Design fixed-phase numeric parity
React commit count
frame p50/p95/p99
five-minute proxy soak
```

Final:

```text
bun run test
bun run build
focused browser workflow
all visual-lock screenshots
export byte hashes
CPU-throttled production proxy
study default/study bundle scans
```

Actual Chromebook hardware is unavailable, so report `proxy passed` or `proxy failed`, never `Chromebook certified`.

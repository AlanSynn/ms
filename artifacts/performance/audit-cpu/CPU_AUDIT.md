# Chromebook CPU hot-path audit

## Scope and verdict

Baseline: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`
Captured: 2026-08-14, Chromium `149.0.7827.55`, headless, 1366 x 768, DPR 1
Fixture: guided `waving-arm`; optional ONNX payload intentionally returned HTTP
503 after its startup request was recorded.

The high-confidence finding is not a renderer-swap problem. Foundry and Design
run safety, feasibility, compiler, and candidate work from React playback
renders. The observed fan-out is severe enough to dominate CPU risk before any
WebGL-specific tuning. Path SVG also performs exactly two independent
`motionPreviewForPath` calls per observed rAF timestamp.

No production code changed in this audit. The production call-count delta from
the baseline is **0 for every path**; the values below are observations from a
counter-only audit build, not changed behavior.

## Evidence qualification

The browser harness separates stage entry from steady playback except for
Blueprint, whose purpose here is entry. It records each counter as an exact
integer, then divides by the measured window duration. `rAF proxy` means a
distinct timestamp delivered to a wrapped `requestAnimationFrame` callback. It
is not proof of a physically presented compositor frame. Where a Three render
is visible, WebGL `clear` is reported separately as a render-call proxy, also
not as presentation proof.

The absolute timing, allocation, heap, LoAF, and frame-proxy results are
developer-host diagnostic evidence only. They are not Chromebook performance,
thermal, battery, GPU-driver, or physical presentation measurements. All exact
raw numerators and unrounded rates are in
[`raw/runtime-evidence.json`](raw/runtime-evidence.json).

The audit transform adds a counter at selected function entry and wraps selected
`JSON.stringify` calls. That preserves application output but makes this an
instrumented build, not a pristine timing benchmark. CPU and allocation profiles
are also minified and lack usable source maps, so source-level stacks below are
counter- and callsite-attributed rather than falsely precise profiler names.

## Runtime coverage and exact counter values

Rates in this table are `count / observed window seconds`; values after `/ rAF`
are `count / rAF proxy`. A dash means there was no useful counter for that
stage, not that the function is absent from the product.

| Stage and sampling mode | Window / rAF proxy / React commits | Key exact runtime counters |
| --- | --- | --- |
| Path SVG, steady after entry and 700 ms warmup | 2.588600 s / 164 / 164 | `PathEditor` 164 = 63.354709/s = 1/rAF; `SceneSketch` 164 = 63.354709/s = 1/rAF; `motionPreviewForPath` **328 = 126.709418/s = 2/rAF** |
| Path Three, steady after entry and warmup | 2.625300 s / 15 / 13 | `motionPreviewForPath` 13 = 4.951815/s = 0.866667/rAF; Three `render` and screen-target collection 65 = 24.759075/s = 4.333333/rAF; `Box3.setFromObject` **910 = 346.627052/s = 60.666667/rAF**; 65 WebGL clears means exactly 14 Box3 calls per clear |
| Foundry, steady after entry and warmup | 2.779400 s / 21 / 21 | Foundry, workflow, inspector, and parametric editor each 20 = 7.195798/s = 0.952381/rAF; safety chain and compiler values below |
| Design, steady after entry and warmup | 2.748600 s / 31 / 30 | Design and Design inspector 30 = 10.914647/s = 0.967742/rAF; parametric editor 30; prepared motion sampling 60 = 21.829295/s = 1.935484/rAF; safety chain and compiler values below |
| Blueprint, entry plus post-entry | 4.288500 s / 12 / 12 | Blueprint render, `validateForFabrication`, and `makeBlueprintPreviewSvg` each 1 = 0.233182/s; the window also contains 10 carried-over Design renders, so do not read it as a Blueprint steady-state result |
| Assembly, steady after entry and warmup | 2.539500 s / 78 / 77 | Assembly guide and `validateForFabrication` each **77 = 30.320929/s = 0.987179/rAF**; `withAssemblySceneProgress`, `projectMechanismReadiness`, and `samplePreparedMotionPreview` each 154 = 60.641859/s = 1.974359/rAF |

### Required domain work observed

| Function / chain | Foundry | Design | Blueprint entry | Assembly | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| `compileMechanismGraphFabrication` | 1,161 = 417.716054/s = 55.285714/rAF | 1,200 = 436.585898/s = 38.709677/rAF | 404 = 94.205433/s = 33.666667/rAF | 308 = 121.283717/s = 3.948718/rAF | Reached through safety, readiness, inspection, and candidate work, not just a single stage render. |
| `projectMechanismReadiness` | 0 | 30 = 10.914647/s = 0.967742/rAF | 13 = 3.031363/s = 1.083333/rAF | 154 = 60.641859/s = 1.974359/rAF | The Design and Assembly ownership paths are live. |
| `sampleFeasibleRange` | 660 = 237.461323/s = 31.428571/rAF | 1,020 = 371.098014/s = 32.903226/rAF | 344 = 80.214527/s = 28.666667/rAF | 4 = 1.575113/s = 0.051282/rAF | Large sample fan-out occurs in Foundry and Design. |
| `motionSafeParamRange` | 160 = 57.566381/s = 7.619048/rAF | 210 = 76.402532/s = 6.774194/rAF | 70 = 16.322724/s = 5.833333/rAF | 0 | Parameter-range UI participates in the playback path. |
| `mechanismEditIsSafe` | 3,700 = 1,331.222566/s = 176.190476/rAF | 5,340 = 1,942.807247/s = 172.258065/rAF | 1,785 = 416.229451/s = 148.750000/rAF | 156 = 61.429415/s = 2/rAF | This is the direct safety decision fan-out. |
| safety phase linkage evaluations | 3,720 = 1,338.418364/s = 177.142857/rAF | 5,370 = 1,953.721895/s = 173.225806/rAF | 1,795 = 418.561269/s = 149.583333/rAF | 156 = 61.429415/s = 2/rAF | `mechanismHasFiniteValidStates` instrumentation; schedule calls are 3,720 / 5,400 / 1,808 / 310 respectively. |
| `calculateLinkage` | 238,021 = 85,637.547677/s = 11,334.333333/rAF | 351,060 = 127,723.204545/s = 11,324.516129/rAF | 117,526 = 27,404.920135/s = 9,793.833333/rAF | 8,246 = 3,247.095885/s = 105.717949/rAF | The immediate linkage loop is the largest named call volume. |
| `prepareMechanismKinematics` | 238,762 = 85,904.151980/s = 11,369.619048/rAF | 351,240 = 127,788.692430/s = 11,330.322581/rAF | 117,590 = 27,419.843768/s = 9,799.166667/rAF | 8,479 = 3,338.846230/s = 108.705128/rAF | Re-preparation is tightly coupled to the linkage loop. |
| `mechanismPhysicalConnectionCandidates` and raw candidates | 20 = 7.195798/s = 0.952381/rAF each | 30 = 10.914647/s = 0.967742/rAF each | 10 = 2.331818/s = 0.833333/rAF each | 0 | Candidate projection runs about once per active animation rAF and preflights safety/compiler work. |
| `createFoundryPlaybackFrame` / prepared frame | 380 = 136.720155/s = 18.095238/rAF each | 0 / 30 = 10.914647/s = 0.967742/rAF | 0 / 10 = 2.331818/s = 0.833333/rAF | 0 / 77 = 30.320929/s = 0.987179/rAF | Foundry gallery/frame construction is a distinct repeated contributor. |
| Foundry traces / prepared traces | 200 = 71.957977/s = 9.523810/rAF each | 120 = 43.658590/s = 3.870968/rAF each | 40 = 9.327271/s = 3.333333/rAF each | 0 / 1 | Trace generation is also driven from active stage renders. |
| `samplePreparedMotionPreview` | 0 | 60 = 21.829295/s = 1.935484/rAF | 20 = 4.663635/s = 1.666667/rAF | 154 = 60.641859/s = 1.974359/rAF | Prepared sampling is present, but it coexists with the costly validation paths. |

`Box3.setFromObject` is runtime-measured in Path Three as shown above. The
instrumented Foundry `writeFoundryCameraDiagnostics` contains the same static
callsite but recorded 0 executions with this fixture's screen-target override;
that Foundry-specific Box3 cost is static-only/missing runtime evidence.

## Five dominant execution stacks

These are ranked as practical CPU-risk stacks from executed named-call volume,
sampled allocations, React commit coupling, and LoAF evidence. They are not
claimed to be source-mapped inclusive CPU rankings because the production-like
bundle profile is minified.

1. **Design inspector -> safe parameter range -> edit safety -> phase schedule -> linkage -> kinematics.** Thirty Design inspector renders across 31 rAF proxies trigger 5,340 edit-safety checks, 351,060 linkage calculations, and 351,240 kinematics preparations. The top 20 sampled allocation stacks sum to 1,103,050,152 bytes during the 2.748600 s window (sampling estimate, not exact allocated bytes); Design has 26 LoAF entries, maximum 100.5 ms.

2. **Foundry inspector/parametric editor -> feasibility/safety/compiler chain.** Twenty Foundry stage renders across 21 rAF proxies trigger 3,700 edit-safety checks, 238,021 linkage calculations, 660 feasibility samples, and 1,161 compiler calls. The top 20 sampled allocation stacks sum to 679,305,864 bytes in 2.779400 s; Foundry has 16 LoAF entries, maximum 140 ms.

3. **Assembly playback -> `validateForFabrication` -> readiness/compiler/safety -> scene progress.** `AssemblyGuide` validates once for essentially every rAF proxy, then reaches readiness twice and compiler about four times per proxy. This is lower than Foundry/Design but still makes build validation part of the playback loop. The top 20 sampled allocation stacks sum to 146,668,304 bytes; the live heap changes by only +178,184 bytes, showing why retained heap is not a churn measure.

4. **Path SVG playback -> `PathEditor` plus `SceneSketch` -> duplicate motion solve.** This is the cleanest exact duplication: 164 editor renders plus 164 sketch renders produce 328 `motionPreviewForPath` calls across 164 rAF proxies, exactly two solves per proxy. It is a lower absolute-cost candidate than the safety chain but a direct duplicated computation on the user-facing drawing path.

5. **Path Three render -> screen-target collection -> `Box3.setFromObject` and diagnostic JSON.** In the steady Path Three window, 65 renderer calls cause 65 screen-target collections and 910 Box3 traversals (14 per WebGL clear), plus 221 diagnostic serializations totaling 132,978 bytes. This stack is directly measured but has no physical presented-frame proof; it must be confirmed on a Chromebook before assigning a frame budget.

Connection candidate enumeration is not a separate top-five row because it is
inside stacks 1 and 2, but it is not benign: it runs once per rAF proxy in both
stages and reaches the same safety/compiler preflight path.

## React, JSON, autosave, allocation, GC, and LoAF

### React commit evidence

The DevTools hook observed 164 Path SVG commits for 164 rAF proxies, 21 Foundry
commits for 21, 30 Design commits for 31, and 77 Assembly commits for 78. That
is runtime evidence that the stage component trees are tied to playback state;
it is not an inference from source alone.

### Diagnostic JSON

`genericJson` counts every wrapped `JSON.stringify`, including the named
diagnostic calls below; do not sum the two columns.

| Stage | All observed JSON calls / bytes | Named diagnostic split |
| --- | --- | --- |
| Path SVG | 0 / 0 | none in steady state |
| Path Three | 221 / 132,978 | ThreePuppet 221 / 132,978 |
| Foundry | 100 / 11,599 | ThreeFoundry 60 / 4,500; Foundry state probe 40 / 7,099 |
| Design | 152 / 76,350 | ThreeFoundry 92 / 65,842; Foundry state probe 60 / 10,508 |
| Blueprint entry | 53 / 58,040 | ThreeFoundry 32 / 23,210; Foundry state probe 20 / 3,498; one other call |
| Assembly | 379 / 34,946 | ThreeFoundry 225 / 17,544; Foundry state probe 154 / 17,402 |

### Autosave

Static evidence proves the project-change effect reaches `writeAutosaveSnapshot`
and `serializeProject`; see `autosave-serializes-project` in
[`raw/static-evidence.json`](raw/static-evidence.json). Runtime evidence for
this exact fixture is **absent**: it made no persisted `ProjectState` mutation,
so there were 0 `autosave.writeSnapshot` hits, 0 `serializeProject` hits, and 0
localStorage writes in all six measured windows. This audit therefore does not
claim an autosave hot path or a serialization byte rate. A future controlled
project-mutation trace is required before making that claim.

### Allocations and GC

The allocation profiles are sampled `HeapProfiler` data. The large top-20 sums
above support high allocation churn in Foundry/Design, but are not exact total
allocation bytes. Live JS heap falls by 21,918,296 bytes in Foundry and
22,773,112 bytes in Design during their windows, consistent with collection and
therefore counterevidence against interpreting live heap as allocation volume.

The global Chrome trace contains 279 `MinorGC` events totaling 165,252 us and
14 `MajorGC` events totaling 62,507 us. The trace spans the whole audit rather
than stage-bounded markers, so those GC totals cannot be assigned safely to one
stage. Raw sampled allocation profiles and the V8 trace are preserved under
`raw/`.

### LoAF stacks

LoAF evidence is runtime evidence: Foundry 16 (max 140 ms), Design 26 (max
100.5 ms), Blueprint entry 14 (max 110.4 ms), Assembly 1 (max 121.7 ms), Path
SVG 1 (max 99 ms), and Path Three 0. The top Foundry/Design entries name a
minified `MessagePort.onmessage` function (`O`), while the Assembly maximum
also contains a `ResizeObserverCallback` (`pa`). The raw entries retain the
source URLs and character positions, but no source map was generated, so a
more specific source-function attribution would be invented.

## Strongest counterevidence and unresolved risks

- This is not Chromebook evidence. There is no physical presentation, device
  thermal, battery, hardware, or driver measurement. The rAF and WebGL-clear
  figures are proxies only.
- The headless session produced WebGL warnings including `texSubImage2D: bad
  image data` and immutable texture errors. They were not page errors and may
  be backend-specific; they should not be assigned to ChromeOS without a real
  device trace.
- CPU profiles identify minified bundle locations and native `(program)` time,
  not reliable source-mapped inclusive stacks. Named counters provide the
  source attribution; profiler samples only corroborate that substantial work
  occurs.
- Blueprint entry includes residual Design work during the route transition.
  The one direct Blueprint render/validation/preview call is observed, but its
  timing is not isolated from the transition.
- Path Three has 65 render/clear calls but only 15 rAF proxies. Effects and
  renderer work can run outside the wrapped rAF source, so calls/rAF must not
  be described as calls per presented frame.
- Autosave is static-only in this fixture, as described above.

## Recommended follow-up order

1. Cache or defer safety range, feasibility, compiler, and physical-candidate
   derivation by mechanism-plus-kit fingerprint; recompute on edit commit, not
   every playback render. Keep the shared domain authority rather than making
   a stage-local shortcut.
2. Keep playback sampling prepared and local to the renderer. Stop Foundry
   gallery trace/frame generation and inspector validation from following the
   local phase state.
3. Make Assembly playback consume a prepared fabrication/readiness snapshot so
   `validateForFabrication` is not called nearly once per rAF proxy.
4. Compute a single prepared Path motion preview and pass it to both SVG
   consumers, preserving the existing canonical motion contract.
5. Audit whether screen-target diagnostics are needed every Three render; cache
   bounds or update them only when scene/camera/selection changes, after
   preserving hit-test contracts.
6. On a representative Chromebook, collect a non-instrumented production
   trace with compositor frame data and one controlled persisted-project
   mutation before setting numeric performance or autosave targets.

## Raw evidence inventory

- [`raw/command-exit-codes.json`](raw/command-exit-codes.json) -- all commands
  and exit codes. Dependency install, static audit, typecheck, build, and
  browser audit exit 0; preview 143 is intentional shutdown.
- [`raw/runtime-evidence.json`](raw/runtime-evidence.json) -- all stage
  counters, exact unrounded rates, CPU profile summaries, sampled-allocation
  summaries, LoAF entries, metrics, and console/page errors.
- [`raw/static-evidence.json`](raw/static-evidence.json) -- source callsite
  assertions and line references.
- `raw/chrome-trace.json.gz` -- Chrome trace including V8 GC events.
- `raw/cpu-profile-*.json.gz` and `raw/allocation-profile-*.json.gz` -- per
  stage raw profiles; uncompressed copies remain locally ignored.

Earlier setup/methodology attempts are retained locally in `raw/attempt-*` and
ignored from the commit. Attempt 3 is a complete earlier run whose stage
windows included entry work; the final report uses the separated-entry run at
the top level.

# GPU/runtime baseline: unified Three.js Chromebook cutover

Status: diagnosis only — not a Chromebook acceptance result.

Baseline: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`.

The deciding run was a production preview in headed Chrome at 1366×768, DPR 1. Chrome reported ANGLE Metal on an Apple M1 Pro. The page remained `visible` and focused, but macOS `System Events` foreground inspection timed out; headed foreground verification is incomplete and this is not visible-Orca approval. No Intel or ARM Chromebook was available. Per the cutover plan, none of the timing or GPU figures below are claimed as actual-device/foreground evidence.

## Method and evidence boundary

`webgl-probe.js` is injected before the production bundle loads. It observes distinct WebGL contexts and wraps GL draw, clear, texture, shader, and program calls. Its clear-call proxy is calibrated on Path: `32,992,960 / 880 = 37,492` estimated triangles per clear, exactly matching the app’s exposed `renderer.info.render.triangles` value of `37,492`.

The probe does not patch `THREE.WebGLRenderer.render`, so a clear call is a calibrated render-submission proxy rather than a direct method hook. Texture bytes are a lower-bound estimate from `texImage2D`/`texStorage2D`; they exclude driver allocation, compression, compositor surfaces, and unobserved formats. `EXT_disjoint_timer_query_webgl2` was exposed but returned zero-nanosecond samples, so this audit has no usable GPU-duration measurement.

The source scan finds two stage-local renderer constructors, two direct submission sites, one `renderer.info` use (triangles only), and no source-level shader precompile, context-loss, `WEBGL_lose_context`, or visibility handlers. See [static-source-audit.json](raw/static-source-audit.json).

## Steady-state playback observations

The table uses GL clear calls as calibrated render-submission proxies. “Observed RAF” is the probe’s browser callback count, not a presented-frame measurement.

| Scenario | Observed RAF | Submission proxy | Submissions / observed RAF | Draw calls / submission | Triangles / submission |
|---|---:|---:|---:|---:|---:|
| Path Three playback | 175 | 880 | 5.029 | 176.0 | 37,492 |
| Foundry planetary playback | 34 | 31 | 0.912 | 38.0 | 9,378 |
| Design playback | 51 | 51 | 1.000 | 87.0 | 21,474 |
| Assembly playback | 253 | 245 | 0.968 | 118.6 | 25,423 |

Under the observed-RAF proxy, Path exceeds the target of at most one submission per presented runtime frame by 5.029× in this developer-reference run. The other three renderers coalesced to approximately one submission per observed callback, which is important counterevidence against blaming every renderer equally.

After each stage was warmed and paused, the 700 ms audit window recorded zero additional draws, clears, shader compiles, program links, texture changes, or context changes. This is further counterevidence: baseline paused scenes do use an effective dirty-render behavior over the sampled interval.

## Context lifetime and warm switching

The first Character entry created one tracked context. Each live Three stage then acquired another context, while the prior canvas detached. At each individual stage entry, only one tracked canvas was attached; detached contexts generally remained non-lost according to `gl.isContextLost()`.

| Transition checkpoint | New tracked contexts | New shader compiles | New program links |
|---|---:|---:|---:|
| Character → Path Three | 1 | 10 | 5 |
| Path SVG → Path Three | 1 | 10 | 5 |
| Path Three → Foundry | 1 | 6 | 3 |
| Foundry → Design* | 1 | 12 | 6 |
| Blueprint → Assembly | 1 | 6 | 3 |

\*This transition also restores the four-bar template before `Use mechanism`; it is not a pure stage-switch measurement.

Three complete Character → Path → Foundry → Design → Blueprint → Assembly loops added 15 tracked contexts, 126 shader-compile calls, and 63 program-link calls. The final snapshot had 21 tracked contexts, one attached context, 16 non-lost contexts, and 15 detached/non-lost contexts. Five older contexts later emitted `webglcontextlost` during the loop; this may be browser reclamation under context pressure, but the run cannot establish the browser’s physical GPU-allocation policy.

This is a material lifecycle risk for a 4 GB Chromebook, not conclusive driver-memory proof. It directly conflicts with the required persistent-runtime invariant of one renderer and one live context per editing session.

## Resource and memory evidence

The active Character context reported 18 live textures and an estimated 962,140 bytes (~0.92 MiB). Path Three used the same approximate active lower-bound. The active Design context reported 13 textures and an estimated 645,460 bytes; the active Foundry and Assembly contexts reported five small tracked textures each. After the loop, all tracked contexts summed to 141 live tracked textures and 2,599,320 estimated bytes (~2.48 MiB). These are only GL-call estimates, not GPU-memory totals.

JavaScript heap was available through `performance.memory`; `measureUserAgentSpecificMemory` was unavailable. The sampled high-water `usedJSHeapSize` was 90,337,276 bytes during planetary Foundry playback, with the final post-loop sample at 33,280,131 bytes. The fluctuation prevents a leak claim, but the trace records the evidence for device reruns.

The baseline renderer options are also not yet a Chromebook tier: both constructors request `{ antialias: true, alpha: true }`, and the shared cap is DPR 1.5 (effective DPR 1 in this run). The cutover target calls for opaque, non-antialiased DPR 1.

## Hidden/resume and context loss

The Chrome DevTools command `Emulation.setPageVisibilityState` was unavailable in this Chrome session. Therefore hidden/resume was not simulated, and no result is reported as hidden-tab evidence. Static scan also found no runtime `visibilitychange`, `document.hidden`, or `visibilityState` handler in the renderer/playback sources covered by the audit. The existing animation driver has a timeout fallback; it needs an explicit hidden/resume policy before Chromebook acceptance.

`WEBGL_lose_context` was available on the active Assembly context. The probe observed `webglcontextlost`, then `webglcontextrestored` 516.4 ms later after `restoreContext()`. No GL draw or clear followed the attempted wheel redraw, so this run does not prove that the restored in-place Assembly scene re-renders correctly. The app did remain navigable through the subsequent stage loop, but that is weaker than non-destructive in-place recovery.

## Prioritized deletion plan

1. Delete stage-owned `new THREE.WebGLRenderer` lifecycles in `ThreePuppetPreview` and `ThreeFoundryPreview`; replace them with the one persistent runtime before tuning disposal. Calling `forceContextLoss()` alone would mask context churn rather than remove it.
2. Delete the many stage-effect calls to `ThreePuppetPreview`’s local `render()` function and make the persistent runtime the only submission owner. Path’s 5.029 submission proxies per observed RAF is the first hard invariant failure to eliminate.
3. Delete warm-switch shader/program construction by retaining scene resources and precompiling the next prepared revision before an atomic swap. The measured entry deltas are 6–12 shader compiles and 3–6 program links per Three stage.
4. Delete fixed-view `MeshStandardMaterial`, decorative `EdgesGeometry`, and individually created repeated hardware from the hot path after lifecycle ownership is unified. Use the planned opaque DPR-1 unlit/Lambert material tier, merged static geometry, and instanced pins/spacers/handles; then rerun draw-call and real GPU-time measurement.
5. Delete the absent recovery gap by adding one runtime-owned visibility/context-loss boundary: pause clocks and overlays when hidden, reset time on resume, rebuild from a serializable prepared scene after restore, and expose an E2E-only recovery assertion.

## Strongest counterevidence and unresolved risk

- Paused steady windows submitted zero work, and Foundry/Design/Assembly remained near one submission proxy per observed RAF. A broad rewrite that treats every baseline renderer as equally broken would be unsupported.
- The trace is headed and the page says visible/focused, but system foreground verification failed. It must not be used to claim visible, unoccluded classroom performance.
- The device is Apple M1 Pro, not either required Chromebook family. No frame interval, GPU duration, thermal, or memory acceptance gate is proven.
- Timer-query availability alone is insufficient because every sampled duration was zero. GPU-time budgets remain unmeasured.
- Detached/non-lost context count is a strong browser-resource-lifetime signal, not a driver VRAM measurement. Rerun this exact harness on Intel N4500/N5100 and ARM MT8183/Kompanio Chromebooks with a visible, unoccluded foreground window.

## Raw evidence

- Successful run: [runtime-headful-attempt-3.json](raw/runtime-headful-attempt-3.json), [trace](raw/runtime-headful-attempt-3-trace.zip), and 17 screenshots in `screenshots/`.
- Static scan: [static-source-audit.json](raw/static-source-audit.json).
- Build: [build.log](raw/build.log), exit code `0` in [build.exit](raw/build.exit).
- Earlier failed harness attempts are intentionally preserved with their traces and exit codes under `raw/runtime-headful-attempt-1-*` and `raw/runtime-headful-*`. They are not used for the conclusions above.

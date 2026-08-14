# Chromebook CPU audit harness

This directory contains an audit-only production-mode Vite build and a focused
Chromium harness for the unified Three fixed-view cutover. It does not edit
production source; Vite inserts counter calls only into the audit build under
`instrumented-dist/`, which is ignored.

Run the complete audit from the repository root:

```sh
bun run artifacts/performance/audit-cpu/run-audit.mjs
```

The runner records the exit code and stdout/stderr for dependency installation,
the static source audit, TypeScript checking, the instrumented production build,
and browser audit. `preview` exits with `143` because the runner intentionally
terminates it after the browser closes; this is expected and is recorded in
`raw/command-exit-codes.json`.

The browser run opens the `waving-arm` guided project and covers Path SVG, Path
Three, Foundry playback, Design playback, Blueprint entry, and Assembly
playback. It gathers:

- function-entry counters and React DevTools commit callbacks;
- a requestAnimationFrame timestamp proxy and WebGL clear counts;
- CPU and sampled-allocation profiles, LoAF/long-task entries, and a V8 trace;
- JSON serialization byte counts and localStorage writes; and
- static callsite evidence for paths that did not execute under this fixture.

`raw/runtime-evidence.json` and `raw/static-evidence.json` are directly
readable. The trace and Chrome profiles are retained as both ignored
uncompressed local files and tracked `.json.gz` copies. For example:

```sh
gzip -dk artifacts/performance/audit-cpu/raw/chrome-trace.json.gz
```

Read [CPU_AUDIT.md](CPU_AUDIT.md) before treating the measurements as Chromebook
performance evidence. The call counters are runtime observations, but this
headless developer-host run has no real Chromebook hardware, thermal state, or
compositor-presented-frame proof.

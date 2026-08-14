# Visible Orca production-preview baseline

Status: **NON-DECIDING audit artifact**. The earlier UI samples were captured from an active Orca browser page with `visibilityState: "visible"`; however, Orca could not prove that the page was served by the exact manifest terminal. No hidden, headless, background, dev-server, or wrong-SHA sample is accepted as a production-performance decision.

Baseline: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af` on `audit/orca-baseline` in `/Users/alansynn/Workspace/ms-wt/qa-orca`.

## Constraint:

- Orca CLI resolved once to `/usr/local/bin/orca`. Before Orca commands, the worktree `AGENTS.md`, Orca skill stub, exact `skills get orca-cli` guide, fixed-view Chromebook plan, and unified goal pack were read.
- Required preview command: `VITE_BASE_PATH=/ms/ bun run preview -- --host 0.0.0.0 --port 4173`.
- The exact worktree was proven by Orca as head `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`, branch `refs/heads/audit/orca-baseline`.
- The browser page was assigned to that worktree and Orca reported it active at `http://127.0.0.1:4173/ms/`, with `visibilityState: "visible"` and `hidden: false`. `document.hasFocus()` was intermittent and is recorded rather than assumed.
- Orca terminal creation/send is the blocker: visible terminals were `connected:true`, `writable:true`, and `surface:"visible"`, but remained at a shell prompt. `terminal send` returned `accepted:true` while `terminal read` remained `latestCursor:"0"` with no echoed command or preview output, including for `pwd`.

## Evidence:

- Worktree/page/terminal IDs and exact JSON responses are in `raw/session.json` and `raw/visibility-blocker.json`.
- Orca PNG screenshot commands returned data for Path Editor, Foundry, Design, Blueprint, and Assembly. Command IDs are in `raw/screenshots.json`; the returned base64 is kept in Orca's command result because the CLI did not expose a file target.
- Visible stage UI evidence is in `raw/ui-observations.json`: Path 2D exposed SVG and no canvas; Path 3D exposed WebGL2; Foundry and Design exposed the shared 3D canvas plus physical connection/stack controls; Blueprint exposed the printable SVG/image sheet; Assembly exposed the 3D assembly canvas and nine build steps.
- Warm stage navigation recorded 20 stage events across four Path → Foundry → Design → Blueprint → Assembly cycles. The embedded browser produced frame intervals near 1,000 ms, so interval, LoAF, input-to-visual, and draw-call rates are diagnostic observations only, not Chromebook acceptance metrics.
- LoAF attribution included `DIV#root.onclick`, `FrameRequestCallback`, SVG image `onload`, and `TimerHandler:setInterval`; React commit/call counters were not exposed by current diagnostics and are marked unavailable.
- Direct context evidence initially reported WebGL 2 / ANGLE Apple M1 Pro. A reversible `WEBGL_lose_context` probe produced `lost` then `restored`, with `contextLost:false` afterward; the probe was followed by a reload. Context raw output is in `raw/context.json`.
- Orca console captured two `THREE.WebGLRenderer` errors about an existing context of a different type, plus the expected context-lost/restored logs from the probe. Network capture showed successful document/script/font/image responses and no failed HTTP request in the captured buffer; raw compact output is in `raw/console.json` and `raw/network.json`.

### Timing observations (rejected as gates)

| Surface | Frames | p50 interval | p95/max interval | Long Tasks | Draw-call counter |
| --- | ---: | ---: | ---: | ---: | ---: |
| Path Three play | 10 | 1000.8 ms | 1008.5 / 1008.8 ms | 0 | 34,100 |
| Foundry play | 13 | 808.3 ms | 1008.4 / 1008.4 ms | 4 | 268 |
| Design play | 12 | 541.5 ms | 1008.3 / 1008.3 ms | 0 | 696 |
| Assembly play | 8 | 1004.0 ms | 1008.5 / 1008.5 ms | 0 | 1,437 |
| Warm repeated switches | 69 | 83.9 ms | 1008.3 / 1258.9 ms | 20 | 13,399 |

The counters are monkeypatched WebGL call counts and are not presented-frame counts. Zero Long Tasks alone is not treated as a pass.

## Rejected:

- After the context probe and reload, the same URL displayed version `0.0.9` even though the exact worktree package and `dist/index.html` reported `1.1.0`; the bundle name also changed. That page is rejected as wrong/unattributed preview state.
- The original visible page showed `1.1.0`, but its terminal source could not be proven because the exact Orca terminal never emitted the requested preview command. Those earlier screenshots/UI observations remain evidence of visible interaction only, not a shipped performance result.
- All frame interval, LoAF duration, stage-switch latency, and input-to-visual values are rejected as Chromebook gates because the embedded Orca browser delivered approximately one callback per second and the host renderer was an Apple M1 Pro, not a Chromebook.
- No React commit/call counters, compositor submission counters, or Chromebook GPU telemetry were available. They are not fabricated.
- No failed/network request was inferred from an empty subset; the final Orca buffer contained successful requests only and one worker request without a status field.

## Tests:

- `bun run test:contracts` — exit `0`, `project contracts ok`.
- Production source files were not edited. Production call-count delta: **0**.
- Git worktree was clean before artifact creation; this commit owns only `artifacts/performance/orca-baseline/**`.
- Raw command/response summaries: `raw/session.json`, `raw/visibility-blocker.json`, `raw/stage-summary.json`, `raw/warm-switches.json`, `raw/context.json`, `raw/console.json`, `raw/network.json`, `raw/screenshots.json`, and `raw/ui-observations.json`.

## Chromebook impact:

This audit does not establish Chromebook pass/fail. The only renderer evidence came from Chromium on `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`; the embedded page's callback cadence was visibly throttled, and the exact preview process could not be attributed to the manifest terminal. Re-run on a Chromebook with an Orca terminal that proves the preview command and preserves active foreground evidence before using any performance number for cutover.

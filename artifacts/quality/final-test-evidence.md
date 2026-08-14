# Final quality-pass evidence

## Provenance

- Immutable baseline tag: `quality-pass-start` at
  `4f3f7cc4906c2fef49b5796c2c6e43988466b9d2`.
- Deciding source SHA:
  `0707c38aaf2ddc121cdfc550a2067812354b0123` on
  `quality/sol-max-integration`.
- Historical implementation commits were inspected and dispositioned; none
  was used as the reimplementation base or replayed wholesale.
- Wave tags `quality-pass-wave-0` through `quality-pass-wave-4` preserve the
  accepted integration checkpoints. `quality-pass-wave-5` is reserved for the
  separate final-evidence commit.

## Required final matrix

| Gate | Exact invocation / condition | Result | Raw evidence |
| --- | --- | --- | --- |
| Contract/unit | `bun run test` | PASS; 60 sorted contract scripts, exit 0 | `artifacts/quality/G9/raw/final-unit-0707c38.log` |
| Web production build | `bun run build` | PASS, exit 0 | `artifacts/quality/G9/raw/final-build-0707c38.log` |
| Post-A/B default rebuild | `bun run build` | PASS, exit 0; restored default `dist` after the enabled build | `artifacts/quality/G9/raw/final-default-rebuild-after-ab.log` |
| Tauri frontend | `bun run build:tauri-frontend` | PASS, exit 0 | `artifacts/quality/G9/raw/final-tauri-frontend-0707c38.log` |
| Browser | `PLAYWRIGHT_PORT=43210 PLAYWRIGHT_WORKERS=2 bun run test:browser` against production preview | PASS; 77/77 in 7.6 minutes, exit 0 | `artifacts/quality/G9/raw/final-browser-0707c38.log` |
| Default bundle | Marker scan across `dist` | PASS; zero schema, counter, flush, target-variable, or sink markers | `artifacts/quality/G9/raw/final-default-marker-scan-after-ab.log` |
| Enabled bundle | Explicit study build at the same source SHA | PASS; schema and injected target present only in enabled output | `artifacts/quality/G9/raw/final-ab-build-boundary-0707c38.log` |

The browser suite kept the functional project parallel with two workers. Its
76 functional tests completed first; the strict G5 ONNX Long Task API test ran
once in the dependent `chromium-performance` project after those workers
released host resources. The threshold was not weakened. A first attempt on
the usual preview port found an unrelated listener; the collision is preserved
in `artifacts/quality/G9/raw/final-browser-port-conflict.log`, and the deciding
run used isolated strict port `43210` without killing that process.

## Focused deciding regressions

- G3 piston overlay correction: focused unit/contract/type/build checks passed;
  the six physical pointer families passed with two browser workers; the
  isolated piston flow passed. Evidence:
  `artifacts/quality/G9/raw/integration-g3-gates.log`,
  `integration-g3-six-family.log`, and `integration-g3-focused.log`.
- G5 host-contention diagnosis: the strict isolated performance lane passed;
  controlled concurrent copies reproduced the false overlap, and the final
  project sequencing contract passed. Evidence:
  `repro-g5-isolated.log`, `repro-two-failures-workers2.log`,
  `playwright-performance-lane-focused-idle.log`, and
  `playwright-performance-lane-contract.log`.
- The full final browser suite then passed both the piston interaction and the
  G5 cold/warm ONNX inference assertions. Its recorded overlapping-long-task
  arrays were empty for both ONNX requests.

## Orca production-preview review

The exact default and enabled production outputs were served from immutable
directories and exercised through Orca's embedded browser.

- Default guided flow: Make a hand wave opened on Character with the ownership
  cluster; Foundry played a ready WebGL/Rapier four-bar with one dynamic build,
  11 physical parts, 21 holes, and zero physical/stack errors; Design reused a
  ready WebGL scene with one dynamic build and a moving-joints path; Blueprint
  generated PDF/SVG artifacts and downloaded SVG; Assembly opened at
  `prepare-parts`.
- Browser console messages: zero.
- HTTP responses at status 400 or above: zero.
- Default summary resource entries during the flow: zero.
- Telemetry transport: default export plus pagehide remained at zero requests;
  enabled SVG export produced one 1,114-byte CORS POST, and pagehide produced
  one 1,114-byte no-CORS beacon. Both payloads matched the exact schema and
  source SHA and passed the allowlist/sentinel validator.

Structured evidence is in
`artifacts/quality/G9/raw/orca-ab-evidence.json`; the complete command/session
record is in `artifacts/quality/G9/raw/orca-final-session.log`; exact transport
records are in `summary-sink-final-stats.json`.

## Telemetry A/B

Cold and hidden-webview pilots exposed two confounds: unequal JIT warm-up and
Orca throttling a non-active worktree. Those failed observations remain in the
raw session log and are explicitly non-deciding. A temporary lifecycle-removal
experiment did not help and was fully reverted before the deciding build.

The final protocol used fixed warm-up and balanced order. Input additionally
crossed build profiles over both browser page identities.

| Metric | Default | Study enabled | Delta | Gate | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Input-to-visual p95 | 43.00 ms | 42.75 ms | -0.25 ms / -0.58% | <=1 ms and <=2% | PASS |
| Playback frame p95 | 86.50 ms | 87.25 ms | +0.75 ms / +0.87% | <=2% | PASS |
| Attributable long tasks >50 ms | 0 | 0 | 0 | 0 | PASS |
| Structural scene rebuild delta | 0 | 0 | 0 | 0 | PASS |
| Measured playback WebGL clears | 720 | 720 | 0 | identical | PASS |

See `artifacts/quality/final-performance.json` and the two final Orca probe
harnesses in `artifacts/quality/G9/raw/`.

## Historical coverage and integration hygiene

- Final commit ledger: 82 unique historical commits, no pending disposition.
- Final hunk ledger: 346 unique historical hunk IDs, no pending disposition.
- Every ledger evidence path exists; every non-placeholder accepted commit is
  an ancestor of the integration tip.
- Worker branches were audited after integration for unreviewed product deltas.
- `git diff quality-pass-start...HEAD --check` passed.
- The final evidence is committed separately from product changes.

The machine-readable validation output is
`artifacts/quality/G9/raw/final-ledger-validation.log`.

## Boundaries not claimed

No external deployment, tag publication, native signing/package build,
credentialed environment change, broad model-accuracy study, or representative
classroom-device benchmark was performed. These are residual release or study
activities, not hidden passes in this evidence set.

# Earlier versions verification

This record separates measurements from the pre-feature tree (`d8c95f54f7cfb86d2f004cc9d64e3719227da1dd`) from feature verification. The baseline browser runs used a clean detached worktree at `/tmp/ms-versions-baseline.mjQOv8`, a production Vite preview on port 5174, Chrome 152, 1366×768 at DPR 1, bounded classroom Wi-Fi metadata, and the `acceptance-6x` CDP CPU profile. They ran on an Apple M1 Pro, so they are an emulated local comparison rather than measurements from a physical Chromebook.

## Baseline gates

The following commands completed with exit code 0 before the feature build:

- `bun run test` — `/tmp/ms-versions-baseline-test.log`
- `bun run test:all` — `/tmp/ms-versions-baseline-test-all.log`
- `bun run test:precommit` — `/tmp/ms-versions-baseline-test-precommit.log`
- `bun run test:classroom-return` — `/tmp/ms-versions-baseline-test-classroom-return.log`
- `VITE_BASE_PATH=/ms/ bun run build` — `/tmp/ms-versions-baseline-build-ms.log`
- `bun run test:bundle-budget` — `/tmp/ms-versions-baseline-bundle.log`
- `MOTIONSMITH_E2E_DIAGNOSTICS=1 bun run build:e2e` — `/tmp/ms-versions-baseline-build.log`

The clean baseline Vite output had SHA-256 `3e8f9ea153ce0980e6f66ab09639078cd5d4c406a98fa285f3e2f7d7e2240460`.

## Baseline performance command lines

All three targeted measurements ran from `/tmp/ms-versions-baseline.mjQOv8` against the already-built production preview on port 5174. The commands used `acceptance-6x`, one Playwright worker, `CHROMEBOOK_AUDIT_ENFORCE=0`, and `PLAYWRIGHT_BASE_PATH=/`; the report and Playwright artifact paths are explicit so a later run can be compared without overwriting these artifacts.

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=0 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_ENTRY_SAMPLES=1 CHROMEBOOK_ENTRY_AUDIT_OUTPUT=/tmp/ms-versions-baseline-entry.json PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/classroom-entry-performance.spec.ts --workers=1 --output=/tmp/ms-versions-baseline-entry-playwright
```

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=0 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_PLAYBACK_AUDIT_MS=15000 CHROMEBOOK_PLAYBACK_AUDIT_OUTPUT=/tmp/ms-versions-baseline-playback.json PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-playback-audit.spec.ts --workers=1 --output=/tmp/ms-versions-baseline-playback-playwright
```

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=0 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_FEATURE_AUDIT_OUTPUT=/tmp/ms-versions-baseline-input-features PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-interaction-audit.spec.ts -g 'Path gestures stay responsive and memory-bounded' --workers=1 --output=/tmp/ms-versions-baseline-input-playwright
```

## Baseline interaction and playback measurements

The entry audit used one fresh browser context and one sample per action (`coldSampleCount: 1`) in `/tmp/ms-versions-baseline-entry.json`:

| Flow | Click to next paint (single sample) | Interactive ready (single sample) | Long task maximum |
| --- | ---: | ---: | ---: |
| Starter | 24.205 ms | 1773.280 ms | 93 ms |
| Guide | 52.245 ms | 145.055 ms | 0 ms |
| Lesson | 36.255 ms | 1932.650 ms | 83 ms |

The report's p50/p95/p99 fields are equal because each action has one sample; they are not stable percentile estimates.

The entry harness acceptance result was false because the existing starter and lesson interactive-ready thresholds and long-task thresholds were exceeded. This is recorded as a baseline result, not attributed to earlier versions.

The 15-second Foundry playback audit in `/tmp/ms-versions-baseline-playback.json` reported 601 frames over 15,010.05 ms. Frame-interval p50/p95/p99 were 19.035/34.450/35.285 ms; 0% of frames exceeded 50 ms; React playback commits were 0; and the maximum main-thread long task was 0 ms. Authoritative memory grew from 11,014,132 to 11,846,431 bytes (832,299 bytes), with a 74,137-byte tail range. WebGL live resources, contexts, topology builds, geometry cache, and material cache all had zero delta.

The path-input audit in `/tmp/ms-versions-baseline-input-features/chromebook-feature-pathGestures-audit.json` reported a next-paint p50/p95/p99 of 28.355/49.360/49.360 ms. Its authoritative memory grew from 12,348,364 to 13,503,761 bytes (1,155,397 bytes), with a 30,352-byte tail range. Worker, ImageBitmap, and object-URL counters returned to baseline.

The baseline workflow audit also exposed a pre-existing locator mismatch: `tests/browser/chromebook-audit.spec.ts` expects `Build / Print` while the accessible workflow control is `Blueprint`. The targeted playback and path-input reports passed their acceptance checks. Entry did not pass; its initial exit code 0 came from `CHROMEBOOK_AUDIT_ENFORCE=0`, not acceptable startup performance.

The entry baseline was then repeated with the default 20 samples and enforcement enabled. It failed the same existing starter/lesson readiness and long-task limits. This is the comparison baseline; the one-sample run above remains exploratory evidence.

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=1 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_ENTRY_SAMPLES=20 CHROMEBOOK_ENTRY_AUDIT_OUTPUT=/tmp/ms-versions-baseline-entry-20.json PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/classroom-entry-performance.spec.ts --workers=1 --output=/tmp/ms-versions-baseline-entry-20-playwright
```

| Baseline flow, 20 samples | Next-paint p95 | Interactive-ready p95 | Maximum long task |
| --- | ---: | ---: | ---: |
| Starter | 27.860 ms | 1967.350 ms | 109 ms |
| Guide | 45.425 ms | 199.620 ms | 0 ms |
| Lesson | 34.740 ms | 1932.950 ms | 88 ms |

The unchanged limits are 100 ms next-paint p95, 500 ms interactive-ready p95, and 50 ms maximum long task.

## Deterministic coverage

The new suites are:

- `tests/version-policy.test.ts`: one-minute automatic retention, 30-minute temporal coverage, burst protection, seven-day cleanup, protected-version budget exhaustion, authored-versus-presentation change detection, descriptions, and restoration policy.
- `tests/version-codec.test.ts`: authored snapshot fidelity for parts, joints, paths, mechanisms, bindings, and authored settings; presentation normalization; SHA-256 integrity; missing/corrupt artwork; recursive-history rejection; shared-artwork deduplication; archive dependency and identity validation.
- `tests/version-portable.test.ts`: versioned `.motionsmith` creation and reopen, clean current-state round trip, history extraction, legacy files without history, corrupted snapshots/assets, current-reference mismatch, recursive current snapshots, schema rejection, and an archive over the 24 MiB browser-history limit.
- `tests/version-worker.test.ts`: requested-state preservation, FIFO completion, bounded outstanding work, failure, retry, and idle disposal.

Direct runs completed successfully:

```text
bun tests/version-policy.test.ts
bun tests/version-codec.test.ts
bun tests/version-portable.test.ts
```

The browser suite is `tests/browser/earlier-versions.spec.ts`. It uses real starter, character inspector, Keep version, preview, Restore, Save Project, and Open Project controls. It covers same-session preview isolation and restoration of the later state from the exact saved file, then opens that file in a new browser process, restores the included history, edits again, saves, and reopens the second file. Fixture injection into browser storage is not used as evidence of those UI workflows.

## Final functional verification

The four required unit/contract commands passed after the final cumulative-image guard: `bun run test`, `bun run test:all`, `bun run test:precommit`, and `bun run test:classroom-return`. Logs are retained under `artifacts/earlier-versions/verification/ms-versions-feature-*-final.log`. TypeScript and `git diff --check` also passed. New unit suites are registered in `test:versions`, the contract entry point, and the full unit manifest.

`VITE_BASE_PATH=/ms/ bun run build` and `bun run test:bundle-budget` passed on the final ordinary production build, including the image-recognition and feedback-boundary guards. Versions remain aligned at `0.0.16` in all four release files.

| Ordinary production budget | Baseline | Feature | Unchanged limit |
| --- | ---: | ---: | ---: |
| Initial core JS, gzip | 199,920 B | 199,819 B | 200,000 B |
| Initial shell, compressed | 261,934 B | 261,838 B | 300,000 B |

All optional chunks passed their existing individual budgets. The core has only 181 bytes of remaining headroom; the new Project/history/support action surfaces load lazily. Reports are `ms-versions-feature-build-ms-final.log` and `ms-versions-feature-bundle-final.log` in the verification artifact directory.

The final production diagnostics build passed `bun run build:e2e`. Its browser runs passed **32 tests**: 25 version, accessibility, classroom-return, file-recovery, and renderer cases with four workers; seven actual Worker/IndexedDB storage cases with three workers. The timing case was the only remaining active case when storage testing started. These are functional checks, separate from the serial performance measurements.

```text
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5285 bunx playwright test tests/browser/earlier-versions.spec.ts tests/browser/earlier-versions-accessibility.spec.ts tests/browser/earlier-versions-safety.spec.ts tests/browser/earlier-versions-timing.spec.ts tests/browser/classroom-file-return.spec.ts tests/browser/file-recovery-safety.spec.ts tests/browser/renderer-performance.spec.ts --workers=4 --output=artifacts/earlier-versions/final-contracts
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5286 bunx playwright test tests/browser/earlier-versions-storage.spec.ts --workers=3 --output=artifacts/earlier-versions/final-storage
```

The ordinary `/ms/` production build also passed three real file/restoration workflows and all seven storage cases. The combined run passed eight cases; the A/C workflow then passed its targeted rerun after its canvas locator was changed from an E2E-only identifier to the actual canvas inside the Shared canvas region. A final Reset Lesson case passed separately: real head/path edits were protected before reset, the dark theme survived reset, and the pre-reset work was restored from the saved reset file in a clean browser. The earlier ordinary preview attempt omitted `VITE_BASE_PATH` on the server, causing asset URLs to receive the HTML fallback; build and preview now use the same base. These were test setup/locator corrections, with no disabled assertions.

```text
VITE_BASE_PATH=/ms/ PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5285 PLAYWRIGHT_BASE_PATH=/ms/ bunx playwright test tests/browser/earlier-versions.spec.ts tests/browser/earlier-versions-storage.spec.ts --workers=3 --output=artifacts/earlier-versions/ordinary-ms-final
VITE_BASE_PATH=/ms/ PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5285 PLAYWRIGHT_BASE_PATH=/ms/ bunx playwright test tests/browser/earlier-versions.spec.ts --grep 'preview and restore use real controls' --workers=1 --output=artifacts/earlier-versions/ordinary-ms-restore
VITE_BASE_PATH=/ms/ PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5285 PLAYWRIGHT_BASE_PATH=/ms/ bunx playwright test tests/browser/earlier-versions.spec.ts --grep 'Reset Lesson protects' --workers=1 --output=artifacts/earlier-versions/ordinary-ms-reset
```

| Evidence | What it proves |
| --- | --- |
| Real Character/path edits, Keep, Preview, Restore, Undo, Redo, and Save | A can be restored, undone to C, redone to A, and the protected later state remains available. Downloaded state is parsed and checked. |
| Real Reset Lesson, Save, clean reopen, and Restore | The original lesson returns, app theme survives, and the student's pre-reset head/path edits remain discoverable and restorable from the file. |
| Exact downloaded files opened in clean browser processes | History travels in the file. Restore, another real edit, Save, and another clean reopen work without the first browser's database. |
| Controlled 30-minute editing plus a burst | Automatic writes actually commit, retain a state from 10–15 minutes earlier, survive reload, and return through explicit browser recovery. |
| Quota, transaction abort, corrupt selected data, delayed Worker reads, another real edit/file, and Back | Failure and stale completion cannot replace current work or report late success. Pre-restore failures leave the current/previous backup bytes unchanged. |
| Failed initial history installation and failed New Project protection | Current-only file saving remains available, the failure exposes actions, and Retry performs the requested operation after storage recovers. |
| Actual storage boundary | Metadata-only listing, selected body reads, historical-only assets, sibling removal, branch removal, authority checks, and the 16-branch cap are exercised. |
| Cumulative image boundary | Eight valid captures retain 512 unique images. One more unique image is rejected; manifests, catalog, keys, backups, and prior reads remain unchanged. |
| Existing classroom/file-recovery and renderer suites | File authority, late imports, denied storage, failed downloads, path-only/character-only work, two real classroom files, and retained Three resources continue to work. |

The complete character-to-build workflow and command-menu regression also passed. The command-menu test now undoes an authored duration change while retaining toolbar visibility, matching the new content/presentation distinction. The former raw-PDF assertion now decodes the actual data URI and checks the PDF bytes; it does not weaken export validation. An earlier 54-case production run covered support discovery/release history and these persistence surfaces; the final focused runs above supersede its earlier version UI screenshots.

Genuine screenshots from the final functioning app were inspected at both target sizes: [1280×720](../artifacts/earlier-versions/verification/earlier-versions-1280.png) and [1366×768](../artifacts/earlier-versions/verification/earlier-versions-1366.png). They show the actual retained robot, list, playback, scrubber, Back, and Restore. Browser assertions also verify the buttons are inside the viewport and receive pointer input above the renderer, keyboard/Escape cancellation restores focus, long lists scroll, and feature searches reveal controls without restoring or downloading.

## Version storage and lifecycle measurement

`tests/browser/earlier-versions-performance.spec.ts` used the same 6× page CPU profile and viewport. It performs real Keep, preview, Restore, and Save actions, then three list/preview/close cycles. The fixture adds a valid one-pixel PNG padded by 3 MiB to the existing sample artwork. This measures transfer and storage of a large image payload; it is not a benchmark of a complex 3 MiB decoded image. No thumbnails are generated, so there is no thumbnail-capture work to measure.

| Observed operation | End-to-end UI time | Worker job time |
| --- | ---: | ---: |
| Three Keep actions | 193.710 / 215.925 / 331.000 ms | 38.810 / 33.575 / 47.250 ms |
| Select and render first preview | 1938.245 ms | 27.750 ms |
| Restore, including both protected writes | 969.905 ms | Read 40.885 ms; writes 35.790 / 33.465 ms |
| Save until download starts | 454.600 ms | 260.020 ms |

Native `postMessage` calls for these actions ranged from 0.010 to 9.100 ms. Worker read time includes IndexedDB retrieval, integrity checks, expansion, JSON parsing, and validation; pure deserialization is not independently isolated. Worker timings are not 6× CPU-throttled: CDP emulation applies to the main page target only. End-to-end time includes UI waits and renderer readiness, not only computation.

Five retained entries shared three snapshot bodies and nine image assets: 98,096 snapshot bytes, 4,957 entry bytes, and 4,197,554 unique image bytes. Repeating image bytes per entry would require 20,987,770 bytes; sharing avoided 16,790,216 bytes. Total catalog payload was 4,300,607 bytes. These are feature payload sizes, excluding IndexedDB overhead and the separate current/previous backup.

The repeated cycles passed all lifecycle checks: at most one project viewer, one canvas, and one live versions Worker, with no per-row viewers. Comparable post-GC current-view samples grew from 19,176,372 to 19,761,872 main-page JS heap bytes (585,500 bytes), with a 283,360-byte tail range against the unchanged 8 MiB floor / 15% growth policy. This CDP JS heap metric does not cover the whole process, Worker heaps, or GPU memory; existing playback/input audits separately use authoritative browser memory and WebGL resource counters.

Raw report: `artifacts/earlier-versions/verification/feature-history-performance.json`. The first input run exposed a harness issue: its baseline lifecycle counters were read before lengthy memory sampling, during which an idle Worker correctly terminated. The resulting count change of −1 failed the exact-zero test. Ownership counters now come from the completed sampling boundary, and the same harness correction is used for both baseline and feature input reruns. Acceptance limits and workload actions were not relaxed.

## Before/after input and playback

Both input reruns used the corrected sampling-boundary harness. The baseline application remains `d8c95f5`; only the test harness in its detached worktree was updated. The feature runs and baseline rerun used `CHROMEBOOK_AUDIT_ENFORCE=1`. The original baseline playback report also passed every acceptance check, although its exploratory command used enforcement 0.

| Measurement | Baseline | Feature | Existing limit |
| --- | ---: | ---: | ---: |
| Path next-paint p95 | 41.290 ms | 44.220 ms | 50 ms for direct interaction |
| Path authoritative memory growth | 1,121,435 B | 1,118,112 B | 8 MiB / 15% policy |
| Path memory tail range | 49,836 B | 31,010 B | 8 MiB / 15% policy |
| Path final live Workers | 0 | 0 | Same as baseline |
| Playback frame interval p50 | 19.035 ms | 19.195 ms | 33.3 ms |
| Playback frame interval p95 | 34.450 ms | 34.575 ms | 42 ms |
| Playback frame interval p99 | 35.285 ms | 35.245 ms | 75 ms |
| Playback frames over 50 ms | 0% | 0% | 5% |
| Playback main-thread maximum long task | 0 ms | 0 ms | 50 ms |
| Playback React commits | 0 | 0 | 0 |
| Playback authoritative memory growth | 832,299 B | 795,985 B | 8 MiB / 15% policy |
| Playback memory tail range | 74,137 B | 84,911 B | 8 MiB / 15% policy |

Both playback runs sampled 601 actual rendered frames over approximately 15 seconds. Both had zero growth in live WebGL resources, contexts, geometry/material caches, and persistent topology builds. Input and playback passed their unchanged acceptance checks. These measurements establish bounded behavior in the tested workloads; small differences are not evidence of a causal speed improvement.

The final entry rerun used 20 fresh contexts per action on the final diagnostics build (`distSha256: db57daf18ef4dc801f0557be5dce26652d8800a21d53a1f94e9de075b2598ce8`). Its failure set matches the clean baseline: Starter and Lesson exceed the existing readiness/long-task limits; Guide passes. No acceptance threshold was changed.

| Entry flow | Next-paint p95, before → after | Interactive-ready p95, before → after | Maximum long task, before → after |
| --- | ---: | ---: | ---: |
| Starter | 27.860 → 22.285 ms | 1967.350 → 1739.750 ms | 109 → 90 ms |
| Guide | 45.425 → 53.795 ms | 199.620 → 147.625 ms | 0 → 0 ms |
| Lesson | 34.740 → 22.930 ms | 1932.950 → 1842.430 ms | 88 → 83 ms |

The baseline/feature commands used the same Chrome version, viewport, CPU/network emulation, workload counts, and serial preview execution. Host load was not experimentally controlled. The contended first feature entry run was preserved separately; the final entry rerun had no heavy external process observed during periodic process checks. This is a limited local comparison, not a claim of Chromebook acceptance or an isolated causal performance gain.

Reports: `baseline-path-input-final.json`, `feature-path-input-final.json`, `ms-versions-baseline-playback.json`, and `feature-playback.json` in `artifacts/earlier-versions/verification/`.

The Options/history audit was updated to drag authored Duration, undo/redo that change, and keep toolbar presentation unchanged. Its final enforced run passed: next-paint p95 23.245 ms, authoritative memory growth 641,414 bytes, memory tail range 23,116 bytes, and Workers returning from zero to zero. Duration test values follow the control's 0.1-second step. The final resource boundary now waits again after memory sampling, since a due automatic checkpoint can start during that sampling; the normal five-second idle cleanup must finish and the exact-zero ownership limits still apply. These harness fixes do not suppress captures, disable history, or relax latency/resource thresholds.

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=1 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_FEATURE_AUDIT_OUTPUT=/tmp/ms-versions-feature-options-final PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-interaction-audit.spec.ts --grep 'Options and history stay' --workers=1 --output=artifacts/earlier-versions/performance-options-final
```

```text
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=1 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_FEATURE_AUDIT_OUTPUT=/tmp/ms-versions-baseline-input-final PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-interaction-audit.spec.ts -g 'Path gestures stay responsive and memory-bounded' --workers=1 --output=/tmp/ms-versions-baseline-input-final-playwright
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=1 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_PLAYBACK_AUDIT_MS=15000 CHROMEBOOK_PLAYBACK_AUDIT_OUTPUT=/tmp/ms-versions-feature-playback.json CHROMEBOOK_FEATURE_AUDIT_OUTPUT=/tmp/ms-versions-feature-input-features EARLIER_VERSIONS_PERFORMANCE_OUTPUT=/tmp/ms-versions-feature-history-performance.json PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-playback-audit.spec.ts tests/browser/chromebook-interaction-audit.spec.ts tests/browser/earlier-versions-performance.spec.ts --grep 'Balanced playback keeps|Path gestures stay responsive|measures retained history' --workers=1 --output=artifacts/earlier-versions/performance-workloads
env -u NO_COLOR CHROMEBOOK_AUDIT=1 CHROMEBOOK_AUDIT_ENFORCE=1 CHROMEBOOK_AUDIT_PROFILE=acceptance-6x CHROMEBOOK_ENTRY_SAMPLES=20 CHROMEBOOK_ENTRY_AUDIT_OUTPUT=/tmp/ms-versions-feature-entry-final.json CHROMEBOOK_FEATURE_AUDIT_OUTPUT=/tmp/ms-versions-feature-input-final PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5174 PLAYWRIGHT_BASE_PATH=/ node_modules/.bin/playwright test tests/browser/chromebook-interaction-audit.spec.ts tests/browser/classroom-entry-performance.spec.ts --grep 'Path gestures stay responsive|Options and history stay|starter and Guide' --workers=1 --output=artifacts/earlier-versions/performance-final
```

## Review and implementation ownership

The main agent owned `hooks/useProjectVersions.ts`, `runtime/versions/`, Worker/file integration, restoration/decision fencing, autosave authority, and performance/bundle decisions. Delegated work used the actual available model **`gpt-5.6-luna` with `max` reasoning**: the UI agent implemented panel/preview/accessibility and measurement scaffolding; the verification agent implemented policy/codec/portable tests, the real file workflow, and timing evidence; the storage verification agent implemented actual IndexedDB/failure cases and independently reviewed restoration safety. The main agent integrated and reran the checks, corrected preview hit testing and failure/retry races, and added the cumulative-image transaction guard.

The domain and file contracts are documented in [earlier-versions-design.md](earlier-versions-design.md). UI lives in `components/stages/project/EarlierVersionsPanel.tsx` and `EarlierVersionPreview.tsx`; integration stays in the existing controller/command/import hooks. No dependency, backend, release note, or version bump was added.

## Existing failures and limits

The broader legacy workflow suite is not wholly green. Clean-baseline reproduction found old Add object locators in two tests, mechanism-fit expectations reporting 8.179 and 49.604 where tests expected below 1, and an old blueprint PDF suffix expectation. Other legacy flows waited for removed export/handle controls. These failures were not used as evidence that the new feature works. Baseline reproduction logs and the earlier broader run remain in the artifact record. The PDF data-URI and authored-versus-presentation Undo assertions described above were updated and rerun successfully.

Unavailable storage, quota, abort, corruption, and competing ownership were exercised. The existing blocked-upgrade handler was reviewed, but an actual cross-version blocked database upgrade was not independently injected. No physical Chromebook was tested. Independent HyperFrames rendering consumed approximately six to eight CPU cores during some measurements; the first entry run is retained as `feature-entry-contended.json` and is not a controlled causal comparison. Matching CDP settings cannot remove host contention, and no measured difference here establishes an improvement in student outcomes.

The separate robot hotfix was merged in [PR #13](https://github.com/AlanSynn/ms/pull/13) and [deployed successfully](https://github.com/AlanSynn/ms/actions/runs/34169247833) at `v0.0.16`; the live page's version and asset entry were fetched and checked. Earlier versions remains local on `feature/earlier-project-versions`; it has not been committed, pushed, or deployed.

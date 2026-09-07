# Student support maintenance and evidence

The support surfaces follow [the workbench UX contract](workbench-flow-ux-contract.md). `Find a feature` locates real controls, `Feedback` prepares a local screenshot and sends only on request, and `What's new` shows one eligible unseen bundled update before Getting Started and can also be reopened manually. These are shell concerns, outside `ProjectState` and undo history. The [feedback relay guide](feedback-relay.md) owns the one-Worker configuration and delivery limitations.

## Baseline

Inspected checkout: `b04888f65d3cb5ac6570a16bb44ea30efbe51935`, version `0.0.14`, clean working tree on 2026-09-07. Dependencies were installed with `bun install --frozen-lockfile`. Baseline `bun run test` and the production build passed. Bun in this environment is `1.4.0`; the repository declares `>=1.3.14`.

Orca `1.4.197` was running. A dedicated Orca terminal serves a production build at `http://127.0.0.1:4175/ms/`. The running baseline was inspected through the public `orca` CLI, using actual clicks, snapshots, waits for mounted controls, and an image capture:

- Static logo/version loader released to Getting Started with Guide and Starter rig plus the two file actions.
- Guide > Make a hand wave opened an editable Character with 14 body parts, 17 joints, a hand path, and a four-bar mechanism.
- The Project menu contained New, Save, Open, Recover, and Reset Lesson. Help contained only Shortcuts and About. None of the new support surfaces existed.
- Path showed Motion target, Add motion, Draw/Redraw, motion inventory, shape controls, and collapsed More.
- Foundry showed Fit motion, Attach to part, Use this mechanism, actual Three geometry, playback, and templates.
- Assembly showed the real ten-step hand-wave build, lane choices, Blueprint handoff, and playback controls.

Baseline CLI JSON and the Character image are local QA artifacts under `artifacts/student-support/`. Preview must receive `VITE_BASE_PATH=/ms/` as well as the build; a root-configured preview cannot serve the `/ms/` artifact correctly.

## Feature destinations and query maintenance

Commands retain their IDs and labels from `utils/appCommands.ts`. `utils/featureDestinations.ts` adds a small typed alias/location map for controls that are not global commands; context-help wording is reused. `data-feature-id` marks the actual target. The shared reveal hook opens menus/details and waits for mounted controls, then focuses and briefly outlines the target without clicking it. Pure handoff checks avoid the ordinary navigation handler's error-state mutation.

Representative queries and acceptable results are executable in `tests/feature-search.test.ts`:

| Intent / varied language | Acceptable destination |
|---|---|
| keep this for next class; downlod proj; save my | Save Project |
| continue yesterday's work; reopn; load file | Open Project |
| paper body pieces; cut out my person; character PDF | Character PDF |
| print; PDF | Blueprint PDF and Character PDF |
| make the hand move; sketch movement; pathw | Draw path |
| other arm; different body part | Motion target |
| second motion; another path | Add motion |
| existing motions; switch the line I made | Motions inventory |
| reverse my last change; undoo | Undo |
| watch it move; pause animation | Play/Pause |
| make it slower; animation spee | Animation speed |
| match this curve; fit my motion | Fit motion |
| choose a machine; mechanism choices | Templates |
| put the parts together; assembel | Assembly steps |
| something broke; suggest an improvement | Feedback |
| what changed; new things | What's new |
| weather tomorrow; pizza oven; xyzqv | No result; editable suggestion draft available |

New destinations must name an existing annotated control, reuse its availability rules, and add paraphrase/partial/unknown query cases. Never surface hidden legacy commands or developer tools. Search queries stay on the device; a suggestion is editable text and is not transmitted until Send.

## Adding a release note

1. Add a typed entry in `utils/releaseNotes.ts` for the version in `package.json`. Use a stable ID that changes only for a genuinely new entry. Keep at most three highlights, each with a short title and sentence about a feature present in that build.
2. Capture an implemented visual change with a synthetic project through Orca. Crop to useful controls; save a lightweight local PNG under `public/release-notes/`. Supply useful alt text. Do not use student work or a mock screenshot.
3. Choose an existing `FeatureId` for each useful Show me action. It uses the same safe reveal flow as search.
4. Verify the image at `/ms/` and under the relative desktop base, test image failure, and exercise Show me. Run `bun run test:support` and the focused production-preview browser tests.

Entries select by exact application version; no latest-release request is made. `motionsmith.releaseNotes.viewed.v1` stores viewed IDs as a browser/device preference. The entry becomes viewed after its explicitly opened content renders, and New clears immediately. Existing tabs synchronize on storage events. Rebuilding or correcting an entry's text must preserve its ID. Older-build revisits retain earlier viewed IDs.

Denied/corrupt local storage falls back to session storage and memory. Persistence cannot survive cleared/blocked storage, a different browser profile, or every form of private browsing. On a shared profile, viewing notes affects that profile; this is not per-student tracking.

## Capture implementation and limits

The synchronous freeze copies the visible app before the panel mounts or a transient warning disappears. The raster encoder loads on demand. Existing renderer callbacks redraw their current scene/camera into the same WebGL canvas before copying its pixels; they do not change camera, playback, selection, paths, or mechanism parameters. DOM/SVG controls, clipped panes, visible warnings, and designated masked fields are captured without changing live values. A final scene-integrity check rejects missing/displaced scene evidence.

The snapshot omits decorative backdrop blur: Chromium 149 and Orca's Chromium 150 otherwise clipped the header and pane edges while rasterizing the same valid DOM. All useful controls, fills, and current scene pixels remain. The enlarged preview scrolls inside its own bounds; Send remains reachable at the tested classroom sizes.

Chromium and WebKit both passed real Character, Path, Foundry, and Assembly capture checks. WebKit adds an EXIF chunk to canvas PNGs that the strict relay rejects. The lazy client encoder removes only that metadata before checking size or reporting capture ready. All four normalized WebKit images passed the unchanged Worker validator; native decode comparison found zero changed RGBA channels. Browser capture tests also validate each app-generated stage PNG at the relay boundary.

WebKit's synthetic oversized 2400 × 1400 canvas fixture fails native rasterization; the app explicitly offers text-only submission and releases the failed snapshot. This is not a successful blank image. Tainted/incomplete assets likewise fail visibly. No desktop/window capture permission or continuous capture is used.

## Verification ledger

Implementation and local/live GitHub verification are distinct from production deployment. Unit tests and mocked receipts alone are not delivery evidence.

| Scope | Verification evidence |
|---|---|
| Baseline | Required contracts/build passed; Orca Character, Path, Foundry, Assembly/menu/first-run inspection recorded above. |
| Native HTTP integration gate | Synthetic [issue #7](https://github.com/AlanSynn/ms/issues/7), posted by the existing AlanSynn CLI OAuth identity using direct HTTP. Upload and issue creation both returned 201. Logged-out issue GET returned 200; image GET returned 200 with matching SHA-256 `ad038084616e3aab23ccb4d7c7e431462bb64d1811f019ba6257ce3605e3b272`. This is a checkerboard diagnostic, not the app's screenshot. |
| Credential distinction | Diagnostic OAuth has existing `repo` access. No restricted fine-grained feedback token has been verified or installed. Existing study secrets are not repurposed. |
| Feature discovery in Orca | 18 real UI reveals: saving, reopening, body-template printing, another arm, fitting, and assembly steps from Character, Path, and Assembly. Every expected control ranked first and was actually revealed. Arrow-key ambiguity, Escape/focus return, no-results editable suggestion, and Show me were also exercised. `orca-discovery.json` records the queries and destinations. |
| App-generated captures | `character-app-capture.png`, `path-app-capture.png`, `foundry-app-capture-live.png`, and `assembly-app-capture.png` came from the app's local preview blobs. They were visually inspected; they are not automation screenshots substituted into feedback. The release-note crop is separately captured from the implemented Find panel through Orca, 672 × 373 pixels, 41,789 bytes. |
| Live app-to-Worker problem | [Issue #8](https://github.com/AlanSynn/ms/issues/8) was sent from the production `/ms/` app through local Wrangler, using its actual Foundry PNG. GitHub returned 201. The logged-out native image matches all 391,585 original bytes, SHA-256 `8eee0192079980a026600ea21d7ff3d01685df18804d253713be7f70e4f4704e`. |
| Real recovery | The first Send was definitively rejected during the read-only check because workerd does not implement `redirect: 'error'`; no upload/create occurred. After the manual-redirect fix, the same report ID and image were retried. A deliberate browser fault dropped the actual 201 receipt. The app retained the draft in status-only mode through Worker shutdown and recovered #8 after a fresh Worker start, without a new issue or image. |
| Other live app reports | [Idea #9](https://github.com/AlanSynn/ms/issues/9) removed the Assembly screenshot before Send; no image field went over the wire and the issue has no image. [Report #10](https://github.com/AlanSynn/ms/issues/10) followed an intentional capture failure and explicit Send text only. Each has a fresh report ID. All reports are synthetic and posted by AlanSynn. |
| Independent public retention | The submitting Orca browser view was closed and the Worker stopped. Unauthenticated issue HTML and native image GETs still returned 200, with the same image hash. Client references were released; temporary diagnostic secrets and probe/runtime terminals were removed. `live-independent-retention.json` records this check. |
| Orca project safety | Actual Save Project files before/after search, notes/Show me, captures, failed delivery, recovery, and live sends contain identical complete `ProjectState`: 14 parts, one path, one mechanism. Sorted project hash `e092cc7f6bca8d72bc262c164fd12d5300af3117227c7f580d679eb854f929c4`. Browser regression flows separately use two paths plus a fitted mechanism and verify full exported state, save/reopen, continued editing, and Assembly. |
| Release-note lifecycle | Orca observed New without automatic opening, loaded the real `/ms/` note image, cleared New immediately after opening, and safely focused Motion target through Show me without network submission. A fresh Orca tab on the restored final build retained the viewed ID and showed no New badge. Browser tests cover both viewport sizes, actual browser-process restart with the same profile, tabs, save/open/reset/reload, new/older stable IDs, denied/corrupt storage, and image failure. |
| Desktop frontend | `bun run build:tauri-frontend` passed with relative assets and the credential/recognition guards. Both note-lifecycle flows passed against that build at 1366 and 1024 pixels wide. The Tauri manifest packages only `dist`, with no additional Worker resource. A native desktop binary was not packaged or launched. |
| Worker resource check | Wrangler 4.112.0 production dry run passed: 26.50 KiB before compression, two built-in rate-limit bindings, and fixed repository/origin variables. No storage or queue binding is present. The dry run did not deploy or provision anything. |
| Deployed Worker/frontend | No Cloudflare Worker or Pages release was deployed. A dedicated restricted credential, separately proven upload permission, production Worker secrets, exact allowed origin, and the public frontend endpoint remain owner setup. Local cross-origin delivery is verified; a deployed-origin receipt is not. |

The first logged-out diagnostic image request returned 404 shortly after upload; a subsequent request after issue creation returned the exact PNG. Treat this observation as propagation evidence, not a promise about attachment latency.

Actual Chromebook tested: no. Viewport emulation is not physical-device validation.

An additional final Orca run attempted to import the same two-path fitted fixture used by the browser regressions. Orca returned `runtime_unavailable` during upload and subsequent browser commands, despite its status endpoint reporting ready. Closing that QA tab and opening another restored snapshots, but file-input fixture retries also stalled. This additional Orca run is incomplete. All four discovery browser cases then passed against the exact final production build without diagnostic flags or a feedback endpoint, including the same fixture, save/reopen, and continued editing. The completed Orca comparison used the one-path guided project; full two-path preservation evidence comes from the production browser regressions, not that interrupted Orca run. The temporary locally served QA fixture was removed from `dist`.

## Verification commands

Production preview uses `VITE_BASE_PATH=/ms/` and a test-only public endpoint `http://127.0.0.1:8789/feedback`. Automated browser submissions intercept that endpoint; only the explicit Orca synthetic sends used live GitHub. The Worker is unavailable during ordinary browser regression runs.

- `bun run test`, `bun run test:all` (41 unit/contract suites), `bun run test:precommit`, and `bun run test:support` cover the domain, existing guards, search, preferences, client wire contract, capture bounds, and 25 Worker request/recovery checks.
- `env VITE_BASE_PATH=/ms/ VITE_FEEDBACK_ENDPOINT=http://127.0.0.1:8789/feedback bun run build:e2e` runs TypeScript, the Vite production build, image-recognition exclusion, and the browser/Worker credential boundary guard.
- The three `student-support-*.spec.ts` production browser files cover discovery, feedback, and notes at 1366 × 768 and 1024 × 700. The capture suite has 11 cases in each of Chromium 149 and WebKit at DPR 2, including strict scene/control comparisons and warning preservation.
- Relevant existing workflow tests retain menu coverage, <1px context-help layout checks, Foundry/Design/Assembly renderer equality, and actual PDF/STL/SVG exports. Their baseline-stale labels, hidden export controls, and fixture counts were corrected in tests; the product was not changed to restore obsolete copy.
- `bun run test:bundle-budget` passed on the final `/ms/` build: core JavaScript 187,114 compressed bytes against a 200,000-byte limit; initial shell 248,917 against 300,000. The capture encoder remains a lazy chunk; no new dependency was added.
- `bun run build:tauri-frontend` checks the desktop frontend and its secret boundary. The two `notes stay read through` browser cases also passed with `VITE_BASE_PATH=./` and `PLAYWRIGHT_BASE_PATH=/` against this relative build.
- `bunx wrangler@4.112.0 deploy --dry-run --env="" --config workers/feedback/wrangler.toml` validates the production Worker bundle and resource inventory without deploying it.

Local artifacts and detailed execution logs are ignored under `artifacts/student-support/`; browser trace directories are temporary QA outputs. Release-note source, final cropped asset, tests, and the one-Worker configuration are repository changes. The existing frontend and public repository are reused; no paid resource, extra repository, storage service, queue, or per-report workflow was provisioned.

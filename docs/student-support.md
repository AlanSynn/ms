# Student support maintenance and evidence

The support surfaces follow [the workbench UX contract](workbench-flow-ux-contract.md). `Find a feature` locates real controls, `Feedback` prepares a local screenshot and sends only on request, and `What's new` keeps a cumulative, newest-first history that can be reopened manually. An unseen latest update opens this history once before Getting Started. These are shell concerns, outside `ProjectState` and undo history. The [feedback relay guide](feedback-relay.md) owns the one-Worker configuration and delivery limitations.

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
| paper body pieces; cut out my person; character PDF | Character outlines PDF |
| print my painting; print my prop; print my character | Download Build PDF |
| print; PDF | Download Build PDF and Character outlines PDF |
| paint a face; paint clothes; erase the middle; change shape | Draw & paint |
| draw my own object; make a prop; draw a sign | Draw object |
| import a picture; object image | Import object |
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

Artwork destinations are `character.drawPaint` and `character.drawObject`; imported pictures retain `character.loadObjectFile` with the label Import object. These destinations reveal controls only. They do not open an editor, add a piece, apply paint, or start a file picker. A missing/locked selection keeps its compact prerequisite. Aliases describe supported retained brush/pencil, partial erase, line, filled rectangle/ellipse, base color, and physical-outline editing; they must not advertise flood fill, vector boolean tools, or whole-object raster tracing.

## Adding a release note

Each highlight must describe one explicit student/user-visible change.

Use the current format: short title, one concrete sentence, relevant screenshot, and a safe Show me action when a destination exists.

Each screenshot must show only the relevant UI area for that change.

Write for students and ordinary users. Name the actual control and what they can do or see after the change. Omit internal architecture, refactors, dependencies, vague "improvements", marketing, and unimplemented promises. Keep titles within 60 characters and descriptions within 180 characters. Describe one change per highlight in plain English.

An example of the required content shape:

- Title: `Open your project`
- Sentence: `Choose Open Project to continue from your saved .motionsmith file.`
- Screenshot: the actual Open Project control and only the local context needed to recognize it.
- Show me: `project.open`, which locates the control without opening the picker.

1. Add a typed entry in `utils/releaseNotes.ts` for the version in `package.json`. Preserve all published entries, stable IDs, and assets unless the owner explicitly requests removal. Never overwrite the previous release or cap the archive length. Keep at most three highlights per entry, each with a short title and sentence about a feature present in that build.
2. Every new highlight needs a genuine screenshot of its implemented control or visible result. Use a synthetic project through Orca and capture only the relevant region. If Orca capture is unavailable, record the exact failure and use a real production-preview browser capture. Exclude unrelated navigation, blank canvas, desktop/terminal chrome, and private student work. Do not use generated/mock images, a full-app screenshot for a small change, or retouched pixels that imply a different version.
3. Inspect the crop at its actual rendered note size, including a narrow viewport. The changed control/result must remain readable, and the sentence, alt text, and pictured state must match. Save the focused PNG under `public/release-notes/` and retain its capture route, build version, and source region in the verification record.
4. Choose an existing `FeatureId` for each useful Show me action. It uses the same safe reveal flow as search.
5. Verify the image at `/ms/` and under the relative desktop base, test image failure, and exercise Show me. Run `bun run test:support` and the focused production-preview browser tests. Those checks enforce structure, title/sentence length, image presence, local PNG assets, and complete rendering; they do not prove semantic accuracy or screenshot framing. Complete the runtime/visual review before publishing.

The existing text-only highlights `release-history-v1::Earlier updates`, `classroom-return-v1::Open your project`, `classroom-return-v1::Two paths`, and `student-support-v1::Share a problem or idea` are the only grandfathered exceptions. Their archive content remains valid; new highlights cannot reuse or expand these exceptions to avoid a screenshot.

All bundled stable releases at or below the running application version appear newest first, with entries from the same version grouped together. At the owner's explicit request, the initial three entries are now labeled v0.0.15; their stable IDs remain unchanged. This is a one-time version-label correction, not permission to relabel the archive on later releases. A build without a new entry still shows its earlier history. The running version is separate from each update's release label. No changelog request is made.

The history body scrolls independently of its fixed heading, Close, and startup Continue controls. It is keyboard focusable and lazily loads bundled images. Reading or acknowledging an entry never removes it. `motionsmith.releaseNotes.viewed.v1` stores viewed IDs as a browser/device preference. Only entries that entered the visible history area are acknowledged when the panel is dismissed or a Show me action leaves it. The newest entry alone controls New and automatic opening; unread archives do not cause a queue of startup dialogs. Existing tabs synchronize on storage events. Rebuilding or correcting text preserves the entry ID, and older-build revisits retain earlier viewed IDs.

Denied/corrupt local storage falls back to session storage and memory. Persistence cannot survive cleared/blocked storage, a different browser profile, or every form of private browsing. On a shared profile, viewing notes affects that profile; this is not per-student tracking.

## v0.0.15 release-history verification

The inspected checkout was `ae5aca49ba05ac0d9768689d80702c2f41500d8b`, with package version `0.0.15`. The loaded classroom deployment reported `0.0.14`. Before this change, the local v0.0.14 preview showed only `classroom-return-v1`; exact-version selection also left v0.0.15 without an entry. The following initial archive verification preceded the owner's request to relabel the two older entries as v0.0.15. Its two-version captures remain historical evidence; the current catalog groups all three entries under v0.0.15. No deployment or version tag was created in this change.

- `bun run test` and `VITE_BASE_PATH=/ms/ bun run build` passed.
- `env -u NO_COLOR VITE_BASE_PATH=/ms/ PLAYWRIGHT_BASE_PATH=/ms/ PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5178 bunx playwright test tests/browser/student-support-notes.spec.ts --workers=3` passed all 22 cases in 25.6 seconds.
- Production browser checks cover 1366 x 768, 1280 x 720, 390 x 844, and enlarged text. They verify fixed Close/Continue positions while history scrolls, keyboard access and focus return, retained read entries, startup ordering, browser-process restart, cross-tab acknowledgement, storage denial/corruption, image failure, and unchanged saved projects.
- The image-failure test waits for the actual fallback paragraph before scrolling it, avoiding a test race with the replaced image node. The final run has no failed cases.
- Orca confirmed v0.0.15, both version groups, all three stable entry IDs, Continue leading to Getting Started, and manual reopening with the archive intact. Orca's screenshot command timed out; its End/wheel commands reported success without advancing the history scroll position in that embedded session. Scrolling and final visual inspection are supported by the production Playwright results and captures, not by those Orca commands.
- The 1280px latest/earlier and 390px earlier-history captures were visually inspected. Local evidence is retained under `artifacts/release-history/`; this is viewport/browser validation, not a physical-device claim.

## Authoring-format and version-label correction

At the owner's request, all initial update entries now belong to v0.0.15. Stable entry IDs, viewed-state continuity, and the archived content remain intact. The history hint also remains visible when several entries share one version.

The `Your working view` highlight now uses `public/release-notes/project-working-view-v1.png`, a real 624 x 600 crop of the shared Project canvas. It was captured from the local production v0.0.15 preview in Chromium 149.0.7827.55 at 1366 x 768 and DPR 1, using Guide -> Waving arm -> Project -> Front -> Fit. The observed project had 14 parts, one path, and one mechanism. The crop excludes the app header, workflow rail, sidebars, and obsolete sidebar version label; the original full-app `classroom-return-v1.png` remains retained. The existing tightly framed Find a feature image remains unchanged.

The support contract test now locks the authoring-policy text, title/description bounds, PNG asset presence and alt text, the four explicit text-only archive exceptions, and rendering without highlight truncation. It cannot judge whether a screenshot or claim is relevant; authors must still inspect the actual UI and rendered note as described above.

After the policy and version correction, `bun tests/student-support.test.ts`, `bun run test`, and the production `/ms/` build passed. The same focused production browser command above passed all 22 cases in 28.8 seconds. The new note captures were visually inspected at 1280 x 720 and 390 x 844: the single v0.0.15 group, focused working-view image, and scroll hint are present. Capture provenance and these final images are retained locally under `artifacts/release-note-policy/`. No version tag or deployment was created.

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

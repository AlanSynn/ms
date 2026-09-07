# Classroom return: UX decisions and verification

Status: implemented locally; functional checks pass, but emulated cold-entry performance targets remain unmet. Decisions were recorded before code changes on 2026-09-07. Verification evidence follows below.

## Question and success criteria

Can a student save a portable project file, open that exact file in a clean browser at the next class, recognize the same working 3D scene, and add/edit two independent body-part paths without rediscovering hidden controls?

The file is the cross-class contract. Browser backup is recovery after a problem. Build/Print produces fabrication artifacts. These three concepts must stay distinct in labels, state, and execution.

## Observed baseline and limits

The checkout is `b04888f65d3cb5ac6570a16bb44ea30efbe51935`, application version `0.0.14`, with the preceding student-support implementation still uncommitted. Its starting patch and production assets are preserved under `artifacts/classroom-return/`. No prior changes have been discarded.

The deployed `/ms/` app also reports `0.0.14`, but its entry bundle differs from the local production build. Orca snapshots of both fresh entries show Guide and Starter rig, followed by the session preference and small Character file/Open full project actions. The local entry does not automatically show its unseen update. The entry file input accepts only JSON while the shared menu input also accepts `.motionsmith`.

Orca opened the Guide library through keyboard interaction. Further clicks/captures have been interrupted by browser visibility/focus failures while another desktop workspace becomes active. Screenshot errors explicitly report `Page.captureScreenshot` timeout; stage waits have returned `runtime_unavailable`. A separate `orca serve` attempt was refused by the desktop single-instance lock and its temporary terminal was closed. A DOM listener recorded zero delivered Guide-card clicks after Orca reported success, with no app errors. A separate Playwright browser then completed the baseline against the unchanged production build; this is supplementary browser evidence, not an Orca walkthrough.

The supplementary baseline used actual Guide clicks, Save Project download, and the exact downloaded `baseline-Waving-arm.motionsmith` file in a clean browser profile. It restored 14 parts, one path, and one mechanism, landing directly in Path. Reloading the original profile restored the browser backup automatically. Path visibly exposed its inventory and Add motion. Front-view, phase-zero Project/Design screenshots show different mechanism presentation, rig markers in Project, and a playback dock only in Design. Camera framing differs, so these images establish presentation drift, not a single geometric root cause. Artifacts are `baseline-*-playwright.png`, `baseline-playwright-findings.json`, and `baseline-playwright-trace.zip` under the ignored evidence directory.

Read-only source and deterministic probes establish additional gaps:

- Cold recovery currently commits a stored project automatically. Entry-time autosave interval/flush paths can write initial or import-progress state.
- Save and Open validate differently; a saved 6,332,975-byte file was rejected by Open's browser-backup size ceiling. Unsupported raw versions, unrelated JSON, and missing blob artwork can be accepted or stripped by permissive normalization.
- Project uses a front Puppet preview without playback or working viewport setters. Design uses Foundry geometry, mechanism-driven poses, and a different camera. Its native scene receives no authored paths and its SVG overlay shows only one mechanism target.
- Path already has an inventory, Add motion, and combined IK preview. Independent-arm samples move both arms. Add immediately creates an entry for the current target; broad target matching can overwrite another owner's path. Readiness, conflicts, gesture ownership, pause, and selection-only undo require alignment.

## Visual and interaction decisions

Visual thesis: retain the calm MotionSmith workbench, with the actual character and paths as the visual anchor and a clear file-opening action at entry.

Content plan: two compact creation choices, one full-width Open Project button, secondary character/recovery actions, then the session preference. In Project, keep title and file actions in the left pane, the live model in the center, and concise counts/source-specific status in the inspector. In Path, keep named paths and Add path above drawing controls.

Interaction thesis: replace startup dialogs in one sequence; synchronize path rows, active traces, and edit handles; reuse the shared playback phase and existing camera controls. Keep existing restrained transitions and reduced-motion behavior. Add no animation dependency or decorative motion.

### Entry and acknowledgement

Boot → one eligible unseen update → Getting Started unless session-suppressed → chosen work/editor. Persist a stable update ID only after its content rendered and Continue, Close, or Escape dismisses it. Manual What's new returns to the current editor. Getting Started suppression and update acknowledgement use separate preferences outside project/history.

If entry is suppressed without active work, show Project with Open Project primary. Closing or reopening entry does not load, recover, reset, or replace anything. Guide and Starter rig remain the two creation choices. Open Project is always prominent beneath them; its one accessible button invokes the same file picker/import command as the menu and Project tab. Character file stays separate. Recovery appears only for a validated candidate, with its actual project name and known backup time; unknown legacy times are identified honestly.

### File authority and recovery

Read/validate a candidate before committing replacement. Preserve the existing replacement safeguard for files, prepared starters/guides, and explicit recovery. Canceled/invalid choices preserve current authoring and the last-good backup. A successful explicit file selection wins over any browser copy, including a newer copy with the same ID. Fence stale operations with the existing request generations plus an explicit project-decision boundary.

Keep the current portable format and embedded assets. Share safe candidate validation between Save and Open; do not make browser-backup capacity a portable-file validity rule. Character-only and path-only projects remain valid. File operations work when browser storage fails. Label browser downloads as initiated downloads, not proven overwrites or confirmed disk writes.

Discover recovery without committing it or rotating its storage. Authorize recovery writes only after a successful open/new/recover choice or an authored edit; presentation, startup previews, import progress, errors, and delayed callbacks do not authorize writes. Preserve the existing newest/previous rotation policy once a project is chosen. Report actual backup state instead of a constant success chip.

### Working Project overview

Reuse the Design preview boundary and Foundry scene for configured mechanism context, with all visible authored paths supplied to the native scene. Highlight the selected path and keep other paths subdued; distinguish authored targets from fitted traces. Do not alter domain transforms, visibility, bindings, or geometry to frame the overview.

Fit the camera to visible character/paths, with an explicit full-scene fit. Reuse camera controls and preserve view state where practical. Project has no editing handles or parameter controls; Edit paths uses ordinary navigation. Pass the same clock/phase as Design. Keep one mounted viewer and no render loop per path.

Without a mechanism, reuse the existing Path/Puppet character and path-preview pipeline with editing handles disabled. Do not create a sentinel mechanism or inherit Design's Add a mechanism guard. Character-only shows its actual character; empty work shows restrained file/create actions. Keep Blueprint's fabrication scene and exports unchanged.

### Multiple paths

Keep Paths/count, named target assignments, and Add path in the primary pane. Add opens a cancelable target chooser before any project mutation. Existing targets expose their existing paths explicitly; multiple supported paths for one target are preserved. Selection, new-target choice, and reassignment are distinct actions.

Resolve authoring by exact ownership and bind each gesture to its starting project/path/target. Cancel only uncommitted geometry on an identity change. Only the active path has edit handles. Path selection does not consume edit undo history or clear redo.

Use one readiness definition for inventory, playback, and fitting. The existing combined preview drives independent valid targets on one timeline and holds the paused phase. Preserve conflicting paths and report a compact conflict; do not silently apply the last path. Incomplete/disabled paths do not block independent valid motion. Fitting another path must explicitly confirm any replacement of an existing mechanism binding. Keep unfitted/build limitations visible without claiming a complete two-motion fabrication.

## Verification gates

- Startup: unseen/acknowledged update × Getting Started shown/suppressed × backup absent/present; ordering, one dialog, dismissal/focus, storage fallbacks, manual reopen, and no recovery overwrite.
- Files: real UI Save bytes → clean profile Open → edit → Save → another clean Open, with embedded artwork, two paths, and a supported mechanism; repeat character-only/path-only.
- Safety: file wins over newer same-ID backup; delayed recovery/import loses authority after another choice/edit; canceled/invalid files, missing assets, failed writes, repeated selection, and replacement cancel preserve work/backup.
- Scene: matched phase and comparable cameras in Project/Path/Design; actual parts, path IDs, targets, transforms, traces, and mechanism geometry; no-mechanism/character-only/empty states; inspect without saved-state drift.
- Paths: draw A/B, cancel Add, switch/edit/undo B with A unchanged, gesture identity changes, both real arm transforms over time, pause, conflicts/incomplete paths, file round-trip, fitting and Assembly continuity.
- Layout/performance: 1366×768, 1280×720, keyboard, enlarged text scrolling, one WebGL viewer/clock, existing bundle and renderer gates. Capture before/after images and retain Orca interaction traces.
- Run repository contracts, focused unit/browser regressions, pre-commit suites, and the `/ms/` production build. Record Orca/environment blockers separately; fixtures and green tests do not stand in for completed student UI flows.

## Implemented behavior and evidence

Entry now shows two compact creation choices, a full-width Open Project action, then Character file and any validated Recover browser backup candidate. Boot, the unseen update, and entry are sequenced; acknowledgement requires rendering and dismissal. Closing entry without a project leaves actionable Project/Open controls. The current update has stable ID `classroom-return-v1`; the previous support entry and acknowledgement IDs remain intact.

Project reuses `DesignFoundryPreview` and the existing Three Foundry scene for a configured mechanism, including all authored paths and a separate fitted trace. Without a mechanism it uses the existing Puppet/path-preview pipeline. Shared camera and clock state preserve the view and held phase across stages; fitting frames rendered content above the playback dock. Project adds no geometry engine, fitting model, editing handles, or saved presentation data.

Path retains its inventory and adds a cancelable target chooser. Exact ownership and gesture identity protect other paths. Shared readiness excludes conflicting moving chains while preserving their source data. Candidate fitting normalizes explicit output bindings; replacing an existing binding requires confirmation. Blueprint continues to identify unfitted motion as `No mechanism`; reaching Assembly does not claim a complete two-motion physical build.

The normal file-return test creates work through actual UI choices, changes character geometry, imports SVG artwork, draws the second path, downloads a real file, opens that exact file in a new browser process, edits again, saves a second file, and opens that file in another new process. It compares the complete persisted project, including embedded images, paths, timing, output bindings, fitting metadata, mechanisms, and settings. Character-only begins with a blank project and Add layer; path-only uses the Starter rig and actual drawing. Neither requires a mechanism. These normal cases do not import constructed ProjectState fixtures. Focused parity and exceptional safety cases use labeled serializable fixtures.

Verified commands and evidence in `artifacts/classroom-return/`:

- `bun run test`: all repository contract suites pass (`final-contracts-retake.log`). The final rerun also fixed an obsolete root-URL assertion to preserve the isolation-before-navigation check for `/ms/` previews.
- `bun run test:all`: all 44 manifest suites pass (`all-unit-tests.log`).
- `bun run test:precommit`: all six required b695 suites pass (`final-precommit.log`). Golden hashes and physical fit tolerances were not changed.
- `env VITE_BASE_PATH=/ms/ VITE_FEEDBACK_ENDPOINT=http://127.0.0.1:8789/feedback bun run build:e2e`: TypeScript, source/dist exclusion, Vite, and feedback-boundary checks pass (`build-e2e-final.log`). The localhost feedback endpoint is intercepted test configuration.
- Existing `workflow.spec.ts`: 63/63 pass on that production preview with four workers (`workflow-regression.log`, build fingerprint alongside it). Coverage includes actual imports, replacement/recovery, editing, fitting, physics loading, Blueprint exports, Assembly, and responsive navigation.
- The final focused browser batch passes 61/61 with four workers (`final-browser-retake.log`). It includes eight recovery safety cases, six path cases, four shared-renderer cases, 17 startup/preferences/keyboard cases, three normal file-return cases, and the preceding support/export/WebGL regressions. The eight startup preference/backup combinations are explicit tests. Screenshots and traces cover 1366×768, 1280×720, and doubled root text size. The Path pane now wraps its action row instead of scrolling sideways.
- `renderer-performance.spec.ts` passes (`renderer-performance.log`): retained resources stay stable and camera interaction submits one render without duplicating the grid or viewer.
- Final ordinary build: `env -u VITE_FEEDBACK_ENDPOINT -u MOTIONSMITH_E2E_DIAGNOSTICS VITE_BASE_PATH=/ms/ bun run build` passes (`production-build.log`). The served production trace contains none of the checked E2E scene probes; its request record contains no intercepted feedback endpoint. Root `dist` is this ordinary build.
- `env BUNDLE_BUDGET_OUTPUT=artifacts/classroom-return/production-bundle-budget.json bun run test:bundle-budget` passes: core JavaScript 193,643/200,000 gzip bytes; initial shell 255,623/300,000 compressed bytes; every optional chunk and the lazy Rapier chunk pass.
- `node artifacts/classroom-return/production-smoke.mjs` passes against that ordinary build at 1280×720. A clean browser opens the actual Orca-saved file, re-saves identical canonical state, visits Project/Path/Design/Blueprint/Assembly, and sees the unfitted-path blocker. See `production-smoke.json`, `production-profile-check.json`, screenshots, and `production-smoke-trace.zip`.

The final focused browser command was:

```sh
env PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5195 PLAYWRIGHT_BASE_PATH=/ms/ VITE_BASE_PATH=/ms/ bunx playwright test tests/browser/classroom-file-return.spec.ts tests/browser/student-support-notes.spec.ts tests/browser/file-recovery-safety.spec.ts tests/browser/multiple-path-authoring.spec.ts tests/browser/project-working-preview.spec.ts tests/browser/student-support-discovery.spec.ts tests/browser/student-support-feedback.spec.ts tests/browser/app-capture.spec.ts tests/browser/assembly-export-worker.spec.ts tests/browser/webgl-recovery.spec.ts --workers=4 --output=artifacts/classroom-return/final-browser-retake
```

An earlier overlapping browser run had two transient feature-highlight assertion failures and one obsolete blocker-copy expectation. The test now observes dismissal and highlighting together, avoiding trace-capture delay after the three-second highlight expires; production highlight behavior and subsequent assertions are unchanged. The obsolete expected label was updated to the actual short blocker. The complete 61-case retake ran without another browser suite competing for resources; earlier logs remain available.

Selected local evidence:

- Before: [Project](../artifacts/classroom-return/baseline-project-front-phase0-playwright.png), [Design](../artifacts/classroom-return/baseline-design-front-phase0-playwright.png), and the [actual baseline walkthrough](../artifacts/classroom-return/baseline-playwright-trace.zip).
- After, same project/camera/held phase: [Project](../artifacts/classroom-return/final-browser-retake/project-working-preview-Pr-fa3a4-era-and-phase-without-edits-chromium/project-front-phase37.png) and [Design](../artifacts/classroom-return/final-browser-retake/project-working-preview-Pr-fa3a4-era-and-phase-without-edits-chromium/design-front-phase37.png).
- Normal student flow: [clean file-opening entry](../artifacts/classroom-return/final-browser-retake/classroom-file-return-a-st-8baa4-turn-through-two-real-files-chromium/open-project-clean-entry.png), [second-class file](../artifacts/classroom-return/final-browser-retake/classroom-file-return-a-st-8baa4-turn-through-two-real-files-chromium/class-two-Waving-arm.motionsmith), and [complete two-file interaction trace](../artifacts/classroom-return/final-browser-retake/classroom-file-return-a-st-8baa4-turn-through-two-real-files-chromium/trace.zip).
- [Path interaction evidence](../artifacts/classroom-return/multiple-paths-final/README.md) and [enlarged-text entry](../artifacts/classroom-return/final-browser-retake/student-support-notes-enla-3daac-ble-by-keyboard-at-1280×720-chromium/entry-enlarged-text.png).

The evidence directory is local and gitignored. These artifacts are available in this workspace; they were not published with the application.

### Performance limit

The existing classroom entry gate **fails** under emulation. Its full default 20 samples per action used Chrome 152 on an Apple M1 Pro, 1366×768 at DPR 1, 6× main-thread CPU throttling, 40 ms network latency, and 1.25 MiB/s download throughput. These are emulated conditions, not measurements from a physical Chromebook. All clicks were trusted; no thresholds or sample counts were changed.

| Entry action | Click-to-next-paint p95 (limit 100 ms) | Interactive-ready p95 (limit 500 ms) | Long-task maximum (limit 50 ms) |
| --- | ---: | ---: | ---: |
| Starter rig | 40.5 ms — pass | 1,921.9 ms — fail | 147 ms — fail |
| Guide library | 74.5 ms — pass | 169.0 ms — pass | 72 ms — fail |
| Guided lesson | 46.4 ms — pass | 2,139.0 ms — fail | 776 ms — fail |

The command was `env CHROMEBOOK_AUDIT=1 PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5195 PLAYWRIGHT_BASE_PATH=/ms/ VITE_BASE_PATH=/ms/ CHROMEBOOK_ENTRY_AUDIT_OUTPUT=artifacts/classroom-return/classroom-entry-audit.json bunx playwright test tests/browser/classroom-entry-performance.spec.ts --workers=2`. The complete result and retained failure trace are in `classroom-entry-audit.json`, `classroom-entry-audit.log`, and `classroom-entry-audit-tests/`. Responsive click feedback does not establish that the Character workbench meets its cold-entry readiness target.

A subsequent [paired diagnostic comparison](../artifacts/classroom-return/entry-baseline-comparison/README.md), also 20 samples per action, finds substantial delay in the preserved starting build: Starter readiness p95 is 1,863.1 ms in both builds; lesson readiness p95 is 1,725.3 ms before and 1,880.3 ms after. Both show about 0.68–0.69 seconds between the first and last initial GL submissions. The baseline lacks E2E attributes, so both comparison runs use the same production readiness signal plus actual GL submission. This differs from the enforcing observer; the baseline is ordinary production and the current measured build includes diagnostics. The delta therefore does not prove or rule out a regression. The original failed gate remains authoritative.

Traces and unchanged staged-initialization code localize much of the delay to the existing cold renderer boundary, but there are no CPU sampling stacks that justify a specific shader, geometry, driver, or React fix. This work does not claim the cold-entry targets are met or replace that boundary with a new renderer.

### Orca observations and limits

Public Orca commands eventually delivered normal interaction after fresh isolated profiles and a reload. The recorded sequence opens the new announcement and Guide, edits a part rotation, imports the local star image, chooses a second target, draws a seven-point path with integer-coordinate mouse commands, and invokes Save Project. The resulting native browser download is `orca-class-one-two-paths.motionsmith` in the evidence directory, with 14 parts, two paths (96 and seven authored points), one artwork object, and the original mechanism.

A second isolated Orca profile had no recovery candidate and only the acknowledged update key before Open. It opened that exact file through the promoted Open Project/shared input. Both paths were ready. Project and Design each rendered one canvas and identical actual part/mechanism transforms and path records at the held phase. Re-saving after that return produced an equal canonical ProjectState. See `final-orca-file-return.log`, `final-orca-view-parity.log`, the two geometry JSON files, and the original/restored `.motionsmith` files.

Orca v1.4.197 still cannot capture screenshots in this environment: `Page.captureScreenshot` reports a visibility/focus timeout. Its download collector reports that its expected GUID file is missing, although Electron writes the real file to Downloads; only newly created, uniquely verified QA files were copied into the evidence directory. A later Blueprint wait ended with `runtime_unavailable`. These are recorded tool limits, not successful Orca checks. The complete startup matrix, failure injection, second edited-file return, character-only/path-only return, playback sampling, and Assembly coverage are separate Playwright evidence. The pre-change Orca walkthrough and Orca before/after screenshots remain incomplete; supplementary baseline screenshots and final Playwright captures are labeled accordingly.

This is developer verification, not evidence of usability with middle-school students or performance on physical Chromebook hardware. No release tag or deployment was created.

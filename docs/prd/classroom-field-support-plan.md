# Classroom Field Support Plan

Status: active implementation pass
Last refreshed: 2026-06-29
Scope: web-first classroom entry, guided templates, sensemaking, reset recovery, blueprint, and assembly guide.

## Field-study signal

Teachers and students do not need another engineering console. They need a web workbench that starts from a clear classroom theme, shows what to do next, recovers safely after mistakes, and ends with an understandable on-screen assembly guide.

Key notes translated into product constraints:

- **Web is mandatory for classrooms.** Software installation creates IT/department approval burden. Hosted static web at `https://alansynn.com/ms/` is the default path. Tauri remains optional.
- **Guided entry beats open exploration.** Free exploration stays available after a starter exists, but first entry should be theme/template-led.
- **Motion templates need scaffolding.** Elementary students need working human figures and pre-made motion examples before advanced tuning.
- **Details must be visible at the moment of action.** Hidden panels and general instructions fail; students need direct cause/action hints near the workflow.
- **Failure recovery must be safe.** `Reset` should return the selected lesson/mechanism to a stable known-good state, not leave partial broken parameters.
- **Blueprint + Assembly must be web-first.** Students should not have to infer build order from paper. The app should show animated assembly, including character part placement, then offer print/download as backup.

## Agent review synthesis

- `analyst`: current system partially supports web, onboarding, blueprint, and assembly, but lacks classroom approval checklist, lesson templates, stable lesson reset, and teacher-friendly local package flow.
- `explore`: existing anchors are `WelcomeDialog`, `GettingStartedDialog`, `ShortcutHelpDialog`, `AboutDialog`, Foundry/Design reset controls, `BlueprintExport`, `AssemblyWorkbench`, `utils/appCommands.ts`, `docs/deployment.md`, and tag-gated GitHub Pages workflow.
- `designer`: keep splash tiny; keep Getting Started to three setup choices; put classroom lessons in a secondary lesson/library path; left pane acts as tutorial conductor; center canvas remains pure workbench; right pane stays inspector; assembly uses low-text exploded animation.
- `test-engineer`: add contract/browser coverage for `/ms/` static deploy, guided real starter flow, sensemaking discoverability, stable Foundry reset, animated Assembly, and no server/cloud calls.

## Current support and gaps

| Area | Supported now | Gap to close |
| --- | --- | --- |
| Web deployment | GitHub Pages workflow, `/ms/` base path, tag-gated release, local ONNX asset checks. | No classroom-safe release checklist in product docs/About: no account, no upload, no server, local-first. |
| Guided entry | Splash + compact result-first Getting Started dialog. | Classroom lessons must be a secondary lesson/library path, not extra cards in the first-run modal. |
| Templates | Humanoid, Girl/Boy tiny-thumbnail starters, image/package import, and serializable lesson baselines. | Classroom templates need teacher-ready motion objectives with starter path and compatible mechanism option. |
| Sensemaking | Foundry has collapsed sensemaking and status/warnings. | Too hidden. Need one visible next-action chip and one mechanism meaning cue at each step. |
| Stable reset | View reset, playback reset, some stage reset buttons. | No explicit per-template/per-mechanism stable reset contract. `No rotation possible` must recover to known-good range. |
| Blueprint | Printable cut sheet and export package. | Classroom language and teacher checklist need clearer web-first route; paper should be backup. |
| Assembly | Dedicated Assembly tab and animated stepper exist. | Needs full end-to-end figure + mechanism build: body parts, spacers, board mounting, output binding, final test. |
| Classroom workflow | Local snapshot/project import/export exists. | Need teacher pack story: share package → students edit locally → export snapshot/blueprint/assembly. |

## Implementation checkpoint — 2026-06-29

Current pass uses existing ProjectState/command/test seams only; no new dependency or server layer.

- `CLASSROOM_LESSONS` is the lesson catalog. First real lesson: `Waving arm`.
- Lesson entry creates real humanoid, right-hand path, selected four-bar, generated motion samples, and reset metadata.
- Blank humanoid starter remains clean with no hidden mechanism.
- `Reset Lesson` restores the active lesson baseline while preserving browser app settings.
- Foundry `Reset` now clears manual anchor/picking/playback/overlay state and rebuilds a finite preview from the selected mechanism type.
- Left pane checklist is derived from current `ProjectState`; it never owns separate tutorial state.
- About/deployment docs state static web, no account, no upload, local ONNX, browser autosave, and local downloads.

## Product requirements

### R1 — Web-first classroom release

MotionSmith must present itself as a static web tool first.

Acceptance:

- `docs/deployment.md` and About copy state: static web, no account, no backend upload, browser-local ONNX, browser autosave, local downloads.
- Release checklist covers: version tag, `/ms/` path, ONNX LFS bytes, static asset load, no runtime CDN, no `/api/` calls.
- App shell must not show sign-in, cloud save, sync, team, or teacher dashboard language.

Non-goal:

- No backend, auth, roster, analytics, cloud DB, teacher dashboard, realtime collaboration, or server-side inference.

### R2 — Guided theme/template entry

Classroom lessons should answer “what classroom project are we making?” through a secondary lesson/library entry. Getting Started itself remains the compact result-first starter modal.

Minimum classroom templates:

1. `Waving arm` — humanoid, wrist path, four-bar or crank-rocker recommendation.
2. `Walking legs` — humanoid lower-limb paths, paired mechanism recommendation.
3. `Bobbing head` — head path, cam follower recommendation.
4. `Spinning sign` — gear train recommendation.
5. `Blank character` — user package/image import, no fake mechanism.

Acceptance:

- Each template creates real `ProjectState`: parts, joints, anchors, editable contours, path(s), and optional recommended mechanism metadata.
- Templates that include motion must be save/reopen/export capable.
- Template choice lands on Character with left-pane checklist; it does not jump students into hidden advanced tuning.
- Blank and import flows remain available.

### R3 — Motion scaffolding without fake demos

Pre-made motion helps students understand expected result, but cannot be canned animation.

Acceptance:

- Starter motion paths are editable path data in `ProjectState`.
- Any demo mechanism is either explicit lesson template data or absent; no hidden default mechanism in blank starters.
- Playback advances from real path/IK/mechanism state.
- Students can replace path by drawing, then re-fit mechanism.

### R4 — Direct sensemaking

Details must answer only what works, what blocks, and what to try next at the point of action.

Required channels:

1. Left pane next-action chip: one action, e.g. `Draw 3+ points`.
2. Status strip blocker: one cause + one recovery action, e.g. `Link too short — Fit path`.
3. Mechanism card meaning cue: short “best for” and physical motion icon.
4. Canvas micro-hint only while manipulating: no paragraphs.

Acceptance:

- Students can find mechanism meaning without opening a hidden essay panel.
- Warnings name the affected object and action: path, joint, mechanism, spacer, board coordinate.
- `Details` remains optional for deeper explanation; default UI still stays compact.
- Vocabulary must be English-only in the app UI and repository text: `Joint`, `Path`, `Anchor`, `Drive`.

### R5 — Stable reset and recovery

Every mechanism lesson must have a known-good reset.

Acceptance:

- Foundry `Reset` returns selected mechanism to stable normal range, finite vectors, paused phase `0`, visible stack, and valid preset ratio.
- Template `Reset lesson` restores starter character/path/mechanism recommendation while preserving browser app settings.
- Stage-level resets exist where safe: reset path, reset mechanism fit, reset viewport, reset assembly step.
- Errors such as `No rotation possible`, ONNX load failure, invalid package, or non-fabricable recipe show one recovery action.

### R6 — Blueprint as build-file screen

Blueprint tab answers “can I make files?” It should not own step-by-step assembly teaching.

Acceptance:

- Center canvas shows printable cut sheet/blueprint only.
- Left pane shows validation and export actions.
- Right inspector shows selected recipe/package details.
- Warnings route to Character, Path, Foundry, or Design fix locations.
- Export outputs are local downloads only.

### R7 — Assembly as animated build screen

Assembly tab answers “how do I build it?” Web animation is primary; print is backup.

Acceptance:

- Assembly stepper shows one step at a time with play/pause/next/previous/reset/scrub.
- Mechanism module is assembled before board mounting.
- 15x15 board appears only when needed for kit-board mounting.
- Stack order shows real z-layers: board/clip/spacer/linkage/gear/spacer/clip.
- Character body parts are included: cut part, joint hole, spacer, attachment point, output linkage connection, final motion test.
- Printable guide order matches web step order exactly.

### R8 — Teacher pack workflow

Classroom workflow stays local-first and low approval.

Acceptance:

- Teacher can distribute a portable project/package file.
- Student can import, edit locally, and download project snapshot/blueprint/assembly guide.
- No account or server storage required.
- Docs include a classroom flow: open web app → choose lesson → edit → test → export → assemble.

## Implementation plan

### Phase 0 — Contract lock

- Add contract tests for this plan and docs map.
- Add static denylist for server/cloud classroom surfaces.
- Add browser request guard later for full classroom flow.

Done when:

- `tests/project-contract.test.ts` asserts this plan is active, local-first, and covers guided entry, stable reset, sensemaking, and animated assembly.

### Phase 1 — Classroom-safe About and deployment copy

- Update About/deployment surfaces with classroom-safe facts.
- Add release checklist section: `/ms/`, ONNX LFS, tag match, no CDN, no `/api/`.
- Keep copy short; put details in docs, not center canvas.

Done when:

- About modal contains local-first/no-account/no-upload summary.
- Contract test prevents cloud/auth/server copy from visible UI.

### Phase 2 — Guided lesson templates

- Extend existing starter metadata before adding a template engine.
- Implement the first true lesson template: `Waving arm`.
- Reuse existing sample character factory and mechanism registry.
- Store template reset baseline as serializable project snapshot.

Done when:

- Template opens real humanoid, wrist path, editable parts, and compatible Foundry recommendation.
- No hidden mechanism appears unless the user chose an explicit lesson template.

### Phase 3 — First-run classroom checklist

- Add left-pane checklist derived from `ProjectState`.
- Items: Character, Path, Mechanism, Fit/Test, Blueprint, Assembly.
- Dismiss/collapse state only in localStorage.

Done when:

- Checklist never mutates project data.
- Browser test proves stage/canvas state survives open/close/skip.

### Phase 4 — Sensemaking at action point

- Promote one mechanism meaning cue into Foundry default cards.
- Add object-specific blocker/recovery chips.
- Keep deeper explanation collapsed.

Done when:

- A student sees why a mechanism is recommended before numeric controls.
- Failure states always include recovery action.

### Phase 5 — Stable reset baseline

- Define reset baseline per lesson template and mechanism preset.
- Make Foundry reset restore preset geometry, phase, toggles, finite overlay vectors, and normal zoom/fit.
- Add `Reset lesson` that restores template state without clearing app settings.

Done when:

- Browser test can break/play/reset/play again with no `NaN`, no missing vectors, no detached stack.

### Phase 6 — Assembly end-to-end figure build

- Extend assembly playback to include character cut parts and output binding, not only mechanism module.
- Show mechanism module first, board mount second, character connection third, test motion last.
- Keep printable guide generated from same playback order.

Done when:

- Assembly web stepper can teach full figure build with minimal text.
- Blueprint stays file screen; Assembly stays build screen.

### Phase 7 — Classroom flow QA

- Add one Playwright flow using production preview:
  - start empty;
  - open the lesson/library entry;
  - choose or import the lesson template;
  - draw/edit path;
  - use mechanism;
  - reset mechanism;
  - blueprint;
  - assembly playback;
  - assert same-origin/static requests only.

Done when:

- Flow works without remote endpoints, hidden tutorial pages, or fake state.

## Test plan

Contract tests:

- `classroom field support plan is active and local-first`.
- `guided classroom templates are required as real ProjectState data`.
- `stable reset and sensemaking requirements are locked`.
- `Blueprint and Assembly tab ownership remains separated`.
- `server/cloud classroom features remain excluded`.

Browser tests:

- First-run guided starter opens a real editable starter.
- Sensemaking is visible without taking over the center workbench.
- Foundry reset returns to stable finite mechanism state.
- Blueprint stays 2D file preview; Assembly stays animated web stepper.
- Classroom flow makes no remote/cloud/server calls.

Manual checks:

- Teacher can explain the next action in under 10 seconds on a projector.
- Student can recover after a bad mechanism state with one reset.
- Assembly can be followed on screen without printing.

## Stop condition

This plan is complete when a novice can open `https://alansynn.com/ms/`, choose a classroom starter, edit character/path, fit a real mechanism, reset safely after failure, generate blueprint files, and follow animated assembly to build the mechanism + character without server accounts, paper-only instructions, or hidden fake state.

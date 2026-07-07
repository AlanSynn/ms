# MotionSmith Project Agents Contract

Status: active
Last refreshed: 2026-06-29
Scope: every implementation, design, test, and documentation change in this repository.

This file is the project-level rulebook for future agents. If older docs or UI copy drift from this contract, update the product to match this file and `DESIGN.md`; do not add another explanatory layer.

## 1. Product direction: tinkerable workbench first

MotionSmith is a tinkerable workbench, not a reading-heavy tutorial. Users should learn the workflow by touching the character, joints, paths, mechanisms, and playback controls directly.

- Product scope is local-first browser/Tauri. Do not add backend/API server, cloud DB, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server inference, or server export jobs unless the user explicitly reopens server scope.
- Classroom web release is the static GitHub Pages app at `https://alansynn.com/ms/` with `VITE_BASE_PATH=/ms/`; do not add accounts, uploads, rosters, dashboards, analytics, or cloud sync language for classroom support.
- When a full-stack feature gap needs a server, document it as excluded local-first scope instead of building a fake client-only substitute.
- Local persistence must be named honestly: browser autosave, local snapshot download, portable project copy. Do not label downloads as cloud save/sync.
- AI/inference stays browser-local ONNX. If model caching or local inference fails, use starter/package workflows and show status; do not mock remote AI.
- Guided classroom lesson templates must create real serializable `ProjectState` data. Blank starters stay mechanism-free; lessons may include paths/mechanisms only when they are editable and exportable.
- Classroom entry is theme-guided first: guided project templates are the primary classroom start, while blank/import/open exploration stays secondary and always available. Keep this guidance in compact modal/left-pane/library surfaces, never as a center-canvas tutorial.
- Guided project cards must show the result plus two novice cues only: `Change <editable thing>` and `Build <physical thing>`. Put direct-translation / sensemaking detail in stage context or teacher-pack metadata, not first-run cards.
- Opening any guided project must land on Character with a compact `Make it yours` ownership cluster for parts, joints, path, mechanism fit, and reset. Guided starters are editable baselines, never locked demos.
- Repository text and product UI are English-only. Do not add bilingual labels, Korean prose, or mixed-language examples; tests must block non-English Hangul text from returning.
- First-run startup is one static logo/wordmark/version boot loader that disappears when the editor is ready; after it releases to Character, show the compact Getting Started modal unless the student checked the session-only opt-out.
- Getting Started can be reopened from the Character/Getting Started action and stays compact/result-first: Guide, Starter rig, Girl, Boy, Image, and Character file tiles with tiny thumbnails only where useful, plus Open full project as secondary. Avoid process/explanation copy in the modal.
- `Reset Lesson` must restore a known-good lesson baseline while preserving app settings; Foundry reset must restore finite mechanism preview state, not just stop playback.
- Prefer direct manipulation over explanatory prose: draw on the canvas, drag joints, scrub playback, rotate the view, tune sliders, and see the result immediately.
- Remove or collapse text that does not unlock an action, safety warning, blocker, or fabrication decision.
- Keep the center workbench visually quiet: no instruction essays, no scrollable copy panels, no sidecar explainers, no fake preview cards inside the canvas.
- Make every visible control answer one novice question: “What can I do now?”
- Favor icons, handles, ghost previews, hover affordances, short labels, and status chips over paragraphs.
- Every workflow must remain compact enough to understand at a glance on one screen.

### Result-first UI copy policy

Visible runtime copy should be labels, status chips, direct actions, or blockers. Users should see what can be done or what will result, not how the system works.

- Keep buttons, chips, pane headers, and setting labels to short nouns or verbs; prefer one to three words.
- Remove explanatory paragraphs from visible stage panes. Move rare necessary detail into tooltips, docs, or collapsed diagnostics.
- Use `utils/contextHelp.ts` and `components/ui/ContextHelp.tsx` for any visible `?` help affordance; keep entries short, locale-ready, and centralized instead of inlining explanations in stages.
- Warnings must be direct blockers or next actions such as `Fix: ...`, `No path`, or `Unlock part`; do not write theory or tutorial prose.
- Getting Started shows only starter choices. Character shows parts/joints. Path shows draw/edit controls. Foundry shows template, stack, status, and Use. Design shows target and parameters. Blueprint shows cut sheets/downloads. Assembly shows steps, parts, and board coordinates. Options shows setting names.
- Keep all runtime UI English-only and novice-readable; avoid jargon unless it names a physical part the user can see or fabricate.
- This policy also covers generated UI/export strings from utility modules such as `utils/fabrication.ts`, `utils/assemblyPlayback.ts`, `utils/mechanismTemplates.ts`, and `utils/appCommands.ts`.


## 2. Pane ownership and workflow shell

The editor follows a Canva/CAD-like shell with one shared scene state.

- Left rail/pane: workflow steps, object lists, starter/template choices, blockers, and primary actions.
- Center workbench: only the shared canvas/viewport, grid, character, paths, mechanisms, 2.5D/3D scene, handles, overlays, and zoom/orbit controls.
- Right pane: selected-item inspector only: exact numbers, physics options, friction/material/detail toggles, mechanism parameters, and warnings.
- Bottom/status dock: short state, playback, timeline/scrubber, export progress, and transient dialog/toast surfaces.
- Do not let right-pane scrolling move the center canvas.
- Do not reset viewport, selection, path, mechanism, or animation state when switching tabs.
- All tabs and exports operate on canonical `ProjectState`; no tab may keep a separate mock scene.
- Blueprint owns build files and printable/export artifacts. Assembly owns animated step-by-step build/teacher-pack guidance. Do not merge these roles into one reading-heavy panel.

## 3. Interaction contract

- Character import/selection must create editable body parts, skeleton joints, bend directions, and anchors in `ProjectState`.
- Free path drawing must be canvas-native and continuous; users should not need to type coordinates first.
- Path Editor must render only character, skeleton, editable path, and path handles; it must not render mechanism geometry, mechanism pins, or mechanism overlays.
- Mechanism Design is the first workflow tab that overlays character + path + mechanism together, and its mechanism visualization/animation must reuse the same Foundry renderer and fabrication/physics contracts.
- IK must visibly support direct joints, two-joint limbs, three-joint limbs, and longer chains when the data permits it.
- Bend/fold direction must be chosen with visible handles or compact toggles near the affected joint.
- Mechanism binding must attach real end-effectors to selected body-part anchors; moving mechanisms must move the character preview.
- Animation must advance from actual mechanism/IK state, not decorative CSS or disconnected preview drawings.
- Warnings belong near the blocked object or in the status dock; they should explain the next action, not the whole theory.

## 4. 2.5D / 3D physics scene contract

2.5D is the main authoring mode: a locked camera looking at the same real 3D scene. 3D mode only unlocks orbit/pan/inspect; it must not switch to a separate fake representation.

- The selected high-performance stack is `three` + Rapier WASM (`@dimforge/rapier3d-compat`) behind `utils/physicsKernel.ts`; mechanism kinematics/fabrication constraints remain authoritative, and Rapier handles contact/friction validation.
- Use a Viser-style transform tree, batched transform updates, object pooling, shared geometries/materials, and `InstancedMesh` before adding another renderer or scene framework.
- Do not add React Three Fiber, Babylon, WebGPU, or a new physics engine unless profiling or contract tests prove the current Three/Rapier boundary cannot meet the requirement.
- Do not bundle the browser Rapier runtime with `bun build`; the app build path must remain `tsc && vite build`, with a literal dynamic Rapier import so Vite emits the lazy physics chunk and Playwright validates it through production preview.
- A mechanism preview must show the physical parts that would be built: links, holes, slots, pivots, pins, gears, cams, followers, racks, guides, spacers, clips, and base board where relevant.
- Real thickness must be visible on parts. Avoid confusing transparent planes unless they are temporary hover/selection affordances.
- Force, velocity, friction, contact, and constraint-error overlays must come from sampled kinematic/physics state.
- Mechanism templates must preserve physical laws: fixed link lengths, valid joint constraints, gear pitch/radius compatibility, cam/follower contact, slider guide limits, rack/gear tangency, and spacer clearance.
- Foundry preview must let the user play, scrub, rotate/unlock the 3D view, inspect path trace, inspect forces/velocities, and tune physics options.
- The same simulation source must drive Path Editor, Mechanism Foundry, Design, Blueprint, and Assembly Guide views.

## 5. Fabrication and assembly contract

The app must always trend toward real buildable artifacts, not illustration-only mechanisms.

- Foundry templates and fabrication templates must be compatible by construction.
- Moving stacks should be modelled as fabrication layers such as `clip -> moving part -> spacer -> moving part -> clip`; keep the base board separate.
- Assembly/exploded views must show z-order, thickness, holes, spacers, clips, and the order of parts clearly enough to print or follow on screen.
- Use simple solid colors/materials that distinguish cardboard, wood/acrylic, hardware, spacers, and clips; realism means readable construction, not visual noise.
- Blueprint and assembly guide exports must be derived from `ProjectState` plus the same fabrication stack used by the viewport.
- If a mechanism cannot be fabricated with current templates, surface a blocker and create or document the missing template instead of pretending it works.

## 6. AI / ONNX contract

- No mock AI panels, fake recommendations, or placeholder inference.
- If AI is used, run browser-local Web ONNX and reference `docs/archive/ports/to-port-web-onnx` / Python behavior when porting model logic.
- ONNX output must become editable `ProjectState` data: body parts, joints, paths, masks, anchors, or package metadata.
- If inference is unavailable, fall back to explicit user-loaded packages or starter templates and say what is missing in the status dock.

## 7. Simplicity and implementation discipline

- Prefer deletion, reuse, and existing utilities over new abstractions.
- Do not add dependencies without first proving existing React/Vite/three utilities cannot solve the task.
- Do not create duplicate canvas engines, duplicate mechanism registries, or disconnected preview state.
- Keep code paths boring and testable: `ProjectState` -> projection/simulation -> viewport/export.
- Avoid large UI copy rewrites when a smaller control, icon, handle, or state chip solves the problem.

## 8. Subsystem / package governance

- Keep one app package until `docs/subsystem-governance-and-mechanism-contracts.md` says a measured ADR justifies a real package/workspace split.
- Treat source modules as package seams now: mechanism registry, snapshots, scene projection, physics session, fabrication/export, and UI stage adapters must not duplicate each other’s rules.
- Mechanism Foundry, Mechanism Design, Blueprint, Assembly Guide, 2D canvas, and 3D viewport must consume the same fabrication and physics contracts for a mechanism.
- Stage components may compose controls, but mechanism defaults, required parts, drag handles, z-stacks, and fabrication validation belong behind shared registry/facade helpers.
- If a new library is adopted, document the measured performance/maintainability reason and keep the dependency behind a replaceable subsystem boundary.


## 8.1 Code shape, SOLID, and domain seams

Keep files compact by responsibility, not by ceremony. Split code when one file starts owning multiple reasons to change.

- `App.tsx` should be the composition shell: app state, command wiring, stage selection, and top-level layout only. Do not add new mechanism math, fabrication rules, renderer geometry, or long stage internals there.
- Domain modules compute. UI modules compose. Renderer modules draw. Export modules serialize. A file that does two of these gets split at the existing seam.
- Use SOLID as a guardrail, not boilerplate: single responsibility first; open extension through existing registries/contracts; dependency inversion only at real boundaries such as renderer, physics, import, or export.
- Do not create interfaces, factories, providers, or adapters with one implementation. Plain typed functions are preferred until a second real consumer exists.
- New mechanism behavior enters the shared domain path first: `utils/mechanismReference.ts`, `utils/mechanismFeatureRegistry.ts`, `utils/kinematics.ts`, fabrication manifest/recipes, then UI. No stage component may invent a private mechanism rule.
- File-size target: keep new files under roughly 400 lines and refactor files over roughly 800 lines when already touching them. Do not churn stable large files just to satisfy a number; move behavior with tests.
- Refactor by extraction only unless the task is a redesign: move code, preserve names/behavior, run tests, then simplify. Never mix huge file moves with feature changes.
- UI leaf extraction must preserve existing public mount/import contracts with temporary re-exports until call sites move; contract tests should lock the mount before compatibility exports are removed.
- Large-file refactors need a baseline commit plus a golden-master gate before extraction. The gate must lock the current `ProjectState`, mechanism snapshot/projection, fabrication stack, and export behavior that the refactor might touch.
- Golden-master gates are necessary, not sufficient, for UI extraction. Pair App/stage JSX moves with command-contract tests and production-preview browser coverage for the touched workflow.
- Treat `ProjectState` as the domain aggregate root. UI stages may issue commands/actions; domain modules own rules and invariants; renderer/export modules receive already-derived plans.
- Use domain-driven vocabulary consistently: `ProjectState` aggregate, mechanism recipe, fabrication stack, scene projection, command handler, and stage adapter mean the same thing in docs, tests, and code.
- Keep harness engineering first-class: every extracted seam should be callable from tests with serializable fixtures, stable ids, and deterministic outputs before UI wiring depends on it.
- Make seams harness-friendly: extracted modules expose typed functions/components with explicit inputs and no hidden clocks, random ids, storage, network, or DOM mutation unless that side effect is the module's named boundary.
- If a golden-master hash changes during a refactor, stop and prove the behavior change is intentional before updating the hash. Pure extraction should not require hash updates.
- When touching `App.tsx`, prefer extracting an existing seam over adding code there. A new feature may enter `App.tsx` only as top-level composition or command wiring.
- Delete dead legacy surfaces before wrapping them. If a file is not imported by runtime, either remove it with contract-test updates or document why it remains as historical coverage.
- Commit per seam: docs map, generated cleanup, pure helper extraction, stage extraction, renderer extraction, legacy deletion.

## 9. Verification gates

Before claiming completion, run the smallest checks that prove the changed contract.

- Review policy is proportional: code review, architect review, and UltraQA are optional tools for explicit review requests, security/release risk, broad architecture changes, or unresolved uncertainty. Do not require `APPROVE`, `CLEAR`, or a clean review artifact for every local change once verification evidence is sufficient.
- `WATCH`/`COMMENT` review findings are advisory by default. Treat `BLOCK`/`REQUEST CHANGES` as blocking only when they identify a concrete unresolved correctness, safety, product-contract, or maintainability failure.
- Contract/docs changes: `bun run test`, `bun run build`, and contract assertions that lock the new rule.
- UI/workbench changes: add or update browser tests, then run the relevant Playwright flow plus build/contracts.
- Browser tests should preserve coverage while optimizing wall time: prefer bounded Playwright parallel workers (`fullyParallel`) and `PLAYWRIGHT_WORKERS=<n>` / `--workers=<n>` over deleting assertions, shortening workflows, or weakening checks. Use `--workers=1` only to reproduce order-dependent failures.
- Run the default browser suite against the production preview build, not the Vite HMR dev server, so full-suite failures reflect shipped UI behavior rather than transient websocket/HMR teardown noise. Use `PLAYWRIGHT_SERVER=dev` only for local interactive debugging.
- If a browser test cannot run in parallel, fix the shared-state leak or isolate test data before choosing serial execution.
- Physics/mechanism changes: test kinematic sampling, constraint validity, force/velocity/friction reporting, and fabrication stack compatibility. Simulation verification may be rigorous; prefer correctness over speed.
- Do not add artificial test time limits, timeout wrappers, or shortened runner timeouts. Let tests finish unless an external tool has truly hung, then fix the hang or record the blocker.
- Fabrication/export changes: test generated stacks, z-order/exploded data, printable/export artifacts, and round-trip project state.
- Commits must use the repository Lore commit protocol.

## 10. Release and deployment contract

- GitHub Pages is the only hosted web release path for now: publish the static app at `https://alansynn.com/ms/` with `VITE_BASE_PATH=/ms/`.
- Deploy only from version tags matching `v<package.json version>`; do not restore branch-push or manual workflow deploys.
- Keep release versions aligned across `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` before tagging.
- The `github-pages` environment must allow `v*.*.*` tags only. Do not re-enable `main` branch deployment unless the release policy is explicitly changed.
- Do not add a Pages `CNAME` file for this project page; the repo lives under the already-routed `/ms/` path.

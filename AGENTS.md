# MotionSmith Project Agents Contract

Status: active
Last refreshed: 2026-06-27
Scope: every implementation, design, test, and documentation change in this repository.

This file is the project-level rulebook for future agents. If older docs or UI copy drift from this contract, update the product to match this file and `DESIGN.md`; do not add another explanatory layer.

## 1. Product direction: tinkerable workbench first

MotionSmith is a tinkerable workbench, not a reading-heavy tutorial. Users should learn the workflow by touching the character, joints, paths, mechanisms, and playback controls directly.

- Prefer direct manipulation over explanatory prose: draw on the canvas, drag joints, scrub playback, rotate the view, tune sliders, and see the result immediately.
- Remove or collapse text that does not unlock an action, safety warning, blocker, or fabrication decision.
- Keep the center workbench visually quiet: no instruction essays, no scrollable copy panels, no sidecar explainers, no fake preview cards inside the canvas.
- Make every visible control answer one novice question: “What can I do now?”
- Favor icons, handles, ghost previews, hover affordances, short labels, and status chips over paragraphs.
- Every workflow must remain compact enough to understand at a glance on one screen.

## 2. Pane ownership and workflow shell

The editor follows a Canva/CAD-like shell with one shared scene state.

- Left rail/pane: workflow steps, object lists, starter/template choices, blockers, and primary actions.
- Center workbench: only the shared canvas/viewport, grid, character, paths, mechanisms, 2.5D/3D scene, handles, overlays, and zoom/orbit controls.
- Right pane: selected-item inspector only: exact numbers, physics options, friction/material/detail toggles, mechanism parameters, and warnings.
- Bottom/status dock: short state, playback, timeline/scrubber, export progress, and transient dialog/toast surfaces.
- Do not let right-pane scrolling move the center canvas.
- Do not reset viewport, selection, path, mechanism, or animation state when switching tabs.
- All tabs and exports operate on canonical `ProjectState`; no tab may keep a separate mock scene.

## 3. Interaction contract

- Character import/selection must create editable body parts, skeleton joints, bend directions, and anchors in `ProjectState`.
- Free path drawing must be canvas-native and continuous; users should not need to type coordinates first.
- IK must visibly support direct joints, two-joint limbs, three-joint limbs, and longer chains when the data permits it.
- Bend/fold direction must be chosen with visible handles or compact toggles near the affected joint.
- Mechanism binding must attach real end-effectors to selected body-part anchors; moving mechanisms must move the character preview.
- Animation must advance from actual mechanism/IK state, not decorative CSS or disconnected preview drawings.
- Warnings belong near the blocked object or in the status dock; they should explain the next action, not the whole theory.

## 4. 2.5D / 3D physics scene contract

2.5D is the main authoring mode: a locked camera looking at the same real 3D scene. 3D mode only unlocks orbit/pan/inspect; it must not switch to a separate fake representation.

- Use the existing `three` dependency and existing kinematics/physics utilities before adding dependencies.
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
- If AI is used, run browser-local Web ONNX and reference `docs/to-port-web-onnx` / Python behavior when porting model logic.
- ONNX output must become editable `ProjectState` data: body parts, joints, paths, masks, anchors, or package metadata.
- If inference is unavailable, fall back to explicit user-loaded packages or starter templates and say what is missing in the status dock.

## 7. Simplicity and implementation discipline

- Prefer deletion, reuse, and existing utilities over new abstractions.
- Do not add dependencies without first proving existing React/Vite/three utilities cannot solve the task.
- Do not create duplicate canvas engines, duplicate mechanism registries, or disconnected preview state.
- Keep code paths boring and testable: `ProjectState` -> projection/simulation -> viewport/export.
- Avoid large UI copy rewrites when a smaller control, icon, handle, or state chip solves the problem.

## 8. Subsystem / package governance

- Keep one app package until `docs/subsystem-governance-and-mechanism-contracts.md` says a measured ADR justifies a real npm/workspace split.
- Treat source modules as package seams now: mechanism registry, snapshots, scene projection, physics session, fabrication/export, and UI stage adapters must not duplicate each other’s rules.
- Mechanism Foundry, Mechanism Design, Blueprint, Assembly Guide, 2D canvas, and 3D viewport must consume the same fabrication and physics contracts for a mechanism.
- Stage components may compose controls, but mechanism defaults, required parts, drag handles, z-stacks, and fabrication validation belong behind shared registry/facade helpers.
- If a new library is adopted, document the measured performance/maintainability reason and keep the dependency behind a replaceable subsystem boundary.

## 9. Verification gates

Before claiming completion, run the smallest checks that prove the changed contract.

- Contract/docs changes: `npm test`, `npm run build`, and contract assertions that lock the new rule.
- UI/workbench changes: add or update browser tests, then run the relevant Playwright flow plus build/contracts.
- Browser tests should preserve coverage while optimizing wall time: prefer bounded Playwright parallel workers (`fullyParallel`) and `PLAYWRIGHT_WORKERS=<n>` / `--workers=<n>` over deleting assertions, shortening workflows, or weakening checks. Use `--workers=1` only to reproduce order-dependent failures.
- Run the default browser suite against the production preview build, not the Vite HMR dev server, so full-suite failures reflect shipped UI behavior rather than transient websocket/HMR teardown noise. Use `PLAYWRIGHT_SERVER=dev` only for local interactive debugging.
- If a browser test cannot run in parallel, fix the shared-state leak or isolate test data before choosing serial execution.
- Physics/mechanism changes: test kinematic sampling, constraint validity, force/velocity/friction reporting, and fabrication stack compatibility. Simulation verification may be rigorous; prefer correctness over speed.
- Do not add artificial test time limits, timeout wrappers, or shortened runner timeouts. Let tests finish unless an external tool has truly hung, then fix the hang or record the blocker.
- Fabrication/export changes: test generated stacks, z-order/exploded data, printable/export artifacts, and round-trip project state.
- Commits must use the repository Lore commit protocol.

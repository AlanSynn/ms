# Subsystem Governance Execution Log

Status: historical execution log; current contracts supersede dependency decisions
Date: 2026-08-20

## Source docs

- `docs/subsystem-governance-and-mechanism-contracts.md`
- `.omx/plans/prd-mechanism-subsystem-governance-execution.md`
- `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`

## Current stance

- Keep one app package for now.
- Implement source-module seams first: `MechanismFeatureRegistry`, then `MechanismSnapshot`.
- Do not add libraries until a benchmark or maintenance blocker proves the need.

## Library evaluation snapshot

Current local dependency check uses `package.json` + `bun.lock`; latest version check used `npm view` plus the official Bun GitHub latest release (`bun-v1.3.14`, published 2026-05-13) on 2026-06-27, and the repo now installs with Bun 1.3.14.

| Area | Current | Latest observed | Decision |
|---|---:|---:|---|
| Bun | 1.3.14 | 1.3.14 | Canonical package manager; `bun.lock` replaces `package-lock.json`. |
| React / React DOM | 19.2.7 | 19.2.7 | Keep current. |
| Three | 0.185.0 | 0.185.0 | Keep current. |
| onnxruntime-web | removed | 1.27.0 (historical observation) | Removed from classroom/Tauri builds on 2026-08-20; exclusion guard blocks reintroduction. |
| @playwright/test | 1.61.1 | 1.61.1 | Keep; browser suite runs against production preview mode without weakening coverage. |
| Vite | 8.1.0 | 8.1.0 | Keep current after build/test verification. |
| TypeScript | 6.0.3 | 6.0.3 | Keep current after typecheck verification. |
| esbuild | 0.28.1 | 0.28.1 | Direct devDependency because contract tests invoke the CLI. |
| @react-three/fiber | not installed | 9.6.1 | Defer/avoid for now; current imperative Three has cache/perf tests. Add only if renderer complexity becomes the bottleneck. |
| @react-three/drei | not installed | 10.7.7 | Defer; depends on R3F adoption. |
| @dimforge/rapier3d-compat | 0.19.3 | 0.19.3 | Installed behind `utils/physicsKernel.ts` as the Rapier contact/friction validation kernel; MotionSmith kinematics/fabrication remain authoritative. |
| @react-three/rapier | not installed | 2.2.0 | Defer; Rapier is used directly so no R3F renderer stack is introduced. |
| comlink | not installed | 4.4.2 | Defer; native Worker first if heavy computation needs off-main-thread execution. |

## Progress

- [x] Autopilot context snapshot created.
- [x] PRD draft created.
- [x] Test spec draft created.
- [x] Agent consensus review: Architect requested dependency/package gate; revised test spec.
- [x] Agent consensus review: Architect approved after revision; Critic approved execution.
- [x] M0 contract assertion.
- [x] M1 registry seam.
- [x] M2 snapshot seam.
- [ ] M3 stage/domain branch replacement.
  - [x] M3 slice 2: pane ownership / compact workbench corrections.
  - [x] M3 slice 3: Foundry preview/physics extraction and WebGL pixel-ratio cap.
  - [x] M3 slice 4: Bun-first modern toolchain.
  - [x] M3 slice 5: Rapier/Three high-performance physics kernel boundary and Viser-style scene policy.

## Consensus review notes

- Architect review round 1: revise. Required dependency/package adoption gate to become executable in the test spec.
- Revision applied: added `Dependency/package governance gate` to `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`.
- Architect review round 2: approve.
- Critic review: approve. Confirmed milestones are scoped, verifiable, feature-preserving, and dependency/performance gated.
- Runtime note: Codex native subagent notifications did not mirror into the OMX tracker; the tracker was repaired with the completed native subagent IDs before Autopilot state moved to `ultragoal`.
- M2 code-review round 1: request changes / architectural block. The snapshot fingerprint covered core dimensions but missed persisted mechanism fields `showOutputGear` and `outputGearRadius`.
- M2 code-review round 2: approve / architectural clear after persisted output-gear fields were added to the snapshot payload and fingerprint path.

## Implementation log

- M0: added `docs/subsystem-governance-and-mechanism-contracts.md` and this execution log to the static contract corpus.
- M0: locked the governance contract strings for `ProjectState`, `MechanismFeatureRegistry`, `MechanismSnapshot`, `ToonSceneProjection`, duplicate-registry prohibition, and performance governance.
- M1: added `utils/mechanismFeatureRegistry.ts` as a thin source-module seam over the existing mechanism metadata, default factory, kinematics solver, feasible-range sampler, required-parts helper, fabrication stack, and fabrication render plan.
- M1: added contract coverage proving the registry covers every `ALL_MECHANISM_TYPES` entry exactly once and delegates to canonical helpers rather than duplicating mechanism logic.
- M2: added `utils/mechanismSnapshot.ts` as an immutable derived DTO builder from `ProjectState` + mechanism id.
- M2: snapshot fingerprint now changes for mechanism parameters, output gear display/radius fields, target ids, relevant path data, and physical-kit changes while preserving the input `ProjectState`.
- M2 rework: expanded the snapshot mechanism payload to carry the complete persisted behavior/rendering parameter set from `MechanismConfig` before stage adapters consume snapshots.
- M2: contract coverage now checks deterministic snapshots, recursive freeze behavior, every mechanism type, fabrication plan validation results, adapter hints, and missing-id null behavior.
- M3 slice 1: moved drag-handle availability into `MechanismFeatureRegistry.interactionPolicy`; `Canvas.tsx` was later retired once runtime surfaces no longer imported it.
- M3 slice 2 agent review: architecture lane confirmed the registry/snapshot seam exists but is not yet authoritative across all render/export surfaces; UI lane confirmed Character selection, Blueprint guide preview, and Foundry display controls still violated pane ownership.
- M3 slice 2: Character now keeps Getting Started as a starter dialog while the Character tab owns the body-part object list, selected-part detail, skeleton controls, shared viewport, and direct part/skeleton edit command without routing to Path.
- M3 slice 2: the shared workbench container is overflow-hidden in desktop layout so right-pane scrolling cannot move the center canvas.
- M3 slice 2: Foundry starts in compact mode with sensemaking collapsed, keeps only compact stack/action state in the left pane, and moves rig opacity to the right inspector.
- M3 slice 2: Blueprint keeps the center as the cut-sheet/work canvas and moves the printable assembly guide iframe into the right inspector.
- M3 slice 2: updated AGENTS.md with subsystem/package governance: single app package for now, shared source-module seams, and measured-library adoption rules.
- M3 slice 2: `test:browser` now builds once and runs Playwright against Vite production preview (`PLAYWRIGHT_SERVER=preview`) so the full browser suite validates the shipped bundle without Vite HMR websocket teardown noise. Dev-server browser testing remains available through `PLAYWRIGHT_SERVER=dev playwright test`.
- M3 slice 3: Foundry fitting/sweep preview now lives in `utils/mechanismPreview.ts`, and force, velocity, friction, and constraint-error overlay math now lives in `utils/physicsSession.ts` through `buildFoundryPhysicsOverlay`; the React Foundry stage only projects sampled physics points into the current camera overlay.
- M3 slice 3: Foundry feasible-range sampling is memoized by mechanism instead of recalculated on every animation commit.
- Renderer follow-up: `utils/renderPerformancePolicy.ts` owns DPR caps and the bounded effective-ratio calculation; Foundry and puppet previews reapply it on host and window resize while exposing the selected cap through `data-three-pixel-ratio-cap`.
- M3 slice 4: promoted Bun 1.3.14 to the canonical package manager, replaced `package-lock.json` with `bun.lock`, and updated CI, Docker, Tauri hooks, Windows helper scripts, README, and distribution docs to use Bun.
- M3 slice 4: upgraded the web stack to current registry-observed versions for React, Vite, TypeScript, Three, Lucide, Tauri CLI, esbuild, and type packages while preserving existing browser workflow coverage.
- M3 slice 4: updated AGENTS verification gates and planning docs to use Bun commands while keeping browser-test parallelization bounded and coverage-preserving.
- M3 slice 5: researched Viser as a Python-authored React/Three visualization server with hierarchical scene paths, batched updates, and batched primitives; adopted the transferable policy (`Viser-style transform tree + batched updates + instancing`) without adding Viser as an app runtime.
- M3 slice 5: installed `@dimforge/rapier3d-compat@0.19.3`, added `utils/physicsKernel.ts` as the replaceable Rapier WASM contact/friction kernel seam, and kept MotionSmith mechanism kinematics/fabrication constraints as the source of truth.
- M3 slice 5: Foundry and Design 3D telemetry now advertise `three-webgl2-imperative`, `rapier3d-compat`, the kinematic-authority update policy, and the high-throughput scene policy for browser-test enforcement.

## Verification

- `npm test` — pass (`project contracts ok`).
- `npm run build` — pass (`tsc && vite build`).
- `git diff --check` — pass.
- `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- `npm run test:browser` — pass (`31 passed`, 4.7m) using production preview mode. Covered character, free path drawing, foundry, mechanism design 3D templates, blueprint, camera, layout, zoom/pan, and workflow-stage regression tests.
- Code-review gate — pass (`APPROVE`, architectural status `CLEAR`).
- M2 `npm test` — pass (`project contracts ok`).
- M2 `npm run build` — pass (`tsc && vite build`).
- M2 `git diff --check` — pass.
- M2 historical review check — pass under the policy active at that time.
- M2 `npm run test:browser` — pass (`31 passed`, 6.3m).
- M3 slice 1 `npm test` — pass (`project contracts ok`).
- M3 slice 1 `npm run build` — pass (`tsc && vite build`).
- M3 slice 1 `git diff --check` — pass.
- M3 slice 1 historical review check — pass under the policy active at that time.
- M3 slice 1 `npm run test:browser` — pass (`31 passed`, 6.2m).
- M3 slice 2 `npm test` — pass (`project contracts ok`).
- M3 slice 2 `npm run build` — pass (`tsc && vite build`).
- M3 slice 2 `git diff --check` — pass.
- M3 slice 2 `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- M3 slice 2 targeted browser QA — pass: `npm run test:browser -- --grep "Character tab processing|Load package review|animation performance|Mechanism Foundry sensemaking"` (`4 passed`, 20.3s).
- M3 slice 2 targeted 3D template QA — pass: `npm run test:browser -- --grep "Mechanism Design center workspace renders physical 3D templates"` (`1 passed`, 2.4m).
- M3 slice 2 full browser QA — pass: `npm run test:browser` (`31 passed`, 4.7m) in production preview mode after confirming the prior dev-server run failed only from Vite HMR/webserver teardown (`ERR_CONNECTION_REFUSED`) rather than app assertions.
- M3 slice 2 test-engineer review — pass: no coverage gaps for Character, shared viewport, Foundry compact/sensemaking state, right-inspector opacity, and Blueprint guide placement.
- M3 slice 2 historical review check — pass under the policy active at that time.
- M3 slice 3 `npm test` — pass (`project contracts ok`).
- M3 slice 3 `npm run build` — pass (`tsc && vite build`).
- M3 slice 3 full browser QA — pass: `npm run test:browser` (`31 passed`, 4.7m) in production preview mode, including Foundry physics vectors, WebGL 3D camera/orbit, design 3D templates, free path drawing, and blueprint workflows.
- M3 slice 4 `bun install --frozen-lockfile` — pass.
- M3 slice 4 `bun outdated` — pass: no outdated dependency table emitted after the Bun/latest-stack update.
- M3 slice 4 `bun audit` — pass (`No vulnerabilities found`).
- M3 slice 4 `bun run test` — pass (`project contracts ok`).
- M3 slice 4 `bun run build` — pass (`tsc && vite build`) with the existing large-chunk warning from the ONNX/browser bundle.
- M3 slice 4 targeted browser QA — pass: `bun run test:browser -- --grep "Mechanism Design center workspace renders physical 3D templates"` (`1 passed`, 2.0m).
- M3 slice 4 full browser QA — pass: `bun run test:browser` (`31 passed`, 4.6m) in production preview mode, preserving character, path, foundry, mechanism design, blueprint, camera, zoom/pan, and free-path workflows.
- M3 slice 4 `git diff --check` — pass.
- M3 slice 5 `bun run test` — pass (`project contracts ok`) and executes a real Rapier WASM friction/contact probe.
- M3 slice 5 `bun run build` — pass (`tsc && vite build`) with Rapier emitted as a lazy `rapier-*.js` chunk and the existing ONNX/browser large-chunk warning.
- M3 slice 5 `bun run test:browser` — pass (`31 passed`, 4.4m) in production preview mode, including Foundry animation performance, CAD-style 3D camera/orbit, Mechanism Design physical 3D templates, shared zoom/pan, free path drawing, blueprint, camera, layout regressions, and Rapier runtime error telemetry (`data-physics-kernel-error="none"`).
- M3 slice 5 `bun audit` — pass (`No vulnerabilities found`).
- M3 slice 5 registry/latest check — pass: `@dimforge/rapier3d-compat@0.19.3`, `three@0.185.0`, `vite@8.1.0`, `typescript@6.0.3`, and Bun `1.3.14` match current registry-observed versions.
- M3 slice 5 `git diff --check` — pass.
- M3 slice 5 code-review round 1 — request changes / architectural block: ensure `utils/physicsKernel.ts` and the high-performance ADR are included in the tracked change, and preserve Rapier load failure diagnostics.
- M3 slice 5 rework: added `data-physics-kernel-error` telemetry on Foundry and Design 3D viewports, browser assertions for the healthy `none` state, and staged the new physics seam plus ADR for review.
- M3 slice 5 historical final review check — pass under the policy active at that time after locking the Vite Rapier bundle guard and staging the physics seam/ADR.

# Subsystem Governance Execution Log

Status: historical archive
Date: 2026-06-27

## Source docs

- `docs/subsystem-governance-and-mechanism-contracts.md`
- `.omx/plans/prd-mechanism-subsystem-governance-execution.md`
- `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`

## Current stance

- One app package for now.
- Source-module seams first: `MechanismFeatureRegistry`, then `MechanismSnapshot`.
- No libraries till benchmark/maintenance blocker proves need.

## Library evaluation snapshot

Local dep check uses `package.json`+`bun.lock`; latest version check used `npm view`+ official Bun GitHub latest release (`bun-v1.3.14`, published 2026-05-13) on 2026-06-27. Repo installs with Bun 1.3.14 now.

| Area | Current | Latest observed | Decision |
|---|---:|---:|---|
| Bun | 1.3.14 | 1.3.14 | Canonical package manager; `bun.lock` replaces `package-lock.json`. |
| React / React DOM | 19.2.7 | 19.2.7 | Keep. |
| Three | 0.185.0 | 0.185.0 | Keep. |
| onnxruntime-web | 1.27.0 | 1.27.0 | Keep. |
| @playwright/test | 1.61.1 | 1.61.1 | Keep; browser suite runs production preview, coverage unchanged. |
| Vite | 8.1.0 | 8.1.0 | Keep after build/test verify. |
| TypeScript | 6.0.3 | 6.0.3 | Keep after typecheck verify. |
| esbuild | 0.28.1 | 0.28.1 | Direct devDependency; contract tests invoke CLI. |
| @react-three/fiber | not installed | 9.6.1 | Defer/avoid; imperative Three has cache/perf tests. Add only if renderer complexity bottlenecks. |
| @react-three/drei | not installed | 10.7.7 | Defer; depends on R3F adoption. |
| @dimforge/rapier3d-compat | 0.19.3 | 0.19.3 | Installed behind `utils/physicsKernel.ts` as Rapier contact/friction kernel; MotionSmith kinematics/fabrication stay authoritative. |
| @react-three/rapier | not installed | 2.2.0 | Defer; Rapier used directly, no R3F renderer stack. |
| comlink | not installed | 4.4.2 | Defer; native Worker first if heavy compute needs off-main-thread. |

## Progress

- [x] Autopilot context snapshot created.
- [x] PRD draft created.
- [x] Test spec draft created.
- [x] Consensus review: Architect requested dependency/package gate; revised test spec.
- [x] Consensus review: Architect approved after revision; Critic approved execution.
- [x] M0 contract assertion.
- [x] M1 registry seam.
- [x] M2 snapshot seam.
- [ ] M3 stage/domain branch replacement.
  - [x] M3 slice 2: pane ownership / compact workbench corrections.
  - [x] M3 slice 3: Foundry preview/physics extraction + WebGL pixel-ratio cap.
  - [x] M3 slice 4: Bun-first modern toolchain.
  - [x] M3 slice 5: Rapier/Three high-perf physics kernel boundary + Viser-style scene policy.

## Consensus review notes

- Architect review round 1: revise. Required dependency/package adoption gate made executable in test spec.
- Revision applied: added `Dependency/package governance gate` to `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`.
- Architect review round 2: approve.
- Critic review: approve. Confirmed milestones scoped, verifiable, feature-preserving, dependency/perf gated.
- Runtime note: Codex native subagent notifications did not mirror into OMX tracker; tracker repaired with completed native subagent IDs before Autopilot state moved to `ultragoal`.
- M2 code-review round 1: request changes / architectural block. Snapshot fingerprint covered core dims but missed persisted mechanism fields `showOutputGear`+`outputGearRadius`.
- M2 code-review round 2: approve / architectural clear after persisted output-gear fields added to snapshot payload + fingerprint path.

## Implementation log

- M0: added `docs/subsystem-governance-and-mechanism-contracts.md`+ this execution log to static contract corpus.
- M0: locked governance contract strings for `ProjectState`, `MechanismFeatureRegistry`, `MechanismSnapshot`, `ToonSceneProjection`, duplicate-registry prohibition, performance governance.
- M1: added `utils/mechanismFeatureRegistry.ts` as thin source-module seam over existing mechanism metadata, default factory, kinematics solver, feasible-range sampler, required-parts helper, fabrication stack, fabrication render plan.
- M1: added contract coverage proving registry covers every `ALL_MECHANISM_TYPES` entry exactly once and delegates to canonical helpers rather than duplicating mechanism logic.
- M2: added `utils/mechanismSnapshot.ts` as immutable derived DTO builder from `ProjectState`+ mechanism id.
- M2: snapshot fingerprint now changes for mechanism parameters, output gear display/radius fields, target ids, relevant path data, physical-kit changes while preserving input `ProjectState`.
- M2 rework: expanded snapshot mechanism payload to carry complete persisted behavior/rendering param set from `MechanismConfig` before stage adapters consume snapshots.
- M2: contract coverage now checks deterministic snapshots, recursive freeze behavior, every mechanism type, fabrication plan validation results, adapter hints, missing-id null behavior.
- M3 slice 1: moved drag-handle availability into `MechanismFeatureRegistry.interactionPolicy`; `Canvas.tsx` later retired once runtime surfaces no longer imported it.
- M3 slice 2 agent review: architecture lane confirmed registry/snapshot seam exists but not yet authoritative across all render/export surfaces; UI lane confirmed Character selection, Blueprint guide preview, Foundry display controls still violated pane ownership.
- M3 slice 2: Character keeps Getting Started as starter dialog while Character tab owns body-part object list, selected-part detail, skeleton controls, shared viewport, direct part/skeleton edit command without routing to Path.
- M3 slice 2: shared workbench container is overflow-hidden in desktop layout so right-pane scrolling cannot move center canvas.
- M3 slice 2: Foundry starts in compact mode with sensemaking collapsed, keeps only compact stack/action state in left pane, moves rig opacity to right inspector.
- M3 slice 2: Blueprint keeps center as cut-sheet/work canvas, moves printable assembly guide iframe into right inspector.
- M3 slice 2: updated AGENTS.md with subsystem/package governance: single app package for now, shared source-module seams, measured-library adoption rules.
- M3 slice 2: `test:browser` now builds once and runs Playwright against Vite production preview (`PLAYWRIGHT_SERVER=preview`) so full browser suite validates shipped bundle without Vite HMR websocket teardown noise. Dev-server browser testing still available via `PLAYWRIGHT_SERVER=dev playwright test`.
- M3 slice 3: Foundry fitting/sweep preview now lives in `utils/mechanismPreview.ts`, force/velocity/friction/constraint-error overlay math now lives in `utils/physicsSession.ts` via `buildFoundryPhysicsOverlay`; React Foundry stage only projects sampled physics points into current camera overlay.
- M3 slice 3: Foundry feasible-range sampling memoized by mechanism instead of recalculated every animation commit.
- M3 slice 3: `utils/viewport.ts` owns shared `WEBGL_PIXEL_RATIO_CAP`; both Foundry and 3D puppet previews use it and expose cap via testable `data-three-pixel-ratio-cap` attributes.
- M3 slice 4: promoted Bun 1.3.14 to canonical package manager, replaced `package-lock.json` with `bun.lock`, updated CI, Docker, Tauri hooks, Windows helper scripts, README, distribution docs to use Bun.
- M3 slice 4: upgraded web stack to current registry-observed versions for React, Vite, TypeScript, Three, Lucide, Tauri CLI, esbuild, type packages while preserving existing browser workflow coverage.
- M3 slice 4: updated AGENTS verification gates and planning docs to use Bun commands while keeping browser-test parallelization bounded and coverage-preserving.
- M3 slice 5: researched Viser as Python-authored React/Three visualization server with hierarchical scene paths, batched updates, batched primitives; adopted transferable policy (`Viser-style transform tree + batched updates + instancing`) without adding Viser as app runtime.
- M3 slice 5: installed `@dimforge/rapier3d-compat@0.19.3`, added `utils/physicsKernel.ts` as replaceable Rapier WASM contact/friction kernel seam, kept MotionSmith mechanism kinematics/fabrication constraints as source of truth.
- M3 slice 5: Foundry and Design 3D telemetry now advertise `three-webgl2-imperative`, `rapier3d-compat`, kinematic-authority update policy, high-throughput scene policy for browser-test enforcement.

## Verification

- `npm test` — pass (`project contracts ok`).
- `npm run build` — pass (`tsc && vite build`).
- `git diff --check` — pass.
- `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- `npm run test:browser` — pass (`31 passed`, 4.7m) production preview mode. Covered character, free path drawing, foundry, mechanism design 3D templates, blueprint, camera, layout, zoom/pan, workflow-stage regression tests.
- Code-review gate — pass (`APPROVE`, architectural status `CLEAR`).
- M2 `npm test` — pass (`project contracts ok`).
- M2 `npm run build` — pass (`tsc && vite build`).
- M2 `git diff --check` — pass.
- M2 historical review check — pass under policy active at that time.
- M2 `npm run test:browser` — pass (`31 passed`, 6.3m).
- M3 slice 1 `npm test` — pass (`project contracts ok`).
- M3 slice 1 `npm run build` — pass (`tsc && vite build`).
- M3 slice 1 `git diff --check` — pass.
- M3 slice 1 historical review check — pass under policy active at that time.
- M3 slice 1 `npm run test:browser` — pass (`31 passed`, 6.2m).
- M3 slice 2 `npm test` — pass (`project contracts ok`).
- M3 slice 2 `npm run build` — pass (`tsc && vite build`).
- M3 slice 2 `git diff --check` — pass.
- M3 slice 2 `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- M3 slice 2 targeted browser QA — pass: `npm run test:browser -- --grep "Character tab processing|Load package review|animation performance|Mechanism Foundry sensemaking"` (`4 passed`, 20.3s).
- M3 slice 2 targeted 3D template QA — pass: `npm run test:browser -- --grep "Mechanism Design center workspace renders physical 3D templates"` (`1 passed`, 2.4m).
- M3 slice 2 full browser QA — pass: `npm run test:browser` (`31 passed`, 4.7m) production preview mode after confirming prior dev-server run failed only from Vite HMR/webserver teardown (`ERR_CONNECTION_REFUSED`) not app assertions.
- M3 slice 2 test-engineer review — pass: no coverage gaps for Character, shared viewport, Foundry compact/sensemaking state, right-inspector opacity, Blueprint guide placement.
- M3 slice 2 historical review check — pass under policy active at that time.
- M3 slice 3 `npm test` — pass (`project contracts ok`).
- M3 slice 3 `npm run build` — pass (`tsc && vite build`).
- M3 slice 3 full browser QA — pass: `npm run test:browser` (`31 passed`, 4.7m) production preview mode, incl. Foundry physics vectors, WebGL 3D camera/orbit, design 3D templates, free path drawing, blueprint workflows.
- M3 slice 4 `bun install --frozen-lockfile` — pass.
- M3 slice 4 `bun outdated` — pass: no outdated dependency table emitted after Bun/latest-stack update.
- M3 slice 4 `bun audit` — pass (`No vulnerabilities found`).
- M3 slice 4 `bun run test` — pass (`project contracts ok`).
- M3 slice 4 `bun run build` — pass (`tsc && vite build`) with existing large-chunk warning from ONNX/browser bundle.
- M3 slice 4 targeted browser QA — pass: `bun run test:browser -- --grep "Mechanism Design center workspace renders physical 3D templates"` (`1 passed`, 2.0m).
- M3 slice 4 full browser QA — pass: `bun run test:browser` (`31 passed`, 4.6m) production preview mode, preserving character, path, foundry, mechanism design, blueprint, camera, zoom/pan, free-path workflows.
- M3 slice 4 `git diff --check` — pass.
- M3 slice 5 `bun run test` — pass (`project contracts ok`) and executes real Rapier WASM friction/contact probe.
- M3 slice 5 `bun run build` — pass (`tsc && vite build`) with Rapier emitted as lazy `rapier-*.js` chunk and existing ONNX/browser large-chunk warning.
- M3 slice 5 `bun run test:browser` — pass (`31 passed`, 4.4m) production preview mode, incl. Foundry animation performance, CAD-style 3D camera/orbit, Mechanism Design physical 3D templates, shared zoom/pan, free path drawing, blueprint, camera, layout regressions, Rapier runtime error telemetry (`data-physics-kernel-error="none"`).
- M3 slice 5 `bun audit` — pass (`No vulnerabilities found`).
- M3 slice 5 registry/latest check — pass: `@dimforge/rapier3d-compat@0.19.3`, `three@0.185.0`, `vite@8.1.0`, `typescript@6.0.3`, Bun `1.3.14` match current registry-observed versions.
- M3 slice 5 `git diff --check` — pass.
- M3 slice 5 code-review round 1 — request changes / architectural block: ensure `utils/physicsKernel.ts` and high-performance ADR included in tracked change, preserve Rapier load failure diagnostics.
- M3 slice 5 rework: added `data-physics-kernel-error` telemetry on Foundry and Design 3D viewports, browser assertions for healthy `none` state, staged new physics seam + ADR for review.
- M3 slice 5 historical final review check — pass under policy active at that time after locking Vite Rapier bundle guard and staging physics seam/ADR.
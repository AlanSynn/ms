# Subsystem Governance Execution Log

Status: active
Date: 2026-06-27

## Source docs

- `docs/subsystem-governance-and-mechanism-contracts.md`
- `.omx/plans/prd-mechanism-subsystem-governance-execution.md`
- `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`

## Current stance

- Keep one app package for now.
- Implement source-module seams first: `MechanismFeatureRegistry`, then `MechanismSnapshot`.
- Do not add libraries until a benchmark or maintenance blocker proves the need.

## Library evaluation snapshot

Current local dependency check used `package.json`; latest version check used `npm view` on 2026-06-27.

| Area | Current | Latest observed | Decision |
|---|---:|---:|---|
| React / React DOM | 19.2.0 | 19.2.7 | Defer patch until implementation branch is stable; low value for contract work. |
| Three | 0.184.0 | 0.185.0 | Defer patch; use existing Three first. |
| onnxruntime-web | 1.27.0 | 1.27.0 | Keep. |
| @playwright/test | 1.61.1 | 1.61.1 | Keep; move browser suite to production preview mode to remove HMR noise without weakening coverage. |
| Vite | 6.2.0 | 8.1.0 | Defer major upgrade; risky until test/build branch is clean. |
| TypeScript | 5.8.2 | 6.0.3 | Defer major upgrade; no current blocker. |
| @react-three/fiber | not installed | 9.6.1 | Defer/avoid for now; current imperative Three has cache/perf tests. Add only if renderer complexity becomes the bottleneck. |
| @react-three/drei | not installed | 10.7.7 | Defer; depends on R3F adoption. |
| @dimforge/rapier3d-compat | not installed | 0.19.3 | Candidate for future dynamic physics only behind `PhysicsSession`; not needed for deterministic kinematic contract seam. |
| @react-three/rapier | not installed | 2.2.0 | Defer; only if R3F + Rapier both become justified. |
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
- M3 slice 1: moved Canvas drag-handle availability into `MechanismFeatureRegistry.interactionPolicy` and kept `Canvas.tsx` as a policy consumer instead of another mechanism-type registry.
- M3 slice 2 agent review: architecture lane confirmed the registry/snapshot seam exists but is not yet authoritative across all render/export surfaces; UI lane confirmed Character selection, Blueprint guide preview, and Foundry display controls still violated pane ownership.
- M3 slice 2: Character now keeps Getting Started as a starter dialog while the Character tab owns the body-part object list, selected-part detail, skeleton controls, shared viewport, and direct part/skeleton edit command without routing to Path.
- M3 slice 2: the shared workbench container is overflow-hidden in desktop layout so right-pane scrolling cannot move the center canvas.
- M3 slice 2: Foundry starts in compact mode with sensemaking collapsed, keeps only compact stack/action state in the left pane, and moves rig opacity to the right inspector.
- M3 slice 2: Blueprint keeps the center as the cut-sheet/work canvas and moves the printable assembly guide iframe into the right inspector.
- M3 slice 2: updated AGENTS.md with subsystem/package governance: single app package for now, shared source-module seams, and measured-library adoption rules.
- M3 slice 2: `test:browser` now builds once and runs Playwright against Vite production preview (`PLAYWRIGHT_SERVER=preview`) so the full browser suite validates the shipped bundle without Vite HMR websocket teardown noise. Dev-server browser testing remains available through `PLAYWRIGHT_SERVER=dev playwright test`.

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
- M2 code-review gate — pass (`APPROVE`, architectural status `CLEAR`).
- M2 `npm run test:browser` — pass (`31 passed`, 6.3m).
- M3 slice 1 `npm test` — pass (`project contracts ok`).
- M3 slice 1 `npm run build` — pass (`tsc && vite build`).
- M3 slice 1 `git diff --check` — pass.
- M3 slice 1 code-review gate — pass (`APPROVE`, architectural status `CLEAR`).
- M3 slice 1 `npm run test:browser` — pass (`31 passed`, 6.2m).
- M3 slice 2 `npm test` — pass (`project contracts ok`).
- M3 slice 2 `npm run build` — pass (`tsc && vite build`).
- M3 slice 2 `git diff --check` — pass.
- M3 slice 2 `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- M3 slice 2 targeted browser QA — pass: `npm run test:browser -- --grep "Character tab processing|Load package review|animation performance|Mechanism Foundry sensemaking"` (`4 passed`, 20.3s).
- M3 slice 2 targeted 3D template QA — pass: `npm run test:browser -- --grep "Mechanism Design center workspace renders physical 3D templates"` (`1 passed`, 2.4m).
- M3 slice 2 full browser QA — pass: `npm run test:browser` (`31 passed`, 4.7m) in production preview mode after confirming the prior dev-server run failed only from Vite HMR/webserver teardown (`ERR_CONNECTION_REFUSED`) rather than app assertions.
- M3 slice 2 test-engineer review — pass: no coverage gaps for Character, shared viewport, Foundry compact/sensemaking state, right-inspector opacity, and Blueprint guide placement.
- M3 slice 2 code-review gate — pass (`APPROVE`, architectural status `CLEAR`).

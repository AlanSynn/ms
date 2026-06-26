# Subsystem Governance Execution Log

Status: active
Date: 2026-06-26

## Source docs

- `docs/subsystem-governance-and-mechanism-contracts.md`
- `.omx/plans/prd-mechanism-subsystem-governance-execution.md`
- `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`

## Current stance

- Keep one app package for now.
- Implement source-module seams first: `MechanismFeatureRegistry`, then `MechanismSnapshot`.
- Do not add libraries until a benchmark or maintenance blocker proves the need.

## Library evaluation snapshot

Current local dependency check used `package.json`; latest version check used `npm view` on 2026-06-26.

| Area | Current | Latest observed | Decision |
|---|---:|---:|---|
| React / React DOM | 19.2.0 | 19.2.7 | Defer patch until implementation branch is stable; low value for contract work. |
| Three | 0.184.0 | 0.185.0 | Defer patch; use existing Three first. |
| onnxruntime-web | 1.27.0 | 1.27.0 | Keep. |
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
- [ ] M2 snapshot seam.

## Consensus review notes

- Architect review round 1: revise. Required dependency/package adoption gate to become executable in the test spec.
- Revision applied: added `Dependency/package governance gate` to `.omx/plans/test-spec-mechanism-subsystem-governance-execution.md`.
- Architect review round 2: approve.
- Critic review: approve. Confirmed milestones are scoped, verifiable, feature-preserving, and dependency/performance gated.
- Runtime note: Codex native subagent notifications did not mirror into the OMX tracker; the tracker was repaired with the completed native subagent IDs before Autopilot state moved to `ultragoal`.

## Implementation log

- M0: added `docs/subsystem-governance-and-mechanism-contracts.md` and this execution log to the static contract corpus.
- M0: locked the governance contract strings for `ProjectState`, `MechanismFeatureRegistry`, `MechanismSnapshot`, `ToonSceneProjection`, duplicate-registry prohibition, and performance governance.
- M1: added `utils/mechanismFeatureRegistry.ts` as a thin source-module seam over the existing mechanism metadata, default factory, kinematics solver, feasible-range sampler, required-parts helper, fabrication stack, and fabrication render plan.
- M1: added contract coverage proving the registry covers every `ALL_MECHANISM_TYPES` entry exactly once and delegates to canonical helpers rather than duplicating mechanism logic.

## Verification

- `npm test` — pass (`project contracts ok`).
- `npm run build` — pass (`tsc && vite build`).
- `git diff --check` — pass.
- `npm audit --audit-level=high` — pass (`found 0 vulnerabilities`).
- `npm run test:browser` — pass (`31 passed`, 6.0m). Covered character, free path drawing, foundry, mechanism design 3D templates, blueprint, camera, layout, zoom/pan, and workflow-stage regression tests.
- Code-review gate — pass (`APPROVE`, architectural status `CLEAR`).

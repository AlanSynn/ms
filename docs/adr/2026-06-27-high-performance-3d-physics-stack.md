# ADR: High-performance 3D physics stack

Status: accepted
Date: 2026-06-27

## Decision

Use **imperative Three.js/WebGL2** for MotionSmith viewports, **Rapier 3D WASM** via `@dimforge/rapier3d-compat` for contact/friction validation behind `utils/physicsKernel.ts`.

MotionSmith mechanism equations, IK, fabrication stacks, z-order, spacers, kit constraints, export geometry stay authoritative. Rapier validates physical contact/friction behavior, gives future path for dynamic collision/solver probes; does not own `ProjectState`.

## Viser lesson applied

Viser useful as architecture reference, not runtime dependency. Transferable pattern:

- hierarchical scene identity / transform tree;
- batched state updates;
- batched/instanced scene primitives;
- one visual source mirrored into clients;
- binary-efficient updates for large visualization payloads.

MotionSmith applies as `viser-style-transform-tree-batched-updates-instancing` in telemetry + tests.

## Rejected for now

- React Three Fiber / `@react-three/rapier`: good future adapter, but duplicates current tested imperative Three scene owner.
- Babylon.js: powerful, but introduces second rendering engine, doesn't solve current drift.
- WebGPU rewrite: premature until profiling shows WebGL2 + instancing can't sustain target scenes.
- Viser runtime: Python/server viz framework, not local browser sim kernel.

## Required implementation rules

1. Keep one renderer per viewport.
2. Reuse geometries/materials; update transforms before rebuilding objects.
3. Use object pools + `InstancedMesh` for repeated pins, spacers, holes, board marks, hardware.
4. Keep Rapier lazy-loaded behind `utils/physicsKernel.ts`.
5. Keep browser build on `tsc && vite build`; do **not** use `bun build` for Rapier browser runtime until ADR replaces guard.
6. Use literal `import('@dimforge/rapier3d-compat')` in kernel seam so Vite emits real lazy Rapier chunk, not browser-unresolvable bare specifier.
7. Keep physics outputs serializable so can move to Worker later without changing UI contracts.
8. Browser tests must assert selected stack + performance telemetry.

## Verification hooks

- `bun run test` runs real Rapier friction/contact probe.
- Contract tests lock Vite build path + literal Rapier dynamic import.
- Foundry + Design browser tests assert `data-physics-kernel="rapier3d-compat"` + high-throughput scene policy.
- `PhysicsSession.summary` reports selected render stack, physics kernel, update policy.
# ADR: High-performance 3D physics stack

Status: accepted
Date: 2026-06-27

## Decision

Use **imperative Three.js/WebGL2** for MotionSmith viewports and **Rapier 3D WASM** via `@dimforge/rapier3d-compat` for contact/friction validation behind `utils/physicsKernel.ts`.

MotionSmith mechanism equations, IK, fabrication stacks, z-order, spacers, kit constraints, and export geometry remain authoritative. Rapier validates physical contact/friction behavior and provides the future path for dynamic collision/solver probes; it does not own `ProjectState`.

## Viser lesson applied

Viser is useful as an architecture reference, not as a runtime dependency. Its transferable pattern is:

- hierarchical scene identity / transform tree;
- batched state updates;
- batched/instanced scene primitives;
- one visual source mirrored into clients;
- binary-efficient updates for large visualization payloads.

MotionSmith applies that as `viser-style-transform-tree-batched-updates-instancing` in telemetry and tests.

## Rejected for now

- React Three Fiber / `@react-three/rapier`: good future adapter, but it would duplicate the current tested imperative Three scene owner.
- Babylon.js: powerful, but it would introduce a second rendering engine without solving current drift.
- WebGPU rewrite: premature until profiling shows WebGL2 + instancing cannot sustain target scenes.
- Viser runtime: it is a Python/server visualization framework, not a local browser simulation kernel.

## Required implementation rules

1. Keep one renderer per viewport.
2. Reuse geometries/materials; update transforms before rebuilding objects.
3. Use object pools and `InstancedMesh` for repeated pins, spacers, holes, board marks, and hardware.
4. Keep Rapier lazy-loaded behind `utils/physicsKernel.ts`, and request it only
   after the user explicitly enables the Foundry `Push` physics diagnostic.
   Startup, ordinary stage traversal, Foundry entry, Design entry, and playback
   remain on MotionSmith kinematics without fetching or initializing Rapier.
5. Keep the browser build on `tsc && vite build`; do **not** use `bun build` for the Rapier browser runtime until an ADR replaces this guard.
6. Use a literal `import('@dimforge/rapier3d-compat')` in the kernel seam so Vite emits a real lazy Rapier chunk instead of leaving a browser-unresolvable variable bare specifier.
7. Keep physics outputs serializable so they can move to a Worker later without changing UI contracts.
8. Browser tests must assert the selected stack and performance telemetry.

## Verification hooks

- `bun run test` runs a real Rapier friction/contact probe.
- Contract tests lock the Vite build path and the literal Rapier dynamic import.
- Foundry and Design browser tests assert `data-physics-kernel="rapier3d-compat"` and the high-throughput scene policy. A production-preview network test proves Foundry entry has zero Rapier requests and the explicit physics diagnostic performs one request.
- `PhysicsSession.summary` reports the selected render stack, physics kernel, and update policy.

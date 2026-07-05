# Foundry / Design / Assembly SSOT Plan

Status: active contract + implementation ledger
Date: 2026-07-05
Scope: mechanism visual/physical rules across Foundry, Design, Assembly, Blueprint handoff, and 3D assembly build simulation.

## Goal

Mechanism Foundry is the visual and physical source of truth for mechanisms. Design and Assembly may compose character/object/build context around a mechanism, but they must not invent independent mechanism geometry, z order, stack order, pin spans, spacer placement, or validation.

## Source order

1. `ProjectState` stores mechanism instances, targets, paths, body parts, scene objects, and settings.
2. Mechanism registry/fabrication helpers derive kinematics, render plans, stack roles, pin spans, and validation.
3. Foundry computes the shared mechanism scene contract.
4. Design consumes that contract for integrated automata motion.
5. Assembly consumes that contract inside an assembly scene frame.
6. Blueprint/export derive printable artifacts from the same recipes; they do not run a separate live mechanism scene.

## `MechanismSceneContract`

Add a plain-data contract derived from Foundry/fabrication helpers. It must include enough data for Foundry, Design, and Assembly to expose the same mechanism identity and physical interpretation:

- `mechanismId`, `mechanismType`, feature label, target id, generated path id;
- source markers for render plan, recipe, stack, and primitive source;
- readiness and validation errors;
- layer ids, labels, roles, colors, z values, centers, stack indices, primitive roles;
- pin stack ids, board coordinates, spacer/clip spans, attachment roles.

Authority rule:

- Foundry/fabrication helpers compute the contract.
- Design and Assembly consume it.
- No stage component may recompute mechanism stack, z, pin, or primitive semantics from `mechanism.type`.

Implementation status:

- `utils/mechanismSceneContract.ts` is the pure owner for baseline mechanism identity, render-plan source, fabrication-stack source, readiness, target metadata, and layer roles/z/colors.
- Assembly consumes the contract through `utils/assemblySceneFrame.ts` and passes the frame into the shared Foundry Three renderer.
- Stage components may import the utility contract; Design and Assembly must not invent alternate stack/z/pin semantics. Moving additional pure Foundry pin helpers out of `components/stages/foundry/` remains the next hardening slice before broader Design reuse.

## `AssemblySceneFrame`

Assembly may add build-step state around `MechanismSceneContract`, but it is not a second mechanism authority.

It may own:

- selected recipe/step;
- active phase;
- installed/current/reference layer state;
- active board coordinates vs floating references;
- active character part/object/anchor ids;
- highlight, progress, warning, camera key;
- explicit motion kind.

It must not own:

- mechanism primitive geometry;
- stack order;
- layer z source values;
- pin/span semantics;
- mechanism-type domain branches.

## Assembly motion taxonomy

| Motion kind | Meaning | X/Y allowed | Z allowed |
|---|---|---:|---:|
| `explode_z` | stack/layer separation | no | yes |
| `mount_travel_xy` | module/tray moves to board coordinate | yes | yes |
| `connect_travel_xy` | connector/character/object attachment travel | yes | yes |
| `scrub_time` | final mechanism playback/test motion | derived by mechanism | derived by mechanism |
| `none` | static step | no | no |

No x/y movement is valid under `explode_z`.

## Stage obligations

### Foundry

- Uses shared fabrication render plan, Foundry z/pin helpers, and Foundry primitives.
- Shows user path and mechanism path as separate toggleable overlays.
- `Fit path` defaults to the 15×15 board and kit-compatible part sizes.
- `Use mechanism` creates or updates a real `ProjectState.mechanisms[]` instance.

### Design

- Shows one integrated automata scene: mechanism drives character/body-part or scene-object target.
- Right inspector edits the selected mechanism instance.
- It may render character/object context through `ThreePuppetPreview`, but mechanism geometry/z/stack telemetry must come from `MechanismSceneContract`.
- New private mechanism primitives in `ThreePuppetPreview` are forbidden after the contract lands.

### Assembly

- Shows one Three build truth.
- Lower flow is a read-only step strip: labels, checks, progress only.
- No independent SVG mechanism/character simulation truth after cutover.
- Mechanism assembly passes `AssemblySceneFrame` into `ThreeFoundryPreview`; the renderer consumes it for current-layer focus, active board markers, floating references, z guides, mount/connect travel, and scrub path telemetry.
- Character assembly uses real `ProjectState` parts, art decals, fixed pins, free pivots, connector targets, and anchors.
- `explode_z` separates layers on z only.

### Blueprint

- Owns file/package generation and 2D/print previews.
- Must not grow a live 3D assembly simulator.
- Labels must match Assembly labels.

## Current state caveat

Assembly consumes `MechanismSceneContract` through `AssemblySceneFrame` and the shared Foundry Three renderer. Design exposes generated-path and feature telemetry through the current integrated automata preview, but full Design cutoff to contract-backed layer/z/pin parity remains incomplete. Foundry itself still has temporary stage-local renderer branches for mechanism-type presentation glue in `ThreeFoundryPreview` and `foundryPreviewStacks`; those branches must migrate toward shared helpers/contracts when they encode pin, z, stack, or primitive semantics. Until those cutoffs land, no new Design or Assembly code may invent private mechanism stack, z, pin, or fabrication rules.

## Implementation slices

1. Done baseline: `utils/mechanismSceneContract.ts` + contract/probe telemetry. Remaining hardening: migrate more pure Foundry pin helpers out of stage files before broader reuse.
2. Remaining: Design cutoff should consume more contract-backed mechanism telemetry and block new private `ThreePuppetPreview` mechanism primitive/z/stack helpers.
3. Done baseline: pure `AssemblySceneFrame`, canonical motion taxonomy, z-only explode data, read-only lower step strip.
4. Done baseline: Assembly removed nested ghost/dual SVG interpretation and renders build/module/mount/connect/test cues in one Three scene.
5. Ongoing: Blueprint/export labels and recipes must continue to derive from the same live mechanisms.

## Verification

Minimum implementation gate:

```sh
npx tsc --noEmit --pretty false
bun run test
bun run build
env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test
git diff --check
```

Targeted browser assertions:

- Foundry -> Design -> Assembly contract parity for same mechanism id/type/roles/z/validation.
- `explode_z` changes z only.
- lower Assembly strip has no independent SVG simulation truth.
- character/object attachment attrs are present in Assembly.
- runtime UI remains English-only.

# Mechanism Foundry input + verification PRD

## Scope
Foundry and all shared workspaces must feel like CAD: wheel zoom, drag orbit, drag pan/move, visible physical parts, no fake mechanisms.

## Input contract

- Wheel: zoom in/out on every canvas/3D viewport.
- Left drag in 3D: orbit unless 2D/front mode.
- Middle/right drag or Shift+drag: pan/move view on every 3D viewport.
- Left drag in 2D/front mode when not drawing: pan.
- Context menu suppressed on right-drag view pan.

## Foundry acceptance gate

A mechanism can appear in Foundry only if:

1. kinematics preserve topology invariants,
2. 3D preview uses centralized fabrication geometry,
3. stack order comes from `utils/fabrication.ts`,
4. force/velocity overlays originate from current solved joints,
5. browser tests cover render attributes and pan/zoom input.

## Hidden until ready

- 5bar and 6bar remain design/simulation-only until fabrication recipe PRDs are implemented and tested.

## Verification commands

```bash
bun run test:contracts
bun run build
PLAYWRIGHT_SERVER=preview playwright test tests/browser/workflow.spec.ts --grep "Foundry|3D|cam|assembly"
```

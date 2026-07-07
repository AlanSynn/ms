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

## Classroom visibility gate

- Mechanism graph compilation can produce buildable fabrication recipes for the current mechanism families.
- Foundry may still hide advanced families such as 5bar and 6bar from novice cards until classroom copy, safe editing ranges, and guided QA are ready.
- Hidden Foundry visibility must not mean a Design/Blueprint/Assembly fabrication fallback; those stages still consume graph compiler output.

## Verification commands

```bash
bun run test:contracts
bun run build
PLAYWRIGHT_SERVER=preview playwright test tests/browser/workflow.spec.ts --grep "Foundry|3D|cam|assembly"
```

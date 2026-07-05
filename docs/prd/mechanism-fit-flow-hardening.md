# Mechanism fit flow hardening

Status: implemented 2026-07-05

## Goal

Make the classroom flow work as one continuous artifact path:

1. Draw or choose a character motion path.
2. Compare that user path against a generated mechanism path in Foundry.
3. Apply the fitted mechanism to Design.
4. Drive the character preview from the fitted mechanism path.
5. Export the same fitted `ProjectState` through Blueprint and Assembly.

## Decisions

- `MechanismConfig.generatedPath` is the fitted mechanism path contract. Do not add a second fitted-path schema field unless export/import requirements change.
- Foundry shows two independent layers:
  - `User path`: the selected drawn path, mapped through the same Foundry fit context as the mechanism.
  - `Mech path`: the generated mechanism trace from the shared Three Foundry renderer.
- Design uses `motionPreviewForProject` for the context character preview so the visible character motion follows the same generated-path IK path used by runtime playback.
- Blueprint and Assembly continue to read the fitted `ProjectState`; they should not own separate fit logic.

## Verification anchors

- Contract test: Foundry user path must use `foundryFitContext.map`, not an unrelated scene-wide scale, and expose a finite user-to-mechanism fit error.
- Contract test: Design preview telemetry must come from `motionPreviewForProject` and report generated-path target error.
- Browser test: recommendation apply must show Design with `data-design-motion-source="generatedPath"`, non-empty target joint, animated part count, changing target coordinates under scrub, and near-zero target error.
- Browser test: Blueprint metadata must include the applied recommendation with `generatedPath.length >= 3`.
- Browser test: Assembly must drive the character ghost from the selected fitted mechanism while rendering active mechanisms, and must expose the applied mechanism id plus generated-path count from that exported project.

## Non-goals

- New optimizer.
- New mechanism schema.
- Server-side fitting.
- Separate renderer or preview state.

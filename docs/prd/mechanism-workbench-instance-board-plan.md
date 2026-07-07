# Mechanism workbench instance + board plan

Status: active implementation note
Date: 2026-07-05

## Target result

MotionSmith should keep the classroom flow stable while letting students add multiple same-kind mechanisms, attach them to character parts or Character-tab scene objects, and see/export the same board-ready assembly data.

## Decisions

1. **Foundry thumbnails are front-view previews, not separate drawings.**
   - Reuse the same `MechanismLinkagePreview` + `mechanismPreview` fit context used by Foundry-style preview code.
   - Cards show compact ghost poses plus the effector sweep so rotation is visible without introducing another renderer.

2. **Design edits mechanism instances.**
   - `ProjectState.mechanisms[]` remains the canonical independent-instance store.
   - Design right pane edits the selected instance by default; users can duplicate/add same-type mechanisms and bind each separately.
   - Foundry `Use mechanism` is target-aware: it refits an existing exact target to avoid duplicate-driver conflicts, while different targets remain separate id-based instances.
   - Batch editing is deferred until there is a clear classroom need; it risks changing multiple mechanisms unintentionally.

3. **Path targets are owner-based.**
   - Existing body-part paths remain compatible through `partId`.
   - Scene-object paths use `sceneObjectId` while preserving the old `partId` field for migration compatibility.
   - Motion preview for scene objects is simple rigid translation along the path; IK stays body-part-only.

4. **Board legality is enforced once.**
   - Use `utils/coordinates.ts`, `utils/project.ts`, and `utils/fabrication.ts` as the single fabrication-kit authority.
   - Blueprint remains the 2D print/board surface; Assembly remains the 3D exploded assembly surface.
   - Recommendation/add previews show the default 15×15 board fit, the user path, and the fitted generated path before adding the instance.
   - Unsupported mechanism families stay blocked until they have real reference recipes.

## Implementation slices

- Foundry: align left-card simulation to the same fit context and add a small effector cue.
- Path: let the target selector include Character-tab scene objects; draw/edit paths for object targets.
- Motion: return animated scene objects alongside animated parts for path/design previews.
- Design: show object paths as bindable targets and keep edits scoped to the selected mechanism instance.
- Fabrication: reject scene-object bindings only when the selected mechanism family lacks a buildable recipe; otherwise keep the board checks centralized.

## Verification

- Contract tests must cover scene-object path persistence, selection, and rigid motion preview.
- Browser tests must keep Foundry/Design/Assembly paths on production preview.
- Build must pass with no new dependencies.

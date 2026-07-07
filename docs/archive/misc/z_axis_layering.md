# Z-Axis Layering

Character parts render in `partOrder` order, carry explicit `zIndex`.

- **Back** and **Front** move unlocked parts in Path Editor.
- Locked parts reject transform, reorder, delete, path edits at reducer level.
- Mechanism-driven animation preserves each animated part's visual order while moving transform.
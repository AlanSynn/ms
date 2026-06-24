# Z-Axis Layering

Character parts render in `partOrder` order and carry an explicit `zIndex`.

- **Back** and **Front** move unlocked parts in the Path Editor.
- Locked parts reject transform, reorder, delete, and path edits at reducer level.
- Mechanism-driven animation preserves each animated part's visual order while moving its transform.

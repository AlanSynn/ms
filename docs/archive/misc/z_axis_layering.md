# Z-Axis Layering

Parts render in `partOrder` order, carry explicit `zIndex`.

- **Back** and **Front** move unlocked parts in Path Editor.
- Locked parts reject transform, reorder, delete, path edits at reducer level.
- Mechanism-driven animation preserves animated part visual order while moving transform.
# Z-Axis Layering

Parts render `partOrder` order, carry explicit `zIndex`.

- **Back** + **Front** move unlocked parts in Path Editor.
- Locked parts reject transform, reorder, delete, path edits at reducer level.
- Mechanism-driven animation preserves animated part visual order moving transform.
# MotionSmith 4-bar linkage PRD

## Scope
Verified Foundry/export mechanism. A-B-C-D loop, with A-D as the fixed ground link supplied by board or base linkage.

## Topology contract

```text
A fixed ground pivot
B moving input/coupler joint
C moving coupler/output joint
D fixed output ground pivot
A-D fixed ground link
A-B input crank
B-C coupler
C-D output rocker
```

## Physics invariants

- `|A-B| = crankLength`
- `|B-C| = couplerLength`
- `|C-D| = rockerLength`
- `|A-D| = groundLength`
- If circle closure fails for a phase, mark sample invalid. Never fake full 360° motion.
- `assemblyMode` only chooses open/crossed circle intersection branch.

## Fabrication contract

- Use `fabrication/generate_fabrication_templates.py` linkage/hole/spacer rules via `utils/fabricationContract.ts`.
- Default kit stack: back clip -> input L2 -> S10 -> coupler L4 -> S10 -> output L2 -> front clip.
- B and C are floating joints, not board pins.

## UI contract

- Foundry card visible only when this invariant test passes.
- Drag handles update lengths and snap to physical grid when kit mode is enabled.
- 3D preview must show thickness, holes, S10 spacing, force/velocity at current moving joint.

## Tests

- Contract test samples phases and asserts all four distances.
- Browser test verifies Foundry rendered layer labels and pan/zoom controls.

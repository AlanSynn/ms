# MotionSmith 5-bar linkage PRD

## Scope
Simulation/editing mechanism. Not Foundry/export-ready until dual-driver assembly, collision, and fabrication recipe are verified.

## Topology contract

```text
A fixed left ground pivot
B moving left crank end
C moving coupler intersection / output joint
D moving right crank end
E fixed right ground pivot
A-E fixed ground link
A-B left crank
B-C left coupler
C-D right coupler / rod
D-E right crank
```

## Physics invariants

- `|A-B| = crankLength`
- `|B-C| = couplerLength`
- `|C-D| = rodLength`
- `|D-E| = rockerLength`
- `|A-E| = groundLength`
- `speed1`, `speed2`, `phase`, `driverPhaseOffset` define the two crank drivers.
- Closure is circle intersection between B-centered `couplerLength` and D-centered `rodLength`.
- Invalid phases stay invalid. No visual teleport.

## Foundry gate

- Hidden from `FOUNDRY_MECHANISM_TYPES` until a verified physical recipe exists.
- Design tab can still simulate and fit paths.

## Fabrication open issues

- Needs explicit two-driver board coordinates.
- Needs Z-stack collision plan for crossing/coupled bars.
- Needs singularity warning near stretched/folded poses.

## Tests

- Contract test samples a known valid geometry and asserts all five distances.
- Foundry visibility test must prove 5bar is not export-ready until recipe exists.

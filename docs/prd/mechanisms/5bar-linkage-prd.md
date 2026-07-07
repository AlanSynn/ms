# MotionSmith 5-bar linkage PRD

## Scope
Graph-compiled simulation/editing mechanism. The graph compiler owns its fabrication recipe; classroom Foundry visibility remains a separate product/content gate.

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

## Foundry / classroom gate

- Graph compiler emits a buildable fabrication recipe for 5bar.
- Keep it out of novice Foundry cards until classroom copy, safe-edit controls, and guided-template QA are ready.
- Design and advanced flows can simulate, fit paths, and export through the graph compiler contract.

## Fabrication open issues

- Needs classroom-facing two-driver placement copy.
- Needs visual collision affordance for crossing/coupled bars.
- Needs novice singularity warning near stretched/folded poses.

## Tests

- Contract test samples a known valid geometry and asserts all five distances.
- Tests prove 5bar graph compilation is buildable while novice gallery visibility remains a product gate.

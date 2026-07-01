# MotionSmith gear train PRD

## Scope
Verified Foundry/export mechanism: separated endpoint gears by default; optional inserted idlers create the meshed gear line. No linkage rods in plain gear-train mode.

References:
- https://github.com/CKraft11/pygeartrain
- https://github.com/JarrettR/Stagger for future gear-linkage/motion-study parameter sweeps, not as gear-train authority.

## Topology contract

```text
G0 fixed drive axle
G1..Gn fixed idler/output axles
center distance between adjacent gears = r_i + r_{i+1}
external mesh reverses rotation at every mesh
```

## Physics invariants

- `centers[i+1] - centers[i] = r_i + r_{i+1}` along `groundAngle`.
- Output ratio: `(-1)^(n meshes) * r0 / rn`.
- Intermediate idlers change direction and spacing, not final magnitude except final radius.
- Plain gear train preview contains gears only; no output rods unless user chooses `gear_linkage`.

## Fabrication contract

- Gear outlines, teeth, holes, and attachment holes come from centralized fabrication contract.
- Required part count equals number of gear radii.
- Each gear axle is board-fixed in kit mode.

## Tests

- Contract tests assert center spacing, ratio sign, idler count, and required parts.
- Browser tests verify Foundry gear count equals `gearTrainRadii.length`.

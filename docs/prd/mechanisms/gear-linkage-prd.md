# MotionSmith gear linkage PRD

## Scope
Compound mechanism: verified two-gear train plus off-center output linkage. Separate from plain `gear`.

References:
- https://github.com/JarrettR/Stagger for future two-drive linkage sweep patterns.

## Topology contract

```text
G_a drive gear fixed on board
G_b driven gear fixed on board
P off-center attachment hole on G_b
R linkage output point
G_a meshes G_b
P-R is a fabricated linkage
```

## Physics invariants

- Gear pair center distance equals `r_a + r_b`.
- Driven gear angular velocity is `-omega_a * r_a / r_b`.
- P rotates around `G_b` at selected fabricated attachment radius.
- Linkage attaches to P, not to G_b board axle.

## Fabrication contract

- Driven gear must expose a real attachment hole. Reject G1 if no off-center holes.
- Linkage length snaps to L2/L4/L6/L8 family.
- Stack: board gear axle -> gear -> S10 -> linkage -> front clip/spacer.

## Tests

- Contract tests assert gear spacing and linkage pin radius.
- Assembly tests assert stack includes `H_gear`, not extra board pin.

# MotionSmith gear linkage PRD

## Scope
Fabrication-ready compound mechanism: two meshed gears each carry one off-center crank pin, and two fabricated linkages meet at one moving output point. This is not the plain `gear` train and not a single output rod. It matches the paper-style driving block where a paired gear crank can sweep a wide family of curves.

References:
- https://github.com/JarrettR/Stagger for future two-drive linkage sweep patterns.

## Topology contract

```text
A = drive gear fixed board axle
D = output gear fixed board axle
B = off-center crank pin on drive gear G_a
C = off-center crank pin on output gear G_b
R = shared moving linkage/output point
G_a meshes G_b, with optional idlers between them
B-R is one fabricated linkage
C-R is one fabricated linkage of the same selected length
```

## Physics invariants

- Every adjacent gear center distance equals `r_i + r_{i+1}`.
- Output gear angular velocity is `(-1)^mesh_count * omega_a * r_a / r_d`.
- B rotates around A at a real fabricated attachment-hole radius.
- C rotates around D at the same real fabricated attachment-hole radius.
- R is the valid circle intersection of radius `L` around B and radius `L` around C.
- If no intersection exists, the mechanism is invalid; previews may use a fallback midpoint only as a blocker state, never as successful simulation.

## Fabrication contract

- Drive and output gears must expose real off-center attachment holes. Reject G1 at endpoints because it has no crank holes.
- Idler gears may be any fabricated gear size because they do not carry crank pins.
- Attachment radius snaps to a shared fabricated hole radius available on both endpoint gears.
- Linkage length snaps to L2/L4/L6/L8 and is instantiated twice.
- Stack: fixed gear axle stacks stay board-mounted; B/C crank stacks are moving gear-handle holes; R joins the two link ends plus bracket.

## Tests

- Contract tests assert pitch spacing, endpoint gear rejection, B/C crank radius, B-R and C-R linkage lengths, and doubled linkage part count.
- Browser tests assert `two-gear-two-link-coupler`, five real pin sites, and layer roles `B-pin-to-R`, `C-pin-to-R`, and `R-connector`.

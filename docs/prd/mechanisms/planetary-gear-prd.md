# MotionSmith planetary gear PRD

## Scope
Verified Foundry/export mechanism: fixed internal ring, sun input, carrier output, one or more planets.

References:
- https://github.com/CKraft11/pygeartrain
- https://github.com/CKraft11/pygeartrain/blob/main/pygeartrain/planetary.py
- https://github.com/CKraft11/pygeartrain/blob/main/pygeartrain/core/kinematics.py

## Topology contract

```text
S sun gear at fixed center O
P planet gear on carrier axle
R internal ring fixed to board
C carrier arm rotates around O
R = S + 2P in tooth/radius convention
```

## Physics invariants

- Ring pitch radius = `sunPitchRadius + 2 * planetPitchRadius`.
- Carrier/sun output ratio with fixed ring = `S / (S + R)`.
- Planet spin follows pygeartrain equations:
  - `S*s + P*p - (S+P)*c = 0`
  - `R*r - P*p - (R-P)*c = 0`
- MotionSmith default maps to `Planetary("s", "c", "r")`: sun input, carrier output, ring fixed.
- With ring fixed, carrier/sun ratio is `S / (S + R)` and the planet axle moves with the carrier, not the board.

## Fabrication contract

- Default physical kit uses G1 sun, G3 planet, R56 ring, L2 carrier, S10 spacers.
- Ring mount holes are fixed to board.
- Carrier planet axle stack uses `H_carrier`, not board pin.

## Tests

- Contract tests assert ring radius, carrier ratio, planet spin, and part recipe.
- Browser tests verify planetary syntax and planet count data attributes.

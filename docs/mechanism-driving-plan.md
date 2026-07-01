# MotionSmith mechanism + driving plan

## Goal
Make every mechanism share one physical contract across Foundry, Design, Blueprint, fabrication stacks, and export. A mechanism must be a constrained assembly, not a drawing shortcut.

## Reference contract
- MIT CDMC treats characters as rigid components connected by pin, point-on-line, phase/gear, and fixed-state constraints. The runtime should map MotionSmith mechanisms to those constraints and solve/update from one input driver phase.
- CDMC gear phase constraint: `Cc = αi - f(αj)`, with spur/bevel gears using `f(α) = -r * α` where `r` is the tooth-count ratio. For a planar external gear train this means every mesh flips direction and the endpoint speed ratio is determined by the first and last pitch radii.
- CDMC connects optimized driving mechanisms back to one input driver through intermediate gear trains. MotionSmith keeps this as `driverGroupId + driverPhaseOffset` first, then can add a full constraint graph solver once multi-driver UI is ready.
- PaperMech public pages verify the user-facing taxonomy we must support: rack-pinion, crank, cam, spur gears, planetary gears, and walking/Jansen-style linkages. The legacy create/modules endpoints are inaccessible, so PaperMech is a taxonomy/reference source, not an implementation spec.

Sources:
- CDMC PDF: https://cfg.mit.edu/assets/files/CDMC_0.pdf
- PaperMech tutorials: https://www.papermech.net/tutorials/
- PaperMech examples: https://www.papermech.net/rotate-spur-gears/, https://www.papermech.net/rotate-planetary-gears/, https://www.papermech.net/walking-jansen-mechanism/

## Shared model now
`MechanismConfig` owns:
- `gearTrainRadii`: ordered external spur gear pitch radii. Two values preserve the old drive/output pair. More values are idlers.
- `driverGroupId`: mechanisms with the same group are driven by the same virtual input shaft.
- `driverPhaseOffset`: per-mechanism phase relative to the group driver.

The canonical helpers are in `utils/kinematics.ts`:
- `gearTrainPitchRadii(config)` sanitizes the train.
- `gearTrainPitchCenterDistance(config)` sums adjacent pitch-radius distances for the meshing chain.
- `gearTrainResolvedCenterDistance(config)` preserves a separated A/B endpoint span until idlers are inserted; once idlers exist, it snaps to the full pitch-chain distance.
- `gearTrainCenters(config)` places all gear centers on the ground axis using the resolved endpoint span.
- `gearTrainOutputRatio(config)` computes external spur train parity and endpoint ratio.

## Mechanism constraints
### Four-bar
Use the strict A-B-C-D contract:
- A = `p1`, B = `j1`, C = `j2`, D = `p2`.
- A-D is the fixed ground link.
- A-B crank, B-C coupler, C-D rocker are the three moving bars.
- Fabrication stack must expose exactly Input linkage, Coupler linkage, Output linkage separated by S10 spacers/clips.

### Five-bar
Current geared two-crank 5-bar remains:
- P1 and P2 are fixed crank centers.
- J1 and Aux are crank tips.
- J2 is the two-rod circle intersection.
- `speed2` and `phase` remain explicit until a full driver graph replaces them.

### Gear train
- Any number of external spur gears is allowed through `gearTrainRadii`.
- Pitch centers are cumulative adjacent radius sums along `groundAngle`.
- Output ratio is `(-1)^(n-1) * r0 / rN`.
- Fabrication inserts idler gear layers for trains longer than two gears and scales required parts with gear count.

### Six-bar
Use the strict Watt-style novice contract instead of a visual-only overlay:
- A = `p1`, B = `j1`, C = `j2`, D = `p2`, E = `aux/effector`.
- A-D is the fixed ground link.
- A-B crank, B-C coupler, and C-D rocker form the base four-bar.
- C-E is the dyad link (`rodLength`), D-E is the follower (`couplerPointDist`).
- Foundry, Design, physics, export, and fabrication all read the same dyad/follower lengths and stack labels (`Dyad link`, `Follower link`).

### Driving metadata
- `driverGroupId` is the virtual input shaft id.
- `driverPhaseOffset` shifts the mechanism's local input phase before the kinematic constraints are sampled.
- `phase` remains the existing secondary-output phase for legacy 5-bar/geared mechanisms.
- This milestone persists and solves the direct phase-offset contract. A later CDMC graph milestone should replace ad-hoc fields with typed `pin`, `pointOnLine`, `phase`, `gear`, and `fixed` constraints plus a Newton-style solve loop.

## Next milestones
1. **Current milestone:** shared gear-train/driving metadata, four-bar contract tests, multi-idler gear train tests, and six-bar dyad/follower tests.
2. **Constraint graph milestone:** introduce typed `Connection` records (`pin`, `pointOnLine`, `phase`, `gear`, `fixed`) and map every mechanism to CDMC-style constraints.
3. **Driving UI milestone:** add a compact driver-group editor: pick input shaft, assign mechanisms, phase offset, gear train auto-fill.
4. **Jansen/advanced six-bar milestone:** add separate specialized walking/Jansen templates only after each has canonical constraints, fabrication stack, and tests. Avoid fake drawing overlays.
5. **Blueprint milestone:** assembly guide should animate `clip → linkage/gear → S10 spacer → ...` for every stack generated by the same helpers.

## Verification rules
- Tests must assert physical distances/ratios, not only visibility.
- Foundry and Design telemetry must read the same helpers as fabrication/export.
- No mechanism-specific renderer may invent a different gear count, pitch ratio, or spacer stack.

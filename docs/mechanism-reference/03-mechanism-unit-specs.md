# 03 — Mechanism Unit Contracts

This document defines each mechanism as a portable unit: identifiers, symbols, parameters, physical parts, coordinates, spacer stacks, and validation rules.

## 3.1 Shared parameter snapping contract

Before a mechanism becomes user-visible, exported, or fabricated, normalize it through the physical kit contract:

```pseudo
ready = params
ready.physical_profile_key = "motionsmith-ms4n"
ready.grid_system_enabled = true unless explicitly false
ready.grid_cell_cm = 2.0 unless another pitch choice is selected
ready.hole_diameter_mm = 4.0
ready.board_rows = 15
ready.board_columns = 15
ready.fabrication_ready_preset_mode = ready.grid_system_enabled
ready = snap_physical_params(mechanism_type, ready)
```

Snapping by family:

| Mechanism | Snapped parameters |
|---|---|
| `four_bar` | `ground_link`, `input_link`, `coupler_link`, `output_link`, `l1..l4`, `L1..L4` → nearest `{40,80,120,160}` mm. |
| `slider_crank` | `crank_length`, `rod_length` → nearest `{40,80,120,160}` mm. |
| `gear_train` | `gear1_teeth`, `gear2_teeth` → nearest `{8,24,40,56}`; radii aliases filled. |
| `gear_linkage` | gear train as above; drive/output endpoint gears must have attachment holes; `linkage_pin_radius` → shared fabricated attachment radius on both endpoint gears; `linkage_arm_length` → paired linkage length. |
| `planetary_gear` | forced to `sun=g8/8T`, `planet=g24/24T`, `ring=ring-g8-g24`; `planet_count` fixed at `1` until the multi-planet carrier recipe exists; carrier length snapped; ring/sun/planet gear teeth stay coplanar. |
| `cam_follower` | keep the 15×15 pegboard as the only base; snap the axis, guide cartridge, and follower module to board holes; only the swappable cam disk/profile changes. |

### Foundry ↔ Design parametric editing contract

Mechanism Foundry and Mechanism Design edit the same `MechanismConfig` fields. A control may be visual, draggable, or a compact selector, but it must write the canonical field and then run the same fabrication snap used by previews, blueprints, and assembly.

| Mechanism | Editable in Foundry and Design | Snap / derived fields |
|---|---|---|
| `4bar` | input link, coupler link, output link, ground angle/position | link lengths snap to L2/L4/L6/L8; ground remains a board reference between A and D. |
| `gear` | drive gear size, output gear size, zero or more idler gear sizes, ground angle/position | every gear snaps to G1/G3/G5/G7 (`8/24/40/56` teeth); centre distances, gear ratio, and speed ratio derive from the ordered gear list. |
| `gear_linkage` | drive/output/idler gear sizes, paired linkage size, crank-pin radius, ground angle/position | drive and output gears must be G3/G5/G7 because G1 has no attachment holes; both crank pins snap to a shared real endpoint-gear attachment radius; paired linkages snap to L2/L4/L6/L8. |
| `cam` | swappable cam profile samples, phase | visible cam edits update `camProfileSamples`; fabrication keeps the axle module, U-channel guide cartridge, and preassembled gravity follower module fixed while swapping only the cam disk. |
| `planetary_gear` | phase and driver grouping only until alternate ring/carrier recipes exist | physical recipe remains fixed to R56 + G1 + G3 + L2 so the assembly stack stays buildable. |

Parametric edits are portable only if the changed parts compile through `compileMechanismGraphFabrication`, `compileMechanismRenderPlan`, Blueprint, and Assembly. Do not add a UI-only field that bypasses the graph compiler.

## 3.2 Four-bar linkage — `four_bar`

### Identity

| Field | Value |
|---|---|
| Canonical key | `four_bar` |
| Aliases | `fourbar`, `four_bar_linkage`, `4_bar_linkage` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `four-bar-basic` |
| Guide SVG | `fabrication/assembly/03-four-bar-basic.svg` |

### Symbols

```text
A = fixed input ground pivot  = I5
B = floating input/coupler joint = G6
C = floating coupler/output joint = G10
D = fixed output ground pivot = I9
L_g = ground link length AD
L_i = input crank length AB
L_c = coupler length BC
L_o = output rocker length CD
θ = input angle of AB
φ = output angle of CD
```

### Current default Foundry parameters

| Param | Label | Default at p=20mm | Physical snap |
|---|---|---:|---|
| `ground_link` | Ground Link | `80 mm` | nearest L2/L4/L6/L8 length |
| `input_link` | Input Link | `40 mm` | nearest L2/L4/L6/L8 length |
| `coupler_link` | Coupler Link | `80 mm` | nearest L2/L4/L6/L8 length |
| `output_link` | Output Link | `40 mm` | nearest L2/L4/L6/L8 length |
| `input_angle` | Input Angle | `30°` | angle, not a fabricated part |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `linkages:linkage-2-cell` (`L2`) | 2 | input crank and output rocker |
| `linkages:linkage-4-cell` (`L4`) | 1 | coupler |
| `spacers:s10` | 8 | clearance stacks |
| paper fasteners | per joint | pivots/joints |

### Geometry and topology

The current physical recipe is a crank-rocker-like four-bar with an implicit ground link:

```text
A(I5) -- L2/input -- B(G6) -- L4/coupler -- C(G10) -- L2/output -- D(I9)
D(I9) -- board/ground -- A(I5)
```

Board coordinate interpretation:

| Point | Coord | Role | Board-pinned? | Stack start |
|---|---|---|---:|---|
| `A` | `I5` | `board` | yes | `B@I5` |
| `B` | `G6` | `link_joint_reference` / `link_end_reference` | no | `J_link@G6` |
| `C` | `G10` | `link_joint_reference` / `link_end_reference` | no | `J_link@G10` |
| `D` | `I9` | `board` | yes | `B@I9` |

### Exact assembly steps and stacks

| Step | Action | Coords / roles | Stack |
|---:|---|---|---|
| 1 | Set ground pivots | `I5(board)`, `I9(board)` | `B@I5 > F > tabs-behind-board`, repeated at `I9` |
| 2 | Add input link | `I5(board)`, `G6(link_end_reference)` | `B@I5 > S10 > L2_input > fastener-head` |
| 3 | Add coupler | `G6(link_joint_reference)`, `G10(link_end_reference)` | `J_link@G6 > F > S10 > L4_coupler > S10 > tabs-loose` |
| 4 | Close output link | `G10(link_joint_reference)`, `I9(board)` | `B@I9 > S10 > L2_output > fastener-head` |
| 5 | Join output to coupler | `G10(link_joint_reference)` | `J_link@G10 > F > S10 > L4_coupler > S10 > tabs-loose` |

### Four-bar rules to preserve in another app

1. `G6` and `G10` are moving joint references; never draw/emit them as board pins.
2. Board only supplies the ground link `A-D` and the two fixed pivots `A`, `D`.
3. `S10` separates moving layers. Board-fixed single-link pivots `A` and `D` render as `fastener-end > S10 board-side spacer > linkage > fastener-head`; do not add a second outboard/top spacer there. Floating shared joints `B` and `C` keep the spacer between the two moving link layers.
4. The displayed valid input-angle range may be less than 360°. If the loop solver has no valid closure for an input angle, do not fake a complete revolution; display only the valid angle interval(s).
5. If a future editor lets users drag joints, the on-screen joint point and the stored parameter must update together: `|AB|`, `|BC|`, `|CD|`, `|AD|` must snap to the same physical length set when physical mode is enabled.
6. Do not require Grashof full rotation for a physical four-bar. Grashof decides full rotation, not whether the linkage can exist. Non-Grashof four-bars should still be allowed if they have a valid partial motion range.

## 3.3 Gear train — `gear_train`

### Identity

| Field | Value |
|---|---|
| Canonical key | `gear_train` |
| Aliases | `gear` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `gear-train-basic` |
| Guide SVG | `fabrication/assembly/01-gear-train-basic.svg` |

### Symbols

```text
G_a = drive gear
G_b = driven gear
T_a,T_b = tooth counts
r_a,r_b = pitch radii
ω_a,ω_b = angular velocities
τ_in = input torque display value
center_distance = r_a + r_b + g
gear_ratio = T_b / T_a
ω_b = -ω_a × T_a/T_b   # opposite direction for external gears
```

### Foundry defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `gear1_teeth` / drive size | `24` | one of `{8,24,40,56}` teeth |
| `gear2_teeth` / output size | `24` | one of `{8,24,40,56}` teeth |
| `idler_teeth[]` | `[]` | each idler one of `{8,24,40,56}` teeth; may be inserted between drive and output |
| `input_torque` | `200 Nm` | display/simulation only |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `gears:g24` (`G3`) | 2 | drive and driven gears |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `H6(board)` | `B@H6 > F > tabs-behind-board` |
| 2 | `H6(board)` | `B@H6 > S10 > G3_drive > fastener-head` |
| 3 | `H12(board)` | `B@H12 > S10 > G3_driven > fastener-head` |
| 4 | `H6(board)`, `H12(board)` | endpoint span check; add idlers before mesh-coupled motion |

Compatibility record:

```text
H6 ↔ H12 = 6 board cells = 120.0 mm
G3 + optional G3 idler + G3 pitch chain = 30.0 + 60.0 + 30.0 = 120.0 mm
error = 0.0 mm when the idler is inserted
tolerance = 3.6 mm for each adjacent meshing pair
```

Rules:

1. Endpoint gear centres are fixed board axles. With only drive/output gears, A and B are intentionally separated placeholders; an inserted idler chain fills the span and creates the meshing contacts.
2. Drive, idler, and driven gears in an external gear train are coplanar on fixed board axles when the pitch chain is complete. Lower z is the board side: each gear axle renders `board > S10 board-side spacer > gear > fastener-head`. `S10` spacers are local washers on each axle; they must not push meshing gear plates onto different z planes.
3. Each visible axle/fastener stack must pass through the gear centre and the adjacent board-side `S10` spacer; no gear may float beside or away from its centre shaft.
4. Adjacent gears in an inserted chain should touch lightly; physical tolerance is loose educational tolerance, not precision gearbox backlash.
5. If an app chooses other gear pairs or idlers, verify each adjacent board distance equals `r_i+r_{i+1}+g` within tolerance.
6. If using a handle, attach to a real gear attachment hole; `G1` has no attachment holes.

## 3.4 Gear linkage crank — `gear_linkage`

### Identity

| Field | Value |
|---|---|
| Canonical key | `gear_linkage` |
| Aliases | `gear+linkage`, `gear_linkage_train` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `gear-linkage-crank` |
| Guide SVG | `fabrication/assembly/04-gear-linkage-crank.svg` |

### Symbols

```text
A = drive gear fixed board axle = I6
D = output gear fixed board axle = I12
B = off-centre crank pin on drive gear G_a
C = off-centre crank pin on output gear G_b
R = shared moving linkage/output connector reference
ρ = linkage_pin_radius = |A-B| = |D-C|
L = linkage_arm_length = |B-R| = |C-R|
θ = input gear angle
```

### Defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `gear1_teeth` / drive size | `24` | one of `{24,40,56}` teeth; `G1` rejected at endpoints because it has no attachment holes |
| `gear2_teeth` / output size | `24` | one of `{24,40,56}` teeth; same endpoint attachment rule |
| `idler_teeth[]` | `[]` | each idler one of `{8,24,40,56}` teeth; idlers change centre spacing and output parity but do not carry crank pins |
| `linkage_pin_radius` | `20 mm` | nearest shared fabricated attachment radius on both endpoint gears |
| `linkage_arm_length` | `80 mm` | nearest linkage length; instantiated twice |
| `gear_linkage_enabled` | `1.0` | flag |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `gears:g24` (`G3`) | 2 | drive and output endpoint gears |
| `linkages:linkage-4-cell` (`L4`) | 2 | paired crank linkage arms `B-R` and `C-R` |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `I6(board)` | `B@I6 > F > tabs-behind-board` |
| 2 | `I6(board)` | `B@I6 > S10 > G3_drive > fastener-head` |
| 3 | `I12(board)` | `B@I12 > S10 > G3_output > fastener-head` |
| 4 | `I6(gear_handle_reference)`, `I9(link_end_reference)` | `H_gear@I6 > gear-hole > S10 > L4_drive > S10 > tabs-loose` |
| 5 | `I12(gear_handle_reference)`, `I9(link_end_reference)` | `H_gear@I12 > gear-hole > S10 > S10 > L4_output > S10 > tabs-loose` |
| 6 | `I9(link_end_reference)` | `E_link@I9 > L4_drive > S10 > L4_output > F > tabs-loose` |

Compatibility:

```text
I6 ↔ I12 = 6 board cells = 120.0 mm
G3 + optional G3 idler + G3 pitch chain = 120.0 mm
B-R = C-R = selected fabricated linkage length
```

Rules:

1. B and C attach to off-centre gear handle holes, not to board axles.
2. Gear A and gear D are separated endpoint board axles; inserted idlers fill the pitch-chain distance and do not carry crank links.
3. The drive/output/idler gears remain coplanar on their fixed board axles; each centre stack is `board > S10 > gear > fastener-head`.
4. The B crank stack passes through the real drive gear plate hole, then `S10`, then the lower drive linkage plane.
5. The C crank stack passes through the real output gear plate hole, then two `S10` spacers, then the upper output linkage plane.
6. R is the only moving output connector; it stacks the two linkage ends with one S10 clearance spacer and a shared fastener, and it is not pinned to the board.
7. `linkage_pin_radius` must be a radius available on both selected endpoint gears.
8. The paired link arms should be real linkage bar lengths, usually `L4` in the default recipe.
9. Simulation succeeds only when R is the circle intersection of the two equal linkage lengths around B and C.

## 3.5 Cam follower — `cam_follower`

### Identity

| Field | Value |
|---|---|
| Canonical key | `cam_follower` |
| Aliases | `cam`, `cam_profile` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `pegboard-gravity-cam-follower` |
| Guide SVG | `fabrication/assembly/02-cam-follower-basic.svg` |
| Final structure name | Pegboard-mounted gravity cam follower module |

### Module contract

15×15 pegboard remains the only standardized base and coordinate system. Do not generate a separate backplate for the cam. The cam recipe is a set of pegboard-mounted plug-in modules:

```text
15x15 pegboard
+ cam axle module
+ swappable cam disk
+ U-channel guide cartridge
+ preassembled gravity follower module
+ paper/wood washer and spacer modules
```

Fixed modules:

- 15×15 pegboard base: already present, not exported as a new part.
- Cam axle module: `axle peg + crank handle + paper washer + cam spacer + cam lock disk`.
- U-channel guide cartridge: one cartridge that integrates guide side rails, front cover, top stop, bottom stop, and peg connector tabs.
- Preassembled gravity follower module: square vertical rod, rounded follower head, weight block, and output tab.

Swappable module:

- Cam disk only. Initial classroom kit supports eccentric circle and oval; pear and custom drawn cams are valid follow-up disk profiles if the edge has no sharp drop.

Forbidden for this recipe:

- No rubber bands, springs, metal bearings, plastic spacers, or free-floating loose rail assembly.
- No new backplate.
- No old `S10`/round-follower/bracket stack for the default cam recipe.

### Symbols

```text
C = cam centre / axle peg at J7
G = vertical guide cartridge mounted above the cam
F = gravity follower module constrained to vertical translation
r(θ) = sampled cam disk radius at input angle θ
h(θ) = follower lift from cam contact
```

Simulator mapping:

```text
cam = rotating rigid body
follower = vertical prismatic body
guide = x-position and theta constraint
contact = cam boundary vs rounded/capsule follower head
gravity = downward preload
```

### Defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `cam_radius` | `15 mm` nominal profile radius | nearest swappable cam disk profile family |
| `camProfileSamples` | smooth one-lobe lift profile | sampled disk outline; no sharp drop |
| `follower_length` | module travel range, not a loose link | fixed by guide cartridge and preassembled follower module |
| `input_angle` | `30°` | angle only |
| board location | cam axle near `J7`, guide near `J11/J9` | 15×15 pegboard holes |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `cam_modules:axle-peg` | 1 | rotating axle through the pegboard |
| `cam_modules:crank-handle` | 1 | hand crank behind the board |
| `cam_modules:cam-lock-disk` | 1 | friction-fit disk that keeps the cam on the axle |
| `cam_modules:paper-washer` | 3 | low-friction washer at crank/board, board/cam, and cam/lock faces |
| `cam_modules:cam-spacer` | 1 | spacing tube/ring that keeps the cam disk off the pegboard |
| `cam_modules:swappable-cam-disk` | 1 | replaceable cam profile disk |
| `cam_modules:u-channel-guide-cartridge` | 1 | integrated guide side rails, cover, stops, and peg tabs |
| `cam_modules:gravity-follower-module-v2` | 1 | preassembled weighted vertical follower with rounded head and three named output holes |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `J7(board)` | `pegboard@J7 > crank handle behind board > axle peg > paper washer` |
| 2 | `J7(board)` | `paper washer > cam spacer > swappable cam disk > paper washer > cam lock disk` |
| 3 | `J11(board)`, `J9(board)` | `U-channel guide cartridge plugged into pegboard` |
| 4 | `J9(guide_reference)`, `J7(board)` | `preassembled gravity follower module v2 inside guide; rounded head rests on cam disk` |
| 5 | `J7(board)`, `J9(guide_reference)` | `turn crank; cam edge lifts follower; follower returns by gravity` |

Rules:

1. The 15×15 pegboard is the coordinate frame and structural base; do not fabricate another backplate.
2. The axle peg must fit the board hole: loose enough to rotate, tight enough to avoid wobble.
3. The crank handle lives behind the board; the cam disk and follower contact live in front of the board.
4. Paper washers and the cam spacer prevent rubbing. They are local cam-module parts, not the generic S10 moving-stack contract.
5. The guide cartridge is one student-facing module. Its guide side rails, front cover, stops, and peg tabs are not separate loose classroom parts.
6. The follower is preassembled as a weighted gravity follower module. Students do not build the rod, head, weight block, and output tab separately.
7. The follower rod is modeled as square/anti-rotation in fabrication; the simulator may render its contact as a capsule follower head.
8. Only the cam disk is intended to be swapped often. Cam shape is the learning variable.
9. Cam profiles must be smooth enough that the follower stays in contact; no sharp edges or sudden vertical drops.
10. If the follower binds, the recovery path is cartridge alignment, washer/spacer clearance, or a smoother/smaller cam disk profile.

## 3.6 Planetary gear — `planetary_gear`

### Identity

| Field | Value |
|---|---|
| Canonical key | `planetary_gear` |
| Aliases | `planetary`, `planetary gear` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `planetary-gear-basic` |
| Guide SVG | `fabrication/assembly/05-planetary-gear-basic.svg` |

### Symbols

```text
S = sun gear = G1 / g8 / 8 teeth
P = planet gear = G3 / g24 / 24 teeth
R = fixed ring gear = R56 / ring-g8-g24
C = carrier link = L4
O = sun/ring centre = H8
P_c = planet axle on carrier near H10
r_s = 10 mm
r_p = 30 mm
r_ring_pitch = r_s + 2r_p = 70 mm
```

### Defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `sun_teeth` | `8` | forced to first gear preset `g8` |
| `planet_teeth` | `24` | forced to second gear preset `g24` |
| `planet_count` | `1` | fixed single-planet authoring recipe until multi-planet carrier fabrication is implemented |
| `carrier_arm_length` | `80 mm` | nearest linkage length, default `L4` |
| `physical_ring_gear` | `ring-g8-g24` | forced |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `ring_gears:ring-g8-g24` (`R56`) | 1 | fixed internal ring |
| `gears:g8` (`G1`) | 1 | rotating sun gear |
| `gears:g24` (`G3`) | 1 | moving planet gear |
| `linkages:linkage-4-cell` (`L4`) | 1 | carrier arm |

### Planetary render / spacer plane contract

The default authoring type is the common sun–ring–planet gearset: fixed ring, sun input, carrier output. The [Benchtop Hybrid planetary gearset reference](http://www.benchtophybrid.com/PG_Types.html) shows the same basic family and notes that one displayed planet is enough for clarity while extra planets are optional for balance/torque. MotionSmith therefore keeps the current single-planet fabrication recipe until a multi-planet carrier part exists.

For every assembled preview and simulation:

- `R56`, `G1`, and `G3` render on one shared gear mesh plane so the internal ring, sun, and planet teeth can mesh physically.
- `L4 carrier linkage` renders on the next spacer plane and connects the sun center to the moving planet axle.
- The center pin stack is `G1 sun gear → S10 → L4 carrier linkage`; the planet pin stack is `L4 carrier linkage → S10 → G3 planet gear`.
- The ring mount holes are fixed board fasteners. They are not carrier pins and must not be counted as the moving sun/planet axle stack.
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `H8(board)` | `B@H8 > F > tabs-behind-board` |
| 2 | `D8(board)`, `H4(board)`, `H12(board)`, `L8(board)` | `B@D8 > F > S10 > R56_fixed > tabs-behind-board`, repeated |
| 3 | `H8(board)` | `B@H8 > F > S10 > G1_sun > S10 > tabs-loose` |
| 4 | `H8(board)`, `H10(carrier_reference)` | `B@H8 > F > S10 > L4_carrier > S10 > tabs-loose` |
| 5 | `H10(carrier_reference)` | `H_carrier@H10 > F > S10 > G3_planet > S10 > tabs-loose` |
| 6 | `H8(board)`, `H10(carrier_reference)` | planet carrier stack for motion check |

Compatibility:

```text
H8 ↔ H10 = 2 board cells = 40.0 mm
G1 + G3 required external centre distance = 10 + 30 = 40.0 mm
ring internal pitch radius = 10 + 2 × 30 = 70.0 mm
```

Rules:

1. Ring is fixed to board at four mount holes.
2. Sun axle is board-fixed; sun gear rotates freely.
3. Carrier rotates around sun axle.
4. Planet axle is on the carrier, not the board. `H10` is a moving reference.
5. Planet gear must mesh with both sun and internal ring. Do not use arbitrary gear sizes unless a matching ring gear exists.
6. Current physical package includes only `ring-g8-g24`.

## 3.7 Slider crank — `slider_crank`

### Identity

| Field | Value |
|---|---|
| Canonical key | `slider_crank` |
| Aliases | `slider-crank`, `slidercrank` |
| Foundry-visible | no |
| Transfer/export | yes |
| Fabrication recipe | `slider-crank-basic` |
| Guide SVG | `fabrication/assembly/06-slider-crank-basic.svg` |

### Symbols

```text
A = fixed crank axle = I5
B = crank/rod moving joint = G6
C = slider block / rod end = G12
L_c = crank length = |AB|
L_r = rod length = |BC|
x = slider displacement along guide
θ = crank angle
```

### Defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `crank_length` | `40 mm` | nearest linkage length |
| `rod_length` | `120 mm` | nearest linkage length |
| `gas_pressure` | `500 kPa` | simulation/display only |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `linkages:linkage-2-cell` (`L2`) | 1 | crank |
| `linkages:linkage-6-cell` (`L6`) | 1 | connecting rod |
| `brackets:3-hole-straight` | 1 | fixed straight guide |
| `brackets:2-hole-straight` | 1 | moving slider block |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `I5(board)` | `B@I5 > F > tabs-behind-board` |
| 2 | `I5(board)`, `G6(link_end_reference)` | `B@I5 > S10 > L2_crank > fastener-head` |
| 3 | `G6(link_joint_reference)`, `G12(slider_reference)` | `J_link@G6 > F > S10 > L6_rod > S10 > tabs-loose` |
| 4 | `G11(board)`, `G12(board)`, `G13(board)` | `B@G11 > F > S10 > bracket3_fixed_guide > tabs-behind-board`, repeated |
| 5 | `G12(slider_reference)` | `E_link@G12 > F > S10 > bracket2_slider > S10 > tabs-loose` |
| 6 | `I5(board)`, `G12(slider_reference)` | slider stack for motion check |

Rules:

1. `G6` is a moving crank/rod joint, not board-pinned.
2. `G12` is the slider block reference when used as `slider_reference`, not a board pin.
3. The guide bracket at `G11/G12/G13` is fixed; the slider block is moving.
4. Rod length should exceed crank length enough to avoid singular/over-centre binding in the intended range.

## 3.8 Computational/content-only linkages

The codebase has domain/content references for linkage families beyond the current physical recipe set.

### Three-bar / crank-rocker reference

| Field | Value |
|---|---|
| Content file | `source/mechanism-content/linkage_three_bar.json` |
| Physical recipe | none |
| Export contract | not in Foundry supported export set |
| Rule | Treat as educational/content unless a future recipe is defined. |

### Five-bar linkage

| Field | Value |
|---|---|
| Content file | `source/mechanism-content/linkage_five_bar.json` |
| Domain type | `LinkageType.FIVE_BAR` |
| Physical recipe | none |
| Export contract | not in Foundry supported export set |
| Key caution | Requires synchronized dual inputs; can enter singular positions quickly. |

Portable note: A five-bar physical implementation cannot be inferred by simply adding one more linkage to the four-bar recipe. It needs explicit dual-driver phase rules, stack rules, collision/singularity handling, and likely two fixed input pivots.

### Six-bar linkage

| Field | Value |
|---|---|
| Catalog key | `six_bar` in `source/mechanism-catalog.snapshot.json` |
| Content file | `source/mechanism-content/linkage_six_bar.json` |
| Domain type | `LinkageType.SIX_BAR` |
| Physical recipe | none |
| Export contract | not in Foundry supported export set |
| Key caution | Stephenson-style six-bar combines two four-bar loops; tolerance-sensitive. |

Current catalog parameters:

| Param | Default | Range |
|---|---:|---|
| `link1_length` | `40 mm` | `20..80 mm` |
| `link2_length` | `90 mm` | `40..140 mm` |
| `link3_length` | `70 mm` | `30..110 mm` |
| `speed` | `0.8x` | `0.1..3.0x` |

Portable note: Do not show six-bar as fabrication-ready until a stack/part/board recipe equivalent to the recipes above exists.

## 3.9 Catalog-only Geneva drive

| Field | Value |
|---|---|
| Catalog key | `geneva_drive` |
| Foundry-visible | no |
| Physical recipe | none |
| Export contract | no |
| Parameters | `num_slots`, `drive_radius`, `geneva_radius`, `speed` |

Treat Geneva drive as a non-portable legacy catalog idea unless the target app implements a new generator and physical recipe.

## 3.10 “All mechanisms” implementation priority

For another app that wants parity with the current production product, implement in this order:

1. `four_bar`
2. `gear_train`
3. `gear_linkage`
4. `cam_follower`
5. `planetary_gear`
6. `slider_crank`

Then optionally add:

7. `three_bar`, `five_bar`, `six_bar` through the graph compiler when fabrication recipes and safe-edit contracts are present; keep them out of novice galleries until classroom QA is complete.
8. `geneva_drive` only after adding real implementation and fabrication data.

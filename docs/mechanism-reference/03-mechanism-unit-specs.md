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
| `planetary_gear` | forced to `sun=g8/8T`, `planet=g24/24T`, `ring=ring-g8-g24`; `planet_count` fixed at `1` until the multi-planet carrier recipe exists; carrier length snapped. |
| `cam_follower` | snap to nearest physical cam preset; fill `base_radius`, `eccentricity`, `cam_lobes`, `profile_harmonic`, `rise_deg`, `high_dwell_deg`, `return_deg`, `physical_cam_preset`. |

### Foundry ↔ Design parametric editing contract

Mechanism Foundry and Mechanism Design edit the same `MechanismConfig` fields. A control may be visual, draggable, or a compact selector, but it must write the canonical field and then run the same fabrication snap used by previews, blueprints, and assembly.

| Mechanism | Editable in Foundry and Design | Snap / derived fields |
|---|---|---|
| `4bar` | input link, coupler link, output link, ground angle/position | link lengths snap to L2/L4/L6/L8; ground remains a board reference between A and D. |
| `gear` | drive gear size, output gear size, zero or more idler gear sizes, ground angle/position | every gear snaps to G1/G3/G5/G7 (`8/24/40/56` teeth); centre distances, gear ratio, and speed ratio derive from the ordered gear list. |
| `gear_linkage` | drive/output/idler gear sizes, paired linkage size, crank-pin radius, ground angle/position | drive and output gears must be G3/G5/G7 because G1 has no attachment holes; both crank pins snap to a shared real endpoint-gear attachment radius; paired linkages snap to L2/L4/L6/L8. |
| `cam` | cam profile samples, follower travel/radius, phase | visible cam profile edits update `camProfileSamples`; sampled profile drives follower contact and physics overlays. |
| `planetary_gear` | phase and driver grouping only until alternate ring/carrier recipes exist | physical recipe remains fixed to R56 + G1 + G3 + L2 so the assembly stack stays buildable. |

Parametric edits are portable only if the changed parts still appear in `referenceRequiredPartsForMechanism`, `fabricationStackForMechanism`, the 3D render plan, Blueprint, and Assembly. Do not add a UI-only field that bypasses those helpers.

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
| 3 | `H9(board)` | `B@H9 > S10 > G3_driven > fastener-head` |
| 4 | `H6(board)`, `H9(board)` | same moving gear stack for motion check |

Compatibility record:

```text
H6 ↔ H9 = 3 board cells = 60.0 mm
G3 + G3 required centre distance = 30.0 + 30.0 = 60.0 mm
error = 0.0 mm
tolerance = 3.6 mm
```

Rules:

1. Meshing gear centres are fixed board axles in this recipe.
2. Drive, idler, and driven gears in an external gear train are coplanar on fixed board axles. Lower z is the board side: each gear axle renders `board > S10 board-side spacer > gear > fastener-head`. `S10` spacers are local washers on each axle; they must not push meshing gear plates onto different z planes.
3. Each visible axle/fastener stack must pass through the gear centre and the adjacent board-side `S10` spacer; no gear may float beside or away from its centre shaft.
4. Gears should touch lightly; physical tolerance is loose educational tolerance, not precision gearbox backlash.
5. If an app chooses other gear pairs, verify board distance equals `r_a+r_b+g` within tolerance.
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
D = output gear fixed board axle = I9
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
| `brackets:2-hole-straight` | 1 | moving output connector at `R` |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `I6(board)` | `B@I6 > F > tabs-behind-board` |
| 2 | `I6(board)` | `B@I6 > S10 > G3_drive > fastener-head` |
| 3 | `I9(board)` | `B@I9 > S10 > G3_output > fastener-head` |
| 4 | `I6(gear_handle_reference)`, `I12(link_end_reference)` | `H_gear@I6 > F > S10 > L4_drive > S10 > tabs-loose` |
| 5 | `I9(gear_handle_reference)`, `I12(link_end_reference)` | `H_gear@I9 > F > S10 > L4_output > S10 > tabs-loose` |
| 6 | `I12(link_end_reference)` | `E_link@I12 > F > S10 > bracket2 > S10 > tabs-loose` |

Compatibility:

```text
I6 ↔ I9 = 3 board cells = 60.0 mm
G3 + G3 required centre distance = 60.0 mm
B-R = C-R = selected fabricated linkage length
```

Rules:

1. B and C attach to off-centre gear handle holes, not to board axles.
2. R is the only moving output connector; do not pin it to the board.
3. The drive/output gears remain coplanar on their fixed board axles; linkages live on spacer-separated moving stacks.
4. `linkage_pin_radius` must be a radius available on both selected endpoint gears.
5. The paired link arms should be real linkage bar lengths, usually `L4` in the default recipe.
6. Simulation succeeds only when R is the circle intersection of the two equal linkage lengths around B and C.

## 3.5 Cam follower — `cam_follower`

### Identity

| Field | Value |
|---|---|
| Canonical key | `cam_follower` |
| Aliases | `cam`, `cam_profile` |
| Foundry-visible | yes |
| Transfer/export | yes |
| Fabrication recipe | `cam-follower-basic` |
| Guide SVG | `fabrication/assembly/02-cam-follower-basic.svg` |

### Symbols

```text
C = cam centre / axle
F_y = follower vertical position
r(θ) = cam profile radius at input angle θ
R_b = base radius
ε = eccentricity / cam offset
n_l = lobe count
H = profile_harmonic
```

### Defaults and snapping

| Param | Default | Snap |
|---|---:|---|
| `cam_radius` | `15 mm` for default eccentric preset | nearest physical cam base radius `{15,16,18}` |
| `cam_offset` | `5 mm` for eccentric | nearest physical cam eccentricity `{0,5,6,9}` |
| `follower_length` | `160 mm` | linkage-length family for UI range; physical follower preset is separate |
| `cam_lobes` | `1` | nearest preset lobe count |
| `profile_harmonic` | `0.0` for eccentric | nearest preset harmonic |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `cams:eccentric` | 1 | rotating cam |
| `followers:f3-round` | 1 | sliding follower |
| `brackets:2-hole-straight` | 1 | available/output bracket in part list |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `J7(board)` | `B@J7 > F > tabs-behind-board` |
| 2 | `J7(board)` | `B@J7 > F > S10 > cam:eccentric > S10 > tabs-loose` |
| 3 | `G7(board)` | `B@G7 > F > S10 > follower:f3-round > S10 > tabs-loose` |
| 4 | `J7(board)`, `G7(board)` | follower moving stack for motion check |

Rules:

1. Cam axle is board-fixed; cam body rotates freely on `S10` spacers.
2. The follower is guided loosely; it must slide, not bind.
3. Physical cam profiles are presets. Free-form profile editing should snap to the nearest preset when fabricating.
4. Attachment holes in cams may accept handles/linkages/brackets, but the default cam-follower recipe does not use them as the main follower contact.

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
C = carrier link = L2
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
| `carrier_arm_length` | `40 mm` | nearest linkage length, default `L2` |
| `physical_ring_gear` | `ring-g8-g24` | forced |
| `input_angle` | `30°` | angle only |

### Physical recipe parts

| Part | Count | Role |
|---|---:|---|
| `ring_gears:ring-g8-g24` (`R56`) | 1 | fixed internal ring |
| `gears:g8` (`G1`) | 1 | rotating sun gear |
| `gears:g24` (`G3`) | 1 | moving planet gear |
| `linkages:linkage-2-cell` (`L2`) | 1 | carrier arm |
| `spacers:s10` | 8 | clearance stacks |

### Exact recipe

| Step | Coords / roles | Stack |
|---:|---|---|
| 1 | `H8(board)` | `B@H8 > F > tabs-behind-board` |
| 2 | `D8(board)`, `H4(board)`, `H12(board)`, `L8(board)` | `B@D8 > F > S10 > R56_fixed > tabs-behind-board`, repeated |
| 3 | `H8(board)` | `B@H8 > F > S10 > G1_sun > S10 > tabs-loose` |
| 4 | `H8(board)`, `H10(carrier_reference)` | `B@H8 > F > S10 > L2_carrier > S10 > tabs-loose` |
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

7. `three_bar`, `five_bar`, `six_bar` as simulation-only linkages, clearly labelled non-fabrication-ready.
8. `geneva_drive` only after adding real implementation and fabrication data.

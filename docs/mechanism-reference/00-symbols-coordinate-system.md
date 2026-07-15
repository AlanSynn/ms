# 00 — Symbols and Coordinate Contract

## 0.1 Canonical symbols

| Symbol | Meaning | Default value / domain |
|---|---|---:|
| `p` | board pitch; distance between adjacent board holes | `20.0 mm` |
| `c` | board pitch in centimetres | `2.0 cm` |
| `h` | hole diameter | `4.0 mm` |
| `r_h` | hole radius | `2.0 mm` |
| `B` | pegboard | 15 rows × 15 columns |
| `R` | board row label | `A..O` |
| `C` | board column label | `1..15` |
| `O_B` | board origin in app-centred coordinates | `H8` |
| `S10` | canonical spacer | `spacers:s10`, OD `10.0 mm`, ID `4.0 mm` |
| `F` | paper fastener | `paper-fastener`, max length label `2in` |
| `L_n` | linkage bar with `n` board-cell span | `n ∈ {2,4,6,8}` |
| `G_d` | gear whose pitch diameter spans `d` board spaces | `G1`, `G3`, `G5`, `G7` |
| `T` | gear tooth count | `{8,24,40,56}` |
| `r_p` | gear pitch radius | `T × 1.25 mm` |
| `g` | gear mesh clearance | `0.0 mm` default |
| `θ` | input angle | degrees in UI, radians only inside math code if needed |
| `φ` | output angle | degrees in UI |
| `q_i` | i-th joint coordinate in a mechanism-local frame | `(x_mm, y_mm)` |
| `Z_i` | i-th physical stack layer order | integer from bottom to top |

All portable implementations should store canonical lengths in millimetres and only format inches/board-spaces for user display.

## 0.2 Physical profile

The default physical profile is:

```text
profile_key = motionsmith-ms4n
profile_label = MotionSmith 2cm pegboard kit (legacy MS4N pitch available)
p = 20.0 mm
h = 4.0 mm
board = 15 × 15 holes
linkage lengths = {2p, 4p, 6p, 8p} = {40, 80, 120, 160} mm
gear teeth = {8, 24, 40, 56}
gear radius rule = r_p = teeth × 1.25 mm
spacer = S10 only
```

Supported pitch choices from the current app are:

| Pitch key | Label | Pitch `p` | Use |
|---|---|---:|---|
| `2cm` | `2.0 cm board` | `20.0 mm` | Default fabrication package. |
| `ms4n` | `Legacy MS4N kit — 2.04 cm` | `20.4 mm` | Legacy board compatibility. |
| `2_5cm` | `2.5 cm board` | `25.0 mm` | Alternate profile; fabrication JSON currently generated at 20 mm. |

## 0.3 Board coordinate system

A board coordinate is the string:

```ebnf
BoardCoord ::= Row Column
Row        ::= "A" | "B" | ... | "O"
Column     ::= "1" | "2" | ... | "15"
```

Examples: `A1`, `H8`, `O15`.

### Top-left frame

The fabrication/manual frame uses top-left board coordinates:

```text
A1  = (0, 0) cells
O15 = (14, 14) cells
x_cell_top_left = C - 1
y_cell_top_left = index(R)    # A=0, B=1, ..., O=14
x_mm_top_left = x_cell_top_left × p
y_mm_top_left = y_cell_top_left × p
```

### App-centred frame

The app/scene frame should use `H8` as board centre:

```text
H8 = (0, 0) cells
x_cell_center = C - 8
y_cell_center = index(R) - 7
x_mm_center = x_cell_center × p
y_mm_center = y_cell_center × p
```

Examples with `p=20 mm`:

| Coord | Top-left cells | Centre cells | Centre mm |
|---|---:|---:|---:|
| `H8` | `(7, 7)` | `(0, 0)` | `(0, 0)` |
| `H6` | `(5, 7)` | `(-2, 0)` | `(-40, 0)` |
| `I5` | `(4, 8)` | `(-3, 1)` | `(-60, 20)` |
| `G10` | `(9, 6)` | `(2, -1)` | `(40, -20)` |
| `D8` | `(7, 3)` | `(0, -4)` | `(0, -80)` |

## 0.4 Part identifiers

Every physical part uses this id grammar:

```ebnf
PartId   ::= Category ":" Key
Category ::= "gears" | "ring_gears" | "linkages" | "cam_modules" | "cams" | "followers" | "brackets" | "spacers" | "handles"
Key      ::= non-empty lowercase/digit/hyphen token
```

Examples:

- `gears:g24`
- `ring_gears:ring-g8-g24`
- `linkages:linkage-4-cell`
- `cam_modules:swappable-cam-disk`
- `cam_modules:u-channel-guide-cartridge`
- `cam_modules:gravity-follower-module-v2`
- `brackets:2-hole-straight`
- `spacers:s10`
- `handles:folding-fork-tripod`

## 0.5 Mechanism identifiers and aliases

Use the canonical mechanism keys below for application data. Accept aliases at import boundaries only.

| Canonical key | Accepted aliases |
|---|---|
| `four_bar` | `fourbar`, `four_bar_linkage`, `4_bar_linkage` |
| `cam_follower` | `cam` |
| `gear_train` | `gear` |
| `gear_linkage` | `gear+linkage`, `gear_linkage_train` |
| `planetary_gear` | `planetary`, `planetary gear` |
| `slider_crank` | `slider-crank`, `slidercrank` |

Foundry currently exposes only:

```text
{four_bar, cam_follower, gear_train, gear_linkage, planetary_gear}
```

Transfer/export supports:

```text
{four_bar, cam_follower, gear_train, gear_linkage, planetary_gear, slider_crank}
```

The broader transfer spec also accepts legacy/internal compatibility values:

```text
{four_bar_linkage, 4_bar_linkage, linkages, unified_linkage, cam, gear, planetary_gear}
```

## 0.6 Joint role vocabulary

A coordinate role controls whether a coordinate is a fixed board pivot or just a visual/assembly reference.

| `coord_role` | Fixed to board? | Meaning |
|---|---:|---|
| `board` | yes | Actual board hole, paper fastener passes through board. |
| `board_axle` | yes | Board-fixed axle used in compatibility records. |
| `link_end_reference` | no | Approximate board location of a free end of a moving link. |
| `link_joint_reference` | no | Approximate board location of a moving linkage-to-linkage joint. |
| `gear_handle_reference` | no | Approximate board location of an off-centre gear attachment hole. |
| `carrier_reference` | no | Approximate board location of a planet axle riding on a carrier. |
| `slider_reference` | no | Approximate board location of a slider block/end joint. |

Portable rebuild warning: Never infer fixedness from a coordinate string alone. `G10` can be a floating four-bar joint in one step and a board reference in another context. The role decides.

## 0.7 Stack notation used in this reference

Stack notation lists bottom-to-top layers with `>`:

```text
B@I5 > F > S10 > L2 > S10 > tabs-loose
```

Meaning:

1. board hole `I5`,
2. paper fastener,
3. lower S10 spacer,
4. moving linkage L2,
5. upper S10 spacer,
6. fastener tabs opened loosely.

Common tokens:

| Token | Layer role |
|---|---|
| `B@coord` | `board` |
| `F` | `paper-fastener` |
| `S10` | `spacer` or `top-spacer`, depending on position |
| `tabs-loose` | `fastener-tabs`, open enough to rotate |
| `tabs-behind-board` | `fastener-tabs`, opened behind board for fixed mounting |
| `J_link@coord` | `link-joint-hole`, moving linkage-to-linkage joint near coord |
| `E_link@coord` | `link-end-hole`, moving link output/end hole near coord |
| `H_gear@coord` | `gear-handle-hole`, off-centre gear hole near coord |
| `H_carrier@coord` | `carrier-hole`, planet axle hole on carrier near coord |

# 01 — Physical Kit Parts

This file defines the fabricated part library. Use it as the canonical cross-platform inventory for any web, mobile, or other rewrite.

## 1.1 Board and hardware

| Item | Contract |
|---|---|
| Board size | `15 × 15` holes. Rows `A..O`, columns `1..15`. |
| Board centre | `H8`. |
| Board pitch | `p = 20.0 mm` by default. |
| Hole diameter | `h = 4.0 mm` (`5/32 in` display label). |
| Fastener | Paper fastener, id `paper-fastener`, max length label `2in`. |
| Spacer | Only `spacers:s10` is valid in current stacks. |
| Page target | Letter page size `215.9 × 279.4 mm` for printable fabrication sheets. |

## 1.2 Spacer

| PartId | Label | Outer diameter | Inner diameter | Hole count | Rule |
|---|---|---:|---:|---:|---|
| `spacers:s10` | S10 spacer | `10.0 mm` | `4.0 mm` | 1 | Required below moving parts and usually above moving parts. |

`S10` is a washer spacer, not an optional decoration. It creates clearance between board, links, gears, cams, followers, brackets, character pieces, and paper-fastener tabs.

Portable implementation rule:

```text
if stack layer role in {spacer, top-spacer}:
    part must be spacers:s10
else:
    reject or downgrade to warning only for non-physical preview mode
```

## 1.3 Linkage bars

Linkage bars are capsules with holes every board pitch. For `L_n`:

```text
n ∈ {2, 4, 6, 8}
center_to_center_length = n × p
hole_count = n + 1
hole_spacing = p
hole_diameter = h
bar_width = 14.0 mm
svg_width = n × p + 28.0 mm
svg_height = 34.0 mm
```

| Symbol | PartId | Label | Span cells | Length at 20 mm pitch | Hole count | Typical use |
|---|---|---|---:|---:|---:|---|
| `L2` | `linkages:linkage-2-cell` | 2-cell linkage | 2 | `40.0 mm` | 3 | crank/input, output rocker, planetary carrier, slider crank. |
| `L4` | `linkages:linkage-4-cell` | 4-cell linkage | 4 | `80.0 mm` | 5 | four-bar coupler, gear-linkage arm. |
| `L6` | `linkages:linkage-6-cell` | 6-cell linkage | 6 | `120.0 mm` | 7 | slider-crank connecting rod. |
| `L8` | `linkages:linkage-8-cell` | 8-cell linkage | 8 | `160.0 mm` | 9 | long rod / custom extension. |

Hole index contract for `L_n` in local part coordinates:

```text
hole_i = (i × p, 0), i = 0..n
```

The generated SVG uses margins, but portable logical geometry should use the hole-centre frame above.

## 1.4 Gears

Gear radius formula:

```text
pitch_radius r_p = teeth × 1.25 mm
pitch_diameter d_p = 2 × r_p
board_space_diameter = d_p / p
mesh_center_distance(a,b) = r_p(a) + r_p(b) + clearance
clearance default = 0.0 mm
```

| Symbol | PartId | Label | Teeth | Pitch radius | Board-space diameter | Attachment holes | Attachment offsets |
|---|---|---|---:|---:|---:|---:|---|
| `G1` | `gears:g8` | G1 / 1-space gear | 8 | `10.0 mm` | `1.0` | 0 | none; axle only. |
| `G3` | `gears:g24` | G3 / 3-space gear | 24 | `30.0 mm` | `3.0` | 4 | `(0,-20)`, `(-20,0)`, `(20,0)`, `(0,20)` mm. |
| `G5` | `gears:g40` | G5 / 5-space gear | 40 | `50.0 mm` | `5.0` | 12 | all board-grid offsets with radius `20`, `28.284`, or `40` mm inside root. |
| `G7` | `gears:g56` | G7 / 7-space gear | 56 | `70.0 mm` | `7.0` | 28 | board-grid offsets with radius `20`, `28.284`, `40`, `44.721`, `56.569`, `60` mm inside root. |

Additional current generated geometry:

| PartId | Root radius | Outer radius | Pattern |
|---|---:|---:|---|
| `gears:g8` | `10.0 mm` | `11.5 mm` | no attachment holes. |
| `gears:g24` | `28.438 mm` | `31.5 mm` | grid attachment holes. |
| `gears:g40` | `48.438 mm` | `51.5 mm` | grid attachment holes. |
| `gears:g56` | `68.438 mm` | `71.5 mm` | grid attachment holes. |

Gear attachment holes are for linkages, brackets, cranks, or handles. They are not board holes unless the stack says `board`.

## 1.5 Planetary ring gear

| PartId | Label | Internal teeth | Compatible sun | Compatible planet | Pitch radius | Outer radius | Mount holes |
|---|---|---:|---:|---:|---:|---:|---|
| `ring_gears:ring-g8-g24` | R56 internal ring gear | 56 | `G1` / 8T | `G3` / 24T | `70.0 mm` | `90.0 mm` | 4 |

Ring formula:

```text
ring_internal_teeth = sun_teeth + 2 × planet_teeth
R56 = 8 + 2 × 24
mount_radius = 4 × p = 80.0 mm
mount_offsets = (0,-80), (-80,0), (80,0), (0,80) mm
```

Mounted at centre `H8`, those offsets map to board coordinates:

| Offset | Board coord |
|---:|---|
| `(0,-80)` | `D8` |
| `(-80,0)` | `H4` |
| `(80,0)` | `H12` |
| `(0,80)` | `L8` |

Ring gear is fixed to the board; it is not a rotating gear in the current recipe.

## 1.6 Cam presets

All cams have:

- one centre axle hole of diameter `h`,
- four attachment holes for linkage/bracket/crank/handle connection,
- profile generated from `build_pear_cam_profile_from_params`, 144 samples.

| PartId | Label | Base radius | Eccentricity | Lobes | Harmonic | Rise | High dwell | Return | Attachment offsets |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `cams:circle` | Circle / steady | `15.0` | `0.0` | 1 | `0.0` | `45°` | `270°` | `45°` | `(12,0)`, `(0,12)`, `(-12,0)`, `(0,-12)` mm |
| `cams:eccentric` | Eccentric / bounce | `15.0` | `5.0` | 1 | `0.0` | `90°` | `60°` | `90°` | `(12,0)`, `(-11.087,-4.592)`, `(0,-12)`, `(8.485,-8.485)` mm |
| `cams:oval` | Oval / smooth rise | `16.0` | `6.0` | 2 | `0.2` | `120°` | `30°` | `120°` | `(6.582,15.891)`, `(-6.582,15.891)`, `(-6.582,-15.891)`, `(6.582,-15.891)` mm |
| `cams:pear` | Pear / slow-fast | `18.0` | `9.0` | 1 | `0.35` | `150°` | `45°` | `75°` | `(-14.782,-6.123)`, `(-6.123,-14.782)`, `(6.123,-14.782)`, `(14.782,-6.123)` mm |

Physical snap rule: free-form cam parameters should snap to one of these presets via nearest `(cam_radius, cam_offset, cam_lobes, profile_harmonic)`.

## 1.7 Follower presets

| PartId | Label | Body height | Body width | Contact | Guide slots | Guide travel | Output holes | Output hole centres | Roller axle |
|---|---|---:|---:|---|---:|---:|---:|---|---:|
| `followers:f3-round` | 3-cell round-nose follower | `60.0 mm` | `14.0 mm` | `round_nose` | 1 | `20.0 mm` | 1 | `(0,20)` | no |
| `followers:f4-roller` | 4-cell roller-pin follower | `80.0 mm` | `14.0 mm` | `roller_pin` | 1 | `20.0 mm` | 1 | `(0,20)` | yes |
| `followers:f5-flat` | 5-cell flat-shoe follower | `100.0 mm` | `14.0 mm` | `flat_shoe` | 1 | `25.0 mm` | 2 | `(0,20)`, `(0,40)` | no |
| `followers:f6-linkage-output` | 6-cell linkage-output follower | `120.0 mm` | `14.0 mm` | `linkage_output` | 1 | `30.0 mm` | 3 | `(0,20)`, `(0,40)`, `(0,60)` | no |

Default cam-follower recipe uses `followers:f3-round`.

## 1.8 Brackets

| PartId | Label | Hole centres in local part frame | Hole count | Use |
|---|---|---|---:|---|
| `brackets:2-hole-straight` | 2-hole straight bracket | `(10,10)`, `(30,10)` | 2 | moving output connector / slider block. |
| `brackets:3-hole-straight` | 3-hole straight bracket | `(10,10)`, `(30,10)`, `(50,10)` | 3 | fixed slider guide. |
| `brackets:l-3-hole` | L 3-hole bracket | `(10,10)`, `(30,10)`, `(10,30)` | 3 | general mounting/custom. |
| `brackets:triangle-3-hole` | Triangle 3-hole bracket | `(10,10)`, `(30,10)`, `(10,30)` | 3 | triangular mounting/custom. |

Brackets can be either fixed or moving. The stack role decides:

- `fixed-part` → fixed to board.
- `moving-part` → part of the mechanism motion.

## 1.9 Handle

| PartId | Label | Contract |
|---|---|---|
| `handles:folding-fork-tripod` | Triangular paper-tent glue handle | `attachment_style = paper_tent_simple_rectangle_slits_fold_to_fit_4mm_then_hot_glue`; no holes in manifest. |

Handle note: gear and cam attachment holes are explicitly tagged for handle use. If a new app lets users add a handle, attach it to an existing `handle-hole`/attachment hole, not to gear teeth or arbitrary outlines.

## 1.10 Fabrication sheet inventory

| Sheet key | Label | Path |
|---|---|---|
| `01-gear-set` | Gear set A | `fabrication/sheets/01-gear-set.svg` |
| `10-gear-set-large` | Gear set B | `fabrication/sheets/10-gear-set-large.svg` |
| `09-planetary-ring-set` | Planetary ring gear | `fabrication/sheets/09-planetary-ring-set.svg` |
| `02-linkage-set` | Linkage set | `fabrication/sheets/02-linkage-set.svg` |
| `03-cam-set` | Cam set | `fabrication/sheets/03-cam-set.svg` |
| `04-prototype-set-a` | Prototype set A | `fabrication/sheets/04-prototype-set-a.svg` |
| `05-prototype-set-b` | Prototype set B | `fabrication/sheets/05-prototype-set-b.svg` |
| `06-bracket-set` | Bracket set | `fabrication/sheets/06-bracket-set.svg` |
| `07-follower-set` | Follower set | `fabrication/sheets/07-follower-set.svg` |
| `08-spacer-set` | Spacer set | `fabrication/sheets/08-spacer-set.svg` |
| `11-handle-set` | Handle set | `fabrication/sheets/11-handle-set.svg` |

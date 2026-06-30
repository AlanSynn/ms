# 05 — Assembly Process Guides

This document describes the hands-on assembly process another application must reproduce: how to prepare parts, how to read step cards, how to place spacers, and how to verify each mechanism.

## 5.1 Two workflows

### Workflow A — Board assembly from an app export

Use when a user has a character/mechanism project and wants a printable package.

Expected export contents:

```text
current-design-cut-sheets.pdf
assembly/assembly-guide.pdf
assembly/kit-parts-to-cut.pdf
```

The export guide should be generated from the same recipe contracts as `source/assembly-recipes.snapshot.json`.

### Workflow B — Self-fabrication from template parts

Use when a user wants replacement/custom kit parts.

Source folders:

```text
fabrication/gears/
fabrication/ring_gears/
fabrication/linkages/
fabrication/cams/
fabrication/followers/
fabrication/brackets/
fabrication/spacers/
fabrication/handles/
fabrication/sheets/
fabrication/complete-kit-cut-sheet.svg
```

Red paths are cuts, blue circles are drill/cut holes, and grey lines are score/reference geometry.

## 5.2 Assembly guide UI contract

A ported application should show one step card at a time. Each card needs:

| Field | Required content |
|---|---|
| Step number | `n` from recipe. |
| Title | Short action label, e.g. `Add input link`. |
| Board callouts | Coordinates and role badges, e.g. `I5 · board`, `G6 · moving reference`. |
| Parts needed | Part ids, labels, counts, and thumbnails if available. |
| Stack order | Bottom-to-top `Stack` row; never hide spacer layers. |
| Check | A physical motion/fit test before next step. |
| Visual state | Active parts, ghost parts, highlighted coordinates. |
| Warning badge | Show when a coordinate is not board-pinned. |

Minimum visual layers for an assembly screen:

1. board grid/labels,
2. fixed board holes,
3. current-step highlighted holes,
4. ghost previous/target parts,
5. current active parts,
6. spacer/stack callouts,
7. motion arrows/check hints.

## 5.3 Preparation checklist

Before building any mechanism:

1. Print/cut the required parts at 1:1 scale.
2. Confirm board pitch is `20.0 mm` if using committed fabrication templates.
3. Confirm all holes accept a `4.0 mm` paper-fastener shaft.
4. Sort parts by category:
   - gears,
   - ring gears,
   - linkages,
   - cams,
   - followers,
   - brackets,
   - spacers,
   - handles.
5. Count at least 8 `S10` spacers for each recipe unless the exported package says otherwise.
6. Keep paper fasteners loose for moving joints.
7. Cut character body parts separately from the character blueprint/cut sheet.
8. Keep extra spacers available between moving character parts, linkage layers, and the board/brackets.

## 5.4 How to execute a step card

For every step:

```text
1. Read the coordinate(s) and role(s).
2. If role is board: insert the paper fastener through the board hole.
3. If role is not board: align the moving part hole near that coordinate; do not insert through the board.
4. Add stack layers from bottom to top exactly as shown.
5. Keep moving joints loose.
6. Run the step check.
7. Only then continue to the next card.
```

Critical interpretation:

```text
coord = physical location hint
coord_role = fixed-vs-moving truth
stack = exact layer order truth
```

## 5.5 Common stack assembly procedures

### Procedure A — Board axle for moving part

Used by gears, cams, input/output links, sun gear, carrier base.

```text
B@coord > F > S10 > moving part > S10 > tabs-loose
```

Hands-on steps:

1. Push `F` through board hole at `coord` from front to back.
2. Add one `S10` spacer on the front side.
3. Place the moving part on the fastener.
4. Add another `S10` spacer on top.
5. Open tabs loosely; part must rotate/swing without scraping.

Failure signs:

- part cannot rotate → tabs too tight or spacer missing,
- part rubs board → lower spacer missing,
- part wobbles excessively → fastener too loose or hole oversized.

### Procedure B — Fixed board part

Used by fixed ring gear and fixed guide brackets.

```text
B@coord > F > S10 > fixed part > tabs-behind-board
```

Hands-on steps:

1. Align fixed part holes to all called-out board coordinates.
2. Install fasteners one by one.
3. Add lower `S10` spacer if shown.
4. Flatten/open tabs behind board so the part does not rotate.
5. Re-check all listed board holes are used.

Failure signs:

- fixed guide shifts → tabs not tight enough,
- ring gear rotates → mount holes not fixed,
- part bends → overtightened or board/material warped.

### Procedure C — Floating linkage joint

Used by four-bar joints, slider-crank rod joint.

```text
J_link@coord > F > S10 > moving part > S10 > tabs-loose
```

Hands-on steps:

1. Bring the already-installed link hole near the reference coordinate.
2. Pass `F` through the moving link hole(s), not through the board.
3. Add `S10` between moving layers where shown.
4. Add top `S10`.
5. Open tabs loosely.

Failure signs:

- joint locked in place → accidentally pinned to board,
- link cannot fold → missing spacer or tabs too tight,
- displayed joint drifts from actual joint → app transform/handle state mismatch.

### Procedure D — Gear crank pin

Used by gear-linkage.

```text
H_gear@coord > F > S10 > L4 > S10 > tabs-loose
```

Hands-on steps:

1. Rotate output gear so a real attachment hole is near the called-out coordinate.
2. Pass `F` through that gear attachment hole.
3. Add `S10`, then L4 linkage, then top `S10`.
4. Open tabs loosely.
5. Rotate the gear slowly and confirm the link orbits the gear centre.

Failure signs:

- linkage rotates around board axle instead of crank pin → wrong hole used,
- no usable attachment hole → selected driven gear is too small (`G1`),
- collision with teeth/board → linkage radius/length too large or spacers missing.

### Procedure E — Carrier planet axle

Used by planetary gear.

```text
H_carrier@coord > F > S10 > planet gear > S10 > tabs-loose
```

Hands-on steps:

1. Align the carrier free hole near the reference coordinate.
2. Pass `F` through the carrier hole and planet gear, not through the board.
3. Add spacer layers as shown.
4. Verify the planet gear rolls between sun and ring as the carrier turns.

Failure signs:

- carrier cannot turn → planet pinned to board,
- planet falls out of mesh → wrong carrier length or wrong ring/planet pair,
- binding → tabs too tight or ring not centred.

## 5.6 Mechanism-specific assembly flows

## 5.6.1 Four-bar linkage build flow

Recipe: `four-bar-basic`.

Parts:

```text
L2 × 2
L4 × 1
S10 × 8
paper fasteners
```

Build sequence:

1. **Set ground pivots**
   - Coordinates: `I5(board)`, `I9(board)`.
   - Stack: `B@I5 > F > tabs-behind-board`, repeat at `I9`.
   - Check: both ground pivots are fixed.
2. **Add input link**
   - Coordinates: `I5(board)`, `G6(link_end_reference)`.
   - Stack: `B@I5 > F > S10 > L2_input > S10 > tabs-loose`.
   - Check: input L2 swings freely.
3. **Add coupler**
   - Coordinates: `G6(link_joint_reference)`, `G10(link_end_reference)`.
   - Stack: `J_link@G6 > F > S10 > L4_coupler > S10 > tabs-loose`.
   - Check: coupler moves without scraping.
4. **Close output link**
   - Coordinates: `G10(link_joint_reference)`, `I9(board)`.
   - Stack: `B@I9 > F > S10 > L2_output > S10 > tabs-loose`.
   - Check: all pivots move when input link turns.
5. **Join output to coupler**
   - Coordinate: `G10(link_joint_reference)`.
   - Stack: `J_link@G10 > F > S10 > L4_coupler > S10 > tabs-loose`.
   - Check: `G10` floats with the links and is not pinned to board.

Four-bar final check:

- `I5` and `I9` stay fixed.
- `G6` and `G10` move.
- No stack is missing an `S10` under/above a moving link.
- The input may not rotate 360°. If not, mark and use only the valid angle range.

## 5.6.2 Gear train build flow

Recipe: `gear-train-basic`.

Parts:

```text
G3 × 2
S10 × 8
paper fasteners
```

Build sequence:

1. **Start at H6**
   - Stack: `B@H6 > F > tabs-behind-board`.
   - Check: fastener turns freely.
2. **Add drive G3**
   - Stack: `B@H6 > F > S10 > G3_drive > S10 > tabs-loose`.
   - Check: drive gear spins without rubbing.
3. **Add output G3 at H9**
   - Stack: `B@H9 > F > S10 > G3_output > S10 > tabs-loose`.
   - Check: both gears turn when drive gear turns.
4. **Turn handle hole**
   - Use a real drive gear attachment hole.
   - Check: if mesh binds, loosen both fasteners.

Gear train final check:

- Distance `H6-H9` is 3 cells / 60 mm.
- Both centres are board-fixed.
- Teeth touch lightly, not forcefully.

## 5.6.3 Cam-follower build flow

Recipe: `cam-follower-basic`.

Parts:

```text
eccentric cam × 1
round follower × 1
2-hole bracket × 1
S10 × 8
paper fasteners
```

Build sequence:

1. **Mount cam axle**
   - Coordinate: `J7(board)`.
   - Stack: `B@J7 > F > tabs-behind-board`.
   - Check: axle is loose enough to rotate.
2. **Add eccentric cam**
   - Stack: `B@J7 > F > S10 > cam:eccentric > S10 > tabs-loose`.
   - Check: cam turns cleanly.
3. **Add follower guide**
   - Coordinate: `G7(board)`.
   - Stack: `B@G7 > F > S10 > follower:f3-round > S10 > tabs-loose`.
   - Check: follower can slide up/down.
4. **Check lift**
   - Turn cam slowly.
   - Check: loosen guide if follower sticks.

Cam-follower final check:

- Cam rotates around fixed `J7`.
- Follower moves vertically, not rotationally locked.
- Guide slot permits travel.

## 5.6.4 Gear-linkage crank build flow

Recipe: `gear-linkage-crank`.

Parts:

```text
G3 × 2
L4 × 2
2-hole bracket × 1
S10 × 8
paper fasteners
```

Build sequence:

1. **Mount drive gear axle**
   - Coordinate: `I6(board)`.
   - Stack: `B@I6 > F > tabs-behind-board`.
   - Check: axle is straight.
2. **Add drive G3**
   - Stack: `B@I6 > F > S10 > G3_drive > S10 > tabs-loose`.
   - Check: drive gear rotates freely.
3. **Mesh output G3 at I9**
   - Stack: `B@I9 > F > S10 > G3_output > S10 > tabs-loose`.
   - Check: gears move together.
4. **Add drive crank link**
   - Coordinates: `I6(gear_handle_reference)`, `I12(link_end_reference)`.
   - Stack: `H_gear@I6 > F > S10 > L4_drive > S10 > tabs-loose`.
   - Check: drive link rides around the drive gear centre instead of locking to the board.
5. **Add output crank link**
   - Coordinates: `I9(gear_handle_reference)`, `I12(link_end_reference)`.
   - Stack: `H_gear@I9 > F > S10 > L4_output > S10 > tabs-loose`.
   - Check: both L4 links meet at one moving R connector.
6. **Join moving connector**
   - Coordinate: `I12(link_end_reference)`.
   - Stack: `E_link@I12 > F > S10 > bracket2 > S10 > tabs-loose`.
   - Check: bracket follows the two link ends and is not pinned to the board.

Gear-linkage final check:

- Drive/output gear centres are fixed at `I6/I9`.
- B/C crank pins are off-centre gear handle holes.
- `I12`/R connector moves as the two-link circle intersection.

## 5.6.5 Planetary gear build flow

Recipe: `planetary-gear-basic`.

Parts:

```text
R56 ring × 1
G1 sun × 1
G3 planet × 1
L2 carrier × 1
S10 × 8
paper fasteners
```

Build sequence:

1. **Pin sun axle**
   - Coordinate: `H8(board)`.
   - Stack: `B@H8 > F > tabs-behind-board`.
   - Check: centre axle is straight/fixed.
2. **Mount fixed R56 ring gear**
   - Coordinates: `D8(board)`, `H4(board)`, `H12(board)`, `L8(board)`.
   - Stack: `B@D8 > F > S10 > R56_fixed > tabs-behind-board`, repeat at all ring mount holes.
   - Check: ring gear is fixed and does not rotate.
3. **Add G1 sun gear**
   - Stack: `B@H8 > F > S10 > G1_sun > S10 > tabs-loose`.
   - Check: G1 spins cleanly before carrier is added.
4. **Add carrier link**
   - Coordinates: `H8(board)`, `H10(carrier_reference)`.
   - Stack: `B@H8 > F > S10 > L2_carrier > S10 > tabs-loose`.
   - Check: carrier swings loosely around sun axle.
5. **Add moving G3 planet gear**
   - Coordinate: `H10(carrier_reference)`.
   - Stack: `H_carrier@H10 > F > S10 > G3_planet > S10 > tabs-loose`.
   - Check: planet axle travels with carrier and rolls between sun/ring.
6. **Rotate carrier**
   - Hold ring fixed and rotate carrier.
   - Check: if orbit binds, loosen planet fastener and spacer stack.

Planetary final check:

- Ring is fixed.
- Sun rotates at `H8`.
- Carrier rotates at `H8`.
- Planet moves with the carrier near `H10`; it is not board-pinned.

## 5.6.6 Slider-crank build flow

Recipe: `slider-crank-basic`.

Parts:

```text
L2 crank × 1
L6 rod × 1
3-hole straight bracket × 1
2-hole straight bracket × 1
S10 × 8
paper fasteners
```

Build sequence:

1. **Pin crank axle**
   - Coordinate: `I5(board)`.
   - Stack: `B@I5 > F > tabs-behind-board`.
   - Check: crank axle is fixed.
2. **Add crank link**
   - Coordinates: `I5(board)`, `G6(link_end_reference)`.
   - Stack: `B@I5 > F > S10 > L2_crank > S10 > tabs-loose`.
   - Check: crank rotates without scraping.
3. **Add connecting rod**
   - Coordinates: `G6(link_joint_reference)`, `G12(slider_reference)`.
   - Stack: `J_link@G6 > F > S10 > L6_rod > S10 > tabs-loose`.
   - Check: rod joint is moving and not pinned to board.
4. **Fix slider guide**
   - Coordinates: `G11(board)`, `G12(board)`, `G13(board)`.
   - Stack: `B@G11 > F > S10 > bracket3_fixed > tabs-behind-board`, repeat at all guide holes.
   - Check: guide is fixed; only slider block should move.
5. **Add slider block**
   - Coordinate: `G12(slider_reference)`.
   - Stack: `E_link@G12 > F > S10 > bracket2_slider > S10 > tabs-loose`.
   - Check: block travels along guide as crank turns.
6. **Turn crank and check slide**
   - Rotate L2 crank slowly.
   - Check: if it binds, loosen `G6` and `G12` moving joints.

Slider-crank final check:

- `I5` fixed.
- `G6` floating.
- guide fixed at `G11/G12/G13`.
- slider block at `G12` moving along guide.

## 5.7 Character attachment process

Character parts are not separate generic fabrication templates. They come from the current character blueprint/cut sheet.

Process:

1. Cut character body components from the character blueprint/cut sheet.
2. Identify each character drive hole or body-part pivot that will attach to a mechanism output.
3. Align the character drive hole to the mechanism output in the assembly guide.
4. Use a paper fastener through the mechanism output and character part.
5. Add `S10` between moving character part and mechanism/board/bracket layer.
6. Keep the character layer loose enough to move.
7. Run the mechanism by hand before tightening any non-moving tabs.

Recommended character stack when attaching a moving body part to mechanism output:

```text
mechanism-output-hole > F > S10 > character-part > S10 > tabs-loose
```

If a character part is fixed to the board for registration only:

```text
B@coord > F > S10 > character-part > tabs-behind-board
```

## 5.8 Troubleshooting guide

| Symptom | Likely cause | Fix |
|---|---|---|
| Mechanism will not move | Floating joint pinned to board | Check `coord_role`; replace board stack with link/gear/carrier stack. |
| Four-bar looks distorted | `G6`/`G10` treated as fixed board pivots or canvas transform mismatch | Ensure only `I5/I9` are fixed; recompute from same key points used for display. |
| Gear-linkage link does not orbit | Link attached to gear axle instead of off-centre hole | Use `H_gear` stack on a real attachment hole. |
| Planetary carrier locks | Planet axle pinned to board | Use `H_carrier` stack; remove board pin at `H10`. |
| Slider block stuck | Guide/slider both fixed at `G12` | Fixed guide can use `G12(board)`, but slider block uses `G12(slider_reference)`. |
| Part rubs board | Missing lower spacer | Add `S10` between board and moving part. |
| Part rubs fastener tabs/top layer | Missing top spacer or tabs too tight | Add top `S10`; loosen tabs. |
| Gear mesh binds | Axle distance wrong or fasteners too tight | Verify centre distance and loosen fasteners. |
| Printed holes too tight | Printer/cutter kerf/material issue | Cut test coupon and adjust hole scaling/kerf. |

## 5.9 Assembly metadata for a new renderer

Guide SVGs currently include metadata useful for app previews/tests. A web/native rewrite can keep the same data as DOM attributes or as structured JSON.

| Metadata | Purpose |
|---|---|
| `data-step` | Associates SVG element with assembly step. |
| `data-board-coord` | Associates callout/marker with board coordinate. |
| `data-part-key` | Associates rendered part with manifest part key. |
| `data-stack-layer` | Associates text/visual row with stack layer. |
| `data-layout-box` | Helps tests/app align guide cards. |
| `data-app-mechanism` | Mechanism type mapping for app previews. |

If the new platform does not use SVG, preserve equivalent semantic fields in the rendering model.

## 5.10 Release/QA checklist for assembly-guide parity

- [ ] Every mechanism recipe has a step-by-step guide.
- [ ] Each step displays coordinates and coordinate roles.
- [ ] Each step displays stack order bottom-to-top.
- [ ] Spacer layers are visible and labelled `S10`.
- [ ] Moving-reference coordinates are visually distinct from board pins.
- [ ] Per-step checks are shown before the next step.
- [ ] Duplicate parts of the same type are shown as separate instances when needed.
- [ ] Character attachment uses the same spacer stack policy as mechanisms.
- [ ] Guide output can be regenerated from source recipe data, not hand-authored screenshots.

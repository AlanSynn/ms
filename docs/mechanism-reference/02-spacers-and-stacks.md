# 02 — Spacer and Stack Rules

The spacer/stack contract is the most important rule for physical correctness. Most wrong mechanism previews or assembly guides come from treating floating joints as board pins or omitting spacers.

## 2.1 Stack coordinate frames

A stack has two independent meanings:

1. **Physical layer order**: what sits above what along the fastener axis.
2. **Coordinate role**: whether the fastener goes through the board or only through moving parts.

A coordinate label such as `G10` is only a location hint. It does not imply board pinning unless the role is `board`.

## 2.2 Layer roles

| Role | Symbol | Fixed? | Required part | Meaning |
|---|---|---:|---|---|
| `board` | `B@coord` | yes | none | Pegboard hole at `coord`. |
| `paper-fastener` | `F` | depends | hardware | Paper fastener through current stack. |
| `spacer` | `S10` | no | `spacers:s10` | Clearance washer below moving/fixed part. |
| `moving-part` | part symbol | no | mechanism part | Gear/link/cam/follower/bracket that must rotate/slide. |
| `fixed-part` | part symbol | yes | mechanism part | Ring/guide/bracket fixed to board. |
| `top-spacer` | `S10` | no | `spacers:s10` | Clearance washer above moving part. |
| `fastener-tabs` | `tabs` | depends | hardware | Tabs opened loosely or behind board. |
| `repeat-fastener-sites` | `repeat(...)` | yes | none | Repeat the same fixed stack at multiple board coords. |
| `carrier-hole` | `H_carrier@coord` | no | none | Hole in carrier link near coord; not board. |
| `gear-handle-hole` | `H_gear@coord` | no | none | Off-centre gear attachment hole near coord; not board. |
| `link-end-hole` | `E_link@coord` | no | none | Link end hole near coord; not board. |
| `link-joint-hole` | `J_link@coord` | no | none | Linkage joint near coord; not board. |

## 2.3 Universal spacer rule

Current source validation enforces:

```text
spacer layer role     -> part must be spacers:s10
top-spacer layer role -> part must be spacers:s10
```

Recommended portable validation:

```pseudo
for each stack_layer in step.stack:
    if stack_layer.role in {"spacer", "top-spacer"}:
        assert stack_layer.part == "spacers:s10"
```

## 2.4 Standard stack patterns

### A. Bare fixed board fastener

Use to start a board axle or mark a fixed pivot before adding parts.

```text
B@coord > F > tabs-behind-board
```

Layer order:

| Order | Role |
|---:|---|
| 1 | `board` |
| 2 | `paper-fastener` |
| 3 | `fastener-tabs` |

Use cases:

- four-bar ground pivot setup at `I5`, `I9`,
- gear axle pre-placement,
- cam axle pre-placement,
- slider crank axle.

### B. Free-running board pivot for a moving part

Use for a rotating part whose axle is board-fixed but whose part must spin/swing.

```text
B@coord > S10 > moving-part > fastener-head
```

Layer order:

| Order | Role | Part constraint |
|---:|---|---|
| 1 | `board` | none |
| 2 | `spacer` | `spacers:s10` |
| 3 | `moving-part` | gear/link/cam/follower/bracket |
| 4 | `paper-fastener` | visible fastener head |
| 5 | `fastener-tabs` | loose |

Use cases:

- gear on board axle,
- cam on board axle,
- four-bar input/output links at their ground pivots,
- planetary sun gear,
- carrier link at sun axle,
- slider crank link at board axle.

### C. Fixed part to board

Use for non-rotating guides, ring gear, or fixed brackets.

```text
B@coord > F > S10 > fixed-part > tabs-behind-board
```

Layer order:

| Order | Role | Part constraint |
|---:|---|---|
| 1 | `board` | none |
| 2 | `paper-fastener` | hardware |
| 3 | `spacer` | `spacers:s10` |
| 4 | `fixed-part` | ring/guide/bracket |
| 5 | `fastener-tabs` | opened behind board |

If a fixed part uses multiple board holes, repeat this stack at every fixed board coordinate. The assembly JSON adds `repeat-fastener-sites` to make this explicit.

Use cases:

- planetary ring gear at `D8`, `H4`, `H12`, `L8`,
- slider guide bracket at `G11`, `G12`, `G13`.

### D. Moving linkage-to-linkage joint

Use when one link attaches to another link at a free joint. It must not go through the board.

```text
J_link@coord > F > S10 > moving-part > S10 > tabs-loose
```

Layer order:

| Order | Role | Part constraint |
|---:|---|---|
| 1 | `link-joint-hole` | no board |
| 2 | `paper-fastener` | hardware |
| 3 | `spacer` | `spacers:s10` |
| 4 | `moving-part` | usually another link |
| 5 | `top-spacer` | `spacers:s10` |
| 6 | `fastener-tabs` | loose |

Use cases:

- four-bar coupler at `G6`,
- four-bar coupler/output floating joint at `G10`,
- slider-crank crank/rod joint at `G6`.

### E. Moving link-end connector

Use when a bracket/output connector attaches to a link end, not to the board.

```text
E_link@coord > F > S10 > moving-part > S10 > tabs-loose
```

Use cases:

- gear-linkage output bracket at `I12`,
- slider block bracket at `G12`.

### F. Off-centre gear handle / crank pin

Use when a linkage is fastened through a gear attachment hole. This is a moving joint on the rotating gear, not a fixed board axle.

```text
H_gear@coord > F > S10 > moving-part > S10 > tabs-loose
```

Use cases:

- gear-linkage L4 attached to output G3 handle hole near `I9`.

Rules:

- `H_gear` must correspond to a real attachment hole of the gear.
- `G1` has no attachment holes, so it cannot drive a gear-linkage crank pin.
- For `G3`, valid radius is `20.0 mm` at offsets `(0,±20)` or `(±20,0)`.

### G. Carrier pivot for planetary planet gear

Use when a planet gear rides on a carrier link. This is not a second board axle.

```text
H_carrier@coord > F > S10 > moving-part > S10 > tabs-loose
```

Use cases:

- planetary G3 planet gear near `H10`, fastened through the L2 carrier free hole.

Rules:

- The planet axle travels with the carrier.
- Do not pin the planet axle to the board.
- If a renderer displays `H10`, draw it as a moving-reference handle, not as a board peg.

## 2.5 Four-bar-specific spacer and stack rules

Four-bar has two fixed board pivots and two floating joints.

```text
Fixed board pivots: I5, I9
Floating joints:    G6, G10
Links:              input L2, coupler L4, output L2
Ground link:        implicit board span I5 ↔ I9
```

Physical stack contract:

| Joint | Role | Stack | Board-pinned? |
|---|---|---|---:|
| `A = I5` | input ground pivot | `B@I5 > S10 > L2_input > fastener-head` | yes |
| `B = G6` | input/coupler joint | `J_link@G6 > F > S10 > L4_coupler > S10 > tabs-loose` | no |
| `C = G10` | coupler/output joint | `J_link@G10 > F > S10 > L4_coupler or L2_output > S10 > tabs-loose` | no |
| `D = I9` | output ground pivot | `B@I9 > S10 > L2_output > fastener-head` | yes |

Do not create a board hole fastener at `G6` or `G10`. Those are moving joint references. Pinning them to the board locks or visually misrepresents the mechanism.

## 2.6 Validation rules for stack correctness

Portable validator should enforce at least:

1. Layer order is strictly increasing.
2. Each stack contains exactly one `paper-fastener` unless it is a visual/test-only step.
3. If role is `spacer` or `top-spacer`, part is exactly `spacers:s10`.
4. If a coordinate role is not `board`, stack first layer must not be `board`.
5. If first layer is `link-joint-hole`, `link-end-hole`, `gear-handle-hole`, or `carrier-hole`, the coordinate is a reference only.
6. Fixed multi-hole parts must include all fixed board coordinates and repeat the fixed stack.
7. Board-fixed moving parts use lower-z board-side order: `board > S10 spacer > moving part > fastener head`; floating joints may still use a top spacer when separating two moving layers.
8. Gears in mesh must satisfy `abs(board_distance_mm - (r1+r2+g)) <= tolerance_mm`.
9. Ring gear must be fixed; sun gear and planet gear must be moving.
10. Slider guide must be fixed; slider block must be moving.

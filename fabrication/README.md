# Automataii fabrication templates

This directory contains fabrication-ready SVG masters for the physical Automataii pegboard kit.

## Two supported workflows

1. **Board assembly** — open `assembly/`, choose a guide SVG, and follow the board-coordinate step cards with the pre-fabricated kit parts.
2. **Self-fabrication** — use the individual SVGs in `gears/`, `ring_gears/`, `linkages/`, `cams/`, `followers/`, `brackets/`, `spacers/`, and `handles/` to make replacement or custom parts with a laser cutter, CNC router, 3D-print workflow, scroll saw, table saw plus drill jig, or similar shop process.

For a repeatable workshop set, use `complete-kit-cut-sheet.svg` when you have a
cutter bed large enough for one actual-size master. It intentionally exceeds Letter
size because all unique parts cannot physically fit on one Letter page at 1:1.
For home printers, cut/print the 11 Letter workshop sheets in `sheets/`,
sort the parts, then use the matching `assembly/` guide.

## Physical assumptions

- Default committed pitch: `20.0 mm` (`2.00 cm`) board spacing.
- Nominal axle/linkage/bracket hole diameter: `4.0 mm`.
- Gear presets: G1 / 1-space gear (8 teeth), G3 / 3-space gear (24 teeth), G5 / 5-space gear (40 teeth), G7 / 7-space gear (56 teeth).
- Linkage lengths: 2, 4, 6, 8 board cells.
- Cam presets: circle, eccentric, oval, pear.
- Follower presets: round-nose, roller-pin, flat-shoe, linkage-output.
- Bracket presets: 2-hole straight, 3-hole straight, L 3-hole, triangle 3-hole.
- Spacer preset: S10 only, a 10 mm outside-diameter stackable washer.
- Handle preset: triangular paper-tent glue handle only; previous crank/tripod
  handles are intentionally removed from the generated package.
- Default profile key: `motionsmith-ms4n`. Legacy `ms4n` / `motionsmith-ms4n`
  identifiers are compatibility labels; the committed fabrication contract is
  this 20.0 mm / 4.0 mm board unless a custom output directory is generated.
- Red paths are cuts, blue circles are drill/cut holes, gray lines are score/reference geometry.
- Gear attachment-hole pattern: gears expose only axle holes or board-grid attachment holes;
  no gear uses non-grid fallback holes. Cams may use radial crank/linkage/handle holes only
  when a separate 4 mm hole can preserve enough material around the axle.
- Follower guide geometry: followers use 4 mm-wide vertical slots, not fixed round board holes,
  so fixed board pins/brackets can constrain the part while still allowing cam lift travel.

## Tolerance note

These files are nominal geometry, not material-specific kerf compensation. Before a workshop run, cut a small test coupon and adjust hole scaling/kerf for the chosen material, fasteners, printer, bit, or laser. The gears are educational/prototyping gears for automata experiments, not certified power-transmission gears.

## Relationship to `kit/`

`kit/` and `fabrication/` are intentionally separate physical-asset packages:

- `kit/` contains the existing educational/module-oriented MS4N activity sheets, prompt cards, checks, and broad classroom materials.
- `fabrication/` is the nominal-millimetre manufacturing package for the constrained physical parts requested here: gears, planetary ring gears, linkage bars, cams, followers, brackets, spacers, handles, and workshop cut sheets.
- Shared physical assumptions should come from `automataii.shared.physical_kit`; do not hand-edit generated `fabrication/` SVGs without updating the generator and sync test.

## Contents

- `manifest.json` — machine-readable inventory and dimensions.
- `complete-kit-cut-sheet.svg` — one actual-size cutter-bed page containing every unique physical part type.
- `assembly/` — board-coordinate assembly guides, recipe data, and the 15x15 hole / 225-hole board map.
- `gears/` — one SVG per gear preset; every gear includes a 4 mm axle hole, and larger gears include 4 mm linkage/bracket/crank/handle holes on the board grid.
- `ring_gears/` — fixed internal ring gear for the planetary guide, with board-mount holes.
- `linkages/` — one SVG per linkage length; holes are spaced on the board pitch.
- `cams/` — one SVG per cam preset; each cam includes a 4 mm axle hole and 4 mm linkage/bracket/crank/handle attachment holes.
- `followers/` — slotted cam follower parts with 4 mm guide slots and 4 mm linkage/output holes.
- `brackets/` — bracket plates for the pegboard/bracket assembly style shown in the reference image.
- `spacers/` — washer spacers for stack clearance between the board, gears, cams, links, and brackets.
- `handles/` — one simple rectangular paper-tent handle: cut the outer rectangle
  and the two visible left-side slits, score the prism folds on the right, fold
  each 10 mm tab strip into a four-layer bundle, pass through a 4 mm hole, then
  hot-glue. No thin neck is used.
- `sheets/` — 11 workshop sheets for pre-fabricated sets.

Managed files in this generated package: 48.

## Regeneration

```bash
uv run python scripts/generate_fabrication_templates.py --output fabrication
```

For a custom 2.5 cm board pitch, generate to a separate directory instead of overwriting the committed package:

```bash
uv run python scripts/generate_fabrication_templates.py --output /tmp/automataii-fabrication-2_5cm --grid-cell-cm 2.5
```

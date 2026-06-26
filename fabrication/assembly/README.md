# Automataii board assembly guides

Use this folder when you already have the fabricated kit parts and want to build on
the 15x15 hole board (15 rows x 15 columns = 225 board holes).

## How to use

1. In the app, use **Export Blueprint Package** for the normal PDF-first flow. It writes
   `current-design-cut-sheets.pdf`, `assembly/assembly-guide.pdf`, and
   `assembly/kit-parts-to-cut.pdf` into the folder you choose.
2. Use this committed `fabrication/assembly/` folder as the source template set only:
   `board-15x15.svg`, `index.html`, and per-mechanism SVGs are generator/debug inputs for
   the PDF package.
3. Open `board-15x15.svg` only when you need to inspect the 225 row-letter/column-number
   holes directly.
4. Follow one step card at a time: place the fastener at the called-out hole, then add spacers
   and parts in the exact `Stack` row order before running the check.
5. Keep paper fasteners loose enough for rotation or sliding before flattening the tabs.

## Character attachment

- Cut character body components from the current character blueprint/cut sheet. There is no
  separate Example Character fabrication template.
- Use paper fasteners for pivot/drive holes and keep spacers between moving character parts,
  linkage layers, and the board or bracket.
- Align character drive holes to the mechanism output shown in the guide; the cut sheet makes
  parts, while this guide decides board holes and per-step stack order.

## Guides

- `gear-train-basic` — Two-gear crank (4 steps)
- `cam-follower-basic` — Cam and follower lift (4 steps)
- `four-bar-basic` — Four-bar linkage (5 steps)
- `gear-linkage-crank` — Gear crank linkage (5 steps)
- `planetary-gear-basic` — Planetary ring gear (6 steps)
- `slider-crank-basic` — Slider-crank linkage (6 steps)

## Data contract

- `recipes.json` is the semantic source of truth for board coordinates, parts, stack order, and app visual mappings.
- Guide SVGs are render targets. They include `data-step`, `data-board-coord`, `data-part-key`, `data-stack-layer`, `data-layout-box`, and `data-app-mechanism` metadata for tests and future app previews.
- Self-fabrication cut sheets stay in the sibling part and `sheets/` folders.

# Fabrication board canonicalization migration audit (2026-07-07)

## Scope
- Consolidate fabrication board asset ownership into `fabrication/board-final.svg`.
- Remove legacy board SVG duplicates, align regen checks w/ new ownership.
- Verify TS-based board generator usable as managed source for board geometry.

## Sources compared
1. `fabrication/board.svg` (legacy committed)
2. `fabrication/assembly/board.svg` (legacy committed)
3. `fabrication/board-final.svg` (proposed canonical)
4. Regenerated board artifact from `bun scripts/generate-fabrication-board.ts`
5. Regenerated non-board asset pkg from TS template source

## Coordinate geometry findings
| Artifact | Grid role | Holes | Horizontal labels | Vertical labels | Width | Height |
|---|---|---:|---:|---:|---:|---:|
| `board.svg` | `main-board` | 225 | 15 | 15 | `305mm` | `305mm` |
| `assembly/board.svg` *(legacy)* | `assembly-board-map` | 225 | 15 | 15 | `305mm` | `305mm` |
| `board-final.svg` | `main-board` | 225 | 15 | 15 | `305.0mm` | `305.0mm` |

All three artifacts expose same `A1..O15` coordinate set + same pitch/diameter metadata.

## Why `board-final.svg` is now canonical
- Single source of truth in committed pkg (`fabrication/manifest.json` + snapshot)
- Explicitly owned by new TypeScript generator path:
  - `scripts/generate-fabrication-board.ts`
  - `utils/fabricationBoardTemplate.tsx`
- No generated duplicates in `fabrication/` root or `fabrication/assembly/`.
- Assembly docs/index now point to `../board-final.svg`, no longer to `board.svg`.

## Risk notes
- TS gen now live path for both board geometry + managed template assets.
- `fabrication/fabrication-python-oracle.json` frozen historical contour reference; normal TS gen + audits read but never rewrite.

## Files removed as legacy
- `fabrication/board.svg`
- `fabrication/assembly/board.svg`
- `fabrication/board-final (3).svg` (outdated editor export)

## Verification changes made
- `tests/project-contract.test.ts`
  - Main board assertions now read `fabrication/board-final.svg`.
  - TS-only regen now compares managed assets vs committed output + frozen oracle.
  - Added TS board generator reproduction check: `bun scripts/generate-fabrication-board.ts` produces committed `board-final.svg`.
- `fabrication/manifest.json` + snapshot updated to map `assembly.board_map` and `assembly.files` board entry to `board-final.svg`.
- `fabrication/README.md` + `fabrication/assembly` docs updated to reflect canonical board ownership.
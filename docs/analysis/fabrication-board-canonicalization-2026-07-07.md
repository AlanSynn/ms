# Fabrication board canonicalization migration audit (2026-07-07)

## Scope
- Consolidate fabrication board asset ownership into `fabrication/board-final.svg`.
- Remove legacy board SVG duplicates and align regeneration checks with the new ownership.
- Verify TS-based board generator can be used as the managed source for board geometry.

## Sources compared
1. `fabrication/board.svg` (legacy committed)
2. `fabrication/assembly/board.svg` (legacy committed)
3. `fabrication/board-final.svg` (proposed canonical)
4. Regenerated board artifact from `bun scripts/generate-fabrication-board.ts`
5. Regenerated non-board asset package from the TS template source

## Coordinate geometry findings
| Artifact | Grid role | Holes | Horizontal labels | Vertical labels | Width | Height |
|---|---|---:|---:|---:|---:|---:|
| `board.svg` | `main-board` | 225 | 15 | 15 | `305mm` | `305mm` |
| `assembly/board.svg` *(legacy)* | `assembly-board-map` | 225 | 15 | 15 | `305mm` | `305mm` |
| `board-final.svg` | `main-board` | 225 | 15 | 15 | `305.0mm` | `305.0mm` |

All three artifacts expose the same `A1..O15` coordinate set and the same pitch/diameter metadata.

## Why `board-final.svg` is now canonical
- Single source of truth in committed package (`fabrication/manifest.json` + snapshot)
- Explicitly owned by new TypeScript generator path:
  - `scripts/generate-fabrication-board.ts`
  - `utils/fabricationBoardTemplate.tsx`
- No generated duplicates in `fabrication/` root or `fabrication/assembly/`.
- Assembly docs/index now point to `../board-final.svg` and no longer to `board.svg`.

## Risk notes
- TS generation is now the live path for both board geometry and managed template assets.
- `fabrication/fabrication-python-oracle.json` remains a frozen historical contour reference; normal TS generation and audits read it but never rewrite it.

## Files removed as legacy
- `fabrication/board.svg`
- `fabrication/assembly/board.svg`
- `fabrication/board-final (3).svg` (outdated editor export)

## Verification changes made
- `tests/project-contract.test.ts`
  - Main board assertions now read `fabrication/board-final.svg`.
  - TS-only regeneration now compares managed assets against committed output and the frozen oracle.
  - Added TS board generator reproduction check that `bun scripts/generate-fabrication-board.ts` produces the committed `board-final.svg`.
- `fabrication/manifest.json` and snapshot updated to map `assembly.board_map` and `assembly.files` board entry to `board-final.svg`.
- `fabrication/README.md` and `fabrication/assembly` docs updated to reflect canonical board ownership.

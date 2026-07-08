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
5. Regenerated non-board asset package from `python3 fabrication/generate_fabrication_templates.py`

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
- Python generator emits `board-final.svg` as the canonical board asset and now aligns with
  the same board path used by `fabrication/manifest.json`; TS board generation remains the
  regression-owned path for canonical geometry.
  - This keeps backward compatibility for Python-side non-board generation while avoiding false drift failures on board artifacts.
- If TS gains additional board variants, `generate_fabrication_templates.py` can be updated
  later by wiring its own `board-final.svg` generation call to the same spec.

## Files removed as legacy
- `fabrication/board.svg`
- `fabrication/assembly/board.svg`
- `fabrication/board-final (3).svg` (outdated editor export)

## Verification changes made
- `tests/project-contract.test.ts`
  - Main board assertions now read `fabrication/board-final.svg`.
  - Python-generated regeneration now compares only non-board assets.
  - Added TS board generator reproduction check that `bun scripts/generate-fabrication-board.ts` produces the committed `board-final.svg`.
- `fabrication/manifest.json` and snapshot updated to map `assembly.board_map` and `assembly.files` board entry to `board-final.svg`.
- `fabrication/README.md` and `fabrication/assembly` docs updated to reflect canonical board ownership.

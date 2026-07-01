# Automataii Mechanism Reference

This folder is the portable mechanism-unit rulebook for rebuilding Automataii's mechanism and fabrication logic in another application. It extracts the current source-of-truth contracts from:

- `src/automataii/shared/physical_kit.py`
- `src/automataii/shared/fabrication_assembly.py`
- `src/automataii/application/mechanism_foundry/controller.py`
- `src/automataii/application/mechanism_foundry/mechanism_types.py`
- `src/automataii/application/mechanism_transfer/contract.py`
- `fabrication/manifest.json`
- `fabrication/assembly/recipes.json`
- `source/mechanism-catalog.snapshot.json`

## Read order

1. [`00-symbols-coordinate-system.md`](00-symbols-coordinate-system.md) — units, symbols, board coordinates, mechanism identifiers.
2. [`01-physical-kit-parts.md`](01-physical-kit-parts.md) — board, fasteners, spacers, linkages, gears, cams, followers, brackets, handles.
3. [`02-spacers-and-stacks.md`](02-spacers-and-stacks.md) — spacer rules and exact z-stack layer contracts.
4. [`03-mechanism-unit-specs.md`](03-mechanism-unit-specs.md) — per-mechanism portable contracts, including the exact four-bar linkage/spacer rules.
5. [`04-portable-schema-and-validation.md`](04-portable-schema-and-validation.md) — app-neutral JSON shape and validation checklist.
6. [`05-assembly-process-guides.md`](05-assembly-process-guides.md) — hands-on assembly flow, step-card contract, and per-mechanism build/check process.
7. [`source/`](source/) — copied source JSON snapshots used to derive these documents.

## Mechanism coverage status

| Mechanism key | Current status | Foundry-visible | Transfer/export | Fabrication recipe | Notes |
|---|---:|---:|---:|---:|---|
| `four_bar` | production physical mechanism | yes | yes | yes | Canonical 4-bar recipe; uses L2-L4-L2 plus board ground link. |
| `cam_follower` | production physical mechanism | yes | yes | yes | Eccentric cam + round follower recipe; other cam/follower presets are parts. |
| `gear_train` | production physical mechanism | yes | yes | yes | Separated G3 endpoint gears by default; inserted idlers create the mesh/coupling. |
| `gear_linkage` | production physical mechanism | yes | yes | yes | Separated endpoint gear crank pins plus paired links meeting at R; inserted idlers provide gear coupling. |
| `planetary_gear` | production physical mechanism | yes | yes | yes | G1 sun, G3 planet, R56 fixed ring, L2 carrier; ring/sun/planet teeth share one mesh plane while the carrier rides on a separate spacer plane. |
| `slider_crank` | supported physical/export mechanism | no | yes | yes | Assembly recipe exists; not exposed in Foundry gallery. |
| `three_bar` / `linkage_three_bar` | content/domain reference only | no | no | no | No current physical recipe. |
| `five_bar` / `linkage_five_bar` | content/domain reference only | no | no | no | No current physical recipe; needs synchronized dual inputs. |
| `six_bar` / `linkage_six_bar` | catalog/content/domain reference only | no | no | no | Catalog entry exists; no current physical recipe. |
| `geneva_drive` | catalog-only legacy idea | no | no | no | Present in `mechanism_catalog.json`, not in physical kit/export contract. |

PRD-level implementation contracts live in `docs/prd/mechanisms/`. Those files are the task-level spec for keeping Foundry, Design, Blueprint, Assembly, and tests aligned with this reference.

## Non-negotiable portability rules

- Use millimetres as canonical physical units.
- Use the board pitch `p = 20.0 mm` by default unless a profile explicitly chooses another pitch.
- Use 4.0 mm holes for all pivots, board holes, linkage holes, gear attachment holes, cam holes, spacers, and brackets.
- Use exactly one spacer part in the current physical kit: `spacers:s10`, outer diameter 10.0 mm, inner diameter 4.0 mm.
- Moving pivots must use loose paper fasteners with spacers above/below moving layers.
- Moving joints (`link_joint_reference`, `link_end_reference`, `gear_handle_reference`, `carrier_reference`, `slider_reference`) are assembly reference positions only; they must not be pinned to board holes.
- A board coordinate in an assembly step is not automatically a fixed board pivot. Its `coord_role` decides whether it is fixed (`board`) or only a reference for a moving joint.
- View pan/zoom is a shared viewer input rule: wheel zooms; drag pans in 2D or with middle/right/Shift in 3D; left drag orbits only in 3D.

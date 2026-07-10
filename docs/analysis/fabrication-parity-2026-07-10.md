# Python↔TypeScript managed SVG contour parity trace

Generated: 2026-07-10T22:54:06.930Z

## Checks
- TS generation executed: ✅
- managed manifest metadata parity: ✅
- managed file set parity: ✅
- board file present: ✅
- board coordinate parity: ✅ (225/225)
- Python↔TypeScript managed SVG contours: ✅ (51 semantic, 53 exact text)
- runtime Blueprint/scene SVGs: presentation-non-cutter — Blueprint/export scene SVGs reuse some primitives but are presentation/non-cutter outputs and are not claimed contour-identical.

## File-level parity
- exact: 56
- mismatched: 0
- missing in committed: 0
- missing in generated: 0

## Mechanism-category parity matrix
| category | file count | strategy | coverage | metadata match | generated-by | recommendation |
|---|---:|---|---|---|---|---|
| assembly | 10 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| board | 1 | ts-board-generation | covered | n/a | scripts/generate-fabrication-board.ts | TypeScript board generation is contour-checked against fresh Python output. |
| brackets | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| cam_modules | 8 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| cams | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| followers | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| gears | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| handles | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| linkages | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| misc-root | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| ring_gears | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| root-readme | 2 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| sheets | 11 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |
| spacers | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh Python and TS outputs. |

## Recommendations
- Python↔TypeScript managed SVG contour parity holds for the copied template package plus generated board. Runtime Blueprint/scene SVGs remain presentation geometry, not cutter-contour identity evidence.

## Hard failures
- none

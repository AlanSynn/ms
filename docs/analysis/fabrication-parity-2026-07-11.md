# TS/frozen-oracle managed SVG contour parity trace

Generated: 2026-07-11T17:32:50.117Z

## Checks
- TS generation executed: ✅
- managed manifest metadata parity: ✅
- managed file set parity: ✅
- board file present: ✅
- board coordinate parity: ✅ (225/225)
- TS/frozen-oracle managed SVG contours: ✅ (51 semantic)
- runtime Blueprint/scene SVGs: presentation-non-cutter — Blueprint/export scene SVGs reuse some primitives but are presentation/non-cutter outputs and are not claimed contour-identical.

## File-level parity
- exact: 56
- mismatched: 0
- missing in committed: 0
- missing in generated: 0

## Mechanism-category parity matrix
| category | file count | strategy | coverage | metadata match | generated-by | recommendation |
|---|---:|---|---|---|---|---|
| assembly | 10 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| board | 1 | ts-board-generation | covered | n/a | scripts/generate-fabrication-board.ts | TypeScript board generation is contour-checked against committed output and the frozen oracle. |
| brackets | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| cam_modules | 8 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| cams | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| followers | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| gears | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| handles | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| linkages | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| misc-root | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| ring_gears | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| root-readme | 2 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| sheets | 11 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |
| spacers | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle. |

## Recommendations
- TS managed SVG contour parity holds against committed artifacts and the frozen Python-derived oracle. Runtime Blueprint/scene SVGs remain presentation geometry, not cutter-contour identity evidence.

## Hard failures
- none

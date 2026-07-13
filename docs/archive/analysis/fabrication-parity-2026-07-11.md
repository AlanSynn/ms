# TS/frozen-oracle managed SVG contour parity trace

Generated: 2026-07-11T17:32:50.117Z

## Checks
- TS generation run: ✅
- managed manifest metadata parity: ✅
- managed file set parity: ✅
- board file present: ✅
- board coordinate parity: ✅ (225/225)
- TS/frozen-oracle managed SVG contours: ✅ (51 semantic)
- runtime Blueprint/scene SVGs: presentation, non-cutter — Blueprint/export scene SVGs reuse some primitives but are presentation/non-cutter outputs, not claimed contour-identical.

## File-level parity
- exact: 56
- mismatched: 0
- missing in committed: 0
- missing in generated: 0

## Mechanism-category parity matrix
| category | file count | strategy | coverage | metadata match | generated-by | recommendation |
|---|---:|---|---|---|---|---|
| assembly | 10 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| board | 1 | ts-board-generation | covered | n/a | scripts/generate-fabrication-board.ts | TS board generation contour-checked vs committed output, frozen oracle. |
| brackets | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| cam_modules | 8 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| cams | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| followers | 4 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| gears | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| handles | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| linkages | 4 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| misc-root | 1 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| ring_gears | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| root-readme | 2 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| sheets | 11 | template-copy | covered | n/a | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |
| spacers | 1 | template-copy | covered | ✅ | scripts/generate-fabrication-assets.ts | Template-copy artifacts contour-checked vs fresh TS output, committed artifacts, frozen oracle. |

## Recommendations
- TS managed SVG contour parity holds vs committed artifacts + frozen Python-derived oracle. Runtime Blueprint/scene SVGs stay presentation geometry, not cutter-contour identity evidence.

## Hard failures
- none
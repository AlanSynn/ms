# Fabrication 1:1 parity trace (TS source)

Generated: 2026-07-10T20:31:26.239Z

## Checks
- TS generation executed: ✅
- managed manifest metadata parity: ✅
- managed file set parity: ✅
- board file present: ✅
- board coordinate parity: ✅ (225/225)

## File-level parity
- exact: 56
- mismatched: 0
- missing in committed: 0
- missing in generated: 0

## Mechanism-category parity matrix
| category | file count | strategy | coverage | metadata match | generated-by | recommendation |
|---|---:|---|---|---|---|---|
| assembly | 10 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| board | 1 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| brackets | 4 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| cam_modules | 8 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| cams | 4 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| followers | 4 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| gears | 4 | full-svg-generation | covered | ✅ | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| handles | 1 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| linkages | 4 | full-svg-generation | covered | ✅ | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| misc-root | 1 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| ring_gears | 1 | full-svg-generation | covered | ✅ | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| root-readme | 2 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| sheets | 11 | full-svg-generation | covered | n/a | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |
| spacers | 1 | full-svg-generation | covered | ✅ | scripts/generate-fabrication-assets.ts | TS-generated source path is authoritative for this category. |

## Recommendations
- TS source output is currently fully 1:1 for managed categories including board and all mechanism families.

## Hard failures
- none

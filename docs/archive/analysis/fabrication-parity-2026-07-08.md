# Fabrication 1:1 parity trace

Generated: 2026-07-08T04:15:49.669Z

## Checks
- python generation manifest loaded: ✅
- committed manifest loaded: ✅
- managed file set 1:1: ✅
- manifest metadata parity: ✅
- board coordinate parity (python vs committed): ✅ (225 / 225)
- TS board generated: ✅
- TS board exact vs committed: ✅ (225 / 225)
- TS board coordinate parity: ✅

## Hard failures
- none

## File-level parity
- exact: 56
- mismatched: 0
- missing in committed: 0
- missing in generated: 0

## Mechanism-category parity matrix
| category | python file count | ts strategy | ts coverage | metadata match | recommendation |
|---|---:|---|---|---|---|
| assembly | 10 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| board | 1 | full-svg-generation | covered | N/A | Already parity-covered in TS artifacts. |
| brackets | 4 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| cam_modules | 8 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| cams | 4 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| followers | 4 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| gears | 4 | metadata-only | partial | ✅ | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| handles | 1 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| linkages | 4 | metadata-only | partial | ✅ | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| misc-root | 2 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| ring_gears | 1 | metadata-only | partial | ✅ | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| root-readme | 1 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| sheets | 11 | not-implemented | not-covered | N/A | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |
| spacers | 1 | metadata-only | partial | ✅ | Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category. |

## Recommendations
- Implement TS generators or adapters for parity-hard category files: assembly, brackets, cam_modules, cams, followers, gears, handles, linkages, misc-root, ring_gears, root-readme, sheets, spacers.
- Current Python and TS parity checks are clean for board artifacts; remaining categories remain metadata-only parity only.

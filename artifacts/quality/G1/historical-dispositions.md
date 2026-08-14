# G1 historical dispositions

No historical commit was cherry-picked. Each item below was inspected as historical intent and is covered by the current clean implementation plus accepted commit `a52ef5dc5bf3f6d0dce43b525f19b7fd0e0690a4`.

## Single-lane commits — `VERIFIED_CLEAN_IMPLEMENTATION`

- `f5fa582c` — define fabrication combination boundary
- `7639dc6e` — plan fabrication combination boundary
- `365e55f2` — resolve catalog fabrication combinations
- `3ba5bdb7` — close fabrication combination boundary
- `b98b27f2` — rank gear-linkage candidates
- `6eb15b4b` — reject off-catalog graph parts
- `9df9a651` — preserve raw graph dimensions
- `bc1f2db6` — restore catalog-backed envelope parity
- `ddd20756` — commit snapped fabrication state atomically
- `b8112a41` — close authority correction
- `d1b95f7c` — snap interactive edits to kit parts
- `4c7fc410` — reject unsafe physical candidates
- `69431b55` — preflight physical-hole previews
- `d59133f3` — avoid eager catalog option solves
- `d1f4bcfb` — bound catalog path fitting
- `2ec813ac` — preserve exact Fit commits
- `1dccca16` — skip fallback after accepted four-bar Fit
- `4077c2cd` — reuse connection candidates during playback
- `7b466f38` — reuse physical-envelope validation

## Mixed commits — G1 hunks `VERIFIED_CLEAN_IMPLEMENTATION`

- `283e0be9`: six hunks in `hooks/useAppMechanismActions.ts` and `tests/project-contract.test.ts` covering edit authority, Fit command behavior, and latency.
- `30a9e9f4`: one hunk in `MechanismRecommendationSheet.tsx` requiring zero fitting work while closed.

The parent mixed commit rows remain pending until every other routed lane finishes; only their G1 hunks are finalized here.

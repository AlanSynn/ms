# Source snapshots

These files are copied snapshots of the JSON source data used by the mechanism reference docs:

- `fabrication-manifest.snapshot.json` from `fabrication/manifest.json` (byte-identical mirror, contract-checked)
- `mechanism-catalog.snapshot.json` from the legacy mechanism catalog export (sole source of six_bar/geneva parameters)
- `mechanism-content/linkage_{three,five,six}_bar.json` from the legacy educational mechanism content exports (cited by unit specs §3.8)

Live assembly recipes are read directly from `fabrication/assembly/recipes.json`; no snapshot copy is kept.

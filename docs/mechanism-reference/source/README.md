# Source snapshots

These files are copied snapshots of the JSON source data used by the mechanism reference docs:

- `fabrication-manifest.snapshot.json` from `fabrication/manifest.json`
- `assembly-recipes.snapshot.json` from `fabrication/assembly/recipes.json`
- `mechanism-catalog.snapshot.json` from the legacy mechanism catalog export
- `mechanism-content/*.json` from the legacy educational mechanism content exports

They are intentionally copied here so a future web/ONNX/other-platform rebuild can consume a single folder without crawling the PyQt application tree.

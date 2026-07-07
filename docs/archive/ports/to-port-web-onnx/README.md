# to-port-web-onnx

Bundle: current Automataii AI / ONNX / image-processing impl — for future web ONNX port.

## How this bundle is organized

- `repo/` preserve original repo-relative paths — imports + refs trace exact.
- `repo/models/` hold model artifacts + conversion/config scripts.
- `copy_manifest.json` record every copied file + size + SHA-256.

Folder = porting bundle; exclude `__pycache__`, virtualenvs, `dist/`, generated app bundles.
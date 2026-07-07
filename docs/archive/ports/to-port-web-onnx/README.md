# to-port-web-onnx

Bundle: current Automataii AI / ONNX / image-processing impl for future web ONNX port.

## How this bundle is organized

- `repo/` preserves original repo-relative paths — imports + references trace back exact.
- `repo/models/` holds actual model artifacts + model conversion/config scripts.
- `copy_manifest.json` records every copied file with size + SHA-256.
- `AI_USAGE_MAP.md` explains where AI/ML/CV used today.

Folder = porting bundle; intentionally excludes `__pycache__`, virtualenvs, `dist/`, generated app bundles.
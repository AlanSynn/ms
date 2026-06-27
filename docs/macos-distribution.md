# macOS Distribution

Use the browser build for local testing and the Tauri app-bundle target for native packaging.

```bash
bun run build
bun run build:exe
```

`build:exe` creates a macOS `.app` bundle through Tauri and resolves Cargo from rustup when Cargo is not already on `PATH`. For hosts where DMG creation is supported, run:

```bash
bun run build:dmg
```

Before distributing, verify:

- `bun run test` passes.
- `dist/onnx/pose_model.onnx` is present.
- `src-tauri/icons/icon.png` and `src-tauri/icons/icon.ico` are tracked source assets.
- The app opens without network access.
- Blueprint export downloads JSON, SVG, HTML, metadata JSON, and PDF artifacts.

# macOS Distribution

Use the browser build for local testing and the Tauri app-bundle target for native packaging.

```bash
bun run build
bun run build:tauri-frontend
bun run build:exe
```

`build:exe` creates a macOS `.app` bundle through Tauri and resolves Cargo from rustup when Cargo is not already on `PATH`. For hosts where DMG creation is supported, run:

```bash
bun run build:dmg
```

Before distributing, verify:

- `bun run test` passes.
- `dist/onnx/pose_model.onnx` is present, is not a Git LFS pointer, and matches
  the byte count and SHA-256 recorded in [deployment provenance](deployment.md#asset-provenance).
- `resources/icons/AppIcon.png` / `.icns` are the canonical app icon assets, and `src-tauri/icons/icon.png`, `.ico`, and `.icns` are regenerated package copies.
- `bun run build:tauri-frontend` completes without the known unresolved
  Tauri-relative boot-font warning; the font remains a relative bundled
  `./fonts/` asset.
- The app opens without network access.
- Blueprint export downloads JSON, SVG, HTML, metadata JSON, and PDF artifacts.

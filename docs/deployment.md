# Deployment

The web build is fully local/offline after install. Production web deployment is rooted at `/` so the editor can load from the domain root; Tauri builds keep relative `./` assets.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

`vite build` copies static ONNX assets from `public/onnx/` into `dist/onnx/`. The contract test asserts `dist/onnx/pose_model.onnx` exists after a production build.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench. Required-server features are intentionally excluded unless the product scope is reopened: backend/API services, cloud database, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server-side ONNX inference, and server export jobs. Use browser-local ONNX, browser autosave, local snapshot downloads, and bundled/static assets instead of fake cloud surfaces.

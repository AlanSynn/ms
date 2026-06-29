# Deployment

The web build is fully local/offline after install. The default web build is rooted at `/`; the GitHub Pages release build sets `VITE_BASE_PATH=/ms/` so MotionSmith loads from `https://alansynn.com/ms/`. Tauri builds keep relative `./` assets.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

`vite build` copies static ONNX assets from `public/onnx/` into `dist/onnx/`. The contract test asserts `dist/onnx/pose_model.onnx` exists after a production build.


## GitHub Pages release deploy

Deployment is intentionally version-gated. Pushing to `main` does not deploy; only a tag that matches `package.json` deploys.

```bash
# after committing the release
VERSION=$(bun -p "require('./package.json').version")
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

The workflow verifies `v$VERSION == package.json.version`, builds with `VITE_BASE_PATH=/ms/`, and publishes `dist/` with GitHub Pages Actions.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench. Required-server features are intentionally excluded unless the product scope is reopened: backend/API services, cloud database, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server-side ONNX inference, and server export jobs. Use browser-local ONNX, browser autosave, local snapshot downloads, and bundled/static assets instead of fake cloud surfaces.

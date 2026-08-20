# Deployment

The web build is fully local/offline after install. The default web build is rooted at `/`; the GitHub Pages release build sets `VITE_BASE_PATH=/ms/` so MotionSmith loads from `https://alansynn.com/ms/`. Tauri builds keep relative `./` assets.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

The build runs `scripts/check-no-image-recognition.mjs` before and after Vite. It fails if ONNX/ORT recognition source, a model, worker, dependency, or production asset returns. Rapier remains a separate optional physics chunk: ordinary startup and Foundry/Design entry do not request it. It loads only after the student turns on the Foundry `Push` physics diagnostic.


## GitHub Pages release deploy

Deployment is intentionally version-gated. Pushing to `main` does not deploy; only a tag that matches `package.json` deploys.

```bash
# after committing the release
VERSION=$(bun -p "require('./package.json').version")
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

The workflow verifies `v$VERSION == package.json.version`, runs the complete checked unit manifest, builds and exercises the focused diagnostics preview (including WebGL recovery and optional Rapier loading), then creates a fresh `/ms/` production artifact. Bundle and image-recognition gates must pass before GitHub Pages can upload `dist/`.

## Classroom release checklist

Before a teacher-facing web release:

- Tag must be `v<package.json version>`; the workflow must reject mismatched tags.
- Build must use `VITE_BASE_PATH=/ms/` for `https://alansynn.com/ms/`.
- `bun run test:no-image-recognition` must pass; no ONNX model, ORT/WASM recognition runtime, inference worker, or cache worker may exist in `dist/`.
- Opening Foundry must not request the optional Rapier chunk; only the explicit `Push` diagnostic may load it.
- Runtime HTML must not load CDN scripts, import maps, or external `https://` assets.
- Browser QA must show no `/api/` requests, server login, upload, cloud sync, roster, analytics, dashboard, or hosted storage calls.
- About/help copy must state: no account, no upload, browser autosave, local downloads, and no image-recognition model download.
- Teacher pack workflow stays file-based: teacher shares a project/package, students edit locally, then download snapshot, blueprint files, and assembly guide.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench. Required-server features are intentionally excluded unless the product scope is reopened: backend/API services, cloud database, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server inference, and server export jobs. Image recognition is also excluded from shipped clients. Use guided starters, explicit local packages, browser autosave, local snapshot downloads, and bundled/static assets instead of fake cloud surfaces.

# Deployment

The web build is fully local/offline after install. The default web build is rooted at `/`; the GitHub Pages release build sets `VITE_BASE_PATH=/ms/` so MotionSmith loads from `https://alansynn.com/ms/`. Tauri builds keep relative `./` assets.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

`vite build` copies static ONNX assets from `public/onnx/` into `dist/onnx/`. The contract test asserts `dist/onnx/pose_model.onnx` exists and is real model data, not a Git LFS pointer.


## Build layers

The core browser build has no telemetry secret or endpoint requirement. The
relative Tauri frontend build and the production-preview browser layer are
separate checks:

~~~bash
bun run build:tauri-frontend
PLAYWRIGHT_PORT=4173 bun run test:browser
~~~

The production-preview port is isolated and strict; a busy port fails the
browser layer instead of silently attaching to another server. Explicit
`PLAYWRIGHT_SERVER=dev` is the only interactive exception and may reuse an
existing Vite HMR server.

## Asset provenance

public/onnx/pose_model.onnx is the browser-local FP32 pose model tracked by
Git LFS (.gitattributes). Its checked-in provenance is the
models/onnx/pose_model.onnx entry in
docs/archive/ports/to-port-web-onnx/copy_manifest.json:

- bytes: 135929562
- SHA-256: 9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74
- Git LFS object: sha256:9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74

The Pages workflow verifies this identity before the build and again after
the copy into dist/. Fabrication snapshots retain their own generator and
source-template metadata; they are not regenerated as part of a release
deploy.

The bounded INT8 candidate at `models/candidates/pose_model.int8.ort` is a
manual, non-deployed Git LFS candidate. It stays outside `public/` and is not
copied into `dist/` or fetched by the Pages workflow.

## GitHub Pages release deploy

Deployment is intentionally version-gated. Pushing to `main` does not deploy; only a tag that matches `package.json` deploys.

```bash
# after committing the release
VERSION=$(bun -p "require('./package.json').version")
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

The workflow checks out source with LFS smudging disabled, then explicitly
fetches only the deployed `public/onnx/pose_model.onnx`. It verifies that
asset's recorded byte count and SHA-256 before and after build, rejects
pointer files, verifies `v$VERSION == package.json.version`, builds with
`VITE_BASE_PATH=/ms/`, and publishes `dist/` with GitHub Pages Actions. Each
workflow step names its layer (`asset`, `version`, `contracts`, `web`, or
`artifact`) so failures are diagnosable from the Actions summary.

The tagged release workflow intentionally contains no study deployment,
telemetry endpoint, or telemetry secret. If a future study requires a hosted
service, it must use a separate explicitly opt-in workflow and profile; it must
not become a dependency of this local-first tagged release.

## Classroom release checklist

Before a teacher-facing web release:

- Tag must be `v<package.json version>`; the workflow must reject mismatched tags.
- Build must use `VITE_BASE_PATH=/ms/` for `https://alansynn.com/ms/`.
- `public/onnx/pose_model.onnx` and `dist/onnx/pose_model.onnx` must be real ONNX bytes, not Git LFS pointers.
- Both model files must match the recorded size and SHA-256 in **Asset provenance**.
- Runtime HTML must not load CDN scripts, import maps, or external `https://` assets.
- Browser QA must show no `/api/` requests, server login, upload, cloud sync, roster, analytics, dashboard, or hosted storage calls.
- About/help copy must state: no account, no upload, local ONNX, browser autosave, local downloads.
- Teacher pack workflow stays file-based: teacher shares a project/package, students edit locally, then download snapshot, blueprint files, and assembly guide.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench. Required-server features are intentionally excluded unless the product scope is reopened: backend/API services, cloud database, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server-side ONNX inference, and server export jobs. Use browser-local ONNX, browser autosave, local snapshot downloads, and bundled/static assets instead of fake cloud surfaces.

## Native packaging

Native packaging is a separate host-toolchain layer and is not required by the
core browser build:

```bash
bun run build:tauri-frontend
bun run build:exe
bun run build:dmg
```

The last two commands may fail when the host lacks the requested native SDK or
signing tools. Preserve that raw failure as a packaging/toolchain result; do
not turn it into a successful browser-build result.

# Deployment

The web build is fully local/offline after install. The primary classroom release is the root build at `https://motionsmith.org/`; `https://alansynn.com/ms/` remains a GitHub Pages mirror. The release workflow builds these as separate artifacts with `VITE_BASE_PATH=/` and `VITE_BASE_PATH=/ms/` respectively. Tauri builds keep relative `./` assets.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

The build runs `scripts/check-no-image-recognition.mjs` before and after Vite. It fails if ONNX/ORT recognition source, a model, worker, dependency, or production asset returns. Rapier remains a separate optional physics chunk: ordinary startup and Foundry/Design entry do not request it. It loads only after the student turns on the Foundry `Push` physics diagnostic.


## Classroom release deploy

Deployment is intentionally version-gated. Pushing to `main` does not deploy; only a tag that matches `package.json` deploys. The native Cloudflare Workers Builds Git integration for Worker `ms` must remain disconnected so it cannot publish directly from a branch.

Before tagging, open Worker `ms` in the Cloudflare dashboard, select **Settings
-> Builds**, and disconnect the Git repository. GitHub Actions is the only
release publisher. Also open **Web Analytics**, manage `motionsmith.org`, and
set **Automatic setup** to **Disable** (or delete that Web Analytics site).
Otherwise Cloudflare injects `static.cloudflareinsights.com` and `/cdn-cgi/rum`
into the checked static shell. `bun run test:cloudflare-live` rejects both.

```bash
# after committing the release
VERSION=$(bun -p "require('./package.json').version")
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

The workflow verifies `v$VERSION == package.json.version`, runs the complete checked unit manifest, and exercises the focused diagnostics preview, including WebGL recovery and optional Rapier loading. It then creates and checks two fresh production artifacts:

- `VITE_BASE_PATH=/ms/` deploys to the `github-pages` environment as the compatibility mirror.
- `VITE_BASE_PATH=/` deploys last to Worker `ms` through the `cloudflare-production` environment and `wrangler.jsonc`.

Both artifacts must pass the bundle and image-recognition exclusion gates. GitHub repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` authorize the final Wrangler deployment. The token must be restricted to the required Workers script and `motionsmith.org` route permissions.

To validate the declarative Worker configuration without publishing:

```bash
bun run build
wrangler deploy --dry-run --config wrangler.jsonc
```

## Classroom release checklist

Before a teacher-facing web release:

- Tag must be `v<package.json version>`; the workflow must reject mismatched tags.
- The primary artifact must use `VITE_BASE_PATH=/` for `https://motionsmith.org/`; the mirror must use `VITE_BASE_PATH=/ms/` for `https://alansynn.com/ms/`.
- Cloudflare Worker `ms` must use the `motionsmith.org` custom domain, and native branch-triggered Workers Builds must remain disconnected.
- Cloudflare Web Analytics automatic setup must be disabled for `motionsmith.org`; the live gate must observe no injected analytics beacon or RUM request.
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

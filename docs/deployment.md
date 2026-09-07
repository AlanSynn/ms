# Deployment

Editing, project files, search, screenshot preparation, and bundled release notes work locally after the app assets load. Explicit feedback submission/status checks use the optional one-Worker relay described in [Feedback relay](feedback-relay.md); GitHub is the public issue and native-attachment destination. The default web build is rooted at `/`; the GitHub Pages release build sets `VITE_BASE_PATH=/ms/` so MotionSmith loads from `https://alansynn.com/ms/`. Tauri builds keep relative `./` assets.

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
- Ordinary browser QA must show no `/api/` requests, server login, project upload, cloud sync, roster, analytics, dashboard, or hosted storage calls. Only explicit Feedback Send/status/retry actions may call the configured Worker `/feedback` endpoint.
- About/help copy must state that projects stay local: no account, no project upload, browser autosave, and local downloads. Feedback is public and sent only on an explicit action; image recognition remains excluded.
- Configure repository variable `VITE_FEEDBACK_ENDPOINT` with the non-secret Worker `/feedback` URL before a feedback-enabled release. Do not place a GitHub token in any `VITE_*` variable. An absent endpoint leaves editing/search/notes available and keeps feedback drafts with a setup message.
- Teacher pack workflow stays file-based: teacher shares a project/package, students edit locally, then download snapshot, blueprint files, and assembly guide.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench. The approved narrow feedback exception is one Cloudflare Worker, Worker-only secrets, and existing public `AlanSynn/ms` issues/native attachments. It is independent of project editing and requires no image store, database, queue, Durable Object, attachment-serving service, container, additional repository, or per-report Actions job. Other required-server features remain excluded: general backend/API services, cloud database, auth/RBAC, billing, team accounts, realtime collaboration, hosted asset storage, server inference, and server export jobs. Image recognition is also excluded from shipped clients. Use guided starters, explicit local packages, browser autosave, local snapshot downloads, and bundled/static assets instead of fake cloud surfaces.

For local production-preview QA, set the same base on build and preview:

```bash
VITE_BASE_PATH=/ms/ bun run build:e2e
VITE_BASE_PATH=/ms/ bun run preview -- --host 127.0.0.1 --port 4175
```

Release-note maintenance and verification are described in [Student support](student-support.md). Worker deployment and credential verification are separate from a Pages tag release; do not assume either deployment has occurred from a successful local build.

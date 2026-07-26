# Deployment

The editor remains local-first and keeps working offline. The default web build is rooted at `/`; the GitHub Pages release build sets `VITE_BASE_PATH=/ms/` so MotionSmith loads from `https://alansynn.com/ms/`. Tauri builds keep relative `./` assets and study telemetry off unless explicitly configured.

## Build

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

`vite build` copies the 34.3 MB quality-gated INT8 ORT asset from
`public/onnx/` into `dist/onnx/`. The retained FP32 source and fixed calibration
inputs live under `models/`; CI and release builds pull only
`public/onnx/pose_model.int8.ort`. Regenerate and verify it with
`scripts/quantize-pose-model.py` using the tool versions recorded in
`models/pose-model-int8.json`.


## GitHub Pages release deploy

Deployment is intentionally version-gated. Pushing to `main` does not deploy; only a tag that matches `package.json` deploys.

```bash
# after committing the release
VERSION=$(bun -p "require('./package.json').version")
git tag v$VERSION
git push origin main
git push origin v$VERSION
```

The workflow fetches only the Git LFS INT8 runtime, rejects pointer files and
models outside the 1–40 MB release bound before and after build, verifies
`v$VERSION == package.json.version`, runs contracts plus the production-preview
study browser gate, and builds with `VITE_BASE_PATH=/ms/`. Only then does it
deploy and smoke-check the `/ms-study/v1` Cloudflare Worker before publishing
`dist/` with GitHub Pages Actions.

Study deployment controls:

- Repository variable `STUDY_PROFILE`: `off`, `metrics`, `replay`, or `study` (tagged study release default). `metrics` excludes edits/snapshots/images; `replay` adds semantic edits and chunked snapshots; `study` adds gestures and normalized imported images.
- Repository variables `STUDY_CLASS_ID`, `STUDY_SESSION_ID`, and optional pseudonymous `STUDY_TEAM_ID`.
- Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `STUDY_GITHUB_TOKEN` (one repository, Issues write), and `STUDY_ADMIN_TOKEN`.
- Create private R2 bucket `motionsmith-study` once before first deploy. Keep `GITHUB_TOKEN` and `ADMIN_TOKEN` only as Worker secrets.
- Every batch records deployment tag, app version, Git commit, event schema, snapshot schema, and project-state version. The ingest limiter uses independent participant and transient IP-derived keys: participant is primary, while the looser IP bucket remains a shared-school-NAT abuse backstop. Neither key is stored.

## Study Worker deploy tooling rule

Auth for the `/ms-study/v1` Worker stays in one place — the Cloudflare CLI (`cf`) OAuth — and `wrangler` reuses it as an API token. Do not run `wrangler login`.

- Authenticate once: `cf auth login`. OAuth lives at `~/Library/Preferences/.cf/auth.jsonc`; `cf auth whoami` confirms it.
- Reuse the `cf` OAuth from `wrangler` (no separate token, no `wrangler login`):

  ```bash
  cd infrastructure/study
  export CLOUDFLARE_API_TOKEN="$(python3 -c 'import json;print(json.load(open("/Users/alansynn/Library/Preferences/.cf/auth.jsonc"))["oauth_token"])')"
  export CLOUDFLARE_ACCOUNT_ID="5af02c4a8b7da8e437893615cdb42b87"
  bunx wrangler@4.112.0 deploy
  ```

- Deploy with `wrangler deploy`, **not** `cf deploy`. `cf deploy` forces the experimental `cloudflare.config.ts` format (`@cloudflare/config` README: "not yet stable enough for external use"), so for this production Worker `wrangler deploy` with stable `wrangler.toml` is the path; `wrangler` is a dev-only dependency here.
- `cf` has no command for R2 objects, KV, Worker secrets, or ratelimit namespaces, so those go through `wrangler` or the Cloudflare API with the same OAuth bearer:
  - R2 bucket: created once via the R2 API with the `cf` OAuth bearer (bucket `motionsmith-study`).
  - Worker secrets (`GITHUB_TOKEN`, `ADMIN_TOKEN`): `printf '%s' <value> | bunx wrangler@4.112.0 secret put <NAME>` with the OAuth token exported as above.
  - Ratelimit namespaces: `wrangler.toml` pins `namespace_id` (`1784212861` ingest, `1784212862` bug); wrangler 4.x requires it and does not auto-provision.

## Classroom release checklist

Before a teacher-facing web release:

- Tag must be `v<package.json version>`; the workflow must reject mismatched tags.
- Build must use `VITE_BASE_PATH=/ms/` for `https://alansynn.com/ms/`.
- Repository variable `STUDY_PROFILE` must be `study` for the full approved
  classroom capture profile.
- `bun run test:study:browser` must pass before the release build.
- `public/onnx/pose_model.int8.ort` and `dist/onnx/pose_model.int8.ort` must be real ONNX bytes, not Git LFS pointers.
- Runtime HTML must not load CDN scripts, import maps, or external `https://` assets.
- Browser QA must show no server login, cloud sync, roster, dashboard, or runtime calls except the selected `/ms-study/v1` telemetry profile.
- About/help copy must state: no account, no upload, local ONNX, browser autosave, local downloads.
- Teacher pack workflow stays file-based: teacher shares a project/package, students edit locally, then download snapshot, blueprint files, and assembly guide.

## CDN policy

`index.html` must not contain CDN scripts, import maps, or external `https://` runtime URLs. Dependencies are bundled through Vite from `package.json`.

## Local-first scope

MotionSmith ships as a static browser/Tauri workbench plus one narrow study boundary. `/ms-study/v1` accepts tokenless pseudonymous batches, compact imported source images, and explicit private bug reports; it never becomes project save/sync, auth, collaboration, inference, or export infrastructure. All other required-server features remain excluded.

# Study collector

One Cloudflare Worker handles the approved study-only boundary:

- `POST /ms-study/v1/batch` — compressed semantic records and replay snapshots.
- `POST /ms-study/v1/asset` — compact imported character/object pixels.
- `POST /ms-study/v1/bug` — explicit private bug report, optional display capture, Worker-only GitHub issue creation.
- `GET /ms-study/v1/admin/*` — bearer-protected session/asset/bug retrieval.

The browser receives no GitHub or Cloudflare credential. Public writes require
`Origin: https://alansynn.com`, validate bounded schemas, and store no IP or
request headers. Cloudflare rate-limit bindings use a transient hash of the
connecting IP only as a limiter key; the Worker never logs or writes it.
`STUDY_BUCKET` objects have no lifecycle rule; retention is indefinite until an
administrator deletes them.

Imported character/object pixels are normalized off the interaction path to
WebP/PNG, at most 512 px on the long edge and 192 KiB. Everything else uses
semantic events and de-identified `ProjectState` snapshots. Large snapshots are
chunked, so replay does not lose complex projects. Batches carry app version,
deployment tag, Git commit, event schema, snapshot schema, and project version.

Profiles are build-time controls: `off` sends nothing; `metrics` sends session,
workflow, validation, and export records; `replay` adds edits and snapshots;
`study` also adds gestures and imported pixels. Delivery is activity-driven,
compressed, durable through IndexedDB, and silent while idle. Project replacement
and page exit also keep one de-identified local emergency checkpoint until its
outbox transaction commits.

## One-time setup

```bash
bunx wrangler@4.112.0 r2 bucket create motionsmith-study
cd infrastructure/study
bunx wrangler@4.112.0 secret put GITHUB_TOKEN
bunx wrangler@4.112.0 secret put ADMIN_TOKEN
bunx wrangler@4.112.0 deploy
```

`GITHUB_TOKEN` must be repository-scoped with Issues write only. Prefer a
private triage repository when reports may contain student-entered text.
Deployed reports create issues through the Worker. Local/Tauri builds open a
prefilled GitHub draft instead and omit the optional email from the public URL.

## Replay

List sessions:

```bash
curl -H "Authorization: Bearer $STUDY_ADMIN_TOKEN" \
  "https://alansynn.com/ms-study/v1/admin/sessions?deployment=v0.0.9"
```

Create a self-contained replay page:

```bash
STUDY_ADMIN_TOKEN=... bun run study:replay -- \
  --deployment v0.0.9 --session ses_<uuid> --out replay.html
```

Use `--context ctx_<uuid>` to isolate one browser tab. Output is created with
mode `0600` and is not overwritten unless `--force` is present.

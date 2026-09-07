# MotionSmith feedback relay

The only feedback destination is public issues in **AlanSynn/ms** (numeric repository ID `1283287676`). A student sends a problem or idea from MotionSmith without an account. GitHub posts the issue under the configured relay credential's identity. The message and included screenshot are public; the form says `Posted publicly. Leave out names.`

The resource inventory is the existing static MotionSmith app, one Cloudflare Worker with two secrets and built-in rate-limit bindings, and the existing GitHub repository with native GitHub attachments. There is no R2 bucket, database, KV, queue, Durable Object, attachment-serving route, container, extra repository, or per-report Actions workflow. The feedback exception does not add project storage, accounts, analytics, or another backend feature.

## Request boundary

`VITE_FEEDBACK_ENDPOINT` contains only the full public URL `https://<worker-host>/feedback`. Both actions use `POST /feedback` with JSON; `OPTIONS /feedback` handles CORS. Other paths, query strings, and methods are rejected. Repository selection, credentials, issue formatting, category policy, and upload destinations stay in the Worker.

The public types and limits are in `shared/feedbackProtocol.ts`:

```ts
// The UUID is created once for an intended report and retained for retries.
{
  action: 'submit',
  submissionId: '<UUID v4>',
  category: 'problem' | 'idea',
  message: '<required plain text>',
  context: {
    version: '<app version>',
    stage: '<current stage>',
    viewport: { width: 1366, height: 768 }
  },
  screenshot?: { mime: 'image/png', base64: '<image bytes>' },
  receipt?: '<Worker-signed retry receipt>'
}
```

The client calculates `feedbackPayloadDigest(payload)` before its first request and keeps it with the draft. A status check sends `{action:'status', submissionId, payloadDigest}` to the same endpoint. It sends no screenshot bytes. An optional receipt on a status request is unnecessary; status recovery remains available after the receipt expires.

The service accepts only known fields. Messages are limited to 2,000 characters; PNGs to 1,500,000 decoded bytes, a 1,600-pixel edge, and 2,000,000 pixels. Total request bytes are bounded while reading the stream, independently of Content-Length. Image validation checks signature, chunk lengths/order/CRCs, RGB/RGBA 8-bit non-interlaced headers, bounded zlib decompression, complete scanlines, valid row filter values, and IEND with no trailing data. This deliberately supports the app's canvas-generated PNGs. The client removes browser-added EXIF before submission without changing pixels; the Worker continues to reject it. SVG, HTML, JPEG, animation, text metadata, and client-selected remote URLs are excluded.

Capture, drafting, searching, navigation, and bundled notes make no feedback request. Capture happens locally before the form covers the view, and the student can preview or remove it. Only explicit Send or status/retry actions contact the relay. The app retains failed drafts and screenshots in session memory; support state is outside project serialization and undo history. On confirmed delivery or explicit discard, the app releases temporary object URLs and draft buffers. Closing the panel preserves the pending draft. The Worker retains bytes only while handling the request and has no image history, scheduled cleanup, or content logs.

## Native GitHub integration

The isolated upload helper follows the released [GitHub CLI v2.99.0 client](https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go) and [host selection](https://github.com/cli/cli/blob/v2.99.0/internal/ghinstance/host.go):

```http
POST https://uploads.github.com/user-attachments/assets?name=...&content_type=image%2Fpng&repository_id=1283287676
Authorization: token <Worker secret>
Accept: application/vnd.github+json
Content-Type: application/octet-stream

<raw PNG bytes>
```

The fixed-length byte body lets the Worker runtime set Content-Length. The helper accepts a 2xx response only with valid JSON and a nonempty, strictly validated `https://github.com/user-attachments/assets/<id>` URL. It rejects credentials, query strings, fragments, other hosts, and unexpected paths in that URL. Credentialed GitHub requests use `redirect: 'manual'` and explicitly reject every 3xx response without following Location. This prevents forwarding Authorization even when a redirect names another GitHub path. The tested workerd runtime does not implement `redirect: 'error'`; Cloudflare's default follow behavior would [forward headers across redirects](https://developers.cloudflare.com/workers/runtime-apis/request/), including Authorization.

After upload succeeds, the Worker creates `POST https://api.github.com/repos/AlanSynn/ms/issues`. It accepts **201**, a matching issue reference, the expected body, and the configured posting identity as confirmed creation. The body contains inert student text, app version/stage/viewport, the included native attachment, and a signed submission marker. The issue title is derived from category/message; title mentions are neutralized. The student's text is enclosed in a code fence longer than any fence they entered, so it cannot inject images, HTML, or mentions into the issue body.

One Send action can therefore make several HTTP requests. Upload and issue creation are not an atomic GitHub transaction. Uploaded image bytes alone, a local draft, 202 Accepted, or a malformed creation response do not produce `Sent`. No `gh` executable, cookie/session upload flow, browser automation, container, or Actions runner is used by the Worker. This first-party implementation is an integration reference, not an independently versioned long-term attachment API guarantee.

## Credentials and owner setup

| Name | Location and purpose |
| --- | --- |
| `GITHUB_FEEDBACK_TOKEN` | Worker secret; never a frontend variable, asset, source map, project field, or desktop credential |
| `FEEDBACK_RECEIPT_SECRET` | Worker secret; at least 32 random bytes, used for signed receipts/markers and ephemeral rate keys |
| `GITHUB_OWNER` / `GITHUB_REPO` | Trusted Worker config; fixed to `AlanSynn` / `ms` |
| `GITHUB_REPOSITORY_ID` | Trusted Worker config; pinned to `1283287676`; never accepted from the client |
| `ALLOWED_ORIGINS` | Exact trusted origins; production defaults to `https://alansynn.com` |
| `VITE_FEEDBACK_ENDPOINT` | Public frontend submission URL ending `/feedback`; contains no secret |

Issue creation and upload require separate verification. [The issue API](https://docs.github.com/en/rest/issues/issues#create-an-issue) documents **Issues: write** for fine-grained PATs and GitHub App tokens. [Attachment documentation](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli) requires push access. The [released attachment tests](https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client_test.go) allow OAuth, classic PAT, and fine-grained PAT credentials and WRITE/MAINTAIN/ADMIN repository access; they reject App user and installation tokens. The announcement does not establish every fine-grained token permission required by the direct upload request.

Prefer a dedicated fine-grained PAT restricted to AlanSynn/ms, owned by an account with repository write access. Configure Issues: write and prove a small synthetic direct upload with that credential before relying on it. Record any additional permission actually needed; do not silently broaden to an account-wide classic token, Contents write, Actions, or Administration. The exact minimum fine-grained upload permission remains a setup verification item. GitHub Actions' short-lived `GITHUB_TOKEN` is not the Worker's credential.

From the repository root, the owner can validate and deploy the one Worker using Wrangler 4.112 or newer. The configuration pins compatibility date `2026-07-21`, which the local Wrangler 4.112 runtime successfully launched. A newer calendar date is not needed by this code; it must not be raised beyond the tested runtime's support merely to match the release date.

```sh
bunx wrangler@4.112.0 deploy --dry-run --env="" --config workers/feedback/wrangler.toml
bunx wrangler@4.112.0 deploy --env="" --config workers/feedback/wrangler.toml
bunx wrangler@4.112.0 secret put GITHUB_FEEDBACK_TOKEN --env="" --config workers/feedback/wrangler.toml
bunx wrangler@4.112.0 secret put FEEDBACK_RECEIPT_SECRET --env="" --config workers/feedback/wrangler.toml
```

Enter secrets through Wrangler's secure prompt or the Cloudflare dashboard, never chat or source files. Generate the receipt secret with a password manager or cryptographic random generator. The first deployment fails closed for feedback requests until both secrets are installed. `wrangler secret put` publishes a new Worker version immediately; `wrangler versions secret put` can stage a version when a separate deployment step is wanted. See [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

For local development only, put temporary diagnostic credentials for synthetic work in the ignored `workers/feedback/.dev.vars.development` file, restrict its permissions, and run `bunx wrangler@4 dev --local --env development --config workers/feedback/wrangler.toml`. The example file contains names with empty values. The development configuration allows explicit localhost/127.0.0.1 ports 4175, 5173, 5174, and 5177. Do not deploy the development environment as another Worker. Remove temporary diagnostic credentials after testing.

If desktop submission is enabled, add only the exact Tauri origin observed for that distribution to the trusted origin list, such as `tauri://localhost` or `http://tauri.localhost`; do not allow `null` or wildcard origins. The static/browser and desktop editor still load and edit without a reachable relay. Set the public frontend endpoint when building the approved release; this document does not claim that a Worker has been deployed or that production configuration is complete.

Rotate the GitHub token by preparing and testing a replacement with both permissions, installing it as the same Worker secret, verifying a bounded synthetic report, and revoking the old token. Keep the receipt secret and posting account unchanged for ordinary token rotation so pending receipts and issue markers remain verifiable. Rotating the receipt secret invalidates old signatures; changing accounts prevents status matching against the old posting identity. Coordinate either change with pending reports. Never collect or print either secret during troubleshooting.

## Recovery, rate limits, and retention

If upload succeeds and issue creation receives a definitive rejection, the Worker returns a signed receipt with the fixed repository, submission ID, canonical payload digest, validated native URL, phase, and 24-hour expiry. A student-initiated retry reuses that upload. The screenshot stays in the local draft, and its original bytes remain bound to the canonical digest; changing or removing it invalidates that receipt.

An issue-create timeout, connection loss, redirect, 5xx, or incomplete success response leaves delivery **unknown**. Preserve the draft and offer **Check status**. The Worker searches the newest 300 repository issues, including closed issues, for a signed marker from the current relay identity. The marker binds the exact native image URL (or text-only outcome), submission ID, and payload digest. Missing/replaced images, different authors, or different payloads cannot establish delivery. A positive match returns the existing issue receipt. An absent result is not proof of failure and never authorizes automatic recreation. Keep unknown reports in status-check mode; do not silently discard or resend them.

Receipts, issue-list checks, and panel disablement are not a global lock. Two concurrent initial requests can both create an issue; the regression suite demonstrates this residual limitation. There is no exactly-once guarantee across requests or locations, and no database/queue is introduced to claim one. An upload whose response is lost can also leave an orphan; the Worker has not attempted issue creation in that case and reports an attachment failure rather than success.

The built-in rate limits allow 120 requests per minute for a shared network and six per submission ID. Network keys are HMAC-derived from the Cloudflare-provided address and UTC day; raw addresses are not stored or logged by this code. This permits an ordinary class of 30 devices to submit through one network. These are abuse limits, not authentication or student tracking. [Cloudflare's rate limiter](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is per-location and eventually consistent. Origin/CORS checks likewise do not authenticate clients. Upstream rate-limit rejection preserves the draft and returns retry timing. No CAPTCHA, account, or analytics service is added.

GitHub is the durable content destination. The relay never deletes a successfully posted image. [The CLI lifecycle contract](https://github.com/cli/cli/blob/v2.99.0/internal/attachments/doc.go) says uploads cannot be undone; no attachment-deletion endpoint or automatic orphan cleanup has been established. Deleting/editing an issue must not be represented as guaranteed attachment deletion. Maintain only ordinary manual repository moderation; report text is untrusted and must not drive issue-triggered code execution. A GitHub image proxy cache is not proof of uploading the original; test the actual native asset while logged out.

## Verification record

`bun tests/feedback-worker.test.ts` covers the native byte/URL/header contract, strict request/image validation, CORS and fixed destination, missing/expired credentials, rate rejection, safe formatting, signed receipts, restart-safe upload reuse, image removal/tampering, lost creation responses, positive recovery, incomplete receipts, and the concurrent-delivery limitation. These are synthetic transport tests, not live delivery evidence.

The session's direct-HTTP OAuth diagnostic created [synthetic issue #7](https://github.com/AlanSynn/ms/issues/7) and [its native attachment](https://github.com/user-attachments/assets/f7e021a6-2bb1-4eb8-b6fa-06881611f54e). The record is `artifacts/student-support/native-upload-diagnostic.json`; logged-out HTML and downloaded PNG are stored alongside it. The downloaded PNG SHA-256 is `ad038084616e3aab23ccb4d7c7e431462bb64d1811f019ba6257ce3605e3b272`. An initial unauthenticated image request briefly returned 404 before a later 200 with matching bytes; an immediate 404 is therefore not sufficient evidence of a permanent attachment failure.

That diagnostic proves the existing OAuth credential's direct HTTP upload/issue path only. The local Worker has subsequently launched under Wrangler 4.112 with compatibility date `2026-07-21`; a local runtime launch alone is not delivery evidence. App-to-local-Worker issue/image receipts are recorded separately in the root implementation report as they are verified. They must not be described as proof of a dedicated fine-grained credential or a deployed Cloudflare Worker.

The first app submission through the local Worker failed during its read check before upload or issue creation because workerd rejected the unsupported `redirect: 'error'` option. An isolated local read-only probe reproduced that TypeError for direct, detached, and bound fetch calls. Changing the probe to manual mode produced 200 with valid JSON for both GitHub user and fixed-repository issue-list reads in all three modes. The production helper now uses manual mode and rejects all redirects explicitly. The probe process and its temporary restricted-permission credential copy were removed after verification; no issue or image was written by that probe.

The implemented app subsequently sent [problem #8](https://github.com/AlanSynn/ms/issues/8), [idea #9](https://github.com/AlanSynn/ms/issues/9), and [explicit text-only report #10](https://github.com/AlanSynn/ms/issues/10) through the local Worker. #8 contains the app's actual Foundry screenshot; #9 removed its screenshot before sending. The #8 receipt was deliberately lost in the browser, then positively recovered after a Worker restart without another issue. Its public native image still returned identical bytes after the submitting Orca browser view was closed and the Worker stopped. Temporary diagnostic credentials and probe terminals were removed.

The [student support evidence ledger](student-support.md#verification-ledger) links the live receipts and records capture sources, hashes, project comparison, and local `/ms/` verification. These live GitHub receipts establish the app → local Worker → native attachment/issue path under the existing diagnostic OAuth identity. They do not verify a dedicated fine-grained credential or a deployed Cloudflare origin. No Worker or Pages deployment occurred; those configuration and release checks remain owner setup.

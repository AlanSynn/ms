# Independent MotionSmith site

Remote setup record, 2026-10-02 UTC: Workers/Builds Free was verified with the restricted user token. The dedicated static Worker, `motionsmith.org` Custom Domain and main-only Git trigger are connected. Both workers.dev and domain HTTPS passed real Save/Open/history and WASM smoke checks. The existing feedback relay now accepts both exact site origins; its script fingerprint and other settings were preserved. The owner merged PR #20 at `471503194f061199071387d61d31eb62da6657e2`. Live checks then required the two corrections documented below; their owner-reviewed merge supplies a real main push for automatic deployment verification. Check current build outcomes and commit identifiers with the status command before claiming a new push is deployed.

## Architecture and cost gate

The prepared configuration is Workers Free, assets-only Workers Static Assets, and Cloudflare-native Workers Builds from `AlanSynn/ms` `main`. `deploy/cloudflare/wrangler.jsonc` targets only `motionsmith-site` in account `5af02c4a8b7da8e437893615cdb42b87`. The custom domain is `motionsmith.org`, zone `5237dc6855080ab390b6fb016941371c`. There is no Worker execution entrypoint, server storage, Cloudflare Vite plugin or new dependency. Only Vite `dist` is uploaded. Ordinary editing remains local.

Actual Workers/Builds Free billing passed the setup gate. Cloudflare documents unlimited free static asset requests and no additional asset storage charge. Free native Builds has a capped allowance; Paid native Builds can incur overage. Recheck the account before setup mutations; a Free Website zone, `default_usage_model: standard`, and an existing free allowance do not establish zero additional cost. [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

| Workers Free limit | Current documented allowance |
| --- | --- |
| Static files per version | 20,000 |
| Individual static file | 25 MiB |
| Workers per account | 100 |
| Build minutes | 3,000/month, shared across account |
| Concurrent builds | 1/account |
| Build duration | 20 minutes |
| Build machine | 2 vCPU, 8 GB RAM, 20 GB disk |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Build limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

The quota API reports `has_reached_build_minutes_limit` and `build_minutes_refresh_on` only for non-paid plans. Setup refuses an exhausted allowance and resumes after its reported refresh. Exhaustion does not authorize paid usage; the existing static deployment remains independently served. The exact HTTP rejection code and treatment of an already-running build at exhaustion were not verified. [Quota API](https://developers.cloudflare.com/api/resources/workers_builds/methods/get_account_limits/).

The initial Wrangler OAuth token lacked billing, Builds quota and DNS read access. The first supplied account-owned token was rejected by Builds with HTTP 401 / code `12006`. Its replacement user-owned token is active and reads subscriptions and quota: no Workers/Builds subscription appears, `has_reached_build_minutes_limit` is false, and the Free-only refresh field is `2026-10-31T23:59:59.999Z`. These fields establish the account's non-paid Builds plan; no trial/credits, paid Workers/Builds, payment method, upgrade or downgrade was enabled. The unrelated existing R2 subscription remains untouched and is not used by this site. Before setup, the zone had no DNS records or connected domains. [Builds authentication](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), [Free-only quota fields](https://developers.cloudflare.com/api/resources/workers_builds/methods/get_account_limits/).

If billing proves the account uses paid Workers, do not downgrade unrelated services or enable paid Builds. Evaluate a single Git-connected Pages project instead: Free Pages has 500 builds/month, one concurrent build, 20-minute builds, 20,000 files and 25 MiB/file; static requests are free. Create it with Git integration from the outset, never Direct Upload. No Pages fallback project was created. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Direct Upload limitation](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Deployment without a local .env

The local `.env` is optional setup authentication only. Setup accepts `CLOUDFLARE_API_TOKEN`, the local `CF_TOKEN` alias, an explicitly selected private token file, or existing Wrangler OAuth. It never writes a credential to source, frontend variables, receipts or logs. `.env` is already Git-ignored and never included in the deployment artifact.

Native Builds runs `bun --no-env-file scripts/build-cloudflare-site.mjs` and the configured Wrangler deploy command. It does not run the local account preflight helper or read a local `.env`. The build removes setup/deployment credentials from install and Vite subprocess environments and disables Bun dotenv loading in those subprocesses. Local builds take the public feedback endpoint from the same checked-in build specification, so its availability also does not depend on `.env`. Only public base-path, Bun and existing feedback endpoint values belong in the native build configuration.

After the dedicated deployment and free-plan checks, `bun scripts/connect-cloudflare-site-builds.mjs register-token` selects an explicitly supplied existing build-token UUID, reuses the supplied credential's registration, or registers that same existing restricted user token in Cloudflare's Builds token store. This uses the documented API and creates no API token or permission policy. Registration succeeded; the local receipt keeps only its non-secret UUID. The `.env` file can be deleted after setup; Cloudflare retains the deployment credential for subsequent Git builds. Keep that API token active, or replace the registered build credential before revoking it. Manual management commands still require operator authentication. [Build token registration](https://developers.cloudflare.com/api/resources/workers_builds/subresources/tokens/methods/create/), [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

An isolated copy of the current source with no `.env` and no Cloudflare credential environment passed frozen installation, the production build, exclusion guards and bundle budget. With the same commit identifier, its 140 non-version files match the previously tested candidate byte for byte. Evidence: `artifacts/site-validation/no-env-build.json` and `no-env-build.log`.

## Preserved deployment and project files

The GitHub workflows, GitHub Pages DNS/settings, custom domain, tag policy, `/ms/` base, lockfile and Vite configuration remain unchanged. The existing feedback Worker is reused; its production allowlist gained only `https://motionsmith.org`, retaining `https://alansynn.com`. Both origins return OPTIONS 204 with exact CORS; a hostile lookalike returns 403. No GitHub issue was created by verification.

`.motionsmith` Save/Open and the existing serializer, import validation, migrations, integrity checks and limits remain authoritative. Current-only projects allow 12 MiB; portable bundles with history allow 48 MiB, with existing per-snapshot, artwork and history resource limits still enforced. No runtime caches or session state were added to the file format. Project help says: “Autosave is separate for each site. To move your work, save a project file from the original site and open it on the other site.”

Changed files:

- Deployment: `deploy/cloudflare/wrangler.jsonc`, `deploy/cloudflare/headers`, `deploy/cloudflare/builds.json`.
- Operations: `scripts/build-cloudflare-site.mjs`, `scripts/cloudflare-site-account.mjs`, `scripts/cloudflare-site.mjs`, `scripts/connect-cloudflare-site-builds.mjs`, `scripts/cloudflare-feedback-origin.mjs`.
- Validation: `scripts/prepare-site-validation.mjs`, `scripts/site-portability-fixture.ts`, `scripts/validate-site-portability.ts`, `scripts/smoke-cloudflare-site.ts`.
- Help and relay: `components/stages/project/ProjectStage.tsx`, `utils/contextHelp.ts`, `workers/feedback/wrangler.toml`.
- Tests: `tests/cloudflare-site.test.ts`, `tests/feedback-worker.test.ts`, `tests/project-contract.test.ts`, `scripts/run-unit-tests.mjs`.
- Contract and documentation: `AGENTS.md`, `docs/deployment.md`, `docs/cloudflare-site.md`.

No Tauri configuration changed; desktop binaries were not built or installed during this task.

## Local validation

Use **Bun 1.3.14**, from the existing package manager pin. The installed Homebrew Bun was 1.4.2, so validation used the official 1.3.14 binary under `/tmp/ms-bun-1.3.14/bun-darwin-aarch64/`. Set that directory first on `PATH` when rerunning locally. Installed tools inspected: `/opt/homebrew/bin/cf` 0.2.0, `/opt/homebrew/bin/wrangler` 4.112.0. `cf` is unauthenticated and its saved zone is `alansynn.com`; do not use that default. Wrangler OAuth belongs to the expected account. Compatibility date `2026-07-21` matches its installed local runtime.

```sh
bun install --frozen-lockfile
bun run test:all
bun run test
bun tests/cloudflare-site.test.ts
bun tests/project-file-authority.test.ts
bun tests/import-state-safety.test.ts
bun tests/version-portable.test.ts
bun scripts/prepare-site-validation.mjs
MS_EXISTING_COMMIT=b7b10a4fcdacb7c0bb65e05335a69a397215719b bun scripts/validate-site-portability.ts
bun scripts/cloudflare-site.mjs dry-run
```

`prepare-site-validation.mjs` identifies the last successful GitHub Pages deployment through deployment/status APIs, reads live HTML, builds that exact commit in a disposable archive, and requires its main bundle to equal the live bundle byte for byte. It builds candidate `/ms/` and `/` output separately. The repository build, exclusion guards and bundle budget are reused. Evidence and all three builds stay under ignored `artifacts/site-validation`; production `dist` ends as the root Cloudflare build. The build copies Cloudflare-specific cache rules into `dist/_headers` without adding them to the shared public assets.

```sh
WRANGLER_SEND_METRICS=false wrangler dev --local --config deploy/cloudflare/wrangler.jsonc --port 8792 --ip 127.0.0.1 --no-live-reload --show-interactive-dev-session=false
# In a separate terminal:
bun scripts/smoke-cloudflare-site.ts http://127.0.0.1:8792/
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=5187 PLAYWRIGHT_WORKERS=3 bunx playwright test tests/browser/file-recovery-safety.spec.ts tests/browser/earlier-versions.spec.ts
```

| Check actually run | Result |
| --- | --- |
| Three ordinary production builds using Bun 1.3.14 | Pass; TypeScript, source/dist exclusion and feedback boundary |
| Root bundle budget and static asset limits | Pass; 141 files, all below 25 MiB |
| Isolated build without `.env` or Cloudflare credential environment | Pass; frozen install, production build, bundle budget and matching non-version assets |
| A: candidate `/ms/` → root → candidate `/ms/` | Pass through real downloaded Save/Open files and an authored rotation edit |
| B: deployed release → candidate → deployed release | Pass through real downloaded Save/Open files and an authored rotation edit |
| Six fresh contexts on three distinct localhost origins | Pass; no copied browser storage, console or network errors |
| Browser import Worker, lazy stages, Rapier 0.19.3 | Pass on all six legs; actual WASM instantiated once after Push |
| Recovery and retained-history browser suites | 11 passed using three workers and production preview |
| Feedback CORS tests | 26 checks passed; exact two origins, hostile variants rejected, no real issue requests |
| Pre-commit regression suites | All six passed; hook remains enabled |
| Cloudflare Wrangler dry-run | Pass; explicit config, no application bindings |
| Cloudflare local runtime smoke | Pass; startup, real Save/Open/history, help, playback/scrub, WASM, MIME and caching |
| Missing required JS chunk | HTTP 404; no HTML fallback |
| Index and version freshness | Index `no-cache`, version JSON `no-store`; hashed assets immutable |
| Dedicated workers.dev HTTPS preview | Pass; reviewed build `0d0db41d`, real Save/Open/history and WASM |
| Real `motionsmith.org` HTTPS | Pass after HTML cache correction; build `47150319` plus the focused corrections |
| Existing feedback relay settings PATCH | Pass; other seven bindings/settings and script ETag unchanged, exact CORS verified |
| Existing pull-request CI for PR #20 | Pass; contracts, production build/budget and browser recovery checks |
| All unit files run individually | 63/65 passed; two failures reproduced from clean starting commit |
| `bun run test:all` and `bun run test` | Fail at existing `b695-fit.test.ts` hash assertion |

The other existing failure is `four-bar-fit-retention.test.ts`. Both hashes differ identically in a clean archive of `a3d50005`; assertions were not changed. Relevant project-file, import safety, version, deployment contract and added Cloudflare tests pass. These unresolved baseline failures prevent a fully green repository verification claim.

Existing deployed version: **0.0.18**, commit **b7b10a4fcdacb7c0bb65e05335a69a397215719b**, successful deployment **6378825217**, release workflow run **34516389838**. The live bundle `/ms/assets/index-Qa8nmt3s.js` SHA-256 is `71d16b12b54d1576c0eabc0f0951a50425069cfd24eb5753f244b3bcc086f52a`, matching the rebuilt bundle. This release predates `version.json`; its 404 is not evidence that the app is unavailable. Candidate version is **0.0.18**; its build ID follows the current review-branch commit. Initial validation used **a3d50005** plus these source changes; current exact commit/build identifiers are recorded by `build-evidence.json` and the portability report. Compatibility is proven for this release/candidate pair, not future schema evolution.

The synthetic file contains 14 textured character parts, skeleton/anchors, painted artwork, an embedded scene object, two motion paths, timeline, accepted fitted mechanism/output binding, settings and one historical snapshot with embedded assets. The harness compares supported resumable `ProjectState` fields and exact retained history before and after editing. Existing recovery tests cover cancellation, corrupted/future/oversized/source-dependent imports and denied storage while preserving current work and last-good autosave.

Inspectable evidence: `artifacts/site-validation/build-evidence.json`, `portability/report.json`, downloaded `.motionsmith` files, `browser-files.log`, `unit-results.json`, both `baseline-*.log` files, `precommit.log`, `feedback-cors.log`, `cloudflare-dry-run-final.log` and `artifacts/cloudflare-site/smoke/report.json`. Generated evidence is deliberately not committed. The final dry-run rebuild's 140 non-version assets match the tested root artifact byte for byte; only the generated version timestamp changed.

## Rerunning remote setup

1. Use a restricted **user-scoped** token created at `https://dash.cloudflare.com/profile/api-tokens`. Select only the expected Alan account: Account Settings Read, Billing Read, Workers Scripts Edit, Workers Builds Configuration Edit (API name Workers CI Write), and Cloudflare Pages Read. Select only `motionsmith.org`: Zone Read, DNS Read, Workers Routes Edit. The deployment child uses the same selected credential as preflight. Do not grant KV, R2, all-zone routes, paid services or unrelated resources. Supply it privately using the optional ignored `.env` `CF_TOKEN`, `CLOUDFLARE_API_TOKEN`, or `MS_CLOUDFLARE_TOKEN_FILE`; never paste it in chat. This credential is used for setup; the file is not needed by automatic deployments. The supplied user token already passed these checks. [Builds authentication](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), [domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/), [authorization](https://developers.cloudflare.com/workers/authorization/workers/).
2. Verify Workers and Workers Builds are genuinely Free. `bun scripts/cloudflare-site.mjs status` is read-only. Deployment and connection scripts refuse missing billing/DNS evidence, paid Workers subscriptions, exhausted quotas, different accounts/zones, or a matching Worker without this setup's local receipt. They never upgrade or downgrade anything.
3. Keep repository changes reviewable and merge through the normal pull request process. The owner merged the initial configuration in PR #20; agents performed no direct main push/merge, tag creation or release publication. The native commands now exist on `main`. Review the known local baseline hash failures separately; the existing PR CI passed.
4. The existing GitHub App access permitted a successful `AlanSynn/ms` repository connection. If reconnecting under a different identity requires authorization, authorize the **Cloudflare Workers and Pages GitHub App for `AlanSynn/ms` only**. Access to another repository does not prove access to `ms`.
5. Register the supplied restricted user credential with `register-token`, or select an existing appropriately restricted build deployment token using its non-secret `MS_CLOUDFLARE_BUILD_TOKEN_UUID`. Builds management and deployment authentication are distinct. Avoid the dashboard's default automatic token creation, which grants KV/R2 and routes across all zones. Registration stores the existing credential in Cloudflare and never creates permission policies; the local `.env` can then be deleted. [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Once those access and billing conditions are satisfied, the remaining operations can be automated:

```sh
bun scripts/cloudflare-site.mjs status
bun scripts/cloudflare-site.mjs deploy
bun scripts/smoke-cloudflare-site.ts https://motionsmith-site.alansynn.workers.dev/
bun scripts/connect-cloudflare-site-builds.mjs register-token
bun scripts/connect-cloudflare-site-builds.mjs
bun scripts/cloudflare-site.mjs connect-domain
bun scripts/cloudflare-feedback-origin.mjs
bun scripts/smoke-cloudflare-site.ts https://motionsmith.org/
bun scripts/cloudflare-site.mjs status
```

Native Builds uses `deploy/cloudflare/builds.json`: Bun 1.3.14, explicit frozen-lockfile install, existing validated Vite build, `/` base, pinned Wrangler and explicit site config. Automatic install is disabled with `SKIP_DEPENDENCY_INSTALL=1`. Only `main` has a trigger; there are no PR/branch builds or CI browser matrices. Repository connection uses the documented idempotent PUT API. Existing triggers are compared before reuse; mismatched resources are not overwritten. Setup does not manually trigger extra builds. [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

Local deployment, native build and Git connection share the same static configuration check: exact account/name/output, workers.dev preview, disabled preview URLs/logs, no HTML fallback and no server/binding configuration. The Git connector applies it to the actual `main` configuration before creating its trigger. Routes remain absent from Wrangler configuration so domain attachment stays behind the verified preview/DNS checks. The installed Wrangler 4.112.0 only invokes its Custom Domain publisher when configured domain routes are present; actual domain retention still requires the first live Git deployment check.

Apply the feedback exception with `bun scripts/cloudflare-feedback-origin.mjs` after the free-plan checks. It verifies the original relay's immutable tag and requires the latest version to be its sole 100% deployed version. It reads current settings, appends only `https://motionsmith.org`, and uses the documented multipart settings PATCH with `inherit` and `version_id: "latest"` for every other binding, including secrets and rate limiters. The live API rejected version UUIDs with HTTP 400 / code `10057` and explicitly required the literal `latest`; those rejected requests made no changes. It retains human annotations, rechecks settings and version immediately before PATCH, and verifies other settings and the script-content ETag afterward. Secret values cannot be reread; preservation relies on documented inheritance. Cloudflare documents no atomic conditional PATCH here, so avoid concurrent relay edits during setup. The corrected PATCH succeeded, preserving the other seven bindings, all other settings and script-content ETag `e823a5cbf068ea438b4a56dec1354f7ba52cf177e2566218ef58db3799550095`. It uploads no source, retains every existing origin, skips repeat mutations, and verifies OPTIONS for both sites and a denied origin without creating issues. [Settings PATCH](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/), [latest versions](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/), [active deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/), [script-content fingerprint](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/).

The first domain smoke exposed Cloudflare's automatic Web Analytics beacon injection. The new-site-only HTML rules use `public, no-cache, no-transform`, which Cloudflare documents prevents automatic beacon injection. The strict smoke then passed with all startup/import requests on the same origin. Asset caching and version freshness remain unchanged; no CSP, analytics permission, account analytics setting or GitHub Pages header was added or modified. This controls injected browser scripts; it does not disable Cloudflare's own edge request metrics. [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/).

Connecting the domain checks existing apex address records and managed domains and requires a passing workers.dev smoke report for the deployed artifact. Cloudflare supplies DNS/TLS for the dedicated Custom Domain. Do not add or change records for `alansynn.com`. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Manual deployment is complete; workers.dev and real-domain HTTPS/startup/Open Project passed. Native Git integration is configured with trigger `282f605a-e629-4d55-95ab-966a253ef13c`, only `main`, and the registered existing user credential. No extra branch/preview trigger exists. A real owner-authorized push to `main`, a successful native build for that commit, and matching live `version.json` prove automatic deployment; a CLI deployment alone is insufficient. Retain the filtered status output and domain smoke report for the push being verified under `artifacts/site-validation`.

## Rollback

For a bad new-site deployment, use `wrangler rollback <previous-version-id> --config deploy/cloudflare/wrangler.jsonc` and rerun the smoke check. For full removal, first disconnect only `motionsmith-site`'s Builds trigger in its dashboard, remove only its `motionsmith.org` Custom Domain, then delete only `motionsmith-site` using the explicit config. Inspect the domain-specific managed DNS/certificate left behind; delete only records/certificates solely belonging to this new site. Restore the feedback allowlist by removing only `https://motionsmith.org` through the same guarded settings PATCH if removing this site. Retain every existing origin and relay secret. GitHub Pages, `alansynn.com`, the existing feedback relay and unrelated services continue independently. Revoke a stored build token only after verifying no unrelated trigger uses it.

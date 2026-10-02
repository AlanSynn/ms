# Independent MotionSmith site

Status on 2026-10-01: local implementation and portability validation pass. The supplied local token enables billing and DNS inspection, but remote provisioning is blocked because it is an account-owned token and Workers Builds requires a user-owned token. No Cloudflare resources, DNS records, billing settings, deployment settings or deployed feedback configuration were changed. The review branch is `codex/cloudflare-independent-site`, based on `a3d50005ce07e15cf73e748704cdcdc7709dd3cc`; merging into `main` remains an owner action.

## Architecture and cost gate

The prepared configuration is Workers Free, assets-only Workers Static Assets, and Cloudflare-native Workers Builds from `AlanSynn/ms` `main`. `deploy/cloudflare/wrangler.jsonc` targets only `motionsmith-site` in account `5af02c4a8b7da8e437893615cdb42b87`. The custom domain is `motionsmith.org`, zone `5237dc6855080ab390b6fb016941371c`. There is no Worker execution entrypoint, server storage, Cloudflare Vite plugin or new dependency. Only Vite `dist` is uploaded. Ordinary editing remains local.

This choice remains conditional on actual Workers Free billing. Cloudflare documents unlimited free static asset requests and no additional asset storage charge. Free native Builds has a capped allowance; Paid native Builds can incur overage. A Free Website zone, `default_usage_model: standard`, and an existing free allowance do not establish zero additional cost. [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

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

The initial Wrangler OAuth token lacked billing, Builds quota and DNS read access. The supplied `.env` credential now reads account subscriptions and DNS: no Workers/Builds subscription appears, the unrelated existing R2 subscription remains untouched, and the `motionsmith.org` apex has no records or connected Worker/Pages domain. Its account-token verification succeeds, but both Builds quota and token-list endpoints return HTTP 401 / code `12006` (`Invalid token`). Cloudflare explicitly rejects account-owned tokens for Builds. Actual Builds Free quota remains unverified, so provisioning stays stopped. [Builds authentication](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

If billing proves the account uses paid Workers, do not downgrade unrelated services or enable paid Builds. Evaluate a single Git-connected Pages project instead: Free Pages has 500 builds/month, one concurrent build, 20-minute builds, 20,000 files and 25 MiB/file; static requests are free. Create it with Git integration from the outset, never Direct Upload. No Pages fallback project was created. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Direct Upload limitation](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Deployment without a local .env

The local `.env` is optional setup authentication only. Setup accepts `CLOUDFLARE_API_TOKEN`, the local `CF_TOKEN` alias, an explicitly selected private token file, or existing Wrangler OAuth. It never writes a credential to source, frontend variables, receipts or logs. `.env` is already Git-ignored and never included in the deployment artifact.

Native Builds runs `bun --no-env-file scripts/build-cloudflare-site.mjs` and the configured Wrangler deploy command. It does not run the local account preflight helper or read a local `.env`. The build removes setup/deployment credentials from install and Vite subprocess environments and disables Bun dotenv loading in those subprocesses. Local builds take the public feedback endpoint from the same checked-in build specification, so its availability also does not depend on `.env`. Only public base-path, Bun and existing feedback endpoint values belong in the native build configuration.

After the dedicated deployment and free-plan checks, `bun scripts/connect-cloudflare-site-builds.mjs register-token` selects an explicitly supplied existing build-token UUID, reuses the supplied credential's registration, or registers that same existing restricted user token in Cloudflare's Builds token store. This uses the documented API and creates no API token or permission policy. The local receipt keeps only its non-secret UUID. The `.env` file can then be deleted; Cloudflare retains the deployment credential for subsequent Git builds. Keep that API token active, or replace the registered build credential before revoking it. This remote registration has **not yet run** because the current account token is unsupported. [Build token registration](https://developers.cloudflare.com/api/resources/workers_builds/subresources/tokens/methods/create/), [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

An isolated copy of the current source with no `.env` and no Cloudflare credential environment passed frozen installation, the production build, exclusion guards and bundle budget. With the same commit identifier, its 140 non-version files match the previously tested candidate byte for byte. Evidence: `artifacts/site-validation/no-env-build.json` and `no-env-build.log`.

## Preserved deployment and project files

The GitHub workflows, GitHub Pages DNS/settings, custom domain, tag policy, `/ms/` base, lockfile and Vite configuration remain unchanged. The existing feedback Worker is reused; its local production allowlist gains only `https://motionsmith.org`, retaining `https://alansynn.com`. The deployed relay currently rejects the new origin with HTTP 403. Only its owner-approved exact origin addition needs deployment; no GitHub issue was created by verification.

`.motionsmith` Save/Open and the existing serializer, import validation, migrations, integrity checks and limits remain authoritative. Current-only projects allow 12 MiB; portable bundles with history allow 48 MiB, with existing per-snapshot, artwork and history resource limits still enforced. No runtime caches or session state were added to the file format. Project help says: “Autosave is separate for each site. To move your work, save a project file from the original site and open it on the other site.”

Changed files:

- Deployment: `deploy/cloudflare/wrangler.jsonc`, `deploy/cloudflare/headers`, `deploy/cloudflare/builds.json`.
- Operations: `scripts/build-cloudflare-site.mjs`, `scripts/cloudflare-site-account.mjs`, `scripts/cloudflare-site.mjs`, `scripts/connect-cloudflare-site-builds.mjs`.
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
| All unit files run individually | 63/65 passed; two failures reproduced from clean starting commit |
| `bun run test:all` and `bun run test` | Fail at existing `b695-fit.test.ts` hash assertion |

The other existing failure is `four-bar-fit-retention.test.ts`. Both hashes differ identically in a clean archive of `a3d50005`; assertions were not changed. Relevant project-file, import safety, version, deployment contract and added Cloudflare tests pass. These unresolved baseline failures prevent a fully green repository verification claim.

Existing deployed version: **0.0.18**, commit **b7b10a4fcdacb7c0bb65e05335a69a397215719b**, successful deployment **6378825217**, release workflow run **34516389838**. The live bundle `/ms/assets/index-Qa8nmt3s.js` SHA-256 is `71d16b12b54d1576c0eabc0f0951a50425069cfd24eb5753f244b3bcc086f52a`, matching the rebuilt bundle. This release predates `version.json`; its 404 is not evidence that the app is unavailable. Candidate version is **0.0.18**; its build ID follows the current review-branch commit. Initial validation used **a3d50005** plus these source changes; current exact commit/build identifiers are recorded by `build-evidence.json` and the portability report. Compatibility is proven for this release/candidate pair, not future schema evolution.

The synthetic file contains 14 textured character parts, skeleton/anchors, painted artwork, an embedded scene object, two motion paths, timeline, accepted fitted mechanism/output binding, settings and one historical snapshot with embedded assets. The harness compares supported resumable `ProjectState` fields and exact retained history before and after editing. Existing recovery tests cover cancellation, corrupted/future/oversized/source-dependent imports and denied storage while preserving current work and last-good autosave.

Inspectable evidence: `artifacts/site-validation/build-evidence.json`, `portability/report.json`, downloaded `.motionsmith` files, `browser-files.log`, `unit-results.json`, both `baseline-*.log` files, `precommit.log`, `feedback-cors.log`, `cloudflare-dry-run-final.log` and `artifacts/cloudflare-site/smoke/report.json`. Generated evidence is deliberately not committed. The final dry-run rebuild's 140 non-version assets match the tested root artifact byte for byte; only the generated version timestamp changed.

## Remote setup and required owner actions

1. Replace the current account-owned token with a restricted **user-scoped** token created at `https://dash.cloudflare.com/profile/api-tokens`. Select only the expected Alan account: Account Settings Read, Billing Read, Workers Scripts Edit, Workers Builds Configuration Edit (API name Workers CI Write), and Cloudflare Pages Read. Select only `motionsmith.org`: Zone Read, DNS Read, Workers Routes Edit. The deployment child uses the same selected credential as preflight. Do not grant KV, R2, all-zone routes, paid services or unrelated resources. Supply it privately using the optional ignored `.env` `CF_TOKEN`, `CLOUDFLARE_API_TOKEN`, or `MS_CLOUDFLARE_TOKEN_FILE`; never paste it in chat. This credential is used for initial setup; the file is not needed by automatic deployments. [Builds authentication](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), [domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/), [authorization](https://developers.cloudflare.com/workers/authorization/workers/).
2. Verify Workers and Workers Builds are genuinely Free. `bun scripts/cloudflare-site.mjs status` is read-only. Deployment and connection scripts refuse missing billing/DNS evidence, paid Workers subscriptions, exhausted quotas, different accounts/zones, or a matching Worker without this setup's local receipt. They never upgrade or downgrade anything.
3. Review and merge this branch into `main` through the normal pull request process after addressing or explicitly reviewing the known baseline test failures. No direct push or merge to `main`, tag creation or release publication was performed. An initial merge is required before the prepared native Git commands exist on `main`.
4. Authorize the **Cloudflare Workers and Pages GitHub App for `AlanSynn/ms` only**, if that repository is not already authorized. Existing authorization to another repository does not prove access to `ms`.
5. Register the supplied restricted user credential with `register-token`, or select an existing appropriately restricted build deployment token using its non-secret `MS_CLOUDFLARE_BUILD_TOKEN_UUID`. Builds management and deployment authentication are distinct. Avoid the dashboard's default automatic token creation, which grants KV/R2 and routes across all zones. Registration stores the existing credential in Cloudflare and never creates permission policies; the local `.env` can then be deleted. [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Once those access and billing conditions are satisfied, the remaining operations can be automated:

```sh
bun scripts/cloudflare-site.mjs status
bun scripts/cloudflare-site.mjs deploy
bun scripts/smoke-cloudflare-site.ts https://motionsmith-site.alansynn.workers.dev/
bun scripts/connect-cloudflare-site-builds.mjs register-token
bun scripts/connect-cloudflare-site-builds.mjs
bun scripts/cloudflare-site.mjs connect-domain
bun scripts/smoke-cloudflare-site.ts https://motionsmith.org/
bun scripts/cloudflare-site.mjs status
```

Native Builds uses `deploy/cloudflare/builds.json`: Bun 1.3.14, explicit frozen-lockfile install, existing validated Vite build, `/` base, pinned Wrangler and explicit site config. Automatic install is disabled with `SKIP_DEPENDENCY_INSTALL=1`. Only `main` has a trigger; there are no PR/branch builds or CI browser matrices. Repository connection uses the documented idempotent PUT API. Existing triggers are compared before reuse; mismatched resources are not overwritten. Setup does not manually trigger extra builds. [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

Local deployment, native build and Git connection share the same static configuration check: exact account/name/output, workers.dev preview, disabled preview URLs/logs, no HTML fallback and no server/binding configuration. The Git connector applies it to the actual `main` configuration before creating its trigger. Routes remain absent from Wrangler configuration so domain attachment stays behind the verified preview/DNS checks. The installed Wrangler 4.112.0 only invokes its Custom Domain publisher when configured domain routes are present; actual domain retention still requires the first live Git deployment check.

Deploy the reviewed feedback allowlist addition separately with `wrangler deploy --config workers/feedback/wrangler.toml` only after checking that the remote allowlist still matches the retained origins. Verify OPTIONS from both exact origins and a denied origin; never submit a test issue. The frontend build specification uses the existing public feedback endpoint.

Connecting the domain checks existing apex address records and managed domains and requires a passing workers.dev smoke report for the deployed artifact. Cloudflare supplies DNS/TLS for the dedicated Custom Domain. Do not add or change records for `alansynn.com`. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Manual deployment is **not performed**. Native Git integration is **not configured or push-verified**. Public domain HTTPS/startup/Open Project are **not verified** because no site is provisioned. A real owner-authorized push to `main`, a resulting successful native build, and a matching live `version.json` are required to prove automatic deployment; a CLI deployment alone is insufficient.

## Rollback

For a bad new-site deployment, use `wrangler rollback <previous-version-id> --config deploy/cloudflare/wrangler.jsonc` and rerun the smoke check. For full removal, first disconnect only `motionsmith-site`'s Builds trigger in its dashboard, remove only its `motionsmith.org` Custom Domain, then delete only `motionsmith-site` using the explicit config. Inspect the domain-specific managed DNS/certificate left behind; delete only records/certificates solely belonging to this new site. Restore the feedback allowlist by removing only `https://motionsmith.org` if that addition was deployed. Retain every existing origin and relay secret. GitHub Pages, `alansynn.com`, the existing feedback relay and unrelated services continue independently. No rollback action is currently necessary because no remote mutation occurred.

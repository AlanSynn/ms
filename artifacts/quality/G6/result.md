# G6 result

## Verified behavior

- Root-local ignore rules preserve visibility of nested source and fixture names while ignoring only repository-root scratch, build, dependency, secret, worktree, and generated paths.
- The browser test harness defaults to production preview, accepts `PLAYWRIGHT_PORT`, validates the port, uses one URL for the web server and browser base URL, uses strict port binding, and only reuses an existing server for explicit `PLAYWRIGHT_SERVER=dev` debugging.
- The core browser build remains `tsc && vite build`; it has no telemetry secret or endpoint requirement.
- The Tauri frontend remains a separate `tsc && vite build --base ./` layer.
- The G0 Tauri-relative boot-font warning is resolved in `vite.config.ts`. Core, `VITE_BASE_PATH=/ms/`, and Tauri frontend builds completed without that warning.
- The Pages workflow remains tag-only (`v*.*.*`), checks the package tag/version match, builds with `VITE_BASE_PATH: /ms/`, and labels dependency, asset, version, contracts, web, artifact, and Pages layers.
- Pages checkout leaves Git LFS smudging off and explicitly pulls only `public/onnx/pose_model.onnx`; the `*.ort` rule remains available for manual candidates.
- The bounded INT8 candidate at `models/candidates/pose_model.int8.ort` is non-deployed and is absent from the `public/` artifact path and release workflow.
- The workflow verifies the ONNX asset before and after the web build by exact byte count, pointer rejection, and SHA-256.
- Model provenance is documented against `docs/archive/ports/to-port-web-onnx/copy_manifest.json`: 135929562 bytes and SHA-256 `9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74`.
- Default package scripts and the tagged Pages workflow contain no study telemetry dependency or telemetry endpoint.
- Package, Tauri config, Cargo manifests, and Cargo lock remain aligned at version 0.0.9; no release-version change was needed.
- Native `.app` and `.dmg` packaging were rerun offline. Both frontend prebuilds passed; native packaging stopped at Cargo dependency acquisition because `adler2 v2.0.1` is unavailable locally and offline mode cannot download it.
- The focused G6 contract test passes.

## Exact evidence

See [tests.txt](tests.txt) for raw command sections and exit codes. Decisive passing gates:

- `git diff --check`: exit 0.
- `bun run build`: exit 0.
- `VITE_BASE_PATH=/ms/ bun run build`: exit 0.
- `bun run build:tauri-frontend`: exit 0, no unresolved boot-font warning.
- `bun tests/g6-release-contract.test.ts`: exit 0.
- Default and explicit-dev config probes: preview `reuseExistingServer=false`; dev `reuseExistingServer=true`.
- Source and built model: both 135929562 bytes with the recorded SHA-256.

## Rejected assumptions

- A broad ignore rule is not safe merely because a matching path currently does not exist. The G6 test disables host-global excludes and checks nested source/fixture paths explicitly.
- Production preview reuse cannot be keyed to CI state: the focused contract locks reuse to explicit `PLAYWRIGHT_SERVER=dev`, so a busy preview port fails instead of attaching to HMR.
- `actions/checkout` LFS behavior is not treated as scoped merely because a later pull has an include filter. The workflow disables checkout smudging and has one exact pull for the deployed FP32 model.
- The INT8 candidate is not treated as a deployed runtime asset. It remains under `models/candidates/`, outside `public/`, `dist/`, and the Pages workflow.
- A successful Vite frontend build was not treated as proof that the Tauri-relative font was packaged correctly; the prior warning was reproduced, then the final Tauri build was rerun warning-free.
- Native packaging success text was not treated as evidence. The raw Cargo/DNS failures are retained as packaging-layer blockers.
- Native packaging reordered entries in `src-tauri/Cargo.lock`; that tool side effect was restored from `HEAD` before commit, and the final allowlist excludes the lockfile.
- The historical study telemetry release is not a tagged-release requirement. No full telemetry pipeline, study workflow, endpoint, secret, or runtime wiring was restored.

## Owned files

Production paths changed only within the G6 ownership boundary:

- `.github/workflows/deploy.yml`
- `.gitattributes`
- `.gitignore`
- `docs/deployment.md`
- `docs/macos-distribution.md`
- `playwright.config.ts`
- `vite.config.ts`

`package.json` was audited and intentionally left unchanged; its existing scripts already preserve the required build and browser-lane boundaries.

The only new test is `tests/g6-release-contract.test.ts`. No existing shared test or helper was edited.

The goal-local evidence is under `artifacts/quality/G6/`; the G5 model itself
was not edited or added.

## Commit

- A Lore-format G6 commit contains the verified owned-file diff and this evidence; its final SHA is reported in the handoff.
- No version change was genuinely required.

## Historical commits and release contract covered

- `745a0c5`: root-local transient debug/repro ignore conventions were audited and retained as anchored rules.
- `3e67903`: generated task-report deletion was inspected; no generated report was restored.
- `82fc6f1`: root-local `.worktrees/` behavior was retained and contract-tested against nested source paths.
- `283e0be` G6 hunks: isolated production-preview port support was restored and extended with strict mode validation.
- `30a9e9f` G6 hunks: release version alignment, Pages hardening, and Vite boundary changes were audited; the historical study telemetry pipeline was intentionally not restored.
- Current contract: tag-only GitHub Pages deployment at `https://alansynn.com/ms/` with `VITE_BASE_PATH=/ms/` remains unchanged.

## Remaining risk

- `bun run test:contracts` and the full `bun run test` suite remain red on existing mechanism/fabrication assertions outside G6 ownership. The recorded contract run reached `tests/project-contract.test.ts:1679`; the recorded full suite reached `tests/mechanism-authored-authority-boundaries.test.ts:117`. G6 did not edit those files or product mechanism code.
- The production-preview browser gate could not bind localhost in this lane: `listen EPERM 127.0.0.1:4173`. Per owner instruction it was not retried; the integration owner must run the deciding Orca production-preview gate.
- Native packaging remains unverified beyond the frontend layer because Cargo cannot obtain `adler2 v2.0.1`. The Tauri CLI also reports the pre-existing identifier warning for `com.motionsmith.app`; changing an application identifier was intentionally outside this hygiene pass.

## Intentionally omitted behavior

- No product UI, domain, renderer, physics, persistence, or runtime edits.
- No backend, cloud, auth, study telemetry, analytics, or telemetry-secret wiring.
- No release version bump or tag creation.
- No model file was added, moved, or edited; G5 owns the INT8 candidate.
- No changes to existing shared tests/helpers.
- No Playwright retry after the instructed localhost `EPERM` result.
- No native signing/notarization or distribution upload.

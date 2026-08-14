# Quality pass wave 1 result

Status: integrated and independently verified.

Wave 1 started from `quality-pass-wave-0` (`622617e`) and integrated the four dependency-ready lanes in reviewed order:

- G4 persistence: `a0b3490`, `57abaad`, `ffe0b1e`
- G6 release hygiene: `c473132`
- G2 board/readiness: `2796a77`
- Sol interface reconciliations: `0d530b7`, `a7832ab`
- G5 image AI: `79c8fb6`, `dc9c596`

No historical implementation commit was cherry-picked. Each worker commit was inspected against its declared ownership boundary before integration.

A documentation-only G5 source commit that appeared after the accepted handoff was inspected and rejected from integration; see `artifacts/quality/G5/post-integration-worker-review.md`. It does not move this wave tag or change any accepted product behavior.

## Historical dispositions

- Fourteen G2 commits are `VERIFIED_CLEAN_IMPLEMENTATION`; their board, coordinate, readiness, and export intent is reconciled through the shared G2 contracts.
- Two G5 commits are `REWORK_REQUIRED`. The responsive browser-local FP32 intent was rebuilt around a bounded typed worker runtime. Historical INT8 deployment was rejected; the candidate remains nondeployed evaluation evidence.
- Three G6 commits are `VERIFIED_CLEAN_IMPLEMENTATION`; root-local hygiene and tag-only release intent are retained.
- Fifteen non-browser G4 hunks and thirteen mixed G6 release/configuration hunks are verified. G4 browser hunks remain pending for G7. G6+G8 compile-time telemetry-boundary hunks remain pending for G8/Sol wiring.
- The two mixed historical commits remain commit-level `PENDING_HUNK_VERIFICATION` until their G3, G7, and G8 hunks receive final dispositions.

## Deciding verification

- Integrated project contract: `bun tests/project-contract.test.ts` — pass (`PROJECT_CONTRACT_PASS`).
- G2 focused coordinate/readiness/build/collision/consumer parity contracts and web build — pass; raw evidence: `artifacts/quality/G2/`.
- G4 bounded two-generation persistence and golden-master contracts — pass; raw evidence: `artifacts/quality/G4/`.
- G5 image dimensions, worker cancellation/supersession/warm reuse, Web ONNX, preprocessing, model quality, web/Tauri builds, and production-preview image import — pass; raw evidence: `artifacts/quality/G5/`.
- G6 release contract, web/base-path/Tauri frontend builds, exact model integrity, and production-preview configuration probes — pass; raw evidence: `artifacts/quality/G6/`.
- G5 production-preview browser evidence observed two successful imports, one retained model session, second-request session reuse, zero retained app-owned model buffers/tensors, closed bitmaps, complete part art/masks, and no observed app-attributable long task over 50 ms.
- Ownership audit: 84 exact lane/path assignments, zero cross-lane conflicts.

Native `.app`/`.dmg` packaging remains explicitly unverified beyond the frontend layer because the local offline Cargo cache lacks `adler2 v2.0.1`. No credential, deployment, signing, or external publication action was attempted.

## Next dependency

Only G3 becomes writable after the wave-1 tag. G7 waits for G3 integration; G8 waits for G7. G3 may consume the frozen G1 prepared-domain APIs but may not change domain acceptance policy.

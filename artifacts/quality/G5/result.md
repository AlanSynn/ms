# G5 result

Status: committed/clean.

Created commit: `ce6b4323e4c5662b47691596123004dd82a9f50b` (`feat(image-ai): run bounded pose import in cancelable worker`). This evidence follow-up is documentation-only; the product commit contains the verified G5 implementation and leaves the worker worktree clean.

## Runtime contract

- `utils/webOnnx.ts` is orchestration-only. It resolves the model against the document URL and passes that absolute URL to the worker; it does not read model bytes or own the cache.
- `utils/webOnnxProtocol.ts` is the typed source of truth for model constants, URL resolution, protocol messages, result metrics, cache status, and error classification. `utils/webOnnxModelRuntime.ts` owns byte-validated cache/download/session policy. `utils/webOnnxWorker.ts` is the worker entry/lifecycle.
- The worker retains at most one ORT session for the resolved model URL. The model `ArrayBuffer` is an application-owned local reference only during session creation; `ownedModelBufferReferencesRetained: 0` does not claim anything about ORT's internal/native memory. ImageBitmap, input/output tensors, derived image data, and result payloads are request-scoped. ORT tensors are explicitly disposed in the worker finally path; worker termination is the session reclamation boundary.
- Background warm and image processing are serialized on the reusable worker/cache. Process supersession and cancellation still terminate only the active process worker. The focused fake-worker test proves the warm/process lifecycle; the browser gate proves first initialization followed by reused-session inference.
- Model acquisition progress is coalesced by both 120 ms and a 5 percentage-point delta for nonterminal updates; terminal progress remains observable. The browser gate bounds process progress messages.
- The first-run loader is static logo/wordmark/version and releases when the editor mounts. AI warm/check runs in the background and reports through the existing status pill, not boot progress.

## Model provenance and quality

- Deployed FP32 is exactly `public/onnx/pose_model.onnx`, verified against `docs/archive/ports/to-port-web-onnx/copy_manifest.json`: 135,929,562 bytes, SHA-256 `9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74`.
- INT8 remains non-deployed at `models/candidates/pose_model.int8.ort`. It was not re-quantized in this lane. Its exact historical lineage is the NPZ at commit `868b2b523f43189d9104fca0fb7a67029cbe11ad`, path `models/calibration/pose-inputs.npz`, SHA-256 `b3b9e7eacea9b7feb23b0a2c1e84173a2b770a6db9ff369356678d3ccd76e34f`; that artifact is deleted from the current tree, not unavailable or never committed.
- The checked decision manifest therefore labels the candidate `legacy-evaluation-only`, records historical calibration as not bitwise reproduced, and keeps the future recipe separate: stick + girl calibration, boy-only evaluation, cleaned foreground bbox + 20% margin. Those inputs/process are specified, but no pinned Python/NumPy/Pillow/ONNX/ORT toolchain is recorded, so the future recipe is not claimed to reproduce the existing artifact bit-for-bit.
- Fresh Web-WASM comparison used all three committed representative product fixtures for the deciding quality field. This is not a claim that all three were historically held out; overlap with omitted historical calibration is explicitly unknown. FP32 mean inference was `291.23916666666673 ms`; INT8 mean was `290.8361110000001 ms` in this run. This single noisy run is effectively tied and does not justify replacing the deployed model; prior raw runs measured INT8 slower, and no candidate regeneration or promotion evidence exists. Accuracy across 51 keypoints: mean displacement `0.1715686274509804%`, p95 `1.25%`, max `1.25%`, exact argmax `86.27450980392157%`.

## Historical coverage and disposition

- `5775e7cf71778c05bd5b5d5eebcf99344c85ae3e` (`Keep image AI responsive on low-end laptops (#2)`) — **REWORK_REQUIRED**. Covered the first worker/off-main-thread and bounded-image direction, but its implementation and evidence were not accepted as the final G5 lane. The FP32 deployed-model intent was kept and reworked into the typed protocol/runtime split, bounded per-part art/mask preservation, recoverable cancellation/error behavior, and executable browser evidence.
- `868b2b523f43189d9104fca0fb7a67029cbe11ad` (`Ship the quality-gated INT8 pose model (#3)`) — **REWORK_REQUIRED**. Its historical INT8 deployment was rejected: the candidate is retained only as a non-deployed/evaluation-only LFS candidate, its historical NPZ lineage is recorded but not restored, and the current deployed model remains FP32. The historical INT8 calibration and artifact were not bitwise reproduced by this lane.
- The historical NPZ identity is preserved as committed evidence: commit `868b2b5`, path `models/calibration/pose-inputs.npz`, SHA-256 `b3b9e7eacea9b7feb23b0a2c1e84173a2b770a6db9ff369356678d3ccd76e34f`, `retainedInCurrentTree: false`. It is explicitly deleted from the current tree, not described as never committed or unavailable.

## Rejected assumptions

- A duplicate FP32 pointer under `models/source/` was not treated as the deployed lineage; the existing deployed asset and `docs/archive/ports/to-port-web-onnx/copy_manifest.json` remain authoritative. The duplicate pointer is absent from the current tree.
- The three current representative fixtures were not treated as the unknown historical NPZ calibration set or as historically held out. They are current quality fixtures; the future recipe keeps stick/girl calibration disjoint from boy evaluation.
- A fixture list plus an unconstrained Python/NumPy/Pillow/ONNX/ORT environment was not called bitwise artifact reproducibility. The future recipe specifies inputs and process but does not overclaim a reproduced artifact.
- Candidate size, stale measurements, or a single noisy timing run were not used to justify INT8 deployment. The candidate remains outside `public/` and non-deployed.
- Cache headers were not treated as model integrity. Cached bytes are read and validated against the expected real FP32 model size/pointer condition before use; invalid download and session-load paths clear the cache for retry.
- A generic worker result mark was not treated as proof of image processing completion; warm and process marks are distinct and browser evidence correlates the process request id.
- Data-URL character totals and application-owned buffer references were not presented as decoded bytes, heap measurements, or ORT internal memory measurements.
- AI model acquisition was not treated as first-run boot work. The static loader releases with editor mount; acquisition remains background status-pill work.

## Deciding production-preview evidence

The unchanged one-test production preview passed after warm/process serialization. The final raw evidence was:

- First process request `requestId=2`: dispatch `5845`; result `6606.200000047684`; application `6606.300000071526–6606.700000047684`; review mark `6876.800000071526`; progress messages `7` at `5849, 5858.700000047684, 5924.200000047684, 6271.300000071526, 6272.700000047684, 6563.200000047684, 6603.700000047684`; `modelInitMs=345.10000002384186`; `modelReused=false`; inference `289.7999999523163 ms`; total `759.5 ms`.
- Second process request `requestId=3`: dispatch `6930.399999976158`; result `7366.100000023842`; application `7366.200000047684–7366.399999976158`; review mark `7745.300000071526`; progress messages `6` at `6932.600000023842, 6935.700000047684, 6935.800000071526, 6935.899999976158, 7318.300000071526, 7363.600000023842`; `modelInitMs=0`; `modelReused=true`; inference `381 ms`; total `435.3000000715256 ms`.
- Both requests reported `retainedModelSessionCount=1`, `ownedModelBufferReferencesRetained=0`, `requestTensorRetainedBytes=0`, and `imageBitmapClosed=true`. Each imported `10` parts with `10` art outputs and `10` mask outputs. Data-URL totals were `9018` art characters and `5108` mask characters; these are bounded JavaScript string character counts, not byte measurements.
- The browser asserted every nonterminal progress sequence was bounded (`<=40` messages), the result-first review thumbnail was visible and `<=320px` wide/`<=128px` high, no page errors occurred, and no Long Task over `50 ms` overlapped either app-owned dispatch-to-review interval. The raw `overlappingLongTasks` arrays were empty for both requests. Warm completion is excluded from process-result counts by distinct mark names; exactly two process-result marks were observed.
- The earlier failing raw run before serialization was dispatch `968.8 ms`, one `981.7–1033.7 ms` Long Task (`52 ms`), first progress `1038.2 ms`, result `7073.3 ms`, application `7073.3–7073.9 ms`, review `7402.1 ms`, with media totals `9018`/`5108`. Its decisive cause was the boot warm fetch being superseded by process and forcing a fresh worker; the final gate above is the corrected run.

## Limits and integration handoff

- `python3 scripts/quantize-pose-model.py --help` parses without importing optional runtime packages. Missing quantization dependencies produce an actionable blocker naming the package and installation set.
- The candidate is staged through a worktree-local LFS attribute rule, not a production `.gitattributes` edit. Integration must sequence Sol/G6's `*.ort` rule. `public/onnx/pose_model.onnx` is not staged.
- The shared project-contract suite reaches the G5-specific assertions, but currently stops later at the unrelated pre-existing dense-fabrication assertion; the focused G5 executable suite is the deciding contract for this lane.

## Remaining risks and measurement boundaries

- `ownedModelBufferReferencesRetained: 0` measures only application-owned references after ORT session creation. It does not measure or prove immediate collection of ORT's internal/native/WASM model storage. The retained session is reported separately, and worker termination remains the reclamation boundary.
- `requestTensorRetainedBytes: 0` is the post-disposal request-tensor contract. It does not expose ORT allocator internals. ImageBitmap closure and request-scoped result/media release are likewise bounded lifecycle observations, not a complete heap profile.
- Browser inference and initialization timings are local observations with run-to-run noise from CPU scheduling, browser state, cache state, WASM startup, and background load. The close INT8/FP32 run is not a statistically stable performance claim; the deployment decision remains conservative and non-deployed because the candidate was not regenerated and prior evidence measured INT8 slower.
- Long-task evidence is bounded to the production-preview browser's PerformanceObserver window and the app-owned dispatch-to-review interval. It proves the tested path had no observed task over 50 ms there; it is not an exhaustive OS/browser memory or performance guarantee.
- Data-URL metrics are JavaScript string character counts. They are useful bounded representation totals, not decoded payload-byte or heap-byte measurements.

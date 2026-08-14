# G7 result

Status: PASS for the isolated critical-flow browser gate.

The QA-only item-12 correction now performs a portable tab round-trip in Playwright's headless Chromium context. It captures the Foundry fabrication signature and the renderer's actual `data-three-dynamic-build-count`, foregrounds a blank context page, restores the app page, and asserts:

- restored visibility is `visible`;
- the Foundry rig remains `data-three-preview-renderable="ready"`;
- the fabrication signature is unchanged;
- the dynamic build count is unchanged.

The headless context reported `backgroundVisibility: "visible"`; it does not expose hidden-tab visibility semantics. The independent Orca embedded-browser check likewise kept `document.visibilityState` visible while the app tab was inactive, but preserved the same renderer/signature/build-count values. This limitation is recorded rather than converted into a false hidden assertion.

No production files were edited. The implementation branch was `AlanSynn/luna-qa-recovery`, based at `9d64bd8a3fcb0b840038fe955cee0062ebfe2128`.

## Verified behavior

- Guided waving-arm project: 14 parts, 1 path, 1 mechanism.
- Browser-local ONNX import: 10 editable art parts and 10 masks; model asset 135,929,562 bytes.
- Native path drawing/editing: 17 points, closed, smoothness 24.
- Accepted, rejected, and no-op mechanism commands.
- Design Fit target error 0.
- Foundry, Design, Path, and Assembly playback.
- Board policy switch and restoration.
- Blueprint metadata, assembly HTML/PDF, and cut-sheet download.
- Snapshot download, autosave, reload, undo, and redo.
- Invalid import rejection without aggregate mutation.
- Item-12 tab round-trip and stable Foundry renderer state.
- Constrained performance probe with 30 idle and 45 active frames.

## Rejected assumptions

- `bringToFront()` cannot make `document.visibilityState` hidden in this headless Chromium context.
- The requested `data-three-structural-build-count` attribute is not present in this integrated build; the actual probe is `data-three-dynamic-build-count`.
- CDP `Page.setWebLifecycleState` returned successfully but did not expose portable DOM `freeze`/`resume` events or a reliable suspended timer under this headless launch. Those exploratory failures remain in `raw/` and are not used as passing evidence.

## Evidence and risks

The deciding focused run and build passed. The earlier full-suite characterization run is preserved at `raw/final-production-preview.log`; it exited 1 with 66 passed and 10 unrelated/contention-sensitive failures, including a stale item-12 version loaded before the final correction. It was not used as the G7 deciding gate.

Historical G7 failure contexts, traces, screenshots, diagnostics, and the CDP lifecycle probes remain under `artifacts/quality/G7/raw/`.

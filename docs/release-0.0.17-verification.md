# MotionSmith 0.0.17 verification

Starting commit: `1436b5c3e337c9dcb020f83764797c0806085933`.
Release scope: three classroom motion cues, aligned version manifests, and the required release assets and gates.

## Implemented behavior

1. Recommendation cards show `Recommendation score X` once, without `/100` or a separate score badge. The existing `ContextHelp` control opens this centralized copy: "Use this number to compare recommendations. It is not a grade or a target to maximize. Choose the motion that best matches what you want to happen."
2. While Draw is active, the control is described by one visible cue: "Draw where the selected part should move, not the shape of the part." The existing Path help entry supplies the same copy. The cue disappears on cancellation and stroke completion.
3. Each recommendation displays its existing `classroomSensemaking.directTranslation` immediately beneath its name. The canonical mechanism metadata and recommendation algorithm are unchanged.

Version `0.0.17` is aligned in all four release manifests. The new `classroom-motion-cues-v1` entry has three highlights and retains every published entry and asset.

## Files changed

- `components/stages/path/MechanismRecommendationSheet.tsx`
- `components/stages/path/PathWorkflowPanel.tsx`
- `utils/contextHelp.ts`
- `utils/releaseNotes.ts`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `vite.config.ts`
- `tests/project-contract.test.ts`
- `tests/student-support.test.ts`
- `tests/browser/classroom-motion-ux.spec.ts`
- `tests/browser/workflow.spec.ts`
- `public/release-notes/recommendation-score-v1.png`
- `public/release-notes/path-drawing-cue-v1.png`
- `public/release-notes/recommendation-motion-v1.png`
- `docs/release-0.0.17-verification.md`

## Verification

- `bun run test` and `bun run test:all` passed, including recommendation workers, canonical mechanism/scene contracts, persistence, fabrication, and English-only UI guards.
- `VITE_BASE_PATH=/ms/ bun run build` passed TypeScript, Vite, recognition exclusions, and the feedback boundary guard.
- `VITE_BASE_PATH=/ms/ bun run build:e2e` and `VITE_BASE_PATH=./ bun run build:tauri-frontend` passed. After the packaging-only change, the normal production artifact was rebuilt and exercised under both bases; no native desktop binary was packaged.
- `bun run test:support` passed, including archive preservation, all three local PNGs, and highlight format bounds.
- `bun run test:bundle-budget`, `bun run test:no-image-recognition`, and `bun scripts/check-feedback-boundary.mjs` passed on the final `/ms/` artifact.
- The final `/ms/` production preview passed all 28 cases in `classroom-motion-ux.spec.ts` and `student-support-notes.spec.ts`, using three workers. Coverage includes keyboard score help, tooltip relationships and layout stability, canonical motion text, real drawing, startup ordering, retained history, screenshot failure, safe Show me actions, and narrow layouts.
- The relative `./` production preview passed eight cases selected by `classroom-motion-ux|manual update links|missing screenshot`, using three workers.
- Existing `Context help opens compact registry popovers` and `Animation resumes after leaving path drawing mode` checks passed against the diagnostics production preview.
- `git diff --check` passed. The repository pre-commit gate remains enabled.

The new tests wait for the fixture's two progressively mounted recommendation cards and select the real production canvas rather than a diagnostics-only test ID. The existing context-help test now expects the already-shipped `Import object` label instead of the stale `Add object` label. Its behavior and layout assertions remain intact.

### Bundle gate

The initial release artifact exceeded the existing 200,000-byte core budget by 327 compressed bytes. `vite.config.ts` now groups the existing startup copy catalogs (`appCommands`, `classroomContent`, `contextHelp`, and `releaseNotes`) for compression. No catalog data or scoring logic was changed for this gate, and the budget was not raised.

The final measured core is **198,891 / 200,000** compressed bytes. The initial shell is **260,911 / 300,000** compressed bytes. Renderer and physics loading remain subject to the existing production and deployment checks.

### Existing failure retained

The additional `Recommendation sheet replaces the path owner and blueprint recipe` regression fails at `tests/browser/workflow.spec.ts:3598`: `data-design-generated-path-error` is **8.179**, while the assertion expects **less than 1**.

This failure was reproduced with the same value in an isolated archive of the untouched starting commit, built with `MOTIONSMITH_E2E_DIAGNOSTICS=1 VITE_BASE_PATH=/ms/ bunx vite build` and tested through production preview on port 5185. The original assertion and mechanism math were preserved. This record does not claim the complete browser suite is green.

The baseline failure trace and screenshot are retained locally under `artifacts/classroom-motion-ux/baseline/`. The isolated source was `/tmp/motionsmith-baseline-1436b5c.WnR1xT`.

## Screenshot provenance

Orca 1.4.198 reached the local production page and reported MotionSmith v0.0.17. Its screenshot call returned `browser_error`: `CDP error (Page.captureScreenshot): Screenshot timed out`, with a visibility/focus explanation. The release images therefore use the production-preview browser fallback specified in `docs/student-support.md`.

The bundled PNGs were captured from Chromium at 1366 x 768 CSS pixels and device scale factor 2. The synthetic fixture is `createFabricationReadyFourBarProject()`, opened through Getting Started -> Open Project. No private student work was used.

| Asset | Runtime route and source region | PNG pixels |
| --- | --- | --- |
| `recommendation-score-v1.png` | Design -> Recommend; Gear linkage score and its help control | 394 x 74 |
| `path-drawing-cue-v1.png` | Path -> Draw; Drawing control and its adjacent cue | 506 x 260 |
| `recommendation-motion-v1.png` | Design -> Recommend; Gear linkage name and canonical motion line | 486 x 116 |

Captures use actual DOM bounds, text bounds where appropriate, and eight CSS pixels of surrounding context. No pixels were generated or retouched. Open-help captures and full recommendation/Path views are retained separately under `artifacts/classroom-motion-ux/`.

Each bundled image was inspected in its rendered release-note article at 1280 x 720 and 390 x 844. These review captures use CSS-pixel scale, so text was assessed at the actual note-display size. The images, alt text, and release sentences agree. The cards show one score and one motion line; the Path pane shows one drawing cue.

## Scope preserved

Assembly, save/recovery behavior, collaboration, Chromebook support, lesson pacing, and physical materials were not modified. The recommendation algorithm, canonical mechanism metadata, and existing release archive were retained. The pre-existing untracked `resources/icons/Appicon.svg` and `themes/` were not staged.

Local build and browser evidence is separate from GitHub CI and Pages deployment evidence. The release uses the existing PR route to `main` and the tag-only Pages workflow; no branch-push or manual deployment path is added.

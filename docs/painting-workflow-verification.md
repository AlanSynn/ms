# Painting workflow implementation and runtime evidence

Inspected on 2026-09-07. The initial checkout was clean `main` at
`00ce602a00161e4c7a14f9245ae7f1aed5b141bd`, package version `0.0.15`.
The classroom page at `https://alansynn.com/ms/` also reported `0.0.15` in
Orca. This change prepares `0.0.16`; it does not publish a tag or deployment.

## Baseline and architecture

Orca 1.4.197 inspection covered Character, its imported artwork/cut editor,
object import, the Project menu, Save/Open, shared preview, and Blueprint.
The former editor changed contour provenance merely when opened. Character
had no brush/partial eraser workflow. The downloaded character template PDF
contained vector outlines and no image resources (`pdfimages -list`).
Baseline files and captures are retained locally in `artifacts/painting/baseline/`.

The [artwork ADR](adr/2026-09-07-retained-artwork-printing.md) describes the
retained document, stable frame, compositor, canonical build references,
captured revisions, PDF library boundary, limits, and front-side convention.
Original embedded bytes remain in portable project files. Everything runs
locally in the existing browser/Tauri frontend.

Starter rig now constructs an unpainted, editable baseline at the explicit
creation action. Existing sample silhouettes that did not contain their kit
hole rings receive a convex envelope around their original silhouette and
the actual rings. Already valid outlines, transforms, joints, paths, and
mechanisms are retained. This creation rule does not repair an existing
project during paint, import, save, or fabrication. Guided lesson baselines
remain unchanged; their older edge-hole limitations remain visible when
opening Change shape.

## Observed student workflows

Production preview, actual pointer gestures, real downloads, and fresh
browser contexts underpin these observations. Fixtures are reserved for
corrupt inputs, delayed work, and resource failures.

| Scenario | Evidence |
|---|---|
| Brush, partial erase, later repaint, undo/redo | `painting-workflow.spec.ts` paints a red band, erases its middle to the base, adds green in the erased region, and draws thin eyes/smile. Native canvas pixel samples verify order. Saved physical state is unchanged. |
| Shared moving artwork | Head and arm revisions are checked on installed Three textures. `painted-motion-paths.spec.ts` draws two independent arm paths through the UI, paints each arm, observes both mesh rotations advance, and checks retained paths/artwork after Project/Design navigation. Design uses an explicitly chosen mechanism. |
| Custom prop and shape separation | `painted-object-workflow.spec.ts` draws a rocket outline and rectangle/ellipse/line artwork. Canceling an earlier draft leaves ProjectState equal. Shrinking hides a sampled blue region; expanding reveals the same retained ink. Bounds, artwork frame, transforms, and operations stay fixed. A crossed candidate is blocked and cancelable. |
| Standalone custom figure | `painted-single-object.spec.ts` starts empty, draws an ellipse-shaped blue face named Orbit, and creates a real object path. Play advances the object; delete/undo restores it exactly. Save/Open retains its paint and path with no body parts, skeleton, or mechanism. The actual two-page PDF contains the painted piece and cut/place instructions. Assembly uses the same current artwork, without a character-fastener panel or a board. |
| File-only continuation | Save Project produces `.motionsmith` files. A fresh Chromium process opens the first file without recovery, edits further, saves, and a second clean context opens that second file. The complete part/motion state is compared. The rocket is independently reopened and repainted. |
| Painted build output | The normal Download Build PDF includes retained art. `pdf-lib` checks actual image resources and page sizes; Poppler renders the actual downloaded pages for visual inspection. The rocket packet has two painted cut sheets and an assembly page. It retains the new red mark, yellow window, black line, exact outline, and clipped white tips after expansion. |
| Paint-only freshness | The rocket is repainted after a saved/reopened build. Its geometry digest and paths are unchanged, while the new PDF contains the changed art. Domain/worker/material tests separately exercise delayed and obsolete revisions. |
| Interrupted work and failures | `painting-failures.spec.ts`, `painting-object-import.spec.ts`, and `artwork-rendering.spec.ts` cover canceled and obsolete imports, original PNG/JPEG/SVG retention, unsupported/corrupt art, refused downloads, failed builds/textures, and owner/tool/stage interruption. Previously committed source survives and can be saved or retried. |
| Orca authoring | The isolated painting profile opens a real saved file through Open Project. Native mouse commands add a red mark, partially erase it, and repaint green. Canvas samples show green at the center and red on both sides. A final 0.0.16 session opens the rocket, adds a green stroke, saves five retained operations with unchanged paths, and installs that exact revision in Assembly. Actual CLI captures and state snapshots live under `artifacts/painting/`. |

The first complete production run of the three main workflow tests passed
in 21.9 seconds using three workers. Local evidence is in
`artifacts/painting/slice3-browser/`. Later gates and refinements are recorded
below; this timing describes that run only.

Orca captured the implemented arm-paint workspace. Later screenshot calls
intermittently timed out with “the browser tab may not be visible or the window
may not have focus.” The subsequent Save download and snapshot calls returned
`runtime_unavailable: The Orca runtime closed the connection before responding`
despite its status endpoint reporting ready. The added Orca gestures were
observed by native canvas samples, but that session's later Orca save is not claimed.
The production browser flows independently completed portable-file/PDF validation.
On the final 0.0.16 build, a new Orca tab displayed the new release and retained
archive; Continue opened Getting Started with Open Project prominent. Screenshot
capture again timed out. The desktop focus fallback returned `window_not_found:
app 'Orca' has no on-screen window`, after a restore-window observation had reported
the window. Production-preview captures therefore supply the final visual evidence.
The new tab subsequently completed normal Open Project and Save Project actions.
`orca-final-rocket.motionsmith` contains the four original operations plus the new
thin green brush command. Its paths are unchanged. The live canvas sampled
`[6, 167, 125, 255]` at the new mark; Assembly reported that same document revision
as installed and current in its actual object material.
The normal Orca Download Build PDF action then produced
`orca-final-rocket-build.pdf`. Poppler rendered its actual second sheet;
the new green mark, earlier details, and deliberate rocket outline were inspected.

## Actual PDF review

The painted face and arm are visible in the downloaded build packet; the
face has one canonical neck hole, not an extra drilled eye or head landmark.
The custom rocket has no invented attachment holes. A multi-sheet runtime
failure exposed a PDF-library default that embedded only overlay page zero;
the implementation now explicitly embeds every physical sheet.

`pdfimages -list` reports 300–301 ppi for the 14 body-piece images and
300 ppi for the rocket (412 by 483 pixels in the inspected expanded version).
Letter pieces retain 612 by 792 point pages; existing mechanism pages retain
their native dimensions. Vector overlays and paint share the same placement
function, with canonical hole rings tested independently. Digital dimensions
and rendered PDFs do not establish physical-printer accuracy. No printer or
physical Chromebook was tested.

The final downloaded PDFs were inspected again after header cleanup. The face
packet has four pages, including its painted sheet and existing mechanism pages;
the rocket has three. Project name, sheet number, 100% scale, and actual hole size
remain visible on the painted sheets. PDF metadata records the captured project
and artwork revisions. A resource-level comparison found identical vector clipping, cut/hole
streams, placement operators, all alpha masks, and every image except the repainted
rocket. Original and repainted rocket images are both 412 by 483 pixels. The older
starter's omitted path smoothness becomes `0` on Open, explaining a metadata digest
change across sessions; it changes no physical output. The browser regression also
compares PDF geometry and artwork digests before/after repaint within the reopened
session. Evidence: `artifacts/painting/pdf-digest-investigation.json`.

The standalone Orbit packet was also rendered and reviewed. Its painted eyes and
mouth remain ink, with no drilled holes. Visual review caught inherited generic
board/stack wording in its guide and the Character fasteners panel in Assembly.
Object steps now show their actual cut/place actions; board and fastener controls
remain available for real character/mechanism steps. This is covered by the
standalone browser regression and the existing character-pin assembly workflow.
The corrected two-page PDF and Assembly capture are under
`artifacts/painting/final-object-guide-browser/`; the reviewed PDF renders are
`artifacts/painting/orbit-reviewed-1.png` and `orbit-reviewed-2.png`.

## Release-note capture provenance

The two locally bundled PNGs `paint-character-v1.png` and `draw-object-v1.png`
are unretouched captures of the real paint workspace from the production
browser tests at 1366 by 768, DPR 1, running version 0.0.16.
The first uses Guide → Waving arm → Head → Draw & paint. The second uses
Starter rig → Draw object → freehand Change shape → Add object → Save/Open
→ more paint. The retained source workspaces are 622 by 608 pixels. The note crops isolate
the actual results: face rectangle (176, 195)–(445, 498), 269 by 303 pixels;
rocket rectangle (173, 182)–(451, 507), 278 by 325 pixels. No painted pixels
were edited. The crops omit palette text that would be unreadable at the
startup note’s 160-pixel image height. Both source images and the note at its actual
160-pixel display height were visually inspected. The 1280-pixel dialog keeps Close
and Continue reachable while the body scrolls. Final source captures are under
`artifacts/painting/final-browser/`; note-display checks are under
`artifacts/painting/final-browser-2/`.

## Performance and retained resources

The production candidate was measured with Chromium CDP CPU throttling set to 6.
Each viewport received eight completed strokes and 96 real pointer-move samples
after a warm-up stroke. The measured interval ends at the second animation frame;
it is a responsiveness proxy, not physical display latency.

| Viewport | Median / p95 / maximum (ms) | Long tasks | Settled JS heap after GC |
|---|---|---|---|
| 1366 × 768 | 22.3 / 25.3 / 28.6 | 56 and 65 ms | 10,232,108 bytes |
| 1280 × 720 | 18.2 / 21.0 / 26.9 | 53 ms | 10,300,088 bytes |

Both sizes retained 14 artwork surfaces and 202,888 raster pixels. Unaffected
geometry, materials and textures kept their identities. Palette controls stayed
in the viewport. These short measurements exclude GPU/OS image memory and do not
establish long-session stability or performance on a physical classroom device.
Raw evidence is in `artifacts/artwork-rendering/final-current-source/`.

The final production builds pass the unchanged bundle gate:

| Build | Core JS gzip bytes / 200,000 limit | Initial shell compressed bytes / 300,000 limit |
|---|---|---|
| Classroom `/ms/`, ordinary production | 199,884 | 261,906 |
| Relative-path frontend with E2E diagnostics | 199,913 | 261,929 |

The lazy PDF library is 436,413 minified bytes / 182,792 gzip bytes; the lazy
paint workspace is 11,577 / 4,410 bytes in the classroom build. Gzip numbers
use Bun, matching the repository gate. The PDF library loads on build generation.
SVG/DXF serializers load on their explicit download actions. Canonical pin
selection and fabrication validation were extracted at existing seams with
complete-output golden checks; no budget or SVG safety check was weakened.
The core has little remaining headroom. The complete reports are
`artifacts/painting/final-pages-budget-3.json` and `final-relative-budget-3.json`.

## Verification gates

All checks below passed. Browser runs used production preview and bounded
parallel workers. The 48 distinct focused cases were run across scoped groups;
repeat checks at different build bases are not counted as additional cases.
This is not a claim that the entire repository browser suite was run.

| Gate | Result and retained evidence |
|---|---|
| `bun run test:all` | All 51 unit test files passed; `artifacts/painting/final-unit-complete.log`. |
| `bun run test` | Full contracts passed, including the final object-guide correction; `final-contracts-complete.log`. |
| `bun run test:precommit` | All six prescribed regression suites passed; `final-precommit-complete.log`. |
| Main painting, prop, independent motion, discovery, release archive | 31 cases passed with four workers; `final-browser-2.log` and `final-browser-2/`. |
| Existing Character workflows | Five cases passed: explicit shape commit, imported shape editing, off-board prop framing, Character processing controls, and replacement package flow. |
| Import and failure workflows | Six cases passed across `final-import-failures/` and `final-object-race-retry/`; the retry corrected a test assumption about Reset Lesson's new project id. |
| Shared renderer, late textures, resources, explicit SVG/DXF, throttled input | Four cases passed; `artifacts/artwork-rendering/README.md` and `final-current-source/`. |
| Standalone figure and existing character pins | Both passed on the final relative build, alongside the two discovery cases; `final-object-guide-browser.log` (four cases, 12.4 seconds). |
| Tauri frontend | `MOTIONSMITH_E2E_DIAGNOSTICS=1 bun run build:tauri-frontend` passed; `final-relative-build-3.log`. The ordinary frontend build also passed in `final-tauri-frontend-2.log`. |
| Classroom build | `VITE_BASE_PATH=/ms/ bun run build` passed; `final-pages-build-3.log`. Both 1366×768 and 1280×720 discovery checks passed with `VITE_BASE_PATH=/ms/ PLAYWRIGHT_BASE_PATH=/ms/ PLAYWRIGHT_SERVER=preview`; `final-pages-browser-3.log`. |
| Build boundaries | Both builds pass TypeScript, source/output image-recognition exclusion, feedback boundary, and the unchanged bundle gate. All four release version fields equal `0.0.16`. |

Unless a different directory is given, log paths in this table are relative to
`artifacts/painting/`. Earlier unsuccessful runs remain in that evidence folder;
the table names the passing replacements. `git diff --check` passes. No commit,
tag, deployment, native binary build, or physical print run was performed.

## Limits

Painting supports retained brush, eraser, line, filled rectangle and ellipse,
plus substrate color. It does not provide arbitrary linework flood fill,
pressure brushes, professional layers, vector boolean tools, automatic
rigging, or a separate art-file service. Invalid shape candidates stay local
until fixed or canceled; committed work remains saveable. Generated raster
limits produce an explicit error instead of silently lowering print quality.
Imported raster detail is limited by the original image. Front-side art is
supported; an invented mirrored back is not printed.
The relative-path Tauri frontend is built and exercised in Chromium; a native
Tauri binary and its platform webview were not built or tested in this mission.

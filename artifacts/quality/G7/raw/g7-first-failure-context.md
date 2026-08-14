# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quality-critical.spec.ts >> G7 isolated critical flow covers the integrated workbench
- Location: tests/browser/quality-critical.spec.ts:100:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('character-import-review')
Expected: visible
Timeout: 180000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 180000ms
  - waiting for getByTestId('character-import-review')

```

```yaml
- main:
  - navigation "Workflow":
    - button "Character": Character Character
    - button "Path Editor": Path Path Editor
    - button "Mechanism Foundry": Foundry Mechanism Foundry
    - button "Mechanism Design": Design Mechanism Design
    - button "Blueprint": Blueprint Blueprint
    - button "Assembly": Assembly Assembly
    - button "Options": Options Options
    - text: v0.0.9
  - button "Go home": MotionSmith
  - heading "Character" [level=2]
  - navigation "Commands":
    - group: File
    - group: Edit
    - group: View
    - group: Go
    - group: Options
    - group: Help
  - button "Report bug"
  - complementary "Workflow":
    - text: Character 14 parts 17 joints art on plates 0 objects
    - region "Make it yours":
      - text: Make it yours Make a hand wave Select a part Place joints
      - button "Edit rig"
      - button "Reset"
    - button "Open Getting Started": Getting Started
    - group "Character files":
      - button "Load character file"
      - button "Context help": "?"
      - button "Add object"
      - button "Context help": "?"
    - button "Create from image"
    - button "Context help": "?"
    - button "Open full project"
    - group: Tools
    - region "Character body part list":
      - text: Body parts
      - button "Torso Editable part art":
        - strong: Torso
        - text: Editable part art
      - button "Left upper leg Editable part art":
        - strong: Left upper leg
        - text: Editable part art
      - button "Left lower leg Editable part art":
        - strong: Left lower leg
        - text: Editable part art
      - button "Right upper leg Editable part art":
        - strong: Right upper leg
        - text: Editable part art
      - button "Right lower leg Editable part art":
        - strong: Right lower leg
        - text: Editable part art
      - button "Left foot Editable part art":
        - strong: Left foot
        - text: Editable part art
      - button "Right foot Editable part art":
        - strong: Right foot
        - text: Editable part art
      - button "Left upper arm Editable part art":
        - strong: Left upper arm
        - text: Editable part art
      - button "Left lower arm Editable part art":
        - strong: Left lower arm
        - text: Editable part art
      - button "Right upper arm Editable part art":
        - strong: Right upper arm
        - text: Editable part art
      - button "Right lower arm Editable part art":
        - strong: Right lower arm
        - text: Editable part art
      - button "Left hand Editable part art":
        - strong: Left hand
        - text: Editable part art
      - button "Right hand Editable part art" [pressed]:
        - strong: Right hand
        - text: Editable part art
      - button "Head Editable part art":
        - strong: Head
        - text: Editable part art
    - region "Scene object list": Scene objects Props start here.
  - region "Shared canvas":
    - button "Zoom out": −
    - text: 100%
    - button "Zoom in": +
    - button "Fit view": Fit
    - button "2D"
    - button "3D" [pressed]
    - button "Toggle grid layer" [pressed]: grid
    - button "Toggle character layer" [pressed]: Body
    - button "Toggle skeleton layer" [pressed]: Rig
  - complementary "Selected item inspector":
    - region "Character part settings":
      - text: Part Right hand
      - button "Add layer"
      - button "Remove layer"
      - text: Visible
      - checkbox "Visible" [checked]
      - text: Locked
      - checkbox "Locked"
      - text: Cut imported cut
      - button "Edit cut"
      - text: X
      - spinbutton "X number": "-134"
      - text: "Y"
      - spinbutton "Y number": "-54"
      - text: Rotation
      - spinbutton "Rotation number": "-18"
      - group: Artwork
      - button "Back"
      - button "Front"
      - group:
        - text: Anchors
        - heading "Motion setup" [level=4]
        - text: 3 joints right elbow bends. Handle right hand · Start right shoulder Part pivot
        - combobox "Part pivot":
          - option "root"
          - option "hip"
          - option "torso"
          - option "neck"
          - option "head top"
          - option "left shoulder"
          - option "left elbow"
          - option "left hand"
          - option "right shoulder"
          - option "right elbow"
          - option "right hand" [selected]
          - option "left hip"
          - option "left knee"
          - option "left foot"
          - option "right hip"
          - option "right knee"
          - option "right foot"
        - text: right hand · 1 joint
        - group: Edit skeleton
  - dialog "Import":
    - group: "Import Image processing failed 0% Web ONNX image processing failed during downloading-model at http://127.0.0.1:5187/onnx/pose_model.onnx: AI pose model is 1000001 bytes; expected 135929562 real ONNX model bytes. Cached model bytes were cleared; try the image again to redownload them."
  - strong: Now
  - text: Character
  - strong: Fix
  - text: OK
  - strong: Next
  - text: Choose starter AI unavailable — use Starter rig or Try again
  - button "model-invalid": Try again
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { Buffer } from "node:buffer";
  3   | import { join } from "node:path";
  4   | import { readFile } from "node:fs/promises";
  5   |
  6   | import {
  7   |   clickStage,
  8   |   installPageDiagnostics,
  9   |   makeInvalidProject,
  10  |   makeUnoccupiedWavingArmProject,
  11  |   readBlueprintPackage,
  12  |   sampleFrameMetrics,
  13  |   waitForBootLoader,
  14  |   writeG7Json,
  15  |   type PageDiagnostics,
  16  | } from "./quality-helpers";
  17  |
  18  | const ONNX_MODEL_ROUTE = "**/onnx/pose_model.onnx";
  19  | const TEST_ONNX_MODEL_BYTES = Buffer.alloc(1_000_001, 1);
  20  | const IMAGE_FIXTURE = join(process.cwd(), "tests/fixtures/stick-character.png");
  21  |
  22  | let latestEvidence: Record<string, unknown> = {};
  23  | let activeDiagnostics: PageDiagnostics | undefined;
  24  |
  25  | test.beforeEach(async ({ page }) => {
  26  |   latestEvidence = {};
  27  |   activeDiagnostics = installPageDiagnostics(page);
  28  |   await page.route(ONNX_MODEL_ROUTE, async (route) => {
  29  |     await route.fulfill({
  30  |       status: 200,
  31  |       contentType: "application/octet-stream",
  32  |       headers: { "content-length": String(TEST_ONNX_MODEL_BYTES.length) },
  33  |       body: TEST_ONNX_MODEL_BYTES,
  34  |     });
  35  |   });
  36  | });
  37  |
  38  | test.afterEach(async ({ page }, testInfo) => {
  39  |   await activeDiagnostics?.flush(testInfo, { evidence: latestEvidence });
  40  | });
  41  |
  42  | const expectProjectCounts = async (page: Page, expected: RegExp) => {
  43  |   await expect(page.getByTestId("stage-project-card")).toHaveAttribute("aria-label", expected);
  44  | };
  45  |
  46  | const waitForReview = async (page: Page) => {
> 47  |   await expect(page.getByTestId("character-import-review")).toBeVisible({ timeout: 180_000 });
      |                                                             ^ Error: expect(locator).toBeVisible() failed
  48  |   await expect(page.getByTestId("character-import-media-summary")).toBeVisible({ timeout: 180_000 });
  49  | };
  50  |
  51  | const openGuidedWavingArm = async (page: Page) => {
  52  |   const dialog = page.getByTestId("getting-started-dialog");
  53  |   await expect(dialog).toBeVisible();
  54  |   await dialog.getByTestId("getting-started-card-guided").click();
  55  |   await expect(dialog.getByTestId("guided-project-library")).toBeVisible();
  56  |   await dialog.getByTestId("guided-project-card-waving-arm").click();
  57  |   await expect(page.getByRole("heading", { name: "Character", exact: true })).toBeVisible();
  58  |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  59  | };
  60  |
  61  | const chooseNextEnabledOption = async (select: ReturnType<Page["getByLabel"]>) => {
  62  |   const current = await select.inputValue();
  63  |   const next = await select.locator("option").evaluateAll((options, currentValue) => {
  64  |     const candidate = options.find((option) => !option.disabled && option.value !== currentValue);
  65  |     return candidate?.value ?? "";
  66  |   }, current);
  67  |   expect(next, "the editable mechanism control exposes a second legal option").not.toBe("");
  68  |   return { current, next };
  69  | };
  70  |
  71  | const readSnapshotFromDownload = async (page: Page) => {
  72  |   await page.getByTestId("top-command-bar").getByText("File", { exact: true }).click();
  73  |   const [download] = await Promise.all([
  74  |     page.waitForEvent("download"),
  75  |     page.getByTestId("command-download-snapshot").click(),
  76  |   ]);
  77  |   const path = await download.path();
  78  |   expect(path, "snapshot download has a readable temporary path").toBeTruthy();
  79  |   return {
  80  |     filename: download.suggestedFilename(),
  81  |     snapshot: JSON.parse(await readFile(path!, "utf8")) as Record<string, any>,
  82  |   };
  83  | };
  84  |
  85  | const ensurePlayerPaused = async (page: Page) => {
  86  |   const pause = page.getByTestId("workspace-player-dock").getByRole("button", { name: "Pause", exact: true });
  87  |   if (await pause.count()) await pause.click();
  88  | };
  89  |
  90  | const playSharedStage = async (page: Page, label: string) => {
  91  |   await ensurePlayerPaused(page);
  92  |   const scrubber = page.getByLabel("Workspace scrubber");
  93  |   const before = await scrubber.inputValue();
  94  |   await page.getByTestId("workspace-player-dock").getByRole("button", { name: "Play", exact: true }).click();
  95  |   await expect.poll(() => scrubber.inputValue(), { message: `${label} playback advances the shared scrubber` }).not.toBe(before);
  96  |   await ensurePlayerPaused(page);
  97  |   return { before, after: await scrubber.inputValue() };
  98  | };
  99  |
  100 | test("G7 isolated critical flow covers the integrated workbench", async ({ page }) => {
  101 |   await page.setViewportSize({ width: 1440, height: 900 });
  102 |   await page.goto("/");
  103 |   await waitForBootLoader(page);
  104 |
  105 |   // 1. Guided project: the primary classroom entry creates real editable state.
  106 |   await openGuidedWavingArm(page);
  107 |   await expect(page.getByTestId("character-make-it-yours")).toBeVisible();
  108 |   latestEvidence.guidedProject = {
  109 |     card: "waving-arm",
  110 |     counts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
  111 |     editableOwnership: await page.getByTestId("character-make-it-yours").getAttribute("data-change-cue"),
  112 |   };
  113 |
  114 |   // 2. Image fixture import/process: verify the browser-local review artifact, then retain the lesson.
  115 |   await page.getByTestId("onnx-input").setInputFiles(IMAGE_FIXTURE);
  116 |   await waitForReview(page);
  117 |   const media = page.getByTestId("character-import-media-summary");
  118 |   const mediaEvidence = await media.evaluate((element) => ({
  119 |     totalParts: Number(element.getAttribute("data-total-parts")),
  120 |     artParts: Number(element.getAttribute("data-art-parts")),
  121 |     maskParts: Number(element.getAttribute("data-mask-parts")),
  122 |     modelPath: element.getAttribute("data-model-path"),
  123 |     inferenceMs: Number(element.getAttribute("data-inference-ms")),
  124 |   }));
  125 |   expect(mediaEvidence.totalParts, "image processing creates editable parts").toBeGreaterThan(0);
  126 |   expect(mediaEvidence.artParts, "processed parts retain cropped art").toBe(mediaEvidence.totalParts);
  127 |   expect(mediaEvidence.maskParts, "processed parts retain cropped masks").toBe(mediaEvidence.totalParts);
  128 |   expect(mediaEvidence.inferenceMs, "image processing reports inference latency").toBeGreaterThan(0);
  129 |   await page.getByRole("button", { name: "Skip", exact: true }).click();
  130 |   await expect(page.getByTestId("character-import-review")).toHaveCount(0);
  131 |   latestEvidence.imageImport = mediaEvidence;
  132 |
  133 |   // Use a serializable lesson without a mechanism so creation below cannot be mistaken for editing a starter.
  134 |   const unoccupiedProject = await makeUnoccupiedWavingArmProject();
  135 |   await page.getByTestId("onboarding-import-input").setInputFiles(unoccupiedProject);
  136 |   await expect(page.getByRole("heading", { name: "Path Editor", exact: true })).toBeVisible();
  137 |   await expectProjectCounts(page, /14 parts, 1 paths, 0 mechanisms/);
  138 |
  139 |   // 3. Native path draw/edit: one continuous gesture creates points, then the path inspector changes them.
  140 |   await page.getByTestId("path-view-2d").click();
  141 |   await expect(page.getByTestId("path-canvas")).toBeVisible();
  142 |   await page.getByRole("button", { name: "Draw free path", exact: true }).click();
  143 |   const pathCanvas = page.getByTestId("path-canvas");
  144 |   const pathBox = await pathCanvas.boundingBox();
  145 |   expect(pathBox, "2D path canvas accepts a pointer gesture").toBeTruthy();
  146 |   if (!pathBox) throw new Error("missing 2D path canvas box");
  147 |   const points = [
```
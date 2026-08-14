# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quality-critical.spec.ts >> G7 isolated critical flow covers the integrated workbench
- Location: tests/browser/quality-critical.spec.ts:89:1

# Error details

```
Error: the editable mechanism control exposes a second legal option

expect(received).not.toBe(expected) // Object.is equality

Expected: not ""
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - navigation "Workflow" [ref=e5]:
      - img [ref=e7]
      - button "Character" [ref=e8] [cursor=pointer]:
        - img [ref=e10]
        - generic [ref=e13]: Character
        - generic [ref=e14]: Character
      - button "Path Editor" [ref=e15] [cursor=pointer]:
        - img [ref=e17]
        - generic [ref=e19]: Path
        - generic [ref=e20]: Path Editor
      - button "Mechanism Foundry" [ref=e21] [cursor=pointer]:
        - img [ref=e23]
        - generic [ref=e33]: Foundry
        - generic [ref=e34]: Mechanism Foundry
      - button "Mechanism Design" [ref=e35] [cursor=pointer]:
        - img [ref=e37]
        - generic [ref=e39]: Design
        - generic [ref=e40]: Mechanism Design
      - button "Blueprint" [ref=e41] [cursor=pointer]:
        - img [ref=e43]
        - generic [ref=e46]: Blueprint
        - generic [ref=e47]: Blueprint
      - button "Assembly" [ref=e48] [cursor=pointer]:
        - img [ref=e50]
        - generic [ref=e55]: Assembly
        - generic [ref=e56]: Assembly
      - button "Options" [ref=e57] [cursor=pointer]:
        - img [ref=e59]
        - generic [ref=e62]: Options
        - generic [ref=e63]: Options
      - generic "MotionSmith version 0.0.9" [ref=e64]: v0.0.9
    - generic [ref=e65]:
      - generic [ref=e66]:
        - generic [ref=e67]:
          - button "Go home" [ref=e68] [cursor=pointer]:
            - img [ref=e69]
            - generic [ref=e70]: MotionSmith
          - heading "Mechanism Design" [level=2] [ref=e71]
        - generic [ref=e72]:
          - navigation "Commands" [ref=e73]:
            - group [ref=e74]:
              - generic "File" [ref=e75] [cursor=pointer]
            - group [ref=e76]:
              - generic "Edit" [ref=e77] [cursor=pointer]
            - group [ref=e78]:
              - generic "View" [ref=e79] [cursor=pointer]
            - group [ref=e80]:
              - generic "Go" [ref=e81] [cursor=pointer]
            - group [ref=e82]:
              - generic "Options" [ref=e83] [cursor=pointer]
            - group [ref=e84]:
              - generic "Help" [ref=e85] [cursor=pointer]
          - button "Report bug" [ref=e86] [cursor=pointer]:
            - img [ref=e87]
      - generic [ref=e96]:
        - generic [ref=e97]:
          - complementary "Workflow" [ref=e98]:
            - generic [ref=e101]:
              - generic [ref=e102]: Design
              - generic [ref=e103]:
                - button "Trace" [ref=e104] [cursor=pointer]
                - button "Recommend" [ref=e105] [cursor=pointer]:
                  - img [ref=e106]
                  - text: Recommend
              - heading "Mechanisms" [level=4] [ref=e109]
              - combobox "Mechanism instance" [ref=e110]:
                - option "Four-bar linkage" [selected]
              - generic [ref=e111]:
                - button "Four-bar linkage" [ref=e112] [cursor=pointer]
                - button "Slider piston" [ref=e113] [cursor=pointer]
                - button "Cam follower" [ref=e114] [cursor=pointer]
                - button "Gear train" [ref=e115] [cursor=pointer]
                - button "Gear linkage" [ref=e116] [cursor=pointer]
                - button "Planetary gear" [ref=e117] [cursor=pointer]
              - generic [ref=e118]:
                - generic [ref=e119]: Template
                - generic [ref=e120]: Four-bar linkage
              - generic [ref=e121]:
                - text: Why it moves
                - strong [ref=e122]: Crank turns -> rocker swings
                - generic [ref=e123]: Drag the output joint
                - generic [ref=e124]: "Check: Which two pivots stay fixed on the board?"
              - generic [ref=e125]:
                - generic [ref=e126]:
                  - generic [ref=e127]:
                    - generic [ref=e128]: Use example
                    - generic [ref=e129]: "Where: waving hand"
                  - button "Watch video" [ref=e130] [cursor=pointer]
                - paragraph [ref=e131]: Two fixed pivots guide a moving link through a smooth swing.
                - generic [ref=e132]: "Watch for: two board pivots stay still while the end swings"
                - paragraph [ref=e133]: "Think: Which two pivots are the anchors?"
                - img "Four-bar linkage generated mechanism loop" [ref=e134]:
                  - generic [ref=e171]: Generated loop
              - button "Blueprint" [ref=e172] [cursor=pointer]
          - region "Shared canvas" [ref=e173]:
            - generic [ref=e174]:
              - generic "Editor tools" [ref=e175]:
                - generic [ref=e176]: 3D Isometric · 82%
                - button "Move" [ref=e177] [cursor=pointer]
                - button "Rotate" [pressed] [ref=e178] [cursor=pointer]
                - button "Zoom" [ref=e179] [cursor=pointer]
                - button "Reset" [ref=e181] [cursor=pointer]
              - generic "View layers" [ref=e182]:
                - generic "View" [ref=e183]:
                  - button "Front" [ref=e184] [cursor=pointer]
                  - button "Isometric" [pressed] [ref=e185] [cursor=pointer]
                  - button "Side" [ref=e186] [cursor=pointer]
                  - button "Top" [ref=e187] [cursor=pointer]
                - generic "Layers" [ref=e188]:
                  - button "Grid" [pressed] [ref=e189] [cursor=pointer]
                  - button "User path" [pressed] [ref=e190] [cursor=pointer]
                  - button "Mech path" [pressed] [ref=e191] [cursor=pointer]
              - generic "Foundry 3D view" [ref=e192]:
                - img
                - generic:
                  - img "Design physical connection handles":
                    - generic:
                      - button "Input joint, linkage-2-cell, hole 3" [pressed] [ref=e195]
                      - button "Output joint, linkage-2-cell, hole 3" [pressed] [ref=e196]
          - complementary "Selected item inspector" [ref=e197]:
            - generic [ref=e198]:
              - generic [ref=e199]:
                - generic [ref=e200]: Mechanism
                - heading "Four-bar linkage" [level=3] [ref=e201]
              - generic [ref=e202]:
                - generic [ref=e203]: Visible
                - checkbox "Visible" [checked] [ref=e204]
              - generic [ref=e205]:
                - generic [ref=e206]: Enabled
                - checkbox "Enabled" [checked] [ref=e207]
              - generic [ref=e208]: Move
              - combobox "Mechanism target" [ref=e209]:
                - option "No target"
                - option "Torso"
                - option "Left upper leg"
                - option "Left lower leg"
                - option "Right upper leg"
                - option "Right lower leg"
                - option "Left foot"
                - option "Right foot"
                - option "Left upper arm"
                - option "Left lower arm"
                - option "Right upper arm"
                - option "Right lower arm"
                - option "Left hand"
                - option "Right hand" [selected]
                - option "Head"
              - combobox "Mechanism motion path" [ref=e210]:
                - option "No path"
                - option "Right hand path" [selected]
              - combobox "Motion handle" [ref=e211]:
                - option "Default handle"
                - option "right hand · 1 joint" [selected]
              - generic [ref=e212]:
                - generic [ref=e213]:
                  - generic [ref=e214]: "Input joint: 3-hole link · Hole 3"
                  - generic [ref=e215]: "Output joint: 3-hole link · Hole 3"
                - generic [ref=e216]:
                  - generic [ref=e217]: Link holes
                  - generic [ref=e218]:
                    - text: Input link
                    - combobox "Input link length" [disabled] [ref=e219]:
                      - option "3-hole" [selected]
                      - option "5-hole · not fitting" [disabled]
                      - option "7-hole · not fitting" [disabled]
                      - option "9-hole · not fitting" [disabled]
                    - generic [ref=e220]: Set on canvas.
                  - generic [ref=e221]:
                    - text: Coupler link
                    - combobox "Coupler link length" [ref=e222]:
                      - option "3-hole · not fitting" [disabled]
                      - option "5-hole" [selected]
                      - option "7-hole · not fitting" [disabled]
                      - option "9-hole · not fitting" [disabled]
                  - generic [ref=e223]:
                    - text: Output link
                    - combobox "Output link length" [disabled] [ref=e224]:
                      - option "3-hole" [selected]
                      - option "5-hole · not fitting" [disabled]
                      - option "7-hole · not fitting" [disabled]
                      - option "9-hole · not fitting" [disabled]
                    - generic [ref=e225]: Set on canvas.
                  - generic [ref=e226]: Fit inside board.
              - generic [ref=e227]: Parameters
              - generic [ref=e228]:
                - generic [ref=e229]:
                  - generic [ref=e230]: anchor X
                  - generic [ref=e231]: "-120"
                - slider "anchor X slider" [ref=e232]: "-120"
                - spinbutton "anchor X number" [ref=e233]: "-120"
                - generic [ref=e234]: "-240–120"
                - generic [ref=e235]: Fit inside board
              - generic [ref=e236]:
                - generic [ref=e237]:
                  - generic [ref=e238]: anchor Y
                  - generic [ref=e239]: "-40"
                - slider "anchor Y slider" [ref=e240]: "-40"
                - spinbutton "anchor Y number" [ref=e241]: "-40"
                - generic [ref=e242]: "-240–240"
                - generic [ref=e243]: Fit inside board
              - generic [ref=e244]:
                - generic [ref=e245]:
                  - generic [ref=e246]: ground angle
                  - generic [ref=e247]: "0"
                - slider "ground angle slider" [ref=e248]: "0"
                - spinbutton "ground angle number" [ref=e249]: "0"
                - generic [ref=e250]: 0–0
                - generic [ref=e251]: Fit inside board
              - generic [ref=e252]:
                - generic [ref=e253]:
                  - generic [ref=e254]: ground
                  - generic [ref=e255]: "160"
                - slider "ground slider" [ref=e256]: "160"
                - spinbutton "ground number" [ref=e257]: "160"
                - generic [ref=e258]: 0–160
                - generic [ref=e259]: Fit inside board
              - generic [ref=e260]:
                - generic [ref=e261]:
                  - generic [ref=e262]: slider offset
                  - generic [ref=e263]: "0"
                - slider "slider offset slider" [ref=e264]: "0"
                - spinbutton "slider offset number" [ref=e265]: "0"
                - generic [ref=e266]: "-120–120"
              - generic [ref=e267]:
                - generic [ref=e268]:
                  - generic [ref=e269]: output dist
                  - generic [ref=e270]: "78"
                - slider "output dist slider" [ref=e271]: "78"
                - spinbutton "output dist number" [ref=e272]: "78"
                - generic [ref=e273]: 0–220
              - generic [ref=e274]:
                - generic [ref=e275]:
                  - generic [ref=e276]: output angle
                  - generic [ref=e277]: "40"
                - slider "output angle slider" [ref=e278]: "40"
                - spinbutton "output angle number" [ref=e279]: "40"
                - generic [ref=e280]: "-180–180"
              - generic [ref=e281]:
                - button "Fit" [ref=e282] [cursor=pointer]:
                  - img [ref=e283]
                  - text: Fit
                - button "Delete" [ref=e286] [cursor=pointer]:
                  - img [ref=e287]
                  - text: Delete
              - generic [ref=e290]:
                - button "SVG" [ref=e291] [cursor=pointer]
                - button "DXF" [ref=e292] [cursor=pointer]
                - button "Export Blueprint" [ref=e293] [cursor=pointer]: Blueprint
        - generic "Shared playback controls":
          - complementary "Playback" [ref=e294]:
            - button "Move controls" [ref=e295]:
              - generic [ref=e296]: ⋮⋮
            - generic [ref=e297]:
              - button "Play" [ref=e298] [cursor=pointer]: ▶
              - button "Start over" [ref=e299] [cursor=pointer]: ↺
              - generic [ref=e300]: 1.0x
            - slider "Workspace scrubber" [ref=e301]: "0"
            - status "Playback percent" [ref=e302]: 0%
      - generic [ref=e303]:
        - generic [ref=e304]:
          - strong [ref=e305]: Now
          - text: Mechanism Design
        - generic [ref=e306]:
          - strong [ref=e307]: Fix
          - text: OK
        - generic [ref=e308]:
          - strong [ref=e309]: Next
          - text: Check target
      - generic [ref=e310]:
        - generic [ref=e311]: Mechanism package ready
        - button "AI ready" [disabled] [ref=e312]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { join } from "node:path";
  3   | import { readFile } from "node:fs/promises";
  4   |
  5   | import {
  6   |   clickStage,
  7   |   installPageDiagnostics,
  8   |   makeInvalidProject,
  9   |   makeUnoccupiedWavingArmProject,
  10  |   readBlueprintPackage,
  11  |   sampleFrameMetrics,
  12  |   waitForBootLoader,
  13  |   writeG7Json,
  14  |   type PageDiagnostics,
  15  | } from "./quality-helpers";
  16  |
  17  | const IMAGE_FIXTURE = join(process.cwd(), "tests/fixtures/stick-character.png");
  18  |
  19  | let latestEvidence: Record<string, unknown> = {};
  20  | let activeDiagnostics: PageDiagnostics | undefined;
  21  |
  22  | test.beforeEach(async ({ page }) => {
  23  |   latestEvidence = {};
  24  |   activeDiagnostics = installPageDiagnostics(page);
  25  | });
  26  |
  27  | test.afterEach(async ({ page }, testInfo) => {
  28  |   await activeDiagnostics?.flush(testInfo, { evidence: latestEvidence });
  29  | });
  30  |
  31  | const expectProjectCounts = async (page: Page, expected: RegExp) => {
  32  |   await expect(page.getByTestId("stage-project-card")).toHaveAttribute("aria-label", expected);
  33  | };
  34  |
  35  | const waitForReview = async (page: Page) => {
  36  |   await expect(page.getByTestId("character-import-review")).toBeVisible({ timeout: 180_000 });
  37  |   await expect(page.getByTestId("character-import-media-summary")).toBeVisible({ timeout: 180_000 });
  38  | };
  39  |
  40  | const openGuidedWavingArm = async (page: Page) => {
  41  |   const dialog = page.getByTestId("getting-started-dialog");
  42  |   await expect(dialog).toBeVisible();
  43  |   await dialog.getByTestId("getting-started-card-guided").click();
  44  |   await expect(dialog.getByTestId("guided-project-library")).toBeVisible();
  45  |   await dialog.getByTestId("guided-project-card-waving-arm").click();
  46  |   await expect(page.getByRole("heading", { name: "Character", exact: true })).toBeVisible();
  47  |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  48  | };
  49  |
  50  | const chooseNextEnabledOption = async (select: ReturnType<Page["getByLabel"]>) => {
  51  |   const current = await select.inputValue();
  52  |   const next = await select.locator("option").evaluateAll((options, currentValue) => {
  53  |     const candidate = options.find((option) => !option.disabled && option.value !== currentValue);
  54  |     return candidate?.value ?? "";
  55  |   }, current);
> 56  |   expect(next, "the editable mechanism control exposes a second legal option").not.toBe("");
      |                                                                                    ^ Error: the editable mechanism control exposes a second legal option
  57  |   return { current, next };
  58  | };
  59  |
  60  | const readSnapshotFromDownload = async (page: Page) => {
  61  |   await page.getByTestId("top-command-bar").getByText("File", { exact: true }).click();
  62  |   const [download] = await Promise.all([
  63  |     page.waitForEvent("download"),
  64  |     page.getByTestId("command-download-snapshot").click(),
  65  |   ]);
  66  |   const path = await download.path();
  67  |   expect(path, "snapshot download has a readable temporary path").toBeTruthy();
  68  |   return {
  69  |     filename: download.suggestedFilename(),
  70  |     snapshot: JSON.parse(await readFile(path!, "utf8")) as Record<string, any>,
  71  |   };
  72  | };
  73  |
  74  | const ensurePlayerPaused = async (page: Page) => {
  75  |   const pause = page.getByTestId("workspace-player-dock").getByRole("button", { name: "Pause", exact: true });
  76  |   if (await pause.count()) await pause.click();
  77  | };
  78  |
  79  | const playSharedStage = async (page: Page, label: string) => {
  80  |   await ensurePlayerPaused(page);
  81  |   const scrubber = page.getByLabel("Workspace scrubber");
  82  |   const before = await scrubber.inputValue();
  83  |   await page.getByTestId("workspace-player-dock").getByRole("button", { name: "Play", exact: true }).click();
  84  |   await expect.poll(() => scrubber.inputValue(), { message: `${label} playback advances the shared scrubber` }).not.toBe(before);
  85  |   await ensurePlayerPaused(page);
  86  |   return { before, after: await scrubber.inputValue() };
  87  | };
  88  |
  89  | test("G7 isolated critical flow covers the integrated workbench", async ({ page }) => {
  90  |   await page.setViewportSize({ width: 1440, height: 900 });
  91  |   await page.goto("/");
  92  |   await waitForBootLoader(page);
  93  |
  94  |   // 1. Guided project: the primary classroom entry creates real editable state.
  95  |   await openGuidedWavingArm(page);
  96  |   await expect(page.getByTestId("character-make-it-yours")).toBeVisible();
  97  |   latestEvidence.guidedProject = {
  98  |     card: "waving-arm",
  99  |     counts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
  100 |     editableOwnership: await page.getByTestId("character-make-it-yours").getAttribute("data-change-cue"),
  101 |   };
  102 |
  103 |   // 2. Image fixture import/process: verify the browser-local review artifact, then retain the lesson.
  104 |   await page.getByTestId("onnx-input").setInputFiles(IMAGE_FIXTURE);
  105 |   await waitForReview(page);
  106 |   const media = page.getByTestId("character-import-media-summary");
  107 |   const mediaEvidence = await media.evaluate((element) => ({
  108 |     totalParts: Number(element.getAttribute("data-total-parts")),
  109 |     artParts: Number(element.getAttribute("data-art-parts")),
  110 |     maskParts: Number(element.getAttribute("data-mask-parts")),
  111 |     modelPath: element.getAttribute("data-model-path"),
  112 |     inferenceMs: Number(element.getAttribute("data-inference-ms")),
  113 |   }));
  114 |   expect(mediaEvidence.totalParts, "image processing creates editable parts").toBeGreaterThan(0);
  115 |   expect(mediaEvidence.artParts, "processed parts retain cropped art").toBe(mediaEvidence.totalParts);
  116 |   expect(mediaEvidence.maskParts, "processed parts retain cropped masks").toBe(mediaEvidence.totalParts);
  117 |   expect(mediaEvidence.inferenceMs, "image processing reports inference latency").toBeGreaterThan(0);
  118 |   await page.getByRole("button", { name: "Skip", exact: true }).click();
  119 |   await expect(page.getByTestId("character-import-review")).toHaveCount(0);
  120 |   latestEvidence.imageImport = mediaEvidence;
  121 |
  122 |   // Use a serializable lesson without a mechanism so creation below cannot be mistaken for editing a starter.
  123 |   const unoccupiedProject = await makeUnoccupiedWavingArmProject();
  124 |   await page.getByTestId("onboarding-import-input").setInputFiles(unoccupiedProject);
  125 |   await expect(page.getByRole("heading", { name: "Path Editor", exact: true })).toBeVisible();
  126 |   await expectProjectCounts(page, /14 parts, 1 paths, 0 mechanisms/);
  127 |
  128 |   // 3. Native path draw/edit: one continuous gesture creates points, then the path inspector changes them.
  129 |   await page.getByTestId("path-view-2d").click();
  130 |   await expect(page.getByTestId("path-canvas")).toBeVisible();
  131 |   await page.getByRole("button", { name: "Draw free path", exact: true }).click();
  132 |   const pathCanvas = page.getByTestId("path-canvas");
  133 |   const pathBox = await pathCanvas.boundingBox();
  134 |   expect(pathBox, "2D path canvas accepts a pointer gesture").toBeTruthy();
  135 |   if (!pathBox) throw new Error("missing 2D path canvas box");
  136 |   const points = [
  137 |     [0.35, 0.40],
  138 |     [0.42, 0.44],
  139 |     [0.50, 0.48],
  140 |     [0.58, 0.45],
  141 |     [0.65, 0.40],
  142 |   ];
  143 |   await page.mouse.move(pathBox.x + pathBox.width * points[0]![0], pathBox.y + pathBox.height * points[0]![1]);
  144 |   await page.mouse.down();
  145 |   for (const [x, y] of points.slice(1)) {
  146 |     await page.mouse.move(pathBox.x + pathBox.width * x, pathBox.y + pathBox.height * y, { steps: 2 });
  147 |   }
  148 |   await page.mouse.up();
  149 |   const drawStatus = page.getByTestId("free-draw-status");
  150 |   await expect(drawStatus).toContainText("Path ready");
  151 |   expect(Number(await drawStatus.getAttribute("data-point-count")), "free draw commits at least three points").toBeGreaterThanOrEqual(3);
  152 |   const shapeControls = page.getByTestId("path-shape-controls");
  153 |   await shapeControls.getByRole("button", { name: "Closed", exact: true }).click();
  154 |   await expect(shapeControls.getByRole("button", { name: "Closed", exact: true })).toHaveClass(/active/);
  155 |   await page.getByLabel("Smoothness number").fill("24");
  156 |   await page.getByLabel("Smoothness number").press("Tab");
```
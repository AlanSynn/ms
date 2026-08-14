# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quality-critical.spec.ts >> G7 isolated critical flow covers the integrated workbench
- Location: tests/browser/quality-critical.spec.ts:89:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByTestId('free-draw-status')
Expected pattern: /^[3-9]\d*$/
Received string:  "17"
Timeout: 10000ms

Call log:
  - Expect "toHaveAttribute" with timeout 10000ms
  - waiting for getByTestId('free-draw-status')
    24 × locator resolved to <div data-point-count="17" data-draw-mode="idle" class="free-draw-status" data-testid="free-draw-status">Path ready</div>
       - unexpected value "17"

```

```yaml
- text: Path ready
```

# Test source

```ts
  51  |   const current = await select.inputValue();
  52  |   const next = await select.locator("option").evaluateAll((options, currentValue) => {
  53  |     const candidate = options.find((option) => !option.disabled && option.value !== currentValue);
  54  |     return candidate?.value ?? "";
  55  |   }, current);
  56  |   expect(next, "the editable mechanism control exposes a second legal option").not.toBe("");
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
> 151 |   await expect(drawStatus).toHaveAttribute("data-point-count", /^[3-9]\d*$/);
      |                            ^ Error: expect(locator).toHaveAttribute(expected) failed
  152 |   const shapeControls = page.getByTestId("path-shape-controls");
  153 |   await shapeControls.getByRole("button", { name: "Closed", exact: true }).click();
  154 |   await expect(shapeControls.getByRole("button", { name: "Closed", exact: true })).toHaveClass(/active/);
  155 |   await page.getByLabel("Smoothness number").fill("24");
  156 |   await page.getByLabel("Smoothness number").press("Tab");
  157 |   await expect(page.getByLabel("Smoothness number")).toHaveValue("24");
  158 |   latestEvidence.path = {
  159 |     pointCount: await drawStatus.getAttribute("data-point-count"),
  160 |     closed: true,
  161 |     smoothness: await page.getByLabel("Smoothness number").inputValue(),
  162 |   };
  163 |
  164 |   // 4. Mechanism creation and edit: Foundry commits a new mechanism from the no-mechanism lesson.
  165 |   await clickStage(page, "Foundry");
  166 |   await expect(page.getByRole("heading", { name: "Foundry", exact: true })).toBeVisible();
  167 |   await page.getByTestId("foundry-mechanism-gallery").getByRole("button", { name: /Four-bar linkage/i }).click();
  168 |   const foundryRig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  169 |   await expect(foundryRig).toHaveAttribute("data-mechanism-type", "4bar");
  170 |   await page.getByRole("button", { name: "Use mechanism", exact: true }).click();
  171 |   await expect(page.getByRole("heading", { name: "Mechanism Design", exact: true })).toBeVisible();
  172 |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  173 |   const designPreview = page.getByTestId("design-shared-foundry-preview");
  174 |   const designRig = designPreview.getByTestId("foundry-camera-rig");
  175 |   await expect(designRig).toHaveAttribute("data-mechanism-type", "4bar");
  176 |   const coupler = page.getByLabel("Coupler link length");
  177 |   const couplerChoice = await chooseNextEnabledOption(coupler);
  178 |   await coupler.selectOption(couplerChoice.next);
  179 |   await expect(coupler, "a legal mechanism edit commits a changed link length").not.toHaveValue(couplerChoice.current);
  180 |   await expect(designRig).toHaveAttribute("data-three-preview-renderable", "ready");
  181 |
  182 |   // 5. Accepted, rejected, and no-op command outcomes at the visible Design authority boundary.
  183 |   const target = page.getByLabel("Mechanism target");
  184 |   const validTarget = await target.inputValue();
  185 |   await target.selectOption("head");
  186 |   await expect(target, "a rejected target command retains the prior valid owner").toHaveValue(validTarget);
  187 |   await expect(page.getByTestId("stage-right-inspector").locator(".warning").filter({ hasText: /Fix:/ }).first()).toBeVisible();
  188 |   const noOpSignature = await designRig.getAttribute("data-three-fabrication-export-signature");
  189 |   const noOpAngle = page.getByLabel("ground angle number");
  190 |   const noOpValue = await noOpAngle.inputValue();
  191 |   await noOpAngle.fill(noOpValue);
  192 |   await noOpAngle.press("Tab");
  193 |   await expect(noOpAngle).toHaveValue(noOpValue);
  194 |   await expect(designRig, "a semantic no-op preserves the rendered mechanism identity").toHaveAttribute("data-three-fabrication-export-signature", noOpSignature ?? "");
  195 |   await expect(page.getByTestId("stage-right-inspector").locator(".warning").filter({ hasText: /Fix:/ })).toHaveCount(0);
  196 |   latestEvidence.commandOutcomes = {
  197 |     accepted: { control: "Coupler link length", from: couplerChoice.current, to: couplerChoice.next },
  198 |     rejected: { control: "Mechanism target", attempted: "head", retained: validTarget },
  199 |     noOp: { control: "ground angle", value: noOpValue, signaturePreserved: true },
  200 |   };
  201 |
  202 |   // 6. Design Fit uses the integrated Foundry renderer and reports a fitted target.
  203 |   await page.getByRole("button", { name: "Fit", exact: true }).click();
  204 |   await expect(designPreview).toHaveAttribute("data-design-path-fit-status", "fit");
  205 |   expect(Number(await designPreview.getAttribute("data-design-target-error")), "Design Fit leaves a bounded target error").toBeLessThan(1);
  206 |   latestEvidence.designFit = {
  207 |     status: await designPreview.getAttribute("data-design-path-fit-status"),
  208 |     targetError: Number(await designPreview.getAttribute("data-design-target-error")),
  209 |   };
  210 |
  211 |   // 7. Playback in Foundry, Design, and Path all advances the shared mechanism/path state.
  212 |   await clickStage(page, "Foundry");
  213 |   const foundryPhase = page.getByLabel("Foundry phase");
  214 |   const foundryPhaseBefore = await foundryPhase.inputValue();
  215 |   const foundryPlay = page.getByTestId("foundry-toolbar").getByRole("button", { name: "Play", exact: true });
  216 |   await foundryPlay.click();
  217 |   await expect(foundryPlay).toHaveText("Pause");
  218 |   await expect.poll(() => foundryPhase.inputValue(), { message: "Foundry phase advances" }).not.toBe(foundryPhaseBefore);
  219 |   await page.getByTestId("foundry-toolbar").getByRole("button", { name: "Pause", exact: true }).click();
  220 |   await clickStage(page, "Mechanism Design");
  221 |   const designPlayback = await playSharedStage(page, "Design");
  222 |   await clickStage(page, "Path Editor");
  223 |   const pathMore = page.getByTestId("novice-path-panel").locator("details").first();
  224 |   await pathMore.locator("summary").click();
  225 |   await pathMore.getByRole("button", { name: "Play", exact: true }).click();
  226 |   await expect(pathMore.getByRole("button", { name: "Stop", exact: true }), "Path playback enters its active state").toBeVisible();
  227 |   await pathMore.getByRole("button", { name: "Stop", exact: true }).click();
  228 |   latestEvidence.playback = {
  229 |     foundryPhaseBefore,
  230 |     foundryPhaseAfter: await foundryPhase.inputValue(),
  231 |     design: designPlayback,
  232 |     path: "started and stopped",
  233 |   };
  234 |
  235 |   // 8. Board policy switch: change the physical board profile and restore the buildable profile.
  236 |   await clickStage(page, "Options");
  237 |   const board = page.getByLabel("Board");
  238 |   await board.selectOption("letter-12x12-2cm");
  239 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("12×12 board grid");
  240 |   const constrainedBoardReadout = await page.getByTestId("grid-cell-readout").innerText();
  241 |   await board.selectOption("letter-15x15-2cm");
  242 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("15×15 board grid");
  243 |   latestEvidence.boardPolicy = { constrainedBoardReadout, restored: await board.inputValue() };
  244 |
  245 |   // 9. Blueprint output: package generation exposes printable mechanism and assembly artifacts.
  246 |   await clickStage(page, "Blueprint");
  247 |   await expect(page.getByTestId("blueprint-svg-preview")).toBeVisible();
  248 |   await page.getByRole("button", { name: "Generate package", exact: true }).click();
  249 |   const blueprintPackage = await readBlueprintPackage(page);
  250 |   expect(blueprintPackage.metadataJson, "Blueprint emits metadata").toContain("validationIssues");
  251 |   expect(blueprintPackage.metadataJson, "Blueprint emits required part metadata").toContain("requiredParts");
```
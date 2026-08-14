# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quality-critical.spec.ts >> G7 isolated critical flow covers the integrated workbench
- Location: tests/browser/quality-critical.spec.ts:79:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByTestId('stage-right-inspector').locator('.warning').filter({ hasText: /Fix:/ })
Expected: 0
Received: 1
Timeout:  10000ms

Call log:
  - Expect "toHaveCount" with timeout 10000ms
  - waiting for getByTestId('stage-right-inspector').locator('.warning').filter({ hasText: /Fix:/ })
    24 × locator resolved to 1 element
       - unexpected value "1"

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
                  - status: "Fix: Choose anchor"
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
                - slider "ground slider" [active] [ref=e256]: "160"
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
              - generic [ref=e281]: "Fix: Choose anchor"
              - generic [ref=e282]:
                - button "Fit" [ref=e283] [cursor=pointer]:
                  - img [ref=e284]
                  - text: Fit
                - button "Delete" [ref=e287] [cursor=pointer]:
                  - img [ref=e288]
                  - text: Delete
              - generic [ref=e291]:
                - button "SVG" [ref=e292] [cursor=pointer]
                - button "DXF" [ref=e293] [cursor=pointer]
                - button "Export Blueprint" [ref=e294] [cursor=pointer]: Blueprint
        - generic "Shared playback controls":
          - complementary "Playback" [ref=e295]:
            - button "Move controls" [ref=e296]:
              - generic [ref=e297]: ⋮⋮
            - generic [ref=e298]:
              - button "Play" [ref=e299] [cursor=pointer]: ▶
              - button "Start over" [ref=e300] [cursor=pointer]: ↺
              - generic [ref=e301]: 1.0x
            - slider "Workspace scrubber" [ref=e302]: "0"
            - status "Playback percent" [ref=e303]: 0%
      - generic [ref=e304]:
        - generic [ref=e305]:
          - strong [ref=e306]: Now
          - text: Mechanism Design
        - generic [ref=e307]:
          - strong [ref=e308]: Fix
          - text: OK
        - generic [ref=e309]:
          - strong [ref=e310]: Next
          - text: Check target
      - generic [ref=e311]:
        - generic [ref=e312]: "Fix: Choose anchor"
        - button "AI ready" [disabled] [ref=e313]
```

# Test source

```ts
  87  |   latestEvidence.guidedProject = {
  88  |     card: "waving-arm",
  89  |     counts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
  90  |     editableOwnership: await page.getByTestId("character-make-it-yours").getAttribute("data-change-cue"),
  91  |   };
  92  |
  93  |   // 2. Image fixture import/process: verify the browser-local review artifact, then retain the lesson.
  94  |   await page.getByTestId("onnx-input").setInputFiles(IMAGE_FIXTURE);
  95  |   await waitForReview(page);
  96  |   const media = page.getByTestId("character-import-media-summary");
  97  |   const mediaEvidence = await media.evaluate((element) => ({
  98  |     totalParts: Number(element.getAttribute("data-total-parts")),
  99  |     artParts: Number(element.getAttribute("data-art-parts")),
  100 |     maskParts: Number(element.getAttribute("data-mask-parts")),
  101 |     modelPath: element.getAttribute("data-model-path"),
  102 |     inferenceMs: Number(element.getAttribute("data-inference-ms")),
  103 |   }));
  104 |   expect(mediaEvidence.totalParts, "image processing creates editable parts").toBeGreaterThan(0);
  105 |   expect(mediaEvidence.artParts, "processed parts retain cropped art").toBe(mediaEvidence.totalParts);
  106 |   expect(mediaEvidence.maskParts, "processed parts retain cropped masks").toBe(mediaEvidence.totalParts);
  107 |   expect(mediaEvidence.inferenceMs, "image processing reports inference latency").toBeGreaterThan(0);
  108 |   await page.getByRole("button", { name: "Skip", exact: true }).click();
  109 |   await expect(page.getByTestId("character-import-review")).toHaveCount(0);
  110 |   latestEvidence.imageImport = mediaEvidence;
  111 |
  112 |   // Use a serializable lesson without a mechanism so creation below cannot be mistaken for editing a starter.
  113 |   const unoccupiedProject = await makeUnoccupiedWavingArmProject();
  114 |   await page.getByTestId("onboarding-import-input").setInputFiles(unoccupiedProject);
  115 |   await expect(page.getByRole("heading", { name: "Path Editor", exact: true })).toBeVisible();
  116 |   await expectProjectCounts(page, /14 parts, 1 paths, 0 mechanisms/);
  117 |
  118 |   // 3. Native path draw/edit: one continuous gesture creates points, then the path inspector changes them.
  119 |   await page.getByTestId("path-view-2d").click();
  120 |   await expect(page.getByTestId("path-canvas")).toBeVisible();
  121 |   await page.getByRole("button", { name: "Draw free path", exact: true }).click();
  122 |   const pathCanvas = page.getByTestId("path-canvas");
  123 |   const pathBox = await pathCanvas.boundingBox();
  124 |   expect(pathBox, "2D path canvas accepts a pointer gesture").toBeTruthy();
  125 |   if (!pathBox) throw new Error("missing 2D path canvas box");
  126 |   const points = [
  127 |     [0.35, 0.40],
  128 |     [0.42, 0.44],
  129 |     [0.50, 0.48],
  130 |     [0.58, 0.45],
  131 |     [0.65, 0.40],
  132 |   ];
  133 |   await page.mouse.move(pathBox.x + pathBox.width * points[0]![0], pathBox.y + pathBox.height * points[0]![1]);
  134 |   await page.mouse.down();
  135 |   for (const [x, y] of points.slice(1)) {
  136 |     await page.mouse.move(pathBox.x + pathBox.width * x, pathBox.y + pathBox.height * y, { steps: 2 });
  137 |   }
  138 |   await page.mouse.up();
  139 |   const drawStatus = page.getByTestId("free-draw-status");
  140 |   await expect(drawStatus).toContainText("Path ready");
  141 |   expect(Number(await drawStatus.getAttribute("data-point-count")), "free draw commits at least three points").toBeGreaterThanOrEqual(3);
  142 |   const shapeControls = page.getByTestId("path-shape-controls");
  143 |   await shapeControls.getByRole("button", { name: "Closed", exact: true }).click();
  144 |   await expect(shapeControls.getByRole("button", { name: "Closed", exact: true })).toHaveClass(/active/);
  145 |   await page.getByLabel("Smoothness number").fill("24");
  146 |   await page.getByLabel("Smoothness number").press("Tab");
  147 |   await expect(page.getByLabel("Smoothness number")).toHaveValue("24");
  148 |   latestEvidence.path = {
  149 |     pointCount: await drawStatus.getAttribute("data-point-count"),
  150 |     closed: true,
  151 |     smoothness: await page.getByLabel("Smoothness number").inputValue(),
  152 |   };
  153 |
  154 |   // 4. Mechanism creation and edit: Foundry commits a new mechanism from the no-mechanism lesson.
  155 |   await clickStage(page, "Foundry");
  156 |   await expect(page.getByRole("heading", { name: /Mechanism Foundry/i })).toBeVisible();
  157 |   await page.getByTestId("foundry-mechanism-gallery").getByRole("button", { name: /Four-bar linkage/i }).click();
  158 |   const foundryRig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  159 |   await expect(foundryRig).toHaveAttribute("data-mechanism-type", "4bar");
  160 |   await page.getByRole("button", { name: "Use mechanism", exact: true }).click();
  161 |   await expect(page.getByRole("heading", { name: "Mechanism Design", exact: true })).toBeVisible();
  162 |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  163 |   const designPreview = page.getByTestId("design-shared-foundry-preview");
  164 |   const designRig = designPreview.getByTestId("foundry-camera-rig");
  165 |   await expect(designRig).toHaveAttribute("data-mechanism-type", "4bar");
  166 |   const visible = page.getByLabel("Visible");
  167 |   const visibleBefore = await visible.isChecked();
  168 |   await visible.setChecked(!visibleBefore);
  169 |   await expect(visible, "a legal mechanism edit commits a visibility change").toBeChecked({ checked: !visibleBefore });
  170 |   await visible.setChecked(visibleBefore);
  171 |   await expect(visible).toBeChecked({ checked: visibleBefore });
  172 |   await expect(designRig).toHaveAttribute("data-three-preview-renderable", "ready");
  173 |
  174 |   // 5. Accepted, rejected, and no-op command outcomes at the visible Design authority boundary.
  175 |   const target = page.getByLabel("Mechanism target");
  176 |   const validTarget = await target.inputValue();
  177 |   await target.selectOption("head");
  178 |   await expect(target, "a rejected target command retains the prior valid owner").toHaveValue(validTarget);
  179 |   await expect(page.getByTestId("stage-right-inspector").locator(".warning").filter({ hasText: /Fix:/ }).first()).toBeVisible();
  180 |   const noOpSignature = await designRig.getAttribute("data-three-fabrication-export-signature");
  181 |   const noOpAngle = page.getByLabel("ground angle number");
  182 |   const noOpValue = await noOpAngle.inputValue();
  183 |   await noOpAngle.fill(noOpValue);
  184 |   await noOpAngle.press("Tab");
  185 |   await expect(noOpAngle).toHaveValue(noOpValue);
  186 |   await expect(designRig, "a semantic no-op preserves the rendered mechanism identity").toHaveAttribute("data-three-fabrication-export-signature", noOpSignature ?? "");
> 187 |   await expect(page.getByTestId("stage-right-inspector").locator(".warning").filter({ hasText: /Fix:/ })).toHaveCount(0);
      |                                                                                                           ^ Error: expect(locator).toHaveCount(expected) failed
  188 |   latestEvidence.commandOutcomes = {
  189 |     accepted: { control: "Visible", from: visibleBefore, to: !visibleBefore, restored: visibleBefore },
  190 |     rejected: { control: "Mechanism target", attempted: "head", retained: validTarget },
  191 |     noOp: { control: "ground angle", value: noOpValue, signaturePreserved: true },
  192 |   };
  193 |
  194 |   // 6. Design Fit uses the integrated Foundry renderer and reports a fitted target.
  195 |   await page.getByRole("button", { name: "Fit", exact: true }).click();
  196 |   await expect(designPreview).toHaveAttribute("data-design-path-fit-status", "fit");
  197 |   expect(Number(await designPreview.getAttribute("data-design-target-error")), "Design Fit leaves a bounded target error").toBeLessThan(1);
  198 |   latestEvidence.designFit = {
  199 |     status: await designPreview.getAttribute("data-design-path-fit-status"),
  200 |     targetError: Number(await designPreview.getAttribute("data-design-target-error")),
  201 |   };
  202 |
  203 |   // 7. Playback in Foundry, Design, and Path all advances the shared mechanism/path state.
  204 |   await clickStage(page, "Foundry");
  205 |   const foundryPhase = page.getByLabel("Foundry phase");
  206 |   const foundryPhaseBefore = await foundryPhase.inputValue();
  207 |   const foundryPlay = page.getByTestId("foundry-toolbar").getByRole("button", { name: "Play", exact: true });
  208 |   await foundryPlay.click();
  209 |   await expect(foundryPlay).toHaveText("Pause");
  210 |   await expect.poll(() => foundryPhase.inputValue(), { message: "Foundry phase advances" }).not.toBe(foundryPhaseBefore);
  211 |   await page.getByTestId("foundry-toolbar").getByRole("button", { name: "Pause", exact: true }).click();
  212 |   await clickStage(page, "Mechanism Design");
  213 |   const designPlayback = await playSharedStage(page, "Design");
  214 |   await clickStage(page, "Path Editor");
  215 |   const pathMore = page.getByTestId("novice-path-panel").locator("details").first();
  216 |   await pathMore.locator("summary").click();
  217 |   await pathMore.getByRole("button", { name: "Play", exact: true }).click();
  218 |   await expect(pathMore.getByRole("button", { name: "Stop", exact: true }), "Path playback enters its active state").toBeVisible();
  219 |   await pathMore.getByRole("button", { name: "Stop", exact: true }).click();
  220 |   latestEvidence.playback = {
  221 |     foundryPhaseBefore,
  222 |     foundryPhaseAfter: await foundryPhase.inputValue(),
  223 |     design: designPlayback,
  224 |     path: "started and stopped",
  225 |   };
  226 |
  227 |   // 8. Board policy switch: change the physical board profile and restore the buildable profile.
  228 |   await clickStage(page, "Options");
  229 |   const board = page.getByLabel("Board");
  230 |   await board.selectOption("letter-12x12-2cm");
  231 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("12×12 board grid");
  232 |   const constrainedBoardReadout = await page.getByTestId("grid-cell-readout").innerText();
  233 |   await board.selectOption("letter-15x15-2cm");
  234 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("15×15 board grid");
  235 |   latestEvidence.boardPolicy = { constrainedBoardReadout, restored: await board.inputValue() };
  236 |
  237 |   // 9. Blueprint output: package generation exposes printable mechanism and assembly artifacts.
  238 |   await clickStage(page, "Blueprint");
  239 |   await expect(page.getByTestId("blueprint-svg-preview")).toBeVisible();
  240 |   await page.getByRole("button", { name: "Generate package", exact: true }).click();
  241 |   const blueprintPackage = await readBlueprintPackage(page);
  242 |   expect(blueprintPackage.metadataJson, "Blueprint emits metadata").toContain("validationIssues");
  243 |   expect(blueprintPackage.metadataJson, "Blueprint emits required part metadata").toContain("requiredParts");
  244 |   expect(blueprintPackage.assemblyGuideHtml, "Blueprint emits Assembly guide HTML").toContain("assembly guide");
  245 |   expect(blueprintPackage.assemblyGuidePdf, "Blueprint emits Assembly guide PDF bytes").toMatch(/^%PDF-/);
  246 |   const [cutSheetDownload] = await Promise.all([
  247 |     page.waitForEvent("download"),
  248 |     page.getByRole("button", { name: "Download PDF cut sheet default", exact: true }).click(),
  249 |   ]);
  250 |   expect(cutSheetDownload.suggestedFilename(), "Blueprint PDF download has a printable filename").toMatch(/\.pdf$/i);
  251 |   latestEvidence.blueprint = {
  252 |     metadataBytes: blueprintPackage.metadataJson?.length ?? 0,
  253 |     assemblyGuideHtmlBytes: blueprintPackage.assemblyGuideHtml?.length ?? 0,
  254 |     assemblyGuidePdfBytes: blueprintPackage.assemblyGuidePdf?.length ?? 0,
  255 |     cutSheetFilename: cutSheetDownload.suggestedFilename(),
  256 |   };
  257 |
  258 |   // 7 continued / 9 continued. Assembly renders and plays the generated build steps.
  259 |   await clickStage(page, "Assembly");
  260 |   await expect(page.getByTestId("assembly-canvas-preview")).toBeVisible();
  261 |   await expect(page.getByTestId("assembly-step-list")).toBeVisible();
  262 |   const assemblyStepList = page.getByTestId("assembly-step-list");
  263 |   await assemblyStepList.getByRole("button").first().click();
  264 |   const assemblyWorkbench = page.getByTestId("assembly-readonly-step-strip");
  265 |   const assemblyProgressBefore = Number(await assemblyWorkbench.getAttribute("data-progress"));
  266 |   const assemblyPlayer = page.getByTestId("workspace-player-dock");
  267 |   await assemblyPlayer.getByRole("button", { name: "Play", exact: true }).click();
  268 |   await expect.poll(() => Number(assemblyWorkbench.getAttribute("data-progress")), { message: "Assembly playback advances the active build step" }).toBeGreaterThan(assemblyProgressBefore);
  269 |   await ensurePlayerPaused(page);
  270 |   latestEvidence.assembly = {
  271 |     step: await assemblyWorkbench.getAttribute("data-step-phase"),
  272 |     progressBefore: assemblyProgressBefore,
  273 |     progressAfter: Number(await assemblyWorkbench.getAttribute("data-progress")),
  274 |     stack: await page.getByTestId("assembly-stack-summary").innerText(),
  275 |   };
  276 |
  277 |   // 10. Save, reload, undo, redo: snapshot and browser autosave preserve the canonical aggregate.
  278 |   const saved = await readSnapshotFromDownload(page);
  279 |   expect(saved.filename).toMatch(/\.motionsmith\.json$/);
  280 |   expect(saved.snapshot.version).toBe(2);
  281 |   expect(Object.keys(saved.snapshot.parts ?? {}).length).toBeGreaterThan(0);
  282 |   expect(saved.snapshot.paths).toBeTruthy();
  283 |   expect(saved.snapshot.mechanisms?.length).toBe(1);
  284 |   await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem("motionsmith.autosave"))), { timeout: 15_000 }).toBe(true);
  285 |
  286 |   await clickStage(page, "Options");
  287 |   const toolbar = page.getByLabel("Show toolbar");
```
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: quality-critical.spec.ts >> G7 isolated critical flow covers the integrated workbench
- Location: tests/browser/quality-critical.spec.ts:81:1

# Error details

```
Error: the app tab becomes hidden when another tab is foregrounded

the app tab becomes hidden when another tab is foregrounded

expect(received).toBe(expected) // Object.is equality

Expected: "hidden"
Received: "visible"

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
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
      - button "Mechanism Foundry" [active] [ref=e21] [cursor=pointer]:
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
          - heading "Mechanism Foundry" [level=2] [ref=e71]
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
      - generic [ref=e97]:
        - complementary "Workflow" [ref=e98]:
          - generic [ref=e101]:
            - generic [ref=e102]: Foundry
            - generic [ref=e103]:
              - button "Fit path" [ref=e104] [cursor=pointer]:
                - img [ref=e105]
                - text: Fit path
              - button "Context help" [ref=e109] [cursor=pointer]: "?"
            - button "Pick anchor" [ref=e110] [cursor=pointer]
            - button "Use mechanism" [ref=e111] [cursor=pointer]:
              - img [ref=e112]
              - text: Use mechanism
            - heading "Templates" [level=4] [ref=e122]
            - generic [ref=e123]:
              - button "Four-bar linkage Swing" [ref=e124] [cursor=pointer]:
                - img [ref=e125]
                - generic [ref=e235]: Four-bar linkage
                - generic [ref=e236]: Swing
              - button "Slider piston Push-pull" [ref=e237] [cursor=pointer]:
                - img [ref=e238]
                - generic [ref=e353]: Slider piston
                - generic [ref=e354]: Push-pull
              - button "Cam follower Lift" [ref=e355] [cursor=pointer]:
                - img [ref=e356]
                - generic [ref=e420]: Cam follower
                - generic [ref=e421]: Lift
              - button "Gear train Reverse/scale" [ref=e422] [cursor=pointer]:
                - img [ref=e423]
                - generic [ref=e476]: Gear train
                - generic [ref=e477]: Reverse/scale
              - button "Gear linkage Gear crank" [ref=e478] [cursor=pointer]:
                - img [ref=e479]
                - generic [ref=e597]: Gear linkage
                - generic [ref=e598]: Gear crank
              - button "Planetary gear Compact rotary" [ref=e599] [cursor=pointer]:
                - img [ref=e600]
                - generic [ref=e713]: Planetary gear
                - generic [ref=e714]: Compact rotary
        - region "Shared canvas" [ref=e715]:
          - generic [ref=e716]:
            - generic [ref=e717]: Paused
            - generic "Shared 3D viewer toolbar":
              - generic: 3D Isometric · 82%
              - button "Context help" [ref=e719] [cursor=pointer]: "?"
              - button "Front" [ref=e720] [cursor=pointer]
              - button "Isometric" [pressed] [ref=e721] [cursor=pointer]
              - button "Side" [ref=e722] [cursor=pointer]
              - button "Top" [ref=e723] [cursor=pointer]
              - button "Grid layer" [pressed] [ref=e724] [cursor=pointer]: Grid
              - button "User path layer" [pressed] [ref=e725] [cursor=pointer]: User path
              - button "Mechanism path layer" [ref=e726] [cursor=pointer]: Mech path
              - button "Motion target point" [ref=e727] [cursor=pointer]: Target C
              - button "Motion push layer" [pressed] [ref=e728] [cursor=pointer]: Push
              - button "Motion speed layer" [pressed] [ref=e729] [cursor=pointer]: Speed
              - button "Motion trace layer" [ref=e730] [cursor=pointer]: Trace
            - generic "Foundry playback" [ref=e731]:
              - button "Play" [ref=e732] [cursor=pointer]
              - button "Reset" [ref=e733] [cursor=pointer]
              - slider "Foundry phase" [ref=e734]: "0"
              - status "Playback percent" [ref=e735]: 0%
            - generic "Foundry 3D view" [ref=e736]:
              - img
              - img "Foundry physical joint overlay" [ref=e739]:
                - generic [ref=e740]:
                  - generic [ref=e744]: Push
                  - generic [ref=e745]: Turn
                  - generic [ref=e746]: Rub
                - generic [ref=e749]: Speed
                - generic [ref=e751]:
                  - generic [ref=e752]:
                    - generic: M
                  - generic [ref=e754]:
                    - generic: A
                  - generic [ref=e755]:
                    - generic: B
                  - generic [ref=e756]:
                    - generic: C
                  - generic [ref=e757]:
                    - generic: D
              - generic:
                - img "Foundry physical connection handles":
                  - generic:
                    - button "Input joint, linkage-2-cell, hole 3" [pressed] [ref=e759]
                    - button "Output joint, linkage-2-cell, hole 3" [pressed] [ref=e760]
        - complementary "Selected item inspector" [ref=e761]:
          - generic [ref=e762]:
            - generic [ref=e763]:
              - button "Hint" [ref=e764] [cursor=pointer]:
                - generic [ref=e765]: Question
                - strong [ref=e766]: Which two pivots stay fixed on the board?
                - generic [ref=e767]: "Motion: Crank turns -> rocker swings"
                - generic [ref=e768]:
                  - generic [ref=e769]: "Try: Drag the output joint"
                  - generic [ref=e770]: "Look: driver crank turns and rocker swings"
                - generic [ref=e771]: Hint
              - generic [ref=e773]:
                - generic [ref=e774]:
                  - generic [ref=e775]:
                    - generic [ref=e776]: Use example
                    - generic [ref=e777]: "Where: waving hand"
                  - button "Watch video" [ref=e778] [cursor=pointer]
                - paragraph [ref=e779]: Two fixed pivots guide a moving link through a smooth swing.
                - generic [ref=e780]: "Watch for: two board pivots stay still while the end swings"
                - paragraph [ref=e781]: "Think: Which two pivots are the anchors?"
                - img "Four-bar linkage generated mechanism loop" [ref=e782]:
                  - generic [ref=e819]: Generated loop
            - generic [ref=e820]:
              - strong [ref=e821]: Stack
              - generic "Back Clip → Input 3-hole link → Spacer 10mm OD / 4mm hole → Front Clip → Coupler 5-hole link → Output 3-hole link" [ref=e822]
            - generic [ref=e823]:
              - generic [ref=e824]: View
              - generic [ref=e825]:
                - generic [ref=e826]:
                  - generic [ref=e827]:
                    - generic [ref=e828]: Rig opacity
                    - strong [ref=e829]: 85%
                  - slider "Rig opacity" [ref=e830]: "85"
                - generic [ref=e831]:
                  - generic [ref=e832]:
                    - generic [ref=e833]: Explode
                    - strong [ref=e834]: 0%
                  - slider "Exploded view" [ref=e835]: "0"
            - generic [ref=e836]:
              - generic [ref=e837]:
                - generic [ref=e838]: "Input joint: 3-hole link · Hole 3"
                - generic [ref=e839]: "Output joint: 3-hole link · Hole 3"
              - generic [ref=e840]:
                - generic [ref=e841]: Link holes
                - generic [ref=e842]:
                  - text: Input link
                  - combobox "Input link length" [disabled] [ref=e843]:
                    - option "3-hole" [selected]
                    - option "5-hole · not fitting" [disabled]
                    - option "7-hole · not fitting" [disabled]
                    - option "9-hole · not fitting" [disabled]
                  - generic [ref=e844]: Set on canvas.
                - generic [ref=e845]:
                  - text: Coupler link
                  - combobox "Coupler link length" [ref=e846]:
                    - option "3-hole · not fitting" [disabled]
                    - option "5-hole" [selected]
                    - option "7-hole · not fitting" [disabled]
                    - option "9-hole · not fitting" [disabled]
                - generic [ref=e847]:
                  - text: Output link
                  - combobox "Output link length" [disabled] [ref=e848]:
                    - option "3-hole" [selected]
                    - option "5-hole · not fitting" [disabled]
                    - option "7-hole · not fitting" [disabled]
                    - option "9-hole · not fitting" [disabled]
                  - generic [ref=e849]: Set on canvas.
                - generic [ref=e850]: Fit inside board.
            - group [ref=e851]:
              - generic "Mechanism options" [ref=e852] [cursor=pointer]
      - generic [ref=e853]:
        - generic [ref=e854]:
          - strong [ref=e855]: Now
          - text: Mechanism Foundry
        - generic [ref=e856]:
          - strong [ref=e857]: Fix
          - text: OK
        - generic [ref=e858]:
          - strong [ref=e859]: Next
          - text: Pick one
      - generic [ref=e860]:
        - generic [ref=e861]: Opened Mechanism Foundry
        - button "AI ready" [disabled] [ref=e862]
```

# Test source

```ts
  247 |
  248 |   // 8. Board policy switch: change the physical board profile and restore the buildable profile.
  249 |   await clickStage(page, "Options");
  250 |   const board = page.getByLabel("Board");
  251 |   await board.selectOption("letter-12x12-2cm");
  252 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("12×12 board grid");
  253 |   const constrainedBoardReadout = await page.getByTestId("grid-cell-readout").innerText();
  254 |   await board.selectOption("letter-15x15-2cm");
  255 |   await expect(page.getByTestId("grid-cell-readout")).toContainText("15×15 board grid");
  256 |   latestEvidence.boardPolicy = { constrainedBoardReadout, restored: await board.inputValue() };
  257 |
  258 |   // 9. Blueprint output: package generation exposes printable mechanism and assembly artifacts.
  259 |   await clickStage(page, "Blueprint");
  260 |   await expect(page.getByTestId("blueprint-svg-preview")).toBeVisible();
  261 |   await page.getByRole("button", { name: "Generate package", exact: true }).click();
  262 |   const blueprintPackage = await readBlueprintPackage(page);
  263 |   expect(blueprintPackage.metadataJson, "Blueprint emits metadata").toContain("validationIssues");
  264 |   expect(blueprintPackage.metadataJson, "Blueprint emits required part metadata").toContain("requiredParts");
  265 |   expect(blueprintPackage.assemblyGuideHtml, "Blueprint emits Assembly guide HTML").toContain("assembly guide");
  266 |   expect(blueprintPackage.assemblyGuidePdf, "Blueprint emits Assembly guide PDF bytes").toMatch(/^%PDF-/);
  267 |   const [cutSheetDownload] = await Promise.all([
  268 |     page.waitForEvent("download"),
  269 |     page.getByRole("button", { name: "Download PDF cut sheet default", exact: true }).click(),
  270 |   ]);
  271 |   expect(cutSheetDownload.suggestedFilename(), "Blueprint PDF download has a printable filename").toMatch(/\.pdf$/i);
  272 |   latestEvidence.blueprint = {
  273 |     metadataBytes: blueprintPackage.metadataJson?.length ?? 0,
  274 |     assemblyGuideHtmlBytes: blueprintPackage.assemblyGuideHtml?.length ?? 0,
  275 |     assemblyGuidePdfBytes: blueprintPackage.assemblyGuidePdf?.length ?? 0,
  276 |     cutSheetFilename: cutSheetDownload.suggestedFilename(),
  277 |   };
  278 |
  279 |   // 7 continued / 9 continued. Assembly renders and plays the generated build steps.
  280 |   await clickStage(page, "Assembly");
  281 |   await expect(page.getByTestId("assembly-canvas-preview")).toBeVisible();
  282 |   await expect(page.getByTestId("assembly-step-list")).toBeVisible();
  283 |   const assemblyStepList = page.getByTestId("assembly-step-list");
  284 |   await assemblyStepList.getByRole("button").first().click();
  285 |   const assemblyWorkbench = page.getByTestId("assembly-readonly-step-strip");
  286 |   const assemblyProgressBefore = Number(await assemblyWorkbench.getAttribute("data-progress"));
  287 |   const assemblyPlayer = page.getByTestId("workspace-player-dock");
  288 |   await assemblyPlayer.getByRole("button", { name: "Play", exact: true }).click();
  289 |   await expect.poll(async () => Number(await assemblyWorkbench.getAttribute("data-progress")), { message: "Assembly playback advances the active build step" }).toBeGreaterThan(assemblyProgressBefore);
  290 |   await ensurePlayerPaused(page);
  291 |   latestEvidence.assembly = {
  292 |     step: await assemblyWorkbench.getAttribute("data-step-phase"),
  293 |     progressBefore: assemblyProgressBefore,
  294 |     progressAfter: Number(await assemblyWorkbench.getAttribute("data-progress")),
  295 |     stack: await page.getByTestId("assembly-stack-summary").innerText(),
  296 |   };
  297 |
  298 |   // 10. Save, reload, undo, redo: snapshot and browser autosave preserve the canonical aggregate.
  299 |   const saved = await readSnapshotFromDownload(page);
  300 |   expect(saved.filename).toMatch(/\.motionsmith\.json$/);
  301 |   expect(saved.snapshot.version).toBe(2);
  302 |   expect(Object.keys(saved.snapshot.parts ?? {}).length).toBeGreaterThan(0);
  303 |   expect(saved.snapshot.paths).toBeTruthy();
  304 |   expect(saved.snapshot.mechanisms?.length).toBe(1);
  305 |   await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem("motionsmith.autosave"))), { timeout: 15_000 }).toBe(true);
  306 |
  307 |   await clickStage(page, "Options");
  308 |   const toolbar = page.getByLabel("Show toolbar");
  309 |   const toolbarBefore = await toolbar.isChecked();
  310 |   await toolbar.setChecked(!toolbarBefore);
  311 |   await expect(toolbar).toBeChecked({ checked: !toolbarBefore });
  312 |   await page.getByTestId("top-command-bar").getByText("Edit", { exact: true }).click();
  313 |   await page.getByRole("button", { name: "Undo", exact: true }).click();
  314 |   await expect(toolbar).toBeChecked({ checked: toolbarBefore });
  315 |   await page.getByTestId("top-command-bar").getByText("Edit", { exact: true }).click();
  316 |   await page.getByRole("button", { name: "Redo", exact: true }).click();
  317 |   await expect(toolbar).toBeChecked({ checked: !toolbarBefore });
  318 |
  319 |   await page.reload({ waitUntil: "domcontentloaded" });
  320 |   await waitForBootLoader(page);
  321 |   const reloadDialog = page.getByTestId("getting-started-dialog");
  322 |   if (await reloadDialog.count()) await reloadDialog.getByRole("button", { name: "Close", exact: true }).click();
  323 |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  324 |   latestEvidence.persistence = {
  325 |     savedFilename: saved.filename,
  326 |     savedVersion: saved.snapshot.version,
  327 |     autosavePresent: true,
  328 |     reloadedCounts: await page.getByTestId("stage-project-card").getAttribute("aria-label"),
  329 |     undoRestoredToolbar: toolbarBefore,
  330 |     redoRestoredToolbar: !toolbarBefore,
  331 |   };
  332 |
  333 |   // 11. Invalid project import is rejected without mutating the current aggregate.
  334 |   const invalidProject = await makeInvalidProject();
  335 |   await page.getByTestId("project-file-input").setInputFiles(invalidProject);
  336 |   await expect(page.getByTestId("status-bar")).toContainText("Fix: Update project");
  337 |   await expectProjectCounts(page, /14 parts, 1 paths, 1 mechanisms/);
  338 |   latestEvidence.invalidImport = { status: "Fix: Update project", stateRetained: true };
  339 |
  340 |   // 12. Hide and restore a browser tab: background the page, return to it, and retain the live preview.
  341 |   await clickStage(page, "Foundry");
  342 |   const restoredRig = page.locator('[data-testid="foundry-camera-rig"][data-viewer-tab="foundry"]');
  343 |   await expect(restoredRig).toHaveAttribute("data-three-preview-renderable", "ready");
  344 |   const backgroundTab = await page.context().newPage();
  345 |   await backgroundTab.goto("about:blank");
  346 |   await backgroundTab.bringToFront();
> 347 |   await expect.poll(() => page.evaluate(() => document.visibilityState), { message: "the app tab becomes hidden when another tab is foregrounded" }).toBe("hidden");
      |                                                                                                                                                      ^ Error: the app tab becomes hidden when another tab is foregrounded
  348 |   await backgroundTab.close();
  349 |   await page.bringToFront();
  350 |   await expect.poll(() => page.evaluate(() => document.visibilityState), { message: "the app tab restores visible state" }).toBe("visible");
  351 |   await expect(restoredRig).toHaveAttribute("data-three-preview-renderable", "ready");
  352 |   latestEvidence.tabLifecycle = { hiddenObserved: true, restoredVisibility: await page.evaluate(() => document.visibilityState) };
  353 |
  354 |   // 13. Constrained-performance probe: compare idle and active rAF/long-task metrics in a short viewport.
  355 |   await page.setViewportSize({ width: 900, height: 520 });
  356 |   await expect(foundryToolbar.getByRole("button", { name: "Play", exact: true }), "Foundry is paused before the idle performance sample").toBeVisible();
  357 |   const beforePerformance = await sampleFrameMetrics(page, "foundry-idle", 30);
  358 |   await foundryToolbar.getByRole("button", { name: "Play", exact: true }).click();
  359 |   const duringPerformance = await sampleFrameMetrics(page, "foundry-playing", 45);
  360 |   const foundryPause = foundryToolbar.getByRole("button", { name: "Pause", exact: true });
  361 |   await expect(foundryPause, "Foundry toolbar owns the active performance pause").toBeVisible();
  362 |   await foundryPause.click();
  363 |   await expect(foundryToolbar.getByRole("button", { name: "Play", exact: true }), "Foundry toolbar reports paused state").toBeVisible();
  364 |   expect(beforePerformance.frames).toBeGreaterThanOrEqual(30);
  365 |   expect(duringPerformance.frames).toBeGreaterThanOrEqual(45);
  366 |   expect(duringPerformance.frameIntervalMs.p95, "active preview keeps constrained p95 frame interval bounded").toBeLessThan(100);
  367 |   expect(duringPerformance.longTasks.filter((entry) => entry.duration > 250), "active preview has no extreme long task").toEqual([]);
  368 |   latestEvidence.performance = { before: beforePerformance, during: duringPerformance };
  369 |   await writeG7Json("raw/critical-flow-evidence.json", latestEvidence);
  370 |
  371 |   expect(activeDiagnostics?.pageErrors ?? [], "critical flow has no uncaught page errors").toEqual([]);
  372 |   expect(activeDiagnostics?.consoleErrors ?? [], "critical flow has no console errors").toEqual([]);
  373 | });
  374 |
```
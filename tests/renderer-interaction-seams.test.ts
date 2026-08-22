import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const router = source("components/AppStageRouter.tsx");
const stageModules = source("components/classroomStageModules.tsx");
const deferredPuppet = source("components/DeferredThreePuppetPreview.tsx");
const deferredFoundry = source("components/stages/foundry/DeferredThreeFoundryPreview.tsx");
const workflowStatus = source("utils/workflowStatus.ts");
const puppet = source("components/ThreePuppetPreview.tsx");
const initialSceneResourceUpload = source("runtime/render/initialSceneResourceUpload.ts");
const foundry = source("components/stages/foundry/ThreeFoundryPreview.tsx");
const design = source("components/stages/mechanism/DesignFoundryPreview.tsx");
const assembly = source("components/stages/assembly/AssemblyThreePreview.tsx");
const foundryStage = source("components/stages/foundry/MechanismFoundry.tsx");
const foundryGesture = source("components/stages/foundry/foundryHandleGesture.ts");
const foundryCanvas = source("components/stages/foundry/FoundryCanvasPane.tsx");
const performanceAudit = source("utils/performanceAudit.ts");
const transientController = source("runtime/render/transientValueController.ts");
const incrementalTopology = source("runtime/render/incrementalTopologyBuild.ts");
const foundryRenderLayers = source("components/stages/foundry/foundryThreeRenderLayers.ts");
const rendererPerformanceBrowser = source("tests/browser/renderer-performance.spec.ts");

assert(
  router.includes('import { CharacterSelection } from "./stages/character/CharacterSelection"'),
  "the mandatory Character shell is available without a first-click chunk parse",
);
assert(
  router.includes('mountedStage === "character"') && router.includes("suspendStageContent"),
  "Getting Started still prevents the Character viewer subtree from mounting",
);
assert(!stageModules.includes("characterPromise"), "Character is no longer a rejected/retried stage chunk");
assert(
  !stageModules.includes("Promise.all([loadPath(), loadFoundry()])") &&
    stageModules.includes("const task = tasks.shift()") &&
    stageModules.includes("finally(scheduleNext)") &&
    stageModules.includes("classifyClassroomStagePreloadReadiness") &&
    stageModules.includes("mayStartAdjacentStagePreload") &&
    stageModules.includes("data-three-initial-scene-ready") &&
    stageModules.includes("data-three-topology-ready") &&
    stageModules.includes('data-preview-load-state="failed"') &&
    stageModules.includes('"data-preview-load-state"') &&
    stageModules.includes("previewLoadFailed") &&
    stageModules.includes("new MutationObserver(evaluateReadiness)") &&
    stageModules.includes("readinessObserver?.disconnect()") &&
    stageModules.includes("cancelIdleCallback") &&
    stageModules.includes('mountedStage === "path"') &&
    !stageModules.includes(
      'mountedStage === "character" || mountedStage === "path"',
    ) &&
    router.includes("useAdjacentClassroomStagePreload"),
  "one adjacent stage waits for authoritative renderer readiness, then runs one cancellable idle preload at a time",
);
assert(
  deferredPuppet.includes('data-preview-load-state={failed ? "failed" : "loading"}') &&
    deferredPuppet.includes("setLoadAttempt((attempt) => attempt + 1)") &&
    deferredFoundry.includes('data-preview-load-state={failed ? "failed" : "loading"}') &&
    deferredFoundry.includes("setLoadAttempt((attempt) => attempt + 1)"),
  "both deferred Three previews expose an explicit failed state while retaining their in-session retry action",
);
const adjacentPreloadGate = stageModules.slice(
  stageModules.indexOf("export const useAdjacentClassroomStagePreload"),
  stageModules.indexOf("let assemblyPromise"),
);
assert.equal(
  adjacentPreloadGate.match(/scheduleNext\(\)/g)?.length,
  1,
  "the first adjacent-stage request has no path around the readiness gate",
);
assert(
  adjacentPreloadGate.indexOf("mayStartAdjacentStagePreload") <
    adjacentPreloadGate.indexOf("scheduleNext();"),
  "authoritative readiness or the bounded explicit fallback is checked before the first idle request",
);

assert.equal(
  workflowStatus.match(/validateForFabrication\(project\)/g)?.length,
  2,
  "workflow status validates only the two fabrication-owned stages",
);
assert(
  workflowStatus.indexOf("validateForFabrication(project)") > workflowStatus.indexOf('stage === "blueprint"'),
  "Character, Path, Foundry, and Design avoid fabrication validation",
);

for (const [name, text] of [
  ["Puppet", puppet],
  ["Foundry", foundry],
] as const) {
  assert(text.includes("highResolutionSessionController.recordSubmission"), `${name} reports real WebGL submissions`);
  assert(text.includes("data-three-effective-dpr"), `${name} exposes effective DPR telemetry`);
  assert(text.includes("data-three-requested-dpr-cap"), `${name} exposes requested-cap telemetry`);
}
assert(
  puppet.includes("highResolutionSessionController") &&
    foundry.includes("highResolutionSessionController"),
  "Puppet and Foundry consume one module-scoped High session authority",
);
const puppetInitialReadiness = puppet.slice(
  puppet.indexOf("const completeInitialSceneSettlement ="),
  puppet.indexOf("initialSceneSettlementCheckRef.current ="),
);
assert(
  puppet.includes("acquireAdaptiveTopologyBuildLease(") &&
    puppet.includes("releaseAdaptiveTopology();") &&
    puppet.includes("pendingInitialSceneResources() > 0") &&
    puppetInitialReadiness.includes("realizeInitialSceneResources({") &&
    puppetInitialReadiness.includes("roots.staticLayer") &&
    puppetInitialReadiness.includes("roots.partsLayer") &&
    puppetInitialReadiness.includes("roots.objectsLayer") &&
    puppetInitialReadiness.includes("roots.skeletonLayer") &&
    puppetInitialReadiness.includes("roots.pathsLayer") &&
    !puppetInitialReadiness.includes("roots.mechanismsLayer") &&
    puppetInitialReadiness.includes("submit: () => submitScene(false)") &&
    puppetInitialReadiness.indexOf("realizeInitialSceneResources({") <
      puppetInitialReadiness.indexOf("stateRef.current.dataset.threeTopologyReady = 'true'") &&
    puppetInitialReadiness.includes("renderer.getContext().isContextLost()") &&
    puppetInitialReadiness.indexOf("stateRef.current.dataset.threeTopologyReady = 'true'") <
      puppetInitialReadiness.indexOf("return true;") &&
    initialSceneResourceUpload.includes("publication.revision !== revision") &&
    initialSceneResourceUpload.includes("onReadyChange(true)"),
  "Puppet force-realizes retained Path resources, excludes mechanisms, and releases its High topology lease only after the exact canonical frame settles",
);
const puppetSceneObjectSettlement = puppet.slice(
  puppet.indexOf("const sceneObjectSignature"),
  puppet.indexOf("  useEffect(() => {\n    if (rendererStatus !== 'webgl') return;", puppet.indexOf("const sceneObjectSignature")),
);
assert(
  puppetSceneObjectSettlement.indexOf("initialSceneSettlementCheckRef.current?.invalidate();") <
    puppetSceneObjectSettlement.indexOf("clearGroup(roots.objectsLayer);") &&
    puppetSceneObjectSettlement.lastIndexOf("initialSceneSettlementCheckRef.current?.check();") >
      puppetSceneObjectSettlement.lastIndexOf("render();"),
  "scene-object replacement invalidates an older readiness generation and rechecks only after the new retained layer is installed and submitted",
);
assert(
  puppet.includes("ref={previewRef}") &&
    puppet.includes("data-three-initial-scene-ready={initialSceneReadyRef.current ? 'true' : 'false'}") &&
    puppet.includes("publishInitialSceneReady(false);\n      setRendererStatus('restoring')") &&
    rendererPerformanceBrowser.includes("toHaveAttribute('data-three-initial-scene-ready', 'true')"),
  "the production Puppet node owns a context-loss-safe readiness signal while detailed counters stay in the E2E state node",
);
assert(
  rendererPerformanceBrowser.includes("data-three-pending-initial-scene-resources") &&
    rendererPerformanceBrowser.includes("data-three-initial-scene-resource-upload") &&
    rendererPerformanceBrowser.includes("characterResourcesBeforeOrbit") &&
    !rendererPerformanceBrowser.includes("toBeGreaterThanOrEqual(expectedCharacterTextures)"),
  "the browser resource gate uses exact readiness plus stable renderer counters instead of assuming one GPU texture per art reference",
);
assert(
  puppet.includes("puppetInitialTopologySettlementSteps(") &&
    puppet.includes("phase === 'outline'") &&
    puppet.includes("phase === 'art'") &&
    puppet.includes("phase === 'hardware'") &&
    puppet.includes("if (runtime.finalized) return;") &&
    puppet.includes("disposeOwnedMaterials(runtime.mesh);") &&
    puppet.includes("disposeObject(runtime.mesh, false);"),
  "Puppet cold topology splits the first retained part and disposes a cancelled partial generation without publishing its identity",
);
for (const [name, text] of [
  ["Puppet", puppet],
  ["Foundry", foundry],
] as const) {
  assert(
    text.includes("earlyToleranceMs: renderPolicy.preset ===") &&
      text.includes("HIGH_RESOLUTION_CADENCE_EARLY_TOLERANCE_MS"),
    `${name} opts only High playback into the bounded cadence-boundary tolerance`,
  );
}

assert(
  puppet.includes("transientCamera.update") && !puppet.includes("setCameraOrbit({ yaw: start.yaw"),
  "Puppet pointermove no longer commits orbit state through React",
);
for (const [name, text] of [
  ["Foundry", foundryStage],
  ["Design", design],
  ["Assembly", assembly],
] as const) {
  assert(text.includes("transientCamera") || text.includes("transientFoundryCamera"), `${name} uses the shared transient camera seam`);
  assert(text.includes("finish()"), `${name} commits its final camera on release`);
}
const foundryOrbitRelease = foundryStage.slice(
  foundryStage.indexOf("const finishFoundryOrbit ="),
  foundryStage.indexOf("const handleFoundryWheel ="),
);
assert(
  foundryOrbitRelease.indexOf("transientFoundryCamera.finish()") <
    foundryOrbitRelease.indexOf("startTransition(() => {") &&
    foundryOrbitRelease.includes("setIsOrbitingFoundry(false)") &&
    foundryOrbitRelease.includes("setIsZoomingFoundry(false)") &&
    foundryOrbitRelease.includes("setIsPanningFoundry(false)") &&
    foundryOrbitRelease.includes("setFoundryCamera(finalCamera)"),
  "Foundry camera release presents the exact retained-scene camera before deferring nonvisual React state commits",
);
assert(
  foundry.includes("previousCamera === camera") && foundry.includes("cameraStateRef.current = view"),
  "the final Foundry React commit cannot duplicate the transient renderer submission",
);
assert(
  foundry.includes('overlay.style.visibility = cameraGestureActive ? "hidden" : ""'),
  "screen-space Foundry overlays cannot drift against an imperatively moving camera",
);
assert(
  puppet.includes("applyPuppetCameraRef.current(view);") &&
    foundry.includes("renderCameraRef.current(view);") &&
    !foundry.includes("renderCameraRef.current(view, true)"),
  "a paused pointer gesture cannot be misclassified as a >200ms playback submission gap",
);

const foundryDynamicScene = foundry.slice(
  foundry.indexOf("const renderDynamicScene ="),
  foundry.indexOf("renderDynamicRef.current = renderDynamicScene"),
);
assert(
  foundryDynamicScene.includes(
    "shouldRecordAdaptiveSubmission(\n      frame.measureSubmissionInterval,",
  ) &&
    (foundry.match(/measureSubmissionInterval: true/g)?.length ?? 0) === 1,
  "Foundry treats submission intervals as opt-in so idle canonical renders cannot downshift adaptive High",
);
const foundrySubmission = foundryDynamicScene.lastIndexOf(
  "renderCamera(cameraStateRef.current, measureSubmissionInterval);",
);
const foundryTelemetryPublish = foundryDynamicScene.lastIndexOf(
  "publishFoundryE2EDiagnosticsAfterRender();",
);
assert(
  foundrySubmission >= 0 && foundryTelemetryPublish > foundrySubmission,
  "Foundry submits the retained scene before serializing E2E datasets and screen targets",
);
const invalidSceneBranch = foundryDynamicScene.slice(
  foundryDynamicScene.indexOf(
    "if (renderPlan.validationErrors.length || physicalValidationErrors.length)",
  ),
  foundryDynamicScene.indexOf("const primitives ="),
);
const invalidSceneSubmission = invalidSceneBranch.indexOf(
  "renderCamera(cameraStateRef.current, measureSubmissionInterval);",
);
const invalidSceneTelemetry = invalidSceneBranch.indexOf(
  "if (E2E_DIAGNOSTICS && stateRef.current)",
);
assert(
  invalidSceneSubmission >= 0 && invalidSceneTelemetry > invalidSceneSubmission,
  "Foundry validation-error frames also submit before E2E cache telemetry",
);
assert(
  foundryDynamicScene.includes("threeSceneObjectScreenTargets") &&
    foundryDynamicScene.includes("threePartScreenTargets") &&
    foundryDynamicScene.includes("threeAssemblyBoardInstanceCount"),
  "post-submit Foundry diagnostics retain object, part, and assembly telemetry",
);
const foundryDynamicScheduling = foundry.slice(
  foundry.indexOf("renderDynamicRef.current = renderDynamicScene"),
  foundry.indexOf("const playbackClock = playback?.clock"),
);
assert(
  foundryDynamicScheduling.includes("useLayoutEffect(() => {") &&
    foundryDynamicScheduling.includes(
      'if (rendererStatus !== "webgl") return;',
    ) &&
    foundryDynamicScheduling.includes("if (transientFrame?.isActive()) return;") &&
    foundryDynamicScheduling.includes("if (transientFrame) return;") &&
    foundryDynamicScheduling.indexOf("if (transientFrame?.isActive()) return;") <
      foundryDynamicScheduling.indexOf("if (deferMechanismTopology)") &&
    foundryDynamicScheduling.indexOf("if (transientFrame) return;") <
      foundryDynamicScheduling.lastIndexOf("renderDynamicRef.current?.(nextFrame)"),
  "the first dynamic frame waits for renderer ownership, then the transient handle owner suppresses duplicate React layout renders while preserving the direct fallback",
);
assert(
  !foundryStage.includes("foundryGestureDraft.publish(foundry, true)") &&
    foundryStage.includes("foundryGestureDraft.publish(next, forceVisualSample)") &&
    foundryStage.includes("if (!shouldCommitFoundryGesture(event.type, drag.dirty))") &&
    foundryStage.includes("foundryGestureDraft.clear();"),
  "Foundry pointerdown stays render-free while the first changed sample activates the draft and no-op or cancelled gestures clear without committing",
);
const foundryParamDown = foundryStage.slice(
  foundryStage.indexOf("const handleFoundryParamPointerDown ="),
  foundryStage.indexOf("const handleFoundryParamPointerMove ="),
);
assert(
  foundryGesture.includes("const phase = clock.getPhase();") &&
    foundryGesture.indexOf("const phase = clock.getPhase();") <
      foundryGesture.indexOf("clock.stop();") &&
    foundryParamDown.includes("captureFoundryGesturePlayback(") &&
    foundryParamDown.includes("transientFoundryFrame.begin(restoreFrame);") &&
    foundryParamDown.includes("phase: playback.phase") &&
    foundryParamDown.includes("simulation: gestureSimulation") &&
    foundryParamDown.includes("createPathFitCandidate(landedFoundry)") &&
    foundryParamDown.includes("pathFitClient.cancel();") &&
    foundryParamDown.indexOf("captureFoundryGesturePlayback(") <
      foundryParamDown.indexOf("setFoundryPlaying(false)"),
  "Foundry captures and freezes the live playback phase before stopping, and an in-flight path fit is replaced by a bound gesture candidate before drag ownership begins",
);
const foundryExternalRevision = foundryStage.slice(
  foundryStage.indexOf("settleExternalFoundryFrame("),
  foundryStage.indexOf("const physicsOverlay ="),
);
assert(
  foundryExternalRevision.includes("mechanism: landedFoundry") &&
    foundryExternalRevision.includes("simulation: selectedPhysicalSimulation") &&
    foundryExternalRevision.includes("deferMechanismTopology: false") &&
    !foundryExternalRevision.includes("drag.restoreFrame") &&
    foundryExternalRevision.indexOf("settleExternalFoundryFrame(") <
      foundryExternalRevision.indexOf("foundryGestureDraft.clear();"),
  "external ProjectState replacement settles transient ownership with the newly rendered canonical frame before clearing the React draft",
);
const foundryParamMove = foundryStage.slice(
  foundryStage.indexOf("const applyFoundryParamHandleDrag ="),
  foundryStage.indexOf("const handleFoundryParamPointerDown ="),
);
assert(
    foundryParamMove.includes("mechanism: next") &&
    foundryParamMove.includes("landing: drag.landing") &&
    foundryParamMove.includes("deferMechanismTopology: true") &&
    foundryParamMove.includes("measureSubmissionInterval: false") &&
    !foundryParamMove.includes("transientFoundryFrame.submit(") &&
    foundryParamMove.indexOf("transientFoundryFrame.update(") <
      foundryParamMove.indexOf(
        "foundryGestureDraft.publish(next, forceVisualSample)",
      ) &&
    transientController.indexOf(
      "listeners.forEach((listener) => listener(deliveredValue));",
    ) < transientController.indexOf("deliveredCallback?.(deliveredValue);"),
  "D/Move handle motion renders the coalesced retained-scene value before its React draft publication, without raw-pointer submissions",
);
assert(
  foundryParamDown.includes("landing: { ...landing }") &&
    foundryParamDown.includes("simulation: gestureSimulation") &&
    foundryParamDown.includes("const gestureSimulation = gestureMechanism === foundry"),
  "M drag freezes both the landing and the matching gesture-candidate solver base at pointerdown so React draft publication cannot compound displacement",
);
assert(
  foundryCanvas.includes("transientFrame={transientFrame}") &&
    foundry.includes("transientFrame?.subscribe((frame) => {") &&
    (() => {
      const subscriber = foundry.slice(
        foundry.indexOf("transientFrame?.subscribe((frame) => {"),
        foundry.indexOf("[transientFrame]"),
      );
      return (
        subscriber.indexOf("recordFoundryGestureVisualEmission();") >= 0 &&
        subscriber.indexOf("recordFoundryGestureVisualEmission();") <
          subscriber.indexOf("renderDynamicRef.current?.(frame);")
      );
    })() &&
    performanceAudit.includes("foundryGestureVisualEmissions.push(performance.now())"),
  "the imperative handle channel records its production-audit emission immediately before the actual retained-scene render",
);
const foundryParamRelease = foundryStage.slice(
  foundryStage.indexOf("const handleFoundryParamPointerUp ="),
  foundryStage.indexOf("const keepCurrentAnchor ="),
);
assert(
  !foundryParamRelease.includes("transientFoundryFrame.update") &&
    foundryParamRelease.includes("transientFoundryFrame.restoreAndRelease(drag.restoreFrame)") &&
    foundryParamRelease.includes("transientFoundryFrame.finish();") &&
    foundryParamRelease.includes("startTransition(() => {") &&
    foundryParamRelease.includes("const fitted = setFoundryDraft(refreshed);") &&
    foundryParamRelease.includes("if (fitted) expectedCommittedFoundryRef.current = fitted;") &&
    foundryParamRelease.includes(
      "release: () => startTransition(() => foundryGestureDraft.clear())",
    ) &&
    (foundryParamRelease.match(/setFoundryDraft\(refreshed\)/g)?.length ?? 0) === 1,
  "cancel restores the canonical retained scene while pointer-up queues one durable commit and releases full canonical analysis at transition priority",
);
assert(
  (foundryStage.match(/retainFoundryGestureAnalysis\(/g)?.length ?? 0) >= 5 &&
    (foundry.match(/retainFoundryGestureAnalysis\(/g)?.length ?? 0) >= 2,
  "Foundry handle drafts reuse canonical path, range, overlay, fabrication-plan, and renderer-readiness analysis until release",
);
assert(
  puppet.includes("puppetInitialTopologyBatchPolicy(") &&
    puppet.includes("onBatchComplete: () => render()") &&
    puppet.includes("interBatchDelayFrames: initialTopologyPolicy.interBatchDelayFrames") &&
    incrementalTopology.indexOf("options.onBatchComplete?.({") <
      incrementalTopology.indexOf("interBatchDelayFrames = requestedInterBatchDelayFrames"),
  "cold Puppet construction submits each one-part slice before the scheduler can advance topology",
);
assert(
  foundry.includes("foundryInitialTopologySettlementSteps(") &&
    foundry.includes("measureSubmissionInterval: false") &&
    foundry.includes("publishInitialTopologyReady(true)") &&
    foundry.includes("data-three-topology-ready=") &&
    foundryRenderLayers.includes("renderPlan.layers.slice(0, visibleLayerCount)") &&
    foundryRenderLayers.includes("pinStacks.slice(0, visiblePinStackCount)"),
  "cold Foundry grows canonical layer and pin-stack prefixes and reports readiness only after the exact final submission",
);
const foundryStaticShaderSettlement = foundry.slice(
  foundry.indexOf("const shaderSettlementSteps = foundryInitialShaderSettlementSteps()"),
  foundry.indexOf("return () => {", foundry.indexOf("const shaderSettlementSteps = foundryInitialShaderSettlementSteps()")),
);
assert(
  foundryStaticShaderSettlement.includes(
    "const [firstShaderFamily, ...remainingShaderFamilies] =",
  ) &&
    foundryStaticShaderSettlement.indexOf(
      "renderShaderSettlementStep(firstShaderFamily);",
    ) <
      foundryStaticShaderSettlement.indexOf(
        "scheduleIncrementalTopologyBuild(\n        remainingShaderFamilies,",
      ) &&
    foundryStaticShaderSettlement.indexOf(
      "renderShaderSettlementStep(firstShaderFamily);",
    ) < foundryStaticShaderSettlement.indexOf('setRendererStatus("webgl")') &&
    foundryStaticShaderSettlement.indexOf(
      "scheduleIncrementalTopologyBuild(\n        remainingShaderFamilies,",
    ) < foundryStaticShaderSettlement.indexOf('setRendererStatus("webgl")') &&
    foundry.includes(
      "initialShaderSettlementActiveRef.current &&\n      !allowInitialShaderSettlement",
    ) &&
    foundryDynamicScene.includes(
      "if (initialShaderSettlementActiveRef.current) return;",
    ) &&
    foundry.includes("if (staticRoot.visible === showGrid) return;"),
  "Foundry submits the cold line and lit-surface shader families on separate frames, gates competing camera and dynamic renders, and reports WebGL ready only after the exact static scene",
);
assert(
  foundry.includes("createKeyedInitialTopologySettlement<") &&
    foundry.includes("initialTopologySettlementController.update(") &&
    foundry.includes(
      "foundryProjectTopologyRevision(automataContext.project)",
    ) &&
    foundry.includes(
      "completedInitialTopologyKeyRef.current !== initialTopologyKey",
    ) &&
    foundry.includes("return () => cancelAnimationFrame(frame);") &&
    foundry.includes("element.dataset.threeInitialTopologyStarts") &&
    foundry.includes("snapshot.stepsDelivered") &&
    (foundry.match(/cancelInitialTopologySettlement\(\);/g)?.length ?? 0) === 2 &&
    foundry.includes("!initialTopologySettlement || initialTopologySettlement.complete"),
  "Foundry cold settlement follows same-topology frames without effect-cleanup cancellation, restarts only for a new topology key, and exposes auxiliary scene contexts only on the canonical final slice",
);

console.log("renderer interaction source seams ok");

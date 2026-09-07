import { dismissStartupAnnouncement } from './startupHarness';
import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CHROMEBOOK_AUDIT_ENVIRONMENT,
  evaluateChromebookPlaybackAcceptance,
  percentiles,
  type ActionLatency,
  type ChromebookAcceptance,
  type PlaybackAudit,
  type PlaybackWarmPlateauEvidence,
} from "./chromebookAuditReport";
import {
  applyChromebookEmulation,
  collectChromebookHighResolutionTelemetry,
  collectChromebookRuntimeEnvironment,
  collectPlaybackAudit,
  installChromebookAuditInstrumentation,
  installChromebookAuditIsolation,
  measureClickToNextPaint,
  type ChromebookWebGLResourceDeletion,
  type ChromebookWebGLResourceDeletionBatch,
} from "./chromebookAuditHarness";
import {
  finishFoundryColdMountProbe,
  installFoundryColdMountProbe,
  type FoundryColdMountMarkers,
} from "./chromebookFoundryColdDiagnostic";
import {
  buildHighResolutionPressureEvidence,
  buildHighResolutionColdStageEvidence,
  buildHighResolutionSurfaceEvidence,
  advanceHighResolutionWarmPlateau,
  evaluateChromebookHighResolutionAcceptance,
  HIGH_RESOLUTION_DEVICE_SCALE_FACTOR,
  HIGH_RESOLUTION_NATIVE_DPR,
  HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS,
  HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS,
  HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL,
  HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
  HIGH_RESOLUTION_SAFE_START_DPR,
  HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES,
  initialHighResolutionWarmPlateauState,
  partitionScenarioLongTasks,
  playbackControlTestIdForSurface,
  sharedRendererContextPredatesStageClick,
  type ChromebookHighResolutionAuditReport,
  type HighResolutionScenarioEvidence,
  type HighResolutionColdStageProbe,
  type HighResolutionSurface,
  type HighResolutionWarmPlateauSample,
} from "./chromebookHighResolutionAudit";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";
import {
  startChromebookFoundryCdpTrace,
  stopChromebookFoundryCdpTrace,
} from "./chromebookCdpTrace";

const ENABLED = process.env.CHROMEBOOK_AUDIT === "1";
const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const TRACE_FOUNDRY = process.env.CHROMEBOOK_HIGH_RESOLUTION_TRACE === "1";
const TRACE_OUTPUT = process.env.CHROMEBOOK_HIGH_RESOLUTION_TRACE_OUTPUT ?? join(
  "/tmp",
  "chromebook-audit",
  "high-foundry-cdp-trace.json",
);
const SETTLED_PLAYBACK_MS = Number(
  process.env.CHROMEBOOK_HIGH_RESOLUTION_SETTLED_MS ?? 3_000,
);
const PROMOTION_PLAYBACK_MS = Number(
  process.env.CHROMEBOOK_HIGH_RESOLUTION_PROMOTION_MS ??
    HIGH_RESOLUTION_NATIVE_PROMOTION_AUDIT_MS,
);
const PRESSURE_AUDIT_MS = Number(
  process.env.CHROMEBOOK_HIGH_RESOLUTION_PRESSURE_MS ?? 5_500,
);
const PRESSURE_BUSY_MS = 43;
const PRESSURE_START_DELAY_MS = 500;
const OUTPUT = process.env.CHROMEBOOK_HIGH_RESOLUTION_AUDIT_OUTPUT ?? join(
  process.cwd(),
  "artifacts/chromebook-audit/high-resolution",
  `chromebook-high-resolution-${CHROMEBOOK_AUDIT_PROFILE.name}.json`,
);

for (const [name, value] of [
  ["CHROMEBOOK_HIGH_RESOLUTION_SETTLED_MS", SETTLED_PLAYBACK_MS],
  ["CHROMEBOOK_HIGH_RESOLUTION_PROMOTION_MS", PROMOTION_PLAYBACK_MS],
  ["CHROMEBOOK_HIGH_RESOLUTION_PRESSURE_MS", PRESSURE_AUDIT_MS],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite duration`);
  }
}

if (TRACE_FOUNDRY && ENFORCE) {
  throw new Error(
    "CDP tracing perturbs timing and is diagnostic-only; set CHROMEBOOK_AUDIT_ENFORCE=0",
  );
}

type SurfaceWindow = {
  startedAtMs: number;
  endedAtMs: number;
  playback?: PlaybackAudit;
  playbackAcceptance?: ChromebookAcceptance;
  promotionPlayback?: PlaybackAudit;
  promotionPlaybackAcceptance?: ChromebookAcceptance;
};

const browserNow = (page: Page) => page.evaluate(() => performance.now());
const afterTwoPaints = (page: Page) => page.evaluate(() =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  })
);

const waitForCharacterRendererBoundary = async (page: Page) => {
  const preview = page.getByTestId("character-three-puppet");
  const state = page.getByTestId("character-three-puppet-state");
  await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
  await expect(state).toHaveAttribute("data-three-topology-ready", "true");
  await expect(state).toHaveAttribute(
    "data-three-pending-initial-scene-resources",
    "0",
  );
  await expect(state).toHaveAttribute(
    "data-three-render-submissions",
    /^[1-9]\d*$/,
  );
  await expect(preview.locator("canvas.three-puppet-canvas")).toBeVisible();
  await afterTwoPaints(page);
  await expect(state).toHaveAttribute("data-three-topology-ready", "true");
  await expect(state).toHaveAttribute(
    "data-three-pending-initial-scene-resources",
    "0",
  );
};

const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-stage="character"]')).toBeVisible();
  await waitForCharacterRendererBoundary(page);
};

const configurePreset = async (
  page: Page,
  preset: "balanced" | "high",
) => {
  await page.getByTestId("workflow-stage-options").click();
  await expect(page.locator('[data-stage="options"]')).toBeVisible();
  const control = page.getByLabel("Performance preset");
  await control.selectOption(preset);
  await expect(control).toHaveValue(preset);
  await afterTwoPaints(page);
};

const startColdStageProbe = async (
  page: Page,
  surface: HighResolutionSurface,
) => page.evaluate((surface) => {
  type Probe = Omit<
    HighResolutionColdStageProbe,
    | "completedAtMs"
    | "scriptResources"
    | "foundryChildMarkers"
    | "predecessorResourceDisposal"
  >;
  type ProbeStore = {
    probe: Probe;
    observer: MutationObserver;
    clickHandler: (event: MouseEvent) => void;
    record: () => void;
    predecessorSurface: "character" | "path";
    predecessorCanvas: HTMLCanvasElement | null;
    predecessorCanvasClassNameAtStart: string | null;
    predecessorCanvasDetachObservedAtMs: number | null;
    predecessorContextIndices: number[];
    resourceDeletionStartIndex: number;
    resourceDeletionBatchStartIndex: number;
  };
  type AuditState = {
    foundryTopologyBuilds: number;
    foundryGeometryCacheSize: number;
    foundryMaterialCacheSize: number;
    graphicsContexts: Array<{
      createdAtMs: number;
      canvas: HTMLCanvasElement;
      frameSubmissions: Array<{ atMs: number }>;
    }>;
    webglResourceDeletions: ChromebookWebGLResourceDeletion[];
    webglResourceDeletionBatches: ChromebookWebGLResourceDeletionBatch[];
  };
  const host = window as Window & {
    __MOTIONSMITH_HIGH_COLD_STAGE_PROBE__?: ProbeStore;
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: AuditState;
  };
  const previous = host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__;
  if (previous) {
    previous.observer.disconnect();
    document.removeEventListener("click", previous.clickHandler, true);
  }
  const requestedAtMs = performance.now();
  const auditAtStart = host.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  const predecessorSurface = surface === "path" ? "character" : "path";
  const predecessorCanvas = document.querySelector<HTMLCanvasElement>(
    surface === "path"
      ? '[data-testid="character-three-puppet"] canvas.three-puppet-canvas'
      : '[data-testid="path-three-puppet"] canvas.three-puppet-canvas',
  );
  const predecessorContextIndices = predecessorCanvas && auditAtStart
    ? auditAtStart.graphicsContexts.flatMap((entry, index) =>
        entry.canvas === predecessorCanvas ? [index] : []
      )
    : [];
  const predecessorCanvasClassNameAtStart = predecessorCanvas
    ? typeof predecessorCanvas.className === "string"
      ? predecessorCanvas.className
      : ""
    : null;
  const probe: Probe = {
    surface,
    requestedAtMs,
    clickedAtMs: null,
    transitionFrameAtMs: null,
    stageContentAtMs: null,
    inspectorMountedAtMs: null,
    exampleMountedAtMs: null,
    previewLoadingAtMs: null,
    previewMountedAtMs: null,
    contextCreatedAtMs: null,
    rendererWebglAtMs: null,
    firstGlSubmissionAtMs: null,
    topologyReadyAtMs: null,
    initialSceneResourcesReadyAtMs: null,
  };
  const mark = (key: keyof Probe, condition: boolean, atMs = performance.now()) => {
    if (condition && probe[key] === null) {
      (probe as Record<keyof Probe, unknown>)[key] = atMs;
    }
  };
  const record = () => {
    const now = performance.now();
    if (
      predecessorCanvas &&
      !predecessorCanvas.isConnected &&
      host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__
        ?.predecessorCanvasDetachObservedAtMs ===
        null
    ) {
      host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__!
        .predecessorCanvasDetachObservedAtMs = now;
    }
    const preview = document.querySelector<HTMLElement>(
      surface === "path"
        ? '[data-testid="path-three-puppet"]'
        : '[data-testid="foundry-preview"]',
    );
    const stateElement = document.querySelector<HTMLElement>(
      surface === "path"
        ? '[data-testid="path-three-puppet-state"]'
        : '[data-testid="foundry-camera-rig"]',
    );
    const inspector = document.querySelector(
      surface === "path"
        ? '[data-testid="quick-rig-helper"]'
        : '[data-testid="foundry-sensemaking-panel"]',
    );
    const loading = document.querySelector(
      surface === "path"
        ? '[data-testid="path-three-puppet-loading"]'
        : '[data-testid="foundry-preview-loading"]',
    );
    mark("transitionFrameAtMs", Boolean(
      document.querySelector('[data-testid="stage-transition-frame"]'),
    ), now);
    mark("stageContentAtMs", Boolean(
      document.querySelector(`[data-stage="${surface}"]`),
    ), now);
    mark("inspectorMountedAtMs", Boolean(inspector), now);
    mark("exampleMountedAtMs", Boolean(
      document.querySelector('[data-testid="classroom-example-video"]'),
    ), now);
    mark("previewLoadingAtMs", Boolean(loading), now);
    mark("previewMountedAtMs", Boolean(preview), now);
    mark(
      "rendererWebglAtMs",
      preview?.getAttribute("data-three-renderer-status") === "webgl",
      now,
    );
    const audit = host.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    const canvas = preview?.querySelector<HTMLCanvasElement>(
      surface === "path"
        ? "canvas.three-puppet-canvas"
        : "canvas.foundry-three-canvas",
    );
    const context = canvas
      ? audit?.graphicsContexts.find((entry) => entry.canvas === canvas)
      : undefined;
    if (context && probe.contextCreatedAtMs === null) {
      probe.contextCreatedAtMs = context.createdAtMs;
    }
    if (context && probe.firstGlSubmissionAtMs === null) {
      const firstSubmission = context.frameSubmissions.find((submission) =>
        submission.atMs >= (
          probe.previewMountedAtMs ?? probe.clickedAtMs ?? requestedAtMs
        )
      );
      if (firstSubmission) probe.firstGlSubmissionAtMs = firstSubmission.atMs;
    }
    if (!stateElement || !audit) return;
    const topologyReady = surface === "path"
      ? stateElement.getAttribute("data-three-topology-ready") === "true"
      : Number(stateElement.getAttribute("data-three-dynamic-build-count") ?? "0") > 0 &&
        Number(stateElement.getAttribute("data-three-part-count") ?? "0") > 0 &&
        audit.foundryTopologyBuilds > 0 &&
        audit.foundryGeometryCacheSize > 0 &&
        audit.foundryMaterialCacheSize > 0 &&
        Number(stateElement.getAttribute("data-three-geometry-cache-size") ?? "0") ===
          audit.foundryGeometryCacheSize &&
        Number(stateElement.getAttribute("data-three-material-cache-size") ?? "0") ===
          audit.foundryMaterialCacheSize;
    mark("topologyReadyAtMs", topologyReady, now);
    mark(
      "initialSceneResourcesReadyAtMs",
      topologyReady && (
        surface === "foundry" ||
        stateElement.getAttribute(
          "data-three-pending-initial-scene-resources",
        ) === "0"
      ),
      now,
    );
  };
  const clickHandler = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(`[data-testid="workflow-stage-${surface}"]`)) return;
    probe.clickedAtMs ??= performance.now();
    record();
  };
  const observer = new MutationObserver(record);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      "data-three-renderer-status",
      "data-three-topology-ready",
      "data-three-renderer-texture-count",
      "data-three-dynamic-build-count",
      "data-three-geometry-cache-size",
      "data-three-material-cache-size",
      "data-three-pending-initial-scene-resources",
      "data-stage",
      "data-testid",
    ],
  });
  document.addEventListener("click", clickHandler, true);
  host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__ = {
    probe,
    observer,
    clickHandler,
    record,
    predecessorSurface,
    predecessorCanvas,
    predecessorCanvasClassNameAtStart,
    predecessorCanvasDetachObservedAtMs: null,
    predecessorContextIndices,
    resourceDeletionStartIndex:
      auditAtStart?.webglResourceDeletions.length ?? 0,
    resourceDeletionBatchStartIndex:
      auditAtStart?.webglResourceDeletionBatches.length ?? 0,
  };
  record();
}, surface);

const finishColdStageProbe = (
  page: Page,
  surface: HighResolutionSurface,
  foundryChildMarkers: FoundryColdMountMarkers | null,
): Promise<HighResolutionColdStageProbe> => page.evaluate((input) => {
  const { surface, foundryChildMarkers } = input;
  type ProbeStore = {
    probe: Omit<
      HighResolutionColdStageProbe,
      | "completedAtMs"
      | "scriptResources"
      | "foundryChildMarkers"
      | "predecessorResourceDisposal"
    >;
    observer: MutationObserver;
    clickHandler: (event: MouseEvent) => void;
    record: () => void;
    predecessorSurface: "character" | "path";
    predecessorCanvas: HTMLCanvasElement | null;
    predecessorCanvasClassNameAtStart: string | null;
    predecessorCanvasDetachObservedAtMs: number | null;
    predecessorContextIndices: number[];
    resourceDeletionStartIndex: number;
    resourceDeletionBatchStartIndex: number;
  };
  type AuditState = {
    webglResourceDeletions: ChromebookWebGLResourceDeletion[];
    webglResourceDeletionBatches: ChromebookWebGLResourceDeletionBatch[];
  };
  const host = window as Window & {
    __MOTIONSMITH_HIGH_COLD_STAGE_PROBE__?: ProbeStore;
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: AuditState;
  };
  const store = host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__;
  if (!store || store.probe.surface !== surface) {
    throw new Error(`${surface} cold-stage probe is unavailable`);
  }
  store.record();
  store.observer.disconnect();
  document.removeEventListener("click", store.clickHandler, true);
  delete host.__MOTIONSMITH_HIGH_COLD_STAGE_PROBE__;
  const completedAtMs = performance.now();
  const clickedAtMs = store.probe.clickedAtMs ?? store.probe.requestedAtMs;
  const roleFor = (name: string) => {
    const file = new URL(name).pathname.split("/").at(-1) ?? name;
    if (
      (surface === "path" && file.startsWith("PathEditor-")) ||
      (surface === "foundry" && file.startsWith("MechanismFoundry-"))
    ) return "stage-adapter" as const;
    if (
      file.startsWith("ThreePuppetPreview-") ||
      file.startsWith("DeferredThreePuppetPreview-") ||
      file.startsWith("ThreeFoundryPreview-")
    ) return "renderer" as const;
    if (file.startsWith("ClassroomExampleVideo-")) {
      return "inspector-example" as const;
    }
    if (file.startsWith("motion-")) return "motion-dependency" as const;
    return "other-script" as const;
  };
  const scriptResources = (performance.getEntriesByType("resource") as
    PerformanceResourceTiming[])
    .filter((entry) => entry.initiatorType === "script")
    .map((entry) => ({
      name: entry.name,
      role: roleFor(entry.name),
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
      transferSize: entry.transferSize,
      decodedBodySize: entry.decodedBodySize,
      loadedBeforeClick: entry.responseEnd <= clickedAtMs,
    }))
    .filter((entry) =>
      entry.role !== "other-script" ||
      (entry.startTime < completedAtMs && entry.responseEnd > store.probe.requestedAtMs)
    );
  const ownershipFor = (canvasClassName: string) =>
    canvasClassName === store.predecessorCanvasClassNameAtStart
      ? "predecessor-canvas" as const
      : "successor-on-shared-context" as const;
  const audit = host.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  const deletions = (audit?.webglResourceDeletions ?? [])
    .slice(store.resourceDeletionStartIndex)
    .filter((deletion) =>
      deletion.atMs >= store.probe.requestedAtMs &&
      deletion.atMs <= completedAtMs &&
      store.predecessorContextIndices.includes(deletion.contextIndex)
    )
    .map((deletion) => ({
      ...deletion,
      ownership: ownershipFor(deletion.canvasClassName),
    }));
  const batches = (audit?.webglResourceDeletionBatches ?? [])
    .slice(store.resourceDeletionBatchStartIndex)
    .filter((batch) =>
      batch.firstAtMs >= store.probe.requestedAtMs &&
      batch.firstAtMs <= completedAtMs &&
      store.predecessorContextIndices.includes(batch.contextIndex)
    )
    .map((batch) => ({
      ...batch,
      ownership: ownershipFor(batch.canvasClassName),
    }));
  return {
    ...store.probe,
    completedAtMs,
    scriptResources,
    foundryChildMarkers,
    predecessorResourceDisposal: {
      predecessorSurface: store.predecessorSurface,
      contextIndices: [...store.predecessorContextIndices],
      canvasClassNameAtStart: store.predecessorCanvasClassNameAtStart,
      canvasDetachObservedAtMs:
        store.predecessorCanvasDetachObservedAtMs,
      deletions,
      batches,
    },
  };
}, { surface, foundryChildMarkers });

const openSurface = async (page: Page, surface: HighResolutionSurface) => {
  await startColdStageProbe(page, surface);
  if (surface === "foundry") await installFoundryColdMountProbe(page);
  await page.getByTestId(`workflow-stage-${surface}`).click();
  await expect(page.locator(`[data-stage="${surface}"]`)).toBeVisible();
  await expect(page.getByTestId("stage-left-pane")).toHaveAttribute(
    "data-pane-content-ready",
    "true",
  );
  await expect(page.getByTestId("stage-right-inspector")).toHaveAttribute(
    "data-pane-content-ready",
    "true",
  );
  if (surface === "path") {
    const preview = page.getByTestId("path-three-puppet");
    const state = page.getByTestId("path-three-puppet-state");
    await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
    await expect(state).toHaveAttribute("data-three-topology-ready", "true");
    await expect(page.locator("canvas.three-puppet-canvas")).toBeVisible();
  } else {
    await expect(page.getByTestId("foundry-preview")).toHaveAttribute(
      "data-three-renderer-status",
      "webgl",
    );
    await expect(page.locator("canvas.foundry-three-canvas")).toBeVisible();
  }
  await expect.poll(async () => {
    const sample = await readWarmPlateauSample(page, surface);
    return {
      rendererReady: sample.rendererReady,
      topologyReady: sample.topologyReady,
      initialSceneResourcesReady: sample.initialSceneResourcesReady,
    };
  }, {
    message: `${surface} cold renderer, topology, and part art become ready`,
    intervals: [0],
    timeout: 60_000,
  }).toEqual({
    rendererReady: true,
    topologyReady: true,
    initialSceneResourcesReady: true,
  });
  await afterTwoPaints(page);
  const foundryChildMarkers = surface === "foundry"
    ? (await finishFoundryColdMountProbe(page)).markers
    : null;
  const coldProbe = await finishColdStageProbe(
    page,
    surface,
    foundryChildMarkers,
  );
  return { startedAtMs: coldProbe.requestedAtMs, coldProbe };
};

const readWarmPlateauSample = (
  page: Page,
  surface: HighResolutionSurface,
): Promise<HighResolutionWarmPlateauSample> => page.evaluate((surface) => {
  type AuditState = {
    reactCommits: number;
    foundryTopologyBuilds: number;
    foundryGeometryCacheSize: number;
    foundryMaterialCacheSize: number;
    webgl: {
      contextsCreated: number;
      contextsLost: number;
      contextsRestored: number;
      resources: Record<string, { created: number; deleted: number; live: number }>;
    };
    graphicsContexts: Array<{
      canvas: HTMLCanvasElement;
      frameSubmissions: Array<{ globalGlIndex: number }>;
    }>;
  };
  const audit = (window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: AuditState;
  }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  const preview = document.querySelector<HTMLElement>(
    surface === "path"
      ? '[data-testid="path-three-puppet"]'
      : '[data-testid="foundry-preview"]',
  );
  const topologyState = document.querySelector<HTMLElement>(
    surface === "path"
      ? '[data-testid="path-three-puppet-state"]'
      : '[data-testid="foundry-camera-rig"]',
  );
  const canvasSelector = surface === "path"
    ? "canvas.three-puppet-canvas"
    : "canvas.foundry-three-canvas";
  const canvas = preview?.querySelector<HTMLCanvasElement>(canvasSelector);
  if (!audit || !preview || !topologyState || !canvas) {
    throw new Error(`${surface} playback plateau diagnostics are unavailable`);
  }
  const contextIndex = audit.graphicsContexts.findIndex(
    (entry) => entry.canvas === canvas,
  );
  const context = audit.graphicsContexts[contextIndex];
  const globalGlIndex = context?.frameSubmissions.at(-1)?.globalGlIndex ?? -1;
  const resources = Object.fromEntries(
    Object.entries(audit.webgl.resources)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const liveResources = Object.values(audit.webgl.resources)
    .reduce((sum, counters) => sum + counters.live, 0);
  const liveResourcesSignature = JSON.stringify(Object.fromEntries(
    Object.entries(audit.webgl.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, counters.live]),
  ));
  const liveResourcesByKind = Object.fromEntries(
    Object.entries(audit.webgl.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, counters.live]),
  );
  const resourceCountersByKind = Object.fromEntries(
    Object.entries(audit.webgl.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, {
        created: counters.created,
        deleted: counters.deleted,
        live: counters.live,
      }]),
  );
  const topologyReady = surface === "path"
    ? topologyState.getAttribute("data-three-topology-ready") === "true"
    : Number(topologyState.getAttribute("data-three-dynamic-build-count") ?? "0") > 0 &&
      Number(topologyState.getAttribute("data-three-part-count") ?? "0") > 0 &&
      audit.foundryTopologyBuilds > 0 &&
      audit.foundryGeometryCacheSize > 0 &&
      audit.foundryMaterialCacheSize > 0 &&
      Number(topologyState.getAttribute("data-three-geometry-cache-size") ?? "0") ===
        audit.foundryGeometryCacheSize &&
      Number(topologyState.getAttribute("data-three-material-cache-size") ?? "0") ===
        audit.foundryMaterialCacheSize;
  const declaredTextureAttribute = topologyState.getAttribute(
    surface === "path"
      ? "data-three-part-texture-count"
      : "data-three-part-art-count",
  );
  const rendererTextureAttribute = topologyState.getAttribute(
    "data-three-renderer-texture-count",
  );
  const declaredPartTextures = Number(declaredTextureAttribute);
  const rendererTextures = Number(rendererTextureAttribute);
  const pendingInitialSceneResourcesAttribute = topologyState.getAttribute(
    "data-three-pending-initial-scene-resources",
  );
  const parsedPendingInitialSceneResources = Number(
    pendingInitialSceneResourcesAttribute,
  );
  const pendingInitialSceneResources =
    surface === "path" &&
    pendingInitialSceneResourcesAttribute !== null &&
    Number.isFinite(parsedPendingInitialSceneResources) &&
    parsedPendingInitialSceneResources >= 0
      ? parsedPendingInitialSceneResources
      : null;
  const initialSceneResourcesReady = topologyReady && (
    surface === "foundry" || pendingInitialSceneResources === 0
  );
  const canvasCount = document.querySelectorAll(canvasSelector).length;
  return {
    globalGlIndex,
    rendererReady:
      preview.getAttribute("data-three-renderer-status") === "webgl" &&
      canvas.isConnected &&
      canvasCount === 1 &&
      contextIndex >= 0 &&
      globalGlIndex >= 0 &&
      audit.webgl.contextsLost === 0 &&
      audit.webgl.contextsRestored === 0,
    topologyReady,
    initialSceneResourcesReady,
    pendingInitialSceneResources,
    declaredPartTextures,
    rendererTextures,
    contextIndex,
    canvasCount,
    contextsCreated: audit.webgl.contextsCreated,
    contextsLost: audit.webgl.contextsLost,
    contextsRestored: audit.webgl.contextsRestored,
    reactCommits: audit.reactCommits,
    foundryTopologyBuilds: audit.foundryTopologyBuilds,
    foundryGeometryCacheSize: audit.foundryGeometryCacheSize,
    foundryMaterialCacheSize: audit.foundryMaterialCacheSize,
    liveResources,
    liveResourcesByKind,
    resourceCountersByKind,
    liveResourcesSignature,
    resourcesSignature: JSON.stringify(resources),
  };
}, surface);

const warmPlaybackPlateau = async (
  page: Page,
  surface: HighResolutionSurface,
): Promise<PlaybackWarmPlateauEvidence> => {
  const startedAtMs = await browserNow(page);
  const controls = page.getByTestId(playbackControlTestIdForSurface(surface));
  const play = controls.getByRole("button", { name: "Play", exact: true });
  const pause = controls.getByRole("button", { name: "Pause", exact: true });
  await expect(play).toBeVisible();
  const playTiming = await measureClickToNextPaint(play);
  await expect(pause).toBeVisible();
  let state = initialHighResolutionWarmPlateauState();
  let lastSample: HighResolutionWarmPlateauSample | undefined;
  let pauseNextPaintMs = 0;
  try {
    await expect.poll(async () => {
      lastSample = await readWarmPlateauSample(page, surface);
      state = advanceHighResolutionWarmPlateau(state, lastSample);
      return state.stableActualFrames;
    }, {
      message: `${surface} playback ownership settles across actual GL frames`,
      intervals: [0],
      timeout: 60_000,
    }).toBeGreaterThanOrEqual(HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES);
  } finally {
    if (await pause.isVisible()) {
      pauseNextPaintMs = (await measureClickToNextPaint(pause)).nextPaintMs;
    }
  }
  await expect(play).toBeVisible();
  await afterTwoPaints(page);
  if (!lastSample) throw new Error(`${surface} warm plateau produced no sample`);
  const pausedSample = await readWarmPlateauSample(page, surface);
  await afterTwoPaints(page);
  const quiescentSample = await readWarmPlateauSample(page, surface);
  expect(
    {
      rendererReady: quiescentSample.rendererReady,
      topologyReady: quiescentSample.topologyReady,
      initialSceneResourcesReady: quiescentSample.initialSceneResourcesReady,
      pendingInitialSceneResources:
        quiescentSample.pendingInitialSceneResources,
      declaredPartTextures: quiescentSample.declaredPartTextures,
      rendererTextures: quiescentSample.rendererTextures,
      reactCommits: quiescentSample.reactCommits,
      topology: quiescentSample.foundryTopologyBuilds,
      geometry: quiescentSample.foundryGeometryCacheSize,
      material: quiescentSample.foundryMaterialCacheSize,
      resources: quiescentSample.liveResourcesSignature,
      resourceCounters: quiescentSample.resourcesSignature,
    },
    `${surface} ownership remains stable after pausing the warm-up`,
  ).toEqual({
    rendererReady: true,
    topologyReady: true,
    initialSceneResourcesReady: true,
    pendingInitialSceneResources:
      pausedSample.pendingInitialSceneResources,
    declaredPartTextures: pausedSample.declaredPartTextures,
    rendererTextures: pausedSample.rendererTextures,
    reactCommits: pausedSample.reactCommits,
    topology: lastSample.foundryTopologyBuilds,
    geometry: lastSample.foundryGeometryCacheSize,
    material: lastSample.foundryMaterialCacheSize,
    resources: pausedSample.liveResourcesSignature,
    resourceCounters: pausedSample.resourcesSignature,
  });
  return {
    surface,
    requiredStableActualFrames: HIGH_RESOLUTION_WARM_PLATEAU_ACTUAL_FRAMES,
    stableActualFrames: state.stableActualFrames,
    startedAtMs,
    pausedAtMs: await browserNow(page),
    playNextPaintMs: playTiming.nextPaintMs,
    pauseNextPaintMs,
    firstGlobalGlIndex: state.firstGlobalGlIndex,
    lastGlobalGlIndex: state.lastGlobalGlIndex,
    rendererReady: quiescentSample.rendererReady,
    topologyReady: quiescentSample.topologyReady,
    initialSceneResourcesReady: quiescentSample.initialSceneResourcesReady,
    pendingInitialSceneResources:
      quiescentSample.pendingInitialSceneResources,
    declaredPartTextures: quiescentSample.declaredPartTextures,
    rendererTextures: quiescentSample.rendererTextures,
    reactCommits: quiescentSample.reactCommits,
    foundryTopologyBuilds: quiescentSample.foundryTopologyBuilds,
    foundryGeometryCacheSize: quiescentSample.foundryGeometryCacheSize,
    foundryMaterialCacheSize: quiescentSample.foundryMaterialCacheSize,
    liveResources: quiescentSample.liveResources,
    liveResourcesByKind: quiescentSample.liveResourcesByKind,
    resourceCountersByKind: quiescentSample.resourceCountersByKind,
    contextsLost: quiescentSample.contextsLost,
    contextsRestored: quiescentSample.contextsRestored,
  };
};

const measureSettledPlayback = async (
  page: Page,
  surface: HighResolutionSurface,
  durationMs: number,
): Promise<Pick<SurfaceWindow, "playback" | "playbackAcceptance">> => {
  const warmPlateau = await warmPlaybackPlateau(page, surface);
  const controls = page.getByTestId(playbackControlTestIdForSurface(surface));
  await expect(
    controls.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  const playback = await collectPlaybackAudit(page, durationMs, {
    controlsTestId: playbackControlTestIdForSurface(surface),
    warmPlateau,
  });
  if (!playback.controlActions) {
    throw new Error(`${surface} playback did not record control latency`);
  }
  const actions: ActionLatency[] = [
    {
      label: "play",
      kind: "click",
      durationMs: playback.controlActions.playNextPaintMs,
    },
    {
      label: "pause",
      kind: "click",
      durationMs: playback.controlActions.pauseNextPaintMs,
    },
  ];
  return {
    playback,
    playbackAcceptance: evaluateChromebookPlaybackAcceptance(
      playback,
      percentiles(actions.map((action) => action.durationMs)),
    ),
  };
};

const runScenario = async ({
  browser,
  browserVersion,
  preset,
  traceFoundry = false,
}: {
  browser: Browser;
  browserVersion: string;
  preset: "balanced" | "high";
  traceFoundry?: boolean;
}): Promise<HighResolutionScenarioEvidence> => {
  const context = await browser.newContext({
    viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    deviceScaleFactor: HIGH_RESOLUTION_DEVICE_SCALE_FACTOR,
  });
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();
  const client = await installChromebookAuditIsolation(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? '/', { waitUntil: "domcontentloaded" });
    await dismissStartupAnnouncement(page);
    await expect(page.locator("#boot-loader")).toHaveCount(0, {
      timeout: 180_000,
    });
    expect(
      await page.locator('script[src*="/@vite/client"]').count(),
      "High-resolution audit runs the production preview",
    ).toBe(0);
    await openWavingArm(page);
    await configurePreset(page, preset);
    await applyChromebookEmulation(page, client, {
      deviceScaleFactor: HIGH_RESOLUTION_DEVICE_SCALE_FACTOR,
    });

    const pathOpen = await openSurface(page, "path");
    const pathContextCreatedBeforeClick =
      sharedRendererContextPredatesStageClick(
        pathOpen.coldProbe.contextCreatedAtMs,
        pathOpen.coldProbe.clickedAtMs,
      );
    const pathStartedAtMs = pathOpen.startedAtMs;
    let pathPlayback: Pick<SurfaceWindow, "playback" | "playbackAcceptance"> = {};
    let pathPromotion: Pick<
      SurfaceWindow,
      "promotionPlayback" | "promotionPlaybackAcceptance"
    > = {};
    if (preset === "balanced") {
      pathPlayback = await measureSettledPlayback(
        page,
        "path",
        SETTLED_PLAYBACK_MS,
      );
    } else if (CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottlingRate === 4) {
      const promotion = await measureSettledPlayback(
        page,
        "path",
        PROMOTION_PLAYBACK_MS,
      );
      pathPromotion = {
        promotionPlayback: promotion.playback,
        promotionPlaybackAcceptance: promotion.playbackAcceptance,
      };
      pathPlayback = await measureSettledPlayback(
        page,
        "path",
        SETTLED_PLAYBACK_MS,
      );
    }
    const pathEndedAtMs = await browserNow(page);

    const traceSession = traceFoundry
      ? await startChromebookFoundryCdpTrace(page, client, TRACE_OUTPUT)
      : null;
    let foundryOpen: Awaited<ReturnType<typeof openSurface>> | undefined;
    try {
      foundryOpen = await openSurface(page, "foundry");
    } finally {
      if (traceSession) {
        await stopChromebookFoundryCdpTrace(
          traceSession,
          foundryOpen?.coldProbe.foundryChildMarkers ?? null,
        );
      }
    }
    if (!foundryOpen) throw new Error("Foundry failed before cold trace completion");
    const foundryStartedAtMs = foundryOpen.startedAtMs;
    let pressureWindow:
      | {
          startedAtMs: number;
          endedAtMs: number;
          timerTaskCount: number;
          playback: PlaybackAudit;
        }
      | undefined;
    if (
      preset === "high" &&
      CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottlingRate === 6
    ) {
      const warmPlateau = await warmPlaybackPlateau(page, "foundry");
      const pressurePlayback = await collectPlaybackAudit(
        page,
        PRESSURE_AUDIT_MS,
        {
          controlsTestId: playbackControlTestIdForSurface("foundry"),
          warmPlateau,
          syntheticPressure: {
            busyMs: PRESSURE_BUSY_MS,
            startDelayMs: PRESSURE_START_DELAY_MS,
          },
        },
      );
      const pressure = pressurePlayback.syntheticPressure;
      if (!pressure) throw new Error("Bounded pressure telemetry is missing");
      pressureWindow = {
        startedAtMs: pressure.startedAtMs,
        endedAtMs: pressure.endedAtMs,
        timerTaskCount: pressure.timerTaskCount,
        playback: pressurePlayback,
      };
    }
    const foundryPlayback = await measureSettledPlayback(
      page,
      "foundry",
      SETTLED_PLAYBACK_MS,
    );
    const foundryEndedAtMs = await browserNow(page);
    const telemetry = await collectChromebookHighResolutionTelemetry(page);
    const path = buildHighResolutionSurfaceEvidence({
      telemetry,
      surface: "path",
      startedAtMs: pathStartedAtMs,
      endedAtMs: pathEndedAtMs,
      ...pathPlayback,
      ...pathPromotion,
    });
    const foundry = buildHighResolutionSurfaceEvidence({
      telemetry,
      surface: "foundry",
      startedAtMs: foundryStartedAtMs,
      endedAtMs: foundryEndedAtMs,
      ...foundryPlayback,
    });
    const scenario: HighResolutionScenarioEvidence = {
      preset,
      environment: await collectChromebookRuntimeEnvironment(
        page,
        browserVersion,
        "feature-action",
        { expectedDeviceScaleFactor: HIGH_RESOLUTION_DEVICE_SCALE_FACTOR },
      ),
      backingStoreMutationProbeSupported:
        telemetry.backingStoreMutationProbeSupported,
      contextsLost: telemetry.contextsLost,
      contextsRestored: telemetry.contextsRestored,
      pageErrors,
      pathContextCreatedBeforeClick,
      coldStages: {
        path: buildHighResolutionColdStageEvidence(
          pathOpen.coldProbe,
          telemetry.longTaskEntries,
        ),
        foundry: buildHighResolutionColdStageEvidence(
          foundryOpen.coldProbe,
          telemetry.longTaskEntries,
        ),
      },
      measuredLongTasks: (() => {
        const measuredPhaseWindows = ([
          { label: "path-promotion", playback: pathPromotion.promotionPlayback },
          { label: "path-settled", playback: pathPlayback.playback },
          { label: "foundry-pressure", playback: pressureWindow?.playback },
          { label: "foundry-settled", playback: foundryPlayback.playback },
        ] satisfies Array<{ label: string; playback?: PlaybackAudit }>).flatMap(
          ({ label, playback }) => playback
            ? [{ label, ...playback.timedWindow }]
            : [],
        );
        const rawEntries = telemetry.longTaskEntries.filter((entry) =>
          entry.startTime < foundryEndedAtMs &&
          entry.startTime + entry.duration > pathStartedAtMs
        );
        const auditInternalMemoryMeasurementWindows =
          telemetry.auditInternalMemoryMeasurementWindows.filter((window) =>
            window.startedAtMs < foundryEndedAtMs &&
            window.endedAtMs > pathStartedAtMs
          );
        const {
          appWorkEntries,
          excludedProbeEntries,
          outsideMeasuredPhaseEntries,
          phaseAttribution,
        } =
          partitionScenarioLongTasks(
            rawEntries,
            auditInternalMemoryMeasurementWindows,
            measuredPhaseWindows,
          );
        const durationsMs = appWorkEntries.map((entry) => entry.duration);
        const rawDurationsMs = rawEntries.map((entry) => entry.duration);
        const excludedProbeDurationsMs = excludedProbeEntries.map(
          (entry) => entry.duration,
        );
        const outsideMeasuredPhaseDurationsMs = outsideMeasuredPhaseEntries.map(
          (entry) => entry.duration,
        );
        return {
          count: durationsMs.length,
          durationsMs,
          maxMs: durationsMs.length ? Math.max(...durationsMs) : 0,
          rawEntries,
          rawCount: rawEntries.length,
          rawDurationsMs,
          rawMaxMs: rawDurationsMs.length ? Math.max(...rawDurationsMs) : 0,
          measuredPhaseWindows,
          outsideMeasuredPhaseEntries,
          outsideMeasuredPhaseDurationsMs,
          outsideMeasuredPhaseMaxMs: outsideMeasuredPhaseDurationsMs.length
            ? Math.max(...outsideMeasuredPhaseDurationsMs)
            : 0,
          phaseAttribution,
          auditInternalMemoryMeasurementWindows,
          excludedProbeEntries,
          excludedProbeDurationsMs,
          excludedProbeMaxMs: excludedProbeDurationsMs.length
            ? Math.max(...excludedProbeDurationsMs)
            : 0,
        };
      })(),
      path,
      foundry,
    };
    if (pressureWindow) {
      scenario.pressure = buildHighResolutionPressureEvidence({
        foundry,
        startedAtMs: pressureWindow.startedAtMs,
        endedAtMs: pressureWindow.endedAtMs,
        pressurePlayback: pressureWindow.playback,
        timerTaskCount: pressureWindow.timerTaskCount,
      });
    }
    return scenario;
  } finally {
    await client.detach().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
};

test.describe("Chromebook adaptive High resolution audit", () => {
  test.skip(!ENABLED, "run with CHROMEBOOK_AUDIT=1 against a production preview");

  test("DPR2 compares Balanced with adaptive High in fresh Path and Foundry contexts", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(0);
    const balanced = await runScenario({
      browser,
      browserVersion: browser.version(),
      preset: "balanced",
    });
    const high = await runScenario({
      browser,
      browserVersion: browser.version(),
      preset: "high",
      traceFoundry: TRACE_FOUNDRY,
    });
    const acceptance = evaluateChromebookHighResolutionAcceptance({
      profile: CHROMEBOOK_AUDIT_PROFILE,
      balanced,
      high,
    });
    const baseURL = testInfo.project.use.baseURL;
    if (typeof baseURL !== "string") {
      throw new Error("High-resolution audit requires a production preview URL");
    }
    const maximumEffectiveDpr = Math.max(
      0,
      ...[high.path, high.foundry].flatMap((surface) =>
        surface.dprHistory.map((sample) => sample.effectiveDpr ?? 0)
      ),
    );
    const report: ChromebookHighResolutionAuditReport = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      profile: CHROMEBOOK_AUDIT_PROFILE.name,
      resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
      productionBuild: true,
      actualChromebookTested: false,
      provenance: await collectChromebookAuditProvenance(baseURL),
      matrix: {
        viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
        deviceScaleFactor: HIGH_RESOLUTION_DEVICE_SCALE_FACTOR,
        cpuThrottlingRate:
          CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottlingRate,
        contextsInThisRun: 2,
        pairedProfilesRequired: ["regression-4x", "acceptance-6x"],
        promotion: {
          fromDpr: HIGH_RESOLUTION_SAFE_START_DPR,
          toDpr: HIGH_RESOLUTION_NATIVE_DPR,
          upshiftsRequired: HIGH_RESOLUTION_NATIVE_PROMOTION_UPSHIFTS,
          goodSubmissionsRequired:
            HIGH_RESOLUTION_NATIVE_PROMOTION_SUBMISSIONS,
          minimumEvidenceMs: HIGH_RESOLUTION_NATIVE_PROMOTION_MINIMUM_MS,
          configuredPlaybackMs: PROMOTION_PLAYBACK_MS,
          bytesPerPixelBudget: HIGH_RESOLUTION_PROMOTION_BYTES_PER_PIXEL,
          fixedOverheadBytes:
            HIGH_RESOLUTION_PROMOTION_FIXED_OVERHEAD_BYTES,
          nearFourMegapixelMemoryUnproven: true,
        },
      },
      balanced,
      high,
      acceptance,
      diagnostics: {
        maximumEffectiveDpr,
        reachedNativeDpr2: maximumEffectiveDpr >= 1.99,
      },
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const testOutput = testInfo.outputPath("chromebook-high-resolution-audit.json");
    await writeFile(testOutput, json, "utf8");
    await testInfo.attach("chromebook-high-resolution-audit", {
      path: testOutput,
      contentType: "application/json",
    });
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, json, "utf8");

    if (ENFORCE) {
      for (const [name, check] of Object.entries(acceptance)) {
        expect(
          check.passed,
          `${name}: observed ${check.observed}, limit ${check.limit}`,
        ).toBe(true);
      }
    }
  });
});

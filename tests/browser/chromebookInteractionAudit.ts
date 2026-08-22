import { expect, type CDPSession, type Locator, type Page } from "@playwright/test";

import {
  buildChromebookFeatureAudit,
  type FeatureActionAudit,
  type FeatureAudit,
  type FeatureRuntimeProbe,
} from "./chromebookFeatureAuditReport";
import {
  collectStableFeatureProbe,
  finishFeatureAction,
  readFeatureRuntimeProbe,
  waitForLifecycleBaseline,
  type FeatureNextPaintTiming,
} from "./chromebookAuditHarness";
import {
  percentiles,
  type AcceptanceCheck,
  type WebGLAuditSnapshot,
} from "./chromebookAuditReport";

export type InteractionName =
  | "pathGestures"
  | "foundryGestures"
  | "designControls"
  | "characterControls"
  | "optionsHistory";

export type VisualProbe = {
  reactCommits: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  webgl: WebGLAuditSnapshot;
};

export type InteractionAudit = FeatureAudit & {
  visual: {
    baseline: VisualProbe;
    final: VisualProbe;
    liveResourceDelta: number;
    contextDelta: number;
    contextLossDelta: number;
    contextRestoreDelta: number;
    topologyBuildDelta: number;
    geometryCacheDelta: number;
    materialCacheDelta: number;
    reactCommitDelta: number;
    plateauLiveResourceDelta?: number;
    plateauLiveResourceDeltas?: number[];
    puppetTopologyLatencyMs: ReturnType<typeof percentiles>;
    directInteractionLatencyMs: ReturnType<typeof percentiles>;
    directVisualSubmissionLatencyMs: ReturnType<typeof percentiles>;
    eventToGestureEmissionLatencyMs: ReturnType<typeof percentiles>;
    gestureEmissionToFirstGlLatencyMs: ReturnType<typeof percentiles>;
    directVisualSubmissionSampleCount: number;
    directVisualSubmissionRequiredCount: number;
    directVisualCausalSampleCount: number;
  };
};

export type InteractionVisualLimits = {
  maxTopologyBuilds: number;
  maxLiveResourceGrowth: number;
  maxGeometryCacheGrowth: number;
  maxMaterialCacheGrowth: number;
};

export const FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES = 3;

export type FoundryBaselineFrameProbe = {
  globalGlIndex: number;
  foundryContextIndex: number;
  rendererReady: boolean;
  topologyReady: boolean;
  foundryCanvasCount: number;
  contextsCreated: number;
  contextsLost: number;
  contextsRestored: number;
  foundryTopologyBuilds: number;
  foundryGeometryCacheSize: number;
  foundryMaterialCacheSize: number;
  resources: WebGLAuditSnapshot["resources"];
};

export type FoundryBaselineStability = {
  lastGlobalGlIndex: number;
  resourceSignature: string | null;
  stableActualFrames: number;
};

export const initialFoundryBaselineStability = (): FoundryBaselineStability => ({
  lastGlobalGlIndex: -1,
  resourceSignature: null,
  stableActualFrames: 0,
});

const foundryBaselineResourceSignature = (
  sample: FoundryBaselineFrameProbe,
) => JSON.stringify({
  foundryContextIndex: sample.foundryContextIndex,
  foundryCanvasCount: sample.foundryCanvasCount,
  contextsCreated: sample.contextsCreated,
  contextsLost: sample.contextsLost,
  contextsRestored: sample.contextsRestored,
  foundryTopologyBuilds: sample.foundryTopologyBuilds,
  foundryGeometryCacheSize: sample.foundryGeometryCacheSize,
  foundryMaterialCacheSize: sample.foundryMaterialCacheSize,
  resources: Object.fromEntries(
    Object.entries(sample.resources)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, counters]) => [kind, counters]),
  ),
});

export const advanceFoundryBaselineStability = (
  state: FoundryBaselineStability,
  sample: FoundryBaselineFrameProbe,
): FoundryBaselineStability => {
  if (sample.globalGlIndex <= state.lastGlobalGlIndex) return state;
  if (!sample.rendererReady || !sample.topologyReady) {
    return {
      lastGlobalGlIndex: sample.globalGlIndex,
      resourceSignature: null,
      stableActualFrames: 0,
    };
  }
  const resourceSignature = foundryBaselineResourceSignature(sample);
  return {
    lastGlobalGlIndex: sample.globalGlIndex,
    resourceSignature,
    stableActualFrames: resourceSignature === state.resourceSignature
      ? state.stableActualFrames + 1
      : 1,
  };
};

export const DIRECT_INTERACTION_P95_MS = 50;
export const DIRECT_VISUAL_SUBMISSION_P95_MS = 50;

const FOUNDRY_VISUAL_CHANGE_ACTIONS = [
  "D-move",
  "M-move",
  "orbit-move",
] as const;

export const openWavingArm = async (page: Page) => {
  const dialog = page.getByTestId("getting-started-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("getting-started-card-guided").click();
  await dialog.getByTestId("guided-project-card-waving-arm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-stage="character"]')).toBeVisible();
};

export const openStage = async (
  page: Page,
  stage: "path" | "foundry" | "design",
) => {
  await page.getByTestId(`workflow-stage-${stage}`).click();
  await expect(page.locator(`[data-stage="${stage}"]`)).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
};

export const readVisualProbe = (page: Page): Promise<VisualProbe> =>
  page.evaluate(() => {
    const state = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        reactCommits: number;
        foundryTopologyBuilds: number;
        foundryGeometryCacheSize: number;
        foundryMaterialCacheSize: number;
        webgl: WebGLAuditSnapshot;
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    if (!state) throw new Error("Chromebook runtime probe is not installed");
    return {
      reactCommits: state.reactCommits,
      foundryTopologyBuilds: state.foundryTopologyBuilds,
      foundryGeometryCacheSize: state.foundryGeometryCacheSize,
      foundryMaterialCacheSize: state.foundryMaterialCacheSize,
      webgl: structuredClone(state.webgl),
    };
  });

const readFoundryBaselineFrameProbe = (
  page: Page,
): Promise<FoundryBaselineFrameProbe> => page.evaluate(() => {
  const preview = document.querySelector<HTMLElement>(
    '[data-testid="foundry-preview"]',
  );
  const rig = document.querySelector<HTMLElement>(
    '[data-testid="foundry-camera-rig"]',
  );
  const foundryCanvas = preview?.querySelector<HTMLCanvasElement>(
    "canvas.foundry-three-canvas",
  );
  const state = (window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
      foundryTopologyBuilds: number;
      foundryGeometryCacheSize: number;
      foundryMaterialCacheSize: number;
      webgl: WebGLAuditSnapshot;
      graphicsContexts: Array<{
        canvas: HTMLCanvasElement;
        frameSubmissions: Array<{ globalGlIndex: number }>;
      }>;
    };
  }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  if (!preview || !rig || !foundryCanvas || !state) {
    throw new Error("Foundry baseline diagnostics are unavailable");
  }
  const foundryContextIndex = state.graphicsContexts.findIndex(
    (entry) => entry.canvas === foundryCanvas,
  );
  const context = state.graphicsContexts[foundryContextIndex];
  const globalGlIndex = context?.frameSubmissions.at(-1)?.globalGlIndex ?? -1;
  const dynamicBuildCount = Number(
    rig.getAttribute("data-three-dynamic-build-count") ?? "0",
  );
  const geometryCacheSize = Number(
    rig.getAttribute("data-three-geometry-cache-size") ?? "0",
  );
  const materialCacheSize = Number(
    rig.getAttribute("data-three-material-cache-size") ?? "0",
  );
  const partCount = Number(rig.getAttribute("data-three-part-count") ?? "0");
  const foundryCanvasCount = document.querySelectorAll(
    "canvas.foundry-three-canvas",
  ).length;
  const rendererReady =
    preview.getAttribute("data-three-renderer-status") === "webgl" &&
    foundryCanvas.isConnected &&
    foundryCanvasCount === 1 &&
    foundryContextIndex >= 0 &&
    globalGlIndex >= 0 &&
    state.webgl.contextsLost === 0 &&
    state.webgl.contextsRestored === 0;
  const topologyReady =
    dynamicBuildCount > 0 &&
    partCount > 0 &&
    state.foundryTopologyBuilds > 0 &&
    geometryCacheSize > 0 &&
    materialCacheSize > 0 &&
    geometryCacheSize === state.foundryGeometryCacheSize &&
    materialCacheSize === state.foundryMaterialCacheSize;
  return {
    globalGlIndex,
    foundryContextIndex,
    rendererReady,
    topologyReady,
    foundryCanvasCount,
    contextsCreated: state.webgl.contextsCreated,
    contextsLost: state.webgl.contextsLost,
    contextsRestored: state.webgl.contextsRestored,
    foundryTopologyBuilds: state.foundryTopologyBuilds,
    foundryGeometryCacheSize: state.foundryGeometryCacheSize,
    foundryMaterialCacheSize: state.foundryMaterialCacheSize,
    resources: structuredClone(state.webgl.resources),
  };
});

export const waitForFoundryInteractionBaseline = async (page: Page) => {
  const preview = page.getByTestId("foundry-preview");
  const rig = page.getByTestId("foundry-camera-rig");
  await expect(preview).toHaveAttribute("data-three-renderer-status", "webgl");
  await expect(page.locator("canvas.foundry-three-canvas")).toBeVisible();
  await expect(rig).toBeAttached();

  const toolbar = page.getByTestId("foundry-toolbar");
  const play = toolbar.getByRole("button", { name: "Play", exact: true });
  const pause = toolbar.getByRole("button", { name: "Pause", exact: true });
  if (await play.isVisible()) await play.click();
  await expect(pause).toBeVisible();

  let stability = initialFoundryBaselineStability();
  try {
    await expect.poll(async () => {
      stability = advanceFoundryBaselineStability(
        stability,
        await readFoundryBaselineFrameProbe(page),
      );
      return stability.stableActualFrames;
    }, {
      message:
        "Foundry topology and identity-aware WebGL resources settle across three actual frames",
      intervals: [0],
    }).toBeGreaterThanOrEqual(FOUNDRY_BASELINE_STABLE_ACTUAL_FRAMES);
  } finally {
    if (await pause.isVisible()) await pause.click();
  }
  await expect(play).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  return stability;
};

const liveResources = (probe: VisualProbe) =>
  Object.values(probe.webgl.resources)
    .reduce((sum, resource) => sum + resource.live, 0);

export const buildInteractionAudit = (
  name: InteractionName,
  actions: FeatureActionAudit[],
  baseline: FeatureRuntimeProbe,
  final: FeatureRuntimeProbe,
  visualBaseline: VisualProbe,
  visualFinal: VisualProbe,
  limits: InteractionVisualLimits,
  plateauSamples: Array<{ baseline: VisualProbe; final: VisualProbe }> = [],
): InteractionAudit => {
  const base = buildChromebookFeatureAudit(name, actions, baseline, final, {
    minimumWorkerCreations: 0,
    requireCompletedCycle: true,
  });
  const puppetTopologyLatencyMs = percentiles(
    actions.flatMap((action) => action.puppetTopologyDurationsMs),
  );
  const directActions = actions.filter(
    (action) => action.interactionClass === "direct",
  );
  const directInteractionLatencyMs = percentiles(
    directActions.map((action) => action.nextPaintMs),
  );
  const directVisualActions = name === "foundryGestures"
    ? FOUNDRY_VISUAL_CHANGE_ACTIONS.map((label) =>
      actions.find((action) =>
        action.label === label && action.interactionClass === "direct"
      ),
    )
    : [];
  const directVisualSubmissionSamples = directVisualActions.flatMap((action) => {
    const firstSubmission = action?.renderSubmissionOffsetsMs?.[0];
    return firstSubmission === undefined ? [] : [firstSubmission];
  });
  const directVisualSubmissionLatencyMs = percentiles(
    directVisualSubmissionSamples,
  );
  const directVisualSubmissionCoverage =
    directVisualActions.length === FOUNDRY_VISUAL_CHANGE_ACTIONS.length &&
    directVisualSubmissionSamples.length === FOUNDRY_VISUAL_CHANGE_ACTIONS.length;
  const causalVisualActions = directVisualActions.filter(
    (action): action is FeatureActionAudit => {
    const causal = action?.causality;
    if (!action || !causal || causal.pointerEventOffsetsMs.length !== 6)
      return false;
    const monotonicPointerEvents = causal.pointerEventOffsetsMs.every(
      (offset, index, offsets) =>
        offset >= 0 && (index === 0 || offset >= offsets[index - 1]),
    );
    const firstGl = action.renderSubmissionOffsetsMs?.[0];
    const commonMarkersValid =
      monotonicPointerEvents &&
      causal.globalGlEndIndex > causal.globalGlStartIndex &&
      causal.causalGlobalGlIndex >= causal.globalGlStartIndex &&
      causal.causalGlobalGlIndex < causal.globalGlEndIndex &&
      causal.causalGlAtMs >= causal.actionStartedAtMs &&
      causal.foundryCanvasGlEndCount > causal.foundryCanvasGlStartCount &&
      causal.rigSubmissionEndCount > causal.rigSubmissionStartCount &&
      firstGl !== undefined &&
      causal.eventToFirstGlMs === firstGl;
    if (!commonMarkersValid) return false;
    if (action.label === "orbit-move") return true;
    return (
      causal.gestureEmissionStartCount !== undefined &&
      causal.gestureEmissionCount !== undefined &&
      causal.gestureEmissionCount > causal.gestureEmissionStartCount &&
      causal.gestureEmissionAtMs !== undefined &&
      causal.gestureEmissionAtMs >= causal.actionStartedAtMs &&
      causal.causalGlAtMs >= causal.gestureEmissionAtMs &&
      causal.eventToGestureEmissionMs !== undefined &&
      causal.eventToGestureEmissionMs >= 0 &&
      causal.gestureEmissionToFirstGlMs !== undefined &&
      causal.gestureEmissionToFirstGlMs >= 0
    );
    },
  );
  const eventToGestureEmissionLatencyMs = percentiles(
    causalVisualActions.flatMap((action) =>
      action.causality?.eventToGestureEmissionMs === undefined
        ? []
        : [action.causality.eventToGestureEmissionMs]
    ),
  );
  const gestureEmissionToFirstGlLatencyMs = percentiles(
    causalVisualActions.flatMap((action) =>
      action.causality?.gestureEmissionToFirstGlMs === undefined
        ? []
        : [action.causality.gestureEmissionToFirstGlMs]
    ),
  );
  const plateauLiveResourceDeltas = plateauSamples.map(
    (sample) => liveResources(sample.final) - liveResources(sample.baseline),
  );
  const visual = {
    baseline: visualBaseline,
    final: visualFinal,
    liveResourceDelta: liveResources(visualFinal) - liveResources(visualBaseline),
    contextDelta:
      visualFinal.webgl.contextsCreated - visualBaseline.webgl.contextsCreated,
    contextLossDelta:
      visualFinal.webgl.contextsLost - visualBaseline.webgl.contextsLost,
    contextRestoreDelta:
      visualFinal.webgl.contextsRestored - visualBaseline.webgl.contextsRestored,
    topologyBuildDelta:
      visualFinal.foundryTopologyBuilds - visualBaseline.foundryTopologyBuilds,
    geometryCacheDelta:
      visualFinal.foundryGeometryCacheSize - visualBaseline.foundryGeometryCacheSize,
    materialCacheDelta:
      visualFinal.foundryMaterialCacheSize - visualBaseline.foundryMaterialCacheSize,
    reactCommitDelta: visualFinal.reactCommits - visualBaseline.reactCommits,
    plateauLiveResourceDelta: plateauLiveResourceDeltas.length
      ? Math.max(...plateauLiveResourceDeltas)
      : undefined,
    plateauLiveResourceDeltas: plateauLiveResourceDeltas.length
      ? plateauLiveResourceDeltas
      : undefined,
    puppetTopologyLatencyMs,
    directInteractionLatencyMs,
    directVisualSubmissionLatencyMs,
    eventToGestureEmissionLatencyMs,
    gestureEmissionToFirstGlLatencyMs,
    directVisualSubmissionSampleCount: directVisualSubmissionSamples.length,
    directVisualSubmissionRequiredCount: directVisualActions.length,
    directVisualCausalSampleCount: causalVisualActions.length,
  };
  const visualChecks: Record<string, AcceptanceCheck> = {
    directInteractionP95: {
      passed:
        directActions.length > 0 &&
        directInteractionLatencyMs.p95 <= DIRECT_INTERACTION_P95_MS,
      observed: directInteractionLatencyMs.p95,
      limit: DIRECT_INTERACTION_P95_MS,
    },
    ...(name === "foundryGestures" ? {
      directVisualSubmissionCoverage: {
        passed: directVisualSubmissionCoverage,
        observed: directVisualSubmissionSamples.length,
        limit: FOUNDRY_VISUAL_CHANGE_ACTIONS.length,
      },
      directVisualCausalCoverage: {
        passed:
          causalVisualActions.length === FOUNDRY_VISUAL_CHANGE_ACTIONS.length,
        observed: causalVisualActions.length,
        limit: FOUNDRY_VISUAL_CHANGE_ACTIONS.length,
      },
      directVisualSubmissionP95: {
        passed:
          directVisualSubmissionCoverage &&
          directVisualSubmissionLatencyMs.p95 <= DIRECT_VISUAL_SUBMISSION_P95_MS,
        observed: directVisualSubmissionLatencyMs.p95,
        limit: DIRECT_VISUAL_SUBMISSION_P95_MS,
      },
    } : {}),
    webglContextsStable: {
      passed: visual.contextDelta <= 0,
      observed: visual.contextDelta,
      limit: 0,
    },
    webglContextLossAbsent: {
      passed: visual.contextLossDelta === 0,
      observed: visual.contextLossDelta,
      limit: 0,
    },
    webglContextRestorationAbsent: {
      passed: visual.contextRestoreDelta === 0,
      observed: visual.contextRestoreDelta,
      limit: 0,
    },
    foundryTopologyBounded: {
      passed: visual.topologyBuildDelta <= limits.maxTopologyBuilds,
      observed: visual.topologyBuildDelta,
      limit: limits.maxTopologyBuilds,
    },
    webglResourceGrowthBounded: {
      passed: visual.liveResourceDelta <= limits.maxLiveResourceGrowth,
      observed: visual.liveResourceDelta,
      limit: limits.maxLiveResourceGrowth,
    },
    geometryCacheGrowthBounded: {
      passed: visual.geometryCacheDelta <= limits.maxGeometryCacheGrowth,
      observed: visual.geometryCacheDelta,
      limit: limits.maxGeometryCacheGrowth,
    },
    materialCacheGrowthBounded: {
      passed: visual.materialCacheDelta <= limits.maxMaterialCacheGrowth,
      observed: visual.materialCacheDelta,
      limit: limits.maxMaterialCacheGrowth,
    },
    puppetTopologyP95: {
      passed: puppetTopologyLatencyMs.p95 <= 50,
      observed: puppetTopologyLatencyMs.p95,
      limit: 50,
    },
    ...(plateauLiveResourceDeltas.length ? {
      webglResourcePlateau: {
        passed: (visual.plateauLiveResourceDelta ?? 0) <= 0,
        observed: visual.plateauLiveResourceDelta ?? 0,
        limit: 0,
      },
    } : {}),
  };
  const acceptance = { ...base.acceptance, ...visualChecks };
  const passed = Object.entries(acceptance)
    .filter(([key]) => key !== "passed")
    .every(([, check]) => check.passed);
  return {
    ...base,
    visual,
    acceptance: {
      ...acceptance,
      passed: { passed, observed: passed, limit: true },
    },
  };
};

export const measurePointerEventToNextPaint = async (
  page: Page,
  eventType: "pointerdown" | "pointermove" | "pointerup",
  action: () => Promise<unknown>,
): Promise<FeatureNextPaintTiming> => {
  const sequence = await page.evaluate((type) => {
    const target = window as Window & {
      __MOTIONSMITH_POINTER_PAINT__?: {
        sequence: number;
        startedAt?: number;
        eventTaskEndMs?: number;
        firstRafMs?: number;
        nextPaintMs?: number;
        eventTimestampsMs: number[];
        stop?: () => void;
      };
    };
    target.__MOTIONSMITH_POINTER_PAINT__?.stop?.();
    const next = (target.__MOTIONSMITH_POINTER_PAINT__?.sequence ?? 0) + 1;
    target.__MOTIONSMITH_POINTER_PAINT__ = {
      sequence: next,
      eventTimestampsMs: [],
    };
    const onEvent = () => {
      const current = target.__MOTIONSMITH_POINTER_PAINT__;
      if (!current || current.sequence !== next) return;
      const startedAt = performance.now();
      current.eventTimestampsMs.push(startedAt);
      if (current.startedAt !== undefined) return;
      current.startedAt = startedAt;
      queueMicrotask(() => {
        const latest = target.__MOTIONSMITH_POINTER_PAINT__;
        if (!latest || latest.sequence !== next) return;
        latest.eventTaskEndMs = performance.now() - startedAt;
      });
      requestAnimationFrame(() => {
        const latest = target.__MOTIONSMITH_POINTER_PAINT__;
        if (!latest || latest.sequence !== next) return;
        latest.firstRafMs = performance.now() - startedAt;
        requestAnimationFrame(() => {
          const painted = target.__MOTIONSMITH_POINTER_PAINT__;
          if (!painted || painted.sequence !== next) return;
          painted.nextPaintMs = performance.now() - startedAt;
        });
      });
    };
    target.__MOTIONSMITH_POINTER_PAINT__.stop = () =>
      document.removeEventListener(type, onEvent, true);
    document.addEventListener(type, onEvent, true);
    return next;
  }, eventType);
  try {
    await action();
  } finally {
    await page.evaluate((expected) => {
      const current = (window as Window & {
        __MOTIONSMITH_POINTER_PAINT__?: {
          sequence: number;
          stop?: () => void;
        };
      }).__MOTIONSMITH_POINTER_PAINT__;
      if (current?.sequence !== expected) return;
      current.stop?.();
      delete current.stop;
    }, sequence);
  }
  await expect.poll(() => page.evaluate((expected) => {
    const current = (window as Window & {
      __MOTIONSMITH_POINTER_PAINT__?: { sequence: number; nextPaintMs?: number };
    }).__MOTIONSMITH_POINTER_PAINT__;
    return current?.sequence === expected ? current.nextPaintMs : undefined;
  }, sequence), { message: `${eventType} reaches its next screen paint` })
    .not.toBeUndefined();
  return page.evaluate((expected) => {
    const current = (window as Window & {
      __MOTIONSMITH_POINTER_PAINT__?: {
        sequence: number;
        startedAt?: number;
        eventTaskEndMs?: number;
        firstRafMs?: number;
        nextPaintMs?: number;
        eventTimestampsMs: number[];
      };
    }).__MOTIONSMITH_POINTER_PAINT__;
    if (
      current?.sequence !== expected ||
      current.startedAt === undefined ||
      current.nextPaintMs === undefined
    ) throw new Error("Pointer paint timing was not delivered");
    return {
      startedAt: current.startedAt,
      eventTaskEndMs: current.eventTaskEndMs,
      firstRafMs: current.firstRafMs,
      nextPaintMs: current.nextPaintMs,
      interactionClass: "direct" as const,
      pointerEventOffsetsMs: current.eventTimestampsMs.map(
        (observedAt) => observedAt - current.startedAt!,
      ),
    };
  }, sequence);
};

export const measureFoundryPointerMoveToNextPaint = async (
  page: Page,
  action: () => Promise<unknown>,
  { trackGestureEmission }: { trackGestureEmission: boolean },
): Promise<FeatureNextPaintTiming> => {
  await page.evaluate((trackEmission) => {
    const target = window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        webglFrameSubmissions: number[];
        foundryGestureVisualEmissions: number[];
        graphicsContexts: Array<{
          canvas: HTMLCanvasElement;
          frameSubmissions: Array<{ globalGlIndex: number; atMs: number }>;
        }>;
      };
      __MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?: {
        cleanup(): void;
        firstPointerEventAtMs?: number;
        globalGlStartIndex: number;
        foundryCanvas: HTMLCanvasElement;
        foundryCanvasGlStartCount: number;
        rigSubmissionStartCount: number;
        gestureEmissionStartCount?: number;
        gestureEmissionAtMs?: number;
        gestureEmissionCount?: number;
      };
    };
    target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?.cleanup();
    const audit = target.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    const rig = document.querySelector<HTMLElement>(
      '[data-testid="foundry-camera-rig"]',
    );
    const foundryCanvas = rig?.closest(".foundry-preview")
      ?.querySelector<HTMLCanvasElement>("canvas");
    const graphicsContext = audit?.graphicsContexts.find(
      (entry) => entry.canvas === foundryCanvas,
    );
    if (!audit || !rig || !foundryCanvas || !graphicsContext)
      throw new Error("Foundry causal diagnostics are unavailable");
    const readCount = (element: HTMLElement, attribute: string) =>
      Number(element.getAttribute(attribute) ?? "0");
    const onPointerMove = () => {
      const marker = target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__;
      if (marker && marker.firstPointerEventAtMs === undefined)
        marker.firstPointerEventAtMs = performance.now();
    };
    const marker = {
      globalGlStartIndex: audit.webglFrameSubmissions.length,
      foundryCanvas,
      foundryCanvasGlStartCount: graphicsContext.frameSubmissions.length,
      rigSubmissionStartCount: readCount(rig, "data-three-render-submissions"),
      gestureEmissionStartCount: trackEmission
        ? audit.foundryGestureVisualEmissions.length
        : undefined,
      cleanup: () => undefined,
    } as NonNullable<typeof target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__>;
    marker.cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
    };
    target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__ = marker;
    document.addEventListener("pointermove", onPointerMove, true);
  }, trackGestureEmission);

  try {
    const timing = await measurePointerEventToNextPaint(
      page,
      "pointermove",
      action,
    );
    expect(
      timing.pointerEventOffsetsMs,
      "Foundry causal move keeps all six real pointermove timestamps",
    ).toHaveLength(6);
    await expect.poll(() => page.evaluate(({ startedAt, trackEmission }) => {
      const target = window as Window & {
        __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
          webglFrameSubmissions: number[];
          foundryGestureVisualEmissions: number[];
          graphicsContexts: Array<{
            canvas: HTMLCanvasElement;
            frameSubmissions: Array<{ globalGlIndex: number; atMs: number }>;
          }>;
        };
        __MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?: {
          firstPointerEventAtMs?: number;
          globalGlStartIndex: number;
          foundryCanvas: HTMLCanvasElement;
          foundryCanvasGlStartCount: number;
          rigSubmissionStartCount: number;
          gestureEmissionStartCount?: number;
          gestureEmissionAtMs?: number;
          gestureEmissionCount?: number;
        };
      };
      const audit = target.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
      const marker = target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__;
      const rig = document.querySelector<HTMLElement>(
        '[data-testid="foundry-camera-rig"]',
      );
      if (!audit || !marker || !rig) return false;
      if (trackEmission && marker.gestureEmissionAtMs === undefined) {
        const firstPointerEventAtMs = marker.firstPointerEventAtMs ?? startedAt;
        marker.gestureEmissionAtMs = audit.foundryGestureVisualEmissions
          .slice(marker.gestureEmissionStartCount ?? 0)
          .find((emittedAt) => emittedAt >= firstPointerEventAtMs);
        marker.gestureEmissionCount = audit.foundryGestureVisualEmissions.length;
      }
      const boundary = trackEmission ? marker.gestureEmissionAtMs : startedAt;
      const graphicsContext = audit.graphicsContexts.find(
        (entry) => entry.canvas === marker.foundryCanvas,
      );
      const causalSubmission = boundary === undefined
        ? undefined
        : graphicsContext?.frameSubmissions
          .slice(marker.foundryCanvasGlStartCount)
          .find((submission) => submission.atMs >= boundary);
      const hasCausalGl = causalSubmission !== undefined &&
        causalSubmission.globalGlIndex >= marker.globalGlStartIndex &&
        audit.webglFrameSubmissions[causalSubmission.globalGlIndex] ===
          causalSubmission.atMs;
      const rigAdvanced = Number(
        rig.getAttribute("data-three-render-submissions") ?? "0",
      ) > marker.rigSubmissionStartCount;
      const emissionAdvanced = !trackEmission || (
        marker.gestureEmissionAtMs !== undefined &&
        (marker.gestureEmissionCount ?? 0) >
          (marker.gestureEmissionStartCount ?? 0)
      );
      return hasCausalGl && rigAdvanced && emissionAdvanced;
    }, {
      startedAt: timing.startedAt,
      trackEmission: trackGestureEmission,
    }), { message: "Foundry move reaches its causally associated GL submission" })
      .toBe(true);
    const causal = await page.evaluate(({ startedAt, trackEmission }) => {
      const target = window as Window & {
        __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
          graphicsContexts: Array<{
            canvas: HTMLCanvasElement;
            frameSubmissions: Array<{ globalGlIndex: number; atMs: number }>;
          }>;
        };
        __MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?: {
          globalGlStartIndex: number;
          foundryCanvas: HTMLCanvasElement;
          foundryCanvasGlStartCount: number;
          rigSubmissionStartCount: number;
          gestureEmissionStartCount?: number;
          gestureEmissionAtMs?: number;
          gestureEmissionCount?: number;
        };
      };
      const audit = target.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
      const marker = target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__;
      const rig = document.querySelector<HTMLElement>(
        '[data-testid="foundry-camera-rig"]',
      );
      if (
        !audit ||
        !marker ||
        !rig
      ) throw new Error("Foundry causal marker disappeared");
      const boundary = trackEmission ? marker.gestureEmissionAtMs : startedAt;
      const graphicsContext = audit.graphicsContexts.find(
        (entry) => entry.canvas === marker.foundryCanvas,
      );
      const causalSubmission = boundary === undefined
        ? undefined
        : graphicsContext?.frameSubmissions
          .slice(marker.foundryCanvasGlStartCount)
          .find((submission) => submission.atMs >= boundary);
      if (!graphicsContext || !causalSubmission)
        throw new Error("Foundry canvas GL marker disappeared");
      return {
        globalGlStartIndex: marker.globalGlStartIndex,
        causalGlobalGlIndex: causalSubmission.globalGlIndex,
        causalGlAtMs: causalSubmission.atMs,
        foundryCanvasGlStartCount: marker.foundryCanvasGlStartCount,
        foundryCanvasGlEndCount: graphicsContext.frameSubmissions.length,
        rigSubmissionStartCount: marker.rigSubmissionStartCount,
        rigSubmissionEndCount: Number(
          rig.getAttribute("data-three-render-submissions") ?? "0",
        ),
        gestureEmissionStartCount: marker.gestureEmissionStartCount,
        gestureEmissionCount: marker.gestureEmissionCount,
        gestureEmissionAtMs: marker.gestureEmissionAtMs,
        causalGlNotBeforeAtMs: trackEmission
          ? marker.gestureEmissionAtMs!
          : startedAt,
      };
    }, { startedAt: timing.startedAt, trackEmission: trackGestureEmission });
    return { ...timing, causal };
  } finally {
    await page.evaluate(() => {
      const target = window as Window & {
        __MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?: { cleanup(): void };
      };
      target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__?.cleanup();
      delete target.__MOTIONSMITH_FOUNDRY_CAUSAL_MOVE__;
    });
  }
};

export const measureRangeUpdate = (
  range: Locator,
  value: number,
): Promise<FeatureNextPaintTiming> => range.evaluate((element, next) => {
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  const startedAt = performance.now();
  setter?.call(input, String(next));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
    return new Promise<FeatureNextPaintTiming>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      startedAt,
      nextPaintMs: performance.now() - startedAt,
      interactionClass: "direct",
    })));
  });
}, value);

export const measureSelectUpdate = (
  select: Locator,
  value: string,
): Promise<FeatureNextPaintTiming> => select.evaluate((element, next) => {
  const input = element as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  const startedAt = performance.now();
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
    return new Promise<FeatureNextPaintTiming>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      startedAt,
      nextPaintMs: performance.now() - startedAt,
      interactionClass: "general",
    })));
  });
}, value);

export const finishAction = async (
  page: Page,
  label: string,
  cycle: number,
  action: () => Promise<FeatureNextPaintTiming>,
  ready: (timing: FeatureNextPaintTiming) => Promise<unknown> = async () => undefined,
) => {
  const before = await readFeatureRuntimeProbe(page);
  const timing = await action();
  await ready(timing);
  return finishFeatureAction(page, {
    label,
    cycle,
    outcome: "completed",
    timing,
    before,
  });
};

export const readCanonicalProjectActionCount = (
  page: Page,
  actionType: string,
): Promise<number> => page.evaluate((type) => (
  (window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
      projectActionCounts?: Record<string, number>;
    };
  }).__MOTIONSMITH_CHROMEBOOK_AUDIT__?.projectActionCounts?.[type] ?? 0
), actionType);

export const finalProbes = async (
  page: Page,
  client: CDPSession,
  baseline: FeatureRuntimeProbe,
) => {
  await waitForLifecycleBaseline(page, baseline.lifecycle);
  const feature = await collectStableFeatureProbe(page, client);
  const visual = await readVisualProbe(page);
  return { feature, visual };
};

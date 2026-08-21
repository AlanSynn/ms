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
  | "designControls";

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
    topologyBuildDelta: number;
    geometryCacheDelta: number;
    materialCacheDelta: number;
    reactCommitDelta: number;
    puppetTopologyLatencyMs: ReturnType<typeof percentiles>;
  };
};

export type InteractionVisualLimits = {
  maxTopologyBuilds: number;
  maxLiveResourceGrowth: number;
  maxGeometryCacheGrowth: number;
  maxMaterialCacheGrowth: number;
};

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
): InteractionAudit => {
  const base = buildChromebookFeatureAudit(name, actions, baseline, final, {
    minimumWorkerCreations: 0,
    requireCompletedCycle: true,
  });
  const puppetTopologyLatencyMs = percentiles(
    actions.flatMap((action) => action.puppetTopologyDurationsMs),
  );
  const visual = {
    baseline: visualBaseline,
    final: visualFinal,
    liveResourceDelta: liveResources(visualFinal) - liveResources(visualBaseline),
    contextDelta:
      visualFinal.webgl.contextsCreated - visualBaseline.webgl.contextsCreated,
    topologyBuildDelta:
      visualFinal.foundryTopologyBuilds - visualBaseline.foundryTopologyBuilds,
    geometryCacheDelta:
      visualFinal.foundryGeometryCacheSize - visualBaseline.foundryGeometryCacheSize,
    materialCacheDelta:
      visualFinal.foundryMaterialCacheSize - visualBaseline.foundryMaterialCacheSize,
    reactCommitDelta: visualFinal.reactCommits - visualBaseline.reactCommits,
    puppetTopologyLatencyMs,
  };
  const visualChecks: Record<string, AcceptanceCheck> = {
    webglContextsStable: {
      passed: visual.contextDelta <= 0,
      observed: visual.contextDelta,
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
        nextPaintMs?: number;
      };
    };
    const next = (target.__MOTIONSMITH_POINTER_PAINT__?.sequence ?? 0) + 1;
    target.__MOTIONSMITH_POINTER_PAINT__ = { sequence: next };
    document.addEventListener(type, () => {
      const startedAt = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const current = target.__MOTIONSMITH_POINTER_PAINT__;
        if (!current || current.sequence !== next) return;
        current.startedAt = startedAt;
        current.nextPaintMs = performance.now() - startedAt;
      }));
    }, { capture: true, once: true });
    return next;
  }, eventType);
  await action();
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
        nextPaintMs?: number;
      };
    }).__MOTIONSMITH_POINTER_PAINT__;
    if (
      current?.sequence !== expected ||
      current.startedAt === undefined ||
      current.nextPaintMs === undefined
    ) throw new Error("Pointer paint timing was not delivered");
    return { startedAt: current.startedAt, nextPaintMs: current.nextPaintMs };
  }, sequence);
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
    })));
  });
}, value);

export const finishAction = async (
  page: Page,
  label: string,
  cycle: number,
  action: () => Promise<FeatureNextPaintTiming>,
  ready: () => Promise<unknown> = async () => undefined,
) => {
  const before = await readFeatureRuntimeProbe(page);
  const timing = await action();
  await ready();
  return finishFeatureAction(page, {
    label,
    cycle,
    outcome: "completed",
    timing,
    before,
  });
};

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

import type { Page } from "@playwright/test";

export const FOUNDRY_COLD_LONG_TASK_LIMIT_MS = 50;

export type FoundryColdPreset = "balanced" | "high";

export type FoundryColdMark = {
  atMs: number;
  reactCommits: number;
};

export type FoundryColdNamedMark = FoundryColdMark & {
  name: string;
};

export type FoundryColdGalleryCountMark = FoundryColdMark & {
  count: number;
};

export type FoundryColdMountMarkers = {
  installedAtMs: number;
  clicked: FoundryColdMark | null;
  transitionFrame: FoundryColdMark | null;
  stageContent: FoundryColdMark | null;
  inspector: FoundryColdMark | null;
  gallery: FoundryColdMark | null;
  galleryVisiblePreviews: FoundryColdGalleryCountMark[];
  galleryPreviews: FoundryColdNamedMark[];
  galleryGhosts: FoundryColdNamedMark[];
  parametricEditor: FoundryColdMark | null;
  deferredThreePlaceholder: FoundryColdMark | null;
  deferredThreePlaceholderRemoved: FoundryColdMark | null;
  deferredThreeLoadStates: FoundryColdNamedMark[];
  threePreview: FoundryColdMark | null;
  threeCanvas: FoundryColdMark | null;
  rendererWebgl: FoundryColdMark | null;
  firstGlSubmission: FoundryColdMark | null;
  topologyReady: FoundryColdMark | null;
  completed: FoundryColdMark | null;
};

export type FoundryColdLongTask = {
  startTime: number;
  duration: number;
  endTime: number;
  phase: string;
  nearestPriorMarker: FoundryColdNamedMark | null;
  nearestNextMarker: FoundryColdNamedMark | null;
  markersInsideTask: FoundryColdNamedMark[];
};

export type FoundryColdPreloadResource = {
  name: string;
  startTime: number;
  responseEnd: number;
  duration: number;
  loadedBeforeClick: boolean;
};

export type FoundryColdDiagnosticRun = {
  run: number;
  preset: FoundryColdPreset;
  pageErrors: string[];
  markers: FoundryColdMountMarkers;
  longTasks: FoundryColdLongTask[];
  rawLongTasks: Array<{ startTime: number; duration: number }>;
  memoryProbeWindowsOverlappingMount: number;
  contextsLost: number;
  contextsRestored: number;
  preloadResources: FoundryColdPreloadResource[];
};

type RawFoundryColdDiagnostic = Omit<
  FoundryColdDiagnosticRun,
  "run" | "preset" | "pageErrors" | "longTasks"
>;

type TimelineMark = FoundryColdNamedMark;

const markerTimeline = (markers: FoundryColdMountMarkers): TimelineMark[] => {
  const timeline: TimelineMark[] = [];
  const add = (name: string, mark: FoundryColdMark | null) => {
    if (mark) timeline.push({ name, ...mark });
  };
  add("click", markers.clicked);
  add("transition-frame", markers.transitionFrame);
  add("stage-content", markers.stageContent);
  add("inspector", markers.inspector);
  add("gallery", markers.gallery);
  for (const mark of markers.galleryVisiblePreviews) {
    timeline.push({ name: `gallery-visible-${mark.count}`, ...mark });
  }
  timeline.push(...markers.galleryPreviews.map((mark) => ({
    ...mark,
    name: `gallery-preview:${mark.name}`,
  })));
  timeline.push(...markers.galleryGhosts.map((mark) => ({
    ...mark,
    name: `gallery-ghost:${mark.name}`,
  })));
  add("parametric-editor", markers.parametricEditor);
  add("deferred-three-placeholder", markers.deferredThreePlaceholder);
  timeline.push(...markers.deferredThreeLoadStates.map((mark) => ({
    ...mark,
    name: `deferred-three-state:${mark.name}`,
  })));
  add("deferred-three-placeholder-removed", markers.deferredThreePlaceholderRemoved);
  add("three-preview", markers.threePreview);
  add("three-canvas", markers.threeCanvas);
  add("renderer-webgl", markers.rendererWebgl);
  add("first-gl-submission", markers.firstGlSubmission);
  add("topology-ready", markers.topologyReady);
  add("completed", markers.completed);
  return timeline.sort((left, right) => left.atMs - right.atMs);
};

const phaseForTask = (
  markers: FoundryColdMountMarkers,
  startTime: number,
  endTime: number,
) => {
  const stage = markers.stageContent?.atMs;
  const preview = markers.threePreview?.atMs;
  const firstGl = markers.firstGlSubmission?.atMs;
  const topology = markers.topologyReady?.atMs;
  if (stage === undefined || endTime <= stage) return "preloaded-stage-commit";
  if (preview === undefined || endTime <= preview) return "post-stage-pre-three-mount";
  if (firstGl === undefined || endTime <= firstGl) return "three-mount-before-first-gl";
  if (topology === undefined || startTime < topology) return "first-gl-and-topology";
  return "readiness-settle";
};

export const attributeFoundryColdLongTasks = (
  markers: FoundryColdMountMarkers,
  rawLongTasks: Array<{ startTime: number; duration: number }>,
): FoundryColdLongTask[] => {
  const timeline = markerTimeline(markers);
  return rawLongTasks.map((task) => {
    const endTime = task.startTime + task.duration;
    const prior = timeline.filter((mark) => mark.atMs <= task.startTime).at(-1) ?? null;
    const next = timeline.find((mark) => mark.atMs >= endTime) ?? null;
    return {
      ...task,
      endTime,
      phase: phaseForTask(markers, task.startTime, endTime),
      nearestPriorMarker: prior,
      nearestNextMarker: next,
      markersInsideTask: timeline.filter(
        (mark) => mark.atMs > task.startTime && mark.atMs < endTime,
      ),
    };
  });
};

export const foundryColdPresetForRun = (run: number): FoundryColdPreset =>
  (["balanced", "high", "high", "balanced"] as const)[(run - 1) % 4]!;

export const summarizeFoundryColdRuns = (runs: FoundryColdDiagnosticRun[]) => {
  const durations = runs.flatMap((run) => run.longTasks.map((task) => task.duration));
  const maximumLongTaskMs = durations.length ? Math.max(...durations) : 0;
  const markerCoverage = runs.every((run) => {
    const markers = run.markers;
    return Boolean(
      markers.clicked &&
      markers.stageContent &&
      markers.gallery &&
      markers.galleryVisiblePreviews.some((mark) => mark.count > 0) &&
      markers.galleryPreviews.length > 0 &&
      markers.galleryGhosts.length > 0 &&
      markers.parametricEditor &&
      markers.deferredThreePlaceholder &&
      markers.deferredThreePlaceholderRemoved &&
      markers.threePreview &&
      markers.threeCanvas &&
      markers.firstGlSubmission &&
      markers.topologyReady &&
      markers.completed
    );
  });
  const noMemoryProbeOverlap = runs.every(
    (run) => run.memoryProbeWindowsOverlappingMount === 0,
  );
  const noPageErrors = runs.every((run) => run.pageErrors.length === 0);
  const noContextLoss = runs.every(
    (run) => run.contextsLost === 0 && run.contextsRestored === 0,
  );
  return {
    runCount: runs.length,
    presetRunCounts: {
      balanced: runs.filter((run) => run.preset === "balanced").length,
      high: runs.filter((run) => run.preset === "high").length,
    },
    longTaskDurationsMs: durations,
    maximumLongTaskMs,
    tasksOverLimit: durations.filter(
      (duration) => duration > FOUNDRY_COLD_LONG_TASK_LIMIT_MS,
    ).length,
    tasksAtLimit: durations.filter(
      (duration) => duration === FOUNDRY_COLD_LONG_TASK_LIMIT_MS,
    ).length,
    markerCoverage,
    noMemoryProbeOverlap,
    noPageErrors,
    noContextLoss,
    passed:
      maximumLongTaskMs <= FOUNDRY_COLD_LONG_TASK_LIMIT_MS &&
      markerCoverage &&
      noMemoryProbeOverlap &&
      noPageErrors &&
      noContextLoss,
  };
};

export const installFoundryColdMountProbe = (page: Page) => page.evaluate(() => {
  type AuditState = {
    reactCommits: number;
    longTaskEntries: Array<{ startTime: number; duration: number }>;
    auditInternalMemoryMeasurementWindows: Array<{
      startedAtMs: number;
      endedAtMs: number;
    }>;
    webgl: { contextsLost: number; contextsRestored: number };
    graphicsContexts: Array<{
      canvas: HTMLCanvasElement;
      frameSubmissions: Array<{ atMs: number }>;
    }>;
  };
  type Mark = { atMs: number; reactCommits: number };
  type NamedMark = Mark & { name: string };
  type CountMark = Mark & { count: number };
  type Markers = {
    installedAtMs: number;
    clicked: Mark | null;
    transitionFrame: Mark | null;
    stageContent: Mark | null;
    inspector: Mark | null;
    gallery: Mark | null;
    galleryVisiblePreviews: CountMark[];
    galleryPreviews: NamedMark[];
    galleryGhosts: NamedMark[];
    parametricEditor: Mark | null;
    deferredThreePlaceholder: Mark | null;
    deferredThreePlaceholderRemoved: Mark | null;
    deferredThreeLoadStates: NamedMark[];
    threePreview: Mark | null;
    threeCanvas: Mark | null;
    rendererWebgl: Mark | null;
    firstGlSubmission: Mark | null;
    topologyReady: Mark | null;
    completed: Mark | null;
  };
  type Store = {
    markers: Markers;
    observer: MutationObserver;
    clickHandler: (event: MouseEvent) => void;
    record: () => void;
  };
  const host = window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: AuditState;
    __MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__?: Store;
  };
  const old = host.__MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__;
  old?.observer.disconnect();
  if (old) document.removeEventListener("click", old.clickHandler, true);
  const audit = () => host.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  const mark = (): Mark => ({
    atMs: performance.now(),
    reactCommits: audit()?.reactCommits ?? 0,
  });
  const markers: Markers = {
    installedAtMs: performance.now(),
    clicked: null,
    transitionFrame: null,
    stageContent: null,
    inspector: null,
    gallery: null,
    galleryVisiblePreviews: [],
    galleryPreviews: [],
    galleryGhosts: [],
    parametricEditor: null,
    deferredThreePlaceholder: null,
    deferredThreePlaceholderRemoved: null,
    deferredThreeLoadStates: [],
    threePreview: null,
    threeCanvas: null,
    rendererWebgl: null,
    firstGlSubmission: null,
    topologyReady: null,
    completed: null,
  };
  const setOnce = (key: keyof Markers, condition: boolean) => {
    if (condition && markers[key] === null) {
      (markers as unknown as Record<string, unknown>)[key] = mark();
    }
  };
  const recordNamed = (
    destination: NamedMark[],
    elements: Iterable<Element>,
  ) => {
    for (const element of elements) {
      const name = element.getAttribute("data-testid") ?? "unknown";
      if (!destination.some((entry) => entry.name === name)) {
        destination.push({ name, ...mark() });
      }
    }
  };
  const record = () => {
    setOnce(
      "transitionFrame",
      Boolean(document.querySelector('[data-testid="stage-transition-frame"]')),
    );
    const stage = document.querySelector<HTMLElement>('[data-stage="foundry"]');
    setOnce("stageContent", Boolean(stage));
    setOnce(
      "inspector",
      Boolean(stage?.querySelector('[data-testid="foundry-sensemaking-panel"]')),
    );
    const gallery = stage?.querySelector<HTMLElement>(
      '[data-testid="foundry-mechanism-gallery"]',
    );
    setOnce("gallery", Boolean(gallery));
    if (gallery) {
      const count = Number(gallery.getAttribute("data-visible-previews"));
      if (
        Number.isFinite(count) &&
        !markers.galleryVisiblePreviews.some((entry) => entry.count === count)
      ) {
        markers.galleryVisiblePreviews.push({ count, ...mark() });
      }
      recordNamed(
        markers.galleryPreviews,
        gallery.querySelectorAll('[data-testid^="foundry-mini-simulation-"]'),
      );
      recordNamed(
        markers.galleryGhosts,
        gallery.querySelectorAll('[data-testid^="foundry-mini-ghost-"]'),
      );
    }
    setOnce(
      "parametricEditor",
      Boolean(stage?.querySelector('[data-testid="foundry-parametric-editor"]')),
    );
    const placeholder = stage?.querySelector<HTMLElement>(
      '[data-testid="foundry-preview-loading"]',
    );
    setOnce("deferredThreePlaceholder", Boolean(placeholder));
    const loadState = placeholder?.getAttribute("data-preview-load-state");
    if (
      loadState &&
      !markers.deferredThreeLoadStates.some((entry) => entry.name === loadState)
    ) {
      markers.deferredThreeLoadStates.push({ name: loadState, ...mark() });
    }
    const preview = stage?.querySelector<HTMLElement>('[data-testid="foundry-preview"]');
    if (
      markers.deferredThreePlaceholder &&
      !placeholder &&
      preview &&
      !markers.deferredThreePlaceholderRemoved
    ) {
      markers.deferredThreePlaceholderRemoved = mark();
    }
    setOnce("threePreview", Boolean(preview));
    const canvas = preview?.querySelector<HTMLCanvasElement>("canvas.foundry-three-canvas");
    setOnce("threeCanvas", Boolean(canvas));
    setOnce(
      "rendererWebgl",
      preview?.getAttribute("data-three-renderer-status") === "webgl",
    );
    const state = stage?.querySelector<HTMLElement>('[data-testid="foundry-camera-rig"]');
    setOnce(
      "topologyReady",
      state?.getAttribute("data-three-topology-ready") === "true",
    );
    if (canvas && !markers.firstGlSubmission) {
      const context = audit()?.graphicsContexts.find((entry) => entry.canvas === canvas);
      const first = context?.frameSubmissions.find(
        (entry) => entry.atMs >= (
          markers.threeCanvas?.atMs ??
          markers.threePreview?.atMs ??
          markers.clicked?.atMs ??
          markers.installedAtMs
        ),
      );
      if (first) {
        markers.firstGlSubmission = {
          atMs: first.atMs,
          reactCommits: audit()?.reactCommits ?? 0,
        };
      }
    }
  };
  const clickHandler = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-testid="workflow-stage-foundry"]')) return;
    markers.clicked ??= mark();
    record();
  };
  const observer = new MutationObserver(record);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: [
      "data-stage",
      "data-testid",
      "data-visible-previews",
      "data-preview-load-state",
      "data-three-renderer-status",
      "data-three-topology-ready",
    ],
  });
  document.addEventListener("click", clickHandler, true);
  host.__MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__ = {
    markers,
    observer,
    clickHandler,
    record,
  };
  record();
});

export const finishFoundryColdMountProbe = async (
  page: Page,
): Promise<RawFoundryColdDiagnostic> => page.evaluate(() => {
  type AuditState = {
    reactCommits: number;
    longTaskEntries: Array<{ startTime: number; duration: number }>;
    auditInternalMemoryMeasurementWindows: Array<{
      startedAtMs: number;
      endedAtMs: number;
    }>;
    webgl: { contextsLost: number; contextsRestored: number };
  };
  type Store = {
    markers: FoundryColdMountMarkers;
    observer: MutationObserver;
    clickHandler: (event: MouseEvent) => void;
    record: () => void;
  };
  const host = window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: AuditState;
    __MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__?: Store;
  };
  const store = host.__MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__;
  const audit = host.__MOTIONSMITH_CHROMEBOOK_AUDIT__;
  if (!store || !audit || !store.markers.clicked) {
    throw new Error("Foundry cold diagnostic probe is unavailable");
  }
  store.record();
  store.markers.completed = {
    atMs: performance.now(),
    reactCommits: audit.reactCommits,
  };
  store.observer.disconnect();
  document.removeEventListener("click", store.clickHandler, true);
  delete host.__MOTIONSMITH_FOUNDRY_COLD_DIAGNOSTIC__;
  const start = store.markers.clicked.atMs;
  const end = store.markers.completed.atMs;
  const rawLongTasks = audit.longTaskEntries.filter(
    (entry) => entry.startTime < end && entry.startTime + entry.duration > start,
  );
  const memoryProbeWindowsOverlappingMount =
    audit.auditInternalMemoryMeasurementWindows.filter(
      (window) => window.startedAtMs < end && window.endedAtMs > start,
    ).length;
  const preloadResources = (performance.getEntriesByType("resource") as
    PerformanceResourceTiming[])
    .filter((entry) => {
      const file = new URL(entry.name).pathname.split("/").at(-1) ?? "";
      return file.startsWith("MechanismFoundry-") ||
        file.startsWith("ThreeFoundryPreview-");
    })
    .map((entry) => ({
      name: new URL(entry.name).pathname.split("/").at(-1) ?? entry.name,
      startTime: entry.startTime,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
      loadedBeforeClick: entry.responseEnd <= start,
    }));
  return {
    markers: structuredClone(store.markers),
    rawLongTasks: structuredClone(rawLongTasks),
    memoryProbeWindowsOverlappingMount,
    contextsLost: audit.webgl.contextsLost,
    contextsRestored: audit.webgl.contextsRestored,
    preloadResources,
  };
});

export const completeFoundryColdDiagnosticRun = (
  raw: RawFoundryColdDiagnostic,
  input: Pick<FoundryColdDiagnosticRun, "run" | "preset" | "pageErrors">,
): FoundryColdDiagnosticRun => ({
  ...raw,
  ...input,
  longTasks: attributeFoundryColdLongTasks(raw.markers, raw.rawLongTasks),
});

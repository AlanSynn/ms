import type { CDPSession, Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

import type { FoundryColdMountMarkers } from "./chromebookFoundryColdDiagnostic";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";

const gzipAsync = promisify(gzip);
const TRACE_START_MARK = "motionsmith:high-foundry-trace:start";
const TRACE_END_MARK = "motionsmith:high-foundry-trace:end";
const MAX_TRACE_BYTES = 96 * 1024 * 1024;
const CPU_SAMPLING_INTERVAL_US = 1_000;

const TRACE_CATEGORIES = [
  "-*",
  "blink.user_timing",
  "cc",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "renderer.scheduler",
  "toplevel",
  "v8",
].join(",");

type TraceEvent = {
  name: string;
  cat?: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: Record<string, unknown>;
};

type CpuProfile = {
  startTime: number;
  endTime: number;
  nodes: Array<{
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

type PageLongTask = { startTime: number; duration: number };

export type ChromebookCdpTraceSession = {
  client: CDPSession;
  page: Page;
  outputPath: string;
  startedAtPageMs: number;
};

type TraceCategory = "javascript" | "style-layout" | "paint-composite" | "gc" | "other";

const traceData = (event: TraceEvent) =>
  (event.args?.data ?? event.args ?? {}) as Record<string, unknown>;

const classifyEvent = (event: TraceEvent): TraceCategory => {
  const name = event.name;
  if (/GC|Garbage|MinorMC|MajorMC/i.test(name)) return "gc";
  if (/Style|Layout|PrePaint|UpdateLayoutTree|Layerize/i.test(name)) {
    return "style-layout";
  }
  if (/Paint|Composite|Raster|Commit|DrawFrame/i.test(name)) {
    return "paint-composite";
  }
  if (
    /Function|EvaluateScript|EventDispatch|TimerFire|AnimationFrame|Microtasks|V8|Compile|Script/i
      .test(name)
  ) return "javascript";
  return "other";
};

const markerName = (event: TraceEvent) => {
  const data = traceData(event);
  return [event.name, data.name, event.args?.name]
    .find((value) => value === TRACE_START_MARK || value === TRACE_END_MARK);
};

const selfTimeByCategory = (
  events: TraceEvent[],
  startedAtUs: number,
  endedAtUs: number,
) => {
  const intervals = events
    .filter((event) => event.ph === "X" && Number(event.dur) > 0)
    .map((event) => ({
      event,
      start: Math.max(startedAtUs, event.ts),
      end: Math.min(endedAtUs, event.ts + Number(event.dur)),
    }))
    .filter((interval) => interval.end > interval.start);
  const boundaries = [...new Set([
    startedAtUs,
    endedAtUs,
    ...intervals.flatMap((interval) => [interval.start, interval.end]),
  ])].sort((left, right) => left - right);
  const totals: Record<TraceCategory, number> = {
    javascript: 0,
    "style-layout": 0,
    "paint-composite": 0,
    gc: 0,
    other: 0,
  };
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    const midpoint = (start + end) / 2;
    const innermost = intervals
      .filter((interval) => interval.start <= midpoint && interval.end >= midpoint)
      .sort((left, right) =>
        (left.end - left.start) - (right.end - right.start)
      )[0];
    totals[innermost ? classifyEvent(innermost.event) : "other"] += end - start;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([category, durationUs]) => [
      category,
      durationUs / 1_000,
    ]),
  ) as Record<TraceCategory, number>;
};

const topTraceEvents = (
  events: TraceEvent[],
  startedAtUs: number,
  endedAtUs: number,
) => events
  .filter((event) =>
    event.ph === "X" &&
    Number(event.dur) > 0 &&
    event.ts < endedAtUs &&
    event.ts + Number(event.dur) > startedAtUs
  )
  .map((event) => {
    const data = traceData(event);
    return {
      name: event.name,
      category: classifyEvent(event),
      durationMs: Number(event.dur) / 1_000,
      functionName: typeof data.functionName === "string"
        ? data.functionName
        : null,
      url: [data.url, data.scriptName].find(
        (value): value is string => typeof value === "string" && value.length > 0,
      ) ?? null,
      lineNumber: typeof data.lineNumber === "number" ? data.lineNumber : null,
      columnNumber: typeof data.columnNumber === "number" ? data.columnNumber : null,
    };
  })
  .sort((left, right) => right.durationMs - left.durationMs)
  .slice(0, 30);

const topCpuFunctions = (
  profile: CpuProfile,
  startedAtUs: number,
  endedAtUs: number,
) => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map<number, number>();
  let sampleAtUs = profile.startTime;
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const deltaUs = profile.timeDeltas?.[index] ?? 0;
    sampleAtUs += deltaUs;
    if (sampleAtUs < startedAtUs || sampleAtUs > endedAtUs) continue;
    const nodeId = profile.samples![index]!;
    totals.set(nodeId, (totals.get(nodeId) ?? 0) + deltaUs);
  }
  return [...totals.entries()]
    .map(([nodeId, sampledUs]) => {
      const frame = nodes.get(nodeId)?.callFrame;
      return {
        functionName: frame?.functionName || "(anonymous)",
        url: frame?.url || null,
        lineNumber: frame?.lineNumber ?? null,
        columnNumber: frame?.columnNumber ?? null,
        sampledMs: sampledUs / 1_000,
      };
    })
    .sort((left, right) => right.sampledMs - left.sampledMs)
    .slice(0, 30);
};

export const analyzeChromebookCdpTrace = ({
  traceEvents,
  cpuProfile,
  longTasks,
  startedAtPageMs,
  foundryChildMarkers = null,
}: {
  traceEvents: TraceEvent[];
  cpuProfile: CpuProfile;
  longTasks: PageLongTask[];
  startedAtPageMs: number;
  foundryChildMarkers?: FoundryColdMountMarkers | null;
}) => {
  const startMark = traceEvents.find((event) => markerName(event) === TRACE_START_MARK);
  const endMark = traceEvents.find((event) => markerName(event) === TRACE_END_MARK);
  if (!startMark || !endMark) {
    throw new Error("CDP trace is missing the bounded Foundry user-timing markers");
  }
  const mainThreadEvents = traceEvents.filter((event) =>
    event.pid === startMark.pid && event.tid === startMark.tid
  );
  const firstVisiblePreviewAtMs = foundryChildMarkers?.galleryVisiblePreviews
    .find((mark) => mark.count === 1)?.atMs ?? null;
  const phaseWindows = foundryChildMarkers
    ? [
        ["trace-start-to-click", startedAtPageMs, foundryChildMarkers.clicked?.atMs],
        ["click-to-transition", foundryChildMarkers.clicked?.atMs,
          foundryChildMarkers.transitionFrame?.atMs],
        ["transition-to-stage", foundryChildMarkers.transitionFrame?.atMs,
          foundryChildMarkers.stageContent?.atMs],
        ["post-stage-before-gallery1", foundryChildMarkers.stageContent?.atMs,
          firstVisiblePreviewAtMs],
        ["gallery1-to-parametric", firstVisiblePreviewAtMs,
          foundryChildMarkers.parametricEditor?.atMs],
        ["parametric-to-three", foundryChildMarkers.parametricEditor?.atMs,
          foundryChildMarkers.threePreview?.atMs],
        ["three-to-first-gl", foundryChildMarkers.threePreview?.atMs,
          foundryChildMarkers.firstGlSubmission?.atMs],
        ["first-gl-to-topology", foundryChildMarkers.firstGlSubmission?.atMs,
          foundryChildMarkers.topologyReady?.atMs],
      ].flatMap(([label, start, end]) =>
        typeof start === "number" && typeof end === "number" && end > start
          ? [{ label: String(label), startedAtPageMs: start, endedAtPageMs: end }]
          : []
      )
    : [];
  const phaseLabelsFor = (startTime: number, duration: number) => {
    const endTime = startTime + duration;
    const labels = phaseWindows.filter((phase) =>
      startTime < phase.endedAtPageMs && endTime > phase.startedAtPageMs
    ).map((phase) => phase.label);
    return labels.length ? labels : ["trace-window-unmarked"];
  };
  const tasks = longTasks.map((task) => {
    const startedAtUs = startMark.ts + (task.startTime - startedAtPageMs) * 1_000;
    const endedAtUs = startedAtUs + task.duration * 1_000;
    const events = mainThreadEvents.filter((event) =>
      event.ts < endedAtUs &&
      event.ts + Number(event.dur ?? 0) > startedAtUs
    );
    const matchingRunTask = events
      .filter((event) => /RunTask|ProcessTaskFromWorkQueue/.test(event.name))
      .sort((left, right) =>
        Math.abs(Number(left.dur ?? 0) - task.duration * 1_000) -
        Math.abs(Number(right.dur ?? 0) - task.duration * 1_000)
      )[0];
    return {
      ...task,
      traceStartedAtUs: startedAtUs,
      traceEndedAtUs: endedAtUs,
      matchingRunTask: matchingRunTask
        ? { name: matchingRunTask.name, durationMs: Number(matchingRunTask.dur) / 1_000 }
        : null,
      selfTimeMs: selfTimeByCategory(events, startedAtUs, endedAtUs),
      topTraceEvents: topTraceEvents(events, startedAtUs, endedAtUs),
      topCpuFunctions: topCpuFunctions(cpuProfile, startedAtUs, endedAtUs),
    };
  });
  const rendererTaskCandidates = mainThreadEvents
    .filter((event) =>
      /(?:^|::)RunTask$|ProcessTaskFromWorkQueue/.test(event.name) &&
      event.ph === "X" &&
      Number(event.dur) >= 50_000 &&
      event.ts >= startMark.ts &&
      event.ts + Number(event.dur) <= endMark.ts
    );
  const rendererTasksOver50 = rendererTaskCandidates
    .filter((event) =>
      event.name === "RunTask" ||
      !rendererTaskCandidates.some((candidate) =>
        candidate.name === "RunTask" &&
        Math.abs(candidate.ts - event.ts) <= 1_000 &&
        Math.abs(
          candidate.ts + Number(candidate.dur) -
            (event.ts + Number(event.dur)),
        ) <= 1_000
      )
    )
    .map((event) => {
      const startTime = startedAtPageMs + (event.ts - startMark.ts) / 1_000;
      const duration = Number(event.dur) / 1_000;
      const endedAtUs = event.ts + Number(event.dur);
      const linkedPageLongTask = longTasks
        .map((task) => ({
          task,
          overlapMs: Math.max(0, Math.min(startTime + duration,
            task.startTime + task.duration) - Math.max(startTime, task.startTime)),
        }))
        .sort((left, right) => right.overlapMs - left.overlapMs)[0];
      return {
        startTime,
        duration,
        phaseLabels: phaseLabelsFor(startTime, duration),
        linkedPageLongTask: linkedPageLongTask && linkedPageLongTask.overlapMs > 0
          ? { ...linkedPageLongTask.task, overlapMs: linkedPageLongTask.overlapMs }
          : null,
        selfTimeMs: selfTimeByCategory(mainThreadEvents, event.ts, endedAtUs),
        topTraceEvents: topTraceEvents(mainThreadEvents, event.ts, endedAtUs),
        topCpuFunctions: topCpuFunctions(cpuProfile, event.ts, endedAtUs),
      };
    });
  return {
    traceWindow: {
      startedAtPageMs,
      startedAtTraceUs: startMark.ts,
      endedAtTraceUs: endMark.ts,
      durationMs: (endMark.ts - startMark.ts) / 1_000,
      rendererMainThread: { pid: startMark.pid, tid: startMark.tid },
    },
    phaseWindows,
    tasks,
    rendererTasksOver50,
  };
};

const readTraceStream = async (client: CDPSession, stream: string) => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await client.send("IO.read", { handle: stream });
    const chunk = Buffer.from(
      result.data,
      result.base64Encoded ? "base64" : "utf8",
    );
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_TRACE_BYTES) {
      await client.send("IO.close", { handle: stream }).catch(() => undefined);
      throw new Error(`Bounded CDP trace exceeded ${MAX_TRACE_BYTES} bytes`);
    }
    chunks.push(chunk);
    if (result.eof) break;
  }
  await client.send("IO.close", { handle: stream });
  return Buffer.concat(chunks);
};

export const startChromebookFoundryCdpTrace = async (
  page: Page,
  client: CDPSession,
  outputPath: string,
): Promise<ChromebookCdpTraceSession> => {
  await client.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    options: "record-until-full",
    transferMode: "ReturnAsStream",
  });
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", {
    interval: CPU_SAMPLING_INTERVAL_US,
  });
  await client.send("Profiler.start");
  const startedAtPageMs = await page.evaluate((name) => {
    const atMs = performance.now();
    performance.mark(name);
    return atMs;
  }, TRACE_START_MARK);
  return { client, page, outputPath, startedAtPageMs };
};

export const stopChromebookFoundryCdpTrace = async (
  session: ChromebookCdpTraceSession,
  foundryChildMarkers: FoundryColdMountMarkers | null,
) => {
  const { client, page, outputPath, startedAtPageMs } = session;
  const endedAtPageMs = await page.evaluate((name) => {
    const atMs = performance.now();
    performance.mark(name);
    return atMs;
  }, TRACE_END_MARK);
  const longTasks = await page.evaluate(({ start, end }) => {
    const audit = (window as Window & {
      __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
        longTaskEntries: PageLongTask[];
      };
    }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
    return (audit?.longTaskEntries ?? []).filter((task) =>
      task.startTime < end && task.startTime + task.duration > start
    );
  }, { start: startedAtPageMs, end: endedAtPageMs });
  const cpuProfile = (await client.send("Profiler.stop")).profile as CpuProfile;
  await client.send("Profiler.disable");
  const tracingComplete = new Promise<{
    stream?: string;
    dataLossOccurred?: boolean;
  }>((resolve) => {
    client.once("Tracing.tracingComplete", resolve);
  });
  await client.send("Tracing.end");
  const { stream, dataLossOccurred = false } = await tracingComplete;
  if (!stream) throw new Error("CDP tracing completed without a stream handle");
  const traceBuffer = await readTraceStream(client, stream);
  const trace = JSON.parse(traceBuffer.toString("utf8")) as {
    traceEvents: TraceEvent[];
    metadata?: unknown;
  };
  const analysis = analyzeChromebookCdpTrace({
    traceEvents: trace.traceEvents,
    cpuProfile,
    longTasks,
    startedAtPageMs,
    foundryChildMarkers,
  });
  const base = outputPath.replace(/\.json$/i, "");
  const tracePath = `${base}.trace.json.gz`;
  const cpuProfilePath = `${base}.cpuprofile.json`;
  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    gzipAsync(traceBuffer).then((compressed) => writeFile(tracePath, compressed)),
    writeFile(cpuProfilePath, `${JSON.stringify(cpuProfile)}\n`, "utf8"),
  ]);
  const runtime = await page.evaluate(() => ({
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    deviceScaleFactor: devicePixelRatio,
  }));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    diagnosticOnly: true,
    acceptanceDerivedFromTrace: false,
    instrumentationPerturbsTiming: true,
    dataLossOccurred,
    trustworthy: !dataLossOccurred,
    profile: {
      name: CHROMEBOOK_AUDIT_PROFILE.name,
      cpuThrottlingRate:
        CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottlingRate,
      cpuThrottleScope:
        CHROMEBOOK_AUDIT_PROFILE.environment.cpuThrottleDisclosure,
      network: CHROMEBOOK_AUDIT_PROFILE.environment.network,
    },
    runtime,
    traceCategories: TRACE_CATEGORIES,
    cpuSamplingIntervalUs: CPU_SAMPLING_INTERVAL_US,
    maximumUncompressedTraceBytes: MAX_TRACE_BYTES,
    startedAtPageMs,
    endedAtPageMs,
    longTasks,
    foundryChildMarkers,
    trace: {
      uncompressedBytes: traceBuffer.byteLength,
      gzipPath: tracePath,
      cpuProfilePath,
    },
    analysis,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

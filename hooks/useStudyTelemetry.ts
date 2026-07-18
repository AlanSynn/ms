import { useEffect, useMemo, useRef } from "react";
import type { AppStage, CanvasViewport, ProjectState } from "../types";
import {
  commitPendingStudySnapshot,
  flushStudyTelemetry,
  queueStudySourceImages,
  recordStudyEvent,
  recordStudySessionStart,
  recordStudyStage,
  scheduleStudySnapshot,
  setStudyViewContext,
  STUDY_PROFILE,
  studyProjectAlias,
  studyTelemetryEnabled,
} from "../utils/studyTelemetry";

type StudyTelemetryOptions = {
  project: ProjectState;
  stage: AppStage;
  viewport: CanvasViewport;
  isPlaying: boolean;
  commandStatus: string;
  showGettingStarted: boolean;
  showShortcuts: boolean;
  showAbout: boolean;
  showRecommendations: boolean;
  showTracking: boolean;
};

const SAFE_CONTROL_PREFIXES = new Set([
  "app", "assembly", "blueprint", "bug", "canvas", "character", "context",
  "design", "edit", "foundry", "getting", "guided", "help", "menu",
  "mechanism", "onnx", "options", "part", "path", "player", "project",
  "scene", "simulation", "skeleton", "stage", "view", "workspace",
]);

const controlCode = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return "unknown";
  const element = target.closest<HTMLElement>(
    "[data-testid],button,a,input,select,textarea,[role='button']",
  );
  const testIdPrefix = element?.dataset.testid
    ?.toLowerCase()
    .match(/^[a-z]+/)?.[0];
  const tag = element?.tagName.toLowerCase() || target.tagName.toLowerCase();
  const type = element?.getAttribute("type")?.toLowerCase().replace(/[^a-z]/g, "") || "control";
  return testIdPrefix && SAFE_CONTROL_PREFIXES.has(testIdPrefix)
    ? `ui-${testIdPrefix}`
    : `ui-${tag}-${type}`;
};

const bugReportTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("[data-testid='bug-report-overlay']"));

const statusCode = (status: string) => {
  if (/collision/i.test(status)) return "collision";
  if (/constraint/i.test(status)) return "constraint";
  if (/invalid/i.test(status)) return "invalid";
  if (/export.*fail|fail.*export/i.test(status)) return "export_failed";
  if (/save.*fail|fail.*save/i.test(status)) return "save_failed";
  if (/network|offline/i.test(status)) return "network";
  if (/fail|error/i.test(status)) return "application_error";
  if (/blocked|fix:/i.test(status)) return "blocked";
  return undefined;
};

export const useStudyTelemetry = ({
  project,
  stage,
  viewport,
  isPlaying,
  commandStatus,
  showGettingStarted,
  showShortcuts,
  showAbout,
  showRecommendations,
  showTracking,
}: StudyTelemetryOptions) => {
  const enabled = studyTelemetryEnabled();
  const projectAlias = useMemo(
    () => enabled ? studyProjectAlias(project.metadata.id) : undefined,
    [enabled, project.metadata.id],
  );
  const firstProject = useRef(true);
  const visibleStartedAt = useRef(
    typeof performance === "undefined" ? 0 : performance.now(),
  );
  const activeMs = useRef(0);
  const latestProject = useRef(project);
  const completed = useRef(Boolean(project.lastExport));
  latestProject.current = project;

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    if (!projectAlias) return;
    setStudyViewContext(stage, projectAlias);
    recordStudySessionStart(project, projectAlias);
    const url = new URL(window.location.href);
    ["msParticipant", "msTeam", "msClass", "msSession"].forEach((key) =>
      url.searchParams.delete(key),
    );
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    if (!projectAlias) return;
    recordStudyStage(stage);
    setStudyViewContext(stage, projectAlias);
    scheduleStudySnapshot(project, projectAlias, "stage", true);
  }, [stage]);

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    if (!projectAlias) return;
    setStudyViewContext(stage, projectAlias);
    scheduleStudySnapshot(
      project,
      projectAlias,
      firstProject.current ? "session_start" : "commit",
      firstProject.current,
    );
    firstProject.current = false;
    queueStudySourceImages(project, projectAlias);
  }, [project, projectAlias]);

  useEffect(() => {
    const nowComplete = Boolean(project.lastExport);
    if (nowComplete && !completed.current) {
      recordStudyEvent(
        "project.completed",
        {
          recipes: project.lastExport?.recipes.length ?? 0,
          validationIssues: project.lastExport?.validationIssues.length ?? 0,
        },
        { level: "metrics", immediate: true },
      );
    }
    completed.current = nowComplete;
  }, [project.lastExport]);

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    const timer = window.setTimeout(() => {
      recordStudyEvent(
        "view.viewport",
        {
          x: Math.round(viewport.offset.x * 10) / 10,
          y: Math.round(viewport.offset.y * 10) / 10,
          zoom: Math.round(viewport.zoom * 1000) / 1000,
        },
        { level: "replay", coalesceKey: "viewport" },
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [viewport.offset.x, viewport.offset.y, viewport.zoom]);

  useEffect(() => {
    recordStudyEvent(
      "simulation.playback",
      { state: isPlaying ? "playing" : "stopped", mechanismCount: project.mechanisms.length },
      { level: "metrics", immediate: true },
    );
  }, [isPlaying]);

  useEffect(() => {
    const code = statusCode(commandStatus);
    if (code) {
      recordStudyEvent(
        "technical.status",
        { code, processingStage: project.processing.stage },
        { level: "metrics", immediate: true },
      );
    }
  }, [commandStatus, project.processing.stage]);

  useEffect(() => {
    const modal = showGettingStarted
      ? "getting_started"
      : showShortcuts
        ? "shortcuts"
        : showAbout
          ? "about"
          : showRecommendations
            ? "recommendations"
            : showTracking
              ? "tracking"
              : "none";
    recordStudyEvent("ui.modal", { modal }, { level: "metrics", coalesceKey: "modal" });
  }, [showGettingStarted, showShortcuts, showAbout, showRecommendations, showTracking]);

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    const pointers = new Map<number, {
      x: number;
      y: number;
      t: number;
      target: string;
      samples: number;
    }>();
    const onClick = (event: MouseEvent) => {
      if (bugReportTarget(event.target)) return;
      recordStudyEvent("ui.activate", { control: controlCode(event.target) }, { level: "replay" });
    };
    const onChange = (event: Event) => {
      if (bugReportTarget(event.target)) return;
      recordStudyEvent("ui.change", { control: controlCode(event.target) }, { level: "replay" });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (bugReportTarget(event.target)) return;
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        t: performance.now(),
        target: controlCode(event.target),
        samples: 1,
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      const start = pointers.get(event.pointerId);
      if (start) start.samples += 1;
    };
    const finishPointer = (event: PointerEvent, outcome: "complete" | "cancel") => {
      const start = pointers.get(event.pointerId);
      if (!start) return;
      pointers.delete(event.pointerId);
      recordStudyEvent(
        "ui.gesture",
        {
          control: start.target,
          outcome,
          dx: Math.round((event.clientX - start.x) / 8) * 8,
          dy: Math.round((event.clientY - start.y) / 8) * 8,
          durationMs: Math.round((performance.now() - start.t) / 10) * 10,
          pointerSamples: start.samples,
          affectedEntityCount: 1,
        },
        { level: "study" },
      );
    };
    const onPointerUp = (event: PointerEvent) => finishPointer(event, "complete");
    const onPointerCancel = (event: PointerEvent) => finishPointer(event, "cancel");
    const onLostPointerCapture = (event: PointerEvent) => finishPointer(event, "cancel");
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    if (STUDY_PROFILE === "study") {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerCancel, true);
      document.addEventListener("lostpointercapture", onLostPointerCapture, true);
    }
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    };
  }, []);

  useEffect(() => {
    if (!studyTelemetryEnabled()) return;
    const onError = (event: ErrorEvent) =>
      recordStudyEvent(
        "technical.error",
        { code: "window_error", kind: event.error instanceof Error ? event.error.name.slice(0, 48) : "unknown" },
        { level: "metrics", immediate: true },
      );
    const onRejection = (event: PromiseRejectionEvent) =>
      recordStudyEvent(
        "technical.error",
        { code: "unhandled_rejection", kind: event.reason instanceof Error ? event.reason.name.slice(0, 48) : typeof event.reason },
        { level: "metrics", immediate: true },
      );
    const onOnline = () => {
      recordStudyEvent("network.state", { state: "online" }, { level: "metrics", immediate: true });
      void flushStudyTelemetry("online");
    };
    const onOffline = () =>
      recordStudyEvent("network.state", { state: "offline" }, { level: "metrics" });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (visibleStartedAt.current) {
          activeMs.current += Math.max(0, performance.now() - visibleStartedAt.current);
          visibleStartedAt.current = 0;
        }
        recordStudyEvent("session.pause", { activeMs: Math.round(activeMs.current) }, { level: "metrics" });
        commitPendingStudySnapshot();
        void flushStudyTelemetry("hidden", true, true, true);
      } else {
        visibleStartedAt.current = performance.now();
        recordStudyEvent("session.resume", undefined, { level: "metrics" });
      }
    };
    const onPageHide = () => {
      if (visibleStartedAt.current) {
        activeMs.current += Math.max(0, performance.now() - visibleStartedAt.current);
        visibleStartedAt.current = 0;
      }
      const finalProject = latestProject.current;
      recordStudyEvent(
        "session.pagehide",
        {
          activeMs: Math.round(activeMs.current),
          completed: Boolean(finalProject.lastExport),
          parts: finalProject.partOrder.length,
          objects: finalProject.sceneObjectOrder.length,
          paths: Object.keys(finalProject.paths).length,
          mechanisms: finalProject.mechanisms.length,
        },
        { level: "metrics" },
      );
      commitPendingStudySnapshot();
      void flushStudyTelemetry("pagehide", true, true, true);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
};

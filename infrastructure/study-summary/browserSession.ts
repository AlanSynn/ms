import type { MechanismType } from "../../types";
import type { AutosaveWriteResult } from "../../utils/projectPersistence";
import {
  createStudySummarySession,
  type StudyCommandFamily,
  type StudyCommandOutcome,
  type StudyExportBlocker,
  type StudyExportOutcome,
  type StudyFitOutcome,
  type StudyImageInferenceOutcome,
  type StudyMechanismFamily,
  type StudySummarySession,
} from "../../utils/studySummaryTelemetry";

export const STUDY_SUMMARY_ENABLED =
  typeof __MOTIONSMITH_STUDY_SUMMARY_ENABLED__ !== "undefined" &&
  __MOTIONSMITH_STUDY_SUMMARY_ENABLED__;

const compiledTarget =
  typeof __MOTIONSMITH_STUDY_SUMMARY_TARGET__ === "string"
    ? __MOTIONSMITH_STUDY_SUMMARY_TARGET__
    : "";
const compiledBuildSha =
  typeof __MOTIONSMITH_BUILD_SHA__ === "string"
    ? __MOTIONSMITH_BUILD_SHA__
    : "";

const networkBucket = (): "offline" | "slow" | "fast" | "unknown" => {
  if (typeof navigator === "undefined") return "unknown";
  if (!navigator.onLine) return "offline";
  const connection = (
    navigator as Navigator & { connection?: { effectiveType?: unknown } }
  ).connection;
  const effectiveType = connection?.effectiveType;
  if (
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g"
  )
    return "slow";
  if (effectiveType === "4g") return "fast";
  return "unknown";
};

const pointerBucket = (): "mouse" | "touch" | "unknown" => {
  if (typeof navigator === "undefined") return "unknown";
  return navigator.maxTouchPoints > 0 ? "touch" : "mouse";
};

let session: StudySummarySession | undefined;
let initializationAttempted = false;

export const browserStudySummarySession = ():
  | StudySummarySession
  | undefined => {
  if (
    !STUDY_SUMMARY_ENABLED ||
    typeof window === "undefined" ||
    typeof navigator === "undefined"
  )
    return undefined;
  if (session || initializationAttempted) return session;
  initializationAttempted = true;
  try {
    session = createStudySummarySession({
      buildSha: compiledBuildSha,
      profile: "study",
      endpoint: compiledTarget,
      context: {
        viewport: window.innerWidth,
        hardwareConcurrency: navigator.hardwareConcurrency,
        pointer: pointerBucket(),
        network: networkBucket(),
      },
      transport: {
        send: async (target, payload) => {
          const response = await fetch(target, {
            method: "POST",
            body: payload,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            credentials: "omit",
            keepalive: true,
            referrerPolicy: "no-referrer",
          });
          if (!response.ok) throw new Error("Study summary delivery failed");
        },
        beacon: (target, payload) =>
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon(
            target,
            new Blob([payload], { type: "text/plain;charset=UTF-8" }),
          ),
      },
    });
  } catch {
    session = undefined;
  }
  return session;
};

export const studyMechanismFamily = (
  type: MechanismType,
): StudyMechanismFamily => {
  if (type === "4bar") return "four-bar";
  if (type === "piston" || type === "yoke" || type === "quick-return")
    return "slider";
  if (
    type === "gear" ||
    type === "gear_linkage" ||
    type === "planetary_gear"
  )
    return "gear";
  if (type === "cam") return "cam";
  if (type === "rack-pinion") return "rack";
  if (type === "crank" || type === "5bar" || type === "6bar")
    return "linkage";
  return "unknown";
};

export const studyExportBlocker = (
  blocker: string | undefined,
): StudyExportBlocker => {
  if (!blocker) return "unknown";
  const value = blocker.toLowerCase();
  if (value.includes("path")) return "no-path";
  if (value.includes("board") || value.includes("sheet")) return "board-fit";
  if (value.includes("part")) return "missing-part";
  if (value.includes("collision") || value.includes("overlap"))
    return "collision";
  if (value.includes("unsupported") || value.includes("template"))
    return "unsupported";
  if (value.includes("mechanism") || value.includes("constraint"))
    return "invalid-mechanism";
  return "unknown";
};

export const recordStudyCommand = (
  family: StudyCommandFamily,
  outcome: StudyCommandOutcome,
) => browserStudySummarySession()?.recordCommand(family, outcome);

export const recordStudyMechanism = (
  type: MechanismType,
  outcome: StudyCommandOutcome,
) => {
  const current = browserStudySummarySession();
  current?.recordCommand("mechanism", outcome);
  if (outcome === "accepted")
    current?.recordMechanism(studyMechanismFamily(type));
};

export const recordStudyFit = (
  outcome: StudyFitOutcome,
  durationMs: number,
) => {
  const current = browserStudySummarySession();
  current?.recordCommand(
    "fit",
    outcome === "accepted"
      ? "accepted"
      : outcome === "no-op"
        ? "no-op"
        : "rejected",
  );
  current?.recordFit(outcome, durationMs);
};

export const recordStudyExport = (
  outcome: StudyExportOutcome,
  blocker?: StudyExportBlocker,
) => {
  const current = browserStudySummarySession();
  current?.recordCommand(
    "export",
    outcome === "success"
      ? "accepted"
      : outcome === "cancelled"
        ? "no-op"
        : "rejected",
  );
  current?.recordExport(outcome, blocker);
  if (current) void current.flush();
};

export const recordStudyAutosave = (
  result: AutosaveWriteResult,
  durationMs: number,
  recovery = false,
) =>
  browserStudySummarySession()?.recordAutosave(
    result.status === "saved" ? "success" : "failure",
    recovery,
    durationMs,
  );

export const recordStudyAutosaveRecovery = (
  outcome: "success" | "failure" | "no-op",
  durationMs: number,
) => {
  const current = browserStudySummarySession();
  current?.recordCommand(
    "autosave",
    outcome === "success"
      ? "accepted"
      : outcome === "no-op"
        ? "no-op"
        : "rejected",
  );
  current?.recordAutosave(
    outcome === "success"
      ? "success"
      : outcome === "failure"
        ? "failure"
        : "unknown",
    true,
    durationMs,
  );
};

export const recordStudyImageInference = (
  outcome: StudyImageInferenceOutcome,
  durationMs: number,
) => {
  const current = browserStudySummarySession();
  current?.recordCommand(
    "inference",
    outcome === "success" ? "accepted" : "rejected",
  );
  current?.recordImageInference(outcome, durationMs);
};

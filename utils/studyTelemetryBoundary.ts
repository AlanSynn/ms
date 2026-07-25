type StudyTelemetryRuntime = typeof import("./studyTelemetry");

export type StudyProfile = import("./studyTelemetry").StudyProfile;
export type StudyLevel = import("./studyTelemetry").StudyLevel;
export type StudyTelemetryStatus =
  import("./studyTelemetry").StudyTelemetryStatus;

export const STUDY_PROFILE: StudyProfile = "off";
export const STUDY_ENDPOINT = "";
export const studyProfileIncludes:
  StudyTelemetryRuntime["studyProfileIncludes"] = () => false;
export const studyTelemetryStatus:
  StudyTelemetryRuntime["studyTelemetryStatus"] = () => "off";
export const studyTelemetryEnabled:
  StudyTelemetryRuntime["studyTelemetryEnabled"] = () => false;
export const studyProjectAlias:
  StudyTelemetryRuntime["studyProjectAlias"] = (rawId) => rawId;
export const studyTelemetryDiagnostics:
  StudyTelemetryRuntime["studyTelemetryDiagnostics"] = () => ({
    bufferedRecords: 0,
    losses: { "core-action": 0, technical: 0, snapshot: 0, asset: 0 },
    transportMode: "normal",
    snapshotPreparation: { lastMs: 0, maxMs: 0, failures: 0 },
  });
export const recordStudyEvent:
  StudyTelemetryRuntime["recordStudyEvent"] = () => {};
export const setStudyViewContext:
  StudyTelemetryRuntime["setStudyViewContext"] = () => {};
export const recordStudyStage:
  StudyTelemetryRuntime["recordStudyStage"] = () => {};
export const recordStudyProjectAction:
  StudyTelemetryRuntime["recordStudyProjectAction"] = () => {};
export const recordStudyProjectReplace:
  StudyTelemetryRuntime["recordStudyProjectReplace"] = () => {};
export const commitPendingStudySnapshot:
  StudyTelemetryRuntime["commitPendingStudySnapshot"] = () => {};
export const scheduleStudySnapshot:
  StudyTelemetryRuntime["scheduleStudySnapshot"] = () => {};
export const flushStudyTelemetry:
  StudyTelemetryRuntime["flushStudyTelemetry"] = async () => false;
export const queueStudySourceImages:
  StudyTelemetryRuntime["queueStudySourceImages"] = () => {};
export const studyTechnicalContext:
  StudyTelemetryRuntime["studyTechnicalContext"] = () => ({
    browser: "other",
    browserMajor: 0,
    os: "other",
    viewport: [0, 0],
    screen: [0, 0],
    dpr: 1,
    pointer: "fine",
    network: "unknown",
    saveData: false,
    loadMs: 0,
    memoryGb: 0,
  });
export const recordStudySessionStart:
  StudyTelemetryRuntime["recordStudySessionStart"] = () => {};

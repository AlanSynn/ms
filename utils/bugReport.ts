const DEFAULT_STUDY_ENDPOINT = "/ms-study/v1";
const BUG_ISSUE_URL = "https://github.com/AlanSynn/ms/issues/new";
const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_EDGE = 1280;
const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const bugBuildSha = buildEnv.VITE_STUDY_BUILD_SHA?.match(/^[A-Za-z0-9._-]{1,96}$/)?.[0] ?? "local";
const bugDeployment = buildEnv.VITE_STUDY_DEPLOYMENT?.match(/^[A-Za-z0-9._-]{1,96}$/)?.[0] ?? "local";

export const BUG_REPORT_LIMITS = {
  summary: 160,
  steps: 4000,
  expected: 2000,
  email: 254,
  stage: 100,
} as const;

export type BugScreenshot = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  name: string;
};

export type BugReportFields = {
  summary: string;
  steps: string;
  expected: string;
  email: string;
  stage: string;
  appVersion: string;
};

export const newBugSubmissionId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return `${Date.now().toString(16).slice(-8).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`;
};

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const fitSize = (width: number, height: number, maxEdge: number) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const encodeScreenshot = async (source: HTMLCanvasElement) => {
  let size = fitSize(source.width, source.height, MAX_SCREENSHOT_EDGE);
  let preferredType = "image/webp";

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot capture failed.");
    context.drawImage(source, 0, 0, size.width, size.height);

    let blob = await canvasBlob(canvas, preferredType, 0.72);
    if (!blob || blob.type !== preferredType) {
      preferredType = "image/png";
      blob = await canvasBlob(canvas, preferredType);
    }
    if (!blob) throw new Error("Screenshot encoding failed.");
    if (blob.size <= MAX_SCREENSHOT_BYTES) {
      return { blob, ...size };
    }

    size = fitSize(size.width, size.height, Math.floor(Math.max(size.width, size.height) * 0.8));
  }
};

export const captureBugScreenshot = async (): Promise<BugScreenshot> => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not available in this browser.");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const source = document.createElement("canvas");
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    source.width = video.videoWidth || window.innerWidth;
    source.height = video.videoHeight || window.innerHeight;
    const context = source.getContext("2d");
    if (!context) throw new Error("Screenshot capture failed.");
    context.drawImage(video, 0, 0, source.width, source.height);
    video.srcObject = null;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }

  const encoded = await encodeScreenshot(source);
  const extension = encoded.blob.type === "image/webp" ? "webp" : "png";
  return {
    ...encoded,
    url: URL.createObjectURL(encoded.blob),
    name: `motionsmith-bug.${extension}`,
  };
};

const browserDetails = () => {
  const userAgent = navigator.userAgent;
  const match = userAgent.match(/Edg\/(\d+)/)
    ?? userAgent.match(/(?:Chrome|CriOS)\/(\d+)/)
    ?? userAgent.match(/(?:Firefox|FxiOS)\/(\d+)/)
    ?? userAgent.match(/Version\/(\d+).+Safari/);
  const browserFamily = userAgent.includes("Edg/")
    ? "Edge"
    : /Chrome|CriOS/.test(userAgent)
      ? "Chrome"
      : /Firefox|FxiOS/.test(userAgent)
        ? "Firefox"
        : /Safari/.test(userAgent)
          ? "Safari"
          : "Other";
  return { browserFamily, browserMajor: match?.[1] ?? "unknown" };
};

const bounded = (value: string, limit: number) => value.trim().slice(0, limit);
const redactPublicIdentity = (value: string) => value
  .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted email]")
  .replace(/\+?\d[\d ().-]{7,}\d/g, "[redacted phone]");

export const bugReportText = (fields: BugReportFields) => [
  `What happened\n${fields.summary.trim() || "Not provided"}`,
  `Steps\n${fields.steps.trim() || "Not provided"}`,
  `Expected\n${fields.expected.trim() || "Not provided"}`,
  `Context\nStage: ${fields.stage}\nApp: MotionSmith v${fields.appVersion}\nDeployment: ${bugDeployment}\nBuild: ${bugBuildSha}`,
  fields.email.trim() ? `Contact\n${fields.email.trim()}` : "",
].filter(Boolean).join("\n\n");

const bugReportDraftUrl = (fields: BugReportFields) => `${BUG_ISSUE_URL}?${new URLSearchParams({
  title: `Bug: ${redactPublicIdentity(bounded(fields.summary, 80)) || fields.stage}`,
  body: redactPublicIdentity(bugReportText({ ...fields, email: "" })),
  labels: "bug",
})}`;

export const submitBugReport = async (
  fields: BugReportFields,
  screenshot: BugScreenshot | undefined,
  submissionId: string,
) => {
  const viewportBucket = window.innerWidth < 768 ? "small" : window.innerWidth < 1200 ? "medium" : "large";
  const report = {
    submissionId,
    summary: bounded(fields.summary, BUG_REPORT_LIMITS.summary),
    steps: bounded(fields.steps, BUG_REPORT_LIMITS.steps),
    expected: bounded(fields.expected, BUG_REPORT_LIMITS.expected),
    email: bounded(fields.email, BUG_REPORT_LIMITS.email),
    stage: bounded(fields.stage, BUG_REPORT_LIMITS.stage),
    appVersion: fields.appVersion,
    deployment: bugDeployment,
    buildSha: bugBuildSha,
    ...browserDetails(),
    viewportBucket,
  };
  const body = new FormData();
  body.append("report", JSON.stringify(report));
  if (screenshot) body.append("screenshot", screenshot.blob, screenshot.name);

  const configuredEndpoint = import.meta.env.VITE_STUDY_ENDPOINT?.trim();
  const base = (configuredEndpoint || (location.hostname === "alansynn.com" ? DEFAULT_STUDY_ENDPOINT : "")).replace(/\/+$/, "");
  const draft = () => ({ issueUrl: bugReportDraftUrl(fields), pending: false, draft: true });
  if (!base) return draft();
  const response = await fetch(`${base}/bug`, { method: "POST", body }).catch(() => undefined);
  if (!response?.ok) return draft();

  const result = await response.json().catch(() => ({})) as { issueUrl?: unknown; pending?: unknown };
  if (typeof result.issueUrl === "string" && /^https?:\/\//.test(result.issueUrl)) {
    return { issueUrl: result.issueUrl, pending: false, draft: false };
  }
  if (response.status === 202 || result.pending === true) {
    return { issueUrl: "", pending: true, draft: false };
  }
  return draft();
};

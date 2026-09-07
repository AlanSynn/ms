/** Public wire contract only. Credentials and GitHub policy stay in the Worker. */
export const FEEDBACK_MAX_MESSAGE_LENGTH = 2_000;
export const FEEDBACK_MAX_IMAGE_BYTES = 1_500_000;
export const FEEDBACK_MAX_IMAGE_DIMENSION = 1_600;
export const FEEDBACK_MAX_IMAGE_PIXELS = 2_000_000;
export const FEEDBACK_MAX_REQUEST_BYTES = 2_020_000;

export type FeedbackCategory = 'problem' | 'idea';
export interface FeedbackContext {
  version: string;
  stage: string;
  viewport: { width: number; height: number };
}
export interface FeedbackScreenshot { mime: 'image/png'; base64: string }
export interface FeedbackPayload {
  submissionId: string;
  category: FeedbackCategory;
  message: string;
  context: FeedbackContext;
  screenshot?: FeedbackScreenshot;
}
export type FeedbackRequest =
  | (FeedbackPayload & { action: 'submit'; receipt?: string })
  | { action: 'status'; submissionId: string; payloadDigest: string; receipt?: string };

export interface FeedbackIssue { number: number; url: string }
export type FeedbackResponse =
  | { status: 'sent'; issue: FeedbackIssue; screenshot: 'included' | 'none' }
  | {
    status: 'rejected' | 'unknown';
    code: string;
    message: string;
    receipt?: string;
    retryAfter?: number;
  };

export function feedbackImageBytes(screenshot: FeedbackScreenshot): Uint8Array {
  return Uint8Array.from(atob(screenshot.base64), character => character.charCodeAt(0));
}

export async function feedbackSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

/** Shared canonical digest lets a lost response be checked without sending image bytes again. */
export async function feedbackPayloadDigest(payload: FeedbackPayload): Promise<string> {
  const imageHash = payload.screenshot
    ? await feedbackSha256(feedbackImageBytes(payload.screenshot))
    : null;
  const canonical = JSON.stringify({
    submissionId: payload.submissionId,
    category: payload.category,
    message: payload.message.trim().replace(/\r\n?/g, '\n'),
    context: {
      version: payload.context.version,
      stage: payload.context.stage,
      viewport: { width: payload.context.viewport.width, height: payload.context.viewport.height },
    },
    screenshot: imageHash ? { mime: 'image/png', sha256: imageHash } : null,
  });
  return feedbackSha256(new TextEncoder().encode(canonical));
}

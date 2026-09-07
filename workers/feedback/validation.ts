import {
  FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_MESSAGE_LENGTH, FEEDBACK_MAX_REQUEST_BYTES,
  feedbackImageBytes, type FeedbackRequest,
} from '../../shared/feedbackProtocol';
import { validateScreenshotPng } from './png';

export class FeedbackInputError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); }
}

function check(condition: unknown, message = 'Check your message and try again.'): asserts condition {
  if (!condition) throw new FeedbackInputError('invalid_input', message);
}

function object(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).every(key => allowed.includes(key)));
}

export const isSubmissionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export async function readFeedbackRequest(request: Request): Promise<FeedbackRequest> {
  check(request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json');
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > FEEDBACK_MAX_REQUEST_BYTES)) {
    throw new FeedbackInputError('too_large', 'Remove the screenshot and try again.', 413);
  }
  check(request.body);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > FEEDBACK_MAX_REQUEST_BYTES) throw new FeedbackInputError('too_large', 'Remove the screenshot and try again.', 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FeedbackInputError('invalid_input', 'Check your message and try again.'); }
  object(value, ['action', 'submissionId', 'category', 'message', 'context', 'screenshot', 'receipt', 'payloadDigest']);
  check(isSubmissionId(value.submissionId));
  check(value.receipt === undefined || typeof value.receipt === 'string' && value.receipt.length <= 2_048);
  if (value.action === 'status') {
    object(value, ['action', 'submissionId', 'payloadDigest', 'receipt']);
    check(isDigest(value.payloadDigest));
    return value as unknown as FeedbackRequest;
  }
  object(value, ['action', 'submissionId', 'category', 'message', 'context', 'screenshot', 'receipt']);
  check(value.action === 'submit' && (value.category === 'problem' || value.category === 'idea'));
  check(typeof value.message === 'string');
  value.message = value.message.trim().replace(/\r\n?/g, '\n');
  check((value.message as string).length > 0 && (value.message as string).length <= FEEDBACK_MAX_MESSAGE_LENGTH, 'Write a message of 2,000 characters or fewer.');
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.message as string));
  object(value.context, ['version', 'stage', 'viewport']);
  check(typeof value.context.version === 'string' && value.context.version.length <= 64
    && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]{1,40})?$/.test(value.context.version));
  check(typeof value.context.stage === 'string' && ['project', 'character', 'path', 'foundry', 'design', 'blueprint', 'assembly', 'options'].includes(value.context.stage));
  object(value.context.viewport, ['width', 'height']);
  for (const dimension of ['width', 'height']) {
    const number = value.context.viewport[dimension];
    check(typeof number === 'number' && Number.isInteger(number) && number > 0 && number <= 16_384);
  }
  if (value.screenshot !== undefined) {
    object(value.screenshot, ['mime', 'base64']);
    check(value.screenshot.mime === 'image/png' && typeof value.screenshot.base64 === 'string', 'Use a fresh app screenshot.');
    const encoded = value.screenshot.base64 as string;
    if (encoded.length > Math.ceil(FEEDBACK_MAX_IMAGE_BYTES / 3) * 4) throw new FeedbackInputError('too_large', 'Remove the screenshot and try again.', 413);
    check(encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Use a fresh app screenshot.');
    try { await validateScreenshotPng(feedbackImageBytes({ mime: 'image/png', base64: encoded })); }
    catch { throw new FeedbackInputError('invalid_image', 'Remove the screenshot or capture it again.'); }
  }
  return value as unknown as FeedbackRequest;
}

import {
  feedbackImageBytes, feedbackPayloadDigest, type FeedbackRequest, type FeedbackResponse,
} from '../../shared/feedbackProtocol';
import {
  createGithubIssue, findDeliveredIssue, formatFeedbackIssue, GitHubFailure, githubPostingLogin,
  uploadGithubScreenshot, type GitHubFetch,
} from './github';
import {
  createUploadReceipt, FEEDBACK_REPOSITORY_ID, signValue, submissionMarker, verifyUploadReceipt,
} from './receipts';
import { FeedbackInputError, readFeedbackRequest } from './validation';

export interface FeedbackEnv {
  GITHUB_FEEDBACK_TOKEN: string;
  FEEDBACK_RECEIPT_SECRET: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_REPOSITORY_ID: string;
  ALLOWED_ORIGINS: string;
  NETWORK_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  REPORT_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

function configured(env: FeedbackEnv): boolean {
  return env.GITHUB_OWNER === 'AlanSynn' && env.GITHUB_REPO === 'ms'
    && env.GITHUB_REPOSITORY_ID === FEEDBACK_REPOSITORY_ID
    && typeof env.GITHUB_FEEDBACK_TOKEN === 'string' && /^(?:gho_|ghp_|github_pat_)\S+$/.test(env.GITHUB_FEEDBACK_TOKEN)
    && typeof env.FEEDBACK_RECEIPT_SECRET === 'string' && env.FEEDBACK_RECEIPT_SECRET.length >= 32
    && typeof env.NETWORK_RATE_LIMITER?.limit === 'function' && typeof env.REPORT_RATE_LIMITER?.limit === 'function';
}

function reply(body: FeedbackResponse, status: number, origin?: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if ('retryAfter' in body && body.retryAfter) headers['Retry-After'] = String(body.retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

type FeedbackFailure = Exclude<FeedbackResponse, { status: 'sent' }>;

function failure(code: string, message: string, retryAfter?: number): FeedbackFailure {
  return { status: 'rejected', code, message, ...(retryAfter ? { retryAfter } : {}) };
}

function upstreamFailure(error: unknown, phase: 'check' | 'upload' | 'create'): FeedbackFailure {
  if (error instanceof GitHubFailure) {
    if (error.retryAfter || error.status === 429) return failure('rate_limited', 'Wait a minute, then try again.', error.retryAfter || 60);
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      return failure('relay_credentials', 'Feedback is unavailable. Keep your draft and try later.');
    }
  }
  return phase === 'upload'
    ? failure('attachment_failed', 'Screenshot upload failed. Keep your draft and try again.')
    : phase === 'create'
    ? failure('issue_rejected', 'Report was not accepted. Keep your draft and try again.')
    : failure('check_failed', 'Could not check delivery. Keep your draft and try again.');
}

async function deliver(
  input: FeedbackRequest, env: FeedbackEnv, fetcher: GitHubFetch, now: number,
): Promise<{ body: FeedbackResponse; httpStatus: number }> {
  const digest = input.action === 'status' ? input.payloadDigest : await feedbackPayloadDigest(input);
  let uploadReceipt: Awaited<ReturnType<typeof verifyUploadReceipt>> | undefined;
  if (input.receipt && input.action === 'submit') {
    try { uploadReceipt = await verifyUploadReceipt(env.FEEDBACK_RECEIPT_SECRET, input.receipt, input.submissionId, digest, now); }
    catch {
      return { body: { status: 'unknown', code: 'invalid_receipt', message: 'The retry receipt expired. Keep this draft and check its status.' }, httpStatus: 400 };
    }
  }
  let postingLogin: string;
  try {
    postingLogin = await githubPostingLogin(fetcher, env.GITHUB_FEEDBACK_TOKEN);
    const existing = await findDeliveredIssue(fetcher, env.GITHUB_FEEDBACK_TOKEN, postingLogin, {
      secret: env.FEEDBACK_RECEIPT_SECRET, submissionId: input.submissionId, digest,
      ...(input.action === 'submit' ? { screenshot: Boolean(input.screenshot) } : {}),
    });
    if (existing) return { body: { status: 'sent', ...existing }, httpStatus: 200 };
  } catch (error) {
    const response = upstreamFailure(error, 'check');
    if (input.action === 'status' || uploadReceipt?.phase === 'unknown') {
      return { body: { ...response, status: 'unknown' }, httpStatus: 503 };
    }
    return { body: response, httpStatus: 503 };
  }
  if (input.action === 'status' || uploadReceipt?.phase === 'unknown') {
    return {
      body: { status: 'unknown', code: 'delivery_unknown', message: 'Delivery is still unconfirmed. Keep this draft and check again.' },
      httpStatus: 200,
    };
  }
  if (uploadReceipt && Boolean(uploadReceipt.attachment) !== Boolean(input.screenshot)) {
    return { body: failure('invalid_receipt', 'This retry does not match the saved screenshot.'), httpStatus: 400 };
  }
  let attachment = uploadReceipt?.attachment ?? null;
  if (input.screenshot && !attachment) {
    try { attachment = await uploadGithubScreenshot(fetcher, env.GITHUB_FEEDBACK_TOKEN, feedbackImageBytes(input.screenshot), input.submissionId); }
    catch (error) { return { body: upstreamFailure(error, 'upload'), httpStatus: 502 }; }
  }
  const marker = await submissionMarker(env.FEEDBACK_RECEIPT_SECRET, input.submissionId, digest, attachment);
  const issue = formatFeedbackIssue(input, marker, attachment);
  try {
    const receipt = await createGithubIssue(fetcher, env.GITHUB_FEEDBACK_TOKEN, issue, postingLogin);
    return { body: { status: 'sent', issue: receipt, screenshot: attachment ? 'included' : 'none' }, httpStatus: 201 };
  } catch (error) {
    // A definitive 4xx rejection permits a student-initiated retry. Transport,
    // redirect, 5xx, and malformed success responses may conceal a created issue.
    const definitive = error instanceof GitHubFailure && [400, 401, 403, 404, 410, 413, 415, 422, 429].includes(error.status);
    const receipt = await createUploadReceipt(env.FEEDBACK_RECEIPT_SECRET, input.submissionId, digest, attachment,
      definitive ? 'uploaded' : 'unknown', now);
    return definitive ? {
      body: { ...upstreamFailure(error, 'create'), receipt }, httpStatus: 502,
    } : {
      body: { status: 'unknown', code: 'delivery_unknown', message: 'Delivery is unconfirmed. Keep this draft and check its status.', receipt },
      httpStatus: 502,
    };
  }
}

/** One stateless request boundary; fetch and time are explicit for deterministic tests. */
export async function handleFeedback(
  request: Request, env: FeedbackEnv, fetcher: GitHubFetch = fetch, now = Date.now(),
): Promise<Response> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const url = new URL(request.url);
  if (url.pathname !== '/feedback' || url.search) return reply(failure('not_found', 'Not found.'), 404);
  if (!origin || origin === 'null' || !allowed.includes(origin)) return reply(failure('origin_denied', 'Open feedback in MotionSmith.'), 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin',
    } });
  }
  if (request.method !== 'POST') return reply(failure('method_denied', 'Not available.'), 405, origin);
  if (!configured(env)) return reply(failure('not_configured', 'Feedback is unavailable. Keep your draft and try later.'), 503, origin);
  let deliveryStarted = false;
  try {
    // This ephemeral rate key is not an identity, stored fingerprint, or log field.
    const network = request.headers.get('CF-Connecting-IP') || 'local-development';
    const networkKey = await signValue(env.FEEDBACK_RECEIPT_SECRET, `rate:${Math.floor(now / 86_400_000)}:${network}`);
    if (!(await env.NETWORK_RATE_LIMITER.limit({ key: networkKey })).success) {
      return reply(failure('rate_limited', 'Wait a minute, then try again.', 60), 429, origin);
    }
    const input = await readFeedbackRequest(request);
    if (!(await env.REPORT_RATE_LIMITER.limit({ key: input.submissionId })).success) {
      return reply(failure('rate_limited', 'Wait a minute, then try again.', 60), 429, origin);
    }
    deliveryStarted = true;
    const result = await deliver(input, env, fetcher, now);
    return reply(result.body, result.httpStatus, origin);
  } catch (error) {
    if (error instanceof FeedbackInputError) return reply(failure(error.code, error.message), error.httpStatus, origin);
    if (deliveryStarted) return reply({ status: 'unknown', code: 'delivery_unknown', message: 'Delivery is unconfirmed. Keep this draft and check its status.' }, 503, origin);
    return reply(failure('unavailable', 'Feedback is unavailable. Keep your draft and try later.'), 503, origin);
  }
}

export default { fetch: (request: Request, env: FeedbackEnv) => handleFeedback(request, env) };

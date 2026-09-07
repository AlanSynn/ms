import type { FeedbackIssue, FeedbackPayload } from '../../shared/feedbackProtocol';
import { FEEDBACK_REPOSITORY, FEEDBACK_REPOSITORY_ID, isNativeAttachmentUrl, submissionMarker } from './receipts';

export type GitHubFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class GitHubFailure extends Error {
  constructor(public status: number, public retryAfter?: number) { super('GitHub request failed'); }
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'MotionSmith-Feedback',
  };
}

function retryDelay(response: Response): number | undefined {
  const retry = response.headers.get('Retry-After');
  if (retry && /^\d+$/.test(retry)) return Math.min(86_400, Number(retry));
  if (response.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = response.headers.get('X-RateLimit-Reset');
    if (reset && /^\d+$/.test(reset) && Number(reset) > 0) {
      return Math.min(86_400, Math.max(1, Math.ceil(Number(reset) - Date.now() / 1_000)));
    }
    return 60;
  }
  return response.status === 429 ? 60 : undefined;
}

async function request(fetcher: GitHubFetch, token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    // workerd does not implement redirect: 'error'. Manual mode never forwards
    // the credential, and rejecting 3xx below keeps the same no-redirect policy.
    response = await fetcher(url, { ...init, redirect: 'manual', headers: { ...headers(token), ...init.headers } });
  } catch { throw new GitHubFailure(0); }
  if (response.status >= 300 && response.status < 400) throw new GitHubFailure(response.status);
  return response;
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new GitHubFailure(0); }
}

export async function githubPostingLogin(fetcher: GitHubFetch, token: string): Promise<string> {
  const response = await request(fetcher, token, 'https://api.github.com/user');
  if (response.status !== 200) throw new GitHubFailure(response.status, retryDelay(response));
  const data = await json(response) as { login?: unknown };
  if (typeof data?.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(data.login)) throw new GitHubFailure(0);
  return data.login;
}

export async function uploadGithubScreenshot(fetcher: GitHubFetch, token: string, bytes: Uint8Array, submissionId: string): Promise<string> {
  const url = new URL('https://uploads.github.com/user-attachments/assets');
  url.searchParams.set('name', `motionsmith-${submissionId}.png`);
  url.searchParams.set('content_type', 'image/png');
  url.searchParams.set('repository_id', FEEDBACK_REPOSITORY_ID);
  const response = await request(fetcher, token, url.href, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new GitHubFailure(response.status, retryDelay(response));
  const data = await json(response) as { url?: unknown };
  if (!isNativeAttachmentUrl(data?.url)) throw new GitHubFailure(0);
  return data.url;
}

function issueReference(data: unknown): FeedbackIssue | null {
  if (!data || typeof data !== 'object') return null;
  const issue = data as { number?: unknown; html_url?: unknown; pull_request?: unknown };
  if (issue.pull_request !== undefined || typeof issue.number !== 'number' || !Number.isSafeInteger(issue.number) || issue.number <= 0) return null;
  const url = `https://github.com/${FEEDBACK_REPOSITORY}/issues/${issue.number}`;
  return issue.html_url === url ? { number: issue.number, url } : null;
}

export interface FeedbackLookup { secret: string; submissionId: string; digest: string; screenshot?: boolean }

/** Absence is never used as proof that a previous creation failed. */
export async function findDeliveredIssue(
  fetcher: GitHubFetch, token: string, postingLogin: string, expected: FeedbackLookup,
): Promise<{ issue: FeedbackIssue; screenshot: 'included' | 'none' } | null> {
  for (let page = 1; page <= 3; page++) {
    const response = await request(fetcher, token,
      `https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
    if (response.status !== 200) throw new GitHubFailure(response.status, retryDelay(response));
    const data = await json(response);
    if (!Array.isArray(data)) throw new GitHubFailure(0);
    for (const item of data) {
      const issue = issueReference(item);
      if (!issue || item.user?.login !== postingLogin || typeof item.body !== 'string') continue;
      const boundary = item.body.lastIndexOf('\n\n');
      const marker = item.body.slice(boundary + 2);
      if (!marker.startsWith(`<!-- motionsmith-feedback:${expected.submissionId}:${expected.digest}:`)) continue;
      const beforeMarker = item.body.slice(0, boundary);
      const image = /\n\n!\[Screenshot\]\(([^\s)]+)\)$/.exec(beforeMarker);
      if (image && !isNativeAttachmentUrl(image[1])) continue;
      if (expected.screenshot !== undefined && Boolean(image) !== expected.screenshot) continue;
      const verified = await submissionMarker(expected.secret, expected.submissionId, expected.digest, image?.[1] ?? null);
      if (marker === verified) return { issue, screenshot: image ? 'included' : 'none' };
    }
    if (data.length < 100) break;
  }
  return null;
}

export function formatFeedbackIssue(payload: FeedbackPayload, marker: string, attachment: string | null): { title: string; body: string } {
  const category = payload.category === 'problem' ? 'Problem' : 'Idea';
  const titleText = payload.message.replace(/@/g, '＠').replace(/\s+/g, ' ').trim().slice(0, 90);
  // An outer fence longer than every student-authored fence keeps text inert.
  const longestFence = Math.max(2, ...Array.from(payload.message.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longestFence + 1);
  const { version, stage, viewport } = payload.context;
  const context = `MotionSmith ${version} · ${stage} · ${viewport.width} × ${viewport.height}`;
  const body = `${category}\n\n${fence}text\n${payload.message}\n${fence}\n\n${context}`
    + (attachment ? `\n\n![Screenshot](${attachment})` : '') + `\n\n${marker}`;
  return { title: `[MotionSmith ${category.toLowerCase()}] ${titleText}`, body };
}

export async function createGithubIssue(
  fetcher: GitHubFetch, token: string, issue: { title: string; body: string }, postingLogin: string,
): Promise<FeedbackIssue> {
  const response = await request(fetcher, token, `https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(issue),
  });
  if (response.status !== 201) throw new GitHubFailure(response.status, retryDelay(response));
  const data = await json(response) as { body?: unknown; user?: { login?: unknown } };
  const receipt = issueReference(data);
  if (!receipt || data.body !== issue.body || data.user?.login !== postingLogin) throw new GitHubFailure(0);
  return receipt;
}

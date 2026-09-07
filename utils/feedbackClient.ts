import type { FeedbackRequest, FeedbackResponse } from '../shared/feedbackProtocol';

export const feedbackEndpointIsValid = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || local) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/feedback';
  } catch { return false; }
};

export const validFeedbackResponse = (value: unknown): value is FeedbackResponse => {
  if (!value || typeof value !== 'object') return false;
  const reply = value as FeedbackResponse;
  if (reply.status === 'sent') {
    return Number.isSafeInteger(reply.issue?.number) && reply.issue.number > 0
      && reply.issue.url === `https://github.com/AlanSynn/ms/issues/${reply.issue.number}`
      && ['included', 'none'].includes(reply.screenshot);
  }
  return ['rejected', 'unknown'].includes(reply.status)
    && typeof reply.code === 'string' && typeof reply.message === 'string'
    && reply.message.length <= 300
    && (reply.receipt === undefined || typeof reply.receipt === 'string');
};

/** Only an explicit Send or Check status action calls this function. */
export const postFeedback = async (
  endpoint: string,
  request: FeedbackRequest,
  send: typeof fetch = fetch,
): Promise<FeedbackResponse> => {
  if (!feedbackEndpointIsValid(endpoint)) return {
    status: 'rejected', code: 'not_configured', message: 'Sending is not set up yet. Your draft stays here.',
  };
  try {
    const response = await send(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(45_000),
    });
    const reply: unknown = await response.json();
    if (validFeedbackResponse(reply) && (reply.status !== 'sent' || response.ok)) return reply;
  } catch { /* A lost receipt cannot prove that GitHub did not create the issue. */ }
  return { status: 'unknown', code: 'connection_lost', message: 'Delivery unconfirmed. Check status when connected.' };
};

export const screenshotBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};

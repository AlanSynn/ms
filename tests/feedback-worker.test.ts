import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_REQUEST_BYTES, feedbackPayloadDigest,
  type FeedbackPayload, type FeedbackRequest, type FeedbackResponse,
} from '../shared/feedbackProtocol';
import worker, { handleFeedback, type FeedbackEnv } from '../workers/feedback';
import { formatFeedbackIssue, GitHubFailure, uploadGithubScreenshot, type GitHubFetch } from '../workers/feedback/github';
import { validateScreenshotPng } from '../workers/feedback/png';
import { createUploadReceipt, isNativeAttachmentUrl, submissionMarker, verifyUploadReceipt } from '../workers/feedback/receipts';

const now = Date.UTC(2026, 8, 7);
const id = '531928d9-9f85-4b92-8e63-54d9b88c0125';
const attachment = 'https://github.com/user-attachments/assets/11111111-2222-4333-8444-555555555555';
const origin = 'https://alansynn.com';
const encoder = new TextEncoder();

function crc(bytes: Uint8Array): number {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let index = 0; index < 8; index++) result = result & 1 ? 0xedb88320 ^ result >>> 1 : result >>> 1;
  }
  return (result ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Uint8Array): Buffer {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); result.write(type, 4); result.set(bytes, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(width = 12, height = 8, raw?: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = raw ?? Buffer.alloc((width * 4 + 1) * height, 120);
  if (!raw) for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())]);
}
const image = png();
const payload: FeedbackPayload = {
  submissionId: id, category: 'problem', message: 'The arm stops here.',
  context: { version: '0.0.14', stage: 'path', viewport: { width: 1366, height: 768 } },
  screenshot: { mime: 'image/png', base64: image.toString('base64') },
};
const textPayload = (): FeedbackPayload => { const value = structuredClone(payload); delete value.screenshot; return value; };
const env = (): FeedbackEnv => ({
  GITHUB_FEEDBACK_TOKEN: 'gho_unit_test_not_a_real_credential', FEEDBACK_RECEIPT_SECRET: 'unit-test-signing-key-with-at-least-thirty-two-characters',
  GITHUB_OWNER: 'AlanSynn', GITHUB_REPO: 'ms', GITHUB_REPOSITORY_ID: '1283287676', ALLOWED_ORIGINS: origin,
  NETWORK_RATE_LIMITER: { limit: async () => ({ success: true }) }, REPORT_RATE_LIMITER: { limit: async () => ({ success: true }) },
});
const request = (value: unknown, extra: Record<string, string> = {}) => new Request('https://relay.example/feedback', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(value),
});
const submit = (value = payload, receipt?: string): FeedbackRequest => ({ action: 'submit', ...value, ...(receipt ? { receipt } : {}) });
const result = async (response: Response): Promise<FeedbackResponse> => response.json();

function github() {
  const state = {
    uploads: 0, creates: 0, calls: [] as { url: string; init?: RequestInit }[], issues: [] as any[],
    uploadStatus: 201, createStatus: 201, identityStatus: 200, listStatus: 200,
    loseCreationResponse: false, malformedCreation: false, uploadUrl: attachment, retryAfter: '',
  };
  const fetcher: GitHubFetch = async (input, init) => {
    const url = String(input); state.calls.push({ url, init });
    assert.equal(init?.redirect, 'manual', 'workerd requires manual redirect mode; redirects must never be followed');
    assert.equal(new Headers(init?.headers).get('Authorization'), env().GITHUB_FEEDBACK_TOKEN.replace(/^/, 'token '));
    const headers = state.retryAfter ? { 'Retry-After': state.retryAfter } : undefined;
    if (url === 'https://api.github.com/user') return Response.json({ login: 'relay-owner' }, { status: state.identityStatus, headers });
    if (url.startsWith('https://uploads.github.com/user-attachments/assets?')) {
      state.uploads++;
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/octet-stream');
      assert.equal(new Headers(init?.headers).get('Accept'), 'application/vnd.github+json');
      assert.deepEqual(Buffer.from(init?.body as Uint8Array), image);
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('repository_id'), '1283287676');
      assert.equal(parsed.searchParams.get('name'), `motionsmith-${id}.png`);
      assert.equal(parsed.searchParams.get('content_type'), 'image/png');
      return Response.json({ url: state.uploadUrl }, { status: state.uploadStatus, headers });
    }
    assert.ok(url.startsWith('https://api.github.com/repos/AlanSynn/ms/issues'));
    if (init?.method !== 'POST') return Response.json(state.issues, { status: state.listStatus, headers });
    state.creates++;
    const posted = JSON.parse(String(init.body));
    if (state.createStatus !== 201) return Response.json({ message: 'Synthetic rejection' }, { status: state.createStatus, headers });
    const issue = { ...posted, number: 81, html_url: 'https://github.com/AlanSynn/ms/issues/81', user: { login: 'relay-owner' } };
    state.issues.push(issue);
    if (state.loseCreationResponse) throw new Error('Connection lost after creation');
    return Response.json(state.malformedCreation ? { accepted: true } : issue, { status: 201 });
  };
  return { state, fetcher };
}

let checks = 0;
async function check(name: string, test: () => Promise<void> | void) {
  await test(); checks++; console.log(`✓ feedback: ${name}`);
}

await check('native raw upload followed by confirmed fixed-repository issue creation', async () => {
  const upstream = github();
  const response = await handleFeedback(request(submit()), env(), upstream.fetcher, now);
  assert.equal(response.status, 201); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await result(response), { status: 'sent', issue: { number: 81, url: 'https://github.com/AlanSynn/ms/issues/81' }, screenshot: 'included' });
  assert.equal(upstream.state.uploads, 1); assert.equal(upstream.state.creates, 1);
  assert.ok(upstream.state.issues[0].body.includes(`![Screenshot](${attachment})`));
  assert.ok(upstream.state.issues[0].body.includes('0.0.14 · path · 1366 × 768'));
  assert.equal(upstream.state.calls.some(call => call.url.includes('issues/attachments')), false);
});
await check('text-only idea contains no image bytes or image request', async () => {
  const upstream = github(); const value = { ...textPayload(), category: 'idea' as const };
  const response = await result(await handleFeedback(request(submit(value)), env(), upstream.fetcher, now));
  assert.equal(response.status, 'sent'); assert.equal(upstream.state.uploads, 0);
  assert.match(upstream.state.issues[0].title, /^\[MotionSmith idea\]/);
  assert.ok(!upstream.state.issues[0].body.includes('![Screenshot]'));
});
await check('plain text prevents fences, Markdown images, HTML and title mentions escaping', () => {
  const message = '@everyone\n```\n![x](https://evil.example/pixel)\n<img src="https://evil.example">\n````';
  const formatted = formatFeedbackIssue({ ...textPayload(), message }, 'marker', null);
  assert.ok(formatted.title.includes('＠everyone')); assert.ok(!formatted.title.includes('@everyone'));
  assert.ok(formatted.body.includes(`\n\n\`\`\`\`\`text\n${message}\n\`\`\`\`\`\n\nMotionSmith`));
});
await check('public digest normalizes message but binds authoring context and exact image', async () => {
  assert.equal(await feedbackPayloadDigest(payload), await feedbackPayloadDigest({ ...payload, message: '  The arm stops here.\r\n  '.trim() }));
  assert.notEqual(await feedbackPayloadDigest(payload), await feedbackPayloadDigest(textPayload()));
  assert.notEqual(await feedbackPayloadDigest(payload), await feedbackPayloadDigest({ ...payload, category: 'idea' }));
});
await check('PNG validation checks CRC, actual decompression, scanline length, filters, dimensions and trailing data', async () => {
  await validateScreenshotPng(image);
  const badCrc = Buffer.from(image); badCrc[40] ^= 1;
  for (const invalid of [badCrc, png(1601, 1), png(1500, 1400), png(1, 1, new Uint8Array([0])),
    png(1, 1, new Uint8Array([5, 0, 0, 0, 0])), png(1, 1, new Uint8Array(100_000)),
    Buffer.concat([image, encoder.encode('<script>')]), image.subarray(0, 40)]) {
    await assert.rejects(validateScreenshotPng(invalid));
  }
});
await check('invalid messages, categories, routing fields, image types and encodings reach no upstream', async () => {
  for (const change of [
    { message: '' }, { message: 'x'.repeat(2001) }, { category: 'urgent' }, { repository: 'someone/else' },
    { submissionId: 'untrusted-id' }, { attachmentUrl: attachment }, { context: { ...payload.context, identity: 'student' } },
    { context: { ...payload.context, version: `${'1'.repeat(65)}.0.0` } },
    { screenshot: { mime: 'image/svg+xml', base64: btoa('<svg/>') } }, { screenshot: { mime: 'image/png', base64: 'not base64!' } },
  ]) {
    const upstream = github(); const response = await handleFeedback(request({ ...submit(), ...change }), env(), upstream.fetcher, now);
    assert.equal(response.status, 400); assert.equal(upstream.state.calls.length, 0);
  }
});
await check('encoded image and streamed request limits are enforced before GitHub', async () => {
  const upstream = github();
  const value = { ...submit(), screenshot: { mime: 'image/png', base64: Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES + 1).toString('base64') } };
  assert.equal((await handleFeedback(request(value), env(), upstream.fetcher, now)).status, 413);
  const large = new Request('https://relay.example/feedback', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(FEEDBACK_MAX_REQUEST_BYTES + 1) });
  assert.equal((await handleFeedback(large, env(), upstream.fetcher, now)).status, 413);
  assert.equal(upstream.state.calls.length, 0);
});
await check('CORS, paths and methods cannot expose a generic GitHub proxy', async () => {
  const upstream = github();
  for (const untrusted of ['https://alansynn.com.evil.example', 'null', 'http://localhost:5173', '']) {
    assert.equal((await handleFeedback(request(submit(), { Origin: untrusted }), env(), upstream.fetcher, now)).status, 403);
  }
  for (const path of ['/feedback/81', '/attachments/image.png', '/issues/81', '/receipt']) {
    assert.equal((await handleFeedback(new Request(`https://relay.example${path}`, { headers: { Origin: origin } }), env(), upstream.fetcher, now)).status, 404);
  }
  assert.equal((await handleFeedback(new Request('https://relay.example/feedback', { method: 'DELETE', headers: { Origin: origin } }), env(), upstream.fetcher, now)).status, 405);
  const options = await worker.fetch(new Request('https://relay.example/feedback', { method: 'OPTIONS', headers: { Origin: origin } }), env());
  assert.equal(options.status, 204); assert.equal(options.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  assert.equal(upstream.state.calls.length, 0);
});
await check('missing/unsupported credentials and wrong configured repository fail closed', async () => {
  for (const changed of [{ GITHUB_FEEDBACK_TOKEN: '' }, { GITHUB_FEEDBACK_TOKEN: 'ghs_app_installation' },
    { FEEDBACK_RECEIPT_SECRET: '' }, { GITHUB_REPO: 'other' }, { GITHUB_REPOSITORY_ID: '1' }]) {
    const upstream = github();
    assert.equal((await handleFeedback(request(submit()), { ...env(), ...changed }, upstream.fetcher, now)).status, 503);
    assert.equal(upstream.state.calls.length, 0);
  }
});
await check('rate limits fail closed, use ephemeral network keys and preserve retry timing', async () => {
  const upstream = github(); const networkKeys: string[] = []; const reportKeys: string[] = [];
  const settings = env();
  settings.NETWORK_RATE_LIMITER.limit = async ({ key }) => { networkKeys.push(key); return { success: true }; };
  settings.REPORT_RATE_LIMITER.limit = async ({ key }) => { reportKeys.push(key); return { success: false }; };
  const response = await handleFeedback(request(submit(), { 'CF-Connecting-IP': '192.0.2.42' }), settings, upstream.fetcher, now);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
  assert.deepEqual(reportKeys, [id]); assert.ok(!networkKeys[0].includes('192.0.2.42')); assert.equal(upstream.state.calls.length, 0);
});
await check('native URL allowlist rejects external hosts, queries, credentials, paths and redirects', async () => {
  for (const invalid of ['http://github.com/user-attachments/assets/a', 'https://evil.example/a', `${attachment}?token=x`,
    `${attachment}#x`, 'https://user:pass@github.com/user-attachments/assets/a', 'https://github.com/user-attachments/assets/a/b',
    'https://github.com/user-attachments/assets/%2e%2e', 'https://github.com.evil.example/user-attachments/assets/a']) assert.equal(isNativeAttachmentUrl(invalid), false);
  await assert.rejects(uploadGithubScreenshot(async () => new Response(null, { status: 307, headers: { Location: 'https://evil.example' } }), env().GITHUB_FEEDBACK_TOKEN, image, id));
});
await check('all credentialed redirects are rejected without a second request, even on a GitHub host', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ['https://evil.example/collect', 'https://api.github.com/repos/other/repo/issues', 'https://uploads.github.com/other']) {
      const requests: string[] = [];
      await assert.rejects(uploadGithubScreenshot(async (input, init) => {
        requests.push(String(input));
        assert.equal(init?.redirect, 'manual');
        assert.equal(new Headers(init?.headers).get('Authorization'), `token ${env().GITHUB_FEEDBACK_TOKEN}`);
        return new Response(null, { status, headers: { Location: location } });
      }, env().GITHUB_FEEDBACK_TOKEN, image, id), error => error instanceof GitHubFailure && error.status === status);
      assert.equal(requests.length, 1);
      assert.ok(requests[0].startsWith('https://uploads.github.com/user-attachments/assets?'));
      assert.ok(!requests[0].includes(env().GITHUB_FEEDBACK_TOKEN));
    }
  }
});
await check('failed/malformed uploads never create a text-only issue', async () => {
  for (const status of [401, 404, 422, 429, 500]) {
    const upstream = github(); upstream.state.uploadStatus = status;
    const response = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
    assert.equal(response.status, 'rejected'); assert.equal(upstream.state.creates, 0);
  }
  const upstream = github(); upstream.state.uploadUrl = 'https://external.example/image';
  assert.equal((await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now))).status, 'rejected');
  assert.equal(upstream.state.creates, 0);
});
await check('definitive issue rejection returns a bound receipt and retry reuses the uploaded image after restart', async () => {
  const upstream = github(); upstream.state.createStatus = 422;
  const first = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
  assert.equal(first.status, 'rejected'); assert.ok('receipt' in first && first.receipt);
  upstream.state.createStatus = 201;
  const second = await result(await handleFeedback(request(submit(payload, first.receipt)), env(), upstream.fetcher, now + 1));
  assert.equal(second.status, 'sent'); assert.equal(upstream.state.uploads, 1); assert.equal(upstream.state.creates, 2);
});
await check('tampered, expired, mismatched and removed-image receipts cannot cause another upload or issue', async () => {
  const digest = await feedbackPayloadDigest(payload);
  const receipt = await createUploadReceipt(env().FEEDBACK_RECEIPT_SECRET, id, digest, attachment, 'uploaded', now);
  await verifyUploadReceipt(env().FEEDBACK_RECEIPT_SECRET, receipt, id, digest, now - 500);
  await assert.rejects(verifyUploadReceipt(env().FEEDBACK_RECEIPT_SECRET, receipt, id, digest, now + 86_400_001));
  for (const attempted of [submit(payload, `${receipt}x`), submit({ ...payload, message: 'changed' }, receipt), submit(textPayload(), receipt)]) {
    const upstream = github(); const response = await result(await handleFeedback(request(attempted), env(), upstream.fetcher, now));
    assert.equal(response.status, 'unknown'); assert.equal(upstream.state.calls.length, 0);
  }
});
await check('connection loss after creation is unknown, then explicit status positively reconciles without image bytes', async () => {
  const upstream = github(); upstream.state.loseCreationResponse = true;
  const first = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
  assert.equal(first.status, 'unknown');
  const status: FeedbackRequest = { action: 'status', submissionId: id, payloadDigest: await feedbackPayloadDigest(payload) };
  const recovered = await result(await handleFeedback(request(status), env(), upstream.fetcher, now + 1));
  assert.equal(recovered.status, 'sent'); assert.equal(upstream.state.creates, 1); assert.equal(upstream.state.uploads, 1);
});
await check('absent or incomplete matches remain unknown; unknown receipts can only check status', async () => {
  const upstream = github(); upstream.state.createStatus = 503;
  const first = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
  assert.equal(first.status, 'unknown'); assert.ok('receipt' in first && first.receipt);
  upstream.state.createStatus = 201;
  assert.equal((await result(await handleFeedback(request(submit(payload, first.receipt)), env(), upstream.fetcher, now + 1))).status, 'unknown');
  assert.equal(upstream.state.creates, 1);
  const digest = await feedbackPayloadDigest(payload); const marker = await submissionMarker(env().FEEDBACK_RECEIPT_SECRET, id, digest, attachment);
  upstream.state.issues = [{ number: 81, html_url: 'https://github.com/AlanSynn/ms/issues/81', user: { login: 'relay-owner' }, body: `Missing image\n\n${marker}` }];
  const status: FeedbackRequest = { action: 'status', submissionId: id, payloadDigest: digest };
  assert.equal((await result(await handleFeedback(request(status), env(), upstream.fetcher, now))).status, 'unknown');
  upstream.state.issues[0].body = `Image\n\n![Screenshot](${attachment})\n\n${marker}`;
  upstream.state.issues[0].user.login = 'someone-else';
  assert.equal((await result(await handleFeedback(request(status), env(), upstream.fetcher, now))).status, 'unknown');
  upstream.state.issues[0].user.login = 'relay-owner';
  upstream.state.issues[0].body = `Image\n\n![Screenshot](${attachment}-changed)\n\n${marker}`;
  assert.equal((await result(await handleFeedback(request(status), env(), upstream.fetcher, now))).status, 'unknown', 'the exact uploaded URL is signed');
});
await check('positive repeated submission returns existing issue instead of creating another', async () => {
  const upstream = github();
  await handleFeedback(request(submit()), env(), upstream.fetcher, now);
  assert.equal((await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now + 1))).status, 'sent');
  assert.equal(upstream.state.creates, 1); assert.equal(upstream.state.uploads, 1);
});
await check('malformed success and generic accepted responses never claim Sent', async () => {
  const upstream = github(); upstream.state.malformedCreation = true;
  assert.equal((await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now))).status, 'unknown');
  const accepted = github(); accepted.state.createStatus = 202;
  assert.equal((await result(await handleFeedback(request(submit()), env(), accepted.fetcher, now))).status, 'unknown');
  for (const status of [301, 302, 303, 307, 308]) {
    const redirected = github(); redirected.state.createStatus = status;
    const response = await result(await handleFeedback(request(submit()), env(), redirected.fetcher, now));
    assert.equal(response.status, 'unknown');
    assert.ok('receipt' in response && response.receipt);
    const retry = await result(await handleFeedback(request(submit(payload, response.receipt)), env(), redirected.fetcher, now));
    assert.equal(retry.status, 'unknown'); assert.equal(redirected.state.creates, 1);
  }
});
await check('upstream credentials and rate rejection stay visible without exposing response contents', async () => {
  const upstream = github(); upstream.state.identityStatus = 401;
  const response = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
  assert.equal(response.status, 'rejected'); assert.ok('code' in response && response.code === 'relay_credentials');
  upstream.state.identityStatus = 429; upstream.state.retryAfter = '123';
  const limited = await result(await handleFeedback(request(submit()), env(), upstream.fetcher, now));
  assert.ok('retryAfter' in limited && limited.retryAfter === 123);
  assert.ok(!JSON.stringify(limited).includes(env().GITHUB_FEEDBACK_TOKEN));
  await assert.rejects(uploadGithubScreenshot(async () => new Response('{}', {
    status: 403, headers: { 'X-RateLimit-Remaining': '0' },
  }), env().GITHUB_FEEDBACK_TOKEN, image, id), error => error instanceof GitHubFailure && error.retryAfter === 60);
});
await check('one shared network permits thirty independent classroom submissions', async () => {
  const upstream = github(); const settings = env(); let networkCalls = 0;
  const networkKeys = new Set<string>(); const reportCalls = new Map<string, number>();
  settings.NETWORK_RATE_LIMITER.limit = async ({ key }) => {
    networkKeys.add(key); return { success: ++networkCalls <= 120 };
  };
  settings.REPORT_RATE_LIMITER.limit = async ({ key }) => {
    const count = (reportCalls.get(key) || 0) + 1; reportCalls.set(key, count); return { success: count <= 6 };
  };
  for (let student = 1; student <= 30; student++) {
    const value = { ...textPayload(), submissionId: `${id.slice(0, -12)}${String(student).padStart(12, '0')}` };
    const response = await result(await handleFeedback(request(submit(value), { 'CF-Connecting-IP': '192.0.2.42' }), settings, upstream.fetcher, now));
    assert.equal(response.status, 'sent');
  }
  assert.equal(networkKeys.size, 1); assert.equal(reportCalls.size, 30); assert.equal(upstream.state.creates, 30);
});
await check('upstream exception contents and secrets reach neither response nor logs', async () => {
  const log = console.log; const warn = console.warn; const error = console.error;
  const calls: unknown[] = [];
  console.log = console.warn = console.error = (...values) => { calls.push(values); };
  let response: FeedbackResponse;
  try {
    response = await result(await handleFeedback(request(submit()), env(), async () => {
      throw new Error(`${env().GITHUB_FEEDBACK_TOKEN}: ${payload.message}`);
    }, now));
  } finally { console.log = log; console.warn = warn; console.error = error; }
  assert.deepEqual(calls, []);
  assert.ok(!JSON.stringify(response!).includes(env().GITHUB_FEEDBACK_TOKEN));
  assert.ok(!JSON.stringify(response!).includes(payload.message));
});
await check('upload success with missing or unreadable URL fails without an issue', async () => {
  for (const body of ['{}', '{broken json']) {
    await assert.rejects(uploadGithubScreenshot(async () => new Response(body, { status: 201 }), env().GITHUB_FEEDBACK_TOKEN, image, id));
  }
});
await check('status recovers after a receipt expires without permitting a new creation', async () => {
  const upstream = github(); await handleFeedback(request(submit()), env(), upstream.fetcher, now);
  const digest = await feedbackPayloadDigest(payload);
  const expired = await createUploadReceipt(env().FEEDBACK_RECEIPT_SECRET, id, digest, attachment, 'unknown', now);
  const status: FeedbackRequest = { action: 'status', submissionId: id, payloadDigest: digest, receipt: expired };
  assert.equal((await result(await handleFeedback(request(status), env(), upstream.fetcher, now + 86_400_001))).status, 'sent');
  assert.equal(upstream.state.creates, 1);
});
await check('concurrent initial requests demonstrate the documented stateless duplicate limitation', async () => {
  const upstream = github(); let lists = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const racing: GitHubFetch = async (input, init) => {
    if (String(input).includes('/issues?')) {
      lists++; if (lists === 2) release(); await barrier;
      return Response.json([]);
    }
    return upstream.fetcher(input, init);
  };
  const responses = await Promise.all([
    handleFeedback(request(submit(textPayload())), env(), racing, now),
    handleFeedback(request(submit(textPayload())), env(), racing, now),
  ]);
  assert.deepEqual(await Promise.all(responses.map(async response => (await result(response)).status)), ['sent', 'sent']);
  assert.equal(upstream.state.creates, 2, 'there is no claimed cross-request transaction or global lock');
});

console.log(`Feedback Worker: ${checks} checks passed.`);

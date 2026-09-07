import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReleaseReadState, RELEASE_READ_KEY } from '../utils/releaseReadState';
import { RELEASE_NOTES, releaseImageUrl, releaseNoteForVersion } from '../utils/releaseNotes';
import { feedbackEndpointIsValid, postFeedback, screenshotBase64, validFeedbackResponse } from '../utils/feedbackClient';
import { feedbackPayloadDigest, type FeedbackPayload } from '../shared/feedbackProtocol';
import { APP_COMMANDS } from '../utils/appCommands';
import { createAppCommandHandlers } from '../utils/appCommandHandlers';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
const local = memoryStorage();
let state = createReleaseReadState(() => local, () => memoryStorage());
assert.equal(state.read().has('release-a'), false);
state.markViewed('release-a');
assert.equal(state.read().has('release-a'), true);
state = createReleaseReadState(() => local, () => memoryStorage());
assert.equal(state.read().has('release-a'), true, 'new browser session uses persistent IDs');
state.markViewed('release-b');
assert.deepEqual([...state.read()], ['release-a', 'release-b'], 'older build entries remain read');
assert.equal(state.read().has('release-c'), false, 'new entry remains discoverable');
const anotherTab = createReleaseReadState(() => local, () => memoryStorage());
anotherTab.markViewed('release-c');
assert(state.read().has('release-c'), 'tab resync merges fresh persistent IDs');
state.merge(JSON.stringify(['concurrent-tab-entry']));
assert(createReleaseReadState(() => local, () => memoryStorage()).read().has('concurrent-tab-entry'));
for (let index = 0; index < 205; index++) state.markViewed(`archive-${index}`);
assert(createReleaseReadState(() => local, () => memoryStorage()).read().has('release-a'), 'older notes are never evicted');
const fallback = memoryStorage();
const denied = () => { throw new Error('Storage denied'); };
const deniedState = createReleaseReadState(denied, () => fallback);
deniedState.markViewed('session-only');
assert(createReleaseReadState(denied, () => fallback).read().has('session-only'));
const memoryOnly = createReleaseReadState(denied, denied);
memoryOnly.markViewed('memory-only');
assert(memoryOnly.read().has('memory-only'));
local.setItem(RELEASE_READ_KEY, 'corrupt');
assert.doesNotThrow(() => state.read());
state.markViewed('repaired');
assert(Array.isArray(JSON.parse(local.getItem(RELEASE_READ_KEY)!)));
assert.equal(releaseNoteForVersion('not-shipped'), undefined);
assert.equal(RELEASE_NOTES.length, new Set(RELEASE_NOTES.map(entry => entry.id)).size);
for (const entry of RELEASE_NOTES) assert(entry.highlights.length > 0 && entry.highlights.length <= 3);
assert.equal(releaseImageUrl('release-notes/image.png', '/ms/'), '/ms/release-notes/image.png');
assert.equal(releaseImageUrl('release-notes/image.png', './'), './release-notes/image.png');

assert(feedbackEndpointIsValid('https://feedback.example/feedback'));
assert(feedbackEndpointIsValid('http://127.0.0.1:8789/feedback'));
for (const endpoint of ['', 'https://token@feedback.example/feedback', 'https://feedback.example/feedback?token=x',
  'http://elsewhere.example/feedback', 'https://feedback.example/issues/7', 'javascript:alert(1)']) {
  assert.equal(feedbackEndpointIsValid(endpoint), false, endpoint);
}
const payload: FeedbackPayload = {
  submissionId: 'bd6cdb16-f88b-4e92-849f-a51841614cdb', category: 'problem', message: 'The hand stopped.',
  context: { version: '0.0.14', stage: 'path', viewport: { width: 1366, height: 768 } },
};
const digest = await feedbackPayloadDigest(payload);
assert.equal(digest, await feedbackPayloadDigest({ ...payload, message: '  The hand stopped.\r\n'.trim() }));
assert.notEqual(digest, await feedbackPayloadDigest({ ...payload, message: 'Different report' }));
assert.notEqual(digest, await feedbackPayloadDigest({ ...payload, category: 'idea' }));
assert.equal(await screenshotBase64(new Blob([new Uint8Array([1, 2, 3])])), 'AQID');
const receipt = { status: 'sent', issue: { number: 7, url: 'https://github.com/AlanSynn/ms/issues/7' }, screenshot: 'none' };
assert(validFeedbackResponse(receipt));
assert.equal(validFeedbackResponse({ ...receipt, issue: { number: 7, url: 'https://github.com/other/repo/issues/7' } }), false);
assert.equal(validFeedbackResponse({ status: 'accepted' }), false);
let calls = 0;
const request = { ...payload, action: 'submit' as const };
const result = await postFeedback('https://feedback.example/feedback', request, async (url, init) => {
  calls++;
  assert.equal(url, 'https://feedback.example/feedback');
  assert.equal(init?.credentials, 'omit');
  assert.equal(init?.redirect, 'error');
  assert.equal(init?.referrerPolicy, 'no-referrer');
  const wire = JSON.parse(init!.body as string);
  assert.deepEqual(wire, request);
  assert.equal('screenshot' in wire, false, 'text-only report has no removed image bytes');
  assert.equal('project' in wire, false);
  return new Response(JSON.stringify(receipt), { status: 201 });
});
assert.equal(result.status, 'sent');
assert.equal(calls, 1);
assert.equal((await postFeedback('', request, () => { throw new Error('must not fetch'); })).status, 'rejected');
assert.equal((await postFeedback('https://feedback.example/feedback', request, async () => { throw new TypeError('offline'); })).status, 'unknown');
assert.equal((await postFeedback('https://feedback.example/feedback', request, async () => new Response('{', { status: 502 }))).status, 'unknown');
assert.equal((await postFeedback('https://feedback.example/feedback', request, async () => new Response(JSON.stringify(receipt), { status: 500 }))).status, 'unknown');
const statusWire = { action: 'status' as const, submissionId: payload.submissionId, payloadDigest: digest };
await postFeedback('https://feedback.example/feedback', statusWire, async (_url, init) => {
  assert.deepEqual(JSON.parse(init!.body as string), statusWire, 'status check never resends content or image bytes');
  return new Response(JSON.stringify({ status: 'unknown', code: 'not_found', message: 'Check again later.' }));
});

// App command wiring must reach the support surfaces through the existing registry.
const invoked: string[] = [];
const handlers = createAppCommandHandlers({
  newProject() {}, openProject() {}, recoverAutosave() {}, saveProject() {}, saveProjectAs() {}, exportProjectCopy() {},
  resetLesson() {}, undoProject() {}, redoProject() {}, zoomCanvas() {}, fitCanvas() {}, saveWorkspaceLayout() {},
  restoreWorkspaceLayout() {}, resetWorkspaceLayout() {}, goStage() {}, openShortcuts() {}, openAbout() {},
  openFindFeature: () => invoked.push('search'), openFeedback: () => invoked.push('feedback'), openWhatsNew: () => invoked.push('notes'),
});
for (const id of ['help.findFeature', 'help.feedback', 'help.whatsNew'] as const) {
  assert(APP_COMMANDS.some(command => command.id === id)); handlers[id]();
}
assert.deepEqual(invoked, ['search', 'feedback', 'notes']);
const hook = readFileSync('hooks/useFeedbackDraft.ts', 'utf8');
assert(hook.indexOf('busy.current = true; // Locks') < hook.indexOf('await screenshotBase64'), 'send lock precedes asynchronous work');
assert(hook.includes("phase: 'unknown'"));
for (const path of ['utils/projectSerialization.ts', 'types.ts']) {
  assert(!/releaseNotes\.viewed|FeedbackDraft|payloadDigest|FEEDBACK_RECEIPT_SECRET/.test(readFileSync(path, 'utf8')),
    'support state stays out of the project aggregate and serialization');
}
console.log('Student support preference, wire, boundary, and command contracts passed.');

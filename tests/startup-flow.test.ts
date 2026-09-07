import assert from 'node:assert/strict';
import { afterStartupAnnouncement, GETTING_STARTED_SESSION_KEY, initialStartupStep } from '../utils/startupFlow';
import { createReleaseReadState, RELEASE_READ_KEY } from '../utils/releaseReadState';

const data = new Map<string, string>();
const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
const preferences = createReleaseReadState(() => storage, () => undefined);
for (const hidden of [false, true]) {
  storage.setItem(GETTING_STARTED_SESSION_KEY, String(hidden));
  assert.equal(initialStartupStep(true, hidden), 'announcement');
  assert.equal(afterStartupAnnouncement(hidden), hidden ? 'editor' : 'entry');
  assert.equal(initialStartupStep(false, hidden), hidden ? 'editor' : 'entry');
  preferences.markViewed('stable-update');
  assert.equal(storage.getItem(GETTING_STARTED_SESSION_KEY), String(hidden), 'acknowledging an update cannot change entry suppression');
}
assert.notEqual(GETTING_STARTED_SESSION_KEY, RELEASE_READ_KEY);
assert(createReleaseReadState(() => storage, () => undefined).read().has('stable-update'));
assert.equal(initialStartupStep(false, false), 'entry', 'new session entry preference is independent of persistent acknowledgement');
console.log('Startup transition and preference isolation contracts passed.');

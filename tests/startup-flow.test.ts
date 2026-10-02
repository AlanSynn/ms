import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const startupHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = startupHtml.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const icons = [...head.matchAll(/<link\b[^>]*>/g)].filter(([tag]) => /\brel=["']icon["']/.test(tag));
assert.equal(icons.length, 1, 'startup HTML declares the MotionSmith browser icon');
const iconAttributes = Object.fromEntries([...icons[0][0].matchAll(/([\w-]+)=["']([^"']*)["']/g)]
  .map(([, name, value]) => [name, value]));
assert.equal(iconAttributes.href, 'src-tauri/icons/icon.png', 'favicon reuses the existing logo through Vite asset rewriting for web and Tauri bases');
assert.equal(iconAttributes.type, 'image/png');
assert.equal(iconAttributes.sizes, '256x256');
const icon = readFileSync(new URL(`../${iconAttributes.href}`, import.meta.url));
assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'favicon source is a genuine PNG');
assert.equal(icon.readUInt32BE(16), 256, 'declared favicon width agrees with the retained asset');
assert.equal(icon.readUInt32BE(20), 256, 'declared favicon height agrees with the retained asset');
console.log('Startup transition and preference isolation contracts passed.');

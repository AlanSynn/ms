import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { SITE, assertSiteEnvironment, cloudflareApi, inspectSite, readToken, requireFreeSite } from './cloudflare-site-account.mjs';

const FEEDBACK = Object.freeze({ name: 'motionsmith-feedback', tag: 'c903d9cb5177481497df4ce905299d28',
  origin: 'https://motionsmith.org', classroom: 'https://alansynn.com',
  endpoint: 'https://motionsmith-feedback.alansynn.workers.dev/feedback' });

const comparableSettings = settings => ({ ...settings,
  bindings: settings.bindings.filter(binding => binding.name !== 'ALLOWED_ORIGINS')
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  annotations: Object.fromEntries(Object.entries(settings.annotations ?? {})
    .filter(([name]) => name !== 'workers/triggered_by')),
});

const deployedVersion = async (api, base) => {
  const [versions, deployments] = await Promise.all([
    api(`${base}/versions?page=1&per_page=1`), api(`${base}/deployments?page=1&per_page=1`),
  ]);
  const id = versions.items?.[0]?.id;
  const deployment = deployments.deployments?.[0];
  if (!id || !deployment?.id || deployment.versions?.length !== 1
    || deployment.versions[0].percentage !== 100 || deployment.versions[0].version_id !== id) {
    throw new Error('Feedback latest version must be the sole fully deployed version; inspect before changing settings.');
  }
  const version = await api(`${base}/versions/${id}`);
  const etag = version.resources?.script?.etag;
  if (version.id !== id || typeof etag !== 'string' || !etag) throw new Error('Feedback script fingerprint is unavailable.');
  return { id, deploymentId: deployment.id, etag };
};

// Patch metadata only. All other bindings, including unreadable secrets, are
// inherited from the reviewed deployed version rather than rewritten locally.
export const appendFeedbackOrigin = async api => {
  const base = `accounts/${SITE.account}/workers/scripts/${FEEDBACK.name}`;
  const path = `${base}/settings`;
  const before = await api(path);
  if (!Array.isArray(before.bindings) || before.bindings.some(binding => typeof binding.name !== 'string')
    || new Set(before.bindings.map(binding => binding.name)).size !== before.bindings.length) {
    throw new Error('Feedback binding inventory is missing or ambiguous.');
  }
  const allowed = before.bindings.find(binding => binding.name === 'ALLOWED_ORIGINS');
  if (allowed?.type !== 'plain_text' || typeof allowed.text !== 'string') throw new Error('Expected an existing plain-text feedback origin allowlist.');
  const origins = allowed.text.split(',').map(origin => origin.trim()).filter(Boolean);
  if (!origins.includes(FEEDBACK.classroom) || origins.includes('*')) throw new Error('Inspect the existing feedback origin allowlist before changing it.');
  if (origins.includes(FEEDBACK.origin)) return { changed: false, preservedBindings: before.bindings.length - 1 };
  const reviewed = await deployedVersion(api, base);
  const text = `${allowed.text},${FEEDBACK.origin}`;
  const settings = { bindings: before.bindings.map(binding => binding.name === allowed.name
    ? { name: allowed.name, type: 'plain_text', text } : { name: binding.name, type: 'inherit', version_id: reviewed.id }),
  annotations: comparableSettings(before).annotations };
  const form = new FormData();
  form.set('settings', JSON.stringify(settings));
  const [current, currentSettings] = await Promise.all([deployedVersion(api, base), api(path)]);
  if (!isDeepStrictEqual(reviewed, current) || !isDeepStrictEqual(before, currentSettings)) {
    throw new Error('Feedback changed during preflight; inspect before retrying.');
  }
  await api(path, 'PATCH', form);
  const [after, deployed] = await Promise.all([api(path), deployedVersion(api, base)]);
  if (after.bindings?.find(binding => binding.name === allowed.name)?.text !== text
    || !isDeepStrictEqual(comparableSettings(after), comparableSettings(before))
    || deployed.etag !== reviewed.etag) {
    // Never render full settings or binding values in an assertion error.
    throw new Error('Feedback origin, preserved settings or script fingerprint differs; inspect before continuing.');
  }
  return { changed: true, preservedBindings: before.bindings.length - 1, versionId: deployed.id };
};

if (import.meta.main) {
  assertSiteEnvironment();
  const api = cloudflareApi(readToken());
  const state = await inspectSite(api);
  requireFreeSite(state);
  if (state.scripts.find(script => script.id === FEEDBACK.name)?.tag !== FEEDBACK.tag) {
    throw new Error('The existing feedback relay identity differs; do not overwrite it.');
  }
  const result = await appendFeedbackOrigin(api);
  for (const [origin, status] of [[FEEDBACK.classroom, 204], [FEEDBACK.origin, 204],
    ['https://motionsmith.org.attacker.invalid', 403]]) {
    const response = await fetch(FEEDBACK.endpoint, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(response.status, status, 'Feedback CORS status differs.');
    if (status === 204) assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  console.log(JSON.stringify({ worker: FEEDBACK.name, addedOrigin: FEEDBACK.origin, ...result,
    note: 'Settings patch only; no Worker source upload or issue submission.' }, null, 2));
}

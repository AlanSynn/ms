import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE, assertSiteEnvironment, assertStaticSiteConfig, cloudflareApi, inspectSite, readToken, requireFreeSite, selectBuildToken } from '../scripts/cloudflare-site-account.mjs';
import { contextHelpFor } from '../utils/contextHelp';
import { appendFeedbackOrigin } from '../scripts/cloudflare-feedback-origin.mjs';

const config = JSON.parse(readFileSync(SITE.config, 'utf8'));
assert.doesNotThrow(() => assertStaticSiteConfig(config));
for (const key of ['main', 'routes', 'kv_namespaces', 'r2_buckets', 'd1_databases',
  'durable_objects', 'queues', 'ai', 'services', 'workflows', 'containers']) {
  assert.throws(() => assertStaticSiteConfig({ ...config, [key]: [] }), /non-static/, `reject ${key} before local or native deployment`);
}
assert.throws(() => assertStaticSiteConfig({ ...config, account_id: 'other' }), /Unexpected Cloudflare target/);
assert.throws(() => assertStaticSiteConfig({ ...config, name: 'motionsmith-feedback' }), /Unexpected Cloudflare target/);
assert.throws(() => assertStaticSiteConfig({ ...config, assets: { ...config.assets, directory: '../..' } }), /non-static/);
assert.throws(() => assertStaticSiteConfig({ ...config, assets: { ...config.assets, not_found_handling: 'single-page-application' } }), /non-static/);
assert.throws(() => assertStaticSiteConfig({ ...config, preview_urls: true }), /non-static/);
assert.equal(config.name, 'motionsmith-site');
assert.equal(config.account_id, SITE.account);
assert.equal(config.assets.directory, '../../dist');
assert.equal(config.assets.not_found_handling, 'none', 'missing assets must remain 404s');
assert.equal(config.assets.run_worker_first, false);
assert.equal(config.main, undefined, 'static hosting has no execution script');
for (const binding of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'durable_objects', 'queues', 'ai']) {
  assert.equal(config[binding], undefined, `no ${binding} backend`);
}
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
assert.match(workflow, /tags:\s*\n\s*- "v\*\.\*\.\*"/);
assert.match(workflow, /VITE_BASE_PATH: \/ms\//);
assert.doesNotMatch(workflow, /cloudflare|wrangler|branches:/i);
const build = readFileSync('scripts/build-cloudflare-site.mjs', 'utf8');
assert.match(build, /assertStaticSiteConfig\(JSON\.parse/, 'native build checks the same dedicated static target');
assert.match(build, /VITE_BASE_PATH: '\/'/);
assert.match(build, /'install', '--frozen-lockfile'/);
assert.match(build, /'run', 'build'/, 'reuse validated TypeScript/exclusion/Vite build');
assert.match(build, /VITE_FEEDBACK_ENDPOINT: publicBuild\.VITE_FEEDBACK_ENDPOINT\.value/, 'local and native builds use the same public endpoint without .env');
assert.match(build, /process\.versions\.bun !== bunVersion/, 'exact repository Bun pin');
assert.match(build, /\['--no-env-file', \.\.\.args\]/, 'build subprocesses do not load the local setup token');
for (const key of ['CF_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'MS_CLOUDFLARE_TOKEN_FILE']) {
  assert.ok(build.includes(`'${key}'`), `strip ${key} from frontend build environment`);
}
assert.equal(readToken({ CF_TOKEN: 'synthetic-local-token' }), 'synthetic-local-token');
assert.equal(readToken({ CLOUDFLARE_API_TOKEN: 'synthetic-standard-token', CF_TOKEN: 'synthetic-alias' }), 'synthetic-standard-token');
const gitBuild = JSON.parse(readFileSync('deploy/cloudflare/builds.json', 'utf8'));
assert.deepEqual(gitBuild.branch_includes, ['main']);
assert.deepEqual(gitBuild.branch_excludes, []);
assert.equal(gitBuild.environment_variables.BUN_VERSION.value, '1.3.14');
assert.equal(gitBuild.environment_variables.SKIP_DEPENDENCY_INSTALL.value, '1');
assert.equal(gitBuild.environment_variables.VITE_BASE_PATH.value, '/');
assert.equal(gitBuild.build_command, 'bun --no-env-file scripts/build-cloudflare-site.mjs');
assert.match(gitBuild.deploy_command, /--config deploy\/cloudflare\/wrangler\.jsonc/);
assert.doesNotMatch(gitBuild.build_command, /playwright|test:browser/, 'automatic builds stay within free quotas');
assert.doesNotMatch(`${gitBuild.build_command} ${gitBuild.deploy_command}`, /scripts\/cloudflare-site\.mjs|CF_TOKEN|\.env/, 'native deploy does not use local setup authentication');
assert.ok(Object.keys(gitBuild.environment_variables).every(key => !/TOKEN|SECRET|KEY/.test(key)), 'only public build variables');
assert.equal(contextHelpFor('project.moveBetweenSites').body,
  'Autosave is separate for each site. To move your work, save a project file from the original site and open it on the other site.');

const free = { errors: [], subscriptions: [], limits: {
  has_reached_build_minutes_limit: false, build_minutes_refresh_on: '2026-11-01T00:00:00Z',
} };
assert.doesNotThrow(() => requireFreeSite(free));
assert.doesNotThrow(() => assertSiteEnvironment({ CLOUDFLARE_ACCOUNT_ID: SITE.account }));
assert.throws(() => assertSiteEnvironment({ CLOUDFLARE_ACCOUNT_ID: 'different' }), /Unexpected selected/);
assert.throws(() => assertSiteEnvironment({ WRANGLER_CI_OVERRIDE_NAME: 'motionsmith-feedback' }), /name override/);
assert.throws(() => requireFreeSite({ ...free, errors: ['Billing Read denied'] }), /blocked/);
assert.throws(() => requireFreeSite({ ...free, limits: {} }), /billing is unproven/);
assert.throws(() => requireFreeSite({ ...free, limits: { ...free.limits, has_reached_build_minutes_limit: true } }), /quota exhausted/);
assert.throws(() => requireFreeSite({ ...free, subscriptions: [{
  state: 'Paid', price: 5, rate_plan: { id: 'workers_standard', public_name: 'Workers Paid' },
}] }), /paid Workers/);
assert.throws(() => requireFreeSite({ ...free, subscriptions: [{
  state: 'Trial', price: 0, rate_plan: { id: 'workers_free', public_name: 'Workers Free trial' },
}] }), /trial or promotional/);
// Unrelated subscriptions must never be downgraded to make the site free.
assert.doesNotThrow(() => requireFreeSite({ ...free, subscriptions: [{
  state: 'Paid', price: 20, rate_plan: { id: 'pro', public_name: 'Pro Website' },
}] }));
const fixtureApi = (overrides: Record<string, any> = {}) => async (path: string) => {
  if (path === `accounts/${SITE.account}`) return { id: overrides.account ?? SITE.account };
  if (path === `zones/${SITE.zone}`) return { id: SITE.zone, name: overrides.hostname ?? SITE.hostname,
    account: { id: SITE.account }, status: 'active' };
  if (path.endsWith('/limits')) return free.limits;
  return [];
};
assert.equal((await inspectSite(fixtureApi())).errors.length, 0);
await assert.rejects(() => inspectSite(fixtureApi({ account: 'other' })), /Unexpected Cloudflare account/);
await assert.rejects(() => inspectSite(fixtureApi({ hostname: 'alansynn.com' })), /Expected active motionsmith.org/);
const denied = await inspectSite(async () => { throw new Error('Denied'); });
assert.equal(denied.errors.length, 8);
assert.throws(() => requireFreeSite(denied), /blocked/);
const originalFetch = globalThis.fetch;
try {
  const pages: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const path = String(input); pages.push(path);
    const page = new URL(path).searchParams.get('page') === '2' ? 2 : 1;
    return Response.json({ success: true, result: [{ id: `apex-${page}`, type: page === 2 ? 'A' : 'TXT' }],
      result_info: { page, total_pages: 2 } });
  }) as typeof fetch;
  const records = await cloudflareApi('synthetic-test-token')(`zones/${SITE.zone}/dns_records?name=${SITE.hostname}&per_page=100`);
  assert.deepEqual(records.map((record: { type: string }) => record.type), ['TXT', 'A'], 'later-page address records prevent accidental DNS replacement');
  assert.equal(pages.length, 2);
  globalThis.fetch = (async () => Response.json({ success: false,
    errors: [{ code: 12006, message: 'Invalid token' }] }, { status: 401 })) as typeof fetch;
  await assert.rejects(() => cloudflareApi('synthetic-account-token')(`accounts/${SITE.account}/builds/account/limits`), /user-scoped token/);
  const form = new FormData(); form.set('settings', '{}');
  globalThis.fetch = (async (_input: any, init: any) => {
    assert.equal(init.method, 'PATCH');
    assert.equal(init.body, form);
    assert.equal(init.headers['Content-Type'], undefined, 'fetch must choose the multipart boundary');
    return Response.json({ success: true, result: {} });
  }) as typeof fetch;
  await cloudflareApi('synthetic-token')(`accounts/${SITE.account}/workers/scripts/motionsmith-feedback/settings`, 'PATCH', form);
} finally { globalThis.fetch = originalFetch; }
const registered: any[] = [];
let registrations = 0;
const tokenApi = async (path: string, method = 'GET', body?: any) => {
  if (path.endsWith('tokens?per_page=200')) return registered;
  if (path === 'user/tokens/verify') return { id: 'a'.repeat(32), status: 'active' };
  assert.equal(path, `accounts/${SITE.account}/builds/tokens`);
  assert.equal(method, 'POST');
  assert.equal(body.build_token_secret, 'synthetic-provided-secret');
  assert.equal(body.cloudflare_token_id, 'a'.repeat(32));
  registrations++;
  const entry = { build_token_uuid: 'synthetic-build-uuid', owner_type: 'user',
    cloudflare_token_id: body.cloudflare_token_id, build_token_name: body.build_token_name };
  registered.push(entry);
  return entry;
};
assert.equal(await selectBuildToken(tokenApi, 'synthetic-provided-secret'), 'synthetic-build-uuid');
assert.equal(await selectBuildToken(tokenApi, 'synthetic-provided-secret'), 'synthetic-build-uuid');
assert.equal(registrations, 1, 'rerunning registers no duplicate and creates no API permission policy');
assert.equal(await selectBuildToken(tokenApi, 'different-management-secret', 'synthetic-build-uuid'), 'synthetic-build-uuid');
await assert.rejects(() => selectBuildToken(tokenApi, 'synthetic-provided-secret', 'wrong-account-uuid'), /expected account/);
await assert.rejects(() => selectBuildToken(async (path: string) => path.includes('tokens?') ? [] : { status: 'expired' }, 'expired'), /active restricted user/);
await assert.rejects(() => selectBuildToken(async (path: string) => path.includes('tokens?')
  ? [{ build_token_name: 'motionsmith-site deployment', cloudflare_token_id: 'other', owner_type: 'user' }]
  : { id: 'a'.repeat(32), status: 'active' }, 'synthetic'), /do not create duplicates/);

let feedbackSettings: any = { compatibility_date: '2026-07-21', usage_model: 'standard',
  annotations: { 'workers/message': 'Retain this message', 'workers/triggered_by': 'upload' }, bindings: [
    { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: 'https://alansynn.com,https://existing.example' },
    { name: 'GITHUB_FEEDBACK_TOKEN', type: 'secret_text' },
    { name: 'FEEDBACK_RECEIPT_SECRET', type: 'secret_text' },
    { name: 'GITHUB_REPO', type: 'plain_text', text: 'ms' },
    { name: 'REPORT_RATE_LIMITER', type: 'ratelimit', namespace_id: 'existing', simple: { limit: 6, period: 60 } },
  ] };
let feedbackPatches = 0;
const feedbackBase = `accounts/${SITE.account}/workers/scripts/motionsmith-feedback`;
const feedbackApi = async (path: string, method = 'GET', body?: FormData) => {
  const id = feedbackPatches ? 'updated-version' : 'reviewed-version';
  if (path === `${feedbackBase}/versions?page=1&per_page=1`) return { items: [{ id }] };
  if (path === `${feedbackBase}/deployments?page=1&per_page=1`) return { deployments: [
    { id: `${id}-deployment`, versions: [{ version_id: id, percentage: 100 }] },
  ] };
  if (path === `${feedbackBase}/versions/${id}`) return { id, resources: { script: { etag: 'same-script-content' } } };
  assert.equal(path, `${feedbackBase}/settings`);
  if (method === 'GET') return structuredClone(feedbackSettings);
  assert.equal(method, 'PATCH'); assert.ok(body instanceof FormData);
  const settings = JSON.parse(String(body.get('settings')));
  assert.deepEqual(settings.bindings.filter((binding: any) => binding.name !== 'ALLOWED_ORIGINS'),
    feedbackSettings.bindings.filter((binding: any) => binding.name !== 'ALLOWED_ORIGINS')
      .map((binding: any) => ({ name: binding.name, type: 'inherit', version_id: 'reviewed-version' })),
    'retain secrets, variables and limiters from the reviewed deployed version without sending their values');
  assert.equal(settings.annotations['workers/message'], 'Retain this message');
  assert.equal(settings.annotations['workers/triggered_by'], undefined);
  assert.deepEqual(Object.keys(settings).sort(), ['annotations', 'bindings'], 'no source, usage or other settings updates');
  feedbackPatches++;
  feedbackSettings.bindings[0] = settings.bindings.find((binding: any) => binding.name === 'ALLOWED_ORIGINS');
  feedbackSettings.annotations['workers/triggered_by'] = 'settings';
  return structuredClone(feedbackSettings);
};
assert.equal((await appendFeedbackOrigin(feedbackApi)).changed, true);
assert.equal(feedbackSettings.bindings[0].text, 'https://alansynn.com,https://existing.example,https://motionsmith.org');
assert.equal((await appendFeedbackOrigin(feedbackApi)).changed, false);
assert.equal(feedbackPatches, 1, 'repeat setup makes no extra relay mutation');
await assert.rejects(() => appendFeedbackOrigin(async () => ({ bindings: [] })), /existing plain-text/);
await assert.rejects(() => appendFeedbackOrigin(async () => ({ bindings: [
  { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: '*' },
] })), /Inspect the existing/);

const reviewApi = (options: { split?: boolean; inactive?: boolean; race?: boolean; codeChange?: boolean; bindingChange?: boolean }) => {
  let reads = 0; let patched = false;
  const original = { bindings: [
    { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: 'https://alansynn.com' },
    { name: 'PRIVATE_SETTING', type: 'plain_text', text: 'synthetic-value-never-rendered' },
  ] };
  return async (path: string, method = 'GET', body?: FormData) => {
    const id = patched ? 'new' : 'old';
    if (path.endsWith('/versions?page=1&per_page=1')) return { items: [{ id: options.inactive ? 'inactive' : id }] };
    if (path.endsWith('/deployments?page=1&per_page=1')) return { deployments: [{ id: `${id}-deployment`, versions:
      options.split ? [{ version_id: id, percentage: 90 }, { version_id: 'other', percentage: 10 }]
        : [{ version_id: id, percentage: 100 }] }] };
    if (path.includes('/versions/')) return { id, resources: { script: { etag: patched && options.codeChange ? 'changed' : 'unchanged' } } };
    assert.ok(path.endsWith('/settings'));
    if (method === 'PATCH') {
      patched = true;
      original.bindings[0] = JSON.parse(String(body?.get('settings'))).bindings[0];
      if (options.bindingChange) original.bindings[1].text = 'another-private-value';
      return original;
    }
    reads++;
    if (reads === 2 && options.race) return { ...structuredClone(original), compatibility_date: '2026-07-22' };
    return structuredClone(original);
  };
};
await assert.rejects(() => appendFeedbackOrigin(reviewApi({ split: true })), /sole fully deployed/);
await assert.rejects(() => appendFeedbackOrigin(reviewApi({ inactive: true })), /sole fully deployed/);
await assert.rejects(() => appendFeedbackOrigin(reviewApi({ race: true })), /changed during preflight/);
for (const options of [{ codeChange: true }, { bindingChange: true }]) {
  await assert.rejects(() => appendFeedbackOrigin(reviewApi(options)), (error: Error) => {
    assert.match(error.message, /preserved settings or script fingerprint differs/);
    assert.doesNotMatch(String(error), /synthetic-value|another-private/);
    assert.equal((error as any).actual, undefined, 'failed preservation checks do not render binding values');
    return true;
  });
}
console.log('Independent static site target, free-plan gates and preserved Pages contracts passed.');

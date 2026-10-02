import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SITE = Object.freeze({
  account: '5af02c4a8b7da8e437893615cdb42b87',
  zone: '5237dc6855080ab390b6fb016941371c',
  hostname: 'motionsmith.org',
  name: 'motionsmith-site',
  config: 'deploy/cloudflare/wrangler.jsonc',
});

export const readToken = (env = process.env) => {
  if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN;
  // Optional local setup alias; native Git deployments use Cloudflare's stored
  // build token and never read this helper or a local .env file.
  if (env.CF_TOKEN) return env.CF_TOKEN;
  if (env.MS_CLOUDFLARE_TOKEN_FILE) return readFileSync(env.MS_CLOUDFLARE_TOKEN_FILE, 'utf8').trim();
  const directory = process.platform === 'darwin'
    ? join(homedir(), 'Library/Preferences/.wrangler') : join(homedir(), '.config/.wrangler');
  const config = readFileSync(join(directory, 'config/default.toml'), 'utf8');
  const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('No Cloudflare credential. Run wrangler whoami or supply a restricted user API token locally.');
  return token;
};

export const assertSiteEnvironment = (env = process.env) => {
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== SITE.account) throw new Error('Unexpected selected Cloudflare account.');
  if (env.WRANGLER_CI_OVERRIDE_NAME && env.WRANGLER_CI_OVERRIDE_NAME !== SITE.name) throw new Error('Unexpected Wrangler Worker name override.');
  if (env.CLOUDFLARE_API_BASE_URL) throw new Error('Cloudflare API endpoint override is not allowed for this site.');
};

export const assertStaticSiteConfig = config => {
  const allowed = ['$schema', 'name', 'account_id', 'compatibility_date', 'workers_dev',
    'preview_urls', 'assets', 'observability'];
  if (!config || Object.keys(config).some(key => !allowed.includes(key))
    || config.name !== SITE.name || config.account_id !== SITE.account
    || config.workers_dev !== true || config.preview_urls !== false
    || config.assets?.directory !== '../../dist' || config.assets.run_worker_first !== false
    || config.assets.not_found_handling !== 'none' || config.observability?.enabled !== false) {
    throw new Error('Unexpected Cloudflare target or non-static configuration.');
  }
};

export const cloudflareApi = token => async function request(path, method = 'GET', body) {
  const multipart = body instanceof FormData;
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  });
  const envelope = await response.json();
  if (!response.ok || !envelope.success) {
    const codes = (envelope.errors ?? []).map(error => error.code).join(',');
    const hint = path.includes('/builds/') && envelope.errors?.some(error => error.code === 12006)
      ? ' Workers Builds requires a user-scoped token from profile/api-tokens; account tokens are unsupported.' : '';
    throw new Error(`${method} ${path}: HTTP ${response.status}; Cloudflare code ${codes || 'unknown'}.${hint}`);
  }
  const result = envelope.result;
  const pagination = envelope.result_info;
  if (method === 'GET' && (path.startsWith(`zones/${SITE.zone}/dns_records`)
    || path.startsWith(`accounts/${SITE.account}/builds/tokens`)) && Array.isArray(result)
    && pagination?.page < pagination?.total_pages) {
    const next = new URL(`https://api.cloudflare.com/client/v4/${path}`);
    next.searchParams.set('page', String(pagination.page + 1));
    return [...result, ...await request(next.pathname.slice('/client/v4/'.length) + next.search)];
  }
  return result;
};

// Register an existing credential in Cloudflare's Builds token store. This API
// does not mint API tokens or change permission policies. Never persist its
// secret locally; the returned UUID is a non-secret resource identifier.
export const selectBuildToken = async (api, token, selectedUuid) => {
  const tokens = await api(`accounts/${SITE.account}/builds/tokens?per_page=200`);
  if (selectedUuid) {
    const selected = tokens.find(entry => entry.build_token_uuid === selectedUuid);
    if (!selected || selected.owner_type !== 'user') throw new Error('Select a user-owned build token in the expected account.');
    return selectedUuid;
  }
  const verified = await api('user/tokens/verify');
  if (verified.status !== 'active' || !/^[a-f0-9]{32}$/.test(verified.id ?? '')) {
    throw new Error('Register an active restricted user API token; Wrangler OAuth is not a build deployment token.');
  }
  const name = `${SITE.name} deployment`;
  const matching = tokens.filter(entry => entry.cloudflare_token_id === verified.id && entry.owner_type === 'user');
  const reusable = matching.find(entry => entry.build_token_name === name) ?? (matching.length === 1 ? matching[0] : undefined);
  if (reusable?.build_token_uuid) return reusable.build_token_uuid;
  if (matching.length || tokens.some(entry => entry.build_token_name === name)) {
    throw new Error('Ambiguous existing build tokens. Inspect and select their UUID; do not create duplicates.');
  }
  const registered = await api(`accounts/${SITE.account}/builds/tokens`, 'POST', {
    build_token_name: name, build_token_secret: token, cloudflare_token_id: verified.id,
  });
  if (!registered.build_token_uuid || registered.owner_type !== 'user'
    || registered.cloudflare_token_id !== verified.id) throw new Error('Build token registration returned a different credential.');
  return registered.build_token_uuid;
};

export const inspectSite = async api => {
  const paths = {
    account: `accounts/${SITE.account}`,
    subscriptions: `accounts/${SITE.account}/subscriptions`,
    limits: `accounts/${SITE.account}/builds/account/limits`,
    zone: `zones/${SITE.zone}`,
    dns: `zones/${SITE.zone}/dns_records?name=${SITE.hostname}&per_page=100`,
    scripts: `accounts/${SITE.account}/workers/scripts`,
    domains: `accounts/${SITE.account}/workers/domains`,
    pages: `accounts/${SITE.account}/pages/projects`,
  };
  const results = await Promise.allSettled(Object.values(paths).map(path => api(path)));
  const state = {};
  const errors = [];
  Object.keys(paths).forEach((key, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') state[key] = result.value;
    else errors.push(result.reason.message);
  });
  if (state.account && state.account.id !== SITE.account) throw new Error('Unexpected Cloudflare account.');
  if (state.zone && (state.zone.id !== SITE.zone || state.zone.name !== SITE.hostname
    || state.zone.account.id !== SITE.account || state.zone.status !== 'active')) {
    throw new Error('Expected active motionsmith.org zone in the dedicated account.');
  }
  return { ...state, errors, worker: state.scripts?.find(script => script.id === SITE.name) };
};

export const requireFreeSite = state => {
  if (state.errors.length) throw new Error(`Remote setup blocked: ${state.errors.join(' ')}`);
  // Only non-paid accounts receive BOTH fields from the documented quota API.
  // The zone's Free Website plan and default_usage_model are not billing proof.
  if (typeof state.limits.has_reached_build_minutes_limit !== 'boolean'
    || !Number.isFinite(Date.parse(state.limits.build_minutes_refresh_on))) {
    throw new Error('Workers Builds Free billing is unproven. Do not provision or enable paid Builds.');
  }
  const workersPlans = state.subscriptions.filter(subscription => /workers?|builds?/i.test(JSON.stringify(subscription.rate_plan)));
  if (workersPlans.some(subscription => /trial|promo|credit/i.test(JSON.stringify(subscription)))) {
    throw new Error('Workers/Builds trial or promotional billing cannot establish zero additional cost.');
  }
  const paidWorkers = workersPlans.filter(subscription =>
    subscription.state !== 'Cancelled'
    && (subscription.price > 0 || !/free/i.test(JSON.stringify(subscription.rate_plan))));
  if (paidWorkers.length) throw new Error('Existing paid Workers/Builds subscription: evaluate free Pages; do not downgrade this account.');
  if (state.limits.has_reached_build_minutes_limit) {
    throw new Error(`Free build quota exhausted. Resume after ${state.limits.build_minutes_refresh_on}; do not upgrade.`);
  }
};

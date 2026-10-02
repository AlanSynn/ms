import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SITE, assertSiteEnvironment, assertStaticSiteConfig, cloudflareApi, inspectSite, readToken, requireFreeSite } from './cloudflare-site-account.mjs';

const action = process.argv[2] ?? 'status';
if (!['status', 'dry-run', 'deploy', 'connect-domain'].includes(action)) {
  throw new Error('Usage: bun scripts/cloudflare-site.mjs status|dry-run|deploy|connect-domain');
}
const config = JSON.parse(readFileSync(SITE.config, 'utf8'));
assertSiteEnvironment();
assertStaticSiteConfig(config);
const runWrangler = (args, token) => {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: SITE.account };
  delete env.WRANGLER_CI_OVERRIDE_NAME;
  if (token) {
    env.CLOUDFLARE_API_TOKEN = token;
    delete env.CLOUDFLARE_API_KEY;
    delete env.CLOUDFLARE_EMAIL;
  }
  const result = spawnSync('wrangler', [...args, '--config', SITE.config], {
    stdio: 'inherit', env,
  });
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed.`);
};
const build = () => {
  const result = spawnSync(process.execPath, ['scripts/build-cloudflare-site.mjs'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Validated Cloudflare build failed.');
};
if (action === 'dry-run') {
  build();
  runWrangler(['deploy', '--dry-run', '--outdir', 'artifacts/cloudflare-site/dry-run']);
} else {
  const token = readToken();
  const api = cloudflareApi(token);
  const state = await inspectSite(api);
  console.log(JSON.stringify({ target: SITE, resourceExists: Boolean(state.worker),
    zoneStatus: state.zone?.status, buildLimits: state.limits,
    apexDns: state.dns?.map(({ id, type, name, proxied }) => ({ id, type, name, proxied })),
    errors: state.errors }, null, 2));
  if (action === 'status') {
    if (state.worker) {
      const results = await Promise.allSettled([
        api(`accounts/${SITE.account}/workers/scripts/${SITE.name}/deployments`),
        api(`accounts/${SITE.account}/builds/workers/${state.worker.tag}/triggers`),
        api(`accounts/${SITE.account}/builds/workers/${state.worker.tag}/builds`),
      ]);
      // Never dump environment variables, secrets or build logs.
      results.forEach((result, index) => {
        const kind = ['deployments', 'triggers', 'builds'][index];
        if (result.status === 'rejected') {
          console.log(JSON.stringify({ kind, error: result.reason.message }));
          return;
        }
        const records = Array.isArray(result.value) ? result.value : result.value?.deployments ?? [];
        console.log(JSON.stringify({ kind, records: records.map(record => ({
          id: record.id, trigger_uuid: record.trigger_uuid, build_uuid: record.build_uuid,
          status: record.status, branch: record.branch, created_at: record.created_at,
          created_on: record.created_on, build_outcome: record.build_outcome,
          commit: record.build_trigger_metadata?.commit_hash,
          gitBranch: record.build_trigger_metadata?.branch,
          versions: record.versions,
          branch_includes: record.branch_includes, branch_excludes: record.branch_excludes,
        })) }));
      });
    }
    if (state.errors.length) process.exitCode = 1;
  } else {
    requireFreeSite(state);
    const receiptPath = 'artifacts/cloudflare-site/resource.json';
    const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : undefined;
    if (state.worker && (receipt?.account !== SITE.account || receipt?.name !== SITE.name || receipt?.tag !== state.worker.tag)) {
      throw new Error('Matching Worker already exists without this setup receipt. Inspect ownership before adopting it.');
    }
    if (action === 'deploy') {
      build();
      runWrangler(['deploy', '--strict'], token);
      const worker = (await api(`accounts/${SITE.account}/workers/scripts`)).find(script => script.id === SITE.name);
      if (!worker) throw new Error('Dedicated deployment was not found.');
      mkdirSync('artifacts/cloudflare-site', { recursive: true });
      const version = JSON.parse(readFileSync('dist/version.json', 'utf8'));
      writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, account: SITE.account, name: SITE.name, tag: worker.tag, version }, null, 2)}\n`);
    } else {
      if (!state.worker) throw new Error('Deploy and validate the workers.dev preview before connecting the domain.');
      if (state.pages.some(project => project.domains?.includes(SITE.hostname))) {
        throw new Error('motionsmith.org is already connected to a Pages project. Inspect before attaching it.');
      }
      const matching = state.domains.filter(domain => domain.hostname === SITE.hostname);
      if (matching.length) {
        if (matching.length !== 1 || matching[0].service !== SITE.name || matching[0].zone_id !== SITE.zone) {
          throw new Error('motionsmith.org is connected to a different resource.');
        }
        console.log('Dedicated domain already connected.');
      } else {
        if (state.dns.some(record => ['A', 'AAAA', 'CNAME'].includes(record.type))) {
          throw new Error('Existing apex address record: inspect it before connecting the domain.');
        }
        const smokePath = 'artifacts/cloudflare-site/smoke/report.json';
        const smoke = existsSync(smokePath) ? JSON.parse(readFileSync(smokePath, 'utf8')) : undefined;
        if (!smoke?.passed || smoke.url !== 'https://motionsmith-site.alansynn.workers.dev/'
          || JSON.stringify(smoke.version) !== JSON.stringify(receipt.version)) {
          throw new Error('Run the dedicated workers.dev preview smoke test for this deployment before connecting the domain.');
        }
        const liveResponse = await fetch(new URL('version.json', smoke.url), { cache: 'no-store' });
        if (!liveResponse.ok || JSON.stringify(await liveResponse.json()) !== JSON.stringify(smoke.version)) {
          throw new Error('Preview changed since verification. Smoke-test the current deployment before connecting it.');
        }
        const domain = await api(`accounts/${SITE.account}/workers/domains`, 'PUT', {
          hostname: SITE.hostname, service: SITE.name, zone_id: SITE.zone,
        });
        console.log(JSON.stringify({ hostname: domain.hostname, domainId: domain.id }));
      }
    }
  }
}

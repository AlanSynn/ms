import { readFileSync, writeFileSync } from 'node:fs';
import { SITE, assertSiteEnvironment, assertStaticSiteConfig, cloudflareApi, inspectSite, readToken, requireFreeSite, selectBuildToken } from './cloudflare-site-account.mjs';

// Documented Builds REST API; never grants permissions or GitHub App access.
const action = process.argv[2] ?? 'connect';
if (!['connect', 'register-token'].includes(action)) throw new Error('Usage: bun scripts/connect-cloudflare-site-builds.mjs [connect|register-token]');
assertSiteEnvironment();
const token = readToken();
const api = cloudflareApi(token);
const state = await inspectSite(api);
requireFreeSite(state);
if (!state.worker) throw new Error('Deploy and validate the dedicated static Worker first.');
const receiptPath = 'artifacts/cloudflare-site/resource.json';
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
if (receipt.account !== SITE.account || receipt.name !== SITE.name || receipt.tag !== state.worker.tag) {
  throw new Error('Dedicated resource receipt does not match this account and Worker.');
}
const tokenUuid = await selectBuildToken(api, token, process.env.MS_CLOUDFLARE_BUILD_TOKEN_UUID ?? receipt.buildTokenUuid);
writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, buildTokenUuid: tokenUuid }, null, 2)}\n`);
if (action === 'register-token') {
  console.log(JSON.stringify({ worker: SITE.name, buildTokenUuid: tokenUuid,
    note: 'Deployment credential is stored in Cloudflare. The local .env file is no longer needed by native builds. Keep the registered API token active.' }, null, 2));
  process.exit(0);
}
const repoResponse = await fetch('https://api.github.com/repos/alansynn/ms');
if (!repoResponse.ok) throw new Error('Cannot verify GitHub repository identity.');
const repo = await repoResponse.json();
if (repo.id !== 1283287676 || repo.owner.id !== 14052993 || repo.default_branch !== 'main') {
  throw new Error('Unexpected repository owner, repository ID or production branch.');
}
// The reviewed commands must exist on the production branch before its first
// build. This script never pushes or merges repository changes.
const mainConfig = await fetch('https://raw.githubusercontent.com/AlanSynn/ms/main/deploy/cloudflare/wrangler.jsonc');
if (!mainConfig.ok) throw new Error('Merge the reviewed configuration into main before connecting automatic builds.');
const remoteConfig = JSON.parse(await mainConfig.text());
assertStaticSiteConfig(remoteConfig);
const desired = JSON.parse(readFileSync('deploy/cloudflare/builds.json', 'utf8'));
const existing = await api(`accounts/${SITE.account}/builds/workers/${state.worker.tag}/triggers`);
if (existing.length > 1) throw new Error('Extra/preview build triggers exist. Inspect before changing them.');
let trigger = existing[0];
if (trigger) {
  const connection = trigger.repo_connection;
  if (trigger.external_script_id !== state.worker.tag || connection?.provider_type !== 'github'
    || String(connection.provider_account_id) !== String(repo.owner.id)
    || String(connection.repo_id) !== String(repo.id) || connection.repo_name !== repo.name) {
    throw new Error('Existing trigger targets a different Worker or repository.');
  }
  for (const field of ['trigger_name', 'build_command', 'deploy_command', 'root_directory',
    'branch_includes', 'branch_excludes', 'path_includes', 'path_excludes']) {
    if (JSON.stringify(trigger[field]) !== JSON.stringify(desired[field])) {
      throw new Error(`Existing trigger differs at ${field}; do not overwrite it blindly.`);
    }
  }
  if (trigger.build_token_uuid !== tokenUuid) throw new Error('Existing trigger uses a different deployment token.');
} else {
  const connection = await api(`accounts/${SITE.account}/builds/repos/connections`, 'PUT', {
    provider_type: 'github', provider_account_id: String(repo.owner.id),
    provider_account_name: repo.owner.login, repo_id: String(repo.id), repo_name: repo.name,
  });
  if (!connection.repo_connection_uuid) throw new Error('Repository connection was not established. Authorize the Cloudflare GitHub App for ms.');
  const { environment_variables, ...configuration } = desired;
  trigger = await api(`accounts/${SITE.account}/builds/triggers`, 'POST', {
    ...configuration, external_script_id: state.worker.tag,
    repo_connection_uuid: connection.repo_connection_uuid, build_token_uuid: tokenUuid,
  });
}
if (!trigger.trigger_uuid) throw new Error('No trigger UUID returned.');
await api(`accounts/${SITE.account}/builds/triggers/${trigger.trigger_uuid}/environment_variables`, 'PATCH', desired.environment_variables);
console.log(JSON.stringify({ worker: SITE.name, trigger: trigger.trigger_uuid, productionBranch: 'main',
  previewBuilds: false, note: 'Verify a real main Git push after the owner merges; no push was made by this script.' }, null, 2));

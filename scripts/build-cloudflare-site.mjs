import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SITE, assertSiteEnvironment, assertStaticSiteConfig } from './cloudflare-site-account.mjs';

assertSiteEnvironment();
assertStaticSiteConfig(JSON.parse(readFileSync(SITE.config, 'utf8')));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const bunVersion = packageJson.packageManager.replace(/^bun@/, '');
if (process.versions.bun !== bunVersion) {
  throw new Error(`Use repository Bun ${bunVersion}; running ${process.versions.bun ?? 'Node'}.`);
}
const publicBuild = JSON.parse(readFileSync('deploy/cloudflare/builds.json', 'utf8')).environment_variables;
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, VITE_BASE_PATH: '/',
  VITE_FEEDBACK_ENDPOINT: publicBuild.VITE_FEEDBACK_ENDPOINT.value };
// A hosting build must never inherit a desktop or browser diagnostics profile.
for (const key of ['TAURI_PLATFORM', 'TAURI_DEBUG', 'MOTIONSMITH_SUMMARY',
  'MOTIONSMITH_E2E_DIAGNOSTICS', 'MOTIONSMITH_AUDIT_ISOLATION',
  'CF_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL',
  'MS_CLOUDFLARE_TOKEN_FILE']) delete env[key];
for (const args of [['install', '--frozen-lockfile'], ['run', 'build'], ['run', 'test:bundle-budget']]) {
  const result = spawnSync(process.execPath, ['--no-env-file', ...args], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
copyFileSync('deploy/cloudflare/headers', 'dist/_headers');
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const assets = files('dist');
if (assets.length > 20_000) throw new Error('Workers Free allows at most 20,000 assets per version.');
for (const file of assets) {
  if (statSync(file).size > 25 * 1024 * 1024) throw new Error(`Asset exceeds 25 MiB: ${file}`);
  if (/\.(?:map|tsx?|exe|dmg|app|zip)$|(?:^|\/)\.(?:env|dev\.vars)/i.test(file)) {
    throw new Error(`Unexpected deployment artifact: ${file}`);
  }
}
const html = readFileSync('dist/index.html', 'utf8');
if (!html.includes('src="/assets/') || html.includes('src="/ms/assets/')) {
  throw new Error('Cloudflare artifact must use the / base path.');
}
console.log(`Cloudflare static artifact: ${assets.length} files; ${packageJson.version}; Bun ${bunVersion}.`);

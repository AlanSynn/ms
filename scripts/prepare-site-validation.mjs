import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const output = resolve('artifacts/site-validation');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const requiredBun = pkg.packageManager.replace(/^bun@/, '');
if (process.versions.bun !== requiredBun) throw new Error(`Use Bun ${requiredBun}.`);
mkdirSync(output, { recursive: true });
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
for (const key of ['TAURI_PLATFORM', 'TAURI_DEBUG', 'MOTIONSMITH_E2E_DIAGNOSTICS',
  'MOTIONSMITH_SUMMARY', 'MOTIONSMITH_AUDIT_ISOLATION', 'CF_TOKEN', 'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'MS_CLOUDFLARE_TOKEN_FILE']) delete env[key];
const run = (command, args, cwd = root, environment = env, log) => {
  const effectiveArgs = command === process.execPath ? ['--no-env-file', ...args] : args;
  const result = spawnSync(command, effectiveArgs, { cwd, env: environment, maxBuffer: 64 * 1024 * 1024 });
  if (log) writeFileSync(join(output, log), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]));
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed${log ? `; inspect ${log}` : ''}.`);
  return result.stdout;
};
const gh = path => JSON.parse(run('gh', ['api', path]).toString());
const deployments = gh('repos/alansynn/ms/deployments?environment=github-pages&per_page=100');
let deployed;
for (const deployment of deployments) {
  const statuses = gh(`repos/alansynn/ms/deployments/${deployment.id}/statuses`);
  if (statuses[0]?.state === 'success') { deployed = deployment; break; }
}
if (!deployed) throw new Error('No successful GitHub Pages deployment found. Do not assume the latest tag.');
const liveHtml = run('curl', ['-fLsS', 'https://alansynn.com/ms/']).toString();
const liveVersion = /class="boot-version"[^>]*>v?([^<]+)/.exec(liveHtml)?.[1]?.trim();
const mainAsset = /<script type="module" crossorigin src="(\/ms\/assets\/[^"/]+\.js)"/.exec(liveHtml)?.[1];
if (!mainAsset || !liveVersion) throw new Error('Cannot identify the live app from its HTML.');
const source = mkdtempSync(join(tmpdir(), 'motionsmith-existing-'));
writeFileSync(join(source, 'source.tar'), run('git', ['archive', deployed.sha]));
run('tar', ['-xf', 'source.tar'], source);
rmSync(join(source, 'source.tar'));
// package.json prepare configures hooks and needs a local Git repository.
run('git', ['init', '-q'], source);
const releasePkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
if (releasePkg.version !== liveVersion || releasePkg.packageManager !== pkg.packageManager) {
  throw new Error('Live version or release Bun differs. Investigate before compatibility testing.');
}
run(process.execPath, ['install', '--frozen-lockfile'], source, env, 'existing-install.log');
const feedback = gh('repos/alansynn/ms/actions/variables/VITE_FEEDBACK_ENDPOINT').value;
const releaseEnv = { ...env, VITE_BASE_PATH: '/ms/', VITE_FEEDBACK_ENDPOINT: feedback };
run(process.execPath, ['run', 'build'], source, releaseEnv, 'existing-build.log');
const liveMain = run('curl', ['-fLsS', `https://alansynn.com${mainAsset}`]);
const rebuiltMain = readFileSync(join(source, 'dist', mainAsset.slice('/ms/'.length)));
if (!liveMain.equals(rebuiltMain)) throw new Error('Rebuilt release main bundle differs from the live bundle.');
const copyBuild = (from, label) => {
  const destination = join(output, label);
  rmSync(destination, { recursive: true, force: true });
  cpSync(from, destination, { recursive: true });
};
copyBuild(join(source, 'dist'), 'existing');
run(process.execPath, ['install', '--frozen-lockfile'], root, env, 'candidate-install.log');
run(process.execPath, ['run', 'build'], root, { ...env, VITE_BASE_PATH: '/ms/', VITE_FEEDBACK_ENDPOINT: feedback }, 'candidate-ms-build.log');
copyBuild(join(root, 'dist'), 'candidate-ms');
run(process.execPath, ['scripts/build-cloudflare-site.mjs'], root, env, 'candidate-root-build.log');
copyBuild(join(root, 'dist'), 'candidate-root');
const proof = { existing: { version: liveVersion, commit: deployed.sha, deploymentId: deployed.id,
  mainAsset, mainSha256: createHash('sha256').update(liveMain).digest('hex'), byteIdentical: true },
  candidate: { head: run('git', ['rev-parse', 'HEAD']).toString().trim(),
    dirty: Boolean(run('git', ['status', '--porcelain']).length), version: pkg.version },
  bun: requiredBun, builtAt: new Date().toISOString() };
writeFileSync(join(output, 'build-evidence.json'), `${JSON.stringify(proof, null, 2)}\n`);
// Only delete the disposable archive after every artifact and proof is retained.
rmSync(source, { recursive: true, force: true });
console.log(JSON.stringify(proof, null, 2));

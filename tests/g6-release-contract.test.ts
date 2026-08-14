import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');
const packageJson = JSON.parse(read('package.json')) as {
  version: string;
  scripts: Record<string, string>;
};
const tauriConfig = JSON.parse(read('src-tauri', 'tauri.conf.json')) as {
  version: string;
  build: { beforeBuildCommand: string; frontendDist: string };
};
const gitignore = read('.gitignore');
const gitattributes = read('.gitattributes');
const playwright = read('playwright.config.ts');
const vite = read('vite.config.ts');
const workflow = read('.github', 'workflows', 'deploy.yml');
const deployment = read('docs', 'deployment.md');
const macos = read('docs', 'macos-distribution.md');
const manifest = JSON.parse(read('docs', 'archive', 'ports', 'to-port-web-onnx', 'copy_manifest.json')) as {
  entries: Array<{ source: string; bundle_path: string; size_bytes: number; sha256: string }>;
};

const ignored = (candidate: string) => {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.excludesfile=/dev/null', 'check-ignore', '--no-index', candidate], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error, undefined, 'git check-ignore is available for ignore-rule contracts');
  return result.status === 0;
};

assert.equal(ignored('.worktrees/child/fixture.txt'), true, 'root worktree scratch is ignored');
assert.equal(ignored('src/.worktrees/child/fixture.txt'), false, 'nested .worktrees source is visible');
assert.equal(ignored('repro-scratch.ts'), true, 'root repro scratch is ignored');
assert.equal(ignored('tests/fixtures/repro-scratch.ts'), false, 'nested repro fixture is visible');
assert.equal(ignored('dist/generated.js'), true, 'root build output is ignored');
assert.equal(ignored('tests/fixtures/dist/generated.js'), false, 'nested dist fixture is visible');
assert.equal(ignored('node_modules/package/index.js'), true, 'root dependency output is ignored');
assert.equal(ignored('tests/fixtures/node_modules/package/index.js'), false, 'nested dependency fixture is visible');
assert.equal(ignored('.env'), true, 'root secret file is ignored');
assert.equal(ignored('tests/fixtures/.env'), false, 'nested fixture secret-shaped file is visible');
assert.equal(ignored('.env.example'), false, 'root environment template stays visible');
assert.equal(ignored('tests/browser/debug-example.spec.ts'), false, 'named browser source is not hidden by a broad debug rule');
assert(gitignore.includes('/.worktrees/'), 'worktree ignore rule is root-local');
assert(!gitignore.includes('\n.worktrees/'), 'worktree ignore rule is not an unanchored directory pattern');
assert(!gitignore.includes('\n*.local'), 'generic local suffix does not hide source or fixtures');
assert(gitattributes.includes('*.onnx filter=lfs diff=lfs merge=lfs -text'), 'ONNX assets use Git LFS without text normalization');
assert(gitattributes.includes('*.ort filter=lfs diff=lfs merge=lfs -text'), 'ORT candidates use Git LFS without text normalization');

assert.equal(packageJson.scripts.build, 'tsc && vite build', 'core build stays tsc plus Vite');
assert.equal(packageJson.scripts['test:browser'], 'bun run build && env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test', 'browser test entry builds before preview QA');
assert.equal(packageJson.scripts['build:tauri-frontend'], 'tsc && vite build --base ./', 'Tauri frontend build is an explicit layer');
assert(!Object.values(packageJson.scripts).some((script) => /telemetry|study/i.test(script)), 'default package scripts do not enable study telemetry');
assert(!Object.values(packageJson.scripts).some((script) => script.includes('bun build')), 'browser and Tauri builds do not use Bun JS bundling');
assert.equal(packageJson.version, tauriConfig.version, 'package and Tauri versions stay aligned without a release bump');
assert.equal(tauriConfig.build.beforeBuildCommand, 'bun run build:tauri-frontend', 'Tauri invokes the relative frontend layer');
assert.equal(tauriConfig.build.frontendDist, '../dist', 'Tauri consumes the canonical Vite dist directory');

assert(playwright.includes("const serverMode = process.env.PLAYWRIGHT_SERVER ?? 'preview'"), 'preview is the browser default');
assert(playwright.includes('PLAYWRIGHT_PORT'), 'browser tests expose an isolated port');
assert(playwright.includes('--strictPort'), 'browser server refuses port fallback');
assert(playwright.includes('baseURL: previewUrl') && playwright.includes('url: previewUrl'), 'browser URL and webserver probe share the isolated port');
assert(playwright.includes("serverMode !== 'preview' && serverMode !== 'dev'"), 'browser server mode rejects unknown values');
assert(playwright.includes("reuseExistingServer: serverMode === 'dev'"), 'preview/default browser QA never reuses an existing Vite server');
assert(!playwright.includes('reuseExistingServer: !process.env.CI'), 'CI state cannot enable preview server reuse');
assert(vite.includes("const bootFontAsset = 'fonts/manrope-800-latin.woff2'") && vite.includes('const bootFontSource = `./${bootFontAsset}`'), 'Tauri boot font provenance is explicit in Vite config');
assert(vite.includes('rolldownOptions') && vite.includes('external: [bootFontSource, bootFontBaseUrl]'), 'public boot font is intentionally external and keeps its relative runtime URL');
assert(!vite.includes('loadEnv') && !/VITE_(?:STUDY|TELEMETRY)|TELEMETRY_ENDPOINT|STUDY_PROFILE/.test(vite), 'default Vite config has no study or telemetry endpoint boundary');

const modelPath = join(root, 'public', 'onnx', 'pose_model.onnx');
assert(existsSync(modelPath), 'tracked browser model exists');
assert.equal(statSync(modelPath).size, 135929562, 'checked-out model matches the recorded byte count');
const modelSha256 = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
assert.equal(modelSha256, '9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74', 'checked-out model matches the recorded SHA-256');
const modelEntry = manifest.entries.find((entry) => entry.bundle_path === 'repo/models/onnx/pose_model.onnx');
assert.deepEqual(modelEntry, {
  source: 'models/onnx/pose_model.onnx',
  bundle_path: 'repo/models/onnx/pose_model.onnx',
  size_bytes: 135929562,
  sha256: '9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74',
}, 'model copy manifest remains the source provenance record');
assert(deployment.includes('135929562') && deployment.includes('9fd0dc927f41d1981c64d1ac7f5b22545f369c16b95944d60d93495c5a68eb74'), 'deployment docs record model identity');
assert(macos.includes('deployment.md#asset-provenance'), 'native distribution docs point to model provenance');

assert(workflow.includes('tags:') && workflow.includes('v*.*.*') && !workflow.includes('branches:'), 'Pages deploy remains tag-only');
assert(workflow.includes('[asset] Check ONNX LFS asset') && workflow.includes('[contracts] Run repository contracts') && workflow.includes('[web] Build GitHub Pages frontend') && workflow.includes('[artifact] Upload static Pages artifact'), 'release workflow labels its failing layers');
assert(workflow.includes('lfs: false'), 'Pages checkout does not eagerly smudge or fetch every LFS object');
assert(workflow.includes('git lfs pull --include="public/onnx/pose_model.onnx"'), 'Pages explicitly fetches the deployed FP32 model');
assert.equal((workflow.match(/git lfs pull/g) ?? []).length, 1, 'Pages has exactly one explicit, scoped LFS pull');
assert(workflow.includes('sha256sum public/onnx/pose_model.onnx') && workflow.includes('sha256sum dist/onnx/pose_model.onnx'), 'release workflow verifies source and built model provenance');
assert(workflow.includes('VITE_BASE_PATH: /ms/'), 'Pages build keeps the /ms base path');
assert(!workflow.includes('VITE_STUDY_PROFILE') && !workflow.includes('test:study') && !workflow.includes('STUDY_'), 'tagged release has no study telemetry dependency');
const deployedInt8Path = join(root, 'public', 'onnx', 'pose_model.int8.ort');
assert.equal(existsSync(deployedInt8Path), false, 'INT8 candidate is not present in the deployed public model directory');
assert(!workflow.includes('pose_model.int8.ort'), 'Pages release workflow never copies or deploys the INT8 candidate');

console.log('g6 release contracts ok');

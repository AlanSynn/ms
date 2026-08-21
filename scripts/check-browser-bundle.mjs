#!/usr/bin/env node
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { collectStaticImportClosure } from './browser-bundle-graph.mjs';

const DIST = join(process.cwd(), 'dist');
const OUTPUT = process.env.BUNDLE_BUDGET_OUTPUT
  ?? join(process.cwd(), 'artifacts/chromebook-audit/bundle-budget.json');
const CORE_JS_GZIP_LIMIT_BYTES = 450_000;
const SHELL_COMPRESSED_LIMIT_BYTES = 1_500_000;

const oneMatching = (files, pattern, label) => {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${label} in dist/assets, found ${matches.length}`);
  }
  return matches[0];
};

const compressedBytes = async (file) => {
  const bytes = await readFile(file);
  return ['.html', '.js', '.css', '.json', '.svg'].includes(extname(file))
    ? gzipSync(bytes, { level: 9 }).byteLength
    : bytes.byteLength;
};

const assetFiles = await readdir(join(DIST, 'assets'));
const indexJs = oneMatching(assetFiles, /^index-[\w-]+\.js$/, 'index JavaScript entry');
const appJs = oneMatching(assetFiles, /^App-[\w-]+\.js$/, 'App JavaScript entry');
const entryCoreFiles = [
  join(DIST, 'assets', indexJs),
  join(DIST, 'assets', appJs),
];
const coreFiles = await collectStaticImportClosure(entryCoreFiles);
const coreJsGzipBytes = (await Promise.all(coreFiles.map(compressedBytes)))
  .reduce((sum, bytes) => sum + bytes, 0);
const entryJsGzipBytes = (
  await Promise.all(entryCoreFiles.map(compressedBytes))
).reduce((sum, bytes) => sum + bytes, 0);

const htmlPath = join(DIST, 'index.html');
const html = await readFile(htmlPath, 'utf8');
const shellReferences = [...new Set(
  [...html.matchAll(/(?:assets|fonts)\/[A-Za-z0-9._-]+/g)]
    .map(([reference]) => reference),
)];
const shellPaths = [...new Set([
  htmlPath,
  ...coreFiles,
  ...shellReferences
    .map((reference) => join(DIST, reference))
    .filter((file) => !coreFiles.includes(file)),
])];
await Promise.all(shellPaths.map((file) => stat(file)));
const shellAssets = await Promise.all(shellPaths.map(async (file) => ({
  file: file.slice(DIST.length + 1),
  compressedBytes: await compressedBytes(file),
})));
const shellCompressedBytes = shellAssets
  .reduce((sum, asset) => sum + asset.compressedBytes, 0);

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  basis: 'static compressed production shell',
  imageRecognitionRuntime: 'absent',
  entryJs: {
    files: entryCoreFiles.map((file) => `assets/${basename(file)}`),
    gzipBytes: entryJsGzipBytes,
  },
  coreJs: {
    basis: 'entry plus recursive emitted static-import closure',
    files: coreFiles.map((file) => file.slice(DIST.length + 1)),
    gzipBytes: coreJsGzipBytes,
    limitBytes: CORE_JS_GZIP_LIMIT_BYTES,
    passed: coreJsGzipBytes <= CORE_JS_GZIP_LIMIT_BYTES,
  },
  initialShell: {
    assets: shellAssets,
    compressedBytes: shellCompressedBytes,
    limitBytes: SHELL_COMPRESSED_LIMIT_BYTES,
    passed: shellCompressedBytes <= SHELL_COMPRESSED_LIMIT_BYTES,
  },
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (!report.coreJs.passed || !report.initialShell.passed) process.exit(1);

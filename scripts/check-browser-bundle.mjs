#!/usr/bin/env node
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { collectStaticImportClosure } from './browser-bundle-graph.mjs';

const DIST = join(process.cwd(), 'dist');
const OUTPUT = process.env.BUNDLE_BUDGET_OUTPUT
  ?? join(process.cwd(), 'artifacts/chromebook-audit/bundle-budget.json');
const CORE_JS_GZIP_LIMIT_BYTES = 205_000;
const SHELL_COMPRESSED_LIMIT_BYTES = 300_000;
const OPTIONAL_JS_GZIP_LIMIT_BYTES = 200_000;
const RAPIER_JS_GZIP_LIMIT_BYTES = 900_000;

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
const coreFileSet = new Set(coreFiles);
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
const optionalJs = await Promise.all(
  assetFiles
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(DIST, 'assets', file))
    .filter((file) => !coreFileSet.has(file))
    .map(async (file) => {
      const gzipBytes = await compressedBytes(file);
      const rapier = /^rapier-[\w-]+\.js$/.test(basename(file));
      const limitBytes = rapier
        ? RAPIER_JS_GZIP_LIMIT_BYTES
        : OPTIONAL_JS_GZIP_LIMIT_BYTES;
      return {
        file: file.slice(DIST.length + 1),
        gzipBytes,
        class: rapier ? 'lazy-physics' : 'optional',
        limitBytes,
        passed: gzipBytes <= limitBytes,
      };
    }),
);
optionalJs.sort((left, right) => left.file.localeCompare(right.file));

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
  optionalJs: {
    basis: 'emitted JavaScript outside the recursive static-import closure',
    files: optionalJs,
    passed: optionalJs.every((chunk) => chunk.passed),
  },
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (
  !report.coreJs.passed ||
  !report.initialShell.passed ||
  !report.optionalJs.passed
) process.exit(1);

import path from 'path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const bootFontAsset = 'fonts/manrope-800-latin.woff2';
const bootFontSource = `./${bootFontAsset}`;

const studySummaryMode = process.env.MOTIONSMITH_SUMMARY;
if (
  studySummaryMode !== undefined &&
  studySummaryMode !== '0' &&
  studySummaryMode !== '1'
) {
  throw new Error('MOTIONSMITH_SUMMARY must be 0, 1, or unset');
}
const studySummaryEnabled = studySummaryMode === '1';
const studySummaryTarget = studySummaryEnabled
  ? (process.env.MOTIONSMITH_SUMMARY_TARGET ?? '')
  : '';
const studySummaryBuildSha = studySummaryEnabled
  ? (process.env.MOTIONSMITH_BUILD_SHA ?? '')
  : '';

if (studySummaryEnabled) {
  let target: URL;
  try {
    target = new URL(studySummaryTarget);
  } catch {
    throw new Error('MOTIONSMITH_SUMMARY_TARGET must be an absolute HTTP(S) URL');
  }
  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    target.username ||
    target.password
  ) {
    throw new Error('MOTIONSMITH_SUMMARY_TARGET must be an HTTP(S) URL without credentials');
  }
  if (!/^[0-9a-f]{7,40}$/i.test(studySummaryBuildSha)) {
    throw new Error('MOTIONSMITH_BUILD_SHA must be a 7-40 character hexadecimal Git SHA');
  }
}

export default defineConfig(() => {
  // Use relative paths for Tauri; allow GitHub Pages project paths for web builds.
  const isTauri = process.env.TAURI_PLATFORM !== undefined;
  const webBase = process.env.VITE_BASE_PATH ?? '/';
  const bootFontBaseUrl = `${webBase.replace(/\/?$/, '/')}${bootFontAsset}`;

  return {
    base: isTauri ? './' : webBase,
    server: {
      port: 1420,
      strictPort: true,
    },
    envPrefix: ['VITE_', 'TAURI_'],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      __MOTIONSMITH_STUDY_SUMMARY_ENABLED__: JSON.stringify(studySummaryEnabled),
      __MOTIONSMITH_STUDY_SUMMARY_TARGET__: JSON.stringify(studySummaryTarget),
      __MOTIONSMITH_BUILD_SHA__: JSON.stringify(studySummaryBuildSha),
    },
    plugins: [
      {
        name: 'motionsmith-html-version',
        transformIndexHtml: (html: string) => html.replace(/%APP_VERSION%/g, packageVersion),
      },
      react(),
    ],
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'es2022',
      minify: process.env.TAURI_DEBUG ? false : 'esbuild' as const,
      sourcemap: !!process.env.TAURI_DEBUG,
      // The boot font is a public asset; keep its base-aware relative URL
      // instead of making Vite resolve the inline HTML CSS as source code.
      rolldownOptions: {
        external: [bootFontSource, bootFontBaseUrl],
      },
      // Rapier and ONNX are intentionally lazy client chunks; keep this explicit
      // budget small enough to flag accidental bloat while avoiding false alarms.
      chunkSizeWarningLimit: 2400,
    }
  };
});

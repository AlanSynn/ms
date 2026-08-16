import path from 'path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const profileFlag = (name: string) => {
  const value = process.env[name];
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error(`${name} must be 0, 1, or unset`);
  }
  return value === '1';
};
const studySummaryEnabled = profileFlag('MOTIONSMITH_SUMMARY');
const e2eDiagnosticsEnabled = profileFlag('MOTIONSMITH_E2E_DIAGNOSTICS');
if (studySummaryEnabled && e2eDiagnosticsEnabled) {
  throw new Error('Study and E2E diagnostics profiles are mutually exclusive');
}

export default defineConfig(() => {
  // Use relative paths for Tauri; allow GitHub Pages project paths for web builds.
  const isTauri = process.env.TAURI_PLATFORM !== undefined;
  const webBase = process.env.VITE_BASE_PATH ?? '/';

  return {
    base: isTauri ? './' : webBase,
    server: {
      port: 1420,
      strictPort: true,
    },
    envPrefix: ['VITE_', 'TAURI_'],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      __MOTIONSMITH_E2E_DIAGNOSTICS__: JSON.stringify(e2eDiagnosticsEnabled),
      __MOTIONSMITH_STUDY_SUMMARY_ENABLED__: JSON.stringify(studySummaryEnabled),
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
      // Rapier and ONNX are intentionally lazy client chunks; keep this explicit
      // budget small enough to flag accidental bloat while avoiding false alarms.
      chunkSizeWarningLimit: 2400,
    }
  };
});

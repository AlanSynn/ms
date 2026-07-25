import path from 'path';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const configEnv = { ...loadedEnv, ...process.env };
  // Use relative paths for Tauri; allow GitHub Pages project paths for web builds.
  const isTauri = configEnv.TAURI_PLATFORM !== undefined;
  const webBase = configEnv.VITE_BASE_PATH ?? '/';
  const studyProfile = configEnv.VITE_STUDY_PROFILE ?? 'off';
  const studyEnabled = ['metrics', 'replay', 'study'].includes(studyProfile);

  return {
    base: isTauri ? './' : webBase,
    server: {
      port: 1420,
      strictPort: true,
    },
    envPrefix: ['VITE_', 'TAURI_'],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
    },
    plugins: [
      {
        name: 'motionsmith-study-boundary',
        enforce: 'pre',
        resolveId(source: string) {
          if (!studyEnabled) return null;
          if (/(?:^|\/)studyTelemetryBoundary$/.test(source))
            return path.resolve(__dirname, 'utils/studyTelemetry.ts');
          if (/(?:^|\/)useStudyTelemetryBoundary$/.test(source))
            return path.resolve(__dirname, 'hooks/useStudyTelemetry.ts');
          return null;
        },
      },
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
      },
    },
    build: {
      target: configEnv.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'es2022',
      minify: configEnv.TAURI_DEBUG ? false : 'esbuild' as const,
      sourcemap: !!configEnv.TAURI_DEBUG,
      // Rapier and ONNX are intentionally lazy client chunks; keep this explicit
      // budget small enough to flag accidental bloat while avoiding false alarms.
      chunkSizeWarningLimit: 2400,
    }
  };
});

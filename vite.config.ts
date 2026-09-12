import path from 'path';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const localGitSha = () => {
  try {
    return execSync('git rev-parse --short=8 HEAD').toString().trim();
  } catch {
    return '';
  }
};
// A clock-based fallback would make every offline rebuild look like a new
// release; the package version stays stable so open tabs never nag falsely.
const buildId = process.env.GITHUB_SHA?.slice(0, 8) || localGitSha() || packageVersion;
const profileFlag = (name: string) => {
  const value = process.env[name];
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error(`${name} must be 0, 1, or unset`);
  }
  return value === '1';
};
const studySummaryEnabled = profileFlag('MOTIONSMITH_SUMMARY');
const e2eDiagnosticsEnabled = profileFlag('MOTIONSMITH_E2E_DIAGNOSTICS');
const auditIsolationEnabled = profileFlag('MOTIONSMITH_AUDIT_ISOLATION');
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
    preview: auditIsolationEnabled ? {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    } : undefined,
    envPrefix: ['VITE_', 'TAURI_'],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      __BUILD_ID__: JSON.stringify(buildId),
      __MOTIONSMITH_UPDATE_CHECK_ENABLED__: JSON.stringify(!isTauri),
      __MOTIONSMITH_E2E_DIAGNOSTICS__: JSON.stringify(e2eDiagnosticsEnabled),
      __MOTIONSMITH_STUDY_SUMMARY_ENABLED__: JSON.stringify(studySummaryEnabled),
    },
    plugins: [
      {
        name: 'motionsmith-html-version',
        transformIndexHtml: (html: string) => html.replace(/%APP_VERSION%/g, packageVersion),
      },
      {
        // Emit the cache-bust probe target so open tabs can detect a newer deploy.
        name: 'motionsmith-version-json',
        closeBundle: () => {
          writeFileSync(
            path.join(__dirname, 'dist', 'version.json'),
            `${JSON.stringify({ version: packageVersion, buildId, builtAt: new Date().toISOString() }, null, 2)}\n`,
          );
        },
      },
      react(),
    ],
    worker: {
      // Keep worker entrypoints small: expensive recommendation/optimizer
      // modules are imported only after the worker owns the request.
      format: 'es' as const,
    },
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
      // Group startup copy catalogs so shared words compress together.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{
              name: 'app-copy',
              test: /[\\/]utils[\\/](?:appCommands|classroomContent|contextHelp|releaseNotes)\.ts$/,
            }],
          },
        },
      },
      // Rapier is intentionally lazy; keep this explicit budget small enough to
      // flag accidental bloat while avoiding false alarms.
      chunkSizeWarningLimit: 2400,
    }
  };
});

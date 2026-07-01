import path from 'path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

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
    },
    plugins: [react()],
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
    }
  };
});

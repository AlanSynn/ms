import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

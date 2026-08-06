import { defineConfig } from 'vite';

/**
 * A GitHub Pages project site is served from /<repo>/, not from the domain root, so the
 * built asset URLs have to carry that prefix. The Pages workflow sets PAGES_BASE; local
 * dev, preview and the capture harness leave it unset and build at '/'.
 */
export default defineConfig({
  base: process.env.PAGES_BASE || '/',
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
});

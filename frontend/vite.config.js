import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The published site lives at https://<user>.github.io/project_SE3/, not at a
// domain root, so built asset URLs need that prefix. The dev server still runs
// at "/" — a subpath there would only get in the way.
const REPO_BASE = '/project_SE3/'

/**
 * GitHub Pages serves static files only: it has no rewrite rule, so a request
 * for /project_SE3/donate looks for a file that does not exist and 404s, even
 * though the app can render that route perfectly well.
 *
 * Pages does serve 404.html for any unmatched path, so shipping a copy of the
 * app shell under that name turns the 404 into the app itself, which then reads
 * the URL and renders the right screen. Deep links and refreshes work.
 */
function githubPagesSpaFallback() {
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build',
    closeBundle() {
      const dir = resolve(process.cwd(), 'dist')
      copyFileSync(resolve(dir, 'index.html'), resolve(dir, '404.html'))
    },
  }
}

// Keyed on `mode`, not `command`: `vite preview` reports command "serve" just
// like the dev server, which would leave it serving at "/" while the built HTML
// points at the subpath — so the preview would 404 on every asset. Mode is
// "production" for both build and preview, and "development" for the dev server.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? REPO_BASE : '/',
  plugins: [react(), githubPagesSpaFallback()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
}))

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(value) {
  const path = `/${String(value || '/').trim().replace(/^\/+|\/+$/g, '')}`;
  return path === '/' ? path : `${path}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: normalizeBasePath(process.env.VITE_BASE_PATH || env.VITE_BASE_PATH),
    plugins: [react()],
    esbuild: process.env.VITEST ? { jsx: 'automatic' } : undefined,
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_TARGET
            || env.VITE_DEV_API_TARGET
            || 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/page-builder(?=\/|$)/, '/api'),
        },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@dnd-kit') || id.includes('@tiptap')) return 'editor';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router')) {
              return 'react';
            }
            return undefined;
          }
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      include: ['src/**/*.test.{js,jsx}'],
      css: true,
      coverage: {
        reporter: ['text', 'html'],
      },
    },
  };
});

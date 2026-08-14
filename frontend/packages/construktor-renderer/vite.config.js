import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'inject-renderer-css',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) {
          output.code = `import "./styles.css";\n${output.code}`;
        }
      }
    },
  }],
  build: {
    lib: {
      entry: 'src/index.jsx',
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        'dompurify',
        'react',
        'react-dom',
        'react/jsx-runtime',
      ],
    },
  },
});

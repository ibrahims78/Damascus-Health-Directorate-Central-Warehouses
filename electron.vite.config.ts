import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const shared = resolve(__dirname, 'src/shared');

/**
 * لا تُترك الحزم خارجية في العملية الرئيسية: النسخة المحمولة (portable) تعمل بلا
 * node_modules، لذلك يجب أن تكون حزمة main مكتفية بذاتها. electron-vite يستثني
 * تلقائيًا `electron` ووحدات Node المدمجة، والباقي (zod) يُضمَّن في الحزمة.
 */
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared,
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});

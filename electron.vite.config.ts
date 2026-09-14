import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const shared = resolve(__dirname, 'src/shared');

/**
 * التطبيق يُوزَّع كنسخة محمولة بلا node_modules، لذلك يجب أن تكون حزمة العملية
 * الرئيسية مكتفية بذاتها: نُعطّل التخريج التلقائي للاعتماديات (externalizeDeps)
 * ليُضمَّن zod داخل الحزمة، وتبقى `electron` ووحدات Node المدمجة خارجية فقط.
 */
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      externalizeDeps: false,
    },
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

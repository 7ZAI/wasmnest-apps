import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({
      include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'],
    }),
    cssInjectedByJsPlugin(),
  ],
  resolve: {
    alias: [{ find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' }],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __INTLIFY_JIT_COMPILATION__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: true,
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/entry.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: 'terser',
    codeSplitting: false,
  },
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * News 桌面前端构建（独立挂载包）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`
 * （CSS 内联），自带全部依赖，不写 `window.__WASMNEST_SHARED__`。
 *
 * i18n 消息在构建期预编译成 `(ctx) => string`，配合 vue-i18n 运行时构建，
 * 产物不含消息编译器（CSP 不需要 `'unsafe-eval'`）。新增语言文件必须加进
 * `i18nPrecompile` 的 include 清单。
 */
export default defineConfig({
  plugins: [
    vue(),
    i18nPrecompile({ include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'] }),
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
      entry: resolve(__dirname, 'src/entry.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'terser',
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
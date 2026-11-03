import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/**
 * Auth Center app 前端构建（桌面挂载包形态）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`（inline
 * CSS），复制到宿主 resources 由宿主运行时装载。**无外部化**（不写
 * `window.__WASMNEST_SHARED__`），独立包自足。
 *
 * i18n：消息构建期预编译 + `vue-i18n` 运行时构建（丢弃消息编译器），产物不含
 * eval → 不需要 CSP `'unsafe-eval'`（安全审查 #50）。新增语言文件必须加进清单。
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

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

/**
 * Auth Center app 前端构建（桌面挂载包形态）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`（inline
 * CSS），复制到宿主 resources 由宿主运行时装载。**无外部化**（不写
 * `window.__WASMNEST_SHARED__`），独立包自足。
 */
export default defineConfig({
  plugins: [vue(), cssInjectedByJsPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
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

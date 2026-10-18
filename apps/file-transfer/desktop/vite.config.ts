import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

/**
 * File Transfer app 前端构建（桌面 UI 宿主修正 · 机制 B：独立构建的挂载包）
 *
 * 入口 = `src/entry.ts`（mountApp 契约）；产物 = 单文件 `dist/index.js`（inline
 * CSS），复制到 `src-tauri/resources/plugins/desktop/<pluginId>/index.js` 由宿主
 * 运行时装载。**无外部化**（不写 `window.__WASMNEST_SHARED__`），独立包自足。
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

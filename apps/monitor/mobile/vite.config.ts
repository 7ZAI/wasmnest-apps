import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'

/**
 * Monitor（移动端）构建：SDK `wasmnestPlugin()`（vue / vue-i18n / pinia 外置为
 * 宿主全局）；产物入口 `src/index.ts`，宿主 loader 调 activate 注册运行面。
 *
 * 本 app 的样式全部使用宿主 Tailwind 工具类（移动宿主 Tailwind content 扫描
 * apps/<slug>/mobile/src），不产生独立 CSS 资产，无需内联插件。
 */
export default defineConfig({
  plugins: [vue(), wasmnestPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    minify: 'terser',
  },
})

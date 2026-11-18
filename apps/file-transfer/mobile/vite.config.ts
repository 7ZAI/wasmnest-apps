import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

export default defineConfig({
  // i18n 消息构建期预编译成 `(ctx) => string`：移动端 vue-i18n 由宿主提供，
  // 预编译后宿主的消息编译器不再处理本应用文案（安全审查 #50：CSP 撤 'unsafe-eval'）。
  // 新增语言文件必须加进 include 清单。
  plugins: [
    vue(),
    i18nPrecompile({ include: ['src/i18n/zh-CN.ts', 'src/i18n/en.ts'] }),
    wasmnestPlugin(),
  ],
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

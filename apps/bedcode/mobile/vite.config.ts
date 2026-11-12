import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { wasmnestPlugin } from '@binblink/wasmnest-plugin-sdk-mobile/vite'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

/** 各域文案模块（按域分散，新增域时必须加进清单） */
const MESSAGE_MODULES = [
  'src/app/i18n.ts',
  'src/fileExplorer/i18n.ts',
  'src/host/i18n.ts',
  'src/projects/i18n.ts',
  'src/settings/i18n.ts',
  'src/task/i18n.ts',
  'src/terminal/i18n.ts',
]

export default defineConfig({
  // i18n 消息构建期预编译成 `(ctx) => string`：移动端 vue-i18n 由宿主提供，
  // 预编译后宿主的消息编译器不再处理本应用文案（安全审查 #50：CSP 撤 'unsafe-eval'）。
  plugins: [vue(), i18nPrecompile({ include: MESSAGE_MODULES }), wasmnestPlugin()],
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
    // 终端字体（styles/terminal-font.css）必须内联为 data URL：本应用 CSS 走
    // `?inline` 运行时 <style> 注入，url() 指向独立文件时按宿主文档 base 解析，
    // 在宿主 WebView / dev-shell 里不可达。其余资产维持默认阈值（4KB）。
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? true : undefined),
    // 插件包必须是单文件：宿主只动态 import 清单里的 main（index.js），且装载 URL 是
    // `http://asset.localhost/<整条绝对路径 percent-encoded>`——代码分割出的相对 chunk
    // 会被解析成 `http://asset.localhost/<chunk>`（在 asset scope 外，403），
    // 于是 `import('@xterm/addon-webgl')` / `import('shiki/wasm')` 全部失败：
    // 终端退回 DOM 渲染器，源码查看静默空白（2026-11-12 真机定位）。
    rollupOptions: { output: { codeSplitting: false } },
  },
})

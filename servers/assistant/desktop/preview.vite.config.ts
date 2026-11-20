/**
 * 助手界面预览的 Vite 配置
 *
 * 只服务本地渲染审查，不参与产品构建（产品入口固定 `src/entry.ts`）。
 * 别名与产品构建保持一致；唯一额外的是把 Tauri 事件模块指到本地总线。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { i18nPrecompile } from '../../../scripts/lib/i18n-precompile.mjs'

const DESKTOP = resolve(__dirname)
const PREVIEW_ROOT = resolve(DESKTOP, 'src/preview')
/**
 * 宿主样式目录：预览只读引用，不进入产品构建。
 * 缺失时预览会在启动阶段显性报错，而不是悄悄渲染成无主题状态。
 */
const HOST_STYLES = resolve(DESKTOP, '../../../../wasmnest/wasmnest-desktop/src')

export default defineConfig({
  root: PREVIEW_ROOT,
  publicDir: false,
  plugins: [
    vue(),
    i18nPrecompile({ include: ['../i18n/zh-CN.ts', '../i18n/en.ts'] }),
  ],
  resolve: {
    alias: [
      { find: /^@nest-shared\/(.*)$/, replacement: resolve(DESKTOP, '../shared/$1') },
      { find: /^@wasmnest\/desktop-styles\/(.*)$/, replacement: resolve(HOST_STYLES, '$1') },
      { find: /^@tauri-apps\/api\/event$/, replacement: resolve(PREVIEW_ROOT, 'event-shim.ts') },
      {
        find: /^@earendil-works\/pi-ai\/utils\/(.+)$/,
        replacement: resolve(DESKTOP, 'node_modules/@earendil-works/pi-ai/dist/utils/$1'),
      },
      {
        find: /^@earendil-works\/pi-ai$/,
        replacement: resolve(DESKTOP, 'node_modules/@earendil-works/pi-ai'),
      },
      {
        find: /^@earendil-works\/pi-agent-core$/,
        replacement: resolve(DESKTOP, 'node_modules/@earendil-works/pi-agent-core'),
      },
      { find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
    ],
  },
  define: {
    __INTLIFY_JIT_COMPILATION__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: true,
  },
  css: {
    postcss: resolve(DESKTOP, 'postcss.config.js'),
  },
  server: {
    port: 5182,
    strictPort: true,
    fs: {
      allow: [
        DESKTOP,
        resolve(DESKTOP, '../shared'),
        resolve(DESKTOP, 'node_modules'),
        HOST_STYLES,
      ],
    },
  },
})
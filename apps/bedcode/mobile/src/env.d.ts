/**
 * Vite 环境类型声明
 *
 * 声明 `*.css?inline` 导入为字符串（index.ts 运行时注入用），
 * 使 tsc/vue-tsc 对插件源码类型检查通过。
 */
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare module '*.css?inline' {
  const content: string
  export default content
}

/**
 * html5-qrcode 随包分发的 zxing-js（UMD，包内无类型声明）
 *
 * 形状由 `host/scan/zxingDecoder.ts` 运行期校验（缺类 → 显性日志 + 回退路径关闭），
 * 这里只声明成不透明对象，避免各调用点各写一份 `any`。
 */
declare module 'html5-qrcode/third_party/zxing-js.umd.js' {
  const ZXing: Record<string, unknown>
  export default ZXing
}

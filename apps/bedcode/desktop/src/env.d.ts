/**
 * 环境类型声明（桌面宿主前端下沉后由 app 前端持有）
 *
 * 原宿主 `src/env.d.ts` 的共享模块全局声明随前端插件运行时退役删除
 * （lib 模式产物与 SDK 外部化机制在桌面端退役，宿主与 app 同一份 vite 构建），
 * 其余声明（Vite env / 资源模块）保留。
 */

/** Vite 环境变量（仅声明本项目用到的字段，避免引入完整 vite/client 类型） */
interface ImportMeta {
  readonly env: {
    readonly DEV: boolean
    readonly PROD: boolean
    readonly MODE: string
  }
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

declare module '@xterm/xterm/css/xterm.css' {
  const content: string
  export default content
}

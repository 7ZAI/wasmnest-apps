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

/**
 * `qrcode` 的最小类型声明（该包不带 `.d.ts`，仓库也未装 `@types/qrcode`）。
 *
 * 只声明本插件实际用到的成员：`create`（矩阵尺寸/模块数据，决定画布规格）与
 * `toCanvas`（绘制）。新增 API 时在此补签名，不要退化成 `any`。
 */
declare module 'qrcode' {
  export interface QrCodeOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    /** 静区（模块数） */
    margin?: number
    /** 画布边长（设备像素） */
    width?: number
    color?: { dark?: string; light?: string }
  }

  export interface QrModules {
    /** 矩阵边长（模块数，不含静区） */
    size: number
    /** 行优先的 0/1 数据（1 = 黑模块） */
    data: Uint8Array
  }

  export interface QrCreateResult {
    modules: QrModules
    version: number
    maskPattern: number
  }

  const QRCode: {
    create(text: string, options?: QrCodeOptions): QrCreateResult
    toCanvas(
      canvas: HTMLCanvasElement,
      text: string,
      options?: QrCodeOptions,
    ): Promise<void>
  }

  export default QRCode
}

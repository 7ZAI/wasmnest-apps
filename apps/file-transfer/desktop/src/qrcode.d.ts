/**
 * `qrcode` 的最小类型声明（该包不带 `.d.ts`，仓库也未装 `@types/qrcode`）。
 *
 * 只声明本插件实际用到的成员：`create`（矩阵尺寸，决定画布规格）与 `toCanvas`
 * （绘制）。新增 API 时在此补签名，不要退化成 `any`。
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

/**
 * 相机流生命周期（票 2026-11-11：自建扫码循环，替换 html5-qrcode 的相机面）
 * -----------------------------------------------------------------------------
 * 旧面板把相机交给 html5-qrcode：库自己起流、自己定解码画布、自己跑循环。问题是
 * 解码画布被钉成解码区域的 CSS 像素、只解一次全尺寸，且失败回调静默——几何修好后
 * 仍然「没反应」。本模块只负责**流**（getUserMedia / 播放 / 手电筒 / 停轨），
 * 帧循环在 `./useQrScanLoop`，于是解码策略可以自己定（多尺度 / ROI / 原生优先）。
 *
 * 约束（与旧实现同口径，迁移不得退步）：
 * - 流只在面板存活期间持有；`dispose()` 必须停掉所有轨道并解绑 `srcObject`；
 * - 不新增权限：`getUserMedia({video})` 与旧路径同一个相机权限；
 * - 手电筒走 `applyConstraints({advanced:[{torch}]})`，设备不支持时由调用方禁用按钮；
 * - 错误按「权限 / 其他不可用」两分类交给调用方（决定是否提示去系统设置）。
 */

import type { LoggerLike } from './types'

/** 相机失败分类：permission = 用户/系统拒绝了权限；unavailable = 设备或 API 不可用 */
export type CameraErrorKind = 'permission' | 'unavailable'

export interface CameraStreamOptions {
  logger: LoggerLike
  /** 起流失败 / 播放失败（播放失败不致命，见 `attach` 注释） */
  onError: (kind: CameraErrorKind) => void
}

export interface CameraStream {
  /** 起流并挂到 `video`；返回是否成功（失败已回调 `onError`） */
  attach: (video: HTMLVideoElement) => Promise<boolean>
  /** 停轨 + 解绑；幂等 */
  stop: () => void
  /** 停轨 + 标记销毁：`attach` 在 await 之后发现已销毁会立刻停掉刚拿到的流 */
  dispose: () => void
  /**
   * 设置手电筒；返回是否生效。
   * 设备明确声明不支持 → false（不抛）；应用约束失败 → 抛错（调用方禁用按钮 + 提示）。
   */
  setTorch: (on: boolean) => Promise<boolean>
}

/** 错误对象 → 日志文本 */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `getUserMedia` 拒绝原因 → 分类。
 *
 * `NotAllowedError` / `PermissionDeniedError`（旧名）/ `SecurityError` 属于权限；
 * `NotFoundError`（没摄像头）/ `NotReadableError`（被占用）/ `OverconstrainedError`
 * 及其余一律按不可用——两条路径的界面文案不同（权限多一行去系统设置的提示）。
 */
export function cameraErrorKind(error: unknown): CameraErrorKind {
  const name = error instanceof Error ? error.name : ''
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError'
    ? 'permission'
    : 'unavailable'
}

export function useCameraStream(options: CameraStreamOptions): CameraStream {
  let stream: MediaStream | null = null
  let videoEl: HTMLVideoElement | null = null
  let disposed = false

  function releaseStream(): void {
    if (!stream) return
    for (const track of stream.getTracks()) {
      try {
        track.stop()
      } catch {
        // 停轨失败没有补救动作：流对象即将丢弃，浏览器会随页面回收
      }
    }
    stream = null
  }

  function stop(): void {
    const video = videoEl
    releaseStream()
    videoEl = null
    // 解绑：停轨后 <video> 会停在最后一帧，不清理会让「已停流」与「还在预览」看起来一样
    if (video) video.srcObject = null
  }

  function dispose(): void {
    disposed = true
    stop()
  }

  function track(): MediaStreamTrack | null {
    return stream?.getVideoTracks()[0] ?? null
  }

  async function attach(video: HTMLVideoElement): Promise<boolean> {
    // 重复 attach（错误重试）：先停掉上一次的流，避免摄像头被两个流占住
    const previous = videoEl
    releaseStream()
    if (previous && previous !== video) previous.srcObject = null
    videoEl = video

    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!media || typeof media.getUserMedia !== 'function') {
      options.logger.warn('[host] qr camera unavailable: navigator.mediaDevices missing')
      options.onError('unavailable')
      return false
    }

    let acquired: MediaStream
    try {
      acquired = await media.getUserMedia({
        audio: false,
        video: {
          // 与旧路径同参数：后置摄像头优先（`ideal` 不强制，桌面 / 无后摄设备仍可回退）
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
    } catch (error) {
      options.logger.warn(`[host] qr camera start failed: ${errText(error)}`)
      options.onError(cameraErrorKind(error))
      return false
    }

    // await 期间面板可能已卸载：这时不能再挂流（否则相机常亮、也无法再被停掉）
    if (disposed) {
      for (const track of acquired.getTracks()) {
        try {
          track.stop()
        } catch {
          // 同上：丢弃即可
        }
      }
      return false
    }

    stream = acquired
    video.srcObject = acquired
    // playsinline：iOS / 部分 WebView 默认全屏播放；muted：自动播放策略要求
    video.setAttribute('playsinline', 'true')
    video.muted = true
    try {
      await video.play()
    } catch (error) {
      // 自动播放被拒时帧循环会因 readyState 不足一直空转——记一条日志便于真机排障，
      // 但不改错误态（画面可能仍然可用，且用户手势后浏览器会自行恢复）
      options.logger.warn(`[host] qr camera play failed: ${errText(error)}`)
    }
    return true
  }

  async function setTorch(on: boolean): Promise<boolean> {
    const current = track()
    if (!current) return false
    const capabilities = (current.getCapabilities?.() ?? {}) as { torch?: boolean }
    if (capabilities.torch === false) return false
    await current.applyConstraints({
      advanced: [{ torch: on }],
    } as unknown as MediaTrackConstraints)
    return true
  }

  return { attach, stop, dispose, setTorch }
}

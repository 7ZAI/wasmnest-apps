/**
 * 相机错误分类 行为契约测试（票 2026-11-11）
 *
 * 被测：`src/host/scan/useCameraStream.ts::cameraErrorKind`（纯函数；起流本身依赖
 * 真实 WebView，不进单测——真机门禁见 spec §6.4）。
 *
 * 分类决定界面：权限类多一行「去系统设置授权」（`hub.scanCameraPermissionHint`），
 * 其他不可用只给「无法启动摄像头」，不能混为一谈。
 */
import { describe, expect, it } from 'vitest'
import { cameraErrorKind } from '../scan/useCameraStream'

/** 造一个带 `name` 的 DOMException 形状 */
function named(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

describe('cameraErrorKind 分类', () => {
  it.each(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])(
    'should_classifyAsPermission_when_name=%s',
    (name) => {
      expect(cameraErrorKind(named(name))).toBe('permission')
    },
  )

  it.each(['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'])(
    'should_classifyAsUnavailable_when_name=%s',
    (name) => {
      expect(cameraErrorKind(named(name))).toBe('unavailable')
    },
  )

  it('should_defaultToUnavailable_when_errorHasNoName', () => {
    expect(cameraErrorKind(undefined)).toBe('unavailable')
    expect(cameraErrorKind('boom')).toBe('unavailable')
    expect(cameraErrorKind(new Error('no name'))).toBe('unavailable')
  })
})
